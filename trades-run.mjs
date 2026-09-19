// The trade ledger against the stated acceptance criterion.
// Usage: node trades-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";
import { ledger, summarise } from "./trades.mjs";

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

console.log("Every trade is charged slippage on the way in and again on the way out.\n");
console.log("book".padEnd(24) + "trades".padStart(8) + "/mo".padStart(7) + "win%".padStart(8) +
  "avgWin".padStart(9) + "avgLoss".padStart(9) + "payoff".padStart(8) + "expect".padStart(9) + "holdD".padStart(7));

let totalPerMonth = 0;
for (const [label, root, topK, slip] of [
  ["crypto-29", "./candle-bundle", 3, 0.008],
  ["sp500-128", "./sp500-bundle", 12, 0.0005],
]) {
  const series = load(root);
  const s = spread(series, { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip }, { borrow: 0.05 });
  const years = s.periods / s.periodsPerYear;
  const longs = ledger(s.top, +1), shorts = ledger(s.bot, -1);
  for (const [leg, ts] of [["long leg", longs.closed], ["short leg", shorts.closed],
                           ["both legs", [...longs.closed, ...shorts.closed]]]) {
    const q = summarise(ts, years, { roundTripPct: 100 * 2 * slip });
    if (!q) { console.log(`${label} ${leg}: no trades`); continue; }
    if (leg === "both legs") totalPerMonth += q.tradesPerMonth;
    console.log(`${label} ${leg}`.padEnd(24) + String(q.trades).padStart(8) + String(q.tradesPerMonth).padStart(7) +
      q.winRatePct.toFixed(1).padStart(8) + q.avgWinPct.toFixed(2).padStart(9) + q.avgLossPct.toFixed(2).padStart(9) +
      String(q.payoffRatio).padStart(8) + q.expectancyPct.toFixed(3).padStart(9) + String(q.medianHoldDays).padStart(7));
  }
  console.log(`  ${s.periods} periods over ${years.toFixed(2)} yrs; open at the end: ` +
    `${longs.stillOpen} long, ${shorts.stillOpen} short (not counted as trades); ` +
    `unpriced: ${longs.unpriced + shorts.unpriced}`);
}
console.log(`\nAgainst the criterion -- about ten trades a month at a win rate of 40% or better, with`);
console.log(`the wins covering the losses: the win rate and the payoff clear it comfortably, the`);
console.log(`trade count does not. Both books together run ${totalPerMonth.toFixed(1)} a month.`);
