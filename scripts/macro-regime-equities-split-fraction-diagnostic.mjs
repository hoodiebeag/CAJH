/**
 * MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC — re-run of
 * MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES's construct, unmodified except the train/holdout split
 * fraction, per that study's own "what would actually resolve this" lever (b): "revisiting the
 * split fraction itself for macro-regime studies specifically, since regime episodes are
 * calendar-rare events and a 30% holdout of even a multi-year window can land entirely inside
 * one." Lever (a) (a genuinely longer equities window via IBKR Gateway) remains blocked
 * (ECONNREFUSED 127.0.0.1:4002 on a fresh `node scripts/ibkr-smoke.mjs` check this run too,
 * matching EXOGENOUS-DATA-ACCESS-AUDIT's documented intermittent-IBKR finding) and is not
 * agent-actionable from this host, so this item pursues lever (b) instead.
 *
 * PRE-REGISTRATION (before touching any equities return this run): TRAIN_FRACTION = 0.5
 * (50/50), chosen as the single alternative split named in this item's own work_queue note
 * ("e.g. 50/50, giving ~250/250 days") — not a sweep, not tuned after seeing results, per
 * MULTIPLE_COMPARISONS_AUDIT.md's discipline against open-ended parameter search. On the 500-day
 * cached window this yields 250 train / 250 holdout days, more than 2x the prior 70/30 study's
 * 150-day holdout, testing directly whether that was enough additional holdout calendar time to
 * clear MIN_HOLDOUT_EPISODES_FOR_CI=8 given how calendar-rare macro regime flips are.
 *
 * EVERYTHING ELSE — byte-identical to macro-regime-primary-signal-equities.mjs: same regime
 * definition (majority vote of DTWEXBGS-vs-own-200d-MA / DGS10-DGS2 sign / FEDFUNDS
 * trailing-3-month-change sign), same hysteresis bands (+-1%/+-10bp/+-5bp), same causal lags
 * (1/1/20 days), same 30-symbol DJIA universe from the same research-cache/equities-1d/ cache,
 * same cost model (equal-weight mean of each symbol's own feeRate over its holdout window, plus
 * slippage), same MIN_HOLDOUT_EPISODES_FOR_CI=8 floor, same bootstrap/sign-flip test if that
 * floor clears. fetchFredSeries/lookupLagged/trailingMA/contiguousEpisodes/scoreSegment
 * duplicated verbatim from that script (same un-exported-helper-duplication pattern
 * equities-madip-significance.mjs already used for momentum.mjs's un-exported seeded()).
 */
import fs from "fs";
import path from "path";
import { blockBootstrapCI } from "../momentum.mjs";
import { saveExperiment } from "../researchlab.mjs";

const TRAIN_FRACTION = 0.5; // pre-registered per this item's work_queue note; single value, not a sweep
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // same pre-registered floor as the 70/30 study

const COMMISSION_PER_SHARE = 0.005; // equities-madip-significance.mjs convention
const SLIPPAGE_PCT_EQUITY = 0.0005; // equities-madip-significance.mjs convention

