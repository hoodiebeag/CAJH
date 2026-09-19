// FACTOR TREND-FOLLOWING (CF12): pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11. Fourth of the six Tier-A survivors of the manual triage. MR11/HX13,
// RV02/RV03 and MR08 are closed in VERDICTS.md.
//
// THE CLAIM, and why it is not simply a re-run of the factors already killed here. CF12's rule is
// "trade the FACTOR SPREAD itself with trend rules; long factors whose recent spread is rising,
// short falling." The inputs are factors this project has already tested individually and closed --
// Momentum M7, B5-REVERSAL, Low-vol B4 among them. CF12 does not claim any of them works. It claims
// that TIMING a portfolio of them adds value even though none works standing alone. That is a
// different claim about a different series: the object being trended is a factor's long-short
// spread return, not a price. Whether the claim is plausible is a separate matter from whether it
// is distinct, and it is distinct.
//
// THE PRIOR IS POOR AND THE REASONS ARE SPECIFIC.
//   1. Factor timing is among the best-documented hard problems in the literature, and the honest
//      summary of it is that factor spreads are close to unforecastable from their own history.
//   2. A factor spread is long-short by construction, and this project has now MEASURED what that
//      geometry costs on this universe: the long-short null returns -29.43% over 3.65 years,
//      because two legs turning over every five days at 11bp a leg is about 30 points. CF12 must
//      clear that hole before it clears anything else.
//   3. It is a price transform of price transforms. The campaign brief's standing judgement is that
//      only new data unblocks research, and this is not new data.
// Stating all three now so that a negative cannot be presented as a surprise and a positive gets
// the scrutiny rule 8 requires.
//
// CONSTRUCTION, fixed in advance. Universe sp500-bundle/1440, SCREENED (rule 1 -- and screened
// specifically because PARA distorted the three studies that preceded this one). Each of
// factors.mjs's documented signals becomes a dollar-neutral decile spread rebalanced every 5 days:
// long the top decile, short the bottom, spread return (L - S) / 2. That yields one return series
// per factor, and those series -- not prices -- are what the trend rule is applied to.
//
// THREE CELLS. Family size 3, Benjamini-Hochberg at q=0.05.
//   T  CF12 as a long-only-in-factor-space rule: hold a factor when its own trailing 12-rebalance
//      spread return is positive, otherwise sit out. Equal weight across whatever is active.
//   S  CF12 literal, both signs: long the rising factors, SHORT the falling ones.
//   A  ALWAYS ON -- every factor held every period, equal weight, no timing. THE CONTROL.
// A is what makes the study answerable. CF12's entire content is the timing rule, so a T that beats
// buy-and-hold while matching A has demonstrated a factor portfolio, not a timing signal. Without A
// this study could only measure whether factors work, which is a question already answered here.
//
// TWO GATES, BOTH REQUIRED:
//   1. BEATS THE EQUAL-WEIGHT BUY-AND-HOLD of the screened universe over the same window.
//   2. BEATS A MATCHED TIMING NULL -- the same number of active periods per factor as T actually
//      used, placed at random. This isolates timing skill from the factors themselves, which is the
//      only thing CF12 claims. A random-selection null over symbols would answer the wrong question.
//
// KILL CONDITIONS, stated before the run:
//   - A cell failing either gate is dead, whatever the other says.
//   - T beating buy-and-hold while failing to beat A is a factor portfolio, not factor timing, and
//     must be reported as the former. This is the most likely form of a false positive here.
//   - Neither T nor S is executable on this account in any case: a factor spread requires shorting
//     and IBKR shortability is UNKNOWN on 128/128 symbols. A survivor is a reason to chase the
//     borrow entitlement, not a strategy to turn on. Stated now, not after seeing one.
//   - If no cell clears both gates, CF12 is CLOSED and this file records it.
//
// Usage: node cf12-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { SIGNALS, basketReturns } from "./factors.mjs";
import { buildGrid } from "./multifactor.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const ROOT = "sp500-bundle";
const LEG = COST_MODELS.usEquityIbkr.feeRate + COST_MODELS.usEquityIbkr.slipPct;
const Q = 0.05, HOLD = 5, DECILE = 0.10, TRENDWIN = 12;   // 12 rebalances ~ 60 trading days

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// ---- universe ------------------------------------------------------------
const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);
const { symbols, times, grid } = buildGrid(screened.kept);
const volume = {};
for (const s of symbols) {
  const m = new Map(screened.kept[s].map((c) => [Number(c.time), Number(c.volume)]));
  volume[s] = times.map((t) => m.get(t) ?? null);
}
const basket = basketReturns(grid, symbols, times);
console.log(`universe ${symbols.length} symbols, ${times.length} dates`);

