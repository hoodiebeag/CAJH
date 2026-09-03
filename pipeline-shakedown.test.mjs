import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISHED, excursionTimeCoverage, toCanonical } from "./pipeline-shakedown.mjs";

test("importing the module does not run the cache-reading path", () => {
  // It did: the guard was `import.meta.url.endsWith(argv[1] ?? "")`, and endsWith("") is true for
  // every string, so any import ran real() and printed a cache error from an unrelated run.
  assert.equal(process.exitCode ?? 0, 0, "import left a failing exit code behind");
});

test("excursionTimeCoverage reports undated trades rather than assuming none", () => {
  const c = excursionTimeCoverage([{ entryTime: 1 }, { entryTime: 2 }, { r: 1 }]);
  assert.deepEqual(c, { total: 3, dated: 2, undated: 1, complete: false });
  assert.equal(excursionTimeCoverage([{ entryTime: 1 }]).complete, true);
});

test("toCanonical recovers gross R so cost is charged exactly once", () => {
  // backtest.js hands back r ALREADY net of cost; makeTradeRecord charges cost itself. If the
  // gross figure were not recovered first the population would be double-charged, which is the
  // defect CLASSIFIER-P5-ECONOMICS-ROW-STALENESS found in a published figure.
  const feeRate = 0.008, slip = 0.0005, entry = 100, exitPrice = 110, risk = 5;
  const netR = 1.5;
  const t = 1700000000;
  const candles = [{ time: t }, { time: t + 86400 }];
  const { records } = toCanonical("BTC", [{ r: netR, entry, exitPrice, risk, barsHeld: 1, entryTime: t, mae: 0, mfe: 0 }], candles, feeRate);
  assert.equal(records.length, 1);
  assert.ok(Math.abs(records[0].netR - netR) < 1e-9,
    `canonical netR ${records[0].netR} must reproduce backtest's ${netR}`);
});

test("undated excursions are reported separately, never silently dropped into the population", () => {
  const t = 1700000000;
  const candles = [{ time: t }, { time: t + 86400 }];
  const { records, undated } = toCanonical("BTC",
    [{ r: 1, entry: 100, exitPrice: 110, risk: 5, barsHeld: 1, entryTime: t },
     { r: 1, entry: 100, exitPrice: 110, risk: 5, barsHeld: 1 }], candles, 0.008);
  assert.equal(records.length, 1);
  assert.equal(undated.length, 1);
});

test("the published figures it reconciles against are stated, not remembered", () => {
  assert.equal(PUBLISHED.trades, 300);
  assert.equal(PUBLISHED.effectiveN, 104);
});
