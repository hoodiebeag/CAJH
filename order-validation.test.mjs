import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSupportedPair,
  validateOrderRequest,
  validateTrackedTrade
} from "./trader.js";

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
