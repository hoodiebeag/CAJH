import test from "node:test";
import assert from "node:assert/strict";
import {
  blockBootstrapCI,
  buildMomentumPanel,
  dateVectorPermutationP,
  effectiveN,
  perDateIC,
  ranks,
  scoreMomentumPanelRows,
  spearman,
  permutationP,
  bootstrapCI
} from "./momentum.mjs";

const day = 86400;
const candle = (offset, close) => ({ time: Date.UTC(2025, 0, 1) / 1000 + offset * day, open: close, high: close, low: close, close, volume: 1 });
const linearSeries = (days, start, slope = 1) => Array.from({ length: days }, (_, i) => candle(i, start + i * slope));

test("buildMomentumPanel emits tidy weekly L=30/H=7 rows with strictly future returns", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const series = new Map(assets.map((asset, i) => [asset, linearSeries(45, 100 + i * 10, 1)]));
  const { rows, q1Only } = buildMomentumPanel(series, { universe: assets });

  assert.equal(q1Only.length, 0);
  assert.equal(rows.length, 16);
  assert.deepEqual([...new Set(rows.map((r) => r.date))], ["2025-01-31", "2025-02-07"]);
  assert.deepEqual(Object.keys(rows[0]), ["date", "asset", "trailR", "fwdR"]);
  assert.deepEqual(rows[0], {
    date: "2025-01-31",
    asset: "BTC",
    trailR: 130 / 100 - 1,
    fwdR: 137 / 130 - 1
  });
});

test("buildMomentumPanel requires eight valid assets on a date", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const series = new Map(assets.map((asset, i) => [asset, linearSeries(45, 100 + i * 10, 1)]));
  series.set("LINK", linearSeries(37, 170, 1));

  const { rows } = buildMomentumPanel(series, { universe: assets });

  assert.equal(rows.length, 0);
});

test("buildMomentumPanel separates Q1-only rows from reusable research rows", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const q1Start = Date.UTC(2026, 0, 1) / 1000;
  const series = new Map(assets.map((asset, i) => [
    asset,
    Array.from({ length: 45 }, (_, d) => ({ ...candle(d, 200 + i * 10 + d), time: q1Start + d * day }))
  ]));

  const { rows, q1Only } = buildMomentumPanel(series, { universe: assets });

  assert.equal(rows.length, 0);
  assert.equal(q1Only.length, 16);
  assert.deepEqual([...new Set(q1Only.map((r) => r.date))], ["2026-01-31", "2026-02-07"]);
});

test("perDateIC computes one Spearman IC per rebalance date", () => {
  const rows = [
    { date: "2025-01-01", asset: "A", trailR: 1, fwdR: 10 },
    { date: "2025-01-01", asset: "B", trailR: 2, fwdR: 20 },
    { date: "2025-01-01", asset: "C", trailR: 3, fwdR: 30 },
    { date: "2025-01-02", asset: "A", trailR: 1, fwdR: 30 },
    { date: "2025-01-02", asset: "B", trailR: 2, fwdR: 20 },
    { date: "2025-01-02", asset: "C", trailR: 3, fwdR: 10 }
  ];

  assert.deepEqual(perDateIC(rows, { minAssets: 3 }).map(({ date, nAssets, ic }) => ({ date, nAssets, ic })), [
    { date: "2025-01-01", nAssets: 3, ic: 1 },
    { date: "2025-01-02", nAssets: 3, ic: -1 }
  ]);
});

test("scoreMomentumPanelRows reports mean IC, effective N, block CI, and deterministic date-vector null", () => {
  const rows = [];
  for (const [date, forward] of [
    ["2025-01-01", [1, 2, 3, 4]],
    ["2025-01-08", [4, 3, 2, 1]],
    ["2025-01-15", [1, 3, 2, 4]]
  ]) {
    for (let i = 0; i < 4; i++) rows.push({ date, asset: `A${i}`, trailR: i + 1, fwdR: forward[i] });
  }

  const score = scoreMomentumPanelRows(rows, { minAssets: 4, permutations: 20, bootstrapIterations: 20, blockSize: 2, seed: 7 });

  assert.equal(score.nDates, 3);
  assert.equal(score.nRows, 12);
  assert.equal(score.meanIC, (1 - 1 + 0.8) / 3);
  assert.equal(score.effectiveN, effectiveN([1, -1, 0.8]));
  assert.deepEqual(score.ci95, blockBootstrapCI([1, -1, 0.8], { iterations: 20, blockSize: 2, seed: 8 }));
  assert.equal(score.p, dateVectorPermutationP(perDateIC(rows, { minAssets: 4 }), { iterations: 20, seed: 7 }));
  assert.deepEqual(score.perDate.map((p) => p.ic), [1, -1, 0.8]);
});

test("rank correlation identifies a planted monotonic cross-section", () => {
  assert.deepEqual(ranks([3, 1, 1, 2]), [4, 1.5, 1.5, 3]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
});

test("permutation and bootstrap preserve an obvious positive IC", () => {
  const panels = Array.from({ length: 12 }, (_, n) => {
    const values = [1, 2, 3, 4].map((_, i) => (i + n) % 4);
    return { signal: values, forward: values, ic: 1 };
  });
  assert.ok(permutationP(panels, 200) < .05);
  const [lo, hi] = bootstrapCI(panels.map((p) => p.ic), 200);
  assert.equal(lo, 1); assert.equal(hi, 1);
});
