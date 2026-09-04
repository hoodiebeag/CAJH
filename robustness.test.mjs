import test from "node:test";
import assert from "node:assert/strict";
import { report, summarise, LEADER } from "./robustness.mjs";

const R = report();

test("the leader reproduces exactly -- a silent change to the engine or the bundle fails here", () => {
  assert.equal(R.all.trades, 192);
  assert.equal(R.all.finalBalance, 16749.27);
  assert.equal(R.all.maxDrawdownPct, 25.1);
});

test("it is positive in every full year standalone, not one good year", () => {
  const full = R.perYear.filter((y) => y.trades >= 10);
  assert.equal(full.length, 3, "expected 2023, 2024 and 2025 to each carry real trade counts");
  for (const y of full) assert.ok(y.meanR > 0, `${y.year} mean ${y.meanR}R`);
});

test("it survives losing any single pair", () => {
  assert.ok(R.leaveOnePairOut[0].finalBalance > 8000,
    `worst case is ${R.leaveOnePairOut[0].without} at $${R.leaveOnePairOut[0].finalBalance}`);
});

test("it survives restricting to the pairs with full history", () => {
  // Nine pairs start 2025-01-22. If the result only existed on those, this would collapse.
  assert.equal(R.fullHistoryPairsOnly.pairs, 16);
  assert.ok(R.fullHistoryPairsOnly.meanR > 0);
});

test("the payoff is right-tailed, and the test records how far -- it does not pretend otherwise", () => {
  // This is not a pass/fail on the strategy: a trend follower is supposed to look like this. It
  // exists so nobody reads the mean as a stable statistic. Dropping ten of 143 trades flips it.
  assert.ok(R.shape.top5SharePct > 50, `top 5 carry ${R.shape.top5SharePct}%`);
  assert.ok(R.shape.winRatePct < 50);
  assert.ok(R.shape.medianNetR < 0, "the median trade is a loss; the tail carries everything");
  const dropTen = R.trimTopWinners.find((x) => x.dropped === 10);
  assert.ok(dropTen.meanR > 0, "this is the first leader where dropping the ten best keeps a positive mean");
  const dropTwenty = R.trimTopWinners.find((x) => x.dropped === 20);
  assert.ok(dropTwenty.meanR < 0, "twenty still flips it -- the tail dependence is reduced, not gone");
});

test("trade counts are inflated by same-day clustering, and the factor is reported", () => {
  assert.ok(R.shape.clusteringFactor > 1, "143 trades are not 143 independent days");
  assert.ok(R.shape.distinctDays < R.all.trades);
});

test("summarise reports the starting balance for an empty trade list rather than dividing by zero", () => {
  assert.deepEqual(summarise([]), { trades: 0, meanR: null, finalBalance: 1000, maxDrawdownPct: 0 });
});

test("the pinned LEADER is the configuration the campaign state names", () => {
  assert.equal(LEADER.entryMode, "breakout");
  assert.equal(LEADER.trendMa, 150);
  assert.equal(LEADER.beTriggerR, 3);
  assert.equal(LEADER.volTarget, 0.05);
  assert.equal(LEADER.entryDelayBars, 1);
});

test("the leader carries nothing the walk-forward declined", () => {
  // The two components the in-sample search liked and a training-only search did not: the filters
  // (declined in 7 of 9 quarters) and the concurrency cap (never selected under either objective).
  assert.equal(LEADER.filters, null);
  assert.equal(LEADER.maxConcurrent, null);
});

test("the edge decays across the sample, and the test says so rather than averaging it away", () => {
  // 2023 +2.92R, 2024 +2.01R, 2025 +0.21R. The headline balance is earned mostly in the first two
  // years. Anyone reading $16,749 without this is reading a number that stopped growing.
  const y = Object.fromEntries(R.perYear.map((x) => [x.year, x.meanR]));
  assert.ok(y[2023] > y[2024], `${y[2023]} vs ${y[2024]}`);
  assert.ok(y[2024] > y[2025], `${y[2024]} vs ${y[2025]}`);
  assert.ok(y[2025] < 0.5, `2025 is nearly flat at ${y[2025]}R and that must stay visible`);
});

test("a one-bar fill delay wins on every margin, not just the headline balance", () => {
  // Adopted because it is the more realistic assumption AND the better one. A spike in a single
  // number would not be enough; agreement across independent slices is what makes it credible.
  const immediate = report({ ...LEADER, entryDelayBars: 0 });
  assert.ok(R.all.finalBalance > immediate.all.finalBalance);
  assert.ok(R.leaveOnePairOut[0].finalBalance > immediate.leaveOnePairOut[0].finalBalance);
  assert.ok(R.fullHistoryPairsOnly.finalBalance > immediate.fullHistoryPairsOnly.finalBalance);
  const drop10 = (r) => r.trimTopWinners.find((x) => x.dropped === 10).finalBalance;
  assert.ok(drop10(R) > drop10(immediate));
});

test("two bars of delay collapses it -- the improvement is a discontinuity, not a trend", () => {
  const twoBars = report({ ...LEADER, entryDelayBars: 2 });
  assert.ok(twoBars.all.finalBalance < R.all.finalBalance / 1.8, `two-bar delay gave $${twoBars.all.finalBalance}`);
});

test("volatility targeting pays for itself on this leader, but no longer for free", () => {
  // On the earlier, concurrency-capped leader it improved balance AND drawdown. On this one it
  // buys +30% of balance for +0.8 points of drawdown ($16,749 at 25.10% against $12,851 at
  // 24.27%). Worth having, and the earlier "better on both axes" claim does not survive the
  // change of configuration -- so the test asserts what is true now, not what was true then.
  const flat = report({ ...LEADER, volTarget: null });
  assert.ok(R.all.finalBalance > flat.all.finalBalance * 1.2, `${R.all.finalBalance} vs ${flat.all.finalBalance}`);
  const mar = (r) => r.all.finalBalance / r.all.maxDrawdownPct;
  assert.ok(mar(R) > mar(flat), "and it wins per unit of drawdown, which is the comparison that matters");
});
