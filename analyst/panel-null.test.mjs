/**
 * Tests for the null's machinery.
 *
 * Built on a SYNTHETIC panel with hand-computable returns, so the index semantics can be checked
 * against arithmetic rather than against another implementation of the same possible mistake. The one
 * test that touches the real bundle checks only that this module reproduces `paper-power.mjs`'s
 * measured sigma, which is what licenses using it in place of that script's private copy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReturnMap, bookReturn, drawPair, sd, mean, monteCarloSeOfSd, periodBootstrapSd,
} from "./panel-null.mjs";
import { seededRng } from "../inference.mjs";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} !~= ${b}`);

/** A panel whose closes are exactly 100, 110, 121, ... so each return is exactly +10%. */
function tenPercentPanel(bars = 6, syms = ["AAA", "BBB"]) {
  const kept = {};
  for (const s of syms) {
    kept[s] = Array.from({ length: bars }, (_, i) => ({ time: 1000 + i * 86400, close: 100 * 1.1 ** i }));
  }
  return buildReturnMap(kept);
}

// ---- index semantics ---------------------------------------------------------------------------

test("a return is keyed to the bar it ends on, and the first bar has none", () => {
  const p = tenPercentPanel(4);
  // 4 closes produce 3 returns, so the union of dated returns is 3 — not 4.
  assert.equal(p.dates.length, 3);
  assert.equal(p.dates[0], 1000 + 86400, "the first return must be keyed to the SECOND bar");
  for (const d of p.dates) close(p.ret.get("AAA").get(d), 0.1, 1e-12);
});

test("bookReturn compounds returns at i..i+hold-1, so hold=H gives exactly H returns", () => {
  const p = tenPercentPanel(8);          // 7 dated returns, each +10%
  for (const hold of [1, 2, 3]) {
    const { net, seen } = bookReturn(p, ["AAA"], 0, hold, 0);
    close(seen, hold, 1e-12);
    close(net, 1.1 ** hold - 1, 1e-12);  // H compounded +10% returns, zero cost
  }
});

test("cost is one round trip, charged once regardless of hold", () => {
  const p = tenPercentPanel(8);
  const leg = 0.001;
  for (const hold of [1, 5]) {
    const gross = bookReturn(p, ["AAA"], 0, hold, 0).net;
    const net = bookReturn(p, ["AAA"], 0, hold, leg).net;
    close(net, gross - 2 * leg, 1e-12);
  }
});

test("a window running past the panel is TRUNCATED, which is why the caller must bound it", () => {
  // bookReturn clamps rather than refusing, so a start beyond the end silently holds fewer sessions.
  // This is exactly the bias nonOverlappingStarts exists to prevent, asserted here so the division of
  // responsibility is explicit: bookReturn clamps, the grid is what keeps it from mattering.
  const p = tenPercentPanel(5);          // 4 dated returns
  const full = bookReturn(p, ["AAA"], 0, 4, 0);
  close(full.seen, 4, 1e-12);
  const over = bookReturn(p, ["AAA"], 2, 4, 0);
  close(over.seen, 2, 1e-12);            // only indices 2,3 exist
  assert.ok(over.net < full.net, "a truncated window should compound fewer returns");
});

test("a name missing a bar holds for fewer sessions, and `seen` reports it", () => {
  // Not forward-filled: the return is skipped, so that name's effective hold is shorter. Visible via
  // `seen` rather than silent, because a book of names with gaps is not holding what it looks like.
  const kept = {
    AAA: [0, 1, 2, 3].map((i) => ({ time: 1000 + i * 86400, close: 100 * 1.1 ** i })),
    GAP: [0, 1, 3].map((i) => ({ time: 1000 + i * 86400, close: 100 * 1.1 ** i })),
  };
  const p = buildReturnMap(kept);
  assert.equal(bookReturn(p, ["AAA"], 0, 3, 0).seen, 3);
  const gap = bookReturn(p, ["GAP"], 0, 3, 0);
  assert.ok(gap.seen < 3, `GAP should hold fewer than 3 sessions, got ${gap.seen}`);
});

test("bookReturn returns null when no name has any data, rather than 0", () => {
  // A zero would enter the sample as a real observation of 'no move'. Null is excluded instead.
  const p = tenPercentPanel(4);
  assert.equal(bookReturn(p, ["NOPE"], 0, 2, 0).net, null);
  assert.equal(bookReturn(p, [], 0, 2, 0).net, null);
});

// ---- the control-sampling choice ---------------------------------------------------------------

test("disjoint draws never share a name; non-disjoint draws sometimes do", () => {
  // OBSERVABLE WITHOUT REACHING INTO THE DRAW. Each symbol gets its own distinct constant return, so
  // two books hold identical names if and only if their difference is exactly zero. A disjoint pair can
  // never be identical; a non-disjoint pair must sometimes be, or the flag is doing nothing.
  //
  // An earlier version of this test ended with `overlaps = 1; assert.equal(overlaps, 1)`, which
  // asserted nothing at all.
  const kept = {};
  for (let i = 0; i < 4; i++) {
    const r = 0.01 * (i + 1);
    kept[`S${i}`] = Array.from({ length: 6 }, (_, k) => ({ time: 1000 + k * 86400, close: 100 * (1 + r) ** k }));
  }
  const p = buildReturnMap(kept);

  let disjointZeros = 0, overlapZeros = 0;
  for (let seed = 0; seed < 200; seed++) {
    const d = drawPair(p, p.names, 2, 0, 2, 0, seededRng(seed), { disjoint: true });
    const o = drawPair(p, p.names, 2, 0, 2, 0, seededRng(seed), { disjoint: false });
    assert.ok(d && o, "drawPair returned null on a complete panel");
    if (Math.abs(d.diff) < 1e-15) disjointZeros++;
    if (Math.abs(o.diff) < 1e-15) overlapZeros++;
  }
  assert.equal(disjointZeros, 0, "a disjoint pair produced identical books, so they shared names");
  assert.ok(overlapZeros > 0,
    `non-disjoint draws never produced an identical pair in 200 seeds — the disjoint flag has no effect`);
});

