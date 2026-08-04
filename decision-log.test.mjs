import test from "node:test";
import assert from "node:assert/strict";
import { getRecentDecisions, recordDecision, resetDecisionLogForTests } from "./logger.js";

test("decision log records the required fields and sanitizes non-finite values", () => {
  resetDecisionLogForTests();
  const record = recordDecision({
    symbol: "BTC", timeframe: "4h", taken: true, reason: "signal",
    entry: 100, stop: 95, takeProfit: 120, risk: 5, regime: { "4h": "bull" },
    mode: "anticipation", bad: Infinity
  }, { now: () => "2026-08-04T00:00:00.000Z" });

  assert.deepEqual(record, {
    type: "asset_decision", ts: "2026-08-04T00:00:00.000Z", symbol: "BTC",
    timeframe: "4h", taken: true, reason: "signal", entry: 100, stop: 95,
    takeProfit: 120, risk: 5, regime: { "4h": "bull" }, mode: "anticipation"
  });
  assert.deepEqual(getRecentDecisions(), [record]);
});

test("decision log sink failures never affect the caller or trade decision", () => {
  resetDecisionLogForTests();
  const record = recordDecision({ symbol: "ETH", reason: "no signal" }, { sink: () => { throw new Error("disk unavailable"); } });
  assert.equal(record.symbol, "ETH");
  assert.equal(record.taken, false);
  assert.equal(getRecentDecisions()[0].reason, "no signal");
});

test("decision log is bounded and retains the newest decisions", () => {
  resetDecisionLogForTests();
  for (let i = 0; i < 505; i++) recordDecision({ symbol: `A${i}`, reason: "scan" });
  const records = getRecentDecisions();
  assert.equal(records.length, 500);
  assert.equal(records[0].symbol, "A5");
  assert.equal(records.at(-1).symbol, "A504");
});
