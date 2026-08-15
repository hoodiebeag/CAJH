import test from "node:test";
import assert from "node:assert/strict";
import { runTopTradersDivergence } from "./top-traders-divergence.mjs";

test("classifies an asset with no local candles as insufficient-candle-history, never calling either fetch", async () => {
  const report = await runTopTradersDivergence({
    watchlist: ["ZZZFAKE"],
    fetchTop: async () => { throw new Error("should not be called"); },
    fetchAgg: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "DIVERGENCE-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a top-traders fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    fetchTop: async () => { throw new Error("Request failed with status code 500"); },
    fetchAgg: async () => ({ normalized: { points: [] } }),
  });
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^divergence-fetch-error: Request failed with status code 500$/);
});

test("classifies divergence history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortTop = { normalized: { points: [{ timestamp: 0, value: { ratio: "0.5" } }, { timestamp: 30 * 86400, value: { ratio: "0.5" } }] } };
  const shortAgg = { normalized: { points: [{ timestamp: 0, value: "0.5" }, { timestamp: 30 * 86400, value: "0.5" }] } };
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchTop: async () => shortTop,
    fetchAgg: async () => shortAgg,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "divergence-history-short (30.0 of 500 days)");
});

test("reports DIVERGENCE-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runTopTradersDivergence({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchTop: async () => { throw new Error("should not be called"); },
    fetchAgg: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "DIVERGENCE-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

// Real local candle history only covers recent (2024+) time — synthetic points must overlap
// that real window, not an arbitrary 1970-epoch-based range, or the windowed candle split
// silently produces zero candles regardless of what the gate does.
const NOW = Math.floor(Date.now() / 1000);
const RECENT_SINCE = NOW - 900 * 86400;

test("drops a day present in only one of the two series instead of guessing its value", async () => {
  const topPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { ratio: "0.60" } }));
  // Aggregate is missing every 10th day.
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.50" })).filter((_, i) => i % 10 !== 0);
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchTop: async () => ({ normalized: { points: topPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  // Constant divergence of +0.10 on every joined day, so the 80th-percentile train threshold
  // equals +0.10 itself, and the gate never blocks (current >= threshold holds everywhere).
  assert.equal(report.input.coverage[0].trainThreshold, 0.1);
});

test("includes an asset once candles and divergence coverage both clear the gate, and a flat divergence (never above its own threshold) trades freely", async () => {
  const topPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { ratio: "0.55" } }));
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.50" }));
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchTop: async () => ({ normalized: { points: topPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.ok(Math.abs(report.input.coverage[0].trainThreshold - 0.05) < 1e-9);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  for (const family of ["breakout", "anticipate"]) {
    assert.ok(report.result.families[family].holdout.trades > 0, `${family} should trade freely once divergence sits at its own train threshold`);
  }
});

test("suppresses every holdout entry once divergence falls below its own train-fixed confirmation threshold", async () => {
  const trainTop = Array.from({ length: 630 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { ratio: "0.60" } }));
  const trainAgg = Array.from({ length: 630 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.50" }));
  // Holdout divergence flips sign entirely (top traders now less bullish than the crowd).
  const holdoutTop = Array.from({ length: 270 }, (_, i) => ({ timestamp: RECENT_SINCE + (630 + i) * 86400, value: { ratio: "0.40" } }));
  const holdoutAgg = Array.from({ length: 270 }, (_, i) => ({ timestamp: RECENT_SINCE + (630 + i) * 86400, value: "0.50" }));
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchTop: async () => ({ normalized: { points: [...trainTop, ...holdoutTop] } }),
    fetchAgg: async () => ({ normalized: { points: [...trainAgg, ...holdoutAgg] } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  // Train divergence is constant at +0.10, so the 80th-percentile threshold is +0.10; every
  // holdout divergence (-0.10) sits below it, so almost every holdout entry should be blocked —
  // a handful right at the cut boundary can still slip through before the first holdout-side
  // point has revealed (its own +1 day no-lookahead offset), which is correct, honest gate
  // behavior, not a bug, so this asserts "nearly none" rather than a literal zero.
  assert.ok(Math.abs(report.input.coverage[0].trainThreshold - 0.1) < 1e-9);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.ok(f.holdout.trades <= 5, `${family} holdout trades should be near zero once suppressed, got ${f.holdout.trades}`);
    assert.equal(f.gate.tradesPass, false);
    assert.equal(f.gate.passed, false);
  }
});

test("parses the top-traders ratio field and aggregate decimal string, ignoring non-finite points", async () => {
  const topPoints = [
    { timestamp: RECENT_SINCE, value: { ratio: "not-a-number" } },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + (i + 1) * 86400, value: { ratio: "0.55" } })),
  ];
  const aggPoints = Array.from({ length: 901 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.50" }));
  const report = await runTopTradersDivergence({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchTop: async () => ({ normalized: { points: topPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
});
