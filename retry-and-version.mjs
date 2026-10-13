#!/usr/bin/env node
/**
 * retry-and-version.mjs — two offline diagnostics, both read-only against synthetic data.
 *
 * PART 1, THE RETRY CONTRACT. `docs/REMEDIATION-PLAN.md` item B1 said a same-session rerun should be
 * "refused OR marked superseding". Those are two materially different designs and the item was not
 * approvable in that form. This enumerates four distinct retry situations and measures, on
 * hand-computable fixtures, what each does to three different counts: nominal trades, paired outcomes
 * and independent periods.
 *
 * PART 2, THE VERSION BOUNDARY. `analyst/ledger.mjs` is used READ-ONLY to show what a candidate-scoped
 * view of a journal would look like beside what scoring reports today, which is pooled across every
 * version. `docs/FORWARD-EVAL-SPEC.md` specifies the scoped semantics and **its own header says
 * "Status: proposal. Nothing in this file is built, scheduled, enabled or approved"**, with the
 * protocol winning on disagreement. Printing a scoped number here is a diagnostic, not an adoption,
 * and a hash or a doc existing is not evidence of approved candidate semantics.
 *
 * WRITES NOTHING THAT MATTERS. Every journal and ledger below lives in a fresh temp directory. No
 * runtime scoring, settlement, eligibility, calendar, risk, sizing, STOP, passing criterion, ledger or
 * cost behaviour is changed, no record is rewritten or deleted, and no real candidate is registered —
 * every synthetic candidate id is prefixed SYNTHETIC- so it cannot be mistaken for one.
 *
 * Usage: node retry-and-version.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, recordOutcome, readJournal, scoreJournal, matchedRandomControl,
  holdPeriodKeys, KIND, MODE, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { settleOutcomes } from "./analyst/loop.mjs";
import {
  registerVersion, markFirstDecision, evidenceWindow, recordsAfterBoundary, familySize,
  driftFromRegistered, verifyLedger, inputHashes, currentVersion, readLedger,
} from "./analyst/ledger.mjs";
import { classifyOutcomes, sessionCoverage } from "./journal-completeness.mjs";

const DAY = 86400;
const THESIS = "a thesis long enough to review";
const e = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const d10 = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "retryver-"));
const fingerprint = (f) => (fs.existsSync(f)
  ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "ABSENT");
const buy = (symbol) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS });

/** A Mon–Fri session grid; the real bundle's UTC-midnight convention. */
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
const AFTER = Date.parse("2026-05-01T00:00:00Z");

/** The three counts that a retry policy moves differently. Printed together, deliberately. */
function counts(journalFile) {
  const recs = readJournal(journalFile).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);
  const s = scoreJournal(journalFile);
  const cls = classifyOutcomes(outs);
  const cov = sessionCoverage(decisions);
  return {
    decisionRecords: cov.batchRecords,
    distinctSessions: cov.distinctSessions,
    distinctBatchIds: cov.distinctBatchIds,
    repeatedBatchIds: cov.repeatedBatchIds.length,
    nominalTrades: s.decisions,                 // scoreJournal's `sized` — gates the standing minimum
    outcomeRows: outs.length,
    pairedOutcomes: cls.paired.length,
    independentPeriods: s.periods,
    uniquePeriodKeys: new Set(holdPeriodKeys(decisions, outs, 5)).size,
  };
}
const row = (label, c) => console.log(
  `  ${label.padEnd(34)} recs ${String(c.decisionRecords).padStart(2)}  sess ${String(c.distinctSessions).padStart(2)}  `
  + `ids ${String(c.distinctBatchIds).padStart(2)}  rep ${String(c.repeatedBatchIds).padStart(2)}  `
  + `nominal ${String(c.nominalTrades).padStart(2)}  rows ${String(c.outcomeRows).padStart(2)}  `
  + `paired ${String(c.pairedOutcomes).padStart(2)}  periods ${String(c.independentPeriods).padStart(2)}`);

