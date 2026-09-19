import { test } from "node:test";
import assert from "node:assert/strict";
import { topComponents, pcaResiduals, pcaResidualMatrix, betaResiduals, betaResidualSeries, solve, zLast } from "./residual.mjs";

test("topComponents recovers a known single direction", () => {
  // Every row is a multiple of (1, 1): the first component must be (1,1)/sqrt(2) up to sign.
  const X = [[1, 1], [2, 2], [-1, -1], [3, 3]];
  const [v] = topComponents(X, 1);
  assert.ok(Math.abs(Math.abs(v[0]) - Math.SQRT1_2) < 1e-6, `got ${v}`);
  assert.ok(Math.abs(v[0] - v[1]) < 1e-6, "the two loadings must be equal");
});

test("the second component is orthogonal to the first", () => {
  const X = [[1, 0, 0], [0, 2, 0], [1, 1, 0], [-1, 3, 0], [2, -1, 0]];
  const [a, b] = topComponents(X, 2);
  assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) < 1e-6);
});

test("components are deterministic across calls, so residual signs cannot flip between runs", () => {
  const X = [[1, 2, 3], [2, 1, 0], [-1, 4, 2], [3, 3, 1], [0, -2, 5]];
  assert.deepEqual(topComponents(X, 2), topComponents(X, 2));
});

test("removing the only real component leaves a residual of zero", () => {
  const X = [[1, 1], [2, 2], [-1, -1], [3, 3]];
  const r = pcaResiduals(X, 1);
  assert.ok(Math.max(...r.map(Math.abs)) < 1e-6, `expected ~0, got ${r}`);
});

test("a name that moves against the common factor keeps a residual", () => {
  const X = [[1, 1], [2, 2], [-1, -1], [3, -3]];
  const r = pcaResiduals(X, 1);
  assert.ok(Math.max(...r.map(Math.abs)) > 0.1, `expected a live residual, got ${r}`);
});

test("betaResiduals zeroes out an exact linear relationship", () => {
  const f = [1, 2, 3, 4, 5, 6];
  const y = f.map((v) => 3 + 2 * v);
  assert.ok(Math.abs(betaResiduals(y, [f])) < 1e-9);
});

test("betaResiduals reports the last observation's own departure, not the average one", () => {
  const f = [1, 2, 3, 4, 5, 6];
  const y = f.map((v) => 2 * v);
  y[5] += 1.0;                       // only the final point is off the line
  const r = betaResiduals(y, [f]);
  assert.ok(r > 0.3, `expected a clearly positive last residual, got ${r}`);
});

test("betaResiduals handles two factors at once", () => {
  const f1 = [1, 2, 3, 4, 5, 6], f2 = [1, 0, 1, 0, 1, 0];
  const y = f1.map((v, i) => 1 + 2 * v - 3 * f2[i]);
  assert.ok(Math.abs(betaResiduals(y, [f1, f2])) < 1e-9);
});

test("betaResiduals returns null rather than guessing when there are too few observations", () => {
  assert.equal(betaResiduals([1, 2], [[1, 2]]), null);
});

test("betaResiduals returns null on a singular design instead of dividing by zero", () => {
  const f = [1, 1, 1, 1, 1];              // collinear with the intercept
  assert.equal(betaResiduals([1, 2, 3, 4, 5], [f]), null);
});

test("solve returns null for a singular system", () => {
  assert.equal(solve([[1, 2], [2, 4]], [1, 2]), null);
});

test("solve handles a system needing a pivot swap", () => {
  const x = solve([[0, 1], [1, 0]], [2, 3]);
  assert.ok(Math.abs(x[0] - 3) < 1e-12 && Math.abs(x[1] - 2) < 1e-12);
});

test("zLast is null on a flat series rather than dividing by a zero deviation", () => {
  assert.equal(zLast(new Array(30).fill(5)), null);
});

test("zLast is null below the minimum length, so a short history cannot score", () => {
  assert.equal(zLast([1, 2, 3], 20), null);
});

test("zLast signs correctly: a final value above its own history is positive", () => {
  const xs = new Array(29).fill(0).map((_, i) => (i % 2 ? 1 : -1));
  xs.push(10);
  assert.ok(zLast(xs) > 2);
});

test("pcaResidualMatrix returns one residual row per input row", () => {
  const X = [[1, 1], [2, 2], [-1, -1], [3, -3]];
  const R = pcaResidualMatrix(X, 1);
  assert.equal(R.length, X.length);
  assert.equal(R[0].length, 2);
});

test("pcaResidualMatrix agrees with the single-row version on the last row", () => {
  const X = [[1, 2], [2, 1], [-1, 4], [3, 3], [0, -2]];
  const R = pcaResidualMatrix(X, 1);
  const last = pcaResiduals(X, 1);
  for (let j = 0; j < last.length; j++) assert.ok(Math.abs(R[R.length - 1][j] - last[j]) < 1e-9);
});

test("betaResidualSeries is all zeros on an exact linear relationship", () => {
  const f = [1, 2, 3, 4, 5, 6];
  const r = betaResidualSeries(f.map((v) => 3 + 2 * v), [f]);
  assert.ok(Math.max(...r.map(Math.abs)) < 1e-9);
});

test("betaResidualSeries agrees with the single-row version on the last point", () => {
  const f = [1, 2, 3, 4, 5, 6];
  const y = f.map((v) => 2 * v); y[5] += 1;
  const r = betaResidualSeries(y, [f]);
  assert.ok(Math.abs(r[5] - betaResiduals(y, [f])) < 1e-9);
});

test("betaResidualSeries returns null on a singular design", () => {
  assert.equal(betaResidualSeries([1, 2, 3, 4, 5], [[1, 1, 1, 1, 1]]), null);
});
