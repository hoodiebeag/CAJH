/**
 * What a COIN FLIP returns on the crypto bundles — the bar any crypto strategy has to clear.
 *
 * WHY THIS AND NOT A BACKTEST OF THE ANALYST. The owner asked whether CAJH's judgement could be
 * backtested chronologically over the crypto history already in this repository. It cannot: a model
 * asked what it would do on a past date already knows what happened, and hiding the future bars
 * fixes the pipeline while leaving the decider contaminated. Crypto is the worst case for it, since
 * its major moves are famous dated events. So this measures the thing that CAN be measured from
 * history — the benchmark — and says nothing whatever about the analyst.
 *
 * It is the number worth having first regardless. On equities the random-selection null returned
 * +33.70% net at Sharpe 0.850, and that bar is what closed sixteen mechanisms. If crypto's bar is
 * similarly high, that is worth knowing BEFORE spending a month of paper on it.
 *
 * METHODOLOGY IS THE DELETED null-calibration.mjs, RECOVERED FROM HISTORY RATHER THAN REINVENTED,
 * so the equity figures above are a legitimate comparison and not merely a similar-looking one:
 * 120-bar warmup, decile book, rebalanced every HOLD bars, equal weight, one round trip charged per
 * rebalance, mean over DRAWS random draws. Three things necessarily differ for crypto, and each is
 * a decision rather than an oversight:
 *
 *   1. ANNUALISATION USES 365, NOT 252. Crypto trades every day. Keeping 252 would understate the
 *      periods in a year and report a Sharpe that is too low, which is the flattering direction for
 *      a benchmark — a lower bar is easier to beat.
 *   2. COSTS ARE krakenTaker, 85bp per leg against the equity model's 5bp. Seventeen times higher,
 *      and a rotation strategy pays it every rebalance. This is the dominant term and the reason
 *      the crypto and equity numbers are not interchangeable.
 *   3. A RANGE OF HOLDS IS REPORTED, WITH GROSS BESIDE NET. Five equity bars is a calendar week; five crypto bars is five days.
 *      Five equity bars is a calendar week; five crypto bars is five days,
 *      so reporting a sweep separates "same number of bars" from "same elapsed time" instead of
 *      quietly picking one -- and at 85bp a leg the hold length turns out to dominate everything.
 *
 * The two bundles are reported SEPARATELY and never merged. PROVENANCE.json says not to, they are
 * different vendors and pulls, and a merged panel would be a new dataset nobody has checked.
 *
 * Usage: node crypto-null.mjs [draws]
 */

import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { seededRng } from "./inference.mjs";
import { screenUniverse } from "./universe.mjs";
import { COST_MODELS } from "./costs.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const COST = COST_MODELS.krakenTaker;
const LEG = COST.feeRate + COST.slipPct;
const W = 120, DECILE = 0.10, SEED = 20260911, YEAR = 365;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const compound = (returns, cost = 0) => {
  let eq = 1;
  for (const r of returns) eq *= (1 + r) * (1 - cost);
  return eq - 1;
};
const sharpe = (r, per) => {
  if (r.length < 2) return 0;
  const m = mean(r);
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  return sd > 1e-12 ? (m / sd) * Math.sqrt(YEAR / per) : 0;
};
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/** Daily simple returns per name, screened exactly as every study on these bundles screens them. */
function panel(root) {
  const raw = {};
  for (const s of availablePairs(1440, root)) raw[s] = loadBundleCandles(s, 1440, root);
  const screened = screenUniverse(raw);
  for (const [sym, why] of screened.rejected) console.log(`  screened out ${sym}: ${why}`);

  const ret = new Map(), allDates = new Set();
  for (const s of Object.keys(screened.kept)) {
    const c = screened.kept[s];
    if (c.length < W + 80) continue;
    const m = new Map();
    for (let i = 1; i < c.length; i++) {
      const p = Number(c[i - 1].close), q = Number(c[i].close);
      if (p > 0 && q > 0) { m.set(c[i].time, q / p - 1); allDates.add(c[i].time); }
    }
    ret.set(s, m);
  }
  return { ret, dates: [...allDates].sort((a, b) => a - b), names: [...ret.keys()] };
}

