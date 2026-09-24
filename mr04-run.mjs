// MR04 SECTOR-NEUTRAL RESIDUAL MEAN REVERSION: pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-18, BEFORE the sector map that this study requires exists. That ordering is the
// point: rule 9 says pre-register before the data exists, and here the data genuinely does not.
// Nothing below can have been chosen to fit a number, because there is no number yet to fit.
//
// THE PRIOR IS POOR AND IS STATED FIRST, NOT LAST.
// MR04 is the sector-plus-market residual version of a mechanism this project already CLOSED at
// market-only: RESIDUAL-MEAN-REVERSION-RV02-RV03, 0 of 4 cells, 2026-09-11. That study's best
// long-only cell returned +49.25% net at Sharpe 0.963 -- the highest Sharpe in this project's
// history -- and still failed both gates, because a COIN FLIP under the same geometry returns
// +33.70% net at mean Sharpe 0.850 and buy-and-hold returns +68.86%. Adding a second regressor to
// a residual model whose first regressor produced nothing is not a promising starting position and
// should not be described as one when the results arrive.
//
// SO WHY RUN IT AT ALL. Because a GICS sector label is genuinely non-price information that is not
// derivable from anything in this repository, and the project's own do-not-reopen rule turns on
// exactly that: a killed row may be revisited on a new INFORMATION SOURCE, not on a new parameter.
// A sector classification qualifies. It qualifies NARROWLY -- it is one categorical variable, not
// a new dataset -- and that narrowness is why this paragraph exists rather than a claim that MR04
// is a fresh idea.
//
// THE GATE THAT ACTUALLY TESTS MR04'S CLAIM IS GATE 3, AND IT IS NEW HERE.
// MR04's claim is not "residual reversion works". That claim was tested and failed. Its claim is
// "sector-neutralising the residual adds something the market-only residual missed". A cell that
// beats buy-and-hold and beats the selection null but does NOT beat the market-only ancestor has
// not demonstrated MR04; it has demonstrated that the window moved. So:
//   GATE 1  beat the equal-weight buy-and-hold of the same names over the same window
//   GATE 2  beat a matched selection null -- same decile sizes, same dates, same holding, same
//           costs, ranking replaced by a coin flip; drawn WITHIN SECTOR for the within-sector cells
//           so the null carries the same structural constraint the book does
//   GATE 3  beat cell C, the market-only ancestor, reproduced on THIS universe and THIS date grid
// All three are required. Gate 3 is the one MR04 has to earn, and it is scored as a difference in
// net return with the null's spread as the yardstick for whether that difference means anything.
//
// TWO READINGS OF "SECTOR-NEUTRAL", BOTH PRE-REGISTERED, BECAUSE THE MANUAL DOES NOT DISAMBIGUATE.
// The strategy library says "residual mean reversion, sector-neutral" and there are two distinct
// mechanisms behind that phrase. Picking one after seeing results would be a choice made on the
// outcome, so both are fixed now and both are in the family:
//   S  SECTOR-NEUTRAL RESIDUAL. Two-factor OLS per name -- equal-weight market, plus that name's
//      own equal-weight sector index -- residual path z-scored, ranked across the whole universe.
//      Neutralises the exposure inside the signal.
//   W  WITHIN-SECTOR SELECTION. Market-only residual, exactly as the closed study built it, but
//      ranked and picked WITHIN each sector, taking the same decile fraction from each. The book
//      is sector-balanced by construction rather than by regression.
// TWO BOOKS each, because the research question and the executable question differ:
//   LS  long the most depressed decile, short the most extended -- the form the manual specifies
//   LO  the long leg alone -- the only form this account can currently place
// FAMILY SIZE 4 (S-LS, S-LO, W-LS, W-LO). Benjamini-Hochberg at q=0.05 across the four.
//
// CELL C IS A CONTROL AND A REPRODUCTION CHECK, AND IS NOT IN THE FAMILY.
// C is the market-only residual long-only book: the closed study's M-LO, rebuilt here. It has two
// jobs. It supplies gate 3's comparison, and it verifies that this runner reproduces a known
// answer before any of its new numbers are believed. The HX02 study learned this the hard way --
// a reproduction cell returned -4.20% against a known +49.25% because the pre-registration had
// described a raw unnormalised sum as a z-score of a cumulative path. So the expected value is
// written down HERE, in advance: C should land near +49.25% net at Sharpe ~0.963 on the full
// 127-name universe. It will NOT match exactly, and the reason is known in advance too: this study
// runs on the sector-map-covered subset, which is smaller, so the decile is a different number of
// names and the geometry is not identical. A gap of a few points is expected. A sign flip, or a
// gap of tens of points, means this runner is wrong and every other cell in it is void.
//
// VOID RATHER THAN REPAIR. If C fails its reproduction check the run reports VOID and scores
// nothing. It does not adjust the check to match what it produced.
//
// GEOMETRY, ALL FIXED HERE, AND ALL INHERITED FROM THE CLOSED STUDY SO THE COMPARISON IS LIKE FOR
// LIKE: 120-day fitting window ending strictly before the decision; residual path z-scored over
// its trailing 60 days; rebalance every 5 days; hold 5 days; decile = 10%; usEquityIbkr costs
// (0.5bp fee + 5bp slippage per leg), charged on both legs of an LS book. Nothing here is swept.
// The one number that is NOT inherited is the per-leg name count, which falls out of how many
// symbols the sector map covers, and that is reported rather than chosen.
//
// ANACHRONISM IN THE LABELS, ACKNOWLEDGED IN ADVANCE. The sector map is point-in-time as of its
// own `asOf` date and is applied across a window that starts earlier. Names reclassify. This
// biases toward the study looking BETTER than it should, because today's classification embeds
// knowledge of which names ended up where -- so a cell that fails under this generosity has
// genuinely failed, while a cell that clears carries an asterisk and must be re-run on
// point-in-time labels before anyone believes it. Stated now so it cannot be discovered later.
//
// A SURVIVING LS CELL IS NOT ACTIONABLE, AND THIS IS STATED NOW rather than after seeing one. The
// IBKR universe probe returned shortability UNKNOWN on 128 of 128 symbols and available on 0. An
// LS result is a reason to chase the borrow entitlement and nothing more. Only an LO cell could be
// placed on the account as it stands.
//
// KILL CONDITIONS, STATED BEFORE THE RUN:
//   - A cell failing ANY of the three gates is dead, whatever the other two say.
//   - If C fails reproduction, the whole run is VOID and no cell is scored.
//   - If S clears and W does not, or vice versa, the mechanism has not been found: the two are
//     readings of one claim, and one clearing alone is a property of that construction.
//   - If a cell clears only because the sector-covered subset is smaller and more liquid than the
//     full universe, the null catches it -- the null is drawn from the same subset. If a cell
//     beats the null but not C, sector information added nothing and MR04 is closed.
//   - If no cell clears all three gates, MR04 is CLOSED and this file records it.
//
// Usage: node mr04-run.mjs [nullDraws] [sectorMapPath]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { pcaResidualMatrix, betaResidualSeries, zLast } from "./residual.mjs";
import { seededRng, nullSummary } from "./inference.mjs";
import { screenUniverse } from "./universe.mjs";
import { loadSectorMap, applySectorMap } from "./sector-map.mjs";
import { COST_MODELS } from "./costs.mjs";
import { compound } from "./overnight.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const MAP_FILE = process.argv[3] ?? "data/sector-map.json";
const ROOT = "sp500-bundle";
const COST = COST_MODELS.usEquityIbkr;
const LEG = COST.feeRate + COST.slipPct;
const Q = 0.05, W = 120, ZWIN = 60, HOLD = 5, DECILE = 0.10;

