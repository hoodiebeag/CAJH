/**
 * scripts/fetch-equity-ohlc.mjs — fetch US equity hourly OHLC from IB Gateway and
 * write it in the exact `candles/<SYMBOL>.csv` format `data.js` already parses, so
 * the existing tournament/backtest harness runs against equities unmodified.
 *
 * Run on the machine where IB Gateway is running. Read-only: historical data
 * requests only, never an order.
 *
 * Usage:
 *   node scripts/fetch-equity-ohlc.mjs --universe universe.txt [--years 3]
 *
 * --universe is REQUIRED and must be a file with one symbol per line. The script
 * deliberately refuses to invent a universe, because the obvious default -- "the
 * liquid large caps I can think of today" -- is survivorship bias in its purest
 * form: it selects on having survived to today, which guarantees a flattering
 * backtest. Whatever rule you use, fix it at the START of the window and record
 * it alongside the results.
 *
 * Why IBApi directly rather than brokers/ibkr.mjs's fetchOHLC: that adapter
 * hardcodes a 30-day duration, which is correct for the live path it serves and
 * far too short for a backtest. Paging back years needs endDateTime control the
 * adapter does not expose, and widening the adapter for a research need would
 * distort a tested live-trading path.
 *
 * KNOWN DATA LIMITS, stated rather than discovered later:
 *  - IBKR TRADES bars carry no aggressor split, so buyVol/sellVol are written 0.
 *    Any module that filters on them (flowsignal.mjs, intensityIC.mjs) will
 *    silently return EMPTY on equity files. Do not run order-flow studies here.
 *  - `trades` is IBKR's barCount, which is a trade count, not a tick count.
 *  - Equity volume units from IBKR have historically been reported in lots for
 *    some feeds. This script writes what IBKR sends, unscaled. Verify the
 *    magnitude against a known session before trusting any volume-derived study.
 *  - useRTH=1: regular trading hours only. Overnight/pre-market moves therefore
 *    appear as gaps between sessions, which is correct for equities but differs
 *    from crypto's continuous tape. Any study assuming a 24/7 tape must account
 *    for it.
 */
import fs from "node:fs";
import path from "node:path";
import { IBApi, EventName, Stock, BarSizeSetting, WhatToShow, isNonFatalError } from "@stoqey/ib";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const universeFile = arg("universe");
const years = Number(arg("years", "3"));
const host = process.env.IBKR_HOST || "127.0.0.1";
const port = Number(process.env.IBKR_PORT) || 4002;
const clientId = Number(process.env.IBKR_CLIENT_ID) || 0;
const outDir = path.join(process.env.DATA_DIR || ".", "candles");

if (!universeFile) {
  console.error("--universe <file> is required (one symbol per line).");
  console.error("Refusing to default to a hand-picked list: choosing today's liquid names is survivorship bias.");
  process.exit(2);
}
if (!Number.isFinite(years) || years < 1) { console.error("--years must be a positive number"); process.exit(2); }

const symbols = fs.readFileSync(universeFile, "utf8").split("\n").map((s) => s.trim().toUpperCase()).filter(Boolean);
const bad = symbols.filter((s) => !/^[A-Za-z0-9]+$/.test(s));
if (bad.length) { console.error(`Symbols must be alphanumeric (candleFile() rejects otherwise): ${bad.join(", ")}`); process.exit(2); }
if (!symbols.length) { console.error("universe file is empty"); process.exit(2); }

const COLUMNS = "time,open,high,low,close,volume,buyVol,sellVol,trades,maxTrade";
const CHUNK = "1 Y";           // per request; IBKR caps 1-hour bars around this
const PACING_MS = 11_000;      // IBKR throttles identical/rapid historical requests
const REQ_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ibFormat = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-") + " UTC";

let nextId = 1;

/** One paged request. Resolves the bars IBKR returned for the window ending at `end`. */
function requestChunk(ib, symbol, end) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const bars = [];
    let settled = false;
    const done = (fn) => { if (settled) return; settled = true; clearTimeout(timer); ib.off(EventName.historicalData, onBar); ib.off(EventName.error, onErr); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error(`timed out after ${REQ_TIMEOUT_MS}ms on ${symbol}`))), REQ_TIMEOUT_MS);
    const onBar = (rid, date, open, high, low, close, volume, barCount) => {
      if (rid !== id) return;
      if (String(date).startsWith("finished")) return done(() => resolve(bars));
      bars.push({ time: Number(date), open, high, low, close, volume: Number(volume), trades: Number(barCount) });
    };
    const onErr = (a, b, c) => {
      const isErr = a instanceof Error;
      const code = isErr ? -1 : b;
      const msg = isErr ? a.message : String(c ?? "");
      if (!isErr && a !== id) return;
      if (!isErr && isNonFatalError(code, new Error(msg))) return;
      done(() => reject(new Error(`${symbol}: ${code} ${msg}`)));
    };
    ib.on(EventName.historicalData, onBar);
    ib.on(EventName.error, onErr);
    //                                                       useRTH=1, formatDate=2 (epoch seconds)
    ib.reqHistoricalData(id, new Stock(symbol, "SMART", "USD"), ibFormat(end), CHUNK, BarSizeSetting.HOURS_ONE, WhatToShow.TRADES, 1, 2, false);
  });
}

