import { test } from "node:test";
import assert from "node:assert";
import { blockResample, bootstrapBook, suggestedBlockLen } from "./bootstrap.mjs";

const seq = n => Array.from({ length: n }, (_, i) => i);
// Fixed sequence of draws, so a resample can be predicted by hand.
const fixed = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test("blockResample at blockLen 1 is the ordinary i.i.d. bootstrap", () => {
  const out = blockResample(seq(5), 1, fixed(0, 0.9, 0.5, 0, 0.9));
  assert.deepEqual(out, [0, 4, 2, 0, 4]);
});

test("blockResample keeps blocks contiguous in the original series", () => {
  // Every output position must be its predecessor + 1 unless a new block started there.
  const out = blockResample(seq(12), 4, fixed(0.1, 0.5, 0.9));
  assert.equal(out.length, 12);
  for (const start of [0, 4, 8]) {
    const block = out.slice(start, start + 4);
    for (let k = 1; k < 4; k++) assert.equal(block[k], block[0] + k, `block at ${start} is not contiguous`);
  }
});

test("blockResample with blockLen equal to the series length can only return the series", () => {
  // One start exists, so the resample is degenerate -- worth pinning, because it is the boundary
  // where the bootstrap stops telling you anything.
  assert.deepEqual(blockResample(seq(6), 6, Math.random), seq(6));
});

test("blockResample truncates a trailing block rather than overrunning the length", () => {
  const out = blockResample(seq(5), 3, fixed(0));   // 0,1,2 then 0,1 -- not 0,1,2,0,1,2
  assert.deepEqual(out, [0, 1, 2, 0, 1]);
});

test("blockResample rejects a block length outside 1..n", () => {
  assert.throws(() => blockResample(seq(4), 0, Math.random), /outside 1\.\.4/);
  assert.throws(() => blockResample(seq(4), 5, Math.random), /outside 1\.\.4/);
});

test("bootstrapBook is reproducible from its seed", () => {
  const r = [0.02, -0.01, 0.03, 0.01, -0.02, 0.04, 0.0, 0.01];
  const a = bootstrapBook(r, { draws: 200, blockLen: 2, seed: 7 });
  const b = bootstrapBook(r, { draws: 200, blockLen: 2, seed: 7 });
  assert.deepEqual(a, b);
  const c = bootstrapBook(r, { draws: 200, blockLen: 2, seed: 8 });
  assert.notDeepEqual(a.cagr, c.cagr);
});

test("bootstrapBook annualises the mean LOG return by compounding, not by scaling", () => {
  // A constant series has no resampling variation, so every replicate is the same number and the
  // whole distribution collapses onto it. exp(0.01*12)-1 = 12.75%, not 12%.
  const b = bootstrapBook(Array(20).fill(0.01), { draws: 50, blockLen: 3, periodsPerYear: 12 });
  const want = Math.exp(0.12) - 1;
  for (const q of ["p05", "median", "p95"]) assert.ok(Math.abs(b.cagr[q] - want) < 1e-12, q);
  assert.equal(b.sharpe.median, 0);            // zero dispersion, so no Sharpe is defined
  assert.equal(b.cagr.pNegative, 0);
  assert.equal(b.periods, 20);
});

test("bootstrapBook counts a losing replicate as negative at exactly zero", () => {
  // A book that ends flat has not made money, and pNegative is the number a person feels.
  const b = bootstrapBook(Array(10).fill(0), { draws: 50 });
  assert.equal(b.cagr.pNegative, 1);
});

test("blocks widen the interval on a serially correlated series", () => {
  // Runs of four: with blockLen 4 a replicate carries whole runs and its mean swings further than
  // one built from independently shuffled periods. That gap is the standard error the i.i.d.
  // assumption was hiding.
  //
  // The gap is modest by construction and the arithmetic says how modest. Under blockLen 1 the mean
  // of 32 draws from +-0.05 has sd 0.05/sqrt(32) = 0.0088. Under blockLen 4 only the blocks that
  // start on a run boundary are pure; the other three offsets straddle one and average +-0.025 or 0,
  // giving block means an sd of 0.031 and their average over 8 blocks an sd of 0.0108. So the
  // expected widening is about 1.22x, and a threshold above that would be asserting a number the
  // construction cannot produce.
  const runs = [];
  for (let i = 0; i < 8; i++) runs.push(...Array(4).fill(i % 2 ? -0.05 : 0.05));
  const iid = bootstrapBook(runs, { draws: 3000, blockLen: 1, seed: 11 });
  const blk = bootstrapBook(runs, { draws: 3000, blockLen: 4, seed: 11 });
  const width = b => b.cagr.p95 - b.cagr.p05;
  assert.ok(width(blk) > 1.15 * width(iid),
    `expected blocks to widen the interval: iid ${width(iid).toFixed(4)} vs block ${width(blk).toFixed(4)}`);
});

test("suggestedBlockLen follows n^(1/3) and never drops below 2", () => {
  assert.equal(suggestedBlockLen(1), 2);       // floor, so the test is never accidentally i.i.d.
  assert.equal(suggestedBlockLen(31), 3);
  assert.equal(suggestedBlockLen(50), 4);
  assert.equal(suggestedBlockLen(1000), 10);
});

test("circular blocks wrap the series end to start", () => {
  // Start 4 of a 6-long series with blockLen 3 runs 4,5,0 -- impossible without the wrap, where
  // start 4 would not be a legal start at all.
  const out = blockResample(seq(6), 3, fixed(4 / 6), { circular: true });
  assert.deepEqual(out, [4, 5, 0, 4, 5, 0]);
});

test("circular blocks give every observation equal weight; moving blocks do not", () => {
  // The bias this exists to expose. Under moving blocks period 0 can only be reached by the single
  // block starting at 0, while an interior period is reachable from blockLen of them.
  const n = 20, L = 4, draws = 4000;
  const count = circular => {
    const rand = (s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296))(3);
    const seen = Array(n).fill(0);
    for (let d = 0; d < draws; d++) for (const v of blockResample(seq(n), L, rand, { circular })) seen[v]++;
    return seen;
  };
  const moving = count(false), wrapped = count(true);
  assert.ok(moving[0] < 0.5 * moving[10], `moving blocks should starve period 0: ${moving[0]} vs ${moving[10]}`);
  const lo = Math.min(...wrapped), hi = Math.max(...wrapped);
  assert.ok(hi / lo < 1.1, `circular blocks should be near-uniform, got ${lo}..${hi}`);
});
