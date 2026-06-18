/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, SCAN_INTERVALS }     from "./scanner.js";
import { loadChart, saveConfig, symbolToKrakenId } from "./storage.js";
import { getCurrentPrice, placeSell }     from "./trader.js";
import {
  confirmTrade, cancelTrade, hasPendingTrade,
  enableTrading, disableTrading, isTradingEnabled,
  getTrade, removeTrade, postTradeClosed, getOpenTrades
} from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

// ─── !confirm ──────────────────────────────────────────────────────────────────

export async function handleConfirm(message) {
  if (!hasPendingTrade()) {
    return message.reply("ℹ️ No pending trade to confirm.");
  }
  const trade = confirmTrade();
  await message.reply(`✅ Confirmed — executing **${trade?.symbol}** trade now...`);
}

// ─── !cancel ───────────────────────────────────────────────────────────────────

export async function handleCancel(message) {
  if (!hasPendingTrade()) {
    return message.reply("ℹ️ No pending trade to cancel.");
  }
  cancelTrade();
  await message.reply("❌ Trade cancelled.");
}

// ─── !stop ─────────────────────────────────────────────────────────────────────

export async function handleStop(message) {
  disableTrading();
  await message.reply(
    "🛑 **Trading halted.** No new trades will be placed.\n" +
    "Use `!resume` to re-enable trading."
  );
}

// ─── !resume ───────────────────────────────────────────────────────────────────

export async function handleResume(message) {
  enableTrading();
  await message.reply("✅ **Trading resumed.** New setups will be posted for confirmation.");
}

// ─── !close <symbol> ───────────────────────────────────────────────────────────

export async function handleClose(message, symbol) {
  const upper = symbol.toUpperCase();
  const trade = getTrade(upper);

  if (!trade) {
    return message.reply(`ℹ️ No open trade found for **${upper}**.`);
  }

  try {
    await message.reply(`🔄 Closing **${upper}** position...`);
    const price = await getCurrentPrice(upper);
    await placeSell({ symbol: upper, volume: trade.volume });
    await postTradeClosed(message.channel, trade, price, "manual");
    removeTrade(upper);
  } catch (err) {
    console.error(`[COMMAND] Close failed for ${upper}:`, err.message);
    await message.reply(`⚠️ Failed to close **${upper}**: ${err.message}`);
  }
}

// ─── !help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(message, state) {
  const status = isTradingEnabled() ? "🟢 Active" : "🔴 Halted";
  await message.reply(
    `**@c — Intraday Trading Bot**\n\n` +

    `**Trading:**\n` +
    `> \`!confirm\` — Execute the pending trade\n` +
    `> \`!cancel\` — Cancel the pending trade\n` +
    `> \`!close <symbol>\` — Manually close an open position\n` +
    `> \`!stop\` — Halt all trading immediately\n` +
    `> \`!resume\` — Re-enable trading\n\n` +

    `**Analysis:**\n` +
    `> \`!trade <symbol>\` — Manual multi-TF analysis\n` +
    `> \`@c analyze that\` — Force-analyze last chart\n\n` +

    `**Scanner:**\n` +
    `> \`!scan\` — Run full watchlist scan\n` +
    `> \`!watchlist\` — View watchlist\n` +
    `> \`!watch BTC ETH\` — Add to watchlist\n` +
    `> \`!unwatch TAO\` — Remove from watchlist\n\n` +

    `**Settings:**\n` +
    `> \`!setchannel\` — Set scan channel\n` +
    `> \`!setconviction <1-10>\` — Min conviction (now **${state.convictionThreshold}**)\n` +
    `> \`!status\` — Bot status\n\n` +

    `**Chart requests:**\n` +
    `> \`@c show me BTC 15m\`  ·  \`@c ETH 1h with RSI\`\n\n` +

    `**Status:** ${status}\n` +
    `**Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}`
  );
}

// ─── !watchlist ────────────────────────────────────────────────────────────────

