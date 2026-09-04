// Closing the loop I left open: merging the universes failed because momentum ranks on RAW return
// and crypto's return distribution is roughly 4x as wide, so crypto took 30% of the long slots on
// 18% of the universe. I wrote that volatility-standardising the score would plausibly repair it
// and did not test it. This tests it.
//
// One change only: rank by formation return divided by realised volatility over the same window,
// instead of by formation return. Everything else -- 252/21/21, the book, the costs, the null --
// is unchanged, so the comparison isolates the standardisation.
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { runRotation, randomSpreadNull, selectionP, formationReturn, perYear } from "./xsmom.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = (root, prefix) => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[prefix + p] = c;
  }
  return o;
};
const crypto = load("./candle-bundle", "C:");
const equity = load("./sp500-bundle", "E:");
const merged = { ...crypto, ...equity };
const isCrypto = s => s.startsWith("C:");

// A shared calendar and close grid, so the score can be computed the same way the ranking is.
function gridOf(series) {
  const symbols = Object.keys(series);
  const times = [...new Set(symbols.flatMap(s => series[s].map(c => Number(c.time))))].sort((a, b) => a - b);
  const grid = {};
  for (const s of symbols) {
    const m = new Map(series[s].map(c => [Number(c.time), Number(c.close)]));
    let last = null;
    grid[s] = times.map(t => { const v = m.get(t); if (v > 0) last = v; return last; });
  }
  return { symbols, times, grid };
}
const { symbols, grid } = gridOf(merged);

// Realised volatility of log returns over the formation window, skipping the same recent bars.
function formationVol(closes, i, lookbackBars, skipBars) {
  const rs = [];
  for (let k = i - lookbackBars + 1; k <= i - skipBars; k++) {
    const a = closes[k - 1], b = closes[k];
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < 30) return null;
  const m = rs.reduce((x, y) => x + y, 0) / rs.length;
  return Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / (rs.length - 1));
}

const TOPK = 15, OPTS = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: TOPK, slipPct: 0.0005 };
const rank = (standardise, invert) => (eligible, i) => {
  const scored = [];
  for (const s of eligible) {
    const f = formationReturn(grid[s], i, OPTS.lookbackBars, OPTS.skipBars);
    if (f === null) continue;
    let v = f;
    if (standardise) { const sd = formationVol(grid[s], i, OPTS.lookbackBars, OPTS.skipBars); if (!sd) continue; v = f / sd; }
    scored.push([s, v]);
  }
  scored.sort((a, b) => (invert ? a[1] - b[1] : b[1] - a[1]));
  return scored.slice(0, TOPK).map(([x]) => x);
};

console.log(`merged universe: ${Object.keys(crypto).length} crypto + ${Object.keys(equity).length} equities`);
console.log("\nscore".padEnd(22) + "final$".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) +
  "up".padStart(8) + "p".padStart(9) + "  crypto share of long slots");
const nul = randomSpreadNull(merged, OPTS, { draws: 1000, borrow: 0.05 });
for (const [label, standardise] of [["raw return", false], ["return / vol", true]]) {
  const top = runRotation({ ...OPTS, series: merged, select: rank(standardise, false) });
  const bot = runRotation({ ...OPTS, series: merged, select: rank(standardise, true) });
  const n = Math.min(top.periodReturns.length, bot.periodReturns.length);
  const ppy = perYear(top.rebalanceLog) ?? 12;
  const rets = [];
  // The short leg's turnover cost enters with a minus sign and would be a credit; charge it.
  for (let i = 0; i < n; i++) {
    rets.push(0.5 * top.periodReturns[i] - 0.5 * bot.periodReturns[i]
              + (bot.periodCosts[i] ?? 0) - 0.5 * 0.05 / ppy);
  }
  let bal = 1000;
  for (const r of rets) bal *= Math.exp(r);
  // Per-bar drawdown, not a period-end mark.
  const perBar = 0.5 * 0.05 / (perYear(top.times) ?? 252);
  let peak = 1000, dd = 0, anchor = 1000;
  for (let m = 0; m < n; m++) {
    const lo = top.rebalanceLog[m]?.at, hi = top.rebalanceLog[m + 1]?.at;
    let sub = anchor;
    if (lo && hi) for (let k = 0; k < top.times.length; k++) {
      const t = top.times[k]; if (t <= lo || t > hi) continue;
      sub *= Math.exp(0.5 * top.barReturns[k] - 0.5 * bot.barReturns[k] - perBar);
      peak = Math.max(peak, sub); dd = Math.max(dd, (peak - sub) / peak);
    }
    anchor *= Math.exp(rets[m]); peak = Math.max(peak, anchor); dd = Math.max(dd, (peak - anchor) / peak);
  }
  const slots = top.rebalanceLog.flatMap(r => r.chosen);
  const share = 100 * slots.filter(isCrypto).length / slots.length;
  const yrs = n / ppy;
  console.log(label.padEnd(22) + ("$" + bal.toFixed(2)).padStart(10) +
    (((bal / 1000) ** (1 / yrs) - 1) * 100).toFixed(1).padStart(7) + "%" + (100 * dd).toFixed(2).padStart(8) + "%" +
    `${rets.filter(r => r > 0).length}/${n}`.padStart(8) +
    selectionP(nul, +bal.toFixed(2)).toFixed(4).padStart(9) + share.toFixed(1).padStart(20) + "%");
}
console.log(`\ncrypto is ${(100 * Object.keys(crypto).length / symbols.length).toFixed(1)}% of the universe, so that is the neutral share.`);
