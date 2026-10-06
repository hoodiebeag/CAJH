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
import {
  duenessByCalendar, freshnessInformation, expectedSessions, reconcileSessions, NYSE_2026_2028,
} from "./panel-freshness.mjs";
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

// =================================================================================================
// A3 — the preferred fail-closed daily-session proposal, as a contract
// =================================================================================================

test("A3 REJECTS option (ii): the decision-bar reference makes the check measure nothing", () => {
  // Setting referenceMs = asOfTime*1000 in paper mode too (what the dry run does) gives every symbol
  // an age of exactly 0 -- a live name and one that stopped trading 19 sessions ago are identical.
  const dates = sessionGrid("2026-10-01", 300);
  const series = {
    FRESH: dates.map((t, i) => ({ time: t, close: 100 * 1.002 ** i, volume: 1e6 })),
    STALE: dates.slice(0, 281).map((t, i) => ({ time: t, close: 20 * 1.001 ** i, volume: 1e6 })),
  };
  const ctx = buildContext({ series, dates, asOf: dates.length - 1,
    sectors: { FRESH: "Tech", STALE: "Energy" } });
  const inst = instrumentsFromContext(ctx, series, dates.at(-1), dates.at(-1) * 1000);
  assert.equal(inst.FRESH.quoteAgeMs, 0);
  assert.equal(inst.STALE.quoteAgeMs, 0, "the dead name reads EXACTLY as fresh as the live one");
  assert.deepEqual(gateOn(inst, "STALE").allowed.map((a) => a.symbol), ["STALE"],
    "so a 19-session-stale symbol is allowed — the check has stopped measuring anything");
});

test("A3 REJECTS option (iii): no millisecond threshold can separate the cases", () => {
  // The unit is wrong, not the value. Calendar time per session varies, so the longest LEGITIMATE gap
  // between consecutive expected sessions exceeds the age of a symbol that is genuinely one session
  // stale after an ordinary weekend. Computed from the grounded calendar, not asserted.
  let worst = 0, worstPair = null;
  for (const y of [2026, 2027, 2028]) {
    const s = expectedSessions({ from: e(`${y}-01-01`), to: e(`${y}-12-31`) }).sessions;
    for (let i = 1; i < s.length; i++) {
      const h = (s[i] - s[i - 1]) / 3600;
      if (h > worst) { worst = h; worstPair = [iso(s[i - 1]), iso(s[i])]; }
    }
  }
  assert.equal(worst, 96, `longest legitimate gap is 96h, at ${worstPair?.join(" -> ")}`);
  const oneSessionStaleAfterAWeekend = 72;      // Friday bar, Monday session
  assert.ok(oneSessionStaleAfterAWeekend < worst,
    "a genuinely stale symbol can be YOUNGER than a legitimately fresh one, so no single threshold works");
});

test("A3 PREFERRED: a missing bar must reject, and a missing quoteAgeMs currently FAILS OPEN", () => {
  // The hazard any proposal must avoid. risk.mjs:221 guards with isFiniteNum(inst.quoteAgeMs), so a
  // quote age that is absent, null or NaN SKIPS the staleness check entirely and the proposal is
  // allowed. Simply nulling the field for daily bars would therefore DISABLE the gate, not fix it.
  const base = { class: "usEquity", sector: "Tech", price: 100, medianDollarVolume: 1e9 };
  for (const absent of [undefined, null, NaN]) {
    const r = gateOn({ AAA: { ...base, quoteAgeMs: absent } }, "AAA");
    assert.deepEqual(r.allowed.map((a) => a.symbol), ["AAA"],
      `quoteAgeMs ${String(absent)} currently skips the staleness check`);
  }
  // And the threshold itself still works when a real figure is present, so it is not the broken part.
  assert.deepEqual(gateOn({ AAA: { ...base, quoteAgeMs: 14 * 60000 } }, "AAA").allowed.length, 1);
  assert.equal(gateOn({ AAA: { ...base, quoteAgeMs: 16 * 60000 } }, "AAA").rejected[0].code, "stale_quote");
});

