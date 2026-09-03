/**
 * SPECTRAL-CYCLE-DETECTION-CRYPTO (additive, local candles only, no egress).
 *
 * Never attempted in this project (zero hits for fourier/spectral/periodogram/cycle in the
 * verdict record before this). Distinct from SEASONALITY-DAYOFWEEK-SESSION, which tested FIXED
 * calendar buckets (day-of-week, session): this searches for periodicity at whatever frequency
 * the data actually contains, without assuming one in advance. STRUCTURAL REQUIREMENT (per this
 * item's own work_queue note): if a cycle is found, it must generate market EXPOSURE directly,
 * never a gate/filter on breakout/anticipate — template_a_exhausted retires that shape.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * HONEST PRIOR (stated by this item's own task text): financial return series are close to
 * spectrally flat: apparent cycles in short samples are overwhelmingly artifacts of finite-sample
 * noise. This study is built to reject its own hypothesis by default and only accept a cycle that
 * clears a real, pre-stated bar.
 *
 * DETRENDING. Per asset: log return r_t = log(close_t) - log(close_{t-1}) over the asset's local
 * candle history. The periodogram requires a zero-mean input, so the TRAIN-segment mean (first
 * 70% of that asset's history, matching this project's standing TRAIN_FRACTION convention) is
 * subtracted: x_t = r_t - mean(r_train). This is the entire "detrending" step — no additional
 * linear or polynomial detrending is applied, because log returns (unlike log price) are already
 * close to stationary; stated explicitly here rather than left implicit.
 *
 * SPECTRAL METHOD. Direct DFT periodogram (not a radix-2 FFT — train segments here run to a few
 * hundred points, so an O(n^2) direct sum costs nothing meaningful and avoids the zero-padding
 * distortion a power-of-2 FFT would otherwise force). For frequencies f_k = k/n, k = 1..floor(n/2)
 * (n = TRAIN length; k=0 is the removed mean, so it is never tested), the raw periodogram ordinate
 * is I_k = |X_k|^2 / n where X_k = sum_t x_t * exp(-2*pi*i*f_k*t). Normalized ordinate
 * J_k = I_k / sigma^2, sigma^2 = mean(x_t^2) over TRAIN (population variance; x_t is already
 * mean-zero by construction) — normalized so J_k has expectation ~1 under a white-noise null.
 *
 * NULL MODEL: AR(1) red noise, not white noise (stated explicitly per this item's own instruction
 * — financial returns are autocorrelated, and a white-noise null manufactures spurious "cycles"
 * out of that autocorrelation alone). phi = lag-1 sample autocorrelation of x_t over TRAIN (the
 * simple single-lag estimator; Torrence & Compo 1998 §4 recommend averaging lag-1 and sqrt(lag-2)
 * for extra robustness, but the plain lag-1 estimator is the earlier, more conservative Gilman et
 * al. (1963) form used by the same significance test below, and simpler is preferred here where
 * either choice is defensible). The theoretical red-noise spectral shape, normalized to average 1
 * over the tested frequencies exactly as the white-noise null above (Torrence & Compo 1998, eq 16):
 *   P_k = (1 - phi^2) / (1 - 2*phi*cos(2*pi*f_k) + phi^2)
 * Under this null, J_k / P_k is asymptotically Exponential(mean 1) (equivalently chi-square(2)/2 —
 * the standard large-sample periodogram-ordinate result, e.g. Percival & Walden 1993 §6.6), giving
 * a closed-form one-sided per-frequency p-value: p_k = exp(-J_k / P_k).
 *
 * MULTIPLE-COMPARISONS CORRECTION (this item's own explicit instruction: apply it ACROSS
 * FREQUENCIES within the study, or reporting the tallest peak uncorrected is the exact
 * look-elsewhere error already documented elsewhere in this project). Every (asset, frequency)
 * p-value produced by every asset in the universe is pooled into ONE family and corrected together
 * with a single Benjamini-Hochberg FDR pass at q=0.05 — not corrected per-asset and left uncorrected
 * across assets, which would just relocate the same look-elsewhere problem one level up (testing
 * ~20 assets, each internally "clean," is still ~20 chances for a fluke to slip through if the
 * cross-asset axis is never controlled). This is a deliberately more conservative reading than the
 * task text's literal "across frequencies" wording strictly requires, disclosed here rather than
 * silently assumed.
 *
 * DECISION RULE. If zero (asset, frequency) pairs survive the pooled BH-FDR at q=0.05:
 * NO-SIGNIFICANT-PERIODICITY is recorded as the complete finding and the study stops — no trading
 * logic is built on a null result. If one or more pairs survive: for each surviving asset, take its
 * lowest-p-value surviving frequency, freeze (period, phase) from the TRAIN fit only, and generate
 * a deterministic phase-based exposure signal — long (exposure=1) while the reconstructed cycle
 * sin(2*pi*f*t + phase) is positive, flat otherwise — continued unchanged into HOLDOUT (no
 * refitting on holdout data, matching every other study's train/freeze/holdout convention in this
 * project). Standing real crypto cost basis (FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side) charged on
 * every flip; buy-and-hold gets matching entry/exit cost (LOG-REGRESSION-BANDS-CRYPTO's convention,
 * reused verbatim). Per-asset unit of observation is holdout strategy return minus holdout
 * buy-and-hold return; with n=survivors, a one-sided sign-flip permutation test (H1: mean
 * outperformance > 0, direction pre-registered on the mechanism's own economic rationale before
 * running, not chosen after seeing a result) plus a plain cross-sectional bootstrap 95% CI
 * (momentum.mjs's bootstrapCI, unmodified). If this reports a p-value it joins the project's formal
 * NHST cross-study family (15 sub-tests as of 2026-08-22, MULTIPLE_COMPARISONS_AUDIT.md §2) and
 * that family-wide BH-FDR is recomputed in the same commit, per AGENT_PROTOCOL.md's binding rule —
 * a SEPARATE correction from the within-study frequency correction above, because it corrects
 * across different studies' pre-registered gates, not across this study's own frequency scan.
 *
 * UNIVERSE. All active (non-SEALED_SYMBOLS) watchlist assets with >=150 local daily candles,
 * matching LOG-REGRESSION-BANDS-CRYPTO's floor (chosen there for regression stability; reused here
 * rather than inventing a second, spectral-specific floor with no prior justification).
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
const FDR_Q = 0.05;
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention (not exported
// there, duplicated here at the same small scale, matching log-regression-bands-crypto.mjs).
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (matches
// scripts/log-regression-bands-crypto.mjs / scripts/equities-madip-significance.mjs exactly).
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function lag1Autocorr(x) {
  const n = x.length;
  let num = 0, den = 0;
  for (let t = 0; t < n; t++) den += x[t] * x[t];
  for (let t = 1; t < n; t++) num += x[t] * x[t - 1];
  return den > 0 ? num / den : 0;
}

// Direct O(n^2) DFT periodogram — see file header for why FFT/zero-padding is deliberately
// avoided at this sample size. Returns one entry per tested frequency k=1..floor(n/2).
function periodogram(x) {
  const n = x.length;
  const sigma2 = mean(x.map((v) => v * v));
  const kMax = Math.floor(n / 2);
  const out = [];
  for (let k = 1; k <= kMax; k++) {
    const f = k / n;
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * f * t;
      re += x[t] * Math.cos(angle);
      im += x[t] * Math.sin(angle);
    }
    const Ik = (re * re + im * im) / n;
    out.push({ k, f, Jk: sigma2 > 0 ? Ik / sigma2 : 0 });
  }
  return { ordinates: out, sigma2 };
}

// AR(1) red-noise significance test (Torrence & Compo 1998, eq 16 for the theoretical shape;
// the chi-square(2)/mean-1-exponential tail result is the standard large-sample periodogram
// distribution, e.g. Percival & Walden 1993 §6.6).
function redNoiseTest(ordinates, phi) {
  return ordinates.map(({ k, f, Jk }) => {
    const Pk = (1 - phi * phi) / (1 - 2 * phi * Math.cos(2 * Math.PI * f) + phi * phi);
    const ratio = Pk > 0 ? Jk / Pk : Infinity;
    const p = Math.exp(-ratio);
    return { k, f, Jk, Pk, p };
  });
}

// Benjamini-Hochberg FDR: given parallel arrays of p-values, returns a boolean survival mask
// (same order as input) at the given q.
function benjaminiHochberg(pValues, q) {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let cutoffRank = -1;
  for (let rank = 1; rank <= m; rank++) {
    if (indexed[rank - 1].p <= (rank / m) * q) cutoffRank = rank;
  }
  const survives = new Array(m).fill(false);
  if (cutoffRank >= 0) {
    for (let r = 0; r < cutoffRank; r++) survives[indexed[r].i] = true;
  }
  return survives;
}

function logReturns(candles) {
  const r = new Array(candles.length - 1);
  for (let i = 1; i < candles.length; i++) {
    r[i - 1] = Math.log(Number(candles[i].close)) - Math.log(Number(candles[i - 1].close));
  }
  return r;
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

// Score one asset's holdout economics for a single frozen (frequency, phase) cycle. `phase` is
// solved on TRAIN only (least-squares phase for the given frequency) then held fixed; the cycle
// is reconstructed identically across train+holdout (deterministic given period+phase, no
// refitting), and returns/cost are counted from the holdout cut onward only.
function scoreFrequency(candles, cut, k, nTrain) {
  const N = candles.length;
  const f = k / nTrain;
  const returns = logReturns(candles); // returns[i] = log return ending at candles[i+1]
  const trainReturns = returns.slice(0, nTrain);
  const trainMean = mean(trainReturns);
  const xTrain = trainReturns.map((v) => v - trainMean);

  // Least-squares phase fit on TRAIN: project x_t onto [cos(2*pi*f*t), sin(2*pi*f*t)].
  let Sc = 0, Ss = 0;
  for (let t = 0; t < xTrain.length; t++) {
    const angle = 2 * Math.PI * f * t;
    Sc += xTrain[t] * Math.cos(angle);
    Ss += xTrain[t] * Math.sin(angle);
  }
  const phase = Math.atan2(Ss, Sc); // cycle(t) = sin(2*pi*f*t + phase) convention below

  const exposures = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const cycleValue = Math.sin(2 * Math.PI * f * i + phase);
    exposures[i] = cycleValue > 0 ? 1 : 0;
  }

  const episodes = contiguousLongEpisodes(exposures.slice(cut));
  const stratRets = [];
  const bhRets = [];
  let exposure = exposures[cut - 1] ?? 0;
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
    frequency: f,
    periodDays: 1 / f,
    phase,
    holdoutEpisodes: episodes.length,
    strategyReturn,
    buyHoldReturn,
    outperformance: strategyReturn - buyHoldReturn,
  };
}

function analyzeAsset(symbol, candles) {
  const N = candles.length;
  const cut = Math.floor(N * TRAIN_FRACTION);
  if (cut < 30 || N - cut < MIN_HOLDOUT_DAYS) return null;

  const returns = logReturns(candles);
  const nTrain = cut - 1; // logReturns has one fewer element than candles
  if (nTrain < 30) return null;
  const trainReturns = returns.slice(0, nTrain);
  const trainMean = mean(trainReturns);
  const xTrain = trainReturns.map((v) => v - trainMean);

  const phi = lag1Autocorr(xTrain);
  const { ordinates } = periodogram(xTrain);
  const tested = redNoiseTest(ordinates, phi);

  return { symbol, candles, cut, nTrain, phi, tested };
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
    const analyzed = analyzeAsset(sym, candles);
    if (!analyzed) { skipped.push({ symbol: sym, reason: "train or holdout segment too short after split" }); continue; }
    perAsset.push(analyzed);
  }

  // Pool every (asset, frequency) p-value into one family for the correction.
  const pool = [];
  for (const asset of perAsset) {
    for (const t of asset.tested) pool.push({ symbol: asset.symbol, k: t.k, f: t.f, p: t.p });
  }
  const survives = benjaminiHochberg(pool.map((e) => e.p), FDR_Q);
  const survivors = pool.filter((_, i) => survives[i]);

  const totalFrequenciesTested = pool.length;
  const medianPhi = (() => {
    const s = perAsset.map((a) => a.phi).sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  })();

  if (survivors.length === 0) {
    const result = {
      finding: "NO-SIGNIFICANT-PERIODICITY",
      universeSize: perAsset.length,
      skipped,
      totalFrequenciesTested,
      fdrQ: FDR_Q,
      medianPhi,
      minRawP: Math.min(...pool.map((e) => e.p)),
      note: "Zero of the pooled (asset, frequency) p-values survived Benjamini-Hochberg FDR at q=0.05 across all frequencies of all assets. No trading logic was built on a null result, per this study's own pre-registered decision rule.",
    };
    console.log(JSON.stringify(result, null, 2));
    const file = saveExperiment("spectral-cycle-detection-crypto", {
      universe: activeSymbols,
      trainFraction: TRAIN_FRACTION,
      minCandles: MIN_CANDLES,
      minHoldoutDays: MIN_HOLDOUT_DAYS,
      fdrQ: FDR_Q,
      oneSideCost: ONE_SIDE_COST,
    }, result);
    console.error(`\nSaved to ${file}`);
    return;
  }

  // One or more (asset, frequency) pairs survived: take each surviving asset's lowest-p-value
  // surviving frequency, freeze phase on TRAIN, and score holdout economics.
  const bySymbol = new Map();
  for (const s of survivors) {
    const existing = bySymbol.get(s.symbol);
    const rawP = pool.find((e) => e.symbol === s.symbol && e.k === s.k).p;
    if (!existing || rawP < existing.p) bySymbol.set(s.symbol, { k: s.k, p: rawP });
  }

  const scored = [];
  for (const [symbol, { k, p }] of bySymbol) {
    const asset = perAsset.find((a) => a.symbol === symbol);
    const score = scoreFrequency(asset.candles, asset.cut, k, asset.nTrain);
    scored.push({ symbol, survivingFrequencyP: p, ...score });
  }

  const outperformance = scored.map((a) => a.outperformance);
  const ci95 = bootstrapCI(outperformance, ITERATIONS, SIGN_FLIP_SEED + 1);
  const { p, observedMean } = signFlipP(outperformance);

  const result = {
    finding: "SIGNIFICANT-PERIODICITY-FOUND",
    universeSize: perAsset.length,
    skipped,
    totalFrequenciesTested,
    fdrQ: FDR_Q,
    medianPhi,
    survivorCount: scored.length,
    perAsset: scored,
    pooled: { n: scored.length, observedMean, ci95, p, signCorrect: observedMean > 0 },
  };
  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("spectral-cycle-detection-crypto", {
    universe: activeSymbols,
    trainFraction: TRAIN_FRACTION,
    minCandles: MIN_CANDLES,
    minHoldoutDays: MIN_HOLDOUT_DAYS,
    fdrQ: FDR_Q,
    oneSideCost: ONE_SIDE_COST,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, result);
  console.error(`\nSaved to ${file}`);
}

main();
