/**
 * How many independent periods does a claim need before its number means anything?
 *
 * WHY THIS IS A MODULE AND NOT A SCRIPT. `docs/FORWARD-EVAL-SPEC.md` §4 requires every registered
 * candidate version to carry **minimum periods AND the MDE at that count** — "because a test whose
 * MDE exceeds its hypothesis cannot answer it". Until now that arithmetic lived only as two local
 * arrow functions inside `paper-power.mjs`, a top-level script with no exports and no tests. So the
 * one field the ledger uses to decide whether a test can answer its own question had to be
 * hand-typed from a console readout. That is precisely the silent drift §4 was written against:
 * `registry.mjs` already lost its code while its ledger survived, and `paper-power.mjs` had 149
 * lines of load-bearing statistics with zero test coverage.
 *
 * Nothing here is a passing criterion, a risk limit or a STOP rule. It is arithmetic. It decides
 * nothing; it tells a registrant what their chosen period count can and cannot resolve.
 *
 * THE UNIT IS THE NON-OVERLAPPING HOLDING PERIOD, NOT THE TRADE. Twenty trading days of daily
 * decisions on a five-day hold looks like a hundred trades and is four observations. Every function
 * here takes `n` in periods, and callers that pass a trade count will get an answer that overstates
 * the evidence by roughly an order of magnitude, in the flattering direction.
 */

/** Two-sided 95%, 80% power. The conventional pair, named rather than inlined as 1.96 and 0.84. */
export const Z_ALPHA_TWO_SIDED_95 = 1.959963984540054;
export const Z_POWER_80 = 0.8416212335729143;
export const TRADING_DAYS_PER_YEAR = 252;

/**
 * The critical-value sum. Both overrides are validated: a caller passing a p-value (0.05) or a string
 * where a z-score belongs would otherwise get a plausible-looking MDE that is wrong by ~50x, and a
 * registered `mdeAtMinimum` computed that way would look entirely ordinary.
 */
const zSum = ({ zAlpha = Z_ALPHA_TWO_SIDED_95, zPower = Z_POWER_80 } = {}) => {
  positive(zAlpha, "zAlpha");
  positive(zPower, "zPower");
  return zAlpha + zPower;
};

const finite = (v, label) => {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`power: ${label} must be a finite number, got ${v}`);
  }
  return v;
};

const nonNegative = (v, label) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`power: ${label} must be a finite non-negative number, got ${v}`);
  }
  return v;
};

const positive = (v, label) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new Error(`power: ${label} must be a finite positive number, got ${v}`);
  }
  return v;
};

/**
 * The smallest per-period effect that `n` independent periods can resolve.
 *
 * `sigma` is the standard deviation of the PAIRED difference (analyst minus its matched control at
 * the same instant), not of either book's return. Using a single book's sd here would overstate the
 * noise, because the paired difference cancels the common market move that both books share.
 */
export function mde(sigma, n, opts = {}) {
  positive(sigma, "sigma");
  positive(n, "n");
  return zSum(opts) * sigma / Math.sqrt(n);
}

/**
 * A PLANNING ESTIMATE, NOT A GUARANTEED POWER RESULT. `mde` and `periodsFor` use the normal
 * approximation: they assume the per-period difference is roughly normal with known sigma, and that
 * the n periods are independent. At the period counts this project actually faces — 4 in a month, 50
 * in a year — that approximation is doing real work:
 *
 *   - sigma is ESTIMATED, not known. A t-based interval would be wider, and more so at small n.
 *   - Real per-period differences are fat-tailed, which costs power the normal formula does not charge.
 *   - Periods are only independent if they do not overlap AND share no common shock. Non-overlap is
 *     enforced by construction here; a common market regime across adjacent periods is not.
 *
 * So treat these numbers as "roughly how long before this is worth looking at", not as "80% power is
 * guaranteed at this n". They are the right tool for deciding a minimum period count in advance and
 * the wrong tool for claiming a completed run achieved a particular power.
 */
export const MDE_IS_A_PLANNING_ESTIMATE = true;

/** Independent periods needed to resolve a per-period effect of `delta`. Inverse of `mde`. */
export function periodsFor(sigma, delta, opts = {}) {
  positive(sigma, "sigma");
  positive(delta, "delta");
  return Math.ceil((zSum(opts) ** 2 * sigma ** 2) / delta ** 2);
}

/** A per-period figure expressed per year, at `holdDays` per period. */
export function annualise(perPeriod, holdDays, tradingDays = TRADING_DAYS_PER_YEAR) {
  finite(perPeriod, "perPeriod");          // may legitimately be negative or zero; must be a number
  positive(holdDays, "holdDays");
  positive(tradingDays, "tradingDays");
  return perPeriod * (tradingDays / holdDays);
}

/**
 * Round-trip cost paid per year at a given hold: one round trip per period, `1/holdDays` of a year's
 * sessions per period. Linear in `1/holdDays`, which is the whole reason a shorter hold is expensive.
 */
export function costDragPerYear(perLegCost, holdDays, tradingDays = TRADING_DAYS_PER_YEAR) {
  nonNegative(perLegCost, "perLegCost");   // zero is a legitimate frictionless baseline
  positive(holdDays, "holdDays");
  positive(tradingDays, "tradingDays");
  return 2 * perLegCost * (tradingDays / holdDays);
}

