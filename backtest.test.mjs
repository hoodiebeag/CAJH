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

// ── MAE/MFE excursion tracking (MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC) ─────────────
// Same BOS entry as above (97.7, risk 2.7, stop 95, tp 108.5 at tpR=4). A bar right after
// entry dips to 95.5 (above the stop, so the trade survives) before a later bar's high lands
// EXACTLY on the tp price — chosen so mfe comes out to exactly tpR with no overshoot to reason
// about, and the dip bar's low stays above the stop so it doesn't pre-empt the win.
test("BOS mode: MAE/MFE track the worst/best unrealized R seen before a winning exit", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7], [97.7, 98, 95.5, 96], [96, 108.5, 95.6, 108]], 108);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  assert.equal(r.excursions.length, 1);
  const [x] = r.excursions;
  assert.ok(Math.abs(x.mae - (97.7 - 95.5) / 2.7) < 1e-9, `mae ${x.mae} != expected`);
  assert.ok(Math.abs(x.mfe - 4) < 1e-9, `mfe ${x.mfe} != expected tpR 4`);
  assert.ok(Math.abs(x.r - netWinR(97.7, 2.7)) < 1e-9, "excursions[0].r must match results[0]");
  assert.equal(x.r, r.results[0]);
  assert.equal(x.barsHeld, 5, "bars from BOS entry (confirmed after swing-window delay) to the tp bar");
  assert.equal(x.entry, 97.7);
  assert.ok(Math.abs(x.risk - 2.7) < 1e-9);
  assert.ok(Math.abs(x.exitPrice - 108.5) < 1e-9, "tp exit, no overshoot");
});

test("BOS mode: MAE/MFE on a stop-out — mae equals exactly 1R (stop is entry-risk by construction)", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7], [97.7, 99, 95, 95]], 108);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  const [x] = r.excursions;
  assert.ok(Math.abs(x.mae - 1) < 1e-9, `mae ${x.mae} != expected 1`);
  assert.ok(Math.abs(x.mfe - (99 - 97.7) / 2.7) < 1e-9, `mfe ${x.mfe} != expected`);
  assert.ok(x.r < 0, "stop-out must realize a loss");
  assert.equal(x.barsHeld, 1, "stopped out on the bar right after entry");
  assert.equal(x.entry, 97.7);
  assert.equal(x.exitPrice, 95, "stop-out exit price");
});

test("ANTICIPATE mode: MAE/MFE on the same-bar stop-out path (entry and stop hit in one bar)", () => {
  // Trigger bar's own low (95) sits AT the candidate stop, so the position opens and is
  // stopped out within the special-cased same-bar branch, not the per-bar tracking loop.
  const series = buildSeries([[96.5, 97.8, 95, 97.5]], 108);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1);
  const [x] = r.excursions;
  assert.ok(Math.abs(x.mae - 1) < 1e-9, `mae ${x.mae} != expected 1 (entry 97.6, stop 95, risk 2.6)`);
  assert.ok(Math.abs(x.mfe - (97.8 - 97.6) / 2.6) < 1e-9, `mfe ${x.mfe} != expected`);
  assert.equal(x.r, r.results[0]);
  assert.equal(x.barsHeld, 0, "entered and stopped out within the same bar");
  assert.ok(Math.abs(x.entry - 97.6) < 1e-9);
  assert.equal(x.exitPrice, 95, "stop-out exit price");
});

// ── entryDelayBars (EXECUTION-DELAY-DECAY-CURVE) ───────────────────────────────
// Same pivot (low 95, high 97.6 trigger) as the ANTICIPATE tests above, but with an extra
// bar after the trigger-cross so entryDelayBars=1's delayed fill lands on a bar with a
// distinct, known open price (98) instead of the trigger price (97.6).
test("ANTICIPATE mode + entryDelayBars: fills at the OPEN of the delayed bar, stop stays structural", () => {
  const series = buildSeries([[96.5, 97.8, 96, 97.5], [98, 99, 97, 98.5]], 98.5);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005, entryDelayBars: 1,
  });
  // Delayed entry = O[bar after trigger] = 98, stop unchanged at the structural low (95),
  // risk = 3, tp = 98 + 4*3 = 110 — the auto-generated uptrend after p0=98.5 climbs into it.
  assert.equal(r.trades, 1);
  assert.ok(Math.abs(r.results[0] - netWinR(98, 3)) < 1e-9,
    `winner R ${r.results[0]} != expected ${netWinR(98, 3)} (entry 98, risk 3)`);
});

// ma_dip uses the same shared candidate branch "breakout" mode does (backtest.js's generic
// `else if (!pos)` dip/breakout dispatch) — exercised here instead of breakout because its
// stop (`L[k] - 0.001*entry`) is exact with no ATR to hand-replicate for the assertion.
function buildFlatDipSeries(afterBars, p0) {
  const c = []; let t = 1_700_000_000, p = 100;
  for (let i = 0; i < 25; i++) { c.push({ time: String(t), open: String(p), high: String(p + 0.1), low: String(p - 0.1), close: String(p), volume: "1" }); t += HOUR; }
  c.push({ time: String(t), open: String(p), high: String(p), low: "94.8", close: "95", volume: "1" }); t += HOUR; // dip bar: close 95, low 94.8 (>=2% below MA~99.75)
  for (const bar of afterBars) { c.push(mk(t, ...bar)); t += HOUR; }
  p = p0;
  for (let i = 0; i < 200; i++) { c.push(mk(t, p, p + 0.2, p - 0.05, p + 0.15)); p += 0.15; t += HOUR; }
  return [{ label: "1h", mins: 60, candles: c }];
}