/** Reject anything data.js's validateBar would reject, rather than writing a file that throws on load. */
function validate(b) {
  if (!Number.isInteger(b.time) || b.time < 0 || b.time % 60 !== 0) return `time ${b.time}`;
  for (const k of ["open", "high", "low", "close"]) if (!Number.isFinite(b[k]) || b[k] <= 0) return `${k} ${b[k]}`;
  if (b.high < Math.max(b.open, b.close, b.low)) return `high < max(o,c,l) at ${b.time}`;
  if (b.low > Math.min(b.open, b.close, b.high)) return `low > min(o,c,h) at ${b.time}`;
  if (!Number.isFinite(b.volume) || b.volume < 0) return `volume ${b.volume}`;
  if (!Number.isInteger(b.trades) || b.trades < 0) return `trades ${b.trades}`;
  return null;
}

async function fetchSymbol(ib, symbol) {
  const merged = new Map();
  let end = new Date();
  const chunks = Math.ceil(years);
  for (let i = 0; i < chunks; i++) {
    const bars = await requestChunk(ib, symbol, end);
    if (!bars.length) { console.log(`  ${symbol}: no bars before ${end.toISOString().slice(0, 10)}, stopping`); break; }
    let earliest = Infinity;
    for (const b of bars) { merged.set(b.time, b); if (b.time < earliest) earliest = b.time; }
    console.log(`  ${symbol}: +${bars.length} bars, earliest now ${new Date(earliest * 1000).toISOString().slice(0, 10)}`);
    end = new Date((earliest - 1) * 1000);
    if (i < chunks - 1) await sleep(PACING_MS);
  }
  const rows = [...merged.values()].sort((a, b) => a.time - b.time);
  const rejects = [];
  const clean = rows.filter((b) => { const why = validate(b); if (why) { rejects.push(why); return false; } return true; });
  if (rejects.length) console.log(`  ${symbol}: dropped ${rejects.length} invalid bars (first: ${rejects[0]})`);
  if (!clean.length) { console.log(`  ${symbol}: nothing valid, not writing`); return 0; }
  // buyVol/sellVol/maxTrade are 0: IBKR TRADES bars carry no aggressor split. See header.
  const csv = [COLUMNS, ...clean.map((b) => `${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume},0,0,${b.trades},0`)].join("\n") + "\n";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${symbol}.csv`), csv);
  const span = `${new Date(clean[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(clean[clean.length - 1].time * 1000).toISOString().slice(0, 10)}`;
  console.log(`  ${symbol}: wrote ${clean.length} bars (${span})`);
  return clean.length;
}

const ib = new IBApi({ host, port });
let connected = false;
ib.on(EventName.connected, () => { connected = true; });
ib.on(EventName.error, (a, b, c) => {
  const isErr = a instanceof Error;
  if (isErr) console.error(`socket error: ${a.message}`);
  else if (!isNonFatalError(b, new Error(String(c ?? "")))) console.error(`error ${b} (reqId ${a}): ${c}`);
});

console.log(`Connecting to IB Gateway at ${host}:${port} — ${symbols.length} symbols, ~${years}y of 1h bars\n`);
ib.connect(clientId);
await new Promise((r) => setTimeout(r, 3000));
if (!connected) {
  console.error("Never connected. Check the port (4002 Gateway paper / 4001 live / 7497 TWS paper), and that 127.0.0.1 is in Trusted IPs.");
  process.exit(1);
}
console.log("connected\n");

let total = 0;
for (const symbol of symbols) {
  try { total += await fetchSymbol(ib, symbol); }
  catch (err) { console.error(`  ${symbol}: FAILED — ${err.message}`); }
  await sleep(PACING_MS);
}
console.log(`\nDone. ${total} bars across ${symbols.length} symbols -> ${outDir}/`);
console.log("Reminder: the universe rule you used is part of the result. Record it with the backtest output.");
ib.disconnect();
process.exit(0);
