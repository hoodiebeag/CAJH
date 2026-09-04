import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import fs from "fs";
import path from "path";
import { availablePairs, availableTimeframes, loadBundleCandles, resampleBundleCandles, marketProxy } from "./bundle-loader.mjs";

test("the bundle resolves from the module, not the working directory", () => {
  // The hazard this closes: a sweep script run from /tmp saw an empty universe, logged zero-trade
  // rows, and looked like a strategy that found no signal rather than a loader that found no data.
  const cwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    assert.ok(availablePairs(1440).length >= 25, "pairs must be visible from any working directory");
    assert.ok(loadBundleCandles("XBTUSD", 1440).length > 1000);
  } finally {
    process.chdir(cwd);
  }
});

test("a missing bundle throws instead of returning an empty universe", () => {
  assert.throws(() => availablePairs(1440, "/nonexistent-bundle-path"), /no candle bundle/);
});

test("a timeframe that was never collected is still an empty list, not an error", () => {
  assert.deepEqual(availablePairs(7, undefined), []);
  assert.ok(availableTimeframes().includes(1440));
});

test("resampling aggregates OHLC correctly and keeps the last close", () => {
  const daily = [
    { time: 0,     open: 10, high: 15, low: 8,  close: 12, volume: 1 },
    { time: 86400, open: 12, high: 20, low: 5,  close: 18, volume: 2 },
    { time: 172800,open: 18, high: 19, low: 17, close: 19, volume: 3 },
  ];
  const [bar] = resampleBundleCandles(daily, 10080);
  assert.deepEqual(bar, { time: 0, open: 10, high: 20, low: 5, close: 19, volume: 6 });
});

test("resampling splits on the span boundary, not on bar count", () => {
  const eightDays = Array.from({ length: 8 }, (_, i) => ({ time: i * 86400, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  assert.equal(resampleBundleCandles(eightDays, 10080).length, 2);
  assert.equal(resampleBundleCandles(eightDays.slice(0, 7), 10080).length, 1);
});

test("resampling the real bundle produces a coherent weekly series", () => {
  const daily = loadBundleCandles("XBTUSD", 1440);
  const weekly = resampleBundleCandles(daily, 10080);
  assert.ok(weekly.length > 150 && weekly.length < daily.length / 6);
  for (const b of weekly) assert.ok(b.high >= b.low && b.high >= b.close && b.low <= b.close, JSON.stringify(b));
});

test("marketProxy takes the first candidate present, as a convention not a judgement", () => {
  assert.equal(marketProxy(["ADAUSD", "SPY", "XBTUSD"]), "XBTUSD", "crypto first in the ordered list");
  assert.equal(marketProxy(["ADAUSD", "SPY", "QQQ"]), "SPY");
  assert.equal(marketProxy(["QQQ", "AAPL"]), "QQQ");
});

test("marketProxy accepts an object universe as well as a list", () => {
  assert.equal(marketProxy({ AAPL: [], SPY: [] }), "SPY");
});

test("marketProxy throws rather than guessing, and names what it looked for", () => {
  // The failure this closes: on an equities bundle three call sites looked for XBTUSD, found
  // nothing, and went quiet. Eight silently-ignored parameters into this campaign, quiet is worse
  // than loud.
  assert.throws(() => marketProxy(["AAPL", "MSFT"]), /no market proxy in this universe/);
  assert.throws(() => marketProxy(["AAPL", "MSFT"]), /XBTUSD, SPY/);
});

test("an explicit override wins, and one that is absent is an error not a fallback", () => {
  assert.equal(marketProxy(["AAPL", "SPY"], "AAPL"), "AAPL");
  assert.throws(() => marketProxy(["AAPL", "SPY"], "TSLA"), /is not in this universe/);
});

test("a bar with a blank or non-numeric price is dropped, not passed on as NaN", () => {
  // Every file in the first equities bundle ended with the live session's incomplete row: real
  // timestamp, real OHL, empty close. parseFloat("") is NaN and every NaN comparison is false, so
  // the backtester would have stepped over that bar without triggering a stop or a target.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  fs.mkdirSync(path.join(dir, "1440"), { recursive: true });
  fs.writeFileSync(path.join(dir, "1440", "TEST.csv"),
    "time,open,high,low,close,volume\n" +
    "1672704000,10,11,9,10.5,100\n" +
    "1672790400,10.5,11.5,10,,100\n" +      // the incomplete live bar
    "1672876800,11,12,10.5,abc,100\n" +     // an unparseable price
    "1672963200,11,12,10.5,11.8,100\n");
  const bars = loadBundleCandles("TEST", 1440, dir);
  assert.equal(bars.length, 2, "only the two complete bars survive");
  assert.deepEqual(bars.map((b) => b.close), ["10.5", "11.8"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CANDLE_MARKET_PROXY is honoured even when the call site passes null", () => {
  const prev = process.env.CANDLE_MARKET_PROXY;
  try {
    process.env.CANDLE_MARKET_PROXY = "QQQ";
    assert.equal(marketProxy(["SPY", "QQQ", "AAPL"], null), "QQQ", "the env var must beat the convention");
    assert.equal(marketProxy(["SPY", "QQQ", "AAPL"], "SPY"), "SPY", "an explicit request still wins");
  } finally {
    if (prev === undefined) delete process.env.CANDLE_MARKET_PROXY; else process.env.CANDLE_MARKET_PROXY = prev;
  }
});
