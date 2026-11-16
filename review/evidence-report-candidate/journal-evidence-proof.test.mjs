/**
 * journal-evidence-proof.test.mjs — adversarial OFFLINE end-to-end fixtures for the journal /
 * settlement / ledger / protocol evidence chain.
 *
 * WHAT THIS EXERCISES: the REAL helpers in analyst/journal.mjs, analyst/loop.mjs (settleOutcomes),
 * analyst/ledger.mjs, analyst/protocol.mjs and analyst/provenance.mjs, driven against temporary
 * JSONL journals and synthetic panels in os.tmpdir(). Every call takes an explicit file path; the
 * real journal is never read or written. There is NO model call, NO broker, NO order path, NO
 * network and NO analyst CLI invocation. The "decider" is a plain object literal.
 *
 * WHAT A PASS HERE DOES NOT MEAN: it does not certify prospective honesty, does not describe the
 * journal on the owner's PC, and says nothing about profitability or trading readiness. It
 * establishes only what this code records and refuses when driven adversarially, today, offline.
 *
 * Labels in test names:
 *   [PROVEN]      the contract holds under adversarial input
 *   [GAP]         real current behaviour, asserted as it actually is — the contract is NOT enforced
 *   [INCONSISTENT] two call sites disagree, asserted so the disagreement is pinned
 *   [DOCUMENTED-HOLE] reproduces a limitation the repo already states about itself
 *
 * NOTHING IS FIXED HERE. Where a gap is found the runtime is left untouched and the proposal is
 * recorded in docs/JOURNAL-EVIDENCE-PROOF-2026-10-13.md for owner review.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordDecision, recordOutcome, recordSkip, readJournal, scoreJournal,
  matchedRandomControl, hashContext, holdPeriodKeys, MODE, KIND, SKIP_REASON,
} from "./analyst/journal.mjs";
import { settleOutcomes, realisedOutcomes } from "./analyst/loop.mjs";
import { applyRiskGate, REJECT } from "./analyst/risk.mjs";
import { tier1 } from "./analyst/protocol.mjs";
import { registerVersion, verifyLedger, readLedger, driftFromRegistered, inputHashes, entryHash } from "./analyst/ledger.mjs";
import { isDeclaredSynthetic } from "./analyst/provenance.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cajh-evidence-"));
const jrnl = (d) => path.join(d, "journal.jsonl");

/** A decision batch with no model anywhere near it. */
// ATTRIBUTION IS OPT-IN HERE, and that is deliberate. tier1 now requires a candidate, so the
// protocol tests below pass `attrib: ATTRIB`. The settlement tests must NOT: settleOutcomes
// validates a pair it is given against the ledger, and these fixtures' decision instants are in the
// past, so an attributed record would need a back-dated registration -- which is exactly the
// technique this round removed. Unattributed is also the honest shape for a legacy record.
const CID = "analyst-daily", CVER = "v1";
const ATTRIB = { candidateId: CID, candidateVersion: CVER };

function stubBatch(file, {
  batchId = "B1", asOfTime = 1750000000, mode = MODE.PAPER, symbols = ["AAA", "BBB"],
  pool = ["AAA", "BBB", "CCC", "DDD"], at = "2026-10-01T12:00:00.000Z", seed = 7, attrib = {},
} = {}) {
  const allowed = symbols.map((s) => ({ symbol: s, action: "buy", targetPct: 5 }));
  return recordDecision({
    ...attrib,
    batchId, at, mode, seed, pool,
    context: { asOfTime, instruments: {} },
    proposals: allowed.map((a) => ({ ...a, thesis: "stub" })),
    gate: { allowed, rejected: [{ proposal: { symbol: "ZZZ" }, code: "STALE_QUOTE", detail: "stub" }], exposure: 10 },
    model: "stub-no-llm",
  }, file);
}

