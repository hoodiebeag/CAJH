/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, scanSymbol, fetchCandles, SCAN_INTERVALS } from "./scanner.js";
import { generateChartImage } from "./chart.js";
import { SWING_WINDOW } from "./strategy.js";
import { backtestMultiTF } from "./backtest.js";
import { buildLiveContext, looksLikeCodeQuestion, readSource } from "./context.js";
import { loadChart, saveConfig, symbolToKrakenId } from "./storage.js";
import { getCurrentPrice, placeSell, getHoldings } from "./trader.js";
import {
  enableTrading, disableTrading, isTradingEnabled,
  getTrade, removeTrade, saveTradeState, postTradeClosed, getOpenTrades
} from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

// ─── !confirm ──────────────────────────────────────────────────────────────────

// ─── !sell <asset> [percent]  (also !cancel <asset>, !close <symbol>) ──────────
// Closes cajh's tracked position for that asset. Defaults to 100%; an optional
// percent sells part of it (e.g. !sell BTC 50). Only touches cajh's own position —
// never your manually-held coins.

export async function handleSell(message, symbol, percentArg) {
  if (!symbol) return message.reply("Usage: `!sell BTC` or `!sell BTC 50` (percent).");
  const upper = symbol.toUpperCase();
  const trade = getTrade(upper);

  if (!trade) {
    return message.reply(`ℹ️ cajh has no open position in **${upper}** to sell. (This only closes cajh's own trades, not coins you hold manually.)`);
  }

  let pct = 100;
  if (percentArg != null) {
    pct = parseFloat(percentArg);
    if (isNaN(pct) || pct <= 0 || pct > 100) return message.reply("Percent must be between 1 and 100.");
  }

  const volume = trade.volume * (pct / 100);

  try {
    await message.reply(`🔄 Selling ${pct}% of cajh's **${upper}** position...`);
    const price = await getCurrentPrice(upper);
    await placeSell({ symbol: upper, volume });

    if (pct >= 100) {
      await postTradeClosed(message.channel, trade, price, "manual");
      removeTrade(upper);
    } else {
      trade.volume -= volume;        // keep the remainder open with same stop/targets
      saveTradeState();
      await message.reply(`✅ Sold ${pct}% of **${upper}** at ~$${price}. Remaining: ${trade.volume} ${upper}.`);
    }
  } catch (err) {
    console.error(`[COMMAND] Sell failed for ${upper}:`, err.message);
    await message.reply(`⚠️ Failed to sell **${upper}**: ${err.message}`);
  }
}

// ─── !port  (whole-account portfolio) ──────────────────────────────────────────

export async function handlePort(message) {
  await message.reply("📊 Pulling your Kraken holdings...");
  try {
    const { holdings, totalUsd } = await getHoldings();
    if (!holdings.length) return message.channel.send("No assets found on the account.");

    const cajhTrades = getOpenTrades();
    const usd = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const lines = holdings.map(h => {
      const t = cajhTrades.find(t => t.symbol === h.asset);
      let pnl = "";
      if (t && h.price) {
        const d   = (h.price - t.entry) * t.volume;
        const dPc = ((h.price - t.entry) / t.entry) * 100;
        pnl = `  ·  cajh P&L: ${d >= 0 ? "+" : ""}${usd(d)} (${dPc >= 0 ? "+" : ""}${dPc.toFixed(1)}%)`;
      }
      return `**${h.asset}** — ${h.qty} @ ${usd(h.price)} = ${usd(h.value)}${pnl}`;
    });

    await message.channel.send(
      `**Kraken Portfolio**\n\n${lines.join("\n")}\n\n**Total value:** ${usd(totalUsd)}\n` +
      `_Market value for all holdings; entry-based P&L shown only for positions cajh opened._`
    );
  } catch (err) {
    console.error("[COMMAND] Portfolio failed:", err.message);
    await message.reply(`⚠️ Couldn't fetch holdings: ${err.message}`);
  }
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
  await message.reply("✅ **Trading resumed.** cajh will auto-place new setups.");
}

// ─── !help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(message, state) {
  const status = isTradingEnabled() ? "🟢 Active" : "🔴 Halted";
  await message.reply(
    `**cajh — Swing-Fractal Trading Bot**\n` +
    `Long-only spot. Auto-buys confirmed swing lows (N=${SWING_WINDOW}) only when 15m/1h/4h all agree, and self-manages exits by stop / take-profit.\n\n` +

    `**Positions:**\n` +
    `> \`!sell BTC\` — Close cajh's position in an asset\n` +
    `> \`!sell BTC 50\` — Sell part of it (percent)\n` +
    `> \`!port\` — Full Kraken portfolio + cajh P&L\n` +
    `> \`!stop\` — Halt new trades  ·  \`!resume\` — Re-enable\n\n` +

    `**Signals & scanning:**\n` +
    `> \`!scan\` — Scan the whole watchlist (auto-runs every 3h)\n` +
    `> \`!trade BTC\` — Check one asset across all timeframes\n` +
    `> \`!backtest BTC\` — Multi-timeframe backtest on recent history\n` +
    `> \`!watchlist\` · \`!watch BTC ETH\` · \`!unwatch TAO\`\n\n` +

    `**Settings:**\n` +
    `> \`!setchannel\` — Set scan/alert channel\n` +
    `> \`!status\` — Bot status\n\n` +

    `**Extras (AI, no trades):**\n` +
    `> \`@cajh show me BTC 15m\`  ·  \`@cajh analyze that\`\n\n` +

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

  if (!base64) return message.reply("No chart available yet. Ask for one first, e.g. `@cajh BTC 15m`.");

  await message.reply("Reading last chart...");
  await analyzeChart(base64, mediaType, message.channel);
}

