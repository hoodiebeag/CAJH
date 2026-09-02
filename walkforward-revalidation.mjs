/**
 * WALKFORWARD-REVALIDATION-OF-BASELINE: descriptive diagnostic asking whether a rolling
 * walk-forward re-fit changes the picture for the `breakout`/`anticipate` baselines, or
 * whether the single chronological 70/30 split every prior verdict in this project relied on
 * is an adequate summary. Motivated directly by SIGNAL-DECAY-TEMPORAL-STABILITY (ROADMAP_ARCHIVE.md,
 * 2026-08-19), which found both baselines NON-STATIONARY across calendar time — a single
 * pooled split can't distinguish "no edge" from "regime changed under a fixed split." Purely
 * descriptive: no gate, no VERDICTS.md row, no existing verdict altered (this item's own task
 * wording).
 *
 * METHOD: researchlib.mjs's `walkForwardSeriesWindows` (built by JUDGE-WALKFORWARD-SYMBOL-
 * HOLDOUT and never invoked by any study before this one, per MULTIPLE_COMPARISONS_AUDIT.md
 * §1) over each asset's full local candle history, `folds=4` (task's stated minimum),
 * `trainFraction=0.5` (harness default: train grows from the first half, holdout runs in 4
 * successive slices across the remaining half). Each fold's holdout is scored with the exact
 * `breakout`/`anticipate` baseline configs from tournament.mjs's `families` table (unmodified,
 * `entryTf: "1h"`) — same duplication convention as signal-decay-temporal-stability.mjs's
 * BASELINES, chosen there over importing tournament.mjs's unexported internal `families`
 * array. No parameter is fit per-fold (these configs are fixed pre-registered hyperparameters,
 * not thresholds tuned on train) — "walk-forward" here means re-SCORING across successive
 * out-of-sample slices, not re-fitting.
 *
 * SEALED_SYMBOLS: excluded via researchlib.mjs's `splitSealedSymbols` — this is a methodology
 * measurement, not the final validation SEALED_SYMBOLS is reserved for (task note, explicit).
 *
 * CALENDAR HOLDOUT DISCLOSURE (AGENT_PROTOCOL.md "Rule for the calendar holdout"): this study
 * uses each asset's FULL local history, which necessarily re-examines the
 * 2025-06-01-present window already retired as "fresh" by ~27 prior studies — disclosed here
 * explicitly rather than silently, matching the rule's requirement. This is the same tradeoff
 * SIGNAL-DECAY-TEMPORAL-STABILITY already made (full-history epochs) for the same reason: the
 * question is about the baseline's behavior across its own available sample, not a fresh
 * holdout test.
 *
 * DISPERSION TEST: reuses signal-decay-temporal-stability.mjs's `oneWayAnovaF`/
 * `permutationAnovaP` (already independently tested there) applied to the 4 folds' pooled
 * per-trade R values instead of 5 epochs' — same purpose (is between-group variance larger
 * than within-group noise would explain), different partition of the same history. This
 * mirrors SIGNAL-DECAY-TEMPORAL-STABILITY's own precedent: a descriptive permutation p-value
 * that is NOT evaluated against a pre-registered alpha=0.05 gate (it does not appear in
 * MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family, which only counts p-values reported
 * against an actual pass/fail significance gate) and does not trigger that family counter.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols, walkForwardSeriesWindows } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";
import { oneWayAnovaF, permutationAnovaP } from "./signal-decay-temporal-stability.mjs";

// Exact baseline configs from tournament.mjs's `families` table, applied unmodified.
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
function runOne(series, config) { return backtestMultiTF({ series }, { ...config, entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT }); }

function summarizeGroup(rValues) {
  const trades = rValues.length, totalR = rValues.reduce((a, b) => a + b, 0);
  const avgR = trades ? totalR / trades : 0;
  const sd = trades > 1 ? Math.sqrt(rValues.reduce((a, b) => a + (b - avgR) ** 2, 0) / (trades - 1)) : 0;
  const se = trades ? sd / Math.sqrt(trades) : 0;
  return { trades, totalR: +totalR.toFixed(6), avgR, ci95: [avgR - 1.96 * se, avgR + 1.96 * se] };
}

/** The single chronological 70/30 split baseline every prior verdict in this series relied
 * on (tournament.mjs's own `split` default), scored over the SAME eligible asset pool as the
 * walk-forward folds so the two are directly comparable. */
