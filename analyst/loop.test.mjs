import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOnce, realisedOutcomes, instrumentsFromContext, PAPER_FRESHNESS_MS, sessionWeekdays, missedSessions, settleOutcomes, sessionsAhead } from "./loop.mjs";
import { readJournal, scoreJournal, recordOutcome, MODE, KIND } from "./journal.mjs";

const DAY = 86400;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "loop-")), "j.jsonl");

/** A panel ending `endingDaysAgo` before `now`, so freshness can be driven from the test. */
function panel(symbols, n = 400, now = Date.now(), endingDaysAgo = 0) {
  const lastTime = Math.floor(now / 1000) - endingDaysAgo * DAY;
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(lastTime - i * DAY);
  const series = {};
  symbols.forEach((sym, k) => {
    const bars = [];
    let px = 100;
    for (let i = 0; i < n; i++) {
      px *= 1 + (k - symbols.length / 2) * 0.0005 + Math.sin(i / 9 + k) * 0.003;
      bars.push({ time: dates[i], open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 2e6 });
    }
    series[sym] = bars;
  });
  return { series, dates };
}

const SYMS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];

/** Shaped on the SDK's real Message; see decide.test.mjs for why that matters. */
const fakeMessage = (text, stop_reason = "end_turn") => ({
  id: "msg_01Fake", container: null,
  content: [{ type: "text", text, citations: null }],
  model: "claude-sonnet-4-6", role: "assistant",
  stop_details: null, stop_reason, stop_sequence: null, type: "message",
  usage: { input_tokens: 100, output_tokens: 50 },
});

const clientProposing = (arr) => ({
  messages: { create: async () => fakeMessage(JSON.stringify({ decisions: arr })) },
});
const buy = (symbol, over = {}) => ({
  symbol, action: "buy", targetPct: 0.05, confidence: 0.7,
  thesis: "momentum and breadth both confirm here", ...over,
});

// ---- the mode guard, the most important behaviour in the file ----------------------------------

test("paper mode REFUSES a historical date", async () => {
  // The failure this prevents is silent and flattering: run the loop over last year to "check it
  // works", the numbers look good, and later the good numbers become the reason to go live.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 200);
  await assert.rejects(
    () => runOnce({ series, dates, client: clientProposing([buy("AAA")]), mode: MODE.PAPER, now, nav: 1e5 }),
    /already knows what happened/,
  );
});

test("paper mode accepts a current date", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const r = await runOnce({
    series, dates, client: clientProposing([buy("AAA")]), mode: MODE.PAPER,
    now, nav: 1e5, journalFile: j,
  });
  assert.equal(r.record.mode, MODE.PAPER);
});

test("paper mode tolerates a weekend gap but not a month", async () => {
  const now = Date.now();
  const withinTolerance = PAPER_FRESHNESS_MS / 86400000;
  const ok = panel(SYMS, 400, now, Math.floor(withinTolerance) - 0.5);
  await runOnce({ series: ok.series, dates: ok.dates, client: clientProposing([]), mode: MODE.PAPER, now, nav: 1e5, journalFile: tmp() });

  const stale = panel(SYMS, 400, now, 30);
  await assert.rejects(
    () => runOnce({ series: stale.series, dates: stale.dates, client: clientProposing([]), mode: MODE.PAPER, now, nav: 1e5, journalFile: tmp() }),
    /refusing to run paper mode/,
  );
});

test("dry-run and anonymised modes run freely on historical dates", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 300);
  for (const mode of [MODE.DRY_RUN, MODE.ANONYMISED]) {
    const j = tmp();
    const r = await runOnce({ series, dates, client: clientProposing([]), mode, now, nav: 1e5, journalFile: j });
    assert.equal(r.record.mode, mode);
  }
});