export async function handleWatchlist(message, state) {
  await message.reply(`📋 **Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}`);
}

// ─── !watch ────────────────────────────────────────────────────────────────────

export async function handleWatch(message, state, config, symbols) {
  if (!symbols?.length) return message.reply("⚠️ Usage: `!watch BTC ETH SOL`");

  const added = [], already = [];

  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    if (state.watchlist.find(a => a.symbol === symbol)) {
      already.push(symbol);
    } else {
      state.watchlist.push({ id: symbolToKrakenId(symbol), symbol });
      added.push(symbol);
    }
  }

  config.watchlist = state.watchlist;
  saveConfig(config);

  const lines = [];
  if (added.length)   lines.push(`✅ Added: **${added.join(", ")}**`);
  if (already.length) lines.push(`ℹ️ Already tracked: **${already.join(", ")}**`);
  lines.push(`📋 **Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}`);

  await message.reply(lines.join("\n"));
}

// ─── !unwatch ──────────────────────────────────────────────────────────────────

export async function handleUnwatch(message, state, config, symbols) {
  if (!symbols?.length) return message.reply("⚠️ Usage: `!unwatch TAO`");

  const removed = [], notFound = [];

  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    const idx    = state.watchlist.findIndex(a => a.symbol === symbol);
    if (idx !== -1) { state.watchlist.splice(idx, 1); removed.push(symbol); }
    else              notFound.push(symbol);
  }

  config.watchlist = state.watchlist;
  saveConfig(config);

  const lines = [];
  if (removed.length)  lines.push(`✅ Removed: **${removed.join(", ")}**`);
  if (notFound.length) lines.push(`ℹ️ Not in watchlist: **${notFound.join(", ")}**`);
  lines.push(`📋 **Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ") || "empty"}`);

  await message.reply(lines.join("\n"));
}

// ─── !setchannel ───────────────────────────────────────────────────────────────

export async function handleSetChannel(message, state, config) {
  state.scanChannelId  = message.channel.id;
  config.scanChannelId = message.channel.id;
  saveConfig(config);
  await message.reply("✅ Scan and trade alerts will post in this channel.");
}

// ─── !setconviction ────────────────────────────────────────────────────────────

export async function handleSetConviction(message, state, config, value) {
  const n = parseInt(value);
  if (isNaN(n) || n < 1 || n > 10) return message.reply("⚠️ Usage: `!setconviction 7` (1–10)");
  state.convictionThreshold  = n;
  config.convictionThreshold = n;
  saveConfig(config);
  await message.reply(`✅ Conviction threshold set to **${n}/10**.`);
}

// ─── !status ───────────────────────────────────────────────────────────────────

export async function handleStatus(message, state) {
  const channel    = state.scanChannelId ? `<#${state.scanChannelId}>` : "Not set — use `!setchannel`";
  const lastScan   = state.lastScanTime ?? "No scan run yet";
  const trading    = isTradingEnabled() ? "🟢 Active" : "🔴 Halted";
  const openTrades = getOpenTrades();
  const positions  = openTrades.length > 0
    ? openTrades.map(t => `${t.symbol} (entry: $${t.entry.toFixed(4)})`).join(", ")
    : "None";

  await message.reply(
    `📡 **Bot Status**\n\n` +
    `**Trading:** ${trading}\n` +
    `**Channel:** ${channel}\n` +
    `**Last scan:** ${lastScan}\n` +
    `**Open positions:** ${positions}\n` +
    `**Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}\n` +
    `**Timeframes:** ${SCAN_INTERVALS.map(i => i.label).join(" · ")}\n` +
    `**Conviction threshold:** ${state.convictionThreshold}/10`
  );
}

// ─── !scan ─────────────────────────────────────────────────────────────────────

export async function handleScan(message, state) {
  state.scanChannelId = message.channel.id;
  await runScanner(message.channel, state);
}

// ─── @c analyze that ───────────────────────────────────────────────────────────

