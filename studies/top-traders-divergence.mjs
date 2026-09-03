/**
 * TOP-TRADERS-DIVERGENCE: gates `breakout` and `anticipate` (long, momentum) entries on the
 * DIVERGENCE between Kraken Futures' top-traders cohort positioning and the broader aggregate
 * long-short-ratio — a genuinely different information source from LONG-SHORT-RATIO-CONTRARIAN
 * (which tested the aggregate ratio alone, against ITS OWN history, as a contrarian-fade
 * signal). This study tests whether informed/uninformed money DISAGREEING is itself predictive,
 * not whether either series is extreme relative to its own history.
 *
 * ENDPOINT DEFINITION, verified against Kraken's real API before writing any strategy code (this
 * item's own explicit done_when requirement — "verify its actual definition... don't infer from
 * the name alone"). Kraken's public docs (docs.kraken.com/api/docs/futures-api/charts/analytics)
 * define `top-traders` as: `{ top20Percent: { openInterest, longCount, shortCount, longPercent,
 * shortPercent, ratio } }` — the top 20% of accounts BY OPEN INTEREST (position size), not a
 * curated "smart money" cohort by any performance or sophistication measure. The hypothesis's
 * "larger/more sophisticated accounts" framing is only half-confirmed: it is genuinely a
 * distinct, larger-position cohort, but Kraken's own definition says nothing about
 * sophistication — that part of the hypothesis is untestable from this endpoint and is not
 * assumed true here, only the "distinct cohort" half.
 *
 * REAL BUG FOUND AND FIXED as part of this item's own data-availability check: `derivatives.mjs`'s
 * `normalizeAnalytics` did not handle the `top20Percent` wrapper at all — Kraken's real response
 * nests the parallel-array object one level deeper than every other analytics type this project
 * has used (OI, long-short-ratio, long-short-info, future-basis, liquidation-volume are all flat).
 * Before the fix, `normalizeAnalytics` silently produced `{}` for every top-traders point (no
 * error, no empty array — the length calculation still ran to `timestamp.length`, so the
 * corruption was invisible until the values were actually used). Fixed generically (unwrap a
 * single-key object wrapper, not hardcoded to the string `top20Percent`) with its own regression
 * test in `derivatives.test.mjs`, confirmed against the real API before use here.
 *
 * DIVERGENCE DEFINITION: `divergence = topTradersRatio - aggregateRatio` on the same day (both
 * are the long-side fraction of open positions/accounts, already directly comparable — no unit
 * conversion needed, cross-checked against the sibling `long-short-info` type the same way
 * LONG-SHORT-RATIO-CONTRARIAN validated the aggregate ratio's shape). Positive divergence means
 * the top-traders cohort is leaning MORE long than the broader crowd; negative means the crowd is
 * more long than the top traders. Real, non-degenerate on the checked window (PF_XBTUSD: top
 * traders read 0.49-0.55 against an aggregate reading 0.54-0.60 on the same 10 days — a real,
 * moving spread, not a constant offset).
 *
 * PRE-REGISTERED HYPOTHESIS (this item's own stated framing — "the top-trader side is more
 * predictive" when the two disagree): for a long-only strategy, that means requiring the
 * top-traders cohort to be leaning MORE bullish than the aggregate crowd — a CONFIRMATION gate
 * (require positive divergence to allow entry), the same shape OPEN-INTEREST-TREND-CONFIRMATION
 * and FUTURES-BASIS-DIRECTIONAL-SIGNAL used, and functionally the opposite of
 * LONG-SHORT-RATIO-CONTRARIAN's suppression-on-own-extreme shape — evaluated independently on its
 * own gate, per this item's own instruction not to let that item's result color this one.
 *
 * Divergence threshold: the 80th percentile of the asset's OWN divergence values within the TRAIN
 * window only (fixed on train, never recomputed on holdout — no leakage), the same "one clean
 * choice, not a threshold grid" convention every prior gate study in this series has used. The
 * gate requires the latest revealed divergence to be at/above that fixed train threshold to allow
 * entry (fails closed — blocks — until the first point has revealed).
 *
 * Data-availability check performed directly against the real API before writing this module:
 * both `top-traders` and `long-short-ratio` reach back to 2024-01-09 for PF_XBTUSD/PF_ETHUSD/
 * PF_SOLUSD/PF_XRPUSD alike (950-day window fully covered, longer than every other derivatives
 * study's checked depth), with IDENTICAL daily timestamps on both series (no alignment gaps to
 * bridge). Coverage is therefore gated on the SAME candle-history floor as every other derivatives
 * study (28/29 watchlist assets, EOS excluded on its pre-existing candle shortfall).
 *
 * Gate (per family, holdout only, this item's own pre-registered done_when's three-clause shape):
 * holdout avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40.
 */
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const DAY_SEC = 86400;
const CONFIRM_PERCENTILE = 0.80;
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

