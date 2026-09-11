import { test } from "node:test";
import assert from "node:assert";
import { alignReturns, correlation, bookStats, blend } from "./portfolio.mjs";

const DAY = 86400;
const book = (returns, ts) => ({ returns, rebalanceLog: ts.map(at => ({ at })) });

test("alignReturns compounds every A period inside each B period", () => {
  // A closes on days 10, 20, 30, 40, 50, 60; B on days 30 and 60. Each B period must absorb
  // all three A periods that closed inside it, not just the last one.
  const a = book([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [0, 10, 20, 30, 40, 50, 60].map(d => d * DAY));
  const b = book([1.0, 2.0], [0, 30 * DAY, 60 * DAY]);
  const pairs = alignReturns(a, b);
  assert.equal(pairs.length, 2);
  assert.ok(Math.abs(pairs[0].a - (0.1 + 0.2 + 0.3)) < 1e-12);
  assert.ok(Math.abs(pairs[1].a - (0.4 + 0.5 + 0.6)) < 1e-12);
  assert.equal(pairs[0].aPeriods, 3);
  assert.equal(pairs[0].b, 1.0);
  assert.equal(pairs[1].b, 2.0);
});

test("alignReturns uses every A period exactly once and reports the count", () => {
  const a = book([0.1, 0.2, 0.3, 0.4], [0, 10, 20, 30, 40].map(d => d * DAY));
  const b = book([1.0, 2.0], [0, 20 * DAY, 40 * DAY]);
  const pairs = alignReturns(a, b);
  assert.equal(pairs.aPeriodsUsed, 4);
  assert.equal(pairs.aPeriodsTotal, 4);
});

test("alignReturns never pulls an A period from the future of its B period", () => {
  // A's only close is day 90, well after B's period ends at day 30.
  const a = book([0.9], [0, 90 * DAY]);
  const b = book([0.1], [0, 30 * DAY]);
  const pairs = alignReturns(a, b);
  assert.deepEqual([...pairs], []);
  assert.equal(pairs.aPeriodsUsed, 0);      // and the A period is reported as unused, not hidden
  assert.equal(pairs.aPeriodsTotal, 1);
});

test("alignReturns drops a B period that contains no A close", () => {
  // A closes only in B's second period, so the first has nothing to pair with.
  const a = book([0.5], [30 * DAY, 50 * DAY]);
  const b = book([1.0, 2.0], [0, 40 * DAY, 60 * DAY]);
  const pairs = alignReturns(a, b);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].b, 2.0);
});

test("correlation is 1 for a series against itself and -1 against its negation", () => {
  const xs = [0.1, -0.2, 0.3, 0.05];
  assert.ok(Math.abs(correlation(xs, xs) - 1) < 1e-12);
  assert.ok(Math.abs(correlation(xs, xs.map(x => -x)) + 1) < 1e-12);
});

test("correlation returns null when a series has no variance", () => {
  assert.equal(correlation([0.1, 0.1, 0.1], [0.1, 0.2, 0.3]), null);
});

test("bookStats compounds log returns and marks drawdown from the running peak", () => {
  // Up 100%, then down 50%: ends flat, but drew down 50% from the peak.
  const s = bookStats([Math.log(2), Math.log(0.5)], { start: 1000, periodsPerYear: 2 });
  assert.ok(Math.abs(s.final - 1000) < 1e-9);
  assert.ok(Math.abs(s.maxDrawdownPct - 50) < 1e-9);
  assert.equal(s.periods, 2);
  assert.equal(s.upPeriods, 1);
});

test("blend is the rebalanced portfolio return, not the average of the log returns", () => {
  // +10% and -10% at 50/50 is exactly flat in simple terms.
  const pairs = [{ at: 0, a: Math.log(1.1), b: Math.log(0.9) }];
  assert.ok(Math.abs(blend(pairs, 0.5)[0]) < 1e-12);
  // Averaging the logs would give log(sqrt(1.1*0.9)) = -0.00501, a loss that no
  // rebalanced portfolio actually takes.
  assert.ok(0.5 * pairs[0].a + 0.5 * pairs[0].b < -0.005);
});

test("blend at weight 1 reproduces book A exactly", () => {
  const pairs = [{ at: 0, a: 0.3, b: -0.9 }, { at: 1, a: -0.2, b: 0.4 }];
  const out = blend(pairs, 1);
  assert.ok(Math.abs(out[0] - 0.3) < 1e-12);
  assert.ok(Math.abs(out[1] + 0.2) < 1e-12);
});
