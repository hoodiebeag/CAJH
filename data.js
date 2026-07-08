/**
 * data.js — Persistent 1-minute candle + order-flow store, backfilled from Kraken trades.
 *
 * Kraken's OHLC endpoint caps at ~720 candles, so deep history is rebuilt by paging the
 * public Trades endpoint (cursor = result.last, nanoseconds) and folding raw trades into
 * 1-minute bars. Each bar also carries an order-flow summary — buy/sell volume, trade
 * count, largest single print — so aggressor-imbalance features are available later
 * without a second pull. Raw trades are discarded; only bars are stored.
 *
 * One CSV per pair under $DATA_DIR/candles. Run directly:
 *   node data.js XBTUSD 18     # backfill ~18 months
 *   node data.js XBTUSD verify # compare the store against Kraken's native 1m OHLC
 */

import fs   from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

const DATA_DIR  = process.env.DATA_DIR || ".";
const STORE_DIR = path.join(DATA_DIR, "candles");
const MINUTE    = 60;               // bar size, seconds
const PAGE_DELAY_MS = 1500;         // public API ~1 req/s — stay polite
const COLUMNS   = "time,open,high,low,close,volume,buyVol,sellVol,trades,maxTrade";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Aggregation (pure — unit-tested) ─────────────────────────────────────────────
/**
 * Fold raw Kraken trades into 1-minute bars, merging into an existing Map so successive
 * pages accumulate correctly. Each trade is [price, volume, time, side("b"/"s"), ...].
 * Trades must be in ascending time order (Kraken returns them that way) so open = first
 * trade in the minute and close = last.
 */
export function aggregateTrades(trades, bars = new Map()) {
  for (const t of trades) {
    const price = parseFloat(t[0]);
    const vol   = parseFloat(t[1]);
    const min   = Math.floor(Number(t[2]) / MINUTE) * MINUTE;
    const side  = t[3];
    let bar = bars.get(min);
    if (!bar) {
      bar = { time: min, open: price, high: price, low: price, close: price,
              volume: 0, buyVol: 0, sellVol: 0, trades: 0, maxTrade: 0 };
      bars.set(min, bar);
    }
    if (price > bar.high) bar.high = price;
    if (price < bar.low)  bar.low  = price;
    bar.close   = price;
    bar.volume += vol;
    if (side === "b") bar.buyVol += vol; else bar.sellVol += vol;
    bar.trades += 1;
    if (vol > bar.maxTrade) bar.maxTrade = vol;
  }
  return bars;
}

// ── CSV persistence ───────────────────────────────────────────────────────────────
const pairFile = (pair) => path.join(STORE_DIR, `${pair}.csv`);

const barToRow = (b) =>
  [b.time, b.open, b.high, b.low, b.close, b.volume, b.buyVol, b.sellVol, b.trades, b.maxTrade].join(",");

/** Rewrite the pair's CSV from a bar Map (sorted, deduped by minute — idempotent). */
export function writeBars(pair, bars) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const rows = [...bars.values()].sort((a, b) => a.time - b.time).map(barToRow);
  fs.writeFileSync(pairFile(pair), COLUMNS + "\n" + (rows.length ? rows.join("\n") + "\n" : ""));
}

/** Load stored bars for a pair as an array (empty if none). */
export function loadBars(pair) {
  const file = pairFile(pair);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").slice(1).filter(Boolean).map((line) => {
    const [time, open, high, low, close, volume, buyVol, sellVol, trades, maxTrade] = line.split(",").map(Number);
    return { time, open, high, low, close, volume, buyVol, sellVol, trades, maxTrade };
  });
}

/** Load stored bars keyed by minute, for resuming/merging a backfill. */
const loadBarMap = (pair) => new Map(loadBars(pair).map((b) => [b.time, b]));

/**
 * Resample stored 1m bars up to `tfMinutes` candles, in the same shape trader.fetchOHLC
 * returns ({ time, open, high, low, close, volume }, OHLCV as strings) — a drop-in for
 * fetchCandles in the backtest/analysis commands, but from deep local history instead of
 * Kraken's 720-candle live cap.
 */
export function loadCandles(pair, tfMinutes) {
  const span = tfMinutes * 60;
  const out = new Map();
  for (const b of loadBars(pair)) {
    const t = Math.floor(b.time / span) * span;
    let c = out.get(t);
    if (!c) { c = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 }; out.set(t, c); }
    if (b.high > c.high) c.high = b.high;
    if (b.low  < c.low)  c.low  = b.low;
    c.close   = b.close;       // bars are stored ascending, so the last one wins
    c.volume += b.volume;
  }
  return [...out.values()].sort((a, b) => a.time - b.time).map((c) => ({
    time: c.time,
    open: String(c.open), high: String(c.high), low: String(c.low), close: String(c.close), volume: String(c.volume),
  }));
}

