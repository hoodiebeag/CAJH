import test from "node:test";
import assert from "node:assert/strict";
import { runTournament, buildBtcAboveMa200At, scoreRegimeGate, runBreakoutCostFix, runBreakoutDecayExit, runTimeframeIsolation } from "./tournament.mjs";

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
