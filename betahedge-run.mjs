// The equities spread is concave -- it loses at both market extremes -- and crash-run.mjs isolates
// why: the SHORT leg has beta 2.17 in up markets against 0.51 in down ones, while the long leg is
// a flat 1.16 / 1.49. Past losers rip in rallies and barely fall in declines, and the book is short
// them. That is the textbook momentum-crash mechanism, and it has a textbook fix: size the short
// leg so the book's NET beta is zero rather than assuming dollar-neutral means beta-neutral.
//
// One pre-specified variant, reported whether it works or not. The hedge ratio is beta_long /
// beta_short, both estimated on the trailing 12 periods ONLY -- never including the period being
// sized -- and clamped to [0.5, 1.5] so a near-zero beta estimate cannot blow the book up.
// Usage: node betahedge-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { spread, perYear } from "./xsmom.mjs";
import { bookStats } from "./portfolio.mjs";

const LOOKBACK = 12, CLAMP = [0.5, 1.5];
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};
function basketPeriods(series, rebalanceLog) {
  const closeAt = {};
  for (const [sym, bars] of Object.entries(series)) closeAt[sym] = new Map(bars.map(b => [Number(b.time), Number(b.close)]));
  const snaps = rebalanceLog.map(r => {
    const out = {};
    for (const [sym, m] of Object.entries(closeAt)) { let last = null; for (const [t, v] of m) if (t <= r.at && v > 0) last = v; out[sym] = last; }
    return out;
  });
  const rets = [];
  for (let i = 1; i < snaps.length; i++) {
    let sum = 0, n = 0;
    for (const sym of Object.keys(closeAt)) {
      const a = snaps[i - 1][sym], b = snaps[i][sym];
      if (a > 0 && b > 0) { sum += Math.log(b / a); n++; }
    }
    rets.push(n ? sum / n : 0);
  }
  return rets;
}
const beta = (xs, ys) => {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  return vx > 0 ? cov / vx : null;
};
const ols = beta;

for (const [label, root, topK, slip] of [
  ["sp500", "./sp500-bundle", 12, 0.0005],
  ["crypto", "./candle-bundle", 3, 0.008],
]) {
  const series = load(root);
  const s = spread(series, { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip }, { borrow: 0.05 });
  const mkt = basketPeriods(series, s.top.rebalanceLog).slice(0, s.returns.length);
  const n = Math.min(mkt.length, s.returns.length);
  const ppy = s.periodsPerYear;
  const borrowPer = 0.5 * 0.05 / ppy;

  const hedged = [], ratios = [];
  for (let i = 0; i < n; i++) {
    let h = 1;
    if (i >= LOOKBACK) {
      const xs = mkt.slice(i - LOOKBACK, i);
      const bl = beta(xs, s.top.periodReturns.slice(i - LOOKBACK, i));
      const bs = beta(xs, s.bot.periodReturns.slice(i - LOOKBACK, i));
      if (bl !== null && bs !== null && Math.abs(bs) > 1e-6) h = Math.min(CLAMP[1], Math.max(CLAMP[0], bl / bs));
    }
    ratios.push(h);
    // Same book, short leg scaled by h. Costs stay as charged: the short leg's turnover cost is
    // added back the same way spread() does it, scaled by the leg's size.
    hedged.push(0.5 * s.top.periodReturns[i] - 0.5 * h * s.bot.periodReturns[i]
                + h * (s.bot.periodCosts[i] ?? 0) - borrowPer * h);
  }

  const upIdx = [], downIdx = [];
  for (let i = 0; i < n; i++) (mkt[i] >= 0 ? upIdx : downIdx).push(i);
  const show = (name, rets) => {
    const st = bookStats(rets, { periodsPerYear: ppy });
    console.log(name.padEnd(22) + ("$" + st.final.toFixed(2)).padStart(10) + st.cagrPct.toFixed(1).padStart(8) + "%" +
      (st.sharpe ?? NaN).toFixed(2).padStart(8) +
      (ols(upIdx.map(i => mkt[i]), upIdx.map(i => rets[i])) ?? NaN).toFixed(2).padStart(9) +
      (ols(downIdx.map(i => mkt[i]), downIdx.map(i => rets[i])) ?? NaN).toFixed(2).padStart(9) +
      `   ${st.upPeriods}/${st.periods}`);
  };
  console.log(`\n=== ${label}: ${n} periods, hedge ratio from the trailing ${LOOKBACK} periods only ===`);
  console.log("book".padEnd(22) + "final$".padStart(10) + "CAGR".padStart(9) + "Sharpe".padStart(8) +
    "upBeta".padStart(9) + "downBeta".padStart(9) + "   up");
  show("dollar-neutral", s.returns.slice(0, n));
  show("beta-hedged short", hedged);
  const live = ratios.slice(LOOKBACK);
  console.log(`hedge ratio: mean ${(live.reduce((a, b) => a + b, 0) / live.length).toFixed(2)}, ` +
    `min ${Math.min(...live).toFixed(2)}, max ${Math.max(...live).toFixed(2)}, ` +
    `at the clamp in ${live.filter(r => r <= CLAMP[0] + 1e-9 || r >= CLAMP[1] - 1e-9).length} of ${live.length} periods`);
}
console.log("\nDrawdowns are omitted: the hedged book has no per-bar path here, and a period-end mark");
console.log("would understate it -- the mistake this project has made four times.");
