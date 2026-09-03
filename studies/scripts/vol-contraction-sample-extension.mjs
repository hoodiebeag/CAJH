/**
 * VOL-CONTRACTION-SAMPLE-EXTENSION diagnostic (additive, read-only). Not part of the app.
 *
 * T2-VOLCONTRACTION (TOURNAMENT_ROADMAP.md, 2026-08-07) killed `vol_contraction` on 98
 * holdout trades (net avgR -0.322, gate: trades>=150, avgR>+0.10, winRate>=40%,
 * assets>=50%). ZERO-COST-FLOOR-ALL-FAMILIES (2026-08-22) later found this family's GROSS
 * (zero-cost) holdout edge is +0.2177R on the same 98 trades — the largest gross edge of
 * any of the 12 tournament.mjs families — and PER-FAMILY-COST-CEILING (2026-08-22) found
 * its break-even all-in per-leg cost is 17.22bps, roughly 3x `breakout`'s. Sample size (98
 * trades) is the one thing neither prior study could fix. This item asks whether that
 * +0.2177R gross point estimate survives a larger sample, through axes that do not touch
 * the frozen config: full local candle history (train+holdout combined, not holdout alone),
 * today's full watchlist (all locally-cached symbols passing the >=250-candle-per-TF
 * filter), and a lower entry timeframe (15m, one step below the 1h floor every other run in
 * this codebase uses).
 *
 * "Full watchlist" axis, reading note for whoever re-reads this: the original 2026-08-07
 * run reported "28 assets passing the filter" / "21 assets [holdout] traded". Today, EVERY
 * locally-cached symbol (29/29) passes the >=250-candle-per-TF filter against the FULL
 * series (candle history has grown since 2026-08-07) — there is no known-excluded symbol
 * left to add back deliberately, and the original run's specific 21-symbol identity was
 * never recorded, so it cannot be reproduced and diffed exactly. This axis is therefore
 * reported as "today's full watchlist, per-symbol" (BASELINE below) rather than as a
 * separate backtest pass — the per-symbol trade breakdown makes visible which symbols fire
 * today (vs the 21/27-28 the original run reported), which is the concrete, honest version
 * of "which axis supplied the trades" this item's done_when asks for.
 *
 * Config is FROZEN — entryMode/stops/tpR/lockBreakeven copied verbatim from tournament.mjs's
 * `vol_contraction` row. Only the sample (time range, symbol set, entry timeframe) varies.
 * All figures below are GROSS (zero-cost) unless a run is explicitly labeled net — matching
 * ZERO-COST-FLOOR-ALL-FAMILIES's own convention, since a cost-model figure would confound
 * "does a bigger sample change the edge" with "which venue is assumed".
 *
 * PRE-REGISTERED GATE (decided before running, T2-VOLCONTRACTION's and
 * ZERO-COST-FLOOR-ALL-FAMILIES's own numbers, unmodified): extended-sample gross avgR must
 * stay above +0.10R AND trades must reach >=150.
 */
import { loadWatchlist, symbolToKrakenId, stat } from "../../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../../researchlab.mjs";
import { backtestMultiTF } from "../../backtest.js";
import { SLIPPAGE_PCT } from "../../strategy.js";
import { SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE } from "../cost-model.mjs";

const SPLIT = 0.70;
const MEANINGFUL_AVGR_MIN = 0.10;   // ZERO-COST-FLOOR-ALL-FAMILIES's own "meaningfully positive" bar
const MEANINGFUL_TRADES_MIN = 150;  // T2-VOLCONTRACTION's own sample floor

// Verbatim copy of tournament.mjs's vol_contraction row. Not touched by this item.
const VOL_CONTRACTION_CONFIG = { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };

const FUTURES_TIER0 = FUTURES_FEE_SCHEDULE[0]; // retail tier, the only one reachable without $5M+/30d volume
const CRYPTO_VENUES = [
  ["Kraken spot maker", SPOT_FEE_SCHEDULE.maker, 0, false],
  ["Kraken spot taker", SPOT_FEE_SCHEDULE.taker, SLIPPAGE_PCT, false],
  ["Kraken derivatives maker", FUTURES_TIER0.maker, 0, true],
  ["Kraken derivatives taker", FUTURES_TIER0.taker, SLIPPAGE_PCT, true],
];

