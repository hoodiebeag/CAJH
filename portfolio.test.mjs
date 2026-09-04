import { test } from "node:test";
import assert from "node:assert";
import { alignReturns, correlation, bookStats, blend } from "./portfolio.mjs";

const DAY = 86400;
const book = (returns, ts) => ({ returns, rebalanceLog: ts.map(at => ({ at })) });

test("alignReturns matches by date, not by index", () => {
  // A rebalances every 20 days, B every 30. Index i in one is not period i in the other.
  const a = book([0.1, 0.2, 0.3], [0, 20 * DAY, 40 * DAY, 60 * DAY]);
  const b = book([0.5, 0.6], [0, 30 * DAY, 60 * DAY]);
  const pairs = alignReturns(a, b);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].b, 0.5);
  assert.equal(pairs[0].a, 0.1); // A's period ending day 20 is the last one at or before day 30
  assert.equal(pairs[1].b, 0.6);
  assert.equal(pairs[1].a, 0.3); // A's period ending day 60
});

test("alignReturns never pairs a B period with a LATER A period", () => {
  const a = book([0.9], [0, 90 * DAY]);
  const b = book([0.1], [0, 30 * DAY]);
  assert.deepEqual(alignReturns(a, b), []);
});

test("alignReturns drops matches staler than maxLagDays", () => {
  const a = book([0.1], [0, 10 * DAY]);
  const b = book([0.5], [0, 100 * DAY]);
  assert.equal(alignReturns(b === a ? a : a, b, { maxLagDays: 40 }).length, 0);
  assert.equal(alignReturns(a, b, { maxLagDays: 120 }).length, 1);
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
