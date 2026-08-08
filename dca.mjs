/**
 * dca.mjs — fixed-interval calendar DCA control baseline (100-strategy triage item #83).
 *
 * Buys a fixed dollar amount every N days, split evenly across whatever watchlist symbols
 * have a valid price that day, completely ignoring price/indicators. Not a hypothesis to
 * pass/kill in isolation — a control baseline other signal families should be measured
 * against. Pure simulation functions take an already-built {symbols, dates, prices} panel
 * (same shape as portfolio.mjs's internal panel()) and do no file I/O, so they're testable
 * against hand-built fixtures independent of the real candle store.
 */
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { simulateSizedEquity } from "./sizing.mjs";

// Single-side cost estimate this repo already uses everywhere else (strategy.js FEE_RATE +
// SLIPPAGE_PCT = 0.004 + 0.0005). DCA only ever buys, never sells, so only one side applies —
// the 0.009 round-trip figure quoted elsewhere in this repo is not the right number here.
export const DCA_COST_RATE = 0.0045;

function panel(watchlist) {
  const normalized = watchlist.map((x) => (typeof x === "string" ? { symbol: x, id: symbolToKrakenId(x) } : x));
  const series = new Map(normalized.map(({ symbol, id }) => [symbol, loadResearchCandles(id, 1440)]));
  const dates = [...new Set([...series.values()].flatMap((xs) => xs.map((x) => x.time)))].sort((a, b) => a - b);
  const prices = new Map([...series].map(([symbol, xs]) => [symbol, new Map(xs.map((x) => [x.time, x.close]))]));
  return { symbols: [...series.keys()].filter((s) => s !== "BTC"), dates, prices };
}

/**
 * Buys `amountPerInterval` every `intervalDays` index-steps, split evenly across symbols
 * with a valid price that day (missing symbols are skipped, not left as undeployed cash —
 * their share goes to whichever symbols do have a price that day). Tracks a NAV-style ratio
 * (portfolio value / capital deployed so far) so drawdown is meaningful despite capital
 * arriving over time rather than all at once; buy-and-hold's equity curve is directly
 * comparable since both start their peak tracking at the nominal 1.0 basis.
 */
export function simulateFixedIntervalDCA(data, { start = 0, end = data.dates.length - 1, intervalDays = 7, amountPerInterval = 1, costRate = DCA_COST_RATE } = {}) {
  const units = new Map(data.symbols.map((s) => [s, 0]));
  const lastKnownPrice = new Map();
  let totalInvested = 0, peakRatio = 1, maxDrawdownPct = 0;
  const valueCurve = [], navCurve = [];
  for (let index = start; index <= end; index++) {
    const date = data.dates[index];
    // Forward-fill: watchlist pairs are collected on slightly different cadences, so a day
    // with no fresh print for a symbol does not mean that position is worthless — it means
    // this data source has no new information yet. Never looks ahead, only carries the last
    // already-elapsed print forward.
    for (const s of data.symbols) {
      const price = data.prices.get(s)?.get(date);
      if (price > 0) lastKnownPrice.set(s, price);
    }
    if ((index - start) % intervalDays === 0) {
      const available = data.symbols.filter((s) => lastKnownPrice.has(s));
      if (available.length) {
        const perSymbol = amountPerInterval / available.length;
        for (const s of available) {
          units.set(s, units.get(s) + (perSymbol * (1 - costRate)) / lastKnownPrice.get(s));
        }
        totalInvested += amountPerInterval;
      }
    }
    const value = data.symbols.reduce((sum, s) => {
      const price = lastKnownPrice.get(s);
      return sum + (price > 0 ? units.get(s) * price : 0);
    }, 0);
    valueCurve.push(value);
    if (totalInvested > 0) {
      const ratio = value / totalInvested;
      navCurve.push(ratio);
      peakRatio = Math.max(peakRatio, ratio);
      maxDrawdownPct = Math.min(maxDrawdownPct, (ratio - peakRatio) / peakRatio);
    }
  }
  const finalValue = valueCurve[valueCurve.length - 1] ?? 0;
  const totalReturn = totalInvested > 0 ? finalValue / totalInvested - 1 : 0;
  return { days: end - start + 1, totalInvested, finalValue, totalReturn, maxDrawdownPct, valueCurve, navCurve };
}

