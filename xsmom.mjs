/**
 * xsmom.mjs -- cross-sectional momentum, the thing this project has never actually tested.
 *
 * WHY IT IS NEW HERE. Everything before this asked "given that I am trading symbol X, is my
 * ENTRY TIMING better than random?" -- and the matched-geometry null answers that by drawing
 * random entries FROM THE SAME SYMBOLS IN THE SAME PROPORTIONS. That design deliberately holds
 * symbol selection constant, so it is blind by construction to an edge that lives in WHICH asset
 * you hold rather than WHEN you buy it. Cross-sectional momentum is exactly that kind of edge,
 * and it is among the most replicated results in the literature: Jegadeesh and Titman (1993),
 * still present in their own 2023 follow-up, and time-series momentum with post-crisis Sharpe
 * ratios comparable to pre-2008 (Moskowitz, Ooi and Pedersen; Baltas and Kosowski 2020).
 *
 * THE RULE. At each rebalance, rank every symbol with enough history by its return over the
 * formation window, skipping the most recent `skipBars`. Hold the top `topK`, equally weighted,
 * until the next rebalance. That is the whole strategy: no stop, no target, no entry trigger.
 *
 * The skip is not decoration. The classic construction skips the most recent month because
 * short-horizon reversal runs the other way, and a 12-month lookback that includes it measures
 * two opposing effects at once.
 *
 * THE NULL THAT MATTERS. Random SELECTION: at each rebalance pick topK symbols uniformly from the
 * same eligible set and hold them the same way. That isolates the ranking, which is the only
 * thing the strategy does. An equal-weight hold of everything is reported alongside it, because a
 * rotation that merely tracks the basket has found nothing.
 */

import { seededRng } from "./inference.mjs";

/** Total return over [t - lookback, t - skip], in log space. Null when history is short. */
export function formationReturn(closes, i, lookbackBars, skipBars) {
  const end = i - skipBars, start = i - lookbackBars;
  if (start < 0 || end <= start) return null;
  const a = closes[start], b = closes[end];
  if (!(a > 0) || !(b > 0)) return null;
  return Math.log(b / a);
}

/**
 * Run the rotation over an aligned calendar.
 *
 * `series` is { symbol: candles }. Bars are aligned by TIME, not index: symbols start on different
 * dates and indexing by position would compare one symbol's 2023 against another's 2025.
 */
export function runRotation({
  series, lookbackBars = 252, skipBars = 21, rebalanceBars = 21, topK = 10,
  slipPct = 0.0005, startingBalance = 1000, select = null,
  // "top" holds the strongest by formation return, "bottom" the weakest. The bottom leg is not a
  // curiosity: if the ranking carries information, the two legs must diverge, and their SPREAD is
  // the part that does not depend on the market going up.
  pick = "top",
} = {}) {
  const symbols = Object.keys(series);
  if (!symbols.length) throw new Error("xsmom: no symbols");

  // One calendar: every timestamp any symbol trades on, ascending.
  const times = [...new Set(symbols.flatMap((s) => series[s].map((c) => Number(c.time))))].sort((a, b) => a - b);
  const closeAt = {};
  for (const s of symbols) {
    const m = new Map();
    for (const c of series[s]) m.set(Number(c.time), Number(c.close));
    closeAt[s] = m;
  }
  // Per-symbol close arrays indexed on the SHARED calendar, so ranking compares like with like.
  const grid = {};
  for (const s of symbols) {
    const arr = new Array(times.length).fill(null);
    let last = null;
    for (let i = 0; i < times.length; i++) {
      const v = closeAt[s].get(times[i]);
      if (v !== undefined && v > 0) last = v;
      arr[i] = last;                      // carry the last known close; null before the symbol starts
    }
    grid[s] = arr;
  }

  let balance = startingBalance, peak = startingBalance, maxDD = 0;
  let held = [];
  const curve = [], rebalances = [];
  let periodReturns = [];

  for (let i = lookbackBars; i < times.length; i++) {
    // Mark the book to market on every bar, so the drawdown is a real path and not a rebalance
    // snapshot. Held names that have stopped trading carry their last close and contribute 0.
    if (held.length) {
      let r = 0;
      for (const s of held) {
        const a = grid[s][i - 1], b = grid[s][i];
        if (a > 0 && b > 0) r += Math.log(b / a) / held.length;
      }
      balance *= Math.exp(r);
      if (balance > peak) peak = balance;
      maxDD = Math.max(maxDD, (peak - balance) / peak);
    }

    if ((i - lookbackBars) % rebalanceBars !== 0) continue;

    const eligible = symbols.filter((s) => {
      const f = formationReturn(grid[s], i, lookbackBars, skipBars);
      return f !== null && grid[s][i] > 0;
    });
    if (eligible.length < topK) continue;

    const ranked = eligible
      .map((s) => [s, formationReturn(grid[s], i, lookbackBars, skipBars)])
      .sort((a, b) => (pick === "bottom" ? a[1] - b[1] : b[1] - a[1]));
    const chosen = select ? select(eligible, i) : ranked.slice(0, topK).map(([s]) => s);

    // Turnover cost: only the names actually swapped pay, on both the sale and the purchase.
    const keep = chosen.filter((s) => held.includes(s)).length;
    const turnover = held.length ? (chosen.length - keep) / chosen.length : 1;
    balance *= 1 - 2 * slipPct * turnover;

    rebalances.push({ at: times[i], chosen, turnover: +turnover.toFixed(3) });
    if (curve.length) periodReturns.push(Math.log(balance / curve[curve.length - 1].balance));
    held = chosen;
    curve.push({ at: times[i], balance });
  }

  const years = (times[times.length - 1] - times[lookbackBars]) / (365.25 * 86400);
  return {
    finalBalance: +balance.toFixed(2),
    totalReturnPct: +((balance / startingBalance - 1) * 100).toFixed(2),
    cagrPct: years > 0 ? +(((balance / startingBalance) ** (1 / years) - 1) * 100).toFixed(2) : null,
    maxDrawdownPct: +(maxDD * 100).toFixed(2),
    rebalances: rebalances.length,
    avgTurnover: rebalances.length ? +(rebalances.reduce((a, r) => a + r.turnover, 0) / rebalances.length).toFixed(3) : 0,
    years: +years.toFixed(2),
    curve, rebalanceLog: rebalances, periodReturns,
  };
}

