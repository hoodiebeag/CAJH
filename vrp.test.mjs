import assert from "node:assert/strict";
import test from "node:test";
import {
  GATE, PREREGISTRATION, TRADING_DAYS,
  realizedVol, realizedVariance, vrpObservations, assertIvUnits, scoreUnderlying, evaluate,
} from "./vrp.mjs";
import { seededRng } from "./inference.mjs";

/**
 * Synthetic market with a KNOWN premium. Prices are a random walk at annualised vol `sigma`;
 * IV is quoted at `sigma + premium`. The estimator must recover `premium` and must not invent
 * one when it is zero -- the two failure modes that would make every later number meaningless.
 */
function synthetic({ n = 520, sigma = 0.18, premium = 0.02, seed = 7, ivNoise = 0.01 }) {
  const rnd = seededRng(seed);
  const gauss = () => {
    const u = Math.max(rnd(), 1e-12), v = Math.max(rnd(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const dailySigma = sigma / Math.sqrt(TRADING_DAYS);
  const prices = [100], ivs = [];
  for (let i = 0; i < n; i++) {
    ivs.push(sigma + premium + gauss() * ivNoise);
    prices.push(prices[prices.length - 1] * Math.exp(gauss() * dailySigma));
  }
  return { ivs, prices: prices.slice(0, n) };
}

// ---------- realised volatility ----------

test("realizedVariance is unbiased at the short window where realizedVol is not", () => {
  // The bias that nearly manufactured a premium: at h=5 the sample SD reads ~0.95x sigma.
  // Averaged over many windows, variance recovers sigma^2 and volatility does not recover sigma.
  const { prices } = synthetic({ n: 5000, sigma: 0.20, premium: 0, ivNoise: 0, seed: 3 });
  const vars = [], vols = [];
  for (let i = 0; i + 5 < prices.length; i += 5) {
    vars.push(realizedVariance(prices, i, 5)); vols.push(realizedVol(prices, i, 5));
  }
  const mv = vars.reduce((a, b) => a + b, 0) / vars.length;
  const mvol = vols.reduce((a, b) => a + b, 0) / vols.length;
  assert.ok(Math.abs(Math.sqrt(mv) - 0.20) < 0.01, `variance route should recover 0.20, got ${Math.sqrt(mv).toFixed(4)}`);
  assert.ok(mvol < 0.196, `mean of per-window vol should sit visibly BELOW 0.20, got ${mvol.toFixed(4)}`);
});

test("realizedVol refuses a window that runs past the data or contains a bad price", () => {
  for (const f of [realizedVol, realizedVariance]) {
    assert.equal(f([1, 2, 3], 0, 99), null);
    assert.equal(f([1, 0, 3, 4], 0, 3), null);
    assert.equal(f([1, 2], 0, 1), null, "one return is not a variance");
  }
});

// ---------- non-overlapping windows ----------

test("windows are non-overlapping — the whole point of the sample design", () => {
  const { ivs, prices } = synthetic({ n: 100 });
  const obs = vrpObservations(ivs, prices, 5);
  assert.equal(obs.length, Math.floor((100 - 1) / 5), "should step by h, not by 1");
  assert.ok(obs.length < 25, "overlapping windows would give ~95 here");
  assert.deepEqual(obs.map((o) => o.windowIndex), obs.map((_, i) => i));
});

test("misaligned series are rejected rather than silently zipped", () => {
  assert.throws(() => vrpObservations([1, 2, 3], [1, 2], 2), /align 1:1/);
});

// ---------- unit guard ----------

test("IV quoted in percent rather than decimals aborts instead of scoring", () => {
  const { ivs, prices } = synthetic({ n: 200 });
  const asPercent = ivs.map((v) => v * 100);
  assert.equal(assertIvUnits(asPercent).ok, false);
  const r = scoreUnderlying("SPY", asPercent, prices);
  assert.equal(r.aborted, true);
  assert.match(r.reason, /unit mismatch/);
});

test("plausible decimal IV passes the unit guard", () => {
  const { ivs } = synthetic({ n: 200 });
  assert.equal(assertIvUnits(ivs).ok, true);
});

// ---------- the estimator recovers what is there, and only what is there ----------

test("a known 2-vol-point premium is recovered to within a fraction of a point", () => {
  const { ivs, prices } = synthetic({ n: 2600, sigma: 0.18, premium: 0.02, seed: 11 });
  const r = scoreUnderlying("SPY", ivs, prices, { h: 5 });
  assert.ok(Math.abs(r.meanVrpVolPoints - 0.02) < 0.005,
    `expected ~0.0200 vol pts, got ${r.meanVrpVolPoints.toFixed(4)}`);
  assert.equal(r.excludesZero, true, "a real 2-point premium on this much data should exclude zero");
});

test("NO premium produces no premium — the false-positive check that matters most", () => {
  // If this ever starts passing, every positive result the study reports is worthless.
  let falsePositives = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { ivs, prices } = synthetic({ n: 2600, sigma: 0.18, premium: 0, seed });
    const r = scoreUnderlying("SPY", ivs, prices, { h: 5 });
    if (r.excludesZero) falsePositives++;
  }
  assert.ok(falsePositives <= 1, `${falsePositives}/12 zero-premium series falsely excluded zero`);
});

test("a NEGATIVE premium is reported as negative, not clipped toward zero", () => {
  const { ivs, prices } = synthetic({ n: 2600, sigma: 0.18, premium: -0.02, seed: 5 });
  const r = scoreUnderlying("SPY", ivs, prices, { h: 5 });
  assert.ok(r.meanVrpVolPoints < -0.01, `expected ~-0.02, got ${r.meanVrpVolPoints.toFixed(4)}`);
  assert.equal(r.excludesZero, false);
});

// ---------- the gate ----------

test("both underlyings must clear; one strong leg cannot carry a dead one", () => {
  const g = synthetic({ n: 2600, premium: 0.02, seed: 11 });
  const good = scoreUnderlying("SPY", g.ivs, g.prices);
  const d = synthetic({ n: 2600, premium: 0, seed: 4 });
  const dead = scoreUnderlying("QQQ", d.ivs, d.prices);
  assert.equal(evaluate([good, dead]).verdict, "FAIL");
  assert.equal(evaluate([good, good]).verdict, "PASS");
});

test("an aborted leg BLOCKS rather than fails — absent evidence is not negative evidence", () => {
  const g2 = synthetic({ n: 2600, premium: 0.02, seed: 11 });
  const good = scoreUnderlying("SPY", g2.ivs, g2.prices);
  const aborted = { symbol: "QQQ", aborted: true, reason: "no usable windows" };
  const res = evaluate([good, aborted]);
  assert.equal(res.verdict, "BLOCKED");
  assert.match(res.reasons.join(" "), /aborted/);
});

test("too few windows fails even with a positive premium", () => {
  const { ivs, prices } = synthetic({ n: 120, premium: 0.03, seed: 2 });
  const r = scoreUnderlying("SPY", ivs, prices, { h: 5 });
  assert.ok(r.windows < GATE.minWindows);
  assert.equal(evaluate([r, r]).verdict, "FAIL");
});

test("the pre-registration states the gate and refuses to overclaim", () => {
  assert.match(PREREGISTRATION.gate, /PASS iff/);
  assert.match(PREREGISTRATION.gate, /BOTH SPY and QQQ scored separately/);
  assert.match(PREREGISTRATION.gate, /no return is claimed/);
  assert.match(PREREGISTRATION.hypothesis, /NOT about tradeable return/);
  assert.equal(GATE.horizonDays, 5);
  assert.equal(evaluate([]).meaning.includes("not a return"), true);
});

// ---------- calibration at the real sample size ----------

function measureMany(premium, seeds, n = 520) {
  const out = [];
  for (let s = 1; s <= seeds; s++) {
    const { ivs, prices } = synthetic({ n, sigma: 0.18, premium, seed: s });
    out.push(scoreUnderlying("X", ivs, prices, { h: 5 }));
  }
  return out;
}

test("at 520 bars the estimator has usable power for a 2-point premium", () => {
  const rs = measureMany(0.02, 40);
  const detected = rs.filter((r) => r.excludesZero).length;
  assert.ok(detected >= 32, `expected >=80% power, detected ${detected}/40`);
});

test("at 520 bars the false-positive rate stays at or under nominal", () => {
  // The check that decides whether any real reading can be believed.
  const rs = measureMany(0, 40);
  const falsePos = rs.filter((r) => r.excludesZero).length;
  assert.ok(falsePos <= 4, `${falsePos}/40 zero-premium runs falsely excluded zero (nominal 5% = 2)`);
});

test("residual bias on a zero-premium series stays well under the effect being hunted", () => {
  const rs = measureMany(0, 40);
  const mean = rs.reduce((a, r) => a + r.meanVrpVolPoints, 0) / rs.length;
  assert.ok(Math.abs(mean) < 0.003,
    `residual bias ${(mean * 100).toFixed(2)} vol pts should be far below the 1.08 the variance fix removed`);
});
