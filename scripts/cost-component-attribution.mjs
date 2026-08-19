/**
 * COST-COMPONENT-ATTRIBUTION diagnostic (throwaway, read-only). Not part of the app —
 * decomposes the breakout/anticipate holdout baseline's net R into its cost components by
 * re-running backtest.js's existing cost path (backtestMultiTF's feeRate/slipPct params,
 * the same mechanism tournament.mjs's runTournament already exposes) at three cost
 * configurations instead of one. No cost parameter is changed anywhere; this only reads
 * out results at parameter values the code already supports.
 *
 * Method — exact linear decomposition, not an estimate:
 *   backtest.js's net-R formula is `netR = grossR - (feeRate + slipPct) * (entry + exitPx) / risk`
 *   (backtest.js:526), i.e. affine in feeRate and slipPct with a per-trade coefficient that
 *   does not itself depend on feeRate/slipPct (FEE-SCHEDULE-REBASE already established that
 *   trade counts/entries/exits are identical across cost values — cost is priced after the
 *   fact, it never changes which trades fire). That means, per trade:
 *     feeDrag  = feeRate  * (entry + exitPx) / risk   ->  grossAvgR - feeOnlyAvgR (aggregate)
 *     slipDrag = slipPct  * (entry + exitPx) / risk   ->  grossAvgR - slipOnlyAvgR (aggregate)
 *     netAvgR  = grossAvgR - feeDrag - slipDrag        (exact identity, verified below)
 *   Three backtest passes (zero-cost, fee-only, slip-only) plus the existing default
 *   (fee+slip) recovers both components exactly, without touching backtest.js or
 *   instrumenting individual trades.
 *
 * Spread-crossing vs. modeled slippage: this codebase's cost model does not separate them.
 * SLIPPAGE_PCT (strategy.js:28) is documented as "per-side slippage estimate for market
 * fills" — a single proxy that already stands in for the cost of crossing the spread on a
 * taker order. Separating "spread crossing" from "slippage" would require real bid/ask tick
 * data, which candles/*.csv (OHLC only) does not carry. Reported as one combined
 * "slippage/spread-crossing" component rather than fabricating a further split with no data
 * behind it.
 *
 * Adverse selection: PWR5's calibrated model (cost-model.mjs's simulateLimitFill,
 * consumed via PHASE1/PHASE2's "incl. calibrated adverse selection" scenarios,
 * scripts/phase2-triage.mjs's SCENARIOS) prices the extra cost of a RESTING maker order
 * that gets filled and then watched to run further against the position before exit. The
 * breakout/anticipate baseline under study here uses backtest.js's default market/taker
 * fills (no resting order, no wait) — PWR5's model has nothing to attach to for this
 * baseline, so its contribution here is exactly 0, not "unmeasured". For context (not
 * re-derived here — see PHASE1/PHASE2), that calibrated add-on is ~0.0024 round-trip
 * (~0.12%/side) were this baseline ever switched to maker execution; PWR5/PHASE4 already
 * found maker execution insufficient to rescue breakout, so this baseline is not retested.
 */
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const SPLIT = 0.70;

// Exact family configs from tournament.mjs's `families` array (breakout, anticipate rows) —
// duplicated here rather than imported because tournament.mjs's `families` isn't exported;
// values copied verbatim, not re-derived.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

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
  const avgR = results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0;
  return { trades: results.length, avgR, totalR: results.reduce((a, b) => a + b, 0) };
}

const watchlist = loadWatchlist();
const datasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const TOLERANCE = 1e-9;
const report = { split: SPLIT, assetsConsidered: datasets.length, families: {} };

for (const [famId, config] of FAMILIES) {
  const perAssetByCost = {}; // costLabel -> [{symbol, trades, avgR, totalR}]
  for (const [costLabel, costOverride] of COST_CONFIGS) {
    perAssetByCost[costLabel] = datasets.map((d) => {
      const r = backtestMultiTF({ series: d.holdout }, { ...config, ...costOverride, entryTf: "1h" });
      return { symbol: d.symbol, trades: r.trades, avgR: r.trades ? r.results.reduce((a, b) => a + b, 0) / r.trades : 0, totalR: r.totalR, results: r.results };
    });
  }

  const pooled = {};
  for (const [costLabel] of COST_CONFIGS) {
    pooled[costLabel] = summarize(perAssetByCost[costLabel]);
  }

  const gross = pooled["gross (zero-cost)"];
  const feeOnly = pooled["fee-only"];
  const slipOnly = pooled["slip-only"];
  const net = pooled["net (default, fee+slip)"];

  const feeDragAvgR = gross.avgR - feeOnly.avgR;
  const slipDragAvgR = gross.avgR - slipOnly.avgR;
  const adverseSelectionDragAvgR = 0; // N/A: taker/market fills only, see header note
  const reconstructedNetAvgR = gross.avgR - feeDragAvgR - slipDragAvgR - adverseSelectionDragAvgR;
  const reconciliationDiscrepancy = reconstructedNetAvgR - net.avgR;

  const feeShareOfDrag = (feeDragAvgR) / (gross.avgR - net.avgR);
  const slipShareOfDrag = (slipDragAvgR) / (gross.avgR - net.avgR);

  report.families[famId] = {
    trades: net.trades,
    pooled: { gross, feeOnly, slipOnly, net },
    attribution: {
      grossAvgR: gross.avgR,
      feeDragAvgR,
      slipSpreadDragAvgR: slipDragAvgR,
      adverseSelectionDragAvgR,
      netAvgR: net.avgR,
      reconstructedNetAvgR,
      reconciliationDiscrepancy,
      withinTolerance: Math.abs(reconciliationDiscrepancy) < TOLERANCE,
      feeShareOfTotalDrag: feeShareOfDrag,
      slipSpreadShareOfTotalDrag: slipShareOfDrag,
    },
    perAsset: datasets.map((d, i) => {
      const g = perAssetByCost["gross (zero-cost)"][i];
      const f = perAssetByCost["fee-only"][i];
      const s = perAssetByCost["slip-only"][i];
      const n = perAssetByCost["net (default, fee+slip)"][i];
      return {
        symbol: d.symbol,
        trades: n.trades,
        grossAvgR: g.avgR,
        feeDragAvgR: g.avgR - f.avgR,
        slipSpreadDragAvgR: g.avgR - s.avgR,
        netAvgR: n.avgR,
      };
    }),
  };
}

const saved = saveExperiment("cost-component-attribution", { specification: "cost-component-attribution/v1", split: SPLIT, watchlist: datasets.map((d) => d.symbol) }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