test("ma_dip mode (shared dip/breakout branch) + entryDelayBars: same-bar stop-out on the delayed fill", () => {
  // Dip bar: entry 95, stop = 94.8 - 0.001*95 = 94.705, risk = 0.295 (well within bounds).
  // Delayed (k+1) bar opens 96, low 94 <= stop -> immediate stop-out at the structural stop.
  // Its own close (99.6) is kept back above the k+1 bar's own MA*0.98 so it doesn't ALSO
  // independently qualify as its own separate ma_dip signal (unrelated to the delay).
  const series = buildFlatDipSeries([[96, 97, 94, 99.6]], 99.6);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "ma_dip", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.5, minStopPct: 0, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005, entryDelayBars: 1,
  });
  const stop = 94.8 - 0.001 * 95, dEntry = 96, dRisk = dEntry - stop;
  const expected = (stop - dEntry) / dRisk - (FEE * (dEntry + stop)) / dRisk;
  assert.equal(r.trades, 1);
  assert.ok(Math.abs(r.results[0] - expected) < 1e-9, `stop-out R ${r.results[0]} != expected ${expected}`);
});

test("entryDelayBars skips the trade (reason delaySkipped) when the delay runs past the end of the series", () => {
  const series = buildFlatDipSeries([[96, 97, 95.5, 96.5]], 96.5);
  const r = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "ma_dip", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.5, minStopPct: 0, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005, entryDelayBars: 100000,
  });
  assert.equal(r.trades, 0);
  assert.ok(r.reasons.delaySkipped >= 1, "expected a delaySkipped tally when the delay exceeds the series length");
});

test("entryDelayBars: default (0) reproduces the original immediate-fill result exactly", () => {
  const series = buildSeries([[96.5, 97.8, 96, 97.5]], 97.5);
  const withDefault = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  const withExplicitZero = backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005, entryDelayBars: 0,
  });
  assert.deepEqual(withExplicitZero.results, withDefault.results);
});

test("profileEntries resolves the confirmed candidate with identical netR", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const { records } = profileEntries({ series }, { tpR: 4, feeRate: 0.004, slipPct: 0.0005 });
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

// ── stopMode "atr" ────────────────────────────────────────────────────────────
// Constant true range (1.0) for 20 bars with a strictly decreasing low each bar, so
// ATR(14) ending at any bar in this run is exactly 1.0 by hand — no rounding to chase.
// Bar 19 is the freshest (lowest) candidate; its own high is the trigger.
function resampleOf(c1h) {
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

test("stopMode 'atr': risk = atrStopK × ATR(14) taken at the PREVIOUS bar, not the swing low", () => {
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 20; i++) {
    const o = 100 - i * 0.01;
    c1h.push(mk(t, o, o + 0.5, o - 0.5, o - 0.05));   // constant TR = 1.0 (H−L dominates the gap terms)
    t += HOUR;
  }
  const trigger = (100 - 19 * 0.01) + 0.5;   // bar 19's own high = 100.31
  c1h.push(mk(t, 99.5, 101.0, 99.0, 100.5)); t += HOUR;   // entry bar: crosses the trigger, low stays clear of the stop
  let p = 100.5;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, p, p + 0.5, p - 0.1, p + 0.4)); p += 0.4; t += HOUR; }   // clean rally past any target

  const r = backtestMultiTF({ series: resampleOf(c1h) }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, minStopPct: null, maxStopPct: null, lockBreakeven: false,
    stopMode: "atr", atrStopK: 2, atrPeriod: 14, tpR: 3,
    feeRate: 0.004, slipPct: 0.0005,
  });

  assert.equal(r.trades, 1);
  const entry = trigger, risk = 2 * 1.0, target = entry + 3 * risk;
  const expected = (target - entry) / risk - 0.0045 * (entry + target) / risk;
  assert.ok(Math.abs(r.results[0] - expected) < 1e-9, `R ${r.results[0]} != expected ${expected}`);
});

test("stopMode 'atr': insufficient history for ATR(14) yields no trade, not a NaN-risk trade", () => {
  // Only 8 bars precede the trigger cross — atr(...,14) returns null (k < period), so
  // stop is NaN, risk is NaN, and `!(risk > 0)` must reject the entry rather than open a
  // trade with a NaN risk that would silently corrupt every downstream R calculation.
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 8; i++) {
    const o = 100 - i;
    c1h.push(mk(t, o, o + 0.5, o - 0.5, o - 0.1));
    t += HOUR;
  }
  const trigger = (100 - 7) + 0.5;   // bar 7's high = 93.5
  c1h.push(mk(t, 92.5, 95, 91, 93)); t += HOUR;   // crosses the trigger well before 14 bars exist
  for (let i = 0; i < 5; i++) { c1h.push(mk(t, 93, 93.2, 92.8, 93)); t += HOUR; }   // flat — nothing else can trigger

  const r = backtestMultiTF({ series: resampleOf(c1h) }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, minStopPct: null, maxStopPct: null, lockBreakeven: false,
    stopMode: "atr", atrStopK: 2, atrPeriod: 14, tpR: 3,
  });
  assert.equal(r.trades, 0, "a missing ATR must reject the entry, not open a trade with NaN risk");
});

