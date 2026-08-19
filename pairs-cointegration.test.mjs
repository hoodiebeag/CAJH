import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  multiOls, ols, adfRegression, halfLifeDays, blockPermute,
  testPairCointegration, simulateHoldoutTrades, runPairsCointegrationStatArb, ROUND_TRIP_COST_PER_LEG,
} from "./pairs-cointegration.mjs";

test("multiOls recovers exact known coefficients on noise-free data", () => {
  // y = 2 + 3*x1 - 1*x2, no noise.
  const X = [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 2, 1], [1, 1, 3], [1, 4, 2]];
  const y = X.map(([, x1, x2]) => 2 + 3 * x1 - 1 * x2);
  const { beta } = multiOls(X, y);
  assert.ok(Math.abs(beta[0] - 2) < 1e-8);
  assert.ok(Math.abs(beta[1] - 3) < 1e-8);
  assert.ok(Math.abs(beta[2] - (-1)) < 1e-8);
});

test("ols recovers alpha/beta on a noise-free linear relationship", () => {
  const x = Array.from({ length: 50 }, (_, i) => i * 0.1);
  const y = x.map((v) => 1.5 + 2.2 * v);
  const { alpha, beta, resid } = ols(x, y);
  assert.ok(Math.abs(alpha - 1.5) < 1e-8);
  assert.ok(Math.abs(beta - 2.2) < 1e-8);
  assert.ok(resid.every((r) => Math.abs(r) < 1e-8));
});

test("multiOls throws on fewer observations than regressors rather than returning garbage", () => {
  assert.throws(() => multiOls([[1, 2], [1, 3]], [1, 2, 3]));
});

// Deterministic LCG so a synthetic stationary series is reproducible without Math.random.
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

test("adfRegression assigns a strongly negative tau to a genuinely mean-reverting AR(1) series", () => {
  const rand = lcg(1);
  const n = 400;
  const series = [0];
  for (let i = 1; i < n; i++) series.push(0.5 * series[i - 1] + (rand() - 0.5) * 0.1); // phi=0.5, clearly stationary
  const { tStat, rho } = adfRegression(series);
  assert.ok(rho < 0, `expected negative rho for a mean-reverting series, got ${rho}`);
  assert.ok(tStat < -5, `expected a strongly negative tau for phi=0.5, got ${tStat}`);
});

test("adfRegression assigns a near-zero/weak tau to a pure random walk (no reversion)", () => {
  const rand = lcg(2);
  const n = 400;
  const series = [0];
  for (let i = 1; i < n; i++) series.push(series[i - 1] + (rand() - 0.5) * 0.1); // phi=1, unit root
  const { tStat } = adfRegression(series);
  // Not a strict statistical claim (no fixed critical value asserted here — this project's own
  // discipline is block-permutation p-values, not asserted asymptotic thresholds) — just that a
  // true random walk should look far less stationary than the phi=0.5 series above.
  assert.ok(tStat > -3, `expected a random walk's tau to be far weaker than a phi=0.5 series, got ${tStat}`);
});

test("halfLifeDays matches the closed-form value for a known rho, and returns null for non-reverting rho", () => {
  // phi=0.5 -> rho=-0.5 -> half-life = ln(0.5)/ln(0.5) = 1 day.
  assert.ok(Math.abs(halfLifeDays(-0.5) - 1) < 1e-9);
  assert.equal(halfLifeDays(0), null); // phi=1, unit root
  assert.equal(halfLifeDays(0.2), null); // phi=1.2, explosive
  assert.equal(halfLifeDays(-1.5), null); // phi=-0.5, oscillatory outside (0,1)
});

test("blockPermute preserves the multiset of values and the requested length, and actually reorders", () => {
  const values = Array.from({ length: 40 }, (_, i) => i);
  const random = lcg(3);
  const permuted = blockPermute(values, 5, random);
  assert.equal(permuted.length, values.length);
  assert.deepEqual([...permuted].sort((a, b) => a - b), values);
  assert.notDeepEqual(permuted, values);
});

