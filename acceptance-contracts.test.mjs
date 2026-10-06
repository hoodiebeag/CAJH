/**
 * Adversarial acceptance contracts for docs/REMEDIATION-PLAN.md items A1 and A3.
 *
 * These are not implementations. Each test pins the CONTRACT a fix would have to satisfy, using a
 * fixture built to break the version of the proposal that was written before this unit. Two proposals
 * were wrong and are corrected here:
 *
 *   A1 proposed counting OBSERVED panel sessions for dueness, and claimed it depended on nothing. An
 *      outage that removes a session for every symbol disappears from that count, so an overdue
 *      decision reads as "not due" and the missing-data failure is erased by its own cause.
 *   A3 proposed feeding the symbol's own daily bar timestamp into the 15-minute quote-age limit. A
 *      daily bar is a session record stamped at 00:00:00Z, not an executable quote, so that figure is
 *      always at least a day old and the substitution would reject every fresh symbol.
 *
 * Nothing runtime is changed. `analyst/protocol.mjs`, `analyst/risk.mjs` and `analyst/loop.mjs` are
 * read, not modified, and no threshold is altered anywhere.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { duenessByCalendar, freshnessInformation, expectedSessions, NYSE_2026_2028 } from "./panel-freshness.mjs";
import { buildContext } from "./analyst/context.mjs";
import { instrumentsFromContext, missedSessions, sessionWeekdays } from "./analyst/loop.mjs";
import { applyRiskGate, DEFAULT_LIMITS } from "./analyst/risk.mjs";

const DAY = 86400;
const THESIS = "a thesis long enough to review";
const e = (isoDate) => Date.parse(`${isoDate}T00:00:00Z`) / 1000;
const iso = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
const buy = (symbol) => ({ symbol, action: "buy", targetPct: 0.05, thesis: THESIS });
const gateOn = (inst, symbol) => applyRiskGate([buy(symbol)],
  { nav: 1e5, peakNav: 1e5, dayStartNav: 1e5, positions: {}, shortingPermitted: false }, inst);

// =================================================================================================
// A1 — dueness must rest on SOURCED EXPECTED sessions, not the observed panel count
// =================================================================================================

test("A1 ADVERSARY: a panel-wide gap must not erase an overdue settlement", () => {
  // Five expected sessions elapse after the decision, but one is missing for EVERY symbol. Counting
  // observed sessions gives four and reports "not due", which is the failure erasing its own cause.
  const decisionBar = e("2026-10-01");                       // Thursday
  const after = expectedSessions({ from: decisionBar, to: e("2026-10-08") }).sessions
    .filter((t) => t > decisionBar);
  assert.equal(after.length, 5, "Oct 2, 5, 6, 7, 8 — five expected sessions");

  const observed = after.filter((t) => t !== after[2]);      // an outage removes one for all names
  assert.equal(observed.length, 4, "the observed union loses it entirely");

  // The proposal as first written: count what the panel contains.
  assert.ok(observed.length < 5, "observed counting would say NOT DUE");
  // The corrected contract: expected sessions decide, so it IS due.
  const d = duenessByCalendar({ decisionBar, now: Date.parse("2026-10-08T21:00:00Z"), holdSessions: 5 });
  assert.equal(d.due, true, "the decision is overdue and must be reported as such");
  assert.equal(d.elapsedSessions, 5);
  assert.equal(d.basis, "expected-sessions");
});

test("A1: a weekend is LEGITIMATELY not due, which is a correct answer and not a deferral", () => {
  const decisionBar = e("2026-10-01");                       // Thursday
  const d = duenessByCalendar({ decisionBar, now: Date.parse("2026-10-06T21:00:00Z"), holdSessions: 5 });
  assert.equal(d.due, false);
  assert.equal(d.elapsedSessions, 3, "Fri, Mon, Tue — three sessions, not five calendar days");
  assert.notEqual(d.due, null, "false is a decision; null would be a failure to determine");
});

test("A1: a published closure is not an expected session, so it does not advance dueness", () => {
  // 2026-11-26 is a published closure and 2026-11-27 is an EARLY CLOSE, which is still a session.
  assert.ok(NYSE_2026_2028.years[2026].closed.includes("2026-11-26"));
  assert.ok(NYSE_2026_2028.years[2026].earlyClose.some((x) => x.date === "2026-11-27"));

  const decisionBar = e("2026-11-20");                       // Friday
  const d = duenessByCalendar({ decisionBar, now: Date.parse("2026-11-27T21:00:00Z"), holdSessions: 5 });
  // Nov 23, 24, 25 are sessions; Nov 26 is closed; Nov 27 is a short session. Four, not five.
  assert.equal(d.elapsedSessions, 4);
  assert.equal(d.due, false, "the closure correctly costs a session");
  const sessions = expectedSessions({ from: decisionBar, to: e("2026-11-27") }).sessions.map(iso);
  assert.ok(!sessions.includes("2026-11-26"), "the closure is excluded");
  assert.ok(sessions.includes("2026-11-27"), "the early close is INCLUDED — it is a session");
  // One more session and it is due, which shows the early close is doing real work in the count.
  assert.equal(duenessByCalendar({ decisionBar, now: Date.parse("2026-11-30T21:00:00Z"), holdSessions: 5 }).due, true);
});

test("A1: a genuinely due decision whose SYMBOL lacks coverage stays due", () => {
  // The §8.7 invariant restated as a contract: dueness and coverage are different questions, and a
  // fix must not make an uncovered name "not due" to avoid failing.
  const decisionBar = e("2026-10-01");
  const d = duenessByCalendar({ decisionBar, now: Date.parse("2026-10-08T21:00:00Z"), holdSessions: 5 });
  assert.equal(d.due, true);
  // The symbol's own coverage is not consulted here at all, which is the point.
  const grid = expectedSessions({ from: e("2026-09-01"), to: e("2026-10-08") }).sessions;
  const series = { GONE: grid.slice(0, 3).map((t) => ({ time: t, close: 10, volume: 1 })) };
  const f = freshnessInformation({ series, dates: grid, asOf: grid.length - 1, now: Date.parse("2026-10-08T21:00:00Z") });
  assert.ok(f.symbols[0].sessionsSinceLastBar > 5, "the symbol cannot settle");
  assert.equal(d.due, true, "and it is STILL due — the two answers are independent");
});

test("A1: outside grounded coverage, dueness is UNDECIDABLE and must not fall back", () => {
  const d = duenessByCalendar({ decisionBar: e("2025-03-03"), now: Date.parse("2025-03-20T00:00:00Z"), holdSessions: 5 });
  assert.equal(d.due, null, "null, not false — a failure to determine, not 'not due'");
  assert.match(d.unknown, /coverage is 2026-2028/);
  assert.equal(d.elapsedSessions, null, "no count is invented");
  assert.equal(d.basis, "none");
  assert.match(d.note, /do not substitute the observed count/);
  // 2029 likewise.
  assert.equal(duenessByCalendar({ decisionBar: e("2029-01-03"), now: Date.parse("2029-02-01T00:00:00Z") }).due, null);
});

test("A1: duenessByCalendar rejects inputs it cannot interpret", () => {
  assert.throws(() => duenessByCalendar({ decisionBar: NaN, now: Date.now() }), /finite decisionBar/);
  assert.throws(() => duenessByCalendar({ decisionBar: e("2026-05-01"), now: NaN }), /finite now/);
  for (const bad of [0, -1, 2.5, "5"]) {
    assert.throws(() => duenessByCalendar({ decisionBar: e("2026-05-01"), now: Date.now(), holdSessions: bad }),
      /holdSessions must be a positive integer/);
  }
});

// =================================================================================================
// A3 — a daily session record is not a quote, and the current reference path already rejects
// =================================================================================================

/** Weekdays ending at `endISO`, as the real panel is shaped: UTC midnight, no weekends. */
const sessionGrid = (endISO, n) => {
  const out = [];
  for (let t = e(endISO); out.length < n; t -= DAY) {
    const w = new Date(t * 1000).getUTCDay();
    if (w !== 0 && w !== 6) out.unshift(t);
  }
  return out;
};

