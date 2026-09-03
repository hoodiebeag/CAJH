/**
 * vrp.mjs — does a variance risk premium exist in this account's data? (C1, stage 1)
 *
 * WHY THIS IS A DIFFERENT QUESTION. Every one of the 22 studies in the formal family asked
 * whether short-horizon direction is predictable. The answer was no, 22 times (`FINDINGS.md`).
 * The variance risk premium is not a directional prediction: it is the gap between the volatility
 * options are priced at and the volatility that subsequently occurs. If it is positive on average,
 * someone selling that volatility is being paid to carry risk, not to be right about direction.
 * That is a structurally different source of return, which is the only honest reason to look here.
 *
 * WHAT THIS IS NOT. **A positive premium is not a return.** It is a statistical gap measured on
 * quoted implied volatility against subsequent realised volatility. Turning it into P&L requires
 * real option prices, a defined-risk structure, bid/ask, assignment risk and margin — none of
 * which are modelled here. Stage 2 is that, and it only exists if stage 1 clears the gate below.
 * The gap between "IV exceeds RV on average" and "a short-volatility position nets positive after
 * costs" is exactly the gap that killed the crypto programme, where a real +0.0091R gross edge was
 * entirely consumed by fees. Do not repeat that error in the other direction by reporting a
 * premium as though it were profit.
 *
 * ALSO NOT A DISCOVERY. The variance risk premium is among the most documented effects in the
 * literature. Finding it here would confirm the data is sane, not that we have found something.
 * The question that matters is magnitude relative to this account's execution costs.
 *
 * THE SAMPLE PROBLEM, SETTLED BEFORE ANY DATA WAS SEEN. Daily IV observations against a forward
 * realised-vol window overlap almost completely: 502 daily observations with a 21-day window give
 * 481 overlapping but only 22 independent ones. Treating 481 as the sample size overstates
 * independence roughly 22-fold — the same effective-sample error that removed ma_dip's
 * zero-exclusion. So this study uses NON-OVERLAPPING windows and clusters on the window index.
 *
 * The horizon was chosen from that arithmetic, not from results. At 80% power and a plausible
 * spread, the minimum detectable premium is ~1.1-1.7 vol points at h=5 (99 windows) and
 * ~2.4-3.6 points at h=21 (22 windows). The documented premium lives around 1-3 points, so h=21
 * is underpowered on this much history and h=5 is not. h=5 is primary; h=21 is reported as a
 * secondary and is expected to be inconclusive rather than negative.
 *
 * CALIBRATION AT THE REAL SAMPLE SIZE, measured rather than assumed. Across 40 synthetic runs of
 * 520 daily bars — the amount of IV history this account actually has — the estimator recovers an
 * injected 2.00-vol-point premium as 2.12 on average with an SD of 0.54, detecting it in 37 of 40
 * runs (~92% power, matching the pre-registered power calculation). On a zero-premium series it
 * reports +0.12 on average and its interval excludes zero in 1 of 40 runs, at or below the nominal
 * 5% rate.
 *
 * Two things follow. The +0.12 residual is an order of magnitude smaller than the -1.08 bias that
 * the variance formulation removed, but it is not zero, so A MEASURED PREMIUM BELOW ROUGHLY 0.3
 * VOL POINTS SHOULD NOT BE TREATED AS ESTABLISHED whatever its interval says. And with an SD of
 * 0.54, a single real reading is worth about half a vol point of precision — enough to distinguish
 * a documented 1-3 point premium from nothing, not enough to pin its size closely.
 *
 * SPY AND QQQ ARE NOT TWO INDEPENDENT SAMPLES. They correlate around 0.9. They are scored
 * separately and both must clear; their observations are never pooled into one n.
 */

import { clusteredBootstrapCI } from "./inference.mjs";

export const TRADING_DAYS = 252;

/** Pre-registered before any result exists. Thresholds are not to be moved after seeing data. */
export const GATE = Object.freeze({
  horizonDays: 5,
  secondaryHorizonDays: 21,
  underlyings: ["SPY", "QQQ"],
  minWindows: 60,          // per underlying, at h=5; below this the study cannot answer
  minMeanVrp: 0,           // premium must be positive
  requireBothUnderlyings: true,
  ivPlausibleRange: [0.01, 3.0], // annualised decimal. A unit mismatch is the likeliest silent defect.
  alpha: 0.05,
  seed: 20260903,
});

