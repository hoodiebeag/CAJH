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
