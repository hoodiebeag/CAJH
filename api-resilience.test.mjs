import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyKrakenError,
  getAccountBalanceSnapshot,
  getCurrentPriceSnapshot,
  getHoldings,
  placeBuy,
  setKrakenApiForTests,
  setOrderConfirmDelayForTests
} from "./trader.js";

test.afterEach(() => {
  setKrakenApiForTests();
  setOrderConfirmDelayForTests();
});

test("Kraken error classification separates retryable transport failures from terminal errors", () => {
  assert.equal(classifyKrakenError(Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" })), "retryable");
  assert.equal(classifyKrakenError(new Error("EOrder:Invalid volume")), "terminal");
  assert.equal(classifyKrakenError(new Error("something strange")), "unknown");
});

test("price snapshot retries bounded transport failure and keeps the fresh timestamped quote", async () => {
  let calls = 0;
  setKrakenApiForTests(async (method) => {
    assert.equal(method, "Ticker");
    calls++;
    if (calls === 1) throw Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" });
    return { result: { XXBTZUSD: { c: ["101.25"] } } };
  });

  const before = Date.now();
  const quote = await getCurrentPriceSnapshot("BTC");
  assert.equal(calls, 2);
  assert.equal(quote.price, 101.25);
  assert.equal(quote.asOf >= before, true);
});

test("terminal Kraken errors do not retry as if they were transport unknowns", async () => {
  let calls = 0;
  setKrakenApiForTests(async () => {
    calls++;
    throw new Error("EOrder:Invalid permissions");
  });

  await assert.rejects(
    () => getCurrentPriceSnapshot("BTC"),
    (err) => err.krakenState === "terminal" && /terminal error/.test(err.message)
  );
  assert.equal(calls, 1);
});

test("exhausted retryable price state throws explicit unknown instead of returning a fallback quote", async () => {
  let calls = 0;
  setKrakenApiForTests(async () => {
    calls++;
    throw Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
  });

  await assert.rejects(
    () => getCurrentPriceSnapshot("BTC"),
    (err) => err.krakenState === "unknown" && /Ticker state unknown after 2 attempt/.test(err.message)
  );
  assert.equal(calls, 2);
});

test("balance snapshot rejects malformed remote state instead of producing usable cash", async () => {
  setKrakenApiForTests(async (method) => {
    assert.equal(method, "Balance");
    return { result: { ZUSD: "not-a-number" } };
  });

  await assert.rejects(() => getAccountBalanceSnapshot(), /finite and non-negative/);
});

test("metadata transport failure is bounded and cannot reach AddOrder", async () => {
  const calls = [];
  setKrakenApiForTests(async (method) => {
    calls.push(method);
    if (method === "AssetPairs") throw Object.assign(new Error("temporary unavailable"), { code: "ETIMEDOUT" });
    if (method === "AddOrder") throw new Error("AddOrder should not be called");
    return { result: {} };
  });
  const now = Date.now();

  await assert.rejects(() => placeBuy({
    symbol: "BTC", capital: 10, price: 100,
    priceAsOf: now, balance: 100, balanceAsOf: now
  }), /AssetPairs state unknown after 2 attempt/);

  assert.deepEqual(calls, ["AssetPairs", "AssetPairs"]);
  assert.equal(calls.includes("AddOrder"), false);
});

test("holdings valuation propagates unknown ticker state to reconciliation callers", async () => {
  const calls = [];
  setKrakenApiForTests(async (method, params) => {
    calls.push({ method, params });
    if (method === "Balance") return { result: { XXBT: "0.1" } };
    if (method === "Ticker") throw Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
    throw new Error(`unexpected ${method}`);
  });

  await assert.rejects(() => getHoldings(), /holding price for BTC is unknown/);
  assert.equal(calls.filter(c => c.method === "Ticker").length, 2);
});
