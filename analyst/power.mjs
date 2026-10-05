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

const zSum = ({ zAlpha = Z_ALPHA_TWO_SIDED_95, zPower = Z_POWER_80 } = {}) => zAlpha + zPower;

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

/** Independent periods needed to resolve a per-period effect of `delta`. Inverse of `mde`. */
export function periodsFor(sigma, delta, opts = {}) {
  positive(sigma, "sigma");
  positive(delta, "delta");
  return Math.ceil((zSum(opts) ** 2 * sigma ** 2) / delta ** 2);
}

/** A per-period figure expressed per year, at `holdDays` per period. */
export function annualise(perPeriod, holdDays, tradingDays = TRADING_DAYS_PER_YEAR) {
  positive(holdDays, "holdDays");
  return perPeriod * (tradingDays / holdDays);
}

/**
 * Round-trip cost paid per year at a given hold: one round trip per period, `1/holdDays` of a year's
 * sessions per period. Linear in `1/holdDays`, which is the whole reason a shorter hold is expensive.
 */
export function costDragPerYear(perLegCost, holdDays, tradingDays = TRADING_DAYS_PER_YEAR) {
  positive(holdDays, "holdDays");
  return 2 * perLegCost * (tradingDays / holdDays);
}

/**
 * THE CLOSED FORM BEHIND "SHORTENING THE HOLD DOES NOT HELP".
 *
 * `paper-power.mjs` measured this and concluded the lever is closed. It is also derivable exactly,
 * and the derivation is worth having because a measured flat line invites the reader to wonder
 * whether a different hold might have been luckier.
 *
 * If per-period noise scales with the square root of the hold — sigma_h = sigma_1 * sqrt(h), the
 * random-walk scaling — then in a fixed window of W trading days:
 *
 *     n = W / h                                      periods in the window
 *     MDE_per_period = z * sigma_1 * sqrt(h) / sqrt(W/h) = z * sigma_1 * h / sqrt(W)
 *     MDE_annualised = MDE_per_period * (252 / h)    = 252 * z * sigma_1 / sqrt(W)
 *
 * The hold cancels **exactly**. Annualised detectable edge depends only on one-day noise and the
 * length of the window, never on how the window is sliced. Cost, meanwhile, scales as 1/h and does
 * not cancel — so the only thing a shorter hold reliably changes is how much you pay.
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
