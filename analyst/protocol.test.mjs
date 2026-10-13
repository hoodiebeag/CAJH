import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordDecision, recordOutcome, recordSkip, MODE, SKIP_REASON } from "./journal.mjs";
import { REJECT } from "./risk.mjs";
import { BATCH_FAILURE } from "./decide.mjs";
import { tier1 } from "./protocol.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "protocol-")), "j.jsonl");
const DAY = 86400;
const T0 = 1_760_000_000;
const by = (r, n) => r.criteria.find((c) => c.n === n);

/** One healthy batch: two sized names, both with news, one rejection, settled. */
function healthyBatch(j, s, { at = null, rejected = [REJECT.POSITION_CAP], hadNews = true, settle = true } = {}) {
  const asOfTime = T0 + s * DAY;
  const batchId = `paper-${s}`;
  const allowed = [
    { symbol: "AAA", action: "buy", targetPct: 0.05 },
    { symbol: "BBB", action: "buy", targetPct: 0.05 },
  ];
  recordDecision({
    batchId, at: at ?? new Date(asOfTime * 1000).toISOString(), mode: MODE.PAPER,
    context: { asOfTime },
    proposals: allowed.map((a) => ({ ...a, thesis: `${a.symbol} broke out on volume` })),
    gate: { allowed, rejected: rejected.map((code) => ({ proposal: { symbol: "CCC" }, code, detail: "d" })) },
    pool: [], newsSymbols: hadNews ? new Set(["AAA", "BBB"]) : new Set(),
  }, j);
  if (settle) {
    for (const a of allowed) {
      recordOutcome({ batchId, symbol: a.symbol, holdDays: 5, grossReturn: 0.01, netReturn: 0.01, controlReturn: 0.005 }, j);
    }
  }
  return batchId;
}

/** `now` far enough past the last batch that every hold has elapsed. */
const wellAfter = (sessions) => (T0 + sessions * DAY) * 1000 + 30 * 86400000;

test("a clean run passes every computable criterion and claims nothing about the manual ones", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s);

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(r.verdict, "PASS");
  for (const n of [1, 2, 3, 4, 5, 7, 8]) assert.equal(by(r, n).status, "pass", `criterion ${n}`);
  // The three that no file can answer say so rather than quietly passing.
  for (const n of [6, 9, 10]) assert.equal(by(r, n).status, "manual", `criterion ${n}`);
});

test("the four stopping criteria are marked, and only they produce a STOP", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s);
  const r = tier1(j, { now: wellAfter(20) });

  assert.deepEqual(r.criteria.filter((c) => c.stops).map((c) => c.n), [2, 3, 6, 7]);

  // A non-stopping failure is reported and judged; it does not stop the run.
  const j2 = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j2, s, { hadNews: false });
  const r2 = tier1(j2, { now: wellAfter(20) });
  assert.equal(by(r2, 8).status, "fail");
  assert.equal(r2.verdict, "FAIL", "criterion 8 is not a stopping criterion");
});

test("an unsettled decision past its hold STOPS the run", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s, { settle: s < 18 });

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(by(r, 7).status, "fail");
  assert.equal(by(r, 7).numbers.unsettled, 4, "two batches of two names each");
  assert.equal(r.verdict, "STOP");
  assert.deepEqual(r.stops.map((c) => c.n), [7]);
});

test("a decision still inside its holding period is not counted as unsettled", () => {
  // The defect this guards against was found once already: an unfinished hold recorded as a
  // completed 0% trade. Here the mirror of it -- an unfinished hold reported as a failure.
  const j = tmp();
  healthyBatch(j, 0, { at: new Date(Date.now() - 86400000).toISOString(), settle: false });

  const r = tier1(j, { now: Date.now() });

  assert.equal(by(r, 7).numbers.due, 0, "one day into a five-day hold is not due");
  assert.equal(by(r, 7).status, "pass");
});

test("a point-in-time skip STOPS the run", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s);
  recordSkip({ batchId: "paper-20", mode: MODE.PAPER, reason: SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME }, j);

  const r = tier1(j, { now: wellAfter(21) });

  assert.equal(by(r, 2).status, "fail");
  assert.equal(r.verdict, "STOP");
});

test("refusals on a stale panel are counted without being called a failure", () => {
  // The guard refusing IS the system working. What it must not do is vanish: criterion 3 reports
  // the refusals so a panel that stopped being refreshed is visible rather than silent.
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s);
  for (let s = 0; s < 3; s++) recordSkip({ mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE }, j);
  recordSkip({ mode: MODE.PAPER, reason: SKIP_REASON.PANEL_FUTURE_DATED }, j);

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(by(r, 3).status, "pass", "no batch was decided on a bad panel");
  assert.equal(by(r, 3).numbers.stale, 3);
  assert.equal(by(r, 3).numbers.futureDated, 1);
  assert.match(by(r, 3).detail, /not being refreshed/);
});

test("lost batches are counted against criterion 4 by their recorded failure code", () => {
  const j = tmp();
  for (let s = 0; s < 19; s++) healthyBatch(j, s);
  recordDecision({
    batchId: "paper-lost-0", mode: MODE.PAPER, context: { asOfTime: T0 + 19 * DAY },
    proposals: [], gate: { allowed: [], rejected: [] }, pool: [],
    failure: { code: BATCH_FAILURE.REFUSED, detail: "x" },
  }, j);

  const r = tier1(j, { now: wellAfter(21) });

  assert.equal(by(r, 4).numbers.failed, 1);
  assert.equal(by(r, 4).numbers.batches, 20);
  assert.equal(by(r, 4).numbers.byCode[BATCH_FAILURE.REFUSED], 1);
  assert.equal(by(r, 4).status, "pass", "1 of 20 is 5%");
});

