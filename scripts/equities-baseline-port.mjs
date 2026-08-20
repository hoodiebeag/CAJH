/**
 * EQUITIES-BASELINE-PORT (additive, read-only research). Ports the existing, UNMODIFIED
 * `breakout`/`anticipate` families (exact configs from tournament.mjs, duplicated here per
 * this project's convention — see execution-delay-decay-curve.mjs / cost-component-attribution.mjs)
 * onto a US equity universe fetched live from IBKR, to test whether the same signal logic
 * behaves differently in a market with a fundamentally cheaper, different-microstructure cost
 * basis than crypto's ~1.7% round-trip taker fee. No strategy parameter is touched — this is a
 * new dataset feeding the same backtest.js engine, nothing more.
 *
 * UNIVERSE — survivorship-bias rule fixed at window start, not today's list:
 * The 30 Dow Jones Industrial Average components AS OF 2024-08-19 (exactly 2 years before this
 * run, i.e. the start of the fetch window below), NOT today's (2026-08-19) DJIA list. Sourced
 * from Wikipedia's "Historical components of the Dow Jones Industrial Average" change log: the
 * most recent change before 2024-08-19 was 2024-02-26 (Walgreens Boots Alliance replaced by
 * Amazon.com), and no further changes occurred before 2024-08-19; the next change after the
 * window start was 2024-11-08 (Intel and Dow Inc. replaced by Nvidia and Sherwin-Williams).
 * Concretely this means: Intel (INTC) and Dow Inc. (DOW) ARE included below (they were real
 * members on 2024-08-19, even though both were later removed and both underperformed after
 * removal — including them, not excluding them with hindsight, is the whole point of fixing
 * the rule at window start) and Walgreens is NOT included (already removed by window start).
 * https://en.wikipedia.org/wiki/Historical_components_of_the_Dow_Jones_Industrial_Average
 *
 * COST BASIS — sourced and cited, not carried from memory (this project has been burned once
 * already by a memorized cost figure that was off by ~2x — see FEE-SCHEDULE-REBASE):
 *   - Commission: IBKR Pro "Fixed" US stock plan, USD 0.005/share, USD 1.00 minimum per order,
 *     capped at 1% of trade value. https://www.interactivebrokers.com/en/pricing/commissions-stocks.php
 *     Modeled per-side as commissionPerShare / thatSymbol's own average holdout close price —
 *     backtest.js's cost model is a % of price, not $/share, so this converts correctly for a
 *     multi-symbol, multi-price universe (a flat single % across a $50 stock and a $500 stock
 *     would misprice both). The $1.00/order minimum is NOT modeled (it only binds on very small
 *     position sizes/share counts, which this backtest — R-multiples, not position sizing —
 *     doesn't simulate); stated as a simplification, not hidden.
 *   - Slippage/spread: 0.0005 (5 bps) per side, a conservative estimate for Dow-30-grade
 *     large-cap liquidity — general large-cap spreads are commonly cited at "a penny wide" /
 *     ≤15bps, and one 2024 Nasdaq Research figure puts institutional S&P 500 market impact at
 *     ~4.5bps per trade. This is an assumption, NOT measured from IBKR's own NBBO tick history
 *     (would need Level-1 quote data, out of scope for this pass) — stated as such.
 *
 * DATA — IBKRBroker.fetchOHLC(symbol, 1440) via the now-working brokers/ibkr.mjs (paper-port
 * connection only; read-only historical-data requests, never an order). Each symbol's raw bars
 * are cached to research-cache/equities-1d/<SYMBOL>.json so a re-run doesn't need a live Gateway.
 * Fetching this run also surfaced and fixed a real bug in ibkr.mjs: TWS sends daily bars' `time`
 * as a bare "YYYYMMDD" string regardless of the formatDate=2 request (a documented TWS quirk
 * that only applies to intraday bars) — Number("20240820") silently parses as a nonsense tiny
 * epoch value instead of throwing. Fixed at the source (brokers/ibkr.mjs's onBar), with a new
 * unit test (brokers/ibkr.test.mjs) reproducing the exact live-Gateway shape. Not a strategy or
 * protected-surface change — a data-format correctness fix in the historical-data read path.
 */
import fs from "fs";
import path from "path";
import { IBKRBroker } from "../brokers/ibkr.mjs";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

// Fixed at 2024-08-19 (see file header) — Dow 30 membership as of window start, not today.
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share (see header citation)
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side (see header citation)

// Exact family configs from tournament.mjs's `families` array (breakout, anticipate rows) —
// duplicated verbatim, same convention as execution-delay-decay-curve.mjs / cost-component-attribution.mjs.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
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
      perSymbolNet,
    };
  }

  const saved = saveExperiment("equities-baseline-port", {
    specification: "equities-baseline-port/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
