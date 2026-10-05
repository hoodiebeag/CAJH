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

/**
 * The panel to measure. Defaults to the research bundle; `--root ibkr-bundle` points it at the live
 * panel, which matters more than it looks: `universe/candidates.txt` holds **1,047 tickers** (confirmed
 * by a panel pull on 2026-10-05), while `sp500-bundle` holds 127 screened names. At 127 names a
 * slate of 300 IS the whole cross-section; at 1,047 it is roughly 29% of it, and section 3 measures
 * that a slate narrower than the universe raises sigma. So the same code answers a different question
 * depending on this flag, and the report prints which panel it read.
 */
const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
export const ROOT = flag("root", "sp500-bundle");
export const SEED = 20261006;
export const HOLD = 5;
export const FIRST_START = 252;        // the momentum warm-up; buildContext can rank nothing earlier
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
// The first bare numeric argument is the draw count, so `--root X 5000` and `5000 --root X` both work.
const DRAWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20000);

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
 * A DETERMINISTIC SYNTHETIC CARRY RULE. Not an analyst, not an account, not a strategy.
 *
 * WHAT THIS CLOSES. `slateFor` is called with `positions: {}` everywhere else in this tool, so the
 * reconstructed pool omits held names — and `buildContext` shows held names ON TOP of the ranked slate,
 * which makes a live pool WIDER than a flat one. That was the one labelled approximation left in the
 * slate measurement. This measures its size.
 *
 * THE RULE, STATED SO IT CANNOT BE MISREAD AS A BOOK: at period p the "held" names are the random book
 * that was drawn at period p-1. Nothing selects them, nothing optimises them, and they are drawn from a
 * stream seeded independently of the measurement draws. Period 0 starts flat.
 *
 * CARRYING RANDOM BOOKS CANNOT MAKE THIS EVIDENCE ABOUT THE ANALYST. The quantity under test forward is
 * a fixed analyst book against one random control; this is still random-versus-random, now with a
 * random book persisting for one period. It measures ONLY how pool composition responds to holding
 * something — a planning-proxy sensitivity. It says nothing about the analyst's paired variance, and a
 * real book would be selected, concentrated and correlated in ways a random carry is not.
 *
 * WHY THE POOL MUST NOT DEPEND ON THE DRAW. `measureWithPool` groups diffs by period for the bootstrap,
 * so `poolFor(i)` has to be a function of the period alone. The chain is therefore precomputed once per
 * (slate, bookSize, seed) and cached, rather than evolving as draws are taken.
 *
 * HOLDING CHANGES THE SLATE THROUGH TWO CHANNELS, NOT ONE — found by a test that assumed otherwise.
 * `context.mjs` builds the ranked slices from `rest = rows.filter(r => !r.held)`, so held names are
 * EXCLUDED from the ranking before the top and bottom halves are taken. Holding 10 names therefore
 * (a) adds those names to the pool, and (b) PROMOTES 10 names that the flat ranking had excluded, as
 * the halves slide down the cross-section. A test asserting "anything beyond the flat ranked slate must
 * be a carried name" failed on a promoted name, which was the test's error rather than the rule's.
 * `heldByPeriod` is returned so the chain can be audited directly instead of inferred from the pool.
 *
 * INDEXING, AUDITED. The held names at period p were chosen at `starts[p-1]`, which is strictly earlier
 * than `starts[p]`, and the slate at `starts[p]` is built by `buildContext` with `asOf = starts[p]`. So
 * no future bar is visible, and the carried names are not information from the future either — they are
 * a past random draw. `avgPrice` is the entry bar's actual close, looked up point-in-time.
 */
