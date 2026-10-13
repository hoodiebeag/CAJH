#!/usr/bin/env node
/**
 * cost-cancellation.mjs — what the cost assumption can and cannot move in the planning measurement.
 *
 * NOT A STRATEGY RUN, AND NOT A BREAK-EVEN. No mechanism is tested, no net avgR is computed for any
 * family, and nothing here is a cost ceiling for anything. `PER-FAMILY-COST-CEILING` already answers
 * break-even in closed form and `COST-SENSITIVITY-SURFACE` already mapped a fee x slippage grid for the
 * crypto baseline families; both are closed and neither is reopened. This audits the MEASUREMENT: which
 * statistic the cost assumption enters, and under exactly which conditions it drops out.
 *
 * THE PRECEDENT THIS BUILDS ON, rather than rediscovering. `VERDICTS-COST-CONSTANT-STALENESS-SWEEP`
 * (2026-08-29) established that "a uniform roundTripCost shift CANCELS in a difference of two means",
 * and classified every archive figure as AFFECTED or UNAFFECTED-BY-CANCELLATION on exactly that basis.
 * What is new here is applying it to the FORWARD paired edge and to the null's sigma/MDE, and then
 * asking where the uniformity precondition fails.
 *
 * THE THREE STRUCTURES, DERIVED FIRST AND THEN CHECKED NUMERICALLY:
 *
 *   equal fixed per round trip        paired edge: CANCELS -- enters neither mean nor variance.
 *   (what the code implements)        absolute net: mean shift of 2c, no variance.
 *
 *   unequal but deterministic         paired edge: mean shift of 2c(1 - 1/k) for a side that trades
 *   (turnover: every period vs 1/k)   every k-th period. Still no variance.
 *
 *   book-dependent per name           paired edge: mean bias 2*(cbar_a - cbar_b), WHICH IS A RANDOM
 *                                     VARIABLE -- so it adds variance too, and the "cost enters the
 *                                     mean, not the variance" shorthand is false here.
 *
 * TWO DIFFERENT CLAIMS, TWO DIFFERENT MDEs. The registered table's sigma is the PAIRED, slate-relative
 * difference: it answers "did selection beat a random book from the same slate". Absolute performance
 * carries market variance on top, needs a far larger MDE, and a positive absolute gross return is mostly
 * exposure, not stock selection. Section 0 measures both so the distinction is a number, not a caveat.
 *
 * COSTS. Baseline is the repository's own verified `usEquityIbkr` (feeRate 0.00005 + slipPct 0.0005 =
 * 5.5bp per leg). Everything else is labelled HYPOTHETICAL and is used only to show the structure of the
 * dependence. No crypto rate is transported here and no research figure is read as a live one.
 *
 * Usage: node cost-cancellation.mjs [draws] [--root sp500-bundle]
 */

import { bookReturn, drawPair } from "./analyst/panel-null.mjs";
import { loadGrids } from "./slate-null.mjs";
import { mde, costDragPerYear, nonOverlappingStarts } from "./analyst/power.mjs";
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
export const BOOK = 10;
export const BASELINE_LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;

/** The configured paper NAV, read from the runtime's own default rather than assumed. */
export const CONFIGURED_NAV = 100000;      // analyst-run.mjs:350, `--nav` default

/**
 * A per-share commission schedule, PARAMETERISED BECAUSE THE REPOSITORY DISAGREES WITH ITSELF.
 *
 * `costs.mjs`'s comment cites "$0.0035/share with a $0.35 minimum" (IBKR tiered). The archive row
 * `EQUITIES-COST-ASSUMPTION-SENSITIVITY` instead cites "IBKR's $1.00/order commission floor binds below
 * 200 shares" (IBKR fixed). Those are different plans with different floors, this session's egress
 * policy blocks verifying either against the broker, and which plan the owner actually holds is an owner
 * fact. So BOTH are run as named hypotheticals and neither is presented as the live schedule.
 */
