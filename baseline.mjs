/**
 * baseline.mjs — Is the entry broken, or just uninformative?
 *
 * One-off diagnostic (run: `node baseline.mjs`). Four comparisons on the same data,
 * same exits, same costs:
 *   1. buy & hold        — what the market handed out for doing nothing.
 *   2. random entries    — same trade count, entry bars drawn at random, identical
 *                          stop/target rules. This is the null the strategy must beat.
 *   3. cajh's entries    — the live anticipation rule.
 *   4. alignment on/off  — does requiring higher-timeframe confirmation help?
 *
 * The comparison that matters is 3 vs 2. Equal → the entry carries no information but
 * is not broken. Worse → adverse selection: the trigger systematically buys the wrong
 * moment, which is a fixable defect rather than an absent edge.
 */
import "dotenv/config";
import { loadCandles } from "./data.js";
import { backtestMultiTF } from "./backtest.js";
import { MIN_STOP_PCT, MAX_STOP_PCT_BY_TF, TP_R } from "./strategy.js";
import { loadWatchlist, symbolToKrakenId, TFS, stat } from "./researchlib.mjs";

const watch = loadWatchlist();
const FEE = 0.004, SLIP = 0.0005;

const seriesOf = (id) => TFS.map(([label, mins]) => ({ label, mins, candles: loadCandles(id, mins).slice(0, -1) }));
const cfg = (tf, extra = {}) => ({
  entryTf: tf, entryMode: "anticipate", alignMode: "none", trendGate: false, chopFilter: false,
  requireHigherLow: false, minStopPct: MIN_STOP_PCT, maxStopPct: MAX_STOP_PCT_BY_TF[tf],
  tpR: TP_R, lockBreakeven: true, ...extra,
});

// Random-entry null: same count of entries as the real rule produced, placed at random
// bars, with the SAME stop geometry (a stop `stopFrac` below entry) and R-multiple target.
function randomEntries(candles, count, stopFrac, tpR, seed) {
  const H = candles.map(c => +c.high), L = candles.map(c => +c.low), C = candles.map(c => +c.close);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = [];
  for (let t = 0; t < count; t++) {
    const i = 20 + Math.floor(rnd() * (candles.length - 220));
    const entry = C[i], stop = entry * (1 - stopFrac), risk = entry - stop, tp = entry + tpR * risk;
    let r = null;
    for (let j = i + 1; j < Math.min(candles.length, i + 200); j++) {
      if (L[j] <= stop) { r = -1 - (FEE + SLIP) * (entry + stop) / risk; break; }
      if (H[j] >= tp)   { r = tpR - (FEE + SLIP) * (entry + tp) / risk; break; }
    }
    if (r == null) { const px = C[Math.min(candles.length - 1, i + 200)]; r = (px - entry) / risk - (FEE + SLIP) * (entry + px) / risk; }
    out.push(r);
  }
  return out;
}

const pooled = { bh: [], rand: [], cajh: [], aligned: [] };
let pairs = 0;

for (const sym of watch) {
  const id = symbolToKrakenId(sym);
  const series = seriesOf(id);
  if (series.some(s => s.candles.length < 200)) continue;
  pairs++;

  // 1) Buy & hold over the same window, as a percentage.
  const c = series[0].candles;
  pooled.bh.push({ sym, pct: (+c.at(-1).close / +c[0].close - 1) * 100 });

  for (const [tf] of TFS) {
    const r = backtestMultiTF({ series }, cfg(tf));
    pooled.cajh.push(...(r.results || []));
    const a = backtestMultiTF({ series }, cfg(tf, { alignMode: "all" }));
    pooled.aligned.push(...(a.results || []));
    // Random null, matched on trade count, using this TF's median stop size (2% ≈ typical).
    const tfCandles = series.find(s => s.label === tf).candles;
    pooled.rand.push(...randomEntries(tfCandles, r.trades, 0.02, TP_R, 12345 + pairs));
  }
}

const c1 = stat(pooled.cajh), c2 = stat(pooled.rand), c3 = stat(pooled.aligned);
const bhMean = pooled.bh.reduce((a, b) => a + b.pct, 0) / (pooled.bh.length || 1);

console.log(`\n=== Entry diagnostics — ${pairs} pairs, ${TFS.map(t => t[0]).join("/")} pooled ===\n`);
console.log(`Buy & hold over the same window : ${bhMean >= 0 ? "+" : ""}${bhMean.toFixed(1)}% average per pair`);
console.log(`  (${pooled.bh.filter(b => b.pct > 0).length}/${pooled.bh.length} pairs up; best ${Math.max(...pooled.bh.map(b => b.pct)).toFixed(0)}%, worst ${Math.min(...pooled.bh.map(b => b.pct)).toFixed(0)}%)\n`);
const row = (label, s) => console.log(`${label.padEnd(28)} ${String(s.n).padStart(6)}t  ${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(3)}R/t  95% CI [${s.lo.toFixed(3)}, ${s.hi.toFixed(3)}]  win ${(s.wr * 100).toFixed(0)}%`);
row("cajh entries (live rule)", c1);
row("RANDOM entries (same exits)", c2);
row("cajh + 1h/4h/1d alignment", c3);

const diff = c1.mean - c2.mean, seDiff = Math.sqrt(c1.se ** 2 + c2.se ** 2);
console.log(`\ncajh − random = ${diff >= 0 ? "+" : ""}${diff.toFixed(3)}R/t  (±${(1.96 * seDiff).toFixed(3)} at 95%)`);
console.log(Math.abs(diff) < 1.96 * seDiff
  ? "→ INDISTINGUISHABLE from random entries. The trigger carries no information; it is not broken, it is empty."
  : diff < 0
  ? "→ WORSE than random: the trigger systematically buys the wrong moment (adverse selection). That is a defect worth hunting."
  : "→ BETTER than random: the trigger does carry information; the loss is coming from costs or exits.");
console.log(`\nAlignment on vs off: ${(c3.mean - c1.mean) >= 0 ? "+" : ""}${(c3.mean - c1.mean).toFixed(3)}R/t for ${c3.n} vs ${c1.n} trades` +
  ` → ${c3.mean > c1.mean ? "confirmation helps per-trade" : "confirmation does NOT help"}; it mainly removes trades.\n`);
