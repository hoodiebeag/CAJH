// RESIDUAL MEAN REVERSION (RV02 / RV03): pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11. Second of the six Tier-A survivors of the IBKR-manual triage
// (docs/MANUAL-STRATEGY-TRIAGE.md); the first, MR11/HX13, is closed in VERDICTS.md.
//
// A CORRECTION TO MY OWN TRIAGE, MADE BEFORE THE RUN RATHER THAN AFTER. That document put RV10
// ("cross-asset beta residual") in Tier A. It does not belong there: its core rule is a dynamic
// beta to MACRO drivers, and the S&P bundle contains no rates, no USD and no commodities. RV10 is
// Tier B, gated on a data pull, and is dropped from this family. Testing it with an improvised
// stand-in factor would have been fitting a convenient regressor and calling it the strategy.
//
// THE MECHANISM, and why it is not a re-run of a killed row. PAIRS-COINTEGRATION-STATARB is KILLED:
// it screened 105 NAMED PAIRS for a cointegrating relationship and 0 survived BH-FDR at q=0.05, so
// it never reached an economic test. This fits a common-factor model across the WHOLE cross-section
// at once and trades what is left over. Different estimator, different unit of analysis, 128 names
// instead of 105 pairs drawn from far fewer. Under this project's own rule -- do not re-open a
// killed row without a genuinely different information source -- this clears, narrowly, and the
// narrowness is why it is written down here.
//
// TWO ESTIMATORS, fixed in advance:
//   P (RV02)  remove the top 3 principal components of the return cross-section
//   M (RV03)  remove a beta to the equal-weight market
// TWO BOOKS each, because the executable question and the research question are different:
//   LS  long the bottom decile by residual z, short the top decile -- market-neutral, the form the
//       manual actually specifies
//   LO  the long leg alone -- the only form this account can currently place
// FAMILY SIZE 4. Benjamini-Hochberg at q=0.05 across the four.
//
// A SURVIVING LS CELL IS NOT ACTIONABLE AND THIS IS STATED NOW, not after seeing one. The IBKR
// universe probe returned shortability UNKNOWN on 128 of 128 symbols and available on 0. An LS
// result would be a reason to chase the borrow entitlement, nothing more. Only an LO cell could be
// traded on the account as it stands.
//
// RANKING, NOT THRESHOLDING. The manual's test matrix offers entry z of 1.5, 2, 2.5 or 3. Each is a
// free parameter and four of them across two estimators and two books is sixteen cells of search.
// The decile rank is used instead, fixed at the same 10% the overnight study used, so the cell
// count stays at four and no threshold can be chosen after the fact.
//
// k = 3 IS PRE-REGISTERED. k = 1 and k = 5 are computed and printed as ROBUSTNESS ONLY. They are
// not in the family, are not BH-corrected, and cannot be promoted. They exist so that a k = 3
// result cannot be read as anything but a lucky pick if its neighbours disagree with it.
//
// GEOMETRY, all fixed here: 120-day fitting window ending strictly before the decision; residual
// path z-scored over its trailing 60 days; rebalance every 5 days; hold 5 days; usEquityIbkr costs
// (0.5bp fee + 5bp slippage per leg), charged on both legs of the LS book.
//
// TWO GATES, BOTH REQUIRED:
//   1. BEATS THE EQUAL-WEIGHT BUY-AND-HOLD of the same names over the same window. This applies to
//      the market-neutral book too, and deliberately: a hedged book that returns less than the
//      index is not worth this account's capital whatever its Sharpe. Sharpe is reported beside it
//      so the reader can see what is being given up.
//   2. BEATS A MATCHED SELECTION NULL -- the same decile sizes drawn at random on the same dates,
//      held the same way, charged the same costs, with the LS null drawing a random long side and a
//      random short side.
//
// KILL CONDITIONS, stated before the run:
//   - A cell failing either gate is dead, whatever the other says.
//   - If the two estimators disagree, the mechanism has not been found; one estimator clearing
//     alone is a property of that estimator, not of residual mean reversion.
//   - If k=3 clears while k=1 and k=5 do not, the result is a parameter artifact and is reported
//     as one.
//   - If no cell clears both gates, RV02/RV03 is CLOSED and this file records it.
//
// Usage: node residual-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { pcaResidualMatrix, betaResidualSeries, zLast } from "./residual.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const ROOT = "sp500-bundle";
const COST = COST_MODELS.usEquityIbkr;
const LEG = COST.feeRate + COST.slipPct;
const Q = 0.05, W = 120, ZWIN = 60, HOLD = 5, DECILE = 0.10, K_PRE = 3;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// ---- panel --------------------------------------------------------------
const symbols = availablePairs(1440, ROOT);
const ret = new Map();     // symbol -> Map(time -> close-to-close return)
let allDates = new Set();
for (const s of symbols) {
  const c = loadBundleCandles(s, 1440, ROOT);
  if (c.length < W + ZWIN + 20) continue;
  const m = new Map();
  for (let i = 1; i < c.length; i++) {
    const p = Number(c[i - 1].close), q = Number(c[i].close);
    if (p > 0 && q > 0) { m.set(c[i].time, q / p - 1); allDates.add(c[i].time); }
  }
  ret.set(s, m);
}
const dates = [...allDates].sort((a, b) => a - b);
const names = [...ret.keys()];
console.log(`universe ${names.length} symbols, ${dates.length} dates`);