// ── One-trade-per-level guard (anticipate mode) ────────────────────────────────
test("anticipate mode: crossing the same candidate trigger twice opens exactly ONE trade", () => {
  const c1h = [];
  let t = 1_700_000_000, p = 100;
  for (let i = 0; i < 10; i++) { c1h.push(mk(t, p, p + 0.05, p - 0.1, p - 0.08)); p -= 0.08; t += HOUR; }
  // Pivot: low 95 (the structural stop), high 97 (the trigger); closes below the trigger
  // so the candidate stays UNCONFIRMED (antCand persists) past this bar.
  c1h.push(mk(t, p, 97, 95, 96)); t += HOUR;
  // Bar A: high crosses the trigger (97) → entry fires at 97 — but this SAME bar's low
  // is EXACTLY the stop (95, not below it), so it closes same-bar as a loss WITHOUT also
  // registering as a new, lower left-low (isLeftLow requires a STRICTLY lower low than
  // the pivot's 95; a tie fails that check) — antCand keeps pointing at the ORIGINAL
  // pivot, now marked traded via antTradedIdx. Close (96.5) stays below the trigger too.
  c1h.push(mk(t, 96, 97.5, 95, 96.5)); t += HOUR;
  // Bar B: crosses the SAME trigger (97) again, clearly (high 98). Without the guard
  // this opens a second trade; with it, antCand.index === antTradedIdx blocks it.
  c1h.push(mk(t, 96.5, 98, 96, 97.8)); t += HOUR;
  p = 97.8;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, p, p + 0.3, p - 0.05, p + 0.2)); p += 0.2; t += HOUR; }

  const r = backtestMultiTF({ series: resampleOf(c1h) }, {
    entryTf: "1h", entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, minStopPct: null, maxStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });
  assert.equal(r.trades, 1, "the same structural level must not open a second trade after its first is taken");
});

// ── Alignment / trend gate in anticipate mode ──────────────────────────────────
// Until 9041ea6, alignMode/trendGate were silently ignored in entryMode "anticipate" —
// only "bos" mode honored them. This proves the gate now actually gates anticipate
// entries, by holding the SAME 1h setup fixed and swapping only alignMode.
function bearishHigherTF(barMins, len) {
  const out = [];
  let t = 1_700_000_000, p = 100;
  for (let i = 0; i < 5; i++) { out.push(mk(t, p, p + 0.3, p - 0.1, p + 0.2)); p += 0.2; t += barMins * 60; }
  out.push(mk(t, p, p + 3, p - 0.1, p + 0.5));            // pivot high candle
  const hiLow = p - 0.1;
  t += barMins * 60; p += 0.5;
  out.push(mk(t, p, p + 0.1, hiLow - 1, hiLow - 0.5));     // confirms: closes below the pivot's low → bearish
  t += barMins * 60; p = hiLow - 0.5;
  for (let i = 0; i < len - 7; i++) { out.push(mk(t, p, p + 0.1, p - 0.1, p)); t += barMins * 60; }
  return out;
}

test("anticipate mode: alignMode 'all' with a bearish higher TF blocks an entry alignMode 'none' allows", () => {
  const base = buildSeries([[96.5, 97.8, 96, 97.5]], 97.5);   // the known-good ANTICIPATE entry
  const series = [
    base[0],
    { label: "4h", mins: 240,  candles: bearishHigherTF(240, 40) },
    { label: "1d", mins: 1440, candles: bearishHigherTF(1440, 20) },
  ];
  const cfg = (alignMode) => ({
    entryTf: "1h", entryMode: "anticipate", alignMode, trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: 0.04, minStopPct: 0.015, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  });

  const allowed = backtestMultiTF({ series }, cfg("none"));
  assert.equal(allowed.trades, 1, "alignMode 'none' should ignore the bearish higher TFs and take the entry");

  const blocked = backtestMultiTF({ series }, cfg("all"));
  assert.equal(blocked.trades, 0, "alignMode 'all' should block the same entry against a bearish higher TF");
});

// ── vol_contraction mode ─────────────────────────────────────────────────────
// 60 high-ATR baseline bars (range 20, flat at 100) roll ATR(14) down over a following
// tightly-compressed stretch (range 0.2, flat at 105) until aPrev < 0.5x the 50-bar
// median — the compression state backtest.js checks bar-by-bar. A close above the
// compressed run's high should open exactly one trade, with risk sized off the run's low.
function buildCompressionSeries(compressedBars) {
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 60; i++) { c1h.push(mk(t, 100, 110, 90, 100)); t += HOUR; }        // high-ATR baseline
  for (let i = 0; i < compressedBars; i++) { c1h.push(mk(t, 105, 105.1, 104.9, 105)); t += HOUR; }
  c1h.push(mk(t, 105, 112, 104.8, 110)); t += HOUR;                                      // close 110 > range high 105.1
  let p = 110;
  for (let i = 0; i < 40; i++) { c1h.push(mk(t, p, p + 0.5, p - 0.1, p + 0.4)); p += 0.6; t += HOUR; } // grind up to TP
  return [{ label: "1h", mins: 60, candles: c1h }];
}

