/**
 * walkforward.mjs -- the only out-of-sample evidence this campaign can still produce.
 *
 * Every balance in campaign-log.jsonl is the best of thousands of configurations scored on the
 * data used to pick them. The owner directed that the full period be used and declined a sealed
 * holdout, and that stands. But a walk-forward is not a holdout: it uses every bar, and it asks a
 * different question -- would the configuration this search WOULD HAVE CHOSEN, knowing only what
 * was knowable at the time, have worked in the quarter that followed?
 *
 * Each quarter is scored by parameters fitted only on bars that closed before it began. The
 * quarters are then chained into one equity curve. No parameter in that curve ever saw the period
 * it is being judged on. That is a weaker claim than a true holdout -- the grid itself was designed
 * with hindsight, and the universe was chosen after seeing all of it -- and the file says so rather
 * than letting the number carry an implication it has not earned.
 *
 * The honest failure mode to watch for: if the refit picks a wildly different configuration each
 * quarter, the search is fitting noise, and that shows up here as chosen parameters that jump
 * around. The chosen config is recorded for every quarter so that is visible rather than hidden
 * behind a single final balance.
 */

import { runConfig } from "./campaign.mjs";
import { simulateEquity } from "./equity.mjs";
import { expand } from "./sweep.mjs";
import { benchmarks } from "./benchmark.mjs";
import { pathToFileURL } from "url";

/** Held fixed across the walk-forward: the structural choices, not the fitted numbers. */
export const FIXED = {
  entryMode: "breakout", alignMode: "none", lockBreakeven: true, tpR: 100,
  maxStopPct: 0.20, trendGate: true, trendGateMode: "ma", beLockR: 0.2,
  entryDelayBars: 1, volClamp: 3,
  filters: { crossSection: { lookback: 120, topN: 20 }, atrPctBand: { period: 14, min: 0.03, max: 1 } },
};

/** Refitted every quarter. Deliberately small -- a grid this search can plausibly have chosen. */
export const GRID = {
  trendMa: [100, 150, 200, 250],
  minStopPct: [0.03, 0.05, 0.08],
  beTriggerR: [2, 2.5, 3],
  maxHold: [50, 100, 200],
  volTarget: [null, 0.05],
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + "T00:00:00Z") + n * 86400000));

/** Calendar quarters from `start` up to (not past) `end`. */
export function quarters(start, end) {
  const out = [];
  let y = Number(start.slice(0, 4)), q = Math.floor((Number(start.slice(5, 7)) - 1) / 3);
  for (;;) {
    const from = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    const nextY = q === 3 ? y + 1 : y, nextQ = (q + 1) % 4;
    const to = addDays(`${nextY}-${String(nextQ * 3 + 1).padStart(2, "0")}-01`, -1);
    if (from > end) break;
    out.push({ from, to: to > end ? end : to });
    y = nextY; q = nextQ;
  }
  return out;
}

/** The configuration this search would have chosen knowing only bars before `until`. */
export function fit(trainFrom, until, { grid = GRID, fixed = FIXED } = {}) {
  let best = null;
  for (const point of expand(grid)) {
    const config = { ...fixed, ...point };
    const { trades } = runConfig(config, { from: trainFrom, to: until });
    if (trades.length < 20) continue; // too few to have chosen on
    const eq = simulateEquity(trades, {
      riskPct: 0.005, startingBalance: 1000,
      volTarget: config.volTarget ?? null, volClamp: config.volClamp ?? 3,
    });
    if (!best || eq.finalBalance > best.finalBalance) best = { config, finalBalance: eq.finalBalance, trades: trades.length };
  }
  return best;
}

