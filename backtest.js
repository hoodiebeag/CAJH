/**
 * backtest.js — Simulate the strategy on historical candles (mirrors live rules).
 *
 * Timeframe-generic: takes an ascending `series` of TFs (live: 1h/4h/1d) and trades one
 * entry TF per run. The live rule is entryMode "anticipate" — enter the moment price
 * crosses above the current unconfirmed candidate swing low's trigger (the candidate
 * candle's high), stop at the candidate low, no alignment/trend gates. entryMode "bos"
 * (confirmed break-of-structure close, optional higher-TF gates) is kept for comparison.
 * Exits mirror live: stop, single take-profit (full position), and the optional
 * swing-high take-profit. Results are in "R" (multiples of the per-trade risk),
 * independent of position size.
 *
 * Caveats (read before trusting any number):
 *   • Fills are at the stop / target price, minus round-trip taker fees AND a slippage allowance (both in R).
 *   • If a candle touches BOTH stop and target, the stop is assumed to hit first.
 *   • Only as much history as Kraken returns (~720 candles). Small samples mislead.
 *   • Past performance does not predict future results.
 */

import {
  SWING_WINDOW, TP_R, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, MIN_STOP_PCT,
  EXIT_ON_SWING_HIGH, CHOP_FILTER, LOCK_BREAKEVEN, BE_TRIGGER_R, BE_LOCK_R, FEE_BUFFER_PCT, FEE_RATE, SLIPPAGE_PCT,
  TREND_GATE, TREND_GATE_MODE, TREND_MA, detectSwings, isLeftLow, isLeftHigh
} from "./strategy.js";
import { atr, atrPct, displacement, sweptLow, prevDayLevels, bullishFVGBelow, returnAsOf } from "./features.js";

const MAX_HOLD = 100; // close a trade after this many candles if neither stop nor target hits

/**
 * Timeline of [{ t, trending }] — was the timeframe making higher highs AND higher
 * lows as of each candle's close? Mirrors the live chop filter.
 */
function trendTimeline(candles, intervalMin, n) {
  const pivots = detectSwings(candles, n);
  const timeline = [];
  let pi = 0; const lows = [], highs = [];
  for (let i = 0; i < candles.length; i++) {
    while (pi < pivots.length && pivots[pi].confirmIndex <= i) {
      (pivots[pi].type === "low" ? lows : highs).push(pivots[pi].price); pi++;
    }
    const trending = lows.length >= 2 && highs.length >= 2 &&
      lows[lows.length - 1] > lows[lows.length - 2] &&
      highs[highs.length - 1] > highs[highs.length - 2];
    timeline.push({ t: parseInt(candles[i].time) + intervalMin * 60, trending });
  }
  return timeline;
}

/**
 * Returns a lookup function "value as of time t" over an ascending timeline, advancing
 * a cursor forward across calls instead of rescanning from the start each time. Only
 * correct when callers query with non-decreasing t (true here — t tracks the entry loop).
 */
function makeAsOf(timeline, key, initial, transform = (v) => v) {
  let i = 0, v = initial;
  return (t) => {
    while (i < timeline.length && timeline[i].t <= t) { v = transform(timeline[i][key]); i++; }
    return v;
  };
}

/** Timeline of [{ t, above }] — was each close above its `period` SMA at that candle? */
function maTimeline(candles, intervalMin, period) {
  const closes = candles.map(c => parseFloat(c.close));
  const tl = []; let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    const above = i >= period - 1 ? closes[i] > sum / period : false;
    tl.push({ t: parseInt(candles[i].time) + intervalMin * 60, above });
  }
  return tl;
}

/**
 * Timeline of [{ t: candleCloseTimeSec, bias }] for a timeframe, so we can ask
 * "what was this timeframe's bias as of time t?" Bias flips at each pivot's CONFIRM
 * candle (break of structure), matching how the live bot sees it.
 */
function biasTimeline(candles, intervalMin, n) {
  const pivots = detectSwings(candles, n); // chronological by confirmIndex
  const timeline = [];
  let pi = 0, lastType = null;
  for (let i = 0; i < candles.length; i++) {
    while (pi < pivots.length && pivots[pi].confirmIndex <= i) { lastType = pivots[pi].type; pi++; }
    timeline.push({ t: parseInt(candles[i].time) + intervalMin * 60, bias: lastType });
  }
  return timeline;
}

