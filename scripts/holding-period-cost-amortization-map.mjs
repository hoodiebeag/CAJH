/**
 * HOLDING-PERIOD-COST-AMORTIZATION-MAP diagnostic (throwaway, read-only). Not part of the
 * app — maps net R against realized holding period for the breakout/anticipate holdout
 * baseline. Round-trip cost (fee+slip) is charged once per trade regardless of how long the
 * position was held, so for any fixed gross edge, net R mechanically improves with holding
 * period (the cost is a smaller fraction of a bigger average move). Nobody has measured
 * where this baseline actually sits on that curve.
 *
 * Method: two backtest passes per family (default net-cost, and zero-cost/gross), same
 * config, same data, same entry logic — so both passes fire the identical trade sequence
 * per symbol (established in cost-component-attribution.mjs: cost is priced after the fact,
 * it never changes which trades fire). Zipping the two passes' per-trade results by index
 * pairs (grossR, netR) per trade; backtest.js's `excursions[].barsHeld` (added alongside
 * this diagnostic — a pure telemetry field, no exit logic touched) gives the realized
 * holding period in bars for the SAME trade sequence (identical regardless of cost, since
 * cost doesn't affect exit timing). Trades are then bucketed by barsHeld and gross/net R are
 * reported per bucket.
 *
 * IMPORTANT — this reports a relationship, it does not license a decision. See ROADMAP_ARCHIVE.md
 * for the explicit statement that no exit parameter is changed and no holding-period value
 * is recommended: selecting a holding period after seeing which bucket looks best would be
 * exactly the exit re-tuning already prohibited on these negative-EV families (anticipate).
 */
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const SPLIT = 0.70;

// Exact family configs from tournament.mjs's `families` array (breakout, anticipate rows) —
// duplicated here rather than imported because tournament.mjs's `families` isn't exported;
// values copied verbatim, not re-derived. Same configs cost-component-attribution.mjs uses.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

const ENTRY_TF_MINS = 60; // "1h" — matches cost-component-attribution.mjs's entryTf choice

// Bucket edges in bars (= hours, entryTf is 1h). Upper-open except the last, which also
// catches MAX_HOLD (100) timeout exits.
const BUCKETS = [
  { label: "0h (same-bar stop)", min: 0, max: 0 },
  { label: "1-4h", min: 1, max: 4 },
  { label: "5-12h", min: 5, max: 12 },
  { label: "13-24h", min: 13, max: 24 },
  { label: "25-48h", min: 25, max: 48 },
  { label: "49-100h (incl. timeout)", min: 49, max: Infinity },
];
function bucketFor(barsHeld) {
  return BUCKETS.find((b) => barsHeld >= b.min && barsHeld <= b.max)?.label ?? "unknown";
}

function seriesFor(pair) {
  return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

const watchlist = loadWatchlist();
const datasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const report = { split: SPLIT, entryTfMins: ENTRY_TF_MINS, assetsConsidered: datasets.length, families: {} };

for (const [famId, config] of FAMILIES) {
  // Per-symbol paired (net, gross) run — identical trade sequence, verified by trade-count match.
  const pairedTrades = []; // [{symbol, barsHeld, grossR, netR}]
  let mismatches = 0;
  for (const d of datasets) {
    const net = backtestMultiTF({ series: d.holdout }, { ...config, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, entryTf: "1h" });
    const gross = backtestMultiTF({ series: d.holdout }, { ...config, feeRate: 0, slipPct: 0, entryTf: "1h" });
    if (net.trades !== gross.trades) { mismatches++; continue; } // should never happen; skip defensively rather than misalign
    for (let i = 0; i < net.trades; i++) {
      pairedTrades.push({
        symbol: d.symbol,
        barsHeld: net.excursions[i].barsHeld,
        grossR: gross.results[i],
        netR: net.results[i],
      });
    }
  }

  const byBucket = {};
  for (const b of BUCKETS) byBucket[b.label] = [];
  for (const t of pairedTrades) byBucket[bucketFor(t.barsHeld)].push(t);

  const bucketRows = BUCKETS.map((b) => {
    const rows = byBucket[b.label];
    const n = rows.length;
    const grossAvgR = n ? rows.reduce((a, r) => a + r.grossR, 0) / n : null;
    const netAvgR = n ? rows.reduce((a, r) => a + r.netR, 0) / n : null;
    return { bucket: b.label, trades: n, grossAvgR, netAvgR, netPositive: n ? netAvgR > 0 : null };
  });

  const totalTrades = pairedTrades.length;
  const netPositiveBuckets = bucketRows.filter((r) => r.netPositive);
  const tradesInNetPositiveBuckets = netPositiveBuckets.reduce((a, r) => a + r.trades, 0);

  report.families[famId] = {
    totalTrades,
    symbolMismatches: mismatches, // count of symbols excluded because net/gross trade counts diverged (should be 0)
    bucketRows,
    anyBucketNetPositive: netPositiveBuckets.length > 0,
    netPositiveBucketLabels: netPositiveBuckets.map((r) => r.bucket),
    fractionOfTradesInNetPositiveBuckets: totalTrades ? tradesInNetPositiveBuckets / totalTrades : null,
  };
}

const saved = saveExperiment(
  "holding-period-cost-amortization-map",
  { specification: "holding-period-cost-amortization-map/v1", split: SPLIT, watchlist: datasets.map((d) => d.symbol), buckets: BUCKETS.map((b) => b.label) },
  report
);
console.log(JSON.stringify({ ...report, saved }, null, 2));
