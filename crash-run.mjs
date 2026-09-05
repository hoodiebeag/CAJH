// Momentum crashes are the documented way this factor fails: after a sharp market decline, the
// past losers the book is SHORT rebound violently and the spread takes a large loss. No such crash
// occurred in either asset class over 2023-2026, so this cannot be tested directly here.
//
// What CAN be measured is the LOADING -- whether the book carries the exposure that turns a
// rebound into a crash, even though no rebound large enough to fire it arrived. Three readings:
//
//   1. Up-beta and down-beta against the universe's own equal-weight basket. The crash mechanism
//      requires the spread's beta to go sharply negative when the market falls, so that the
//      recovery runs against the book. Symmetric betas near zero mean the loading is absent.
//   2. Returns conditional on the market already being in a deep drawdown at the START of the
//      period -- those are the periods that CONTAIN rebounds.
//   3. The worst individual periods, and whether they cluster after market troughs.
//
// Usage: node crash-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  // Screened before ranking: a corrupted series is the strongest possible loser and gets shorted
  // every period. PARA supplied two thirds of the equities result before this existed.
  return screenUniverse(o).kept;
};

// Equal-weight basket of the whole universe, per period, on the book's own rebalance calendar.
function basketPeriods(series, rebalanceLog) {
  const closeAt = {};
  for (const [sym, bars] of Object.entries(series)) closeAt[sym] = new Map(bars.map(b => [Number(b.time), Number(b.close)]));
  const priceAt = at => {
    const out = {};
    for (const [sym, m] of Object.entries(closeAt)) {
      let last = null;
      for (const [t, v] of m) { if (t <= at && v > 0) last = v; }
      out[sym] = last;
    }
    return out;
  };
  const snaps = rebalanceLog.map(r => priceAt(r.at));
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

const ols = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  return vx > 0 ? { beta: cov / vx, alpha: my - (cov / vx) * mx, n } : null;
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

for (const [label, root, topK, slip] of [
  ["sp500", "./sp500-bundle", 12, 0.0005],
  ["crypto", "./candle-bundle", 3, 0.008],
]) {
  const series = load(root);
  const s = spread(series, { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip }, { borrow: 0.05 });
  const mkt = basketPeriods(series, s.top.rebalanceLog).slice(0, s.returns.length);
  const n = Math.min(mkt.length, s.returns.length);

  // The market's drawdown from its running peak, measured at the START of each period.
  const ddAtStart = [];
  { let bal = 1, peak = 1;
    for (let i = 0; i < n; i++) { ddAtStart.push((peak - bal) / peak); bal *= Math.exp(mkt[i]); peak = Math.max(peak, bal); } }

  const up = [], down = [];
  for (let i = 0; i < n; i++) (mkt[i] >= 0 ? up : down).push(i);
  const bUp = ols(up.map(i => mkt[i]), up.map(i => s.returns[i]));
  const bDown = ols(down.map(i => mkt[i]), down.map(i => s.returns[i]));

  console.log(`\n=== ${label}: ${n} periods, spread against its own equal-weight basket ===`);
  console.log(`  market up periods   ${String(up.length).padStart(3)}   beta ${(bUp?.beta ?? NaN).toFixed(2).padStart(6)}   ` +
    `spread mean ${(100 * mean(up.map(i => s.returns[i]))).toFixed(2)}%`);
  console.log(`  market down periods ${String(down.length).padStart(3)}   beta ${(bDown?.beta ?? NaN).toFixed(2).padStart(6)}   ` +
    `spread mean ${(100 * mean(down.map(i => s.returns[i]))).toFixed(2)}%`);
  console.log(`  full-sample beta ${(ols(mkt.slice(0, n), s.returns.slice(0, n))?.beta ?? NaN).toFixed(2)}`);

  // WHICH LEG carries the asymmetry. The classic crash mechanism is specific: past losers are
  // high-beta, so the SHORT leg rips when the market rebounds. If the concavity lives in the long
  // leg instead, it is a different problem with a different fix.
  const legBeta = (leg, idx) => ols(idx.map(i => mkt[i]), idx.map(i => leg.periodReturns[i]))?.beta;
  console.log(`  long leg   beta  up ${(legBeta(s.top, up) ?? NaN).toFixed(2).padStart(6)}   ` +
    `down ${(legBeta(s.top, down) ?? NaN).toFixed(2).padStart(6)}`);
  console.log(`  short leg  beta  up ${(legBeta(s.bot, up) ?? NaN).toFixed(2).padStart(6)}   ` +
    `down ${(legBeta(s.bot, down) ?? NaN).toFixed(2).padStart(6)}   ` +
    `(the book is SHORT this leg, so a high beta here hurts a rally)`);

  // The rebound test: periods that BEGIN with the market already deep in a drawdown.
  const deepest = Math.max(...ddAtStart);
  for (const thr of [0.10, 0.20, 0.30]) {
    const idx = [];
    for (let i = 0; i < n; i++) if (ddAtStart[i] >= thr) idx.push(i);
    if (!idx.length) { console.log(`  no period began with the market ${(100 * thr).toFixed(0)}%+ below its peak`); continue; }
    console.log(`  began with market >=${(100 * thr).toFixed(0)}% below peak: ${idx.length} periods, ` +
      `spread mean ${(100 * mean(idx.map(i => s.returns[i]))).toFixed(2)}%, ` +
      `${idx.filter(i => s.returns[i] > 0).length}/${idx.length} up`);
  }
  console.log(`  deepest market drawdown seen at any period start: ${(100 * deepest).toFixed(1)}%`);

  const worst = s.returns.map((r, i) => [i, r]).sort((a, b) => a[1] - b[1]).slice(0, 4);
  console.log("  worst periods:");
  for (const [i, r] of worst) {
    console.log(`    ${iso(s.top.rebalanceLog[i + 1]?.at ?? 0)}  spread ${(100 * r).toFixed(1).padStart(6)}%   ` +
      `market ${(100 * mkt[i]).toFixed(1).padStart(6)}%   market was ${(100 * ddAtStart[i]).toFixed(1)}% below peak at the start`);
  }
}
console.log("\nNo momentum crash occurred in either class in this window, so none of this is a test of");
console.log("one. It measures whether the book carries the exposure a crash would act on.");