export function backtestMultiTF({ series } = {}, {
  n = SWING_WINDOW, tpR = TP_R,
  requireHigherLow = REQUIRE_HIGHER_LOW, maxStopPct = MAX_STOP_PCT, minStopPct = MIN_STOP_PCT,
  exitOnSwingHigh = EXIT_ON_SWING_HIGH, chopFilter = CHOP_FILTER,
  lockBreakeven = LOCK_BREAKEVEN, beTriggerR = BE_TRIGGER_R, beLockR = BE_LOCK_R, feeBufferPct = FEE_BUFFER_PCT,
  feeRate = FEE_RATE, slipPct = SLIPPAGE_PCT,
  trendGate = TREND_GATE, trendMa = TREND_MA, trendGateMode = TREND_GATE_MODE,
  // alignMode: how the higher timeframes' structural bias must line up before an entry is allowed.
  // ONLY CONSULTED BY entryMode "bos" AND "anticipate". Every other mode -- breakout, ma_dip, rsi,
  // support, fib_pullback, sweep_reclaim and the rest -- goes through the shared candidate branch,
  // which never computes alignment, so alignMode is inert for them. It is also inert for ALL modes
  // when `series` holds a single timeframe, since there are then no higher timeframes to align
  // against and every mode evaluates true. Note too that supplying a higher timeframe is not
  // alignment-only: `trendSrc` is the HIGHEST timeframe present, so adding one moves the trendGate
  // and chopFilter anchor and changes what trendMa counts in calendar time.
  entryTf = null, alignMode = "all", minRoomR = 0, entryMode = "bos",
  // Exit model (all optional; defaults reproduce the original 4R-or-die behaviour):
  trailR = null,          // trailing stop distance in R below the running peak (null = off)
  trailStartR = 1,        // only start trailing once price has run this many R
  partialAtR = null,      // bank `partialFrac` of the position at this R (null = off)
  partialFrac = 0.5,
  maxHold = MAX_HOLD,     // bars before a stale position is closed at the market
  // Dynamic trailing take-profit (null = off, true no-op): replaces the fixed TP with an
  // exit the first time price pulls back this fraction from the running peak price since
  // entry (e.g. 0.05 = 5%). While active, `maxHold` also does not apply to the position —
  // the hold is indefinite until the initial stop or the pullback trigger fires.
  trailingTpPct = null,
  // Stop placement. "structural" = the candidate swing low (what live does today).
  // "atr" = a volatility-scaled stop atrStopK ATRs below entry, so the invalidation is
  // the same "size of move" on a 1%-ATR major and a 8%-ATR alt. R scales with it, so a
  // wider stop means a proportionally smaller position, not more risk.
  // ONLY IMPLEMENTED FOR entryMode "anticipate". Every other mode places a structural stop
  // and ignores this; passing "atr" to one of them throws rather than silently doing nothing,
  // because a sweep once logged seven "breakout with an ATR stop" rows at seven values of
  // atrStopK, all byte-identical to the structural run, under a label it had never applied.
  stopMode = "structural",
  atrStopK = 3,
  atrPeriod = 14,
  // Bars of prior-high lookback for "breakout" mode's N-bar high trigger. Default 20
  // reproduces the original hardcoded behaviour byte-for-byte when omitted.
  breakoutLookback = 20,
  // "fib_pullback" mode's retracement fraction of the triggering swing leg (0.5 = 50%,
  // 0.618 = 61.8%). No-op for every other entryMode.
  fibLevel = 0.5,
  // Research-only entry veto. It receives only the completed entry bar's close time.
  // Live scanning never supplies this callback.
  entryGate = null,
  // EXECUTION-DELAY-DECAY-CURVE: bars of fill latency between signal and entry (0 = original
  // immediate-fill behaviour, unchanged). Only wired into "anticipate" mode and the shared
  // dip/breakout candidate branch (which "breakout" uses) — every other entryMode ignores it.
  // The stop level is fixed at signal time (structural, doesn't move); entry becomes the OPEN
  // of bar k+entryDelayBars, risk/tp are recomputed off that delayed entry. If the delay runs
  // past the end of the series, or price has already closed the risk to zero or below by fill
  // time, the trade is skipped entirely (tallied as reason "delaySkipped") rather than forced.
  entryDelayBars = 0,
  // SHORT-SIDE-ENGINE-CAPABILITY: "long" (default) reproduces every existing call site and
  // every recorded number byte-for-byte — this option is a pure additive no-op unless a
  // caller opts into "short". Only entryMode "bos" has a short-entry candidate: the mirror
  // of a long entry's confirmed swing LOW is a confirmed swing HIGH (already detected by
  // detectSwings and already tracked via highAt below), so short entries reuse that existing
  // structure rather than inventing a new one. Every other entryMode's candidate generator
  // (support/ma_dip/rsi/rev/breakout/vol_contraction/trend_pullback/sweep_reclaim/
  // range_sweep_reclaim/h3/anticipate/fib_pullback) is long-only and untouched.
  //
  // Placement is inverted honestly, not by negating outputs: stop sits ABOVE entry (at the
  // swing-high pivot), tp = entry - tpR*(stop-entry) sits BELOW entry, the stop triggers on
  // a bar's HIGH (not its low), and the target triggers on a bar's LOW (not its high) — see
  // the direction branch in the exit-resolution block below. The net-R cost formula
  // (feeRate+slipPct applied to (entry+exitPx)) is unchanged for shorts — that term doesn't
  // depend on direction, only the (px-entry) P&L term does; see `netAt` below.
  //
  // trailR, partialAtR, trailingTpPct, lockBreakeven, exitOnSwingHigh, requireHigherLow, and
  // minRoomR have not been made direction-aware and are rejected outright for "short" (see
  // the guard below) rather than silently producing wrong numbers.
  //
  // Known missing cost, stated explicitly per this item's own requirement: borrow
  // availability and borrow cost are NOT modeled anywhere in this engine — there is no
  // concept here of a borrow fee or of a short being unavailable/unlocatable. Any short P&L
  // this produces is before that cost. Separately, a short's loss is unbounded above (a
  // long's is bounded at zero at worst) — any future drawdown/survivability work on shorts
  // cannot reuse the long-side assumptions unchanged.
  //
  // This item runs no family and reports no avgR — it exists only so a later item can ask
  // whether short entries behave differently, which is currently unanswerable.
  direction = "long"
} = {}) {
  if (direction !== "long" && direction !== "short") {
    throw new Error(`backtestMultiTF: unknown direction "${direction}" (must be "long" or "short")`);
  }
  // Which options each entry mode actually honours.
  //
  // Eight parameters have now been found that backtestMultiTF accepted and silently ignored --
  // stopMode outside "anticipate", alignMode outside "bos"/"anticipate", the swing window for
  // breakout, trailStartR below trailR, entryGate in the bos branch, and chopFilter,
  // requireHigherLow and minRoomR for breakout. Every one produced a block of byte-identical rows
  // that read as a swept axis and was nothing of the kind, and every one was caught by hand after
  // the results were already recorded.
  //
  // So the ignoring is now declared and enforced. A mode absent from a list below ignores that
  // option, and passing a RESTRICTIVE value to a mode that ignores it throws.
  //
  // `alwaysOk` is what saves this from being useless. An option only makes a claim when it would
  // have restricted something: alignMode "none" asks for no alignment, which is precisely what a
  // mode ignoring alignment delivers, so it drops nothing and must not throw. The signature
  // default is likewise accepted everywhere, because a caller that omitted the option meant
  // nothing by it and cannot be distinguished from one that passed the default explicitly.
  const IGNORED_BY_MODE = [
    { option: "alignMode",        value: alignMode,        alwaysOk: ["all", "none"], honouredBy: ["bos", "anticipate"] },
    { option: "chopFilter",       value: chopFilter,       alwaysOk: [false],         honouredBy: ["bos", "anticipate"] },
    { option: "requireHigherLow", value: requireHigherLow, alwaysOk: [false],         honouredBy: ["bos"] },
    { option: "minRoomR",         value: minRoomR,         alwaysOk: [0],             honouredBy: ["bos"] },
  ];
  for (const { option, value, alwaysOk, honouredBy } of IGNORED_BY_MODE) {
    if (!alwaysOk.includes(value) && !honouredBy.includes(entryMode)) {
      throw new Error(`backtestMultiTF: "${option}" is only implemented for entryMode ${honouredBy.map((m) => `"${m}"`).join(" and ")}, not "${entryMode}" — it would be silently ignored and the run would be logged under a setting it never applied`);
    }
  }

  if (stopMode === "atr" && entryMode !== "anticipate") {
    throw new Error(`backtestMultiTF: stopMode "atr" is only implemented for entryMode "anticipate", not "${entryMode}" — it would be silently ignored and the run would be logged under a stop it never used`);
  }
  if (direction === "short") {
    if (entryMode !== "bos") {
      throw new Error(`backtestMultiTF: direction "short" is only implemented for entryMode "bos" — every other entryMode's candidate generator is long-only (SHORT-SIDE-ENGINE-CAPABILITY)`);
    }
    // SHORT-SIDE-ENGINE-CAPABILITY. The EXIT path is now fully mirrored -- trailR, partialAtR,
    // trailingTpPct, lockBreakeven and exitOnSwingHigh all work for shorts. What remains long-only
    // is the two ENTRY-side conditions, and they are genuinely unwritten rather than merely
    // untested: requireHigherLow asks for a rising sequence of swing lows, whose mirror is a
    // falling sequence of swing highs, and minRoomR measures clear air ABOVE entry using
    // nearestResAbove, whose mirror needs a nearestSupportBelow that does not exist.
    if (requireHigherLow || minRoomR) {
      throw new Error(`backtestMultiTF: direction "short" does not implement requireHigherLow or minRoomR — both are entry-side conditions written against a long's structure and their mirrors do not exist yet (SHORT-SIDE-ENGINE-CAPABILITY)`);
    }
  }
  // `series` = timeframes ascending, e.g. [{label:"1h",mins:60,candles},{label:"4h",...},{label:"1d",...}].
  // The entry TF (entryTf label, default the lowest) trades; everything ABOVE it is the
  // bias filter, and the highest TF anchors the chop/MA gate.
  if (!Array.isArray(series) || !series.length || series.some(s => !s?.candles?.length)) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [], excursions: [] };
  }
  const TFS = series;
  const ei  = entryTf ? TFS.findIndex(t => t.label === entryTf) : 0;
  if (ei < 0) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [], excursions: [] };
  }
  const entryCandles = TFS[ei].candles;
  const entryMins    = TFS[ei].mins;
  const higher       = TFS.slice(ei + 1).filter(t => t.candles?.length);   // bias-filter TFs
  const trendSrc     = higher.length ? higher[higher.length - 1] : TFS[ei]; // chop/MA anchor

  const O = entryCandles.map(c => parseFloat(c.open));
  const H = entryCandles.map(c => parseFloat(c.high));
  const L = entryCandles.map(c => parseFloat(c.low));
  const C = entryCandles.map(c => parseFloat(c.close));
  const V = entryCandles.map(c => parseFloat(c.volume) || 0);
  const T = entryCandles.map(c => parseInt(c.time));

  const pivE = detectSwings(entryCandles, n);
  const lowAt  = new Map();             // confirmIndex → low pivot (entry trigger)
  const highAt = new Set();             // confirmIndex of high pivots (swing-high exit)
  const highPivotAt = new Map();        // confirmIndex → high pivot (short-entry trigger; SHORT-SIDE-ENGINE-CAPABILITY, mirrors lowAt)
  for (const p of pivE) {
    if (p.type === "low") lowAt.set(p.confirmIndex, p);
    else                  { highAt.add(p.confirmIndex); highPivotAt.set(p.confirmIndex, p); }
  }

  // t queried below (tClose) only ever increases across the entry loop, so each of
  // these is a cursor that walks its timeline once instead of rescanning from the start.
  const biasAsOfFns = higher.map(t =>
    makeAsOf(biasTimeline(t.candles, t.mins, n), "bias", null, b => b === "low" ? "bull" : b === "high" ? "bear" : null));
  const trendAsOf   = makeAsOf(trendTimeline(trendSrc.candles, trendSrc.mins, n), "trending", false);
  const aboveMaAsOf = makeAsOf(maTimeline(trendSrc.candles, trendSrc.mins, trendMa), "above", false);

  // Overhead resistance: confirmed swing highs on the chop/MA anchor TF (4h for a
  // 15m/1h entry). Used by minRoomR to require clear air above entry before the target.
  const resHighs = detectSwings(trendSrc.candles, n)
    .filter(p => p.type === "high")
    .map(p => ({ t: parseInt(trendSrc.candles[p.confirmIndex].time) + trendSrc.mins * 60, price: p.price }));
  const nearestResAbove = (entry, t) => {
    let best = Infinity;
    for (const r of resHighs) if (r.t <= t && r.price > entry && r.price < best) best = r.price;
    return best;   // Infinity when nothing is overhead = unlimited room
  };

  // Entry-TF swing lows/highs as support/resistance levels (each usable only once confirmed).
  const swingLows  = pivE.filter(p => p.type === "low" ).map(p => ({ ci: p.confirmIndex, price: p.price }));
  const swingHighs = pivE.filter(p => p.type === "high").map(p => ({ ci: p.confirmIndex, price: p.price }));

  // ── support mode ── buy a dip into a prior swing low that closes back above it (bounce
  // off support), tight structural stop below it, ambitious target at the next swing high.
  const supportEntry = (k) => {
    const tol = 0.004;            // within 0.4% counts as a touch
    let support = null;
    for (const s of swingLows) {
      if (s.ci < k && L[k] <= s.price * (1 + tol) && L[k] >= s.price * (1 - 0.02)) {
        if (support == null || Math.abs(L[k] - s.price) < Math.abs(L[k] - support)) support = s.price;
      }
    }
    if (support == null || C[k] <= support) return null;   // must close back above support
    const entry = C[k];
    const stop  = Math.min(L[k], support) - 0.001 * entry; // tight, just below the level
    if (entry <= stop) return null;
    let target = Infinity;                                  // ambitious: next swing high above
    for (const h of swingHighs) if (h.ci < k && h.price > entry && h.price < target) target = h.price;
    if (!isFinite(target)) target = entry + tpR * (entry - stop);
    return { entry, stop, tp: target };
  };

  // ── ma_dip mode ── buy when price closes a set % below its own moving average
  // (oversold vs. its mean), tight stop under the dip, ambitious R-multiple target.
  const maAt = (k, period = 20) => {
    if (k < period - 1) return null;
    let s = 0; for (let j = k - period + 1; j <= k; j++) s += C[j];
    return s / period;
  };
  const maDipEntry = (k) => {
    const ma = maAt(k, 20); if (ma == null) return null;
    if (C[k] >= ma * (1 - 0.02)) return null;          // must be ≥2% below the mean
    const entry = C[k], stop = L[k] - 0.001 * entry;   // tight, under the dip
    if (entry <= stop) return null;
    return { entry, stop, tp: entry + tpR * (entry - stop) };
  };

  // ── rsi mode ── buy when Wilder RSI(14) crosses up out of oversold (<30 → ≥30).
  const rsiArr = (() => {
    const out = new Array(C.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < C.length; i++) {
      const ch = C[i] - C[i - 1], gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
      if (i <= 14) { avgGain += gain; avgLoss += loss; if (i === 14) { avgGain /= 14; avgLoss /= 14; out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); } }
      else { avgGain = (avgGain * 13 + gain) / 14; avgLoss = (avgLoss * 13 + loss) / 14; out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); }
    }
    return out;
  })();
  const rsiEntry = (k) => {
    if (rsiArr[k] == null || rsiArr[k - 1] == null) return null;
    if (!(rsiArr[k - 1] < 30 && rsiArr[k] >= 30)) return null;   // cross up out of oversold
    const entry = C[k];
    let lo = L[k]; for (let j = Math.max(0, k - 5); j < k; j++) lo = Math.min(lo, L[j]);
    const stop = lo - 0.001 * entry;
    if (entry <= stop) return null;
    return { entry, stop, tp: entry + tpR * (entry - stop) };
  };

  // ── rev mode ── the selective version of support: a bounce off support that holds,
  // but ONLY when lows are already turning up (this swing low is higher than the prior
  // one). Buys reversals, not falling knives — the feature the winning longs shared.
  const revEntry = (k) => {
    const base = supportEntry(k);
    if (!base) return null;
    const prior = swingLows.filter(s => s.ci < k);
    if (prior.length < 2) return null;
    if (!(prior[prior.length - 1].price > prior[prior.length - 2].price)) return null; // not a higher low
    return base;
  };

  // Trend-continuation candidates are intentionally research-only. Unlike the dip modes,
  // they require price to make a new N-bar high or resume above a rising moving average.
  // Their stops use ATR known before the entry candle, avoiding a volatility look-ahead.
  const breakoutEntry = (k) => {
    if (k < breakoutLookback) return null;
    let priorHigh = -Infinity;
    for (let j = k - breakoutLookback; j < k; j++) priorHigh = Math.max(priorHigh, H[j]);
    if (C[k] <= priorHigh) return null;
    const a = atr(H, L, C, k - 1, atrPeriod); if (!a) return null;
    const entry = C[k], stop = entry - 2 * a;
    return stop < entry ? { entry, stop, tp: entry + tpR * (entry - stop) } : null;
  };
  // ── vol_contraction mode ── TOURNAMENT_ROADMAP.md Track 2 (pre-registered 2026-08-06,
  // commit 8e9ae64): buy the close that breaks above a compression range, stop below the
  // range low. Compression at bar j = atr(j-1) < 0.5x the median of atr over [j-50, j-1];
  // ATR is always evaluated to the PREVIOUS bar, matching breakoutEntry's no-look-ahead
  // convention. The range is the contiguous compressed run immediately before k, scanned
  // back at most 50 bars, with a pre-registered 5-bar floor (below that it degenerates
  // into the 1-bar breakout Track 1 already tested).
  const volContractionEntry = (k) => {
    const isCompressed = (j) => {
      const aPrev = atr(H, L, C, j - 1, atrPeriod);
      if (aPrev == null) return false;
      const lo = Math.max(0, j - 50);
      const sample = [];
      for (let i = lo; i < j; i++) {
        const a = atr(H, L, C, i, atrPeriod);
        if (a != null) sample.push(a);
      }
      if (!sample.length) return false;
      sample.sort((x, y) => x - y);
      const mid = sample.length >> 1;
      const median = sample.length % 2 ? sample[mid] : (sample[mid - 1] + sample[mid]) / 2;
      return aPrev < 0.5 * median;
    };
    let runStart = k;
    for (let j = k - 1; j >= 0 && k - j <= 50 && isCompressed(j); j--) runStart = j;
    if (k - runStart < 5) return null;
    let rangeHigh = -Infinity, rangeLow = Infinity;
    for (let j = runStart; j < k; j++) { rangeHigh = Math.max(rangeHigh, H[j]); rangeLow = Math.min(rangeLow, L[j]); }
    if (C[k] <= rangeHigh) return null;
    const entry = C[k], stop = rangeLow - 0.001 * entry;
    return stop < entry ? { entry, stop, tp: entry + tpR * (entry - stop) } : null;
  };
  const trendPullbackEntry = (k) => {
    const fast = maAt(k, 20), slow = maAt(k, 50), previousFast = maAt(k - 1, 20);
    if (fast == null || slow == null || previousFast == null) return null;
    if (!(fast > slow && C[k - 1] <= previousFast && C[k] > fast)) return null;
    let low = L[k]; for (let j = Math.max(0, k - 5); j < k; j++) low = Math.min(low, L[j]);
    const entry = C[k], stop = low - .001 * entry;
    return stop < entry ? { entry, stop, tp: entry + tpR * (entry - stop) } : null;
  };
  // Range-reversal hypothesis: price sweeps the prior 12-bar low, then closes back above
  // that liquidity level. The trade is a reclaim, not an attempt to catch the falling bar.
  const sweepReclaimEntry = (k) => {
    const lookback = 12;
    if (k < lookback) return null;
    let priorLow = Infinity;
    for (let j = k - lookback; j < k; j++) priorLow = Math.min(priorLow, L[j]);
    if (!(L[k] < priorLow && C[k] > priorLow && C[k] > O[k])) return null;
    const a = atr(H, L, C, k - 1, atrPeriod); if (!a) return null;
    const entry = C[k], stop = L[k] - .25 * a;
    return stop < entry ? { entry, stop, tp: entry + tpR * (entry - stop) } : null;
  };
  // Selective range version: repeated support, a genuine sweep/reclaim, volume expansion,
  // and a flat 20/50 MA relationship. This is deliberately a separate hypothesis from
  // the broad sweep rule above.
  const rangeSweepReclaimEntry = (k) => {
    const lookback = 24;
    if (k < 50) return null;
    let support = Infinity, volumeSum = 0, touches = 0;
    for (let j = k - lookback; j < k; j++) support = Math.min(support, L[j]);
    for (let j = k - 20; j < k; j++) { volumeSum += V[j]; if (L[j] <= support * 1.005) touches++; }
    const fast = maAt(k, 20), slow = maAt(k, 50);
    if (touches < 2 || !fast || !slow || Math.abs(fast / slow - 1) > .02) return null;
    if (!(L[k] < support && C[k] > support && C[k] > O[k] && V[k] >= volumeSum / 20 * 1.2)) return null;
    const a = atr(H, L, C, k - 1, atrPeriod); if (!a) return null;
    const entry = C[k], stop = L[k] - .25 * a;
    return stop < entry ? { entry, stop, tp: entry + tpR * (entry - stop) } : null;
  };

  const h3Entry = (k) => {
    // H3 hypothesis: selective higher-low reclaim entry.
    // Require at least two prior confirmed swing lows and a higher-low structure,
    // then buy when price closes back above the most recent swing low (reclaim).
    const prior = swingLows.filter(s => s.ci < k);
    if (prior.length < 2) return null;
    const last = prior[prior.length - 1];
    const prev = prior[prior.length - 2];
    // require a higher low (selective reversal, not a falling knife)
    if (!(last.price > prev.price)) return null;
    // must close above the recent pivot (reclaim)
    if (C[k] <= last.price) return null;
    const entry = C[k];
    const stop = Math.min(L[k], last.price) - 0.001 * entry; // slightly below the pivot / bar low
    if (entry <= stop) return null;
    return { entry, stop, tp: entry + tpR * (entry - stop) };
  };

  const trades = [];
  // Per closed trade: realized R alongside the worst/best unrealized R seen while it was
  // open (MAE/MFE), measured from bars strictly after the entry bar — see MAE-MFE-STOP-
  // PLACEMENT-DIAGNOSTIC. Same length and order as `trades`.
  const excursions = [];
  const reasons = {};   // tally of why each candidate swing low was taken / rejected
  const exits   = {};   // tally of HOW each trade ended (stop / target / trail-be / partial / timeout)
  // Net R banked specifically by the partialAtR leg vs. every other leg (the runner, or a
  // full-size close when partialAtR is off) — lets a caller see how much of totalR came from
  // banking early vs. letting the remainder run, not just the blended per-trade average.
  let partialR = 0, runnerR = 0;
  let pos = null, prevLowPrice = null;
  let antCand = null, antHi = null;   // anticipate mode: running unconfirmed candidate low / high
  let antTradedIdx = null;            // candidate index already traded (one trade per level, mirrors live)
  let fibOrder = null;                // fib_pullback mode: resting limit order awaiting fill/cancel

  for (let k = n; k < entryCandles.length; k++) {
    const lowHere = lowAt.get(k); // a swing low confirmed at this candle on the entry TF?
    if (!pos && entryMode === "bos") {
     // Short's candidate is the mirror pivot: a confirmed swing HIGH instead of a confirmed
     // swing low. direction === "short" is guarded above to always reach here with
     // requireHigherLow/minRoomR both falsy, so those two checks below stay long-only
     // (lowHere-based) without needing a direction check of their own.
     const pivotHere = direction === "short" ? highPivotAt.get(k) : lowHere;
     if (pivotHere) {
      const tClose  = T[k] + entryMins * 60;
      const hb = biasAsOfFns.map(fn => fn(tClose));   // higher-TF biases as of entry
      let aligned;
      switch (alignMode) {
        case "none":    aligned = true; break;                            // entry-TF structure only
        case "first":   aligned = hb.length === 0 || hb[0] === "bull"; break; // nearest higher TF only
        case "notbear": aligned = hb.every(b => b !== "bear"); break;     // not actively downtrending
        case "all":
        default:        aligned = hb.every(b => b === "bull"); break;     // every higher TF bull (current)
      }
      let gateReason = aligned ? null : "notAligned";
      if (aligned && chopFilter && !trendAsOf(tClose)) { aligned = false; gateReason = "trendGate"; }
      if (aligned && trendGate) {
        const tg = trendGateMode === "structure"
          ? trendAsOf(tClose)     // 4h making higher highs AND higher lows
          : aboveMaAsOf(tClose);  // 4h close above its MA
        // Inverted for shorts. Both gate conditions describe an UPtrend, which is the state a long
        // wants and the opposite of what a short wants -- an uninverted gate would have permitted
        // shorts only into rising markets, which is worse than no gate at all.
        if (direction === "short" ? tg : !tg) { aligned = false; gateReason = "trendGate"; }
      }
      const entry = C[k];
      const stop  = pivotHere.price;
      const risk  = direction === "short" ? stop - entry : entry - stop;
      let ok = true, reason;
      if (risk <= 0)                                                              { ok = false; reason = "priceBelowStop"; }
      else if (!aligned)                                                          { ok = false; reason = gateReason; }
      else if (maxStopPct && risk / entry > maxStopPct)                           { ok = false; reason = "stopTooFar"; }
      else if (minStopPct && risk / entry < minStopPct)                           { ok = false; reason = "stopTooTight"; }
      else if (requireHigherLow && prevLowPrice != null && lowHere.price <= prevLowPrice) { ok = false; reason = "notHigherLow"; }
      else if (minRoomR && (nearestResAbove(entry, tClose) - entry) / risk < minRoomR)    { ok = false; reason = "noRoom"; }
      // entryGate was wired into the "anticipate" branch and the shared dip/breakout branch but
      // not into this one, so every filters spec was silently ignored for entryMode "bos". The
      // tell was a sweep of four BTC-regime periods returning four byte-identical rows.
      else if (entryGate && !entryGate(tClose))                                   { ok = false; reason = "externalGate"; }
      else                                                                        { reason = "taken"; }
      reasons[reason] = (reasons[reason] || 0) + 1;
      const tp = direction === "short" ? entry - tpR * risk : entry + tpR * risk;
      if (ok) pos = { entry, stop, risk, tp, direction, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: entry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
     }
    } else if (!pos && entryMode === "anticipate") {
      // ── anticipate mode ── mirrors live: enter the moment price trades ABOVE the
      // current unconfirmed candidate low's trigger (the candidate candle's high),
      // instead of waiting for the confirming close. Candidate state is updated at the
      // END of each bar, so this check uses only information from bars < k. Higher-TF
      // alignment and the trend gate apply here exactly as they do in "bos" mode —
      // live runs alignMode "none", but the whole point of the sweep is being able to
      // ask whether it should.
      if (antCand && k > antCand.index && antCand.index !== antTradedIdx && H[k] > antCand.trigger) {
        const entry = Math.max(O[k], antCand.trigger);   // a gap above the trigger fills at the open
        // ATR is taken to the PREVIOUS bar so the entry candle can't inflate its own stop.
        const aStop = stopMode === "atr" ? atr(H, L, C, k - 1, atrPeriod) : null;
        const stop  = stopMode === "atr"
          ? (aStop ? entry - atrStopK * aStop : NaN)
          : antCand.price;
        const risk = entry - stop;
        const tClose = T[k] + entryMins * 60;
        const hb = biasAsOfFns.map(fn => fn(tClose));
        let aligned;
        switch (alignMode) {
          case "none":    aligned = true; break;
          case "first":   aligned = hb.length === 0 || hb[0] === "bull"; break;
          case "notbear": aligned = hb.every(b => b !== "bear"); break;
          case "all":
          default:        aligned = hb.every(b => b === "bull"); break;
        }
        let gateReason = aligned ? null : "notAligned";
        if (aligned && chopFilter && !trendAsOf(tClose)) { aligned = false; gateReason = "trendGate"; }
        if (aligned && trendGate) {
          const tg = trendGateMode === "structure" ? trendAsOf(tClose) : aboveMaAsOf(tClose);
          if (!tg) { aligned = false; gateReason = "trendGate"; }
        }
        let reason = "taken";
        if (!(risk > 0))                                   reason = "priceBelowStop";   // also catches a missing ATR
        else if (!aligned)                                 reason = gateReason;
        else if (maxStopPct && risk / entry > maxStopPct)  reason = "stopTooFar";
        else if (minStopPct && risk / entry < minStopPct)  reason = "stopTooTight";
        else if (entryGate && !entryGate(tClose))           reason = "externalGate";
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (reason === "taken") {
          antTradedIdx = antCand.index;   // one trade per structural level (mirrors live cooldown)
          if (entryDelayBars > 0) {
            const fillIdx = k + entryDelayBars;
            const dEntry = fillIdx < entryCandles.length ? O[fillIdx] : null;
            const dRisk = dEntry != null ? dEntry - stop : null;
            if (dEntry == null || !(dRisk > 0)) {
              reasons.delaySkipped = (reasons.delaySkipped || 0) + 1;
            } else if (L[fillIdx] <= stop) {
              const r = (stop - dEntry) / dRisk - ((feeRate + slipPct) * (dEntry + stop)) / dRisk;
              trades.push(r);
              excursions.push({ r, mae: Math.max(0, (dEntry - L[fillIdx]) / dRisk), mfe: Math.max(0, (H[fillIdx] - dEntry) / dRisk), barsHeld: 0, entry: dEntry, risk: dRisk, exitPrice: stop });
            } else {
              pos = { entry: dEntry, stop, risk: dRisk, tp: dEntry + tpR * dRisk, beMoved: false, openedAt: fillIdx, open: 1, realized: 0, partialDone: false, peak: dEntry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
            }
          } else {
            pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: entry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
            // Intrabar order is unknowable: if this bar also traded at/below the stop,
            // assume the worst and take the stop on the entry bar.
            if (L[k] <= stop) {
              const r = (stop - entry) / risk - ((feeRate + slipPct) * (entry + stop)) / risk;
              trades.push(r);
              excursions.push({ r, mae: Math.max(0, (entry - L[k]) / risk), mfe: Math.max(0, (H[k] - entry) / risk), barsHeld: 0, entry, risk, exitPrice: stop });
              pos = null;
            }
          }
        }
      }
    } else if (!pos && entryMode === "fib_pullback") {
      // ── fib_pullback mode ── TEST1-FIB-PULLBACK: reuses "bos" mode's own confirmation
      // event verbatim (lowHere — a swing low's close breaking back above its own high, this
      // codebase's definition of a confirmed break-of-structure) as the "confirmed BOS
      // candle." Instead of entering at that close like "bos" does, the leg it just
      // completed (the swing low through the highest high reached by the confirming bar —
      // both already known, no look-ahead) sets a resting limit order at a Fibonacci
      // retracement of that leg, stop below the originating low, TP at tpR. One resting
      // order at a time; a fresh confirmation while an order is already resting is ignored,
      // mirroring anticipate mode's one-trade-per-level convention. If price reaches the
      // stop before ever touching the limit level, the order is cancelled rather than filled
      // — the thesis (this was a genuine swing low) is already wrong by then.
      if (fibOrder) {
        if (L[k] <= fibOrder.stop) {
          fibOrder = null;
        } else if (L[k] <= fibOrder.level) {
          const entry = Math.min(O[k], fibOrder.level);   // a gap through the level fills at the open
          const stop = fibOrder.stop, risk = entry - stop;
          let reason = "taken";
          if (!(risk > 0))                                    reason = "priceBelowStop";
          else if (maxStopPct && risk / entry > maxStopPct)   reason = "stopTooFar";
          else if (minStopPct && risk / entry < minStopPct)   reason = "stopTooTight";
          reasons[reason] = (reasons[reason] || 0) + 1;
          if (reason === "taken") pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: entry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
          fibOrder = null;   // one attempt per broken level, filled or not
        }
      } else if (lowHere) {
        let legHigh = -Infinity;
        for (let j = lowHere.index; j <= k; j++) legHigh = Math.max(legHigh, H[j]);
        const legLow = lowHere.price;
        if (legHigh > legLow) {
          const level = legHigh - fibLevel * (legHigh - legLow);
          fibOrder = { level, stop: legLow - 0.001 * legLow };
        }
      }
    } else if (!pos) {
      // Long dip-buy modes — no trend/alignment gate BY DEFAULT (the whole point), tight
      // structural stop + ambitious target. `trendGate` is opt-in here (off by default for
      // every family in tournament.mjs's `families` table), so passing it explicitly is the
      // only way to reach the check below — existing callers that never set it are unaffected.
      let cand = null;
       if (entryMode === "support") cand = supportEntry(k);
       else if (entryMode === "ma_dip") cand = maDipEntry(k);
       else if (entryMode === "rsi")    cand = rsiEntry(k);
       else if (entryMode === "rev")    cand = revEntry(k);
       else if (entryMode === "breakout") cand = breakoutEntry(k);
       else if (entryMode === "vol_contraction") cand = volContractionEntry(k);
       else if (entryMode === "trend_pullback") cand = trendPullbackEntry(k);
       else if (entryMode === "sweep_reclaim") cand = sweepReclaimEntry(k);
       else if (entryMode === "range_sweep_reclaim") cand = rangeSweepReclaimEntry(k);
       else if (entryMode === "h3")    cand = h3Entry(k);
      if (cand) {
        const risk = cand.entry - cand.stop;
        let reason = "taken";
        const tClose = T[k] + entryMins * 60;
        if (risk <= 0)                                          reason = "priceBelowStop";
        else if (maxStopPct && risk / cand.entry > maxStopPct)  reason = "stopTooFar";
        else if (minStopPct && risk / cand.entry < minStopPct)  reason = "stopTooTight";
        else if (trendGate && !(trendGateMode === "structure" ? trendAsOf(tClose) : aboveMaAsOf(tClose))) reason = "trendGate";
        else if (entryGate && !entryGate(tClose))               reason = "externalGate";
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (reason === "taken") {
          if (entryDelayBars > 0) {
            const fillIdx = k + entryDelayBars;
            const dEntry = fillIdx < entryCandles.length ? O[fillIdx] : null;
            const dRisk = dEntry != null ? dEntry - cand.stop : null;
            if (dEntry == null || !(dRisk > 0)) {
              reasons.delaySkipped = (reasons.delaySkipped || 0) + 1;
            } else if (L[fillIdx] <= cand.stop) {
              const r = (cand.stop - dEntry) / dRisk - ((feeRate + slipPct) * (dEntry + cand.stop)) / dRisk;
              trades.push(r);
              excursions.push({ r, mae: Math.max(0, (dEntry - L[fillIdx]) / dRisk), mfe: Math.max(0, (H[fillIdx] - dEntry) / dRisk), barsHeld: 0, entry: dEntry, risk: dRisk, exitPrice: cand.stop });
            } else {
              pos = { entry: dEntry, stop: cand.stop, risk: dRisk, tp: dEntry + tpR * dRisk, beMoved: false, openedAt: fillIdx, open: 1, realized: 0, partialDone: false, peak: dEntry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
            }
          } else {
            pos = { entry: cand.entry, stop: cand.stop, risk, tp: cand.tp, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: cand.entry, trailing: false, maxAdverseR: 0, maxFavorableR: 0 };
          }
        }
      }
    }
    if (lowHere) prevLowPrice = lowHere.price;

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      const isShort = pos.direction === "short";
      // Track the worst/best unrealized R this bar reached, before any exit this bar closes
      // the position — MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC. The exit bar's own excursion counts:
      // MAE/MFE is "how far price ran", not "how far it ran before the exit price specifically".
      // For a short, adverse is price rising (hi) and favorable is price falling (lo) — the
      // mirror of a long (SHORT-SIDE-ENGINE-CAPABILITY).
      pos.maxAdverseR = Math.max(pos.maxAdverseR, isShort ? (hi - pos.entry) / pos.risk : (pos.entry - lo) / pos.risk);
      pos.maxFavorableR = Math.max(pos.maxFavorableR, isShort ? (pos.entry - lo) / pos.risk : (hi - pos.entry) / pos.risk);
      // Net R of the FULL position exiting at `px`: gross R minus fees+slippage, with the
      // entry leg on the entry notional and the exit leg on the exit notional (matches
      // monitor.js's live P&L). A partial leg of fraction f is simply f × this value, so
      // scale-outs stay exactly consistent with full exits. The fee/slippage term below is
      // applied to (entry+px) either way and does not depend on direction — only the
      // directional P&L term (the first line) flips for a short.
      const netAt = (px) => (isShort ? (pos.entry - px) / pos.risk : (px - pos.entry) / pos.risk)
        - ((feeRate + slipPct) * (pos.entry + px)) / pos.risk;
      // Close `frac` of what's left at `px`; bank the trade once nothing remains.
      const closeLeg = (px, frac, why) => {
        const f = Math.min(frac, pos.open);
        const legR = f * netAt(px);
        pos.realized += legR;
        if (why === "partial+runner") partialR += legR; else runnerR += legR;
        pos.open -= f;
        if (pos.open <= 1e-9) {
          trades.push(pos.realized);
          // entryTime: DATE-CLUSTERED-RESAMPLING-AUDIT — the entry candle's unix time, purely
          // additive (every pre-existing field is unchanged), so callers can group trades by
          // calendar day without backtest.js knowing anything about resampling itself.
          // why: MADIP-REALISED-R-CONDITION-2 — the reason the closing leg fired (same value
          // just recorded into `exits[why]` below), attached per-trade so callers can break
          // down R by exit reason without backtest.js knowing anything about that analysis.
          excursions.push({ r: pos.realized, mae: pos.maxAdverseR, mfe: pos.maxFavorableR, barsHeld: k - pos.openedAt, entry: pos.entry, risk: pos.risk, exitPrice: px, entryTime: T[pos.openedAt], why });
          exits[why] = (exits[why] || 0) + 1;
          pos = null;
        }
      };

      // Stop first, against the stop as it stood entering this candle (conservative: if
      // both stop and target are touched in one bar, assume the stop hit first).
      // trailingTpPct replaces the fixed TP: the pullback trigger is checked against the
      // peak as it stood entering this candle (updated below, after this check, so it
      // only binds on later candles — same ordering as the trailR trailing stop). Long-only:
      // direction "short" is guarded at entry to never reach here with trailingTpPct set.
      //
      // A short's stop sits ABOVE entry and triggers on the bar's HIGH; its target sits
      // BELOW entry and triggers on the bar's LOW — the mirror of a long's low-triggers-stop,
      // high-triggers-target (SHORT-SIDE-ENGINE-CAPABILITY). Same-bar ambiguity still
      // resolves to the stop first, for the same conservative reason as the long path.
      // SHORT-SIDE-ENGINE-CAPABILITY. Every exit below is now mirrored rather than long-only, so
      // the two sides are judged by the same machinery. Four quantities flip, and they are named
      // once here so each block can be read as the single expression it is:
      //
      //   sign      +1 long, -1 short. "Favourable" is entry + sign*distance.
      //   best      the best price reached since entry: the running HIGH for a long, the running
      //             LOW for a short. Both start at the entry price and only ever improve.
      //   favours   did this bar reach a favourable price? the high for a long, the low for a short.
      //   tighten   a stop may only ever move toward the entry side: max() for a long (upward),
      //             min() for a short (downward). Using the wrong one would silently LOOSEN a stop.
      const sign = isShort ? -1 : 1;
      const favours = isShort ? lo : hi;
      const tighten = (a, b) => (isShort ? Math.min(a, b) : Math.max(a, b));
      const reached = (px) => (isShort ? lo <= px : hi >= px);

      if (isShort) {
        if (hi >= pos.stop) closeLeg(pos.stop, pos.open, pos.beMoved || pos.trailing ? "trail/be" : "stop");
        else if (!trailingTpPct && lo <= pos.tp) closeLeg(pos.tp, pos.open, "target");
        else if (trailingTpPct && pos.peak < pos.entry) {
          // Mirror of the long's pullback-from-peak: a short exits on a BOUNCE from the trough.
          const bouncePx = pos.peak * (1 + trailingTpPct);
          if (hi >= bouncePx) closeLeg(bouncePx, pos.open, "trailingTp");
        }
      } else {
        if (lo <= pos.stop) closeLeg(pos.stop, pos.open, pos.beMoved || pos.trailing ? "trail/be" : "stop");
        else if (!trailingTpPct && hi >= pos.tp) closeLeg(pos.tp, pos.open, "target");
        else if (trailingTpPct && pos.peak > pos.entry) {
          const pullbackPx = pos.peak * (1 - trailingTpPct);
          if (lo <= pullbackPx) closeLeg(pullbackPx, pos.open, "trailingTp");
        }
      }

      // Partial scale-out: bank `partialFrac` at the partial target, let the rest run.
      if (pos && partialAtR && !pos.partialDone) {
        const px = pos.entry + sign * partialAtR * pos.risk;
        if (reached(px)) {
          pos.partialDone = true;
          closeLeg(px, partialFrac, "partial+runner");
        }
      }

      // Trailing stop: once price has run trailStartR in the favourable direction, keep the stop
      // trailR behind the best price reached. Updated after the stop check, so it only binds on
      // later candles.
      if (pos && trailR) {
        pos.peak = tighten(pos.peak, favours);
        const armedAt = pos.entry + sign * trailStartR * pos.risk;
        if (isShort ? pos.peak <= armedAt : pos.peak >= armedAt) {
          // MINUS sign, not plus. `sign` points the FAVOURABLE way, which is right for a partial
          // target or a breakeven lock -- both sit on the profitable side of a reference price. A
          // trailing stop sits on the ADVERSE side of the peak. With `+` a long's stop was placed
          // ABOVE its own peak, so the next bar's low was always at or under it and the position
          // exited at a price no bar had traded: peak 100.7 gave a stop of 103.4 and a fill there
          // on a bar whose high was 101.7.
          pos.stop = tighten(pos.stop, pos.peak - sign * trailR * pos.risk);
          pos.trailing = true;
        }
      }

      // Trailing take-profit: extend the best price for the next candle's reversal check above.
      // Updated after that check, so it only binds on later candles.
      if (pos && trailingTpPct) pos.peak = tighten(pos.peak, favours);

      // Breakeven-plus: once this candle reaches the trigger, move the stop past entry on the
      // profitable side for subsequent candles.
      if (pos && lockBreakeven && !pos.beMoved) {
        const lockOffset = Math.max(beLockR * pos.risk, feeBufferPct * pos.entry);
        const armOffset  = Math.max(beTriggerR * pos.risk, lockOffset + 0.5 * pos.risk);
        if (reached(pos.entry + sign * armOffset)) {
          pos.stop = tighten(pos.stop, pos.entry + sign * lockOffset);
          pos.beMoved = true;
        }
      }
      // Structure-based take-profit while in profit: a confirmed swing HIGH ends a long, a
      // confirmed swing LOW ends a short.
      if (pos && exitOnSwingHigh && (isShort ? lowAt.has(k) : highAt.has(k))
          && (isShort ? C[k] < pos.entry : C[k] > pos.entry)) closeLeg(C[k], pos.open, "swingHigh");
      // trailingTpPct holds the position indefinitely (stop or pullback only) — no timeout.
      if (pos && !trailingTpPct && k - pos.openedAt >= maxHold) closeLeg(C[k], pos.open, "timeout");
    }

    // Anticipation candidate tracking — same transitions as detectSwings/pendingSwingLow,
    // updated at bar close so the entry check above never sees the current bar's own state.
    if (entryMode === "anticipate") {
      if (isLeftLow(L, k, n)  && (!antCand || L[k] < antCand.price)) antCand = { index: k, price: L[k], trigger: H[k] };
      if (isLeftHigh(H, k, n) && (!antHi  || H[k] > antHi.price))    antHi  = { index: k, price: H[k] };
      if (antCand && k > antCand.index && C[k] > antCand.trigger)   { antCand = null; antHi = null; }
      else if (antHi && k > antHi.index && C[k] < L[antHi.index])   { antCand = null; antHi = null; }
    }
  }

  const count  = trades.length;
  const wins   = trades.filter(r => r > 0).length;
  const totalR = trades.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of trades) { eq += r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }

  return {
    trades: count,
    winRate: count ? wins / count : 0,
    totalR,
    avgR: count ? totalR / count : 0,
    maxDrawdownR: maxDD,
    results: trades,  // raw per-trade R values, for pooling across pairs
    excursions,       // [{ r, mae, mfe, barsHeld, entry, risk, exitPrice }] per closed trade, same order as `results`.
                      // entry/risk are the position's fixed entry price and initial (stop-derived)
                      // risk-per-share — unaffected by later breakeven/trailing stop moves, matching
                      // what `r` was actually computed against. exitPrice is the final closing leg's
                      // price (for a partial+runner trade, the runner leg's price, not a blend).
    exits,            // { stop, target, "trail/be", "partial+runner", swingHigh, timeout }
    reasons,          // { taken, stopTooTight, stopTooFar, trendGate, notAligned, notHigherLow, priceBelowStop }
    partialR,         // net R banked by partialAtR legs specifically (0 when partialAtR is off)
    runnerR           // net R banked by every other leg (the remainder/runner, or a full close)
  };
}

