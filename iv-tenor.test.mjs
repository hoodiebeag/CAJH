import assert from "node:assert/strict";
import test from "node:test";
import { trailingVol, forwardVol, scoreWindows, CANDIDATE_WINDOWS, PREREGISTERED_CRITERION } from "./iv-tenor.mjs";
import { seededRng } from "./inference.mjs";
import { TRADING_DAYS } from "./vrp.mjs";

function walk(n, sigma = 0.18, seed = 5) {
  const rnd = seededRng(seed);
  const g = () => { const u = Math.max(rnd(), 1e-12), v = Math.max(rnd(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const ds = sigma / Math.sqrt(TRADING_DAYS);
  const p = [100];
  for (let i = 1; i < n; i++) p.push(p[i - 1] * Math.exp(g() * ds));
  return p;
}

test("trailing and forward vol both recover a known sigma over a long window", () => {
  const p = walk(3000, 0.20, 3);
  assert.ok(Math.abs(trailingVol(p, 2600, 2000) - 0.20) < 0.02);
  assert.ok(Math.abs(forwardVol(p, 100, 2000) - 0.20) < 0.02);
});

test("boundaries return null rather than a short-window guess", () => {
  const p = walk(100);
  assert.equal(trailingVol(p, 5, 30), null, "not enough history behind i");
  assert.equal(forwardVol(p, 95, 30), null, "not enough data ahead of i");
});

// ---------- the method must identify a window it is shown ----------

for (const known of [10, 21, 45]) {
  test(`a reference series built as ${known}-day trailing vol is identified as ${known}`, () => {
    // This is the whole validity claim: if the method cannot recover a window it was handed,
    // its answer about IBKR's series is worthless.
    const p = walk(1500, 0.18, 11);
    const reference = p.map((_, i) => trailingVol(p, i, known));
    const res = scoreWindows(reference, p, { direction: "trailing" });
    assert.equal(res.bestByMeanAbsDiff, known, `mean-abs-diff picked ${res.bestByMeanAbsDiff}`);
    assert.equal(res.agree, true, "both criteria should agree on a clean synthetic case");
  });
}

test("a forward-looking reference is identified in the forward direction", () => {
  const p = walk(1500, 0.18, 7);
  const reference = p.map((_, i) => forwardVol(p, i, 21));
  const res = scoreWindows(reference, p, { direction: "forward" });
  assert.equal(res.bestByMeanAbsDiff, 21);
});

test("a reference matching NO candidate window still reports its closest, and the numbers show it", () => {
  // Guards against reading a winner as proof. If IBKR's convention is not in the candidate set,
  // the method still returns something -- the mean-abs-diff column is what reveals a poor fit.
  const p = walk(1500, 0.18, 13);
  const reference = p.map(() => 0.60); // nothing like any realised window here
  const res = scoreWindows(reference, p, { direction: "trailing" });
  assert.ok(res.bestByMeanAbsDiff !== null, "still returns a closest window");
  const best = res.rows.find((r) => r.h === res.bestByMeanAbsDiff);
  assert.ok(best.meanAbsDiff > 0.3, `a poor fit must be visible in the numbers, got ${best.meanAbsDiff}`);
});

test("every candidate window is reported, not just the winner", () => {
  const p = walk(800, 0.18, 2);
  const reference = p.map((_, i) => trailingVol(p, i, 21));
  const res = scoreWindows(reference, p, { direction: "trailing" });
  assert.deepEqual(res.rows.map((r) => r.h), CANDIDATE_WINDOWS);
  for (const r of res.rows.filter((x) => x.usable)) {
    assert.ok(Number.isFinite(r.meanAbsDiff) && Number.isFinite(r.correlation));
  }
});

test("too little data marks a window unusable instead of scoring noise", () => {
  const p = walk(40, 0.18, 4);
  const res = scoreWindows(p.map(() => 0.2), p, { direction: "trailing" });
  assert.ok(res.rows.some((r) => !r.usable));
});

test("the criterion is fixed in the module before any output exists", () => {
  assert.match(PREREGISTERED_CRITERION, /minimising mean absolute difference/);
  assert.match(PREREGISTERED_CRITERION, /before any output exists/);
});
