#!/usr/bin/env node
/**
 * analyst-run.mjs — the command line for the analyst.
 *
 * THREE SUBCOMMANDS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT:
 *
 *   settle    compute outcomes for decisions whose holding period has finished, and append them.
 *             Without this nothing ever calls recordOutcome, so `score` reads zero outcomes
 *             forever and the measurement instrument measures nothing. Idempotent: a decision
 *             already settled is skipped, never written twice.
 *   dry-run   exercise context -> decide -> risk -> journal on a historical date. Proves the
 *             plumbing works. NOT EVIDENCE OF ANYTHING ELSE, and recorded under its own mode so
 *             `score` cannot blend it into a track record.
 *   paper     one forward decision at today's date. The only mode that is evidence. Refuses to run
 *             on a stale panel, because a model asked about a past date already knows the answer.
 *   anonymised  the reasoning probe. Same path, identities stripped: no tickers, no dates, no
 *               sectors, no news. It answers "is the reasoning coherent on evidence alone?", which
 *               is the only question a historical run CAN answer honestly, because with identities
 *               present the model recalls what happened instead of reasoning. Recorded under its
 *               own mode and NEVER evidence of edge.
 *   score     print the journal readout: the analyst beside its own matched random control.
 *
 * THIS FILE CANNOT PLACE AN ORDER. It composes modules none of which can reach a venue.
 *
 * Usage:
 *   node analyst-run.mjs dry-run [--asOf N] [--slate 300] [--journal FILE] [--stub]
 *   node analyst-run.mjs paper   [--journal FILE]
 *   node analyst-run.mjs score   [--journal FILE] [--mode paper|dry-run|anonymised]
 */

import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { runOnce, realisedOutcomes, settleOutcomes, sessionWeekdays, missedSessions,
         sessionsAhead } from "./analyst/loop.mjs";
import { loadNewsCache, toNewsMap, assertNotAfter } from "./analyst/news.mjs";
import { scoreJournal, MODE, DEFAULT_JOURNAL } from "./analyst/journal.mjs";
import { COST_MODELS } from "./costs.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const JOURNAL = flag("journal", DEFAULT_JOURNAL);
const ROOT = flag("root", "sp500-bundle");
const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "—");

/**
 * A stub client, for proving the wiring without a key or a network.
 *
 * IT IS DELIBERATELY NOT AN ANALYST. It picks the top few names by whatever the slate was ranked
 * on and says so in its thesis. Anything cleverer would invite reading its output as a result,
 * which it is not and cannot be.
 */
