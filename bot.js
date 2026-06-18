/**
 * bot.js — Entry point and Discord event handler
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { analyzeChart }    from "./analyzer.js";
import { runScanner }      from "./scanner.js";
import { saveChart, loadConfig, saveConfig } from "./storage.js";
import { startMonitor, setDailyStartBalance } from "./monitor.js";
import {
  handleHelp, handleWatchlist, handleWatch, handleUnwatch,
  handleSetChannel, handleSetConviction, handleStatus,
  handleScan, handleAnalyzeThat, handleChartRequest,
  handleGeneral, handleManualTrade, handleConfirm,
  handleCancel, handleStop, handleResume, handleClose
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
  convictionThreshold: config.convictionThreshold || 6,
  watchlist:           config.watchlist           || []
};

const TREE_CAPITAL_ID = "723993425325719619";

// ─── Scheduled scans ───────────────────────────────────────────────────────────

async function runScheduledScan(market) {
  if (!state.scanChannelId) return;
  const channel = client.channels.cache.get(state.scanChannelId);
  if (!channel) return;

  console.log(`[SCAN] ${market} market open`);
  await channel.send(`🌍 **${market} Market Open Scan**`);
  await runScanner(channel, state);

  config.lastScanTime = state.lastScanTime;
  saveConfig(config);
}

// ─── Startup ───────────────────────────────────────────────────────────────────

client.once("ready", async () => {
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
    console.log("[MONITOR] Position monitor started");
  }

  // Market open scans (EST timezone)
  cron.schedule("0 19 * * 0-4", () => runScheduledScan("Tokyo"),    { timezone: "America/New_York" });
  cron.schedule("0 3  * * 1-5", () => runScheduledScan("London"),   { timezone: "America/New_York" });
  cron.schedule("30 9 * * 1-5", () => runScheduledScan("New York"), { timezone: "America/New_York" });

  console.log("[CRON] Market open scans scheduled: Tokyo 7pm · London 3am · New York 9:30am EST");
});

// ─── Message handler ───────────────────────────────────────────────────────────

client.on("messageCreate", async (message) => {

  // Auto-analyze charts from @tree_capital
  if (message.author.id === TREE_CAPITAL_ID && message.attachments.size > 0) {
    const attachment = message.attachments.first();
    if (!attachment.contentType?.startsWith("image/")) return;

    await message.channel.sendTyping();

    const buffer  = await fetch(attachment.url).then(r => r.arrayBuffer());
    const base64  = Buffer.from(buffer).toString("base64");
    const mediaType = attachment.contentType;

    state.lastChartBase64    = base64;
    state.lastChartMediaType = mediaType;
    saveChart(base64, mediaType);

    await analyzeChart(base64, mediaType, message.channel, false, state.convictionThreshold);
    return;
  }

  if (message.author.bot) return;

  const raw   = message.content.trim();
  const lower = raw.toLowerCase();

  // ── Trading commands ─────────────────────────────────────────────────────────

  if (lower === "!confirm")  return handleConfirm(message);
  if (lower === "!cancel")   return handleCancel(message);
  if (lower === "!stop")     return handleStop(message);
  if (lower === "!resume")   return handleResume(message);

  if (lower.startsWith("!close ")) {
    return handleClose(message, raw.slice(7).trim().split(/\s+/)[0]);
  }

  // ── Info commands ────────────────────────────────────────────────────────────

  if (lower === "!help")       return handleHelp(message, state);
  if (lower === "!watchlist")  return handleWatchlist(message, state);
  if (lower === "!setchannel") return handleSetChannel(message, state, config);
  if (lower === "!status")     return handleStatus(message, state);
  if (lower === "!scan")       return handleScan(message, state);

  if (lower.startsWith("!trade ")) {
    return handleManualTrade(message, state, raw.slice(7).trim().split(/\s+/)[0]);
  }

  if (lower.startsWith("!watch ")) {
    return handleWatch(message, state, config, raw.slice(7).trim().split(/\s+/));
  }

  if (lower.startsWith("!unwatch ")) {
    return handleUnwatch(message, state, config, raw.slice(9).trim().split(/\s+/));
  }

  if (lower.startsWith("!setconviction ")) {
    return handleSetConviction(message, state, config, lower.split(" ")[1]);
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

    const wasChartRequest = await handleChartRequest(message, userMessage);
    if (!wasChartRequest) await handleGeneral(message, userMessage);

  } catch (err) {
    console.error("[BOT] Message handler error:", err.message);
    await message.reply("⚠️ Something went wrong. Please try again.");
  }
});

// ─── Connect ───────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_BOT_TOKEN);