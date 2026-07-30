/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, scanSymbol, fetchCandles, SCAN_INTERVALS } from "./scanner.js";
import { generateChartImage } from "./chart.js";
import { SWING_WINDOW, TP_R, MIN_STOP_PCT, MAX_STOP_PCT_BY_TF } from "./strategy.js";
import { backtestMultiTF, profileEntries, excursionProfile } from "./backtest.js";
import { loadCandles } from "./data.js";
import * as logger from './logger.js';
import { buildLiveContext, looksLikeCodeQuestion, readSource } from "./context.js";
import { loadChart, saveConfig, symbolToKrakenId, isOwner } from "./storage.js";
import { getCurrentPrice, placeSell, getHoldings } from "./trader.js";
import {
  haltManual, resumeManual, isTradingEnabled,
  getTrade, removeTrade, saveTradeState, postTradeClosed, getOpenTrades, reconcileHoldings
} from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

// Candles for research/backtests: deep local history from the store once a pair has been
// backfilled (data.js), else the live 720-candle pull kept politely paced. The live
// scanner still calls fetchCandles directly — only analysis/backtests read the store.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Human-readable date span for a candle series — run transparency (deep store vs live 720).
const spanOf = (c) => (c?.length ? `${new Date(parseInt(c[0].time) * 1000).toISOString().slice(0, 10)} → ${new Date(parseInt(c.at(-1).time) * 1000).toISOString().slice(0, 10)}` : "empty");
async function tfCandles(id) {
  const c1h = loadCandles(id, 60);
  if (c1h.length) return { c1h, c4h: loadCandles(id, 240), c1d: loadCandles(id, 1440) };
  const live1h = await fetchCandles(id, 60);   await sleep(900);
  const live4h = await fetchCandles(id, 240);  await sleep(900);
  const live1d = await fetchCandles(id, 1440);
  return { c1h: live1h, c4h: live4h, c1d: live1d };
}

const haveAll = (d) => d?.c1h?.length && d?.c4h?.length && d?.c1d?.length;

// Timeframe series for the backtester/profiler: ascending TFs, closed candles only.
const seriesOf = ({ c1h, c4h, c1d }) => [
  { label: "1h", mins: 60,   candles: c1h.slice(0, -1) },
  { label: "4h", mins: 240,  candles: c4h.slice(0, -1) },
  { label: "1d", mins: 1440, candles: c1d.slice(0, -1) },
];

// Live-strategy backtest config: anticipation entries, no alignment/trend gates,
// per-TF stop caps — mirrors scanner.js exactly. One entry TF per run; the live bot
// trades all three, so "live" results pool the three runs.
const LIVE_ENTRY_TFS = ["1h", "4h", "1d"];
const liveCfg = (tf) => ({
  entryTf: tf, entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, minStopPct: MIN_STOP_PCT, maxStopPct: MAX_STOP_PCT_BY_TF[tf], tpR: TP_R, lockBreakeven: true
});

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

    if (pct >= 100) {
      await postTradeClosed(message.channel, trade, sold.price, "manual");
      removeTrade(upper);
    } else {
      trade.volume -= sold.volume;   // actual executed volume, not the requested amount
      saveTradeState();
      await message.reply(`✅ Sold ${pct}% of **${upper}** at ~$${sold.price}. Remaining: ${trade.volume} ${upper}.`);
    }
  } catch (err) {
    logger.error(`[COMMAND] Sell failed for ${upper}:`, err.message);
    await message.reply(`⚠️ Failed to sell **${upper}**: ${err.message}`);
  }
}