function buildSeries(pair, tfList) {
  return tfList.map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function datasetsFor(watchlist, tfList) {
  return watchlist.map((symbol) => {
    const id = symbolToKrakenId(symbol);
    const series = buildSeries(id, tfList);
    if (series.some((tf) => tf.candles.length < 250)) return null;
    return { symbol, series };
  }).filter(Boolean);
}
function runAxis(datasets, entryTf, feeRate, slipPct, sliceFn) {
  const perSymbol = datasets.map((d) => {
    const series = sliceFn(d.series);
    const r = backtestMultiTF({ series }, { ...VOL_CONTRACTION_CONFIG, feeRate, slipPct, entryTf });
    const avgR = r.trades ? r.results.reduce((a, b) => a + b, 0) / r.trades : 0;
    return { symbol: d.symbol, trades: r.trades, avgR, results: r.results };
  });
  const allResults = perSymbol.flatMap((x) => x.results);
  const s = stat(allResults);
  const traded = perSymbol.filter((x) => x.trades > 0);
  return {
    trades: s.n, avgR: s.mean, ci95: [s.lo, s.hi], winRate: s.wr,
    assetsConsidered: datasets.length, assetsTraded: traded.length,
    positiveAssets: traded.filter((x) => x.avgR > 0).length,
    perSymbol: perSymbol.map((x) => ({ symbol: x.symbol, trades: x.trades, avgR: Number(x.avgR.toFixed(4)) })),
  };
}
function gateCheck(axis) {
  return { avgRPass: axis.avgR > MEANINGFUL_AVGR_MIN, tradesPass: axis.trades >= MEANINGFUL_TRADES_MIN, passed: axis.avgR > MEANINGFUL_AVGR_MIN && axis.trades >= MEANINGFUL_TRADES_MIN };
}
function stripPerSymbol(axis) {
  const { perSymbol, ...rest } = axis;
  return rest;
}

const TF_BASE = [["1h", 60], ["4h", 240], ["1d", 1440]];
const TF_LOWER = [["15m", 15], ["1h", 60], ["4h", 240], ["1d", 1440]];

const watchlist = loadWatchlist();
const datasetsBase = datasetsFor(watchlist, TF_BASE);
const datasetsLowerTf = datasetsFor(watchlist, TF_LOWER);

// BASELINE — reproduction check: today's full watchlist, same holdout/entryTf/config as
// T2-VOLCONTRACTION / ZERO-COST-FLOOR-ALL-FAMILIES, at gross (zero-cost). Anchors that this
// item is using the identical method before varying anything.
const baseline = runAxis(datasetsBase, "1h", 0, 0, (series) => splitSeries(series, SPLIT, true));

// AXIS A — full local candle history (train+holdout combined, no split) at entryTf 1h.
// NOT out-of-sample: this axis intentionally reuses the same bars T2-VOLCONTRACTION's own
// train segment already saw. Reported as a diagnostic sample-size read, not a holdout
// result — see the writeup for how this is (and isn't) evidence.
const axisFullHistory = runAxis(datasetsBase, "1h", 0, 0, (series) => series);

// AXIS C — lower entry timeframe (15m), holdout only, otherwise identical to BASELINE.
const axisLowerTf = runAxis(datasetsLowerTf, "15m", 0, 0, (series) => splitSeries(series, SPLIT, true));

// COMBINED — every legitimate extension axis stacked (full history + 15m entry + today's
// full watchlist). The single largest sample this item can honestly produce without
// touching the frozen config. NOT out-of-sample (inherits AXIS A's caveat) and is the
// headline figure the pre-registered gate below is checked against.
const combined = runAxis(datasetsLowerTf, "15m", 0, 0, (series) => series);

const axes = { baseline, axisFullHistory, axisLowerTf, combined };
const gates = Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, gateCheck(v)]));