// ── Backfill ────────────────────────────────────────────────────────────────────
async function fetchTradesPage(pair, sinceNs) {
  const res = await axios.get("https://api.kraken.com/0/public/Trades", {
    params: { pair, since: sinceNs }, timeout: 20000,
  });
  if (res.data.error?.length) throw new Error(res.data.error.join("; "));
  const key = Object.keys(res.data.result).find((k) => k !== "last");
  return { trades: res.data.result[key] || [], last: res.data.result.last };
}

/**
 * Backfill `months` of history for `pair` into 1m bars. Resumable: if a CSV already
 * exists we start from its last bar; otherwise from now − months. Writes periodically so
 * a crash loses at most the last batch of pages.
 */
export async function backfill(pair, months = 18, log = console.log) {
  const bars   = loadBarMap(pair);
  const resume = bars.size ? [...bars.keys()].sort((a, b) => b - a)[0] : null;
  const startSec = resume ?? Math.floor(Date.now() / 1000) - months * 30 * 24 * 60 * 60;
  const nowNs  = Date.now() * 1_000_000;
  let sinceNs  = String(startSec * 1_000_000_000); // seconds → ns cursor
  let pages = 0, totalTrades = 0;

  log(`[DATA] ${pair}: backfilling from ${new Date(startSec * 1000).toISOString()}${resume ? " (resume)" : ""}`);
  for (;;) {
    let page;
    try {
      page = await fetchTradesPage(pair, sinceNs);
    } catch (e) {
      log(`[DATA] ${pair} page error: ${e.message} — backing off`);
      await sleep(PAGE_DELAY_MS * 4);
      continue;
    }
    if (!page.trades.length) break;
    aggregateTrades(page.trades, bars);
    totalTrades += page.trades.length;
    pages += 1;
    if (pages % 20 === 0) {
      writeBars(pair, bars);
      log(`[DATA] ${pair}: ${pages} pages, ${totalTrades} trades, ${bars.size} bars…`);
    }
    if (!page.last || page.last === sinceNs) break; // no forward progress
    sinceNs = page.last;
    if (Number(sinceNs) >= nowNs) break;            // caught up to now
    await sleep(PAGE_DELAY_MS);
  }
  writeBars(pair, bars);
  log(`[DATA] ${pair} done: ${bars.size} bars from ${totalTrades} trades over ${pages} pages.`);
  return bars.size;
}

/** Trust check: compare the store against Kraken's native 1m OHLC on the overlap. */
export async function verifyAgainstOHLC(pair, log = console.log) {
  const res = await axios.get("https://api.kraken.com/0/public/OHLC", {
    params: { pair, interval: 1 }, timeout: 20000,
  });
  if (res.data.error?.length) throw new Error(res.data.error.join("; "));
  const key = Object.keys(res.data.result).find((k) => k !== "last");
  const native = new Map(res.data.result[key].map((k) => [Number(k[0]), { close: parseFloat(k[4]), volume: parseFloat(k[6]) }]));
  const ours = loadBarMap(pair);
  let compared = 0, closeMax = 0, volMax = 0;
  for (const [t, n] of native) {
    const o = ours.get(t);
    if (!o) continue;
    compared += 1;
    if (n.close  > 0) closeMax = Math.max(closeMax, Math.abs(o.close  - n.close)  / n.close);
    if (n.volume > 0) volMax   = Math.max(volMax,   Math.abs(o.volume - n.volume) / n.volume);
  }
  log(`[DATA] ${pair} verify: ${compared} overlapping minutes — max close dev ${(closeMax * 100).toFixed(3)}%, max volume dev ${(volMax * 100).toFixed(1)}%`);
  return { compared, closeMax, volMax };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pair = process.argv[2];
  const arg  = process.argv[3];
  if (!pair) {
    console.error("Usage: node data.js <KRAKEN_PAIR> [months]   or   node data.js <KRAKEN_PAIR> verify");
    process.exit(1);
  }
  const run = arg === "verify" ? verifyAgainstOHLC(pair) : backfill(pair, Number(arg) || 18);
  run.catch((e) => { console.error(e); process.exit(1); });
}
