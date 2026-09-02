import assert from "node:assert/strict";
import test from "node:test";
import {
  seededRng, shuffledIndices, groupByCluster,
  clusteredBootstrapCI, clusteredBootstrapCITrades,
  percentileRank, nullSummary, matchedGeometryNull,
  alwaysFlatControl, buyAndHoldControl,
} from "./inference.mjs";
import { makeTradeRecord } from "./evallib.mjs";

// momentum.mjs's `seeded` and classifier.mjs's `seededRandom`, copied verbatim as the
// reference. Neither is exported, so equivalence is pinned here rather than asserted by import.
const momentumSeeded = (seed = 20260301) => {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
};

// ---------- determinism ----------

test("seededRng reproduces the project's existing LCG stream exactly", () => {
  for (const seed of [1, 42, 20260301, 20260303, 999983]) {
    const a = seededRng(seed), b = momentumSeeded(seed);
    for (let i = 0; i < 50; i++) assert.equal(a(), b(), `stream diverged at draw ${i} for seed ${seed}`);
  }
});

test("seededRng is deterministic per seed and different across seeds", () => {
  const draw = (seed) => Array.from({ length: 20 }, seededRng(seed));
  assert.deepEqual(draw(7), draw(7));
  assert.notDeepEqual(draw(7), draw(8));
  for (const v of draw(7)) assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
});

test("shuffledIndices is a permutation and is reproducible from its generator", () => {
  const a = shuffledIndices(10, seededRng(5));
  const b = shuffledIndices(10, seededRng(5));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [0,1,2,3,4,5,6,7,8,9]);
  assert.notDeepEqual(a, shuffledIndices(10, seededRng(6)));
});

// ---------- clustering ----------

test("groupByCluster groups by key in first-seen order", () => {
  const g = groupByCluster([1, 2, 3, 4], ["a", "b", "a", "c"]);
  assert.deepEqual([...g.keys()], ["a", "b", "c"]);
  assert.deepEqual(g.get("a"), [1, 3]);
  assert.throws(() => groupByCluster([1, 2], ["a"]), /same length/);
});

test("clustered resampling widens the interval when observations are clustered", () => {
  // 40 values, alternating +1/-1 in blocks of 10. Treated as independent the mean is pinned
  // near zero; treated as 4 clusters, a resample can easily draw three +1 blocks.
  const values = [...Array(10).fill(1), ...Array(10).fill(-1), ...Array(10).fill(1), ...Array(10).fill(-1)];
  const keys = values.map((_, i) => `block${Math.floor(i / 10)}`);
  const iid = clusteredBootstrapCI(values, { iterations: 2000, seed: 11 });
  const clustered = clusteredBootstrapCI(values, { keys, iterations: 2000, seed: 11 });

  assert.equal(iid.clusters, 40);
  assert.equal(clustered.clusters, 4);
  assert.equal(clustered.meanClusterSize, 10);
  assert.ok(clustered.hi - clustered.lo > iid.hi - iid.lo,
    `clustered width ${clustered.hi - clustered.lo} should exceed iid width ${iid.hi - iid.lo}`);
});

test("clusteredBootstrapCI is deterministic for a seed and moves with the seed", () => {
  const values = Array.from({ length: 60 }, (_, i) => Math.sin(i) );
  const a = clusteredBootstrapCI(values, { iterations: 500, seed: 3 });
  const b = clusteredBootstrapCI(values, { iterations: 500, seed: 3 });
  const c = clusteredBootstrapCI(values, { iterations: 500, seed: 4 });
  assert.deepEqual(a, b);
  assert.notDeepEqual([a.lo, a.hi], [c.lo, c.hi]);
});

test("a constant series yields a degenerate interval at its own value", () => {
  const r = clusteredBootstrapCI(Array(30).fill(0.25), { iterations: 200, seed: 1 });
  assert.ok(Math.abs(r.lo - 0.25) < 1e-12);
  assert.ok(Math.abs(r.hi - 0.25) < 1e-12);
  assert.ok(Math.abs(r.mean - 0.25) < 1e-12);
});

