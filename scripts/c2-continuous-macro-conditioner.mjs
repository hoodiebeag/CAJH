/**
 * C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES (additive, read-only diagnostic — cache-only for
 * equity candles, EGRESS to FRED's public CSV export for the macro series).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A FOURTH DISCRETE-REGIME STUDY: MACRO-REGIME-PRIMARY-SIGNAL
 * (2026-08-22), MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES (2026-08-25) and
 * MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC (2026-08-27) all died on the same structural
 * wall: the holdout window contains exactly ONE discrete regime episode (~479 of 500 cached
 * equity days sit inside one unbroken favourable episode), so discrete regime-voting makes
 * effective n the episode count (1) no matter where the train/holdout split falls. A fourth
 * discrete-regime study would fail identically and must not be staged. What changes here is the
 * STATISTICAL UNIT: conditioning on a CONTINUOUS macro level makes effective n the TRADE count,
 * not the episode count — a different statistical object, not a re-run. This applies NO threshold
 * and NO binary gate anywhere in its design, so it is not caught by `template_a_exhausted` either
 * (that closure retired threshold-a-series then binary-gate breakout/anticipate then score
 * holdout avgR — nothing here thresholds or gates).
 *
 * ============================ PRE-REGISTRATION (written before any equity return is touched) ============================
 * MACRO VARIABLE: the 10y-2y Treasury spread (DGS10 - DGS2), used as a CONTINUOUS value — never
 * thresholded, never binned into a regime. Chosen because it is already sourced by
 * macro-regime-primary-signal.mjs (the standard recession-risk indicator, not fit to this data)
 * and is the natural single-variable candidate; no other variable was tried and discarded, and
 * this choice was made before the association below was computed.
 * SOURCING / CAUSAL LAG: reused verbatim from scripts/macro-regime-primary-signal.mjs —
 * `fetchFredSeries`/`lookupLagged` duplicated unmodified (same pattern
 * macro-regime-primary-signal-equities.mjs already used, since the source script does not export
 * them), DGS10 and DGS2 fetched from FRED's public CSV export, spread computed as
 * `dgs10[i].value - nearest DGS2 point <= same date`, looked up as the latest published value
 * STRICTLY BEFORE (trade entry date - 1 day) — the same 1-day conservative publication lag the
 * source script uses for its daily series.
 * EQUITY TRADE POPULATION: `ma_dip` on the DJIA-30 holdout, using the EXACT config
 * MADIP-REALISED-R-CONDITION-2 (2026-08-28) established and did not modify:
 * `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`, 70/30 split, IBKR Fixed $0.005/share commission (per-symbol,
 * converted via that symbol's own holdout avgClose) + 5bps/side slippage. Chosen because it is
 * the single most rigorously characterized equity trade population in this project (win-rate
 * margin, exit-reason decomposition, random-entry control, survivability all already measured
 * against it) and already carries a per-trade `entryTime`/`why`/`r` structure this item can
 * attach a macro level to without re-deriving anything. No parameter is changed here under any
 * circumstance — this reuses the existing candidate's own trades, it does not re-tune.
 * TEST STATISTIC: Spearman rank correlation between (macro spread level at each trade's own
 * entry date, under the causal lag above) and (that trade's realised net R). TWO-SIDED, because
 * this item pre-registers no directional prior on the spread's sign — an inverted curve could
 * plausibly correlate with trade outcome in either direction depending on mechanism, and stating
 * a direction only after seeing the sign would be exactly the kind of after-the-fact framing this
 * project's discipline exists to prevent. Significance via a label-shuffle permutation test
 * (K=2000, seed fixed below, before this script is ever run) rather than a parametric assumption
 * on trade-R's distribution. A quintile breakdown (mean net R and trade count per macro-level
 * quintile) is reported as a descriptive companion only, not as an additional test.
 * PERMUTATION SEED: 20260829 (today's date as an integer, chosen for no property of the data).
 * CORRECTION FAMILY: per PHASE-DIRECTIVE-BOOKKEEPING's pre-registered decision, this result joins
 * MULTIPLE_COMPARISONS_AUDIT.md's existing formal-NHST family (C0-C3 all join it) — that decision
 * is not re-opened here.
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
const CAUSAL_LAG_DAYS = 1; // DGS10/DGS2 are daily series — same conservative next-business-day lag macro-regime-primary-signal.mjs uses
const PERMUTATION_ITERATIONS = 2000;
const PERMUTATION_SEED = 20260829;
const QUINTILES = 5;

const cacheDir = path.join(".", "research-cache", "equities-1d");
const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
]; // MADIP-REALISED-R-CONDITION-2's DJIA-30 universe, unmodified

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

// --- FRED sourcing / causal lag, duplicated verbatim from macro-regime-primary-signal.mjs
// (that script does not export these — same pattern macro-regime-primary-signal-equities.mjs used) ---
async function fetchFredSeries(seriesId) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1);
  const points = [];
  for (const line of lines) {
    const [date, valueRaw] = line.split(",");
    if (valueRaw === "." || valueRaw === undefined) continue; // FRED's own missing-value marker
    points.push({ date, t: Date.parse(date + "T00:00:00Z"), value: Number(valueRaw) });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/** Latest point strictly before (targetMs - lagDays), i.e. causal lookup with a publication lag. */
function lookupLagged(series, targetMs, lagDays) {
  const cutoff = targetMs - lagDays * 86400000;
  let result = null;
  for (const p of series) {
    if (p.t > cutoff) break;
    result = p;
  }
  return result;
}

