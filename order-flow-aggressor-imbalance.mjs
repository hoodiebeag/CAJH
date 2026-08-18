/**
 * ORDER-FLOW-AGGRESSOR-IMBALANCE: gates `breakout` and `anticipate` (long, momentum) entries
 * on Kraken Futures aggressor-side trade-flow DIRECTION — a genuinely different signal class
 * from the already-FAILED VOL-CONFIRM-BREAKOUT, which gated on raw spot-candle VOLUME
 * MAGNITUDE (no directional information, and made results worse). This uses `derivatives.mjs`'s
 * `cvd` and `aggressor-differential` analytics types, both real order-flow-direction sources
 * unavailable from OHLCV candles alone. Per this item's own instruction, the two types are
 * treated as ONE information source (two computations of the same aggressor-imbalance concept —
 * cumulative running total vs periodic differential), not two independent hypotheses, to avoid
 * inflating this project's multiple-comparisons exposure.
 *
 * ENDPOINT SHAPES, verified against the real API before writing any strategy code (this
 * project's standing convention — see TOP-TRADERS-DIVERGENCE's endpoint-definition note): the
 * public docs pages (docs.kraken.com/api/docs/futures-api/charts/analytics and .../market-
 * analytics) both 404 as of this check, so both shapes below come from a live probe against
 * `PF_XBTUSD`, not from documentation.
 *   - `cvd`: `result.data = { buy_volume: [...], sell_volume: [...], cvd: [...] }` (three
 *     parallel arrays keyed under the flat object — `normalizeAnalytics` already handles this
 *     without change, since it has 3 keys and therefore never triggers the single-key
 *     `top20Percent`-style unwrap TOP-TRADERS-DIVERGENCE added). `buy_volume`/`sell_volume` are
 *     real per-period trade volume and are query-window-INDEPENDENT (confirmed identical value
 *     for the same day across two fetches with different `since`). The `cvd` sub-field itself is
 *     NOT window-independent — it is a running sum that resets to zero baseline at the query's
 *     own `since` (confirmed: the same day's `cvd` value differed materially between a 5-day and
 *     a 10-day fetch window, `583.84` vs `11.47`). This project's `fetchAnalytics` always uses a
 *     single fixed `since` per asset per run (no pagination occurred in practice — 900 daily
 *     points fit in one page for every symbol checked), so the raw field would have been usable
 *     here, but this module deliberately does NOT rely on it: it is undocumented API behavior
 *     discovered empirically, not a guaranteed contract, and self-computing from the verified
 *     window-independent `buy_volume`/`sell_volume` primitives is strictly more robust to any
 *     future change in window size or pagination. See `cumulativePoints` below.
 *   - `aggressor-differential`: `result.data = [...]` (flat array, already the shape
 *     `normalizeAnalytics` handles for every non-wrapped type). Confirmed query-window-
 *     INDEPENDENT (identical value for the same day regardless of fetch window). Confirmed sign
 *     convention directly from the real numbers, NOT assumed from the field name or from generic
 *     web descriptions of "aggressor differential" (which suggested buy-positive; the real data
 *     says the opposite): `aggressor-differential[i] == -(buy_volume[i] - sell_volume[i])`,
 *     i.e. Kraken's raw value is POSITIVE when SELL-side aggression dominates. This module
 *     negates it on read (`netBuyPressure = -raw`) so both formulations share one consistent
 *     buy-positive convention throughout.
 *
 * TWO FORMULATIONS, one per API type, matching the task's own "cumulative running total vs
 * periodic differential" framing:
 *   - `periodic`: `aggressor-differential`'s own per-period value (sign-corrected to
 *     `netBuyPressure`), gated the same "latest revealed value at/above its own TRAIN-fixed 80th
 *     percentile" confirmation shape TOP-TRADERS-DIVERGENCE/LONG-SHORT-RATIO-CONTRARIAN use.
 *   - `cumulative`: a running sum of `cvd`'s own `buy_volume - sell_volume` per period
 *     (self-computed, NOT Kraken's raw `cvd` field, per the endpoint note above), gated the same
 *     "current value above its own N=7-bar trailing average" trend shape OI-TREND-GATE's
 *     `makeOiRisingAt` uses (N=7 reused unmodified — one disclosed choice, not a parameter
 *     sweep, matching that item's own convention).
 * Both cross-checked against each other on the real API: for the same day,
 * `aggressor-differential`'s raw value equals `-(buy_volume - sell_volume)` from `cvd` exactly
 * (confirmed on 5 live sample points for PF_XBTUSD), so the two endpoints are measuring the same
 * underlying per-period flow, as the task's framing assumes.
 *
 * SELECTION DISCIPLINE (this item's own instruction — "same no-peeking discipline as
 * VOL-CONFIRM-BREAKOUT"): both formulations are scored on TRAIN ONLY, per family
 * (`breakout`/`anticipate` independently, since each family's optimal filter mechanism can
 * differ — every prior study in this series reports/selects per family, not globally). The
 * single best-on-train formulation per family (highest train avgR/trade among those with >=1
 * train trade) is the only one whose holdout is ever computed, evaluated exactly once — same
 * selection technique LIQUIDATION-CASCADE-REVERSAL used across its own three candidate
 * multipliers.
 *
 * Data-availability check performed directly against the real API before writing this module:
 * both `cvd` and `aggressor-differential` reach back to 2024-02-28 for PF_XBTUSD/PF_ETHUSD/
 * PF_SOLUSD/PF_XRPUSD alike (same start date as OPEN-INTEREST-TREND-CONFIRMATION's and
 * LIQUIDATION-CASCADE-REVERSAL's `open-interest`/`liquidation-volume` checks — same underlying
 * Kraken analytics endpoint family, same depth), single page for the full 900-day window (no
 * pagination observed for any of the four sampled symbols). Coverage is therefore gated on the
 * same candle-history floor as every other derivatives study (28/29 watchlist assets, EOS
 * excluded on its pre-existing candle-history shortfall).
 *
 * Gate (this item's own pre-registered done_when, per family, holdout only): holdout avgR/trade
 * > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

const DAY_SEC = 86400;
const CONFIRM_PERCENTILE = 0.80;
const CUMULATIVE_TRAILING_DAYS = 7;
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

/** `aggressor-differential`'s own per-period value, sign-corrected to a buy-positive
 * `netBuyPressure` convention (see the module docstring's endpoint-shape note for the verified
 * sign). Each daily point only becomes visible once its own day has closed (+1 day) — this
 * codebase's standard no-lookahead offset (see oi-trend-gate.mjs's oiPoints /
 * liquidation-cascade-reversal.mjs's liqPoints). */
