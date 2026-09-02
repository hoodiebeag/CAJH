/**
 * promotion.mjs — the promotion gate (Phase 4).
 *
 * WHY THIS EXISTS. `ALPHA_DEFINITION.md` §3 already states the bar, and this project's history
 * is a catalogue of results that read as passes until someone checked one more condition by
 * hand. A gate that a human applies from memory is a gate that gets applied differently each
 * time. This one takes a candidate's measured figures and returns PASS, FAIL or BLOCKED with a
 * machine-readable reason per condition.
 *
 * THE THREE VERDICTS, AND WHY BLOCKED IS SEPARATE FROM FAIL.
 *   PASS    — every condition was evaluated and every one passed.
 *   FAIL    — every condition was evaluated and at least one did not pass.
 *   BLOCKED — at least one condition could not be evaluated at all, and nothing else failed.
 * BLOCKED is not a soft FAIL and it is certainly not a soft PASS. A missing input means the
 * question was never asked, and the gate says so rather than scoring it either way. PASS is
 * unreachable by omission: absent evidence blocks, it never passes.
 *
 * WHERE THE CONDITIONS COME FROM. Conditions 2-6 and 9-10 are `ALPHA_DEFINITION.md` §3's own
 * six, restated one per condition; each carries a `source` field naming its clause. Condition 1
 * is the pre-registration requirement (`AGENT_PROTOCOL.md`, and `registry.mjs` enforces it).
 * Conditions 7 and 8 are the null and baseline controls that this project's own studies have
 * applied since `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL` — a family beating zero is not the same
 * as a family beating an entry with the same geometry and no timing skill, and the geometry
 * null's positive mean is exactly why that distinction decided ten of ten equity families.
 *
 * ONE DELIBERATE DEPARTURE from `ALPHA_DEFINITION.md` as written: §3.3 names `blockBootstrapCI`
 * as the house convention, but `DATE-CLUSTERED-RESAMPLING-AUDIT` showed it blocks by array
 * position with no timestamp awareness, and ma_dip's DJTA-20 interval stopped excluding zero
 * once clustering was accounted for. This gate therefore asks for a CLUSTER-AWARE interval and
 * an EFFECTIVE sample count. That is a stricter reading of the same clause, not a new rule.
 *
 * THIS GATE IS NOT RETROACTIVE. It does not re-score, supersede or annotate any verdict already
 * written in `VERDICTS.md` or `ROADMAP.md`. Those were decided under the conditions stated at
 * the time and stay as they are.
 *
 * IT ALSO PROMOTES NOTHING. A PASS here is the D1 research bar in `SELF_AWARENESS_SPEC.md`.
 * The D1 → D2 → D3 path and the human sign-off at D3 are unchanged and are not expressible in
 * this file.
 */

export const GATE_SCHEMA = "cajh-promotion-gate/v1";

/** Default thresholds. Deliberately only the ones with a house convention behind them: there
 *  is no default win-rate margin and no default required-n, because a default of zero would let
 *  a candidate clear those conditions by not answering them. */
export const GATE_DEFAULTS = Object.freeze({
  fdrQ: 0.05,
  nullP: 0.05,
});

const PASS = "pass", FAIL = "fail", BLOCKED = "blocked";
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Breakeven win rate for a realised reward:risk of `R`: W* = 1 / (1 + R). */
export function breakevenWinRate(realisedR) {
  const r = num(realisedR);
  if (r === null || r <= -1) return null;
  return 1 / (1 + r);
}

function evaluate(id, source, requirement, fn) {
  let outcome;
  try {
    outcome = fn();
  } catch (err) {
    outcome = { status: BLOCKED, reason: `evaluation threw: ${err.message}` };
  }
  return { id, source, requirement, ...outcome };
}

/** A condition whose input is absent is BLOCKED, never quietly passed. */
const needs = (values, what) => {
  const missing = Object.entries(values).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  return missing.length ? { status: BLOCKED, reason: `${what}: missing ${missing.join(", ")}` } : null;
};

