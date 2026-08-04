/**
 * scanner.js — Swing-fractal trading strategy (the core of cajh).
 *
 * Pure price structure, no indicators. Entries are ANTICIPATED, not chased:
 *   • A candidate swing low (strong left-side low) exists on the 1h, 4h, or 1d.
 *   • The moment live price trades ABOVE the candidate candle's high, the
 *     break-of-structure confirmation is *expected* to print at this candle's
 *     close — that crossing is the entry. Stop = the candidate low.
 *   • A low that already confirmed within RECENT_BARS still counts (fallback for
 *     price gapping through the trigger between scans).
 * Any one of the three timeframes can fire (1d > 4h > 1h priority). There is no
 * higher-timeframe alignment gate — sizing is risk-based instead, so wider stops
 * on slower timeframes carry the same dollar risk.
 *
 * cajh is long-only spot: it ACTS on buy signals (opens a long) and only DISPLAYS
 * sell signals. Exits are handled by the position monitor via stop-loss / take-profit.
 */

import { generateChartImage } from "./chart.js";
import {
  entrySignal, pendingSwingLow, currentBias, SWING_WINDOW, TP_R,
  REQUIRE_HIGHER_LOW, MIN_STOP_PCT, MAX_STOP_PCT_BY_TF, RISK_PCT, MAX_POSITION_PCT
} from "./strategy.js";
import { placeBuy, getCurrentPrice, fetchOHLC, getAccountBalance } from "./trader.js";
import {
  registerTrade, postTradeOpened, isTradingEnabled, getTrade, getOpenTrades, closeTradeAtMarket,
  requireMonitorHealthForEntry
} from "./monitor.js";
import { saveChart, symbolToKrakenId } from "./storage.js";
import * as logger from './logger.js';

const BEAG = () => process.env.BEAG_USER_ID || "795521432783552552";

export const SCAN_INTERVALS = [
  { label: "1h", minutes: 60   },
  { label: "4h", minutes: 240  },
  { label: "1d", minutes: 1440 }
];

// ─── Tunable strategy settings ─────────────────────────────────────────────────
const MAX_OPEN_POSITIONS  = 6;   // at the cap, the most profitable open position is rotated out for a new signal
const MIN_POSITION_USD    = 10;  // skip if the computed size would be below Kraken's min order size
// Swing window N, TP_R, RISK_PCT / MAX_POSITION_PCT and the stop bands live in strategy.js.

// Candle fetching lives in trader.js (shared with the monitor); re-export the name
// the rest of the app already uses.
export const fetchCandles = fetchOHLC;

// ─── Per-asset evaluation ──────────────────────────────────────────────────────
// Returns { biases, buy, candlesByTf }. Each timeframe is checked independently —
// highest first (1d > 4h > 1h), stronger structure wins when several fire at once:
//   1. ANTICIPATION — an unconfirmed candidate swing low exists on the closed bars
//      and live price has crossed above its trigger (the candidate candle's high),
//      so the confirming close is expected to print.
//   2. CONFIRMED fallback — a swing low that confirmed within RECENT_BARS (covers
//      price gapping through the trigger between scans).
// No alignment/trend gates — risk-based sizing replaces them (see proposeBuy).
// Charts aren't rendered here — raw candles are kept so charts build only on a trade.
async function evaluateAsset(asset) {
  const biases = {};
  const candlesByTf = {};

  for (const interval of SCAN_INTERVALS) {
    const candles = await fetchCandles(asset.id, interval.minutes);
    if (!candles || candles.length === 0) { biases[interval.label] = null; continue; }
    candlesByTf[interval.label] = candles;
    biases[interval.label] = currentBias(candles.slice(0, -1), SWING_WINDOW); // closed candles only
    await new Promise(r => setTimeout(r, 2000)); // be gentle with Kraken
  }

  let buy = null;
  for (const interval of [...SCAN_INTERVALS].reverse()) {   // 1d first
    const candles = candlesByTf[interval.label];
    if (!candles?.length) continue;
    const closed = candles.slice(0, -1);
    // Live price = the still-open candle's latest close (fresher than any closed bar).
    const livePrice = parseFloat(candles[candles.length - 1].close);

    const pend = pendingSwingLow(closed, SWING_WINDOW);
    if (pend && livePrice > pend.trigger) {
      buy = { type: "buy", ...pend, tf: interval.label, mode: "anticipation" };
      break;
    }
    const sig = entrySignal(closed, SWING_WINDOW);
    if (sig) {
      buy = { ...sig, tf: interval.label, mode: "confirmed" };
      break;
    }
  }

  return { biases, buy, candlesByTf };
}

