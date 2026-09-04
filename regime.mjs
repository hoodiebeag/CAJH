/**
 * regime.mjs -- did the strategy stop working, or did the market stop trending?
 *
 * The leader's mean R by year is +2.92, +2.01, +0.21, -0.94 across 2023 to 2026. Read alone that
 * is a strategy decaying. But a trend follower harvests trend, and a year with no trend in it pays
 * nothing to anybody. Those two explanations have completely different consequences and the
 * balance cannot tell them apart, so this measures the market directly and separately.
 *
 * Two measures, chosen because neither one depends on the strategy:
 *
 *   efficiency ratio  Kaufman's. |P_t - P_(t-n)| divided by the sum of the absolute daily moves
 *                     over the same window. One means a straight line, zero means a round trip.
 *                     It is exactly "how much of the motion went somewhere", which is what a trend
 *                     follower is paid for.
 *
 *   random-entry R    The same matched-geometry null the campaign uses, computed per year. This is
 *                     what a coin flip earned with the strategy's own stop, target and hold in that
 *                     year -- the trend that was lying on the floor.
 *
 * If both collapse in 2025 the market went quiet. If only the strategy's does, the strategy died.
 */

import { slice, SPLIT } from "./campaign.mjs";
import { availablePairs } from "./bundle-loader.mjs";
import { seededRng } from "./inference.mjs";
import { simulateExit } from "./entrynull.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";
import { pathToFileURL } from "url";

/** Kaufman's efficiency ratio at each bar over an n-bar window. Null until the window fills. */
export function efficiencyRatio(candles, n = 50) {
  const closes = candles.map((c) => Number(c.close));
  const out = new Array(closes.length).fill(null);
  for (let i = n; i < closes.length; i++) {
    let churn = 0;
    for (let j = i - n + 1; j <= i; j++) churn += Math.abs(closes[j] - closes[j - 1]);
    if (churn > 0) out[i] = Math.abs(closes[i] - closes[i - n]) / churn;
  }
  return out;
}

const yearOf = (c) => new Date(Number(c.time) * 1000).getUTCFullYear();

/** Mean efficiency ratio per calendar year, averaged over every pair in the universe. */
export function trendinessByYear({ minutes = 1440, n = 50, from = SPLIT.trainStart, to = SPLIT.trainEnd } = {}) {
  const acc = new Map();
  for (const pair of availablePairs(minutes)) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length < 120) continue;
    const er = efficiencyRatio(candles, n);
    for (let i = 0; i < candles.length; i++) {
      if (er[i] === null) continue;
      const y = yearOf(candles[i]);
      if (!acc.has(y)) acc.set(y, { sum: 0, count: 0 });
      const a = acc.get(y); a.sum += er[i]; a.count++;
    }
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, a]) => ({ year, meanEfficiencyRatio: +(a.sum / a.count).toFixed(4), barPairs: a.count }));
}

/**
 * What a random long entry earned per year under the strategy's own exit geometry. Deliberately
 * NOT gated, filtered or timed -- it is the trend available to anyone who simply held.
 */
export function randomEntryByYear({
  minutes = 1440, from = SPLIT.trainStart, to = SPLIT.trainEnd,
  stopPct = 0.06, tpR = 100, maxHold = 50, perYear = 4000, seed = 20260904,
} = {}) {
  const random = seededRng(seed);
  const byYear = new Map();
  const universe = [];
  for (const pair of availablePairs(minutes)) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length >= 120) universe.push(candles);
  }
  const exit = { stopPct, tpR, maxHold, lockBreakeven: true, beTriggerR: 3, beLockR: 0.2,
                 feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT };
  // Draw uniformly over every (pair, bar) in the universe, then bucket the result by the entry
  // bar's year. Drawing per year instead would over-weight the pairs that happen to exist in a
  // short year, and nine of these pairs only start in 2025.
  const totalDraws = perYear * 4;
  for (let d = 0; d < totalDraws; d++) {
    const candles = universe[Math.floor(random() * universe.length)];
    const i = Math.floor(random() * (candles.length - 1));
    const r = simulateExit(candles, i, exit);
    if (r === null || !Number.isFinite(r)) continue;
    const y = yearOf(candles[i]);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, rs]) => ({
    year, draws: rs.length,
    meanR: +(rs.reduce((s, x) => s + x, 0) / rs.length).toFixed(4),
    positiveFraction: +(rs.filter((x) => x > 0).length / rs.length).toFixed(3),
  }));
}

function main() {
  const er = trendinessByYear();
  const re = randomEntryByYear();
  const strategy = { 2023: 2.9243, 2024: 2.0110, 2025: 0.2058, 2026: -0.9431 }; // robustness.mjs LEADER
  console.log("year  efficiencyRatio  randomEntryMeanR  randomEntryWin%  strategyMeanR");
  for (const row of er) {
    const r = re.find((x) => x.year === row.year);
    console.log(`${row.year}  ${String(row.meanEfficiencyRatio).padStart(15)}  ` +
      `${String(r ? r.meanR : "-").padStart(16)}  ${String(r ? (100 * r.positiveFraction).toFixed(1) : "-").padStart(15)}  ` +
      `${String(strategy[row.year] ?? "-").padStart(13)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
