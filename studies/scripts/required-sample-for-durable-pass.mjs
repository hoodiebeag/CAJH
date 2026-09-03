/**
 * REQUIRED-SAMPLE-FOR-DURABLE-PASS (additive, read-only, cache-only — no egress, no candle data).
 *
 * NOT an attempt to rescue `ma_dip`. This is a forward-looking planning calculation asked by
 * `ALPHA_DEFINITION.md` condition 4 (report the sample a claim needs alongside the sample it
 * has), which has only ever been computed once before, roughly, for `breakout`. `ma_dip` is used
 * as the worked example purely because it is the only candidate in this project with a real,
 * recorded effect size and CI to derive from — not because the goal is to save it. As of this
 * item's own writing (2026-08-28), `ma_dip` has separately failed conditions 3 and 5 outright
 * (`MADIP-SURVIVABILITY-CONDITION-5`, `MADIP-RANDOM-ENTRY-CONTROL`) and `ALPHA_DEFINITION.md`
 * section 4b already treats it as closed. Nothing here proposes reopening that. Explicitly OUT
 * OF SCOPE, per this item's own note: any proposal to narrow, split, or re-scope the
 * `MULTIPLE_COMPARISONS_AUDIT.md` correction family — that move is the failure mode the audit
 * exists to prevent, and this script does not make it.
 *
 * ============================ PRE-REGISTRATION ============================
 * Source numbers (verified against ALPHA_DEFINITION.md section 4b and
 * MULTIPLE_COMPARISONS_AUDIT.md's ranked table before any calculation below runs):
 *   - EQUITIES-MADIP-OUT-OF-SAMPLE (DJTA-20): mean R = +0.2994, 95% block-bootstrap CI
 *     [+0.0509, +0.5350], n = 300 holdout trades, one-sided permutation p = 0.0116.
 *   - Current formal-NHST family size (MULTIPLE_COMPARISONS_AUDIT.md): m = 20, ma_dip rank 4.
 * Method, fixed before any table is produced:
 *   1. Derive per-trade SD from the CI half-width under a normal approximation
 *      (half-width = 1.96 * SE, SE = SD/sqrt(n)) — reported as a derivation, not asserted.
 *   2. For the required-N projections, do NOT reuse that normal-approximated SD directly (a
 *      block-bootstrap permutation p is not exactly normal — the two are cross-checked below and
 *      differ, as expected). Instead calibrate a z-score scaling law directly off the empirically
 *      OBSERVED p = 0.0116 at n = 300, using the standard result that a test statistic's
 *      noncentrality (and hence its z-equivalent) scales as sqrt(N) under a fixed effect size.
 *      This is the more defensible link between "a p-value this project actually measured" and
 *      "the N a future p-value would need," because it does not require the permutation test's
 *      exact sampling distribution to be normal — only that it scales with sqrt(N) the way any
 *      CLT-governed statistic does.
 *   3. BH-FDR required-p at rank r in a family of size m, target q = 0.05: p_req = r*q/m
 *      (this is exactly the formula ALPHA_DEFINITION.md section 4b already uses and cites).
 *   4. Required N for a candidate at that (r, m) with the SAME effect size as ma_dip's observed
 *      result: N_req = 300 * (z_req / z_observed)^2, z_req = Phi^-1(1 - p_req).
 * No new p-value is computed and no hypothesis is tested anywhere in this script — it does not
 * join MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family.
 */

