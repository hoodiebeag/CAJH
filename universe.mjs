// A data-sanity screen for a research universe.
//
// PARA sat in the sp500 bundle with closes ranging from $1.06 to $113,900 and 162 bars carrying no
// volume at all. Whatever instrument that series describes, it is not Paramount Global, which
// traded near $11 on the dates the series shows $3,500 on nineteen shares. A price path that falls
// by five orders of magnitude is the strongest possible "loser", so a cross-sectional ranking
// shorts it every single period: momentum held it short in 31 of 32 rebalances, and removing it
// took the equities book from 25.0% CAGR to 9.1%. One corrupted symbol was two thirds of the
// result.
//
// The screen is deliberately blunt and stated in advance rather than tuned. It rejects a series
// that no real listed instrument produces, not one that merely performed badly: real collapses of
// 20-60x are common in this window (CHPT, SEDG, LCID, PLUG all survive it) and are kept.

export const DEFAULT_LIMITS = {
  // Split-adjusted history can legitimately span a wide range -- a 1:20 reverse split multiplies
  // every pre-split price by twenty. 500x is far beyond that and beyond any real drawdown.
  maxCloseRatio: 500,
  // A listed instrument trades. Bars with no volume mean the vendor had nothing, and a series that
  // is mostly gaps cannot be ranked against one that is not.
  maxZeroVolumeFraction: 0.2,
  // Below this the "fill at the close" assumption every backtest here makes is not credible at any
  // account size worth running.
  minMedianDollarVolume: 1e5,
};

/**
 * Returns { kept, rejected } where kept is a series object safe to rank and rejected lists
 * [symbol, reason] so the exclusions are visible rather than silent.
 */
export function screenUniverse(series, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const kept = {}, rejected = [];
  for (const [sym, bars] of Object.entries(series)) {
    const closes = bars.map((b) => Number(b.close)).filter((v) => v > 0);
    if (closes.length < 2) { rejected.push([sym, "fewer than two usable closes"]); continue; }
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const ratio = hi / lo;
    if (ratio > L.maxCloseRatio) {
      rejected.push([sym, `close range ${ratio.toFixed(0)}x ($${lo.toFixed(2)}-$${hi.toFixed(2)}) exceeds ${L.maxCloseRatio}x`]);
      continue;
    }
    const zeroFrac = bars.filter((b) => !(Number(b.volume) > 0)).length / bars.length;
    if (zeroFrac > L.maxZeroVolumeFraction) {
      rejected.push([sym, `${(100 * zeroFrac).toFixed(0)}% of bars have no volume`]);
      continue;
    }
    const dv = bars.map((b) => Number(b.close) * Number(b.volume)).filter((v) => v > 0).sort((a, b) => a - b);
    const medDV = dv.length ? dv[Math.floor(dv.length / 2)] : 0;
    if (medDV < L.minMedianDollarVolume) {
      rejected.push([sym, `median dollar volume $${(medDV / 1e6).toFixed(3)}M below the floor`]);
      continue;
    }
    kept[sym] = bars;
  }
  return { kept, rejected };
}
