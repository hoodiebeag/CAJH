/**
 * power.mjs — can this study detect the effect it is looking for, before it is run?
 *
 * WHY. This project has run studies that could not have produced a positive result whatever the
 * market did, and then read the null as evidence. `REQUIRED-SAMPLE-FOR-DURABLE-PASS` did this
 * arithmetic by hand once; it should have been done before every study and was not. Two examples
 * from 2026-09-03 alone: the variance-risk-premium horizon was chosen from this calculation
 * (h=5 detects 1.1-1.7 vol points, h=21 needs 2.4-3.6 and the effect is 1-3), and the FX carry
 * study was abandoned by it — detecting a documented 2-5%/yr premium needs 24 to 147 years of
 * monthly data and 5 are available.
 *
 * A study that cannot detect its own effect produces a null that means nothing. Running one is
 * worse than not running it, because the null goes on the record and gets cited.
 *
 * The formulae are the ordinary normal approximations for a one-sample mean. They are rough by
 * design: the decision they inform — is this worth running at all — does not need three digits,
 * and pretending otherwise would be its own kind of false precision.
 */

/** z for a two-sided test at `alpha` plus one-sided power `beta`. 1.96 + 0.84 at 0.05/80%. */
const Z_ALPHA_2 = { 0.10: 1.645, 0.05: 1.960, 0.01: 2.576 };
const Z_POWER = { 0.80: 0.842, 0.90: 1.282, 0.95: 1.645 };

export function zFor(alpha = 0.05, power = 0.80) {
  const za = Z_ALPHA_2[alpha], zb = Z_POWER[power];
  if (za === undefined) throw new Error(`power.mjs: alpha must be one of ${Object.keys(Z_ALPHA_2).join(", ")}`);
  if (zb === undefined) throw new Error(`power.mjs: power must be one of ${Object.keys(Z_POWER).join(", ")}`);
  return za + zb;
}

/** Smallest effect this sample could detect. `sd` and the result share units. */
export function minimumDetectableEffect({ n, sd, alpha = 0.05, power = 0.80 }) {
  if (!Number.isInteger(n) || n < 2) throw new Error("power.mjs: n must be an integer >= 2");
  if (!(sd > 0)) throw new Error("power.mjs: sd must be positive");
  return zFor(alpha, power) * sd / Math.sqrt(n);
}

/** Observations needed to detect `effect`. */
export function requiredN({ effect, sd, alpha = 0.05, power = 0.80 }) {
  if (!(Math.abs(effect) > 0)) throw new Error("power.mjs: effect must be non-zero");
  if (!(sd > 0)) throw new Error("power.mjs: sd must be positive");
  return Math.ceil((zFor(alpha, power) * sd / Math.abs(effect)) ** 2);
}

/**
 * The whole point: is this study worth running?
 *
 * `effectiveN` must be the INDEPENDENT observation count, not the nominal one. Overlapping
 * windows, same-day trades across symbols and correlated instruments all inflate the nominal
 * count — the error that removed ma_dip's zero-exclusion when 300 trades turned out to be 104
 * independent days.
 */
export function assess({ effectiveN, sd, expectedEffect, alpha = 0.05, power = 0.80, units = "" }) {
  const mde = minimumDetectableEffect({ n: effectiveN, sd, alpha, power });
  const need = requiredN({ effect: expectedEffect, sd, alpha, power });
  const ratio = Math.abs(expectedEffect) / mde;
  const u = units ? ` ${units}` : "";
  return {
    effectiveN, sd, expectedEffect, alpha, power,
    minimumDetectableEffect: mde,
    requiredN: need,
    shortfallFactor: need / effectiveN,
    powered: ratio >= 1,
    verdict: ratio >= 1 ? "POWERED" : "UNDERPOWERED",
    summary: ratio >= 1
      ? `Powered: can detect ${mde.toFixed(4)}${u}, expecting ${expectedEffect}${u}. ${effectiveN} of ${need} needed.`
      : `UNDERPOWERED: needs ${need} independent observations, has ${effectiveN} ` +
        `(${(need / effectiveN).toFixed(1)}x short). Smallest detectable effect is ${mde.toFixed(4)}${u}, ` +
        `but the effect sought is ${expectedEffect}${u}. A null from this study would mean nothing.`,
  };
}