export const SCHEDULES = Object.freeze({
  tieredComment: Object.freeze({ perShare: 0.0035, minPerOrder: 0.35,
    note: "HYPOTHETICAL: the schedule costs.mjs's comment cites (IBKR tiered)" }),
  fixedArchive: Object.freeze({ perShare: 0.005, minPerOrder: 1.00,
    note: "HYPOTHETICAL: the floor EQUITIES-COST-ASSUMPTION-SENSITIVITY cites (IBKR fixed, $1/order)" }),
});

/**
 * Commission as a fraction of notional under a per-share schedule with a per-order minimum.
 *
 * rate = max(minPerOrder, perShare * shares) / notional,  shares = notional / price
 *      = max(minPerOrder / notional, perShare / price)
 *
 * BOTH TERMS ARE BOOK-DEPENDENT, which is the whole point: the first on position size, the second on the
 * name's PRICE. A constant `feeRate` cannot represent either.
 */
export function commissionRate({ price, notional, perShare, minPerOrder }) {
  if (!(price > 0)) throw new Error("commissionRate: price must be positive");
  if (!(notional > 0)) throw new Error("commissionRate: notional must be positive");
  if (!(perShare >= 0)) throw new Error("commissionRate: perShare must be >= 0");
  if (!(minPerOrder >= 0)) throw new Error("commissionRate: minPerOrder must be >= 0");
  return Math.max(minPerOrder / notional, perShare / price);
}