// Acklam's rational approximation for the inverse standard normal CDF (probit), |error| < 1.15e-9.
function probit(p) {
  if (!(p > 0 && p < 1)) throw new Error(`probit: p out of (0,1): ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// --- Recorded source numbers (EQUITIES-MADIP-OUT-OF-SAMPLE, DJTA-20) ---
const MEAN_R = 0.2994;
const CI_LOWER = 0.0509;
const CI_UPPER = 0.5350;
const N_OBSERVED = 300;
const P_OBSERVED = 0.0116; // one-sided
const Q = 0.05;            // BH-FDR target
const CURRENT_FAMILY_SIZE = 20;
const CURRENT_RANK = 4;

// --- Step 1: derive per-trade SD from the recorded CI (normal approximation) ---
const halfWidthLower = MEAN_R - CI_LOWER;
const halfWidthUpper = CI_UPPER - MEAN_R;
const avgHalfWidth = (halfWidthLower + halfWidthUpper) / 2;
const se = avgHalfWidth / 1.96;
const perTradeSD = se * Math.sqrt(N_OBSERVED);
const effectSize = MEAN_R / perTradeSD; // Cohen's d, one-sample

console.log('=== Step 1: per-trade SD derived from the recorded 95% CI ===');
console.log(`mean R = ${MEAN_R}, CI = [${CI_LOWER}, ${CI_UPPER}], n = ${N_OBSERVED}`);
console.log(`lower half-width = ${halfWidthLower.toFixed(4)}, upper half-width = ${halfWidthUpper.toFixed(4)}`);
console.log(`avg half-width = ${avgHalfWidth.toFixed(5)} -> SE = ${se.toFixed(5)} -> per-trade SD = ${perTradeSD.toFixed(4)}`);
console.log(`effect size d = mean/SD = ${effectSize.toFixed(5)}`);

// --- Step 2: empirical z calibration (used for all required-N projections below) ---
const zObserved = probit(1 - P_OBSERVED);
const zFromSDAlone = (MEAN_R / perTradeSD) * Math.sqrt(N_OBSERVED);
console.log('\n=== Step 2: empirical z calibration ===');
console.log(`z implied by observed p=${P_OBSERVED} (one-sided): ${zObserved.toFixed(4)}`);
console.log(`z implied by derived SD alone (sanity check, NOT used below): ${zFromSDAlone.toFixed(4)}`);
console.log('(the two differ because a block-bootstrap permutation p is not exactly normal — expected, disclosed, not corrected for)');

function requiredN(rank, familySize) {
  const pReq = rank * Q / familySize;
  const zReq = probit(1 - pReq);
  const nReq = N_OBSERVED * Math.pow(zReq / zObserved, 2);
  return { pReq, zReq, nReq: Math.ceil(nReq) };
}

// --- Step 3: required p / required N across rank x family-size scenarios ---
const ranks = [1, 2, 3, 4, 5];
const familySizes = [19, 25, 30, 40];
console.log('\n=== Step 3: required N by rank and family size (task-requested sizes) ===');
console.log('rank\\m'.padEnd(8) + familySizes.map(m => String(m).padStart(8)).join(''));
for (const r of ranks) {
  const row = familySizes.map(m => requiredN(r, m).nReq.toString().padStart(8)).join('');
  console.log(`r=${r}`.padEnd(8) + row);
}

// --- Step 4: ceiling probe — does required N diverge as family size grows, rank held at 1? ---
console.log('\n=== Step 4: ceiling probe (rank fixed at 1 = hardest realistic "stays most significant" case) ===');
for (const m of [20, 50, 100, 1000, 10000, 100000]) {
  const { pReq, nReq } = requiredN(1, m);
  console.log(`m=${m}`.padEnd(10) + `p_req=${pReq.toExponential(3)}`.padEnd(18) + `N_req=${nReq}`);
}

// --- Step 5: rank sensitivity at the CURRENT family size (m=20) ---
console.log('\n=== Step 5: rank sensitivity at current family size (m=20) ===');
for (const r of [4, 8, 12, 16, 19]) {
  const { pReq, nReq } = requiredN(r, CURRENT_FAMILY_SIZE);
  console.log(`rank=${r}`.padEnd(10) + `p_req=${pReq.toFixed(5)}`.padEnd(16) + `N_req=${nReq}`);
}

// --- Step 6: empirical trade-generation rate from the two already-spent equity holdouts ---
const HOLDOUT_START = new Date('2026-01-14');
const HOLDOUT_END = new Date('2026-08-19');
const holdoutYears = (HOLDOUT_END - HOLDOUT_START) / (1000 * 3600 * 24 * 365);
const DJIA30_TRADES = 475, DJIA30_SYMBOLS = 30;
const DJTA20_TRADES = 300, DJTA20_SYMBOLS = 20;
console.log('\n=== Step 6: empirical trade-generation rate (DJIA-30 / DJTA-20 holdout, 2026-01-14 -> 2026-08-19) ===');
console.log(`holdout span: ${holdoutYears.toFixed(4)} years`);
console.log(`DJIA-30: ${DJIA30_TRADES} trades / ${DJIA30_SYMBOLS} symbols / ${holdoutYears.toFixed(4)} yr = ${(DJIA30_TRADES/DJIA30_SYMBOLS/holdoutYears).toFixed(2)} trades/symbol/yr`);
console.log(`DJTA-20: ${DJTA20_TRADES} trades / ${DJTA20_SYMBOLS} symbols / ${holdoutYears.toFixed(4)} yr = ${(DJTA20_TRADES/DJTA20_SYMBOLS/holdoutYears).toFixed(2)} trades/symbol/yr`);
