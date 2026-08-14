import test from "node:test";
import assert from "node:assert/strict";
import { runTournament, buildBtcAboveMa200At, scoreRegimeGate, runBreakoutCostFix, runBreakoutDecayExit, runTimeframeIsolation, runBreakoutTrailingTpExit, runTrendGateFilter, runFibPullback, relVolTimeline, makeRelVolAboveAt, runVolConfirmedBreakout, runAtrAdaptiveStop, runWideStopHighTargetAsymmetry } from "./tournament.mjs";

test("tournament reports no promotion when its data gate cannot be met", () => {
  const report = runTournament({ watchlist: [] });
  // `vol_contraction` entry family was added to the tournament, update expected count
  assert.equal(report.result.rows.length, 12);
  assert.equal(report.result.rows.every((row) => !row.promoted), true);
});

// ── TOURNAMENT_ROADMAP.md Track 3 — BTC-above-200d-SMA regime filter ───────────
const mkDaily = (t, close) => ({ time: String(t), open: String(close), high: String(close), low: String(close), close: String(close), volume: "1" });
const DAY = 86400;

test("buildBtcAboveMa200At: flat-then-rising synthetic series — above only once close clears the trailing 200d SMA", () => {
  const candles = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 200; i++) { candles.push(mkDaily(t, 100)); t += DAY; }   // flat 100 for the warmup window
  candles.push(mkDaily(t, 100)); const idxWarm = candles.length - 1; t += DAY; // index 200: SMA(200)=100, close=100 -> NOT above (strictly greater required)
  candles.push(mkDaily(t, 150)); const idxAbove = candles.length - 1; t += DAY; // index 201: SMA still ~100 (dominated by the flat run) -> close 150 > SMA -> above

  const aboveAt = buildBtcAboveMa200At(candles);
  const tWarm = parseInt(candles[idxWarm].time) + 1440 * 60;
  const tAbove = parseInt(candles[idxAbove].time) + 1440 * 60;

  assert.equal(aboveAt(1_700_000_000 - 1), false, "before any candle closes, must default false (no lookahead)");
  assert.equal(aboveAt(tWarm), false, "close == SMA is not strictly above");
  assert.equal(aboveAt(tAbove), true, "close clearing the trailing 200d SMA must read above");
});

test("buildBtcAboveMa200At: before the 200-bar warmup, always reads false regardless of price", () => {
  const candles = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 50; i++) { candles.push(mkDaily(t, 1000 + i)); t += DAY; } // strongly rising, but < 200 bars
  const aboveAt = buildBtcAboveMa200At(candles);
  const tLast = parseInt(candles.at(-1).time) + 1440 * 60;
  assert.equal(aboveAt(tLast), false, "fewer than 200 bars must never read above, no matter how strong the trend");
});

test("scoreRegimeGate: both clauses required (AND, not OR) — either one failing fails the gate", () => {
  assert.equal(scoreRegimeGate({ avgR: -0.05, trades: 250 }).passed, true, "clears both clauses");
  assert.equal(scoreRegimeGate({ avgR: -0.05, trades: 100 }).passed, false, "avgR clears but trades floor does not");
  assert.equal(scoreRegimeGate({ avgR: -0.20, trades: 300 }).passed, false, "trades clears but avgR does not");
  assert.equal(scoreRegimeGate({ avgR: -0.20, trades: 100 }).passed, false, "neither clause clears");
  const g = scoreRegimeGate({ avgR: -0.05, trades: 100 });
  assert.equal(g.avgRPass, true);
  assert.equal(g.tradesPass, false, "individual clause results must be reported, not just the combined verdict");
});

// ── T1B-BREAKOUT-COSTFIX — TOURNAMENT_ROADMAP.md Track 1 follow-up ─────────────
test("runBreakoutCostFix: empty watchlist yields zero trades on both arms and fails the gate honestly", () => {
  const report = runBreakoutCostFix({ watchlist: [] });
  assert.equal(report.result.variant.holdout.trades, 0);
  assert.equal(report.result.gate.passed, false, "0 trades must never read as a passing gate");
  assert.equal(report.result.gate.tradesPass, false);
});

