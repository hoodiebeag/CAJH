#!/usr/bin/env node
/**
 * rehearsal.mjs — a synthetic dry rehearsal of the first forward run, boundary by boundary.
 *
 * WHAT THIS IS. An offline walk from input preflight through context, risk, record, settle, score and
 * the protocol readout, on a hand-built panel of midnight-stamped daily bars, with a STUB decider and
 * a TEMPORARY journal. At each boundary it prints what the code does TODAY beside the acceptance
 * contract from `docs/REMEDIATION-PLAN.md`, so the gap is a printed line rather than an argument.
 *
 * WHAT IT IS NOT, STATED PLAINLY:
 *   - It does NOT launch `analyst-run.mjs`. No CLI argument handling, no journal lock, no mode
 *     dispatch is exercised, and nothing here should be read as evidence that they work.
 *   - It constructs NO model client. The decider is a plain object whose `messages.create` returns a
 *     fixed string. No SDK is imported anywhere in this file's import graph, and no key is read.
 *   - It touches NO broker path and places no order of any kind.
 *   - It writes ONLY to a fresh temporary directory. The real journal is fingerprinted before and
 *     after and the result is printed.
 *   - It FIXES NOTHING. No runtime module is patched, monkeypatched or shadowed. Every failure below
 *     is the current behaviour, and no forward evidence is produced — these are synthetic decisions
 *     in paper MODE on a synthetic panel, which is not a track record and cannot become one.
 *
 * Usage: node rehearsal.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildContext, contextIsPointInTime } from "./analyst/context.mjs";
import {
  runOnce, settleOutcomes, instrumentsFromContext, missedSessions, sessionWeekdays,
} from "./analyst/loop.mjs";
import { applyRiskGate, DEFAULT_LIMITS } from "./analyst/risk.mjs";
import { readJournal, scoreJournal, matchedRandomControl, KIND, MODE, DEFAULT_JOURNAL } from "./analyst/journal.mjs";
import { tier1 } from "./analyst/protocol.mjs";
import {
  validateTimestamps, reconcileSessions, symbolFreshness, freshnessInformation, duenessByCalendar,
  NYSE_2026_2028,
} from "./panel-freshness.mjs";
import { classifyOutcomes, splitAllowed, sessionCoverage, calendarAccounting } from "./journal-completeness.mjs";

const DAY = 86400;
const THESIS = "momentum and breadth both confirm here";
/** Published closures across the grounded years, so the synthetic panel omits them as a real one does. */
const CLOSED = new Set(Object.values(NYSE_2026_2028.years).flatMap((y) => y.closed)
  .map((d) => Date.parse(`${d}T00:00:00Z`) / 1000));
