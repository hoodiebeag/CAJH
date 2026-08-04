/**
 * Broad but bounded search across every entry engine and exit/stop primitive currently
 * implemented by backtest.js. Selection uses train only; holdout is never ranked on.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";

const modes = ["anticipate", "bos", "support", "ma_dip", "rsi", "rev", "breakout", "trend_pullback", "sweep_reclaim", "range_sweep_reclaim"];
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const normalize = (xs) => xs.map((x) => typeof x === "string" ? { symbol: x, id: symbolToKrakenId(x) } : x);
const seriesFor = (id) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(id, mins) }));
const split = (series, fraction, holdout) => {
  const cut = +series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time;
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
};
function configurations() {
  const out = [];
  for (const entryMode of modes) for (const tpR of [2, 3, 4, 5]) for (const lockBreakeven of [false, true]) for (const trailR of [null, 1]) {
    const trendMode = entryMode === "bos";
    const minStopPct = ["anticipate", "bos", "breakout", "trend_pullback", "sweep_reclaim", "range_sweep_reclaim"].includes(entryMode) ? .01 : 0;
    out.push({ entryMode, entryTf: "1h", tpR, lockBreakeven, trailR, trailStartR: 1,
      trendGate: trendMode, trendGateMode: "ma", alignMode: entryMode === "bos" ? "all" : "none",
      minStopPct, maxStopPct: .06, stopMode: "structural" });
  }
  return out;
}
function score(data, config, part) {
  const rows = data.map((d) => backtestMultiTF({ series: d[part] }, config));
  const results = rows.flatMap((r) => r.results), perAsset = rows.filter((r) => r.trades);
  const avgR = mean(results);
  return { trades: results.length, avgR, totalR: results.reduce((a, b) => a + b, 0), positiveAssets: perAsset.filter((r) => r.avgR > 0).length, assets: perAsset.length };
}

export function runStrategySearch({ watchlist = loadWatchlist(), splitFraction = .70, reportTop = 12 } = {}) {
  const data = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: split(d.series, splitFraction, false), holdout: split(d.series, splitFraction, true) }));
  const ranked = configurations().map((config) => ({ config, train: score(data, config, "train") }))
    .filter((row) => row.train.trades >= 100)
    .sort((a, b) => b.train.avgR - a.train.avgR);
  const finalists = ranked.slice(0, reportTop).map((row) => ({ ...row, holdout: score(data, row.config, "holdout") }))
    .map((row) => ({ ...row, promoted: row.train.avgR > 0 && row.holdout.avgR > 0 && row.holdout.positiveAssets / Math.max(1, row.holdout.assets) >= .5 }));
  const input = { specification: "strategy-search/v1", splitFraction, assets: data.map((d) => d.symbol), candidateCount: ranked.length, selection: "top train avgR only" };
  const result = { finalists, verdict: finalists.some((r) => r.promoted) ? "paper-trading candidates exist; no live promotion" : "no train-selected candidate survives the holdout gate" };
  return { input, result };
}

if (process.argv[1]?.endsWith("strategy-search.mjs")) {
  const report = runStrategySearch(); const saved = saveExperiment("strategy-search", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
