/**
 * Tests for the candidate/version ledger (docs/FORWARD-EVAL-SPEC.md §4).
 *
 * Weighted toward FAILURE cases, because every property this ledger has is only worth something if the
 * corresponding abuse is rejected: a re-registration, a decision recorded before its registration, an
 * edited historical entry, a removed line, an unregistered prompt change. A ledger that only works when
 * used correctly is documentation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerVersion, markFirstDecision, readLedger, verifyLedger, familySize, currentVersion,
  evidenceWindow, recordsAfterBoundary, driftFromRegistered, inputHashes, entryHash,
  canonicalJson, GENESIS_HASH, LEDGER_SCHEMA, KIND,
} from "./ledger.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "l.jsonl");
const H = (s) => inputHashes({ systemPrompt: s, checklist: ["a"], checklistId: "v1", universeText: "AAA\nBBB\n" });

const base = (over = {}) => ({
  candidateId: "analyst-daily", version: "v1",
  whatChanged: "first registration", why: "baseline configuration before any decision",
  registeredClaim: "net edge over the matched random control is positive at 50 periods",
  control: "matched random control drawn from the same slate at decision time",
  minimumPeriods: 50, mdeAtMinimum: 0.48, drawdownWindow: "60 trading days from first decision",
  supersedes: null, hashes: H("prompt-A"), ...over,
});

// ---- registration ------------------------------------------------------------------------------

test("a registration records every pre-registered field and chains from genesis", () => {
  const f = tmp();
  const e = registerVersion(base(), f);
  assert.equal(e.schema, LEDGER_SCHEMA);
  assert.equal(e.seq, 0);
  assert.equal(e.kind, KIND.VERSION);
  assert.equal(e.prevHash, GENESIS_HASH);
  assert.equal(e.minimumPeriods, 50);
  assert.equal(e.mdeAtMinimum, 0.48);
  assert.equal(e.supersedes, null);
  assert.match(e.hash, /^[0-9a-f]{64}$/);
  assert.equal(verifyLedger(f).ok, true);
  assert.equal(familySize(f), 1);
});

test("re-registering the same candidate version throws — a revision is a new row, never an edit", () => {
  const f = tmp();
  registerVersion(base(), f);
  assert.throws(() => registerVersion(base({ registeredClaim: "something easier to pass" }), f),
    /already registered/);
  // And the original claim is untouched.
  assert.equal(readLedger(f).length, 1);
  assert.match(readLedger(f)[0].registeredClaim, /positive at 50 periods/);
});

test("every pre-registered field is required, individually", () => {
  const f = tmp();
  for (const k of ["candidateId", "version", "whatChanged", "why", "registeredClaim", "control", "drawdownWindow"]) {
    assert.throws(() => registerVersion(base({ [k]: "" }), f), new RegExp(k), `${k} was not required`);
  }
  assert.throws(() => registerVersion(base({ minimumPeriods: 0 }), f), /minimumPeriods/);
  assert.throws(() => registerVersion(base({ minimumPeriods: 12.5 }), f), /minimumPeriods/);
  assert.throws(() => registerVersion(base({ mdeAtMinimum: "big" }), f), /mdeAtMinimum/);
  assert.throws(() => registerVersion(base({ hashes: null }), f), /hashes is required/);
  assert.throws(() => registerVersion(base({ hashes: { prompt: "nope", checklist: "x", universe: "y" } }), f), /sha256/);
  // Nothing partial was written by any of those rejections.
  assert.equal(readLedger(f).length, 0);
});

// ---- the first-decision boundary ---------------------------------------------------------------

test("the boundary is a separate append, so a registration cannot be back-dated by editing it", () => {
  const f = tmp();
  const reg = registerVersion(base(), f);
  const { entry, alreadyMarked } = markFirstDecision(
    { candidateId: "analyst-daily", version: "v1", at: "2026-10-01T14:00:00Z", batchId: "paper-2026-10-01" }, f);
  assert.equal(alreadyMarked, false);
  assert.equal(entry.kind, KIND.FIRST_DECISION);
  assert.equal(entry.seq, 1);
  assert.equal(entry.prevHash, reg.hash);
  // The registration row itself is byte-identical to what was written.
  assert.equal(readLedger(f)[0].hash, reg.hash);
  assert.equal(verifyLedger(f).ok, true);
});

test("marking the boundary twice is idempotent and never records a second first decision", () => {
  const f = tmp();
  registerVersion(base(), f);
  const a = markFirstDecision({ candidateId: "analyst-daily", version: "v1", at: "2026-10-01T14:00:00Z" }, f);
  const b = markFirstDecision({ candidateId: "analyst-daily", version: "v1", at: "2026-10-02T14:00:00Z" }, f);
  assert.equal(a.alreadyMarked, false);
  assert.equal(b.alreadyMarked, true);
  assert.equal(b.entry.firstDecisionAt, "2026-10-01T14:00:00Z", "the later call overwrote the boundary");
  assert.equal(readLedger(f).filter((e) => e.kind === KIND.FIRST_DECISION).length, 1);
});

test("a decision cannot be marked for a version that was never registered", () => {
  const f = tmp();
  registerVersion(base(), f);
  assert.throws(() => markFirstDecision({ candidateId: "analyst-daily", version: "v2", at: "2026-10-01T00:00:00Z" }, f),
    /not registered/);
  assert.throws(() => markFirstDecision({ candidateId: "other", version: "v1", at: "2026-10-01T00:00:00Z" }, f),
    /not registered/);
});

// ---- the period-reset rule ---------------------------------------------------------------------

test("a version change resets the evidence window, so the old version's records fall outside it", () => {
  // THE RULE WITH TEETH. v1 decides for a month; v2 supersedes it; v2 inherits none of that evidence.
  const f = tmp();
  registerVersion(base(), f);
  markFirstDecision({ candidateId: "analyst-daily", version: "v1", at: "2026-10-01T14:00:00Z" }, f);

  const records = [
    { at: "2026-10-01T14:00:00Z", batchId: "b1" },
    { at: "2026-10-15T14:00:00Z", batchId: "b2" },
    { at: "2026-11-05T14:00:00Z", batchId: "b3" },
  ];
  const w1 = evidenceWindow("analyst-daily", f);
  assert.equal(w1.version, "v1");
  assert.equal(recordsAfterBoundary(records, w1.since).length, 3);

  registerVersion(base({ version: "v2", supersedes: "v1", whatChanged: "reworded the thesis section",
                         why: "the prompt drifted; this registers it", hashes: H("prompt-B") }), f);

  // Registered but not yet decided: the window is null, and null means NO evidence, not all of it.
  const w2 = evidenceWindow("analyst-daily", f);
  assert.equal(w2.version, "v2");
  assert.equal(w2.supersedes, "v1");
  assert.equal(w2.since, null);
  assert.deepEqual(recordsAfterBoundary(records, w2.since), [],
    "an undecided new version inherited the previous version's records");

  markFirstDecision({ candidateId: "analyst-daily", version: "v2", at: "2026-11-01T14:00:00Z" }, f);
  const after = recordsAfterBoundary(records, evidenceWindow("analyst-daily", f).since);
  assert.deepEqual(after.map((r) => r.batchId), ["b3"], "v2's window included v1's decisions");
  assert.equal(familySize(f), 2, "the family size must grow with every version");
});

test("recordsAfterBoundary rejects an unparseable boundary and drops undated records", () => {
  assert.throws(() => recordsAfterBoundary([], "not-a-date"), /not a parseable timestamp/);
  const recs = [{ at: null }, { at: "2026-10-02T00:00:00Z" }, {}];
  assert.equal(recordsAfterBoundary(recs, "2026-10-01T00:00:00Z").length, 1);
});

// ---- drift detection ---------------------------------------------------------------------------

test("an unregistered prompt, checklist or universe change is reported as drift", () => {
  const f = tmp();
  registerVersion(base(), f);
  assert.deepEqual(driftFromRegistered("analyst-daily", H("prompt-A"), f),
    { registered: true, version: "v1", drifted: [] });

  assert.deepEqual(driftFromRegistered("analyst-daily", H("prompt-CHANGED"), f).drifted, ["prompt"]);

  const otherUniverse = inputHashes({ systemPrompt: "prompt-A", checklist: ["a"], checklistId: "v1", universeText: "AAA\n" });
  assert.deepEqual(driftFromRegistered("analyst-daily", otherUniverse, f).drifted, ["universe"]);

  const noChecklist = inputHashes({ systemPrompt: "prompt-A", checklist: null, checklistId: null, universeText: "AAA\nBBB\n" });
  assert.deepEqual(driftFromRegistered("analyst-daily", noChecklist, f).drifted, ["checklist"]);

  // An unregistered candidate is maximal drift, not a pass.
  const unknown = driftFromRegistered("never-registered", H("prompt-A"), f);
  assert.equal(unknown.registered, false);
  assert.deepEqual(unknown.drifted, ["prompt", "checklist", "universe"]);
});

// ---- tamper detection --------------------------------------------------------------------------

test("editing a historical entry breaks the chain and verifyLedger names the index", () => {
  const f = tmp();
  registerVersion(base(), f);
  markFirstDecision({ candidateId: "analyst-daily", version: "v1", at: "2026-10-01T14:00:00Z" }, f);
  registerVersion(base({ version: "v2", supersedes: "v1", hashes: H("prompt-B") }), f);
  assert.equal(verifyLedger(f).ok, true);

  // Soften the registered claim after the fact — the exact abuse this exists to make detectable.
  const lines = fs.readFileSync(f, "utf8").trim().split("\n");
  const tampered = JSON.parse(lines[0]);
  tampered.registeredClaim = "net edge is positive at 4 periods";
  lines[0] = JSON.stringify(tampered);
  fs.writeFileSync(f, lines.join("\n") + "\n");

  // THE NAIVE TAMPER: content edited, hash left alone. Caught by the per-entry content hash. The chain
  // downstream is still consistent, because entry 1 commits to entry 0's STORED hash, which did not
  // change — so this is correctly a single-index finding, not a cascade.
  const v = verifyLedger(f);
  assert.equal(v.ok, false);
  assert.equal(v.problems[0].index, 0);
  assert.match(v.problems[0].problem, /hash does not match content/);

  // THE SOPHISTICATED TAMPER, which is the one the chain exists for: recompute the edited entry's own
  // hash so it looks self-consistent. Now entry 0 passes its content check and entry 1's prevHash no
  // longer matches, so the forgery surfaces at the NEXT index instead. Covering only the naive case
  // would leave the chain itself untested.
  const relines = fs.readFileSync(f, "utf8").trim().split("\n");
  const forged = JSON.parse(relines[0]);
  delete forged.hash;
  forged.hash = entryHash(forged);
  relines[0] = JSON.stringify(forged);
  fs.writeFileSync(f, relines.join("\n") + "\n");

  const v2 = verifyLedger(f);
  assert.equal(v2.ok, false);
  assert.ok(!v2.problems.some((p) => p.index === 0 && /hash does not match content/.test(p.problem)),
    "the forged entry should now look self-consistent — that is why the chain is needed");
  assert.ok(v2.problems.some((p) => p.index === 1 && /chain is broken/.test(p.problem)),
    "a re-hashed forgery was not caught by the chain at the following entry");
});

test("removing an entry is detected by seq and by the chain", () => {
  const f = tmp();
  registerVersion(base(), f);
  markFirstDecision({ candidateId: "analyst-daily", version: "v1", at: "2026-10-01T14:00:00Z" }, f);
  registerVersion(base({ version: "v2", supersedes: "v1", hashes: H("prompt-B") }), f);

  const lines = fs.readFileSync(f, "utf8").trim().split("\n");
  fs.writeFileSync(f, [lines[0], lines[2]].join("\n") + "\n");   // drop the middle entry

  const v = verifyLedger(f);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /seq 2 does not match position 1/.test(p.problem)));
  assert.ok(v.problems.some((p) => /chain is broken/.test(p.problem)));
});

test("a malformed line is reported, never silently skipped", () => {
  const f = tmp();
  registerVersion(base(), f);
  fs.appendFileSync(f, "{not json\n");
  const v = verifyLedger(f);
  assert.equal(v.ok, false);
  assert.equal(v.entries, 2, "the unreadable line was dropped from the count");
  assert.ok(v.problems.some((p) => p.index === 1 && p.problem === "unparseable line"));
});

test("an absent ledger verifies as empty rather than throwing, and has family size zero", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "nope.jsonl");
  assert.deepEqual(verifyLedger(f), { ok: true, entries: 0, problems: [] });
  assert.equal(familySize(f), 0);
  assert.equal(currentVersion("anything", f), null);
  assert.equal(evidenceWindow("anything", f), null);
});

test("canonical JSON is key-order independent, so a re-serialised entry hashes the same", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  const e = { schema: LEDGER_SCHEMA, seq: 0, kind: KIND.VERSION, x: 1 };
  assert.equal(entryHash(e), entryHash({ ...e, hash: "ignored-when-hashing" }));
});
