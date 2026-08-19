/**
 * CROSS-SECTIONAL-NONPRICE-RANK: tests a non-price data source as a PRIMARY cross-sectional
 * ranking signal, not a gate. T1-ZEROCOST established that 8 of 10 non-price sources tested in
 * this project were tested only as GATES on breakout/anticipate (a price-structure entry), and
 * that those families carry no gross edge at zero cost (7/8 negative) — a filter on a
 * no-edge population can only select subsets of nothing. This tests the same KIND of data as
 * the entry signal itself: rank the universe cross-sectionally, go long the top quantile, no
 * price-structure condition anywhere. Reuses `momentum.mjs`'s already-validated IC/permutation-
 * p/BH-FDR/bootstrap/economics machinery directly (`perDateIC` via `scoreMomentumPanelRows`,
 * `economicMomentumViews`, `bhFdr`, `tagMomentumRegimes`) on a differently-sourced panel — only
 * the panel-construction (fetch + no-lookahead join) is new code.
 *
 * PRE-REGISTRATION (written before any fetch or computation ran):
 *
 * Feature (ONE, chosen before looking at any result): OPEN-INTEREST CHANGE, from
 * `derivatives.mjs`'s `fetchAnalytics(type:'open-interest')` (Kraken Futures). Chosen over the
 * other two candidates in the task (funding-rate level, long/short ratio) on data-coverage
 * grounds alone, decided before any of the three was examined: `oi-trend-gate.mjs`'s own
 * documented check found OI history reaches all 29 watchlist symbols with no rolling-window
 * ceiling; funding has a documented ~365-730-day ceiling (H11/FUNDING-MEANREV);
 * long-short-ratio's per-asset resolution was confirmed on only 4 majors
 * (`long-short-ratio-contrarian.mjs`). A whole-universe cross-sectional rank needs breadth
 * across many assets on the same date more than a per-asset gate does, so the broadest,
 * already-verified source is the a priori sound pick.
 *
 * Formation: trailing N=7-day percent change in OI close level (reuses
 * `oi-trend-gate.mjs`'s own already-validated N=7 trailing window, not a new parameter).
 * Rebalance/forward horizon: 7 days, step=horizon (reuses `momentum.mjs`'s own primaryHorizon
 * default). Entry delay: 1 day after signal formation (reuses `momentum.mjs`'s ranked-cell
 * entryDelay convention — no lookahead between signal date and executable entry). OI points
 * reveal +1 day after their own timestamp (this codebase's standard no-lookahead offset, see
 * `oi-trend-gate.mjs`'s `oiPoints`) — so the signal used at rebalance date `d` only reflects OI
 * data that had actually closed and been revealed by `d`.
 *
 * Universe: ACTIVE watchlist only (`SEALED_SYMBOLS` excluded via `researchlib.mjs`'s
 * `splitSealedSymbols`, this project's standing convention for the one-time final validation
 * reservation). Per-asset OI coverage floor: 500 days (matches `oi-trend-gate.mjs`/
 * `long-short-ratio-contrarian.mjs`'s own 500-day convention). minAssets per rebalance date: 8
 * (matches `momentum.mjs`'s own convention).
 *
 * Expected sign (stated before computing anything): POSITIVE — rising OI (positive % change)
 * predicts higher forward returns, the same directional hypothesis `oi-trend-gate.mjs`
 * pre-registered ("fresh leveraged conviction / real trend confirmation"), reused here as a
 * primary signal instead of a gate. No price-structure entry condition anywhere.
 *
 * No short access on this account (disclosed project-wide, see e.g. PAIRS-COINTEGRATION-
 * STATARB's own note) — per this item's own done_when, the LONG-ONLY top-quantile view is
 * reported as primary. `economicMomentumViews`'s `topN[n].netReturn` is already a long-only
 * absolute average forward return of the top-N selection (not a spread against the bottom),
 * so it needs no modification for this. topN=5 is the one pre-registered primary size (one
 * clean choice, not a sweep, matching this project's convention); topN=3 and the long/short
 * tercile spread are also computed and reported for disclosure but do not decide the gate.
 * Cost: 0.017 real Kraken Tier-1 round-trip (FEE-SCHEDULE-REBASE's corrected figure, this
 * project's standing convention for "real cost", already used by `momentum.mjs`'s own
 * sealed-short-horizon-recheck arm).
 *
 * Verdict gate (pre-registered, momentum M7/B5-REVERSAL's own established two-stage shape):
 * (1) TRAIN SIGNIFICANCE FIRST — train meanIC's permutation p-value must clear p<0.05 AND
 * survive a family-wide Benjamini-Hochberg FDR recomputed across every formal-NHST p-value in
 * this project (`AGENT_PROTOCOL.md`'s multiple-comparisons discipline, added 2026-08-19; the
 * 9 prior values are `MULTIPLE_COMPARISONS_AUDIT.md` §2's table as of 2026-08-19, hardcoded
 * below with a citation rather than re-derived). If this fails, the study is KILLED at the
 * train-significance stage (same pattern as Momentum M7) — holdout and economics are still
 * computed and reported for disclosure, but are not decisive. (2) Only if (1) passes: the
 * sealed recent-holdout (last 4 rebalance dates, `momentum.mjs`'s own recentHoldoutDates
 * default) is evaluated ONCE. Economic gate: holdout topN(5) net return (net of the real
 * 0.017 cost) > 0 AND holdout observations >= 10 — the same "avgNetR>0 AND trades>=10" form
 * PAIRS-COINTEGRATION-STATARB pre-registered for its own (never-reached) holdout economic gate.
 */
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols } from "./researchlib.mjs";
import { loadDailyCandles, saveExperiment, dataManifest } from "./researchlab.mjs";
import { fetchAnalytics } from "./derivatives.mjs";
import { scoreMomentumPanelRows, economicMomentumViews, tagMomentumRegimes, bhFdr } from "./momentum.mjs";