// ─── cajh [chart request] ────────────────────────────────────────────────────────

const TF_ALIASES = {
  "15m": 15, "15": 15, "15min": 15,
  "1h": 60, "1hr": 60, "1hour": 60, "60m": 60,
  "4h": 240, "4hr": 240, "4hour": 240
};
const CHART_STOPWORDS = new Set(["show", "me", "a", "the", "chart", "charts", "for", "of", "please", "pull", "up", "cajh", "on", "send", "give", "get"]);

/**
 * `@cajh BTC` → posts all three (15m/1h/4h) charts. `@cajh BTC 15m` → just that one.
 * Generates the charts itself from Kraken data. Returns true if it handled a chart
 * request, false otherwise (so the caller falls through to general chat).
 */
export async function handleChartRequest(message, userMessage, state) {
  const words = userMessage.trim().split(/\s+/).filter(Boolean);

  // Timeframe (optional)
  let tfMinutes = null;
  for (const w of words) {
    const key = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (TF_ALIASES[key]) { tfMinutes = TF_ALIASES[key]; break; }
  }

  // Symbol: first 2–5 letter token that isn't a stopword or timeframe
  let symbol = null;
  for (const w of words) {
    const t = w.replace(/[^a-zA-Z]/g, "");
    const lo = t.toLowerCase();
    if (t.length >= 2 && t.length <= 5 && !CHART_STOPWORDS.has(lo) && !TF_ALIASES[lo]) {
      symbol = t.toUpperCase();
      break;
    }
  }
  if (!symbol) return false;

  // Only treat as a chart request if it's short, names a timeframe, or uses a chart word.
  const hasChartWord = /\b(chart|charts|show|pull|send|give|get)\b/i.test(userMessage);
  if (!(tfMinutes != null || words.length <= 2 || hasChartWord)) return false;

  const known = (state?.watchlist || []).find(a => a.symbol === symbol);
  const id    = known?.id || symbolToKrakenId(symbol);
  const tfs   = tfMinutes != null
    ? SCAN_INTERVALS.filter(i => i.minutes === tfMinutes)
    : SCAN_INTERVALS;

  const files = [];
  for (const tf of tfs) {
    const candles = await fetchCandles(id, tf.minutes);
    if (candles?.length) {
      files.push({ attachment: generateChartImage(candles, symbol, tf.label), name: `${symbol}_${tf.label}.png` });
    }
    await new Promise(r => setTimeout(r, 600));
  }

  if (!files.length) {
    await message.reply(`⚠️ Couldn't pull a chart for **${symbol}** — check the symbol.`);
    return true;
  }

  // Cache the first chart so "@cajh analyze that" can read it.
  if (state) {
    state.lastChartBase64    = files[0].attachment.toString("base64");
    state.lastChartMediaType = "image/png";
  }

  await message.reply({
    content: `📈 **${symbol}** — ${tfs.map(t => t.label).join(" · ")}`,
    files
  });
  return true;
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

// ─── !backtest <symbol> ────────────────────────────────────────────────────────
// Multi-timeframe backtest: entries on 15m, gated by 1h + 4h alignment (the live rule).

export async function handleBacktest(message, state, arg) {
  const symbol = (arg || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!symbol) return message.reply("Usage: `!backtest BTC`");

  const id = (state.watchlist || []).find(a => a.symbol === symbol)?.id || symbolToKrakenId(symbol);
  await message.reply(`📈 Backtesting **${symbol}** across 15m/1h/4h with alignment (N=${SWING_WINDOW})...`);

  try {
    const candles15 = await fetchCandles(id, 15);
    await new Promise(r => setTimeout(r, 1200));
    const candles1h = await fetchCandles(id, 60);
    await new Promise(r => setTimeout(r, 1200));
    const candles4h = await fetchCandles(id, 240);

    if (!candles15?.length || !candles1h?.length || !candles4h?.length) {
      return message.reply(`⚠️ Couldn't fetch enough data for **${symbol}**.`);
    }

    const r = backtestMultiTF({
      candles15: candles15.slice(0, -1),
      candles1h: candles1h.slice(0, -1),
      candles4h: candles4h.slice(0, -1)
    });

    await message.reply(
      `📊 **Backtest — ${symbol}** (15m entries, 1h+4h aligned, recent history)\n\n` +
      `**Trades:** ${r.trades}\n` +
      `**Win rate:** ${(r.winRate * 100).toFixed(0)}%\n` +
      `**Total:** ${r.totalR.toFixed(1)}R   ·   **Avg:** ${r.avgR.toFixed(2)}R/trade\n` +
      `**Max drawdown:** ${r.maxDrawdownR.toFixed(1)}R\n\n` +
      `_Simplified model: exact fills, stop assumed before target on the same candle, ` +
      `limited history. Past results don't predict the future. "R" = multiples of per-trade risk._`
    );
  } catch (err) {
    console.error(`[COMMAND] Backtest failed for ${symbol}:`, err.message);
    await message.reply(`⚠️ Backtest failed: ${err.message}`);
  }
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