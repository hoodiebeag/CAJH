#!/usr/bin/env node
/**
 * slate-null.mjs — measure the null against the slate the analyst and control actually see.
 *
 * THE GAP THIS CLOSES. `paper-power.mjs` and `power-sensitivity.mjs` draw books from the whole screened
 * universe. The runtime does not. `loop.mjs` passes `context.candidates` — the point-in-time SLATE — as
 * the control pool, and `journal.mjs`'s own comment says the pool "matters more than the draw": a
 * control drawn from the whole universe when the analyst only considered fifty names measures universe
 * selection rather than stock selection. So the registered sigma was measured against a pool the
 * runtime never uses.
 *
 * THE RUNTIME ALREADY ANSWERS THE SAMPLING CONVENTION; THERE IS NO OPEN OWNER DECISION. Section 0
 * reads the semantics off the code. An earlier report of mine listed "which control convention the
 * forward record is scored against" as a decision for Tyler. That was wrong — `matchedRandomControl`
 * draws from the slate without reference to the analyst's picks, so overlap is permitted and the pool
 * is the slate. The diagnostic was the thing out of step, and the fix is to match it to the runtime,
 * not to ask which convention to adopt. This tool changes no runtime behaviour.
 *
 * POINT-IN-TIME BY CONSTRUCTION, NOT BY ASSERTION. The slate is built by calling the real
 * `buildContext` at the decision bar, which performs "the one truncation": every series physically
 * ends at the decision, so no ranking or eligibility test can see a future bar. Index mapping is
 * asserted at startup rather than assumed (section 1).
 *
 * WHAT IS FAITHFUL AND WHAT IS APPROXIMATED — labelled, not blurred:
 *   FAITHFUL: the slate for a FLAT book. Same `buildContext`, same `rankBy`, same `slate` arithmetic,
 *             same truncation. Membership is reproduced exactly, not re-implemented.
 *   APPROXIMATED: held positions. `buildContext` always shows held names on top of the ranked slate,
 *             and a forward run carries a book. This reconstruction passes `positions: {}`, so the
 *             held component is absent and the realised slate is narrower than a live one. Labelled
 *             APPROXIMATION in the output. It is not a disguised exact replay.
 *   OUT OF SCOPE: news and sectors are per-row metadata and do not affect slate MEMBERSHIP, so their
 *             absence does not bias the pool. nav/peak/dayStart affect only the portfolio block.
 *
 * SURVIVORSHIP AND UNIVERSE LIMITS. The symbols are those in the candidate list now, all 127 sharing
 * one start bar and one length — so there are no delistings, acquisitions or renames IN the panel, and
 * that is itself the limitation: names that left the universe were never collected. A point-in-time
 * reconstruction of ELIGIBILITY is therefore impossible from these files; what is reconstructed
 * point-in-time is RANKING over a survivor set. Any slate measured here is drawn from survivors.
 *
 * NOTHING HERE IS EVIDENCE OF EDGE. It measures the dispersion of two random books from the same pool.
 * It is historical exploration, not prospective evidence, and it tests no strategy.
 *
 * Usage: node slate-null.mjs [draws]      (default 20000; deterministic given the seed)
 */

import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { seededRng } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";
import { buildContext } from "./analyst/context.mjs";
import { nonOverlappingStarts, mde, annualise } from "./analyst/power.mjs";
import {
  buildReturnMap, drawPair, sd, mean, monteCarloSeOfSd, periodBootstrapSd, blockBootstrapSd,
} from "./analyst/panel-null.mjs";

export const ROOT = "sp500-bundle";
export const SEED = 20261006;
export const HOLD = 5;
export const FIRST_START = 252;        // the momentum warm-up; buildContext can rank nothing earlier
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const DRAWS = Number(process.argv[2] ?? 20000);

