/**
 * The audit checklist: does it reach the decider, does it stay unvalidated reading, and does every
 * control still fail closed with it switched on?
 *
 * The last question is the one that matters. The checklist is guidance drawn from books this project
 * has not validated; the moment it softens a gate, a veto or a guard, unvalidated reading has become
 * enforcement. Each control below is exercised WITH the checklist present, so a future edit to the
 * text cannot quietly buy the model any latitude.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUDIT_CHECKLIST, CHECKLIST_ID } from "./checklist.mjs";
import { buildSystemPrompt, normalise, decide } from "./decide.mjs";
import { runOnce, PAPER_FRESHNESS_MS } from "./loop.mjs";
import { readJournal, scoreJournal, recordDecision, recordOutcome, KIND, MODE } from "./journal.mjs";

const DAY = 86400;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "checklist-")), "j.jsonl");

/** A panel ending `endingDaysAgo` before `now`. Same shape as loop.test.mjs uses. */
function panel(symbols, n = 400, now = Date.now(), endingDaysAgo = 0) {
  const lastTime = Math.floor(now / 1000) - endingDaysAgo * DAY;
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(lastTime - i * DAY);
  const series = {};
  symbols.forEach((sym, k) => {
    const bars = [];
    let px = 100;
    for (let i = 0; i < n; i++) {
      px *= 1 + (k - symbols.length / 2) * 0.0005 + Math.sin(i / 9 + k) * 0.003;
      bars.push({ time: dates[i], open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 2e6 });
    }
    series[sym] = bars;
  });
  return { series, dates };
}

const SYMS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];

const fakeMessage = (text, stop_reason = "end_turn") => ({
  id: "msg_01Fake", container: null,
  content: [{ type: "text", text, citations: null }],
  model: "claude-sonnet-4-6", role: "assistant",
  stop_details: null, stop_reason, stop_sequence: null, type: "message",
  usage: { input_tokens: 100, output_tokens: 50 },
});

/** Captures the system prompt it was sent, so injection can be asserted rather than assumed. */
function capturingClient(decisions) {
  const seen = { system: null, calls: 0 };
  return {
    seen,
    client: {
      messages: {
        create: async ({ system }) => {
          seen.system = system;
          seen.calls++;
          return fakeMessage(JSON.stringify({ decisions }));
        },
      },
    },
  };
}

const buy = (symbol, over = {}) => ({
  symbol, action: "buy", targetPct: 0.05, confidence: 0.7,
  thesis: "momentum and breadth both confirm here", ...over,
});

// ---- what the text is, and is not --------------------------------------------------------------

test("the checklist introduces no numbers, so it cannot smuggle in a threshold", () => {
  // The standing instruction is that it invents no numeric rule. A digit in this text would either
  // be a threshold nobody validated or an example that reads as one. The binding numbers come from
  // risk.mjs and are stated separately in the HARD CONSTRAINTS block.
  const digits = AUDIT_CHECKLIST.match(/\d/g) ?? [];
  assert.deepEqual(digits, [], `the checklist must contain no digits; found ${digits.join("")}`);
  assert.ok(!AUDIT_CHECKLIST.includes("%"), "no percentages either");
});

test("the checklist says on its face that it is unvalidated and binds nothing", () => {
  // A reader of the prompt -- human or model -- must be able to tell guidance from enforcement.
  assert.match(AUDIT_CHECKLIST, /NOT from anything this system has measured/);
  assert.match(AUDIT_CHECKLIST, /establish no edge/);
  assert.match(AUDIT_CHECKLIST, /READING-NOTES\.md/);
  // And it must name the honest blank, or the model fills the fields with something plausible.
  assert.match(AUDIT_CHECKLIST, /not known from this context/);
});

test("the checklist asks for checkable assumptions, not a polished thesis", () => {
  assert.match(AUDIT_CHECKLIST, /invalidation/);
  assert.match(AUDIT_CHECKLIST, /costAssumption/);
  assert.match(AUDIT_CHECKLIST, /if the market turns/);   // named as what NOT to write
});

// ---- injection ---------------------------------------------------------------------------------

