import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashContext, matchedRandomControl, recordDecision, recordOutcome, recordNote, recordSkip,
  readJournal, scoreJournal, holdPeriodKeys, decisionTimeMs, KIND, MODE, SKIP_REASON, DEFAULT_JOURNAL,
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

// ---- the independent unit ----------------------------------------------------------------------
//
// The protocol's entire arithmetic turns on this: twenty trading days of daily decisions on a
// five-day hold is FOUR observations, not a hundred trades. Counting trades overstates the
// evidence by roughly an order of magnitude, in the flattering direction.

const DAY = 86400;

/** `sessions` consecutive daily batches, `perBatch` names each, all settled at `holdDays`. */
function syntheticRun(j, { sessions, perBatch, holdDays, t0 = 1_760_000_000 }) {
  for (let s = 0; s < sessions; s++) {
    const asOfTime = t0 + s * DAY;
    const batchId = `paper-${s}`;
    const allowed = [];
    for (let k = 0; k < perBatch; k++) allowed.push({ symbol: `S${k}`, action: "buy", targetPct: 0.05 });
    recordDecision({
      batchId, at: new Date(asOfTime * 1000).toISOString(), mode: MODE.PAPER,
      context: { asOfTime }, proposals: allowed, gate: { allowed, rejected: [] }, pool: [],
    }, j);
    for (let k = 0; k < perBatch; k++) {
      recordOutcome({ batchId, symbol: `S${k}`, holdDays, grossReturn: 0.01, netReturn: 0.01, controlReturn: 0.004 }, j);
    }
  }
}

test("twenty daily sessions on a five-day hold are four periods, not a hundred trades", () => {
  const j = tmp();
  syntheticRun(j, { sessions: 20, perBatch: 5, holdDays: 5 });

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.outcomes, 100, "the trade count is still reported");
  assert.equal(s.periods, 4, "but the independent unit is the non-overlapping holding period");
  assert.equal(s.holdDays, 5);
});

test("the hold length moves the period count and nothing else about the sample", () => {
  for (const [holdDays, expected] of [[1, 20], [2, 10], [5, 4], [10, 2], [21, 1]]) {
    const j = tmp();
    syntheticRun(j, { sessions: 20, perBatch: 3, holdDays });
    const s = scoreJournal(j, { mode: MODE.PAPER });
    assert.equal(s.periods, expected, `hold ${holdDays} should give ${expected} periods`);
    assert.equal(s.outcomes, 60, "the trade count does not depend on the hold");
  }
});

test("the edge interval is drawn over periods, so it is wider than one drawn over trades", () => {
  // The whole reason the period count is load-bearing. Same numbers, two cluster definitions.
  const j = tmp();
  const t0 = 1_760_000_000;
  for (let s = 0; s < 20; s++) {
    const asOfTime = t0 + s * DAY;
    const batchId = `paper-${s}`;
    const allowed = [{ symbol: "AAA", action: "buy", targetPct: 0.05 }, { symbol: "BBB", action: "buy", targetPct: 0.05 }];
    recordDecision({ batchId, at: new Date(asOfTime * 1000).toISOString(), mode: MODE.PAPER,
      context: { asOfTime }, proposals: allowed, gate: { allowed, rejected: [] }, pool: [] }, j);
    // A whole-period shock: every name in a five-day block shares it. That is exactly the
    // dependence that resampling by trade assumes away.
    const shock = Math.floor(s / 5) % 2 === 0 ? 0.03 : -0.03;
    for (const sym of ["AAA", "BBB"]) {
      recordOutcome({ batchId, symbol: sym, holdDays: 5, grossReturn: shock, netReturn: shock, controlReturn: 0 }, j);
    }
  }

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.periods, 4);
  assert.equal(s.edgeCI.nominalN, 40, "forty trades went in");
  assert.equal(s.edgeCI.clusters, 4, "four clusters came out");
  assert.ok(s.edgeCI.hi - s.edgeCI.lo > 0.02,
    `an interval over four correlated periods should be wide; got ${s.edgeCI.lo}..${s.edgeCI.hi}`);
});

test("an outcome whose decision is missing does not manufacture a period", () => {
  // One shared bucket for unknowns. One bucket each would invent independence, and every mistake
  // this project has made about evidence has been in that direction.
  const j = tmp();
  syntheticRun(j, { sessions: 5, perBatch: 2, holdDays: 5 });
  recordOutcome({ batchId: "paper-orphan-1", symbol: "ZZZ", holdDays: 5, netReturn: 0.5, controlReturn: 0 }, j);
  recordOutcome({ batchId: "paper-orphan-2", symbol: "YYY", holdDays: 5, netReturn: 0.5, controlReturn: 0 }, j);

  const { records } = readJournal(j);
  const decisions = records.filter((r) => r.kind === KIND.DECISION);
  const outcomes = records.filter((r) => r.kind === KIND.OUTCOME);
  const keys = holdPeriodKeys(decisions, outcomes, 5);
  assert.equal(new Set(keys.filter((k) => k === "period:unknown")).size, 1);
  assert.equal(keys.filter((k) => k === "period:unknown").length, 2, "both orphans share one bucket");
});

