/**
 * Tests for the regime-conditioned null.
 *
 * The load-bearing property is that a period's volatility label depends on NO data after that period.
 * That is checked by construction on a synthetic panel — append a violent future move and the earlier
 * label must not budge — rather than by reading the code and believing it.
 *
 * NOTHING HERE IS EDGE EVIDENCE. Every assertion concerns the dispersion of two random books from one
 * pool, or the mechanics of labelling periods. No strategy is registered or tested.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  trailingVol, volWindowIndices, terciles, classifyPeriods, measureStates, STATE, STATE_SEED,
  VOL_WINDOW, MIN_HISTORY, MIN_PERIODS_PER_STATE, HOLD, FIRST_START, SEED,
} from "./regime-null.mjs";
import { buildReturnMap, sd } from "./analyst/panel-null.mjs";
import { nonOverlappingStarts } from "./analyst/power.mjs";
import { loadGrids, slateFor } from "./slate-null.mjs";

const REPO = import.meta.dirname;
const DAY = 86400;

/**
 * A panel whose per-bar move is CALM for the first `calm` bars and VIOLENT afterwards, so the trailing
 * volatility state of any period is known from its position.
 */
function regimePanel({ bars = 400, calm = 200, calmMove = 0.001, wildMove = 0.04, syms = 6 } = {}) {
  const series = {};
  for (let k = 0; k < syms; k++) {
    const out = [];
    let px = 100;
    for (let i = 0; i < bars; i++) {
      const m = i < calm ? calmMove : wildMove;
      px *= 1 + (i % 2 === 0 ? m : -m) * (1 + 0.01 * k);
      out.push({ time: 1_600_000_000 + i * DAY, close: px });
    }
    series[`S${k}`] = out;
  }
  const barDates = [...new Set(Object.values(series).flatMap((b) => b.map((x) => Number(x.time))))].sort((a, b) => a - b);
  return { series, barDates, panel: buildReturnMap(series) };
}

// ---- the state definition uses only pre-decision information -----------------------------------

test("every return timestamp consumed is at or before the DECISION timestamp", () => {
  // THE BOUNDARY, ASSERTED ON TIMESTAMPS RATHER THAN ON INDEX ARITHMETIC I CHOSE. An earlier version of
  // this test recomputed the basket over the same i-inclusive indices trailingVol used, so it certified
  // whatever boundary the implementation had — including the wrong one.
  const { panel, barDates } = regimePanel({ bars: 120, calm: 120 });
  const i = 60, w = 21;
  const span = volWindowIndices(i, w, panel.dates.length);
  assert.ok(span, "the window should be available at i=60");

  const decisionTime = barDates[i];
  for (let k = span.from; k <= span.to; k++) {
    assert.ok(panel.dates[k] <= decisionTime,
      `return index ${k} is keyed ${new Date(panel.dates[k] * 1000).toISOString().slice(0, 10)}, ` +
      `after the decision close ${new Date(decisionTime * 1000).toISOString().slice(0, 10)}`);
  }
  // The last permissible index is exactly the decision bar, so the window is not needlessly short.
  assert.equal(panel.dates[span.to], decisionTime, "the window should end AT the decision close");
  assert.equal(span.to, i - 1, "return index i is the move INTO barDates[i+1] and must be excluded");
  assert.equal(span.to - span.from + 1, w);

  // And the value matches an independent average over exactly that span.
  const basket = [];
  for (let k = span.from; k <= span.to; k++) {
    const rs = panel.names.map((sy) => panel.ret.get(sy).get(panel.dates[k])).filter((r) => r !== undefined);
    basket.push(rs.reduce((a, b) => a + b, 0) / rs.length);
  }
  assert.ok(Math.abs(trailingVol(panel, i, w) - sd(basket)) < 1e-12);
});

