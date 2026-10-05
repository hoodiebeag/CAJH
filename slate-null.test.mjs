/**
 * Tests for the slate-conditioned null.
 *
 * The centrepiece is a TINY SYNTHETIC PANEL where slate membership is known by construction: returns
 * are rigged so the momentum ranking is a known permutation, so the test can assert exactly which
 * names `buildContext` must put on the slate. That is the only way to check a point-in-time
 * reconstruction without re-implementing the thing being checked.
 *
 * NOTHING HERE IS EVIDENCE OF EDGE. Every assertion concerns the dispersion of two random books from
 * one pool, measured on historical or synthetic prices.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildContext } from "./analyst/context.mjs";
import { nonOverlappingStarts } from "./analyst/power.mjs";
import { buildReturnMap, blockBootstrapSd, periodBootstrapSd, sd } from "./analyst/panel-null.mjs";
import { seededRng } from "./inference.mjs";
import { loadGrids, slateFor, measureWithPool, SEED, HOLD, FIRST_START } from "./slate-null.mjs";

const REPO = import.meta.dirname;
const DAY = 86400;

/**
 * A panel of `n` symbols whose per-bar return is strictly ordered by index: S0 worst, S{n-1} best.
 * Momentum is `ret(c, i, 252, 21)`, so the ranking is determined once there are enough bars, and the
 * slate's top and bottom halves are then known names rather than an empirical surprise.
 */
function rankedPanel(n = 12, bars = 300) {
  const series = {};
  for (let k = 0; k < n; k++) {
    const r = 0.0002 * (k + 1);            // strictly increasing drift by index
    series[`S${String(k).padStart(2, "0")}`] =
      Array.from({ length: bars }, (_, i) => ({ time: 1_600_000_000 + i * DAY, close: 100 * (1 + r) ** i }));
  }
  const barDates = [...new Set(Object.values(series).flatMap((b) => b.map((x) => Number(x.time))))].sort((a, b) => a - b);
  return { series, barDates };
}

// ---- the slate, against known membership -------------------------------------------------------

test("on a rigged panel the slate is exactly the known top and bottom halves by momentum", () => {
  // THE POINT-IN-TIME RECONSTRUCTION, CHECKED AGAINST ARITHMETIC. Returns increase strictly with the
  // symbol index, so momentum must rank S11 highest and S00 lowest. A slate of 6 takes half = 3 from
  // each end: {S11,S10,S09} and {S02,S01,S00}, and must exclude the middle six entirely.
  const { series, barDates } = rankedPanel(12, 300);
  const asOf = 290;
  const ctx = buildContext({ series, dates: barDates, asOf, slate: 6, positions: {} });
  const got = ctx.candidates.map((c) => c.symbol).sort();
  assert.deepEqual(got, ["S00", "S01", "S02", "S09", "S10", "S11"].sort());
  // The middle is genuinely excluded, so the slate is a ranked selection and not a sample.
  for (const mid of ["S03", "S04", "S05", "S06", "S07", "S08"]) assert.ok(!got.includes(mid));
});

test("a slate wider than the universe returns the whole cross-section and says so", () => {
  const { series, barDates } = rankedPanel(12, 300);
  const ctx = buildContext({ series, dates: barDates, asOf: 290, slate: 300, positions: {} });
  assert.equal(ctx.candidates.length, 12);
  assert.match(ctx.universe.note, /entire cross-section/);
});

test("held positions are always on the slate, which is why the flat-book run is an APPROXIMATION", () => {
  // The labelled approximation, asserted rather than asserted-in-prose: a held name that the ranking
  // would exclude still appears. slate-null.mjs passes positions: {} and therefore omits this
  // component, which is why its output calls itself an approximation.
  const { series, barDates } = rankedPanel(12, 300);
  const flat = buildContext({ series, dates: barDates, asOf: 290, slate: 6, positions: {} });
  assert.ok(!flat.candidates.map((c) => c.symbol).includes("S05"), "S05 should be ranked away when flat");

  const held = buildContext({ series, dates: barDates, asOf: 290, slate: 6,
                              positions: { S05: { pct: 0.05, avgPrice: 100 } } });
  const names = held.candidates.map((c) => c.symbol);
  assert.ok(names.includes("S05"), "a held name must always be shown");
  assert.ok(held.candidates.find((c) => c.symbol === "S05").held, "and must be flagged held");
  assert.ok(names.length > flat.candidates.length, "held names are shown ON TOP of the ranked slate");
});

