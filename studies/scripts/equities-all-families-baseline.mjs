/**
 * EQUITIES-ALL-FAMILIES-BASELINE (additive, read-only research). EQUITIES-BASELINE-PORT
 * (2026-08-19) ran only two of tournament.mjs's twelve families (`breakout`, `anticipate`) on the
 * equity universe and found a striking gross-edge gap versus crypto for identical, unmodified
 * logic. The obvious follow-up it left unasked: how do the other ten families behave on the same
 * data? This item runs all twelve families, unmodified, against the same cached equity universe
 * and the same cost basis EQUITIES-BASELINE-PORT established — a breadth measurement to see where
 * to look next, NOT a promotion of whichever family scores highest. Running twelve families and
 * reporting only the best would itself be a twelve-test multiple-comparisons violation; every
 * family's number is reported below, including the bad ones, and no family is promoted or written
 * to VERDICTS.md as a result of this run.
 *
 * DATA — reads the existing research-cache/equities-1d/<SYMBOL>.json cache created by
 * EQUITIES-BASELINE-PORT (all 30 symbols already cached; no live IBKR Gateway call needed for this
 * run). Same UNIVERSE, same 0.70 train/holdout split, same cost basis (IBKR Fixed commission
 * $0.005/share modeled per-symbol via that symbol's own holdout avgClose, 5bps/side slippage) —
 * see equities-baseline-port.mjs's header for the full citation of both. No parameter here is new;
 * this file only widens which family configs get run through the exact same pipeline.
 *
 * FAMILIES — the exact 12-entry `families` array from tournament.mjs (lines 6-19), duplicated
 * verbatim per this project's established convention for equities/cost studies (see
 * equities-baseline-port.mjs, equities-cost-assumption-sensitivity.mjs) rather than importing
 * tournament.mjs, which is wired for the crypto researchlab candle-loading path.
 */
import fs from "fs";
import path from "path";
import { IBKRBroker } from "../brokers/ibkr.mjs";
import { backtestMultiTF } from "../../backtest.js";
import { saveExperiment } from "../../researchlab.mjs";

// Fixed at 2024-08-19 — Dow 30 membership as of window start, not today. Identical to
// equities-baseline-port.mjs's UNIVERSE (see that file's header for the point-in-time sourcing).
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share (see equities-baseline-port.mjs header)
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side (see equities-baseline-port.mjs header)

// Verbatim copy of tournament.mjs's `families` array (lines 6-19) — all twelve entry engines,
// unmodified. Not imported because tournament.mjs's data-loading path is wired for crypto
// researchlab candles, not this equities cache.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["bos", { entryMode: "bos", trendGate: true, trendGateMode: "ma", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["support", { entryMode: "support", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["ma_dip", { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rsi", { entryMode: "rsi", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rev", { entryMode: "rev", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["trend_pullback", { entryMode: "trend_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["sweep_reclaim", { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["range_sweep_reclaim", { entryMode: "range_sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["h3", { entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["vol_contraction", { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

const cacheDir = path.join(".", "research-cache", "equities-1d");
fs.mkdirSync(cacheDir, { recursive: true });

async function loadOrFetch(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(saved.candles) && saved.candles.length) return saved.candles;
    } catch { /* fall through to refetch a corrupt cache */ }
  }
  const bars = await IBKRBroker.fetchOHLC(symbol, 1440);
  if (!bars || !bars.length) return null;
  fs.writeFileSync(file, JSON.stringify({ symbol, fetchedAt: new Date().toISOString(), source: "IBKRBroker.fetchOHLC(symbol,1440)", candles: bars }, null, 2) + "\n");
  return bars;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return {
    train: candles.filter((c) => +c.time < cut),
    holdout: candles.filter((c) => +c.time >= cut),
  };
}

async function main() {
  const datasets = [];
  for (const symbol of UNIVERSE) {
    const candles = await loadOrFetch(symbol);
    if (!candles || candles.length < 100) {
      console.error(`SKIP ${symbol}: ${candles ? candles.length : "fetch failed"} candles`);
      continue;
    }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose; // per-side, this symbol's own price level
    datasets.push({ symbol, holdout, avgClose, feeRate });
  }

  const report = {
    split: SPLIT,
    universe: UNIVERSE,
    universeSize: UNIVERSE.length,
    datasetsUsed: datasets.length,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    families: {},
  };

  for (const [famId, config] of FAMILIES) {
    const perSymbolGross = datasets.map((d) => {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate: 0, slipPct: 0 });
      return { symbol: d.symbol, trades: r.trades, totalR: r.totalR };
    });
    const perSymbolNet = datasets.map((d) => {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate: d.feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
      return { symbol: d.symbol, trades: r.trades, totalR: r.totalR };
    });

    const sum = (arr, key) => arr.reduce((a, x) => a + x[key], 0);
    const grossTrades = sum(perSymbolGross, "trades");
    const grossTotalR = sum(perSymbolGross, "totalR");
    const netTrades = sum(perSymbolNet, "trades");
    const netTotalR = sum(perSymbolNet, "totalR");

    report.families[famId] = {
      gross: { trades: grossTrades, totalR: grossTotalR, avgR: grossTrades ? grossTotalR / grossTrades : 0 },
      net: { trades: netTrades, totalR: netTotalR, avgR: netTrades ? netTotalR / netTrades : 0 },
    };
  }

  const saved = saveExperiment("equities-all-families-baseline", {
    specification: "equities-all-families-baseline/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
