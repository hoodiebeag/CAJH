/**
 * scanner.js — Swing-fractal trading strategy (the core of cajh).
 *
 * Pure price structure, no indicators:
 *   • Swing low  (BUY)  = low below the N candles on both sides.
 *   • Swing high (SELL) = high above the N candles on both sides.
 * A pivot confirms N candles later, so signals have a built-in N-candle delay.
 *
 * cajh is long-only spot: it ACTS on buy signals (opens a long) and only DISPLAYS
 * sell signals. Exits are handled by the position monitor via stop-loss / take-profit.
 */

import axios from "axios";
import { generateChartImage } from "./chart.js";
import { latestSignal, detectSwings, currentBias, SWING_WINDOW, RR1, RR2, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, REQUIRE_TF_ALIGNMENT } from "./strategy.js";
import { placeBuy, getCurrentPrice, placeStopLoss } from "./trader.js";
import {
  requestConfirmation, registerTrade, postTradeOpened,
  isTradingEnabled, getTrade
} from "./monitor.js";
import { saveChart, symbolToKrakenId } from "./storage.js";

export const SCAN_INTERVALS = [
  { label: "15m", minutes: 15 },
  { label: "1h",  minutes: 60 },
  { label: "4h",  minutes: 240 }
];

// ─── Tunable strategy settings ─────────────────────────────────────────────────
const POSITION_PCT = 0.10;  // 10% of balance per trade
// Swing window N, RR1/RR2, and the optional filters live in strategy.js.

// ─── Candle fetch (Kraken public OHLC, no API key) ─────────────────────────────
export async function fetchCandles(pair, minutes) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get("https://api.kraken.com/0/public/OHLC", {
        params: { pair, interval: minutes },
        timeout: 15000
      });

      if (response.data.error && response.data.error.length > 0) {
        console.error(`Kraken error for ${pair}:`, response.data.error);
        return null;
      }

      const key     = Object.keys(response.data.result).find(k => k !== "last");
      const candles = response.data.result[key];

      return candles.map(k => ({
        time:   k[0],
        open:   k[1].toString(),
        high:   k[2].toString(),
        low:    k[3].toString(),
        close:  k[4].toString(),
        volume: k[6].toString()
      }));

    } catch (error) {
      console.error(`Fetch attempt ${attempt} failed for ${pair}:`, error.message);
      if (attempt === 3) return null;
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }
}

// ─── Per-asset evaluation ──────────────────────────────────────────────────────
// Returns { signals: { "15m": sig|null, ... }, buy: bestBuy|null, buffers: [...] }.
// "buy" is a freshly-confirmed buy, returned ONLY if all timeframes agree (when
// REQUIRE_TF_ALIGNMENT is on). "biases" is each timeframe's current bull/bear bias.
async function evaluateAsset(asset) {
  const signals = {};
  const biases  = {};
  const buffers = [];
  let freshBuy = null;

  for (const interval of SCAN_INTERVALS) {
    const candles = await fetchCandles(asset.id, interval.minutes);
    if (!candles || candles.length === 0) { signals[interval.label] = null; biases[interval.label] = null; continue; }

    // Signals use CLOSED candles only — drop the still-forming last candle.
    const closed = candles.slice(0, -1);
    const sig    = latestSignal(closed, SWING_WINDOW);
    signals[interval.label] = sig;
    biases[interval.label]  = currentBias(closed, SWING_WINDOW);

    if (sig?.type === "buy") {
      // Find the previous confirmed swing low (for the higher-low filter).
      const lowPivots = detectSwings(closed, SWING_WINDOW).filter(p => p.type === "low");
      const prev = lowPivots.length >= 2 ? lowPivots[lowPivots.length - 2].price : null;
      freshBuy = { ...sig, tf: interval.label, prevSwingLow: prev }; // higher TF overwrites
    }

    const buffer = generateChartImage(candles, asset.symbol, interval.label);
    buffers.push({ label: interval.label, buffer });

    await new Promise(r => setTimeout(r, 2000)); // be gentle with Kraken
  }

  // All three timeframes must be bullish to confirm a setup.
  const aligned = SCAN_INTERVALS.every(i => biases[i.label] === "bull");
  const buy = (freshBuy && (!REQUIRE_TF_ALIGNMENT || aligned)) ? freshBuy : null;

  return { signals, biases, aligned, buy, buffers };
}

function summarize(symbol, biases, aligned) {
  const parts = SCAN_INTERVALS.map(i => {
    const b = biases[i.label];
    const tag = b === "bull" ? "▲ bull" : b === "bear" ? "▼ bear" : "· —";
    return `${i.label} ${tag}`;
  });
  return `**${symbol}**  ·  ${parts.join("  ·  ")}  ·  ${aligned ? "**aligned ✅**" : "not aligned"}`;
}

