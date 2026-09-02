/**
 * evallib.mjs — the shared evaluation layer (Phase 1).
 *
 * WHY THIS EXISTS. Every study in this project has, up to now, defined its own per-trade
 * shape and its own summary function. `researchlib.mjs`'s `stat()` was the first attempt at
 * de-duplicating that and it covers only mean/sd/se/CI/win-rate. Meanwhile `backtest.js`
 * emits `excursions` entries shaped `{ r, mae, mfe, barsHeld, entry, risk, exitPrice, why }`,
 * several scripts re-derive cost decomposition inline, and the clustering identifier that
 * `DATE-CLUSTERED-RESAMPLING-AUDIT` proved load-bearing is reconstructed ad hoc each time.
 * That divergence is what let a published economics figure double-count cost for weeks
 * (`CLASSIFIER-P5-ECONOMICS-ROW-STALENESS`) and what made the equities effective-sample
 * defect invisible until someone went looking.
 *
 * WHAT IT DOES NOT DO. It changes no existing export, no existing behaviour, and no frozen
 * path. `stat()` in `researchlib.mjs` keeps working exactly as before and is re-exported here
 * so callers migrating gradually do not need two imports. Nothing in this file runs a
 * backtest, places an order, or reads live-trading state.
 *
 * THE COST IDENTITY. `backtest.js` computes
 *   netR = grossR - ((feeRate + slipPct) * (entry + exitPx)) / risk
 * Fee and slippage enter through the *same* per-trade coefficient, which is why
 * `PER-FAMILY-COST-CEILING` could collapse a family's cost sensitivity to one constant.
 * This module splits that single term into its two components so a record carries
 * `feeR` and `slippageR` separately, and asserts they reconcile. Splitting is arithmetic,
 * not a model change: feeR + slippageR always sums back to the original combined term.
 */

import { stat } from "./researchlib.mjs";

export { stat };

export const TRADE_SCHEMA = "cajh-trade/v1";

/** Fields every canonical record must carry. Order is the documentation order, not a constraint. */
export const REQUIRED_TRADE_FIELDS = Object.freeze([
  "schema", "symbol", "timeframe",
  "entryTime", "exitTime", "holdingMs",
  "entryPrice", "exitPrice", "risk",
  "grossR", "feeR", "slippageR", "netR",
  "exitReason", "mae", "mfe",
  "exposureId", "blockId",
]);

/** Reconciliation tolerance for the cost identity, in R. Generous against float drift, far
 *  tighter than any effect this project has ever measured (smallest was ~0.008R). */
export const COST_RECONCILE_TOLERANCE = 1e-9;

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Build a canonical per-trade record from raw components.
 *
 * `grossR` is the R before any cost. `feeRate` and `slipPct` are per-side rates, matching
 * `strategy.js`'s own constants. The caller supplies entry/exit prices and `risk` in price
 * terms so the cost term can be computed on the same basis `backtest.js` uses — passing an
 * already-netted R here would double-count, which is exactly the defect this layer exists
 * to make impossible.
 *
 * `exposureId` is the clustering unit: trades sharing one are NOT independent observations.
 * Default is the UTC calendar day of entry, which is the unit `DATE-CLUSTERED-RESAMPLING-AUDIT`
 * found reduced ma_dip's 475 nominal trades to 124 effective ones. Studies on intraday bars
 * should pass the bar timestamp instead — `CRYPTO-EFFECTIVE-SAMPLE-AUDIT` used exactly that.
 */
export function makeTradeRecord({
  symbol, timeframe,
  entryTime, exitTime,
  entryPrice, exitPrice, risk,
  grossR,
  feeRate = 0, slipPct = 0,
  exitReason = "unknown",
  mae = 0, mfe = 0,
  exposureId = null, blockId = null,
} = {}) {
  if (typeof symbol !== "string" || !symbol) throw new Error("makeTradeRecord: symbol must be a non-empty string");
  if (typeof timeframe !== "string" || !timeframe) throw new Error("makeTradeRecord: timeframe must be a non-empty string");
  if (!isFiniteNumber(risk) || risk <= 0) throw new Error("makeTradeRecord: risk must be a positive finite number");
  if (!isFiniteNumber(grossR)) throw new Error("makeTradeRecord: grossR must be a finite number");
  if (!isFiniteNumber(entryPrice) || !isFiniteNumber(exitPrice)) throw new Error("makeTradeRecord: entryPrice and exitPrice must be finite numbers");
  if (!isFiniteNumber(feeRate) || feeRate < 0) throw new Error("makeTradeRecord: feeRate must be a non-negative finite number");
  if (!isFiniteNumber(slipPct) || slipPct < 0) throw new Error("makeTradeRecord: slipPct must be a non-negative finite number");

  const entryMs = toMillis(entryTime, "entryTime");
  const exitMs = toMillis(exitTime, "exitTime");
  if (exitMs < entryMs) throw new Error("makeTradeRecord: exitTime precedes entryTime");

  // The notional both cost components are charged against — identical to backtest.js's own
  // (entry + exitPx) term, kept as one expression so the two can never drift apart.
  const notional = Math.abs(entryPrice) + Math.abs(exitPrice);
  const feeR = (feeRate * notional) / risk;
  const slippageR = (slipPct * notional) / risk;
  const netR = grossR - feeR - slippageR;

  return Object.freeze({
    schema: TRADE_SCHEMA,
    symbol, timeframe,
    entryTime: entryMs, exitTime: exitMs, holdingMs: exitMs - entryMs,
    entryPrice, exitPrice, risk,
    grossR, feeR, slippageR, netR,
    exitReason,
    mae, mfe,
    exposureId: exposureId ?? utcDayKey(entryMs),
    blockId: blockId ?? `${symbol}:${utcDayKey(entryMs)}`,
  });
}