export const PREREGISTRATION = Object.freeze({
  id: "C1-VRP-STAGE1-PREMIUM-EXISTS",
  kind: "variance-risk-premium",
  hypothesis:
    "Implied volatility quoted on SPY and QQQ exceeds the realised volatility subsequently " +
    "observed over the following 5 trading days, by a positive average amount, on this account's " +
    "own IBKR data. This is a statement about a statistical gap, NOT about tradeable return.",
  gate:
    "PASS iff, for BOTH SPY and QQQ scored separately and never pooled: at least 60 " +
    "non-overlapping 5-day windows are available; the mean VARIANCE premium (IV_t^2 - RV^2_[t,t+5]) " +
    "is positive; " +
    "and its 95% confidence interval, from resampling whole non-overlapping windows, excludes " +
    "zero. Any IV value outside [0.01, 3.0] annualised aborts the run as a unit mismatch rather " +
    "than being scored. A PASS establishes only that the premium exists in this data; it " +
    "authorises stage 2 (a defined-risk structure priced with real options and costs) and " +
    "nothing else. No position is implied and no return is claimed.",
  universe: ["SPY", "QQQ"],
  timeSplit: { note: "Whole available IV history, ~502 daily observations per underlying. No train/holdout split: this stage estimates a descriptive quantity rather than fitting anything, so there is no parameter to overfit and nothing to hold out from." },
  symbolSplit: { note: "SPY and QQQ scored independently and both required to clear. They correlate ~0.9 and are never pooled into a single n." },
  costAssumptions: { note: "None applied at stage 1, because no position is taken. Cost modelling is stage 2's entire difficulty and the premium must be large enough to survive it there." },
  seed: 20260903,
  notes: "Premium is measured on VARIANCE, not volatility: the sample standard deviation is a biased estimator of sigma at small n (c4 ~ 0.95 at h=5), worth about -1.08 vol points on a 0.18 series, which is the same sign and roughly the size of the effect being hunted. Measuring IV - RV directly would have produced a confident premium from a series containing none. Horizon fixed at 5 trading days on power grounds before any data was seen: h=21 yields only 22 independent windows and a ~2.4-3.6 vol-point minimum detectable effect, above the documented size of the premium.",
});

/**
 * Annualised close-to-close realised VARIANCE over `closes[i .. i+h]`.
 *
 * Variance, not volatility, and the distinction decides this study.
 *
 * The sample variance is an unbiased estimator of the true variance at any sample size. The
 * sample standard deviation is NOT an unbiased estimator of the true standard deviation, because
 * the square root is concave: E[s] = c4(n)·σ with c4 < 1. At h=5 (six observations) c4 ≈ 0.95,
 * and on a σ=0.18 series a five-day window measures 0.169 — a 1.08 vol-point shortfall that is
 * pure estimator bias.
 *
 * That bias has the same sign as the premium being hunted and is roughly the size of the minimum
 * detectable effect. Measuring IV − RV directly on short windows would therefore have produced a
 * confident "variance risk premium" out of a series constructed to contain none. The self-test
 * caught it (`vrp.test.mjs`, "NO premium produces no premium") before any real data was touched.
 *
 * So the premium is defined on variance: IV² − RV². Both sides are unbiased, and the vol-point
 * figure is derived afterwards purely for readability.
 */
export function realizedVariance(closes, i, h) {
  const rets = [];
  if (i + h >= closes.length) return null;
  for (let k = i + 1; k <= i + h; k++) {
    const a = Number(closes[k - 1]), b = Number(closes[k]);
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const varr = rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1);
  return varr * TRADING_DAYS;
}

/** Annualised realised volatility. Retained for reporting only -- biased low at short h, see above. */
export function realizedVol(closes, i, h) {
  if (i + h >= closes.length) return null;
  const rets = [];
  for (let k = i + 1; k <= i + h; k++) {
    const a = Number(closes[k - 1]), b = Number(closes[k]);
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const varr = rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr * TRADING_DAYS);
}

/**
 * Pair each window's opening implied volatility against the realised volatility that followed it.
 *
 * Windows are NON-OVERLAPPING by construction — index advances by `h`, not by 1. That is the
 * whole point: consecutive daily observations of a forward window share almost all their data and
 * are not independent evidence.
 */
export function vrpObservations(ivCloses, priceCloses, h) {
  if (ivCloses.length !== priceCloses.length) throw new Error("vrpObservations: iv and price series must align 1:1");
  const obs = [];
  for (let i = 0; i + h < priceCloses.length; i += h) {
    const iv = Number(ivCloses[i]);
    if (!Number.isFinite(iv)) continue;
    const rvar = realizedVariance(priceCloses, i, h);
    if (rvar === null) continue;
    // Premium on VARIANCE -- both sides unbiased. See realizedVariance for why not volatility.
    obs.push({ windowIndex: obs.length, iv, ivVar: iv * iv, rvVar: rvar, rv: Math.sqrt(rvar), vrpVar: iv * iv - rvar });
  }
  return obs;
}

