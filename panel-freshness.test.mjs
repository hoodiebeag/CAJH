/**
 * Per-symbol freshness, grid validation, and the 2026-grounded session reconciliation.
 *
 * Hand-computable fixtures throughout. Every expectation is a count or a date that can be read off
 * the fixture by eye, so a wrong implementation cannot be certified by arithmetic that repeats it.
 *
 * CALENDAR GROUNDING is scoped to 2026 and cited in `NYSE_2026`. No other year is asserted anywhere,
 * and nothing here claims to know about an exceptional (unpublished) exchange closure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  NYSE_2026, NYSE_2026_2028, calendarYears, expectedSessions, reconcileSessions,
  validateTimestamps, symbolFreshness,
} from "./panel-freshness.mjs";

const DAY = 86400;
const e = (isoDate) => Date.parse(`${isoDate}T00:00:00Z`) / 1000;
const iso = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
/** Consecutive weekday timestamps at UTC midnight, the convention the real bundle uses. */
const weekdays = (fromISO, n) => {
  const out = [];
  for (let t = e(fromISO); out.length < n; t += DAY) {
    const w = new Date(t * 1000).getUTCDay();
    if (w !== 0 && w !== 6) out.push(t);
  }
  return out;
};
const bars = (ts, start = 100, step = 0.01) =>
  ts.map((t, i) => ({ time: t, close: start * (1 + step) ** i, volume: 1e6 }));

// ---- the calendar reference ---------------------------------------------------------------------

test("the calendar reference carries its provenance and its limits", () => {
  assert.equal(NYSE_2026.source, "https://www.nyse.com/markets/hours-calendars");
  assert.equal(NYSE_2026.retrieved, "2026-10-06");
  assert.equal(NYSE_2026.coverage, "2026 only");
  assert.match(NYSE_2026.basis, /exceptional exchange notices are NOT included/);
  assert.equal(NYSE_2026.closed.length, 10, "ten published full-day closures for 2026");
  for (const d of NYSE_2026.closed) {
    assert.match(d, /^2026-/, "every closure is inside the grounded year");
    const w = new Date(e(d) * 1000).getUTCDay();
    assert.ok(w !== 0 && w !== 6, `${d} must be a weekday, or it is not a closure of a session`);
  }
  // An EARLY CLOSE IS A SESSION, not a closure, and is listed separately.
  assert.equal(NYSE_2026.earlyClose.length, 2);
  for (const { date } of NYSE_2026.earlyClose) {
    assert.ok(!NYSE_2026.closed.includes(date), `${date} is a short session, not a closed day`);
  }
});

test("expectedSessions REFUSES outside the grounded years instead of guessing", () => {
  const out = expectedSessions({ from: e("2025-01-01"), to: e("2025-12-31") });
  assert.equal(out.supported, false);
  assert.equal(out.sessions, null);
  assert.match(out.reason, /coverage is 2026-2028/);
  // A window straddling the lower boundary is refused rather than partially answered.
  assert.equal(expectedSessions({ from: e("2025-12-30"), to: e("2026-01-05") }).supported, false);
  // And the upper one. 2029 is not grounded, so a window reaching into it refuses whole.
  assert.equal(expectedSessions({ from: e("2028-12-28"), to: e("2029-01-04") }).supported, false);
  assert.equal(expectedSessions({ from: e("2029-01-02"), to: e("2029-01-05") }).supported, false);
  assert.throws(() => expectedSessions({ from: e("2026-02-01"), to: e("2026-01-01") }), /from <= to/);
});

test("expectedSessions removes published closures and keeps early-close sessions", () => {
  // January 2026: Jan 1 (Thu) and Jan 19 (Mon) are published closures.
  const jan = expectedSessions({ from: e("2026-01-01"), to: e("2026-01-31") });
  assert.equal(jan.supported, true);
  const got = jan.sessions.map(iso);
  assert.ok(!got.includes("2026-01-01"), "a published closure is not an expected session");
  assert.ok(!got.includes("2026-01-19"));
  assert.ok(got.includes("2026-01-02"), "the Friday after is");
  assert.ok(got.includes("2026-01-20"));
  // Count by hand: January 2026 has 22 weekdays; two are closed, so 20 sessions.
  let wk = 0;
  for (let t = e("2026-01-01"); t <= e("2026-01-31"); t += DAY) {
    const w = new Date(t * 1000).getUTCDay();
    if (w !== 0 && w !== 6) wk++;
  }
  assert.equal(wk, 22);
  assert.equal(got.length, 20);
  // The two early closes ARE expected sessions.
  const nov = expectedSessions({ from: e("2026-11-20"), to: e("2026-12-31") }).sessions.map(iso);
  assert.ok(nov.includes("2026-11-27"), "an early close is a shorter session, so a bar is expected");
  assert.ok(nov.includes("2026-12-24"));
  assert.ok(!nov.includes("2026-11-26"), "while the closure beside it is not");
  assert.ok(!nov.includes("2026-12-25"));
});

