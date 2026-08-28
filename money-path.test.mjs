import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseConfirmedSell } from "./trader.js";
import {
  applyConfirmedSellToTrade,
  canResume,
  checkDrawdown,
  createSingleFlight,
  enableTrading,
  isTradingEnabled,
  reconcile,
  requireMonitorHealthForEntry,
  resetDailyStats,
  resetMonitorHealthForTests
} from "./monitor.js";
import {
  levelOnCooldown,
  markLevelTraded,
  resetLevelCooldownsForTests
} from "./scanner.js";

test.afterEach(() => resetMonitorHealthForTests());

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

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

test("manual and scheduled money-path work cannot overlap the same single-flight guard", async () => {
  const gate = createSingleFlight("MONEY-PATH");
  const slow = deferred();
  const first = gate.run(() => slow.promise.then(() => "first-complete"));

  assert.equal(gate.telemetry().active, true);
  assert.equal(await gate.run(() => "second-should-skip"), undefined);
  assert.deepEqual(gate.telemetry(), { active: true, skipped: 1 });

  slow.resolve();
  assert.equal(await first, "first-complete");
  assert.equal(await gate.run(() => "third-runs-after-release"), "third-runs-after-release");
});

test("structural-level cooldown blocks the same pivot until its exact hand-computed expiry", () => {
  // markLevelTraded() persists to DATA_DIR/level_cooldowns.json for real (scanner.js has no
  // storage mock) — isolate this test to a scratch dir so it can't read back a still-"unexpired"
  // record (per this test's own fixed `now`) left on disk by an earlier run of this same test.
  const prevDataDir = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-levels-"));
  process.env.DATA_DIR = dir;
  try {
    resetLevelCooldownsForTests();
    const buy = { tf: "4h", pivotIndex: 12, pivotPrice: 90, trigger: 101 };
    const now = Date.UTC(2026, 0, 1);
    const expiry = now + 24 * 240 * 60 * 1000;

    assert.equal(levelOnCooldown("BTC", buy, now), false);
    assert.equal(markLevelTraded("BTC", buy, 240, now), true);
    assert.equal(levelOnCooldown("BTC", buy, expiry - 1), true);
    assert.equal(levelOnCooldown("BTC", buy, expiry), false);
  } finally {
    resetLevelCooldownsForTests();
    if (prevDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("daily drawdown disables new entries at the exact configured 10% equity loss", () => {
  enableTrading();
  resetDailyStats(1_000);

  assert.equal(checkDrawdown(901), false);
  assert.equal(isTradingEnabled(), true);
  assert.equal(checkDrawdown(900), true);
  assert.equal(isTradingEnabled(), false);

  resetDailyStats(1_000);
  enableTrading();
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