/**
 * Score a candidate against the ten conditions.
 *
 * `candidate` carries measured figures, not raw data — this function computes no statistics of
 * its own, so it cannot disagree with the study that produced them. Compute the interval with
 * `inference.clusteredBootstrapCI`, the null with `inference.matchedGeometryNull`, the controls
 * with `inference.alwaysFlatControl` / `buyAndHoldControl`, and the sample figures with
 * `evallib.summarizeTrades`.
 */
export function promotionGate(candidate = {}, options = {}) {
  const cfg = { ...GATE_DEFAULTS, ...options };
  const c = candidate;
  const conditions = [];

  conditions.push(evaluate(
    "pre_registration",
    "AGENT_PROTOCOL.md — research registry; registry.mjs",
    "A pre-registration with a falsifiable gate exists and predates the result.",
    () => {
      const block = needs({ preregistration: c.preregistration ?? null }, "pre-registration");
      if (block) return block;
      const p = c.preregistration;
      if (!p.id || !p.gate || !p.hypothesis) return { status: FAIL, reason: "pre-registration lacks an id, hypothesis, or falsifiable gate" };
      if (p.registeredAfterResult === true) return { status: FAIL, reason: "the gate was written after the result was seen, which is not a pre-registration" };
      return { status: PASS, reason: `pre-registered as ${p.id}`, observed: p.id };
    },
  ));

  conditions.push(evaluate(
    "positive_net_expectancy",
    "ALPHA_DEFINITION.md §3.1",
    "Mean net R > 0, net of a sourced real-world cost basis.",
    () => {
      const netR = num(c.netAvgR);
      const block = needs({ netAvgR: netR, costBasis: c.costBasis ?? null }, "net expectancy");
      if (block) return block;
      if (!c.costBasis.source) return { status: BLOCKED, reason: "cost basis has no cited source; an uncited cost is not a real-world cost" };
      return netR > 0
        ? { status: PASS, reason: `net avg R ${netR} > 0`, observed: netR, required: 0 }
        : { status: FAIL, reason: `net avg R ${netR} is not above zero`, observed: netR, required: 0 };
    },
  ));

  conditions.push(evaluate(
    "win_rate_margin",
    "ALPHA_DEFINITION.md §3.2",
    "Realised win rate exceeds 1/(1+R) by a margin fixed before the holdout was scored.",
    () => {
      const wr = num(c.winRate), realisedR = num(c.realisedRewardRisk);
      const margin = num(c.winRateMargin);
      const block = needs({ winRate: wr, realisedRewardRisk: realisedR, winRateMargin: margin }, "win-rate margin");
      if (block) return block;
      if (c.winRateMarginPreRegistered === false) {
        return { status: FAIL, reason: "the win-rate margin was chosen after the holdout was scored" };
      }
      const breakeven = breakevenWinRate(realisedR);
      if (breakeven === null) return { status: BLOCKED, reason: `realised reward:risk ${realisedR} does not admit a breakeven win rate` };
      const required = breakeven + margin;
      return wr > required
        ? { status: PASS, reason: `win rate ${wr} exceeds breakeven ${breakeven} plus margin ${margin}`, observed: wr, required }
        : { status: FAIL, reason: `win rate ${wr} does not clear breakeven ${breakeven} plus margin ${margin}`, observed: wr, required };
    },
  ));

  conditions.push(evaluate(
    "interval_excludes_zero",
    "ALPHA_DEFINITION.md §3.3, read through DATE-CLUSTERED-RESAMPLING-AUDIT",
    "A cluster-aware 95% CI on holdout mean net R excludes zero.",
    () => {
      const ci = c.clusteredCI ?? null;
      const block = needs({ clusteredCI: ci }, "confidence interval");
      if (block) return block;
      const lo = num(ci.lo), hi = num(ci.hi);
      if (lo === null || hi === null) return { status: BLOCKED, reason: "interval has no finite bounds" };
      if (ci.clusterAware === false) {
        return { status: BLOCKED, reason: "interval is position-blocked, not cluster-aware; recompute with clusteredBootstrapCI" };
      }
      return lo > 0
        ? { status: PASS, reason: `interval [${lo}, ${hi}] excludes zero`, observed: [lo, hi] }
        : { status: FAIL, reason: `interval [${lo}, ${hi}] includes zero`, observed: [lo, hi] };
    },
  ));

  conditions.push(evaluate(
    "survives_multiplicity",
    "ALPHA_DEFINITION.md §3.3; MULTIPLE_COMPARISONS_AUDIT.md",
    "Survives BH-FDR correction across the recorded NHST family.",
    () => {
      const q = num(c.fdrQ), size = num(c.familySize);
      const block = needs({ fdrQ: q, familySize: size }, "multiplicity correction");
      if (block) return block;
      if (size < 1) return { status: BLOCKED, reason: "family size below 1; the correction family was not recorded" };
      return q <= cfg.fdrQ
        ? { status: PASS, reason: `q = ${q} at family size ${size}`, observed: q, required: cfg.fdrQ }
        : { status: FAIL, reason: `q = ${q} exceeds ${cfg.fdrQ} across a family of ${size}`, observed: q, required: cfg.fdrQ };
    },
  ));

  conditions.push(evaluate(
    "sample_sufficient",
    "ALPHA_DEFINITION.md §3.4; effective rather than nominal per DATE-CLUSTERED-RESAMPLING-AUDIT",
    "Effective sample meets the sample size the claim requires.",
    () => {
      const eff = num(c.effectiveN), req = num(c.requiredN);
      const block = needs({ effectiveN: eff, requiredN: req }, "sample size");
      if (block) return block;
      return eff >= req
        ? { status: PASS, reason: `effective n ${eff} meets required ${req}`, observed: eff, required: req }
        : { status: FAIL, reason: `effective n ${eff} is below required ${req}`, observed: eff, required: req };
    },
  ));

  conditions.push(evaluate(
    "beats_matched_null",
    "EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL; inference.matchedGeometryNull",
    "Beats a matched-geometry random-entry null on the same window and cost basis.",
    () => {
      const n = c.matchedNull ?? null;
      const block = needs({ matchedNull: n }, "matched-geometry null");
      if (block) return block;
      const p = num(n.p), excess = num(n.excessOverNull);
      if (p === null || excess === null) return { status: BLOCKED, reason: "null result lacks p or excessOverNull" };
      if (n.draws != null && n.draws === 0) return { status: BLOCKED, reason: "the null produced no usable draws" };
      if (excess <= 0) return { status: FAIL, reason: `does not exceed its own null (excess ${excess}R)`, observed: excess };
      return p <= cfg.nullP
        ? { status: PASS, reason: `beats the matched null (excess ${excess}R, p = ${p})`, observed: p, required: cfg.nullP }
        : { status: FAIL, reason: `excess ${excess}R is within the null's spread (p = ${p})`, observed: p, required: cfg.nullP };
    },
  ));

  conditions.push(evaluate(
    "beats_baseline_controls",
    "inference.alwaysFlatControl / buyAndHoldControl",
    "Beats always-flat and buy-and-hold over the same window, in the same R units.",
    () => {
      const netR = num(c.netAvgR);
      // Buy-and-hold must be supplied per-trade, on the same denominator as the family's own
      // average. A whole-window buy-and-hold figure compared against a per-trade average is a
      // unit mismatch, and it flatters whichever side happens to have fewer trades.
      const perTradeBH = num(c.buyAndHoldPerTradeR);
      const block = needs({ netAvgR: netR, buyAndHoldPerTradeR: perTradeBH }, "baseline controls");
      if (block) return block;
      // The always-flat leg restates condition 2 by construction: beating a control of all
      // zeros IS positive expectancy. Kept explicit rather than implied, not counted as
      // independent evidence.
      if (!(netR > 0)) return { status: FAIL, reason: `loses to always-flat: net avg R ${netR}`, observed: netR };
      return netR > perTradeBH
        ? { status: PASS, reason: `beats always-flat (${netR}R) and buy-and-hold (${perTradeBH}R)`, observed: netR, required: perTradeBH }
        : { status: FAIL, reason: `does not beat buy-and-hold: ${netR}R against ${perTradeBH}R`, observed: netR, required: perTradeBH };
    },
  ));

  conditions.push(evaluate(
    "survivable",
    "ALPHA_DEFINITION.md §3.5",
    "Max drawdown within a pre-registered ceiling, with the worst losing streak stated.",
    () => {
      const dd = num(c.maxDrawdownR), ceiling = num(c.drawdownCeilingR);
      const block = needs({ maxDrawdownR: dd, drawdownCeilingR: ceiling }, "survivability");
      if (block) return block;
      if (c.drawdownCeilingPreRegistered === false) {
        return { status: FAIL, reason: "the drawdown ceiling was set after the drawdown was known" };
      }
      if (c.worstLosingStreak == null) {
        return { status: BLOCKED, reason: "expected worst losing streak not stated; §3.5 requires it explicitly" };
      }
      return dd <= ceiling
        ? { status: PASS, reason: `max drawdown ${dd}R within ceiling ${ceiling}R`, observed: dd, required: ceiling }
        : { status: FAIL, reason: `max drawdown ${dd}R exceeds ceiling ${ceiling}R`, observed: dd, required: ceiling };
    },
  ));

  conditions.push(evaluate(
    "out_of_sample",
    "ALPHA_DEFINITION.md §3.6; SELF_AWARENESS_SPEC.md D1",
    "Reproduced on data not used to fit or select it.",
    () => {
      const oos = c.outOfSample ?? null;
      const block = needs({ outOfSample: oos }, "out-of-sample replication");
      if (block) return block;
      if (!oos.window && !oos.universe && !oos.sealedSymbols) {
        return { status: BLOCKED, reason: "no out-of-sample basis named (window, universe, or sealed symbols)" };
      }
      if (oos.usedForFittingOrSelection === true) {
        return { status: FAIL, reason: "the stated holdout was used to fit or select the candidate" };
      }
      if (oos.sealedSymbols && c.sealedPoolAvailable === false) {
        return { status: BLOCKED, reason: "the sealed pool this cites is already spent; check registry.sealedHoldoutStatus()" };
      }
      const netR = num(oos.netAvgR);
      if (netR === null) return { status: BLOCKED, reason: "out-of-sample arm reports no net average R" };
      return netR > 0
        ? { status: PASS, reason: `holds out of sample at ${netR}R`, observed: netR, required: 0 }
        : { status: FAIL, reason: `does not hold out of sample: ${netR}R`, observed: netR, required: 0 };
    },
  ));

  const failed = conditions.filter((x) => x.status === FAIL);
  const blocked = conditions.filter((x) => x.status === BLOCKED);
  const verdict = failed.length ? "FAIL" : blocked.length ? "BLOCKED" : "PASS";

  return {
    schema: GATE_SCHEMA,
    verdict,
    candidate: c.id ?? null,
    evaluatedAt: new Date().toISOString(),
    thresholds: cfg,
    conditions,
    passed: conditions.filter((x) => x.status === PASS).map((x) => x.id),
    failed: failed.map((x) => ({ id: x.id, reason: x.reason })),
    blocked: blocked.map((x) => ({ id: x.id, reason: x.reason })),
    // The one sentence a report may quote. A PASS here clears the D1 research bar and nothing
    // beyond it; promotion past D1 remains the human-gated path in SELF_AWARENESS_SPEC.md.
    summary: verdict === "PASS"
      ? `PASS: all ${conditions.length} conditions met. This clears the D1 research bar only; D2 and the D3 human gate are unchanged.`
      : verdict === "FAIL"
        ? `FAIL: ${failed.length} of ${conditions.length} conditions not met (${failed.map((x) => x.id).join(", ")}).`
        : `BLOCKED: ${blocked.length} of ${conditions.length} conditions could not be evaluated (${blocked.map((x) => x.id).join(", ")}). This is not a pass.`,
  };
}