const WARMUP = 252;
const rebalances = [];
for (let i = WARMUP; i + HOLD < times.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(symbols.length * DECILE));
console.log(`${rebalances.length} rebalances, decile = ${N_PICK} per leg, trend window ${TRENDWIN} rebalances`);

/** Forward HOLD-bar simple return per symbol from index i. */
function forward(i) {
  const f = new Map();
  const j = Math.min(i + HOLD, times.length - 1);
  for (const s of symbols) {
    const a = grid[s][i], b = grid[s][j];
    if (a > 0 && b > 0) f.set(s, b / a - 1);
  }
  return f;
}

// ---- one spread return series per factor --------------------------------
const factorNames = Object.keys(SIGNALS);
const spread = {};                              // factor -> array over rebalances
for (const name of factorNames) spread[name] = [];
for (const i of rebalances) {
  const fwd = forward(i);
  for (const name of factorNames) {
    const scored = [];
    for (const s of symbols) {
      const v = SIGNALS[name](grid[s], i, { volume, symbol: s, basket });
      if (v !== null && Number.isFinite(v) && fwd.has(s)) scored.push([s, v]);
    }
    if (scored.length < N_PICK * 2) { spread[name].push(0); continue; }
    scored.sort((a, b) => b[1] - a[1]);
    const L = mean(scored.slice(0, N_PICK).map((x) => fwd.get(x[0])));
    const S = mean(scored.slice(-N_PICK).map((x) => fwd.get(x[0])));
    spread[name].push((L - S) / 2);
  }
}
const R = rebalances.length;
console.log(`\nFACTOR SPREADS, gross, no timing (each a dollar-neutral decile book over ${R} rebalances)`);
for (const name of factorNames) {
  console.log(`  ${name.padEnd(14)} total ${pct(compound(spread[name], 0)).padStart(10)}  mean/rebalance ${(mean(spread[name]) * 100).toFixed(3)}%`);
}

// ---- the three books -----------------------------------------------------
/** `decide(name, r)` returns +1, 0 or -1 for factor `name` at rebalance index r. */
function book(decide) {
  const rets = [], active = [];
  for (let r = 0; r < R; r++) {
    const on = [];
    for (const name of factorNames) {
      const w = decide(name, r);
      if (w !== 0) on.push([name, w]);
    }
    active.push(on.length);
    if (!on.length) { rets.push(0); continue; }
    // Equal weight across active factors; each factor book turns over BOTH legs every rebalance.
    rets.push(mean(on.map(([name, w]) => w * spread[name][r])) - 4 * LEG);
  }
  return { total: compound(rets, 0), rets, meanActive: mean(active) };
}

const trendSign = (name, r) => {
  if (r < TRENDWIN) return 0;
  let eq = 1;
  for (let k = r - TRENDWIN; k < r; k++) eq *= 1 + spread[name][k];
  return eq - 1 > 0 ? 1 : -1;
};

const T = book((name, r) => (trendSign(name, r) > 0 ? 1 : 0));
const S = book((name, r) => (r < TRENDWIN ? 0 : trendSign(name, r)));
const A = book(() => 1);

