/**
 * inference.mjs — clustered intervals, matched-geometry nulls, and baseline controls (Phase 3).
 *
 * WHY THIS EXISTS. The three things that decide whether a number in this project means
 * anything have each been reimplemented per study. The seeded LCG appears verbatim in
 * `momentum.mjs`, `classifier.mjs`, `pairs-cointegration.mjs` and
 * `scripts/c0-signal-combination.mjs`. The matched-geometry random-entry null's statistical
 * shell was written from scratch in `scripts/equities-breadth-vs-random-entry-null.mjs`,
 * `scripts/madip-random-entry-control.mjs` and two more probes. And `DATE-CLUSTERED-RESAMPLING-AUDIT`
 * showed that `blockBootstrapCI` blocks by ARRAY POSITION with no timestamp awareness — which is
 * why ma_dip's 475 nominal trades were really 124 effective ones, and why an interval that
 * excluded zero stopped doing so once corrected.
 *
 * `blockBootstrapCI` IS NOT TOUCHED. Sealed studies were decided by its exact output and must
 * remain reproducible byte-for-byte. `clusteredBootstrapCI` here is a SEPARATE function that
 * resamples whole clusters — it is not a fixed version of the old one, and it does not replace
 * it in any existing caller.
 *
 * WHAT A NULL IS FOR. A family's average R is not evidence on its own; the question is whether
 * it beats an entry with the same geometry and no timing skill. This module owns the draw-and-
 * score shell, not the geometry: replicating a family's exit path is market-specific and stays
 * with the caller, which passes it in as `drawTrade`. Centralizing the shell is what makes two
 * studies' null percentiles comparable.
 */

/**
 * The project's standing seeded generator — the same LCG constants already used by
 * `momentum.mjs`'s `seeded` and `classifier.mjs`'s `seededRandom`, so a study switching to this
 * import gets an identical stream rather than a silently different one. The one divergence is
 * seed 0, which `momentum.mjs` leaves as 0 (an LCG fixed point is not the issue, but a study
 * seeded 0 there and here would differ); this follows `classifier.mjs` in substituting 1, and a
 * test pins the equivalence for every other seed.
 */
export function seededRng(seed = 20260301) {
  let state = (seed >>> 0) || 1;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}

/** Fisher-Yates over indices, driven by a supplied generator so the caller owns the seed. */
export function shuffledIndices(n, random) {
  const xs = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Group values by their cluster key, preserving first-seen order so results are deterministic. */
export function groupByCluster(values, keys) {
  if (values.length !== keys.length) throw new Error("groupByCluster: values and keys must be the same length");
  const groups = new Map();
  values.forEach((v, i) => {
    const k = String(keys[i]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  });
  return groups;
}

/**
 * Percentile CI from resampling WHOLE CLUSTERS with replacement.
 *
 * Trades sharing a cluster key are not independent observations: four symbols entered on the
 * same signal day are close to one observation, not four. Drawing whole clusters propagates
 * that into the interval instead of assuming it away. Draw one cluster and you take all of its
 * trades, so a resample has the same number of CLUSTERS as the original, not necessarily the
 * same number of trades — that is the point, and `meanClusterSize` reports it.
 *
 * `keys` defaults to one cluster per value, in which case this reduces to an ordinary
 * i.i.d. bootstrap over the values.
 */
export function clusteredBootstrapCI(values, {
  keys = null, iterations = 2000, seed = 20260303, alpha = 0.05,
} = {}) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length !== values.length) throw new Error("clusteredBootstrapCI: values must all be finite");
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("clusteredBootstrapCI: iterations must be a positive integer");
  if (!(alpha > 0 && alpha < 1)) throw new Error("clusteredBootstrapCI: alpha must be strictly between 0 and 1");
  const empty = {
    lo: null, hi: null, mean: 0, nominalN: values.length, clusters: 0,
    meanClusterSize: 0, iterations, seed, alpha,
  };
  if (!values.length) return empty;

  const groups = [...groupByCluster(values, keys ?? values.map((_, i) => i)).values()];
  const random = seededRng(seed);
  const draws = [];
  for (let it = 0; it < iterations; it++) {
    let sum = 0, count = 0;
    for (let c = 0; c < groups.length; c++) {
      const g = groups[Math.floor(random() * groups.length)];
      for (const v of g) { sum += v; count++; }
    }
    draws.push(count ? sum / count : 0);
  }
  draws.sort((a, b) => a - b);
  const loIdx = Math.floor(iterations * (alpha / 2));
  const hiIdx = Math.min(iterations - 1, Math.floor(iterations * (1 - alpha / 2)));
  return {
    lo: draws[loIdx], hi: draws[hiIdx],
    mean: mean(values),
    nominalN: values.length,
    clusters: groups.length,
    meanClusterSize: values.length / groups.length,
    iterations, seed, alpha,
  };
}

/** Convenience over canonical `evallib` trade records: cluster on `exposureId`, score `netR`. */
export function clusteredBootstrapCITrades(records, opts = {}) {
  return clusteredBootstrapCI(records.map((r) => r.netR), {
    ...opts,
    keys: records.map((r) => r.exposureId),
  });
}

