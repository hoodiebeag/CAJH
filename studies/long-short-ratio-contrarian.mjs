/**
 * LONG-SHORT-RATIO-CONTRARIAN: gates `breakout` and `anticipate` (long, momentum) entries on
 * Kraken Futures crowd positioning — the long/short ratio across the futures trader base
 * (`derivatives.mjs`'s existing, tested `fetchAnalytics(type:'long-short-ratio')`, never wired
 * into a sealed-holdout study before this). Genuinely new information source, distinct in KIND
 * from every prior derivatives study: OPEN-INTEREST-TREND-CONFIRMATION and
 * FUTURES-BASIS-DIRECTIONAL-SIGNAL both measure the SIZE/PRICING of the futures market
 * (contract count, futures-vs-spot price); LIQUIDATION-CASCADE-REVERSAL measures forced-flow
 * events; this measures the CROWD'S OWN DIRECTIONAL LEAN (fraction of open positions that are
 * long) — a sentiment/positioning signal, not a size or pricing one.
 *
 * PRE-REGISTERED HYPOTHESIS (the task's own stated framing — a contrarian fade, not the
 * momentum/confirmation shape every prior gate study here has tested): when the crowd is
 * already heavily positioned long (an EXTREME reading, not "long" in general), most of the
 * buying that was going to happen already has — no fresh buying pressure left — so forward
 * returns on a freshly-opened long entry tend to be worse. Applied as a SUPPRESSION gate on
 * `breakout`/`anticipate` — the same two directional/momentum families every other gate study
 * here has used, so results stay directly comparable — that blocks new entries only while the
 * ratio sits in its own extreme-long zone, and allows them otherwise.
 *
 * GRANULARITY CHECK, run before writing any strategy logic (this item's own explicit
 * done_when requirement, since the task's framing raised aggregate-only as a real
 * possibility): `fetchAnalytics` takes a `symbol` parameter, and Kraken returns a genuinely
 * distinct daily series per futures contract — confirmed directly against the real API:
 * PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD each returned their own independent value on the
 * same day (0.60/0.77/0.81/0.76 on the most recent point), not a shared market-wide constant.
 * This study is therefore scoped PER-ASSET, matching every other gate study's own-history
 * convention (OI/basis compare a value to ITS OWN trailing average; this compares a value to
 * ITS OWN train-window percentile) rather than the aggregate-only fallback the task described.
 *
 * Data-availability check performed directly against the real API before writing this module:
 * `long-short-ratio` history reaches back to 2024-02-28 for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/
 * PF_XRPUSD alike (899 days — same depth and start date as every other derivatives source used
 * in this project, same underlying Kraken analytics endpoint family, no separate rolling-window
 * ceiling). Kraken's `long-short-ratio` value is a plain decimal string (e.g. `"0.71"`),
 * already the long-side FRACTION of open positions — cross-checked against the sibling
 * `long-short-info` type's `{longCount,shortCount,longPercent,shortPercent,ratio}` shape on the
 * same symbol/day: `ratio` there equals `longPercent/100` exactly — parsed as `Number(value)`,
 * no unwrapping needed, a distinct shape from every prior source (OI's OHLC array,
 * liquidation-volume's plain scalar count, basis's `{basis}` object).
 *
 * Extreme-long threshold: the 80th percentile of the asset's OWN long-short ratio values
 * within the TRAIN window only (fixed on train, never recomputed on holdout — no leakage), a
 * single pre-registered choice rather than a threshold grid — "heavily skewed long" read as
 * the top quintile of the asset's own observed history, the same "one clean choice, not a
 * sweep" convention OI-trend-gate/basis-directional-signal used for their own N=7 trailing
 * window. The gate blocks an entry only while the latest revealed ratio exceeds that fixed
 * train threshold, and allows entry otherwise (failing closed — blocking — until the first
 * point has revealed). Each daily point is revealed only after its own day closes (+1 day) —
 * this codebase's standard no-lookahead offset (see oi-trend-gate.mjs's oiPoints /
 * liquidation-cascade-reversal.mjs's liqPoints).
 *
 * Gate (per family, holdout only, this item's own pre-registered done_when's three-clause
 * shape — the standard shape used since the granularity check above confirmed real per-asset
 * resolution, so no separate aggregate/portfolio-level fallback gate was needed): holdout
 * avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40.
 */
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const DAY_SEC = 86400;
const EXTREME_PERCENTILE = 0.80;
// Exact baseline configs from tournament.mjs's `families` table, applied unmodified so
// results are comparable to every other anticipate/breakout verdict in VERDICTS.md.
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** Nearest-rank percentile of a plain numeric array (long-short ratio values are already a
 * bounded [0,1] fraction). */
