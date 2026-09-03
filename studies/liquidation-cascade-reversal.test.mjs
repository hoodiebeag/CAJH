import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runLiquidationCascadeReversal } from "./liquidation-cascade-reversal.mjs";

// Tests below that use watchlist ["XBT"] need real local candle history to clear the
// candle-coverage gate before they can exercise liquidation-specific classification logic.
const HAS_XBT_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));

test("classifies an asset with no local candles as insufficient-candle-history, never calling fetchLiq", async () => {
  const report = await runLiquidationCascadeReversal({
    watchlist: ["ZZZFAKE"],
    fetchLiq: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "LIQ-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a liquidation-fetch failure precisely instead of silently dropping the asset", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runLiquidationCascadeReversal({
    watchlist: ["XBT"],
    fetchLiq: async () => { throw new Error("Request failed with status code 500"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^liq-fetch-error: Request failed with status code 500$/);
});

test("classifies liquidation history shorter than minHistoryDays precisely, reporting the actual coverage", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const shortAnalytics = { normalized: { points: [{ timestamp: 0, value: "1" }, { timestamp: 30 * 86400, value: "1" }] } };
  const report = await runLiquidationCascadeReversal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchLiq: async () => shortAnalytics,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "liq-history-short (30.0 of 500 days)");
});

test("reports LIQ-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runLiquidationCascadeReversal({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchLiq: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "LIQ-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.thresholds, []);
});

test("reports a FAIL verdict (not a crash) when zero liquidation volume ever spikes above trailing average", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const flatPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: i * 86400, value: "10" }));
  const report = await runLiquidationCascadeReversal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchLiq: async () => ({ normalized: { points: flatPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.eligibleAssets.length, 1);
  // Flat liquidation volume (every day identical) never satisfies current > multiplier x
  // trailing average for any multiplier > 1, so no candidate should produce a train trade.
  assert.equal(report.result.selected, null);
  assert.match(report.result.verdict, /no candidate multiplier produced a single train trade/);
});

test("scores all three candidate multipliers on train, and only computes holdout when one produced a train trade", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  // Every 10th day is a 100x spike vs. flat-1 elsewhere, opening the gate for the whole
  // following day on every ~10th day — whether that coincides with a real sweep_reclaim
  // trigger on real BTC candle data is not guaranteed (it's event-intersection, not forced),
  // so this asserts the report shape is well-formed either way rather than assuming a trade.
  const points = Array.from({ length: 900 }, (_, i) => ({ timestamp: i * 86400, value: i % 10 === 0 ? "100" : "1" }));
  const report = await runLiquidationCascadeReversal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchLiq: async () => ({ normalized: { points } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.result.thresholds.length, 3);
  if (report.result.selected === null) {
    assert.match(report.result.verdict, /no candidate multiplier produced a single train trade/);
  } else {
    assert.ok(report.result.thresholds.map((t) => t.multiplier).includes(report.result.selected));
    assert.ok(report.result.holdout);
    assert.ok(report.result.gate);
    assert.equal(typeof report.result.gate.passed, "boolean");
  }
});
