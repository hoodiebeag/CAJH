import test from "node:test";
import assert from "node:assert/strict";
import { runFundingCashStudy } from "./funding-study.mjs";

test("funding study remains explicitly research-only", async () => {
  const report = await runFundingCashStudy({ splitFraction: .7 });
  assert.match(report.input.action, /cash/);
  assert.equal(report.result.finalists.length, 5);
});
