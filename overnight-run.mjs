// OVERNIGHT vs INTRADAY RETURN DECOMPOSITION: pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11, after a full read of the owner's IBKR strategy manual. Of its 128 strategies,
// 45 are runnable on data already in this repository and all but six of those are already closed in
// VERDICTS.md under this project's own names. This tests the standout of the six: the manual's MR11
// ("close-to-close vs intraday decomposition") and its portfolio form HX13 ("overnight/intraday
// component rotation").
//
// WHY THIS ONE AND NOT THE OTHER FIVE. Every result in VERDICTS.md -- eleven failed families, three
// killed classifiers, two dead market-neutral mechanisms -- is computed close-to-close. The open
// price has sat in all four bundles the whole time and has never been used as a signal anywhere in
// the repository; its single appearance is gap accounting inside `studies/overlay.mjs`. So this is
// not another transform of a series already exhausted. It is a decomposition of that series into
// two pieces that have never been looked at separately, at zero data cost.
//
// THE PRIOR IS POOR, AND FOR TWO SEPARATE REASONS, both stated before the run so that neither
// result can be read as a surprise.
//   1. The overnight/intraday split is among the most published anomalies in equities, which is
//      to say among the most arbitraged.
//   2. An overnight-only or intraday-only book liquidates and re-establishes itself EVERY SESSION.
//      At the IBKR equity cost model already in this repo -- 0.5bp commission plus 5bp slippage per
//      leg -- that is 11bp of round trip per day, roughly 28% a year. Arithmetic, not pessimism.
// Cells A and B are expected to die at cost even if the gross decomposition is striking.
//
// CRYPTO IS EXCLUDED, DELIBERATELY. A 24/7 market has no overnight session. The 1440-minute bar
// boundary in `candle-bundle` is UTC midnight and nothing closes there, so "open divided by
// previous close" is an arbitrary slice of a continuous tape rather than a gap across a closure.
// Running it anyway would produce six more cells and no more information, and the multiplicity
// would be charged against the equity result. Universe is `sp500-bundle/1440`: 128 US names,
// 921 daily bars, 2023-01 to 2026-09.
//
// AN INTEGRITY GATE RUNS FIRST AND CAN VOID THE WHOLE STUDY. The overnight leg is the only
// quantity in this project that divides one bar's price by the PREVIOUS bar's. If the vendor
// adjusted closes for splits and dividends but left opens raw, a 2:1 split reads as -50% overnight
// and +100% intraday on the same day, and the two very nearly cancel in the close-to-close return
// that every prior study used -- so the corruption is invisible to every existing check here and
// becomes visible only under this decomposition. Pre-registered kill: if more than 1% of
// symbol-days carry |overnight| > 15%, OR the correlation between the overnight and intraday legs
// ON THOSE EXTREME DAYS is below -0.5, the two price series are not on one adjustment basis and
// this study is VOID. It is then reported as void and stopped. It is NOT repaired, and no cell
// below is scored, because a repair chosen after seeing the number is a parameter fitted to it.
//
// THE SIX CELLS, fixed in advance. Family size 6, Benjamini-Hochberg at q=0.05 across them.
//   A  overnight-only    hold the equal-weight book from each close to the next open
//   B  intraday-only     hold it from each open to that day's close
//   C  XS momentum ranked on the OVERNIGHT component alone
//   D  XS momentum ranked on the INTRADAY component alone
//   E  XS momentum ranked on TOTAL close-to-close return -- THE CONTROL
//   F  MR11 literal: long the names whose overnight leg has most unusually lagged their intraday
//      leg over 20 days, which is the divergence the manual's rule names
// E is not padding. Without it, a C or D that scored well would be indistinguishable from the
// decomposition-free momentum this project has already killed four times, and the honest question
// is not "does ranking on a component work" but "does splitting the return beat not splitting it".
//
// TWO GATES, BOTH REQUIRED, the pair that has now closed eleven families:
//   1. BEATS THE EQUAL-WEIGHT BUY-AND-HOLD of the same 128 names over the same window.
//   2. BEATS A MATCHED SELECTION NULL -- the same number of names, drawn at random on the same
//      rebalance dates, held the same way, charged the same costs. Cells A and B select nothing,
//      so for them gate 2 is vacuous and gate 1 alone decides; this is stated here rather than
//      discovered later.
//
// KILL CONDITIONS, stated before the run:
//   - A cell failing either applicable gate is dead, whatever the other says.
//   - C or D beating its own null but not beating E has shown that momentum works, not that the
//     decomposition does. That is a failure of this hypothesis.
//   - If no cell clears both gates, MR11/HX13 is CLOSED and this file records it.
//
// Usage: node overnight-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { decompose, adjustmentBasis, compound } from "./overnight.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { screenUniverse } from "./universe.mjs";
import { COST_MODELS } from "./costs.mjs";