/** Invests 100% of nominal capital (basis 1.0) evenly across available symbols at `start`, holds to `end`. */
export function simulateBuyAndHold(data, { start = 0, end = data.dates.length - 1, costRate = DCA_COST_RATE } = {}) {
  const startDate = data.dates[start];
  const available = data.symbols.filter((s) => data.prices.get(s)?.get(startDate) > 0);
  const perSymbol = available.length ? 1 / available.length : 0;
  const units = new Map(available.map((s) => [s, (perSymbol * (1 - costRate)) / data.prices.get(s).get(startDate)]));
  const lastKnownPrice = new Map(available.map((s) => [s, data.prices.get(s).get(startDate)]));
  let peak = 1, maxDrawdownPct = 0;
  const valueCurve = [];
  for (let index = start; index <= end; index++) {
    const date = data.dates[index];
    // Forward-fill, same rationale as simulateFixedIntervalDCA: a stale day for one pair
    // should not mark that position to zero.
    for (const s of available) {
      const price = data.prices.get(s)?.get(date);
      if (price > 0) lastKnownPrice.set(s, price);
    }
    const value = available.reduce((sum, s) => {
      const price = lastKnownPrice.get(s);
      return sum + (price > 0 ? units.get(s) * price : 0);
    }, 0);
    valueCurve.push(value);
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.min(maxDrawdownPct, peak > 0 ? (value - peak) / peak : 0);
  }
  const finalValue = valueCurve[valueCurve.length - 1] ?? 0;
  return { days: end - start + 1, totalReturn: finalValue - 1, maxDrawdownPct, valueCurve };
}

// Cited from TOURNAMENT_ROADMAP.md / VERDICTS.md T1-ZEROCOST: breakout is the one baseline
// family with a positive zero-cost signal, but net-of-cost it is still the strongest of the
// eight tested families by holdout avgR/trade — a per-trade R stat, not a portfolio return,
// so this is reported for a plain-language comparison, not unit-converted against it.
const BREAKOUT_HOLDOUT_AVG_R = -0.445;
const BREAKOUT_HOLDOUT_TRADES = 3123;

export function runFixedIntervalDCAStudy({ watchlist = loadWatchlist(), splitFraction = 0.70, intervalDays = 7, costRate = DCA_COST_RATE } = {}) {
  const data = panel(watchlist);
  const split = Math.floor(data.dates.length * splitFraction);
  const start = split, end = data.dates.length - 1;
  const dca = simulateFixedIntervalDCA(data, { start, end, intervalDays, costRate });
  const buyHold = simulateBuyAndHold(data, { start, end, costRate });
  const dcaBeatsBreakout = dca.totalReturn > 0;
  const comparison = dcaBeatsBreakout
    ? `DCA holdout total return ${(dca.totalReturn * 100).toFixed(2)}% is positive; breakout's net-of-cost holdout avgR is -0.445R/trade (negative expectancy, ${BREAKOUT_HOLDOUT_TRADES} trades) — blind calendar DCA beats the strongest tested signal family on this holdout window.`
    : `DCA holdout total return ${(dca.totalReturn * 100).toFixed(2)}% is also negative; breakout's net-of-cost holdout avgR is -0.445R/trade (${BREAKOUT_HOLDOUT_TRADES} trades) — neither beats a no-signal baseline on this holdout window, though they are not directly unit-comparable (per-trade R vs portfolio return).`;
  const verdict = "CONTROL BASELINE, not a pass/kill hypothesis. " + comparison;
  const input = { specification: "dca-fixed-interval/v1", assets: data.symbols, splitFraction, intervalDays, costRate, breakoutReference: { avgR: BREAKOUT_HOLDOUT_AVG_R, trades: BREAKOUT_HOLDOUT_TRADES } };
  const result = { dca: { totalInvested: dca.totalInvested, finalValue: dca.finalValue, totalReturn: dca.totalReturn, maxDrawdownPct: dca.maxDrawdownPct, days: dca.days }, buyAndHold: { totalReturn: buyHold.totalReturn, maxDrawdownPct: buyHold.maxDrawdownPct, days: buyHold.days }, verdict };
  return { input, result };
}

/**
 * Turns each fixed-interval DCA buy into a discrete "trade" for sizing.mjs's harness:
 * `r` is the basket's equal-weighted return from that interval's purchase prices to the
 * study's end date (mark-to-market at the holdout end), so a continuously-held DCA
 * position becomes the chronological trade list simulateSizedEquity expects. This lets
 * DCA-MARTINGALE/DCA-ANTIMARTINGALE reuse the doubling/reset/cap logic DCA-SIZING-HARNESS
 * already built and tested, instead of re-deriving it here.
 */
