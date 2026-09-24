import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashContext, matchedRandomControl, recordDecision, recordOutcome, recordNote, recordSkip,
  readJournal, scoreJournal, KIND, MODE, SKIP_REASON,
} from "./journal.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "journal-")), "j.jsonl");
const THESIS = "guidance raised and the tape confirms it";
const p = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, confidence: 0.7, thesis: THESIS, ...over });

// ---- context hashing --------------------------------------------------------------------------

test("context hash is stable under key order", () => {
  // Otherwise the hash reports a change every time an unrelated loop reorders its inserts,
  // and a hash that cries wolf gets ignored.
  assert.equal(hashContext({ a: 1, b: { c: 2, d: 3 } }), hashContext({ b: { d: 3, c: 2 }, a: 1 }));
});

test("context hash changes when the context does", () => {
  assert.notEqual(hashContext({ a: 1 }), hashContext({ a: 2 }));
  assert.notEqual(hashContext({ a: 1 }), hashContext({ a: "1" }));
});

test("array order is significant, unlike key order", () => {
  assert.notEqual(hashContext({ a: [1, 2] }), hashContext({ a: [2, 1] }));
});

// ---- the matched random control ---------------------------------------------------------------

test("control matches the book's size and count", () => {
  const allowed = [p("A"), p("B", { targetPct: 0.08 })];
  const c = matchedRandomControl(allowed, ["X", "Y", "Z", "W"], 1);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.targetPct), [0.05, 0.08]);
});

test("control is deterministic given a seed, so it can be regenerated rather than trusted", () => {
  const allowed = [p("A"), p("B")];
  const pool = ["X", "Y", "Z", "W"];
  assert.deepEqual(matchedRandomControl(allowed, pool, 42), matchedRandomControl(allowed, pool, 42));
  assert.notDeepEqual(matchedRandomControl(allowed, pool, 42), matchedRandomControl(allowed, pool, 43));
});

test("control never draws the same name twice", () => {
  const allowed = [p("A"), p("B"), p("C")];
  const c = matchedRandomControl(allowed, ["X", "Y", "Z"], 7);
  assert.equal(new Set(c.map((x) => x.symbol)).size, 3);
});

test("a pool smaller than the book truncates rather than duplicating", () => {
  // A duplicated name would concentrate the control in a way the real book could not be.
  const c = matchedRandomControl([p("A"), p("B"), p("C")], ["X"], 1);
  assert.equal(c.length, 1);
});

test("holds and zero-size decisions take no control slot", () => {
  const allowed = [p("A", { action: "hold" }), p("B", { action: "sell", targetPct: 0 }), p("C")];
  assert.equal(matchedRandomControl(allowed, ["X", "Y", "Z"], 1).length, 1);
});

test("an empty book or empty pool yields no control", () => {
  assert.deepEqual(matchedRandomControl([], ["X"], 1), []);
  assert.deepEqual(matchedRandomControl([p("A")], [], 1), []);
});

// ---- records ------------------------------------------------------------------------------------

test("a decision records the thesis verbatim", () => {
  const f = tmp();
  recordDecision({
    batchId: "b1", context: { x: 1 },
    proposals: [p("AAPL")],
    gate: { allowed: [p("AAPL")], rejected: [], exposure: 0.05 },
    pool: ["MSFT", "GOOG"],
  }, f);
  const { records } = readJournal(f);
  assert.equal(records[0].proposals[0].thesis, THESIS);
});

test("a rejection keeps its code and detail", () => {
  const f = tmp();
  recordDecision({
    batchId: "b1",
    proposals: [p("AAPL", { targetPct: 0.9 })],
    gate: { allowed: [], rejected: [{ proposal: p("AAPL"), code: "position_cap", detail: "90% > 10%" }] },
    pool: [],
  }, f);
  const { records } = readJournal(f);
  assert.equal(records[0].rejected[0].code, "position_cap");
  assert.equal(records[0].rejected[0].symbol, "AAPL");
});

test("outcomes are separate records, never patched into the decision", () => {
  // An editable record of a prediction is not a prediction.
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [p("AAPL")], gate: { allowed: [p("AAPL")] }, pool: ["X"] }, f);
  const before = fs.readFileSync(f, "utf8");
  recordOutcome({ batchId: "b1", symbol: "AAPL", netReturn: 0.02, controlReturn: 0.01 }, f);
  const after = fs.readFileSync(f, "utf8");
  assert.ok(after.startsWith(before), "the decision line must be untouched");
  const { records } = readJournal(f);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, KIND.DECISION);
  assert.equal(records[1].kind, KIND.OUTCOME);
});

