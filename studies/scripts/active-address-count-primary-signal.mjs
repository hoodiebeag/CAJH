/**
 * ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL — a market-exposure signal for BTC built from blockchain.com's
 * n-unique-addresses daily active-address-count series, genuinely exogenous to this project's own
 * price/positioning history (same family as MACRO-REGIME-PRIMARY-SIGNAL / GDELT-NEWS-SENTIMENT-
 * PRIMARY-SIGNAL, both of which this reuses the mechanism shape from).
 *
 * SOURCED FROM: WHALE-WALLET-ACCUMULATION-PRIMARY's own ROADMAP_ARCHIVE.md writeup (2026-08-22), which
 * closed as a data-availability non-verdict for true wallet-level accumulation tracking (no free
 * per-wallet-identity source exists) but explicitly named its own escape hatch: accept
 * n-unique-addresses as a DELIBERATELY DIFFERENT, pre-registered hypothesis in its own right (does a
 * rise in active address count predict returns — a population-usage-momentum question, not a
 * whale-tracking one) and stage it as a new, distinctly-named item rather than silently substituting
 * it there. This IS that staging. The construct here is population address-count momentum, not
 * persistent large-actor identity — it says nothing about accumulation/distribution by any cohort.
 *
 * ACCESS/DEPTH MEASURED THIS RUN, BEFORE ANY CONSTRUCT WAS DESIGNED (per this item's own done_when).
 * EXOGENOUS-DATA-ACCESS-AUDIT (2026-08-22) probed `?timespan=all&format=json` (no `sampled` param)
 * and reported 1,603 points, calling it "daily since 2009-01-03". Re-fetched fresh this run: that
 * exact query now returns 1,603 points too, but the real per-point spacing is NOT daily — the last
 * five points before the request date were 2026-08-03/07/11/15/26, i.e. blockchain.info's Charts API
 * auto-downsamples a `timespan=all` request to keep the payload small, regardless of the audit's
 * "daily" label. Adding `&sampled=false` returns the genuine full-resolution series: 6,409 points,
 * 2009-01-03 through 2026-08-26, only 24 non-1-day gaps (max 8 days) across the whole 17.6-year
 * history — this IS genuinely daily, the audit's finding was half-right (real depth, wrong
 * granularity claim), and this script uses `sampled=false` throughout. Disclosed here rather than
 * silently correcting it, since it would otherwise look like an unexplained discrepancy against the
 * audit's own numbers.
 *
 * STRUCTURAL REQUIREMENT (this item's own task text): generates market EXPOSURE directly, never a
 * gate/filter on breakout/anticipate (template_a_exhausted retires that shape).
 *
 * CONSTRUCT — pre-registered here, before any BTC return was touched, reusing this project's own
 * existing "level vs its own trailing MA" signal shape (MACRO-REGIME-PRIMARY-SIGNAL's DXY-vs-200dma,
 * GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's Volume-Intensity-vs-200dma) rather than inventing a new
 * mechanism: active-address count above its own trailing 200-session MA = favourable (rising usage /
 * adoption momentum predicts positive forward returns — the pre-registered economic rationale).
 * Hysteresis band +-1% (relative), matching GDELT's Volume Intensity band exactly — both are
 * positive-magnitude, trending series, unlike the yield-curve/Fed-funds/tone series that needed an
 * absolute band for a signed, near-zero range. Prior day's signal carries forward while inside the
 * band; before any signal has a prior value, the raw (bandless) comparison seeds it once — same
 * convention as both prior studies in this family.
 *
 * CAUSAL ALIGNMENT (no lookahead). blockchain.info's daily point for date T aggregates that whole
 * day's confirmed transactions and is only fully known after T ends. Every lookup uses the latest
 * address-count point dated STRICTLY BEFORE (BTC trading day - 1 day), matching MACRO-REGIME-PRIMARY-
 * SIGNAL's and GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's 1-day publication lag.
 *
 * UNIVERSE — BTC only, per this item's own scoping note: this is a single-asset time-series study
 * (n=1 asset), so statistical power comes from the number of independent train/holdout regime
 * episodes on BTC's own history, not from a cross-sectional asset count. Local daily candle coverage
 * (research-cache/daily/XBTUSD.json): 2023-01-01 through 2026-07-30, 1,307 candles — well inside the
 * address-count series' much deeper history, so the binding depth constraint here is candle coverage,
 * not address-count data (address-count's own trailing-200 MA is fully seeded decades before 2023).
 *
 * COST — this project's standing real crypto cost basis (FEE_RATE=0.008/side + SLIPPAGE_PCT=
 * 0.0005/side, ~1.7% round trip), charged once per exposure-flip day; buy-and-hold gets one matching
 * entry-cost and one exit-cost charge — MACRO-REGIME-PRIMARY-SIGNAL's / GDELT's convention, reused
 * verbatim.
 *
 * SAMPLE-SIZE HONESTY. Effective n is regime EPISODES (contiguous runs of one label), not day count,
 * matching MACRO-REGIME-PRIMARY-SIGNAL / GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL's own precedent (both
 * pre-registered the same MIN_HOLDOUT_EPISODES_FOR_CI=8 floor; this reuses it unchanged). If holdout
 * episode count < 8, this is recorded as a non-verdict, not a point estimate — this item's own
 * done_when names this explicitly as an acceptable close, matching OPTIONS-SKEW-PRIMARY-SIGNAL /
 * WHALE-WALLET-ACCUMULATION-PRIMARY's precedent for an honest data/sample-size non-verdict.
 *
 * SIGNIFICANCE TEST — this item's own done_when requires a one-sided significance test once depth is
 * sufficient. Same convention as GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL: a one-sided sign-flip
 * permutation test against a null mean of zero, applied to the per-holdout-episode additive
 * (strategy day return - buy&hold day return) scalar — this study's own pre-registered effective-n
 * unit (regime episodes). H1 (mean spread > 0) is pre-registered on this construct's own economic
 * rationale (favourable = rising active-address usage should coincide with rising, not falling,
 * prices) — same one-sided-direction logic as every other study in this family. Only computed when
 * holdout clears the episode floor above (train is exploratory, not the pre-registered primary test,
 * matching this family's holdout-is-primary convention).
 */
import { loadDailyCandles, saveExperiment } from "../../researchlab.mjs";
import { blockBootstrapCI } from "../momentum.mjs";

const FEE_RATE = 0.008;
const SLIPPAGE_PCT = 0.0005;
const ONE_SIDE_COST = FEE_RATE + SLIPPAGE_PCT; // 0.0085, matches project's real cost basis

const ADDRESS_MA_WINDOW = 200; // matches MACRO-REGIME / GDELT's 200-session trailing MA convention
const ADDRESS_BAND = 0.01; // relative, matches GDELT's Volume Intensity band exactly
const LAG_DAYS = 1;
const TRAIN_FRACTION = 0.7;
const MIN_HOLDOUT_EPISODES_FOR_CI = 8; // pre-registered floor, matching MACRO-REGIME / GDELT
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

/** Measures the granularity discrepancy disclosed in the module docstring before using the real series. */
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
  const file = saveExperiment("active-address-count-primary-signal", { pair: BTC_PAIR, source: "blockchain.com Charts API n-unique-addresses (sampled=false)" }, result);
  console.error(`\nSaved to ${file}`);
}

main();