/** Render the 3 timeframe charts for a symbol from already-fetched candles. */
function buildCharts(symbol, candlesByTf) {
  const buffers = [];
  for (const interval of SCAN_INTERVALS) {
    const candles = candlesByTf[interval.label];
    if (candles?.length) {
      buffers.push({ label: interval.label, buffer: generateChartImage(candles, symbol, interval.label) });
    }
  }
  return buffers;
}

function summarize(symbol, biases, buy) {
  const parts = SCAN_INTERVALS.map(i => {
    const b = biases[i.label];
    const tag = b === "bull" ? "▲ bull" : b === "bear" ? "▼ bear" : "· —";
    return `${i.label} ${tag}`;
  });
  const sig = buy ? `**signal: ${buy.tf} ${buy.mode ?? "confirmed"} ⚡**` : "no signal";
  return `**${symbol}**  ·  ${parts.join("  ·  ")}  ·  ${sig}`;
}

// ─── Trade proposal (buy signals only) ─────────────────────────────────────────
// Returns { traded: bool, reason }. Posts the trade card + ping only on success;
// callers decide whether to surface skip reasons (scans stay quiet, !trade explains).

// Symbols with a buy attempt in flight — guards a cron scan and a manual !scan/!trade
// racing each other into a double entry before getTrade() sees the first one.
const pendingBuys = new Set();

// Structural levels already traded, key → timestamp. Without this, a stop-out leaves
// price ABOVE the same candidate's trigger, so the very next 15-minute scan re-buys the
// identical setup — stop out, re-buy, stop out — bleeding a full stop plus round-trip
// fees each cycle. One level, one trade, until the cooldown expires (24 bars of the
// signal's own timeframe, so a 1h level frees up in a day, a 1d level in ~3 weeks).
const tradedLevels = new Map();
const levelKey = (symbol, buy) => `${symbol}|${buy.tf}|${buy.pivotPrice}`;
const COOLDOWN_BARS = 24;

function levelOnCooldown(symbol, buy) {
  const until = tradedLevels.get(levelKey(symbol, buy));
  if (until == null) return false;
  if (Date.now() >= until) { tradedLevels.delete(levelKey(symbol, buy)); return false; }
  return true;
}

function markLevelTraded(symbol, buy, tfMinutes) {
  // Prune expired keys so the map can't grow without bound over a long uptime.
  const now = Date.now();
  for (const [k, until] of tradedLevels) if (now >= until) tradedLevels.delete(k);
  tradedLevels.set(levelKey(symbol, buy), now + COOLDOWN_BARS * tfMinutes * 60 * 1000);
}

async function proposeBuy(symbol, buy, channel) {
  if (pendingBuys.has(symbol)) return { traded: false, reason: "a buy for this symbol is already in flight" };
  pendingBuys.add(symbol);
  try { return await proposeBuyLocked(symbol, buy, channel); }
  finally { pendingBuys.delete(symbol); }
}

