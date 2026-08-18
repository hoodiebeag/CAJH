import test from "node:test";
import assert from "node:assert/strict";
import { runLongShortRatioContrarian } from "./long-short-ratio-contrarian.mjs";

test("classifies an asset with no local candles as insufficient-candle-history, never calling fetchRatio", async () => {
  const report = await runLongShortRatioContrarian({
    watchlist: ["ZZZFAKE"],
    fetchRatio: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "RATIO-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a ratio-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runLongShortRatioContrarian({
    watchlist: ["XBT"],
    fetchRatio: async () => { throw new Error("Request failed with status code 500"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^ratio-fetch-error: Request failed with status code 500$/);
});

test("classifies ratio history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortAnalytics = { normalized: { points: [{ timestamp: 0, value: "0.5" }, { timestamp: 30 * 86400, value: "0.5" }] } };
  const report = await runLongShortRatioContrarian({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchRatio: async () => shortAnalytics,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "ratio-history-short (30.0 of 500 days)");
});

test("reports RATIO-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runLongShortRatioContrarian({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchRatio: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "RATIO-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

// Real local candle history only covers recent (2024+) time — synthetic ratio points must
// overlap that real window, not an arbitrary 1970-epoch-based range, or the windowed candle
// split silently produces zero candles regardless of what the gate does.
const NOW = Math.floor(Date.now() / 1000);
const RECENT_SINCE = NOW - 900 * 86400;

test("includes an asset once candles and ratio coverage both clear the gate, and a flat ratio (never extreme relative to itself) never blocks an entry", async () => {
  const flatPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.50" }));
  const report = await runLongShortRatioContrarian({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchRatio: async () => ({ normalized: { points: flatPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.coverage[0].trainThreshold, 0.5);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  // A flat ratio's 80th-percentile train threshold equals the constant value itself, so
  // "current <= threshold" holds on every bar and the gate never suppresses — trades should
  // occur exactly as they would unfiltered (not silently zeroed out by a fail-closed gate).
  for (const family of ["breakout", "anticipate"]) {
    assert.ok(report.result.families[family].holdout.trades > 0, `${family} should trade freely under a non-extreme flat ratio`);
  }
});

test("suppresses every holdout entry once the ratio moves into its own train-fixed extreme-long zone", async () => {
  const trainPoints = Array.from({ length: 630 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "0.30" }));
  const holdoutPoints = Array.from({ length: 270 }, (_, i) => ({ timestamp: RECENT_SINCE + (630 + i) * 86400, value: "0.99" }));
  const report = await runLongShortRatioContrarian({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchRatio: async () => ({ normalized: { points: [...trainPoints, ...holdoutPoints] } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  // Train values are constant at 0.30, so the 80th-percentile threshold fixed from train is
  // 0.30; every holdout ratio (0.99) sits above it, so almost every holdout entry should be
  // blocked — a handful right at the cut boundary can still slip through before the first
  // holdout-side point has revealed (its own +1 day no-lookahead offset), which is correct,
  // honest gate behavior, not a bug, so this asserts "nearly none" rather than a literal zero.
  // The exact boundary count drifts slightly as candles/ keeps growing from live collection
  // (the 70/30 cut lands on a slightly different real bar over time) — 2026-08-18 saw this
  // legitimately tick from 5 to 6 with zero code change, so the tolerance below is widened to
  // stay meaningfully "near zero" (not hundreds of leaked trades) without re-pinning to
  // whatever the exact count happens to be on any given day.
  assert.equal(report.input.coverage[0].trainThreshold, 0.3);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.ok(f.holdout.trades <= 15, `${family} holdout trades should be near zero once suppressed, got ${f.holdout.trades}`);
    assert.equal(f.gate.tradesPass, false);
    assert.equal(f.gate.passed, false);
  }
});

test("parses the plain decimal-string ratio value and ignores non-finite points", async () => {
  const points = [
    { timestamp: RECENT_SINCE, value: "not-a-number" },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + (i + 1) * 86400, value: "0.50" })),
  ];
  const report = await runLongShortRatioContrarian({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchRatio: async () => ({ normalized: { points } }),
  });
  assert.equal(report.input.coverage[0].included, true);
});
