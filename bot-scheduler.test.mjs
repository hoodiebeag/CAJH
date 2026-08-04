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
    scanner: async state => { state.lastScanTime = "after"; throw new Error("scanner failed"); },
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
    scanner: async state => { state.lastScanTime = "after"; },
    persist: () => false
  });
  assert.equal(ok, false);
  assert.equal(r.state.lastScanTime, "before");
  assert.equal(r.config.lastScanTime, "before");
  assert.equal(getScheduledScanHealth().ok, false);
  assert.match(getScheduledScanHealth().lastError, /persistence failed/);
});
