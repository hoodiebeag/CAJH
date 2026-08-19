/**
 * End-to-end proof that an equity-shaped candle file produced by
 * scripts/fetch-equity-ohlc.mjs flows through the EXISTING research harness
 * unmodified: data.js parse -> resample to 1h/4h/1d -> backtestMultiTF.
 *
 * This exists because the equities port's whole premise is that strategy.js,
 * backtest.js and monitor.js are already asset-agnostic. That claim was made in
 * brokers/interface.md but never actually exercised with non-Kraken data. These
 * tests exercise it, so the port is verified before any real IBKR data exists.
 *
 * The synthetic series is deliberately trending-with-pullbacks rather than a
 * random walk: a pure random walk can produce zero entries, which would make
 * these tests pass while proving nothing.
 *
 * READ THIS BEFORE QUOTING ANY NUMBER FROM HERE. The synthetic series is a
 * deterministic sine-plus-drift uptrend, so `breakout` wins essentially every
 * trade on it (68 trades, avgR ~2.3, winRate 1.000 at time of writing). That is
 * an artifact of fabricated data, NOT evidence of edge, and must never be cited
 * as a result. These tests assert only that the pipeline runs and produces a
 * well-formed, non-empty result on equity-shaped input. Real equity numbers can
 * only come from scripts/fetch-equity-ohlc.mjs against IB Gateway.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOUR = 3600;
const COLUMNS = "time,open,high,low,close,volume,buyVol,sellVol,trades,maxTrade";

/** Build bars in exactly the shape scripts/fetch-equity-ohlc.mjs writes. */
function syntheticEquityBars(count, startSec = 1_600_000_000) {
  const bars = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    // trend with periodic pullbacks - deterministic, no RNG, so failures reproduce
    const drift = Math.sin(i / 40) * 1.6 + 0.05;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    bars.push({
      time: startSec - (startSec % HOUR) + i * HOUR,
      open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close: +close.toFixed(4),
      volume: 10_000 + (i % 97) * 13,
      buyVol: 0, sellVol: 0,          // IBKR TRADES bars carry no aggressor split
      trades: 50 + (i % 31),          // IBKR barCount
      maxTrade: 0,
    });
    price = close;
  }
  return bars;
}

const toCsv = (bars) =>
  COLUMNS + "\n" + bars.map((b) => `${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume},${b.buyVol},${b.sellVol},${b.trades},${b.maxTrade}`).join("\n") + "\n";

function withEquityDataDir(bars, symbol = "AAPL") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-equity-"));
  fs.mkdirSync(path.join(dir, "candles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "candles", `${symbol}.csv`), toCsv(bars));
  return dir;
}

test("an equity CSV written in the fetcher's format parses through data.js without modification", async () => {
  const dir = withEquityDataDir(syntheticEquityBars(200));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir; // STORE_DIR is resolved at import time, so set it first
  try {
    const { loadBars } = await import(`./data.js?equity-parse-${Date.now()}`);
    const bars = loadBars("AAPL");
    assert.equal(bars.length, 200, "every written bar must survive the parse");
    assert.equal(typeof bars[0].time, "number");
    assert.equal(bars[0].time % 60, 0, "data.js rejects a time not on a minute boundary");
    assert.ok(bars[1].time > bars[0].time, "loadBars asserts strictly increasing time");
    assert.equal(bars[0].buyVol, 0, "IBKR gives no aggressor split - zeros are expected, not a bug");
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
});

test("equity bars resample to the 1h/4h/1d timeframes the tournament harness asks for", async () => {
  const dir = withEquityDataDir(syntheticEquityBars(800));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const { loadBars, resampleBars } = await import(`./data.js?equity-resample-${Date.now()}`);
    const bars = loadBars("AAPL");
    const h1 = resampleBars(bars, 60).candles;
    const h4 = resampleBars(bars, 240).candles;
    const d1 = resampleBars(bars, 1440).candles;
    assert.equal(h1.length, 800, "hourly base bars resample 1:1 at 60m");
    assert.ok(h4.length > 0 && h4.length < h1.length, "4h must aggregate");
    assert.ok(d1.length > 0 && d1.length < h4.length, "1d must aggregate further");
    // aggregation must preserve OHLC semantics, not just bucket count
    const firstDay = d1[0];
    assert.ok(firstDay.high >= firstDay.open && firstDay.high >= firstDay.close);
    assert.ok(firstDay.low <= firstDay.open && firstDay.low <= firstDay.close);
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
});

test("backtestMultiTF runs on equity data and produces real trades - the port's core claim", async () => {
  const dir = withEquityDataDir(syntheticEquityBars(2400));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const { loadBars, resampleBars } = await import(`./data.js?equity-bt-${Date.now()}`);
    const { backtestMultiTF } = await import("./backtest.js");
    const bars = loadBars("AAPL");
    const series = [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: resampleBars(bars, mins).candles }));

    const breakout = { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: 0.01, maxStopPct: 0.06, tpR: 3, lockBreakeven: true, entryTf: "1h" };
    const result = backtestMultiTF({ series }, breakout);

    assert.ok(result, "backtest must return a result on equity data");
    assert.ok(Number.isFinite(result.avgR), `avgR must be finite, got ${result.avgR}`);
    assert.ok(result.trades > 0, `the port is unproven if equity data yields zero trades (got ${result.trades})`);
    assert.equal(result.results.length, result.trades, "per-trade R array must match the trade count");
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
});

test("a malformed equity CSV is rejected loudly rather than silently backtested", async () => {
  const bars = syntheticEquityBars(50);
  bars[10].high = 0.0001; // high below open/close - data.js's validateBar must catch this
  const dir = withEquityDataDir(bars);
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const { loadBars } = await import(`./data.js?equity-bad-${Date.now()}`);
    assert.throws(() => loadBars("AAPL"), /invalid candle/i, "corrupt equity bars must throw, not pass through");
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
});
