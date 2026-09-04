// Can a long-only crypto book be made tradable at a venue with no shorting?
//
// Long-only crypto momentum returns 27.6% and draws down 69.04%. The drawdown is market beta: the
// basket itself fell 60.77%. Shorting was converting that into 22.73% and the venue cannot short,
// so the only remaining lever is to be OUT of the market rather than short it.
//
// One pre-specified rule, from the time-series momentum literature (Moskowitz, Ooi and Pedersen
// 2012): hold the cross-sectional top-K only while the universe's own equal-weight basket is above
// its 200-bar moving average, otherwise hold cash. 200 bars is the conventional choice, not a
// swept one, and the moving average is computed only from bars that closed before the decision.
//
// This is adjacent to territory this project has already closed -- thousands of entry-timing
// configurations found no edge -- so the claim being tested is narrow and different: not "when
// should I buy this asset" but "should the portfolio be invested at all". Reported either way.
// Usage: node regime-overlay-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { runRotation, perYear, anchoredDrawdown } from "./xsmom.mjs";
import { buildGrid } from "./multifactor.mjs";
import { basketReturns } from "./factors.mjs";

const MA = 200;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};

for (const [label, root, topK, slip] of [
  ["crypto", "./candle-bundle", 3, 0.008],
  ["sp500", "./sp500-bundle", 12, 0.0005],
]) {
  const series = load(root);
  const all = Object.keys(series);
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip };
  const long = runRotation({ ...opts, series, pick: "top" });
  const ppy = perYear(long.rebalanceLog) ?? 12;

  // The basket must NOT come from runRotation with topK = every symbol: that requires all symbols
  // to be eligible at once, so it silently skips every rebalance until the last-listed name has
  // 252 bars of history. It produced 14 periods against the book's 50 and a CAGR that was not
  // comparable to anything. Built directly from the price grid instead -- an equal-weight average
  // of whatever traded on each bar, which is what "hold everything" actually means.
  const { symbols: gsyms, times: gtimes, grid } = buildGrid(series);
  const bRets = basketReturns(grid, gsyms, gtimes).map(r => r ?? 0);
  const idxOf = new Map(gtimes.map((t, i) => [t, i]));
  const basketBars = long.times.map(t => bRets[idxOf.get(t)] ?? 0);
  let lvl = 1;
  const level = basketBars.map(r => (lvl *= Math.exp(r)));
  const maAt = i => {
    if (i < MA) return null;
    let s = 0;
    for (let k = i - MA + 1; k <= i; k++) s += level[k];
    return s / MA;
  };
  // Invested through a period iff the basket was above its MA at the rebalance that STARTED it.
  const invested = [];
  for (let m = 0; m < long.periodReturns.length; m++) {
    const at = long.rebalanceLog[m].at;
    const i = long.times.indexOf(at);
    const ma = i < 0 ? null : maAt(i);
    invested.push(ma === null ? true : level[i] > ma);
  }

  const gated = long.periodReturns.map((r, m) => (invested[m] ? r : 0));
  const gatedBars = long.barReturns.map((b, k) => {
    let m = 0;
    while (m + 1 < long.rebalanceLog.length && long.rebalanceLog[m + 1].at < long.times[k]) m++;
    return invested[m] ? b : 0;
  });

  const show = (name, rets, bars) => {
    let bal = 1000;
    for (const r of rets) bal *= Math.exp(r);
    const yrs = rets.length / ppy;
    console.log(name.padEnd(32) + ("$" + bal.toFixed(2)).padStart(10) +
      (((bal / 1000) ** (1 / yrs) - 1) * 100).toFixed(1).padStart(8) + "%" +
      anchoredDrawdown(rets, bars, long.times, long.rebalanceLog).toFixed(2).padStart(8) + "%" +
      `   ${rets.filter(r => r > 0).length}/${rets.length}`);
  };
  console.log(`\n=== ${label}: long-only top ${topK}, ${MA}-bar regime overlay on the basket ===`);
  console.log(`invested in ${invested.filter(Boolean).length} of ${invested.length} periods`);
  console.log("book".padEnd(32) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "   up");
  show("long-only, always invested", long.periodReturns, long.barReturns);
  show("long-only + regime overlay", gated, gatedBars);
  // The basket's PERIOD returns on the book's own rebalance calendar, so the rows are comparable.
  const basketPeriods = long.periodReturns.map((_, m) => {
    const lo = long.rebalanceLog[m].at, hi = long.rebalanceLog[m + 1]?.at ?? Infinity;
    let sum = 0;
    for (let k = 0; k < long.times.length; k++) if (long.times[k] > lo && long.times[k] <= hi) sum += basketBars[k];
    return sum;
  });
  show("equal-weight basket", basketPeriods, basketBars);
  show("basket + regime overlay", basketPeriods.map((r, m) => (invested[m] ? r : 0)),
       basketBars.map((b, k) => {
         let m = 0;
         while (m + 1 < long.rebalanceLog.length && long.rebalanceLog[m + 1].at < long.times[k]) m++;
         return invested[m] ? b : 0;
       }));
}
console.log("\nThe overlay earns nothing while out of the market -- no interest is credited on cash,");
console.log("which understates it by roughly the risk-free rate times the time spent flat.");