// The closed study's M-LO, written down before this run so the check cannot be moved afterwards.
const C_EXPECTED_NET = 0.4925, C_EXPECTED_SHARPE = 0.963, C_TOLERANCE = 0.20;

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sharpe = (rets) => {
  if (rets.length < 2) return 0;
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1));
  // Annualised from HOLD-day periods; the closed study used the same convention.
  return sd > 1e-12 ? (m / sd) * Math.sqrt(252 / HOLD) : 0;
};

// ---- the sector map is a precondition, not an option -----------------------------------------
const sectors = loadSectorMap(MAP_FILE);
if (!sectors) {
  console.error(`MR04 needs a sector map and none is at ${MAP_FILE}.`);
  console.error("");
  console.error("It is a small JSON file and there are exactly two trustworthy routes to it:");
  console.error("  1. node scripts/ibkr-contract-details.mjs   (needs IB Gateway reachable)");
  console.error("  2. an owner-supplied CSV converted to the same shape");
  console.error("");
  console.error("Shape:");
  console.error('  { "scheme": "GICS" | "IBKR-industry" | "IBKR-category" | "custom",');
  console.error('    "source": "where these labels came from",');
  console.error('    "asOf":   "YYYY-MM-DD",');
  console.error('    "sectors": { "AAPL": "Information Technology", ... } }');
  console.error("");
  console.error("The scheme is declared, not guessed: IBKR's industry field is NOT the GICS 11 and");
  console.error("is not crosswalked into it. See sector-map.mjs for why that is refused.");
  console.error("");
  console.error("Nothing was run and nothing was changed. This is a missing input, not a failure.");
  process.exit(2);
}
console.log(`sector map: ${sectors.map.size} symbols, source "${sectors.source}", asOf ${sectors.asOf}`);
console.log(`NOTE: labels are point-in-time as of ${sectors.asOf} and are applied to earlier dates.`);
console.log("This is generous to the study, not conservative. See the pre-registration.\n");