const pct3 = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)}%` : "—");
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "—");

/**
 * Load the panel on BOTH grids and assert they correspond.
 *
 * `buildContext` indexes bar times; `bookReturn` indexes return times, which are bar times minus each
 * symbol's first bar. They correspond one-for-one only when every symbol shares a start bar. Asserted
 * here, because a future panel with ragged starts would silently shift every decision by a day — the
 * exact class of off-by-one this project has already been bitten by twice.
 */
export function loadGrids(root = ROOT) {
  const raw = {};
  for (const s of availablePairs(1440, root)) raw[s] = loadBundleCandles(s, 1440, root);
  const screened = screenUniverse(raw);
  const kept = screened.kept;

  const barTimes = new Set();
  for (const bars of Object.values(kept)) for (const b of bars) barTimes.add(Number(b.time));
  const barDates = [...barTimes].sort((a, b) => a - b);
  const panel = buildReturnMap(kept);

  const firstBars = new Set(Object.values(kept).map((b) => Number(b[0].time)));
  const aligned = panel.dates.every((t, k) => t === barDates[k + 1]);
  if (!aligned || firstBars.size !== 1) {
    throw new Error(
      `slate-null: bar and return grids do not correspond (${firstBars.size} distinct first bars, ` +
      `aligned=${aligned}). The asOf mapping below would be wrong; fix the mapping before trusting any ` +
      `number from this tool.`);
  }
  return { kept, barDates, panel, screened, aligned };
}

/**
 * The point-in-time slate for the window that starts at return index `i`.
 *
 * MAPPING, DERIVED NOT GUESSED. `bookReturn` compounds the returns at return-indices i..i+H-1, and a
 * return is the change INTO its bar, so the window's entry price is the close of the bar before
 * returnDates[i] — which, under the asserted alignment, is barDates[i]. The decision therefore uses
 * information through barDates[i], i.e. `asOf: i` on the bar grid. No future bar is visible.
 */
export function slateFor({ kept, barDates }, i, { slate = 300, positions = {} } = {}) {
  const ctx = buildContext({ series: kept, dates: barDates, asOf: i, slate, positions });
  return {
    symbols: (ctx.candidates ?? []).map((c) => c.symbol),
    universeSeen: ctx.universe?.total ?? null,
    note: ctx.universe?.note ?? null,
    asOfBar: new Date(barDates[i] * 1000).toISOString().slice(0, 10),
  };
}

/**
 * Measure the null, drawing from a per-period pool.
 *
 * `poolFor(i)` returns the eligible pool at period `i`, so full-universe and slate-conditioned runs
 * share one code path and differ only in that function. `disjoint` defaults to FALSE to match the
 * runtime: `matchedRandomControl` permits overlap.
 */
export function measureWithPool(panel, starts, poolFor, { bookSize, hold, draws, seed, disjoint = false }) {
  const rng = seededRng(seed);
  const diffs = [];
  const byPeriod = new Map();
  let seenSum = 0, truncated = 0, poolSizeSum = 0, poolTooSmall = 0, identical = 0;
  for (let d = 0; d < draws; d++) {
    const i = starts[Math.floor(rng() * starts.length)];
    const pool = poolFor(i);
    poolSizeSum += pool.length;
    // THE DEGENERACY THRESHOLD IS NOT `pool < book`.
    //
    // With overlap permitted the two books are drawn without replacement from the SAME pool, so when
    // the pool holds no more names than the book, BOTH books take the entire pool: they are identical
    // and the paired difference is exactly zero for every draw. A first version of this check tested
    // `pool.length < bookSize` -- false at pool == book -- and so reported sigma 0.000% for slate=10
    // as though it were a measurement. A control that equals the analyst's own book is not a control.
    // Disjoint sampling needs twice the book instead, because the second book draws from the remainder.
    const need = disjoint ? bookSize * 2 : bookSize + 1;
    if (pool.length < need) poolTooSmall++;
    const r = drawPair(panel, pool, bookSize, i, hold, LEG, rng, { disjoint });
    if (!r) continue;
    diffs.push(r.diff);
    seenSum += r.seen;
    if (r.seen < hold - 1e-9) truncated++;
    if (Math.abs(r.diff) < 1e-15) identical++;
    if (!byPeriod.has(i)) byPeriod.set(i, []);
    byPeriod.get(i).push(r.diff);
  }
  const s = sd(diffs);
  const identicalShare = diffs.length ? identical / diffs.length : 0;
  return {
    sd: s, mean: mean(diffs), n: diffs.length, periods: byPeriod.size, starts: starts.length,
    mcSe: monteCarloSeOfSd(s, diffs.length),
    meanSeen: diffs.length ? seenSum / diffs.length : 0,
    truncatedShare: diffs.length ? truncated / diffs.length : 0,
    meanPoolSize: draws ? poolSizeSum / draws : 0,
    poolTooSmallShare: draws ? poolTooSmall / draws : 0,
    identicalShare,
    // A sigma of zero from identical books is not a precise measurement; it is no measurement.
    degenerate: identicalShare > 0.999,
    byPeriod,
  };
}

async function main() {
  console.log("SLATE-CONDITIONED NULL — measured against the pool the runtime actually uses");
  console.log(`root ${ROOT}, seed ${SEED}, ${DRAWS} draws per configuration, hold ${HOLD}, per-leg ${pct3(LEG)}`);
  console.log("NULL ONLY: two random books from one pool, differenced. Not evidence of edge.");
  console.log("HISTORICAL, on TODAY's surviving universe. Not prospective evidence.");
  console.log("Random-vs-random is a PLANNING PROXY, not the variance of a fixed analyst book.\n");

  const grids = loadGrids();
  const { panel, barDates, screened } = grids;

  // ---- 0. what the runtime does, read off the code ---------------------------------------------
  console.log("=== 0. RUNTIME SAMPLING SEMANTICS (audit, not a proposal) ===");
  console.log("  context.mjs  : candidates = [...held, ...top(half), ...bottom(half)] by `rankBy`,");
  console.log("                 half = max(1, floor(slate/2)); held names ALWAYS shown.");
  console.log("  loop.mjs:260 : pool = context.candidates.map(c => c.symbol)   <- the SLATE, not the universe");
  console.log("  journal.mjs  : matchedRandomControl(allowed, pool, seed) shuffles POOL and takes the");
  console.log("                 first `sized.length` names, WITHOUT reference to `allowed`.");
  console.log("                 -> overlap with the analyst's picks is PERMITTED");
  console.log("                 -> sampling is WITHOUT replacement within the control");
  console.log("                 -> truncates when pool < book rather than drawing a name twice");
  console.log("  CONCLUSION: the convention is already fixed by the runtime. There is no open owner");
  console.log("  decision here. An earlier report of mine listed one; that was a manufactured blocker.");
  console.log("  This tool therefore measures with disjoint=false and pool=slate, and changes nothing.\n");

  // ---- 1. the point-in-time mapping ------------------------------------------------------------
  const starts = nonOverlappingStarts(FIRST_START, HOLD, panel.dates.length);
  console.log("=== 1. POINT-IN-TIME MAPPING AND ITS LIMITS ===");
  console.log(`  bar grid ${barDates.length} dates, return grid ${panel.dates.length} dates, aligned: ${grids.aligned}`);
  console.log(`  window at return index i is entered at the close of barDates[i] -> buildContext asOf = i`);
  console.log(`  first start ${FIRST_START} (momentum warm-up), ${starts.length} non-overlapping ${HOLD}-day periods`);
  console.log(`  universe: ${Object.keys(screened.kept).length} kept, ${screened.rejected?.length ?? 0} screened out`);
  console.log("  FAITHFUL: slate membership for a FLAT book, via the real buildContext truncation.");
  console.log("  APPROXIMATION: positions = {} — a live run's held names are always on the slate and are");
  console.log("  absent here, so the reconstructed pool is narrower than a live one would be.");
  console.log("  IMPOSSIBLE FROM THESE FILES: point-in-time ELIGIBILITY. Every symbol in the bundle shares");
  console.log("  one start bar and one length, so no delisting or index change is represented; names that");
  console.log("  left the universe were never collected. Ranking is point-in-time; membership is survivors.\n");

  // ---- 2. what the slate actually resolves to --------------------------------------------------
  console.log("=== 2. REALISED SLATE SIZE (flat book) ===");
  console.log("  slate   mean size   min   max   = whole cross-section?");
  // Overridable so a test can exercise the report on a reduced set: a faithful slate is rebuilt per
  // (slate, period) pair via the real buildContext, which is ~665 grid builds at the default five
  // values and dominates the runtime. The tool keeps the faithful call rather than deriving narrow
  // slates by re-slicing a wide one, because re-slicing would re-implement the logic under test.
  const slateValues = (process.env.SLATE_NULL_SLATES ?? "10,20,40,80,300")
    .split(",").map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0);
  if (!slateValues.length) throw new Error("slate-null: SLATE_NULL_SLATES produced no usable slate sizes");
  const slateCache = new Map();
  for (const slate of slateValues) {
    const sizes = [];
    const cache = new Map();
    for (const i of starts) {
      const s = slateFor(grids, i, { slate });
      cache.set(i, s.symbols);
      sizes.push(s.symbols.length);
    }
    slateCache.set(slate, cache);
    const whole = Math.max(...sizes) >= panel.names.length;
    console.log(`  ${String(slate).padStart(5)}   ${mean(sizes).toFixed(1).padStart(9)}   ` +
                `${String(Math.min(...sizes)).padStart(3)}   ${String(Math.max(...sizes)).padStart(3)}   ${whole ? "YES" : "no"}`);
  }
  console.log(`  The panel holds ${panel.names.length} screened names. context.mjs says it itself: "with a`);
  console.log("  slate wider than the universe the slices simply return the whole cross-section.'");
  console.log("  SO AT THE DEPLOYED slate=300 THE SLATE IS THE WHOLE UNIVERSE, and slate-conditioning");
  console.log("  changes nothing TODAY. It bites only when slate < universe — and context.mjs records that");
  console.log("  300 was chosen against a ~1,000-name universe, which is the configuration this matters in.\n");

  // ---- 3. full pool vs slate-conditioned -------------------------------------------------------
  console.log("=== 3. FULL UNIVERSE vs SLATE-CONDITIONED DISPERSION (book of 10, overlap permitted) ===");
  console.log("  pool            mean pool   sigma/period   sim se    MDE@50p    annualised");
  const full = measureWithPool(panel, starts, () => panel.names,
    { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED });
  const row = (label, m) => {
    if (m.degenerate) {
      console.log(`  ${label.padEnd(14)}  ${m.meanPoolSize.toFixed(1).padStart(9)}   ` +
                  `${"DEGENERATE".padStart(12)}   ${"—".padStart(6)}   ${"—".padStart(7)}   ${"—".padStart(10)}`);
      return;
    }
    const m50 = mde(m.sd, 50);
    console.log(`  ${label.padEnd(14)}  ${m.meanPoolSize.toFixed(1).padStart(9)}   ${pct3(m.sd).padStart(12)}   ` +
                `${pct3(m.mcSe).padStart(6)}   ${pct3(m50).padStart(7)}   ${pct(annualise(m50, HOLD)).padStart(10)}`);
  };
  row("full universe", full);
  const slateRuns = new Map();
  for (const slate of slateValues) {
    const cache = slateCache.get(slate);
    const m = measureWithPool(panel, starts, (i) => cache.get(i),
      { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED + slate });
    slateRuns.set(slate, m);
    row(`slate=${slate}`, m);
  }
  const s10 = slateRuns.get(10), s300 = slateRuns.get(300);
  console.log(`  ratio slate=300 / full universe: ${(s300.sd / full.sd).toFixed(4)}  <- expect ~1, same pool`);
  if (s10.degenerate) {
    console.log("");
    console.log(`  DEGENERATE AT slate=10, AND THIS IS A REAL PROPERTY OF THE RUNTIME, not a tool bug:`);
    console.log(`  a slate of 10 against a book of 10 means the control draw takes the entire pool, so`);
    console.log(`  control and book are the SAME NAMES and the paired difference is exactly zero on`);
    console.log(`  ${(s10.identicalShare * 100).toFixed(1)}% of draws. matchedRandomControl samples without replacement from the`);
    console.log(`  pool and truncates rather than duplicating, so it cannot manufacture a distinct control`);
    console.log(`  from a pool this size. The comparison does not merely get noisy — it ceases to exist.`);
    console.log(`  A forward configuration therefore needs slate > book with room to spare, or the control`);
    console.log(`  is vacuous. Reported as a measurement limit, NOT as a recommended slate or book size:`);
    console.log(`  both are owner settings and neither is changed here.`);
  }
  console.log("");
  const usable = slateValues.filter((v) => !slateRuns.get(v).degenerate);
  const worst = usable.reduce((a, v) => (slateRuns.get(v).sd > slateRuns.get(a).sd ? v : a), usable[0]);
  const worstRatio = slateRuns.get(worst).sd / full.sd;
  console.log("  A NARROW SLATE IS A RANKED slate, so it is NOT a random subset of the cross-section: it");
  console.log("  holds the momentum extremes. Two effects pull in opposite directions — a smaller pool");
  console.log("  makes the two books overlap more, which SHRINKS the difference's variance, while ranked");
  console.log("  extremes are more volatile names, which INFLATES it.");
  console.log(`  MEASURED, THE SECOND WINS: sigma peaks at slate=${worst} (${pct3(slateRuns.get(worst).sd)}) against`);
  console.log(`  ${pct3(full.sd)} for the full universe, a ratio of ${worstRatio.toFixed(3)}.`);
  console.log("  DIRECTION THAT MATTERS: a deployed slate narrower than the universe would make the");
  console.log("  registered sigma -- and so the registered MDE -- OPTIMISTIC, not conservative, by up to");
  console.log(`  about ${((worstRatio - 1) * 100).toFixed(0)}% at these sizes. That is the opposite direction from the control-overlap`);
  console.log("  mismatch found earlier, and it does not currently bite because slate=300 exceeds the");
  console.log("  127-name panel. It would bite at the ~1,000-name universe slate=300 was chosen for.");
  console.log("  This is a property of the RANKING, not of pool size alone, and nothing here changes");
  console.log("  the slate, the hold, the book size or any gate.\n");

  // ---- 4. coverage and missing bars ------------------------------------------------------------
  console.log("=== 4. COVERAGE AND MISSING BARS ===");
  console.log("  pool            mean sessions held   windows short of hold   pool<book+1   identical");
  const cov = (label, m) =>
    console.log(`  ${label.padEnd(14)}  ${m.meanSeen.toFixed(3).padStart(17)}   ` +
                `${(m.truncatedShare * 100).toFixed(2).padStart(21)}%   ${(m.poolTooSmallShare * 100).toFixed(2).padStart(10)}%` +
                `   ${(m.identicalShare * 100).toFixed(2).padStart(9)}%`);
  cov("full universe", full);
  for (const slate of slateValues) cov(`slate=${slate}`, slateRuns.get(slate));
  console.log(`  A name missing a bar is SKIPPED, not forward-filled, so it holds for fewer sessions and`);
  console.log(`  the window is quietly shorter. "mean sessions held" of exactly ${HOLD}.000 means no gaps`);
  console.log("  were encountered; anything less means some names held shorter than the nominal hold.");
  console.log("  'pool<book+1' counts draws where the pool was too small to yield a DISTINCT control;");
  console.log("  'identical' is how often control and book came out as the same names, which is the");
  console.log("  degeneracy itself rather than a proxy for it.\n");

  // ---- 5. two uncertainties, and the dependence sensitivity ------------------------------------
  console.log("=== 5. SIMULATION vs SAMPLING UNCERTAINTY (full universe, book of 10) ===");
  const seeds = [SEED, SEED + 1, SEED + 2, SEED + 3, SEED + 4];
  const perSeed = seeds.map((sd0) =>
    measureWithPool(panel, starts, () => panel.names, { bookSize: 10, hold: HOLD, draws: DRAWS, seed: sd0 }).sd);
  const iid = periodBootstrapSd(full.byPeriod, seededRng(SEED + 31337));
  const blk = blockBootstrapSd(full.byPeriod, seededRng(SEED + 31337), { blockLength: 5 });
  const blk13 = blockBootstrapSd(full.byPeriod, seededRng(SEED + 31337), { blockLength: 13 });
  console.log(`  CONDITIONAL SIMULATION ERROR — how precisely the Monte Carlo pinned down the dispersion`);
  console.log(`  of the FIXED empirical distribution. Draws are i.i.d. from that distribution, so a`);
  console.log(`  repeated date does NOT make them dependent; it just adds no new history.`);
  console.log(`    ${seeds.length} seeds: ${perSeed.map(pct3).join(", ")}   spread ${pct3(Math.max(...perSeed) - Math.min(...perSeed))}`);
  console.log(`    analytic se at ${full.n} draws: ${pct3(full.mcSe)}   -> shrinks as 1/sqrt(draws)`);
  console.log(`  SAMPLING / GENERALISATION ERROR — how far that empirical distribution may sit from the`);
  console.log(`  one a future period is drawn from. Bounded by ${iid.clusters} periods, not by draws.`);
  console.log(`    i.i.d. period bootstrap 95%   ${pct3(iid.lo)} .. ${pct3(iid.hi)}   width ${pct3(iid.hi - iid.lo)}`);
  console.log(`    block bootstrap, L=5          ${pct3(blk.lo)} .. ${pct3(blk.hi)}   width ${pct3(blk.hi - blk.lo)}`);
  console.log(`    block bootstrap, L=13         ${pct3(blk13.lo)} .. ${pct3(blk13.hi)}   width ${pct3(blk13.hi - blk13.lo)}`);
  console.log("  THE BLOCK VERSIONS ARE A SENSITIVITY, NOT A CORRECTION. The i.i.d. bootstrap treats");
  console.log("  periods as exchangeable; blocks preserve local dependence. Neither is known to be right,");
  console.log("  and the direction of the i.i.d. error is NOT determined — positive dependence within a");
  console.log("  regime can inflate the true sampling variance, while a realised sequence more homogeneous");
  console.log("  than an i.i.d. draw from a heterogeneous pool cuts the other way. An earlier report of");
  console.log("  mine called the i.i.d. interval a 'floor' and asserted it understates; that claimed a");
  console.log("  direction nothing here establishes. Read the three widths as a range of modelling");
  console.log("  assumptions.\n");

  console.log("WHAT THIS ESTABLISHES: the runtime's control pool is the point-in-time slate with overlap");
  console.log("permitted, and at the deployed slate=300 against this 127-name panel that pool is the whole");
  console.log("universe — so the registered sigma was measured against the right pool by coincidence of");
  console.log("sizing, not by design. WHAT IT DOES NOT: anything about whether a strategy has an edge.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
