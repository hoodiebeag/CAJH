// Does cross-sectional DISPERSION, measured before a period, predict whether that period's spread
// pays? A ranking can only pay if the things ranked actually differ: when every name moves
// together the top decile and the bottom decile are the same trade and the spread earns nothing
// while still paying turnover. This is a regime question, not another price transform.
//
// Strictly causal. Dispersion over the 63 bars ending AT the rebalance decides the NEXT period,
// and the threshold is the EXPANDING median of everything seen so far, so no rule ever uses a
// number it could not have known. The in-sample-median row is printed alongside, labelled as the
// cheat it is, to show how much a fixed threshold would have flattered this.
// Usage: node dispersion-run.mjs
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { spread, anchoredDrawdown } from "./xsmom.mjs";

const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
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

// Dispersion at a date: the standard deviation ACROSS symbols of their trailing 63-bar returns.
function dispersionAt(series, at, window = 63) {
  const rs = [];
  for (const sym of Object.keys(series)) {
    const bars = series[sym].filter(b => +b.time <= at);
    if (bars.length < window + 1) continue;
    const a = +bars[bars.length - 1 - window].close, b = +bars[bars.length - 1].close;
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  if (rs.length < 10) return null;
  const m = rs.reduce((x, y) => x + y, 0) / rs.length;
  return Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / (rs.length - 1));
}

for (const [label, root, topK, slip] of [
  ["crypto", "./candle-bundle", 3, 0.008],
  ["sp500", "./sp500-bundle", 12, 0.0005],
]) {
  const series = load(root);
  const s = spread(series, { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK, slipPct: slip }, { borrow: 0.05 });
  const ppy = s.periodsPerYear;
  const disp = s.returns.map((_, i) => dispersionAt(series, s.top.rebalanceLog[i].at));

  // A weight per period. The book is scaled by it, so a skipped period is weight 0 and its bars
  // contribute nothing to the path -- which is what makes the drawdown below honest.
  const run = (weightOf, name) => {
    const w = s.returns.map((_, i) => (disp[i] === null ? 0 : weightOf(i)));
    const rets = s.returns.map((r, i) => Math.log(1 + w[i] * (Math.exp(r) - 1)));
    const bars = s.barReturns.map((b, k) => {
      // Which period is bar k inside? Scale it by that period's weight.
      let m = 0;
      while (m + 1 < s.top.rebalanceLog.length && s.top.rebalanceLog[m + 1].at < s.times[k]) m++;
      return Math.log(1 + (w[m] ?? 0) * (Math.exp(b) - 1));
    });
    let bal = 1000;
    for (const r of rets) bal *= Math.exp(r);
    const live = rets.filter((_, i) => w[i] > 0);
    const mean = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0;
    const sd = live.length > 1
      ? Math.sqrt(live.reduce((a, b) => a + (b - mean) ** 2, 0) / (live.length - 1)) : 0;
    const yrs = s.returns.length / ppy;                       // always the FULL window
    console.log(name.padEnd(32) + ("$" + bal.toFixed(2)).padStart(10) +
      (((bal / 1000) ** (1 / yrs) - 1) * 100).toFixed(1).padStart(8) + "%" +
      anchoredDrawdown(rets, bars, s.times, s.top.rebalanceLog).toFixed(2).padStart(8) + "%" +
      (sd ? (mean / sd * Math.sqrt(ppy)).toFixed(2) : "n/a").padStart(8) +
      `   ${rets.filter((r, i) => w[i] > 0 && r > 0).length}/${live.length} on`);
  };

  // Expanding median, known before each decision. Eight periods of warmup, always on.
  const seen = [], expMed = [];
  for (const d of disp) {
    expMed.push(seen.length >= 8 ? [...seen].sort((a, b) => a - b)[Math.floor(seen.length / 2)] : null);
    if (d !== null) seen.push(d);
  }
  const inSample = [...disp.filter(d => d !== null)].sort((a, b) => a - b)[Math.floor(disp.filter(d => d !== null).length / 2)];

  console.log(`\n=== ${label}: ${disp.filter(d => d !== null).length} of ${s.returns.length} periods have a dispersion reading ===`);
  console.log("book".padEnd(32) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
  run(() => 1, "always on (baseline)");
  run(i => (expMed[i] === null || disp[i] >= expMed[i] ? 1 : 0), "GATE: on when disp >= exp median");
  run(i => (expMed[i] !== null && disp[i] < expMed[i] ? 1 : 0), "  inverse: on only when it is low");
  // Sizing rather than gating: exposure proportional to dispersion against its expanding median,
  // clamped to [0.5, 1.5] so one quiet quarter cannot take the book to zero or to double.
  run(i => (expMed[i] === null ? 1 : Math.min(1.5, Math.max(0.5, disp[i] / expMed[i]))), "SIZE: scaled by disp/median");
  run(i => (disp[i] >= inSample ? 1 : 0), "  [in-sample median, cheat]");
}
