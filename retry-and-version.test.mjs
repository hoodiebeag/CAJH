/**
 * The retry contract and the version-boundary diagnostic, as hand-computable contracts.
 *
 * NEW GROUND ONLY. Ragged-panel point-in-time, criterion 2's coverage and mixed session/coverage
 * accounting are already settled in docs/JOURNAL-COMPLETENESS.md §9–§10 and are not revisited.
 *
 * Nothing is implemented. No retry policy is chosen, no record is rewritten or deleted, and the
 * ledger is used read-only on synthetic data whose candidate id is prefixed SYNTHETIC- so it cannot
 * be mistaken for a registered one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, readJournal, scoreJournal, holdPeriodKeys, KIND, MODE, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { settleOutcomes } from "./analyst/loop.mjs";
import {
  registerVersion, markFirstDecision, evidenceWindow, recordsAfterBoundary, familySize,
  driftFromRegistered, verifyLedger, inputHashes, currentVersion,
} from "./analyst/ledger.mjs";
import { classifyOutcomes, sessionCoverage } from "./journal-completeness.mjs";

const DAY = 86400;
const THESIS = "a thesis long enough to review";
const e = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const d10 = (s) => new Date(s * 1000).toISOString().slice(0, 10);
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "rvtest-"));
const buy = (symbol) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS });
const CID = "SYNTHETIC-NOT-A-REAL-CANDIDATE";
const AFTER = Date.parse("2026-05-01T00:00:00Z");

const fp = () => (fs.existsSync(DEFAULT_JOURNAL)
  ? crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");
const BEFORE = fp();

const grid = (fromISO, n) => {
  const out = [];
  for (let t = e(fromISO); out.length < n; t += DAY) {
    const w = new Date(t * 1000).getUTCDay();
    if (w !== 0 && w !== 6) out.push(t);
  }
  return out;
};
const SESS = grid("2026-03-02", 30);
const SERIES = {
  AAA: SESS.map((t, i) => ({ time: t, close: 100 * 1.004 ** i, volume: 1e6 })),
  BBB: SESS.map((t, i) => ({ time: t, close: 60 * 1.002 ** i, volume: 1e6 })),
  CTRL: SESS.map((t, i) => ({ time: t, close: 80 * 1.003 ** i, volume: 1e6 })),
};

/** Write `attempts` decision records at session `sIdx`, then settle. */
const build = (file, attempts, sIdx = 0) => {
  for (const tag of attempts) {
    const allowed = [buy("AAA"), buy("BBB")];
    recordDecision({
      batchId: tag === null ? `paper-${d10(SESS[sIdx])}` : `paper-${d10(SESS[sIdx])}-${tag}`,
      at: new Date(AFTER).toISOString(), context: { asOfTime: SESS[sIdx] },
      proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1, mode: MODE.PAPER,
    }, file);
  }
  return settleOutcomes({ series: SERIES, dates: SESS, journalFile: file, mode: MODE.PAPER,
    holdDays: 5, costPerLeg: 0, now: AFTER });
};
const counts = (file) => {
  const recs = readJournal(file).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);
  const s = scoreJournal(file);
  return {
    recs: decisions.length,
    ids: sessionCoverage(decisions).distinctBatchIds,
    repeated: sessionCoverage(decisions).repeatedBatchIds.length,
    nominal: s.decisions,
    rows: outs.length,
    paired: classifyOutcomes(outs).paired.length,
    periods: new Set(holdPeriodKeys(decisions, outs, 5)).size,
  };
};

// ---- the retry contract ------------------------------------------------------------------------

test("RETRY: a same-identity rerun moves only the DECISION-side counts", () => {
  const D = dir();
  const one = path.join(D, "one.jsonl");
  const two = path.join(D, "two.jsonl");
  build(one, [null]);
  build(two, [null, null]);                           // the same batchId twice: today's behaviour
  const a = counts(one), b = counts(two);

  assert.deepEqual(a, { recs: 1, ids: 1, repeated: 0, nominal: 2, rows: 2, paired: 1, periods: 1 });
  // Doubled: records and the nominal trade count that gates the standing minimum.
  assert.equal(b.recs, 2);
  assert.equal(b.nominal, 4, "`sized` doubles — this is the gate input");
  assert.equal(b.repeated, 1, "and the repeat is detectable from the record");
  assert.equal(b.ids, 1, "because the identity is reused");
  // Untouched: everything the settlement key or the period ranking already de-duplicates.
  assert.equal(b.rows, a.rows, "outcome rows are keyed on (batchId, symbol)");
  assert.equal(b.paired, a.paired);
  assert.equal(b.periods, a.periods, "and periods rank distinct entry times");
});