test("the prompt carries the checklist when given one and not otherwise", () => {
  const withIt = buildSystemPrompt({ checklist: AUDIT_CHECKLIST });
  const without = buildSystemPrompt({});
  assert.ok(withIt.includes(AUDIT_CHECKLIST));
  assert.ok(!without.includes("AUDIT QUESTIONS"));
  // The hard constraints survive in both, and come FIRST: code above unvalidated reading.
  for (const p of [withIt, without]) assert.match(p, /HARD CONSTRAINTS/);
  assert.ok(withIt.indexOf("HARD CONSTRAINTS") < withIt.indexOf("AUDIT QUESTIONS"),
    "the enforced limits must precede the unvalidated questions");
});

test("paper mode sends the checklist to the model and records which arm the batch was in", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const { seen, client } = capturingClient([buy("AAA")]);

  const r = await runOnce({
    series, dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
    checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
  });

  assert.equal(seen.calls, 1);
  assert.ok(seen.system.includes("AUDIT QUESTIONS"), "the checklist never reached the model");
  assert.equal(r.record.mode, MODE.PAPER);
  assert.equal(r.record.checklistId, CHECKLIST_ID);
});

test("the control arm is a real arm: no checklist in the prompt, null in the journal", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const { seen, client } = capturingClient([buy("AAA")]);

  const r = await runOnce({ series, dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j });

  assert.ok(!seen.system.includes("AUDIT QUESTIONS"));
  assert.equal(r.record.checklistId, null);
});

test("a batch lost to the model is attributed to the arm that produced it", async () => {
  // Otherwise a checklist that makes the model refuse or ramble would look like a clean run in the
  // arm that did not cause it, and criterion 4's loss rate would be charged to the wrong side.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const refusing = { messages: { create: async () => fakeMessage("I cannot help with that.") } };

  const r = await runOnce({
    series, dates, client: refusing, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
    checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
  });

  assert.ok(r.skipped, "a refusal is still a failure");
  assert.equal(r.record.checklistId, CHECKLIST_ID);
});

// ---- the optional fields ------------------------------------------------------------------------

test("the two checklist fields are recorded when offered", () => {
  const { proposals, dropped } = normalise([
    buy("AAA", { invalidation: "closes below the 200-day", costAssumption: "not known from this context" }),
  ], new Set(["AAA"]));
  assert.equal(dropped.length, 0);
  assert.equal(proposals[0].invalidation, "closes below the 200-day");
  assert.equal(proposals[0].costAssumption, "not known from this context");
});

test("omitting them is NEVER a drop, and blanks become null rather than empty strings", () => {
  // Requiring them would turn unvalidated reading into a gate, and would pressure the model into
  // inventing an answer instead of declining one.
  const { proposals, dropped } = normalise([
    buy("AAA"),
    buy("BBB", { invalidation: "   ", costAssumption: "" }),
  ], new Set(["AAA", "BBB"]));
  assert.equal(dropped.length, 0, "a proposal without the optional fields is still a proposal");
  assert.equal(proposals[0].invalidation, null);
  assert.equal(proposals[1].invalidation, null);
  assert.equal(proposals[1].costAssumption, null);
});

// ---- the controls still fail closed, WITH the checklist on --------------------------------------

test("a hallucinated symbol is still dropped with the checklist on", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const { client } = capturingClient([buy("NVDA", { invalidation: "sounds authoritative" })]);

  const r = await runOnce({
    series, dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
    checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
  });

  assert.equal(r.gate.allowed.length, 0);
  assert.ok(r.decision.dropped.some((d) => /not in the candidate slate/.test(d.why)),
    "a name that was never on the slate must be dropped however well it is justified");
});

test("the position cap still drops an oversized proposal with the checklist on", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const { client } = capturingClient([
    buy("AAA", { targetPct: 0.9, invalidation: "a very thorough answer", costAssumption: "tight spread" }),
  ]);

  const r = await runOnce({
    series, dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
    checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
  });

  assert.equal(r.gate.allowed.length, 0, "answering the audit questions does not buy a bigger position");
  assert.ok(r.decision.dropped.length || r.gate.rejected.length);
});

