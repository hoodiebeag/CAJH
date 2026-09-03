/**
 * grid.mjs — geometric grid range-harvesting SIMULATION ONLY (100-strategy triage #61).
 *
 * Not a live execution module. A market-neutral mechanism: rests N geometrically-spaced
 * price levels per asset, splits capital across the cells between them, and repeatedly
 * buys the dip / sells the bounce within a fixed range — the opposite of a directional
 * entry signal, so it does not belong in tournament.mjs's entry-family harness.
 *
 * Pure simulation functions take an already-built OHLC panel or a bare bar list and do no
 * file I/O, so they're testable against hand-built fixtures independent of the real candle
 * store (same separation dca.mjs/portfolio.mjs use).
 */
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { simulateBuyAndHold } from "./dca.mjs";

// Per-side cost estimate this repo already uses everywhere else (strategy.js FEE_RATE +
// SLIPPAGE_PCT = 0.004 + 0.0005). Unlike DCA, a grid genuinely round-trips (buy AND sell),
// so this rate is applied on both legs rather than once.
export const GRID_COST_RATE = 0.0045;

function panel(watchlist) {
  const normalized = watchlist.map((x) => (typeof x === "string" ? { symbol: x, id: symbolToKrakenId(x) } : x));
  const series = new Map(normalized.map(({ symbol, id }) => [symbol, loadResearchCandles(id, 1440)]));
  // BTC is excluded from the investable universe below, but its candle history can run
  // later than every other symbol's (used elsewhere as a regime reference, not traded here)
  // — build the date calendar from the investable symbols only, or a BTC-only tail would
  // inflate `dates` past every real symbol's last bar and starve the whole holdout window.
  const symbols = [...series.keys()].filter((s) => s !== "BTC");
  // Different symbols' backfills end on different dates (a live collector can be actively
  // fetching some pairs more recently than others, per the repo's standing "never touch
  // candles/, collection may be running" rule). Anchor the calendar on the most common
  // "last bar" date across symbols rather than the latest of all of them, so a couple of
  // freshly-collected outliers don't stretch `dates` into a tail almost nothing else has.
  const lastDateCounts = new Map();
  for (const s of symbols) {
    const last = series.get(s).at(-1)?.time;
    if (last) lastDateCounts.set(last, (lastDateCounts.get(last) || 0) + 1);
  }
  const cutoff = [...lastDateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Infinity;
  const dates = [...new Set(symbols.flatMap((s) => series.get(s).map((x) => x.time)))].filter((d) => d <= cutoff).sort((a, b) => a - b);
  const bars = new Map(symbols.map((s) => [s, new Map(series.get(s).map((x) => [x.time, { high: x.high, low: x.low, close: x.close }]))]));
  const closes = new Map(symbols.map((s) => [s, new Map(series.get(s).map((x) => [x.time, x.close]))]));
  return { symbols, dates, bars, closes };
}

/**
 * N ascending price levels geometrically spaced between the min and max of `closes`
 * (levels[i] = lo * (hi/lo)^(i/(N-1))). Returns null on a degenerate window (no closes, or
 * a perfectly flat window with no range to grid) so callers can skip that asset rather than
 * divide by zero or grid a single point.
 */
export function computeGeometricLevels(closes, N = 10) {
  const valid = closes.filter((c) => c > 0);
  if (!valid.length) return null;
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  if (!(hi > lo)) return null;
  const levels = [];
  for (let i = 0; i < N; i++) levels.push(lo * (hi / lo) ** (i / (N - 1)));
  return levels;
}

/**
 * Simulates resting limit fills bar-by-bar for one asset against a fixed set of levels.
 * N levels define N-1 trading rungs (rung i buys at levels[i], sells at levels[i+1]) — a
 * literal "N=10 levels -> 10 rungs" reading would leave the top level with no level above
 * it to sell at, so it could only ever buy-and-hold once filled, which is not a market-
 * neutral round-trip mechanism. DEVIATION NOTED (surfaced, not hidden): using N-1 rungs
 * from N levels instead, each getting an equal share of capital, so every rung can complete
 * a full buy/sell cycle.
 *
 * Same-bar tie-break: reuses backtest.js's "state as it stood entering the candle"
 * convention (see the stop-checked-before-target comment ahead of its close/target logic).
 * Sells and buys are both evaluated against a snapshot of each rung's holding state taken
 * before either phase runs, so a rung that sells this bar cannot also re-buy the same bar
 * (and vice versa) — only one transition per rung per bar.
 *
 * A rung that sells always replenishes to exactly `capitalPerRung` of fresh buying power
 * (not compounded with its realized P&L) — the round-trip's profit/loss is banked into
 * `realizedPnL` separately, so every cycle trades the same fixed size.
 */
export function simulateGridForAsset(bars, levels, { costRate = 0, capitalPerRung = 1 } = {}) {
  const rungCount = levels.length - 1;
  if (rungCount < 1) throw new Error("need at least 2 levels to form a rung");
  const holding = new Array(rungCount).fill(false);
  const units = new Array(rungCount).fill(0);
  let realizedPnL = 0, roundTrips = 0;
  const totalCapitalAllocated = capitalPerRung * rungCount;
  let peakRatio = 1, maxDrawdownPct = 0;
  const valueCurve = [];
  for (const bar of bars) {
    const enteringHolding = holding.slice();
    // Phase 1 — sells, against entering-bar state.
    for (let i = 0; i < rungCount; i++) {
      if (enteringHolding[i] && bar.high >= levels[i + 1]) {
        const proceeds = units[i] * levels[i + 1] * (1 - costRate);
        realizedPnL += proceeds - capitalPerRung;
        holding[i] = false;
        units[i] = 0;
        roundTrips++;
      }
    }
    // Phase 2 — buys, against the SAME entering-bar state (a rung sold in phase 1 above
    // does not become buy-eligible until the next bar).
    for (let i = 0; i < rungCount; i++) {
      if (!enteringHolding[i] && bar.low <= levels[i]) {
        units[i] = (capitalPerRung * (1 - costRate)) / levels[i];
        holding[i] = true;
      }
    }
    let value = realizedPnL;
    for (let i = 0; i < rungCount; i++) value += holding[i] ? units[i] * bar.close : capitalPerRung;
    valueCurve.push(value);
    const ratio = value / totalCapitalAllocated;
    peakRatio = Math.max(peakRatio, ratio);
    maxDrawdownPct = Math.min(maxDrawdownPct, (ratio - peakRatio) / peakRatio);
  }
  const finalValue = valueCurve.at(-1) ?? totalCapitalAllocated;
  const totalReturn = finalValue / totalCapitalAllocated - 1;
  return { totalCapitalAllocated, finalValue, totalReturn, maxDrawdownPct, roundTrips, valueCurve };
}

/**
 * Runs the full study: for each watchlist asset, grid bounds are computed ONCE from the
 * trailing `lookback` daily closes immediately preceding the holdout split (i.e. the last
 * pre-holdout window), then held fixed for the entire holdout run. This is the bound method
 * used — a trailing rolling min/max of CLOSE, snapshotted at holdout start rather than
 * continuously recomputed, so it uses only data available before the holdout begins (no
 * lookahead) without the added complexity/ambiguity of an unspecified regrid cadence mid-
 * holdout. An asset is skipped (and counted as excluded) if it has fewer than `lookback`
 * pre-holdout closes, a degenerate (flat) pre-holdout window, or any missing/zero bar inside
 * the holdout window itself (grid fills need every holdout bar's high/low, unlike DCA's
 * forward-fill — a gap mid-holdout has no safe fill to substitute for a resting limit
 * order).
 */
export function runGridStudy({ watchlist = loadWatchlist(), splitFraction = 0.70, lookback = 90, N = 10, costRate = GRID_COST_RATE, capitalPerAsset = 1 } = {}) {
  const data = panel(watchlist);
  const split = Math.floor(data.dates.length * splitFraction);
  const holdoutDates = data.dates.slice(split);
  const included = [], excluded = [];
  const perAsset = {};
  let aggValueCurve = null;
  let aggCapital = 0;

  for (const symbol of data.symbols) {
    const closeMap = data.closes.get(symbol);
    const barMap = data.bars.get(symbol);
    const preHoldoutDates = data.dates.slice(Math.max(0, split - lookback), split);
    if (preHoldoutDates.length < lookback) { excluded.push({ symbol, reason: "insufficient pre-holdout history" }); continue; }
    const window = preHoldoutDates.map((d) => closeMap.get(d)).filter((c) => c > 0);
    const levels = computeGeometricLevels(window, N);
    if (!levels) { excluded.push({ symbol, reason: "degenerate (flat) pre-holdout window" }); continue; }

    const holdoutBars = holdoutDates.map((d) => barMap.get(d));
    if (holdoutBars.some((b) => !(b?.high > 0) || !(b?.low > 0))) { excluded.push({ symbol, reason: "missing bar inside holdout window" }); continue; }

    const capitalPerRung = capitalPerAsset / (N - 1);
    const sim = simulateGridForAsset(holdoutBars, levels, { costRate, capitalPerRung });
    const assetCloseData = { symbols: [symbol], dates: data.dates, prices: new Map([[symbol, closeMap]]) };
    const bh = simulateBuyAndHold(assetCloseData, { start: split, end: data.dates.length - 1, costRate });
    perAsset[symbol] = {
      levels, totalReturn: sim.totalReturn, maxDrawdownPct: sim.maxDrawdownPct, roundTrips: sim.roundTrips,
      buyAndHold: { totalReturn: bh.totalReturn, maxDrawdownPct: bh.maxDrawdownPct },
      passesReturn: sim.totalReturn > bh.totalReturn, passesDrawdown: sim.maxDrawdownPct >= bh.maxDrawdownPct,
    };
    included.push(symbol);
    aggValueCurve = aggValueCurve ? aggValueCurve.map((v, i) => v + sim.valueCurve[i]) : sim.valueCurve.slice();
    aggCapital += sim.totalCapitalAllocated;
  }

  const aggBhData = { symbols: included, dates: data.dates, prices: new Map(included.map((s) => [s, data.closes.get(s)])) };
  const aggBh = included.length ? simulateBuyAndHold(aggBhData, { start: split, end: data.dates.length - 1, costRate }) : { totalReturn: 0, maxDrawdownPct: 0 };

  let aggTotalReturn = 0, aggMaxDrawdownPct = 0;
  if (aggValueCurve && aggCapital > 0) {
    aggTotalReturn = aggValueCurve.at(-1) / aggCapital - 1;
    let peak = aggCapital;
    for (const v of aggValueCurve) { peak = Math.max(peak, v); aggMaxDrawdownPct = Math.min(aggMaxDrawdownPct, (v - peak) / peak); }
  }
  const gateReturn = aggTotalReturn > aggBh.totalReturn;
  const gateDrawdown = aggMaxDrawdownPct >= aggBh.maxDrawdownPct;
  const verdict = gateReturn && gateDrawdown
    ? `PASS — holdout total return ${(aggTotalReturn * 100).toFixed(2)}% beats buy-and-hold ${(aggBh.totalReturn * 100).toFixed(2)}%, and max drawdown ${(aggMaxDrawdownPct * 100).toFixed(2)}% is no worse than buy-and-hold's ${(aggBh.maxDrawdownPct * 100).toFixed(2)}%.`
    : `FAIL — return clause ${gateReturn ? "passes" : "fails"} (grid ${(aggTotalReturn * 100).toFixed(2)}% vs buy-and-hold ${(aggBh.totalReturn * 100).toFixed(2)}%), drawdown clause ${gateDrawdown ? "passes" : "fails"} (grid ${(aggMaxDrawdownPct * 100).toFixed(2)}% vs buy-and-hold ${(aggBh.maxDrawdownPct * 100).toFixed(2)}%). Both clauses are required.`;

  const input = { specification: "grid-sim/v1", splitFraction, lookback, N, costRate, capitalPerAsset, boundMethod: "trailing rolling min/max of daily close, snapshotted once at holdout start from the lookback window immediately preceding it", assets: included, excluded };
  const result = { included, excluded, perAsset, aggregate: { totalReturn: aggTotalReturn, maxDrawdownPct: aggMaxDrawdownPct, buyAndHold: { totalReturn: aggBh.totalReturn, maxDrawdownPct: aggBh.maxDrawdownPct }, gateReturn, gateDrawdown }, verdict };
  return { input, result };
}

if (process.argv[1]?.endsWith("grid.mjs")) {
  const report = runGridStudy();
  const saved = saveExperiment("grid-sim", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
