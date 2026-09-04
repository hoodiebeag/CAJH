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