/**
 * THE PLANNING FORMULA'S BEHAVIOUR ACROSS HOLDS, UNDER AN EXPLICIT ASSUMPTION.
 *
 * WHAT THIS IS AND IS NOT. This is an algebraic property of the normal-approximation planning
 * formula under one stated assumption. It is NOT a proof that every empirical hold is powerless, and
 * NOT a proof that no hold could be luckier on real data. An earlier version of this comment and of
 * docs/POWER-VALIDATION.md claimed the stronger thing; that was an overclaim.
 *
 * Three conditions, all of which can fail:
 *   1. It assumes sigma_h = sigma_1 * sqrt(h) exactly. Real returns are not an exact random walk, so
 *      the measured column is flat only to the extent that assumption holds — which is an empirical
 *      question, answered by measurement, with its own Monte Carlo and sample uncertainty.
 *   2. It treats W/h as a continuous quantity. A hold that does not divide the window leaves a
 *      fractional period that cannot be realised; at h > W there is less than one period and the
 *      formula returns a number for a test that cannot be run at all.
 *   3. It inherits every limitation of the normal approximation itself (see `mde`).
 *
 * If per-period noise does scale with the square root of the hold, then in a window of W trading days:
 *
 *     n = W / h                                      periods in the window
 *     MDE_per_period = z * sigma_1 * sqrt(h) / sqrt(W/h) = z * sigma_1 * h / sqrt(W)
 *     MDE_annualised = MDE_per_period * (252 / h)    = 252 * z * sigma_1 / sqrt(W)
 *
 * The hold cancels **algebraically, under condition 1**. So to the extent returns scale like a random
 * walk, annualised detectable edge depends on one-day noise and window length rather than on how the
 * window is sliced. Cost, by contrast, scales as 1/h unconditionally and does not cancel — that part
 * is arithmetic, not an assumption.
 *
 * Returns the annualised MDE under exact sqrt scaling. Any deviation between this and the measured
 * value is the extent to which real returns are NOT a random walk at that horizon (autocorrelation,
 * overlapping information, a weekday-phase artifact in how periods were sampled) — which makes the
 * residual the interesting quantity rather than the headline.
 */
export function annualisedMdeUnderSqrtScaling(sigmaOneDay, windowTradingDays,
                                              tradingDays = TRADING_DAYS_PER_YEAR, opts = {}) {
  positive(sigmaOneDay, "sigmaOneDay");
  positive(windowTradingDays, "windowTradingDays");
  return tradingDays * zSum(opts) * sigmaOneDay / Math.sqrt(windowTradingDays);
}

/**
 * Non-overlapping period start indices for a given hold.
 *
 * Pure, and extracted here because getting it wrong is silent. `paper-power.mjs` built this grid once
 * at a 5-day hold and then reused it while comparing other holds, which meant a 1-day hold was
 * estimated from every fifth session — a fixed day-of-week subsample — and a 21-day hold ran past the
 * end of the panel on its last few starts and was clamped to a short window, understating long-hold
 * noise. Neither shows up as an error; both show up as a plausible number.
 *
 * Two invariants, both asserted in the tests: consecutive starts are exactly `hold` apart, so periods
 * never overlap, and `start + hold <= length`, so no period is truncated by the end of the panel.
 */
export function nonOverlappingStarts(firstIndex, hold, length) {
  // An INTEGER step, unlike the continuous `holdDays` the annualisers take: this one indexes an array,
  // and a fractional step would silently produce non-integer indices that read as undefined bars.
  if (!Number.isInteger(hold) || hold < 1) {
    throw new Error(`power: hold must be a positive integer number of sessions, got ${hold}`);
  }
  if (!Number.isInteger(firstIndex) || firstIndex < 0) {
    throw new Error(`power: firstIndex must be a non-negative integer, got ${firstIndex}`);
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`power: length must be a non-negative integer, got ${length}`);
  }
  const out = [];
  for (let i = firstIndex; i + hold <= length; i += hold) out.push(i);
  return out;
}

/**
 * Can a stated hypothesis be answered at a stated period count?
 *
 * The §4 question, as a function. `hypothesisAnnualised` is what the candidate claims; `sigma` is
 * measured per-period paired noise. Returns the comparison and never a verdict about the strategy:
 * `answerable: false` means the TEST is too weak, not that the hypothesis is false.
 */
export function canAnswer({ sigma, periods, holdDays, hypothesisAnnualised,
                            tradingDays = TRADING_DAYS_PER_YEAR }, opts = {}) {
  positive(tradingDays, "tradingDays");
  const perPeriod = mde(sigma, periods, opts);
  const mdeAnnualised = annualise(perPeriod, holdDays, tradingDays);
  positive(hypothesisAnnualised, "hypothesisAnnualised");
  return {
    mdePerPeriod: perPeriod,
    mdeAnnualised,
    hypothesisAnnualised,
    answerable: hypothesisAnnualised >= mdeAnnualised,
    periodsNeeded: periodsFor(sigma, hypothesisAnnualised * holdDays / tradingDays, opts),
  };
}
