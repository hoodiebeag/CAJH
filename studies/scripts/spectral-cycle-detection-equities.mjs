/**
 * SPECTRAL-CYCLE-DETECTION-EQUITIES (additive, cache-only research — no IBKR egress).
 *
 * Companion to SPECTRAL-CYCLE-DETECTION-CRYPTO (2026-08-22, ROADMAP_ARCHIVE.md/VERDICTS.md: closed
 * NO-SIGNIFICANT-PERIODICITY). Reuses that item's periodogram/AR(1)-red-noise/BH-FDR method
 * UNCHANGED (this item's own work_queue note: "reuses the crypto implementation"). STRUCTURAL
 * REQUIREMENT carried over unmodified: any surviving cycle must generate market EXPOSURE
 * directly, never a gate/filter on breakout/anticipate — Template A stays retired.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * WHY THIS IS A DIFFERENT TEST THAN THE CRYPTO RUN, NOT A COPY-PASTE REPLICATION (this item's own
 * task text). Crypto has no strong a-priori reason to expect periodicity at any particular
 * frequency — that run was a pure fishing expedition, honestly labeled as one, and correctly found
 * nothing. Equities carry known calendar structure crypto does not: quarterly earnings releases,
 * monthly options expiry, and periodic index rebalancing are real, well-documented mechanisms that
 * could in principle imprint periodicity on return series at specific, predictable frequencies. That
 * gives this run a genuine pre-registered hypothesis instead of an unrestricted scan, and the two
 * must be reported separately — a peak at a pre-registered frequency is meaningfully stronger
 * evidence than the tallest peak of an uncorrected search, and conflating them would misrepresent
 * whichever number looks better.
 *
 * PRE-REGISTERED FREQUENCIES (fixed before the periodogram is computed, one per mechanism):
 *   - QUARTERLY (~63 trading days): earnings-cycle periodicity.
 *   - MONTHLY (~21 trading days): options-expiry-cycle periodicity.
 * Per asset, converted to the nearest tested DFT bin: k_target = round(nTrain / periodDays),
 * clamped to [1, floor(nTrain/2)]. Because every symbol in the fixed universe holds the same 501
 * cached candles (verified below), this lands on the same k for every asset in practice, but the
 * per-asset computation is kept general rather than hardcoded.
 *
 * DATA, MODEL, NULL, WITHIN-STUDY CORRECTION: byte-identical to
 * scripts/spectral-cycle-detection-crypto.mjs — per-asset log returns, TRAIN-mean subtracted (no
 * further detrending), direct O(n^2) DFT periodogram over f_k=k/n for k=1..floor(n/2), AR(1)
 * red-noise null (Torrence & Compo 1998 eq. 16 shape, closed-form p_k=exp(-J_k/P_k) tail),
 * Benjamini-Hochberg FDR at q=0.05. Reused verbatim rather than re-derived, per this item's own
 * instruction to change nothing about the method.
 *
 * TWO SEPARATE CORRECTIONS, NOT ONE (this item's own explicit instruction to distinguish
 * pre-registered from unrestricted results — the only way to do that honestly is to correct them as
 * two distinct families, not filter one family's output after the fact):
 *   (A) UNRESTRICTED family: every (asset, frequency) pair from every tested k, exactly the crypto
 *       study's pool — this is the uncorrected-for-hypothesis exploratory scan, BH-FDR'd on its own
 *       full size.
 *   (B) PRE-REGISTERED family: only the two target-k pairs per asset (quarterly, monthly) — a much
 *       smaller, targeted family (<=60 tests), BH-FDR'd on ITS OWN size. This is not "double dipping"
 *       the same p-values twice into one correction; it is the standard practice of giving
 *       pre-specified hypotheses their own (necessarily less conservative) correction, separate from
 *       an exploratory scan that shares the same underlying data. Both corrections are disclosed
 *       side by side in the result, never blended into a single number.
 *
 * CALENDAR/SAMPLING-ARTIFACT CHECK (this item's own explicit instruction — "the equity market being
 * older and better studied cuts both ways ... check ... the peak does not simply track the sampling
 * calendar"). Pre-registered rule, fixed before any survivor is known: a surviving (asset, k) is
 * flagged SUSPECTED-ARTIFACT if either (a) k<=2 — the two lowest tested frequencies are the ones most
 * exposed to residual low-frequency drift leaking through mean-only detrending (no linear/polynomial
 * term is removed, see DATA/MODEL above), so a "cycle" there is more parsimoniously explained as
 * undetrended trend than as periodicity; or (b) the survivor's implied period, rounded to the nearest
 * trading day, is a multiple of 5 (the trading week) that is NOT itself one of this study's own two
 * pre-registered periods — day-of-week/session periodicity was already tested directly by
 * SEASONALITY-DAYOFWEEK-SESSION, and an unrestricted-scan peak landing on a week-multiple would just
 * rediscover that finding under a different name rather than surface anything new.
 *
 * UNIVERSE: the same fixed 30-symbol DJIA universe as LOG-REGRESSION-BANDS-EQUITIES /
 * equities-madip-significance.mjs / equities-all-families-baseline.mjs (research-cache/equities-1d,
 * cache-only, no re-fetch) — this project's one fixed equities panel, not the crypto watchlist's
 * >=150-candle filter re-applied to a different set. All 30 symbols hold 501 cached daily candles,
 * far above the >=150 floor reused from LOG-REGRESSION-BANDS-EQUITIES (chosen there for regression
 * stability, reused here rather than inventing a spectral-specific floor).
 *
 * COST MODEL (if the decision rule below reaches the scoring step): IBKR-realistic
 * COMMISSION_PER_SHARE ($0.005) converted to a percentage via each symbol's average HOLDOUT close,
 * plus SLIPPAGE_PCT_EQUITY (0.0005/side) — LOG-REGRESSION-BANDS-EQUITIES's convention, reused
 * verbatim rather than crypto's flat percentage (this project has never used a flat percentage for
 * equities).
 *
 * DECISION RULE. Evaluated independently for each of the two families (A unrestricted, B
 * pre-registered). For a family with zero survivors: no trading logic is built from it — reported as
 * a plain null for that family. For a family with >=1 surviving (asset, frequency) pair: for each
 * surviving asset, take its lowest-p-value surviving frequency WITHIN THAT FAMILY, freeze
 * (period, phase) from TRAIN only, and generate the same deterministic phase-based exposure signal
 * as the crypto study (long while sin(2*pi*f*t+phase)>0, flat otherwise), continued unchanged into
 * HOLDOUT. An asset whose unrestricted-family survivor frequency IS one of its own pre-registered
 * k's is counted only under family B (pre-registered), not duplicated into family A's "unrestricted"
 * results — family A's economics, if computed, cover only genuinely exploratory (non-pre-registered)
 * survivors, so the two families' reported evidence never overlaps. Per-family unit of observation:
 * holdout strategy return minus holdout buy-and-hold return; one-sided sign-flip permutation test
 * (H1: mean outperformance > 0, direction pre-registered on the same mean-reversion/momentum-capture
 * rationale as every prior phase-based-exposure study in this project) plus bootstrapCI
 * (momentum.mjs, unmodified). Any family that reports a p-value this way joins the project's formal
 * NHST cross-study family (16 sub-tests as of 2026-08-22, MULTIPLE_COMPARISONS_AUDIT.md §2) and that
 * family-wide BH-FDR is recomputed in the same commit, per AGENT_PROTOCOL.md's binding rule.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { bootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../../researchlab.mjs";

// Exact same fixed universe as log-regression-bands-equities.mjs / equities-madip-significance.mjs.
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
const FDR_Q = 0.05;
const ITERATIONS = 5000;
const SIGN_FLIP_SEED = 20260822;
const PRE_REGISTERED_PERIODS = { quarterly: 63, monthly: 21 }; // trading days

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention (not exported
// there, duplicated here at the same small scale, matching every other script in this family).
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (matches
// spectral-cycle-detection-crypto.mjs / log-regression-bands-equities.mjs exactly).
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

// Direct O(n^2) DFT periodogram — identical to spectral-cycle-detection-crypto.mjs.
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
  return { ordinates: out, sigma2, kMax };
}

function redNoiseTest(ordinates, phi) {
  return ordinates.map(({ k, f, Jk }) => {
    const Pk = (1 - phi * phi) / (1 - 2 * phi * Math.cos(2 * Math.PI * f) + phi * phi);
    const ratio = Pk > 0 ? Jk / Pk : Infinity;
    const p = Math.exp(-ratio);
    return { k, f, Jk, Pk, p };
  });
}

function benjaminiHochberg(pValues, q) {
  const m = pValues.length;
  if (m === 0) return [];
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

// Pre-registered calendar/sampling-artifact check — see header. Applied identically regardless of
// which family (A/B) the survivor came from.
function artifactFlag(k, periodDays) {
  if (k <= 2) return "near-DC (k<=2): more parsimoniously explained as undetrended residual drift than periodicity";
  const nearestWeekMultiple = Math.round(periodDays / 5) * 5;
  const isPreRegisteredPeriod = Object.values(PRE_REGISTERED_PERIODS).some((p) => Math.abs(periodDays - p) < 1);
  if (!isPreRegisteredPeriod && nearestWeekMultiple > 0 && Math.abs(periodDays - nearestWeekMultiple) < 0.5) {
    return `period~${nearestWeekMultiple}d is a trading-week multiple, already covered by SEASONALITY-DAYOFWEEK-SESSION`;
  }
  return null;
}

function scoreFrequency(candles, cut, k, nTrain) {
  const N = candles.length;
  const f = k / nTrain;
  const returns = logReturns(candles);
  const trainReturns = returns.slice(0, nTrain);
  const trainMean = mean(trainReturns);
  const xTrain = trainReturns.map((v) => v - trainMean);

  let Sc = 0, Ss = 0;
  for (let t = 0; t < xTrain.length; t++) {
    const angle = 2 * Math.PI * f * t;
    Sc += xTrain[t] * Math.cos(angle);
    Ss += xTrain[t] * Math.sin(angle);
  }
  const phase = Math.atan2(Ss, Sc);

  const exposures = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const cycleValue = Math.sin(2 * Math.PI * f * i + phase);
    exposures[i] = cycleValue > 0 ? 1 : 0;
  }

  const episodes = contiguousLongEpisodes(exposures.slice(cut));

  // IBKR-realistic equity cost model — log-regression-bands-equities.mjs convention, reused
  // verbatim (see header: this project has never used a flat percentage for equities).
  const holdoutCloses = candles.slice(cut).map((c) => Number(c.close));
  const avgHoldoutClose = holdoutCloses.reduce((a, b) => a + b, 0) / holdoutCloses.length;
  const oneSideCost = COMMISSION_PER_SHARE / avgHoldoutClose + SLIPPAGE_PCT_EQUITY;

  const stratRets = [];
  const bhRets = [];
  let exposure = exposures[cut - 1] ?? 0;
  for (let i = cut; i < N; i++) {
    const targetExposure = exposures[i];
    const assetReturn = Number(candles[i].close) / Number(candles[i - 1].close) - 1;
    let dayReturn = targetExposure === 1 ? assetReturn : 0;
    if (targetExposure !== exposure) dayReturn -= oneSideCost;
    exposure = targetExposure;
    stratRets.push(dayReturn);
    bhRets.push(assetReturn);
  }
  if (bhRets.length) { bhRets[0] -= oneSideCost; bhRets[bhRets.length - 1] -= oneSideCost; }

  const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const strategyReturn = compound(stratRets);
  const buyHoldReturn = compound(bhRets);
  const periodDays = 1 / f;

  return {
    frequency: f,
    periodDays,
    phase,
    holdoutEpisodes: episodes.length,
    strategyReturn,
    buyHoldReturn,
    outperformance: strategyReturn - buyHoldReturn,
    artifactFlag: artifactFlag(k, periodDays),
  };
}

function analyzeAsset(symbol, candles) {
  const N = candles.length;
  const cut = Math.floor(N * TRAIN_FRACTION);
  if (cut < 30 || N - cut < MIN_HOLDOUT_DAYS) return null;

  const returns = logReturns(candles);
  const nTrain = cut - 1;
  if (nTrain < 30) return null;
  const trainReturns = returns.slice(0, nTrain);
  const trainMean = mean(trainReturns);
  const xTrain = trainReturns.map((v) => v - trainMean);

  const phi = lag1Autocorr(xTrain);
  const { ordinates, kMax } = periodogram(xTrain);
  const tested = redNoiseTest(ordinates, phi);

  const preRegisteredK = {};
  for (const [name, periodDays] of Object.entries(PRE_REGISTERED_PERIODS)) {
    preRegisteredK[name] = Math.min(kMax, Math.max(1, Math.round(nTrain / periodDays)));
  }

  return { symbol, candles, cut, nTrain, kMax, phi, tested, preRegisteredK };
}

// Score one family's survivors: for each surviving asset, its lowest-p survivor WITHIN this
// family; freeze+score economics; run pooled significance across the family's scored assets.
function scoreFamily(perAsset, pool, survives, { excludeKForAsset } = {}) {
  const survivors = pool.filter((_, i) => survives[i]);
  const bySymbol = new Map();
  for (const s of survivors) {
    if (excludeKForAsset && excludeKForAsset(s.symbol, s.k)) continue;
    const existing = bySymbol.get(s.symbol);
    if (!existing || s.p < existing.p) bySymbol.set(s.symbol, { k: s.k, p: s.p });
  }
  if (bySymbol.size === 0) {
    return { survivorAssetCount: 0, scored: [], pooled: null };
  }
  const scored = [];
  for (const [symbol, { k, p }] of bySymbol) {
    const asset = perAsset.find((a) => a.symbol === symbol);
    const score = scoreFrequency(asset.candles, asset.cut, k, asset.nTrain);
    scored.push({ symbol, survivingFrequencyP: p, k, ...score });
  }
  const outperformance = scored.map((a) => a.outperformance);
  const ci95 = bootstrapCI(outperformance, ITERATIONS, SIGN_FLIP_SEED + 1);
  const { p, observedMean } = signFlipP(outperformance);
  return {
    survivorAssetCount: scored.length,
    scored,
    pooled: { n: scored.length, observedMean, ci95, p, signCorrect: observedMean > 0 },
  };
}

function main() {
  const perAsset = [];
  const skipped = [];
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles) { skipped.push({ symbol, reason: "MISSING CACHE — cache-only by design, no re-fetch" }); continue; }
    if (candles.length < MIN_CANDLES) { skipped.push({ symbol, reason: `only ${candles.length} candles, floor is ${MIN_CANDLES}` }); continue; }
    const analyzed = analyzeAsset(symbol, candles);
    if (!analyzed) { skipped.push({ symbol, reason: "train or holdout segment too short after split" }); continue; }
    perAsset.push(analyzed);
  }

  // Family A: unrestricted — every (asset, frequency) pair, exactly the crypto study's pool.
  const poolA = [];
  for (const asset of perAsset) {
    for (const t of asset.tested) poolA.push({ symbol: asset.symbol, k: t.k, f: t.f, p: t.p });
  }
  const survivesA = benjaminiHochberg(poolA.map((e) => e.p), FDR_Q);

  // Family B: pre-registered — only each asset's quarterly/monthly target k.
  const poolB = [];
  for (const asset of perAsset) {
    for (const [name, k] of Object.entries(asset.preRegisteredK)) {
      const hit = asset.tested.find((t) => t.k === k);
      if (hit) poolB.push({ symbol: asset.symbol, mechanism: name, k, f: hit.f, p: hit.p });
    }
  }
  const survivesB = benjaminiHochberg(poolB.map((e) => e.p), FDR_Q);

  // Family A economics must exclude any survivor whose k is one of that asset's own
  // pre-registered k's (see header: family A's economics cover genuinely exploratory hits only).
  const isPreRegisteredKFor = (symbol, k) => {
    const asset = perAsset.find((a) => a.symbol === symbol);
    return asset ? Object.values(asset.preRegisteredK).includes(k) : false;
  };

  const familyA = scoreFamily(perAsset, poolA, survivesA, { excludeKForAsset: isPreRegisteredKFor });
  const familyB = scoreFamily(perAsset, poolB, survivesB);

  const medianPhi = (() => {
    const s = perAsset.map((a) => a.phi).sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  })();

  const survivorsA = poolA.filter((_, i) => survivesA[i]);
  const survivorsB = poolB.filter((_, i) => survivesB[i]);

  const result = {
    universeSize: perAsset.length,
    skipped,
    medianPhi,
    preRegisteredPeriods: PRE_REGISTERED_PERIODS,
    familyA_unrestricted: {
      totalFrequenciesTested: poolA.length,
      fdrQ: FDR_Q,
      minRawP: poolA.length ? Math.min(...poolA.map((e) => e.p)) : null,
      rawSurvivorCount: survivorsA.length,
      rawSurvivors: survivorsA,
      finding: familyA.survivorAssetCount > 0 ? "SIGNIFICANT-PERIODICITY-FOUND" : "NO-SIGNIFICANT-PERIODICITY",
      economics: familyA,
    },
    familyB_preRegistered: {
      totalFrequenciesTested: poolB.length,
      fdrQ: FDR_Q,
      minRawP: poolB.length ? Math.min(...poolB.map((e) => e.p)) : null,
      rawSurvivorCount: survivorsB.length,
      rawSurvivors: survivorsB,
      finding: familyB.survivorAssetCount > 0 ? "SIGNIFICANT-PERIODICITY-FOUND" : "NO-SIGNIFICANT-PERIODICITY",
      economics: familyB,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("spectral-cycle-detection-equities", {
    universe: UNIVERSE,
    trainFraction: TRAIN_FRACTION,
    minCandles: MIN_CANDLES,
    minHoldoutDays: MIN_HOLDOUT_DAYS,
    fdrQ: FDR_Q,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    preRegisteredPeriods: PRE_REGISTERED_PERIODS,
    iterations: ITERATIONS,
    signFlipSeed: SIGN_FLIP_SEED,
  }, result);
  console.error(`\nSaved to ${file}`);
}

main();