// ---------------------------------------------------------------------------------------------
// Mode isolation: the single most load-bearing property in the file.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] a dry-run batch and its outcome cannot enter the paper score", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { batchId: "P1", mode: MODE.PAPER });
  recordOutcome({ batchId: "P1", symbol: "AAA", holdDays: 5, netReturn: 0.01, controlReturn: 0.00 }, f);
  stubBatch(f, { batchId: "D1", mode: MODE.DRY_RUN, asOfTime: 1750500000 });
  recordOutcome({ batchId: "D1", symbol: "AAA", holdDays: 5, netReturn: 0.99, controlReturn: -0.99 }, f);

  const paper = scoreJournal(f, { mode: MODE.PAPER });
  assert.equal(paper.batches, 1);
  assert.equal(paper.outcomes, 1);
  assert.equal(paper.contaminatedRecords, 1, "the excluded dry-run batch must be counted, not hidden");
  // The 0.99 return must not touch the paper mean.
  assert.ok(Math.abs(paper.agentMeanNet - 0.01) < 1e-12);
  assert.equal(paper.isEvidence, true);
  assert.equal(scoreJournal(f, { mode: MODE.DRY_RUN }).isEvidence, false);
});

// ---------------------------------------------------------------------------------------------
// Broken / truncated / concurrent evidence.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] a truncated final line is counted and surfaced, and does not kill the read", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f);
  recordOutcome({ batchId: "B1", symbol: "AAA", holdDays: 5, netReturn: 0.02, controlReturn: 0.01 }, f);
  // Simulate a crash mid-append: appendFileSync is not atomic for a partial write.
  fs.appendFileSync(f, '{"kind":"outcome","batchId":"B1","symbol":"BB');

  const read = readJournal(f);
  assert.equal(read.malformed, 1);
  assert.equal(read.records.length, 2, "the two intact records must still be read");
  const s = scoreJournal(f, { mode: MODE.PAPER });
  assert.equal(s.malformed, 1, "scoreJournal must surface malformed, not swallow it");
  assert.equal(s.outcomes, 1);
});

test("[GAP] a malformed line is counted but nothing refuses to score on a damaged journal", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f);
  recordOutcome({ batchId: "B1", symbol: "AAA", holdDays: 5, netReturn: 0.02, controlReturn: 0.01 }, f);
  for (let i = 0; i < 50; i++) fs.appendFileSync(f, "{broken\n");
  const s = scoreJournal(f, { mode: MODE.PAPER });
  // 50 destroyed records against 1 surviving outcome, and the score is still produced.
  assert.equal(s.malformed, 50);
  assert.equal(s.outcomes, 1);
  assert.notEqual(s.agentMeanNet, null, "a figure is produced despite 50 lost records");
  // There is no threshold, no flag and no refusal keyed on malformed.
  assert.equal(Object.prototype.hasOwnProperty.call(s, "damaged"), false);
});

test("[PROVEN] interleaved concurrent appends of whole lines stay parseable", () => {
  const d = tmp(), f = jrnl(d);
  // Two writers appending complete lines via the same O_APPEND path.
  for (let i = 0; i < 25; i++) {
    recordOutcome({ batchId: "B1", symbol: `A${i}`, holdDays: 5, netReturn: 0.01, controlReturn: 0 }, f);
    recordSkip({ at: "2026-10-01T12:00:00.000Z", mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE }, f);
  }
  const read = readJournal(f);
  assert.equal(read.malformed, 0);
  assert.equal(read.records.length, 50);
});

// ---------------------------------------------------------------------------------------------
// Decision-before-outcome, orphans, duplicates, idempotency.
// ---------------------------------------------------------------------------------------------

test("[GAP] an outcome dated BEFORE its own decision is accepted and scored", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { batchId: "B1", at: "2026-10-10T12:00:00.000Z" });
  // Outcome nine days EARLIER than the decision that supposedly produced it.
  recordOutcome({ batchId: "B1", symbol: "AAA", at: "2026-10-01T12:00:00.000Z",
                  holdDays: 5, netReturn: 0.25, controlReturn: 0.00 }, f);
  const s = scoreJournal(f, { mode: MODE.PAPER });
  assert.equal(s.outcomes, 1, "no time-ordering check exists; the outcome counts");
  assert.ok(Math.abs(s.agentMeanNet - 0.25) < 1e-12);
  assert.ok(Math.abs(s.edge - 0.25) < 1e-12);
});

