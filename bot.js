/**
 * bot.js — Entry point and Discord event handler
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { runScanner }      from "./scanner.js";
import { loadConfig, saveConfig } from "./storage.js";
import { startMonitor, setDailyStartBalance, postDailySummary, disableTrading } from "./monitor.js";
import {
  handleHelp, handleWatchlist, handleWatch, handleUnwatch,
  handleSetChannel, handleStatus,
  handleScan, handleAnalyzeThat, handleChartRequest,
  handleGeneral, handleManualTrade, handleBacktest, handleOptimize, handleWhy, handleAlign, handleRoom, handleModes, handleProfile, handleValidate, handleDiscover,
  handleStop, handleResume, handleSell, handlePort, handleReconcile
} from "./commands.js";

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

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const raw   = message.content.trim();
  const lower = raw.toLowerCase();

  // ── Position commands ────────────────────────────────────────────────────────

  if (lower === "!stop")     return handleStop(message);
  if (lower === "!resume")   return handleResume(message);
  if (lower === "!port" || lower === "!portfolio") return handlePort(message);
  if (lower === "!reconcile") return handleReconcile(message);

  // !sell BTC  /  !sell BTC 50   (and aliases !cancel / !close)
  if (lower.startsWith("!sell ") || lower.startsWith("!cancel ") || lower.startsWith("!close ")) {
    const args = raw.split(/\s+/).slice(1);
    return handleSell(message, args[0], args[1]);
  }

  // ── Info commands ────────────────────────────────────────────────────────────

  if (lower === "!help")       return handleHelp(message, state);
  if (lower === "!watchlist")  return handleWatchlist(message, state);
  if (lower === "!setchannel") return handleSetChannel(message, state, config);
  if (lower === "!status")     return handleStatus(message, state);
  if (lower === "!scan")       return handleScan(message, state);
  if (lower === "!optimize")   return handleOptimize(message, state);
  if (lower === "!align")      return handleAlign(message, state);
  if (lower === "!room")       return handleRoom(message, state);
  if (lower === "!modes")      return handleModes(message, state);
  if (lower === "!profile")    return handleProfile(message, state);
  if (lower === "!validate")   return handleValidate(message, state);
  if (lower === "!discover")   return handleDiscover(message, state);

  if (lower === "!why" || lower.startsWith("!why ")) {
    return handleWhy(message, state, raw.slice(4).trim() || null);
  }

  if (lower === "!backtest" || lower.startsWith("!backtest ")) {
    return handleBacktest(message, state, raw.slice(9).trim());
  }

  if (lower === "!trade") {
    return handleManualTrade(message, state, null);
  }

  if (lower.startsWith("!trade ")) {
    return handleManualTrade(message, state, raw.slice(7).trim().split(/\s+/)[0]);
  }

  if (lower.startsWith("!watch ")) {
    return handleWatch(message, state, config, raw.slice(7).trim().split(/\s+/));
  }

  if (lower.startsWith("!unwatch ")) {
    return handleUnwatch(message, state, config, raw.slice(9).trim().split(/\s+/));
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