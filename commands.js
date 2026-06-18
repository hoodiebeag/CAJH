import Anthropic from "@anthropic-ai/sdk";
import { analyzeChart } from "./analyzer.js";
import { runScanner, SCAN_INTERVALS } from "./scanner.js";
import { loadChart, saveConfig, symbolToKrakenId } from "./storage.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function handleHelp(message, state) {
  const watchlist = state.watchlist.map(a => a.symbol).join(", ");
  await message.reply(`**@c Commands**

**Chart Requests** — Ask me to pull a chart:
> \`@c show me BTC on the 15 minute\`
> \`@c pull ETH 1 hour chart\`

**Scanner:**
> \`!scan\` — Scan your watchlist across 15m, 1h, 4h
> \`!watchlist\` — Show current watchlist
> \`!watch BTC ETH SOL\` — Add assets to watchlist
> \`!unwatch TAO\` — Remove asset from watchlist
> \`!setchannel\` — Set this channel for market open scans
> \`!setconviction <1-10>\` — Set minimum conviction threshold (currently **${state.convictionThreshold}**)
> \`!status\` — Show bot status

**Request Analysis:**
> \`@c analyze that\` — Force analyze the last chart

**General Questions:**
> \`@c what is RSI?\`
> \`@c explain support and resistance\`

> \`!help\` — Show this message

**Current watchlist:** ${watchlist}`);
}

export async function handleWatchlist(message, state) {
  const watchlist = state.watchlist.map(a => a.symbol).join(", ");
  await message.reply(`📋 **Current Watchlist:** ${watchlist}`);
}

export async function handleWatch(message, state, config, symbols) {
  if (!symbols || symbols.length === 0) {
    await message.reply(`⚠️ Please provide at least one symbol. Example: \`!watch BTC ETH SOL\``);
    return;
  }

  const added = [];
  const already = [];

  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const exists = state.watchlist.find(a => a.symbol === upper);
    if (exists) {
      already.push(upper);
    } else {
      const id = symbolToKrakenId(upper);
      state.watchlist.push({ id, symbol: upper });
      added.push(upper);
    }
  }

  config.watchlist = state.watchlist;
  saveConfig(config);

  let reply = "";
  if (added.length > 0) reply += `✅ Added to watchlist: **${added.join(", ")}**\n`;
  if (already.length > 0) reply += `ℹ️ Already on watchlist: **${already.join(", ")}**\n`;
  reply += `📋 **Current watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}`;

  await message.reply(reply);
}

export async function handleUnwatch(message, state, config, symbols) {
  if (!symbols || symbols.length === 0) {
    await message.reply(`⚠️ Please provide at least one symbol. Example: \`!unwatch TAO\``);
    return;
  }

  const removed = [];
  const notFound = [];

  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const index = state.watchlist.findIndex(a => a.symbol === upper);
    if (index !== -1) {
      state.watchlist.splice(index, 1);
      removed.push(upper);
    } else {
      notFound.push(upper);
    }
  }

  config.watchlist = state.watchlist;
  saveConfig(config);

  let reply = "";
  if (removed.length > 0) reply += `✅ Removed from watchlist: **${removed.join(", ")}**\n`;
  if (notFound.length > 0) reply += `ℹ️ Not on watchlist: **${notFound.join(", ")}**\n`;
  reply += `📋 **Current watchlist:** ${state.watchlist.map(a => a.symbol).join(", ") || "empty"}`;

  await message.reply(reply);
}

export async function handleSetChannel(message, state, config) {
  state.scanChannelId = message.channel.id;
  config.scanChannelId = message.channel.id;
  saveConfig(config);
  await message.reply(`✅ Market open scans will post in this channel!`);
}

export async function handleSetConviction(message, state, config, value) {
  const threshold = parseInt(value);
  if (isNaN(threshold) || threshold < 1 || threshold > 10) {
    await message.reply(`⚠️ Please provide a number between 1 and 10. Example: \`!setconviction 7\``);
    return;
  }
  state.convictionThreshold = threshold;
  config.convictionThreshold = threshold;
  saveConfig(config);
  await message.reply(`✅ Conviction threshold set to **${threshold}/10** — only setups scoring ${threshold}+ will get full analysis.`);
}

export async function handleStatus(message, state) {
  const channel = state.scanChannelId ? `<#${state.scanChannelId}>` : "Not set — use \`!setchannel\`";
  const lastScan = state.lastScanTime || "No scan run yet";
  await message.reply(`📡 **Bot Status**

**Scan channel:** ${channel}
**Last scan:** ${lastScan}
**Watchlist:** ${state.watchlist.map(a => a.symbol).join(", ")}
**Timeframes:** ${SCAN_INTERVALS.map(i => i.label).join(", ")}
**Conviction threshold:** ${state.convictionThreshold}/10`);
}