test("runBreakoutCostFix: variant config only overrides tpR and breakoutLookback, nothing else", () => {
  const report = runBreakoutCostFix({ watchlist: [] });
  assert.equal(report.input.variant.tpR, 5);
  assert.equal(report.input.variant.breakoutLookback, 55);
  assert.equal(report.input.family, "breakout");
});

// ── T5-DECAY-EXIT — TOURNAMENT_ROADMAP.md, forces a market exit via maxHold ────
test("runBreakoutDecayExit: empty watchlist yields zero trades on both arms and fails the gate honestly", () => {
  const report = runBreakoutDecayExit({ watchlist: [] });
  assert.equal(report.result.variant.holdout.trades, 0);
  assert.equal(report.result.gate.passed, false, "0 trades must never read as a passing gate");
  assert.equal(report.result.gate.tradesPass, false);
});

test("runBreakoutDecayExit: variant config only overrides maxHold, nothing else", () => {
  const report = runBreakoutDecayExit({ watchlist: [] });
  assert.equal(report.input.variant.maxHold, 24);
  assert.equal(report.input.family, "breakout");
});

// ── T6-TIMEFRAME-ISOLATION — replicate anticipate/bos on 1d ────────────────────
test("runTournament: entryTf override defaults to \"1h\" and passing it doesn't change row shape/count", () => {
  const report = runTournament({ watchlist: [], entryTf: "1d" });
  assert.equal(report.result.rows.length, 12);
  assert.equal(report.result.rows.every((row) => !row.promoted), true);
});