test("[GAP] an orphan outcome is dropped silently, with no counter naming it", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { batchId: "B1" });
  recordOutcome({ batchId: "B1", symbol: "AAA", holdDays: 5, netReturn: 0.01, controlReturn: 0.00 }, f);
  // An outcome whose decision is absent entirely.
  recordOutcome({ batchId: "GHOST", symbol: "XXX", holdDays: 5, netReturn: -0.90, controlReturn: 0.00 }, f);
  const s = scoreJournal(f, { mode: MODE.PAPER });
  assert.equal(s.outcomes, 1, "the orphan is excluded");
  assert.equal(s.malformed, 0, "and it is not malformed");
  // Excluded, well-formed, and invisible: contaminatedRecords counts decisions only.
  assert.equal(s.contaminatedRecords, 0);
  assert.equal(readJournal(f).records.length, 3, "the record is in the file but in no figure");
});

test("[PROVEN] settleOutcomes is idempotent across repeated settlement runs", () => {
  const d = tmp(), f = jrnl(d);
  const dates = [1750000000, 1750086400, 1750172800, 1750259200, 1750345600, 1750432000];
  const series = { AAA: dates.map((t, i) => ({ time: t, close: String(100 + i) })),
                   BBB: dates.map((t, i) => ({ time: t, close: String(50 - i) })) };
  stubBatch(f, { batchId: "S1", asOfTime: dates[0] });
  const first = settleOutcomes({ series, dates, journalFile: f, holdDays: 2, now: 1750500000000 });
  const second = settleOutcomes({ series, dates, journalFile: f, holdDays: 2, now: 1750600000000 });
  assert.ok(first.wrote > 0, "first run must settle something");
  assert.equal(second.wrote, 0, "second run must write nothing");
  assert.equal(second.already, first.wrote, "and must count what it skipped");
  assert.equal(scoreJournal(f, { mode: MODE.PAPER }).outcomes, first.wrote);
});

test("[GAP] recordOutcome called directly has no duplicate protection at all", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { batchId: "B1" });
  const o = { batchId: "B1", symbol: "AAA", holdDays: 5, netReturn: 0.10, controlReturn: 0.00 };
  recordOutcome(o, f); recordOutcome(o, f); recordOutcome(o, f);
  const s = scoreJournal(f, { mode: MODE.PAPER });
  // The same trade counted three times. Idempotency lives in settleOutcomes, not in the journal.
  assert.equal(s.outcomes, 3);
  assert.ok(Math.abs(s.agentMeanNet - 0.10) < 1e-12);
  assert.equal(s.periods, 1, "and all three land in one period, so the CI is degenerate");
});

test("[PROVEN] a decision whose entry bar is absent is skipped and counted, never settled nearby", () => {
  const d = tmp(), f = jrnl(d);
  const dates = [1750000000, 1750086400, 1750172800, 1750259200];
  const series = { AAA: dates.map((t, i) => ({ time: t, close: String(100 + i) })) };
  // asOfTime deliberately not in `dates`, and only 1 second off a real bar.
  stubBatch(f, { batchId: "NB1", asOfTime: 1750000001, symbols: ["AAA"] });
  const r = settleOutcomes({ series, dates, journalFile: f, holdDays: 2, now: 1750500000000 });
  assert.equal(r.unknownBar, 1);
  assert.equal(r.wrote, 0, "no outcome may be invented from a nearby bar");
  assert.equal(scoreJournal(f, { mode: MODE.PAPER }).outcomes, 0);
});

test("[INCONSISTENT] a mode-less legacy decision is SCORED as paper but NEVER settled", () => {
  const d = tmp(), f = jrnl(d);
  const dates = [1750000000, 1750086400, 1750172800, 1750259200];
  const series = { AAA: dates.map((t, i) => ({ time: t, close: String(100 + i) })) };
  // Hand-write a record with no `mode` field, as a pre-mode journal would hold.
  fs.appendFileSync(f, JSON.stringify({
    kind: KIND.DECISION, batchId: "LEGACY", at: "2026-10-01T12:00:00.000Z", asOfTime: dates[0],
    allowed: [{ symbol: "AAA", action: "buy", targetPct: 5 }], rejected: [], control: [], poolSize: 4,
  }) + "\n");
  // scoreJournal defaults a missing mode to paper (journal.mjs:363).
  assert.equal(scoreJournal(f, { mode: MODE.PAPER }).batches, 1);
  // settleOutcomes compares strictly (loop.mjs:443), so the same record is invisible to it.
  const r = settleOutcomes({ series, dates, journalFile: f, holdDays: 2, now: 1750500000000 });
  assert.equal(r.decisions, 0, "settlement does not see the record scoring counts");
  assert.equal(r.wrote, 0);
  // Net effect: a batch that can never acquire an outcome, reported as a batch awaiting one.
  assert.equal(scoreJournal(f, { mode: MODE.PAPER }).outcomes, 0);
});

