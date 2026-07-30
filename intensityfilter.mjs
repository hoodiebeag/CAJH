/**
 * intensityfilter.mjs — Does filtering out high-4h-trade-intensity entries improve the
 * live long-only strategy?
 *
 * blackboard.live_signal: 4h trade intensity showed IC -0.160 (z=-1.90) against 48h
 * forward returns — busy 4h bars tend to precede WEAKER returns. This tests the natural
 * follow-up: if the live strategy skips entries whose 4h bar was unusually busy, does
 * R/t improve on what's left?
 *
 * DATA-LIMITATION CORRECTION (checked before writing this, not assumed): the assignment
 * as given states "only BTC/ETH/SOL carry trades data, only for 2026, because archive-
 * ingested bars have trades=0." Verified directly against the store — that is FALSE for
 * the `trades` column specifically. Kraken's OHLCVT archive format includes a trades-
 * count column, and data.js's `ingestKrakenOHLCVT` parses it
 * (`trades: parseInt(trades) || 0`); confirmed empirically on LTCUSD (archive-ingested
 * only, never flow-backfilled): 1,293,046 of 1,293,047 stored bars have trades > 0. The
 * stated limitation IS correct for buyVol/sellVol/maxTrade — those genuinely are zeroed
 * on archive-ingested bars, so aggressor-imbalance / big-print features really are
 * BTC/ETH/SOL+2026-only. But trade INTENSITY only needs the trades column, which is
 * available for every watchlist pair across its full history. This script therefore
 * uses the full watchlist and full available history, not the stated 3-pair/2026-only
 * subset — strictly more data for exactly the feature under test — and calls that out
 * again in the printed output so it isn't silently lost.
 *
 * METHOD: backtestMultiTF (frozen; not modified) returns bare per-trade R numbers with
 * no entry timestamps, so a per-entry filter can't be injected into its result set after
 * the fact. First attempt was to reconstruct entry timestamps independently and align
 * them BY POSITION with backtestMultiTF's own results — that failed its own verification
 * check every time, because the real engine only opens a new trade when no position is
 * already open (a trade can span many bars), which a bare entry-trigger scan ignores.
 * Rather than risk a subtler version of the same mismatch, this file runs a fully
 * self-contained simulation (same rules: anticipation entry, structural stop, TP_R
 * target, breakeven lock, the live 4h stop band, no alignment gate — every constant
 * imported from strategy.js, not re-typed) that produces each trade's entry time AND its
 * net/gross R together, in one pass, so they are aligned by construction — no matching
 * step, and nothing to get subtly wrong. backtestMultiTF is still called once per pair,
 * unfiltered, purely as an independent cross-check against this simulation's own
 * unfiltered totals; any material divergence is reported, not hidden.
 *
 * Run: node intensityfilter.mjs
 */
import "dotenv/config";
import { loadCandles, loadBars } from "./data.js";
import { backtestMultiTF } from "./backtest.js";
import {
  isLeftLow, isLeftHigh, SWING_WINDOW, MIN_STOP_PCT, MAX_STOP_PCT_BY_TF, TP_R,
  LOCK_BREAKEVEN, BE_TRIGGER_R, BE_LOCK_R, FEE_BUFFER_PCT, FEE_RATE, SLIPPAGE_PCT,
} from "./strategy.js";
import { loadWatchlist, symbolToKrakenId, ts, stat } from "./researchlib.mjs";

const ENTRY_TF_LABEL = "4h";
const ENTRY_TF_MINS = 240;
const N = SWING_WINDOW;
const MAX_STOP = MAX_STOP_PCT_BY_TF[ENTRY_TF_LABEL];
const MAX_HOLD = 100;              // mirrors backtest.js's own (non-exported) default
const INTENSITY_LOOKBACK = 20;     // trailing bars for the trades-average baseline (matches flowsignal.mjs)
const MIN_ENTRIES_PER_CELL = 30;   // below this, a threshold's "improvement" is not trustworthy

