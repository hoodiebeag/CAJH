/**
 * PER-FAMILY-COST-CEILING diagnostic (additive, read-only). Not part of the app — replaces
 * COST-SENSITIVITY-SURFACE's 2-D grid (breakout/anticipate only) with the closed-form
 * identity DERIVED 2026-08-22 from ZERO-COST-FLOOR-ALL-FAMILIES's own recorded figures,
 * applied to all 12 tournament.mjs families on both markets.
 *
 * Identity: backtest.js's net-R formula is `netR = grossR - (feeRate+slipPct)*(entry+exitPx)/risk`
 * (backtest.js) — fee and slip enter through the SAME per-trade coefficient, so one unit of
 * feeRate produces exactly the same aggregate avgR drag as one unit of slipPct. That means a
 * single sensitivity constant per family,
 *   k = (feeDragAvgR + slipDragAvgR) / (FEE_RATE + SLIPPAGE_PCT)   [R of drag per 1.00 of rate]
 * derived from the same 4 backtest passes ZERO-COST-FLOOR-ALL-FAMILIES already runs (gross,
 * fee-only, slip-only, net), predicts net avgR at ANY (fee, slip) point as
 *   netAvgR(fee, slip) = grossAvgR - k*(fee + slip)
 * and gives an exact break-even all-in per-leg cost = grossAvgR / k wherever gross is positive.
 * Every venue point below is independently re-run through backtest.js directly (not just
 * evaluated analytically) so the identity is checked per family, not assumed.
 *
 * Crypto: 12 families x 4 real venues (Kraken spot maker/taker, Kraken derivatives
 * maker/taker). Derivatives cells are labelled UPPER BOUNDS — this backtest models no
 * funding cost, and Kraken perpetuals charge funding the spot/gross figures never see.
 * Maker fills are modeled at slip=0 (resting limit, no spread crossed); taker fills at
 * SLIPPAGE_PCT (current default market-fill assumption) — same convention as
 * COST-SENSITIVITY-SURFACE's own slip axis.
 *
 * Equity: cost basis is per-symbol (IBKR Fixed plan: commissionPerShare / that symbol's own
 * holdout avgClose — EQUITIES-BASELINE-PORT's basis, reused verbatim from
 * EQUITIES-COST-ASSUMPTION-SENSITIVITY), so k is NOT a single family-wide number — it is
 * computed per symbol from that symbol's own trades and reported as a distribution
 * (count/min/median/max), not collapsed to one figure. Per-symbol trade counts are thin
 * (EQUITIES-BASELINE-PORT: 61 holdout trades pooled across 30 symbols for breakout alone),
 * so per-symbol k is undefined (no trades) or noisy for many symbols — reported plainly, not
 * smoothed over. The pooled (all-symbols) net avgR at EQUITIES-BASELINE-PORT's own basis
 * (5bps slip default) is what the venue x family x market table actually gates on.
 *
 * Sample adequacy is explicitly OUT OF SCOPE: a family clearing a cost ceiling on however many
 * trades it happens to have has not thereby been shown to have a real edge — this study is a
 * cost-model readout only, not a significance or sample-size claim.
 */
import fs from "fs";
import path from "path";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";
import { SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE } from "../cost-model.mjs";

const SPLIT = 0.70;
const TOLERANCE = 1e-9;

// Verbatim copy of tournament.mjs's `families` array (not exported there) — same convention
// ZERO-COST-FLOOR-ALL-FAMILIES/COST-COMPONENT-ATTRIBUTION already used for the same reason.
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

const EQUITY_UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share — EQUITIES-BASELINE-PORT's basis
const EQUITY_SLIPPAGE_DEFAULT = 0.0005; // EQUITIES-BASELINE-PORT's own baseline (5bps/side)

const FUTURES_TIER0 = FUTURES_FEE_SCHEDULE[0]; // retail tier, the only one reachable without $5M+/30d volume

// Real venues to evaluate crypto families against — named, not abstract grid points.
const CRYPTO_VENUES = [
  ["Kraken spot maker", SPOT_FEE_SCHEDULE.maker, 0, false],
  ["Kraken spot taker", SPOT_FEE_SCHEDULE.taker, SLIPPAGE_PCT, false],
  ["Kraken derivatives maker", FUTURES_TIER0.maker, 0, true],
  ["Kraken derivatives taker", FUTURES_TIER0.taker, SLIPPAGE_PCT, true],
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
  return { trades: results.length, avgR: results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0 };
}
function runCrypto(datasets, config, feeRate, slipPct) {
  const perAsset = datasets.map((d) => {
    const r = backtestMultiTF({ series: d.holdout }, { ...config, feeRate, slipPct, entryTf: "1h" });
    return { symbol: d.symbol, results: r.results };
  });
  return summarize(perAsset);
}

// ── Crypto: 12 families x closed-form k, then 4 real venues, direct-rerun checked ──────────