test("the slate at asOf cannot see a future bar", () => {
  // No look-ahead, demonstrated by construction: appending future bars that would REVERSE the ranking
  // must not change the slate at the earlier asOf.
  const { series, barDates } = rankedPanel(8, 300);
  const asOf = 280;
  const before = buildContext({ series, dates: barDates, asOf, slate: 4, positions: {} })
    .candidates.map((c) => c.symbol).sort();

  // Give the worst name an enormous future run-up; it must not appear in the earlier slate.
  const extended = structuredClone(series);
  let last = extended.S00.at(-1).close;
  for (let i = 0; i < 40; i++) {
    last *= 1.5;
    extended.S00.push({ time: Number(extended.S00.at(-1).time) + DAY, close: last });
  }
  const extDates = [...new Set(Object.values(extended).flatMap((b) => b.map((x) => Number(x.time))))].sort((a, b) => a - b);
  const after = buildContext({ series: extended, dates: extDates, asOf, slate: 4, positions: {} })
    .candidates.map((c) => c.symbol).sort();
  assert.deepEqual(after, before, "a future bar changed a past slate — look-ahead");
});

// ---- the degeneracy the runtime has ------------------------------------------------------------

test("a pool no larger than the book makes the control identical to it — not a noisy measurement", () => {
  // THE FINDING, as a test. matchedRandomControl samples without replacement from the pool, so at
  // pool == book both books take every name and the paired difference is exactly zero. A tool that
  // reported sigma 0.000% here would be reporting perfect precision for a vanished comparison.
  const { series, barDates } = rankedPanel(20, 300);
  const panel = buildReturnMap(series);
  const starts = nonOverlappingStarts(260, HOLD, panel.dates.length);
  assert.ok(starts.length > 2, `need periods to measure, got ${starts.length}`);

  const tenNames = panel.names.slice(0, 10);
  const degen = measureWithPool(panel, starts, () => tenNames,
    { bookSize: 10, hold: HOLD, draws: 300, seed: SEED });
  assert.equal(degen.degenerate, true);
  assert.equal(degen.sd, 0);
  assert.ok(degen.identicalShare > 0.999, `identical share ${degen.identicalShare}`);
  assert.ok(degen.poolTooSmallShare > 0.999, "pool==book must be flagged too small for a DISTINCT control");

  // One more name is enough to stop it being identically zero.
  const elevenNames = panel.names.slice(0, 11);
  const ok = measureWithPool(panel, starts, () => elevenNames,
    { bookSize: 10, hold: HOLD, draws: 300, seed: SEED });
  assert.equal(ok.degenerate, false);
  assert.ok(ok.sd > 0, "a pool of book+1 must produce a non-zero spread");
  assert.ok(ok.identicalShare < 0.999);
});

test("disjoint sampling needs twice the book, and the threshold reflects that", () => {
  const { series } = rankedPanel(30, 300);
  const panel = buildReturnMap(series);
  const starts = nonOverlappingStarts(260, HOLD, panel.dates.length);
  const fifteen = panel.names.slice(0, 15);
  const m = measureWithPool(panel, starts, () => fifteen,
    { bookSize: 10, hold: HOLD, draws: 200, seed: SEED, disjoint: true });
  assert.ok(m.poolTooSmallShare > 0.999, "15 names cannot supply two disjoint books of 10");
});

// ---- the real panel ----------------------------------------------------------------------------

test("the real panel's bar and return grids correspond, and loadGrids proves it", () => {
  const g = loadGrids();
  assert.equal(g.aligned, true);
  assert.equal(g.barDates.length, g.panel.dates.length + 1);
  assert.ok(g.panel.dates.every((t, k) => t === g.barDates[k + 1]));
  // The mapping the whole tool rests on: one shared first bar across every symbol.
  const firsts = new Set(Object.values(g.kept).map((b) => Number(b[0].time)));
  assert.equal(firsts.size, 1);
});

test("slate=300 on the real panel is the whole screened universe", () => {
  // So slate-conditioning changes nothing at the DEPLOYED setting on this panel — the central result,
  // and the reason this unit found no owner decision to make.
  const g = loadGrids();
  const s = slateFor(g, FIRST_START + 10, { slate: 300 });
  assert.equal(s.symbols.length, g.panel.names.length);
  assert.match(s.note, /entire cross-section/);
});

test("a narrow slate on the real panel is narrower and still point-in-time", () => {
  const g = loadGrids();
  for (const slate of [20, 40, 80]) {
    const s = slateFor(g, FIRST_START + 10, { slate });
    assert.equal(s.symbols.length, slate, `slate=${slate} produced ${s.symbols.length} names`);
    assert.equal(new Set(s.symbols).size, s.symbols.length, "the slate contains a duplicate");
    for (const sym of s.symbols) assert.ok(g.panel.names.includes(sym), `${sym} is not in the screened universe`);
  }
});

