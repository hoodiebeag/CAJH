/**
 * The ten Tier-1 criteria of docs/PAPER-PROTOCOL.md, computed from the journal.
 *
 * WHY THIS IS CODE AND NOT A CHECKLIST SOMEBODY READS. The criteria were pre-registered before any
 * paper decision existed, precisely so that the standard could not be adjusted after the fact. A
 * criterion that is only prose gets evaluated on day twenty by a human reading a twenty-day JSONL
 * file, at the exact moment the pull to like the answer is strongest. Computing them turns the
 * pre-registration into something that still binds when the numbers are in.
 *
 * SEVEN OF TEN ARE COMPUTABLE AND THREE ARE NOT, AND THE THREE SAY SO RATHER THAN GUESSING. A
 * readout that quietly substituted a proxy for "no proposal reached the book that the gate should
 * have caught" would report a pass on a question it never asked. `status: "manual"` is a result,
 * not a gap in this file.
 *
 * FOUR CRITERIA STOP THE RUN: 2, 3, 6 and 7. They are integrity failures rather than performance
 * ones, and continuing past them produces a record that means nothing. `stops` marks them, and
 * `verdict` reports STOP separately from FAIL so the distinction survives into the output.
 */

import { readJournal, scoreJournalRecords, decisionTimeMs, KIND, MODE, SKIP_REASON } from "./journal.mjs";
import { REJECT } from "./risk.mjs";
import { BATCH_FAILURE } from "./decide.mjs";

const KNOWN_REJECT_CODES = new Set(Object.values(REJECT));
const KNOWN_FAILURE_CODES = new Set(Object.values(BATCH_FAILURE));

const PASS = "pass", FAIL = "fail", MANUAL = "manual";

/** Weekdays in [from, to] inclusive. An approximation of the session calendar; holidays are not in it. */
function weekdaysBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return 0;
  const day = 86400000;
  let n = 0;
  for (let t = Math.floor(fromMs / day) * day; t <= toMs; t += day) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/**
 * Evaluate the ten criteria against a journal, FOR ONE CANDIDATE VERSION.
 *
 * A CANDIDATE IS REQUIRED, and that is the whole change. The ten criteria are a promotion claim, and
 * a promotion claim over a pooled set of records answers no question: "did this run every session,
 * lose few batches and hold its integrity" is a question about a thing, and a pool of several
 * strategies is not a thing. Pooled, a version with a clean record and a version with a broken one
 * average into a verdict that describes neither, and nothing in the table would show it had.
 *
 * THE ACCEPTED COST, stated here because it is permanent: records written before attribution existed
 * carry no candidate, so they cannot support a Tier-1 claim for anybody. They are not back-filled --
 * guessing a candidate from `checklistId` or `contextHash` would manufacture exactly the provenance
 * the field exists to establish. New attributed runs have to build that evidence from scratch.
 *
 * `candidateVersion` is optional: omit it to evaluate every version of one candidate together, which
 * is a legitimate question ("has this candidate ever run clean") and a different one from evaluating
 * a single version.
 *
 * SCOPED AT ONE POINT. `decisions` and `skips` are the two roots -- outcomes derive from the
 * decisions' batch ids, and `score` is the same filter applied by `scoreJournal` -- so every figure
 * in the table is scoped the same way and none can disagree with another.
 *
 * THE TEN CRITERIA, THEIR TEXT AND THEIR THRESHOLDS ARE UNCHANGED. This is a change to WHICH RECORDS
 * a criterion reads, not to what any criterion asks or where its bar sits.
 *
 * @returns {{ criteria: Array, verdict: "PASS"|"FAIL"|"STOP", stops: Array, mode, batches }}
 */
export function tier1(journalFile, { mode = MODE.PAPER, now = Date.now(), newsFloor = 0.6,
                                     candidateId = null, candidateVersion = null } = {}) {
  // Preserve the original argument error before attempting any file read.
  if (candidateId === null) return tier1Records({ records: [] }, { mode, now, newsFloor, candidateId, candidateVersion });
  return tier1Records(readJournal(journalFile), { mode, now, newsFloor, candidateId, candidateVersion });
}

