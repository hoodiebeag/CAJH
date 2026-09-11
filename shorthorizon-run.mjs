// Does momentum exist at SHORT formation horizons in crypto?
//
// The campaign has tested short-horizon REVERSAL and long-horizon MOMENTUM. It has never tested
// short-horizon momentum -- 4, 8 or 15 bars of formation rather than 252 -- which is a different
// claim from either and is the construction a third-party product we were shown appears to use.
// The data is already here, so the only reason it was never run is that nobody ran it.
//
// PRE-REGISTERED BEFORE ANY RESULT WAS SEEN, and the grid below is the whole family:
//   lookback in {4, 8, 15, 30, 60} x skip in {0, 1}, rebalance = lookback, topK 3, slip 0.8%.
// Ten cells. Every p-value is reported against a family of ten under Benjamini-Hochberg at q=0.05,
// and a cell that survives on its own p but not under BH has not survived. The canonical
// 252/21/21 row is printed for reference and is NOT in the family -- it is the pre-registered
// hypothesis, not a new one, and folding it in would let the old result subsidise the new search.
//
// Gross (zero-cost) is reported beside net because at a 4-bar rebalance the book turns over ~91
// times a year and 0.8% of slippage is not a rounding error. "No signal" and "signal eaten by
// cost" are different findings: the first closes the question, the second makes it a venue question.
// Usage: node shorthorizon-run.mjs [draws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { bookStats } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 1000);
const SLIP = 0.008, BORROW = 0.05, TOPK = 3, Q = 0.05;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;