test("REGRESSION: changing precisely bar i+1 leaves the volatility and label untouched", () => {
  // THE TEST THAT WOULD HAVE CAUGHT IT. The old no-look-ahead test appended bars far in the future,
  // which cannot detect a leak exactly one bar wide. This perturbs ONLY bar i+1, keeps every bar at or
  // before i byte-identical, and checks the measurement at i does not move.
  const DAY2 = 86400;
  const build = (bars, perturbAt, factor) => {
    const series = {};
    for (let k = 0; k < 4; k++) {
      const out = [];
      let px = 100;
      for (let j = 0; j < bars; j++) {
        let m = 0.001 * (1 + 0.1 * k) * (j % 2 ? -1 : 1);
        if (perturbAt !== null && j === perturbAt) m *= factor;
        px *= 1 + m;
        out.push({ time: 1_600_000_000 + j * DAY2, close: px });
      }
      series[`S${k}`] = out;
    }
    return series;
  };
  const i = 50;
  const plain = build(120, null, 1);
  const bumped = build(120, i + 1, 60);

  // The premise: identical at and before i, different at i+1.
  for (const sy of Object.keys(plain)) {
    for (let j = 0; j <= i; j++) {
      assert.equal(Number(plain[sy][j].close), Number(bumped[sy][j].close),
        `${sy} bar ${j} differs — the fixture does not isolate bar i+1`);
    }
    assert.notEqual(Number(plain[sy][i + 1].close), Number(bumped[sy][i + 1].close),
      `${sy} bar ${i + 1} is unchanged — the fixture perturbs nothing`);
  }

  const a = buildReturnMap(plain), b = buildReturnMap(bumped);
  assert.equal(trailingVol(a, i, VOL_WINDOW), trailingVol(b, i, VOL_WINDOW),
    "a change at bar i+1 moved the volatility at i — one-bar look-ahead");

  // And at the label level across a shared period set.
  const starts = nonOverlappingStarts(40, HOLD, 110);
  const ca = classifyPeriods(a, starts, { window: VOL_WINDOW, mode: "expanding", minHistory: 5 });
  const cb = classifyPeriods(b, starts, { window: VOL_WINDOW, mode: "expanding", minHistory: 5 });
  const upTo = starts.findIndex((st) => st > i);
  assert.ok(upTo > 2, "need periods at or before i to compare");
  assert.deepEqual(ca.labels.slice(0, upTo), cb.labels.slice(0, upTo),
    "a change at bar i+1 moved an earlier label — one-bar look-ahead in classification");
});

test("an incomplete window returns null rather than a figure from fewer dates", () => {
  // `basket.length >= 2` accepted a short window whenever some dates had no data for any symbol and
  // reported it as a full-window measurement. The window must be fully covered or null.
  const DAY3 = 86400;
  const series = {
    A: Array.from({ length: 60 }, (_, j) => ({ time: 1_600_000_000 + j * DAY3, close: 100 * 1.001 ** j })),
  };
  // B shares the grid but omits a block of dates, so those dates have A's data only — still covered.
  series.B = series.A.filter((_, j) => j < 20 || j > 30);
  const panel = buildReturnMap(series);
  assert.ok(Number.isFinite(trailingVol(panel, 40, 21)), "dates covered by at least one symbol are fine");

  // A panel where a date is covered by NO symbol cannot occur through buildReturnMap (the union is
  // built from the data), so the uncoverable case is the short window at the start of the panel.
  // from = i - window and to = i - 1, so the first fully-available window is i === window.
  assert.equal(trailingVol(panel, 5, 21), null, "a window reaching before the panel must be null");
  assert.equal(trailingVol(panel, 20, 21), null, "i=20 needs return index -1, so it is unavailable");
  assert.deepEqual(volWindowIndices(21, 21, 59), { from: 0, to: 20 });
  assert.ok(Number.isFinite(trailingVol(panel, 21, 21)), "i=21 is the first fully-available window");
  assert.equal(volWindowIndices(20, 21, 59), null);
});

test("expanding cut-points depend only on earlier periods; full-sample ones do not", () => {
  // The distinction the report rests on. Truncating the panel's LATER periods must leave the expanding
  // labels of the earlier ones untouched, while full-sample labels may move.
  const { panel } = regimePanel({ bars: 400, calm: 200 });
  const all = nonOverlappingStarts(60, HOLD, 390);
  const head = all.slice(0, Math.floor(all.length / 2));

  const expAll = classifyPeriods(panel, all, { mode: "expanding", minHistory: 5 });
  const expHead = classifyPeriods(panel, head, { mode: "expanding", minHistory: 5 });
  assert.deepEqual(expHead.labels, expAll.labels.slice(0, head.length),
    "expanding labels changed when later periods were removed — they are not pre-decision");

  const fullAll = classifyPeriods(panel, all, { mode: "full" });
  const fullHead = classifyPeriods(panel, head, { mode: "full" });
  assert.notDeepEqual(fullHead.labels, fullAll.labels.slice(0, head.length),
    "full-sample labels should move with the sample — if not, this panel is too uniform to show it");
});

test("the first periods are UNLABELLED rather than labelled from too little history", () => {
  const { panel } = regimePanel({ bars: 400, calm: 200 });
  const starts = nonOverlappingStarts(60, HOLD, 390);
  const c = classifyPeriods(panel, starts, { mode: "expanding", minHistory: MIN_HISTORY });
  for (let p = 0; p < MIN_HISTORY; p++) {
    assert.equal(c.labels[p], STATE.UNLABELLED, `period ${p} was labelled before ${MIN_HISTORY} periods of history`);
  }
  assert.ok(c.labels.slice(MIN_HISTORY).some((l) => l !== STATE.UNLABELLED), "nothing was ever labelled");
});