test("the journal is append-only across many writes", () => {
  const f = tmp();
  for (let i = 0; i < 5; i++) {
    recordDecision({ batchId: `b${i}`, proposals: [p("A")], gate: { allowed: [p("A")] }, pool: ["X"] }, f);
  }
  recordNote("halted for maintenance", f);
  const { records } = readJournal(f);
  assert.equal(records.length, 6);
  assert.deepEqual(records.map((r) => r.batchId).slice(0, 5), ["b0", "b1", "b2", "b3", "b4"]);
});

test("a malformed line is skipped and counted, not fatal", () => {
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [], gate: {}, pool: [] }, f);
  fs.appendFileSync(f, "{not json\n");
  recordNote("still writing", f);
  const { records, malformed } = readJournal(f);
  assert.equal(malformed, 1);
  assert.equal(records.length, 2);
});

test("reading a journal that does not exist yet is not an error", () => {
  const { records, malformed } = readJournal(path.join(os.tmpdir(), "definitely-absent-" + Date.now(), "j.jsonl"));
  assert.deepEqual(records, []);
  assert.equal(malformed, 0);
});

test("the journal creates its directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-"));
  const f = path.join(dir, "nested", "deeper", "j.jsonl");
  recordNote("hello", f);
  assert.ok(fs.existsSync(f));
});

// ---- the readout ---------------------------------------------------------------------------------

test("scoring reports agent and control side by side", () => {
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [p("A")], gate: { allowed: [p("A")] }, pool: ["X"] }, f);
  recordOutcome({ batchId: "b1", symbol: "A", netReturn: 0.05, controlReturn: 0.02 }, f);
  recordOutcome({ batchId: "b1", symbol: "B", netReturn: -0.01, controlReturn: 0.03 }, f);
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 2);
  assert.ok(Math.abs(s.agentMeanNet - 0.02) < 1e-9);
  assert.ok(Math.abs(s.controlMeanNet - 0.025) < 1e-9);
  assert.ok(Math.abs(s.edge - -0.005) < 1e-9);
  assert.equal(s.beatControlRate, 0.5);
  assert.equal(s.hitRate, 0.5);
});

test("an agent losing to its own coin flip shows a negative edge", () => {
  // The single number this whole design exists to establish is positive.
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [p("A")], gate: { allowed: [p("A")] }, pool: ["X"] }, f);
  for (let i = 0; i < 4; i++) recordOutcome({ batchId: "b1", symbol: `S${i}`, netReturn: 0.01, controlReturn: 0.04 }, f);
  assert.ok(scoreJournal(f).edge < 0);
});

test("scoring an empty journal yields nulls, not zeros", () => {
  // Zero would read as "no edge measured yet" and "measured, and it is zero" identically.
  const s = scoreJournal(tmp());
  assert.equal(s.batches, 0);
  assert.equal(s.agentMeanNet, null);
  assert.equal(s.edge, null);
  assert.equal(s.beatControlRate, null);
});

test("rejection codes are tallied across batches", () => {
  const f = tmp();
  for (let i = 0; i < 3; i++) {
    recordDecision({
      batchId: `b${i}`, proposals: [p("A")],
      gate: { allowed: [], rejected: [{ proposal: p("A"), code: "sector_cap", detail: "x" }] },
      pool: [],
    }, f);
  }
  assert.equal(scoreJournal(f).rejectCounts.sector_cap, 3);
});

test("the standing minimum needs both trades and elapsed days", () => {
  const f = tmp();
  const many = Array.from({ length: 60 }, (_, i) => p(`S${i}`));
  recordDecision({ batchId: "b1", at: "2026-01-01T00:00:00Z", proposals: many, gate: { allowed: many }, pool: [] }, f);
  // 60 trades but no elapsed time: the minimum is 60 days AND 50 trades.
  assert.equal(scoreJournal(f).meetsStandingMinimum, false);
  recordDecision({ batchId: "b2", at: "2026-04-01T00:00:00Z", proposals: [], gate: { allowed: [] }, pool: [] }, f);
  const s = scoreJournal(f);
  assert.ok(s.spanDays >= 60);
  assert.equal(s.meetsStandingMinimum, true);
});

test("halts and brakes are counted", () => {
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [], gate: { allowed: [], halted: true }, pool: [] }, f);
  recordDecision({ batchId: "b2", proposals: [], gate: { allowed: [], braked: true }, pool: [] }, f);
  const s = scoreJournal(f);
  assert.equal(s.halts, 1);
  assert.equal(s.brakes, 1);
});

test("a decision defaults to paper mode", () => {
  const f = tmp();
  recordDecision({ batchId: "b1", proposals: [], gate: {}, pool: [] }, f);
  assert.equal(readJournal(f).records[0].mode, "paper");
});

