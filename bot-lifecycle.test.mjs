import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

process.env.CAJH_BOT_NO_LOGIN = "true";
process.env.DISCORD_BOT_TOKEN = "abc.def.ghi-jklmnopqrstuvwxyz012345";
process.env.KRAKEN_API_SECRET = "sk-supersecretvalue1234567890";

const {
  attachDiscordLifecycleGuards,
  loginDiscord,
  sanitizeErrorMessage
} = await import(`./bot.js?botLifecycle=${Date.now()}`);

test("sanitizeErrorMessage redacts Discord and API-looking secrets", () => {
  const err = new Error(`token ${process.env.DISCORD_BOT_TOKEN} secret ${process.env.KRAKEN_API_SECRET}`);
  const msg = sanitizeErrorMessage(err);
  assert.equal(msg.includes(process.env.DISCORD_BOT_TOKEN), false);
  assert.equal(msg.includes(process.env.KRAKEN_API_SECRET), false);
  assert.match(msg, /redacted/);
});

test("ready timeout becomes a fatal lifecycle error when Discord never reaches ready", () => {
  const client = new EventEmitter();
  let timeoutFn;
  const fatal = [];
  attachDiscordLifecycleGuards(client, {
    readyTimeoutMs: 25,
    onFatal: (kind, err) => fatal.push({ kind, err: err.message }),
    setTimer: (fn, ms) => {
      assert.equal(ms, 25);
      timeoutFn = fn;
      return "timer";
    },
    clearTimer: () => assert.fail("timer should not clear before ready")
  });

  timeoutFn();
  assert.deepEqual(fatal, [{ kind: "discordReadyTimeout", err: "Discord did not become ready within 25ms" }]);
});

test("clientReady clears the bounded ready timeout", () => {
  const client = new EventEmitter();
  let timeoutFn;
  let cleared = null;
  const fatal = [];
  attachDiscordLifecycleGuards(client, {
    readyTimeoutMs: 25,
    onFatal: (kind, err) => fatal.push({ kind, err: err.message }),
    setTimer: (fn) => {
      timeoutFn = fn;
      return "timer";
    },
    clearTimer: (timer) => { cleared = timer; }
  });

  client.emit("clientReady");
  timeoutFn();
  assert.equal(cleared, "timer");
  assert.deepEqual(fatal, []);
});

test("login rejection is routed to fatal handling instead of falling through", async () => {
  const fatal = [];
  const client = {
    login: async () => { throw new Error("bad token"); }
  };

  await loginDiscord(client, "token", (kind, err) => fatal.push({ kind, err: err.message }));
  assert.deepEqual(fatal, [{ kind: "discordLoginRejected", err: "bad token" }]);
});