function periodicPoints(normalized) {
  const points = [];
  for (const p of normalized?.points || []) {
    const raw = Number(p.value);
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(raw)) continue;
    points.push({ revealTime: p.timestamp + DAY_SEC, netBuyPressure: -raw });
  }
  return points.sort((a, b) => a.revealTime - b.revealTime);
}

/** Self-computed running sum of `cvd`'s own `buy_volume - sell_volume` per period, deliberately
 * NOT Kraken's raw `cvd` field (see the module docstring's endpoint-shape note for why). Same
 * +1 day no-lookahead reveal offset as periodicPoints. */
function cumulativePoints(normalized) {
  const daily = [];
  for (const p of normalized?.points || []) {
    const buy = Number(p.value?.buy_volume);
    const sell = Number(p.value?.sell_volume);
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(buy) || !Number.isFinite(sell)) continue;
    daily.push({ timestamp: p.timestamp, diff: buy - sell });
  }
  daily.sort((a, b) => a.timestamp - b.timestamp);
  let running = 0;
  return daily.map((d) => { running += d.diff; return { revealTime: d.timestamp + DAY_SEC, cumulative: running }; });
}

/** Forward-walking "is the latest revealed netBuyPressure at/above its fixed train-only
 * confirmation threshold" cursor — a fresh cursor per call (mirrors oi-trend-gate.mjs's
 * makeOiRisingAt convention: never share a cursor across two backtest runs). Fails closed
 * (blocks entry) until the first point has revealed. */
function makePeriodicConfirmedAt(points, threshold) {
  let i = 0;
  let current = null;
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { current = points[i].netBuyPressure; i++; }
    if (current === null) return false;
    return current >= threshold;
  };
}

/** Forward-walking "self-computed cumulative order flow at entry bar vs its N-bar trailing
 * average" cursor — same shape as oi-trend-gate.mjs's makeOiRisingAt (current point excluded
 * from its own trailing average). A fresh cursor per call. */
function makeCumulativeRisingAt(points, n) {
  let i = 0;
  const vals = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { vals.push(points[i].cumulative); i++; }
    if (vals.length < n + 1) return false;
    const current = vals[vals.length - 1];
    const trailing = vals.slice(-n - 1, -1);
    return current > average(trailing);
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the INTERSECTION of both formulations' covered windows, then
 * compute the 70/30 chronological cut timestamp within that shared window — same windowing
 * technique top-traders-divergence.mjs's boundAndCut uses. Using the intersection (not either
 * series' own full window) keeps both candidates' train-only comparison on an identical candle
 * universe, so the best-on-train selection below is a fair comparison. */
function boundAndCut(series, startSec, endSec, fraction) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return { bounded, cut };
}
const splitAtCut = (bounded, cut, holdout) => bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));

