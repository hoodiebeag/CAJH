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
import { availablePairs } from "./bundle-loader.mjs";
import { buildEntryGate, sharpeRankTable, atr } from "./filters.mjs";
import { simulateEquity } from "./equity.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";
import { pathToFileURL } from "url";

export const LEADER = {
  entryMode: "breakout", alignMode: "none", trendGate: true, trendGateMode: "ma", trendMa: 200,
  minStopPct: 0.03, maxStopPct: 0.20, tpR: 100, maxHold: 100,
  lockBreakeven: true, beTriggerR: 2.5, beLockR: 0.2,
  filters: { crossSection: { lookback: 120, topN: 20 }, atrPctBand: { period: 14, min: 0.03, max: 1 } },
  // Size inversely to each instrument's own volatility rather than flat. This is the one change in
  // the campaign with no threshold to fit: at matched deployed risk the result is flat across
  // volTarget 0.03 to 0.10 with any clamp of 3 or more, because once the clamp is loose the weights
  // are simply proportional to 1/ATR% and the level cancels. A plateau, not a peak.
  volTarget: 0.05, volClamp: 3,
};

/** Every trade a configuration takes, with the geometry the robustness checks slice on. */
export function collect(config, { minutes = 1440, from = SPLIT.trainStart, to = SPLIT.trainEnd } = {}) {
  const series = {};
  for (const pair of availablePairs(minutes)) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length >= 120) series[pair] = candles;
  }
  const btcCandles = config.filters?.btcRegime ? series.XBTUSD ?? null : null;
  const sharpeRanks = config.filters?.crossSection
    ? sharpeRankTable(series, { lookback: config.filters.crossSection.lookback ?? 60 })
    : null;

  const trades = [];
  for (const [pair, candles] of Object.entries(series)) {
    const entryGate = config.filters
      ? buildEntryGate(config.filters, { candles, entryMins: minutes, btcCandles, sharpeRanks, pair })
      : null;
    const r = backtestMultiTF({ series: [{ label: String(minutes), mins: minutes, candles }] },
      { ...config, entryGate, entryTf: String(minutes), feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT });
    const a = atr(candles, config.atrPeriod ?? 14);
    const atrByTime = new Map();
    for (let i = 0; i < candles.length; i++) {
      const px = Number(candles[i].close);
      if (a[i] !== null && px > 0) atrByTime.set(Number(candles[i].time), a[i] / px);
    }
    for (const x of r.excursions) {
      if (!Number.isFinite(x.entryTime)) continue;
      trades.push({ symbol: pair, netR: x.r, entryTime: x.entryTime * 1000, stopPct: x.risk / x.entry,
        barsHeld: x.barsHeld, atrPct: atrByTime.get(x.entryTime) });
    }
  }
  return { trades, series };
}

export function summarise(trades, { riskPct = 0.005, startingBalance = 1000, volTarget = null, volClamp = 3 } = {}) {
  if (!trades.length) return { trades: 0, meanR: null, finalBalance: startingBalance, maxDrawdownPct: 0 };
  const eq = simulateEquity(trades, { riskPct, startingBalance, volTarget, volClamp });
  return {
    trades: trades.length,
    meanR: +(trades.reduce((s, t) => s + t.netR, 0) / trades.length).toFixed(4),
    finalBalance: +eq.finalBalance.toFixed(2),
    maxDrawdownPct: +eq.maxDrawdownPct.toFixed(2),
  };
}

export function report(config = LEADER, opts = {}) {
  const { trades, series } = collect(config, opts);
  opts = { volTarget: config.volTarget ?? null, volClamp: config.volClamp ?? 3, ...opts };
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
