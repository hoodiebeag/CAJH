/**
 * flowverify.mjs — Do the two promising 4h flow cells survive an honest sample count?
 *
 * The pooled run flagged two cells at 4h bars / 48h horizon: cumulative imbalance
 * (+1.081% decile spread, "clears cost") and trade intensity (-1.121%). Before believing
 * either, two things inflate those numbers and must be removed:
 *
 *   1. OVERLAPPING WINDOWS. A 48h horizon on 4h bars means adjacent samples share 11 of
 *      12 hours. n=1752 is not 1752 independent observations - it is ~146. Standard
 *      errors computed on the raw count are far too small.
 *   2. CROSS-ASSET CORRELATION. BTC/ETH/SOL move together, so pooling three pairs does
 *      not triple the independent sample either.
 *
 * This recomputes each cell using only NON-OVERLAPPING samples (stride = horizon), and
 * reports the IC with a standard error based on that honest count. A real effect
 * survives; an artifact of overlap does not.
 */
import "dotenv/config";
import { loadBars } from "../data.js";
import { symbolToKrakenId } from "../storage.js";

const TF = 240, H = 12;                    // 4h bars, 48h forward horizon
const syms = ["BTC", "ETH", "SOL"];

function resample(bars, mins) {
  const span = mins * 60, out = new Map();
  for (const b of bars) {
    const t = Math.floor(b.time / span) * span;
    let c = out.get(t);
    if (!c) { c = { time: t, close: b.close, volume: 0, buyVol: 0, sellVol: 0, trades: 0 }; out.set(t, c); }
    c.close = b.close; c.volume += b.volume; c.buyVol += b.buyVol; c.sellVol += b.sellVol; c.trades += b.trades;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
function spearman(x, y) {
  const n = x.length; if (n < 10) return null;
  const rank = (v) => { const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j+1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((a,b)=>a+b,0)/n, my = ry.reduce((a,b)=>a+b,0)/n;
  let num=0, dx=0, dy=0;
  for (let i=0;i<n;i++){ const a=rx[i]-mx, b=ry[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
  return dx&&dy ? num/Math.sqrt(dx*dy) : null;
}
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;

const cells = { "cum imbalance(6)": [], "trade intensity": [] };
const overlapping = { "cum imbalance(6)": [], "trade intensity": [] };

for (const sym of syms) {
  const all = loadBars(symbolToKrakenId(sym)).filter(b => b.buyVol > 0 || b.sellVol > 0);
  const bars = resample(all, TF);
  const C = bars.map(b => b.close);
  const imb = bars.map(b => { const v = b.buyVol + b.sellVol; return v > 0 ? (b.buyVol - b.sellVol)/v : 0; });
  const cumImb = imb.map((_, i) => i < 5 ? null : mean(imb.slice(i-5, i+1)));
  const intensity = bars.map((b, i) => { if (i < 20) return null;
    const avg = mean(bars.slice(i-20, i).map(x => x.trades)); return avg > 0 ? b.trades/avg : null; });

  for (const [name, f] of [["cum imbalance(6)", cumImb], ["trade intensity", intensity]]) {
    for (let i = 20; i + H < bars.length; i++) {
      if (f[i] == null || !isFinite(f[i])) continue;
      const pt = [f[i], (C[i+H] - C[i]) / C[i] * 100];
      overlapping[name].push(pt);
      if (i % H === 0) cells[name].push(pt);   // stride = horizon -> non-overlapping
    }
  }
}

console.log(`\n=== Honest sample check — 4h bars, 48h horizon, ${syms.join("/")} ===\n`);
console.log("feature              samples          IC       SE      z      95% CI              verdict");
for (const name of Object.keys(cells)) {
  for (const [label, data] of [["overlapping", overlapping[name]], ["NON-overlapping", cells[name]]]) {
    const xs = data.map(d => d[0]), ys = data.map(d => d[1]);
    const ic = spearman(xs, ys), n = xs.length;
    const se = 1/Math.sqrt(Math.max(n-1,1)), z = ic/se;
    const lo = ic - 1.96*se, hi = ic + 1.96*se;
    const sig = (lo > 0 || hi < 0) ? "significant" : "NOT significant (CI spans 0)";
    console.log(`${name.padEnd(20)} ${label.padEnd(15)} ${(ic>=0?"+":"")+ic.toFixed(4)}  ${se.toFixed(4)}  ${(z>=0?"+":"")+z.toFixed(2)}  [${lo.toFixed(3)}, ${hi.toFixed(3)}]  n=${n} ${sig}`);
  }
}
console.log(`\nOverlapping rows reuse the same 48h of price across 12 consecutive samples, so their`);
console.log(`standard errors are far too small. The non-overlapping rows are the honest test.\n`);
