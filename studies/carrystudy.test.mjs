import test from "node:test";
import assert from "node:assert/strict";
import { runFundingCarryDecayCheck } from "./carrystudy.mjs";

const iso = (ms) => new Date(ms).toISOString();
const H = 3600_000;

function hourlyRates(startMs, count, rate) {
  return Array.from({ length: count }, (_, i) => ({ timestamp: iso(startMs + i * H), relativeFundingRate: rate }));
}

test("classifies a funding-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runFundingCarryDecayCheck({
    watchlist: ["ZZZFAKE"],
    fetchFunding: async () => { throw new Error("Request failed with status code 451"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^funding-fetch-error: Request failed with status code 451$/);
});

test("classifies an asset with no funding rows as no-funding-data", async () => {
  const report = await runFundingCarryDecayCheck({ watchlist: ["ZZZFAKE"], fetchFunding: async () => ({ rates: [] }) });
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", perp: "PF_ZZZFAKEUSD", included: false, reason: "no-funding-data" });
});

test("BTC maps to the PF_XBTUSD futures symbol, not PF_BTCUSD", async () => {
  let requested = null;
  await runFundingCarryDecayCheck({ watchlist: ["BTC"], fetchFunding: async ({ symbol }) => { requested = symbol; return { rates: [] }; } });
  assert.equal(requested, "PF_XBTUSD");
});

test("only the recent window is populated when all data postdates the reproduction window, and reports coverage for both", async () => {
  const start = Date.parse("2025-08-13T08:00:00Z");
  const rates = hourlyRates(start, 24 * 30, 0.0001); // 30 days, well past the 20-day floor
  const report = await runFundingCarryDecayCheck({
    watchlist: ["XBT"],
    reproStart: Date.parse("2020-01-01T00:00:00Z"),
    reproEnd: Date.parse("2025-01-01T00:00:00Z"),
    recentStart: Date.parse("2025-01-01T00:00:00Z"),
    recentEnd: start + 24 * 30 * H,
    fetchFunding: async () => ({ rates }),
  });
  assert.equal(report.input.coverage[0].reproIntervals, 0);
  assert.equal(report.input.coverage[0].recentIntervals, 24 * 30);
  assert.equal(report.result.reproduction.assetsIncluded, 0);
  assert.equal(report.result.reproduction.portfolio.intervals, 0);
  assert.equal(report.result.recent.assetsIncluded, 1);
  assert.equal(report.result.recent.portfolio.intervals, 24 * 30);
  assert.ok(Math.abs(report.result.recent.portfolio.meanIntervalReturn - 0.0001) < 1e-12);
  assert.ok(report.result.recent.portfolio.annualizedReturn > 0.8 && report.result.recent.portfolio.annualizedReturn < 0.9); // 0.0001 * 8760 = 0.876
});

test("an asset below minIntervalsPerAsset is excluded from the pooled series but still reported in coverage", async () => {
  const start = Date.parse("2025-06-01T00:00:00Z");
  const rates = hourlyRates(start, 5, 0.0002); // far short of the 20-day floor
  const report = await runFundingCarryDecayCheck({
    watchlist: ["XBT"],
    recentStart: Date.parse("2025-01-01T00:00:00Z"),
    recentEnd: start + 24 * H,
    minIntervalsPerAsset: 24 * 20,
    fetchFunding: async () => ({ rates }),
  });
  assert.equal(report.input.coverage[0].recentIntervals, 5);
  assert.equal(report.result.recent.assetsIncluded, 0);
  assert.equal(report.result.recent.portfolio.intervals, 0);
});

test("pools two assets by timestamp into an equal-weighted portfolio series", async () => {
  const start = Date.parse("2025-06-01T00:00:00Z");
  const n = 24 * 25;
  const ratesA = hourlyRates(start, n, 0.0002);
  const ratesB = hourlyRates(start, n, 0.0000);
  const report = await runFundingCarryDecayCheck({
    watchlist: ["AAA", "BBB"],
    recentStart: Date.parse("2025-01-01T00:00:00Z"),
    recentEnd: start + n * H,
    minIntervalsPerAsset: 24 * 20,
    fetchFunding: async ({ symbol }) => ({ rates: symbol === "PF_AAAUSD" ? ratesA : ratesB }),
  });
  assert.equal(report.result.recent.assetsIncluded, 2);
  assert.equal(report.result.recent.portfolio.intervals, n);
  assert.ok(Math.abs(report.result.recent.portfolio.meanIntervalReturn - 0.0001) < 1e-12); // average of 0.0002 and 0.0000
});
