/**
 * scanner.js — Swing-fractal trading strategy (the core of cajh).
 *
 * Pure price structure, no indicators:
 *   • Swing low  (BUY)  = strong local low, confirmed when price breaks back above it.
 *   • Swing high (SELL) = strong local high, confirmed when price breaks below it.
 * Confirmation is by break of structure (~1-2 candles), not a fixed N-candle delay.
 *
 * cajh is long-only spot: it ACTS on buy signals (opens a long) and only DISPLAYS
 * sell signals. Exits are handled by the position monitor via stop-loss / take-profit.
 */

import { generateChartImage } from "./chart.js";
import { entrySignal, currentBias, isTrending, aboveTrendMA, SWING_WINDOW, TP_R, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, MIN_STOP_PCT, REQUIRE_TF_ALIGNMENT, CHOP_FILTER, TREND_GATE, TREND_GATE_MODE, TREND_MA } from "./strategy.js";
import { placeBuy, getCurrentPrice, fetchOHLC, getAccountBalance } from "./trader.js";
import {
  registerTrade, postTradeOpened, isTradingEnabled, getTrade, getOpenTrades
} from "./monitor.js";
import { saveChart, symbolToKrakenId } from "./storage.js";

const BEAG = () => process.env.BEAG_USER_ID || "795521432783552552";

export const SCAN_INTERVALS = [
  { label: "15m", minutes: 15 },
  { label: "1h",  minutes: 60 },
  { label: "4h",  minutes: 240 }
];

// ─── Tunable strategy settings ─────────────────────────────────────────────────
const POSITION_PCT        = 0.10;  // 10% of free cash per trade
const MAX_OPEN_POSITIONS  = 6;     // never hold more than this many positions at once
const MIN_POSITION_USD    = 10;    // skip if the 10% slice would be below Kraken's min order size
// Swing window N, TP_R, and the optional filters live in strategy.js.

// Candle fetching lives in trader.js (shared with the monitor); re-export the name
// the rest of the app already uses.
export const fetchCandles = fetchOHLC;

// ─── Per-asset evaluation ──────────────────────────────────────────────────────
// Returns { biases, aligned, buy, candlesByTf }. Entries TRIGGER on the fast 15m
// timeframe (a recently break-of-structure-confirmed swing low); the 1h and 4h serve
// as a higher-timeframe TREND filter (must be bullish when REQUIRE_TF_ALIGNMENT is on).
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

  // Trigger on a recently-confirmed 15m swing low.
  let buy = null;
  const c15 = candlesByTf["15m"];
  if (c15) {
    const sig = entrySignal(c15.slice(0, -1), SWING_WINDOW);
    if (sig) buy = { ...sig, tf: "15m" };
  }

  // Higher-timeframe trend filter: 1h AND 4h must be bullish.
  const aligned = biases["1h"] === "bull" && biases["4h"] === "bull";
  let pass = !REQUIRE_TF_ALIGNMENT || aligned;
  // Chop filter: additionally require the 4h to be genuinely trending (HH + HL).
  if (pass && CHOP_FILTER) {
    const c4 = candlesByTf["4h"];
    pass = c4 ? isTrending(c4.slice(0, -1), SWING_WINDOW) : false;
  }
  // Per-pair trend gate: this symbol's own 4h must be trending up.
  if (pass && TREND_GATE) {
    const c4 = candlesByTf["4h"];
    if (!c4) pass = false;
    else if (TREND_GATE_MODE === "structure") pass = isTrending(c4.slice(0, -1), SWING_WINDOW);
    else pass = aboveTrendMA(c4.slice(0, -1), TREND_MA);
  }
  if (buy && !pass) buy = null;

  return { biases, aligned, buy, candlesByTf };
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

function summarize(symbol, biases, aligned) {
  const parts = SCAN_INTERVALS.map(i => {
    const b = biases[i.label];
    const tag = b === "bull" ? "▲ bull" : b === "bear" ? "▼ bear" : "· —";
    return `${i.label} ${tag}`;
  });
  return `**${symbol}**  ·  ${parts.join("  ·  ")}  ·  ${aligned ? "**aligned ✅**" : "not aligned"}`;
}