const DAY = 86400;
const LOOKBACK_DAYS = 7;
const HORIZON_DAYS = 7;
const ENTRY_DELAY = 1;
const MIN_ASSETS = 8;
const MIN_HISTORY_DAYS = 500;
const RECENT_HOLDOUT_DATES = 4;
const ROUND_TRIP_COST = 0.017;
const PRIMARY_TOP_N = 5;
const PERMUTATIONS = 1000;
const ALPHA = 0.05;
const EXPECTED_SIGN = "positive";

// MULTIPLE_COMPARISONS_AUDIT.md §2, as of 2026-08-19 (9 sub-tests across 6 studies) —
// AGENT_PROTOCOL.md's multiple-comparisons discipline requires every new formal-NHST p-value
// to be added to this table and BH-FDR recomputed across the whole family, not evaluated
// against alpha=0.05 in isolation.
const PRIOR_NHST_FAMILY = Object.freeze([
  { study: "B5-REVERSAL L=3 (train)", p: 0.0010, signCorrect: true },
  { study: "CLASSIFIER-FUNDING-FEATURE (holdout, primary)", p: 0.0099, signCorrect: true },
  { study: "Classifier P5 (holdout, primary)", p: 0.0198, signCorrect: true },
  { study: "Low-vol B4 negBeta (train)", p: 0.0579, signCorrect: true },
  { study: "Low-vol B4 negVol (train)", p: 0.2278, signCorrect: true },
  { study: "B5-REVERSAL L=5 (train)", p: 0.4226, signCorrect: true },
  { study: "MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train)", p: 0.4266, signCorrect: true },
  { study: "MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train)", p: 0.6024, signCorrect: false },
  { study: "Momentum M7 (train, residual IC)", p: 0.7013, signCorrect: true },
]);

const dateOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const closeByDate = (candles) => new Map(candles.map((c) => [dateOf(c.time), c.close]));
const toFuturesSymbol = (symbol) => `PF_${symbol === "BTC" ? "XBT" : symbol}USD`;
const normalize = (watchlist) => watchlist.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);

/** Kraken's open-interest analytics value is [open,high,low,close]; use the day's close level.
 * Each point only becomes visible once its own day has closed (+1 day) — this codebase's
 * standard no-lookahead offset (see `oi-trend-gate.mjs`'s `oiPoints`, reused verbatim here). */
function oiPoints(normalized) {
  const byTime = new Map();
  for (const p of normalized?.points || []) {
    const close = Array.isArray(p.value) ? Number(p.value[3]) : Number(p.value);
    if (Number.isFinite(p.timestamp) && Number.isFinite(close)) byTime.set(p.timestamp, { revealTime: p.timestamp + DAY, close });
  }
  return [...byTime.values()].sort((a, b) => a.revealTime - b.revealTime);
}

/** Forward-walking "trailing N-day OI percent change as of the latest revealed point" cursor —
 * a fresh cursor per asset (mirrors `oi-trend-gate.mjs`'s `makeOiRisingAt`: never share a
 * cursor across two runs), called with monotonically increasing timestamps across the
 * rebalance-date loop. Returns null (no signal yet) until N+1 points have revealed. */
