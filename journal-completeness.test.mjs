/**
 * End-to-end fixtures for journal settlement and scoring completeness.
 *
 * WHAT IS ALREADY COVERED, AND NOT REPEATED HERE. `analyst/journal.test.mjs` covers control
 * truncation when the pool is smaller than the book (:54), holds and zero-size decisions taking no
 * control slot (:60), malformed lines being counted (:122), period clustering and the unknown bucket
 * (:331, :377), and the degenerate single-period interval (:427). `analyst/loop.test.mjs` covers a
 * missing price being skipped rather than zeroed (:322), partial and complete holds (:443, :459),
 * settle idempotence (:483) and settle's mode filter (:528). Every one of those is a UNIT test of one
 * function. None follows a row through decision -> control -> settle -> score -> protocol to the
 * printed readout, which is where the divergences below become visible.
 *
 * ALL FIGURES HERE ARE SYNTHETIC. Hand-built panels, chosen to make the arithmetic checkable. None of
 * it is evidence about any strategy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  recordDecision, scoreJournal, readJournal, matchedRandomControl, KIND, DEFAULT_JOURNAL,
} from "./analyst/journal.mjs";
import { settleOutcomes } from "./analyst/loop.mjs";
import { tier1 } from "./analyst/protocol.mjs";
import {
  classifyOutcomes, orphanOutcomes, duplicateOutcomes, splitAllowed, adjacentClusterOverlap,
} from "./journal-completeness.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jcomp-")), "j.jsonl");
const DAY = 86400, T0 = 1735689600;                       // 2025-01-01
const THESIS = "a thesis long enough to review";
const p = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS, ...over });

/** THE REAL JOURNAL MUST BE UNTOUCHED BY THIS SUITE. Hashed before and after, below. */
const realJournalFingerprint = () => {
  if (!fs.existsSync(DEFAULT_JOURNAL)) return "ABSENT";
  return crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex");
};
const FINGERPRINT_BEFORE = realJournalFingerprint();

const N = 30;
const DATES = Array.from({ length: N }, (_, i) => T0 + i * DAY);
/** A deterministic price path from a repeating per-session step list. */
const walk = (steps, bars = N) => {
  const out = [{ time: DATES[0], close: 100 }];
  for (let i = 1; i < bars; i++) out.push({ time: DATES[i], close: out[i - 1].close * (1 + steps[(i - 1) % steps.length]) });
  return out;
};
const SERIES = {
  PAIRED:    walk([0.004, -0.002, 0.006, 0.001, -0.003, 0.005, 0.002, -0.004, 0.003, 0.000]),
  UNPAIRED:  walk([0.05, 0.04, 0.06, 0.05, 0.03, 0.05, 0.04, 0.06, 0.05, 0.04]),
  CTRL_FULL: walk([0.003, -0.002, 0.005, 0.001, -0.003, 0.004, 0.002, -0.004, 0.002, 0.000]),
  CTRL_GAP:  walk([0.003, -0.002, 0.005, 0.001, -0.003, 0.004, 0.002, -0.004, 0.002, 0.000], 9),
};

// ---- THE HEADLINE: edge and its interval are computed on different rows -------------------------

