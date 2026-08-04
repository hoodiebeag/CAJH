import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const storageUrl = pathToFileURL(path.join(process.cwd(), "storage.js")).href;
const monitorUrl = pathToFileURL(path.join(process.cwd(), "monitor.js")).href;

function runModule(body, env = {}) {
  const nextEnv = { ...process.env, ...env };
  if (env.DATA_DIR === undefined) delete nextEnv.DATA_DIR;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", body], {
    env: nextEnv,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

test("storage preflight fails closed when DATA_DIR is not explicit but research storage remains usable", () => {
  const result = runModule(`
    const storage = await import(${JSON.stringify(storageUrl)});
    const saved = storage.saveConfig({ scanChannelId: null, watchlist: [], lastScanTime: null });
    console.log("__RESULT__" + JSON.stringify({ preflight: storage.checkStoragePreflight(), saved }));
  `, { DATA_DIR: undefined });

  assert.equal(result.saved, true);
  assert.equal(result.preflight.ok, false);
  assert.match(result.preflight.reason, /DATA_DIR must be explicitly set/);
});

test("storage preflight passes only when explicit DATA_DIR is writable and recoverable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-preflight-"));
  const result = runModule(`
    const storage = await import(${JSON.stringify(storageUrl)});
    console.log("__RESULT__" + JSON.stringify(storage.checkStoragePreflight()));
  `, { DATA_DIR: dir });

  assert.equal(result.ok, true);
  assert.equal(result.dataDir, dir);
});

test("resumeManual refuses live trading without durable DATA_DIR even when monitor health is green", () => {
  const result = runModule(`
    const monitor = await import(${JSON.stringify(monitorUrl)});
    monitor.resetMonitorHealthForTests({
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: Date.now()
    });
    const resumed = monitor.resumeManual();
    console.log("__RESULT__" + JSON.stringify({ resumed, enabled: monitor.isTradingEnabled(), halt: monitor.getHaltState() }));
  `, { DATA_DIR: undefined, LIVE_TRADING: "true" });

  assert.equal(result.resumed, false);
  assert.equal(result.enabled, false);
  assert.match(result.halt.reason, /DATA_DIR must be explicitly set/);
});

test("resumeManual can enable only after explicit writable DATA_DIR and healthy monitor preflight", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-preflight-"));
  const result = runModule(`
    const monitor = await import(${JSON.stringify(monitorUrl)});
    monitor.resetMonitorHealthForTests({
      hydrated: true,
      reconciled: true,
      persistenceOk: true,
      tickOk: true,
      lastTickAt: Date.now()
    });
    const resumed = monitor.resumeManual();
    console.log("__RESULT__" + JSON.stringify({ resumed, enabled: monitor.isTradingEnabled(), halt: monitor.getHaltState() }));
  `, { DATA_DIR: dir, LIVE_TRADING: "true" });

  assert.equal(result.resumed, true);
  assert.equal(result.enabled, true);
  assert.equal(result.halt.active, false);
});
