/**
 * CANDLE-CORPUS-GAP-AUDIT (read-only diagnostic, not part of the app). Every backtest in this
 * project calls loadResearchCandles -> loadResearchCandlesWithQuality with the default
 * gapPolicy "allow" and only ever reads back `.candles` (researchlab.mjs:92-93) - the `gaps`
 * array data.js's resampleBars computes alongside them (data.js:170-174) is discarded at every
 * call site. Nobody has ever looked at whether the corpus this project's ~27 prior verdicts
 * rest on actually has holes. This audits it: measurement only, no repair, no backfill, no
 * watchlist change.
 *
 * SCOPE: full watchlist (loadWatchlist(), 29 assets) including SEALED_SYMBOLS. This is a
 * data-completeness check, not a train/holdout performance sweep — splitSealedSymbols()'s own
 * docstring reserves the seal for "any train/holdout cycle" that measures edge; counting missing
 * bars touches no strategy result and reveals nothing about performance on sealed symbols, so it
 * does not "spend" the holdout in the sense researchlib.mjs warns against. Flagged explicitly
 * here rather than silently deciding it either way.
 *
 * RAW GAPS ARE TIMEFRAME-INVARIANT — a finding of this audit, not an assumption going in.
 * resampleBars (data.js:169-174) computes `gaps` by walking the sorted 1-MINUTE bars from
 * loadBars(pair) *before* binning into the requested `minutes` timeframe; the gap list itself
 * (from/to/seconds) is therefore identical whether you ask for 1h, 4h, or 1d candles on the
 * same pair. What genuinely differs per timeframe is how much a given raw gap actually costs
 * that timeframe's candle series: a 45-minute hole is invisible to 1d candles (well under one
 * bar) but can span nearly a full 1h candle. Each timeframe row below reports the SAME
 * underlying raw gaps translated into that timeframe's own units: missing-candle-equivalent
 * count (totalGapSeconds / tfSpanSeconds) and largest-gap-in-candles.
 *
 * TRAIN/HOLDOUT SPLIT: the project's standard chronological 70/30 split (trainFraction 0.7,
 * matching walkForwardWindows' default and every other study's own splitSeries helper), computed
 * per-timeframe from that timeframe's own resampled candle count/timestamps — so the cut lands on
 * a slightly different absolute time per TF (a fraction-of-bar-count cut over different bar
 * counts), reported per-TF for exactness rather than assuming the three timeframes agree.
 *
 * FLAG THRESHOLD: an asset/timeframe is flagged if missing bar-time exceeds 1% of its covered
 * window. Stated explicitly (not fabricated): even a single-digit percentage of a multi-year
 * history is enough raw missing time to plausibly straddle several of the modest per-asset trade
 * counts (tens, not thousands) every price-structure verdict in this project pools across.
 *
 * STALENESS: the trailing edge between an asset's last stored candle and wall-clock "now" is
 * invisible to resampleBars' `gaps` array — it only diffs between bars that both exist, never
 * against the current time — yet for a live-collected corpus this trailing edge is often the
 * single largest discontinuity of all: a stalled collector shows up as data that quietly stops,
 * not as an internal gap. Reported separately (stalenessDays, flagged past STALE_DAYS=14) rather
 * than folded into totalGapSec/missingFraction.
 */
import { loadWatchlist, symbolToKrakenId, TFS } from "../../researchlib.mjs";
import { loadResearchCandlesWithQuality, saveExperiment } from "../../researchlab.mjs";

const FLAG_FRACTION = 0.01; // "materially affects results" threshold, see module docstring
const TRAIN_FRACTION = 0.7; // this project's standard chronological split
const STALE_DAYS = 14; // flag threshold for "collection appears stalled", see module docstring

const nowSec = Math.floor(Date.now() / 1000);
const watchlist = loadWatchlist();
const rows = [];