function part1() {
  console.log("=== PART 1. THE RETRY CONTRACT — four situations, three counts each ===\n");
  console.log("  Legend: recs=decision records, sess=distinct decision sessions, ids=distinct batchIds,");
  console.log("  rep=repeated batchIds, nominal=scoreJournal `sized` (gates the standing minimum),");
  console.log("  rows=outcome rows, paired=rows with both halves, periods=independent holding periods.\n");

  const base = (dir, name, { batchIdFor, sessions = 1, settle = true }) => {
    const f = path.join(dir, `${name}.jsonl`);
    for (let sIdx = 0; sIdx < sessions; sIdx++) {
      for (const attempt of batchIdFor.attempts) {
        const allowed = [buy("AAA"), buy("BBB")];
        recordDecision({
          batchId: batchIdFor.make(SESS[sIdx], attempt),
          at: new Date(AFTER).toISOString(),
          context: { asOfTime: SESS[sIdx] },
          proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1, mode: MODE.PAPER,
        }, f);
      }
    }
    if (settle) settleOutcomes({ series: SERIES, dates: SESS, journalFile: f, mode: MODE.PAPER,
      holdDays: 5, costPerLeg: 0, now: AFTER });
    return f;
  };

  const dir = tmpDir();
  const sameId = { attempts: [0], make: (t) => `paper-${d10(t)}` };
  const twice = { attempts: [0, 1], make: (t) => `paper-${d10(t)}` };          // what happens TODAY
  const distinct = { attempts: ["armA", "armB"], make: (t, a) => `paper-${d10(t)}-${a}` };

  console.log("  (1) ONE RUN, the reference case");
  row("one run", counts(base(dir, "one", { batchIdFor: sameId })));

  console.log("\n  (2) SEQUENTIAL RETRY UNDER THE SAME IDENTITY — the current behaviour");
  const retried = base(dir, "retry", { batchIdFor: twice });
  row("same session run twice", counts(retried));
  console.log("      `defaultBatchId` is `${mode}-YYYY-MM-DD` (loop.mjs:293) and the CLI passes no id,");
  console.log("      so the second run reuses it. The journal is append-only, so BOTH records persist.");
  console.log("      Decision-side counts double; settlement keys on (batchId, symbol) so rows do not.");

  console.log("\n  (3) EXPLICIT INDEPENDENT EXPERIMENT — two DISTINCT identities, one session");
  row("two arms, one session", counts(base(dir, "arms", { batchIdFor: distinct })));
  console.log("      Legitimate and already handled correctly: the outcome rows are real and the");
  console.log("      session is still ONE independent period, because holdPeriodKeys ranks distinct");
  console.log("      entry times. This must NOT be conflated with (2).");

  console.log("\n  (4) INTERRUPTED PARTIAL WRITE — a decision with no outcome, then a retry");
  const partial = path.join(dir, "partial.jsonl");
  {
    const allowed = [buy("AAA"), buy("BBB")];
    // First attempt: the decision lands, the process dies before settle ever runs.
    recordDecision({ batchId: `paper-${d10(SESS[0])}`, at: new Date(AFTER).toISOString(),
      context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["CTRL"],
      seed: 1, mode: MODE.PAPER }, partial);
    // The operator reruns. Same id again.
    recordDecision({ batchId: `paper-${d10(SESS[0])}`, at: new Date(AFTER).toISOString(),
      context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["CTRL"],
      seed: 1, mode: MODE.PAPER }, partial);
    settleOutcomes({ series: SERIES, dates: SESS, journalFile: partial, mode: MODE.PAPER,
      holdDays: 5, costPerLeg: 0, now: AFTER });
  }
  row("partial write then retry", counts(partial));
  console.log("      Indistinguishable from (2) in the record: the journal carries no marker saying the");
  console.log("      first attempt did not complete. The lock (analyst/lock.mjs) prevents a CONCURRENT");
  console.log("      second run and releases on exit, so it does not mark an interrupted one either.");

  console.log("\n  (5) AFTER-SETTLEMENT RETRY — rerun once outcomes already exist");
  const settledFirst = base(dir, "post", { batchIdFor: sameId });
  {
    const allowed = [buy("AAA"), buy("BBB")];
    recordDecision({ batchId: `paper-${d10(SESS[0])}`, at: new Date(AFTER + DAY * 1000).toISOString(),
      context: { asOfTime: SESS[0] }, proposals: allowed, gate: { allowed }, pool: ["CTRL"],
      seed: 1, mode: MODE.PAPER }, settledFirst);
    const again = settleOutcomes({ series: SERIES, dates: SESS, journalFile: settledFirst,
      mode: MODE.PAPER, holdDays: 5, costPerLeg: 0, now: AFTER + DAY * 1000 });
    console.log(`      second settle: ${JSON.stringify(again)}`);
  }
  row("retry after settlement", counts(settledFirst));
  console.log("      The outcome rows are protected by the (batchId, symbol) key, so the realised");
  console.log("      figures are safe. The DECISION-side counts still double, and `sized` is what");
  console.log("      gates the standing minimum.");

  console.log("\n  WHAT MOVES, AND WHAT DOES NOT, UNDER A SAME-IDENTITY RETRY:");
  console.log("    moves:  decisionRecords, nominalTrades (`sized`), rejectCounts, halts, brakes,");
  console.log("            criterion 1's numerator.");
  console.log("    safe:   outcomeRows, pairedOutcomes, independentPeriods — the settlement key and");
  console.log("            the period ranking both already de-duplicate.");
  console.log("  So the defect is confined to the DECISION-SIDE counts, which is what makes an");
  console.log("  append-only, non-destructive policy sufficient. See docs for the proposed options.\n");
}

