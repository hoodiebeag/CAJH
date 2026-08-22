/**
 * PER-EPOCH-GROSS-EDGE diagnostic (throwaway, read-only). Not part of the app.
 *
 * Combines two independently-closed findings that were never examined together:
 *   - SIGNAL-DECAY-TEMPORAL-STABILITY (2026-08-19) established both `breakout`/`anticipate`
 *     baselines are non-stationary across 5 chronological epochs of each asset's full local
 *     history, but reported per-epoch NET avgR (default fee+slip cost).
 *   - COST-COMPONENT-ATTRIBUTION (2026-08-19) established the zero-cost gross floor, but only
 *     pooled across the whole sample, not broken out by epoch.
 *
 * Question: was there ever an epoch where GROSS edge was meaningfully positive, later buried
 * by pooling? Reuses SIGNAL-DECAY's exact epoch boundaries (`epochSlices`, imported, not
 * re-derived — picking new boundaries after seeing results would be the look-elsewhere error)
 * and COST-COMPONENT-ATTRIBUTION's zero-cost re-derivation technique (feeRate=0, slipPct=0,
 * the same backtest.js cost path every other cost-diagnostic in this project already uses).
 *
 * Pre-registered "meaningfully positive" gate — decided before running, reusing
 * ZERO-COST-FLOOR-ALL-FAMILIES's own pre-registered bar verbatim (avgR>+0.10, an order of
 * magnitude above COST-COMPONENT-ATTRIBUTION's razor-thin floor; trades>=150, well below any
 * single epoch's expected count here since SIGNAL-DECAY's epochs ran ~2000-3200 trades each
 * pooled across 28 assets; positiveAssets/assets>=0.5). Applied per epoch per family, not
 * pooled across epochs.
 *
 * Uses each asset's FULL local candle history (SIGNAL-DECAY's convention, not a holdout
 * split) — the calendar holdout (2025-06-01-present) and SEALED_SYMBOLS are both untouched,
 * per this item's own scoping note.
 *
 * No cost parameter or production file is changed anywhere; this only reads out results at
 * parameter values the code already supports (feeRate/slipPct=0) on epoch slices the code
 * already supports (epochSlices).
 */
import { epochSlices } from "../signal-decay-temporal-stability.mjs";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";

const EPOCHS = 5;
const MIN_CANDLES = 250;

// Exact baseline configs from tournament.mjs's `families` table, verbatim copy of
// signal-decay-temporal-stability.mjs's BASELINES (not exported there, same duplication
// convention every other diagnostic script in this project already uses).
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

// Pre-registered before running (see header) — verbatim from ZERO-COST-FLOOR-ALL-FAMILIES.
const MEANINGFUL_AVGR_MIN = 0.10;
const MEANINGFUL_TRADES_MIN = 150;
const MEANINGFUL_ASSET_SHARE_MIN = 0.5;

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));

function runGross(series, config) {
  return backtestMultiTF({ series }, { ...config, entryTf: "1h", feeRate: 0, slipPct: 0 });
}

const watchlist = loadWatchlist();
const coverage = [];
const eligible = [];
for (const asset of normalize(watchlist)) {
  const s = seriesFor(asset.id);
  if (!s.every((tf) => tf.candles.length >= MIN_CANDLES)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
  eligible.push({ symbol: asset.symbol, id: asset.id, s });
  coverage.push({ symbol: asset.symbol, included: true });
}

const report = {
  epochs: EPOCHS,
  eligibleAssets: eligible.map((a) => a.symbol),
  coverage,
  gate: { MEANINGFUL_AVGR_MIN, MEANINGFUL_TRADES_MIN, MEANINGFUL_ASSET_SHARE_MIN },
  families: {},
};

for (const target of ["breakout", "anticipate"]) {
  const perEpochAssets = Array.from({ length: EPOCHS }, () => []); // [{symbol, trades, avgR, totalR}]

  for (const d of eligible) {
    const slices = epochSlices(d.s, EPOCHS);
    slices.forEach((slice, ei) => {
      const r = runGross(slice, BASELINES[target]);
      const avgR = r.trades ? r.results.reduce((a, b) => a + b, 0) / r.trades : 0;
      perEpochAssets[ei].push({ symbol: d.symbol, trades: r.trades, avgR, totalR: r.totalR });
    });
  }

  const epochSummaries = perEpochAssets.map((assetRows, i) => {
    const traded = assetRows.filter((x) => x.trades > 0);
    const trades = assetRows.reduce((a, b) => a + b.trades, 0);
    const totalR = assetRows.reduce((a, b) => a + b.totalR, 0);
    const avgR = trades ? totalR / trades : 0;
    const positiveAssets = traded.filter((x) => x.avgR > 0).length;
    const meaningful = avgR > MEANINGFUL_AVGR_MIN && trades >= MEANINGFUL_TRADES_MIN
      && positiveAssets / Math.max(1, traded.length) >= MEANINGFUL_ASSET_SHARE_MIN;
    return { epoch: i + 1, trades, totalR: +totalR.toFixed(6), avgR, assets: traded.length, positiveAssets, meaningful };
  });

  report.families[target] = {
    epochs: epochSummaries,
    anyMeaningfulEpoch: epochSummaries.some((e) => e.meaningful),
  };
}

const anyMeaningfulAnywhere = Object.values(report.families).some((f) => f.anyMeaningfulEpoch);
report.call = anyMeaningfulAnywhere
  ? "At least one epoch clears the pre-registered meaningfully-positive gross gate. This is a HYPOTHESIS-GENERATING observation on already-seen data (SIGNAL-DECAY's epoch boundaries, chosen for a different question), NOT a result — any follow-up must pre-register fresh on data this analysis did not touch (SEALED_SYMBOLS is the only unused holdout)."
  : "No epoch in either family clears the pre-registered meaningfully-positive gross gate. A signal that worked in one regime and died pooled would have shown up here; it did not. This closes the hypothesis this item was pre-registered to test, not just the pooled-average one COST-COMPONENT-ATTRIBUTION already closed.";

const saved = saveExperiment("per-epoch-gross-edge", { specification: "per-epoch-gross-edge/v1", epochs: EPOCHS, minCandles: MIN_CANDLES, coverage }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
