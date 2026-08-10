import assert from "node:assert/strict";
import test from "node:test";

import {
  callKraken,
  isIgnoredReconciliationBalance,
  parseConfirmedSell,
  placeBuy,
  setKrakenApiForTests,
  setOrderConfirmDelayForTests
} from "./trader.js";
import { applyConfirmedSellToTrade } from "./monitor.js";

test.afterEach(() => {
  setKrakenApiForTests();
  setOrderConfirmDelayForTests();
});

function assetPairsResult() {
  return { result: { XXBTZUSD: { altname: "XBTUSD", lot_decimals: 4, ordermin: "0.0001" } } };
}

function buyArgs() {
  const now = Date.now();
  return { symbol: "BTC", capital: 100, price: 100, priceAsOf: now, balance: 1000, balanceAsOf: now };
}

test("Kraken staked balance extensions are excluded from reconciliation", () => {
  assert.equal(isIgnoredReconciliationBalance("XTZ.S"), true);
  assert.equal(isIgnoredReconciliationBalance("ETH.S"), true);
  assert.equal(isIgnoredReconciliationBalance("INJ.B"), true);
  assert.equal(isIgnoredReconciliationBalance("XBT.M"), false);
  assert.equal(isIgnoredReconciliationBalance("ETH"), false);
});

test("confirmed full sell removes the tracked position decision", () => {
  const trade = { symbol: "BTC", volume: 1.5 };
  const sold = parseConfirmedSell({ status: "closed", vol_exec: "1.5", price: "101", fee: "0.12" }, trade.volume);

  assert.deepEqual(sold, { volume: 1.5, price: 101, fee: 0.12 });
  assert.deepEqual(applyConfirmedSellToTrade(trade, sold), { status: "closed", remaining: 0 });
  assert.equal(trade.volume, 1.5);
});

test("confirmed partial sell retains the exact remaining tracked volume", () => {
  const trade = { symbol: "ETH", volume: 2.5 };
  const sold = parseConfirmedSell({ status: "closed", vol_exec: "0.75", price: "2100", fee: "1.2" }, trade.volume);

  assert.deepEqual(sold, { volume: 0.75, price: 2100, fee: 1.2 });
  assert.deepEqual(applyConfirmedSellToTrade(trade, sold), { status: "partial", remaining: 1.75 });
  assert.equal(trade.volume, 1.75);
});

test("unknown, canceled, expired, rejected, and zero-fill sells retain tracked state", () => {
  const badOrders = [
    null,
    { status: "open", vol_exec: "0", price: "100" },
    { status: "canceled", vol_exec: "0", price: "100" },
    { status: "expired", vol_exec: "0", price: "100" },
    { status: "rejected", vol_exec: "0", price: "100" },
    { status: "closed", vol_exec: "0", price: "100" },
    { status: "closed", vol_exec: "1", price: "0" }
  ];

  for (const order of badOrders) {
    assert.throws(() => parseConfirmedSell(order, 1));
  }
  const trade = { symbol: "SOL", volume: 4 };
  assert.deepEqual(applyConfirmedSellToTrade(trade, { volume: 0, price: 50 }), { status: "invalid" });
  assert.equal(trade.volume, 4);
});

test("buy fill confirmation polls through pending QueryOrders responses before registering the position", async () => {
  setOrderConfirmDelayForTests(0);
  let queryOrdersCalls = 0;
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") {
      queryOrdersCalls++;
      if (queryOrdersCalls < 3) return { result: {} }; // not yet visible
      if (queryOrdersCalls === 3) return { result: { T1: { status: "open" } } }; // pending, not terminal
      return { result: { T1: { status: "closed", vol_exec: "1", price: "100", fee: "0.05" } } };
    }
    throw new Error(`unexpected method ${method}`);
  });

  const trade = await placeBuy(buyArgs());
  assert.equal(queryOrdersCalls, 4);
  assert.equal(trade.volume, 1);
  assert.equal(trade.price, 100);
});

