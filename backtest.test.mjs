/**
 * backtest.test.mjs — sanity tests for the backtest/profile engines (node --test).
 *
 * Synthetic-candle scenario: a downtrend forms a strong swing low at 95, a candle
 * closes back above the pivot's high (break of structure → entry 97.7, risk 2.7),
 * then price grinds cleanly to beyond the 4R target. Verifies:
 *   • the engine takes exactly that one trade,
 *   • the R math charges the entry fee on the entry notional and the exit fee on the
 *     exit notional (matching monitor.js's live P&L accounting),
 *   • profileEntries resolves the same candidate identically, and
 *   • profileEntries excludes candidates whose resolution window would be truncated
 *     by the end of the data (the uniform-horizon censoring guard).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestMultiTF, profileEntries } from "./backtest.js";

const mk = (t, o, h, l, c) => ({ time: String(t), open: String(o), high: String(h), low: String(l), close: String(c), volume: "1" });

function syntheticSeries() {
  const candles15 = [];
  let t = 1_700_000_000, p = 100;
  for (let i = 0; i < 30; i++) { candles15.push(mk(t, p, p + 0.05, p - 0.1, p - 0.08)); p -= 0.08; t += 900; }
  candles15.push(mk(t, p, p, 95, 96)); t += 900;                 // pivot low 95, candle high 97.6
  candles15.push(mk(t, 96, 97.8, 96, 97.7)); t += 900;           // confirm: close 97.7 > 97.6
  p = 97.7;
  for (let i = 0; i < 600; i++) { candles15.push(mk(t, p, p + 0.2, p - 0.05, p + 0.15)); p += 0.15; t += 900; }

  const resample = (span) => {
    const out = [];
    for (let i = 0; i < candles15.length; i += span) {
      const chunk = candles15.slice(i, i + span);
      out.push(mk(chunk[0].time, chunk[0].open,
        Math.max(...chunk.map(c => +c.high)), Math.min(...chunk.map(c => +c.low)), chunk.at(-1).close));
    }
    return out;
  };
  return { candles15, candles1h: resample(4), candles4h: resample(16) };
}

// entry 97.7, stop 95 → risk 2.7, target 108.5; fee+slip 0.45%/side on entry and exit notional
const ENTRY = 97.7, RISK = 2.7, TARGET = ENTRY + 4 * RISK;
const EXPECTED_WIN_R = 4 - (0.0045 * (ENTRY + TARGET)) / RISK;

test("backtestMultiTF takes the synthetic setup and nets exact per-leg fees", () => {
  const { candles15, candles1h, candles4h } = syntheticSeries();
  const r = backtestMultiTF({ candles15, candles1h, candles4h }, {
    alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  assert.ok(Math.abs(r.results[0] - EXPECTED_WIN_R) < 1e-9,
    `winner R ${r.results[0]} != expected ${EXPECTED_WIN_R}`);
});

test("profileEntries resolves the same candidate with identical netR", () => {
  const { candles15, candles1h, candles4h } = syntheticSeries();
  const { records } = profileEntries({ candles15, candles1h, candles4h }, { tpR: 4 });
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, "win");
  assert.ok(Math.abs(records[0].netR - EXPECTED_WIN_R) < 1e-9,
    `netR ${records[0].netR} != expected ${EXPECTED_WIN_R}`);
});

test("profileEntries excludes candidates with a truncated resolution window", () => {
  const { candles15, candles1h, candles4h } = syntheticSeries();
  const short = candles15.slice(0, 32 + 250); // < HORIZON bars after the confirm candle
  const { records } = profileEntries({ candles15: short, candles1h, candles4h }, { tpR: 4 });
  assert.equal(records.length, 0);
});
