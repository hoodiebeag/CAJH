/**
 * FUTURES-BASIS-DIRECTIONAL-SIGNAL: gates `breakout` and `anticipate` entries on the Kraken
 * Futures basis level (the price differential between the futures contract and spot —
 * contango/backwardation steepness), tested as a DIRECTIONAL signal. Distinct from the
 * already-closed FUNDING-CARRY-DECAY-CHECK (KILLED/decayed), which tested a delta-neutral
 * carry-HARVESTING strategy off the periodic perpetual funding payment — a related but
 * mechanically different metric (basis is whole-term-structure futures-vs-spot pricing;
 * funding is a specific periodic payment mechanism). Also distinct from
 * OPEN-INTEREST-TREND-CONFIRMATION (an OI-trend gate on the same two families, already
 * closed FAIL) — this uses a different information source (basis, not OI) even though the
 * gate mechanism is the same shape.
 *
 * PRE-REGISTERED PRIMARY HYPOTHESIS (written before any train/holdout result was examined):
 * two competing hypotheses exist for what a steep/widening contango means — (a) bullish
 * leveraged-long buildup, a momentum/confirmation signal, or (b) a crowded-long extreme, a
 * contrarian fade signal. This study tests (a) as primary: basis widening (current day's
 * basis above its own trailing average) confirms fresh bullish leveraged conviction, gating
 * `breakout`/`anticipate` — the same two directional/momentum families, and the exact same
 * "current > trailing average" gate shape, that OPEN-INTEREST-TREND-CONFIRMATION already used
 * for its own rising/falling-OI confirmation hypothesis. Hypothesis (b) (contrarian fade on a
 * reversal family, e.g. `sweep_reclaim`) is a distinct, separately-registerable study — not
 * tested here, and not to be retrofitted onto this result post hoc.
 *
 * Data-availability check performed directly against the real API before writing this
 * module: Kraken Futures future-basis history reaches back to 2024-02-28 for both PF_XBTUSD
 * and PF_ETHUSD (899 days — same depth and start date as open-interest/liquidation-volume,
 * same underlying Kraken analytics endpoint, no separate rolling-window ceiling). 28/29
 * watchlist assets clear the 500-day floor; EOS is excluded on the same pre-existing
 * candle-history shortfall as the OI-trend and liquidation-cascade studies (160 daily
 * candles), not a basis-data problem. Kraken's future-basis analytics value has a distinct
 * shape from both OI (`[open,high,low,close]` array) and liquidation-volume (plain scalar):
 * it is an object `{ basis: "<decimal string>" }` — parsed as `Number(value.basis)` below.
 * Observed distribution on PF_XBTUSD/PF_ETHUSD over the full window is centered slightly
 * above zero (contango-biased: median ~0.0001, mean ~0.00015-0.00018) with occasional
 * backwardation (min as low as -0.0022 on PF_ETHUSD), consistent with a real, non-degenerate
 * series rather than a placeholder.
 *
 * N-bar trailing average: N=7 (one week of daily basis closes), matching OI-trend-gate's own
 * "one clean choice" convention rather than a threshold grid — the task specifies one
 * mechanism (basis widening vs its own trailing average), not a parameter sweep.
 *
 * Gate (per family, holdout only, this item's own pre-registered done_when): holdout
 * avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40.
 */
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const DAY_SEC = 86400;
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

/** Kraken's future-basis analytics value is `{ basis: "<decimal string>" }`. Each daily point
 * only becomes visible once its own day has closed (+1 day) — this codebase's standard
 * no-lookahead offset (see oi-trend-gate.mjs's oiPoints / liquidation-cascade-reversal.mjs's
 * liqPoints). */
function basisPoints(normalized) {
  const byTime = new Map();
  for (const p of normalized?.points || []) {
    const basis = Number(p.value?.basis);
    if (Number.isFinite(p.timestamp) && Number.isFinite(basis)) byTime.set(p.timestamp, { revealTime: p.timestamp + DAY_SEC, basis });
  }
  return [...byTime.values()].sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "basis at entry bar vs its N-bar trailing average" cursor — a fresh cursor
 * per call (mirrors oi-trend-gate.mjs's makeOiRisingAt / funding-meanrev.mjs's fundingAsOf
 * convention: never share a cursor across two backtest runs). Compares the latest revealed
 * basis against the average of the N basis values immediately BEFORE it (current point
 * excluded from its own trailing average) — returns false (gate fails closed) until N+1
 * points have been revealed. Fires when basis is widening (current > trailing average),
 * i.e. contango steepening — this study's pre-registered primary (bullish confirmation)
 * hypothesis. */
function makeBasisWideningAt(points, n) {
  let i = 0;
  const values = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { values.push(points[i].basis); i++; }
    if (values.length < n + 1) return false;
    const current = values[values.length - 1];
    const trailing = values.slice(-n - 1, -1);
    return current > average(trailing);
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the basis-covered window, THEN split 70/30 chronologically
 * within that window — same technique oi-trend-gate.mjs's windowedSplit uses, needed because
 * the basis-covered window can differ from the full candle history's span. */
function windowedSplit(series, startSec, endSec, fraction, holdout) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

export async function runFuturesBasisDirectionalSignal({
  watchlist = loadWatchlist(), splitFraction = .70, trailingDays = 7, minHistoryDays = 500,
  refresh = false, fetchBasis = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const raw = await fetchBasis({ symbol: toFuturesSymbol(asset.symbol), type: "future-basis", since, to, interval: DAY_SEC, refresh });
      const points = basisPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `basis-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
      eligible.push({ symbol: asset.symbol, id: asset.id, s, points, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `basis-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "futures-basis-directional-signal/v1", primaryHypothesis: "widening-contango-confirms-bullish-momentum", splitFraction, trailingDays, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "BASIS-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const run = (target, d, holdout) => {
    const part = windowedSplit(d.s, d.start, d.end, splitFraction, holdout);
    const basisWideningAt = makeBasisWideningAt(d.points, trailingDays); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => basisWideningAt(tClose),
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
        ? `FUTURES-BASIS-DIRECTIONAL-SIGNAL clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : "FUTURES-BASIS-DIRECTIONAL-SIGNAL FAIL: no family clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("basis-directional-signal.mjs")) {
  const report = await runFuturesBasisDirectionalSignal();
  const saved = saveExperiment("basis-directional-signal", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
