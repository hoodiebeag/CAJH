import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import cron from "node-cron";
import { analyzeChart } from "./analyzer.js";
import { runScanner } from "./scanner.js";
import { saveChart, loadConfig, saveConfig } from "./storage.js";
import { startMonitor } from "./monitor.js";
import {
  handleHelp,
  handleWatchlist,
  handleWatch,
  handleUnwatch,
  handleSetChannel,
  handleSetConviction,
  handleStatus,
  handleScan,
  handleAnalyzeThat,
  handleChartRequest,
  handleGeneral,
  handleManualTrade
} from "./commands.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TREE_CAPITAL_ID = "723993425325719619";

// Shared state
const config = loadConfig();
const state = {
  lastChartBase64: null,
  lastChartMediaType: null,
  lastScanTime: config.lastScanTime || null,
  scanChannelId: config.scanChannelId || null,
  convictionThreshold: config.convictionThreshold || 6,
  watchlist: config.watchlist || []
};

// Run a scheduled scan for a specific market
async function runScheduledScan(market) {
  console.log(`Running ${market} market open scan...`);
  if (state.scanChannelId) {
    const channel = client.channels.cache.get(state.scanChannelId);
    if (channel) {
      await channel.send(`🌍 **${market} Market Open Scan**`);
      await runScanner(channel, state);
      config.lastScanTime = state.lastScanTime;
      saveConfig(config);
    }
  } else {
    console.log("No scan channel set. Use !setchannel to configure.");
  }
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Start position monitor (checks every 30 seconds)
  if (state.scanChannelId) {
    startMonitor(client, state.scanChannelId, 30000);
    console.log("Position monitor started.");
  }

  // New York open 9:30 AM EST
  cron.schedule("30 9 * * 1-5", () => runScheduledScan("New York"), { timezone: "America/New_York" });
  // London open 3:00 AM EST
  cron.schedule("0 3 * * 1-5", () => runScheduledScan("London"), { timezone: "America/New_York" });
  // Tokyo open 7:00 PM EST
  cron.schedule("0 19 * * 0-4", () => runScheduledScan("Tokyo"), { timezone: "America/New_York" });
});

client.on("messageCreate", async (message) => {

  // Auto-analyze charts from Tree Capital
  if (message.author.id === TREE_CAPITAL_ID && message.attachments.size > 0) {
    const attachment = message.attachments.first();
    if (!attachment.contentType?.startsWith("image/")) return;

    console.log("Chart detected from Tree Capital, checking conviction...");
    await message.channel.sendTyping();

    const imageResponse = await fetch(attachment.url);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mediaType = attachment.contentType;

    state.lastChartBase64 = base64;
    state.lastChartMediaType = mediaType;
    saveChart(base64, mediaType);

    await analyzeChart(base64, mediaType, message.channel, false, state.convictionThreshold);
    return;
  }

  // Ignore other bots
  if (message.author.bot) return;

  const content = message.content.trim();
  const contentLower = content.toLowerCase();

  // Commands
  if (contentLower === "!help") return handleHelp(message, state);
  if (contentLower === "!watchlist") return handleWatchlist(message, state);
  if (contentLower === "!setchannel") return handleSetChannel(message, state, config);
  if (contentLower === "!status") return handleStatus(message, state);
  if (contentLower === "!scan") return handleScan(message, state);

  if (contentLower.startsWith("!trade ")) {
    const symbol = content.slice(7).trim().split(/\s+/)[0];
    return handleManualTrade(message, state, symbol);
  }

  if (contentLower.startsWith("!testrade ")) {
    const symbol = content.slice(10).trim().split(/\s+/)[0].toUpperCase();
    try {
      const { validateTrade, placeTrade, getAccountBalance } = await import("./trader.js");
      const { postTradeOpened, registerTrade } = await import("./monitor.js");

      // First validate without placing
      await message.reply(`🔍 Validating margin order for **${symbol}**...`);
      const validation = await validateTrade({ symbol, direction: "long", entry: null, conviction: 6 });
      console.log("Validation result:", JSON.stringify(validation));

      if (validation.error && validation.error.length > 0) {
        await message.reply(`⚠️ Validation failed: ${validation.error.join(", ")}`);
        return;
      }

      await message.reply(`✅ Validation passed! Placing real order...`);
      const balance = await getAccountBalance();
      const trade = await placeTrade({
        symbol,
        direction: "long",
        entry: null,
        stopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0,
        conviction: 6
      });
      trade.balance = balance;
      registerTrade(trade);
      await postTradeOpened(message.channel, trade);
    } catch (error) {
      console.error("Test trade error:", error.message);
      await message.reply(`⚠️ Test trade failed: ${error.message}`);
    }
    return;
  }

  if (contentLower.startsWith("!watch ")) {
    const symbols = content.slice(7).trim().split(/\s+/);
    return handleWatch(message, state, config, symbols);
  }

  if (contentLower.startsWith("!unwatch ")) {
    const symbols = content.slice(9).trim().split(/\s+/);
    return handleUnwatch(message, state, config, symbols);
  }

  if (contentLower.startsWith("!setconviction")) {
    const value = contentLower.split(" ")[1];
    return handleSetConviction(message, state, config, value);
  }

  // @mention handling
  if (!message.mentions.has(client.user)) return;

  const userMessage = message.content.replace(/<@!?\d+>/g, "").trim();
  const userMessageLower = userMessage.toLowerCase();

  await message.channel.sendTyping();

  try {
    if (userMessageLower.includes("analyze that") || userMessageLower.includes("analyze the last") || userMessageLower.includes("what do you think")) {
      return handleAnalyzeThat(message, state);
    }

    const wasChartRequest = await handleChartRequest(message, userMessage);
    if (!wasChartRequest) {
      await handleGeneral(message, userMessage);
    }

  } catch (error) {
    console.error("Error handling message:", error.message);
    await message.reply("Something went wrong!");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);