test("A3: in paper mode a FRESH symbol is already rejected stale_quote on a daily panel", () => {
  // The reference the runtime uses in paper mode is the WALL CLOCK (analyst/loop.mjs:231,
  // `mode === MODE.PAPER ? now : asOfTime * 1000`). The panel's newest bar must be the last
  // COMPLETED session for the paper guard to pass, so it is stamped at least one midnight back.
  const dates = sessionGrid("2026-10-01", 300);              // last bar Thursday, 00:00:00Z
  const asOfTime = dates.at(-1);
  const series = { AAA: dates.map((t, i) => ({ time: t, close: 100 * 1.002 ** i, volume: 1e6 })) };
  const ctx = buildContext({ series, dates, asOf: dates.length - 1, sectors: { AAA: "Tech" } });
  const now = Date.parse("2026-10-02T14:00:00Z");            // the next trading morning

  // The paper staleness guard is satisfied: nothing is behind.
  assert.equal(missedSessions(asOfTime, now, sessionWeekdays(dates)), 0, "paper mode would PROCEED");

  const inst = instrumentsFromContext(ctx, series, asOfTime, now);
  assert.ok(inst.AAA.quoteAgeMs > DEFAULT_LIMITS.maxQuoteAgeMs,
    `${inst.AAA.quoteAgeMs}ms must exceed the ${DEFAULT_LIMITS.maxQuoteAgeMs}ms limit`);
  assert.ok(inst.AAA.quoteAgeMs > 24 * 3600 * 1000, "at least a day, structurally");
  const r = gateOn(inst, "AAA");
  assert.deepEqual(r.allowed, [], "a perfectly fresh symbol is rejected");
  assert.equal(r.rejected[0].code, "stale_quote");
});

