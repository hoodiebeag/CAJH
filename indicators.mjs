/**
 * indicators.mjs — the cross-sectional signals the analyst is shown.
 *
 * Extracted from three modules totalling 746 lines: a signal battery, a rotation engine and a
 * multifactor grid, all built to RANK names mechanically and score the result. That programme is
 * closed -- every one of those mechanisms lost to a matched random control -- and the machinery
 * went with it. What survives is the part still worth having: descriptions of a name's recent
 * behaviour, handed to an analyst that decides for itself.
 *
 * SO THESE ARE INPUTS, NOT A STRATEGY. Nothing here ranks, selects or sizes. A signal returns a
 * number or null, and null means "not computable here" -- never zero, because zero is a reading
 * and an absent reading is not one. context.mjs displays them; it does not act on them.
 *
 * Every signature is (closes, i, ctx), where `i` is the decision bar. Nothing reads past it.
 */

const ret = (c, i, lb, sk) => {
  const a = c[i - lb], b = c[i - sk];
  return a > 0 && b > 0 ? Math.log(b / a) : null;
};

export function trailingVol(closes, i, window = 63, barsPerYear = 252) {
  if (i < window) return null;
  const rs = [];
  for (let j = i - window + 1; j <= i; j++) {
    const a = closes[j - 1], b = closes[j];
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < window / 2) return null;
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1);
  return Math.sqrt(v * barsPerYear);
}

export const SIGNALS = {
  momentum:     (c, i) => ret(c, i, 252, 21),
  reversal1m:   (c, i) => { const r = ret(c, i, 21, 0);  return r === null ? null : -r; },
  reversal1w:   (c, i) => { const r = ret(c, i, 5, 0);   return r === null ? null : -r; },
  lowVol:       (c, i) => { const v = trailingVol(c, i, 63); return v === null ? null : -v; },
  highVol:      (c, i) => trailingVol(c, i, 63),
  nearHigh:     (c, i) => {
    if (i < 252) return null;
    let hi = 0;
    for (let j = i - 251; j <= i; j++) if (c[j] > hi) hi = c[j];
    return hi > 0 && c[i] > 0 ? c[i] / hi : null;
  },
  trendQuality: (c, i) => {
    if (i < 252) return null;
    let up = 0, n = 0;
    for (let j = i - 251; j <= i; j++) { if (c[j] > 0 && c[j - 1] > 0) { n++; if (c[j] > c[j - 1]) up++; } }
    return n > 100 ? up / n : null;
  },
  acceleration: (c, i) => {
    const recent = ret(c, i, 126, 21), older = ret(c, i, 252, 126);
    return recent === null || older === null ? null : recent - older;
  },
  lowSkew:      (c, i) => {
    if (i < 126) return null;
    const rs = [];
    for (let j = i - 125; j <= i; j++) if (c[j] > 0 && c[j - 1] > 0) rs.push(Math.log(c[j] / c[j - 1]));
    if (rs.length < 60) return null;
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1));
    if (!(sd > 0)) return null;
    const sk = rs.reduce((a, b) => a + ((b - m) / sd) ** 3, 0) / rs.length;
    return -sk;
  },
  volumeTrend:  (c, i, ctx) => {
    const v = ctx.volume?.[ctx.symbol];
    if (!v || i < 126) return null;
    let recent = 0, older = 0, rn = 0, on = 0;
    for (let j = i - 62; j <= i; j++) if (v[j] > 0) { recent += v[j]; rn++; }
    for (let j = i - 125; j <= i - 63; j++) if (v[j] > 0) { older += v[j]; on++; }
    return rn > 30 && on > 30 && older > 0 ? Math.log((recent / rn) / (older / on)) : null;
  },
  // Amihud illiquidity: average price impact per dollar traded. The premium is compensation for
  // bearing illiquidity, not a price-continuation effect, so it is the first signal in this battery
  // whose MECHANISM differs from the rest. Higher = more illiquid = held long.
  illiquidity:  (c, i, ctx) => {
    const v = ctx.volume?.[ctx.symbol];
    if (!v || i < 252) return null;
    let sum = 0, n = 0;
    for (let j = i - 251; j <= i; j++) {
      const dollar = c[j] > 0 && v[j] > 0 ? c[j] * v[j] : 0;
      if (dollar > 0 && c[j - 1] > 0) { sum += Math.abs(Math.log(c[j] / c[j - 1])) / dollar; n++; }
    }
    // Scaled only to keep the numbers readable; a monotone transform cannot change a ranking.
    return n > 200 ? Math.log(1 + (sum / n) * 1e9) : null;
  },
  // The size premium, proxied by dollar volume because market capitalisation is not in these
  // bundles. Small trades less, so LOW dollar volume scores high and is held long.
  smallSize:    (c, i, ctx) => {
    const v = ctx.volume?.[ctx.symbol];
    if (!v || i < 252) return null;
    let sum = 0, n = 0;
    for (let j = i - 251; j <= i; j++) if (c[j] > 0 && v[j] > 0) { sum += c[j] * v[j]; n++; }
    return n > 200 && sum > 0 ? -Math.log(sum / n) : null;
  },
  idioVol:      (c, i, ctx) => {
    if (i < 126 || !ctx.basket) return null;
    const rs = [];
    for (let j = i - 125; j <= i; j++) {
      if (c[j] > 0 && c[j - 1] > 0 && ctx.basket[j] !== null) rs.push(Math.log(c[j] / c[j - 1]) - ctx.basket[j]);
    }
    if (rs.length < 60) return null;
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    return -Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1));
  },
  beta:         (c, i, ctx) => {
    if (i < 126 || !ctx.basket) return null;
    const x = [], y = [];
    for (let j = i - 125; j <= i; j++) {
      if (c[j] > 0 && c[j - 1] > 0 && ctx.basket[j] !== null) { y.push(Math.log(c[j] / c[j - 1])); x.push(ctx.basket[j]); }
    }
    if (x.length < 60) return null;
    const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
    let cov = 0, varx = 0;
    for (let k = 0; k < x.length; k++) { cov += (x[k] - mx) * (y[k] - my); varx += (x[k] - mx) ** 2; }
    return varx > 0 ? -(cov / varx) : null;      // negative: betting AGAINST beta
  },
};
