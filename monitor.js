/**
 * monitor.js — Position monitor, trade confirmations, and risk management
 * Tracks open trades, enforces daily drawdown limits, and posts P&L updates.
 */

import { getCurrentPrice, placeSell } from "./trader.js";

// ─── State ─────────────────────────────────────────────────────────────────────

const openTrades  = new Map();   // symbol → trade object
const pendingTrades = new Map(); // pendingId → { trade, timeout, resolve }

let tradingEnabled   = true;
let dailyStartBalance = null;
let dailyPnl          = 0;

const DAILY_DRAWDOWN_LIMIT = 0.10; // 10%
const CONFIRM_TIMEOUT_MS   = 10 * 60 * 1000; // 10 minutes

// ─── Formatting ────────────────────────────────────────────────────────────────

const usd  = (n) => `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct  = (n) => `${(n * 100).toFixed(1)}%`;

// ─── Risk management ───────────────────────────────────────────────────────────

export function isTradingEnabled()  { return tradingEnabled; }
export function enableTrading()     { tradingEnabled = true;  console.log("[RISK] Trading enabled.");  }
export function disableTrading()    { tradingEnabled = false; console.log("[RISK] Trading disabled."); }

export function setDailyStartBalance(balance) {
  if (dailyStartBalance === null) {
    dailyStartBalance = balance;
    console.log(`[RISK] Daily start balance set: ${usd(balance)}`);
  }
}

export function checkDrawdown(currentBalance) {
  if (dailyStartBalance === null) return false;
  const drawdown = (dailyStartBalance - currentBalance) / dailyStartBalance;
  if (drawdown >= DAILY_DRAWDOWN_LIMIT) {
    disableTrading();
    console.log(`[RISK] Daily drawdown limit hit: ${pct(drawdown)}`);
    return true;
  }
  return false;
}

export function resetDailyStats(balance) {
  dailyStartBalance = balance;
  dailyPnl          = 0;
  enableTrading();
  console.log(`[RISK] Daily stats reset. Start balance: ${usd(balance)}`);
}

// ─── Pending trade confirmations ───────────────────────────────────────────────

/** Post a pending trade card and wait for !confirm or !cancel (10 min timeout). */
export async function requestConfirmation(channel, trade) {
  const id    = `${trade.symbol}-${Date.now()}`;
  const sizePct = (trade.sizePct * 100).toFixed(0);

  await channel.send(
    `🔔 **Trade Setup — ${trade.symbol} LONG**\n\n` +
    `**Entry:** ${usd(trade.entry)} (market)\n` +
    `**Stop Loss:** ${usd(trade.stopLoss)}\n` +
    `**Take Profit 1:** ${usd(trade.takeProfit1)}\n` +
    `**Take Profit 2:** ${usd(trade.takeProfit2)}\n` +
    `**Position Size:** ${sizePct}% of capital\n` +
    `**Conviction:** ${trade.conviction}/10\n\n` +
    `Type \`!confirm\` to execute or \`!cancel\` to skip.\n` +
    `⏱️ Auto-cancels in 10 minutes.`
  );

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (pendingTrades.has(id)) {
        pendingTrades.delete(id);
        channel.send(`⏱️ **${trade.symbol}** trade timed out — no confirmation received.`);
        resolve(false);
      }
    }, CONFIRM_TIMEOUT_MS);

    pendingTrades.set(id, { trade, timeout, resolve, channel });
  });
}

/** Confirm the most recent pending trade. Returns true if one was found. */
export function confirmTrade() {
  const entry = [...pendingTrades.entries()].at(-1);
  if (!entry) return null;
  const [id, pending] = entry;
  clearTimeout(pending.timeout);
  pendingTrades.delete(id);
  pending.resolve(true);
  return pending.trade;
}

/** Cancel the most recent pending trade. Returns true if one was found. */
export function cancelTrade() {
  const entry = [...pendingTrades.entries()].at(-1);
  if (!entry) return false;
  const [id, pending] = entry;
  clearTimeout(pending.timeout);
  pendingTrades.delete(id);
  pending.resolve(false);
  return true;
}

export function hasPendingTrade() {
  return pendingTrades.size > 0;
}

