import test from "node:test";
import assert from "node:assert/strict";
import { runFundingGateH11 } from "./funding-gate-h11.mjs";

test("classifies an asset with no local candles as insufficient-candle-history", async () => {
  const report = await runFundingGateH11({ watchlist: ["ZZZFAKE"], fetchFunding: async () => { throw new Error("should not be called"); } });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.input.eligibleAssets.length, 0);
  assert.match(report.result.verdict, /unavailable/);
});

test("classifies a funding-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runFundingGateH11({
    watchlist: ["XBT"],
    fetchFunding: async () => { const err = new Error("Request failed with status code 451"); throw err; },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^funding-fetch-error: Request failed with status code 451$/);
  assert.equal(report.input.eligibleAssets.length, 0);
});

test("classifies funding history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortPoints = { points: [{ time: 0, rate: 0 }, { time: 30 * 86400_000, rate: 0 }] };
  const report = await runFundingGateH11({
    watchlist: ["XBT"],
    minHistoryDays: 730,
    fetchFunding: async () => shortPoints,
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "funding-history-short (30.0 of 730 days)");
});

test("includes an asset once candles and funding coverage both clear the gate (no regression vs prior behavior)", async () => {
  const start = 0, end = 800 * 86400_000;
  const longPoints = { points: Array.from({ length: 900 }, (_, i) => ({ time: start + i * 86400_000, rate: -0.0002 })) };
  const report = await runFundingGateH11({
    watchlist: ["XBT"],
    minHistoryDays: 730,
    fetchFunding: async () => longPoints,
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "XBT", included: true });
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.equal(report.result.perAsset.length, 1);
});