// --- Spearman rank correlation ---
function rankOf(v) {
  const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function pearson(xs, ys) {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

async function main() {
  // --- macro data: DGS10/DGS2 only (the one pre-registered variable) ---
  const [dgs10, dgs2] = await Promise.all([fetchFredSeries("DGS10"), fetchFredSeries("DGS2")]);
  if (!dgs10.length || !dgs2.length) {
    throw new Error("DGS10 or DGS2 returned no data from FRED - aborting rather than proceeding on a partial fetch");
  }
  const spread = dgs10.map((p) => {
    const d2 = lookupLagged(dgs2, p.t + 1, 0); // same-day-or-earlier DGS2 point
    return d2 ? { t: p.t, value: p.value - d2.value } : null;
  }).filter(Boolean);

  // --- equity trades: ma_dip on the DJIA-30 holdout, exact MADIP-REALISED-R-CONDITION-2 config ---
  const allExcursions = [];
  let datasetsUsed = 0;
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles) { console.error(`MISSING CACHE: ${symbol} — cache-only by design, no re-fetch`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    datasetsUsed++;
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    allExcursions.push(...r.excursions.map((x) => ({ ...x, symbol })));
  }

  // A same-bar entry+stop excursion carries no entryTime (backtest.js only stamps entryTime on
  // the normal exit path) — excluded here since this item needs a real entry date to look up the
  // macro level against, disclosed as a filtered count rather than silently dropped.
  const withEntryTime = allExcursions.filter((x) => x.entryTime != null);
  const droppedNoEntryTime = allExcursions.length - withEntryTime.length;

  const trades = withEntryTime.map((x) => {
    const entryMs = Number(x.entryTime) * 1000;
    const spreadPoint = lookupLagged(spread, entryMs, CAUSAL_LAG_DAYS);
    return spreadPoint ? { symbol: x.symbol, entryTime: x.entryTime, r: x.r, why: x.why, spread: spreadPoint.value } : null;
  }).filter(Boolean);
  const droppedNoMacroHistory = withEntryTime.length - trades.length;

  // --- test statistic: Spearman rank correlation, spread level vs net R ---
  const spreadVals = trades.map((t) => t.spread);
  const rVals = trades.map((t) => t.r);
  const rankSpread = rankOf(spreadVals);
  const rankR = rankOf(rVals);
  const observedRho = pearson(rankSpread, rankR);

  // --- label-shuffle permutation test, two-sided, fixed seed ---
  let state = PERMUTATION_SEED >>> 0;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; };
  let extreme = 0;
  for (let k = 0; k < PERMUTATION_ITERATIONS; k++) {
    const shuffledR = shuffle(rankR);
    const permRho = pearson(rankSpread, shuffledR);
    if (permRho != null && Math.abs(permRho) >= Math.abs(observedRho)) extreme++;
  }
  const permutationP = (extreme + 1) / (PERMUTATION_ITERATIONS + 1);

  // --- descriptive companion: mean net R by macro-level quintile ---
  const sortedByspread = [...trades].sort((a, b) => a.spread - b.spread);
  const quintiles = [];
  for (let q = 0; q < QUINTILES; q++) {
    const lo = Math.floor((q * sortedByspread.length) / QUINTILES);
    const hi = Math.floor(((q + 1) * sortedByspread.length) / QUINTILES);
    const bucket = sortedByspread.slice(lo, hi);
    quintiles.push({
      quintile: q + 1,
      n: bucket.length,
      spreadRange: bucket.length ? [bucket[0].spread, bucket[bucket.length - 1].spread] : null,
      meanNetR: bucket.length ? mean(bucket.map((t) => t.r)) : null,
    });
  }

  const effectiveN = trades.length;
  const result = {
    macroVariable: "DGS10-DGS2 (10y-2y Treasury spread, continuous, no threshold)",
    causalLagDays: CAUSAL_LAG_DAYS,
    equityTradePopulation: "ma_dip, DJIA-30 holdout, MADIP-REALISED-R-CONDITION-2 config (unmodified)",
    datasetsUsed,
    totalExcursions: allExcursions.length,
    droppedNoEntryTime,
    droppedNoMacroHistory,
    effectiveN,
    priorStudiesEffectiveN: 1,
    priorStudiesCited: ["MACRO-REGIME-PRIMARY-SIGNAL", "MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES", "MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC"],
    testStatistic: "Spearman rank correlation (macro spread level at causally-lagged entry date vs trade net R)",
    observedRho,
    permutation: { p: permutationP, iterations: PERMUTATION_ITERATIONS, seed: PERMUTATION_SEED, twoSided: true },
    quintiles,
    verdict: permutationP < 0.05
      ? `SIGNIFICANT (p=${permutationP.toFixed(4)}) - continuous macro conditioning shows a real association at n=${effectiveN}, direction ${observedRho >= 0 ? "positive" : "negative"} - does not by itself imply an economically deployable gate; would need a follow-on economic-viability check before any strategy change`
      : `NULL (p=${permutationP.toFixed(4)}) - no detectable association between the 10y-2y spread level and ma_dip trade outcome at n=${effectiveN}; closes continuous macro conditioning for this variable/population, complementing the discrete-regime studies' null on the same broad hypothesis`,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("c2-continuous-macro-conditioner", {
    specification: "c2-continuous-macro-conditioner/v1",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    config: CONFIG,
    universe: UNIVERSE,
    permutationSeed: PERMUTATION_SEED,
    permutationIterations: PERMUTATION_ITERATIONS,
  }, result);
  console.error(`\nSaved to ${file}`);
}

main();
