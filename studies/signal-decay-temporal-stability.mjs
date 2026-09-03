/**
 * SIGNAL-DECAY-TEMPORAL-STABILITY: descriptive diagnostic asking whether the pooled
 * `breakout`/`anticipate` baseline avgR figures quoted throughout this project's research
 * record (e.g. ROADMAP.md's holdout breakout avgR -0.864) are stationary across time, or
 * whether they hide a drift — mildly profitable early, sharply negative later (or vice
 * versa) — that a single pooled number can't reveal. Never checked before this item. Purely
 * descriptive: no gate, no VERDICTS.md row (this item's own task wording).
 *
 * Needs no new data source or account access — local candle history only, same as
 * seasonality-dayofweek-session.mjs.
 *
 * METHOD: for each asset, split its FULL local candle history (not a train/holdout split)
 * into `epochs` (default 5, task requires "at least 4") consecutive, equal-length,
 * non-overlapping chronological slices, computed once on the anchor 1h timeframe and applied
 * to every timeframe by candle .time boundary (mirrors researchlib.mjs's
 * walkForwardSeriesWindows, which does the same anchor-then-time-boundary trick for
 * expanding train/holdout folds; this does it for N disjoint fixed-size slices instead of
 * one growing train window). Each slice is then an entirely independent backtestMultiTF run
 * against its own bounded series — unlike seasonality-dayofweek-session.mjs, no per-trade
 * timestamp recovery is needed here, because epoch membership is a property of which slice
 * produced the trade, not a per-trade attribute recovered after a single continuous run.
 *
 * CAVEAT, stated rather than hidden: slicing at a fixed boundary can truncate a position that
 * would have run past that boundary in a continuous backtest (the same boundary artifact
 * every train/holdout split in this project already has — see backtestMultiTF's own
 * unresolved-position handling). This means "epoch N's trades" is not identical to "the
 * trades a continuous backtest would attribute to that calendar window" near each boundary.
 * That is accepted existing methodology here (tournament.mjs's splitSeries has the same
 * property), not a new problem introduced by this diagnostic.
 *
 * STATIONARITY TEST: one-way ANOVA F-statistic across epoch groups' per-trade R values, with
 * a permutation (not parametric-F-distribution) p-value — this project has never needed an
 * F-distribution CDF elsewhere and already has an established permutation-testing idiom
 * (momentum.mjs's permutationP: shuffle, recompute, count how often the shuffled statistic
 * is at least as extreme, (extreme+1)/(iterations+1)). Same idiom applied here to group
 * labels instead of panel pairs.
 */
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

// Exact baseline configs from tournament.mjs's `families` table, applied unmodified so
// results are comparable to every other anticipate/breakout study in this series (same
// duplication convention as seasonality-dayofweek-session.mjs's BASELINES, chosen there over
// importing tournament.mjs's unexported internal `families` array).
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** Splits a multi-TF series into `epochs` consecutive, non-overlapping, equal-length (by
 * index on the anchor 1h timeframe) chronological slices spanning the asset's full local
 * history. Every candle belongs to exactly one slice: boundaries are half-open
 * [start, end) except the final slice, whose end is +Infinity so it absorbs the tail. */
export function epochSlices(series, epochs) {
  if (!Number.isInteger(epochs) || epochs < 2) throw new Error("epochSlices: epochs must be an integer >= 2");
  const anchor = series[0].candles;
  const n = anchor.length;
  const boundaryTimes = Array.from({ length: epochs + 1 }, (_, i) => {
    if (i === epochs) return Infinity;
    const idx = Math.floor((n * i) / epochs);
    return idx < n ? Number(anchor[idx].time) : Infinity;
  });
  return Array.from({ length: epochs }, (_, i) => {
    const start = boundaryTimes[i], end = boundaryTimes[i + 1];
    return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= start && +c.time < end) }));
  });
}

function runOne(series, config) {
  return backtestMultiTF({ series }, { ...config, entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT });
}

// --- one-way ANOVA F-statistic + permutation p-value (self-contained; see module docstring
// for why a permutation p-value rather than a parametric F-distribution CDF) ---
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** groups: array of arrays of per-trade R values, one array per epoch. Empty epochs are
 * dropped from the comparison (an epoch with zero trades carries no information about
 * whether the mean differs) rather than treated as a zero-variance group of size zero. */