export async function runOrderFlowAggressorImbalance({
  watchlist = loadWatchlist(), splitFraction = .70, confirmPercentile = CONFIRM_PERCENTILE,
  trailingDays = CUMULATIVE_TRAILING_DAYS, minHistoryDays = 500,
  refresh = false, fetchCvd = fetchAnalytics, fetchAgg = fetchAnalytics,
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
      const [cvdRaw, aggRaw] = await Promise.all([
        fetchCvd({ symbol: futuresSymbol, type: "cvd", since, to, interval: DAY_SEC, refresh }),
        fetchAgg({ symbol: futuresSymbol, type: "aggressor-differential", since, to, interval: DAY_SEC, refresh }),
      ]);
      const periodic = periodicPoints(aggRaw?.normalized);
      const cumulative = cumulativePoints(cvdRaw?.normalized);
      if (!periodic.length || !cumulative.length) { coverage.push({ symbol: asset.symbol, included: false, reason: "orderflow-fetch-empty" }); continue; }

      const start = Math.max(periodic[0].revealTime, cumulative[0].revealTime);
      const end = Math.min(periodic.at(-1).revealTime, cumulative.at(-1).revealTime);
      const days = (end - start) / DAY_SEC;
      if (!(days >= minHistoryDays)) { coverage.push({ symbol: asset.symbol, included: false, reason: `orderflow-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }

      const { bounded, cut } = boundAndCut(s, start, end, splitFraction);
      const trainPeriodic = periodic.filter((p) => p.revealTime >= start && p.revealTime < cut).map((p) => p.netBuyPressure);
      if (!trainPeriodic.length) { coverage.push({ symbol: asset.symbol, included: false, reason: "no-train-periodic-points" }); continue; }
      const threshold = percentile(trainPeriodic, confirmPercentile);

      eligible.push({ symbol: asset.symbol, id: asset.id, bounded, cut, periodic, cumulative, threshold, start, end, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1), trainThreshold: +threshold.toFixed(4) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `orderflow-fetch-error: ${err.message}` }); }
  }

  const baseInput = {
    specification: "order-flow-aggressor-imbalance/v1",
    primaryHypothesis: "aggressor-side-net-buy-pressure-confirms-long-entries",
    splitFraction, confirmPercentile, trailingDays, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage,
  };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "ORDERFLOW-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const CANDIDATES = {
    periodic: (d) => makePeriodicConfirmedAt(d.periodic, d.threshold),
    cumulative: (d) => makeCumulativeRisingAt(d.cumulative, trailingDays),
  };

  const run = (candidateKey, target, d, holdout) => {
    const part = splitAtCut(d.bounded, d.cut, holdout);
    const gateAt = CANDIDATES[candidateKey](d); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => gateAt(tClose),
    });
  };

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    // Train-only formulation selection: score both candidates on train, never touch holdout
    // except for the single best-on-train formulation.
    const trainByCandidate = Object.keys(CANDIDATES).map((candidateKey) => {
      const perAsset = eligible.map((d) => ({ symbol: d.symbol, train: run(candidateKey, target, d, false) }));
      return { candidateKey, train: summarize(perAsset.map((p) => p.train)), perAsset };
    });

    const withTrades = trainByCandidate.filter((c) => c.train.trades > 0);
    if (!withTrades.length) {
      families[target] = {
        candidates: trainByCandidate.map(({ candidateKey, train }) => ({ candidateKey, train })),
        selected: null, holdout: null, gate: null,
      };
      continue;
    }
    const best = withTrades.reduce((a, b) => (b.train.avgR > a.train.avgR ? b : a));

    const perAssetHoldout = eligible.map((d) => ({ symbol: d.symbol, holdout: run(best.candidateKey, target, d, true) }));
    const holdout = summarize(perAssetHoldout.map((p) => p.holdout));
    const gate = {
      avgRMin: -0.30, tradesMin: 150, positiveFracMin: 0.40,
      avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 150,
      positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
    };
    gate.passed = gate.avgRPass && gate.tradesPass && gate.positiveFracPass;

    families[target] = {
      candidates: trainByCandidate.map(({ candidateKey, train }) => ({ candidateKey, train })),
      selected: best.candidateKey,
      train: best.train,
      holdout, gate,
      perAsset: perAssetHoldout.map(({ symbol, holdout }) => ({ symbol, holdout: { trades: holdout.trades, avgR: holdout.avgR } })),
    };
  }

  const passed = Object.entries(families).filter(([, f]) => f.gate?.passed).map(([id]) => id);
  const noTradeFamilies = Object.entries(families).filter(([, f]) => f.gate === null).map(([id]) => id);
  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: passed.length
        ? `ORDER-FLOW-AGGRESSOR-IMBALANCE clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : noTradeFamilies.length === Object.keys(families).length
          ? "ORDER-FLOW-AGGRESSOR-IMBALANCE FAIL: no candidate formulation produced a single train trade for any family (order-flow condition never intersects a breakout/anticipate signal on this watchlist)"
          : "ORDER-FLOW-AGGRESSOR-IMBALANCE FAIL: no family clears the pre-registered gate at its best-on-train formulation (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("order-flow-aggressor-imbalance.mjs")) {
  const report = await runOrderFlowAggressorImbalance();
  const saved = saveExperiment("order-flow-aggressor-imbalance", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