export function buildIntervalTrades(data, { start = 0, end = data.dates.length - 1, intervalDays = 7 } = {}) {
  const lastKnownPrice = new Map();
  const entries = [];
  for (let index = start; index <= end; index++) {
    const date = data.dates[index];
    for (const s of data.symbols) {
      const price = data.prices.get(s)?.get(date);
      if (price > 0) lastKnownPrice.set(s, price);
    }
    if ((index - start) % intervalDays === 0) {
      const available = data.symbols.filter((s) => lastKnownPrice.has(s));
      if (available.length) entries.push({ timestamp: date, entryPrices: new Map(available.map((s) => [s, lastKnownPrice.get(s)])) });
    }
  }
  const endPrices = lastKnownPrice; // after the loop above, forward-filled through `end`
  return entries.map(({ timestamp, entryPrices }) => {
    const rets = [...entryPrices].filter(([s]) => endPrices.has(s)).map(([s, p]) => endPrices.get(s) / p - 1);
    const r = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    return { timestamp, r };
  });
}

/**
 * Runs a sizing-rule variant of fixed-interval DCA: instead of a constant amount per
 * interval, the amount committed doubles (capped at cap) after a losing interval
 * (martingale) or winning interval (antimartingale), resetting to baseUnit otherwise -
 * see sizing.mjs's nextMultiplier for the exact rule. Compares against the plain
 * fixed-interval DCA baseline (DCA-FIXED-INTERVAL) over the identical holdout window.
 * Not directly apples-to-apples: the sized variant's equity curve starts at baseUnit and
 * is capital-at-risk-weighted (sizing.mjs's model), while the fixed-interval baseline's
 * NAV curve is invested-capital-weighted (a growing base as more cash arrives) - both are
 * reported, neither is unit-converted into the other.
 */
function runSizedDCAStudy(rule, { watchlist = loadWatchlist(), splitFraction = 0.70, intervalDays = 7, cap = 4, baseUnit = 1, costRate = DCA_COST_RATE } = {}) {
  const data = panel(watchlist);
  const split = Math.floor(data.dates.length * splitFraction);
  const start = split, end = data.dates.length - 1;
  const rawTrades = buildIntervalTrades(data, { start, end, intervalDays });
  const trades = rawTrades.map((t) => ({ ...t, r: (1 - costRate) * (1 + t.r) - 1 }));
  const sized = simulateSizedEquity(trades, { rule, cap, baseUnit, startingCapital: baseUnit });
  const fixed = simulateFixedIntervalDCA(data, { start, end, intervalDays, costRate });
  const ruinNote = sized.ruin ? " Equity hit zero or below during the run (ruin=true)." : " No ruin (equity stayed positive throughout).";
  const comparison = `${rule} DCA: avgR/unit-capital ${sized.avgRPerUnitCapital.toFixed(4)} across ${sized.trades} intervals, max drawdown ${(sized.maxDrawdownPct * 100).toFixed(2)}%.${ruinNote} Fixed-interval DCA baseline over the same window: total return ${(fixed.totalReturn * 100).toFixed(2)}%, max drawdown ${(fixed.maxDrawdownPct * 100).toFixed(2)}%. Not directly comparable (per-unit-capital R vs invested-capital NAV return) but both measure the same holdout window and mechanism family.`;
  const verdict = "CONTROL BASELINE VARIANT, not a pass/kill hypothesis. " + comparison;
  const input = { specification: `dca-${rule}/v1`, assets: data.symbols, splitFraction, intervalDays, cap, baseUnit, costRate };
  const result = {
    sized: { rule, trades: sized.trades, totalCapitalCommitted: sized.totalCapitalCommitted, totalPnL: sized.totalPnL, avgRPerUnitCapital: sized.avgRPerUnitCapital, maxDrawdownPct: sized.maxDrawdownPct, ruin: sized.ruin },
    fixedIntervalBaseline: { totalReturn: fixed.totalReturn, maxDrawdownPct: fixed.maxDrawdownPct, days: fixed.days },
    verdict,
  };
  return { input, result };
}

export const runMartingaleDCAStudy = (opts) => runSizedDCAStudy("martingale", opts);

if (process.argv[1]?.endsWith("dca.mjs")) {
  const which = process.argv[2] || "fixed-interval";
  const report = which === "martingale" ? runMartingaleDCAStudy() : runFixedIntervalDCAStudy();
  const saved = saveExperiment(`dca-${which}`, report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
