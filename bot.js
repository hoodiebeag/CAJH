/**
 * bot.js — Entry point and Discord event handler
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { runScanner }      from "./scanner.js";
import { loadConfig, saveConfig, isOwner } from "./storage.js";
import { startMonitor, setDailyStartBalance, postDailySummary, disableTrading } from "./monitor.js";
import {
  handleHelp, handleWatchlist, handleWatch, handleUnwatch,
  handleSetChannel, handleStatus,
  handleScan, handleAnalyzeThat, handleChartRequest,
  handleGeneral, handleManualTrade, handleBacktest, handleOptimize, handleWhy, handleAlign, handleRoom, handleModes, handleProfile, handleValidate, handleDiscover,
  handleStop, handleResume, handleSell, handlePort, handleReconcile
} from "./commands.js";

// Last-resort safety net: an error that slips past every other handler must not kill
// the process (which would also kill the stop-loss/take-profit monitor loop).
process.on("unhandledRejection", (err) => console.error("[BOT] Unhandled rejection:", err));
process.on("uncaughtException",  (err) => console.error("[BOT] Uncaught exception:", err));

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

async function runScheduledScan(label) {
  if (!state.scanChannelId) {
    console.warn(`[SCAN] ${label}: no scan channel set — run !setchannel once.`);
    return;
  }

  let channel;
  try {
    channel = await client.channels.fetch(state.scanChannelId);
  } catch (err) {
    console.error(`[SCAN] ${label}: could not fetch channel ${state.scanChannelId}:`, err.message);
    return;
  }
  if (!channel) return;

  console.log(`[SCAN] ${label} scan running`);
  await runScanner(channel, state);

  config.lastScanTime = state.lastScanTime;
  saveConfig(config);
}

// ─── Startup ───────────────────────────────────────────────────────────────────

client.once("clientReady", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  // Set daily start balance for drawdown tracking
  try {
    const { getAccountBalance } = await import("./trader.js");
    const balance = await getAccountBalance();
    setDailyStartBalance(balance);
  } catch (err) {
    console.error("[BOT] Could not fetch initial balance:", err.message);
  }

  if (state.scanChannelId) {
    startMonitor(client, state.scanChannelId);
  }

  // Test-only safety: boot with live trading OFF so you can deploy and run !backtest
  // without opening real positions. Set START_HALTED=true in Railway; !resume to go live.
  if (process.env.START_HALTED === "true") {
    disableTrading();
    console.log("[RISK] Booted HALTED (START_HALTED=true) — scans & backtests run, but NO live trades until !resume.");
  }

  // Scan every 15 minutes (right after each 15m candle closes). Quiet — only posts on a trade.
  cron.schedule(
    "*/15 * * * *",
    () => runScheduledScan("Scheduled"),
    { timezone: "America/New_York" }
  );
  console.log("[CRON] Scans scheduled every 15 minutes.");

  // Daily summary at 3:30 PM ET: trades entered + live P&L on open positions.
  cron.schedule(
    "30 15 * * *",
    async () => {
      try {
        const channel = await client.channels.fetch(state.scanChannelId);
        if (channel) await postDailySummary(channel);
      } catch (err) {
        console.error("[CRON] Daily summary failed:", err.message);
      }
    },
    { timezone: "America/New_York" }
  );
  console.log("[CRON] Daily summary scheduled for 3:30 PM ET.");
});

// ─── Message handler ───────────────────────────────────────────────────────────

// A thrown/rejected command handler must never take the whole process down with it —
// that would also kill startMonitor's stop-loss/take-profit loop until manual restart.
// Every dispatch below is wrapped so an error becomes a logged message + a Discord
// reply instead of an unhandled rejection.
function safe(promise, message) {
  return Promise.resolve(promise).catch(err => {
    console.error("[BOT] Command error:", err.message);
    return message.reply(`⚠️ Something went wrong: ${err.message}`).catch(() => {});
  });
}

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const raw   = message.content.trim();
  const lower = raw.toLowerCase();

  // Commands that place/cancel real trades or change the halt state — owner only.
  const TRADE_COMMANDS = new Set(["!stop", "!resume", "!sell", "!cancel", "!close", "!trade"]);
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
    console.error("[BOT] Message handler error:", err.message);
    await message.reply("⚠️ Something went wrong. Please try again.");
  }
});

// ─── Connect ───────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_BOT_TOKEN);