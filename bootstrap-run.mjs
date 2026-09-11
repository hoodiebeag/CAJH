// How wide are these intervals really, once the periods are allowed to be dependent?
//
// Every number this campaign has published -- CAGR, Sharpe, the null p-values -- treats its period
// returns as independent draws. The sub-period tables say plainly that they are not: the equities
// book made everything in one ten-month stretch and nothing in the twenty that followed, and the
// crypto book's drawdown is one continuous run rather than scattered bad months. Dependence like
// that inflates nothing in the point estimate and everything in the confidence around it.
//
// Reported at blockLen 1 (i.i.d., the assumption in force until now) and at n^(1/3) blocks, on the
// same data and the same seed, so the difference is attributable to the assumption alone.
//
// Both block schemes are shown because the first run of this disagreed with the prediction that
// motivated it -- the bands got NARROWER, not wider -- and two different mechanisms produce that.
// Moving blocks under-weight the ends of the series, and equities' fourth largest move is period 0.
// Circular blocks weight every period equally. The lag-1 autocorrelation is printed alongside so
// the reader can see whether a narrowing is the data mean-reverting or the scheme starving an
// endpoint. If it survives the circular version, it is the data.
// Usage: node bootstrap-run.mjs [draws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";
import { bootstrapBook, suggestedBlockLen } from "./bootstrap.mjs";

const DRAWS = Number(process.argv[2] ?? 20000);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const FROM = sec("2023-01-01"), TO = sec("2026-09-02");

function load(root) {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= FROM && +b.time <= TO);
    if (c.length >= 400) out[p] = c;
  }
  return screenUniverse(out).kept;
}

const CANONICAL = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21 };
const books = [
  ["crypto momentum", spread(load("./candle-bundle"), { ...CANONICAL, topK: 3, slipPct: 0.008 }, { borrow: 0.05 })],
  ["equities momentum", spread(load("./sp500-bundle"), { ...CANONICAL, topK: 12, slipPct: 0.0005 }, { borrow: 0.05 })],
];

const pct = v => `${(100 * v).toFixed(1)}%`;
const acf = (x, k) => {
  const n = x.length, m = x.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) den += (x[i] - m) ** 2;
  for (let i = 0; i < n - k; i++) num += (x[i] - m) * (x[i + k] - m);
  return num / den;
};
console.log(`${DRAWS} draws per book.\n`);

for (const [label, sp] of books) {
  const n = sp.returns.length, L = suggestedBlockLen(n);
  const ppy = sp.periodsPerYear;
  console.log(`=== ${label}: ${n} periods at ${ppy.toFixed(2)}/yr, point estimate ` +
    `$${sp.finalBalance.toFixed(2)} ===`);
  // Standard error of an autocorrelation estimate on n points is about 1/sqrt(n), which on 31 or 50
  // periods is 0.18 or 0.14. Quoting it next to the estimate keeps a lag-1 of -0.14 from being read
  // as evidence of anything.
  console.log("  lag-1 autocorrelation " + acf(sp.returns, 1).toFixed(3) +
    ` (se about ${(1 / Math.sqrt(n)).toFixed(2)}), lag-2 ` + acf(sp.returns, 2).toFixed(3));
  console.log("  " + "assumption".padEnd(22) + "CAGR p05".padStart(10) + "median".padStart(10) +
    "p95".padStart(10) + "  |" + "Sharpe p05".padStart(12) + "median".padStart(9) + "p95".padStart(9) +
    "  |  P(lose)");
  const run = (blockLen, circular) =>
    bootstrapBook(sp.returns, { periodsPerYear: ppy, blockLen, circular, draws: DRAWS, seed: 20260905 });
  for (const [name, blockLen, circular] of [
    ["i.i.d. periods", 1, false],
    [`moving blocks of ${L}`, L, false],
    [`circular blocks of ${L}`, L, true],
  ]) {
    const b = run(blockLen, circular);
    console.log("  " + name.padEnd(22) + pct(b.cagr.p05).padStart(10) + pct(b.cagr.median).padStart(10) +
      pct(b.cagr.p95).padStart(10) + "  |" + b.sharpe.p05.toFixed(2).padStart(12) +
      b.sharpe.median.toFixed(2).padStart(9) + b.sharpe.p95.toFixed(2).padStart(9) +
      "  |" + pct(b.cagr.pNegative).padStart(10));
  }
  // The comparison that matters: what the independence assumption was buying, and how much of that
  // answer is the endpoint artefact rather than the dependence.
  const w = (bl, c) => { const b = run(bl, c); return b.cagr.p95 - b.cagr.p05; };
  const base = w(1, false);
  console.log(`  5-95 CAGR band vs i.i.d.: moving ${(w(L, false) / base).toFixed(2)}x, ` +
    `circular ${(w(L, true) / base).toFixed(2)}x  ` +
    `(the gap between those two is the endpoint weighting, not the data)\n`);
}

console.log("A band that moves either way is not a better or worse strategy. It is the same strategy,");
console.log("measured without an assumption it was never entitled to.");
