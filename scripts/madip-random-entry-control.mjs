/**
 * MADIP-RANDOM-ENTRY-CONTROL (additive, read-only research, cache-only — no IBKR egress).
 *
 * `ma_dip` is this project's only equities candidate that has ever cleared conditions 1 and 3
 * together (`ALPHA_DEFINITION.md` section 4b), on DJIA-30 (475 trades, avgR +0.1526) and DJTA-20
 * (300 trades, avgR +0.2994, `EQUITIES-MADIP-OUT-OF-SAMPLE`). Nothing in this project has ever
 * asked whether that edge is attributable to the entry rule (buy a ≥2%-below-20MA dip) or is
 * simply long exposure with matched risk geometry in a window that happened to be favourable —
 * the exact question `LOG-REGRESSION-BANDS-CRYPTO` had to answer for its own outperformance
 * figure (23 of 24 assets there had negative buy-and-hold, disclosed before the headline number
 * meant anything). This item builds that null for `ma_dip`, on both equity universes separately.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * CONFIG FROZEN: `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0,
 * maxStopPct: .06, tpR: 5, lockBreakeven: true }` — verbatim from `EQUITIES-MADIP-SIGNIFICANCE` /
 * `EQUITIES-MADIP-OUT-OF-SAMPLE` / `MADIP-SURVIVABILITY-CONDITION-5`. Same two universes, same
 * caches, cache-only: DJIA-30 (`research-cache/equities-1d/`, 475 real trades) and DJTA-20
 * (point-in-time, zero ticker overlap, `research-cache/equities-1d-djta-oos/`, 300 real trades).
 * Same cost basis: IBKR Fixed $0.005/share commission (converted per-symbol via holdout
 * avgClose), 5bps/side slippage, 70/30 split. Reported SEPARATELY per universe, never pooled.
 *
 * NULL CONSTRUCTION — the whole study is in these four choices, fixed before any return is
 * computed:
 *   1. ENTRY TIMING is random: for each synthetic trade, draw a symbol UNIFORMLY from the
 *      universe's active symbols (not weighted by how many real trades that symbol produced —
 *      a random entry rule has no reason to prefer symbols ma_dip happened to trigger on more
 *      often) and an entry index UNIFORMLY from that symbol's own holdout candles (same 70/30
 *      split, same calendar coverage the real trades were drawn from), leaving at least one
 *      candle after it to walk forward. Entry price is that candle's close, matching ma_dip's
 *      own `entry = C[k]` convention exactly.
 *   2. STOP DISTANCE is drawn from the EMPIRICAL DISTRIBUTION of the real trades' own stop
 *      distances (risk/entry, as a fraction of entry price), sampled with replacement, per
 *      universe. A random entry point has no dip to place a structural stop under — using
 *      ma_dip's structural placement here would silently turn this into a test of stop
 *      placement rather than of entry timing, which is exactly what this item's own task text
 *      warns against.
 *   3. EXIT MANAGEMENT is `backtest.js`'s own generic position-management path, replicated here
 *      byte-for-byte for the lockBreakeven-only, no-partial, no-trailing case ma_dip's frozen
 *      config actually uses: stop checked first (against the bar's low, as the stop stood
 *      entering that candle), then the fixed target (tpR=5, bar's high), then the breakeven
 *      arm/lock (`strategy.js`'s own BE_TRIGGER_R=2.0 / BE_LOCK_R=0.2 / FEE_BUFFER_PCT=0.018,
 *      unmodified — `EQUITIES-MADIP-SIGNIFICANCE` and this family's other scripts never override
 *      these either), then `maxHold`=100 bars (backtest.js's own MAX_HOLD default, unmodified —
 *      "Apply ma_dip's own tpR, lockBreakeven and maxHold unchanged" per this item's task text).
 *      Net R uses backtest.js's own fee/slippage formula verbatim: (px-entry)/risk -
 *      (feeRate+slipPct)*(entry+px)/risk. If a draw runs past the end of that symbol's holdout
 *      candles without hitting stop, target, or maxHold, it is force-closed at the last
 *      available close (disclosed, not silently dropped) — this is a data-edge case, not a
 *      discretionary choice, and its frequency is reported.
 *   4. SAMPLE SIZE matches the real trade count EXACTLY per universe (475, 300) — verified
 *      against a fresh `collectTrades` run against the same frozen config and caches, not
 *      hand-typed from ROADMAP.md.
 * K=2000 draws per universe (>=1000 required by this item's task text). Each draw pools its
 * synthetic trades' avgR exactly as the real result was pooled (arithmetic mean of per-trade
 * net R), building a null distribution of DRAW-LEVEL pooled avgR, not of individual-trade R.
 *
 * DECISION RULE, pre-registered before any draw runs: `ma_dip`'s entry rule is credited with
 * adding information beyond long exposure with matched risk geometry only if its real pooled
 * avgR exceeds the null distribution's 95th percentile (i.e. no more than 5% of random-entry
 * draws, matched on symbol/calendar/stop-geometry/trade-count, beat it) — the same one-sided
 * 5% convention this project's sign-flip permutation tests use elsewhere. This threshold is not
 * moved after seeing the result.
 *
 * This is a descriptive null-control study, not a hypothesis test in `MULTIPLE_COMPARISONS_
 * AUDIT.md`'s formal-NHST sense (the "null" is a resampling control, not a p-value against a
 * theoretical distribution) — it does not join that family and triggers no BH-FDR recomputation.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

const TP_R = 5;
const MAX_HOLD = 100; // backtest.js's own default — unmodified, see pre-registration
const BE_TRIGGER_R = 2.0; // strategy.js default — unmodified
const BE_LOCK_R = 0.2; // strategy.js default — unmodified
const FEE_BUFFER_PCT = 0.018; // strategy.js default — unmodified

const K_DRAWS = 2000;
const PRE_REGISTERED_PERCENTILE = 0.95;
const SEED = 20260828; // this project's per-script local-seed convention, today's date

const UNIVERSES = {
  "DJIA-30": {
    cacheDir: path.join(".", "research-cache", "equities-1d"),
    symbols: [
      "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
      "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
      "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
    ],
    realAvgRCited: 0.1526, // ROADMAP_ARCHIVE.md 2026-08-22, cross-checked against a fresh run below
  },
  "DJTA-20": {
    cacheDir: path.join(".", "research-cache", "equities-1d-djta-oos"),
    symbols: [
      "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
      "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
    ],
    realAvgRCited: 0.2994, // ROADMAP_ARCHIVE.md 2026-08-22, cross-checked against a fresh run below
  },
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function loadCached(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Reruns the real ma_dip signal on cached holdout candles, returning entry/risk alongside r so
// the empirical stop-distance distribution can be built (madip-survivability-condition-5.mjs's
// collectTrades captures entryTime/exitTime but not entry/risk — needed here for #2 above).
function collectRealTrades(cacheDir, symbols) {
  const trades = [];
  const perSymbolHoldout = new Map(); // symbol -> holdout candles, reused below for random draws
  const perSymbolFeeRate = new Map();
  for (const symbol of symbols) {
    const candles = loadCached(cacheDir, symbol);
    if (!candles) { console.error(`MISSING CACHE: ${symbol}`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    perSymbolHoldout.set(symbol, holdout);
    perSymbolFeeRate.set(symbol, feeRate);
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    for (const exc of r.excursions) {
      trades.push({ symbol, r: exc.r, entry: exc.entry, risk: exc.risk, stopPct: exc.risk / exc.entry });
    }
  }
  return { trades, perSymbolHoldout, perSymbolFeeRate };
}

// Replicates backtest.js's generic lockBreakeven/tp/stop/maxHold exit path exactly (see
// pre-registration #3) for one synthetic random entry. entryIdx is the index of the entry
// candle within `holdout`; entryPrice = holdout[entryIdx].close (matches ma_dip's own
// entry = C[k]). stopPct is drawn from the real-trade empirical distribution; stop =
// entryPrice * (1 - stopPct), mirroring ma_dip's stop being strictly below entry.
function simulateRandomExit(holdout, entryIdx, stopPct, feeRate, slipPct) {
  const entry = Number(holdout[entryIdx].close);
  const risk = entry * stopPct;
  if (!(risk > 0)) return null;
  let stop = entry - risk;
  const tp = entry + TP_R * risk;
  let beMoved = false;
  const lockOffset = Math.max(BE_LOCK_R * risk, FEE_BUFFER_PCT * entry);
  const armOffset = Math.max(BE_TRIGGER_R * risk, lockOffset + 0.5 * risk);
  const netAt = (px) => (px - entry) / risk - ((feeRate + slipPct) * (entry + px)) / risk;

  for (let k = entryIdx + 1; k < holdout.length; k++) {
    const hi = Number(holdout[k].high), lo = Number(holdout[k].low), close = Number(holdout[k].close);
    if (lo <= stop) return { r: netAt(stop), why: beMoved ? "trail/be" : "stop" };
    if (hi >= tp) return { r: netAt(tp), why: "target" };
    if (!beMoved && hi >= entry + armOffset) { stop = Math.max(stop, entry + lockOffset); beMoved = true; }
    if (k - entryIdx >= MAX_HOLD) return { r: netAt(close), why: "timeout" };
  }
  // Ran off the end of this symbol's holdout data before any exit fired — force-close at the
  // last available close (disclosed data-edge case, see pre-registration #3).
  const last = Number(holdout[holdout.length - 1].close);
  return { r: netAt(last), why: "dataEnd" };
}

function drawOneNull(symbols, perSymbolHoldout, perSymbolFeeRate, stopPctPool, n, rng) {
  let sum = 0, count = 0, dataEndCount = 0;
  for (let i = 0; i < n; i++) {
    // Retry a handful of times if a drawn (symbol, index) pair has no room to enter (index at
    // the very last candle) — mechanical, not a discretionary re-draw of an unwanted outcome.
    let sim = null;
    for (let attempt = 0; attempt < 10 && !sim; attempt++) {
      const symbol = symbols[Math.floor(rng() * symbols.length)];
      const holdout = perSymbolHoldout.get(symbol);
      if (!holdout || holdout.length < 2) continue;
      const entryIdx = Math.floor(rng() * (holdout.length - 1)); // leaves >=1 candle after
      const stopPct = stopPctPool[Math.floor(rng() * stopPctPool.length)];
      sim = simulateRandomExit(holdout, entryIdx, stopPct, perSymbolFeeRate.get(symbol), SLIPPAGE_PCT_EQUITY);
    }
    if (!sim) continue; // exhausted retries — statistically negligible, not forced
    sum += sim.r;
    count++;
    if (sim.why === "dataEnd") dataEndCount++;
  }
  return { avgR: count ? sum / count : null, count, dataEndCount };
}

function percentileRank(sortedNull, value) {
  // Fraction of null draws strictly below `value`, i.e. the empirical percentile of `value`
  // within the null distribution.
  let below = 0;
  for (const v of sortedNull) if (v < value) below++; else break;
  return below / sortedNull.length;
}

function analyzeUniverse(name, spec, rng) {
  const { trades: realTrades, perSymbolHoldout, perSymbolFeeRate } = collectRealTrades(spec.cacheDir, spec.symbols);
  const N = realTrades.length;
  const realAvgR = realTrades.reduce((a, t) => a + t.r, 0) / N;
  const stopPctPool = realTrades.map((t) => t.stopPct);
  const activeSymbols = [...perSymbolHoldout.keys()];

  const nullDraws = [];
  let totalDataEnd = 0, totalSimTrades = 0;
  for (let d = 0; d < K_DRAWS; d++) {
    const draw = drawOneNull(activeSymbols, perSymbolHoldout, perSymbolFeeRate, stopPctPool, N, rng);
    if (draw.avgR != null) nullDraws.push(draw.avgR);
    totalDataEnd += draw.dataEndCount;
    totalSimTrades += draw.count;
  }
  const nullMean = nullDraws.reduce((a, b) => a + b, 0) / nullDraws.length;
  const nullVariance = nullDraws.reduce((a, b) => a + (b - nullMean) ** 2, 0) / (nullDraws.length - 1);
  const nullSD = Math.sqrt(nullVariance);
  const sortedNull = [...nullDraws].sort((a, b) => a - b);
  const percentile = percentileRank(sortedNull, realAvgR);
  const fractionBeatingReal = sortedNull.filter((v) => v >= realAvgR).length / sortedNull.length;
  const thresholdValue = sortedNull[Math.min(sortedNull.length - 1, Math.floor(PRE_REGISTERED_PERCENTILE * sortedNull.length))];
  const passesPreRegisteredThreshold = realAvgR > thresholdValue;

  return {
    universe: name,
    realTrades: N,
    realAvgR,
    realAvgRCited: spec.realAvgRCited,
    realAvgRMatchesCitation: Math.abs(realAvgR - spec.realAvgRCited) < 0.0005,
    kDraws: K_DRAWS,
    nullDrawsUsable: nullDraws.length,
    nullMean,
    nullSD,
    nullInterpretation: nullMean > 0
      ? "Random long entries with matched risk geometry averaged POSITIVE R in this window — a beta finding about the window itself, stated before any claim about ma_dip's own edge (LOG-REGRESSION-BANDS-CRYPTO precedent)."
      : "Random long entries with matched risk geometry averaged NON-POSITIVE R in this window — no window-level beta tailwind found for undirected long entries.",
    percentileOfRealResult: percentile,
    fractionOfDrawsBeatingReal: fractionBeatingReal,
    preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE,
    thresholdValue,
    passesPreRegisteredThreshold,
    verdict: passesPreRegisteredThreshold
      ? "ma_dip's entry rule adds information beyond long exposure with matched risk geometry (real result exceeds the pre-registered 95th percentile of the matched-geometry null)."
      : "ma_dip's entry rule does NOT demonstrably add information beyond long exposure with matched risk geometry at the pre-registered threshold — the real result does not clear the null distribution's 95th percentile.",
    dataEndFraction: totalSimTrades ? totalDataEnd / totalSimTrades : null,
  };
}

function main() {
  const rng = seeded(SEED);
  const results = {};
  for (const [name, spec] of Object.entries(UNIVERSES)) {
    results[name] = analyzeUniverse(name, spec, rng);
  }

  const report = {
    config: CONFIG,
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    tpR: TP_R,
    maxHold: MAX_HOLD,
    beTriggerR: BE_TRIGGER_R,
    beLockR: BE_LOCK_R,
    feeBufferPct: FEE_BUFFER_PCT,
    kDraws: K_DRAWS,
    preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE,
    seed: SEED,
    universes: results,
  };

  const saved = saveExperiment("madip-random-entry-control", {
    specification: "madip-random-entry-control/v1",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    kDraws: K_DRAWS,
    preRegisteredPercentileThreshold: PRE_REGISTERED_PERCENTILE,
    seed: SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