// ─── Trade proposal (buy signals only) ─────────────────────────────────────────
// Returns { traded: bool, reason }. Posts the trade card + ping only on success;
// callers decide whether to surface skip reasons (scans stay quiet, !trade explains).
async function proposeBuy(symbol, buy, channel) {
  if (!isTradingEnabled()) return { traded: false, reason: "trading is halted (!resume to enable)" };
  if (getTrade(symbol))    return { traded: false, reason: "already in a position" };
  if (getOpenTrades().length >= MAX_OPEN_POSITIONS) {
    return { traded: false, reason: `max open positions (${MAX_OPEN_POSITIONS}) reached` };
  }

  const entry    = await getCurrentPrice(symbol);
  const stopLoss = buy.pivotPrice;   // the swing low = structural invalidation
  const risk     = entry - stopLoss;

  if (!entry || risk <= 0) return { traded: false, reason: "price already at/below the swing low" };

  // Don't attempt a buy whose size would fall below the exchange minimum.
  const freeCash = await getAccountBalance();
  if (freeCash * POSITION_PCT < MIN_POSITION_USD) {
    return { traded: false, reason: `free cash too low (10% slice < $${MIN_POSITION_USD})` };
  }

  // Optional confidence filters (see strategy.js).
  if (MAX_STOP_PCT && risk / entry > MAX_STOP_PCT) {
    return { traded: false, reason: `stop too far (${(risk / entry * 100).toFixed(1)}% > ${(MAX_STOP_PCT * 100).toFixed(0)}%)` };
  }
  if (MIN_STOP_PCT && risk / entry < MIN_STOP_PCT) {
    return { traded: false, reason: `stop too tight (${(risk / entry * 100).toFixed(1)}% < ${(MIN_STOP_PCT * 100).toFixed(1)}%) — R too small to clear fees` };
  }
  if (REQUIRE_HIGHER_LOW && buy.prevSwingLow != null && buy.pivotPrice <= buy.prevSwingLow) {
    return { traded: false, reason: "not a higher low (structure not yet bullish)" };
  }

  const takeProfit = entry + TP_R * risk;
  const signal = `${buy.tf} swing low`;
  const tfMinutes = SCAN_INTERVALS.find(i => i.label === buy.tf)?.minutes ?? 15;

  // Auto-execute — no confirmation needed. cajh places the trade itself.
  try {
    const trade = await placeBuy({ symbol, sizePct: POSITION_PCT, price: entry });
    trade.entry       = entry;
    trade.stopLoss    = stopLoss;
    trade.takeProfit  = takeProfit;
    trade.risk        = risk;          // entry − stop, for R-based stop management
    trade.beMoved     = false;         // has the breakeven+ stop-raise happened yet?
    trade.sizePct     = POSITION_PCT;
    trade.signal      = signal;
    trade.tf          = buy.tf;          // entry timeframe (for swing-high exit)
    trade.tfMinutes   = tfMinutes;
    trade.openedAt    = Date.now();      // ms — used to detect a *fresh* swing high

    registerTrade(trade);            // persists to disk
    await postTradeOpened(channel, trade);
    await channel.send(`<@${BEAG()}> 🚨 New trade opened on **${symbol}** — \`!sell ${symbol}\` to close it (or \`!sell ${symbol} 50\` for half).`);
    return { traded: true };
  } catch (err) {
    console.error(`[STRATEGY] Execution failed for ${symbol}:`, err.message);
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
      if (Object.keys(candlesByTf).length === 0) { console.warn(`[SCAN] no data for ${asset.symbol}`); continue; }
      checked++;

      if (!buy) continue;   // no aligned fresh setup → stay silent

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
        console.log(`[SCAN] ${asset.symbol} buy not taken: ${res.reason}`);
      }

      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      console.error(`Error scanning ${asset.symbol}:`, error.message);
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
    const { biases, aligned, buy, candlesByTf } = await evaluateAsset(asset);
    if (Object.keys(candlesByTf).length === 0) { await channel.send(`⚠️ No data for **${upper}**.`); return; }

    const buffers = buildCharts(upper, candlesByTf);
    const b64 = buffers[0]?.buffer.toString("base64");
    if (b64) {
      state.lastChartBase64    = b64;
      state.lastChartMediaType = "image/png";
      saveChart(b64, "image/png");
    }

    await channel.send({
      content: summarize(upper, biases, aligned),
      files:   buffers.map(b => ({ attachment: b.buffer, name: `${upper}_${b.label}.png` }))
    });

    if (buy) {
      const res = await proposeBuy(upper, buy, channel);
      if (!res.traded) await channel.send(`ℹ️ **${upper}** setup not taken — ${res.reason}.`);
    } else {
      await channel.send(`No confirmed setup on **${upper}** right now (needs a fresh swing low with all 3 timeframes aligned).`);
    }
  } catch (err) {
    console.error(`[STRATEGY] scanSymbol error for ${upper}:`, err.message);
    await channel.send(`⚠️ Something went wrong: ${err.message}`);
  }
}
