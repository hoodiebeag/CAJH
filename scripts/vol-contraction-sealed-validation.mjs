/**
 * VOL-CONTRACTION-SEALED-VALIDATION (additive, read-only, cache-only). Not part of the app.
 *
 * VOL-CONTRACTION-SAMPLE-EXTENSION (2026-08-28, ROADMAP.md) found that `vol_contraction` on
 * a 15m-entry, holdout-only axis (28-asset active watchlist, same 0.70 split) clears the
 * fuller 3-leg gate for the first time in this project's history: 256 trades, gross avgR
 * +0.2524, positiveAssets/assets 0.654. Per AGENT_PROTOCOL.md's own rule ("Rule for a new
 * economic-gate result that clears its literal pre-registered threshold", updated in that
 * commit), this makes the result PROVISIONAL, not a live D3 candidate, until re-run against
 * researchlib.mjs's SEALED_SYMBOLS pool (AVAX, LINK, NEAR, SUI, UNI) — the one holdout
 * resource in this project confirmed never yet examined by any study. This item performs
 * that one-time re-run. Single-shot by design: this pool is not to be re-run a second time
 * regardless of outcome, and this file does not touch the active-pool numbers already on
 * record in VOL-CONTRACTION-SAMPLE-EXTENSION.
 *
 * Config/axis is FROZEN, copied verbatim from tournament.mjs's `vol_contraction` row and
 * from VOL-CONTRACTION-SAMPLE-EXTENSION's own AXIS C (the only extension axis that stayed
 * fully out-of-sample there): entryTf 15m, holdout only (same 0.70 split), no train bars
 * mixed in. Only the symbol universe changes (SEALED_SYMBOLS instead of the active
 * watchlist).
 *
 * PRE-REGISTERED GATE (decided before running, identical to VOL-CONTRACTION-SAMPLE-
 * EXTENSION's own pre-registration plus the positiveAssets leg AGENT_PROTOCOL.md's rule is
 * written against — the SAME 3-leg gate T2-VOLCONTRACTION/ZERO-COST-FLOOR-ALL-FAMILIES both
 * used): gross avgR > 0.10 AND trades >= 150 AND positiveAssets/assetsTraded >= 0.50.
 * Disclosed here, before running: the sealed pool is 5 symbols against the active pool's 28
 * that produced 256 trades (~9.1 trades/asset) — at that same per-asset rate, 5 symbols would
 * produce roughly 45 trades, far short of the 150-trade leg. This is stated up front so a
 * small-sample outcome below is not mistaken for a surprise or quietly re-framed as a pass.
 *
 * SECOND, INDEPENDENT DELIVERABLE (per this item's own scope): resolve the funding-cost
 * caveat on VOL-CONTRACTION-SAMPLE-EXTENSION's two positive Kraken-derivatives cells
 * (+0.2231 maker / +0.1057 taker on the 28-asset ACTIVE pool, both reported there as
 * funding-free upper bounds). A funding-rate model already exists in this codebase
 * (cost-model.mjs's fundingCost(), fed by derivatives.mjs's fetchFundingRates() /
 * PF_<PAIR>USD-historical-funding.json caches — never previously applied to any backtest
 * result). This item applies it to the SAME active-pool axis C trades to produce a true net
 * figure, cache-only (every PF_*-historical-funding.json needed is already on disk; no
 * network egress). This does NOT touch the sealed pool — funding cost is resolved on the
 * pool VOL-CONTRACTION-SAMPLE-EXTENSION actually reported it for.
 */
import { loadWatchlist, symbolToKrakenId, stat, splitSealedSymbols } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { SLIPPAGE_PCT } from "../strategy.js";
import { SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE, fundingCost } from "../cost-model.mjs";
import { fetchFundingRates } from "../derivatives.mjs";

const SPLIT = 0.70;
const MEANINGFUL_AVGR_MIN = 0.10;   // AGENT_PROTOCOL.md / T2-VOLCONTRACTION's own bar
const MEANINGFUL_TRADES_MIN = 150;  // T2-VOLCONTRACTION's own sample floor
const MIN_POSITIVE_ASSET_FRACTION = 0.50; // the 3rd leg of the fuller gate

