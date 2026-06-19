/**
 * strategy.js — Swing detection via market structure (break-of-structure confirmation).
 *
 * A pivot is identified by a strong LEFT side (the candle's low is below the N candles
 * before it — a meaningful local low), then CONFIRMED the moment price reverses and
 * closes back through it (a candle closes above the swing-low candle's high). This
 * confirms in ~1–2 candles instead of waiting N candles on the right, so signals are
 * timely WITHOUT lowering the bar (same strong pivots, not more of them).
 *
 *   • Swing LOW  (BUY)  — strong left low, confirmed when a later close breaks ABOVE
 *     the pivot candle's high.
 *   • Swing HIGH (SELL) — strong left high, confirmed when a later close breaks BELOW
 *     the pivot candle's low. (Displayed / used for take-profit; cajh is long-only.)
 */

export const SWING_WINDOW = 5; // LEFT-side strength: a pivot must beat the N candles before it (higher = stronger/rarer)

// ─── Tunable strategy settings (shared by live trading AND the backtester) ──────
export const TP_R = 4.0;   // single take-profit = entry + TP_R × risk (full position, no scale-out). This is the dial — try 4 / 5 / 6 and backtest.

// Breakeven-plus: once price has run far enough in our favor, lift the stop above
// entry so the trade can no longer close red. Full position stays on for the TP.
export const LOCK_BREAKEVEN = true;  // master toggle for the stop-raise
export const BE_TRIGGER_R   = 2.0;   // arm the raise once price reaches entry + 2.0 × risk (halfway to a 4R target)
export const BE_LOCK_R      = 0.2;   // raise the stop to entry + 0.2 × risk (small locked profit, covers fees)

export const RECENT_BARS = 16; // a confirmed low is only "actionable" for this many candles after it confirms

// Optional confidence filters. Set to false / null to disable.
export const REQUIRE_HIGHER_LOW   = true;  // only buy if this swing low is above the previous one (bullish structure)
export const MAX_STOP_PCT         = 0.03;  // skip buys whose stop is further than 3% below entry; null to disable
export const REQUIRE_TF_ALIGNMENT = true;  // require the higher-timeframe trend (1h AND 4h) to be bullish
export const EXIT_ON_SWING_HIGH   = false; // take profit when a fresh swing high confirms on the entry timeframe (off = let winners run to TP)
export const CHOP_FILTER          = false; // when true, only trade when the 4h is genuinely TRENDING (higher highs AND higher lows), not just bouncing inside a range
export const TREND_GATE           = true; // when true, only trade a symbol whose OWN 4h close is above its TREND_MA moving average (per-pair, not blanket)
export const TREND_MA             = 30;    // moving-average period for the per-pair trend gate

/** Is the latest 4h close above its TREND_MA-period simple moving average? */
export function aboveTrendMA(candles, period = TREND_MA) {
  if (!candles || candles.length < period) return false;
  const closes = candles.slice(-period).map(c => parseFloat(c.close));
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  return parseFloat(candles[candles.length - 1].close) > sma;
}

/**
 * Is this timeframe in a clean uptrend — making higher highs AND higher lows?
 * Stricter than `currentBias` (which only checks the single most-recent pivot), so it
 * filters out bounces inside chop. Needs at least two confirmed highs and two lows.
 */
export function isTrending(candles, n = SWING_WINDOW) {
  const pivots = detectSwings(candles, n);
  const lows  = pivots.filter(p => p.type === "low");
  const highs = pivots.filter(p => p.type === "high");
  if (lows.length < 2 || highs.length < 2) return false;
  const higherLow  = lows[lows.length - 1].price  > lows[lows.length - 2].price;
  const higherHigh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  return higherLow && higherHigh;
}

/** Is candle i a strong local LOW vs the N candles before it? */
function isLeftLow(lows, i, n) {
  if (i < n) return false;
  for (let j = i - n; j < i; j++) if (lows[j] <= lows[i]) return false;
  return true;
}

/** Is candle i a strong local HIGH vs the N candles before it? */
function isLeftHigh(highs, i, n) {
  if (i < n) return false;
  for (let j = i - n; j < i; j++) if (highs[j] >= highs[i]) return false;
  return true;
}

/**
 * Detect confirmed pivots via break of structure. Returns chronological
 * [{ type:"low"|"high", index, price, confirmIndex }] where `index` is the pivot
 * candle and `confirmIndex` is the candle whose close confirmed it.
 */
export function detectSwings(candles, n = SWING_WINDOW) {
  const H = candles.map(c => parseFloat(c.high));
  const L = candles.map(c => parseFloat(c.low));
  const C = candles.map(c => parseFloat(c.close));
  const pivots = [];
  let loC = null, hiC = null; // running candidate low / high (the extreme of the current leg)

  for (let i = 0; i < candles.length; i++) {
    if (isLeftLow(L, i, n)  && (!loC || L[i] < loC.price)) loC = { index: i, price: L[i] };
    if (isLeftHigh(H, i, n) && (!hiC || H[i] > hiC.price)) hiC = { index: i, price: H[i] };

    if (loC && i > loC.index && C[i] > H[loC.index]) {
      pivots.push({ type: "low", index: loC.index, price: loC.price, confirmIndex: i });
      loC = null; hiC = null;           // fresh leg after the break
    } else if (hiC && i > hiC.index && C[i] < L[hiC.index]) {
      pivots.push({ type: "high", index: hiC.index, price: hiC.price, confirmIndex: i });
      loC = null; hiC = null;
    }
  }
  return pivots;
}

/** Current structural bias: type of the MOST RECENTLY CONFIRMED pivot. */
export function currentBias(candles, n = SWING_WINDOW) {
  const pivots = detectSwings(candles, n);
  if (!pivots.length) return null;
  return pivots[pivots.length - 1].type === "low" ? "bull" : "bear";
}

/**
 * Returns a buy when the current structure is a recently-confirmed swing low:
 *   → { type:"buy", pivotPrice, pivotIndex, confirmIndex, prevSwingLow }
 * "Recently" = confirmed within RECENT_BARS candles, so the scanner catches setups
 * that confirmed since the last scan without acting on stale ones. Returns null
 * otherwise. (How far price has run above the low is governed by MAX_STOP_PCT.)
 */
export function entrySignal(candles, n = SWING_WINDOW, recentBars = RECENT_BARS) {
  const pivots = detectSwings(candles, n);
  if (!pivots.length) return null;

  const last = pivots[pivots.length - 1];
  if (last.type !== "low") return null;                       // structure must currently be bullish
  if (candles.length - 1 - last.confirmIndex > recentBars) return null; // too old

  const lows = pivots.filter(p => p.type === "low");
  const prevSwingLow = lows.length >= 2 ? lows[lows.length - 2].price : null;

  return { type: "buy", pivotPrice: last.price, pivotIndex: last.index, confirmIndex: last.confirmIndex, prevSwingLow };
}