import test from "node:test";
import assert from "node:assert/strict";
import { simulateSizedEquity } from "./sizing.mjs";

test("fixed sizing: hand-computed equity curve, drawdown, no ruin", () => {
  const trades = [{ r: 1 }, { r: -1 }, { r: 2 }];
  const result = simulateSizedEquity(trades, { rule: "fixed", baseUnit: 1, startingCapital: 10 });
  assert.deepEqual(result.perTrade.map((p) => p.capitalCommitted), [1, 1, 1]);
  assert.deepEqual(result.equityCurve, [11, 10, 12]);
  assert.equal(result.totalCapitalCommitted, 3);
  assert.equal(result.totalPnL, 2);
  assert.ok(Math.abs(result.avgRPerUnitCapital - 2 / 3) < 1e-12);
  assert.ok(Math.abs(result.maxDrawdownPct - -1 / 11) < 1e-12);
  assert.equal(result.ruin, false);
});

test("martingale sizing: doubles after each loss, resets on a win, capped at 2^cap", () => {
  const trades = [{ r: -1 }, { r: -1 }, { r: -1 }, { r: 1 }, { r: -1 }];
  const result = simulateSizedEquity(trades, { rule: "martingale", cap: 2, baseUnit: 1, startingCapital: 10 });
  assert.deepEqual(result.perTrade.map((p) => p.multiplier), [1, 2, 4, 4, 1]); // 3rd loss would be 8, capped at 2^2=4
  assert.deepEqual(result.perTrade.map((p) => p.capitalCommitted), [1, 2, 4, 4, 1]);
  assert.deepEqual(result.equityCurve, [9, 7, 3, 7, 6]);
  assert.equal(result.totalCapitalCommitted, 12);
  assert.equal(result.totalPnL, -4);
  assert.ok(Math.abs(result.avgRPerUnitCapital - -1 / 3) < 1e-12);
  assert.ok(Math.abs(result.maxDrawdownPct - -0.7) < 1e-12);
  assert.equal(result.ruin, false); // equity dips to 3 but never <=0 with the default 0 floor
});

test("martingale sizing: ruin flag fires exactly when equity crosses the floor fraction, not before", () => {
  const trades = [{ r: -1 }, { r: -1 }, { r: -1 }];
  const result = simulateSizedEquity(trades, { rule: "martingale", cap: 2, baseUnit: 1, startingCapital: 10, ruinFloorFraction: 0.5 });
  // equity after each trade: 9 (>5, no ruin), 7 (>5, no ruin), 3 (<=5, ruin)
  assert.deepEqual(result.equityCurve, [9, 7, 3]);
  assert.equal(result.ruin, true);
  const safer = simulateSizedEquity(trades.slice(0, 2), { rule: "martingale", cap: 2, baseUnit: 1, startingCapital: 10, ruinFloorFraction: 0.5 });
  assert.equal(safer.ruin, false); // stops one trade before the floor is crossed
});

test("antimartingale sizing: doubles after each win, resets on a loss, capped at 2^cap", () => {
  const trades = [{ r: 1 }, { r: 1 }, { r: 1 }, { r: -1 }, { r: 1 }];
  const result = simulateSizedEquity(trades, { rule: "antimartingale", cap: 2, baseUnit: 1, startingCapital: 10 });
  assert.deepEqual(result.perTrade.map((p) => p.multiplier), [1, 2, 4, 4, 1]); // 3rd win would be 8, capped at 2^2=4
  assert.deepEqual(result.equityCurve, [11, 13, 17, 13, 14]);
  assert.equal(result.totalCapitalCommitted, 12);
  assert.equal(result.totalPnL, 4);
  assert.ok(Math.abs(result.avgRPerUnitCapital - 1 / 3) < 1e-12);
  assert.ok(Math.abs(result.maxDrawdownPct - -4 / 17) < 1e-12);
  assert.equal(result.ruin, false);
});

test("fixed sizing reproduces the repo's plain avgR aggregate exactly, not approximately", () => {
  const rValues = [0.5, -1, 2, -0.3, 1.75, -2, 0.1234567, -0.875, 3.2];
  const trades = rValues.map((r) => ({ r }));
  // Same aggregate already used elsewhere in this repo (backtest.js avgR / tournament.mjs average): plain mean of R.
  const plainAvgR = trades.reduce((a, t) => a + t.r, 0) / trades.length;
  const result = simulateSizedEquity(trades, { rule: "fixed", baseUnit: 1, startingCapital: 100 });
  assert.equal(result.avgRPerUnitCapital, plainAvgR); // strict equality, not a tolerance check
});

test("unknown sizing rule throws rather than silently defaulting", () => {
  assert.throws(() => simulateSizedEquity([{ r: 1 }], { rule: "bogus" }));
});
