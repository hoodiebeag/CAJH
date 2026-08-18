import assert from "node:assert/strict";
import test from "node:test";

import { IBKRBroker } from "./ibkr.mjs";

test("IBKRBroker exposes exactly the six interface methods", () => {
  const keys = Object.keys(IBKRBroker).sort();
  assert.deepEqual(keys, [
    "fetchOHLC",
    "getAccountBalanceSnapshot",
    "getCurrentPriceSnapshot",
    "placeBuy",
    "placeSell",
    "symbolToNativeId",
  ]);
});

test("every IBKRBroker method throws a clear not-configured error instead of silently doing nothing", () => {
  for (const key of Object.keys(IBKRBroker)) {
    assert.throws(() => IBKRBroker[key](), /not implemented - IBKR API access is not yet configured/);
  }
});