const VC_CFG = {
  entryTf: "1h", entryMode: "vol_contraction", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 3,
  feeRate: 0.004, slipPct: 0.0005,
};

test("vol_contraction mode: a close above a >=5-bar compressed range opens one trade, risk off the run's low", () => {
  const series = buildCompressionSeries(25);
  const r = backtestMultiTF({ series }, VC_CFG);
  assert.equal(r.trades, 1);
  // entry 110, stop = rangeLow(104.9) - 0.001*110 = 104.79, risk 5.21; grinds up to hit the 3R target.
  const entry = 110, risk = 110 - 104.79;
  const tp = entry + 3 * risk;
  const netWinR3 = 3 - (FEE * (entry + tp)) / risk;
  assert.ok(Math.abs(r.results[0] - netWinR3) < 1e-6,
    `winner R ${r.results[0]} != expected ${netWinR3}`);
});

test("vol_contraction mode: breaking to a new high WITHOUT a preceding compressed run opens no trade", () => {
  // Same high-ATR baseline throughout (no contraction), then a close far above every prior high.
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 80; i++) { c1h.push(mk(t, 100, 110, 90, 100)); t += HOUR; }
  c1h.push(mk(t, 100, 210, 95, 200));
  const series = [{ label: "1h", mins: 60, candles: c1h }];
  const r = backtestMultiTF({ series }, VC_CFG);
  assert.equal(r.trades, 0, "no compressed run precedes the breakout, so vol_contraction must not fire");
});

// ── fib_pullback mode (TEST1-FIB-PULLBACK) ──────────────────────────────────────
// 5 flat baseline bars (low 100, clears isLeftLow's lookback), a candidate low bar
// (low 90, high 95 = the BOS trigger), a drift-up run that stays under the trigger, then a
// confirm bar (close 99 > trigger 95) that also pushes the bar high to 100 — legLow=90,
// legHigh=100 (running max H[5..10]), so fib50 level=95, fib618 level=93.82, stop=90-0.09=89.91.
function buildFibSeries({ pullbackLow = 94.5, breakStopFirst = false } = {}) {
  const c = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 5; i++) { c.push(mk(t, 100, 101, 100, 100.5)); t += HOUR; }
  c.push(mk(t, 95, 95, 90, 91)); t += HOUR;                      // candidate low: L=90, H=95 (trigger)
  c.push(mk(t, 91, 92, 91, 91.5)); t += HOUR;
  c.push(mk(t, 91.5, 93, 91.5, 92)); t += HOUR;
  c.push(mk(t, 92, 94, 92, 93)); t += HOUR;
  c.push(mk(t, 93, 94.5, 93, 94)); t += HOUR;
  c.push(mk(t, 94, 100, 94, 99)); t += HOUR;                     // confirm: close 99 > 95; H=100 sets legHigh
  if (breakStopFirst) {
    c.push(mk(t, 99, 99.5, 85, 86)); t += HOUR;                  // gaps straight through the stop, never touches a level
    let p = 86;
    for (let i = 0; i < 20; i++) { c.push(mk(t, p, p + 0.5, p - 0.1, p + 0.4)); p += 0.3; t += HOUR; }
    return c;
  }
  c.push(mk(t, 99, 99.5, 96, 97)); t += HOUR;                    // pulls back, but not to either fib level yet
  c.push(mk(t, 97, 97.5, pullbackLow, 95.2)); t += HOUR;         // pullback low — fills whichever level it reaches
  let p = 95.2;
  for (let i = 0; i < 40; i++) { c.push(mk(t, p, p + 0.5, p - 0.1, p + 0.4)); p += 0.6; t += HOUR; } // grind to TP
  return c;
}

const FIB_CFG = {
  entryTf: "1h", entryMode: "fib_pullback", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 3,
  feeRate: 0.004, slipPct: 0.0005,
};

test("fib_pullback mode: a pullback into the 50% retracement fills at the level, stop below the originating low, TP at 3R", () => {
  const series = [{ label: "1h", mins: 60, candles: buildFibSeries({ pullbackLow: 94.5 }) }];
  const r = backtestMultiTF({ series }, { ...FIB_CFG, fibLevel: 0.5 });
  assert.equal(r.trades, 1);
  const entry = 95, stop = 90 - 0.001 * 90, risk = entry - stop;   // level = 100 - 0.5*(100-90) = 95
  const tp = entry + 3 * risk;
  const netWinR3 = 3 - (FEE * (entry + tp)) / risk;
  assert.ok(Math.abs(r.results[0] - netWinR3) < 1e-6,
    `winner R ${r.results[0]} != expected ${netWinR3}`);
});

