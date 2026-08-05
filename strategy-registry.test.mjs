/**
 * strategy-registry.test.mjs — the router must always answer, and answer honestly.
 *
 * These tests encode the two properties that make the registry safe to put in front of a
 * live entry path: it never refuses to trade, and it never overstates what is known. The
 * negative-expectancy assertion is deliberate — if a future edit starts reporting a
 * positive edge without new sealed evidence, this suite fails rather than the bot quietly
 * trading on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectStrategy, hasValidatedStrategy, REGISTRY, RISK_MULTIPLIER } from "./strategy-registry.mjs";

const ASSETS = ["BTC", "ETH", "SOL", "DOGE", "TAO"];
const REGIMES = ["bull", "bear", "flat"];
const TIMEFRAMES = ["1h", "4h", "1d"];

test("router always returns a strategy — cajh trades when enabled", () => {
  for (const asset of ASSETS) {
    for (const regime of REGIMES) {
      for (const timeframe of TIMEFRAMES) {
        const s = selectStrategy({ asset, regime, timeframe });
        assert.ok(s && s.strategyId, `no strategy for ${asset}/${regime}/${timeframe}`);
        assert.ok(s.riskMultiplier > 0, "risk multiplier must be positive — sizing down, never refusing");
        assert.ok(s.reason && s.reason.length > 0, "every choice must carry a reason");
      }
    }
  }
});

test("an uncovered cell still trades, at minimum size, on the simplest default", () => {
  // 4h has no registry entry, so nothing covers it.
  const s = selectStrategy({ asset: "BTC", regime: "bull", timeframe: "4h" });
  assert.equal(s.confidence, "unknown");
  assert.equal(s.riskMultiplier, RISK_MULTIPLIER.unknown);
  assert.equal(s.strategyId, "daily-trend-gated-atr", "fallback should be the most robust rule");
  assert.match(s.reason, /Absence of evidence is not evidence of edge/);
});

test("a KILLED strategy can never be selected", () => {
  const killed = REGISTRY.filter((e) => e.evidence.verdict === "KILLED").map((e) => e.id);
  assert.ok(killed.includes("hourly-ungated"), "expected the 1h ungated rule to be recorded as KILLED");
  for (const asset of ASSETS) {
    for (const regime of REGIMES) {
      for (const timeframe of TIMEFRAMES) {
        const { strategyId } = selectStrategy({ asset, regime, timeframe });
        assert.ok(!killed.includes(strategyId),
          `router selected a KILLED strategy (${strategyId}) for ${asset}/${regime}/${timeframe}`);
      }
    }
  }
});

test("confidence maps to size, and nothing is validated yet", () => {
  // The whole point: no PASS exists, so nothing may claim full risk.
  assert.equal(hasValidatedStrategy(), false,
    "a PASS appeared in the registry — if that is real, this assertion should be updated " +
    "deliberately along with the evidence, not silently");
  for (const asset of ASSETS) {
    for (const regime of REGIMES) {
      for (const timeframe of TIMEFRAMES) {
        const s = selectStrategy({ asset, regime, timeframe });
        assert.notEqual(s.confidence, "validated");
        assert.ok(s.riskMultiplier <= RISK_MULTIPLIER.relative,
          "without a PASS no cell may size above the relative tier");
      }
    }
  }
});

test("expectedEdge is reported as measured, including when negative", () => {
  const s = selectStrategy({ asset: "BTC", regime: "bear", timeframe: "1d" });
  assert.equal(typeof s.expectedEdge, "number");
  assert.ok(Number.isFinite(s.expectedEdge));
  // The best available option in a bear regime is still a loser; that must not be hidden.
  assert.ok(s.expectedEdge < 0,
    "the bear-regime choice is measured negative; rounding it up would be dishonest");
  assert.equal(s.expectedEdge, -0.107, "must match the ROADMAP measurement exactly");
});

test("ranking honours the measured orderings: 1d beats 1h, trending prefers the trail", () => {
  const daily = selectStrategy({ asset: "BTC", regime: "bear", timeframe: "1d" });
  const hourly = selectStrategy({ asset: "BTC", regime: "bear", timeframe: "1h" });
  // 1h's only entry is KILLED, so it falls back rather than using the -0.529 rule.
  assert.notEqual(hourly.strategyId, "hourly-ungated");
  assert.ok(daily.expectedEdge > -0.529, "1d must outrank the measured 1h result");

  const trending = selectStrategy({ asset: "BTC", regime: "bull", timeframe: "1d" });
  assert.equal(trending.strategyId, "daily-trend-gated-trailing",
    "in a trending regime the uncapped trailing exit is the better measured option");
  assert.equal(trending.params.trailR, 3);
});

test("every registry entry carries provenance", () => {
  for (const e of REGISTRY) {
    for (const field of ["study", "statistic", "value", "n", "verdict", "commit"]) {
      assert.ok(e.evidence[field] !== undefined && e.evidence[field] !== null,
        `entry ${e.id} missing evidence.${field}`);
    }
    assert.ok(typeof e.evidence.value === "number" && Number.isFinite(e.evidence.value));
    assert.ok(typeof e.evidence.n === "number" && e.evidence.n > 0);
  }
});
