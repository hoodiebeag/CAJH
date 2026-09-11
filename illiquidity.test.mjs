import { test } from "node:test";
import assert from "node:assert/strict";
import { amihud, illiquidityZ, normalisation } from "./illiquidity.mjs";

test("amihud is |return| per dollar traded", () => {
  assert.ok(Math.abs(amihud(0.02, 100, 1000) - 0.02 / 100000) < 1e-18);
});

test("amihud uses the absolute return, so direction does not change liquidity", () => {
  assert.equal(amihud(0.02, 100, 1000), amihud(-0.02, 100, 1000));
});

test("amihud returns null on zero volume rather than Infinity", () => {
  // Infinity would sort to one end of a cross-section and be selected every single rebalance.
  assert.equal(amihud(0.02, 100, 0), null);
  assert.equal(amihud(0.02, 0, 1000), null);
});

test("amihud returns null on a non-finite return", () => {
  assert.equal(amihud(NaN, 100, 1000), null);
});

test("illiquidityZ scores a point against history that excludes it", () => {
  const v = new Array(61).fill(1);
  v[60] = Math.E;                         // one log unit above a perfectly flat history
  // A flat history has zero dispersion, so there is nothing to score against: null, not Infinity.
  assert.equal(illiquidityZ(v, 60)[60], null);
});

test("illiquidityZ signs correctly on a real spike", () => {
  const v = [];
  for (let i = 0; i < 60; i++) v.push(i % 2 ? 1 : 2);
  v.push(100);
  const z = illiquidityZ(v, 60);
  assert.ok(z[60] > 3, `expected a large positive z, got ${z[60]}`);
});

test("illiquidityZ logs before scoring, so one thin day cannot swamp the window", () => {
  // Raw-level z would put the spike near the sample maximum and squash everything else; on logs
  // the ordinary days keep their spread.
  const v = [];
  for (let i = 0; i < 60; i++) v.push(1 + (i % 5));
  v.push(1e6);
  const z = illiquidityZ(v, 60);
  assert.ok(Number.isFinite(z[60]) && z[60] > 5);
});

test("illiquidityZ leaves the warm-up window null", () => {
  const z = illiquidityZ(new Array(100).fill(null).map((_, i) => 1 + (i % 7)), 60);
  assert.ok(z.slice(0, 60).every((v) => v === null));
});

test("normalisation measures how far a spike has come back down", () => {
  const zs = [0, 0, 0, 0, 0, 4, 3, 2, 1, 0.5];
  assert.ok(Math.abs(normalisation(zs, 10) - 3.5) < 1e-12);
});

test("normalisation is zero when the peak is today, so a still-spiking name does not rank", () => {
  assert.equal(normalisation([0, 0, 0, 0, 0, 1, 2, 3, 4, 5], 10), 0);
});

test("normalisation returns null when any day in the lookback is missing", () => {
  const zs = [0, 0, 0, null, 0, 4, 3, 2, 1, 0.5];
  assert.equal(normalisation(zs, 10), null);
});

test("normalisation returns null when the series is shorter than the lookback", () => {
  assert.equal(normalisation([1, 2, 3], 10), null);
});
