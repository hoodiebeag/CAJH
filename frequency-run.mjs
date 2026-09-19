// "Maximize the number of trades taken, while still being confident in their ability to win."
//
// Rebalance frequency is the dial that sets trade count, and it is a COST question: crypto pays
// 1.6% round trip, so doubling the frequency doubles a charge that already eats a tenth of the
// average win. The whole ladder is reported, never the best cell -- 21 bars stays the
// pre-registered canonical choice whatever this shows.
//
// Trade counts come from the real ledger, not from a formula: a formula would have to assume how
// many bars a year the universe trades, and that assumption has already been wrong once here.
// Usage: node frequency-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { ledger, summarise } from "./trades.mjs";

const DRAWS = Number(process.argv[2] ?? 1000);
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

for (const [label, root, topK, slip] of [
  ["crypto", "./candle-bundle", 3, 0.008],
  ["sp500", "./sp500-bundle", 12, 0.0005],
]) {
  const series = load(root);
  console.log(`\n=== ${label}: ${Object.keys(series).length} symbols, topK ${topK}, ` +
    `slip ${(100 * slip).toFixed(2)}%, ${DRAWS} null draws ===`);
  console.log("rebal".padEnd(9) + "final$".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) +
    "p".padStart(9) + "trades".padStart(8) + "/mo".padStart(7) + "win%".padStart(7) +
    "payoff".padStart(8) + "expect".padStart(9));
  for (const rb of [5, 10, 21, 42, 63]) {
    const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: rb, topK, slipPct: slip };
    const s = spread(series, opts, { borrow: 0.05 });
    const p = selectionP(randomSpreadNull(series, opts, { draws: DRAWS, borrow: 0.05 }), s.finalBalance);
    const years = s.periods / s.periodsPerYear;
    const ts = [...ledger(s.top, +1).closed, ...ledger(s.bot, -1).closed];
    const q = summarise(ts, years, { roundTripPct: 100 * 2 * slip });
    console.log(`${rb} bars`.padEnd(9) + ("$" + s.finalBalance).padStart(10) + s.cagrPct.toFixed(1).padStart(7) + "%" +
      s.maxDrawdownPct.toFixed(2).padStart(8) + "%" + p.toFixed(4).padStart(9) +
      String(q.trades).padStart(8) + String(q.tradesPerMonth).padStart(7) + q.winRatePct.toFixed(1).padStart(7) +
      String(q.payoffRatio).padStart(8) + q.expectancyPct.toFixed(2).padStart(9));
  }
}
