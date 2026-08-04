import assert from "node:assert/strict";
import test from "node:test";

process.env.CAJH_BOT_NO_LOGIN = "true";
const { getScheduledScanHealth, runScheduledScan } = await import("./bot.js");

function runtime() {
  return {
    state: { scanChannelId: "channel-1", lastScanTime: "before" },
    config: { lastScanTime: "before" }
  };
}

test("scheduled scanner failure is contained and does not advance lastScanTime", async () => {
  const r = runtime();
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; throw new Error("scanner failed"); },
    persist: () => { throw new Error("must not persist after scanner failure"); }
  });
  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.equal(getScheduledScanHealth().ok, false);
});

test("config persistence failure is contained and rolls back the scheduled timestamp", async () => {
  const r = runtime();
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; },
    persist: () => false
  });
  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.equal(getScheduledScanHealth().ok, false);
  assert.match(getScheduledScanHealth().lastError, /persistence failed/);
});

test("successful scheduled scan persists the new timestamp and records healthy status", async () => {
  const r = runtime();
  const persisted = [];
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => ({ id: "channel-1" }) } },
    scanner: async (_channel, state) => { state.lastScanTime = "after"; },
    persist: (cfg) => { persisted.push({ ...cfg }); return true; }
  });

  assert.equal(ok, true);
  assert.equal(r.state.lastScanTime, "after");
  assert.equal(r.config.lastScanTime, "after");
  assert.deepEqual(persisted, [{ lastScanTime: "after" }]);
  assert.equal(getScheduledScanHealth().ok, true);
  assert.equal(getScheduledScanHealth().lastError, null);
});

test("missing scan channel is contained without a cron rejection", async () => {
  const r = { state: { scanChannelId: null, lastScanTime: "before" }, config: { lastScanTime: "before" } };
  const ok = await runScheduledScan("test", {
    runtimeState: r.state,
    runtimeConfig: r.config,
    discordClient: { channels: { fetch: async () => assert.fail("fetch should not run without a channel id") } },
    scanner: async () => assert.fail("scanner should not run without a channel"),
    persist: () => assert.fail("persist should not run after failure")
  });

  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.match(getScheduledScanHealth().lastError, /no scan channel set/);
});
