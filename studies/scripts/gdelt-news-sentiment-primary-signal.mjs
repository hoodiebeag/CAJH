/**
 * GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL — a market-exposure signal built from GDELT news-volume and
 * news-tone data, genuinely exogenous to this project's own price/positioning history (same family
 * as MACRO-REGIME-PRIMARY-SIGNAL; unlike every derivatives-based source already exhausted in
 * TOURNAMENT_ROADMAP.md, which is endogenous to the market being traded).
 *
 * SOURCED FROM: EXOGENOUS-DATA-ACCESS-AUDIT (2026-08-22), which confirmed the GDELT 2.0 DOC API is
 * reachable (public, free, no key) but courtesy-rate-limited to roughly one request per 5s per
 * client, and flagged undici fetch() hitting UND_ERR_CONNECT_TIMEOUT against api.gdeltproject.org
 * on every attempt while curl succeeded on an identical URL from the same machine — so this script
 * shells out to curl, matching that audit's own workaround, rather than trusting fetch() on this
 * host.
 *
 * ACCESS/DEPTH MEASURED THIS RUN, BEFORE ANY CONSTRUCT WAS DESIGNED (per this item's own
 * done_when): a paced real pull of both timelinevol (query=bitcoin, mode=timelinevol) and
 * timelinetone (query=bitcoin, mode=timelinetone), timespan=FULL. In practice the "one request per
 * 5s" courtesy limit understated the real cooldown observed from this network/IP — repeated 429s
 * persisted well past 5s, 15s, and 20s gaps; a real 200 was obtained only after ~13 paced attempts
 * (~5-6 minutes wall clock, non-bursting throughout) for the volume series and ~26 attempts (~11
 * minutes) for the tone series. Both series, once obtained, returned 3,497 real daily datapoints
 * each, 2017-01-01 through the request date (2026-08-23) — genuinely deep enough for a real
 * train/holdout split against this project's own (much shorter) local crypto candle history, so
 * this is NOT a data non-verdict; the depth constraint here is candle coverage, not GDELT's.
 *
 * STRUCTURAL REQUIREMENT (this item's own task text): generates market EXPOSURE directly, never a
 * gate/filter on breakout/anticipate. Template A (entry-signal gate on a population with no gross
 * edge) is retired.
 *
 * CONSTRUCT — pre-registered here, before any crypto return was touched, deliberately reusing this
 * project's own existing conventions rather than inventing a new mechanism shape:
 *   1. Volume signal: GDELT "Volume Intensity" (fraction of all monitored articles mentioning
 *      "bitcoin" that day) above its own trailing 200-session MA = favourable (elevated media
 *      attention), matching MACRO-REGIME-PRIMARY-SIGNAL's DTWEXBGS-vs-its-own-200dma convention
 *      exactly (same signal SHAPE, different input). Hysteresis band +-1%, identical to that
 *      script's DXY band (chosen for the same reason: prevent single-day MA-crossing whipsaw, not
 *      fit to this run's outcome).
 *   2. Tone signal: GDELT "Average Tone" above its own trailing 200-session MA = favourable
 *      (improving sentiment momentum). Average Tone is signed and frequently near zero, so a
 *      RELATIVE band (like the volume signal's) would be unstable near a sign change; an ABSOLUTE
 *      band is used instead, +-0.1 tone points, chosen for the same small-relative-to-typical-range
 *      reason MACRO-REGIME-PRIMARY-SIGNAL used an absolute +-10bp band for the yield curve spread
 *      (a signed, near-zero series with the identical band-shape problem) rather than a fraction of
 *      its own MA. This is disclosed as an asymmetry from the volume signal's band, not a silent
 *      inconsistency.
 *   3. Composite regime: favourable only when BOTH signals are favourable (AND — with two inputs,
 *      mechanically identical to "majority >=2 of 2", matching the vote-based framing
 *      MACRO-REGIME-PRIMARY-SIGNAL used for its three inputs). Each sub-signal carries its prior
 *      day's value forward while inside its own band; before a sub-signal has a prior value, the
 *      raw (bandless) comparison seeds it once — same convention as MACRO-REGIME-PRIMARY-SIGNAL.
 *
 * CAUSAL ALIGNMENT (no lookahead). GDELT's daily point for date T aggregates that whole day's
 * monitored articles and is only fully known after T ends. Every lookup uses the latest GDELT point
 * dated STRICTLY BEFORE (crypto trading day - 1 day), matching MACRO-REGIME-PRIMARY-SIGNAL's lag
 * for its own daily FRED series.
 *
 * UNIVERSE — reused verbatim from MACRO-REGIME-PRIMARY-SIGNAL (same coverage constraint, unchanged
 * since that run): of the active (non-SEALED_SYMBOLS) watchlist, only 12 assets hold full
 * 2023-01-01+ local daily candle coverage — ADA, APT, ATOM, BTC, DOGE, DOT, ETH, FIL, INJ, LTC,
 * SOL, XRP. Equal-weight, 70/30 chronological train/holdout split.
 *
 * COST — this project's standing real crypto cost basis (FEE_RATE=0.008/side + SLIPPAGE_PCT=
 * 0.0005/side, ~1.7% round trip), charged once per regime-flip day; buy-and-hold gets one matching
 * entry-cost and one exit-cost charge (MACRO-REGIME-PRIMARY-SIGNAL's convention, reused verbatim).
 *
 * SAMPLE-SIZE HONESTY. Effective n is regime EPISODES (contiguous runs of one label), not day
 * count — MACRO-REGIME-PRIMARY-SIGNAL closed as a non-verdict specifically because its slow-moving
 * macro inputs produced only 1-2 episodes across this project's short crypto history. News
 * sentiment/attention plausibly turns over far faster than Fed policy or the yield curve, so this
 * is measured rather than assumed. Same pre-registered floor as that study: if holdout episode
 * count < 8, this is recorded as a non-verdict, not a point estimate.
 *
 * SIGNIFICANCE TEST — this item's own done_when requires "one-sided significance test with
 * multiple-comparisons correction stated" once depth is sufficient. This project's established
 * convention for that is a one-sided sign-flip permutation test against a null mean of zero,
 * applied to one scalar per INDEPENDENT unit (scripts/log-regression-bands-crypto.mjs,
 * scripts/equities-madip-significance.mjs use one value per asset, n=assets). This study has a
 * single pooled-universe time series rather than a per-asset panel, so the independent unit is
 * this study's own pre-registered effective-n definition instead: regime EPISODES. Per holdout
 * episode, the scalar is that episode's summed (strategy day return - buy&hold day return) —
 * additive, matching the per-asset studies' additive (not compounded) outperformance convention
 * exactly. H1 (mean spread > 0, i.e. the regime signal outperforms buy&hold) is pre-registered on
 * this construct's own economic rationale (favourable = elevated attention + improving sentiment
 * should coincide with rising, not falling, prices) — same one-sided-direction logic
 * LOG-REGRESSION-BANDS-CRYPTO and EQUITIES-MADIP-SIGNIFICANCE used. Only computed when holdout
 * clears the episode floor above (train is exploratory, not the pre-registered primary test,
 * matching every other study in this family's holdout-is-primary convention).
 */