// ---- matched timing null -------------------------------------------------
// T's own on-rate per factor, reproduced with the active periods placed at random.
const onCount = {};
for (const name of factorNames) {
  let n = 0;
  for (let r = TRENDWIN; r < R; r++) if (trendSign(name, r) > 0) n++;
  onCount[name] = n;
}
function timingNull(k) {
  const rng = seededRng(20260911);
  const draws = [];
  for (let d = 0; d < k; d++) {
    const on = {};
    for (const name of factorNames) {
      const slots = [];
      for (let r = TRENDWIN; r < R; r++) slots.push(r);
      const chosen = new Set();
      for (let j = 0; j < onCount[name] && slots.length; j++) chosen.add(slots.splice(Math.floor(rng() * slots.length), 1)[0]);
      on[name] = chosen;
    }
    draws.push(book((name, r) => (on[name].has(r) ? 1 : 0)).total);
  }
  return draws;
}

// ---- baseline ------------------------------------------------------------
const bhDaily = [];
for (let i = 1; i < times.length; i++) {
  const v = [];
  for (const s of symbols) { const a = grid[s][i - 1], b = grid[s][i]; if (a > 0 && b > 0) v.push(b / a - 1); }
  bhDaily.push(v.length ? mean(v) : 0);
}
const bh = compound(bhDaily, 0) - 2 * LEG;
console.log(`\nBASELINE equal-weight buy-and-hold: ${pct(bh)} over ${(times.length / 252).toFixed(2)}y`);

console.log(`\nrunning ${DRAWS} matched timing-null draws...`);
const nullDraws = timingNull(DRAWS);
console.log(`NULL: mean ${pct(nullSummary(nullDraws, 0).nullMean)} (T's own on-rate per factor, periods placed at random)`);

const cells = [
  { id: "T", name: "CF12: hold rising factors, sit out falling", ...T },
  { id: "S", name: "CF12 literal: long rising, short falling", ...S },
  { id: "A", name: "ALWAYS ON, no timing (CONTROL)", ...A },
];
for (const c of cells) {
  c.p = nullSummary(nullDraws, c.total).p;
  c.beatsBH = c.total > bh;
}
const sorted = [...cells].sort((a, b) => a.p - b.p);
sorted.forEach((c, i) => { c.clearsBH = c.p <= (Q * (i + 1)) / sorted.length; });
for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i + 1].clearsBH) sorted[i].clearsBH = true;

console.log(`\n${"cell".padEnd(4)}${"mechanism".padEnd(44)}${"net".padStart(10)}${"active".padStart(8)}${"vs B&H".padStart(10)}${"null p".padStart(9)}  verdict`);
for (const c of cells) {
  const g = [];
  if (!c.beatsBH) g.push("loses to buy-and-hold");
  if (!c.clearsBH) g.push("no timing skill");
  console.log(`${c.id.padEnd(4)}${c.name.padEnd(44)}${pct(c.total).padStart(10)}${c.meanActive.toFixed(1).padStart(8)}` +
    `${((c.total > bh ? "+" : "") + pct(c.total - bh)).padStart(10)}${c.p.toFixed(4).padStart(9)}  ` +
    (g.length ? `DEAD (${g.join("; ")})` : "CLEARS BOTH GATES"));
}
console.log(`\nTIMING vs NO TIMING, the question CF12 actually asks: T ${pct(T.total)} against the always-on control's ${pct(A.total)}` +
  ` — timing ${T.total > A.total ? "ADDS" : "SUBTRACTS"} ${pct(Math.abs(T.total - A.total))}`);

const survivors = cells.filter((c) => c.beatsBH && c.clearsBH && c.id !== "A");
console.log(`\nsurvivors: ${survivors.length ? survivors.map((c) => c.id).join(", ") : "NONE"}`);
if (!survivors.length) {
  console.log("VERDICT: CF12 factor trend-following CLOSED. Fifteenth family, same two gates.");
} else {
  if (survivors.every((c) => c.total <= A.total)) {
    console.log("NOTE: every survivor matches or trails the always-on control. That is a factor portfolio,");
    console.log("not factor timing, and CF12 claims the latter.");
  }
  console.log("NOT EXECUTABLE regardless: a factor spread needs shorting, unknown on 128/128 IBKR symbols.");
}
