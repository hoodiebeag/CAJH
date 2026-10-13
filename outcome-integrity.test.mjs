/**
 * Outcome field integrity: what is written, what is recovered, and what each statistic consumes.
 *
 * THE PREMISE IS CHECKED BEFORE IT IS USED. `scoreJournal` filters its means with
 * `typeof v === "number"` and its paired sample with `Number.isFinite`, which differ in principle. The
 * tests below establish whether they can differ on a value that SURVIVES JSON, rather than assuming so.
 *
 * TWO DIFFERENT QUESTIONS, AND AN EARLIER DRAFT CONFLATED THEM:
 *
 *   (a) what THIS WRITER produces. `JSON.stringify` maps `NaN`, `Infinity` and `-Infinity` to `null`,
 *       so a value `recordOutcome` was handed in memory is not necessarily what lands on disk.
 *   (b) what the READER accepts. `readJournal` parses any valid JSON line, whatever wrote it. The
 *       numeric token `1e400` is valid JSON and `JSON.parse` yields `Infinity`, so a journal line from
 *       an import, a hand edit or a foreign writer CAN carry a persisted Infinity.
 *
 * Claims about (a) do not transfer to (b). The filters' behaviour differs between the two.
 *
 * Temp journals and plain objects throughout. No runtime change is proposed here; proposals live in
 * docs/REMEDIATION-PLAN.md §F6 and are unapproved.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, recordOutcome, readJournal, scoreJournal, holdPeriodKeys,
  KIND, MODE, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { classifyOutcomes } from "./journal-completeness.mjs";

const THESIS = "a thesis long enough to review";
const e = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oint-")), "j.jsonl");
const p = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS, ...over });
const fp = () => (fs.existsSync(DEFAULT_JOURNAL)
  ? crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");
const BEFORE = fp();

/** One decision so outcomes are attributable, then whatever rows the test wants. */
const withDecision = (file, { day = 2, allowed = [p("AAA")] } = {}) => {
  recordDecision({ batchId: "b1", at: `2026-03-0${day}T21:00:00Z`,
    context: { asOfTime: e(`2026-03-0${day}`) }, proposals: allowed, gate: { allowed },
    pool: ["CTRL"], seed: 1, mode: MODE.PAPER }, file);
  return file;
};
const rowsOf = (file) => readJournal(file).records.filter((r) => r.kind === KIND.OUTCOME);

// ---- the serialization boundary ------------------------------------------------------------------

test("THROUGH THIS WRITER, NaN and both Infinities do not persist: stringify writes them as null", () => {
  // Scoped to the writer. An in-memory Infinity handed to recordOutcome is not a persisted Infinity --
  // but a journal line written by anything else can still carry one (see the 1e400 test below).
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(JSON.stringify({ netReturn: v }), '{"netReturn":null}',
      `${String(v)} serializes to null`);
  }
  // A numeric string survives as a string; undefined drops the key entirely.
  assert.equal(JSON.stringify({ netReturn: "0.05" }), '{"netReturn":"0.05"}');
  assert.equal(JSON.stringify({ netReturn: undefined }), "{}");
  // Finite values round-trip exactly, including zero and negatives.
  for (const v of [0, -0.03, 0.05]) {
    assert.equal(JSON.parse(JSON.stringify({ netReturn: v })).netReturn, v);
  }
});

test("recordOutcome accepts any shape, and four distinct inputs converge on one byte", () => {
  const f = tmp();
  for (const [symbol, v] of [["nan", NaN], ["inf", Infinity], ["neginf", -Infinity], ["nul", null]]) {
    recordOutcome({ batchId: "b1", symbol, holdDays: 5, netReturn: v, controlReturn: 0 }, f);
  }
  recordOutcome({ batchId: "b1", symbol: "missing", holdDays: 5, controlReturn: 0 }, f);  // key absent
  const lines = fs.readFileSync(f, "utf8").trim().split("\n");
  for (const l of lines) {
    assert.match(l, /"netReturn":null/, "every one of the five is written as null");
  }
  // SO SUPPORTED INCOMPLETE DATA AND MALFORMED DATA ARE THE SAME BYTE ON DISK. A NaN from an upstream
  // arithmetic error is indistinguishable from a legitimately absent value.
  const recovered = rowsOf(f).map((r) => r.netReturn);
  assert.deepEqual(recovered, [null, null, null, null, null]);
  assert.equal(recovered.every((v) => v === null), true);
});

