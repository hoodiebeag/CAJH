/**
 * monitor.js — Position monitor, trade confirmations, and risk management
 * Tracks open trades, enforces daily drawdown limits, and posts P&L updates.
 */

import { getCurrentPrice, placeSell, getAccountBalance, fetchOHLC, symbolToPair, getHoldings } from "./trader.js";
import { saveTrades, loadTrades, saveStats, loadStats } from "./storage.js";
import { detectSwings, SWING_WINDOW, EXIT_ON_SWING_HIGH, LOCK_BREAKEVEN, BE_TRIGGER_R, BE_LOCK_R, FEE_BUFFER_PCT, FEE_RATE } from "./strategy.js";
import * as logger from './logger.js';

// ─── State ─────────────────────────────────────────────────────────────────────

const openTrades  = new Map();   // symbol → trade object

let tradingEnabled   = true;
let dailyStartBalance = null;
let dailyPnl          = 0;
let tradesToday       = 0;
let drawdownHalted    = false; // true once today's drawdown limit trips; suppresses repeat halt alerts (cleared on daily rollover)
let manualHalt        = false; // set by !stop / START_HALTED; survives the daily reset — only !resume clears it

const DAILY_DRAWDOWN_LIMIT = 0.10; // 10%

// ─── Formatting ────────────────────────────────────────────────────────────────

const usd  = (n) => `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct  = (n) => `${(n * 100).toFixed(1)}%`;

// ─── Risk management ───────────────────────────────────────────────────────────

export function isTradingEnabled()  { return tradingEnabled; }
export function enableTrading()     { tradingEnabled = true;  logger.info("[RISK] Trading enabled.");  }
export function disableTrading()    { tradingEnabled = false; logger.warn("[RISK] Trading disabled."); }

// Manual halt (!stop / START_HALTED) is DURABLE: unlike the daily drawdown halt, the midnight
// reset never clears it — only an explicit !resume does. Stops the bot silently re-enabling
// trading overnight after you halted it.
export function haltManual()        { manualHalt = true;  disableTrading(); }
export function resumeManual()      { manualHalt = false; enableTrading(); }
export function isManualHalt()      { return manualHalt; }

// Current calendar date in ET (YYYY-MM-DD), so daily stats roll over on the ET day.
function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function persistStats() {
  saveStats({ date: todayET(), dailyStartBalance, dailyPnl, tradesToday });
}

export function setDailyStartBalance(balance) {
  const saved = loadStats();
  if (saved && saved.date === todayET()) {
    // Same ET day (e.g. a mid-day redeploy) → restore counters instead of zeroing them.
    dailyStartBalance = saved.dailyStartBalance ?? balance;
    dailyPnl          = saved.dailyPnl ?? 0;
    tradesToday       = saved.tradesToday ?? 0;
    logger.info(`[RISK] Restored today's stats — start ${usd(dailyStartBalance)}, P&L ${usd(dailyPnl)}, ${tradesToday} trade(s).`);
  } else if (dailyStartBalance === null) {
    dailyStartBalance = balance;
    logger.info(`[RISK] Daily start balance set: ${usd(balance)}`);
  }
  persistStats();
}

export function checkDrawdown(currentBalance) {
  if (dailyStartBalance === null) return false;
  const drawdown = (dailyStartBalance - currentBalance) / dailyStartBalance;
  if (drawdown >= DAILY_DRAWDOWN_LIMIT) {
    disableTrading();
    logger.warn(`[RISK] Daily drawdown limit hit: ${pct(drawdown)}`);
    return true;
  }
  return false;
}

export function resetDailyStats(balance) {
  dailyStartBalance = balance;
  dailyPnl          = 0;
  tradesToday       = 0;
  drawdownHalted    = false;
  if (!manualHalt) enableTrading();   // clears a drawdown (auto) halt, but never a manual !stop
  persistStats();
  logger.info(`[RISK] Daily stats reset. Start balance: ${usd(balance)}`);
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
  if (saved.length) logger.info(`[MONITOR] Recovered ${saved.length} open position(s) from disk.`);
}

export function registerTrade(trade) {
  openTrades.set(trade.symbol.toUpperCase(), trade);
  tradesToday++;
  persist();
  persistStats();
  logger.info(`[MONITOR] Tracking ${trade.symbol} — entry: ${usd(trade.entry)}`);
}

export function getOpenTrades() {
  return Array.from(openTrades.values());
}

// Compare live Kraken holdings against cajh's tracked trades. Pure — unit-tested.
//   orphans = coins held on Kraken that cajh isn't tracking. A failed exit may have left
//             them behind, OR they're coins you hold yourself — cajh can't tell, so it only
//             flags them and never sells. ghosts = trades cajh still tracks that Kraken no
//             longer holds (closed outside cajh).
const RECON_STABLES = ["USD", "USDT", "USDC", "ZUSD", "DAI", "USDG", "PYUSD"];
export function reconcile(holdings, trades, { stables = RECON_STABLES, dustUsd = 1 } = {}) {
  const tracked = new Set(trades.map(t => t.symbol.toUpperCase()));
  const held    = new Map(holdings.map(h => [h.asset.toUpperCase(), h]));
  const orphans = holdings.filter(h =>
    !stables.includes(h.asset.toUpperCase()) &&
    (h.value ?? 0) >= dustUsd &&
    !tracked.has(h.asset.toUpperCase())
  );
  const ghosts = trades.filter(t => {
    const h = held.get(t.symbol.toUpperCase());
    return !h || (h.qty ?? 0) < (t.volume ?? 0) * 0.5;
  });
  return { orphans, ghosts };
}

