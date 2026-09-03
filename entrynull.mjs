/**
 * entrynull.mjs -- does the entry rule carry information, or is the balance market drift?
 *
 * The campaign's sweeps keep improving the balance by holding longer: the best configuration
 * found so far sets the take-profit 100R away, where it is never reached, so the real exit is the
 * 100-bar timeout. In a market that rose over the window, "hold longer" and "earn more" are the
 * same sentence, and no amount of further tuning tells them apart. This does.
 *
 * The construction is a matched-geometry random-entry null. It keeps everything about the trade
 * except the one thing under test:
 *   - the same pairs, in the same proportions the strategy actually traded them
 *   - the same distribution of stop distances, resampled from the strategy's own trades
 *   - the same target multiple, the same breakeven-lock rule, the same hold cap
 *   - the same fee and slippage
 * and replaces the entry bar with a uniformly random bar in that pair. If a random entry earns
 * what the strategy earns, the entry rule is decoration and the balance is beta.
 *
 * The exit walk mirrors backtest.js deliberately, including its intrabar convention: when a bar's
 * range contains both the stop and the target, the stop is taken. Order is unknowable inside a
 * bar and assuming the worse fill is the only assumption that cannot flatter a result.
 */

import { seededRng } from "./inference.mjs";

/**
 * Walk one trade forward from `entryIdx` under the strategy's own exit rules. Returns netR, or
 * null when the bar is too close to the end of the series to be held.
 */
export function simulateExit(candles, entryIdx, {
  stopPct, tpR, maxHold = 100,
  lockBreakeven = true, beTriggerR = 2.0, beLockR = 0.2, feeBufferPct = 0.018,
  feeRate, slipPct,
} = {}) {
  if (entryIdx < 0 || entryIdx >= candles.length - 1) return null;
  const entry = Number(candles[entryIdx].close);
  if (!(entry > 0) || !(stopPct > 0)) return null;

  const risk = entry * stopPct;
  let stop = entry - risk;
  const tp = entry + tpR * risk;
  const lockOffset = Math.max(beLockR * risk, feeBufferPct * entry);
  const armOffset = Math.max(beTriggerR * risk, lockOffset + 0.5 * risk);
  let beMoved = false;

  const last = Math.min(entryIdx + maxHold, candles.length - 1);
  let exitPx = Number(candles[last].close);
  for (let k = entryIdx + 1; k <= last; k++) {
    const low = Number(candles[k].low), high = Number(candles[k].high);
    if (low <= stop) { exitPx = stop; break; }
    if (high >= tp) { exitPx = tp; break; }
    if (lockBreakeven && !beMoved && high >= entry + armOffset) { stop = entry + lockOffset; beMoved = true; }
  }
  return (exitPx - entry) / risk - ((feeRate + slipPct) * (entry + exitPx)) / risk;
}

/**
 * Build the drawTrade function matchedGeometryNull expects: one random entry per call, with the
 * pair and the stop distance resampled from the observed trades.
 *
 * `observed` is the strategy's own excursion list, each { symbol, stopPct }. `seriesByPair` maps
 * a pair to its candle array -- the same slices the strategy ran on.
 */
export function randomEntryDrawer({ observed, seriesByPair, exit }) {
  if (!observed?.length) throw new Error("randomEntryDrawer: observed trades are required to match geometry");
  const pairs = observed.map((t) => t.symbol);
  const stops = observed.map((t) => t.stopPct).filter((s) => Number.isFinite(s) && s > 0);
  if (!stops.length) throw new Error("randomEntryDrawer: no usable stop distances in the observed trades");

  return (random) => {
    const pair = pairs[Math.floor(random() * pairs.length)];
    const candles = seriesByPair[pair];
    if (!candles || candles.length < 2) return null;
    const stopPct = stops[Math.floor(random() * stops.length)];
    const entryIdx = Math.floor(random() * (candles.length - 1));
    return simulateExit(candles, entryIdx, { ...exit, stopPct });
  };
}

/** A deterministic drawer for tests and for reproducing a single null draw by hand. */
export function fixedDrawer(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : null);
}

export { seededRng };
