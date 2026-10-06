#!/usr/bin/env node
/**
 * panel-freshness.mjs — per-symbol freshness and grid validation, REPORTED and never repaired.
 *
 * WHY. docs/JOURNAL-COMPLETENESS.md §9.4 found that a symbol dead for 200 sessions is shown to the
 * analyst with a finite momentum, receives a `quoteAgeMs` identical to a live name, and passes the risk
 * gate at a price forward-filled from its last real bar. Point-in-time held throughout; FRESHNESS is a
 * different property and nothing computes it. §9.3 found that an unsorted grid, a duplicate timestamp
 * and a per-symbol series out of time order are all accepted silently. This computes both.
 *
 * REPORT ONLY. Nothing here sorts, de-duplicates, repairs, drops or imputes. A bad shape is named and
 * returned; the caller decides. No runtime eligibility, gate, scoring, settlement, calendar, risk,
 * sizing or cost behaviour is altered by this file, and it is not wired into any of them.
 *
 * THREE DISTINCTIONS KEPT STRICTLY APART:
 *
 *   expected sessions   what the exchange published. Known for 2026 only (see NYSE_2026) and UNKNOWN
 *                       otherwise. Never inferred from the panel.
 *   observed sessions   the union of bar dates. A session missing for every symbol is simply absent
 *                       from it, which is why it cannot stand in for the expected set.
 *   observed quote      a bar that actually exists for that symbol at that session. A forward-filled
 *                       grid value is NOT one, and `forwardFilledAtDecision` says so per symbol.
 *
 * Usage: node panel-freshness.mjs [--root sp500-bundle] [--asOf N]
 */

/**
 * NYSE scheduled closures and early closes for 2026.
 *
 * SOURCE: the primary NYSE "Holidays & Trading Hours" page, https://www.nyse.com/markets/hours-calendars
 * RETRIEVED: 2026-10-06, by independent research outside this session (this session's own egress policy
 * blocks nyse.com; see §9.6). COVERAGE: 2026 ONLY. The page's text also covers 2027 and 2028, but those
 * years were not transcribed here and are therefore UNKNOWN to this module rather than extrapolated.
 *
 * WHAT THIS IS AND IS NOT. These are the exchange's PUBLISHED SCHEDULED sessions. They are not a record
 * of what actually happened: an exceptional closure — weather, a national day of mourning, a systems
 * outage — arrives as a separate exchange notice and is NOT represented here. So a weekday absent from a
 * panel and absent from this list is still UNKNOWN: it may be an unpublished exceptional closure or a
 * gap in the data. This module reports that case; it does not resolve it.
 *
 * An early close is a SHORTER SESSION, not a closure: a bar exists for it. Recorded so that a future
 * intraday diagnostic does not read a short session as a missing one.
 */
export const NYSE_2026 = Object.freeze({
  source: "https://www.nyse.com/markets/hours-calendars",
  retrieved: "2026-10-06",
  coverage: "2026 only",
  basis: "published scheduled sessions; exceptional exchange notices are NOT included",
  regularSession: "09:30-16:00 America/New_York",
  closed: Object.freeze([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  ]),
  earlyClose: Object.freeze([
    { date: "2026-11-27", closes: "13:00 America/New_York" },
    { date: "2026-12-24", closes: "13:00 America/New_York" },
  ]),
});

const DAY = 86400;
const dayStart = (secs) => Math.floor(secs / DAY) * DAY;
const iso = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
const epoch = (isoDate) => Date.parse(`${isoDate}T00:00:00Z`) / 1000;
const COVERED_FROM = epoch("2026-01-01");
const COVERED_TO = epoch("2026-12-31");

/**
 * The sessions the exchange published for a window, or an explicit refusal outside coverage.
 *
 * REFUSES RATHER THAN GUESSING. Outside 2026 this returns `{ supported: false }` with the reason, so a
 * caller cannot accidentally treat a weekday count as an expected-session count.
 */