const rebalances = [];
for (let i = W; i + HOLD < dates.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(names.length * DECILE));
console.log(`${rebalances.length} rebalances, decile = ${N_PICK} names per leg, window ${W}d, z over ${ZWIN}d`);

/** Names with complete coverage across a window, and the T x N return matrix for them. */
function window(i) {
  const ws = dates.slice(i - W, i);
  const keep = names.filter((s) => ws.every((t) => ret.get(s).has(t)));
  return { keep, X: ws.map((t) => keep.map((s) => ret.get(s).get(t))) };
}

/** Forward HOLD-day total return per name from rebalance index i. */
function forward(i) {
  const fwd = new Map();
  for (const s of names) {
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + HOLD, dates.length); k++) {
      const r = ret.get(s).get(dates[k]);
      if (r === undefined) continue;
      eq *= 1 + r; seen++;
    }
    if (seen) fwd.set(s, eq - 1);
  }
  return fwd;
}

/** Residual-path z per name for one window, under estimator `kind`. Lower z = more depressed. */
function scores(kind, keep, X, k) {
  const N = keep.length;
  let resid;                      // T x N residual matrix
  if (kind === "P") {
    resid = pcaResidualMatrix(X, k);
  } else {
    const mkt = X.map((row) => mean(row));
    resid = null;
    const cols = [];
    for (let j = 0; j < N; j++) {
      const y = X.map((row) => row[j]);
      const r = betaResidualSeries(y, [mkt]);
      cols.push(r);
    }
    resid = X.map((_, t) => cols.map((c) => (c ? c[t] : 0)));
  }
  const out = new Map();
  for (let j = 0; j < N; j++) {
    const path = [];
    let cum = 0;
    for (let t = X.length - ZWIN; t < X.length; t++) { cum += resid[t][j]; path.push(cum); }
    const z = zLast(path, ZWIN);
    if (z !== null) out.set(keep[j], z);
  }
  return out;
}

// Precompute every window's scores once; the three k values and both books reuse them.
const perRebalance = [];
for (const i of rebalances) {
  const { keep, X } = window(i);
  if (keep.length < N_PICK * 2 + 5) { perRebalance.push(null); continue; }
  perRebalance.push({
    i, fwd: forward(i), pool: keep,
    P1: scores("P", keep, X, 1), P3: scores("P", keep, X, 3), P5: scores("P", keep, X, 5),
    M: scores("M", keep, X),
  });
}
const usable = perRebalance.filter(Boolean);
console.log(`usable rebalances: ${usable.length}/${rebalances.length}`);

