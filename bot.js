/**
 * bot.js — Entry point and Discord event handler
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { runScanner }      from "./scanner.js";
import { loadConfig, saveConfig } from "./storage.js";
import { startMonitor, setDailyStartBalance } from "./monitor.js";
import {
  handleHelp, handleWatchlist, handleWatch, handleUnwatch,
  handleSetChannel, handleStatus,
  handleScan, handleAnalyzeThat, handleChartRequest,
  handleGeneral, handleManualTrade, handleBacktest,
  handleStop, handleResume, handleSell, handlePort
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
  await channel.send(`🕒 **Scheduled Scan**`);
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

  // Scheduled scans every 3 hours, anchored to NY 9:30 AM EST (≈8×/day).
  cron.schedule(
    "30 9,12,15,18,21,0,3,6 * * *",
    () => runScheduledScan("Scheduled"),
    { timezone: "America/New_York" }
  );

  console.log("[CRON] Scans scheduled every 3h from 9:30 AM EST (9:30, 12:30, 3:30, ...).");
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

  if (lower.startsWith("!backtest ")) {
    return handleBacktest(message, state, raw.slice(10).trim());
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