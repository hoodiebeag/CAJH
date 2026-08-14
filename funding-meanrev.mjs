/**
 * TEST3-FUNDING-MEANREV: spot long entries gated on negative perpetual funding.
 *
 * Hypothesis: when the perpetual funding rate is negative (shorts pay longs), that is a
 * structural mean-reversion tailwind for spot longs — a genuinely different information
 * source from every price-structure-only family already tested (see VERDICTS.md). Distinct
 * from H11 (funding <=0.01% as a low-funding INCLUSION gate): this uses a stricter, signed
 * NEGATIVE-funding threshold as an entry veto on top of the existing `breakout` trigger.
 *
 * Funding source: Kraken's public historical-funding-rates endpoint (derivatives.mjs),
 * not Binance (fundinglib.mjs) — Binance USD-M funding is HTTP 451 geo-blocked from this
 * environment (confirmed directly, same as H11's own diagnosis). Kraken's history only
 * spans ~366 days (also confirmed directly), so the data-availability gate below checks
 * >=365 days rather than H11's 730-day bar, and the train/holdout split is drawn from the
 * funding-covered window itself (see windowedSplit) rather than a fixed calendar date —
 * the task's originally-specified "earliest available funding data to 2025-06-01" train
 * cutoff predates funding data existing at all (Kraken's history starts 2025-08-13), so a
 * literal reading of that boundary would leave the train split empty. Splitting 70/30
 * within the actually-available funding window instead preserves this project's standing
 * sealed-chronological-split convention (same technique funding-study.mjs and H11 already
 * use) without silently loosening the pass/fail gates themselves.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { fetchFundingRates } from "./derivatives.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

const DAY = 86400_000;
// Exact `breakout` baseline config from tournament.mjs's `families` table (tpR=3), so this
// result is comparable to every other breakout-family verdict already in VERDICTS.md.
const BREAKOUT_BASELINE = { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** Dedup + sort Kraken's raw {timestamp, relativeFundingRate} rows into a time-ascending series. */
function fundingPoints(rates) {
  const byTime = new Map();
  for (const row of rates || []) {
    const time = Date.parse(row?.timestamp), rate = Number(row?.relativeFundingRate);
    if (Number.isFinite(time) && Number.isFinite(rate)) byTime.set(time, { time, rate });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Forward-fill "funding rate as of this bar's close" — a fresh cursor per call (mirrors
 * backtest.js's own makeAsOf convention: never share a cursor across two backtest runs). */
function fundingAsOf(points) {
  let i = 0, latest = null;
  return (timeSec) => {
    const time = Number(timeSec) * 1000;
    while (i < points.length && points[i].time <= time) latest = points[i++];
    return latest?.rate ?? null;
  };
}

/** Restrict a multi-TF series to the funding-covered window, THEN split 70/30 chronologically
 * within that window — not the full candle history, which runs far longer than funding data
 * and would otherwise starve train (or holdout) of any funding-gated bars at all. */
function windowedSplit(series, startMs, endMs, fraction, holdout) {
  const bounded = series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time * 1000 >= startMs && +c.time * 1000 <= endMs) }));
  const cut = Number(bounded[0].candles[Math.floor(bounded[0].candles.length * fraction)]?.time);
  return bounded.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

function summarize(results) {
  const active = results.filter((x) => x.trades > 0);
  const flat = results.flatMap((x) => x.results || []);
  return { trades: flat.length, avgR: average(flat), totalR: flat.reduce((a, b) => a + b, 0), assets: active.length, positiveAssets: active.filter((x) => x.avgR > 0).length };
}

export async function runFundingMeanRevStudy({
  watchlist = loadWatchlist(), splitFraction = .70, threshold = -0.00005, minHistoryDays = 365, minEligibleAssets = 8,
  refresh = false, fetchFunding = fetchFundingRates,
} = {}) {
  const coverage = [];
  const eligible = [];
  for (const asset of normalize(watchlist)) {
    try {
      const raw = await fetchFunding({ symbol: toFuturesSymbol(asset.symbol), refresh });
      const points = fundingPoints(raw?.rates);
      const days = points.length ? (points.at(-1).time - points[0].time) / DAY : 0;
      if (!points.length || days < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `funding-history-short (${days.toFixed(1)} of ${minHistoryDays} days)` }); continue; }
      eligible.push({ symbol: asset.symbol, id: asset.id, points, start: points[0].time, end: points.at(-1).time, days: +days.toFixed(1) });
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `funding-fetch-error: ${err.message}` }); }
  }

  const baseInput = { specification: "funding-meanrev/v1", threshold, splitFraction, minHistoryDays, minEligibleAssets, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (eligible.length < minEligibleAssets) {
    return {
      input: baseInput,
      result: { verdict: "FUNDING-DATA-INSUFFICIENT", eligibleAssets: eligible.length, minEligibleAssets, perAsset: [] },
    };
  }

  const datasets = eligible.map((a) => {
    const s = seriesFor(a.id);
    if (!s.every((tf) => tf.candles.length >= 250)) return null;
    return { symbol: a.symbol, s, points: a.points, start: a.start, end: a.end };
  }).filter(Boolean);

  const run = (d, holdout) => {
    const part = windowedSplit(d.s, d.start, d.end, splitFraction, holdout);
    const asOf = fundingAsOf(d.points); // fresh cursor for this call only
    return backtestMultiTF({ series: part }, {
      ...BREAKOUT_BASELINE, entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT,
      entryGate: (tClose) => { const r = asOf(tClose); return Number.isFinite(r) && r < threshold; },
    });
  };

  const perAsset = datasets.map((d) => ({ symbol: d.symbol, train: run(d, false), holdout: run(d, true) }));
  const train = summarize(perAsset.map((p) => p.train));

  const trainGate = { avgRMin: -0.50, tradesMin: 150, avgRPass: train.avgR > -0.50, tradesPass: train.trades >= 150 };
  trainGate.passed = trainGate.avgRPass && trainGate.tradesPass;

  if (!trainGate.passed) {
    return {
      input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
      result: {
        train, trainGate, holdout: null, holdoutGate: null,
        perAsset: perAsset.map(({ symbol, train }) => ({ symbol, train: { trades: train.trades, avgR: train.avgR } })),
        verdict: "TRAIN-GATE-FAIL: holdout not examined (pre-registered gate is immutable once the test begins)",
      },
    };
  }

  const holdout = summarize(perAsset.map((p) => p.holdout));
  const holdoutGate = {
    avgRMin: -0.30, tradesMin: 100, positiveFracMin: 0.40,
    avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 100,
    positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
  };
  holdoutGate.passed = holdoutGate.avgRPass && holdoutGate.tradesPass && holdoutGate.positiveFracPass;

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      train, trainGate, holdout, holdoutGate,
      perAsset: perAsset.map(({ symbol, train, holdout }) => ({ symbol, train: { trades: train.trades, avgR: train.avgR }, holdout: { trades: holdout.trades, avgR: holdout.avgR } })),
      verdict: holdoutGate.passed
        ? "FUNDING-MEANREV clears the pre-registered holdout gate; paper trading only"
        : "FUNDING-MEANREV FAIL: holdout did not clear the pre-registered gate",
    },
  };
}

if (process.argv[1]?.endsWith("funding-meanrev.mjs")) {
  const report = await runFundingMeanRevStudy();
  const saved = saveExperiment("funding-meanrev", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