/** Score a book. `book` is "LS" or "LO"; picks come from the score map. */
function runBook(key, book) {
  const rets = [];
  for (const r of usable) {
    const ranked = [...r[key].entries()].sort((a, b) => a[1] - b[1]);   // most depressed first
    if (ranked.length < N_PICK * 2) { rets.push(0); continue; }
    const longs = ranked.slice(0, N_PICK).map((x) => x[0]);
    const shorts = ranked.slice(-N_PICK).map((x) => x[0]);
    const L = mean(longs.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
    if (book === "LO") { rets.push(L); continue; }
    const S = mean(shorts.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
    rets.push((L - S) / 2);       // equal capital each side, so the pair return is the average
  }
  const legs = book === "LS" ? 4 : 2;   // LS turns over both sides each rebalance
  return { gross: compound(rets, 0), net: compound(rets, legs * LEG), rets };
}

/** The same geometry with the ranking replaced by a coin flip. */
function selectionNull(book, k) {
  const rng = seededRng(20260911);
  const draws = [];
  for (let d = 0; d < k; d++) {
    const rets = [];
    for (const r of usable) {
      const pool = [...r.pool];
      const take = () => {
        const out = [];
        for (let j = 0; j < N_PICK && pool.length; j++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        return out;
      };
      const L = mean(take().map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
      if (book === "LO") { rets.push(L); continue; }
      const S = mean(take().map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
      rets.push((L - S) / 2);
    }
    draws.push(compound(rets, (book === "LS" ? 4 : 2) * LEG));
  }
  return draws;
}

/** Annualised Sharpe from the per-rebalance return series. */
function sharpe(rets) {
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1));
  return sd > 1e-12 ? (m / sd) * Math.sqrt(252 / HOLD) : 0;
}

// ---- baseline -----------------------------------------------------------
const bhDaily = dates.map((t) => {
  const v = [];
  for (const m of ret.values()) { const r = m.get(t); if (r !== undefined) v.push(r); }
  return v.length ? mean(v) : 0;
});
const bh = compound(bhDaily, 0) - 2 * LEG;
const years = dates.length / 252;
console.log(`\nBASELINE equal-weight buy-and-hold: ${pct(bh)} over ${years.toFixed(2)}y (CAGR ${pct(Math.pow(1 + bh, 1 / years) - 1)}, Sharpe ${sharpe(bhDaily.map((r) => r)).toFixed(3)})`);

// ---- the four pre-registered cells --------------------------------------
console.log(`\nrunning ${DRAWS} selection-null draws per book...`);
const nulls = { LS: selectionNull("LS", DRAWS), LO: selectionNull("LO", DRAWS) };

const cells = [
  { id: "P-LS", name: "PCA k=3 residual, long-short", key: "P3", book: "LS" },
  { id: "P-LO", name: "PCA k=3 residual, long only", key: "P3", book: "LO" },
  { id: "M-LS", name: "market-beta residual, long-short", key: "M", book: "LS" },
  { id: "M-LO", name: "market-beta residual, long only", key: "M", book: "LO" },
];
for (const c of cells) {
  Object.assign(c, runBook(c.key, c.book));
  c.sharpe = sharpe(c.rets);
  c.null = nullSummary(nulls[c.book], c.net);
  c.p = c.null.p;
  c.beatsBH = c.net > bh;
}
const sorted = [...cells].sort((a, b) => a.p - b.p);
sorted.forEach((c, i) => { c.clearsBH = c.p <= (Q * (i + 1)) / sorted.length; });
for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i + 1].clearsBH) sorted[i].clearsBH = true;

console.log(`\n${"cell".padEnd(6)}${"mechanism".padEnd(36)}${"gross".padStart(10)}${"net".padStart(10)}${"Sharpe".padStart(9)}${"vs B&H".padStart(10)}${"null p".padStart(9)}  verdict`);
for (const c of cells) {
  const g = [];
  if (!c.beatsBH) g.push("loses to buy-and-hold");
  if (!c.clearsBH) g.push("no selection skill");
  console.log(`${c.id.padEnd(6)}${c.name.padEnd(36)}${pct(c.gross).padStart(10)}${pct(c.net).padStart(10)}` +
    `${c.sharpe.toFixed(3).padStart(9)}${((c.net > bh ? "+" : "") + pct(c.net - bh)).padStart(10)}${c.p.toFixed(4).padStart(9)}  ` +
    (g.length ? `DEAD (${g.join("; ")})` : "CLEARS BOTH GATES"));
}

console.log(`\nROBUSTNESS (not in the family, not BH-corrected, cannot be promoted)`);
for (const [lbl, key] of [["PCA k=1", "P1"], ["PCA k=5", "P5"]]) {
  for (const book of ["LS", "LO"]) {
    const r = runBook(key, book);
    console.log(`  ${lbl} ${book}: net ${pct(r.net).padStart(9)}  Sharpe ${sharpe(r.rets).toFixed(3).padStart(7)}`);
  }
}

console.log(`\nnull means: LS ${pct(nullSummary(nulls.LS, 0).nullMean)}, LO ${pct(nullSummary(nulls.LO, 0).nullMean)} (coin-flip picks, same geometry and costs)`);
const survivors = cells.filter((c) => c.beatsBH && c.clearsBH);
console.log(`\nsurvivors: ${survivors.length ? survivors.map((c) => c.id).join(", ") : "NONE"}`);
if (!survivors.length) {
  console.log("VERDICT: RV02/RV03 residual mean reversion CLOSED. Thirteenth family, same two gates.");
} else {
  const ls = survivors.filter((c) => c.book === "LS");
  if (ls.length && !survivors.some((c) => c.book === "LO")) {
    console.log("Only the market-neutral form cleared. NOT ACTIONABLE on this account: shortability is");
    console.log("UNKNOWN on 128/128 IBKR symbols and available on 0. This is a reason to chase the borrow");
    console.log("entitlement, not a strategy to turn on.");
  }
  console.log("Do NOT promote from this run: re-register on a held-out window first.");
}
