import assert from "node:assert/strict";
import test from "node:test";

process.env.CAJH_BOT_NO_LOGIN = "true";
const { getScheduledScanHealth, runScheduledScan } = await import("./bot.js");

function runtime() {
  return {
    state: { scanChannelId: "channel-1", lastScanTime: "before" },
    config: { lastScanTime: "before" },
    health: { ok: true, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null }
  };
}

test("scheduled scanner failure is contained and does not advance lastScanTime", async () => {
  const r = runtime();
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; throw new Error("scanner failed"); },
    persist: () => { throw new Error("must not persist after scanner failure"); },
    health: r.health
  });
  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.equal(getScheduledScanHealth(r.health).ok, false);
});

test("config persistence failure is contained and rolls back the scheduled timestamp", async () => {
  const r = runtime();
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; },
    persist: () => false,
    health: r.health
  });
  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.equal(getScheduledScanHealth(r.health).ok, false);
  assert.match(getScheduledScanHealth(r.health).lastError, /persistence failed/);
});

test("successful scheduled scan persists the new timestamp and records healthy status", async () => {
  const r = runtime();
  const persisted = [];
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; },
    persist: (cfg) => { persisted.push({ ...cfg }); return true; },
    health: r.health
  });

  assert.equal(ok, true);
  assert.equal(r.state.lastScanTime, "after");
  assert.equal(r.config.lastScanTime, "after");
  assert.deepEqual(persisted, [{ lastScanTime: "after" }]);
  assert.equal(getScheduledScanHealth(r.health).ok, true);
  assert.equal(getScheduledScanHealth(r.health).lastError, null);
});

test("missing scan channel is contained without a cron rejection", async () => {
  const r = { ...runtime(), state: { scanChannelId: null, lastScanTime: "before" } };
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => assert.fail("fetch should not run without a channel id") } },
    scanner: async () => assert.fail("scanner should not run without a channel"),
    persist: () => assert.fail("persist should not run after failure"),
    health: r.health
  });

  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.match(getScheduledScanHealth(r.health).lastError, /no scan channel set/);
});

test("a failed scheduled run blocks later cron scans before they can attempt an order", async () => {
  const r = runtime();
  const first = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async () => { throw new Error("scanner failed"); },
    persist: () => assert.fail("persist should not run after scanner failure"),
    health: r.health
  });
  let attemptedOrder = false;
  const second = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => assert.fail("fetch should not run while unhealthy") } },
    scanner: async () => { attemptedOrder = true; },
    persist: () => assert.fail("persist should not run while unhealthy"),
    health: r.health
  });

  assert.equal(first, false);
  assert.equal(second, false);
  assert.equal(attemptedOrder, false);
  assert.equal(getScheduledScanHealth(r.health).ok, false);
  assert.match(getScheduledScanHealth(r.health).lastError, /scanner failed/);
});
