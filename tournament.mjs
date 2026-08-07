/** Research-only tournament over the entry engines already implemented in backtest.js. */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";

const families = [
  ["anticipate", "swing anticipation", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["bos", "confirmed swing", { entryMode: "bos", trendGate: true, trendGateMode: "ma", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["support", "support bounce", { entryMode: "support", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["ma_dip", "MA dip", { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rsi", "RSI reversal", { entryMode: "rsi", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rev", "higher-low reversal", { entryMode: "rev", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["breakout", "20-bar breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["trend_pullback", "trend pullback", { entryMode: "trend_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["sweep_reclaim", "liquidity sweep reclaim", { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["range_sweep_reclaim", "range support sweep reclaim", { entryMode: "range_sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["h3", "H3 hypothesis", { entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["vol_contraction", "volatility contraction breakout", { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function seriesFor(pair) { return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) })); }
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function summarize(perAsset) {
  const results = perAsset.flatMap((x) => x.results || []), assets = perAsset.filter((x) => x.trades > 0), avgR = average(results);
  return { trades: results.length, avgR, totalR: results.reduce((a, b) => a + b, 0), winRate: results.length ? results.filter((x) => x > 0).length / results.length : 0, assets: assets.length, positiveAssets: assets.filter((x) => x.avgR > 0).length };
}

/** Chronological 70/30 test. Parameters are fixed before examining the holdout. */
export function runTournament({ watchlist = loadWatchlist(), split = .70, feeRate, slipPct } = {}) {
  const costOverride = {};
  if (feeRate !== undefined) costOverride.feeRate = feeRate;
  if (slipPct !== undefined) costOverride.slipPct = slipPct;
  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const rows = families.map(([id, label, config]) => {
    const score = (part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, ...costOverride, entryTf: "1h" })));
    const train = score("train"), holdout = score("holdout");
    const promoted = train.trades >= 50 && holdout.trades >= 25 && train.avgR > 0 && holdout.avgR > 0 && holdout.positiveAssets / Math.max(1, holdout.assets) >= .5;
    return { id, label, config, train, holdout, promoted, robustness: Math.min(train.avgR, holdout.avgR) * Math.log1p(holdout.trades) };
  }).sort((a, b) => b.robustness - a.robustness);
  const input = { specification: "strategy-tournament/v1", split, assets: datasets.map((d) => d.symbol), candidates: families.map(([id]) => id) };
  const result = { rows, verdict: rows.some((r) => r.promoted) ? "paper-trading candidates exist; no live promotion" : "no candidate cleared the pre-registered research gate" };
  return { input, result };
}

if (process.argv[1]?.endsWith("tournament.mjs")) {
  const zeroCost = process.argv.includes("--zero-cost");
  const report = zeroCost ? runTournament({ feeRate: 0, slipPct: 0 }) : runTournament();
  const saved = saveExperiment(zeroCost ? "tournament-zero-cost" : "tournament", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
