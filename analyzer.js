import Anthropic from "@anthropic-ai/sdk";
import { fetchNews } from "./news.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Analyze a single chart from Tree Capital
export async function analyzeChart(base64, mediaType, channel, forceAnalysis = false, threshold = 8) {
  try {
    console.log(`Analyzing chart, base64 length: ${base64.length}`);

    const convictionResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `You are an expert intraday trader. Look at this chart and rate the trade setup conviction from 1-10.
1 = very poor setup, no clear trade
10 = extremely high conviction, must-enter trade
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

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are an expert intraday trader. When given a chart image, provide:
- Entry price
- Exit (take profit) price
- Stop loss price
- 2-3 key observations supporting the trade
Be brief and to the point. Price levels only, no lengthy explanations.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Please analyze this chart." }
          ]
        }
      ]
    });

    const analysis = analysisResponse.content[0].text;
    await channel.send(`📊 **Conviction: ${conviction}/10**\n\n${analysis}`);

  } catch (error) {
    console.error("Error analyzing chart:", error.message);
    await channel.send("⚠️ Something went wrong analyzing the chart.");
  }
}

// Multi-timeframe analysis with news awareness
export async function analyzeMultiTimeframe(asset, charts, channel, forceAnalysis = false, threshold = 8) {
  try {
    console.log(`Running multi-timeframe analysis for ${asset}...`);

    // Fetch latest news for this asset
    const headlines = await fetchNews(asset);
    const newsContext = headlines.length > 0
      ? `Latest news headlines for ${asset}:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : `No recent news found for ${asset}.`;

    console.log(`News for ${asset}:`, headlines);

    // Build content array with news + all 3 charts
    const content = [
      { type: "text", text: `${newsContext}\n\nHere are three timeframe charts for ${asset}. Analyze them together considering the news context.` }
    ];

    for (const chart of charts) {
      content.push({ type: "text", text: `**${chart.label} chart:**` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: chart.mediaType, data: chart.base64 }
      });
    }

    // Get combined conviction score
    const convictionResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `You are an expert intraday trader. You will be given recent news headlines and 3 timeframe charts (15m, 1h, 4h) for the same asset.
Rate the overall multi-timeframe trade setup conviction from 1-10, factoring in both technical and news context.
- Downgrade conviction if there are major negative catalysts (hacks, bans, crashes, bad regulation)
- Upgrade conviction if there are strong positive catalysts (ETF approval, major partnerships, listings)
- Only give a high score (${threshold}+) if multiple timeframes agree AND news sentiment supports the trade
1 = no clear setup, conflicting timeframes, or negative news
10 = all timeframes strongly agree + positive news catalyst
Respond with ONLY a single number between 1 and 10. Nothing else.`,
      messages: [{ role: "user", content }]
    });

    const conviction = parseInt(convictionResponse.content[0].text.trim());
    console.log(`Multi-timeframe conviction for ${asset}: ${conviction}`);

    if (conviction < threshold && !forceAnalysis) {
      await channel.send(`📊 **${asset} Multi-TF Conviction: ${conviction}/10** — Timeframes not aligned or news unfavorable, no setup recommended.`);
      return { conviction, analysis: null };
    }

    // Get full analysis with news context
    const analysisContent = [...content];
    analysisContent.push({
      type: "text",
      text: "Based on all three timeframes and the news context, provide a concise intraday trade setup with entry, exit, and stop loss. Mention any relevant news impact briefly."
    });

    const analysisResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are an expert intraday trader doing multi-timeframe analysis with news awareness. When given news headlines and 15m, 1h, and 4h charts, provide:
- Trade direction (long/short)
- Entry price
- Exit (take profit) price
- Stop loss price
- Timeframe alignment summary
- News impact (1 line only if relevant)
- 2-3 key technical observations
Be concise and specific with price levels.`,
      messages: [{ role: "user", content: analysisContent }]
    });

    const analysis = analysisResponse.content[0].text;
    await channel.send(`📊 **${asset} Multi-TF Conviction: ${conviction}/10**\n\n${analysis}`);
    return { conviction, analysis };

  } catch (error) {
    console.error(`Error in multi-timeframe analysis for ${asset}:`, error.message);
    await channel.send(`⚠️ Something went wrong analyzing ${asset}.`);
    return { conviction: 0, analysis: null };
  }
}