const DRAWS = Number(process.argv[2] ?? 4000);
const ROOT = "sp500-bundle";
const COST = COST_MODELS.usEquityIbkr;          // 0.5bp fee + 5bp slippage per leg
const LEG = COST.feeRate + COST.slipPct;
const Q = 0.05;
const LOOKBACK = 63, HOLD = 5, DECILE = 0.10, ZWIN = 20;
const EXTREME = 0.15, MAX_EXTREME_RATE = 0.01, MIN_TAIL_CORR = -0.5;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// ---- load and decompose -------------------------------------------------
// SCREEN BEFORE RANKING. PARA sits in this bundle with closes spanning $1.06 to $113,900; a series
// that falls five orders of magnitude is the strongest possible extreme in any cross-section and
// gets selected every period. It also produces enormous fake overnight gaps, which would land
// directly in the integrity gate below and be mistaken for an adjustment mismatch.
const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);
const symbols = Object.keys(screened.kept);
const series = new Map();   // symbol -> Map(time -> day)
const pooled = [];
for (const s of symbols) {
  const days = decompose(screened.kept[s]);
  if (days.length < LOOKBACK + HOLD + ZWIN) continue;
  series.set(s, new Map(days.map((d) => [d.time, d])));
  pooled.push(...days);
}
const dates = [...new Set(pooled.map((d) => d.time))].sort((a, b) => a - b);
console.log(`universe ${series.size} symbols, ${dates.length} dates, ${pooled.length} symbol-days`);

// ---- integrity gate -----------------------------------------------------
const basis = adjustmentBasis(pooled, EXTREME);
console.log(`\nINTEGRITY GATE  |overnight|>${EXTREME}: ${basis.extreme}/${basis.n} = ${pct(basis.extremeRate)}` +
  `  tail corr(overnight, intraday) = ${basis.tailCorrelation === null ? "n/a" : basis.tailCorrelation.toFixed(4)}`);
const voided = basis.extremeRate > MAX_EXTREME_RATE ||
  (basis.tailCorrelation !== null && basis.tailCorrelation < MIN_TAIL_CORR);
if (voided) {
  console.log(`VOID: opens and closes are not on one adjustment basis (gate: rate <= ${MAX_EXTREME_RATE}, tail corr >= ${MIN_TAIL_CORR}).`);
  console.log("Not repaired and no cell scored, per the pre-registration. The bundle needs a re-pull with a stated adjustment basis.");
  process.exit(0);
}
console.log("integrity gate PASSED — the decomposition is on one basis, cells scored below.");

// ---- descriptive: where does the return actually live? ------------------
const onAll = pooled.map((d) => d.overnight), idAll = pooled.map((d) => d.intraday);
console.log(`\nDESCRIPTIVE (gross, pooled symbol-days)` +
  `\n  overnight  mean ${(mean(onAll) * 1e4).toFixed(2)}bp/day` +
  `\n  intraday   mean ${(mean(idAll) * 1e4).toFixed(2)}bp/day` +
  `\n  total      mean ${(mean(pooled.map((d) => d.closeToClose)) * 1e4).toFixed(2)}bp/day`);

// ---- cell helpers -------------------------------------------------------
/** Equal-weight book held on one leg every session; one round trip per day. */
function legCell(key) {
  const daily = dates.map((t) => {
    const vals = [];
    for (const m of series.values()) { const d = m.get(t); if (d) vals.push(d[key]); }
    return vals.length ? mean(vals) : 0;
  });
  return { gross: compound(daily, 0), net: compound(daily, 2 * LEG), periods: daily.length };
}

/** Trailing compounded return of one component over `LOOKBACK` days ending before `t`. */
function trailing(m, t, key) {
  const idx = dates.indexOf(t);
  if (idx < LOOKBACK) return null;
  let eq = 1, seen = 0;
  for (let i = idx - LOOKBACK; i < idx; i++) {
    const d = m.get(dates[i]);
    if (!d) continue;
    eq *= 1 + d[key]; seen++;
  }
  return seen >= LOOKBACK * 0.8 ? eq - 1 : null;
}

/** Total close-to-close return of holding `syms` for HOLD days from rebalance index `i`. */
function holdReturn(syms, i) {
  const vals = [];
  for (const s of syms) {
    const m = series.get(s);
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + HOLD, dates.length); k++) {
      const d = m.get(dates[k]);
      if (!d) continue;
      eq *= 1 + d.closeToClose; seen++;
    }
    if (seen) vals.push(eq - 1);
  }
  return vals.length ? mean(vals) : 0;
}

const rebalances = [];
for (let i = LOOKBACK + ZWIN; i + HOLD < dates.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(series.size * DECILE));

/** A rotation cell: rank by `score`, take the top N_PICK, hold HOLD days, charge a full turnover. */
function rotationCell(score) {
  const rets = [];
  for (const i of rebalances) {
    const t = dates[i];
    const ranked = [];
    for (const [s, m] of series) {
      const v = score(m, t);
      if (v !== null && Number.isFinite(v)) ranked.push([s, v]);
    }
    if (ranked.length < N_PICK) { rets.push(0); continue; }
    ranked.sort((a, b) => b[1] - a[1]);
    rets.push(holdReturn(ranked.slice(0, N_PICK).map((r) => r[0]), i));
  }
  return { gross: compound(rets, 0), net: compound(rets, 2 * LEG), periods: rets.length, rets };
}

