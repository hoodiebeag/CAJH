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

/**
 * Sealed-symbol holdout (ROADMAP.md "Finding an edge": walk-forward + sealed holdout, time
 * AND symbol — "the honest final validation; the last piece of the judge"). A small, fixed set
 * of symbols frozen out of every train/holdout cycle project-wide, so a genuinely untouched
 * universe exists for the eventual final validation of a promoted candidate. Chosen once
 * (2026-08-14, before any study has used this harness) and must never be edited afterward —
 * adding or removing a symbol here would retroactively un-seal or re-seal data a prior run
 * already touched, defeating the point. Deliberately excludes BTC/ETH/SOL/XRP (the majors most
 * verdicts in VERDICTS.md are already anchored to) so the active pool stays representative; the
 * five chosen span different market segments (L1s, an oracle network, a DeFi blue-chip) rather
 * than clustering in one category. Distinct from momentum.mjs's STABLE_13/PRIMARY_SYMBOL_HOLDOUT,
 * which is that study's own train/holdout split, not this project-wide seal.
 */
export const SEALED_SYMBOLS = Object.freeze(["AVAX", "LINK", "NEAR", "SUI", "UNI"]);

/**
 * Partitions a watchlist (string symbols or {symbol,id} entries — loadWatchlist()'s two output
 * shapes) into { active, sealed } using SEALED_SYMBOLS. Every existing train/holdout sweep
 * should run over `active` only; `sealed` is reserved for the one-time final validation this
 * harness exists to enable, not for use in any train/holdout cycle before that.
 */
export function splitSealedSymbols(watchlist) {
  const active = [], sealed = [];
  for (const entry of watchlist) {
    const symbol = typeof entry === "string" ? entry : entry?.symbol;
    (SEALED_SYMBOLS.includes(symbol) ? sealed : active).push(entry);
  }
  return { active, sealed };
}

/**
 * Rolling (anchored/expanding) walk-forward folds over one time-sorted candle array, replacing
 * a single static train/holdout split with `folds` successive windows: fold i's train is
 * candles[0, cut_i) and its holdout is the next unseen slice candles[cut_i, cut_{i+1}) — each
 * fold's train only ever grows forward in time, never peeking past its own holdout, and the
 * final fold's holdout runs to the end of the series. `trainFraction` sets the size of the
 * first fold's train window (the minimum a study is willing to score on); the remaining
 * candles are split evenly across `folds` holdout slices.
 */
export function walkForwardWindows(candles, { folds = 4, trainFraction = 0.5 } = {}) {
  if (!Number.isInteger(folds) || folds < 1) throw new Error("walkForwardWindows: folds must be a positive integer");
  if (!(trainFraction > 0 && trainFraction < 1)) throw new Error("walkForwardWindows: trainFraction must be between 0 and 1");
  const n = candles.length;
  const trainEnd = Math.floor(n * trainFraction);
  const step = Math.floor((n - trainEnd) / folds);
  const windows = [];
  for (let i = 0; i < folds; i++) {
    const cut = trainEnd + i * step;
    const holdoutEnd = i === folds - 1 ? n : trainEnd + (i + 1) * step;
    if (cut >= holdoutEnd) continue;
    windows.push({ train: candles.slice(0, cut), holdout: candles.slice(cut, holdoutEnd) });
  }
  return windows;
}

/**
 * walkForwardWindows applied to the project's standard multi-timeframe `series` shape
 * ([{label, mins, candles}, ...], as built by tournament.mjs's seriesFor and every study that
 * consumes loadResearchCandles). Cuts are computed on series[0] (the anchor timeframe) and
 * applied to every timeframe by candle .time boundary rather than by index — required because
 * different timeframes have different candle counts over the same wall-clock span, the same
 * reason tournament.mjs's own splitSeries only cuts index-into-anchor then filters by time.
 */
export function walkForwardSeriesWindows(series, { folds = 4, trainFraction = 0.5 } = {}) {
  const anchor = series[0]?.candles || [];
  const foldBoundaries = walkForwardWindows(anchor, { folds, trainFraction });
  return foldBoundaries.map(({ train, holdout }) => {
    const trainEndTime = Number(train[train.length - 1].time);
    const holdoutEndTime = Number(holdout[holdout.length - 1].time);
    return {
      train: series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time <= trainEndTime) })),
      holdout: series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time > trainEndTime && +c.time <= holdoutEndTime) })),
    };
  });
}
