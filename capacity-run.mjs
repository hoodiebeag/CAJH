// What size can this book absorb, and what does it hold right now?
//
// Everything measured so far assumes a fill at the close for any size. That is fine for deciding
// whether an edge exists and useless for deciding whether it can be traded. A book holding 12
// names a side puts 1/24th of the account into each position, and the binding constraint is the
// LEAST liquid name it selects, not the average one.
//
// The cost stress already showed the edge survives ~80x the assumed 5bp of slippage. This asks the
// other half of the same question: at what account size does the assumed slippage stop being a
// reasonable model at all, because the order is a material share of the day's volume?
// Usage: node capacity-run.mjs [topK]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { spread } from "./xsmom.mjs";
import { testSignal } from "./factors.mjs";

const TOPK = Number(process.argv[2] ?? 12);
const SLIP = 0.0005, BORROW = 0.05;
const sec = d => Date.parse(d + "T00:00:00Z") / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

const series = {};
for (const p of availablePairs(1440, "./sp500-bundle")) {
  const c = loadBundleCandles(p, 1440, "./sp500-bundle")
    .filter(b => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
  if (c.length >= 400) series[p] = c;
}

// Median daily dollar volume over the 63 bars ending at `at`. Contemporaneous, not current: a name
// the book held in 2024 has to be sized against the liquidity it had in 2024. Using today's volume
// instead reported PARA at $0.4M/day because it has since collapsed to a $1 stock, which says
// nothing about whether the position was executable when it was actually taken.
// Median rather than mean, because one earnings day doubles a mean and flatters the estimate.
const medianDollarVolume = (sym, at = Infinity, lookback = 63) => {
  const bars = series[sym].filter(b => Number(b.time) <= at).slice(-lookback);
  const dv = bars.map(b => Number(b.close) * Number(b.volume)).filter(v => v > 0).sort((a, b) => a - b);
  return dv.length ? dv[Math.floor(dv.length / 2)] : null;
};

const CANON = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: TOPK, slipPct: SLIP };
const mom = spread(series, CANON, { borrow: BORROW });
const idio = testSignal("idioVol", series, { topK: TOPK, slipPct: SLIP, borrow: BORROW, draws: 1 });

// --- what the book holds at its most recent rebalance
const lastOf = (rot) => rot.rebalanceLog[rot.rebalanceLog.length - 1];
console.log(`Universe ${Object.keys(series).length} symbols, ${TOPK} a side, so ${2 * TOPK} positions per sleeve.\n`);
for (const [name, top, bot] of [["momentum", mom.top, mom.bot], ["idioVol", idio.top, idio.bot]]) {
  const L = lastOf(top), S = lastOf(bot);
  console.log(`=== ${name}: holdings as of ${iso(L.at)} ===`);
  console.log(`  LONG : ${L.chosen.join(" ")}`);
  console.log(`  SHORT: ${S.chosen.join(" ")}`);
}

// --- capacity, driven by the least liquid name the book has ever selected
console.log(`\n=== capacity: each position is 1/${2 * TOPK} of the account ===`);
console.log("Median daily dollar volume over the last 63 bars. The binding name is the least liquid");
console.log("one the book SELECTS, not the least liquid one in the universe.\n");

for (const [name, top, bot] of [["momentum", mom.top, mom.bot], ["idioVol", idio.top, idio.bot]]) {
  // Every (name, date) the book actually held, each priced against its liquidity ON THAT DATE.
  const holdings = [];
  for (const log of [top.rebalanceLog, bot.rebalanceLog]) {
    for (const r of log) for (const s of r.chosen) {
      const dv = medianDollarVolume(s, r.at);
      if (dv > 0) holdings.push([s, r.at, dv]);
    }
  }
  const everHeld = new Set(holdings.map(h => h[0]));
  const liquidity = [...holdings].sort((a, b) => a[2] - b[2]);
  const [thinnestSym, thinnestAt, thinnestDV] = liquidity[0];
  const medianDV = liquidity[Math.floor(liquidity.length / 2)][2];
  const fmt = v => v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`;

  console.log(`${name}: ${everHeld.size} distinct names, ${holdings.length} name-periods held`);
  console.log(`  thinnest AS HELD: ${thinnestSym} on ${iso(thinnestAt)} at ${fmt(thinnestDV)}/day;  ` +
    `median holding ${fmt(medianDV)}/day`);
  console.log("  account".padEnd(14) + "position".padStart(12) + "% of thinnest ADV".padStart(20) + "  verdict");
  for (const acct of [1e4, 1e5, 1e6, 1e7, 1e8]) {
    const pos = acct / (2 * TOPK);
    const share = 100 * pos / thinnestDV;
    const verdict = share < 0.5 ? "fine" : share < 2 ? "watch" : share < 10 ? "slippage exceeds the model" : "not executable";
    console.log("  " + `$${(acct / 1e6).toFixed(acct < 1e6 ? 3 : 0)}M`.padEnd(12) +
      fmt(pos).padStart(12) + `${share.toFixed(share < 1 ? 3 : 1)}%`.padStart(20) + "  " + verdict);
  }
  // The account size at which the thinnest position reaches 1% of that name's daily volume.
  console.log(`  1% of the thinnest name's daily volume is reached at an account of ` +
    `${fmt(0.01 * thinnestDV * 2 * TOPK)}\n`);
}
console.log("A percentage of ADV is a rule of thumb, not a fill model. It says where the 5bp");
console.log("assumption stops being defensible, not what the real cost would be beyond that point.");