test("testPairCointegration reports a low p-value for a genuinely cointegrated synthetic pair", () => {
  const rand = lcg(4);
  const n = 500;
  const logB = [Math.log(100)];
  for (let i = 1; i < n; i++) logB.push(logB[i - 1] + (rand() - 0.5) * 0.02);
  // logA tracks logB with a mean-reverting spread on top - genuinely cointegrated by construction.
  const spread = [0];
  for (let i = 1; i < n; i++) spread.push(0.6 * spread[i - 1] + (rand() - 0.5) * 0.01);
  const logA = logB.map((v, i) => v + 0.3 + spread[i]);
  const result = testPairCointegration(logA, logB, { permutations: 100, blockSize: 15, seed: 42 });
  assert.ok(Math.abs(result.beta - 1) < 0.2, `expected beta near 1, got ${result.beta}`);
  assert.ok(result.p < 0.1, `expected a low p-value for a genuinely cointegrated pair, got ${result.p}`);
  assert.ok(result.halfLife !== null && result.halfLife > 0);
});

test("testPairCointegration reports a high p-value for two independent random walks", () => {
  const rand = lcg(5);
  const n = 500;
  const logA = [Math.log(50)], logB = [Math.log(200)];
  for (let i = 1; i < n; i++) {
    logA.push(logA[i - 1] + (rand() - 0.5) * 0.02);
    logB.push(logB[i - 1] + (rand() - 0.5) * 0.02);
  }
  const result = testPairCointegration(logA, logB, { permutations: 100, blockSize: 15, seed: 99 });
  assert.ok(result.p > 0.1, `expected a high p-value for two independent random walks, got ${result.p}`);
});

test("simulateHoldoutTrades opens on entryZ, closes on exitZ, and charges cost on both legs", () => {
  // Fixed alpha=0/beta=1/trainMean=0/trainStd=1, so spread == z directly.
  const logTarget = [0, -3, -3, 0, 0]; // spread: 0,-3,-3,0,0 given logRegressor all zero
  const logRegressor = [0, 0, 0, 0, 0];
  const trades = simulateHoldoutTrades(logTarget, logRegressor, { alpha: 0, beta: 1, trainMean: 0, trainStd: 1 }, { entryZ: 2, exitZ: 0.5 });
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.dir, 1); // entered long-spread on z=-3 <= -entryZ
  assert.equal(t.entryIdx, 1);
  assert.equal(t.exitIdx, 3); // first point with |z|<=0.5 after entry
  assert.ok(Math.abs(t.rawR - 3) < 1e-9); // spread moved from -3 to 0
  assert.ok(Math.abs(t.netR - (3 - 2 * ROUND_TRIP_COST_PER_LEG)) < 1e-9);
  assert.equal(t.forcedClose, false);
});

test("simulateHoldoutTrades force-closes a position still open at series end", () => {
  const logTarget = [0, -3, -3];
  const logRegressor = [0, 0, 0];
  const trades = simulateHoldoutTrades(logTarget, logRegressor, { alpha: 0, beta: 1, trainMean: 0, trainStd: 1 }, { entryZ: 2, exitZ: 0.5 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].forcedClose, true);
  assert.equal(trades[0].exitIdx, 2);
});

test("runPairsCointegrationStatArb reports PAIRS-DATA-INSUFFICIENT when no pair clears the candle-history gate", async () => {
  const report = await runPairsCointegrationStatArb({ watchlist: ["ZZZFAKE1", "ZZZFAKE2"] });
  assert.equal(report.result.verdict, "PAIRS-DATA-INSUFFICIENT");
  assert.equal(report.result.pairsTested, 0);
  assert.deepEqual(report.result.survivors, []);
});

test("runPairsCointegrationStatArb excludes SEALED_SYMBOLS from both the universe and the pair count", async () => {
  const report = await runPairsCointegrationStatArb({ watchlist: ["AVAX", "LINK", "ZZZFAKE"] });
  // AVAX/LINK are both sealed -> active universe is just ["ZZZFAKE"], which also fails candles.
  assert.equal(report.input.activeSize, 1);
  assert.equal(report.input.sealedExcluded, 2);
  assert.equal(report.result.verdict, "PAIRS-DATA-INSUFFICIENT");
});

const HAS_REAL_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url)) && fs.existsSync(new URL("./candles/ETHUSD.csv", import.meta.url));

test("runPairsCointegrationStatArb runs end-to-end on real local candle history without crashing", async (t) => {
  if (!HAS_REAL_CANDLES) { t.skip("candles/XBTUSD.csv or ETHUSD.csv absent (no local candle history)"); return; }
  const report = await runPairsCointegrationStatArb({ watchlist: ["BTC", "ETH", "SOL", "DOGE"], permutations: 30, minHistoryDays: 200 });
  assert.ok(report.input.nominalPairs >= 1);
  assert.ok(typeof report.result.verdict === "string");
  assert.ok(Array.isArray(report.result.screenSummary ?? []));
});