test("E2E: the printed edge can fall OUTSIDE the interval printed beside it", () => {
  // Ten daily batches, each buying two names, with a pool of ONE. matchedRandomControl truncates to a
  // single control slot, so the second name is settled with a null control through the real settle
  // path -- nothing is hand-written.
  const f = tmp();
  for (let b = 0; b < 10; b++) {
    const allowed = [p("PAIRED"), p("UNPAIRED")];
    recordDecision({ batchId: `b${b}`, at: new Date((T0 + b * DAY) * 1000).toISOString(),
      context: { asOfTime: T0 + b * DAY }, proposals: allowed, gate: { allowed },
      pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  }
  const r = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper",
    holdDays: 5, costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  assert.equal(r.wrote, 20, "both names settle; only the control half is missing");

  const outcomes = readJournal(f).records.filter((x) => x.kind === KIND.OUTCOME);
  const cls = classifyOutcomes(outcomes);
  assert.equal(cls.paired.length, 10);
  assert.equal(cls.agentOnly.length, 10, "the truncated slot leaves ten agent-only rows");

  const s = scoreJournal(f);
  // The interval is NOT degenerate here: the paired diffs genuinely vary across periods.
  assert.ok(s.edgeCI.lo !== null && s.edgeCI.hi > s.edgeCI.lo, "the interval must be a real one");
  assert.equal(s.periods, 2);
  // THE DEFECT, STATED AS AN INEQUALITY RATHER THAN A DESCRIPTION.
  assert.ok(s.edge > s.edgeCI.hi,
    `printed edge ${s.edge} should fall above the printed interval top ${s.edgeCI.hi}`);
  // And the correct paired estimate IS computed -- it is just never printed.
  assert.ok(Math.abs(s.edgeCI.mean - 0.002) < 0.001, `paired mean ${s.edgeCI.mean} should be ~0.20%`);
  assert.ok(s.edge > 10 * s.edgeCI.mean, "the unpaired figure is an order of magnitude larger here");
});

test("E2E: beatControlRate is biased DOWNWARD by rows that cannot be paired", () => {
  const f = tmp();
  for (let b = 0; b < 10; b++) {
    const allowed = [p("PAIRED"), p("UNPAIRED")];
    recordDecision({ batchId: `b${b}`, at: new Date((T0 + b * DAY) * 1000).toISOString(),
      context: { asOfTime: T0 + b * DAY }, proposals: allowed, gate: { allowed },
      pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  }
  settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper", holdDays: 5,
    costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  const outcomes = readJournal(f).records.filter((x) => x.kind === KIND.OUTCOME);
  const cls = classifyOutcomes(outcomes);
  const beatPaired = cls.paired.filter((o) => o.netReturn > o.controlReturn).length;
  const s = scoreJournal(f);
  assert.equal(beatPaired, cls.paired.length, "every paired row beat its control in this fixture");
  assert.equal(s.beatControlRate, 0.5, "yet the printed rate is 50%, because the denominator is ALL rows");
  // The two statistics are biased in OPPOSITE directions on the same journal, which is the thing a
  // reader cannot reconcile from the readout alone.
  assert.ok(s.edge > s.edgeCI.mean && s.beatControlRate < beatPaired / cls.paired.length);
});

test("E2E: a control that lost its EXIT bar keeps the agent half — the asymmetry named", () => {
  // Entry at session 5 and a 5-session hold exits at session 10; CTRL_GAP has bars 0..8 only.
  const f = tmp();
  const allowed = [p("PAIRED")];
  recordDecision({ batchId: "g0", at: new Date((T0 + 5 * DAY) * 1000).toISOString(),
    context: { asOfTime: T0 + 5 * DAY }, proposals: allowed, gate: { allowed },
    pool: ["CTRL_GAP"], seed: 1, mode: "paper" }, f);
  assert.deepEqual(matchedRandomControl(allowed, ["CTRL_GAP"], 1), [{ symbol: "CTRL_GAP", targetPct: 0.05 }],
    "the control WAS drawn -- this is not the truncation path");
  const r = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper", holdDays: 5,
    costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  assert.equal(r.wrote, 1);
  const [o] = readJournal(f).records.filter((x) => x.kind === KIND.OUTCOME);
  assert.ok(Number.isFinite(o.netReturn), "the agent half survives");
  assert.equal(o.controlReturn, null, "the control half is null");

  // THE ASYMMETRY: a missing AGENT bar drops the whole row instead.
  const f2 = tmp();
  const allowed2 = [p("CTRL_GAP")];            // the SHORT series as the agent's own name
  recordDecision({ batchId: "g1", at: new Date((T0 + 5 * DAY) * 1000).toISOString(),
    context: { asOfTime: T0 + 5 * DAY }, proposals: allowed2, gate: { allowed: allowed2 },
    pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f2);
  const r2 = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f2, mode: "paper", holdDays: 5,
    costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  assert.equal(r2.wrote, 0, "no row at all when the AGENT's bar is missing");
  assert.equal(r2.pending, 1, "and it is reported as `pending`, which analyst-run prints as still-in-hold");
});

// ---- the stopping criterion ---------------------------------------------------------------------

test("E2E: criterion 7 STOPS the run over a weekend, while settle is behaving correctly", () => {
  // A trading-session panel: Thu, Fri, Mon, Tue. Saturday and Sunday are absent, as a real panel's are.
  const sess = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"]
    .map((d) => Date.parse(`${d}T00:00:00Z`) / 1000);
  const series = {
    WIN: sess.map((t, i) => ({ time: t, close: 100 * 1.01 ** i })),
    CTRL: sess.map((t) => ({ time: t, close: 100 })),
  };
  const f = tmp();
  const allowed = [p("WIN")];
  recordDecision({ batchId: "thu", at: "2026-01-01T21:00:00Z", context: { asOfTime: sess[0] },
    proposals: allowed, gate: { allowed }, pool: ["CTRL"], seed: 1, mode: "paper" }, f);
  const now = Date.parse("2026-01-06T21:00:00Z");          // the following Tuesday
  const r = settleOutcomes({ series, dates: sess, journalFile: f, mode: "paper", holdDays: 5,
    costPerLeg: 0, now });
  assert.equal(r.wrote, 0, "only three TRADING sessions have elapsed, so settle correctly writes nothing");
  assert.equal(r.pending, 1);

  const c7 = tier1(f, { now }).criteria.find((c) => c.n === 7);
  assert.equal(c7.stops, true, "criterion 7 is a stopping criterion");
  assert.equal(c7.status, "fail", "and it FAILS, because five CALENDAR days have passed");
  assert.equal(c7.numbers.due, 1);
  assert.equal(c7.numbers.unsettled, 1);
  // The same file imports decisionTimeMs and uses it for criterion 1; criterion 7 does not.
  const c1 = tier1(f, { now }).criteria.find((c) => c.n === 1);
  assert.ok(c1, "criterion 1 exists and is the one that uses the decision bar");
});

// ---- duplicates, orphans, modes -----------------------------------------------------------------

test("a duplicate outcome row is counted twice by the score and hidden by both Sets", () => {
  const f = tmp();
  const allowed = [p("PAIRED")];
  recordDecision({ batchId: "d0", at: new Date(T0 * 1000).toISOString(), context: { asOfTime: T0 },
    proposals: allowed, gate: { allowed }, pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  const now = Date.parse("2025-03-01T00:00:00Z");
  settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper", holdDays: 5, costPerLeg: 0, now });
  const line = fs.readFileSync(f, "utf8").split("\n").find((l) => l.includes(`"${KIND.OUTCOME}"`));
  fs.appendFileSync(f, `${line}\n`);                       // exactly what a double append leaves
  const s = scoreJournal(f);
  assert.equal(s.outcomes, 2, "the duplicate is counted");
  assert.equal(s.edgeCI.nominalN, 2, "and it enters the paired sample twice");
  const again = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper",
    holdDays: 5, costPerLeg: 0, now });
  assert.equal(again.wrote, 0);
  assert.equal(again.already, 1, "settle reports `already` and does not notice the repeated key");
  // The audit computes what criterion 7's text says is not computable from a file.
  assert.deepEqual(duplicateOutcomes(readJournal(f).records), [{ key: "d0/PAIRED", count: 2 }]);
  const c7 = tier1(f, { now }).criteria.find((c) => c.n === 7);
  assert.equal(c7.status, "pass", "criterion 7's Set hides the duplicate entirely");
});

test("an orphan outcome is invisible to every statistic, which is safe but uncounted", () => {
  const f = tmp();
  const allowed = [p("PAIRED")];
  recordDecision({ batchId: "good", at: new Date(T0 * 1000).toISOString(), context: { asOfTime: T0 },
    proposals: allowed, gate: { allowed }, pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper", holdDays: 5,
    costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  fs.appendFileSync(f, "{not json\n");
  fs.appendFileSync(f, `${JSON.stringify({ kind: KIND.OUTCOME, batchId: "orphan", symbol: "Z",
    holdDays: 5, netReturn: 9.99, controlReturn: 0 })}\n`);
  const s = scoreJournal(f);
  assert.equal(s.malformed, 1);
  assert.equal(s.outcomes, 1, "the +999% orphan does not reach any mean -- the safe direction");
  assert.ok(s.agentMeanNet < 0.02, "no contamination from the orphan");
  // But nothing in the readout says it is there. The audit names it.
  assert.equal(orphanOutcomes(readJournal(f).records).length, 1);
});

test("settle and score disagree about a record with no mode field", () => {
  // recordDecision has defaulted mode since journal.mjs's first commit (489f2ef), so this record
  // cannot be produced by the runtime -- it is the hand-edited or foreign-writer case. The
  // inconsistency is still real: score and protocol tolerate a missing mode, settle does not.
  const f = tmp();
  const allowed = [p("PAIRED")];
  fs.appendFileSync(f, `${JSON.stringify({ kind: KIND.DECISION, batchId: "legacy",
    at: new Date(T0 * 1000).toISOString(), contextHash: "h", asOfTime: T0, proposals: allowed,
    allowed, rejected: [], control: [{ symbol: "CTRL_FULL", targetPct: 0.05 }], poolSize: 1 })}\n`);
  const s = scoreJournal(f);
  assert.equal(s.batches, 1, "scoreJournal counts it as paper, via (r.mode ?? MODE.PAPER)");
  assert.equal(s.decisions, 1);
  const r = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper",
    holdDays: 5, costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  assert.equal(r.decisions, 0, "settleOutcomes filters on r.mode === mode and never sees it");
  assert.equal(r.pending, 0, "so it is not even counted as pending");
  // And criterion 7, which shares score's tolerance, calls it unsettled -- permanently.
  const c7 = tier1(f, { now: Date.parse("2025-03-01T00:00:00Z") }).criteria.find((c) => c.n === 7);
  assert.equal(c7.status, "fail");
  assert.equal(c7.numbers.unsettled, 1, "a record settle cannot reach fails a STOPPING criterion forever");
});

// ---- what counts as a decision ------------------------------------------------------------------

test("closing rows count toward the standing minimum and can never be settled", () => {
  const f = tmp();
  const closes = Array.from({ length: 60 }, (_, i) => p(`S${i}`, { action: "sell", targetPct: 0 }));
  recordDecision({ batchId: "c1", at: "2026-01-01T00:00:00Z", proposals: closes,
    gate: { allowed: closes }, pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  recordDecision({ batchId: "c2", at: "2026-04-01T00:00:00Z", proposals: [], gate: { allowed: [] },
    pool: [], seed: 1, mode: "paper" }, f);
  const s = scoreJournal(f);
  assert.equal(s.decisions, 60, "scoreJournal's `sized` counts them: action !== 'hold' only");
  assert.ok(s.spanDays >= 60);
  assert.equal(s.meetsStandingMinimum, true, "the evidence floor is met by sixty position closes");
  assert.equal(s.outcomes, 0, "with zero outcomes possible");
  // Every settlement-side consumer excludes them, which is the inconsistency.
  const decisions = readJournal(f).records.filter((r) => r.kind === KIND.DECISION);
  assert.deepEqual(splitAllowed(decisions), { measurable: 0, closing: 60, hold: 0 });
  assert.equal(matchedRandomControl(closes, ["CTRL_FULL"], 1).length, 0, "no control slots");
  const c7 = tier1(f, { now: Date.parse("2026-06-01T00:00:00Z") }).criteria.find((c) => c.n === 7);
  assert.equal(c7.numbers.due, 0, "criterion 7 does not consider them due");
});

test("a hold reaches `allowed` but no statistic that needs an outcome", () => {
  const f = tmp();
  const allowed = [p("PAIRED"), p("HELD", { action: "hold", targetPct: 0 })];
  recordDecision({ batchId: "h0", at: new Date(T0 * 1000).toISOString(), context: { asOfTime: T0 },
    proposals: allowed, gate: { allowed }, pool: ["CTRL_FULL"], seed: 1, mode: "paper" }, f);
  const r = settleOutcomes({ series: SERIES, dates: DATES, journalFile: f, mode: "paper",
    holdDays: 5, costPerLeg: 0, now: Date.parse("2025-03-01T00:00:00Z") });
  assert.equal(r.wrote, 1, "the hold produces no row");
  const s = scoreJournal(f);
  assert.equal(s.decisions, 1, "and is excluded from `sized` too");
  const decisions = readJournal(f).records.filter((x) => x.kind === KIND.DECISION);
  assert.deepEqual(splitAllowed(decisions), { measurable: 1, closing: 0, hold: 1 });
});

test("unequal position sizes are weighted EQUALLY in every mean", () => {
  // Deliberate per-decision semantics, but "analyst mean net" does not say which it is.
  const f = tmp();
  const allowed = [p("BIG", { targetPct: 0.10 }), p("SMALL", { targetPct: 0.01 })];
  recordDecision({ batchId: "w0", at: new Date(T0 * 1000).toISOString(), context: { asOfTime: T0 },
    proposals: allowed, gate: { allowed }, pool: ["CTRL_FULL", "PAIRED"], seed: 1, mode: "paper" }, f);
  const series = {
    ...SERIES,
    BIG: DATES.map((t, i) => ({ time: t, close: i < 5 ? 100 : 105 })),      // +5% over the hold
    SMALL: DATES.map((t, i) => ({ time: t, close: i < 5 ? 100 : 95 })),     // -5% over the hold
  };
  settleOutcomes({ series, dates: DATES, journalFile: f, mode: "paper", holdDays: 5, costPerLeg: 0,
    now: Date.parse("2025-03-01T00:00:00Z") });
  const s = scoreJournal(f);
  // Equal weighting: (+5% + -5%)/2 = 0. A 10:1 portfolio weighting would give +4.09%.
  assert.ok(Math.abs(s.agentMeanNet) < 1e-9, `equal-weighted mean should be 0, got ${s.agentMeanNet}`);
  const portfolio = (0.10 * 0.05 + 0.01 * -0.05) / 0.11;
  assert.ok(Math.abs(portfolio - 0.040909) < 1e-5, "the portfolio-weighted figure differs materially");
  // The sizes ARE recorded, so this is a reporting choice and not lost information.
  const d = readJournal(f).records.find((r) => r.kind === KIND.DECISION);
  assert.deepEqual(d.allowed.map((a) => a.targetPct), [0.10, 0.01]);
});

test("adjacent holding-period clusters share hold-1 sessions at daily entries", () => {
  const decisions = Array.from({ length: 12 }, (_, i) => ({ asOfTime: T0 + i * DAY }));
  const ov = adjacentClusterOverlap(decisions, 5);
  assert.equal(ov.sharedSessions, 4, "four of five sessions are shared between adjacent clusters");
  assert.equal(ov.holdDays, 5);
  // Within a cluster the overlap is what clustering removes; between clusters it is not.
  assert.equal(adjacentClusterOverlap(decisions, 1).sharedSessions, 0, "a one-session hold shares nothing");
});

// ---- mechanical safety --------------------------------------------------------------------------

test("SAFETY: the audit cannot reach a model client or an order path", () => {
  // Walked rather than asserted. Static imports are followed transitively from the diagnostic.
  const root = path.dirname(new URL(import.meta.url).pathname);
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*import\s[^"']*["'](\.[^"']+)["']/gm)) {
      walk(path.resolve(path.dirname(file), m[1]));
    }
    for (const m of src.matchAll(/\bimport\(\s*["'](\.[^"']+)["']/g)) {
      walk(path.resolve(path.dirname(file), m[1]));
    }
  };
  walk(path.join(root, "journal-completeness.mjs"));
  const names = [...seen].map((f) => path.basename(f));
  assert.ok(names.includes("journal-completeness.mjs"));
  for (const forbidden of ["analyst-run.mjs", "trader.mjs", "ibkr-bars.mjs", "ibkr-collect.mjs", "ibkr-panel.mjs"]) {
    assert.ok(!names.includes(forbidden), `the audit must not reach ${forbidden}, graph: ${names.join(", ")}`);
  }
  // No SDK IMPORT and no key read anywhere in the graph. A substring check on "@anthropic-ai" is
  // too crude and failed on a DOC-COMMENT reference in decide.mjs (which protocol.mjs pulls in for
  // BATCH_FAILURE); what matters is whether the module can obtain a client, so the check is on the
  // import and construction forms.
  const SDK_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'`]@anthropic-ai\//;
  for (const f of seen) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!SDK_IMPORT.test(src), `${path.basename(f)} must not import the model SDK`);
    assert.ok(!/new\s+Anthropic\s*\(/.test(src), `${path.basename(f)} must not construct a model client`);
    assert.ok(!/ANTHROPIC_API_KEY/.test(src), `${path.basename(f)} must not read the model key`);
  }
  // And the positive statement this rests on: decide.mjs takes an INJECTED client and imports no
  // SDK itself, so reaching it through protocol.mjs cannot produce a model call.
  const decideSrc = fs.readFileSync(path.join(root, "analyst", "decide.mjs"), "utf8");
  assert.ok(!SDK_IMPORT.test(decideSrc), "decide.mjs is expected to take an injected client");
});

test("SAFETY: the audit names none of the protected identifiers", () => {
  // The patterns are READ FROM THE CHECKER at test time rather than written here, because writing
  // them into a committed file is itself what trips the protected-logic check.
  const checker = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),
    "scripts", "check-protected-logic.cjs"), "utf8");
  const block = checker.match(/PROTECTED_PATTERNS\s*=\s*\[([^\]]*)\]/s);
  assert.ok(block, "the checker must still declare its pattern list");
  const patterns = [...block[1].matchAll(/["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g)].map((m) => m[1]);
  assert.ok(patterns.length >= 3, `expected several protected identifiers, found ${patterns.length}`);
  const mine = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),
    "journal-completeness.mjs"), "utf8");
  for (const name of patterns) {
    assert.ok(!mine.includes(name), `journal-completeness.mjs must not name the protected identifier it found`);
  }
});

test("SAFETY: this suite left the real journal exactly as it found it", () => {
  // DEFAULT_JOURNAL is resolved at import time, so a record* call that forgets its file argument
  // would write into the real file. Every call above passes an explicit tmp path; this proves it.
  assert.equal(realJournalFingerprint(), FINGERPRINT_BEFORE,
    "the real journal changed during this suite — a fixture is missing its file argument");
});
