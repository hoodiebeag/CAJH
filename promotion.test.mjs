import assert from "node:assert/strict";
import test from "node:test";
import { promotionGate, breakevenWinRate, GATE_SCHEMA, GATE_DEFAULTS } from "./promotion.mjs";

/** A candidate that clears every condition — the only shape from which PASS is reachable. */
const PASSING = Object.freeze({
  id: "CANDIDATE-X",
  preregistration: { id: "PREREG-X", hypothesis: "X beats its matched null", gate: "lo95 > 0 and n >= 150" },
  netAvgR: 0.35,
  costBasis: { feeRate: 0.008, slipPct: 0.0005, source: "Kraken published taker schedule, 2026-08" },
  winRate: 0.55,
  realisedRewardRisk: 1.2,
  winRateMargin: 0.03,
  winRateMarginPreRegistered: true,
  clusteredCI: { lo: 0.08, hi: 0.61, clusterAware: true },
  fdrQ: 0.02,
  familySize: 22,
  effectiveN: 210,
  requiredN: 150,
  matchedNull: { p: 0.004, excessOverNull: 0.19, draws: 2000 },
  buyAndHoldPerTradeR: 0.11,
  maxDrawdownR: 4.2,
  drawdownCeilingR: 8,
  drawdownCeilingPreRegistered: true,
  worstLosingStreak: 7,
  outOfSample: { window: "2025-07-01/2026-08-19", netAvgR: 0.28, usedForFittingOrSelection: false },
});

const ids = (list) => list.map((x) => x.id);
const byId = (res, id) => res.conditions.find((c) => c.id === id);

// ---------- shape ----------

test("the gate scores exactly ten conditions and reports each one's source", () => {
  const res = promotionGate(PASSING);
  assert.equal(res.schema, GATE_SCHEMA);
  assert.equal(res.conditions.length, 10);
  assert.deepEqual(res.conditions.map((c) => c.id), [
    "pre_registration", "positive_net_expectancy", "win_rate_margin", "interval_excludes_zero",
    "survives_multiplicity", "sample_sufficient", "beats_matched_null", "beats_baseline_controls",
    "survivable", "out_of_sample",
  ]);
  for (const c of res.conditions) {
    assert.ok(c.source && c.requirement && c.reason, `${c.id} is missing source, requirement, or reason`);
  }
});

test("a fully evidenced candidate passes, and the summary says what a pass does not mean", () => {
  const res = promotionGate(PASSING);
  assert.equal(res.verdict, "PASS", JSON.stringify(res.failed.concat(res.blocked)));
  assert.equal(res.passed.length, 10);
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.blocked, []);
  assert.match(res.summary, /D1 research bar only/);
  assert.match(res.summary, /D3 human gate/);
});

// ---------- BLOCKED is not a soft pass ----------

test("an empty candidate is BLOCKED on all ten, and the summary says it is not a pass", () => {
  const res = promotionGate({});
  assert.equal(res.verdict, "BLOCKED");
  assert.equal(res.blocked.length, 10);
  assert.equal(res.passed.length, 0);
  assert.match(res.summary, /This is not a pass/);
});

test("any single missing input blocks its own condition and blocks the verdict", () => {
  for (const field of [
    "preregistration", "netAvgR", "costBasis", "winRate", "realisedRewardRisk", "winRateMargin",
    "clusteredCI", "fdrQ", "familySize", "effectiveN", "requiredN", "matchedNull",
    "buyAndHoldPerTradeR", "maxDrawdownR", "drawdownCeilingR", "worstLosingStreak", "outOfSample",
  ]) {
    const c = { ...PASSING };
    delete c[field];
    const res = promotionGate(c);
    assert.equal(res.verdict, "BLOCKED", `omitting ${field} did not block the verdict`);
    assert.ok(res.blocked.length > 0, `omitting ${field} produced no blocked condition`);
  }
});

test("a required threshold cannot be satisfied by leaving it out — there is no permissive default", () => {
  assert.equal("minEffectiveN" in GATE_DEFAULTS, false);
  assert.equal("minWinRateMargin" in GATE_DEFAULTS, false);
  const noRequiredN = { ...PASSING };
  delete noRequiredN.requiredN;
  assert.equal(byId(promotionGate(noRequiredN), "sample_sufficient").status, "blocked");
  const noMargin = { ...PASSING };
  delete noMargin.winRateMargin;
  assert.equal(byId(promotionGate(noMargin), "win_rate_margin").status, "blocked");
});