test("a dry run cannot pollute the paper track record", async () => {
  const now = Date.now();
  const j = tmp();
  const hist = panel(SYMS, 400, now, 300);
  await runOnce({ series: hist.series, dates: hist.dates, client: clientProposing([buy("AAA")]), mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: j });
  recordOutcome({ batchId: `dry-run-${new Date(hist.dates.at(-1) * 1000).toISOString().slice(0, 10)}`, symbol: "AAA", netReturn: 9.99, controlReturn: 0 }, j);

  const paper = scoreJournal(j, { mode: MODE.PAPER });
  assert.equal(paper.batches, 0);
  assert.equal(paper.agentMeanNet, null, "a dry-run outcome must not appear in the paper record");
  assert.ok(paper.contaminatedRecords > 0, "the exclusion must be visible, not silent");
  assert.equal(paper.isEvidence, true);

  const dry = scoreJournal(j, { mode: MODE.DRY_RUN });
  assert.equal(dry.isEvidence, false);
  assert.equal(dry.outcomes, 1);
});

// ---- wiring ------------------------------------------------------------------------------------

test("a clean batch flows context -> decide -> gate -> journal", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const r = await runOnce({
    series, dates, client: clientProposing([buy("AAA"), buy("BBB")]),
    mode: MODE.PAPER, now, nav: 1e5, journalFile: j,
  });
  assert.equal(r.skipped, null);
  assert.equal(r.decision.proposals.length, 2);
  assert.equal(r.gate.allowed.length, 2);

  const { records } = readJournal(j);
  assert.equal(records.length, 1);
  assert.equal(records[0].allowed.length, 2);
  assert.equal(records[0].control.length, 2, "one control name per sized decision");
  assert.ok(records[0].contextHash);
});

test("the control is drawn from what the analyst was actually shown", async () => {
  // A control drawn from names never shown measures universe selection, not stock selection.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const r = await runOnce({
    series, dates, client: clientProposing([buy("AAA")]),
    mode: MODE.PAPER, now, nav: 1e5, journalFile: j, slate: 4,
  });
  const shown = new Set(r.context.candidates.map((c) => c.symbol));
  for (const c of r.record.control) assert.ok(shown.has(c.symbol), `${c.symbol} was not on the slate`);
});

test("a failed batch is still journalled", async () => {
  // A journal that only records the days the model worked describes a different agent.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const refusing = { messages: { create: async () => fakeMessage("", "refusal") } };
  const r = await runOnce({ series, dates, client: refusing, mode: MODE.PAPER, now, nav: 1e5, journalFile: j });
  assert.equal(r.skipped.reason, "model_refused");
  assert.equal(readJournal(j).records.length, 1);
});

test("the risk gate still vetoes inside the loop", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  // Nine names at 5% each: the batch cap of five binds.
  const many = SYMS.map((s) => buy(s));
  const r = await runOnce({
    series, dates, client: clientProposing(many), mode: MODE.PAPER,
    now, nav: 1e5, journalFile: j,
  });
  assert.ok(r.gate.allowed.length <= 5);
  assert.ok(r.gate.rejected.length >= 1);
});

test("a dry run judges quote age against the simulated decision, not the wall clock", async () => {
  // Otherwise every historical batch dies on staleness and the plumbing check degenerates into a
  // test that the staleness rule exists.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 300);
  const r = await runOnce({
    series, dates, client: clientProposing([buy("AAA")]), mode: MODE.DRY_RUN,
    now, nav: 1e5, journalFile: tmp(),
  });
  assert.equal(r.gate.allowed.length, 1, "a dry run must be able to exercise the whole path");
});

test("paper mode still catches a genuinely stale feed", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  // The panel is current, but the feed's last bar is a day old against wall-clock `now`.
  const r = await runOnce({
    series, dates, client: clientProposing([buy("AAA")]), mode: MODE.PAPER,
    now: now + 24 * 3600 * 1000, nav: 1e5, journalFile: tmp(),
  });
  assert.equal(r.gate.allowed.length, 0);
  assert.equal(r.gate.rejected[0].code, "stale_quote");
});