test("criterion 4 is '< 10%', so exactly 10% fails", () => {
  // Pinned because the boundary is the whole content of a threshold, and a pre-registered one does
  // not get relaxed to "about 10%" on the day it is first missed.
  const j = tmp();
  for (let s = 0; s < 18; s++) healthyBatch(j, s);
  for (const [i, code] of [BATCH_FAILURE.REFUSED, BATCH_FAILURE.TRUNCATED].entries()) {
    recordDecision({
      batchId: `paper-lost-${i}`, mode: MODE.PAPER, context: { asOfTime: T0 + (18 + i) * DAY },
      proposals: [], gate: { allowed: [], rejected: [] }, pool: [], failure: { code, detail: "x" },
    }, j);
  }

  const r = tier1(j, { now: wellAfter(21) });

  assert.equal(by(r, 4).numbers.lossRate, 0.1);
  assert.equal(by(r, 4).status, "fail");
});

test("criterion 4 fails at or above the 10% loss threshold", () => {
  const j = tmp();
  for (let s = 0; s < 17; s++) healthyBatch(j, s);
  for (let i = 0; i < 3; i++) {
    recordDecision({
      batchId: `paper-lost-${i}`, mode: MODE.PAPER, context: { asOfTime: T0 + (17 + i) * DAY },
      proposals: [], gate: { allowed: [], rejected: [] }, pool: [],
      failure: { code: BATCH_FAILURE.UNPARSEABLE, detail: "x" },
    }, j);
  }

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(by(r, 4).status, "fail", "3 of 20 is 15%");
  assert.equal(by(r, 4).numbers.byCode[BATCH_FAILURE.UNPARSEABLE], 3);
});

test("a gate that never rejects anything fails criterion 5", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s, { rejected: [] });

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(by(r, 5).status, "fail");
  assert.match(by(r, 5).detail, /not being reached/);
});

test("a rejection code risk.mjs does not define fails criterion 5", () => {
  // "every code is one we can explain" is the criterion. An unknown code is unexplained by
  // definition, and a readout that accepted it would be checking that rejections happened at all.
  const j = tmp();
  for (let s = 0; s < 20; s++) healthyBatch(j, s, { rejected: [s === 0 ? "vibes" : REJECT.POSITION_CAP] });

  const r = tier1(j, { now: wellAfter(20) });

  assert.equal(by(r, 5).status, "fail");
  assert.deepEqual(by(r, 5).numbers.unexplained, ["vibes"]);
});

test("an empty journal reports manual rather than a pass it has not earned", () => {
  const r = tier1(tmp(), { now: Date.now() });
  assert.equal(by(r, 1).status, "manual");
  assert.equal(by(r, 4).status, "manual");
  assert.equal(by(r, 8).status, "manual");
  assert.equal(r.batches, 0);
});

test("dry-run records are not scored as a paper run", () => {
  const j = tmp();
  for (let s = 0; s < 20; s++) {
    recordDecision({
      batchId: `dry-${s}`, mode: MODE.DRY_RUN, context: { asOfTime: T0 + s * DAY },
      proposals: [], gate: { allowed: [], rejected: [] }, pool: [],
    }, j);
  }
  const r = tier1(j, { mode: MODE.PAPER, now: wellAfter(20) });
  assert.equal(r.batches, 0, "a dry run cannot satisfy a criterion about the paper run");
});

// ---- criterion 1 is measured on decision bars, and only in a forward run ------------------------

test("criterion 1 counts the weekdays the decisions cover, not the minute they were written", () => {
  // Read off write timestamps this reported "5 batch(es) over 1 weekday(s)" and PASSED at a ratio
  // of 5.0 -- a pass manufactured by the records having been written together.
  const j = tmp();
  const write = new Date().toISOString();
  for (let s = 0; s < 5; s++) healthyBatch(j, s * 5, { at: write });   // 5 batches, 5 sessions apart

  const r = tier1(j, { now: wellAfter(40) });

  const c = by(r, 1);
  assert.ok(c.numbers.expected >= 15, `expected weekdays should span the bars; got ${c.numbers.expected}`);
  assert.ok(c.numbers.ratio < 0.5, `5 batches over ~4 weeks is sparse; got ratio ${c.numbers.ratio}`);
  assert.equal(c.status, "fail", "a forward run that skipped most sessions has not passed");
});

test("a contiguous forward run passes criterion 1 on the decision bars", () => {
  const j = tmp();
  const write = new Date().toISOString();
  for (let s = 0; s < 20; s++) healthyBatch(j, s, { at: write });      // one per consecutive session

  const r = tier1(j, { now: wellAfter(40) });

  const c = by(r, 1);
  assert.equal(c.status, "pass");
  assert.ok(c.numbers.ratio >= 0.9, `got ${c.numbers.ratio}`);
});

test("criterion 1 reports MANUAL outside a forward run instead of a meaningless pass or fail", () => {
  // A dry run's batches are hand-picked --asOf dates, so the ratio describes the operator's choice.
  // A red line here would be noise in a table where four criteria stop the run.
  const j = tmp();
  const write = new Date().toISOString();
  for (let s = 0; s < 5; s++) {
    recordDecision({
      batchId: `dry-${s}`, at: write, mode: MODE.DRY_RUN,
      context: { asOfTime: T0 + s * 5 * DAY },
      proposals: [], gate: { allowed: [], rejected: [] }, pool: [],
    }, j);
  }

  const r = tier1(j, { mode: MODE.DRY_RUN, now: wellAfter(40) });

  assert.equal(by(r, 1).status, "manual");
  assert.equal(by(r, 1).numbers.forward, false);
  assert.match(by(r, 1).detail, /hand-picked dates/);
});
