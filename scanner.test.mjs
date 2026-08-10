import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isQuoteStale } from "./scanner.js";
import { MAX_ORDER_SNAPSHOT_AGE_MS } from "./trader.js";

const root = process.cwd();
const scannerUrl = pathToFileURL(path.join(root, "scanner.js")).href;
const buy = { tf: "1h", pivotPrice: 100 };

test("a quote is fresh at exactly the max age and stale one ms past it", () => {
  const now = 1_000_000;
  assert.equal(isQuoteStale(now, now), false, "age 0 is fresh");
  assert.equal(isQuoteStale(now - MAX_ORDER_SNAPSHOT_AGE_MS, now), false, "exactly at the boundary is still fresh");
  assert.equal(isQuoteStale(now - MAX_ORDER_SNAPSHOT_AGE_MS - 1, now), true, "one ms past the boundary is stale");
  assert.equal(isQuoteStale(undefined, now), true, "a missing timestamp is treated as stale");
  assert.equal(isQuoteStale(NaN, now), true, "a non-finite timestamp is treated as stale");
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cajh-levels-"));
}

function runScanner(dir, body) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as scanner from ${JSON.stringify(scannerUrl)};
    const buy = ${JSON.stringify(buy)};
    ${body}
  `], { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

test("structural-level cooldown survives restart and does not block unrelated levels", () => {
  const dir = tempDir();
  const now = 1_000_000;
  const marked = runScanner(dir, `
    scanner.resetLevelCooldownsForTests();
    const marked = scanner.markLevelTraded("BTC", buy, 60, ${now});
    console.log("__RESULT__" + JSON.stringify({ marked }));
  `);
  assert.equal(marked.marked, true);

  const restarted = runScanner(dir, `
    scanner.resetLevelCooldownsForTests();
    console.log("__RESULT__" + JSON.stringify({
      same: scanner.levelOnCooldown("BTC", buy, ${now + 1_000}),
      unrelated: scanner.levelOnCooldown("ETH", buy, ${now + 1_000})
    }));
  `);
  assert.deepEqual(restarted, { same: true, unrelated: false });
});

test("expired structural-level cooldowns are pruned during restart hydration", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "level_cooldowns.json"), JSON.stringify({
    storageVersion: 1,
    kind: "levelCooldowns",
    data: [{ key: "BTC|1h|100", until: 999 }]
  }));

  const result = runScanner(dir, `
    scanner.resetLevelCooldownsForTests();
    console.log("__RESULT__" + JSON.stringify({
      cooled: scanner.levelOnCooldown("BTC", buy, 1_000)
    }));
  `);
  assert.equal(result.cooled, false);
  const records = JSON.parse(fs.readFileSync(path.join(dir, "level_cooldowns.json"))).data;
  assert.deepEqual(records, []);
});

test("unreadable structural-level cooldown state fails closed", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "level_cooldowns.json"), "{broken");

  const result = runScanner(dir, `
    scanner.resetLevelCooldownsForTests();
    console.log("__RESULT__" + JSON.stringify({
      blocked: scanner.levelOnCooldown("ETH", buy, 1_000)
    }));
  `);
  assert.equal(result.blocked, true);
});
