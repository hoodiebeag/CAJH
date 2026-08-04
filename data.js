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
import * as logger from './logger.js';

const DATA_DIR  = process.env.DATA_DIR || ".";
const STORE_DIR = path.join(DATA_DIR, "candles");
const MINUTE    = 60;               // bar size, seconds
// Public API is ~1 req/s. Raise PAGE_DELAY_MS when running several pairs at once so the
// combined rate stays under the limit (3 pairs at 2500ms ≈ 1.2 req/s in total).
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS) || 1500;
const COLUMNS   = "time,open,high,low,close,volume,buyVol,sellVol,trades,maxTrade";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const finite = (value) => Number.isFinite(value);

function parseFinite(raw, field) {
  if (raw === undefined || raw === "") throw new Error(`invalid candle ${field}: missing`);
  const value = Number(raw);
  if (!finite(value)) throw new Error(`invalid candle ${field}: non-finite`);
  return value;
}

function parseInteger(raw, field) {
  const value = parseFinite(raw, field);
  if (!Number.isInteger(value)) throw new Error(`invalid candle ${field}: not an integer`);
  return value;
}

function validateBar(bar) {
  for (const field of ["time", "open", "high", "low", "close", "volume", "buyVol", "sellVol", "trades", "maxTrade"]) {
    if (!finite(bar[field])) throw new Error(`invalid candle ${field}: non-finite`);
  }
  if (!Number.isInteger(bar.time) || bar.time < 0 || bar.time % MINUTE !== 0) throw new Error(`invalid candle time: ${bar.time}`);
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) throw new Error(`invalid candle price at ${bar.time}`);
  if (bar.high < Math.max(bar.open, bar.close, bar.low)) throw new Error(`invalid candle OHLC high at ${bar.time}`);
  if (bar.low > Math.min(bar.open, bar.close, bar.high)) throw new Error(`invalid candle OHLC low at ${bar.time}`);
  if (bar.volume < 0 || bar.buyVol < 0 || bar.sellVol < 0 || bar.maxTrade < 0) throw new Error(`invalid candle volume at ${bar.time}`);
  if (!Number.isInteger(bar.trades) || bar.trades < 0) throw new Error(`invalid candle trades at ${bar.time}`);
  return bar;
}

function parseStoredRow(line) {
  const parts = line.split(",");
  if (parts.length !== 10) throw new Error(`malformed stored candle row: ${line}`);
  return validateBar({
    time: parseInteger(parts[0], "time"),
    open: parseFinite(parts[1], "open"),
    high: parseFinite(parts[2], "high"),
    low: parseFinite(parts[3], "low"),
    close: parseFinite(parts[4], "close"),
    volume: parseFinite(parts[5], "volume"),
    buyVol: parseFinite(parts[6], "buyVol"),
    sellVol: parseFinite(parts[7], "sellVol"),
    trades: parseInteger(parts[8], "trades"),
    maxTrade: parseFinite(parts[9], "maxTrade"),
  });
}

function parseArchiveRow(line) {
  const parts = line.split(",");
  if (parts.length !== 7) throw new Error(`malformed archive candle row: ${line}`);
  return validateBar({
    time: parseInteger(parts[0], "time"),
    open: parseFinite(parts[1], "open"),
    high: parseFinite(parts[2], "high"),
    low: parseFinite(parts[3], "low"),
    close: parseFinite(parts[4], "close"),
    volume: parseFinite(parts[5], "volume"),
    buyVol: 0,
    sellVol: 0,
    trades: parseInteger(parts[6], "trades"),
    maxTrade: 0,
  });
}

function assertStrictlyIncreasing(rows, source) {
  let prev = null;
  for (const row of rows) {
    if (prev !== null && row.time <= prev) throw new Error(`${source} candle rows must be strictly increasing and unique`);
    prev = row.time;
  }
}

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
// `pair` can originate from Discord-supplied text (e.g. !backtest <symbol>), so reject
// anything but a bare alphanumeric id before it reaches a file path.
const pairFile = (pair) => {
  if (!/^[A-Za-z0-9]+$/.test(pair)) throw new Error(`Invalid pair: ${pair}`);
  return path.join(STORE_DIR, `${pair}.csv`);
};

const barToRow = (b) =>
  [b.time, b.open, b.high, b.low, b.close, b.volume, b.buyVol, b.sellVol, b.trades, b.maxTrade].join(",");

/** Rewrite the pair's CSV from a bar Map (sorted, deduped by minute — idempotent). */
export function writeBars(pair, bars) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const rows = [...bars.values()].map(validateBar).sort((a, b) => a.time - b.time).map(barToRow);
  fs.writeFileSync(pairFile(pair), COLUMNS + "\n" + (rows.length ? rows.join("\n") + "\n" : ""));
}