function part2() {
  console.log("=== PART 2. VERSION BOUNDARY — pooled today vs candidate-scoped diagnostic ===\n");
  const dir = tmpDir();
  const L = path.join(dir, "ledger.jsonl");
  const J = path.join(dir, "journal.jsonl");
  const CID = "SYNTHETIC-NOT-A-REAL-CANDIDATE";

  const h = (text) => inputHashes({ systemPrompt: text, checklist: "c", checklistId: "v1", universeText: "AAA\nBBB" });
  const hv1 = h("prompt version one");
  const hv2 = h("prompt version two — a different prompt");

  registerVersion({
    candidateId: CID, version: "v1", whatChanged: "synthetic baseline, not evidence",
    why: "diagnostic fixture only", registeredClaim: "none — this is a fixture",
    control: "matched random from the same slate", minimumPeriods: 50, mdeAtMinimum: 0.0093,
    drawdownWindow: "none", hashes: hv1,
  }, L);

  // Five sessions under v1, then a prompt change, then five under v2.
  const half = SESS.slice(0, 10);
  half.forEach((t, i) => {
    const allowed = [buy("AAA"), buy("BBB")];
    const version = i < 5 ? "v1" : "v2";
    if (i === 5) {
      registerVersion({
        candidateId: CID, version: "v2", whatChanged: "synthetic prompt change, not evidence",
        why: "diagnostic fixture only", registeredClaim: "none — this is a fixture",
        control: "matched random from the same slate", minimumPeriods: 50, mdeAtMinimum: 0.0093,
        drawdownWindow: "none", supersedes: "v1", hashes: hv2,
      }, L);
    }
    const rec = recordDecision({
      batchId: `paper-${d10(t)}`, at: new Date(t * 1000 + 3600_000).toISOString(),
      context: { asOfTime: t }, proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1,
      mode: MODE.PAPER, model: version === "v1" ? "synthetic-model-A" : "synthetic-model-B",
      checklistId: version === "v1" ? "v1" : "v2",
    }, J);
    markFirstDecision({ candidateId: CID, version, at: rec.at, batchId: rec.batchId }, L);
  });
  settleOutcomes({ series: SERIES, dates: SESS, journalFile: J, mode: MODE.PAPER, holdDays: 5,
    costPerLeg: 0, now: AFTER });

  const chain = verifyLedger(L);
  console.log(`  ledger chain: ok=${chain.ok}, entries=${chain.entries}, problems=${chain.problems.length}`);
  console.log(`  familySize (registered versions across all candidates): ${familySize(L)}`);

  const recs = readJournal(J).records;
  const decisions = recs.filter((r) => r.kind === KIND.DECISION);
  const outs = recs.filter((r) => r.kind === KIND.OUTCOME);

  console.log("\n  RECORD IDENTITY, as the journal actually carries it:");
  const ids = new Set(decisions.map((d) => d.batchId));
  const models = [...new Set(decisions.map((d) => d.model ?? null))];
  const checklists = [...new Set(decisions.map((d) => d.checklistId ?? null))];
  const hashes = [...new Set(decisions.map((d) => d.contextHash))];
  console.log(`    batchIds ${ids.size}, contextHashes ${hashes.length}, models ${JSON.stringify(models)}, `
    + `checklistIds ${JSON.stringify(checklists)}`);
  console.log(`    MISSING IDENTIFIER: no decision record carries a candidateId or a version. The`);
  console.log(`    ledger knows the boundary; the journal does not reference it, so any scoping must`);
  console.log(`    join on TIME, not on an identifier the records contain.`);

  const win = evidenceWindow(CID, L);
  console.log(`\n  evidenceWindow: version ${win.version}, supersedes ${win.supersedes}, since ${win.since}`);
  const after = recordsAfterBoundary(decisions, win.since);
  const outsNaive = recordsAfterBoundary(outs, win.since);
  // THE DECISIVE LIMIT. An outcome's `at` is its SETTLEMENT timestamp, not its decision's. Settlement
  // happens days later and, in a backfilled or batched settle, all at once — so a time filter on
  // outcome rows attributes EVERY row to whichever version was current when `settle` ran.
  const scopedIds = new Set(after.map((d) => d.batchId));
  const outsByParent = outs.filter((o) => scopedIds.has(o.batchId));
  console.log(`    decisions at/after the boundary:        ${after.length} of ${decisions.length}`);
  console.log(`    outcome rows at/after, by their own at: ${outsNaive.length} of ${outs.length}  <-- WRONG`);
  console.log(`    outcome rows scoped by PARENT decision: ${outsByParent.length} of ${outs.length}`);
  console.log("    An outcome's `at` is its SETTLEMENT time. Settlement runs days later, so a naive");
  console.log("    time filter credits every row to whichever version was current when `settle` ran --");
  console.log("    here all 20, including the ten the superseded version produced. Any scoping must join");
  console.log("    through the parent decision's batchId, not through the outcome's own timestamp.");
  console.log("    And the decision side has its own version of this: `recordsAfterBoundary` keys on");
  console.log("    `at`, a WRITE timestamp, while `decisionTimeMs` exists precisely because that differs");
  console.log("    from the decision bar. A boundary read off `at` and one off `asOfTime` need not agree.");
  const outsAfter = outsByParent;

  const s = scoreJournal(J);
  const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(3)}%` : "—");
  console.log("\n  POOLED, AS SCORING REPORTS IT TODAY (no version is consulted anywhere):");
  console.log(`    batches ${s.batches}, sized ${s.decisions}, outcomes ${s.outcomes}, `
    + `periods ${s.periods}, edge ${pct(s.edge)}`);

  const keysAll = holdPeriodKeys(decisions, outs, 5);
  const keysAfter = holdPeriodKeys(after, outsAfter, 5);
  console.log("\n  CANDIDATE-SCOPED, AS A DIAGNOSTIC ONLY (not adopted, not approved):");
  console.log(`    decisions ${after.length}, outcome rows ${outsAfter.length}, `
    + `independent periods ${new Set(keysAfter).size} (pooled: ${new Set(keysAll).size})`);
  const clsAfter = classifyOutcomes(outsAfter);
  console.log(`    paired rows ${clsAfter.paired.length}, agent-only ${clsAfter.agentOnly.length}`);

  console.log("\n  PENDING SETTLEMENTS CROSSING THE BOUNDARY:");
  const boundaryMs = Date.parse(win.since);
  const straddling = decisions.filter((d) => {
    const dt = Date.parse(d.at);
    const settledAt = outs.filter((o) => o.batchId === d.batchId).map((o) => Date.parse(o.at));
    return dt < boundaryMs && settledAt.some((m) => m >= boundaryMs);
  });
  console.log(`    decisions taken BEFORE the boundary whose outcomes were written after: ${straddling.length}`);
  console.log("    These belong to the old version's evidence by decision time and to the new one by");
  console.log("    settlement time. Nothing in the record says which, and no rule here decides it.");

  const drift = driftFromRegistered(CID, hv2, L);
  console.log(`\n  driftFromRegistered against the v2 hashes: registered=${drift.registered}, `
    + `version=${drift.version}, drifted=${JSON.stringify(drift.drifted)}`);
  const driftStale = driftFromRegistered(CID, hv1, L);
  console.log(`  the same check against the OLD v1 hashes: drifted=${JSON.stringify(driftStale.drifted)}`);
  console.log("  A matching hash shows the configuration is the one registered. IT IS NOT EVIDENCE that");
  console.log("  the candidate's semantics are owner-approved — registering a version is a bookkeeping");
  console.log("  act, and docs/FORWARD-EVAL-SPEC.md is still a proposal whose header says so.");
  console.log(`\n  every synthetic candidate id used here: ${CID}`);
  console.log(`  temp ledger ${L}\n  temp journal ${J}\n`);
}

async function main() {
  const before = fingerprint(DEFAULT_JOURNAL);
  console.log("RETRY CONTRACT AND VERSION BOUNDARY — offline, synthetic, read-only against the runtime\n");
  console.log(`real journal ${DEFAULT_JOURNAL} fingerprint before: ${before}\n`);
  part1();
  part2();
  console.log("=== SAFETY ===");
  console.log(`  real journal fingerprint after: ${fingerprint(DEFAULT_JOURNAL)}`);
  console.log(`  unchanged: ${before === fingerprint(DEFAULT_JOURNAL)}`);
  console.log("  no CLI launched, no model client, no key, no broker path, no lock taken.");
  console.log("  No record was rewritten or deleted; every journal and ledger above is in a temp dir.");
  console.log("  NO POLICY IS CHOSEN AND NOTHING IS IMPLEMENTED. The scoped figures are a diagnostic");
  console.log("  comparison; FORWARD-EVAL-SPEC remains an unapproved proposal.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
