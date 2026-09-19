// Fair Value Gaps and inverse Fair Value Gaps, as ENTRY TRIGGERS.
//
// A fair value gap is a three-bar imbalance: bar i's low sits above bar i-2's high (bullish), or
// bar i's high sits below bar i-2's low (bearish). An INVERSE FVG is one that later gets violated
// and is read as flipping polarity -- a bearish gap that price closes back above becomes a bullish
// signal.
//
// These are detectors only. They compute nothing but OHLC comparisons and make no claim about
// whether the patterns predict anything; that is what fvg-run.mjs's pre-registered test asks.

/** Index of every bar completing a bullish three-bar gap: low[i] > high[i-2]. */
export function bullishFVGs(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const lo = Number(candles[i].low), hi2 = Number(candles[i - 2].high);
    if (lo > 0 && hi2 > 0 && lo > hi2) out.push(i);
  }
  return out;
}

/** Index of every bar completing a bearish three-bar gap: high[i] < low[i-2]. */
export function bearishFVGs(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const hi = Number(candles[i].high), lo2 = Number(candles[i - 2].low);
    if (hi > 0 && lo2 > 0 && hi < lo2) out.push(i);
  }
  return out;
}

/**
 * Inverse FVGs. A gap is "inverted" on the first later bar that CLOSES through it, and that bar is
 * the signal. `lookahead` bounds how long a gap stays live, so a gap from years ago cannot fire.
 *
 * The bar that inverts is returned, never the bar that formed the gap -- the inversion is the
 * event, and using the formation bar would be reading the future.
 */
export function inverseFVGs(candles, side, lookahead = 60) {
  const gaps = side === "bull" ? bullishFVGs(candles) : bearishFVGs(candles);
  const out = [];
  for (const g of gaps) {
    // A bullish gap is the zone (high[g-2], low[g]); it inverts when price closes BELOW its floor.
    // A bearish gap is (high[g], low[g-2]); it inverts when price closes ABOVE its ceiling.
    const level = side === "bull" ? Number(candles[g - 2].high) : Number(candles[g - 2].low);
    if (!(level > 0)) continue;
    const end = Math.min(g + lookahead, candles.length - 1);
    for (let k = g + 1; k <= end; k++) {
      const c = Number(candles[k].close);
      if (!(c > 0)) continue;
      if (side === "bull" ? c < level : c > level) { out.push(k); break; }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The four detectors, by the name the pre-registration uses. */
export const FVG_SIGNALS = {
  fvgBull:  (c) => bullishFVGs(c),
  fvgBear:  (c) => bearishFVGs(c),
  ifvgBull: (c) => inverseFVGs(c, "bear"),   // a BEARISH gap inverting is a BULLISH signal
  ifvgBear: (c) => inverseFVGs(c, "bull"),
};