function makeOiChangeAt(points, n) {
  let i = 0;
  const closes = [];
  return (tSec) => {
    while (i < points.length && points[i].revealTime <= tSec) { closes.push(points[i].close); i++; }
    if (closes.length < n + 1) return null;
    const current = closes[closes.length - 1];
    const base = closes[closes.length - 1 - n];
    return base > 0 ? current / base - 1 : null;
  };
}

/** Cross-sectional date x asset panel: `trailR` is the OI-change signal (not a price
 * transform), `fwdR` is the executable forward price return from entryDate to forwardDate —
 * the exact row shape `momentum.mjs`'s `scoreMomentumPanelRows`/`economicMomentumViews`
 * already consume, so no new scoring math is needed. */
function buildNonPricePanel(series, oiCursors, { universe, factorAsset = "BTC" }) {
  const calendarSource = series.get(factorAsset);
  if (!calendarSource?.length) throw new Error("factor asset (BTC) daily history is required as the panel calendar");
  const closeMaps = new Map(universe.map((asset) => [asset, closeByDate(series.get(asset) || [])]));
  const rows = [];
  for (let i = LOOKBACK_DAYS; i + HORIZON_DAYS < calendarSource.length; i += HORIZON_DAYS) {
    const tSec = calendarSource[i].time;
    const date = dateOf(tSec);
    const entryDate = dateOf(calendarSource[i + ENTRY_DELAY].time);
    const forwardDate = dateOf(calendarSource[i + HORIZON_DAYS].time);
    const bucket = [];
    for (const asset of universe) {
      const cursor = oiCursors.get(asset);
      if (!cursor) continue;
      const signal = cursor(tSec);
      if (signal === null) continue;
      const entry = closeMaps.get(asset).get(entryDate);
      const forward = closeMaps.get(asset).get(forwardDate);
      if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(forward) || forward <= 0) continue;
      bucket.push({ date, asset, trailR: signal, fwdR: forward / entry - 1 });
    }
    if (bucket.length < MIN_ASSETS) continue;
    rows.push(...bucket);
  }
  return rows;
}

function splitByRecentDates(rows, holdoutDates) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const held = new Set(dates.slice(Math.max(0, dates.length - holdoutDates)));
  return {
    train: rows.filter((r) => !held.has(r.date)),
    holdout: rows.filter((r) => held.has(r.date)),
    holdoutDates: [...held],
  };
}

