// Correlated signals are not independent tests. Six BH survivors on equities turned out to be TWO
// factors once their return streams were correlated, and Benjamini-Hochberg assumes independence
// it does not have. This measures the dependence instead of asserting it, and it is run on the
// BOOKS' returns rather than on the raw scores -- two signals can rank differently and still trade
// almost the same names.
// Usage: node correlations-run.mjs [threshold]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { SIGNALS, testSignal } from "./factors.mjs";
import { correlation } from "./portfolio.mjs";

const HIGH = Number(process.argv[2] ?? 0.7);
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};

for (const [label, root, topK, slip] of [
  ["sp500", "./sp500-bundle", 12, 0.0005],
  ["crypto", "./candle-bundle", 3, 0.008],
]) {
  const series = load(root);
  const names = [], rets = {};
  for (const name of Object.keys(SIGNALS)) {
    const r = testSignal(name, series, { topK, slipPct: slip, borrow: 0.05, draws: 1 });
    if (!r.insufficient) { names.push(name); rets[name] = r.returns; }
  }
  console.log(`\n=== ${label}: ${names.length} signals, correlation of BOOK returns ===`);
  const w = Math.max(...names.map(n => n.length)) + 1;
  console.log(" ".repeat(w) + names.map(n => n.slice(0, 5).padStart(6)).join(""));
  for (const a of names) {
    let line = a.padEnd(w);
    for (const b of names) {
      const n = Math.min(rets[a].length, rets[b].length);
      const c = a === b ? 1 : correlation(rets[a].slice(0, n), rets[b].slice(0, n));
      line += (c === null ? "  n/a" : c.toFixed(2)).padStart(6);
    }
    console.log(line);
  }
  // Single-link clustering at the threshold: signals joined by any high correlation are one group.
  const parent = Object.fromEntries(names.map(n => [n, n]));
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const a of names) for (const b of names) {
    if (a >= b) continue;
    const n = Math.min(rets[a].length, rets[b].length);
    const c = correlation(rets[a].slice(0, n), rets[b].slice(0, n));
    if (c !== null && Math.abs(c) >= HIGH) parent[find(a)] = find(b);
  }
  const groups = {};
  for (const n of names) (groups[find(n)] ??= []).push(n);
  const clusters = Object.values(groups);
  console.log(`\nat |r| >= ${HIGH}: ${clusters.length} independent groups from ${names.length} signals`);
  for (const g of clusters.filter(g => g.length > 1)) console.log(`  one factor: ${g.join(", ")}`);
  const singles = clusters.filter(g => g.length === 1).flat();
  if (singles.length) console.log(`  on their own: ${singles.join(", ")}`);
}