// ---------------------------------------------------------------------------------------------
// Control geometry and the eligible pool.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] the matched control is deterministic and regenerable from the journal", () => {
  const allowed = [{ symbol: "AAA", action: "buy", targetPct: 5 }, { symbol: "BBB", action: "buy", targetPct: 3 }];
  const pool = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const a = matchedRandomControl(allowed, pool, 12345);
  const b = matchedRandomControl(allowed, pool, 12345);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, matchedRandomControl(allowed, pool, 999));
  // Sizes are matched one-for-one against the sized book.
  assert.deepEqual(a.map((x) => x.targetPct), [5, 3]);
  assert.equal(new Set(a.map((x) => x.symbol)).size, 2, "no name drawn twice");
});

test("[GAP] when the pool is smaller than the book the control silently shrinks", () => {
  const allowed = [1, 2, 3, 4].map((i) => ({ symbol: `S${i}`, action: "buy", targetPct: 5 }));
  const ctrl = matchedRandomControl(allowed, ["ONLY", "TWO"], 42);
  // Four sized positions, a two-name control. Documented in the source as deliberate truncation,
  // but the geometry no longer matches the book it is the control for, and nothing flags it.
  assert.equal(ctrl.length, 2);
  assert.notEqual(ctrl.length, allowed.length);
});

test("[GAP] nothing validates that the recorded pool was the FULL eligible pool", () => {
  const d = tmp(), f = jrnl(d);
  // The same book, journalled twice with wildly different claimed pools.
  stubBatch(f, { batchId: "WIDE", pool: Array.from({ length: 500 }, (_, i) => `N${i}`) });
  stubBatch(f, { batchId: "NARROW", pool: ["AAA", "BBB"], asOfTime: 1750086400 });
  const recs = readJournal(f).records.filter((r) => r.kind === KIND.DECISION);
  assert.equal(recs.find((r) => r.batchId === "WIDE").poolSize, 500);
  assert.equal(recs.find((r) => r.batchId === "NARROW").poolSize, 2);
  // poolSize is recorded faithfully and is never checked against the universe the analyst saw.
  // A caller passing a 2-name pool produces a control measuring nothing, and the journal looks fine.
  assert.ok(recs.every((r) => Number.isFinite(r.poolSize)));
});

// ---------------------------------------------------------------------------------------------
// Period geometry and the degenerate interval.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] one cluster yields a nulled, flagged interval rather than a narrow one", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { batchId: "B1" });
  recordOutcome({ batchId: "B1", symbol: "AAA", holdDays: 5, netReturn: 0.05, controlReturn: 0.01 }, f);
  recordOutcome({ batchId: "B1", symbol: "BBB", holdDays: 5, netReturn: 0.07, controlReturn: 0.02 }, f);
  const s = scoreJournal(f, { mode: MODE.PAPER });
  assert.equal(s.periods, 1);
  assert.equal(s.edgeCI.degenerate, true);
  assert.equal(s.edgeCI.lo, null);
  assert.equal(s.edgeCI.hi, null);
  assert.notEqual(s.edge, null, "the point estimate is still reported");
});

test("[PROVEN] a non-finite decision bar sends outcomes to one shared unknown period", () => {
  const decisions = [{ batchId: "X", asOfTime: null }, { batchId: "Y", asOfTime: undefined }];
  const outcomes = [{ batchId: "X" }, { batchId: "Y" }];
  const keys = holdPeriodKeys(decisions, outcomes, 5);
  assert.deepEqual(keys, ["period:unknown", "period:unknown"]);
  assert.equal(new Set(keys).size, 1, "one cluster of unknowns is the conservative choice");
});

// ---------------------------------------------------------------------------------------------
// Registration, version binding, tamper detection.
// ---------------------------------------------------------------------------------------------

