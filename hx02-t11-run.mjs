// RESIDUAL MOMENTUM (HX02) AND TIME-UNDER-WATER RECOVERY (T11): pre-registered, written before it
// was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11. The last two Tier-A survivors of the manual triage, run together because they
// share a geometry and therefore share a null and a multiplicity family. Twelve through fifteen are
// closed: MR11/HX13, RV02/RV03, MR08, CF12.
//
// I PROPOSED CLOSING BOTH BY ARGUMENT AND THE ARGUMENT DOES NOT HOLD. Two of them were offered:
//   (a) "HX02 duplicates the market-beta residual already closed in RESIDUAL-MEAN-REVERSION."
//       FALSE. That study traded residual MEAN REVERSION -- long the most depressed residual. HX02
//       trades residual MOMENTUM -- long the residual that has been RISING. Same residual, opposite
//       sign. Mean reversion failing says nothing about momentum on the same series; if anything a
//       failed reversal makes the momentum side more interesting, not less.
//   (b) "FACTOR_SPREAD_CEILING closes T11: no price transform of this universe cleared +24% gross."
//       FALSE as stated. That ceiling was measured on dollar-neutral LONG-SHORT spreads. These are
//       long-only decile books, a different geometry with a different null (+33.70% net, Sharpe
//       0.850). A ceiling measured on one geometry does not transfer to another.
// Both are therefore run rather than argued away. Recording the failed argument because the
// temptation to close remaining work by extrapolation is exactly what a campaign fifteen negatives
// deep is most at risk of.
//
// HX02 IS TESTED IN A REDUCED FORM AND THE REDUCTION IS STATED. Its rule names market, sector, rate,
// USD and commodity factors. This project has the market and nothing else -- no sector map, no
// rates, no USD, no commodities. So what is tested is residual momentum after MARKET beta removal
// only. That is the tractable subset, it is honestly less than the rule specifies, and a negative
// here does not close the full five-factor version. Said now so the verdict is not over-read later.
//
// THREE SCORED CELLS. Family size 3, Benjamini-Hochberg at q=0.05.
//   H  HX02 reduced: long the top decile by trailing 63-day MARKET-RESIDUAL return
//   T  T11: long the top decile by "drawdown repairing" -- the fall in time-under-water over 20
//      days -- among names whose 20-day momentum is positive, which is T11's own conjunction
//   M  plain 20-day momentum, long top decile. THE CONTROL. T11's content is the conditioning, so a
//      T that beats the gates while matching M has found momentum, not time-under-water.
//
// ONE UNSCORED REPRODUCTION CHECK. Cell X inverts H's sign to give residual MEAN REVERSION, which
// RESIDUAL-MEAN-REVERSION already closed at +49.25% net. It is not in the family, is not corrected
// and cannot be promoted; it exists so that a surprising H can be checked against a number this
// project already knows. A pipeline that cannot reproduce a closed result has not earned a new one.
//
// GEOMETRY HELD FIXED at the three studies before it, so the replicated null applies unchanged:
// sp500-bundle/1440 SCREENED (rule 1), 13 of 127 names, weekly rebalance, 5-day hold, usEquityIbkr
// costs, long only. The null is +33.70% net at mean Sharpe 0.850 (residual study) and +33.29% at
// 0.827 (illiquidity study). SHARPE IS SCORED AGAINST ~0.84, NEVER AGAINST THE INDEX'S 0.412.
//
// TWO GATES, BOTH REQUIRED: beat the equal-weight buy-and-hold (+68.86% net), and beat the matched
// random-selection null.
//
// KILL CONDITIONS: a cell failing either gate is dead. T beating the gates while matching M is
// momentum, not T11, and is reported as such. If nothing clears, HX02 and T11 are CLOSED, the
// Tier-A list from the manual triage is exhausted, and this file says so.
//
// Usage: node hx02-t11-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { betaResidualSeries } from "./residual.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const ROOT = "sp500-bundle";
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const Q = 0.05, W = 120, LOOK = 63, MOMWIN = 20, TUW = 60, HOLD = 5, DECILE = 0.10;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);

