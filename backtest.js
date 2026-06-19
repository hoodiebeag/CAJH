/**
 * backtest.js — Simulate the strategy on historical candles (mirrors live rules).
 *
 * Entries TRIGGER on a 15m break-of-structure swing low (confirmed when price closes
 * back above the pivot candle's high), taken only when the 1h AND 4h trend bias are
 * bullish at that moment. Exits mirror live: stop, TP1 (scale out half + breakeven),
 * TP2, and the optional swing-high take-profit. Results are in "R" (multiples of the
 * per-trade risk), independent of position size.
 *
 * Caveats (read before trusting any number):
 *   • Fills are assumed exactly at the stop / target price (no slippage or fees).
 *   • If a candle touches BOTH stop and target, the stop is assumed to hit first.
 *   • Only as much history as Kraken returns (~720 candles). Small samples mislead.
 *   • Past performance does not predict future results.
 */

import {
  SWING_WINDOW, RR1, RR2, REQUIRE_HIGHER_LOW, MAX_STOP_PCT,
  EXIT_ON_SWING_HIGH, CHOP_FILTER, detectSwings
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
  n = SWING_WINDOW, rr1 = RR1, rr2 = RR2,
  requireHigherLow = REQUIRE_HIGHER_LOW, maxStopPct = MAX_STOP_PCT
} = {}) {
  if (!candles15?.length || !candles1h?.length || !candles4h?.length) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0 };
  }

  const H = candles15.map(c => parseFloat(c.high));
  const L = candles15.map(c => parseFloat(c.low));
  const C = candles15.map(c => parseFloat(c.close));
  const T = candles15.map(c => parseInt(c.time));

  const piv15 = detectSwings(candles15, n);
  const lowAt  = new Map();             // confirmIndex → low pivot (entry trigger)
  const highAt = new Set();             // confirmIndex of high pivots (swing-high exit)
  for (const p of piv15) {
    if (p.type === "low") lowAt.set(p.confirmIndex, p);
    else                  highAt.add(p.confirmIndex);
  }

  const tl1h = biasTimeline(candles1h, 60,  n);
  const tl4h = biasTimeline(candles4h, 240, n);
  const trend4h = trendTimeline(candles4h, 240, n);

  const trades = [];
  let pos = null, prevLowPrice = null;

  for (let k = n; k < candles15.length; k++) {
    const lowHere = lowAt.get(k); // a 15m swing low confirmed at this candle?
    if (lowHere && !pos) {
      const tClose  = T[k] + 15 * 60;
      let aligned = biasAsOf(tl1h, tClose) === "bull" && biasAsOf(tl4h, tClose) === "bull";
      if (aligned && CHOP_FILTER) aligned = trendingAsOf(trend4h, tClose);
      const entry = C[k], stop = lowHere.price, risk = entry - stop;
      let ok = risk > 0 && aligned;
      if (ok && maxStopPct && risk / entry > maxStopPct) ok = false;
      if (ok && requireHigherLow && prevLowPrice != null && lowHere.price <= prevLowPrice) ok = false;
      if (ok) pos = { entry, stop, risk, tp1: entry + rr1 * risk, tp2: entry + rr2 * risk, half: false, r: 0, openedAt: k };
    }
    if (lowHere) prevLowPrice = lowHere.price;

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      if (!pos.half) {
        if (lo <= pos.stop) { trades.push(-1); pos = null; }
        else if (hi >= pos.tp1) {
          pos.r += rr1 * 0.5; pos.half = true; pos.stop = pos.entry;
          if (hi >= pos.tp2) { pos.r += rr2 * 0.5; trades.push(pos.r); pos = null; }
        }
      } else {
        if (lo <= pos.stop) { trades.push(pos.r); pos = null; }
        else if (hi >= pos.tp2) { pos.r += rr2 * 0.5; trades.push(pos.r); pos = null; }
      }
      // Structure-based take-profit: a swing high confirmed here, while in profit.
      if (pos && EXIT_ON_SWING_HIGH && highAt.has(k) && C[k] > pos.entry) {
        const mtm = (C[k] - pos.entry) / pos.risk;
        trades.push(pos.half ? pos.r + 0.5 * mtm : mtm);
        pos = null;
      }
      if (pos && k - pos.openedAt >= MAX_HOLD) {
        const mtm = (C[k] - pos.entry) / pos.risk;
        trades.push(pos.half ? pos.r + 0.5 * mtm : mtm);
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
    results: trades   // raw per-trade R values, for pooling across pairs
  };
}