export async function handleAnalyzeThat(message, state) {
  const saved     = loadChart();
  const base64    = state.lastChartBase64    ?? saved?.base64;
  const mediaType = state.lastChartMediaType ?? saved?.mediaType;

  if (!base64) return message.reply("No chart available yet. Pull one with a `!fc` command first.");

  await message.reply("Analyzing last chart...");
  await analyzeChart(base64, mediaType, message.channel, true, state.convictionThreshold);
}

// ─── @c [chart request] ────────────────────────────────────────────────────────

export async function handleChartRequest(message, userMessage) {
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 50,
    system:
      `You are @c, a Discord trading bot. You trigger TradingView charts via !fc commands handled by @tree_capital.\n` +
      `If the user asks for a chart, respond with ONLY the correct !fc command.\n` +
      `If not a chart request, respond with ONLY the word NOTACHART.\n\n` +
      `!fc format: !fc <pair> [exchange] [timeframe] [indicators]\n` +
      `Pairs: btc eth sol xrp ada doge avax link ltc dot uni atom matic near fil apt inj tao tia sui\n` +
      `Timeframes: 1m 5m 15m 30m 1h 4h 1d\n` +
      `Indicators: ma ema bb rsi macd\n` +
      `Shortcuts: !fcb (BTC 1m Binance)  !fce (ETH 1m Binance)  !fcs (SOL 1m Binance)`,
    messages: [{ role: "user", content: userMessage }]
  });

  const cmd = res.content[0].text.trim();
  if (cmd !== "NOTACHART" && /^!fc[bes]?\s/.test(cmd + " ")) {
    await message.channel.send(cmd);
    return true;
  }
  return false;
}

// ─── @c [general question] ─────────────────────────────────────────────────────

export async function handleGeneral(message, userMessage) {
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 1024,
    system:
      `You are @c, an expert intraday trader and technical analyst in a Discord server.\n` +
      `You use smart money concepts (SMC), technical analysis, and market structure.\n` +
      `You trade spot crypto on Kraken (long-only). You can trigger charts via !fc and run scans via !scan.\n` +
      `Keep responses concise, direct, and trading-focused.`,
    messages: [{ role: "user", content: userMessage }]
  });

  const text = res.content[0].text;
  for (let i = 0; i < text.length; i += 1900) {
    await message.reply(text.slice(i, i + 1900));
  }
}

// ─── !trade <symbol> ───────────────────────────────────────────────────────────

export async function handleManualTrade(message, state, symbol) {
  const upper = symbol.toUpperCase();
  await message.reply(`🔍 Analyzing **${upper}** across 15m · 1h · 4h...`);

  try {
    const { fetchCandles }          = await import("./scanner.js");
    const { generateChartImage }    = await import("./chart.js");
    const { analyzeMultiTimeframe } = await import("./analyzer.js");

    const krakenId = symbolToKrakenId(upper);
    const charts   = [];
    const buffers  = [];

    for (const interval of SCAN_INTERVALS) {
      const candles = await fetchCandles(krakenId, interval.minutes);
      if (!candles?.length) continue;

      const buffer = generateChartImage(candles, upper, interval.label);
      charts.push({ label: interval.label, base64: buffer.toString("base64"), mediaType: "image/png" });
      buffers.push({ label: interval.label, buffer });

      await new Promise(r => setTimeout(r, 1500));
    }

    if (!charts.length) {
      return message.reply(`⚠️ No data for **${upper}**. Check the symbol and try again.`);
    }

    await message.channel.send({
      content: `📈 **${upper}/USD — Manual Trade Analysis**`,
      files:   buffers.map(b => ({ attachment: b.buffer, name: `${upper}_${b.label}.png` }))
    });

    await analyzeMultiTimeframe(upper, charts, message.channel, true, state.convictionThreshold);

  } catch (err) {
    console.error(`[COMMAND] !trade error for ${symbol}:`, err.message);
    await message.reply(`⚠️ Something went wrong: ${err.message}`);
  }
}