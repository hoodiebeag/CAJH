/**
 * FUNDING-CARRY-DECAY-CHECK: historical P&L of a delta-neutral funding-carry position
 * (short perp + long spot, harvesting the funding-rate payment) — pure arithmetic over
 * historical funding rates, reusing derivatives.mjs's existing fetchFundingRates. No live
 * position of either leg is ever placed; this account has no short-position or margin
 * access (confirmed by the human 2026-08-09), so the mechanism is definitionally
 * impossible to trade live on this account as constructed. Research only.
 */
import { loadWatchlist } from "../researchlib.mjs";
import { fetchFundingRates } from "./derivatives.mjs";

const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const HOUR = 3600_000;
const INTERVALS_PER_YEAR = (365 * 24 * HOUR) / HOUR; // Kraken perpetual funding settles hourly

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const stdev = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Annualized return/vol/Sharpe from a series of per-interval carry returns. */
function periodStats(rates) {
  const n = rates.length;
  if (!n) return { intervals: 0, meanIntervalReturn: null, annualizedReturn: null, annualizedVol: null, sharpe: null };
  const m = mean(rates), sd = stdev(rates);
  const annualizedReturn = m * INTERVALS_PER_YEAR;
  const annualizedVol = n > 1 ? sd * Math.sqrt(INTERVALS_PER_YEAR) : null;
  return { intervals: n, meanIntervalReturn: m, annualizedReturn, annualizedVol, sharpe: annualizedVol ? annualizedReturn / annualizedVol : null };
}

/**
 * Short perp + long spot receives the funding rate each interval it's positive (longs pay
 * shorts) and pays it when negative — the rate itself IS the carry position's per-interval
 * return. Spot-vs-perp basis convergence at entry/exit is NOT separately modeled: no
 * matched-timestamp perp price series was fetched, only the funding-rate series. Disclosed
 * as a known simplification, not absorbed silently; for a perpetual (no expiry) held
 * continuously across the window this is a secondary effect against the accumulated
 * funding accrual, not the primary return driver the paper attributes to the strategy.
 */
export async function runFundingCarryDecayCheck({
  watchlist = loadWatchlist(),
  reproStart = Date.parse("2020-01-01T00:00:00Z"),
  reproEnd = Date.parse("2025-01-01T00:00:00Z"),
  recentStart = Date.parse("2025-01-01T00:00:00Z"),
  recentEnd = Date.now(),
  minIntervalsPerAsset = 24 * 20, // ~20 days of hourly funding, floor for an asset to enter a period's pooled series
  refresh = false,
  fetchFunding = fetchFundingRates,
} = {}) {
  const symbols = watchlist.map((a) => (typeof a === "string" ? a : a.symbol));
  const coverage = [];
  const perAssetRepro = [], perAssetRecent = [];
  const pooledRepro = new Map(), pooledRecent = new Map();

  for (const symbol of symbols) {
    const perp = toFuturesSymbol(symbol);
    try {
      const payload = await fetchFunding({ symbol: perp, refresh });
      const points = (payload.rates || [])
        .map((r) => ({ time: Date.parse(r.timestamp), rate: Number(r.relativeFundingRate) }))
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.rate))
        .sort((a, b) => a.time - b.time);
      if (!points.length) { coverage.push({ symbol, perp, included: false, reason: "no-funding-data" }); continue; }
      const reproPts = points.filter((p) => p.time >= reproStart && p.time < reproEnd);
      const recentPts = points.filter((p) => p.time >= recentStart && p.time < recentEnd);
      coverage.push({
        symbol, perp, included: true,
        reproIntervals: reproPts.length, recentIntervals: recentPts.length,
        firstPoint: new Date(points[0].time).toISOString(), lastPoint: new Date(points.at(-1).time).toISOString(),
      });
      if (reproPts.length >= minIntervalsPerAsset) {
        perAssetRepro.push({ symbol, ...periodStats(reproPts.map((p) => p.rate)) });
        for (const p of reproPts) { if (!pooledRepro.has(p.time)) pooledRepro.set(p.time, []); pooledRepro.get(p.time).push(p.rate); }
      }
      if (recentPts.length >= minIntervalsPerAsset) {
        perAssetRecent.push({ symbol, ...periodStats(recentPts.map((p) => p.rate)) });
        for (const p of recentPts) { if (!pooledRecent.has(p.time)) pooledRecent.set(p.time, []); pooledRecent.get(p.time).push(p.rate); }
      }
    } catch (err) {
      coverage.push({ symbol, perp, included: false, reason: `funding-fetch-error: ${err.message}` });
    }
  }

  const pooledSeries = (pooled) => [...pooled.entries()].sort(([a], [b]) => a - b).map(([, rates]) => mean(rates));
  const reproPortfolio = periodStats(pooledSeries(pooledRepro));
  const recentPortfolio = periodStats(pooledSeries(pooledRecent));

  return {
    input: {
      specification: "funding-carry-decay-check/v1",
      reproWindow: [new Date(reproStart).toISOString(), new Date(reproEnd).toISOString()],
      recentWindow: [new Date(recentStart).toISOString(), new Date(recentEnd).toISOString()],
      minIntervalsPerAsset,
      symbols,
      coverage,
      basisNote: "Return computed from the funding-rate accrual only (short-perp collects a positive rate, pays a negative one); spot-vs-perp basis convergence at entry/exit is NOT separately modeled -- no matched-timestamp perp price series was fetched, only the funding-rate series.",
    },
    result: {
      reproduction: { portfolio: reproPortfolio, perAsset: perAssetRepro, assetsIncluded: perAssetRepro.length },
      recent: { portfolio: recentPortfolio, perAsset: perAssetRecent, assetsIncluded: perAssetRecent.length },
    },
  };
}