test("runTimeframeIsolation: empty watchlist yields zero trades on both families and fails the gate honestly", () => {
  const report = runTimeframeIsolation({ watchlist: [] });
  assert.equal(report.result.families.length, 2);
  assert.deepEqual(report.result.families.map((f) => f.family), ["anticipate", "bos"]);
  for (const f of report.result.families) {
    assert.equal(f.holdout.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(f.gate.passed, false);
    assert.equal(f.gate.tradesPass, false);
  }
});

test("runTimeframeIsolation: entryTf defaults to \"1d\" and only anticipate/bos are targeted", () => {
  const report = runTimeframeIsolation({ watchlist: [] });
  assert.equal(report.input.entryTf, "1d");
  assert.deepEqual(report.input.families, ["anticipate", "bos"]);
});

// ── TRAIL-STOP-EXIT — trailing take-profit via backtest.js's trailingTpPct ─────
test("runBreakoutTrailingTpExit: empty watchlist yields zero trades on both variants and fails their gates honestly", () => {
  const report = runBreakoutTrailingTpExit({ watchlist: [] });
  assert.equal(report.result.variants.length, 2);
  assert.deepEqual(report.result.variants.map((v) => v.trailingTpPct), [0.05, 0.10]);
  for (const v of report.result.variants) {
    assert.equal(v.holdout.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(v.gate.passed, false);
    assert.equal(v.gate.tradesPass, false);
  }
});

test("runBreakoutTrailingTpExit: variant configs only override trailingTpPct, nothing else, both pre-registered percentages present", () => {
  const report = runBreakoutTrailingTpExit({ watchlist: [] });
  assert.deepEqual(report.input.variants, [{ trailingTpPct: 0.05 }, { trailingTpPct: 0.10 }]);
  assert.equal(report.input.family, "breakout");
});

// ── TEST-TREND-GATE-FILTER — per-asset TREND_GATE ("ma"/"structure") on anticipate/breakout ──
test("runTrendGateFilter: empty watchlist yields zero trades on all four combinations and fails their gates honestly", () => {
  const report = runTrendGateFilter({ watchlist: [] });
  assert.equal(report.result.combinations.length, 4);
  assert.deepEqual(report.result.combinations.map((c) => `${c.family}/${c.trendGateMode}`),
    ["anticipate/ma", "anticipate/structure", "breakout/ma", "breakout/structure"]);
  for (const c of report.result.combinations) {
    assert.equal(c.holdout.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(c.gate.passed, false);
    assert.equal(c.gate.tradesPass, false);
  }
});

test("runTrendGateFilter: targets both families and both modes, nothing else", () => {
  const report = runTrendGateFilter({ watchlist: [] });
  assert.deepEqual(report.input.families, ["anticipate", "breakout"]);
  assert.deepEqual(report.input.modes, ["ma", "structure"]);
});

// ── TEST1-FIB-PULLBACK — fib_pullback entryMode, fixed calendar-date split ─────
test("runFibPullback: empty watchlist fails the train gate honestly for both levels and never examines holdout", () => {
  const report = runFibPullback({ watchlist: [] });
  assert.equal(report.result.variants.length, 2);
  assert.deepEqual(report.result.variants.map((v) => v.fibLevel), [0.5, 0.618]);
  for (const v of report.result.variants) {
    assert.equal(v.train.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(v.trainGate.passed, false);
    assert.equal(v.holdout, null, "holdout must not be examined once the train gate fails");
    assert.equal(v.holdoutGate, null);
    assert.match(v.verdict, /^TRAIN-GATE-FAIL/);
  }
  assert.match(report.result.verdict, /^TEST1-FIB-PULLBACK: no retracement level clears/);
});

test("runFibPullback: both pre-registered levels present, cutoff defaults to 2025-06-01 UTC", () => {
  const report = runFibPullback({ watchlist: [] });
  assert.deepEqual(report.input.levels, [0.5, 0.618]);
  assert.equal(report.input.cutoffSec, Math.floor(Date.UTC(2025, 5, 1) / 1000));
});

// ── ATR-ADAPTIVE-STOP-CONFIRMATORY — runAtrAdaptiveStop ─────────────────────────
test("runAtrAdaptiveStop: empty watchlist yields zero trades on all 20 grid cells and fails their gates honestly", () => {
  const report = runAtrAdaptiveStop({ watchlist: [] });
  assert.equal(report.result.cells.length, 20);
  for (const c of report.result.cells) {
    assert.equal(c.holdout.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(c.gate.passed, false);
    assert.equal(c.gate.tradesPass, false);
  }
  assert.match(report.result.verdict, /^ATR-ADAPTIVE-STOP-CONFIRMATORY FAIL/);
});

test("runAtrAdaptiveStop: targets both families across the full pre-registered grid, nothing else", () => {
  const report = runAtrAdaptiveStop({ watchlist: [] });
  assert.deepEqual(report.input.families, ["breakout", "anticipate"]);
  assert.deepEqual(report.input.atrStopKs, [1.5, 2, 2.5, 3, 4]);
  assert.deepEqual(report.input.atrPeriods, [14, 20]);
  assert.deepEqual(report.result.cells.map((c) => `${c.family}/${c.atrStopK}/${c.atrPeriod}`), [
    "breakout/1.5/14", "breakout/1.5/20", "breakout/2/14", "breakout/2/20",
    "breakout/2.5/14", "breakout/2.5/20", "breakout/3/14", "breakout/3/20",
    "breakout/4/14", "breakout/4/20",
    "anticipate/1.5/14", "anticipate/1.5/20", "anticipate/2/14", "anticipate/2/20",
    "anticipate/2.5/14", "anticipate/2.5/20", "anticipate/3/14", "anticipate/3/20",
    "anticipate/4/14", "anticipate/4/20",
  ]);
});

// ── WIDE-STOP-HIGH-TARGET-ASYMMETRY — runWideStopHighTargetAsymmetry ───────────
test("runWideStopHighTargetAsymmetry: empty watchlist yields zero trades on all 50 grid cells and fails their gates honestly", () => {
  const report = runWideStopHighTargetAsymmetry({ watchlist: [] });
  assert.equal(report.result.cells.length, 50);
  for (const c of report.result.cells) {
    assert.equal(c.holdout.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(c.gate.passed, false);
    assert.equal(c.gate.tradesPass, false);
  }
  assert.match(report.result.verdict, /^WIDE-STOP-HIGH-TARGET-ASYMMETRY FAIL/);
});

test("runWideStopHighTargetAsymmetry: targets both families across the full pre-registered grid with the extended maxHold, nothing else", () => {
  const report = runWideStopHighTargetAsymmetry({ watchlist: [] });
  assert.deepEqual(report.input.families, ["breakout", "anticipate"]);
  assert.deepEqual(report.input.maxStopPcts, [0.06, 0.07, 0.08, 0.09, 0.10]);
  assert.deepEqual(report.input.tpRs, [6, 8, 10, 15, 20]);
  assert.equal(report.input.maxHold, 4320);
  assert.equal(report.result.cells.filter((c) => c.family === "breakout").length, 25);
  assert.equal(report.result.cells.filter((c) => c.family === "anticipate").length, 25);
});

// ── TEST2-VOL-CONFIRMED-BREAKOUT — relVolTimeline / makeRelVolAboveAt / runVolConfirmedBreakout ──
const HOUR = 3600;
const mkHourly = (t, vol) => ({ time: String(t), open: "100", high: "100", low: "100", close: "100", volume: String(vol) });

test("relVolTimeline: relVol excludes the current bar from its own average (flat volume then one spike)", () => {
  const candles = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 20; i++) { candles.push(mkHourly(t, 10)); t += HOUR; }   // 20-bar warmup, flat volume=10
  candles.push(mkHourly(t, 100)); const idxSpike = candles.length - 1; t += HOUR; // index 20: prior 20 bars avg=10 -> relVol=10
  candles.push(mkHourly(t, 5));   const idxNext  = candles.length - 1;            // index 21: prior 20 bars = [1..19]@10 + [20]@100, avg=14.5 -> relVol=5/14.5

  const tl = relVolTimeline(candles, 60, 20);
  for (let i = 0; i < 20; i++) assert.equal(tl[i].relVol, null, `bar ${i} is inside the warmup window, must read null`);
  assert.equal(tl[idxSpike].relVol, 10, "100 / avg(prior 20 bars @10 each) = 10 — the spike bar's own volume must not inflate its own average");
  assert.ok(Math.abs(tl[idxNext].relVol - 5 / 14.5) < 1e-9, "prior-20 average must roll forward to include the spike and drop the oldest bar");
});

test("makeRelVolAboveAt: forward-only cursor, no lookahead before the first candle closes, >= threshold is inclusive", () => {
  const candles = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 20; i++) { candles.push(mkHourly(t, 10)); t += HOUR; }
  candles.push(mkHourly(t, 100)); const tSpike = t + HOUR;

  const aboveAt = makeRelVolAboveAt(relVolTimeline(candles, 60, 20), 10);
  assert.equal(aboveAt(1_700_000_000 - 1), false, "before any candle closes, must default false");
  assert.equal(aboveAt(tSpike), true, "relVol 10 >= threshold 10 must be inclusive (>=, not >)");
  assert.equal(makeRelVolAboveAt(relVolTimeline(candles, 60, 20), 10.5)(tSpike), false, "relVol 10 < threshold 10.5 must read false");
});

test("runVolConfirmedBreakout: empty watchlist fails the train gate honestly for all three thresholds and never examines holdout", () => {
  const report = runVolConfirmedBreakout({ watchlist: [] });
  assert.equal(report.result.variants.length, 3);
  assert.deepEqual(report.result.variants.map((v) => v.threshold), [1.5, 2, 3]);
  for (const v of report.result.variants) {
    assert.equal(v.train.trades, 0, "0 trades must never read as a passing gate");
    assert.equal(v.trainGate.tradesPass, false);
    assert.equal(v.trainGate.passed, false);
    assert.equal(v.holdout, null, "holdout must not be examined once no threshold clears the train gate");
    assert.equal(v.holdoutGate, null);
    assert.match(v.verdict, /^TRAIN-GATE-FAIL/);
  }
  assert.match(report.result.verdict, /^TEST2-VOL-CONFIRMED-BREAKOUT: no threshold clears the train gate/);
});

test("runVolConfirmedBreakout: pre-registered thresholds/cutoff/lookback defaults", () => {
  const report = runVolConfirmedBreakout({ watchlist: [] });
  assert.deepEqual(report.input.thresholds, [1.5, 2, 3]);
  assert.equal(report.input.cutoffSec, Math.floor(Date.UTC(2025, 5, 1) / 1000));
  assert.equal(report.input.lookback, 20);
  assert.equal(report.input.selected, null, "no threshold cleared the train gate, so nothing was selected");
});
