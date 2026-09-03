import test from "node:test";
import assert from "node:assert/strict";
import { expand, fmt, inertAxes } from "./sweep.mjs";

test("expand produces the full cross product", () => {
  assert.equal(expand({ a: [1, 2, 3], b: ["x", "y"] }).length, 6);
  assert.deepEqual(expand({}), [{}]);
});

test("expand keeps later axes varying fastest, so a log reads in blocks", () => {
  const rows = expand({ a: [1, 2], b: ["x", "y"] });
  assert.deepEqual(rows.map((r) => `${r.a}${r.b}`), ["1x", "1y", "2x", "2y"]);
});

test("an empty axis is an error, not a silently dropped dimension", () => {
  assert.throws(() => expand({ a: [] }), /non-empty/);
});

test("fmt marks a ruined row so a small balance is never read as a survivor", () => {
  const out = fmt([{ config: { tpR: 4 }, trades: 9, finalBalance: 0.0001, effectivelyRuined: true }], ["tpR"]);
  assert.match(out, /RUINED/);
});

test("an object-valued axis renders as its spec, not as [object Object]", () => {
  // The filter sweeps have specs for axis values. String(spec) collapsed every distinct row to the
  // same text, so the table could not say which filter won.
  const out = fmt([
    { config: { filters: { adx: { min: 20 } } }, trades: 5, finalBalance: 1200 },
    { config: { filters: { adx: { min: 30 } } }, trades: 4, finalBalance: 1100 },
  ], ["filters"]);
  assert.match(out, /\{"adx":\{"min":20\}\}/);
  assert.doesNotMatch(out, /\[object Object\]/);
});

test("an axis that changes nothing is named, not left to look like a swept dimension", () => {
  // Four real cases so far: stopMode outside "anticipate", alignMode outside "bos"/"anticipate",
  // the swing window for breakout, and trailStartR below trailR. Each produced a block of
  // identical rows that read as evidence the parameter had been tested.
  const rows = [];
  for (const live of [1, 2]) for (const dead of ["a", "b", "c"]) {
    rows.push({ config: { live, dead }, finalBalance: 1000 * live });
  }
  assert.deepEqual(inertAxes(rows, { live: [1, 2], dead: ["a", "b", "c"] }), ["dead"]);
});

test("a single-valued axis is not called inert -- it was never varied", () => {
  const rows = [{ config: { only: 1, x: 1 }, finalBalance: 10 }, { config: { only: 1, x: 2 }, finalBalance: 20 }];
  assert.deepEqual(inertAxes(rows, { only: [1], x: [1, 2] }), []);
});
