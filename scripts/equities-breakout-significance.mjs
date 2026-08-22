/**
 * EQUITIES-BREAKOUT-SIGNIFICANCE (additive, read-only research, cache-only — no IBKR egress).
 *
 * EQUITIES-BASELINE-PORT (2026-08-19, ROADMAP.md) measured `breakout` net +0.1866R over 61
 * holdout trades on a point-in-time DJIA-30 universe at real IBKR costs — the first net-positive
 * real-cost result in this project's history. That item's own writeup states plainly: no
 * permutation test or significance check was run, and 61 trades is far thinner than crypto's
 * baselines. This item runs that check, and only that check — no re-tuning, no symbol drops, no
 * window extension.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * Test: one-sided sign-flip permutation test on the pooled per-trade net R series (all 30
 * symbols, `breakout` family, exact unmodified EQUITIES-BASELINE-PORT config/costs), against the
 * null that the population mean R is zero (i.e. the sign of each trade's R is, under the null,
 * an independent fair coin flip — standard for testing "is this R-multiple sample's mean edge
 * distinguishable from zero" when there's no second series to permute against). Statistic:
 * mean(R). One-sided because the pre-existing result is positive and the question is whether
 * that positive mean is distinguishable from noise, not whether it could equally be negative.
 * p = (count(nullStatistic >= observedMean) + 1) / (iterations + 1), matching momentum.mjs's
 * `permutationP` convention (add-one smoothing, `>=` for the one-sided extreme count).
 * 95% CI: `blockBootstrapCI` from momentum.mjs (this project's own machinery, unmodified),
 * blockSize=4, on the same pooled series, to give a CI that doesn't assume trade-to-trade
 * independence.
 * DECISION RULE, pre-registered: the raw p-value is NOT evaluated against alpha=0.05 in
 * isolation (AGENT_PROTOCOL.md's binding multiple-comparisons rule). It is added as the 11th
 * entry to MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family (10 entries as of 2026-08-19),
 * BH-FDR is recomputed across all 11 at q=0.05, and "breakout survives significance" is only
 * true if it clears the recomputed BH-FDR threshold at its rank. A cleared BH-FDR does NOT by
 * itself promote anything: AGENT_PROTOCOL.md's economic-gate rule independently requires
 * re-validation against `SEALED_SYMBOLS` before any D3 live-promotion consideration, which this
 * item does not attempt.
 * NEGATIVE CONTROL: `anticipate` (net -0.0438R, 303 trades) gets the identical statistic and
 * test computed alongside, as a methodology sanity check (a real, already-known-negative result
 * should not come back "significant"). `anticipate`'s p-value gates no decision and is NOT
 * added to the formal-NHST family counter — this test isn't evaluating a candidate hypothesis
 * for anticipate, which is already dead per HOLDING-PERIOD-COST-AMORTIZATION-MAP and every other
 * study that has touched it; it exists solely to check the test itself isn't systematically
 * biased toward "significant." Only `breakout`'s p-value joins the family.
 * NO re-tuning, no symbol exclusion, no window change: this reuses EQUITIES-BASELINE-PORT's own
 * cached candles (research-cache/equities-1d/, already fetched, no live Gateway needed) and its
 * exact FAMILIES config and cost model, verbatim.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Exact same universe, split, cost model, and family configs as scripts/equities-baseline-port.mjs.
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260821;

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
// there, so duplicated here at the same small scale rather than modifying that file).
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

  const report = { universeSize: UNIVERSE.length, datasetsUsed: datasets.length, iterations: ITERATIONS, families: {} };

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

  const saved = saveExperiment("equities-breakout-significance", {
    specification: "equities-breakout-significance/v1",
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