test("a failure outranks a block — an evidenced failure is reported as FAIL, not BLOCKED", () => {
  const c = { ...PASSING, netAvgR: -0.1 };
  delete c.worstLosingStreak;
  const res = promotionGate(c);
  assert.equal(res.verdict, "FAIL");
  assert.ok(ids(res.failed).includes("positive_net_expectancy"));
  assert.ok(ids(res.blocked).includes("survivable"));
});

// ---------- each condition fails for its own stated reason ----------

test("a gate written after the result is not a pre-registration", () => {
  const res = promotionGate({ ...PASSING, preregistration: { ...PASSING.preregistration, registeredAfterResult: true } });
  assert.equal(res.verdict, "FAIL");
  assert.match(byId(res, "pre_registration").reason, /after the result was seen/);
});

test("a pre-registration without a falsifiable gate fails", () => {
  const res = promotionGate({ ...PASSING, preregistration: { id: "P", hypothesis: "h" } });
  assert.equal(byId(res, "pre_registration").status, "fail");
});

test("an uncited cost basis blocks net expectancy rather than passing it", () => {
  const res = promotionGate({ ...PASSING, costBasis: { feeRate: 0.008, slipPct: 0.0005 } });
  assert.equal(res.verdict, "BLOCKED");
  assert.match(byId(res, "positive_net_expectancy").reason, /no cited source/);
});

test("zero net expectancy is a failure, not a pass — the bar is strictly above zero", () => {
  const res = promotionGate({ ...PASSING, netAvgR: 0 });
  assert.equal(byId(res, "positive_net_expectancy").status, "fail");
});

test("breakevenWinRate is 1/(1+R) and is undefined where R makes it meaningless", () => {
  assert.equal(breakevenWinRate(1), 0.5);
  assert.equal(breakevenWinRate(3), 0.25);
  assert.equal(breakevenWinRate(-1), null);
  assert.equal(breakevenWinRate(NaN), null);
});

test("a win rate a whisker above breakeven fails once the pre-registered margin is applied", () => {
  // Breakeven at R=1.2 is 0.4545; 0.46 clears it raw but not with a 3-point margin.
  const res = promotionGate({ ...PASSING, winRate: 0.46 });
  assert.equal(byId(res, "win_rate_margin").status, "fail");
  assert.match(byId(res, "win_rate_margin").reason, /does not clear breakeven/);
});

test("a margin chosen after scoring fails outright", () => {
  const res = promotionGate({ ...PASSING, winRateMarginPreRegistered: false });
  assert.equal(byId(res, "win_rate_margin").status, "fail");
  assert.match(byId(res, "win_rate_margin").reason, /after the holdout was scored/);
});

test("an interval touching zero fails", () => {
  assert.equal(byId(promotionGate({ ...PASSING, clusteredCI: { lo: 0, hi: 0.6, clusterAware: true } }), "interval_excludes_zero").status, "fail");
  assert.equal(byId(promotionGate({ ...PASSING, clusteredCI: { lo: -0.02, hi: 0.6, clusterAware: true } }), "interval_excludes_zero").status, "fail");
});

test("a position-blocked interval is blocked, not accepted — the audit's correction is enforced", () => {
  const res = promotionGate({ ...PASSING, clusteredCI: { lo: 0.08, hi: 0.61, clusterAware: false } });
  assert.equal(res.verdict, "BLOCKED");
  assert.match(byId(res, "interval_excludes_zero").reason, /cluster-aware/);
});

test("q past the threshold fails, and the family size is reported with it", () => {
  const res = promotionGate({ ...PASSING, fdrQ: 0.17, familySize: 105 });
  assert.equal(byId(res, "survives_multiplicity").status, "fail");
  assert.match(byId(res, "survives_multiplicity").reason, /family of 105/);
});

test("effective sample below required fails, even when the nominal count would clear it", () => {
  // ma_dip's own numbers: 300 nominal trades, 104 effective, against a required 150.
  const res = promotionGate({ ...PASSING, effectiveN: 104, requiredN: 150 });
  assert.equal(byId(res, "sample_sufficient").status, "fail");
  assert.match(byId(res, "sample_sufficient").reason, /effective n 104 is below required 150/);
});

