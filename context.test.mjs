import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveContext, formatDecisionForContext } from "./context.js";

test("C2 exposes bounded read-only operational context without secrets", () => {
  const context = buildLiveContext({
    watchlist: [{ symbol: "BTC", id: "XXBTZUSD" }],
    lastScanTime: "2026-08-04T00:00:00.000Z"
  }, { maxChars: 20000 });

  assert.match(context, /open positions:/);
  assert.match(context, /effective safe config:/);
  assert.match(context, /halt state:/);
  assert.match(context, /monitor health:/);
  assert.match(context, /storage health:/);
  assert.match(context, /latest roadmap verdict:/);
  assert.ok(context.length <= 20000);
  assert.doesNotMatch(context, /KRAKEN_API_(KEY|SECRET)|DISCORD_TOKEN|sk-ant-/i);
});

test("C2 does not invent an absent decision or expose source code in live context", () => {
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 1000 });
  assert.match(context, /no persisted decisions yet|durable decision history:/);
  assert.doesNotMatch(context, /===== .*\.js =====|function buildLiveContext/);
  assert.ok(context.includes("[context truncated]") || context.length <= 1000);
});

test("C2 answers skipped-asset questions from recorded asset decisions", () => {
  assert.equal(
    formatDecisionForContext({ type: "asset_decision", ts: "2026-08-04T01:00:00Z", symbol: "BTC", timeframe: "1h", taken: false, reason: "no signal" }),
    "2026-08-04T01:00:00Z: skipped BTC 1h; no signal"
  );
  assert.equal(formatDecisionForContext({ type: "asset_decision", ts: "2026-08-04T01:00:00Z", symbol: "ETH", taken: false }), "2026-08-04T01:00:00Z: skipped ETH unknown timeframe; reason unavailable");
});

test("C2 redacts dynamic token-shaped text in decisions and halt reasons", () => {
  const decision = formatDecisionForContext({ type: "asset_decision", ts: "now", symbol: "BTC", taken: false, reason: "KRAKEN_API_SECRET=supersecret sk-ant-abcdefghijklmnop" });
  assert.doesNotMatch(decision, /supersecret|sk-ant-abcdefghijklmnop/);
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 20000 });
  assert.doesNotMatch(context, /KRAKEN_API_SECRET=supersecret|sk-ant-abcdefghijklmnop/);
});
