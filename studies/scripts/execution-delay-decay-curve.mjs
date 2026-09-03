/**
 * EXECUTION-DELAY-DECAY-CURVE diagnostic (throwaway, read-only). Not part of the app —
 * re-runs the breakout/anticipate holdout baselines with entry fill delayed by 0, 1, 2, 3
 * and 5 bars, using backtest.js's new `entryDelayBars` parameter (backtest.js's
 * backtestMultiTF). Every prior backtest here has assumed the signal bar fills the trade
 * immediately; this asks whether that assumption itself is where the loss comes from.
 *
 * Mechanics (see backtest.js's entryDelayBars doc comment for the exact rule): the stop
 * stays at the structural level fixed at signal time; entry becomes the OPEN of bar
 * k+entryDelayBars; risk/tp are recomputed off that delayed entry. If the delay runs past
 * the end of the series, or price has already closed the risk to zero or below by fill
 * time, the trade is skipped (not forced) and tallied under reasons.delaySkipped.
 *
 * Known modeling simplification, stated rather than hidden: minStopPct/maxStopPct/alignment/
 * trend-gate checks are evaluated at SIGNAL time (bar k), using the immediate-fill entry/
 * risk — they are not re-validated against the delayed risk. A trade that would have been
 * rejected on stop-size grounds at the delayed price is not caught by this diagnostic. This
 * doesn't affect the R/trade averages this study reports (the trade IS what it is, once
 * taken), but it means "trades" isn't necessarily what a live delayed-fill system would
 * have opened under its own risk bounds. Noted, not corrected — correcting it would touch
 * backtest.js's gating logic itself, not just its reporting.
 */
import { loadWatchlist, symbolToKrakenId } from "../../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../../researchlab.mjs";
import { backtestMultiTF } from "../../backtest.js";

const SPLIT = 0.70;
const DELAYS = [0, 1, 2, 3, 5];

// Exact family configs from tournament.mjs's `families` array (breakout, anticipate rows) —
// duplicated here rather than imported because tournament.mjs's `families` isn't exported;
// values copied verbatim, not re-derived (same convention as cost-component-attribution.mjs).
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

function seriesFor(pair) {
  return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

const watchlist = loadWatchlist();
const datasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const report = { split: SPLIT, assetsConsidered: datasets.length, delays: DELAYS, families: {} };

for (const [famId, config] of FAMILIES) {
  const curve = [];
  for (const entryDelayBars of DELAYS) {
    const perAsset = datasets.map((d) => {
      const r = backtestMultiTF({ series: d.holdout }, { ...config, entryTf: "1h", entryDelayBars });
      return { symbol: d.symbol, trades: r.trades, totalR: r.totalR, delaySkipped: r.reasons?.delaySkipped || 0 };
    });
    const trades = perAsset.reduce((a, x) => a + x.trades, 0);
    const totalR = perAsset.reduce((a, x) => a + x.totalR, 0);
    const delaySkipped = perAsset.reduce((a, x) => a + x.delaySkipped, 0);
    curve.push({ entryDelayBars, trades, avgR: trades ? totalR / trades : 0, totalR, delaySkipped });
  }

  const base = curve[0]; // entryDelayBars: 0
  const last = curve[curve.length - 1];
  const monotonicDegrade = curve.every((c, i) => i === 0 || c.avgR <= curve[i - 1].avgR + 1e-9);
  const monotonicImprove = curve.every((c, i) => i === 0 || c.avgR >= curve[i - 1].avgR - 1e-9);
  const avgRDeltaAt5 = last.avgR - base.avgR;
  let outcome;
  if (avgRDeltaAt5 < -0.05 || (monotonicDegrade && avgRDeltaAt5 < -0.02)) outcome = "SHARP_DEGRADATION";
  else if (avgRDeltaAt5 > 0.02 && monotonicImprove) outcome = "IMPROVEMENT";
  else outcome = "FLAT";

  report.families[famId] = {
    curve,
    outcome,
    avgRDeltaAt5,
    monotonicDegrade,
    monotonicImprove,
  };
}

const saved = saveExperiment("execution-delay-decay-curve", { specification: "execution-delay-decay-curve/v1", split: SPLIT, delays: DELAYS, watchlist: datasets.map((d) => d.symbol) }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