test("a calm-then-violent panel never labels a violent period LOW, and mostly labels it HIGH", () => {
  // THE SANITY CHECK, with the right expectation. Terciles are EQUAL-SIZED by construction, so if more
  // than a third of periods are violent then some violent ones MUST land in MID — an earlier version of
  // this test asserted every late period was HIGH, which contradicts an equal-tercile split rather than
  // revealing a classifier fault. What must hold is the ordering: a violent period is never LOW.
  const { panel } = regimePanel({ bars: 400, calm: 200, calmMove: 0.001, wildMove: 0.04 });
  const starts = nonOverlappingStarts(60, HOLD, 390);
  const c = classifyPeriods(panel, starts, { mode: "full" });
  const late = starts.map((i, p) => ({ i, l: c.labels[p] })).filter((x) => x.i > 240);
  assert.ok(late.length > 5, "need some late periods to check");
  assert.ok(late.every((x) => x.l !== STATE.LOW),
    `a violent period was labelled LOW: ${late.filter((x) => x.l === STATE.LOW).map((x) => x.i).join(",")}`);
  assert.ok(late.filter((x) => x.l === STATE.HIGH).length / late.length > 0.4,
    "fewer than 40% of violent periods were HIGH — the classifier is not tracking volatility");

  // And the converse ordering: calm periods are never HIGH.
  const early = starts.map((i, p) => ({ i, l: c.labels[p] })).filter((x) => x.i < 170);
  assert.ok(early.length > 5);
  assert.ok(early.every((x) => x.l !== STATE.HIGH),
    `a calm period was labelled HIGH: ${early.filter((x) => x.l === STATE.HIGH).map((x) => x.i).join(",")}`);

  // Mean volatility must actually differ between the halves, or the fixture proves nothing.
  const vol = (i) => trailingVol(panel, i, VOL_WINDOW);
  const calmVols = starts.filter((i) => i < 170).map(vol).filter(Number.isFinite);
  const wildVols = starts.filter((i) => i > 240).map(vol).filter(Number.isFinite);
  assert.ok(Math.min(...wildVols) > Math.max(...calmVols),
    "the fixture's regimes overlap, so the label assertions above would be vacuous");
});

// ---- degenerate and sparse behaviour -----------------------------------------------------------

test("trailingVol returns null rather than averaging a short window", () => {
  const { panel } = regimePanel({ bars: 100, calm: 100 });
  assert.equal(trailingVol(panel, 5, 21), null, "an incomplete window must not be averaged");
  assert.equal(trailingVol(panel, 99999, 21), null, "an index past the panel must not be measured");
  assert.ok(Number.isFinite(trailingVol(panel, 30, 21)));
  for (const bad of [-1, 1.5, NaN, "20"]) assert.throws(() => trailingVol(panel, bad, 21), /i must be/);
  for (const bad of [0, 1, -5, 2.5, "21"]) assert.throws(() => trailingVol(panel, 30, bad), /window must be/);
});

test("terciles refuses to split fewer than three values", () => {
  assert.equal(terciles([]), null);
  assert.equal(terciles([1]), null);
  assert.equal(terciles([1, 2]), null);
  assert.ok(terciles([1, 2, 3]));
  assert.equal(terciles([1, 2, NaN, null]), null, "non-finite values must not pad the count");
});

test("a sparse state reports SPARSE and NO sigma, rather than a number from one period", () => {
  // A sigma from a single period is not a small sample, it is an unmeasurable one — and sd of a
  // one-period draw is not zero but it is meaningless, so the guard is on the period count.
  const { panel, barDates } = regimePanel({ bars: 400, calm: 200 });
  const poolFor = () => panel.names;
  for (const n of [0, 1]) {
    const starts = nonOverlappingStarts(300, HOLD, 390).slice(0, n);
    const m = measureStates(panel, poolFor, starts, { draws: 100, seed: 1 });
    assert.equal(m.sparse, true, `${n} periods must be reported sparse`);
    assert.equal(m.sd, null, "a sparse state must report no sigma at all");
    assert.equal(m.periods, n);
  }
  // Two periods is the documented minimum and does produce a figure.
  const ok = measureStates(panel, poolFor, nonOverlappingStarts(300, HOLD, 390).slice(0, MIN_PERIODS_PER_STATE),
    { draws: 200, seed: 1 });
  assert.equal(ok.sparse, false);
  assert.ok(Number.isFinite(ok.sd));
  void barDates;
});

test("an unknown classification mode throws rather than defaulting silently", () => {
  const { panel } = regimePanel({ bars: 200, calm: 200 });
  const starts = nonOverlappingStarts(60, HOLD, 190);
  assert.throws(() => classifyPeriods(panel, starts, { mode: "tercile-ish" }), /unknown mode/);
});

