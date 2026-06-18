import { getOpenPositions, getOpenOrders, getCurrentPrice } from "./trader.js";

// Track open trades in memory
const openTrades = new Map();

// Format currency
const fmt = (n) => `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Post trade opened message
export async function postTradeOpened(channel, trade) {
  const positionSizePct = Math.round((trade.capital / trade.balance) * 100);
  await channel.send(
    `✅ **Trade Opened — ${trade.symbol} ${trade.direction.toUpperCase()}**\n\n` +
    `**Contract:** ${trade.contract}\n` +
    `**Entry:** ${fmt(trade.entry)} (limit)\n` +
    `**Stop Loss:** ${fmt(trade.stopLoss)}\n` +
    `**Take Profit 1:** ${fmt(trade.takeProfit1)}\n` +
    `**Take Profit 2:** ${fmt(trade.takeProfit2)}\n` +
    `**Size:** ${trade.size} contracts (${positionSizePct}% of capital at ${trade.leverage}x)\n` +
    `**Conviction:** ${trade.conviction}/10`
  );
}

// Post trade closed message
export async function postTradeClosed(channel, trade, exitPrice, reason) {
  const pnl = trade.direction.toLowerCase() === "long"
    ? (exitPrice - trade.entry) * trade.size
    : (trade.entry - exitPrice) * trade.size;
  const pnlStr = pnl >= 0 ? `+${fmt(pnl)}` : fmt(pnl);
  const emoji = pnl >= 0 ? "🟢" : "🔴";
  const reasonStr = reason === "tp" ? "TP Hit ✅" : reason === "sl" ? "SL Hit ❌" : "Closed";

  await channel.send(
    `${emoji} **Trade Closed — ${trade.symbol} ${trade.direction.toUpperCase()} (${reasonStr})**\n\n` +
    `**Entry:** ${fmt(trade.entry)}\n` +
    `**Exit:** ${fmt(exitPrice)}\n` +
    `**P&L:** ${pnlStr}\n` +
    `**Conviction was:** ${trade.conviction}/10`
  );
}

// Start monitoring open positions
export function startMonitor(client, channelId, intervalMs = 30000) {
  console.log("Starting position monitor...");

  setInterval(async () => {
    try {
      const channel = client.channels.cache.get(channelId);
      if (!channel) return;

      const positions = await getOpenPositions();
      const positionSymbols = new Set(positions.map(p => p.symbol));

      // Check for closed trades
      for (const [symbol, trade] of openTrades.entries()) {
        if (!positionSymbols.has(trade.contract)) {
          // Position closed — figure out why
          const currentPrice = await getCurrentPrice(trade.symbol);
          let reason = "closed";
          if (currentPrice <= trade.stopLoss && trade.direction === "long") reason = "sl";
          if (currentPrice >= trade.stopLoss && trade.direction === "short") reason = "sl";
          if (currentPrice >= trade.takeProfit1 && trade.direction === "long") reason = "tp";
          if (currentPrice <= trade.takeProfit1 && trade.direction === "short") reason = "tp";

          await postTradeClosed(channel, trade, currentPrice, reason);
          openTrades.delete(symbol);
        }
      }

    } catch (error) {
      console.error("Monitor error:", error.message);
    }
  }, intervalMs);
}

// Register a new trade to monitor
export function registerTrade(trade) {
  openTrades.set(trade.symbol, trade);
  console.log(`Monitoring trade: ${trade.symbol} ${trade.direction}`);
}

// Get all monitored trades
export function getMonitoredTrades() {
  return Array.from(openTrades.values());
}