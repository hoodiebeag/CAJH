/**
 * bot.js — Entry point and Discord event handler
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { runScanner }      from "./scanner.js";
import { loadConfig, saveConfig, isOwner, checkStoragePreflight } from "./storage.js";
import { startMonitor, setDailyStartBalance, postDailySummary, disableTrading, haltManual, prepareFatalShutdown } from "./monitor.js";
import {
  handleHelp, handleWatchlist, handleWatch, handleUnwatch,
  handleSetChannel, handleStatus,
  handleScan, handleAnalyzeThat, handleChartRequest,
  handleGeneral, handleManualTrade, handleBacktest, handleOptimize, handleWhy, handleAlign, handleRoom, handleModes, handleProfile, handleValidate, handleDiscover, handleExits, handleExcursion, handleTournament,
  handleStop, handleResume, handleSell, handlePort, handleReconcile, handleEdit
} from "./commands.js";
import * as logger from './logger.js';

export function sanitizeErrorMessage(err) {
  let text = err?.stack || err?.message || String(err ?? "unknown error");
  for (const secret of [
    process.env.DISCORD_BOT_TOKEN,
    process.env.KRAKEN_API_KEY,
    process.env.KRAKEN_API_SECRET
  ]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  text = text.replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-discord-token]");
  text = text.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted-secret]");
  return text;
}

export function handleFatalProcessError(kind, err, exit = process.exit) {
  const reason = `${kind}: ${err?.message ?? err ?? "unknown fatal error"}`;
  const report = prepareFatalShutdown(reason);
  logger.error(`[BOT] ${kind}; entries halted and state persistence attempted. ` +
    `Software-polled exits cannot be guaranteed until restart/reconcile.`, sanitizeErrorMessage(err));
  exit(1);
  return report;
}

process.on("unhandledRejection", (err) => handleFatalProcessError("unhandledRejection", err));
process.on("uncaughtException",  (err) => handleFatalProcessError("uncaughtException", err));

export function attachDiscordLifecycleGuards(discordClient, {
  readyTimeoutMs = 60_000,
  onFatal = handleFatalProcessError,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let ready = false;
  const readyTimer = setTimer(() => {
    if (!ready) onFatal("discordReadyTimeout", new Error(`Discord did not become ready within ${readyTimeoutMs}ms`));
  }, readyTimeoutMs);

  discordClient.once("clientReady", () => {
    ready = true;
    clearTimer(readyTimer);
  });
  discordClient.on("error", (err) => logger.error("[BOT] Discord client error:", sanitizeErrorMessage(err)));
  discordClient.on("shardError", (err) => logger.error("[BOT] Discord shard error:", sanitizeErrorMessage(err)));
  return { readyTimer };
}

export function loginDiscord(discordClient, token = process.env.DISCORD_BOT_TOKEN, onFatal = handleFatalProcessError) {
  return discordClient.login(token).catch((err) => onFatal("discordLoginRejected", err));
}

// ─── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ─── Shared state ──────────────────────────────────────────────────────────────

const config = loadConfig();

const state = {
  lastChartBase64:     null,
  lastChartMediaType:  null,
  lastScanTime:        config.lastScanTime        || null,
  scanChannelId:       config.scanChannelId       || null,
  watchlist:           config.watchlist           || []
};

// ─── Scheduled scans ───────────────────────────────────────────────────────────

const scheduledScanHealth = { ok: true, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null };

export function getScheduledScanHealth(health = scheduledScanHealth) {
  return { ...health };
}

export async function runScheduledScan(label, {
  runtimeState = state,
  runtimeConfig = config,
  discordClient = client,
  scanner = runScanner,
  persist = saveConfig,
  health = scheduledScanHealth
} = {}) {
  const previousLastScanTime = runtimeState.lastScanTime;
  health.lastRunAt = Date.now();
  if (!health.ok) {
    logger.warn(`[SCAN] ${label} skipped; scheduled scan health is unhealthy:`, health.lastError);
    return false;
  }
  try {
    if (!runtimeState.scanChannelId) throw new Error("no scan channel set");
    const channel = await discordClient.channels.fetch(runtimeState.scanChannelId);
    if (!channel) throw new Error(`scan channel ${runtimeState.scanChannelId} was not found`);
    logger.info(`[SCAN] ${label} scan running`);
    await scanner(channel, runtimeState);
    runtimeConfig.lastScanTime = runtimeState.lastScanTime;
    if (persist(runtimeConfig) !== true) throw new Error("scheduled scan config persistence failed");
    health.ok = true;
    health.lastSuccessAt = health.lastRunAt;
    health.lastError = null;
    return true;
  } catch (err) {
    runtimeState.lastScanTime = previousLastScanTime;
    runtimeConfig.lastScanTime = previousLastScanTime;
    health.ok = false;
    health.lastFailureAt = health.lastRunAt;
    health.lastError = sanitizeErrorMessage(err);
    logger.error(`[SCAN] ${label} failed; lastScanTime unchanged:`, health.lastError);
    return false;
  }
}

// ─── Startup ───────────────────────────────────────────────────────────────────

client.once("clientReady", async () => {
  logger.info(`[BOT] Logged in as ${client.user.tag}`);

  // Set daily start balance for drawdown tracking
  try {
    const { getAccountBalance } = await import("./trader.js");
    const balance = await getAccountBalance();
    setDailyStartBalance(balance);
  } catch (err) {
    logger.error("[BOT] Could not fetch initial balance:", err.message);
  }

  // Positions must be monitored from boot even before a scan channel is set — channel
  // messages are best-effort, stop/TP enforcement is not. (Recovered positions would
  // otherwise sit unmanaged until !setchannel + restart.) The getter means a later
  // !setchannel redirects alerts without a restart.
  startMonitor(client, () => state.scanChannelId);

  // Boot HALTED unless live trading is explicitly switched on with LIVE_TRADING=true.
  //
  // This default is deliberate. Measured on 12 pairs over ~15 months (4,426 training
  // trades) the current strategy is net-negative in EVERY exit configuration, and
  // negative even with fees set to zero — so an accidental deploy or restart trading
  // real money is a known-loss event, not an unknown. Opting in is one env var; opting
  // out of a loss after the fact is not. `!resume` still enables trading for a session.
  const liveOptIn = process.env.LIVE_TRADING === "true";
  const storagePreflight = checkStoragePreflight();
  if (!liveOptIn || process.env.START_HALTED === "true" || !storagePreflight.ok) {
    haltManual(!storagePreflight.ok && liveOptIn ? storagePreflight.reason : "manual");
    logger.warn(
      liveOptIn
        ? `[RISK] Booted HALTED (${process.env.START_HALTED === "true" ? "START_HALTED=true" : storagePreflight.reason}) — scans & research run, but NO live trades until storage preflight and !resume pass.`
        : "[RISK] Booted HALTED (default) — set LIVE_TRADING=true to allow autonomous trading, or use !resume for this session. " +
          "Backtests currently show this strategy losing money; see ROADMAP.md."
    );
  } else {
    logger.warn("[RISK] LIVE TRADING ENABLED (LIVE_TRADING=true) — cajh will place real orders autonomously.");
  }

  // Scan every 15 minutes (right after each 15m candle closes). Quiet — only posts on a trade.
  cron.schedule(
    "*/15 * * * *",
    () => runScheduledScan("Scheduled"),
    { timezone: "America/New_York" }
  );
  logger.info("[CRON] Scans scheduled every 15 minutes.");

  // Daily summary at 3:30 PM ET: trades entered + live P&L on open positions.
  cron.schedule(
    "30 15 * * *",
    async () => {
      try {
        const channel = await client.channels.fetch(state.scanChannelId);
        if (channel) await postDailySummary(channel);
      } catch (err) {
        logger.error("[CRON] Daily summary failed:", err.message);
      }
    },
    { timezone: "America/New_York" }
  );
  logger.info("[CRON] Daily summary scheduled for 3:30 PM ET.");
});

