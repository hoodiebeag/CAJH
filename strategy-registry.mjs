/**
 * strategy-registry.mjs — which strategy cajh should use, and how much to risk on it.
 *
 * cajh MUST trade when it is enabled; a bot that refuses every entry is not a trading bot.
 * So this module never answers "whether" — it answers **how**: which rule set, on which
 * timeframe, with which exit style, at what size, for a given (asset, regime, timeframe).
 *
 * The honest problem it is built around: **no strategy in this repo has a PASS verdict.**
 * Every research verdict to date is a data-gate kill, the swing entry measures
 * indistinguishable from random, and the daily strategy measured as beta rather than
 * alpha. Picking "the most profitable strategy" per cell from backtests would therefore be
 * selecting noise across ~180 cells — the classic overfitting machine.
 *
 * Two design choices keep it honest instead:
 *
 *   1. **Confidence is expressed as POSITION SIZE, not permission.** Validated evidence
 *      earns full risk; merely-relative evidence earns reduced risk; an unknown cell gets
 *      the minimum and the simplest, most robust default. Sizing is the safety valve, so
 *      weak evidence shrinks exposure rather than blocking the trade.
 *   2. **Ranking uses only measurements this repo actually made**, recorded in ROADMAP.md
 *      with provenance. An entry without provenance throws — an unsourced claim must not
 *      be able to size a real position.
 *
 * `expectedEdge` is reported exactly as measured, including when negative. Nothing here
 * rounds a negative expectancy up to zero: if the best available option for a cell is
 * still losing, the caller is told so and can log it.
 */

/** Confidence tier → fraction of the configured per-trade risk budget. */
export const RISK_MULTIPLIER = Object.freeze({
  validated: 1.00,   // PASS on a sealed holdout, net of cost
  relative:  0.50,   // measurably better than the alternatives, but not proven profitable
  unknown:   0.25,   // no evidence covers this cell — simplest default, minimum size
});

const REQUIRED_PROVENANCE = ["study", "statistic", "value", "n", "verdict", "commit"];

/**
 * The evidence table. Every row is a measurement recorded in ROADMAP.md, not a hypothesis.
 * `verdict` is one of:
 *   PASS     — sealed out-of-sample, net of cost, positive. None exist yet.
 *   RELATIVE — measured better than its alternatives, but not shown profitable outright.
 *   KILLED   — measured and rejected; retained so the router can never re-select it.
 */
export const REGISTRY = Object.freeze([
  {
    id: "daily-trend-gated-atr",
    timeframe: "1d",
    regimes: ["bull", "bear", "flat"],
    assets: "*",
    params: { trendGate: true, trendMa: 20, stopMode: "atr", atrStopK: 3, tpR: 3 },
    rationale: "Best-measured timeframe/gate combination. Daily with the MA20 trend gate " +
               "lost the least per trade of every configuration tested.",
    evidence: {
      study: "regime.mjs + simple.mjs (ROADMAP 2026-07-31)",
      statistic: "net R/trade", value: -0.107, n: 210, p: null,
      netOfCost: true, verdict: "RELATIVE", commit: "174711c",
    },
  },
  {
    id: "daily-trend-gated-trailing",
    timeframe: "1d",
    regimes: ["bull"],
    assets: "*",
    params: { trendGate: true, trendMa: 20, stopMode: "atr", atrStopK: 3, tpR: 99, trailR: 3, trailStartR: 1 },
    rationale: "In trending regimes the fixed target truncated winners: the largest " +
               "uncapped winner ran to 16.9R against a 3.0R cap, and the loose trail " +
               "nearly doubled the trending year (+79R vs +39R).",
    evidence: {
      study: "trail.mjs (ROADMAP 2026-07-31)",
      statistic: "net R/trade (2024 trending year)", value: 1.018, n: 78, p: null,
      netOfCost: true, verdict: "RELATIVE", commit: "0846a61",
    },
  },
  {
    id: "hourly-ungated",
    timeframe: "1h",
    regimes: ["bull", "bear", "flat"],
    assets: "*",
    params: { trendGate: false, stopMode: "structural", tpR: 4 },
    rationale: "Retained only so the router can never choose it: the 1h ungated rule is " +
               "the worst measured configuration.",
    evidence: {
      study: "regime.mjs (ROADMAP 2026-07-31)",
      statistic: "net R/trade", value: -0.529, n: 4931, p: null,
      netOfCost: true, verdict: "KILLED", commit: "9041ea6",
    },
  },
]);

