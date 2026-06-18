/**
 * analyzer.js — Chart analysis using Claude vision + SMC methodology
 * Handles single-chart and multi-timeframe analysis with news context.
 * Trades require human confirmation before execution.
 */

import Anthropic from "@anthropic-ai/sdk";
import { fetchNews }                          from "./news.js";
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

  const dirMatch  = text.match(/\*\*Direction:\*\*\s*(Long|Short)/i);
  const direction = dirMatch?.[1] ?? null;
  const entry       = get("Entry");
  const stopLoss    = get("Stop Loss");
  const takeProfit1 = get("Take Profit 1");
  const takeProfit2 = get("Take Profit 2");

  return (direction && entry && stopLoss && takeProfit1 && takeProfit2)
    ? { direction, entry, stopLoss, takeProfit1, takeProfit2 }
    : null;
}

/** Execute a confirmed trade — buy, then attach SL and TP orders. */
async function executeTrade(asset, params, conviction, channel) {
  try {
    const price  = await getCurrentPrice(asset);
    const sizePct = getPositionPct(conviction);

    const trade = await placeBuy({ symbol: asset, conviction, price });
    trade.stopLoss    = params.stopLoss;
    trade.takeProfit1 = params.takeProfit1;
    trade.takeProfit2 = params.takeProfit2;
    trade.sizePct     = sizePct;

    // Attach stop loss
    if (params.stopLoss > 0) {
      await placeStopLoss({ symbol: asset, volume: trade.volume, stopPrice: params.stopLoss });
    }

    // Attach take profit orders (split 50/50)
    if (params.takeProfit1 > 0) {
      const half = trade.volume / 2;
      await placeTakeProfit({ symbol: asset, volume: half,             takeProfitPrice: params.takeProfit1 });
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
      system: `You are an expert intraday SMC trader. Rate this chart's trade setup conviction 1–10.
1 = no setup. 10 = must-enter trade. Respond with ONLY a single integer.`,
      messages: [{ role: "user", content: [img, { type: "text", text: "Rate conviction 1–10." }] }]
    });

    const conviction = parseInt(convRes.content[0].text.trim());
    console.log(`[ANALYSIS] Conviction: ${conviction}/10`);

    if (conviction < threshold && !force) {
      await channel.send(`📊 **Conviction: ${conviction}/10** — Low conviction, no setup.`);
      return;
    }

    // Step 2: full analysis
    const analysisRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024,
      system: `You are an expert intraday SMC trader. Analyze the chart using EXACTLY this format:
- **Direction:** Long or Short
- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** $price
- **Stop Loss:** $price
- **Take Profit 1:** $price
- **Take Profit 2:** $price
- **Grade:** A / B / C
- **Key Confluences:** 2–3 specific confluences`,
      messages: [{ role: "user", content: [img, { type: "text", text: "Analyze this chart." }] }]
    });

    const analysis = analysisRes.content[0].text;
    await channel.send(`📊 **Conviction: ${conviction}/10 — ${positionSizeLabel(conviction)} of capital**\n\n${analysis}`);

  } catch (err) {
    console.error("[ANALYSIS] Single chart error:", err.message);
    await channel.send("⚠️ Something went wrong analyzing the chart.");
  }
}

// ─── Multi-timeframe analysis (scanner + !trade) ───────────────────────────────

export async function analyzeMultiTimeframe(asset, charts, channel, force = false, threshold = 6) {
  try {
    console.log(`[ANALYSIS] Multi-TF SMC for ${asset}`);

    // Fetch news context
    const headlines   = await fetchNews(asset);
    const newsContext = headlines.length > 0
      ? `Latest news for ${asset}:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : `No recent news found for ${asset}.`;

    const content = [
      { type: "text", text: `${newsContext}\n\nAnalyze these three timeframe charts for ${asset}:` },
      ...charts.flatMap(c => [
        { type: "text", text: `**${c.label} chart:**` },
        { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.base64 } }
      ])
    ];

    // Step 1: conviction score
    const convRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 10,
      system: `You are an expert SMC intraday trader. Rate the multi-timeframe conviction 1–10 considering:
- Order blocks, FVGs, BOS/CHOCH, liquidity sweeps
- RSI divergence, VWAP reclaims, BB squeezes
- Timeframe alignment across 15m, 1h, 4h
- News sentiment
Respond with ONLY a single integer.`,
      messages: [{ role: "user", content }]
    });

    const conviction = parseInt(convRes.content[0].text.trim());
    console.log(`[ANALYSIS] ${asset} multi-TF conviction: ${conviction}/10`);

    if (conviction < threshold && !force) {
      await channel.send(`📊 **${asset} — Conviction: ${conviction}/10** — No quality setup detected.`);
      return { conviction, analysis: null };
    }

    // Step 2: full analysis
    const analysisRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 1500,
      system: `You are an expert SMC intraday trader. Provide the single best trade setup using EXACTLY this format:

- **Direction:** Long or Short
- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** $price
- **Stop Loss:** $price
- **Take Profit 1:** $price (min 1:1.5 R:R)
- **Take Profit 2:** $price (extended target)
- **Grade:** A / B / C
- **Timeframe Alignment:** do 15m, 1h, 4h agree?
- **Key Confluences:** 3–4 specific confluences
- **News Impact:** one line if relevant

Use EXACTLY these labels. Be specific with prices.`,
      messages: [{ role: "user", content: [...content, { type: "text", text: "Provide the best trade setup." }] }]
    });

    const analysis = analysisRes.content[0].text;
    const size     = positionSizeLabel(conviction);

    // Split long messages for Discord's 2000-char limit
    const header = `📊 **${asset} — Conviction: ${conviction}/10 — ${size} of capital**\n\n`;
    const full   = header + analysis;

    if (full.length <= 2000) {
      await channel.send(full);
    } else {
      await channel.send(header.trim());
      for (let i = 0; i < analysis.length; i += 1900) {
        await channel.send(analysis.slice(i, i + 1900));
      }
    }

    // Request human confirmation before executing
    if ((conviction >= threshold || force) && isTradingEnabled()) {
      const params = extractTradeParams(analysis);

      if (params && params.direction.toLowerCase() === "long") {
        const price   = await getCurrentPrice(asset);
        const sizePct = getPositionPct(conviction);

        const confirmed = await requestConfirmation(channel, {
          symbol:      asset,
          entry:       price,
          stopLoss:    params.stopLoss,
          takeProfit1: params.takeProfit1,
          takeProfit2: params.takeProfit2,
          conviction,
          sizePct
        });

        if (confirmed) {
          await executeTrade(asset, params, conviction, channel);
        } else {
          await channel.send(`❌ **${asset}** trade skipped.`);
        }

      } else if (params?.direction.toLowerCase() === "short") {
        await channel.send(`ℹ️ **${asset}** — Short setup detected. Spot trading is long-only, skipping execution.`);
      } else {
        console.warn(`[ANALYSIS] Could not extract trade params for ${asset}`);
      }
    }

    return { conviction, analysis };

  } catch (err) {
    console.error(`[ANALYSIS] Multi-TF error for ${asset}:`, err.message);
    await channel.send(`⚠️ Something went wrong analyzing ${asset}.`);
    return { conviction: 0, analysis: null };
  }
}