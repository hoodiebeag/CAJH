import test from "node:test";
import assert from "node:assert/strict";
import { simulateFixedIntervalDCA, simulateBuyAndHold, buildIntervalTrades } from "./dca.mjs";

test("fixed-interval DCA: buy timing and totalInvested tracking on flat prices", () => {
  const dates = [0, 1, 2, 3];
  const prices = new Map([["A", new Map(dates.map((d) => [d, 100]))]]);
  const data = { symbols: ["A"], dates, prices };
  const result = simulateFixedIntervalDCA(data, { start: 0, end: 3, intervalDays: 2, amountPerInterval: 10, costRate: 0 });
  // Buys fire at index 0 and index 2 only (2 intervals of 2 days across a 4-day window).
  assert.equal(result.totalInvested, 20);
  assert.equal(result.finalValue, 20);
  assert.equal(result.totalReturn, 0);
  assert.equal(result.maxDrawdownPct, 0);
});

test("fixed-interval DCA: hand-computed equity/drawdown against a moving price", () => {
  const dates = [0, 1, 2, 3];
  const prices = new Map([["A", new Map([[0, 100], [1, 50], [2, 100], [3, 200]])]]);
  const data = { symbols: ["A"], dates, prices };
  const result = simulateFixedIntervalDCA(data, { start: 0, end: 3, intervalDays: 1, amountPerInterval: 1, costRate: 0 });
  // units: .01, +.02=.03, +.01=.04, +.005=.045 ; totalInvested 4; finalValue .045*200=9
  assert.equal(result.totalInvested, 4);
  assert.ok(Math.abs(result.finalValue - 9) < 1e-12);
  assert.ok(Math.abs(result.totalReturn - 1.25) < 1e-12);
  assert.ok(Math.abs(result.maxDrawdownPct - -0.25) < 1e-12);
});

test("buy-and-hold on the same moving price shows a deeper drawdown than DCA smooths out", () => {
  const dates = [0, 1, 2, 3];
  const prices = new Map([["A", new Map([[0, 100], [1, 50], [2, 100], [3, 200]])]]);
  const data = { symbols: ["A"], dates, prices };
  const result = simulateBuyAndHold(data, { start: 0, end: 3, costRate: 0 });
  assert.ok(Math.abs(result.totalReturn - 1) < 1e-12);
  assert.ok(Math.abs(result.maxDrawdownPct - -0.5) < 1e-12);
});

test("fixed-interval DCA: cost is deducted from units bought, shows up as negative return with flat price", () => {
  const dates = [0];
  const prices = new Map([["A", new Map([[0, 100]])]]);
  const data = { symbols: ["A"], dates, prices };
  const result = simulateFixedIntervalDCA(data, { start: 0, end: 0, intervalDays: 100, amountPerInterval: 1, costRate: 0.01 });
  assert.ok(Math.abs(result.finalValue - 0.99) < 1e-12);
  assert.ok(Math.abs(result.totalReturn - -0.01) < 1e-12);
});

test("fixed-interval DCA: a symbol missing that day's price is skipped, its share reallocated, not left as undeployed cash", () => {
  const dates = [0];
  const prices = new Map([["A", new Map([[0, 100]])], ["B", new Map()]]);
  const data = { symbols: ["A", "B"], dates, prices };
  const result = simulateFixedIntervalDCA(data, { start: 0, end: 0, intervalDays: 1, amountPerInterval: 2, costRate: 0 });
  // B has no price on day 0, so all $2 goes to A: units_A = 2/100 = .02, value = 2.
  assert.equal(result.totalInvested, 2);
  assert.ok(Math.abs(result.finalValue - 2) < 1e-12);
  assert.ok(Math.abs(result.totalReturn - 0) < 1e-12);
});