// ---- reconciliation: a missing expected session must stay visible --------------------------------

test("an entirely missing expected session is reported, never dropped", () => {
  // Every 2026 February session except one, which is absent for EVERY symbol.
  const all = expectedSessions({ from: e("2026-02-02"), to: e("2026-02-27") }).sessions;
  const dropped = all[7];
  const observed = all.filter((t) => t !== dropped);
  const r = reconcileSessions({ observed });
  assert.equal(r.supported, true);
  assert.equal(r.observed, all.length - 1);
  assert.equal(r.expected, all.length, "the expected count does NOT shrink to match what was observed");
  assert.deepEqual(r.missingExpected, [iso(dropped)], "and the gap is named");
  assert.deepEqual(r.presentButClosed, []);
});

test("a bar on a published closure is reported as the panel disagreeing with the schedule", () => {
  const all = expectedSessions({ from: e("2026-02-02"), to: e("2026-02-27") }).sessions;
  const observed = [...all, e("2026-02-16")];                 // Feb 16 is a published closure
  const r = reconcileSessions({ observed });
  assert.deepEqual(r.presentButClosed, ["2026-02-16"]);
  assert.deepEqual(r.missingExpected, []);
  assert.equal(r.publishedClosuresInWindow, 1);
});

test("outside the grounded years the comparison refuses and counts no-bar weekdays as UNKNOWN", () => {
  // 2025: no calendar. A weekday with no bar cannot be called a holiday OR an outage.
  const ts = weekdays("2025-03-03", 10);
  const observed = ts.filter((_, i) => i !== 4);
  const r = reconcileSessions({ observed });
  assert.equal(r.supported, false);
  assert.match(r.reason, /coverage is 2026-2028/);
  assert.equal(r.observed, 9);
  assert.deepEqual(r.unknownNoBar, [iso(ts[4])], "counted and listed, not resolved either way");
  assert.equal(r.expected, undefined, "and no expected count is invented");
});

// ---- grid validation: reported, never repaired ---------------------------------------------------

test("validateTimestamps names disorder, duplicates and misalignment without fixing them", () => {
  const good = weekdays("2026-04-06", 10);
  assert.equal(validateTimestamps(good).clean, true);

  const unsorted = [...good];
  [unsorted[3], unsorted[4]] = [unsorted[4], unsorted[3]];
  const u = validateTimestamps(unsorted);
  assert.equal(u.clean, false);
  assert.equal(u.outOfOrder.length, 1);
  assert.equal(u.outOfOrder[0].at, 4);
  // The input is returned untouched: the function reports, the caller decides.
  assert.deepEqual(unsorted[3], good[4], "nothing was sorted");

  const dup = [...good]; dup[5] = dup[4];
  const d = validateTimestamps(dup);
  assert.equal(d.duplicates.length, 1);
  assert.equal(d.duplicates[0].count, 2);
  assert.equal(d.outOfOrder.length, 1, "a repeat is also a non-increase, and both are reported");

  const junk = validateTimestamps([good[0], NaN, "x", 1.5, good[1]]);
  assert.equal(junk.nonFinite.length, 2, "NaN and a non-numeric string");
  assert.equal(junk.notInteger.length, 1);
  assert.equal(validateTimestamps("not an array").notAnArray, true);
});