test("the stale-panel guard still refuses with the checklist on", async () => {
  const now = Date.now();
  const stale = panel(SYMS, 400, now, 30);
  const j = tmp();
  const { client } = capturingClient([buy("AAA")]);

  await assert.rejects(
    () => runOnce({
      series: stale.series, dates: stale.dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
      checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
    }),
    /refusing to run paper mode/,
  );
  assert.equal(readJournal(j).records.filter((r) => r.kind === KIND.DECISION).length, 0);
  assert.equal(readJournal(j).records.filter((r) => r.kind === KIND.SKIP).length, 1);
});

test("the future-dated guard still refuses with the checklist on", async () => {
  const now = Date.now();
  const ahead = panel(SYMS, 400, now, -3);
  const j = tmp();
  const { client } = capturingClient([buy("AAA")]);

  await assert.rejects(
    () => runOnce({
      series: ahead.series, dates: ahead.dates, client, mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
      checklist: AUDIT_CHECKLIST, checklistId: CHECKLIST_ID,
    }),
    /in the FUTURE/,
  );
});

test("a truncated response is still discarded whole with the checklist on", async () => {
  // The checklist makes the response longer by asking for two more fields, which makes hitting
  // max_tokens likelier. A half-written book must still be discarded, never salvaged.
  const truncating = {
    messages: {
      create: async () => fakeMessage('{"decisions": [{"symbol": "AAA", "action": "b', "max_tokens"),
    },
  };
  const out = await decide({ client: truncating, context: { candidates: [{ symbol: "AAA" }] }, checklist: AUDIT_CHECKLIST });
  assert.equal(out.proposals.length, 0);
  assert.ok(out.failure, "a truncated batch is a failure, not a partial success");
});

// ---- the safeguard: the effect is measurable ----------------------------------------------------

test("the score splits outcomes by arm and refuses to compare until both are populated", () => {
  const j = tmp();
  const t0 = 1_760_000_000;
  const write = new Date().toISOString();
  // 3 batches with the checklist, 2 without. Far short of the floor on both sides.
  for (let s = 0; s < 5; s++) {
    const allowed = [{ symbol: "AAA", action: "buy", targetPct: 0.05 }];
    recordDecision({
      batchId: `paper-${s}`, at: write, mode: MODE.PAPER, context: { asOfTime: t0 + s * DAY },
      proposals: allowed, gate: { allowed, rejected: [] }, pool: [],
      checklistId: s < 3 ? CHECKLIST_ID : null,
    }, j);
    recordOutcome({ batchId: `paper-${s}`, symbol: "AAA", holdDays: 5, netReturn: 0.01, controlReturn: 0.004 }, j);
  }

  const cs = scoreJournal(j, { mode: MODE.PAPER }).checklistSplit;
  assert.equal(cs.withChecklist.n, 3);
  assert.equal(cs.withoutChecklist.n, 2);
  assert.equal(cs.comparable, false, "five outcomes cannot answer whether the reading changed anything");
  assert.deepEqual(cs.ids, [CHECKLIST_ID, null], "both arms are named, nulls last");
});

test("a run with no control arm reports zero on that side rather than implying a comparison", () => {
  const j = tmp();
  const write = new Date().toISOString();
  for (let s = 0; s < 4; s++) {
    const allowed = [{ symbol: "AAA", action: "buy", targetPct: 0.05 }];
    recordDecision({
      batchId: `paper-${s}`, at: write, mode: MODE.PAPER, context: { asOfTime: 1_760_000_000 + s * DAY },
      proposals: allowed, gate: { allowed, rejected: [] }, pool: [], checklistId: CHECKLIST_ID,
    }, j);
    recordOutcome({ batchId: `paper-${s}`, symbol: "AAA", holdDays: 5, netReturn: 0.02, controlReturn: 0.01 }, j);
  }

  const cs = scoreJournal(j, { mode: MODE.PAPER }).checklistSplit;
  assert.equal(cs.withoutChecklist.n, 0);
  assert.equal(cs.withoutChecklist.edge, null, "no control arm means no edge to report on that side");
  assert.equal(cs.comparable, false);
});
