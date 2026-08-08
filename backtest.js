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
  stopMode = "structural",
  atrStopK = 3,
  atrPeriod = 14,
  // Bars of prior-high lookback for "breakout" mode's N-bar high trigger. Default 20
  // reproduces the original hardcoded behaviour byte-for-byte when omitted.
  breakoutLookback = 20,
  // Research-only entry veto. It receives only the completed entry bar's close time.
  // Live scanning never supplies this callback.
  entryGate = null
} = {}) {
  // `series` = timeframes ascending, e.g. [{label:"1h",mins:60,candles},{label:"4h",...},{label:"1d",...}].
  // The entry TF (entryTf label, default the lowest) trades; everything ABOVE it is the
  // bias filter, and the highest TF anchors the chop/MA gate.
  if (!Array.isArray(series) || !series.length || series.some(s => !s?.candles?.length)) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
  }
  const TFS = series;
  const ei  = entryTf ? TFS.findIndex(t => t.label === entryTf) : 0;
  if (ei < 0) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
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
  for (const p of pivE) {
    if (p.type === "low") lowAt.set(p.confirmIndex, p);
    else                  highAt.add(p.confirmIndex);
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
  const reasons = {};   // tally of why each candidate swing low was taken / rejected
  const exits   = {};   // tally of HOW each trade ended (stop / target / trail-be / partial / timeout)
  let pos = null, prevLowPrice = null;
  let antCand = null, antHi = null;   // anticipate mode: running unconfirmed candidate low / high
  let antTradedIdx = null;            // candidate index already traded (one trade per level, mirrors live)

  for (let k = n; k < entryCandles.length; k++) {
    const lowHere = lowAt.get(k); // a swing low confirmed at this candle on the entry TF?
    if (!pos && entryMode === "bos") {
     if (lowHere) {
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
        if (!tg) { aligned = false; gateReason = "trendGate"; }
      }
      const entry = C[k], stop = lowHere.price, risk = entry - stop;
      let ok = true, reason;
      if (risk <= 0)                                                              { ok = false; reason = "priceBelowStop"; }
      else if (!aligned)                                                          { ok = false; reason = gateReason; }
      else if (maxStopPct && risk / entry > maxStopPct)                           { ok = false; reason = "stopTooFar"; }
      else if (minStopPct && risk / entry < minStopPct)                           { ok = false; reason = "stopTooTight"; }
      else if (requireHigherLow && prevLowPrice != null && lowHere.price <= prevLowPrice) { ok = false; reason = "notHigherLow"; }
      else if (minRoomR && (nearestResAbove(entry, tClose) - entry) / risk < minRoomR)    { ok = false; reason = "noRoom"; }
      else                                                                        { reason = "taken"; }
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (ok) pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: entry, trailing: false };
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
          pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: entry, trailing: false };
          // Intrabar order is unknowable: if this bar also traded at/below the stop,
          // assume the worst and take the stop on the entry bar.
          if (L[k] <= stop) {
            trades.push((stop - entry) / risk - ((feeRate + slipPct) * (entry + stop)) / risk);
            pos = null;
          }
        }
      }
    } else if (!pos) {
      // Long dip-buy modes — no trend/alignment gate (the whole point), tight structural
      // stop + ambitious target. Only the stop-size sanity caps apply.
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
        else if (entryGate && !entryGate(tClose))               reason = "externalGate";
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (reason === "taken") pos = { entry: cand.entry, stop: cand.stop, risk, tp: cand.tp, beMoved: false, openedAt: k, open: 1, realized: 0, partialDone: false, peak: cand.entry, trailing: false };
      }
    }
    if (lowHere) prevLowPrice = lowHere.price;

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      // Net R of the FULL position exiting at `px`: gross R minus fees+slippage, with the
      // entry leg on the entry notional and the exit leg on the exit notional (matches
      // monitor.js's live P&L). A partial leg of fraction f is simply f × this value, so
      // scale-outs stay exactly consistent with full exits.
      const netAt = (px) => (px - pos.entry) / pos.risk - ((feeRate + slipPct) * (pos.entry + px)) / pos.risk;
      // Close `frac` of what's left at `px`; bank the trade once nothing remains.
      const closeLeg = (px, frac, why) => {
        const f = Math.min(frac, pos.open);
        pos.realized += f * netAt(px);
        pos.open -= f;
        if (pos.open <= 1e-9) {
          trades.push(pos.realized);
          exits[why] = (exits[why] || 0) + 1;
          pos = null;
        }
      };

      // Stop first, against the stop as it stood entering this candle (conservative: if
      // both stop and target are touched in one bar, assume the stop hit first).
      // trailingTpPct replaces the fixed TP: the pullback trigger is checked against the
      // peak as it stood entering this candle (updated below, after this check, so it
      // only binds on later candles — same ordering as the trailR trailing stop).
      if (lo <= pos.stop) closeLeg(pos.stop, pos.open, pos.beMoved || pos.trailing ? "trail/be" : "stop");
      else if (!trailingTpPct && hi >= pos.tp) closeLeg(pos.tp, pos.open, "target");
      else if (trailingTpPct && pos.peak > pos.entry) {
        const pullbackPx = pos.peak * (1 - trailingTpPct);
        if (lo <= pullbackPx) closeLeg(pullbackPx, pos.open, "trailingTp");
      }

      // Partial scale-out: bank `partialFrac` at the partial target, let the rest run.
      if (pos && partialAtR && !pos.partialDone) {
        const px = pos.entry + partialAtR * pos.risk;
        if (hi >= px) {
          pos.partialDone = true;
          closeLeg(px, partialFrac, "partial+runner");
        }
      }

      // Trailing stop: once price has run trailStartR, keep the stop trailR below the
      // running peak. Updated after the stop check, so it only binds on later candles.
      if (pos && trailR) {
        pos.peak = Math.max(pos.peak, hi);
        if (pos.peak >= pos.entry + trailStartR * pos.risk) {
          pos.stop = Math.max(pos.stop, pos.peak - trailR * pos.risk);
          pos.trailing = true;
        }
      }

      // Trailing take-profit: extend the running peak for the next candle's pullback
      // check above. Updated after that check, so it only binds on later candles.
      if (pos && trailingTpPct) pos.peak = Math.max(pos.peak, hi);

      // Breakeven-plus: once this candle's high reaches the trigger, lift the stop
      // above entry for subsequent candles.
      if (pos && lockBreakeven && !pos.beMoved) {
        const lockOffset = Math.max(beLockR * pos.risk, feeBufferPct * pos.entry);
        const armOffset  = Math.max(beTriggerR * pos.risk, lockOffset + 0.5 * pos.risk);
        if (hi >= pos.entry + armOffset) {
          pos.stop = Math.max(pos.stop, pos.entry + lockOffset);
          pos.beMoved = true;
        }
      }
      // Structure-based take-profit: a swing high confirmed here, while in profit.
      if (pos && exitOnSwingHigh && highAt.has(k) && C[k] > pos.entry) closeLeg(C[k], pos.open, "swingHigh");
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
    exits,            // { stop, target, "trail/be", "partial+runner", swingHigh, timeout }
    reasons           // { taken, stopTooTight, stopTooFar, trendGate, notAligned, notHigherLow, priceBelowStop }
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
