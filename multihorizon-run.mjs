// Does short-horizon momentum ADD to the canonical book, or just lose to it?
//
// The short-horizon grid found that the ranking carries information at 4, 8, 15 and 30 bars but
// that none of those horizons beats 252/21/21 net at any execution cost. That closes them as
// REPLACEMENTS and says nothing about them as ADDITIONS. Multi-horizon momentum is a standard
// construction precisely because formation windows that barely overlap pick different names, and
// two books that each lose to a third can still improve it if they are decorrelated from it.
//
// Reported at TWO cost assumptions and both are labelled:
//   0.80% -- this project's standing crypto slippage, punitive and used for every published number.
//   0.10% -- a realistic taker fee on a major venue, shown because at 91 rebalances a year the
//            standing figure is charged five times as often as it was calibrated for.
// The 0.10% column is not a re-baselining. If a blend only works there, that is the finding, and it
// is a finding about execution rather than about momentum.
// Usage: node multihorizon-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";
import { alignReturns, correlation, bookStats, blend, blendDrawdownPct } from "./portfolio.mjs";

const TOPK = 3, BORROW = 0.05;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const series = {};
for (const p of availablePairs(1440, "./candle-bundle")) {
  const c = loadBundleCandles(p, 1440, "./candle-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
for (const k of Object.keys(series)) if (!(k in screenUniverse({ ...series }).kept)) delete series[k];

const HORIZONS = [
  ["fast  8/1/8", { lookbackBars: 8, skipBars: 1, rebalanceBars: 8 }],
  ["mid  30/1/30", { lookbackBars: 30, skipBars: 1, rebalanceBars: 30 }],
  ["canonical 252/21/21", { lookbackBars: 252, skipBars: 21, rebalanceBars: 21 }],
];
const book = sp => ({ returns: sp.returns, rebalanceLog: sp.top.rebalanceLog });

for (const slipPct of [0.008, 0.001]) {
  const built = HORIZONS.map(([label, o]) => [label, spread(series, { ...o, topK: TOPK, slipPct }, { borrow: BORROW })]);
  console.log(`\n${"=".repeat(78)}\n=== slippage ${(100 * slipPct).toFixed(2)}% ` +
    `${slipPct === 0.008 ? "(this project's standing crypto assumption)" : "(a realistic major-venue taker fee)"}\n`);
  console.log("book".padEnd(24) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) +
    "Sharpe".padStart(8) + "  periods");
  for (const [label, sp] of built) {
    const st = bookStats(sp.returns, { periodsPerYear: sp.periodsPerYear });
    console.log(label.padEnd(24) + ("$" + sp.finalBalance.toFixed(0)).padStart(10) +
      st.cagrPct.toFixed(1).padStart(8) + "%" + sp.maxDrawdownPct.toFixed(1).padStart(8) + "%" +
      (st.sharpe ?? NaN).toFixed(2).padStart(8) + String(sp.periods).padStart(9));
  }

  // alignReturns compounds the FASTER book onto the slower one's clock, so the faster book must be
  // passed first. Which one that is cannot be assumed: 8/1/8 rebalances 45.7 times a year against
  // canonical's 17.4 and is faster, but 30/1/30 rebalances 12.2 times and is SLOWER. Hard-coding the
  // order here reported the 30-bar correlation as 0.10 when it is 0.55, and manufactured a
  // diversification benefit that does not exist. Same class of error as the -0.005 cross-asset
  // correlation: an alignment mistake reads as decorrelation, because misalignment destroys
  // covariance and nothing else.
  const canon = built[2][1];
  console.log("\n" + "pair".padEnd(24) + "corr".padStart(8) + "   blend against canonical, weight on the OTHER book");
  console.log(" ".repeat(32) + [0.2, 0.3, 0.4, 0.5].map(w => `w=${w}`.padStart(12)).join(""));
  const pair = sp => (sp.periodsPerYear >= canon.periodsPerYear ? [sp, canon, true] : [canon, sp, false]);
  for (const [label, sp] of built.slice(0, 2)) {
    const [a, b, otherIsFast] = pair(sp);
    const aligned = alignReturns(book(a), book(b));
    const rho = correlation(aligned.map(x => x.a), aligned.map(x => x.b));
    // w is the weight on the NON-canonical book, whichever side of the alignment it landed on.
    const cells = [0.2, 0.3, 0.4, 0.5].map(w => {
      const st = bookStats(blend(aligned, otherIsFast ? w : 1 - w));
      return `$${st.final.toFixed(0)}/${st.sharpe.toFixed(2)}`.padStart(12);
    });
    console.log(label.padEnd(24) + rho.toFixed(3).padStart(8) + "   " + cells.join(""));
  }
  // The canonical book restricted to the same overlap, which is the only fair comparison for the
  // blend cells above -- the full-sample number covers a longer span and would flatter or penalise
  // the blend for reasons that have nothing to do with blending.
  for (const [label, sp] of built.slice(0, 2)) {
    const [a, b, otherIsFast] = pair(sp);
    const aligned = alignReturns(book(a), book(b));
    const solo = bookStats(aligned.map(x => otherIsFast ? x.b : x.a));
    const soloOther = bookStats(aligned.map(x => otherIsFast ? x.a : x.b));
    console.log(`  over the ${aligned.length} periods that overlap ${label.trim()}: ` +
      `canonical alone $${solo.final.toFixed(0)}/${solo.sharpe.toFixed(2)}, ` +
      `${label.trim()} alone $${soloOther.final.toFixed(0)}/${soloOther.sharpe.toFixed(2)}` +
      `  (compounding ${aligned.aPeriodsUsed} of ${aligned.aPeriodsTotal} periods of the faster book)`);
  }
}
// --- the same question with the weight fixed in advance AND the horizon not cherry-picked
//
// Two separate hindsight problems live in the table above and 50/50 only fixes one of them.
//
// The weight: every blend cell above is chosen after seeing it. 50/50 is the one weight that is
// not -- it follows from treating the two books as interchangeable, is decided by symmetry rather
// than by result, and is what a person with no table would pick.
//
// The horizon: 30/1/30 was put in this file because it was the strongest cell of a grid that had
// just been run on this same data. Testing only that horizon would be reporting a selection as a
// discovery. So every horizon from the grid is swept here, selected and unselected alike. If the
// blend improves on both legs only at 30 bars, that is the selection showing through. If it improves
// across the horizons nobody picked, it is a property of combining formation windows.
const ALL = [[4, 1], [8, 1], [15, 1], [30, 1], [60, 1]];
console.log(`\n${"=".repeat(78)}\n=== 50/50 blends, weight fixed by symmetry, every horizon swept ===`);
console.log("Each row blends one horizon with canonical 252/21/21 over the periods where both exist.");
console.log("`beats both` requires the blend to beat EACH leg on Sharpe -- the point of diversifying.\n");
console.log("slippage".padEnd(10) + "horizon".padEnd(12) + "overlap".padStart(8) + "corr".padStart(8) +
  "canon Sh".padStart(10) + "other Sh".padStart(10) + "50/50 Sh".padStart(10) +
  "50/50 $".padStart(10) + "  beats both?");
const tally = new Map();
for (const slipPct of [0, 0.001, 0.004, 0.008]) {
  const canon = spread(series, { ...HORIZONS[2][1], topK: TOPK, slipPct }, { borrow: BORROW });
  for (const [lookbackBars, skipBars] of ALL) {
    const other = spread(series, { lookbackBars, skipBars, rebalanceBars: lookbackBars, topK: TOPK, slipPct }, { borrow: BORROW });
    // alignReturns compounds the FASTER book onto the slower one's clock, so the faster book has to
    // be passed first. At 60 bars the "other" book is slower than canonical's 21, and passing them
    // in fixed order would silently align the wrong way round.
    const [fast, slow] = other.periodsPerYear >= canon.periodsPerYear ? [other, canon] : [canon, other];
    const aligned = alignReturns(book(fast), book(slow));
    if (aligned.length < 8) { console.log(`${(100 * slipPct).toFixed(2)}%`.padEnd(10) + `${lookbackBars}/${skipBars}`.padEnd(12) + `${aligned.length} periods -- too few to read`); continue; }
    const bl = bookStats(blend(aligned, 0.5));                       // 0.5 is symmetric, so order does not affect it
    const sCanon = bookStats(aligned.map(x => fast === canon ? x.a : x.b)).sharpe;
    const sOther = bookStats(aligned.map(x => fast === canon ? x.b : x.a)).sharpe;
    const wins = bl.sharpe > sCanon && bl.sharpe > sOther;
    tally.set(`${lookbackBars}/${skipBars}`, (tally.get(`${lookbackBars}/${skipBars}`) ?? 0) + (wins ? 1 : 0));
    console.log(`${(100 * slipPct).toFixed(2)}%`.padEnd(10) + `${lookbackBars}/${skipBars}`.padEnd(12) +
      String(aligned.length).padStart(8) + correlation(aligned.map(x => x.a), aligned.map(x => x.b)).toFixed(3).padStart(8) +
      sCanon.toFixed(2).padStart(10) + sOther.toFixed(2).padStart(10) + bl.sharpe.toFixed(2).padStart(10) +
      ("$" + bl.final.toFixed(0)).padStart(10) + (wins ? "   YES" : "   no"));
  }
  console.log();
}
console.log("horizons beating both legs, out of the 4 cost levels:");
for (const [h, n] of tally) console.log(`  ${h.padEnd(8)} ${n}/4${h === "30/1" ? "   <- the cherry-picked one" : ""}`);

console.log("\nEvery cell above is in sample. A blend weight chosen from the earlier table is chosen by");
console.log("hindsight; the 50/50 sweep is the version that is not, and it is the one to read.");
