/**
 * DATE-CLUSTERED-RESAMPLING-DJTA20 (additive, read-only research, cache-only — no IBKR egress).
 *
 * NOT an attempt to revisit, rescue, or re-test `ma_dip` as a candidate. `ma_dip` closed on
 * MADIP-SURVIVABILITY-CONDITION-5 (max drawdown -81.7% DJIA-30 / -74.2% DJTA-20 at f=2%, ruin at
 * f=5% on both) and on MADIP-RANDOM-ENTRY-CONTROL (53rd percentile DJIA-30) — both settled before
 * this item ran. `ma_dip` is described throughout as a closed historical population. This item
 * exists for one forward-looking reason: DJTA-20 is the project's largest untested date-clustering
 * population, and REQUIRED-SAMPLE-FOR-DURABLE-PASS derived its entire required-N table from this
 * population's nominal 300-trade count and its POSITION-blocked CI half-width, with no clustering
 * adjustment — that table is an input every future equities study reads, so the correction belongs
 * on the record.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * METHOD: DATE-CLUSTERED-RESAMPLING-AUDIT's method, unchanged — reused verbatim, not
 * re-implemented independently. Same block-position bootstrap (`blockBootstrapCI`, momentum.mjs,
 * unmodified) for the replication check, same date-block bootstrap mechanic (draw whole
 * calendar-day buckets with replacement, fill-then-truncate to the original trade count), same
 * clustering statistics (trades/day, distinct days, largest cluster, mean simultaneously-open
 * positions via real candle timestamps at entryIndex+barsHeld), same 5000 iterations / 2.5-97.5
 * percentile convention.
 * POPULATION: EQUITIES-MADIP-OUT-OF-SAMPLE's exact DJTA-20 run — same point-in-time 20-symbol
 * universe (research-cache/equities-1d-djta-oos/), same 70/30 split, same `ma_dip` config
 * (`{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`), same IBKR Fixed $0.005/share commission and 5bps/side slippage.
 * Replication check, before trusting anything new: reproduce EQUITIES-MADIP-OUT-OF-SAMPLE's
 * recorded 300 trades, avgR +0.2994, and position-blocked CI [+0.0509, +0.5350] bit-for-bit off
 * the same cached candles before computing anything new — a mismatch means this is not the same
 * population already on record.
 * SEED: date-clustered bootstrap seed 20260832, fixed here before running (continues
 * DATE-CLUSTERED-RESAMPLING-AUDIT's 20260829-base numbering — that item used +1/+2 for
 * breakout/ma_dip on DJIA-30; this item is a distinct population and uses +3, never reused).
 * REQUIRED-SAMPLE RESTATEMENT: REQUIRED-SAMPLE-FOR-DURABLE-PASS derived a per-trade SD from the
 * POSITION-blocked CI half-width (half-width = 1.96*SE, SE = SD/sqrt(n)) purely as a disclosed,
 * NOT-used-for-required-N diagnostic (its own Step 2 explicitly declines to use that SD for the
 * required-N table, calibrating instead off the empirically observed sign-flip p=0.0116 because a
 * block-bootstrap permutation p is not exactly normal). This item recomputes that same
 * (diagnostic-only) SD using the DATE-CLUSTERED half-width instead, reports how the derived SD and
 * implied effect size move, and — because that is the only place the swapped half-width can
 * mechanically enter REQUIRED-SAMPLE-FOR-DURABLE-PASS's actual required-N formula (Step 2's own
 * "sanity check, NOT used below" SD-alone z) — separately computes what the required-N table WOULD
 * read if that sanity-check path were used instead of the p-calibrated one, and states that
 * movement factor explicitly. The PRIMARY required-N table (calibrated off the observed p-value,
 * which this item does not recompute) is unaffected by a CI half-width change and is reported as
 * such, not silently — this is a reported non-move, not an omission. No new p-value is computed
 * anywhere in this script and it does not join MULTIPLE_COMPARISONS_AUDIT.md's formal-NHST family;
 * no BH-FDR recomputation. `blockBootstrapCI` is NOT modified.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

// Point-in-time DJTA-20 as of window start 2024-08-22 — identical universe/cache to
// EQUITIES-MADIP-OUT-OF-SAMPLE and EQUITIES-BREAKOUT-OUT-OF-SAMPLE.
const UNIVERSE = [
  "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
  "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
];
const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const ITERATIONS = 5000;
const DATE_BOOTSTRAP_SEED = 20260832;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

// EQUITIES-MADIP-OUT-OF-SAMPLE's recorded DJTA-20 figures, for the replication check.
const RECORDED = { trades: 300, avgR: 0.2994, ci: [0.0509, 0.5350] };

// DJIA-30's figures already on record (DATE-CLUSTERED-RESAMPLING-AUDIT, 2026-08-28, ROADMAP.md),
// reported here side by side per this item's own done_when — not recomputed.
const DJIA30_RECORD = {
  trades: 475, distinctDays: 124, largestCluster: 13, meanSimultaneousOpen: 10.47,
  effectiveOverNominalPct: 26,
  positionBlockedCI: [-0.0544, 0.3609],
  dateClusteredCI: [-0.1010, 0.4083],
};

// REQUIRED-SAMPLE-FOR-DURABLE-PASS's own recorded inputs and outputs, reused verbatim for the
// restatement below (not re-derived from scratch).
// Verified by re-running scripts/required-sample-for-durable-pass.mjs unmodified before writing
// this file (its own Step 1/2/5 console output), not re-derived independently.
const REQUIRED_SAMPLE_RECORD = {
  meanR: 0.2994, ciLower: 0.0509, ciUpper: 0.5350, nObserved: 300, pObserved: 0.0116,
  q: 0.05, familySize: 20, rank: 4,
  perTradeSD: 2.1390, // that script's own Step 1 output, position-blocked CI half-width derived
  zObserved: 2.2701,  // that script's own Step 2 output: probit(1 - 0.0116)
  requiredN: { rank4_m19: 310, rank4_m20: 316 }, // that script's own Step 3 (m=19)/Step 5 (m=20) output
};

const cacheDir = path.join(".", "research-cache", "equities-1d-djta-oos");

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

// Local seeded RNG, mirroring momentum.mjs's internal `seeded()` LCG convention and
// DATE-CLUSTERED-RESAMPLING-AUDIT's own duplication of it.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Date-block bootstrap — identical mechanic to DATE-CLUSTERED-RESAMPLING-AUDIT's
// dateBlockBootstrapCI: draw whole calendar-day buckets with replacement until reaching the
// original trade count, truncate, record the mean.
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

// Acklam's rational approximation for the inverse standard normal CDF (probit), |error| < 1.15e-9
// — duplicated from REQUIRED-SAMPLE-FOR-DURABLE-PASS unchanged, needed for the restatement below.
function probit(p) {
  if (!(p > 0 && p < 1)) throw new Error(`probit: p out of (0,1): ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

function requiredN(rank, familySize, zObserved, nObserved, q) {
  const pReq = rank * q / familySize;
  const zReq = probit(1 - pReq);
  const nReq = nObserved * Math.pow(zReq / zObserved, 2);
  return { pReq, zReq, nReq: Math.ceil(nReq) };
}

function main() {
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
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    const timeToIdx = new Map(holdout.map((c, i) => [+c.time, i]));
    for (const x of r.excursions) {
      const entryIdx = timeToIdx.get(x.entryTime);
      const exitIdx = Math.min(entryIdx + x.barsHeld, holdout.length - 1);
      const exitTime = +holdout[exitIdx].time;
      dated.push({ symbol, r: x.r, entryTime: x.entryTime, date: dateOf(x.entryTime), exitTime });
    }
  }

  // --- Replication check ---
  const n = dated.length;
  const avgR = n ? dated.reduce((a, t) => a + t.r, 0) / n : 0;
  const pooledR = dated.map((t) => t.r);
  const positionBlockedCI = blockBootstrapCI(pooledR, { blockSize: 4, iterations: ITERATIONS });
  const replication = {
    tradesMatch: n === RECORDED.trades,
    avgRMatch: Math.abs(avgR - RECORDED.avgR) < 5e-4,
    ciMatch: Math.abs(positionBlockedCI[0] - RECORDED.ci[0]) < 5e-4 &&
      Math.abs(positionBlockedCI[1] - RECORDED.ci[1]) < 5e-4,
  };

  // --- Clustering statistics ---
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
  const effectiveOverNominalPct = (distinctDays / n) * 100;

  // --- Date-clustered CI ---
  const dateClusteredCI = dateBlockBootstrapCI(dated, { iterations: ITERATIONS, seed: DATE_BOOTSTRAP_SEED });

  // --- Required-sample restatement ---
  // Step 1 analog: per-trade SD from the date-clustered CI half-width (same normal-approx
  // derivation REQUIRED-SAMPLE-FOR-DURABLE-PASS's own Step 1 used, applied to the new interval).
  const dcHalfWidthLower = REQUIRED_SAMPLE_RECORD.meanR - dateClusteredCI[0];
  const dcHalfWidthUpper = dateClusteredCI[1] - REQUIRED_SAMPLE_RECORD.meanR;
  const dcAvgHalfWidth = (dcHalfWidthLower + dcHalfWidthUpper) / 2;
  const dcSE = dcAvgHalfWidth / 1.96;
  const dcPerTradeSD = dcSE * Math.sqrt(REQUIRED_SAMPLE_RECORD.nObserved);
  const dcEffectSize = REQUIRED_SAMPLE_RECORD.meanR / dcPerTradeSD;
  const sdMovementFactor = dcPerTradeSD / REQUIRED_SAMPLE_RECORD.perTradeSD;

  // Primary required-N path (unchanged): calibrated off the observed sign-flip p, which this
  // item does not recompute — a CI half-width swap cannot mechanically enter this path.
  const primaryAtRecordedRank = requiredN(
    REQUIRED_SAMPLE_RECORD.rank, REQUIRED_SAMPLE_RECORD.familySize,
    REQUIRED_SAMPLE_RECORD.zObserved, REQUIRED_SAMPLE_RECORD.nObserved, REQUIRED_SAMPLE_RECORD.q
  );

  // Sanity-check path (REQUIRED-SAMPLE-FOR-DURABLE-PASS's own Step 2 "zFromSDAlone", disclosed as
  // NOT used there): recomputed here with the date-clustered SD in place of the position-blocked
  // one, to give the movement factor this item's task text asks for.
  const zFromSDAlone_positionBlocked = (REQUIRED_SAMPLE_RECORD.meanR / REQUIRED_SAMPLE_RECORD.perTradeSD) * Math.sqrt(REQUIRED_SAMPLE_RECORD.nObserved);
  const zFromSDAlone_dateClustered = (REQUIRED_SAMPLE_RECORD.meanR / dcPerTradeSD) * Math.sqrt(REQUIRED_SAMPLE_RECORD.nObserved);
  const sdAlonePositionBlocked = requiredN(
    REQUIRED_SAMPLE_RECORD.rank, REQUIRED_SAMPLE_RECORD.familySize,
    zFromSDAlone_positionBlocked, REQUIRED_SAMPLE_RECORD.nObserved, REQUIRED_SAMPLE_RECORD.q
  );
  const sdAloneDateClustered = requiredN(
    REQUIRED_SAMPLE_RECORD.rank, REQUIRED_SAMPLE_RECORD.familySize,
    zFromSDAlone_dateClustered, REQUIRED_SAMPLE_RECORD.nObserved, REQUIRED_SAMPLE_RECORD.q
  );
  const sdAloneRequiredNMovementFactor = sdAloneDateClustered.nReq / sdAlonePositionBlocked.nReq;

  const report = {
    population: "ma_dip, DJTA-20 (EQUITIES-MADIP-OUT-OF-SAMPLE population — CLOSED historical, not a live candidate)",
    universeSize: UNIVERSE.length, datasetsUsed, split: SPLIT, iterations: ITERATIONS,
    trades: n, avgR, recorded: RECORDED, replication,
    clustering: {
      distinctDays, effectiveN: distinctDays, effectiveOverNominalPct, largestCluster, histogram,
      meanSimultaneousOpen,
    },
    djia30Comparison: DJIA30_RECORD,
    positionBlockedCI, dateClusteredCI, dateClusteredSeed: DATE_BOOTSTRAP_SEED,
    requiredSampleRestatement: {
      recordedInputs: REQUIRED_SAMPLE_RECORD,
      dateClusteredCIHalfWidth: dcAvgHalfWidth, dateClusteredPerTradeSD: dcPerTradeSD,
      dateClusteredEffectSize: dcEffectSize, sdMovementFactor,
      primaryRequiredN_unchanged: primaryAtRecordedRank,
      sdAloneSanityCheck: {
        zFromSDAlone_positionBlocked, zFromSDAlone_dateClustered,
        requiredN_positionBlocked: sdAlonePositionBlocked,
        requiredN_dateClustered: sdAloneDateClustered,
        movementFactor: sdAloneRequiredNMovementFactor,
      },
      note: "The PRIMARY required-N table (calibrated off the observed sign-flip p=0.0116) does not " +
        "move under the date-clustered CI, because it was never derived from the CI half-width — " +
        "only the SD-alone sanity-check path (disclosed as 'not used' in REQUIRED-SAMPLE-FOR-DURABLE-PASS's " +
        "own Step 2) mechanically depends on the half-width, and that path's required-N moves by the factor above.",
    },
  };

  const saved = saveExperiment("date-clustered-resampling-djta20", {
    specification: "date-clustered-resampling-djta20/v1",
    split: SPLIT,
    universe: UNIVERSE,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    iterations: ITERATIONS,
    dateBootstrapSeed: DATE_BOOTSTRAP_SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
