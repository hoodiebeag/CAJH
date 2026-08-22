/**
 * ZERO-COST-FLOOR-ALL-FAMILIES diagnostic (throwaway, read-only). Not part of the app.
 *
 * COST-COMPONENT-ATTRIBUTION (2026-08-19) measured the zero-fee floor for two families only
 * (breakout +0.0091R, anticipate -0.1331R). This applies the exact same linear re-derivation
 * to all 12 families currently defined in tournament.mjs's `families` array, on the same
 * holdout, to answer a single binary question: does ANY family in this codebase carry
 * meaningfully positive gross (zero-cost) edge?
 *
 * Overlaps with T1-ZEROCOST (TOURNAMENT_ROADMAP.md, 2026-08-06/07), which already reported
 * zero-cost holdout avgR for 11 of these 12 families. This item is justified only by what it
 * adds beyond that prior run:
 *   1. `range_sweep_reclaim` and `vol_contraction` did not exist at T1's time — never
 *      zero-cost tested until now.
 *   2. T1 predates FEE-SCHEDULE-REBASE. Zero-cost numbers are cost-basis-independent by
 *      construction (feeRate=0, slipPct=0 either way), so this is a consistency check, not
 *      expected to move the gross figures for the 10 overlapping families — but the
 *      NET-of-cost comparison figures reported here use the corrected post-rebase basis,
 *      which T1's table did not.
 *   3. COST-COMPONENT-ATTRIBUTION's exact fee/slip decomposition (reconciling to net within
 *      1e-9) did not exist as a method at T1's time and is applied here to all 12 families,
 *      not just breakout/anticipate.
 *
 * Method — exact linear decomposition, identical to cost-component-attribution.mjs:
 *   backtest.js's net-R formula is affine in feeRate/slipPct with a per-trade coefficient
 *   that does not itself depend on either (FEE-SCHEDULE-REBASE: cost never changes which
 *   trades fire). Four backtest passes per family (zero-cost, fee-only, slip-only, net
 *   default) recover feeDrag and slipDrag exactly, without touching backtest.js.
 *
 * No cost parameter is changed anywhere; this only reads out results at parameter values
 * the code already supports. No production file touched.
 */
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const SPLIT = 0.70;