test("SEVERAL non-number shapes survive the writer unchanged — a string is only one of them", () => {
  // An earlier draft of this test claimed a numeric string was the ONLY surviving bad shape. It is not:
  // `JSON.stringify` preserves booleans, objects and arrays verbatim, and `recordOutcome` applies
  // `?? null`, which only catches null and undefined.
  const f = tmp();
  const shapes = [["str", "0.05"], ["bool", true], ["boolFalse", false], ["obj", { v: 0.05 }],
    ["arr", [0.05]], ["emptyStr", ""]];
  for (const [symbol, v] of shapes) {
    recordOutcome({ batchId: "b1", symbol, holdDays: 5, netReturn: v, controlReturn: 0 }, f);
  }
  const rows = rowsOf(f);
  const by = Object.fromEntries(rows.map((r) => [r.symbol, r.netReturn]));
  assert.equal(by.str, "0.05");
  assert.equal(by.bool, true);
  assert.equal(by.boolFalse, false, "`false` is not nullish, so `?? null` does not catch it");
  assert.deepEqual(by.obj, { v: 0.05 });
  assert.deepEqual(by.arr, [0.05]);
  assert.equal(by.emptyStr, "");
  // None is a finite number, and none is a number at all, so every mean excludes them.
  for (const [symbol, v] of Object.entries(by)) {
    assert.equal(Number.isFinite(v), false, `${symbol} is not finite`);
    assert.equal(typeof v === "number", false, `${symbol} is not a number`);
  }
});

// ---- the two filters, and whether they can actually diverge --------------------------------------

test("the two filters agree on everything THIS WRITER can emit — and that is the whole claim", () => {
  // Scoped deliberately. An earlier draft said the filters "cannot diverge on any persisted value",
  // which is false: see the next test. What is true is narrower — round-tripping a value through
  // `JSON.stringify` never produces a number that `typeof` accepts and `Number.isFinite` rejects,
  // because the only such values are NaN and the Infinities and stringify maps all three to null.
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(typeof v === "number", true, "these are the only divergent values in memory");
    assert.equal(Number.isFinite(v), false);
    assert.equal(JSON.parse(JSON.stringify({ v })).v, null, "and each becomes null through stringify");
  }
  for (const v of [0, -0.03, 0.05, null, "0.05", "", true, false, [], {}, { v: 1 }]) {
    const back = JSON.parse(JSON.stringify({ v })).v;
    assert.equal(typeof back === "number", Number.isFinite(back),
      `the filters agree on ${JSON.stringify(back)} after a stringify round-trip`);
  }
});

test("A READ journal CAN carry Infinity: `1e400` is valid JSON and the filters DIVERGE on it", () => {
  // `readJournal` parses whatever valid JSON a line holds, whoever wrote it — an import, a hand edit,
  // a foreign tool. The numeric token 1e400 overflows to Infinity on parse, and nothing rejects it.
  assert.equal(JSON.parse('{"v":1e400}').v, Infinity, "valid JSON text, Infinity on parse");
  assert.equal(JSON.parse('{"v":-1e400}').v, -Infinity);
  assert.equal(typeof JSON.parse('{"v":1e400}').v, "number", "typeof accepts it");
  assert.equal(Number.isFinite(JSON.parse('{"v":1e400}').v), false, "Number.isFinite rejects it");

  const f = withDecision(tmp());
  fs.appendFileSync(f, `${'{"kind":"outcome","batchId":"b1","symbol":"AAA","at":"2026-03-09T00:00:00Z"'
    + ',"holdDays":5,"grossReturn":1e400,"netReturn":1e400,"controlReturn":0,"note":null}'}\n`);

  const { records, malformed } = readJournal(f);
  assert.equal(malformed, 0, "the line is well-formed JSON, so nothing is counted as malformed");
  const row = records.find((r) => r.kind === KIND.OUTCOME);
  assert.equal(row.netReturn, Infinity, "and the readback really is Infinity");
  assert.equal(Number.isFinite(row.netReturn), false);

  // THE SCORE CONSEQUENCE, pinned exactly. Inspected field by field: JSON.stringify would hide it.
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 1);
  assert.equal(s.agentMeanNet, Infinity, "the typeof-number filter admits it into the mean");
  assert.equal(s.controlMeanNet, 0);
  assert.equal(s.edge, Infinity);
  assert.equal(s.beatControlRate, 1, "Infinity > 0, so the row counts as beating its control");
  assert.equal(s.hitRate, 1);
  assert.equal(s.edgeCI.nominalN, 0, "while the paired sample is EMPTY — the filters disagree here");
  assert.equal(s.periods, 0);
  // So the readout would print an infinite edge with no interval beside it at all.
  assert.equal(JSON.stringify({ agentMeanNet: s.agentMeanNet }), '{"agentMeanNet":null}',
    "and serializing the result hides the Infinity, which is why it must be inspected directly");
});

