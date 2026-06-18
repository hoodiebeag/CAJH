/**
 * analyzer.js — Chart analysis using Claude vision + SMC methodology
 * Long-only spot trading. Live prices are injected into every prompt.
 * Trades require human confirmation before execution.
 */

import Anthropic from "@anthropic-ai/sdk";
import { fetchNews }                                                      from "./news.js";
import { placeBuy, placeStopLoss, placeTakeProfit, getCurrentPrice, getPositionPct } from "./trader.js";
import { requestConfirmation, registerTrade, postTradeOpened, isTradingEnabled }     from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = "claude-sonnet-4-6";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function positionSizeLabel(conviction) {
  return `${(getPositionPct(conviction) * 100).toFixed(0)}%`;
}

/** Extract structured trade params from Claude's formatted analysis text. */
function extractTradeParams(text) {
  const get = (label) => {
    const match = text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*\\$?([\\d,]+\\.?\\d*)`, "i"));
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
  };

  const stopLoss    = get("Stop Loss");
  const takeProfit1 = get("Take Profit 1");
  const takeProfit2 = get("Take Profit 2");

  return (stopLoss && takeProfit1 && takeProfit2)
    ? { stopLoss, takeProfit1, takeProfit2 }
    : null;
}

/** Execute a confirmed trade — market buy, then attach SL and TP orders. */
async function executeTrade(asset, params, conviction, channel) {
  try {
    const price   = await getCurrentPrice(asset);
    const sizePct = getPositionPct(conviction);
    const trade   = await placeBuy({ symbol: asset, conviction, price });

    trade.stopLoss    = params.stopLoss;
    trade.takeProfit1 = params.takeProfit1;
    trade.takeProfit2 = params.takeProfit2;
    trade.sizePct     = sizePct;

    if (params.stopLoss > 0) {
      await placeStopLoss({ symbol: asset, volume: trade.volume, stopPrice: params.stopLoss });
    }

    if (params.takeProfit1 > 0) {
      const half = trade.volume / 2;
      await placeTakeProfit({ symbol: asset, volume: half,                takeProfitPrice: params.takeProfit1 });
      await placeTakeProfit({ symbol: asset, volume: trade.volume - half, takeProfitPrice: params.takeProfit2 });
    }

    registerTrade(trade);
    await postTradeOpened(channel, trade);

  } catch (err) {
    console.error(`[TRADE] Execution failed for ${asset}:`, err.message);
    await channel.send(`⚠️ **Trade execution failed for ${asset}:** ${err.message}`);
  }
}

// ─── Single-chart analysis (Tree Capital charts) ───────────────────────────────

export async function analyzeChart(base64, mediaType, channel, force = false, threshold = 6) {
  try {
    const img = { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

    // Step 1: conviction score
    const convRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 10,
      system: `You are an expert intraday SMC trader. We trade spot only — long entries only, no shorts.
Rate this chart's long trade setup conviction 1–10.
1 = no long setup. 10 = must-enter long trade. Respond with ONLY a single integer.`,
      messages: [{ role: "user", content: [img, { type: "text", text: "Rate conviction 1–10." }] }]
    });

    const conviction = parseInt(convRes.content[0].text.trim());
    console.log(`[ANALYSIS] Conviction: ${conviction}/10`);

    if (conviction < threshold && !force) {
      await channel.send(`📊 **Conviction: ${conviction}/10** — No long setup found.`);
      return;
    }

    // Step 2: full analysis
    const analysisRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024,
      system: `You are an expert intraday SMC trader. We trade spot only — long entries only, no shorts.
Analyze the chart and provide a long trade setup using EXACTLY this format:
- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** $price (use the EXACT current price visible on the chart)
- **Stop Loss:** $price (below key structure)
- **Take Profit 1:** $price (min 1:1.5 R:R)
- **Take Profit 2:** $price (extended target)
- **Grade:** A / B / C
- **Key Confluences:** 2–3 specific confluences

IMPORTANT: Use the actual prices visible on the chart axes. Do not estimate or approximate.`,
      messages: [{ role: "user", content: [img, { type: "text", text: "Provide a long trade setup." }] }]
    });

    const analysis = analysisRes.content[0].text;
    await channel.send(`📊 **Conviction: ${conviction}/10 — ${positionSizeLabel(conviction)} of capital**\n\n${analysis}`);

  } catch (err) {
    console.error("[ANALYSIS] Single chart error:", err.message);
    await channel.send("⚠️ Something went wrong analyzing the chart.");
  }
}

// ─── Single-asset multi-TF analysis ───────────────────────────────────────────

export async function analyzeMultiTimeframe(asset, charts, channel, force = false, threshold = 6) {
  try {
    console.log(`[ANALYSIS] Multi-TF SMC for ${asset}`);

    // Fetch live price and news
    const livePrice   = await getCurrentPrice(asset);
    const headlines   = await fetchNews(asset);
    const newsContext = headlines.length > 0
      ? `Latest news for ${asset}:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : `No recent news found for ${asset}.`;

    const priceContext = `Current live ${asset} price: $${livePrice.toFixed(6)}`;

    const content = [
      { type: "text", text: `${priceContext}\n${newsContext}\n\nAnalyze these three timeframe charts for ${asset}:` },
      ...charts.flatMap(c => [
        { type: "text", text: `**${c.label} chart:**` },
        { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.base64 } }
      ])
    ];

    // Step 1: conviction score
    const convRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 10,
      system: `You are an expert SMC intraday trader. We trade spot only — long entries only, no shorts.
Rate the multi-timeframe LONG conviction 1–10 considering:
- Order blocks, FVGs, BOS/CHOCH, liquidity sweeps aligned bullishly
- RSI divergence, VWAP reclaims, BB squeezes pointing up
- Timeframe alignment across 15m, 1h, 4h all agreeing long
- News sentiment
Give 1 if only short setups are visible. Respond with ONLY a single integer.`,
      messages: [{ role: "user", content }]
    });

    const conviction = parseInt(convRes.content[0].text.trim());
    console.log(`[ANALYSIS] ${asset} conviction: ${conviction}/10 (live price: $${livePrice})`);

    if (conviction < threshold && !force) {
      await channel.send(`📊 **${asset} — Conviction: ${conviction}/10** — No quality long setup.`);
      return { conviction, analysis: null };
    }

    // Step 2: full analysis with live price injected
    const analysisRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 1500,
      system: `You are an expert SMC intraday trader. We trade spot only — long entries only, no shorts.
The current live ${asset} price is $${livePrice.toFixed(6)}.
Provide the best long trade setup using EXACTLY this format:

- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** $price (must be at or very near the current live price of $${livePrice.toFixed(6)})
- **Stop Loss:** $price (below key structure, realistic based on current price)
- **Take Profit 1:** $price (min 1:1.5 R:R from current price)
- **Take Profit 2:** $price (extended target)
- **Grade:** A / B / C
- **Timeframe Alignment:** do 15m, 1h, 4h agree?
- **Key Confluences:** 3–4 specific confluences
- **News Impact:** one line if relevant

CRITICAL: All prices must be realistic relative to the current live price of $${livePrice.toFixed(6)}.`,
      messages: [{ role: "user", content: [...content, { type: "text", text: "Provide the best long setup." }] }]
    });

    const analysis = analysisRes.content[0].text;
    const size     = positionSizeLabel(conviction);
    const header   = `📊 **${asset} — Conviction: ${conviction}/10 — ${size} of capital — Live: $${livePrice.toFixed(4)}**\n\n`;
    const full     = header + analysis;

    if (full.length <= 2000) {
      await channel.send(full);
    } else {
      await channel.send(header.trim());
      for (let i = 0; i < analysis.length; i += 1900) {
        await channel.send(analysis.slice(i, i + 1900));
      }
    }

    // Request human confirmation
    if ((conviction >= threshold || force) && isTradingEnabled()) {
      const params = extractTradeParams(analysis);

      if (params) {
        const confirmed = await requestConfirmation(channel, {
          symbol:      asset,
          entry:       livePrice,
          stopLoss:    params.stopLoss,
          takeProfit1: params.takeProfit1,
          takeProfit2: params.takeProfit2,
          conviction,
          sizePct:     getPositionPct(conviction)
        });

        if (confirmed) {
          await executeTrade(asset, params, conviction, channel);
        } else {
          await channel.send(`❌ **${asset}** trade skipped.`);
        }

      } else {
        console.warn(`[ANALYSIS] Could not extract trade params for ${asset}`);
        await channel.send(`⚠️ **${asset}** — Could not parse trade levels. No order placed.`);
      }
    }

    return { conviction, analysis };

  } catch (err) {
    console.error(`[ANALYSIS] Multi-TF error for ${asset}:`, err.message);
    await channel.send(`⚠️ Something went wrong analyzing ${asset}.`);
    return { conviction: 0, analysis: null };
  }
}

