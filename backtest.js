/**
 * backtest.js — Simulate the strategy on historical candles (mirrors live rules).
 *
 * Entries TRIGGER on a 15m break-of-structure swing low (confirmed when price closes
 * back above the pivot candle's high), taken only when the 1h AND 4h trend bias are
 * bullish at that moment. Exits mirror live: stop, single take-profit (full position),
 * TP, and the optional swing-high take-profit. Results are in "R" (multiples of the
 * per-trade risk), independent of position size.
 *
 * Caveats (read before trusting any number):
 *   • Fills are assumed exactly at the stop / target price (no slippage or fees).
 *   • If a candle touches BOTH stop and target, the stop is assumed to hit first.
 *   • Only as much history as Kraken returns (~720 candles). Small samples mislead.
 *   • Past performance does not predict future results.
 */

import {
  SWING_WINDOW, TP_R, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, MIN_STOP_PCT,
  EXIT_ON_SWING_HIGH, CHOP_FILTER, LOCK_BREAKEVEN, BE_TRIGGER_R, BE_LOCK_R, FEE_BUFFER_PCT, FEE_RATE,
  TREND_GATE, TREND_GATE_MODE, TREND_MA, detectSwings
} from "./strategy.js";

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

function trendingAsOf(timeline, t) {
  let v = false;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) v = timeline[i].trending; else break;
  }
  return v;
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

function aboveAsOf(timeline, t) {
  let v = false;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) v = timeline[i].above; else break;
  }
  return v;
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

function biasAsOf(timeline, t) {
  let bias = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) bias = timeline[i].bias; else break;
  }
  return bias === "low" ? "bull" : bias === "high" ? "bear" : null;
}

export function backtestMultiTF({ candles15, candles1h, candles4h }, {
  n = SWING_WINDOW, tpR = TP_R,
  requireHigherLow = REQUIRE_HIGHER_LOW, maxStopPct = MAX_STOP_PCT, minStopPct = MIN_STOP_PCT,
  exitOnSwingHigh = EXIT_ON_SWING_HIGH, chopFilter = CHOP_FILTER,
  lockBreakeven = LOCK_BREAKEVEN, beTriggerR = BE_TRIGGER_R, beLockR = BE_LOCK_R, feeBufferPct = FEE_BUFFER_PCT,
  feeRate = FEE_RATE,
  trendGate = TREND_GATE, trendMa = TREND_MA, trendGateMode = TREND_GATE_MODE,
  entryTf = "15m", alignMode = "all", minRoomR = 0
} = {}) {
  if (!candles15?.length || !candles1h?.length || !candles4h?.length) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
  }

  // Pick the entry timeframe; everything ABOVE it becomes the bias filter, and the
  // highest available TF anchors the chop/MA gate. entryTf="15m" reproduces the original.
  const TFS = [
    { tf: "15m", candles: candles15, mins: 15  },
    { tf: "1h",  candles: candles1h, mins: 60  },
    { tf: "4h",  candles: candles4h, mins: 240 },
  ];
  const ei = TFS.findIndex(t => t.tf === entryTf);
  if (ei < 0 || !TFS[ei].candles?.length) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
  }
  const entryCandles = TFS[ei].candles;
  const entryMins    = TFS[ei].mins;
  const higher       = TFS.slice(ei + 1).filter(t => t.candles?.length);   // bias-filter TFs
  const trendSrc     = higher.length ? higher[higher.length - 1] : TFS[ei]; // chop/MA anchor

  const H = entryCandles.map(c => parseFloat(c.high));
  const L = entryCandles.map(c => parseFloat(c.low));
  const C = entryCandles.map(c => parseFloat(c.close));
  const T = entryCandles.map(c => parseInt(c.time));

  const pivE = detectSwings(entryCandles, n);
  const lowAt  = new Map();             // confirmIndex → low pivot (entry trigger)
  const highAt = new Set();             // confirmIndex of high pivots (swing-high exit)
  for (const p of pivE) {
    if (p.type === "low") lowAt.set(p.confirmIndex, p);
    else                  highAt.add(p.confirmIndex);
  }

  const biasTLs = higher.map(t => biasTimeline(t.candles, t.mins, n));
  const trendTL = trendTimeline(trendSrc.candles, trendSrc.mins, n);
  const maTL    = maTimeline(trendSrc.candles, trendSrc.mins, trendMa);

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

  const trades = [];
  const reasons = {};   // tally of why each candidate swing low was taken / rejected
  let pos = null, prevLowPrice = null;

  for (let k = n; k < entryCandles.length; k++) {
    const lowHere = lowAt.get(k); // a swing low confirmed at this candle on the entry TF?
    if (lowHere && !pos) {
      const tClose  = T[k] + entryMins * 60;
      const hb = biasTLs.map(tl => biasAsOf(tl, tClose));   // higher-TF biases as of entry
      let aligned;
      switch (alignMode) {
        case "none":    aligned = true; break;                            // entry-TF structure only
        case "first":   aligned = hb.length === 0 || hb[0] === "bull"; break; // nearest higher TF only
        case "notbear": aligned = hb.every(b => b !== "bear"); break;     // not actively downtrending
        case "all":
        default:        aligned = hb.every(b => b === "bull"); break;     // every higher TF bull (current)
      }
      let gateReason = aligned ? null : "notAligned";
      if (aligned && chopFilter && !trendingAsOf(trendTL, tClose)) { aligned = false; gateReason = "trendGate"; }
      if (aligned && trendGate) {
        const tg = trendGateMode === "structure"
          ? trendingAsOf(trendTL, tClose)   // 4h making higher highs AND higher lows
          : aboveAsOf(maTL, tClose);        // 4h close above its MA
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
      if (ok) pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k };
    }
    if (lowHere) prevLowPrice = lowHere.price;

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      // Round-trip fee expressed in R units for this trade (fee % ÷ risk %).
      const feeR = (2 * feeRate * pos.entry) / pos.risk;
      // Stop checked first against the stop as it stands entering this candle
      // (conservative: if both stop and target are touched, assume stop hit first).
      if (lo <= pos.stop) { trades.push((pos.stop - pos.entry) / pos.risk - feeR); pos = null; }
      else if (hi >= pos.tp) { trades.push(tpR - feeR); pos = null; }
      // Breakeven-plus: once this candle's high reaches the trigger, lift the stop
      // above entry for subsequent candles.
      if (pos && lockBreakeven && !pos.beMoved) {
        const lockOffset = Math.max(beLockR * pos.risk, feeBufferPct * pos.entry);
        const armOffset  = Math.max(beTriggerR * pos.risk, lockOffset + 0.5 * pos.risk);
        if (hi >= pos.entry + armOffset) {
          pos.stop = pos.entry + lockOffset;
          pos.beMoved = true;
        }
      }
      // Structure-based take-profit: a swing high confirmed here, while in profit.
      if (pos && exitOnSwingHigh && highAt.has(k) && C[k] > pos.entry) {
        trades.push((C[k] - pos.entry) / pos.risk - feeR);
        pos = null;
      }
      if (pos && k - pos.openedAt >= MAX_HOLD) {
        trades.push((C[k] - pos.entry) / pos.risk - feeR);
        pos = null;
      }
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
    reasons           // { taken, stopTooTight, stopTooFar, trendGate, notAligned, notHigherLow, priceBelowStop }
  };
}