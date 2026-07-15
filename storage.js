/**
 * storage.js — Config persistence and chart caching
 * Settings are loaded from Railway environment variables.
 * Runtime changes are held in memory — update Railway vars to make permanent.
 */

import fs   from "fs";
import path from "path";
import * as logger from './logger.js';

// Where persistent files (config.json, positions.json) live. On Railway, attach a
// volume and set DATA_DIR to its mount path (e.g. /data) so they survive redeploys.
// Falls back to the app directory when DATA_DIR is unset (local dev).
const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* dir already exists */ }

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

/** Is this Discord user cajh's owner? Gates trading commands and source disclosure. */
export function isOwner(userId) {
  return userId === (process.env.BEAG_USER_ID || "795521432783552552");
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

const CONFIG_FILE = path.join(DATA_DIR, "config.json");

// ─── Open-trade persistence ────────────────────────────────────────────────────
// Open positions live in memory, so a restart would otherwise lose them (and stop
// managing their exits). We mirror them to positions.json so the bot recovers on
// boot. NOTE: on an ephemeral host (Railway without a mounted volume) this file is
// wiped on every *redeploy* — attach a volume to make recovery durable across deploys.

const POSITIONS_FILE = path.join(DATA_DIR, "positions.json");

export function saveTrades(trades) {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(trades, null, 2));
  } catch (err) {
    logger.error("[STORAGE] Failed to save positions.json:", err.message);
  }
}

export function loadTrades() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    logger.error("[STORAGE] Could not read positions.json:", err.message);
  }
  return [];
}

const STATS_FILE = path.join(DATA_DIR, "stats.json");

export function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    logger.error("[STORAGE] Failed to save stats.json:", err.message);
  }
}

export function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    }
  } catch (err) {
    logger.error("[STORAGE] Could not read stats.json:", err.message);
  }
  return null;
}

function readConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (err) {
    logger.error("[STORAGE] Could not read config.json:", err.message);
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
    logger.error("[STORAGE] Failed to save config.json:", err.message);
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