import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import { availablePairs, availableTimeframes, loadBundleCandles, resampleBundleCandles } from "./bundle-loader.mjs";

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
