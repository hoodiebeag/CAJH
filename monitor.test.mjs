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
const traderUrl  = pathToFileURL(path.join(process.cwd(), "trader.js")).href;

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

// Same as runMonitor, but also imports trader.js's existing setKrakenApiForTests seam so
// the body can drive monitor.js's live exit path all the way through the exchange sell
// call — the actual confirmed-fill call path, not the backtest model — without hitting
// the network.
function runMonitorWithKraken(dir, body, env = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as monitor from ${JSON.stringify(monitorUrl)};
    import { setKrakenApiForTests, setOrderConfirmDelayForTests } from ${JSON.stringify(traderUrl)};
    ${body}
  `], { env: { ...process.env, DATA_DIR: dir, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

const KRAKEN_ASSET_PAIRS = { result: { XXBTZUSD: { altname: "XBTUSD", lot_decimals: 4, ordermin: "0.0001" } } };

function btcTrade(overrides = {}) {
  return {
    symbol: "BTC", entry: 100, stopLoss: 90, takeProfit: 1000,
    risk: 10, volume: 1, capital: 100, openedAt: Date.now(),
    signal: "test", tf: "1h",
    ...overrides
  };
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

test("hydrateTrades validates every loaded trade before inserting monitor state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-invalid-hydrate-"));
  fs.writeFileSync(path.join(dir, "positions.json"), JSON.stringify([
    { symbol: "NOPE", entry: 100, stopLoss: 90, takeProfit: 120, risk: 10, volume: 1 }
  ]));

  const result = runMonitor(dir, `
    const hydrated = monitor.hydrateTrades();
    console.log("__RESULT__" + JSON.stringify({
      hydrated,
      open: monitor.getOpenTrades(),
      health: monitor.getMonitorHealth(),
      enabled: monitor.isTradingEnabled()
    }));
  `);

  assert.equal(result.hydrated, false);
  assert.deepEqual(result.open, []);
  assert.equal(result.health.hydrated, false);
  assert.match(result.health.lastError, /Unsupported trading symbol/);
  assert.equal(result.enabled, false);
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

test("invalid hydrated trade is rejected before entering monitor state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-invalid-trade-"));
  fs.writeFileSync(path.join(dir, "positions.json"), JSON.stringify([
    { symbol: "PUMP", entry: 100, stopLoss: 90, takeProfit: 120, risk: 10, volume: 1 }
  ]));
  const result = runMonitor(dir, "console.log('__RESULT__' + JSON.stringify({ hydrated: monitor.hydrateTrades(), health: monitor.getMonitorHealth() }))");
  assert.equal(result.hydrated, false);
  assert.equal(result.health.ok, false);
  assert.match(result.health.lastError, /invalid hydrated position/);
});

// ─── Live exit tick: stop / take-profit ─────────────────────────────────────────
// checkExitsForTrades is monitor.js's shared price-feed seam (see its doc comment).
// These drive it directly with a scripted price feed and a mocked Kraken transport
// (trader.js's existing setKrakenApiForTests), so the assertions cover the actual
// live call path up to confirmed-sell — not the backtest model.

test("a stop-loss breach at the polled price produces a confirmed sell and closes the position", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-exit-sl-"));
  const result = runMonitorWithKraken(dir, `
    setOrderConfirmDelayForTests(0);
    let addOrderParams = null;
    setKrakenApiForTests(async (method, params) => {
      if (method === "AssetPairs") return ${JSON.stringify(KRAKEN_ASSET_PAIRS)};
      if (method === "AddOrder") { addOrderParams = params; return { result: { txid: ["T1"] } }; }
      if (method === "QueryOrders") return { result: { T1: { status: "closed", vol_exec: "1", price: "89.5", fee: "0.05" } } };
      throw new Error("unexpected " + method);
    });

    monitor.registerTrade(${JSON.stringify(btcTrade())});
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 89.5 : null));

    console.log("__RESULT__" + JSON.stringify({
      open: monitor.getOpenTrades(),
      addOrderParams
    }));
  `);
  assert.deepEqual(result.open, []);
  assert.equal(result.addOrderParams.type, "sell");
  assert.equal(result.addOrderParams.pair, "XBTUSD");
});

test("a take-profit breach at the polled price produces a confirmed sell and closes the position", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-exit-tp-"));
  const result = runMonitorWithKraken(dir, `
    setOrderConfirmDelayForTests(0);
    let addOrderParams = null;
    setKrakenApiForTests(async (method, params) => {
      if (method === "AssetPairs") return ${JSON.stringify(KRAKEN_ASSET_PAIRS)};
      if (method === "AddOrder") { addOrderParams = params; return { result: { txid: ["T2"] } }; }
      if (method === "QueryOrders") return { result: { T2: { status: "closed", vol_exec: "1", price: "1000", fee: "0.08" } } };
      throw new Error("unexpected " + method);
    });

    monitor.registerTrade(${JSON.stringify(btcTrade())});
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 1000 : null));

    console.log("__RESULT__" + JSON.stringify({
      open: monitor.getOpenTrades(),
      addOrderParams
    }));
  `);
  assert.deepEqual(result.open, []);
  assert.equal(result.addOrderParams.type, "sell");
  assert.equal(result.addOrderParams.pair, "XBTUSD");
});

test("a polled price strictly between stop and target triggers no sell and leaves the position open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-exit-hold-"));
  const result = runMonitorWithKraken(dir, `
    setOrderConfirmDelayForTests(0);
    let addOrderCalled = false;
    setKrakenApiForTests(async (method) => {
      if (method === "AddOrder") { addOrderCalled = true; return { result: { txid: ["T3"] } }; }
      throw new Error("unexpected " + method);
    });

    monitor.registerTrade(${JSON.stringify(btcTrade({ stopLoss: 90, takeProfit: 1000 }))});
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 105 : null));

    console.log("__RESULT__" + JSON.stringify({
      open: monitor.getOpenTrades(),
      addOrderCalled
    }));
  `);
  assert.equal(result.open.length, 1);
  assert.equal(result.addOrderCalled, false);
});

// ─── Live exit tick: breakeven / trailing stop ──────────────────────────────────
// BE_TRIGGER_R=2.0, BE_LOCK_R=0.2, FEE_BUFFER_PCT=0.018 (strategy.js). For entry=100,
// stopLoss=90 (risk=10): lockOffset = max(0.2*10, 0.018*100) = 2; armOffset =
// max(2.0*10, 2+5) = 20 → the stop must not move below price 119.99 and must move at
// exactly 120.

test("breakeven stop does not move one poll before the exact configured R threshold", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-be-early-"));
  const result = runMonitorWithKraken(dir, `
    setOrderConfirmDelayForTests(0);
    setKrakenApiForTests(async (method) => { throw new Error("unexpected " + method); });

    monitor.registerTrade(${JSON.stringify(btcTrade())});
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 119.99 : null));

    console.log("__RESULT__" + JSON.stringify(monitor.getOpenTrades()[0]));
  `);
  assert.equal(result.stopLoss, 90);
  assert.equal(result.beMoved, undefined);
});

test("breakeven stop moves to the exact locked level at the configured R threshold, not one poll late", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-be-exact-"));
  const result = runMonitorWithKraken(dir, `
    setOrderConfirmDelayForTests(0);
    setKrakenApiForTests(async (method) => { throw new Error("unexpected " + method); });

    monitor.registerTrade(${JSON.stringify(btcTrade())});
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 119.99 : null));
    await monitor.checkExitsForTrades(null, async (symbol) => (symbol === "BTC" ? 120 : null));

    console.log("__RESULT__" + JSON.stringify(monitor.getOpenTrades()[0]));
  `);
  assert.equal(result.stopLoss, 102);
  assert.equal(result.beMoved, true);
});
