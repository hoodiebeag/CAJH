/**
 * CRYPTO-EFFECTIVE-SAMPLE-AUDIT (additive, read-only research, cache-only — no egress).
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * WHY THIS EXISTS: the work_queue item motivating this script asserted that "every crypto
 * interval in this project was produced by blockBootstrapCI (momentum.mjs:64), which resamples
 * contiguous blocks BY POSITION in the flat trade array with blockSize 4 and no timestamp
 * awareness at all" — the same defect DATE-CLUSTERED-RESAMPLING-AUDIT found and corrected for
 * pooled multi-symbol equities trades. Before reproducing that fix for crypto, this item first
 * verified the premise by reading every blockBootstrapCI call site in the codebase that touches
 * crypto data (`grep -n "blockBootstrapCI(" **\/*.mjs`, all 19 call sites catalogued below).
 *
 * FINDING THAT CHANGES THE SCOPE: the premise is not accurate as a blanket claim about crypto.
 * Every crypto call site falls into one of three categories structurally immune to the
 * equities-specific defect (which requires: multiple symbols, pooled in symbol-then-trade array
 * order, with no time-based correction before block-bootstrapping):
 *   (a) single-symbol continuous-exposure series — GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL,
 *       ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL, MACRO-REGIME-PRIMARY-SIGNAL(-EQUITIES splitfrac
 *       diagnostic), WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC,
 *       STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC, GDELT-WIDER-HYSTERESIS-BAND-
 *       DIAGNOSTIC: all call `blockBootstrapCI(holdoutScore.stratReturnsForCI, {blockSize:20})`
 *       on ONE symbol's (XBTUSD) own chronologically-ordered return series — array position IS
 *       time order for a single time series, so there is no symbol to scatter across positions.
 *   (b) pre-aggregated to one value per date/date-panel BEFORE bootstrapping — momentum.mjs:181
 *       (the shared IC-significance machinery behind Momentum M7, Low-vol B4, MOMENTUM-SHORT-
 *       HORIZON-RECHECK, CROSS-SECTIONAL-NONPRICE-RANK: `values` there is one cross-sectional IC
 *       per date-panel, and the reported p-value comes from `dateVectorPermutationP`, a
 *       genuinely date-aware permutation test, not from blockBootstrapCI at all) and
 *       phase3-b5-reversal-rerun.mjs:83 (B5-REVERSAL PHASE3's `holdout.topN[n].perDateNet` — one
 *       net-return value per calendar date across the whole universe, already collapsed before
 *       the block bootstrap runs).
 *   (c) explicitly time-sorted before bootstrapping, and load-bearing nowhere — c0-signal-
 *       combination.mjs:301 sorts the selected subset by trade time (`selectedByTime`) before
 *       calling blockBootstrapCI, and its own comment marks this "due-diligence-only, not part
 *       of the pre-registered gate"; the study's real significance test is a permutation test
 *       (p=0.4708, KILLED) that doesn't touch blockBootstrapCI at all.
 * Two more closed crypto formal-NHST entries (Classifier P5, CLASSIFIER-FUNDING-FEATURE) use
 * NEITHER blockBootstrapCI NOR any trade-R pooling — `classifier.mjs` has no blockBootstrapCI
 * call; their p-values (0.0198, 0.0099) come from `mannWhitneyAuc`, a rank-based classification
 * test on labels, a different statistical object entirely. LOG-REGRESSION-BANDS-CRYPTO similarly
 * does not use blockBootstrapCI — its p=0.0002 is a per-asset (n=24) comparison, not a pooled
 * trade-R bootstrap.
 *
 * REVISED SCOPE: no CLOSED crypto formal-NHST population in this project actually has the
 * equities-shaped defect (multi-symbol trades pooled in scattered array-position order and fed
 * to a fixed-width positional block bootstrap with no time correction). The one population that
 * DOES pool multiple symbols' discrete trades without any time-based correction is
 * VOL-CONTRACTION-SAMPLE-EXTENSION's AXIS C (256 trades, 15m entry, holdout-only) — required by
 * this item's own task text regardless, because a gate clearance rests on it. Read closely, AXIS
 * C's recorded CI [0.0620, 0.4427] does NOT actually come from blockBootstrapCI either — it comes
 * from `stat()` (researchlib.mjs), a normal-approximation CI (mean ± 1.96·SE) with ZERO
 * serial-correlation adjustment, computed on `perSymbol.flatMap(x => x.results)` (all of one
 * symbol's trades, then all of the next symbol's, etc. — concatenation order, not time order).
 * The work_queue item's description of this interval as coming "from this same position-blocked
 * machinery" is corrected here: it is a DIFFERENT and, if anything, LESS clustering-aware method
 * than blockBootstrapCI (no resampling at all, just a single closed-form normal interval). This
 * makes AXIS C the one genuinely open question this item answers with new computation; every
 * other family above is answered by code-construction review (cited above), not a rerun, because
 * re-running an already-immune population would not change any conclusion.
 *
 * METHOD FOR AXIS C: reuses DATE-CLUSTERED-RESAMPLING-AUDIT's date-block-bootstrap mechanic
 * unchanged (draw whole time-buckets with replacement until reaching the original trade count,
 * truncate, record the mean; 5000 iterations, 2.5/97.5 percentile 95% CI), applied at TWO
 * granularities since AXIS C's bars are 15m (not daily like the equities studies): per distinct
 * 15m bar timestamp (the appropriate unit for this bar interval — multiple symbols entering on
 * the exact same 15m bar is the crypto analog of equities' "same calendar day, market-wide
 * move") and per distinct calendar day (reported alongside for comparability with the equities
 * figures, as this item's done_when requires). The bar-timestamp bucketing is primary because a
 * full calendar day is ~96 15m bars — far coarser than the actual decision granularity here.
 * Exit time is read from the same symbol's 15m holdout candle array at
 * (entryIndex + barsHeld), matching DATE-CLUSTERED-RESAMPLING-AUDIT's convention, for the
 * mean-simultaneously-open-positions statistic. `blockBootstrapCI` (momentum.mjs) is NOT
 * modified — this script adds its own bucketed variant, used only here.
 * Replication check before trusting anything new: reproduce AXIS C's recorded 256 trades and
 * avgR bit-for-bit off the same cached candles, and reproduce its recorded normal-approx CI via
 * the same `stat()`-equivalent formula, before computing anything new.
 * Seed: 20260901 (bar-bucket), 20260902 (day-bucket) — fresh dated seeds, this project's
 * DATE_BOOTSTRAP_SEED_BASE=20260829 numbering (+1/+2/+3 already used by DATE-CLUSTERED-
 * RESAMPLING-AUDIT and DATE-CLUSTERED-RESAMPLING-DJTA20) not reused.
 * Decision rule: report whether AXIS C's lower bound (+0.0620 recorded) still excludes zero
 * under both the position-blocked (blockBootstrapCI, for a complete three-way comparison) and
 * the bucketed-clustered intervals. No BH-FDR recomputation (AXIS C is an economic-gate-only
 * item, not part of the formal-NHST family) and no new promotion decision — this item only
 * reports whether the interval's validity holds up.
 * ================================================================================================
 */
