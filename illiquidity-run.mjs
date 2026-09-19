// AMIHUD ILLIQUIDITY (MR08): pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11. Third of the six Tier-A survivors of the manual triage; MR11/HX13 and
// RV02/RV03 are both closed in VERDICTS.md.
//
// WHY THIS ONE IS WORTH A RUN. It is the only survivor resting on a quantity this campaign has
// never ranked. Volume has appeared here exactly once as a signal component -- VOL-CONFIRM-BREAKOUT
// -- and there only as a confirmation filter on a price trigger, which failed its train gate at all
// three thresholds. Amihud illiquidity, |return| per dollar traded, makes volume the thing being
// measured rather than a veto on something else.
//
// THE GEOMETRY IS HELD FIXED AT THE RESIDUAL STUDY'S, deliberately, and this is the most important
// line in this registration. That study measured what the geometry alone is worth on this exact
// universe: 13 names of 128, weekly rebalance, 5-day hold, usEquityIbkr costs, long only -- a COIN
// FLIP returns +25.43% net at mean SHARPE 0.734, against the index's 0.366. Changing any of those
// numbers here would forfeit that calibration and invite reporting a Sharpe against the index, which
// over-credits a book of this shape by about 0.37 before any signal exists. So they do not change.
//
// LONG ONLY, AND NOT FOR THE USUAL REASON. Shortability is unknown on 128/128 IBKR symbols, but the
// stronger reason is now measured rather than assumed: the long-short version of this geometry has a
// null that itself returns -29.55%, because two-legged turnover at 11bp a leg every five days costs
// about 30 points over 3.65 years. Spending two more cells of multiplicity on a geometry already
// measured as dominated would be search, not evidence.
//
// THREE CELLS, and the third is what makes the first two interpretable:
//   N  MR08 literal: rank by how far an illiquidity spike has COME BACK DOWN, peak z minus current
//      z over 10 days. Long the top decile.
//   L  rank by the illiquidity LEVEL itself, long the most illiquid decile. The illiquidity premium,
//      not the reversal. If N works and L works equally, MR08 is a premium and not a signal.
//   R  rank by trailing 5-day return, long the losers. PLAIN SHORT-HORIZON REVERSAL, and a control,
//      not a hypothesis. B5-REVERSAL is already KILLED here. An illiquidity-normalisation signal
//      fires after a violent move, so it is reversal-shaped by construction; without R a result
//      would be indistinguishable from the reversal this project has already closed.
// FAMILY SIZE 3, Benjamini-Hochberg at q=0.05.
//
// RANKING, NOT THRESHOLDING, for the same reason as the residual study: the manual's spike
// threshold is a free parameter and one chosen after seeing the data is the parameter that fits it.
//
// TWO GATES, BOTH REQUIRED:
//   1. BEATS THE EQUAL-WEIGHT BUY-AND-HOLD of the same names over the same window (+58.43% net).
//   2. BEATS THE MATCHED SELECTION NULL -- same decile size, same dates, same holds, same costs,
//      picks at random. Sharpe is scored against the NULL's Sharpe, not the index's.
//
// KILL CONDITIONS, stated before the run:
//   - A cell failing either gate is dead, whatever the other says.
//   - N clearing while R also clears means reversal, already closed, not illiquidity. Report it so.
//   - N clearing while L clears by as much means an illiquidity premium, not a normalisation signal.
//   - If nothing clears, MR08 is CLOSED and this file records it.
//
// Usage: node illiquidity-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { amihud, illiquidityZ, normalisation } from "./illiquidity.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { screenUniverse } from "./universe.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const ROOT = "sp500-bundle";
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const Q = 0.05, ZWIN = 60, LOOK = 10, HOLD = 5, DECILE = 0.10, REVLOOK = 5;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// ---- panel: returns, illiquidity z, per symbol ---------------------------
const panel = new Map();     // symbol -> { times, ret[], z[] } aligned
const allDates = new Set();
// SCREEN BEFORE RANKING, and this study needs it most: the screen's own criteria are zero-volume
// bars and dollar-volume floors, which is exactly what Amihud ranks on. An unscreened corrupt
// series would be the most illiquid name in the cross-section every single rebalance.
const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);
for (const s of Object.keys(screened.kept)) {
  const c = screened.kept[s];
  if (c.length < ZWIN + LOOK + 20) continue;
  const times = [], rets = [], ill = [];
  for (let i = 1; i < c.length; i++) {
    const p = Number(c[i - 1].close), q = Number(c[i].close);
    if (!(p > 0) || !(q > 0)) continue;
    const r = q / p - 1;
    times.push(c[i].time); rets.push(r); ill.push(amihud(r, q, c[i].volume));
    allDates.add(c[i].time);
  }
  const z = illiquidityZ(ill, ZWIN);
  panel.set(s, { idx: new Map(times.map((t, i) => [t, i])), times, rets, z });
}
const dates = [...allDates].sort((a, b) => a - b);
const names = [...panel.keys()];
const nullIll = names.reduce((a, s) => a + panel.get(s).z.filter((v) => v === null).length, 0);
const totIll = names.reduce((a, s) => a + panel.get(s).z.length, 0);
console.log(`universe ${names.length} symbols, ${dates.length} dates`);
console.log(`illiquidity z unavailable on ${nullIll}/${totIll} symbol-days (${pct(nullIll / totIll)}) — warm-up plus any zero-volume sessions`);