/** Random SELECTION null: the same machinery, choosing uniformly instead of by rank. */
export function randomSelectionNull(opts, { draws = 200, seed = 20260904 } = {}) {
  const random = seededRng(seed);
  const finals = [], dds = [];
  for (let d = 0; d < draws; d++) {
    const r = runRotation({
      ...opts,
      select: (eligible, _i) => {
        const pool = [...eligible];
        for (let j = pool.length - 1; j > 0; j--) {
          const k = Math.floor(random() * (j + 1));
          [pool[j], pool[k]] = [pool[k], pool[j]];
        }
        return pool.slice(0, opts.topK ?? 10);
      },
    });
    finals.push(r.finalBalance); dds.push(r.maxDrawdownPct);
  }
  finals.sort((a, b) => a - b);
  const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
  return {
    draws, mean: +mean.toFixed(2),
    median: +finals[Math.floor(finals.length / 2)].toFixed(2),
    p05: +finals[Math.floor(0.05 * finals.length)].toFixed(2),
    p95: +finals[Math.floor(0.95 * finals.length)].toFixed(2),
    meanMaxDrawdownPct: +(dds.reduce((a, b) => a + b, 0) / dds.length).toFixed(2),
    finals,
  };
}

/** Fraction of random selections that beat the observed balance. The p-value that matters. */
export function selectionP(nullResult, observedFinal) {
  const beat = nullResult.finals.filter((f) => f >= observedFinal).length;
  return (beat + 1) / (nullResult.finals.length + 1);
}

/**
 * The dollar-neutral spread between the two legs, as a return series and a curve.
 *
 * Kept here rather than recomputed at each call site because the earlier ad-hoc versions differed
 * in whether borrow was charged on half the book or all of it. It is half: the short leg is half
 * the capital.
 */
export function spread(series, opts = {}, { borrow = 0 } = {}) {
  const top = runRotation({ ...opts, series, pick: "top" });
  const bot = runRotation({ ...opts, series, pick: "bottom" });
  const n = Math.min(top.periodReturns.length, bot.periodReturns.length);
  const returns = [];
  let bal = 1000, peak = 1000, maxDD = 0;
  for (let i = 0; i < n; i++) {
    const r = 0.5 * top.periodReturns[i] - 0.5 * bot.periodReturns[i] - 0.5 * borrow / 12;
    returns.push(r);
    bal *= Math.exp(r);
    peak = Math.max(peak, bal);
    maxDD = Math.max(maxDD, (peak - bal) / peak);
  }
  const years = n / 12;
  return {
    returns, periods: n,
    finalBalance: +bal.toFixed(2),
    cagrPct: years > 0 ? +(((bal / 1000) ** (1 / years) - 1) * 100).toFixed(2) : null,
    maxDrawdownPct: +(100 * maxDD).toFixed(2),
    upPeriods: returns.filter((r) => r > 0).length,
    top, bot,
  };
}

/**
 * The null the SPREAD needs, which is not the null the long leg needs.
 *
 * Draw 2*topK symbols uniformly, split them arbitrarily into a "long" half and a "short" half,
 * and run the same dollar-neutral book. That asks the only question worth asking of a spread: does
 * RANKING the two sides beat splitting the same names at random?
 */
export function randomSpreadNull(series, opts = {}, { draws = 200, seed = 20260904, borrow = 0 } = {}) {
  const random = seededRng(seed);
  const finals = [];
  const topK = opts.topK ?? 10;
  for (let d = 0; d < draws; d++) {
    const pickHalf = (half) => (eligible) => {
      const pool = [...eligible];
      for (let j = pool.length - 1; j > 0; j--) {
        const k = Math.floor(random() * (j + 1));
        [pool[j], pool[k]] = [pool[k], pool[j]];
      }
      return half === "a" ? pool.slice(0, topK) : pool.slice(topK, 2 * topK);
    };
    const a = runRotation({ ...opts, series, select: pickHalf("a") });
    const b = runRotation({ ...opts, series, select: pickHalf("b") });
    const n = Math.min(a.periodReturns.length, b.periodReturns.length);
    let bal = 1000;
    for (let i = 0; i < n; i++) bal *= Math.exp(0.5 * a.periodReturns[i] - 0.5 * b.periodReturns[i] - 0.5 * borrow / 12);
    finals.push(+bal.toFixed(2));
  }
  finals.sort((x, y) => x - y);
  return {
    draws, finals,
    mean: +(finals.reduce((x, y) => x + y, 0) / finals.length).toFixed(2),
    median: +finals[Math.floor(finals.length / 2)].toFixed(2),
    p05: +finals[Math.floor(0.05 * finals.length)].toFixed(2),
    p95: +finals[Math.floor(0.95 * finals.length)].toFixed(2),
  };
}
