/**
 * monitor.js — Position monitor, trade confirmations, and risk management
 * Tracks open trades, enforces daily drawdown limits, and posts P&L updates.
 */

import { getCurrentPrice, placeSell, getAccountBalance, fetchOHLC, symbolToPair } from "./trader.js";
import { saveTrades, loadTrades } from "./storage.js";
import { detectSwings, SWING_WINDOW, EXIT_ON_SWING_HIGH } from "./strategy.js";

// ─── State ─────────────────────────────────────────────────────────────────────

const openTrades  = new Map();   // symbol → trade object

let tradingEnabled   = true;
let dailyStartBalance = null;
let dailyPnl          = 0;

const DAILY_DRAWDOWN_LIMIT = 0.10; // 10%

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

/** Total account equity = USD cash + mark-to-market value of open positions. */
async function currentEquity() {
  const cash = await getAccountBalance();
  let positionsValue = 0;
  for (const [symbol, trade] of openTrades.entries()) {
    try {
      const price = await getCurrentPrice(symbol);
      if (price) positionsValue += trade.volume * price;
    } catch { /* ignore individual price failures */ }
  }
  return cash + positionsValue;
}

// ─── Trade registration ────────────────────────────────────────────────────────

function persist() {
  saveTrades(Array.from(openTrades.values()));
}

/** Reload open positions from disk on startup so a restart keeps managing exits. */
export function hydrateTrades() {
  const saved = loadTrades();
  for (const t of saved) {
    if (t?.symbol) openTrades.set(t.symbol.toUpperCase(), t);
  }
  if (saved.length) console.log(`[MONITOR] Recovered ${saved.length} open position(s) from disk.`);
}

export function registerTrade(trade) {
  openTrades.set(trade.symbol.toUpperCase(), trade);
  persist();
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
  persist();
}

/** Persist after mutating a tracked trade in place (e.g. partial close). */
export function saveTradeState() {
  persist();
}

// ─── Discord messages ──────────────────────────────────────────────────────────

export async function postTradeOpened(channel, trade) {
  if (!channel) return;
  const sizePct = (trade.sizePct * 100).toFixed(0);
  await channel.send(
    `✅ **Trade Opened — ${trade.symbol} LONG**\n\n` +
    `**Entry:** ${usd(trade.entry)}\n` +
    `**Stop Loss:** ${usd(trade.stopLoss)}\n` +
    `**Take Profit 1:** ${usd(trade.takeProfit1)}\n` +
    `**Take Profit 2:** ${usd(trade.takeProfit2)}\n` +
    `**Volume:** ${trade.volume} ${trade.symbol}\n` +
    `**Capital:** ${usd(trade.capital)} (${sizePct}% of balance)\n` +
    `**Signal:** ${trade.signal ?? "—"}`
  );
}

export async function postTradeClosed(channel, trade, exitPrice, reason) {
  const pnl    = (exitPrice - trade.entry) * trade.volume;
  const pnlPct = ((exitPrice - trade.entry) / trade.entry) * 100;
  const emoji  = pnl >= 0 ? "🟢" : "🔴";
  const label  = reason === "tp"         ? "TP Hit ✅"
               : reason === "sl"         ? "SL Hit ❌"
               : reason === "sl-be"      ? "Stopped at Breakeven ➖"
               : reason === "swing-high" ? "Swing-High Take-Profit 📈"
               : reason === "manual"     ? "Manually Closed"
               : "Closed";

  dailyPnl += pnl;

  if (!channel) return;
  await channel.send(
    `${emoji} **Trade Closed — ${trade.symbol} (${label})**\n\n` +
    `**Entry:** ${usd(trade.entry)}\n` +
    `**Exit:** ${usd(exitPrice)}\n` +
    `**P&L:** ${pnl >= 0 ? "+" : ""}${usd(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)\n` +
    `**Daily P&L:** ${dailyPnl >= 0 ? "+" : ""}${usd(dailyPnl)}`
  );
}

/** Posted when TP1 is hit and we scale out part of the position. */
export async function postPartialTakeProfit(channel, trade, exitPrice, soldVolume) {
  const pnl = (exitPrice - trade.entry) * soldVolume;
  dailyPnl += pnl;

  if (!channel) return;
  await channel.send(
    `🟢 **Partial Take-Profit — ${trade.symbol} (TP1 Hit)**\n\n` +
    `**Sold:** ${soldVolume} ${trade.symbol} @ ${usd(exitPrice)}\n` +
    `**Realized P&L:** ${pnl >= 0 ? "+" : ""}${usd(pnl)}\n` +
    `**Runner left:** ${trade.volume} ${trade.symbol}, stop moved to breakeven (${usd(trade.stopLoss)})\n` +
    `**Daily P&L:** ${dailyPnl >= 0 ? "+" : ""}${usd(dailyPnl)}`
  );
}