export async function handleScan(message, state) {
  state.scanChannelId = message.channel.id;
  await runScanner(message.channel, state);
}

export async function handleAnalyzeThat(message, state) {
  let base64 = state.lastChartBase64;
  let mediaType = state.lastChartMediaType;

  if (!base64) {
    const saved = loadChart();
    if (saved) {
      base64 = saved.base64;
      mediaType = saved.mediaType;
    }
  }

  if (base64) {
    await message.reply("Analyzing the last chart for you...");
    await analyzeChart(base64, mediaType, message.channel, true, state.convictionThreshold);
  } else {
    await message.reply("No chart to analyze yet! Pull one with a `!fc` command first.");
  }
}

export async function handleChartRequest(message, userMessage) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 50,
    system: `You are a Discord trading bot called @c. You have the ability to pull charts by sending !fc commands in Discord. A separate bot called Tree Capital will respond to these commands and display the chart.
If the user is asking for a chart, respond with ONLY the correct !fc command and nothing else.
If they are NOT asking for a chart, respond with ONLY the word "NOTACHART".

!fc command format:
- Basic: !fc btc
- With timeframe: !fc btc 1d
- With exchange: !fc btc binance
- With timeframe and exchange: !fc btc binance 15m
- With indicators: !fc btc binance 15m ema20 ema50
- Multiple tickers: !fc btc,eth,sol 15m
- Shortcuts: !fcb (BTC 1m Binance), !fce (ETH 1m Binance), !fcs (SOL 1m Binance)
- Supported indicators: MA, EMA, BB, RSI, MACD
- Available timeframes: 1m, 5m, 15m, 30m, 1h, 4h, 1d`,
    messages: [{ role: "user", content: userMessage }]
  });

  const command = response.content[0].text.trim();
  if (command !== "NOTACHART" && (command.startsWith("!fc") || command.startsWith("!fcb") || command.startsWith("!fce") || command.startsWith("!fcs"))) {
    await message.channel.send(command);
    return true;
  }
  return false;
}

export async function handleGeneral(message, userMessage) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are a Discord trading bot called @c. You are an expert intraday trader and technical analyst. You have the ability to pull charts by sending !fc commands which trigger a chart bot called Tree Capital. You can also run market scans with !scan. Keep responses concise and trading focused.`,
    messages: [{ role: "user", content: userMessage }]
  });
  await message.reply(response.content[0].text);
}

export async function handleManualTrade(message, state, symbol) {
  const upper = symbol.toUpperCase();
  await message.reply(`🔍 Analyzing **${upper}** across 15m, 1h, 4h to find the best trade levels...`);

  try {
    const { fetchCandles } = await import("./scanner.js");
    const { generateChartImage } = await import("./chart.js");
    const { analyzeMultiTimeframe } = await import("./analyzer.js");
    const { symbolToKrakenId } = await import("./storage.js");

    const krakenId = symbolToKrakenId(upper);
    const intervals = [
      { label: "15m", minutes: 15 },
      { label: "1h", minutes: 60 },
      { label: "4h", minutes: 240 }
    ];

    const charts = [];
    const imageBuffers = [];

    for (const interval of intervals) {
      const candles = await fetchCandles(krakenId, interval.minutes);
      if (!candles || candles.length === 0) {
        console.warn(`Missing candles for ${upper} ${interval.label}`);
        continue;
      }

      const imageBuffer = generateChartImage(candles, upper, interval.label);
      const base64 = imageBuffer.toString("base64");

      charts.push({ label: interval.label, base64, mediaType: "image/png" });
      imageBuffers.push({ label: interval.label, buffer: imageBuffer });

      await new Promise(res => setTimeout(res, 1500));
    }

    if (charts.length === 0) {
      await message.reply(`⚠️ Could not fetch chart data for **${upper}**. Check the symbol and try again.`);
      return;
    }

    // Post charts
    await message.channel.send({
      content: `📈 **${upper}/USD — Manual Trade Analysis**`,
      files: imageBuffers.map(ib => ({
        attachment: ib.buffer,
        name: `${upper}_${ib.label}.png`
      }))
    });

    // Force analysis regardless of conviction threshold
    await analyzeMultiTimeframe(upper, charts, message.channel, true, state.convictionThreshold);

  } catch (error) {
    console.error(`Manual trade error for ${symbol}:`, error.message);
    await message.reply(`⚠️ Something went wrong analyzing **${upper}**: ${error.message}`);
  }
}