test("permitting overlap reduces the spread of the paired difference", () => {
  // THE DIRECTIONAL CLAIM THE TOOL REPORTS, asserted on a panel where it must hold. Identical names
  // in both books give a difference of exactly zero, so any overlap pulls the difference toward zero.
  const kept = {};
  for (let i = 0; i < 8; i++) {
    // Each symbol has its own constant return, so books differ only by which names they hold.
    const r = 0.01 * (i + 1);
    kept[`S${i}`] = Array.from({ length: 6 }, (_, k) => ({ time: 1000 + k * 86400, close: 100 * (1 + r) ** k }));
  }
  const p = buildReturnMap(kept);
  const run = (disjoint) => {
    const rng = seededRng(4242);
    const d = [];
    for (let k = 0; k < 4000; k++) {
      const r = drawPair(p, p.names, 3, 0, 2, 0, rng, { disjoint });
      if (r) d.push(r.diff);
    }
    return sd(d);
  };
  const disjointSd = run(true), overlapSd = run(false);
  assert.ok(overlapSd < disjointSd,
    `overlap should shrink the spread: disjoint ${disjointSd}, overlap ${overlapSd}`);
});

// ---- uncertainty ------------------------------------------------------------------------------

test("monteCarloSeOfSd shrinks as 1/sqrt(draws) and is undefined for one draw", () => {
  close(monteCarloSeOfSd(0.02, 10001) / monteCarloSeOfSd(0.02, 2501), 0.5, 1e-3);
  assert.ok(Number.isNaN(monteCarloSeOfSd(0.02, 1)));
});

test("the period bootstrap brackets the point estimate and reports its cluster count", () => {
  const rng = seededRng(7);
  const byPeriod = new Map();
  const all = [];
  for (let p = 0; p < 30; p++) {
    const vals = Array.from({ length: 20 }, () => (rng() - 0.5) * 0.04);
    byPeriod.set(p, vals);
    all.push(...vals);
  }
  const boot = periodBootstrapSd(byPeriod, seededRng(11), 300);
  assert.equal(boot.clusters, 30);
  assert.equal(boot.degenerate, false);
  const point = sd(all);
  assert.ok(boot.lo < point && point < boot.hi, `${boot.lo} < ${point} < ${boot.hi}`);
  assert.ok(boot.hi > boot.lo, "the interval must have width");
});

test("the period bootstrap refuses to invent an interval from fewer than two periods", () => {
  // One cluster resampled is the same cluster every time, so lo == hi == the point estimate: a
  // zero-width interval that reads as precision. The same defect this project already fixed once in
  // scoreJournal's clustered bootstrap.
  const one = new Map([[0, [0.01, -0.02, 0.03]]]);
  const r = periodBootstrapSd(one, seededRng(1));
  assert.equal(r.degenerate, true);
  assert.equal(r.lo, null);
  assert.equal(r.hi, null);
  assert.equal(r.clusters, 1);
  assert.equal(periodBootstrapSd(new Map(), seededRng(1)).degenerate, true);
});

test("sd and mean handle the degenerate sizes rather than returning NaN", () => {
  assert.equal(sd([]), 0);
  assert.equal(sd([0.5]), 0);
  assert.equal(mean([]), 0);
  close(mean([1, 2, 3]), 2);
  close(sd([1, 2, 3]), 1);   // sample sd with n-1
});

// ---- agreement with the script this was extracted from -----------------------------------------

test("reproduces paper-power.mjs's measured sigma on the committed bundle", async () => {
  // THE TEST THAT LICENSES THE EXTRACTION. paper-power.mjs reports sd 2.45% for a book of 10 at a
  // 5-day hold, seed 20260924, 20000 draws. It reaches book 10 with the rng stream already advanced by
  // its book-of-5 pass, so that pass is replayed here to consume the stream identically. Matching to
  // the script's printed precision is what makes this module a drop-in rather than a near-miss.
  const { loadBundleCandles, availablePairs } = await import("../bundle-loader.mjs");
  const { screenUniverse } = await import("../universe.mjs");
  const { COST_MODELS } = await import("../costs.mjs");
  const { nonOverlappingStarts } = await import("./power.mjs");
  const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;

  const raw = {};
  for (const s of availablePairs(1440, "sp500-bundle")) raw[s] = loadBundleCandles(s, 1440, "sp500-bundle");
  const panel = buildReturnMap(screenUniverse(raw).kept);
  const starts = nonOverlappingStarts(250, 5, panel.dates.length);
  const rng = seededRng(20260924);

  const pass = (bookSize) => {
    const diffs = [];
    for (let d = 0; d < 20000; d++) {
      const i = starts[Math.floor(rng() * starts.length)];
      const r = drawPair(panel, panel.names, bookSize, i, 5, LEG, rng, { disjoint: true });
      if (r) diffs.push(r.diff);
    }
    return sd(diffs);
  };
  pass(5);                       // advance the stream exactly as the script does
  const book10 = pass(10);
  assert.equal((book10 * 100).toFixed(2), "2.45",
    `expected the script's 2.45%, got ${(book10 * 100).toFixed(4)}%`);
});
