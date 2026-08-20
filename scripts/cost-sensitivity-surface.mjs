/**
 * COST-SENSITIVITY-SURFACE diagnostic (throwaway, read-only). Not part of the app — maps net
 * avgR for the breakout/anticipate holdout BASELINE families (tournament.mjs's exact `families`
 * config, standard 70/30 split, no gate/filter — the same config COST-COMPONENT-ATTRIBUTION and
 * HOLDING-PERIOD-COST-AMORTIZATION-MAP already used) across a 2-D grid of (fee rate x slippage
 * assumption), then checks whether any grid point would flip a prior recorded FAIL/KILLED
 * verdict. Scope explicitly does NOT re-derive PHASE2-MAX-SURVIVABLE-COST's 4 already-covered
 * cost-killed signals (Classifier P5, CLASSIFIER-FUNDING-FEATURE, B5-REVERSAL,
 * T4-PORTFOLIO-MOMENTUM) — see work_queue note.
 *
 * Method — exact linear decomposition, reusing COST-COMPONENT-ATTRIBUTION's already-verified
 * identity: backtest.js's net-R formula is `netR = grossR - (feeRate+slipPct)*(entry+exitPx)/risk`
 * (backtest.js:566 et al.) — affine in feeRate/slipPct with a per-trade coefficient that does
 * NOT itself depend on feeRate/slipPct, and cost never changes which trades fire (established by
 * FEE-SCHEDULE-REBASE, re-verified per-symbol by HOLDING-PERIOD-COST-AMORTIZATION-MAP). That
 * means netAvgR is an EXACT linear function of (feeRate, slipPct):
 *   netAvgR(fee, slip) = grossAvgR - feeUnitDragAvgR*fee - slipUnitDragAvgR*slip
 * where feeUnitDragAvgR = (grossAvgR - feeOnlyAvgR)/FEE_RATE and slipUnitDragAvgR likewise —
 * both computed once from 3 backtest passes (gross, fee-only, slip-only), then used to evaluate
 * the entire grid WITHOUT re-running backtest at every cell. Two grid corners are independently
 * re-run through backtest.js directly and checked against the analytic formula (tolerance 1e-9)
 * to catch any hidden non-linearity before trusting the extrapolation.
 *
 * Grid axes are named real venues, not arbitrary numbers — from cost-model.mjs's verified fee
 * schedule (SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE, both re-verified 2026-08-13) and
 * strategy.js's own FEE_RATE/SLIPPAGE_PCT defaults:
 *   fee axis:  0.00020 (futures maker, best tier) / 0.00050 (futures taker, best tier)
 *              / 0.0040 (spot maker) / 0.0080 (spot taker — current default, strategy.js FEE_RATE)
 *   slip axis: 0 (resting maker limit fill, no spread-crossing) / 0.00025 (half current) /
 *              0.0005 (current default, strategy.js SLIPPAGE_PCT, market-fill taker assumption)
 * Slippage's low end is 0 rather than a negative "rebate" figure: SLIPPAGE_PCT is documented as
 * a market-fill cost proxy, and a resting maker limit order that gets filled doesn't cross the
 * spread — but per COST-COMPONENT-ATTRIBUTION's own header note, PWR5's calibrated
 * adverse-selection add-on for RESTING maker fills (~0.12%/side) has nothing to attach to here
 * since this baseline uses default market/taker fills; not fabricated onto this grid.
 *
 * Verdict-flip check: since both drag coefficients are >= 0 (higher fee/slip can only reduce
 * avgR, confirmed below), netAvgR is monotonic in both axes — maximized at the single
 * lowest-cost corner (futures maker, 0 slip) and minimized at the highest-cost corner (spot
 * taker, default slip). So "does any point on the grid flip a FAIL to PASS" reduces to a single
 * check: does the best-case corner exceed 0. The full grid is still computed and reported for
 * transparency, not just the two corners.
 */
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";
import { SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE } from "../cost-model.mjs";

const SPLIT = 0.70;

// Exact family configs from tournament.mjs's `families` array (breakout, anticipate rows) —
// duplicated here rather than imported because tournament.mjs's `families` isn't exported;
// values copied verbatim from cost-component-attribution.mjs, not re-derived.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

const FUTURES_TIER0 = FUTURES_FEE_SCHEDULE[0]; // retail tier, the only one a real account without $5M+/30d volume can reach

const FEE_POINTS = [
  ["futures maker (retail tier)", FUTURES_TIER0.maker],   // 0.00020
  ["futures taker (retail tier)", FUTURES_TIER0.taker],   // 0.00050
  ["spot maker", SPOT_FEE_SCHEDULE.maker],                 // 0.0040
  ["spot taker (current default)", FEE_RATE],              // 0.0080
];
const SLIP_POINTS = [
  ["0 (resting maker fill)", 0],
  ["half current", SLIPPAGE_PCT / 2],
  ["current default (market fill)", SLIPPAGE_PCT],
];