/** The fallback for a cell nothing covers: the most robust rule, at minimum size. */
const DEFAULT_ID = "daily-trend-gated-atr";

function assertProvenance(entry) {
  for (const field of REQUIRED_PROVENANCE) {
    if (entry.evidence?.[field] === undefined || entry.evidence?.[field] === null) {
      if (field === "p") continue;   // p may legitimately be absent for a relative ordering
      throw new Error(
        `Registry entry "${entry.id}" is missing evidence.${field}. An unsourced claim ` +
        `must never be able to size a real position.`
      );
    }
  }
}
REGISTRY.forEach(assertProvenance);

const tierOf = (verdict) =>
  verdict === "PASS" ? "validated" : verdict === "RELATIVE" ? "relative" : null;

const matches = (entry, { asset, regime, timeframe }) =>
  (entry.assets === "*" || entry.assets.includes(asset)) &&
  (!timeframe || entry.timeframe === timeframe) &&
  (!regime || entry.regimes.includes(regime));

/**
 * Rank candidates. Higher is better.
 *   1. tier — a PASS always outranks a merely-relative ordering.
 *   2. measured value — net-of-cost expectancy as actually recorded.
 *   3. sample size — between two similar numbers, trust the one with more observations.
 *   4. simplicity — fewer parameters, because complexity is where overfitting hides.
 */
function rank(a, b) {
  const tierRankOf = (e) => (tierOf(e.evidence.verdict) === "validated" ? 2 : 1);
  if (tierRankOf(a) !== tierRankOf(b)) return tierRankOf(b) - tierRankOf(a);
  if (a.evidence.value !== b.evidence.value) return b.evidence.value - a.evidence.value;
  if (a.evidence.n !== b.evidence.n) return b.evidence.n - a.evidence.n;
  return Object.keys(a.params).length - Object.keys(b.params).length;
}

/**
 * Choose how to trade this cell. ALWAYS returns a strategy — cajh trades when enabled.
 *
 * @returns {{strategyId, params, timeframe, expectedEdge, confidence, riskMultiplier,
 *            evidence, reason}}
 *   `expectedEdge` is the measured net-of-cost expectancy, reported unmodified — it is
 *   negative for every cell today, and callers are expected to log that truthfully.
 */
export function selectStrategy({ asset, regime = null, timeframe = null } = {}) {
  const eligible = REGISTRY
    .filter((e) => tierOf(e.evidence.verdict) !== null)   // KILLED can never be selected
    .filter((e) => matches(e, { asset, regime, timeframe }))
    .sort(rank);

  const chosen = eligible[0] ?? REGISTRY.find((e) => e.id === DEFAULT_ID);
  const covered = eligible.length > 0;
  const confidence = covered ? tierOf(chosen.evidence.verdict) : "unknown";

  return {
    strategyId: chosen.id,
    params: { ...chosen.params },
    timeframe: chosen.timeframe,
    expectedEdge: chosen.evidence.value,
    confidence,
    riskMultiplier: RISK_MULTIPLIER[confidence],
    evidence: { ...chosen.evidence },
    reason: covered
      ? `${chosen.id}: best measured option for ${timeframe ?? "any"}/${regime ?? "any"} ` +
        `(${chosen.evidence.statistic} ${chosen.evidence.value}, n=${chosen.evidence.n}, ` +
        `${chosen.evidence.verdict}, ${chosen.evidence.study}). ` +
        (confidence === "relative"
          ? "Not proven profitable — sized down accordingly."
          : "Validated on a sealed holdout.")
      : `No evidence covers ${asset}/${regime}/${timeframe}; falling back to ` +
        `${chosen.id} at minimum size. Absence of evidence is not evidence of edge.`,
  };
}

/** True when any registry entry has cleared a sealed holdout. Currently false. */
export function hasValidatedStrategy() {
  return REGISTRY.some((e) => e.evidence.verdict === "PASS");
}