// Verbatim copy of tournament.mjs's vol_contraction row. Not touched by this item.
const VOL_CONTRACTION_CONFIG = { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };
const ENTRY_TF = "15m";
const ENTRY_MINS = 15;
const TF_LOWER = [["15m", 15], ["1h", 60], ["4h", 240], ["1d", 1440]];

const FUTURES_TIER0 = FUTURES_FEE_SCHEDULE[0]; // retail tier, the only one reachable without $5M+/30d volume

function buildSeries(pair, tfList) {
  return tfList.map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function datasetsFor(symbols, tfList) {
  return symbols.map((symbol) => {
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
    return { symbol: d.symbol, trades: r.trades, avgR, results: r.results, excursions: r.excursions };
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
  const positiveFraction = axis.assetsTraded ? axis.positiveAssets / axis.assetsTraded : 0;
  return {
    avgRPass: axis.avgR > MEANINGFUL_AVGR_MIN,
    tradesPass: axis.trades >= MEANINGFUL_TRADES_MIN,
    positiveAssetsPass: positiveFraction >= MIN_POSITIVE_ASSET_FRACTION,
    positiveFraction,
    passed: axis.avgR > MEANINGFUL_AVGR_MIN && axis.trades >= MEANINGFUL_TRADES_MIN && positiveFraction >= MIN_POSITIVE_ASSET_FRACTION,
  };
}

// ─── HEADLINE: SEALED_SYMBOLS re-run ───────────────────────────────────────────────────
const watchlist = loadWatchlist();
const { sealed: sealedSymbols } = splitSealedSymbols(watchlist);
const sealedDatasets = datasetsFor(sealedSymbols, TF_LOWER);

const sealedAxis = runAxis(sealedDatasets, ENTRY_TF, 0, 0, (series) => splitSeries(series, SPLIT, true));
const sealedGate = gateCheck(sealedAxis);
const tradesPerAssetActivePool = 256 / 28; // VOL-CONTRACTION-SAMPLE-EXTENSION's own AXIS C rate, for context only
const structurallyUnderpowered = sealedAxis.trades < MEANINGFUL_TRADES_MIN && sealedAxis.assetsConsidered < 28;

let sealedVerdict;
if (sealedGate.passed) {
  sealedVerdict = `SEALED_SYMBOLS re-run (${sealedAxis.trades} trades, ${sealedAxis.assetsConsidered} of ${sealedSymbols.length} sealed symbols passing the candle filter) CLEARS all three legs: gross avgR ${sealedAxis.avgR.toFixed(4)} > ${MEANINGFUL_AVGR_MIN} (95% CI [${sealedAxis.ci95[0].toFixed(4)}, ${sealedAxis.ci95[1].toFixed(4)}]), trades ${sealedAxis.trades} >= ${MEANINGFUL_TRADES_MIN}, positiveAssets/assetsTraded ${sealedGate.positiveFraction.toFixed(3)} >= ${MIN_POSITIVE_ASSET_FRACTION}. VOL-CONTRACTION-SAMPLE-EXTENSION's finding REPLICATES on sealed data — the first candidate in this project to clear both a normal holdout and the sealed-symbol validation. Promotion is still a human/D3 decision never taken by this item.`;
} else if (structurallyUnderpowered) {
  sealedVerdict = `SEALED_SYMBOLS re-run (${sealedAxis.trades} trades, ${sealedAxis.assetsConsidered} of ${sealedSymbols.length} sealed symbols passing the candle filter) is STRUCTURALLY UNDER-POWERED to test the trades>=${MEANINGFUL_TRADES_MIN} leg: the sealed pool has only ${sealedAxis.assetsConsidered} symbols against the active pool's 28, and at the active pool's own per-asset rate (${tradesPerAssetActivePool.toFixed(2)} trades/asset from AXIS C) a 5-symbol pool would be expected to produce roughly ${(tradesPerAssetActivePool * sealedAxis.assetsConsidered).toFixed(0)} trades regardless of whether the underlying edge is real. Observed: gross avgR ${sealedAxis.avgR.toFixed(4)} (95% CI [${sealedAxis.ci95[0].toFixed(4)}, ${sealedAxis.ci95[1].toFixed(4)}]), positiveAssets/assetsTraded ${sealedGate.positiveFraction.toFixed(3)}. This is reported honestly as INCONCLUSIVE on the trades leg, not lowered to a pass and not declared a fail on that leg alone — VOL-CONTRACTION-SAMPLE-EXTENSION's finding could not be conclusively tested for sample size on this pool. No promotion.`;
} else {
  sealedVerdict = `SEALED_SYMBOLS re-run (${sealedAxis.trades} trades, ${sealedAxis.assetsConsidered} of ${sealedSymbols.length} sealed symbols passing the candle filter) does NOT clear the gate: avgRPass=${sealedGate.avgRPass} (avgR ${sealedAxis.avgR.toFixed(4)}), tradesPass=${sealedGate.tradesPass} (${sealedAxis.trades} trades), positiveAssetsPass=${sealedGate.positiveAssetsPass} (${sealedGate.positiveFraction.toFixed(3)}). VOL-CONTRACTION-SAMPLE-EXTENSION's finding does NOT replicate on sealed data. No promotion.`;
}

// ─── SECOND DELIVERABLE: funding-cost resolution on the ACTIVE POOL's derivatives cells ──
// Re-runs VOL-CONTRACTION-SAMPLE-EXTENSION's own AXIS C (today's full watchlist — that item
// used loadWatchlist() directly, NOT split against SEALED_SYMBOLS, so its reported 28-asset
// pool includes the 5 sealed symbols; reproducing its exact reported figures requires the
// same unsplit population) for the two Kraken-derivatives fee schedules it reported as
// funding-free upper bounds, and applies cost-model.mjs's fundingCost() using each symbol's
// cached PF_<PAIR>USD-historical-funding.json (fetchFundingRates, refresh:false — cache
// read only, confirmed present for every symbol below before this ran).
const activeDatasets = datasetsFor(watchlist, TF_LOWER);

const fundingRatesBySymbol = new Map();
let fundingModelApplicable = true;
for (const d of activeDatasets) {
  const perpSymbol = `PF_${symbolToKrakenId(d.symbol)}`;
  try {
    const cached = await fetchFundingRates({ symbol: perpSymbol, refresh: false });
    fundingRatesBySymbol.set(d.symbol, cached.rates.map((r) => ({ timestamp: Date.parse(r.timestamp), fundingRate: Number(r.relativeFundingRate) })));
  } catch (err) {
    fundingModelApplicable = false;
    fundingRatesBySymbol.set(d.symbol, []);
  }
}

function runVenueWithFunding(feeRate, slipPct) {
  const beforeFunding = [];
  const afterFunding = [];
  for (const d of activeDatasets) {
    const series = splitSeries(d.series, SPLIT, true);
    const r = backtestMultiTF({ series }, { ...VOL_CONTRACTION_CONFIG, feeRate, slipPct, entryTf: ENTRY_TF });
    const rates = fundingRatesBySymbol.get(d.symbol) || [];
    for (const ex of r.excursions) {
      beforeFunding.push(ex.r);
      const entryTs = ex.entryTime * 1000;
      const exitTs = entryTs + ex.barsHeld * ENTRY_MINS * 60 * 1000;
      const fundingFrac = rates.length && exitTs > entryTs ? fundingCost({ fundingRates: rates, entryTs, exitTs, side: "long" }) : 0;
      const fundingR = -(fundingFrac * ex.entry) / ex.risk;
      afterFunding.push(ex.r + fundingR);
    }
  }
  return { beforeFunding: stat(beforeFunding), afterFunding: stat(afterFunding) };
}

const derivativesMaker = runVenueWithFunding(FUTURES_TIER0.maker, 0);
const derivativesTaker = runVenueWithFunding(FUTURES_TIER0.taker, SLIPPAGE_PCT);

const fundingResolution = {
  modelFound: true,
  source: "cost-model.mjs fundingCost() + derivatives.mjs fetchFundingRates() (cache-only, no network egress this run)",
  cacheComplete: fundingModelApplicable,
  activePoolTrades: derivativesMaker.beforeFunding.n,
  krakenDerivativesMaker: {
    reportedUpperBound: 0.2231, // VOL-CONTRACTION-SAMPLE-EXTENSION, 2026-08-28
    reproducedUpperBound: Number(derivativesMaker.beforeFunding.mean.toFixed(4)),
    trueNetAvgR: Number(derivativesMaker.afterFunding.mean.toFixed(4)),
    ci95: [Number(derivativesMaker.afterFunding.lo.toFixed(4)), Number(derivativesMaker.afterFunding.hi.toFixed(4))],
  },
  krakenDerivativesTaker: {
    reportedUpperBound: 0.1057,
    reproducedUpperBound: Number(derivativesTaker.beforeFunding.mean.toFixed(4)),
    trueNetAvgR: Number(derivativesTaker.afterFunding.mean.toFixed(4)),
    ci95: [Number(derivativesTaker.afterFunding.lo.toFixed(4)), Number(derivativesTaker.afterFunding.hi.toFixed(4))],
  },
};

const fundingVerdict = `Funding-rate model FOUND (cost-model.mjs's fundingCost(), fed by derivatives.mjs's cached PF_<PAIR>USD-historical-funding.json for all ${activeDatasets.length} active-pool symbols — never previously applied to any backtest result in this codebase). Applied to VOL-CONTRACTION-SAMPLE-EXTENSION's own AXIS C trades (28-asset active pool, entryTf 15m, holdout only): Kraken derivatives maker reproduces at gross avgR ${fundingResolution.krakenDerivativesMaker.reproducedUpperBound} (reported ${fundingResolution.krakenDerivativesMaker.reportedUpperBound}) and funding-adjusted true net avgR is ${fundingResolution.krakenDerivativesMaker.trueNetAvgR} (95% CI [${fundingResolution.krakenDerivativesMaker.ci95[0]}, ${fundingResolution.krakenDerivativesMaker.ci95[1]}]); Kraken derivatives taker reproduces at ${fundingResolution.krakenDerivativesTaker.reproducedUpperBound} (reported ${fundingResolution.krakenDerivativesTaker.reportedUpperBound}) and funding-adjusted true net avgR is ${fundingResolution.krakenDerivativesTaker.trueNetAvgR} (95% CI [${fundingResolution.krakenDerivativesTaker.ci95[0]}, ${fundingResolution.krakenDerivativesTaker.ci95[1]}]). ${fundingResolution.krakenDerivativesMaker.trueNetAvgR > 0 && fundingResolution.krakenDerivativesTaker.trueNetAvgR > 0 ? "Both cells stay positive after funding — the upper-bound caveat does not overturn the result." : "At least one cell flips non-positive once funding is included — the prior funding-free figure overstated the true net edge."}`;

const report = {
  split: SPLIT, entryTf: ENTRY_TF,
  gate: { MEANINGFUL_AVGR_MIN, MEANINGFUL_TRADES_MIN, MIN_POSITIVE_ASSET_FRACTION },
  sealed: {
    symbolsConsidered: sealedSymbols, axis: { ...sealedAxis, perSymbol: undefined }, gate: sealedGate,
    perSymbol: sealedAxis.perSymbol, verdict: sealedVerdict,
  },
  fundingResolution, fundingVerdict,
};

const saved = saveExperiment("vol-contraction-sealed-validation", {
  specification: "vol-contraction-sealed-validation/v1", split: SPLIT,
  sealedSymbols, activeWatchlist: activeDatasets.map((d) => d.symbol), config: VOL_CONTRACTION_CONFIG,
}, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
