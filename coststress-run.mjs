// Every number in this campaign assumes 0.8% slippage a side in crypto and 5bp in equities. Those
// are the Kraken taker fee and a retail equity commission, and both are assumptions rather than
// fills. This asks the only question that decides whether any of it is tradable: at what execution
// cost does the edge die?
//
// A stress, not a sweep. The rule is fixed at the canonical 252/21/21; only the cost moves, and the
// whole ladder is reported. The null moves with it, because a random book pays the same costs -- so
// p answers "does ranking still beat not ranking at this cost", not "is the book still profitable".
// Usage: node coststress-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { ledger, summarise } from "./trades.mjs";

const DRAWS = Number(process.argv[2] ?? 500);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
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

for (const [label, root, topK, base, ladder] of [
  // Crypto: Kraken taker is the base. Above it is a worse venue, thin books, or slippage on size.
  ["crypto", "./candle-bundle", 3, 0.008, [0.002, 0.008, 0.015, 0.025, 0.040, 0.060]],
  // Equities: 5bp is retail commission. Above it is spread plus impact on a less liquid name.
  ["sp500", "./sp500-bundle", 12, 0.0005, [0.0005, 0.002, 0.005, 0.010, 0.020, 0.040]],
]) {
  const series = load(root);
  console.log(`\n=== ${label}: ${Object.keys(series).length} symbols, topK ${topK}, base assumption ` +
    `${(100 * base).toFixed(2)}% a side ===`);
  console.log("slip/side".padEnd(11) + "cost/rebal".padStart(11) + "final$".padStart(10) + "CAGR".padStart(8) +
    "maxDD".padStart(9) + "p".padStart(8) + "expect/trade".padStart(14) + "  ");
  for (const slip of ladder) {
    const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip };
    const s = spread(series, opts, { borrow: 0.05 });
    const p = selectionP(randomSpreadNull(series, opts, { draws: DRAWS, borrow: 0.05 }), s.finalBalance);
    const years = s.periods / s.periodsPerYear;
    const ts = [...ledger(s.top, +1).closed, ...ledger(s.bot, -1).closed];
    const q = summarise(ts, years, { roundTripPct: 100 * 2 * slip });
    // What the book actually pays each rebalance, given how much of it turns over.
    const turn = (s.top.avgTurnover + s.bot.avgTurnover) / 2;
    const perRebal = 100 * 2 * slip * turn;
    console.log(`${(100 * slip).toFixed(2)}%`.padEnd(11) + `${perRebal.toFixed(2)}%`.padStart(11) +
      ("$" + s.finalBalance).padStart(10) + s.cagrPct.toFixed(1).padStart(7) + "%" +
      s.maxDrawdownPct.toFixed(2).padStart(8) + "%" + p.toFixed(4).padStart(8) +
      `${q.expectancyPct.toFixed(2)}%`.padStart(14) + (Math.abs(slip - base) < 1e-9 ? "   <- assumed" : ""));
  }
}
console.log("\nThe null pays the same costs, so p asks whether RANKING still beats not ranking at that");
console.log("cost -- not whether the book is still profitable. Read the CAGR column for the latter.");