test("measureWithPool reports periods drawn separately from periods available", () => {
  const g = loadGrids();
  const starts = nonOverlappingStarts(FIRST_START, HOLD, g.panel.dates.length);
  const m = measureWithPool(g.panel, starts, () => g.panel.names,
    { bookSize: 10, hold: HOLD, draws: 40, seed: SEED });
  assert.equal(m.starts, starts.length);
  assert.ok(m.periods < m.starts, "40 draws cannot have touched every period");
  assert.ok(m.n <= 40);
});

// ---- the bootstraps ----------------------------------------------------------------------------

test("the block bootstrap brackets the point estimate and is NOT claimed to dominate the iid one", () => {
  // Both are modelling choices. The test asserts they are both usable and comparable, and
  // deliberately does NOT assert that one interval is wider — the direction is not determined.
  const rng = seededRng(5);
  const byPeriod = new Map();
  const all = [];
  for (let p = 0; p < 40; p++) {
    const vals = Array.from({ length: 15 }, () => (rng() - 0.5) * 0.05);
    byPeriod.set(p, vals);
    all.push(...vals);
  }
  const point = sd(all);
  const iid = periodBootstrapSd(byPeriod, seededRng(9), 300);
  const blk = blockBootstrapSd(byPeriod, seededRng(9), { iterations: 300, blockLength: 5 });
  for (const b of [iid, blk]) {
    assert.equal(b.degenerate, false);
    assert.ok(b.lo < point && point < b.hi, `${b.lo} < ${point} < ${b.hi}`);
  }
  assert.equal(blk.blockLength, 5);
  assert.equal(blk.clusters, 40);
});

test("the block bootstrap wraps, so edge periods are not under-sampled", () => {
  // Without wrapping, the last blockLength-1 periods can only appear in a block that starts before
  // them, so they enter fewer resamples than interior periods. Checked by giving exactly one period a
  // distinctive value and confirming it reaches the resample regardless of position.
  for (const edge of [0, 19]) {
    const byPeriod = new Map();
    for (let p = 0; p < 20; p++) byPeriod.set(p, p === edge ? [10] : [0]);
    const r = blockBootstrapSd(byPeriod, seededRng(3), { iterations: 200, blockLength: 5 });
    assert.ok(r.hi > 0, `period ${edge} never reached a resample — the bootstrap does not wrap`);
  }
});

test("both bootstraps refuse to invent an interval from one period", () => {
  const one = new Map([[0, [0.01, -0.02]]]);
  assert.equal(periodBootstrapSd(one, seededRng(1)).degenerate, true);
  assert.equal(blockBootstrapSd(one, seededRng(1)).degenerate, true);
  assert.equal(blockBootstrapSd(one, seededRng(1)).lo, null);
});

// ---- the report ---------------------------------------------------------------------------------

test("the report is deterministic and states its limits before any number", () => {
  // A reduced slate set: the report rebuilds a faithful slate per (slate, period) pair, so the default
  // five values cost ~665 grid builds per run and two runs would dominate the suite. 10 and 300 are the
  // two that carry the assertions below — the degenerate case and the whole-universe case.
  const run = (draws) => execFileSync("node", [path.join(REPO, "slate-null.mjs"), draws],
    { cwd: REPO, stdio: "pipe", encoding: "utf8", timeout: 600000,
      env: { ...process.env, SLATE_NULL_SLATES: "10,300" } });
  const out = run("150");
  assert.equal(out, run("150"), "the report is not deterministic at a fixed draw count");

  const header = out.slice(0, out.indexOf("=== 1."));
  for (const required of [/Not evidence of edge/, /Not prospective evidence/, /PLANNING PROXY/,
                          /no open owner\s*\n?\s*decision|no open owner decision/]) {
    assert.match(header, required);
  }
  // It must label the approximation rather than implying an exact replay.
  assert.match(out, /APPROXIMATION: positions = \{\}/);
  assert.match(out, /IMPOSSIBLE FROM THESE FILES: point-in-time ELIGIBILITY/);
  // And it must flag, not report, the degenerate configuration.
  assert.match(out, /DEGENERATE/);
  // It must DISCLAIM a recommendation rather than merely avoid the word — an earlier version of this
  // assertion was `doesNotMatch(/recommended slate/i)` and failed on the tool's own disclaimer.
  assert.match(out, /NOT as a recommended slate or book size/);
  // And it must not make an affirmative sizing recommendation.
  assert.doesNotMatch(out, /(we|you)\s+(should|recommend)\s+(use|set|a)\b/i);
  assert.doesNotMatch(out, /recommended (setting|configuration) (is|:)/i);
});
