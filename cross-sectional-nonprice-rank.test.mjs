import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runCrossSectionalNonPriceRank } from "./cross-sectional-nonprice-rank.mjs";

// Tests below that build a full cross-sectional panel need real local candle history for BTC
// (the hardcoded regime/calendar factor asset) plus several other active-watchlist symbols —
// this project's established test convention of real candles + a synthetic external-data
// fetch mock (see long-short-ratio-contrarian.test.mjs / oi-trend-gate.test.mjs).
const HAS_BTC_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));
const REAL_MULTI_ASSET_WATCHLIST = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "LTC", "ATOM", "BCH"];
const NOW = Math.floor(Date.now() / 1000);
const SINCE = NOW - 900 * 86400;
const DAY = 86400;

function flatOiPoints() {
  return Array.from({ length: 900 }, (_, i) => ({ timestamp: SINCE + i * DAY, value: ["100", "100", "100", "100"] }));
}

function varyingOiPoints(symbol) {
  const phase = [...symbol].reduce((s, c) => s + c.charCodeAt(0), 0);
  return Array.from({ length: 900 }, (_, i) => ({
    timestamp: SINCE + i * DAY,
    value: ["0", "0", "0", String(100 + 20 * Math.sin((i + phase) / 6))],
  }));
}

test("reports OI-DATA-INSUFFICIENT when BTC (the calendar/regime factor) is not in the watchlist", async () => {
  const report = await runCrossSectionalNonPriceRank({
    watchlist: ["ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "LTC", "ATOM"],
    fetchOi: async () => ({ normalized: { points: flatOiPoints() } }),
  });
  assert.equal(report.result.verdict, "OI-DATA-INSUFFICIENT");
  assert.match(report.result.reason, /BTC/);
});

test("reports OI-DATA-INSUFFICIENT when fewer than minAssets clear coverage, never crashing", async () => {
  const report = await runCrossSectionalNonPriceRank({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchOi: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "OI-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies an OI-fetch failure precisely instead of silently dropping the asset", async (t) => {
  if (!HAS_BTC_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runCrossSectionalNonPriceRank({
    watchlist: ["BTC", "ETH"],
    fetchOi: async ({ symbol }) => {
      if (symbol === "PF_ETHUSD") throw new Error("Request failed with status code 500");
      return { normalized: { points: flatOiPoints() } };
    },
  });
  const eth = report.input.coverage.find((c) => c.symbol === "ETH");
  assert.equal(eth.included, false);
  assert.match(eth.reason, /^oi-fetch-error: Request failed with status code 500$/);
});

test("classifies OI history shorter than minHistoryDays precisely, reporting the actual coverage", async (t) => {
  if (!HAS_BTC_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const shortPoints = [{ timestamp: SINCE, value: ["1", "1", "1", "1"] }, { timestamp: SINCE + 30 * DAY, value: ["1", "1", "1", "1"] }];
  const report = await runCrossSectionalNonPriceRank({
    watchlist: ["BTC", "ETH"],
    fetchOi: async ({ symbol }) => symbol === "PF_ETHUSD" ? { normalized: { points: shortPoints } } : { normalized: { points: flatOiPoints() } },
  });
  const eth = report.input.coverage.find((c) => c.symbol === "ETH");
  assert.equal(eth.included, false);
  assert.equal(eth.reason, "oi-history-short (30.0 of 500 days)");
});

test("handles perfectly flat (zero-variance) OI across the whole universe gracefully: null IC, no crash, KILLED at train-significance stage", async (t) => {
  if (!HAS_BTC_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runCrossSectionalNonPriceRank({
    watchlist: REAL_MULTI_ASSET_WATCHLIST,
    fetchOi: async () => ({ normalized: { points: flatOiPoints() } }),
  });
  assert.equal(report.input.eligibleAssets.length, REAL_MULTI_ASSET_WATCHLIST.length);
  assert.equal(report.result.trainScore.meanIC, null);
  assert.equal(report.result.trainScore.p, null);
  assert.equal(report.result.naiveSignificant, false);
  assert.equal(report.result.stage, "train-significance");
  assert.match(report.result.verdict, /^CROSS-SECTIONAL-NONPRICE-RANK KILLED at train-significance stage/);
});

test("builds a real cross-sectional panel from real candles + varying synthetic OI and returns a well-formed, non-crashing report", async (t) => {
  if (!HAS_BTC_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runCrossSectionalNonPriceRank({
    watchlist: REAL_MULTI_ASSET_WATCHLIST,
    fetchOi: async ({ symbol }) => ({ normalized: { points: varyingOiPoints(symbol) } }),
  });
  assert.equal(report.input.eligibleAssets.length, REAL_MULTI_ASSET_WATCHLIST.length);
  assert.ok(report.input.rebalanceDates > 0);
  assert.ok(["train-significance", "holdout-economics"].includes(report.result.stage));
  assert.ok(typeof report.result.verdict === "string" && report.result.verdict.startsWith("CROSS-SECTIONAL-NONPRICE-RANK"));
  // The NHST family must include all 9 pre-existing entries plus exactly this study's own —
  // this is the multiple-comparisons discipline AGENT_PROTOCOL.md requires (add, don't
  // re-derive; recompute BH-FDR across the whole family).
  assert.equal(report.result.nhstFamily.length, 10);
  assert.equal(report.result.nhstFamily.at(-1).study, "CROSS-SECTIONAL-NONPRICE-RANK (train, OI-change primary IC)");
  assert.ok(report.result.nhstFamily.every((r) => Number.isFinite(r.q)));
  // Economics must always be computed and reported, even when the train-significance gate
  // fails first, so a reader can see the (non-decisive) economics disclosure either way.
  assert.ok(report.result.trainEconomics.topN[5]);
  assert.ok(report.result.holdoutEconomics.topN[5]);
});

test("excludes SEALED_SYMBOLS from the ranking universe even when present in the input watchlist", async (t) => {
  if (!HAS_BTC_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const withSealed = [...REAL_MULTI_ASSET_WATCHLIST, "AVAX", "LINK"];
  const report = await runCrossSectionalNonPriceRank({
    watchlist: withSealed,
    fetchOi: async ({ symbol }) => ({ normalized: { points: varyingOiPoints(symbol) } }),
  });
  assert.ok(!report.input.eligibleAssets.includes("AVAX"));
  assert.ok(!report.input.eligibleAssets.includes("LINK"));
  assert.equal(report.input.eligibleAssets.length, REAL_MULTI_ASSET_WATCHLIST.length);
});
