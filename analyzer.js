import Anthropic from "@anthropic-ai/sdk";
import { fetchNews } from "./news.js";
import { placeTrade, getAccountBalance } from "./trader.js";
import { postTradeOpened, registerTrade } from "./monitor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Get position size % based on conviction
function getPositionSize(conviction) {
  if (conviction >= 10) return "15%";
  if (conviction >= 9) return "12%";
  if (conviction >= 8) return "9%";
  if (conviction >= 7) return "7%";
  if (conviction >= 6) return "5%";
  return "0%";
}

// Get leverage based on conviction
function getLeverage(conviction) {
  if (conviction >= 10) return 10;
  if (conviction >= 9) return 7;
  if (conviction >= 8) return 5;
  if (conviction >= 7) return 3;
  return 2;
}

// Extract trade parameters from analysis text
function extractTradeParams(analysisText) {
  const patterns = {
    direction: /\*\*Direction:\*\*\s*(Long|Short)/i,
    entry: /\*\*Entry:\*\*\s*\$?([\d,]+\.?\d*)/i,
    stopLoss: /\*\*Stop Loss:\*\*\s*\$?([\d,]+\.?\d*)/i,
    takeProfit1: /\*\*Take Profit 1:\*\*\s*\$?([\d,]+\.?\d*)/i,
    takeProfit2: /\*\*Take Profit 2:\*\*\s*\$?([\d,]+\.?\d*)/i
  };

  const result = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = analysisText.match(pattern);
    if (match) {
      result[key] = key === "direction" ? match[1] : parseFloat(match[1].replace(/,/g, ""));
    }
  }

  // Validate all required fields
  if (result.direction && result.entry && result.stopLoss && result.takeProfit1 && result.takeProfit2) {
    return result;
  }
  return null;
}

// Place trade and post confirmation
async function executeTrade(asset, params, conviction, channel) {
  try {
    const balance = await getAccountBalance();
    const trade = await placeTrade({
      symbol: asset,
      direction: params.direction,
      entry: params.entry,
      stopLoss: params.stopLoss,
      takeProfit1: params.takeProfit1,
      takeProfit2: params.takeProfit2,
      conviction
    });

    trade.balance = balance;
    registerTrade(trade);
    await postTradeOpened(channel, trade);

  } catch (error) {
    console.error(`Failed to place trade for ${asset}:`, error.message);
    await channel.send(`⚠️ **Trade execution failed for ${asset}:** ${error.message}`);
  }
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
    const leverage = getLeverage(conviction);

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are an expert intraday trader using smart money concepts (SMC). Analyze the chart and provide EXACTLY this format:
- **Direction:** Long or Short
- **Setup Type:** (e.g. Order Block Retest, FVG Fill, BOS continuation, Liquidity Sweep)
- **Entry:** $specific_price
- **Stop Loss:** $specific_price
- **Take Profit 1:** $specific_price
- **Take Profit 2:** $specific_price
- **Grade:** A / B / C
- **Key Confluences:** list 2-3
Use EXACTLY the labels above so prices can be parsed automatically.`,
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
    await channel.send(`📊 **Conviction: ${conviction}/10 — Position Size: ${positionSize} of capital @ ${leverage}x leverage**\n\n${analysis}`);

  } catch (error) {
    console.error("Error analyzing chart:", error.message);
    await channel.send("⚠️ Something went wrong analyzing the chart.");
  }
}

// Multi-timeframe analysis with smart money concepts, news, and auto trading
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
      system: `You are an expert SMC intraday trader. Rate the overall multi-timeframe conviction from 1-10.
- Look for order block retests, FVG fills, BOS/CHOCH, liquidity sweeps
- Look for RSI divergence, VWAP reclaims, BB squeezes
- Only give 8+ if multiple timeframes and indicators align
- Factor in news sentiment
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
    const leverage = getLeverage(conviction);

    // Full SMC analysis
    const analysisContent = [...content];
    analysisContent.push({
      type: "text",
      text: "Provide up to 2 trade setups using EXACTLY this format for each:"
    });

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: `You are an expert intraday trader using smart money concepts (SMC). Provide up to 2 trade setups using EXACTLY this format:

- **Direction:** Long or Short
- **Setup Type:** (Order Block Retest / FVG Fill / BOS Continuation / Liquidity Sweep / CHOCH / BB Breakout)
- **Entry:** $specific_price
- **Stop Loss:** $specific_price
- **Take Profit 1:** $specific_price (1:1.5 R:R minimum)
- **Take Profit 2:** $specific_price (extended target)
- **Grade:** A / B / C
- **Timeframe Alignment:** (do 15m, 1h, 4h agree?)
- **Key Confluences:** 3-4 specific confluences
- **News Impact:** one line if relevant

Use EXACTLY the labels above. Be specific with prices.`,
      messages: [{ role: "user", content: analysisContent }]
    });

    const analysis = analysisResponse.content[0].text;
    const header = `📊 **${asset} Multi-TF Conviction: ${conviction}/10 — Position Size: ${positionSize} @ ${leverage}x leverage**\n\n`;
const fullMessage = header + analysis;

// Split into chunks of 1900 characters if too long
if (fullMessage.length <= 2000) {
  await channel.send(fullMessage);
} else {
  await channel.send(header);
  // Split analysis into 1900 char chunks
  for (let i = 0; i < analysis.length; i += 1900) {
    await channel.send(analysis.slice(i, i + 1900));
  }
}

   // Extract and execute trade if forced or conviction >= threshold
if (forceAnalysis || conviction >= threshold) {
  const params = extractTradeParams(analysis);
  if (params) {
    console.log(`Executing trade for ${asset}:`, params);
    await executeTrade(asset, params, conviction, channel);
  } else {
    console.warn(`Could not extract trade params for ${asset} from analysis`);
    await channel.send(`⚠️ Could not extract trade levels from analysis. Try again or check the chart manually.`);
  }
}

    return { conviction, analysis };

  } catch (error) {
    console.error(`Error in SMC analysis for ${asset}:`, error.message);
    await channel.send(`⚠️ Something went wrong analyzing ${asset}.`);
    return { conviction: 0, analysis: null };
  }
}