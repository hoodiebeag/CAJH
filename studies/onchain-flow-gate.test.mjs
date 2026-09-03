import test from "node:test";
import assert from "node:assert/strict";
import { runOnchainFlowGateStudy } from "./onchain-flow-gate.mjs";

test("classifies an unreachable/unauthenticated flow source precisely instead of silently dropping the asset", async () => {
  const report = await runOnchainFlowGateStudy({
    assets: ["BTC"],
    fetchFlow: async () => ({ available: false, reason: "glassnode-fetch-error: HTTP 401 (no GLASSNODE_API_KEY configured)" }),
  });
  assert.equal(report.input.coverage.length, 1);
  assert.equal(report.input.coverage[0].asset, "BTC");
  assert.equal(report.input.coverage[0].included, false);
  assert.match(report.input.coverage[0].reason, /^glassnode-fetch-error: HTTP 401/);
});

test("classifies flow history shorter than minHistoryDays precisely, reporting the actual coverage", async () => {
  const shortPoints = { available: true, points: [{ time: Date.parse("2026-01-01T00:00:00Z"), value: -100 }, { time: Date.parse("2026-01-31T00:00:00Z"), value: -50 }] };
  const report = await runOnchainFlowGateStudy({
    assets: ["BTC"], minHistoryDays: 730,
    fetchFlow: async () => shortPoints,
  });
  assert.equal(report.result.verdict, "ONCHAIN-DATA-INSUFFICIENT");
  assert.equal(report.input.coverage[0].included, false);
  assert.equal(report.input.coverage[0].reason, "flow-history-short (30.0 of 730 days)");
});

test("reports ONCHAIN-DATA-INSUFFICIENT (not a crash or a silent skip) when any required asset fails the gate", async () => {
  const start = Date.parse("2020-01-01T00:00:00Z");
  const longPoints = { available: true, points: Array.from({ length: 800 }, (_, i) => ({ time: start + i * 86400_000, value: -100 })) };
  const report = await runOnchainFlowGateStudy({
    assets: ["BTC", "ETH"], minHistoryDays: 730,
    fetchFlow: async ({ asset }) => (asset === "BTC" ? longPoints : { available: false, reason: "no data" }),
  });
  assert.equal(report.result.verdict, "ONCHAIN-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 1);
  assert.equal(report.result.requiredAssets, 2);
});
