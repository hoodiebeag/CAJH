/** Research-only daily portfolio simulator: targets, cash, turnover, and walk-forward splits. */
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";

const DAY = 86400;
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev = (xs) => xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : 0;
const normalize = (xs) => xs.map((x) => typeof x === "string" ? { symbol: x, id: symbolToKrakenId(x) } : x);

function panel(watchlist) {
  const series = new Map(normalize(watchlist).map(({ symbol, id }) => [symbol, loadResearchCandles(id, 1440)]));
  const dates = [...new Set([...series.values()].flatMap((xs) => xs.map((x) => x.time)))].sort((a, b) => a - b);
  const prices = new Map([...series].map(([symbol, xs]) => [symbol, new Map(xs.map((x) => [x.time, x.close]))]));
  return { symbols: [...series.keys()].filter((s) => s !== "BTC"), dates, prices };
}
function returns(prices, dateIndex, dates, symbol, days) {
  const now = prices.get(symbol)?.get(dates[dateIndex]), then = prices.get(symbol)?.get(dates[dateIndex - days]);
  return now > 0 && then > 0 ? Math.log(now / then) : null;
}
function normalizeWeights(scores, topN, inverseVol = false) {
  const chosen = [...scores].sort((a, b) => b.score - a.score).slice(0, topN).filter((x) => Number.isFinite(x.score));
  const total = chosen.reduce((sum, x) => sum + (inverseVol ? 1 / x.vol : 1), 0);
  return new Map(chosen.map((x) => [x.symbol, (inverseVol ? 1 / x.vol : 1) / total]));
}
function normalizeShortWeights(scores, topN) {
  const chosen = [...scores].sort((a, b) => a.score - b.score).slice(0, topN).filter((x) => Number.isFinite(x.score));
  return new Map(chosen.map((x) => [x.symbol, -1 / chosen.length]));
}

export const portfolioStrategies = {
  equal_weight: () => ({ target: null, label: "equal-weight universe" }),
  momentum_30d: ({ symbols, prices, dates, index }) => ({
    label: "30d relative strength top 5",
    target: normalizeWeights(symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 })), 5),
  }),
  momentum_vol: ({ symbols, prices, dates, index }) => {
    const scores = symbols.map((symbol) => {
      const daily = Array.from({ length: 30 }, (_, j) => returns(prices, index - j, dates, symbol, 1)).filter(Number.isFinite);
      return { symbol, score: returns(prices, index, dates, symbol, 30), vol: stdev(daily) };
    }).filter((x) => x.vol > 0);
    return { label: "30d momentum, inverse-vol top 5", target: normalizeWeights(scores, 5, true) };
  },
  trend_momentum: ({ symbols, prices, dates, index }) => {
    const scores = symbols.map((symbol) => {
      const price = prices.get(symbol)?.get(dates[index]);
      const ma = mean(Array.from({ length: 200 }, (_, j) => prices.get(symbol)?.get(dates[index - j])).filter(Number.isFinite));
      return { symbol, score: price > ma ? returns(prices, index, dates, symbol, 30) : -Infinity, vol: 1 };
    });
    return { label: "200d trend-gated momentum top 5", target: normalizeWeights(scores, 5) };
  },
  btc_regime_momentum: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    if (!(btc > btcMa)) return { label: "BTC 200d regime momentum top 5", target: new Map() };
    return {
      label: "BTC 200d regime momentum top 5",
      target: normalizeWeights(symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 })), 5),
    };
  },
  btc_strong_trend_momentum: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    // Demand a meaningful cushion above the long-term trend, not a one-day MA cross.
    if (!(btc > btcMa * 1.05)) return { label: "BTC strong-trend momentum top 5", target: new Map() };
    return {
      label: "BTC strong-trend momentum top 5",
      target: normalizeWeights(symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 })), 5),
    };
  },
  btc_bear_short_momentum: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    if (!(btc < btcMa)) return { label: "BTC bear-regime short weakest 5", target: new Map() };
    return {
      label: "BTC bear-regime short weakest 5",
      target: normalizeShortWeights(symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30) })), 5),
    };
  },
  btc_regime_long_short: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    const scores = symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 }));
    return btc > btcMa
      ? { label: "BTC regime long leaders / short laggards", target: normalizeWeights(scores, 5) }
      : { label: "BTC regime long leaders / short laggards", target: normalizeShortWeights(scores, 5) };
  },
  short_signal_cash_gate: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    const btc30d = returns(prices, index, dates, "BTC", 30);
    // This is the spot-safe translation of a short candidate: confirmed broad weakness
    // means cash; a positive 30d recovery may qualify for long selection before MA reclaim.
    if (btc < btcMa && btc30d < 0) return { label: "short-signal cash gate + long leaders", target: new Map() };
    return {
      label: "short-signal cash gate + long leaders",
      target: normalizeWeights(symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 })), 5),
    };
  },
  breadth_short_signal_cash_gate: ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const btcMa = mean(Array.from({ length: 200 }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    const btc7d = returns(prices, index, dates, "BTC", 7);
    const scores = symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 }));
    const breadth = scores.filter((x) => x.score < 0).length / Math.max(1, scores.filter((x) => Number.isFinite(x.score)).length);
    // A short candidate needs market trend, immediate weakness, and broad confirmation.
    if (btc < btcMa && btc7d < 0 && breadth >= .70) return { label: "breadth short-signal cash gate + long leaders", target: new Map() };
    return { label: "breadth short-signal cash gate + long leaders", target: normalizeWeights(scores, 5) };
  },
  mean_reversion_7d: ({ symbols, prices, dates, index }) => ({
    label: "7d relative reversal top 5",
    target: normalizeWeights(symbols.map((symbol) => ({ symbol, score: -returns(prices, index, dates, symbol, 7), vol: 1 })), 5),
  }),
};