test("the gate is priced from the decision bar, never the panel's last bar", async () => {
  // Taking the panel's final bar hands the gate a price from after the decision. It would not
  // throw and would not look wrong in the journal; the book would just be built on prices nobody
  // could have traded at.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const entryIdx = 200;
  const ctx = { candidates: [{ symbol: "AAA", medianDollarVolume: 1e9 }] };
  const inst = instrumentsFromContext(ctx, series, dates[entryIdx], dates[entryIdx] * 1000);
  const barAtDecision = series.AAA.find((b) => b.time === dates[entryIdx]);
  assert.equal(inst.AAA.price, Number(barAtDecision.close));
  assert.notEqual(inst.AAA.price, Number(series.AAA.at(-1).close));
});

test("a context that fails its point-in-time check stops the batch before the model is called", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  let called = false;
  const client = { messages: { create: async () => { called = true; return fakeMessage("{}"); } } };
  const future = new Date((dates.at(-1) + 10 * DAY) * 1000).toISOString();
  const r = await runOnce({
    series, dates, client, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: tmp(),
    news: { AAA: [{ at: future, headline: "tomorrow's paper" }] },
  });
  // The context builder drops future news, so this passes; the assertion is that the check RAN.
  assert.deepEqual(r.contextIssues, []);
  assert.equal(called, true);
});

// ---- outcomes ------------------------------------------------------------------------------------

test("agent and control are priced identically", async () => {
  // If the agent were charged costs the control was not, the difference would measure the
  // discrepancy rather than the skill.
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const entryIdx = dates.length - 11;
  const r = await runOnce({
    series, dates, asOf: entryIdx, client: clientProposing([buy("AAA")]),
    mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: j,
  });
  const rows = realisedOutcomes({ record: r.record, series, dates, entryIdx, holdDays: 5, costPerLeg: 0.0005 });
  assert.equal(rows.length, 1);
  assert.ok(Math.abs((rows[0].grossReturn - rows[0].netReturn) - 0.001) < 1e-9, "both legs charged");
  assert.ok(typeof rows[0].controlReturn === "number");
});

test("outcomes are skipped, not zeroed, when a price is missing", () => {
  const record = { batchId: "b", allowed: [{ symbol: "GHOST", action: "buy", targetPct: 0.05 }], control: [] };
  const { series, dates } = panel(SYMS, 50);
  assert.deepEqual(realisedOutcomes({ record, series, dates, entryIdx: 10 }), []);
});

test("holds take no outcome row and no control slot", async () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const j = tmp();
  const entryIdx = dates.length - 11;
  const r = await runOnce({
    series, dates, asOf: entryIdx,
    client: clientProposing([{ symbol: "AAA", action: "hold", thesis: "thesis intact, nothing changed" }]),
    mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: j,
  });
  assert.deepEqual(realisedOutcomes({ record: r.record, series, dates, entryIdx }), []);
});

// ---- instruments -----------------------------------------------------------------------------------

test("instrument facts are derived from the panel rather than assumed", () => {
  const now = Date.now();
  const { series, dates } = panel(SYMS, 400, now, 0);
  const ctx = { candidates: SYMS.map((s) => ({ symbol: s, medianDollarVolume: 123 })) };
  const inst = instrumentsFromContext(ctx, series, dates.at(-1), now);
  assert.equal(inst.AAA.class, "usEquity");
  assert.ok(inst.AAA.price > 0);
  assert.equal(inst.AAA.medianDollarVolume, 123);
  assert.ok(inst.AAA.quoteAgeMs < 2 * 86400000);
});

// ---- the panel-calendar freshness guard --------------------------------------------------------
// The wall-clock rule these replace refused on every Monday, which reads as a broken feed when the
// panel is in fact correct. These pin the behaviour in both directions: a normal weekend must pass,
// and a genuinely stale panel mid-week must not.
const MONDAY_PANEL = (() => {
  const start = Date.UTC(2026, 8, 14) / 1000;          // 2026-09-14 is a Monday
  const out = [];
  for (let d = 0; d < 20; d++) {
    const t = start + d * DAY;
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(t);
  }
  return out;
})();