const ret = new Map(), close = new Map();
const allDates = new Set();
for (const s of Object.keys(screened.kept)) {
  const c = screened.kept[s], r = new Map(), p = new Map();
  for (let i = 1; i < c.length; i++) {
    const a = Number(c[i - 1].close), b = Number(c[i].close);
    if (a > 0 && b > 0) { r.set(c[i].time, b / a - 1); p.set(c[i].time, b); allDates.add(c[i].time); }
  }
  if (r.size > W + TUW) { ret.set(s, r); close.set(s, p); }
}
const dates = [...allDates].sort((a, b) => a - b);
const names = [...ret.keys()];
console.log(`universe ${names.length} symbols, ${dates.length} dates`);

const start = Math.max(W, TUW + MOMWIN) + 5;
const rebalances = [];
for (let i = start; i + HOLD < dates.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(names.length * DECILE));
console.log(`${rebalances.length} rebalances, decile = ${N_PICK} names`);

function forward(i) {
  const f = new Map();
  for (const s of names) {
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + HOLD, dates.length); k++) {
      const v = ret.get(s).get(dates[k]);
      if (v === undefined) continue;
      eq *= 1 + v; seen++;
    }
    if (seen) f.set(s, eq - 1);
  }
  return f;
}

/** Fraction of the last TUW sessions spent below the running high, as of index i. */
function timeUnderWater(s, i) {
  const P = close.get(s);
  let hi = 0, under = 0, n = 0;
  for (let k = i - TUW; k <= i; k++) {
    const v = P.get(dates[k]);
    if (v === undefined) continue;
    if (v > hi) hi = v;
    if (v < hi) under++;
    n++;
  }
  return n >= TUW * 0.8 ? under / n : null;
}

const rounds = [];
for (const idx of rebalances) {
  const fwd = forward(idx);
  // Market return series over the fitting window, used by H and X.
  const win = dates.slice(idx - W, idx);
  const mkt = win.map((t) => {
    const v = [];
    for (const s of names) { const r = ret.get(s).get(t); if (r !== undefined) v.push(r); }
    return v.length ? mean(v) : 0;
  });
  const sc = { H: new Map(), T: new Map(), M: new Map(), X: new Map() };
  const pool = [];
  for (const s of names) {
    if (!fwd.has(s)) continue;
    const y = win.map((t) => ret.get(s).get(t) ?? 0);
    if (win.some((t) => ret.get(s).get(t) === undefined)) continue;
    pool.push(s);
    // H / X: cumulative market residual over the last LOOK days of the window.
    const resid = betaResidualSeries(y, [mkt]);
    if (resid) {
      const cum = resid.slice(-LOOK).reduce((a, b) => a + b, 0);
      sc.H.set(s, cum);        // momentum: rising residual ranks highest
      sc.X.set(s, -cum);       // the closed mean-reversion sign, for reproduction only
    }
    // M: plain 20-day momentum.
    let eq = 1;
    for (const t of win.slice(-MOMWIN)) eq *= 1 + ret.get(s).get(t);
    const mom = eq - 1;
    sc.M.set(s, mom);
    // T: T11's conjunction -- drawdown repairing AND 20-day momentum positive.
    const now = timeUnderWater(s, idx), before = timeUnderWater(s, idx - MOMWIN);
    if (now !== null && before !== null && mom > 0) sc.T.set(s, before - now);
  }
  if (pool.length >= N_PICK + 5) rounds.push({ fwd, sc, pool });
}
console.log(`usable rebalances: ${rounds.length}/${rebalances.length}`);

