/**
 * BOS-SHORT-EQUITIES-BASELINE (additive, read-only research). SHORT-SIDE-ENGINE-CAPABILITY
 * (2026-08-28) added a `direction: "short"` path to `backtestMultiTF` (bos entryMode only) but
 * deliberately ran no family and reported no result. `engine_is_long_only` (blackboard finding,
 * 2026-08-22) flagged that every positive equities number on record (EQUITIES-BASELINE-PORT,
 * EQUITIES-ALL-FAMILIES-BASELINE, EQUITIES-MADIP-SIGNIFICANCE/-OUT-OF-SAMPLE) is long-only over a
 * window in which the index rose, on IBKR — where shorting is actually available (unlike this
 * project's Kraken venue) — and deliberately deferred queuing this until the queue drained. This
 * item is that first empirical look at the short side.
 *
 * CONFIG — pre-registered exactly per this item's own work_queue spec, because
 * SHORT-SIDE-ENGINE-CAPABILITY's own writeup states alignMode/trendGate semantics remain
 * long-oriented and were NOT inverted for shorts: { entryMode:"bos", trendGate:false,
 * alignMode:"none", minStopPct:.015, maxStopPct:.06, tpR:4, lockBreakeven:false }, run with BOTH
 * direction:"long" and direction:"short" so the comparison isolates direction only.
 * lockBreakeven:false is also mechanically required — direction:"short" throws if it is left at
 * its true default (backtest.js's short-direction guard). This means NEITHER run here is directly
 * comparable to EQUITIES-ALL-FAMILIES-BASELINE's own `bos` row (trendGate:true, lockBreakeven:true)
 * — that gap is stated plainly in the output, not implied away.
 *
 * DATA — reads the existing research-cache/equities-1d/<SYMBOL>.json cache (cache-only, no live
 * IBKR Gateway call), same DJIA-30 UNIVERSE, same 0.70 split, and same cost basis as
 * EQUITIES-ALL-FAMILIES-BASELINE: IBKR Fixed $0.005/share (modeled per-symbol via that symbol's
 * own holdout avgClose), 5bps/side slippage.
 *
 * COST CAVEAT — borrow availability and borrow cost are NOT modeled anywhere in this engine
 * (SHORT-SIDE-ENGINE-CAPABILITY's own stated caveat). Any short net figure here is before that
 * cost and is not tradeable as reported.
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

// Identical to equities-all-families-baseline.mjs's UNIVERSE (Dow 30 membership as of
// window start, 2024-08-19 — see that file's header for point-in-time sourcing).
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side

// Pre-registered config, both directions. trendGate/alignMode/lockBreakeven proven only for
// longs elsewhere in this project — turned off for BOTH directions so direction is isolated.
const CONFIG = { entryMode: "bos", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: false };

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCache(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved.candles) && saved.candles.length) return saved.candles;
  } catch { /* treat corrupt cache as missing */ }
  return null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return {
    train: candles.filter((c) => +c.time < cut),
    holdout: candles.filter((c) => +c.time >= cut),
  };
}

function main() {
  const datasets = [];
  for (const symbol of UNIVERSE) {
    const candles = loadCache(symbol);
    if (!candles || candles.length < 100) {
      console.error(`SKIP ${symbol}: ${candles ? candles.length : "no cache"} candles`);
      continue;
    }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    datasets.push({ symbol, holdout, avgClose, feeRate });
  }

  function runDirection(direction) {
    const perSymbolGross = datasets.map((d) => {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...CONFIG, direction, entryTf: "1d", feeRate: 0, slipPct: 0 });
      return { symbol: d.symbol, trades: r.trades, totalR: r.totalR };
    });
    const perSymbolNet = datasets.map((d) => {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...CONFIG, direction, entryTf: "1d", feeRate: d.feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
      return { symbol: d.symbol, trades: r.trades, totalR: r.totalR };
    });
    const sum = (arr, key) => arr.reduce((a, x) => a + x[key], 0);
    const grossTrades = sum(perSymbolGross, "trades");
    const grossTotalR = sum(perSymbolGross, "totalR");
    const netTrades = sum(perSymbolNet, "trades");
    const netTotalR = sum(perSymbolNet, "totalR");
    return {
      gross: { trades: grossTrades, totalR: grossTotalR, avgR: grossTrades ? grossTotalR / grossTrades : 0 },
      net: { trades: netTrades, totalR: netTotalR, avgR: netTrades ? netTotalR / netTrades : 0 },
    };
  }

  const long = runDirection("long");
  const short = runDirection("short");

  const pooled = {
    gross: {
      trades: long.gross.trades + short.gross.trades,
      totalR: long.gross.totalR + short.gross.totalR,
      avgR: (long.gross.trades + short.gross.trades) ? (long.gross.totalR + short.gross.totalR) / (long.gross.trades + short.gross.trades) : 0,
    },
    net: {
      trades: long.net.trades + short.net.trades,
      totalR: long.net.totalR + short.net.totalR,
      avgR: (long.net.trades + short.net.trades) ? (long.net.totalR + short.net.totalR) / (long.net.trades + short.net.trades) : 0,
    },
  };

  const report = {
    split: SPLIT,
    universe: UNIVERSE,
    universeSize: UNIVERSE.length,
    datasetsUsed: datasets.length,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    config: CONFIG,
    long,
    short,
    pooledDescriptiveOnly: pooled,
    caveats: {
      comparability: "NOT directly comparable to EQUITIES-ALL-FAMILIES-BASELINE's own bos row (trendGate:true, lockBreakeven:true) — this run uses trendGate:false, alignMode:none, lockBreakeven:false for both directions so direction is isolated from filter effects proven only for longs.",
      borrowCost: "Borrow availability and borrow cost are NOT modeled anywhere in this engine. Any short net figure above is BEFORE that cost and is not tradeable as reported.",
      pooled: "pooledDescriptiveOnly is descriptive only, not a promoted combined-strategy result.",
    },
  };

  const saved = saveExperiment("bos-short-equities-baseline", {
    specification: "bos-short-equities-baseline/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    config: CONFIG,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
