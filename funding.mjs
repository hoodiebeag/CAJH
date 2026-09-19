// Funding rates: loading, alignment to bars, and the no-lookahead guarantee.
//
// Funding is the first NON-PRICE input this project has had. Every signal tested so far is a
// transform of the same OHLCV; funding is a payment stream between longs and shorts, and it carries
// information about positioning that price alone does not.
//
// It is also the input most likely to leak the future if handled carelessly. A perpetual's funding
// for a period is fixed at the START of that period on most venues but STAMPED with the settlement
// time, so a naive join puts a number on bar t that was only knowable at t+1. That is the single
// most dangerous mistake available here and every function below is built around preventing it.

/** One funding CSV: symbol,fundingTime,fundingRate  (fundingTime in ms). Sorted, deduped. */
export function parseFundingCsv(text) {
  const out = [];
  const seen = new Set();
  for (const line of text.trim().split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [, ms, rate] = line.split(",");
    // Number("") is 0, not NaN, so an empty fundingTime would pass a Number.isFinite guard and
    // become 1970-01-01 -- a row that is silently wrong rather than loudly absent. Reject the
    // empty string before converting, not after.
    if (!ms?.trim() || !rate?.trim()) continue;
    const t = Math.floor(Number(ms) / 1000);
    const r = Number(rate);
    // A venue reporting a NaN or a duplicate timestamp is a data defect, not a zero. Dropping it
    // is right; substituting zero would silently invent a period of no funding.
    if (!Number.isFinite(t) || !Number.isFinite(r) || seen.has(t)) continue;
    seen.add(t);
    out.push({ time: t, rate: r });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Sum the funding events that settled INSIDE each bar, returning one number per bar.
 *
 * `barTimes` are bar timestamps in seconds. A daily bar stamped t covers (t-86400, t]. Funding
 * settling at exactly t belongs to that bar; funding settling one second later belongs to the next.
 * Summed rather than averaged because funding is a payment: three 0.01% settlements in a day cost
 * 0.03%, not 0.01%.
 */
export function bucketFunding(records, barTimes) {
  const out = new Array(barTimes.length).fill(0);
  const covered = new Array(barTimes.length).fill(false);
  if (!barTimes.length) return { perBar: out, covered };
  const span = barTimes.length > 1 ? barTimes[1] - barTimes[0] : 86400;
  let j = 0;
  for (let i = 0; i < barTimes.length; i++) {
    const hi = barTimes[i], lo = hi - span;
    while (j < records.length && records[j].time <= lo) j++;     // skip anything before this bar
    let any = false;
    while (j < records.length && records[j].time <= hi) {
      out[i] += records[j].rate;
      any = true;
      j++;
    }
    covered[i] = any;
  }
  return { perBar: out, covered };
}

/**
 * Mean funding over the `lookback` bars ending STRICTLY BEFORE bar `i`.
 *
 * The exclusive upper bound is the whole point. Ranking at bar i may use funding through i-1 and
 * not a tick more; including bar i would rank on a settlement that had not happened when the
 * decision was made. Returns null when the window is not fully available, so a caller cannot
 * silently average three observations where it asked for thirty.
 */
export function trailingFunding(perBar, i, lookback) {
  const end = i;                 // exclusive
  const start = end - lookback;
  if (start < 0 || lookback < 1) return null;
  let s = 0;
  for (let k = start; k < end; k++) s += perBar[k];
  return s / lookback;
}

/**
 * Reject symbols whose funding series cannot support a ranking.
 *
 * A perpetual listed halfway through the sample, or one with long gaps, produces a trailing mean
 * built from a handful of settlements that will rank at an extreme for reasons that are an artefact
 * of coverage. Screening before ranking, as with the price universe -- one corrupted symbol once
 * supplied two thirds of an equities result.
 */
export const FUNDING_LIMITS = { minCoverage: 0.8, minRecords: 200 };

export function screenFunding(bySymbol, barTimes, limits = {}) {
  const { minCoverage, minRecords } = { ...FUNDING_LIMITS, ...limits };
  const kept = {}, rejected = [];
  for (const [sym, records] of Object.entries(bySymbol)) {
    if (records.length < minRecords) {
      rejected.push([sym, `only ${records.length} funding records, need ${minRecords}`]);
      continue;
    }
    const { covered } = bucketFunding(records, barTimes);
    const frac = covered.filter(Boolean).length / (barTimes.length || 1);
    if (frac < minCoverage) {
      rejected.push([sym, `funding covers ${(100 * frac).toFixed(1)}% of bars, need ${(100 * minCoverage).toFixed(0)}%`]);
      continue;
    }
    kept[sym] = records;
  }
  return { kept, rejected };
}

/** Every symbol's per-bar funding on one shared calendar, so a selector can index it like prices. */
export function fundingGrid(bySymbol, barTimes) {
  const grid = {};
  for (const [sym, records] of Object.entries(bySymbol)) grid[sym] = bucketFunding(records, barTimes).perBar;
  return grid;
}

/**
 * Funding actually paid or received by one leg, per rebalance period.
 *
 * `side` is +1 for a long book and -1 for a short one. A LONG pays funding when funding is
 * positive, so its contribution is negative; a short receives it. Hence -side * funding, and
 * getting that sign backwards would turn the entire carry result inside out while still producing
 * a plausible-looking curve -- which is why it is stated here once and tested directly.
 *
 * Funding accrues over the bars a position is actually held: from the rebalance that opened it up
 * to and including the bar of the next rebalance. Equal weight across the names held, matching how
 * runRotation sizes the book.
 */
export function legFundingReturns(rebalanceLog, grid, barTimes, { side = 1 } = {}) {
  const idxOf = new Map(barTimes.map((t, i) => [t, i]));
  const out = [];
  for (let k = 0; k + 1 < rebalanceLog.length; k++) {
    const from = idxOf.get(rebalanceLog[k].at), to = idxOf.get(rebalanceLog[k + 1].at);
    if (from === undefined || to === undefined) { out.push(0); continue; }
    const held = rebalanceLog[k].chosen ?? [];
    if (!held.length) { out.push(0); continue; }
    let total = 0;
    for (const s of held) {
      const perBar = grid[s];
      if (!perBar) continue;                       // a name with no funding series contributes nothing
      for (let i = from + 1; i <= to; i++) total += perBar[i] ?? 0;
    }
    out.push(-side * total / held.length);
  }
  return out;
}

/**
 * Bucket a LEVEL series to bars by taking the last observation inside each bar.
 *
 * bucketFunding SUMS, which is right for a payment stream and wrong for a level. Open interest at
 * the end of a day is not the sum of its intraday readings, and summing 288 five-minute snapshots
 * would report an open interest 288 times too large while still producing a plausible-looking
 * series that ranks almost the same way. The two aggregations are kept separate and named for what
 * they do so a caller cannot pick the wrong one by accident.
 */
export function bucketLast(records, barTimes) {
  const out = new Array(barTimes.length).fill(null);
  const covered = new Array(barTimes.length).fill(false);
  if (!barTimes.length) return { perBar: out, covered };
  const span = barTimes.length > 1 ? barTimes[1] - barTimes[0] : 86400;
  let j = 0;
  for (let i = 0; i < barTimes.length; i++) {
    const hi = barTimes[i], lo = hi - span;
    while (j < records.length && records[j].time <= lo) j++;
    let last = null;
    while (j < records.length && records[j].time <= hi) { last = records[j].rate; j++; }
    if (last !== null) { out[i] = last; covered[i] = true; }
  }
  return { perBar: out, covered };
}

/**
 * Log change in a level over the `lookback` bars ending STRICTLY BEFORE bar `i`.
 *
 * Same exclusive bound as trailingFunding and for the same reason: ranking at bar i may use data
 * through i-1 and not a tick more. Returns null unless BOTH endpoints exist and are positive, so a
 * gap in the series produces no rank rather than a fabricated one.
 */
export function trailingChange(perBar, i, lookback) {
  const a = perBar[i - 1 - lookback], b = perBar[i - 1];
  if (a == null || b == null || !(a > 0) || !(b > 0)) return null;
  return Math.log(b / a);
}

/** Mean of a level over the `lookback` bars ending strictly before `i`; null if any bar is missing. */
export function trailingLevel(perBar, i, lookback) {
  const start = i - lookback;
  if (start < 0 || lookback < 1) return null;
  let s = 0;
  for (let k = start; k < i; k++) { if (perBar[k] == null) return null; s += perBar[k]; }
  return s / lookback;
}
