import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isQuoteStale, selectRotationCandidate } from "./scanner.js";
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

function trade(symbol, entry, stopLoss, risk) {
  return risk === undefined ? { symbol, entry, stopLoss } : { symbol, entry, stopLoss, risk };
}

// Mirrors the pre-refactor inline rotation loop in proposeBuyLocked byte-for-byte
// (minus the network fetch/try-catch, which the caller now owns) so the extraction
// can be proven behavior-preserving rather than just plausible.
function legacySelectRotationCandidate(openTrades, priceMap) {
  let best = null;
  for (const t of openTrades) {
    const p = priceMap[t.symbol];
    if (p == null) continue;
    const tRisk = t.risk ?? (t.entry - t.stopLoss);
    const r = tRisk > 0 ? (p - t.entry) / tRisk : 0;
    if (!best || r > best.r) best = { trade: t, price: p, r };
  }
  return best;
}

test("selectRotationCandidate picks the highest R-multiple open position", () => {
  const openTrades = [trade("BTC", 100, 90), trade("ETH", 50, 45), trade("SOL", 20, 18)];
  const prices = { BTC: 105, ETH: 60, SOL: 19 }; // R: BTC 0.5, ETH 2.0, SOL 0.5
  const best = selectRotationCandidate(openTrades, prices);
  assert.equal(best.trade.symbol, "ETH");
  assert.equal(best.price, 60);
  assert.equal(best.r, 2);
});

test("selectRotationCandidate accepts a Map of prices as well as a plain object", () => {
  const openTrades = [trade("BTC", 100, 90), trade("ETH", 50, 45)];
  const prices = new Map([["BTC", 105], ["ETH", 60]]);
  assert.equal(selectRotationCandidate(openTrades, prices).trade.symbol, "ETH");
});

test("selectRotationCandidate breaks ties by keeping the first-encountered candidate", () => {
  const openTrades = [trade("BTC", 100, 90), trade("ETH", 50, 45)];
  const prices = { BTC: 105, ETH: 52.5 }; // both R = 0.5
  assert.equal(selectRotationCandidate(openTrades, prices).trade.symbol, "BTC");
});

test("selectRotationCandidate returns null when no open position could be priced", () => {
  const openTrades = [trade("BTC", 100, 90), trade("ETH", 50, 45)];
  assert.equal(selectRotationCandidate(openTrades, {}), null);
  assert.equal(selectRotationCandidate(openTrades, new Map()), null);
});

test("selectRotationCandidate still ranks (least-bad) when every priced position is a loser", () => {
  const openTrades = [trade("BTC", 100, 90), trade("ETH", 50, 45)];
  const prices = { BTC: 95, ETH: 40 }; // R: BTC -0.5, ETH -2
  const best = selectRotationCandidate(openTrades, prices);
  assert.equal(best.trade.symbol, "BTC");
  assert.ok(best.r <= 0, "caller's 'none are in profit' skip path relies on this staying <= 0");
});

test("selectRotationCandidate ranks the same at exactly MAX_OPEN_POSITIONS (6) and under it", () => {
  const atCap = Array.from({ length: 6 }, (_, i) => trade(`SYM${i}`, 100, 90));
  const underCap = atCap.slice(0, 3);
  const prices = Object.fromEntries(atCap.map((t, i) => [t.symbol, 100 + i])); // increasing R
  assert.equal(selectRotationCandidate(atCap, prices).trade.symbol, "SYM5");
  assert.equal(selectRotationCandidate(underCap, prices).trade.symbol, "SYM2");
});

test("selectRotationCandidate matches the pre-refactor inline rotation loop byte-for-byte", () => {
  const scenarios = [
    { openTrades: [trade("BTC", 100, 90), trade("ETH", 50, 45), trade("SOL", 20, 18)], prices: { BTC: 105, ETH: 60, SOL: 19 } },
    { openTrades: [trade("BTC", 100, 90), trade("ETH", 50, 45)], prices: { BTC: 105, ETH: 52.5 } },
    { openTrades: [trade("BTC", 100, 90), trade("ETH", 50, 45)], prices: { BTC: 95, ETH: 40 } },
    { openTrades: [trade("BTC", 100, 90)], prices: {} },
    { openTrades: [trade("BTC", 100, 100, 0)], prices: { BTC: 110 } },
  ];
  for (const { openTrades, prices } of scenarios) {
    assert.deepEqual(selectRotationCandidate(openTrades, prices), legacySelectRotationCandidate(openTrades, prices));
  }
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
