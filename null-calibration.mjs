#!/usr/bin/env node
/**
 * null-calibration.mjs — recompute the geometry calibration on stocks alone.
 *
 * WHY THIS EXISTS. Five closed studies quote one number as the bar a decile-rotation book must
 * clear: a random-selection null returning roughly +33.70% net at mean Sharpe ~0.85, replicated
 * independently by RESIDUAL-MEAN-REVERSION (+33.70% / 0.850) and AMIHUD-ILLIQUIDITY (+33.29% /
 * 0.827). It is the most reused quantity in this project.
 *
 * On 2026-09-19 MR04 voided and the diagnosis was that 10 of the bundle's 127 screened names are
 * index and sector ETFs -- IWM, QQQ, SPY, XLE, XLF, XLI, XLK, XLP, XLU, XLV -- which nothing in
 * this repository had recorded. Both replications drew their random selections from that pool, so
 * the calibration describes "pick 13 of 127 instruments, 10 of which are baskets of the other
 * 117", not "pick 13 stocks". The same applies to the equal-weight baseline every gate 1 uses.
 *
 * THIS IS NOT A NEW STUDY AND SCORES NO STRATEGY. It has no signal, no ranking and no cells. It
 * recomputes two reference quantities under a corrected universe so the closed verdicts can be
 * cited accurately. No verdict can move: nothing here evaluates a mechanism.
 *
 * THREE POOLS, BECAUSE "THE UNIVERSE CHANGED" IS NOT A DIAGNOSIS. Dropping the ETFs changes both
 * what can be drawn AND the leg size, since the decile is 10% of a smaller pool. Those are
 * separated rather than reported as one move:
 *
 *   A  127 instruments, 13/leg   the pool both replications used
 *   B  117 stocks,      12/leg   the honest decile on stocks alone
 *   C  117 stocks,      13/leg   same leg size as A, so only composition differs
 *
 * GEOMETRY IS INHERITED, NOT CHOSEN: 120-day warmup before the first rebalance, rebalance and hold
 * 5 days, usEquityIbkr costs charged 2 legs long-only and 4 long-short, the same seed the residual
 * study used. Nothing is swept.
 *
 * Usage: node null-calibration.mjs [draws]
 */
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { seededRng } from "./inference.mjs";
import { screenUniverse } from "./universe.mjs";
import { loadSectorMap } from "./sector-map.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const ROOT = "sp500-bundle";
const COST = COST_MODELS.usEquityIbkr;
const LEG = COST.feeRate + COST.slipPct;
const W = 120, HOLD = 5, DECILE = 0.10, SEED = 20260911;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sharpe = (r, per) => {
  if (r.length < 2) return 0;
  const m = mean(r);
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  return sd > 1e-12 ? (m / sd) * Math.sqrt(252 / per) : 0;
};

// ---- panel, screened exactly as every study on this bundle screens it -------------------------
const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);

const ret = new Map();
const allDates = new Set();
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
const dates = [...allDates].sort((a, b) => a - b);
const ALL = [...ret.keys()];

// An instrument is a stock here if IBKR gave it an industry. That is the vendor's own answer to
// "is this a company", and it is used rather than a hand-kept ticker list for the same reason
// sector-map.mjs refuses to crosswalk: a list maintained here would be this project's guess.
const sectors = loadSectorMap("data/sector-map.json");
if (!sectors) {
  console.error("needs data/sector-map.json — it is what identifies which names are companies.");
  console.error("Run scripts/ibkr-collect.mjs where a Gateway is reachable. Nothing was run.");
  process.exit(2);
}
const STOCKS = ALL.filter((s) => sectors.map.has(s.toUpperCase()));
const ETFS = ALL.filter((s) => !sectors.map.has(s.toUpperCase()));
console.log(`\n${ALL.length} screened: ${STOCKS.length} with an IBKR industry, ${ETFS.length} without`);
console.log(`without (these are the index and sector ETFs): ${ETFS.join(", ")}`);
console.log(`map "${sectors.source}", asOf ${sectors.asOf}\n`);

const rebalances = [];
for (let i = W; i + HOLD < dates.length; i += HOLD) rebalances.push(i);

/** Forward HOLD-day total return per name from rebalance index i, over a given pool. */
function forward(i, pool) {
  const fwd = new Map();
  for (const s of pool) {
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

/** Equal-weight baseline, in the definition every gate 1 in this project uses. */
function baseline(pool) {
  const daily = dates.map((t) => {
    const v = [];
    for (const s of pool) { const r = ret.get(s).get(t); if (r !== undefined) v.push(r); }
    return v.length ? mean(v) : 0;
  });
  return { net: compound(daily, 0) - 2 * LEG, sharpe: sharpe(daily, 1) };
}

/** The selection null: the same geometry with the ranking replaced by a coin flip. */
function selectionNull(pool, nPick, book, k) {
  const fwds = rebalances.map((i) => forward(i, pool));
  const rng = seededRng(SEED);
  const rets = [], shs = [];
  for (let d = 0; d < k; d++) {
    const series = [];
    for (const fwd of fwds) {
      const bag = [...pool];
      const take = () => {
        const out = [];
        for (let j = 0; j < nPick && bag.length; j++) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
        return out;
      };
      const L = mean(take().map((s) => fwd.get(s)).filter((v) => v !== undefined));
      if (book === "LO") { series.push(L); continue; }
      const S = mean(take().map((s) => fwd.get(s)).filter((v) => v !== undefined));
      series.push((L - S) / 2);
    }
    rets.push(compound(series, (book === "LS" ? 4 : 2) * LEG));
    shs.push(sharpe(series, HOLD));
  }
  rets.sort((a, b) => a - b);
  return {
    meanNet: mean(rets), meanSharpe: mean(shs),
    p05: rets[Math.floor(k * 0.05)], p95: rets[Math.floor(k * 0.95)],
  };
}

const CONFIGS = [
  { id: "A", pool: ALL,    nPick: Math.max(1, Math.round(ALL.length * DECILE)),    note: "the pool both replications used" },
  { id: "B", pool: STOCKS, nPick: Math.max(1, Math.round(STOCKS.length * DECILE)), note: "the honest decile on stocks alone" },
  { id: "C", pool: STOCKS, nPick: Math.max(1, Math.round(ALL.length * DECILE)),    note: "A's leg size, so only composition differs" },
];

console.log(`${rebalances.length} rebalances, hold ${HOLD}d, ${DRAWS} draws per book, seed ${SEED}\n`);
console.log("BASELINE — equal-weight, the bar gate 1 uses");
for (const c of [{ id: "127 instruments", pool: ALL }, { id: "117 stocks", pool: STOCKS }]) {
  const b = baseline(c.pool);
  console.log(`  ${c.id.padEnd(18)} ${pct(b.net).padStart(8)} net   Sharpe ${b.sharpe.toFixed(3)}`);
}

for (const book of ["LO", "LS"]) {
  console.log(`\nSELECTION NULL, ${book} — the bar gate 2 uses`);
  for (const c of CONFIGS) {
    const n = selectionNull(c.pool, c.nPick, book, DRAWS);
    console.log(`  ${c.id}  ${String(c.pool.length).padStart(3)} names, ${c.nPick}/leg   ` +
                `mean ${pct(n.meanNet).padStart(8)} net   Sharpe ${n.meanSharpe.toFixed(3)}   ` +
                `5-95% [${pct(n.p05)}, ${pct(n.p95)}]   ${c.note}`);
  }
}
console.log("\nA is the reproduction check: it should land on the recorded +33.70% / 0.850 (LO).");
console.log("B is the number to quote from now on. C says how much of the move is leg size.");