// Verbatim copy of tournament.mjs's `families` array (not exported there, same convention
// COST-COMPONENT-ATTRIBUTION's script already used for the same reason).
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["bos", { entryMode: "bos", trendGate: true, trendGateMode: "ma", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["support", { entryMode: "support", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["ma_dip", { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rsi", { entryMode: "rsi", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rev", { entryMode: "rev", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["trend_pullback", { entryMode: "trend_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["sweep_reclaim", { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["range_sweep_reclaim", { entryMode: "range_sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["h3", { entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["vol_contraction", { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

// Pre-registered "meaningfully positive" gate — decided before running any of the 10 families
// whose gross holdout figure isn't already known (breakout/anticipate are already sealed from
// COST-COMPONENT-ATTRIBUTION). Reuses runTournament's own promotion-bar shape (holdout
// trades>=150 per T5-DECAY-EXIT's sample floor, positiveAssets/assets>=0.5 per runTournament's
// own `promoted` convention) but raises the avgR bar from ">0" (any edge) to ">+0.10"
// (a "material R" scale already used elsewhere in this codebase, e.g. scoreRegimeGate's
// avgRMin=-0.10 in tournament.mjs) — chosen because COST-COMPONENT-ATTRIBUTION already showed
// a positive-but-sub-0.01R gross edge ("razor-thin, one-basis-point-scale") does not survive
// any real execution friction; +0.10R is an order of magnitude above that floor.
const MEANINGFUL_AVGR_MIN = 0.10;
const MEANINGFUL_TRADES_MIN = 150;
const MEANINGFUL_ASSET_SHARE_MIN = 0.5;

const COST_CONFIGS = [
  ["gross (zero-cost)", { feeRate: 0, slipPct: 0 }],
  ["fee-only", { feeRate: FEE_RATE, slipPct: 0 }],
  ["slip-only", { feeRate: 0, slipPct: SLIPPAGE_PCT }],
  ["net (default, fee+slip)", { feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT }],
];

function seriesFor(pair) {
  return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function summarize(perAsset) {
  const results = perAsset.flatMap((x) => x.results || []);
  const assets = perAsset.filter((x) => x.trades > 0);
  const avgR = results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0;
  return {
    trades: results.length, avgR, totalR: results.reduce((a, b) => a + b, 0),
    assets: assets.length, positiveAssets: assets.filter((x) => x.avgR > 0).length,
  };
}

const watchlist = loadWatchlist();
const datasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const TOLERANCE = 1e-9;
const report = { split: SPLIT, assetsConsidered: datasets.length, gate: { MEANINGFUL_AVGR_MIN, MEANINGFUL_TRADES_MIN, MEANINGFUL_ASSET_SHARE_MIN }, families: {} };

for (const [famId, config] of FAMILIES) {
  const perAssetByCost = {};
  for (const [costLabel, costOverride] of COST_CONFIGS) {
    perAssetByCost[costLabel] = datasets.map((d) => {
      const r = backtestMultiTF({ series: d.holdout }, { ...config, ...costOverride, entryTf: "1h" });
      const avgR = r.trades ? r.results.reduce((a, b) => a + b, 0) / r.trades : 0;
      return { symbol: d.symbol, trades: r.trades, avgR, totalR: r.totalR, results: r.results };
    });
  }

  const pooled = {};
  for (const [costLabel] of COST_CONFIGS) pooled[costLabel] = summarize(perAssetByCost[costLabel]);

  const gross = pooled["gross (zero-cost)"];
  const feeOnly = pooled["fee-only"];
  const slipOnly = pooled["slip-only"];
  const net = pooled["net (default, fee+slip)"];

  const feeDragAvgR = gross.avgR - feeOnly.avgR;
  const slipDragAvgR = gross.avgR - slipOnly.avgR;
  const reconstructedNetAvgR = gross.avgR - feeDragAvgR - slipDragAvgR;
  const reconciliationDiscrepancy = reconstructedNetAvgR - net.avgR;

  // Trade-count invariance check (FEE-SCHEDULE-REBASE's claim that cost never changes which
  // trades fire) — should hold identically across all four cost configs for every family.
  const tradeCountsMatch = [gross.trades, feeOnly.trades, slipOnly.trades, net.trades].every((t) => t === net.trades);

  const meaningful = gross.avgR > MEANINGFUL_AVGR_MIN && gross.trades >= MEANINGFUL_TRADES_MIN
    && gross.positiveAssets / Math.max(1, gross.assets) >= MEANINGFUL_ASSET_SHARE_MIN;

  report.families[famId] = {
    trades: net.trades,
    tradeCountsMatch,
    pooled: { gross, feeOnly, slipOnly, net },
    attribution: {
      grossAvgR: gross.avgR,
      feeDragAvgR,
      slipSpreadDragAvgR: slipDragAvgR,
      netAvgR: net.avgR,
      reconstructedNetAvgR,
      reconciliationDiscrepancy,
      withinTolerance: Math.abs(reconciliationDiscrepancy) < TOLERANCE,
    },
    meaningfullyPositiveGrossEdge: meaningful,
  };
}

const anyMeaningful = Object.entries(report.families).filter(([, f]) => f.meaningfullyPositiveGrossEdge).map(([id]) => id);
report.verdict = anyMeaningful.length
  ? `Meaningfully positive gross edge (avgR>${MEANINGFUL_AVGR_MIN}, trades>=${MEANINGFUL_TRADES_MIN}, positiveAssetShare>=${MEANINGFUL_ASSET_SHARE_MIN}) in: ${anyMeaningful.join(", ")}`
  : `No family clears meaningfully positive gross edge (avgR>${MEANINGFUL_AVGR_MIN}, trades>=${MEANINGFUL_TRADES_MIN}, positiveAssetShare>=${MEANINGFUL_ASSET_SHARE_MIN}) at zero cost.`;

const saved = saveExperiment("zero-cost-floor-all-families", { specification: "zero-cost-floor-all-families/v1", split: SPLIT, watchlist: datasets.map((d) => d.symbol), families: FAMILIES.map(([id]) => id) }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
