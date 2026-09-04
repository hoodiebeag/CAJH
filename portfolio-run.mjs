// Ranks WITHIN each asset class, then combines the resulting books.
// Usage: node portfolio-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { spread } from "./xsmom.mjs";
import { alignReturns, correlation, bookStats, blend } from "./portfolio.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const FROM = sec("2023-01-01"), TO = sec("2026-09-02");

function load(root) {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= FROM && +b.time <= TO);
    if (c.length >= 400) out[p] = c;
  }
  return out;
}

const CANONICAL = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21 };
const crypto = spread(load("./candle-bundle"), { ...CANONICAL, topK: 3, slipPct: 0.008 }, { borrow: 0.05 });
const equity = spread(load("./sp500-bundle"), { ...CANONICAL, topK: 12, slipPct: 0.0005 }, { borrow: 0.05 });

// The spread's period returns are indexed against its long leg's rebalance calendar.
const book = sp => ({ returns: sp.returns, rebalanceLog: sp.top.rebalanceLog });
const aligned = alignReturns(book(crypto), book(equity));

const row = (label, s) => console.log(
  label.padEnd(28) + ("$" + s.final.toFixed(2)).padStart(10) + s.cagrPct.toFixed(1).padStart(8) + "%" +
  s.maxDrawdownPct.toFixed(2).padStart(8) + "%" + (s.sharpe ?? NaN).toFixed(2).padStart(8) +
  `   ${s.upPeriods}/${s.periods}`);

console.log(`${aligned.length} aligned monthly periods`);
console.log(`crypto/equities spread correlation: ${correlation(aligned.map(p => p.a), aligned.map(p => p.b)).toFixed(3)}\n`);
console.log("book".padEnd(28) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
row("crypto spread alone", bookStats(aligned.map(p => p.a)));
row("equities spread alone", bookStats(aligned.map(p => p.b)));
for (const w of [0.25, 0.35, 0.5, 0.65, 0.75]) {
  row(`${Math.round(w * 100)}/${Math.round((1 - w) * 100)} crypto/equities`, bookStats(blend(aligned, w)));
}

// The sweep above picks its own winner in sample, which is the trap this campaign keeps
// falling into. Inverse-volatility weighting picks one without looking: each period's weight
// comes from the volatility realised STRICTLY BEFORE it, with a 6-period warmup at 50/50.
const sd = xs => {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};
const invVol = [];
for (let i = 0; i < aligned.length; i++) {
  let w = 0.5;
  if (i >= 6) {
    const va = sd(aligned.slice(0, i).map(p => p.a)), vb = sd(aligned.slice(0, i).map(p => p.b));
    if (va > 0 && vb > 0) w = (1 / va) / (1 / va + 1 / vb);
  }
  invVol.push(Math.log(w * Math.exp(aligned[i].a) + (1 - w) * Math.exp(aligned[i].b)));
}
row("inverse-vol (causal)", bookStats(invVol));