/** Abort rather than score if IV is not in plausible annualised-decimal units. */
export function assertIvUnits(ivCloses, range = GATE.ivPlausibleRange) {
  const vals = ivCloses.map(Number).filter(Number.isFinite);
  if (!vals.length) return { ok: false, reason: "no finite IV values" };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo < range[0] || hi > range[1]) {
    return { ok: false, reason: `IV range [${lo}, ${hi}] outside plausible annualised decimals [${range[0]}, ${range[1]}] — likely a percent/decimal unit mismatch` };
  }
  return { ok: true, min: lo, max: hi };
}

/** Score one underlying. Never pools with another. */
export function scoreUnderlying(symbol, ivCloses, priceCloses, { h = GATE.horizonDays, gate = GATE } = {}) {
  const units = assertIvUnits(ivCloses, gate.ivPlausibleRange);
  if (!units.ok) return { symbol, h, aborted: true, reason: units.reason };
  const obs = vrpObservations(ivCloses, priceCloses, h);
  const vrp = obs.map((o) => o.vrpVar);
  if (!vrp.length) return { symbol, h, windows: 0, aborted: true, reason: "no usable windows" };
  const ci = clusteredBootstrapCI(vrp, {
    keys: obs.map((o) => o.windowIndex), // one cluster per non-overlapping window
    iterations: 2000, seed: gate.seed, alpha: gate.alpha,
  });
  const mean = vrp.reduce((a, b) => a + b, 0) / vrp.length;
  const meanIvVar = obs.reduce((a, o) => a + o.ivVar, 0) / obs.length;
  const meanRvVar = obs.reduce((a, o) => a + o.rvVar, 0) / obs.length;
  // DIAGNOSTICS ONLY -- no part of the gate reads these, and none of them can change a verdict.
  // Added after the 2026-09-03 run returned a negative premium, so a future run can show WHERE
  // that came from rather than leaving it to be inferred. The mean stays the gated statistic
  // because a position earns the mean: winning most weeks and giving it back in a few is negative
  // expectancy, not a strategy, and re-gating on the median would turn that into a false pass.
  const sorted = [...vrp].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const diagnostics = {
    medianVrpVariance: q(0.5),
    fractionPositive: vrp.filter((v) => v > 0).length / vrp.length,
    worstWindow: sorted[0],
    bestWindow: sorted[sorted.length - 1],
    // If a handful of windows dominate, the premium is being decided by tail events rather than
    // by a steady edge -- the short-volatility payoff shape, and worth seeing explicitly.
    shareOfTotalFromWorst5: sorted.slice(0, 5).reduce((a, b) => a + b, 0) / (mean * vrp.length || 1),
  };
  return {
    symbol, h, windows: vrp.length,
    diagnostics,
    meanVrpVariance: mean,
    // Derived for readability only: the difference of the root-mean variances. Not the mean of a
    // per-window vol difference, which would carry the small-sample bias back in.
    meanVrpVolPoints: Math.sqrt(meanIvVar) - Math.sqrt(meanRvVar),
    meanIv: Math.sqrt(meanIvVar),
    meanRv: Math.sqrt(meanRvVar),
    ci95: [ci.lo, ci.hi],
    excludesZero: ci.lo !== null && ci.lo > 0,
    enoughWindows: vrp.length >= gate.minWindows,
  };
}

/** Apply the pre-registered gate. Both underlyings must clear; nothing is pooled. */
export function evaluate(perUnderlying, gate = GATE) {
  const reasons = [], legs = [];
  for (const r of perUnderlying) {
    if (r.aborted) { reasons.push(`${r.symbol}: aborted — ${r.reason}`); legs.push({ pass: false, aborted: true }); continue; }
    const pass = r.enoughWindows && r.meanVrpVariance > gate.minMeanVrp && r.excludesZero;
    reasons.push(
      `${r.symbol}: ${r.windows} windows (need ${gate.minWindows}); variance premium ${r.meanVrpVariance.toExponential(3)} ` +
      `(= ${(r.meanVrpVolPoints * 100).toFixed(2)} vol pts: IV ${(r.meanIv * 100).toFixed(2)} vs RV ${(r.meanRv * 100).toFixed(2)}); ` +
      `95% CI on variance [${r.ci95[0].toExponential(3)}, ${r.ci95[1].toExponential(3)}] ${r.excludesZero ? "excludes" : "includes"} zero`);
    legs.push({ pass, aborted: false });
  }
  const anyAborted = legs.some((l) => l.aborted);
  const verdict = anyAborted ? "BLOCKED" : (legs.length && legs.every((l) => l.pass) ? "PASS" : "FAIL");
  return {
    verdict, reasons,
    meaning: "PASS means the premium exists in this data. It is not a return, authorises only stage 2, and implies no position.",
  };
}