// ─── !reconcile  (Kraken holdings vs cajh's tracked trades) ─────────────────────
export async function handleReconcile(message) {
  await message.reply("🔎 Reconciling Kraken holdings against cajh's tracked trades...");
  const res = await reconcileHoldings(message.channel);
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
    `Long-only spot. Anticipates swing-low confirmations on the 1h/4h/1d — buying the moment price crosses a candidate low's trigger — sizes by risk (0.5% per trade), rotates the most profitable position out at the cap, and self-manages exits by stop / take-profit.\n\n` +

    `**Positions:**\n` +
    `> \`!sell BTC\` — Close cajh's position in an asset\n` +
    `> \`!sell BTC 50\` — Sell part of it (percent)\n` +
    `> \`!port\` — Full Kraken portfolio + cajh P&L\n` +
    `> \`!stop\` — Halt new trades  ·  \`!resume\` — Re-enable\n\n` +

    `**Signals & scanning:**\n` +
    `> \`!scan\` — Scan the whole watchlist (auto-runs every 15 min)\n` +
    `> \`!trade BTC\` — Check one asset across all timeframes\n` +
    `> \`!backtest\` — Backtest the whole watchlist (pooled win rate / total R)\n` +
    `> \`!backtest BTC\` — Backtest a single asset\n` +
    `> \`!watchlist\` · \`!watch BTC ETH\` · \`!unwatch TAO\`\n\n` +

    `**Settings:**\n` +
    `> \`!setchannel\` — Set scan/alert channel\n` +
    `> \`!status\` — Bot status\n\n` +

    `**Extras (AI, no trades):**\n` +
    `> \`@cajh show me BTC 4h\`  ·  \`@cajh analyze that\`\n\n` +

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
const CHART_STOPWORDS = new Set(["show", "me", "a", "the", "chart", "charts", "for", "of", "please", "pull", "up", "cajh", "on", "send", "give", "get"]);

/**
 * `@cajh BTC` → posts all three (1h/4h/1d) charts. `@cajh BTC 4h` → just that one.
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
    `Your trading is mechanical: you anticipate swing-low confirmations on the 1h, 4h,\n` +
    `and 1d — buying when price crosses above a candidate low's trigger — size by risk\n` +
    `(0.5% of cash per trade), and exit on stop-loss / take-profit. Answer questions about yourself,\n` +
    `your live state, and your own code accurately and concisely. If you don't know, say so.\n\n` +
    buildLiveContext(state);

  if (looksLikeCodeQuestion(userMessage) && isOwner(message.author.id)) {
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
// Multi-timeframe backtest: anticipation entries per 1h/4h/1d timeframe (the live rule), pooled.

export async function handleBacktest(message, state, arg) {
  const symbol = (arg || "").trim().split(/\s+/)[0]?.toUpperCase();

  // No symbol → aggregate sweep of the whole watchlist (the number worth optimizing).
  if (!symbol) return backtestWatchlist(message, state);

  const id = (state.watchlist || []).find(a => a.symbol === symbol)?.id || symbolToKrakenId(symbol);
  await message.reply(`📈 Backtesting **${symbol}** — anticipation entries on 1h/4h/1d (N=${SWING_WINDOW}, live config)...`);

  try {
    const d = await tfCandles(id);
    if (!haveAll(d)) return message.reply(`⚠️ Couldn't fetch enough data for **${symbol}**.`);
    const series = seriesOf(d);

    const pooled = [];
    const lines = LIVE_ENTRY_TFS.map(tf => {
      const r = backtestMultiTF({ series }, liveCfg(tf));
      pooled.push(...(r.results || []));
      return `**${tf}** — ${r.trades}t · ${(r.winRate * 100).toFixed(0)}% · ${r.totalR.toFixed(1)}R (maxDD ${r.maxDrawdownR.toFixed(1)}R)`;
    });
    const n = pooled.length, wins = pooled.filter(x => x > 0).length;
    const totalR = pooled.reduce((a, b) => a + b, 0);

    await message.reply(
      `📊 **Backtest — ${symbol}** (anticipation entries per TF · ${d.c1h.length} 1h bars · ${spanOf(d.c1h)})\n\n` +
      lines.join("\n") + `\n\n` +
      `**Pooled:** ${n}t · ${n ? (wins / n * 100).toFixed(0) : 0}% · ${totalR.toFixed(1)}R · ${n ? (totalR / n).toFixed(2) : "0.00"}R/t\n\n` +
      `_Small samples mislead — judge on total R, not win rate alone. "R" = multiples of per-trade risk._`
    );
  } catch (err) {
    logger.error(`[COMMAND] Backtest failed for ${symbol}:`, err.message);
    await message.reply(`⚠️ Backtest failed: ${err.message}`);
  }
}

// Aggregate backtest across the whole watchlist — pools every trade into one win
// rate / total R. This is the figure to optimize (single pairs are too small a sample).
async function backtestWatchlist(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Your watchlist is empty — add assets with `!watch BTC ETH`.");

  await message.reply(`📈 Backtesting all **${watchlist.length}** watchlist assets (anticipation entries, 1h/4h/1d pooled)... give me a minute.`);

  const pooled = [];
  const lines  = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (!haveAll(d)) { lines.push(`**${asset.symbol}** — no data`); continue; }
      const series = seriesOf(d);

      const assetR = [];
      for (const tf of LIVE_ENTRY_TFS) {
        const r = backtestMultiTF({ series }, liveCfg(tf));
        assetR.push(...(r.results || []));
      }
      pooled.push(...assetR);
      const wins = assetR.filter(x => x > 0).length, tot = assetR.reduce((a, b) => a + b, 0);
      lines.push(`**${asset.symbol}** — ${assetR.length}t · ${assetR.length ? (wins / assetR.length * 100).toFixed(0) : 0}% · ${tot.toFixed(1)}R`);
    } catch (err) {
      logger.error(`[COMMAND] Backtest failed for ${asset.symbol}:`, err.message);
      lines.push(`**${asset.symbol}** — error`);
    }
  }

  const n      = pooled.length;
  const wins   = pooled.filter(r => r > 0).length;
  const totalR = pooled.reduce((a, b) => a + b, 0);

  await message.channel.send(
    `📊 **Aggregate Backtest — ${watchlist.length} assets**\n\n` +
    `**Total trades:** ${n}\n` +
    `**Win rate:** ${n ? (wins / n * 100).toFixed(0) : 0}%\n` +
    `**Total:** ${totalR.toFixed(1)}R   ·   **Avg:** ${n ? (totalR / n).toFixed(2) : 0}R/trade\n\n` +
    lines.join("\n") +
    `\n\n_This pooled total is the figure to optimize. Change ONE setting, re-run, and keep it only if total R rises (not just win rate)._`
  );
}

// ─── !optimize ──────────────────────────────────────────────────────────────
// Fee-aware parameter sweep across the whole watchlist. Fetches each pair's candles
// ONCE, then runs every config, pooling NET-of-fees R. Ranks by pooled net R and
// reports breadth (how many pairs are green) so we can tell a real edge from an outlier.
export async function handleOptimize(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty — add assets with `!watch BTC ETH`.");

  await message.reply(
    `🧪 Optimizing across **${watchlist.length}** assets — fetching candles once, then sweeping configs **net of fees**. ` +
    `This takes a minute or two.`
  );

  // 1) Fetch every pair's 3 timeframes once, cache them.
  const data = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (haveAll(d)) data.push({ symbol: asset.symbol, series: seriesOf(d) });
    } catch (err) {
      logger.error(`[OPTIMIZE] fetch failed ${asset.symbol}:`, err.message);
    }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  // 2) Config grid — all net-of-fees. Sweeps entry timeframe, entry mode (anticipation
  // vs confirmed BOS), gate mode, and TP, with the per-TF stop cap the live bot uses.
  const grid = [];
  for (const entryTf of ["1h", "4h", "1d"])
    for (const entryMode of ["anticipate", "bos"])
      for (const trendGate of [false, true])
        for (const tpR of [3, 4, 6])
          grid.push({
            entryTf, entryMode, tpR, trendGate, trendGateMode: "ma", trendMa: 20,
            alignMode: "none", minStopPct: 0.015, maxStopPct: MAX_STOP_PCT_BY_TF[entryTf],
            lockBreakeven: true
          });

  // 3) Run every config across the cached pairs, pooling NET results.
  const ranked = grid.map(cfg => {
    const pooled = [];
    let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ series: d.series }, cfg);
      pooled.push(...(r.results || []));
      if (r.totalR > 0) green++;
    }
    const n = pooled.length;
    const wins = pooled.filter(x => x > 0).length;
    const net = pooled.reduce((a, b) => a + b, 0);
    return { cfg, n, winRate: n ? wins / n : 0, net, green, pairs: data.length };
  }).sort((a, b) => b.net - a.net);

  // 4) Report. Rank configs that ACTUALLY TRADED by net R — a zero-trade config sits
  // at 0.0R and would otherwise outrank net-negative configs that traded, burying the
  // informative rows. Also show the most active configs (by trade count) so the
  // high-trade cases — the ones that decide the fee question — always print. The R/t
  // (net R per trade) figure is the fee-drag signal: ≈ −0.1 to −0.2R means fees are
  // the killer (maker orders could help); worse than that means no edge to rescue.
  const fmt = r =>
    `**${r.cfg.entryTf}/${r.cfg.entryMode}${r.cfg.trendGate ? "+gate" : ""}** · TP${r.cfg.tpR}` +
    ` → **${r.net.toFixed(1)}R** · ${r.n}t · ${r.n ? (r.net / r.n).toFixed(2) : "0.00"}R/t · ${(r.winRate * 100).toFixed(0)}% · ${r.green}/${r.pairs} grn`;

  const traded     = ranked.filter(r => r.n > 0);                       // already net-sorted
  const mostActive = [...ranked].sort((a, b) => b.n - a.n).slice(0, 5); // by trade count

  const byNet = traded.length
    ? traded.slice(0, 6).map((r, i) => `${i + 1}. ${fmt(r)}`).join("\n")
    : "_No config produced a single trade — every setup was rejected by the filters._";
  const active = mostActive.map(r => `• ${fmt(r)}`).join("\n");

  const best = traded[0] || null;
  let verdict;
  if (!best) {
    verdict = `⚠️ **Zero trades in the whole grid.** The filters rejected every setup across all ${data.length} pairs — ` +
      `correct behavior when nothing is trending up. This is a read on the regime, not the strategy. Re-run when the market ` +
      `is actually trending and see if trades and breadth appear.`;
  } else if (best.net > 0 && best.green >= Math.ceil(best.pairs * 0.3) && best.n >= 10) {
    verdict = `Best traded config is net-positive with real breadth (${best.green}/${best.pairs}) — **a hypothesis to test on ` +
      `fresh data**, not a result. Check the R/t: near zero or mildly negative means maker orders could tip it positive.`;
  } else {
    verdict = `⚠️ **No real edge in this window.** The configs that traded are net-negative or rest on a handful of trades ` +
      `(low breadth, tiny samples). Read the **R/t** on the active configs: ≈ −0.1 to −0.2R (the fee drag) with decent breadth ` +
      `means maker orders are worth building. Worse than that, or near-zero breadth, means fees aren't the killer — the regime ` +
      `is — and cheaper fills won't manufacture an edge.`;
  }

  await message.channel.send(
    `🧪 **Optimizer — ${data.length} assets, ${grid.length} configs (net of fees)**\n\n` +
    `__Best by net R (configs that traded):__\n${byNet}\n\n` +
    `__Most active (decides the fee question):__\n${active}\n\n` +
    verdict
  );
}


// ─── !exits ─────────────────────────────────────────────────────────────────
// Exit-model sweep — the roadmap's "%-based exit model" test, and the most likely
// place a real edge is being thrown away. The entry stays fixed (live anticipation
// rule, all 3 TFs pooled); only the EXIT changes. Learn on everything up to the split,
// then score the winner on a genuinely sealed holdout: Q1 2026 was not on this machine
// until it was ingested today, so no earlier sweep could have peeked at it.
const EXIT_SPLIT_TS = Date.UTC(2026, 0, 1) / 1000;   // 2026-01-01: train < split ≤ test

const EXIT_MODELS = [
  ["live: TP4 + BE-lock",   { tpR: 4, lockBreakeven: true }],
  ["TP4, no BE",            { tpR: 4, lockBreakeven: false }],
  ["TP2, no BE",            { tpR: 2, lockBreakeven: false }],
  ["TP3, no BE",            { tpR: 3, lockBreakeven: false }],
  ["TP6, no BE",            { tpR: 6, lockBreakeven: false }],
  ["TP1.5, no BE",          { tpR: 1.5, lockBreakeven: false }],
  ["trail 1R after 1R",     { tpR: 99, lockBreakeven: false, trailR: 1, trailStartR: 1 }],
  ["trail 2R after 2R",     { tpR: 99, lockBreakeven: false, trailR: 2, trailStartR: 2 }],
  ["trail 1.5R after 2R",   { tpR: 99, lockBreakeven: false, trailR: 1.5, trailStartR: 2 }],
  ["half@1R + run to 4R",   { tpR: 4, lockBreakeven: false, partialAtR: 1, partialFrac: 0.5 }],
  ["half@2R + run to 6R",   { tpR: 6, lockBreakeven: false, partialAtR: 2, partialFrac: 0.5 }],
  ["half@1R + trail 1R",    { tpR: 99, lockBreakeven: false, partialAtR: 1, partialFrac: 0.5, trailR: 1, trailStartR: 1 }],
];

// Slice a timeframe series to a time window (seconds, [from, to)).
const sliceSeries = (series, from, to) => series.map(s => ({
  ...s, candles: s.candles.filter(c => { const t = parseInt(c.time); return t >= from && t < to; })
}));

export async function handleExits(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(
    `🚪 **Exit-model sweep** across **${watchlist.length}** assets — entry rule fixed (live anticipation, 1h/4h/1d pooled), ` +
    `only the exit changes. Train before 2026-01-01, then score on the sealed Q1-2026 holdout. Few minutes…`
  );

  // Load each pair's series ONCE (resampling the 1m store is the expensive part).
  const data = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (haveAll(d)) data.push({ symbol: asset.symbol, series: seriesOf(d) });
    } catch (err) { logger.error(`[EXITS] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't load data for any pair.");

  // Only pairs with real data in BOTH windows may take part, or the comparison is not
  // like-for-like: several pairs were first ingested from the Q1-2026 archive and have
  // no earlier history, so they would silently load the holdout with symbols the
  // training set never saw.
  const INF_TS = 4102444800; // 2100-01-01 — "no upper bound"
  const enough = (series, from, to) => sliceSeries(series, from, to).every(s => s.candles.length >= 60);
  const eligible = data.filter(d => enough(d.series, 0, EXIT_SPLIT_TS) && enough(d.series, EXIT_SPLIT_TS, INF_TS));
  const excluded = data.filter(d => !eligible.includes(d)).map(d => d.symbol);
  if (!eligible.length) return message.channel.send("⚠️ No pair has usable data in both the training and holdout windows.");

  const run = (cfgExtra, from, to) => {
    const pooled = []; let green = 0, pairs = 0; const exits = {};
    for (const d of eligible) {
      const series = sliceSeries(d.series, from, to);
      pairs++;
      let pairR = 0;
      for (const tf of LIVE_ENTRY_TFS) {
        const r = backtestMultiTF({ series }, { ...liveCfg(tf), ...cfgExtra });
        pooled.push(...(r.results || []));
        pairR += r.totalR;
        for (const [k, v] of Object.entries(r.exits || {})) exits[k] = (exits[k] || 0) + v;
      }
      if (pairR > 0) green++;
    }
    const n = pooled.length, wins = pooled.filter(x => x > 0).length;
    const net = pooled.reduce((a, b) => a + b, 0);
    let eq = 0, peak = 0, maxDD = 0;
    for (const r of pooled) { eq += r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }
    return { n, net, rpt: n ? net / n : 0, winRate: n ? wins / n : 0, green, pairs, maxDD, exits };
  };

  const rows = EXIT_MODELS.map(([label, cfg]) => ({
    label, cfg,
    is:  run(cfg, 0, EXIT_SPLIT_TS),
    oos: run(cfg, EXIT_SPLIT_TS, INF_TS),
  }));

  // ── The decisive diagnostic ──
  // Re-run the best exits with the cost switched off. Net = gross − costs, and costs are
  // known exactly, so this separates the two possible worlds:
  //   gross ≈ 0 or below  → the ENTRY has no predictive power; no fee tier can rescue it.
  //   gross clearly > 0   → the entry does predict, and only costs are eating it, which
  //                         makes maker/limit fills a real (buildable) lever.
  // Maker rate reflects a limit-only fill at Kraken's low-volume maker tier.
  const FEE_TIERS = [
    ["gross (no costs)", { feeRate: 0,      slipPct: 0 }],
    ["maker 0.16%",      { feeRate: 0.0016, slipPct: 0.0002 }],
    ["taker 0.40%",      {}],   // the live assumption
  ];
  const probeModels = [EXIT_MODELS[0], ...[...rows].filter(r => r.is.n >= 50).sort((a, b) => b.is.rpt - a.is.rpt).slice(0, 1).map(r => [r.label, r.cfg])];
  const feeLines = probeModels.map(([label, cfg]) => {
    const cells = FEE_TIERS.map(([tier, fees]) => {
      const e = run({ ...cfg, ...fees }, 0, EXIT_SPLIT_TS);
      return `${tier}: **${e.rpt >= 0 ? "+" : ""}${e.rpt.toFixed(3)}**R/t`;
    });
    return `• **${label}** — ${cells.join("  ·  ")}`;
  });

  const fmt = (e) => `${e.n}t · ${e.net.toFixed(0)}R · **${e.rpt.toFixed(3)}**R/t · ${(e.winRate * 100).toFixed(0)}% · ${e.green}/${e.pairs}grn`;
  const lines = rows.map(r => `• **${r.label}**\n    train ${fmt(r.is)}\n    hold  ${fmt(r.oos)}`);

  const traded   = rows.filter(r => r.is.n >= 50);
  const bestIS   = [...traded].sort((a, b) => b.is.rpt - a.is.rpt)[0];
  const bestOOS  = [...rows.filter(r => r.oos.n >= 30)].sort((a, b) => b.oos.rpt - a.oos.rpt)[0];
  const live     = rows[0];

  let verdict;
  if (!bestIS) {
    verdict = `⚠️ No exit model produced a usable training sample — nothing to compare.`;
  } else if (bestIS.is.rpt > 0 && bestIS.oos.rpt > 0) {
    verdict = `🟢 **${bestIS.label}** is the best exit in training (${bestIS.is.rpt.toFixed(3)}R/t) **and stays positive on the sealed holdout** ` +
      `(${bestIS.oos.rpt.toFixed(3)}R/t, ${bestIS.oos.green}/${bestIS.oos.pairs} pairs green). That is the first genuinely encouraging result this project has produced — ` +
      `but one holdout quarter is one regime. Paper-trade it before risking size.`;
  } else if (bestIS.is.rpt > 0) {
    verdict = `🟡 **${bestIS.label}** leads in training (${bestIS.is.rpt.toFixed(3)}R/t) but does **not** hold on the sealed Q1-2026 quarter ` +
      `(${bestIS.oos.rpt.toFixed(3)}R/t). That is what in-sample tuning looks like when the holdout is honest — the exit is not the missing piece.`;
  } else {
    verdict = `🔴 **Every exit model is net-negative in training.** Best is ${bestIS.label} at ${bestIS.is.rpt.toFixed(3)}R/t vs live ${live.is.rpt.toFixed(3)}R/t. ` +
      `Changing the exit reshuffles the loss; it does not create an edge. The problem is upstream — the ENTRY has no predictive power, ` +
      `so no exit rule can rescue it. Cheaper fills or a different entry are the only levers left.`;
  }

  const bestNote = bestOOS
    ? `\nBest on the holdout alone: **${bestOOS.label}** (${bestOOS.oos.rpt.toFixed(3)}R/t) — noted, not trusted; picking the holdout winner *is* overfitting the holdout.`
    : "";

  await message.channel.send(
    `🚪 **Exit-model sweep — ${eligible.length} assets, ${EXIT_MODELS.length} exits** (net of fees, entry rule unchanged)\n` +
    `Train: history → 2025-12-31 · Holdout: Q1 2026 (sealed — ingested today)` +
    (excluded.length ? `\n_Excluded (no history in both windows): ${excluded.join(", ")}_` : "") + `\n\n` +
    lines.join("\n") + `\n\n` +
    `**Cost sensitivity — is there an edge underneath the fees?** (training window)\n` +
    feeLines.join("\n") + `\n\n` + verdict + bestNote
  );
}

// ─── !excursion ─────────────────────────────────────────────────────────────
// "Are the stops too tight?" — measured, not argued.
//
// For every live-rule entry this reports how far price ran AGAINST it before running
// FOR it (MAE) and how far it ran in favour (MFE), in ATRs so every asset is on one
// scale — that is the "expected size of a move" for each asset, volatility-adjusted.
// Then a first-passage grid asks, for each stop k·ATR and target m·ATR, which is hit
// first, and reports expectancy GROSS as well as net. Gross is the honest arbiter: if
// a wider stop is genuinely the fix, some cell must show positive gross expectancy.
export async function handleExcursion(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(
    `📐 **Excursion + stop/target grid** across **${watchlist.length}** assets — measuring how far trades go against ` +
    `before they go for, in ATRs, then testing every stop×target combination. A few minutes…`
  );

  const perTf = {};   // tf → { agg fields }
  const gridAcc = {}; // tf → key(k,m) → cell
  const push = (tf, r) => {
    if (!r?.n) return;
    const a = perTf[tf] ??= { n: 0, atrPct: [], struct: [], mae: [], mfe: [], runnerShare: [], maeRunners: [] };
    a.n += r.n;
    a.atrPct.push(r.atrPctMean); a.struct.push(r.structStopATR.p50);
    a.mae.push(r.mae.p50); a.mfe.push(r.mfe.p50);
    a.maeRunners.push(r.maeOfRunners.p75); a.runnerShare.push(r.runnerShare);
    const g = gridAcc[tf] ??= {};
    for (const c of r.grid) {
      const key = `${c.k}|${c.m}`;
      const cell = g[key] ??= { k: c.k, m: c.m, wins: 0, losses: 0, open: 0, gross: 0, net: 0 };
      cell.wins += c.wins; cell.losses += c.losses; cell.open += c.open; cell.gross += c.gross; cell.net += c.net;
    }
  };

  const holdAcc = {};   // same grid, computed only on the sealed Q1-2026 window
  const pushHold = (tf, r) => {
    if (!r?.n) return;
    const g = holdAcc[tf] ??= {};
    for (const c of r.grid) {
      const key = `${c.k}|${c.m}`;
      const cell = g[key] ??= { k: c.k, m: c.m, wins: 0, losses: 0, open: 0, gross: 0, net: 0 };
      cell.wins += c.wins; cell.losses += c.losses; cell.open += c.open; cell.gross += c.gross; cell.net += c.net;
    }
  };

  let used = 0;
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (!haveAll(d)) continue;
      const series = seriesOf(d);
      const train = sliceSeries(series, 0, EXIT_SPLIT_TS);
      const hold  = sliceSeries(series, EXIT_SPLIT_TS, 4102444800);
      for (const tf of LIVE_ENTRY_TFS) {
        push(tf, excursionProfile({ series: train }, { entryTf: tf }));
        pushHold(tf, excursionProfile({ series: hold }, { entryTf: tf }));
      }
      used++;
    } catch (err) { logger.error(`[EXCURSION] ${asset.symbol}:`, err.message); }
  }
  if (!used) return message.channel.send("⚠️ Couldn't load data for any pair.");

  const avg = (a) => a.filter(x => x != null).reduce((s, x, _, arr) => s + x / arr.length, 0);
  const shape = LIVE_ENTRY_TFS.filter(tf => perTf[tf]).map(tf => {
    const a = perTf[tf];
    return `**${tf}** (${a.n} entries) · ATR ${avg(a.atrPct).toFixed(2)}% of price · swing-low stop sits **${avg(a.struct).toFixed(2)} ATR** below entry\n` +
           `    typical adverse move ${avg(a.mae).toFixed(2)} ATR · typical favourable move ${avg(a.mfe).toFixed(2)} ATR\n` +
           `    of trades that eventually ran 2+ ATR (${(avg(a.runnerShare) * 100).toFixed(0)}% of all), 75% first dipped ≤ **${avg(a.maeRunners).toFixed(2)} ATR**`;
  });

  // Best cells by GROSS expectancy per trade — the test of whether stop placement is the fix.
  const gridLines = LIVE_ENTRY_TFS.filter(tf => gridAcc[tf]).map(tf => {
    const cells = Object.values(gridAcc[tf]).map(c => {
      const n = c.wins + c.losses + c.open;
      return { ...c, n, grossPt: n ? c.gross / n : 0, netPt: n ? c.net / n : 0, wr: n ? c.wins / n : 0 };
    }).filter(c => c.n >= 100);
    if (!cells.length) return `**${tf}** — too few entries to grid.`;
    const best = [...cells].sort((a, b) => b.grossPt - a.grossPt).slice(0, 3);
    const bestNet = [...cells].sort((a, b) => b.netPt - a.netPt)[0];
    const positive = cells.filter(c => c.grossPt > 0).length;
    return `**${tf}** — ${cells.length} stop×target cells, **${positive}** with positive GROSS expectancy\n` +
      best.map(c => `    stop ${c.k}·ATR → target ${c.m}·ATR: gross ${c.grossPt >= 0 ? "+" : ""}${c.grossPt.toFixed(3)}R · net ${c.netPt >= 0 ? "+" : ""}${c.netPt.toFixed(3)}R · ${(c.wr * 100).toFixed(0)}% · ${c.n}t`).join("\n") +
      `\n    best NET cell: stop ${bestNet.k}·ATR → target ${bestNet.m}·ATR = ${bestNet.netPt >= 0 ? "+" : ""}${bestNet.netPt.toFixed(3)}R/t`;
  });

  const allCells = LIVE_ENTRY_TFS.flatMap(tf => Object.values(gridAcc[tf] || {}).map(c => {
    const n = c.wins + c.losses + c.open; return { tf, ...c, n, grossPt: n ? c.gross / n : 0, netPt: n ? c.net / n : 0 };
  })).filter(c => c.n >= 100);
  const posGross = allCells.filter(c => c.grossPt > 0);
  const posNet   = allCells.filter(c => c.netPt > 0);
  const bestAny  = [...allCells].sort((a, b) => b.grossPt - a.grossPt)[0];

  // The best cell is the maximum of ~126 correlated in-sample statistics, so it is
  // biased upward by selection alone. The only meaningful question is whether that same
  // cell still works on the sealed window, so look it up there rather than re-picking.
  const bestNetCell = [...allCells].sort((a, b) => b.netPt - a.netPt)[0];
  let holdOfBest = null;
  if (bestNetCell) {
    const hc = (holdAcc[bestNetCell.tf] || {})[`${bestNetCell.k}|${bestNetCell.m}`];
    if (hc) { const hn = hc.wins + hc.losses + hc.open; holdOfBest = { n: hn, netPt: hn ? hc.net / hn : 0, grossPt: hn ? hc.gross / hn : 0 }; }
  }
  const holdLine = bestNetCell
    ? `

__Sealed-holdout check of the best training cell__ (${bestNetCell.tf} stop ${bestNetCell.k}·ATR → target ${bestNetCell.m}·ATR, train ${bestNetCell.netPt >= 0 ? "+" : ""}${bestNetCell.netPt.toFixed(3)}R/t):
` +
      (holdOfBest && holdOfBest.n >= 30
        ? `    Q1-2026: **${holdOfBest.netPt >= 0 ? "+" : ""}${holdOfBest.netPt.toFixed(3)}R/t net** (gross ${holdOfBest.grossPt >= 0 ? "+" : ""}${holdOfBest.grossPt.toFixed(3)}) over ${holdOfBest.n} trades`
        : `    too few holdout trades (${holdOfBest?.n ?? 0}) to judge`)
    : "";

  let verdict;
  if (!allCells.length) {
    verdict = `⚠️ Not enough entries to judge stop placement.`;
  } else if (posNet.length && holdOfBest && holdOfBest.n >= 30 && holdOfBest.netPt > 0) {
    verdict = `🟢 **${posNet.length} of ${allCells.length} combinations are net-positive in training, and the best one HOLDS on the sealed window** ` +
      `(${holdOfBest.netPt.toFixed(3)}R/t on ${holdOfBest.n} unseen trades). That is worth pursuing — widen the grid around ` +
      `${bestNetCell.tf} stop ${bestNetCell.k}·ATR / target ${bestNetCell.m}·ATR and paper-trade before sizing.`;
  } else if (posNet.length) {
    verdict = `🟡 **${posNet.length} of ${allCells.length} combinations are net-positive in training, but the best one does NOT hold on the sealed window.** ` +
      `Picking the top of ~${allCells.length} correlated cells is itself a selection effect — a handful landing just above zero in-sample is what ` +
      `chance produces. Note the direction, though: every survivor uses the TIGHTEST stop with the FARTHEST target (a lottery-ticket payoff, ~10% win rate), ` +
      `not the wider stop the "stopped out too early" theory predicts.`;
  } else if (posGross.length) {
    verdict = `🟡 **${posGross.length} of ${allCells.length} combinations are positive GROSS but none survive costs.** ` +
      `Best gross: ${bestAny.tf} stop ${bestAny.k}·ATR → target ${bestAny.m}·ATR at ${bestAny.grossPt >= 0 ? "+" : ""}${bestAny.grossPt.toFixed(3)}R/t. ` +
      `A wider stop helps, but not by enough to clear ~0.9% round-trip — this is where cheaper (maker) fills would finally matter.`;
  } else {
    verdict = `🔴 **Not one of the ${allCells.length} stop×target combinations has positive gross expectancy.** ` +
      `Widening the stop does not rescue the entry: with a wider stop each loss is bigger, so the R-scale moves but the edge does not appear. ` +
      `That is the signature of entries whose forward returns are a coin flip — the level to fix is the ENTRY, not the stop.`;
  }

  await message.channel.send(
    `📐 **Excursion analysis — ${used} assets** (live anticipation entries, ATR-normalised)\n\n` +
    `__Move sizes (what the asset actually does after an entry):__\n${shape.join("\n")}\n\n` +
    `__Stop × target grid (first passage, ${"" }gross vs net):__\n${gridLines.join("\n")}\n\n` + verdict
  );
}

// ─── !why [symbol] ──────────────────────────────────────────────────────────
// Diagnostic: replays the strategy over history with the CURRENT live config and
// tallies WHY each candidate swing low was taken or rejected (which gate killed it).
// Turns the silent cron rejections into a visible breakdown so we can see exactly
// where trades are being lost — instead of guessing from charts.
export async function handleWhy(message, state, symbol) {
  const watchlist = state.watchlist || [];
  const targets = symbol
    ? watchlist.filter(a => a.symbol.toUpperCase() === symbol.toUpperCase())
    : watchlist;
  if (!targets.length) return message.reply(symbol ? `**${symbol}** isn't on your watchlist.` : "Watchlist is empty.");

  await message.reply(
    `🔍 Replaying ${targets.length === 1 ? `**${targets[0].symbol}**` : `**${targets.length}** assets`} ` +
    `to see why setups were taken or skipped (current live config)…`
  );

  const agg = {};
  for (const asset of targets) {
    try {
      const d = await tfCandles(asset.id);
      if (!haveAll(d)) continue;
      const series = seriesOf(d);
      for (const tf of LIVE_ENTRY_TFS) {
        const r = backtestMultiTF({ series }, liveCfg(tf));
        for (const [k, v] of Object.entries(r.reasons || {})) agg[k] = (agg[k] || 0) + v;
      }
    } catch (err) { logger.error(`[WHY] ${asset.symbol}:`, err.message); }
  }

  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  if (!total) return message.channel.send("No candidate swing lows found in the data.");

  const label = {
    taken: "✅ taken", stopTooTight: "❌ stop too tight (below floor)", stopTooFar: "❌ stop too far (above cap)",
    trendGate: "❌ trend gate (4h not trending up)", notAligned: "❌ 1h/4h not aligned",
    notHigherLow: "❌ not a higher low", priceBelowStop: "❌ price already below stop",
    noRoom: "❌ no room to the next resistance"
  };
  const order = ["taken", "stopTooTight", "stopTooFar", "trendGate", "notAligned", "notHigherLow", "noRoom", "priceBelowStop"];
  const lines = order.filter(k => agg[k]).map(k => `${label[k]}: **${agg[k]}** (${(agg[k] / total * 100).toFixed(0)}%)`);

  await message.channel.send(
    `🔍 **Why setups were taken / skipped — ${targets.length} asset(s)**\n` +
    `Candidate swing lows found: **${total}**\n\n` +
    lines.join("\n") +
    `\n\n_The biggest ❌ bucket is the gate costing you the most setups. "stop too tight" dominating = the fee floor is ` +
    `killing fast bounces; "trend gate" dominating = the 4h filter is too strict for this regime._`
  );
}


// ─── !align ─────────────────────────────────────────────────────────────────
// Focused sweep: holds a gated base config (1h / ma gate / min1.5 / TP4) and
// tries the four alignment rules, so we can see which one actually trades
// net-positive instead of rejecting 85% of setups. Net of fees, with breadth.
export async function handleAlign(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`⚖️ Testing 4 alignment rules across **${watchlist.length}** assets on the live base config (net of fees)…`);

  const data = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (haveAll(d)) data.push({ series: seriesOf(d) });
    } catch (err) { logger.error(`[ALIGN] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  const base = { entryTf: "1h", trendGate: true, trendGateMode: "ma", minStopPct: 0.015, maxStopPct: MAX_STOP_PCT_BY_TF["1h"], tpR: 4, lockBreakeven: true };
  const modes = [
    ["all",     "all 3 TFs bull (current)"],
    ["first",   "1h only"],
    ["notbear", "higher TFs not bearish"],
    ["none",    "entry TF only"],
  ];
  const rows = modes.map(([alignMode, label]) => {
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ series: d.series }, { ...base, alignMode });
      pooled.push(...(r.results || []));
      if (r.totalR > 0) green++;
    }
    const n = pooled.length, wins = pooled.filter(x => x > 0).length;
    const net = pooled.reduce((a, b) => a + b, 0);
    return { label, n, net, winRate: n ? wins / n : 0, green, pairs: data.length };
  });

  const fmt = r => `**${r.label}** → ${r.n}t · **${r.net.toFixed(1)}R** · ${r.n ? (r.net / r.n).toFixed(2) : "0.00"}R/t · ${(r.winRate * 100).toFixed(0)}% · ${r.green}/${r.pairs} grn`;
  const best = [...rows].filter(r => r.n > 0).sort((a, b) => b.net - a.net)[0];

  await message.channel.send(
    `⚖️ **Alignment sweep — ${data.length} assets (net of fees)**\nBase: 1h · ma gate · min1.5 · TP4\n\n` +
    rows.map(r => `• ${fmt(r)}`).join("\n") + `\n\n` +
    (best
      ? `Most net-positive: **${best.label}** (${best.net.toFixed(1)}R, ${best.green}/${best.pairs} pairs). Read **breadth**, not just the total — ` +
        `and watch **R/t**: a looser rule only wins if per-trade R stays healthy, because more trades means more fee exposure.`
      : `⚠️ Every alignment rule is net-negative or never trades. Loosening alignment isn't the unlock — the problem is deeper ` +
        `(stop placement, or the trend gate). We test that next.`)
  );
}


// ─── !room ──────────────────────────────────────────────────────────────────
// Focused sweep: holds the loosened base (1h / ma gate / alignment off /
// min1.5 / TP4) and requires increasing "room" — clear air from entry up to the
// nearest 4h resistance, in R — to see whether cutting into-the-ceiling trades
// lifts R/t. Net of fees, with breadth.
export async function handleRoom(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`📏 Testing resistance-room thresholds across **${watchlist.length}** assets (alignment off base, net of fees)…`);

  const data = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (haveAll(d)) data.push({ series: seriesOf(d) });
    } catch (err) { logger.error(`[ROOM] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  const base = { entryTf: "1h", trendGate: true, trendGateMode: "ma", alignMode: "none", minStopPct: 0.015, maxStopPct: MAX_STOP_PCT_BY_TF["1h"], tpR: 4, lockBreakeven: true };
  const rows = [0, 1, 2, 3, 4].map(minRoomR => {
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ series: d.series }, { ...base, minRoomR });
      pooled.push(...(r.results || []));
      if (r.totalR > 0) green++;
    }
    const n = pooled.length, wins = pooled.filter(x => x > 0).length;
    const net = pooled.reduce((a, b) => a + b, 0);
    return { minRoomR, n, net, winRate: n ? wins / n : 0, green, pairs: data.length };
  });

  const fmt = r => `**${r.minRoomR}R room** → ${r.n}t · **${r.net.toFixed(1)}R** · ${r.n ? (r.net / r.n).toFixed(2) : "0.00"}R/t · ${(r.winRate * 100).toFixed(0)}% · ${r.green}/${r.pairs} grn`;
  const traded = rows.filter(r => r.n > 0);
  const best = traded.length ? [...traded].sort((a, b) => (b.net / b.n) - (a.net / a.n))[0] : null;

  await message.channel.send(
    `📏 **Resistance-room sweep — ${data.length} assets (net of fees)**\nBase: 1h · ma gate · alignment off · min1.5 · TP4\n\n` +
    rows.map(r => `• ${fmt(r)}`).join("\n") + `\n\n` +
    (best && best.minRoomR > 0 && best.n >= 5
      ? `Best R/t at **${best.minRoomR}R room** (${(best.net / best.n).toFixed(2)}R/t, ${best.green}/${best.pairs} pairs). ` +
        `If R/t climbs with room while trades stay ≥ a handful, the filter is cutting the into-the-ceiling losers — real signal.`
      : `Room requirement doesn't lift R/t here, or shrinks trades below a usable sample. On this trendless window that's expected — ` +
        `the filter can only remove trades, and there aren't many to begin with.`)
  );
}


// ─── !modes ─────────────────────────────────────────────────────────────────
// Compares the four entry engines head-to-head across the watchlist, net of fees:
// BOS (trend), support-bounce, MA-dip, and RSI-oversold. The long dip-buy modes run
// with NO trend gate and tight structural stops + ambitious targets — the test of
// whether a long edge exists in this regime even at taker fees.
// ─── !profile ───────────────────────────────────────────────────────────────
// The data-speaks engine. Walks every long candidate across the watchlist, splits
// them into winners (hit target) and losers (hit stop), and shows what each group
// looked like at entry. Where the two columns diverge is a candidate edge — where
// they match is a mirage. Honest by construction: an edge can't hide, and a fluke
// can't masquerade, because the losers are right there in the comparison.
// ─── !discover ──────────────────────────────────────────────────────────────
// Data-driven strategy search. Samples a WIDE pair universe, lets every long
// candidate describe itself, then searches simple interpretable rules — keeping
// only those that beat the no-filter baseline OUT-OF-SAMPLE across 3 time splits.
// Then it shuffles outcomes and re-runs to measure how many "survivors" pure
// chance produces, so we can tell a real edge from data-mining noise.
const DISCOVER_UNIVERSE = [
  "BTC","ETH","SOL","XRP","ADA","DOGE","AVAX","LINK","LTC","DOT",
  "UNI","ATOM","POL","NEAR","FIL","APT","INJ","TAO","TIA","SUI",
  "BCH","AAVE","ALGO","XLM","ETC","GRT","CRV","SNX","ICP",
  "IMX","ARB","OP","SEI","RUNE","KSM","FLOW","SAND","MANA",
];

export async function handleDiscover(message, state) {
  await message.reply(`🔭 Discovery run — sampling up to **${DISCOVER_UNIVERSE.length}** assets, then searching rules with an out-of-sample skeptic + chance baseline. This takes a few minutes…`);

  const { c4h: btcRaw } = await tfCandles(symbolToKrakenId("BTC"));
  const btc4h = btcRaw?.slice(0, -1);
  const all = [];
  const bySym = new Map();   // sym → record count, to surface sample imbalance (deep store vs 720-candle live)
  let fetched = 0;
  for (const sym of DISCOVER_UNIVERSE) {
    try {
      const id = symbolToKrakenId(sym);
      const d = await tfCandles(id);
      if (!haveAll(d)) continue;
      logger.info(`[DISCOVER] ${sym}: ${d.c1h.length} 1h candles · ${spanOf(d.c1h)}`);
      const { records } = profileEntries({ series: seriesOf(d), btc4h }, { tpR: 4 });
      all.push(...records);
      if (records.length) bySym.set(sym, records.length);
      fetched++;
    } catch (err) { logger.error(`[DISCOVER] ${sym}:`, err.message); }
  }
  if (all.length < 100) return message.channel.send(`Only ${all.length} candidates from ${fetched} assets — too few to search reliably.`);

  // Regime split: is the pool's result uniform, or hiding an edge in one BTC regime? (btcBias4h)
  const regimeOf = (r) => (r.btcBias4h === "bull" ? "bull" : r.btcBias4h === "bear" ? "bear" : "flat");
  const regimeLine = ["bull", "bear", "flat"].map((g) => {
    const s = all.filter((r) => regimeOf(r) === g);
    if (!s.length) return `${g}: —`;
    const rpt = s.reduce((a, b) => a + b.netR, 0) / s.length;
    return `${g}: ${rpt >= 0 ? "+" : ""}${rpt.toFixed(2)}R/t (n=${s.length})`;
  }).join("  ·  ");

  const rules = [
    ["room > 1R",          r => r.roomR == null || r.roomR > 1],
    ["room > 2R",          r => r.roomR == null || r.roomR > 2],
    ["room > 3R",          r => r.roomR == null || r.roomR > 3],
    ["RSI < 30",           r => r.rsi != null && r.rsi < 30],
    ["RSI < 40",           r => r.rsi != null && r.rsi < 40],
    ["RSI > 60",           r => r.rsi != null && r.rsi > 60],
    ["dip >2% below MA",   r => r.maDistPct != null && r.maDistPct < -2],
    ["above MA",           r => r.maDistPct != null && r.maDistPct > 0],
    ["range pos < 0.3",    r => r.rangePos != null && r.rangePos < 0.3],
    ["range pos > 0.5",    r => r.rangePos != null && r.rangePos > 0.5],
    ["higher low",         r => r.higherLow === true],
    ["lower low",          r => r.higherLow === false],
    // Stop-size split inside the tradeable band (profileEntries already gates to 1.5–3%,
    // so a "< 1%" rule can never select anything).
    ["stop < 2%",          r => r.stopPct != null && r.stopPct < 2],
    ["stop > 2%",          r => r.stopPct != null && r.stopPct > 2],
    ["4h bull",            r => r.biasMid === "bull"],
    ["4h not bull",        r => r.biasMid !== "bull"],
    ["1d bull",            r => r.biasHigh === "bull"],
    ["volume > 1.5x avg",  r => r.volRatio != null && r.volRatio > 1.5],
    ["ATR < 1% (low vol)", r => r.atrPct != null && r.atrPct < 1],
    ["ATR > 2% (high vol)",r => r.atrPct != null && r.atrPct > 2],
    ["displacement > 1.5", r => r.displacement != null && r.displacement > 1.5],
    ["swept a low",        r => r.swept === true],
    ["into bullish FVG",   r => r.fvg === true],
    ["near prev-day low",  r => r.pdlDistPct != null && r.pdlDistPct < 1],
    ["clear of PDH >1%",   r => r.pdhDistPct != null && r.pdhDistPct > 1],
    ["BTC 4h bull",        r => r.btcBias4h === "bull"],
    ["BTC 4h not bull",    r => r.btcBias4h != null && r.btcBias4h !== "bull"],
    ["BTC ripping >3%/24h", r => r.btc4hRetPct != null && r.btc4hRetPct > 3],
    ["BTC bleeding <-3%/24h", r => r.btc4hRetPct != null && r.btc4hRetPct < -3],
    // Curated feature combinations — where edge tends to hide. Kept to a small set so BH-FDR
    // stays resolvable (exhaustive pairwise would explode the multiple-testing count).
    ["swept low + BTC bull", r => r.swept === true && r.btcBias4h === "bull"],
    ["swept low + FVG",      r => r.swept === true && r.fvg === true],
    ["room>2R + BTC bull",   r => r.roomR != null && r.roomR > 2 && r.btcBias4h === "bull"],
    ["displaced + BTC bull", r => r.displacement != null && r.displacement > 1.5 && r.btcBias4h === "bull"],
    ["near PDL + swept low", r => r.pdlDistPct != null && r.pdlDistPct < 1 && r.swept === true],
    ["FVG + higher low",     r => r.fvg === true && r.higherLow === true],
  ];

  const times = all.map(r => r.t).sort((a, b) => a - b);
  const oosSets = [0.5, 0.6, 0.7].map(f => times[Math.floor(times.length * f)]).map(st => all.filter(r => r.t > st));

  // Per-rule statistic: how much the rule's OOS R/t beats take-everything, averaged
  // across the 3 split windows (baseline-independent). Real edge → reliably positive;
  // non-predictive rule → ~0.
  const statFor = (pred, netOf) => {
    let sum = 0, valid = 0;
    for (const oos of oosSets) {
      const sel = oos.filter(pred);
      if (sel.length < 10) continue;
      const base = oos.reduce((a, b) => a + netOf(b), 0) / oos.length;
      const rpt  = sel.reduce((a, b) => a + netOf(b), 0) / sel.length;
      sum += (rpt - base); valid++;
    }
    return valid >= 2 ? sum / valid : null;
  };

  const oos6 = oosSets[1];
  const base6 = oos6.reduce((a, b) => a + b.netR, 0) / (oos6.length || 1);
  const rptOf = pred => { const s = oos6.filter(pred); return s.length ? s.reduce((a, b) => a + b.netR, 0) / s.length : null; };
  const realStats = rules.map(([label, pred]) => ({ label, pred, stat: statFor(pred, r => r.netR), rpt: rptOf(pred) }));

  // Permutation null with DAY BLOCKS: candidates are heavily cross-correlated — alts move
  // with BTC, and overlapping candidates on one pair resolve on the same price path — so
  // shuffling outcomes independently treats every correlated cluster as independent evidence
  // and makes the null far too easy to beat (anti-conservative p-values). Instead, permute
  // whole UTC-day blocks of outcomes across the time-sorted records: within-day correlation
  // survives into the null, and p reflects the real (much smaller) effective sample size.
  // p = fraction of block-shuffles where the shuffled stat ≥ the real stat (smoothed).
  const order = all.map((_, i) => i).sort((a, b) => all[a].t - all[b].t); // record indices, time-ascending
  const blocks = [];
  for (let i = 0; i < order.length; ) {
    const day = Math.floor(all[order[i]].t / 86400);
    const start = i;
    while (i < order.length && Math.floor(all[order[i]].t / 86400) === day) i++;
    blocks.push(order.slice(start, i));
  }
  const idxOf = new Map(all.map((r, i) => [r, i]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const K = 1000, ge = new Array(rules.length).fill(0); // resolution for BH-FDR at q=0.05 across ~35 rules (min p ≈ 1/1001 < 0.05/35)
  for (let s = 0; s < K; s++) {
    // Lay the day-blocks back onto the time-ranked slots in shuffled order: record at time
    // rank p gets the outcome at rank p of the permuted outcome sequence.
    const perm = new Array(all.length);
    let pos = 0;
    for (const b of shuffle(blocks)) for (const idx of b) perm[order[pos++]] = all[idx].netR;
    const netOf = r => perm[idxOf.get(r)];
    for (let ri = 0; ri < rules.length; ri++) {
      if (realStats[ri].stat == null) continue;
      const ss = statFor(rules[ri][1], netOf);
      if (ss != null && ss >= realStats[ri].stat) ge[ri]++;
    }
  }

  const scored = realStats.map((rs, ri) => ({ ...rs, p: rs.stat == null ? 1 : (ge[ri] + 1) / (K + 1) }));

  // Multiple-testing control: across ~35 rules an uncorrected p<0.05 manufactures false
  // edges. Apply Benjamini-Hochberg (FDR q): sort tested rules by p ascending, find the
  // largest rank k with p(k) ≤ (k/m)·q; every rule at or below that p survives. (Rules are
  // positively correlated — nested thresholds — a regime where BH still controls FDR.)
  const FDR_Q = 0.05;
  const byP = scored.filter(d => d.stat != null).sort((a, b) => a.p - b.p);
  const m = byP.length;
  let pCut = 0;
  for (let i = 0; i < m; i++) if (byP[i].p <= ((i + 1) / m) * FDR_Q) pCut = byP[i].p;
  // A discovery survives FDR control AND is profitable out-of-sample.
  const discoveries = byP.filter(d => d.p <= pCut && d.rpt != null && d.rpt > 0);

  const lines = discoveries.length
    ? discoveries.slice(0, 8).map(d => `• **${d.label}** — OOS ${d.rpt.toFixed(2)}R/t · p=${d.p.toFixed(3)}`).join("\n")
    : `_None survived FDR control (BH, q=${FDR_Q}) while staying profitable out-of-sample._`;

  let verdict;
  if (discoveries.length === 0) {
    verdict = `**No edge found.** Of ${m} rules tested, none survived false-discovery control (Benjamini-Hochberg, q=${FDR_Q}) while profitable out-of-sample. Sampled wide and tested honestly, the data shows no long edge our features capture in this window.`;
  } else {
    verdict = `🟢 **${discoveries.length} rule(s) survived FDR control (BH, q=${FDR_Q}) and profitable out-of-sample.** By construction ≤${(FDR_Q * 100).toFixed(0)}% are expected false. Real candidates — but confirm on a different regime before trusting size; don't deploy on this window alone.`;
  }

  // Sample-imbalance readout: only backfilled pairs have deep history (720-candle live
  // pulls span ~30 days of 1h bars), so one pair can dominate the pool — and the time
  // splits then partly confound symbol with period. Surface it instead of hiding it.
  const topSym = [...bySym.entries()].sort((a, b) => b[1] - a[1])[0];
  const imbalance = topSym && topSym[1] / all.length > 0.3
    ? `\n⚠️ **${topSym[0]}** contributes ${(topSym[1] / all.length * 100).toFixed(0)}% of candidates (deep local store vs live 720-candle pulls) — time splits partly confound symbol and period. Backfill more pairs to fix.`
    : "";

  await message.channel.send(
    `🔭 **Strategy discovery — ${all.length} candidates from ${fetched} assets**\n` +
    `Baseline OOS R/t: ${base6.toFixed(2)} · ${m} rules · out-of-sample × 3 splits · day-block permutation + BH-FDR (q=${FDR_Q}).\n` +
    `By BTC regime (take-everything net R/t): ${regimeLine}${imbalance}\n\n` +
    `**Edges found (beat chance + profitable):**\n${lines}\n\n` +
    verdict
  );
}


export async function handleProfile(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`📊 Profiling every long candidate across **${watchlist.length}** assets — letting the winners and losers describe themselves. A minute or two…`);

  const { c4h: btcRaw } = await tfCandles(symbolToKrakenId("BTC"));
  const btc4h = btcRaw?.slice(0, -1);
  const all = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (!haveAll(d)) continue;
      const { records } = profileEntries({ series: seriesOf(d), btc4h }, { tpR: 4 });
      all.push(...records);
    } catch (err) { logger.error(`[PROFILE] ${asset.symbol}:`, err.message); }
  }

  const wins = all.filter(r => r.outcome === "win");
  const loss = all.filter(r => r.outcome === "loss");
  if (wins.length < 15 || loss.length < 15) {
    return message.channel.send(`Only ${wins.length} winners / ${loss.length} losers resolved — too few to compare reliably. The honest read needs more data (longer history or more pairs).`);
  }

  const mean = (arr, f) => { const v = arr.map(r => r[f]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const pct  = (arr, f, val) => { const v = arr.map(r => r[f]).filter(x => x != null); return v.length ? v.filter(x => (val === undefined ? x : x === val)).length / v.length * 100 : null; };

  const num = [
    ["RSI at entry", "rsi", 1], ["% from MA", "maDistPct", 2], ["room (R)", "roomR", 2],
    ["range position", "rangePos", 2], ["stop size %", "stopPct", 2], ["volume vs avg", "volRatio", 2],
    ["ATR %", "atrPct", 2], ["displacement", "displacement", 2], ["PDL dist %", "pdlDistPct", 2], ["PDH dist %", "pdhDistPct", 2],
    ["BTC 24h ret %", "btc4hRetPct", 2],
  ];
  const bool = [
    ["higher-low %", "higherLow", true], ["4h bull %", "biasMid", "bull"], ["1d bull %", "biasHigh", "bull"],
    ["swept low %", "swept", true], ["bullish FVG %", "fvg", true],
    ["BTC 4h bull %", "btcBias4h", "bull"],
  ];

  const lines = [];
  const seps = [];
  for (const [label, f, dp] of num) {
    const w = mean(wins, f), l = mean(loss, f);
    if (w == null || l == null) continue;
    lines.push(`${label.padEnd(15)} ${w.toFixed(dp).padStart(8)} ${l.toFixed(dp).padStart(8)}`);
    seps.push({ label, sep: Math.abs(w - l) / (Math.abs(w) + Math.abs(l) + 1e-9), w, l, dp, kind: "num" });
  }
  for (const [label, f, val] of bool) {
    const w = pct(wins, f, val), l = pct(loss, f, val);
    if (w == null || l == null) continue;
    lines.push(`${label.padEnd(15)} ${(w.toFixed(0) + "%").padStart(8)} ${(l.toFixed(0) + "%").padStart(8)}`);
    seps.push({ label, sep: Math.abs(w - l) / 100, w, l, dp: 0, kind: "pct" });
  }

  seps.sort((a, b) => b.sep - a.sep);
  const top = seps.slice(0, 3).map(s => {
    const suff = s.kind === "pct" ? "%" : "";
    return `**${s.label}** (winners ${s.w.toFixed(s.dp)}${suff} vs losers ${s.l.toFixed(s.dp)}${suff})`;
  });
  const winRate = (wins.length / all.length * 100).toFixed(0);

  await message.channel.send(
    `📊 **Entry profile — ${wins.length} winners / ${loss.length} losers (${winRate}% hit target)**\n\n` +
    "```\nfeature           winners   losers\n" + lines.join("\n") + "\n```\n" +
    `Biggest winner/loser divergences: ${top.join(", ")}.\n\n` +
    `_Where the two columns are far apart, the losers don't share it — that's a candidate edge worth gating on. ` +
    `Where they're close, it's a mirage. Next step: gate entries on the top divergent feature(s) and measure if net R improves out-of-sample._`
  );
}


// ─── !validate ──────────────────────────────────────────────────────────────
// The honest test of the room edge the profile found. Learns the best room
// threshold on the first 60% of history, then measures whether it beats the
// no-filter baseline on the last 40% it never saw. Out-of-sample is the lie
// detector: an edge that's real holds up on unseen data; an overfit one doesn't.
export async function handleValidate(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`🔬 Out-of-sample test of the room edge across **${watchlist.length}** assets — learn on the first 60% of history, test on the last 40% it never saw. A minute or two…`);

  const { c4h: btcRaw } = await tfCandles(symbolToKrakenId("BTC"));
  const btc4h = btcRaw?.slice(0, -1);
  const all = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (!haveAll(d)) continue;
      const { records } = profileEntries({ series: seriesOf(d), btc4h }, { tpR: 4 });
      all.push(...records);
    } catch (err) { logger.error(`[VALIDATE] ${asset.symbol}:`, err.message); }
  }
  if (all.length < 50) return message.channel.send(`Only ${all.length} resolved candidates — too few for a split test. Needs more data.`);

  // room null = nothing overhead = infinite room → passes any threshold.
  const passes = (rec, thr) => thr <= 0 || rec.roomR == null || rec.roomR >= thr;
  const evalSet = (set, thr) => { const f = set.filter(r => passes(r, thr)); const net = f.reduce((a, b) => a + b.netR, 0); return { n: f.length, net, rpt: f.length ? net / f.length : 0 }; };
  const times = all.map(r => r.t).sort((a, b) => a - b);

  // Run the learn-then-test procedure at THREE split points. A real edge holds across
  // all of them; a single lucky out-of-sample draw won't survive three different splits.
  const runSplit = (frac) => {
    const splitT = times[Math.floor(times.length * frac)];
    const IS = all.filter(r => r.t <= splitT), OOS = all.filter(r => r.t > splitT);
    let learned = 0, best = evalSet(IS, 0);
    for (const thr of [1, 1.5, 2, 2.5, 3]) { const e = evalSet(IS, thr); if (e.n >= 15 && e.net > best.net) { best = e; learned = thr; } }
    const oosBase = evalSet(OOS, 0), oosLearned = evalSet(OOS, learned);
    const beat = learned > 0 && oosLearned.net > oosBase.net && oosLearned.rpt > 0;
    return { frac, learned, isBase: evalSet(IS, 0), isLearned: evalSet(IS, learned), oosBase, oosLearned, beat };
  };
  const splits = [0.5, 0.6, 0.7].map(runSplit);
  const mid = splits[1];                                   // 60/40 shown in detail
  const held = splits.filter(s => s.beat).length;
  const anyLearned = splits.some(s => s.learned > 0);
  const fmt = e => `${e.n}t · ${e.net.toFixed(1)}R · ${e.rpt.toFixed(2)}R/t`;

  let verdict;
  if (!anyLearned) {
    verdict = `**No edge to validate.** At no split did requiring room beat taking every candidate, even in-sample. The profile's room gap was descriptive, not a profitable *rule*.`;
  } else if (held === 3) {
    verdict = `✅ **VALIDATED across all 3 splits.** The room rule beat the no-filter baseline on out-of-sample data it never saw, at every split point. That's a real, durable edge — the first one this project has found. Next: confirm on fresh data before risking size, but this is the genuine article.`;
  } else if (held >= 1) {
    verdict = `🟡 **MIXED — held at ${held}/3 splits.** Promising but not consistent: the room edge survived out-of-sample at some split points and not others. That's suggestive, not proven — and exactly the kind of half-signal that more data (or a trending regime) would resolve either way. Don't bet size on it yet.`;
  } else {
    verdict = `⚠️ **OVERFIT — held at 0/3 splits.** Room looked best in-sample but never beat the baseline out-of-sample. The gap was in-sample luck. This is the result that single-window tuning would have sold us as an edge — and the out-of-sample test caught it.`;
  }

  await message.channel.send(
    `🔬 **Out-of-sample room validation — ${all.length} candidates**\n` +
    `Learn-then-test at 3 split points; **held at ${held}/3**.\n\n` +
    `**60/40 split detail** (learned ${mid.learned}R room):\n` +
    `In-sample — no filter: ${fmt(mid.isBase)} · learned: ${fmt(mid.isLearned)}\n` +
    `Out-of-sample — no filter: ${fmt(mid.oosBase)} · learned: ${fmt(mid.oosLearned)}\n\n` +
    verdict
  );
}


export async function handleModes(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`🧬 Comparing 4 entry engines across **${watchlist.length}** assets (net of fees). This takes a minute or two…`);

  const data = [];
  for (const asset of watchlist) {
    try {
      const d = await tfCandles(asset.id);
      if (haveAll(d)) data.push({ series: seriesOf(d) });
    } catch (err) { logger.error(`[MODES] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  // BOS keeps its live gates; the dip-buy modes drop trend/alignment and run tight stops + high target.
  const cfgFor = mode => mode === "bos"
    ? { entryMode: "bos", entryTf: "1h", trendGate: true, trendGateMode: "ma", minStopPct: 0.015, maxStopPct: MAX_STOP_PCT_BY_TF["1h"], tpR: 4, lockBreakeven: true }
    : { entryMode: mode, entryTf: "1h", trendGate: false, alignMode: "none", minStopPct: 0, tpR: 5, lockBreakeven: true };
  const modes = [["bos", "BOS (trend)"], ["support", "support bounce"], ["ma_dip", "MA dip"], ["rsi", "RSI oversold"], ["rev", "reversal (higher-low)"]];

  const rows = modes.map(([mode, label]) => {
    const cfg = cfgFor(mode);
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ series: d.series }, cfg);
      pooled.push(...(r.results || []));
      if (r.totalR > 0) green++;
    }
    const n = pooled.length, wins = pooled.filter(x => x > 0).length;
    const net = pooled.reduce((a, b) => a + b, 0);
    return { label, n, net, winRate: n ? wins / n : 0, green, pairs: data.length };
  });

  const fmt = r => `**${r.label}** → ${r.n}t · **${r.net.toFixed(1)}R** · ${r.n ? (r.net / r.n).toFixed(2) : "0.00"}R/t · ${(r.winRate * 100).toFixed(0)}% · ${r.green}/${r.pairs} grn`;
  const traded = rows.filter(r => r.n >= 10);
  const best = traded.length ? [...traded].sort((a, b) => b.net - a.net)[0] : null;

  await message.channel.send(
    `🧬 **Entry-engine comparison — ${data.length} assets (net of taker fees)**\n\n` +
    rows.map(r => `• ${fmt(r)}`).join("\n") + `\n\n` +
    (best && best.net > 0
      ? `**${best.label}** leads with a real sample (${best.n}t, ${best.green}/${best.pairs} pairs, ${(best.net / best.n).toFixed(2)}R/t). ` +
        `If R/t is positive *at taker fees*, maker orders would only widen the edge — that's the green light to build them. ` +
        `Trade count × R/t is the daily-profit picture you're after.`
      : `No long engine is net-positive at taker fees on this window. That's the honest read: either the edge needs maker fees to ` +
        `surface (build them next and re-test), or these triggers don't beat chop. The R/t and trade-count columns tell you which is closer.`)
  );
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