const rebalances = [];
for (let i = ZWIN + LOOK; i + HOLD < dates.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(names.length * DECILE));
console.log(`${rebalances.length} rebalances, decile = ${N_PICK} names`);

function forward(i) {
  const fwd = new Map();
  for (const s of names) {
    const P = panel.get(s);
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + HOLD, dates.length); k++) {
      const j = P.idx.get(dates[k]);
      if (j === undefined) continue;
      eq *= 1 + P.rets[j]; seen++;
    }
    if (seen) fwd.set(s, eq - 1);
  }
  return fwd;
}

const SIGNALS = {
  N: (P, j) => normalisation(P.z.slice(Math.max(0, j - LOOK + 1), j + 1), LOOK),
  L: (P, j) => P.z[j],
  R: (P, j) => {
    if (j < REVLOOK) return null;
    let eq = 1;
    for (let k = j - REVLOOK + 1; k <= j; k++) eq *= 1 + P.rets[k];
    return -(eq - 1);                      // losers rank highest
  },
};

const rounds = [];
for (const i of rebalances) {
  const t = dates[i], fwd = forward(i), sc = { N: new Map(), L: new Map(), R: new Map() };
  const pool = [];
  for (const s of names) {
    const P = panel.get(s), j = P.idx.get(t);
    if (j === undefined) continue;
    pool.push(s);
    for (const k of ["N", "L", "R"]) {
      const v = SIGNALS[k](P, j);
      if (v !== null && Number.isFinite(v)) sc[k].set(s, v);
    }
  }
  if (pool.length >= N_PICK + 5) rounds.push({ fwd, sc, pool });
}
console.log(`usable rebalances: ${rounds.length}/${rebalances.length}`);

function runCell(key) {
  const rets = [];
  for (const r of rounds) {
    const ranked = [...r.sc[key].entries()].sort((a, b) => b[1] - a[1]);   // highest score first
    if (ranked.length < N_PICK) { rets.push(0); continue; }
    const picks = ranked.slice(0, N_PICK).map((x) => x[0]);
    rets.push(mean(picks.map((s) => r.fwd.get(s)).filter((v) => v !== undefined)));
  }
  return { gross: compound(rets, 0), net: compound(rets, 2 * LEG), rets };
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
    draws.push(compound(rets, 2 * LEG));
    sharpes.push(sharpe(rets));
  }
  return { draws, sharpes };
}

function sharpe(rets) {
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1));
  return sd > 1e-12 ? (m / sd) * Math.sqrt(252 / HOLD) : 0;
}

const bhDaily = dates.map((t) => {
  const v = [];
  for (const s of names) { const P = panel.get(s), j = P.idx.get(t); if (j !== undefined) v.push(P.rets[j]); }
  return v.length ? mean(v) : 0;
});
const bh = compound(bhDaily, 0) - 2 * LEG;
console.log(`\nBASELINE equal-weight buy-and-hold: ${pct(bh)} over ${(dates.length / 252).toFixed(2)}y`);

console.log(`\nrunning ${DRAWS} selection-null draws...`);
const N = selectionNull(DRAWS);
const nullSharpe = mean(N.sharpes);
console.log(`NULL: mean return ${pct(nullSummary(N.draws, 0).nullMean)}, mean Sharpe ${nullSharpe.toFixed(3)} (coin-flip picks, same geometry and costs)`);

const cells = [
  { id: "N", name: "MR08: illiquidity spike, then normalised" },
  { id: "L", name: "illiquidity LEVEL (premium, not signal)" },
  { id: "R", name: "5d reversal (CONTROL, already killed)" },
];
for (const c of cells) {
  Object.assign(c, runCell(c.id));
  c.sharpe = sharpe(c.rets);
  c.p = nullSummary(N.draws, c.net).p;
  c.beatsBH = c.net > bh;
  c.beatsNullSharpe = c.sharpe > nullSharpe;
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
console.log(`\nSharpe against the NULL's ${nullSharpe.toFixed(3)}, not the index's: ` +
  cells.map((c) => `${c.id} ${c.beatsNullSharpe ? "above" : "below"}`).join(", "));

const survivors = cells.filter((c) => c.beatsBH && c.clearsBH);
console.log(`\nsurvivors: ${survivors.length ? survivors.map((c) => c.id).join(", ") : "NONE"}`);
if (!survivors.length) {
  console.log("VERDICT: MR08 illiquidity normalisation CLOSED. Fourteenth family, same two gates.");
} else {
  if (survivors.some((c) => c.id === "R")) console.log("NOTE: the reversal CONTROL also cleared. That is reversal, already KILLED as B5-REVERSAL, not illiquidity.");
  if (survivors.some((c) => c.id === "L")) console.log("NOTE: the LEVEL cell cleared. That is an illiquidity premium, not the normalisation signal MR08 describes.");
  console.log("Do NOT promote from this run: re-register on a held-out window first.");
}