/** The same geometry with the selection replaced by a coin flip. */
function selectionNull(k) {
  const rng = seededRng(20260911);
  const all = [...series.keys()];
  const draws = [];
  for (let d = 0; d < k; d++) {
    const rets = [];
    for (const i of rebalances) {
      const pool = [...all];
      const pick = [];
      for (let j = 0; j < N_PICK && pool.length; j++) pick.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      rets.push(holdReturn(pick, i));
    }
    draws.push(compound(rets, 2 * LEG));
  }
  return draws;
}

const zDiv = (m, t) => {
  const idx = dates.indexOf(t);
  if (idx < ZWIN) return null;
  const on = [], id = [];
  for (let i = idx - ZWIN; i < idx; i++) { const d = m.get(dates[i]); if (d) { on.push(d.overnight); id.push(d.intraday); } }
  if (on.length < ZWIN * 0.8) return null;
  return -(mean(on) - mean(id));   // most negative divergence ranks highest
};

// ---- baseline -----------------------------------------------------------
const bh = (() => {
  const daily = dates.map((t) => {
    const vals = [];
    for (const m of series.values()) { const d = m.get(t); if (d) vals.push(d.closeToClose); }
    return vals.length ? mean(vals) : 0;
  });
  return compound(daily, 0) - 2 * LEG;   // one entry, one exit, over the whole window
})();
const years = dates.length / 252;
console.log(`\nBASELINE equal-weight buy-and-hold of ${series.size} names: ${pct(bh)} over ${years.toFixed(2)}y` +
  ` (CAGR ${pct(Math.pow(1 + bh, 1 / years) - 1)})`);

// ---- run the six cells --------------------------------------------------
console.log(`\nrunning ${DRAWS} selection-null draws...`);
const nullDraws = selectionNull(DRAWS);

const cells = [
  { id: "A", name: "overnight-only book", ...legCell("overnight"), selects: false },
  { id: "B", name: "intraday-only book", ...legCell("intraday"), selects: false },
  { id: "C", name: "XS momentum on OVERNIGHT component", ...rotationCell((m, t) => trailing(m, t, "overnight")), selects: true },
  { id: "D", name: "XS momentum on INTRADAY component", ...rotationCell((m, t) => trailing(m, t, "intraday")), selects: true },
  { id: "E", name: "XS momentum on TOTAL return (control)", ...rotationCell((m, t) => trailing(m, t, "closeToClose")), selects: true },
  { id: "F", name: "MR11 overnight-lag divergence", ...rotationCell(zDiv), selects: true },
];

for (const c of cells) {
  c.beatsBH = c.net > bh;
  c.null = c.selects ? nullSummary(nullDraws, c.net) : null;
  c.p = c.null ? c.null.p : null;
}

// Benjamini-Hochberg over the cells that have a p-value.
const withP = cells.filter((c) => c.p !== null).sort((a, b) => a.p - b.p);
withP.forEach((c, i) => { c.bhThreshold = (Q * (i + 1)) / withP.length; c.clearsBH = c.p <= c.bhThreshold; });
for (let i = withP.length - 2; i >= 0; i--) if (withP[i + 1].clearsBH) withP[i].clearsBH = true;

console.log(`\n${"cell".padEnd(4)}${"mechanism".padEnd(40)}${"gross".padStart(10)}${"net".padStart(10)}${"cost drag".padStart(11)}${"vs B&H".padStart(10)}${"null p".padStart(10)}${"  verdict"}`);
for (const c of cells) {
  const gates = [];
  if (!c.beatsBH) gates.push("loses to buy-and-hold");
  if (c.selects && !c.clearsBH) gates.push("no selection skill");
  const verdict = gates.length ? `DEAD (${gates.join("; ")})` : "CLEARS BOTH GATES";
  console.log(`${c.id.padEnd(4)}${c.name.padEnd(40)}${pct(c.gross).padStart(10)}${pct(c.net).padStart(10)}` +
    `${pct(c.gross - c.net).padStart(11)}${((c.net > bh ? "+" : "") + pct(c.net - bh)).padStart(10)}` +
    `${(c.p === null ? "n/a" : c.p.toFixed(4)).padStart(10)}  ${verdict}`);
}

const survivors = cells.filter((c) => c.beatsBH && (!c.selects || c.clearsBH));
console.log(`\nnull mean over ${DRAWS} random selections: ${pct(nullSummary(nullDraws, 0).nullMean)}` +
  ` (same geometry, same costs, coin-flip picks)`);
console.log(`\nsurvivors: ${survivors.length ? survivors.map((c) => c.id).join(", ") : "NONE"}`);
if (!survivors.length) {
  console.log("VERDICT: MR11/HX13 CLOSED. The overnight/intraday decomposition is the twelfth family");
  console.log("to be tested here and the twelfth to fail the pair of gates.");
} else {
  console.log("A cell cleared both gates. Do NOT promote it from this run: re-register it as its own");
  console.log("study with a held-out window before anything is built on it.");
}