test("fib_pullback mode: a pullback that stops short of the level (61.8%) never fills", () => {
  // Same series — its pullback low (94.5) clears the 50% level (95) but not the deeper
  // 61.8% level (93.82).
  const series = [{ label: "1h", mins: 60, candles: buildFibSeries({ pullbackLow: 94.5 }) }];
  const r = backtestMultiTF({ series }, { ...FIB_CFG, fibLevel: 0.618 });
  assert.equal(r.trades, 0, "pullback low 94.5 never reaches the deeper 93.82 level");
});

test("fib_pullback mode: price gapping straight through the stop before ever touching the limit level cancels the order", () => {
  const series = [{ label: "1h", mins: 60, candles: buildFibSeries({ breakStopFirst: true }) }];
  const r = backtestMultiTF({ series }, { ...FIB_CFG, fibLevel: 0.5 });
  assert.equal(r.trades, 0, "the resting order must be cancelled, not filled, once price closes the thesis out");
});

test("fib_pullback mode: only one resting order at a time — a fresh confirmed low while an order is pending does not open a second trade", () => {
  const series = [{ label: "1h", mins: 60, candles: buildFibSeries({ pullbackLow: 94.5 }) }];
  const r = backtestMultiTF({ series }, { ...FIB_CFG, fibLevel: 0.5 });
  assert.equal(r.trades, 1, "the long post-fill grind-up phase may itself contain new left-side lows; still exactly one trade");
});

// ── entryGate wiring in the generic dip-buy branch (TOURNAMENT_ROADMAP.md Track 3) ──
// entryGate was already wired into "anticipate" (backtest.js:415); this proves the
// identical check now also gates the generic branch breakout/support/etc. share, and
// that it is a true no-op — byte-identical output — whenever entryGate is omitted.
function buildBreakoutSeries() {
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, 100, 101, 99, 100)); t += HOUR; }   // flat baseline, ATR(14)=2
  c1h.push(mk(t, 100, 108, 100, 107)); t += HOUR;                                  // close 107 > 20-bar prior high 101
  let p = 107;
  for (let i = 0; i < 40; i++) { c1h.push(mk(t, p, p + 0.5, p - 0.1, p + 0.4)); p += 0.6; t += HOUR; } // grinds to TP
  return [{ label: "1h", mins: 60, candles: c1h }];
}

const BREAKOUT_CFG = {
  entryTf: "1h", entryMode: "breakout", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 3,
  feeRate: 0.004, slipPct: 0.0005,
};

test("breakout mode: entryGate is a true no-op when omitted (identical to an always-true gate)", () => {
  const series = buildBreakoutSeries();
  const withoutGate = backtestMultiTF({ series }, BREAKOUT_CFG);
  const withTrueGate = backtestMultiTF({ series }, { ...BREAKOUT_CFG, entryGate: () => true });
  assert.ok(withoutGate.trades > 0, "expected at least one trade from the breakout fixture");
  assert.deepEqual(withoutGate, withTrueGate);
});

test("breakout mode: entryGate rejecting every bar blocks the trade and tallies externalGate", () => {
  const series = buildBreakoutSeries();
  const r = backtestMultiTF({ series }, { ...BREAKOUT_CFG, entryGate: () => false });
  assert.equal(r.trades, 0);
  assert.ok(r.reasons.externalGate > 0);
});

// T1B-BREAKOUT-COSTFIX (TOURNAMENT_ROADMAP.md Track 1 follow-up): breakoutLookback makes
// the N-bar prior-high lookback configurable so a cost-reduction experiment can require
// a more significant (longer-lookback) breakout before entering, i.e. fewer, higher-
// conviction trades. Default 20 must reproduce the original hardcoded behaviour exactly.
test("breakout mode: breakoutLookback omitted is a true no-op (identical to explicit 20)", () => {
  const series = buildBreakoutSeries();
  const omitted = backtestMultiTF({ series }, BREAKOUT_CFG);
  const explicit20 = backtestMultiTF({ series }, { ...BREAKOUT_CFG, breakoutLookback: 20 });
  assert.deepEqual(omitted, explicit20);
});

test("breakout mode: a longer breakoutLookback can reject a candidate the default 20-bar window takes", () => {
  // Trigger candle closes at 107, above the 20-bar prior high of 101 (the flat baseline)
  // but NOT above 108 seen ~40 bars back — a lookback long enough to pull in that higher
  // prior bar must reject the same candidate the default 20-bar window accepts. Only a
  // couple of flat bars follow the trigger (not a sustained grind), so a later bar can't
  // independently re-trigger a breakout above 108 and confound the comparison; checking
  // `reasons.taken` (tallied at the entry-attempt bar, not on trade close) means the
  // still-open position's eventual resolution is irrelevant to this assertion.
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 10; i++) { c1h.push(mk(t, 100, 108, 99, 100)); t += HOUR; }  // a higher high 30-50 bars back
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, 100, 101, 99, 100)); t += HOUR; }  // flat baseline, ATR(14)=2
  c1h.push(mk(t, 100, 108, 100, 107)); t += HOUR;                                 // close 107: > 20-bar high 101, but < 40-bar high 108
  for (let i = 0; i < 3; i++) { c1h.push(mk(t, 107, 107.2, 106.9, 107)); t += HOUR; } // flat, no re-trigger
  const series = [{ label: "1h", mins: 60, candles: c1h }];

  const short = backtestMultiTF({ series }, { ...BREAKOUT_CFG, breakoutLookback: 20 });
  const long = backtestMultiTF({ series }, { ...BREAKOUT_CFG, breakoutLookback: 40 });
  assert.equal(short.reasons.taken, 1, "20-bar lookback should take the breakout above the recent 101 high");
  assert.equal(long.reasons.taken ?? 0, 0, "40-bar lookback must reject the same candidate: 107 does not clear the 108 high 40 bars back");
});

