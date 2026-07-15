/**
 * commands.js — Discord command handlers
 */

import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart }                   from "./analyzer.js";
import { runScanner, scanSymbol, fetchCandles, SCAN_INTERVALS } from "./scanner.js";
import { generateChartImage } from "./chart.js";
import { SWING_WINDOW } from "./strategy.js";
import { backtestMultiTF, profileEntries } from "./backtest.js";
import { loadCandles } from "./data.js";
import { buildLiveContext, looksLikeCodeQuestion, readSource } from "./context.js";
import { loadChart, saveConfig, symbolToKrakenId, isOwner } from "./storage.js";
import { getCurrentPrice, placeSell, getHoldings } from "./trader.js";
import {
  enableTrading, disableTrading, isTradingEnabled,
  getTrade, removeTrade, saveTradeState, postTradeClosed, getOpenTrades, reconcileHoldings
} from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

// Candles for research/backtests: deep local history from the store once a pair has been
// backfilled (data.js), else the live 720-candle pull kept politely paced. The live
// scanner still calls fetchCandles directly — only analysis/backtests read the store.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tfCandles(id) {
  const c15 = loadCandles(id, 15);
  if (c15.length) return { c15, c1h: loadCandles(id, 60), c4h: loadCandles(id, 240) };
  const live15 = await fetchCandles(id, 15);  await sleep(900);
  const live1h = await fetchCandles(id, 60);  await sleep(900);
  const live4h = await fetchCandles(id, 240);
  return { c15: live15, c1h: live1h, c4h: live4h };
}

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
    console.error(`[COMMAND] Sell failed for ${upper}:`, err.message);
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
    `Long-only spot. Enters on a 15m swing low confirmed by break of structure, only when the 1h and 4h trend are bullish, and self-manages exits by stop / take-profit / swing high.\n\n` +

    `**Positions:**\n` +
    `> \`!sell BTC\` — Close cajh's position in an asset\n` +
    `> \`!sell BTC 50\` — Sell part of it (percent)\n` +
    `> \`!port\` — Full Kraken portfolio + cajh P&L\n` +
    `> \`!stop\` — Halt new trades  ·  \`!resume\` — Re-enable\n\n` +

    `**Signals & scanning:**\n` +
    `> \`!scan\` — Scan the whole watchlist (auto-runs every 3h)\n` +
    `> \`!trade BTC\` — Check one asset across all timeframes\n` +
    `> \`!backtest\` — Backtest the whole watchlist (pooled win rate / total R)\n` +
    `> \`!backtest BTC\` — Backtest a single asset\n` +
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
  await runScanner(message.channel, state, true);
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
    `Your trading is mechanical: you enter on a 15m swing low confirmed by break of\n` +
    `structure (price closing back above it), only when the 1h and 4h trend are bullish,\n` +
    `and exit on stop-loss / take-profit / a swing high. Answer questions about yourself,\n` +
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
// Multi-timeframe backtest: entries on 15m, gated by 1h + 4h alignment (the live rule).

export async function handleBacktest(message, state, arg) {
  const symbol = (arg || "").trim().split(/\s+/)[0]?.toUpperCase();

  // No symbol → aggregate sweep of the whole watchlist (the number worth optimizing).
  if (!symbol) return backtestWatchlist(message, state);

  const id = (state.watchlist || []).find(a => a.symbol === symbol)?.id || symbolToKrakenId(symbol);
  await message.reply(`📈 Backtesting **${symbol}** across 15m/1h/4h (N=${SWING_WINDOW})...`);

  try {
    const { c15: candles15, c1h: candles1h, c4h: candles4h } = await tfCandles(id);

    if (!candles15?.length || !candles1h?.length || !candles4h?.length) {
      return message.reply(`⚠️ Couldn't fetch enough data for **${symbol}**.`);
    }

    const r = backtestMultiTF({
      candles15: candles15.slice(0, -1),
      candles1h: candles1h.slice(0, -1),
      candles4h: candles4h.slice(0, -1)
    });

    await message.reply(
      `📊 **Backtest — ${symbol}** (15m entries, 1h+4h filter, recent history)\n\n` +
      `**Trades:** ${r.trades}\n` +
      `**Win rate:** ${(r.winRate * 100).toFixed(0)}%\n` +
      `**Total:** ${r.totalR.toFixed(1)}R   ·   **Avg:** ${r.avgR.toFixed(2)}R/trade\n` +
      `**Max drawdown:** ${r.maxDrawdownR.toFixed(1)}R\n\n` +
      `_Small samples mislead — judge on total R, not win rate alone. "R" = multiples of per-trade risk._`
    );
  } catch (err) {
    console.error(`[COMMAND] Backtest failed for ${symbol}:`, err.message);
    await message.reply(`⚠️ Backtest failed: ${err.message}`);
  }
}