// ─── Best long scan across all watched assets ──────────────────────────────────

export async function findBestLongEntry(watchlist, channel, threshold = 6) {
  await channel.send(`🔍 **Scanning all ${watchlist.length} watched assets for the best long entry...**`);

  const results  = [];

  for (const asset of watchlist) {
    try {
      const { fetchCandles }       = await import("./scanner.js");
      const { generateChartImage } = await import("./chart.js");

      const livePrice = await getCurrentPrice(asset.symbol);
      const charts    = [];

      for (const interval of [{ label: "15m", minutes: 15 }, { label: "1h", minutes: 60 }, { label: "4h", minutes: 240 }]) {
        const candles = await fetchCandles(asset.id, interval.minutes);
        if (!candles?.length) continue;
        const buffer = generateChartImage(candles, asset.symbol, interval.label);
        charts.push({ label: interval.label, base64: buffer.toString("base64"), mediaType: "image/png" });
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!charts.length) continue;

      // Quick conviction score only
      const headlines   = await fetchNews(asset.symbol);
      const newsContext = headlines.length > 0
        ? `Latest news:\n${headlines.slice(0, 3).map((h, i) => `${i + 1}. ${h}`).join("\n")}`
        : "No recent news.";

      const content = [
        { type: "text", text: `Current live ${asset.symbol} price: $${livePrice.toFixed(6)}\n${newsContext}\n\nCharts:` },
        ...charts.flatMap(c => [
          { type: "text", text: `**${c.label}:**` },
          { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.base64 } }
        ])
      ];

      const convRes = await anthropic.messages.create({
        model: MODEL, max_tokens: 10,
        system: `You are an expert SMC intraday trader. Long-only spot trading.
Rate the LONG conviction 1–10. Give 1 if only shorts are visible. Respond with ONLY a single integer.`,
        messages: [{ role: "user", content }]
      });

      const conviction = parseInt(convRes.content[0].text.trim());
      console.log(`[SCAN] ${asset.symbol}: ${conviction}/10`);

      results.push({ asset, charts, conviction, livePrice });
      await channel.send(`📊 **${asset.symbol}** — Conviction: ${conviction}/10 @ $${livePrice.toFixed(4)}`);
      await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
      console.error(`[SCAN] Error scanning ${asset.symbol}:`, err.message);
    }
  }

  if (!results.length) {
    await channel.send("⚠️ Could not scan any assets. Try again.");
    return;
  }

  // Pick the highest conviction setup
  const best = results.sort((a, b) => b.conviction - a.conviction)[0];

  if (best.conviction < threshold) {
    await channel.send(`📊 **No quality long setups found across all assets.** Best was **${best.asset.symbol}** at ${best.conviction}/10.`);
    return;
  }

  await channel.send(`🏆 **Best long setup: ${best.asset.symbol} (${best.conviction}/10)** — Running full analysis...`);
  await analyzeMultiTimeframe(best.asset.symbol, best.charts, channel, true, threshold);
}