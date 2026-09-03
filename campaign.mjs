/**
 * campaign.mjs — the parameter-search campaign: run configurations, record every one, resume.
 *
 * WHAT THIS IS. The owner asked for three days of parameter tweaking across the 12 entry families
 * on crypto daily bars, scored by final account balance from $1000, with work split across
 * 3-hourly sessions. This holds the state so each session resumes instead of restarting, and
 * records EVERY configuration tried rather than only the ones that looked good.
 *
 * WHAT IT IS NOT, and this is written here because the file's whole purpose invites the error:
 * a leaderboard produced by searching thousands of configurations on one dataset is not evidence
 * of an edge. The best of N configurations looks good at N large whether or not any edge exists.
 * `runsTested` travels with every result for exactly that reason, and the holdout below is the
 * only thing that can turn a search outcome into a finding.
 *
 * NO HOLDOUT. The owner directed on 2026-09-03 that the full period be used for the search, after
 * being shown the case for sealing 2025-07 onward and declining it. That is their call and it is
 * recorded here rather than argued again.
 *
 * WHAT IT COSTS, stated once so every reader of these numbers knows: every configuration is
 * tuned and scored on the same data, so the leaderboard's winner is the best of N draws from a
 * single sample. At large N a good-looking winner appears whether or not any edge exists, and
 * there is now no untouched period that could tell those two cases apart. The balances here are
 * IN-SAMPLE and are not evidence of an edge. `runsTested` travels with every row so the size of
 * the search is always visible next to its result.
 */

import fs from "fs";
import { backtestMultiTF } from "./backtest.js";
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { simulateEquity, leaderboard } from "./equity.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

export const SPLIT = Object.freeze({
  // Full period, per the owner's 2026-09-03 direction. Kept as named fields so a later session
  // can reinstate a split by changing this object alone.
  trainStart: "2023-01-01", trainEnd: "2026-03-31",
  holdoutStart: null, holdoutEnd: null,
  sealed: false,
});
export const STATE_FILE = "campaign-state.json";
export const LOG_FILE = "campaign-log.jsonl";

export const FAMILIES = ["anticipate", "bos", "breakout", "fib_pullback", "ma_dip",
  "range_sweep_reclaim", "rev", "rsi", "support", "sweep_reclaim", "trend_pullback", "vol_contraction"];

const sec = (d) => Date.parse(d + "T00:00:00Z") / 1000;

/** Bars inside a window. The holdout window is never requested by anything in this file. */
export function slice(pair, minutes, from, to) {
  return loadBundleCandles(pair, minutes).filter((c) => +c.time >= sec(from) && +c.time <= sec(to));
}

/** One configuration over the whole universe -> trades with entry times, ready for the simulator. */
export function runConfig(config, { minutes = 1440, from = SPLIT.trainStart, to = SPLIT.trainEnd, pairs = null } = {}) {
  const universe = pairs ?? availablePairs(minutes);
  const trades = [];
  let symbolsUsed = 0;
  for (const pair of universe) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length < 120) continue;
    const r = backtestMultiTF({ series: [{ label: String(minutes), mins: minutes, candles }] },
      { ...config, entryTf: String(minutes), feeRate: config.feeRate ?? FEE_RATE, slipPct: config.slipPct ?? SLIPPAGE_PCT });
    symbolsUsed++;
    for (const x of r.excursions) {
      if (!Number.isFinite(x.entryTime)) continue; // undated same-bar stops cannot be ordered
      trades.push({ netR: x.r, entryTime: x.entryTime * 1000, symbol: pair });
    }
  }
  return { trades, symbolsUsed };
}

/** Score a configuration end to end. Returns the row that goes on the leaderboard and in the log. */
export function score(config, opts = {}) {
  const { trades, symbolsUsed } = runConfig(config, opts);
  if (!trades.length) return { config, trades: 0, symbolsUsed, finalBalance: opts.startingBalance ?? 1000, empty: true };
  const eq = simulateEquity(trades, { riskPct: config.riskPct ?? 0.005, startingBalance: opts.startingBalance ?? 1000 });
  return {
    config, symbolsUsed,
    trades: eq.trades,
    finalBalance: +eq.finalBalance.toFixed(2),
    totalReturnPct: +eq.totalReturnPct.toFixed(2),
    cagrPct: eq.cagrPct === null ? null : +eq.cagrPct.toFixed(2),
    maxDrawdownPct: +eq.maxDrawdownPct.toFixed(2),
    effectivelyRuined: eq.effectivelyRuined,
    firstTrade: eq.firstTrade, lastTrade: eq.lastTrade,
  };
}

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { schema: "cajh-campaign/v1", split: SPLIT, startedAt: new Date().toISOString(),
      runsTested: 0, phase: "baseline", doneFamilies: [], note: "holdout never read during search" };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n");
}

/** Append every scored configuration. The log is the denominator; without it a leaderboard lies. */
export function logRuns(rows) {
  const out = rows.map((r) => JSON.stringify({ at: new Date().toISOString(), ...r })).join("\n");
  if (out) fs.appendFileSync(LOG_FILE, out + "\n");
}

export function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Leaderboard over everything ever tried, with the true denominator attached. */
export function standings() {
  const all = readLog();
  return leaderboard(all, { runsTested: all.length });
}
