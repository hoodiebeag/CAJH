/**
 * intensityIC.mjs — The decisive test of 4h trade intensity.
 *
 * The intensity signal was measured at z=-1.90 / p=0.010 on 3 pairs of 2026 data, because
 * we believed trade counts existed only where order flow did. That was wrong: the OHLCVT
 * archive carries a real trades-count column and ingestKrakenOHLCVT parses it, so trade
 * COUNT is available for all 20 pairs across 2023-2026 (only buyVol/sellVol/maxTrade are
 * archive-zeroed). This re-runs the same measurement on ~90x more independent samples,
 * which is exactly what "just barely not significant" needed.
 *
 * Same discipline as before: non-overlapping samples (stride = horizon) so overlapping
 * windows cannot inflate n, a block-permutation p-value, and a per-regime split, because
 * a signal that only exists in one regime is a regime artifact.
 */
import "dotenv/config";
import { loadBars } from "./data.js";
import { symbolToKrakenId, loadWatchlist } from "./researchlib.mjs";

const TF = 240, H = 12;                    // 4h bars, 48h forward horizon
const syms = loadWatchlist();
const ts = d => Date.parse(d + "T00:00:00Z") / 1000;
const WINDOWS = [["2023", ts("2023-01-01"), ts("2024-01-01")],
                 ["2024", ts("2024-01-01"), ts("2025-01-01")],
                 ["2025-26", ts("2025-01-01"), ts("2027-01-01")],
                 ["ALL", 0, ts("2027-01-01")]];

function resample(bars, mins) {
  const span = mins * 60, out = new Map();
  for (const b of bars) {
    const t = Math.floor(b.time / span) * span;
    let c = out.get(t);
    if (!c) { c = { time: t, close: b.close, trades: 0 }; out.set(t, c); }
    c.close = b.close; c.trades += b.trades;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function rankOf(v) {
  const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j+1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(rx, ry) {
  const n = rx.length, mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i]-mx, b = ry[i]-my; num += a*b; dx += a*a; dy += b*b; }
  return dx && dy ? num / Math.sqrt(dx*dy) : null;
}
const shuffle = a => { a = a.slice(); for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

// Collect (intensity, forward-return) per pair, tagged by time so windows can slice later.
const all = [];
let used = 0;
for (const sym of syms) {
  let bars;
  try { bars = resample(loadBars(symbolToKrakenId(sym)).filter(b => b.trades > 0), TF); }
  catch { continue; }
  if (bars.length < 200) continue;
  used++;
  const C = bars.map(b => b.close);
  for (let i = 20; i + H < bars.length; i++) {
    const avg = mean(bars.slice(i-20, i).map(x => x.trades));
    if (!(avg > 0)) continue;
    all.push({ t: bars[i].time, x: bars[i].trades / avg, y: (C[i+H]-C[i])/C[i]*100, i });
  }
}

console.log(`\n=== 4h trade intensity vs 48h forward return — ${used} pairs, full history ===`);
console.log(`(trade counts are populated for every pair; only buyVol/sellVol are 2026/3-pair limited)\n`);
console.log("window     samples   IC(non-overlap)   SE      z       p(block)   decile spread   vs 0.9% cost");
console.log("-".repeat(104));

for (const [label, from, to] of WINDOWS) {
  const sel = all.filter(r => r.t >= from && r.t < to && r.i % H === 0);  // stride = horizon
  if (sel.length < 100) { console.log(`${label.padEnd(10)} too few samples (${sel.length})`); continue; }
  const xs = sel.map(r => r.x), ys = sel.map(r => r.y);
  const rx = rankOf(xs), ry = rankOf(ys);
  const ic = pearson(rx, ry), n = xs.length;
  const se = 1/Math.sqrt(n-1), z = ic/se;
  let ge = 0, K = 300;
  for (let k = 0; k < K; k++) { const s = pearson(rx, shuffle(ry)); if (s != null && Math.abs(s) >= Math.abs(ic)) ge++; }
  const p = (ge+1)/(K+1);
  const order = xs.map((v,i)=>[v,ys[i]]).sort((a,b)=>a[0]-b[0]);
  const d = Math.max(1, Math.floor(order.length/10));
  const spread = mean(order.slice(-d).map(o=>o[1])) - mean(order.slice(0,d).map(o=>o[1]));
  console.log(`${label.padEnd(10)} ${String(n).padStart(7)}   ${(ic>=0?"+":"")+ic.toFixed(4)}          ${se.toFixed(4)}  ${(z>=0?"+":"")+z.toFixed(2)}   p=${p.toFixed(3)}    ${(spread>=0?"+":"")+spread.toFixed(3)}%        ${Math.abs(spread)>0.9?"exceeds":(Math.abs(spread)/0.9*100).toFixed(0)+"% of"} cost`);
}
console.log(`\nNon-overlapping sampling only (stride = 12 bars = the 48h horizon), so n is the honest`);
console.log(`independent count. A signal real in one regime but absent in others is a regime artifact.\n`);
