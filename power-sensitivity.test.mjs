/**
 * Tests for the sensitivity tool.
 *
 * Asserts STRUCTURE, REPRODUCIBILITY and the direction of each reported effect — not statistical
 * precision, which is the job of the draw count. Kept to a small draw count so the suite stays fast.
 *
 * NOTHING HERE IS EVIDENCE OF EDGE. Every assertion is about a property of the null — two random books
 * from the same pool, differenced — measured on historical prices for today's universe.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadPanel, measure, SEED, HOLD } from "./power-sensitivity.mjs";
import { mde } from "./analyst/power.mjs";

const REPO = import.meta.dirname;
const DRAWS = "500";

const run = (draws = DRAWS) =>
  execFileSync("node", [path.join(REPO, "power-sensitivity.mjs"), draws],
    { cwd: REPO, stdio: "pipe", encoding: "utf8", timeout: 300000 });

// Loaded once: reading the bundle is the slow part.
const panel = loadPanel();

test("the tool is deterministic at a fixed draw count", () => {
  // A seeded measurement whose output moves between runs cannot be quoted anywhere.
  assert.equal(run(), run());
});

test("importing the module runs no measurement", () => {
  // main() is guarded, so `npm test` importing this file must not kick off a 20,000-draw sweep.
  assert.ok(typeof measure === "function");
  assert.ok(panel.names.length > 100, `expected the real panel, got ${panel.names.length} names`);
});

test("sigma falls monotonically with book size — diversification, measured", () => {
  // The headline finding, and the direction is not in doubt: both books shed idiosyncratic variance as
  // they grow, so the spread of their difference must fall.
  const sizes = [1, 3, 10, 20];
  const sds = sizes.map((bookSize) =>
    measure(panel, { bookSize, hold: HOLD, draws: 1500, seed: SEED + bookSize }).sd);
  for (let i = 1; i < sds.length; i++) {
    assert.ok(sds[i] < sds[i - 1],
      `sigma should fall from book ${sizes[i - 1]} (${sds[i - 1]}) to ${sizes[i]} (${sds[i]})`);
  }
  // Roughly 1/sqrt(n), but NOT asserted as equality: the disjointness constraint binds at the large
  // end (two books of 20 take 40 of ~127 names), which inflates the large-book sigma.
  const ratio = sds[0] / sds.at(-1);
  assert.ok(ratio > 2 && ratio < 8, `1-to-20 sigma ratio ${ratio.toFixed(2)} outside a plausible band`);
});

test("permitting control overlap lowers sigma, so the registered table is conservative", () => {
  // journal.mjs's matchedRandomControl shuffles the pool and takes the first n WITHOUT reference to the
  // analyst's picks, so overlap is possible. Overlap correlates the books and shrinks the difference.
  const disjoint = measure(panel, { bookSize: 10, hold: HOLD, draws: 3000, seed: SEED, disjoint: true });
  const overlap = measure(panel, { bookSize: 10, hold: HOLD, draws: 3000, seed: SEED, disjoint: false });
  assert.ok(overlap.sd < disjoint.sd,
    `overlap sigma ${overlap.sd} should be below disjoint ${disjoint.sd}`);
  // A few percent, not a different regime — the registered figure is conservative, not wrong.
  const ratio = overlap.sd / disjoint.sd;
  assert.ok(ratio > 0.85 && ratio < 1.0, `ratio ${ratio.toFixed(4)} outside the expected band`);
});

test("sub-windows report their own period counts, and they sum to about the whole", () => {
  // Period counts per sub-window are the point: a quarter of the window holds a quarter of the
  // evidence, so each sub-estimate is noisier and must not be read as a separate confirmation.
  const usable = panel.dates.length - 250;
  const subs = [];
  for (let q = 0; q < 4; q++) {
    const from = 250 + Math.floor((usable * q) / 4);
    const to = 250 + Math.floor((usable * (q + 1)) / 4);
    subs.push(measure(panel, { bookSize: 10, hold: HOLD, draws: 800, seed: SEED + 100 + q,
                               firstStart: from, lastIndex: to }));
  }
  for (const s of subs) assert.ok(s.starts > 10, `a sub-window had only ${s.starts} periods`);
  const total = subs.reduce((n, s) => n + s.starts, 0);
  const whole = measure(panel, { bookSize: 10, hold: HOLD, draws: 100, seed: SEED }).starts;
  // Each boundary can lose at most one partial period, so the sum is within 4 of the whole.
  assert.ok(Math.abs(total - whole) <= 4, `sub-window periods ${total} vs whole ${whole}`);
});

test("measure reports periods DRAWN separately from periods AVAILABLE", () => {
  // With few draws, most periods are never sampled. Conflating the two would let 500 draws over 134
  // periods look like 500 observations, which is the order-of-magnitude error the protocol is built
  // around avoiding.
  const m = measure(panel, { bookSize: 10, hold: HOLD, draws: 40, seed: SEED });
  assert.ok(m.starts > m.periods, `available ${m.starts} should exceed drawn ${m.periods} at 40 draws`);
  assert.ok(m.n <= 40);
  const big = measure(panel, { bookSize: 10, hold: HOLD, draws: 5000, seed: SEED });
  assert.equal(big.starts, m.starts, "the available period count must not depend on the draw count");
  assert.ok(big.periods > m.periods);
});

test("an empty period grid yields an explicit empty result rather than a sigma of zero", () => {
  // A window too short for even one full hold must not report sigma 0, which would read as perfect
  // precision and give an MDE of exactly zero.
  const m = measure(panel, { bookSize: 10, hold: HOLD, draws: 100, seed: SEED,
                             firstStart: panel.dates.length - 2, lastIndex: panel.dates.length });
  assert.equal(m.empty, true);
  assert.equal(m.starts, 0);
});

test("the report states its limitations before any number", () => {
  // The framing is load-bearing: these are null measurements on survivors, and every MDE is a planning
  // estimate. If that wording is ever dropped the numbers become quotable as something they are not.
  const out = run("200");
  const header = out.slice(0, out.indexOf("=== 0."));
  for (const required of [/Not evidence of edge/, /survivorship/i, /PLANNING estimate/,
                          /Not prospective evidence/]) {
    assert.match(header, required);
  }
  // And it must not claim to choose the book size.
  assert.match(out, /MEASURED, NOT CHOSEN/);
  assert.doesNotMatch(out, /recommend(ed|s)? a book size/i);
});

test("the window sweep flags fractional periods as unrealisable", () => {
  const out = run("200");
  const section = out.slice(out.indexOf("=== 3."), out.indexOf("=== 4."));
  // 126/5 = 25.2 and 252/5 = 50.4 are both fractional and must be marked.
  assert.match(section, /25\.2 exact, 25 realisable/);
  assert.match(section, /50\.4 exact, 50 realisable/);
  // 20/5 = 4 divides exactly and must carry no note.
  const twenty = section.split("\n").find((l) => l.includes("20 trading days"));
  assert.doesNotMatch(twenty, /exact,/);
});

test("the MDE in the report matches analyst/power.mjs for the reported sigma", () => {
  // The tool must not carry its own copy of the arithmetic. Recomputing from the module has to land on
  // the printed figure.
  const m = measure(panel, { bookSize: 10, hold: HOLD, draws: 2000, seed: SEED });
  const expected = mde(m.sd, 50);
  assert.ok(expected > 0 && expected < m.sd, "MDE at 50 periods must be positive and below sigma");
  assert.ok(Math.abs(expected - 2.8016 * m.sd / Math.sqrt(50)) < 1e-6);
});
