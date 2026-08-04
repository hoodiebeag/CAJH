import assert from "node:assert/strict";
import test from "node:test";

import { isIgnoredReconciliationBalance, parseConfirmedSell } from "./trader.js";
import { applyConfirmedSellToTrade } from "./monitor.js";

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