const e = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const d10 = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
const tmpJournal = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-")), "j.jsonl");
const fingerprint = () => (fs.existsSync(DEFAULT_JOURNAL)
  ? crypto.createHash("sha256").update(fs.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");

const mark = (ok) => (ok ? "  OK " : "FAIL ");
const line = (label, today, contract, ok) => {
  console.log(`  ${mark(ok)} ${label}`);
  console.log(`         today:    ${today}`);
  console.log(`         contract: ${contract}`);
};

/** A stub decider. A plain object, no SDK, no key, no network. */
const stubDecider = (decisions) => ({
  messages: {
    create: async () => ({
      id: "msg_stub", container: null, role: "assistant", type: "message",
      model: "stub-no-model-was-called",
      content: [{ type: "text", text: JSON.stringify({ decisions }), citations: null }],
      stop_reason: "end_turn", stop_sequence: null, stop_details: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  },
});
const buy = (symbol) => ({ symbol, action: "buy", targetPct: 0.05, confidence: 0.7, thesis: THESIS });

/**
 * Sessions ending at `endISO`, stamped at UTC MIDNIGHT — the real bundle's convention (verified: 0 of
 * 921 bar dates misaligned). The test panel in analyst/loop.test.mjs stamps its last bar at `now`
 * instead, which is why the suite does not see boundary 3 below.
 *
 * PUBLISHED CLOSURES ARE OMITTED where the calendar is grounded, so the panel looks like a real one.
 * A first draft used every weekday and therefore carried bars on eight 2026 closures — a fixture
 * artifact that showed up as `observed > expected`. The adversary case is run separately below.
 */
const sessions = (endISO, n) => {
  const out = [];
  for (let t = e(endISO); out.length < n; t -= DAY) {
    const w = new Date(t * 1000).getUTCDay();
    if (w === 0 || w === 6) continue;
    if (CLOSED.has(t)) continue;
    out.unshift(t);
  }
  return out;
};
const ramp = (ts, start, step) => ts.map((t, i) => ({ time: t, open: start * (1 + step) ** i,
  high: start * (1 + step) ** i * 1.01, low: start * (1 + step) ** i * 0.99,
  close: start * (1 + step) ** i, volume: 2e6 }));

async function main() {
  const before = fingerprint();
  console.log("FIRST-FORWARD-RUN REHEARSAL — synthetic, offline, no CLI, no model, no broker\n");
  console.log(`real journal ${DEFAULT_JOURNAL}`);
  console.log(`  fingerprint before: ${before}\n`);

  // The panel: last completed session Thursday 2026-10-01, the run on Friday 2026-10-02.
  const DATES = sessions("2026-10-01", 300);
  const ASOF = DATES.length - 1;
  const ASOF_TIME = DATES[ASOF];
  const ASOF_TIME_PRE = ASOF_TIME;
  const NOW = Date.parse("2026-10-02T13:45:00Z");
  const SERIES = {
    FRESH: ramp(DATES, 100, 0.002),
    ALSO: ramp(DATES, 140, 0.0015),
    STALE: ramp(DATES.slice(0, 281), 40, 0.001),         // last bar 19 sessions before the decision
    ABSENT: ramp(DATES.slice(0, 3), 25, 0.001),          // effectively no history at the decision
  };
  const SECTORS = { FRESH: "Tech", ALSO: "Health", STALE: "Energy", ABSENT: "Utilities" };
  console.log(`panel: ${Object.keys(SERIES).length} symbols, ${DATES.length} sessions, `
            + `last bar ${d10(ASOF_TIME)}, run at ${new Date(NOW).toISOString()}\n`);

  // ---- boundary 1: input preflight -------------------------------------------------------------
  console.log("=== 1. INPUT PREFLIGHT (no runtime check exists for this today) ===");
  const grid = validateTimestamps(DATES, "grid");
  line("grid shape", `clean=${grid.clean}; nothing in the runtime validates this (B5)`,
    "report sortedness, duplicates and UTC-midnight alignment at run start", grid.clean);
  const rec = reconcileSessions({ observed: DATES.filter((t) => t >= e("2026-01-01")) });
  line("session coverage vs published calendar",
    rec.supported ? `expected ${rec.expected}, observed ${rec.observed}, missing ${rec.missingExpected.length}, `
                  + `on a closure ${rec.presentButClosed.length}`
                  : `UNSUPPORTED: ${rec.reason.slice(0, 48)}`,
    "expected sessions sourced where grounded; UNKNOWN, counted, outside coverage",
    rec.supported && rec.missingExpected.length === 0 && rec.presentButClosed.length === 0);
  // The two adversaries, run on copies so the rehearsal panel stays realistic.
  const withGap = DATES.filter((t) => t >= e("2026-01-01") && t !== DATES.at(-40));
  const gapRec = reconcileSessions({ observed: withGap, from: e("2026-01-02"), to: ASOF_TIME_PRE });
  const onClosure = reconcileSessions({ observed: [...DATES.filter((t) => t >= e("2026-01-01")), e("2026-07-03")] });
  console.log(`         adversary, one session missing for EVERY symbol: missingExpected=`
    + `${gapRec.missingExpected.length} ${gapRec.missingExpected.join(" ")} (stays visible, never dropped)`);
  console.log(`         adversary, a bar on a published closure: presentButClosed=`
    + `${onClosure.presentButClosed.length} ${onClosure.presentButClosed.join(" ")}`);
  const fr = symbolFreshness({ series: SERIES, dates: DATES, asOf: ASOF, now: NOW });
  const staleRows = fr.symbols.filter((s) => s.sessionsSinceLastBar > 0);
  line("per-symbol freshness", `${staleRows.length} symbol(s) have no bar AT the decision session: `
    + staleRows.map((s) => `${s.symbol}(${s.sessionsSinceLastBar})`).join(" "),
    "the same figure, consulted by the gate", false);

  // ---- boundary 2: context ---------------------------------------------------------------------
  console.log("\n=== 2. CONTEXT ===");
  const ctx = buildContext({ series: SERIES, dates: DATES, asOf: ASOF, sectors: SECTORS, slate: 300 });
  const shown = ctx.candidates.map((c) => c.symbol);
  line("point-in-time check", `${contextIsPointInTime(ctx, ASOF_TIME).length} issue(s) — it verifies the `
    + "asOf label and news dates only (§9.2)",
    "unchanged, with its scope stated in the readout (C5)", contextIsPointInTime(ctx, ASOF_TIME).length === 0);
  line("who reaches the slate", `${ctx.universe.total} in universe, shown: ${shown.join(" ")}`,
    "a symbol with no bar at the decision session is excluded or flagged", !shown.includes("STALE"));
  const paperGuard = missedSessions(ASOF_TIME, NOW, sessionWeekdays(DATES));
  line("paper staleness guard", `missedSessions=${paperGuard} (${paperGuard === 0 ? "PROCEEDS" : "REFUSES"})`,
    "a published closure must not count as a missed session (A2)", paperGuard === 0);

  // ---- boundary 3: risk gate -------------------------------------------------------------------
  console.log("\n=== 3. RISK GATE — the first-forward-run blocker ===");
  const refPaper = NOW;                                   // analyst/loop.mjs:231 for MODE.PAPER
  const inst = instrumentsFromContext(ctx, SERIES, ASOF_TIME, refPaper);
  const proposals = shown.slice(0, 2).map(buy);
  const gated = applyRiskGate(proposals,
    { nav: 1e5, peakNav: 1e5, dayStartNav: 1e5, positions: {}, shortingPermitted: false }, inst);
  const anyQa = inst[shown[0]]?.quoteAgeMs;
  line("quote age on a daily panel",
    `${(anyQa / 3600000).toFixed(1)}h for EVERY symbol, against a ${DEFAULT_LIMITS.maxQuoteAgeMs / 60000}min limit`,
    "the 15-minute limit applies to an actual quote observation, which a daily panel does not carry",
    anyQa <= DEFAULT_LIMITS.maxQuoteAgeMs);
  line("gate outcome for FRESH symbols",
    `allowed ${gated.allowed.length}/${proposals.length}; rejected: `
    + (gated.rejected.map((r) => r.code).join(",") || "none"),
    "a symbol with a bar at the decision session is allowed; one without is rejected",
    gated.allowed.length === proposals.length);
  const fi = freshnessInformation({ series: SERIES, dates: DATES, asOf: ASOF, now: NOW });
  const byS = Object.fromEntries(fi.symbols.map((s) => [s.symbol, s]));
  console.log(`         evidence available instead: FRESH sessionsSinceLastBar=${byS.FRESH.sessionsSinceLastBar}, `
    + `STALE=${byS.STALE.sessionsSinceLastBar}, quoteAgeMs=${byS.FRESH.quoteAgeMs} (unavailable by construction)`);

  // ---- boundary 4: record ----------------------------------------------------------------------
  console.log("\n=== 4. RECORD — via runOnce with a STUB decider and a TEMP journal ===");
  const J = tmpJournal();
  const r1 = await runOnce({
    series: SERIES, dates: DATES, asOf: ASOF, client: stubDecider(shown.slice(0, 2).map(buy)),
    mode: MODE.PAPER, now: NOW, nav: 1e5, journalFile: J, slate: 300, sectors: SECTORS,
  });
  line("a batch reaches the journal", `skipped=${JSON.stringify(r1.skipped)}, `
    + `allowed=${r1.gate?.allowed.length ?? "-"}, control=${r1.record?.control?.length ?? "-"}`,
    "a clean batch journals a non-empty book with one control per sized decision",
    (r1.gate?.allowed.length ?? 0) > 0);
  // A no-decision batch, and a retry on the same session.
  const r2 = await runOnce({
    series: SERIES, dates: DATES, asOf: ASOF, client: stubDecider([]), mode: MODE.PAPER,
    now: NOW, nav: 1e5, journalFile: J, slate: 300, sectors: SECTORS,
  });
  const decisions = readJournal(J).records.filter((x) => x.kind === KIND.DECISION);
  const cov = sessionCoverage(decisions);
  line("retry on the same session", `${cov.batchRecords} decision records, ${cov.distinctSessions} session, `
    + `${cov.distinctBatchIds} batchId(s); repeated: ${cov.repeatedBatchIds.length}`,
    "a rerun is refused or marked superseding; two DISTINCT batches stay one period (B1)",
    cov.repeatedBatchIds.length === 0);
  line("a batch with no decisions", `journalled: ${r2.record?.kind ?? "none"}, `
    + `allowed=${r2.gate?.allowed.length ?? "-"}`,
    "recorded so an empty batch is distinguishable from a run that never fired", !!r2.record);

  // A control slot deliberately short, to reach the missing-control path.
  const shortPool = matchedRandomControl(shown.slice(0, 2).map(buy), [shown[0]], 1);
  line("control slots when the pool is short", `${shortPool.length} slot(s) for 2 sized decisions; `
    + "the TAIL goes unpaired, positionally (§8.5)",
    "unpaired rows reported and the paired count printed (A4)", false);

  // ---- boundary 5: settle ----------------------------------------------------------------------
  console.log("\n=== 5. SETTLE ===");
  const settled = settleOutcomes({ series: SERIES, dates: DATES, journalFile: J, mode: MODE.PAPER,
    holdDays: 5, costPerLeg: 0.00055, now: Date.parse("2026-10-30T00:00:00Z") });
  line("settlement after the hold", JSON.stringify(settled),
    "`pending` split into inside-the-hold, no-coverage and bad-bars (C4)", settled.wrote >= 0);
  const outs = readJournal(J).records.filter((x) => x.kind === KIND.OUTCOME);
  const cls = classifyOutcomes(outs);
  line("paired vs agent-only rows", `${outs.length} row(s): paired ${cls.paired.length}, `
    + `agent-only ${cls.agentOnly.length}`,
    "the paired count is printed beside the trade count (A4)", cls.agentOnly.length === 0);

  // ---- boundary 6: score -----------------------------------------------------------------------
  console.log("\n=== 6. SCORE ===");
  const s = scoreJournal(J);
  const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—");
  const outside = s.edgeCI.lo !== null && Number.isFinite(s.edge)
    && (s.edge < s.edgeCI.lo || s.edge > s.edgeCI.hi);
  line("the headline edge", `edge ${pct(s.edge)}, CI ${s.edgeCI.lo === null ? "—"
    : `${pct(s.edgeCI.lo)}..${pct(s.edgeCI.hi)}`}, paired mean ${pct(s.edgeCI.mean)} (never printed)`,
    "the paired estimate is printed beside its own interval (A4)", !outside);
  const sp = splitAllowed(decisions);
  line("what `sized` counts", `measurable ${sp.measurable}, closing ${sp.closing}, hold ${sp.hold}; `
    + `scoreJournal.decisions=${s.decisions}`,
    "`sized` counts what can be measured, per the standing-minimum reading (P1)",
    s.decisions === sp.measurable);

  // ---- boundary 7: protocol --------------------------------------------------------------------
  console.log("\n=== 7. PROTOCOL READOUT ===");
  const AT_MONDAY = Date.parse("2026-10-05T14:00:00Z");              // the next Monday
  const dueContract = duenessByCalendar({ decisionBar: ASOF_TIME, now: AT_MONDAY, holdSessions: 5 });
  const dueByContract = dueContract.due ? 1 : 0;
  const t = tier1(J, { now: AT_MONDAY });
  for (const n of [1, 2, 7]) {
    const c = t.criteria.find((x) => x.n === n);
    if (!c) continue;
    const contract = n === 1 ? "distinct sessions, with published closures subtracted (C1, C2)"
      : n === 2 ? "unchanged, with its scope stated (C5)"
      : "dueness from expected sessions; coverage failures stay visible (A1)";
    // Judged against the CONTRACT, not merely against its own status. Criterion 1 reporting ratio 2
    // from a single session is a contract violation even though it reads PASS.
    const ok = n === 1 ? (c.numbers.ratio !== null && c.numbers.ratio <= 1)
      : n === 7 ? (c.status !== "fail" && c.numbers.due === dueByContract)
      : c.status !== "fail";
    line(`criterion ${n}${c.stops ? " (STOPS)" : ""}`, `${c.status.toUpperCase()} ${JSON.stringify(c.numbers)}`,
      contract, ok);
  }
  console.log(`         for comparison, expected-session dueness: due=${dueContract.due}, `
    + `elapsed=${dueContract.elapsedSessions}/${dueContract.holdSessions}`);

  // ---- weekend / holiday boundaries ------------------------------------------------------------
  console.log("\n=== 8. CALENDAR BOUNDARIES ===");
  const friBar = e("2026-01-16");                          // Friday before a published closure
  const tueOpen = Date.parse("2026-01-20T13:45:00Z");      // Monday 2026-01-19 is closed
  const wk = sessionWeekdays(DATES);
  line("the session after a published closure",
    `missedSessions=${missedSessions(friBar, tueOpen, wk)} → paper mode REFUSES`,
    "a published closure is not a missed session (A2)", missedSessions(friBar, tueOpen, wk) === 0);
  const acc = calendarAccounting({ panelDates: DATES.filter((x) => x >= e("2026-01-01")),
    decisions, skips: [], holdDays: 5 });
  console.log(`  expected market sessions: ${acc.expectedMarketSessions ?? "UNKNOWN (no calendar in the runtime)"}`);
  console.log(`  observed ${acc.observedPanelSessions}, attempts ${acc.operationalAttempts}, `
    + `successes ${acc.successfulDecisions}, periods ${acc.statisticalPeriods}`);

  // ---- safety ----------------------------------------------------------------------------------
  const after = fingerprint();
  console.log("\n=== 9. SAFETY ===");
  console.log(`  real journal fingerprint after: ${after}`);
  console.log(`  unchanged: ${before === after}`);
  console.log(`  temp journal used: ${J}`);
  console.log("  no CLI launched, no model client constructed, no key read, no broker path touched.");
  console.log("  NOTHING WAS FIXED: every FAIL above is current behaviour, and these synthetic paper-mode");
  console.log("  decisions are not forward evidence and cannot become a track record.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