test("RETRY: two DISTINCT identities on one session are a real experiment, not a duplicate", () => {
  const D = dir();
  const arms = path.join(D, "arms.jsonl");
  build(arms, ["armA", "armB"]);
  const c = counts(arms);
  assert.equal(c.ids, 2, "two identities");
  assert.equal(c.repeated, 0, "and NO repeat — this is not the duplicate case");
  assert.equal(c.rows, 4, "both arms settle: the extra rows are real measurements");
  assert.equal(c.paired, 2);
  assert.equal(c.periods, 1, "while one entry session is still ONE independent period");
  // The discriminator a policy must use: repeated identity, not several batches per session.
  const dup = path.join(D, "dup.jsonl");
  build(dup, [null, null]);
  assert.equal(counts(dup).repeated, 1);
  assert.notEqual(counts(dup).rows, c.rows, "a duplicate adds no rows; an arm does");
});

test("RETRY: an interrupted partial write is indistinguishable from a plain rerun", () => {
  // The first attempt's decision lands and the process dies before `settle` runs; the operator
  // reruns. The journal carries no marker that the first attempt did not complete.
  const D = dir();
  const partial = path.join(D, "partial.jsonl");
  const allowed = [buy("AAA"), buy("BBB")];
  for (let i = 0; i < 2; i++) {
    recordDecision({ batchId: `paper-${d10(SESS[0])}`, at: new Date(AFTER).toISOString(),
      context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["CTRL"],
      seed: 1, mode: MODE.PAPER }, partial);
  }
  settleOutcomes({ series: SERIES, dates: SESS, journalFile: partial, mode: MODE.PAPER,
    holdDays: 5, costPerLeg: 0, now: AFTER });
  const plain = path.join(D, "plain.jsonl");
  build(plain, [null, null]);
  assert.deepEqual(counts(partial), counts(plain),
    "identical in every count — so no policy can tell them apart from the record alone");
});

test("RETRY: after settlement, the outcome rows are already protected", () => {
  const D = dir();
  const f = path.join(D, "post.jsonl");
  build(f, [null]);
  const allowed = [buy("AAA"), buy("BBB")];
  recordDecision({ batchId: `paper-${d10(SESS[0])}`, at: new Date(AFTER + DAY * 1000).toISOString(),
    context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["CTRL"],
    seed: 1, mode: MODE.PAPER }, f);
  const again = settleOutcomes({ series: SERIES, dates: SESS, journalFile: f, mode: MODE.PAPER,
    holdDays: 5, costPerLeg: 0, now: AFTER + DAY * 1000 });
  assert.equal(again.wrote, 0, "nothing new is written");
  assert.ok(again.already > 0, "the existing rows are reported as already settled");
  const c = counts(f);
  assert.equal(c.rows, 2, "realised figures are safe");
  assert.equal(c.nominal, 4, "the decision-side count still doubles");
});

test("RETRY: the journal is append-only, so no option may rewrite or delete", () => {
  // Pinned because two of the candidate policies could be implemented destructively, and must not be.
  const D = dir();
  const f = path.join(D, "append.jsonl");
  build(f, [null]);
  const firstPass = fs.readFileSync(f, "utf8");
  build(f, [null]);
  const secondPass = fs.readFileSync(f, "utf8");
  assert.ok(secondPass.startsWith(firstPass), "every earlier line is still there, byte for byte");
  assert.ok(secondPass.length > firstPass.length);
});

// ---- the version boundary ----------------------------------------------------------------------

const buildVersioned = () => {
  const D = dir();
  const L = path.join(D, "ledger.jsonl");
  const J = path.join(D, "journal.jsonl");
  const h = (text) => inputHashes({ systemPrompt: text, checklist: "c", checklistId: "v1",
    universeText: "AAA\nBBB" });
  const hv1 = h("prompt one"), hv2 = h("prompt two, different");
  const common = { candidateId: CID, whatChanged: "synthetic fixture, not evidence",
    why: "diagnostic only", registeredClaim: "none — fixture", control: "matched random",
    minimumPeriods: 50, mdeAtMinimum: 0.0093, drawdownWindow: "none" };
  registerVersion({ ...common, version: "v1", hashes: hv1 }, L);
  SESS.slice(0, 10).forEach((t, i) => {
    const version = i < 5 ? "v1" : "v2";
    if (i === 5) registerVersion({ ...common, version: "v2", supersedes: "v1", hashes: hv2 }, L);
    const allowed = [buy("AAA"), buy("BBB")];
    const rec = recordDecision({ batchId: `paper-${d10(t)}`,
      at: new Date(t * 1000 + 3600_000).toISOString(), context: { asOfTime: t },
      proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1, mode: MODE.PAPER,
      model: version === "v1" ? "synthetic-A" : "synthetic-B", checklistId: version }, J);
    markFirstDecision({ candidateId: CID, version, at: rec.at, batchId: rec.batchId }, L);
  });
  settleOutcomes({ series: SERIES, dates: SESS, journalFile: J, mode: MODE.PAPER, holdDays: 5,
    costPerLeg: 0, now: AFTER });
  return { D, L, J, hv1, hv2 };
};