async function proposeBuyLocked(symbol, buy, channel) {
  if (!isTradingEnabled()) return { traded: false, reason: "trading is halted (!resume to enable)" };
  const monitorGate = requireMonitorHealthForEntry();
  if (!monitorGate.ok) return { traded: false, reason: `entry blocked: ${monitorGate.reason}` };
  if (getTrade(symbol))    return { traded: false, reason: "already in a position" };

  const tfMinutes = SCAN_INTERVALS.find(i => i.label === buy.tf)?.minutes ?? 60;
  if (levelOnCooldown(symbol, buy)) {
    return { traded: false, reason: `this ${buy.tf} level was already traded recently (one trade per structural level)` };
  }

  // At the position cap, rotate: close the MOST PROFITABLE open position (bank the
  // winner) to make room for the newest signal. Only proceed if that close succeeds.
  // A position is only rotated out while it is IN PROFIT — closing a loser to chase a
  // fresh signal just pays two more fee legs to swap one drawdown for another.
  if (getOpenTrades().length >= MAX_OPEN_POSITIONS) {
    let best = null;
    for (const t of getOpenTrades()) {
      try {
        const p = await getCurrentPrice(t.symbol);
        if (!p) continue;
        const tRisk = t.risk ?? (t.entry - t.stopLoss);
        const r = tRisk > 0 ? (p - t.entry) / tRisk : 0;
        if (!best || r > best.r) best = { trade: t, price: p, r };
      } catch { /* skip unpriceable positions */ }
    }
    if (!best) return { traded: false, reason: `max open positions (${MAX_OPEN_POSITIONS}) and no rotation candidate could be priced` };
    if (best.r <= 0) {
      return { traded: false, reason: `max open positions (${MAX_OPEN_POSITIONS}) — none are in profit, so nothing is rotated out` };
    }
    const rotated = await closeTradeAtMarket(channel, best.trade.symbol, best.price, "rotated");
    if (!rotated) return { traded: false, reason: `max open positions — rotating out ${best.trade.symbol} failed` };
  }

  const entry    = await getCurrentPrice(symbol);
  const stopLoss = buy.pivotPrice;   // the candidate/confirmed swing low = structural invalidation
  const risk     = entry - stopLoss;

  if (!entry || risk <= 0) return { traded: false, reason: "price already at/below the swing low" };

  // Per-timeframe stop band: wider TFs legitimately carry wider stops.
  const stopFrac = risk / entry;
  const maxStop  = MAX_STOP_PCT_BY_TF[buy.tf] ?? 0.04;
  if (stopFrac > maxStop) {
    return { traded: false, reason: `stop too far (${(stopFrac * 100).toFixed(1)}% > ${(maxStop * 100).toFixed(0)}% for ${buy.tf})` };
  }
  if (MIN_STOP_PCT && stopFrac < MIN_STOP_PCT) {
    return { traded: false, reason: `stop too tight (${(stopFrac * 100).toFixed(1)}% < ${(MIN_STOP_PCT * 100).toFixed(1)}%) — R too small to clear fees` };
  }
  if (REQUIRE_HIGHER_LOW && buy.prevSwingLow != null && buy.pivotPrice <= buy.prevSwingLow) {
    return { traded: false, reason: "not a higher low (structure not yet bullish)" };
  }

  // Risk-based sizing: risk RISK_PCT of free cash per trade, so the dollar risk is the
  // same whether the stop is 1.5% (1h) or 8% (1d). Capped at MAX_POSITION_PCT.
  const freeCash = await getAccountBalance();
  const capital  = Math.min(freeCash * MAX_POSITION_PCT, (freeCash * RISK_PCT) / stopFrac);
  if (capital < MIN_POSITION_USD) {
    return { traded: false, reason: `computed size $${capital.toFixed(2)} below the $${MIN_POSITION_USD} exchange minimum` };
  }

  const signal = `${buy.tf} swing low (${buy.mode ?? "confirmed"})`;

  // Auto-execute — no confirmation needed. cajh places the trade itself. The level is
  // marked BEFORE the order so a mid-flight crash can't leave it re-triggerable.
  markLevelTraded(symbol, buy, tfMinutes);
  try {
    const trade = await placeBuy({ symbol, capital, price: entry });
    // Recompute off the actual fill (trade.price), not the pre-trade quote — a market
    // order can fill away from the quote, and stop/target must track the real entry.
    const actualRisk  = trade.price - stopLoss;
    trade.entry       = trade.price;
    trade.stopLoss    = stopLoss;
    trade.takeProfit  = trade.entry + TP_R * actualRisk;
    trade.risk        = actualRisk;    // entry − stop, for R-based stop management
    trade.beMoved     = false;         // has the breakeven+ stop-raise happened yet?
    trade.sizePct     = trade.balance > 0 ? trade.capital / trade.balance : 0; // for display
    trade.signal      = signal;
    trade.tf          = buy.tf;          // entry timeframe (for swing-high exit)
    trade.tfMinutes   = tfMinutes;
    trade.openedAt    = Date.now();      // ms — used to detect a *fresh* swing high

    registerTrade(trade);            // persists to disk
    await postTradeOpened(channel, trade);
    await channel.send(`<@${BEAG()}> 🚨 New trade opened on **${symbol}** — \`!sell ${symbol}\` to close it (or \`!sell ${symbol} 50\` for half).`);
    return { traded: true };
  } catch (err) {
      logger.error(`[STRATEGY] Execution failed for ${symbol}:`, err.message);
    await channel.send(`<@${BEAG()}> ⚠️ **${symbol}** trade failed: ${err.message}`);
    return { traded: false, reason: `order error: ${err.message}` };
  }
}

