import test from "node:test";
import assert from "node:assert/strict";
import { expand, fmt } from "./sweep.mjs";

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
