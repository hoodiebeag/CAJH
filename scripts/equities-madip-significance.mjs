/**
 * EQUITIES-MADIP-SIGNIFICANCE (additive, read-only research, cache-only — no IBKR egress).
 *
 * EQUITIES-ALL-FAMILIES-BASELINE (2026-08-22, ROADMAP_ARCHIVE.md) ran all 12 unmodified `tournament.mjs`
 * families against the cached 30-symbol equity universe and found `ma_dip` combining the
 * largest usable holdout sample of the twelve (475 trades) with a comfortably net-positive
 * avgR (+0.1526) — unlike `breakout` (61 trades, already significance-tested and CI-includes-zero
 * per EQUITIES-BREAKOUT-SIGNIFICANCE), this is the first equities family candidate with real
 * sample size behind its positive sign. This item runs that check, and only that check — no
 * re-tuning, no symbol drops, no window change.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * Test: EQUITIES-BREAKOUT-SIGNIFICANCE's exact one-sided sign-flip permutation test on the
 * pooled per-trade net R series (all 30 symbols, `ma_dip` family, exact unmodified
 * EQUITIES-ALL-FAMILIES-BASELINE config/costs), against the null that the population mean R is
 * zero. Statistic: mean(R). One-sided because the pre-existing result is positive and the
 * question is whether that positive mean is distinguishable from noise. p = (count(nullStatistic
 * >= observedMean) + 1) / (iterations + 1), matching momentum.mjs's `permutationP` convention.
 * 95% CI: `blockBootstrapCI` from momentum.mjs (unmodified), blockSize=4, on the same pooled
 * series.
 * DECISION RULE, pre-registered: the raw p-value is NOT evaluated against alpha=0.05 in
 * isolation (AGENT_PROTOCOL.md's binding multiple-comparisons rule). It is added as the 12th
 * entry to MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family (11 entries as of 2026-08-21),
 * BH-FDR is recomputed across all 12 at q=0.05, and "ma_dip survives significance" is only true
 * if it clears the recomputed BH-FDR threshold at its rank. A cleared BH-FDR does NOT by itself
 * promote anything: AGENT_PROTOCOL.md's economic-gate rule independently requires
 * re-validation against `SEALED_SYMBOLS` before any D3 live-promotion consideration, which this
 * item does not attempt. EQUITIES-ALL-FAMILIES-BASELINE's own twelve-family look-elsewhere
 * exposure also applies here — `ma_dip` was one of twelve rows in that breadth run, not a
 * pre-registered single hypothesis, so this significance test is conditioned on having been
 * picked as the best-looking candidate out of twelve, not run blind.
 * NO re-tuning, no symbol exclusion, no window change: this reuses
 * EQUITIES-ALL-FAMILIES-BASELINE's own cached candles (research-cache/equities-1d/, already
 * fetched, no live Gateway needed) and its exact `ma_dip` config and cost model, verbatim.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Exact same universe, split, and cost model as scripts/equities-all-families-baseline.mjs.
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
// Exact same ma_dip config as scripts/equities-all-families-baseline.mjs (tournament.mjs verbatim).
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

const cacheDir = path.join(".", "research-cache", "equities-1d");

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

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention (not exported
// there, so duplicated here at the same small scale, matching equities-breakout-significance.mjs).
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero.
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
    universeSize: UNIVERSE.length,
    datasetsUsed: datasets.length,
    iterations: ITERATIONS,
    family: { id: "ma_dip", trades: perTradeR.length, avgR, observedMean, ci95, p },
  };

  const saved = saveExperiment("equities-madip-significance", {
    specification: "equities-madip-significance/v1",
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
