/**
 * LOG-REGRESSION-BANDS-EQUITIES (additive, cache-only research — no IBKR egress).
 *
 * Companion to LOG-REGRESSION-BANDS-CRYPTO (2026-08-22, ROADMAP.md/VERDICTS.md), reusing that
 * item's method UNCHANGED per this item's own work_queue note ("Change NOTHING about the method
 * between the two runs ... or the comparison is worthless"). The crypto run's pre-registered
 * primary test nominally survived family-wide BH-FDR (p=0.0002, rank 1/14) but was KILLED because
 * the study's own always-flat control showed the result was a benchmark artifact of a broadly
 * bearish holdout window (23/24 assets had negative buy-and-hold return; sitting in cash beat the
 * signal by a wide, CI-excludes-zero margin). That always-flat control is therefore carried over
 * here verbatim rather than treated as crypto-specific — it is the only way to tell a real
 * mean-reversion signal from "was mostly out of a falling/rising market" on this method, in either
 * asset class.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * MODEL, BAND, SCORING WINDOW: byte-identical to `scripts/log-regression-bands-crypto.mjs` — OLS
 * `log(close) ~ a + b*log(t)` fit on TRAIN ONLY (first 70% of local history), frozen coefficients
 * applied unchanged to the whole series, standardized residual `z` vs train residual SE, BAND_K=1.5
 * fixed (not searched), hysteresis carry-forward inside the band, start flat, exposure computed
 * from day 1 but returns/cost counted from the holdout cut onward only. Model-form diagnostic
 * (log-log vs raw-t drift OLS, same train segment) also carried over unchanged.
 *
 * UNAVOIDABLE DIFFERENCE (named per this item's own work_queue note, which requires exactly this):
 * COST MODEL. Crypto uses a flat percentage (FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side). This
 * project has never used a flat percentage for equities — every existing equities script
 * (`equities-madip-significance.mjs`, `equities-all-families-baseline.mjs`) converts a fixed
 * COMMISSION_PER_SHARE ($0.005, IBKR-realistic) to a percentage via that symbol's average holdout
 * close, plus SLIPPAGE_PCT_EQUITY (0.0005/side) — reused verbatim here, unmodified, rather than
 * inventing a third convention. This makes equities' round-trip cost price-dependent (a few bps for
 * a $300 stock, more for a low-priced one) instead of crypto's flat ~1.7%, which is itself a real
 * and disclosed difference between the two markets' cost structure, not a methodological choice
 * that could bias the comparison in either direction.
 *
 * UNIVERSE: the same fixed 30-symbol DJIA universe used by `equities-madip-significance.mjs` /
 * `equities-all-families-baseline.mjs` / `equities-baseline-port.mjs` (cached, no re-fetch), not
 * the crypto watchlist's `>=150 candles` filter re-applied to a different universe — this project's
 * one fixed equities panel, reused so this result is comparable to every other equities study, not
 * just to the crypto companion. All 30 symbols hold 501 cached daily candles (>= the 150-candle
 * floor by a wide margin, so no symbol is excluded on that basis; stated as the pre-registered rule
 * regardless).
 *
 * ALWAYS-FLAT CONTROL (carried over from the crypto study's own after-the-fact addition, now
 * pre-registered here since the confound it catches is a property of the METHOD, not of crypto
 * specifically). A second "strategy" that never trades (0% return, zero cost) is scored against the
 * identical per-asset buy-and-hold series with the identical test. If the primary signal cannot
 * beat this control, any apparent significance in the primary test is a statement about the holdout
 * window's direction, not about the band.
 *
 * SIGNIFICANCE: identical to crypto — per-asset (holdout strategy return − holdout buy-and-hold
 * return), n = universe size (30, unless a symbol fails the holdout-length floor), one-sided
 * sign-flip permutation (H1: mean outperformance > 0, direction pre-registered on the same
 * mean-reversion rationale as the crypto study, not on any equities result seen so far — this is
 * this project's first run of the method on equities), plain cross-sectional bootstrap 95% CI
 * (`momentum.mjs`'s `bootstrapCI`, unmodified, matching the crypto study's use of the
 * non-block variant for cross-sectional units). Same test run a second time for the
 * always-flat control, and a third time for signal-minus-flat (the fair test of whether the band
 * itself adds information, per the crypto study's own framing).
 * MULTIPLE-COMPARISONS (binding, AGENT_PROTOCOL.md): the primary test reports a p-value against a
 * pre-registered gate, so it joins the formal-NHST family; BH-FDR is recomputed family-wide and
 * MULTIPLE_COMPARISONS_AUDIT.md + AGENT_PROTOCOL.md are updated in the SAME commit. The always-flat
 * control and signal-minus-flat tests are diagnostic, not additional entries into that family (same
 * treatment the crypto study gave its own control — they exist to interpret the primary p-value,
 * not to be corrected-for as independent hypotheses).
 * BUY-AND-HOLD / DRIFT DISCLOSURE (this item's own explicit ask): equities have a genuine long-run
 * upward drift crypto's shorter history may not support, so a positive band result here could be
 * beta, not timing skill — the always-flat control (which nets to the *negative* of buy-and-hold
 * when buy-and-hold is positive) makes that visible directly rather than needing a separate note.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { bootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Exact same fixed universe as equities-madip-significance.mjs / equities-all-families-baseline.mjs.
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const TRAIN_FRACTION = 0.7;
const MIN_CANDLES = 150;
const MIN_HOLDOUT_DAYS = 20;
const BAND_K = 1.5;
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention (not exported
// there, duplicated here at the same small scale, matching log-regression-bands-crypto.mjs).
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (matches
// log-regression-bands-crypto.mjs's convention exactly).
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

function ols(x, y) {
  const n = x.length;
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let Sxx = 0, Sxy = 0, Syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xbar, dy = y[i] - ybar;
    Sxx += dx * dx; Sxy += dx * dy; Syy += dy * dy;
  }
  const slope = Sxy / Sxx;
  const intercept = ybar - slope * xbar;
  let SSE = 0;
  const residuals = new Array(n);
  for (let i = 0; i < n; i++) {
    const fitted = slope * x[i] + intercept;
    residuals[i] = y[i] - fitted;
    SSE += residuals[i] * residuals[i];
  }
  const s2 = SSE / (n - 2); // residual mean-square, standard OLS denominator (2 estimated params)
  const seSlope = Math.sqrt(s2 / Sxx);
  const r2 = Syy > 0 ? 1 - SSE / Syy : null;
  return { slope, intercept, seSlope, r2, residuals, residSigma: Math.sqrt(s2) };
}

function contiguousLongEpisodes(exposures) {
  const episodes = [];
  let start = null;
  for (let i = 0; i < exposures.length; i++) {
    if (exposures[i] === 1 && start === null) start = i;
    if (exposures[i] !== 1 && start !== null) { episodes.push({ length: i - start }); start = null; }
  }
  if (start !== null) episodes.push({ length: exposures.length - start });
  return episodes;
}

function scoreAsset(symbol, candles) {
  const N = candles.length;
  const cut = Math.floor(N * TRAIN_FRACTION);
  if (cut < 30 || N - cut < MIN_HOLDOUT_DAYS) return null; // too little train or holdout

  const t = candles.map((_, i) => i + 1);
  const logT = t.map((v) => Math.log(v));
  const logClose = candles.map((c) => Math.log(Number(c.close)));

  const fit = ols(logT.slice(0, cut), logClose.slice(0, cut));
  // naive-drift comparison model, same train segment, x = raw day index (not log)
  const driftFit = ols(t.slice(0, cut), logClose.slice(0, cut));

  // exposure state machine over the WHOLE series (train included, so holdout starts with real
  // history), scored (returns/cost) from the holdout cut onward only
  const exposures = new Array(N);
  let prevExposure = 0;
  for (let i = 0; i < N; i++) {
    const fitted = fit.slope * logT[i] + fit.intercept;
    const z = (logClose[i] - fitted) / fit.residSigma;
    const exposure = z <= -BAND_K ? 1 : z >= BAND_K ? 0 : prevExposure;
    exposures[i] = exposure;
    prevExposure = exposure;
  }

  const episodes = contiguousLongEpisodes(exposures.slice(cut));

  // Equity cost model (unavoidable difference from crypto, see header): commission-per-share
  // converted to a percentage via this symbol's average HOLDOUT close, plus slippage per side —
  // exact equities-madip-significance.mjs convention.
  const holdoutCloses = candles.slice(cut).map((c) => Number(c.close));
  const avgHoldoutClose = holdoutCloses.reduce((a, b) => a + b, 0) / holdoutCloses.length;
  const oneSideCost = COMMISSION_PER_SHARE / avgHoldoutClose + SLIPPAGE_PCT_EQUITY;

  const stratRets = [];
  const bhRets = [];
  const flatRets = [];
  let exposure = exposures[cut - 1] ?? 0; // exposure state entering the holdout window
  for (let i = cut; i < N; i++) {
    const targetExposure = exposures[i];
    const assetReturn = Number(candles[i].close) / Number(candles[i - 1].close) - 1;
    let dayReturn = targetExposure === 1 ? assetReturn : 0;
    if (targetExposure !== exposure) dayReturn -= oneSideCost;
    exposure = targetExposure;
    stratRets.push(dayReturn);
    bhRets.push(assetReturn);
    flatRets.push(0);
  }
  if (bhRets.length) { bhRets[0] -= oneSideCost; bhRets[bhRets.length - 1] -= oneSideCost; }

  const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const strategyReturn = compound(stratRets);
  const buyHoldReturn = compound(bhRets);
  const flatReturn = compound(flatRets); // always 0, kept as an explicit series for symmetry

  return {
    symbol,
    trainDays: cut,
    holdoutDays: N - cut,
    oneSideCost,
    slope: fit.slope,
    seSlope: fit.seSlope,
    r2LogLog: fit.r2,
    r2Drift: driftFit.r2,
    deltaR2: fit.r2 - driftFit.r2,
    holdoutEpisodes: episodes.length,
    strategyReturn,
    buyHoldReturn,
    flatReturn,
    outperformance: strategyReturn - buyHoldReturn,
    flatOutperformance: flatReturn - buyHoldReturn,
    signalMinusFlat: strategyReturn - flatReturn,
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function main() {
  const perAsset = [];
  const skipped = [];
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles) { skipped.push({ symbol, reason: "MISSING CACHE — cache-only by design, no re-fetch" }); continue; }
    if (candles.length < MIN_CANDLES) { skipped.push({ symbol, reason: `only ${candles.length} candles, floor is ${MIN_CANDLES}` }); continue; }
    const scored = scoreAsset(symbol, candles);
    if (!scored) { skipped.push({ symbol, reason: "train or holdout segment too short after split" }); continue; }
    perAsset.push(scored);
  }

  const outperformance = perAsset.map((a) => a.outperformance);
  const flatOutperformance = perAsset.map((a) => a.flatOutperformance);
  const signalMinusFlat = perAsset.map((a) => a.signalMinusFlat);

  const primary = { ...signFlipP(outperformance), ci95: bootstrapCI(outperformance, ITERATIONS, SIGN_FLIP_SEED + 1) };
  const alwaysFlatControl = { ...signFlipP(flatOutperformance), ci95: bootstrapCI(flatOutperformance, ITERATIONS, SIGN_FLIP_SEED + 2) };
  const signalVsFlat = { ...signFlipP(signalMinusFlat), ci95: bootstrapCI(signalMinusFlat, ITERATIONS, SIGN_FLIP_SEED + 3) };

  const medianDeltaR2 = median(perAsset.map((a) => a.deltaR2));
  const medianSeSlope = median(perAsset.map((a) => a.seSlope));
  const medianSlope = median(perAsset.map((a) => a.slope));
  const buyHoldReturns = perAsset.map((a) => a.buyHoldReturn);
  const negativeBuyHoldCount = buyHoldReturns.filter((r) => r < 0).length;

  const result = {
    universeSize: perAsset.length,
    skipped,
    perAsset,
    modelDiagnostic: { medianSlope, medianSeSlope, medianDeltaR2 },
    buyHoldDirection: { negativeBuyHoldCount, positiveBuyHoldCount: perAsset.length - negativeBuyHoldCount, medianBuyHoldReturn: median(buyHoldReturns) },
    pooled: {
      n: perAsset.length,
      primary: { observedMean: primary.observedMean, ci95: primary.ci95, p: primary.p, signCorrect: primary.observedMean > 0 },
      alwaysFlatControl: { observedMean: alwaysFlatControl.observedMean, ci95: alwaysFlatControl.ci95, p: alwaysFlatControl.p },
      signalVsFlat: { observedMean: signalVsFlat.observedMean, ci95: signalVsFlat.ci95, p: signalVsFlat.p },
    },
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("log-regression-bands-equities", {
    universe: UNIVERSE,
    bandK: BAND_K,
    trainFraction: TRAIN_FRACTION,
    minCandles: MIN_CANDLES,
    minHoldoutDays: MIN_HOLDOUT_DAYS,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, result);
  console.error(`\nSaved to ${file}`);
}

main();
