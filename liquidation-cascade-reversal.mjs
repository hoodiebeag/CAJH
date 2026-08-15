/**
 * LIQUIDATION-CASCADE-REVERSAL: gates `sweep_reclaim` entries (a liquidity-sweep-then-close-
 * back-above reclaim — already the codebase's own contrarian-reversal family) on a genuine
 * Kraken Futures liquidation-volume spike at the entry bar. Hypothesis: a spike in forced
 * liquidation volume represents involuntary, mechanically-forced selling (or buying) rather
 * than voluntary price action; once that forced flow exhausts itself, the reversal is more
 * likely to hold than an unconfirmed sweep-and-reclaim. This is NOT a re-skin of the
 * already-tested B5-REVERSAL (short-horizon cross-sectional return ranking) — this is
 * event-triggered off a specific liquidation-volume threshold breach on a specific asset, and
 * NOT the same mechanism as OPEN-INTEREST-TREND-CONFIRMATION (a rising/falling OI *trend*
 * gate on trend-following families) — this is a single-bar *spike* gate on a *reversal*
 * family. `sweep_reclaim`'s plain baseline already FAILED on its own (-0.590 train / -0.711
 * holdout, per VERDICTS.md's RANGE-SWEEP-RECLAIM-adjacent finding) — this asks whether
 * genuine forced-liquidation origin rescues it, the same "does a new information source
 * rescue an already-failed price-action pattern" shape as OI-trend-gate and FUNDING-MEANREV.
 *
 * Data source: `derivatives.mjs`'s `fetchAnalytics(type:'liquidation-volume')`, confirmed
 * directly against the real API before writing this module: daily liquidation-volume history
 * for PF_XBTUSD reaches back to 2024-02-28 (899 days, same depth as open-interest — same
 * underlying Kraken analytics endpoint, no separate rolling-window ceiling), with a
 * heavily right-skewed distribution (p50 ~8.5, p90 ~76, p99 ~313, max ~686 over that window)
 * consistent with genuine spike events rather than a smooth series.
 *
 * Spike definition: current day's liquidation volume > multiplier x its own trailing 7-day
 * average (N=7, matching OI-trend-gate's trailing window), current point excluded from its
 * own trailing average, revealed only +1 day after the day closes (this codebase's standard
 * no-lookahead offset for daily analytics — see oi-trend-gate.mjs's oiPoints / tournament.mjs's
 * buildBtcAboveMa200At). The task specifies "e.g. Nx its trailing average" without fixing N,
 * so three candidate multipliers (2x, 3x, 5x — spanning "clearly above normal" to "extreme
 * outlier" given the skew above) are scored on TRAIN ONLY; the single best-on-train multiplier
 * (highest train avgR/trade among those with >=1 train trade) is the only one whose holdout is
 * ever computed, evaluated exactly once — the same selection discipline
 * TEST2-VOL-CONFIRMED-BREAKOUT already used ("fix the best threshold ON THE TRAIN SPLIT ONLY,
 * then evaluate holdout exactly once"), avoiding the look-ahead of picking a threshold post hoc.
 *
 * Gate (this item's own pre-registered done_when, stated as exactly two holdout clauses with
 * an explicitly lower trade floor since this is an event-triggered, lower-frequency signal —
 * intersecting two already-selective conditions, spike AND sweep_reclaim, so far fewer trades
 * are expected than a plain single-condition family): holdout avgR/trade > -0.30 AND holdout
 * trades >= 100. positiveAssets is still reported for the same-sign disclosure every other
 * VERDICTS.md row includes, but is not part of this item's pass condition.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

const DAY_SEC = 86400;
// Exact `sweep_reclaim` baseline config from tournament.mjs's `families` table, applied
// unmodified so this result is comparable to every other sweep_reclaim-family verdict already
// in VERDICTS.md.
const SWEEP_RECLAIM_BASELINE = { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true };
const CANDIDATE_MULTIPLIERS = [2, 3, 5];

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** Kraken's liquidation-volume analytics value is a single scalar per day. Each daily point
 * only becomes visible once its own day has closed (+1 day) — same no-lookahead offset
 * oi-trend-gate.mjs's oiPoints uses. */