/** Simulate one strategy without look-ahead: target at close t, returns begin t→t+1. */
export function simulatePortfolio(data, strategy, { start = 200, end = data.dates.length - 1, rebalanceDays = 7, costRate = .009 } = {}) {
  let equity = 1, peak = 1, maxDrawdown = 0, weights = new Map(), turnover = 0; const dailyReturns = [];
  for (let index = start; index < end; index++) {
    const rebalance = (index - start) % rebalanceDays === 0;
    if (rebalance) {
      const next = strategy({ ...data, index }).target ?? new Map(data.symbols.map((s) => [s, 1 / data.symbols.length]));
      const symbols = new Set([...weights.keys(), ...next.keys()]);
      const changed = .5 * [...symbols].reduce((sum, symbol) => sum + Math.abs((weights.get(symbol) || 0) - (next.get(symbol) || 0)), 0);
      equity *= 1 - changed * costRate; turnover += changed; weights = next;
    }
    // A weighted symbol can go a day without a fresh print (staggered collection cadence)
    // or stop being collected entirely (dead pair). Freezing that weight at a phantom 0%
    // forever is a no-op only for a transient gap; for a permanent stop it silently mutes
    // that slice of the portfolio for the rest of the run instead of reflecting that the
    // capital isn't really sitting idle. Exclude unpriced symbols from today's return and
    // renormalize across whichever weighted symbols DO have a priced move today, so the
    // realized return reflects full deployment among tradable (priced) positions — the same
    // "stale data isn't tradable" stance `returns()` already takes when ranking candidates.
    const priced = [...weights].map(([symbol, weight]) => {
      const a = data.prices.get(symbol)?.get(data.dates[index]), b = data.prices.get(symbol)?.get(data.dates[index + 1]);
      return a > 0 && b > 0 ? { weight, ret: b / a - 1 } : null;
    }).filter(Boolean);
    const activeWeight = priced.reduce((sum, x) => sum + x.weight, 0);
    const nextReturn = activeWeight > 0 ? priced.reduce((sum, x) => sum + x.weight * x.ret, 0) / activeWeight : 0;
    equity *= 1 + nextReturn; dailyReturns.push(nextReturn); peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }
  const totalReturn = equity - 1, volatility = stdev(dailyReturns) * Math.sqrt(365), annualReturn = dailyReturns.length ? equity ** (365 / dailyReturns.length) - 1 : 0;
  return { days: dailyReturns.length, totalReturn, annualReturn, volatility, sharpe: volatility ? annualReturn / volatility : 0, maxDrawdown, turnover, averageDailyReturn: mean(dailyReturns) };
}

