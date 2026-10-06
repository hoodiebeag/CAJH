/**
 * Criteria 3, 5 and 6 against their registered words, and the skip-reason taxonomy.
 *
 * NEW GROUND ONLY. The calendar, ragged-panel, paired-statistic, retry and version audits are closed
 * (docs/JOURNAL-COMPLETENESS.md §8–§10, docs/REMEDIATION-PLAN.md) and are not revisited.
 *
 * REGISTERED MEANINGS ARE NOT TOUCHED. `docs/PAPER-PROTOCOL.md` is pre-registered; these tests pin
 * what the implementation does against what the protocol says, and nothing here changes either. Fixes
 * are proposed separately in the plan, with their own type and acceptance tests.
 *
 * Hand-computable temp journals throughout. No CLI is launched, so no SDK is constructed and no lock
 * is taken; the risk gate is called as a library function with explicit arguments.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, recordSkip, recordNote, readJournal, scoreJournal,
  KIND, MODE, SKIP_REASON, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { tier1 } from "./analyst/protocol.mjs";
import { applyRiskGate, REJECT } from "./analyst/risk.mjs";
import { BATCH_FAILURE } from "./analyst/decide.mjs";

const THESIS = "a thesis long enough to review";
const e = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crit-")), "j.jsonl");
const p = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS, ...over });
const NOW = Date.parse("2026-05-01T00:00:00Z");
const crit = (file, n, opts = {}) => tier1(file, { now: NOW, ...opts }).criteria.find((c) => c.n === n);

const fp = () => (fs.existsSync(DEFAULT_JOURNAL)
  ? crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");
const BEFORE = fp();

/** A decision record with an explicit gate result, so each scenario is readable at a glance. */
const decide = (file, { batchId, day, allowed = [], rejected = [], halted = false, braked = false,
  proposals = null, failure = null }) =>
  recordDecision({
    batchId, at: `2026-03-${String(day).padStart(2, "0")}T21:00:00Z`,
    context: { asOfTime: e(`2026-03-${String(day).padStart(2, "0")}`) },
    proposals: proposals ?? allowed, gate: { allowed, rejected, halted, braked },
    pool: ["CTRL"], seed: 1, mode: MODE.PAPER, failure,
  }, file);

// =================================================================================================
// Criterion 3 — "Panel freshness never silently degrades" / "zero paper batches on a stale or
// future-dated panel".  STOPPING.
// =================================================================================================

test("CRITERION 3 is hardcoded PASS: a STOPPING criterion that cannot fail", () => {
  // Five scenarios that differ in every way the criterion is about. The verdict never moves.
  const absent = tmp();

  const refusals = tmp();
  recordSkip({ batchId: "s1", at: "2026-03-02T21:00:00Z", mode: MODE.PAPER,
    reason: SKIP_REASON.PANEL_STALE, detail: { missedSessions: 1 } }, refusals);
  recordSkip({ batchId: "s2", at: "2026-03-03T21:00:00Z", mode: MODE.PAPER,
    reason: SKIP_REASON.PANEL_FUTURE_DATED, detail: { sessionsAhead: 1 } }, refusals);

  // A batch that decided anyway, alongside a stale refusal — what a bypassed guard would look like.
  const decidedAnyway = tmp();
  recordSkip({ batchId: "s1", at: "2026-03-02T21:00:00Z", mode: MODE.PAPER,
    reason: SKIP_REASON.PANEL_STALE, detail: { missedSessions: 5 } }, decidedAnyway);
  decide(decidedAnyway, { batchId: "b2", day: 3, allowed: [p("AAA")] });

  for (const [label, f] of [["absent", absent], ["refusals", refusals], ["decided anyway", decidedAnyway]]) {
    const c = crit(f, 3);
    assert.equal(c.stops, true, `${label}: criterion 3 stops the run`);
    assert.equal(c.status, "pass", `${label}: and yet it always passes`);
  }
  // Its `numbers` DO differ, so the information exists — the verdict just never uses it.
  assert.deepEqual(crit(absent, 3).numbers, { stale: 0, futureDated: 0 });
  assert.deepEqual(crit(refusals, 3).numbers, { stale: 1, futureDated: 1 });
  assert.deepEqual(crit(decidedAnyway, 3).numbers, { stale: 1, futureDated: 0 });
});