test("clusteredBootstrapCI reports mean and nominal n alongside the interval", () => {
  const r = clusteredBootstrapCI([1, 2, 3, 4], { iterations: 200, seed: 2 });
  assert.equal(r.nominalN, 4);
  assert.equal(r.mean, 2.5);
  assert.ok(r.lo <= r.mean && r.mean <= r.hi);
});

test("clusteredBootstrapCI rejects unusable inputs and handles the empty case", () => {
  assert.throws(() => clusteredBootstrapCI([1, NaN]), /finite/);
  assert.throws(() => clusteredBootstrapCI([1], { iterations: 0 }), /iterations/);
  assert.throws(() => clusteredBootstrapCI([1], { alpha: 0 }), /alpha/);
  assert.throws(() => clusteredBootstrapCI([1], { alpha: 1 }), /alpha/);
  const empty = clusteredBootstrapCI([]);
  assert.equal(empty.lo, null);
  assert.equal(empty.clusters, 0);
});

test("clusteredBootstrapCITrades clusters canonical records on exposureId", () => {
  const recs = ["BTC", "ETH", "SOL"].map((symbol) => makeTradeRecord({
    symbol, timeframe: "4h", entryTime: "2024-03-01T00:00:00Z", exitTime: "2024-03-01T06:00:00Z",
    entryPrice: 100, exitPrice: 110, risk: 5, grossR: 1,
  }));
  const r = clusteredBootstrapCITrades(recs, { iterations: 200, seed: 9 });
  assert.equal(r.nominalN, 3);
  assert.equal(r.clusters, 1, "three same-day trades are one cluster, not three observations");
});

// ---------- null scoring ----------

test("percentileRank counts strictly-below entries in a sorted array", () => {
  assert.equal(percentileRank([1, 2, 3, 4], 3), 0.5);
  assert.equal(percentileRank([1, 2, 3, 4], 0), 0);
  assert.equal(percentileRank([1, 2, 3, 4], 99), 1);
  assert.equal(percentileRank([], 1), 0);
});

test("nullSummary never reports p = 0, per the (exceedances + 1) / (K + 1) convention", () => {
  const draws = Array.from({ length: 999 }, (_, i) => i / 1000);
  const s = nullSummary(draws, 5);
  assert.equal(s.fractionOfDrawsBeatingObserved, 0);
  assert.equal(s.p, 1 / 1000, "a finite null cannot establish that nothing beats the result");
  assert.equal(s.percentileOfObserved, 1);
});

test("nullSummary reports the excess over the null, not the raw observation", () => {
  const s = nullSummary([0, 1, 2, 3, 4], 2);
  assert.equal(s.nullMean, 2);
  assert.equal(s.excessOverNull, 0);
  assert.equal(s.z, 0);
  assert.equal(s.draws, 5);
  assert.equal(s.fractionOfDrawsBeatingObserved, 3 / 5);
});

test("a positive null mean is not a pass — an observation at the null's own mean scores mid-pack", () => {
  // The geometry-null finding restated as a test: a null that averages +0.16R means a family
  // averaging +0.16R has demonstrated nothing.
  const draws = Array.from({ length: 200 }, (_, i) => 0.1637 + (i - 100) / 1000);
  const s = nullSummary(draws, 0.1637);
  assert.ok(s.p > 0.4 && s.p < 0.6, `expected a mid-pack p, got ${s.p}`);
  assert.ok(Math.abs(s.excessOverNull) < 0.01);
});

test("matchedGeometryNull is deterministic per seed and scores the observation against its draws", () => {
  const drawTrade = (random) => (random() < 0.5 ? 1 : -1);
  const a = matchedGeometryNull({ observedMean: 0.5, n: 50, drawTrade, k: 300, seed: 21 });
  const b = matchedGeometryNull({ observedMean: 0.5, n: 50, drawTrade, k: 300, seed: 21 });
  assert.deepEqual(a.nullDraws, b.nullDraws);
  assert.equal(a.draws, 300);
  assert.equal(a.tradesPerDraw, 50);
  assert.equal(a.usableDrawFraction, 1);
  assert.ok(Math.abs(a.nullMean) < 0.05, `a fair coin null should centre near zero, got ${a.nullMean}`);
  assert.ok(a.p < 0.05, "a +0.5R observation against a zero-centred null should be extreme");

  const c = matchedGeometryNull({ observedMean: 0.5, n: 50, drawTrade, k: 300, seed: 22 });
  assert.notDeepEqual(a.nullDraws, c.nullDraws);
});

