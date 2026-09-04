/**
 * robustness.mjs -- the checks that decide whether a leaderboard row is worth anything.
 *
 * A balance is one number produced by one path through one sample. These ask how much of it
 * survives when a piece of that sample is removed:
 *
 *   leave one pair out    is the result one lucky instrument? The first run of this found two
 *                         ZECUSD trades carrying 35% of all R.
 *   trim the top winners  is the result a handful of trades? Trend following is SUPPOSED to be
 *                         right-tailed, so a steep decline here is not automatically damning --
 *                         but it says the mean is an unstable statistic and any p-value built on
 *                         it rests on those few observations.
 *   per year, standalone  does it work in more than one regime, or was it one good year?
 *   full-history pairs    nine pairs in this bundle start 2025-01-22. Restricting to the sixteen
 *                         that reach back to 2023 removes any advantage from a short lucky window.
 *
 * None of these can rescue an in-sample result. They can only show that the number is not resting
 * on a single pair, a single year, or five trades -- which is worth knowing before defending it.
 */

import { backtestMultiTF } from "./backtest.js";
import { slice, SPLIT } from "./campaign.mjs";
import { availablePairs, marketProxy } from "./bundle-loader.mjs";
import { buildEntryGate, sharpeRankTable, atr } from "./filters.mjs";
import { simulateEquity } from "./equity.mjs";
import { costFor } from "./costs.mjs";
import { pathToFileURL } from "url";

export const LEADER = {
  // Every component here was chosen by walkforward.mjs on training data alone -- a search that had
  // not seen the quarter it was judged on -- in eight or nine quarters out of nine. Nothing the
  // walk-forward declined is in it. That is why it looks different from the configuration the
  // in-sample search preferred:
  //
  //   filters           the ADX, MA-slope, ATR-band, extension and cross-sectional-Sharpe filters
  //                     from the literature search were all declined in 7 of 9 quarters and are
  //                     out. btcRegime at 50 days is IN: it had never actually been offered to the
  //                     walk-forward -- the filter grid held only null, atrPctBand, and
  //                     atrPctBand+crossSection -- and once offered it was chosen 9 quarters of 9,
  //                     taking the out-of-sample result from $2300.28 at 13.39% to $2588.43 at
  //                     10.96%. Whether BTC is above its own average is a market-wide state that
  //                     no single pair's chart contains.
  //   maxConcurrent     never selected under either fitting objective. The in-sample search liked
  //                     a cap of 3 ($5160 at 8.96% against $4875 at 12.94%); the walk-forward does
  //                     not support it, so it is not here.
  //   trendMa 150       the walk-forward picks 150 every quarter, not the 200 the in-sample sweep
  //                     spiked on.
  //   beTriggerR 3      chosen nine times out of nine, over the 2.5 the in-sample search preferred.
  //   maxHold 50        chosen seven times out of nine, over 100.
  //
  // It is also simply better in sample: $16,749.27 against $5,160.44, and better on the robustness
  // margins too. The cost is drawdown -- 25.1% against 8.96%, still half of BTC's 52.06%.
  entryMode: "breakout", alignMode: "none", lockBreakeven: true, maxStopPct: 0.20,
  beLockR: 0.2, volClamp: 3, entryDelayBars: 1, filters: { btcRegime: { period: 50 } },
  trendGate: true, trendGateMode: "ma", trendMa: 150, tpR: 100, minStopPct: 0.03,
  beTriggerR: 3, maxHold: 50, volTarget: 0.05, riskPct: 0.01, maxConcurrent: null,
};


/** Every trade a configuration takes, with the geometry the robustness checks slice on. */
export function collect(config, { minutes = 1440, from = SPLIT.trainStart, to = SPLIT.trainEnd } = {}) {
  const series = {};
  const cost = costFor(availablePairs(minutes), config.costModel ?? null);
  for (const pair of availablePairs(minutes)) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length >= 120) series[pair] = candles;
  }
  const btcCandles = config.filters?.btcRegime
    ? series[marketProxy(series, config.marketProxy ?? null)]
    : null;
  const sharpeRanks = config.filters?.crossSection
    ? sharpeRankTable(series, { lookback: config.filters.crossSection.lookback ?? 60 })
    : null;

  const trades = [];
  for (const [pair, candles] of Object.entries(series)) {
    const entryGate = config.filters
      ? buildEntryGate(config.filters, { candles, entryMins: minutes, btcCandles, sharpeRanks, pair })
      : null;
    const r = backtestMultiTF({ series: [{ label: String(minutes), mins: minutes, candles }] },
      { ...config, entryGate, entryTf: String(minutes), feeRate: cost.feeRate, slipPct: cost.slipPct });
    const a = atr(candles, config.atrPeriod ?? 14);
    const atrByTime = new Map();
    for (let i = 0; i < candles.length; i++) {
      const px = Number(candles[i].close);
      if (a[i] !== null && px > 0) atrByTime.set(Number(candles[i].time), a[i] / px);
    }
    for (const x of r.excursions) {
      if (!Number.isFinite(x.entryTime)) continue;
      trades.push({ symbol: pair, netR: x.r, entryTime: x.entryTime * 1000, stopPct: x.risk / x.entry,
        barsHeld: x.barsHeld, atrPct: atrByTime.get(x.entryTime),
        exitTime: (x.entryTime + (x.barsHeld ?? 0) * minutes * 60) * 1000 });
    }
  }
  return { trades, series };
}