/** The price below which a flat per-share charge exceeds a given proportional rate. */
export function priceWherePerShareExceeds(perShare, rate) {
  if (!(rate > 0)) throw new Error("priceWherePerShareExceeds: rate must be positive");
  return perShare / rate;
}

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)}%` : "—");
const bp = (x) => (Number.isFinite(x) ? `${(x * 10000).toFixed(2)}bp` : "—");
const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function main() {
  const DRAWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20000);
  const { panel, kept, barDates } = loadGrids(ROOT);
  const starts = nonOverlappingStarts(FIRST_START, HOLD, panel.dates.length);
  const names = panel.names;

  console.log("COST SENSITIVITY OF THE PLANNING MEASUREMENT — not a strategy, not a break-even");
  console.log(`root ${ROOT}, ${names.length} screened names, ${starts.length} non-overlapping periods, `
            + `hold ${HOLD}, book ${BOOK}, ${DRAWS} draws, seed ${SEED}`);
  console.log(`baseline cost: usEquityIbkr, ${bp(BASELINE_LEG)} per leg = ${bp(2 * BASELINE_LEG)} round trip (VERIFIED, repo's own)`);
  console.log("every other cost below is labelled HYPOTHETICAL. No crypto rate is transported.\n");

  // ONE STREAM, USED EVERYWHERE BELOW. An earlier draft drew section 0 and section 1 from separate
  // streams with different draw counts and printed two different paired sigmas (2.303% and 2.342%)
  // for the same quantity. Every sigma in this report now comes from this one sample.
  const PER_PERIOD = Math.max(1, Math.round(DRAWS / starts.length));
  const rngP = seededRng(SEED);
  const base = [], single = [];
  for (const i of starts) {
    for (let d = 0; d < PER_PERIOD; d++) {
      const r = drawPair(panel, names, BOOK, i, HOLD, 0, rngP, { disjoint: false });
      if (r) base.push(r.diff);
      const bag = [...names];
      const pick = [];
      for (let j = 0; j < BOOK && bag.length; j++) pick.push(bag.splice(Math.floor(rngP() * bag.length), 1)[0]);
      const b = bookReturn(panel, pick, i, HOLD, 0);
      if (b.net !== null) single.push(b.net);
    }
  }
  const sdPaired = sd(base), sdSingle = sd(single);

  // ---- 0. which claim each MDE answers --------------------------------------------------------
  console.log("=== 0. TWO CLAIMS, TWO SIGMAS. The registered MDE answers only the first ===");
  console.log(`  ${base.length} paired draws and ${single.length} single-book draws, ${PER_PERIOD} per period, one shared stream.`);
  console.log(`  paired (book MINUS matched control, same slate, same instant):  sigma ${pct(sdPaired)} per period`);
  console.log(`  absolute (one random book, no control):                         sigma ${pct(sdSingle)} per period`);
  console.log(`  ratio ${(sdSingle / sdPaired).toFixed(2)}x. The control removes the common market move, which is most of the`);
  console.log("  variance. So the registered MDE is the SELECTION claim's MDE and nothing else:");
  for (const n of [4, 12, 26, 50]) {
    console.log(`    n=${String(n).padStart(2)}   selection MDE ${pct(mde(sdPaired, n)).padStart(8)}   `
              + `absolute MDE ${pct(mde(sdSingle, n)).padStart(8)}   (${(mde(sdSingle, n) / mde(sdPaired, n)).toFixed(2)}x larger)`);
  }
  console.log("  A POSITIVE ABSOLUTE GROSS RETURN IS MOSTLY MARKET EXPOSURE, not stock-selection skill;");
  console.log("  on this panel it would take a far larger absolute effect to say anything at all.\n");

  // ---- 1. exact cancellation in the paired statistic -------------------------------------------
  console.log("=== 1. EQUAL FIXED COST: THE PAIRED STATISTIC IS INVARIANT, to floating-point error ===");
  console.log("  bookReturn returns mean(gross) - 2c, so drawPair's diff is (a - 2c) - (b - 2c) = a - b.");
  console.log("  Cost enters NEITHER the mean NOR the variance of the paired difference.");
  console.log("   per-leg cost      label          sigma(paired)   max |diff - diff@0|   MDE@n=50");
  const costGrid = [
    [0, "diagnostic zero"], [BASELINE_LEG, "VERIFIED baseline"], [0.0011, "HYPOTHETICAL 11bp"],
    [0.0035, "HYPOTHETICAL 35bp"], [0.0085, "HYPOTHETICAL 85bp"],
  ];
  for (const [c, label] of costGrid) {
    const rng = seededRng(SEED);
    const diffs = [];
    for (const i of starts) {
      for (let d = 0; d < PER_PERIOD; d++) {
        const r = drawPair(panel, names, BOOK, i, HOLD, c, rng, { disjoint: false });
        if (r) diffs.push(r.diff);
        // The single-book draw is consumed here too, so this stream stays aligned with the one
        // section 0 used; otherwise the comparison below would be against a different sample.
        const bag = [...names];
        for (let j = 0; j < BOOK && bag.length; j++) bag.splice(Math.floor(rng() * bag.length), 1);
      }
    }
    const dev = Math.max(...diffs.map((v, k) => Math.abs(v - base[k])));
    console.log(`   ${bp(c).padStart(8)}   ${label.padEnd(18)} ${pct(sd(diffs)).padStart(8)}   `
              + `${dev.toExponential(2).padStart(10)}   ${pct(mde(sd(diffs), 50))}`);
  }
  console.log("  The deviation column is floating-point noise, not a cost effect: (a-2c)-(b-2c) is not");
  console.log("  BIT-equal to a-b in IEEE arithmetic, so the right claim is 'invariant to ~1e-16', never");
  console.log("  'bit-identical'. NO cost assumption, however large, moves the selection MDE at all.\n");

  // ---- 2. where cost does bite: the absolute figures --------------------------------------------
  console.log("=== 2. ABSOLUTE NET: cost shifts the mean by exactly 2c, and nothing else ===");
  const grossMean = meanOf(single);
  console.log("   per-leg cost      label              mean net/period   shift vs gross   share of periods > 0");
  for (const [c, label] of costGrid) {
    const net = single.map((v) => v - 2 * c);
    console.log(`   ${bp(c).padStart(8)}   ${label.padEnd(18)} ${pct(meanOf(net)).padStart(10)}   `
              + `${pct(meanOf(net) - grossMean).padStart(10)}   ${(net.filter((v) => v > 0).length / net.length * 100).toFixed(1)}%`);
  }
  console.log("  The last column is why this matters operationally: scoreJournal's `hitRate` counts");
  console.log("  netReturn > 0, so it is COST-DEPENDENT, while `beatControlRate` and `edgeCI` are not.");
  console.log(`  Annualised drag at the baseline: ${pct(costDragPerYear(BASELINE_LEG, HOLD))}/yr at hold ${HOLD}, `
            + `${pct(costDragPerYear(BASELINE_LEG, 1))}/yr at hold 1.\n`);

  // ---- 3. turnover asymmetry: deterministic, still no variance ----------------------------------
  console.log("=== 3. UNEQUAL TURNOVER: a deterministic mean shift of 2c(1 - 1/k), no variance ===");
  console.log("  If one side pays a round trip every period and the other every k-th, the paired mean");
  console.log("  moves but the paired VARIANCE does not -- the shift is a constant, not a draw.");
  console.log("   k    2c(1 - 1/k) at baseline   measured mean shift   measured sigma change");
  for (const k of [1, 2, 5, 10]) {
    const predicted = 2 * BASELINE_LEG * (1 - 1 / k);
    // Side A pays a round trip every period; side B pays one every k-th, i.e. 2c/k per period.
    const asym = base.map((v) => v - (2 * BASELINE_LEG - 2 * BASELINE_LEG / k));
    console.log(`   ${String(k).padStart(2)}   ${pct(predicted).padStart(22)}   ${pct(meanOf(asym) - meanOf(base)).padStart(18)}   `
              + `${(sd(asym) - sd(base)).toExponential(2).padStart(10)}`);
  }
  console.log("  AND THE RUNTIME DOES NOT MEASURE THIS AT ALL. `decide.mjs` sets targetPct = 0 for a");
  console.log("  `hold` action and every consumer filters those out, so a carried name produces NO outcome");
  console.log("  row, is charged NO cost and gets NO control. Low turnover therefore shows up as a smaller");
  console.log("  n, not as a cost saving -- the measurement is conservative about the analyst's cost and");
  console.log("  pays for it in sample size. Reported, not changed.\n");

  // ---- 4. book-dependent cost: the precondition fails ------------------------------------------
  console.log("=== 4. BOOK-DEPENDENT COST: the 'mean not variance' shorthand is FALSE here ===");
  console.log("  Under a per-share schedule with a per-order minimum, the per-leg rate is");
  console.log("  max(min/notional, perShare/price) -- a function of position size AND of the name's price.");
  console.log(`  At the configured NAV of $${CONFIGURED_NAV.toLocaleString("en-US")} and ${BOOK} names at `
            + `${(100 / BOOK).toFixed(0)}% each, notional is $${(CONFIGURED_NAV / BOOK).toLocaleString("en-US")}/name.`);
  // THE PRICE MUST BE THE DECISION BAR'S, NOT THE PANEL'S LAST CLOSE. A first draft priced every
  // period's commission off the final bar of the panel -- a future price for all but the last window,
  // which is precisely the error this project flags elsewhere. `loadGrids` has already asserted one
  // shared first bar and `returnDates[k] === barDates[k+1]`, so `kept[sym][i]` is the bar at
  // `barDates[i]`: the close at which a window starting at return index `i` is entered.
  const closeAt = (sym, i) => {
    const bars = kept[sym];
    if (!bars || i >= bars.length) return null;
    const bar = bars[i];
    if (Number(bar.time) !== barDates[i]) {
      throw new Error(`cost-cancellation: ${sym} index ${i} is ${bar.time}, not barDates[i]=${barDates[i]} `
        + `-- the per-symbol date mapping is not positional, so the commission would be priced off the wrong day.`);
    }
    const c = Number(bar.close);
    return c > 0 ? c : null;
  };
  for (const [name, sch] of Object.entries(SCHEDULES)) {
    const notional = CONFIGURED_NAV / BOOK;
    const lastIdx = starts[starts.length - 1];
    const rates = names.map((s) => closeAt(s, lastIdx)).filter((p) => p !== null)
      .map((price) => commissionRate({ price, notional, ...sch }));
    const crossover = priceWherePerShareExceeds(sch.perShare, COST_MODELS.usEquityIbkr.feeRate);
    const under = names.map((s) => closeAt(s, lastIdx)).filter((p) => p !== null && p < crossover).length;
    console.log(`\n  ${name} (${sch.note})`);
    console.log(`    per-name commission rate at the last decision bar: min ${bp(Math.min(...rates))}, `
              + `median ${bp(rates.slice().sort((a, b) => a - b)[Math.floor(rates.length / 2)])}, max ${bp(Math.max(...rates))}`);
    console.log(`    modelled feeRate is ${bp(COST_MODELS.usEquityIbkr.feeRate)}; the per-share charge alone exceeds it below `
              + `$${crossover.toFixed(0)}/share, which ${under} of ${names.length} names are`);
    // A SEPARATE STREAM BY DESIGN (SEED + 7): this section needs each book's composition, which the
    // shared stream above does not retain. Its gross sigma is therefore its own sample's, and is
    // printed beside the costed one so the comparison is within-sample rather than across sections.
    const rng = seededRng(SEED + 7);
    const diffs = [];
    for (const i of starts) {
      for (let d = 0; d < PER_PERIOD; d++) {
        const bag = [...names], a = [], b = [];
        for (let j = 0; j < BOOK && bag.length; j++) a.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
        const bag2 = [...names];
        for (let j = 0; j < BOOK && bag2.length; j++) b.push(bag2.splice(Math.floor(rng() * bag2.length), 1)[0]);
        const ra = bookReturn(panel, a, i, HOLD, 0), rb = bookReturn(panel, b, i, HOLD, 0);
        if (ra.net === null || rb.net === null) continue;
        // THE COST IS AVERAGED OVER THE NAMES bookReturn ACTUALLY KEPT. It skips names with no return
        // map and names whose window saw nothing, so averaging over all drawn names would charge the
        // book for exposure it never had.
        const kpt = (syms) => syms.filter((s) => {
          const m = panel.ret.get(s);
          if (!m) return false;
          for (let t = i; t < Math.min(i + HOLD, panel.dates.length); t++) if (m.get(panel.dates[t]) !== undefined) return true;
          return false;
        });
        const cbar = (syms) => {
          const k = kpt(syms);
          if (!k.length) return null;
          const rs = [];
          for (const s of k) {
            const price = closeAt(s, i);
            if (price === null) return null;
            rs.push(commissionRate({ price, notional, ...sch }) + COST_MODELS.usEquityIbkr.slipPct);
          }
          return meanOf(rs);
        };
        const ca = cbar(a), cb = cbar(b);
        if (ca === null || cb === null) continue;
        diffs.push({ gross: ra.net - rb.net, costed: (ra.net - 2 * ca) - (rb.net - 2 * cb), dc: 2 * (ca - cb) });
      }
    }
    const g = diffs.map((d) => d.gross), c = diffs.map((d) => d.costed), dc = diffs.map((d) => d.dc);
    console.log(`    the cost differential 2*(cbar_a - cbar_b): mean ${bp(meanOf(dc))}, sd ${bp(sd(dc))}, `
              + `max |.| ${bp(Math.max(...dc.map(Math.abs)))}`);
    // THE DECOMPOSITION, NOT A SIGNED "INFLATION". var(g + d) = var(g) + var(d) + 2cov(g,d), and the
    // var(d) term here is ~1e-4 of var(g) -- orders of magnitude below the Monte Carlo error on sd(g),
    // so the MEASURED change in sd is dominated by the covariance and by noise and can come out
    // NEGATIVE. An earlier draft printed that as "inflation -0.011%", which reads as a cost REDUCING
    // variance. The predicted term is what is interpretable at this magnitude; the measured delta is not.
    const varRatio = (sd(dc) / sd(g)) ** 2;
    const mg = meanOf(g), mdc = meanOf(dc);
    const cov = meanOf(g.map((v, k2) => (v - mg) * (dc[k2] - mdc)));
    console.log(`    paired sigma GROSS ${pct(sd(g))}   with book-dependent cost ${pct(sd(c))}`);
    console.log(`    variance decomposition: var(d)/var(g) = ${(varRatio * 100).toExponential(2)}%, `
              + `2cov(g,d)/var(g) = ${(2 * cov / sd(g) ** 2 * 100).toExponential(2)}%`);
    console.log(`    sd(d) is ${(sd(dc) / sd(g) * 100).toFixed(3)}% of sigma -- in VARIANCE, bp^2 against percent^2.`);
  }
  console.log("\n  THE MAGNITUDE WAS PREDICTABLE AND IS REPORTED AS ARITHMETIC, NOT AS A FINDING: a cost");
  console.log("  dispersion measured in basis points adds variance in bp^2 against a sigma measured in");
  console.log("  percent, so it is negligible. What is NOT negligible in principle is a MEAN bias when the");
  console.log("  cost is CORRELATED WITH SELECTION -- an analyst that systematically picks cheaper or");
  console.log("  dearer names than the control. The journal's paired edge assigns that bias exactly zero");
  console.log("  BY CONSTRUCTION, because it charges one constant to both sides. That is the identified");
  console.log("  gap, and it is unmeasurable offline: it needs the analyst's own realised book.\n");

  // ---- 5. magnitudes against the MDE ------------------------------------------------------------
  console.log("=== 5. HOW BIG WOULD A COST DIFFERENTIAL HAVE TO BE TO MATTER? ===");
  console.log("  Expressed against the paired MDE at the registered period counts. NOT a break-even for");
  console.log("  any strategy -- it is the resolution of the instrument, not the profitability of a trade.");
  console.log("   differential (per leg)   per period   % of MDE@4   @12   @26   @50");
  for (const d of [0.00005, 0.0005, 0.001, 0.0025]) {
    const perPeriod = 2 * d;
    const row = [4, 12, 26, 50].map((n) => `${(perPeriod / mde(sdPaired, n) * 100).toFixed(1)}%`);
    console.log(`   ${bp(d).padStart(18)}   ${pct(perPeriod).padStart(10)}   ${row.map((r) => r.padStart(6)).join("  ")}`);
  }
  console.log("  READ THE SCALE HONESTLY. At the plausible end -- a differential of a basis point or two,");
  console.log("  which is what the schedules above actually disperse by -- this is ~1% of the MDE at every n.");
  console.log("  A 25bp-per-leg SYSTEMATIC differential is a different matter: it reaches a MAJORITY of the");
  console.log("  n=50 MDE, so it is not dismissable in principle, only implausible at these notionals. The");
  console.log("  binding constraint on this measurement is still the period count, not the cost model.\n");

  console.log("WHAT THIS ESTABLISHES: which statistics the cost assumption can move (absolute net levels,");
  console.log("hitRate, annualised drag) and which it provably cannot (the paired edge and its MDE, under");
  console.log("equal fixed costs), plus the exact condition that breaks the cancellation. WHAT IT DOES NOT:");
  console.log("change costs.mjs or any runtime behaviour, propose a cost, test a mechanism, or establish a");
  console.log("break-even. No formal test is added, so no BH-FDR threshold moves.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
