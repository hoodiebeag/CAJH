/**
 * regime.mjs — Does a regime filter save a long-only strategy in a bear market?
 *
 * The sample window (Jan 2025 → Mar 2026) was a severe alt bear market: buy & hold
 * averaged −66% with 0/20 pairs up. A long-only trigger cannot win there; the only
 * winning action is not trading. So the question is not "does the entry predict?" but
 * "does a regime filter successfully switch the strategy OFF when it should be off?"
 *
 * Compares, per timeframe: no gate · higher-TF alignment · 4h/1d MA trend gate · both.
 * Reports trades kept and R/t — a good filter should cut trades a lot and lift R/t.
 */
import "dotenv/config";
import { loadCandles } from "./data.js";
import { backtestMultiTF } from "./backtest.js";
import { symbolToKrakenId, loadConfig } from "./storage.js";
import { MIN_STOP_PCT, MAX_STOP_PCT_BY_TF, TP_R } from "./strategy.js";

const watch = (process.env.WATCHLIST || "").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
const syms = watch.length ? watch : (loadConfig().watchlist || []).map(a => a.symbol);
const TFS = [["1h",60],["4h",240],["1d",1440]];
const base = (tf) => ({ entryTf: tf, entryMode: "anticipate", requireHigherLow: false,
  minStopPct: MIN_STOP_PCT, maxStopPct: MAX_STOP_PCT_BY_TF[tf], tpR: TP_R, lockBreakeven: true });

const VARIANTS = [
  ["no gate (live today)", { alignMode: "none", trendGate: false }],
  ["higher-TF alignment",  { alignMode: "all",  trendGate: false }],
  ["MA trend gate",        { alignMode: "none", trendGate: true, trendGateMode: "ma", trendMa: 20 }],
  ["alignment + MA gate",  { alignMode: "all",  trendGate: true, trendGateMode: "ma", trendMa: 20 }],
  ["structure trend gate", { alignMode: "none", trendGate: true, trendGateMode: "structure" }],
];

const data = [];
for (const s of syms) {
  const id = symbolToKrakenId(s);
  const series = TFS.map(([label,mins]) => ({ label, mins, candles: loadCandles(id, mins).slice(0,-1) }));
  if (!series.some(x => x.candles.length < 200)) data.push(series);
}
console.log(`\n=== Regime-filter test — ${data.length} pairs (bear-market window) ===\n`);
for (const [tf] of TFS) {
  console.log(`--- ${tf} ---`);
  for (const [label, extra] of VARIANTS) {
    const pooled = [];
    for (const series of data) pooled.push(...(backtestMultiTF({ series }, { ...base(tf), ...extra }).results || []));
    const n = pooled.length, sum = pooled.reduce((a,b)=>a+b,0);
    const mean = n ? sum/n : 0;
    const sd = n>1 ? Math.sqrt(pooled.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)) : 0;
    const ci = n ? 1.96*sd/Math.sqrt(n) : 0;
    console.log(`  ${label.padEnd(22)} ${String(n).padStart(5)}t  ${mean>=0?"+":""}${mean.toFixed(3)}R/t ±${ci.toFixed(3)}  total ${sum.toFixed(0)}R`);
  }
  console.log("");
}
