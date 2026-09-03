/**
 * entrynull-run.mjs -- run the matched-geometry random-entry null against named configurations.
 *
 *   node entrynull-run.mjs
 *
 * Edit LEADERS to whatever the current leaderboard says. The point of running this after every
 * few sweeps is that the campaign's search rewards any change that raises the balance, and the
 * cheapest way to raise a long-only balance in a rising market is to hold longer -- which the
 * search will find and present as an improvement. This says how much of the balance survives
 * when the entry rule is replaced by a coin flip and everything else is held identical.
 *
 * The power line is not decoration. A 100R target produces winners of +20R and losers of -1R, so
 * the null's spread is enormous and the test can only see large effects. Reporting p without the
 * minimum detectable effect would let "p = 0.33" be read as "no edge" when it means "no edge this
 * test could have seen".
 */

import { slice, SPLIT } from "./campaign.mjs";
import { availablePairs } from "./bundle-loader.mjs";
import { backtestMultiTF } from "./backtest.js";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";
import { matchedGeometryNull } from "./inference.mjs";
import { randomEntryDrawer } from "./entrynull.mjs";
import { simulateEquity } from "./equity.mjs";
import { zFor } from "./power.mjs";
import { benchmarks, benchmarkLine } from "./benchmark.mjs";
import { pathToFileURL } from "url";

export const BASE = { trendGate: false, alignMode: "none", maxStopPct: 0.20, lockBreakeven: true };

export const LEADERS = [
  { name: "bos 5% tpR100 hold100",      cfg: { entryMode: "bos",      minStopPct: 0.05, tpR: 100, maxHold: 100 } },
  { name: "breakout 5% tpR100 hold400", cfg: { entryMode: "breakout", minStopPct: 0.05, tpR: 100, maxHold: 400 } },
  { name: "breakout 5% tpR4 hold100",   cfg: { entryMode: "breakout", minStopPct: 0.05, tpR: 4,   maxHold: 100 } },
];

/** The same slices runConfig uses, kept once so the null draws from the strategy's own universe. */
export function loadUniverse({ minutes = 1440, from = SPLIT.trainStart, to = SPLIT.trainEnd, minBars = 120 } = {}) {
  const out = {};
  for (const pair of availablePairs(minutes)) {
    const candles = slice(pair, minutes, from, to);
    if (candles.length >= minBars) out[pair] = candles;
  }
  return out;
}

/** Observed trades for one configuration, carrying the geometry the null has to match. */
export function observe(config, seriesByPair, { minutes = 1440 } = {}) {
  const observed = [];
  for (const [pair, candles] of Object.entries(seriesByPair)) {
    const r = backtestMultiTF({ series: [{ label: String(minutes), mins: minutes, candles }] },
      { ...config, entryTf: String(minutes), feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT });
    for (const x of r.excursions) {
      if (!Number.isFinite(x.entryTime)) continue;
      observed.push({ symbol: pair, stopPct: x.risk / x.entry, netR: x.r, barsHeld: x.barsHeld, entryTime: x.entryTime });
    }
  }
  return observed;
}

export function runOne({ name, cfg }, seriesByPair, { k = 2000, seed = 20260903, riskPct = 0.005, startingBalance = 1000 } = {}) {
  const config = { ...BASE, ...cfg };
  const observed = observe(config, seriesByPair);
  if (!observed.length) return { name, config, trades: 0, empty: true };

  const meanR = observed.reduce((s, t) => s + t.netR, 0) / observed.length;
  const eq = simulateEquity(observed.map((t) => ({ netR: t.netR, entryTime: t.entryTime * 1000, symbol: t.symbol })),
    { riskPct, startingBalance });

  const drawTrade = randomEntryDrawer({
    observed, seriesByPair,
    exit: { tpR: config.tpR, maxHold: config.maxHold ?? 100, lockBreakeven: config.lockBreakeven !== false,
            feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT },
  });
  const nul = matchedGeometryNull({ observedMean: meanR, n: observed.length, drawTrade, k, seed });

  // nul.nullSD is the spread of the null MEAN across draws -- already a standard error, so the
  // minimum detectable effect is z * SE, not z * sd / sqrt(n).
  const mde = zFor(0.05, 0.80) * nul.nullSD;

  return {
    name, config,
    trades: observed.length,
    observedMeanR: +meanR.toFixed(4),
    finalBalance: +eq.finalBalance.toFixed(2),
    meanStopPct: +(observed.reduce((s, t) => s + t.stopPct, 0) / observed.length).toFixed(4),
    meanHoldBars: +(observed.reduce((s, t) => s + t.barsHeld, 0) / observed.length).toFixed(1),
    nullMeanR: +nul.nullMean.toFixed(4),
    nullSE: +nul.nullSD.toFixed(4),
    excessR: +nul.excessOverNull.toFixed(4),
    p: +nul.p.toFixed(4),
    z: nul.z === null ? null : +nul.z.toFixed(2),
    minimumDetectableEffectR: +mde.toFixed(4),
    detectable: Math.abs(nul.excessOverNull) >= mde,
    nullBalance: +(startingBalance * Math.pow(1 + riskPct * nul.nullMean, observed.length)).toFixed(2),
    usableDrawFraction: nul.usableDrawFraction,
    k, seed,
  };
}

export function main() {
  const seriesByPair = loadUniverse();
  const b = benchmarks({ from: SPLIT.trainStart, to: SPLIT.trainEnd });
  for (const leader of LEADERS) {
    const r = runOne(leader, seriesByPair);
    if (r.empty) { console.log(`\n=== ${r.name} ===\nno trades`); continue; }
    console.log(`\n=== ${r.name} ===`);
    console.log(`observed  ${r.trades} trades, mean ${r.observedMeanR}R, final $${r.finalBalance}`);
    console.log(`geometry  mean stop ${(r.meanStopPct * 100).toFixed(2)}%, mean hold ${r.meanHoldBars} bars`);
    console.log(`null      mean ${r.nullMeanR}R (SE ${r.nullSE}), excess ${r.excessR}R, p=${r.p}, z=${r.z}`);
    console.log(`power     smallest excess this test could see at 80%: ${r.minimumDetectableEffectR}R` +
                ` -- observed excess is ${r.detectable ? "above" : "below"} it`);
    console.log(`a random-entry account with the same geometry ends near $${r.nullBalance}`);
  }
  console.log(`\n${benchmarkLine(b)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
