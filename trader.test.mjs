import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import {
  callKraken,
  fetchOHLC,
  getAccountBalance,
  getCurrentPrice,
  getHoldings,
  isIgnoredReconciliationBalance,
  parseConfirmedSell,
  placeBuy,
  placeSell,
  setKrakenApiForTests,
  setOrderConfirmDelayForTests,
  symbolToPair,
  validateFreshPositiveSnapshot
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

// ─── placeSell / confirmSellFill (previously zero direct coverage) ────────────────

test("placeSell places a market sell and returns the confirmed executed volume/price", async () => {
  setOrderConfirmDelayForTests(0);
  const calls = [];
  setKrakenApiForTests(async (method, params) => {
    calls.push(method);
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") {
      assert.deepEqual(params, { pair: "XBTUSD", type: "sell", ordertype: "market", volume: "1.5000" });
      return { result: { txid: ["S1"] } };
    }
    if (method === "QueryOrders") return { result: { S1: { status: "closed", vol_exec: "1.5", price: "102", fee: "0.09" } } };
    throw new Error(`unexpected method ${method}`);
  });

  const result = await placeSell({ symbol: "BTC", volume: 1.5, price: 100, priceAsOf: Date.now() });
  assert.deepEqual(result, { txid: "S1", symbol: "BTC", pair: "XBTUSD", side: "sell", volume: 1.5, price: 102, fee: 0.09 });
  assert.deepEqual(calls, ["AssetPairs", "AddOrder", "QueryOrders"]);
});

test("placeSell surfaces the executed volume even when Kraken only partially fills it", async () => {
  setOrderConfirmDelayForTests(0);
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["S1"] } };
    if (method === "QueryOrders") return { result: { S1: { status: "closed", vol_exec: "0.6", price: "100", fee: "0.03" } } };
    throw new Error(`unexpected method ${method}`);
  });

  const result = await placeSell({ symbol: "BTC", volume: 1, price: 100, priceAsOf: Date.now() });
  assert.equal(result.volume, 0.6);
});

test("placeSell rejects with no confirmed close when Kraken canceled/expired/rejected the sell", async () => {
  setOrderConfirmDelayForTests(0);
  for (const status of ["canceled", "expired", "rejected"]) {
    setKrakenApiForTests(async (method) => {
      if (method === "AssetPairs") return assetPairsResult();
      if (method === "AddOrder") return { result: { txid: ["S1"] } };
      if (method === "QueryOrders") return { result: { S1: { status } } };
      throw new Error(`unexpected method ${method}`);
    });
    await assert.rejects(
      () => placeSell({ symbol: "BTC", volume: 1, price: 100, priceAsOf: Date.now() }),
      new RegExp(`was ${status}; no confirmed close`)
    );
  }
});

test("placeSell exhausts polling and reports the position as retained, not lost, on persistent QueryOrders errors", async () => {
  setOrderConfirmDelayForTests(0);
  let queryOrdersCalls = 0;
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["S1"] } };
    if (method === "QueryOrders") {
      queryOrdersCalls++;
      throw new Error("network unavailable");
    }
    throw new Error(`unexpected method ${method}`);
  });

  await assert.rejects(
    () => placeSell({ symbol: "BTC", volume: 1, price: 100, priceAsOf: Date.now() }),
    /could not confirm sell S1 terminal execution; tracked position retained/
  );
  assert.equal(queryOrdersCalls, 20); // 10 polls x DEFAULT_KRAKEN_ATTEMPTS=2 transport retries each
});

test("placeSell recovers from a transient QueryOrders error and still confirms the fill", async () => {
  setOrderConfirmDelayForTests(0);
  let queryOrdersCalls = 0;
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") return { result: { txid: ["S1"] } };
    if (method === "QueryOrders") {
      queryOrdersCalls++;
      if (queryOrdersCalls === 1) throw new Error("temporary network blip");
      return { result: { S1: { status: "closed", vol_exec: "1", price: "100", fee: "0.05" } } };
    }
    throw new Error(`unexpected method ${method}`);
  });

  const result = await placeSell({ symbol: "BTC", volume: 1, price: 100, priceAsOf: Date.now() });
  assert.equal(result.volume, 1);
  assert.equal(queryOrdersCalls, 2);
});

test("placeSell never calls AddOrder for a stale price quote", async () => {
  const calls = [];
  setKrakenApiForTests(async (method) => {
    calls.push(method);
    if (method === "AssetPairs") return assetPairsResult();
    if (method === "AddOrder") throw new Error("AddOrder should not be called");
    return { result: {} };
  });

  await assert.rejects(
    () => placeSell({ symbol: "BTC", volume: 1, price: 100, priceAsOf: Date.now() - 20_000 }),
    /price snapshot is stale/
  );
  assert.equal(calls.includes("AddOrder"), false);
});

// ─── normalizeVolume boundaries (reached only through placeBuy/placeSell) ─────────