export async function runCrossSectionalNonPriceRank({
  watchlist = loadWatchlist(),
  refresh = false,
  fetchOi = fetchAnalytics,
} = {}) {
  const { active } = splitSealedSymbols(normalize(watchlist));
  const to = Math.floor(Date.now() / 1000);
  const since = to - 900 * DAY;
  const coverage = [];
  const series = new Map();
  const oiCursors = new Map();
  const eligibleSymbols = [];

  for (const asset of active) {
    try {
      const candles = loadDailyCandles(asset.id);
      if (candles.length < LOOKBACK_DAYS + HORIZON_DAYS + 30) {
        coverage.push({ symbol: asset.symbol, included: false, reason: `insufficient-candle-history (${candles.length} daily bars)` });
        continue;
      }
      const raw = await fetchOi({ symbol: toFuturesSymbol(asset.symbol), type: "open-interest", since, to, interval: DAY, refresh });
      const points = oiPoints(raw?.normalized);
      const days = points.length ? (points.at(-1).revealTime - points[0].revealTime) / DAY : 0;
      if (!points.length || days < MIN_HISTORY_DAYS) {
        coverage.push({ symbol: asset.symbol, included: false, reason: `oi-history-short (${days.toFixed(1)} of ${MIN_HISTORY_DAYS} days)` });
        continue;
      }
      series.set(asset.symbol, candles);
      oiCursors.set(asset.symbol, makeOiChangeAt(points, LOOKBACK_DAYS));
      eligibleSymbols.push(asset.symbol);
      coverage.push({ symbol: asset.symbol, included: true, days: +days.toFixed(1) });
    } catch (err) {
      coverage.push({ symbol: asset.symbol, included: false, reason: `oi-fetch-error: ${err.message}` });
    }
  }

  const baseInput = {
    specification: "cross-sectional-nonprice-rank/v1",
    feature: "open-interest-change",
    lookbackDays: LOOKBACK_DAYS, horizonDays: HORIZON_DAYS, entryDelay: ENTRY_DELAY,
    minAssets: MIN_ASSETS, minHistoryDays: MIN_HISTORY_DAYS, recentHoldoutDates: RECENT_HOLDOUT_DATES,
    roundTripCost: ROUND_TRIP_COST, primaryTopN: PRIMARY_TOP_N, permutations: PERMUTATIONS, alpha: ALPHA,
    expectedSign: EXPECTED_SIGN, coverage,
  };

  if (!series.has("BTC") || eligibleSymbols.length < MIN_ASSETS) {
    return {
      input: { ...baseInput, eligibleAssets: eligibleSymbols },
      result: { verdict: "OI-DATA-INSUFFICIENT", eligibleAssets: eligibleSymbols.length, reason: !series.has("BTC") ? "BTC (regime/calendar factor) not eligible" : `only ${eligibleSymbols.length} eligible assets, need >= ${MIN_ASSETS}` },
    };
  }

  const rows = buildNonPricePanel(series, oiCursors, { universe: eligibleSymbols });
  const btcCandles = series.get("BTC");
  const taggedRows = tagMomentumRegimes(rows, btcCandles);
  const { train, holdout, holdoutDates } = splitByRecentDates(taggedRows, RECENT_HOLDOUT_DATES);

  const scoreOptions = { minAssets: MIN_ASSETS, permutations: PERMUTATIONS, seed: 20260819 };
  const trainScore = scoreMomentumPanelRows(train, scoreOptions);
  const holdoutScore = scoreMomentumPanelRows(holdout, scoreOptions);
  const trainEconomics = economicMomentumViews(train, { minAssets: MIN_ASSETS, roundTripCost: ROUND_TRIP_COST, topNs: [3, 5] });
  const holdoutEconomics = economicMomentumViews(holdout, { minAssets: MIN_ASSETS, roundTripCost: ROUND_TRIP_COST, topNs: [3, 5] });

  const observedSignPositive = Number.isFinite(trainScore.meanIC) && trainScore.meanIC > 0;
  const signCorrect = observedSignPositive === (EXPECTED_SIGN === "positive");
  const naiveSignificant = Number.isFinite(trainScore.p) && trainScore.p < ALPHA;

  const family = [...PRIOR_NHST_FAMILY.map((r) => ({ ...r })), { study: "CROSS-SECTIONAL-NONPRICE-RANK (train, OI-change primary IC)", p: trainScore.p ?? 1, signCorrect }];
  bhFdr(family); // mutates `.q` onto each row in place
  const thisStudyFamilyRow = family[family.length - 1];
  const survivesFamilyFdr = Number.isFinite(thisStudyFamilyRow.q) && thisStudyFamilyRow.q < ALPHA;
  const trainSignificant = naiveSignificant && survivesFamilyFdr;

  let verdict;
  let stage;
  if (!trainSignificant) {
    stage = "train-significance";
    verdict = `CROSS-SECTIONAL-NONPRICE-RANK KILLED at train-significance stage: train meanIC=${trainScore.meanIC?.toFixed(4)}, p=${trainScore.p?.toFixed(4)}` +
      (naiveSignificant ? " (clears naive p<0.05 but does not survive family-wide BH-FDR recomputed across all 10 formal-NHST tests)" : " (fails p<0.05)") +
      (signCorrect ? "" : " (also wrong sign vs pre-registered expectation)");
  } else {
    const primaryHoldout = holdoutEconomics.topN[PRIMARY_TOP_N];
    const economicPass = Number.isFinite(primaryHoldout?.netReturn) && primaryHoldout.netReturn > 0 && holdoutEconomics.observations >= 10;
    stage = "holdout-economics";
    verdict = economicPass
      ? `CROSS-SECTIONAL-NONPRICE-RANK PASS: train IC significant (p=${trainScore.p?.toFixed(4)}, survives family BH-FDR) and holdout top-${PRIMARY_TOP_N} net return ${primaryHoldout.netReturn.toFixed(4)} > 0 over ${holdoutEconomics.observations} observations`
      : `CROSS-SECTIONAL-NONPRICE-RANK FAIL: train IC significant (p=${trainScore.p?.toFixed(4)}) but holdout economic gate not cleared (top-${PRIMARY_TOP_N} net return ${primaryHoldout?.netReturn?.toFixed(4) ?? "n/a"}, observations ${holdoutEconomics.observations}, need netReturn>0 AND observations>=10)`;
  }

  return {
    input: { ...baseInput, eligibleAssets: eligibleSymbols, rebalanceDates: [...new Set(taggedRows.map((r) => r.date))].length, holdoutDates },
    result: {
      trainScore, holdoutScore, trainEconomics, holdoutEconomics,
      signCorrect, naiveSignificant, survivesFamilyFdr, trainSignificant,
      nhstFamily: family,
      stage, verdict,
    },
  };
}

if (process.argv[1]?.endsWith("cross-sectional-nonprice-rank.mjs")) {
  const report = await runCrossSectionalNonPriceRank();
  const saved = saveExperiment("cross-sectional-nonprice-rank", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