test("a stale trailing day (no fresh print) carries the last known price forward instead of marking the position to zero", () => {
  const dates = [0, 1, 2];
  // A has a price every day; B only prints on day 0, then goes stale (a slower-cadence pair).
  const prices = new Map([["A", new Map([[0, 100], [1, 100], [2, 100]])], ["B", new Map([[0, 50]])]]);
  const data = { symbols: ["A", "B"], dates, prices };
  const dca = simulateFixedIntervalDCA(data, { start: 0, end: 2, intervalDays: 1, amountPerInterval: 2, costRate: 0 });
  // Day 0: $1 into each -> units A=.01, B=.02. Day1/2: B still buyable at its last known price
  // (50), A at 100. Value never drops to 0 just because B has no fresh print on days 1-2.
  assert.ok(dca.finalValue > 0);
  assert.ok(Math.abs(dca.totalReturn - 0) < 1e-9); // flat prices throughout -> flat return
  const bh = simulateBuyAndHold(data, { start: 0, end: 2, costRate: 0 });
  assert.ok(Math.abs(bh.totalReturn - 0) < 1e-9);
});

test("fixed-interval DCA reduces to buy-and-hold when the entire amount is deployed in one interval", () => {
  const dates = [0, 1, 2];
  const prices = new Map([["A", new Map([[0, 100], [1, 80], [2, 120]])]]);
  const data = { symbols: ["A"], dates, prices };
  const dca = simulateFixedIntervalDCA(data, { start: 0, end: 2, intervalDays: 100, amountPerInterval: 1, costRate: 0.005 });
  const bh = simulateBuyAndHold(data, { start: 0, end: 2, costRate: 0.005 });
  assert.ok(Math.abs(dca.totalReturn - bh.totalReturn) < 1e-12);
  assert.ok(Math.abs(dca.maxDrawdownPct - bh.maxDrawdownPct) < 1e-12);
});

test("buildIntervalTrades: one trade per interval, r is the mark-to-end-date return from that interval's entry price", () => {
  const dates = [0, 1, 2, 3];
  const prices = new Map([["A", new Map([[0, 100], [1, 50], [2, 100], [3, 200]])]]);
  const data = { symbols: ["A"], dates, prices };
  const trades = buildIntervalTrades(data, { start: 0, end: 3, intervalDays: 1 });
  assert.equal(trades.length, 4);
  const rs = trades.map((t) => t.r);
  assert.ok(Math.abs(rs[0] - 1) < 1e-12); // entered at 100, ends at 200
  assert.ok(Math.abs(rs[1] - 3) < 1e-12); // entered at 50, ends at 200
  assert.ok(Math.abs(rs[2] - 1) < 1e-12); // entered at 100, ends at 200
  assert.ok(Math.abs(rs[3] - 0) < 1e-12); // entered at 200, ends at 200
  assert.deepEqual(trades.map((t) => t.timestamp), [0, 1, 2, 3]);
});

test("buildIntervalTrades: respects intervalDays spacing, same buy-timing rule as simulateFixedIntervalDCA", () => {
  const dates = [0, 1, 2, 3];
  const prices = new Map([["A", new Map(dates.map((d) => [d, 100]))]]);
  const data = { symbols: ["A"], dates, prices };
  const trades = buildIntervalTrades(data, { start: 0, end: 3, intervalDays: 2 });
  assert.deepEqual(trades.map((t) => t.timestamp), [0, 2]);
});

test("buildIntervalTrades: a symbol missing that day's price is excluded from that trade's basket, not counted as a zero", () => {
  const dates = [0, 1];
  const prices = new Map([["A", new Map([[0, 100], [1, 200]])], ["B", new Map([[0, 50]])]]);
  const data = { symbols: ["A", "B"], dates, prices };
  const trades = buildIntervalTrades(data, { start: 0, end: 1, intervalDays: 1 });
  // Trade at day 0: A entered at 100 -> ends at 200 (r=1); B entered at 50, forward-filled to
  // end at 50 (r=0). Basket r = avg(1, 0) = 0.5, not dragged toward -1 by a phantom zero.
  assert.ok(Math.abs(trades[0].r - 0.5) < 1e-12);
});