export function expectedSessions({ from, to, calendar = NYSE_2026 } = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new Error("panel-freshness: expectedSessions needs a finite from <= to (epoch seconds)");
  }
  if (from < COVERED_FROM || to > COVERED_TO) {
    return {
      supported: false,
      reason: `calendar coverage is ${calendar.coverage} (${iso(COVERED_FROM)}..${iso(COVERED_TO)}); `
            + `the window ${iso(from)}..${iso(to)} falls outside it, and no other year is grounded`,
      sessions: null,
    };
  }
  const closed = new Set(calendar.closed.map(epoch));
  const sessions = [];
  for (let t = dayStart(from); t <= dayStart(to); t += DAY) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (closed.has(t)) continue;
    sessions.push(t);
  }
  return { supported: true, sessions, closedInWindow: [...closed].filter((t) => t >= dayStart(from) && t <= dayStart(to)).sort() };
}

/**
 * Observed panel sessions against published expected ones.
 *
 * A MISSING EXPECTED SESSION STAYS VISIBLE. It is returned in `missingExpected`, never dropped and
 * never reinterpreted as "not a session". Outside calendar coverage the comparison refuses and the
 * no-bar weekdays are returned as `unknownNoBar` instead — counted, unresolved.
 */
export function reconcileSessions({ observed = [], from = null, to = null, calendar = NYSE_2026 } = {}) {
  const obs = new Set(observed.map(dayStart));
  const lo = from ?? (obs.size ? Math.min(...obs) : null);
  const hi = to ?? (obs.size ? Math.max(...obs) : null);
  if (lo === null) return { supported: false, reason: "no observed sessions", observed: 0 };

  const exp = expectedSessions({ from: lo, to: hi, calendar });
  if (!exp.supported) {
    const unknownNoBar = [];
    for (let t = dayStart(lo); t <= dayStart(hi); t += DAY) {
      const dow = new Date(t * 1000).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (!obs.has(t)) unknownNoBar.push(iso(t));
    }
    return { supported: false, reason: exp.reason, observed: obs.size, unknownNoBar };
  }
  const expSet = new Set(exp.sessions);
  return {
    supported: true,
    window: { from: iso(lo), to: iso(hi) },
    expected: exp.sessions.length,
    observed: obs.size,
    publishedClosuresInWindow: exp.closedInWindow.length,
    // An expected session with no bar for ANY symbol: a data gap, or an exceptional closure the
    // published schedule does not carry. Either way it stays here.
    missingExpected: exp.sessions.filter((t) => !obs.has(t)).map(iso),
    // A bar on a day the exchange published as closed: the panel disagrees with the schedule.
    presentButClosed: [...obs].filter((t) => !expSet.has(t)
      && new Date(t * 1000).getUTCDay() !== 0 && new Date(t * 1000).getUTCDay() !== 6).map(iso).sort(),
    calendar: { source: calendar.source, retrieved: calendar.retrieved, coverage: calendar.coverage, basis: calendar.basis },
  };
}

/**
 * Shape problems in a timestamp list. REPORTED, NOT FIXED.
 *
 * `notUtcMidnight` is the date-boundary check that matters: the real bundle stamps every bar at
 * 00:00:00Z of the session date (verified: 0 of 921 bar dates misaligned), so a session's calendar date
 * is unambiguous. A bar stamped intraday would make its date depend on the timezone used to read it,
 * which is where an early close or a DST transition turns into an off-by-one day. Flagged rather than
 * normalised, because normalising would pick a timezone on the caller's behalf.
 */
export function validateTimestamps(list, label = "grid") {
  const bad = { label, count: Array.isArray(list) ? list.length : 0,
    nonFinite: [], notInteger: [], notUtcMidnight: [], outOfOrder: [], duplicates: [] };
  if (!Array.isArray(list)) return { ...bad, notAnArray: true };
  const seen = new Map();
  for (let i = 0; i < list.length; i++) {
    const t = Number(list[i]);
    if (!Number.isFinite(t)) { bad.nonFinite.push(i); continue; }
    if (!Number.isInteger(t)) bad.notInteger.push(i);
    if (t % DAY !== 0) bad.notUtcMidnight.push({ at: i, value: t, asIso: new Date(t * 1000).toISOString() });
    if (i > 0 && Number(list[i - 1]) >= t) bad.outOfOrder.push({ at: i, previous: Number(list[i - 1]), value: t });
    seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  bad.duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([t, n]) => ({ value: t, asIso: iso(t), count: n }));
  bad.clean = !bad.nonFinite.length && !bad.notInteger.length && !bad.notUtcMidnight.length
           && !bad.outOfOrder.length && !bad.duplicates.length;
  return bad;
}

