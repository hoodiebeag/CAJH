/**
 * EQUITIES-MADIP-OUT-OF-SAMPLE (additive, read-only research, cache-only — no IBKR egress).
 *
 * EQUITIES-MADIP-SIGNIFICANCE (2026-08-22, ROADMAP_ARCHIVE.md) found `ma_dip`'s positive point estimate
 * (475 trades, avgR +0.1526, p=0.0648) the closest any equities result has come to nominal
 * significance in this project's history, but it does not survive BH-FDR at n=14 and its 95% CI
 * still includes zero. This item is the out-of-sample re-check that EQUITIES-BREAKOUT-
 * OUT-OF-SAMPLE already performed for `breakout`, now run for `ma_dip`.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * WINDOW / UNIVERSE: EQUITIES-BREAKOUT-OUT-OF-SAMPLE (2026-08-22) already fetched and cached a
 * genuinely fresh, zero-ticker-overlap universe for this exact purpose — the point-in-time
 * DJTA-20 (Dow Jones Transportation Average, 20 components, fixed at window start 2024-08-22),
 * cached at `research-cache/equities-1d-djta-oos/`. Per this item's own work_queue note, that
 * cache is reused here rather than fetching a second, different universe: "no reason to pull
 * twice." This script is therefore cache-only — no IB Gateway call, even though Gateway is
 * reachable in this environment as of this firing (127.0.0.1:4002 responded). Reusing the same
 * out-of-sample universe as EQUITIES-BREAKOUT-OUT-OF-SAMPLE also means this result is directly
 * comparable to that one, not just to EQUITIES-MADIP-SIGNIFICANCE's original DJIA-30 run.
 *
 * COST BASIS, SPLIT: EXACTLY EQUITIES-MADIP-SIGNIFICANCE's / EQUITIES-BREAKOUT-OUT-OF-SAMPLE's,
 * unmodified: IBKR Fixed plan $0.005/share commission (converted per-symbol via that symbol's own
 * holdout avgClose), 5bps/side slippage, 70/30 train/holdout split.
 *
 * `ma_dip` CONFIG: verbatim from `tournament.mjs` via EQUITIES-MADIP-SIGNIFICANCE —
 * `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`. Nothing about entry/exit logic or cost model changes between
 * the two runs — only the universe changes, matching EQUITIES-BREAKOUT-OUT-OF-SAMPLE's own
 * discipline of moving exactly one variable.
 *
 * STATISTICAL TEST: EQUITIES-MADIP-SIGNIFICANCE's exact methodology, duplicated verbatim:
 * one-sided sign-flip permutation test (null: population mean R is zero) on the pooled per-trade
 * net-R series, `p = (extreme + 1) / (iterations + 1)`, 5000 iterations, seed 20260822; 95% CI
 * via `momentum.mjs`'s `blockBootstrapCI` (blockSize=4, unmodified).
 * DECISION RULE, pre-registered: report `ma_dip`'s new trades/avgR/CI/p side by side with
 * EQUITIES-MADIP-SIGNIFICANCE's original DJIA-30 table, and state plainly whether the point
 * estimate reproduces (same sign, comparable magnitude), holds up weaker (same sign, materially
 * smaller or a CI that moves further from significance), or vanishes (sign flips or collapses
 * toward zero). This p-value joins MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family (14 entries
 * as of 2026-08-22) as the 15th entry; BH-FDR is recomputed across all 15 in the same commit per
 * AGENT_PROTOCOL.md's binding rule. No parameter, universe, or cost figure changed after seeing
 * results.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../../researchlab.mjs";

// Point-in-time DJTA-20 as of window start 2024-08-22 — identical universe and cache
// EQUITIES-BREAKOUT-OUT-OF-SAMPLE already fetched, reused verbatim (see pre-registration above).
const UNIVERSE = [
  "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
  "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share — same as EQUITIES-MADIP-SIGNIFICANCE
const SLIPPAGE_PCT_EQUITY = 0.0005; // 5bps/side — same as EQUITIES-MADIP-SIGNIFICANCE
// Exact same ma_dip config as scripts/equities-madip-significance.mjs (tournament.mjs verbatim).
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

const cacheDir = path.join(".", "research-cache", "equities-1d-djta-oos");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Local seeded RNG, mirroring EQUITIES-MADIP-SIGNIFICANCE's own duplication of momentum.mjs's
// internal `seeded()` LCG convention.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero — identical to
// EQUITIES-MADIP-SIGNIFICANCE's `signFlipP`.
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

function main() {
  const datasets = [];
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles) { console.error(`MISSING CACHE: ${symbol} — this item is cache-only by design, no re-fetch`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    datasets.push({ symbol, holdout, feeRate });
  }

  const perTradeR = [];
  for (const d of datasets) {
    const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate: d.feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    perTradeR.push(...r.results);
  }
  const avgR = perTradeR.reduce((a, b) => a + b, 0) / perTradeR.length;
  const ci95 = blockBootstrapCI(perTradeR, { blockSize: 4, iterations: ITERATIONS });
  const { p, observedMean } = signFlipP(perTradeR);

  const report = {
    universe: UNIVERSE,
    universeSize: UNIVERSE.length,
    datasetsUsed: datasets.length,
    iterations: ITERATIONS,
    family: { id: "ma_dip", trades: perTradeR.length, avgR, observedMean, ci95, p },
  };

  const saved = saveExperiment("equities-madip-out-of-sample", {
    specification: "equities-madip-out-of-sample/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
