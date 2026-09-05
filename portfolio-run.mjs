// Ranks WITHIN each asset class, then combines the resulting books.
// Usage: node portfolio-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";
import { alignReturns, correlation, bookStats, blend, blendDrawdownPct } from "./portfolio.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const FROM = sec("2023-01-01"), TO = sec("2026-09-02");

function load(root) {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= FROM && +b.time <= TO);
    if (c.length >= 400) out[p] = c;
  }
  // Screened before ranking; PARA supplied two thirds of the equities result before this existed.
  return screenUniverse(out).kept;
}

const CANONICAL = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21 };
const crypto = spread(load("./candle-bundle"), { ...CANONICAL, topK: 3, slipPct: 0.008 }, { borrow: 0.05 });
const equity = spread(load("./sp500-bundle"), { ...CANONICAL, topK: 12, slipPct: 0.0005 }, { borrow: 0.05 });

// The spread's period returns are indexed against its long leg's rebalance calendar.
// Crypto is passed first because it is the FASTER book -- 365 bars a year against equities' 252,
// so 17.4 rebalances a year against 12 -- and alignReturns compounds the faster book into the
// slower one's clock rather than sampling one period from it.
const book = sp => ({ returns: sp.returns, rebalanceLog: sp.top.rebalanceLog });
const aligned = alignReturns(book(crypto), book(equity));

// ddPct overrides bookStats' period-end drawdown with a per-bar one. bookStats cannot see an
// intra-period low, and marking this book at period ends alone once understated a drawdown by 44%.
const row = (label, s, ddPct) => console.log(
  label.padEnd(28) + ("$" + s.final.toFixed(2)).padStart(10) + s.cagrPct.toFixed(1).padStart(8) + "%" +
  (ddPct ?? s.maxDrawdownPct).toFixed(2).padStart(8) + "%" + (s.sharpe ?? NaN).toFixed(2).padStart(8) +
  `   ${s.upPeriods}/${s.periods}`);

console.log(`crypto book: ${crypto.periods} periods at ${crypto.periodsPerYear}/yr; ` +
  `equities book: ${equity.periods} periods at ${equity.periodsPerYear}/yr`);
console.log(`${aligned.length} aligned monthly periods, using ${aligned.aPeriodsUsed} of ` +
  `${aligned.aPeriodsTotal} crypto periods`);
console.log(`crypto/equities spread correlation: ${correlation(aligned.map(p => p.a), aligned.map(p => p.b)).toFixed(3)}\n`);
console.log("book".padEnd(28) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
// The two full books, on their own clocks -- the ground truth the aligned rows are cut from.
row(`crypto book (all ${crypto.periods})`, bookStats(crypto.returns, { periodsPerYear: crypto.periodsPerYear }), crypto.maxDrawdownPct);
row(`equities book (all ${equity.periods})`, bookStats(equity.returns, { periodsPerYear: equity.periodsPerYear }), equity.maxDrawdownPct);
// The same books restricted to the overlap, which is the only span where a blend exists.
row("crypto, overlap only", bookStats(aligned.map(p => p.a)), blendDrawdownPct(crypto, equity, aligned, 1));
row("equities, overlap only", bookStats(aligned.map(p => p.b)), blendDrawdownPct(crypto, equity, aligned, 0));
for (const w of [0.25, 0.35, 0.5, 0.65, 0.75]) {
  row(`${Math.round(w * 100)}/${Math.round((1 - w) * 100)} crypto/equities`, bookStats(blend(aligned, w)),
      blendDrawdownPct(crypto, equity, aligned, w));
}

// The sweep above picks its own winner in sample, which is the trap this campaign keeps
// falling into. Inverse-volatility weighting picks one without looking: each period's weight
// comes from the volatility realised STRICTLY BEFORE it, with a 6-period warmup at 50/50.
const sd = xs => {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};
const invVol = [], invVolWeights = [];
for (let i = 0; i < aligned.length; i++) {
  let w = 0.5;
  if (i >= 6) {
    const va = sd(aligned.slice(0, i).map(p => p.a)), vb = sd(aligned.slice(0, i).map(p => p.b));
    if (va > 0 && vb > 0) w = (1 / va) / (1 / va + 1 / vb);
  }
  invVolWeights.push(w);
  invVol.push(Math.log(w * Math.exp(aligned[i].a) + (1 - w) * Math.exp(aligned[i].b)));
}
row("inverse-vol (causal)", bookStats(invVol), blendDrawdownPct(crypto, equity, aligned, invVolWeights));
