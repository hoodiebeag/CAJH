/**
 * Tests for `paper-power.mjs`, which had none.
 *
 * This script produces the numbers `docs/PAPER-PROTOCOL.md` pre-registered and the conclusion that
 * no practical paper period will prove edge. It is a seeded Monte Carlo over the committed panel, so
 * it is reproducible by construction — but nothing checked that, and it carried a grid-construction
 * defect for its whole life (a 5-day start grid reused while comparing other holds, plus an
 * off-by-one that dropped the most recent period).
 *
 * Runs the script, so it is slower than a unit test. Kept to a small draw count: these assert
 * STRUCTURE and REPRODUCIBILITY, not statistical precision. The arithmetic itself is unit-tested in
 * analyst/power.test.mjs, and the registered table is reproduced there.
 *
 * NOTHING HERE IS EVIDENCE OF EDGE. The script simulates the NULL — two random books drawn from the
 * same pool at the same instant — to measure how much noise any claimed edge would have to clear. A
 * run of it says nothing about whether the analyst has an edge, and these tests assert properties of
 * a noise measurement on historical prices, not of a strategy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = import.meta.dirname;
const DRAWS = "300";   // structure, not precision; keeps the suite fast

const run = (draws = DRAWS) =>
  execFileSync("node", [path.join(REPO, "paper-power.mjs"), draws],
    { cwd: REPO, stdio: "pipe", encoding: "utf8", timeout: 300000 });

/** Pull the annualised column out of the hold table. */
function holdRows(out) {
  const section = out.slice(out.indexOf("DOES A SHORTER HOLD HELP?"));
  const rows = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\s+(\d+)d\s+(\d+)\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%/);
    if (m) rows.push({ hold: +m[1], periods: +m[2], noise: +m[3], mde: +m[4], annualised: +m[5], cost: +m[6] });
  }
  return rows;
}

test("the script is deterministic: the same draw count gives byte-identical output", () => {
  // A seeded simulation whose output moves between runs cannot support a pre-registered number, and
  // the seed is the only reason this script's figures can be quoted in a protocol document at all.
  assert.equal(run(), run());
});

test("more draws change the estimate but not the panel it is measured on", () => {
  const a = run("200"), b = run("400");
  const panelLine = (s) => s.split("\n")[0];
  assert.equal(panelLine(a), panelLine(b), "the panel summary must not depend on the draw count");
  assert.match(panelLine(a), /^panel \d+ names, \d+ dates, \d+ non-overlapping 5-day periods$/);
  assert.notEqual(a, b, "different draw counts should produce different estimates");
});

test("the panel line reports the corrected period count, not the off-by-one", () => {
  // The grid used `i + hold < length`, which dropped the last fully-available period — always the
  // most recent one. On the committed 920-date panel at a 5-day hold that is 134 periods, not 133.
  const out = run("100");
  const m = out.match(/panel (\d+) names, (\d+) dates, (\d+) non-overlapping 5-day periods/);
  assert.ok(m, "panel summary line missing");
  const [, names, dates, periods] = m.map(Number);
  assert.ok(names > 100, `expected a real panel, got ${names} names`);
  // The grid starts at index 250 and steps by the hold, so the count follows from the panel length.
  assert.equal(periods, Math.floor((dates - 250) / 5), `periods ${periods} inconsistent with ${dates} dates`);
});

test("every hold is measured on its own non-overlapping grid", () => {
  // THE DEFECT, OBSERVABLE FROM THE OUTPUT. When a 5-day grid was reused for every hold, the 1-day
  // row was estimated from every fifth session. Per-period noise should rise monotonically with the
  // hold — a longer hold accumulates more variance — and the 1-day figure in particular should sit
  // well below the 5-day one rather than being a subsample of the same grid.
  const rows = holdRows(run());
  assert.deepEqual(rows.map((r) => r.hold), [1, 2, 5, 10, 21]);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].noise > rows[i - 1].noise,
      `noise should grow with hold: ${rows[i - 1].hold}d ${rows[i - 1].noise}% vs ${rows[i].hold}d ${rows[i].noise}%`);
  }
  // Periods in a 20-day month, which is arithmetic rather than measurement.
  assert.deepEqual(rows.map((r) => r.periods), [20, 10, 4, 2, 1]);
});

test("cost drag is exactly inverse in the hold, and that column is the one that moves", () => {
  // The protocol's claim: the annualised detectable edge barely moves across holds, while cost does.
  // Cost is closed-form, so it is asserted exactly; it must double as the hold halves.
  const rows = holdRows(run());
  const cost = Object.fromEntries(rows.map((r) => [r.hold, r.cost]));
  assert.ok(Math.abs(cost[1] / cost[2] - 2) < 0.02, `1d/2d cost ratio ${cost[1] / cost[2]}`);
  assert.ok(Math.abs(cost[2] / cost[10] - 5) < 0.05, `2d/10d cost ratio ${cost[2] / cost[10]}`);
  // The registered span: 1.3%/yr at a 21-day hold to 27.7%/yr at a 1-day hold.
  assert.ok(cost[21] > 1.2 && cost[21] < 1.5, `21d cost ${cost[21]}%`);
  assert.ok(cost[1] > 27 && cost[1] < 28.5, `1d cost ${cost[1]}%`);
  // Strictly decreasing in hold, with no exceptions — the asymmetry the protocol relies on.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].cost < rows[i - 1].cost);
});

test("the annualised column stays flat across holds — the lever really is closed", () => {
  // The protocol registered "~157-181%" across holds and concluded that shortening the hold does not
  // buy power. At this low draw count the estimates are noisy, so the assertion is deliberately loose
  // and one-sided in the direction that matters: no hold should look dramatically better than the
  // others. The exact identity behind the flatness is proved in analyst/power.test.mjs; this only
  // checks the measurement has not come apart.
  const ann = holdRows(run("600")).map((r) => r.annualised);
  const lo = Math.min(...ann), hi = Math.max(...ann);
  assert.ok(lo > 100, `no hold should resolve better than ~100% annualised; got ${lo}%`);
  assert.ok(hi / lo < 2.0, `annualised spread ${lo}-${hi}% is too wide to call flat`);
  // And the headline reading survives: a month resolves nothing remotely small, whatever the hold.
  assert.ok(lo > 50, "a month of paper must not appear to resolve a plausibly-sized edge");
});

test("the output says what it is measuring, so a reader cannot mistake it for a result", () => {
  const out = run("100");
  assert.match(out, /drawing TWO random books per period and differencing/);
  assert.match(out, /smallest edge a run of this length could resolve/);
  // It must never claim an edge was found. The word appears only as "edge a run could resolve".
  assert.doesNotMatch(out, /edge (found|detected|confirmed|established)/i);
});
