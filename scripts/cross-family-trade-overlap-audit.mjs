/**
 * CROSS-FAMILY-TRADE-OVERLAP-AUDIT (additive, read-only diagnostic). Not part of the app.
 *
 * EQUITIES-ALL-FAMILIES-BASELINE (2026-08-22) found 10 of 12 tournament.mjs families
 * net-positive on the DJIA-30 equity holdout and framed that as breadth. Nobody has ever
 * checked whether those 10 "independent" positive results are actually ten different bets or
 * a much smaller number of near-duplicate signals firing on the same symbol on the same day.
 * ma_dip in particular carries the project's only surviving positive result at real sample
 * size and its independence from the other equity-positive families has never been measured.
 * This item measures trade-set overlap directly. It does NOT re-run any family, re-tune
 * anything, or produce a new avgR — every family x market combination below has an
 * already-published trades/avgR figure (cited inline) that this script reproduces bit-for-bit
 * as a REPLICATION CHECK before using that computation's trade-level (symbol, entry day)
 * detail for overlap matching. That detail was never persisted by the original scripts (they
 * only saved pooled trades/avgR), so re-executing the identical, unmodified computation is the
 * only way to recover it — this is data extraction from a result that already exists, not a
 * new experiment. If a replication check fails for any family/market, that combination is
 * dropped from the overlap analysis and the mismatch is reported, never silently accepted.
 *
 * ============================ PRE-REGISTRATION (written before any overlap number below is computed) ============================
 * OVERLAP WINDOW: two trades "overlap" if they share the same symbol/pair AND the same
 * calendar day (UTC) of entry. One window, used identically for daily-bar equities (DJIA-30,
 * DJTA-20) and hourly-entry crypto — chosen for cross-market methodological consistency, at
 * the stated cost of being a coarser window relative to bar granularity on the crypto side
 * (an hourly entryTf) than the equities side (a daily entryTf). Not tuned after seeing results.
 *
 * OVERLAP METRIC, per ordered family pair (A, B) sharing a market: matchedFromA = count of A's
 * trades for which at least one B trade exists in the same (symbol, day) bucket. The matrix
 * cell reported is the SYMMETRIC coefficient overlap(A,B) = (matchedFromA + matchedFromB) /
 * (|A| + |B|) — the average of the two directional match fractions, reported alongside both
 * directional fractions so asymmetry from unequal sample sizes is visible, not hidden in an
 * average.
 *
 * INDEPENDENCE CLUSTERING: families in the same market are joined into one cluster when
 * overlap(A,B) >= 0.50 (single-linkage / union-find over the pairwise matrix, pre-registered
 * threshold — a trade-overlap majority, not tuned after seeing the matrix). The
 * "effectively independent family count" for a market is its number of connected components.
 *
 * DATA COMPLETENESS CAVEAT, disclosed up front: backtest.js's excursions array only attaches
 * an entryTime to trades closed via the general per-bar close path (stop/target/trail/
 * breakeven/swingHigh/timeout). Two `entryMode: "anticipate"`-only same-bar-stop-out code
 * paths (immediate stop on the entry bar, and the entryDelayBars fill-then-immediate-stop
 * path) push a trade record with no entryTime. Those trades cannot be placed in a (symbol,
 * day) bucket and are excluded from matching; their count is reported per family/market, not
 * silently dropped from the trade totals used in the replication check.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { backtestMultiTF } from "../backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const SPLIT = 0.70;

// Verbatim copy of tournament.mjs's `families` array — same convention every prior
// cross-family study in this project (equities-all-families-baseline.mjs,
// zero-cost-floor-all-families.mjs) has used, for the same reason (tournament.mjs's own
// data-loading path is wired for the crypto researchlab candle store, not these cache layouts).
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
const FAMILY_CONFIG = Object.fromEntries(FAMILIES);

// DJIA-30, point-in-time as of window start 2024-08-19 — EQUITIES-BASELINE-PORT /
// EQUITIES-ALL-FAMILIES-BASELINE's own UNIVERSE, verbatim.
const DJIA30_UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
// DJTA-20, point-in-time as of window start 2024-08-22 — EQUITIES-BREAKOUT-OUT-OF-SAMPLE /
// EQUITIES-MADIP-OUT-OF-SAMPLE's own UNIVERSE, verbatim.
const DJTA20_UNIVERSE = [
  "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
  "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
];

const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side

// Already-published figures each family/market computation below must reproduce bit-for-bit
// before its trade-level detail is trusted. Trade counts must match exactly; avgR within 5e-4
// (half the last published decimal digit, all source tables report to 4 places).
const EXPECTED = {
  "crypto": { // ZERO-COST-FLOOR-ALL-FAMILIES, 2026-08-22, "net (default)" column, trades col at left
    ma_dip: { trades: 9894, avgR: -5.1457 }, vol_contraction: { trades: 98, avgR: -0.8571 },
    breakout: { trades: 3156, avgR: -0.8640 }, h3: { trades: 4590, avgR: -1.6516 },
    rsi: { trades: 2265, avgR: -1.3300 }, range_sweep_reclaim: { trades: 511, avgR: -1.1196 },
    anticipate: { trades: 3966, avgR: -0.8842 }, bos: { trades: 273, avgR: -0.9019 },
    trend_pullback: { trades: 2017, avgR: -1.0146 }, sweep_reclaim: { trades: 3145, avgR: -1.2216 },
    support: { trades: 53640, avgR: -3.6742 }, rev: { trades: 24327, avgR: -3.7272 },
  },
  "djia30": { // EQUITIES-ALL-FAMILIES-BASELINE, 2026-08-22, net avgR column
    ma_dip: { trades: 475, avgR: 0.1526 }, rsi: { trades: 32, avgR: 0.2507 },
    bos: { trades: 60, avgR: 0.1728 }, breakout: { trades: 61, avgR: 0.1866 },
    h3: { trades: 106, avgR: 0.1178 }, range_sweep_reclaim: { trades: 3, avgR: 0.9656 },
    support: { trades: 407, avgR: 0.0014 }, sweep_reclaim: { trades: 92, avgR: 0.0328 },
    rev: { trades: 179, avgR: -0.0501 }, anticipate: { trades: 303, avgR: -0.0438 },
    trend_pullback: { trades: 38, avgR: -0.2026 }, vol_contraction: { trades: 0, avgR: 0 },
  },
  "djta20": { // EQUITIES-BREAKOUT-OUT-OF-SAMPLE + EQUITIES-MADIP-OUT-OF-SAMPLE, 2026-08-22
    breakout: { trades: 33, avgR: -0.0854 },
    anticipate: { trades: 188, avgR: 0.1619 },
    ma_dip: { trades: 300, avgR: 0.2994 },
  },
};
const AVGR_TOLERANCE = 5e-4;

function toDay(entryTime) {
  if (entryTime == null || !Number.isFinite(+entryTime)) return null;
  return new Date(+entryTime * 1000).toISOString().slice(0, 10);
}

// ---- crypto extraction: identical method to zero-cost-floor-all-families.mjs, net cost config only ----
function seriesForCrypto(pair) {
  return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
}
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

function extractCrypto() {
  const watchlist = loadWatchlist();
  const datasets = watchlist.map((symbol) => {
    const id = symbolToKrakenId(symbol);
    const series = seriesForCrypto(id);
    if (series.some((tf) => tf.candles.length < 250)) return null;
    return { symbol, holdout: splitSeries(series, SPLIT, true) };
  }).filter(Boolean);

  const out = {};
  for (const [famId, config] of FAMILIES) {
    const trades = [];
    let totalR = 0, count = 0, missingEntryTime = 0;
    for (const d of datasets) {
      const r = backtestMultiTF({ series: d.holdout }, { ...config, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, entryTf: "1h" });
      count += r.trades;
      totalR += r.totalR;
      for (const exc of r.excursions) {
        const day = toDay(exc.entryTime);
        if (day == null) { missingEntryTime++; continue; }
        trades.push({ symbol: d.symbol, day });
      }
    }
    out[famId] = { trades, tradeCount: count, avgR: count ? totalR / count : 0, missingEntryTime };
  }
  return { datasetsUsed: datasets.length, out };
}

// ---- equities extraction: identical method to equities-all-families-baseline.mjs /
// equities-breakout-out-of-sample.mjs / equities-madip-out-of-sample.mjs, cache-only ----
function loadEquityCache(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}
function splitEquityCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

function extractEquityMarket(cacheDir, universe, famIds) {
  const datasets = [];
  for (const symbol of universe) {
    const candles = loadEquityCache(cacheDir, symbol);
    if (!candles) { console.error(`MISSING CACHE: ${cacheDir}/${symbol} — cache-only, no re-fetch`); continue; }
    const { holdout } = splitEquityCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    datasets.push({ symbol, holdout, feeRate });
  }

  const out = {};
  for (const famId of famIds) {
    const config = FAMILY_CONFIG[famId];
    const trades = [];
    let totalR = 0, count = 0, missingEntryTime = 0;
    for (const d of datasets) {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate: d.feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
      count += r.trades;
      totalR += r.totalR;
      for (const exc of r.excursions) {
        const day = toDay(exc.entryTime);
        if (day == null) { missingEntryTime++; continue; }
        trades.push({ symbol: d.symbol, day });
      }
    }
    out[famId] = { trades, tradeCount: count, avgR: count ? totalR / count : 0, missingEntryTime };
  }
  return { datasetsUsed: datasets.length, out };
}

function replicationCheck(marketKey, extracted) {
  const rows = [];
  let allPass = true;
  for (const [famId, expected] of Object.entries(EXPECTED[marketKey])) {
    const got = extracted[famId];
    if (!got) { rows.push({ family: famId, status: "MISSING" }); allPass = false; continue; }
    const tradesMatch = got.tradeCount === expected.trades;
    const avgRMatch = Math.abs(got.avgR - expected.avgR) < AVGR_TOLERANCE || (expected.trades === 0 && got.tradeCount === 0);
    const pass = tradesMatch && avgRMatch;
    if (!pass) allPass = false;
    rows.push({ family: famId, expectedTrades: expected.trades, gotTrades: got.tradeCount, expectedAvgR: expected.avgR, gotAvgR: +got.avgR.toFixed(4), tradesMatch, avgRMatch, pass });
  }
  return { allPass, rows };
}

// ---- overlap computation ----
function buildBucket(tradesByFamily) {
  const bucket = new Map();
  for (const [fam, trades] of Object.entries(tradesByFamily)) {
    for (const t of trades) {
      const key = `${t.symbol}|${t.day}`;
      if (!bucket.has(key)) bucket.set(key, new Map());
      const m = bucket.get(key);
      m.set(fam, (m.get(fam) || 0) + 1);
    }
  }
  return bucket;
}

function pairwiseOverlap(tradesByFamily) {
  const fams = Object.keys(tradesByFamily);
  const bucket = buildBucket(tradesByFamily);
  const matrix = {};
  for (const a of fams) {
    matrix[a] = {};
    for (const b of fams) {
      if (a === b) { matrix[a][b] = null; continue; }
      const A = tradesByFamily[a], B = tradesByFamily[b];
      if (!A.length || !B.length) { matrix[a][b] = { matchedFromA: 0, fracFromA: 0, matchedFromB: 0, fracFromB: 0, symmetric: 0 }; continue; }
      let matchedFromA = 0;
      for (const t of A) { const m = bucket.get(`${t.symbol}|${t.day}`); if (m && m.has(b)) matchedFromA++; }
      let matchedFromB = 0;
      for (const t of B) { const m = bucket.get(`${t.symbol}|${t.day}`); if (m && m.has(a)) matchedFromB++; }
      matrix[a][b] = {
        matchedFromA, fracFromA: matchedFromA / A.length,
        matchedFromB, fracFromB: matchedFromB / B.length,
        symmetric: (matchedFromA + matchedFromB) / (A.length + B.length),
      };
    }
  }
  return matrix;
}

const CLUSTER_THRESHOLD = 0.50;
function clusterFamilies(matrix) {
  const fams = Object.keys(matrix);
  const parent = Object.fromEntries(fams.map((f) => [f, f]));
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(x, y) { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; }
  for (const a of fams) for (const b of fams) if (a !== b && matrix[a][b] && matrix[a][b].symmetric >= CLUSTER_THRESHOLD) union(a, b);
  const clusters = {};
  for (const f of fams) { const r = find(f); (clusters[r] = clusters[r] || []).push(f); }
  return Object.values(clusters);
}

function main() {
  console.error("Extracting crypto trade sets (12 families, full watchlist, net cost)...");
  const crypto = extractCrypto();
  console.error("Extracting DJIA-30 trade sets (12 families)...");
  const djia30 = extractEquityMarket(path.join(".", "research-cache", "equities-1d"), DJIA30_UNIVERSE, FAMILIES.map(([id]) => id));
  console.error("Extracting DJTA-20 trade sets (breakout, anticipate, ma_dip — the only 3 already run on this universe)...");
  const djta20 = extractEquityMarket(path.join(".", "research-cache", "equities-1d-djta-oos"), DJTA20_UNIVERSE, ["breakout", "anticipate", "ma_dip"]);

  const markets = { crypto, djia30, djta20 };
  const replication = {};
  for (const [key, extracted] of Object.entries(markets)) replication[key] = replicationCheck(key, extracted.out);

  const report = { split: SPLIT, clusterThreshold: CLUSTER_THRESHOLD, overlapWindow: "same symbol, same calendar day (UTC) of entry", replication: {}, markets: {} };

  for (const [key, extracted] of Object.entries(markets)) {
    const rep = replication[key];
    report.replication[key] = rep;
    if (!rep.allPass) {
      console.error(`REPLICATION MISMATCH in ${key} — see report.replication.${key}. This market's mismatched families are excluded from overlap analysis.`);
    }
    const tradesByFamily = {};
    const missingEntryTimeByFamily = {};
    for (const row of rep.rows) {
      if (row.status === "MISSING") continue;
      const famData = extracted.out[row.family];
      missingEntryTimeByFamily[row.family] = famData.missingEntryTime;
      if (!row.pass) continue; // exclude mismatched family from overlap matching
      tradesByFamily[row.family] = famData.trades;
    }
    const matrix = pairwiseOverlap(tradesByFamily);
    const clusters = clusterFamilies(matrix);
    report.markets[key] = {
      datasetsUsed: extracted.datasetsUsed,
      familiesIncluded: Object.keys(tradesByFamily),
      tradeCounts: Object.fromEntries(Object.entries(tradesByFamily).map(([f, t]) => [f, t.length])),
      missingEntryTimeByFamily,
      pairwiseOverlap: matrix,
      clusters,
      effectivelyIndependentFamilyCount: clusters.length,
    };
  }

  // ma_dip vs every other net-positive family, DJIA-30 and DJTA-20 (equity markets only, per this item's scope).
  const netPositive = {
    djia30: Object.entries(EXPECTED.djia30).filter(([, v]) => v.avgR > 0 && v.trades > 0).map(([f]) => f),
    djta20: Object.entries(EXPECTED.djta20).filter(([, v]) => v.avgR > 0 && v.trades > 0).map(([f]) => f),
  };
  report.madipVsNetPositiveEquityFamilies = {};
  for (const mkt of ["djia30", "djta20"]) {
    const matrix = report.markets[mkt].pairwiseOverlap;
    const included = report.markets[mkt].familiesIncluded;
    if (!included.includes("ma_dip")) { report.madipVsNetPositiveEquityFamilies[mkt] = "ma_dip excluded from this market (replication mismatch)"; continue; }
    const rows = [];
    for (const other of netPositive[mkt]) {
      if (other === "ma_dip" || !included.includes(other)) continue;
      rows.push({ family: other, ...matrix.ma_dip[other] });
    }
    report.madipVsNetPositiveEquityFamilies[mkt] = rows;
  }

  // Does EQUITIES-ALL-FAMILIES-BASELINE's 10-of-12 DJIA-30 breadth finding survive?
  const djia30NetPositiveIncluded = netPositive.djia30.filter((f) => report.markets.djia30.familiesIncluded.includes(f));
  const djia30Clusters = report.markets.djia30.clusters;
  const clustersContainingNetPositive = djia30Clusters
    .map((c) => c.filter((f) => djia30NetPositiveIncluded.includes(f)))
    .filter((c) => c.length);
  report.tenOfTwelveBreadthSurvives = {
    netPositiveFamiliesDJIA30: djia30NetPositiveIncluded,
    netPositiveFamilyCount: djia30NetPositiveIncluded.length,
    clustersAmongNetPositiveFamilies: clustersContainingNetPositive,
    effectiveIndependentNetPositiveCount: clustersContainingNetPositive.length,
    verdict: clustersContainingNetPositive.length >= djia30NetPositiveIncluded.length
      ? "SURVIVES: every net-positive family lands in its own cluster — no pair reaches the 50% pre-registered overlap threshold, so the 10-of-12 breadth finding is not an artifact of near-duplicate trade sets."
      : `WEAKENED: ${djia30NetPositiveIncluded.length} net-positive families collapse into only ${clustersContainingNetPositive.length} effectively-independent cluster(s) at the pre-registered 50% overlap threshold — the 10-of-12 headline overstates how many independent positive results actually exist.`,
  };

  const saved = saveExperiment("cross-family-trade-overlap-audit", { specification: "cross-family-trade-overlap-audit/v1", split: SPLIT, clusterThreshold: CLUSTER_THRESHOLD }, report);
  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
