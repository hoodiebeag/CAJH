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

test("portfolio simulator excludes a stale symbol from a day's return and renormalizes across the rest, instead of freezing it at a phantom 0%", () => {
  // B has a print at every date; A stops printing after date 86400 (index 1) — mirrors the
  // real T4-COVERAGE-FIX pattern where most tradable symbols stop dead partway through the
  // holdout window while a few (there: BTC/ETH/SOL) keep printing.
  const dates = [0, 86400, 172800, 259200];
  const prices = new Map([
    ["A", new Map([[0, 100], [86400, 100]])], // no print at 172800 or 259200
    ["B", new Map([[0, 100], [86400, 100], [172800, 110], [259200, 121]])],
  ]);
  const data = { symbols: ["A", "B"], dates, prices };
  const equalWeight = () => ({ target: new Map([["A", .5], ["B", .5]]) });
  const result = simulatePortfolio(data, equalWeight, { start: 0, end: 3, rebalanceDays: 100, costRate: 0 });
  // Once A goes stale, B (renormalized to its own full +10%/+10% moves) compounds to 1.21;
  // the pre-fix behavior would have kept charging A's raw .5 weight at a phantom 0% and only
  // applied B's .5 weight un-renormalized (+5%/+5%), compounding to 1.1025 instead.
  assert.ok(Math.abs(result.totalReturn - .21) < 1e-9, `expected totalReturn .21, got ${result.totalReturn}`);
  assert.ok(Math.abs(result.totalReturn - .1025) > 1e-9);
});

test("portfolio simulator returns 0% (holds cash) when every weighted symbol is unpriced that day, rather than throwing", () => {
  const dates = [0, 86400, 172800], prices = new Map([["A", new Map([[0, 100]])]]); // no print at 86400 or 172800
  const data = { symbols: ["A"], dates, prices };
  const result = simulatePortfolio(data, () => ({ target: new Map([["A", 1]]) }), { start: 0, end: 2, rebalanceDays: 100, costRate: 0 });
  assert.equal(result.totalReturn, 0);
});
