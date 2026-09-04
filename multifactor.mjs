/**
 * multifactor.mjs -- three variations on the cross-sectional winner, each a DIFFERENT mechanism.
 *
 * The lesson from the entry-timing failure was not "test more configurations". It was that the
 * space of possible edges has dimensions -- when to enter, WHICH asset, how much, whether to be in
 * at all, against what, across what, and on what signal -- and only one of them had been explored.
 * These three occupy different cells, so they can fail independently. A variation that merely
 * re-parameterises the winner would tell us nothing new.
 *
 * V1 TIME-SERIES MOMENTUM (the "whether" cell).
 *   Cross-sectional asks which asset is strongest relative to its peers. Time-series asks whether
 *   an asset is rising relative to ITS OWN past, independent of everyone else. They are separately
 *   documented -- Moskowitz, Ooi and Pedersen for the time-series version -- and they disagree
 *   often: in a market where everything falls, cross-sectional is fully invested in the least-bad
 *   name while time-series is flat. That difference is the entire point.
 *
 * V2 MULTI-HORIZON ENSEMBLE (the "what signal" cell, and an answer to best-of-N).
 *   One 252-bar lookback is a single point estimate that happened to work. Averaging the rank
 *   across 21/63/126/252 makes the signal a consensus rather than a choice, which both removes the
 *   dependence on one parameter and admits a name only when several horizons agree. It should
 *   raise the trade count -- more names qualify at reduced conviction -- while reducing the chance
 *   that the whole result rests on one lucky window.
 *
 * V3 VOLATILITY-SCALED POSITIONS (the "how much" cell).
 *   Equal weighting gives a 60%-volatility name the same influence as a 15% one, so the book's
 *   risk is dominated by whatever happens to be wildest. Sizing inversely to trailing volatility
 *   equalises RISK contribution instead of dollars. This is the most reliably documented Sharpe
 *   improver in the trend-following literature and it changes no entry or exit decision at all --
 *   only how much of each.
 *
 * All three are composable, and are written to be. The eventual book is not one of them.
 */

import { formationReturn } from "./xsmom.mjs";

/** Shared calendar and forward-filled close grid. Symbols start on different dates; index is not date. */
export function buildGrid(series) {
  const symbols = Object.keys(series);
  const times = [...new Set(symbols.flatMap((s) => series[s].map((c) => Number(c.time))))].sort((a, b) => a - b);
  const grid = {};
  for (const s of symbols) {
    const m = new Map();
    for (const c of series[s]) m.set(Number(c.time), Number(c.close));
    const arr = new Array(times.length).fill(null);
    let last = null;
    for (let i = 0; i < times.length; i++) {
      const v = m.get(times[i]);
      if (v !== undefined && v > 0) last = v;
      arr[i] = last;
    }
    grid[s] = arr;
  }
  return { symbols, times, grid };
}

/** Trailing volatility of log returns, annualised. Null until the window fills. */
export function trailingVol(closes, i, window = 63, barsPerYear = 252) {
  if (i < window) return null;
  const rs = [];
  for (let j = i - window + 1; j <= i; j++) {
    const a = closes[j - 1], b = closes[j];
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < window / 2) return null;
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1);
  return Math.sqrt(v * barsPerYear);
}

