/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, scanSymbol, fetchCandles, SCAN_INTERVALS } from "./scanner.js";
import { generateChartImage } from "./chart.js";
import { SWING_WINDOW } from "./strategy.js";
import * as logger from './logger.js';
import { buildLiveContext, RESEARCH_MISSION, looksLikeCodeQuestion, readSource } from "./context.js";
import { loadChart, saveConfig, symbolToKrakenId, isOwner } from "./storage.js";
import { getCurrentPrice, placeSell, getHoldings } from "./trader.js";
import {
  haltManual, resumeManual, isTradingEnabled,
  getTrade, removeTrade, saveTradeState, postTradeClosed, getOpenTrades, reconcileHoldings,
  applyConfirmedSellToTrade
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
    const quote = await getCurrentPrice(upper);
    const sold  = await placeSell({ symbol: upper, volume, price: quote });

    const result = applyConfirmedSellToTrade(trade, sold);
    if (result.status === "invalid") throw new Error("confirmed sell volume is invalid");
    if (result.status === "closed") {
      await postTradeClosed(message.channel, trade, sold.price, "manual");
      removeTrade(upper);
    } else {
      const persisted = saveTradeState();
      await message.reply(`✅ Sold ${pct}% of **${upper}** at ~$${sold.price}. Remaining: ${trade.volume} ${upper}.` +
        (persisted ? "" : " Persistence failed; run !reconcile."));
    }
  } catch (err) {
    logger.error(`[COMMAND] Sell failed for ${upper}:`, err.message);
    await message.reply(`⚠️ Failed to sell **${upper}**: ${err.message}`);
  }
}

// ─── !reconcile  (Kraken holdings vs cajh's tracked trades) ─────────────────────
export async function handleReconcile(message) {
  await message.reply("🔎 Reconciling Kraken holdings against cajh's tracked trades...");
  const res = await reconcileHoldings(message.channel, { announceClean: true });
  if (res == null) await message.reply("⚠️ Couldn't reach Kraken to reconcile — try again shortly.");
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
    logger.error("[COMMAND] Portfolio failed:", err.message);
    await message.reply(`⚠️ Couldn't fetch holdings: ${err.message}`);
  }
}

// ─── !stop ─────────────────────────────────────────────────────────────────────

export async function handleStop(message) {
  haltManual();
  await message.reply(
    "🛑 **Trading halted.** No new trades will be placed.\n" +
    "Use `!resume` to re-enable trading."
  );
}

// ─── !resume ───────────────────────────────────────────────────────────────────

export async function handleResume(message) {
  resumeManual();
  await message.reply("✅ **Trading resumed.** cajh will auto-place new setups.");
}

// ─── !help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(message, state) {
  const status = isTradingEnabled() ? "🟢 Active" : "🔴 Halted";
  await message.reply(
    `**cajh — Swing-Fractal Trading Bot**\n` +
    `Long-only spot. Anticipates swing-low confirmations on the 1h/4h/1d — buying the moment price crosses a candidate low's trigger — sizes by risk (0.5% per trade), uses no live alignment/trend gate, rotates the most profitable position out at the cap, and self-manages exits by stop / take-profit.\n\n` +

    `**Positions:**\n` +
    `> \`!sell BTC\` — Close cajh's position in an asset\n` +
    `> \`!sell BTC 50\` — Sell part of it (percent)\n` +
    `> \`!port\` — Full Kraken portfolio + cajh P&L\n` +
    `> \`!stop\` — Halt new trades  ·  \`!resume\` — Re-enable\n\n` +

    `**Signals & scanning:**\n` +
    `> \`!scan\` — Scan the whole watchlist (auto-runs every 15 min)\n` +
    `> \`!trade BTC\` — Check one asset across all timeframes\n` +
    `> \`!watchlist\` · \`!watch BTC ETH\` · \`!unwatch TAO\`\n\n` +

    `**Settings:**\n` +
    `> \`!setchannel\` — Set scan/alert channel\n` +
    `> \`!status\` — Bot status\n\n` +

    `**Research (owner-only, no trades):**\n` +

    `**Extras (AI, no trades):**\n` +
    `> \`@cajh $BTC\` — Pull charts (requires $ prefix)\n` +
    `> \`@cajh *hello\` — Force general chat (skip chart logic with * escape)\n` +
    `> \`@cajh\` general chat remembers the last ${MAX_CHAT_TURNS / 2} exchanges in this channel — \`!forget\` to reset it\n\n` +

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
    `**Strategy:** 1h/4h/1d anticipation swing fractals, N=${SWING_WINDOW}, risk-sized, no live alignment/trend gate`
  );
}

// ─── !scan ─────────────────────────────────────────────────────────────────────

export async function handleScan(message, state) {
  state.scanChannelId = message.channel.id;
  await runScanner(message.channel, state, true);
}

// ─── cajh analyze that ───────────────────────────────────────────────────────────

export async function handleAnalyzeThat(message, state) {
  const saved     = loadChart();
  const base64    = state.lastChartBase64    ?? saved?.base64;
  const mediaType = state.lastChartMediaType ?? saved?.mediaType;

  if (!base64) return message.reply("No chart available yet. Ask for one first, e.g. `@cajh BTC 4h`.");

  await message.reply("Reading last chart...");
  await analyzeChart(base64, mediaType, message.channel);
}

