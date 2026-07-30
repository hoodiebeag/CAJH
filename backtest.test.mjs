/**
 * backtest.test.mjs — sanity tests for the backtest/profile engines (node --test).
 *
 * Synthetic-candle scenario on the 1h entry TF: a downtrend forms a strong swing low at
 * 95 inside a candle whose high is 97.6 (the trigger). Verifies:
 *   • BOS mode: entry at the confirming close, exact per-leg fees (entry fee on the
 *     entry notional, exit fee on the exit notional — matching monitor.js live P&L),
 *   • ANTICIPATE mode: entry the moment a later bar's high crosses the trigger (fill at
 *     the trigger), before any close confirms — the live strategy's entry,
 *   • profileEntries resolves the same candidate identically, and
 *   • profileEntries excludes candidates whose resolution window would be truncated
 *     by the end of the data (the uniform-horizon censoring guard).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestMultiTF, profileEntries, excursionProfile } from "./backtest.js";

const mk = (t, o, h, l, c) => ({ time: String(t), open: String(o), high: String(h), low: String(l), close: String(c), volume: "1" });
const HOUR = 3600;

// Downtrend → pivot candle (low 95, high 97.6) → `next` bars → grind up from `p0`.
function buildSeries(next, p0) {
  const c1h = [];
  let t = 1_700_000_000, p = 100;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, p, p + 0.05, p - 0.1, p - 0.08)); p -= 0.08; t += HOUR; }
  c1h.push(mk(t, p, p, 95, 96)); t += HOUR;                     // pivot: low 95, high ≈97.6
  for (const bar of next) { c1h.push(mk(t, ...bar)); t += HOUR; }
  p = p0;
  for (let i = 0; i < 600; i++) { c1h.push(mk(t, p, p + 0.2, p - 0.05, p + 0.15)); p += 0.15; t += HOUR; }

  const resample = (span) => {
    const out = [];
    for (let i = 0; i < c1h.length; i += span) {
      const chunk = c1h.slice(i, i + span);
      out.push(mk(chunk[0].time, chunk[0].open,
        Math.max(...chunk.map(c => +c.high)), Math.min(...chunk.map(c => +c.low)), chunk.at(-1).close));
    }
    return out;
  };
  return [
    { label: "1h", mins: 60,   candles: c1h },
    { label: "4h", mins: 240,  candles: resample(4) },
    { label: "1d", mins: 1440, candles: resample(24) },
  ];
}

const FEE = 0.0045; // feeRate 0.004 + slippage 0.0005 per side
const netWinR = (entry, risk) => 4 - (FEE * (entry + (entry + 4 * risk))) / risk;

test("BOS mode: entry at the confirming close, exact per-leg fees", () => {
  // Confirm candle closes 97.7 > trigger 97.6 → entry 97.7, risk 2.7.
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  assert.ok(Math.abs(r.results[0] - netWinR(97.7, 2.7)) < 1e-9,
    `winner R ${r.results[0]} != expected ${netWinR(97.7, 2.7)}`);
});

test("ANTICIPATE mode: entry when the high crosses the trigger, before any confirming close", () => {
  // Bar after the pivot: high 97.8 crosses the 97.6 trigger but CLOSES 97.5 (below it) —
  // BOS would not enter here; anticipation fills at the trigger. Entry 97.6, risk 2.6.
  const series = buildSeries([[96.5, 97.8, 96, 97.5]], 97.5);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  assert.ok(Math.abs(r.results[0] - netWinR(97.6, 2.6)) < 1e-9,
    `winner R ${r.results[0]} != expected ${netWinR(97.6, 2.6)}`);
});

test("profileEntries resolves the confirmed candidate with identical netR", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const { records } = profileEntries({ series }, { tpR: 4 });
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, "win");
  assert.ok(Math.abs(records[0].netR - netWinR(97.7, 2.7)) < 1e-9,
    `netR ${records[0].netR} != expected ${netWinR(97.7, 2.7)}`);
});

// ── Exit-model accounting ────────────────────────────────────────────────────
// Same BOS entry (97.7, risk 2.7). A partial leg of fraction f must contribute exactly
// f × the full-position net R at that price, so scale-outs stay consistent with full exits.
const netAt = (px, entry = 97.7, risk = 2.7) => (px - entry) / risk - (FEE * (entry + px)) / risk;

const BASE_EXIT_CFG = {
  entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false,
  feeRate: 0.004, slipPct: 0.0005,
};

test("partial scale-out: half banked at 1R, remainder runs to the 4R target", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);   // then grinds up past both levels
  const r = backtestMultiTF({ series }, { ...BASE_EXIT_CFG, tpR: 4, partialAtR: 1, partialFrac: 0.5 });
  assert.equal(r.trades, 1);
  const expected = 0.5 * netAt(97.7 + 1 * 2.7) + 0.5 * netAt(97.7 + 4 * 2.7);
  assert.ok(Math.abs(r.results[0] - expected) < 1e-9, `R ${r.results[0]} != expected ${expected}`);
  assert.equal(r.exits["partial+runner"], undefined); // the final leg exits at the target
  assert.equal(r.exits.target, 1);
});

test("trailing stop: exits 1R below the running peak, not at the peak", () => {
  // Rise in clean 1.00 steps (high = close) to a 109.7 peak, then one bar that dumps.
  const rise = [];
  for (let i = 1; i <= 12; i++) { const c = 97.7 + i; rise.push([c - 1, c, c - 1, c]); }
  rise.push([109.7, 109.7, 100, 100]);
  const series = buildSeries([[96, 97.8, 96, 97.7], ...rise], 100);
  const r = backtestMultiTF({ series }, { ...BASE_EXIT_CFG, tpR: 99, trailR: 1, trailStartR: 1 });
  // The dump forms a fresh swing low, so the recovery opens a second trade; only the
  // first one exercises the trail, and it is the one being asserted here.
  assert.ok(r.trades >= 1);
  // Peak 109.7 → stop trails to 109.7 − 1R(2.7) = 107.0; the dump bar takes it.
  const expected = netAt(107.0);
  assert.ok(Math.abs(r.results[0] - expected) < 1e-9, `R ${r.results[0]} != expected ${expected}`);
  assert.ok(r.exits["trail/be"] >= 1, "expected a trailing-stop exit");
});

test("excursionProfile: every grid cell classifies exactly the same entries", () => {
  // The stop×target grid is only interpretable if each cell accounts for every entry
  // exactly once — a miscount would silently bias the expectancy it reports.
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const r = excursionProfile({ series }, { entryTf: "1h", horizon: 100 });
  assert.ok(r.n > 0, "expected at least one entry");
  for (const c of r.grid) {
    assert.equal(c.wins + c.losses + c.open, r.n,
      `cell k=${c.k} m=${c.m} classified ${c.wins + c.losses + c.open} of ${r.n} entries`);
  }
  // Excursions are magnitudes, and percentiles must be ordered.
  for (const s of [r.mae, r.mfe]) {
    assert.ok(s.p25 >= 0 && s.p50 >= s.p25 && s.p75 >= s.p50 && s.p90 >= s.p75, "excursion percentiles out of order");
  }
  // This series rallies monotonically after entry, so every cell's target is reached.
  assert.ok(r.grid.every(c => c.wins === r.n), "expected all targets hit on a monotonic rally");
});

test("profileEntries excludes candidates with a truncated resolution window", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const short = series.map(s => ({ ...s }));
  short[0] = { ...short[0], candles: short[0].candles.slice(0, 32 + 250) }; // < HORIZON bars after confirm
  const { records } = profileEntries({ series: short }, { tpR: 4 });
  assert.equal(records.length, 0);
});
