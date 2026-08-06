import test from "node:test";
import assert from "node:assert/strict";
import { runTournament } from "./tournament.mjs";

test("tournament reports no promotion when its data gate cannot be met", () => {
  const report = runTournament({ watchlist: [] });
  // `h3` entry family was added to the tournament, update expected count
  assert.equal(report.result.rows.length, 11);
  assert.equal(report.result.rows.every((row) => !row.promoted), true);
});
