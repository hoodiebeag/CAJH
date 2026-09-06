// DERIVATIVES POSITIONING: pre-registered analysis, written before the data existed.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-06, after a probe confirmed Binance publishes daily `metrics` archives back to at
// least 2021-06 but BEFORE a single one was downloaded. Nothing below was chosen by looking at a
// result. This is the same discipline that made carry-run.mjs's null unarguable and caught three
// defects in it before it ever saw real numbers.
//
// WHY POSITIONING. The campaign was told, correctly, that it had only ever tested transforms of
// price. Funding answered that: it is genuinely non-price, ranking the universe at 0.017-0.089 rank
// correlation with trailing return, and it does not predict the cross-section. Positioning is the
// same class of information from the same venue -- who is on which side, and how that is changing --
// and it is the other example the critique named.
//
// THE THREE SIGNALS, with directions fixed in advance:
//
//   OI    open interest GROWTH, log change over L bars. Rising open interest means new money
//         committing. Registered direction: CROWDING -- high OI growth predicts LOWER subsequent
//         return. Long the lowest, short the highest.
//
//   TTLS  top-trader long/short ratio, mean over L bars. Binance labels the largest accounts by
//         margin balance; the conventional reading is that they are informed. Registered direction
//         is therefore the OPPOSITE of crowding -- high ratio predicts HIGHER return. Long the
//         highest, short the lowest. Registering opposite directions for two signals is deliberate:
//         it means the family cannot be satisfied by a single market-wide effect wearing two names.
//
//   TAKER taker buy/sell volume ratio, mean over L bars. Aggressive buying lifting the offer.
//         Registered direction: CROWDING -- high taker buy ratio predicts LOWER return.
//
// EXPRESSIONS. Each signal is run long-short in spot and long-only in spot. Long-only is the only
// form this account can hold, and it is counted in the family rather than reported as a footnote --
// counting it only when it wins is how a family size gets quietly understated.
//
// FAMILY SIZE 18: 3 signals x 3 lookbacks {7, 30, 90} x 2 expressions. Benjamini-Hochberg at
// q = 0.05, per venue. That is a large family for ~51 periods and power will be poor; the answer to
// poor power is to say so, not to shrink the family after seeing which cells look good.
// H(long-short) and H(long-only) share a long leg and are NOT independent; independent groups are
// closer to 9 than 18. Both counts are printed.
//
// PARAMETERS, fixed now and not to be swept: lookbacks {7, 30, 90} bars, rebalance 21, topK 3 a
// side, slippage 0.80%, borrow 5%/yr, 252-bar warmup so every lookback starts on the same date.
// Identical to carry-run.mjs and to the canonical momentum book, so nothing here is a fresh choice.
//
// KILL CONDITIONS, stated before the data arrives:
//   - If no cell clears BH, positioning-as-signal is CLOSED and this file says so.
//   - A cell surviving at one lookback only is noise.
//   - IF A SIGNAL RANKS THE UNIVERSE LIKE PRICE, IT IS NOT A NEW INFORMATION SOURCE. Rank
//     correlation against trailing return is reported for every signal and lookback. Above 0.5 in
//     absolute value, the cell is reported as a price transform whatever its p-value, because the
//     whole purpose of this study is to test something that is not price.
//
// NO-LOOKAHEAD. Open interest is a LEVEL and is bucketed with bucketLast, never summed -- summing
// 288 five-minute snapshots would report a level 288x too large while ranking almost identically.
// Ranking at bar i uses data through i-1 and not a tick further; funding.test.mjs pins both bounds.
// ========================== END PRE-REGISTRATION ==========================
//
// Usage: node positioning-run.mjs [nullDraws]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { runRotation, randomSpreadNull, selectionP, perYear, anchoredDrawdown } from "./xsmom.mjs";
import { bucketLast, trailingChange, trailingLevel } from "./funding.mjs";
import { bookStats } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const LOOKBACKS = [7, 30, 90];
const REBALANCE = 21, TOPK = 3, SLIP = 0.008, BORROW = 0.05, Q = 0.05;
const DIR = "positioning";
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;

// column name -> [statistic, ascending?] ; ascending true means "long the LOWEST"
const SIGNALS = {
  OI:    { col: "sum_open_interest",                stat: "change", longLowest: true  },
  TTLS:  { col: "sum_toptrader_long_short_ratio",   stat: "level",  longLowest: false },
  TAKER: { col: "sum_taker_long_short_vol_ratio",   stat: "level",  longLowest: true  },
};

