import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runFundingCashStudy } from "./funding-study.mjs";

test("funding study remains explicitly research-only", async (t) => {
  if (!fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url))) {
    t.skip("candles/XBTUSD.csv absent (no local candle history)");
    return;
  }
  let report;
  try {
    report = await runFundingCashStudy({ splitFraction: .7 });
  } catch (err) {
    if (/aligned BTC\/funding days/.test(err.message)) {
      t.skip(`insufficient aligned BTC/funding history: ${err.message}`);
      return;
    }
    throw err;
  }
  assert.match(report.input.action, /cash/);
  assert.equal(report.result.finalists.length, 5);
});
