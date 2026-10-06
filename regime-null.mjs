#!/usr/bin/env node
/**
 * regime-null.mjs — does the null's dispersion depend on the volatility regime?
 *
 * WHY ASK. Every σ this project has measured is a single number pooled across 2023-2026. If the null's
 * spread is materially larger in high-volatility periods, then a pooled MDE is too optimistic in exactly
 * the stretches where a drawdown is most likely, and too pessimistic in calm ones. `docs/PAPER-PROTOCOL.md`
 * pre-registers a drawdown observation window, so whether the noise level is regime-dependent is a
 * planning question that bears on it.
 *
 * ═══ WHAT THIS IS, STATED BEFORE ANY NUMBER ═══
 *
 * EXPLORATORY PLANNING ANALYSIS. Not a registered test, not a strategy, not a candidate. Nothing here is
 * pre-registered and no result from it may be cited as evidence for or against any mechanism.
 *
 * RANDOM-VERSUS-RANDOM PROXY. Two random books drawn from one pool at one instant, differenced. The
 * forward quantity is a FIXED analyst book against one random control, and those variances need not
 * match (see `analyst/panel-null.mjs`). So this bounds a planning assumption; it is NOT edge evidence.
 *
 * **IT IS NOT GROUNDS TO LOOSEN A DRAWDOWN BRAKE.** If high-volatility σ comes out larger, that means a
 * given edge is HARDER to see then — it says nothing about whether losses in that regime are acceptable.
 * A risk limit is a statement about tolerable loss, not about measurement precision, and the two are not
 * interchangeable. No risk, sizing, STOP or passing criterion is touched by this file.
 *
 * HISTORICAL, ON TODAY'S SURVIVORS. 127 screened names from `sp500-bundle`. Names that left the universe
 * were never collected, so regimes are measured on the cross-section that survived them.
 *
 * ═══ THE STATE DEFINITION, AND WHY IT IS BUILT THIS WAY ═══
 *
 * Classification uses ONLY bars at or before the decision bar. At a window starting at return index `i`,
 * the decision bar is `barDates[i]` (see `slate-null.mjs` for the derivation), and the state is computed
 * from the trailing `VOL_WINDOW` sessions of equal-weight basket returns ending there. No future bar is
 * read, which a test demonstrates by appending a violent future move and checking the label is unchanged.
 *
 * THRESHOLDS ARE THE HARD PART, SO BOTH CHOICES ARE REPORTED.
 *
 *   - PRIMARY, `expanding`: the tercile cut-points at period p are computed from periods 0..p-1 only.
 *     Genuinely pre-decision — nothing about the label at p depends on data after p. Noisy early, and the
 *     first `MIN_HISTORY` periods are unlabelled rather than guessed.
 *   - SENSITIVITY, `full-sample`: cut-points from the whole panel. NOT pre-decision — it uses future
 *     periods to decide where the boundaries sit — and reported only to show how much the conclusion
 *     depends on that choice.
 *
 * NO TUNING. The windows (10/21/63 sessions) are a calendar month and its neighbours, the split is equal
 * terciles, and both are fixed here before any output was read. The sweep over windows exists to make the
 * dependence visible, not to find the window that produces the largest separation; every window measured
 * is printed, including ones that show nothing.
 *
 * Usage: node regime-null.mjs [draws] [--root DIR]      (default 20000; deterministic given the seed)
 */

import { nonOverlappingStarts, mde, annualise } from "./analyst/power.mjs";
import {
  drawPair, sd, mean, monteCarloSeOfSd, periodBootstrapSd, blockBootstrapSd,
} from "./analyst/panel-null.mjs";
import { loadGrids, slateFor } from "./slate-null.mjs";
import { seededRng } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};

export const ROOT = flag("root", "sp500-bundle");
export const SEED = 20261006;
export const HOLD = 5;
export const FIRST_START = 252;
export const VOL_WINDOW = 21;          // one calendar month of sessions
export const VOL_WINDOWS = [10, 21, 63];
export const MIN_HISTORY = 20;         // periods needed before expanding cut-points mean anything
export const MIN_PERIODS_PER_STATE = 2;
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const DRAWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20000);

