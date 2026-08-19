/**
 * PAIRS-COINTEGRATION-STATARB: tests whether any pair of assets in the active watchlist is
 * COINTEGRATED — a stationary linear combination (spread) whose deviations mean-revert — and
 * simulates trading that spread market-neutral (long one leg, short the other). Every prior
 * price-structure family in this project predicts a single asset's own future direction from
 * its own history; this predicts nothing about direction at all, only that a cross-asset
 * relationship reverts. VERDICTS.md called grid.mjs "the one market-neutral mechanism tested to
 * date" before this.
 *
 * HARD CONSTRAINT (pre-registered, unaffected by the result): this Kraken account has no
 * short-position/margin access (established by FUNDING-CARRY-DECAY-CHECK, see VERDICTS.md), so
 * a two-sided pairs trade is research-only on this venue regardless of outcome. Stated in every
 * result rather than implying tradability.
 *
 * CALENDAR-HOLDOUT DISCLOSURE (AGENT_PROTOCOL.md "Multiple-comparisons discipline",
 * 2026-08-19): no candle data collected after 2026-08-19 exists yet, so this study's holdout
 * necessarily re-examines already-spent history rather than a fresh calendar window. Disclosed
 * here rather than silently, per that section's binding rule.
 *
 * MULTIPLE-COMPARISONS PLAN (pre-registered before any pair is screened, per this item's own
 * done_when — this paragraph is written and frozen before `runPairsCointegrationStatArb` is
 * ever executed against real data): every pair drawn from the ACTIVE watchlist (SEALED_SYMBOLS
 * excluded — screening is a train/holdout cycle, and researchlib.mjs's seal is reserved for the
 * one-time final validation, never spent on a screen) is tested once on TRAIN data only, via a
 * block-permutation null (this project's own established convention — see classifier.mjs's
 * `scoreSealedSplit`, momentum.mjs's permutation scoring — rather than a table-lookup asymptotic
 * critical value, which this project has no verified source for and will not fabricate). The
 * resulting p-values are corrected with Benjamini-Hochberg FDR at q=0.05 (`momentum.mjs`'s own
 * `bhFdr`, the project's standing convention per AGENT_PROTOCOL.md) across every pair actually
 * screened (cleared the overlap-history gate) — NOT the nominal combinatorial count. The task
 * that spawned this item assumed a 28-asset universe (378 = C(28,2) pairs); the real watchlist
 * has since grown to 29 (24 active after the 5-symbol seal), so the honest corrected count is
 * computed from what's actually run, not the task's stale estimate — reported as
 * `pairsTested`/`nominalPairs` both, not just the flattering one. Only pairs surviving that
 * correction (q<=0.05) get a pre-registered z-score entry/exit band (entryZ=2.0, exitZ=0.5 —
 * one fixed conventional choice, not a swept grid, matching this project's single-choice
 * convention elsewhere) evaluated ONCE on holdout, with the train-fixed regression coefficients
 * and train-fixed spread mean/std (no re-estimation on holdout — no leakage).
 *
 * COST (task's own explicit requirement): a pairs trade opens and closes TWO legs, so the real
 * round-trip cost is paid twice, not once. `ROUND_TRIP_COST_PER_LEG` (this repo's standard
 * ~1.7% spot taker round trip, strategy.js FEE_RATE/SLIPPAGE_PCT) is subtracted twice from every
 * completed trade's raw spread return.
 */
