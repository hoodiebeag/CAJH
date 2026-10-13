/**
 * Point-in-time invariants on ragged panels, and calendar/coverage accounting.
 *
 * TWO KINDS OF CLAIM, kept apart. The first group PERTURBS the immediate next bar and asserts the
 * context does not move — an invariant tested against the data, not against a restatement of the
 * index arithmetic the implementation already uses. The second group shows what survives that
 * invariant and is still wrong: point-in-time is not the same property as fresh.
 *
 * NO REMEMBERED CALENDAR FACTS. Every fixture defines its gaps structurally ("a weekday with no bar
 * for any symbol"), never by naming a real holiday. No exchange-calendar source is reachable from
 * this session, so expected market sessions stay UNKNOWN rather than being asserted from memory.
 *
 * Synthetic throughout. Nothing here is evidence about a strategy, and nothing runtime is changed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, contextIsPointInTime } from "./analyst/context.mjs";
import { instrumentsFromContext, sessionWeekdays, missedSessions } from "./analyst/loop.mjs";
import { applyRiskGate } from "./analyst/risk.mjs";
import { calendarAccounting } from "./journal-completeness.mjs";

const DAY = 86400;
const T0 = Date.parse("2025-01-06T00:00:00Z") / 1000;              // a Monday
const THESIS = "a thesis long enough to review";

/** n consecutive Mon-Fri timestamps. The weekday shape only; no holiday is claimed. */
const grid = (n, from = T0) => {
  const out = [];
  for (let d = from; out.length < n; d += DAY) {
    const w = new Date(d * 1000).getUTCDay();
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out;
};
const ramp = (dates, start = 100, step = 0.002) =>
  dates.map((t, i) => ({ time: t, close: start * (1 + step) ** i, volume: 1e6 }));

const DATES = grid(300);
const ASOF = DATES.length - 1;
const ASOF_TIME = DATES[ASOF];

// ---- the invariant, by perturbation --------------------------------------------------------------

test("INVARIANT: perturbing only the immediate next bar changes nothing in the context", () => {
  // The decisive test, and the one an index-restating test cannot do: alter ONLY the bar at asOf+1,
  // leave every bar at or before asOf byte-identical, and require the whole context to match.
  const base = { AAA: ramp(DATES), BBB: ramp(DATES, 50, 0.001) };
  const nextBar = DATES.at(-1) + DAY;
  const perturbed = {
    AAA: [...ramp(DATES), { time: nextBar, close: 99999, volume: 1e9 }],
    BBB: [...ramp(DATES, 50, 0.001), { time: nextBar, close: 0.01, volume: 1 }],
  };
  const a = buildContext({ series: base, dates: DATES, asOf: ASOF });
  const b = buildContext({ series: perturbed, dates: DATES, asOf: ASOF });
  assert.deepEqual(b, a, "a bar one session after the decision must not reach the context");

  // And with that session present in `dates` too, asOf still pointing at the earlier index.
  const withNext = [...DATES, nextBar];
  const c = buildContext({ series: base, dates: withNext, asOf: ASOF });
  const d = buildContext({ series: perturbed, dates: withNext, asOf: ASOF });
  assert.deepEqual(d, c, "extending the date grid must not change a decision taken before it");
  assert.deepEqual(c, a, "and the context must be the same one the shorter grid produced");
});

test("INVARIANT: every timestamp the context reports is at or before the decision bar", () => {
  const series = { AAA: ramp(DATES), BBB: ramp(DATES, 50, 0.001) };
  const news = {
    AAA: [{ at: new Date((ASOF_TIME - DAY) * 1000).toISOString(), headline: "before" },
          { at: new Date((ASOF_TIME + DAY) * 1000).toISOString(), headline: "AFTER THE DECISION" }],
  };
  const ctx = buildContext({ series, dates: DATES, asOf: ASOF, news });
  assert.equal(ctx.asOfTime, ASOF_TIME);
  assert.ok(Date.parse(`${ctx.asOf}T00:00:00Z`) / 1000 <= ASOF_TIME);
  for (const c of ctx.candidates) {
    for (const n of c.news ?? []) {
      assert.ok(Date.parse(n.at) / 1000 <= ASOF_TIME, `news ${n.at} is after the boundary`);
    }
  }
  const aaa = ctx.candidates.find((c) => c.symbol === "AAA");
  assert.equal(aaa.news.length, 1, "the post-decision headline is filtered out by buildContext");
  assert.deepEqual(contextIsPointInTime(ctx, ASOF_TIME), [], "and the checker agrees");
});

// ---- what the checker can and cannot see ---------------------------------------------------------

test("contextIsPointInTime verifies the asOf LABEL and news dates — and nothing about prices", () => {
  // Read off the source: it compares ctx.asOf against the boundary and each news item's `at`. No
  // price, bar, indicator or ranking is examined. Criterion 2 therefore certifies those two things.
  const series = { AAA: ramp(DATES) };
  const ctx = buildContext({ series, dates: DATES, asOf: ASOF });
  // A hand-forged context with a future label IS caught.
  assert.equal(contextIsPointInTime({ ...ctx, asOf: "2099-01-01" }, ASOF_TIME).length, 1);
  // A hand-forged context whose candidate carries an impossible price is NOT.
  const forged = { ...ctx, candidates: ctx.candidates.map((c) => ({ ...c, ret5d: 99, indicators: { momentum: 42 } })) };
  assert.deepEqual(contextIsPointInTime(forged, ASOF_TIME), [],
    "no price or indicator is checked, so a fabricated one passes");
  // Future news IS caught when it reaches the context by another route.
  const withFutureNews = { ...ctx, candidates: [{ ...ctx.candidates[0],
    news: [{ at: new Date((ASOF_TIME + DAY) * 1000).toISOString(), headline: "x" }] }] };
  assert.equal(contextIsPointInTime(withFutureNews, ASOF_TIME).length, 1);
});

test("an interior future date in an unsorted grid is not refused, and leaks no price", () => {
  // Two separate facts. The checker does not notice; the grid construction still protects prices,
  // because the per-symbol lookup is keyed on TIME and no bar exists at the bogus date.
  const bad = [...DATES];
  bad[150] = Date.parse("2099-01-01T00:00:00Z") / 1000;
  const series = { AAA: ramp(DATES), BBB: ramp(DATES, 50, 0.001) };
  const ctx = buildContext({ series, dates: bad, asOf: ASOF });
  assert.deepEqual(contextIsPointInTime(ctx, bad[ASOF]), [], "no issue is raised");
  assert.equal(ctx.asOf, new Date(ASOF_TIME * 1000).toISOString().slice(0, 10),
    "the decision bar is still the last index, so the label is right");
  // No candidate can carry the 2099 close, because there is no bar at that time to pick up.
  const sorted = buildContext({ series, dates: DATES, asOf: ASOF });
  assert.notDeepEqual(ctx, sorted, "but the context DOES differ: the grid has a phantom index");
  // The phantom shifts position-indexed lookbacks by one slot without changing any price.
  for (const c of ctx.candidates) {
    assert.ok(Number.isFinite(c.indicators.momentum) || c.indicators.momentum === null);
  }
});

test("a duplicate timestamp in the grid is accepted and silently shifts the index space", () => {
  const dup = [...DATES];
  dup[150] = dup[149];
  const series = { AAA: ramp(DATES), BBB: ramp(DATES, 50, 0.001) };
  const ctx = buildContext({ series, dates: dup, asOf: ASOF });
  assert.deepEqual(contextIsPointInTime(ctx, dup[ASOF]), [], "not flagged");
  assert.notDeepEqual(ctx, buildContext({ series, dates: DATES, asOf: ASOF }),
    "the duplicated session repeats a close, so position-indexed lookbacks move");
});

// ---- the reachable defects ------------------------------------------------------------------------

test("DEFECT: a symbol whose own bars are out of order gets a FABRICATED flat history", () => {
  // The truncation loop breaks at the first bar after the boundary (`context.mjs:88`), relying on the
  // series being time-ordered. Put a future bar early and everything after it is discarded.
  const bars = ramp(DATES);
  const scrambled = [bars[0], { time: DATES.at(-1) + DAY, close: 1, volume: 1 }, ...bars.slice(1)];
  const ctx = buildContext({ series: { AAA: scrambled, BBB: ramp(DATES, 50, 0.001) },
    dates: DATES, asOf: ASOF });
  const aaa = ctx.candidates.find((c) => c.symbol === "AAA");
  assert.ok(aaa, "AAA is still a candidate");
  // One surviving bar, forward-filled across 300 sessions: every return is exactly zero, so the
  // momentum is 0 rather than null — a plausible middle-of-the-cross-section value, not a refusal.
  assert.equal(aaa.indicators.momentum, 0, "a fabricated flat history ranks as exactly zero momentum");
  assert.equal(aaa.ret5d, 0);
  assert.equal(aaa.ret63d, 0);
  assert.deepEqual(contextIsPointInTime(ctx, ASOF_TIME), [], "and criterion 2 sees nothing wrong");
  // The sorted series does NOT produce zero, so this is the scrambling and not the fixture.
  const ok = buildContext({ series: { AAA: bars, BBB: ramp(DATES, 50, 0.001) }, dates: DATES, asOf: ASOF });
  assert.ok(ok.candidates.find((c) => c.symbol === "AAA").indicators.momentum > 0.1);
});

test("FIXED BY A3: a symbol dead for 200 sessions is still a candidate, but the gate REJECTS it", () => {
  // Point-in-time holds here — every bar used predates the decision. FRESHNESS is a different
  // property, and before A3 nothing computed it: `instrumentsFromContext` derived quoteAgeMs from
  // the DECISION BAR, identically for every symbol, so the 15-minute limit could not see per-symbol
  // staleness and this name was ALLOWED at a price 200 sessions old.
  const series = { ALIVE: ramp(DATES), DEAD: ramp(DATES.slice(0, 100), 20, 0.001) };
  const ctx = buildContext({ series, dates: DATES, asOf: ASOF, sectors: { ALIVE: "Tech", DEAD: "Tech" } });

  // THE CONTEXT HALF IS UNCHANGED, DELIBERATELY. A3 was a gate fix; whether a stale name should
  // reach the slate at all is a separate, unapproved eligibility question.
  const dead = ctx.candidates.find((c) => c.symbol === "DEAD");
  assert.ok(dead, "the dead name is still shown to the analyst");
  assert.ok(Number.isFinite(dead.indicators.momentum), "still with a non-null momentum");
  assert.equal(dead.ret5d, 0, "and a flat recent path, because it is forward-filled");
  assert.deepEqual(contextIsPointInTime(ctx, ASOF_TIME), [], "criterion 2 still reports nothing");

  // The instrument record now separates the two quantities instead of conflating them.
  const inst = instrumentsFromContext(ctx, series, ASOF_TIME, ASOF_TIME * 1000);
  assert.equal(inst.DEAD.quoteAgeMs, null, "a daily panel carries no intraday observation");
  assert.equal(inst.ALIVE.quoteAgeMs, null);
  assert.equal(inst.ALIVE.sessionBar, inst.ALIVE.decisionSession, "the live name traded that session");
  assert.notEqual(inst.DEAD.sessionBar, inst.DEAD.decisionSession, "the dead one did not");
  assert.equal(inst.DEAD.sessionBar, DATES[99], "its newest bar is 200 sessions back");
  const lastRealClose = series.DEAD.at(-1).close;
  assert.ok(Math.abs(inst.DEAD.price - lastRealClose) < 1e-9,
    "the price is still its last real close — the gate's job is to refuse it, not to repair it");

  const gate = (symbol) => applyRiskGate([{ symbol, action: "buy", targetPct: 0.05, thesis: THESIS }],
    { nav: 100000, peakNav: 100000, dayStartNav: 100000, positions: {}, shortingPermitted: false }, inst);

  const dr = gate("DEAD");
  assert.deepEqual(dr.allowed, [], "it is now REJECTED");
  assert.equal(dr.rejected[0].code, "stale_quote");
  assert.match(dr.rejected[0].detail, /no bar in the decision session/);

  // And the fix is not a blanket refusal: the live name passes, which is the half that was broken.
  assert.deepEqual(gate("ALIVE").allowed.map((a) => a.symbol), ["ALIVE"]);
  assert.deepEqual(gate("ALIVE").rejected, []);
});

// ---- correctly handled: these are refusals, not defects -------------------------------------------

test("a late start cannot be ranked, so it is counted but kept off the slate", () => {
  const series = { AAA: ramp(DATES), LATE: ramp(DATES.slice(-30), 10, 0.003) };
  const ctx = buildContext({ series, dates: DATES, asOf: ASOF });
  assert.equal(ctx.universe.total, 2, "it is counted in the universe");
  assert.ok(!ctx.candidates.some((c) => c.symbol === "LATE"),
    "but it is not a candidate: leading grid zeros make momentum null, so it is not rankable");
  assert.equal(ctx.universe.shown, 1);
});

test("interior missing dates forward-fill: no look-ahead, but the lookback spans more calendar", () => {
  const full = ramp(DATES);
  const gappy = full.filter((_, i) => !(i >= 200 && i < 250));         // 50 interior sessions absent
  const ctx = buildContext({ series: { AAA: full, GAP: gappy }, dates: DATES, asOf: ASOF });
  const by = Object.fromEntries(ctx.candidates.map((c) => [c.symbol, c]));
  assert.ok(by.GAP, "the gappy name is still a candidate");
  assert.notEqual(by.GAP.ret63d, by.AAA.ret63d,
    "its 63-INDEX return covers more than 63 trading sessions of real price history");
  // medianDollarVolume reads the symbol's OWN bars, not the grid, so it spans a longer window still.
  assert.equal(by.GAP.medianDollarVolume, by.AAA.medianDollarVolume,
    "and its volume window is its own last 63 bars, whatever calendar they cover");
  assert.deepEqual(contextIsPointInTime(ctx, ASOF_TIME), []);
});

// ---- calendar and coverage accounting -------------------------------------------------------------

test("a session missing for EVERY symbol disappears from the panel's own date union", () => {
  // Structural, not a named holiday: one weekday for which no symbol has a bar.
  const full = grid(20);
  const missingIdx = 10;
  const observed = full.filter((_, i) => i !== missingIdx);
  assert.equal(observed.length, 19);
  assert.ok(!observed.includes(full[missingIdx]), "the date is simply not in the union");
  // Each helper resolves it differently, and none of them flags it.
  const wk = sessionWeekdays(observed);
  assert.deepEqual([...wk].sort(), [1, 2, 3, 4, 5], "the weekday SET is unchanged, so nothing looks odd");
  // missedSessions counts weekdays, so it treats the absent day as a session that was missed.
  const upTo = observed.filter((t) => t < full[missingIdx]);
  assert.equal(missedSessions(upTo.at(-1), full[missingIdx + 1] * 1000, wk), 1,
    "a panel-wide absence reads as one completed session behind");
});

test("the accounting keeps a no-bar weekday visible as UNKNOWN instead of resolving it", () => {
  const full = grid(20);
  const missingIdx = 10;
  const observed = full.filter((_, i) => i !== missingIdx);
  // Decisions on every observed session except one, where the runner simply did not fire.
  const decided = observed.filter((_, i) => i !== 3);
  const decisions = decided.map((t, i) => ({ batchId: `b${i}`, asOfTime: t }));
  const skips = [];
  const acc = calendarAccounting({ panelDates: observed, decisions, skips, holdDays: 5 });

  assert.equal(acc.expectedMarketSessions, null,
    "expected market sessions stay UNKNOWN: no exchange calendar is reachable");
  assert.equal(acc.observedPanelSessions, 19);
  assert.equal(acc.successfulDecisions, 18);
  assert.equal(acc.operationalAttempts, 18, "no skips in this fixture");
  assert.equal(acc.statisticalPeriods, Math.ceil(18 / 5));

  // The three-way weekday split, with the absence counted and NOT resolved.
  assert.equal(acc.unknownNoBar.length, 1, "the panel-wide absence is counted, not dropped");
  assert.equal(acc.operationalGap.length, 1, "and the session the runner skipped is counted separately");
  assert.equal(acc.covered, 18);
  assert.equal(acc.weekdaysInSpan, acc.covered + acc.operationalGap.length + acc.unknownNoBar.length);
  // The two failure modes must not be merged: one is a data question, one is an operational one.
  assert.notDeepEqual(acc.unknownNoBar, acc.operationalGap);
});

test("a skip counts as an operational ATTEMPT while not being a successful decision", () => {
  const full = grid(10);
  const decisions = full.slice(0, 8).map((t, i) => ({ batchId: `b${i}`, asOfTime: t }));
  const skips = [{ at: new Date(full[8] * 1000).toISOString(), reason: "panel_stale" }];
  const acc = calendarAccounting({ panelDates: full, decisions, skips, holdDays: 5 });
  assert.equal(acc.successfulDecisions, 8);
  assert.equal(acc.operationalAttempts, 9, "the refused session is an attempt, which criterion 1 omits");
  assert.equal(acc.operationalGap.length, 2, "two weekdays have a bar and no decision");
  assert.equal(acc.unknownNoBar.length, 0, "and nothing here is a data question");
});

test("decision RECORDS and successful decision SESSIONS are different counts", () => {
  // Section 8.1's rerun, in the accounting: two records on one session.
  const full = grid(6);
  const decisions = [
    ...full.map((t, i) => ({ batchId: `b${i}`, asOfTime: t })),
    { batchId: "b0", asOfTime: full[0] },                 // the same session, run again
  ];
  const acc = calendarAccounting({ panelDates: full, decisions, skips: [], holdDays: 5 });
  assert.equal(acc.decisionRecords, 7);
  assert.equal(acc.successfulDecisions, 6, "sessions, not records");
  assert.equal(acc.statisticalPeriods, 2, "and periods come from sessions");
});
