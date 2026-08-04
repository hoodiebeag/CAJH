import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  getMonitorHealth,
  canResume,
  requireMonitorHealthForEntry,
  resetMonitorHealthForTests
} from "./monitor.js";

const monitorUrl = pathToFileURL(path.join(process.cwd(), "monitor.js")).href;

function runMonitor(dir, body, env = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as monitor from ${JSON.stringify(monitorUrl)};
    ${body}
  `], { env: { ...process.env, DATA_DIR: dir, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

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

test("resume requires both explicit live opt-in and healthy monitor state", () => {
  assert.equal(canResume({ liveOptIn: false, monitorHealthy: true }), false);
  assert.equal(canResume({ liveOptIn: true, monitorHealthy: false }), false);
  assert.equal(canResume({ liveOptIn: true, monitorHealthy: true }), true);
});

test("manual halt reason survives a fresh module load", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-halt-"));
  runMonitor(dir, "monitor.haltManual('operator stop'); console.log('__RESULT__{}');");
  const restored = runMonitor(dir, "monitor.restoreHaltState(); console.log('__RESULT__' + JSON.stringify(monitor.getHaltState()));");
  assert.equal(restored.active, true);
  assert.equal(restored.reason, "operator stop");
});

test("resume cannot enable trading without explicit LIVE_TRADING opt-in", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-halt-"));
  const result = runMonitor(dir, `
    monitor.resetMonitorHealthForTests({
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: Date.now()
    });
    console.log("__RESULT__" + JSON.stringify({
      resumed: monitor.resumeManual(),
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `, { LIVE_TRADING: "false" });
  assert.equal(result.resumed, false);
  assert.equal(result.enabled, false);
  assert.equal(result.halt.active, true);
  assert.equal(result.halt.reason, "LIVE_TRADING opt-in required");
});

test("resume requires explicit opt-in plus healthy monitor state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-halt-"));
  const unhealthy = runMonitor(dir, `
    console.log("__RESULT__" + JSON.stringify({
      resumed: monitor.resumeManual(),
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `, { LIVE_TRADING: "true" });
  assert.equal(unhealthy.resumed, false);
  assert.equal(unhealthy.enabled, false);
  assert.equal(unhealthy.halt.reason, "monitor health required");

  const healthy = runMonitor(dir, `
    monitor.resetMonitorHealthForTests({
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: Date.now()
    });
    console.log("__RESULT__" + JSON.stringify({
      resumed: monitor.resumeManual(),
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `, { LIVE_TRADING: "true" });
  assert.equal(healthy.resumed, true);
  assert.equal(healthy.enabled, true);
  assert.equal(healthy.halt.active, false);
});

test("unreadable persisted halt state restores fail-closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-halt-"));
  fs.writeFileSync(path.join(dir, "stats.json"), "{broken");
  const result = runMonitor(dir, `
    console.log("__RESULT__" + JSON.stringify({
      restored: monitor.restoreHaltState(),
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `, { LIVE_TRADING: "true" });
  assert.equal(result.restored, false);
  assert.equal(result.enabled, false);
  assert.equal(result.halt.active, true);
});
