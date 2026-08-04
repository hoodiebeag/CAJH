import test from "node:test";
import assert from "node:assert/strict";
import { runStrategySearch } from "./strategy-search.mjs";

test("strategy search produces no promotion without eligible data", () => {
  const report = runStrategySearch({ watchlist: [] });
  assert.equal(report.result.finalists.length, 0);
  assert.match(report.result.verdict, /no train-selected/);
});