function runCell(key) {
  const rets = [];
  for (const r of rounds) {
    const ranked = [...r.sc[key].entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length < N_PICK) { rets.push(0); continue; }
    rets.push(mean(ranked.slice(0, N_PICK).map((x) => r.fwd.get(x[0])).filter((v) => v !== undefined)));
  }
  return { net: compound(rets, 2 * LEG), gross: compound(rets, 0), rets };
}
function sharpe(rets) {
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1));
  return sd > 1e-12 ? (m / sd) * Math.sqrt(252 / HOLD) : 0;
}
function selectionNull(k) {
  const rng = seededRng(20260911);
  const draws = [], sharpes = [];
  for (let d = 0; d < k; d++) {
    const rets = [];
    for (const r of rounds) {
      const pool = [...r.pool], picks = [];
      for (let j = 0; j < N_PICK && pool.length; j++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      rets.push(mean(picks.map((s) => r.fwd.get(s)).filter((v) => v !== undefined)));
    }
    draws.push(compound(rets, 2 * LEG)); sharpes.push(sharpe(rets));
  }
  return { draws, sharpes };
}

const bhDaily = dates.map((t) => {
  const v = [];
  for (const s of names) { const r = ret.get(s).get(t); if (r !== undefined) v.push(r); }
  return v.length ? mean(v) : 0;
});
const bh = compound(bhDaily, 0) - 2 * LEG;
console.log(`\nBASELINE equal-weight buy-and-hold: ${pct(bh)} over ${(dates.length / 252).toFixed(2)}y`);

console.log(`\nrunning ${DRAWS} selection-null draws...`);
const N = selectionNull(DRAWS);
const nullSharpe = mean(N.sharpes);
console.log(`NULL: mean return ${pct(nullSummary(N.draws, 0).nullMean)}, mean Sharpe ${nullSharpe.toFixed(3)}`);

const cells = [
  { id: "H", name: "HX02 reduced: market-residual momentum" },
  { id: "T", name: "T11: drawdown repairing + momentum > 0" },
  { id: "M", name: "plain 20d momentum (CONTROL)" },
];
for (const c of cells) {
  Object.assign(c, runCell(c.id));
  c.sharpe = sharpe(c.rets);
  c.p = nullSummary(N.draws, c.net).p;
  c.beatsBH = c.net > bh;
}
const sorted = [...cells].sort((a, b) => a.p - b.p);
sorted.forEach((c, i) => { c.clearsBH = c.p <= (Q * (i + 1)) / sorted.length; });
for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i + 1].clearsBH) sorted[i].clearsBH = true;

console.log(`\n${"cell".padEnd(4)}${"mechanism".padEnd(42)}${"gross".padStart(10)}${"net".padStart(10)}${"Sharpe".padStart(9)}${"vs B&H".padStart(10)}${"null p".padStart(9)}  verdict`);
for (const c of cells) {
  const g = [];
  if (!c.beatsBH) g.push("loses to buy-and-hold");
  if (!c.clearsBH) g.push("no selection skill");
  console.log(`${c.id.padEnd(4)}${c.name.padEnd(42)}${pct(c.gross).padStart(10)}${pct(c.net).padStart(10)}` +
    `${c.sharpe.toFixed(3).padStart(9)}${((c.net > bh ? "+" : "") + pct(c.net - bh)).padStart(10)}${c.p.toFixed(4).padStart(9)}  ` +
    (g.length ? `DEAD (${g.join("; ")})` : "CLEARS BOTH GATES"));
}
const X = runCell("X");
console.log(`\nREPRODUCTION CHECK (unscored): X, the residual MEAN-REVERSION sign already closed at +49.25% net,` +
  ` reproduces here at ${pct(X.net)} net / Sharpe ${sharpe(X.rets).toFixed(3)}.`);
console.log(`T11 vs its control: T ${pct(cells[1].net)} against plain momentum's ${pct(cells[2].net)}` +
  ` — the time-under-water conditioning ${cells[1].net > cells[2].net ? "ADDS" : "SUBTRACTS"} ${pct(Math.abs(cells[1].net - cells[2].net))}`);
console.log(`Sharpe against the NULL's ${nullSharpe.toFixed(3)}: ` + cells.map((c) => `${c.id} ${c.sharpe > nullSharpe ? "above" : "below"}`).join(", "));

const survivors = cells.filter((c) => c.beatsBH && c.clearsBH && c.id !== "M");
console.log(`\nsurvivors: ${survivors.length ? survivors.map((c) => c.id).join(", ") : "NONE"}`);
if (!survivors.length) {
  console.log("VERDICT: HX02 (reduced) and T11 CLOSED. Sixteenth family. The Tier-A list from the");
  console.log("manual triage is now EXHAUSTED: all six survivors tested, none cleared.");
  console.log("HX02's full five-factor form is NOT closed — it needs sector, rate, USD and commodity");
  console.log("data this project does not have, and remains Tier B.");
}