const series = {};
for (const p of availablePairs(1440, "./candle-bundle")) {
  const c = loadBundleCandles(p, 1440, "./candle-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
{
  const { kept, rejected } = screenUniverse({ ...series });
  for (const k of Object.keys(series)) if (!(k in kept)) delete series[k];
  for (const [s, why] of rejected) console.log(`screened out ${s}: ${why}`);
}
console.log(`crypto universe ${Object.keys(series).length} symbols, topK ${TOPK} a side, ` +
  `slip ${(100 * SLIP).toFixed(1)}%, ${DRAWS} null draws per cell\n`);

const FAMILY = [];
for (const lookbackBars of [4, 8, 15, 30, 60]) for (const skipBars of [0, 1]) FAMILY.push({ lookbackBars, skipBars });

const head = "lookback".padEnd(10) + "skip".padStart(5) + "rebal".padStart(7) + "periods".padStart(9) +
  "net $".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) + "Sharpe".padStart(8) +
  "gross $".padStart(10) + "p".padStart(9) + "null med$".padStart(11);
console.log(head);

const rows = [];
const evaluate = (opts, inFamily) => {
  const t0 = Date.now();
  const net = spread(series, { ...opts, topK: TOPK, slipPct: SLIP }, { borrow: BORROW });
  const gross = spread(series, { ...opts, topK: TOPK, slipPct: 0 }, { borrow: 0 });
  const st = bookStats(net.returns, { periodsPerYear: net.periodsPerYear });
  const nul = randomSpreadNull(series, { ...opts, topK: TOPK, slipPct: SLIP }, { draws: DRAWS, borrow: BORROW });
  const p = selectionP(nul, net.finalBalance);
  // The null's own median, because a p-value alone is unreadable here. Random selection at a 4-bar
  // rebalance is destroyed by turnover too, so beating it says the RANKING carries information --
  // not that the book makes money. Both facts have to be on the page or the p invites the wrong read.
  const nullMedian = [...nul.finals].sort((a, b) => a - b)[Math.floor(nul.finals.length / 2)];
  const row = { ...opts, inFamily, periods: net.periods, net: net.finalBalance, gross: gross.finalBalance,
                cagr: st.cagrPct, dd: net.maxDrawdownPct, sharpe: st.sharpe, p, nullMedian,
                secs: (Date.now() - t0) / 1000 };
  console.log(String(opts.lookbackBars).padEnd(10) + String(opts.skipBars).padStart(5) +
    String(opts.rebalanceBars).padStart(7) + String(row.periods).padStart(9) +
    ("$" + row.net.toFixed(0)).padStart(10) + row.cagr.toFixed(1).padStart(7) + "%" +
    row.dd.toFixed(1).padStart(8) + "%" + (row.sharpe ?? NaN).toFixed(2).padStart(8) +
    ("$" + row.gross.toFixed(0)).padStart(10) + p.toFixed(4).padStart(9) +
    ("$" + nullMedian.toFixed(0)).padStart(11) +
    (inFamily ? "" : "   <- reference, not in the family"));
  return row;
};

for (const f of FAMILY) rows.push(evaluate({ ...f, rebalanceBars: f.lookbackBars }, true));
const canonical = evaluate({ lookbackBars: 252, skipBars: 21, rebalanceBars: 21 }, false);

// --- Benjamini-Hochberg over the ten pre-registered cells, and nothing else.
const fam = rows.filter(r => r.inFamily).sort((a, b) => a.p - b.p);
const m = fam.length;
let cut = 0;
for (let i = 0; i < m; i++) if (fam[i].p <= ((i + 1) / m) * Q) cut = i + 1;
console.log(`\n=== Benjamini-Hochberg, family of ${m}, q=${Q} ===`);
console.log("rank".padEnd(6) + "cell".padEnd(16) + "p".padStart(9) + "BH threshold".padStart(14) + "  survives");
for (let i = 0; i < m; i++) {
  const r = fam[i], thr = ((i + 1) / m) * Q;
  console.log(String(i + 1).padEnd(6) + `${r.lookbackBars}/${r.skipBars}/${r.rebalanceBars}`.padEnd(16) +
    r.p.toFixed(4).padStart(9) + thr.toFixed(4).padStart(14) + (i < cut ? "   YES" : "   no"));
}
console.log("\nA p at the floor beside a net of $29 means random selection lost even harder at the same");
console.log("turnover. It is evidence the ranking carries information, and no evidence at all that the");
console.log("book is tradeable. Those are separate questions and the cost table below is the second one.");
console.log(cut === 0
  ? `\nNothing survives. The p floor at ${DRAWS} draws is ${(1 / (DRAWS + 1)).toFixed(4)}, so a cell reporting it is at the floor, not measured there.`
  : `\n${cut} of ${m} cells survive BH.`);

// Cost is the other axis: a cell whose gross is strong and whose net is not is a venue question.
console.log("\n=== what cost is doing ===");
for (const r of [...rows].sort((a, b) => a.lookbackBars - b.lookbackBars || a.skipBars - b.skipBars)) {
  const drag = r.gross > 0 ? (1 - r.net / r.gross) : NaN;
  console.log(`${r.lookbackBars}/${r.skipBars}`.padEnd(10) + `gross $${r.gross.toFixed(0)}`.padStart(14) +
    `net $${r.net.toFixed(0)}`.padStart(13) + `cost eats ${(100 * drag).toFixed(0)}%`.padStart(20) +
    (r.gross < 1000 ? "   no signal to eat" : ""));
}
console.log(`\nreference 252/21/21: net $${canonical.net.toFixed(0)}, gross $${canonical.gross.toFixed(0)}, p ${canonical.p.toFixed(4)}`);

// --- At what execution cost does each horizon turn positive?
//
// The 0.8% slippage used above was calibrated for a 21-bar rebalance and is deliberately punitive.
// At a 4-bar rebalance the same figure is charged 91 times a year instead of 17, so it is no longer
// the same assumption -- it is a far harsher one wearing the same number. This asks the question the
// gross/net gap raises: if the ranking carries information at short horizons, what does execution
// have to cost for that information to survive to the account?
//
// This is a SWEEP and it is exploratory. No p-values are attached to it and no cell from it is a
// finding. It sizes a requirement; establishing that any cell meets it would be a separate,
// pre-registered test on data this grid has already seen.
console.log("\n=== break-even execution cost (exploratory; no cell here is a finding) ===");
console.log("Net final balance from $1000. Borrow held at 5%/yr throughout.\n");
const SLIPS = [0, 0.0005, 0.001, 0.002, 0.004, 0.008];
console.log("cell".padEnd(12) + "rebal/yr".padStart(10) + SLIPS.map(v => `${(100 * v).toFixed(2)}%`.padStart(10)).join(""));
for (const lookbackBars of [4, 8, 15, 30, 60, 252]) {
  const skipBars = lookbackBars === 252 ? 21 : 1;
  const rebalanceBars = lookbackBars === 252 ? 21 : lookbackBars;
  const cells = SLIPS.map(slipPct => spread(series, { lookbackBars, skipBars, rebalanceBars, topK: TOPK, slipPct }, { borrow: BORROW }));
  console.log(`${lookbackBars}/${skipBars}/${rebalanceBars}`.padEnd(12) +
    cells[0].periodsPerYear.toFixed(1).padStart(10) +
    cells.map(c => ("$" + c.finalBalance.toFixed(0)).padStart(10)).join(""));
}
console.log("\nRead down a column, not across a row: a column is one cost assumption applied to every");
console.log("horizon, which is the comparison. Reading across a row picks the cost that flatters it.");