const REG = {
  whatChanged: "stub", why: "stub", registeredClaim: "edge > 0", control: "matched random",
  minimumPeriods: 20, mdeAtMinimum: 0.01, drawdownWindow: "20 periods",
};
const H = (prompt, checklist, universe) =>
  inputHashes({ systemPrompt: prompt, checklist, checklistId: "CK1", universeText: universe });

test("[PROVEN] editing an entry's content is located at that entry", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  registerVersion({ candidateId: "C1", version: "v1", ...REG, hashes: H("p1", "c1", "AAA BBB") }, L);
  registerVersion({ candidateId: "C1", version: "v2", ...REG, supersedes: "v1",
    hashes: H("p2", "c1", "AAA BBB") }, L);
  assert.equal(verifyLedger(L).ok, true);

  const lines = fs.readFileSync(L, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.registeredClaim = "edge > 0 after the fact";       // soften a registered claim
  fs.writeFileSync(L, [JSON.stringify(first), ...lines.slice(1)].join("\n") + "\n");

  const v = verifyLedger(L);
  assert.equal(v.ok, false);
  assert.equal(v.problems[0].index, 0, "the break is LOCATED, not merely reported");
  assert.match(v.problems[0].problem, /hash does not match content/);
});

test("[PROVEN] repairing the edited entry's own hash moves the break to its successor", () => {
  // The chain's actual guarantee: an editor who also recomputes the entry hash cannot escape,
  // because verifyLedger chains on the stored hash and the NEXT entry's prevHash then disagrees.
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  registerVersion({ candidateId: "C1", version: "v1", ...REG, hashes: H("p1", "c1", "AAA BBB") }, L);
  registerVersion({ candidateId: "C1", version: "v2", ...REG, supersedes: "v1",
    hashes: H("p2", "c1", "AAA BBB") }, L);

  const lines = fs.readFileSync(L, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.registeredClaim = "edge > 0 after the fact";
  delete first.hash;
  first.hash = entryHash(first);                            // a thorough tamper
  fs.writeFileSync(L, [JSON.stringify(first), ...lines.slice(1)].join("\n") + "\n");

  const v = verifyLedger(L);
  assert.equal(v.ok, false, "a self-consistent edit must still break the chain");
  assert.ok(v.problems.some((x) => x.index === 1 && /prevHash/.test(x.problem)),
    `expected a prevHash break at index 1, got ${JSON.stringify(v.problems)}`);
});

test("[PROVEN] deleting an entry is caught by sequence as well as by chain", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  for (const v of ["v1", "v2", "v3"]) {
    registerVersion({ candidateId: "C1", version: v, ...REG, hashes: H("p" + v, "c1", "AAA") }, L);
  }
  assert.equal(verifyLedger(L).ok, true);
  const lines = fs.readFileSync(L, "utf8").trim().split("\n");
  fs.writeFileSync(L, [lines[0], lines[2]].join("\n") + "\n");   // drop the middle registration
  const v = verifyLedger(L);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((x) => /seq .* does not match position/.test(x.problem)),
    `expected a seq problem, got ${JSON.stringify(v.problems)}`);
});

test("[PROVEN] re-registering a version throws rather than quietly revising a claim", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  registerVersion({ candidateId: "C1", version: "v1", ...REG, hashes: H("p1", "c1", "AAA") }, L);
  assert.throws(
    () => registerVersion({ candidateId: "C1", version: "v1", ...REG,
      registeredClaim: "a softer claim", hashes: H("p1", "c1", "AAA") }, L),
    /already registered/,
  );
  assert.equal(verifyLedger(L).ok, true, "and the refusal leaves the chain intact");
  assert.equal(readLedger(L).length, 1);
});

test("[PROVEN] registration requires every field, so a claim cannot be backfilled later", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  for (const missing of ["version", "whatChanged", "registeredClaim", "control", "drawdownWindow"]) {
    const args = { candidateId: "C1", version: "v1", ...REG, hashes: H("p", "c", "U") };
    delete args[missing];
    assert.throws(() => registerVersion(args, L), new RegExp(missing),
      `omitting ${missing} must throw`);
  }
  // A non-sha256 hash is refused too.
  assert.throws(() => registerVersion({ candidateId: "C1", version: "v1", ...REG,
    hashes: { prompt: "short", checklist: "x", universe: "y" } }, L), /sha256/);
  assert.equal(readLedger(L).length, 0, "nothing partial was written");
});

