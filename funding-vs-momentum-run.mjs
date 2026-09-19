// Is funding a NON-PRICE signal, or is it price momentum wearing a disguise?
//
// The pre-registered carry study came back dead: nothing clears BH and every cell loses money in
// the registered direction. Losing in the registered direction implies the inverse would have
// gained, and the inverse is "long the names with the HIGHEST funding". High funding means longs
// are paying to stay long, which happens after a price rise -- so the inverse may be nothing more
// than momentum, and funding would add no information price does not already carry.
//
// That question decides whether this whole line of enquiry -- find a non-price information source
// -- actually got one. It is answered by measuring the rank correlation between trailing funding
// and trailing return, not by asserting it. Two mechanisms were asserted and refuted today already
// (liquidity explaining the venue split, timezone explaining it) and asserting a third would be a
// worse error than either.
// Usage: node funding-vs-momentum-run.mjs
import { readFileSync } from "node:fs";
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { parseFundingCsv, fundingGrid, trailingFunding, screenFunding } from "./funding.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const series = {};
for (const p of availablePairs(1440, "./candle-bundle")) {
  const c = loadBundleCandles(p, 1440, "./candle-bundle").filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
for (const k of Object.keys(series)) if (!(k in screenUniverse({ ...series }).kept)) delete series[k];
const times = [...new Set(Object.values(series).flatMap(c => c.map(b => Number(b.time))))].sort((a, b) => a - b);
const raw = {};
for (const sym of Object.keys(series)) {
  try { raw[sym] = parseFundingCsv(readFileSync(`funding-binance/${sym}.csv`, "utf8")); } catch {}
}
const kept = screenFunding(raw, times).kept;
const grid = fundingGrid(kept, times);

// Price grid on the same calendar, forward-filled, so a return can be taken at any index.
const px = {};
for (const s of Object.keys(kept)) {
  const m = new Map(series[s].map(b => [Number(b.time), Number(b.close)]));
  let last = null;
  px[s] = times.map(t => { const v = m.get(t); if (v !== undefined) last = v; return last; });
}
// Spearman: ranks, not levels, because the book ranks and never uses the raw number.
const spearman = (a, b) => {
  const rank = xs => { const idx = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length);
    idx.forEach(([, i], k) => r[i] = k); return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  const m = x => x.reduce((p, q) => p + q, 0) / n;
  const ma = m(ra), mb = m(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
};

console.log(`${Object.keys(kept).length} symbols with usable Binance funding.\n`);
console.log("Cross-sectional rank correlation, at each rebalance date, between TRAILING FUNDING over");
console.log("L bars and TRAILING RETURN over the same L bars. If these rank the universe the same way,");
console.log("funding is not new information.\n");
console.log("L".padEnd(5) + "dates".padStart(7) + "mean rho".padStart(11) + "median".padStart(9) +
  "p10".padStart(8) + "p90".padStart(8) + "  reading");
for (const L of [7, 30, 90]) {
  const rhos = [];
  for (let i = 252; i < times.length; i += 21) {
    const syms = [], f = [], r = [];
    for (const s of Object.keys(kept)) {
      const tf = trailingFunding(grid[s], i, L);
      const p0 = px[s][i - L], p1 = px[s][i - 1];
      if (tf === null || !p0 || !p1) continue;
      syms.push(s); f.push(tf); r.push(Math.log(p1 / p0));
    }
    if (syms.length >= 8) rhos.push(spearman(f, r));
  }
  if (!rhos.length) { console.log(String(L).padEnd(5) + "  no dates"); continue; }
  const sorted = [...rhos].sort((a, b) => a - b);
  const mean = rhos.reduce((a, b) => a + b, 0) / rhos.length;
  const q = p => sorted[Math.floor(p * sorted.length)];
  const reading = Math.abs(mean) > 0.5 ? "funding IS largely momentum"
                : Math.abs(mean) > 0.25 ? "substantially overlapping" : "largely independent of price";
  console.log(String(L).padEnd(5) + String(rhos.length).padStart(7) + mean.toFixed(3).padStart(11) +
    q(0.5).toFixed(3).padStart(9) + q(0.1).toFixed(3).padStart(8) + q(0.9).toFixed(3).padStart(8) + "  " + reading);
}
console.log("\nA high positive rho means the two signals pick the same names, so the inverse of the");
console.log("registered carry book is the momentum book and funding carries no separate information.");