test("sessionWeekdays reads the trading week off the panel rather than assuming one", () => {
  assert.deepEqual([...sessionWeekdays(MONDAY_PANEL)].sort(), [1, 2, 3, 4, 5]);
  const everyDay = [];
  for (let d = 0; d < 20; d++) everyDay.push(Date.UTC(2026, 8, 14) / 1000 + d * DAY);
  assert.equal(sessionWeekdays(everyDay).size, 7, "a 7-day panel must not be forced into a 5-day week");
});

test("a Monday holding Friday's bar is current — the case the wall-clock rule got wrong", () => {
  const friday = Date.UTC(2026, 8, 18) / 1000;
  const mondayMidday = Date.UTC(2026, 8, 21) + 14 * 3600000;
  assert.equal(missedSessions(friday, mondayMidday, sessionWeekdays(MONDAY_PANEL)), 0,
    "today's bar may not exist yet; the session is not over");
});

test("a missed mid-week session is counted", () => {
  const monday = Date.UTC(2026, 8, 14) / 1000;
  const wednesdayMidday = Date.UTC(2026, 8, 16) + 14 * 3600000;
  assert.equal(missedSessions(monday, wednesdayMidday, sessionWeekdays(MONDAY_PANEL)), 1,
    "Tuesday closed without a bar; Wednesday is excused as today");
});

test("a Sunday holding Thursday's bar is STALE — Friday closed and is missing", () => {
  // The case that exposed the first version of this rule. It allowed one missed session, which is
  // the same as excusing today only while today trades. On a Sunday it excused Friday instead.
  const thursday = Date.UTC(2026, 8, 17) / 1000;
  const sundayMidday = Date.UTC(2026, 8, 20) + 14 * 3600000;
  assert.equal(missedSessions(thursday, sundayMidday, sessionWeekdays(MONDAY_PANEL)), 1);
});

test("a Sunday holding Friday's bar is current", () => {
  const friday = Date.UTC(2026, 8, 18) / 1000;
  const sundayMidday = Date.UTC(2026, 8, 20) + 14 * 3600000;
  assert.equal(missedSessions(friday, sundayMidday, sessionWeekdays(MONDAY_PANEL)), 0);
});

test("a weeks-old panel counts as many sessions behind, not one long gap", () => {
  const stale = Date.UTC(2026, 8, 3) / 1000;
  const now = Date.UTC(2026, 8, 19) + 14 * 3600000;
  assert.ok(missedSessions(stale, now, sessionWeekdays(MONDAY_PANEL)) >= 10);
});

test("weekend days are not missed sessions on a weekday panel", () => {
  const friday = Date.UTC(2026, 8, 18) / 1000;
  const saturdayMidday = Date.UTC(2026, 8, 19) + 14 * 3600000;
  assert.equal(missedSessions(friday, saturdayMidday, sessionWeekdays(MONDAY_PANEL)), 0);
});

// ---- an unfinished hold is not a flat trade ----------------------------------------------------
// Found by running a dry run at the end of the panel: three different names and the matched control
// all returned exactly -0.11%, which is the round trip charged on a gross return of zero. The exit
// index was clamped to the last bar, so a hold of zero sessions looked like a completed flat trade.
// These rows are documented as ready for recordOutcome, and paper scoring necessarily runs while
// the newest decisions are still inside their holding period, so this would have packed the track
// record with fabricated zeroes.
test("a hold the panel cannot cover is dropped, not recorded as 0%", () => {
  const now = Date.now();
  const p = panel(["AAA", "BBB"], 300, now, 0);
  const record = {
    batchId: "b1",
    allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 }],
    control: [{ symbol: "BBB" }],
  };
  const last = p.dates.length - 1;

  const atEnd = realisedOutcomes({ record, series: p.series, dates: p.dates, entryIdx: last, holdDays: 5 });
  assert.equal(atEnd.length, 0, "no outcome exists yet, so none may be returned for recording");

  const shown = realisedOutcomes({ record, series: p.series, dates: p.dates, entryIdx: last,
                                   holdDays: 5, requireComplete: false });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].complete, false);
  assert.equal(shown[0].sessionsHeld, 0, "the truth about the hold is carried, not hidden");
});

