/**
 * overnight.mjs — split a daily bar's return into its overnight and intraday components.
 *
 * The only new information source left in the data this project already holds. Every result in
 * VERDICTS.md is computed close-to-close; the open price sits unused in all four bundles, and its
 * only appearance anywhere in the repo is gap accounting inside `studies/overlay.mjs`.
 *
 * ONE HAZARD DOMINATES THIS FILE. The overnight leg is the ONLY quantity in this project that
 * reaches across a row boundary to divide one bar's price by the PREVIOUS bar's. If a vendor
 * adjusts closes for splits and dividends but leaves opens raw -- a common and silent mismatch --
 * then a 2:1 split appears as roughly -50% overnight followed by +100% intraday on the same day,
 * and the pair very nearly cancels in the close-to-close return that every prior study used. The
 * corruption is therefore INVISIBLE to every existing check in this repository and becomes visible
 * only once the two legs are separated, which is exactly what this file does. `adjustmentBasis`
 * exists to find it before any signal is built on top of it.
 */

const num = (v) => Number(v);

/**
 * Decompose bars into per-day overnight and intraday legs, oldest first.
 *
 * The first bar has no predecessor and so has no overnight leg; it is dropped rather than given a
 * zero, because a zero would enter a mean as a real observation of "no gap".
 *
 * Returns `{ time, overnight, intraday, closeToClose }` per day, where by construction
 * `(1 + overnight) * (1 + intraday) === 1 + closeToClose`.
 */
export function decompose(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = num(candles[i - 1].close);
    const open = num(candles[i].open);
    const close = num(candles[i].close);
    if (!(prevClose > 0) || !(open > 0) || !(close > 0)) continue;
    out.push({
      time: candles[i].time,
      overnight: open / prevClose - 1,
      intraday: close / open - 1,
      closeToClose: close / prevClose - 1,
    });
  }
  return out;
}

/**
 * Evidence on whether opens and closes share one adjustment basis.
 *
 * Two signatures are reported and neither is judged here -- the caller owns the threshold, so that
 * it has to be written down in a pre-registration rather than chosen after seeing the number.
 *
 *  - `extremeRate`: the fraction of days whose overnight leg exceeds `extreme` in absolute value.
 *    Real overnight gaps above 15% are rare in large caps; unadjusted opens against adjusted
 *    closes make them as common as the split and dividend calendar.
 *  - `tailCorrelation`: the correlation between the overnight and intraday legs ON THOSE EXTREME
 *    DAYS ONLY. A genuine gap says nothing about the session that follows, so this should sit near
 *    zero. An adjustment mismatch forces the intraday leg to undo the phantom gap, which drives it
 *    towards -1. This is the discriminating statistic; `extremeRate` alone cannot separate a
 *    mismatch from a volatile universe.
 */
export function adjustmentBasis(days, extreme = 0.15) {
  const ext = days.filter((d) => Math.abs(d.overnight) > extreme);
  return {
    n: days.length,
    extreme: ext.length,
    extremeRate: days.length ? ext.length / days.length : 0,
    tailCorrelation: correlation(ext.map((d) => d.overnight), ext.map((d) => d.intraday)),
  };
}

/** Pearson correlation; null when there is nothing to correlate or either side is constant. */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (!(va > 0) || !(vb > 0)) return null;
  return cov / Math.sqrt(va * vb);
}

/**
 * Compound a series of simple returns, charging `cost` on every period.
 *
 * The cost is per PERIOD, not per trade, and that is the whole point for this study: an
 * overnight-only or intraday-only book liquidates and re-establishes itself every single session,
 * so the round trip is not an occasional event to be amortised over a holding period. Charging it
 * anywhere other than every period would flatter these two legs by roughly the amount being
 * measured.
 */
export function compound(returns, cost = 0) {
  let eq = 1;
  for (const r of returns) eq *= (1 + r) * (1 - cost);
  return eq - 1;
}
