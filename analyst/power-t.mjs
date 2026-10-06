/**
 * Small-sample planning alternatives to the normal MDE — and exactly which problem each one solves.
 *
 * `analyst/power.mjs`'s `mde` answers ONE question: for a two-sided test at level α with power 1−β,
 * assuming the per-period difference is normal with **known** σ and n **independent** periods, what is
 * the smallest detectable mean? At n = 4 that assumption set is doing heavy lifting, and this module
 * quantifies how much, without changing `mde` or any protocol figure.
 *
 * ═══ THREE DIFFERENT PROBLEMS. CONFLATING THEM IS THE WHOLE HAZARD ═══
 *
 * 1. `mde` (normal, known σ) — a z-test. σ is treated as a constant, not estimated.
 *
 * 2. `mdeTQuantileHeuristic` — substitutes the critical **t** value for the critical z and leaves the
 *    power term as a z. **THIS IS NOT AN EXACT POWER CALCULATION.** It corrects the level (a t-test
 *    rejects less readily at small df) but says nothing rigorous about power, because the test
 *    statistic under the alternative follows a NONCENTRAL t, not a shifted central t. It is reported
 *    because it is the substitution people reach for, and labelled a heuristic so nobody reads it as
 *    80% power.
 *
 * 3. `mdeTExact` — solves for the effect at which a one-sample t-test genuinely attains the target
 *    power, with σ ESTIMATED from the same n observations. Power is computed from the noncentral-t
 *    rejection probability by simulation, so it carries a stated Monte Carlo error rather than a
 *    closed form this file would have to get right unverified. This is the honest small-n answer under
 *    normality.
 *
 * 4. `mdeBootstrapConditional` — resamples an OBSERVED sample. **Conditional historical sensitivity,
 *    not fresh evidence and not guaranteed coverage.** It asks "if the future looks exactly like this
 *    sample's empirical distribution, what would the test resolve". At n = 4 a bootstrap has at most
 *    4^4 = 256 distinct resamples and cannot represent a tail it never observed, so its interval is a
 *    statement about the sample, not a confidence statement about the world.
 *
 * ═══ TWO UNCERTAINTIES, KEPT APART ═══
 *
 * UNCERTAINTY IN σ is what (3) addresses: at small n the estimate is noisy and the test pays for it.
 * SAMPLING POWER is the separate question of how often a true effect of a given size is detected. A
 * figure that mixes them reads as more precise than it is. Each function below says which it answers.
 *
 * Nothing here amends `docs/PAPER-PROTOCOL.md`, changes `mde`, or proposes a gate.
 */

import { seededRng } from "../inference.mjs";
import { Z_ALPHA_TWO_SIDED_95, Z_POWER_80 } from "./power.mjs";

const positive = (v, label) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new Error(`power-t: ${label} must be a finite positive number, got ${v}`);
  }
  return v;
};
const intAtLeast = (v, min, label) => {
  if (!Number.isInteger(v) || v < min) throw new Error(`power-t: ${label} must be an integer >= ${min}, got ${v}`);
  return v;
};

/** Natural log of the gamma function (Lanczos). Used only by the incomplete beta below. */
function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betacf(a, b, x) {
  const TINY = 1e-300, EPS = 3e-16, MAXIT = 300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a,b). */
export function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betacf(a, b, x) / a
    : 1 - front * betacf(b, a, 1 - x) / b;
}

/** CDF of Student's t with `df` degrees of freedom. */
export function studentTCdf(t, df) {
  intAtLeast(df, 1, "df");
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const p = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t > 0 ? 1 - p : p;
}

/**
 * Two-sided critical value: the `p`-quantile of Student's t.
 *
 * Bisection on the CDF rather than an approximation formula, so accuracy is bounded by the tolerance
 * rather than by a fitted expansion. Verified in the tests against the standard table.
 */