test("A3 PREFERRED: the two halves are complementary, not alternatives", () => {
  // Option (i) alone -- a per-symbol session rule -- cannot see a stale PANEL, because
  // sessionsSinceLastBar is measured against the panel's own newest session. Option (iv) alone -- a
  // panel-level rule -- cannot see a dead symbol inside a fresh panel. The preferred proposal needs both.
  const dates = sessionGrid("2026-10-01", 300);
  const uniformlyStale = Object.fromEntries(["AAA", "BBB"].map((s) =>
    [s, dates.map((t, i) => ({ time: t, close: 100 * 1.001 ** i, volume: 1e6 }))]));
  // Read a week later: every symbol still has a bar at the panel's newest session, so all read 0.
  const f = freshnessInformation({ series: uniformlyStale, dates, asOf: dates.length - 1,
    now: Date.parse("2026-10-09T14:00:00Z") });
  for (const s of f.symbols) {
    assert.equal(s.sessionsSinceLastBar, 0, "a uniformly stale panel looks perfectly fresh per symbol");
    assert.ok(s.barTimestampAgeMs > 7 * 24 * 3600 * 1000, "while the panel itself is over a week old");
  }
  // The panel-level half is what catches it, and it is a session-coverage question.
  const rec = reconcileSessions({ observed: dates.filter((t) => t >= e("2026-01-01")) });
  assert.equal(rec.supported, true);
  assert.equal(rec.missingExpected.length, 0, "the panel is internally complete up to its last bar");
  // The expected session AFTER the panel's end is what is missing, which is a different query.
  const through = reconcileSessions({ observed: dates.filter((t) => t >= e("2026-01-01")),
    from: e("2026-01-02"), to: e("2026-10-08") });
  assert.ok(through.missingExpected.length >= 4,
    "extending the window to the run date exposes the uncovered sessions");
});

// =================================================================================================
// Rehearsal safety
// =================================================================================================

test("REHEARSAL SAFETY: no SDK, no key, no broker, no CLI in the import graph", async () => {
  const fs2 = await import("node:fs");
  const path2 = await import("node:path");
  const root = path2.dirname(new URL(import.meta.url).pathname);
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file) || !fs2.existsSync(file)) return;
    seen.add(file);
    const src = fs2.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*import\s[^"']*["'](\.[^"']+)["']/gm)) {
      walk(path2.resolve(path2.dirname(file), m[1]));
    }
    for (const m of src.matchAll(/\bimport\(\s*["'](\.[^"']+)["']/g)) {
      walk(path2.resolve(path2.dirname(file), m[1]));
    }
  };
  walk(path2.join(root, "rehearsal.mjs"));
  const names = [...seen].map((f) => path2.basename(f));
  assert.ok(names.includes("rehearsal.mjs"));
  for (const forbidden of ["analyst-run.mjs", "trader.mjs", "ibkr-bars.mjs", "ibkr-collect.mjs", "ibkr-panel.mjs"]) {
    assert.ok(!names.includes(forbidden), `must not reach ${forbidden}; graph: ${names.join(", ")}`);
  }
  const SDK = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'`]@anthropic-ai\//;
  for (const f of seen) {
    const src = fs2.readFileSync(f, "utf8");
    assert.ok(!SDK.test(src), `${path2.basename(f)} must not import the model SDK`);
    assert.ok(!/new\s+Anthropic\s*\(/.test(src), `${path2.basename(f)} must not construct a client`);
    assert.ok(!/ANTHROPIC_API_KEY/.test(src), `${path2.basename(f)} must not read the key`);
  }
  // And the lock is a CLI concern, so it must not be in the rehearsal's graph either.
  assert.ok(!names.includes("lock.mjs"), "the journal lock belongs to the CLI, not to this rehearsal");
});

test("REHEARSAL SAFETY: it writes only to a temp path and leaves the real journal alone", async () => {
  const fs2 = await import("node:fs");
  const crypto2 = await import("node:crypto");
  const { DEFAULT_JOURNAL } = await import("./analyst/journal.mjs");
  const fp = () => (fs2.existsSync(DEFAULT_JOURNAL)
    ? crypto2.createHash("sha256").update(fs2.readFileSync(DEFAULT_JOURNAL)).digest("hex") : "ABSENT");
  const before = fp();
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["rehearsal.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(fp(), before, "the real journal must be byte-identical after the rehearsal");
  assert.match(out, /unchanged: true/, "and the rehearsal must say so itself");
  assert.match(out, /no CLI launched, no model client constructed/);
  assert.match(out, /NOTHING WAS FIXED/);
  // The cascade the rehearsal exists to show: the gate rejects, so the book is empty downstream.
  assert.match(out, /allowed 0\/2; rejected: stale_quote/);
  assert.ok(!/analyst-journal\.jsonl.*fingerprint after: (?!ABSENT)/.test(out) || before !== "ABSENT");
});
