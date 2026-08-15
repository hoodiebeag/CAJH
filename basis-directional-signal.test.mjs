import test from "node:test";
import assert from "node:assert/strict";
import { runFuturesBasisDirectionalSignal } from "./basis-directional-signal.mjs";

test("classifies an asset with no local candles as insufficient-candle-history, never calling fetchBasis", async () => {
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["ZZZFAKE"],
    fetchBasis: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "BASIS-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("classifies a basis-fetch failure precisely instead of silently dropping the asset", async () => {
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["XBT"],
    fetchBasis: async () => { throw new Error("Request failed with status code 500"); },
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].symbol, "XBT");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^basis-fetch-error: Request failed with status code 500$/);
});

test("classifies basis history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortAnalytics = { normalized: { points: [{ timestamp: 0, value: { basis: "0.0001" } }, { timestamp: 30 * 86400, value: { basis: "0.0001" } }] } };
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchBasis: async () => shortAnalytics,
  });
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "basis-history-short (30.0 of 500 days)");
});

test("reports BASIS-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["ZZZFAKE1", "ZZZFAKE2"],
    fetchBasis: async () => { throw new Error("should not be called"); },
  });
  assert.equal(report.result.verdict, "BASIS-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

test("includes an asset once candles and basis coverage both clear the gate, and scores both families' gates honestly on zero-signal (flat basis) data", async () => {
  const longPoints = Array.from({ length: 900 }, (_, i) => ({ timestamp: i * 86400, value: { basis: "0.0001" } }));
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchBasis: async () => ({ normalized: { points: longPoints } }),
  });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  // Flat basis (every value identical) never satisfies current > trailing average, so the
  // gate should never fire an entry and both families should honestly report zero trades.
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.equal(f.holdout.trades, 0);
    assert.equal(f.gate.tradesPass, false);
    assert.equal(f.gate.passed, false);
  }
});

test("parses the { basis } object value shape and ignores points with a non-finite basis", async () => {
  const points = [
    { timestamp: 0, value: { basis: "not-a-number" } },
    ...Array.from({ length: 900 }, (_, i) => ({ timestamp: (i + 1) * 86400, value: { basis: "0.0001" } })),
  ];
  const report = await runFuturesBasisDirectionalSignal({
    watchlist: ["XBT"],
    minHistoryDays: 500,
    fetchBasis: async () => ({ normalized: { points } }),
  });
  assert.equal(report.input.coverage[0].included, true);
});