test("A3: the minimum possible paper-mode figure is a day, so no fresh symbol can ever pass", () => {
  // Not a property of one fixture: the bar is stamped at 00:00:00Z of a session that has already
  // completed, and the run happens on a later day, so the difference is at least 24h by construction.
  const dates = sessionGrid("2026-10-01", 300);   // clears the 252-bar momentum warm-up
  const asOfTime = dates.at(-1);
  const series = { AAA: dates.map((t, i) => ({ time: t, close: 100 * 1.001 ** i, volume: 1e6 })) };
  const ctx = buildContext({ series, dates, asOf: dates.length - 1, sectors: { AAA: "Tech" } });
  for (const at of ["2026-10-02T00:00:00Z", "2026-10-02T13:30:00Z", "2026-10-02T19:55:00Z"]) {
    const inst = instrumentsFromContext(ctx, series, asOfTime, Date.parse(at));
    assert.ok(inst.AAA.quoteAgeMs >= 24 * 3600 * 1000, `${at}: ${inst.AAA.quoteAgeMs}`);
    assert.ok(inst.AAA.quoteAgeMs / 60000 > 15);
  }
});

test("A3: the dry-run reference passes, which is why the suite has never caught this", () => {
  // In a dry run the reference is `asOfTime * 1000`, so the age is exactly 0 and the gate passes.
  // The defect is specific to the paper path.
  const dates = sessionGrid("2026-10-01", 300);   // clears the 252-bar momentum warm-up
  const asOfTime = dates.at(-1);
  const series = { AAA: dates.map((t, i) => ({ time: t, close: 100 * 1.001 ** i, volume: 1e6 })) };
  const ctx = buildContext({ series, dates, asOf: dates.length - 1, sectors: { AAA: "Tech" } });
  const inst = instrumentsFromContext(ctx, series, asOfTime, asOfTime * 1000);
  assert.equal(inst.AAA.quoteAgeMs, 0);
  assert.deepEqual(gateOn(inst, "AAA").allowed.map((a) => a.symbol), ["AAA"]);
});

