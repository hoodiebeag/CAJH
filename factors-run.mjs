// The 12-signal battery at a null draw count high enough to resolve the small p-values.
// Usage: node factors-run.mjs [draws]
//
// At 200 draws the smallest p a signal can report is 1/201 = 0.0050, and five equities signals
// sat exactly there -- which says only "not resolved", not "p = 0.005". Raising the draw count
// is the only way to tell a signal at p=0.004 from one at p=0.00002.
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { randomSpreadNull } from "./xsmom.mjs";
import { SIGNALS, testSignal, benjaminiHochberg } from "./factors.mjs";

const DRAWS = Number(process.argv[2] ?? 10000);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const FROM = sec("2023-01-01"), TO = sec("2026-09-02");

function load(root) {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= FROM && +b.time <= TO);
    if (c.length >= 400) out[p] = c;
  }
  // Screened before ranking; PARA supplied two thirds of the equities result before this existed.
  return screenUniverse(out).kept;
}

const UNIVERSES = [
  { label: "sp500-128", root: "./sp500-bundle", topK: 10, slipPct: 0.0005 },
  { label: "crypto-29", root: "./candle-bundle", topK: 5, slipPct: 0.008 },
];

for (const u of UNIVERSES) {
  const series = load(u.root);
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: u.topK, slipPct: u.slipPct };
  const t0 = Date.now();
  const nul = randomSpreadNull(series, opts, { draws: DRAWS, borrow: 0.05 });
  console.log(`\n=== ${u.label}: ${Object.keys(series).length} symbols, topK ${u.topK}, ` +
    `${DRAWS} null draws in ${((Date.now() - t0) / 1000).toFixed(0)}s ===`);
  console.log(`null median $${nul.median}, p05 $${nul.p05}, p95 $${nul.p95}, floor p=${(1 / (DRAWS + 1)).toExponential(2)}`);

  const results = Object.keys(SIGNALS).map(name =>
    testSignal(name, series, { topK: u.topK, slipPct: u.slipPct, borrow: 0.05, nullResult: nul }));
  const bh = benjaminiHochberg(results, 0.05);

  console.log(`\nBH threshold ${bh.threshold} over a family of ${bh.familySize}`);
  console.log("signal".padEnd(14) + "final$".padStart(10) + "CAGR".padStart(8) + "maxDD".padStart(9) +
    "up".padStart(7) + "p".padStart(11) + "  BHcrit   survives");
  for (const r of bh.ranked) {
    console.log(r.name.padEnd(14) + ("$" + r.finalBalance).padStart(10) + r.cagrPct.toFixed(1).padStart(7) + "%" +
      r.maxDrawdownPct.toFixed(2).padStart(8) + "%" + `${r.upPeriods}/${r.periods}`.padStart(7) +
      r.p.toExponential(2).padStart(11) + "  " + r.bhCritical.toFixed(5) + "   " + (r.survives ? "yes" : "no"));
  }
  console.log(`survivors: ${bh.survivors.join(", ") || "none"}`);
}
