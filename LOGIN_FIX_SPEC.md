# Bugfix spec — bot.js startup login error visibility (NOT an event rename)

## TL;DR
Startup-appears-dead is a **silent login failure**, not a misnamed event. `client.login()`
(bot.js line ~245) has no `.catch()`, so if login rejects, `clientReady` never fires and all
boot code (monitor, cron, balance, "Logged in as") silently never runs. Fix = make login
failure loud. **Do NOT change `clientReady` to `ready`.**

## Evidence (verified, do not re-litigate)
Checked against the exact pinned version, `discord.js@14.26.4`:
- `Events.ClientReady === "clientReady"` (`node_modules/discord.js/src/util/Events.js:111`).
- The client emits it at `WebSocketManager.js:401`: `this.client.emit(Events.ClientReady, …)`.
- `"ready"` is still emitted (line 386) but is the **deprecated** path; both fire.

→ `client.once("clientReady", …)` is **correct and current** for this version. Renaming to
`"ready"` moves onto the deprecated event and fixes nothing (both fire regardless). The
existing boot logs (`Logged in as cajh#3904`) print from inside the `clientReady` callback,
which is only possible if it fires — further proof the name is fine.

## Real cause
`client.login(process.env.DISCORD_BOT_TOKEN)` on line ~245 has no rejection handler. The two
things that reject login both produce the exact "nothing starts" symptom:
1. **Disallowed intents** — code requests `GatewayIntentBits.MessageContent` (privileged). If
   the **Message Content Intent** toggle is off in the Discord Developer Portal, login rejects
   with `Used disallowed intents`.
2. **Missing/invalid `DISCORD_BOT_TOKEN`** — rejects with an invalid-token error.

Both currently surface only via the global unhandledRejection log, which is easy to miss.

## The fix (additive logging only — behavior-preserving)
Replace the bare login call and add connect-error visibility:

```js
// ─── Connect ───────────────────────────────────────────────────────────────────
client.on("error",      (err) => logger.error("[BOT] Client error:", err.message));
client.on("shardError", (err) => logger.error("[BOT] Shard error:", err.message));

// Surface a silent connect failure (bad token / disallowed intents) instead of
// looking like dead startup code.
const readyTimer = setTimeout(() => {
  logger.error(
    "[BOT] Not ready 30s after login() — check DISCORD_BOT_TOKEN and that the " +
    "Message Content Intent is enabled in the Discord Developer Portal."
  );
}, 30_000);
client.once("clientReady", () => clearTimeout(readyTimer));

client.login(process.env.DISCORD_BOT_TOKEN)
  .catch(err => logger.error("[BOT] Login failed:", err.message));
```

## Constraints
- `bot.js` is a **FROZEN path** → the Architect must set `allow_live_edit: true` for this
  scoped edit and apply the ROADMAP live-safety discipline.
- **Behavior-preserving:** the change only adds logging + a cleared timer; the happy path is
  byte-identical (login succeeds → `clientReady` fires → timer cleared → boot runs as before).
- **Do not** change the event name, reorder the ready callback, or touch trading logic.

## done_when
- On a bad/absent token or disallowed intents, the log shows a clear `[BOT] Login failed: …`
  or the 30s `Not ready` warning naming the two likely causes.
- On a valid token + enabled intent, boot is unchanged and the timer is cleared silently.
- `npm test` green.

## Operational checklist (human, outside code)
1. `node -e "console.log(process.env.DISCORD_BOT_TOKEN ? 'token set' : 'no token')"`.
2. Discord Developer Portal → Bot → enable **Message Content Intent**; re-invite if needed.
3. Re-deploy; the new log line will name the real failure if one remains.