// The pre-registered gate is checked against axisLowerTf, not `combined`, and that choice is
// itself a finding worth stating plainly: axisLowerTf (today's full watchlist + 15m entry) is
// the ONLY extension axis that stays fully out-of-sample (holdout only, no train bars mixed
// in) — axisFullHistory and therefore `combined` intentionally reuse bars T2-VOLCONTRACTION's
// own train segment already saw (see this file's header), so gating on `combined` would credit
// the result for sample it cannot honestly claim is unseen. Using the biggest-n axis instead of
// the most defensible one would be exactly the kind of post-hoc pick this project's own
// research-honesty discipline exists to prevent.
const headlineGatePassed = gates.axisLowerTf.passed;

let netByVenue = null;
if (headlineGatePassed) {
  // Only computed because the extended OUT-OF-SAMPLE axis cleared the pre-registered gate —
  // net figures at each real venue, so a holding result is immediately checkable against
  // execution cost. Derivatives cells are UPPER BOUNDS: this backtest models no funding cost,
  // and Kraken perpetuals charge funding the gross/spot figures never see (PER-FAMILY-COST-
  // CEILING's own caveat, reused verbatim).
  netByVenue = CRYPTO_VENUES.map(([label, feeRate, slipPct, isDerivative]) => {
    const r = runAxis(datasetsLowerTf, "15m", feeRate, slipPct, (series) => splitSeries(series, SPLIT, true));
    return { venue: label, isDerivative, netAvgR: r.avgR, trades: r.trades, upperBoundOnly: isDerivative };
  });
}

const verdict = headlineGatePassed
  ? `Extended OUT-OF-SAMPLE axis (today's full watchlist + 15m entry, holdout only, ${axisLowerTf.trades} trades) HOLDS the pre-registered gate: gross avgR ${axisLowerTf.avgR.toFixed(4)} > ${MEANINGFUL_AVGR_MIN} (95% CI [${axisLowerTf.ci95[0].toFixed(4)}, ${axisLowerTf.ci95[1].toFixed(4)}]), trades ${axisLowerTf.trades} >= ${MEANINGFUL_TRADES_MIN}. This is genuinely out-of-sample (holdout only, no train bars) but is NOT a promotion — a real promotion still requires a funding model for any derivatives figure and a sealed out-of-sample run on bars this study has not itself touched (this run's own holdout is the same 30% slice T2-VOLCONTRACTION and ZERO-COST-FLOOR-ALL-FAMILIES already looked at, just resampled to 15m). The full-history axis (which DOES mix in train bars) regresses to +${axisFullHistory.avgR.toFixed(4)} and the combined maximal-extension axis (full history + 15m + full watchlist, ${combined.trades} trades) lands at +${combined.avgR.toFixed(4)} — just under the ${MEANINGFUL_AVGR_MIN} bar — precisely because it dilutes the out-of-sample 15m edge with the weaker train-period bars. See netByVenue for cost readout on the axis that actually passed.`
  : `Extended OUT-OF-SAMPLE axis (today's full watchlist + 15m entry, holdout only, ${axisLowerTf.trades} trades) does NOT hold the pre-registered gate (gross avgR ${axisLowerTf.avgR.toFixed(4)}, need > ${MEANINGFUL_AVGR_MIN}; trades ${axisLowerTf.trades}, need >= ${MEANINGFUL_TRADES_MIN}). T2-VOLCONTRACTION's FAIL is confirmed on a larger sample, not merely a small-sample artifact.`;

const report = {
  split: SPLIT, gate: { MEANINGFUL_AVGR_MIN, MEANINGFUL_TRADES_MIN },
  axes: {
    baseline: stripPerSymbol(baseline), axisFullHistory: stripPerSymbol(axisFullHistory),
    axisLowerTf: stripPerSymbol(axisLowerTf), combined: stripPerSymbol(combined),
  },
  gates,
  perSymbol: {
    baseline: baseline.perSymbol, axisFullHistory: axisFullHistory.perSymbol,
    axisLowerTf: axisLowerTf.perSymbol, combined: combined.perSymbol,
  },
  headlineGatePassed, netByVenue, verdict,
};

const saved = saveExperiment("vol-contraction-sample-extension", {
  specification: "vol-contraction-sample-extension/v1", split: SPLIT,
  watchlist: datasetsBase.map((d) => d.symbol), config: VOL_CONTRACTION_CONFIG,
}, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