export function walkForward({
  trainFrom = "2023-01-01", testFrom = "2024-01-01", testTo = "2026-03-31",
  // Where the DATA ends, as distinct from where the last decision window ends. Exits run to here.
  dataEnd = "2026-03-31",
  grid = GRID, fixed = FIXED, startingBalance = 1000, riskPct = 0.005, onQuarter = null,
} = {}) {
  const steps = [];
  const oosTrades = [];
  for (const q of quarters(testFrom, testTo)) {
    const chosen = fit(trainFrom, addDays(q.from, -1), { grid, fixed });
    if (!chosen) { steps.push({ ...q, skipped: "no configuration had enough training trades" }); continue; }
    // Two boundaries that are easy to conflate and must not be.
    //
    // The DECISION boundary is the quarter: `chosen` was fitted on bars that closed before it, and
    // only entries inside the quarter are counted. That is what makes this out-of-sample.
    //
    // The DATA boundary is the end of the series, not the end of the quarter. Truncating the run at
    // the quarter end would cut every position still open when the quarter closed -- and with holds
    // of 50 to 200 bars that is most of them. The first version did exactly that and reported
    // -0.42R out of sample, while every one of those same configurations held fixed over the same
    // window scored between +0.74R and +1.85R. The strategy had not failed; the harness had
    // amputated the holds that carry its return. Letting a trade run its course after entry is not
    // lookahead: its exit rule was fixed the moment it was entered.
    //
    // (Indicators need the history before the quarter too -- a 90-bar slice cannot carry a 150-bar
    // moving average, and runConfig skips any pair under 120 bars, which made an even earlier
    // version return zero trades in all nine quarters.)
    const from = Date.parse(q.from + "T00:00:00Z"), to = Date.parse(q.to + "T23:59:59Z");
    const { trades: all } = runConfig(chosen.config, { from: trainFrom, to: dataEnd });
    const trades = all.filter((t) => t.entryTime >= from && t.entryTime <= to);
    for (const t of trades) oosTrades.push({ ...t, quarter: q.from, volTarget: chosen.config.volTarget ?? null });
    const step = {
      ...q,
      chose: { trendMa: chosen.config.trendMa, minStopPct: chosen.config.minStopPct,
               beTriggerR: chosen.config.beTriggerR, maxHold: chosen.config.maxHold, volTarget: chosen.config.volTarget },
      trainBalance: chosen.finalBalance, trainTrades: chosen.trades, oosTrades: trades.length,
      oosMeanR: trades.length ? +(trades.reduce((s, t) => s + t.netR, 0) / trades.length).toFixed(4) : null,
    };
    steps.push(step);
    if (onQuarter) onQuarter(step);
  }

  // The chained curve. volTarget can differ between quarters, so the weight is applied per trade
  // here rather than handed to simulateEquity as one setting for the whole run.
  const weighted = oosTrades.map((t) => {
    if (t.volTarget === null || !(t.atrPct > 0)) return t;
    const w = Math.min(3, Math.max(1 / 3, t.volTarget / t.atrPct));
    return { ...t, netR: t.netR * w };
  });
  const eq = weighted.length ? simulateEquity(weighted, { riskPct, startingBalance }) : null;
  return {
    steps, trades: oosTrades.length,
    finalBalance: eq ? +eq.finalBalance.toFixed(2) : startingBalance,
    maxDrawdownPct: eq ? +eq.maxDrawdownPct.toFixed(2) : 0,
    meanR: oosTrades.length ? +(oosTrades.reduce((s, t) => s + t.netR, 0) / oosTrades.length).toFixed(4) : null,
    window: { testFrom, testTo },
  };
}

function main() {
  const t0 = Date.now();
  console.log("fitting each quarter on bars that closed before it began...\n");
  const r = walkForward({
    onQuarter: (s) => console.log(
      `${s.from}  chose ${JSON.stringify(s.chose)}  train $${s.trainBalance.toFixed(0)} (${s.trainTrades})  -> OOS ${String(s.oosTrades).padStart(3)} trades, mean ${s.oosMeanR}R`),
  });
  const b = benchmarks({ from: r.window.testFrom, to: r.window.testTo });
  console.log(`\nchained out-of-sample: ${r.trades} trades, mean ${r.meanR}R, $${r.finalBalance}, maxDD ${r.maxDrawdownPct}%`);
  console.log(`same window, no strategy: BTC $${b.btc} at ${b.btcMaxDrawdownPct}% DD, equal-weight basket $${b.basket}`);
  console.log(`(${Math.round((Date.now() - t0) / 1000)}s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
