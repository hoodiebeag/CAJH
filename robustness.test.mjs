import test from "node:test";
import assert from "node:assert/strict";
import { report, summarise, LEADER } from "./robustness.mjs";

const R = report();

test("the leader reproduces exactly -- a silent change to the engine or the bundle fails here", () => {
  assert.equal(R.all.trades, 134);
  assert.equal(R.all.finalBalance, 5160.44);
  assert.equal(R.all.maxDrawdownPct, 8.96);
});

test("it is positive in every full year standalone, not one good year", () => {
  const full = R.perYear.filter((y) => y.trades >= 10);
  assert.equal(full.length, 3, "expected 2023, 2024 and 2025 to each carry real trade counts");
  for (const y of full) assert.ok(y.meanR > 0, `${y.year} mean ${y.meanR}R`);
});

test("it survives losing any single pair", () => {
  assert.ok(R.leaveOnePairOut[0].finalBalance > 2500,
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
  assert.ok(R.shape.top5SharePct > 70, `top 5 carry ${R.shape.top5SharePct}%`);
  assert.ok(R.shape.winRatePct < 50);
  assert.ok(R.shape.medianNetR < 0, "the median trade is a loss; the tail carries everything");
  const dropTen = R.trimTopWinners.find((x) => x.dropped === 10);
  assert.ok(dropTen.meanR < 0, "dropping the ten best trades turns the mean negative");
  assert.ok(dropTen.finalBalance > 1000, "though it now still finishes above starting capital");
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
  assert.equal(LEADER.trendMa, 200);
  assert.equal(LEADER.beTriggerR, 2.5);
  assert.equal(LEADER.volTarget, 0.05);
  assert.equal(LEADER.entryDelayBars, 1);
  assert.equal(LEADER.maxConcurrent, 3);
});

test("capping concurrency beats the unlimited book on return AND drawdown AND peak risk", () => {
  // The unlimited book peaked at 19 simultaneous longs -- 9.5% of the account at risk at once in a
  // near-one-factor market. Three positions at 1% is 3% peak risk and does better on both axes,
  // because the nineteen were largely the same bet nineteen times.
  const unlimited = report({ ...LEADER, maxConcurrent: null, riskPct: 0.005 });
  assert.ok(R.all.finalBalance > unlimited.all.finalBalance,
    `${R.all.finalBalance} vs ${unlimited.all.finalBalance}`);
  assert.ok(R.all.maxDrawdownPct < unlimited.all.maxDrawdownPct,
    `${R.all.maxDrawdownPct}% vs ${unlimited.all.maxDrawdownPct}%`);
  assert.ok(LEADER.maxConcurrent * LEADER.riskPct < 19 * 0.005, "and it commits less capital at the peak");
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

test("volatility targeting improves the leader on BOTH balance and drawdown", () => {
  // The comparison that justifies it is risk-matched (see equity.mjs riskMatchedRiskPct): at the
  // same mean deployed risk, sizing inversely to volatility beats flat sizing. Here it is simply
  // run at the same riskPct, where it deploys slightly LESS risk and still wins on both axes.
  const flat = report({ ...LEADER, volTarget: null });
  assert.ok(R.all.finalBalance > flat.all.finalBalance, `${R.all.finalBalance} vs ${flat.all.finalBalance}`);
  assert.ok(R.all.maxDrawdownPct < flat.all.maxDrawdownPct, `${R.all.maxDrawdownPct} vs ${flat.all.maxDrawdownPct}`);
});
