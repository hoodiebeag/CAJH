/**
 * xsmom-wf.mjs -- walk-forward for the cross-sectional rotation.
 *
 * Every earlier result in this project lost roughly 40% of its apparent edge to a walk-forward,
 * and one of them lost all of it. The rotation must face the same test: parameters chosen from a
 * grid using ONLY data that closed before the quarter they are judged on, chained across quarters.
 *
 * The grid is deliberately six points. The corrected grid-size ladder found an interior optimum
 * near eight, and a larger grid fits the training window's noise -- which is the failure this file
 * exists to detect, not to commit.
 *
 * Note what is NOT refit: the skip (21 bars) and the rebalance interval (21 bars). Those are the
 * canonical 1993 construction and holding them fixed is the point. Refitting everything would
 * turn a literature-specified strategy into a search result, which is the whole distinction that
 * makes this finding different from the 2,446 configurations that preceded it.
 */

import { runRotation, perYear } from "./xsmom.mjs";

export const GRID = { lookbackBars: [126, 252], topK: [5, 10, 20] };

const sec = (d) => Date.parse(d + "T00:00:00Z") / 1000;

/** Slice a series map to bars at or before `to`. Training may never see past its own cutoff. */
export function truncate(series, to) {
  const cut = sec(to);
  const out = {};
  for (const [s, c] of Object.entries(series)) {
    const kept = c.filter((b) => Number(b.time) <= cut);
    if (kept.length) out[s] = kept;
  }
  return out;
}

/** Best (lookbackBars, topK) on data ending at `until`, scored on the dollar-neutral spread. */
export function fit(series, until, { grid = GRID, slipPct = 0.0005, borrow = 0 } = {}) {
  const train = truncate(series, until);
  let best = null;
  for (const lookbackBars of grid.lookbackBars) {
    for (const topK of grid.topK) {
      const base = { series: train, lookbackBars, skipBars: 21, rebalanceBars: 21, topK, slipPct };
      const top = runRotation({ ...base, pick: "top" });
      const bot = runRotation({ ...base, pick: "bottom" });
      const n = Math.min(top.periodReturns.length, bot.periodReturns.length);
      if (n < 6) continue;                       // too few rebalances to have chosen on
      // Borrow is annual; the universe's own rebalance calendar sets how often it is charged.
      const ppy = perYear(top.rebalanceLog) ?? 12;
      let logSum = 0;
      // The short leg's turnover cost would arrive as a credit; see xsmom.mjs spread().
      for (let i = 0; i < n; i++) {
        logSum += 0.5 * top.periodReturns[i] - 0.5 * bot.periodReturns[i]
                  + (bot.periodCosts[i] ?? 0) - 0.5 * borrow / ppy;
      }
      if (!best || logSum > best.logSum) best = { lookbackBars, topK, logSum, periods: n };
    }
  }
  return best;
}

/**
 * Chain quarterly out-of-sample periods. Each quarter is traded with parameters fitted only on
 * bars that closed before it began; the series itself is NOT truncated at the quarter end,
 * because a position's forward return is not lookahead -- the same distinction that had to be
 * fixed in walkforward.mjs when truncating amputated open holds and produced a false negative.
 */
export function walkForward(series, {
  testFrom = "2025-01-01", testTo = "2026-09-02", grid = GRID, slipPct = 0.0005, borrow = 0,
} = {}) {
  const steps = [];
  let bal = 1000, peak = 1000, maxDD = 0, up = 0, total = 0;
  const allReturns = [];
  // Set once from the universe's own calendar: crypto's daily bundle carries 365 bars a year, US
  // equities 252, so a 21-bar rebalance is 17.4 periods a year in one and 12 in the other.
  let periodsPerYear = 12;

  let y = Number(testFrom.slice(0, 4)), q = Math.floor((Number(testFrom.slice(5, 7)) - 1) / 3);
  for (;;) {
    const from = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    if (from > testTo) break;
    const nextY = q === 3 ? y + 1 : y, nextQ = (q + 1) % 4;
    const to = `${nextY}-${String(nextQ * 3 + 1).padStart(2, "0")}-01`;

    const chosen = fit(series, from, { grid, slipPct, borrow });
    if (chosen) {
      const base = { series, lookbackBars: chosen.lookbackBars, skipBars: 21, rebalanceBars: 21,
                     topK: chosen.topK, slipPct };
      const top = runRotation({ ...base, pick: "top" });
      const bot = runRotation({ ...base, pick: "bottom" });
      periodsPerYear = perYear(top.rebalanceLog) ?? periodsPerYear;
      // Keep only the periods whose rebalance falls inside this quarter.
      const lo = sec(from), hi = sec(to);
      const idx = top.rebalanceLog
        .map((r, i) => [r.at, i]).filter(([at]) => at >= lo && at < hi).map(([, i]) => i);
      let qr = 0, count = 0;
      for (const i of idx) {
        const a = top.periodReturns[i - 1], b = bot.periodReturns[i - 1];
        if (a === undefined || b === undefined) continue;
        const r = 0.5 * a - 0.5 * b + (bot.periodCosts[i - 1] ?? 0)
                  - 0.5 * borrow / (perYear(top.rebalanceLog) ?? 12);
        qr += r; allReturns.push(r); total++; if (r > 0) up++;
        bal *= Math.exp(r);
        count++;
        // Drawdown is NOT taken from these monthly points. Marking a spread monthly missed every
        // intra-month low and understated the in-sample drawdown by 44%. The per-bar path below
        // is walked separately for exactly that reason.
        const lo = top.rebalanceLog[i - 1]?.at, hi = top.rebalanceLog[i]?.at;
        if (lo && hi) {
          let sub = bal / Math.exp(r);
          for (let k = 0; k < top.times.length; k++) {
            const t = top.times[k];
            if (t <= lo || t > hi) continue;
            sub *= Math.exp(0.5 * top.barReturns[k] - 0.5 * bot.barReturns[k] - 0.5 * borrow / (perYear(top.times) ?? 252));
            peak = Math.max(peak, sub);
            maxDD = Math.max(maxDD, (peak - sub) / peak);
          }
        }
        peak = Math.max(peak, bal); maxDD = Math.max(maxDD, (peak - bal) / peak);
      }
      steps.push({ quarter: from, chose: { lookbackBars: chosen.lookbackBars, topK: chosen.topK },
                   periods: count, quarterLogReturn: +qr.toFixed(4) });
    } else {
      steps.push({ quarter: from, skipped: "no configuration had enough training periods" });
    }
    y = nextY; q = nextQ;
  }

  const yrs = allReturns.length / periodsPerYear;
  return {
    steps, periods: total, upPeriods: up,
    finalBalance: +bal.toFixed(2),
    cagrPct: yrs > 0 ? +(((bal / 1000) ** (1 / yrs) - 1) * 100).toFixed(2) : null,
    maxDrawdownPct: +(100 * maxDD).toFixed(2),
  };
}