function liqPoints(normalized) {
  const byTime = new Map();
  for (const p of normalized?.points || []) {
    const vol = Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(vol)) byTime.set(p.timestamp, { revealTime: p.timestamp + DAY_SEC, vol });
  }
  return [...byTime.values()].sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "liquidation volume at entry bar vs its N-day trailing average" cursor — a
 * fresh cursor per call (mirrors oi-trend-gate.mjs's makeOiRisingAt / funding-meanrev.mjs's
 * fundingAsOf convention: never share a cursor across two backtest runs). Fires (gate passes)
 * only once N+1 points have been revealed and the latest revealed day's volume exceeds
 * `multiplier` x the average of the N days immediately before it (current point excluded from
 * its own trailing average). */
function makeLiqSpikeAt(points, n, multiplier) {
  let i = 0;
  const vols = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { vols.push(points[i].vol); i++; }
    if (vols.length < n + 1) return false;
    const current = vols[vols.length - 1];
    const trailing = vols.slice(-n - 1, -1);
    const avg = average(trailing);
    return avg > 0 && current > multiplier * avg;
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the liquidation-data-covered window, THEN split 70/30
 * chronologically within that window — same technique oi-trend-gate.mjs's windowedSplit uses,
 * needed because the liquidation-covered window can differ from the full candle history's span. */
function windowedSplit(series, startSec, endSec, fraction, holdout) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

export async function runLiquidationCascadeReversal({
  watchlist = loadWatchlist(), splitFraction = .70, trailingDays = 7, minHistoryDays = 500,
  refresh = false, fetchLiq = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const raw = await fetchLiq({ symbol: toFuturesSymbol(asset.symbol), type: "liquidation-volume", since, to, interval: DAY_SEC, refresh });
      const points = liqPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `liq-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
      eligible.push({ symbol: asset.symbol, id: asset.id, s, points, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `liq-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "liquidation-cascade-reversal/v1", splitFraction, trailingDays, minHistoryDays, candidateMultipliers: CANDIDATE_MULTIPLIERS, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "LIQ-DATA-INSUFFICIENT", eligibleAssets: 0, thresholds: [] } };
  }

  const run = (multiplier, d, holdout) => {
    const part = windowedSplit(d.s, d.start, d.end, splitFraction, holdout);
    const liqSpikeAt = makeLiqSpikeAt(d.points, trailingDays, multiplier); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...SWEEP_RECLAIM_BASELINE, entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => liqSpikeAt(tClose),
    });
  };

  // Train-only threshold selection: score every candidate multiplier on train, never touch
  // holdout except for the single best-on-train candidate.
  const trainByMultiplier = CANDIDATE_MULTIPLIERS.map((multiplier) => {
    const perAsset = eligible.map((d) => ({ symbol: d.symbol, train: run(multiplier, d, false) }));
    return { multiplier, train: summarize(perAsset.map((p) => p.train)) };
  });

  const withTrades = trainByMultiplier.filter((t) => t.train.trades > 0);
  if (!withTrades.length) {
    return {
      input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
      result: {
        thresholds: trainByMultiplier, selected: null, holdout: null, gate: null,
        verdict: "LIQUIDATION-CASCADE-REVERSAL FAIL: no candidate multiplier produced a single train trade (spike condition never intersects a sweep_reclaim signal on this watchlist)",
      },
    };
  }
  const best = withTrades.reduce((a, b) => (b.train.avgR > a.train.avgR ? b : a));

  const perAssetHoldout = eligible.map((d) => ({ symbol: d.symbol, holdout: run(best.multiplier, d, true) }));
  const holdout = summarize(perAssetHoldout.map((p) => p.holdout));
  const gate = {
    avgRMin: -0.30, tradesMin: 100,
    avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 100,
  };
  gate.passed = gate.avgRPass && gate.tradesPass;

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      thresholds: trainByMultiplier,
      selected: best.multiplier,
      holdout,
      gate,
      perAsset: perAssetHoldout.map(({ symbol, holdout }) => ({ symbol, holdout: { trades: holdout.trades, avgR: holdout.avgR } })),
      verdict: gate.passed
        ? `LIQUIDATION-CASCADE-REVERSAL clears the pre-registered gate at multiplier ${best.multiplier}x (holdout avgR>-0.30 AND trades>=100)`
        : `LIQUIDATION-CASCADE-REVERSAL FAIL at its best-on-train multiplier ${best.multiplier}x (holdout avgR>-0.30 AND trades>=100)`,
    },
  };
}

if (process.argv[1]?.endsWith("liquidation-cascade-reversal.mjs")) {
  const report = await runLiquidationCascadeReversal();
  const saved = saveExperiment("liquidation-cascade-reversal", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
