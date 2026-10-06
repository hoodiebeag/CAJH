/**
 * Tests for the small-sample planning alternatives.
 *
 * Anchored on things that are checkable rather than on my own arithmetic: the standard critical-t table,
 * the identity that power at a zero effect equals α, and the large-n convergence of t to z. A statistical
 * routine that agrees only with itself has not been tested.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  incompleteBeta, studentTCdf, studentTQuantile, mdeNormal, mdeTQuantileHeuristic,
  mdeTExact, tTestPowerSimulated, mdeBootstrapConditional,
} from "./power-t.mjs";
import { Z_ALPHA_TWO_SIDED_95 } from "./power.mjs";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} !~= ${b} (tol ${tol})`);

// ---- the t distribution, against published values ----------------------------------------------

test("critical t at 97.5% matches the standard table at every tabulated df", () => {
  // Two-sided 95% critical values, i.e. the 0.975 quantile. These are the values printed in any
  // statistical table; the table carries three decimals, so agreement to 5e-4 is table precision.
  const table = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 10: 2.228,
                  15: 2.131, 20: 2.086, 30: 2.042, 60: 2.000, 100: 1.984, 120: 1.980 };
  for (const [df, want] of Object.entries(table)) {
    close(studentTQuantile(0.975, Number(df)), want, 5e-4);
  }
});

test("the t quantile converges to the normal as df grows", () => {
  // t -> z is the identity that makes the small-n correction vanish at large n, so it is asserted
  // rather than assumed.
  close(studentTQuantile(0.975, 100000), Z_ALPHA_TWO_SIDED_95, 1e-3);
  assert.ok(studentTQuantile(0.975, 5) > studentTQuantile(0.975, 50),
    "fewer degrees of freedom must give a LARGER critical value");
  // Monotone in df throughout.
  let prev = Infinity;
  for (const df of [1, 2, 5, 10, 30, 100, 1000]) {
    const q = studentTQuantile(0.975, df);
    assert.ok(q < prev, `critical t should fall with df, got ${q} after ${prev}`);
    prev = q;
  }
});

test("the t CDF is a proper distribution function", () => {
  for (const df of [1, 4, 30]) {
    close(studentTCdf(0, df), 0.5, 1e-12);                       // symmetric about zero
    close(studentTCdf(-2, df) + studentTCdf(2, df), 1, 1e-10);   // symmetry
    assert.ok(studentTCdf(-5, df) < studentTCdf(-1, df));        // monotone
    assert.ok(studentTCdf(5, df) > studentTCdf(1, df));
    assert.ok(studentTCdf(Infinity, df) === 1 && studentTCdf(-Infinity, df) === 0);
  }
  // Quantile inverts the CDF.
  for (const df of [2, 7, 40]) {
    for (const p of [0.6, 0.9, 0.975, 0.999]) {
      close(studentTCdf(studentTQuantile(p, df), df), p, 1e-8);
    }
  }
});

test("the incomplete beta matches values derivable in closed form", () => {
  // I_x(1,1) = x, since Beta(1,1) is uniform. An independent check of the continued fraction.
  for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) close(incompleteBeta(1, 1, x), x, 1e-12);
  // I_x(1,2) = 1-(1-x)^2 and I_x(2,1) = x^2.
  for (const x of [0.2, 0.5, 0.8]) {
    close(incompleteBeta(1, 2, x), 1 - (1 - x) ** 2, 1e-12);
    close(incompleteBeta(2, 1, x), x ** 2, 1e-12);
  }
  assert.equal(incompleteBeta(2, 3, 0), 0);
  assert.equal(incompleteBeta(2, 3, 1), 1);
});

// ---- power: the hard anchor and the ordering ----------------------------------------------------

test("ANCHOR: simulated power at a zero effect equals alpha", () => {
  // The one exact identity available without a reference implementation: a test at its own null
  // rejects exactly alpha of the time. If this drifts, the simulation or the critical value is wrong.
  for (const n of [4, 12, 50]) {
    for (const alpha of [0.05, 0.10]) {
      const r = tTestPowerSimulated({ n, delta: 0, sigma: 0.0235, alpha, draws: 40000, seed: 3 });
      close(r.power, alpha, 4 * r.se + 1e-9);
    }
  }
});

test("power rises with the effect, with n, and falls with sigma", () => {
  const base = { n: 12, sigma: 0.0235, draws: 8000, seed: 9 };
  const p = (o) => tTestPowerSimulated({ ...base, ...o }).power;
  assert.ok(p({ delta: 0.01 }) < p({ delta: 0.02 }), "power must rise with the effect");
  assert.ok(p({ delta: 0.02, n: 6 }) < p({ delta: 0.02, n: 40 }), "power must rise with n");
  assert.ok(p({ delta: 0.02, sigma: 0.05 }) < p({ delta: 0.02, sigma: 0.01 }), "power must fall with sigma");
  assert.ok(p({ delta: 1 }) > 0.99, "a huge effect must be detected almost always");
});

test("mdeTExact attains the power it targets, at every period count the protocol uses", () => {
  for (const n of [4, 12, 26, 50]) {
    const r = mdeTExact({ sigma: 0.0235, n, draws: 20000, seed: 7 });
    close(r.attainedPower, 0.8, 4 * r.powerSe + 1e-9);
    assert.ok(r.mde > 0);
  }
  // And a different target is honoured, so 0.8 is not hard-wired.
  const r90 = mdeTExact({ sigma: 0.0235, n: 12, power: 0.9, draws: 20000, seed: 7 });
  close(r90.attainedPower, 0.9, 4 * r90.powerSe + 1e-9);
  assert.ok(r90.mde > mdeTExact({ sigma: 0.0235, n: 12, power: 0.8, draws: 20000, seed: 7 }).mde,
    "higher power must need a larger effect");
});

// ---- the ordering between the three methods, which is the report's whole point -----------------

test("the exact t MDE exceeds the normal one, and the gap shrinks as n grows", () => {
  const sigma = 0.0235;
  const ratios = [4, 12, 26, 50].map((n) =>
    mdeTExact({ sigma, n, draws: 20000, seed: 7 }).mde / mdeNormal(sigma, n));
  for (const r of ratios) assert.ok(r > 1, `the t MDE must exceed the normal one, got ${r}`);
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] < ratios[i - 1], `the gap must shrink with n: ${ratios.join(", ")}`);
  }
  // At n=4 the correction is large; by n=50 it is small. Bands, not point values, since this is simulated.
  assert.ok(ratios[0] > 1.3 && ratios[0] < 1.8, `n=4 ratio ${ratios[0]} outside the expected band`);
  assert.ok(ratios[3] > 1.0 && ratios[3] < 1.08, `n=50 ratio ${ratios[3]} outside the expected band`);
});

test("THE HEURISTIC IS NOT THE EXACT ANSWER, and understates it at small n", () => {
  // The claim the module's naming rests on. Substituting a critical t fixes the level and leaves the
  // power term normal, so it cannot be read as attaining the target power.
  const sigma = 0.0235;
  const n = 4;
  const heur = mdeTQuantileHeuristic(sigma, n);
  const exact = mdeTExact({ sigma, n, draws: 20000, seed: 7 }).mde;
  assert.ok(heur > mdeNormal(sigma, n), "the heuristic must at least exceed the normal figure");
  assert.ok(heur < exact, `the heuristic ${heur} should understate the exact ${exact} at n=4`);

  // And the heuristic's own attained power is NOT the target — which is the point of the label.
  const attained = tTestPowerSimulated({ n, delta: heur, sigma, draws: 40000, seed: 5 });
  assert.ok(attained.power < 0.8 - 4 * attained.se,
    `the heuristic attains ${attained.power.toFixed(3)}, which should be materially below 0.80`);
});

test("the normal MDE attains materially less than 80% power at n=4", () => {
  // The headline reading of the report, asserted so it cannot silently change.
  const sigma = 0.0235;
  const nz = mdeNormal(sigma, 4);
  const r = tTestPowerSimulated({ n: 4, delta: nz, sigma, draws: 40000, seed: 5 });
  assert.ok(r.power < 0.6, `expected well under 0.60 at n=4, got ${r.power.toFixed(3)}`);
  // By 50 periods the normal figure is close to its target.
  const r50 = tTestPowerSimulated({ n: 50, delta: mdeNormal(sigma, 50), sigma, draws: 40000, seed: 5 });
  assert.ok(r50.power > 0.75, `expected above 0.75 at n=50, got ${r50.power.toFixed(3)}`);
});

// ---- the bootstrap's limits, asserted rather than described -------------------------------------

test("the bootstrap reports its conditional nature and its resample bound", () => {
  const sample = [0.01, -0.02, 0.015, -0.005];
  const b = mdeBootstrapConditional({ sample, draws: 2000, seed: 11 });
  assert.equal(b.conditional, true);
  assert.equal(b.n, 4);
  assert.equal(b.distinctResamplesBound, 256, "4^4 = 256 distinct resamples of four numbers");
  assert.match(b.note, /not a coverage guarantee/);
  assert.ok(b.mde > 0);
});

test("the bootstrap cannot represent a tail its sample never observed", () => {
  // The structural limitation. Two samples with the same sd but one carrying an outlier give different
  // answers, and neither can invent a tail outside its own data.
  const tight = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
  const withTail = [...tight.slice(0, 7), 0.2];
  const a = mdeBootstrapConditional({ sample: tight, draws: 3000, seed: 11 });
  const c = mdeBootstrapConditional({ sample: withTail, draws: 3000, seed: 11 });
  assert.ok(c.mde > a.mde, "a sample containing an outlier must yield a larger required effect");
  // Determinism, so a quoted figure is reproducible.
  assert.equal(mdeBootstrapConditional({ sample: tight, draws: 3000, seed: 11 }).mde, a.mde);
});

// ---- input rejection ---------------------------------------------------------------------------

test("every entry point rejects inputs that would yield a plausible wrong number", () => {
  for (const bad of [0, -1, NaN, Infinity, "0.02", null]) {
    assert.throws(() => mdeNormal(bad, 10), /sigma/);
    assert.throws(() => mdeTQuantileHeuristic(bad, 10), /sigma/);
    assert.throws(() => mdeTExact({ sigma: bad, n: 10 }), /sigma/);
  }
  for (const bad of [1, 0, -5, 2.5, "10"]) {
    assert.throws(() => mdeNormal(0.02, bad), /n must be an integer >= 2/);
    assert.throws(() => mdeTQuantileHeuristic(0.02, bad), /n must be an integer >= 2/);
  }
  for (const bad of [0, 1, -0.1, 1.5]) {
    assert.throws(() => studentTQuantile(bad, 10), /strictly between 0 and 1/);
  }
  for (const bad of [0, -1, 2.5, "5"]) assert.throws(() => studentTQuantile(0.9, bad), /df/);
  // power must sit above alpha and below 1, or the bisection is meaningless.
  assert.throws(() => mdeTExact({ sigma: 0.02, n: 10, power: 0.01 }), /power must be in/);
  assert.throws(() => mdeTExact({ sigma: 0.02, n: 10, power: 1 }), /power must be in/);
  assert.throws(() => tTestPowerSimulated({ n: 10, delta: NaN, sigma: 0.02 }), /delta must be finite/);
  assert.throws(() => mdeBootstrapConditional({ sample: [1] }), /at least 2 observations/);
  assert.throws(() => mdeBootstrapConditional({ sample: [1, NaN] }), /finite numbers/);
});

test("simulated figures are deterministic for a fixed seed and move with it", () => {
  const a = tTestPowerSimulated({ n: 8, delta: 0.02, sigma: 0.0235, draws: 4000, seed: 1 });
  const b = tTestPowerSimulated({ n: 8, delta: 0.02, sigma: 0.0235, draws: 4000, seed: 1 });
  const c = tTestPowerSimulated({ n: 8, delta: 0.02, sigma: 0.0235, draws: 4000, seed: 2 });
  assert.equal(a.power, b.power, "a fixed seed must reproduce");
  assert.notEqual(a.power, c.power, "a different seed must give a different draw");
  assert.ok(a.se > 0 && a.se < 0.02);
});

// ---- INDEPENDENT NUMERICAL ANCHORS ------------------------------------------------------------
//
// The twelve table values above are the standard printed critical-t table. This session's egress
// policy blocks itl.nist.gov and en.wikipedia.org, so no published table could be FETCHED to cite:
// those values are therefore asserted as known, which is weaker than a citation. What follows does
// not depend on them. It checks the module against (a) two exact closed forms and (b) deterministic
// quadrature written here from the densities, with a structure that shares no code with the module —
// no incomplete beta, no Lanczos gamma, no simulation.
//
// Every normalising constant is obtained by integrating the same density over its whole support, so
// the gamma functions cancel and nothing has to be looked up.

/** Simpson's rule on [a,b] with an even number of panels. */
function simpson(f, a, b, panels = 4000) {
  const h = (b - a) / panels;
  let s = f(a) + f(b);
  for (let i = 1; i < panels; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Φ(z), by quadrature of the normal density under x = tan(u), normalised by its own total mass. */
function normalCdfQuad(z) {
  const g = (u) => Math.exp(-(Math.tan(u) ** 2) / 2) / Math.cos(u) ** 2;
  const half = Math.PI / 2 - 1e-9;
  const total = simpson(g, -half, half, 2000);
  return simpson(g, -half, Math.atan(z), 2000) / total;
}

/** The t CDF, by the same substitution. Shares nothing with the module's incomplete-beta route. */
function tCdfQuad(t, nu) {
  const g = (u) => (1 + Math.tan(u) ** 2 / nu) ** (-(nu + 1) / 2) / Math.cos(u) ** 2;
  const half = Math.PI / 2 - 1e-9;
  const total = simpson(g, -half, half, 6000);
  return simpson(g, -half, Math.atan(t), 6000) / total;
}

/**
 * Exact two-sided one-sample t-test power, by quadrature over the chi-square density.
 *
 * Reject when |Zbar| > tc*U, with Zbar ~ N(lambda,1), U = S/sigma independent, lambda = delta*sqrt(n)/sigma.
 * So power = E_U[ Phi(lambda - tc*U) + Phi(-lambda - tc*U) ], and U = sqrt(V/k), V ~ chi2_k, k = n-1.
 * Integrating V's unnormalised density and dividing by its own total mass removes the gamma constant.
 */
function tPowerQuad({ n, delta, sigma, alpha = 0.05 }) {
  const k = n - 1;
  const lambda = (delta * Math.sqrt(n)) / sigma;
  const tc = studentTQuantile(1 - alpha / 2, k);
  const w = (v) => v ** (k / 2 - 1) * Math.exp(-v / 2);
  const hi = k + 40 * Math.sqrt(2 * k) + 60;          // far beyond any mass for these k
  const num = (v) => {
    const u = Math.sqrt(v / k);
    return (normalCdfQuad(lambda - tc * u) + normalCdfQuad(-lambda - tc * u)) * w(v);
  };
  return simpson(num, 1e-12, hi, 2000) / simpson(w, 1e-12, hi, 2000);
}

test("ANCHOR: the critical t matches exact closed forms at df 1 and df 2", () => {
  // df=1 is standard Cauchy: F(t) = 1/2 + arctan(t)/pi, so the 0.975 point is tan(0.475*pi).
  close(studentTQuantile(0.975, 1), Math.tan(0.475 * Math.PI), 1e-7);
  // df=2 has F(t) = (1 + t/sqrt(2+t^2))/2, which inverts to t = c*sqrt(2/(1-c^2)) with c = 2p-1.
  const c = 2 * 0.975 - 1;
  close(studentTQuantile(0.975, 2), c * Math.sqrt(2 / (1 - c * c)), 1e-7);
  // These are derived here, not looked up, so they stand even with no source reachable.
  close(studentTQuantile(0.975, 1), 12.7062, 5e-4);   // and they agree with the printed table
  close(studentTQuantile(0.975, 2), 4.3027, 5e-4);
});

test("ANCHOR: the t CDF agrees with independent quadrature of its own density", () => {
  for (const nu of [1, 2, 4, 11, 25, 49]) {
    for (const t of [-2.5, -0.7, 0.3, 1.4, 3.1]) {
      close(studentTCdf(t, nu), tCdfQuad(t, nu), 1e-6);
    }
  }
  // And the quantile inverts that independent CDF, which is what licenses using it below.
  for (const nu of [3, 11, 49]) close(tCdfQuad(studentTQuantile(0.975, nu), nu), 0.975, 1e-6);
});

test("ANCHOR at a NON-ZERO effect: simulated power matches exact noncentral quadrature", () => {
  // Power at delta=0 only checks the SIZE of the test. A mis-scaled alternative -- sigma for
  // sigma/sqrt(n), or one-sided for two-sided -- would pass every delta=0 check ever written. This is
  // the anchor that catches it, and it is deterministic.
  const sigma = 0.0235;
  for (const [n, delta] of [[4, 0.03], [4, 0.05], [12, 0.02], [26, 0.013], [50, 0.009]]) {
    const q = tPowerQuad({ n, delta, sigma });
    const s = tTestPowerSimulated({ n, delta, sigma, draws: 40000, seed: 17 });
    assert.ok(Math.abs(s.power - q) < 4 * s.se + 0.002,
      `n=${n} delta=${delta}: simulated ${s.power.toFixed(4)} vs quadrature ${q.toFixed(4)}`);
  }
  // A deliberately mis-scaled alternative must NOT match, or the comparison proves nothing.
  const bad = tPowerQuad({ n: 12, delta: 0.02 / Math.sqrt(12), sigma });
  const good = tPowerQuad({ n: 12, delta: 0.02, sigma });
  assert.ok(Math.abs(bad - good) > 0.3, "the quadrature must be sensitive to the sqrt(n) scaling");
});

test("ANCHOR: mdeTExact's reported MDE is the exact-power MDE, by quadrature", () => {
  // The headline numbers in docs/POWER-VALIDATION.md section 5f are these. Bisect the quadrature
  // independently and compare the EFFECT, not the power, so a flat power curve cannot hide a gap.
  const sigma = 0.0235;
  for (const n of [4, 12, 50]) {
    let lo = 1e-6, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tPowerQuad({ n, delta: mid, sigma }) < 0.8) lo = mid; else hi = mid;
    }
    const exactQuad = (lo + hi) / 2;
    const got = mdeTExact({ sigma, n, draws: 20000, seed: 7 }).mde;
    assert.ok(Math.abs(got / exactQuad - 1) < 0.02,
      `n=${n}: mdeTExact ${(got * 100).toFixed(3)}% vs quadrature ${(exactQuad * 100).toFixed(3)}%`);
  }
});

test("ANCHOR: the normal MDE's attained power at n=4 is ~0.48 by quadrature too", () => {
  // The single most quoted figure in section 5f, re-derived without simulation.
  const sigma = 0.0235;
  const q = tPowerQuad({ n: 4, delta: mdeNormal(sigma, 4), sigma });
  assert.ok(q > 0.46 && q < 0.50, `expected ~0.48, quadrature gives ${q.toFixed(4)}`);
  const q50 = tPowerQuad({ n: 50, delta: mdeNormal(sigma, 50), sigma });
  assert.ok(q50 > 0.77 && q50 < 0.79, `expected ~0.78 at n=50, quadrature gives ${q50.toFixed(4)}`);
});