// ─── Trade registration ────────────────────────────────────────────────────────

export function registerTrade(trade) {
  openTrades.set(trade.symbol, trade);
  console.log(`[MONITOR] Tracking ${trade.symbol} — entry: ${usd(trade.entry)}`);
}

export function getOpenTrades() {
  return Array.from(openTrades.values());
}

export function getTrade(symbol) {
  return openTrades.get(symbol.toUpperCase()) ?? null;
}

export function removeTrade(symbol) {
  openTrades.delete(symbol.toUpperCase());
}

// ─── Discord messages ──────────────────────────────────────────────────────────

export async function postTradeOpened(channel, trade) {
  const sizePct = (trade.sizePct * 100).toFixed(0);
  await channel.send(
    `✅ **Trade Opened — ${trade.symbol} LONG**\n\n` +
    `**Entry:** ${usd(trade.entry)}\n` +
    `**Stop Loss:** ${usd(trade.stopLoss)}\n` +
    `**Take Profit 1:** ${usd(trade.takeProfit1)}\n` +
    `**Take Profit 2:** ${usd(trade.takeProfit2)}\n` +
    `**Volume:** ${trade.volume} ${trade.symbol}\n` +
    `**Capital:** ${usd(trade.capital)} (${sizePct}% of balance)\n` +
    `**Conviction:** ${trade.conviction}/10`
  );
}

export async function postTradeClosed(channel, trade, exitPrice, reason) {
  const pnl    = (exitPrice - trade.entry) * trade.volume;
  const pnlPct = ((exitPrice - trade.entry) / trade.entry) * 100;
  const emoji  = pnl >= 0 ? "🟢" : "🔴";
  const label  = reason === "tp" ? "TP Hit ✅" : reason === "sl" ? "SL Hit ❌" : reason === "manual" ? "Manually Closed" : "Closed";

  dailyPnl += pnl;

  await channel.send(
    `${emoji} **Trade Closed — ${trade.symbol} (${label})**\n\n` +
    `**Entry:** ${usd(trade.entry)}\n` +
    `**Exit:** ${usd(exitPrice)}\n` +
    `**P&L:** ${pnl >= 0 ? "+" : ""}${usd(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)\n` +
    `**Daily P&L:** ${dailyPnl >= 0 ? "+" : ""}${usd(dailyPnl)}`
  );
}

// ─── Position monitor ──────────────────────────────────────────────────────────

export function startMonitor(client, channelId, intervalMs = 30000) {
  console.log("[MONITOR] Position monitor started");

  // Reset daily stats at midnight EST
  const now  = new Date();
  const msUntilMidnight = new Date(now).setHours(24, 0, 0, 0) - now;
  setTimeout(async () => {
    const { getAccountBalance } = await import("./trader.js");
    const balance = await getAccountBalance();
    resetDailyStats(balance);
    setInterval(async () => {
      const b = await getAccountBalance();
      resetDailyStats(b);
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  // Monitor open positions
  setInterval(async () => {
    if (openTrades.size === 0) return;

    try {
      const channel = client.channels.cache.get(channelId);
      if (!channel) return;

      const { getAccountBalance } = await import("./trader.js");
      const balance = await getAccountBalance();

      // Check drawdown
      if (checkDrawdown(balance)) {
        await channel.send(
          `🚨 **Daily drawdown limit reached (10%).** Trading has been automatically halted.\n` +
          `Use \`!resume\` to re-enable trading tomorrow.`
        );
      }

      // Check each open trade
      for (const [symbol, trade] of openTrades.entries()) {
        const price = await getCurrentPrice(symbol);
        if (!price) continue;

        let reason = null;

        if (price <= trade.stopLoss)    reason = "sl";
        if (price >= trade.takeProfit1) reason = "tp";

        if (reason) {
          try {
            await placeSell({ symbol, volume: trade.volume });
          } catch (err) {
            console.error(`[MONITOR] Failed to close ${symbol}:`, err.message);
          }
          await postTradeClosed(channel, trade, price, reason);
          removeTrade(symbol);
        }
      }

    } catch (err) {
      console.error("[MONITOR] Error:", err.message);
    }
  }, intervalMs);
}