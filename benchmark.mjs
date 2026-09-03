/**
 * benchmark.mjs -- what $1000 does with no strategy at all.
 *
 * Why this file exists. On 2026-09-03 a sweep found that pushing the take-profit multiple to 100R
 * -- a target so far away it is never reached, leaving the 100-bar timeout as the real exit --
 * raised the best balance from $1,139 to $2,889. That reads as a discovery until you price the
 * alternative: $1,000 left in BTC over the same window ends at $4,106, and an equal-weight basket
 * of all 29 pairs ends at $1,420. A long-only strategy in a rising market earns beta first and has
 * to be measured against it, or every sweep that lengthens the hold will look like progress.
 *
 * So: no leaderboard in this campaign is read without these numbers next to it.
 *
 * The comparison is deliberately unfair to the strategy in one direction and unfair to buy-and-hold
 * in the other, and both are worth stating. Buy-and-hold is fully invested the whole time while the
 * strategy risks 0.5% per trade and sits in cash between signals, so the strategy is being asked to
 * beat a much larger exposure. Against that, buy-and-hold here pays no fee at all and a pair that
 * starts late (nine of them start 2025-01-22) is held over a shorter, different window than a pair
 * that starts in 2023. Neither adjustment is applied -- the raw ratio is the honest thing to show,
 * and `bars` and `start` travel with every row so a short window is visible rather than buried.
 */

import { slice } from "./campaign.mjs";
import { availablePairs } from "./bundle-loader.mjs";

/** $1000 into a pair at its first bar in the window, out at its last. No fee, no timing. */
export function buyAndHold(pair, { minutes = 1440, from, to, startingBalance = 1000 } = {}) {
  const candles = slice(pair, minutes, from, to);
  if (candles.length < 2) return null;
  const open = Number(candles[0].close);
  const close = Number(candles.at(-1).close);
  if (!(open > 0) || !(close > 0)) return null;
  // Peak-to-trough on the held position, so a strategy's maxDrawdownPct has something to be read
  // against. A balance that beats buy-and-hold while halving the drawdown is a different claim
  // from one that beats it by holding through a deeper hole, and only this column separates them.
  let peak = open, maxDD = 0;
  for (const c of candles) {
    const low = Number(c.low ?? c.close), high = Number(c.high ?? c.close);
    peak = Math.max(peak, high);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - low) / peak);
  }

  return {
    pair,
    bars: candles.length,
    start: new Date(Number(candles[0].time) * 1000).toISOString().slice(0, 10),
    end: new Date(Number(candles.at(-1).time) * 1000).toISOString().slice(0, 10),
    finalBalance: +(startingBalance * (close / open)).toFixed(2),
    maxDrawdownPct: +(maxDD * 100).toFixed(2),
  };
}

/**
 * Every pair, plus the two summary numbers a leaderboard is read against: the equal-weight basket
 * and BTC on its own. `minBars` matches runConfig's own floor so the benchmark universe is the
 * same universe the strategy traded.
 */
export function benchmarks({ minutes = 1440, from, to, startingBalance = 1000, minBars = 120, pairs = null } = {}) {
  const rows = [];
  for (const pair of pairs ?? availablePairs(minutes)) {
    const row = buyAndHold(pair, { minutes, from, to, startingBalance });
    if (row && row.bars >= minBars) rows.push(row);
  }
  rows.sort((a, b) => b.finalBalance - a.finalBalance);
  const basket = rows.length ? +(rows.reduce((s, r) => s + r.finalBalance, 0) / rows.length).toFixed(2) : null;
  const btc = rows.find((r) => r.pair === "XBTUSD") ?? null;
  return {
    rows, basket,
    btc: btc ? btc.finalBalance : null,
    btcMaxDrawdownPct: btc ? btc.maxDrawdownPct : null,
    pairsUsed: rows.length, startingBalance,
  };
}

/** One line, for printing under any leaderboard. */
export function benchmarkLine(b) {
  const dd = b.btcMaxDrawdownPct === null ? "" : ` at a ${b.btcMaxDrawdownPct}% drawdown`;
  return `benchmark, same window, no strategy: BTC $${b.btc ?? "n/a"}${dd}, `
    + `equal-weight basket of ${b.pairsUsed} pairs $${b.basket ?? "n/a"} (from $${b.startingBalance})`;
}