// ─── Message handler ───────────────────────────────────────────────────────────

// A thrown/rejected command handler must never take the whole process down with it —
// that would also kill startMonitor's stop-loss/take-profit loop until manual restart.
// Every dispatch below is wrapped so an error becomes a logged message + a Discord
// reply instead of an unhandled rejection.
function safe(promise, message) {
  return Promise.resolve(promise).catch(err => {
    logger.error("[BOT] Command error:", err.message);
    return message.reply(`⚠️ Something went wrong: ${err.message}`).catch(() => {});
  });
}

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const raw   = message.content.trim();
  const lower = raw.toLowerCase();

  // Commands that place/cancel real trades or change the halt state — owner only.
  // (!scan belongs here: a scan auto-executes any setup it finds.)
  const TRADE_COMMANDS = new Set(["!stop", "!resume", "!sell", "!cancel", "!close", "!trade", "!scan", "!edit"]);
  if (TRADE_COMMANDS.has(lower.split(/\s+/)[0]) && !isOwner(message.author.id)) {
    return message.reply("🚫 This command is restricted to cajh's owner.");
  }

  // ── Position commands ────────────────────────────────────────────────────────

  if (lower === "!stop")     return safe(handleStop(message), message);
  if (lower === "!resume")   return safe(handleResume(message), message);
  if (lower === "!port" || lower === "!portfolio") return safe(handlePort(message), message);
  if (lower === "!reconcile") return safe(handleReconcile(message), message);

  // !sell BTC  /  !sell BTC 50   (and aliases !cancel / !close)
  if (lower.startsWith("!sell ") || lower.startsWith("!cancel ") || lower.startsWith("!close ")) {
    const args = raw.split(/\s+/).slice(1);
    return safe(handleSell(message, args[0], args[1]), message);
  }

  // ── Info commands ────────────────────────────────────────────────────────────

  if (lower === "!help")       return safe(handleHelp(message, state), message);
  if (lower === "!watchlist")  return safe(handleWatchlist(message, state), message);
  if (lower === "!setchannel") return safe(handleSetChannel(message, state, config), message);
  if (lower === "!status")     return safe(handleStatus(message, state), message);
  if (lower === "!scan")       return safe(handleScan(message, state), message);
  if (lower === "!optimize")   return safe(handleOptimize(message, state), message);
  if (lower === "!align")      return safe(handleAlign(message, state), message);
  if (lower === "!room")       return safe(handleRoom(message, state), message);
  if (lower === "!modes")      return safe(handleModes(message, state), message);
  if (lower === "!profile")    return safe(handleProfile(message, state), message);
  if (lower === "!validate")   return safe(handleValidate(message, state), message);
  if (lower === "!discover")   return safe(handleDiscover(message, state), message);
  if (lower === "!exits")      return safe(handleExits(message, state), message);
  if (lower === "!excursion")  return safe(handleExcursion(message, state), message);
  if (lower === "!tournament") return safe(handleTournament(message, state), message);
  if (lower === "!edit" || lower.startsWith("!edit ")) {
    return safe(handleEdit(message, raw.slice(5)), message);
  }

  if (lower === "!why" || lower.startsWith("!why ")) {
    return safe(handleWhy(message, state, raw.slice(4).trim() || null), message);
  }

  if (lower === "!backtest" || lower.startsWith("!backtest ")) {
    return safe(handleBacktest(message, state, raw.slice(9).trim()), message);
  }

  if (lower === "!trade") {
    return safe(handleManualTrade(message, state, null), message);
  }

  if (lower.startsWith("!trade ")) {
    return safe(handleManualTrade(message, state, raw.slice(7).trim().split(/\s+/)[0]), message);
  }

  if (lower.startsWith("!watch ")) {
    return safe(handleWatch(message, state, config, raw.slice(7).trim().split(/\s+/)), message);
  }

  if (lower.startsWith("!unwatch ")) {
    return safe(handleUnwatch(message, state, config, raw.slice(9).trim().split(/\s+/)), message);
  }

  // ── @mention commands ────────────────────────────────────────────────────────

  if (!message.mentions.has(client.user)) return;

  const userMessage = message.content.replace(/<@!?\d+>/g, "").trim();
  const userLower   = userMessage.toLowerCase();

  await message.channel.sendTyping();

  try {
    if (
      userLower.includes("analyze that") ||
      userLower.includes("analyze the last") ||
      userLower.includes("what do you think")
    ) {
      return handleAnalyzeThat(message, state);
    }

    const wasChartRequest = await handleChartRequest(message, userMessage, state);
    if (!wasChartRequest) await handleGeneral(message, userMessage, state);

  } catch (err) {
    logger.error("[BOT] Message handler error:", err.message);
    await message.reply("⚠️ Something went wrong. Please try again.");
  }
});

// ─── Connect ───────────────────────────────────────────────────────────────────

if (process.env.CAJH_BOT_NO_LOGIN !== "true") {
  attachDiscordLifecycleGuards(client);
  loginDiscord(client);
}