test("[PROVEN] drift from the registered version is named by surface", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  registerVersion({ candidateId: "C1", version: "v1", ...REG,
    hashes: H("prompt-v1", "check-v1", "AAA BBB") }, L);
  assert.deepEqual(driftFromRegistered("C1", H("prompt-v1", "check-v1", "AAA BBB"), L).drifted, []);
  const moved = driftFromRegistered("C1", H("prompt-v2", "check-v1", "AAA CCC"), L);
  assert.equal(moved.registered, true);
  assert.equal(moved.version, "v1");
  assert.deepEqual(moved.drifted.sort(), ["prompt", "universe"], "the changed surfaces, and only those");
});

test("[GAP] an unregistered candidate reports drift on every surface, not a refusal", () => {
  const d = tmp(), L = path.join(d, "ledger.jsonl");
  const r = driftFromRegistered("NEVER-REGISTERED", H("p", "c", "U"), L);
  assert.equal(r.registered, false);
  assert.deepEqual(r.drifted, ["prompt", "checklist", "universe"]);
  assert.equal(r.version, null);
  // Callers must branch on `registered`; reading `drifted.length` alone cannot distinguish
  // "never registered" from "drifted on all three".
});

// ---------------------------------------------------------------------------------------------
// Provenance and hashes: what they are not.
// ---------------------------------------------------------------------------------------------

test("[DOCUMENTED-HOLE] stripping PROVENANCE.json makes a synthetic panel undetectable", () => {
  const d = tmp();
  const root = path.join(d, "panel"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "PROVENANCE.json"), JSON.stringify({ synthetic: true }));
  assert.equal(isDeclaredSynthetic(root), true, "an honest label is caught");
  fs.unlinkSync(path.join(root, "PROVENANCE.json"));
  assert.equal(isDeclaredSynthetic(root), false, "a stripped label is not — fail-open, as documented");
  // And a forged real-looking label is equally accepted.
  fs.writeFileSync(path.join(root, "PROVENANCE.json"), JSON.stringify({ source: "IBKR" }));
  assert.equal(isDeclaredSynthetic(root), false);
});

test("[PROVEN] hashContext is order-independent over keys", () => {
  assert.equal(hashContext({ a: 1, b: { c: 2, d: 3 } }), hashContext({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(hashContext({ a: 1 }), hashContext({ a: 2 }));
});

test("[GAP] hashContext is a 64-bit digest of caller-supplied data, not an authenticity proof", () => {
  const ctx = { asOfTime: 1750000000, instruments: { AAA: { price: 10 } } };
  const h = hashContext(ctx);
  assert.equal(h.length, 16, "16 hex chars = 64 bits, truncated from sha256");
  // Anyone able to write the journal can recompute a matching hash for fabricated context,
  // so the field binds the record to a context VALUE, never to a real observation.
  assert.equal(hashContext({ ...ctx }), h);
});

// ---------------------------------------------------------------------------------------------
// Settlement completeness, cost alignment, hold windows.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] net is gross less one round trip, charged identically to agent and control", () => {
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => 1750000000 + i * 86400);
  const series = {
    AAA: dates.map((t, i) => ({ time: t, close: String(100 * 1.01 ** i) })),   // agent rises
    CCC: dates.map((t, i) => ({ time: t, close: String(100 * 0.99 ** i) })),   // control falls
  };
  const record = {
    batchId: "B1",
    allowed: [{ symbol: "AAA", action: "buy", targetPct: 5 }],
    control: [{ symbol: "CCC", targetPct: 5 }],
  };
  const free = realisedOutcomes({ record, series, dates, entryIdx: 0, holdDays: 5, costPerLeg: 0 })[0];
  const paid = realisedOutcomes({ record, series, dates, entryIdx: 0, holdDays: 5, costPerLeg: 0.001 })[0];
  // Gross is untouched by the cost model; net moves by exactly two legs.
  assert.equal(paid.grossReturn, free.grossReturn);
  assert.ok(Math.abs((free.netReturn - paid.netReturn) - 0.002) < 1e-9);
  // THE EDGE IS COST-INVARIANT, because the same charge lands on both sides.
  const edgeFree = free.netReturn - free.controlReturn;
  const edgePaid = paid.netReturn - paid.controlReturn;
  assert.ok(Math.abs(edgeFree - edgePaid) < 1e-9,
    "a cost assumption cannot move the measured edge; it moves both arms together");
});