test("failing to beat its own matched null fails, whatever the raw average was", () => {
  // The geometry finding as a gate case: a positive family average sitting inside a positive null.
  const res = promotionGate({ ...PASSING, netAvgR: 0.1637, matchedNull: { p: 0.51, excessOverNull: -0.002, draws: 2000 } });
  assert.equal(byId(res, "beats_matched_null").status, "fail");
  assert.match(byId(res, "beats_matched_null").reason, /does not exceed its own null/);
});

test("an excess over the null that sits inside the null's spread still fails", () => {
  const res = promotionGate({ ...PASSING, matchedNull: { p: 0.22, excessOverNull: 0.05, draws: 2000 } });
  assert.equal(byId(res, "beats_matched_null").status, "fail");
  assert.match(byId(res, "beats_matched_null").reason, /within the null's spread/);
});

test("a null with no usable draws is blocked, not scored", () => {
  const res = promotionGate({ ...PASSING, matchedNull: { p: 1, excessOverNull: 0.2, draws: 0 } });
  assert.equal(byId(res, "beats_matched_null").status, "blocked");
});

test("losing to buy-and-hold fails even with a positive expectancy", () => {
  const res = promotionGate({ ...PASSING, netAvgR: 0.05, buyAndHoldPerTradeR: 0.2 });
  assert.equal(byId(res, "beats_baseline_controls").status, "fail");
  assert.match(byId(res, "beats_baseline_controls").reason, /does not beat buy-and-hold/);
});

test("a negative expectancy loses to always-flat and says so", () => {
  const res = promotionGate({ ...PASSING, netAvgR: -0.3 });
  assert.match(byId(res, "beats_baseline_controls").reason, /loses to always-flat/);
});

test("drawdown past its ceiling fails, and an unstated losing streak blocks", () => {
  assert.equal(byId(promotionGate({ ...PASSING, maxDrawdownR: 12 }), "survivable").status, "fail");
  assert.equal(byId(promotionGate({ ...PASSING, drawdownCeilingPreRegistered: false }), "survivable").status, "fail");
  const c = { ...PASSING }; delete c.worstLosingStreak;
  assert.match(byId(promotionGate(c), "survivable").reason, /worst losing streak/);
});

test("a holdout that was used to select the candidate is not a holdout", () => {
  const res = promotionGate({ ...PASSING, outOfSample: { ...PASSING.outOfSample, usedForFittingOrSelection: true } });
  assert.equal(byId(res, "out_of_sample").status, "fail");
});

test("citing an already-spent sealed pool blocks rather than passes", () => {
  const res = promotionGate({
    ...PASSING,
    outOfSample: { sealedSymbols: ["AVAX", "LINK"], netAvgR: 0.3 },
    sealedPoolAvailable: false,
  });
  assert.equal(res.verdict, "BLOCKED");
  assert.match(byId(res, "out_of_sample").reason, /already spent/);
});

test("an out-of-sample arm with no stated basis is blocked", () => {
  const res = promotionGate({ ...PASSING, outOfSample: { netAvgR: 0.3 } });
  assert.equal(byId(res, "out_of_sample").status, "blocked");
});

test("a negative out-of-sample arm fails", () => {
  const res = promotionGate({ ...PASSING, outOfSample: { window: "w", netAvgR: -0.05 } });
  assert.equal(byId(res, "out_of_sample").status, "fail");
});

// ---------- thresholds ----------

test("thresholds are overridable per run and are echoed in the result", () => {
  const strict = promotionGate({ ...PASSING, fdrQ: 0.03 }, { fdrQ: 0.01 });
  assert.equal(byId(strict, "survives_multiplicity").status, "fail");
  assert.equal(strict.thresholds.fdrQ, 0.01);
  const loose = promotionGate({ ...PASSING, fdrQ: 0.03 });
  assert.equal(byId(loose, "survives_multiplicity").status, "pass");
});

test("a condition that throws is blocked rather than crashing the gate", () => {
  const res = promotionGate({
    ...PASSING,
    get clusteredCI() { throw new Error("boom"); },
  });
  assert.equal(res.verdict, "BLOCKED");
  assert.match(byId(res, "interval_excludes_zero").reason, /evaluation threw: boom/);
  assert.equal(res.conditions.length, 10, "the remaining conditions were still scored");
});
