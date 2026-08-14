import test from "node:test";
import assert from "node:assert/strict";
import { simulatePortfolio, portfolioStrategies, MAX_PORTFOLIO_EXPOSURE_PCT } from "./portfolio.mjs";
import { RISK_PCT, MAX_POSITION_PCT } from "./strategy.js";

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

// A strong left low (5 flat/huge fillers) confirmed by a close back above the pivot
// candle's high, at a chosen stop distance - mirrors the exact shape strategy.js's
// detectSwings/entrySignal look for, so swing_fractal_portfolio exercises the real
// imported signal rather than a re-derived approximation.
function swingCandleSeries(times, pivotLow, confirmPrice) {
  const fillerLow = pivotLow + 1_000_000, fillerHighBase = 2_000_000;
  const triggerHigh = pivotLow + (confirmPrice - pivotLow) / 2; // pivot candle's high; must stay below confirmPrice
  const filler = (i) => ({ time: times[i], open: fillerLow, high: fillerHighBase - i, low: fillerLow, close: fillerLow });
  return [
    filler(0), filler(1), filler(2), filler(3), filler(4),
    { time: times[5], open: pivotLow, high: triggerHigh, low: pivotLow, close: (pivotLow + triggerHigh) / 2 }, // pivot candle
    { time: times[6], open: pivotLow + 1, high: triggerHigh - 1, low: pivotLow + 1, close: pivotLow + 1 },     // not yet confirmed
    { time: times[7], open: confirmPrice, high: confirmPrice, low: confirmPrice, close: confirmPrice },        // confirms the low
  ];
}

test("swing_fractal_portfolio sizes a single live signal per strategy.js's own risk formula (RISK_PCT / stop distance, capped at MAX_POSITION_PCT)", () => {
  const times = Array.from({ length: 8 }, (_, i) => i * 86400);
  const pivotLow = 95, confirmPrice = 101; // stopFrac = (101-95)/101 ~= 5.94%, below MAX_POSITION_PCT's break-even
  const candlesArr = swingCandleSeries(times, pivotLow, confirmPrice);
  const candles = new Map([["A", candlesArr]]);
  const prices = new Map([["A", new Map(candlesArr.map((c) => [c.time, c.close]))]]);
  const data = { symbols: ["A"], dates: times, prices, candles, index: 7 };

  const { target } = portfolioStrategies.swing_fractal_portfolio(data);
  const stopFrac = (confirmPrice - pivotLow) / confirmPrice;
  const expected = Math.min(MAX_POSITION_PCT, RISK_PCT / stopFrac);
  assert.ok(Math.abs(target.get("A") - expected) < 1e-9, `expected weight ${expected}, got ${target.get("A")}`);
});

test("swing_fractal_portfolio returns no position (all cash) when there is no recently-confirmed swing low", () => {
  const times = Array.from({ length: 8 }, (_, i) => i * 86400);
  // Flat candles never form a strong left low, so no pivot ever confirms.
  const candlesArr = times.map((t) => ({ time: t, open: 100, high: 100, low: 100, close: 100 }));
  const candles = new Map([["A", candlesArr]]);
  const prices = new Map([["A", new Map(candlesArr.map((c) => [c.time, c.close]))]]);
  const data = { symbols: ["A"], dates: times, prices, candles, index: 7 };

  const { target } = portfolioStrategies.swing_fractal_portfolio(data);
  assert.equal(target.size, 0);
});

test("swing_fractal_portfolio scales aggregate weight down to MAX_PORTFOLIO_EXPOSURE_PCT when several correlated signals fire together", () => {
  const times = Array.from({ length: 8 }, (_, i) => i * 86400);
  // A tight stop (2%, just above MIN_STOP_PCT) prices each symbol's uncapped risk-based
  // weight (RISK_PCT / 0.02 = 25%) above MAX_POSITION_PCT (20%), so all four symbols land
  // individually capped at 20% before the aggregate cap runs - gross 80% > the 60% ceiling.
  const symbols = ["A", "B", "C", "D"];
  const pivotLow = 100, confirmPrice = pivotLow / (1 - 0.02); // stopFrac exactly 2%
  const candlesArr = swingCandleSeries(times, pivotLow, confirmPrice);
  const candles = new Map(symbols.map((s) => [s, candlesArr]));
  const prices = new Map(symbols.map((s) => [s, new Map(candlesArr.map((c) => [c.time, c.close]))]));
  const data = { symbols, dates: times, prices, candles, index: 7 };

  const { target } = portfolioStrategies.swing_fractal_portfolio(data);
  const total = [...target.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - MAX_PORTFOLIO_EXPOSURE_PCT) < 1e-9, `expected total ${MAX_PORTFOLIO_EXPOSURE_PCT}, got ${total}`);
  for (const s of symbols) assert.ok(Math.abs(target.get(s) - MAX_PORTFOLIO_EXPOSURE_PCT / 4) < 1e-9);
});
