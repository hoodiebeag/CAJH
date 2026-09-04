// Walk-forward on the SELECTION, not just on the parameters.
//
// The desk book's weakest claim is that idioVol was chosen for the equities sleeve using screens
// run over the whole window. The screens were fixed in advance and it was never chosen by its
// return, which is the strongest defence available -- and it is not the same as never having seen
// the test data. This removes that objection by making the choice itself out of sample.
//
// At each quarter, rank all twelve signals by the Sharpe of their long-short spread on bars that
// closed BEFORE the quarter began, then trade the winner (and separately the top two, equally
// weighted) through that quarter. The comparison is against always holding momentum, which needs
// no selection at all, and against the signal that turns out best in sample, which is the number
// a selection rule would have to beat to be worth its complexity.
// Usage: node selection-wf.mjs [testFrom] [testTo]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { perYear, anchoredDrawdown } from "./xsmom.mjs";
import { SIGNALS, testSignal } from "./factors.mjs";

const TEST_FROM = process.argv[2] ?? "2025-01-01";
const TEST_TO = process.argv[3] ?? "2026-09-02";
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;

const load = root => {
  const o = {};
  for (const p of availablePairs(1440, root)) {
    const c = loadBundleCandles(p, 1440, root).filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec(TEST_TO));
    if (c.length >= 400) o[p] = c;
  }
  return o;
};
// Bars strictly before a cutoff. The series is NOT truncated when TRADING -- a position's forward
// return is not lookahead -- only when FITTING, which is the distinction a walk-forward once got
// wrong here and produced a false negative from amputated holds.
const truncate = (series, before) => Object.fromEntries(
  Object.entries(series).map(([k, v]) => [k, v.filter(b => +b.time < sec(before))]).filter(([, v]) => v.length >= 300));

const sharpeOf = (rets, ppy) => {
  if (rets.length < 4) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(ppy) : null;
};

function quarters(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), q = Math.floor((Number(from.slice(5, 7)) - 1) / 3);
  for (;;) {
    const a = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    if (a > to) break;
    const ny = q === 3 ? y + 1 : y, nq = (q + 1) % 4;
    out.push([a, `${ny}-${String(nq * 3 + 1).padStart(2, "0")}-01`]);
    y = ny; q = nq;
  }
  return out;
}

for (const [label, root, topK, slip] of [
  ["sp500", "./sp500-bundle", 12, 0.0005],
  ["crypto", "./candle-bundle", 3, 0.008],
]) {
  const series = load(root);
  const opts = { topK, slipPct: slip, borrow: 0.05, draws: 1 };
  // Scored once on the full series; the quarter filter below decides which periods each book keeps.
  const full = {};
  for (const name of Object.keys(SIGNALS)) {
    const r = testSignal(name, series, opts);
    if (!r.insufficient) full[name] = r;
  }
  const names = Object.keys(full);
  const ppy = full[names[0]].periodsPerYear;

  const books = { top1: [], top2: [], momentum: [] };
  const bars = { top1: [], top2: [], momentum: [] };
  const times = full[names[0]].times, rlog = full[names[0]].top.rebalanceLog;
  const chosenLog = [];

  for (const [from, to] of quarters(TEST_FROM, TEST_TO)) {
    const train = truncate(series, from);
    if (Object.keys(train).length < 2 * topK) { chosenLog.push([from, "too few symbols in train"]); continue; }
    const ranked = [];
    for (const name of names) {
      const r = testSignal(name, train, opts);
      if (r.insufficient) continue;
      const sh = sharpeOf(r.returns, r.periodsPerYear);
      if (sh !== null) ranked.push([name, sh]);
    }
    if (!ranked.length) { chosenLog.push([from, "no signal had enough training periods"]); continue; }
    ranked.sort((a, b) => b[1] - a[1]);
    const pick = { top1: [ranked[0][0]], top2: ranked.slice(0, 2).map(x => x[0]), momentum: ["momentum"] };
    chosenLog.push([from, `${ranked[0][0]} (${ranked[0][1].toFixed(2)}), then ${ranked[1]?.[0]}`]);

    const lo = sec(from), hi = sec(to);
    for (const key of Object.keys(books)) {
      const chosen = pick[key].filter(n => full[n]);
      if (!chosen.length) continue;
      for (let i = 0; i < full[chosen[0]].returns.length; i++) {
        const at = rlog[i + 1]?.at;
        if (at === undefined || at < lo || at >= hi) continue;
        // Equal weight across the chosen signals, rebalanced each period.
        const simple = chosen.reduce((a, n) => a + Math.exp(full[n].returns[i]), 0) / chosen.length;
        books[key].push({ i, r: Math.log(simple) });
      }
      for (let k = 0; k < times.length; k++) {
        if (times[k] < lo || times[k] >= hi) continue;
        const simple = chosen.reduce((a, n) => a + Math.exp(full[n].barReturns[k]), 0) / chosen.length;
        bars[key].push({ k, r: Math.log(simple) });
      }
    }
  }

  console.log(`\n=== ${label}: quarterly re-selection, ${TEST_FROM} to ${TEST_TO} ===`);
  for (const [q, what] of chosenLog) console.log(`  ${q}  ${what}`);
  console.log("\nbook".padEnd(28) + "final$".padStart(10) + "CAGR".padStart(9) + "maxDD".padStart(9) + "Sharpe".padStart(8) + "   up");
  const show = (key, name) => {
    const rets = books[key].map(x => x.r);
    if (!rets.length) { console.log(name.padEnd(28) + "  no periods"); return; }
    let bal = 1000;
    for (const r of rets) bal *= Math.exp(r);
    // Per-bar path over the same quarters, anchored to the costed period path.
    const barSeries = new Array(times.length).fill(0);
    for (const { k, r } of bars[key]) barSeries[k] = r;
    const subLog = books[key].map(x => rlog[x.i]).concat([rlog[books[key][books[key].length - 1].i + 1]]);
    const yrs = rets.length / ppy;
    console.log(name.padEnd(28) + ("$" + bal.toFixed(2)).padStart(10) +
      (((bal / 1000) ** (1 / yrs) - 1) * 100).toFixed(1).padStart(8) + "%" +
      anchoredDrawdown(rets, barSeries, times, subLog).toFixed(2).padStart(8) + "%" +
      (sharpeOf(rets, ppy) ?? NaN).toFixed(2).padStart(8) + `   ${rets.filter(r => r > 0).length}/${rets.length}`);
  };
  show("momentum", "always momentum (no choice)");
  show("top1", "re-select best each quarter");
  show("top2", "re-select best two");
  const inSampleBest = names.map(n => [n, full[n].finalBalance]).sort((a, b) => b[1] - a[1])[0];
  console.log(`  in-sample best over the whole window: ${inSampleBest[0]} at $${inSampleBest[1]}`);
}