const REGIMES = [
  ["2023",    ts("2023-01-01"), ts("2024-01-01")],
  ["2024",    ts("2024-01-01"), ts("2025-01-01")],
  ["2025-26", ts("2025-01-01"), ts("2027-01-01")],
  ["ALL",     0,                ts("2027-01-01")],
];

const liveCfg4h = (extra = {}) => ({
  entryTf: ENTRY_TF_LABEL, entryMode: "anticipate", alignMode: "none", trendGate: false,
  chopFilter: false, requireHigherLow: false, minStopPct: MIN_STOP_PCT, maxStopPct: MAX_STOP,
  tpR: TP_R, lockBreakeven: true, ...extra,
});

/** Roll 1-minute bars up to 4h, carrying only the `trades` count this file needs. */
function resampleTrades(bars, mins) {
  const span = mins * 60, out = new Map();
  for (const b of bars) {
    const t = Math.floor(b.time / span) * span;
    let c = out.get(t);
    if (!c) { c = { time: t, trades: 0 }; out.set(t, c); }
    c.trades += b.trades;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

/** 4h trade-intensity ratio timeline, keyed by bar time: trades vs the trailing
 *  20-bar average (same formula as flowsignal.mjs's `intensity` feature). */
function intensityByTime(bars1m) {
  const bars = resampleTrades(bars1m, ENTRY_TF_MINS);
  const map = new Map();
  for (let i = 0; i < bars.length; i++) {
    if (i < INTENSITY_LOOKBACK) continue;
    let sum = 0; for (let j = i - INTENSITY_LOOKBACK; j < i; j++) sum += bars[j].trades;
    const avg = sum / INTENSITY_LOOKBACK;
    if (avg > 0) map.set(bars[i].time, bars[i].trades / avg);
  }
  return map;
}

/**
 * Self-contained replica of backtest.js's entryMode==="anticipate" simulation loop
 * (structural stop, TP_R target, breakeven lock, the 4h stop band, no alignment gate —
 * matching liveCfg4h exactly). Returns each trade as { t: entryTime, entry, exitPx, risk }
 * — entry timing and resolution come from the SAME pass, so there is nothing to align
 * against anything else afterward.
 */
function simulate(candles) {
  const O = candles.map(c => +c.open), H = candles.map(c => +c.high);
  const L = candles.map(c => +c.low), C = candles.map(c => +c.close), T = candles.map(c => +c.time);
  let antCand = null, antHi = null, antTradedIdx = null, pos = null;
  const trades = [];

  for (let k = N; k < candles.length; k++) {
    // Entry check runs FIRST, exit check SECOND — matching backtest.js's actual loop
    // order exactly. This is not cosmetic: since the entry check is gated on `!pos`, a
    // position that the exit check closes on bar k was still "open" when the entry check
    // ran earlier in this same iteration, so the earliest a new entry can appear is k+1.
    // Reversing this order (as an earlier draft of this file did) lets a closed position
    // reopen same-bar, silently inflating both the trade count and total R — caught by
    // this file's own cross-check against backtestMultiTF, which is exactly why that
    // cross-check exists.
    if (!pos && antCand && k > antCand.index && antCand.index !== antTradedIdx && H[k] > antCand.trigger) {
      const entry = Math.max(O[k], antCand.trigger);
      const stop = antCand.price, risk = entry - stop, stopFrac = risk / entry;
      if (risk > 0 && stopFrac >= MIN_STOP_PCT && stopFrac <= MAX_STOP) {
        antTradedIdx = antCand.index;
        pos = { entry, stop, risk, tp: entry + TP_R * risk, beMoved: false, openedAt: k, t: T[k] };
        if (L[k] <= stop) { trades.push({ t: pos.t, entry, exitPx: stop, risk }); pos = null; }
      }
    }

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      if (lo <= pos.stop) { trades.push({ t: pos.t, entry: pos.entry, exitPx: pos.stop, risk: pos.risk }); pos = null; }
      else if (hi >= pos.tp) { trades.push({ t: pos.t, entry: pos.entry, exitPx: pos.tp, risk: pos.risk }); pos = null; }

      if (pos && LOCK_BREAKEVEN && !pos.beMoved) {
        const lockOffset = Math.max(BE_LOCK_R * pos.risk, FEE_BUFFER_PCT * pos.entry);
        const armOffset  = Math.max(BE_TRIGGER_R * pos.risk, lockOffset + 0.5 * pos.risk);
        if (hi >= pos.entry + armOffset) { pos.stop = Math.max(pos.stop, pos.entry + lockOffset); pos.beMoved = true; }
      }
      if (pos && k - pos.openedAt >= MAX_HOLD) {
        trades.push({ t: pos.t, entry: pos.entry, exitPx: C[k], risk: pos.risk }); pos = null;
      }
    }

    if (isLeftLow(L, k, N)  && (!antCand || L[k] < antCand.price)) antCand = { index: k, price: L[k], trigger: H[k] };
    if (isLeftHigh(H, k, N) && (!antHi  || H[k] > antHi.price))    antHi  = { index: k, price: H[k] };
    if (antCand && k > antCand.index && C[k] > antCand.trigger)   { antCand = null; antHi = null; }
    else if (antHi && k > antHi.index && C[k] < L[antHi.index])   { antCand = null; antHi = null; }
  }
  return trades;
}

const netROf   = (t) => (t.exitPx - t.entry) / t.risk - (FEE_RATE + SLIPPAGE_PCT) * (t.entry + t.exitPx) / t.risk;
const grossROf = (t) => (t.exitPx - t.entry) / t.risk;

// ── Pass 1: per pair, simulate (entries + net/gross R, aligned by construction), attach
// each entry's 4h trade-intensity value by timestamp, and cross-check the unfiltered
// aggregate against backtestMultiTF's own number for the same pair. ──
const watchlist = loadWatchlist();
const allEntries = [];   // { sym, t, intensity, net, gross }
const excluded = [];     // { sym, reason }
const crossChecks = [];  // { sym, simTrades, simTotalR, btTrades, btTotalR }

for (const sym of watchlist) {
  const id = symbolToKrakenId(sym);
  const candles = loadCandles(id, ENTRY_TF_MINS).slice(0, -1);
  if (candles.length < 200) { excluded.push({ sym, reason: `only ${candles.length} 4h bars` }); continue; }

  const bars1m = loadBars(id);
  const totalTrades = bars1m.reduce((a, b) => a + (b.trades || 0), 0);
  if (totalTrades === 0) { excluded.push({ sym, reason: "no trades data in the 1m store (never backfilled/ingested)" }); continue; }
  const imap = intensityByTime(bars1m);

  const simTrades = simulate(candles);
  const bt = backtestMultiTF({ series: [{ label: ENTRY_TF_LABEL, mins: ENTRY_TF_MINS, candles }] }, liveCfg4h());
  const simTotalR = simTrades.reduce((a, t) => a + netROf(t), 0);
  crossChecks.push({ sym, simTrades: simTrades.length, simTotalR, btTrades: bt.trades, btTotalR: bt.totalR });

  let missing = 0;
  for (const t of simTrades) {
    const intensity = imap.get(t.t);
    if (intensity == null) { missing++; continue; }
    allEntries.push({ sym, t: t.t, intensity, net: netROf(t), gross: grossROf(t) });
  }
  if (missing) excluded.push({ sym, reason: `${missing}/${simTrades.length} simulated entries had no intensity value at their timestamp (skipped, not pooled)` });
}

if (!allEntries.length) {
  console.log("\nNo pair produced usable, intensity-matched entries. Nothing to test.\n");
  process.exit(0);
}

// Fixed percentile cutoffs, computed ONCE from the full pooled distribution across every
// regime — calibrate once, apply the same absolute threshold everywhere, rather than
// letting the cutoff drift per regime (which would make the regimes incomparable).
const allIntensity = allEntries.map(e => e.intensity).sort((a, b) => a - b);
const pctile = (p) => allIntensity[Math.min(allIntensity.length - 1, Math.floor(allIntensity.length * p))];
const CUTOFFS = [
  ["no filter", Infinity],
  ["p90 (drop busiest 10%)", pctile(0.90)],
  ["p75 (drop busiest 25%)", pctile(0.75)],
  ["p50 (drop busiest 50%)", pctile(0.50)],
];

console.log(`\n=== Trade-intensity filter on the live 4h strategy (self-contained simulation) ===\n`);
console.log("DATA-LIMITATION CORRECTION: the assignment stated trades data is BTC/ETH/SOL+2026-only.");
console.log("That is true for buyVol/sellVol/maxTrade (genuinely zeroed on archive-ingested bars) but");
console.log("FALSE for the trades column itself — verified empirically (LTCUSD, archive-only: 1,293,046");
console.log("of 1,293,047 bars have trades > 0). This run uses the full watchlist and full history.\n");

console.log("Cross-check vs backtestMultiTF (unfiltered, same pair/config) — should be close, not exact");
console.log("(this simulation and the live engine can diverge slightly at series edges/rounding):");
for (const c of crossChecks) {
  const tradeDiff = Math.abs(c.simTrades - c.btTrades), rDiff = Math.abs(c.simTotalR - c.btTotalR);
  const flag = tradeDiff > 2 || rDiff > 2 ? "  ⚠ DIVERGES — treat this pair's entries with caution" : "";
  console.log(`  ${c.sym.padEnd(6)} sim: ${c.simTrades}t/${c.simTotalR.toFixed(1)}R   backtest: ${c.btTrades}t/${c.btTotalR.toFixed(1)}R${flag}`);
}
console.log("");

if (excluded.length) {
  console.log(`Excluded/flagged (${excluded.length}):`);
  for (const e of excluded) console.log(`  ${e.sym}: ${e.reason}`);
  console.log("");
}

console.log(`Pooled entries used: ${allEntries.length}. Percentile cutoffs (intensity ratio): ` +
  `p50=${CUTOFFS[3][1].toFixed(2)}  p75=${CUTOFFS[2][1].toFixed(2)}  p90=${CUTOFFS[1][1].toFixed(2)}\n`);

for (const [label, from, to] of REGIMES) {
  console.log(`--- ${label} ---`);
  console.log("  threshold                  trades   net R/t            gross R/t   win%");
  for (const [cLabel, cutoff] of CUTOFFS) {
    const sel = allEntries.filter(e => e.t >= from && e.t < to && e.intensity <= cutoff);
    const netR = sel.map(e => e.net), grossR = sel.map(e => e.gross);
    const s = stat(netR), g = stat(grossR);
    const flag = s.n > 0 && s.n < MIN_ENTRIES_PER_CELL ? "  ⚠ n<30 — not a reliable read" : "";
    console.log(`  ${cLabel.padEnd(26)} ${String(s.n).padStart(5)}   ` +
      `${(s.mean >= 0 ? "+" : "") + s.mean.toFixed(3)} ±${s.ci.toFixed(3)}   ` +
      `${(g.mean >= 0 ? "+" : "") + g.mean.toFixed(3)}      ${(s.wr * 100).toFixed(0)}%${flag}`);
  }
  console.log("");
}

console.log("Read this as: does R/t at p90/p75/p50 clearly exceed 'no filter', outside the overlapping CIs,");
console.log("with n staying well above 30? If the improvement only shows up where n has collapsed toward");
console.log("30, that is the sample shrinking, not the filter working — the design brief's own warning.\n");
