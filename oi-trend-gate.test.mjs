import test from "node:test";
import assert from "node:assert/strict";
import { runOpenInterestTrendConfirmation } from "./oi-trend-gate.mjs";

test("classifies an asset with no local candles as insufficient-candle-history, never calling fetchOi", async () => {
  const report = await runOpenInterestTrendConfirmation({
    watchlist: ["ZZZFAKE"],
    fetchOi: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "OI-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies an OI-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runOpenInterestTrendConfirmation({
    watchlist: ["XBT"],
    fetchOi: async () => { throw new Error("Request failed with status code 500"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^oi-fetch-error: Request failed with status code 500$/);
});

test("classifies OI history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortAnalytics = { normalized: { points: [{ timestamp: 0, value: ["1", "1", "1", "1"] }, { timestamp: 30 * 86400, value: ["1", "1", "1", "1"] }] } };
  const report = await runOpenInterestTrendConfirmation({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchOi: async () => shortAnalytics,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "oi-history-short (30.0 of 500 days)");
});

test("reports OI-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runOpenInterestTrendConfirmation({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchOi: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "OI-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

test("includes an asset once candles and OI coverage both clear the gate, and scores both families' gates honestly on zero-signal data", async () => {
  const longPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: i * 86400, value: ["100", "100", "100", "100"] }));
  const report = await runOpenInterestTrendConfirmation({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchOi: async () => ({ normalized: { points: longPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  // Flat OI (every close identical) never satisfies current > trailing average, so the
  // gate should never fire an entry and both families should honestly report zero trades.
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.equal(f.holdout.trades, 0);
    assert.equal(f.gate.tradesPass, false);
    assert.equal(f.gate.passed, false);
  }
});