/**
 * excursionProfile — "are the stops too tight?", answered from the data.
 *
 * For every live-rule entry (anticipation: price crossing an unconfirmed candidate swing
 * low's trigger) this walks forward and records how far price ran AGAINST the entry before
 * it ran FOR it — MAE (max adverse excursion) and MFE (max favorable excursion) — measured
 * in ATRs, so a 3%-a-day alt and a 0.5%-a-day major are on one scale.
 *
 * It also runs a first-passage grid: for each candidate stop distance k·ATR and target
 * m·ATR, which one price reaches FIRST. That turns "should the stop be wider?" into a
 * measured surface rather than an opinion — and because expectancy is reported gross as
 * well as net, it separates "the stop was wrong" from "there is nothing here to capture".
 *
 * Returns { n, atrPctMean, structStopATR, mae, mfe, maeOfRunners, grid }.
 */
export function excursionProfile({ series } = {}, {
  entryTf = null, n = SWING_WINDOW, horizon = 200,
  kGrid = [0.5, 0.75, 1, 1.5, 2, 3, 4], mGrid = [1, 1.5, 2, 3, 4, 6],
  feeRate = FEE_RATE, slipPct = SLIPPAGE_PCT, atrPeriod = 14,
} = {}) {
  const empty = { n: 0, grid: [] };
  if (!Array.isArray(series) || !series.length) return empty;
  const ei = entryTf ? series.findIndex(s => s.label === entryTf) : 0;
  if (ei < 0 || !series[ei]?.candles?.length) return empty;
  const candles = series[ei].candles;

  const O = candles.map(c => parseFloat(c.open));
  const H = candles.map(c => parseFloat(c.high));
  const L = candles.map(c => parseFloat(c.low));
  const C = candles.map(c => parseFloat(c.close));

  // Cells accumulate first-passage outcomes for every (stop k·ATR, target m·ATR) pair.
  const grid = [];
  for (const k of kGrid) for (const m of mGrid) grid.push({ k, m, wins: 0, losses: 0, open: 0, gross: 0, net: 0 });

  const maes = [], mfes = [], structs = [], atrPcts = [], maeRunners = [];
  let count = 0;
  let cand = null, hi = null, tradedIdx = null;

  for (let i = 0; i < candles.length; i++) {
    // Entry check uses only candidate state built from bars < i (updated at bar end below).
    if (cand && i > cand.index && cand.index !== tradedIdx && H[i] > cand.trigger) {
      const a = atr(H, L, C, i - 1, atrPeriod);
      if (a && a > 0 && i + horizon < candles.length) {
        const entry = Math.max(O[i], cand.trigger);
        tradedIdx = cand.index;
        count++;
        atrPcts.push((a / entry) * 100);
        structs.push((entry - cand.price) / a);       // how many ATRs away the swing-low stop sits

        // One forward walk records first-passage bars for every k and every m at once.
        const stopBar = kGrid.map(() => Infinity), tgtBar = mGrid.map(() => Infinity);
        let runMin = Infinity, runMax = -Infinity;
        // maeBeforeRun is the number that actually governs stop placement: how deep the
        // trade dipped BEFORE it first ran RUN_ATR in our favour. (Max adverse excursion
        // over the whole horizon is not that number — it is mostly just the asset's range
        // over `horizon` bars, and it keeps growing the longer you look.)
        const RUN_ATR = 2;
        let maeBeforeRun = 0, ranFar = false;
        for (let j = i + 1; j <= i + horizon; j++) {
          runMin = Math.min(runMin, L[j]); runMax = Math.max(runMax, H[j]);
          if (!ranFar) {
            maeBeforeRun = Math.max(maeBeforeRun, (entry - runMin) / a);
            if (runMax >= entry + RUN_ATR * a) ranFar = true;
          }
          kGrid.forEach((k, ki) => { if (stopBar[ki] === Infinity && runMin <= entry - k * a) stopBar[ki] = j; });
          mGrid.forEach((m, mi) => { if (tgtBar[mi] === Infinity && runMax >= entry + m * a) tgtBar[mi] = j; });
        }
        // Excursions are magnitudes and floor at zero: a trade that never traded below
        // entry has NO adverse excursion, rather than a negative one.
        const mae = Math.max(0, (entry - runMin) / a), mfe = Math.max(0, (runMax - entry) / a);
        maes.push(mae); mfes.push(mfe);
        if (ranFar) maeRunners.push(Math.max(0, maeBeforeRun));   // winners only: the dip they had to survive

        let gi = 0;
        for (let ki = 0; ki < kGrid.length; ki++) {
          for (let mi = 0; mi < mGrid.length; mi++, gi++) {
            const cell = grid[gi], risk = kGrid[ki] * a;
            // Same-bar ambiguity resolves against us: a tie counts as the stop.
            if (tgtBar[mi] < stopBar[ki]) {
              const px = entry + mGrid[mi] * a;
              cell.wins++; cell.gross += mGrid[mi] / kGrid[ki];
              cell.net += mGrid[mi] / kGrid[ki] - ((feeRate + slipPct) * (entry + px)) / risk;
            } else if (stopBar[ki] < Infinity) {
              const px = entry - kGrid[ki] * a;
              cell.losses++; cell.gross -= 1;
              cell.net += -1 - ((feeRate + slipPct) * (entry + px)) / risk;
            } else {
              // Neither level reached inside the horizon — close at the horizon's price.
              const px = C[i + horizon], r = (px - entry) / risk;
              cell.open++; cell.gross += r;
              cell.net += r - ((feeRate + slipPct) * (entry + px)) / risk;
            }
          }
        }
      }
    }

    // Candidate transitions (identical to pendingSwingLow / the anticipate backtest).
    if (isLeftLow(L, i, n)  && (!cand || L[i] < cand.price)) cand = { index: i, price: L[i], trigger: H[i] };
    if (isLeftHigh(H, i, n) && (!hi   || H[i] > hi.price))   hi   = { index: i, price: H[i] };
    if (cand && i > cand.index && C[i] > cand.trigger) { cand = null; hi = null; }
    else if (hi && i > hi.index && C[i] < L[hi.index])  { cand = null; hi = null; }
  }

  const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const summary = (arr) => ({ p25: q(arr, 0.25), p50: q(arr, 0.5), p75: q(arr, 0.75), p90: q(arr, 0.9) });
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    n: count,
    atrPctMean: mean(atrPcts),
    structStopATR: summary(structs),
    mae: summary(maes),
    mfe: summary(mfes),
    maeOfRunners: summary(maeRunners),
    runnerShare: count ? maeRunners.length / count : 0,
    grid,
  };
}