// Aggregate backtest across the whole watchlist — pools every trade into one win
// rate / total R. This is the figure to optimize (single pairs are too small a sample).
async function backtestWatchlist(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Your watchlist is empty — add assets with `!watch BTC ETH`.");

  await message.reply(`📈 Backtesting all **${watchlist.length}** watchlist assets (15m entries, 1h+4h filter)... give me a minute.`);

  const pooled = [];
  const lines  = [];
  for (const asset of watchlist) {
    try {
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (!c15?.length || !c1h?.length || !c4h?.length) { lines.push(`**${asset.symbol}** — no data`); continue; }

      const r = backtestMultiTF({ candles15: c15.slice(0, -1), candles1h: c1h.slice(0, -1), candles4h: c4h.slice(0, -1) });
      pooled.push(...(r.results || []));
      lines.push(`**${asset.symbol}** — ${r.trades}t · ${(r.winRate * 100).toFixed(0)}% · ${r.totalR.toFixed(1)}R`);
    } catch (err) {
      console.error(`[COMMAND] Backtest failed for ${asset.symbol}:`, err.message);
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (c15?.length && c1h?.length && c4h?.length) {
        data.push({ symbol: asset.symbol, c15: c15.slice(0, -1), c1h: c1h.slice(0, -1), c4h: c4h.slice(0, -1) });
      }
    } catch (err) {
      console.error(`[OPTIMIZE] fetch failed ${asset.symbol}:`, err.message);
    }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  // 2) Config grid — all net-of-fees, per-pair trend gate on. Entry timeframe is the
  // key variable: higher TFs give bigger stops that clear fees.
  const grid = [];
  for (const entryTf of ["15m", "1h", "4h"])
    for (const trendGateMode of ["ma", "structure"])
      for (const minStopPct of [0.015, 0.025])
        for (const tpR of [3, 4, 6])
          grid.push({ entryTf, trendGateMode, minStopPct, tpR, trendMa: 20, lockBreakeven: true, trendGate: true });

  // 3) Run every config across the cached pairs, pooling NET results.
  const ranked = grid.map(cfg => {
    const pooled = [];
    let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ candles15: d.c15, candles1h: d.c1h, candles4h: d.c4h }, cfg);
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
    `**${r.cfg.entryTf}/${r.cfg.trendGateMode === "structure" ? "struct" : "ma"}** · min${(r.cfg.minStopPct * 100).toFixed(1)}/TP${r.cfg.tpR}` +
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (!c15?.length || !c1h?.length || !c4h?.length) continue;
      const r = backtestMultiTF({ candles15: c15.slice(0, -1), candles1h: c1h.slice(0, -1), candles4h: c4h.slice(0, -1) });
      for (const [k, v] of Object.entries(r.reasons || {})) agg[k] = (agg[k] || 0) + v;
    } catch (err) { console.error(`[WHY] ${asset.symbol}:`, err.message); }
  }

  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  if (!total) return message.channel.send("No candidate swing lows found in the data.");

  const label = {
    taken: "✅ taken", stopTooTight: "❌ stop too tight (below floor)", stopTooFar: "❌ stop too far (above cap)",
    trendGate: "❌ trend gate (4h not trending up)", notAligned: "❌ 1h/4h not aligned",
    notHigherLow: "❌ not a higher low", priceBelowStop: "❌ price already below stop"
  };
  const order = ["taken", "stopTooTight", "stopTooFar", "trendGate", "notAligned", "notHigherLow", "priceBelowStop"];
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
// Focused sweep: holds the live base config (15m / ma gate / min1.5 / TP4) and
// tries the four alignment rules, so we can see which one actually trades
// net-positive instead of rejecting 85% of setups. Net of fees, with breadth.
export async function handleAlign(message, state) {
  const watchlist = state.watchlist || [];
  if (!watchlist.length) return message.reply("Watchlist is empty.");

  await message.reply(`⚖️ Testing 4 alignment rules across **${watchlist.length}** assets on the live base config (net of fees)…`);

  const data = [];
  for (const asset of watchlist) {
    try {
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (c15?.length && c1h?.length && c4h?.length)
        data.push({ c15: c15.slice(0, -1), c1h: c1h.slice(0, -1), c4h: c4h.slice(0, -1) });
    } catch (err) { console.error(`[ALIGN] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  const base = { entryTf: "15m", trendGate: true, trendGateMode: "ma", minStopPct: 0.015, tpR: 4, lockBreakeven: true };
  const modes = [
    ["all",     "all 3 TFs bull (current)"],
    ["first",   "1h only"],
    ["notbear", "higher TFs not bearish"],
    ["none",    "entry TF only"],
  ];
  const rows = modes.map(([alignMode, label]) => {
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ candles15: d.c15, candles1h: d.c1h, candles4h: d.c4h }, { ...base, alignMode });
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
    `⚖️ **Alignment sweep — ${data.length} assets (net of fees)**\nBase: 15m · ma gate · min1.5 · TP4\n\n` +
    rows.map(r => `• ${fmt(r)}`).join("\n") + `\n\n` +
    (best
      ? `Most net-positive: **${best.label}** (${best.net.toFixed(1)}R, ${best.green}/${best.pairs} pairs). Read **breadth**, not just the total — ` +
        `and watch **R/t**: a looser rule only wins if per-trade R stays healthy, because more trades means more fee exposure.`
      : `⚠️ Every alignment rule is net-negative or never trades. Loosening alignment isn't the unlock — the problem is deeper ` +
        `(stop placement, or the trend gate). We test that next.`)
  );
}


// ─── !room ──────────────────────────────────────────────────────────────────
// Focused sweep: holds the promising loosened base (15m / ma gate / alignment off /
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (c15?.length && c1h?.length && c4h?.length)
        data.push({ c15: c15.slice(0, -1), c1h: c1h.slice(0, -1), c4h: c4h.slice(0, -1) });
    } catch (err) { console.error(`[ROOM] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  const base = { entryTf: "15m", trendGate: true, trendGateMode: "ma", alignMode: "none", minStopPct: 0.015, tpR: 4, lockBreakeven: true };
  const rows = [0, 1, 2, 3, 4].map(minRoomR => {
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ candles15: d.c15, candles1h: d.c1h, candles4h: d.c4h }, { ...base, minRoomR });
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
    `📏 **Resistance-room sweep — ${data.length} assets (net of fees)**\nBase: 15m · ma gate · alignment off · min1.5 · TP4\n\n` +
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
  "BCH","AAVE","ALGO","XLM","ETC","GRT","CRV","MKR","SNX","ICP",
  "IMX","ARB","OP","SEI","RUNE","KSM","EOS","FLOW","SAND","MANA",
];

export async function handleDiscover(message, state) {
  await message.reply(`🔭 Discovery run — sampling up to **${DISCOVER_UNIVERSE.length}** assets, then searching rules with an out-of-sample skeptic + chance baseline. This takes a few minutes…`);

  const { c4h: btcRaw } = await tfCandles(symbolToKrakenId("BTC"));
  const btc4h = btcRaw?.slice(0, -1);
  const all = [];
  let fetched = 0;
  for (const sym of DISCOVER_UNIVERSE) {
    try {
      const id = symbolToKrakenId(sym);
      const { c15, c1h, c4h } = await tfCandles(id);
      if (!c15?.length || !c1h?.length || !c4h?.length) continue;
      const { records } = profileEntries({ candles15: c15.slice(0, -1), candles1h: c1h.slice(0, -1), candles4h: c4h.slice(0, -1), btc4h }, { tpR: 4 });
      all.push(...records);
      fetched++;
    } catch (err) { console.error(`[DISCOVER] ${sym}:`, err.message); }
  }
  if (all.length < 100) return message.channel.send(`Only ${all.length} candidates from ${fetched} assets — too few to search reliably.`);

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
    ["stop < 1%",          r => r.stopPct != null && r.stopPct < 1],
    ["stop > 2%",          r => r.stopPct != null && r.stopPct > 2],
    ["4h bull",            r => r.bias4h === "bull"],
    ["4h not bull",        r => r.bias4h !== "bull"],
    ["1h bull",            r => r.bias1h === "bull"],
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

  // Permutation null: shuffle netR, recompute each rule's stat. p = fraction of
  // shuffles where the shuffled stat ≥ the real stat (smoothed).
  const netRs = all.map(r => r.netR);
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const K = 1000, ge = new Array(rules.length).fill(0); // resolution for BH-FDR at q=0.05 across ~26 rules (min p ≈ 1/1001 < 0.05/26)
  for (let s = 0; s < K; s++) {
    const sh = shuffle(netRs);
    const map = new Map(all.map((r, i) => [r, sh[i]]));
    const netOf = r => map.get(r);
    for (let ri = 0; ri < rules.length; ri++) {
      if (realStats[ri].stat == null) continue;
      const ss = statFor(rules[ri][1], netOf);
      if (ss != null && ss >= realStats[ri].stat) ge[ri]++;
    }
  }

  const scored = realStats.map((rs, ri) => ({ ...rs, p: rs.stat == null ? 1 : (ge[ri] + 1) / (K + 1) }));

  // Multiple-testing control: across ~18 rules an uncorrected p<0.05 manufactures false
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

  await message.channel.send(
    `🔭 **Strategy discovery — ${all.length} candidates from ${fetched} assets**\n` +
    `Baseline OOS R/t: ${base6.toFixed(2)} · ${m} rules · out-of-sample × 3 splits · permutation + BH-FDR (q=${FDR_Q}).\n\n` +
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (!c15?.length || !c1h?.length || !c4h?.length) continue;
      const { records } = profileEntries({ candles15: c15.slice(0, -1), candles1h: c1h.slice(0, -1), candles4h: c4h.slice(0, -1), btc4h }, { tpR: 4 });
      all.push(...records);
    } catch (err) { console.error(`[PROFILE] ${asset.symbol}:`, err.message); }
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
    ["higher-low %", "higherLow", true], ["1h bull %", "bias1h", "bull"], ["4h bull %", "bias4h", "bull"],
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (!c15?.length || !c1h?.length || !c4h?.length) continue;
      const { records } = profileEntries({ candles15: c15.slice(0, -1), candles1h: c1h.slice(0, -1), candles4h: c4h.slice(0, -1), btc4h }, { tpR: 4 });
      all.push(...records);
    } catch (err) { console.error(`[VALIDATE] ${asset.symbol}:`, err.message); }
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
      const { c15, c1h, c4h } = await tfCandles(asset.id);
      if (c15?.length && c1h?.length && c4h?.length)
        data.push({ c15: c15.slice(0, -1), c1h: c1h.slice(0, -1), c4h: c4h.slice(0, -1) });
    } catch (err) { console.error(`[MODES] ${asset.symbol}:`, err.message); }
  }
  if (!data.length) return message.channel.send("⚠️ Couldn't fetch data for any pair.");

  // BOS keeps its live gates; the dip-buy modes drop trend/alignment and run tight stops + high target.
  const cfgFor = mode => mode === "bos"
    ? { entryMode: "bos", entryTf: "15m", trendGate: true, trendGateMode: "ma", minStopPct: 0.015, tpR: 4, lockBreakeven: true }
    : { entryMode: mode, entryTf: "15m", trendGate: false, alignMode: "none", minStopPct: 0, tpR: 5, lockBreakeven: true };
  const modes = [["bos", "BOS (trend)"], ["support", "support bounce"], ["ma_dip", "MA dip"], ["rsi", "RSI oversold"], ["rev", "reversal (higher-low)"]];

  const rows = modes.map(([mode, label]) => {
    const cfg = cfgFor(mode);
    const pooled = []; let green = 0;
    for (const d of data) {
      const r = backtestMultiTF({ candles15: d.c15, candles1h: d.c1h, candles4h: d.c4h }, cfg);
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