export function studentTQuantile(p, df, tol = 1e-10) {
  if (!(p > 0 && p < 1)) throw new Error(`power-t: p must be strictly between 0 and 1, got ${p}`);
  intAtLeast(df, 1, "df");
  let lo = -1e3, hi = 1e3;
  for (let k = 0; k < 400 && hi - lo > tol; k++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A T-QUANTILE HEURISTIC, NOT A POWER CALCULATION.
 *
 * Substitutes the critical t for the critical z and keeps a normal power term. Corrects the LEVEL for
 * an estimated σ; does NOT correctly account for power, because under the alternative the statistic is
 * noncentral t. Reported for comparison and labelled so it is not mistaken for exact power.
 */
export function mdeTQuantileHeuristic(sigma, n, { alpha = 0.05, zPower = Z_POWER_80 } = {}) {
  positive(sigma, "sigma");
  intAtLeast(n, 2, "n");
  return (studentTQuantile(1 - alpha / 2, n - 1) + zPower) * sigma / Math.sqrt(n);
}

/**
 * Simulated power of a two-sided one-sample t-test, with σ ESTIMATED from the same n observations.
 *
 * ANSWERS: "given a true mean of `delta` and a true sd of `sigma`, how often does the t-test reject?"
 * This is the noncentral-t rejection probability, obtained by simulation so that the figure rests on
 * the definition of the test rather than on an unverified closed form. The Monte Carlo standard error
 * is returned alongside and is not optional reading: at 20,000 draws it is about 0.3 percentage points.
 */
export function tTestPowerSimulated({ n, delta, sigma, alpha = 0.05, draws = 20000, seed = 7 }) {
  intAtLeast(n, 2, "n");
  positive(sigma, "sigma");
  if (typeof delta !== "number" || !Number.isFinite(delta)) throw new Error(`power-t: delta must be finite, got ${delta}`);
  const crit = studentTQuantile(1 - alpha / 2, n - 1);
  const rng = seededRng(seed);
  const gauss = () => {
    const u = Math.max(1e-12, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let rejects = 0;
  for (let d = 0; d < draws; d++) {
    let sum = 0, sumsq = 0;
    for (let k = 0; k < n; k++) {
      const x = delta + sigma * gauss();
      sum += x; sumsq += x * x;
    }
    const m = sum / n;
    const s2 = (sumsq - n * m * m) / (n - 1);
    if (s2 <= 0) continue;
    if (Math.abs(m / Math.sqrt(s2 / n)) > crit) rejects++;
  }
  const power = rejects / draws;
  return { power, draws, se: Math.sqrt(Math.max(power * (1 - power), 1e-12) / draws), crit };
}

/**
 * The effect at which the t-test attains `power`, found by bisection on the simulated power.
 *
 * ANSWERS the question `mde` answers, but with σ estimated rather than known. Returns the Monte Carlo
 * error of the power estimate at the solution, because a bisection on a noisy function is only as
 * precise as that noise.
 */
export function mdeTExact({ sigma, n, alpha = 0.05, power = 0.8, draws = 20000, seed = 7 }) {
  positive(sigma, "sigma");
  intAtLeast(n, 2, "n");
  if (!(power > alpha && power < 1)) throw new Error(`power-t: power must be in (alpha, 1), got ${power}`);
  let lo = 0, hi = 10 * sigma;
  // Each evaluation reuses the same seed so the bisection sees one smooth function rather than noise.
  const at = (delta) => tTestPowerSimulated({ n, delta, sigma, alpha, draws, seed }).power;
  for (let k = 0; k < 60 && hi - lo > sigma * 1e-6; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < power) lo = mid; else hi = mid;
  }
  const delta = (lo + hi) / 2;
  const check = tTestPowerSimulated({ n, delta, sigma, alpha, draws, seed });
  return { mde: delta, attainedPower: check.power, powerSe: check.se, draws, seed };
}

/**
 * CONDITIONAL HISTORICAL SENSITIVITY — resample an observed sample and ask what the test would resolve.
 *
 * NOT fresh evidence, NOT a coverage guarantee. It is conditional on the empirical distribution of
 * `sample`: a tail that sample never observed cannot appear in any resample. At n = 4 there are at most
 * 4^4 = 256 distinct resamples, so the answer is a statement about those four numbers.
 *
 * Reports `distinctResamplesBound` precisely so that limit is visible rather than implied.
 */
export function mdeBootstrapConditional({ sample, alpha = 0.05, power = 0.8, draws = 4000, seed = 11 }) {
  if (!Array.isArray(sample) || sample.length < 2) throw new Error("power-t: sample needs at least 2 observations");
  if (!sample.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("power-t: sample must be finite numbers");
  const n = sample.length;
  const crit = studentTQuantile(1 - alpha / 2, n - 1);
  const rng = seededRng(seed);
  const centre = sample.reduce((a, b) => a + b, 0) / n;
  const centred = sample.map((x) => x - centre);     // impose the null, so the shift is the only effect

  const rejectsAt = (delta) => {
    let rejects = 0;
    for (let d = 0; d < draws; d++) {
      let sum = 0, sumsq = 0;
      for (let k = 0; k < n; k++) {
        const x = centred[Math.floor(rng() * n)] + delta;
        sum += x; sumsq += x * x;
      }
      const m = sum / n;
      const s2 = (sumsq - n * m * m) / (n - 1);
      if (s2 <= 0) continue;
      if (Math.abs(m / Math.sqrt(s2 / n)) > crit) rejects++;
    }
    return rejects / draws;
  };
  const spread = Math.sqrt(centred.reduce((a, b) => a + b * b, 0) / (n - 1));
  let lo = 0, hi = Math.max(10 * spread, 1e-6);
  for (let k = 0; k < 40 && hi - lo > spread * 1e-4; k++) {
    const mid = (lo + hi) / 2;
    if (rejectsAt(mid) < power) lo = mid; else hi = mid;
  }
  return {
    mde: (lo + hi) / 2, n, draws, seed,
    distinctResamplesBound: n ** n,
    conditional: true,
    note: "conditional on this sample's empirical distribution; not a coverage guarantee",
  };
}

/** The normal MDE, re-exported for side-by-side comparison without importing two modules. */
export function mdeNormal(sigma, n, { zAlpha = Z_ALPHA_TWO_SIDED_95, zPower = Z_POWER_80 } = {}) {
  positive(sigma, "sigma");
  intAtLeast(n, 2, "n");
  return (zAlpha + zPower) * sigma / Math.sqrt(n);
}
