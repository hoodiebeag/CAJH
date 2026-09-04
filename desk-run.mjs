// "Apply these strategies to every asset class and decide what works best for each. Eventually we
// will pick and choose our strategy rather than strictly trading one variation."
//
// This is that book. Three screens -- BH on equities, BH on crypto, and both disjoint halves --
// left cross-sectional momentum standing everywhere and idioVol standing in equities only. So:
//
//   crypto    momentum alone. idioVol is -21.6% at p=0.539 there; it does not belong.
//   equities  momentum and idioVol together, equally weighted. They are the two factors the
//             battery found, and idioVol is the best equities number in it.
//
// The two class books are then blended by the same causal inverse-volatility rule as the
// cross-asset portfolio: each period's weight comes from volatility realised STRICTLY BEFORE it,
// warmed up at 50/50. No weight and no factor is chosen by looking at an outcome.
// Usage: node desk-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { spread } from "./xsmom.mjs";
import { testSignal } from "./factors.mjs";
import { alignReturns, correlation, bookStats, blend, blendDrawdownPct } from "./portfolio.mjs";
import { ledger, summarise } from "./trades.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};
const CANON = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21 };
const crypto = load("./candle-bundle"), equity = load("./sp500-bundle");

const cryptoBook = spread(crypto, { ...CANON, topK: 3, slipPct: 0.008 }, { borrow: 0.05 });
const eqMom = spread(equity, { ...CANON, topK: 12, slipPct: 0.0005 }, { borrow: 0.05 });
const eqIdio = testSignal("idioVol", equity, { topK: 12, slipPct: 0.0005, borrow: 0.05, draws: 1 });

const row = (label, s, dd) => console.log(
  label.padEnd(30) + ("$" + s.final.toFixed(2)).padStart(10) + s.cagrPct.toFixed(1).padStart(8) + "%" +
  ((dd ?? s.maxDrawdownPct) === null ? "     n/a" : (dd ?? s.maxDrawdownPct).toFixed(2).padStart(8) + "%") +
  (s.sharpe ?? NaN).toFixed(2).padStart(8) + `   ${s.upPeriods}/${s.periods}`);

console.log("Every drawdown here is a per-bar mark anchored to the costed path.\n");
console.log("book".padEnd(30) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
row("crypto momentum", bookStats(cryptoBook.returns, { periodsPerYear: cryptoBook.periodsPerYear }), cryptoBook.maxDrawdownPct);
row("equities momentum", bookStats(eqMom.returns, { periodsPerYear: eqMom.periodsPerYear }), eqMom.maxDrawdownPct);
row("equities idioVol", bookStats(eqIdio.returns, { periodsPerYear: eqIdio.periodsPerYear }), eqIdio.maxDrawdownPct);

// --- the equities sleeve: two factors on the same calendar, so indices line up directly.
const n = Math.min(eqMom.returns.length, eqIdio.returns.length);
const eqPairs = [];
for (let i = 0; i < n; i++) {
  eqPairs.push({ from: eqMom.top.rebalanceLog[i].at, at: eqMom.top.rebalanceLog[i + 1]?.at,
                 a: eqMom.returns[i], b: eqIdio.returns[i] });
}
const sleeve = blend(eqPairs, 0.5);
console.log(`\nmomentum against idioVol inside equities: correlation ` +
  `${correlation(eqPairs.map(p => p.a), eqPairs.map(p => p.b)).toFixed(3)}`);
row("EQUITIES SLEEVE 50/50", bookStats(sleeve, { periodsPerYear: eqMom.periodsPerYear }),
    blendDrawdownPct(eqMom, { ...eqIdio, top: eqIdio.top }, eqPairs, 0.5));

// The sleeve is defined as momentum + idioVol on a DIVERSIFICATION argument -- momentum is the one
// factor robust across asset classes, idioVol the one genuine equities-only factor, so hold both.
// That argument is not a performance claim and the evidence runs against it, so both are built and
// both are reported: the desk as defined, and the desk with idioVol alone as its equities sleeve.

// --- the desk: crypto momentum against the equities sleeve, causal inverse-vol.
function buildDesk(sleeveReturns, name) {
  const sleeveBook = { returns: sleeveReturns, rebalanceLog: eqMom.top.rebalanceLog,
                       times: eqMom.times, barReturns: eqMom.barReturns, top: eqMom.top };
  const aligned = alignReturns({ returns: cryptoBook.returns, rebalanceLog: cryptoBook.top.rebalanceLog }, sleeveBook);
  const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
  const wts = [], desk = [];
  for (let i = 0; i < aligned.length; i++) {
    let w = 0.5;
    if (i >= 6) {
      const va = sd(aligned.slice(0, i).map(p => p.a)), vb = sd(aligned.slice(0, i).map(p => p.b));
      if (va > 0 && vb > 0) w = (1 / va) / (1 / va + 1 / vb);
    }
    wts.push(w);
    desk.push(Math.log(w * Math.exp(aligned[i].a) + (1 - w) * Math.exp(aligned[i].b)));
  }
  console.log(`\n${name}: ${aligned.length} blended periods, using ${aligned.aPeriodsUsed} of ` +
    `${aligned.aPeriodsTotal} crypto periods, correlation ` +
    `${(correlation(aligned.map(p => p.a), aligned.map(p => p.b)) ?? NaN).toFixed(3)}`);
  console.log("book".padEnd(30) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
  row("crypto, overlap only", bookStats(aligned.map(p => p.a)), blendDrawdownPct(cryptoBook, sleeveBook, aligned, 1));
  row("equities sleeve, overlap", bookStats(aligned.map(p => p.b)), blendDrawdownPct(cryptoBook, sleeveBook, aligned, 0));
  row("50/50", bookStats(blend(aligned, 0.5)), blendDrawdownPct(cryptoBook, sleeveBook, aligned, 0.5));
  row("THE DESK (inverse-vol)", bookStats(desk), blendDrawdownPct(cryptoBook, sleeveBook, aligned, wts));
  console.log(`final inverse-vol weight: ${(100 * wts[wts.length - 1]).toFixed(1)}% crypto`);
  return aligned;
}
const aligned = buildDesk(sleeve, "DESK AS DEFINED (equities sleeve = momentum + idioVol)");
buildDesk(eqIdio.returns.slice(0, n), "ALTERNATIVE (equities sleeve = idioVol alone)");

// --- what it asks of you, per trade.
const years = aligned.length / eqMom.periodsPerYear;
const ts = [...ledger(cryptoBook.top, +1).closed, ...ledger(cryptoBook.bot, -1).closed];
const es = [...ledger(eqMom.top, +1).closed, ...ledger(eqMom.bot, -1).closed,
            ...ledger(eqIdio.top, +1).closed, ...ledger(eqIdio.bot, -1).closed];
console.log("\nsleeve".padEnd(30) + "trades".padStart(8) + "/mo".padStart(7) + "win%".padStart(7) +
  "payoff".padStart(8) + "expect".padStart(9));
for (const [lab, list, slip] of [["crypto momentum", ts, 0.008], ["equities, both factors", es, 0.0005]]) {
  const q = summarise(list, years, { roundTripPct: 100 * 2 * slip });
  console.log(lab.padEnd(30) + String(q.trades).padStart(8) + String(q.tradesPerMonth).padStart(7) +
    q.winRatePct.toFixed(1).padStart(7) + String(q.payoffRatio).padStart(8) + q.expectancyPct.toFixed(2).padStart(9));
}