/**
 * Per-symbol freshness at a decision index.
 *
 * `sessionsSinceLastBar` is counted on the OBSERVED grid, and is labelled that way everywhere: it is
 * not an expected-session count and does not become one. `forwardFilledAtDecision` is the field §9.4
 * showed nothing computes — true when the symbol has no bar AT the decision session, so whatever price
 * the context carries for it is a held-flat value and not a quote anyone could have traded.
 */
export function symbolFreshness({ series = {}, dates = [], asOf = null, now = null } = {}) {
  if (!Array.isArray(dates) || !dates.length) throw new Error("panel-freshness: dates required");
  const idx = Number.isInteger(asOf) ? asOf : dates.length - 1;
  if (idx < 0 || idx >= dates.length) throw new Error(`panel-freshness: asOf ${asOf} is outside the grid`);
  const asOfTime = dayStart(Number(dates[idx]));
  const gridUpTo = dates.slice(0, idx + 1).map((t) => dayStart(Number(t)));
  const gridSet = new Set(gridUpTo);
  const rankOf = new Map(gridUpTo.map((t, i) => [t, i]));

  const rows = [];
  for (const [sym, bars] of Object.entries(series)) {
    const shape = validateTimestamps((bars ?? []).map((b) => Number(b.time)), sym);
    // At or before the decision, by TIME and not by position, so an out-of-order series is measured
    // rather than truncated the way buildContext's break would.
    const atOrBefore = (bars ?? []).map((b) => dayStart(Number(b.time))).filter((t) => Number.isFinite(t) && t <= asOfTime);
    const onGrid = atOrBefore.filter((t) => gridSet.has(t));
    const offGrid = [...new Set(atOrBefore.filter((t) => !gridSet.has(t)))].map(iso);
    const last = onGrid.length ? Math.max(...onGrid) : null;
    const first = onGrid.length ? Math.min(...onGrid) : null;
    const present = new Set(onGrid);
    const sessionsSince = last === null ? null : (rankOf.get(asOfTime) - rankOf.get(last));
    const lateStart = first === null ? null : rankOf.get(first);
    const interiorMissing = first === null ? null
      : gridUpTo.filter((t) => t >= first && t <= last && !present.has(t)).length;
    const afterDecision = (bars ?? []).map((b) => dayStart(Number(b.time))).filter((t) => t > asOfTime).length;
    rows.push({
      symbol: sym,
      lastBarAtOrBefore: last === null ? null : iso(last),
      sessionsSinceLastBar: sessionsSince,            // on the OBSERVED grid
      wallClockAgeMs: last === null || now === null ? null : Math.max(0, now - last * 1000),
      // THE DISTINCTION §9.4 TURNS ON: a grid price exists for every symbol; a QUOTE does not.
      forwardFilledAtDecision: last === null ? null : last !== asOfTime,
      barsOnGrid: onGrid.length,
      gridSessions: gridUpTo.length,
      lateStartSessions: lateStart,                   // grid sessions before this symbol's first bar
      interiorMissingSessions: interiorMissing,
      earlyEnd: sessionsSince !== null && sessionsSince > 0,
      barsAfterDecision: afterDecision,               // present in the input; excluded from every count above
      offGridDates: offGrid,                          // bar dates the grid does not contain at all
      shape: shape.clean ? null : shape,              // ordering/duplicate/alignment problems, unrepaired
    });
  }
  rows.sort((a, b) => (b.sessionsSinceLastBar ?? -1) - (a.sessionsSinceLastBar ?? -1));
  return { asOf: iso(asOfTime), gridSessions: gridUpTo.length, symbols: rows };
}

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};