function seriesFor(pair) {
  return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function pooledAvgR(perAsset) {
  const results = perAsset.flatMap((x) => x.results || []);
  return { trades: results.length, avgR: results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0 };
}
function runAt(datasets, config, feeRate, slipPct) {
  const perAsset = datasets.map((d) => {
    const r = backtestMultiTF({ series: d.holdout }, { ...config, feeRate, slipPct, entryTf: "1h" });
    return { symbol: d.symbol, results: r.results };
  });
  return pooledAvgR(perAsset);
}

const watchlist = loadWatchlist();
const datasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const TOLERANCE = 1e-9;
const report = { split: SPLIT, assetsConsidered: datasets.length, feeAxis: FEE_POINTS, slipAxis: SLIP_POINTS, families: {} };

for (const [famId, config] of FAMILIES) {
  const gross = runAt(datasets, config, 0, 0);
  const feeOnly = runAt(datasets, config, FEE_RATE, 0);
  const slipOnly = runAt(datasets, config, 0, SLIPPAGE_PCT);
  const netDefault = runAt(datasets, config, FEE_RATE, SLIPPAGE_PCT);

  const feeUnitDragAvgR = (gross.avgR - feeOnly.avgR) / FEE_RATE;
  const slipUnitDragAvgR = (gross.avgR - slipOnly.avgR) / SLIPPAGE_PCT;
  const analytic = (fee, slip) => gross.avgR - feeUnitDragAvgR * fee - slipUnitDragAvgR * slip;

  // Reconciliation: analytic formula at the default point must exactly match the direct rerun.
  const reconDefault = analytic(FEE_RATE, SLIPPAGE_PCT) - netDefault.avgR;

  // Spot-check the two extreme grid corners directly through backtest.js (not just the analytic
  // formula) to catch any non-linearity the 3-pass decomposition alone wouldn't reveal.
  const lowCornerFee = FEE_POINTS[0][1], lowCornerSlip = SLIP_POINTS[0][1];
  const highCornerFee = FEE_POINTS[FEE_POINTS.length - 1][1], highCornerSlip = SLIP_POINTS[SLIP_POINTS.length - 1][1];
  const lowCornerDirect = runAt(datasets, config, lowCornerFee, lowCornerSlip);
  const highCornerDirect = runAt(datasets, config, highCornerFee, highCornerSlip);
  const lowCornerAnalytic = analytic(lowCornerFee, lowCornerSlip);
  const highCornerAnalytic = analytic(highCornerFee, highCornerSlip);
  const lowCornerDiscrepancy = lowCornerAnalytic - lowCornerDirect.avgR;
  const highCornerDiscrepancy = highCornerAnalytic - highCornerDirect.avgR;

  const grid = FEE_POINTS.map(([feeLabel, fee]) =>
    SLIP_POINTS.map(([slipLabel, slip]) => ({ feeLabel, fee, slipLabel, slip, netAvgR: analytic(fee, slip) }))
  ).flat();

  const bestCase = grid.reduce((a, b) => (b.netAvgR > a.netAvgR ? b : a));
  const worstCase = grid.reduce((a, b) => (b.netAvgR < a.netAvgR ? b : a));

  report.families[famId] = {
    trades: netDefault.trades,
    grossAvgR: gross.avgR,
    feeOnlyAvgR: feeOnly.avgR,
    slipOnlyAvgR: slipOnly.avgR,
    netDefaultAvgR: netDefault.avgR,
    feeUnitDragAvgR,
    slipUnitDragAvgR,
    reconDefault, reconDefaultWithinTolerance: Math.abs(reconDefault) < TOLERANCE,
    lowCornerDirectAvgR: lowCornerDirect.avgR, lowCornerAnalytic, lowCornerDiscrepancy,
    lowCornerWithinTolerance: Math.abs(lowCornerDiscrepancy) < TOLERANCE,
    highCornerDirectAvgR: highCornerDirect.avgR, highCornerAnalytic, highCornerDiscrepancy,
    highCornerWithinTolerance: Math.abs(highCornerDiscrepancy) < TOLERANCE,
    grid,
    bestCase, worstCase,
    anyGridPointPositive: grid.some((c) => c.netAvgR > 0),
  };
}

const saved = saveExperiment("cost-sensitivity-surface", { specification: "cost-sensitivity-surface/v1", split: SPLIT, watchlist: datasets.map((d) => d.symbol) }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