function toMillis(t, label) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number" && Number.isFinite(t)) return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  if (typeof t === "string") {
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`makeTradeRecord: ${label} must be a Date, epoch number, or parseable date string`);
}

/** "YYYY-MM-DD" in UTC — the default clustering unit. */
export function utcDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Validate a record against the canonical schema and the cost identity.
 * Returns `{ ok, errors }` rather than throwing, so a caller auditing a whole population
 * can report every bad record instead of dying on the first.
 */
export function validateTradeRecord(rec) {
  const errors = [];
  if (!rec || typeof rec !== "object") return { ok: false, errors: ["record is not an object"] };
  if (rec.schema !== TRADE_SCHEMA) errors.push(`schema must be "${TRADE_SCHEMA}"`);
  for (const f of REQUIRED_TRADE_FIELDS) {
    if (!(f in rec)) errors.push(`missing field: ${f}`);
  }
  for (const f of ["grossR", "feeR", "slippageR", "netR", "risk", "mae", "mfe", "holdingMs"]) {
    if (f in rec && !isFiniteNumber(rec[f])) errors.push(`${f} must be a finite number`);
  }
  if (isFiniteNumber(rec.risk) && rec.risk <= 0) errors.push("risk must be positive");
  if (isFiniteNumber(rec.feeR) && rec.feeR < 0) errors.push("feeR must be non-negative");
  if (isFiniteNumber(rec.slippageR) && rec.slippageR < 0) errors.push("slippageR must be non-negative");
  if (isFiniteNumber(rec.holdingMs) && rec.holdingMs < 0) errors.push("holdingMs must be non-negative");
  if (["grossR", "feeR", "slippageR", "netR"].every((f) => isFiniteNumber(rec[f]))) {
    const drift = Math.abs(rec.netR - (rec.grossR - rec.feeR - rec.slippageR));
    if (drift > COST_RECONCILE_TOLERANCE) {
      errors.push(`cost identity violated: netR - (grossR - feeR - slippageR) = ${drift}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a population; returns the per-record failures rather than a bare boolean. */
export function validateTradePopulation(records) {
  const failures = [];
  records.forEach((rec, i) => {
    const { ok, errors } = validateTradeRecord(rec);
    if (!ok) failures.push({ index: i, errors });
  });
  return { ok: failures.length === 0, checked: records.length, failures };
}

/** Linear-interpolated percentile over an already-sorted ascending array. */
export function percentile(sorted, p) {
  const n = sorted.length;
  if (!n) return 0;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Maximum drawdown of the CUMULATIVE R curve, in R.
 *
 * Deliberately an absolute R difference, not a percent-of-peak. `GEOMETRY-NULL-DOWN-WINDOW-PROBE`
 * hit exactly this: a percent-of-peak formula applied to an additive R curve produced a
 * nonsense "-6147%" because the running peak sits near zero early in the series. Equity-curve
 * percentage drawdown is a different question and belongs to a survivability study that models
 * position sizing, not to a per-trade R summary.
 */
export function maxDrawdownR(values) {
  let cum = 0, peak = 0, worst = 0;
  for (const v of values) {
    cum += v;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > worst) worst = dd;
  }
  return worst;
}

/**
 * Shared summary over an array of numbers (per-trade R). Superset of `researchlib.stat()`,
 * which stays available unchanged; this adds the order statistics and drawdown that studies
 * kept recomputing locally.
 */
export function summarize(values) {
  const arr = values.filter(isFiniteNumber);
  const dropped = values.length - arr.length;
  const n = arr.length;
  const base = stat(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return {
    n,
    dropped,
    mean: base.mean,
    median: percentile(sorted, 0.5),
    sd: base.sd,
    se: base.se,
    ci95: base.ci,
    lo95: base.lo,
    hi95: base.hi,
    min: n ? sorted[0] : 0,
    max: n ? sorted[n - 1] : 0,
    q1, q3, iqr: q3 - q1,
    p05: percentile(sorted, 0.05),
    p95: percentile(sorted, 0.95),
    winRate: base.wr,
    wins: arr.filter((x) => x > 0).length,
    losses: arr.filter((x) => x < 0).length,
    scratches: arr.filter((x) => x === 0).length,
    total: base.total,
    maxDrawdownR: maxDrawdownR(arr),
  };
}

/** Summarize the netR of a canonical population, plus its cost decomposition and effective sample. */
export function summarizeTrades(records) {
  const net = summarize(records.map((r) => r.netR));
  const gross = summarize(records.map((r) => r.grossR));
  const exposures = new Set(records.map((r) => r.exposureId));
  const blocks = new Set(records.map((r) => r.blockId));
  const sum = (f) => records.reduce((a, r) => a + (isFiniteNumber(r[f]) ? r[f] : 0), 0);
  return {
    net, gross,
    feeRTotal: sum("feeR"),
    slippageRTotal: sum("slippageR"),
    feeRMean: records.length ? sum("feeR") / records.length : 0,
    slippageRMean: records.length ? sum("slippageR") / records.length : 0,
    nominalN: records.length,
    effectiveN: exposures.size,
    effectiveRatio: records.length ? exposures.size / records.length : 0,
    distinctBlocks: blocks.size,
    symbols: new Set(records.map((r) => r.symbol)).size,
  };
}