test("placeBuy rejects a computed volume below the pair's Kraken minimum before placing the order", async () => {
  const calls = [];
  setKrakenApiForTests(async (method) => {
    calls.push(method);
    if (method === "AssetPairs") return { result: { XXBTZUSD: { altname: "XBTUSD", lot_decimals: 4, ordermin: "0.01" } } };
    if (method === "AddOrder") throw new Error("AddOrder should not be called");
    return { result: {} };
  });

  await assert.rejects(
    () => placeBuy({ symbol: "BTC", capital: 1, price: 1000, priceAsOf: Date.now(), balance: 1000, balanceAsOf: Date.now() }),
    /is below Kraken's minimum of 0.01/
  );
  assert.equal(calls.includes("AddOrder"), false);
});

test("placeBuy rejects a computed volume that rounds to zero at the pair's lot precision", async () => {
  setKrakenApiForTests(async (method) => {
    if (method === "AssetPairs") return { result: { XXBTZUSD: { altname: "XBTUSD", lot_decimals: 2, ordermin: "0" } } };
    if (method === "AddOrder") throw new Error("AddOrder should not be called");
    return { result: {} };
  });

  await assert.rejects(
    () => placeBuy({ symbol: "BTC", capital: 0.001, price: 100000, priceAsOf: Date.now(), balance: 1000, balanceAsOf: Date.now() }),
    /is zero/
  );
});

// ─── validateFreshPositiveSnapshot future-timestamp guard ─────────────────────────

test("validateFreshPositiveSnapshot rejects a snapshot timestamped implausibly far in the future", () => {
  const now = 1_000_000;
  assert.throws(
    () => validateFreshPositiveSnapshot({ value: 100, asOf: now + 1_001 }, "price", now),
    /price snapshot timestamp is in the future/
  );
  // Within the 1s clock-skew allowance is fine.
  assert.doesNotThrow(() => validateFreshPositiveSnapshot({ value: 100, asOf: now + 500 }, "price", now));
});

// ─── getHoldings happy path (previously only the failure path was covered) ────────

test("getHoldings filters dust and ignored staking balances, values stables at $1, and sorts by value descending", async () => {
  setKrakenApiForTests(async (method, params) => {
    if (method === "Balance") {
      return { result: { ZUSD: "50", XXBT: "0.001", DUST: "0.000000001", "INJ.B": "12" } };
    }
    if (method === "Ticker" && params.pair === "XBTUSD") {
      return { result: { XXBTZUSD: { c: ["100000"] } } };
    }
    throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
  });

  const { holdings, totalUsd } = await getHoldings();
  assert.deepEqual(holdings.map((h) => h.asset), ["BTC", "USD"]);
  assert.equal(holdings[0].value, 100); // 0.001 BTC @ 100000
  assert.equal(holdings[1].value, 50);  // stable valued at $1
  assert.equal(totalUsd, 150);
});

// ─── fetchOHLC (previously zero coverage) ──────────────────────────────────────────

test("fetchOHLC maps Kraken's public OHLC response into candle objects", async (t) => {
  t.mock.method(axios, "get", async () => ({
    data: {
      result: {
        XXBTZUSD: [[1700000000, "100", "105", "99", "104", "102", "12.5", 8]],
        last: 1700000000
      }
    }
  }));

  const candles = await fetchOHLC("XBTUSD", 60);
  assert.equal(candles.length, 1);
  assert.deepEqual(candles[0], { time: 1700000000, open: "100", high: "105", low: "99", close: "104", volume: "12.5" });
});

test("fetchOHLC returns null immediately on a Kraken-reported error, without retrying", async (t) => {
  let calls = 0;
  t.mock.method(axios, "get", async () => {
    calls++;
    return { data: { error: ["EQuery:Unknown asset pair"] } };
  });

  assert.equal(await fetchOHLC("NOPEUSD", 60), null);
  assert.equal(calls, 1);
});

// ─── Thin wrappers around the *Snapshot functions (previously untested directly) ──

test("getAccountBalance and getCurrentPrice return the bare value from their snapshot counterparts", async () => {
  setKrakenApiForTests(async (method, params) => {
    if (method === "Balance") return { result: { ZUSD: "250.5" } };
    if (method === "Ticker") return { result: { XXBTZUSD: { c: ["99999.5"] } } };
    throw new Error(`unexpected ${method}`);
  });

  assert.equal(await getAccountBalance(), 250.5);
  assert.equal(await getCurrentPrice("BTC"), 99999.5);
});

// ─── symbolToPair fallback for symbols outside the curated PAIR_MAP ───────────────

test("symbolToPair falls back to SYMBOLUSD for a symbol outside the curated map", () => {
  assert.equal(symbolToPair("btc"), "XBTUSD");
  assert.equal(symbolToPair("newcoin"), "NEWCOINUSD");
});