test("per-state seeds are distinct, so two states cannot share a Monte Carlo stream", () => {
  // A first version derived the offset from `state.length * 13`, and "low" and "mid" are both three
  // characters — so two states ran on one stream and their sigmas were correlated by construction.
  const vals = Object.values(STATE_SEED);
  assert.equal(new Set(vals).size, vals.length, "two states share a seed offset");
  assert.equal(vals.length, 3);
  assert.notEqual("low".length * 13, STATE_SEED[STATE.LOW] - 0, "the offset must not be derived from the label");
});

// ---- the real panel and the report -------------------------------------------------------------

test("on the real panel every state has periods and none is sparse at the default window", () => {
  const g = loadGrids("sp500-bundle");
  const starts = nonOverlappingStarts(FIRST_START, HOLD, g.panel.dates.length);
  const c = classifyPeriods(g.panel, starts, { window: VOL_WINDOW, mode: "expanding" });
  const counts = [STATE.LOW, STATE.MID, STATE.HIGH].map((st) => (c.byState.get(st) ?? []).length);
  for (const n of counts) assert.ok(n >= MIN_PERIODS_PER_STATE, `a state had only ${n} periods`);
  // The three labelled states plus the unlabelled head must account for every period.
  const total = counts.reduce((a, b) => a + b, 0) + (c.byState.get(STATE.UNLABELLED) ?? []).length;
  assert.equal(total, starts.length, "periods went missing between classification and the state map");
  assert.equal((c.byState.get(STATE.UNLABELLED) ?? []).length, MIN_HISTORY);
});

test("the report is deterministic, labels itself exploratory, and refuses a risk reading", () => {
  const run = () => execFileSync("node", [path.join(REPO, "regime-null.mjs"), "300"],
    { cwd: REPO, stdio: "pipe", encoding: "utf8", timeout: 900000 });
  const out = run();
  assert.equal(out, run(), "the report is not deterministic at a fixed draw count");

  const header = out.slice(0, out.indexOf("=== 0."));
  assert.match(header, /EXPLORATORY PLANNING ANALYSIS/);
  assert.match(header, /RANDOM-VS-RANDOM PROXY/);
  assert.match(header, /NOT edge evidence/);
  assert.match(header, /NOT GROUNDS TO LOOSEN A DRAWDOWN BRAKE/);

  // The resolution statement is what stops a flat column reading as "no dependence".
  assert.match(out, /RESOLUTION, WHICH DECIDES WHAT A FLAT RESULT MEANS/);
  assert.match(out, /NOT 'no\s*\n?\s*dependence'/);
  // Both threshold rules are shown, and the non-pre-decision one is labelled as such.
  assert.match(out, /expanding/);
  assert.match(out, /NOT pre-decision/);
  // Period counts accompany every figure.
  assert.match(out, /periods\s+drawn/);
});

test("the report refuses a panel too short to split three ways", () => {
  // Regime conditioning divides an already-small sample, so the refusal threshold is higher than the two
  // periods an unconditional measurement needs: MIN_HISTORY + 3 * MIN_PERIODS_PER_STATE.
  //
  // 280 bars gives 279 return dates, so after the 252-date warm-up only 5 non-overlapping 5-day periods
  // remain — well under the threshold. An earlier version of this test used 400 bars, which yields 29
  // periods and MEASURES rather than refusing, so it asserted nothing.
  const needed = MIN_HISTORY + 3 * MIN_PERIODS_PER_STATE;
  assert.equal(nonOverlappingStarts(FIRST_START, HOLD, 279).length, 5);
  assert.ok(5 < needed, `the fixture must be below the ${needed}-period threshold`);

  const box = fs.mkdtempSync(path.join(os.tmpdir(), "regime-short-"));
  const root = path.join(box, "short");
  fs.mkdirSync(path.join(root, "1440"), { recursive: true });
  for (let k = 0; k < 4; k++) {
    const rows = ["time,open,high,low,close,volume"];
    for (let i = 0; i < 280; i++) {
      const px = 100 * (1 + 0.0004 * (k + 1)) ** i;
      rows.push(`${1_600_000_000 + i * DAY},${px},${px * 1.01},${px * 0.99},${px},1000000`);
    }
    fs.writeFileSync(path.join(root, "1440", `S${k}.csv`), rows.join("\n") + "\n");
  }

  let status = 0, out = "";
  try {
    out = execFileSync("node", [path.join(REPO, "regime-null.mjs"), "100", "--root", root],
      { cwd: REPO, stdio: "pipe", encoding: "utf8", timeout: 900000 });
  } catch (e) { status = e.status; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }

  assert.equal(status, 2, `a short panel must exit 2, got ${status}\n${out.slice(0, 600)}`);
  assert.match(out, /UNAVAILABLE: INSUFFICIENT HISTORY/);
  assert.match(out, /NO SIGMA IS REPORTED/);
  assert.doesNotMatch(out, /sigma\/period/);
});
