import test from "node:test";
import assert from "node:assert/strict";
import { runRollingVolatilityRegimeTiming } from "./rolling-volatility-regime-timing.mjs";

test("classifies an asset with no local candles as insufficient-candle-history, never calling fetchVol", async () => {
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["ZZZFAKE"],
    fetchVol: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "VOLREGIME-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a vol fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    fetchVol: async () => { throw new Error("Request failed with status code 500"); },
  });
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^vol-fetch-error: Request failed with status code 500$/);
});

test("reports VOLREGIME-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchVol: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "VOLREGIME-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

// Real local candle history only covers recent (2024+) time — synthetic points must overlap
// that real window, not an arbitrary 1970-epoch-based range, or the windowed candle split
// silently produces zero candles regardless of what the gate does.
const NOW = Math.floor(Date.now() / 1000);
const RECENT_SINCE = NOW - 900 * 86400;

test("classifies vol history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortPoints = [{ timestamp: RECENT_SINCE, value: "20" }, { timestamp: RECENT_SINCE + 30 * 86400, value: "20" }];
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchVol: async () => ({ normalized: { points: shortPoints } }),
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "vol-history-short (30.0 of 500 days)");
});

test("parses non-finite points defensively, ignoring them rather than crashing", async () => {
  const points = [
    { timestamp: RECENT_SINCE, value: "not-a-number" },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + (i + 1) * 86400, value: "20" })),
  ];
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchVol: async () => ({ normalized: { points } }),
  });
  assert.equal(report.input.coverage[0].included, true);
});

test("includes an asset once candles and vol coverage both clear the gate, and scores both directions' gates honestly on a flat (never-expanding, never-contracting) series", async () => {
  const flatPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "20" }));
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchVol: async () => ({ normalized: { points: flatPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  // Flat vol (every value identical) never satisfies current > trailing average NOR current <
  // trailing average, so BOTH directions' gates should never fire an entry.
  for (const family of ["breakout", "anticipate"]) {
    for (const direction of ["expanding", "contracting"]) {
      const r = report.result.families[family].regimes[direction];
      assert.equal(r.holdout.trades, 0, `${family}/${direction} should have zero holdout trades on a flat series`);
      assert.equal(r.gate.tradesPass, false);
      assert.equal(r.gate.passed, false);
    }
  }
});

test("expanding and contracting directions are mutually exclusive on a monotonically rising series (never both fire at the same instant)", async () => {
  const risingPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: String(10 + i * 0.05) }));
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchVol: async () => ({ normalized: { points: risingPoints } }),
  });
  // A steadily rising series should sit above its own trailing average for most of the
  // series (expanding regime dominant) and essentially never below it (contracting regime
  // near-zero trades) once past the N=7 warmup — the two directions should not both trade
  // freely on the same monotonic series.
  for (const family of ["breakout", "anticipate"]) {
    const expanding = report.result.families[family].regimes.expanding;
    const contracting = report.result.families[family].regimes.contracting;
    assert.ok(expanding.holdout.trades > 0, `${family}/expanding should trade on a monotonically rising vol series`);
    assert.ok(expanding.holdout.trades > contracting.holdout.trades, `${family}: expanding should dominate contracting on a monotonically rising series`);
  }
});

test("both directions are independently gated (no train-based selection) — regimes object always reports both, even when one has zero trades", async () => {
  const flatPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: RECENT_SINCE + i * 86400, value: "20" }));
  const report = await runRollingVolatilityRegimeTiming({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchVol: async () => ({ normalized: { points: flatPoints } }),
  });
  for (const family of ["breakout", "anticipate"]) {
    const regimes = report.result.families[family].regimes;
    assert.deepEqual(Object.keys(regimes).sort(), ["contracting", "expanding"]);
    for (const direction of ["expanding", "contracting"]) {
      assert.ok(regimes[direction].train, `${family}/${direction} train should always be computed`);
      assert.ok(regimes[direction].holdout, `${family}/${direction} holdout should always be computed (no selection step to skip it)`);
      assert.ok(regimes[direction].gate, `${family}/${direction} gate should always be evaluated`);
    }
  }
});
