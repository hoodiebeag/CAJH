import test from "node:test";
import assert from "node:assert/strict";
import { report, summarise, LEADER } from "./robustness.mjs";

const R = report();

test("the leader reproduces exactly -- a silent change to the engine or the bundle fails here", () => {
  assert.equal(R.all.trades, 143);
  assert.equal(R.all.finalBalance, 4595.23);
  assert.equal(R.all.maxDrawdownPct, 12.53);
});

test("it is positive in every full year standalone, not one good year", () => {
  const full = R.perYear.filter((y) => y.trades >= 10);
  assert.equal(full.length, 3, "expected 2023, 2024 and 2025 to each carry real trade counts");
  for (const y of full) assert.ok(y.meanR > 0, `${y.year} mean ${y.meanR}R`);
});

test("it survives losing any single pair", () => {
  assert.ok(R.leaveOnePairOut[0].finalBalance > 3000,
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
});

test("volatility targeting improves the leader on BOTH balance and drawdown", () => {
  // The comparison that justifies it is risk-matched (see equity.mjs riskMatchedRiskPct): at the
  // same mean deployed risk, sizing inversely to volatility beats flat sizing. Here it is simply
  // run at the same riskPct, where it deploys slightly LESS risk and still wins on both axes.
  const flat = report({ ...LEADER, volTarget: null });
  assert.ok(R.all.finalBalance > flat.all.finalBalance, `${R.all.finalBalance} vs ${flat.all.finalBalance}`);
  assert.ok(R.all.maxDrawdownPct < flat.all.maxDrawdownPct, `${R.all.maxDrawdownPct} vs ${flat.all.maxDrawdownPct}`);
});
