import test from "node:test";
import assert from "node:assert/strict";
import { runFundingMeanRevStudy } from "./funding-meanrev.mjs";

test("classifies a funding-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runFundingMeanRevStudy({
    watchlist: ["ZZZFAKE"],
    fetchFunding: async () => { throw new Error("Request failed with status code 451"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "ZZZFAKE");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^funding-fetch-error: Request failed with status code 451$/);
});

test("classifies funding history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortRates = { rates: [{ timestamp: "2026-01-01T00:00:00Z", relativeFundingRate: 0 }, { timestamp: "2026-01-31T00:00:00Z", relativeFundingRate: 0 }] };
  const report = await runFundingMeanRevStudy({
    watchlist: ["ZZZFAKE"],
    minHistoryDays: 365,
    fetchFunding: async () => shortRates,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "funding-history-short (30.0 of 365 days)");
});

test("reports FUNDING-DATA-INSUFFICIENT (not a crash or a silent skip) when too few assets clear the funding-coverage gate", async () => {
  const shortRates = { rates: [{ timestamp: "2026-01-01T00:00:00Z", relativeFundingRate: 0 }] };
  const report = await runFundingMeanRevStudy({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    minEligibleAssets: 8,
    fetchFunding: async () => shortRates,
  });
  assert.equal(report.result.verdict, "FUNDING-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("stops at the train gate and never examines holdout when train fails (gate is immutable once the test begins)", async () => {
  // Long, well-covered funding history but a symbol with no local candles at all — this
  // exercises the "eligible on funding coverage, but zero backtest trades" path, which
  // must land on TRAIN-GATE-FAIL rather than silently reporting a holdout.
  const start = Date.parse("2020-01-01T00:00:00Z");
  const longRates = { rates: Array.from({ length: 400 }, (_, i) => ({ timestamp: new Date(start + i * DAY()).toISOString(), relativeFundingRate: -0.0002 })) };
  const watchlist = Array.from({ length: 8 }, (_, i) => `ZZZFAKE${i}`);
  const report = await runFundingMeanRevStudy({
    watchlist, minEligibleAssets: 8,
    fetchFunding: async () => longRates,
  });
  assert.notEqual(report.result.verdict, "FUNDING-DATA-INSUFFICIENT");
  assert.equal(report.result.trainGate.passed, false);
  assert.equal(report.result.holdout, null);
  assert.match(report.result.verdict, /^TRAIN-GATE-FAIL/);
});

function DAY() { return 86400_000; }