/** Load stored bars for a pair as an array (empty if none). */
export function loadBars(pair) {
  const file = pairFile(pair);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  const [header, ...lines] = text.split("\n");
  if (header !== COLUMNS) throw new Error(`malformed candle header for ${pair}`);
  const rows = lines.filter(Boolean).map(parseStoredRow);
  assertStrictlyIncreasing(rows, "stored");
  return rows;
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

// ── Archive ingest ────────────────────────────────────────────────────────────────
/**
 * Ingest Kraken's downloadable OHLCVT 1-minute CSV into the store — far faster than paging
 * the Trades endpoint. Kraken's format is headerless: `timestamp,open,high,low,close,volume,
 * trades` (timestamp in seconds). Order-flow columns (buyVol/sellVol/maxTrade) aren't in the
 * archive, so they're zeroed — nothing in the current feature set uses them. Rows older than
 * `sinceSec` are skipped. Get the archive from Kraken support.
 *
 * MERGES into the existing store (archive wins on overlapping minutes) so the quarterly
 * incremental archives top a store up instead of wiping its history — ingesting a Q1-only
 * file must not delete the prior 18 months.
 */
export function ingestKrakenOHLCVT(pair, srcPath, sinceSec = 0) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`file not found: ${srcPath} — expected Kraken's OHLCVT 1-minute CSV (e.g. ${pair}_1.csv)`);
  }
  const bars = loadBarMap(pair);
  const source = [];
  for (const line of fs.readFileSync(srcPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const bar = parseArchiveRow(line);
    if (bar.time < sinceSec) continue;
    source.push(bar);
  }
  assertStrictlyIncreasing(source, "archive");
  for (const bar of source) bars.set(bar.time, bar);
  writeBars(pair, bars);
  return bars.size;
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
export async function backfill(pair, months = 18, log = logger.info) {
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

/**
 * Rebuild an explicit window [sinceSec, untilSec) from the Trades endpoint, restoring the
 * order-flow columns (buyVol/sellVol/trades/maxTrade) the OHLCVT archive cannot provide.
 *
 * Unlike `backfill`, trades are aggregated into a FRESH map and then REPLACE the store's
 * bars for those minutes. That distinction matters: `aggregateTrades` accumulates volume
 * into whatever bar it finds, so folding trades into archive-derived bars that already
 * carry a volume figure would silently double-count it. Bars outside the window are
 * untouched.
 */
export async function backfillRange(pair, sinceSec, untilSec, log = logger.info) {
  const fresh = new Map();
  let sinceNs = String(Math.floor(sinceSec) * 1_000_000_000);
  const untilNs = Math.floor(untilSec) * 1e9;
  let pages = 0, totalTrades = 0;

  // Merge-and-write periodically (not just at the end): if this process is killed
  // mid-run — a session cutoff, a crash — the work already done survives, and a
  // re-run naturally resumes from wherever the store's minutes stop being fresh.
  const checkpoint = () => {
    const bars = loadBarMap(pair);
    for (const [t, bar] of fresh) bars.set(t, bar);   // replace, never accumulate
    writeBars(pair, bars);
    return bars.size;
  };

  log(`[FLOW] ${pair}: rebuilding ${new Date(sinceSec * 1000).toISOString().slice(0, 10)} → ${new Date(untilSec * 1000).toISOString().slice(0, 10)} from trades`);
  for (;;) {
    let page;
    try {
      page = await fetchTradesPage(pair, sinceNs);
    } catch (e) {
      log(`[FLOW] ${pair} page error: ${e.message} — backing off`);
      await sleep(PAGE_DELAY_MS * 4);
      continue;
    }
    if (!page.trades.length) break;
    // Keep only trades inside the window; stop once we run past it.
    const inWindow = page.trades.filter(t => Number(t[2]) >= sinceSec && Number(t[2]) < untilSec);
    aggregateTrades(inWindow, fresh);
    totalTrades += inWindow.length;
    pages += 1;
    if (pages % 20 === 0) log(`[FLOW] ${pair}: ${pages} pages, ${totalTrades} trades, ${fresh.size} bars…`);
    if (pages % 100 === 0) checkpoint();
    if (!page.last || page.last === sinceNs) break;
    sinceNs = page.last;
    if (Number(sinceNs) >= untilNs) break;
    await sleep(PAGE_DELAY_MS);
  }

  const total = checkpoint();
  log(`[FLOW] ${pair} done: ${fresh.size} bars rebuilt with order flow (store now ${total} bars, ${pages} pages).`);
  return fresh.size;
}

/** Trust check: compare the store against Kraken's native 1m OHLC on the overlap. */
export async function verifyAgainstOHLC(pair, log = logger.info) {
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
  (async () => {
    const pair = process.argv[2];
    const arg  = process.argv[3];
    if (!pair) {
      logger.error("Usage: node data.js <KRAKEN_PAIR> [months]   or   node data.js <KRAKEN_PAIR> verify");
      process.exitCode = 1;
      return;
    }
    const run = arg === "verify" ? verifyAgainstOHLC(pair) : backfill(pair, Number(arg) || 18);
    try {
      await run;
    } catch (e) {
      logger.error(e);
      process.exitCode = 1;
    }
  })();
}
