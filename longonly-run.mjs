// EVERY crypto number in this campaign assumes the book can short. The record establishes that
// this Kraken account has no short or margin access (FUNDING-CARRY-DECAY-CHECK), so the crypto
// long-short spread is RESEARCH-ONLY on the venue actually available. That constraint has been
// sitting in docs/archive while the desk book was built on top of it, and it deserves a number
// rather than a footnote: what does the strategy look like if you can only go long?
//
// A long-only book is not market-neutral, so beating zero is not the test -- it carries full market
// beta and a rising market would flatter it. Two comparisons matter:
//   1. the equal-weight BASKET of the same universe, which is what holding everything would give;
//   2. the random-SELECTION null, which asks whether RANKING beats picking the same number of
//      names at random -- the only question the strategy actually answers.
// Usage: node longonly-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { runRotation, randomSelectionNull, selectionP, spread, perYear, anchoredDrawdown } from "./xsmom.mjs";
import { ledger, summarise } from "./trades.mjs";
import { alignReturns, correlation, bookStats, blend, blendDrawdownPct } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 500);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};

const books = {};
for (const [label, root, topK, slip] of [
  ["crypto", "./candle-bundle", 3, 0.008],
  ["sp500", "./sp500-bundle", 12, 0.0005],
]) {
  const series = load(root);
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip };
  const long = runRotation({ ...opts, series, pick: "top" });
  const ls = spread(series, opts, { borrow: 0.05 });
  const ppy = perYear(long.rebalanceLog) ?? 12;

  // The basket: hold the whole universe equally, rebalanced on the same calendar, same slippage
  // on nothing since nothing turns over.
  const all = Object.keys(series);
  const basket = runRotation({ ...opts, series, topK: all.length, slipPct: slip,
                               select: () => all });

  const nul = randomSelectionNull({ ...opts, series }, { draws: DRAWS });
  const p = selectionP(nul, long.finalBalance);

  const yrs = long.periodReturns.length / ppy;
  const cagr = b => (((b / 1000) ** (1 / yrs) - 1) * 100);
  const dd = r => anchoredDrawdown(r.periodReturns, r.barReturns, r.times, r.rebalanceLog);
  const trades = summarise(ledger(long, +1).closed, yrs, { roundTripPct: 100 * 2 * slip });

  console.log(`\n=== ${label}: ${all.length} symbols, long-only top ${topK}, ${DRAWS} null draws ===`);
  console.log("book".padEnd(30) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "   up");
  const row = (n, b, d, up) => console.log(n.padEnd(30) + ("$" + b.toFixed(2)).padStart(10) +
    cagr(b).toFixed(1).padStart(8) + "%" + (d === null ? "     n/a" : d.toFixed(2).padStart(8) + "%") + (up ? `   ${up}` : ""));
  row("long-only top " + topK, long.finalBalance, dd(long));
  row("equal-weight basket", basket.finalBalance, dd(basket));
  row("long-short spread", ls.finalBalance, ls.maxDrawdownPct, `${ls.upPeriods}/${ls.periods}`);
  console.log(`random-selection null: median $${nul.median}, p05 $${nul.p05}, p95 $${nul.p95}`);
  console.log(`long-only against that null: p = ${p.toFixed(4)}`);
  console.log(`long-only trades: ${trades.trades} (${trades.tradesPerMonth}/mo), win ${trades.winRatePct}%, ` +
    `payoff ${trades.payoffRatio}, expectancy ${trades.expectancyPct}%`);
  books[label] = { returns: long.periodReturns, rebalanceLog: long.rebalanceLog,
                   times: long.times, barReturns: long.barReturns,
                   top: { rebalanceLog: long.rebalanceLog }, periodsPerYear: ppy };
}

// Does the cross-asset blend rescue a 69% drawdown? Both legs are now LONG the market, so the
// negative correlation that made the spread blend work has no reason to survive.
{
  const aligned = alignReturns(books.crypto, books.sp500);
  const c = correlation(aligned.map(p => p.a), aligned.map(p => p.b));
  console.log(`\n=== LONG-ONLY DESK: ${aligned.length} blended periods, correlation ${(c ?? NaN).toFixed(3)} ===`);
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
  const line = (name, rets, ddPct) => {
    const st = bookStats(rets, { periodsPerYear: books.sp500.periodsPerYear });
    console.log(name.padEnd(30) + ("$" + st.final.toFixed(2)).padStart(10) + st.cagrPct.toFixed(1).padStart(8) + "%" +
      ddPct.toFixed(2).padStart(8) + "%" + (st.sharpe ?? NaN).toFixed(2).padStart(8) + `   ${st.upPeriods}/${st.periods}`);
  };
  console.log("book".padEnd(30) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
  line("crypto long-only, overlap", aligned.map(p => p.a), blendDrawdownPct(books.crypto, books.sp500, aligned, 1));
  line("equities long-only, overlap", aligned.map(p => p.b), blendDrawdownPct(books.crypto, books.sp500, aligned, 0));
  line("50/50", blend(aligned, 0.5), blendDrawdownPct(books.crypto, books.sp500, aligned, 0.5));
  line("inverse-vol (causal)", desk, blendDrawdownPct(books.crypto, books.sp500, aligned, wts));
  console.log(`final inverse-vol weight: ${(100 * wts[wts.length - 1]).toFixed(1)}% crypto`);
}
console.log("\nThe long-only book carries full market beta. Its drawdown is therefore a market");
console.log("drawdown plus a selection effect, and is not comparable to the spread's.");
