// Is the published result's data-source sensitivity caused by CONCENTRATION?
//
// Kraken and Binance agree on daily returns to within 0.1% (correlation 0.997-0.9999 on every name
// used here) and still produce final balances 36% apart on identical names and dates. The proposed
// explanation is topK: at 3 names a side out of 24, one flipped rank is a third of a leg.
//
// That is an assertion until it is measured. Earlier in this campaign I explained a result by
// dispersion, measured it, and found dispersion was almost identical -- the explanation was wrong
// and correlation was doing the work. So this widens topK and asks whether agreement improves. If
// it does, concentration is the mechanism. If it does not, something else is wrong with one of the
// two datasets and neither can be trusted.
// Usage: node concentration-source-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread } from "./xsmom.mjs";
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const shared = new Set(availablePairs(1440, "./candle-bundle-long"));
const load = root => {
  const out = {};
  for (const p of availablePairs(1440, root)) {
    if (!shared.has(p)) continue;
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 300) out[p] = c;
  }
  return screenUniverse(out).kept;
};
const K = load("./candle-bundle"), B = load("./candle-bundle-long");
// Rank only names BOTH sources carry, so a universe difference cannot masquerade as a data one.
const both = Object.keys(K).filter(s => s in B);
const sub = (o) => Object.fromEntries(both.map(k => [k, o[k]]));
console.log(`${both.length} names carried by both sources, 2023-01..2026-09\n`);
console.log("topK".padEnd(6) + "kraken $".padStart(10) + "binance $".padStart(11) + "gap".padStart(9) +
  "  |  identical picks   mean names shared");
for (const topK of [3, 6, 9, 12]) {
  if (2 * topK > both.length) continue;
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: 0.008 };
  const ka = spread(sub(K), opts, { borrow: 0.05 }), ba = spread(sub(B), opts, { borrow: 0.05 });
  const byDate = rot => new Map(rot.rebalanceLog.map(r => [iso(r.at), new Set(r.chosen ?? [])]));
  let same = 0, overlap = 0, n = 0;
  for (const [leg, kr, br] of [["L", ka.top, ba.top], ["S", ka.bot, ba.bot]]) {
    const kk = byDate(kr), bb = byDate(br);
    for (const d of kk.keys()) {
      if (!bb.has(d)) continue;
      const a = kk.get(d), b = bb.get(d);
      const common = [...a].filter(x => b.has(x)).length;
      if (common === topK) same++;
      overlap += common; n++;
    }
  }
  const gap = Math.abs(ka.finalBalance - ba.finalBalance) / Math.max(ka.finalBalance, ba.finalBalance);
  console.log(String(topK).padEnd(6) + ("$" + ka.finalBalance.toFixed(0)).padStart(10) +
    ("$" + ba.finalBalance.toFixed(0)).padStart(11) + `${(100 * gap).toFixed(0)}%`.padStart(9) +
    `  |  ${(100 * same / n).toFixed(0)}%`.padStart(20) + `${(overlap / n).toFixed(2)} of ${topK}`.padStart(20));
}
console.log("\nIf the gap shrinks as topK rises, concentration is the mechanism and the published");
console.log("3-a-side result is the most source-sensitive configuration the campaign could have used.");
