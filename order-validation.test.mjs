import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORDER_SNAPSHOT_AGE_MS,
  placeBuy,
  resolveSupportedPair,
  setKrakenApiForTests,
  setOrderConfirmDelayForTests,
  validateOrderRequest,
  validateOrderTransportBoundary,
  validateTrackedTrade
} from "./trader.js";

test.afterEach(() => {
  setKrakenApiForTests();
  setOrderConfirmDelayForTests();
});

const validTrade = {
  symbol: "BTC",
  entry: 100,
  stopLoss: 90,
  takeProfit: 120,
  risk: 10,
  volume: 0.25
};

test("order validation accepts only supported symbols and finite positive request values", () => {
  assert.equal(resolveSupportedPair("BTC"), "XBTUSD");
  assert.deepEqual(validateOrderRequest({ symbol: "ETH", side: "buy", price: 2000, capital: 50 }), { pair: "ETHUSD" });
  assert.deepEqual(validateOrderRequest({ symbol: "SOL", side: "sell", price: 150, volume: 1.25 }), { pair: "SOLUSD" });

  assert.throws(() => validateOrderRequest({ symbol: "NOPE", side: "buy", price: 1, capital: 10 }), /Unsupported trading symbol/);
  assert.throws(() => validateOrderRequest({ symbol: "BTC", side: "hold", price: 1, capital: 10 }), /Unsupported order side/);
  assert.throws(() => validateOrderRequest({ symbol: "BTC", side: "buy", price: Infinity, capital: 10 }), /price/);
  assert.throws(() => validateOrderRequest({ symbol: "BTC", side: "buy", price: 1, capital: 0 }), /capital/);
  assert.throws(() => validateOrderRequest({ symbol: "BTC", side: "sell", price: 1, volume: Number.NaN }), /volume/);
});

test("tracked long validation rejects non-finite fields and stops at or above entry", () => {
  assert.equal(validateTrackedTrade(validTrade), true);
  for (const field of ["entry", "stopLoss", "takeProfit", "risk", "volume"]) {
    assert.throws(() => validateTrackedTrade({ ...validTrade, [field]: NaN }), new RegExp(field));
    assert.throws(() => validateTrackedTrade({ ...validTrade, [field]: 0 }), new RegExp(field));
  }
  assert.throws(() => validateTrackedTrade({ ...validTrade, symbol: "NOPE" }), /Unsupported trading symbol/);
  assert.throws(() => validateTrackedTrade({ ...validTrade, stopLoss: 100 }), /stopLoss/);
  assert.throws(() => validateTrackedTrade({ ...validTrade, stopLoss: 101 }), /stopLoss/);
  assert.throws(() => validateTrackedTrade({ ...validTrade, takeProfit: 100 }), /takeProfit/);
});

test("transport boundary rejects stale quote and invalid balance before AddOrder", () => {
  const now = 100_000;
  assert.deepEqual(validateOrderTransportBoundary({
    symbol: "BTC", side: "buy", price: 100, priceAsOf: now, capital: 50, balance: 100, balanceAsOf: now, now
  }), { pair: "XBTUSD" });

  assert.throws(() => validateOrderTransportBoundary({
    symbol: "BTC", side: "buy", price: 100, priceAsOf: now - MAX_ORDER_SNAPSHOT_AGE_MS - 1,
    capital: 50, balance: 100, balanceAsOf: now, now
  }), /price snapshot is stale/);
  assert.throws(() => validateOrderTransportBoundary({
    symbol: "BTC", side: "buy", price: 100, priceAsOf: now, capital: 50, balance: 0, balanceAsOf: now, now
  }), /balance/);
  assert.throws(() => validateOrderTransportBoundary({
    symbol: "BTC", side: "buy", price: 100, priceAsOf: now, capital: 150, balance: 100, balanceAsOf: now, now
  }), /exceeds available balance/);
});

test("placeBuy never calls AddOrder for stale quote, insufficient balance, or unknown metadata", async () => {
  const calls = [];
  setKrakenApiForTests(async (method) => {
    calls.push(method);
    if (method === "AssetPairs") return { result: {} };
    if (method === "AddOrder") throw new Error("AddOrder should not be called");
    return { result: {} };
  });
  const now = Date.now();

  await assert.rejects(() => placeBuy({
    symbol: "BTC", capital: 10, price: 100,
    priceAsOf: now - MAX_ORDER_SNAPSHOT_AGE_MS - 1, balance: 100, balanceAsOf: now
  }), /price snapshot is stale/);
  assert.equal(calls.includes("AddOrder"), false);

  await assert.rejects(() => placeBuy({
    symbol: "BTC", capital: 150, price: 100,
    priceAsOf: now, balance: 100, balanceAsOf: now
  }), /exceeds available balance/);
  assert.equal(calls.includes("AddOrder"), false);

  await assert.rejects(() => placeBuy({
    symbol: "BTC", capital: 10, price: 100,
    priceAsOf: now, balance: 100, balanceAsOf: now
  }), /metadata unavailable/);
  assert.equal(calls.includes("AddOrder"), false);
});

test("valid transport values preserve lot rounding before confirmed buy tracking", async () => {
  const calls = [];
  setOrderConfirmDelayForTests(0);
  setKrakenApiForTests(async (method, params) => {
    calls.push({ method, params });
    if (method === "AssetPairs") {
      return { result: { XXBTZUSD: { altname: "XBTUSD", lot_decimals: 4, ordermin: "0.0001" } } };
    }
    if (method === "AddOrder") {
      assert.deepEqual(params, { pair: "XBTUSD", type: "buy", ordertype: "market", volume: "0.1235" });
      return { result: { txid: ["T1"] } };
    }
    if (method === "QueryOrders") {
      return { result: { T1: { status: "closed", vol_exec: "0.1235", price: "100", fee: "0.04" } } };
    }
    throw new Error(`unexpected method ${method}`);
  });

  const now = Date.now();
  const trade = await placeBuy({
    symbol: "BTC", capital: 12.34567, price: 100,
    priceAsOf: now, balance: 100, balanceAsOf: now
  });

  assert.equal(calls.find(c => c.method === "AddOrder").params.volume, "0.1235");
  assert.equal(trade.volume, 0.1235);
  assert.equal(trade.price, 100);
  assert.equal(trade.balance, 100);
});