const series = {};
for (const p of availablePairs(1440, "./candle-bundle")) {
  const c = loadBundleCandles(p, 1440, "./candle-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
for (const k of Object.keys(series)) if (!(k in screenUniverse({ ...series }).kept)) delete series[k];
const times = [...new Set(Object.values(series).flatMap(c => c.map(b => Number(b.time))))].sort((a, b) => a - b);

if (!existsSync(DIR) || !readdirSync(DIR).some(f => f.endsWith(".csv"))) {
  console.log(`No positioning data. Expected ${DIR}/<SYMBOL>USD.csv with a header naming at least`);
  console.log(`create_time and: ${Object.values(SIGNALS).map(s => s.col).join(", ")}`);
  console.log("\nThis file is the pre-registered analysis, written before the data existed. It runs");
  console.log("once, unchanged, when the data arrives.");
  process.exit(0);
}

// Parse by COLUMN NAME, never by position. Binance has changed column order between eras of these
// archives, and a positional parser would silently read the long/short ratio as open interest.
function loadMetric(file, col) {
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const head = lines[0].split(",").map(s => s.trim());
  const ti = head.indexOf("create_time"), ci = head.indexOf(col);
  if (ti < 0 || ci < 0) return null;
  const out = [];
  for (const line of lines.slice(1)) {
    const p = line.split(",");
    const t = Date.parse(p[ti]?.trim().replace(" ", "T") + "Z") / 1000;
    const v = Number(p[ci]);
    if (Number.isFinite(t) && Number.isFinite(v)) out.push({ time: Math.floor(t), rate: v });
  }
  return out.sort((a, b) => a.time - b.time);
}

const files = readdirSync(DIR).filter(f => f.endsWith(".csv"));
const grids = {};
for (const [name, spec] of Object.entries(SIGNALS)) {
  grids[name] = {};
  for (const f of files) {
    const sym = f.replace(/\.csv$/, "");
    if (!(sym in series)) continue;
    const recs = loadMetric(`${DIR}/${f}`, spec.col);
    if (!recs || recs.length < 200) continue;
    const { perBar, covered } = bucketLast(recs, times);
    // Same 80% coverage screen as the funding study, for the same reason: a series present for a
    // quarter of the window ranks at an extreme for reasons that are pure coverage.
    if (covered.filter(Boolean).length / times.length < 0.8) continue;
    grids[name][sym] = perBar;
  }
  console.log(`${name.padEnd(6)} usable on ${Object.keys(grids[name]).length} of ${Object.keys(series).length} symbols`);
}

const spearman = (a, b) => {
  const rank = xs => { const ix = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length);
    ix.forEach(([, i], k) => r[i] = k); return r; };
  const ra = rank(a), rb = rank(b), n = a.length, m = x => x.reduce((p, q) => p + q, 0) / n;
  const ma = m(ra), mb = m(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
};
const px = {};
for (const s of Object.keys(series)) {
  const m = new Map(series[s].map(b => [Number(b.time), Number(b.close)]));
  let last = null;
  px[s] = times.map(t => { const v = m.get(t); if (v !== undefined) last = v; return last; });
}

const rows = [], nullCache = new Map();
for (const [name, spec] of Object.entries(SIGNALS)) {
  const grid = grids[name];
  if (Object.keys(grid).length < 2 * TOPK) { console.log(`${name}: too few symbols, skipped`); continue; }
  const value = (s, i, L) => spec.stat === "change" ? trailingChange(grid[s], i, L) : trailingLevel(grid[s], i, L);
  for (const L of LOOKBACKS) {
    const rank = (eligible, i, wantLow) => {
      const scored = [];
      for (const s of eligible) {
        if (!(s in grid)) continue;
        const v = value(s, i, L);
        if (v !== null && Number.isFinite(v)) scored.push([s, v]);
      }
      scored.sort((a, b) => (wantLow ? a[1] - b[1] : b[1] - a[1]));
      return scored.slice(0, TOPK).map(([s]) => s);
    };
    const opts = { lookbackBars: 252, skipBars: 0, rebalanceBars: REBALANCE, topK: TOPK, slipPct: SLIP };
    const lo = runRotation({ ...opts, series, select: (e, i) => rank(e, i, spec.longLowest) });
    const hi = runRotation({ ...opts, series, select: (e, i) => rank(e, i, !spec.longLowest) });
    const n = Math.min(lo.periodReturns.length, hi.periodReturns.length);
    if (n < 6) { console.log(`${name} L=${L}: only ${n} periods`); continue; }
    const ppy = perYear(lo.rebalanceLog) ?? 12;

    // Is this signal ranking the universe the way price does? Registered as a kill condition.
    const rhos = [];
    for (let i = 252; i < times.length; i += REBALANCE) {
      const f = [], r = [];
      for (const s of Object.keys(grid)) {
        const v = value(s, i, L), p0 = px[s][i - L], p1 = px[s][i - 1];
        if (v === null || !p0 || !p1) continue;
        f.push(v); r.push(Math.log(p1 / p0));
      }
      if (f.length >= 8) rhos.push(spearman(f, r));
    }
    const rho = rhos.length ? rhos.reduce((a, b) => a + b, 0) / rhos.length : NaN;

    const perBarBorrow = 0.5 * BORROW / (perYear(lo.times) ?? 365);
    const spreadBars = lo.times.map((_, k) => 0.5 * lo.barReturns[k] - 0.5 * hi.barReturns[k] - perBarBorrow);
    const ls = [], only = [];
    for (let i = 0; i < n; i++) {
      ls.push(0.5 * lo.periodReturns[i] - 0.5 * hi.periodReturns[i] + (hi.periodCosts[i] ?? 0) - 0.5 * BORROW / ppy);
      only.push(lo.periodReturns[i]);
    }
    const nk = JSON.stringify(opts);
    if (!nullCache.has(nk)) nullCache.set(nk, randomSpreadNull(series, opts, { draws: DRAWS, borrow: BORROW }));
    const nul = nullCache.get(nk);
    const bal = xs => xs.reduce((b, r) => b * Math.exp(r), 1000);
    for (const [expr, rets, barRets] of [["long-short", ls, spreadBars], ["long-only", only, lo.barReturns]]) {
      const st = bookStats(rets, { periodsPerYear: ppy });
      rows.push({ name, L, expr, rho, final: bal(rets), cagr: st.cagrPct, sharpe: st.sharpe, periods: n,
                  dd: anchoredDrawdown(rets, barRets, lo.times, lo.rebalanceLog), p: selectionP(nul, bal(rets)) });
    }
  }
}

if (!rows.length) { console.log("\nNo cell produced enough periods to score."); process.exit(0); }
const floor = 1 / (DRAWS + 1);
console.log(`\n${"=".repeat(94)}\nFamily of ${rows.length}, BH at q=${Q}. p floor at ${DRAWS} draws is ${floor.toFixed(4)}.`);
console.log("signal".padEnd(7) + "L".padStart(4) + "  " + "expression".padEnd(12) + "rho(px)".padStart(9) +
  "final$".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "p".padStart(10));
for (const r of rows) {
  console.log(r.name.padEnd(7) + String(r.L).padStart(4) + "  " + r.expr.padEnd(12) +
    r.rho.toFixed(3).padStart(9) + ("$" + r.final.toFixed(0)).padStart(10) + r.cagr.toFixed(1).padStart(7) + "%" +
    r.dd.toFixed(1).padStart(8) + "%" + (r.sharpe ?? NaN).toFixed(2).padStart(8) +
    (r.p <= floor ? `<${floor.toFixed(4)}` : r.p.toFixed(4)).padStart(10) +
    (Math.abs(r.rho) > 0.5 ? "   PRICE TRANSFORM" : ""));
}
const fam = [...rows].sort((a, b) => a.p - b.p), m = fam.length;
let cut = 0;
for (let i = 0; i < m; i++) if (fam[i].p <= ((i + 1) / m) * Q) cut = i + 1;
console.log(`\n=== Benjamini-Hochberg, family of ${m}, q=${Q} ===`);
for (let i = 0; i < m; i++)
  console.log(`${i + 1}`.padEnd(4) + `${fam[i].name} L=${fam[i].L} ${fam[i].expr}`.padEnd(30) +
    fam[i].p.toFixed(4).padStart(9) + `  thr ${(((i + 1) / m) * Q).toFixed(4)}` + (i < cut ? "   YES" : "   no"));
const alive = fam.slice(0, cut).filter(r => Math.abs(r.rho) <= 0.5);
console.log(cut === 0
  ? "\nNothing clears BH. Under the pre-registered kill condition, positioning-as-signal is CLOSED."
  : `\n${cut} of ${m} clear BH; ${alive.length} of those also rank independently of price (|rho| <= 0.5).`);
if (cut > 0 && !alive.length)
  console.log("Every survivor ranks like price, so it is a price transform and not the new source this tested for.");
console.log(`\nLong-short and long-only share a long leg, so these are not ${m} independent tests;`);
console.log(`independent groups are closer to ${m / 2}. Both counts are on the page deliberately.`);