// Fetch live holdings and report any mismatch with tracked trades. Reports only — never sells.
export async function reconcileHoldings(channel) {
  let holdings;
  try { ({ holdings } = await getHoldings()); }
  catch (err) { logger.error("[RECONCILE] getHoldings failed:", err.message); return null; }
  const result = reconcile(holdings, getOpenTrades());
  const { orphans, ghosts } = result;
  if (!orphans.length && !ghosts.length) {
    logger.info("[RECONCILE] Holdings match tracked trades.");
    if (channel) await channel.send("🔎 **Reconciliation:** Kraken holdings match cajh's tracked trades. Nothing orphaned.");
    return result;
  }
  if (channel) {
    let msg = "🔎 **Position reconciliation**";
    if (orphans.length) {
      msg += `\n\n**On Kraken but NOT tracked by cajh** — a failed exit may have left these, or you hold them yourself (cajh can't tell, and won't touch them):\n` +
        orphans.map(h => `• **${h.asset}** — ${h.qty} (~${usd(h.value)})`).join("\n") +
        `\nIf one is an abandoned cajh trade, close it yourself with \`!sell ${orphans[0].asset}\`.`;
    }
    if (ghosts.length) {
      msg += `\n\n**Tracked by cajh but missing on Kraken** — likely closed outside cajh:\n` +
        ghosts.map(t => `• **${t.symbol}** — cajh expects ${t.volume}`).join("\n") +
        `\nStale records; they can't be sold (nothing there) and need a manual cleanup of positions.json.`;
    }
    await channel.send(msg);
  }
  return result;
}

/** Posted once a day: trades entered since the last summary + live P&L on open positions. */
export async function postDailySummary(channel) {
  let unrealized = 0;
  const lines = [];
  for (const [symbol, trade] of openTrades.entries()) {
    try {
      const price = await getCurrentPrice(symbol);
      if (!price) continue;
      const gross = (price - trade.entry) * trade.volume;
      const fees  = (trade.entry + price) * trade.volume * FEE_RATE; // round-trip if closed now
      const pnl   = gross - fees;
      const risk = trade.risk ?? (trade.entry - trade.stopLoss);
      const rMult = risk > 0 ? (price - trade.entry) / risk : 0;
      unrealized += pnl;
      lines.push(`${symbol}: ${pnl >= 0 ? "+" : ""}${usd(pnl)} (${rMult >= 0 ? "+" : ""}${rMult.toFixed(1)}R)`);
    } catch { /* skip price failures */ }
  }

  const entered = tradesToday;
  tradesToday = 0; // reset for the next day

  if (!channel) return;
  await channel.send(
    `📅 **Daily Summary**\n\n` +
    `**Trades entered:** ${entered}\n` +
    `**Open positions:** ${openTrades.size}\n` +
    `**Unrealized P&L (net of fees):** ${unrealized >= 0 ? "+" : ""}${usd(unrealized)}` +
    (lines.length ? `\n\n${lines.join("\n")}` : "")
  );
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
    `**Take Profit:** ${usd(trade.takeProfit)}\n` +
    `**Volume:** ${trade.volume} ${trade.symbol}\n` +
    `**Capital:** ${usd(trade.capital)} (${sizePct}% of balance)\n` +
    `**Signal:** ${trade.signal ?? "—"}`
  );
}

export async function postTradeClosed(channel, trade, exitPrice, reason) {
  const gross  = (exitPrice - trade.entry) * trade.volume;
  const fees   = (trade.entry + exitPrice) * trade.volume * FEE_RATE; // round-trip taker
  const pnl    = gross - fees;
  const pnlPct = (pnl / (trade.entry * trade.volume)) * 100;
  const emoji  = pnl >= 0 ? "🟢" : "🔴";
  const label  = reason === "tp"         ? "TP Hit ✅"
               : reason === "sl"         ? "SL Hit ❌"
               : reason === "swing-high" ? "Swing-High Take-Profit 📈"
               : reason === "manual"     ? "Manually Closed"
               : "Closed";

  dailyPnl += pnl;
  persistStats();

  if (!channel) return;
  const beag = process.env.BEAG_USER_ID || "795521432783552552";
  await channel.send(
    `<@${beag}> ${emoji} **Trade Closed — ${trade.symbol} (${label})**\n\n` +
    `**Entry:** ${usd(trade.entry)}\n` +
    `**Exit:** ${usd(exitPrice)}\n` +
    `**P&L (net of fees):** ${pnl >= 0 ? "+" : ""}${usd(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)\n` +
    `**Daily P&L:** ${dailyPnl >= 0 ? "+" : ""}${usd(dailyPnl)}`
  );
}

