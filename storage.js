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
// Falls back to the app directory when DATA_DIR is unset (local dev/research only).
const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* dir already exists */ }
export const DATA_DIR_EXPLICIT = Boolean(process.env.DATA_DIR);

export function checkStoragePreflight() {
  if (!DATA_DIR_EXPLICIT) {
    return { ok: false, reason: "DATA_DIR must be explicitly set for live trading" };
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.cajh-preflight-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (err) {
    return { ok: false, reason: `DATA_DIR is not writable: ${err.message}` };
  }
  const preflightReads = [
    ["positions", readRecord(POSITIONS_FILE, "positions", validTrades)],
    ["stats", readRecord(STATS_FILE, "stats", validStats)],
    ["config", readRecord(CONFIG_FILE, "config", validConfig)]
  ];
  for (const [kind, result] of preflightReads) {
    setHealth(
      kind,
      result.source === "unsafe"
        ? result
        : { ok: true, source: result.source, reason: result.reason ?? null }
    );
  }
  const health = getStorageHealth();
  for (const kind of ["positions", "stats", "config"]) {
    if (health[kind]?.ok === false) return { ok: false, reason: `${kind} persistence is unsafe: ${health[kind].reason ?? health[kind].source}` };
  }
  return { ok: true, dataDir: DATA_DIR };
}

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
const LEVEL_COOLDOWNS_FILE = path.join(DATA_DIR, "level_cooldowns.json");
const DECISION_JOURNAL_FILE = path.join(DATA_DIR, "decision-journal.jsonl");
const STORAGE_VERSION = 1;
const storageHealth = new Map();

const backupFile = (file) => `${file}.bak`;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function validJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  return isObject(value) && Object.values(value).every(validJson);
}

function validTrades(trades) {
  return Array.isArray(trades) && trades.every(trade => {
    if (!isObject(trade) || typeof trade.symbol !== "string" || !trade.symbol.trim()) return false;
    if (!isFiniteNumber(trade.entry) || trade.entry <= 0) return false;
    if (!isFiniteNumber(trade.stopLoss) || trade.stopLoss <= 0 || trade.stopLoss >= trade.entry) return false;
    if (!isFiniteNumber(trade.takeProfit) || trade.takeProfit <= trade.entry) return false;
    if (!isFiniteNumber(trade.risk) || trade.risk <= 0) return false;
    if (!isFiniteNumber(trade.volume) || trade.volume <= 0) return false;
    return validJson(trade);
  });
}

function validLevelCooldowns(records) {
  return Array.isArray(records) && records.every(record =>
    isObject(record) &&
    typeof record.key === "string" &&
    record.key.length > 0 &&
    isFiniteNumber(record.until) &&
    record.until > 0 &&
    validJson(record)
  );
}

function validStats(stats) {
  return isObject(stats) && validJson(stats) &&
    (stats.date === undefined || typeof stats.date === "string") &&
    (stats.dailyStartBalance === undefined || stats.dailyStartBalance === null || (isFiniteNumber(stats.dailyStartBalance) && stats.dailyStartBalance >= 0)) &&
    (stats.dailyPnl === undefined || (isFiniteNumber(stats.dailyPnl))) &&
    (stats.tradesToday === undefined || (Number.isInteger(stats.tradesToday) && stats.tradesToday >= 0));
}

function validConfig(config) {
  return isObject(config) && validJson(config);
}

function unpack(raw, kind, validate) {
  const value = isObject(raw) && raw.storageVersion === STORAGE_VERSION && raw.kind === kind && "data" in raw
    ? raw.data
    : raw;
  return validate(value) ? value : null;
}

function readFile(file, kind, validate) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = unpack(raw, kind, validate);
  if (value === null) throw new Error(`invalid ${kind} schema`);
  return value;
}

function atomicWrite(file, kind, value, validate) {
  if (!validate(value)) throw new Error(`refusing to persist invalid ${kind}`);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const payload = JSON.stringify({ storageVersion: STORAGE_VERSION, kind, data: value }, null, 2);
  let fd;
  try {
    fd = fs.openSync(temp, "w");
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(file)) {
      try { readFile(file, kind, validate); fs.copyFileSync(file, backupFile(file)); }
      catch { /* retain the previous known-good backup */ }
    }
    fs.renameSync(temp, file);
  } catch (err) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
    throw err;
  }
}

function readRecord(file, kind, validate) {
  try {
    if (fs.existsSync(file)) {
      return { ok: true, value: readFile(file, kind, validate), source: "primary" };
    }
    if (!fs.existsSync(backupFile(file))) {
      return { ok: false, value: null, source: "missing", reason: `${kind} file is missing` };
    }
  } catch (err) {
    logger.error(`[STORAGE] Could not read ${path.basename(file)}:`, err.message);
  }
  try {
    const value = readFile(backupFile(file), kind, validate);
    atomicWrite(file, kind, value, validate);
    return { ok: false, value, source: "backup", reason: `${kind} recovered from backup` };
  } catch (err) {
    logger.error(`[STORAGE] Could not recover ${path.basename(file)}:`, err.message);
    return { ok: false, value: null, source: "unsafe", reason: `${kind} state is unreadable` };
  }
}

