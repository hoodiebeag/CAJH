#!/usr/bin/env node
/**
 * power-sensitivity.mjs — how much does the registered MDE depend on choices nobody has measured?
 *
 * `docs/PAPER-PROTOCOL.md` registered a power table at ONE book size (10), ONE hold (5), ONE window
 * (the whole panel) and ONE control-sampling rule. Each of those is a choice, and the registered
 * numbers inherit all four. This measures the sensitivity to each, so a period count registered in the
 * candidate ledger can be chosen knowing which assumptions it rests on.
 *
 * READ THIS BEFORE READING ANY NUMBER BELOW.
 *
 * 1. NOTHING HERE IS EVIDENCE ABOUT A STRATEGY. Every figure is a property of the NULL — two random
 *    books drawn from the same eligible pool at the same instant, differenced. It measures the noise a
 *    claimed edge would have to clear. It cannot show an edge exists and it does not test the analyst.
 *
 * 2. HISTORICAL EXPLORATION, NOT PROSPECTIVE EVIDENCE. This reads past prices. A prospective result
 *    requires forward decisions journalled before their outcomes are known, of which there are
 *    currently zero. Nothing measured here can be promoted into the forward record.
 *
 * 3. TODAY'S UNIVERSE, SO SURVIVORSHIP IS PRESENT. The symbols are the ones in the candidate list now.
 *    Names delisted, acquired or renamed over the window are absent, so this is not the cross-section
 *    a decision at the time would have faced. The effect on return LEVELS is upward and well known;
 *    the effect on the DISPERSION of a paired difference between two books from the same pool is
 *    second-order, and is not corrected for. Treat every sigma as "measured on survivors".
 *
 * 4. EVERY MDE IS A PLANNING ESTIMATE, NOT ACHIEVED POWER. The normal approximation assumes a known
 *    sigma and independent periods. Sigma is estimated; real per-period differences are fat-tailed in
 *    the direction that costs power; and non-overlap does not remove a shared market regime across
 *    adjacent periods. These numbers answer "how long before this is worth looking at", never "80%
 *    power was achieved".
 *
 * 5. TWO UNCERTAINTIES, REPORTED SEPARATELY, BECAUSE THEY BEHAVE DIFFERENTLY. Monte Carlo error
 *    shrinks as draws are added. Historical sample uncertainty does not: it is bounded by how many
 *    non-overlapping periods the panel contains. Quoting only the first makes an estimate look far
 *    more certain than it is.
 *
 * It amends no protocol, changes no gate, chooses no book size, and touches no risk or sizing rule.
 * `docs/PAPER-PROTOCOL.md` is the fixed reference; this is a measurement beside it.
 *
 * Usage: node power-sensitivity.mjs [draws]      (default 20000; deterministic given the seed)
 */

import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { seededRng } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";
import { mde, annualise, nonOverlappingStarts, TRADING_DAYS_PER_YEAR } from "./analyst/power.mjs";
import {
  buildReturnMap, drawPair, sd, mean, monteCarloSeOfSd, periodBootstrapSd,
} from "./analyst/panel-null.mjs";

