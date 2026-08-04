import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const storageUrl = pathToFileURL(path.join(root, "storage.js")).href;
const trade = {
  symbol: "BTC", entry: 100, stopLoss: 90, takeProfit: 120, risk: 10, volume: 1
};

function runStorage(dir, body) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as storage from ${JSON.stringify(storageUrl)};
    ${body}
  `], { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cajh-storage-"));
}

test("positions use versioned atomic writes and recover the prior valid copy", () => {
  const dir = tempDir();
  assert.equal(runStorage(dir, `console.log("__RESULT__" + JSON.stringify({ ok: storage.saveTrades([${JSON.stringify(trade)}]) }))`).ok, true);
  const newer = { ...trade, symbol: "ETH" };
  assert.equal(runStorage(dir, `console.log("__RESULT__" + JSON.stringify({ ok: storage.saveTrades([${JSON.stringify(newer)}]) }))`).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "positions.json"))).storageVersion, 1);
  fs.writeFileSync(path.join(dir, "positions.json"), "{interrupted");
  const result = runStorage(dir, "console.log('__RESULT__' + JSON.stringify(storage.loadTradesResult()))");
  assert.equal(result.ok, false);
  assert.equal(result.source, "backup");
  assert.deepEqual(result.value, [trade]);
});

test("invalid position state is explicit unsafe state, never a valid empty portfolio", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "positions.json"), JSON.stringify([{ symbol: "BTC", entry: null }]));
  const result = runStorage(dir, "console.log('__RESULT__' + JSON.stringify({ result: storage.loadTradesResult(), health: storage.getStorageHealth() }))");
  assert.equal(result.result.ok, false);
  assert.equal(result.result.source, "unsafe");
  assert.equal(result.health.positions.ok, false);
  assert.equal(result.result.value, null);
});

test("stats and config retain a readable prior version after an interrupted primary write", () => {
  const dir = tempDir();
  runStorage(dir, "storage.saveStats({ date: '2026-08-04', dailyStartBalance: 100, dailyPnl: 2, tradesToday: 1 }); storage.saveConfig({ scanChannelId: '1', watchlist: [], lastScanTime: 'x' }); console.log('__RESULT__{}')");
  runStorage(dir, "storage.saveStats({ date: '2026-08-05', dailyStartBalance: 110, dailyPnl: 3, tradesToday: 2 }); storage.saveConfig({ scanChannelId: '2', watchlist: [], lastScanTime: 'y' }); console.log('__RESULT__{}')");
  fs.writeFileSync(path.join(dir, "stats.json"), "{");
  fs.writeFileSync(path.join(dir, "config.json"), "{");
  const result = runStorage(dir, "console.log('__RESULT__' + JSON.stringify({ stats: storage.loadStats(), config: storage.loadConfig(), health: storage.getStorageHealth() }))");
  assert.equal(result.stats.date, "2026-08-04");
  assert.equal(result.config.scanChannelId, "1");
  assert.equal(result.health.stats.source, "backup");
  assert.equal(result.health.config.source, "backup");
});
