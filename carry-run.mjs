// FUNDING RATES: pre-registered analysis, written before the data existed.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-06, while every exchange host is blocked from this container and no funding
// series is obtainable. Nothing below was chosen by looking at a result, because there is nothing
// to look at. That is the point: every prior failure in this project came from choosing after
// seeing -- the PARA symbol, the blend weight, the 30-bar horizon picked out of a grid I had just
// run. This file is fixed before the tarball lands and runs once when it does.
//
// WHY FUNDING. It is the first non-price input this project has had. Every signal tested so far --
// all fourteen -- is a transform of the same OHLCV. Funding is a payment stream between longs and
// shorts, and it carries positioning information that price alone does not.
//
// THE THREE HYPOTHESES, with directions fixed in advance:
//
//   H1  CARRY.  Short the highest-funding names, long the lowest. Return = price spread PLUS the
//       funding collected. Tests whether the perpetual premium is real once the price move against
//       the position is paid for. NOT tradeable by this account -- it needs perpetuals, which is
//       the same venue wall that closed the momentum book -- but it establishes whether the
//       premium exists at all.
//
//   H2  CROWDING, LONG-SHORT SPOT. Same positions as H1, price return ONLY, held in spot.
//       Persistent positive funding means crowded longs; the pre-registered direction is that high
//       trailing funding predicts LOWER subsequent spot return. Non-price information predicting
//       price.
//
//   H3  CROWDING, LONG-ONLY SPOT. Long the lowest-funding names, nothing short. The only one of
//       the three this account can actually hold today.
//
// H1 AND H2 ARE THE SAME BOOK measured two ways -- identical positions, one counting the funding
// stream and one not. They are therefore strongly correlated and are NOT two independent tests.
// Benjamini-Hochberg runs over all nine cells, and the count of genuinely independent groups is
// closer to three (one per lookback) than to nine. Both numbers are reported; neither is hidden.
//
// PARAMETERS, fixed now and not to be swept:
//   lookbacks L in {7, 30, 90} bars -- a week, a month, a quarter. Three values, no others.
//   rebalance 21 bars, topK 3 a side, slippage 0.80%, borrow 5%/yr.
//   Rebalance and topK match the canonical momentum book so results are directly comparable and
//   are not a fresh choice. Slippage is this project's standing punitive crypto assumption.
//
// FAMILY SIZE 9. Benjamini-Hochberg at q = 0.05. A cell significant on its own p but not under BH
// has not survived. A p at the null floor is a bound and is reported as "p < x", never as a value.
//
// TWO VENUES, SEPARATELY. Kraken and OKX funding are analysed independently and never averaged.
// Where they overlap they must agree; a disagreement in sign is a data defect and is reported as
// one rather than resolved by preferring the series that reads better.
//
// KILL CONDITIONS, stated before the data arrives:
//   - If no cell of H2 or H3 clears BH, funding-as-signal is CLOSED and this file says so.
//   - If the two venues disagree in sign on the same symbol and window, nothing is claimed.
//   - A result that appears only at one lookback, or only on one venue, is noise unless it appears
//     across both venues at the same lookback.
//
// NO-LOOKAHEAD. Ranking at bar i uses funding through bar i-1 and not a tick further; the venues
// stamp funding with its SETTLEMENT time, so a naive join puts a number on bar i that was only
// knowable at i+1. funding.mjs enforces the exclusive bound and funding.test.mjs pins it.
// ========================== END PRE-REGISTRATION ==========================
//
// Usage: node carry-run.mjs [nullDraws]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { runRotation, randomSpreadNull, selectionP, perYear, anchoredDrawdown } from "./xsmom.mjs";
import { parseFundingCsv, screenFunding, fundingGrid, trailingFunding, legFundingReturns } from "./funding.mjs";
import { bookStats } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const QUIET = process.env.CARRY_QUIET === "1";        // used by the false-positive harness
const LOOKBACKS = [7, 30, 90];
const REBALANCE = 21, TOPK = 3, SLIP = 0.008, BORROW = 0.05, Q = 0.05;
// funding-binance added 2026-09-06 when data.binance.vision yielded 2020-01 onward. This adds a
// DATA SOURCE to the registered procedure; it changes no hypothesis, direction, parameter, family
// size or threshold. The registration named Kraken and OKX because those were the only reachable
// venues when it was written.
const VENUES = ["funding-kraken", "funding-okx", "funding-binance"];
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;

