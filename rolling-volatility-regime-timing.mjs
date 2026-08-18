/**
 * ROLLING-VOLATILITY-REGIME-TIMING: gates `breakout` and `anticipate` entries on Kraken
 * Futures realized-volatility REGIME (expanding vs contracting), using `derivatives.mjs`'s
 * `rolling-volatility` analytics type for the first time in a sealed-holdout study.
 *
 * Distinct from ATR-ADAPTIVE-STOP-CONFIRMATORY (already FAIL — sized the STOP DISTANCE by
 * ATR, a candle-derived proxy) and T2-VOLCONTRACTION (already FAIL — an ATR-compression ENTRY
 * TRIGGER, also candle-derived). This tests realized-volatility REGIME as an entry-timing
 * FILTER on the existing breakout/anticipate signal, using Kraken's own rolling-volatility
 * feed (annualized realized vol, %) rather than a candle-derived ATR proxy — a genuinely
 * different (if related) volatility measurement, and a FILTER rather than a stop-sizing or
 * entry-trigger mechanism.
 *
 * TWO DIRECTIONS, both pre-registered together per this item's own instruction ("test both
 * directions... not picked from train results") — unlike every prior gate study in this
 * series, there is NO best-on-train selection step here: both `expanding` (current
 * rolling-volatility above its own N-bar trailing average — a "vol is rising" regime) and
 * `contracting` (current below its own trailing average — a "vol is falling" regime) get
 * their own independent train AND holdout evaluation, mutually exclusive by construction
 * (current cannot simultaneously exceed and fall below the same trailing average). N=7
 * trailing days, the same single disclosed window OI-TREND-GATE's `makeOiRisingAt` and
 * ORDER-FLOW-AGGRESSOR-IMBALANCE's `cumulative` formulation both use — one pre-registered
 * choice, not a parameter sweep.
 *
 * ENDPOINT SHAPE, verified against a live API probe before writing this module (this
 * project's standing convention): `result.data = [...]` (flat array of numeric-string
 * annualized-vol percentages, e.g. `"22.11"`), already the shape `normalizeAnalytics` handles
 * for every non-wrapped type — no unwrap needed. Confirmed query-window-INDEPENDENT (the same
 * calendar day's value was identical across a 5-day and a 10-day live fetch window, e.g.
 * timestamp `1786579200 -> "22.11"` both times), unlike `cvd`'s raw field (see
 * ORDER-FLOW-AGGRESSOR-IMBALANCE's docstring for that contrast) — so no self-computation
 * workaround is needed here, the raw field is used directly.
 *
 * Data-availability check performed directly against the real API before writing this
 * module: rolling-volatility reaches back to 2024-03-01 for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/
 * PF_XRPUSD alike (901 daily points for a 900-day window, no pagination observed) — same
 * start date/depth as every other derivatives study's checked family. 28/29 watchlist assets
 * clear the 500-day floor (EOS excluded on the same pre-existing candle-history shortfall as
 * every other derivatives study).
 *
 * Gate (per family, per direction, holdout only — this item's own pre-registered done_when):
 * holdout avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >=
 * 0.40, evaluated independently for BOTH `expanding` and `contracting` (no selection step).
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

const DAY_SEC = 86400;
const TRAILING_DAYS = 7;
// Exact baseline configs from tournament.mjs's `families` table, applied unmodified so
// results are comparable to every other anticipate/breakout verdict in VERDICTS.md.
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};
// Both directions pre-registered together — see module docstring. `true`/`false` selects
// whether the gate requires current vol ABOVE (expanding) or BELOW (contracting) its own
// trailing average.
const DIRECTIONS = { expanding: true, contracting: false };

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** Rolling-volatility's own per-period value (annualized realized vol, %). Each daily point
 * only becomes visible once its own day has closed (+1 day) — this codebase's standard
 * no-lookahead offset (see oi-trend-gate.mjs's oiPoints / order-flow-aggressor-imbalance.mjs's
 * periodicPoints). */
function volPoints(normalized) {
  const points = [];
  for (const p of normalized?.points || []) {
    const vol = Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(vol)) points.push({ revealTime: p.timestamp + DAY_SEC, vol });
  }
  return points.sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "current realized-vol vs its own N-bar trailing average" cursor — a fresh
 * cursor per call (mirrors oi-trend-gate.mjs's makeOiRisingAt convention: never share a cursor
 * across two backtest runs). `above=true` is the expanding-regime direction (current above its
 * own trailing average); `above=false` is contracting (current below). Current point excluded
 * from its own trailing average (no self-inclusion bias). Fails closed (blocks entry) until
 * N+1 points have revealed. */
function makeVolRegimeAt(points, n, above) {
  let i = 0;
  const vals = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { vals.push(points[i].vol); i++; }
    if (vals.length < n + 1) return false;
    const current = vals[vals.length - 1];
    const trailing = average(vals.slice(-n - 1, -1));
    return above ? current > trailing : current < trailing;
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the vol-covered window, THEN split 70/30 chronologically
 * within that window — same technique oi-trend-gate.mjs's windowedSplit uses, needed because
 * the vol-covered window can differ from the full candle history's span. */
function windowedSplit(series, startSec, endSec, fraction, holdout) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

export async function runRollingVolatilityRegimeTiming({
  watchlist = loadWatchlist(), splitFraction = .70, trailingDays = TRAILING_DAYS, minHistoryDays = 500,
  refresh = false, fetchVol = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const raw = await fetchVol({ symbol: toFuturesSymbol(asset.symbol), type: "rolling-volatility", since, to, interval: DAY_SEC, refresh });
      const points = volPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `vol-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
      eligible.push({ symbol: asset.symbol, id: asset.id, s, points, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `vol-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "rolling-volatility-regime-timing/v1", splitFraction, trailingDays, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "VOLREGIME-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const run = (direction, target, d, holdout) => {
    const part = windowedSplit(d.s, d.start, d.end, splitFraction, holdout);
    const regimeAt = makeVolRegimeAt(d.points, trailingDays, DIRECTIONS[direction]); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => regimeAt(tClose),
    });
  };

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const regimes = {};
    for (const direction of Object.keys(DIRECTIONS)) {
      const perAsset = eligible.map((d) => ({ symbol: d.symbol, train: run(direction, target, d, false), holdout: run(direction, target, d, true) }));
      const train = summarize(perAsset.map((p) => p.train));
      const holdout = summarize(perAsset.map((p) => p.holdout));
      const gate = {
        avgRMin: -0.30, tradesMin: 150, positiveFracMin: 0.40,
        avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 150,
        positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
      };
      gate.passed = gate.avgRPass && gate.tradesPass && gate.positiveFracPass;
      regimes[direction] = {
        train, holdout, gate,
        perAsset: perAsset.map(({ symbol, train, holdout }) => ({ symbol, train: { trades: train.trades, avgR: train.avgR }, holdout: { trades: holdout.trades, avgR: holdout.avgR } })),
      };
    }
    families[target] = { regimes };
  }

  const passed = [];
  for (const [target, f] of Object.entries(families)) {
    for (const [direction, r] of Object.entries(f.regimes)) if (r.gate.passed) passed.push(`${target}/${direction}`);
  }
  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: passed.length
        ? `ROLLING-VOLATILITY-REGIME-TIMING clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : "ROLLING-VOLATILITY-REGIME-TIMING FAIL: no family/direction clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("rolling-volatility-regime-timing.mjs")) {
  const report = await runRollingVolatilityRegimeTiming();
  const saved = saveExperiment("rolling-volatility-regime-timing", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
