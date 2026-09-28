/**
 * The negative-control diagnostic: does the scorer report an edge on data that has none?
 *
 * WHY A SINGLE RUN CANNOT ANSWER THIS. On one synthetic panel the measured edge is a draw from a
 * distribution centred near zero, so it is nonzero essentially always. Reading one nonzero point
 * estimate as "the plumbing is broken" would be the same error as reading one positive backtest as
 * "we found something". The diagnostic is therefore distributional: many independent panels, each
 * one a fresh seed, and three separate questions asked of the result.
 *
 *   1. CENTRE.   Is the distribution of measured edges centred on zero? A scorer with a systematic
 *                bias -- a lookahead leak, a control drawn from the wrong pool, a cost applied to
 *                one side only -- shows up as a shifted mean, which a single run cannot reveal.
 *   2. COVERAGE. `score` reports a 95% interval. Across many nulls, about 95% of those intervals
 *                should contain zero. Far fewer means the instrument is overconfident and every
 *                downstream interval is too narrow. This is the test that actually matters.
 *   3. SENSITIVITY. A scorer hard-wired to return zero would sail through 1 and 2. So a known edge
 *                is INJECTED into the outcomes and the scorer must recover it at roughly the right
 *                magnitude. Without this the diagnostic cannot distinguish a working instrument
 *                from a broken one that happens to be silent.
 *
 * Plus an INDEPENDENT RECOMPUTE: edge, period count and arm sizes are recalculated here from the
 * raw journal by a separate code path and compared against scoreJournal's own figures. Agreement is
 * not proof of correctness, but disagreement is proof of a bug, and it is cheap.
 *
 * A PASS SAYS NOTHING ABOUT REAL MARKETS. There was no structure to find. This measures the
 * measuring device. See docs/FORWARD-EVAL-SPEC.md §6.
 *
 * Usage: node synthetic-null.mjs [panels] [--seed N]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { seededRng, clusteredBootstrapCI } from "./inference.mjs";
import { runOnce, settleOutcomes } from "./analyst/loop.mjs";
import { readJournal, scoreJournal, recordOutcome, KIND, MODE } from "./analyst/journal.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PANELS = Number(args.find((a) => /^\d+$/.test(a)) ?? 120);
const BASE_SEED = Number((args.indexOf("--seed") >= 0 ? args[args.indexOf("--seed") + 1] : null) ?? 20260928);

// BATCH COUNT IS VARIED ACROSS PANELS ON PURPOSE. Spacing (12 bars) exceeds the hold so holds never
// overlap; the COUNT is what drives the diagnostic, because holdPeriodKeys buckets on
// floor(entryRank / holdDays) -- 5 batches collapse to one period however far apart they sit, and one
// period reports no interval at all. Cycling the count gives coverage at several cluster counts in a
// single run, which is the only way to tell a bootstrap that is weak at few clusters from a chain
// that is broken at all of them.
const BATCH_COUNTS = [10, 20, 30, 45];
const SPACING = 12;
// THE SLATE IS EMPTY UNTIL THE RANKING INDICATOR WARMS UP. `momentum` is `ret(c, i, 252, 21)`, so
// buildContext can rank nothing before bar 252 and every earlier batch journals a decision with an
// empty `allowed`. An earlier version of this file started at 140 and three quarters of its batches
// were silently positionless: they still counted as decisions, so `periods/panel` looked plausible
// while a whole batch-count group contributed no outcomes at all. Start clear of the warm-up, and
// assert per panel that batches actually sized something.
// PIN THE BAR DATES. The generator's `--end` defaults to 90 days before now, so an unpinned panel
// changes every day and "a pure function of its seed" would be false for the timestamps. Any run
// whose numbers are reported has to be reproducible from the command as written, so `--end` is fixed
// here and printed in the header.
const END = "2026-06-30";
const REF_TRIALS = 400;
const REF_CLUSTER_SIZE = 15;
const MOMENTUM_WARMUP = 252;
const FIRST_ASOF = MOMENTUM_WARMUP + 8;
const HOLD = 5;
// Every panel is the same length whatever its batch count, so the only thing that varies across the
// coverage curve is the number of clusters. The panel must also outlast the last entry by the hold,
// or the final batches never settle and the count silently stops meaning what it says.
const BARS = FIRST_ASOF + (Math.max(...BATCH_COUNTS) - 1) * SPACING + HOLD + 10;
const asOfsFor = (nBatches) => Array.from({ length: nBatches }, (_, i) => FIRST_ASOF + i * SPACING);
for (const n of BATCH_COUNTS) {
  const last = asOfsFor(n).at(-1);
  if (last + HOLD >= BARS) throw new Error(`batch layout overruns the panel: ${n} batches reach bar ${last}+${HOLD} of ${BARS}`);
}
if (FIRST_ASOF < MOMENTUM_WARMUP) throw new Error(`FIRST_ASOF ${FIRST_ASOF} is inside the ${MOMENTUM_WARMUP}-bar ranking warm-up`);
const pct = (x) => (typeof x === "number" ? `${(x * 100).toFixed(3)}%` : "—");
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

/** The stub picker: top of slate by the ranking. Deliberately not an analyst. */
const stub = (n = 3) => ({
  messages: {
    create: async ({ messages }) => {
      const ctx = JSON.parse(messages[0].content[0].text);
      const picks = (ctx.candidates ?? []).filter((c) => !c.held).slice(0, n).map((c) => ({
        symbol: c.symbol, action: "buy", targetPct: 0.05, confidence: 0.5,
        thesis: "SYNTHETIC NULL DIAGNOSTIC: mechanical top-of-slate pick. Not analysis, not evidence.",
      }));
      return {
        id: "msg_synthetic", container: null,
        content: [{ type: "text", text: JSON.stringify({ decisions: picks }), citations: null }],
        model: "stub", role: "assistant", stop_details: null,
        stop_reason: "end_turn", stop_sequence: null, type: "message",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  },
});

/** Generate one panel via the committed generator, so this exercises the real artifact. */
function makePanel(seed, outDir, end = END) {
  const a = ["scripts/make-synthetic-panel.mjs", "--out", outDir, "--seed", String(seed),
             "--symbols", "40", "--bars", String(BARS)];
  if (end) a.push("--end", end);
  execFileSync("node", a, { cwd: REPO, stdio: "pipe" });
}

function loadPanel(root) {
  const raw = {};
  for (const s of availablePairs(1440, root)) raw[s] = loadBundleCandles(s, 1440, root);
  const kept = screenUniverse(raw).kept;
  const times = new Set();
  for (const bars of Object.values(kept)) for (const b of bars) times.add(Number(b.time));
  return { series: kept, dates: [...times].sort((a, b) => a - b) };
}

/** One panel end to end, in process: decisions -> settle -> score. Returns the score object. */
async function runPanel(seed, tmp, nBatches = 30) {
  const root = path.join(tmp, `syn-${seed}`);
  makePanel(seed, root);
  const { series, dates } = loadPanel(root);
  const journal = path.join(root, "journal.jsonl");

  for (const asOf of asOfsFor(nBatches)) {
    await runOnce({
      series, dates, asOf, client: stub(3), mode: MODE.DRY_RUN,
      journalFile: journal, nav: 1e5, slate: 40,
      // The record says what it is. If this journal is ever copied next to a real one, every line
      // carries "synthetic-" in its batchId rather than relying on the file it happens to sit in.
      batchId: `synthetic-${seed}-${asOf}`,
    });
  }
  settleOutcomes({ series, dates, journalFile: journal, mode: MODE.DRY_RUN, holdDays: HOLD });
  const s = scoreJournal(journal, { mode: MODE.DRY_RUN });
  if (process.env.SYN_DEBUG) {
    console.log(`  DEBUG n=${nBatches} batches=${s.batches} sized=${s.decisions} outcomes=${s.outcomes}` +
      ` periods=${s.periods} edge=${s.edge}`);
  }
  // A panel that sized nothing is a broken fixture, not an observation. Averaging it in is how the
  // warm-up bug hid: a group of panels contributed zero outcomes and the run still printed a number.
  if (s.decisions === 0) {
    throw new Error(`panel seed ${seed} (${nBatches} batches) sized no positions — empty slate, not a null result`);
  }
  return { score: s, journal, root };
}

/** INDEPENDENT RECOMPUTE: same quantities, different code path, straight off the journal lines. */
function recompute(journalFile, holdDays = HOLD) {
  const { records } = readJournal(journalFile);
  const decisions = records.filter((r) => r.kind === KIND.DECISION && r.mode === MODE.DRY_RUN);
  const ids = new Set(decisions.map((d) => d.batchId));
  const outcomes = records.filter((r) => r.kind === KIND.OUTCOME && ids.has(r.batchId));

  const agent = [], control = [];
  for (const o of outcomes) {
    if (typeof o.netReturn === "number") agent.push(o.netReturn);
    if (typeof o.controlReturn === "number") control.push(o.controlReturn);
  }
  // Periods, recomputed from entry bars rather than by calling holdPeriodKeys.
  const entryOf = new Map(decisions.map((d) => [d.batchId, d.asOfTime]));
  const times = [...new Set(decisions.map((d) => d.asOfTime).filter(Number.isFinite))].sort((a, b) => a - b);
  const rank = new Map(times.map((t, i) => [t, i]));
  const buckets = new Set();
  for (const o of outcomes) {
    const r = rank.get(entryOf.get(o.batchId));
    buckets.add(r === undefined ? "unknown" : Math.floor(r / holdDays));
  }
  return {
    outcomes: outcomes.length,
    edge: agent.length && control.length ? mean(agent) - mean(control) : null,
    periods: buckets.size,
  };
}

// ---- run -------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-null-"));
console.log("SYNTHETIC NULL DIAGNOSTIC — is the scorer honest on data with no edge in it?");
console.log(`${PANELS} independent panels, base seed ${BASE_SEED}, 40 symbols x ${BARS} bars each`);
console.log(`batch count cycles ${BATCH_COUNTS.join("/")} per panel, ${SPACING} bars apart, ${HOLD}-day hold, stub picker`);
console.log(`first asOf ${FIRST_ASOF} (clears the ${MOMENTUM_WARMUP}-bar ranking warm-up), panel end pinned to ${END}`);
console.log(`workspace ${tmp} (outside the repo; nothing committed)\n`);

const edges = [], periodCounts = [], outcomeCounts = [];
let covered = 0, intervals = 0, mismatches = 0;
const byPeriods = new Map();
// Edges grouped by batch count. A tolerance borrowed from the POOLED sd is wrong for any single
// configuration -- a 10-batch panel scatters far more than a 45-batch one -- so each config reports
// its own spread, and a test that runs one config calibrates against that row.
const byCount = new Map();

for (let i = 0; i < PANELS; i++) {
  const seed = BASE_SEED + i * 7919;
  const nBatches = BATCH_COUNTS[i % BATCH_COUNTS.length];
  const { score, journal } = await runPanel(seed, tmp, nBatches);

  const ind = recompute(journal);
  const near = (a, b) => (a === null && b === null) || (Math.abs(a - b) < 1e-12);
  if (!near(score.edge, ind.edge) || score.periods !== ind.periods || score.outcomes !== ind.outcomes) {
    mismatches++;
    console.log(`  MISMATCH seed ${seed}: score edge=${score.edge} periods=${score.periods} outcomes=${score.outcomes}` +
                ` vs independent edge=${ind.edge} periods=${ind.periods} outcomes=${ind.outcomes}`);
  }

  if (typeof score.edge === "number") {
    edges.push(score.edge);
    byCount.set(nBatches, byCount.get(nBatches) ?? []);
    byCount.get(nBatches).push(score.edge);
  }
  periodCounts.push(score.periods);
  outcomeCounts.push(score.outcomes);
  if (score.edgeCI && !score.edgeCI.degenerate && score.edgeCI.lo !== null) {
    intervals++;
    const hit = score.edgeCI.lo <= 0 && score.edgeCI.hi >= 0;
    if (hit) covered++;
    byPeriods.set(score.periods, byPeriods.get(score.periods) ?? { n: 0, hit: 0 });
    const b = byPeriods.get(score.periods); b.n++; if (hit) b.hit++;
  }
  if ((i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${PANELS} panels\n`);
}

edges.sort((a, b) => a - b);
const m = mean(edges), s = sd(edges);
const se = s / Math.sqrt(edges.length);
const q = (p) => edges[Math.min(edges.length - 1, Math.floor(edges.length * p))];

console.log(`\n=== 1. CENTRE — the null distribution of measured edge ===`);
console.log(`  panels           ${edges.length}`);
console.log(`  outcomes/panel   ${mean(outcomeCounts).toFixed(1)}   periods/panel ${mean(periodCounts).toFixed(2)}`);
console.log(`  mean edge        ${pct(m)}   (standard error ${pct(se)})`);
console.log(`  sd of edge       ${pct(s)}`);
console.log(`  p05 / p50 / p95  ${pct(q(0.05))} / ${pct(q(0.50))} / ${pct(q(0.95))}`);
console.log(`  min / max        ${pct(edges[0])} / ${pct(edges.at(-1))}`);
const z = se > 0 ? m / se : 0;
console.log(`  mean / SE        ${z.toFixed(2)}   <- a systematic bias shows up here, not in one run`);
console.log(`  ${Math.abs(z) < 3 ? "CONSISTENT WITH ZERO CENTRE" : "*** CENTRE IS SHIFTED — investigate ***"}`);
console.log(`\n  by batch count — the spread a single run of that configuration should be judged against:`);
for (const k of [...byCount.keys()].sort((a, b) => a - b)) {
  const e = byCount.get(k);
  console.log(`    ${String(k).padStart(2)} batches  n=${String(e.length).padStart(3)}` +
              `  mean ${pct(mean(e))}  sd ${pct(sd(e))}  |max| ${pct(Math.max(...e.map(Math.abs)))}`);
}

console.log(`\n=== 2. COVERAGE — does the reported 95% interval contain zero ~95% of the time? ===`);
const cov = intervals ? covered / intervals : 0;
/** Wilson score interval: a coverage estimate without one is a point estimate pretending to be a fact. */
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z / d) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const [cl, ch] = wilson(covered, intervals);
console.log(`  non-degenerate intervals  ${intervals} of ${PANELS}`);
console.log(`  contained zero            ${covered}  (${(cov * 100).toFixed(1)}%)`);
console.log(`  95% Wilson CI on that     ${(cl * 100).toFixed(1)}% .. ${(ch * 100).toFixed(1)}%`);
console.log(`  nominal                   95.0%`);
console.log(`\n  by period count — separates "bootstrap is weak at few clusters" from "scorer is broken":`);
for (const k of [...byPeriods.keys()].sort((a, b) => a - b)) {
  const b = byPeriods.get(k);
  const [lo, hi] = wilson(b.hit, b.n);
  console.log(`    ${String(k).padStart(2)} periods   ${String(b.hit).padStart(3)}/${String(b.n).padStart(3)}` +
              `  ${((b.hit / b.n) * 100).toFixed(1)}%  [${(lo * 100).toFixed(0)}..${(hi * 100).toFixed(0)}%]`);
}
// REFERENCE CURVE: WHAT THIS ESTIMATOR COVERS AT THIS CLUSTER COUNT, MEASURED, NOT ASSERTED.
//
// "A percentile cluster bootstrap under-covers at few clusters" was previously a claim in a comment,
// which is not evidence. It is cheap to measure: run the SAME function on iid Gaussian data with a
// true mean of zero, at the same cluster counts, with no panels and no journal involved. That gives
// the coverage the estimator itself achieves, and the chain should match it — not 95%.
//
// The k=2 case is analytic and anchors the whole curve. With two clusters each draw picks 2 of 2 with
// replacement, so the draw distribution is {mean_A: 1/4, midpoint: 1/2, mean_B: 1/4} and the 2.5/97.5
// percentiles land on the two cluster means exactly: the interval IS [min, max] of them. Zero is
// covered only when the two straddle it, which for a symmetric distribution is 2*0.5*0.5 = 50%.
// A reference near 50% at k=2 therefore confirms the harness, not a bug.
console.log(`\n  reference — same estimator, iid N(0,1) clusters, true mean zero, ${REF_TRIALS} trials each:`);
const reference = new Map();
{
  const refRng = seededRng(BASE_SEED + 31337);
  const refGauss = () => { const u = Math.max(1e-12, refRng()), v = refRng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (const k of [...byPeriods.keys()].sort((a, b) => a - b)) {
    let hit = 0;
    for (let t = 0; t < REF_TRIALS; t++) {
      const vals = [], keys = [];
      for (let c = 0; c < k; c++) for (let j = 0; j < REF_CLUSTER_SIZE; j++) { vals.push(refGauss()); keys.push(c); }
      const ci = clusteredBootstrapCI(vals, { keys, iterations: 500, seed: BASE_SEED + t });
      if (ci.lo !== null && ci.lo <= 0 && ci.hi >= 0) hit++;
    }
    const [lo, hi] = wilson(hit, REF_TRIALS);
    reference.set(k, { cov: hit / REF_TRIALS, lo, hi });
    console.log(`    ${String(k).padStart(2)} clusters  ${String(hit).padStart(4)}/${REF_TRIALS}` +
                `  ${((hit / REF_TRIALS) * 100).toFixed(1)}%  [${(lo * 100).toFixed(0)}..${(hi * 100).toFixed(0)}%]`);
  }
}

console.log("");
if (intervals === 0) {
  console.log("  NO INTERVALS TO CHECK — period count too low; raise BATCH_COUNTS");
} else {
  // The comparison that matters: chain coverage against the estimator's own coverage at the same k.
  // Below the reference's lower Wilson bound is a chain defect. Matching a reference that is itself
  // under 95% is the estimator being weak at few clusters, which is a limitation to report, not a bug.
  const below = [], above = [];
  for (const k of [...byPeriods.keys()].sort((a, b) => a - b)) {
    const b = byPeriods.get(k), r = reference.get(k);
    if (!r) continue;
    const [clo, chi] = wilson(b.hit, b.n);
    const agrees = chi >= r.lo && clo <= r.hi;   // Wilson intervals overlap
    // DIRECTION DECIDES WHETHER IT MATTERS. Covering LESS than the estimator is the failure mode this
    // diagnostic exists to catch: intervals too narrow, zero excluded too often, a null that looks
    // like a finding. Covering MORE is conservative -- wider intervals, harder to claim an edge -- so
    // it is reported but is not a defect. An earlier version tested only for "below" and then printed
    // "matches at every count" directly underneath a flagged divergence.
    const verdict = agrees ? "agrees" : chi < r.lo ? "*** BELOW — narrower than the estimator ***"
                                                   : "above (conservative)";
    console.log(`    ${String(k).padStart(2)} periods   chain ${((b.hit / b.n) * 100).toFixed(1)}%` +
                `  vs reference ${((r.cov) * 100).toFixed(1)}%  ${verdict}`);
    if (!agrees && chi < r.lo) below.push(k);
    if (!agrees && clo > r.hi) above.push(k);
  }
  console.log("");
  if (below.length) {
    console.log(`  *** CHAIN COVERS LESS THAN THE ESTIMATOR at ${below.join(", ")} periods —`);
    console.log("  that shortfall is not explained by the bootstrap and points at this chain. ***");
  } else {
    console.log("  NO COUNT COVERS LESS THAN THE ESTIMATOR. The shortfall against the 95% nominal is a");
    console.log("  property of a percentile cluster bootstrap at few clusters, reproduced here on iid");
    console.log("  data with no panel, journal or scorer involved.");
    if (above.length) {
      console.log(`  At ${above.join(", ")} periods the chain covers MORE than the iid reference. That is the`);
      console.log("  conservative direction — wider intervals, a higher bar for claiming an edge — and the");
      console.log("  likely cause is that panel clusters are neither equal-sized nor iid, unlike the");
      console.log("  reference. Reported, not dismissed, and not counted as a pass.");
    }
    console.log("  LIMITATION, NOT A PASS: intervals from a handful of periods are optimistic against");
    console.log("  nominal, so a forward run needs many more periods before its interval means what it says.");
  }
}

console.log(`\n=== 3. INDEPENDENT RECOMPUTE ===`);
console.log(`  panels where scoreJournal disagreed with the independent calculation: ${mismatches}`);
console.log(`  ${mismatches === 0 ? "AGREES on edge, period count and outcome count for every panel"
            : "*** DISAGREEMENT — one of the two is wrong ***"}`);

// ---- 4. sensitivity: a scorer that always says zero must fail this -----------------------------
console.log(`\n=== 4. SENSITIVITY — inject a known edge; the scorer must recover it ===`);
{
  const seed = BASE_SEED + 999983;
  const { journal } = await runPanel(seed, tmp);
  const before = scoreJournal(journal, { mode: MODE.DRY_RUN });

  // Append a second arm of outcomes carrying a known +2.00% lift over their controls, on fresh
  // batch ids so nothing existing is rewritten. The journal is append-only by design.
  const INJECT = 0.02;
  const rng = seededRng(seed);
  const spiked = path.join(path.dirname(journal), "injected.jsonl");
  fs.copyFileSync(journal, spiked);
  const { records } = readJournal(spiked);
  const decisions = records.filter((r) => r.kind === KIND.DECISION && r.mode === MODE.DRY_RUN);
  for (const d of decisions) {
    for (const a of (d.allowed ?? [])) {
      const base = 0.01 * (rng() - 0.5);
      recordOutcome({ batchId: d.batchId, symbol: `${a.symbol}-INJ`, holdDays: HOLD,
                      grossReturn: base + INJECT, netReturn: base + INJECT, controlReturn: base }, spiked);
    }
  }
  const after = scoreJournal(spiked, { mode: MODE.DRY_RUN });
  // AN EXACT PREDICTION, NOT A LOOSE BAND. The injected arm is paired by construction -- agent is
  // control plus INJECT on every row -- so its own edge is exactly INJECT. The two arms are equal in
  // size, so the pooled edge must be their unweighted average: (before.edge + INJECT) / 2. That is a
  // closed form derived outside the scorer, which makes this a check rather than a sanity feel.
  // A first version of this asserted "movement is roughly half the injected lift", which was wrong:
  // the movement is half the GAP between INJECT and the prior edge, and it happened to look right
  // only because that panel's prior edge was near -INJECT.
  const predicted = ((before.edge ?? 0) + INJECT) / 2;
  const err = Math.abs((after.edge ?? 0) - predicted);
  console.log(`  edge before injection   ${pct(before.edge)}   (${before.outcomes} outcomes)`);
  console.log(`  injected per-name lift  ${pct(INJECT)} on ${after.outcomes - before.outcomes} added outcomes`);
  console.log(`  edge after injection    ${pct(after.edge)}   (${after.outcomes} outcomes)`);
  console.log(`  predicted, closed form  ${pct(predicted)}   = (before + inject) / 2, equal arms`);
  console.log(`  absolute error          ${err.toExponential(2)}`);
  const ok = err < 1e-12 && (after.outcomes - before.outcomes) === before.outcomes;
  console.log(`  ${ok ? "RECOVERED EXACTLY — the scorer is not hard-wired to report nothing"
              : "*** DOES NOT MATCH THE CLOSED FORM — the scorer or this prediction is wrong ***"}`);
}

console.log(`\nWhat this does and does not establish: the instrument was exercised against data with`);
console.log(`no structure in it, and against a known injected effect. Nothing here says anything`);
console.log(`about real markets, any strategy, or any edge. See docs/FORWARD-EVAL-SPEC.md.`);
fs.rmSync(tmp, { recursive: true, force: true });