export function summarise(trades, { riskPct = 0.005, startingBalance = 1000, volTarget = null, volClamp = 3, maxConcurrent = null } = {}) {
  if (!trades.length) return { trades: 0, meanR: null, finalBalance: startingBalance, maxDrawdownPct: 0 };
  const eq = simulateEquity(trades, { riskPct, startingBalance, volTarget, volClamp, maxConcurrent });
  return {
    trades: trades.length,
    meanR: +(trades.reduce((s, t) => s + t.netR, 0) / trades.length).toFixed(4),
    finalBalance: +eq.finalBalance.toFixed(2),
    maxDrawdownPct: +eq.maxDrawdownPct.toFixed(2),
  };
}

export function report(config = LEADER, opts = {}) {
  const { trades, series } = collect(config, opts);
  opts = { volTarget: config.volTarget ?? null, volClamp: config.volClamp ?? 3,
           maxConcurrent: config.maxConcurrent ?? null, riskPct: config.riskPct ?? 0.005, ...opts };
  const out = { all: summarise(trades, opts) };

  out.leaveOnePairOut = [...new Set(trades.map((t) => t.symbol))]
    .map((pair) => ({ without: pair, ...summarise(trades.filter((t) => t.symbol !== pair), opts) }))
    .sort((a, b) => a.finalBalance - b.finalBalance);

  const byBest = [...trades].sort((a, b) => b.netR - a.netR);
  out.trimTopWinners = [1, 2, 3, 5, 10, 20].map((k) => ({ dropped: k, ...summarise(byBest.slice(k), opts) }));

  const year = (t) => new Date(t.entryTime).getUTCFullYear();
  out.perYear = [...new Set(trades.map(year))].sort()
    .map((y) => ({ year: y, ...summarise(trades.filter((t) => year(t) === y), opts) }));

  const fullHistory = new Set(Object.entries(series).filter(([, c]) => c.length > 1100).map(([p]) => p));
  out.fullHistoryPairsOnly = { pairs: fullHistory.size, ...summarise(trades.filter((t) => fullHistory.has(t.symbol)), opts) };

  const wins = trades.filter((t) => t.netR > 0).length;
  const sortedR = [...trades].map((t) => t.netR).sort((a, b) => a - b);
  const totalR = trades.reduce((s, t) => s + t.netR, 0);
  const days = new Set(trades.map((t) => new Date(t.entryTime).toISOString().slice(0, 10)));
  out.shape = {
    winRatePct: +(100 * wins / trades.length).toFixed(1),
    medianNetR: +sortedR[Math.floor(sortedR.length / 2)].toFixed(4),
    top5SharePct: +(100 * byBest.slice(0, 5).reduce((s, t) => s + t.netR, 0) / totalR).toFixed(1),
    distinctDays: days.size,
    clusteringFactor: +(trades.length / days.size).toFixed(2),
  };
  return out;
}

function main() {
  const r = report();
  const row = (label, s) => `${label.padEnd(26)} ${String(s.trades).padStart(4)} trades  mean ${String(s.meanR).padStart(8)}R  $${String(s.finalBalance).padStart(8)}  DD ${s.maxDrawdownPct}%`;
  console.log(row("all trades", r.all));
  console.log("\n-- leave one pair out, worst 5 --");
  for (const x of r.leaveOnePairOut.slice(0, 5)) console.log(row(`without ${x.without}`, x));
  console.log("\n-- trim the top winners --");
  for (const x of r.trimTopWinners) console.log(row(`drop top ${x.dropped}`, x));
  console.log("\n-- per year, standalone --");
  for (const x of r.perYear) console.log(row(String(x.year), x));
  console.log("\n" + row(`${r.fullHistoryPairsOnly.pairs} full-history pairs`, r.fullHistoryPairsOnly));
  console.log("\nshape:", JSON.stringify(r.shape));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