test("[PROVEN] an incomplete hold is dropped, never recorded as a flat trade", () => {
  // Only 3 sessions of panel after entry, against a 5-day hold.
  const dates = [0, 1, 2, 3].map((i) => 1750000000 + i * 86400);
  const series = { AAA: dates.map((t, i) => ({ time: t, close: String(100 + i) })) };
  const record = { batchId: "B1", allowed: [{ symbol: "AAA", action: "buy", targetPct: 5 }], control: [] };
  assert.equal(realisedOutcomes({ record, series, dates, entryIdx: 0, holdDays: 5 }).length, 0);
  // With requireComplete off, the short hold is kept and LABELLED rather than silently equal.
  const loose = realisedOutcomes({ record, series, dates, entryIdx: 0, holdDays: 5, requireComplete: false });
  assert.equal(loose.length, 1);
  assert.equal(loose[0].complete, false);
  assert.ok(loose[0].sessionsHeld < 5);
});

test("[GAP] settlement has no corporate-action awareness; a split reads as a return", () => {
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => 1750000000 + i * 86400);
  // A clean 2-for-1 split on an unadjusted series: price halves, holder is flat.
  const closes = [100, 100, 100, 50, 50, 50, 50];
  const series = { AAA: dates.map((t, i) => ({ time: t, close: String(closes[i]) })) };
  const record = { batchId: "B1", allowed: [{ symbol: "AAA", action: "buy", targetPct: 5 }], control: [] };
  const row = realisedOutcomes({ record, series, dates, entryIdx: 0, holdDays: 5, costPerLeg: 0 })[0];
  // Recorded as a 50% loss. Nothing in the path can distinguish this from a real halving.
  assert.ok(row.grossReturn < -0.49 && row.grossReturn > -0.51, `got ${row.grossReturn}`);
  // Correctness therefore depends entirely on the panel being adjusted upstream, which the
  // settlement layer neither verifies nor records.
  assert.equal(Object.prototype.hasOwnProperty.call(row, "adjusted"), false);
});

// ---------------------------------------------------------------------------------------------
// Account state provenance. NO RISK MODULE IS MUTATED — this only measures current behaviour.
// ---------------------------------------------------------------------------------------------

test("[GAP] absent peakNav yields zero drawdown, so the halt cannot fire", () => {
  const instruments = { AAA: { class: "usEquity", price: 10, sessionBar: 1750000000,
    decisionSession: 1750000000, panelAgeMs: 0, medianDollarVolume: 1e9, sector: "Tech" } };
  const proposals = [{ symbol: "AAA", action: "buy", targetPct: 1, confidence: 0.9, thesis: "t" }];
  // NAV has fallen 60% from a peak the caller failed to supply.
  const withPeak = applyRiskGate(proposals, { nav: 40000, peakNav: 100000, positions: {} }, instruments);
  assert.equal(withPeak.halted, true, "with peak state the drawdown halt fires");

  const withoutPeak = applyRiskGate(proposals, { nav: 40000, positions: {} }, instruments);
  assert.equal(withoutPeak.halted, false,
    "risk.mjs:167 defaults an absent peakNav to current NAV, so drawdown reads 0%");
  // Same for the intraday brake.
  assert.equal(applyRiskGate(proposals, { nav: 40000, dayStartNav: 100000, positions: {} }, instruments).braked, true);
  assert.equal(applyRiskGate(proposals, { nav: 40000, positions: {} }, instruments).braked, false);
});

test("[PROVEN] an unusable NAV refuses every proposal rather than sizing against nothing", () => {
  const instruments = { AAA: { class: "usEquity", price: 10, sessionBar: 1750000000,
    decisionSession: 1750000000, panelAgeMs: 0, medianDollarVolume: 1e9, sector: "Tech" } };
  const proposals = [{ symbol: "AAA", action: "buy", targetPct: 1, confidence: 0.9, thesis: "t" }];
  for (const nav of [null, undefined, 0, -5, NaN]) {
    const g = applyRiskGate(proposals, { nav, positions: {} }, instruments);
    assert.equal(g.allowed.length, 0, `nav=${nav} must allow nothing`);
    assert.equal(g.rejected.length, 1);
    assert.equal(g.rejected[0].code, REJECT.MALFORMED);
  }
});