const watchlist = loadWatchlist();
const cryptoDatasets = watchlist.map((symbol) => {
  const id = symbolToKrakenId(symbol);
  const series = seriesFor(id);
  if (series.some((tf) => tf.candles.length < 250)) return null;
  return { symbol, holdout: splitSeries(series, SPLIT, true) };
}).filter(Boolean);

const cryptoReport = { assetsConsidered: cryptoDatasets.length, families: {} };

for (const [famId, config] of FAMILIES) {
  const gross = runCrypto(cryptoDatasets, config, 0, 0);
  const feeOnly = runCrypto(cryptoDatasets, config, FEE_RATE, 0);
  const slipOnly = runCrypto(cryptoDatasets, config, 0, SLIPPAGE_PCT);
  const net = runCrypto(cryptoDatasets, config, FEE_RATE, SLIPPAGE_PCT);

  const feeDragAvgR = gross.avgR - feeOnly.avgR;
  const slipDragAvgR = gross.avgR - slipOnly.avgR;
  const kFromFee = FEE_RATE !== 0 ? feeDragAvgR / FEE_RATE : null;
  const kFromSlip = SLIPPAGE_PCT !== 0 ? slipDragAvgR / SLIPPAGE_PCT : null;
  const k = (feeDragAvgR + slipDragAvgR) / (FEE_RATE + SLIPPAGE_PCT);
  const kIdentityDiscrepancy = kFromFee !== null && kFromSlip !== null ? kFromFee - kFromSlip : null;

  const reconstructedNetAvgR = gross.avgR - k * (FEE_RATE + SLIPPAGE_PCT);
  const reconciliationDiscrepancy = reconstructedNetAvgR - net.avgR;

  const hasCeiling = gross.avgR > 0;
  const breakEvenFraction = hasCeiling ? gross.avgR / k : null;
  const breakEvenBps = breakEvenFraction !== null ? breakEvenFraction * 10000 : null;

  // FEE-SCHEDULE-REBASE's claim, re-checked here: cost never changes which trades fire.
  const tradeCountsMatch = [gross.trades, feeOnly.trades, slipOnly.trades, net.trades].every((t) => t === net.trades);

  const venues = CRYPTO_VENUES.map(([label, fee, slip, isDerivative]) => {
    const analyticAvgR = gross.avgR - k * (fee + slip);
    const direct = runCrypto(cryptoDatasets, config, fee, slip);
    const discrepancy = analyticAvgR - direct.avgR;
    return {
      venue: label, fee, slip, isDerivativeUpperBound: isDerivative,
      analyticAvgR, directAvgR: direct.avgR, discrepancy,
      withinTolerance: Math.abs(discrepancy) < TOLERANCE,
      clears010: direct.avgR > 0.10,
    };
  });

  cryptoReport.families[famId] = {
    trades: net.trades, tradeCountsMatch,
    grossAvgR: gross.avgR, feeDragAvgR, slipDragAvgR, netAvgR: net.avgR,
    k, kFromFee, kFromSlip, kIdentityDiscrepancy,
    reconciliationDiscrepancy, reconciliationWithinTolerance: Math.abs(reconciliationDiscrepancy) < TOLERANCE,
    hasCeiling, breakEvenFraction, breakEvenBps,
    venues,
  };
}

// ── Equity: 12 families x per-symbol k distribution, pooled IBKR venue ─────────────────────

const cacheDir = path.join(".", "research-cache", "equities-1d");
function loadCachedEquity(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}
function splitEquityCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

const equityDatasets = [];
for (const symbol of EQUITY_UNIVERSE) {
  const candles = loadCachedEquity(symbol);
  if (!candles || candles.length < 100) { console.error(`SKIP ${symbol}: no usable equities cache`); continue; }
  const { holdout } = splitEquityCandles(candles, SPLIT);
  if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
  const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
  const feeRate = COMMISSION_PER_SHARE / avgClose; // per-side, per-symbol
  equityDatasets.push({ symbol, holdout, avgClose, feeRate });
}
if (equityDatasets.length === 0) {
  throw new Error("No cached equities data found in research-cache/equities-1d/ — this study requires EQUITIES-BASELINE-PORT's cache to already exist. Refusing to fetch live (this item is scoped no-egress).");
}

function runEquitySymbol(d, config, feeRate, slipPct) {
  const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
  const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate, slipPct });
  const avgR = r.trades ? r.results.reduce((a, b) => a + b, 0) / r.trades : 0;
  return { trades: r.trades, avgR, totalR: r.totalR };
}
function pooledEquity(perSymbol) {
  const trades = perSymbol.reduce((a, x) => a + x.trades, 0);
  const totalR = perSymbol.reduce((a, x) => a + x.totalR, 0);
  return { trades, avgR: trades ? totalR / trades : 0 };
}

const equityReport = { universeSize: EQUITY_UNIVERSE.length, datasetsUsed: equityDatasets.length, families: {} };