// ---- price universe, screened before anything is ranked
const series = {};
for (const p of availablePairs(1440, "./candle-bundle")) {
  const c = loadBundleCandles(p, 1440, "./candle-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
for (const k of Object.keys(series)) if (!(k in screenUniverse({ ...series }).kept)) delete series[k];
const symbols = Object.keys(series);
// The same calendar runRotation builds internally, so the index passed to a selector lines up.
const times = [...new Set(symbols.flatMap(s => series[s].map(c => Number(c.time))))].sort((a, b) => a - b);

const available = VENUES.filter(v => existsSync(v) && readdirSync(v).some(f => f.endsWith(".csv")));
if (!available.length) {
  console.log("No funding data present. Expected funding-kraken/ and/or funding-okx/ holding");
  console.log("<SYMBOL>USD.csv with columns symbol,fundingTime,fundingRate.");
  console.log("\nThis file is the pre-registered analysis, written before the data existed and");
  console.log("verified against synthetic series. It runs once, unchanged, when the data arrives.");
  process.exit(0);
}

const rows = [];
for (const venue of available) {
  const raw = {};
  for (const f of readdirSync(venue).filter(f => f.endsWith(".csv"))) {
    const sym = f.replace(/\.csv$/, "");
    if (sym in series) raw[sym] = parseFundingCsv(readFileSync(`${venue}/${f}`, "utf8"));
  }
  const { kept, rejected } = screenFunding(raw, times);
  if (!QUIET) {
    console.log(`\n=== ${venue}: ${Object.keys(kept).length} of ${symbols.length} symbols usable ===`);
    for (const [s, why] of rejected) console.log(`  screened out ${s}: ${why}`);
  }
  if (Object.keys(kept).length < 2 * TOPK) {
    console.log(`  fewer than ${2 * TOPK} usable symbols; cannot form a ${TOPK}-a-side book here.`);
    continue;
  }
  const grid = fundingGrid(kept, times);
  // One null serves every lookback. lookbackBars is max(L, 252) for all three, so the three cells
  // share identical opts and therefore an identical null -- recomputing it per lookback was six
  // times the work for the same numbers, and made the false-positive validation below unaffordable.
  const nullCache = new Map();

  // Ranked on trailing funding through bar i-1. A symbol whose window is not fully covered is not
  // ranked at all -- trailingFunding returns null rather than averaging a short window.
  const rank = (eligible, i, L, ascending) => {
    const scored = [];
    for (const s of eligible) {
      if (!(s in grid)) continue;
      const v = trailingFunding(grid[s], i, L);
      if (v !== null && Number.isFinite(v)) scored.push([s, v]);
    }
    scored.sort((a, b) => (ascending ? a[1] - b[1] : b[1] - a[1]));
    return scored.slice(0, TOPK).map(([s]) => s);
  };

  for (const L of LOOKBACKS) {
    // 252 bars of warmup regardless of L, so all three lookbacks start on the same date and are
    // directly comparable. It costs L=7 some periods it could otherwise have had; comparability
    // across the family is worth more than those periods, and it matches the momentum book.
    const opts = { lookbackBars: Math.max(L, 252), skipBars: 0, rebalanceBars: REBALANCE, topK: TOPK, slipPct: SLIP };
    // LOW funding is the long leg and HIGH funding the short leg, for all three hypotheses. H1 and
    // H2 hold identical positions; only what is counted differs.
    const lo = runRotation({ ...opts, series, select: (e, i) => rank(e, i, L, true) });
    const hi = runRotation({ ...opts, series, select: (e, i) => rank(e, i, L, false) });
    const n = Math.min(lo.periodReturns.length, hi.periodReturns.length);
    if (n < 6) { console.log(`  L=${L}: only ${n} periods, insufficient`); continue; }
    const ppy = perYear(lo.rebalanceLog) ?? 12;

    // Funding collected: the long leg PAYS when funding is positive, the short leg RECEIVES.
    const fLo = legFundingReturns(lo.rebalanceLog, grid, times, { side: +1 });
    const fHi = legFundingReturns(hi.rebalanceLog, grid, times, { side: -1 });

    const price = [], carry = [], longOnly = [];
    for (let i = 0; i < n; i++) {
      const spreadPrice = 0.5 * lo.periodReturns[i] - 0.5 * hi.periodReturns[i]
                        + (hi.periodCosts[i] ?? 0) - 0.5 * BORROW / ppy;
      price.push(spreadPrice);
      carry.push(spreadPrice + 0.5 * (fLo[i] ?? 0) + 0.5 * (fHi[i] ?? 0));
      longOnly.push(lo.periodReturns[i]);
    }

    // Drawdown is a per-bar walk anchored to the costed period path. Marking at period ends alone
    // has understated a drawdown by 44% in this project before, four separate times. anchoredDrawdown
    // takes (periodReturns, barReturns, times, rebalanceLog) -- the per-BAR series, not the books.
    const perBarBorrow = 0.5 * BORROW / (perYear(lo.times) ?? 365);
    const spreadBars = lo.times.map((_, k) => 0.5 * lo.barReturns[k] - 0.5 * hi.barReturns[k] - perBarBorrow);
    const dd = (periodRets, barRets) => anchoredDrawdown(periodRets, barRets, lo.times, lo.rebalanceLog);
    const nk = JSON.stringify(opts);
    if (!nullCache.has(nk)) nullCache.set(nk, randomSpreadNull(series, opts, { draws: DRAWS, borrow: BORROW }));
    const nul = nullCache.get(nk);
    const bal = xs => xs.reduce((b, r) => b * Math.exp(r), 1000);
    for (const [h, label, rets, barRets] of [
      // H1 shares H2's per-bar price path; the funding it adds settles on the period clock, so the
      // intra-period mark is the price path. Stated rather than silently reused.
      ["H1", "carry (price+funding)", carry, spreadBars],
      ["H2", "spot long-short", price, spreadBars],
      ["H3", "spot long-only", longOnly, lo.barReturns],
    ]) {
      const st = bookStats(rets, { periodsPerYear: ppy });
      rows.push({ venue, L, h, label, final: bal(rets), cagr: st.cagrPct, sharpe: st.sharpe,
                  dd: dd(rets, barRets), periods: n, p: selectionP(nul, bal(rets)) });
    }
  }
}

if (!rows.length) { console.log("\nNo cell produced enough periods to score."); process.exit(0); }

console.log(`\n${"=".repeat(96)}\nFamily of ${rows.length / available.length} per venue, scored per venue; ` +
  `q=${Q}. p floor at ${DRAWS} draws is ${(1 / (DRAWS + 1)).toFixed(4)}.`);
console.log("venue".padEnd(16) + "L".padStart(4) + "  hyp  " + "book".padEnd(24) +
  "final$".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "p".padStart(10));
for (const r of rows) {
  const atFloor = r.p <= 1 / (DRAWS + 1);
  console.log(r.venue.padEnd(16) + String(r.L).padStart(4) + "  " + r.h + "   " + r.label.padEnd(24) +
    ("$" + r.final.toFixed(0)).padStart(10) + r.cagr.toFixed(1).padStart(7) + "%" +
    r.dd.toFixed(1).padStart(8) + "%" + (r.sharpe ?? NaN).toFixed(2).padStart(8) +
    (atFloor ? `<${(1 / (DRAWS + 1)).toFixed(4)}` : r.p.toFixed(4)).padStart(10));
}

// BH runs PER VENUE, family of 9, as pre-registered. Pooling both venues into one family of 18
// was a bug: it contradicted the registered design, and because the two venues are independent
// measurements it also inflated the threshold. On a validation run where one venue carried a
// planted signal and the other was pure noise, the pooled procedure passed two NOISE cells --
// nine strong true positives dragged the BH threshold up until marginal noise cleared it. Per
// venue, every noise cell is correctly rejected.
const survivors = [];
for (const venue of available) {
  const fam = rows.filter(r => r.venue === venue).sort((a, b) => a.p - b.p);
  const m = fam.length;
  if (!m) continue;
  let cut = 0;
  for (let i = 0; i < m; i++) if (fam[i].p <= ((i + 1) / m) * Q) cut = i + 1;
  console.log(`\n=== Benjamini-Hochberg, ${venue}, family of ${m}, q=${Q} ===`);
  for (let i = 0; i < m; i++) {
    console.log(`${i + 1}`.padEnd(4) + `L=${fam[i].L} ${fam[i].h} ${fam[i].label}`.padEnd(36) +
      fam[i].p.toFixed(4).padStart(9) + `  thr ${(((i + 1) / m) * Q).toFixed(4)}` + (i < cut ? "   YES" : "   no"));
  }
  if (cut === 0) console.log(`  nothing clears BH on ${venue}.`);
  survivors.push(...fam.slice(0, cut));
}

// A cell counts only if BOTH venues find it at the SAME lookback and hypothesis. One venue alone
// is a single measurement of a quantity two venues can measure, and the pre-registration says so.
const key = r => `${r.L}|${r.h}`;
const perVenue = new Map();
for (const r of survivors) perVenue.set(key(r), (perVenue.get(key(r)) ?? new Set()).add(r.venue));
const confirmed = [...perVenue.entries()].filter(([, v]) => v.size === available.length).map(([k]) => k);
console.log(`\n=== cross-venue confirmation (${available.length} venue${available.length > 1 ? "s" : ""}) ===`);
if (available.length < 2) {
  console.log("Only one venue present, so nothing can be confirmed. A single-venue result is one");
  console.log("measurement, and the pre-registration does not accept it as a finding.");
} else if (!confirmed.length) {
  console.log("No cell survives BH on BOTH venues. Under the pre-registered kill condition this is");
  console.log("a negative result: funding-as-signal is CLOSED.");
} else {
  for (const c of confirmed) {
    const [L, h] = c.split("|");
    console.log(`  L=${L} ${h} survives on every venue` + (h === "H1" ? "  (needs perpetuals -- same venue wall as momentum)" : "  TRADEABLE IN SPOT"));
  }
  const spot = confirmed.filter(c => !c.endsWith("H1"));
  if (!spot.length) console.log("\nOnly H1 confirms, which needs perpetuals. Nothing here is tradeable by this account.");
}

console.log("\nH1 and H2 hold IDENTICAL positions and differ only in whether funding is counted, so");
console.log(`these are not ${rows.length / available.length} independent tests per venue. Independent groups are closer to ${LOOKBACKS.length}, one`);
console.log("per lookback. Both counts are on the page deliberately.");