// T5-DECAY-EXIT (TOURNAMENT_ROADMAP.md, pre-registered 2026-08-07): the decay-exit
// experiment reuses the existing `maxHold` option (force a market exit at that bar's
// close once neither the stop nor the target has fired within `maxHold` bars of entry)
// rather than adding a duplicate mechanism. These tests prove it fires at exactly the
// bar threshold — not one bar early or late — and stays a true no-op when omitted.
function buildFlatHoldSeries(flatBarsAfterEntry) {
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, 100, 101, 99, 100)); t += HOUR; }   // flat baseline, ATR(14)=2
  c1h.push(mk(t, 100, 108, 100, 107)); t += HOUR;                                  // breakout: entry 107, stop 103, tp 119
  for (let i = 0; i < flatBarsAfterEntry; i++) { c1h.push(mk(t, 107, 107.5, 106.5, 107)); t += HOUR; } // pinned strictly between stop and tp
  return [{ label: "1h", mins: 60, candles: c1h }];
}

test("maxHold: forces the timeout exit at exactly openedAt+maxHold, not one bar early", () => {
  const notYet = buildFlatHoldSeries(4);  // data ends at openedAt+4
  const exact  = buildFlatHoldSeries(5);  // data ends at openedAt+5
  const rNotYet = backtestMultiTF({ series: notYet }, { ...BREAKOUT_CFG, maxHold: 5 });
  const rExact  = backtestMultiTF({ series: exact },  { ...BREAKOUT_CFG, maxHold: 5 });
  assert.equal(rNotYet.trades, 0, "maxHold:5 must not have fired yet by bar openedAt+4 (position still open, not counted)");
  assert.equal(rExact.trades, 1, "maxHold:5 must fire exactly at bar openedAt+5");
  assert.equal(rExact.exits.timeout, 1);
});

test("maxHold: omitted is a true no-op (identical to explicit default 100)", () => {
  const series = buildFlatHoldSeries(20);
  const omitted = backtestMultiTF({ series }, BREAKOUT_CFG);
  const explicit100 = backtestMultiTF({ series }, { ...BREAKOUT_CFG, maxHold: 100 });
  assert.deepEqual(omitted, explicit100);
});

// TRAIL-STOP-EXIT (100-strategy triage #100, pre-registered 2026-08-08): a dynamic
// trailing take-profit — remove the fixed TP, track the peak price since entry, exit
// the first time price pulls back `trailingTpPct` from that peak (indefinite hold
// otherwise, so `maxHold` also does not apply while this option is set). These tests
// prove the pullback exit fires at exactly the peak*(1-pct) threshold — not one tick
// early — and that omitting the option is a true no-op.
function buildTrailingTpSeries(afterPeak) {
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, 100, 101, 99, 100)); t += HOUR; }   // flat baseline, ATR(14)=2
  c1h.push(mk(t, 100, 108, 100, 107)); t += HOUR;                                  // breakout: entry 107, stop 103, risk 4
  let p = 107;
  for (let i = 0; i < 20; i++) { c1h.push(mk(t, p, p + 1, p, p + 1)); p += 1; t += HOUR; } // clean grind to a 127 peak
  for (const bar of afterPeak) { c1h.push(mk(t, ...bar)); t += HOUR; }
  return [{ label: "1h", mins: 60, candles: c1h }];
}

test("trailingTpPct: exits at exactly the peak pullback threshold, not one tick early", () => {
  const peak = 127, pct = 0.05, trigger = peak * (1 - pct);
  const notYet = buildTrailingTpSeries([[peak, peak, trigger + 0.01, trigger + 0.01]]); // stops just short
  const exact  = buildTrailingTpSeries([[peak, peak, trigger, trigger]]);               // touches the trigger exactly
  const rNotYet = backtestMultiTF({ series: notYet }, { ...BREAKOUT_CFG, trailingTpPct: pct });
  const rExact  = backtestMultiTF({ series: exact },  { ...BREAKOUT_CFG, trailingTpPct: pct });
  assert.equal(rNotYet.trades, 0, "must not fire while price stays above the pullback trigger (position still open)");
  assert.equal(rExact.trades, 1, "must fire exactly when price touches peak*(1-pct)");
  assert.equal(rExact.exits.trailingTp, 1);
  const netAt = (px, entry = 107, risk = 4) => (px - entry) / risk - (0.0045 * (entry + px)) / risk;
  assert.ok(Math.abs(rExact.results[0] - netAt(trigger)) < 1e-9,
    `R ${rExact.results[0]} != expected ${netAt(trigger)}`);
});