/** Equal-weight buy-and-hold of the whole pool: the other bar, and usually the harder one. */
function baseline({ ret, dates, names }) {
  const daily = dates.map((t) => {
    const v = [];
    for (const s of names) { const r = ret.get(s).get(t); if (r !== undefined) v.push(r); }
    return v.length ? mean(v) : 0;
  });
  return { net: compound(daily, 0) - 2 * LEG, sharpe: sharpe(daily, 1) };
}

/** The selection null: the same geometry with the ranking replaced by a coin flip. */
function selectionNull({ ret, dates, names }, hold, nPick, k) {
  const rebalances = [];
  for (let i = W; i + hold < dates.length; i += hold) rebalances.push(i);

  const fwds = rebalances.map((i) => {
    const fwd = new Map();
    for (const s of names) {
      let eq = 1, seen = 0;
      for (let j = i; j < Math.min(i + hold, dates.length); j++) {
        const r = ret.get(s).get(dates[j]);
        if (r === undefined) continue;
        eq *= 1 + r; seen++;
      }
      if (seen) fwd.set(s, eq - 1);
    }
    return fwd;
  });

  const rng = seededRng(SEED);
  const rets = [], gross = [], shs = [];
  for (let d = 0; d < k; d++) {
    const series = [];
    for (const fwd of fwds) {
      const bag = [...names];
      const pick = [];
      for (let j = 0; j < nPick && bag.length; j++) pick.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
      series.push(mean(pick.map((s) => fwd.get(s)).filter((v) => v !== undefined)));
    }
    // GROSS IS REPORTED BESIDE NET, because without it a catastrophic net number reads as a
    // statement about selection when it is a statement about fees. The first run of this produced
    // -97.88% and the cost drag alone was -98.28%: selection had in fact added a little.
    rets.push(compound(series, 2 * LEG));
    gross.push(compound(series, 0));
    shs.push(sharpe(series, hold));
  }
  rets.sort((a, b) => a - b);
  return {
    rebalances: rebalances.length, nPick,
    meanNet: mean(rets), meanGross: mean(gross), meanSharpe: mean(shs),
    costDrag: Math.pow(1 - 2 * LEG, rebalances.length) - 1,
    p05: rets[Math.floor(k * 0.05)], p95: rets[Math.floor(k * 0.95)],
  };
}

console.log("CRYPTO NULL CALIBRATION — what a coin flip returns on the data already here");
console.log(`cost ${COST.note}`);
console.log(`${(LEG * 100).toFixed(2)}% per leg, ${DRAWS} draws, decile book, ${W}-bar warmup, seed ${SEED}`);
console.log("annualised on 365 days; crypto trades every day\n");

for (const root of ["candle-bundle", "candle-bundle-long"]) {
  console.log(`=== ${root} ===`);
  const p = panel(root);
  if (!p.names.length) { console.log("  no usable series\n"); continue; }
  console.log(`  ${p.names.length} pairs, ${p.dates.length} daily bars, ${iso(p.dates[0])} .. ${iso(p.dates.at(-1))}`);

  const b = baseline(p);
  console.log(`\n  BUY AND HOLD the whole pool   ${pct(b.net).padStart(12)} net   Sharpe ${b.sharpe.toFixed(3)}`);

  const nPick = Math.max(1, Math.round(p.names.length * DECILE));
  console.log(`\n  SELECTION NULL, long only, book of ${nPick}. Gross beside net, because the`);
  console.log("  difference between them is the whole story at these fees.");
  console.log("    hold  rebal        gross          net     cost alone   Sharpe");
  for (const hold of [5, 7, 14, 30, 90, 180]) {
    const n = selectionNull(p, hold, nPick, DRAWS);
    console.log(`    ${String(hold).padStart(4)}d ${String(n.rebalances).padStart(6)}  ` +
                `${pct(n.meanGross).padStart(12)} ${pct(n.meanNet).padStart(12)} ` +
                `${pct(n.costDrag).padStart(12)}   ${n.meanSharpe.toFixed(3)}`);
  }
  console.log("");
}

console.log("Equity comparison, same methodology, from docs/WHAT-WE-KNOW.md:");
console.log("  random-selection null  +33.70% net, Sharpe 0.850 (127 names)   buy-and-hold +68.86%");
console.log("\nNothing here says anything about the analyst. It is the bar, not a result.");
console.log("Read the gross column against the net one: where they diverge, the fee is deciding,");
console.log("not the selection, and no judgement applied at that frequency could have helped.");
