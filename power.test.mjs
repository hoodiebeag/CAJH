import assert from "node:assert/strict";
import test from "node:test";
import { zFor, minimumDetectableEffect, requiredN, assess } from "./power.mjs";

test("z is the standard 2.80 at 5% two-sided and 80% power", () => {
  assert.ok(Math.abs(zFor(0.05, 0.80) - 2.802) < 0.001);
  assert.ok(zFor(0.01, 0.90) > zFor(0.05, 0.80), "stricter alpha and higher power demand more");
});

test("unsupported alpha or power is refused rather than silently approximated", () => {
  assert.throws(() => zFor(0.07, 0.80), /alpha must be/);
  assert.throws(() => zFor(0.05, 0.75), /power must be/);
});

test("minimum detectable effect shrinks with the square root of n", () => {
  const a = minimumDetectableEffect({ n: 100, sd: 1 });
  const b = minimumDetectableEffect({ n: 400, sd: 1 });
  assert.ok(Math.abs(a / b - 2) < 0.01, "4x the sample halves the detectable effect");
});

test("requiredN and minimumDetectableEffect are inverses", () => {
  const n = requiredN({ effect: 0.25, sd: 1 });
  const mde = minimumDetectableEffect({ n, sd: 1 });
  assert.ok(Math.abs(mde - 0.25) < 0.005);
});

test("bad inputs are rejected, not coerced", () => {
  assert.throws(() => minimumDetectableEffect({ n: 1, sd: 1 }), /n must be/);
  assert.throws(() => minimumDetectableEffect({ n: 10, sd: 0 }), /sd must be/);
  assert.throws(() => requiredN({ effect: 0, sd: 1 }), /effect must be/);
});

test("the FX carry study is called UNDERPOWERED, which is why it was not built", () => {
  // 61 months of history, ~2.5% monthly SD, hunting a documented 3%/yr (0.25%/month) premium.
  const r = assess({ effectiveN: 61, sd: 0.025, expectedEffect: 0.03 / 12, units: "/mo" });
  assert.equal(r.verdict, "UNDERPOWERED");
  assert.ok(r.shortfallFactor > 10, `expected a >10x shortfall, got ${r.shortfallFactor.toFixed(1)}x`);
  assert.match(r.summary, /A null from this study would mean nothing/);
});

test("the VRP study at h=5 is called POWERED, which is why it was", () => {
  // 99 non-overlapping weekly windows, ~4 vol points of spread, hunting a 1-3 point premium.
  const r = assess({ effectiveN: 99, sd: 0.04, expectedEffect: 0.02, units: " vol" });
  assert.equal(r.verdict, "POWERED");
  assert.ok(r.minimumDetectableEffect < 0.02);
});

test("the same study at h=21 is NOT powered — the horizon decision, reproduced", () => {
  const r = assess({ effectiveN: 22, sd: 0.04, expectedEffect: 0.02, units: " vol" });
  assert.equal(r.verdict, "UNDERPOWERED");
});