export function oneWayAnovaF(groups) {
  const nonEmpty = groups.filter((g) => g.length > 0);
  const all = nonEmpty.flat();
  const n = all.length;
  const grandMean = n ? all.reduce((a, b) => a + b, 0) / n : 0;
  let ssBetween = 0, ssWithin = 0;
  for (const g of nonEmpty) {
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    ssBetween += g.length * (m - grandMean) ** 2;
    for (const x of g) ssWithin += (x - m) ** 2;
  }
  const dfBetween = nonEmpty.length - 1, dfWithin = n - nonEmpty.length;
  if (dfBetween <= 0 || dfWithin <= 0) return { F: null, dfBetween, dfWithin };
  const msBetween = ssBetween / dfBetween, msWithin = ssWithin / dfWithin;
  const F = msWithin > 0 ? msBetween / msWithin : (msBetween > 0 ? Infinity : 0);
  return { F, dfBetween, dfWithin };
}

/** Label-permutation p-value for the one-way ANOVA F above: shuffles the pooled R values and
 * re-splits them into groups of the SAME sizes as the observed groups (preserving each
 * epoch's trade count, only breaking the R-value/epoch association), iterations times.
 * p = (permutations at least as extreme as observed + 1) / (iterations + 1) — the same
 * add-one convention momentum.mjs's permutationP uses. */
export function permutationAnovaP(groups, iterations = 1000, seed = 20260819) {
  const { F: observed } = oneWayAnovaF(groups);
  if (observed == null) return null;
  const sizes = groups.map((g) => g.length);
  const pooled = groups.flat();
  const random = seeded(seed);
  let extreme = 0;
  for (let it = 0; it < iterations; it++) {
    const shuffled = pooled.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let idx = 0;
    const permGroups = sizes.map((sz) => shuffled.slice(idx, idx += sz));
    const { F } = oneWayAnovaF(permGroups);
    if (F !== null && F >= observed) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

export async function runSignalDecayTemporalStability({
  watchlist = loadWatchlist(), epochs = 5, minCandles = 250, permutations = 1000, seed = 20260819,
} = {}) {
  const coverage = [];
  const eligible = [];
  for (const asset of normalize(watchlist)) {
    const s = seriesFor(asset.id);
    if (!s.every((tf) => tf.candles.length >= minCandles)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
    eligible.push({ symbol: asset.symbol, id: asset.id, s });
    coverage.push({ symbol: asset.symbol, included: true });
  }

  const baseInput = { specification: "signal-decay-temporal-stability/v1", epochs, minCandles, permutations, seed, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "SIGNAL-DECAY-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const groups = Array.from({ length: epochs }, () => []);        // per-epoch pooled R values
    const perAsset = [];
    let overallTrades = 0, overallTotalR = 0;

    for (const d of eligible) {
      const slices = epochSlices(d.s, epochs);
      const assetEpochs = slices.map((slice, ei) => {
        const r = runOne(slice, BASELINES[target]);
        groups[ei].push(...r.results);
        overallTrades += r.trades; overallTotalR += r.totalR;
        return { epoch: ei + 1, trades: r.trades, avgR: r.avgR };
      });
      perAsset.push({ symbol: d.symbol, epochs: assetEpochs });
    }

    const epochSummaries = groups.map((g, i) => {
      const trades = g.length, totalR = g.reduce((a, b) => a + b, 0);
      const mean = trades ? totalR / trades : 0;
      const sd = trades > 1 ? Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / (trades - 1)) : 0;
      const se = trades ? sd / Math.sqrt(trades) : 0;
      return { epoch: i + 1, trades, totalR: +totalR.toFixed(6), avgR: mean, ci95: [mean - 1.96 * se, mean + 1.96 * se] };
    });

    const { F, dfBetween, dfWithin } = oneWayAnovaF(groups);
    const p = F == null ? null : permutationAnovaP(groups, permutations, seed);

    families[target] = {
      overall: { trades: overallTrades, totalR: +overallTotalR.toFixed(6), avgR: overallTrades ? overallTotalR / overallTrades : 0 },
      epochs: epochSummaries,
      perAsset,
      anova: { F, dfBetween, dfWithin, permutations, p },
      stationarityCall: F == null
        ? "INSUFFICIENT-DATA (fewer than two non-empty epochs)"
        : p < 0.05
        ? "NON-STATIONARY (epoch means differ more than permutation sampling noise would explain, p<0.05)"
        : "NO SIGNIFICANT NON-STATIONARITY DETECTED (permutation p>=0.05 — cannot reject that the baseline is stable across epochs on this data)",
    };
  }

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: "SIGNAL-DECAY-TEMPORAL-STABILITY: descriptive stationarity diagnostic only, no pre-registered gate (this item's own done_when) — a NON-STATIONARY call is a methodological finding about how to interpret prior pooled-avgR verdicts, not itself a promotable result.",
    },
  };
}

if (process.argv[1]?.endsWith("signal-decay-temporal-stability.mjs")) {
  const report = await runSignalDecayTemporalStability();
  const saved = saveExperiment("signal-decay-temporal-stability", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
