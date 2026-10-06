/**
 * Tests for the cost-sensitivity audit.
 *
 * The claims under test are identities, so they are tested as identities: the paired difference moves
 * by EXACTLY 2*(cbar_a - cbar_b) and by nothing else. "It changed" and "it didn't change" are both too
 * weak to catch a sign error or a factor of two.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { bookReturn, drawPair, buildReturnMap } from "./analyst/panel-null.mjs";
import { commissionRate, priceWherePerShareExceeds, SCHEDULES, BASELINE_LEG, CONFIGURED_NAV } from "./cost-cancellation.mjs";
import { COST_MODELS } from "./costs.mjs";
import { costDragPerYear } from "./analyst/power.mjs";
import { seededRng } from "./inference.mjs";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} !~= ${b} (tol ${tol})`);

/** A tiny panel with known returns, so every expected value can be written down by hand. */
function tinyPanel() {
  const day = 86400;
  const t = (k) => 1700000000 + k * day;
  const series = (closes) => closes.map((c, k) => ({ time: t(k), close: c }));
  return buildReturnMap({
    AAA: series([100, 101, 102, 103, 104, 105, 106]),
    BBB: series([50, 50.5, 51, 51.5, 52, 52.5, 53]),
    CCC: series([10, 9.9, 9.8, 9.7, 9.6, 9.5, 9.4]),
    DDD: series([200, 202, 204, 206, 208, 210, 212]),
  });
}

// ---- the cancellation identity -----------------------------------------------------------------

test("EQUAL FIXED COST: bookReturn shifts by exactly -2c and the paired diff does not move", () => {
  const panel = tinyPanel();
  const syms = ["AAA", "BBB"];
  const gross = bookReturn(panel, syms, 0, 3, 0).net;
  for (const c of [0, 0.00055, 0.0011, 0.0085, 0.05]) {
    // The absolute figure: an EXACT shift, not merely a lower number.
    close(bookReturn(panel, syms, 0, 3, c).net, gross - 2 * c, 1e-15);
  }
  // The paired figure: invariant, to floating-point error. NOT bit-equality -- (a-2c)-(b-2c) is not
  // bit-equal to a-b in IEEE arithmetic, and asserting that would be a test that happens to pass.
  const diffAt = (c) => {
    const rng = seededRng(99);
    return drawPair(panel, panel.names, 2, 0, 3, c, rng, { disjoint: true }).diff;
  };
  const d0 = diffAt(0);
  for (const c of [0.00055, 0.0011, 0.0085, 0.05]) close(diffAt(c), d0, 1e-12);
  // And the invariance is not vacuous: the same draw with a DIFFERENT book must differ.
  const other = (() => { const rng = seededRng(4); return drawPair(panel, panel.names, 2, 0, 3, 0, rng, { disjoint: true }).diff; })();
  assert.notEqual(other, d0, "two different draws must give different diffs, or the test proves nothing");
});

test("UNEQUAL COST: the paired diff moves by exactly 2*(c_a - c_b), not approximately", () => {
  const panel = tinyPanel();
  const a = ["AAA", "BBB"], b = ["CCC", "DDD"];
  const grossDiff = bookReturn(panel, a, 0, 3, 0).net - bookReturn(panel, b, 0, 3, 0).net;
  for (const [ca, cb] of [[0.00055, 0], [0, 0.00055], [0.001, 0.0005], [0.01, 0.0001]]) {
    const costed = bookReturn(panel, a, 0, 3, ca).net - bookReturn(panel, b, 0, 3, cb).net;
    close(costed, grossDiff - 2 * (ca - cb), 1e-15);
    // The sign matters: charging side A more must LOWER the measured edge.
    if (ca > cb) assert.ok(costed < grossDiff, "a dearer book must measure worse, not better");
    if (ca < cb) assert.ok(costed > grossDiff, "a cheaper book must measure better");
  }
});

test("TURNOVER: a side trading every k-th period shifts the mean by 2c(1-1/k) and adds no variance", () => {
  const diffs = [0.012, -0.004, 0.0071, -0.0135, 0.0002, 0.009, -0.0088];
  const c = BASELINE_LEG;
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const variance = (xs) => { const m = mean(xs); return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1); };
  for (const k of [1, 2, 5, 10]) {
    const shifted = diffs.map((v) => v - (2 * c - 2 * c / k));
    close(mean(shifted) - mean(diffs), -2 * c * (1 - 1 / k), 1e-15);
    close(variance(shifted), variance(diffs), 1e-18);   // a constant shift cannot change variance
  }
});

// ---- the per-order minimum, which is what makes cost book-dependent ----------------------------