// ─── Position monitor ──────────────────────────────────────────────────────────

// Close a position ONLY if the exchange sell actually succeeds. If it fails, keep the
// trade tracked so the next tick retries — never mark it closed here, or cajh would
// believe it's flat while Kraken still holds the position.
async function closePosition(channel, symbol, trade, price, reason) {
  let sold;
  try {
    sold = await placeSell({ symbol, volume: trade.volume, price });
  } catch (err) {
    logger.error(`[MONITOR] ${reason} sell failed for ${symbol}:`, err.message);
  }
  if (!sold?.txid) {
    // Sell did not go through — do NOT close. Alert once, then retry silently each tick.
    if (channel && !trade._exitAlertSent) {
      trade._exitAlertSent = true;
      await channel.send(
        `⚠️ **${symbol}** exit (${reason}) failed to fill — Kraken still holds it. ` +
        `cajh will keep retrying; use \`!sell ${symbol}\` to close it yourself.`
      );
    }
    return false;
  }
  await postTradeClosed(channel, trade, sold.price, reason);
  removeTrade(symbol);
  return true;
}

export function startMonitor(client, getChannelId, intervalMs = 30000) {
  logger.info("[MONITOR] Position monitor started");
  hydrateTrades();

  // The channel is resolved fresh each time (the id can be set/changed later via
  // !setchannel) and is best-effort only — exits run with or without a channel to
  // announce them in.
  const resolveChannel = async () => {
    const id = typeof getChannelId === "function" ? getChannelId() : getChannelId;
    if (!id) return null;
    try { return await client.channels.fetch(id); } catch { return null; }
  };

  // One-time boot reconciliation: surface any Kraken holdings cajh isn't tracking — e.g.
  // positions a failed exit abandoned before the close-only-on-success fix.
  resolveChannel()
    .then(ch => reconcileHoldings(ch))
      .catch(err => logger.error("[RECONCILE] boot check skipped:", err.message));

  // Reset daily stats when the ET calendar day rolls over. Checked every minute instead
  // of computing "ms until midnight" — that math runs in the server's local timezone
  // (e.g. UTC on Railway), which drifts from the ET day todayET() actually keys stats by.
  let lastResetDay = todayET();
  setInterval(async () => {
    const day = todayET();
    if (day === lastResetDay) return;
    lastResetDay = day;
    try { resetDailyStats(await currentEquity()); }
    catch (err) { logger.error("[MONITOR] Reset failed:", err.message); }
  }, 60_000);

  // Monitor open positions.
  setInterval(async () => {
    if (openTrades.size === 0) return;

    try {
      // Exits must run even if the channel is unset or briefly unavailable,
      // so messages are best-effort only.
      const channel = await resolveChannel();

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
      // checkDrawdown halts trading on every tick it's breached (idempotent). Announce
      // only on the first breach of the day so we don't spam the channel each poll.
      if (checkDrawdown(cash + positionsValue) && !drawdownHalted && channel) {
        drawdownHalted = true;
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

        // Stop → close the position (only if the exchange sell actually goes through).
        if (price <= trade.stopLoss) {
          await closePosition(channel, symbol, trade, price, "sl");
          continue;
        }

        // Take-profit → close the full position (only if the exchange sell goes through).
        if (price >= trade.takeProfit) {
          await closePosition(channel, symbol, trade, price, "tp");
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
                await closePosition(channel, symbol, trade, price, "swing-high");
                continue;
              }
            } catch (err) {
              logger.error(`[MONITOR] swing-high check failed for ${symbol}:`, err.message);
            }
          }
        }

        // Breakeven-plus: once price has run far enough, lift the stop above entry to a
        // level that clears round-trip fees, so the trade can no longer close net-red.
        // Checked after stop/TP so those take priority.
        if (LOCK_BREAKEVEN && !trade.beMoved) {
          const risk = trade.risk ?? (trade.entry - trade.stopLoss);
          if (risk > 0) {
            // Lock at the larger of 0.2R or the fee buffer; arm high enough that the lock
            // is always comfortably below price (matters when the stop is very tight).
            const lockOffset = Math.max(BE_LOCK_R * risk, FEE_BUFFER_PCT * trade.entry);
            const armOffset  = Math.max(BE_TRIGGER_R * risk, lockOffset + 0.5 * risk);
            if (price >= trade.entry + armOffset) {
              trade.stopLoss = trade.entry + lockOffset;
              trade.beMoved  = true;
              saveTradeState();
              if (channel) {
                const lockPct = (lockOffset / trade.entry) * 100;
                await channel.send(
                  `🔒 **Stop Raised — ${symbol}**\n` +
                  `Stop moved up to ${usd(trade.stopLoss)} (+${lockPct.toFixed(2)}% above entry, net of fees). ` +
                  `This trade can no longer close at a loss.`
                );
              }
            }
          }
        }
      }

    } catch (err) {
          logger.error("[MONITOR] Error:", err.message);
    }
  }, intervalMs);
}