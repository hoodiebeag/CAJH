import fs from "fs";
import path from "path";

const CHART_PATH = process.cwd();

const DEFAULT_ASSETS = [
  { id: "XBTUSD", symbol: "BTC" },
  { id: "ETHUSD", symbol: "ETH" },
  { id: "SOLUSD", symbol: "SOL" },
  { id: "BNBUSD", symbol: "BNB" },
  { id: "TAOUSD", symbol: "TAO" }
];

// Map symbol to Kraken pair ID
export function symbolToKrakenId(symbol) {
  const map = {
    BTC: "XBTUSD",
    ETH: "ETHUSD",
    SOL: "SOLUSD",
    BNB: "BNBUSD",
    TAO: "TAOUSD",
    XRP: "XRPUSD",
    ADA: "ADAUSD",
    DOGE: "DOGEUSD",
    AVAX: "AVAXUSD",
    LINK: "LINKUSD",
    DOT: "DOTUSD",
    MATIC: "MATICUSD",
    LTC: "LTCUSD",
    UNI: "UNIUSD",
    ATOM: "ATOMUSD"
  };
  return map[symbol.toUpperCase()] || `${symbol.toUpperCase()}USD`;
}

// Parse watchlist from env variable (e.g. "BTC,ETH,SOL")
function parseWatchlist(watchlistEnv) {
  if (!watchlistEnv) return DEFAULT_ASSETS;
  return watchlistEnv.split(",").map(s => {
    const symbol = s.trim().toUpperCase();
    return { id: symbolToKrakenId(symbol), symbol };
  });
}

// Load config from environment variables
export function loadConfig() {
  return {
    scanChannelId: process.env.SCAN_CHANNEL_ID || null,
    convictionThreshold: parseInt(process.env.CONVICTION_THRESHOLD) || 8,
    watchlist: parseWatchlist(process.env.WATCHLIST)
  };
}

// Save config — updates in-memory state only
// To persist changes, update Railway environment variables
export function saveConfig(config) {
  console.log("Config updated in memory:", {
    scanChannelId: config.scanChannelId,
    convictionThreshold: config.convictionThreshold,
    watchlist: config.watchlist?.map(a => a.symbol).join(",")
  });
}

// Save chart to disk
export function saveChart(base64, mediaType) {
  const ext = mediaType.split("/")[1];
  const filepath = path.join(CHART_PATH, `last_chart.${ext}`);
  fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
  console.log(`Chart saved to ${filepath}`);
}

// Load chart from disk
export function loadChart() {
  const extensions = ["png", "jpg", "jpeg", "webp"];
  for (const ext of extensions) {
    const filepath = path.join(CHART_PATH, `last_chart.${ext}`);
    if (fs.existsSync(filepath)) {
      const base64 = fs.readFileSync(filepath).toString("base64");
      console.log(`Loaded chart from disk, base64 length: ${base64.length}`);
      return { base64, mediaType: `image/${ext}` };
    }
  }
  return null;
}