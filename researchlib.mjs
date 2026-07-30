/**
 * researchlib.mjs — shared helpers for the one-off research scripts
 * (baseline/isbeta/overlay/trail/simple/regime/flowsignal).
 *
 * Pure extraction, no behavior change: every script had its own copy of these three
 * things. Consolidated here so there's one place to fix a bug in the stats math instead
 * of four. Each script still owns its actual analysis; this is just the boilerplate.
 */
import { loadConfig, symbolToKrakenId } from "./storage.js";

/** WATCHLIST env (comma-separated symbols) if set, else the persisted config's watchlist. */
export function loadWatchlist() {
  const env = (process.env.WATCHLIST || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  return env.length ? env : (loadConfig().watchlist || []).map(a => a.symbol);
}

export { symbolToKrakenId };

/** "YYYY-MM-DD" → unix seconds at UTC midnight. */
export const ts = (d) => Date.parse(d + "T00:00:00Z") / 1000;

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