test("buy fill confirmation registers the exact confirmed volume and price on a terminal fill", async () => {
  setOrderConfirmDelayForTests(0);
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") return { result: { T1: { status: "closed", vol_exec: "1", price: "101.5", fee: "0.06" } } };
    throw new Error(`unexpected method ${method}`);
  });

  const trade = await placeBuy(buyArgs());
  assert.equal(trade.volume, 1);
  assert.equal(trade.price, 101.5);
  assert.equal(trade.fee, 0.06);
});

test("buy fill confirmation registers a partial executed volume, never the requested amount", async () => {
  setOrderConfirmDelayForTests(0);
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") return { result: { T1: { status: "closed", vol_exec: "0.4", price: "100", fee: "0.02" } } };
    throw new Error(`unexpected method ${method}`);
  });

  const trade = await placeBuy(buyArgs());
  assert.equal(trade.volume, 0.4);
  assert.notEqual(trade.volume, 1); // requested volume was 1 (100 capital / 100 price)
});

test("buy fill confirmation throws and never registers a position when Kraken canceled the order", async () => {
  setOrderConfirmDelayForTests(0);
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") return { result: { T1: { status: "canceled" } } };
    throw new Error(`unexpected method ${method}`);
  });

  await assert.rejects(() => placeBuy(buyArgs()), /was canceled by Kraken — nothing filled, position not tracked/);
});

test("buy fill confirmation throws unconfirmed after exhausting retries on persistent QueryOrders errors", async () => {
  setOrderConfirmDelayForTests(0);
  let queryOrdersCalls = 0;
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") {
      queryOrdersCalls++;
      throw new Error("network unavailable");
    }
    throw new Error(`unexpected method ${method}`);
  });

  await assert.rejects(() => placeBuy(buyArgs()), /could not confirm buy T1 filled — NOT tracking it/);
  // confirmBuyFill polls 10 times; each poll retries transport failures via callKraken's
  // own DEFAULT_KRAKEN_ATTEMPTS=2, so the mock sees 20 raw QueryOrders invocations.
  assert.equal(queryOrdersCalls, 20);
});

test("buy fill confirmation recovers from a transient QueryOrders error and still confirms the fill", async () => {
  setOrderConfirmDelayForTests(0);
  let queryOrdersCalls = 0;
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["T1"] } };
    if (method === "QueryOrders") {
      queryOrdersCalls++;
      if (queryOrdersCalls === 1) throw new Error("temporary network blip");
      return { result: { T1: { status: "closed", vol_exec: "1", price: "100", fee: "0.05" } } };
    }
    throw new Error(`unexpected method ${method}`);
  });

  const trade = await placeBuy(buyArgs());
  assert.equal(trade.volume, 1);
  assert.equal(queryOrdersCalls, 2);
});

test("R-013: order placement is never auto-retried on an ambiguous transport error", async () => {
  let calls = 0;
  setKrakenApiForTests(async () => {
    calls++;
    throw Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" });
  });

  await assert.rejects(
    () => callKraken("AddOrder", { pair: "XBTUSD", type: "buy", ordertype: "market", volume: "1" }),
    (err) => err.krakenState === "unknown" && /state unknown after 1 attempt/.test(err.message)
  );
  assert.equal(calls, 1);
});

test("R-013: order placement surfaces a terminal error immediately without retrying", async () => {
  let calls = 0;
  setKrakenApiForTests(async () => {
    calls++;
    throw new Error("EOrder:Invalid permissions");
  });

  await assert.rejects(
    () => callKraken("AddOrder", { pair: "XBTUSD", type: "buy", ordertype: "market", volume: "1" }),
    (err) => err.krakenState === "terminal" && /terminal error/.test(err.message)
  );
  assert.equal(calls, 1);
});

test("R-013: idempotent read calls keep their prior bounded-retry behavior unchanged", async () => {
  let calls = 0;
  setKrakenApiForTests(async () => {
    calls++;
    throw Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
  });

  await assert.rejects(
    () => callKraken("Balance", {}),
    (err) => err.krakenState === "unknown" && /state unknown after 2 attempt/.test(err.message)
  );
  assert.equal(calls, 2);
});
