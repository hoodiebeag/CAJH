import assert from "node:assert/strict";
import test from "node:test";

import {
  getMonitorHealth,
  requireMonitorHealthForEntry,
  resetMonitorHealthForTests
} from "./monitor.js";

test.afterEach(() => resetMonitorHealthForTests());

test("startup with valid state is not entry-eligible until reconciliation is recorded", () => {
  const now = Date.now();
  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: false,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: now
  });

  const blocked = requireMonitorHealthForEntry(now);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /position reconciliation/);

  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: true,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: now
  });
  assert.equal(requireMonitorHealthForEntry(now).ok, true);
});

test("monitor health exposes stale heartbeat, last error, skipped ticks, and software-polled exits", () => {
  const now = Date.now();
  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: false,
    persistenceOk: true,
    tickOk: false,
    lastTickAt: now - 121_000,
    lastError: "reconciliation failed: timeout"
  });

  const health = getMonitorHealth(now);
  assert.equal(health.ok, false);
  assert.equal(health.stale, true);
  assert.equal(health.lastError, "reconciliation failed: timeout");
  assert.equal(Number.isInteger(health.tickSkipped), true);
  assert.equal(health.exitProtection, "software-polled");
});
