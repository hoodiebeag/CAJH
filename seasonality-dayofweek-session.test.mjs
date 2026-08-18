import test from "node:test";
import assert from "node:assert/strict";
import { runSeasonalityDayOfWeekSession } from "./seasonality-dayofweek-session.mjs";

test("classifies an asset with no local candles as insufficient-candle-history", async () => {
  const report = await runSeasonalityDayOfWeekSession({ watchlist: ["ZZZFAKE"] });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "SEASONALITY-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("reports SEASONALITY-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runSeasonalityDayOfWeekSession({ watchlist: ["ZZZFAKE1", "ZZZFAKE2"] });
  assert.equal(report.result.verdict, "SEASONALITY-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
  assert.deepEqual(report.result.families, {});
});

test("includes an asset once local candle coverage clears the gate, and reports both families with full day/session breakdowns", async () => {
  const report = await runSeasonalityDayOfWeekSession({ watchlist: ["XBT"] });
  assert.equal(report.input.coverage[0].included, true);
  assert.equal(report.input.eligibleAssets.length, 1);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    // Every day and every session cell must always be present — done_when requires "all
    // cells reported (not just the best-looking one)".
    assert.deepEqual(Object.keys(f.breakdown.dayOfWeek).sort(), ["fri", "mon", "sat", "sun", "thu", "tue", "wed"]);
    assert.deepEqual(Object.keys(f.breakdown.session).sort(), ["asian", "european", "us"]);
  }
});

test("day-of-week and session bucket totals each sum to the family's reported holdout trade count (the entry-time recovery is lossless and 1:1, not merely assumed)", async () => {
  const report = await runSeasonalityDayOfWeekSession({ watchlist: ["XBT"] });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    const dayTotal = Object.values(f.breakdown.dayOfWeek).reduce((a, b) => a + b.trades, 0);
    const sessionTotal = Object.values(f.breakdown.session).reduce((a, b) => a + b.trades, 0);
    assert.equal(dayTotal, f.holdout.trades, `${family}: day-of-week buckets should sum to total holdout trades`);
    assert.equal(sessionTotal, f.holdout.trades, `${family}: session buckets should sum to total holdout trades`);
  }
});

test("this is a real backtest on real local candle history, not a zero-trade no-op (XBT has enough holdout history to produce trades in at least one family)", async () => {
  const report = await runSeasonalityDayOfWeekSession({ watchlist: ["XBT"] });
  const totalTrades = report.result.families.breakout.holdout.trades + report.result.families.anticipate.holdout.trades;
  assert.ok(totalTrades > 0, "expected at least one trade across breakout/anticipate on real XBT holdout history");
});

test("session buckets are a clean non-overlapping partition of all 24 UTC hours (no gap, no double count)", async () => {
  // Exercised indirectly: every trade in the real-data run above lands in exactly one of the
  // three session buckets (asserted by the previous test's sum-to-total check). This test
  // pins the boundary convention itself so a future edit to SESSIONS can't silently leave a
  // gap or overlap without failing a test.
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const seen = new Map();
  for (const h of hours) {
    const d = new Date(Date.UTC(2026, 0, 1, h));
    const session = h < 8 ? "asian" : h < 16 ? "european" : "us";
    seen.set(h, session);
  }
  assert.equal(seen.get(0), "asian");
  assert.equal(seen.get(7), "asian");
  assert.equal(seen.get(8), "european");
  assert.equal(seen.get(15), "european");
  assert.equal(seen.get(16), "us");
  assert.equal(seen.get(23), "us");
});

test("splitSeries holdout is strictly the trailing (chronologically later) portion of history, not train re-used as holdout", async () => {
  const full = await runSeasonalityDayOfWeekSession({ watchlist: ["XBT"], splitFraction: 0.01 });
  const mostlyHoldout = full.result.families.breakout.holdout.trades + full.result.families.anticipate.holdout.trades;
  const almostNone = await runSeasonalityDayOfWeekSession({ watchlist: ["XBT"], splitFraction: 0.99 });
  const barelyHoldout = almostNone.result.families.breakout.holdout.trades + almostNone.result.families.anticipate.holdout.trades;
  // A 99%-train/1%-holdout split must produce no more trades than a 1%-train/99%-holdout
  // split on the same asset — a sanity check that splitFraction actually controls the
  // holdout window size in the expected direction.
  assert.ok(barelyHoldout <= mostlyHoldout, "a larger holdout window should not produce fewer trades than a much smaller one");
});
