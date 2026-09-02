/**
 * DATE-CLUSTERED-RESAMPLING-AUDIT (additive, read-only research, cache-only — no IBKR egress).
 *
 * Every confidence interval this project has computed on a pooled multi-asset equities trade
 * series used `blockBootstrapCI` (momentum.mjs), which blocks by ARRAY POSITION. When trades from
 * 30 DJIA names are pooled symbol-by-symbol, trades triggered on the same calendar day by the
 * same market-wide move sit at arbitrary positions in that array, so a position-based block
 * cannot capture their correlation — each is counted as an independent observation even when a
 * dozen of them fired off the same index-wide gap. This item quantifies that gap for the two
 * equities studies it applies to: EQUITIES-BREAKOUT-SIGNIFICANCE (`breakout`, 61 trades) and
 * EQUITIES-MADIP-SIGNIFICANCE (`ma_dip`, 475 trades).
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * Reuses EQUITIES-BREAKOUT-SIGNIFICANCE's and EQUITIES-MADIP-SIGNIFICANCE's exact unmodified
 * `breakout`/`ma_dip` tournament.mjs configs, universe, 70/30 split, and IBKR-commission cost
 * model, verbatim, off the same cached candles (research-cache/equities-1d/). No re-tuning, no
 * symbol drops, no window change.
 * Replication check, before trusting anything new: reproduce each family's recorded trade count
 * and avgR bit-for-bit, and reproduce the recorded position-blocked 95% CI itself (same
 * `blockBootstrapCI` call, same default seed, on the identically-ordered pooled series) — a
 * mismatch on either means the pooled series here is not the same population already on record
 * and nothing downstream can be trusted.
 * New statistic: a date-block bootstrap. Trades are grouped into buckets by calendar UTC date of
 * entry (pooled across all 30 symbols — this is the whole point: two trades on different symbols
 * but the same day belong to the same bucket). Each iteration draws whole day-buckets with
 * replacement and concatenates them until reaching the original trade count, truncates to that
 * count (mirrors blockBootstrapCI's own fill-then-truncate mechanic, applied to day-buckets of
 * variable size instead of fixed-width positional windows), and records the mean. 5000
 * iterations, 95% CI from the 2.5/97.5 percentiles — same iteration count and percentile
 * convention as the sealed studies. Seeds fixed here before running (20260829 + 1 for breakout,
 * +2 for ma_dip) and not revisited after seeing results.
 * Effective sample size: defined as the number of DISTINCT calendar days carrying at least one
 * trade, since the date-block bootstrap's actual unit of independent resampling is one day, not
 * one trade — this is the number of independent draws that resampling scheme can ever make.
 * Mean simultaneously-open positions: for each trade, exit time is read from the same symbol's
 * holdout candle array at index (entryIndex + barsHeld) — using real candle timestamps rather
 * than entryTime + barsHeld*86400s specifically because equities daily candles skip weekends and
 * holidays, so a fixed-seconds-per-bar approximation would understate elapsed calendar time. A
 * daily census then counts, for every calendar day spanning the pooled holdout, how many trades
 * (from any symbol) have entryTime <= day <= exitTime; the mean of that count across all days is
 * the reported figure.
 * `blockBootstrapCI` (momentum.mjs) is NOT modified — sealed studies (B5-REVERSAL,
 * CLASSIFIER-FUNDING-FEATURE, etc.) depend on it unchanged. This item adds a dated variant here
 * instead, used only by this script.
 * Decision rule: this item makes no BH-FDR or promotion decision. It reports the date-clustered
 * CI side by side with the position-blocked one already on record and states plainly whether the
 * comparison changes, tightens, or widens the read on EQUITIES-BREAKOUT-SIGNIFICANCE's and
 * EQUITIES-MADIP-SIGNIFICANCE's own conclusions — including a widening/weakening result for
 * `ma_dip`, which must be reported as prominently as a tightening one would be.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Exact same universe, split, and cost model as equities-breakout-significance.mjs and
// equities-madip-significance.mjs (identical on these axes in both scripts).
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];
const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const ITERATIONS = 5000;
const DATE_BOOTSTRAP_SEED_BASE = 20260829;

// Exact unmodified configs, verbatim from their sealed studies. `recorded` is what
// EQUITIES-BREAKOUT-SIGNIFICANCE (2026-08-21) and EQUITIES-MADIP-SIGNIFICANCE (2026-08-22)
// reported on ROADMAP_ARCHIVE.md, for the replication check.
const FAMILIES = [
  ["breakout",
    { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
    { trades: 61, avgR: 0.1866, ci: [-0.2700, 0.6192], p: 0.2036 }],
  ["ma_dip",
    { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true },
    { trades: 475, avgR: 0.1526, ci: [-0.0544, 0.3609], p: 0.0648 }],
];

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Matches momentum.mjs's own dateOf convention (UTC calendar date of a unix-seconds timestamp).
const dateOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention and the
// duplication already used by equities-breakout-significance.mjs / equities-madip-significance.mjs.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Date-block bootstrap: draws whole calendar-day buckets (each possibly holding trades from
// several symbols) with replacement until reaching the original trade count, truncates to that
// count, and records the mean — the day-bucket analog of blockBootstrapCI's fixed-width
// positional block, sized to the actual clustering instead of an arbitrary window.
function dateBlockBootstrapCI(dated, { iterations = ITERATIONS, seed } = {}) {
  const buckets = new Map();
  for (const t of dated) {
    if (!buckets.has(t.date)) buckets.set(t.date, []);
    buckets.get(t.date).push(t.r);
  }
  const days = [...buckets.values()];
  const n = dated.length;
  const random = seeded(seed);
  const samples = [];
  for (let iter = 0; iter < iterations; iter++) {
    const sample = [];
    while (sample.length < n) sample.push(...days[Math.floor(random() * days.length)]);
    const truncated = sample.slice(0, n);
    samples.push(truncated.reduce((a, b) => a + b, 0) / truncated.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * .025)], samples[Math.floor(iterations * .975)]];
}

function main() {
  const report = { universeSize: UNIVERSE.length, split: SPLIT, iterations: ITERATIONS, families: {} };

  for (const [famId, config, recorded] of FAMILIES) {
    const dated = [];
    let datasetsUsed = 0;
    for (const symbol of UNIVERSE) {
      const candles = loadCached(symbol);
      if (!candles) { console.error(`MISSING CACHE: ${symbol} — this item is cache-only by design, no re-fetch`); continue; }
      const { holdout } = splitCandles(candles, SPLIT);
      if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
      datasetsUsed++;
      const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
      const feeRate = COMMISSION_PER_SHARE / avgClose;
      const series = [{ label: "1d", mins: 1440, candles: holdout }];
      const r = backtestMultiTF({ series }, { ...config, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
      const timeToIdx = new Map(holdout.map((c, i) => [+c.time, i]));
      for (const x of r.excursions) {
        const entryIdx = timeToIdx.get(x.entryTime);
        const exitIdx = Math.min(entryIdx + x.barsHeld, holdout.length - 1);
        const exitTime = +holdout[exitIdx].time;
        dated.push({ symbol, r: x.r, entryTime: x.entryTime, date: dateOf(x.entryTime), exitTime });
      }
    }

    const n = dated.length;
    const avgR = n ? dated.reduce((a, t) => a + t.r, 0) / n : 0;
    const pooledR = dated.map((t) => t.r);
    const recordedPositionBlockedCI = blockBootstrapCI(pooledR, { blockSize: 4, iterations: ITERATIONS });
    const replication = {
      tradesMatch: n === recorded.trades,
      avgRMatch: Math.abs(avgR - recorded.avgR) < 5e-4,
      ciMatch: Math.abs(recordedPositionBlockedCI[0] - recorded.ci[0]) < 5e-4 &&
        Math.abs(recordedPositionBlockedCI[1] - recorded.ci[1]) < 5e-4,
    };

    const perDay = new Map();
    for (const t of dated) perDay.set(t.date, (perDay.get(t.date) || 0) + 1);
    const counts = [...perDay.values()];
    const histogram = {};
    for (const c of counts) histogram[c] = (histogram[c] || 0) + 1;
    const distinctDays = perDay.size;
    const largestCluster = counts.length ? Math.max(...counts) : 0;

    const minEntry = Math.min(...dated.map((t) => t.entryTime));
    const maxExit = Math.max(...dated.map((t) => t.exitTime));
    let daySum = 0, dayCount = 0;
    for (let ts = minEntry; ts <= maxExit; ts += 86400) {
      let open = 0;
      for (const t of dated) if (t.entryTime <= ts && ts <= t.exitTime) open++;
      daySum += open; dayCount++;
    }
    const meanSimultaneousOpen = dayCount ? daySum / dayCount : 0;

    const dateClusteredSeed = DATE_BOOTSTRAP_SEED_BASE + (famId === "breakout" ? 1 : 2);
    const dateClusteredCI = dateBlockBootstrapCI(dated, { iterations: ITERATIONS, seed: dateClusteredSeed });

    report.families[famId] = {
      trades: n, avgR, datasetsUsed,
      recorded, replication,
      distinctDays, effectiveN: distinctDays, largestCluster, histogram,
      meanSimultaneousOpen,
      positionBlockedCI: recordedPositionBlockedCI,
      dateClusteredCI, dateClusteredSeed,
    };
  }

  const saved = saveExperiment("date-clustered-resampling-audit", {
    specification: "date-clustered-resampling-audit/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    iterations: ITERATIONS,
    dateBootstrapSeedBase: DATE_BOOTSTRAP_SEED_BASE,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