/** See slate-null.mjs: `--root ibkr-bundle` measures the live panel instead of the 127-name research one. */
const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
export const ROOT = flag("root", "sp500-bundle");
export const SEED = 20261005;
export const HOLD = 5;                 // the registered hold; this tool varies other things
export const FIRST_START = 250;        // clears the 252-bar ranking warm-up used by the analyst
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const DRAWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20000);

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "—");
const pct3 = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)}%` : "—");

/** Load the panel and report the eligible universe transparently. */
export function loadPanel(root = ROOT) {
  const raw = {};
  for (const s of availablePairs(1440, root)) raw[s] = loadBundleCandles(s, 1440, root);
  const screened = screenUniverse(raw);
  const panel = buildReturnMap(screened.kept);
  return { ...panel, rawCount: Object.keys(raw).length, rejected: screened.rejected ?? [] };
}

/**
 * Measure the null's per-period paired spread for one configuration.
 *
 * Diffs are grouped by start index so the period bootstrap can resample whole periods. `seen` is the
 * mean number of returns actually compounded per name: below `hold` means some symbol was missing bars
 * and silently held for fewer sessions.
 */
export function measure(panel, { bookSize, hold, draws, seed, disjoint = true,
                                firstStart = FIRST_START, lastIndex = null }) {
  const end = lastIndex ?? panel.dates.length;
  const starts = nonOverlappingStarts(firstStart, hold, end);
  if (!starts.length) return { sd: 0, n: 0, periods: 0, starts: 0, empty: true };
  const rng = seededRng(seed);
  const diffs = [];
  const byPeriod = new Map();
  let seenSum = 0;
  for (let d = 0; d < draws; d++) {
    const i = starts[Math.floor(rng() * starts.length)];
    const r = drawPair(panel, panel.names, bookSize, i, hold, LEG, rng, { disjoint });
    if (!r) continue;
    diffs.push(r.diff);
    seenSum += r.seen;
    if (!byPeriod.has(i)) byPeriod.set(i, []);
    byPeriod.get(i).push(r.diff);
  }
  const s = sd(diffs);
  return {
    sd: s, mean: mean(diffs), n: diffs.length,
    starts: starts.length,                       // non-overlapping periods AVAILABLE
    periods: byPeriod.size,                      // distinct periods actually drawn
    mcSe: monteCarloSeOfSd(s, diffs.length),
    meanSeen: diffs.length ? seenSum / diffs.length : 0,
    byPeriod, empty: false,
  };
}

function banner() {
  console.log("POWER SENSITIVITY — how the registered MDE moves with choices nobody had measured");
  console.log(`root ${ROOT}, seed ${SEED}, ${DRAWS} draws per configuration, per-leg cost ${pct3(LEG)}`);
  console.log("NULL ONLY: two random books from the same pool, differenced. Not evidence of edge.");
  console.log("HISTORICAL, on TODAY's universe (survivorship present). Not prospective evidence.");
  console.log("Every MDE is a PLANNING estimate under a normal approximation, not achieved power.\n");
}

async function main() {
  banner();
  const panel = loadPanel();
  const span = (i) => new Date(panel.dates[i] * 1000).toISOString().slice(0, 10);

  // ---- 0. the eligible universe, stated rather than assumed ------------------------------------
  console.log("=== 0. ELIGIBLE UNIVERSE ===");
  console.log(`  symbols in bundle   ${panel.rawCount}`);
  console.log(`  kept by screenUniverse  ${panel.names.length}   rejected ${panel.rejected.length}`);
  if (panel.rejected.length) {
    const byReason = new Map();
    for (const [, why] of panel.rejected) {
      const key = String(why).split(/[:(]/)[0].trim();
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${why}`);
  }
  console.log(`  dates ${panel.dates.length}  (${span(0)} .. ${span(panel.dates.length - 1)})`);
  console.log(`  non-overlapping ${HOLD}-day periods from index ${FIRST_START}: ` +
              `${nonOverlappingStarts(FIRST_START, HOLD, panel.dates.length).length}`);
  console.log("  The control pool is this screened list. loop.mjs passes the context's candidate");
  console.log("  slate, which at slate=300 against this many names IS the whole screened universe —");
  console.log("  so drawing from all names is realistic HERE and would not be on a larger universe.\n");

  // ---- 1. does the control-sampling rule change the answer? ------------------------------------
  console.log("=== 1. CONTROL SAMPLING: disjoint books vs the journal's actual rule ===");
  const disj = measure(panel, { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED, disjoint: true });
  const over = measure(panel, { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED, disjoint: false });
  console.log(`  disjoint (paper-power.mjs)      sd ${pct3(disj.sd)}  +- ${pct3(disj.mcSe)} MC`);
  console.log(`  overlap permitted (journal.mjs) sd ${pct3(over.sd)}  +- ${pct3(over.mcSe)} MC`);
  console.log(`  ratio ${(over.sd / disj.sd).toFixed(4)}`);
  console.log("  matchedRandomControl shuffles the eligible pool and takes the first n names WITHOUT");
  console.log("  reference to the analyst's picks, so control and book may share names. Overlap");
  console.log("  correlates the two books and shrinks the variance of their difference, so the");
  console.log("  disjoint draw gives the LARGER sigma and hence the more conservative MDE.");
  console.log("  Neither is wrong; they answer different questions. The registered table used disjoint.\n");

  // ---- 2. book size, measured and not chosen ---------------------------------------------------
  console.log("=== 2. BOOK SIZE ===");
  console.log("  MEASURED, NOT CHOSEN. The real book size is governed by analyst/risk.mjs limits and by");
  console.log("  what the analyst proposes; this tool does not set it and does not recommend one.");
  console.log("  book   sigma/period   MC se    historical 95% CI (period bootstrap)   MDE@50p   ann.");
  const bookRows = [];
  for (const bookSize of [1, 3, 5, 10, 20, 40]) {
    const m = measure(panel, { bookSize, hold: HOLD, draws: DRAWS, seed: SEED + bookSize });
    const boot = periodBootstrapSd(m.byPeriod, seededRng(SEED + 7919 + bookSize));
    const m50 = mde(m.sd, 50);
    bookRows.push({ bookSize, ...m, boot, m50 });
    console.log(`  ${String(bookSize).padStart(4)}   ${pct3(m.sd).padStart(12)}   ${pct3(m.mcSe).padStart(6)}   ` +
                `${(pct3(boot.lo) + " .. " + pct3(boot.hi)).padStart(36)}   ${pct3(m50).padStart(7)}   ${pct(annualise(m50, HOLD))}`);
  }
  const b1 = bookRows.find((r) => r.bookSize === 1), b40 = bookRows.find((r) => r.bookSize === 40);
  console.log(`  sigma falls ${(b1.sd / b40.sd).toFixed(2)}x from a 1-name book to a 40-name book` +
              ` (1/sqrt(n) would give ${Math.sqrt(40).toFixed(2)}x):`);
  console.log("  diversification removes idiosyncratic variance from BOTH books. A larger real book");
  console.log("  therefore makes every registered MDE PESSIMISTIC — the registered table assumed 10.");
  console.log("  The 95% CI is a bootstrap over whole PERIODS and does not shrink with more draws.");
  console.log("");
  console.log("  CONFOUND AT THE LARGE END, so the top rows are not clean. Two DISJOINT books of 40");
  console.log(`  consume 80 of ${panel.names.length} eligible names, so the disjointness constraint`);
  console.log("  binds: sampling without replacement from a nearly-exhausted pool makes the two books");
  console.log("  negatively correlated, which INFLATES the variance of their difference. The large-book");
  console.log("  sigmas are therefore biased upward relative to a draw from an unlimited pool, and the");
  console.log("  measured ratio understates true diversification. The journal's rule does not impose");
  console.log("  disjointness at all (section 1), so this confound is an artifact of the measurement");
  console.log("  convention rather than of the strategy.\n");

  // ---- 3. window length: the one lever the hold algebra leaves open -----------------------------
  console.log("=== 3. WINDOW LENGTH (sigma from the full panel, book of 10) ===");
  console.log("  Window length is the only lever the hold-invariance algebra does not close: MDE falls");
  console.log("  as 1/sqrt(W). Periods are floor(W/hold); a hold that does not divide W leaves a");
  console.log("  fractional period that cannot be run, so the floor is the realisable count.");
  console.log("  window        periods   MDE/period   annualised   note");
  for (const [label, W] of [["20 trading days", 20], ["60 trading days", 60], ["6 months", 126],
                            ["1 year", 252], ["2 years", 504], ["5 years", 1260]]) {
    const n = Math.floor(W / HOLD);
    const m = mde(disj.sd, n);
    const exact = W / HOLD;
    const note = Number.isInteger(exact) ? "" : `(${exact.toFixed(1)} exact, ${n} realisable)`;
    console.log(`  ${label.padEnd(14)}${String(n).padStart(7)}   ${pct3(m).padStart(10)}   ` +
                `${pct(annualise(m, HOLD)).padStart(10)}   ${note}`);
  }
  console.log(`  The panel itself holds ${disj.starts} periods, so windows beyond ~${disj.starts * HOLD}`);
  console.log("  trading days are extrapolations of this sigma, not measurements of that window.\n");

  // ---- 4. is sigma stable across time? ---------------------------------------------------------
  console.log("=== 4. SIGMA STABILITY ACROSS CHRONOLOGICAL SUB-WINDOWS (book of 10) ===");
  console.log("  The registered table rests on ONE window. If sigma is regime-dependent, the");
  console.log("  registered MDE is an artifact of this sample rather than a property of the strategy.");
  console.log("  sub-window                  periods   sigma/period   MC se    MDE@periods available");
  const usable = panel.dates.length - FIRST_START;
  const quarters = 4;
  const subRows = [];
  for (let q = 0; q < quarters; q++) {
    const from = FIRST_START + Math.floor((usable * q) / quarters);
    const to = FIRST_START + Math.floor((usable * (q + 1)) / quarters);
    const m = measure(panel, { bookSize: 10, hold: HOLD, draws: DRAWS, seed: SEED + 100 + q,
                               firstStart: from, lastIndex: to });
    subRows.push({ q, from, to, ...m });
    const label = `${span(from)} .. ${span(Math.min(to, panel.dates.length - 1))}`;
    console.log(`  ${label.padEnd(26)}${String(m.starts).padStart(7)}   ${pct3(m.sd).padStart(12)}   ` +
                `${pct3(m.mcSe).padStart(6)}   ${pct3(mde(m.sd, Math.max(1, m.starts)))}`);
  }
  const sds = subRows.map((r) => r.sd);
  const ratio = Math.max(...sds) / Math.min(...sds);
  console.log(`  spread: min ${pct3(Math.min(...sds))}, max ${pct3(Math.max(...sds))}, ratio ${ratio.toFixed(2)}x`);
  console.log(`  Full-panel sigma for the same configuration: ${pct3(disj.sd)}.`);
  console.log(`  ${ratio > 1.5 ? "SIGMA IS NOT STABLE across sub-windows: a single-window MDE understates"
                               : "Sigma is broadly stable across sub-windows at this resolution, so the"}`);
  console.log(`  ${ratio > 1.5 ? "  how much the number could differ in another regime."
                               : "  single-window MDE is not obviously a regime artifact."}`);
  console.log("  Each sub-window has roughly a quarter of the periods, so each estimate is");
  console.log("  correspondingly noisier — the MC se column is the draw error, not the period error.\n");

  // ---- 5. the two uncertainties, side by side --------------------------------------------------
  console.log("=== 5. MONTE CARLO vs HISTORICAL SAMPLE UNCERTAINTY (book of 10) ===");
  const seeds = [SEED, SEED + 1, SEED + 2, SEED + 3, SEED + 4];
  const perSeed = seeds.map((sd0) => measure(panel, { bookSize: 10, hold: HOLD, draws: DRAWS, seed: sd0 }).sd);
  const mcSpread = Math.max(...perSeed) - Math.min(...perSeed);
  const boot = periodBootstrapSd(disj.byPeriod, seededRng(SEED + 31337));
  console.log(`  same config at ${seeds.length} seeds: ${perSeed.map(pct3).join(", ")}`);
  console.log(`  Monte Carlo spread (max-min)        ${pct3(mcSpread)}   <- shrinks with more draws`);
  console.log(`  period bootstrap 95% CI             ${pct3(boot.lo)} .. ${pct3(boot.hi)}   ` +
              `(${boot.clusters} periods, ${boot.iterations} iters)`);
  console.log(`  width of that CI                    ${pct3(boot.hi - boot.lo)}   <- does NOT shrink with draws`);
  console.log(`  ratio                               ${((boot.hi - boot.lo) / Math.max(1e-12, mcSpread)).toFixed(1)}x`);
  console.log("  The second is the one that limits what this panel can say.");
  console.log(`  Draws resample ${boot.clusters} distinct periods, so with ${DRAWS} draws each period recurs`);
  console.log("  many times. THAT DOES NOT MAKE THEM DEPENDENT: conditional on the panel, the draws are");
  console.log("  i.i.d. from a fixed empirical distribution, which is what makes the simulation se valid.");
  console.log("  What repeats fail to supply is NEW HISTORICAL EVIDENCE. An earlier version of this");
  console.log("  output called repeats 'dependent'; that was wrong.");
  console.log("  The period bootstrap resamples periods i.i.d., so it does not model regime dependence");
  console.log("  between adjacent periods — but the DIRECTION of that omission is not determined, and an");
  console.log("  earlier version called the interval a 'floor'. It is a limitation, not a bound. See");
  console.log("  slate-null.mjs for a contiguous-block bootstrap run alongside it as a sensitivity.\n");

  console.log("WHAT THIS DOES AND DOES NOT ESTABLISH: it measures how the null's spread — and therefore");
  console.log("the planning MDE — responds to book size, window length, sub-period and control-sampling");
  console.log("rule. It chooses none of them, amends no protocol, and is not evidence that any strategy");
  console.log("has an edge. See docs/POWER-VALIDATION.md.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