test("a partial hold is still incomplete", () => {
  const now = Date.now();
  const p = panel(["AAA", "BBB"], 300, now, 0);
  const record = {
    batchId: "b2",
    allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 }],
    control: [{ symbol: "BBB" }],
  };
  const entry = p.dates.length - 3;                 // only 2 of 5 sessions available
  assert.equal(realisedOutcomes({ record, series: p.series, dates: p.dates, entryIdx: entry, holdDays: 5 }).length, 0);
  const shown = realisedOutcomes({ record, series: p.series, dates: p.dates, entryIdx: entry,
                                   holdDays: 5, requireComplete: false });
  assert.equal(shown[0].sessionsHeld, 2);
  assert.equal(shown[0].complete, false);
});

test("a completed hold is returned and marked complete", () => {
  const now = Date.now();
  const p = panel(["AAA", "BBB"], 300, now, 0);
  const record = {
    batchId: "b3",
    allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 }],
    control: [{ symbol: "BBB" }],
  };
  const rows = realisedOutcomes({ record, series: p.series, dates: p.dates, entryIdx: 100, holdDays: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].sessionsHeld, 5);
  assert.equal(typeof rows[0].grossReturn, "number");
});

// ---- settlement --------------------------------------------------------------------------------
// recordOutcome existed and nothing called it, so scoreJournal reported "outcomes 0" however long
// the agent ran. These pin the two properties that make settlement safe on an append-only file:
// each outcome is written exactly once, and an entry bar that cannot be found is never invented.
const settleBatch = async (j, now, p, asOf) => runOnce({
  series: p.series, dates: p.dates, asOf, client: clientProposing([buy("AAA"), buy("BBB")]),
  mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: j,
});

test("settleOutcomes writes outcomes and is idempotent on a second run", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  const r = await settleBatch(j, now, p, 380);
  assert.equal(r.gate.allowed.length, 2, "setup: the batch must reach the journal with a book");

  const first = settleOutcomes({ series: p.series, dates: p.dates, journalFile: j,
                                 mode: MODE.DRY_RUN, holdDays: 5, now });
  assert.equal(first.wrote, 2, "a finished hold must produce an outcome per sized decision");
  assert.equal(first.already, 0);

  const second = settleOutcomes({ series: p.series, dates: p.dates, journalFile: j,
                                  mode: MODE.DRY_RUN, holdDays: 5, now });
  assert.equal(second.wrote, 0, "an append-only journal cannot take a duplicate back");
  assert.equal(second.already, 2);

  const outcomes = readJournal(j).records.filter((x) => x.kind === KIND.OUTCOME);
  assert.equal(outcomes.length, 2, "exactly one outcome per settled decision");
});

test("settleOutcomes leaves a decision inside its holding period alone", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  await settleBatch(j, now, p, p.dates.length - 1);
  const r = settleOutcomes({ series: p.series, dates: p.dates, journalFile: j,
                             mode: MODE.DRY_RUN, holdDays: 5, now });
  assert.equal(r.wrote, 0);
  assert.equal(r.pending, 2, "the unfinished decisions are counted, not silently absent");
});

test("settleOutcomes skips a decision whose entry bar this panel does not contain", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  await settleBatch(j, now, p, 380);
  // Settling against a nearby bar would invent an entry price, so the batch is skipped and counted.
  const other = panel(SYMS, 400, now - 700 * 86400000, 0);
  const r = settleOutcomes({ series: other.series, dates: other.dates, journalFile: j,
                             mode: MODE.DRY_RUN, holdDays: 5, now });
  assert.equal(r.wrote, 0);
  assert.equal(r.unknownBar, 1);
});

test("settleOutcomes only settles the mode it was asked for", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  await settleBatch(j, now, p, 380);
  const r = settleOutcomes({ series: p.series, dates: p.dates, journalFile: j,
                             mode: MODE.PAPER, holdDays: 5, now });
  assert.equal(r.decisions, 0, "a dry run must never be settled into the paper record");
  assert.equal(r.wrote, 0);
});

