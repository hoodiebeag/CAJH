// Canonical momentum against the event that historically kills it.
//
// FINDINGS.md has said since the beginning: "Momentum's documented way of dying is not decay -- it
// is a violent reversal after a market bottom, when the beaten-down names in the short leg rebound
// hardest. The sample here contains no crash-and-rebound. The strategy has never been tested
// against the event that historically breaks it."
//
// This is that test. Same hypothesis, same canonical parameters -- 252/21/21, topK 3, 0.80% slip,
// 5% borrow -- on daily bars reaching back to 2017 instead of 2023. Nothing is swept and nothing is
// chosen; the only thing that changed is how much history the same book sees.
//
// The universe is screened twice. screenUniverse catches corrupted series as always. Before that,
// five symbols were excluded on data-integrity grounds: ALGO, ETC, TAO and ZEC because the incoming
// Binance USDT bars disagree with the trusted Kraken USD bars on daily RETURNS (correlation below
// 0.99, TAO as low as 0.922 with a 45% maximum discrepancy), and XMR because Binance delisted it in
// 2024-02 while the Kraken bundle starts 2025-01, so the two sources never overlap and cannot be
// reconciled. Those are exclusions for disagreement about what the price WAS, not for what the
// result becomes.
//
// The first row is a CONTROL: the same book over the 2023-01 window the campaign already measured.
// If the extended bundle does not reproduce the known result there, the plumbing is wrong and
// nothing below it can be believed.
// Usage: node longhistory-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { bookStats } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 1000);
const CANON = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 3, slipPct: 0.008 };
const BORROW = 0.05;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

function load(root, from, to) {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec(from) && +b.time <= sec(to));
    if (c.length >= 300) out[p] = c;
  }
  const { kept, rejected } = screenUniverse(out);
  for (const [s, why] of rejected) console.log(`  screened out ${s}: ${why}`);
  return kept;
}

// An equal-weight basket over the same names and window, so a spread result is read against what
// simply holding the universe would have done rather than against zero.
function basket(series) {
  const times = [...new Set(Object.values(series).flatMap(c => c.map(b => Number(b.time))))].sort((a, b) => a - b);
  let bal = 1000, prev = null;
  for (const t of times) {
    const rets = [];
    for (const c of Object.values(series)) {
      const i = c.findIndex(b => Number(b.time) === t);
      if (i > 0) rets.push(Math.log(Number(c[i].close) / Number(c[i - 1].close)));
    }
    if (rets.length && prev !== null) bal *= Math.exp(rets.reduce((a, b) => a + b, 0) / rets.length);
    prev = t;
  }
  return bal;
}

const WINDOWS = [
  ["CONTROL 2023-01..2026-09", "2023-01-01", "2026-09-02", "must reproduce the known $2623"],
  ["full 2017-08..2026-09",    "2017-08-01", "2026-09-02", "everything the data covers"],
  ["2018 collapse",            "2017-08-01", "2019-06-30", "BTC -84% peak to trough"],
  ["2021 top + 2022 unwind",   "2020-01-01", "2023-01-01", "the crash-and-rebound the sample lacked"],
  ["pre-2023 only",            "2017-08-01", "2023-01-01", "strictly out of sample vs the original study"],
];

console.log("window".padEnd(28) + "syms".padStart(5) + "per".padStart(5) + "final$".padStart(10) +
  "CAGR".padStart(8) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "basket$".padStart(10) + "p".padStart(9));
for (const [label, from, to, note] of WINDOWS) {
  const series = load("./candle-bundle-long", from, to);
  const n = Object.keys(series).length;
  if (n < 2 * CANON.topK) { console.log(label.padEnd(28) + `  only ${n} symbols, cannot form a book`); continue; }
  const sp = spread(series, CANON, { borrow: BORROW });
  if (sp.periods < 6) { console.log(label.padEnd(28) + `  only ${sp.periods} periods`); continue; }
  const st = bookStats(sp.returns, { periodsPerYear: sp.periodsPerYear });
  const p = selectionP(randomSpreadNull(series, CANON, { draws: DRAWS, borrow: BORROW }), sp.finalBalance);
  const floor = 1 / (DRAWS + 1);
  console.log(label.padEnd(28) + String(n).padStart(5) + String(sp.periods).padStart(5) +
    ("$" + sp.finalBalance.toFixed(0)).padStart(10) + st.cagrPct.toFixed(1).padStart(7) + "%" +
    sp.maxDrawdownPct.toFixed(1).padStart(8) + "%" + (st.sharpe ?? NaN).toFixed(2).padStart(8) +
    ("$" + basket(series).toFixed(0)).padStart(10) +
    (p <= floor ? `<${floor.toFixed(4)}` : p.toFixed(4)).padStart(9) + "   " + note);
}
console.log(`\nnull draws ${DRAWS}, family size 5 windows (they overlap heavily and are NOT independent).`);
console.log("The CONTROL row is the check that matters first: if it does not match the campaign's");
console.log("published $2623 / 39.9% / 22.7%, the extended data is wrong and the rest is noise.");
