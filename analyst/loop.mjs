/**
 * analyst/loop.mjs — context -> decide -> risk gate -> journal, once.
 *
 * ONE BATCH PER CALL. There is no scheduler here and no `while (true)`: the caller decides when a
 * decision happens, because a loop that owns its own clock is a loop that cannot be tested and
 * cannot be stopped from outside.
 *
 * THIS FILE CANNOT PLACE AN ORDER. It imports the context builder, the model call, the risk gate
 * and the journal. None of those can reach a venue, so neither can their composition. The output
 * is an allowed book recorded to a file, and turning that into orders is work nobody has done yet
 * and which must pass D1 -> D2 -> D3 first.
 *
 * THE MODE GUARD IS THE MOST IMPORTANT CODE IN THIS FILE.
 *
 * This agent cannot be backtested -- a model asked what it would do on a past date already knows
 * what happened. So `mode: "paper"`, the only mode that counts as evidence, REFUSES TO RUN ON A
 * HISTORICAL DATE. Not a warning, not a flag in the output: it throws. Historical runs are
 * available as "dry-run" (does the plumbing work?) and "anonymised" (is the reasoning coherent
 * with identities stripped?), and both are recorded under their own mode so `scoreJournal` can
 * refuse to blend them into a track record.
 *
 * That guard exists because the failure it prevents is silent and flattering. Nobody sets out to
 * fake a track record; they run the loop over last year to "check it works", the numbers look
 * good, and six months later the good numbers are the reason to go live. The guard makes that
 * sequence impossible rather than discouraged.
 */

import { buildContext, contextIsPointInTime } from "./context.mjs";
import { decide } from "./decide.mjs";
import { applyRiskGate, DEFAULT_LIMITS } from "./risk.mjs";
import { recordDecision, MODE, DEFAULT_JOURNAL } from "./journal.mjs";

/** How stale a decision date may be and still count as "now", for the paper-mode guard. */
export const PAPER_FRESHNESS_MS = 36 * 60 * 60 * 1000;   // a weekend gap is fine; last month is not

/**
 * Run one decision batch.
 *
 * @returns {{ context, contextIssues, decision, gate, record, skipped }}
 *   `skipped` is set with a reason when the batch did not reach the journal at all.
 */
export async function runOnce({
  series, dates, asOf, client,
  positions = {}, nav = null, peakNav = null, dayStartNav = null,
  instruments = null, sectors = null, news = {},
  mode = MODE.DRY_RUN, model, limits = {}, slate = 40, rankBy = "momentum",
  shortingPermitted = false, journalFile = DEFAULT_JOURNAL, now = Date.now(),
  batchId = null, seed = null,
} = {}) {
  if (!Array.isArray(dates) || !dates.length) throw new Error("loop: dates required");
  const idx = Number.isInteger(asOf) ? asOf : dates.length - 1;
  const asOfTime = dates[idx];

  // ---- the mode guard --------------------------------------------------------------------------
  if (mode === MODE.PAPER) {
    const ageMs = now - asOfTime * 1000;
    if (ageMs > PAPER_FRESHNESS_MS) {
      throw new Error(
        `loop: refusing to run paper mode on ${new Date(asOfTime * 1000).toISOString().slice(0, 10)}, ` +
        `which is ${Math.round(ageMs / 86400000)} days old. A model asked what it would do on a past ` +
        `date already knows what happened. Use mode "dry-run" for a plumbing check or "anonymised" ` +
        `for a reasoning probe; neither counts as evidence. See docs/ANALYST-DESIGN.md.`,
      );
    }
  }

  const L = { ...DEFAULT_LIMITS, ...limits };
  const anonymise = mode === MODE.ANONYMISED;

  const context = buildContext({
    series, dates, asOf: idx, positions, nav, peakNav, dayStartNav,
    slate, rankBy, anonymise, news, sectors,
  });

  // The point-in-time property is structural, but this project's standing lesson is that a claim of
  // that shape gets tested or it gets believed until it is expensively wrong. Checked every batch,
  // not just in the unit tests, because a context assembled from live feeds has failure modes a
  // synthetic panel does not.
  const contextIssues = contextIsPointInTime(context, asOfTime);
  if (contextIssues.length) {
    return {
      context, contextIssues, decision: null, gate: null, record: null,
      skipped: { reason: "context_not_point_in_time", detail: contextIssues },
    };
  }

  const decision = await decide({
    client, context, model,
    maxPositionPct: L.maxPositionPct,
    maxNewPositions: L.maxNewPositionsPerBatch,
    shortingPermitted,
  });

  if (decision.failure) {
    // A failed batch is still journalled. A model that refuses, truncates or emits garbage on some
    // days is a fact about the agent, and a journal that only records the days it worked describes
    // a different agent than the one running.
    const record = recordDecision({
      batchId: batchId ?? defaultBatchId(asOfTime, mode),
      at: new Date(now).toISOString(), context, proposals: [],
      gate: { allowed: [], rejected: [], exposure: null },
      pool: [], seed, model: model ?? null, mode,
    }, journalFile);
    return { context, contextIssues, decision, gate: null, record, skipped: { reason: decision.failure.code, detail: decision.failure.detail } };
  }

  // Instruments default to what the context already knows, so a caller with no separate feed still
  // gets the liquidity and staleness checks rather than silently skipping them.
  //
  // QUOTE AGE IS MEASURED AGAINST THE DECISION, NOT THE WALL CLOCK. In paper mode the decision is
  // now, so the two are the same and a genuinely stale feed is still caught. In a dry run the
  // decision is a simulated moment in the past, and its quotes were fresh AT THAT MOMENT -- judging
  // them against today would make every historical batch fail on staleness and reduce the plumbing
  // check to a test that the staleness rule exists. What a dry run must exercise is the whole path.
  const referenceMs = mode === MODE.PAPER ? now : asOfTime * 1000;
  const inst = instruments ?? instrumentsFromContext(context, series, asOfTime, referenceMs);

  const gate = applyRiskGate(
    decision.proposals,
    { nav, peakNav, dayStartNav, positions, shortingPermitted },
    inst, limits,
  );

  // The control is drawn from what the analyst could actually have chosen, not the whole universe:
  // a control drawn from names never shown measures universe selection, not stock selection.
  const pool = (context.candidates ?? []).map((c) => c.symbol);

  const record = recordDecision({
    batchId: batchId ?? defaultBatchId(asOfTime, mode),
    at: new Date(now).toISOString(),
    context, proposals: decision.proposals, gate, pool, seed,
    model: model ?? null, mode,
  }, journalFile);

  return { context, contextIssues, decision, gate, record, skipped: null };
}

