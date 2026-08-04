import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

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

test("fatal shutdown halts entries, persists state, and reports software-exit uncertainty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-shutdown-"));
  const report = runMonitor(dir, `
    monitor.enableTrading();
    const report = monitor.prepareFatalShutdown("fatal integrity loss");
    console.log("__RESULT__" + JSON.stringify({
      report,
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `);

  assert.equal(report.enabled, false);
  assert.equal(report.report.tradingEnabled, false);
  assert.equal(report.report.persisted, true);
  assert.equal(report.report.exitProtection, "software-polled");
  assert.match(report.report.warning, /cannot be guaranteed/);
  assert.equal(report.halt.active, true);
  assert.equal(report.halt.reason, "fatal integrity loss");

  const restored = runMonitor(dir, `
    const restored = monitor.restoreHaltState();
    console.log("__RESULT__" + JSON.stringify({
      restored,
      enabled: monitor.isTradingEnabled(),
      halt: monitor.getHaltState()
    }));
  `, { LIVE_TRADING: "true" });

  assert.equal(restored.restored, true);
  assert.equal(restored.enabled, false);
  assert.equal(restored.halt.active, true);
  assert.equal(restored.halt.reason, "fatal integrity loss");
});