async function main() {
  const root = flag("root", "sp500-bundle");
  const { loadGrids } = await import("./slate-null.mjs");
  const { kept, barDates } = loadGrids(root);
  const asOfArg = flag("asOf", null);
  const asOf = asOfArg === null ? barDates.length - 1 : Number(asOfArg);

  console.log("PANEL FRESHNESS AND GRID VALIDATION — reported, never repaired");
  console.log(`root ${root}, ${Object.keys(kept).length} symbols, ${barDates.length} observed sessions\n`);

  console.log("=== 1. GRID SHAPE ===");
  const g = validateTimestamps(barDates, "grid");
  console.log(`  clean: ${g.clean}`);
  for (const k of ["nonFinite", "notInteger", "notUtcMidnight", "outOfOrder", "duplicates"]) {
    if (g[k].length) console.log(`  ${k}: ${g[k].length}  ${JSON.stringify(g[k].slice(0, 3))}`);
  }
  console.log("  Nothing was sorted, de-duplicated or dropped. A problem here is a finding, not an input"
            + "\n  to be cleaned up before measuring.\n");

  console.log("=== 2. OBSERVED SESSIONS vs PUBLISHED EXPECTED SESSIONS ===");
  const r = reconcileSessions({ observed: barDates });
  if (!r.supported) {
    console.log(`  UNSUPPORTED: ${r.reason}`);
    console.log(`  observed sessions ${r.observed}, weekdays with no bar: ${r.unknownNoBar?.length ?? "?"} (UNKNOWN, counted)`);
    // Narrow to the covered year so something is still checkable.
    const inYear = barDates.filter((t) => t >= COVERED_FROM && t <= COVERED_TO);
    if (inYear.length) {
      const r2 = reconcileSessions({ observed: inYear });
      console.log(`\n  Narrowed to the grounded window ${r2.window?.from}..${r2.window?.to}:`);
      console.log(`    expected ${r2.expected}, observed ${r2.observed}, published closures ${r2.publishedClosuresInWindow}`);
      console.log(`    expected sessions with NO bar: ${r2.missingExpected.length} ${r2.missingExpected.slice(0, 8).join(" ")}`);
      console.log(`    bars on a published closure:   ${r2.presentButClosed.length} ${r2.presentButClosed.slice(0, 8).join(" ")}`);
      console.log(`    calendar: ${r2.calendar.source} retrieved ${r2.calendar.retrieved}, coverage ${r2.calendar.coverage}`);
      console.log(`    basis: ${r2.calendar.basis}`);
    }
  }
  console.log("\n  Outside the grounded year the expected set is UNKNOWN and is not substituted by a");
  console.log("  weekday count. A missing expected session stays listed; it never leaves the denominator.\n");

  console.log("=== 3. PER-SYMBOL FRESHNESS AT THE DECISION BAR ===");
  const f = symbolFreshness({ series: kept, dates: barDates, asOf, now: Date.now() });
  console.log(`  decision bar ${f.asOf}, ${f.gridSessions} grid sessions up to it`);
  const stale = f.symbols.filter((s) => s.sessionsSinceLastBar > 0);
  const late = f.symbols.filter((s) => s.lateStartSessions > 0);
  const gappy = f.symbols.filter((s) => s.interiorMissingSessions > 0);
  const shaped = f.symbols.filter((s) => s.shape);
  console.log(`  symbols with no bar AT the decision (forward-filled there): ${stale.length}`);
  console.log(`  symbols starting after the grid's first session:            ${late.length}`);
  console.log(`  symbols with interior missing sessions:                     ${gappy.length}`);
  console.log(`  symbols with a timestamp shape problem:                     ${shaped.length}`);
  if (stale.length) {
    console.log("\n  STALEST FIRST (sessions since the symbol's own last bar, on the observed grid):");
    for (const s of stale.slice(0, 10)) {
      console.log(`    ${s.symbol.padEnd(8)} last ${s.lastBarAtOrBefore}  ${String(s.sessionsSinceLastBar).padStart(4)} session(s) stale  `
                + `wall-clock ${(s.wallClockAgeMs / 86400000).toFixed(0)}d  forwardFilledAtDecision=${s.forwardFilledAtDecision}`);
    }
  }
  if (gappy.length) {
    console.log("\n  INTERIOR GAPS (missing sessions strictly inside the symbol's own span):");
    for (const s of gappy.slice(0, 10)) {
      console.log(`    ${s.symbol.padEnd(8)} ${String(s.interiorMissingSessions).padStart(4)} missing of `
                + `${s.gridSessions - (s.lateStartSessions ?? 0)} session(s) in span`);
    }
  }
  console.log("\n  A FORWARD-FILLED GRID VALUE IS NOT A QUOTE. `forwardFilledAtDecision` is the field that");
  console.log("  says so per symbol; the risk gate's quote age is derived from the DECISION BAR and is");
  console.log("  identical for every name (§9.4), so it cannot express this. Reported, not wired in.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