function defaultBatchId(asOfTime, mode) {
  return `${mode}-${new Date(asOfTime * 1000).toISOString().slice(0, 10)}`;
}

/**
 * Derive the instrument facts the risk gate needs from the context and the panel.
 *
 * QUOTE AGE IS COMPUTED FROM THE BAR AGAINST `referenceMs`, NOT ASSUMED FRESH. The caller chooses
 * the reference: wall-clock for a live decision, the simulated decision moment for a dry run. See
 * the note at the call site in `runOnce` for why that distinction is not a convenience.
 */
export function instrumentsFromContext(context, series, asOfTime, referenceMs) {
  const out = {};
  for (const c of context.candidates ?? []) {
    const bars = series?.[c.symbol];
    // THE PRICE IS THE BAR AT THE DECISION, NOT THE LAST BAR OF THE PANEL. Taking the panel's final
    // bar would hand the risk gate a price from after the decision -- in a dry run, literally a
    // future price sizing a position. It would not throw and it would not look wrong in the
    // journal; the book would simply be built against prices nobody could have traded at.
    let atDecision = null;
    for (const b of bars ?? []) {
      if (Number(b.time) > asOfTime) break;
      atDecision = b;
    }
    out[c.symbol.toUpperCase()] = {
      class: "usEquity",
      sector: c.sector ?? null,
      price: atDecision ? Number(atDecision.close) : null,
      quoteAgeMs: Math.max(0, referenceMs - asOfTime * 1000),
      medianDollarVolume: c.medianDollarVolume ?? null,
    };
  }
  return out;
}

/**
 * Compute realised outcomes for a batch once its holding period has elapsed.
 *
 * THE CONTROL IS PRICED THE SAME WAY AS THE BOOK, over the same dates, at the same cost. That
 * identity is the entire value of the comparison: if the agent were charged costs the control was
 * not, or held a day longer, the difference would measure the discrepancy rather than the skill.
 *
 * Returns rows ready for `recordOutcome`. Does not write them -- the caller decides when a holding
 * period is actually over, because only the caller knows what calendar the book trades on.
 */
export function realisedOutcomes({ record, series, dates, entryIdx, holdDays = 5, costPerLeg = 0 }) {
  const rows = [];
  const fwd = (symbol) => forwardReturn(series?.[symbol], dates, entryIdx, holdDays);

  const controlBySlot = record.control ?? [];
  const sized = (record.allowed ?? []).filter((a) => a.action !== "hold" && (a.targetPct ?? 0) > 0);

  for (let i = 0; i < sized.length; i++) {
    const a = sized[i];
    const agent = fwd(a.symbol);
    const ctrl = controlBySlot[i] ? fwd(controlBySlot[i].symbol) : null;
    if (agent === null) continue;
    const charge = 2 * costPerLeg;    // in and out, the same on both sides
    rows.push({
      batchId: record.batchId,
      symbol: a.symbol,
      holdDays,
      grossReturn: round(agent, 6),
      netReturn: round(agent - charge, 6),
      controlReturn: ctrl === null ? null : round(ctrl - charge, 6),
    });
  }
  return rows;
}

function forwardReturn(bars, dates, entryIdx, holdDays) {
  if (!bars?.length) return null;
  const byTime = new Map(bars.map((b) => [Number(b.time), Number(b.close)]));
  const a = byTime.get(dates[entryIdx]);
  const exitIdx = Math.min(entryIdx + holdDays, dates.length - 1);
  const b = byTime.get(dates[exitIdx]);
  return a > 0 && b > 0 ? b / a - 1 : null;
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