function stubClient(n = 3) {
  return {
    messages: {
      create: async ({ messages }) => {
        const ctx = JSON.parse(messages[0].content[0].text);
        const picks = (ctx.candidates ?? []).filter((c) => !c.held).slice(0, n).map((c) => ({
          symbol: c.symbol, action: "buy", targetPct: 0.05, confidence: 0.5,
          thesis: `STUB CLIENT: mechanical top-of-slate pick by ${ctx.universe?.rankedBy}. Not analysis.`,
        }));
        return {
          id: "msg_stub", container: null,
          content: [{ type: "text", text: JSON.stringify({ decisions: picks }), citations: null }],
          model: "stub", role: "assistant", stop_details: null,
          stop_reason: "end_turn", stop_sequence: null, type: "message",
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      },
    },
  };
}

async function realClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function loadPanel() {
  const raw = {};
  for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
  const screened = screenUniverse(raw);
  for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);
  const times = new Set();
  for (const bars of Object.values(screened.kept)) for (const b of bars) times.add(Number(b.time));
  return { series: screened.kept, dates: [...times].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------------------------

if (cmd === "dry-run" || cmd === "paper" || cmd === "anonymised") {
  const mode = cmd === "paper" ? MODE.PAPER
             : cmd === "anonymised" ? MODE.ANONYMISED
             : MODE.DRY_RUN;
  const { series, dates } = loadPanel();
  console.log(`panel: ${Object.keys(series).length} symbols, ${dates.length} dates, ` +
              `last ${new Date(dates.at(-1) * 1000).toISOString().slice(0, 10)}`);

  // The staleness of the panel is reported BEFORE the key check. Otherwise a missing key is the
  // first error a user sees, and they conclude paper mode merely needs credentials when the real
  // blocker is that there is no current data to decide on.
  if (mode === MODE.PAPER) {
    const ahead = sessionsAhead(dates.at(-1), Date.now());
    if (ahead > 0) {
      console.error(`\npanel's last bar is dated ${new Date(dates.at(-1) * 1000).toISOString().slice(0, 10)}, ` +
                    `${ahead} day(s) in the FUTURE.`);
      console.error("That is corrupt input, not a stale panel — a timezone mis-parse, a wrong clock,");
      console.error("or a vendor stamping forward. Deciding on bars that have not happened is the");
      console.error("exact contamination paper mode exists to prevent. Fix the panel.");
      process.exit(3);
    }
    const missed = missedSessions(dates.at(-1), Date.now(), sessionWeekdays(dates));
    if (missed > 0) {
      console.error(`\npanel is ${missed} completed session(s) behind its own calendar (last bar ` +
                    `${new Date(dates.at(-1) * 1000).toISOString().slice(0, 10)}). Paper mode needs`);
      console.error("current data: a model asked what it would do on a past date already knows what");
      console.error("happened. Refresh the panel first — a key will not help:");
      console.error("  node scripts/ibkr-panel.mjs      (on a machine that can reach IB Gateway)");
      console.error("Use dry-run to exercise the wiring in the meantime.");
      process.exit(3);
    }
  }

  const client = has("stub") ? stubClient() : await realClient();
  if (!client) {
    console.error("no ANTHROPIC_API_KEY. Use --stub to exercise the wiring without a model.");
    process.exit(2);
  }
  if (has("stub") && mode === MODE.PAPER) {
    console.error("refusing --stub in paper mode: a stub's picks are not decisions and must never");
    console.error("enter the record that is read as evidence. Use dry-run.");
    process.exit(2);
  }
  if (has("stub") && mode === MODE.ANONYMISED) {
    console.log("note: --stub picks mechanically off the slate, so it probes the WIRING of this");
    console.log("mode and tells you nothing about reasoning, which is the only thing it is for.");
  }
  if (mode === MODE.ANONYMISED) {
    console.log("anonymised: tickers, dates, sectors and news are stripped before the model sees");
    console.log("anything; the risk gate still prices the real instruments behind the labels, and");
    console.log("proposals are translated back before the journal. So these ARE settleable — and");
    console.log("still NOT evidence of edge, because the anonymisation cannot be proven complete.");
  }

  const asOf = flag("asOf", null) === null ? dates.length - 1 : Number(flag("asOf"));

  // ---- news, from the cache rather than the wire ----------------------------------------------
  // Fetching live inside the decision would hand a replay TODAY'S news for YESTERDAY'S decision --
  // the exact contamination this design exists to prevent, arriving through a convenience. The
  // cache is a point-in-time record, and every headline is re-checked against the decision
  // boundary here even though context.mjs filters again. Two filters, because a provider stamping
  // articles forward is the failure that would look most like skill.
  let news = {};
  let newsMeta = { source: null, fetchedAt: null, ageHours: null, stale: null, droppedAtBoundary: 0 };
  const cache = loadNewsCache(flag("news", "data/news-cache.json"));
  if (cache) {
    const boundary = dates[asOf];
    const filtered = {}, dropCount = {};
    let totalDropped = 0;
    for (const [sym, headlines] of Object.entries(cache.headlines)) {
      const { kept, dropped } = assertNotAfter(headlines, boundary);
      filtered[sym] = kept;
      if (dropped.length) { dropCount[sym] = dropped.length; totalDropped += dropped.length; }
    }
    news = toNewsMap(filtered);
    newsMeta = {
      source: flag("news", "data/news-cache.json"),
      fetchedAt: cache.fetchedAt ?? null,
      ageHours: Number.isFinite(cache.ageMs) ? Math.round(cache.ageMs / 36000) / 100 : null,
      stale: !!cache.stale,
      droppedAtBoundary: totalDropped,
    };
    const withNews = Object.values(news).filter((v) => v.length).length;
    console.log(`news cache: fetched ${cache.fetchedAt}, ${withNews} symbol(s) with headlines` +
                `${cache.stale ? `  [STALE: ${(cache.ageMs / 3600000).toFixed(1)}h old]` : ""}`);
    if (totalDropped) {
      console.log(`  ${totalDropped} headline(s) dated at/after the decision were dropped: ` +
                  Object.entries(dropCount).map(([s, n]) => `${s}x${n}`).join(", "));
    }
  } else {
    console.log("no news cache; running on price and indicators alone.");
  }

  let r;
  try {
    r = await runOnce({
      series, dates, asOf, client, mode, journalFile: JOURNAL, news,
      nav: Number(flag("nav", 100000)), slate: Number(flag("slate", 300)), newsMeta,
    });
  } catch (err) {
    console.error(String(err.message));
    process.exit(3);
  }

  console.log(`\nmode ${mode}, asOf ${r.context.asOf ?? "(anonymised)"}, ` +
              `slate ${r.context.universe.shown}/${r.context.universe.total}`);
  if (r.skipped) {
    console.log(`batch produced nothing: ${r.skipped.reason} — ${JSON.stringify(r.skipped.detail)}`);
  } else {
    console.log(`proposals ${r.decision.proposals.length}, dropped ${r.decision.dropped.length}, ` +
                `allowed ${r.gate.allowed.length}, rejected ${r.gate.rejected.length}`);
    for (const p of r.gate.allowed) console.log(`  + ${p.symbol.padEnd(8)} ${p.action} ${pct(p.targetPct)}`);
    for (const x of r.gate.rejected) console.log(`  - ${String(x.proposal?.symbol).padEnd(8)} ${x.code}: ${x.detail}`);
    for (const d of r.decision.dropped) console.log(`  ~ dropped by decide: ${d.why}`);
  }
  console.log(`journalled to ${JOURNAL} as batch ${r.record?.batchId}`);

  // In a dry run the outcome is already knowable, so the full path including scoring can be shown.
  if (mode === MODE.DRY_RUN && r.record && !r.skipped) {
    // requireComplete:false so a hold the panel cannot cover is SHOWN as incomplete rather than
    // silently absent. The default drops them, which is what a journal writer must do; a human
    // reading a dry run should see that the panel ran out, not an empty section.
    const rows = realisedOutcomes({
      record: r.record, series, dates, entryIdx: asOf, holdDays: 5,
      costPerLeg: COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct,
      requireComplete: false,
    });
    if (rows.length) {
      console.log("\nrealised over the next 5 sessions (DRY RUN — not evidence):");
      for (const x of rows) {
        if (!x.complete) {
          console.log(`  ${x.symbol.padEnd(8)} INCOMPLETE — ${x.sessionsHeld}/${x.holdDays} sessions ` +
                      `available after this date; no outcome exists yet and none is recorded`);
          continue;
        }
        console.log(`  ${x.symbol.padEnd(8)} net ${pct(x.netReturn).padStart(8)}   ` +
                    `control ${pct(x.controlReturn).padStart(8)}`);
      }
    }
  }

} else if (cmd === "settle") {
  // CLOSES THE LOOP BETWEEN A DECISION AND WHAT HAPPENED TO IT.
  //
  // recordOutcome existed and nothing called it. Decisions were journalled, `realisedOutcomes`
  // could compute results, and the two were never connected -- so `score` reported "outcomes 0"
  // no matter how long the agent ran. A measurement instrument that cannot record a measurement
  // is not one.
  //
  // It is a SEPARATE command rather than a step inside `paper` because the holding period has not
  // elapsed when the decision is made. Settlement happens days later, on a later run, which is
  // also why it must be idempotent.
  const { series, dates } = loadPanel();
  const holdDays = Number(flag("hold", 5));
  const mode = flag("mode", MODE.PAPER);
  const r = settleOutcomes({
    series, dates, journalFile: JOURNAL, mode, holdDays,
    costPerLeg: COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct,
  });
  console.log(`settle mode "${mode}", hold ${holdDays}d, journal ${JOURNAL}`);
  if (r.malformed) console.log(`  ${r.malformed} malformed line(s) skipped`);
  console.log(`  ${r.decisions} decision batch(es) in this mode`);
  console.log(`  wrote ${r.wrote} outcome(s)`);
  if (r.already) console.log(`  ${r.already} already settled, left alone`);
  if (r.pending) console.log(`  ${r.pending} decision(s) still inside the holding period — nothing recorded`);
  if (r.unknownBar) {
    console.log(`  ${r.unknownBar} batch(es) carry no decision bar this panel knows; skipped, not guessed at.`);
    console.log("    (records written before asOfTime was stored, or a panel that no longer covers them)");
  }

} else if (cmd === "score") {
  const mode = flag("mode", MODE.PAPER);
  const s = scoreJournal(JOURNAL, { mode });
  console.log(`journal ${JOURNAL}, mode "${s.mode}"${s.isEvidence ? "" : "  — NOT EVIDENCE OF EDGE"}`);
  if (s.contaminatedRecords) {
    console.log(`${s.contaminatedRecords} record(s) from other modes excluded from every figure below.`);
  }
  console.log(`batches ${s.batches}, sized decisions ${s.decisions}, outcomes ${s.outcomes}, span ${s.spanDays}d`);
  if (s.malformed) console.log(`${s.malformed} malformed line(s) skipped`);
  console.log("");
  console.log(`  analyst mean net   ${pct(s.agentMeanNet)}`);
  console.log(`  control mean net   ${pct(s.controlMeanNet)}   <- a coin flip from the same slate`);
  console.log(`  edge               ${pct(s.edge)}`);
  // THE PERIOD COUNT BELONGS BESIDE THE EDGE, NOT IN A FOOTNOTE. The protocol's whole arithmetic
  // turns on it: 20 trading days at a 5-day hold is four independent observations, not a hundred
  // trades, and the interval drawn over trades would be about three times too narrow.
  console.log(`  95% CI             ${s.edgeCI.lo === null ? "—" : `${pct(s.edgeCI.lo)} .. ${pct(s.edgeCI.hi)}`}` +
              `   over ${s.periods} independent period(s) at a ${s.holdDays}-day hold`);
  if (s.periods && s.periods < 12) {
    console.log(`                     ${s.periods} period(s) resolves almost nothing — docs/PAPER-PROTOCOL.md`);
  }
  console.log(`  beat control       ${s.beatControlRate === null ? "—" : `${(s.beatControlRate * 100).toFixed(1)}%`} of decisions`);
  console.log(`  hit rate           ${s.hitRate === null ? "—" : `${(s.hitRate * 100).toFixed(1)}%`}`);
  console.log("");
  // The split that tests the design's one claim. Printed with both counts and no verdict: this
  // pivot's argument is that the edge comes from the non-price input, and the only way to read
  // that is names bought WITH a headline against names bought without.
  const ns = s.newsSplit;
  if (ns && (ns.withNews.n || ns.withoutNews.n || ns.unknown)) {
    console.log("did the news matter? (the claim this design rests on)");
    console.log(`  with a headline     n=${String(ns.withNews.n).padStart(4)}   net ${pct(ns.withNews.meanNet).padStart(8)}   control ${pct(ns.withNews.controlMeanNet).padStart(8)}   edge ${pct(ns.withNews.edge)}`);
    console.log(`  without             n=${String(ns.withoutNews.n).padStart(4)}   net ${pct(ns.withoutNews.meanNet).padStart(8)}   control ${pct(ns.withoutNews.controlMeanNet).padStart(8)}   edge ${pct(ns.withoutNews.edge)}`);
    if (ns.unknown) console.log(`  unrecorded          n=${String(ns.unknown).padStart(4)}   (decisions written before the flag existed)`);
    console.log(ns.comparable
      ? "  both arms have enough outcomes to be worth comparing. Compare the EDGES, not the nets."
      : "  NOT YET COMPARABLE — needs 20+ outcomes in each arm. Splitting a small sample makes two");
    if (!ns.comparable) console.log("  smaller ones, and a skewed payoff needs more outcomes than a symmetric one, not fewer.");
    console.log("");
  }
  if (Object.keys(s.rejectCounts).length) {
    console.log("risk gate rejections:");
    for (const [code, n] of Object.entries(s.rejectCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code.padEnd(28)} ${n}`);
    }
  }
  if (s.halts || s.brakes) console.log(`halts ${s.halts}, daily brakes ${s.brakes}`);
  console.log("");
  console.log(s.meetsStandingMinimum
    ? "Standing minimum MET (60 days and 50 trades). A significance test is now meaningful."
    : `Standing minimum NOT met (needs 60 days and 50 trades; have ${s.spanDays}d and ${s.decisions}). ` +
      "No p-value is computed before then: with this few outcomes it would be noise with a decimal point.");

} else {
  console.log(`usage:
  node analyst-run.mjs dry-run    [--asOf N] [--slate 300] [--stub] [--journal FILE]
  node analyst-run.mjs anonymised [--asOf N] [--slate 300] [--journal FILE]
  node analyst-run.mjs settle     [--mode paper|dry-run] [--hold 5] [--journal FILE]
  node analyst-run.mjs paper   [--journal FILE]
  node analyst-run.mjs score   [--mode paper|dry-run|anonymised] [--journal FILE]

dry-run exercises the wiring on a historical date and is NOT evidence.
anonymised probes reasoning with identities stripped and is NOT evidence.
paper is the only mode that counts, and refuses to run on a stale panel.`);
  process.exit(cmd ? 1 : 0);
}