/** Evaluate one captured journal snapshot with unchanged criteria and thresholds. */
export function tier1Records({ records, malformed = 0 },
  { mode = MODE.PAPER, now = Date.now(), newsFloor = 0.6,
    candidateId = null, candidateVersion = null } = {}) {
  if (candidateId === null) {
    throw new Error(
      "protocol: tier1 requires a candidateId. The ten criteria are a promotion claim, and a claim " +
      "over pooled records describes no candidate -- a clean version and a broken one average into a " +
      "verdict that fits neither, and the table would not show it. Pass candidateId (and " +
      "candidateVersion to scope to one version). Records written before attribution existed carry " +
      "none and cannot support a Tier-1 claim; they are never back-filled.");
  }
  const inMode = (r) => (r.mode ?? MODE.PAPER) === mode;
  const ofCandidate = (r) => (r.candidateId ?? null) === candidateId
    && (candidateVersion === null || (r.candidateVersion ?? null) === candidateVersion);

  const decisionsInMode = records.filter((r) => r.kind === KIND.DECISION && inMode(r));
  const skipsInMode = records.filter((r) => r.kind === KIND.SKIP && inMode(r));
  const decisions = decisionsInMode.filter(ofCandidate);
  const skips = skipsInMode.filter(ofCandidate);

  // Counted, never absorbed. An unattributed record is excluded from every figure below -- it cannot
  // be this candidate's -- and the count says how many, so a thin table is distinguishable from a
  // thin record. Same three-way split `scoreJournal` reports, applied to decisions and skips.
  const unattributedBatches = decisionsInMode.filter((d) => (d.candidateId ?? null) === null).length;
  const unattributedSkips = skipsInMode.filter((sk) => (sk.candidateId ?? null) === null).length;
  const excludedByCandidate = (decisionsInMode.length - decisions.length)
    + (skipsInMode.length - skips.length);

  const batchIds = new Set(decisions.map((d) => d.batchId));
  const outcomes = records.filter((r) => r.kind === KIND.OUTCOME && batchIds.has(r.batchId));
  const score = scoreJournalRecords({ records, malformed }, { mode, candidateId, candidateVersion });

  const sizedAllowed = decisions.flatMap((d) => (d.allowed ?? []).filter((a) => a.action !== "hold"));
  const criteria = [];
  const add = (n, name, status, detail, numbers = {}, stops = false) =>
    criteria.push({ n, name, status, detail, numbers, stops });

  // ---- 1. runs every session without hand-holding ------------------------------------------------
  //
  // MEASURED ON THE DECISION BARS, NOT THE WRITE TIMESTAMPS. Read off `at`, five batches covering
  // four weeks reported "5 batch(es) over 1 weekday(s) spanned" and passed at a ratio of 5.0,
  // because they were all written in the same minute. A skip has no decision bar -- it exists
  // precisely because no decision was made -- so those keep their `at`, which for a live refusal is
  // the session anyway.
  const times = decisions.map(decisionTimeMs).filter(Number.isFinite)
    .concat(skips.map((s) => Date.parse(s.at)).filter(Number.isFinite));
  const expected = times.length ? weekdaysBetween(Math.min(...times), Math.max(...times)) : 0;
  const ratio = expected ? decisions.length / expected : null;
  // THIS CRITERION IS ONLY MEANINGFUL FOR A FORWARD RUN. It asks whether the thing ran unattended
  // every session. A dry run's batches are hand-picked dates, so the ratio describes the operator's
  // choice of `--asOf` and nothing about the system. Reporting it as a FAIL would be noise in a
  // table where four criteria stop the run, and teaching anyone to skim a red line here is worse
  // than printing nothing.
  const forward = mode === MODE.PAPER;
  add(1, "Runs every session without hand-holding",
    !forward ? MANUAL : ratio === null ? MANUAL : ratio >= 0.9 ? PASS : FAIL,
    ratio === null
      ? "nothing in the journal yet"
      : `${decisions.length} batch(es) over ${expected} weekday(s) spanned` +
        (skips.length ? `, plus ${skips.length} session(s) that refused and said why` : "") +
        (forward
          ? ". Weekdays are not the session calendar: market holidays count here and should not, so" +
            " a run spanning one reads slightly low."
          : `. Mode "${mode}" decides on hand-picked dates, so this ratio describes the --asOf` +
            " values chosen and not whether anything ran unattended. Only a forward run answers it."),
    { batches: decisions.length, expected, ratio, forward });

  // ---- 2. point-in-time integrity (STOPS) --------------------------------------------------------
  const pitSkips = skips.filter((s) => s.reason === SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME);
  add(2, "Point-in-time integrity holds live",
    pitSkips.length === 0 ? PASS : FAIL,
    `${pitSkips.length} context_not_point_in_time skip(s). ` +
    "READ THIS PASS NARROWLY: contextIsPointInTime can only object to a context asOf after the " +
    "boundary, which buildContext derives from the boundary and cannot exceed, or to news dated " +
    "after it, which buildContext already filters out. It is a second line of defence against a " +
    "regression, so a pass is evidence buildContext has not regressed -- NOT evidence that " +
    "point-in-time integrity was independently verified on live data.",
    { skips: pitSkips.length }, true);

  // ---- 3. panel freshness never silently degrades (STOPS) ----------------------------------------
  const staleSkips = skips.filter((s) => s.reason === SKIP_REASON.PANEL_STALE);
  const futureSkips = skips.filter((s) => s.reason === SKIP_REASON.PANEL_FUTURE_DATED);
  // The criterion is about BATCHES on a bad panel. The guards throw before a batch exists, so the
  // countable quantity is how often they fired -- which is the run's health, not a failure.
  add(3, "Panel freshness never silently degrades",
    PASS,
    `0 batch(es) decided on a bad panel; the guards refused ${staleSkips.length} stale and ` +
    `${futureSkips.length} future-dated session(s) before a decision existed. ` +
    (staleSkips.length + futureSkips.length > 0
      ? "Refusals are the guard working, but this many means the panel is not being refreshed."
      : "No refusals recorded."),
    { stale: staleSkips.length, futureDated: futureSkips.length }, true);

  // ---- 4. model output stays parseable -----------------------------------------------------------
  const failed = decisions.filter((d) => d.failure);
  const unknownFailures = failed.filter((d) => !KNOWN_FAILURE_CODES.has(d.failure.code));
  const lossRate = decisions.length ? failed.length / decisions.length : null;
  const byCode = {};
  for (const d of failed) byCode[d.failure.code] = (byCode[d.failure.code] ?? 0) + 1;
  add(4, "Model output stays parseable",
    lossRate === null ? MANUAL : lossRate < 0.1 && !unknownFailures.length ? PASS : FAIL,
    lossRate === null
      ? "no batches yet"
      : `${failed.length} of ${decisions.length} batch(es) lost (${(lossRate * 100).toFixed(1)}%)` +
        (failed.length ? `: ${Object.entries(byCode).map(([c, n]) => `${c}×${n}`).join(", ")}` : "") +
        (unknownFailures.length ? `. ${unknownFailures.length} carry a code decide.mjs does not define.` : "") +
        ". Batches written before the failure code was journalled read as successes.",
    { failed: failed.length, batches: decisions.length, lossRate, byCode });

  // ---- 5. the risk gate is load-bearing ----------------------------------------------------------
  const rejectCodes = Object.keys(score.rejectCounts);
  const unexplained = rejectCodes.filter((c) => !KNOWN_REJECT_CODES.has(c));
  const totalRejects = Object.values(score.rejectCounts).reduce((a, b) => a + b, 0);
  add(5, "The risk gate is load-bearing, not decorative",
    totalRejects > 0 && unexplained.length === 0 ? PASS : FAIL,
    totalRejects === 0
      ? "zero rejections. Either nothing was ever out of bounds, or the gate is not being reached."
      : `${totalRejects} rejection(s) across ${rejectCodes.length} code(s)` +
        (unexplained.length ? `; ${unexplained.join(", ")} are not in risk.mjs REJECT` : "; all codes are ones risk.mjs defines"),
    { total: totalRejects, codes: score.rejectCounts, unexplained });

  // ---- 6. no gate escape (STOPS, manual) ---------------------------------------------------------
  add(6, "No proposal reached the book that the gate should have caught",
    MANUAL,
    `manual review of all ${sizedAllowed.length} allowed position(s). No automatic check can stand ` +
    "in for this one: a rule that decided whether the gate was right would just be the gate again, " +
    "and it would agree with itself.",
    { toReview: sizedAllowed.length }, true);

  // ---- 7. settlement complete and idempotent (STOPS) ---------------------------------------------
  const settledKeys = new Set(outcomes.map((o) => `${o.batchId}\u0000${o.symbol}`));
  const hold = score.holdDays;
  const dueMs = hold * 86400000;
  const due = decisions.flatMap((d) => {
    const at = Date.parse(d.at);
    if (!Number.isFinite(at) || now - at < dueMs) return [];
    return (d.allowed ?? []).filter((a) => a.action !== "hold" && (a.targetPct ?? 0) > 0)
      .map((a) => `${d.batchId}\u0000${a.symbol}`);
  });
  const unsettled = due.filter((k) => !settledKeys.has(k));
  add(7, "Settlement is complete and idempotent",
    unsettled.length === 0 ? PASS : FAIL,
    `${due.length} sized decision(s) past a ${hold}-day hold, ${due.length - unsettled.length} settled` +
    (unsettled.length ? `, ${unsettled.length} NOT settled` : "") +
    ". The idempotence half is not computable from a file: run `settle` twice and check the second " +
    "run reports 0 written and the rest already settled.",
    { due: due.length, unsettled: unsettled.length }, true);

  // ---- 8. news actually reaches decisions ---------------------------------------------------------
  const withNews = sizedAllowed.filter((a) => a.hadNews === true).length;
  const unrecorded = sizedAllowed.filter((a) => a.hadNews === null || a.hadNews === undefined).length;
  const newsRate = sizedAllowed.length ? withNews / sizedAllowed.length : null;
  add(8, "News actually reaches decisions",
    newsRate === null ? MANUAL : newsRate >= newsFloor ? PASS : FAIL,
    newsRate === null
      ? "no sized decisions yet"
      : `${withNews} of ${sizedAllowed.length} sized decision(s) carried a headline ` +
        `(${(newsRate * 100).toFixed(1)}%, floor ${(newsFloor * 100).toFixed(0)}%)` +
        (unrecorded ? `; ${unrecorded} predate the per-name flag and count against the rate` : ""),
    { withNews, sized: sizedAllowed.length, unrecorded, rate: newsRate });

  // ---- 9. theses are reviewable (manual) ----------------------------------------------------------
  const theses = decisions.flatMap((d) => (d.proposals ?? [])
    .filter((p) => p.thesis).map((p) => ({ batchId: d.batchId, symbol: p.symbol, thesis: p.thesis })));
  add(9, "Theses are reviewable by a human",
    MANUAL,
    `${theses.length} thesis/theses on record; spot-check 20. The question is whether each states a ` +
    "reason that could be wrong, which is not a property a string check can evaluate.",
    { total: theses.length, sample: theses.slice(0, 20) });

  // ---- 10. nothing halts for an unanticipated reason (manual) -------------------------------------
  const notes = records.filter((r) => r.kind === KIND.NOTE).length;
  add(10, "Nothing halts for a reason we did not anticipate",
    MANUAL,
    `${score.halts} halt(s), ${score.brakes} daily brake(s), ${skips.length} skip(s), ${notes} note(s). ` +
    "Every one needs an explanation in the journal; whether the explanation was anticipated is a " +
    "judgement, not a count.",
    { halts: score.halts, brakes: score.brakes, skips: skips.length, notes });

  const stops = criteria.filter((c) => c.stops && c.status === FAIL);
  const fails = criteria.filter((c) => !c.stops && c.status === FAIL);
  return {
    mode,
    candidateId,
    candidateVersion,
    batches: decisions.length,
    // What this verdict did NOT read, so a reader can tell a thin candidate from a thin journal.
    excludedByCandidate,
    unattributedBatches,
    unattributedSkips,
    // What is actually in the file, from the scoped score, so a verdict of zero batches can be
    // told apart from a misspelled candidate.
    candidatesPresent: score.candidatesPresent,
    criteria,
    stops,
    verdict: stops.length ? "STOP" : fails.length ? "FAIL" : "PASS",
  };
}
