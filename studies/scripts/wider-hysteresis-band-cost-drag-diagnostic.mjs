/**
 * WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC — a follow-on to the KILLED
 * ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL study, testing whether a wider hysteresis band changes that
 * study's verdict by reducing exposure-flip frequency (and thus turnover cost), isolating cost drag
 * from signal-direction as the driver of the original loss.
 *
 * SOURCED FROM: ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL's own writeup (2026-08-27, ROADMAP_ARCHIVE.md), which
 * named this explicitly as "the most plausible next lever if anyone wants to test whether cost drag
 * alone explains the loss" after diagnosing ~91% cumulative cost drag from 107 holdout exposure flips
 * on a ±1% band — the same whipsaw failure mode GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL diagnosed for its
 * own ±1% Volume Intensity band. This is a new, distinctly-named diagnostic study on the SAME
 * address-count-vs-200d-MA construct, not a re-run of the already-KILLED ±1%-band study bolted onto
 * its drawn conclusion.
 *
 * CONSTRUCT — identical to ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL in every respect (data source, cost
 * basis, causal lag, train/holdout split, significance methodology) except band width. Reusing that
 * study's data access (blockchain.com n-unique-addresses, &sampled=false for genuine full resolution),
 * cost basis (FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side), 70/30 split, and permutation + block-
 * bootstrap methodology unmodified, so this is a clean A/B on the cost-drag mechanism — only the band
 * width changes.
 *
 * BAND WIDTH — pre-registered here, before any BTC return was touched (this file's first commit):
 * ±3% relative hysteresis band (3x the killed study's ±1%), chosen as the single primary width to
 * test rather than sweeping multiple widths. Rationale: per MULTIPLE_COMPARISONS_AUDIT.md's own
 * discipline, this diagnostic adds exactly one new sub-test to the formal-NHST family (not two or
 * three from a multi-width sweep, which would also reopen a garden-of-forking-paths concern this
 * project's pre-registration discipline exists to avoid) — 3x the original band is wide enough to
 * plausibly cut turnover materially (the killed study's 107 holdout episodes averaged 3.7 days each;
 * a 3x-wider band should suppress a meaningful share of the whipsaw around the 200d MA) while still
 * being a band width, not an effectively-always-on/always-off threshold. If this comes back a
 * partial explanation (turnover reduced but still net-negative), a still-wider ±5% follow-on is the
 * next lever, staged as its own new item rather than bolted onto this one's conclusion — same
 * precedent this item's own done_when set for its predecessor.
 *
 * Everything else below is unchanged prose from ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL's own docstring,
 * since every other construct choice is byte-identical:
 *
 * ACCESS/DEPTH — reuses the same audit-corrected `sampled=false` query (6,409 points, 2009-01-03
 * through 2026-08-26, only 24 non-1-day gaps, max 8 days) established by the predecessor study; not
 * re-measured here since nothing about data access changed.
 *
 * STRUCTURAL REQUIREMENT: generates market EXPOSURE directly, never a gate/filter (template_a_exhausted
 * retires that shape) — unchanged from the predecessor.
 *
 * CAUSAL ALIGNMENT (no lookahead): every lookup uses the latest address-count point dated STRICTLY
 * BEFORE (BTC trading day - 1 day), matching the predecessor's 1-day publication lag.
 *
 * UNIVERSE — BTC only (n=1 asset), same single-asset time-series study as the predecessor; statistical
 * power comes from regime-episode count on BTC's own history.
 *
 * COST — this project's standing real crypto cost basis (FEE_RATE=0.008/side + SLIPPAGE_PCT=
 * 0.0005/side, ~1.7% round trip), charged once per exposure-flip day; buy-and-hold gets one matching
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
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { blockBootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real cost basis

const ADDRESS_MA_WINDOW = 200; // matches predecessor's 200-session trailing MA convention
const ADDRESS_BAND = 0.03; // pre-registered wider band — see module docstring's BAND WIDTH section
const LAG_DAYS = 1;
const TRAIN_FRACTION = 0.7;
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // pre-registered floor, matching the predecessor family
const SIGN_FLIP_ITERATIONS = 1000;
const SIGN_FLIP_SEED = 20260827; // matches this project's per-script local-seed convention

const BTC_PAIR = "XBTUSD";
const ADDRESS_COUNT_URL = "https://api.blockchain.info/charts/n-unique-addresses?timespan=all&format=json&sampled=false";
const ADDRESS_COUNT_DEFAULT_URL = "https://api.blockchain.info/charts/n-unique-addresses?timespan=all&format=json";

// Local seeded RNG, mirroring momentum.mjs's internal (unexported) `seeded()` LCG convention —
// duplicated here at the same small scale, matching this family's other primary-signal scripts.
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// One-sided sign-flip permutation test against a null mean of zero (see module docstring's
// SIGNIFICANCE TEST section for why the unit here is regime episodes, not days).
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

async function fetchAddressCountPoints(url) {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`blockchain.info n-unique-addresses (${url}): HTTP ${res.status}`);
  const body = await res.json();
  const vals = body?.values;
  if (!Array.isArray(vals) || vals.length === 0) throw new Error(`blockchain.info n-unique-addresses (${url}): empty/malformed response`);
  return vals.map((p) => ({
    date: new Date(p.x * 1000).toISOString().slice(0, 10),
    t: p.x * 1000,
    value: p.y,
  }));
}

/** Reuses the same granularity-discrepancy check the predecessor disclosed, applied fresh this run. */
async function fetchAddressCount() {
  const [defaultPoints, fullPoints] = await Promise.all([
    fetchAddressCountPoints(ADDRESS_COUNT_DEFAULT_URL),
    fetchAddressCountPoints(ADDRESS_COUNT_URL),
  ]);
  return { defaultPoints, fullPoints };
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
  const { defaultPoints, fullPoints: addressSeries } = await fetchAddressCount();
  const addressMA = addressSeries.map((_, i) => trailingMA(addressSeries, i, ADDRESS_MA_WINDOW));
  const addressWithMA = addressSeries.map((p, idx) => ({ ...p, ma: addressMA[idx] }));

  let nonDailyGaps = 0, maxGapDays = 0;
  for (let i = 1; i < addressSeries.length; i++) {
    const gapDays = (addressSeries[i].t - addressSeries[i - 1].t) / 86400000;
    if (gapDays !== 1) { nonDailyGaps++; if (gapDays > maxGapDays) maxGapDays = gapDays; }
  }

  const candles = loadDailyCandles(BTC_PAIR);
  if (candles.length === 0) throw new Error(`no local daily candles for ${BTC_PAIR}`);

  const days = [];
  let prevSignal = null;
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const btcReturn = cur.close / prev.close - 1;

    const tMs = cur.time * 1000;
    const point = lookupLagged(addressWithMA, tMs, LAG_DAYS);
    if (!point || point.ma == null) continue; // insufficient address-count history yet (never happens post-2023, kept for honesty)

    const signal = point.value > point.ma * (1 + ADDRESS_BAND) ? 1
      : point.value < point.ma * (1 - ADDRESS_BAND) ? -1
      : (prevSignal ?? (point.value > point.ma ? 1 : -1));
    prevSignal = signal;

    const regime = signal === 1 ? "favourable" : "unfavourable";
    days.push({ date: new Date(tMs).toISOString().slice(0, 10), t: cur.time, btcReturn, regime, addressCount: point.value, addressMA: point.ma });
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
      let dayReturn = targetExposure === 1 ? segment[i].btcReturn : 0;
      if (targetExposure !== exposure) dayReturn -= ONE_SIDE_COST;
      exposure = targetExposure;
      stratReturns.push(dayReturn);
      bhReturns.push(segment[i].btcReturn);
    }
    if (bhReturns.length) {
      bhReturns[0] -= ONE_SIDE_COST;
      bhReturns[bhReturns.length - 1] -= ONE_SIDE_COST;
    }
    const compound = (rets) => rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const hitRate = segment.filter((d) => (d.regime === "favourable") === (d.btcReturn > 0)).length / segment.length;
    // Per-episode additive (strategy - buy&hold) day-return spread — the independent unit for this
    // study's significance test; see module docstring's SIGNIFICANCE TEST section.
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
    bandWidth: ADDRESS_BAND,
    predecessorBandWidth: 0.01,
    addressCountDepth: {
      defaultQueryPoints: defaultPoints.length, // downsampled — see docstring; not used for this study's construct
      sampledFalsePoints: addressSeries.length,
      earliest: addressSeries[0]?.date,
      latest: addressSeries[addressSeries.length - 1]?.date,
      nonDailyGaps,
      maxGapDays,
    },
    btcCandleCoverage: { count: candles.length, earliest: new Date(candles[0].time * 1000).toISOString().slice(0, 10), latest: new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10) },
    windowStart: days[0]?.date,
    windowEnd: days[days.length - 1]?.date,
    trainWindow: [train[0]?.date, train[train.length - 1]?.date],
    holdoutWindow: [holdout[0]?.date, holdout[holdout.length - 1]?.date],
    train: { days: trainScore.days, episodes: trainScore.episodes, episodeLengths: trainScore.episodeLengths, strategyReturn: trainScore.strategyReturn, buyHoldReturn: trainScore.buyHoldReturn, hitRate: trainScore.hitRate },
    holdout: { days: holdoutScore.days, episodes: holdoutScore.episodes, episodeLengths: holdoutScore.episodeLengths, strategyReturn: holdoutScore.strategyReturn, buyHoldReturn: holdoutScore.buyHoldReturn, hitRate: holdoutScore.hitRate, ci95: holdoutCI, significance },
    verdict,
  };

  console.log(JSON.stringify(result, null, 2));
  const file = saveExperiment("wider-hysteresis-band-cost-drag-diagnostic", { pair: BTC_PAIR, source: "blockchain.com Charts API n-unique-addresses (sampled=false)", bandWidth: ADDRESS_BAND }, result);
  console.error(`\nSaved to ${file}`);
}

main();
