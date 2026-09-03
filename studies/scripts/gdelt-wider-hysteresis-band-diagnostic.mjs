/**
 * GDELT-WIDER-HYSTERESIS-BAND-DIAGNOSTIC — a follow-on to the KILLED
 * GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL study, testing whether a wider hysteresis band changes that
 * study's verdict by reducing exposure-flip frequency (and thus turnover cost), isolating cost drag
 * from signal-direction as the driver of the original loss.
 *
 * SOURCED FROM: GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's own "what would actually resolve this" section
 * (2026-08-23, ROADMAP_ARCHIVE.md): "A wider hysteresis band (tested against a fresh, not-yet-examined
 * window, to avoid fitting the band to this run's own holdout) ... would be the natural next lever,
 * if this line is revisited — not attempted here since it would require a second holdout look at
 * data this run has already spent." This diagnostic is that exact next lever, run for the first time.
 *
 * CONSTRUCT — identical to GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL in every respect (GDELT DOC API
 * source, Volume-Intensity-vs-200dma / Average-Tone-vs-200dma composite, AND-of-2 regime,
 * 1-day causal lag, cost basis, MIN_HOLDOUT_EPISODES_FOR_CI floor, one-sided sign-flip permutation +
 * block-bootstrap significance methodology) except band width AND window — both changes required by
 * this item's own task text, not a discretionary deviation.
 *
 * BAND WIDTH — pre-registered here, before any crypto return was touched (this file's first commit):
 * both sub-signal bands widened 3x, matching this project's own WIDER-HYSTERESIS-BAND-COST-DRAG-
 * DIAGNOSTIC precedent (same 3x multiplier, chosen there for the same reason: wide enough to
 * plausibly cut turnover materially while still being a band, not an always-on/always-off threshold;
 * a single primary width, not a multi-width sweep, per MULTIPLE_COMPARISONS_AUDIT.md's own
 * discipline against re-opening a garden-of-forking-paths concern). Volume Intensity band: ±3%
 * (was ±1%). Average Tone band: ±0.3 absolute tone points (was ±0.1 absolute).
 *
 * WINDOW — the genuinely new constraint this item's task text adds beyond the predecessor
 * diagnostic's. GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's holdout (2025-04-10→2026-03-31) is already
 * spent; testing the wider band against it would refit the band to already-examined data. A fresh
 * window is required instead. MEASURED THIS RUN, BEFORE ANY BAND OR WINDOW CHOICE WAS FINALIZED:
 * of the original study's 12-asset universe (ADA, APT, ATOM, BTC, DOGE, DOT, ETH, FIL, INJ, LTC,
 * SOL, XRP), local daily candle collection has stalled for 9 of the 12 — their coverage still ends
 * 2026-03-31, identical to the original study's holdout end, meaning NO fresh window exists for the
 * full 12-asset construct at all (a data-collection gap discovered by this diagnostic, not caused or
 * fixed by it — candles/ is out of scope per this project's standing hygiene discipline). Only BTC,
 * ETH, and SOL have continued local coverage (through 2026-07-29/30 as of this run). This diagnostic
 * therefore narrows the universe to the assets with genuinely fresh coverage, found MECHANICALLY
 * (iteratively dropping the least-current symbol from the original 12 until the common-coverage
 * window extends past the original study's holdout end), not hand-picked after seeing any outcome —
 * see findFreshUniverse() below. This is a disclosed, data-availability-forced deviation from the
 * original 12-asset universe, not a discretionary choice, and materially narrows what any resulting
 * verdict can speak to (BTC/ETH/SOL only, not the original 12-asset composite).
 *
 * Given the narrowed universe, everything the original study's own train/holdout window already
 * examined (2023-01-02→2025-04-09 train AND 2025-04-10→2026-03-31 holdout) is folded into this
 * diagnostic's TRAIN segment — train is this family's own established convention for "exploratory,
 * not the pre-registered primary test" (see original study's SIGNIFICANCE TEST section), so
 * re-including already-spent holdout days there does not re-spend them as a holdout look. The
 * primary, significance-tested HOLDOUT here is exactly the days after 2026-03-31 — days that did not
 * exist in the original study's own candle intersection (its own windowEnd was also 2026-03-31),
 * so this is a genuinely never-examined window, not a re-split of already-seen data.
 *
 * Everything else — cost basis, causal lag, composite logic, sample-size floor, significance test —
 * is unchanged prose from GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's own docstring, reused verbatim below.
 *
 * COST — this project's standing real crypto cost basis (FEE_RATE=0.008/side + SLIPPAGE_PCT=
 * 0.0005/side, ~1.7% round trip), charged once per regime-flip day; buy-and-hold gets one matching
 * entry-cost and one exit-cost charge.
 *
 * SAMPLE-SIZE HONESTY — effective n is regime EPISODES (contiguous runs of one label), not day count.
 * If holdout episode count < MIN_HOLDOUT_EPISODES_FOR_CI=8, this is recorded as a non-verdict, not a
 * point estimate.
 *
 * SIGNIFICANCE TEST — one-sided sign-flip permutation test against a null mean of zero, applied to the
 * per-holdout-episode additive (strategy day return - buy&hold day return) scalar, H1 (mean spread > 0)
 * pre-registered on the same economic rationale as the predecessor.
 */
