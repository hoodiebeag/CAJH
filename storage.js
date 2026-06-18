/**
 * storage.js — Config persistence and chart caching
 * Settings are loaded from Railway environment variables.
 * Runtime changes are held in memory — update Railway vars to make permanent.
 */

import fs   from "fs";
import path from "path";

// ─── Curated watchlist ─────────────────────────────────────────────────────────
// 20 most liquid Kraken spot pairs — Tier 1 (core) + Tier 2 (mid cap)

const DEFAULT_WATCHLIST = [
  // Tier 1 — Core
  { id: "XBTUSD",   symbol: "BTC"   },
  { id: "ETHUSD",   symbol: "ETH"   },
  { id: "SOLUSD",   symbol: "SOL"   },
  { id: "XRPUSD",   symbol: "XRP"   },
  { id: "ADAUSD",   symbol: "ADA"   },
  { id: "DOGEUSD",  symbol: "DOGE"  },
  { id: "AVAXUSD",  symbol: "AVAX"  },
  { id: "LINKUSD",  symbol: "LINK"  },
  { id: "LTCUSD",   symbol: "LTC"   },
  { id: "DOTUSD",   symbol: "DOT"   },
  // Tier 2 — Mid cap
  { id: "UNIUSD",   symbol: "UNI"   },
  { id: "ATOMUSD",  symbol: "ATOM"  },
  { id: "POLUSD",   symbol: "POL"   },
  { id: "NEARUSD",  symbol: "NEAR"  },
  { id: "FILUSD",   symbol: "FIL"   },
  { id: "APTUSD",   symbol: "APT"   },
  { id: "INJUSD",   symbol: "INJ"   },
  { id: "TAOUSD",   symbol: "TAO"   },
  { id: "TIAUSD",   symbol: "TIA"   },
  { id: "SUIUSD",   symbol: "SUI"   }
];

// ─── Pair mapping ──────────────────────────────────────────────────────────────

const PAIR_MAP = {
  BTC:   "XBTUSD",   ETH:   "ETHUSD",   SOL:   "SOLUSD",
  XRP:   "XRPUSD",   ADA:   "ADAUSD",   DOGE:  "DOGEUSD",
  AVAX:  "AVAXUSD",  LINK:  "LINKUSD",  LTC:   "LTCUSD",
  DOT:   "DOTUSD",   UNI:   "UNIUSD",   ATOM:  "ATOMUSD",
  POL:   "POLUSD",   MATIC: "POLUSD",   NEAR:  "NEARUSD",
  FIL:   "FILUSD",   APT:   "APTUSD",   INJ:   "INJUSD",
  TAO:   "TAOUSD",   TIA:   "TIAUSD",   SUI:   "SUIUSD",
  BNB:   "BNBUSD"
};

export function symbolToKrakenId(symbol) {
  return PAIR_MAP[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`;
}

/** Parse a comma-separated WATCHLIST env var into the internal format. */
function parseWatchlist(raw) {
  if (!raw) return DEFAULT_WATCHLIST;
  return raw.split(",").map(s => {
    const symbol = s.trim().toUpperCase();
    return { id: symbolToKrakenId(symbol), symbol };
  });
}

// ─── Config ────────────────────────────────────────────────────────────────────
// Settings are seeded from environment variables on first run, then persisted to
// config.json so runtime changes (!watch, !setchannel) survive a
// restart. NOTE: on hosts with an ephemeral filesystem (e.g. Railway without a
// mounted volume) this file is wiped on redeploy — attach a volume or set the env
// vars for durable defaults.

const CONFIG_FILE = path.join(process.cwd(), "config.json");

function readConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (err) {
    console.error("[STORAGE] Could not read config.json:", err.message);
  }
  return {};
}

export function loadConfig() {
  const file = readConfigFile();
  return {
    scanChannelId: file.scanChannelId ?? process.env.SCAN_CHANNEL_ID ?? null,
    watchlist:     file.watchlist     ?? parseWatchlist(process.env.WATCHLIST),
    lastScanTime:  file.lastScanTime  ?? null
  };
}

export function saveConfig(config) {
  try {
    const payload = {
      scanChannelId: config.scanChannelId ?? null,
      watchlist:     config.watchlist     ?? [],
      lastScanTime:  config.lastScanTime  ?? null
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("[STORAGE] Failed to save config.json:", err.message);
  }
}

// ─── Chart cache ───────────────────────────────────────────────────────────────

const CHART_DIR = process.cwd();

export function saveChart(base64, mediaType) {
  const ext      = mediaType.split("/")[1] ?? "png";
  const filepath = path.join(CHART_DIR, `last_chart.${ext}`);
  fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
}

export function loadChart() {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const filepath = path.join(CHART_DIR, `last_chart.${ext}`);
    if (fs.existsSync(filepath)) {
      return { base64: fs.readFileSync(filepath).toString("base64"), mediaType: `image/${ext}` };
    }
  }
  return null;
}