// ─── Trade proposal (buy signals only) ─────────────────────────────────────────
async function proposeBuy(symbol, buy, channel) {
  if (!isTradingEnabled()) return;
  if (getTrade(symbol))    return;   // one position per symbol

  const entry    = await getCurrentPrice(symbol);
  const stopLoss = buy.pivotPrice;   // the swing low = structural invalidation
  const risk     = entry - stopLoss;

  if (!entry || risk <= 0) {
    await channel.send(`ℹ️ **${symbol}** buy signal skipped — price is already at/below the swing low.`);
    return;
  }

  // Optional confidence filters (see strategy.js).
  if (MAX_STOP_PCT && risk / entry > MAX_STOP_PCT) {
    await channel.send(`ℹ️ **${symbol}** skipped — stop too far (${(risk / entry * 100).toFixed(1)}% > ${(MAX_STOP_PCT * 100).toFixed(0)}%).`);
    return;
  }
  if (REQUIRE_HIGHER_LOW && buy.prevSwingLow != null && buy.pivotPrice <= buy.prevSwingLow) {
    await channel.send(`ℹ️ **${symbol}** skipped — not a higher low (structure not yet bullish).`);
    return;
  }

  const tp1    = entry + RR1 * risk;
  const tp2    = entry + RR2 * risk;
  const signal = `${buy.tf} swing low`;

  const confirmed = await requestConfirmation(channel, {
    symbol, entry, stopLoss, takeProfit1: tp1, takeProfit2: tp2,
    sizePct: POSITION_PCT, signal
  });

  if (!confirmed) { await channel.send(`❌ **${symbol}** trade skipped.`); return; }

  try {
    const trade = await placeBuy({ symbol, sizePct: POSITION_PCT, price: entry });
    trade.entry       = entry;
    trade.stopLoss    = stopLoss;
    trade.takeProfit1 = tp1;
    trade.takeProfit2 = tp2;
    trade.sizePct     = POSITION_PCT;
    trade.tp1Hit      = false;
    trade.signal      = signal;

    // Place a REAL protective stop on Kraken so the position is covered even if the
    // bot goes offline. The monitor manages TP1/TP2 and reconciles with this order.
    try {
      trade.stopOrderId = await placeStopLoss({ symbol, volume: trade.volume, stopPrice: stopLoss });
    } catch (stopErr) {
      trade.stopOrderId = null;
      console.error(`[STRATEGY] Could not place protective stop for ${symbol}:`, stopErr.message);
      await channel.send(`⚠️ **${symbol}**: couldn't place the protective stop on Kraken — the monitor will watch the stop instead (only while the bot is running).`);
    }

    registerTrade(trade);
    await postTradeOpened(channel, trade);
  } catch (err) {
    console.error(`[STRATEGY] Execution failed for ${symbol}:`, err.message);
    await channel.send(`⚠️ **${symbol}** trade failed: ${err.message}`);
  }
}

// ─── Public entry points ───────────────────────────────────────────────────────

/** Full watchlist scan — used by !scan and the scheduled market-open scans. */
export async function runScanner(channel, state) {
  const watchlist = state.watchlist || [];
  if (watchlist.length === 0) {
    await channel.send("⚠️ Your watchlist is empty! Add assets with `!watch BTC ETH SOL`.");
    return;
  }

  await channel.send(
    `🔍 **Scanning ${watchlist.map(a => a.symbol).join(", ")}** on ` +
    `${SCAN_INTERVALS.map(i => i.label).join("/")} for swing signals (N=${SWING_WINDOW})...`
  );

  for (const asset of watchlist) {
    try {
      const { biases, aligned, buy, buffers } = await evaluateAsset(asset);
      if (buffers.length === 0) {
        await channel.send(`⚠️ Could not fetch data for **${asset.symbol}** — skipping.`);
        continue;
      }

      const b64 = buffers[0].buffer.toString("base64");
      state.lastChartBase64    = b64;
      state.lastChartMediaType = "image/png";
      saveChart(b64, "image/png");

      await channel.send({
        content: summarize(asset.symbol, biases, aligned),
        files:   buffers.map(b => ({ attachment: b.buffer, name: `${asset.symbol}_${b.label}.png` }))
      });

      if (buy) await proposeBuy(asset.symbol, buy, channel);

      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      console.error(`Error scanning ${asset.symbol}:`, error.message);
      await channel.send(`⚠️ Error scanning **${asset.symbol}**.`);
    }
  }

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  await channel.send(`✅ **Scan complete** — ${now} EST`);
  state.lastScanTime = now;
}

/** Single-symbol check — used by !trade BTC. */
export async function scanSymbol(symbol, channel, state) {
  const upper = symbol.toUpperCase();
  const known = (state.watchlist || []).find(a => a.symbol === upper);
  const asset = { symbol: upper, id: known?.id || symbolToKrakenId(upper) };

  await channel.send(`🔍 Checking **${upper}** on ${SCAN_INTERVALS.map(i => i.label).join("/")}...`);

  try {
    const { biases, aligned, buy, buffers } = await evaluateAsset(asset);
    if (buffers.length === 0) { await channel.send(`⚠️ No data for **${upper}**.`); return; }

    await channel.send({
      content: summarize(upper, biases, aligned),
      files:   buffers.map(b => ({ attachment: b.buffer, name: `${upper}_${b.label}.png` }))
    });

    if (buy) await proposeBuy(upper, buy, channel);
    else     await channel.send(`No confirmed setup on **${upper}** right now (needs a fresh swing low with all 3 timeframes aligned).`);
  } catch (err) {
    console.error(`[STRATEGY] scanSymbol error for ${upper}:`, err.message);
    await channel.send(`⚠️ Something went wrong: ${err.message}`);
  }
}