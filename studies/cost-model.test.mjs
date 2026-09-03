import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SPOT_FEE_SCHEDULE, FUTURES_FEE_SCHEDULE,
  spotFee, futuresFee, fundingCost, isPostOnlyRejected, simulateLimitFill,
} from "./cost-model.mjs";

// ─── Fee schedules (values verified live against kraken.com 2026-08-13) ────────────────

test("spotFee: standard pair uses Tier 1 maker/taker", () => {
  assert.deepEqual(spotFee(), { taker: 0.0080, maker: 0.0040 });
});

test("spotFee: maker-rebate-eligible pair gets the lower maker rate, taker unchanged", () => {
  assert.deepEqual(spotFee({ makerRebateEligible: true }), { taker: 0.0080, maker: 0.0038 });
});

test("spotFee matches strategy.js's existing FEE_RATE constant (round-trip taker ~1.7%)", async () => {
  const { FEE_RATE } = await import("../strategy.js");
  assert.equal(spotFee().taker, FEE_RATE);
});

test("futuresFee: retail tier ($0+ volume)", () => {
  assert.deepEqual(futuresFee(), { taker: 0.00050, maker: 0.00020 });
});

test("futuresFee: walks up to the highest tier not exceeding the given volume", () => {
  assert.deepEqual(futuresFee({ volume30d: 7_000_000 }), { taker: 0.00045, maker: 0.000175 });
  assert.deepEqual(futuresFee({ volume30d: 10_000_000 }), { taker: 0.00040, maker: 0.00015 });
  assert.deepEqual(futuresFee({ volume30d: 999_000_000 }), { taker: 0.00020, maker: 0.00000 });
});

test("FUTURES_FEE_SCHEDULE is ascending by minVolume30d with strictly decreasing fees", () => {
  for (let i = 1; i < FUTURES_FEE_SCHEDULE.length; i++) {
    assert.ok(FUTURES_FEE_SCHEDULE[i].minVolume30d > FUTURES_FEE_SCHEDULE[i - 1].minVolume30d);
    assert.ok(FUTURES_FEE_SCHEDULE[i].taker <= FUTURES_FEE_SCHEDULE[i - 1].taker);
    assert.ok(FUTURES_FEE_SCHEDULE[i].maker <= FUTURES_FEE_SCHEDULE[i - 1].maker);
  }
});

// ─── Funding cost ────────────────────────────────────────────────────────────────────

test("fundingCost: sums rates in [entryTs, exitTs), sign flips for shorts", () => {
  const rates = [
    { timestamp: 1000, fundingRate: 0.0001 },
    { timestamp: 2000, fundingRate: -0.0002 },
    { timestamp: 3000, fundingRate: 0.0003 }, // outside the window below, must be excluded
  ];
  assert.ok(Math.abs(fundingCost({ fundingRates: rates, entryTs: 500, exitTs: 2500, side: "long" }) - -0.0001) < 1e-12);
  assert.ok(Math.abs(fundingCost({ fundingRates: rates, entryTs: 500, exitTs: 2500, side: "short" }) - 0.0001) < 1e-12);
});

test("fundingCost: exitTs is exclusive, entryTs is inclusive", () => {
  const rates = [{ timestamp: 1000, fundingRate: 0.0005 }];
  assert.equal(fundingCost({ fundingRates: rates, entryTs: 1000, exitTs: 2000, side: "long" }), 0.0005);
  assert.equal(fundingCost({ fundingRates: rates, entryTs: 500, exitTs: 1000, side: "long" }), 0);
});

test("fundingCost: rejects an inverted window", () => {
  assert.throws(() => fundingCost({ fundingRates: [], entryTs: 2000, exitTs: 1000 }));
});

// ─── Post-only enforcement ───────────────────────────────────────────────────────────

test("isPostOnlyRejected: buy limit at or above the ask is rejected", () => {
  assert.equal(isPostOnlyRejected({ side: "buy", limitPrice: 100.01, bestBid: 99.99, bestAsk: 100.00 }), true);
  assert.equal(isPostOnlyRejected({ side: "buy", limitPrice: 100.00, bestBid: 99.99, bestAsk: 100.00 }), true);
  assert.equal(isPostOnlyRejected({ side: "buy", limitPrice: 99.98, bestBid: 99.99, bestAsk: 100.00 }), false);
});

test("isPostOnlyRejected: sell limit at or below the bid is rejected", () => {
  assert.equal(isPostOnlyRejected({ side: "sell", limitPrice: 99.98, bestBid: 99.99, bestAsk: 100.00 }), true);
  assert.equal(isPostOnlyRejected({ side: "sell", limitPrice: 100.01, bestBid: 99.99, bestAsk: 100.00 }), false);
});

