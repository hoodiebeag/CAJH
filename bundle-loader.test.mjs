import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import { availablePairs, availableTimeframes, loadBundleCandles } from "./bundle-loader.mjs";

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