import { loadWatchlist, symbolToKrakenId } from "../../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../../researchlab.mjs";
import { backtestMultiTF } from "../../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";

const SPLIT = 0.70;
const ITERATIONS = 5000;
const BAR_BUCKET_SEED = 20260901;
const DAY_BUCKET_SEED = 20260902;
// Verbatim copy of tournament.mjs's vol_contraction row / VOL-CONTRACTION-SAMPLE-EXTENSION's own config — not touched by this item.
const VOL_CONTRACTION_CONFIG = { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };
const TF_LOWER = [["15m", 15], ["1h", 60], ["4h", 240], ["1d", 1440]];

// VOL-CONTRACTION-SAMPLE-EXTENSION's recorded AXIS C figures, for the replication check.
const RECORDED = { trades: 256, ci: [0.0620, 0.4427] };

// Immunity audit for every other closed crypto formal-NHST population, per the header's code
// review — desk-audited via call-site inspection, not rerun (see header for full reasoning).
const IMMUNITY_AUDIT = [
  { family: "LOG-REGRESSION-BANDS-CRYPTO", p: 0.0002, reason: "does not use blockBootstrapCI at all — per-asset (n=24) buy-and-hold comparison, a different statistical object" },
  { family: "Classifier P5", p: 0.0198, reason: "does not use blockBootstrapCI — classifier.mjs has no such call; p-value is mannWhitneyAuc (rank-based classification test on labels)" },
  { family: "CLASSIFIER-FUNDING-FEATURE", p: 0.0099, reason: "same as Classifier P5 — mannWhitneyAuc, not trade-R pooling" },
  { family: "Momentum M7 / Low-vol B4 / MOMENTUM-SHORT-HORIZON-RECHECK / CROSS-SECTIONAL-NONPRICE-RANK", p: "0.0579-0.9990 (see MULTIPLE_COMPARISONS_AUDIT.md rank 7/11/13/15/17/9)", reason: "momentum.mjs:181 blockBootstrapCI runs on `values` = one cross-sectional IC per date-panel, already pre-aggregated before bootstrapping; the reported p comes from dateVectorPermutationP, a date-aware permutation test, not from blockBootstrapCI" },
  { family: "B5-REVERSAL L=3/L=5 (train) + PHASE3 rerun", p: "0.0010 / 0.4226", reason: "phase3-b5-reversal-rerun.mjs:83 blockBootstrapCI runs on `holdout.topN[n].perDateNet` — one net-return value per calendar date across the whole universe, already collapsed before bootstrapping" },
  { family: "C0-SIGNAL-COMBINATION", p: 0.4708, reason: "real significance test is a permutation test unrelated to blockBootstrapCI; its blockBootstrapCI call is explicitly 'due-diligence-only, not part of the pre-registered gate' and sorts the subset by trade time (selectedByTime) before bootstrapping — already time-corrected, and not load-bearing (KILLED)" },
  { family: "GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL / ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL / MACRO-REGIME-PRIMARY-SIGNAL family / WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC / STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC / GDELT-WIDER-HYSTERESIS-BAND-DIAGNOSTIC", p: "0.7113-0.9990 (see MULTIPLE_COMPARISONS_AUDIT.md rank 18-20/22, plus non-NHST diagnostics)", reason: "single-symbol (XBTUSD) continuous-exposure return series — blockBootstrapCI(stratReturnsForCI, {blockSize:20}) resamples one chronologically-ordered series; array position already equals time order, no multi-symbol scatter possible" },
];

