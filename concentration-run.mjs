// How many names a side should the equities book hold?
//
// While this was half of a blended desk, topK was a parameter. As the whole live book it is a risk
// decision: too few names and the result is a handful of idiosyncratic bets that the disjoint-halves
// screen already showed can swing 2.5x on an arbitrary split; too many and the ranking dilutes
// toward the basket, which returns 6.4%.
//
// The whole ladder is reported and nothing is picked from it. 12-13 of 128 is the canonical decile
// and stays the pre-registered choice whatever this shows -- the point is to see whether the edge
// is a cliff or a plateau, because a cliff would mean the result depends on a concentration the
// account may not be able to hold.
// Usage: node concentration-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { testSignal } from "./factors.mjs";
import { ledger, summarise } from "./trades.mjs";
import { bookStats, blend, correlation } from "./portfolio.mjs";

const DRAWS = Number(process.argv[2] ?? 400);
const SLIP = 0.0005, BORROW = 0.05;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;

const series = {};
for (const p of availablePairs(1440, "./sp500-bundle")) {
  const c = loadBundleCandles(p, 1440, "./sp500-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}
const N = Object.keys(series).length;
console.log(`sp500 universe: ${N} symbols. Each rung holds topK a side, so 2*topK names in total.\n`);

const head = "topK".padEnd(7) + "% of univ".padStart(10) + "final$".padStart(10) + "CAGR".padStart(8) +
  "maxDD".padStart(9) + "Sharpe".padStart(8) + "p".padStart(9) + "trades/mo".padStart(11) + "  win%";
const CANON = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, slipPct: SLIP };

for (const [label, build] of [
  ["momentum", (topK) => {
    const s = spread(series, { ...CANON, topK }, { borrow: BORROW });
    return { returns: s.returns, dd: s.maxDrawdownPct, final: s.finalBalance, ppy: s.periodsPerYear,
             top: s.top, bot: s.bot, opts: { ...CANON, topK } };
  }],
  ["idioVol", (topK) => {
    const r = testSignal("idioVol", series, { topK, slipPct: SLIP, borrow: BORROW, draws: 1 });
    return { returns: r.returns, dd: r.maxDrawdownPct, final: r.finalBalance, ppy: r.periodsPerYear,
             top: r.top, bot: r.bot, opts: { ...CANON, topK } };
  }],
]) {
  console.log(`=== ${label} ===`);
  console.log(head);
  for (const topK of [3, 6, 12, 20, 32, 48]) {
    if (topK * 2 > N) continue;
    const b = build(topK);
    const p = selectionP(randomSpreadNull(series, b.opts, { draws: DRAWS, borrow: BORROW }), b.final);
    const st = bookStats(b.returns, { periodsPerYear: b.ppy });
    const years = b.returns.length / b.ppy;
    const q = summarise([...ledger(b.top, +1).closed, ...ledger(b.bot, -1).closed], years,
                        { roundTripPct: 100 * 2 * SLIP });
    console.log(String(topK).padEnd(7) + `${(100 * topK / N).toFixed(1)}%`.padStart(10) +
      ("$" + b.final.toFixed(2)).padStart(10) + st.cagrPct.toFixed(1).padStart(7) + "%" +
      b.dd.toFixed(2).padStart(8) + "%" + (st.sharpe ?? NaN).toFixed(2).padStart(8) +
      p.toFixed(4).padStart(9) + String(q.tradesPerMonth).padStart(11) + q.winRatePct.toFixed(1).padStart(7));
  }
  console.log();
}

// The pair at the canonical width, for the row the recommendation actually refers to.
{
  const m = spread(series, { ...CANON, topK: 12 }, { borrow: BORROW });
  const i = testSignal("idioVol", series, { topK: 12, slipPct: SLIP, borrow: BORROW, draws: 1 });
  const n = Math.min(m.returns.length, i.returns.length);
  const pairs = m.returns.slice(0, n).map((a, k) => ({ a, b: i.returns[k] }));
  const st = bookStats(blend(pairs, 0.5), { periodsPerYear: m.periodsPerYear });
  console.log(`=== the pair at topK 12, for reference ===`);
  console.log(`momentum against idioVol correlation ${correlation(pairs.map(p => p.a), pairs.map(p => p.b)).toFixed(3)}`);
  console.log(`50/50: $${st.final.toFixed(2)}  ${st.cagrPct.toFixed(1)}%  Sharpe ${st.sharpe.toFixed(2)}  ${st.upPeriods}/${st.periods}`);
}