test("trailingTpPct: removes the fixed TP and the maxHold timeout while active", () => {
  // Grind straight through where the fixed TP (tpR=3 -> tp=119) would have fired, and
  // past maxHold's default 100 bars, without ever pulling back — position must still
  // be open (uncounted), proving neither the old TP nor maxHold applies.
  const c1h = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 30; i++) { c1h.push(mk(t, 100, 101, 99, 100)); t += HOUR; }
  c1h.push(mk(t, 100, 108, 100, 107)); t += HOUR;
  let p = 107;
  for (let i = 0; i < 110; i++) { c1h.push(mk(t, p, p + 1, p, p + 1)); p += 1; t += HOUR; }
  const series = [{ label: "1h", mins: 60, candles: c1h }];
  const r = backtestMultiTF({ series }, { ...BREAKOUT_CFG, trailingTpPct: 0.05 });
  assert.equal(r.trades, 0, "position must still be open — no fixed-TP exit and no maxHold timeout");
});

test("trailingTpPct: omitted is a true no-op (identical to explicit null)", () => {
  const series = buildTrailingTpSeries([[127, 127, 100, 100]]);
  const omitted = backtestMultiTF({ series }, BREAKOUT_CFG);
  const explicitNull = backtestMultiTF({ series }, { ...BREAKOUT_CFG, trailingTpPct: null });
  assert.deepEqual(omitted, explicitNull);
});

// ── direction ("short") — SHORT-SIDE-ENGINE-CAPABILITY ──────────────────────────
// Adds a short-entry path to "bos" mode only, using the already-detected swing-HIGH pivot
// as the mirror of a long entry's swing-LOW pivot. This item produces no research result —
// these tests exist only to prove the mechanics: stop above entry / target below entry
// (inverted placement), stop triggers on a HIGH not a low, target triggers on a LOW not a
// high, same-bar ambiguity still resolves to the stop, and every existing long-side result
// stays byte-for-byte unchanged now that `direction` exists.
//
// mirror() reflects a candle series through price 200 (open stays put in role, high<->low
// swap) so the short fixture reuses test 1's already-trusted BOS long fixture (pivot low 95
// / trigger 97.6, confirm entry 97.7, risk 2.7) instead of a hand-invented one: reflecting
// turns the swing-LOW pivot into a swing-HIGH pivot at the mirrored price, and — because the
// low pivot's confirm condition is "close > pivot high" and the high pivot's is "close <
// pivot low" — the confirm TIMING is provably identical under reflection (close > 97.6 in
// the original is exactly reflected-close < reflected-102.4 in the mirror).
function mirror(candles, R = 200) {
  return candles.map(c => ({
    time: c.time,
    open:  String(R - parseFloat(c.open)),
    high:  String(R - parseFloat(c.low)),
    low:   String(R - parseFloat(c.high)),
    close: String(R - parseFloat(c.close)),
    volume: c.volume,
  }));
}

// 30 baseline bars + pivot + confirm (32 candles) from test 1's fixture, mirrored: pivot
// high 105 (short stop), confirm close 102.3 (short entry), risk 2.7, tp at tpR=4 is 91.5.
// Drops the long-side grind (bars 33+) so each test appends its own single exit-path bar.
function shortEntryPrefix() {
  const long = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  return mirror(long[0].candles.slice(0, 32));
}
function withNextBar(prefix, bar) {
  const t = parseInt(prefix.at(-1).time) + HOUR;
  return [...prefix, mk(t, ...bar)];
}
const SHORT_CFG = {
  entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
  feeRate: 0.004, slipPct: 0.0005, direction: "short",
};
const netAtShort = (entry, px, risk) => (entry - px) / risk - (FEE * (entry + px)) / risk;

test("SHORT-SIDE-ENGINE-CAPABILITY: long-side results are byte-for-byte unchanged by the direction parameter's addition", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  const cfg = {
    entryTf: "1h", entryMode: "bos", alignMode: "none", trendGate: false, chopFilter: false,
    requireHigherLow: false, maxStopPct: null, minStopPct: null, lockBreakeven: false, tpR: 4,
    feeRate: 0.004, slipPct: 0.0005,
  };
  const withoutDirection = backtestMultiTF({ series }, cfg);
  const explicitLong = backtestMultiTF({ series }, { ...cfg, direction: "long" });
  assert.deepEqual(explicitLong, withoutDirection, "direction:\"long\" must be a true no-op, identical to omitting it");
  assert.equal(withoutDirection.trades, 1);
  assert.ok(Math.abs(withoutDirection.results[0] - netWinR(97.7, 2.7)) < 1e-9,
    "the underlying long fixture's numbers must still match this file's own long-standing expectation");
});

