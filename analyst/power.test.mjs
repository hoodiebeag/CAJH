/**
 * Tests for the power arithmetic.
 *
 * `paper-power.mjs` carried 149 lines of load-bearing statistics with no test file, and its output is
 * the basis for the single most consequential claim in this project's forward design — that no
 * practical paper period will prove edge. These tests check the arithmetic against closed forms and
 * against the numbers `docs/PAPER-PROTOCOL.md` pre-registered, so the claim rests on something
 * reproducible rather than on a console readout nobody can re-derive.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mde, periodsFor, annualise, costDragPerYear, annualisedMdeUnderSqrtScaling, canAnswer,
  nonOverlappingStarts,
  Z_ALPHA_TWO_SIDED_95, Z_POWER_80, TRADING_DAYS_PER_YEAR,
} from "./power.mjs";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} !~= ${b}`);

test("mde falls as 1/sqrt(n), so quadrupling the periods halves the detectable edge", () => {
  const sigma = 0.0242;
  close(mde(sigma, 16) / mde(sigma, 4), 0.5);
  close(mde(sigma, 100) / mde(sigma, 4), 0.2);
  // Explicitly: this is why a month cannot be rescued by running it twice.
  assert.ok(mde(sigma, 8) > mde(sigma, 4) / 2,
    "doubling periods should NOT halve the MDE — that would be 1/n scaling");
});

test("periodsFor inverts mde", () => {
  const sigma = 0.0242;
  for (const n of [4, 12, 26, 50, 137]) {
    // periodsFor ceils, so round-tripping lands on n or just above it, never below.
    const back = periodsFor(sigma, mde(sigma, n));
    assert.ok(back === n || back === n + 1, `n=${n} round-tripped to ${back}`);
  }
  // And a delta twice as large needs a quarter of the periods.
  // Both are ceiled (45.9 -> 46, 11.5 -> 12), so the ratio is ~3.83 rather than exactly 4. The
  // inverse-square law is in the un-ceiled values; the tolerance has to admit the rounding.
  const a = periodsFor(sigma, 0.01), b = periodsFor(sigma, 0.02);
  assert.ok(Math.abs(a / b - 4) < 0.25, `${a}/${b} should be ~4`);
});

test("the z constants are the conventional two-sided 95% / 80% power pair", () => {
  // Named rather than inlined, because 1.96 + 0.84 appearing as a literal is how a power calculation
  // silently becomes a different test than the one documented.
  close(Z_ALPHA_TWO_SIDED_95, 1.96, 5e-5);
  close(Z_POWER_80, 0.84, 2e-3);
  // A one-sided test at the same alpha is cheaper; asserted so an accidental swap is visible.
  assert.ok(mde(0.02, 10, { zAlpha: 1.6449 }) < mde(0.02, 10),
    "a one-sided critical value must give a smaller MDE");
});

test("REPRODUCES the pre-registered PAPER-PROTOCOL table from its measured sigma", () => {
  // docs/PAPER-PROTOCOL.md registered, for a book of 10 on a 5-day hold:
  //   4 periods -> 3.4%/period ~170% annualised; 12 -> 2.0%/~98%; 26 -> 1.3%/~67%; 50 -> 1.0%/~48%
  //
  // `node paper-power.mjs 20000` on the committed sp500-bundle measures sd = 2.45% (seed 20260924,
  // 127 names, 920 dates, 134 non-overlapping 5-day periods). These are the values that sigma
  // implies. This test is what makes the registered table auditable: if the arithmetic drifts, the
  // pre-registration and the code stop agreeing loudly instead of quietly.
  const sigma = 0.0245;
  const HOLD = 5;
  const registered = [[4, 0.034, 1.70], [12, 0.020, 0.98], [26, 0.013, 0.67], [50, 0.010, 0.48]];

  for (const [n, perPeriod] of registered) {
    // Per-period is the primary figure and it matches to well under a tenth of a point.
    close(mde(sigma, n), perPeriod, 6e-4);
  }

  // TWO ANNUALISATION CONVENTIONS, AND THE DIFFERENCE IS RECORDED RATHER THAN SPLIT.
  // The protocol multiplied by 50; the correct factor for a 5-day hold is 252/5 = 50.4, which is
  // what `annualise` uses and what the script now prints. The gap is 0.8% of the figure -- about
  // 1.4 points at the 170% row -- so the registered numbers are very slightly conservative. Both are
  // asserted so nobody later reads the 1.4-point difference as a regression.
  for (const [n, , annualAtFifty] of registered) {
    close(mde(sigma, n) * 50, annualAtFifty, 1.6e-2);
    close(annualise(mde(sigma, n), HOLD), annualAtFifty * 1.008, 1.7e-2);
  }
  assert.ok(annualise(mde(sigma, 4), HOLD) > mde(sigma, 4) * 50,
    "252/5 annualisation must exceed the protocol's rounder x50");
});

test("cost drag is linear in 1/hold, matching the registered 1.3%/yr to 27.7%/yr span", () => {
  // COST_MODELS.usEquityIbkr: feeRate + slipPct per leg. The protocol registered the endpoints of
  // this span, so they are asserted rather than trusted.
  const LEG = 0.00055;   // the per-leg figure that produces the registered endpoints
  close(costDragPerYear(LEG, 1), 0.2772, 1e-3);
  close(costDragPerYear(LEG, 21), 0.0132, 1e-3);
  // Halving the hold exactly doubles the drag. No measurement needed; it is arithmetic.
  for (const h of [1, 2, 5, 10]) close(costDragPerYear(LEG, h) / costDragPerYear(LEG, 2 * h), 2);
});

test("THE LEVER IS CLOSED, exactly: annualised MDE is independent of hold under sqrt scaling", () => {
  // The protocol measured a roughly flat annualised column across holds and concluded the lever is
  // closed. It is also an identity. If sigma_h = sigma_1 * sqrt(h) then in a window of W trading days
  // the hold cancels completely:
  //     MDE_ann = z * sigma_1 * sqrt(h) / sqrt(W/h) * (252/h) = 252 * z * sigma_1 / sqrt(W)
  // Asserted here across two orders of magnitude of hold, to 1e-9. A measured flat line invites the
  // reader to wonder whether some other hold might have been luckier; this says none can be.
  const sigmaOneDay = 0.0108, W = 20;
  const reference = annualisedMdeUnderSqrtScaling(sigmaOneDay, W);
  for (const h of [1, 2, 4, 5, 10, 20, 50, 100]) {
    const sigmaH = sigmaOneDay * Math.sqrt(h);
    const periods = W / h;
    close(annualise(mde(sigmaH, periods), h), reference);
  }
  // Longer windows DO help, as 1/sqrt(W) — the one lever that is not closed.
  close(annualisedMdeUnderSqrtScaling(sigmaOneDay, 80) / reference, 0.5);
});

test("the measured hold column tracks the sqrt identity closely", () => {
  // Measured per-period paired sd, book of 10, from `node paper-power.mjs 20000` AFTER the grid fix
  // (seed 20260924, sp500-bundle). An earlier version of this test quoted figures from a throwaway
  // probe with different rng consumption and labelled them as the script's output; these are the
  // script's.
  const measured = { 1: 0.0108, 2: 0.0157, 5: 0.0241, 10: 0.0362, 21: 0.0493 };
  const predicted = (h) => measured[1] * Math.sqrt(h);

  // Real returns need not be an exact random walk, so this is a band rather than an equality. What the
  // numbers actually show is that they are very close to one: every ratio is within 6%.
  for (const h of [2, 5, 10, 21]) {
    const ratio = measured[h] / predicted(h);
    assert.ok(ratio > 0.94 && ratio < 1.06,
      `hold ${h}: measured/predicted = ${ratio.toFixed(3)}, outside the stated 6% band`);
  }

  // DELIBERATELY NOT ASSERTED: a direction. At 21 days the ratio is 0.996 -- four parts in a thousand
  // below sqrt scaling -- and an earlier version of this test read that as mean reversion. It is not.
  // A deviation that small is indistinguishable from Monte Carlo error at 20,000 draws, and treating it
  // as a signal would be exactly the kind of noise-mining this project closed 76 verdicts on.
  const longEnd = measured[21] / predicted(21);
  assert.ok(Math.abs(longEnd - 1) < 0.06, `21d scaling ratio ${longEnd.toFixed(4)}`);
});

test("canAnswer reports whether the TEST is adequate, never whether the claim is true", () => {
  const sigma = 0.0242, HOLD = 5;
  // A month (4 periods) against a 30% annualised hypothesis: hopeless, and it must say so.
  const month = canAnswer({ sigma, periods: 4, holdDays: HOLD, hypothesisAnnualised: 0.30 });
  assert.equal(month.answerable, false);
  assert.ok(month.mdeAnnualised > 1.5, "a month should not resolve anything under ~150% annualised");
  // 130 periods at a 5-day hold is ~650 trading days, about 2.6 years, to resolve 30% annualised
  // against THIS noise level. Asserted as a number rather than a hand-wave, because the figure is
  // the whole reason the protocol says no practical paper period will prove edge.
  assert.equal(month.periodsNeeded, 130);
  assert.ok(month.periodsNeeded * HOLD / TRADING_DAYS_PER_YEAR > 2.5,
    "resolving 30% annualised should take more than two and a half years");

  // A hypothesis larger than the MDE is answerable — which says the instrument is adequate, nothing more.
  const huge = canAnswer({ sigma, periods: 4, holdDays: HOLD, hypothesisAnnualised: 5.0 });
  assert.equal(huge.answerable, true);

  // Consistency: periodsNeeded is exactly the count at which the hypothesis equals the MDE.
  const n = month.periodsNeeded;
  assert.ok(annualise(mde(sigma, n), HOLD) <= 0.30 + 1e-9,
    "at periodsNeeded the MDE should have reached the hypothesis");
});

test("every entry point rejects the inputs that would silently produce a wrong answer", () => {
  // A zero or negative sigma yields Infinity or a negative MDE rather than an error, and an n of 0
  // divides by zero. Both would propagate into a registered mdeAtMinimum as a plausible-looking number.
  for (const bad of [0, -1, NaN, Infinity, "0.02", null, undefined]) {
    assert.throws(() => mde(bad, 10), /sigma must be a finite positive number/);
    assert.throws(() => periodsFor(0.02, bad), /delta must be a finite positive number/);
    assert.throws(() => annualise(0.01, bad), /holdDays must be a finite positive number/);
    assert.throws(() => costDragPerYear(0.0005, bad), /holdDays/);
  }
  for (const bad of [0, -5, NaN, "4"]) assert.throws(() => mde(0.02, bad), /n must be/);
  assert.throws(() => canAnswer({ sigma: 0.02, periods: 4, holdDays: 5, hypothesisAnnualised: 0 }),
    /hypothesisAnnualised/);
});

test("TRADING_DAYS_PER_YEAR is used consistently and is overridable", () => {
  assert.equal(TRADING_DAYS_PER_YEAR, 252);
  // The protocol annualises a 5-day hold by 50, which is 252/5 rounded. Asserted so the slight
  // difference between 50 and 50.4 is a recorded choice rather than a discrepancy someone rediscovers.
  close(annualise(0.01, 5), 0.504);     // 0.01 * 252/5 = 50.4% per year
  close(annualise(0.01, 5, 250), 0.50);  // the protocol's rounder "x 50"
});

// ---- the period grid: the defect this module was extracted to put under test -------------------

test("nonOverlappingStarts never overlaps and never runs past the panel", () => {
  // The two invariants. A violation of the first silently correlates draws that are reported as
  // independent; a violation of the second silently shortens the holding window and understates noise.
  for (const hold of [1, 2, 5, 10, 21, 63]) {
    const starts = nonOverlappingStarts(250, hold, 920);
    for (let i = 1; i < starts.length; i++) {
      assert.equal(starts[i] - starts[i - 1], hold, `hold ${hold}: starts overlap or leave a gap`);
    }
    for (const st of starts) {
      assert.ok(st + hold <= 920, `hold ${hold}: start ${st} runs ${st + hold - 920} past the panel`);
    }
  }
});

test("the grid includes the last fully-available period and excludes the first truncated one", () => {
  // Off-by-one, both directions. bookReturn reads indices i .. i+hold-1, so i+hold == length is the
  // last VALID start. The original script used `i + hold < length`, which dropped it: at a 5-day hold
  // on 920 dates that is one lost period out of 134, and the lost one is always the most recent.
  assert.deepEqual(nonOverlappingStarts(0, 5, 10), [0, 5]);
  assert.deepEqual(nonOverlappingStarts(0, 5, 11), [0, 5]);
  assert.deepEqual(nonOverlappingStarts(0, 5, 9), [0]);
  assert.deepEqual(nonOverlappingStarts(0, 3, 9), [0, 3, 6]);
  // The 920-date panel at a 5-day hold: 134 periods from index 250, last start 915, 915+5 = 920.
  const real = nonOverlappingStarts(250, 5, 920);
  assert.equal(real.length, 134);
  assert.equal(real.at(-1), 915);
  assert.equal(real.at(-1) + 5, 920);
});

test("a hold longer than the panel yields no periods rather than a truncated one", () => {
  // Returning a single clamped period here is how long-hold noise got understated. Empty is correct:
  // the panel cannot measure that hold at all, and the caller must see zero, not one bad observation.
  assert.deepEqual(nonOverlappingStarts(250, 1000, 920), []);
  assert.deepEqual(nonOverlappingStarts(915, 10, 920), []);
  assert.deepEqual(nonOverlappingStarts(0, 1, 0), []);
});

test("shorter holds sample the whole panel, not a fixed weekday phase", () => {
  // THE SUBTLER HALF OF THE DEFECT. Reusing a 5-day grid for a 1-day hold samples every fifth
  // session, so a 1-day measurement inherits a day-of-week bias and uses a fifth of the data.
  const oneDay = nonOverlappingStarts(250, 1, 920);
  const fiveDay = nonOverlappingStarts(250, 5, 920);
  assert.equal(oneDay.length, 670);
  assert.ok(oneDay.length / fiveDay.length > 4.9, "a 1-day grid should have ~5x the starts of a 5-day grid");
  // Consecutive integers, so every session in range is sampled and no phase is privileged.
  assert.deepEqual(oneDay.slice(0, 4), [250, 251, 252, 253]);
  // The old behaviour, for contrast: a 5-day grid used at a 1-day hold hits only one phase.
  assert.deepEqual([...new Set(fiveDay.map((i) => i % 5))], [0]);
  assert.equal(new Set(oneDay.map((i) => i % 5)).size, 5);
});

test("nonOverlappingStarts rejects inputs that would produce a silently wrong grid", () => {
  for (const bad of [0, -1, 2.5, NaN, "5"]) assert.throws(() => nonOverlappingStarts(0, bad, 100), /hold/);
  for (const bad of [-1, 2.5, NaN, "0"]) assert.throws(() => nonOverlappingStarts(bad, 5, 100), /firstIndex/);
  for (const bad of [-1, 2.5, NaN, "100"]) assert.throws(() => nonOverlappingStarts(0, 5, bad), /length/);
});