// ─── Public entry points ───────────────────────────────────────────────────────

/** Full watchlist scan — used by !scan and the scheduled scans. Stays quiet:
 *  posts charts only for assets that actually open a trade. */
export async function runScanner(channel, state, verbose = false) {
  const watchlist = state.watchlist || [];
  if (watchlist.length === 0) {
    await channel.send("⚠️ Your watchlist is empty! Add assets with `!watch BTC ETH SOL`.");
    return;
  }

  if (verbose) {
    await channel.send(
      `🔍 Scanning ${watchlist.length} assets on ${SCAN_INTERVALS.map(i => i.label).join("/")} ` +
      `(N=${SWING_WINDOW}). Charts post only when a trade fires.`
    );
  }

  let checked = 0, opened = 0;
  for (const asset of watchlist) {
    try {
      const { buy, candlesByTf } = await evaluateAsset(asset);
      if (Object.keys(candlesByTf).length === 0) { logger.warn(`[SCAN] no data for ${asset.symbol}`); continue; }
      checked++;

      if (!buy) continue;   // no fresh setup on any timeframe → stay silent

      const res = await proposeBuy(asset.symbol, buy, channel);
      if (res.traded) {
        opened++;
        const buffers = buildCharts(asset.symbol, candlesByTf);
        if (buffers.length) {
          const b64 = buffers[0].buffer.toString("base64");
          state.lastChartBase64    = b64;
          state.lastChartMediaType = "image/png";
          saveChart(b64, "image/png");
          await channel.send({
            content: `📈 **${asset.symbol}** — the setup that triggered this trade`,
            files:   buffers.map(b => ({ attachment: b.buffer, name: `${asset.symbol}_${b.label}.png` }))
          });
        }
      } else {
        logger.info(`[SCAN] ${asset.symbol} buy not taken: ${res.reason}`);
      }

      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
          logger.error(`Error scanning ${asset.symbol}:`, error.message);
    }
  }

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  state.lastScanTime = now;
  if (verbose) {
    await channel.send(
      `✅ **Scan complete** — checked ${checked} asset${checked === 1 ? "" : "s"}, ` +
      `opened ${opened} trade${opened === 1 ? "" : "s"} · ${now} EST`
    );
  }
}

/** Single-symbol check — used by !trade BTC. Always shows charts (you asked to see it). */
export async function scanSymbol(symbol, channel, state) {
  const upper = symbol.toUpperCase();
  const known = (state.watchlist || []).find(a => a.symbol === upper);
  const asset = { symbol: upper, id: known?.id || symbolToKrakenId(upper) };

  await channel.send(`🔍 Checking **${upper}** on ${SCAN_INTERVALS.map(i => i.label).join("/")}...`);

  try {
    const { biases, buy, candlesByTf } = await evaluateAsset(asset);
    if (Object.keys(candlesByTf).length === 0) { await channel.send(`⚠️ No data for **${upper}**.`); return; }

    const buffers = buildCharts(upper, candlesByTf);
    const b64 = buffers[0]?.buffer.toString("base64");
    if (b64) {
      state.lastChartBase64    = b64;
      state.lastChartMediaType = "image/png";
      saveChart(b64, "image/png");
    }

    await channel.send({
      content: summarize(upper, biases, buy),
      files:   buffers.map(b => ({ attachment: b.buffer, name: `${upper}_${b.label}.png` }))
    });

    if (buy) {
      const res = await proposeBuy(upper, buy, channel);
      if (!res.traded) await channel.send(`ℹ️ **${upper}** setup not taken — ${res.reason}.`);
    } else {
      await channel.send(`No setup on **${upper}** right now (needs a candidate swing low on the 1h/4h/1d with price crossing its trigger, or a freshly confirmed one).`);
    }
  } catch (err) {
      logger.error(`[STRATEGY] scanSymbol error for ${upper}:`, err.message);
    await channel.send(`⚠️ Something went wrong: ${err.message}`);
  }
}
