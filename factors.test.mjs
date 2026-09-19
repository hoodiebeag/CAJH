import test from "node:test";
import assert from "node:assert/strict";
import { SIGNALS, benjaminiHochberg, basketReturns } from "./factors.mjs";

test("every signal returns null rather than a number it cannot justify", () => {
  // A signal that returns a value before its own window has filled would rank a symbol on noise.
  // Probed at bar 3, which is below every signal's requirement -- including the short-horizon
  // reversals, which legitimately need only 5 and 21 bars and must NOT be asserted against a
  // longer bar count than they use.
  const short = Array.from({ length: 30 }, (_, i) => 100 + i);
  const ctx = { basket: new Array(30).fill(0.001), volume: { X: new Array(30).fill(100) }, symbol: "X" };
  for (const [name, fn] of Object.entries(SIGNALS)) {
    assert.equal(fn(short, 3, ctx), null, `${name} produced a value at bar 3`);
  }
});

test("the short-horizon signals DO produce a value once their own shorter window has filled", () => {
  // The complement of the test above: a window requirement that is too strict would silently
  // disqualify a signal from ever ranking, which reads as "the factor does not work".
  const rising = Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.002 * i));
  assert.ok(Number.isFinite(SIGNALS.reversal1w(rising, 25, {})), "reversal1w needs only 5 bars");
  assert.ok(Number.isFinite(SIGNALS.reversal1m(rising, 25, {})), "reversal1m needs only 21");
  assert.equal(SIGNALS.momentum(rising, 25, {}), null, "momentum needs 252 and must still refuse");
});

test("reversal is the negative of momentum over its own window, not an unrelated quantity", () => {
  const rising = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(0.002 * i));
  assert.ok(SIGNALS.reversal1m(rising, 280, {}) < 0, "a riser must score NEGATIVE on reversal");
  assert.ok(SIGNALS.momentum(rising, 280, {}) > 0, "and positive on momentum");
});

test("lowVol and highVol are exact opposites, so a result on one cannot be a machinery artefact", () => {
  const noisy = Array.from({ length: 300 }, (_, i) => 100 * (1 + 0.3 * Math.sin(i)));
  const a = SIGNALS.lowVol(noisy, 280, {}), b = SIGNALS.highVol(noisy, 280, {});
  assert.ok(Math.abs(a + b) < 1e-12, `lowVol ${a} must be the exact negative of highVol ${b}`);
});

test("nearHigh is 1 at a new high and below 1 after a fall", () => {
  const up = Array.from({ length: 300 }, (_, i) => 100 + i);
  assert.ok(Math.abs(SIGNALS.nearHigh(up, 280, {}) - 1) < 1e-12);
  const fallen = [...up.slice(0, 280), ...Array.from({ length: 20 }, () => 200)];
  assert.ok(SIGNALS.nearHigh(fallen, 299, {}) < 1);
});

test("Benjamini-Hochberg finds the step-up threshold, not a flat 0.05", () => {
  // Twelve tests: BH admits the k smallest p-values where p(k) <= (k/m)*q. With one tiny p and the
  // rest large, only the tiny one survives -- a flat 0.05 cut would wrongly admit more.
  const rs = [0.001, 0.04, 0.06, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
    .map((p, i) => ({ name: `s${i}`, p }));
  const bh = benjaminiHochberg(rs, 0.05);
  assert.equal(bh.familySize, 12);
  assert.deepEqual(bh.survivors, ["s0"], "0.04 must NOT survive at rank 2, whose critical value is 0.0083");
});

test("a family where nothing is significant yields no survivors and a zero threshold", () => {
  const bh = benjaminiHochberg(Array.from({ length: 10 }, (_, i) => ({ name: `x${i}`, p: 0.5 })), 0.05);
  assert.deepEqual(bh.survivors, []);
  assert.equal(bh.threshold, 0);
});

test("basketReturns is the equal-weight mean and is null on the first bar", () => {
  const grid = { A: [100, 110], B: [100, 90] };
  const r = basketReturns(grid, ["A", "B"], [0, 1]);
  assert.equal(r[0], null);
  assert.ok(Math.abs(r[1] - (Math.log(1.1) + Math.log(0.9)) / 2) < 1e-12);
});

test("illiquidity ranks a thinly-traded name above a heavily-traded one with the same path", () => {
  const n = 300;
  const closes = Array.from({ length: n }, (_, i) => 100 * Math.exp(0.001 * i + 0.02 * Math.sin(i)));
  const ctx = (vol) => ({ volume: { X: new Array(n).fill(vol) }, symbol: "X" });
  const thin = SIGNALS.illiquidity(closes, n - 1, ctx(1_000));
  const deep = SIGNALS.illiquidity(closes, n - 1, ctx(1_000_000_000));
  assert.ok(thin !== null && deep !== null);
  assert.ok(thin > deep, "the same price path on less volume must score as more illiquid");
});

test("smallSize ranks the smaller dollar volume higher", () => {
  const n = 300;
  const closes = new Array(n).fill(50);
  const at = (vol) => SIGNALS.smallSize(closes, n - 1, { volume: { X: new Array(n).fill(vol) }, symbol: "X" });
  assert.ok(at(1_000) > at(1_000_000), "less dollar volume is smaller, and is held long");
});

test("both new signals refuse to score without volume or without enough history", () => {
  const closes = Array.from({ length: 300 }, () => 100);
  for (const name of ["illiquidity", "smallSize"]) {
    assert.equal(SIGNALS[name](closes, 299, { symbol: "X" }), null, `${name} with no volume`);
    assert.equal(SIGNALS[name](closes, 100, { volume: { X: new Array(300).fill(1) }, symbol: "X" }), null,
      `${name} needs 252 bars`);
  }
});

test("a zero-volume bar is skipped rather than dividing by zero", () => {
  const n = 300;
  const closes = Array.from({ length: n }, (_, i) => 100 * Math.exp(0.001 * i));
  const vol = new Array(n).fill(1000);
  for (let i = 0; i < n; i += 5) vol[i] = 0;              // 20% of bars did not trade
  const v = SIGNALS.illiquidity(closes, n - 1, { volume: { X: vol }, symbol: "X" });
  assert.ok(v !== null && Number.isFinite(v), "must be finite, not Infinity or NaN");
});
