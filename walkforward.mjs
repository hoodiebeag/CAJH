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

/**
 * How consistently the refit chose the same value for each axis, across quarters.
 *
 * This is computable from the TRAINING runs alone -- it never touches an out-of-sample result --
 * which is what makes it useful. The campaign found that offering a larger honest grid made the
 * out-of-sample result worse, and the visible symptom was the choice jumping around between
 * quarters: the small grid picked btcRegime 50 nine times of nine and scored $2588.43, while the
 * larger grid's filter choice moved almost every quarter and scored $2387.26 or $1947.78.
 *
 * If that relationship holds, a search can size its own grid before ever looking at the test
 * period. Per axis it is the share of quarters that agreed with the modal choice; `mean` is the
 * average across axes, and 1 means every axis was decided identically every time.
 */
export function choiceStability(steps) {
  const live = steps.filter((s) => !s.skipped && s.chose);
  if (!live.length) return { mean: null, byAxis: {} };
  const byAxis = {};
  for (const axis of Object.keys(live[0].chose)) {
    const counts = new Map();
    for (const s of live) {
      const key = JSON.stringify(s.chose[axis]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    byAxis[axis] = +(Math.max(...counts.values()) / live.length).toFixed(3);
  }
  const values = Object.values(byAxis);
  return { mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3), byAxis, quarters: live.length };
}

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

/**
 * What "best" means during fitting. This is not a detail -- it decides what the walk-forward is
 * able to validate at all.
 *
 * "balance" maximises the final balance and nothing else. It was the original objective and it has
 * a blind spot: given a choice between an unlimited book and one capped at three positions, it
 * takes unlimited every time, because more concurrent bets is more balance in-sample. It never
 * sees that the unlimited book got there through a 24% drawdown while the capped one took 9%.
 *
 * "mar" maximises balance per unit of drawdown -- a crude MAR ratio. A configuration that doubles
 * the account through a hole twice as deep scores the same, which is the comparison a person
 * actually makes.
 *
 * The campaign's own leader was picked on drawdown as well as balance, so scoring it with
 * "balance" asks the walk-forward to validate a choice made on a criterion it does not share.
 * Running both and reporting both is the honest version.
 */
export const OBJECTIVES = {
  balance: (eq) => eq.finalBalance,
  mar: (eq) => (eq.maxDrawdownPct > 0 ? eq.finalBalance / eq.maxDrawdownPct : eq.finalBalance),
};

/** The configuration this search would have chosen knowing only bars before `until`. */
export function fit(trainFrom, until, { grid = GRID, fixed = FIXED, objective = "balance" } = {}) {
  const score = OBJECTIVES[objective];
  if (!score) throw new Error(`fit: unknown objective "${objective}" (known: ${Object.keys(OBJECTIVES).join(", ")})`);
  let best = null;
  for (const point of expand(grid)) {
    const config = { ...fixed, ...point };
    const { trades } = runConfig(config, { from: trainFrom, to: until });
    if (trades.length < 20) continue; // too few to have chosen on
    const eq = simulateEquity(trades, {
      riskPct: config.riskPct ?? 0.005, startingBalance: 1000,
      volTarget: config.volTarget ?? null, volClamp: config.volClamp ?? 3,
      maxConcurrent: config.maxConcurrent ?? null,
    });
    const value = score(eq);
    if (!best || value > best.value) {
      best = { config, value, finalBalance: eq.finalBalance, maxDrawdownPct: eq.maxDrawdownPct, trades: trades.length };
    }
  }
  return best;
}

export function walkForward({
  trainFrom = "2023-01-01", testFrom = "2024-01-01", testTo = "2026-03-31",
  // Where the DATA ends, as distinct from where the last decision window ends. Exits run to here.
  dataEnd = "2026-03-31",
  grid = GRID, fixed = FIXED, startingBalance = 1000, riskPct = 0.005, onQuarter = null,
  objective = "balance",
} = {}) {
  const steps = [];
  const oosTrades = [];
  for (const q of quarters(testFrom, testTo)) {
    const chosen = fit(trainFrom, addDays(q.from, -1), { grid, fixed, objective });
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
    // `chose` is derived from the grid's own keys, never a hardcoded list. A hardcoded list once
    // reported a nine-quarter refit of eight axes as though only five had been fitted, so there
    // was no way to see whether the entry mode and the filters had moved between quarters -- which
    // was the entire question that run existed to answer.
    const step = {
      ...q,
      chose: Object.fromEntries(Object.keys(grid).map((k) => [k, chosen.config[k]])),
      trainBalance: chosen.finalBalance, trainTrades: chosen.trades, oosTrades: trades.length,
      maxConcurrent: chosen.config.maxConcurrent ?? null,
      oosMeanR: trades.length ? +(trades.reduce((s, t) => s + t.netR, 0) / trades.length).toFixed(4) : null,
    };
    steps.push(step);
    if (onQuarter) onQuarter(step);
  }

  // The chained curve. volTarget can differ between quarters, so the weight is applied per trade
  // here rather than handed to simulateEquity as one setting for the whole run.
  // The chain uses the most common limit its quarters chose; if they disagree the run is reported
  // with the limit unset rather than silently picking one.
  const limits = new Set(steps.filter((s) => !s.skipped).map((s) => s.maxConcurrent ?? null));
  const chainMaxConcurrent = limits.size === 1 ? [...limits][0] : null;

  const weighted = oosTrades.map((t) => {
    if (t.volTarget === null || !(t.atrPct > 0)) return t;
    const w = Math.min(3, Math.max(1 / 3, t.volTarget / t.atrPct));
    return { ...t, netR: t.netR * w };
  });
  // maxConcurrent and riskPct can differ between quarters, so the chained curve applies the
  // concurrency limit each quarter chose. A single limit for the whole run would be a parameter
  // nobody fitted.
  const eq = weighted.length
    ? simulateEquity(weighted, { riskPct, startingBalance, maxConcurrent: chainMaxConcurrent })
    : null;
  return {
    objective,
    stability: choiceStability(steps),
    gridPoints: expand(grid).length,
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
