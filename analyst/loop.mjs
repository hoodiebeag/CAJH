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

import { buildContext, contextIsPointInTime, anonymiseContext, aliasToSymbol } from "./context.mjs";
import { decide } from "./decide.mjs";
import { applyRiskGate, DEFAULT_LIMITS } from "./risk.mjs";
import { recordDecision, recordOutcome, readJournal, KIND, MODE, DEFAULT_JOURNAL } from "./journal.mjs";

/** How stale a decision date may be and still count as "now", for the paper-mode guard. */
export const PAPER_FRESHNESS_MS = 36 * 60 * 60 * 1000;   // a weekend gap is fine; last month is not

/**
 * Which weekdays this panel actually trades, read off the panel instead of assumed.
 *
 * Discipline rule 4 says derive calendars from the data and never from a constant. A hardcoded
 * Monday-to-Friday is wrong for crypto and wrong for any venue with a different week, and it is
 * wrong silently.
 */
export function sessionWeekdays(dates, lookback = 250) {
  const days = new Set();
  for (const t of dates.slice(-lookback)) days.add(new Date(t * 1000).getUTCDay());
  return days;
}

/**
 * How many sessions the panel is missing: trading weekdays strictly after its last bar, up to now.
 *
 * WHY NOT ELAPSED HOURS. The wall-clock rule this replaces refused whenever the last bar was over
 * 36 hours old, which is every Monday and every day after a holiday -- a correct panel reading as
 * a broken feed. The opposite error, a tolerance wide enough to cover a long holiday weekend, lets
 * a genuinely stale panel through in the middle of a normal week, and THAT error is the dangerous
 * one: it produces contaminated evidence that looks like a track record.
 *
 * So this counts sessions rather than time. A holiday the panel has not seen yet counts as a
 * missed session and makes the check too STRICT by one day, which fails safe -- it refuses to
 * trade. Being too loose would fail dangerous.
 */
export function missedSessions(lastBarEpoch, nowMs, weekdays) {
  if (!weekdays || !weekdays.size) return 0;
  const dayOf = (ms) => Math.floor(ms / 86400000);
  const last = dayOf(lastBarEpoch * 1000);
  const today = dayOf(nowMs);
  let n = 0;
  for (let d = last + 1; d <= today; d++) {
    if (weekdays.has(new Date(d * 86400000).getUTCDay())) n++;
    if (n > 400) break;                       // a panel years out of date needs no exact count
  }
  return n;
}

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
    const missed = missedSessions(asOfTime, now, sessionWeekdays(dates));
    if (missed > 1) {
      throw new Error(
        `loop: refusing to run paper mode on ${new Date(asOfTime * 1000).toISOString().slice(0, 10)}, ` +
        `which is ${missed} sessions behind on this panel's own calendar. A model asked what it ` +
        `would do on a past date already knows what happened. Use mode "dry-run" for a plumbing ` +
        `check or "anonymised" for a reasoning probe; neither counts as evidence. ` +
        `See docs/ANALYST-DESIGN.md.`,
      );
    }
  }

  const L = { ...DEFAULT_LIMITS, ...limits };
  const anonymise = mode === MODE.ANONYMISED;

  // ANONYMISED MODE NEEDS BOTH VIEWS, AND ONLY ONE OF THEM REACHES THE MODEL.
  //
  // The model must see hashed labels or the mode is pointless. The RISK GATE must see real
  // instruments or it cannot price anything -- the first time this mode was actually run it
  // rejected every proposal with `no_usable_price`, because `instrumentsFromContext` looked up a
  // series under the name "Asset A". The gate is deterministic code, not the model, so it may
  // know the identities; the model never does.
  const named = buildContext({
    series, dates, asOf: idx, positions, nav, peakNav, dayStartNav,
    slate, rankBy, anonymise: false, news, sectors,
  });
  const context = anonymise ? anonymiseContext(named) : named;

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
  const inst = instruments ?? instrumentsFromContext(named, series, asOfTime, referenceMs);

  // Translate the model's aliases back before the gate. An alias that maps to nothing is DROPPED
  // AND COUNTED, never passed through -- the same rule the named path applies to a hallucinated
  // ticker, for the same reason: a proposal naming an instrument that does not exist is not a
  // proposal that can be repaired into one.
  let proposals = decision.proposals;
  const unmappedAliases = [];
  if (anonymise) {
    const back = aliasToSymbol(named);
    proposals = [];
    for (const p of decision.proposals) {
      const real = back.get(String(p.symbol).toUpperCase());
      if (!real) { unmappedAliases.push(p.symbol); continue; }
      proposals.push({ ...p, symbol: real, alias: p.symbol });
    }
  }

  const gate = applyRiskGate(
    proposals,
    { nav, peakNav, dayStartNav, positions, shortingPermitted },
    inst, limits,
  );

  // The control is drawn from what the analyst could actually have chosen, not the whole universe:
  // a control drawn from names never shown measures universe selection, not stock selection.
  // Drawn from the NAMED candidates: a control has to be a real instrument to be priced, and in
  // anonymised mode the shown candidates carry hashed labels.
  const pool = (named.candidates ?? []).map((c) => c.symbol);

  const record = recordDecision({
    batchId: batchId ?? defaultBatchId(asOfTime, mode),
    at: new Date(now).toISOString(),
    context: named, proposals, gate, pool, seed,
    model: model ?? null, mode,
  }, journalFile);

  return { context, contextIssues, decision, gate, record, unmappedAliases, skipped: null };
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
export function realisedOutcomes({ record, series, dates, entryIdx, holdDays = 5, costPerLeg = 0,
                                   requireComplete = true }) {
  const rows = [];
  const fwd = (symbol) => forwardReturn(series?.[symbol], dates, entryIdx, holdDays);

  const controlBySlot = record.control ?? [];
  const sized = (record.allowed ?? []).filter((a) => a.action !== "hold" && (a.targetPct ?? 0) > 0);

  for (let i = 0; i < sized.length; i++) {
    const a = sized[i];
    const agent = fwd(a.symbol);
    if (agent === null) continue;
    const complete = agent.sessions >= holdDays;
    if (requireComplete && !complete) continue;      // dropped, never recorded as a flat trade
    const ctrl = controlBySlot[i] ? fwd(controlBySlot[i].symbol) : null;
    const charge = 2 * costPerLeg;    // in and out, the same on both sides
    rows.push({
      batchId: record.batchId,
      symbol: a.symbol,
      holdDays,
      sessionsHeld: agent.sessions,
      complete,
      grossReturn: round(agent.ret, 6),
      netReturn: round(agent.ret - charge, 6),
      controlReturn: ctrl === null ? null : round(ctrl.ret - charge, 6),
    });
  }
  return rows;
}