/** Fraction of a sorted array strictly below `value`. */
export function percentileRank(sortedAsc, value) {
  let below = 0;
  for (const v of sortedAsc) { if (v < value) below++; else break; }
  return sortedAsc.length ? below / sortedAsc.length : 0;
}

/**
 * Score an observed statistic against a null distribution.
 *
 * `p` uses this project's standing `(exceedances + 1) / (K + 1)` convention, which never
 * reports p = 0 — a finite number of draws cannot establish that nothing beats the result.
 */
export function nullSummary(nullDraws, observed) {
  const sorted = [...nullDraws].sort((a, b) => a - b);
  const k = sorted.length;
  const atLeast = sorted.filter((v) => v >= observed).length;
  const m = mean(sorted);
  const sd = k > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - m) ** 2, 0) / (k - 1)) : 0;
  return {
    observed,
    draws: k,
    nullMean: m,
    nullSD: sd,
    excessOverNull: observed - m,
    percentileOfObserved: percentileRank(sorted, observed),
    fractionOfDrawsBeatingObserved: k ? atLeast / k : 1,
    p: (atLeast + 1) / (k + 1),
    z: sd > 0 ? (observed - m) / sd : null,
  };
}

/**
 * Matched-geometry null: K draws of N synthetic trades each, scored against the observed mean.
 *
 * `drawTrade(random, i)` must return a number (the trade's R) or `null` when a draw is not
 * usable — an entry index too close to the end of a symbol's data, say. Unusable draws are
 * counted and reported rather than retried indefinitely or silently forced, because a null
 * whose failure rate is invisible is not a control.
 *
 * The GEOMETRY is the caller's job: to be a matched null, `drawTrade` must replicate the
 * family's own exit path and draw its stop distance from the family's own empirical
 * distribution. This function only supplies the seeded draw loop and the scoring.
 */
export function matchedGeometryNull({
  observedMean, n, drawTrade, k = 2000, seed = 20260304, maxAttemptsPerTrade = 10,
} = {}) {
  if (!Number.isFinite(observedMean)) throw new Error("matchedGeometryNull: observedMean must be a finite number");
  if (!Number.isInteger(n) || n < 1) throw new Error("matchedGeometryNull: n must be a positive integer");
  if (typeof drawTrade !== "function") throw new Error("matchedGeometryNull: drawTrade must be a function");
  if (!Number.isInteger(k) || k < 1) throw new Error("matchedGeometryNull: k must be a positive integer");

  const random = seededRng(seed);
  const draws = [];
  let attempted = 0, usableTrades = 0;
  for (let d = 0; d < k; d++) {
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      let r = null;
      for (let attempt = 0; attempt < maxAttemptsPerTrade && r === null; attempt++) {
        attempted++;
        r = drawTrade(random, i);
      }
      if (r === null || !Number.isFinite(r)) continue;
      sum += r; count++;
    }
    usableTrades += count;
    if (count) draws.push(sum / count);
  }
  return {
    ...nullSummary(draws, observedMean),
    requestedDraws: k,
    tradesPerDraw: n,
    usableDrawFraction: k ? draws.length / k : 0,
    usableTradeFraction: attempted ? usableTrades / attempted : 0,
    seed,
    nullDraws: draws,
  };
}

/**
 * Always-flat control: N observations of exactly zero R.
 *
 * Trivial, and worth stating anyway. Every negative result in this project so far means the
 * family lost to this — and a family whose interval straddles zero is not distinguishable from
 * simply not trading, which is the cheaper option.
 */
export function alwaysFlatControl(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("alwaysFlatControl: n must be a non-negative integer");
  return { control: "always-flat", n, values: new Array(n).fill(0), mean: 0, total: 0 };
}

/**
 * Buy-and-hold control, expressed in the same R units as the family it is compared against.
 *
 * R only means something relative to a risk unit, so the caller supplies `riskPerUnit` — for a
 * fair comparison, the family's own mean stop distance in price terms. Cost is charged once,
 * on the same (entry + exit) notional `backtest.js` uses, because buy-and-hold is one round
 * trip rather than many; charging it per bar would flatter the family by inventing a cost the
 * control never pays.
 */
export function buyAndHoldControl(candles, { riskPerUnit, feeRate = 0, slipPct = 0, priceKey = "close" } = {}) {
  if (!Array.isArray(candles) || candles.length < 2) throw new Error("buyAndHoldControl: need at least two candles");
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) throw new Error("buyAndHoldControl: riskPerUnit must be a positive finite number");
  const entry = Number(candles[0][priceKey]);
  const exit = Number(candles[candles.length - 1][priceKey]);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) throw new Error("buyAndHoldControl: candles must carry finite prices");
  const grossR = (exit - entry) / riskPerUnit;
  const notional = Math.abs(entry) + Math.abs(exit);
  const feeR = (feeRate * notional) / riskPerUnit;
  const slippageR = (slipPct * notional) / riskPerUnit;
  return {
    control: "buy-and-hold",
    bars: candles.length,
    entryPrice: entry, exitPrice: exit, riskPerUnit,
    grossR, feeR, slippageR, netR: grossR - feeR - slippageR,
    returnPct: (exit - entry) / entry,
  };
}