// ---- panel -----------------------------------------------------------------------------------
// SCREEN BEFORE RANKING, and before the sector map is applied: a corrupted series would otherwise
// dominate its sector's index as well as the market's, so it would poison the very regressor that
// is supposed to neutralise it.
const raw = {};
for (const s of availablePairs(1440, ROOT)) raw[s] = loadBundleCandles(s, 1440, ROOT);
const screened = screenUniverse(raw);
for (const [sym, why] of screened.rejected) console.log(`screened out ${sym}: ${why}`);

const ret = new Map();
const allDates = new Set();
for (const s of Object.keys(screened.kept)) {
  const c = screened.kept[s];
  if (c.length < W + ZWIN + 20) continue;
  const m = new Map();
  for (let i = 1; i < c.length; i++) {
    const p = Number(c[i - 1].close), q = Number(c[i].close);
    if (p > 0 && q > 0) { m.set(c[i].time, q / p - 1); allDates.add(c[i].time); }
  }
  ret.set(s, m);
}
const dates = [...allDates].sort((a, b) => a - b);
const fullNames = [...ret.keys()];

const { kept: names, uncovered, thin, bySector } =
  applySectorMap(fullNames, sectors.map, { minPerSector: 3 });
if (uncovered.length) {
  console.log(`sector map does not cover ${uncovered.length}: ${uncovered.slice(0, 12).join(", ")}` +
              `${uncovered.length > 12 ? ", ..." : ""}  (dropped, not bucketed)`);
}
for (const [sec, n] of thin) console.log(`sector "${sec}" dropped: only ${n} names, cannot be neutralised`);