/**
 * profileEntries — the data-speaks-for-itself engine.
 *
 * Walks EVERY swing-low long candidate (no gates — every place you *could* go long),
 * resolves each to a winner (price hits the take-profit target first) or loser (hits
 * the stop first), and records the features cajh already computes at the moment of
 * entry. Aggregating winners vs losers shows what — if anything — separates them.
 * An edge is a feature where winners and losers DIVERGE; a feature they share is a
 * mirage. Breakeven is intentionally off so every entry resolves cleanly to win/loss.
 */
export function profileEntries({ series, btc4h } = {}, { tpR = TP_R, n = SWING_WINDOW, feeRate = FEE_RATE, slipPct = SLIPPAGE_PCT } = {}) {
  const records = [];
  // `series` = timeframes ascending: series[0] is the entry TF that is profiled; the
  // higher TFs feed the biasMid/biasHigh context fields.
  if (!Array.isArray(series) || !series.length || series.some(s => !s?.candles?.length)) return { records };
  const entryTf   = series[0];
  const higherTfs = series.slice(1);
  const candlesE  = entryTf.candles;

  // Uniform resolution window: every candidate gets exactly HORIZON bars to resolve, and
  // candidates whose window would be cut off by the end of the data are excluded entirely.
  // Without this, the tail of the data over-counts losers: losses resolve fast (stop is 1R
  // away) while tpR-multiple wins resolve slowly, so a truncated window censors wins
  // asymmetrically — and the tail is exactly the out-of-sample region discover scores on.
  const HORIZON = 300; // entry-TF bars (1h ≈ 12.5 days); "win/loss" means "resolves within this window"

  const C = candlesE.map(c => parseFloat(c.close));
  const H = candlesE.map(c => parseFloat(c.high));
  const L = candlesE.map(c => parseFloat(c.low));
  const V = candlesE.map(c => parseFloat(c.volume) || 0);
  const T = candlesE.map(c => parseInt(c.time));

  // RSI(14), Wilder
  const rsi = new Array(C.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < C.length; i++) {
    const ch = C[i] - C[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 14) { ag += g; al += l; if (i === 14) { ag /= 14; al /= 14; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  const maAt = (k) => { if (k < 19) return null; let s = 0; for (let j = k - 19; j <= k; j++) s += C[j]; return s / 20; };

  const piv   = detectSwings(candlesE, n);
  const lows  = piv.filter(p => p.type === "low");
  const highs = piv.filter(p => p.type === "high");

  const biasAt = (candles, mins, t) => {
    const ps = detectSwings(candles, n);
    let b = null;
    for (const pp of ps) { const ct = parseInt(candles[pp.confirmIndex].time) + mins * 60; if (ct <= t) b = pp.type; else break; }
    return b === "low" ? "bull" : b === "high" ? "bear" : null;
  };

  for (let li = 0; li < lows.length; li++) {
    const low = lows[li];
    const k = low.confirmIndex;
    if (k >= C.length) continue;
    const entry = C[k], stop = low.price, risk = entry - stop;
    if (risk <= 0) continue;
    // Match live: only profile setups the strategy would actually take (stop in the tradeable
    // band). Without this, discover is dominated by tiny-stop candidates whose fee+slippage
    // cost in R guarantees a loss — and which MIN/MAX_STOP_PCT skips live anyway.
    const stopFrac = risk / entry;
    if ((MIN_STOP_PCT != null && stopFrac < MIN_STOP_PCT) || (MAX_STOP_PCT != null && stopFrac > MAX_STOP_PCT)) continue;
    const target = entry + tpR * risk;

    if (k + HORIZON >= C.length) continue;  // window would be truncated by data end — skip
    let outcome = null;
    for (let j = k + 1; j <= k + HORIZON; j++) {
      if (L[j] <= stop)   { outcome = "loss"; break; }
      if (H[j] >= target) { outcome = "win";  break; }
    }
    if (!outcome) continue;   // never resolved within the window — skip (uniform for every candidate)

    const m = maAt(k);
    const tClose = T[k] + entryTf.mins * 60;
    let res = Infinity;
    for (const h of highs) if (h.confirmIndex < k && h.price > entry && h.price < res) res = h.price;
    let loN = L[k], hiN = H[k];
    for (let j = Math.max(0, k - 20); j <= k; j++) { loN = Math.min(loN, L[j]); hiN = Math.max(hiN, H[j]); }
    const prevLow = li >= 1 ? lows[li - 1].price : null;
    let av = 0, cnt = 0;
    for (let j = Math.max(0, k - 20); j < k; j++) { av += V[j]; cnt++; }
    av = cnt ? av / cnt : 0;
    const pd = prevDayLevels(H, L, T, k);

    records.push({
      outcome,
      t: T[k],
      netR: (outcome === "win" ? tpR : -1)
            - ((feeRate + slipPct) * (entry + (outcome === "win" ? target : stop))) / risk,
      rsi: rsi[k],
      maDistPct: m ? (entry - m) / m * 100 : null,
      roomR: isFinite(res) ? (res - entry) / risk : null,
      rangePos: hiN > loN ? (entry - loN) / (hiN - loN) : null,
      higherLow: prevLow != null ? (low.price > prevLow) : null,
      stopPct: risk / entry * 100,
      biasMid:  higherTfs[0] ? biasAt(higherTfs[0].candles, higherTfs[0].mins, tClose) : null,
      biasHigh: higherTfs[1] ? biasAt(higherTfs[1].candles, higherTfs[1].mins, tClose) : null,
      volRatio: av > 0 ? V[k] / av : null,
      atrPct: atrPct(H, L, C, k),
      displacement: displacement(H, L, C, k),
      swept: sweptLow(L, C, k),
      fvg: bullishFVGBelow(H, L, C, k),
      pdlDistPct: pd ? (entry - pd.pdl) / entry * 100 : null,
      pdhDistPct: pd ? (pd.pdh - entry) / entry * 100 : null,
      btcBias4h: btc4h ? biasAt(btc4h, 240, tClose) : null,
      btc4hRetPct: btc4h ? returnAsOf(btc4h, tClose, 6) : null,
    });
  }
  return { records };
}
