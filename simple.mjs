/**
 * simple.mjs — The minimal daily strategy, tested across regimes.
 *
 * Everything the project has learned says: fewer variables, daily timeframe, a switch
 * that stops trading in downtrends, and a volatility-scaled stop. This tests exactly
 * that and nothing else:
 *
 *     daily candles · anticipation entry · MA(20) trend gate · stop = k·ATR · target = R multiple
 *
 * No alignment, no chop filter, no higher-low rule, no room filter, no breakeven lock.
 *
 * The point is the regime split. 2023-2024 was ingested only now, so it is unseen by
 * every sweep in this project's history; 2025-2026 is the bear window everything was
 * measured on. A strategy worth anything must not be negative in both — and if it is
 * positive only in the bull window, it is a beta harvest, not an edge, which is why
 * buy & hold is printed alongside for the same window.
 *
 * Run: node simple.mjs
 */
import "dotenv/config";
import { loadCandles } from "./data.js";
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId, ts, stat } from "./researchlib.mjs";

const syms = loadWatchlist();

const WINDOWS = [
  ["2023 (unseen)",        ts("2023-01-01"), ts("2024-01-01")],
  ["2024 (unseen)",        ts("2024-01-01"), ts("2025-01-01")],
  ["2025-26 (bear, seen)", ts("2025-01-01"), ts("2027-01-01")],
  ["ALL",                  0,                ts("2027-01-01")],
];

// The whole strategy: one timeframe, one gate, one stop rule, one target.
const SIMPLE = {
  entryTf: "1d", entryMode: "anticipate",
  trendGate: true, trendGateMode: "ma", trendMa: 20,   // don't go long in a downtrend
  stopMode: "atr", atrStopK: 3,                        // volatility-scaled invalidation
  alignMode: "none", chopFilter: false, requireHigherLow: false,
  lockBreakeven: false, minStopPct: null, maxStopPct: null,
  tpR: 3,
};

const load = () => syms.map(s => {
  const id = symbolToKrakenId(s);
  return { sym: s, series: [{ label: "1d", mins: 1440, candles: loadCandles(id, 1440).slice(0, -1) }] };
}).filter(d => d.series[0].candles.length > 120);

const slice = (series, from, to) => series.map(s => ({
  ...s, candles: s.candles.filter(c => { const t = +c.time; return t >= from && t < to; })
}));

const data = load();
console.log(`\n=== Simple daily strategy — ${data.length} pairs ===`);
console.log(`1d · anticipation entry · MA20 trend gate · stop 3·ATR · target ${SIMPLE.tpR}R · nothing else\n`);
console.log("window                 trades   net R/t            gross R/t     win%   total R   buy&hold");
console.log("-".repeat(94));

for (const [label, from, to] of WINDOWS) {
  const net = [], gross = [], bh = [];
  for (const d of data) {
    const series = slice(d.series, from, to);
    if (series[0].candles.length < 60) continue;
    net.push(...(backtestMultiTF({ series }, SIMPLE).results || []));
    gross.push(...(backtestMultiTF({ series }, { ...SIMPLE, feeRate: 0, slipPct: 0 }).results || []));
    const c = series[0].candles;
    bh.push((+c.at(-1).close / +c[0].close - 1) * 100);
  }
  const s = stat(net), g = stat(gross);
  const bhAvg = bh.length ? bh.reduce((a, b) => a + b, 0) / bh.length : 0;
  console.log(
    `${label.padEnd(22)} ${String(s.n).padStart(5)}   ` +
    `${(s.mean >= 0 ? "+" : "") + s.mean.toFixed(3)} ±${s.ci.toFixed(3)}   ` +
    `${(g.mean >= 0 ? "+" : "") + g.mean.toFixed(3)}      ` +
    `${(s.wr * 100).toFixed(0)}%   ${s.total >= 0 ? "+" : ""}${s.total.toFixed(0)}R   ` +
    `${bhAvg >= 0 ? "+" : ""}${bhAvg.toFixed(0)}%`
  );
}

// Sensitivity: the result must not hinge on the exact stop/target, or it is curve-fit.
console.log(`\n--- sensitivity on 2023-2024 (unseen): does the answer depend on the knobs? ---`);
console.log("stop·ATR  target  trades   net R/t");
for (const k of [2, 3, 4]) {
  for (const tp of [2, 3, 4]) {
    const net = [];
    for (const d of data) {
      const series = slice(d.series, ts("2023-01-01"), ts("2025-01-01"));
      if (series[0].candles.length < 60) continue;
      net.push(...(backtestMultiTF({ series }, { ...SIMPLE, atrStopK: k, tpR: tp }).results || []));
    }
    const s = stat(net);
    console.log(`   ${k}       ${tp}R    ${String(s.n).padStart(5)}   ${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(3)} ±${s.ci.toFixed(3)}`);
  }
}
console.log("");
