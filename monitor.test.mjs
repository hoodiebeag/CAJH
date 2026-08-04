import assert from "node:assert/strict";
import test from "node:test";
import {
  getMonitorHealth,
  requireMonitorHealthForEntry,
  resetMonitorHealthForTests
} from "./monitor.js";

test.afterEach(() => resetMonitorHealthForTests());

test("monitor entry health fails closed until every prerequisite is ready", () => {
  assert.equal(requireMonitorHealthForEntry().ok, false);
  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: true,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: Date.now()
  });
  assert.equal(requireMonitorHealthForEntry().ok, true);
});

test("stale heartbeat blocks entry", () => {
  const now = Date.now();
  resetMonitorHealthForTests({
    hydrated: true,
    reconciled: true,
    persistenceOk: true,
    tickOk: true,
    lastTickAt: now - 2 * 60 * 1000 - 1
  });
  const result = requireMonitorHealthForEntry(now);
  assert.equal(result.ok, false);
  assert.match(result.reason, /heartbeat is stale/);
  assert.equal(getMonitorHealth(now).stale, true);
});

test("each failed prerequisite identifies an unsafe entry condition", () => {
  for (const condition of ["hydrated", "reconciled", "persistenceOk"]) {
    const status = {
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: Date.now()
    };
    status[condition] = false;
    resetMonitorHealthForTests(status);
    const result = requireMonitorHealthForEntry();
    assert.equal(result.ok, false);
    assert.notEqual(result.reason, "");
  }
});
