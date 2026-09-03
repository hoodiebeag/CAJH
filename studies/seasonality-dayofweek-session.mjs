/**
 * SEASONALITY-DAYOFWEEK-SESSION: descriptive/exploratory breakdown of `breakout` and
 * `anticipate` HOLDOUT performance by day-of-week and by UTC trading session. Zero prior
 * mention anywhere in this project's research record. Unlike every gated study in this
 * series, this item has no single pass/fail gate by design (per its own task wording) — the
 * deliverable is a full breakdown table across all cells, reported honestly even where a
 * cell looks strong, since slicing seven ways (or three) then picking the best cell is
 * multiple-comparisons p-hacking almost by construction. Any cell that looks promising here
 * is NOT a promotable finding on its own — it becomes a candidate for a separate, freshly
 * pre-registered follow-up item on fresh (non-overlapping) data.
 *
 * Needs no new data source or account access — every input (candle timestamps) already
 * exists in every study run to date, unlike the other four items in this batch.
 *
 * Two related but distinct sub-hypotheses, both computed together since they reuse the same
 * per-trade timestamps (this item's own task wording):
 *   (a) day-of-week — does entry-signal performance differ across the 7 UTC calendar days?
 *       Crypto trades 24/7, but liquidity/participation still clusters around TradFi trading
 *       days.
 *   (b) session — does it differ across Asian/European/US trading-hour windows (UTC offset)?
 * Reported as two separate one-dimensional breakdowns per family (not a combined 7x3 cross
 * table) — the task's own wording treats these as two distinct slicing axes applied to the
 * same trades, and crossing them would fragment an already-modest per-cell trade count into
 * 21 cells instead of 7+3, for a cross-hypothesis this item never actually asks about.
 *
 * SESSION DEFINITION (one disclosed convention, not a sweep): three non-overlapping 8-hour
 * UTC blocks — asian 00:00-08:00, european 08:00-16:00, us 16:00-24:00. Real trading
 * sessions overlap (London/NY, Tokyo/London), but a clean non-overlapping partition avoids
 * an arbitrary double-counting choice and keeps every trade in exactly one cell.
 *
 * ENTRY-TIME ATTRIBUTION: each trade is bucketed by the UTC day/hour of the entry-decision
 * candle's OPEN (not close) — the candle whose close price backtest.js uses as the fill
 * price for breakout/support/etc. modes, and whose high anticipate mode's trigger check
 * fires within. backtestMultiTF has no timestamp field on its `results` array (raw per-trade
 * R only, "for pooling across pairs" per its own comment) — timestamps are recovered here by
 * passing an `entryGate` callback that always returns `true` (a no-op gate, byte-identical
 * trade selection to the ungated baseline) and records `tClose` as a side effect. Because
 * only one position is ever open at a time and `entryGate` is always the LAST condition
 * checked before a candidate is marked "taken" (backtest.js's two entryGate call sites, in
 * "anticipate" mode and in the shared support/breakout/etc. block), each recorded call
 * corresponds to exactly one eventual `results` entry, in the same chronological order — this
 * module's own test suite asserts the resulting per-family bucket totals sum to the reported
 * trade count rather than merely assuming the mapping holds.
 *
 * HOLDOUT ONLY (this item's own task wording: "Apply to breakout/anticipate holdout
 * performance"). Standard 70/30 chronological split on the full local candle history — no
 * external data source here, so (unlike every derivatives-analytics study in this series)
 * there is no coverage-window intersection step; the split is just "last 30% of each asset's
 * own candle history," matching this project's other studies' fraction.
 */
import { backtestMultiTF } from "../backtest.js";
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "../researchlab.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "../strategy.js";

const ENTRY_TF_MINS = 60; // "1h" entryTf, matches BASELINES/every prior gate study
// Exact baseline configs from tournament.mjs's `families` table, applied unmodified so
// results are comparable to every other anticipate/breakout study in this series.
const BASELINES = {
  anticipate: { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true },
  breakout: { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true },
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// One disclosed non-overlapping UTC-hour partition — see module docstring.
const SESSIONS = [
  { name: "asian", startHour: 0, endHour: 8 },
  { name: "european", startHour: 8, endHour: 16 },
  { name: "us", startHour: 16, endHour: 24 },
];

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const seriesFor = (pair) => [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) }));
const sessionFor = (hourUTC) => SESSIONS.find((s) => hourUTC >= s.startHour && hourUTC < s.endHour).name;

/** Chronological 70/30 split of a multi-TF series on its own full candle history — no
 * external data dependency, so (unlike every derivatives-analytics study) there is no
 * coverage-window intersection step first. */
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}