for (const sym of watchlist) {
  const pair = symbolToKrakenId(sym);
  for (const [label, mins] of TFS) {
    const { candles, gaps } = loadResearchCandlesWithQuality(pair, mins, { gapPolicy: "allow" });
    if (!candles.length) {
      rows.push({ symbol: sym, timeframe: label, status: "no-data" });
      continue;
    }
    const tfSpanSec = mins * 60;
    const windowStart = candles[0].time;
    const windowEnd = candles.at(-1).time + tfSpanSec;
    const windowSec = windowEnd - windowStart;

    const totalGapSec = gaps.reduce((a, g) => a + g.seconds, 0);
    const largestGapSec = gaps.reduce((a, g) => Math.max(a, g.seconds), 0);
    const missingFraction = windowSec > 0 ? totalGapSec / windowSec : 0;

    // The trailing edge between the last stored candle and "now" is invisible to gaps[]
    // (resampleBars only diffs between EXISTING consecutive bars, never against wall-clock
    // time) — yet for a live-collected corpus this is often the single largest, most
    // consequential discontinuity: a stalled collector produces no internal gap at all, just
    // a corpus that quietly stops. Reported separately, not folded into totalGapSec/gapCount.
    const stalenessSec = Math.max(0, nowSec - (candles.at(-1).time + tfSpanSec));

    const cutIdx = Math.floor(candles.length * TRAIN_FRACTION);
    const cutTime = candles[Math.min(cutIdx, candles.length - 1)].time;
    let trainGapSec = 0, holdoutGapSec = 0;
    for (const g of gaps) {
      const mid = (g.from + g.to) / 2;
      if (mid < cutTime) trainGapSec += g.seconds; else holdoutGapSec += g.seconds;
    }

    rows.push({
      symbol: sym, timeframe: label, status: "ok",
      candleCount: candles.length,
      windowStart: new Date(windowStart * 1000).toISOString(),
      windowEnd: new Date(windowEnd * 1000).toISOString(),
      gapCount: gaps.length,
      totalGapSec, largestGapSec,
      largestGapCandles: largestGapSec / tfSpanSec,
      missingCandleEquivalent: totalGapSec / tfSpanSec,
      missingFraction,
      trainGapSec, holdoutGapSec,
      cutTime: new Date(cutTime * 1000).toISOString(),
      flagged: missingFraction > FLAG_FRACTION,
      stalenessDays: stalenessSec / 86400,
      staleFlagged: stalenessSec / 86400 > STALE_DAYS,
    });
  }
}

const ok = rows.filter((r) => r.status === "ok");
const flagged = ok.filter((r) => r.flagged);
const noData = rows.filter((r) => r.status === "no-data");
const staleBySymbol = new Map();
for (const r of ok) if (r.staleFlagged && !staleBySymbol.has(r.symbol)) staleBySymbol.set(r.symbol, r.stalenessDays);

const report = {
  watchlistSize: watchlist.length,
  timeframes: TFS.map(([label]) => label),
  trainFraction: TRAIN_FRACTION,
  flagFraction: FLAG_FRACTION,
  staleDaysThreshold: STALE_DAYS,
  nowISO: new Date(nowSec * 1000).toISOString(),
  assetsTotal: watchlist.length,
  rowsTotal: rows.length,
  flaggedCount: flagged.length,
  flagged: flagged.map((r) => ({ symbol: r.symbol, timeframe: r.timeframe, missingFraction: r.missingFraction, gapCount: r.gapCount, largestGapCandles: r.largestGapCandles })),
  staleSymbols: [...staleBySymbol.entries()].sort((a, b) => b[1] - a[1]).map(([symbol, stalenessDays]) => ({ symbol, stalenessDays })),
  noDataSymbols: noData.map((r) => r.symbol),
  rows: rows.sort((a, b) => (b.missingFraction || 0) - (a.missingFraction || 0)),
};

const saved = saveExperiment("candle-corpus-gap-audit", { universe: watchlist, parameters: { trainFraction: TRAIN_FRACTION, flagFraction: FLAG_FRACTION, timeframes: TFS.map(([l]) => l) } }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
