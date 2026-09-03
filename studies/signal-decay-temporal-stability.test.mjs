import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  runSignalDecayTemporalStability, epochSlices, oneWayAnovaF, permutationAnovaP,
} from "./signal-decay-temporal-stability.mjs";

const HAS_XBT_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));

test("classifies an asset with no local candles as insufficient-candle-history", async () => {
  const report = await runSignalDecayTemporalStability({ watchlist: ["ZZZFAKE"] });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "SIGNAL-DECAY-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("reports SIGNAL-DECAY-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runSignalDecayTemporalStability({ watchlist: ["ZZZFAKE1", "ZZZFAKE2"] });
  assert.equal(report.result.verdict, "SIGNAL-DECAY-DATA-INSUFFICIENT");
  assert.deepEqual(report.result.families, {});
});

test("includes an asset once local candle coverage clears the gate, and reports both families with all epochs present", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runSignalDecayTemporalStability({ watchlist: ["XBT"], epochs: 5 });
  assert.equal(report.input.coverage[0].included, true);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    // Every epoch must always be present (even with 0 trades) — done_when requires "report
    // every epoch including flat ones."
    assert.equal(f.epochs.length, 5);
    assert.deepEqual(f.epochs.map((e) => e.epoch), [1, 2, 3, 4, 5]);
    assert.ok(f.anova, "anova stats must be present");
    assert.ok(typeof f.stationarityCall === "string" && f.stationarityCall.length > 0);
  }
});

test("epoch trade counts sum to the family's overall trade count (accumulated during the same pass, so this pins the bookkeeping rather than re-deriving it)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runSignalDecayTemporalStability({ watchlist: ["XBT"], epochs: 4 });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    const epochSum = f.epochs.reduce((a, e) => a + e.trades, 0);
    assert.equal(epochSum, f.overall.trades);
  }
});

test("this is a real backtest on real local candle history, not a zero-trade no-op (XBT has enough history to produce trades in at least one epoch of at least one family)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runSignalDecayTemporalStability({ watchlist: ["XBT"] });
  const totalTrades = report.result.families.breakout.overall.trades + report.result.families.anticipate.overall.trades;
  assert.ok(totalTrades > 0, "expected at least one trade across breakout/anticipate on real XBT history");
});

test("epochSlices partitions the anchor timeframe's candles into disjoint, gapless, chronologically ordered slices", () => {
  const candles = Array.from({ length: 100 }, (_, i) => ({ time: i * 3600, open: 1, high: 1, low: 1, close: 1 }));
  const series = [{ label: "1h", mins: 60, candles }, { label: "4h", mins: 240, candles: [] }, { label: "1d", mins: 1440, candles: [] }];
  const slices = epochSlices(series, 5);
  assert.equal(slices.length, 5);
  const allTimes = slices.flatMap((s) => s[0].candles.map((c) => c.time));
  // No candle dropped, none duplicated across slices.
  assert.equal(allTimes.length, 100);
  assert.deepEqual([...allTimes].sort((a, b) => a - b), candles.map((c) => c.time));
  // Each slice's times are a contiguous chronological block (no interleaving).
  for (const s of slices) {
    const times = s[0].candles.map((c) => c.time);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
  // Slices themselves are in chronological order (slice i entirely precedes slice i+1).
  for (let i = 0; i < slices.length - 1; i++) {
    const endOfI = slices[i][0].candles.at(-1)?.time ?? -Infinity;
    const startOfNext = slices[i + 1][0].candles[0]?.time ?? Infinity;
    assert.ok(endOfI < startOfNext, `slice ${i} must entirely precede slice ${i + 1}`);
  }
});

test("epochSlices rejects fewer than 2 epochs", () => {
  const series = [{ label: "1h", mins: 60, candles: [{ time: 0 }] }];
  assert.throws(() => epochSlices(series, 1), /epochs must be an integer >= 2/);
});

test("oneWayAnovaF returns near-zero F for groups drawn from the same distribution (stationary synthetic case)", () => {
  // Deterministic synthetic groups with identical means/spread — no real between-group signal.
  const g = [0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.15, -0.15];
  const groups = [g, g.map((x) => x + 1e-9), g.slice().reverse(), g];
  const { F, dfBetween, dfWithin } = oneWayAnovaF(groups);
  assert.equal(dfBetween, 3);
  assert.equal(dfWithin, groups.flat().length - 4);
  assert.ok(F < 0.01, `expected near-zero F for identical groups, got ${F}`);
});

test("oneWayAnovaF returns a large F when group means differ sharply relative to within-group spread", () => {
  const tight = (center) => Array.from({ length: 50 }, (_, i) => center + (i % 2 === 0 ? 0.001 : -0.001));
  const groups = [tight(-2), tight(0), tight(2), tight(4)];
  const { F } = oneWayAnovaF(groups);
  assert.ok(F > 1000, `expected a very large F when between-group variance dominates, got ${F}`);
});

test("oneWayAnovaF returns null F when fewer than two epochs have any trades", () => {
  const { F } = oneWayAnovaF([[0.1, 0.2], [], []]);
  assert.equal(F, null);
});

test("permutationAnovaP gives a small p-value for sharply separated groups and a large one for identical groups, deterministically for a fixed seed", () => {
  const g = [0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.15, -0.15, 0.05, -0.05];
  const identicalGroups = [g, g.slice().reverse(), g, g.slice().reverse()];
  const pIdentical = permutationAnovaP(identicalGroups, 500, 1);
  assert.ok(pIdentical > 0.3, `expected a large p-value for identical groups, got ${pIdentical}`);

  const tight = (center) => Array.from({ length: 30 }, (_, i) => center + (i % 2 === 0 ? 0.001 : -0.001));
  const separatedGroups = [tight(-3), tight(-1), tight(1), tight(3)];
  const pSeparated = permutationAnovaP(separatedGroups, 500, 1);
  assert.ok(pSeparated < 0.01, `expected a tiny p-value for sharply separated groups, got ${pSeparated}`);

  // Determinism: same inputs + same seed => same result.
  const pAgain = permutationAnovaP(separatedGroups, 500, 1);
  assert.equal(pSeparated, pAgain);
});