test("a run with no outcomes reports no periods rather than a spurious one", () => {
  const j = tmp();
  recordDecision({ batchId: "paper-0", mode: MODE.PAPER, context: { asOfTime: 1_760_000_000 },
    proposals: [], gate: { allowed: [], rejected: [] }, pool: [] }, j);
  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.outcomes, 0);
  assert.equal(s.periods, 0);
  assert.equal(s.edgeCI.lo, null);
});

// ---- where the journal lives -------------------------------------------------------------------

test("the default journal path is absolute and anchored to the repository, not the cwd", () => {
  // The defect: as a bare relative name, running `paper` from a subdirectory started a SECOND
  // journal with no error, and `settle` then found nothing to settle because the decisions were in
  // the other file. Criterion 7 is one of the four that stop the run; it must not fail for this.
  assert.ok(path.isAbsolute(DEFAULT_JOURNAL), `not absolute: ${DEFAULT_JOURNAL}`);
  assert.equal(path.basename(DEFAULT_JOURNAL), "analyst-journal.jsonl");
  // journal.mjs lives in analyst/, so the repository root is its parent.
  assert.equal(path.dirname(DEFAULT_JOURNAL), path.resolve(import.meta.dirname, ".."));
});

test("the default path does not move when the process changes directory", () => {
  const before = DEFAULT_JOURNAL;
  const cwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    // Re-resolving from the same module must give the same answer; a cwd-relative default would
    // not, and that difference is the whole bug.
    assert.equal(DEFAULT_JOURNAL, before);
    assert.equal(path.resolve(DEFAULT_JOURNAL), before);
  } finally { process.chdir(cwd); }
});

test("a single period reports no interval rather than a zero-width one", () => {
  // Found by running the chain, not by the suite: five decisions that all landed in one period
  // printed "95% CI -1.61% .. -1.61%". A cluster bootstrap with one cluster redraws that cluster
  // every iteration, so the bounds equal the point estimate. Zero width reads as precision and
  // means the opposite, which is the most flattering possible way to report no information.
  const j = tmp();
  syntheticRun(j, { sessions: 3, perBatch: 4, holdDays: 5 });

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.periods, 1);
  assert.equal(s.edgeCI.degenerate, true);
  assert.equal(s.edgeCI.lo, null);
  assert.equal(s.edgeCI.hi, null);
  // The point estimate is still reported; it is the INTERVAL that does not exist.
  assert.ok(Number.isFinite(s.edge));
  assert.equal(s.edgeCI.nominalN, 12, "the trades still went in");
});

test("two or more periods do get a real interval", () => {
  const j = tmp();
  syntheticRun(j, { sessions: 20, perBatch: 4, holdDays: 5 });

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.periods, 4);
  assert.equal(s.edgeCI.degenerate, false);
  assert.ok(Number.isFinite(s.edgeCI.lo));
  assert.ok(Number.isFinite(s.edgeCI.hi));
});

// ---- the span is measured on the decision bars -------------------------------------------------

test("span is the period the decisions cover, not the minute they were written", () => {
  // Read off write timestamps, five batches covering four weeks reported 0 days, because a replayed
  // journal writes every record in the same minute. meetsStandingMinimum gates on this, so such a
  // journal could never reach the 60-day floor however much history it held.
  const j = tmp();
  const write = new Date().toISOString();          // every record written NOW, as a replay would
  for (let s = 0; s < 5; s++) {
    recordDecision({
      batchId: `paper-${s}`, at: write, mode: MODE.PAPER,
      context: { asOfTime: 1_760_000_000 + s * 7 * DAY },   // but decided a week apart
      proposals: [], gate: { allowed: [], rejected: [] }, pool: [],
    }, j);
  }

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.spanDays, 28, "four weeks of decision bars, all written in one minute");
});

test("the standing minimum can be reached by a journal that was not written in real time", () => {
  const j = tmp();
  const write = new Date().toISOString();
  // 70 sessions, one sized name each: past the 60-day floor, short of the 50-trade one.
  for (let s = 0; s < 70; s++) {
    const allowed = [{ symbol: "AAA", action: "buy", targetPct: 0.05 }];
    recordDecision({
      batchId: `paper-${s}`, at: write, mode: MODE.PAPER,
      context: { asOfTime: 1_760_000_000 + s * DAY },
      proposals: allowed, gate: { allowed, rejected: [] }, pool: [],
    }, j);
  }

  const s = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(s.spanDays, 69);
  assert.equal(s.decisions, 70);
  assert.equal(s.meetsStandingMinimum, true, "60 days and 50 trades are both met");
});

test("a record written before asOfTime existed falls back to its write timestamp", () => {
  // Older journals have no decision bar. Mixing a bar time with a write time is imperfect and is
  // strictly closer than using write times throughout; what it must not do is return NaN.
  const t = Date.parse("2026-07-09T00:00:00Z");
  assert.equal(decisionTimeMs({ at: "2026-07-09T00:00:00Z" }), t);
  assert.equal(decisionTimeMs({ asOfTime: 1_760_000_000, at: "2026-07-09T00:00:00Z" }), 1_760_000_000_000);
  assert.ok(Number.isNaN(decisionTimeMs({})), "no usable time is NaN, which every caller filters");
});