test("matchedGeometryNull reports unusable draws instead of hiding or forcing them", () => {
  let calls = 0;
  // Every third attempt fails, so the retry loop is exercised and the fraction is visible.
  const drawTrade = () => (++calls % 3 === 0 ? null : 0.1);
  const r = matchedGeometryNull({ observedMean: 0.1, n: 10, drawTrade, k: 20, seed: 1 });
  assert.ok(r.usableTradeFraction < 1 && r.usableTradeFraction > 0.5, `got ${r.usableTradeFraction}`);
  assert.equal(r.usableDrawFraction, 1, "retries recovered every draw here");
});

test("a null that can never produce a usable trade reports zero draws rather than pretending", () => {
  const r = matchedGeometryNull({ observedMean: 1, n: 5, drawTrade: () => null, k: 10, seed: 1 });
  assert.equal(r.draws, 0);
  assert.equal(r.usableDrawFraction, 0);
  assert.equal(r.p, 1, "no evidence must not read as significant");
});

test("matchedGeometryNull validates its inputs", () => {
  const ok = { observedMean: 1, n: 5, drawTrade: () => 1, k: 10 };
  assert.throws(() => matchedGeometryNull({ ...ok, observedMean: NaN }), /observedMean/);
  assert.throws(() => matchedGeometryNull({ ...ok, n: 0 }), /n must be/);
  assert.throws(() => matchedGeometryNull({ ...ok, drawTrade: null }), /drawTrade/);
  assert.throws(() => matchedGeometryNull({ ...ok, k: -1 }), /k must be/);
});

// ---------- baseline controls ----------

test("the always-flat control is n zeros, and says so", () => {
  const c = alwaysFlatControl(3);
  assert.equal(c.control, "always-flat");
  assert.deepEqual(c.values, [0, 0, 0]);
  assert.equal(c.mean, 0);
  assert.equal(c.total, 0);
  assert.deepEqual(alwaysFlatControl(0).values, []);
  assert.throws(() => alwaysFlatControl(-1), /non-negative/);
  assert.throws(() => alwaysFlatControl(1.5), /integer/);
});

test("buy-and-hold is scored in R against a supplied risk unit, with one round trip of cost", () => {
  const candles = [{ close: 100 }, { close: 150 }, { close: 200 }];
  const c = buyAndHoldControl(candles, { riskPerUnit: 10, feeRate: 0.008, slipPct: 0.0005 });
  assert.equal(c.grossR, 10, "(200 - 100) / 10");
  assert.equal(c.feeR, (0.008 * 300) / 10);
  assert.equal(c.slippageR, (0.0005 * 300) / 10);
  assert.ok(Math.abs(c.netR - (10 - c.feeR - c.slippageR)) < 1e-12);
  assert.equal(c.returnPct, 1);
  assert.equal(c.bars, 3);
});

test("buy-and-hold ignores the path between its endpoints", () => {
  const straight = buyAndHoldControl([{ close: 100 }, { close: 120 }], { riskPerUnit: 10 });
  const volatile = buyAndHoldControl(
    [{ close: 100 }, { close: 40 }, { close: 300 }, { close: 120 }], { riskPerUnit: 10 });
  assert.equal(straight.netR, volatile.netR);
});

test("a falling market gives buy-and-hold a negative R, which is the point of the control", () => {
  const c = buyAndHoldControl([{ close: 200 }, { close: 100 }], { riskPerUnit: 20 });
  assert.equal(c.grossR, -5);
  assert.equal(c.netR, -5);
});

test("buyAndHoldControl rejects inputs it cannot score honestly", () => {
  assert.throws(() => buyAndHoldControl([{ close: 100 }], { riskPerUnit: 1 }), /two candles/);
  assert.throws(() => buyAndHoldControl([{ close: 100 }, { close: 1 }], { riskPerUnit: 0 }), /riskPerUnit/);
  assert.throws(() => buyAndHoldControl([{ close: 100 }, { close: "x" }], { riskPerUnit: 1 }), /finite prices/);
});