test("a timestamp not at UTC midnight is flagged, because its session DATE becomes ambiguous", () => {
  // Grounded in the real bundle's convention: every one of its 921 bar dates is at 00:00:00Z, so a
  // session's calendar date is unambiguous. An intraday stamp is not.
  const clean = validateTimestamps(weekdays("2026-11-23", 5));
  assert.equal(clean.notUtcMidnight.length, 0);

  // The early close on 2026-11-27 is 13:00 America/New_York = 18:00Z (EST, UTC-5). Read in UTC that
  // is still Nov 27, so this one happens to be harmless -- and that is exactly why the check must not
  // rely on luck.
  const earlyCloseStamp = e("2026-11-27") + 18 * 3600;
  assert.equal(new Date(earlyCloseStamp * 1000).toISOString().slice(0, 10), "2026-11-27");
  assert.equal(validateTimestamps([earlyCloseStamp]).notUtcMidnight.length, 1, "flagged regardless");

  // THE DATE-BOUNDARY PITFALL, computed rather than recalled: a stamp just after UTC midnight belongs
  // to the PREVIOUS session day in Eastern time.
  const justAfterMidnightUtc = e("2026-03-10") + 3600;                 // 2026-03-10T01:00:00Z
  const inEastern = new Date(justAfterMidnightUtc * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  assert.equal(new Date(justAfterMidnightUtc * 1000).toISOString().slice(0, 10), "2026-03-10");
  assert.equal(inEastern, "2026-03-09", "the same instant is the PREVIOUS day in Eastern time");
  assert.equal(validateTimestamps([justAfterMidnightUtc]).notUtcMidnight.length, 1,
    "so an intraday stamp is reported rather than assigned to a day on the caller's behalf");
});

// ---- per-symbol freshness ------------------------------------------------------------------------

test("a dead-but-present symbol is measured, and its price is marked as not a quote", () => {
  const grid = weekdays("2026-01-02", 60);
  const series = {
    ALIVE: bars(grid),
    DEAD: bars(grid.slice(0, 40), 20, 0.002),          // stops 20 sessions before the decision
  };
  const now = (grid.at(-1) + 3 * DAY) * 1000;
  const f = symbolFreshness({ series, dates: grid, asOf: grid.length - 1, now });
  const by = Object.fromEntries(f.symbols.map((s) => [s.symbol, s]));

  assert.equal(by.ALIVE.sessionsSinceLastBar, 0);
  assert.equal(by.ALIVE.forwardFilledAtDecision, false, "a real quote at the decision");
  assert.equal(by.ALIVE.earlyEnd, false);

  assert.equal(by.DEAD.lastBarAtOrBefore, iso(grid[39]));
  assert.equal(by.DEAD.sessionsSinceLastBar, 20, "counted on the OBSERVED grid, by hand: 59 - 39");
  assert.equal(by.DEAD.forwardFilledAtDecision, true,
    "whatever price the context carries for it is held-flat, not a quote");
  assert.equal(by.DEAD.earlyEnd, true);
  assert.equal(by.DEAD.barsOnGrid, 40);
  assert.ok(by.DEAD.wallClockAgeMs > by.ALIVE.wallClockAgeMs,
    "and the wall-clock age separates them, which the gate's quoteAgeMs does not");
  // Stalest first, so the worst case is the first thing a reader sees.
  assert.equal(f.symbols[0].symbol, "DEAD");
});

test("late start, interior gaps and bars after the decision are each counted separately", () => {
  const grid = weekdays("2026-01-02", 50);
  const full = bars(grid);
  const series = {
    FULL: full,
    LATE: bars(grid.slice(10)),                                       // first bar at grid index 10
    GAPPY: full.filter((_, i) => !(i >= 20 && i < 25)),                // 5 interior sessions absent
    FUTURE: [...bars(grid), { time: grid.at(-1) + DAY, close: 999, volume: 1 }],
  };
  const f = symbolFreshness({ series, dates: grid, asOf: grid.length - 1, now: grid.at(-1) * 1000 });
  const by = Object.fromEntries(f.symbols.map((s) => [s.symbol, s]));

  assert.equal(by.FULL.lateStartSessions, 0);
  assert.equal(by.FULL.interiorMissingSessions, 0);

  assert.equal(by.LATE.lateStartSessions, 10, "ten grid sessions precede its first bar");
  assert.equal(by.LATE.interiorMissingSessions, 0, "a late start is not an interior gap");
  assert.equal(by.LATE.barsOnGrid, 40);

  assert.equal(by.GAPPY.interiorMissingSessions, 5, "strictly inside its own span");
  assert.equal(by.GAPPY.lateStartSessions, 0);
  assert.equal(by.GAPPY.sessionsSinceLastBar, 0, "it is still fresh at the decision");

  // A bar one session AFTER the decision is counted and excluded from everything else.
  assert.equal(by.FUTURE.barsAfterDecision, 1);
  assert.equal(by.FUTURE.sessionsSinceLastBar, 0);
  assert.equal(by.FUTURE.barsOnGrid, 50, "the future bar is not in any at-or-before count");
});

test("IMMEDIATE-NEXT-BAR CONTAMINATION cannot move any freshness figure", () => {
  const grid = weekdays("2026-01-02", 40);
  const base = { AAA: bars(grid), BBB: bars(grid.slice(0, 30), 50, 0.003) };
  const contaminated = {
    AAA: [...bars(grid), { time: grid.at(-1) + DAY, close: 1e6, volume: 1e9 }],
    BBB: [...bars(grid.slice(0, 30), 50, 0.003), { time: grid.at(-1) + DAY, close: 0.001, volume: 1 }],
  };
  const asOf = grid.length - 1, now = grid.at(-1) * 1000;
  const a = symbolFreshness({ series: base, dates: grid, asOf, now });
  const b = symbolFreshness({ series: contaminated, dates: grid, asOf, now });
  // Everything except the deliberate `barsAfterDecision` counter must be identical.
  const strip = (r) => ({ ...r, symbols: r.symbols.map(({ barsAfterDecision, ...rest }) => rest) });
  assert.deepEqual(strip(b), strip(a), "the next bar must not reach any at-or-before measurement");
  assert.equal(b.symbols.find((s) => s.symbol === "AAA").barsAfterDecision, 1, "but it IS counted");
});

test("a symbol's own disorder is reported, and its history is measured by TIME not position", () => {
  // buildContext's truncation breaks at the first out-of-order future bar and silently loses the rest
  // (§9.4 R1). This measures what is actually there instead, and names the shape problem.
  const grid = weekdays("2026-01-02", 40);
  const ordered = bars(grid);
  const scrambled = [ordered[0], { time: grid.at(-1) + DAY, close: 1, volume: 1 }, ...ordered.slice(1)];
  const f = symbolFreshness({ series: { AAA: scrambled }, dates: grid, asOf: grid.length - 1,
    now: grid.at(-1) * 1000 });
  const [row] = f.symbols;
  assert.ok(row.shape, "the disorder is reported");
  assert.ok(row.shape.outOfOrder.length >= 1);
  assert.equal(row.barsOnGrid, 40, "and all 40 at-or-before bars are still counted, by time");
  assert.equal(row.sessionsSinceLastBar, 0, "so it is NOT reported as stale, unlike buildContext's view");
  assert.equal(row.barsAfterDecision, 1);
});

test("off-grid bar dates are reported rather than silently ignored", () => {
  const grid = weekdays("2026-01-02", 20);
  const offGridDay = grid[5] + DAY;                      // a weekend or a closure: not in the grid
  assert.ok(!grid.includes(offGridDay));
  const f = symbolFreshness({ series: { AAA: [...bars(grid), { time: offGridDay, close: 1, volume: 1 }] },
    dates: grid, asOf: grid.length - 1, now: grid.at(-1) * 1000 });
  assert.deepEqual(f.symbols[0].offGridDates, [iso(offGridDay)]);
  assert.equal(f.symbols[0].barsOnGrid, 20, "it is excluded from the on-grid count, and named");
});

test("a symbol with no usable bar at or before the decision reports nulls, not zeros", () => {
  const grid = weekdays("2026-01-02", 20);
  const f = symbolFreshness({ series: { NONE: bars([grid.at(-1) + 5 * DAY]) }, dates: grid,
    asOf: grid.length - 1, now: grid.at(-1) * 1000 });
  const [row] = f.symbols;
  assert.equal(row.lastBarAtOrBefore, null);
  assert.equal(row.sessionsSinceLastBar, null, "null, not 0 -- absence is not freshness");
  assert.equal(row.forwardFilledAtDecision, null);
  assert.equal(row.barsOnGrid, 0);
  assert.equal(row.barsAfterDecision, 1);
});

test("symbolFreshness refuses a decision index it cannot interpret", () => {
  const grid = weekdays("2026-01-02", 10);
  assert.throws(() => symbolFreshness({ series: {}, dates: [], asOf: 0 }), /dates required/);
  assert.throws(() => symbolFreshness({ series: {}, dates: grid, asOf: 99 }), /outside the grid/);
  assert.throws(() => symbolFreshness({ series: {}, dates: grid, asOf: -1 }), /outside the grid/);
});

// ---- the 2026-2028 grounding, and the year boundaries ------------------------------------------

test("every supplied closure and early close is a WEEKDAY, verified computationally", () => {
  // A weekend entry would not be a session closure at all, so this is the first check the transcribed
  // facts have to pass. Computed from the dates, never recalled.
  for (const [year, y] of Object.entries(NYSE_2026_2028.years)) {
    for (const d of y.closed) {
      assert.ok(d.startsWith(`${year}-`), `${d} is filed under ${year}`);
      const w = new Date(e(d) * 1000).getUTCDay();
      assert.ok(w !== 0 && w !== 6, `${d} must be a weekday to be a closure of a session`);
    }
    for (const { date, closes } of y.earlyClose) {
      assert.ok(date.startsWith(`${year}-`));
      const w = new Date(e(date) * 1000).getUTCDay();
      assert.ok(w !== 0 && w !== 6, `${date} must be a weekday`);
      assert.match(closes, /^13:00 America\/New_York$/);
      assert.ok(!y.closed.includes(date), `${date} is a short session, not a closed day`);
    }
  }
  assert.deepEqual(calendarYears(), [2026, 2027, 2028]);
  assert.equal(NYSE_2026_2028.coverage, "2026-2028");
  assert.equal(NYSE_2026_2028.retrieved, "2026-10-06");
  assert.match(NYSE_2026_2028.basis, /exceptional exchange notices are NOT included/);
});

test("2028's missing New Year's holiday matches the page's own footnote, computed", () => {
  // The footnote says no New Year's Day holiday is observed because 2028-01-01 falls on a Saturday.
  // That is a checkable claim, and it explains the closure count differing from the other years.
  assert.equal(new Date(e("2028-01-01") * 1000).getUTCDay(), 6, "2028-01-01 is a Saturday");
  assert.ok(!NYSE_2026_2028.years[2028].closed.some((d) => d.endsWith("-01-01")));
  assert.match(NYSE_2026_2028.years[2028].note, /Saturday/);
  assert.equal(NYSE_2026_2028.years[2028].closed.length, 9);
  assert.equal(NYSE_2026_2028.years[2026].closed.length, 10);
  assert.equal(NYSE_2026_2028.years[2027].closed.length, 10);
  // 2026 and 2027 DO carry a New Year's closure, and both fall on a weekday.
  for (const y of [2026, 2027]) {
    const d = `${y}-01-01`;
    assert.ok(NYSE_2026_2028.years[y].closed.includes(d));
    const w = new Date(e(d) * 1000).getUTCDay();
    assert.ok(w !== 0 && w !== 6);
  }
});

test("each grounded year resolves to a session count its own weekdays explain", () => {
  // Not a recalled figure: the weekday total is counted here and the closures subtracted.
  for (const y of calendarYears()) {
    const from = e(`${y}-01-01`), to = e(`${y}-12-31`);
    let weekdays = 0;
    for (let t = from; t <= to; t += DAY) {
      const w = new Date(t * 1000).getUTCDay();
      if (w !== 0 && w !== 6) weekdays++;
    }
    const r = expectedSessions({ from, to });
    assert.equal(r.supported, true);
    assert.equal(r.closedInWindow.length, NYSE_2026_2028.years[y].closed.length);
    assert.equal(r.sessions.length, weekdays - NYSE_2026_2028.years[y].closed.length,
      `${y}: ${weekdays} weekdays minus ${NYSE_2026_2028.years[y].closed.length} closures`);
    // The early closes are inside the session set, not outside it.
    for (const { date } of NYSE_2026_2028.years[y].earlyClose) {
      assert.ok(r.sessions.map(iso).includes(date), `${date} is a shorter session and must be expected`);
    }
  }
});

test("a window CROSSING a year boundary inside coverage is answered, not refused", () => {
  // The case §10.6 named: a forward run spanning New Year must not go UNSUPPORTED.
  const r = expectedSessions({ from: e("2026-12-28"), to: e("2027-01-08") });
  assert.equal(r.supported, true);
  const got = r.sessions.map(iso);
  // Hand-checkable: 2026-12-25 (Fri) and 2027-01-01 (Fri) are closures; 2026-12-24 is an early close
  // and therefore still a session.
  assert.ok(!got.includes("2027-01-01"), "the 2027 closure is removed inside a window that began in 2026");
  assert.ok(got.includes("2026-12-31"), "and the sessions either side are kept");
  assert.ok(got.includes("2027-01-04"));
  assert.ok(!got.includes("2027-01-02"), "a Saturday is not a session");
  assert.ok(!got.includes("2027-01-03"), "nor a Sunday");

  // The 2027/2028 boundary too, where 2028 has no New Year's closure at all.
  const r2 = expectedSessions({ from: e("2027-12-27"), to: e("2028-01-07") });
  assert.equal(r2.supported, true);
  const got2 = r2.sessions.map(iso);
  assert.ok(!got2.includes("2027-12-24"), "outside the window");
  assert.ok(got2.includes("2028-01-03"), "2028-01-03 is a Monday session");
  assert.ok(!got2.includes("2028-01-01"), "a Saturday, so no closure is needed to exclude it");
  assert.ok(got2.includes("2027-12-31"), "2027-12-31 is a Friday session");
});

test("reconciliation works across a year boundary and still reports a missing session", () => {
  const all = expectedSessions({ from: e("2026-12-14"), to: e("2027-01-15") }).sessions;
  const dropped = all.find((t) => iso(t).startsWith("2027-"));
  const observed = all.filter((t) => t !== dropped);
  const r = reconcileSessions({ observed, from: e("2026-12-14"), to: e("2027-01-15") });
  assert.equal(r.supported, true, "both years are grounded, so the comparison is available");
  assert.equal(r.expected, all.length, "the expected count spans the boundary without shrinking");
  assert.deepEqual(r.missingExpected, [iso(dropped)]);
  assert.equal(r.calendar.coverage, "2026-2028");
});

test("a DST transition does not move a session's date under the panel's UTC-midnight convention", () => {
  // US DST in 2027 begins Sunday 2027-03-14 and ends Sunday 2027-11-07 -- both Sundays, hence never
  // sessions. Computed here rather than asserted: find the Sundays and show the sessions either side
  // are consecutive, with no date shifted or duplicated.
  const march = expectedSessions({ from: e("2027-03-08"), to: e("2027-03-19") }).sessions.map(iso);
  assert.deepEqual(march, ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12",
    "2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19"],
    "ten consecutive weekday sessions across the spring transition, no gap and no repeat");
  const nov = expectedSessions({ from: e("2027-11-01"), to: e("2027-11-12") }).sessions.map(iso);
  assert.deepEqual(nov, ["2027-11-01", "2027-11-02", "2027-11-03", "2027-11-04", "2027-11-05",
    "2027-11-08", "2027-11-09", "2027-11-10", "2027-11-11", "2027-11-12"],
    "and ten across the autumn transition");
  // Every session timestamp is still at UTC midnight, so no date became ambiguous.
  for (const t of expectedSessions({ from: e("2027-03-08"), to: e("2027-11-12") }).sessions) {
    assert.equal(t % DAY, 0);
  }
  // THE PITFALL REMAINS A TIMESTAMP ONE, NOT A CALENDAR ONE: an intraday stamp inside the DST window
  // can still land on the previous Eastern day, which validateTimestamps flags (see the test above).
  const duringEdt = e("2027-07-01") + 2 * 3600;                       // 2027-07-01T02:00:00Z
  assert.equal(new Date(duringEdt * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    "2027-06-30", "02:00Z in summer is the previous day in Eastern time");
  assert.equal(validateTimestamps([duringEdt]).notUtcMidnight.length, 1);
});

test("the early-close times are recorded and unused — no intraday feature is added", () => {
  // Scope guard: the times exist so a later intraday diagnostic does not read a short session as a
  // missing one. Nothing in this module consumes them, and that is asserted rather than assumed.
  const src = fs.readFileSync(new URL("./panel-freshness.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function expectedSessions"));
  assert.ok(!body.includes("earlyClose"), "no function in this module branches on an early close");
  assert.ok(!/13:00/.test(body), "and no close time is used in any computation");
  // They are still reachable as published facts.
  assert.equal(NYSE_2026_2028.years[2027].earlyClose[0].date, "2027-11-26");
  assert.equal(NYSE_2026_2028.years[2028].earlyClose.length, 2);
});
