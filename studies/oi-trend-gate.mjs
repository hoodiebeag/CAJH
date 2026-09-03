/**
 * OPEN-INTEREST-TREND-CONFIRMATION: gates `breakout` and `anticipate` entries on Kraken
 * Futures open-interest (OI) trend. Hypothesis: rising OI alongside a breakout/anticipate
 * signal indicates fresh leveraged conviction (real trend confirmation); falling OI
 * indicates short-covering/weak-hands (a move likely to fade). Genuinely untested
 * information source: `derivatives.mjs`'s `fetchAnalytics(type:'open-interest')` has real,
 * tested (3 tests) Kraken Futures coverage but was never wired into a sealed-holdout study
 * before this — only exercised via `research.js`'s `derivatives` CLI diagnostic (point
 * counts only, no strategy logic).
 *
 * Data-availability check performed directly against the real API before writing this
 * module: Kraken Futures OI history reaches back to 2024-02-28 for every one of the 29
 * watchlist symbols (694-899 days depending on listing date) — unlike funding data
 * (H11/FUNDING-MEANREV), OI has no ~365-730-day rolling-window ceiling on this environment,
 * so the gate below is expected to clear rather than terminate in a non-verdict, but is
 * still run first and coded to stop honestly if that expectation is wrong for some subset.
 *
 * N-bar trailing average: N=7 (one week of daily OI closes), a single disclosed
 * pre-registered choice rather than a threshold grid — the task specifies one mechanism
 * (OI rising/falling vs its own trailing average), not a parameter sweep, matching
 * FUNDING-MEANREV's "one clean choice" convention rather than TREND_GATE/ATR-ADAPTIVE-STOP's
 * multi-cell grids.
 *
 * Gate (per family, holdout only, this item's own pre-registered done_when — no separate
 * train-side pre-gate the way FUNDING-MEANREV/FIB-PULLBACK/VOL-CONFIRM-BREAKOUT use, since
 * this item's done_when specifies exactly these three holdout clauses and nothing else;
 * train scores are still computed and reported for the same-sign disclosure every other
 * VERDICTS.md row includes): holdout avgR/trade > -0.30 AND holdout trades >= 150 AND
 * holdout positiveAssets/assets >= 0.40.
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

/** Kraken's open-interest analytics value is [open,high,low,close]; use the day's close level.
 * Each daily point only becomes visible once its own day has closed (+1 day) — this
 * codebase's standard no-lookahead offset (tournament.mjs's buildBtcAboveMa200At uses the
 * same +1 day on its own daily timeline). */
function oiPoints(normalized) {
  const byTime = new Map();
  for (const p of normalized?.points || []) {
    const close = Array.isArray(p.value) ? Number(p.value[3]) : Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(close)) byTime.set(p.timestamp, { revealTime: p.timestamp + DAY_SEC, close });
  }
  return [...byTime.values()].sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "OI at entry bar vs its N-bar trailing average" cursor — a fresh cursor
 * per call (mirrors funding-meanrev.mjs's fundingAsOf convention: never share a cursor
 * across two backtest runs). Compares the latest revealed close against the average of the
 * N closes immediately BEFORE it (current point excluded from its own trailing average, to
 * avoid a trivial self-inclusion bias) — returns false (gate fails closed) until N+1 points
 * have been revealed. */
function makeOiRisingAt(points, n) {
  let i = 0;
  const closes = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { closes.push(points[i].close); i++; }
    if (closes.length < n + 1) return false;
    const current = closes[closes.length - 1];
    const trailing = closes.slice(-n - 1, -1);
    return current > average(trailing);
  };
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

/** Restrict a multi-TF series to the OI-covered window, THEN split 70/30 chronologically
 * within that window — same technique funding-meanrev.mjs's windowedSplit uses, needed
 * because the OI-covered window can differ from the full candle history's span. */
function windowedSplit(series, startSec, endSec, fraction, holdout) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= startSec && +c.time <= endSec) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

export async function runOpenInterestTrendConfirmation({
  watchlist = loadWatchlist(), splitFraction = .70, trailingDays = 7, minHistoryDays = 500,
  refresh = false, fetchOi = fetchAnalytics,
} = {}) {
  const coverage = [];
  const eligible = [];
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY_SEC;
  for (const asset of normalize(watchlist)) {
    try {
      const s = seriesFor(asset.id);
      if (!s.every((tf) => tf.candles.length >= 250)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
      const raw = await fetchOi({ symbol: toFuturesSymbol(asset.symbol), type: "open-interest", since, to, interval: DAY_SEC, refresh });
      const points = oiPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY_SEC : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `oi-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
      eligible.push({ symbol: asset.symbol, id: asset.id, s, points, start: points[0].revealTime, end: points.at(-1).revealTime, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `oi-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "open-interest-trend-confirmation/v1", splitFraction, trailingDays, minHistoryDays, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "OI-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const run = (target, d, holdout) => {
    const part = windowedSplit(d.s, d.start, d.end, splitFraction, holdout);
    const oiRisingAt = makeOiRisingAt(d.points, trailingDays); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => oiRisingAt(tClose),
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
        ? `OPEN-INTEREST-TREND-CONFIRMATION clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)`
        : "OPEN-INTEREST-TREND-CONFIRMATION FAIL: no family clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150 AND positiveAssets/assets>=0.40)",
    },
  };
}

if (process.argv[1]?.endsWith("oi-trend-gate.mjs")) {
  const report = await runOpenInterestTrendConfirmation();
  const saved = saveExperiment("oi-trend-gate", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