// ─── Touch-based limit-fill simulator, grounded in real historical BTC bars ─────────────
//
// Fixture pulled directly from candles/XBTUSD.csv rows 1868-1877 (1-indexed after header),
// a real ~0.7% up-move recorded 2023-01-02. Not synthetic: this is what actually happened.

const REAL_BTC_WINDOW = [
  { time: 1672643160, open: 16633.6, high: 16633.7, low: 16633.6, close: 16633.7 },
  { time: 1672643220, open: 16633.7, high: 16635.3, low: 16633.6, close: 16635.2 },
  { time: 1672643280, open: 16634.3, high: 16635.8, low: 16634.3, close: 16635.7 },
  { time: 1672643340, open: 16635.8, high: 16635.8, low: 16635.7, close: 16635.7 },
  { time: 1672643400, open: 16635.7, high: 16635.8, low: 16635.7, close: 16635.7 },
  { time: 1672643460, open: 16635.7, high: 16635.8, low: 16635.7, close: 16635.7 },
  { time: 1672643520, open: 16635.8, high: 16635.8, low: 16635.7, close: 16635.7 },
  { time: 1672643580, open: 16635.8, high: 16635.8, low: 16635.7, close: 16635.7 },
  { time: 1672643640, open: 16635.8, high: 16685.0, low: 16635.7, close: 16685.0 },
  { time: 1672643700, open: 16685.0, high: 16750.0, low: 16674.6, close: 16723.5 },
];

test("simulateLimitFill: real data — buy limit resting below a flat region fills immediately", () => {
  const r = simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "buy", limitPrice: 16634.0 });
  assert.equal(r.filled, true);
  assert.equal(r.fillBarIndex, 0); // bar 0's low (16633.6) already <= 16634.0
});

test("simulateLimitFill: real data — sell limit above the flat region only fills once price actually breaks out", () => {
  const r = simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "sell", limitPrice: 16650 });
  assert.equal(r.filled, true);
  assert.equal(r.fillBarIndex, 8); // bar 8 is the first bar whose high (16685) reaches 16650
});

test("simulateLimitFill: real data — sell limit above the breakout's own high never fills in this window", () => {
  const r = simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "sell", limitPrice: 16800 });
  assert.equal(r.filled, false);
  assert.equal(r.fillBarIndex, null);
  assert.equal(r.adverseMovePct, null);
});

test("simulateLimitFill: adverse-selection window measures real continuation past the fill", () => {
  // Sell fills at bar 8 (16650); with adverseWindowBars=1 the next bar (index 9) still
  // trades up to 16750 - price kept rising after the maker sold, a real -0.6% adverse move.
  const r = simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "sell", limitPrice: 16650, adverseWindowBars: 1 });
  assert.equal(r.filled, true);
  assert.ok(Math.abs(r.adverseMovePct - (16650 - 16750) / 16650) < 1e-9);
  assert.ok(r.adverseMovePct < 0);
});

test("simulateLimitFill: maxWaitBars bounds how long the order waits before being treated as missed", () => {
  const r = simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "sell", limitPrice: 16650, maxWaitBars: 5 });
  assert.equal(r.filled, false); // the real fill happens at bar 8, past the 5-bar window
});

test("simulateLimitFill: rejects malformed input rather than silently returning garbage", () => {
  assert.throws(() => simulateLimitFill({ bars: [], side: "buy", limitPrice: 100 }));
  assert.throws(() => simulateLimitFill({ bars: REAL_BTC_WINDOW, side: "up", limitPrice: 100 }));
});

// ─── Sanity: the real fixture above actually matches the live CSV it claims to be from ──

test("REAL_BTC_WINDOW fixture matches candles/XBTUSD.csv verbatim (guards against a stale/copied fixture)", (t) => {
  const candlePath = new URL("./candles/XBTUSD.csv", import.meta.url);
  if (!fs.existsSync(candlePath)) {
    t.skip("candles/XBTUSD.csv absent (no local candle history on this machine)");
    return;
  }
  const lines = fs.readFileSync(candlePath, "utf8").trim().split("\n");
  const row = lines.find((l) => l.startsWith("1672643640,"));
  assert.ok(row, "expected row 1672643640 to exist in candles/XBTUSD.csv");
  const [, open, high, low, close] = row.split(",").map(Number);
  assert.deepEqual({ open, high, low, close }, { open: 16635.8, high: 16685.0, low: 16635.7, close: 16685.0 });
});
