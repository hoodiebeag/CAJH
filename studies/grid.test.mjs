import test from "node:test";
import assert from "node:assert/strict";
import { computeGeometricLevels, simulateGridForAsset } from "./grid.mjs";

test("computeGeometricLevels: geometric spacing between min and max, N-1 equal log-steps", () => {
  const levels = computeGeometricLevels([100, 200], 3);
  assert.equal(levels.length, 3);
  assert.ok(Math.abs(levels[0] - 100) < 1e-9);
  assert.ok(Math.abs(levels[2] - 200) < 1e-9);
  assert.ok(Math.abs(levels[1] - 100 * Math.sqrt(2)) < 1e-9); // geometric midpoint
});

test("computeGeometricLevels: a flat (degenerate) window returns null, not a divide-by-zero", () => {
  assert.equal(computeGeometricLevels([100, 100, 100], 5), null);
  assert.equal(computeGeometricLevels([], 5), null);
});

test("simulateGridForAsset: hand-constructed 3-level (2-rung) price path proves fill, multi-rung-same-bar, and replenish logic", () => {
  const levels = [90, 100, 110]; // rung0: buy 90 / sell 100; rung1: buy 100 / sell 110
  const bars = [
    { low: 95, high: 95, close: 95 },   // rung1 buys (low<=100); rung0 does not (low>90)
    { low: 85, high: 85, close: 85 },   // rung0 buys (low<=90); rung1 not eligible (already holding)
    { low: 95, high: 112, close: 110 }, // both rungs sell (high>=100 and high>=110); low=95 would
                                         // otherwise re-trigger rung1's buy, but entering-bar state
                                         // (both holding) blocks it this same bar
    { low: 95, high: 95, close: 95 },   // rung1 replenished, buys again; rung0's level (90) untouched
  ];
  const sim = simulateGridForAsset(bars, levels, { costRate: 0, capitalPerRung: 1 });

  assert.equal(sim.totalCapitalAllocated, 2);
  assert.equal(sim.roundTrips, 2);

  // Bar-by-bar value curve, hand-computed:
  // A: rung0 cash=1, rung1 units=1/100 -> value=1+0.01*95=1.95
  assert.ok(Math.abs(sim.valueCurve[0] - 1.95) < 1e-9);
  // B: rung0 units=1/90, rung1 units=0.01 (unchanged) -> value=(1/90)*85+0.01*85
  assert.ok(Math.abs(sim.valueCurve[1] - ((1 / 90) * 85 + 0.01 * 85)) < 1e-9);
  // C: both sell -> realizedPnL = ((1/90)*100-1) + (0.01*110-1); neither re-buys this bar
  //    (entering-bar state was "holding" for both) -> value = realizedPnL + 1 + 1
  const expectedPnLc = ((1 / 90) * 100 - 1) + (0.01 * 110 - 1);
  assert.ok(Math.abs(sim.valueCurve[2] - (expectedPnLc + 2)) < 1e-9);
  // D: rung1 replenishes and buys again at 100 (low=95<=100); rung0's level (90) untouched
  //    by low=95 -> stays cash. value = realizedPnL + 1(rung0 cash) + 0.01*95(rung1 units)
  assert.ok(Math.abs(sim.valueCurve[3] - (expectedPnLc + 1 + 0.01 * 95)) < 1e-9);

  const finalRatio = sim.valueCurve.at(-1) / sim.totalCapitalAllocated;
  assert.ok(Math.abs(sim.totalReturn - (finalRatio - 1)) < 1e-9);
});

test("simulateGridForAsset: a bar that never touches any level leaves the value curve flat at nominal capital", () => {
  const levels = [50, 100, 150];
  const bars = [{ low: 90, high: 110, close: 100 }, { low: 90, high: 110, close: 100 }];
  const sim = simulateGridForAsset(bars, levels, { costRate: 0, capitalPerRung: 1 });
  assert.equal(sim.roundTrips, 0);
  assert.equal(sim.valueCurve[0], 2);
  assert.equal(sim.valueCurve[1], 2);
  assert.equal(sim.totalReturn, 0);
  assert.equal(sim.maxDrawdownPct, 0);
});

test("simulateGridForAsset: cost is deducted on both the buy and sell leg of a round trip", () => {
  const levels = [90, 100];
  const bars = [
    { low: 85, high: 85, close: 85 },  // buys at 90, cost applied to units bought
    { low: 105, high: 105, close: 105 }, // sells at 100, cost applied to proceeds
  ];
  const sim = simulateGridForAsset(bars, levels, { costRate: 0.01, capitalPerRung: 1 });
  const unitsBought = (1 * (1 - 0.01)) / 90;
  const proceeds = unitsBought * 100 * (1 - 0.01);
  assert.ok(Math.abs(sim.finalValue - (proceeds - 1 + 1)) < 1e-9); // realizedPnL + replenished rung
  assert.equal(sim.roundTrips, 1);
});

test("simulateGridForAsset: throws on fewer than 2 levels (no rung possible)", () => {
  assert.throws(() => simulateGridForAsset([{ low: 1, high: 1, close: 1 }], [100]));
});