// ─── Position monitor ──────────────────────────────────────────────────────────

export function startMonitor(client, channelId, intervalMs = 30000) {
  console.log("[MONITOR] Position monitor started");
  hydrateTrades();

  // Reset daily stats at the next local midnight, then every 24h.
  const now  = new Date();
  const msUntilMidnight = new Date(now).setHours(24, 0, 0, 0) - now;
  setTimeout(async () => {
    try { resetDailyStats(await currentEquity()); }
    catch (err) { console.error("[MONITOR] Reset failed:", err.message); }
    setInterval(async () => {
      try { resetDailyStats(await currentEquity()); }
      catch (err) { console.error("[MONITOR] Reset failed:", err.message); }
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  // Monitor open positions.
  setInterval(async () => {
    if (openTrades.size === 0) return;

    try {
      // Fetch the channel live (cache can be empty after a restart). Exits must run
      // even if the channel is briefly unavailable, so messages are best-effort only.
      let channel = null;
      try { channel = await client.channels.fetch(channelId); } catch { /* keep null */ }

      // Price every open position once, and value the book.
      const cash     = await getAccountBalance();
      const priceMap = new Map();
      let positionsValue = 0;

      for (const [symbol, trade] of openTrades.entries()) {
        const price = await getCurrentPrice(symbol);
        if (!price) continue;
        priceMap.set(symbol, price);
        positionsValue += trade.volume * price;
      }

      // Drawdown is measured on total equity (cash + positions), not cash alone.
      if (checkDrawdown(cash + positionsValue) && channel) {
        await channel.send(
          `🚨 **Daily drawdown limit reached (10%).** Trading has been automatically halted.\n` +
          `Use \`!resume\` to re-enable trading.`
        );
      }

      // Manage exits — fully self-managed by threshold. cajh polls each position's
      // price and sells itself when price crosses a target or the stop. (No resting
      // orders on the exchange.)
      for (const [symbol, trade] of [...openTrades.entries()]) {
        const price = priceMap.get(symbol);
        if (!price) continue;

        // Stop → close whatever remains (price at or below the stop).
        if (price <= trade.stopLoss) {
          try { await placeSell({ symbol, volume: trade.volume }); }
          catch (err) { console.error(`[MONITOR] SL sell failed for ${symbol}:`, err.message); }
          await postTradeClosed(channel, trade, price, trade.tp1Hit ? "sl-be" : "sl");
          removeTrade(symbol);
          continue;
        }

        // Final target → close whatever remains (price at or above TP2).
        if (price >= trade.takeProfit2) {
          try { await placeSell({ symbol, volume: trade.volume }); }
          catch (err) { console.error(`[MONITOR] TP2 sell failed for ${symbol}:`, err.message); }
          await postTradeClosed(channel, trade, price, "tp");
          removeTrade(symbol);
          continue;
        }

        // Structure-based take-profit: if a fresh swing high confirms on the entry
        // timeframe while we're in profit, lock it in. Throttled to limit API calls.
        if (EXIT_ON_SWING_HIGH && price > trade.entry) {
          const now = Date.now();
          if (now - (trade._swingCheckedAt || 0) > 90_000) {
            trade._swingCheckedAt = now;
            try {
              const candles = await fetchOHLC(symbolToPair(symbol), trade.tfMinutes || 15);
              const closed  = candles?.slice(0, -1) || [];
              const pivots  = detectSwings(closed, SWING_WINDOW);
              const last    = pivots[pivots.length - 1];
              if (last?.type === "high" && parseInt(closed[last.index].time) * 1000 > trade.openedAt) {
                await placeSell({ symbol, volume: trade.volume });
                await postTradeClosed(channel, trade, price, "swing-high");
                removeTrade(symbol);
                continue;
              }
            } catch (err) {
              console.error(`[MONITOR] swing-high check failed for ${symbol}:`, err.message);
            }
          }
        }

        // First target → scale out half once, move the stop to breakeven.
        if (!trade.tp1Hit && price >= trade.takeProfit1) {
          const half = trade.volume / 2;
          try {
            await placeSell({ symbol, volume: half });
            trade.volume  -= half;
            trade.tp1Hit   = true;
            trade.stopLoss = trade.entry;   // breakeven on the runner
            saveTradeState();
            await postPartialTakeProfit(channel, trade, price, half);
          } catch (err) {
            console.error(`[MONITOR] TP1 partial sell failed for ${symbol}:`, err.message);
          }
        }
      }

    } catch (err) {
      console.error("[MONITOR] Error:", err.message);
    }
  }, intervalMs);
}