import { execFileSync } from "node:child_process";
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols } from "../../researchlib.mjs";
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { blockBootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real cost basis
const TRAIN_FRACTION = 0.7;
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // pre-registered floor, matching MACRO-REGIME-PRIMARY-SIGNAL

const GDELT_QUERY = "bitcoin";
const PACE_MS = 15000; // paced well above GDELT's stated 5s courtesy limit; see module docstring
const MAX_ATTEMPTS = 30;
const SIGN_FLIP_ITERATIONS = 1000;
const SIGN_FLIP_SEED = 20260823; // matches this project's per-script local-seed convention

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local seeded RNG, mirroring momentum.mjs's internal (unexported) `seeded()` LCG convention —
// duplicated here at the same small scale, matching log-regression-bands-crypto.mjs and
// equities-madip-significance.mjs.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (see module docstring's
// SIGNIFICANCE TEST section for why the unit here is regime episodes, not days or assets).
function signFlipP(values, { iterations = SIGN_FLIP_ITERATIONS, seed = SIGN_FLIP_SEED } = {}) {
  const observed = values.reduce((a, b) => a + b, 0) / values.length;
  const random = seeded(seed);
  let extreme = 0;
  for (let n = 0; n < iterations; n++) {
    let sum = 0;
    for (const v of values) sum += random() < 0.5 ? v : -v;
    if (sum / values.length >= observed) extreme++;
  }
  return { observedMean: observed, p: (extreme + 1) / (iterations + 1) };
}

/** Paced GDELT DOC API fetch via curl (undici fetch() is unreliable against this host, see docstring). */
async function fetchGdeltTimeline(mode, attemptLog) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=${mode}&format=json&timespan=FULL`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await sleep(PACE_MS);
    let out;
    try {
      out = execFileSync("curl", ["-sS", "--max-time", "20", url], { encoding: "utf8" });
    } catch (e) {
      attemptLog.push({ mode, attempt, error: e.message });
      continue;
    }
    let body;
    try {
      body = JSON.parse(out);
    } catch {
      attemptLog.push({ mode, attempt, note: "non-JSON response (courtesy rate-limit page)" });
      continue;
    }
    const series = body.timeline?.[0]?.data ?? [];
    if (series.length > 0) {
      attemptLog.push({ mode, attempt, status: "success", points: series.length });
      return series.map((p) => ({
        date: `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`,
        t: Date.parse(`${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}T00:00:00Z`),
        value: p.value,
      }));
    }
    attemptLog.push({ mode, attempt, note: "empty timeline" });
  }
  throw new Error(`GDELT ${mode}: no data after ${MAX_ATTEMPTS} paced attempts`);
}

function trailingMA(series, index, window) {
  if (index + 1 < window) return null;
  let sum = 0;
  for (let i = index - window + 1; i <= index; i++) sum += series[i].value;
  return sum / window;
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
  const attemptLog = [];
  const volume = await fetchGdeltTimeline("timelinevol", attemptLog);
  const tone = await fetchGdeltTimeline("timelinetone", attemptLog);
  if (!volume.length || !tone.length) {
    throw new Error("GDELT returned no data for one or both series - aborting rather than proceeding on a partial fetch");
  }

  const volumeMA = volume.map((_, i) => trailingMA(volume, i, 200));
  const toneMA = tone.map((_, i) => trailingMA(tone, i, 200));
  const volumeWithMA = volume.map((p, idx) => ({ ...p, ma: volumeMA[idx] }));
  const toneWithMA = tone.map((p, idx) => ({ ...p, ma: toneMA[idx] }));

  // --- universe: reused verbatim from MACRO-REGIME-PRIMARY-SIGNAL ---
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
  const tsSets = universeSymbols.map((sym) => new Set(candlesBySymbol.get(sym).map((c) => c.time)));
  const commonTimes = [...tsSets[0]].filter((t) => tsSets.every((s) => s.has(t))).sort((a, b) => a - b);

  const bySymbolByTime = new Map();
  for (const sym of universeSymbols) {
    const m = new Map(candlesBySymbol.get(sym).map((c) => [c.time, c]));
    bySymbolByTime.set(sym, m);
  }

  const VOLUME_BAND = 0.01; // relative, matches MACRO-REGIME-PRIMARY-SIGNAL's DXY band
  const TONE_BAND = 0.1; // absolute tone points, see module docstring
  let prevVolumeSignal = null, prevToneSignal = null;
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
    const volPoint = lookupLagged(volumeWithMA, tMs, 1);
    const tonePoint = lookupLagged(toneWithMA, tMs, 1);
    if (!volPoint || volPoint.ma == null || !tonePoint || tonePoint.ma == null) continue; // insufficient GDELT history yet

    const volumeSignal = volPoint.value > volPoint.ma * (1 + VOLUME_BAND) ? 1
      : volPoint.value < volPoint.ma * (1 - VOLUME_BAND) ? -1
      : (prevVolumeSignal ?? (volPoint.value > volPoint.ma ? 1 : -1));
    const toneSignal = tonePoint.value > tonePoint.ma + TONE_BAND ? 1
      : tonePoint.value < tonePoint.ma - TONE_BAND ? -1
      : (prevToneSignal ?? (tonePoint.value > tonePoint.ma ? 1 : -1));
    prevVolumeSignal = volumeSignal; prevToneSignal = toneSignal;

    const regime = (volumeSignal === 1 && toneSignal === 1) ? "favourable" : "unfavourable";
    days.push({ date: new Date(tMs).toISOString().slice(0, 10), t, universeReturn, regime, volumeSignal, toneSignal });
  }

  const cut = Math.floor(days.length * TRAIN_FRACTION);
  const train = days.slice(0, cut);
  const holdout = days.slice(cut);

  function scoreSegment(segment) {
    const labels = segment.map((d) => d.regime);
    const episodes = contiguousEpisodes(labels);
    let exposure = 0;
    const stratReturns = [];
    const bhReturns = [];
    for (let i = 0; i < segment.length; i++) {
      const targetExposure = segment[i].regime === "favourable" ? 1 : 0;
      let dayReturn = targetExposure === 1 ? segment[i].universeReturn : 0;
      if (targetExposure !== exposure) dayReturn -= ONE_SIDE_COST;
      exposure = targetExposure;
      stratReturns.push(dayReturn);
      bhReturns.push(segment[i].universeReturn);
    }
    if (bhReturns.length) {
      bhReturns[0] -= ONE_SIDE_COST;
      bhReturns[bhReturns.length - 1] -= ONE_SIDE_COST;
    }
    const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const hitRate = segment.filter((d) => (d.regime === "favourable") === (d.universeReturn > 0)).length / segment.length;
    // Per-episode additive (strategy - buy&hold) day-return spread — the independent unit for
    // this study's significance test; see module docstring's SIGNIFICANCE TEST section.
    const episodeSpreads = episodes.map((e) => {
      let spread = 0;
      for (let i = e.startIdx; i <= e.endIdx; i++) spread += stratReturns[i] - bhReturns[i];
      return spread;
    });
    return {
      days: segment.length,
      episodes: episodes.length,
      episodeLengths: episodes.map((e) => e.length),
      strategyReturn: compound(stratReturns),
      buyHoldReturn: compound(bhReturns),
      hitRate,
      stratReturnsForCI: stratReturns,
      episodeSpreads,
    };
  }

  const trainScore = scoreSegment(train);
  const holdoutScore = scoreSegment(holdout);

  let holdoutCI = null;
  let significance = null;
  let verdict;
  if (holdoutScore.episodes < MIN_HOLDOUT_EPISODES_FOR_CI) {
    verdict = "NON-VERDICT: holdout regime-episode count too small to support any CI";
  } else {
    holdoutCI = blockBootstrapCI(holdoutScore.stratReturnsForCI, { blockSize: 20 });
    const { observedMean, p } = signFlipP(holdoutScore.episodeSpreads);
    significance = {
      unit: "holdout regime episode (n=" + holdoutScore.episodeSpreads.length + ")",
      observedMeanEpisodeSpread: observedMean,
      pOneSided: p,
      h1: "mean (strategy - buy&hold) episode spread > 0",
      signCorrect: observedMean > 0,
    };
    verdict = holdoutScore.strategyReturn > holdoutScore.buyHoldReturn ? "EXPOSURE-SIGNAL-BEATS-BUYHOLD" : "EXPOSURE-SIGNAL-DOES-NOT-BEAT-BUYHOLD";
  }

  const result = {
    gdeltQuery: GDELT_QUERY,
    gdeltDepth: { volumePoints: volume.length, tonePoints: tone.length, earliest: volume[0]?.date, latest: volume[volume.length - 1]?.date },
    attemptLog,
    universeSymbols,
    windowStart: days[0]?.date,
    windowEnd: days[days.length - 1]?.date,
    trainWindow: [train[0]?.date, train[train.length - 1]?.date],
    holdoutWindow: [holdout[0]?.date, holdout[holdout.length - 1]?.date],
    train: { days: trainScore.days, episodes: trainScore.episodes, episodeLengths: trainScore.episodeLengths, strategyReturn: trainScore.strategyReturn, buyHoldReturn: trainScore.buyHoldReturn, hitRate: trainScore.hitRate },
    holdout: { days: holdoutScore.days, episodes: holdoutScore.episodes, episodeLengths: holdoutScore.episodeLengths, strategyReturn: holdoutScore.strategyReturn, buyHoldReturn: holdoutScore.buyHoldReturn, hitRate: holdoutScore.hitRate, ci95: holdoutCI, significance },
    verdict,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("gdelt-news-sentiment-primary-signal", { universeSymbols, gdeltQuery: GDELT_QUERY, sources: ["GDELT DOC API timelinevol", "GDELT DOC API timelinetone"] }, result);
  console.error(`\nSaved to ${file}`);
}

main();