export function carriedPools(grids, starts, { slate = 300, bookSize = 10, seed = SEED, holdPct = 0.05 } = {}) {
  const { kept, barDates } = grids;
  // Index i in a symbol's candle array corresponds to barDates[i] only if every series shares the grid.
  // loadGrids already asserts one shared first bar; this asserts the length, since a short series would
  // make avgPrice read the wrong bar.
  for (const [sym, bars] of Object.entries(kept)) {
    if (bars.length !== barDates.length) {
      throw new Error(`carriedPools: ${sym} has ${bars.length} bars against a ${barDates.length}-bar grid; ` +
                      `the avgPrice lookup below would read the wrong date`);
    }
  }
  const rng = seededRng(seed);
  const pools = new Map();
  const heldByPeriod = new Map();      // exposed so a test can audit the chain directly
  const heldCounts = [];
  let held = {};                       // period 0 is flat, by construction
  for (const i of starts) {
    const s = slateFor(grids, i, { slate, positions: held });
    pools.set(i, s.symbols);
    heldByPeriod.set(i, Object.keys(held));
    heldCounts.push(Object.keys(held).length);
    // Next period's held names: a random book out of THIS period's pool, at this period's close.
    const bag = [...s.symbols];
    const next = {};
    for (let k = 0; k < bookSize && bag.length; k++) {
      const sym = bag.splice(Math.floor(rng() * bag.length), 1)[0];
      next[sym] = { pct: holdPct, avgPrice: Number(kept[sym][i].close) };
    }
    held = next;
  }
  return { pools, heldByPeriod, meanHeld: mean(heldCounts),
           meanPool: mean([...pools.values()].map((p) => p.length)) };
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
  // Found generically rather than by hardcoding a slate value: SLATE_NULL_SLATES can omit any of them,
  // and an earlier version indexed slateRuns.get(10) unconditionally and threw on an override without it.
  const s300 = slateRuns.get(300) ?? null;
  if (s300) {
    console.log(`  ratio slate=300 / full universe: ${(s300.sd / full.sd).toFixed(4)}  <- expect ~1, same pool`);
  }
  const degenSlates = slateValues.filter((v) => slateRuns.get(v).degenerate);
  if (degenSlates.length) {
    const s10 = slateRuns.get(degenSlates[0]);
    console.log("");
    console.log(`  DEGENERATE AT slate=${degenSlates.join(", ")}, AND THIS IS A REAL PROPERTY OF THE RUNTIME,`);
    console.log(`  not a tool bug: a slate no larger than the book means the control draw takes the whole pool, so`);
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
  if (!usable.length) {
    console.log("  Every configured slate was degenerate, so there is no dispersion comparison to make.");
    console.log("");
  }
  const worst = usable.length
    ? usable.reduce((a, v) => (slateRuns.get(v).sd > slateRuns.get(a).sd ? v : a), usable[0]) : null;
  const worstRatio = worst === null ? NaN : slateRuns.get(worst).sd / full.sd;
  if (worst !== null) {
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
  }

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

  // ---- 6. the held-book approximation, measured -----------------------------------------------
  console.log("=== 6. FLAT vs CARRIED-BOOK POOL (deterministic SYNTHETIC carry, book of 10) ===");
  console.log("  THE RULE: at period p the held names are the random book drawn at period p-1, from a");
  console.log("  stream seeded independently of the measurement draws. Period 0 is flat. Nothing selects");
  console.log("  or optimises them. THIS IS NOT AN ANALYST BOOK AND NOT AN ACCOUNT.");
  console.log("  Carrying random books cannot turn this into evidence about the analyst's paired");
  console.log("  variance: it is still random-vs-random, now with a random book persisting one period.");
  console.log("  It measures ONLY how pool composition responds to holding something.");
  console.log("");
  console.log("  AUDIT OF THE RULE, before any sigma:");
  const auditSlate = 40;
  const auditCarry = carriedPools(grids, starts, { slate: auditSlate, bookSize: 10, seed: SEED + 991 });
  const firstKey = starts[0], secondKey = starts[1];
  console.log(`    period 0 (bar ${new Date(barDates[firstKey] * 1000).toISOString().slice(0, 10)}) held 0 names, pool ${auditCarry.pools.get(firstKey).length}`);
  console.log(`    period 1 (bar ${new Date(barDates[secondKey] * 1000).toISOString().slice(0, 10)}) pool ${auditCarry.pools.get(secondKey).length}`);
  console.log(`    mean held across periods ${auditCarry.meanHeld.toFixed(2)} (expect ~10 after period 0)`);
  console.log(`    mean pool at slate=${auditSlate}: ${auditCarry.meanPool.toFixed(2)} vs ${auditSlate} flat`);
  console.log("    held names are shown ON TOP of the ranked slate, so a carried pool is WIDER; the");
  console.log("    excess over the flat slate is the held names the ranking would not have shown.");
  console.log("");
  // PAIRED AND ORDER-NORMALISED, because two things were confounding this comparison.
  //
  // First a different seed: the slate=300 row showed a 1.052 ratio while both pools held the same 127
  // names -- pure Monte Carlo reading as a 5% effect. Both runs now share one seed per slate.
  //
  // Second, ORDER. buildContext returns [...held, ...top, ...bottom] and excludes held names from the
  // ranked slices, so a carried pool is a different PERMUTATION of the same set at slate=300, and
  // drawPair splices by index -- so identical sets still drew different names and left a spurious
  // 1.012. Both pools are sorted here. That is faithful to the runtime rather than a convenience:
  // matchedRandomControl SHUFFLES the pool before taking names, so pool order carries no meaning.
  console.log("  Flat and carried share one seed per slate and both pools are sorted, so a set-identical");
  console.log("  pool gives a ratio of exactly 1.000 and any departure is the pool, not the stream.");
  console.log("  slate   flat pool   carried pool   flat sigma   carried sigma   ratio   same set?");
  const sorted = (a) => [...a].sort();
  for (const slate of slateValues) {
    const flatCache = slateCache.get(slate);
    const flatRun = measureWithPool(panel, starts, (i) => sorted(flatCache.get(i)),
      { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED + slate });
    const carry = carriedPools(grids, starts, { slate, bookSize: 10, seed: SEED + 991 });
    const carriedRun = measureWithPool(panel, starts, (i) => sorted(carry.pools.get(i)),
      { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED + slate });
    const sameSet = starts.every((i) =>
      JSON.stringify(sorted(flatCache.get(i))) === JSON.stringify(sorted(carry.pools.get(i))));
    const fs = flatRun.degenerate ? "DEGEN" : pct3(flatRun.sd);
    const cs = carriedRun.degenerate ? "DEGEN" : pct3(carriedRun.sd);
    const ratio = (flatRun.degenerate || carriedRun.degenerate) ? "—"
                : (carriedRun.sd / flatRun.sd).toFixed(3);
    console.log(`  ${String(slate).padStart(5)}   ${flatRun.meanPoolSize.toFixed(1).padStart(9)}   ` +
                `${carry.meanPool.toFixed(1).padStart(12)}   ${fs.padStart(10)}   ${cs.padStart(13)}   ` +
                `${ratio.padStart(5)}   ${sameSet ? "yes" : "no"}`);
  }
  const carry300 = carriedPools(grids, starts, { slate: 300, bookSize: 10, seed: SEED + 991 });
  const equiv = Math.abs(carry300.meanPool - panel.names.length) < 1e-9;
  console.log("");
  console.log(`  DOES THE DEPLOYED slate=300 / FULL-POOL EQUIVALENCE SURVIVE A CARRIED BOOK? ${equiv ? "YES" : "NO"}`);
  console.log(`  carried mean pool at slate=300 is ${carry300.meanPool.toFixed(2)} against ${panel.names.length} screened names.`);
  console.log("  The reason is structural, not lucky: the ranked slice already returns the ENTIRE");
  console.log("  cross-section at slate=300, and held names are drawn FROM that pool, so there is");
  console.log("  nothing left for them to add. Holding changes the pool only when the ranking was");
  console.log("  actually excluding something — i.e. only when slate < universe.");
  console.log("  At smaller slates the pool widens by up to the book size and the ranked extremes get");
  console.log("  diluted by whatever was held, which is why the sigma ratio moves there and not at 300.");
  console.log("  STILL A PLANNING PROXY. None of this measures an analyst book.\n");

  console.log("WHAT THIS ESTABLISHES: the runtime's control pool is the point-in-time slate with overlap");
  console.log("permitted, and at the deployed slate=300 against this 127-name panel that pool is the whole");
  console.log("universe — so the registered sigma was measured against the right pool by coincidence of");
  console.log("sizing, not by design. WHAT IT DOES NOT: anything about whether a strategy has an edge.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