test("A3: the existing paper-mode test passes because its panel is stamped at `now`, not midnight", () => {
  // analyst/loop.test.mjs's `panel()` helper sets lastTime = floor(now/1000) - endingDaysAgo*DAY, so
  // with endingDaysAgo=0 the newest bar carries an arbitrary wall-clock instant and the age is ~0.
  // The real bundle stamps every bar at 00:00:00Z (verified: 0 of 921 misaligned), so the test panel
  // and the real panel differ in exactly the way that hides this.
  const now = Date.parse("2026-10-02T14:00:00Z");
  const lastTimeTestStyle = Math.floor(now / 1000);                       // the helper's convention
  const lastTimeRealStyle = e("2026-10-01");                              // the bundle's convention
  assert.notEqual(lastTimeTestStyle % DAY, 0, "the test helper's stamp is NOT at UTC midnight");
  assert.equal(lastTimeRealStyle % DAY, 0, "the real panel's is");
  assert.ok(now - lastTimeTestStyle * 1000 < DEFAULT_LIMITS.maxQuoteAgeMs,
    "so the test's age is inside the limit");
  assert.ok(now - lastTimeRealStyle * 1000 > DEFAULT_LIMITS.maxQuoteAgeMs,
    "while the real convention's is far outside it");
});

test("A3: session freshness and quote freshness are reported as DIFFERENT quantities", () => {
  const dates = sessionGrid("2026-10-01", 300);
  const series = {
    FRESH: dates.map((t, i) => ({ time: t, close: 100 * 1.002 ** i, volume: 1e6 })),
    STALE: dates.slice(0, 281).map((t, i) => ({ time: t, close: 20 * 1.001 ** i, volume: 1e6 })),
  };
  const now = Date.parse("2026-10-02T14:00:00Z");
  const f = freshnessInformation({ series, dates, asOf: dates.length - 1, now });
  const by = Object.fromEntries(f.symbols.map((s) => [s.symbol, s]));

  // DAILY-SESSION freshness separates them cleanly.
  assert.equal(by.FRESH.sessionsSinceLastBar, 0);
  assert.equal(by.STALE.sessionsSinceLastBar, 19, "299 - 280");
  assert.equal(by.FRESH.forwardFilledAtDecision, false);
  assert.equal(by.STALE.forwardFilledAtDecision, true);

  // The bar-timestamp age does NOT separate them usefully: both are over a day, so a 15-minute
  // threshold rejects both and a threshold loose enough to pass FRESH also passes STALE at 19
  // sessions unless it is expressed in sessions.
  assert.ok(by.FRESH.barTimestampAgeMs > DEFAULT_LIMITS.maxQuoteAgeMs);
  assert.ok(by.STALE.barTimestampAgeMs > by.FRESH.barTimestampAgeMs);

  // And a quote age is reported as UNAVAILABLE rather than imputed.
  for (const s of f.symbols) {
    assert.equal(s.quoteAgeMs, null);
    assert.equal(s.quoteAgeAvailable, false);
    assert.match(s.quoteAgeReason, /no intraday observation/);
  }
  // Both reference paths the runtime uses are reported, so a proposal can be read against them.
  assert.equal(f.referenceUsedByPaper, now);
  assert.equal(f.referenceUsedByDryRun, dates.at(-1) * 1000);
});

test("A3: the immediate next bar is excluded from every freshness figure", () => {
  const dates = sessionGrid("2026-10-01", 300);
  const nextBar = dates.at(-1) + DAY;
  const base = { AAA: dates.map((t, i) => ({ time: t, close: 100 * 1.001 ** i, volume: 1e6 })) };
  const withNext = { AAA: [...base.AAA, { time: nextBar, close: 1e6, volume: 1e9 }] };
  const now = Date.parse("2026-10-02T14:00:00Z");
  const a = freshnessInformation({ series: base, dates, asOf: dates.length - 1, now });
  const b = freshnessInformation({ series: withNext, dates, asOf: dates.length - 1, now });
  assert.deepEqual(b, a, "a bar after the decision must not move any figure");
});
