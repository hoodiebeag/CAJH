/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, scanSymbol, fetchCandles, SCAN_INTERVALS } from "./scanner.js";
import { SWING_WINDOW } from "./strategy.js";
import { backtest } from "./backtest.js";
import { buildLiveContext, looksLikeCodeQuestion, readSource } from "./context.js";
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
    `**cajh — Swing-Fractal Trading Bot**\n` +
    `Long-only spot. Buys confirmed swing lows (N=${SWING_WINDOW}) only when 15m/1h/4h all agree; a protective stop rests on Kraken.\n\n` +

    `**Trading:**\n` +
    `> \`!confirm\` — Execute the pending trade\n` +
    `> \`!cancel\` — Cancel the pending trade\n` +
    `> \`!close <symbol>\` — Manually close an open position\n` +
    `> \`!stop\` — Halt all trading immediately\n` +
    `> \`!resume\` — Re-enable trading\n\n` +

    `**Signals & scanning:**\n` +
    `> \`!scan\` — Scan the whole watchlist for swing signals\n` +
    `> \`!trade\` — Same as !scan (watchlist sweep)\n` +
    `> \`!trade BTC\` — Check one asset across all timeframes\n` +
    `> \`!backtest BTC 1h\` — Test the strategy on recent history\n` +
    `> \`!watchlist\` · \`!watch BTC ETH\` · \`!unwatch TAO\`\n\n` +

    `**Settings:**\n` +
    `> \`!setchannel\` — Set scan/alert channel\n` +
    `> \`!status\` — Bot status\n\n` +

    `**Extras (AI, no trades):**\n` +
    `> \`@cajh show me BTC 15m\` — pull a chart\n` +
    `> \`@cajh analyze that\` — plain-language read of the last chart\n\n` +

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
    `**Strategy:** Swing fractals, N=${SWING_WINDOW} (long-only)`
  );
}

// ─── !scan ─────────────────────────────────────────────────────────────────────

export async function handleScan(message, state) {
  state.scanChannelId = message.channel.id;
  await runScanner(message.channel, state);
}

// ─── cajh analyze that ───────────────────────────────────────────────────────────

export async function handleAnalyzeThat(message, state) {
  const saved     = loadChart();
  const base64    = state.lastChartBase64    ?? saved?.base64;
  const mediaType = state.lastChartMediaType ?? saved?.mediaType;

  if (!base64) return message.reply("No chart available yet. Pull one with a `!fc` command first.");

  await message.reply("Reading last chart...");
  await analyzeChart(base64, mediaType, message.channel);
}

// ─── cajh [chart request] ────────────────────────────────────────────────────────

export async function handleChartRequest(message, userMessage) {
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 50,
    system:
      `You are cajh, a Discord trading bot. You trigger TradingView charts via !fc commands handled by @tree_capital.\n` +
      `If the user asks for a chart, respond with ONLY the correct !fc command.\n` +
      `If not a chart request, respond with ONLY the word NOTACHART.\n\n` +
      `!fc format: !fc <pair> [exchange] [timeframe] [indicators]\n` +
      `Pairs: btc eth sol xrp ada doge avax link ltc dot uni atom pol matic near fil apt inj tao tia sui\n` +
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

// ─── cajh [general question] ─────────────────────────────────────────────────────

export async function handleGeneral(message, userMessage, state) {
  let system =
    `You are cajh, a long-only spot crypto trading bot on Kraken in a Discord server.\n` +
    `Your trading is mechanical: you buy confirmed swing lows (Williams-style fractals,\n` +
    `window N) and exit on stop-loss / take-profit. Answer questions about yourself, your\n` +
    `live state, and your own code accurately and concisely. If you don't know, say so.\n\n` +
    buildLiveContext(state);

  if (looksLikeCodeQuestion(userMessage)) {
    system += `\n\nYour current source code follows — use it to answer accurately:\n` + readSource();
  }

  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 1024, system,
    messages: [{ role: "user", content: userMessage }]
  });

  const text = res.content[0]?.text ?? "…";
  for (let i = 0; i < text.length; i += 1900) {
    await message.reply(text.slice(i, i + 1900));
  }
}

// ─── !backtest <symbol> [timeframe] ────────────────────────────────────────────

export async function handleBacktest(message, state, arg) {
  const parts  = (arg || "").trim().split(/\s+/).filter(Boolean);
  const symbol = parts[0]?.toUpperCase();
  if (!symbol) return message.reply("Usage: `!backtest BTC` or `!backtest BTC 1h`");

  const tfArg = parts[1];
  const tfs   = tfArg ? SCAN_INTERVALS.filter(i => i.label === tfArg) : SCAN_INTERVALS;
  if (!tfs.length) return message.reply("Timeframe must be 15m, 1h, or 4h.");

  const id = (state.watchlist || []).find(a => a.symbol === symbol)?.id || symbolToKrakenId(symbol);
  await message.reply(`📈 Backtesting **${symbol}** on ${tfs.map(t => t.label).join("/")} (N=${SWING_WINDOW})...`);

  const lines = [];
  for (const tf of tfs) {
    const candles = await fetchCandles(id, tf.minutes);
    if (!candles?.length) { lines.push(`**${tf.label}** — no data`); continue; }
    const r = backtest(candles.slice(0, -1));
    lines.push(
      `**${tf.label}** — ${r.trades} trades · win ${(r.winRate * 100).toFixed(0)}% · ` +
      `total ${r.totalR.toFixed(1)}R · avg ${r.avgR.toFixed(2)}R · maxDD ${r.maxDrawdownR.toFixed(1)}R`
    );
    await new Promise(res => setTimeout(res, 1500));
  }

  await message.reply(
    `📊 **Backtest — ${symbol}** (recent history)\n` +
    lines.join("\n") +
    `\n\n_Simplified model: exact fills, stop assumed before target on the same candle, ` +
    `limited history. Past results don't predict the future. "R" = multiples of per-trade risk._`
  );
}

// ─── !trade [symbol] ───────────────────────────────────────────────────────────
// No symbol → scan the whole watchlist for fresh swing signals.
// With symbol → check that one asset across all timeframes.

export async function handleManualTrade(message, state, symbol) {
  if (!symbol) {
    if (!state.watchlist?.length) {
      return message.reply("⚠️ Watchlist is empty. Add assets with `!watch BTC ETH SOL`.");
    }
    return runScanner(message.channel, state);
  }
  return scanSymbol(symbol, message.channel, state);
}