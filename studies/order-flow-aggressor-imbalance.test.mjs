import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runOrderFlowAggressorImbalance } from "./order-flow-aggressor-imbalance.mjs";

// Tests below that use watchlist ["XBT"] need real local candle history to clear the
// candle-coverage gate before they can exercise orderflow-specific classification logic.
const HAS_XBT_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));

test("classifies an asset with no local candles as insufficient-candle-history, never calling either fetch", async () => {
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["ZZZFAKE"],
    fetchCvd: async () => { throw new Error("should not be called"); },
    fetchAgg: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "ORDERFLOW-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a cvd fetch failure precisely instead of silently dropping the asset", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    fetchCvd: async () => { throw new Error("Request failed with status code 500"); },
    fetchAgg: async () => ({ normalized: { points: [] } }),
  });
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^orderflow-fetch-error: Request failed with status code 500$/);
});

test("reports ORDERFLOW-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchCvd: async () => { throw new Error("should not be called"); },
    fetchAgg: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "ORDERFLOW-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

// Real local candle history only covers recent (2024+) time — synthetic points must overlap
// that real window, not an arbitrary 1970-epoch-based range, or the windowed candle split
// silently produces zero candles regardless of what the gate does.
const NOW = Math.floor(Date.now() / 1000);
const RECENT_SINCE = NOW - 900 * 86400;

test("classifies orderflow history shorter than minHistoryDays precisely, reporting the actual intersected coverage", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const shortAgg = { normalized: { points: [{ timestamp: RECENT_SINCE, value: "-0.05" }, { timestamp: RECENT_SINCE + 30 * 86400, value: "-0.05" }] } };
  const shortCvd = { normalized: { points: [{ timestamp: RECENT_SINCE, value: { buy_volume: "1.1", sell_volume: "1.0" } }, { timestamp: RECENT_SINCE + 30 * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } }] } };
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => shortCvd,
    fetchAgg: async () => shortAgg,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "orderflow-history-short (30.0 of 500 days)");
});

test("restricts coverage to the INTERSECTION of both formulations' windows, not either series' own full window", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  // aggressor-differential covers the full 900 days; cvd covers only the first 400 — the
  // intersection (400 days) should gate coverage, not periodic's own longer 900-day window.
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "-0.05" }));
  const cvdPoints = Array.from({ length: 400 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } }));
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "orderflow-history-short (399.0 of 500 days)");
});

test("computes the periodic formulation's train threshold as the 80th percentile of its own train-window netBuyPressure, sign-corrected from Kraken's raw sell-minus-buy convention", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  // Raw aggressor-differential is -0.05 throughout (Kraken's sell-minus-buy convention,
  // verified against the real API), so netBuyPressure = -(-0.05) = +0.05 constant, and its
  // own 80th percentile over a constant train series equals that same constant.
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "-0.05" }));
  const cvdPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } }));
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.ok(Math.abs(report.input.coverage[0].trainThreshold - 0.05) < 1e-9, `expected trainThreshold ~0.05, got ${report.input.coverage[0].trainThreshold}`);
  assert.equal(report.input.eligibleAssets.length, 1);
});

test("parses raw non-finite points defensively (both series), ignoring them rather than crashing", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const aggPoints = [
    { timestamp: RECENT_SINCE, value: "not-a-number" },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + (i + 1) * 86400, value: "-0.05" })),
  ];
  const cvdPoints = [
    { timestamp: RECENT_SINCE, value: { buy_volume: "nope", sell_volume: "1.0" } },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + (i + 1) * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } })),
  ];
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
});

test("both candidates trade freely under a flat, never-blocking configuration for the breakout/anticipate families", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  // Constant positive netBuyPressure (periodic gate fires from its first revealed point on)
  // and constant positive buy-minus-sell diff (cumulative rises monotonically, so it sits
  // above its own trailing average throughout once warmed up) — neither formulation should
  // meaningfully restrict entries once both are past their own brief warmup.
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "-0.05" }));
  const cvdPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } }));
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    for (const c of f.candidates) assert.ok(c.train.trades > 0, `${family}/${c.candidateKey} should trade freely, got ${c.train.trades} train trades`);
  }
});

test("selects the best-on-train candidate per family (highest train avgR among those with trades) and evaluates holdout only for that selection", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  // Periodic netBuyPressure rises monotonically from -1 to +1 across the full series, so its
  // train-only 80th-percentile threshold sits near the top of the TRAIN range — the gate opens
  // only in the last slice of train time, sharply restricting periodic's own train trade count
  // relative to cumulative's steadily-rising (always-unblocked-after-warmup) gate.
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: String(-((i / 899) * 2 - 1)) }));
  const cvdPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { buy_volume: "1.1", sell_volume: "1.0" } }));
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    const withTrades = f.candidates.filter((c) => c.train.trades > 0);
    if (!withTrades.length) {
      assert.equal(f.gate, null, `${family}: expected null gate when no candidate produced a train trade`);
      continue;
    }
    const expectedBest = withTrades.reduce((a, c) => (c.train.avgR > a.train.avgR ? c : a));
    assert.equal(f.selected, expectedBest.candidateKey, `${family}: selection should match the highest train-avgR candidate among those with trades`);
    assert.deepEqual(f.train, expectedBest.train, `${family}: reported train stats should be the selected candidate's own train summary`);
    assert.ok(f.holdout, `${family}: holdout should be computed once a candidate is selected`);
    assert.ok(f.gate, `${family}: gate should be evaluated once a candidate is selected`);
  }
});

test("selects periodic deterministically when cumulative's own gate mathematically can never open (flat zero diff: 0 is never > its own 0 trailing average)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const aggPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "-0.05" })); // netBuyPressure flat +0.05, proven to trade freely above
  const cvdPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: { buy_volume: "1.0", sell_volume: "1.0" } })); // diff=0 constant, cumulative stays 0 forever
  const report = await runOrderFlowAggressorImbalance({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchCvd: async () => ({ normalized: { points: cvdPoints } }),
    fetchAgg: async () => ({ normalized: { points: aggPoints } }),
  });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    const cumulative = f.candidates.find((c) => c.candidateKey === "cumulative");
    assert.equal(cumulative.train.trades, 0, `${family}: a flat-zero order-flow diff can never exceed its own zero trailing average, so cumulative must produce zero train trades`);
    assert.equal(f.selected, "periodic", `${family}: periodic is the only candidate with train trades, so it must be selected`);
    assert.ok(f.holdout, `${family}: holdout should still be computed for the selected periodic candidate`);
  }
});
