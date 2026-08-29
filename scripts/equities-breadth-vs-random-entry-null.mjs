/**
 * EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL (additive, read-only research, cache-only — no IBKR
 * egress). `MADIP-RANDOM-ENTRY-CONTROL` built a matched-geometry random-entry null for `ma_dip`
 * alone and found random long entries carrying ma_dip's exact stop/target/breakeven geometry
 * already average +0.1493R on DJIA-30 before any entry-timing skill is credited — ma_dip's real
 * DJIA-30 result sat at the 53rd percentile of that null. That control was scoped to one family.
 * `EQUITIES-ALL-FAMILIES-BASELINE` (2026-08-22, corrected 2026-08-28 by
 * `CROSS-FAMILY-TRADE-OVERLAP-AUDIT`) found 8 of tournament.mjs's 12 families net-positive on
 * DJIA-30 — this project's most-cited positive equities finding, and the main stated reason
 * equities look different from crypto. It has never been read against a geometry-matched null.
 * This item applies `MADIP-RANDOM-ENTRY-CONTROL`'s exact method, unchanged, to all twelve
 * families, plus one extra configuration: the `bos` short-direction leg `BOS-SHORT-EQUITIES-
 * BASELINE` measured (188 trades, -0.4086R net) read against its own matched-geometry short
 * null, to ask whether the long-positive/short-negative asymmetry is a property of the window
 * rather than of either signal.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * UNIVERSE: DJIA-30 only (`research-cache/equities-1d/`, 30 symbols, point-in-time 2024-08-19
 * membership — identical to `equities-all-families-baseline.mjs`/`bos-short-equities-
 * baseline.mjs`). Same 0.70 train/holdout split. Same cost basis: IBKR Fixed $0.005/share
 * commission (per-symbol via holdout avgClose), 5bps/side slippage.
 *
 * FAMILIES: the exact 12-entry `families` array from `tournament.mjs` (lines 6-19), duplicated
 * verbatim per this project's established convention (`equities-all-families-baseline.mjs`),
 * each with its own tpR and its own empirical stop-distance distribution — NOT a shared one
 * (mixing families' geometries would silently turn this into a test of the average stop across
 * families rather than of each family's own entry timing). All twelve use `lockBreakeven: true`
 * with `strategy.js`'s own unmodified BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=0.018 and
 * `backtest.js`'s own MAX_HOLD=100 default — same as `MADIP-RANDOM-ENTRY-CONTROL`.
 *
 * NULL CONSTRUCTION — identical to `MADIP-RANDOM-ENTRY-CONTROL`'s four pre-registered choices
 * (see `scripts/madip-random-entry-control.mjs` header), reused unchanged and applied per
 * family: (1) entry timing random — symbol drawn uniformly from the universe's active symbols
 * (not weighted by real trade count), entry index drawn uniformly from that symbol's own
 * holdout candles, entry price that candle's close; (2) stop distance drawn with replacement
 * from THAT FAMILY's OWN empirical stop-distance distribution; (3) exit management replicating
 * `backtest.js`'s generic path exactly (stop checked first against the bar's low, then the
 * fixed target against the bar's high, then the breakeven arm/lock, then `maxHold`=100,
 * force-close at the last available close if a draw runs past the end of the holdout,
 * disclosed not silently dropped); (4) sample size matches each family's real trade count
 * exactly, verified against a fresh run against the same frozen config and cache, not
 * hand-typed from ROADMAP.md. K=2000 draws per family.
 *
 * MINIMUM SAMPLE FOR A NULL, pre-registered before any family's result is seen: fewer than 10
 * real trades is not a sample a stop-distance distribution or a pooled avgR can be meaningfully
 * built from (`range_sweep_reclaim`=3, `vol_contraction`=0 per `EQUITIES-ALL-FAMILIES-BASELINE`
 * — the "3 trades is not a sample, it is 3 coin flips" framing already on record for
 * `range_sweep_reclaim` there). Those families are reported as too-thin-to-score, not given a
 * percentile that cannot mean anything.
 *
 * DECISION RULE, pre-registered before any draw runs: a family's entry rule is credited with
 * adding information beyond long exposure with matched risk geometry only if its real pooled
 * avgR exceeds the null distribution's 95th percentile — the same one-sided 5% convention
 * `MADIP-RANDOM-ENTRY-CONTROL` used and this project's sign-flip permutation tests use
 * elsewhere. Not moved after seeing results.
 *
 * SHORT LEG (one extra configuration, per this item's task text, not a separate study): `bos`
 * short-direction config exactly as `BOS-SHORT-EQUITIES-BASELINE` pre-registered it —
 * `{ entryMode:"bos", trendGate:false, alignMode:"none", minStopPct:.015, maxStopPct:.06,
 * tpR:4, lockBreakeven:false }`, `direction:"short"`. lockBreakeven is false for this leg only
 * (mechanically required — see that item's header), so no breakeven arm/lock logic applies to
 * the short null. Exit geometry mirrored: stop sits above entry and triggers on the bar's high;
 * target sits below entry and triggers on the bar's low (`backtest.js`'s own short-direction
 * exit order, stop first on a same-bar tie). MIRRORED DECISION RULE for this leg only,
 * pre-registered here before computing it: because the real result is expected to be negative
 * (a window-effect question, not an edge-detection question), the short leg is judged
 * distinguishable from the matched-geometry null only if its real avgR falls BELOW the null
 * distribution's 5th percentile — the mirror image of the 95th-percentile bar used for the long
 * families, same one-sided 5% convention.
 *
 * This is a descriptive null-control study, not a hypothesis test in `MULTIPLE_COMPARISONS_
 * AUDIT.md`'s formal-NHST sense — it does not join that family and triggers no BH-FDR
 * recomputation, per `MADIP-RANDOM-ENTRY-CONTROL`'s own precedent.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const MAX_HOLD = 100; // backtest.js's own default — unmodified
const BE_TRIGGER_R = 2.0; // strategy.js default — unmodified
const BE_LOCK_R = 0.2; // strategy.js default — unmodified
const FEE_BUFFER_PCT = 0.018; // strategy.js default — unmodified

const K_DRAWS = 2000;
const PRE_REGISTERED_PERCENTILE = 0.95;
const MIN_TRADES_FOR_NULL = 10;
const SEED = 20260829; // this project's per-script local-seed convention, today's date

// Verbatim copy of tournament.mjs's `families` array (lines 6-19), same convention as
// equities-all-families-baseline.mjs. Citation columns are EQUITIES-ALL-FAMILIES-BASELINE's
// net trades/avgR (ROADMAP.md 2026-08-22, corrected 2026-08-28), cross-checked below.
const FAMILIES = [
  ["anticipate", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }, { trades: 303, avgR: -0.0438 }],
  ["bos", { entryMode: "bos", trendGate: true, trendGateMode: "ma", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }, { trades: 60, avgR: 0.1728 }],
  ["support", { entryMode: "support", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }, { trades: 407, avgR: 0.0014 }],
  ["ma_dip", { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }, { trades: 475, avgR: 0.1526 }],
  ["rsi", { entryMode: "rsi", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }, { trades: 32, avgR: 0.2507 }],
  ["rev", { entryMode: "rev", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }, { trades: 179, avgR: -0.0501 }],
  ["breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }, { trades: 61, avgR: 0.1866 }],
  ["trend_pullback", { entryMode: "trend_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }, { trades: 38, avgR: -0.2026 }],
  ["sweep_reclaim", { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }, { trades: 92, avgR: 0.0328 }],
  ["range_sweep_reclaim", { entryMode: "range_sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }, { trades: 3, avgR: 0.9656 }],
  ["h3", { entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }, { trades: 106, avgR: 0.1178 }],
  ["vol_contraction", { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }, { trades: 0, avgR: 0 }],
];

// bos short-direction config, verbatim from bos-short-equities-baseline.mjs. Citation is that
// item's own recorded net figures (ROADMAP.md 2026-08-28): short 188 trades -0.4086R, long
// (this exact config, direction:"long") 148 trades +0.1838R.
const BOS_SHORT_CONFIG = { entryMode: "bos", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: false };
const BOS_SHORT_CITATION = { short: { trades: 188, avgR: -0.4086 }, long: { trades: 148, avgR: 0.1838 } };

// Dow 30 membership as of window start (2024-08-19) — identical to equities-all-families-
// baseline.mjs / bos-short-equities-baseline.mjs.
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const CACHE_DIR = path.join(".", "research-cache", "equities-1d");

function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function loadCached(symbol) {
  const file = path.join(CACHE_DIR, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Cache-only, no egress — 30/30 symbols already present (EQUITIES-ALL-FAMILIES-BASELINE,
// BOS-SHORT-EQUITIES-BASELINE). Builds the per-symbol holdout/feeRate maps every family and the
// short leg share; "active symbols" for random draws is every symbol with usable holdout data,
// not weighted by how many real trades any given family produced there (pre-registration #1).
function buildDatasets() {
  const perSymbolHoldout = new Map();
  const perSymbolFeeRate = new Map();
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles || candles.length < 100) { console.error(`SKIP ${symbol}: ${candles ? candles.length : "no cache"} candles`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    perSymbolHoldout.set(symbol, holdout);
    perSymbolFeeRate.set(symbol, COMMISSION_PER_SHARE / avgClose);
  }
  return { perSymbolHoldout, perSymbolFeeRate, activeSymbols: [...perSymbolHoldout.keys()] };
}

// Reruns one family's real signal on cached holdout candles, net of the same IBKR cost basis
// EQUITIES-ALL-FAMILIES-BASELINE used, returning entry/risk alongside r so the empirical
// stop-distance distribution can be built.
function collectRealTrades(config, direction, perSymbolHoldout, perSymbolFeeRate) {
  const trades = [];
  for (const [symbol, holdout] of perSymbolHoldout) {
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...config, direction, entryTf: "1d", feeRate: perSymbolFeeRate.get(symbol), slipPct: SLIPPAGE_PCT_EQUITY });
    for (const exc of r.excursions) trades.push({ symbol, r: exc.r, entry: exc.entry, risk: exc.risk, stopPct: exc.risk / exc.entry });
  }
  return trades;
}

// Replicates backtest.js's generic lockBreakeven/tp/stop/maxHold exit path exactly, for one
// synthetic random entry, either direction. entryIdx is the index of the entry candle within
// `holdout`; entryPrice = holdout[entryIdx].close. stopPct is drawn from the real-trade
// empirical distribution; risk = entryPrice * stopPct (always positive).
function simulateRandomExit(holdout, entryIdx, stopPct, feeRate, slipPct, { tpR, lockBreakeven, direction }) {
  const isShort = direction === "short";
  const entry = Number(holdout[entryIdx].close);
  const risk = entry * stopPct;
  if (!(risk > 0)) return null;
  let stop = isShort ? entry + risk : entry - risk;
  const tp = isShort ? entry - tpR * risk : entry + tpR * risk;
  let beMoved = false;
  const lockOffset = Math.max(BE_LOCK_R * risk, FEE_BUFFER_PCT * entry);
  const armOffset = Math.max(BE_TRIGGER_R * risk, lockOffset + 0.5 * risk);
  const netAt = (px) => (isShort ? (entry - px) / risk : (px - entry) / risk) - ((feeRate + slipPct) * (entry + px)) / risk;

  for (let k = entryIdx + 1; k < holdout.length; k++) {
    const hi = Number(holdout[k].high), lo = Number(holdout[k].low), close = Number(holdout[k].close);
    if (isShort) {
      if (hi >= stop) return { r: netAt(stop), why: "stop" };
      if (lo <= tp) return { r: netAt(tp), why: "target" };
    } else {
      if (lo <= stop) return { r: netAt(stop), why: beMoved ? "trail/be" : "stop" };
      if (hi >= tp) return { r: netAt(tp), why: "target" };
      if (lockBreakeven && !beMoved && hi >= entry + armOffset) { stop = Math.max(stop, entry + lockOffset); beMoved = true; }
    }
    if (k - entryIdx >= MAX_HOLD) return { r: netAt(close), why: "timeout" };
  }
  // Ran off the end of this symbol's holdout data before any exit fired — force-close at the
  // last available close (disclosed data-edge case, not silently dropped).
  const last = Number(holdout[holdout.length - 1].close);
  return { r: netAt(last), why: "dataEnd" };
}

function drawOneNull(activeSymbols, perSymbolHoldout, perSymbolFeeRate, stopPctPool, n, rng, exitOpts) {
  let sum = 0, count = 0, dataEndCount = 0;
  for (let i = 0; i < n; i++) {
    let sim = null;
    for (let attempt = 0; attempt < 10 && !sim; attempt++) {
      const symbol = activeSymbols[Math.floor(rng() * activeSymbols.length)];
      const holdout = perSymbolHoldout.get(symbol);
      if (!holdout || holdout.length < 2) continue;
      const entryIdx = Math.floor(rng() * (holdout.length - 1));
      const stopPct = stopPctPool[Math.floor(rng() * stopPctPool.length)];
      sim = simulateRandomExit(holdout, entryIdx, stopPct, perSymbolFeeRate.get(symbol), SLIPPAGE_PCT_EQUITY, exitOpts);
    }
    if (!sim) continue; // exhausted retries — statistically negligible, not forced
    sum += sim.r;
    count++;
    if (sim.why === "dataEnd") dataEndCount++;
  }
  return { avgR: count ? sum / count : null, count, dataEndCount };
}

function percentileRank(sortedNull, value) {
  let below = 0;
  for (const v of sortedNull) if (v < value) below++; else break;
  return below / sortedNull.length;
}

function buildNullStats(realTrades, activeSymbols, perSymbolHoldout, perSymbolFeeRate, exitOpts, rng) {
  const N = realTrades.length;
  const realAvgR = realTrades.reduce((a, t) => a + t.r, 0) / N;
  const stopPctPool = realTrades.map((t) => t.stopPct);

  const nullDraws = [];
  let totalDataEnd = 0, totalSimTrades = 0;
  for (let d = 0; d < K_DRAWS; d++) {
    const draw = drawOneNull(activeSymbols, perSymbolHoldout, perSymbolFeeRate, stopPctPool, N, rng, exitOpts);
    if (draw.avgR != null) nullDraws.push(draw.avgR);
    totalDataEnd += draw.dataEndCount;
    totalSimTrades += draw.count;
  }
  const nullMean = nullDraws.reduce((a, b) => a + b, 0) / nullDraws.length;
  const nullVariance = nullDraws.reduce((a, b) => a + (b - nullMean) ** 2, 0) / (nullDraws.length - 1);
  const nullSD = Math.sqrt(nullVariance);
  const sortedNull = [...nullDraws].sort((a, b) => a - b);
  const percentile = percentileRank(sortedNull, realAvgR);
  const fractionOfDrawsBeatingReal = sortedNull.filter((v) => v >= realAvgR).length / sortedNull.length;

  return {
    realTrades: N, realAvgR, kDraws: K_DRAWS, nullDrawsUsable: nullDraws.length,
    nullMean, nullSD, sortedNull, percentileOfRealResult: percentile, fractionOfDrawsBeatingReal,
    dataEndFraction: totalSimTrades ? totalDataEnd / totalSimTrades : null,
  };
}

function analyzeLongFamily(id, config, citation, datasets, rng) {
  const { activeSymbols, perSymbolHoldout, perSymbolFeeRate } = datasets;
  const realTrades = collectRealTrades(config, "long", perSymbolHoldout, perSymbolFeeRate);
  const N = realTrades.length;
  const realAvgR = N ? realTrades.reduce((a, t) => a + t.r, 0) / N : 0;
  const citationMatch = { tradesMatch: N === citation.trades, avgRMatch: N > 0 && Math.abs(realAvgR - citation.avgR) < 0.0005 };

  if (N < MIN_TRADES_FOR_NULL) {
    return {
      family: id, realTrades: N, realAvgR, citation, citationMatch,
      tooThinForNull: true,
      note: N === 0 ? "Zero holdout trades on this universe — no stop-distance distribution and no real avgR to build a null against." : `Only ${N} real trades — below this item's pre-registered floor of ${MIN_TRADES_FOR_NULL} for a meaningful stop-distance distribution. Not scored.`,
    };
  }

  const stats = buildNullStats(realTrades, activeSymbols, perSymbolHoldout, perSymbolFeeRate, { tpR: config.tpR, lockBreakeven: config.lockBreakeven, direction: "long" }, rng);
  const thresholdValue = stats.sortedNull[Math.min(stats.sortedNull.length - 1, Math.floor(PRE_REGISTERED_PERCENTILE * stats.sortedNull.length))];
  const passesPreRegisteredThreshold = stats.realAvgR > thresholdValue;
  const { sortedNull, ...rest } = stats;
  return {
    family: id, ...rest, citation, citationMatch,
    tooThinForNull: false,
    preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE,
    thresholdValue, passesPreRegisteredThreshold,
    nullInterpretation: stats.nullMean > 0
      ? "Random long entries with matched risk geometry averaged POSITIVE R in this window — a beta finding about the window itself, stated before any claim about this family's own edge."
      : "Random long entries with matched risk geometry averaged NON-POSITIVE R in this window.",
    verdict: passesPreRegisteredThreshold
      ? "adds information beyond long exposure with matched risk geometry (real result exceeds the pre-registered 95th percentile of the matched-geometry null)"
      : "does NOT demonstrably add information beyond long exposure with matched risk geometry at the pre-registered threshold",
  };
}

function analyzeShortLeg(datasets, rng) {
  const { activeSymbols, perSymbolHoldout, perSymbolFeeRate } = datasets;
  const shortTrades = collectRealTrades(BOS_SHORT_CONFIG, "short", perSymbolHoldout, perSymbolFeeRate);
  const longTrades = collectRealTrades(BOS_SHORT_CONFIG, "long", perSymbolHoldout, perSymbolFeeRate);
  const N = shortTrades.length;
  const realAvgR = N ? shortTrades.reduce((a, t) => a + t.r, 0) / N : 0;
  const NL = longTrades.length;
  const realAvgRLong = NL ? longTrades.reduce((a, t) => a + t.r, 0) / NL : 0;
  const citationMatch = {
    short: { tradesMatch: N === BOS_SHORT_CITATION.short.trades, avgRMatch: Math.abs(realAvgR - BOS_SHORT_CITATION.short.avgR) < 0.0005 },
    long: { tradesMatch: NL === BOS_SHORT_CITATION.long.trades, avgRMatch: Math.abs(realAvgRLong - BOS_SHORT_CITATION.long.avgR) < 0.0005 },
  };

  const stats = buildNullStats(shortTrades, activeSymbols, perSymbolHoldout, perSymbolFeeRate, { tpR: BOS_SHORT_CONFIG.tpR, lockBreakeven: false, direction: "short" }, rng);
  // MIRRORED pre-registered bar (see header): distinguishable from the null only if the real
  // avgR falls BELOW the null's 5th percentile.
  const lowerThresholdValue = stats.sortedNull[Math.max(0, Math.ceil((1 - PRE_REGISTERED_PERCENTILE) * stats.sortedNull.length) - 1)];
  const distinguishableFromNull = stats.realAvgR < lowerThresholdValue;
  const { sortedNull, ...rest } = stats;
  return {
    config: BOS_SHORT_CONFIG, realAvgRLongDirection: realAvgRLong, realTradesLongDirection: NL,
    citationMatch, ...rest,
    preRegisteredLowerPercentileThreshold: 1 - PRE_REGISTERED_PERCENTILE,
    lowerThresholdValue, distinguishableFromNull,
    verdict: distinguishableFromNull
      ? "the short side's real avgR is distinguishably worse than a matched-geometry random short entry in this window — not fully explained by the window effect"
      : "the short side's real avgR is NOT distinguishable from a matched-geometry random short entry in the same window — the long-positive/short-negative asymmetry is consistent with a property of the window rather than of either signal",
  };
}

function main() {
  const rng = seeded(SEED);
  const datasets = buildDatasets();

  const families = {};
  for (const [id, config, citation] of FAMILIES) families[id] = analyzeLongFamily(id, config, citation, datasets, rng);
  const shortLeg = analyzeShortLeg(datasets, rng);

  const scored = Object.values(families).filter((f) => !f.tooThinForNull);
  const passingCount = scored.filter((f) => f.passesPreRegisteredThreshold).length;
  const netPositiveCount = Object.values(families).filter((f) => f.realTrades > 0 && f.realAvgR > 0).length;

  const report = {
    universe: "DJIA-30",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    kDraws: K_DRAWS,
    preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE,
    minTradesForNull: MIN_TRADES_FOR_NULL,
    seed: SEED,
    families,
    shortLeg,
    summary: {
      correctedBreadthClaimFamilyCount: netPositiveCount,
      familiesScored: scored.length,
      familiesTooThinForNull: 12 - scored.length,
      familiesPassingPreRegisteredThreshold: passingCount,
      breadthClaimSurvivesGeometryMatchedNull: passingCount > 0,
    },
  };

  const saved = saveExperiment("equities-breadth-vs-random-entry-null", {
    specification: "equities-breadth-vs-random-entry-null/v1",
    split: SPLIT, commissionPerShare: COMMISSION_PER_SHARE, slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    kDraws: K_DRAWS, preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE, seed: SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