// ─── cajh [chart request] ────────────────────────────────────────────────────────

const TF_ALIASES = {
  "1h": 60, "1hr": 60, "1hour": 60, "60m": 60,
  "4h": 240, "4hr": 240, "4hour": 240,
  "1d": 1440, "1day": 1440, "daily": 1440, "24h": 1440
};
/**
 * `@cajh $BTC` → posts all three (1h/4h/1d) charts. `@cajh $BTC 4h` → just that one.
 * Generates the charts itself from Kraken data. Returns true if it handled a chart
 * request, false otherwise (so the caller falls through to general chat).
 * Requires an explicit $ prefix (e.g. $BTC) — no keyword-based fallback, because
 * common conversational words ("send", "get", "give", "show") were matching
 * ordinary chat and then grabbing an unrelated short word as the "symbol".
 */
export async function handleChartRequest(message, userMessage, state) {
  const words = userMessage.trim().split(/\s+/).filter(Boolean);

  // Timeframe (optional)
  let tfMinutes = null;
  for (const w of words) {
    const key = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (TF_ALIASES[key]) { tfMinutes = TF_ALIASES[key]; break; }
  }

  // Symbol: must start with $ to be recognized as a chart request at all.
  let symbol = null;
  for (const w of words) {
    if (w.startsWith("$")) {
      const t = w.slice(1).replace(/[^a-zA-Z]/g, "");
      if (t.length >= 2 && t.length <= 5) {
        symbol = t.toUpperCase();
        break;
      }
    }
  }
  if (!symbol) return false;

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

// ─── Conversation memory (per Discord channel) ───────────────────────────────────
// @cajh chat is otherwise single-shot: one user message in, one reply out, nothing
// carried forward. This keeps a rolling window of prior turns per channel and replays
// them on every call so it's a real back-and-forth, not a fresh Q&A each time. Capped
// so a long-lived channel can't grow the per-call token cost without bound; "!forget"
// clears it explicitly rather than relying on the cap alone.
const MAX_CHAT_TURNS = 20; // 10 user/assistant exchanges

export function chatHistoryFor(state, channelId) {
  state.chatHistory ??= new Map();
  return state.chatHistory.get(channelId) || [];
}

export function appendChatTurn(state, channelId, userMessage, assistantText) {
  state.chatHistory ??= new Map();
  const history = state.chatHistory.get(channelId) || [];
  history.push({ role: "user", content: userMessage }, { role: "assistant", content: assistantText });
  state.chatHistory.set(channelId, history.slice(-MAX_CHAT_TURNS));
}

export function clearChatHistory(state, channelId) {
  state.chatHistory ??= new Map();
  state.chatHistory.delete(channelId);
}

export async function handleForget(message, state) {
  clearChatHistory(state, message.channel.id);
  await message.reply("🧹 Cleared this channel's conversation memory — next message starts fresh.");
}

// ─── cajh [general question] ─────────────────────────────────────────────────────

export async function handleGeneral(message, userMessage, state) {
  const channelId = message.channel.id;
  const history = chatHistoryFor(state, channelId);

  let system =
    `You are cajh, a research-first crypto market intelligence system connected to a long-only Kraken spot executor.\n` +
    `Your trading is mechanical: you anticipate swing-low confirmations on the 1h, 4h,\n` +
    `and 1d — buying when price crosses above a candidate low's trigger — size by risk\n` +
    `(0.5% of cash per trade), use no live alignment/trend gate, and exit on software-polled stop-loss / take-profit. Answer questions about yourself,\n` +
    `your live state, durable trade/decision history, and your own code accurately and concisely. Use the persisted decision history below when asked what went right or wrong; do not invent missing evidence. If you don't know, say so.\n\n` +
    `${RESEARCH_MISSION}\n\n` +
    buildLiveContext(state);


  if (looksLikeCodeQuestion(userMessage) && isOwner(message.author.id)) {
    system += `\n\nYour current source code follows — use it to answer accurately:\n` + readSource();
  }

  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 2048, system,
    messages: [...history, { role: "user", content: userMessage }]
  });

  let text = res.content[0]?.text ?? "…";
  // A detailed research protocol can exceed one response. Continue explicitly
  // rather than silently posting a sentence truncated at the provider token cap.
  if (res.stop_reason === "max_tokens") {
    const continuation = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024, system,
      messages: [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: text },
        { role: "user", content: "Continue exactly where you stopped. Finish the incomplete thought concisely; do not repeat earlier material." }
      ]
    });
    text += continuation.content[0]?.text
      ? `\n\n${continuation.content[0].text}`
      : "\n\n[Response reached its length limit before it could be completed.]";
  }
  appendChatTurn(state, channelId, userMessage, text);
  for (let i = 0; i < text.length; i += 1900) {
    await message.reply(text.slice(i, i + 1900));
  }
}









// No symbol → scan the whole watchlist for fresh swing signals.
// With symbol → check that one asset across all timeframes.
export async function handleManualTrade(message, state, symbol) {
  if (!symbol) {
    if (!state.watchlist?.length) {
      return message.reply("⚠️ Watchlist is empty. Add assets with `!watch BTC ETH SOL`.");
    }
    return runScanner(message.channel, state, true);
  }
  return scanSymbol(symbol, message.channel, state);
}
