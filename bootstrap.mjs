// Block bootstrap for period returns.
//
// Every confidence interval this campaign has quoted treats its period returns as independent
// draws. They are not. Momentum books are regime-driven: good months cluster, bad months cluster,
// and the sub-period tables show it directly -- equities produced everything in one ten-month
// stretch and nothing in the next twenty. Treating 31 or 50 serially correlated observations as
// i.i.d. makes every standard error too small and every interval too narrow.
//
// A MOVING-BLOCK bootstrap resamples contiguous runs instead of single periods, so whatever
// dependence lives inside a block of length L is carried into each replicate. Comparing it against
// the i.i.d. bootstrap on the same data measures how much the independence assumption was buying.
//
// This is deliberately pointed at the result we would most like to keep. A test that can only
// confirm is not a test.

/** Deterministic RNG so a reported interval can be reproduced exactly. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Dispersion below this is floating-point residue around a constant series, not risk. Guarding on
// `s > 0` alone let a series of identical returns report a Sharpe of 1.9e16, because summing twenty
// copies of 0.01 leaves a ~1e-18 wobble that the ratio then divides by.
const FLAT = 1e-12;

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/**
 * One block resample of `returns`, length-matched to the original.
 * blockLen 1 degenerates to the ordinary i.i.d. bootstrap, which is the point of comparison.
 *
 * `circular` wraps the series end-to-start so that starts run 0..n-1 instead of 0..n-blockLen.
 * The distinction is not cosmetic. Under moving blocks the first and last blockLen-1 observations
 * appear in fewer blocks than the interior ones -- period 0 sits in exactly one block where an
 * interior period sits in blockLen -- so the tails of the series are systematically under-weighted.
 * On a 31-period book whose fourth largest move IS period 0, that shrinks the interval for a reason
 * that has nothing to do with the data. Circular blocks give every observation the same weight and
 * pay for it by joining the last period to the first, a seam that does not exist in the real series.
 * Neither is right; running both says which of the two artefacts an answer depends on.
 */
export function blockResample(returns, blockLen, rand, { circular = false } = {}) {
  const n = returns.length;
  if (blockLen < 1 || blockLen > n) throw new Error(`blockResample: blockLen ${blockLen} outside 1..${n}`);
  const starts = circular ? n : n - blockLen + 1;
  const out = [];
  while (out.length < n) {
    const s = Math.floor(rand() * starts);
    for (let k = 0; k < blockLen && out.length < n; k++) out.push(returns[(s + k) % n]);
  }
  return out;
}

/**
 * Bootstrap distribution of the annualised return and Sharpe of a book.
 * `returns` are per-period LOG returns; periodsPerYear puts them on an annual footing.
 */
export function bootstrapBook(returns, { periodsPerYear = 12, blockLen = 1, draws = 5000, seed = 20260905, circular = false } = {}) {
  const rand = rng(seed);
  const cagrs = [], sharpes = [];
  for (let d = 0; d < draws; d++) {
    const r = blockResample(returns, blockLen, rand, { circular });
    const m = mean(r), s = sd(r);
    // Annualised compound return implied by this replicate's mean log return.
    cagrs.push(Math.exp(m * periodsPerYear) - 1);
    sharpes.push(s > FLAT ? (m / s) * Math.sqrt(periodsPerYear) : 0);
  }
  const pct = (arr, q) => {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * a.length)))];
  };
  const summarise = arr => ({
    p05: pct(arr, 0.05), p25: pct(arr, 0.25), median: pct(arr, 0.50),
    p75: pct(arr, 0.75), p95: pct(arr, 0.95),
    // The share of replicates that lose money, which is the number a person actually feels.
    pNegative: arr.filter(v => v <= 0).length / arr.length,
  });
  return { blockLen, circular, draws, periods: returns.length, cagr: summarise(cagrs), sharpe: summarise(sharpes) };
}

/**
 * Rule-of-thumb block length for a series of length n: n^(1/3), rounded, at least 2.
 * Stated rather than tuned -- picking the block length that gives the answer you want is the
 * same error as picking the parameter that gives the return you want.
 */
export function suggestedBlockLen(n) {
  return Math.max(2, Math.round(Math.cbrt(n)));
}