const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
]; // equities-all-families-baseline.mjs / equities-madip-significance.mjs's standing DJIA universe

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

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
  // --- macro data (identical sources/thresholds to macro-regime-primary-signal-equities.mjs) ---
  const [dxy, dgs10, dgs2, fedfunds] = await Promise.all([
    fetchFredSeries("DTWEXBGS"),
    fetchFredSeries("DGS10"),
    fetchFredSeries("DGS2"),
    fetchFredSeries("FEDFUNDS"),
  ]);
  if (!dxy.length || !dgs10.length || !dgs2.length || !fedfunds.length) {
    throw new Error("One or more FRED series returned no data - aborting rather than proceeding on a partial fetch");
  }

  const dxyMA = dxy.map((_, i) => trailingMA(dxy, i, 200));
  const spread = dgs10.map((p) => {
    const d2 = lookupLagged(dgs2, p.t + 1, 0);
    return d2 ? { t: p.t, value: p.value - d2.value } : null;
  }).filter(Boolean);
  const fedChange = fedfunds.map((p, i) => (i >= 3 ? { t: p.t, value: p.value - fedfunds[i - 3].value } : null)).filter(Boolean);

  // --- universe: 30-symbol DJIA basket from the cache, common bars only ---
  const candlesBySymbol = new Map();
  const universeSymbols = [];
  for (const sym of UNIVERSE) {
    const candles = loadCached(sym);
    if (!candles) { console.error(`MISSING CACHE: ${sym} - excluded from universe`); continue; }
    candlesBySymbol.set(sym, candles);
    universeSymbols.push(sym);
  }
  const tsSets = universeSymbols.map((sym) => new Set(candlesBySymbol.get(sym).map((c) => Number(c.time))));
  const commonTimes = [...tsSets[0]].filter((t) => tsSets.every((s) => s.has(t))).sort((a, b) => a - b);

  const bySymbolByTime = new Map();
  for (const sym of universeSymbols) {
    const m = new Map(candlesBySymbol.get(sym).map((c) => [Number(c.time), c]));
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
      return Number(cur.close) / Number(prev.close) - 1;
    });
    const universeReturn = rets.reduce((a, b) => a + b, 0) / rets.length;

    const tMs = t * 1000;
    const dxyPoint = lookupLagged(dxyWithMA, tMs, 1);
    const spreadPoint = lookupLagged(spread, tMs, 1);
    const fedPoint = lookupLagged(fedChange, tMs, 20);
    if (!dxyPoint || dxyPoint.ma == null || !spreadPoint || !fedPoint) continue;

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

  // per-symbol feeRate from that symbol's own holdout-window average close (equities-madip-significance.mjs
  // convention), averaged equal-weight across the universe into a single portfolio-level per-flip cost.
  const holdoutDates = new Set(holdout.map((d) => d.t));
  const feeRates = universeSymbols.map((sym) => {
    const m = bySymbolByTime.get(sym);
    const closes = [...holdoutDates].map((t) => m.get(t)).filter(Boolean).map((c) => Number(c.close));
    const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
    return COMMISSION_PER_SHARE / avgClose;
  });
  const avgFeeRate = feeRates.reduce((a, b) => a + b, 0) / feeRates.length;
  const ONE_SIDE_COST_EQUITY = avgFeeRate + SLIPPAGE_PCT_EQUITY;

  function scoreSegment(segment) {
    const labels = segment.map((d) => d.regime);
    const episodes = contiguousEpisodes(labels);
    let exposure = 0;
    const stratReturns = [];
    const bhReturns = [];
    for (let i = 0; i < segment.length; i++) {
      const targetExposure = segment[i].regime === "favourable" ? 1 : 0;
      let dayReturn = targetExposure === 1 ? segment[i].universeReturn : 0;
      if (targetExposure !== exposure) dayReturn -= ONE_SIDE_COST_EQUITY;
      exposure = targetExposure;
      stratReturns.push(dayReturn);
      bhReturns.push(segment[i].universeReturn);
    }
    if (bhReturns.length) {
      bhReturns[0] -= ONE_SIDE_COST_EQUITY;
      bhReturns[bhReturns.length - 1] -= ONE_SIDE_COST_EQUITY;
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
  let signFlip = null;
  let verdict;
  if (holdoutScore.episodes < MIN_HOLDOUT_EPISODES_FOR_CI) {
    verdict = "NON-VERDICT: holdout regime-episode count too small to support any CI";
  } else {
    holdoutCI = blockBootstrapCI(holdoutScore.stratReturnsForCI, { blockSize: 20 });
    // one-sided sign-flip permutation test on per-episode strategy-minus-buyhold spread, matching
    // this project's per-independent-unit convention (episode = effective-n unit here).
    const episodes = contiguousEpisodes(holdout.map((d) => d.regime));
    const episodeSpreads = episodes.map((e) => {
      let stratSum = 0, bhSum = 0;
      for (let i = e.startIdx; i <= e.endIdx; i++) {
        stratSum += holdoutScore.stratReturnsForCI[i];
        bhSum += holdout[i].universeReturn;
      }
      return stratSum - bhSum;
    });
    const observedMean = episodeSpreads.reduce((a, b) => a + b, 0) / episodeSpreads.length;
    const ITERATIONS = 5000;
    let state = 20260827 >>> 0;
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let extreme = 0;
    for (let n = 0; n < ITERATIONS; n++) {
      let sum = 0;
      for (const v of episodeSpreads) sum += random() < 0.5 ? v : -v;
      if (sum / episodeSpreads.length >= observedMean) extreme++;
    }
    signFlip = { observedMean, p: (extreme + 1) / (ITERATIONS + 1), iterations: ITERATIONS, n: episodeSpreads.length };
    verdict = holdoutScore.strategyReturn > holdoutScore.buyHoldReturn ? "EXPOSURE-SIGNAL-BEATS-BUYHOLD" : "EXPOSURE-SIGNAL-DOES-NOT-BEAT-BUYHOLD";
  }

  const result = {
    trainFraction: TRAIN_FRACTION,
    universeSymbols,
    oneSideCostEquity: ONE_SIDE_COST_EQUITY,
    windowStart: days[0]?.date,
    windowEnd: days[days.length - 1]?.date,
    trainWindow: [train[0]?.date, train[train.length - 1]?.date],
    holdoutWindow: [holdout[0]?.date, holdout[holdout.length - 1]?.date],
    priorStudyComparison: { trainFraction: 0.7, trainDays: 350, trainEpisodes: 4, holdoutDays: 150, holdoutEpisodes: 1 },
    train: { days: trainScore.days, episodes: trainScore.episodes, episodeLengths: trainScore.episodeLengths, strategyReturn: trainScore.strategyReturn, buyHoldReturn: trainScore.buyHoldReturn, hitRate: trainScore.hitRate },
    holdout: { days: holdoutScore.days, episodes: holdoutScore.episodes, episodeLengths: holdoutScore.episodeLengths, strategyReturn: holdoutScore.strategyReturn, buyHoldReturn: holdoutScore.buyHoldReturn, hitRate: holdoutScore.hitRate, ci95: holdoutCI, signFlip },
    verdict,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("macro-regime-equities-split-fraction-diagnostic", { universe: universeSymbols, sources: ["DTWEXBGS", "DGS10", "DGS2", "FEDFUNDS"], commissionPerShare: COMMISSION_PER_SHARE, slippagePctEquity: SLIPPAGE_PCT_EQUITY, trainFraction: TRAIN_FRACTION }, result);
  console.error(`\nSaved to ${file}`);
}

main();