test("a surviving non-number counts in `outcomes` and the beatControl denominator, and nowhere else", () => {
  const f = withDecision(tmp());
  const vals = [["good1", 0.10], ["good2", -0.04], ["zero", 0], ["str", "0.05"], ["bool", true],
    ["nan", NaN], ["inf", Infinity], ["nul", null]];
  for (const [symbol, v] of vals) {
    recordOutcome({ batchId: "b1", symbol, holdDays: 5, netReturn: v, controlReturn: 0.01 }, f);
  }
  const outs = rowsOf(f);
  const s = scoreJournal(f);
  assert.equal(outs.length, 8);
  assert.equal(s.outcomes, 8, "every row counts here, whatever it holds");

  // The means and the paired sample admit the same three rows.
  const admitted = outs.map((o) => o.netReturn).filter((v) => typeof v === "number");
  assert.deepEqual(admitted, [0.10, -0.04, 0], "zero is admitted; it is a real result");
  assert.equal(classifyOutcomes(outs).paired.length, 3);
  assert.equal(s.edgeCI.nominalN, 3);
  assert.ok(Math.abs(s.agentMeanNet - 0.02) < 1e-12, "mean over the three admitted rows");

  // THE MEASURABLE IMPACT: beatControlRate's denominator is every row, so the five unusable rows
  // depress it. One of three eligible rows beat its control; the printed figure is 1/8.
  const beatEligible = classifyOutcomes(outs).paired.filter((o) => o.netReturn > o.controlReturn).length;
  assert.equal(beatEligible, 1);
  assert.ok(Math.abs(s.beatControlRate - 1 / 8) < 1e-12, "printed over all eight rows");
  assert.ok(s.beatControlRate < beatEligible / 3, "biased downward — a second route into defect D2");
  // hitRate uses the admitted rows as its denominator, so it is unaffected by the four.
  assert.ok(Math.abs(s.hitRate - 1 / 3) < 1e-12);
});

test("finite zero and negative returns are first-class, not treated as missing", () => {
  const f = withDecision(tmp());
  recordOutcome({ batchId: "b1", symbol: "z", holdDays: 5, netReturn: 0, controlReturn: 0 }, f);
  recordOutcome({ batchId: "b1", symbol: "n", holdDays: 5, netReturn: -0.07, controlReturn: 0 }, f);
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 2);
  assert.equal(s.edgeCI.nominalN, 2, "both are paired-eligible");
  assert.ok(Math.abs(s.agentMeanNet - (-0.035)) < 1e-12);
  assert.ok(Math.abs(s.hitRate - 0) < 1e-12, "zero is not a win, and that is the existing rule");
});

// ---- holdDays, where a shape materially changes a readout ---------------------------------------