test("SHORT-SIDE-ENGINE-CAPABILITY: entry places the stop ABOVE entry and the target BELOW entry (inverted arithmetic)", () => {
  // Next bar: low 91 clears tp (~91.5) with margin; high 96 stays nowhere near the 105 stop.
  const series = [{ label: "1h", mins: 60, candles: withNextBar(shortEntryPrefix(), [95, 96, 91, 92]) }];
  const r = backtestMultiTF({ series }, SHORT_CFG);
  assert.equal(r.trades, 1);
  const [x] = r.excursions;
  assert.ok(Math.abs(x.entry - 102.3) < 1e-9, `entry ${x.entry} != expected 102.3`);
  assert.ok(x.exitPrice < x.entry, "target exit price must sit BELOW entry for a short");
  assert.ok(Math.abs(x.exitPrice - 91.5) < 1e-9, `tp exit ${x.exitPrice} != expected entry - tpR*risk = 91.5`);
  assert.ok(Math.abs(r.results[0] - netAtShort(102.3, 91.5, 2.7)) < 1e-9,
    `winner R ${r.results[0]} != expected ${netAtShort(102.3, 91.5, 2.7)}`);
});

test("SHORT-SIDE-ENGINE-CAPABILITY: the stop triggers on a HIGH breach, not a low", () => {
  // Next bar: high 105 exactly touches the stop; low 103 stays well clear of the 91.5 tp —
  // isolates the high-triggers-stop check from any same-bar target ambiguity.
  const series = [{ label: "1h", mins: 60, candles: withNextBar(shortEntryPrefix(), [103, 105, 103, 104]) }];
  const r = backtestMultiTF({ series }, SHORT_CFG);
  assert.equal(r.trades, 1);
  assert.equal(r.exits.stop, 1);
  const [x] = r.excursions;
  assert.ok(x.exitPrice > x.entry, "stop exit price must sit ABOVE entry for a short");
  assert.ok(Math.abs(x.exitPrice - 105) < 1e-9, `stop exit ${x.exitPrice} != expected 105`);
  assert.ok(r.results[0] < 0, "a stop-out must realize a loss");
  assert.ok(Math.abs(r.results[0] - netAtShort(102.3, 105, 2.7)) < 1e-9,
    `stop-out R ${r.results[0]} != expected ${netAtShort(102.3, 105, 2.7)}`);
});

test("SHORT-SIDE-ENGINE-CAPABILITY: the target triggers on a LOW breach, not a high", () => {
  // Next bar: low 91 clears tp (~91.5) with margin; high 96 stays well clear of the 105
  // stop — isolates the low-triggers-target check from any same-bar stop ambiguity.
  const series = [{ label: "1h", mins: 60, candles: withNextBar(shortEntryPrefix(), [95, 96, 91, 92]) }];
  const r = backtestMultiTF({ series }, SHORT_CFG);
  assert.equal(r.trades, 1);
  assert.equal(r.exits.target, 1);
});

test("SHORT-SIDE-ENGINE-CAPABILITY: same-bar stop+target ambiguity resolves to the stop, mirroring the long-side convention", () => {
  // Next bar touches BOTH the 105 stop (high) and the 91.5 tp (low) in one candle.
  const series = [{ label: "1h", mins: 60, candles: withNextBar(shortEntryPrefix(), [100, 105, 91.5, 95]) }];
  const r = backtestMultiTF({ series }, SHORT_CFG);
  assert.equal(r.trades, 1);
  assert.equal(r.exits.stop, 1);
  assert.equal(r.exits.target, undefined, "the target must not also register — only one exit per trade");
  const [x] = r.excursions;
  assert.ok(Math.abs(x.exitPrice - 105) < 1e-9, "the stop must win the same-bar ambiguity, not the target");
});

test("SHORT-SIDE-ENGINE-CAPABILITY: direction other than \"long\"/\"short\" throws", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  assert.throws(() => backtestMultiTF({ series }, { entryTf: "1h", direction: "sideways" }));
});

test("SHORT-SIDE-ENGINE-CAPABILITY: direction \"short\" is rejected for entryModes other than \"bos\"", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  assert.throws(() => backtestMultiTF({ series }, {
    entryTf: "1h", entryMode: "ma_dip", direction: "short", lockBreakeven: false,
  }));
});

test("SHORT-SIDE-ENGINE-CAPABILITY: direction \"short\" is rejected when lockBreakeven is left at its true default", () => {
  const series = buildSeries([[96, 97.8, 96, 97.7]], 97.7);
  assert.throws(() => backtestMultiTF({ series }, { entryTf: "1h", entryMode: "bos", direction: "short" }));
});

test('stopMode "atr" throws for an entryMode that would ignore it', () => {
  // sweep14 logged seven "breakout with an ATR stop" rows at seven values of atrStopK, every one
  // byte-identical to the structural run, because only "anticipate" implements the ATR stop. A
  // silently ignored parameter puts rows in the log under a label that was never applied.
  const series = [{ label: "1440", mins: 1440, candles: [] }];
  for (const entryMode of ["breakout", "bos", "rsi", "ma_dip"]) {
    assert.throws(() => backtestMultiTF({ series }, { entryMode, stopMode: "atr" }), /only implemented for entryMode "anticipate"/);
  }
  assert.doesNotThrow(() => backtestMultiTF({ series }, { entryMode: "anticipate", stopMode: "atr" }));
  assert.doesNotThrow(() => backtestMultiTF({ series }, { entryMode: "breakout" }));
});
