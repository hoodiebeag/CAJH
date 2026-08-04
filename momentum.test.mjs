import test from "node:test";
import assert from "node:assert/strict";
import { buildMomentumPanel, ranks, spearman, permutationP, bootstrapCI } from "./momentum.mjs";

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