/** Nearest-rank percentile of a plain numeric array. */
function percentile(xs, p) {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/** Both `top-traders`' `ratio` field and `long-short-ratio`'s plain value are already the
 * long-side fraction of open positions/accounts — directly comparable, no conversion. Joins on
 * exact timestamp (confirmed identical daily anchors on the real API); a day missing from either
 * side is dropped rather than guessed. Each daily point only becomes visible once its own day has
 * closed (+1 day) — this codebase's standard no-lookahead offset (see oi-trend-gate.mjs's
 * oiPoints / long-short-ratio-contrarian.mjs's ratioPoints). */
function divergencePoints(topNormalized, aggNormalized) {
  const aggByTime = new Map();
  for (const p of aggNormalized?.points || []) {
    const ratio = Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(ratio)) aggByTime.set(p.timestamp, ratio);
  }
  const points = [];
  for (const p of topNormalized?.points || []) {
    const topRatio = Number(p.value?.ratio);
    const aggRatio = aggByTime.get(p.timestamp);
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(topRatio) || !Number.isFinite(aggRatio)) continue;
    points.push({ revealTime: p.timestamp + DAY_SEC, divergence: topRatio - aggRatio });
  }
  return points.sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "is the latest revealed divergence at/above its fixed train-only confirmation
 * threshold" cursor — a fresh cursor per call (mirrors oi-trend-gate.mjs's makeOiRisingAt
 * convention: never share a cursor across two backtest runs). Fails closed (blocks entry) until
 * the first point has revealed; allows entry only while top-traders lean sufficiently more
 * bullish than the aggregate crowd relative to this asset's own train-window history — the
 * confirmation this study tests. */
function makeConfirmedAt(points, threshold) {
  let i = 0;
  let current = null;
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { current = points[i].divergence; i++; }
    if (current === null) return false;
    return current >= threshold;
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the divergence-covered window and compute the 70/30
 * chronological cut timestamp within that window — same windowing technique
 * long-short-ratio-contrarian.mjs's boundAndCut/basis-directional-signal.mjs's windowedSplit use.
 * The cut is returned (not immediately applied) so the SAME cut also bounds the train-only
 * divergence values used to fix this asset's confirmation threshold below — no leakage into
 * holdout. */
function boundAndCut(series, startSec, endSec, fraction) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return { bounded, cut };
}
const splitAtCut = (bounded, cut, holdout) => bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));

export async function runTopTradersDivergence({
  watchlist = loadWatchlist(), splitFraction = .70, confirmPercentile = CONFIRM_PERCENTILE, minHistoryDays = 500,
  refresh = false, fetchTop = fetchAnalytics, fetchAgg = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const futuresSymbol = toFuturesSymbol(asset.symbol);
      const [topRaw, aggRaw] = await Promise.all([
        fetchTop({ symbol: futuresSymbol, type: "top-traders", since, to, interval: DAY_SEC, refresh }),
        fetchAgg({ symbol: futuresSymbol, type: "long-short-ratio", since, to, interval: DAY_SEC, refresh }),
      ]);
      const points = divergencePoints(topRaw?.normalized, aggRaw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `divergence-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }

      const { bounded, cut } = boundAndCut(s, points[0].revealTime, points.at(-1).revealTime, splitFraction);
      const trainDivergence = points.filter((p) => p.revealTime < cut).map((p) => p.divergence);
      if (!trainDivergence.length) { coverage.push({ symbol: asset.symbol, included: false, reason: "no-train-divergence-points" }); continue; }
      const threshold = percentile(trainDivergence, confirmPercentile);

      eligible.push({ symbol: asset.symbol, id: asset.id, bounded, cut, points, threshold, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1), trainThreshold: +threshold.toFixed(4) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `divergence-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "top-traders-divergence/v1", primaryHypothesis: "top-traders-more-bullish-than-crowd-confirms-long-entries", splitFraction, confirmPercentile, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "DIVERGENCE-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const run = (target, d, holdout) => {
    const part = splitAtCut(d.bounded, d.cut, holdout);
    const confirmedAt = makeConfirmedAt(d.points, d.threshold); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => confirmedAt(tClose),
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
        ? `TOP-TRADERS-DIVERGENCE clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : "TOP-TRADERS-DIVERGENCE FAIL: no family clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("top-traders-divergence.mjs")) {
  const report = await runTopTradersDivergence();
  const saved = saveExperiment("top-traders-divergence", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