function buildSeries(pair, tfList) {
  return tfList.map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= cut) }));
}
function datasetsFor(watchlist, tfList) {
  return watchlist.map((symbol) => {
    const id = symbolToKrakenId(symbol);
    const series = buildSeries(id, tfList);
    if (series.some((tf) => tf.candles.length < 250)) return null;
    return { symbol, series };
  }).filter(Boolean);
}

// Matches DATE-CLUSTERED-RESAMPLING-AUDIT's own dateOf convention (UTC calendar date of a unix-seconds timestamp).
const dateOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// Local seeded RNG, mirroring momentum.mjs's internal seeded() LCG convention and DATE-CLUSTERED-RESAMPLING-AUDIT's own duplication of it.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Bucketed block bootstrap: draws whole buckets (keyed by bucketKeyFn — bar timestamp or
// calendar date) with replacement until reaching the original trade count, truncates, records
// the mean. Same fill-then-truncate mechanic as DATE-CLUSTERED-RESAMPLING-AUDIT's
// dateBlockBootstrapCI, generalized to an arbitrary bucket key.
function bucketedBlockBootstrapCI(dated, bucketKeyFn, { iterations = ITERATIONS, seed } = {}) {
  const buckets = new Map();
  for (const t of dated) {
    const key = bucketKeyFn(t);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t.r);
  }
  const groups = [...buckets.values()];
  const n = dated.length;
  const random = seeded(seed);
  const samples = [];
  for (let iter = 0; iter < iterations; iter++) {
    const sample = [];
    while (sample.length < n) sample.push(...groups[Math.floor(random() * groups.length)]);
    const truncated = sample.slice(0, n);
    samples.push(truncated.reduce((a, b) => a + b, 0) / truncated.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * .025)], samples[Math.floor(iterations * .975)]];
}

