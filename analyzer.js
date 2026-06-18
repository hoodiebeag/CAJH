import Anthropic from "@anthropic-ai/sdk";
import { fetchNews } from "./news.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Get position size based on conviction
function getPositionSize(conviction) {
  if (conviction >= 10) return "15%";
  if (conviction >= 9) return "12%";
  if (conviction >= 8) return "9%";
  if (conviction >= 7) return "7%";
  if (conviction >= 6) return "5%";
  return "0%";
}

// Analyze a single chart from Tree Capital
export async function analyzeChart(base64, mediaType, channel, forceAnalysis = false, threshold = 6) {
  try {
    console.log(`Analyzing chart, base64 length: ${base64.length}`);

    const convictionResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `You are an expert intraday trader using smart money concepts. Look at this chart and rate the trade setup conviction from 1-10.
1 = no clear setup
10 = extremely high conviction smart money setup
Respond with ONLY a single number between 1 and 10. Nothing else.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Rate the conviction of this trade setup 1-10." }
          ]
        }
      ]
    });

    const conviction = parseInt(convictionResponse.content[0].text.trim());
    console.log(`Conviction score: ${conviction}`);

    if (conviction < threshold && !forceAnalysis) {
      await channel.send(`📊 **Conviction: ${conviction}/10** — Low conviction, no setup recommended.`);
      return;
    }

    const positionSize = getPositionSize(conviction);

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are an expert intraday trader using smart money concepts (SMC). Analyze the chart and provide:
- **Direction:** Long or Short
- **Setup Type:** (e.g. Order Block Retest, FVG Fill, BOS continuation, Liquidity Sweep, BB squeeze breakout)
- **Entry:** specific price
- **Stop Loss:** specific price (below/above order block or FVG)
- **Take Profit 1:** specific price (1:1.5 R:R minimum)
- **Take Profit 2:** specific price (extended target)
- **Grade:** A (all confluences align), B (2-3 confluences), C (basic setup)
- **Key Confluences:** list 2-3 (e.g. EMA support, RSI oversold, VWAP reclaim, Order Block, FVG)
Be specific with prices. No lengthy explanations.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Analyze this chart using smart money concepts." }
          ]
        }
      ]
    });

    const analysis = analysisResponse.content[0].text;
    await channel.send(`📊 **Conviction: ${conviction}/10 — Position Size: ${positionSize} of capital**\n\n${analysis}`);

  } catch (error) {
    console.error("Error analyzing chart:", error.message);
    await channel.send("⚠️ Something went wrong analyzing the chart.");
  }
}

// Multi-timeframe analysis with smart money concepts and news awareness
export async function analyzeMultiTimeframe(asset, charts, channel, forceAnalysis = false, threshold = 6) {
  try {
    console.log(`Running multi-timeframe SMC analysis for ${asset}...`);

    // Fetch latest news
    const headlines = await fetchNews(asset);
    const newsContext = headlines.length > 0
      ? `Latest news for ${asset}:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : `No recent news found for ${asset}.`;

    // Build content with news + all 3 charts
    const content = [
      { type: "text", text: `${newsContext}\n\nAnalyze these three timeframe charts for ${asset} using smart money concepts.` }
    ];

    for (const chart of charts) {
      content.push({ type: "text", text: `**${chart.label} chart:**` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: chart.mediaType, data: chart.base64 }
      });
    }

    // Conviction score
    const convictionResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `You are an expert SMC intraday trader. You will be given news and 3 timeframe charts (15m, 1h, 4h).
Rate the overall multi-timeframe conviction from 1-10 using smart money concepts:
- Look for order block retests, FVG fills, BOS/CHOCH, liquidity sweeps
- Look for RSI divergence, VWAP reclaims, BB squeezes
- Only give 8+ if multiple timeframes and indicators align
- Factor in news sentiment
- Look for BOTH long AND short setups
Respond with ONLY a single number. Nothing else.`,
      messages: [{ role: "user", content }]
    });

    const conviction = parseInt(convictionResponse.content[0].text.trim());
    console.log(`SMC multi-TF conviction for ${asset}: ${conviction}`);

    if (conviction < threshold && !forceAnalysis) {
      await channel.send(`📊 **${asset} Multi-TF Conviction: ${conviction}/10** — No quality SMC setup detected.`);
      return { conviction, analysis: null };
    }

    const positionSize = getPositionSize(conviction);

    // Full SMC analysis
    const analysisContent = [...content];
    analysisContent.push({
      type: "text",
      text: "Based on all three timeframes, news, and smart money concepts, provide detailed trade setups."
    });

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: `You are an expert intraday trader using smart money concepts (SMC). Given news and 15m, 1h, 4h charts, provide up to 2 trade setups (long AND/OR short if both are valid):

For each setup:
- **Direction:** Long or Short
- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** specific price
- **Stop Loss:** specific price
- **Take Profit 1:** specific price (1:1.5 R:R minimum)
- **Take Profit 2:** specific price (extended target)
- **Grade:** A / B / C
- **Timeframe Alignment:** (do 15m, 1h, 4h agree?)
- **Key Confluences:** 3-4 specific confluences (Order Block, FVG, EMA, VWAP, RSI, BB, news)
- **News Impact:** one line if relevant

Be specific with prices. Prioritize A and B grade setups only.`,
      messages: [{ role: "user", content: analysisContent }]
    });

    const analysis = analysisResponse.content[0].text;
    await channel.send(`📊 **${asset} Multi-TF Conviction: ${conviction}/10 — Position Size: ${positionSize} of capital**\n\n${analysis}`);
    return { conviction, analysis };

  } catch (error) {
    console.error(`Error in SMC analysis for ${asset}:`, error.message);
    await channel.send(`⚠️ Something went wrong analyzing ${asset}.`);
    return { conviction: 0, analysis: null };
  }
}