/**
 * LOG-REGRESSION-BANDS-CRYPTO (additive, local candles only, no egress).
 *
 * Never attempted in this project despite being a well-known crypto framing (zero hits for
 * log.regression/power.law/rainbow across VERDICTS.md/ROADMAP.md before this). STRUCTURAL
 * REQUIREMENT (per this item's own work_queue note): generates market EXPOSURE directly, never
 * a gate/filter on breakout/anticipate — template_a_exhausted retires that shape, and the
 * zero-fee floor already explains why filtering a no-gross-edge population cannot work.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * MODEL. Per asset, fit OLS: log(close) ~ a + b*log(t), where t = 1..N is the day INDEX SINCE
 * THIS STORE'S LOCAL WINDOW START for that asset (not true listing/genesis date — this
 * codebase does not track that, and the task text explicitly allows either framing; using
 * window-start is disclosed here rather than silently mislabeled as genesis). Fit on TRAIN ONLY
 * (first 70% of that asset's local candle history); the frozen (slope, intercept) are then
 * applied UNCHANGED to every day, train and holdout alike, to compute a standardized residual
 * z = (actual - fitted) / trainResidualSigma, where trainResidualSigma is the train-only
 * regression's residual standard error.
 *
 * BAND (fixed, not searched, single symmetric threshold): BAND_K = 1.5 standard deviations.
 * Long (exposure=1) when z <= -BAND_K (price far below trend); flat (exposure=0) when
 * z >= +BAND_K (price far above trend); inside the band, carry the prior day's exposure
 * forward (hysteresis — this project's existing `btcRegimeMap`/MACRO-REGIME-PRIMARY-SIGNAL
 * convention, adopted here to avoid single-day whipsaw at the threshold rather than fit
 * against this run's own outcome). Start flat before any exposure has been set.
 *
 * SCORING WINDOW. Exposure is computed continuously from day 1 (so the state machine has real
 * history by the time holdout starts), but returns/cost are counted from the holdout cut
 * onward only. Standing project real crypto cost basis (FEE_RATE 0.008 + SLIPPAGE_PCT
 * 0.0005/side, ~1.7% round trip) charged once on every exposure flip day; buy-and-hold gets one
 * entry-cost and one exit-cost charge over the same window for a fair comparison
 * (MACRO-REGIME-PRIMARY-SIGNAL's convention, reused verbatim).
 *
 * UNIVERSE. All active (non-SEALED_SYMBOLS) watchlist assets with >=150 local daily candles (a
 * floor chosen for regression stability before any result existed — every active asset clears
 * it as of this run, min is EOS at 160, so this excludes nothing in practice but is stated as a
 * rule, not a post-hoc description of what happened to qualify).
 *
 * MODEL-FORM DIAGNOSTIC (this item's own explicit ask: state plainly whether the fit is even
 * stable, and whether it beats a naive drift baseline). For each asset, also fit a second,
 * non-nested OLS on the same train segment: log(close) ~ a + b*t (t raw, not log-transformed) —
 * a plain constant-percentage-growth ("drift") model. Report both models' train R^2 and the
 * log-log slope's standard error; the log-log framing is only informative where its R^2
 * exceeds the drift model's by a non-trivial margin — otherwise the bands carry no information
 * beyond "price went up."
 *
 * SIGNIFICANCE. Per-asset unit of observation: holdout strategy return minus holdout
 * buy-and-hold return (both compounded, cost-inclusive), one scalar per asset — independence is
 * across ASSETS here (not days, which are cross-sectionally correlated within a single calendar
 * window and would overstate n), giving n = universe size (~24), not day-count. One-sided
 * sign-flip permutation test (H1: mean outperformance > 0, matching
 * EQUITIES-MADIP-SIGNIFICANCE's convention), plain cross-sectional bootstrap 95% CI
 * (momentum.mjs's `bootstrapCI`, unmodified — the same function momentum.mjs itself uses for
 * per-panel/per-symbol IC values, not the block variant, because these units are
 * cross-sectional, not a single autocorrelated time series). The one-sided direction is
 * pre-registered on the mechanism's own economic rationale (a mean-reversion exposure signal is
 * hypothesized to help by avoiding exposure during overextended trends, not because a result
 * was already seen — this is this project's first run of this method, unlike
 * EQUITIES-MADIP-SIGNIFICANCE which had a prior point estimate to justify its direction).
 * MULTIPLE-COMPARISONS (binding, AGENT_PROTOCOL.md): this reports a p-value against a
 * pre-registered gate, so it joins the formal-NHST family (13 sub-tests as of 2026-08-22);
 * BH-FDR is recomputed family-wide and MULTIPLE_COMPARISONS_AUDIT.md + AGENT_PROTOCOL.md are
 * updated in the SAME commit, per that document's own binding rule. The raw p-value is not
 * evaluated against alpha=0.05 in isolation.
 * ================================================================================================
 */
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols } from "../../researchlib.mjs";
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { bootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real crypto cost basis
const TRAIN_FRACTION = 0.7;
const MIN_CANDLES = 150;
const MIN_HOLDOUT_DAYS = 20;
const BAND_K = 1.5;
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention (not exported
// there, duplicated here at the same small scale, matching equities-madip-significance.mjs).
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (matches
// scripts/equities-madip-significance.mjs's convention exactly).
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

  const stratRets = [];
  const bhRets = [];
  let exposure = exposures[cut - 1] ?? 0; // exposure state entering the holdout window
  for (let i = cut; i < N; i++) {
    const targetExposure = exposures[i];
    const assetReturn = Number(candles[i].close) / Number(candles[i - 1].close) - 1;
    let dayReturn = targetExposure === 1 ? assetReturn : 0;
    if (targetExposure !== exposure) dayReturn -= ONE_SIDE_COST;
    exposure = targetExposure;
    stratRets.push(dayReturn);
    bhRets.push(assetReturn);
  }
  if (bhRets.length) { bhRets[0] -= ONE_SIDE_COST; bhRets[bhRets.length - 1] -= ONE_SIDE_COST; }

  const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const strategyReturn = compound(stratRets);
  const buyHoldReturn = compound(bhRets);

  return {
    symbol,
    trainDays: cut,
    holdoutDays: N - cut,
    slope: fit.slope,
    seSlope: fit.seSlope,
    r2LogLog: fit.r2,
    r2Drift: driftFit.r2,
    deltaR2: fit.r2 - driftFit.r2,
    holdoutEpisodes: episodes.length,
    strategyReturn,
    buyHoldReturn,
    outperformance: strategyReturn - buyHoldReturn,
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  const watchlist = loadWatchlist();
  const { active } = splitSealedSymbols(watchlist);
  const activeSymbols = active.map((e) => (typeof e === "string" ? e : e.symbol));

  const perAsset = [];
  const skipped = [];
  for (const sym of activeSymbols) {
    const pair = symbolToKrakenId(sym);
    const candles = loadDailyCandles(pair);
    if (candles.length < MIN_CANDLES) { skipped.push({ symbol: sym, reason: `only ${candles.length} candles, floor is ${MIN_CANDLES}` }); continue; }
    const scored = scoreAsset(sym, candles);
    if (!scored) { skipped.push({ symbol: sym, reason: "train or holdout segment too short after split" }); continue; }
    perAsset.push(scored);
  }

  const outperformance = perAsset.map((a) => a.outperformance);
  const ci95 = bootstrapCI(outperformance, ITERATIONS, SIGN_FLIP_SEED + 1);
  const { p, observedMean } = signFlipP(outperformance);
  const medianDeltaR2 = median(perAsset.map((a) => a.deltaR2));
  const medianSeSlope = median(perAsset.map((a) => a.seSlope));
  const medianSlope = median(perAsset.map((a) => a.slope));

  const result = {
    universeSize: perAsset.length,
    skipped,
    perAsset,
    modelDiagnostic: { medianSlope, medianSeSlope, medianDeltaR2 },
    pooled: { n: perAsset.length, observedMean, ci95, p, signCorrect: observedMean > 0 },
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("log-regression-bands-crypto", {
    universe: activeSymbols,
    bandK: BAND_K,
    trainFraction: TRAIN_FRACTION,
    minCandles: MIN_CANDLES,
    minHoldoutDays: MIN_HOLDOUT_DAYS,
    oneSideCost: ONE_SIDE_COST,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, result);
  console.error(`\nSaved to ${file}`);
}

main();