const sectorOf = new Map(names.map((s) => [s, sectors.map.get(s.toUpperCase())]));
console.log(`\nuniverse ${names.length}/${fullNames.length} symbols across ${bySector.size} sectors, ${dates.length} dates`);
for (const [sec, members] of [...bySector.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${sec.padEnd(24)} ${String(members.length).padStart(3)}`);
}

const rebalances = [];
for (let i = W; i + HOLD < dates.length; i += HOLD) rebalances.push(i);
const N_PICK = Math.max(1, Math.round(names.length * DECILE));
// Within-sector picks: the same decile fraction per sector, at least one, so W's book is
// sector-balanced by construction. Its total size will not equal N_PICK and that is reported.
const perSectorPick = new Map(
  [...bySector.entries()].map(([sec, m]) => [sec, Math.max(1, Math.round(m.length * DECILE))]),
);
const W_TOTAL = [...perSectorPick.values()].reduce((a, b) => a + b, 0);
console.log(`\n${rebalances.length} rebalances, hold ${HOLD}d, window ${W}d, z over ${ZWIN}d`);
console.log(`global decile = ${N_PICK} names/leg (cells S, C); within-sector = ${W_TOTAL} names/leg (cell W)`);

/** Names with complete coverage across a window, and the T x N return matrix for them. */
function windowOf(i) {
  const ws = dates.slice(i - W, i);
  const keep = names.filter((s) => ws.every((t) => ret.get(s).has(t)));
  return { keep, ws, X: ws.map((t) => keep.map((s) => ret.get(s).get(t))) };
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

/** z of each name's cumulative residual path over the trailing ZWIN days. Lower = more depressed. */
function pathZ(keep, resid, T) {
  const out = new Map();
  for (let j = 0; j < keep.length; j++) {
    const path = [];
    let cum = 0;
    for (let t = T - ZWIN; t < T; t++) { cum += resid[t][j]; path.push(cum); }
    const z = zLast(path, ZWIN);
    if (z !== null) out.set(keep[j], z);
  }
  return out;
}

/** Residuals against the equal-weight market alone -- the closed study's M estimator, cell C and W. */
function marketResid(keep, X) {
  const mkt = X.map((row) => mean(row));
  const cols = keep.map((_, j) => betaResidualSeries(X.map((row) => row[j]), [mkt]));
  return X.map((_, t) => cols.map((c) => (c ? c[t] : 0)));
}

/** Residuals against market AND the name's own equal-weight sector index -- cell S. */
function sectorResid(keep, X) {
  const mkt = X.map((row) => mean(row));
  // One sector index per sector present in this window, from that sector's members only.
  const idxOf = new Map();
  for (const sec of new Set(keep.map((s) => sectorOf.get(s)))) {
    const cols = keep.map((s, j) => (sectorOf.get(s) === sec ? j : -1)).filter((j) => j >= 0);
    idxOf.set(sec, X.map((row) => mean(cols.map((j) => row[j]))));
  }
  const cols = keep.map((s, j) =>
    betaResidualSeries(X.map((row) => row[j]), [mkt, idxOf.get(sectorOf.get(s))]));
  return X.map((_, t) => cols.map((c) => (c ? c[t] : 0)));
}

// Precompute every window once; all cells and both books reuse it.
const perRebalance = [];
for (const i of rebalances) {
  const { keep, X } = windowOf(i);
  if (keep.length < N_PICK * 2 + 5) { perRebalance.push(null); continue; }
  const T = X.length;
  perRebalance.push({
    i, fwd: forward(i), pool: keep,
    S: pathZ(keep, sectorResid(keep, X), T),
    M: pathZ(keep, marketResid(keep, X), T),
  });
}
const usable = perRebalance.filter(Boolean);
console.log(`usable rebalances: ${usable.length}/${rebalances.length}\n`);

/** Global-ranked book from a score map: "LS" or "LO". */
function runGlobal(key, book) {
  const rets = [];
  for (const r of usable) {
    const ranked = [...r[key].entries()].sort((a, b) => a[1] - b[1]);
    if (ranked.length < N_PICK * 2) { rets.push(0); continue; }
    const L = mean(ranked.slice(0, N_PICK).map((x) => r.fwd.get(x[0])).filter((v) => v !== undefined));
    if (book === "LO") { rets.push(L); continue; }
    const S = mean(ranked.slice(-N_PICK).map((x) => r.fwd.get(x[0])).filter((v) => v !== undefined));
    rets.push((L - S) / 2);
  }
  const legs = book === "LS" ? 4 : 2;
  return { gross: compound(rets, 0), net: compound(rets, legs * LEG), sharpe: sharpe(rets), rets };
}

/** Within-sector book: the same decile fraction from each sector, equal-weighted across picks. */
function runWithin(book) {
  const rets = [];
  for (const r of usable) {
    const longs = [], shorts = [];
    for (const [sec, members] of bySector) {
      const ranked = members
        .filter((s) => r.M.has(s))
        .map((s) => [s, r.M.get(s)])
        .sort((a, b) => a[1] - b[1]);
      const n = perSectorPick.get(sec);
      if (ranked.length < n * 2) continue;
      longs.push(...ranked.slice(0, n).map((x) => x[0]));
      shorts.push(...ranked.slice(-n).map((x) => x[0]));
    }
    if (!longs.length) { rets.push(0); continue; }
    const L = mean(longs.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
    if (book === "LO") { rets.push(L); continue; }
    const S = mean(shorts.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
    rets.push((L - S) / 2);
  }
  const legs = book === "LS" ? 4 : 2;
  return { gross: compound(rets, 0), net: compound(rets, legs * LEG), sharpe: sharpe(rets), rets };
}

/**
 * The same geometry with the ranking replaced by a coin flip.
 *
 * `within` draws inside each sector at the same per-sector counts the W book uses, so the null
 * carries W's structural constraint. Drawing globally against a sector-balanced book would compare
 * two different geometries and credit the balance as if it were signal -- the exact error the
 * geometry calibration exists to prevent.
 */
function selectionNull(book, within, k) {
  const rng = seededRng(20260918);
  const nets = [], sharpes = [];
  const pick = (pool, n) => {
    const a = [...pool];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return { longs: a.slice(0, n), shorts: a.slice(n, 2 * n) };
  };
  for (let d = 0; d < k; d++) {
    const rets = [];
    for (const r of usable) {
      let longs = [], shorts = [];
      if (within) {
        for (const [sec, members] of bySector) {
          const pool = members.filter((s) => r.fwd.has(s));
          const n = perSectorPick.get(sec);
          if (pool.length < n * 2) continue;
          const p = pick(pool, n);
          longs.push(...p.longs); shorts.push(...p.shorts);
        }
      } else {
        const pool = r.pool.filter((s) => r.fwd.has(s));
        if (pool.length < N_PICK * 2) { rets.push(0); continue; }
        const p = pick(pool, N_PICK);
        longs = p.longs; shorts = p.shorts;
      }
      if (!longs.length) { rets.push(0); continue; }
      const L = mean(longs.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
      if (book === "LO") { rets.push(L); continue; }
      const S = mean(shorts.map((s) => r.fwd.get(s)).filter((v) => v !== undefined));
      rets.push((L - S) / 2);
    }
    const legs = book === "LS" ? 4 : 2;
    nets.push(compound(rets, legs * LEG));
    sharpes.push(sharpe(rets));
  }
  return { nets, sharpes };
}

// ---- baseline ---------------------------------------------------------------------------------
// THIS IS COPIED FROM THE CLOSED STUDY DELIBERATELY, INCLUDING A NAMING IMPRECISION IN IT.
//
// residual-run.mjs calls this "equal-weight buy-and-hold", and it is not quite that: it compounds
// the CROSS-SECTIONAL MEAN DAILY RETURN, which is a daily-rebalanced equal-weight portfolio, not a
// buy-and-hold one. The two differ by rebalancing premium and by one round trip of cost, and the
// closed study charges exactly one round trip (2 * LEG) against it.
//
// It is reproduced here rather than corrected because gate 1 has to be THE SAME BAR RV02/RV03 was
// measured against. Writing a truer baseline would quietly lower the bar MR04 has to clear -- the
// per-name buy-and-hold average over the post-warmup window comes out around ten points lower on
// this universe -- and a study that clears an easier gate than its ancestor has demonstrated
// nothing about the ancestor. Comparability beats correctness for this one number, and the
// discrepancy is written down here instead of being silently inherited.
//
// It also spans ALL dates while the books only trade from index W onward. Same reasoning: it is
// what the closed cells were scored against, so it is what these are scored against. The
// same-window figure is printed beside it so the reader can see the size of the effect rather than
// take it on trust.
const bhDaily = dates.map((t) => {
  const v = [];
  for (const s of names) { const r = ret.get(s).get(t); if (r !== undefined) v.push(r); }
  return v.length ? mean(v) : 0;
});
const BH = compound(bhDaily, 0) - 2 * LEG;
const BH_POST_WARMUP = compound(bhDaily.slice(W), 0) - 2 * LEG;

// ---- cell C: reproduction of the closed market-only long-only book ---------------------------
const C = runGlobal("M", "LO");
console.log("=== CELL C: reproduction of the closed market-only M-LO ===");
console.log(`expected ~${pct(C_EXPECTED_NET)} net / Sharpe ~${C_EXPECTED_SHARPE.toFixed(3)} (full 127-name universe)`);
console.log(`observed  ${pct(C.net)} net / Sharpe ${C.sharpe.toFixed(3)}   on ${names.length} sector-covered names`);
const drift = Math.abs(C.net - C_EXPECTED_NET);
if (C.net <= 0 || drift > C_TOLERANCE) {
  console.error(`\nVOID. Cell C is ${pct(drift)} from its pre-registered expectation` +
                `${C.net <= 0 ? " and has the wrong sign" : ""}.`);
  console.error("The pre-registration says a gap this size means this runner is wrong, so every");
  console.error("other cell in it is void. Nothing is scored and nothing is repaired to fit.");
  process.exit(3);
}
console.log(`reproduction OK (${pct(drift)} from expectation, tolerance ${pct(C_TOLERANCE)}).`);
console.log("The gap is the smaller sector-covered universe, as pre-registered.\n");

// ---- the family ------------------------------------------------------------------------------
const CELLS = [
  { id: "S-LO", label: "sector+market residual, global rank, long only",  run: () => runGlobal("S", "LO"), within: false, book: "LO" },
  { id: "S-LS", label: "sector+market residual, global rank, long-short", run: () => runGlobal("S", "LS"), within: false, book: "LS" },
  { id: "W-LO", label: "market residual, within-sector rank, long only",  run: () => runWithin("LO"),      within: true,  book: "LO" },
  { id: "W-LS", label: "market residual, within-sector rank, long-short", run: () => runWithin("LS"),      within: true,  book: "LS" },
];

console.log(`baseline (closed study's definition, all dates): ${pct(BH)} net  <- gate 1 uses this`);
console.log(`  same-window variant, from index ${W}: ${pct(BH_POST_WARMUP)} net (reported, NOT the gate)`);
console.log(`gate 3 comparison (cell C): ${pct(C.net)} net / Sharpe ${C.sharpe.toFixed(3)}\n`);

const rows = [];
for (const cell of CELLS) {
  const r = cell.run();
  const nul = selectionNull(cell.book, cell.within, DRAWS);
  const summary = nullSummary(nul.nets, r.net);
  const nullMeanNet = mean(nul.nets), nullMeanSharpe = mean(nul.sharpes);
  const g1 = r.net > BH;
  const g2 = summary.p < Q;
  const g3 = r.net > C.net;
  rows.push({ ...cell, ...r, p: summary.p, nullMeanNet, nullMeanSharpe, g1, g2, g3 });
  console.log(`${cell.id}  ${cell.label}`);
  console.log(`  net ${pct(r.net)}  gross ${pct(r.gross)}  Sharpe ${r.sharpe.toFixed(3)}`);
  console.log(`  null ${pct(nullMeanNet)} net / Sharpe ${nullMeanSharpe.toFixed(3)} over ${DRAWS} draws, p=${summary.p.toFixed(4)}`);
  console.log(`  gate 1 vs buy-and-hold ${g1 ? "PASS" : "FAIL"} (${pct(r.net - BH)})` +
              `   gate 2 vs null ${g2 ? "PASS" : "FAIL"}` +
              `   gate 3 vs market-only ${g3 ? "PASS" : "FAIL"} (${pct(r.net - C.net)})`);
  console.log("");
}

// ---- Benjamini-Hochberg across the family of 4 -----------------------------------------------
const byP = [...rows].sort((a, b) => a.p - b.p);
let cut = -1;
for (let i = 0; i < byP.length; i++) if (byP[i].p <= ((i + 1) / byP.length) * Q) cut = i;
const bhPass = new Set(byP.slice(0, cut + 1).map((r) => r.id));
console.log(`Benjamini-Hochberg at q=${Q}, family size ${rows.length}: ` +
            `${bhPass.size ? [...bhPass].join(", ") : "nothing survives"}`);

const survivors = rows.filter((r) => r.g1 && r.g3 && bhPass.has(r.id));
console.log("");
if (!survivors.length) {
  console.log("MR04 CLOSED: 0 of 4 cells clear all three gates.");
  console.log("Sector information added nothing the market-only residual did not already have.");
} else {
  console.log(`${survivors.length} cell(s) clear all three gates: ${survivors.map((r) => r.id).join(", ")}`);
  console.log("This is an ASTERISKED result, not a promotion. The labels are point-in-time as of");
  console.log(`${sectors.asOf} and applied to earlier dates, which is generous. Re-run on`);
  console.log("point-in-time labels before this is believed, and note that any LS cell is not");
  console.log("placeable: shortability is UNKNOWN on 128 of 128 IBKR symbols.");
}

// One line per cell for the verdict table, so transcription cannot drift from what ran.
console.log("\n--- for the record ---");
for (const r of rows) {
  console.log(`${r.id}: net ${pct(r.net)}, Sharpe ${r.sharpe.toFixed(3)}, p=${r.p.toFixed(4)}, ` +
              `null ${pct(r.nullMeanNet)}/${r.nullMeanSharpe.toFixed(3)}, ` +
              `vs BH ${pct(r.net - BH)}, vs C ${pct(r.net - C.net)}, ` +
              `gates ${[r.g1, r.g2, r.g3].map((g) => (g ? "P" : "F")).join("")}`);
}
console.log(`C (control, not in family): net ${pct(C.net)}, Sharpe ${C.sharpe.toFixed(3)}`);
console.log(`baseline: ${pct(BH)} (post-warmup ${pct(BH_POST_WARMUP)}) | universe ${names.length}/${fullNames.length} | ` +
            `sectors ${bySector.size} | rebalances ${usable.length} | draws ${DRAWS} | ` +
            `map ${sectors.source} asOf ${sectors.asOf}`);
