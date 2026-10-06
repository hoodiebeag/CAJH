#!/usr/bin/env node
/**
 * journal-completeness.mjs — READ-ONLY audit of what each journal statistic actually consumes.
 *
 * WHY THIS EXISTS. `analyst-run.mjs score` prints `edge` as the point estimate and the PAIRED
 * bootstrap interval beside it. Those are computed from different row sets: `edge` is a difference of
 * INDEPENDENTLY FILTERED means (journal.mjs:367-368) while the interval is strictly paired (:421). When
 * some outcomes carry a null control the two diverge, and the printed point estimate can land outside
 * the printed interval. This makes the divergence visible instead of leaving it to be inferred.
 *
 * READ-ONLY, AND MECHANICALLY SO. It calls `readJournal`, `scoreJournal` and `tier1` and nothing else.
 * It never appends, never settles, never constructs a model client and cannot reach an order path --
 * `journal-completeness.test.mjs` walks the import graph and asserts that.
 *
 * NOT EVIDENCE OF ANYTHING. It reports completeness and missingness. It does not score a strategy, and
 * a figure printed here from a dry-run or synthetic journal is not prospective evidence of edge.
 *
 * Usage: node journal-completeness.mjs [--journal FILE] [--mode paper]
 */

import { readJournal, scoreJournal, KIND, MODE, decisionTimeMs, DEFAULT_JOURNAL } from "./analyst/journal.mjs";
import { tier1 } from "./analyst/protocol.mjs";

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};

const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(2)}%`);

/**
 * Classify every outcome row by what it can contribute to.
 *
 * `paired` is the only class the edge interval can use. `agentOnly` rows still move `agentMeanNet`,
 * `edge` and `hitRate`, and sit in `beatControlRate`'s DENOMINATOR while never being able to reach its
 * numerator.
 */
export function classifyOutcomes(outcomes) {
  const out = { paired: [], agentOnly: [], controlOnly: [], neither: [] };
  for (const o of outcomes) {
    const a = Number.isFinite(o.netReturn), c = Number.isFinite(o.controlReturn);
    (a && c ? out.paired : a ? out.agentOnly : c ? out.controlOnly : out.neither).push(o);
  }
  return out;
}

/** Outcome rows whose decision batch is absent from the journal — invisible to every statistic. */
export function orphanOutcomes(records) {
  const batches = new Set(records.filter((r) => r.kind === KIND.DECISION).map((r) => r.batchId));
  return records.filter((r) => r.kind === KIND.OUTCOME && !batches.has(r.batchId));
}

/**
 * Duplicate (batchId, symbol) outcome rows.
 *
 * `scoreJournal` counts a duplicate TWICE in every mean and in `nominalN`. `settleOutcomes` builds a
 * Set and so reports it as `already`, and criterion 7's own Set hides it too. Criterion 7's text says
 * the idempotence half "is not computable from a file" — a repeated key is, and this computes it.
 */
export function duplicateOutcomes(records) {
  const seen = new Map();
  for (const r of records.filter((x) => x.kind === KIND.OUTCOME)) {
    const k = `${r.batchId}\u0000${r.symbol}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => ({ key: k.replace("\u0000", "/"), count: n }));
}

/**
 * Allowed rows split by whether they can ever produce a measurable outcome.
 *
 * `measurable` is what control, settle and criterion 7's `due` all use (action !== hold AND
 * targetPct > 0). `closing` rows are counted by `scoreJournal`'s `sized`, by criterion 6's review
 * count and by criterion 8's news denominator, but can never be settled or paired.
 */
export function splitAllowed(decisions) {
  const out = { measurable: 0, closing: 0, hold: 0 };
  for (const d of decisions) {
    for (const a of d.allowed ?? []) {
      if (a.action === "hold") out.hold++;
      else if ((a.targetPct ?? 0) > 0) out.measurable++;
      else out.closing++;
    }
  }
  return out;
}