import { execFileSync } from "node:child_process";
import { loadWatchlist, symbolToKrakenId, splitSealedSymbols } from "../../researchlib.mjs";
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { blockBootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real cost basis
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // pre-registered floor, matching the predecessor family

const GDELT_QUERY = "bitcoin";
const PACE_MS = 15000; // paced well above GDELT's stated 5s courtesy limit
const MAX_ATTEMPTS = 30;
const SIGN_FLIP_ITERATIONS = 1000;
const SIGN_FLIP_SEED = 20260827; // matches this project's per-script local-seed convention

const VOLUME_BAND = 0.03; // pre-registered wider band (3x original ±1%) — see module docstring
const TONE_BAND = 0.3; // pre-registered wider band (3x original ±0.1) — see module docstring
const PREDECESSOR_VOLUME_BAND = 0.01;
const PREDECESSOR_TONE_BAND = 0.1;

// Original study's own train/holdout boundary; everything up to and including this date folds into
// this diagnostic's exploratory train segment (see module docstring's WINDOW section).
const FRESH_HOLDOUT_START = Date.parse("2026-04-01T00:00:00Z");
const ORIGINAL_UNIVERSE = ["ADA", "APT", "ATOM", "BTC", "DOGE", "DOT", "ETH", "FIL", "INJ", "LTC", "SOL", "XRP"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local seeded RNG, mirroring momentum.mjs's internal (unexported) `seeded()` LCG convention.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero.
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

/** Paced GDELT DOC API fetch via curl (undici fetch() is unreliable against this host). */
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

function commonTimesFor(symbols, candlesBySymbol) {
  const sets = symbols.map((sym) => new Set(candlesBySymbol.get(sym).map((c) => c.time)));
  return [...sets[0]].filter((t) => sets.every((s) => s.has(t))).sort((a, b) => a - b);
}

/**
 * Mechanically finds the largest subset of ORIGINAL_UNIVERSE whose common local candle coverage
 * extends past FRESH_HOLDOUT_START, by iteratively dropping the symbol with the earliest last-candle
 * date. Deterministic given current candle data; not hand-picked. See module docstring's WINDOW
 * section for why this is necessary (9/12 original-universe symbols have stalled candle collection).
 */
function findFreshUniverse(candlesBySymbol) {
  const dropped = [];
  let universe = [...ORIGINAL_UNIVERSE];
  for (;;) {
    const commonTimes = commonTimesFor(universe, candlesBySymbol);
    const lastT = commonTimes[commonTimes.length - 1] * 1000;
    if (lastT >= FRESH_HOLDOUT_START) return { universe, commonTimes, dropped };
    if (universe.length <= 1) throw new Error("no fresh window available for any subset of the original universe — cannot run this diagnostic");
    let worstSym = universe[0], worstLast = Infinity;
    for (const sym of universe) {
      const c = candlesBySymbol.get(sym);
      const last = c[c.length - 1].time;
      if (last < worstLast) { worstLast = last; worstSym = sym; }
    }
    dropped.push({ symbol: worstSym, lastCandle: new Date(worstLast * 1000).toISOString().slice(0, 10) });
    universe = universe.filter((s) => s !== worstSym);
  }
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

  const watchlist = loadWatchlist();
  const { active } = splitSealedSymbols(watchlist);
  const activeSymbols = active.map((e) => (typeof e === "string" ? e : e.symbol));
  const candlesBySymbol = new Map();
  for (const sym of activeSymbols) {
    candlesBySymbol.set(sym, loadDailyCandles(symbolToKrakenId(sym)));
  }

  const { universe: universeSymbols, commonTimes, dropped } = findFreshUniverse(candlesBySymbol);

  const bySymbolByTime = new Map();
  for (const sym of universeSymbols) {
    bySymbolByTime.set(sym, new Map(candlesBySymbol.get(sym).map((c) => [c.time, c])));
  }

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
    if (!volPoint || volPoint.ma == null || !tonePoint || tonePoint.ma == null) continue;

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

  // Fresh-window split (see module docstring's WINDOW section): everything through the original
  // study's own holdout end folds into this diagnostic's exploratory train; only days strictly after
  // that boundary — never examined by the original study's candle intersection — form the primary,
  // significance-tested holdout.
  const cut = days.findIndex((d) => d.t * 1000 >= FRESH_HOLDOUT_START);
  const train = cut === -1 ? days : days.slice(0, cut);
  const holdout = cut === -1 ? [] : days.slice(cut);

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
    const hitRate = segment.length ? segment.filter((d) => (d.regime === "favourable") === (d.universeReturn > 0)).length / segment.length : null;
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
    bandWidth: { volume: VOLUME_BAND, tone: TONE_BAND },
    predecessorBandWidth: { volume: PREDECESSOR_VOLUME_BAND, tone: PREDECESSOR_TONE_BAND },
    originalUniverse: ORIGINAL_UNIVERSE,
    universeSymbols,
    droppedForStaleCandles: dropped,
    freshHoldoutStart: "2026-04-01",
    windowStart: days[0]?.date,
    windowEnd: days[days.length - 1]?.date,
    trainWindow: [train[0]?.date, train[train.length - 1]?.date],
    holdoutWindow: [holdout[0]?.date, holdout[holdout.length - 1]?.date],
    train: { days: trainScore.days, episodes: trainScore.episodes, episodeLengths: trainScore.episodeLengths, strategyReturn: trainScore.strategyReturn, buyHoldReturn: trainScore.buyHoldReturn, hitRate: trainScore.hitRate },
    holdout: { days: holdoutScore.days, episodes: holdoutScore.episodes, episodeLengths: holdoutScore.episodeLengths, strategyReturn: holdoutScore.strategyReturn, buyHoldReturn: holdoutScore.buyHoldReturn, hitRate: holdoutScore.hitRate, ci95: holdoutCI, significance },
    verdict,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("gdelt-wider-hysteresis-band-diagnostic", { universeSymbols, gdeltQuery: GDELT_QUERY, bandWidth: result.bandWidth, sources: ["GDELT DOC API timelinevol", "GDELT DOC API timelinetone"] }, result);
  console.error(`\nSaved to ${file}`);
}

main();
