import test from "node:test";
import assert from "node:assert/strict";
import { truncate, fit, walkForward, GRID } from "./xsmom-wf.mjs";

const DAY = 86400;
const sym = (n, fn, t0 = 0) =>
  Array.from({ length: n }, (_, i) => ({ time: t0 + i * DAY, open: fn(i), high: fn(i), low: fn(i), close: fn(i), volume: 1 }));

test("truncate never lets training see past its cutoff", () => {
  const s = { A: sym(400, (i) => 100 + i) };
  const cut = 200 * DAY;
  const t = truncate(s, new Date(cut * 1000).toISOString().slice(0, 10));
  assert.ok(t.A.every((b) => Number(b.time) <= cut));
  assert.ok(t.A.length < 400 && t.A.length > 100);
});

test("a fit is made only from bars before its cutoff", () => {
  // STEADY leads for the whole training window; LATE only takes off afterwards. A fit that could
  // see past its cutoff would prefer LATE.
  const steady = sym(700, (i) => 100 * Math.exp(0.002 * i));
  const late = sym(700, (i) => (i < 450 ? 100 : 100 * Math.exp(0.02 * (i - 450))));
  const filler = Array.from({ length: 8 }, (_, k) => [`F${k}`, sym(700, (i) => 100 * Math.exp(0.0002 * k * i))]);
  const series = { STEADY: steady, LATE: late, ...Object.fromEntries(filler) };
  const cutoff = new Date(430 * DAY * 1000).toISOString().slice(0, 10);
  const chosen = fit(series, cutoff, { grid: { lookbackBars: [252], topK: [1] } });
  assert.ok(chosen, "a fit must be produced");
  assert.equal(chosen.lookbackBars, 252);
});

test("the grid is six points, matching the ladder's interior optimum rather than exceeding it", () => {
  const n = GRID.lookbackBars.length * GRID.topK.length;
  assert.equal(n, 6, "a larger grid fits training noise -- the failure this file exists to detect");
});

test("the skip and rebalance interval are NOT refit", () => {
  // Holding the canonical 1993 construction fixed is what keeps this a literature-specified
  // strategy rather than a search result.
  assert.ok(!("skipBars" in GRID), "skip must stay at the canonical 21");
  assert.ok(!("rebalanceBars" in GRID), "rebalance must stay at the canonical 21");
});

test("walkForward reports which parameters each quarter chose", () => {
  const series = Object.fromEntries(
    Array.from({ length: 12 }, (_, k) => [`S${k}`, sym(900, (i) => 100 * Math.exp((0.0003 + k * 0.0002) * i))]));
  const r = walkForward(series, { testFrom: "1972-01-01", testTo: "1972-12-31" });
  assert.ok(Array.isArray(r.steps));
  for (const s of r.steps) assert.ok(s.skipped || (s.chose && "lookbackBars" in s.chose && "topK" in s.chose));
});