/**
 * Sessions shared between adjacent holding-period clusters.
 *
 * `holdPeriodKeys` buckets by `floor(rank / holdDays)` over distinct entry sessions, which removes
 * overlap WITHIN a cluster. It does not remove it BETWEEN clusters: with daily entries, cluster k's
 * last entry (rank hk+h-1) holds sessions hk+h .. hk+2h-1 and cluster k+1's first entry (rank hk+h)
 * holds hk+h+1 .. hk+2h, so they share h-1 of h sessions. The note in `holdPeriodKeys` covers the
 * missed-session case, which is conservative; this one is not.
 */
export function adjacentClusterOverlap(decisions, holdDays) {
  const times = [...new Set(decisions.map((d) => d.asOfTime).filter(Number.isFinite))].sort((a, b) => a - b);
  if (times.length <= holdDays) return { clusters: times.length ? 1 : 0, sharedSessions: 0, holdDays };
  const lastOfCluster0 = holdDays - 1, firstOfCluster1 = holdDays;
  const shared = Math.max(0, (lastOfCluster0 + holdDays) - (firstOfCluster1 + 1) + 1);
  return { clusters: Math.ceil(times.length / holdDays), sharedSessions: shared, holdDays, entries: times.length };
}

function main() {
  const file = flag("journal", DEFAULT_JOURNAL);
  const mode = flag("mode", MODE.PAPER);
  const { records, malformed } = readJournal(file);

  console.log("JOURNAL COMPLETENESS AUDIT — read-only, no writes, no model, no orders");
  console.log(`journal ${file}`);
  console.log(`mode ${mode}\n`);
  if (!records.length) {
    console.log("The journal is empty or absent. Nothing to audit — and that is the honest answer:");
    console.log("no forward decision has been recorded, so every statistic below would be null.");
    return;
  }

  const allDecisions = records.filter((r) => r.kind === KIND.DECISION);
  const decisions = allDecisions.filter((r) => (r.mode ?? MODE.PAPER) === mode);
  const noMode = allDecisions.filter((r) => r.mode === undefined || r.mode === null);
  const batchIds = new Set(decisions.map((d) => d.batchId));
  const outcomes = records.filter((r) => r.kind === KIND.OUTCOME && batchIds.has(r.batchId));
  const s = scoreJournal(file, { mode });

  console.log("=== 1. ROWS, AND WHICH STATISTIC CAN SEE THEM ===");
  const cls = classifyOutcomes(outcomes);
  console.log(`  decision records in this mode   ${decisions.length}   (of ${allDecisions.length} total)`);
  console.log(`  outcome rows attributed         ${outcomes.length}`);
  console.log(`    paired (agent AND control)    ${cls.paired.length}   <- the ONLY rows the edge interval uses`);
  console.log(`    agent only (control null)     ${cls.agentOnly.length}   <- move edge/hitRate; in beatControl's DENOMINATOR only`);
  console.log(`    control only                  ${cls.controlOnly.length}`);
  console.log(`    neither                       ${cls.neither.length}`);
  const orphans = orphanOutcomes(records);
  const dupes = duplicateOutcomes(records);
  console.log(`  orphan rows (no decision)       ${orphans.length}   <- invisible to EVERY statistic`);
  console.log(`  duplicate (batchId,symbol) keys ${dupes.length}   <- counted twice by scoreJournal`);
  for (const d of dupes.slice(0, 5)) console.log(`      ${d.key} x${d.count}`);
  console.log(`  malformed lines                 ${malformed}`);
  if (noMode.length) console.log(`  decisions with NO mode field    ${noMode.length}   <- scored and judged, but settleOutcomes filters them out`);

  console.log("\n=== 2. THE PRINTED READOUT, AND THE NUMBER IT DOES NOT PRINT ===");
  console.log(`  edge          (printed) ${pct(s.edge)}   difference of INDEPENDENTLY FILTERED means`);
  console.log(`  95% CI        (printed) ${s.edgeCI.lo === null ? "—" : `${pct(s.edgeCI.lo)} .. ${pct(s.edgeCI.hi)}`}   drawn over ${s.periods} period(s), PAIRED rows only`);
  console.log(`  edgeCI.mean   (NOT printed) ${pct(s.edgeCI.mean)}   the paired point estimate the interval is around`);
  if (s.edgeCI.lo !== null && Number.isFinite(s.edge)) {
    const outside = s.edge < s.edgeCI.lo || s.edge > s.edgeCI.hi;
    console.log(`  IS THE PRINTED POINT ESTIMATE INSIDE ITS PRINTED INTERVAL?  ${outside ? "NO" : "yes"}`);
  }
  const beatPaired = cls.paired.filter((o) => o.netReturn > o.controlReturn).length;
  console.log(`  beat control  (printed) ${s.beatControlRate === null ? "—" : `${(s.beatControlRate * 100).toFixed(1)}%`}` +
              `   = beats / ALL outcomes (${outcomes.length})`);
  console.log(`  beat control, over PAIRED rows only: ` +
              `${cls.paired.length ? `${(beatPaired / cls.paired.length * 100).toFixed(1)}%` : "—"}   (${beatPaired}/${cls.paired.length})`);
  console.log(`  hitRate       (printed) ${s.hitRate === null ? "—" : `${(s.hitRate * 100).toFixed(1)}%`}` +
              `   = net > 0 over agent rows; COST-DEPENDENT (see POWER-VALIDATION 5g)`);

  console.log("\n=== 3. WHAT COUNTS AS A DECISION, PER CONSUMER ===");
  const sp = splitAllowed(decisions);
  console.log(`  measurable (action != hold AND targetPct > 0)  ${sp.measurable}   <- control, settle, criterion 7 'due'`);
  console.log(`  closing    (action != hold AND targetPct == 0) ${sp.closing}   <- scoreJournal 'sized', criteria 6 and 8 ONLY`);
  console.log(`  hold                                          ${sp.hold}   <- no row, no cost, no control, anywhere`);
  console.log(`  scoreJournal.decisions (its 'sized')          ${s.decisions}   gates meetsStandingMinimum (>= 50)`);
  console.log(`  meetsStandingMinimum                          ${s.meetsStandingMinimum}   spanDays ${s.spanDays}`);
  if (sp.closing) {
    console.log(`  NOTE: ${sp.closing} closing row(s) count toward the standing minimum and can never be settled.`);
  }

  console.log("\n=== 4. HOLDING-PERIOD CLUSTERS ===");
  const ov = adjacentClusterOverlap(decisions, s.holdDays);
  console.log(`  distinct entry sessions ${ov.entries ?? 0}, hold ${ov.holdDays}, clusters ${s.periods}`);
  console.log(`  sessions ADJACENT clusters share, at daily entries: ${ov.sharedSessions} of ${ov.holdDays}`);
  console.log("  Clustering removes overlap WITHIN a cluster, not BETWEEN adjacent ones. A tilt that");
  console.log("  persists across a shared window moves both clusters, so the interval is optimistic in");
  console.log("  that case. Structural, reported, not corrected here.");
  const holds = [...new Set(outcomes.map((o) => o.holdDays).filter(Number.isFinite))];
  if (holds.length > 1) {
    console.log(`  MIXED holdDays present: ${holds.join(", ")}. holdDaysOf takes the MAX (${s.holdDays}) — fewest`);
    console.log("  periods, widest interval, i.e. conservative. Re-settling at a new hold writes nothing.");
  }

  console.log("\n=== 5. THE STOPPING CRITERION ON SETTLEMENT ===");
  const t = tier1(file, { mode });
  const c7 = t.criteria.find((c) => c.n === 7);
  if (c7) {
    console.log(`  criterion 7: ${c7.status.toUpperCase()}  stops=${c7.stops}  ${JSON.stringify(c7.numbers)}`);
    console.log("  Its `due` test is CALENDAR days from the WRITE timestamp (protocol.mjs:156,");
    console.log("  `Date.parse(d.at)`), while settlement needs that many TRADING SESSIONS. The same file");
    console.log("  imports `decisionTimeMs` and uses it for criterion 1. Across a weekend the two");
    console.log("  disagree and this criterion can read FAIL while settle is behaving correctly.");
    const latest = decisions.map(decisionTimeMs).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (Number.isFinite(latest)) {
      console.log(`  latest decision bar: ${new Date(latest).toISOString().slice(0, 10)}`);
    }
  }

  console.log("\nREAD THIS AS COMPLETENESS, NOT PERFORMANCE. Nothing above is evidence about edge, and a");
  console.log("number from a dry-run or synthetic journal is not prospective evidence of anything.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
