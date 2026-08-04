import test from "node:test";
import assert from "node:assert/strict";
import { simulatePortfolio } from "./portfolio.mjs";

test("portfolio simulator charges turnover and carries cash", () => {
  const dates = [0, 86400, 172800], prices = new Map([["A", new Map([[0, 100], [86400, 110], [172800, 121]])]]);
  const data = { symbols: ["A"], dates, prices };
  const result = simulatePortfolio(data, () => ({ target: new Map([["A", 1]]) }), { start: 0, end: 2, rebalanceDays: 7, costRate: 0 });
  assert.ok(Math.abs(result.totalReturn - .21) < 1e-12);
  assert.equal(result.turnover, .5);
});
