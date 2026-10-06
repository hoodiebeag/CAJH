/**
 * Same-session reruns, session coverage, and the split readouts under missing controls.
 *
 * BUILDS ON THE CLOSED AUDIT in docs/JOURNAL-COMPLETENESS.md §2-§6 rather than restating it. That
 * audit established the unpaired-`edge` defect, the control/agent bar asymmetry, criterion 7's
 * calendar-vs-session bug, duplicate OUTCOME rows and the closing-row count. This file covers what it
 * did not: duplicate DECISION records, operational coverage against the statistical sample count, the
 * session calendar's treatment of holidays, and the news/checklist splits under missingness.
 *
 * ALL FIGURES SYNTHETIC, on hand-built Monday-to-Friday grids. Nothing here is evidence about a
 * strategy. The CLI itself is never launched: `analyst-run.mjs` would construct a model client and
 * take the journal lock, so the boundary exercised is `runOnce`'s inputs and the pure functions
 * downstream. §8 of the doc names the paths that leaves unexercised.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, recordSkip, recordNote, scoreJournal, readJournal, matchedRandomControl,
  KIND, SKIP_REASON, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { settleOutcomes, missedSessions, sessionWeekdays } from "./analyst/loop.mjs";
import { tier1 } from "./analyst/protocol.mjs";
import { sessionCoverage, unpairedBySlot, versionSpread } from "./journal-completeness.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jrerun-")), "j.jsonl");
const DAY = 86400;
const THESIS = "a thesis long enough to review";
const p = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS, ...over });
const AFTER = Date.parse("2026-06-01T00:00:00Z");

const fingerprint = () => (fs.existsSync(DEFAULT_JOURNAL)
  ? crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");
const BEFORE = fingerprint();

/** A Monday-to-Friday session grid, as a real equity panel's dates are. */
const grid = (fromISO, n) => {
  const out = [];
  for (let d = Date.parse(`${fromISO}T00:00:00Z`) / 1000; out.length < n; d += DAY) {
    const w = new Date(d * 1000).getUTCDay();
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out;
};
const SESS = grid("2026-01-05", 20);
const SERIES = {
  A: SESS.map((t, i) => ({ time: t, close: 100 * 1.01 ** i })),
  B: SESS.map((t, i) => ({ time: t, close: 100 * 1.08 ** i })),
  C: SESS.map((t) => ({ time: t, close: 100 })),
};
const settle = (f) => settleOutcomes({ series: SERIES, dates: SESS, journalFile: f, mode: "paper",
  holdDays: 5, costPerLeg: 0, now: AFTER });

// ---- duplicate DECISION, which is not duplicate OUTCOME ----------------------------------------

test("a same-session rerun doubles every decision-side count and no outcome-side count", () => {
  // `runOnce` reads nothing from the journal, so there is no rerun guard, and defaultBatchId is
  // `mode-YYYY-MM-DD` (loop.mjs:293) -- so a second paper run on one session reuses the batchId.
  const f = tmp();
  const batchId = `paper-${new Date(SESS[0] * 1000).toISOString().slice(0, 10)}`;
  for (let run = 0; run < 2; run++) {
    const allowed = [p("A")];
    recordDecision({ batchId, at: new Date(AFTER).toISOString(), context: { asOfTime: SESS[0] },
      proposals: allowed, gate: { allowed, rejected: [{ proposal: { symbol: "Z" }, code: "position_cap", detail: "d" }],
        halted: false, braked: true }, pool: ["C"], seed: 1, mode: "paper" }, f);
  }
  settle(f);
  const s = scoreJournal(f);
  const decisions = readJournal(f).records.filter((r) => r.kind === KIND.DECISION);
  const cov = sessionCoverage(decisions);
  assert.equal(cov.batchRecords, 2);
  assert.equal(cov.distinctSessions, 1, "one session");
  assert.equal(cov.distinctBatchIds, 1, "and one batchId -- the rerun is indistinguishable by id");
  assert.deepEqual(cov.repeatedBatchIds, [{ batchId, count: 2 }]);

  // Decision side: doubled.
  assert.equal(s.batches, 2);
  assert.equal(s.decisions, 2, "`sized` counts the rerun twice, and it gates meetsStandingMinimum");
  assert.deepEqual(s.rejectCounts, { position_cap: 2 }, "rejections are tallied twice");
  assert.equal(s.brakes, 2, "and so are brakes");
  // Outcome side: not doubled, because settlement keys on (batchId, symbol).
  assert.equal(s.outcomes, 1);
  assert.equal(s.periods, 1);
  // The consequence: the evidence floor is reachable at half the real measurable trades.
  assert.ok(s.decisions > s.outcomes, "sized exceeds what can ever be measured");
});

test("two DISTINCT batches on one session are legitimate and still count as ONE period", () => {
  // A designed same-day experiment -- two arms -- is the case a rerun guard must not break.
  const f = tmp();
  for (const tag of ["armA", "armB"]) {
    const allowed = [p("A")];
    recordDecision({ batchId: `paper-${new Date(SESS[0] * 1000).toISOString().slice(0, 10)}-${tag}`,
      at: new Date(AFTER).toISOString(), context: { asOfTime: SESS[0] }, proposals: allowed,
      gate: { allowed }, pool: ["C"], seed: 1, mode: "paper",
      checklistId: tag === "armB" ? "v2" : null }, f);
  }
  settle(f);
  const s = scoreJournal(f);
  const cov = sessionCoverage(readJournal(f).records.filter((r) => r.kind === KIND.DECISION));
  assert.equal(cov.distinctBatchIds, 2, "two distinct batches");
  assert.deepEqual(cov.repeatedBatchIds, [], "and no repeated id, so this is not the rerun case");
  assert.equal(s.outcomes, 2, "both arms settle -- the extra rows are real");
  assert.equal(s.periods, 1, "but one entry session is one holding period");
  assert.deepEqual(cov.sessionsWithSeveralBatches,
    [{ session: new Date(SESS[0] * 1000).toISOString().slice(0, 10), batches: 2 }]);
});

// ---- criterion 1: operational coverage ---------------------------------------------------------

test("criterion 1 counts BATCHES, so it cannot tell every-session-once from half-the-sessions-twice", () => {
  const build = (nSessions, runsEach) => {
    const f = tmp();
    for (let i = 0; i < nSessions; i++) {
      for (let r = 0; r < runsEach; r++) {
        const allowed = [p("A")];
        recordDecision({ batchId: `paper-${i}-${r}`, at: new Date(SESS[i] * 1000).toISOString(),
          context: { asOfTime: SESS[i] }, proposals: allowed, gate: { allowed }, pool: ["C"],
          seed: 1, mode: "paper" }, f);
      }
    }
    return f;
  };
  const c1 = (f) => tier1(f, { now: AFTER }).criteria.find((c) => c.n === 1);
  const honest = c1(build(10, 1));
  const halved = c1(build(5, 2));
  assert.equal(honest.numbers.batches, 10);
  assert.equal(honest.numbers.ratio, 1);
  assert.equal(honest.status, "pass");
  // Half the sessions, same batch count, and the criterion reports a BETTER ratio.
  assert.equal(halved.numbers.batches, 10);
  assert.equal(halved.numbers.ratio, 2);
  assert.equal(halved.status, "pass");
  assert.ok(halved.numbers.ratio > honest.numbers.ratio,
    "running half the sessions twice scores HIGHER on 'runs every session'");
  assert.equal(halved.stops, false, "criterion 1 is reported and judged, not a stopping criterion");
});

test("criterion 1 FAILS on a span containing a market holiday, with nothing missed", () => {
  // US Thanksgiving 2026 falls on Thursday 11-26: no session, so no bar and no batch. All five
  // TRADING days in the span carry a batch.
  const f = tmp();
  for (const d of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30"]) {
    const t = Date.parse(`${d}T00:00:00Z`) / 1000;
    const allowed = [p("A")];
    recordDecision({ batchId: `paper-${d}`, at: new Date(t * 1000).toISOString(),
      context: { asOfTime: t }, proposals: allowed, gate: { allowed }, pool: ["C"], seed: 1, mode: "paper" }, f);
  }
  const c1 = tier1(f, { now: Date.parse("2026-12-15T00:00:00Z") }).criteria.find((c) => c.n === 1);
  assert.equal(c1.numbers.batches, 5, "every trading day in the span produced a batch");
  assert.equal(c1.numbers.expected, 6, "`weekdaysBetween` counts the holiday as an expected session");
  assert.equal(c1.status, "fail", "so a perfect run reads as a failure");
  assert.ok(c1.numbers.ratio < 0.9);
});

test("a correct refusal reads the same as a session that never ran", () => {
  const f = tmp();
  for (let i = 0; i < 9; i++) {
    const allowed = [p("A")];
    recordDecision({ batchId: `paper-${i}`, at: new Date(SESS[i] * 1000).toISOString(),
      context: { asOfTime: SESS[i] }, proposals: allowed, gate: { allowed }, pool: ["C"], seed: 1, mode: "paper" }, f);
  }
  recordSkip({ batchId: "paper-9", at: new Date(SESS[9] * 1000).toISOString(), mode: "paper",
    reason: SKIP_REASON.PANEL_STALE, detail: { missedSessions: 1 } }, f);
  recordNote("operator restarted the runner", f);
  const s = scoreJournal(f);
  const c1 = tier1(f, { now: AFTER }).criteria.find((c) => c.n === 1);
  assert.equal(s.batches, 9, "the skip is not a batch");
  assert.equal(c1.numbers.expected, 10, "but its `at` still extends the span");
  assert.equal(c1.numbers.batches, 9);
  assert.ok(Math.abs(c1.numbers.ratio - 0.9) < 1e-12);
  assert.equal(c1.status, "pass", "and it lands exactly on the 0.9 threshold");
  // The note is in neither count, which is correct -- it carries no session.
  assert.equal(readJournal(f).records.filter((r) => r.kind === KIND.NOTE).length, 1);
});

// ---- the session calendar ----------------------------------------------------------------------

test("the first trading day after a holiday reads as a missed session, so paper mode refuses", () => {
  // The panel's newest complete bar on Friday 11-27 is Wednesday 11-25: Thursday was a holiday.
  const dates = grid("2026-11-02", 18).filter((t) => t <= Date.parse("2026-11-25T00:00:00Z") / 1000);
  const wk = sessionWeekdays(dates);
  assert.deepEqual([...wk].sort(), [1, 2, 3, 4, 5], "a Monday-to-Friday trading week");
  assert.equal(missedSessions(dates.at(-1), Date.parse("2026-11-26T21:00:00Z"), wk), 0,
    "on the holiday itself nothing is behind");
  assert.equal(missedSessions(dates.at(-1), Date.parse("2026-11-27T14:00:00Z"), wk), 1,
    "but the next trading morning reads one session behind -- the holiday");
  // It self-heals: once Friday's bar exists, Monday is level again.
  const withFriday = [...dates, Date.parse("2026-11-27T00:00:00Z") / 1000];
  assert.equal(missedSessions(withFriday.at(-1), Date.parse("2026-11-30T14:00:00Z"), wk), 0);
  // `sessionWeekdays` models the trading WEEK; no holiday calendar exists anywhere in the repo.
  assert.equal(wk.size, 5);
});

// ---- the split readouts under missing controls --------------------------------------------------

test("unpairing is POSITIONAL, so a split can lose an entire arm", () => {
  // Pool of one, two names per batch: matchedRandomControl assigns slot 0 and truncates slot 1.
  const f = tmp();
  for (let i = 0; i < 10; i++) {
    const allowed = [p("A"), p("B")];
    recordDecision({ batchId: `paper-${i}`, at: new Date(SESS[i] * 1000).toISOString(),
      context: { asOfTime: SESS[i] }, proposals: allowed, gate: { allowed }, pool: ["C"], seed: 1,
      mode: "paper", newsSymbols: new Set(["A"]) }, f);
  }
  settle(f);
  const recs = readJournal(f).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outcomes = recs.filter((r) => r.kind === KIND.OUTCOME);
  // Which slot goes unpaired is not random: it is always the tail.
  const up = unpairedBySlot(decisions, outcomes);
  assert.equal(up.unpaired, 10);
  assert.deepEqual(up.slotIndices, [1], "every unpaired row is slot 1 -- the truncated tail");
  // The control's SYMBOL comes from the pool; the SLOT it fills is the first sized decision's.
  const slots = matchedRandomControl([p("A"), p("B")], ["C"], 1);
  assert.deepEqual(slots, [{ symbol: "C", targetPct: 0.05 }],
    "one slot filled, carrying the pool's name at that slot's size");
  assert.equal(slots.length, 1, "slice(0, pool.length) fills the FIRST slot and truncates the tail");

  const s = scoreJournal(f);
  // A had news and always got a control; B never did. So one arm has no control at all.
  assert.equal(s.newsSplit.withNews.n, 10);
  assert.equal(s.newsSplit.withoutNews.n, 10);
  assert.ok(Number.isFinite(s.newsSplit.withNews.edge), "the with-news arm has an edge");
  assert.equal(s.newsSplit.withoutNews.controlMeanNet, null,
    "the without-news arm has NO control mean at all");
  assert.equal(s.newsSplit.withoutNews.edge, null,
    "so the split that tests this design's one claim reports no edge for that arm");
  // And it still shows a meanNet, so the arm looks populated.
  assert.ok(s.newsSplit.withoutNews.meanNet > s.newsSplit.withNews.meanNet,
    "while displaying the larger raw return of the two");
});

test("a bucket's edge inherits the unpaired difference of means, like the headline", () => {
  // summariseBucket filters net and control independently, exactly as scoreJournal's `edge` does.
  const f = tmp();
  for (let i = 0; i < 10; i++) {
    const allowed = [p("A"), p("B")];
    recordDecision({ batchId: `paper-${i}`, at: new Date(SESS[i] * 1000).toISOString(),
      context: { asOfTime: SESS[i] }, proposals: allowed, gate: { allowed },
      pool: ["C", "A"], seed: 1, mode: "paper", newsSymbols: new Set(["A", "B"]) }, f);
  }
  settle(f);
  const s = scoreJournal(f);
  const b = s.newsSplit.withNews;
  assert.equal(b.n, 20, "both names are in the with-news arm");
  assert.ok(Number.isFinite(b.edge));
  // The bucket's edge is meanNet - controlMeanNet over independently filtered sets, which is the
  // same construction §2 of the doc shows diverging from the paired estimate.
  assert.ok(Math.abs(b.edge - (b.meanNet - b.controlMeanNet)) < 1e-12);
});

test("a model version change mid-run blends into one edge and one period count", () => {
  const f = tmp();
  for (let i = 0; i < 10; i++) {
    const allowed = [p("A")];
    recordDecision({ batchId: `paper-${i}`, at: new Date(SESS[i] * 1000).toISOString(),
      context: { asOfTime: SESS[i] }, proposals: allowed, gate: { allowed }, pool: ["C"], seed: 1,
      mode: "paper", model: i < 5 ? "model-v1" : "model-v2" }, f);
  }
  settle(f);
  const decisions = readJournal(f).records.filter((r) => r.kind === KIND.DECISION);
  const vs = versionSpread(decisions);
  assert.deepEqual(vs.model.sort(), ["model-v1", "model-v2"], "both versions ARE recorded");
  const s = scoreJournal(f);
  // Nothing splits on model: one edge, one period count, across two versions.
  assert.ok(Number.isFinite(s.edge));
  assert.equal(s.periods, 2, "periods come from entry sessions, not from versions");
  assert.deepEqual(s.checklistSplit.ids, [null], "checklistSplit splits on checklistId only");
  assert.ok(!Object.keys(s).includes("modelSplit"), "there is no model split to read");
});

// ---- the one thing the proposed criterion-7 fix must not do -------------------------------------

test("a name due by the panel calendar but lacking its own bars must stay visible", () => {
  // The hazard in docs/JOURNAL-COMPLETENESS.md §5 fix 3: counting SESSIONS AVAILABLE FOR THE NAME
  // would make a name with no coverage read as 'not due yet' forever, converting a data gap into a
  // silent pass. The panel has ample sessions after the decision bar; the NAME does not.
  const f = tmp();
  const allowed = [p("GONE")];
  recordDecision({ batchId: "g0", at: new Date(SESS[0] * 1000).toISOString(),
    context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["C"], seed: 1, mode: "paper" }, f);
  const series = { ...SERIES, GONE: SESS.slice(0, 2).map((t) => ({ time: t, close: 100 })) };
  const r = settleOutcomes({ series, dates: SESS, journalFile: f, mode: "paper", holdDays: 5,
    costPerLeg: 0, now: AFTER });
  assert.equal(r.wrote, 0, "it can never settle");
  assert.equal(r.pending, 1, "and settle reports it under `pending`");
  // The panel itself has 19 sessions after the decision bar, so panel-calendar dueness says DUE.
  assert.ok(SESS.length - 1 >= 5, "the panel has more than a hold's worth of later sessions");
  const c7 = tier1(f, { now: AFTER }).criteria.find((c) => c.n === 7);
  assert.equal(c7.numbers.due, 1, "today's calendar rule also calls it due");
  assert.equal(c7.status, "fail");
  assert.equal(c7.stops, true, "and it stops the run -- which is the correct outcome for a data gap");
});

test("the real journal is untouched by this suite", () => {
  assert.equal(fingerprint(), BEFORE);
});
