/**
 * MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC: "are losing trades stopped out just before reverting,
 * or do they run straight to the stop and beyond?" Never measured before this item — the two
 * cases have opposite implications for whether stop placement is the problem, and both are
 * currently invisible inside the aggregate avgR.
 *
 * Diagnostic only. Does NOT change any stop/target parameter and does not recommend a
 * replacement value — that is a standing prohibition on the negative-EV baselines this
 * project has already closed out (see COST-SENSITIVITY-SURFACE / signal-decay items). This
 * item only reports the distributions.
 *
 * DATA SOURCE: backtestMultiTF's new per-trade `excursions` array (backtest.js), one
 * {r, mae, mfe} record per closed trade — mae/mfe are the worst/best unrealized R the
 * position saw (bars strictly after the entry bar, floored at 0), tracked alongside the
 * existing entry/exit simulation so every entryMode's real fill/stop/target/breakeven/trail
 * logic governs the walk (no separate re-simulation, unlike backtest.js's `excursionProfile`,
 * which runs its own first-passage grid on synthetic ATR-multiple stops rather than the
 * actual baseline configs).
 *
 * METHOD: exact `breakout`/`anticipate` baseline configs from tournament.mjs's `families`
 * table (same duplication convention as signal-decay-temporal-stability.mjs's BASELINES —
 * tournament.mjs does not export `families`), holdout only (split=.70, same as every gated
 * verdict in this series), so the trade population matches the pooled holdout avgR figures
 * quoted throughout ROADMAP.md/VERDICTS.md. Excursions are pooled across all eligible
 * watchlist assets and split winners (r>0) vs losers (r<=0).
 *
 * FAILURE-SHAPE CALL: for losers only, bucket by mfe against a fixed 0.5R threshold decided
 * BEFORE looking at results. mfe>=0.5R means the trade got at least halfway to breakeven-ish
 * favorable territory before reversing and stopping out (a "near miss" — stop placement or
 * exit timing is plausibly implicated). mfe<0.5R means the trade barely moved in its favor
 * before running to the stop (the entry thesis itself looks wrong, not the stop distance).
 * Whichever bucket holds the majority of losers is reported as the dominant shape.
 */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

// Exact baseline configs from tournament.mjs's `families` table (unmodified) — same
// duplication convention as signal-decay-temporal-stability.mjs's BASELINES, chosen there
// over widening tournament.mjs's export surface for an internal, unexported array.
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

const NEAR_MISS_MFE_R = 0.5; // fixed before looking at any result — see module docstring

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

/** tournament.mjs's splitSeries, duplicated (not exported there) — cut by time boundary
 * on the anchor 1h timeframe's index, applied to every timeframe by candle .time. */
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function distSummary(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, p25: null, p50: null, p75: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return { n, mean, p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) };
}

export async function runMaeMfeStopPlacementDiagnostic({
  watchlist = loadWatchlist(), split = 0.70, minCandles = 250, nearMissMfeR = NEAR_MISS_MFE_R,
} = {}) {
  const coverage = [];
  const eligible = [];
  for (const asset of normalize(watchlist)) {
    const s = seriesFor(asset.id);
    if (!s.every((tf) => tf.candles.length >= minCandles)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
    eligible.push({ symbol: asset.symbol, holdout: splitSeries(s, split, true) });
    coverage.push({ symbol: asset.symbol, included: true });
  }

  const baseInput = { specification: "mae-mfe-stop-placement-diagnostic/v1", split, minCandles, nearMissMfeR, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "MAE-MFE-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const all = [];
    for (const d of eligible) {
      const r = backtestMultiTF({ series: d.holdout }, { ...BASELINES[target], entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT });
      all.push(...r.excursions);
    }

    const winners = all.filter((x) => x.r > 0);
    const losers = all.filter((x) => x.r <= 0);
    const nearMiss = losers.filter((x) => x.mfe >= nearMissMfeR).length;
    const ranStraight = losers.length - nearMiss;

    families[target] = {
      trades: all.length,
      winners: { count: winners.length, mae: distSummary(winners.map((x) => x.mae)), mfe: distSummary(winners.map((x) => x.mfe)) },
      losers: { count: losers.length, mae: distSummary(losers.map((x) => x.mae)), mfe: distSummary(losers.map((x) => x.mfe)) },
      failureShape: {
        nearMissMfeR,
        nearMiss,                                  // losers.mfe >= threshold: got meaningfully favorable before reversing
        ranStraight,                                // losers.mfe < threshold: barely moved in its favor before the stop
        nearMissShare: losers.length ? nearMiss / losers.length : null,
        dominant: losers.length === 0
          ? "NO-LOSERS"
          : nearMiss > ranStraight
          ? "NEAR-MISS (stopped out just before reverting favorably)"
          : "RAN-STRAIGHT-TO-STOP (little favorable movement before the loss)",
      },
    };
  }

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: "MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC: descriptive excursion diagnostic only, no gate (this item's own done_when). No stop/target parameter changed and no replacement value recommended anywhere.",
    },
  };
}

if (process.argv[1]?.endsWith("mae-mfe-stop-placement-diagnostic.mjs")) {
  const report = await runMaeMfeStopPlacementDiagnostic();
  const saved = saveExperiment("mae-mfe-stop-placement-diagnostic", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