function singleSplitBaseline(eligible, config, split = 0.70) {
  const rValues = [];
  for (const d of eligible) {
    const cutTime = Number(d.s[0].candles[Math.floor(d.s[0].candles.length * split)]?.time);
    const holdout = d.s.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= cutTime) }));
    const r = runOne(holdout, config);
    rValues.push(...r.results);
  }
  return summarizeGroup(rValues);
}

export async function runWalkforwardRevalidation({
  watchlist = loadWatchlist(), folds = 4, trainFraction = 0.5, minCandles = 250, permutations = 1000, seed = 20260822,
} = {}) {
  const { active } = splitSealedSymbols(normalize(watchlist));
  const coverage = [];
  const eligible = [];
  for (const asset of active) {
    const s = seriesFor(asset.id);
    if (!s.every((tf) => tf.candles.length >= minCandles)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
    eligible.push({ symbol: asset.symbol, id: asset.id, s });
    coverage.push({ symbol: asset.symbol, included: true });
  }

  const baseInput = {
    specification: "walkforward-revalidation-of-baseline/v1", folds, trainFraction, minCandles, permutations, seed,
    feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage,
    calendarHoldoutDisclosure: "uses full local candle history per asset, which re-examines the 2025-06-01-present window already retired as a fresh holdout by ~27 prior studies (AGENT_PROTOCOL.md calendar-holdout rule) — disclosed explicitly, not silently.",
  };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "WALKFORWARD-REVALIDATION-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const foldGroups = Array.from({ length: folds }, () => []); // per-fold pooled holdout R values
    const perAsset = [];

    for (const d of eligible) {
      const windows = walkForwardSeriesWindows(d.s, { folds, trainFraction });
      const assetFolds = windows.map((w, i) => {
        const r = runOne(w.holdout, BASELINES[target]);
        foldGroups[i].push(...r.results);
        return { fold: i + 1, trades: r.trades, avgR: r.avgR };
      });
      perAsset.push({ symbol: d.symbol, folds: assetFolds });
    }

    const foldSummaries = foldGroups.map((g, i) => ({ fold: i + 1, ...summarizeGroup(g) }));
    const single = singleSplitBaseline(eligible, BASELINES[target]);

    const { F, dfBetween, dfWithin } = oneWayAnovaF(foldGroups);
    const p = F == null ? null : permutationAnovaP(foldGroups, permutations, seed);

    const foldAvgRs = foldSummaries.filter((f) => f.trades > 0).map((f) => f.avgR);
    const dispersion = foldAvgRs.length ? Math.max(...foldAvgRs) - Math.min(...foldAvgRs) : 0;

    families[target] = {
      singleSplit: single,
      folds: foldSummaries,
      foldDispersion: +dispersion.toFixed(4),
      perAsset,
      anova: { F, dfBetween, dfWithin, permutations, p },
      dispersionCall: F == null
        ? "INSUFFICIENT-DATA (fewer than two non-empty folds)"
        : p < 0.05
        ? "SIGNIFICANT DISPERSION (fold avgR differs more than permutation sampling noise would explain, p<0.05) — the single split is not an adequate summary of this history"
        : "NO SIGNIFICANT DISPERSION DETECTED (permutation p>=0.05) — fold-to-fold variation is consistent with sampling noise around one underlying mean; the single split is not misleading on this measure",
    };
  }

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: "WALKFORWARD-REVALIDATION-OF-BASELINE: descriptive walk-forward re-scoring diagnostic only, no pre-registered gate (this item's own done_when) — measures whether a rolling re-fit changes the single-split picture; does not alter any existing verdict.",
    },
  };
}

if (process.argv[1]?.endsWith("walkforward-revalidation.mjs")) {
  const report = await runWalkforwardRevalidation();
  const saved = saveExperiment("walkforward-revalidation", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
