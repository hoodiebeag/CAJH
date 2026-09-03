/**
 * MACRO-REGIME-PRIMARY-SIGNAL — a market-exposure signal from macro data that is genuinely
 * exogenous to this project's own price/positioning series (unlike every prior alt-data source
 * tested here: funding, OI, basis, long/short ratio, top-traders, aggressor flow, liquidations,
 * realized vol — all endogenous to the same market being traded). Sources confirmed reachable
 * by EXOGENOUS-DATA-ACCESS-AUDIT: FRED's public CSV export for DTWEXBGS (Broad Dollar Index,
 * ICE's own DXY ticker isn't on FRED), DGS10/DGS2 (10y/2y Treasury), FEDFUNDS (policy rate).
 * DGS2 itself was not probed by that audit; re-confirmed reachable here (1976-present) before
 * building anything on it.
 *
 * STRUCTURAL REQUIREMENT (per this item's own note): this generates market EXPOSURE directly —
 * long the universe when the regime is favourable, flat when not — never a gate/filter on
 * breakout/anticipate. Template A (entry-signal gates on a population with no gross edge) is
 * retired; this is a different mechanism shape entirely.
 *
 * REGIME DEFINITION — fixed here, using only conventional/textbook thresholds, before any
 * crypto return data is touched. Majority vote (>=2 of 3) of:
 *   1. Dollar trend: DTWEXBGS below its own trailing 200-session MA = favourable (weak dollar
 *      loosens global liquidity), else unfavourable. Standard 200dma trend filter.
 *   2. Yield curve: DGS10 - DGS2 > 0 = favourable (normal curve), <=0 = unfavourable (inverted).
 *      THE standard recession-risk indicator, not fit to this data.
 *   3. Policy direction: FEDFUNDS trailing 3-month change <=0 (holding/cutting) = favourable,
 *      rising = unfavourable. Standard hiking/cutting-cycle framing.
 * None of these three thresholds were searched or tuned against this project's crypto data —
 * they are the conventional definitions used across macro finance generally, chosen specifically
 * so this is not another instance of fitting a rule to the series it will be scored against.
 *
 * HYSTERESIS — added after the first run of this script produced a composite regime with
 * repeated single-day episodes (a whipsaw at a raw threshold crossing, immediately followed by
 * a flip back), the exact failure mode this project's own `momentum.mjs::btcRegimeMap` already
 * carries a dead-band for for the identical reason. This is a design correction applied before
 * any writeup or conclusion was drawn from the first run's output, using this codebase's own
 * pre-existing convention (a fixed dead-band, previous value carried forward inside it) — not a
 * threshold search against this run's own return result. Bands: DXY vs its MA, +-1% (matching
 * `btcRegimeMap`'s own default exactly); yield curve, +-10bp around zero; Fed funds 3-month
 * change, +-5bp around zero. Each sub-signal carries its prior day's value forward while inside
 * its own band; before any signal has a prior value, the raw (bandless) comparison is used once
 * to seed it.
 *
 * CAUSAL ALIGNMENT (no lookahead). Every macro series is looked up as the latest published value
 * dated STRICTLY BEFORE (crypto trading day - lagDays): 1 day for the two daily series
 * (DTWEXBGS, DGS10/DGS2 — next-business-day publication is a safe conservative lag), 20 days for
 * FEDFUNDS (a MONTHLY average only fully known after month-end; FRED typically publishes within
 * days, 20 is deliberately conservative).
 *
 * UNIVERSE — chosen on coverage grounds alone, before any regime/return result was computed:
 * of the 24 active (non-SEALED_SYMBOLS) watchlist assets, only 10 have local candle coverage for
 * the full 2023-01-01..2026-03-31 window this store holds; the rest start 2025-01-22 or later
 * (14 months or less — the task's own sample-size warning made this the wrong choice before
 * looking at anything else). ADA, APT, ATOM, BTC, DOGE, DOT, FIL, INJ, LTC, XRP — equal-weight,
 * daily rebalance-in-name-only (weights never drift enough within a single macro regime episode
 * to matter; no drift correction applied, disclosed as a simplification).
 *
 * COST — this project's standing real crypto cost basis (FEE_RATE=0.008/side +
 * SLIPPAGE_PCT=0.0005/side, ~1.7% round trip), applied once on every regime-flip day (entering
 * or exiting the whole basket is one portfolio-level transition, not multiplied by asset count —
 * equal weighting already normalizes position size to 1x NAV regardless of how many assets share
 * it).
 *
 * SAMPLE-SIZE HONESTY (the task's own explicit ask): macro regimes turn over a handful of times
 * a year at most, so effective n is the count of independent regime EPISODES (contiguous runs of
 * one label), not the day count. Computed and reported for train and holdout separately; if the
 * holdout episode count cannot support a bootstrap CI (this study's own working floor: at least
 * 8, chosen before looking at the count, matching this project's other studies' minimum-sample
 * floors — e.g. FUNDING-MEANREV's >=150 trades, OPEN-INTEREST-TREND-CONFIRMATION's >=150 —
 * scaled down for a much lower-frequency mechanism where dozens of episodes were never a
 * realistic bar), this is recorded as a non-verdict, not a point estimate.
 */
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols } from "../../researchlib.mjs";
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { blockBootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real cost basis
const TRAIN_FRACTION = 0.7;
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // pre-registered floor, see module docstring

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

function trailingMA(series, index, window) {
  if (index + 1 < window) return null;
  let sum = 0;
  for (let i = index - window + 1; i <= index; i++) sum += series[i].value;
  return sum / window;
}

function contiguousEpisodes(labels) {
  const episodes = [];
  let start = 0;
  for (let i = 1; i <= labels.length; i++) {
    if (i === labels.length || labels[i] !== labels[start]) {
      episodes.push({ label: labels[start], startIdx: start, endIdx: i - 1, length: i - start });
      start = i;
    }
  }
  return episodes;
}

async function main() {
  // --- macro data ---
  const [dxy, dgs10, dgs2, fedfunds] = await Promise.all([
    fetchFredSeries("DTWEXBGS"),
    fetchFredSeries("DGS10"),
    fetchFredSeries("DGS2"),
    fetchFredSeries("FEDFUNDS"),
  ]);
  if (!dxy.length || !dgs10.length || !dgs2.length || !fedfunds.length) {
    throw new Error("One or more FRED series returned no data - aborting rather than proceeding on a partial fetch");
  }

  // pre-compute DTWEXBGS's own 200-session trailing MA, indexed the same as `dxy`
  const dxyMA = dxy.map((_, i) => trailingMA(dxy, i, 200));

  // yield-curve spread series (dates from DGS10, matched to nearest DGS2 <= same date)
  const spread = dgs10.map((p) => {
    const d2 = lookupLagged(dgs2, p.t + 1, 0); // same-day-or-earlier DGS2 point
    return d2 ? { t: p.t, value: p.value - d2.value } : null;
  }).filter(Boolean);

  // FEDFUNDS trailing 3-month change series
  const fedChange = fedfunds.map((p, i) => (i >= 3 ? { t: p.t, value: p.value - fedfunds[i - 3].value } : null)).filter(Boolean);

  // --- universe: 10-symbol coverage-driven basket, common bars only ---
  const watchlist = loadWatchlist();
  const { active } = splitSealedSymbols(watchlist);
  const activeSymbols = active.map((e) => (typeof e === "string" ? e : e.symbol));
  const candlesBySymbol = new Map();
  for (const sym of activeSymbols) {
    const pair = symbolToKrakenId(sym);
    candlesBySymbol.set(sym, loadDailyCandles(pair));
  }
  const FULL_START = Date.parse("2023-01-01T00:00:00Z");
  const universeSymbols = activeSymbols.filter((sym) => {
    const c = candlesBySymbol.get(sym);
    return c.length > 0 && c[0].time * 1000 <= FULL_START;
  });
  // intersect timestamps across the chosen universe
  const tsSets = universeSymbols.map((sym) => new Set(candlesBySymbol.get(sym).map((c) => c.time)));
  const commonTimes = [...tsSets[0]].filter((t) => tsSets.every((s) => s.has(t))).sort((a, b) => a - b);

  const bySymbolByTime = new Map();
  for (const sym of universeSymbols) {
    const m = new Map(candlesBySymbol.get(sym).map((c) => [c.time, c]));
    bySymbolByTime.set(sym, m);
  }

  // daily equal-weight universe simple return, and per-day regime label
  const dxyWithMA = dxy.map((p, idx) => ({ ...p, ma: dxyMA[idx] }));
  const DXY_BAND = 0.01, CURVE_BAND_PP = 0.10, FED_BAND_PP = 0.05;
  let prevDxySignal = null, prevCurveSignal = null, prevPolicySignal = null;
  const days = [];
  for (let i = 1; i < commonTimes.length; i++) {
    const t = commonTimes[i];
    const rets = universeSymbols.map((sym) => {
      const cur = bySymbolByTime.get(sym).get(t);
      const prev = bySymbolByTime.get(sym).get(commonTimes[i - 1]);
      return cur.close / prev.close - 1;
    });
    const universeReturn = rets.reduce((a, b) => a + b, 0) / rets.length;

    const tMs = t * 1000;
    const dxyPoint = lookupLagged(dxyWithMA, tMs, 1);
    const spreadPoint = lookupLagged(spread, tMs, 1);
    const fedPoint = lookupLagged(fedChange, tMs, 20);
    if (!dxyPoint || dxyPoint.ma == null || !spreadPoint || !fedPoint) continue; // insufficient macro history yet

    const dxySignal = dxyPoint.value > dxyPoint.ma * (1 + DXY_BAND) ? -1
      : dxyPoint.value < dxyPoint.ma * (1 - DXY_BAND) ? 1
      : (prevDxySignal ?? (dxyPoint.value < dxyPoint.ma ? 1 : -1));
    const curveSignal = spreadPoint.value > CURVE_BAND_PP ? 1
      : spreadPoint.value < -CURVE_BAND_PP ? -1
      : (prevCurveSignal ?? (spreadPoint.value > 0 ? 1 : -1));
    const policySignal = fedPoint.value < -FED_BAND_PP ? 1
      : fedPoint.value > FED_BAND_PP ? -1
      : (prevPolicySignal ?? (fedPoint.value <= 0 ? 1 : -1));
    prevDxySignal = dxySignal; prevCurveSignal = curveSignal; prevPolicySignal = policySignal;

    const composite = dxySignal + curveSignal + policySignal;
    const regime = composite > 0 ? "favourable" : "unfavourable";

    days.push({ date: new Date(tMs).toISOString().slice(0, 10), t, universeReturn, regime, dxySignal, curveSignal, policySignal });
  }

  // --- train/holdout split ---
  const cut = Math.floor(days.length * TRAIN_FRACTION);
  const train = days.slice(0, cut);
  const holdout = days.slice(cut);

  function scoreSegment(segment) {
    const labels = segment.map((d) => d.regime);
    const episodes = contiguousEpisodes(labels);
    let exposure = 0; // starts flat
    const stratReturns = [];
    const bhReturns = [];
    for (let i = 0; i < segment.length; i++) {
      const targetExposure = segment[i].regime === "favourable" ? 1 : 0;
      let dayReturn = targetExposure === 1 ? segment[i].universeReturn : 0;
      if (targetExposure !== exposure) dayReturn -= ONE_SIDE_COST; // one-sided cost on the flip day
      exposure = targetExposure;
      stratReturns.push(dayReturn);
      bhReturns.push(segment[i].universeReturn);
    }
    // one-time entry cost for buy-and-hold, and exit cost at the end (fair comparison)
    if (bhReturns.length) {
      bhReturns[0] -= ONE_SIDE_COST;
      bhReturns[bhReturns.length - 1] -= ONE_SIDE_COST;
    }
    const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const hitRate = segment.filter((d) => (d.regime === "favourable") === (d.universeReturn > 0)).length / segment.length;
    return {
      days: segment.length,
      episodes: episodes.length,
      episodeLengths: episodes.map((e) => e.length),
      strategyReturn: compound(stratReturns),
      buyHoldReturn: compound(bhReturns),
      hitRate,
      stratReturnsForCI: stratReturns,
    };
  }

  const trainScore = scoreSegment(train);
  const holdoutScore = scoreSegment(holdout);

  let holdoutCI = null;
  let verdict;
  if (holdoutScore.episodes < MIN_HOLDOUT_EPISODES_FOR_CI) {
    verdict = "NON-VERDICT: holdout regime-episode count too small to support any CI";
  } else {
    holdoutCI = blockBootstrapCI(holdoutScore.stratReturnsForCI, { blockSize: 20 });
    verdict = holdoutScore.strategyReturn > holdoutScore.buyHoldReturn ? "EXPOSURE-SIGNAL-BEATS-BUYHOLD" : "EXPOSURE-SIGNAL-DOES-NOT-BEAT-BUYHOLD";
  }

  const result = {
    universeSymbols,
    windowStart: days[0]?.date,
    windowEnd: days[days.length - 1]?.date,
    trainWindow: [train[0]?.date, train[train.length - 1]?.date],
    holdoutWindow: [holdout[0]?.date, holdout[holdout.length - 1]?.date],
    train: { days: trainScore.days, episodes: trainScore.episodes, episodeLengths: trainScore.episodeLengths, strategyReturn: trainScore.strategyReturn, buyHoldReturn: trainScore.buyHoldReturn, hitRate: trainScore.hitRate },
    holdout: { days: holdoutScore.days, episodes: holdoutScore.episodes, episodeLengths: holdoutScore.episodeLengths, strategyReturn: holdoutScore.strategyReturn, buyHoldReturn: holdoutScore.buyHoldReturn, hitRate: holdoutScore.hitRate, ci95: holdoutCI },
    verdict,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("macro-regime-primary-signal", { universeSymbols, sources: ["DTWEXBGS", "DGS10", "DGS2", "FEDFUNDS"] }, result);
  console.error(`\nSaved to ${file}`);
}

main();
