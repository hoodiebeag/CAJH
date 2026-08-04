import assert from "node:assert/strict";
import test from "node:test";

import { parseConfirmedSell } from "./trader.js";
import {
  applyConfirmedSellToTrade,
  canResume,
  reconcile,
  requireMonitorHealthForEntry,
  resetMonitorHealthForTests
} from "./monitor.js";

test.afterEach(() => resetMonitorHealthForTests());

test("entry eligibility fails closed until hydration, reconciliation, persistence, and heartbeat are healthy", () => {
  const now = 1_000_000;
  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: true,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: now
  });
  assert.equal(requireMonitorHealthForEntry(now).ok, true);

  for (const field of ["hydrated", "reconciled", "persistenceOk", "tickOk"]) {
    resetMonitorHealthForTests({
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: now,
      [field]: false
    });
    assert.equal(requireMonitorHealthForEntry(now).ok, false, field);
  }

  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: true,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: now - 120_001
  });
  assert.equal(requireMonitorHealthForEntry(now).ok, false);
});

test("manual or automated resume requires both explicit live opt-in and healthy monitor state", () => {
  assert.equal(canResume({ liveOptIn: false, monitorHealthy: true }), false);
  assert.equal(canResume({ liveOptIn: true, monitorHealthy: false }), false);
  assert.equal(canResume({ liveOptIn: true, monitorHealthy: true }), true);
});

test("reconciliation classifies stablecoins, dust, orphans, and ghosts without trading", () => {
  const result = reconcile(
    [
      { asset: "USD", qty: 100, value: 100 },
      { asset: "BTC", qty: 1, value: 100 },
      { asset: "SOL", qty: 0.01, value: 0.50 },
      { asset: "ADA", qty: 200, value: 200 }
    ],
    [
      { symbol: "BTC", volume: 1 },
      { symbol: "PUMP", volume: 3 },
      { symbol: "ETH", volume: 3 }
    ]
  );
  assert.deepEqual(result.orphans, [{ asset: "ADA", qty: 200, value: 200 }]);
  assert.deepEqual(result.ghosts, [
    { symbol: "PUMP", volume: 3 },
    { symbol: "ETH", volume: 3 }
  ]);
});

test("confirmed full and partial exits change tracked volume only by executed volume", () => {
  const full = { symbol: "BTC", volume: 1.5 };
  const confirmedFull = parseConfirmedSell({ status: "closed", vol_exec: "1.5", price: "101" }, full.volume);
  assert.deepEqual(applyConfirmedSellToTrade(full, confirmedFull), { status: "closed", remaining: 0 });
  assert.equal(full.volume, 1.5);

  const partial = { symbol: "ETH", volume: 2.5 };
  const confirmedPartial = parseConfirmedSell({ status: "closed", vol_exec: "0.75", price: "2100" }, partial.volume);
  assert.deepEqual(applyConfirmedSellToTrade(partial, confirmedPartial), { status: "partial", remaining: 1.75 });
  assert.equal(partial.volume, 1.75);
});

test("unknown, non-terminal, and zero-fill exits retain the original position", () => {
  for (const order of [
    null,
    { status: "open", vol_exec: "0", price: "100" },
    { status: "canceled", vol_exec: "0", price: "100" },
    { status: "expired", vol_exec: "0", price: "100" },
    { status: "rejected", vol_exec: "0", price: "100" },
    { status: "closed", vol_exec: "0", price: "100" },
    { status: "closed", vol_exec: "1", price: "0" }
  ]) {
    assert.throws(() => parseConfirmedSell(order, 1));
  }
  const trade = { symbol: "SOL", volume: 4 };
  assert.deepEqual(applyConfirmedSellToTrade(trade, { volume: 0 }), { status: "invalid" });
  assert.equal(trade.volume, 4);
});
