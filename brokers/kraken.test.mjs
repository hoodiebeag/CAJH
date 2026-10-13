import assert from "node:assert/strict";
import test from "node:test";

import { KrakenBroker } from "./kraken.mjs";
import * as trader from "../trader.js";

test("KrakenBroker exposes exactly the six interface methods", () => {
  const keys = Object.keys(KrakenBroker).sort();
  assert.deepEqual(keys, [
    "fetchOHLC",
    "getAccountBalanceSnapshot",
    "getCurrentPriceSnapshot",
    "getHoldings",
    "placeBuy",
    "placeSell",
    "symbolToNativeId",
  ]);
});

test("every KrakenBroker method delegates to the matching trader.js export unchanged", () => {
  assert.equal(KrakenBroker.fetchOHLC, trader.fetchOHLC);
  assert.equal(KrakenBroker.getCurrentPriceSnapshot, trader.getCurrentPriceSnapshot);
  assert.equal(KrakenBroker.getAccountBalanceSnapshot, trader.getAccountBalanceSnapshot);
  assert.equal(KrakenBroker.placeBuy, trader.placeBuy);
  assert.equal(KrakenBroker.placeSell, trader.placeSell);
  assert.equal(KrakenBroker.symbolToNativeId, trader.symbolToPair);
});

test("KrakenBroker and IBKRBroker expose an identical surface", async () => {
  // The contract is only worth having if both adapters satisfy it. Extending one without the
  // other is how brokers/interface.md came to describe a shape neither adapter had.
  const { IBKRBroker } = await import("./ibkr.mjs");
  assert.deepEqual(Object.keys(KrakenBroker).sort(), Object.keys(IBKRBroker).sort());
});
