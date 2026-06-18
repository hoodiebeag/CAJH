/**
 * backtest.js — Simulate the swing-fractal strategy on historical candles.
 *
 * Mirrors the live rules exactly: buy at the confirmation candle's close, stop at
 * the swing low, scale out half at TP1 then move the stop to breakeven, close the
 * runner at TP2. Results are reported in "R" (multiples of the per-trade risk),
 * which is independent of position size.
 *
 * Caveats (read before trusting any number):
 *   • Fills are assumed exactly at the stop / target price (no slippage or fees).
 *   • If a candle touches BOTH stop and target, the stop is assumed to hit first
 *     (pessimistic).
 *   • Only as much history as Kraken returns (~720 candles). Small samples mislead.
 *   • Past performance does not predict future results.
 */

import {
  SWING_WINDOW, RR1, RR2, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, isSwingLow
} from "./strategy.js";

const MAX_HOLD = 100; // close a trade after this many candles if neither stop nor target hits

export function backtest(candles, {
  n = SWING_WINDOW, rr1 = RR1, rr2 = RR2,
  requireHigherLow = REQUIRE_HIGHER_LOW, maxStopPct = MAX_STOP_PCT
} = {}) {
  const highs  = candles.map(c => parseFloat(c.high));
  const lows   = candles.map(c => parseFloat(c.low));
  const closes = candles.map(c => parseFloat(c.close));

  const trades = [];       // each entry is the realized R multiple of one trade
  let pos = null;          // open position state
  let prevSwingLow = null; // for the higher-low filter

  for (let k = n; k < candles.length; k++) {
    // A swing low at index p confirms when candle p+n closes (= candle k here).
    const p = k - n;
    if (p >= n && isSwingLow(lows, p, n)) {
      const swingLow = lows[p];

      if (!pos) {
        const entry = closes[k];
        const stop  = swingLow;
        const risk  = entry - stop;
        let ok = risk > 0;
        if (ok && maxStopPct && risk / entry > maxStopPct) ok = false;
        if (ok && requireHigherLow && prevSwingLow != null && swingLow <= prevSwingLow) ok = false;
        if (ok) {
          pos = { entry, stop, risk, tp1: entry + rr1 * risk, tp2: entry + rr2 * risk, half: false, r: 0, openedAt: k };
        }
      }
      prevSwingLow = swingLow;
    }

    // Manage an open position using later candles only (no peeking at the entry candle).
    if (pos && k > pos.openedAt) {
      const hi = highs[k], lo = lows[k];

      if (!pos.half) {
        if (lo <= pos.stop) {                 // full stop before any target
          trades.push(-1);
          pos = null;
        } else if (hi >= pos.tp1) {            // hit TP1: bank half, move stop to breakeven
          pos.r += rr1 * 0.5;
          pos.half = true;
          pos.stop = pos.entry;
          if (hi >= pos.tp2) {                 // ran straight through TP2 in the same candle
            pos.r += rr2 * 0.5;
            trades.push(pos.r);
            pos = null;
          }
        }
      } else {
        if (lo <= pos.stop) {                  // runner stopped at breakeven
          trades.push(pos.r);
          pos = null;
        } else if (hi >= pos.tp2) {            // runner hits TP2
          pos.r += rr2 * 0.5;
          trades.push(pos.r);
          pos = null;
        }
      }

      if (pos && k - pos.openedAt >= MAX_HOLD) { // time stop: mark to market
        const mtm = (closes[k] - pos.entry) / pos.risk;
        trades.push(pos.half ? pos.r + 0.5 * mtm : mtm);
        pos = null;
      }
    }
  }

  const count = trades.length;
  const wins  = trades.filter(r => r > 0).length;
  const totalR = trades.reduce((a, b) => a + b, 0);

  let eq = 0, peak = 0, maxDD = 0;
  for (const r of trades) { eq += r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }

  return {
    trades: count,
    winRate: count ? wins / count : 0,
    totalR,
    avgR: count ? totalR / count : 0,
    maxDrawdownR: maxDD
  };
}