test("commissionRate: the per-order minimum binds below a computable notional", () => {
  const { perShare, minPerOrder } = SCHEDULES.tieredComment;   // 0.0035/share, 0.35 minimum
  // At a $100 stock the minimum binds for fewer than 100 shares, i.e. under $10,000 of notional.
  close(commissionRate({ price: 100, notional: 10000, perShare, minPerOrder }), 0.000035, 1e-12);
  close(commissionRate({ price: 100, notional: 1000, perShare, minPerOrder }), 0.00035, 1e-12);  // 3.5bp
  close(commissionRate({ price: 100, notional: 100, perShare, minPerOrder }), 0.0035, 1e-12);    // 35bp
  // THE ARITHMETIC costs.mjs's COMMENT GETS WRONG. It says "$0.0035/share with a $0.35 minimum. On a
  // $100 stock that is 3.5bp per leg at one share" -- one share of a $100 stock is $100 of notional,
  // pays the $0.35 minimum, and that is 35bp, a factor of ten larger. Asserted here because the
  // comment is the only place the schedule is written down and the file itself is not ours to edit.
  close(commissionRate({ price: 100, notional: 100, perShare, minPerOrder }), 0.0035, 1e-12);
  assert.notEqual(commissionRate({ price: 100, notional: 100, perShare, minPerOrder }), 0.00035);

  // Above the floor the rate depends on PRICE and not on size at all -- perShare/price.
  for (const notional of [50000, 100000, 250000]) {
    close(commissionRate({ price: 20, notional, perShare, minPerOrder }), perShare / 20, 1e-12);
  }
  assert.ok(commissionRate({ price: 20, notional: 50000, perShare, minPerOrder })
          > commissionRate({ price: 200, notional: 50000, perShare, minPerOrder }),
    "a cheaper share price must cost more per unit of notional under a per-share schedule");
});

test("the modelled flat feeRate is exceeded below a price the audit computes, not guesses", () => {
  const rate = COST_MODELS.usEquityIbkr.feeRate;            // 0.00005 = 0.5bp
  const p = priceWherePerShareExceeds(SCHEDULES.tieredComment.perShare, rate);
  close(p, 70, 1e-9);                                       // 0.0035 / 0.00005
  // Either side of the crossover, in the direction claimed.
  assert.ok(SCHEDULES.tieredComment.perShare / (p - 1) > rate);
  assert.ok(SCHEDULES.tieredComment.perShare / (p + 1) < rate);
  close(priceWherePerShareExceeds(SCHEDULES.fixedArchive.perShare, rate), 100, 1e-9);
  assert.throws(() => priceWherePerShareExceeds(0.0035, 0), /rate must be positive/);
});

test("commissionRate rejects inputs that would yield a plausible wrong number", () => {
  const ok = { price: 100, notional: 10000, perShare: 0.0035, minPerOrder: 0.35 };
  for (const bad of [0, -1, NaN]) {
    assert.throws(() => commissionRate({ ...ok, price: bad }), /price must be positive/);
    assert.throws(() => commissionRate({ ...ok, notional: bad }), /notional must be positive/);
  }
  for (const bad of [-1, NaN]) {
    assert.throws(() => commissionRate({ ...ok, perShare: bad }), /perShare must be >= 0/);
    assert.throws(() => commissionRate({ ...ok, minPerOrder: bad }), /minPerOrder must be >= 0/);
  }
  // Zero commission is a legitimate diagnostic baseline, not an error.
  assert.equal(commissionRate({ ...ok, perShare: 0, minPerOrder: 0 }), 0);
});

// ---- the two schedules disagree, and the audit must not pick one silently -----------------------

test("both schedules are labelled hypothetical and give materially different floors", () => {
  for (const [name, sch] of Object.entries(SCHEDULES)) {
    assert.match(sch.note, /HYPOTHETICAL/, `${name} must be labelled hypothetical`);
  }
  const notional = CONFIGURED_NAV / 10;                      // the configured NAV, 10 names at 10%
  const t = commissionRate({ price: 100, notional, ...SCHEDULES.tieredComment });
  const f = commissionRate({ price: 100, notional, ...SCHEDULES.fixedArchive });
  assert.ok(f > t, "the $1.00 floor must cost more than the $0.35 floor at the same notional");
  close(f / t, SCHEDULES.fixedArchive.minPerOrder / SCHEDULES.tieredComment.minPerOrder, 1e-9);
});

// ---- the protocol's own cost-drag figures ------------------------------------------------------

test("costDragPerYear is linear in 1/hold, so the protocol's two figures cannot both be hold 5 and 1", () => {
  // The protocol reads "cost drag rises from 1.3%/yr to 27.7%/yr" in a sentence comparing hold 5
  // with hold 1. Linearity forces that ratio to be exactly 5.
  const h1 = costDragPerYear(BASELINE_LEG, 1);
  const h5 = costDragPerYear(BASELINE_LEG, 5);
  close(h1 / h5, 5, 1e-12);
  close(h1, 0.2772, 1e-9);                       // 2 * 0.00055 * 252
  close(h5, 0.05544, 1e-9);                      // NOT 1.3%
  // 1.32%/yr is the hold-21 row, which is where that figure actually comes from.
  close(costDragPerYear(BASELINE_LEG, 21), 0.0132, 1e-4);
  assert.ok(Math.abs(h5 - 0.013) > 0.04, "hold 5 is nowhere near 1.3%/yr");
});