import { loadWatchlist, splitSealedSymbols, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";
import { bhFdr } from "./momentum.mjs";
import { FEE_RATE, SLIPPAGE_PCT } from "./strategy.js";

export const ROUND_TRIP_COST_PER_LEG = 2 * (FEE_RATE + SLIPPAGE_PCT); // ~0.017, one leg's round trip
const ENTRY_Z = 2.0;
const EXIT_Z = 0.5;
const BH_Q = 0.05;
const ADF_LAGS = 1;
const DEFAULT_PERMUTATIONS = 200;
const DEFAULT_BLOCK_SIZE = 20;
const MIN_HISTORY_DAYS = 500;

// ─── small linear algebra (only ever used on 2-3 regressor problems here) ──────────────────

function transpose(A) { return A[0].map((_, j) => A.map((row) => row[j])); }
function matMul(A, B) {
  const m = A.length, n = B.length, p = B[0].length;
  const out = Array.from({ length: m }, () => new Array(p).fill(0));
  for (let i = 0; i < m; i++) for (let k = 0; k < n; k++) { const a = A[i][k]; if (a === 0) continue; for (let j = 0; j < p; j++) out[i][j] += a * B[k][j]; }
  return out;
}
/** Gauss-Jordan inverse of a small square matrix. Throws on a (near-)singular matrix rather
 * than silently returning garbage — a pair whose regressors are collinear should fail loudly. */
function invert(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    if (Math.abs(M[pivotRow][col]) < 1e-10) throw new Error("invert: singular matrix");
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

/** Generic multiple OLS: X is an array of regressor rows (include the intercept column
 * yourself), y the target. Returns coefficients, their standard errors, and residuals. */
export function multiOls(X, y) {
  const n = y.length, k = X[0].length;
  if (n <= k) throw new Error("multiOls: fewer observations than regressors");
  const Xt = transpose(X);
  const XtXInv = invert(matMul(Xt, X));
  const XtY = matMul(Xt, y.map((v) => [v])).map((r) => r[0]);
  const beta = matMul(XtXInv, XtY.map((v) => [v])).map((r) => r[0]);
  const resid = y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  const sigma2 = resid.reduce((s, r) => s + r * r, 0) / (n - k);
  const se = XtXInv.map((row, i) => Math.sqrt(Math.max(0, row[i] * sigma2)));
  return { beta, se, resid, n, k };
}

/** Bivariate OLS: target = alpha + beta*regressor + resid. */
export function ols(regressor, target) {
  const X = regressor.map((x) => [1, x]);
  const { beta, resid } = multiOls(X, target);
  return { alpha: beta[0], beta: beta[1], resid };
}

/** Augmented Dickey-Fuller-style regression on a residual/spread series: de_t = c + rho*e_(t-1)
 * + sum phi_j*de_(t-j) + eps_t. rho's t-statistic is the Engle-Granger test statistic (more
 * negative = stronger evidence the spread is stationary, i.e. mean-reverting). */
export function adfRegression(residuals, lags = ADF_LAGS) {
  const n = residuals.length;
  if (n < lags + 15) throw new Error("adfRegression: series too short");
  const de = [];
  for (let i = 1; i < n; i++) de.push(residuals[i] - residuals[i - 1]);
  const X = [], y = [];
  for (let t = lags; t < de.length; t++) {
    const row = [1, residuals[t]];
    for (let j = 1; j <= lags; j++) row.push(de[t - j]);
    X.push(row);
    y.push(de[t]);
  }
  const { beta, se, n: rows } = multiOls(X, y);
  const rho = beta[1], seRho = se[1];
  const tStat = seRho > 0 ? rho / seRho : (rho === 0 ? 0 : (rho < 0 ? -Infinity : Infinity));
  return { rho, seRho, tStat, n: rows };
}

/** Half-life of mean reversion in days, from the ADF regression's rho (AR(1) level coefficient
 * is 1+rho). Returns null when the spread doesn't genuinely mean-revert (phi outside (0,1)). */
export function halfLifeDays(rho) {
  const phi = 1 + rho;
  if (!(phi > 0 && phi < 1)) return null;
  return Math.log(0.5) / Math.log(phi);
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

/** Block permutation: shuffles fixed-size contiguous blocks (preserving within-block order,
 * so each block's own short-range autocorrelation survives) rather than a full i.i.d. shuffle,
 * which would destroy a time series' own dynamics rather than just its alignment with the
 * other leg. Standard technique for building a null distribution on correlated time series. */
export function blockPermute(values, blockSize, random) {
  const blocks = [];
  for (let i = 0; i < values.length; i += blockSize) blocks.push(values.slice(i, i + blockSize));
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}

function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Engle-Granger cointegration test for one pair, TRAIN data only. Returns the fitted
 * regression (alpha/beta/resid), the ADF tau statistic, and a block-permutation p-value: the
 * fraction of null draws (target held fixed, regressor's own return series block-shuffled and
 * re-cumulated) whose tau is at least as negative as the observed one.
 */
export function testPairCointegration(logTarget, logRegressor, { permutations = DEFAULT_PERMUTATIONS, blockSize = DEFAULT_BLOCK_SIZE, seed = 1 } = {}) {
  const { alpha, beta, resid } = ols(logRegressor, logTarget);
  const { rho, tStat } = adfRegression(resid);
  const mean = resid.reduce((a, b) => a + b, 0) / resid.length; // ~0 by OLS construction; computed explicitly, not assumed
  const std = Math.sqrt(resid.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, resid.length - 1));

  const retR = [];
  for (let i = 1; i < logRegressor.length; i++) retR.push(logRegressor[i] - logRegressor[i - 1]);
  const random = seededRandom(seed);
  const nullTaus = [];
  for (let k = 0; k < permutations; k++) {
    const permRet = blockPermute(retR, blockSize, random);
    const permRegressor = [logRegressor[0]];
    for (const r of permRet) permRegressor.push(permRegressor[permRegressor.length - 1] + r);
    try {
      const { resid: r2 } = ols(permRegressor, logTarget);
      const { tStat: t2 } = adfRegression(r2);
      if (Number.isFinite(t2)) nullTaus.push(t2);
    } catch { /* an unstable draw is invalid, never silently counted as a null result */ }
  }
  const exceedances = nullTaus.filter((t) => t <= tStat).length;
  const p = nullTaus.length ? (exceedances + 1) / (nullTaus.length + 1) : null;
  return { alpha, beta, rho, tStat, p, validNull: nullTaus.length, requestedPermutations: permutations, trainMean: mean, trainStd: std, halfLife: halfLifeDays(rho) };
}

/** Walks a fixed z-score band (train-fixed mean/std, train-fixed alpha/beta — no
 * re-estimation) over the holdout spread, opening a position on |z|>=entryZ and closing on
 * |z|<=exitZ; any position still open at the end of the series is force-closed there
 * (mark-to-market, flagged). Cost is charged on BOTH legs, at trade close only. */
export function simulateHoldoutTrades(logTargetHoldout, logRegressorHoldout, { alpha, beta, trainMean, trainStd }, { entryZ = ENTRY_Z, exitZ = EXIT_Z, costPerLeg = ROUND_TRIP_COST_PER_LEG } = {}) {
  const spread = logTargetHoldout.map((v, i) => v - alpha - beta * logRegressorHoldout[i]);
  const z = spread.map((e) => trainStd > 0 ? (e - trainMean) / trainStd : 0);
  const trades = [];
  let open = null;
  for (let i = 0; i < z.length; i++) {
    if (!open) {
      if (z[i] <= -entryZ) open = { dir: 1, entryIdx: i, entrySpread: spread[i] };
      else if (z[i] >= entryZ) open = { dir: -1, entryIdx: i, entrySpread: spread[i] };
    } else if (Math.abs(z[i]) <= exitZ) {
      const rawR = open.dir * (spread[i] - open.entrySpread);
      trades.push({ entryIdx: open.entryIdx, exitIdx: i, dir: open.dir, rawR, netR: rawR - 2 * costPerLeg, forcedClose: false });
      open = null;
    }
  }
  if (open) {
    const i = z.length - 1;
    const rawR = open.dir * (spread[i] - open.entrySpread);
    trades.push({ entryIdx: open.entryIdx, exitIdx: i, dir: open.dir, rawR, netR: rawR - 2 * costPerLeg, forcedClose: true });
  }
  return trades;
}

export async function runPairsCointegrationStatArb({
  watchlist = loadWatchlist(), splitFraction = 0.70, permutations = DEFAULT_PERMUTATIONS,
  blockSize = DEFAULT_BLOCK_SIZE, seed = 20260819, entryZ = ENTRY_Z, exitZ = EXIT_Z,
  bhQ = BH_Q, minHistoryDays = MIN_HISTORY_DAYS,
} = {}) {
  const { active, sealed } = splitSealedSymbols(watchlist);
  const normalized = active.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);

  const seriesBySymbol = {};
  const coverage = [];
  for (const asset of normalized) {
    let candles;
    try { candles = loadResearchCandles(asset.id, 1440); } catch (err) { coverage.push({ symbol: asset.symbol, included: false, reason: `candle-load-error: ${err.message}` }); continue; }
    if (candles.length < minHistoryDays) { coverage.push({ symbol: asset.symbol, included: false, reason: `insufficient-daily-history (${candles.length} of ${minHistoryDays} days)` }); continue; }
    seriesBySymbol[asset.symbol] = new Map(candles.map((c) => [Number(c.time), Number(c.close)]));
    coverage.push({ symbol: asset.symbol, included: true, days: candles.length });
  }
  const eligibleSymbols = Object.keys(seriesBySymbol).sort();

  const nominalPairs = normalized.length * (normalized.length - 1) / 2;
  const pairs = [];
  for (let i = 0; i < eligibleSymbols.length; i++)
    for (let j = i + 1; j < eligibleSymbols.length; j++)
      pairs.push([eligibleSymbols[i], eligibleSymbols[j]]);

  const baseInput = {
    specification: "pairs-cointegration-statarb/v1",
    watchlistSize: watchlist.length, activeSize: active.length, sealedExcluded: sealed.length,
    nominalPairs, splitFraction, permutations, blockSize, seed, entryZ, exitZ, bhQ, minHistoryDays,
    roundTripCostPerLeg: ROUND_TRIP_COST_PER_LEG,
    noShortAccessDisclosure: "Kraken account has no short/margin access — any surviving pair is research-only on this venue regardless of result (see FUNDING-CARRY-DECAY-CHECK).",
    calendarHoldoutDisclosure: "Holdout uses already-collected candle data (pre-2026-08-19) — re-examining already-spent history, disclosed per AGENT_PROTOCOL.md's Multiple-comparisons discipline.",
    coverage,
  };

  if (pairs.length === 0) return { input: baseInput, result: { verdict: "PAIRS-DATA-INSUFFICIENT", pairsTested: 0, survivors: [] } };

  const screened = [];
  for (const [symA, symB] of pairs) {
    const mapA = seriesBySymbol[symA], mapB = seriesBySymbol[symB];
    const commonTimes = [...mapA.keys()].filter((t) => mapB.has(t)).sort((a, b) => a - b);
    if (commonTimes.length < minHistoryDays) { screened.push({ pair: `${symA}/${symB}`, tested: false, reason: `overlap-too-short (${commonTimes.length} of ${minHistoryDays} days)` }); continue; }
    const cutIdx = Math.floor(commonTimes.length * splitFraction);
    const trainTimes = commonTimes.slice(0, cutIdx), holdoutTimes = commonTimes.slice(cutIdx);
    if (trainTimes.length < 50 || holdoutTimes.length < 10) { screened.push({ pair: `${symA}/${symB}`, tested: false, reason: "train-or-holdout-too-short-after-split" }); continue; }

    const logA_train = trainTimes.map((t) => Math.log(mapA.get(t)));
    const logB_train = trainTimes.map((t) => Math.log(mapB.get(t)));
    try {
      const test = testPairCointegration(logA_train, logB_train, { permutations, blockSize, seed: (seed ^ hashSeed(`${symA}/${symB}`)) >>> 0 });
      screened.push({ pair: `${symA}/${symB}`, symA, symB, tested: true, trainTimes, holdoutTimes, ...test });
    } catch (err) {
      screened.push({ pair: `${symA}/${symB}`, tested: false, reason: `test-error: ${err.message}` });
    }
  }

  const testedRows = screened.filter((s) => s.tested && s.p !== null);
  const fdrRows = testedRows.map((s) => ({ p: s.p }));
  bhFdr(fdrRows);
  testedRows.forEach((s, i) => { s.q = fdrRows[i].q; });

  const survivors = testedRows.filter((s) => s.q <= bhQ);
  const screenSummary = testedRows.map((s) => ({ pair: s.pair, tau: s.tStat, p: s.p, q: s.q, halfLifeDays: s.halfLife, survives: s.q <= bhQ }));

  if (!survivors.length) {
    return {
      input: baseInput,
      result: {
        verdict: `NO-COINTEGRATED-PAIRS: 0/${testedRows.length} pairs survive BH-FDR q=${bhQ} (nominal ${nominalPairs} pairs; ${testedRows.length} actually cleared the overlap-history gate and were tested)`,
        pairsTested: testedRows.length, nominalPairs, survivors: [], screenSummary,
      },
    };
  }

  const survivorResults = survivors.map((s) => {
    const mapA = seriesBySymbol[s.symA], mapB = seriesBySymbol[s.symB];
    const logA_holdout = s.holdoutTimes.map((t) => Math.log(mapA.get(t)));
    const logB_holdout = s.holdoutTimes.map((t) => Math.log(mapB.get(t)));
    const trades = simulateHoldoutTrades(logA_holdout, logB_holdout, { alpha: s.alpha, beta: s.beta, trainMean: s.trainMean, trainStd: s.trainStd }, { entryZ, exitZ });
    const netRs = trades.map((t) => t.netR);
    const avgNetR = netRs.length ? netRs.reduce((a, b) => a + b, 0) / netRs.length : 0;
    return { pair: s.pair, tau: s.tStat, p: s.p, q: s.q, halfLifeDays: s.halfLife, trades: trades.length, avgNetR, totalNetR: netRs.reduce((a, b) => a + b, 0), winRate: netRs.length ? netRs.filter((r) => r > 0).length / netRs.length : 0 };
  });

  const totalTrades = survivorResults.reduce((a, r) => a + r.trades, 0);
  const totalNetR = survivorResults.reduce((a, r) => a + r.totalNetR, 0);
  const avgNetR = totalTrades ? totalNetR / totalTrades : 0;
  const positivePairs = survivorResults.filter((r) => r.avgNetR > 0).length;

  const gate = { tradesMin: 10, avgNetRMin: 0, tradesPass: totalTrades >= 10, avgNetRPass: avgNetR > 0 };
  gate.passed = gate.tradesPass && gate.avgNetRPass;

  return {
    input: baseInput,
    result: {
      verdict: gate.passed
        ? `PAIRS-COINTEGRATION clears its pre-registered gate (research-only, no short access): ${survivorResults.length} surviving pair(s), holdout avgNetR=${avgNetR.toFixed(4)}, ${totalTrades} trades`
        : `PAIRS-COINTEGRATION FAIL: ${survivorResults.length} pair(s) survived the BH-FDR screen but holdout gate fails (avgNetR=${avgNetR.toFixed(4)}, trades=${totalTrades}; gate: avgNetR>0 AND trades>=10)`,
      pairsTested: testedRows.length, nominalPairs, gate,
      holdout: { trades: totalTrades, avgNetR, totalNetR, positivePairs, pairs: survivorResults.length },
      survivors: survivorResults, screenSummary,
    },
  };
}

if (process.argv[1]?.endsWith("pairs-cointegration.mjs")) {
  const report = await runPairsCointegrationStatArb();
  const saved = saveExperiment("pairs-cointegration", report.input, report.result);
  console.log(JSON.stringify({ ...report.result, saved }, null, 2));
}