// ---- the split that tests the design's one claim -----------------------------------------------
// The pivot's argument is that the edge comes from the non-price input, since the price half is
// closed. That is only testable by comparing names bought WITH a headline against names bought
// without, so the per-name flag has to survive into the readout rather than sit in the file.
test("scoreJournal splits outcomes by whether the NAME had news", () => {
  const j = tmp();
  const ctx = { asOfTime: 1_700_000_000, candidates: [{ symbol: "AAA" }, { symbol: "BBB" }] };
  recordDecision({
    batchId: "b1", context: ctx, proposals: [], mode: MODE.PAPER, pool: ["AAA", "BBB"],
    gate: { allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 },
                      { symbol: "BBB", action: "buy", targetPct: 0.05 }], rejected: [] },
    newsSymbols: new Set(["AAA"]),
  }, j);
  recordOutcome({ batchId: "b1", symbol: "AAA", netReturn: 0.10, controlReturn: 0.01 }, j);
  recordOutcome({ batchId: "b1", symbol: "BBB", netReturn: -0.04, controlReturn: 0.02 }, j);

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.newsSplit.withNews.n, 1);
  assert.equal(s.newsSplit.withoutNews.n, 1);
  assert.equal(s.newsSplit.unknown, 0);
  assert.ok(Math.abs(s.newsSplit.withNews.meanNet - 0.10) < 1e-9);
  assert.ok(Math.abs(s.newsSplit.withoutNews.meanNet + 0.04) < 1e-9);
  assert.ok(Math.abs(s.newsSplit.withNews.edge - 0.09) < 1e-9, "the edge is against its own control");
  assert.equal(s.newsSplit.comparable, false, "two outcomes is not a comparison");
});

test("a per-name flag, not a per-batch one", () => {
  // A batch with news on one of many candidates must not mark every name in it as informed.
  const j = tmp();
  const ctx = { asOfTime: 1_700_000_000, candidates: [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }] };
  recordDecision({
    batchId: "b1", context: ctx, proposals: [], mode: MODE.PAPER, pool: ["AAA", "BBB", "CCC"],
    gate: { allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 },
                      { symbol: "BBB", action: "buy", targetPct: 0.05 },
                      { symbol: "CCC", action: "buy", targetPct: 0.05 }], rejected: [] },
    newsSymbols: new Set(["BBB"]),
  }, j);
  const { records } = readJournal(j);
  const allowed = records[0].allowed;
  assert.deepEqual(allowed.map((a) => a.hadNews), [false, true, false]);
});

test("decisions written before the flag existed are counted as unknown, not as 'no news'", () => {
  const j = tmp();
  const ctx = { asOfTime: 1_700_000_000, candidates: [{ symbol: "AAA" }] };
  // No newsSymbols passed: the caller predates the flag, so the answer is unknown, not false.
  recordDecision({
    batchId: "b1", context: ctx, proposals: [], mode: MODE.PAPER, pool: ["AAA"],
    gate: { allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 }], rejected: [] },
  }, j);
  recordOutcome({ batchId: "b1", symbol: "AAA", netReturn: 0.10, controlReturn: 0.01 }, j);
  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.newsSplit.unknown, 1);
  assert.equal(s.newsSplit.withNews.n, 0);
  assert.equal(s.newsSplit.withoutNews.n, 0, "absent provenance is not evidence of absent news");
});

// ---- skips ------------------------------------------------------------------------------------

test("a skip is a countable record, not a sentence in a log", () => {
  // Criteria 2 and 3 of the paper protocol are assertions about sessions that produced nothing,
  // and both stop the run. They are answered by counting reason codes, so the reason has to be a
  // field. recordNote exists beside this and is deliberately not the tool for the job.
  const j = tmp();
  recordSkip({ batchId: "paper-2026-09-24", mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE, detail: { missedSessions: 4 } }, j);
  recordSkip({ batchId: "paper-2026-09-25", mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE, detail: { missedSessions: 5 } }, j);
  recordSkip({ batchId: "paper-2026-09-26", mode: MODE.PAPER, reason: SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME }, j);

  const skips = readJournal(j).records.filter((r) => r.kind === KIND.SKIP);
  assert.equal(skips.length, 3);
  assert.equal(skips.filter((r) => r.reason === SKIP_REASON.PANEL_STALE).length, 2);
  assert.equal(skips.filter((r) => r.reason === SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME).length, 1);
  assert.equal(skips[0].batchId, "paper-2026-09-24");
  assert.equal(skips[2].detail, null);
  assert.ok(Date.parse(skips[0].at), "a skip without a timestamp cannot be tied to a session");
});

test("skips do not become decisions or outcomes in the score", () => {
  // A skip is the absence of a decision. If it leaked into the numerator the record would improve
  // every time the system refused to run, which is the wrong direction for a guard to push.
  const j = tmp();
  recordSkip({ mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE }, j);
  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.batches, 0);
  assert.equal(s.decisions, 0);
  assert.equal(s.outcomes, 0);
  assert.equal(s.malformed, 0, "a skip is valid JSON and must not be counted as a malformed line");
});
