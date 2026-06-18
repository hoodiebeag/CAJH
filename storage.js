import fs from "fs";
import path from "path";

const CHART_PATH = process.cwd();
const CONFIG_FILE = path.join(process.cwd(), "config.json");

const DEFAULT_ASSETS = [
  { id: "XBTUSD", symbol: "BTC" },
  { id: "ETHUSD", symbol: "ETH" },
  { id: "SOLUSD", symbol: "SOL" },
  { id: "BNBUSD", symbol: "BNB" },
  { id: "TAOUSD", symbol: "TAO" }
];

// Load config
export function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!config.convictionThreshold) config.convictionThreshold = 8;
    if (!config.watchlist) config.watchlist = DEFAULT_ASSETS;
    return config;
  }
  return { convictionThreshold: 8, watchlist: DEFAULT_ASSETS };
}

// Save config
export function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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