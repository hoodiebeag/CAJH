/**
 * researchlib.mjs — shared helpers for the one-off research scripts
 * (baseline/isbeta/overlay/trail/simple/regime and others).
 *
 * Pure extraction, no behavior change: every script had its own copy of these three
 * things. Consolidated here so there's one place to fix a bug in the stats math instead
 * of four. Each script still owns its actual analysis; this is just the boilerplate.
 */
import fs from "fs";
import path from "path";
import { loadConfig, symbolToKrakenId } from "./storage.js";

const dataDir = () => process.env.DATA_DIR || ".";
// The only non-trivial reverse mapping symbolToKrakenId's PAIR_MAP applies (XBTUSD -> BTC,
// not XBTUSD -> XBT); every other pair id is SYMBOL + "USD".
const KRAKEN_ID_TO_SYMBOL = { XBTUSD: "BTC" };

/** Every symbol with a local candle file, read straight off disk (no config involved). */
function symbolsFromCandleStore() {
  const dir = path.join(dataDir(), "candles");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => f.slice(0, -4))
    .map((id) => KRAKEN_ID_TO_SYMBOL[id] || id.replace(/USD$/, ""))
    .filter(Boolean)
    .sort();
}

/** WATCHLIST env (comma-separated symbols) if set, else the persisted config's watchlist. */
export function loadWatchlist() {
  const env = (process.env.WATCHLIST || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (env.length) return env;
  // Older persisted configs stored bare symbols while current configs store { symbol, id }.
  // Research should accept both rather than silently producing an all-undefined universe.
  const configured = (loadConfig().watchlist || []).map((a) => typeof a === "string" ? a.toUpperCase() : a?.symbol).filter(Boolean);
  if (configured.length) return configured;
  // config.json's watchlist can be genuinely persisted as [] (a fresh checkout, or an
  // operator who cleared it for the live scanner) without that meaning no research
  // universe exists. Research needs whatever candle data is actually on disk, independent
  // of what the live bot is currently configured to watch - this never reads or writes
  // config.json and changes no live-trading behavior.
  return symbolsFromCandleStore();
}

export { symbolToKrakenId };

/** "YYYY-MM-DD" → unix seconds at UTC midnight. */
export const ts = (d) => Date.parse(d + "T00:00:00Z") / 1000;

/** The live entry timeframes, [label, minutes] — duplicated verbatim in several scripts. */
export const TFS = [["1h", 60], ["4h", 240], ["1d", 1440]];

/**
 * Sample stats for an array of per-trade R values: mean, sample stdev (n-1), standard
 * error, 95% CI half-width, win rate, total, and the best single value. Every script's
 * local `stat()` computed a subset of this same formula under different field names —
 * this is the superset; callers destructure what they need.
 */
export function stat(arr) {
  const n = arr.length;
  const mean = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n ? sd / Math.sqrt(n) : 0;
  const ci = 1.96 * se;
  return {
    n, mean, sd, se, ci,
    lo: mean - ci, hi: mean + ci,
    wr: n ? arr.filter(x => x > 0).length / n : 0,
    total: mean * n,
    best: n ? Math.max(...arr) : 0,
  };
}
