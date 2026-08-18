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
