// Decay or regime?
//
// The selection walk-forward found equities momentum at Sharpe 0.57 out of sample against 1.19 in
// sample, while crypto momentum went the other way. Two explanations fit that: the factor is
// decaying in equities, or 2025-2026 was simply a bad stretch for it. They are distinguishable by
// shape. Decay is monotone. A regime is one bad slice among others that are fine.
//
// Each surviving factor is run once over the whole window and its period returns are then CUT into
// contiguous slices. Cutting the returns rather than re-running on truncated data keeps the
// formation window intact for every period, so an early slice is not penalised for a shorter
// lookback than a late one.
// Usage: node subperiod-run.mjs [slices]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { anchoredDrawdown } from "./xsmom.mjs";
import { testSignal } from "./factors.mjs";

const SLICES = Number(process.argv[2] ?? 3);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  // Screened before ranking: a corrupted series is the strongest possible loser and gets shorted
  // every period. PARA supplied two thirds of the equities result before this existed.
  return screenUniverse(o).kept;
};
const sharpe = (rets, ppy) => {
  if (rets.length < 3) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(ppy) : null;
};

// The signals that survived at least one screen, so this is not a fresh fishing expedition.
const SURVIVORS = ["momentum", "nearHigh", "trendQuality", "idioVol", "lowVol", "beta"];

for (const [label, root, topK, slip] of [
  ["sp500", "./sp500-bundle", 12, 0.0005],
  ["crypto", "./candle-bundle", 3, 0.008],
]) {
  const series = load(root);
  console.log(`\n=== ${label}: ${Object.keys(series).length} symbols, cut into ${SLICES} contiguous slices ===`);
  let header = null;
  for (const name of SURVIVORS) {
    const r = testSignal(name, series, { topK, slipPct: slip, borrow: 0.05, draws: 1 });
    if (r.insufficient) { console.log(`${name}: too few periods`); continue; }
    const n = r.returns.length, per = Math.floor(n / SLICES);
    if (!header) {
      const bounds = [];
      for (let s = 0; s < SLICES; s++) {
        const lo = s * per, hi = s === SLICES - 1 ? n : (s + 1) * per;
        bounds.push(`${iso(r.top.rebalanceLog[lo].at)}..${iso(r.top.rebalanceLog[hi].at)} (${hi - lo}p)`);
      }
      console.log("  slices: " + bounds.join("  |  "));
      header = "signal".padEnd(14) + Array.from({ length: SLICES }, (_, s) => `slice ${s + 1}`.padStart(18)).join("") + "     full";
      console.log(header);
    }
    let line = name.padEnd(14);
    for (let s = 0; s < SLICES; s++) {
      const lo = s * per, hi = s === SLICES - 1 ? n : (s + 1) * per;
      const cut = r.returns.slice(lo, hi);
      let bal = 1000;
      for (const x of cut) bal *= Math.exp(x);
      const yrs = cut.length / r.periodsPerYear;
      const cagr = ((bal / 1000) ** (1 / yrs) - 1) * 100;
      line += `${cagr.toFixed(0)}% / ${(sharpe(cut, r.periodsPerYear) ?? NaN).toFixed(2)}`.padStart(18);
    }
    line += `${r.cagrPct.toFixed(0)}%`.padStart(9);
    console.log(line);
  }
}
console.log("\nEach cell is CAGR over that slice / Sharpe over that slice. Both are annualised from");
console.log("roughly ten periods, so neither is measured; the SHAPE across slices is the question.");
