import axios from "axios";
import { generateChartImage } from "./chart.js";
import { analyzeMultiTimeframe } from "./analyzer.js";
import { saveChart } from "./storage.js";

export const SCAN_INTERVALS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 }
];

// Fetch OHLC candles from Kraken (free, no API key)
export async function fetchCandles(pair, minutes) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.get("https://api.kraken.com/0/public/OHLC", {
        params: { pair, interval: minutes },
        timeout: 10000
      });

      if (response.data.error && response.data.error.length > 0) {
        console.error(`Kraken error for ${pair}:`, response.data.error);
        return null;
      }

      const key = Object.keys(response.data.result).find(k => k !== "last");
      const candles = response.data.result[key];

      return candles.map(k => ({
        open: k[1].toString(),
        high: k[2].toString(),
        low: k[3].toString(),
        close: k[4].toString(),
        volume: k[6].toString()
      }));

    } catch (error) {
      console.error(`Fetch attempt ${attempt} failed for ${pair}:`, error.message);
      if (attempt === 2) return null;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

// Run full scanner using watchlist from state
export async function runScanner(channel, state) {
  const watchlist = state.watchlist || [];

  if (watchlist.length === 0) {
    await channel.send(`⚠️ Your watchlist is empty! Add assets with \`!watch BTC ETH SOL\``);
    return;
  }

  const assetNames = watchlist.map(a => a.symbol).join(", ");
  await channel.send(`🔍 **Scanning ${assetNames} across 15m, 1h, 4h timeframes...**`);

  for (const asset of watchlist) {
    try {
      console.log(`Fetching all timeframes for ${asset.symbol}...`);

      const charts = [];
      const imageBuffers = [];

      for (const interval of SCAN_INTERVALS) {
        const candles = await fetchCandles(asset.id, interval.minutes);

        if (!candles || candles.length === 0) {
          console.warn(`Missing candles for ${asset.symbol} ${interval.label}`);
          continue;
        }

        const imageBuffer = generateChartImage(candles, asset.symbol, interval.label);
        const base64 = imageBuffer.toString("base64");

        charts.push({ label: interval.label, base64, mediaType: "image/png" });
        imageBuffers.push({ label: interval.label, buffer: imageBuffer });

        await new Promise(res => setTimeout(res, 1500));
      }

      if (charts.length === 0) {
        await channel.send(`⚠️ Could not fetch any data for **${asset.symbol}** — skipping.`);
        continue;
      }

      state.lastChartBase64 = charts[0].base64;
      state.lastChartMediaType = "image/png";
      saveChart(charts[0].base64, "image/png");

      await channel.send({
        content: `📈 **${asset.symbol}/USD — Multi-Timeframe Analysis**`,
        files: imageBuffers.map(ib => ({
          attachment: ib.buffer,
          name: `${asset.symbol}_${ib.label}.png`
        }))
      });

      await analyzeMultiTimeframe(asset.symbol, charts, channel, false, state.convictionThreshold);
      await new Promise(res => setTimeout(res, 2000));

    } catch (error) {
      console.error(`Error scanning ${asset.symbol}:`, error.message);
      await channel.send(`⚠️ Error scanning **${asset.symbol}**.`);
    }
  }

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  await channel.send(`✅ **Scan complete** — ${now} EST`);
  state.lastScanTime = now;
}