#!/usr/bin/env node
/**
 * paper-power.mjs — how long does the paper run have to be before its number means anything?
 *
 * WRITTEN BEFORE THE PAPER RUN, DELIBERATELY. Once a track record exists it is too late to ask
 * this honestly: whatever length the run happened to be becomes the length that gets defended.
 * The whole point of this project's method is that the decision rule is fixed before the number
 * arrives, and "how many observations do we need" is part of the decision rule.
 *
 * THE QUANTITY BEING TESTED is not the return. It is the paired difference between what the
 * analyst picked and the matched random control drawn from the same slate at the same moment --
 * `journal.mjs` records that control precisely so this comparison exists. A book that returns +8%
 * while a coin flip from the same slate returns +9% has produced nothing, and this project has
 * closed sixteen mechanisms on exactly that distinction.
 *
 * THE TRAP THIS EXISTS TO AVOID is counting decisions instead of independent observations. Twenty
 * trading days of daily decisions with a five-day hold LOOKS like a hundred trades. It is not: the
 * holds overlap, every name in a batch shares one market, and a single bad week contaminates every
 * decision inside it. The independent unit is the non-overlapping holding period, and there are
 * four of those in a month. A p-value computed on the trade count would be wrong by roughly an
 * order of magnitude in the flattering direction.
 *
 * Everything below is measured off the real panel rather than assumed. No distributional
 * assumption is made about returns; the null is simulated by drawing books at random.
 *
 * Usage: node paper-power.mjs [draws]
 */
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { seededRng } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";

const DRAWS = Number(process.argv[2] ?? 20000);
let HOLD = 5;
const COST = COST_MODELS.usEquityIbkr;
const LEG = COST.feeRate + COST.slipPct;
const SEED = 20260924;

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// ---- panel ---------------------------------------------------------------------------------
const raw = {};
for (const s of availablePairs(1440, "sp500-bundle")) raw[s] = loadBundleCandles(s, 1440, "sp500-bundle");
const kept = screenUniverse(raw).kept;
const ret = new Map(), allDates = new Set();
for (const [s, c] of Object.entries(kept)) {
  const m = new Map();
  for (let i = 1; i < c.length; i++) {
    const p = Number(c[i - 1].close), q = Number(c[i].close);
    if (p > 0 && q > 0) { m.set(c[i].time, q / p - 1); allDates.add(c[i].time); }
  }
  ret.set(s, m);
}
const dates = [...allDates].sort((a, b) => a - b);
const names = [...ret.keys()];

/** Net return of an equal-weight basket held HOLD days from index i, one round trip charged. */
function bookReturn(syms, i) {
  const rs = [];
  for (const s of syms) {
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + HOLD, dates.length); k++) {
      const r = ret.get(s).get(dates[k]);
      if (r === undefined) continue;
      eq *= 1 + r; seen++;
    }
    if (seen) rs.push(eq - 1);
  }
  return rs.length ? mean(rs) - 2 * LEG : null;
}

// ---- the null: two random books from the same pool, same moment, same costs -------------------
// This is exactly what the journal's matched control is, so its spread is the noise any claimed
// edge has to clear.
const rng = seededRng(SEED);
const starts = [];
for (let i = 250; i + HOLD < dates.length; i += HOLD) starts.push(i);

function pairedDiffs(bookSize) {
  const diffs = [];
  for (let d = 0; d < DRAWS; d++) {
    const i = starts[Math.floor(rng() * starts.length)];
    const bag = [...names];
    const take = () => {
      const out = [];
      for (let j = 0; j < bookSize && bag.length; j++) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
      return out;
    };
    const a = bookReturn(take(), i), b = bookReturn(take(), i);
    if (a !== null && b !== null) diffs.push(a - b);
  }
  return diffs;
}

/** Observations needed for a two-sided 95% test at 80% power to see an edge of `delta` per period. */
const nFor = (sigma, delta) => Math.ceil(((1.96 + 0.84) ** 2 * sigma ** 2) / delta ** 2);
/** The smallest per-period edge that n observations can resolve. */
const mde = (sigma, n) => (1.96 + 0.84) * sigma / Math.sqrt(n);

console.log(`panel ${names.length} names, ${dates.length} dates, ${starts.length} non-overlapping ${HOLD}-day periods`);
console.log(`null simulated by drawing TWO random books per period and differencing: ${DRAWS} draws\n`);

for (const bookSize of [5, 10, 20]) {
  const diffs = pairedDiffs(bookSize);
  const s = sd(diffs);
  console.log(`BOOK OF ${bookSize} NAMES`);
  console.log(`  per-period noise in (analyst - control): mean ${pct(mean(diffs))}, sd ${pct(s)}`);
  console.log(`  smallest edge a run of this length could resolve, per ${HOLD}-day period:`);
  for (const [label, n] of [["20 trading days  (4 periods)", 4], ["60 trading days (12 periods)", 12],
                            ["6 months        (26 periods)", 26], ["1 year          (50 periods)", 50]]) {
    const m = mde(s, n);
    console.log(`    ${label}  >= ${pct(m).padStart(8)} per period  (~${pct(m * 50)} annualised)`);
  }
  console.log(`  periods needed to resolve a genuinely large edge of 1.00% per period: ${nFor(s, 0.01)}` +
              `  (~${Math.round(nFor(s, 0.01) * HOLD)} trading days)`);
  console.log("");
}

// ---- does a shorter hold buy back power? -------------------------------------------------------
// The obvious lever: with a 1-day hold, twenty trading days gives twenty independent periods
// instead of four. It looks like a five-fold gain in sample size.
//
// It is not, and the reason is worth stating because the intuition is strong. Shortening the hold
// splits the SAME information into more, smaller pieces: the per-period noise falls with the
// square root of the hold, the period count rises linearly, and the two effects cancel in
// annualised terms. What does NOT cancel is cost -- every round trip is charged, so a shorter
// hold pays the toll more often against an edge that is no easier to see.
//
// Derived, then measured, because a derivation that has not been checked against the panel is a
// belief.
console.log("DOES A SHORTER HOLD HELP? (book of 10, one month of trading)");
console.log("  hold   periods   per-period noise   detectable edge/period   annualised   cost drag/yr");
for (const h of [1, 2, 5, 10, 21]) {
  HOLD = h;
  const diffs = pairedDiffs(10);
  const s2 = sd(diffs);
  const periodsInMonth = Math.max(1, Math.floor(20 / h));
  const m = mde(s2, periodsInMonth);
  const perYear = 252 / h;
  console.log(`  ${String(h).padStart(4)}d   ${String(periodsInMonth).padStart(7)}   ` +
              `${pct(s2).padStart(16)}   ${pct(m).padStart(22)}   ` +
              `${pct(m * perYear).padStart(10)}   ${pct(2 * LEG * perYear).padStart(12)}`);
}
console.log("");
console.log("  The annualised column is the comparable one. It barely moves: shortening the hold");
console.log("  does not make an edge easier to see, it only slices the same evidence thinner.");
console.log("  The cost column does move, and only in one direction.");