export function runPortfolioStudy({ watchlist = loadWatchlist(), splitFraction = .70 } = {}) {
  const data = panel(watchlist), split = Math.floor(data.dates.length * splitFraction), results = [];
  for (const [id, strategy] of Object.entries(portfolioStrategies)) for (const rebalanceDays of [7, 30]) {
    const train = simulatePortfolio(data, strategy, { start: 200, end: split, rebalanceDays });
    const holdout = simulatePortfolio(data, strategy, { start: split, end: data.dates.length - 1, rebalanceDays });
    results.push({ id: `${id}_${rebalanceDays}d`, label: `${strategy({ ...data, index: Math.min(200, data.dates.length - 1) }).label} (${rebalanceDays}d rebalance)`, train, holdout,
      promoted: train.sharpe > .5 && holdout.sharpe > .5 && holdout.totalReturn > 0 && holdout.maxDrawdown > -.35 });
  }
  const input = { specification: "portfolio-study/v1", assets: data.symbols, splitFraction, rebalanceDays: [7, 30], costRate: .009 };
  const result = { results, verdict: results.some((x) => x.promoted) ? "paper-trading portfolio candidate exists; no live promotion" : "no portfolio candidate passes both walk-forward samples" };
  return { input, result };
}

/**
 * Train-only search for a spot-safe short classifier. A positive classifier output means
 * cash, not a short order. Holdout rows are scored only after the train ranking is fixed.
 */
export function runRiskOffSearch({ watchlist = loadWatchlist(), splitFraction = .70, reportTop = 12 } = {}) {
  const data = panel(watchlist), split = Math.floor(data.dates.length * splitFraction);
  const configs = [];
  for (const maDays of [100, 200]) for (const returnDays of [7, 14, 30]) for (const returnThreshold of [-.03, 0]) for (const breadthThreshold of [.5, .7, .9]) for (const volatilityThreshold of [0, .03, .05]) {
    configs.push({ maDays, returnDays, returnThreshold, breadthThreshold, volatilityThreshold });
  }
  const makeStrategy = (cfg) => ({ symbols, prices, dates, index }) => {
    const btc = prices.get("BTC")?.get(dates[index]);
    const ma = mean(Array.from({ length: cfg.maDays }, (_, j) => prices.get("BTC")?.get(dates[index - j])).filter(Number.isFinite));
    const btcReturn = returns(prices, index, dates, "BTC", cfg.returnDays);
    const btcVolatility = stdev(Array.from({ length: 20 }, (_, j) => returns(prices, index - j, dates, "BTC", 1)).filter(Number.isFinite));
    const scores = symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30), vol: 1 }));
    const valid = scores.filter((x) => Number.isFinite(x.score));
    const breadth = valid.filter((x) => x.score < 0).length / Math.max(1, valid.length);
    const riskOff = btc < ma && btcReturn < cfg.returnThreshold && breadth >= cfg.breadthThreshold && btcVolatility >= cfg.volatilityThreshold;
    return { target: riskOff ? new Map() : normalizeWeights(scores, 5) };
  };
  const ranked = configs.map((config) => ({ config, train: simulatePortfolio(data, makeStrategy(config), { start: 200, end: split, rebalanceDays: 7 }) }))
    .sort((a, b) => b.train.sharpe - a.train.sharpe);
  const finalists = ranked.slice(0, reportTop).map((row) => ({ ...row, holdout: simulatePortfolio(data, makeStrategy(row.config), { start: split, end: data.dates.length - 1, rebalanceDays: 7 }) }))
    .map((row) => ({ ...row, promoted: row.train.sharpe > .5 && row.holdout.sharpe > .5 && row.holdout.totalReturn > 0 && row.holdout.maxDrawdown > -.35 }));
  const input = { specification: "risk-off-search/v1", splitFraction, candidateCount: configs.length, selection: "highest train Sharpe only" };
  const result = { finalists, verdict: finalists.some((x) => x.promoted) ? "paper-trading cash-gate candidate exists; no live promotion" : "no train-selected cash gate survives the holdout gate" };
  return { input, result };
}

if (process.argv[1]?.endsWith("portfolio.mjs")) {
  const report = runPortfolioStudy(); const saved = saveExperiment("portfolio-study", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