test("VERSION: no journal record carries a candidateId or a version", () => {
  const { J } = buildVersioned();
  const decisions = readJournal(J).records.filter((r) => r.kind === KIND.DECISION);
  for (const d of decisions) {
    assert.equal(d.candidateId, undefined, "the journal has no candidate identifier");
    assert.equal(d.version, undefined, "nor a version");
  }
  // What it DOES carry, and which of those can proxy for a version.
  assert.equal(new Set(decisions.map((d) => d.model)).size, 2, "model distinguishes the two halves");
  assert.equal(new Set(decisions.map((d) => d.checklistId)).size, 2);
  assert.equal(new Set(decisions.map((d) => d.contextHash)).size, 10,
    "contextHash changes every session, so it identifies a batch, NOT a version");
});

test("VERSION: an outcome's `at` is its SETTLEMENT time, so a naive time join misattributes all of it", () => {
  const { L, J } = buildVersioned();
  const recs = readJournal(J).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);
  const win = evidenceWindow(CID, L);
  assert.equal(win.version, "v2");
  assert.equal(win.supersedes, "v1");

  const dAfter = recordsAfterBoundary(decisions, win.since);
  assert.equal(dAfter.length, 5, "five of ten decisions are at or after the boundary");
  // THE DEFECT IN A NAIVE SCOPING: settlement ran once, after both versions, so every row looks new.
  const oNaive = recordsAfterBoundary(outs, win.since);
  assert.equal(oNaive.length, outs.length, "all 20 rows, including the superseded version's ten");
  // The correct join goes through the parent decision.
  const scoped = new Set(dAfter.map((d) => d.batchId));
  const oParent = outs.filter((o) => scoped.has(o.batchId));
  assert.equal(oParent.length, 10, "ten rows actually belong to v2");
  assert.ok(oNaive.length > oParent.length, "the naive join inflates the new version's evidence 2x");
});

test("VERSION: scoping changes the independent-period count, and scoring consults none of it", () => {
  const { L, J } = buildVersioned();
  const recs = readJournal(J).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);
  const win = evidenceWindow(CID, L);
  const dAfter = recordsAfterBoundary(decisions, win.since);
  const scoped = new Set(dAfter.map((d) => d.batchId));
  const oParent = outs.filter((o) => scoped.has(o.batchId));

  const pooled = new Set(holdPeriodKeys(decisions, outs, 5)).size;
  const scopedPeriods = new Set(holdPeriodKeys(dAfter, oParent, 5)).size;
  assert.equal(pooled, 2, "pooled across both versions");
  assert.equal(scopedPeriods, 1, "one period for the current version alone");

  // And what scoring reports today ignores the boundary entirely.
  const s = scoreJournal(J);
  assert.equal(s.periods, pooled, "scoreJournal pools; it reads no ledger");
  assert.equal(s.outcomes, outs.length);
  assert.ok(!Object.keys(s).includes("candidateId"), "no candidate scoping exists in the readout");
});

test("VERSION: a decision straddles the boundary by decision time versus settlement time", () => {
  const { L, J } = buildVersioned();
  const recs = readJournal(J).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);
  const boundary = Date.parse(evidenceWindow(CID, L).since);
  const straddling = decisions.filter((d) => Date.parse(d.at) < boundary
    && outs.some((o) => o.batchId === d.batchId && Date.parse(o.at) >= boundary));
  assert.equal(straddling.length, 5,
    "every pre-boundary decision was settled after it, because settle ran once at the end");
  // Nothing in the record resolves which version owns them, and this test asserts only that.
  for (const d of straddling) {
    assert.equal(d.version, undefined);
    assert.equal(d.candidateId, undefined);
  }
});

test("VERSION: a matching hash is bookkeeping, not owner approval", () => {
  const { L, hv1, hv2 } = buildVersioned();
  assert.deepEqual(driftFromRegistered(CID, hv2, L).drifted, [], "the current config matches v2");
  assert.deepEqual(driftFromRegistered(CID, hv1, L).drifted, ["prompt"], "the old one does not");
  assert.equal(driftFromRegistered("SYNTHETIC-NEVER-REGISTERED", hv2, L).registered, false);
  // The ledger is internally sound and says nothing about approval.
  const chain = verifyLedger(L);
  assert.equal(chain.ok, true);
  assert.equal(chain.entries, 4, "two versions plus two first-decision markers");
  assert.equal(familySize(L), 2);
  const reg = currentVersion(CID, L);
  assert.equal(reg.version, "v2");
  assert.match(reg.registeredClaim, /fixture/, "the fixture says so in its own registered claim");
  assert.ok(CID.startsWith("SYNTHETIC-"), "and the id cannot be mistaken for a real candidate");
});

test("VERSION: the diagnostic writes nothing outside a temp directory", () => {
  const { L, J } = buildVersioned();
  assert.ok(L.startsWith(os.tmpdir()), "ledger is in a temp dir");
  assert.ok(J.startsWith(os.tmpdir()), "journal is in a temp dir");
  assert.equal(fp(), BEFORE, "and the real journal is byte-identical");
});

test("SAFETY: this suite left the real journal exactly as it found it", () => {
  assert.equal(fp(), BEFORE);
});