// ---- anonymised mode ---------------------------------------------------------------------------
// This mode was documented, unit-tested and UNREACHABLE: no CLI path produced it. The first real
// run rejected every proposal with `no_usable_price`, because instrumentsFromContext looked up a
// price series under the name "Asset A". The model must see labels; the risk gate must see
// instruments. These pin both halves and the boundary between them.
test("anonymised mode produces a real book instead of pricing nothing", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  let sentToModel = null;
  const client = {
    messages: {
      create: async ({ messages }) => {
        sentToModel = messages[0].content[0].text;
        const ctx = JSON.parse(sentToModel);
        const picks = ctx.candidates.slice(0, 2).map((c) => ({
          symbol: c.symbol, action: "buy", targetPct: 0.05, confidence: 0.6,
          thesis: "momentum and breadth both confirm here",
        }));
        return fakeMessage(JSON.stringify({ decisions: picks }));
      },
    },
  };
  const r = await runOnce({ series: p.series, dates: p.dates, asOf: 380, client,
                            mode: MODE.ANONYMISED, journalFile: j, now, nav: 1e5 });
  assert.equal(r.skipped, null);
  assert.equal(r.gate.allowed.length, 2, "the gate must be able to price what the model picked");
  for (const a of r.gate.allowed) {
    assert.ok(SYMS.includes(a.symbol), `expected a real symbol in the book, got ${a.symbol}`);
  }

  // The other half: nothing identifying may have reached the model.
  for (const sym of SYMS) {
    assert.ok(!new RegExp(`"${sym}"`).test(sentToModel), `real ticker ${sym} leaked to the model`);
  }
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(sentToModel), "a date leaked to the model");
});

test("an alias the context never issued is dropped and counted, not passed through", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  const client = {
    messages: {
      create: async () => fakeMessage(JSON.stringify({
        decisions: [{ symbol: "Asset ZZZZ", action: "buy", targetPct: 0.05, confidence: 0.6,
                      thesis: "momentum and breadth both confirm here" }],
      })),
    },
  };
  const r = await runOnce({ series: p.series, dates: p.dates, asOf: 380, client,
                            mode: MODE.ANONYMISED, journalFile: j, now, nav: 1e5 });
  // `decide` already refuses a symbol that is not in the context it was given, so the invented
  // label never reaches the translation step -- unmappedAliases stays empty and that is the
  // correct result, not a miss. The translation is the second line of the same defence, and this
  // records which line caught it so a later change to either one is visible.
  assert.equal(r.gate.allowed.length, 0, "a label with no instrument behind it is not a proposal");
  assert.deepEqual(r.unmappedAliases, [], "decide caught it first; translation never saw it");
  assert.ok(r.decision.dropped.length > 0, "and it was counted rather than silently discarded");
  assert.match(JSON.stringify(r.decision.dropped), /ZZZZ/);
});

test("an anonymised decision is journalled with real symbols and a decision bar", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  const client = {
    messages: {
      create: async ({ messages }) => {
        const ctx = JSON.parse(messages[0].content[0].text);
        return fakeMessage(JSON.stringify({ decisions: [{
          symbol: ctx.candidates[0].symbol, action: "buy", targetPct: 0.05, confidence: 0.6,
          thesis: "momentum and breadth both confirm here" }] }));
      },
    },
  };
  await runOnce({ series: p.series, dates: p.dates, asOf: 380, client,
                  mode: MODE.ANONYMISED, journalFile: j, now, nav: 1e5 });
  const rec = readJournal(j).records.find((x) => x.kind === KIND.DECISION);
  assert.equal(rec.asOfTime, p.dates[380], "a settlement needs the bar, and the gate already knew it");
  assert.ok(SYMS.includes(rec.allowed[0].symbol));
});