function percentile(xs, p) {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/** Kraken's long-short-ratio analytics value is a plain decimal string — already the long-side
 * fraction of open positions. Each daily point only becomes visible once its own day has
 * closed (+1 day) — this codebase's standard no-lookahead offset (see oi-trend-gate.mjs's
 * oiPoints / liquidation-cascade-reversal.mjs's liqPoints). */
function ratioPoints(normalized) {
  const byTime = new Map();
  for (const p of normalized?.points || []) {
    const ratio = Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(ratio)) byTime.set(p.timestamp, { revealTime: p.timestamp + DAY_SEC, ratio });
  }
  return [...byTime.values()].sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "is the latest revealed ratio at/under its fixed train-only extreme
 * threshold" cursor — a fresh cursor per call (mirrors oi-trend-gate.mjs's makeOiRisingAt
 * convention: never share a cursor across two backtest runs). Fails closed (blocks entry)
 * until the first point has revealed; blocks entry whenever the crowd sits in its own
 * extreme-long zone (current > threshold), allows entry otherwise — the contrarian-fade
 * suppression this study tests. */
function makeNotExtremeLongAt(points, threshold) {
  let i = 0;
  let current = null;
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { current = points[i].ratio; i++; }
    if (current === null) return false;
    return current <= threshold;
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the ratio-covered window and compute the 70/30 chronological
 * cut timestamp within that window — same windowing technique oi-trend-gate.mjs's/
 * basis-directional-signal.mjs's windowedSplit use (needed because the ratio-covered window
 * can differ from the full candle history's span). The cut is returned (not immediately
 * applied) so the SAME cut also bounds the train-only ratio values used to fix this asset's
 * extreme-long threshold below — no leakage into holdout. */
function boundAndCut(series, startSec, endSec, fraction) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return { bounded, cut };
}
const splitAtCut = (bounded, cut, holdout) => bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));

export async function runLongShortRatioContrarian({
  watchlist = loadWatchlist(), splitFraction = .70, extremePercentile = EXTREME_PERCENTILE, minHistoryDays = 500,
  refresh = false, fetchRatio = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const raw = await fetchRatio({ symbol: toFuturesSymbol(asset.symbol), type: "long-short-ratio", since, to, interval: DAY_SEC, refresh });
      const points = ratioPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `ratio-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }

      const { bounded, cut } = boundAndCut(s, points[0].revealTime, points.at(-1).revealTime, splitFraction);
      const trainRatios = points.filter((p) => p.revealTime < cut).map((p) => p.ratio);
      if (!trainRatios.length) { coverage.push({ symbol: asset.symbol, included: false, reason: "no-train-ratio-points" }); continue; }
      const threshold = percentile(trainRatios, extremePercentile);

      eligible.push({ symbol: asset.symbol, id: asset.id, bounded, cut, points, threshold, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1), trainThreshold: +threshold.toFixed(4) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `ratio-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "long-short-ratio-contrarian/v1", primaryHypothesis: "crowded-long-ratio-suppresses-new-long-entries", splitFraction, extremePercentile, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "RATIO-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const run = (target, d, holdout) => {
    const part = splitAtCut(d.bounded, d.cut, holdout);
    const notExtremeAt = makeNotExtremeLongAt(d.points, d.threshold); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => notExtremeAt(tClose),
    });
  };

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const perAsset = eligible.map((d) => ({ symbol: d.symbol, train: run(target, d, false), holdout: run(target, d, true) }));
    const train = summarize(perAsset.map((p) => p.train));
    const holdout = summarize(perAsset.map((p) => p.holdout));
    const gate = {
      avgRMin: -0.30, tradesMin: 150, positiveFracMin: 0.40,
      avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 150,
      positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
    };
    gate.passed = gate.avgRPass && gate.tradesPass && gate.positiveFracPass;
    families[target] = {
      train, holdout, gate,
      perAsset: perAsset.map(({ symbol, train, holdout }) => ({ symbol, train: { trades: train.trades, avgR: train.avgR }, holdout: { trades: holdout.trades, avgR: holdout.avgR } })),
    };
  }

  const passed = Object.entries(families).filter(([, f]) => f.gate.passed).map(([id]) => id);
  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: passed.length
        ? `LONG-SHORT-RATIO-CONTRARIAN clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : "LONG-SHORT-RATIO-CONTRARIAN FAIL: no family clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("long-short-ratio-contrarian.mjs")) {
  const report = await runLongShortRatioContrarian();
  const saved = saveExperiment("long-short-ratio-contrarian", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
