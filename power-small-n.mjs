#!/usr/bin/env node
/**
 * power-small-n.mjs — how optimistic is the normal MDE at the period counts this project faces?
 *
 * `docs/PAPER-PROTOCOL.md` registers a table of the "smallest edge it can resolve", built on the normal
 * approximation with KNOWN σ. At 50 periods that is a rounding detail. At 4 — one month of a 5-day hold
 * — it is not, and this quantifies the gap. It amends nothing and proposes no gate change.
 *
 * CONDITIONAL, AND THE CONDITION MATTERS: the protocol registers NO σ-estimating test on the paired
 * difference. Its ten pass criteria are operational and its Tier 2 says the month cannot establish edge.
 * So this asks what that resolution figure would mean IF read as the effect a one-sample test on the
 * forward periods could detect — not what some currently registered test attains. The attained-power and
 * ratio columns are scale-invariant in σ, so they hold whatever σ the registered table used.
 *
 * THREE DISTINCT QUESTIONS, kept apart because conflating them is the hazard:
 *
 *   normal        z-test, σ KNOWN. What `analyst/power.mjs` computes and what the protocol registered.
 *   t-heuristic   critical t substituted for critical z. Corrects the LEVEL for an estimated σ; NOT a
 *                 power calculation, because under the alternative the statistic is noncentral t.
 *   t-exact       the effect at which a one-sample t-test genuinely attains the target power with σ
 *                 ESTIMATED from the same n observations. Simulated, so it carries a Monte Carlo error.
 *
 * And separately: a bootstrap figure is CONDITIONAL HISTORICAL SENSITIVITY — conditional on one observed
 * sample's empirical distribution, not fresh evidence and not a coverage guarantee.
 *
 * NOT EDGE EVIDENCE. Every σ here is the null's dispersion measured on historical survivors, and this
 * script computes arithmetic over it. Nothing is registered, tested or claimed about any strategy.
 *
 * Usage: node power-small-n.mjs [draws]      (default 20000; deterministic given the seeds)
 */

import {
  mdeNormal, mdeTQuantileHeuristic, mdeTExact, tTestPowerSimulated,
  mdeBootstrapConditional, studentTQuantile,
} from "./analyst/power-t.mjs";
import { annualise } from "./analyst/power.mjs";
import { seededRng } from "./inference.mjs";

/** σ and period counts come from the measured record, not from illustration. */
const SIGMA = 0.02350;     // pooled per-period paired sd, sp500-bundle, book 10, hold 5 (§5e)
const HOLD = 5;
const COUNTS = [4, 12, 26, 50];
const DRAWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20000);