test("CRITERION 3 cannot distinguish an absent run, a safe refusal, or a batch decided anyway", () => {
  // The registered words are "zero paper batches on a stale or future-dated panel". The
  // implementation never compares ANY batch against a panel: it counts skip reasons and asserts the
  // zero structurally, on the grounds that the guards throw before a batch exists.
  const absent = tmp();
  const refusal = tmp();
  recordSkip({ batchId: "s1", at: "2026-03-02T21:00:00Z", mode: MODE.PAPER,
    reason: SKIP_REASON.PANEL_STALE }, refusal);
  const decided = tmp();
  decide(decided, { batchId: "b1", day: 2, allowed: [p("AAA")] });

  const verdicts = [absent, refusal, decided].map((f) => crit(f, 3).status);
  assert.deepEqual(verdicts, ["pass", "pass", "pass"],
    "three operationally different situations, one verdict");
  // And no criterion anywhere checks a decision's panel freshness: the guard is the only check, and
  // criterion 3 reports on the guard's own skip records rather than verifying its effect.
  const src = fs.readFileSync(new URL("./analyst/protocol.mjs", import.meta.url), "utf8");
  const c3 = src.slice(src.indexOf("// ---- 3."), src.indexOf("// ---- 4."));
  assert.match(c3, /add\(3,[\s\S]*?\n\s*PASS,/, "PASS is a literal, not a condition");
  assert.ok(!/asOfTime|dates|panel\b.*freshness.*check/i.test(c3.replace(/\/\/.*$/gm, "")),
    "and nothing in the branch inspects a panel");
});

// =================================================================================================
// Criterion 5 — "The risk gate is load-bearing, not decorative" / "rejections occur, and every code
// is one we can explain".  NOT stopping.
// =================================================================================================

test("CRITERION 5 PASSES under an all-rejected empty book, which is the A3 world", () => {
  const f = tmp();
  for (let i = 0; i < 5; i++) {
    const props = [p("AAA"), p("BBB")];
    decide(f, { batchId: `b${i}`, day: i + 2, allowed: [], proposals: props,
      rejected: props.map((x) => ({ proposal: x, code: REJECT.STALE_QUOTE, detail: "quote 2268.0min old" })) });
  }
  const c5 = crit(f, 5);
  assert.equal(c5.status, "pass", "rejections occurred and every code is known, so the words are met");
  assert.equal(c5.numbers.total, 10);
  assert.deepEqual(c5.numbers.codes, { [REJECT.STALE_QUOTE]: 10 });
  assert.deepEqual(c5.numbers.unexplained, []);
  // Meanwhile the book is empty and nothing can ever be measured from it.
  const s = scoreJournal(f);
  assert.equal(s.decisions, 0, "no sized decision exists");
  assert.equal(s.outcomes, 0);
  assert.equal(crit(f, 6).numbers.toReview, 0, "and criterion 6 has nothing to review");
  // THE MISMATCH IS BETWEEN THE TITLE AND THE WORDS, not an implementation bug: a gate rejecting
  // 100% satisfies "rejections occur" while being the opposite of load-bearing.
  assert.equal(c5.stops, false, "it does not stop the run either way");
});

test("CRITERION 5 FAILS on a clean book with nothing out of bounds — the opposite reading", () => {
  const f = tmp();
  for (let i = 0; i < 5; i++) decide(f, { batchId: `b${i}`, day: i + 2, allowed: [p("AAA")] });
  const c5 = crit(f, 5);
  assert.equal(c5.status, "fail", "zero rejections reads as FAIL");
  assert.equal(c5.numbers.total, 0);
  assert.match(c5.detail, /Either nothing was ever out of bounds, or the gate is not being reached/);
  // So PASS and FAIL both occur for reasons opposite to the criterion's name, and the detail string
  // is the only place the ambiguity is stated.
  assert.equal(crit(f, 6).numbers.toReview, 5, "while criterion 6 has five positions to review");
});

test("CRITERION 5 passes on a single rejection, including one caused by a halt", () => {
  const f = tmp();
  decide(f, { batchId: "b1", day: 2, allowed: [], proposals: [p("AAA")], halted: true,
    rejected: [{ proposal: p("AAA"), code: REJECT.HALTED, detail: "drawdown halt" }] });
  decide(f, { batchId: "b2", day: 3, allowed: [p("AAA")], braked: true });
  const c5 = crit(f, 5);
  assert.equal(c5.status, "pass", "one rejection is enough to satisfy 'rejections occur'");
  assert.equal(c5.numbers.total, 1);
  // The halt and the brake are visible only in criterion 10, which is MANUAL.
  const s = scoreJournal(f);
  assert.equal(s.halts, 1);
  assert.equal(s.brakes, 1);
  const c10 = crit(f, 10);
  assert.equal(c10.status, "manual");
  assert.deepEqual(c10.numbers, { halts: 1, brakes: 1, skips: 0, notes: 0 });
});

test("CRITERION 5 passes when the gate rejected everything for want of usable risk INPUT", () => {
  // applyRiskGate with no usable NAV rejects the whole batch as malformed. That is a known code, so
  // the criterion reads PASS even though no risk limit was ever actually evaluated.
  const r = applyRiskGate([p("AAA")],
    { nav: null, peakNav: null, dayStartNav: null, positions: {}, shortingPermitted: false },
    { AAA: { class: "usEquity", sector: "Tech", price: 100, quoteAgeMs: 0, medianDollarVolume: 1e9 } });
  assert.deepEqual(r.allowed, []);
  assert.equal(r.rejected[0].code, REJECT.MALFORMED);
  assert.match(r.rejected[0].detail, /no usable NAV/);

  const f = tmp();
  decide(f, { batchId: "b1", day: 2, allowed: [], proposals: [p("AAA")], rejected: r.rejected });
  const c5 = crit(f, 5);
  assert.equal(c5.status, "pass");
  assert.deepEqual(c5.numbers.unexplained, [], "malformed_proposal is a code risk.mjs defines");
});

// =================================================================================================
// Criterion 6 — "No proposal reached the book that the gate should have caught" / "manual review of
// all allowed positions, zero escapes".  STOPPING, and MANUAL.
// =================================================================================================

test("CRITERION 6 counts allowed rows BEFORE any outcome exists, and reads 0 on an empty book", () => {
  const empty = tmp();
  for (let i = 0; i < 3; i++) {
    decide(empty, { batchId: `b${i}`, day: i + 2, allowed: [], proposals: [p("AAA")],
      rejected: [{ proposal: p("AAA"), code: REJECT.STALE_QUOTE, detail: "stale" }] });
  }
  const c6 = crit(empty, 6);
  assert.equal(c6.stops, true);
  assert.equal(c6.status, "manual", "it is always MANUAL, so it never stops automatically");
  assert.equal(c6.numbers.toReview, 0, "nothing to review, which is not the same as no escapes");
  assert.match(c6.detail, /manual review of all 0 allowed position\(s\)/);

  // With a book, it counts allowed rows regardless of whether any outcome has settled.
  const withBook = tmp();
  decide(withBook, { batchId: "b1", day: 2, allowed: [p("AAA"), p("BBB")] });
  assert.equal(crit(withBook, 6).numbers.toReview, 2, "counted at decision time, pre-outcome");
  assert.equal(scoreJournal(withBook).outcomes, 0, "with zero outcomes in existence");
});

test("CRITERION 6's count includes a closing row, which can never be settled", () => {
  // Carried forward from the earlier finding, pinned here because it is criterion 6's own input:
  // sizedAllowed filters `action !== "hold"` only, so a targetPct-0 close is in the review count.
  const f = tmp();
  decide(f, { batchId: "b1", day: 2,
    allowed: [p("AAA"), p("BBB", { action: "sell", targetPct: 0 }), p("CCC", { action: "hold", targetPct: 0 })] });
  assert.equal(crit(f, 6).numbers.toReview, 2, "the close is counted; the hold is not");
  assert.equal(crit(f, 8).numbers.sized, 2, "criterion 8's news denominator uses the same set");
});

// =================================================================================================
// The skip-reason taxonomy
// =================================================================================================

test("SKIP TAXONOMY: all three defined reasons are emitted, and nothing validates a fourth", () => {
  // Every SKIP_REASON value appears in loop.mjs, so the enum is fully exercised by the refusal paths.
  const loopSrc = fs.readFileSync(new URL("./analyst/loop.mjs", import.meta.url), "utf8");
  for (const [key, value] of Object.entries(SKIP_REASON)) {
    assert.match(loopSrc, new RegExp(`SKIP_REASON\\.${key}\\b`), `${value} is emitted by runOnce`);
  }
  assert.equal(Object.keys(SKIP_REASON).length, 3);
  // But protocol.mjs validates reject codes and failure codes against their enums, and skip reasons
  // against nothing. There is no KNOWN_SKIP_CODES set.
  const protoSrc = fs.readFileSync(new URL("./analyst/protocol.mjs", import.meta.url), "utf8");
  assert.match(protoSrc, /KNOWN_REJECT_CODES\s*=\s*new Set\(Object\.values\(REJECT\)\)/);
  assert.match(protoSrc, /KNOWN_FAILURE_CODES\s*=\s*new Set\(Object\.values\(BATCH_FAILURE\)\)/);
  assert.ok(!/KNOWN_SKIP/.test(protoSrc), "no equivalent set exists for skip reasons");
  assert.ok(Object.values(REJECT).length > 0 && Object.values(BATCH_FAILURE).length > 0);
});

test("SKIP TAXONOMY: recordSkip coerces any reason to a string without validating it", () => {
  const f = tmp();
  recordSkip({ batchId: "s1", at: "2026-03-02T21:00:00Z", mode: MODE.PAPER,
    reason: "some_new_reason_nobody_defined" }, f);
  recordSkip({ batchId: "s2", at: "2026-03-03T21:00:00Z", mode: MODE.PAPER, reason: undefined }, f);
  recordSkip({ batchId: "s3", at: "2026-03-04T21:00:00Z", mode: MODE.PAPER, reason: { weird: 1 } }, f);
  const reasons = readJournal(f).records.filter((r) => r.kind === KIND.SKIP).map((r) => r.reason);
  assert.deepEqual(reasons, ["some_new_reason_nobody_defined", "undefined", "[object Object]"],
    "String(reason) persists whatever it was given");
});

test("SKIP TAXONOMY: an unknown reason is invisible to both STOPPING criteria and still fails c1", () => {
  const f = tmp();
  for (const [i, reason] of ["some_new_reason_nobody_defined", undefined, { weird: 1 }].entries()) {
    recordSkip({ batchId: `s${i}`, at: `2026-03-0${i + 2}T21:00:00Z`, mode: MODE.PAPER, reason }, f);
  }
  // Invisible to the two stopping criteria that key on specific reasons.
  assert.equal(crit(f, 2).numbers.skips, 0, "criterion 2 sees no point-in-time skip");
  assert.equal(crit(f, 2).stops, true);
  assert.deepEqual(crit(f, 3).numbers, { stale: 0, futureDated: 0 }, "criterion 3 sees neither kind");
  assert.equal(crit(f, 3).stops, true);
  // Counted raw by criterion 10, which is MANUAL.
  assert.deepEqual(crit(f, 10).numbers, { halts: 0, brakes: 0, skips: 3, notes: 0 });
  // AND they extend criterion 1's denominator while contributing nothing to its numerator.
  const c1 = crit(f, 1);
  assert.equal(c1.numbers.batches, 0);
  assert.equal(c1.numbers.expected, 3, "the skips' `at` values set the span");
  assert.equal(c1.numbers.ratio, 0);
  assert.equal(c1.status, "fail",
    "so a malformed reason converts into a criterion 1 failure while the stopping criteria see nothing");
});

test("SKIP TAXONOMY: a known reason is visible to its criterion, so the gap is the unknown case", () => {
  const f = tmp();
  recordSkip({ batchId: "s1", at: "2026-03-02T21:00:00Z", mode: MODE.PAPER,
    reason: SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME, detail: ["x"] }, f);
  const c2 = crit(f, 2);
  assert.equal(c2.numbers.skips, 1);
  assert.equal(c2.status, "fail", "and criterion 2 correctly STOPS on it");
  assert.equal(c2.stops, true);
});

test("a batch failure is validated against its enum, unlike a skip reason", () => {
  const known = tmp();
  decide(known, { batchId: "b1", day: 2, allowed: [], proposals: [],
    failure: { code: Object.values(BATCH_FAILURE)[0], detail: "d" } });
  assert.deepEqual(crit(known, 4).numbers.byCode, { [Object.values(BATCH_FAILURE)[0]]: 1 });

  const unknown = tmp();
  decide(unknown, { batchId: "b1", day: 2, allowed: [], proposals: [],
    failure: { code: "a_code_decide_does_not_define", detail: "d" } });
  const c4 = crit(unknown, 4);
  assert.equal(c4.status, "fail", "an unknown FAILURE code is caught");
  assert.match(c4.detail, /carry a code decide\.mjs does not define/);
});

test("SAFETY: this suite left the real journal exactly as it found it", () => {
  assert.equal(fp(), BEFORE);
});
