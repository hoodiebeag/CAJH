/**
 * EQUITIES-BREAKOUT-OUT-OF-SAMPLE (additive, live IBKR fetch — read-only historical data,
 * never an order).
 *
 * EQUITIES-BASELINE-PORT's own writeup named the weaknesses precisely: 61 breakout trades, a
 * single ~7-month holdout, one 30-symbol universe (DJIA-30 as of 2024-08-19). EQUITIES-BREAKOUT-
 * SIGNIFICANCE (2026-08-21) then found that result's 95% CI includes zero — not enough evidence
 * at that sample size to call it an edge. This item is the out-of-sample re-check both of those
 * items pointed at next: a genuinely different symbol universe, same entry/exit logic, same cost
 * model, same statistical test.
 *
 * ============================ PRE-REGISTRATION (written before any data is fetched) ============================
 * WINDOW: `brokers/ibkr.mjs`'s `IBKRBroker.fetchOHLC(symbol, 1440)` (the exact function
 * EQUITIES-BASELINE-PORT used) has no endDateTime parameter — it always requests IBKR's "2 Y"
 * duration ending now. Fetching fresh today (2026-08-22) therefore yields ~2024-08-22 to
 * ~2026-08-22, essentially the SAME calendar window EQUITIES-BASELINE-PORT used (fetched
 * 2026-08-19, window ~2024-08-19 to ~2026-08-19) — shifted by only 3 days. Re-fetching the
 * DJIA-30 universe on this window would not be a genuine out-of-sample test (>95% of the trading
 * days would be identical to the original run). Widening `fetchOHLC` to accept a historical
 * endDateTime would let the window itself move, but that changes a function `trader.js`'s live
 * path also depends on, which is out of scope for an additive research script — so this item
 * holds the window mechanism fixed as given and changes the UNIVERSE instead, which `fetchOHLC`
 * already supports per-symbol with zero production-code changes. This also satisfies
 * AGENT_PROTOCOL.md's calendar-holdout rule directly: candle data collected after 2026-08-19 for
 * a price-structure family holdout, no disclosure-of-reuse needed.
 *
 * UNIVERSE — Dow Jones Transportation Average (DJTA), 20 components, fixed at window start
 * (2024-08-22), point-in-time, not today's list — zero ticker overlap with EQUITIES-BASELINE-
 * PORT's DJIA-30, so this is a genuinely fresh set of companies, not a re-slice of the same 30.
 * Sourced from Wikipedia's "Dow Jones Transportation Average" article and cross-checked against
 * independent primary sources (S&P Global press release, PR Newswire) for both membership
 * changes in the relevant range:
 *   - 2024-02-26: Uber Technologies (UBER) replaced JetBlue Airways (JBLU) — already in effect
 *     by the 2024-08-22 window start, so UBER is included, JBLU is not.
 *     https://www.prnewswire.com/news-releases/amazoncom-set-to-join-dow-jones-industrial-average-uber-to-join-dow-jones-transportation-average-302066705.html
 *   - 2026-06-01: FedEx Freight Holding (FDXF) replaced American Airlines Group (AAL) — this
 *     happened AFTER the 2024-08-22 window start, so per point-in-time discipline (same standard
 *     EQUITIES-BASELINE-PORT applied to INTC/DOW — keep names later removed for underperformance,
 *     don't exclude with hindsight) this universe uses AAL, NOT FDXF, even though AAL was
 *     subsequently dropped from the index for exactly that reason.
 *     https://press.spglobal.com/2026-05-27-FedEx-Freight-Holding-Set-to-Join-Dow-Jones-Transportation-Average
 * https://en.wikipedia.org/wiki/Dow_Jones_Transportation_Average
 *
 * COST BASIS, FAMILY CONFIGS, SPLIT — EXACTLY EQUITIES-BASELINE-PORT's, unmodified: IBKR Fixed
 * plan $0.005/share commission (converted per-symbol via that symbol's own holdout avgClose,
 * same as the original), 5bps/side slippage, 70/30 train/holdout split, `breakout`/`anticipate`
 * configs verbatim from `tournament.mjs`. No parameter, universe, or cost figure changes after
 * seeing results — this file is committed with its pre-registration intact, unedited post-hoc.
 *
 * STATISTICAL TEST — EQUITIES-BREAKOUT-SIGNIFICANCE's exact methodology, duplicated verbatim:
 * one-sided sign-flip permutation test (null: population mean R is zero) on the pooled per-trade
 * net-R series, `p = (extreme + 1) / (iterations + 1)`, 5000 iterations; 95% CI via
 * `momentum.mjs`'s `blockBootstrapCI` (blockSize=4, unmodified). `anticipate` runs alongside as
 * the same negative-control sanity check (its p-value gates no decision, does not join the
 * formal-NHST family). `breakout`'s p-value DOES join `MULTIPLE_COMPARISONS_AUDIT.md`'s
 * formal-NHST family (12 entries as of 2026-08-22) as the 13th entry; BH-FDR is recomputed
 * across all 13 in the same commit per AGENT_PROTOCOL.md's binding rule, and "significant" is
 * only true if it clears the recomputed threshold at its rank.
 *
 * DECISION RULE, pre-registered: report `breakout`'s new trades/avgR/CI/p side by side with
 * EQUITIES-BREAKOUT-SIGNIFICANCE's original DJIA-30 table, and state plainly whether the point
 * estimate reproduces (same sign, comparable magnitude), holds up weaker (same sign, materially
 * smaller or a CI that moves further from significance), or vanishes (sign flips or collapses
 * toward zero). No re-tuning, no symbol exclusion, no window change after this point.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { IBKRBroker } from "../brokers/ibkr.mjs";
import { backtestMultiTF } from "../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Point-in-time DJTA-20 as of window start 2024-08-22 (see header citation). Zero overlap with
// EQUITIES-BASELINE-PORT's DJIA-30.
const UNIVERSE = [
  "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
  "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share — same as EQUITIES-BASELINE-PORT
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side — same as EQUITIES-BASELINE-PORT

// Exact same family configs as EQUITIES-BASELINE-PORT / EQUITIES-BREAKOUT-SIGNIFICANCE.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

// Separate cache dir from EQUITIES-BASELINE-PORT's research-cache/equities-1d/ — different
// universe, different study, no ambiguity about which candles fed which result. No ticker
// collision with the DJIA-30 cache either way.
const cacheDir = path.join(".", "research-cache", "equities-1d-djta-oos");
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
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Local seeded RNG, mirroring EQUITIES-BREAKOUT-SIGNIFICANCE's own duplication of momentum.mjs's
// internal `seeded()` LCG convention.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero — identical to
// EQUITIES-BREAKOUT-SIGNIFICANCE's `signFlipP`.
function signFlipP(values, { iterations = ITERATIONS, seed = SIGN_FLIP_SEED } = {}) {
  const observed = values.reduce((a, b) => a + b, 0) / values.length;
  const random = seeded(seed);
  let extreme = 0;
  for (let n = 0; n < iterations; n++) {
    let sum = 0;
    for (const v of values) sum += random() < 0.5 ? v : -v;
    if (sum / values.length >= observed) extreme++;
  }
  return { observedMean: observed, p: (extreme + 1) / (iterations + 1) };
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
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    datasets.push({ symbol, holdout, feeRate });
  }

  const report = { universe: UNIVERSE, universeSize: UNIVERSE.length, datasetsUsed: datasets.length, iterations: ITERATIONS, families: {} };

  for (const [famId, config] of FAMILIES) {
    const perTradeR = [];
    for (const d of datasets) {
      const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
      const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate: d.feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
      perTradeR.push(...r.results);
    }
    const avgR = perTradeR.reduce((a, b) => a + b, 0) / perTradeR.length;
    const ci95 = blockBootstrapCI(perTradeR, { blockSize: 4, iterations: ITERATIONS });
    const { p } = signFlipP(perTradeR);
    report.families[famId] = { trades: perTradeR.length, avgR, ci95, p };
  }

  const saved = saveExperiment("equities-breakout-out-of-sample", {
    specification: "equities-breakout-out-of-sample/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