/** V2: average percentile rank across several horizons. 1 = strongest by consensus. */
export function ensembleScore(closes, i, horizons, skipBars, allCloses) {
  const scores = [];
  for (const h of horizons) {
    const own = formationReturn(closes, i, h, skipBars);
    if (own === null) continue;
    let below = 0, total = 0;
    for (const other of allCloses) {
      const r = formationReturn(other, i, h, skipBars);
      if (r === null) continue;
      total++;
      if (r < own) below++;
    }
    if (total > 1) scores.push(below / (total - 1));
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * Run a book. `mode` selects the variation; they compose because each touches a different stage:
 * V1 filters WHETHER a name is eligible, V2 changes HOW it is ranked, V3 changes HOW MUCH is held.
 */
export function runBook({
  series, lookbackBars = 252, skipBars = 21, rebalanceBars = 21, topK = 10,
  slipPct = 0.0005, borrow = 0, startingBalance = 1000,
  timeSeriesFilter = false,      // V1
  horizons = null,               // V2, e.g. [21, 63, 126, 252]
  volScaled = false, volWindow = 63, volTarget = 0.20, volClamp = 3,   // V3
  longOnly = false,
} = {}) {
  const { symbols, times, grid } = buildGrid(series);
  const warmup = Math.max(lookbackBars, ...(horizons ?? [0])) + skipBars;

  let balance = startingBalance, peak = startingBalance, maxDD = 0;
  let book = [];                                  // [{ symbol, weight }] signed
  const returns = [], rebalanceLog = [];

  for (let i = warmup; i < times.length; i++) {
    if (book.length) {
      let r = 0;
      for (const p of book) {
        const a = grid[p.symbol][i - 1], b = grid[p.symbol][i];
        if (a > 0 && b > 0) r += p.weight * Math.log(b / a);
      }
      r -= borrow / 12 / rebalanceBars * book.filter((p) => p.weight < 0).reduce((a, p) => a + Math.abs(p.weight), 0) * rebalanceBars / 21;
      balance *= Math.exp(r);
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, (peak - balance) / peak);
    }

    if ((i - warmup) % rebalanceBars !== 0) continue;

    const allCloses = symbols.map((s) => grid[s]).filter((c) => c[i] > 0);
    const scored = [];
    for (const s of symbols) {
      const closes = grid[s];
      if (!(closes[i] > 0)) continue;
      // V1: a name is only eligible if it is rising against its OWN past.
      if (timeSeriesFilter) {
        const own = formationReturn(closes, i, lookbackBars, skipBars);
        if (own === null) continue;
        if (own <= 0) { scored.push({ symbol: s, score: null, tsPositive: false }); continue; }
      }
      const score = horizons
        ? ensembleScore(closes, i, horizons, skipBars, allCloses)
        : formationReturn(closes, i, lookbackBars, skipBars);
      if (score === null) continue;
      scored.push({ symbol: s, score, tsPositive: true });
    }

    const eligible = scored.filter((x) => x.score !== null);
    if (eligible.length < topK * (longOnly ? 1 : 2)) continue;
    eligible.sort((a, b) => b.score - a.score);
    const longs = eligible.slice(0, topK).map((x) => x.symbol);
    const shorts = longOnly ? [] : eligible.slice(-topK).map((x) => x.symbol);

    // V3: size inversely to trailing volatility so each name contributes equal RISK, not equal
    // dollars. Clamped, because a quiet name would otherwise be sized without bound.
    const weightFor = (s, side) => {
      if (!volScaled) return side / (longOnly ? topK : 2 * topK);
      const v = trailingVol(grid[s], i, volWindow);
      if (!(v > 0)) return side / (longOnly ? topK : 2 * topK);
      const mult = Math.min(volClamp, Math.max(1 / volClamp, volTarget / v));
      return side * mult / (longOnly ? topK : 2 * topK);
    };
    const next = [
      ...longs.map((s) => ({ symbol: s, weight: weightFor(s, +1) })),
      ...shorts.map((s) => ({ symbol: s, weight: weightFor(s, -1) })),
    ];

    const prev = new Map(book.map((p) => [p.symbol, p.weight]));
    let turnover = 0;
    for (const p of next) turnover += Math.abs(p.weight - (prev.get(p.symbol) ?? 0));
    for (const p of book) if (!next.find((q) => q.symbol === p.symbol)) turnover += Math.abs(p.weight);
    balance *= 1 - slipPct * turnover;

    if (returns.length || rebalanceLog.length) returns.push(Math.log(balance / (rebalanceLog.at(-1)?.balance ?? balance)));
    rebalanceLog.push({ at: times[i], longs: longs.length, shorts: shorts.length, turnover: +turnover.toFixed(3), balance });
    book = next;
  }

  const periods = rebalanceLog.length;
  const years = periods * rebalanceBars / 252;
  const positions = rebalanceLog.reduce((a, r) => a + r.longs + r.shorts, 0);
  return {
    finalBalance: +balance.toFixed(2),
    cagrPct: years > 0 ? +(((balance / startingBalance) ** (1 / years) - 1) * 100).toFixed(2) : null,
    maxDrawdownPct: +(100 * maxDD).toFixed(2),
    periods, positions,
    avgTurnover: periods ? +(rebalanceLog.reduce((a, r) => a + r.turnover, 0) / periods).toFixed(3) : 0,
    returns, rebalanceLog,
  };
}
