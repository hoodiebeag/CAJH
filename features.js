/**
 * features.js — Pure candidate/context features for the strategy search.
 *
 * Every function is pure (numeric arrays in, number/bool out) and no-lookahead where noted,
 * so discover/profile can test them out-of-sample without leaking the future. Inputs are the
 * H/L/C/T arrays profileEntries already parses from candles. Nothing here places trades or
 * decides anything — these are just honest descriptions of the bar at an entry index.
 */

// Average True Range (simple mean of true range) ending at index k, in absolute price units.
export function atr(H, L, C, k, period = 14) {
  if (k < period) return null;
  let sum = 0;
  for (let i = k - period + 1; i <= k; i++) {
    sum += Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
  }
  return sum / period;
}

// Volatility regime: ATR as a percent of price at k. A "tight" stop means very different
// things at 0.3% ATR vs 3% ATR — this is what tells them apart.
export function atrPct(H, L, C, k, period = 14) {
  const a = atr(H, L, C, k, period);
  return a == null || !C[k] ? null : (a / C[k]) * 100;
}

// Displacement: the entry candle's range measured in ATRs — how impulsive the move into
// entry is. ATR is taken up to k-1 so the entry candle can't inflate its own baseline.
export function displacement(H, L, C, k, period = 14) {
  const a = atr(H, L, C, k - 1, period);
  return !a ? null : (H[k] - L[k]) / a;
}

// Liquidity sweep (flush-then-turn): within `lookback`, the recent portion pierced below a
// level set by the older portion, then price reclaimed it by k. The mechanized eye-feature —
// a real flush down and a turn, not a snapshot.
export function sweptLow(L, C, k, lookback = 10) {
  if (k < lookback) return false;
  const mid = k - Math.floor(lookback / 2);
  let priorLow = Infinity;
  for (let i = k - lookback; i < mid; i++) priorLow = Math.min(priorLow, L[i]);
  if (!isFinite(priorLow)) return false;
  let pierced = false;
  for (let i = mid; i <= k; i++) if (L[i] < priorLow) pierced = true;
  return pierced && C[k] > priorLow;
}

// Previous-day high/low (UTC day) — the classic liquidity reference levels. Returns null if
// the prior day isn't present in the data.
export function prevDayLevels(H, L, T, k) {
  const dayOf = (t) => Math.floor(t / 86400);
  const target = dayOf(T[k]) - 1;
  let pdh = -Infinity, pdl = Infinity, found = false;
  for (let i = Math.max(0, k - 200); i <= k; i++) {   // prior day is always within ~192 15m bars
    if (dayOf(T[i]) === target) { pdh = Math.max(pdh, H[i]); pdl = Math.min(pdl, L[i]); found = true; }
  }
  return found ? { pdh, pdl } : null;
}

// Bullish fair-value gap below price: a 3-candle imbalance (H[j-2] < L[j]) formed within
// `lookback`, with price still at/above the gap (an intact imbalance acting as support
// below). Strict definition, zero discretion — either the gap is there or it isn't.
export function bullishFVGBelow(H, L, C, k, lookback = 15) {
  for (let j = Math.max(2, k - lookback + 1); j <= k; j++) {
    if (H[j - 2] < L[j] && C[k] >= L[j]) return true;
  }
  return false;
}