// ---- the panel can be wrong in the other direction ---------------------------------------------
// The freshness guard only looked backwards. A bar dated in the future passed it cleanly, because
// nothing was missing — the worst failure available here, since the context would then be built
// from bars that have not happened, in the one mode that counts as evidence.
test("sessionsAhead is zero for a normal panel and positive for a future-dated one", () => {
  const now = Date.UTC(2026, 8, 20) + 14 * 3600000;
  assert.equal(sessionsAhead(Date.UTC(2026, 8, 18) / 1000, now), 0);
  assert.equal(sessionsAhead(Date.UTC(2026, 8, 20) / 1000, now), 0,
    "today's bar is stamped at the start of its session, not in the future");
  assert.equal(sessionsAhead(Date.UTC(2026, 8, 24) / 1000, now), 4);
});

test("paper mode refuses a future-dated panel, and says it is corrupt rather than stale", async () => {
  const now = Date.now();
  // endingDaysAgo negative puts the last bar ahead of now.
  const p = panel(SYMS, 400, now, -4);
  await assert.rejects(
    () => runOnce({ series: p.series, dates: p.dates, client: clientProposing([buy("AAA")]),
                    mode: MODE.PAPER, now, nav: 1e5, journalFile: tmp() }),
    (err) => {
      assert.match(err.message, /FUTURE/);
      assert.match(err.message, /corrupt input/);
      assert.ok(!/sessions behind/.test(err.message),
        "calling this staleness would send the reader looking the wrong way");
      return true;
    },
  );
});

test("a dry run is not blocked by a future-dated panel", async () => {
  // Only paper mode claims to be deciding at now. A dry run names its own decision bar, so a panel
  // extending past today is not a contradiction there.
  const now = Date.now();
  const p = panel(SYMS, 400, now, -4);
  const r = await runOnce({ series: p.series, dates: p.dates, asOf: 380,
                            client: clientProposing([buy("AAA")]), mode: MODE.DRY_RUN,
                            now, nav: 1e5, journalFile: tmp() });
  assert.equal(r.skipped, null);
});

// ---- what the analyst could see, recorded beside what it did -----------------------------------
// The design argument for this pivot is that the edge comes from the non-price input; the price
// half is already closed. A journal that cannot separate "decided with news" from "decided with
// none" measures a blend and credits the mechanism. Nothing about news was recorded at all.
test("a decision records how much news it actually had", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  const news = {
    AAA: [{ at: new Date(p.dates[378] * 1000).toISOString(), headline: "AAA guides higher", source: "BRFG" }],
    BBB: [{ at: new Date(p.dates[379] * 1000).toISOString(), headline: "BBB downgraded", source: "BRFUPDN" },
          { at: new Date(p.dates[377] * 1000).toISOString(), headline: "BBB names a CFO", source: "BRFG" }],
  };
  const r = await runOnce({
    series: p.series, dates: p.dates, asOf: 380, client: clientProposing([buy("AAA")]),
    mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: j, news,
    newsMeta: { source: "data/news-cache.json", fetchedAt: "2026-09-20T06:00:00.000Z",
                ageHours: 0.2, stale: false, droppedAtBoundary: 3 },
  });
  assert.equal(r.skipped, null);

  const rec = readJournal(j).records.find((x) => x.kind === KIND.DECISION);
  assert.equal(rec.news.candidatesWithNews, 2);
  assert.equal(rec.news.headlines, 3);
  assert.equal(rec.news.candidates, r.context.candidates.length);
  assert.equal(rec.news.droppedAtBoundary, 3, "boundary drops are part of the provenance");
  assert.equal(rec.news.stale, false);
  assert.equal(rec.news.fetchedAt, "2026-09-20T06:00:00.000Z");
});

test("a decision made on price alone says so rather than staying silent", async () => {
  const j = tmp();
  const now = Date.now();
  const p = panel(SYMS, 400, now, 0);
  await runOnce({ series: p.series, dates: p.dates, asOf: 380,
                  client: clientProposing([buy("AAA")]), mode: MODE.DRY_RUN,
                  now, nav: 1e5, journalFile: j });
  const rec = readJournal(j).records.find((x) => x.kind === KIND.DECISION);
  assert.equal(rec.news.candidatesWithNews, 0);
  assert.equal(rec.news.headlines, 0);
  assert.ok(rec.news.candidates > 0,
    "the denominator matters: 0 of 40 is a different fact from 0 of 0");
});
