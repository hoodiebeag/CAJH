/**
 * factors.mjs -- the whole battery of cross-sectional signals, tested identically and corrected
 * for multiplicity as one family.
 *
 * "Test everything" and "report an honest result" are in tension, and the tension is arithmetic.
 * Twelve independent signals tested at p < 0.05 produce 0.6 false positives by expectation; twenty
 * produce one. A battery run without correction does not discover a factor, it manufactures one.
 * So every signal here is scored against the same null with the same machinery, and the p-values
 * are corrected together with Benjamini-Hochberg before anything is called a survivor.
 *
 * THE SIGNALS, and why each is here rather than invented. Each is a documented anomaly with a
 * literature behind it, so the battery is a replication attempt rather than a fishing expedition:
 *
 *   momentum        12-1 cross-sectional. Jegadeesh & Titman 1993. The incumbent.
 *   reversal1m      short-horizon reversal, the opposite sign to momentum. Jegadeesh 1990. This is
 *                   the likely reason 126-bar momentum failed while 252-bar worked.
 *   reversal1w      the same effect at a shorter horizon.
 *   lowVol          low-volatility anomaly / betting-against-beta. Frazzini & Pedersen.
 *   highVol         the opposite sign, included so a positive result on lowVol cannot be an
 *                   artefact of the ranking machinery.
 *   nearHigh        proximity to the 52-week high. George & Hwang 2004.
 *   trendQuality    fraction of up-days over the window: trend CONSISTENCY rather than magnitude.
 *   acceleration    change in momentum -- is the trend strengthening or fading.
 *   lowSkew         lottery-preference: negatively skewed assets outperform. Bali, Cakici & Whitelaw.
 *   volumeTrend     rising participation. The one signal here using a field other than close.
 *   idioVol         volatility of residuals against the equal-weight basket.
 *   beta            sensitivity to the basket, the direct betting-against-beta test.
 */

import { runRotation, randomSpreadNull, selectionP, spread, perYear } from "./xsmom.mjs";
import { buildGrid, trailingVol } from "./multifactor.mjs";

/** log return over [i-lookback, i-skip] */
const ret = (c, i, lb, sk) => {
  const a = c[i - lb], b = c[i - sk];
  return a > 0 && b > 0 ? Math.log(b / a) : null;
};

/**
 * Every signal is (closes, i, ctx) -> number or null, where HIGHER means "hold long".
 * ctx carries the shared calendar pieces a signal may need: the basket return series, and the
 * per-symbol volume grid.
 */
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

/** Equal-weight basket log return per bar, for the signals that need a market reference. */
export function basketReturns(grid, symbols, times) {
  const out = new Array(times.length).fill(null);
  for (let i = 1; i < times.length; i++) {
    let sum = 0, n = 0;
    for (const s of symbols) {
      const a = grid[s][i - 1], b = grid[s][i];
      if (a > 0 && b > 0) { sum += Math.log(b / a); n++; }
    }
    if (n) out[i] = sum / n;
  }
  return out;
}

/** Score one signal as a dollar-neutral long-short book, with its own random-split null. */
export function testSignal(name, series, {
  rebalanceBars = 21, topK = 10, slipPct = 0.0005, borrow = 0.05, draws = 200, seed = 20260904,
  // The random-split null does not depend on the signal, so a battery scoring twelve signals
  // against it recomputes the identical draws twelve times. Pass one in to share it -- which also
  // makes explicit that every p-value in the family is read off the SAME null sample, and so the
  // family's p-values are dependent by construction, not merely correlated through the data.
  nullResult = null,
} = {}) {
  const fn = SIGNALS[name];
  if (!fn) throw new Error(`factors: unknown signal "${name}" (have: ${Object.keys(SIGNALS).join(", ")})`);
  const { symbols, times, grid } = buildGrid(series);
  const volume = {};
  for (const s of symbols) {
    const m = new Map();
    for (const c of series[s]) m.set(Number(c.time), Number(c.volume) || 0);
    let last = 0;
    volume[s] = times.map((t) => { const v = m.get(t); if (v !== undefined) last = v; return last; });
  }
  const basket = basketReturns(grid, symbols, times);

  // The signal replaces the ranking; everything else -- the book, the costs, the null -- is the
  // machinery the momentum result already passed through, so results are directly comparable.
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars, topK, slipPct };
  const rank = (eligible, i, invert) => {
    const scored = [];
    for (const s of eligible) {
      const v = fn(grid[s], i, { basket, volume, symbol: s });
      if (v !== null && Number.isFinite(v)) scored.push([s, v]);
    }
    scored.sort((a, b) => (invert ? a[1] - b[1] : b[1] - a[1]));
    return scored.slice(0, topK).map(([s]) => s);
  };
  const top = runRotation({ ...opts, series, select: (e, i) => rank(e, i, false) });
  const bot = runRotation({ ...opts, series, select: (e, i) => rank(e, i, true) });

  const n = Math.min(top.periodReturns.length, bot.periodReturns.length);
  if (n < 6) return { name, periods: n, insufficient: true };
  const returns = [];
  // Borrow is annual; divide by this universe's own rebalances per year, not by an assumed 12.
  const ppy = perYear(top.rebalanceLog) ?? 12;
  for (let i = 0; i < n; i++) returns.push(0.5 * top.periodReturns[i] - 0.5 * bot.periodReturns[i] - 0.5 * borrow / ppy);
  let bal = 1000, peak = 1000, maxDD = 0;
  for (const r of returns) { bal *= Math.exp(r); peak = Math.max(peak, bal); maxDD = Math.max(maxDD, (peak - bal) / peak); }

  const nul = nullResult ?? randomSpreadNull(series, { ...opts, topK }, { draws, seed, borrow });
  const p = selectionP(nul, +bal.toFixed(2));
  const years = n / ppy;
  return {
    name, periods: n,
    finalBalance: +bal.toFixed(2),
    cagrPct: +(((bal / 1000) ** (1 / years) - 1) * 100).toFixed(2),
    maxDrawdownPct: +(100 * maxDD).toFixed(2),
    upPeriods: returns.filter((r) => r > 0).length,
    nullMedian: nul.median, p,
  };
}

/**
 * Benjamini-Hochberg across the whole family. This is not optional garnish: a battery reported
 * without it is a machine for producing false positives, and the size of the family is exactly
 * what makes any individual p-value hard to interpret.
 */
export function benjaminiHochberg(results, q = 0.05) {
  const live = results.filter((r) => !r.insufficient && Number.isFinite(r.p));
  const sorted = [...live].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let maxRank = 0;
  sorted.forEach((r, k) => { if (r.p <= ((k + 1) / m) * q) maxRank = k + 1; });
  const threshold = maxRank ? (maxRank / m) * q : 0;
  return {
    familySize: m, q, threshold: +threshold.toFixed(5),
    survivors: sorted.slice(0, maxRank).map((r) => r.name),
    ranked: sorted.map((r, k) => ({ ...r, rank: k + 1, bhCritical: +(((k + 1) / m) * q).toFixed(5),
                                    survives: k + 1 <= maxRank })),
  };
}
