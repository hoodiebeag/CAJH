// Is the equities result the CROSS-SECTION, or a handful of names?
//
// The cross-asset battery could not adjudicate idioVol, lowVol and trendQuality: they pass on
// sp500-128 and fail on crypto, and there is no third asset class to break the tie. This does not
// need one. Split the 128 symbols into two disjoint halves and rank INSIDE each half. A real
// cross-sectional factor is a statement about relative ranking and must appear in both halves; a
// result driven by a few names appears in the half that holds them and vanishes from the other.
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { randomSpreadNull, selectionP } from "./xsmom.mjs";
import { SIGNALS, testSignal } from "./factors.mjs";

const DRAWS = Number(process.argv[2] ?? 2000);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};
const all = load("./sp500-bundle");
const names = Object.keys(all).sort();

// Deterministic split, fixed before any result is seen.
let s = 20260904;
const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const shuffled = [...names];
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const halves = [shuffled.slice(0, Math.floor(shuffled.length / 2)), shuffled.slice(Math.floor(shuffled.length / 2))];
const sub = ks => Object.fromEntries(ks.map(k => [k, all[k]]));

// Half the universe, so half the book: 5 a side rather than 10 by default. Overridable because the
// concentration ladder found the edge rising monotonically as topK falls -- 127% CAGR at 3 names a
// side against 25% at 12 -- and the only way to tell information from noise amplification at that
// end is to ask whether the concentrated book replicates in both halves.
const TOPK = Number(process.argv[3] ?? 5);
const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: TOPK, slipPct: 0.0005 };
const nulls = halves.map((h, i) => {
  const t0 = Date.now();
  const n = randomSpreadNull(sub(h), opts, { draws: DRAWS, borrow: 0.05 });
  console.error(`half ${i + 1}: ${h.length} symbols, ${DRAWS} draws in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return n;
});

console.log(`\nsp500-128 split into ${halves[0].length} + ${halves[1].length}, topK ${TOPK} a side, ${DRAWS} null draws`);
console.log("signal".padEnd(14) + "  halfA $     p_A" + "     halfB $     p_B" + "   both<0.05");
for (const name of Object.keys(SIGNALS)) {
  const r = halves.map((h, i) => testSignal(name, sub(h), { topK: TOPK, slipPct: 0.0005, borrow: 0.05, nullResult: nulls[i] }));
  if (r.some(x => x.insufficient)) { console.log(name.padEnd(14) + "  insufficient periods"); continue; }
  const both = r.every(x => x.p < 0.05);
  console.log(name.padEnd(14) +
    ("$" + r[0].finalBalance).padStart(10) + r[0].p.toFixed(4).padStart(8) +
    ("$" + r[1].finalBalance).padStart(11) + r[1].p.toFixed(4).padStart(8) +
    (both ? "      YES" : "      no"));
}