/** Runs one family backtest and recovers each trade's entry-candle OPEN time (UTC seconds)
 * via a no-op entryGate side channel — see module docstring for why this is safe (entryGate
 * never changes trade selection here; it always returns true).
 *
 * One documented edge case (caught by this module's own length-mismatch check during
 * development, on real data — not a hypothetical): a position opened near the very end of
 * the holdout window can still be open (unresolved, no realized R) when the candle series
 * ends. backtestMultiTF drops an unresolved position from `results` entirely rather than
 * mark it to market, but the entryGate call that opened it already recorded a time. Since
 * only one position is ever open at once, at most one trailing time can be orphaned this
 * way; it is dropped here rather than mis-attributing a phantom trade to a day/session
 * bucket. */
function runWithEntryTimes(series, config) {
  const times = [];
  const entryGate = (tClose) => { times.push(tClose - ENTRY_TF_MINS * 60); return true; };
  const result = backtestMultiTF({ series }, { ...config, entryTf: "1h", feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, entryGate });
  const trimmed = times.length > result.results.length ? times.slice(0, result.results.length) : times;
  return { result, times: trimmed };
}

const emptyBucket = () => ({ trades: 0, totalR: 0 });
const newBreakdown = () => ({
  dayOfWeek: Object.fromEntries(DAY_NAMES.map((d) => [d, emptyBucket()])),
  session: Object.fromEntries(SESSIONS.map((s) => [s.name, emptyBucket()])),
});

/** Buckets one asset's already-computed trades into the running per-family breakdown.
 * Throws (rather than silently mis-attributing) if the entry-time/result recovery described
 * in the module docstring ever produces mismatched lengths. */
function accumulate(breakdown, times, results) {
  if (times.length !== results.length) throw new Error(`entry-time/result length mismatch: ${times.length} vs ${results.length}`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const d = new Date(times[i] * 1000);
    const day = DAY_NAMES[d.getUTCDay()];
    const session = sessionFor(d.getUTCHours());
    breakdown.dayOfWeek[day].trades++; breakdown.dayOfWeek[day].totalR += r;
    breakdown.session[session].trades++; breakdown.session[session].totalR += r;
  }
}

function finalizeBreakdown(breakdown) {
  const finalize = (buckets) => Object.fromEntries(
    Object.entries(buckets).map(([k, b]) => [k, { trades: b.trades, totalR: +b.totalR.toFixed(6), avgR: b.trades ? b.totalR / b.trades : 0 }])
  );
  return { dayOfWeek: finalize(breakdown.dayOfWeek), session: finalize(breakdown.session) };
}

export async function runSeasonalityDayOfWeekSession({
  watchlist = loadWatchlist(), splitFraction = .70, minCandles = 250,
} = {}) {
  const coverage = [];
  const eligible = [];
  for (const asset of normalize(watchlist)) {
    const s = seriesFor(asset.id);
    if (!s.every((tf) => tf.candles.length >= minCandles)) { coverage.push({ symbol: asset.symbol, included: false, reason: "insufficient-candle-history" }); continue; }
    eligible.push({ symbol: asset.symbol, id: asset.id, s });
    coverage.push({ symbol: asset.symbol, included: true });
  }

  const baseInput = { specification: "seasonality-dayofweek-session/v1", splitFraction, minCandles, feeRate: FEE_RATE, slipPct: SLIPPAGE_PCT, coverage };

  if (!eligible.length) {
    return { input: baseInput, result: { verdict: "SEASONALITY-DATA-INSUFFICIENT", eligibleAssets: 0, families: {} } };
  }

  const families = {};
  for (const target of ["breakout", "anticipate"]) {
    const breakdown = newBreakdown();
    let totalTrades = 0, totalR = 0;
    const perAsset = [];
    for (const d of eligible) {
      const holdoutSeries = splitSeries(d.s, splitFraction, true);
      const { result, times } = runWithEntryTimes(holdoutSeries, BASELINES[target]);
      accumulate(breakdown, times, result.results);
      totalTrades += result.trades; totalR += result.totalR;
      perAsset.push({ symbol: d.symbol, trades: result.trades, avgR: result.avgR });
    }
    families[target] = {
      holdout: { trades: totalTrades, totalR: +totalR.toFixed(6), avgR: totalTrades ? totalR / totalTrades : 0 },
      breakdown: finalizeBreakdown(breakdown),
      perAsset,
    };
  }

  return {
    input: { ...baseInput, eligibleAssets: eligible.map((a) => a.symbol) },
    result: {
      families,
      verdict: "SEASONALITY-DAYOFWEEK-SESSION: descriptive breakdown only, no pre-registered gate (this item's own done_when) — any strong-looking cell is a candidate for a SEPARATE freshly pre-registered follow-up on fresh data, not a promotable result on its own.",
    },
  };
}

if (process.argv[1]?.endsWith("seasonality-dayofweek-session.mjs")) {
  const report = await runSeasonalityDayOfWeekSession();
  const saved = saveExperiment("seasonality-dayofweek-session", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