const pct = (x) => `${(x * 100).toFixed(3)}%`;
const pctA = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  console.log("SMALL-n PLANNING SENSITIVITY — the normal MDE against t-based and empirical alternatives");
  console.log(`sigma ${pct(SIGMA)} per period (measured, sp500-bundle, book 10, hold ${HOLD}), alpha 0.05, target power 0.80`);
  console.log(`${DRAWS} simulation draws per power evaluation\n`);
  console.log("NOT EDGE EVIDENCE: arithmetic over the null's dispersion on historical survivors.");
  console.log("No protocol amendment, no gate proposal, no change to analyst/power.mjs.\n");

  console.log("=== 0. WHICH PROBLEM EACH NUMBER SOLVES ===");
  console.log("  normal       z-test, sigma KNOWN. The registered table's assumption.");
  console.log("  t-heuristic  critical t for critical z. Fixes the LEVEL, NOT the power. A heuristic.");
  console.log("  t-exact      t-test power with sigma ESTIMATED from the same n. Simulated; has MC error.");
  console.log("  bootstrap    conditional on one observed sample. Not fresh evidence, not coverage.\n");

  // ---- 1. the gap at the registered period counts ---------------------------------------------
  console.log("=== 1. MDE BY METHOD, AT THE REGISTERED PERIOD COUNTS ===");
  console.log("   n   normal     t-heur    ratio    t-EXACT    ratio   attained power   t-exact annualised");
  const rows = [];
  for (const n of COUNTS) {
    const nz = mdeNormal(SIGMA, n);
    const th = mdeTQuantileHeuristic(SIGMA, n);
    const te = mdeTExact({ sigma: SIGMA, n, draws: DRAWS, seed: 7 });
    rows.push({ n, nz, th, te });
    console.log(`  ${String(n).padStart(2)}   ${pct(nz).padStart(7)}   ${pct(th).padStart(7)}   ` +
                `${(th / nz).toFixed(3)}    ${pct(te.mde).padStart(7)}   ${(te.mde / nz).toFixed(3)}   ` +
                `${te.attainedPower.toFixed(3)} +- ${te.powerSe.toFixed(3)}   ${pctA(annualise(te.mde, HOLD)).padStart(8)}`);
  }
  console.log("");
  console.log("  THE t-HEURISTIC UNDERSTATES THE EXACT CORRECTION, which is why it is labelled one:");
  const r4 = rows[0];
  console.log(`    at n=4 it gives ${(r4.th / r4.nz).toFixed(3)}x where the exact answer is ${(r4.te.mde / r4.nz).toFixed(3)}x.`);
  console.log("    Substituting a critical value fixes the rejection threshold and leaves the power term");
  console.log("    normal, so it cannot be read as 80% power.\n");

  // ---- 2. what power the registered figure actually attains ------------------------------------
  console.log("=== 2. THE POWER THE NORMAL MDE ACTUALLY ATTAINS (t-test, sigma estimated) ===");
  console.log("  This is the question that matters for reading the registered table.");
  console.log("   n   normal MDE   attained power   shortfall vs 0.80");
  for (const { n, nz } of rows) {
    const r = tTestPowerSimulated({ n, delta: nz, sigma: SIGMA, draws: DRAWS * 2, seed: 5 });
    console.log(`  ${String(n).padStart(2)}   ${pct(nz).padStart(10)}   ${r.power.toFixed(3)} +- ${r.se.toFixed(3)}    ` +
                `${(0.8 - r.power >= 0 ? "-" : "+")}${Math.abs(0.8 - r.power).toFixed(3)}`);
  }
  console.log("");
  console.log("  READ THE n=4 ROW PLAINLY. Read AS A TEST, the registered 20-trading-day figure attains");
  console.log("  ~48% power, not 80%, once sigma is estimated rather than known. The direction is no surprise --");
  console.log("  estimating sigma from four observations costs power -- but the SIZE is: a factor of about");
  console.log("  1.5 on the detectable effect, which is larger than most of the effects this project has");
  console.log("  argued about. By 50 periods the gap is ~2% and the normal figure is fine.\n");

  // ---- 3. uncertainty in sigma is a SEPARATE axis ----------------------------------------------
  console.log("=== 3. UNCERTAINTY IN SIGMA vs SAMPLING POWER (two different things) ===");
  console.log("  Sections 1-2 hold sigma FIXED at the measured value and vary the inferential method.");
  console.log("  But sigma is itself estimated: §3b measured a period-bootstrap 95% CI 0.319% wide on a");
  console.log("  2.437% sigma, i.e. about +-6%. The +-10% band below is ILLUSTRATIVE and wider than that");
  console.log("  (§5e's 22% figure is a PER-STATE resolution and does not apply to the pooled estimate).");
  console.log("  The span column is algebra -- 1.1/0.9 under linearity -- not a measurement:");
  console.log("   n   MDE at 0.9x sigma   at sigma   at 1.1x sigma   span");
  for (const { n } of rows) {
    const lo = mdeTExact({ sigma: SIGMA * 0.9, n, draws: DRAWS, seed: 7 }).mde;
    const mid = mdeTExact({ sigma: SIGMA, n, draws: DRAWS, seed: 7 }).mde;
    const hi = mdeTExact({ sigma: SIGMA * 1.1, n, draws: DRAWS, seed: 7 }).mde;
    console.log(`  ${String(n).padStart(2)}   ${pct(lo).padStart(16)}   ${pct(mid).padStart(7)}   ` +
                `${pct(hi).padStart(12)}   ${((hi / lo - 1) * 100).toFixed(1)}%`);
  }
  console.log("  The MDE is linear in sigma, so a 10% error in sigma is a 10% error in the MDE -- which at");
  console.log("  n=50 is five times the whole normal-vs-t correction. BOTH matter, and they are not the");
  console.log("  same uncertainty: one is about the inference, the other about the input.\n");

  // ---- 4. the bootstrap, and why it is weakest exactly where it is most wanted -----------------
  console.log("=== 4. BOOTSTRAP: CONDITIONAL HISTORICAL SENSITIVITY, NOT COVERAGE ===");
  console.log("  Resamples one observed sample. Conditional on that sample's empirical distribution: a");
  console.log("  tail it never observed cannot appear in any resample.");
  console.log("   n   distinct resamples at most   bootstrap MDE   t-exact MDE   ratio");
  const rng = seededRng(20261006);
  const gauss = () => { const u = Math.max(1e-12, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (const { n, te } of rows) {
    const sample = Array.from({ length: n }, () => SIGMA * gauss());
    const b = mdeBootstrapConditional({ sample, draws: 4000, seed: 11 });
    console.log(`  ${String(n).padStart(2)}   ${String(b.distinctResamplesBound).padStart(26)}   ` +
                `${pct(b.mde).padStart(13)}   ${pct(te.mde).padStart(11)}   ${(b.mde / te.mde).toFixed(3)}`);
  }
  console.log("");
  console.log("  AT n=4 THERE ARE AT MOST 256 DISTINCT RESAMPLES of four numbers, so the bootstrap figure");
  console.log("  is a statement about those four numbers and not about the world. It is weakest precisely");
  console.log("  where the small-sample question is most pressing, which is why it is reported as a");
  console.log("  sensitivity and never as a coverage interval. The ratio column should be read as 'how");
  console.log("  much this particular sample disagrees', not as a correction factor.\n");

  console.log("=== 5. NUMERICAL VERIFICATION, so these figures are checkable ===");
  console.log("  critical t at 97.5% against the standard table:");
  for (const [df, want] of [[1, 12.706], [5, 2.571], [30, 2.042], [100, 1.984]]) {
    const got = studentTQuantile(0.975, df);
    console.log(`    df ${String(df).padStart(3)}   computed ${got.toFixed(4)}   table ${want}   |diff| ${Math.abs(got - want).toExponential(1)}`);
  }
  const anchor = tTestPowerSimulated({ n: 4, delta: 0, sigma: SIGMA, draws: DRAWS * 2, seed: 3 });
  console.log(`  power at delta=0 must equal alpha: ${anchor.power.toFixed(4)} +- ${anchor.se.toFixed(4)} against 0.0500\n`);

  console.log("WHAT THIS ESTABLISHES: how much the registered power table's normal, known-sigma assumption");
  console.log("flatters the small-n rows, with each method's inferential problem named. WHAT IT DOES NOT:");
  console.log("amend the protocol, propose a gate, change analyst/power.mjs, or say anything about edge.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