/**
 * Forward return AND how many sessions were actually available for it.
 *
 * THE SESSION COUNT IS NOT DECORATION. This used to clamp the exit to the last available bar and
 * return a number, so a decision made at the end of the panel "held" for zero sessions and came
 * back as exactly 0% gross -- which, charged a round trip, reads as a realised -0.11% trade. Three
 * different names and the matched control all landing on the identical figure is what exposed it.
 *
 * It matters well beyond a dry run. These rows are documented as ready for `recordOutcome`, and
 * paper scoring necessarily runs while the newest decisions are still inside their holding period.
 * Writing those as completed flat trades would pack the track record with fabricated zeroes, drag
 * the measured edge toward nothing, and make the agent look consistent while doing it -- a
 * contamination of the one instrument this design has.
 */
function forwardReturn(bars, dates, entryIdx, holdDays) {
  if (!bars?.length) return null;
  const byTime = new Map(bars.map((b) => [Number(b.time), Number(b.close)]));
  const a = byTime.get(dates[entryIdx]);
  const exitIdx = Math.min(entryIdx + holdDays, dates.length - 1);
  const b = byTime.get(dates[exitIdx]);
  if (!(a > 0 && b > 0)) return null;
  return { ret: b / a - 1, sessions: exitIdx - entryIdx };
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/**
 * Compute and append outcomes for every decision whose holding period has finished.
 *
 * WHY THIS EXISTS AT ALL. `recordOutcome` was written and nothing ever called it. Decisions were
 * journalled and `realisedOutcomes` could compute results, but the two were never connected, so
 * `scoreJournal` reported "outcomes 0" however long the agent ran. A measurement instrument that
 * cannot record a measurement is not one.
 *
 * SEPARATE FROM THE DECISION, because the holding period has not elapsed when the decision is
 * made. Settlement happens on a later run, days after, which is exactly why it must be idempotent:
 * the journal is append-only, so a duplicate outcome cannot be taken back and would be counted
 * twice by every figure `scoreJournal` produces.
 *
 * A decision whose entry bar this panel does not contain is SKIPPED AND COUNTED, never settled
 * against a nearby bar. Guessing an entry price is how a track record stops describing the trades
 * that were actually proposed.
 */
export function settleOutcomes({ series, dates, journalFile = DEFAULT_JOURNAL, mode = MODE.PAPER,
                                 holdDays = 5, costPerLeg = 0, now = Date.now() } = {}) {
  const { records, malformed } = readJournal(journalFile);
  const decisions = records.filter((r) => r.kind === KIND.DECISION && r.mode === mode);
  const key = (batchId, symbol) => `${batchId}\u0000${symbol}`;
  const settled = new Set(records.filter((r) => r.kind === KIND.OUTCOME)
    .map((r) => key(r.batchId, r.symbol)));

  const idxOf = new Map(dates.map((t, i) => [t, i]));
  let wrote = 0, already = 0, pending = 0, unknownBar = 0;

  for (const d of decisions) {
    const entryIdx = Number.isFinite(d.asOfTime) ? idxOf.get(d.asOfTime) : undefined;
    if (entryIdx === undefined) { unknownBar++; continue; }
    const rows = realisedOutcomes({ record: d, series, dates, entryIdx, holdDays, costPerLeg });
    const sized = (d.allowed ?? []).filter((a) => a.action !== "hold" && (a.targetPct ?? 0) > 0);
    pending += Math.max(0, sized.length - rows.length);
    for (const row of rows) {
      const k = key(row.batchId, row.symbol);
      if (settled.has(k)) { already++; continue; }
      recordOutcome({ ...row, at: new Date(now).toISOString() }, journalFile);
      settled.add(k);
      wrote++;
    }
  }
  return { decisions: decisions.length, wrote, already, pending, unknownBar, malformed };
}