for (const [famId, config] of FAMILIES) {
  const perSymbol = equityDatasets.map((d) => {
    const gross = runEquitySymbol(d, config, 0, 0);
    const feeOnly = runEquitySymbol(d, config, d.feeRate, 0);
    const slipOnly = runEquitySymbol(d, config, 0, EQUITY_SLIPPAGE_DEFAULT);
    const net = runEquitySymbol(d, config, d.feeRate, EQUITY_SLIPPAGE_DEFAULT);
    const feeDragAvgR = gross.avgR - feeOnly.avgR;
    const slipDragAvgR = gross.avgR - slipOnly.avgR;
    const kFromFee = d.feeRate !== 0 ? feeDragAvgR / d.feeRate : null;
    const kFromSlip = EQUITY_SLIPPAGE_DEFAULT !== 0 ? slipDragAvgR / EQUITY_SLIPPAGE_DEFAULT : null;
    const hasTrades = gross.trades > 0;
    const k = hasTrades && d.feeRate !== 0 ? (feeDragAvgR + slipDragAvgR) / (d.feeRate + EQUITY_SLIPPAGE_DEFAULT) : null;
    const hasCeiling = hasTrades && gross.avgR > 0 && k !== null && k !== 0;
    const breakEvenBps = hasCeiling ? (gross.avgR / k) * 10000 : null;
    const tradeCountsMatch = [gross.trades, feeOnly.trades, slipOnly.trades, net.trades].every((t) => t === net.trades);
    return {
      symbol: d.symbol, avgClose: d.avgClose, feeRate: d.feeRate,
      trades: gross.trades, tradeCountsMatch, grossAvgR: gross.avgR, netAvgR: net.avgR,
      k, kFromFee, kFromSlip, hasCeiling, breakEvenBps,
    };
  });

  const withCeiling = perSymbol.filter((s) => s.hasCeiling).map((s) => s.breakEvenBps).sort((a, b) => a - b);
  const distribution = withCeiling.length
    ? { count: withCeiling.length, min: withCeiling[0], median: withCeiling[Math.floor(withCeiling.length / 2)], max: withCeiling[withCeiling.length - 1] }
    : { count: 0, min: null, median: null, max: null };

  // Pooled venue evaluation at EQUITIES-BASELINE-PORT's own basis (per-symbol fee, 5bps slip).
  const grossPooled = pooledEquity(perSymbol.map((s) => ({ trades: s.trades, totalR: s.grossAvgR * s.trades })));
  const netPooled = pooledEquity(equityDatasets.map((d) => runEquitySymbol(d, config, d.feeRate, EQUITY_SLIPPAGE_DEFAULT)));

  equityReport.families[famId] = {
    symbolsWithTrades: perSymbol.filter((s) => s.trades > 0).length,
    tradeCountsMatchAllSymbols: perSymbol.every((s) => s.tradeCountsMatch),
    grossAvgRPooled: grossPooled.avgR,
    netAvgRPooled: netPooled.avgR,
    tradesPooled: netPooled.trades,
    breakEvenBpsDistribution: distribution,
    ibkrVenue: { fee: "per-symbol (commissionPerShare/avgClose)", slip: EQUITY_SLIPPAGE_DEFAULT, netAvgR: netPooled.avgR, trades: netPooled.trades, clears010: netPooled.avgR > 0.10 },
    perSymbol,
  };
}

// ── Combined venue x family x market table ──────────────────────────────────────────────

const table = [];
for (const [famId] of FAMILIES) {
  const c = cryptoReport.families[famId];
  for (const v of c.venues) {
    table.push({ family: famId, market: "crypto", venue: v.venue, netAvgR: v.directAvgR, isDerivativeUpperBound: v.isDerivativeUpperBound, clears010: v.clears010 });
  }
  const e = equityReport.families[famId];
  table.push({ family: famId, market: "equity", venue: "IBKR (per-symbol basis, pooled)", netAvgR: e.ibkrVenue.netAvgR, isDerivativeUpperBound: false, clears010: e.ibkrVenue.clears010 });
}
const clearing010 = table.filter((row) => row.clears010);

const report = {
  split: SPLIT,
  crypto: cryptoReport,
  equity: equityReport,
  table,
  clearing010,
  sampleAdequacyOutOfScope: "This study reports cost-ceiling clearance only. A family/venue clearing +0.10R here has NOT thereby been shown to have a real edge — trade counts vary widely (crypto pooled 250+ trades for some families down to equity per-symbol counts often 0-3) and no significance or sample-size claim is made by this study.",
  note: "Kraken derivatives cells are UPPER BOUNDS — this backtest models no funding cost, which Kraken perpetuals charge continuously and which is not represented anywhere in these figures.",
};

const saved = saveExperiment("per-family-cost-ceiling", {
  specification: "per-family-cost-ceiling/v1",
  split: SPLIT,
  watchlist: cryptoDatasets.map((d) => d.symbol),
  equityUniverse: equityDatasets.map((d) => d.symbol),
  families: FAMILIES.map(([id]) => id),
}, report);

console.log(JSON.stringify({ ...report, saved }, null, 2));