function setHealth(kind, result) {
  storageHealth.set(kind, { ok: result.ok, source: result.source, reason: result.reason ?? null });
  return result;
}

/** Explicit persistence status for the future monitor/entry health gate. */
export function getStorageHealth() {
  return Object.fromEntries(storageHealth);
}

/**
 * Append an immutable record of a live decision.  JSON Lines allows a deploy to
 * resume analysis without rewriting or losing prior history.  Keep this journal
 * on the same persistent DATA_DIR volume as positions.json.
 */
export function appendDecisionEvent(event) {
  if (!isObject(event) || typeof event.type !== "string" || !event.type || !validJson(event)) {
    throw new Error("invalid decision journal event");
  }
  const record = {
    schema: "cajh-decision-event/v1",
    id: `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    deployment: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.DEPLOYMENT_ID ?? null,
    ...event,
  };
  try {
    const fd = fs.openSync(DECISION_JOURNAL_FILE, "a");
    fs.writeFileSync(fd, JSON.stringify(record) + "\n");
    fs.fsyncSync(fd); fs.closeSync(fd);
    setHealth("decisionJournal", { ok: true, source: "append" });
    return record;
  } catch (err) {
    logger.error("[STORAGE] Failed to append decision journal:", err.message);
    setHealth("decisionJournal", { ok: false, source: "unsafe", reason: err.message });
    return null;
  }
}

export function loadDecisionJournal({ limit = 5000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("journal limit must be a positive integer");
  if (!fs.existsSync(DECISION_JOURNAL_FILE)) {
    setHealth("decisionJournal", { ok: true, source: "missing" });
    return [];
  }
  try {
    const entries = fs.readFileSync(DECISION_JOURNAL_FILE, "utf8").split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((record) => record?.schema === "cajh-decision-event/v1");
    setHealth("decisionJournal", { ok: true, source: "primary" });
    return entries.slice(-limit);
  } catch (err) {
    setHealth("decisionJournal", { ok: false, source: "unsafe", reason: err.message });
    return [];
  }
}

/** Detailed position result. Callers that manage entries must reject ok: false. */
export function loadTradesResult() {
  return setHealth("positions", readRecord(POSITIONS_FILE, "positions", validTrades));
}

export function saveTrades(trades) {
  try {
    atomicWrite(POSITIONS_FILE, "positions", trades, validTrades);
    setHealth("positions", { ok: true, source: "primary" });
    return true;
  } catch (err) {
    logger.error("[STORAGE] Failed to save positions.json:", err.message);
    setHealth("positions", { ok: false, source: "unsafe", reason: err.message });
    return false;
  }
}

export function loadTrades() {
  const result = loadTradesResult();
  return result.value ?? [];
}

export function loadLevelCooldownsResult() {
  return setHealth("levelCooldowns", readRecord(LEVEL_COOLDOWNS_FILE, "levelCooldowns", validLevelCooldowns));
}

export function saveLevelCooldowns(records) {
  try {
    atomicWrite(LEVEL_COOLDOWNS_FILE, "levelCooldowns", records, validLevelCooldowns);
    setHealth("levelCooldowns", { ok: true, source: "primary" });
    return true;
  } catch (err) {
    logger.error("[STORAGE] Failed to save level_cooldowns.json:", err.message);
    setHealth("levelCooldowns", { ok: false, source: "unsafe", reason: err.message });
    return false;
  }
}

const STATS_FILE = path.join(DATA_DIR, "stats.json");

export function saveStats(stats) {
  try {
    atomicWrite(STATS_FILE, "stats", stats, validStats);
    setHealth("stats", { ok: true, source: "primary" });
    return true;
  } catch (err) {
    logger.error("[STORAGE] Failed to save stats.json:", err.message);
    setHealth("stats", { ok: false, source: "unsafe", reason: err.message });
    return false;
  }
}

export function loadStats() {
  const result = setHealth("stats", readRecord(STATS_FILE, "stats", validStats));
  return result.value;
}

function readConfigFile() {
  const result = setHealth("config", readRecord(CONFIG_FILE, "config", validConfig));
  return result.value ?? {};
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
    atomicWrite(CONFIG_FILE, "config", payload, validConfig);
    setHealth("config", { ok: true, source: "primary" });
    return true;
  } catch (err) {
    logger.error("[STORAGE] Failed to save config.json:", err.message);
    setHealth("config", { ok: false, source: "unsafe", reason: err.message });
    return false;
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