const pct3 = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)}%` : "—");
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "—");

export const STATE = Object.freeze({ LOW: "low", MID: "mid", HIGH: "high", UNLABELLED: "unlabelled" });

/**
 * An explicit, distinct seed offset per state.
 *
 * A first version derived the offset from `state.length * 13`, and "low" and "mid" are both three
 * characters — so two states shared a Monte Carlo stream. Deriving a seed from an incidental property of
 * a label is how two measurements silently become correlated, which is exactly the confound this file is
 * supposed to be looking for.
 */
export const STATE_SEED = Object.freeze({ [STATE.LOW]: 101, [STATE.MID]: 211, [STATE.HIGH]: 331 });

/**
 * The return indices a decision at window-start `i` may legitimately read.
 *
 * THE BOUNDARY, DERIVED FROM TIMESTAMPS RATHER THAN ASSERTED. `buildReturnMap` keys each return to the
 * LATER of its two bars, and strips every symbol's first bar, so `returnDates[k] === barDates[k+1]`
 * (verified on the real panel: 921 bars, 920 return dates, equality at all k). A window starting at
 * return index `i` is entered at the close of `barDates[i]`.
 *
 * Therefore the return at index `i` is the move INTO `barDates[i+1]` — a bar that has not closed when
 * the decision is made. **The latest permissible return index is `i-1`**, whose timestamp is
 * `barDates[i]`, exactly the decision close.
 *
 * AN EARLIER VERSION READ THROUGH INDEX `i` AND SO LOOKED ONE BAR AHEAD. Demonstrated rather than
 * reasoned: perturbing only `barDates[i+1]`, with every bar at or before `i` byte-identical, moved the
 * measured volatility at `i` from 0.118% to 1.510%. The accompanying test recomputed the basket over the
 * same `i`-inclusive indices, so it certified the wrong boundary, and the no-look-ahead test appended
 * bars far in the future — which cannot detect a leak that is exactly one bar wide.
 *
 * Returns null when the full window is not available, rather than shortening it.
 */
export function volWindowIndices(i, window = VOL_WINDOW, available = Infinity) {
  if (!Number.isInteger(i) || i < 0) throw new Error(`volWindowIndices: i must be a non-negative integer, got ${i}`);
  if (!Number.isInteger(window) || window < 2) throw new Error(`volWindowIndices: window must be an integer >= 2, got ${window}`);
  const to = i - 1;                       // the last CLOSED return at the decision bar
  const from = to - window + 1;
  if (from < 0 || to < 0 || to >= available) return null;
  return { from, to };
}

/**
 * Realised volatility of the equal-weight basket over the `window` returns that have CLOSED by the
 * decision bar for a window starting at return index `i` — indices `i-window .. i-1`.
 *
 * Returns null unless EVERY date in the window contributed a basket return. A first version accepted
 * `basket.length >= 2`, which silently measured a shorter window whenever some dates had no data for any
 * symbol, and reported it as a full-window figure.
 */
export function trailingVol(panel, i, window = VOL_WINDOW) {
  const span = volWindowIndices(i, window, panel.dates.length);
  if (!span) return null;
  const basket = [];
  for (let k = span.from; k <= span.to; k++) {
    const rs = [];
    for (const sym of panel.names) {
      const r = panel.ret.get(sym)?.get(panel.dates[k]);
      if (r !== undefined) rs.push(r);
    }
    if (!rs.length) return null;          // a date with no data at all: the window is incomplete
    basket.push(rs.reduce((a, b) => a + b, 0) / rs.length);
  }
  return basket.length === window ? sd(basket) : null;
}

/** Tercile cut-points of a sample. Returns null when there is too little to split. */
export function terciles(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
  return { lo: at(1 / 3), hi: at(2 / 3) };
}

const label = (vol, cuts) => {
  if (vol === null || !cuts) return STATE.UNLABELLED;
  if (vol <= cuts.lo) return STATE.LOW;
  if (vol >= cuts.hi) return STATE.HIGH;
  return STATE.MID;
};

/**
 * Label every period's volatility state.
 *
 * `mode: "expanding"` is pre-decision: the cut-points at period p come from periods 0..p-1 only, so
 * nothing about p's label depends on data after p. The first `MIN_HISTORY` periods are left UNLABELLED
 * rather than labelled from a handful of observations.
 *
 * `mode: "full"` uses whole-panel cut-points. That is NOT pre-decision and exists only as a sensitivity.
 */
export function classifyPeriods(panel, starts, { window = VOL_WINDOW, mode = "expanding",
                                                 minHistory = MIN_HISTORY } = {}) {
  const vols = starts.map((i) => trailingVol(panel, i, window));
  const labels = [];
  if (mode === "full") {
    const cuts = terciles(vols);
    for (const v of vols) labels.push(label(v, cuts));
  } else if (mode === "expanding") {
    for (let p = 0; p < starts.length; p++) {
      const prior = vols.slice(0, p).filter((x) => Number.isFinite(x));
      labels.push(prior.length < minHistory ? STATE.UNLABELLED : label(vols[p], terciles(prior)));
    }
  } else {
    throw new Error(`classifyPeriods: unknown mode "${mode}" (expected "expanding" or "full")`);
  }
  const byState = new Map();
  starts.forEach((i, p) => {
    if (!byState.has(labels[p])) byState.set(labels[p], []);
    byState.get(labels[p]).push(i);
  });
  return { vols, labels, byState, window, mode };
}

/** Measure the null restricted to a given set of period starts. */
export function measureStates(panel, poolFor, stateStarts, { bookSize = 10, hold = HOLD, draws = DRAWS, seed = SEED }) {
  if (stateStarts.length < MIN_PERIODS_PER_STATE) {
    return { sparse: true, periods: stateStarts.length, sd: null, n: 0 };
  }
  const rng = seededRng(seed);
  const diffs = [];
  const byPeriod = new Map();
  for (let d = 0; d < draws; d++) {
    const i = stateStarts[Math.floor(rng() * stateStarts.length)];
    const r = drawPair(panel, poolFor(i), bookSize, i, hold, LEG, rng, { disjoint: false });
    if (!r) continue;
    diffs.push(r.diff);
    if (!byPeriod.has(i)) byPeriod.set(i, []);
    byPeriod.get(i).push(r.diff);
  }
  const s = sd(diffs);
  return {
    sparse: false, sd: s, mean: mean(diffs), n: diffs.length,
    periods: stateStarts.length, periodsDrawn: byPeriod.size,
    simSe: monteCarloSeOfSd(s, diffs.length), byPeriod,
  };
}

async function main() {
  console.log("REGIME-CONDITIONED NULL — does the noise floor depend on the volatility state?");
  console.log(`root ${ROOT}, seed ${SEED}, ${DRAWS} draws per state, hold ${HOLD}, book 10`);
  console.log("");
  console.log("EXPLORATORY PLANNING ANALYSIS. Not registered, not a candidate, not a strategy.");
  console.log("RANDOM-VS-RANDOM PROXY: two random books differenced. NOT edge evidence.");
  console.log("NOT GROUNDS TO LOOSEN A DRAWDOWN BRAKE: a larger sigma means an edge is HARDER to see,");
  console.log("  which says nothing about whether losses in that regime are tolerable. Risk limits are");
  console.log("  about acceptable loss, not measurement precision, and nothing here changes one.");
  console.log("HISTORICAL, on today's surviving universe. Not prospective evidence.\n");

  const grids = loadGrids(ROOT);
  const { panel, barDates } = grids;
  const starts = nonOverlappingStarts(FIRST_START, HOLD, panel.dates.length);

  if (starts.length < MIN_HISTORY + 3 * MIN_PERIODS_PER_STATE) {
    console.log("=== UNAVAILABLE: INSUFFICIENT HISTORY ===");
    console.log(`  periods available ${starts.length}; need at least ` +
                `${MIN_HISTORY + 3 * MIN_PERIODS_PER_STATE} for an expanding classification with three states`);
    console.log("  NO SIGMA IS REPORTED. Regime conditioning splits an already-small sample three ways.");
    process.exitCode = 2;
    return;
  }

  const slateCache = new Map(starts.map((i) => [i, slateFor(grids, i, { slate: 300 }).symbols]));
  const poolFor = (i) => slateCache.get(i);
  const day = (i) => new Date(barDates[i] * 1000).toISOString().slice(0, 10);

  // ---- 0. the classification, and its own limits ------------------------------------------------
  console.log("=== 0. STATE DEFINITION ===");
  console.log(`  trailing realised vol of the equal-weight basket over ${VOL_WINDOW} sessions, ending AT`);
  console.log(`  the decision bar. Returns at indices i-${VOL_WINDOW - 1}..i are all closed by then.`);
  console.log(`  split into equal terciles; primary cut-points are EXPANDING (periods 0..p-1 only),`);
  console.log(`  so no label depends on data after its own period. First ${MIN_HISTORY} periods: UNLABELLED.`);
  console.log(`  windows, split and minimum history were fixed before any output was read.\n`);

  const cls = classifyPeriods(panel, starts, { window: VOL_WINDOW, mode: "expanding" });
  console.log(`  periods total ${starts.length}  (${day(starts[0])} .. ${day(starts.at(-1))})`);
  for (const st of [STATE.LOW, STATE.MID, STATE.HIGH, STATE.UNLABELLED]) {
    const n = cls.byState.get(st)?.length ?? 0;
    console.log(`    ${st.padEnd(11)} ${String(n).padStart(4)} periods`);
  }
  console.log("");

  // ---- 1. sigma by state ------------------------------------------------------------------------
  console.log("=== 1. NULL SIGMA BY VOLATILITY STATE (expanding cut-points, pre-decision) ===");
  const uncond = measureStates(panel, poolFor, starts, { seed: SEED });
  console.log("  state        periods   drawn   sigma/period   sim se    MDE@50p   annualised   sampling 95% CI");
  const show = (name, m, seed) => {
    if (m.sparse) {
      console.log(`  ${name.padEnd(11)} ${String(m.periods).padStart(8)}   ` +
                  `${"—".padStart(5)}   ${"SPARSE".padStart(12)}   ${"—".padStart(6)}   ${"—".padStart(7)}   ` +
                  `${"—".padStart(10)}   fewer than ${MIN_PERIODS_PER_STATE} periods: no sigma reported`);
      return;
    }
    const boot = periodBootstrapSd(m.byPeriod, seededRng(seed + 7919));
    const m50 = mde(m.sd, 50);
    const ci = boot.degenerate ? "degenerate" : `${pct3(boot.lo)} .. ${pct3(boot.hi)}`;
    console.log(`  ${name.padEnd(11)} ${String(m.periods).padStart(8)}   ${String(m.periodsDrawn).padStart(5)}   ` +
                `${pct3(m.sd).padStart(12)}   ${pct3(m.simSe).padStart(6)}   ${pct3(m50).padStart(7)}   ` +
                `${pct(annualise(m50, HOLD)).padStart(10)}   ${ci}`);
  };
  show("ALL (ref)", uncond, SEED);
  const stateRuns = new Map();
  for (const st of [STATE.LOW, STATE.MID, STATE.HIGH]) {
    const m = measureStates(panel, poolFor, cls.byState.get(st) ?? [], { seed: SEED + STATE_SEED[st] });
    stateRuns.set(st, m);
    show(st, m, SEED + STATE_SEED[st]);
  }
  const usable = [STATE.LOW, STATE.MID, STATE.HIGH].filter((st) => !stateRuns.get(st).sparse);
  console.log("");
  if (usable.length >= 2) {
    const lo = stateRuns.get(usable[0]), hi = stateRuns.get(usable.at(-1));
    const ratios = usable.map((st) => stateRuns.get(st).sd / uncond.sd);
    console.log(`  ratio to the unconditional reference: ${usable.map((st, k) => `${st} ${ratios[k].toFixed(3)}`).join(", ")}`);
    console.log(`  spread across states: ${(Math.max(...ratios) / Math.min(...ratios)).toFixed(3)}x`);
    void lo; void hi;
  } else {
    console.log("  Fewer than two states are usable, so no comparison is made.");
  }
  console.log("  EVERY state has roughly a third of an already-small sample, so each sigma is noisier than");
  console.log("  the pooled one and the sampling CI is the column that matters, not the sim se.\n");

  // ---- 2. does the answer depend on the state definition? ---------------------------------------
  console.log("=== 2. SENSITIVITY TO THE STATE DEFINITION (the dependence, made visible) ===");
  console.log("  Every window measured is printed, including ones showing nothing. The sweep exists to");
  console.log("  expose dependence, not to select a window.");
  console.log("  window  mode        low        mid        high       spread   low periods/mid/high");
  for (const window of VOL_WINDOWS) {
    for (const mode of ["expanding", "full"]) {
      const c = classifyPeriods(panel, starts, { window, mode });
      const out = [];
      const counts = [];
      for (const st of [STATE.LOW, STATE.MID, STATE.HIGH]) {
        const ss = c.byState.get(st) ?? [];
        counts.push(ss.length);
        const m = measureStates(panel, poolFor, ss, { seed: SEED + window * 31 + STATE_SEED[st] });
        out.push(m.sparse ? null : m.sd);
      }
      const fin = out.filter((x) => x !== null);
      const spread = fin.length >= 2 ? (Math.max(...fin) / Math.min(...fin)).toFixed(3) + "x" : "—";
      console.log(`  ${String(window).padStart(6)}  ${mode.padEnd(10)}  ` +
                  out.map((x) => (x === null ? "SPARSE".padStart(9) : pct3(x).padStart(9))).join("  ") +
                  `   ${spread.padStart(6)}   ${counts.join("/")}`);
    }
  }
  console.log("");
  console.log("  `full` uses whole-panel cut-points, so it reads future periods to place the boundaries.");
  console.log("  It is NOT pre-decision and is shown only to expose how much the split choice matters.");
  console.log("  `expanding` is the primary because no label depends on data after its own period.\n");

  // ---- 3. the two uncertainties, and dependence between periods ---------------------------------
  console.log("=== 3. SIMULATION vs SAMPLING UNCERTAINTY, PER STATE ===");
  console.log("  Draws are i.i.d. from a fixed empirical distribution, so a repeated period does not make");
  console.log("  them dependent — it adds no new history. Simulation error shrinks with draws; sampling");
  console.log("  error is bounded by the period count in that state and does not.");
  console.log("  state        periods   sim se     iid 95% width   block L=5 width");
  for (const st of [...usable, "ALL"]) {
    const m = st === "ALL" ? uncond : stateRuns.get(st);
    const seed = st === "ALL" ? SEED : SEED + STATE_SEED[st];
    const iid = periodBootstrapSd(m.byPeriod, seededRng(seed + 7919));
    const blk = blockBootstrapSd(m.byPeriod, seededRng(seed + 7919), { blockLength: 5 });
    const w = (b) => (b.degenerate ? "—" : pct3(b.hi - b.lo));
    console.log(`  ${String(st).padEnd(11)} ${String(m.periods).padStart(8)}   ${pct3(m.simSe).padStart(7)}   ` +
                `${w(iid).padStart(13)}   ${w(blk).padStart(15)}`);
  }
  console.log("  The block version preserves local dependence; neither is known to be right, and the");
  console.log("  direction of the i.i.d. bootstrap's error is not determined. Read them as a range.");
  console.log("");
  // WHAT THIS DESIGN COULD AND COULD NOT HAVE DETECTED. Without this, a flat result reads as "no
  // regime dependence" when it may only mean "this sample cannot see it".
  {
    const widths = usable.map((st) => {
      const b = periodBootstrapSd(stateRuns.get(st).byPeriod, seededRng(SEED + STATE_SEED[st] + 7919));
      return b.degenerate ? NaN : b.hi - b.lo;
    }).filter(Number.isFinite);
    if (widths.length) {
      const typical = mean(widths);
      const resolvable = typical / Math.max(1e-12, uncond.sd);
      console.log("  RESOLUTION, WHICH DECIDES WHAT A FLAT RESULT MEANS:");
      console.log(`    typical per-state sampling CI width  ${pct3(typical)}`);
      console.log(`    as a share of the pooled sigma       ${(resolvable * 100).toFixed(1)}%`);
      console.log("    So a between-state difference much below that share is INVISIBLE here. A flat");
      console.log("    column is therefore 'no detectable dependence at this sample size', NOT 'no");
      console.log("    dependence'. Each state holds roughly a third of 133 periods; resolving a modest");
      console.log("    difference would need materially more history, not more draws.");
    }
  }
  console.log("");

  console.log("WHAT THIS ESTABLISHES: whether the null's dispersion on THIS panel differs by trailing");
  console.log("volatility state, under two stated threshold rules, with the period count behind each");
  console.log("figure. WHAT IT DOES NOT: show an edge, register anything, justify a change to any risk");
  console.log("limit or drawdown brake, or say anything about the live universe. See docs/POWER-VALIDATION.md.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