function main() {
  const watchlist = loadWatchlist();
  const datasets = datasetsFor(watchlist, TF_LOWER);

  const dated = [];
  const perSymbolTrades = [];
  for (const d of datasets) {
    const sliced = splitSeries(d.series, SPLIT);
    const r = backtestMultiTF({ series: sliced }, { ...VOL_CONTRACTION_CONFIG, feeRate: 0, slipPct: 0, entryTf: "15m" });
    const entryCandles = sliced.find((tf) => tf.label === "15m").candles;
    const timeToIdx = new Map(entryCandles.map((c, i) => [+c.time, i]));
    let symTrades = 0;
    for (const x of r.excursions) {
      const entryIdx = timeToIdx.get(x.entryTime);
      const exitIdx = entryIdx == null ? null : Math.min(entryIdx + x.barsHeld, entryCandles.length - 1);
      const exitTime = exitIdx == null ? x.entryTime : +entryCandles[exitIdx].time;
      dated.push({ symbol: d.symbol, r: x.r, entryTime: x.entryTime, barTs: x.entryTime, date: dateOf(x.entryTime), exitTime });
      symTrades++;
    }
    perSymbolTrades.push({ symbol: d.symbol, trades: symTrades });
  }

  const n = dated.length;
  const avgR = n ? dated.reduce((a, t) => a + t.r, 0) / n : 0;
  const pooledR = dated.map((t) => t.r);

  // --- Replication check ---
  const sd = n > 1 ? Math.sqrt(pooledR.reduce((a, b) => a + (b - avgR) ** 2, 0) / (n - 1)) : 0;
  const se = n ? sd / Math.sqrt(n) : 0;
  const reproducedNormalApproxCI = [avgR - 1.96 * se, avgR + 1.96 * se];
  const replication = {
    tradesMatch: n === RECORDED.trades,
    ciMatch: Math.abs(reproducedNormalApproxCI[0] - RECORDED.ci[0]) < 5e-4 &&
      Math.abs(reproducedNormalApproxCI[1] - RECORDED.ci[1]) < 5e-4,
  };

  // --- Clustering statistics: per distinct 15m bar timestamp AND per distinct calendar day ---
  const perBar = new Map();
  for (const t of dated) perBar.set(t.barTs, (perBar.get(t.barTs) || 0) + 1);
  const barCounts = [...perBar.values()];
  const distinctBars = perBar.size;
  const largestBarCluster = barCounts.length ? Math.max(...barCounts) : 0;
  const barHistogram = {};
  for (const c of barCounts) barHistogram[c] = (barHistogram[c] || 0) + 1;

  const perDay = new Map();
  for (const t of dated) perDay.set(t.date, (perDay.get(t.date) || 0) + 1);
  const dayCounts = [...perDay.values()];
  const distinctDays = perDay.size;
  const largestDayCluster = dayCounts.length ? Math.max(...dayCounts) : 0;

  const minEntry = Math.min(...dated.map((t) => t.entryTime));
  const maxExit = Math.max(...dated.map((t) => t.exitTime));
  let daySum = 0, dayCount = 0;
  for (let ts = minEntry; ts <= maxExit; ts += 86400) {
    let open = 0;
    for (const t of dated) if (t.entryTime <= ts && ts <= t.exitTime) open++;
    daySum += open; dayCount++;
  }
  const meanSimultaneousOpen = dayCount ? daySum / dayCount : 0;

  // --- Three-way CI comparison ---
  const positionBlockedCI = blockBootstrapCI(pooledR, { blockSize: 4, iterations: ITERATIONS });
  const barClusteredCI = bucketedBlockBootstrapCI(dated, (t) => t.barTs, { seed: BAR_BUCKET_SEED });
  const dayClusteredCI = bucketedBlockBootstrapCI(dated, (t) => t.date, { seed: DAY_BUCKET_SEED });

  const lowerBoundSurvives = {
    recordedNormalApprox: RECORDED.ci[0] > 0,
    positionBlocked: positionBlockedCI[0] !== null && positionBlockedCI[0] > 0,
    barClustered: barClusteredCI[0] !== null && barClusteredCI[0] > 0,
    dayClustered: dayClusteredCI[0] !== null && dayClusteredCI[0] > 0,
  };

  const verdict = lowerBoundSurvives.barClustered
    ? `AXIS C's +0.0620 lower bound SURVIVES clustering correction: the bar-timestamp-clustered 95% CI is [${barClusteredCI[0].toFixed(4)}, ${barClusteredCI[1].toFixed(4)}] (day-clustered [${dayClusteredCI[0].toFixed(4)}, ${dayClusteredCI[1].toFixed(4)}]), still entirely above zero. The equities date-clustering finding does NOT generalise to this crypto population — but note AXIS C's recorded interval was never a position-blocked bootstrap to begin with (it is stat()'s normal-approx CI); this item's own newly-computed position-blocked bootstrap ([${positionBlockedCI[0].toFixed(4)}, ${positionBlockedCI[1].toFixed(4)}]) is reported alongside for completeness, not as the thing being corrected.`
    : `AXIS C's +0.0620 lower bound DOES NOT survive clustering correction: the bar-timestamp-clustered 95% CI is [${barClusteredCI[0].toFixed(4)}, ${barClusteredCI[1].toFixed(4)}], which ${barClusteredCI[0] <= 0 ? "includes zero" : "is nonetheless still positive but narrower"}. The equities date-clustering finding DOES generalise to this crypto population and the gate-clearing AXIS C interval should not be trusted at face value.`;

  const oneLineVerdict = "The equities date-clustering defect does not generalise to crypto's closed formal-NHST family (every other crypto blockBootstrapCI call site is structurally immune — single-symbol series, pre-date-aggregated, or already time-sorted); the one genuinely exposed population, VOL-CONTRACTION AXIS C, " +
    (lowerBoundSurvives.barClustered ? "still excludes zero under bar- and day-clustered resampling, so its gate clearance holds up." : "no longer excludes zero under bar-clustered resampling, so its gate clearance should be treated as unreliable.");

  const report = {
    scopeNote: "See header for the full immunity audit; only AXIS C required new computation.",
    immunityAudit: IMMUNITY_AUDIT,
    axisC: {
      watchlistSize: watchlist.length, datasetsUsed: datasets.length, split: SPLIT, iterations: ITERATIONS,
      trades: n, avgR, recorded: RECORDED, replication, reproducedNormalApproxCI,
      perSymbolTrades,
      clustering: {
        perBarTimestamp: { distinctBars, effectiveN: distinctBars, effectiveOverNominalPct: n ? (distinctBars / n) * 100 : 0, largestBarCluster, barHistogram },
        perCalendarDay: { distinctDays, effectiveN: distinctDays, effectiveOverNominalPct: n ? (distinctDays / n) * 100 : 0, largestDayCluster },
        meanSimultaneousOpen,
      },
      positionBlockedCI, barClusteredCI, dayClusteredCI, barBucketSeed: BAR_BUCKET_SEED, dayBucketSeed: DAY_BUCKET_SEED,
      lowerBoundSurvives, verdict,
    },
    oneLineVerdict,
  };

  const saved = saveExperiment("crypto-effective-sample-audit", {
    specification: "crypto-effective-sample-audit/v1",
    split: SPLIT,
    watchlist: datasets.map((d) => d.symbol),
    config: VOL_CONTRACTION_CONFIG,
    iterations: ITERATIONS,
    barBucketSeed: BAR_BUCKET_SEED,
    dayBucketSeed: DAY_BUCKET_SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
