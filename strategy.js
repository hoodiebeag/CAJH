/**
 * strategy.js — Swing-fractal detection (pure price structure, no indicators).
 *
 *   • Swing HIGH = a candle whose high is strictly above the N candles before
 *     AND the N candles after it  → SELL signal (drawn as a down arrow).
 *   • Swing LOW  = a candle whose low is strictly below the N candles before
 *     AND the N candles after it   → BUY signal (drawn as an up arrow).
 *
 * A pivot can only be confirmed once N more candles have closed after it, so
 * every signal carries a natural N-candle delay. Change N by editing SWING_WINDOW.
 */

export const SWING_WINDOW = 3; // candles checked on EACH side of a pivot

// ─── Tunable strategy settings (shared by live trading AND the backtester) ──────
export const RR1 = 1.5;   // take-profit 1 = entry + 1.5 × risk (scale out half)
export const RR2 = 3.0;   // take-profit 2 = entry + 3.0 × risk (close the runner)

// Optional confidence filters. Set to false / null to disable and revert to the
// pure strategy. Backtest with them on vs off to see if they actually help YOU.
export const REQUIRE_HIGHER_LOW = true;  // only buy if this swing low is above the previous one (bullish structure)
export const MAX_STOP_PCT        = 0.05; // skip buys whose stop is further than 5% below entry (caps risk); null to disable

/** Is candle i a confirmed swing high within [i-n, i+n]? */
export function isSwingHigh(highs, i, n) {
  for (let j = i - n; j <= i + n; j++) {
    if (j === i) continue;
    if (highs[j] >= highs[i]) return false;
  }
  return true;
}

/** Is candle i a confirmed swing low within [i-n, i+n]? */
export function isSwingLow(lows, i, n) {
  for (let j = i - n; j <= i + n; j++) {
    if (j === i) continue;
    if (lows[j] <= lows[i]) return false;
  }
  return true;
}

/**
 * Return every confirmed pivot in a candle array (used for drawing arrows).
 * candles: chronological array of { high, low, ... } (strings or numbers).
 */
export function detectSwings(candles, n = SWING_WINDOW) {
  const highs = candles.map(c => parseFloat(c.high));
  const lows  = candles.map(c => parseFloat(c.low));
  const pivots = [];

  for (let i = n; i < candles.length - n; i++) {
    if (isSwingHigh(highs, i, n)) pivots.push({ type: "high", index: i, price: highs[i] });
    if (isSwingLow(lows,  i, n))  pivots.push({ type: "low",  index: i, price: lows[i]  });
  }
  return pivots;
}

/**
 * Return the signal that JUST confirmed on the most recent closed candle, or null.
 * A pivot at index i confirms when candle i+n closes, so the freshly-confirmed
 * pivot sits at index (lastIndex - n). Pass CLOSED candles only.
 *   → { type: "buy",  pivotPrice }  for a swing low
 *   → { type: "sell", pivotPrice }  for a swing high
 */
export function latestSignal(candles, n = SWING_WINDOW) {
  if (candles.length < 2 * n + 1) return null;

  const i = candles.length - 1 - n; // the candle that just became confirmable
  if (i < n) return null;

  const highs = candles.map(c => parseFloat(c.high));
  const lows  = candles.map(c => parseFloat(c.low));

  if (isSwingLow(lows, i, n))  return { type: "buy",  pivotPrice: lows[i]  };
  if (isSwingHigh(highs, i, n)) return { type: "sell", pivotPrice: highs[i] };
  return null;
}