test("holdDays shapes persist as given, and only finite positives reach holdDaysOf", () => {
  const f = withDecision(tmp());
  for (const [symbol, h] of [["a", 5], ["b", "5"], ["c", 0], ["d", -3], ["e", NaN], ["f", null], ["g", 2.5]]) {
    recordOutcome({ batchId: "b1", symbol, holdDays: h, netReturn: 0.01, controlReturn: 0 }, f);
  }
  assert.deepEqual(rowsOf(f).map((r) => r.holdDays), [5, "5", 0, -3, null, null, 2.5],
    "written as given; only NaN is coerced, by JSON");
  // holdDaysOf takes the max of the finite positives: 5 beats 2.5, and the string is excluded.
  assert.equal(scoreJournal(f).holdDays, 5);
});

test("a FRACTIONAL holdDays is accepted and makes the period clusters uneven", () => {
  // Materially affects a readout: holdPeriodKeys buckets by floor(rank / holdDays).
  const f = tmp();
  const days = [2, 3, 4, 5, 6, 9];
  days.forEach((d, i) => {
    const allowed = [p("AAA")];
    recordDecision({ batchId: `b${i}`, at: `2026-03-0${d}T21:00:00Z`,
      context: { asOfTime: e(`2026-03-0${d}`) }, proposals: allowed, gate: { allowed },
      pool: ["CTRL"], seed: 1, mode: MODE.PAPER }, f);
    recordOutcome({ batchId: `b${i}`, symbol: "AAA", holdDays: 2.5, netReturn: 0.01, controlReturn: 0 }, f);
  });
  const s = scoreJournal(f);
  assert.equal(s.holdDays, 2.5, "a non-integer hold is accepted");
  const recs = readJournal(f).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const keys = holdPeriodKeys(decisions, rowsOf(f), 2.5);
  // floor(rank/2.5) over ranks 0..5 gives 0,0,0,1,1,2 — clusters of 3, 2 and 1 rather than equal runs.
  assert.deepEqual(keys, ["period:0", "period:0", "period:0", "period:1", "period:1", "period:2"]);
  const sizes = {};
  for (const k of keys) sizes[k] = (sizes[k] ?? 0) + 1;
  assert.deepEqual(sizes, { "period:0": 3, "period:1": 2, "period:2": 1 },
    "uneven clusters, where an integer hold gives equal runs");
  assert.equal(s.periods, 3);
});

// ---- identity shapes, only where they change a join --------------------------------------------

test("symbol CASE splits the settlement key while the news bucket folds it", () => {
  // The settlement key is `${batchId}\\u0000${symbol}` raw; the news bucket upper-cases. So two rows
  // differing only in case are two rows to settle and one name to the news split.
  const f = tmp();
  const allowed = [p("AAA")];
  recordDecision({ batchId: "b1", at: "2026-03-02T21:00:00Z", context: { asOfTime: e("2026-03-02") },
    proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1, mode: MODE.PAPER,
    newsSymbols: new Set(["AAA"]) }, f);
  recordOutcome({ batchId: "b1", symbol: "AAA", holdDays: 5, netReturn: 0.02, controlReturn: 0 }, f);
  recordOutcome({ batchId: "b1", symbol: "aaa", holdDays: 5, netReturn: 0.03, controlReturn: 0 }, f);
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 2, "two distinct settlement keys");
  assert.equal(s.newsSplit.withNews.n, 2, "but both land in the with-news arm, via toUpperCase");
  assert.equal(s.newsSplit.withoutNews.n, 0);
});

test("an outcome whose batchId does not match any decision is dropped from every statistic", () => {
  // Already established for orphans in journal-completeness; re-checked here only because a malformed
  // batchId is a field-shape question. A trailing space is a different key.
  const f = withDecision(tmp());
  recordOutcome({ batchId: "b1 ", symbol: "AAA", holdDays: 5, netReturn: 9.99, controlReturn: 0 }, f);
  recordOutcome({ batchId: "b1", symbol: "AAA", holdDays: 5, netReturn: 0.01, controlReturn: 0 }, f);
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 1, "the mismatched key is not attributed");
  assert.ok(Math.abs(s.agentMeanNet - 0.01) < 1e-12, "and cannot contaminate the mean");
});

test("SAFETY: this suite left the real journal exactly as it found it", () => {
  assert.equal(fp(), BEFORE);
});