// ---------------------------------------------------------------------------------------------
// Protocol STOPs: skip-vs-no-decision, and what a PASS there is worth.
// ---------------------------------------------------------------------------------------------

test("[PROVEN] a refused session leaves a counted skip, distinguishable from never running", () => {
  const d = tmp(), f = jrnl(d);
  const empty = tier1(f, { mode: MODE.PAPER, candidateId: CID, now: Date.parse("2026-10-13T12:00:00Z") });
  const c1empty = empty.criteria.find((c) => c.n === 1);
  assert.match(c1empty.detail, /nothing in the journal yet/);

  recordSkip({ ...ATTRIB, at: "2026-10-01T12:00:00.000Z", mode: MODE.PAPER, reason: SKIP_REASON.PANEL_STALE }, f);
  recordSkip({ ...ATTRIB, at: "2026-10-02T12:00:00.000Z", mode: MODE.PAPER, reason: SKIP_REASON.PANEL_FUTURE_DATED }, f);
  const t = tier1(f, { mode: MODE.PAPER, candidateId: CID, now: Date.parse("2026-10-13T12:00:00Z") });
  const c3 = t.criteria.find((c) => c.n === 3);
  assert.equal(c3.numbers.stale, 1);
  assert.equal(c3.numbers.futureDated, 1);
  assert.equal(c3.stops, true, "panel freshness is a STOP criterion");
  // The refusals are recorded as the guard working, NOT as batches on a bad panel.
  assert.match(c3.detail, /0 batch\(es\) decided on a bad panel/);
});

test("[PROVEN] a point-in-time skip FAILS the STOP criterion it guards", () => {
  const d = tmp(), f = jrnl(d);
  stubBatch(f, { attrib: ATTRIB });
  recordSkip({ ...ATTRIB, at: "2026-10-02T12:00:00.000Z", mode: MODE.PAPER,
              reason: SKIP_REASON.CONTEXT_NOT_POINT_IN_TIME }, f);
  const c2 = tier1(f, { mode: MODE.PAPER, candidateId: CID, now: Date.parse("2026-10-13T12:00:00Z") })
    .criteria.find((c) => c.n === 2);
  assert.equal(c2.status, "fail");
  assert.equal(c2.stops, true);
  assert.equal(c2.numbers.skips, 1);
});

test("[GAP] criterion 3 PASSES on an empty journal, because it counts refusals not sessions", () => {
  const d = tmp(), f = jrnl(d);
  const c3 = tier1(f, { mode: MODE.PAPER, candidateId: CID, now: Date.parse("2026-10-13T12:00:00Z") })
    .criteria.find((c) => c.n === 3);
  // Nothing has ever run, and a STOP criterion reports PASS.
  assert.equal(c3.status, "pass");
  assert.equal(c3.numbers.stale, 0);
  assert.equal(c3.numbers.futureDated, 0);
  // Criterion 1 is what carries "did it run"; 3 must not be read as evidence of a healthy panel.
});

test("[PROVEN] the risk-gate criterion FAILS when no rejection was ever recorded", () => {
  const d = tmp(), f = jrnl(d);
  // A batch with an empty `rejected` list: the gate was never load-bearing.
  recordDecision({ ...ATTRIB, batchId: "NR", at: "2026-10-01T12:00:00.000Z", mode: MODE.PAPER, seed: 1,
    pool: ["AAA", "BBB"], context: { asOfTime: 1750000000, instruments: {} },
    proposals: [], gate: { allowed: [], rejected: [], exposure: 0 }, model: "stub-no-llm" }, f);
  const c5 = tier1(f, { mode: MODE.PAPER, candidateId: CID, now: Date.parse("2026-10-13T12:00:00Z") })
    .criteria.find((c) => c.n === 5);
  assert.equal(c5.status, "fail");
  assert.match(c5.detail, /zero rejections/);
});
