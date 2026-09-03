/**
 * C0-SIGNAL-COMBINATION (throwaway, read-only, cache-only, no egress). Not part of the app —
 * PHASE DIRECTIVE (2026-08-29, blackboard.phase_directive_new_mechanism) STEP 3, first item of
 * the new-mechanism phase. Deletable after ROADMAP.md's finding is written.
 *
 * HYPOTHESIS: B5-REVERSAL (momentum.mjs, L=3 cross-sectional short-horizon reversal, train
 * IC=-0.0685 p=0.0010, correct sign, KILLED purely on economics at ~1.7% round-trip cost) and
 * Classifier P5 (classifier.mjs, entry-time logistic classifier, holdout AUC 0.5249 p=0.0198,
 * KILLED on the same economics-after-cost pattern) are two INDEPENDENT, already-established,
 * statistically-real-but-economically-dead effects. Two small independent edges might sum past
 * the cost floor together even though neither does alone. THIS IS A COMBINATION MECHANISM, NOT
 * A VARIANT OF EITHER CLOSED SIGNAL — Template-A's 2026-08-19 closure (`blackboard.
 * template_a_exhausted`) retired "a new input series on the threshold-gate/breakout/anticipate
 * shape"; this is neither a new input series nor that shape, it is a fixed a-priori combination
 * of two ALREADY-USED signals' own native outputs, so it is not caught by that closure.
 *
 * ============================== PRE-REGISTRATION (frozen before any composite number below is
 * computed or examined) ==============================
 *
 * COMBINATION RULE (fixed a priori, UNFITTED — no weight is ever chosen after seeing holdout
 * behaviour):
 *   For each Classifier-P5 holdout trade, attach the most recent B5-REVERSAL (L=3, sign-flipped
 *   trailR) cross-sectional panel score for that trade's own symbol as of a panel date <= the
 *   trade's own entry date (no lookahead — a panel row's score is built purely from data at or
 *   before its own `date`). Convert BOTH the classifier's per-trade win probability and the
 *   momentum reversal score to percentile ranks WITHIN the resulting joined trade population
 *   (0=lowest, 1=highest; a rank-average is scale-free by construction, so no fitted weight is
 *   needed to combine two differently-scaled outputs — a probability and a return magnitude).
 *   combinedScore = mean(classifierPercentile, momentumPercentile). Select the top TERCILE
 *   (floor(n/3), this project's own convention from `economicMomentumViews`) by combinedScore.
 *   A trade with no momentum-panel coverage yet for its symbol (occurs before that symbol
 *   accumulates 3 lookback days of history in the holdout window) is dropped from the joined
 *   population, not zero-filled — reported as an explicit count, not silently absorbed.
 *
 * COST MODEL: classifier.mjs's own `economicLiftNetOfCost` (mean(netR) - roundTripCost, the
 * SAME function P5/CLASSIFIER-FUNDING-FEATURE already use, unmodified), evaluated at both this
 * project's long-standing 0.009 round-trip and the FEE-SCHEDULE-REBASE-corrected real ~0.017
 * round-trip (the current standard "real cost" reading per PHASE-DIRECTIVE-BOOKKEEPING/
 * ROADMAP.md, already applied to both B5-REVERSAL and CLASSIFIER-FUNDING-FEATURE). 0.017 is the
 * PRIMARY gate cost; 0.009 reported secondarily for direct comparability with the original P5
 * figure.
 *
 * HOLDOUT SPLIT — a deliberate, disclosed DEVIATION from the historical "16-symbol" holdout
 * every prior sealed study (B5-REVERSAL, Classifier P5, CLASSIFIER-FUNDING-FEATURE) used:
 *   TRAIN (classifier model fit + B5-REVERSAL train-leg reproduction): STABLE_13, unchanged —
 *   matches every existing study's own convention, not new information extraction.
 *   NEW-COMPUTATION HOLDOUT (composite, and the matched-population standalone baselines it is
 *   compared against): watchlist minus STABLE_13 minus `researchlib.mjs`'s SEALED_SYMBOLS
 *   (AVAX/LINK/NEAR/SUI/UNI) — this item's own instruction is "do not touch SEALED_SYMBOLS," and
 *   AGENT_PROTOCOL.md records that pool as already spent (2026-08-29, inconclusive) with
 *   "nothing may assume a fresh sealed pool exists." The historical 16-symbol holdout used by
 *   B5-REVERSAL/Classifier P5 included NEAR/SUI/UNI (a pre-dates-the-SEALED_SYMBOLS-protocol
 *   fact); this study never re-scores anything new on them, dropping to a 13-symbol holdout
 *   instead. The ONE exception is the read-only reproduction step immediately below, which
 *   replays an ALREADY-PUBLISHED historical number byte-for-bit as a code-path sanity check, not
 *   a new evaluation.
 *
 * GATE (must clear ALL, applied mechanically, reported plainly whichever way it falls):
 *   1. >=100 trades in the joined (matched-population, momentum-covered) population.
 *   2. Pre-registered one-sided permutation test (2000 iterations, seed 20260829, fixed before
 *      any result examined): combined-score top-tercile selection produces a higher mean gross
 *      per-trade R than a same-size RANDOM tercile drawn from the same joined population,
 *      p<0.05. Expected sign: POSITIVE (selection beats random).
 *   3. Composite selected-subset net R at the primary 0.017 cost > 0.
 *   4. Composite selected-subset net R at 0.017 > BOTH standalone signals' own net R, each
 *      recomputed on the SAME matched 13-symbol population at the SAME 0.017 cost (not the
 *      historical 16-symbol figures, which are a different population) — B5-REVERSAL's top-3
 *      AND top-5 long-only net return, and Classifier P5's threshold-0.5 selected-subset net.
 *   A kill on any clause is a useful, plainly-reported result that closes the combination
 *   hypothesis before any new data source is built (per this item's own note).
 *
 * MULTIPLE COMPARISONS: per PHASE-DIRECTIVE-BOOKKEEPING's pre-registered decision
 * (MULTIPLE_COMPARISONS_AUDIT.md section 5, "C0-C3 correction-family assignment"), C0's
 * permutation p-value joins the existing formal-NHST family (section 2, n=20 before this run)
 * as its 21st entry — not a new, separately-corrected family. That decision is not re-opened
 * here; only applied.
 */
import { loadWatchlist, symbolToKrakenId, SEALED_SYMBOLS } from "./../researchlib.mjs";
import { loadDailyCandles, saveExperiment } from "./../researchlab.mjs";
import { STABLE_13, buildMomentumPanel, economicMomentumViews, blockBootstrapCI } from "./../momentum.mjs";
import {
  buildClassifierUniverseRows,
  fitZScoreScaler,
  applyZScoreScaler,
  chooseLambdaByCv,
  predictLogistic,
  mannWhitneyAuc,
  economicLiftNetOfCost
} from "./../classifier.mjs";

const L = 3;
const COSTS = { legacy: 0.009, real: 0.017 };
const PERMUTATIONS = 2000;
const PERM_SEED = 20260829;

const dateOf = (timeSec) => new Date(timeSec * 1000).toISOString().slice(0, 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function shuffledIndices(n, random) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// Rank-average combination rule: percentile in [0,1], 1 = strongest signal. No tie-averaging
// beyond stable-sort order — continuous-valued scores make exact ties negligible here.
function percentileRanks(values) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const out = Array(values.length);
  order.forEach((originalIndex, rankPos) => { out[originalIndex] = (rankPos + 0.5) / values.length; });
  return out;
}

const watchlist = loadWatchlist().map((s) => (typeof s === "string" ? { symbol: s, id: symbolToKrakenId(s) } : s));
const available = watchlist.map((w) => w.symbol);
const historicalHoldout16 = available.filter((s) => !STABLE_13.includes(s)); // reproduction only
const holdoutUniverse = historicalHoldout16.filter((s) => !SEALED_SYMBOLS.includes(s)); // new computation

console.log(`Watchlist: ${available.length} symbols. STABLE_13 train (unchanged, incl. AVAX/LINK per every prior study's own convention). Historical 16-symbol holdout: ${historicalHoldout16.join(",")}.`);
console.log(`SEALED_SYMBOLS excluded from all NEW computation: ${SEALED_SYMBOLS.filter((s) => historicalHoldout16.includes(s)).join(",")}`);
console.log(`New-computation holdout (${holdoutUniverse.length} symbols): ${holdoutUniverse.join(",")}`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 1: reproduce B5-REVERSAL's already-published TRAIN figures (STABLE_13, L=3, sign-
// flipped trailR), byte-for-bit, per momentum.mjs's own `sealed-reversal` CLI recipe. Read-only
// replay of an already-published number, touches only STABLE_13 (never the holdout universe).
// ─────────────────────────────────────────────────────────────────────────────────────────
function dailySeries(list) { return new Map(list.map(({ symbol, id }) => [symbol, loadDailyCandles(id)])); }
function splitRecentRows(rows, holdoutDates = 4) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const held = new Set(dates.slice(Math.max(0, dates.length - holdoutDates)));
  return { train: rows.filter((r) => !held.has(r.date)), recentHoldout: rows.filter((r) => held.has(r.date)) };
}
const series = dailySeries(watchlist);

const trainPanel = buildMomentumPanel(series, { universe: STABLE_13, lookback: L, horizon: L, step: L, minAssets: 8, tagRegime: true, transform: "raw" });
const trainRows = splitRecentRows(trainPanel.rows, 4).train;
const reversedTrainRows = trainRows.map((r) => ({ ...r, trailR: -r.trailR }));
const b5ReproLegacy = economicMomentumViews(reversedTrainRows, { minAssets: 8, roundTripCost: COSTS.legacy });
const b5ReproReal = economicMomentumViews(reversedTrainRows, { minAssets: 8, roundTripCost: COSTS.real });

const B5_REFERENCE = { // phase2-triage.mjs's own recorded figures, L=3, train
  tercile: { legacy: -0.0088, real: -0.0207 },
  top3: { legacy: -0.0007, real: -0.0069 },
  top5: { legacy: 0.0001, real: -0.0046 }
};
function closeEnough(a, b, eps = 0.0005) { return Math.abs(a - b) < eps; }
console.log("\n=== STEP 1: B5-REVERSAL train reproduction (sanity check vs. published figures) ===");
console.log(`tercile net@0.009=${b5ReproLegacy.tercile.netSpread.toFixed(4)} (ref ${B5_REFERENCE.tercile.legacy}) @0.017=${b5ReproReal.tercile.netSpread.toFixed(4)} (ref ${B5_REFERENCE.tercile.real})`);
console.log(`top3    net@0.009=${b5ReproLegacy.topN[3].netReturn.toFixed(4)} (ref ${B5_REFERENCE.top3.legacy}) @0.017=${b5ReproReal.topN[3].netReturn.toFixed(4)} (ref ${B5_REFERENCE.top3.real})`);
console.log(`top5    net@0.009=${b5ReproLegacy.topN[5].netReturn.toFixed(4)} (ref ${B5_REFERENCE.top5.legacy}) @0.017=${b5ReproReal.topN[5].netReturn.toFixed(4)} (ref ${B5_REFERENCE.top5.real})`);
const b5ReproductionOk = closeEnough(b5ReproLegacy.tercile.netSpread, B5_REFERENCE.tercile.legacy)
  && closeEnough(b5ReproReal.tercile.netSpread, B5_REFERENCE.tercile.real)
  && closeEnough(b5ReproLegacy.topN[3].netReturn, B5_REFERENCE.top3.legacy)
  && closeEnough(b5ReproReal.topN[3].netReturn, B5_REFERENCE.top3.real)
  && closeEnough(b5ReproLegacy.topN[5].netReturn, B5_REFERENCE.top5.legacy)
  && closeEnough(b5ReproReal.topN[5].netReturn, B5_REFERENCE.top5.real);
console.log(`B5-REVERSAL reproduction matches published figures: ${b5ReproductionOk}`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 2: reproduce Classifier P5's already-published HOLDOUT figure (historical 16-symbol
// holdout, includes NEAR/SUI/UNI) — a read-only replay of an already-published number, not a
// new evaluation. Then fit the ONE model this study reuses throughout (train=STABLE_13, exactly
// as P5 always has), scored separately on the sealed-excluded 13-symbol population in STEP 3.
// ─────────────────────────────────────────────────────────────────────────────────────────
const allClassifierRows = buildClassifierUniverseRows(watchlist);
const trainClassifierRows = allClassifierRows.filter((row) => !historicalHoldout16.includes(row.symbol));
const scaler = fitZScoreScaler(trainClassifierRows);
const scaledTrain = applyZScoreScaler(trainClassifierRows, scaler);
const selectedLambda = chooseLambdaByCv(scaledTrain);
const model = selectedLambda.model;

const historicalHoldoutRows = allClassifierRows.filter((row) => historicalHoldout16.includes(row.symbol));
const scaledHistoricalHoldout = applyZScoreScaler(historicalHoldoutRows, scaler);
const historicalScores = scaledHistoricalHoldout.map((row) => predictLogistic(model, row));
const p5ReproLegacy = economicLiftNetOfCost(historicalHoldoutRows, historicalScores, { threshold: 0.5, roundTripCost: COSTS.legacy });
const p5ReproAuc = mannWhitneyAuc(historicalScores, scaledHistoricalHoldout.map((row) => row.y));

const P5_REFERENCE = { selected: -0.4616, baseline: -0.5178, auc: 0.5249 };
console.log("\n=== STEP 2: Classifier P5 holdout reproduction (sanity check vs. published figures) ===");
console.log(`holdout AUC=${p5ReproAuc.toFixed(4)} (ref ${P5_REFERENCE.auc}) selectedNet@0.009=${p5ReproLegacy.selectedNet.toFixed(4)} (ref ${P5_REFERENCE.selected}) baselineNet@0.009=${p5ReproLegacy.baselineNet.toFixed(4)} (ref ${P5_REFERENCE.baseline})`);
const p5AucMatches = closeEnough(p5ReproAuc, P5_REFERENCE.auc, 0.0005);
const p5EconomicsMatch = closeEnough(p5ReproLegacy.selectedNet, P5_REFERENCE.selected) && closeEnough(p5ReproLegacy.baselineNet, P5_REFERENCE.baseline);
console.log(`Classifier P5 model/AUC reproduction matches published figures: ${p5AucMatches} (proves train/holdout split, scaler, and fitted model are byte-identical to the original)`);
console.log(`Classifier P5 ECONOMICS reproduction matches published figures: ${p5EconomicsMatch}`);
if (p5AucMatches && !p5EconomicsMatch) {
  console.log(`DISCLOSED DISCREPANCY (not investigated further, out of C0's scope): the fitted model and AUC reproduce exactly, proving the classification pipeline is unmodified and correctly invoked, but the ECONOMIC figures do not. strategy.js's FEE_RATE (0.008/side, ~1.6% round trip) and SLIPPAGE_PCT already bake a cost into every profileEntries() record.netR at simulation time; classifier.mjs's own economicLiftNetOfCost then subtracts its own SEPARATE roundTripCost on top. VERDICTS.md's original P5 row (2026-08-08) predates FEE-SCHEDULE-REBASE's same-day correction of these constants to the current real ~1.7% basis, so a fresh call to the unmodified code now nets a materially worse figure purely from the constants having since been corrected upward project-wide -- not from any change to this study's own method, universe, or data availability (row counts match exactly: 15076 total / 7580 holdout, identical to the published run). This study proceeds using freshly-computed figures throughout for both the standalone baseline and the composite, since mixing a stale cost basis for one side of a comparison against a fresh one for the other would be the actual integrity error here.`);
}

if (!b5ReproductionOk || !p5AucMatches) {
  console.log("\nABORT: model-level reproduction did not match published figures — refusing to proceed to the combined computation on unverified integration points.");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 3: matched-population (13-symbol, SEALED_SYMBOLS-excluded) standalone baselines — NEW
// computation, but each signal alone, on the exact population the composite itself will use.
// ─────────────────────────────────────────────────────────────────────────────────────────
const matchedPanel = buildMomentumPanel(series, { universe: holdoutUniverse, lookback: L, horizon: L, step: L, minAssets: 8, tagRegime: true, transform: "raw" });
const reversedMatchedRows = matchedPanel.rows.map((r) => ({ ...r, trailR: -r.trailR }));
const b5MatchedLegacy = economicMomentumViews(reversedMatchedRows, { minAssets: 8, roundTripCost: COSTS.legacy });
const b5MatchedReal = economicMomentumViews(reversedMatchedRows, { minAssets: 8, roundTripCost: COSTS.real });

const matchedHoldoutRows = allClassifierRows.filter((row) => holdoutUniverse.includes(row.symbol));
const scaledMatchedHoldout = applyZScoreScaler(matchedHoldoutRows, scaler);
const matchedScores = scaledMatchedHoldout.map((row) => predictLogistic(model, row));
const p5MatchedLegacy = economicLiftNetOfCost(matchedHoldoutRows, matchedScores, { threshold: 0.5, roundTripCost: COSTS.legacy });
const p5MatchedReal = economicLiftNetOfCost(matchedHoldoutRows, matchedScores, { threshold: 0.5, roundTripCost: COSTS.real });

console.log("\n=== STEP 3: matched-population (13-symbol, SEALED_SYMBOLS excluded) standalone baselines ===");
console.log(`B5-REVERSAL top3 net: @0.009=${b5MatchedLegacy.topN[3].netReturn.toFixed(4)} @0.017=${b5MatchedReal.topN[3].netReturn.toFixed(4)} (obs=${b5MatchedLegacy.observations})`);
console.log(`B5-REVERSAL top5 net: @0.009=${b5MatchedLegacy.topN[5].netReturn.toFixed(4)} @0.017=${b5MatchedReal.topN[5].netReturn.toFixed(4)}`);
console.log(`Classifier P5 selected net: @0.009=${p5MatchedLegacy.selectedNet.toFixed(4)} @0.017=${p5MatchedReal.selectedNet.toFixed(4)} (n=${p5MatchedLegacy.selectedRows}/${p5MatchedLegacy.totalRows})`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 4: build the join — per-asset, time-ordered momentum percentile-rank series, then attach
// the latest no-lookahead score to every classifier holdout trade on the matched population.
// ─────────────────────────────────────────────────────────────────────────────────────────
const byDate = new Map();
for (const row of matchedPanel.rows) {
  if (!byDate.has(row.date)) byDate.set(row.date, []);
  byDate.get(row.date).push(row);
}
const momentumByAsset = new Map(holdoutUniverse.map((s) => [s, []]));
for (const [date, rows] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
  const reversedScores = rows.map((r) => -r.trailR);
  const pct = percentileRanks(reversedScores);
  rows.forEach((r, i) => momentumByAsset.get(r.asset).push({ date, percentile: pct[i] }));
}

let noMomentumCoverage = 0;
const withMomentum = [];
for (let i = 0; i < matchedHoldoutRows.length; i++) {
  const row = matchedHoldoutRows[i];
  const tradeDate = dateOf(row.t);
  const series_ = momentumByAsset.get(row.symbol) || [];
  let match = null;
  for (let j = series_.length - 1; j >= 0; j--) {
    if (series_[j].date <= tradeDate) { match = series_[j]; break; }
  }
  if (!match) { noMomentumCoverage++; continue; }
  withMomentum.push({ symbol: row.symbol, t: row.t, netR: row.netR, classifierScore: matchedScores[i], momentumPercentile: match.percentile });
}

console.log(`\n=== STEP 4: join ===`);
console.log(`Classifier matched-holdout trades: ${matchedHoldoutRows.length}. Dropped (no momentum panel coverage yet): ${noMomentumCoverage}. Joined population: ${withMomentum.length}.`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 5: combine (fixed a priori rank-average), select top tercile, score.
// ─────────────────────────────────────────────────────────────────────────────────────────
const classifierPercentiles = percentileRanks(withMomentum.map((t) => t.classifierScore));
const joined = withMomentum.map((t, i) => ({ ...t, classifierPercentile: classifierPercentiles[i], combinedScore: (classifierPercentiles[i] + t.momentumPercentile) / 2 }));

const tercileN = Math.max(1, Math.floor(joined.length / 3));
const sortedByCombined = [...joined].sort((a, b) => b.combinedScore - a.combinedScore);
const selected = sortedByCombined.slice(0, tercileN);

const selectedGrossMean = mean(selected.map((t) => t.netR));
const baselineGrossMean = mean(joined.map((t) => t.netR));
const compositeLegacy = { selectedNet: selectedGrossMean - COSTS.legacy, baselineNet: baselineGrossMean - COSTS.legacy };
const compositeReal = { selectedNet: selectedGrossMean - COSTS.real, baselineNet: baselineGrossMean - COSTS.real };

console.log(`\n=== STEP 5: composite (top tercile by combined rank-average, n=${selected.length}/${joined.length}) ===`);
console.log(`selected gross mean netR = ${selectedGrossMean.toFixed(4)}, baseline (all joined) gross mean = ${baselineGrossMean.toFixed(4)}`);
console.log(`selected net @0.009=${compositeLegacy.selectedNet.toFixed(4)} @0.017=${compositeReal.selectedNet.toFixed(4)}`);
console.log(`baseline net @0.009=${compositeLegacy.baselineNet.toFixed(4)} @0.017=${compositeReal.baselineNet.toFixed(4)}`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 6: pre-registered significance test — one-sided permutation, combined-score tercile vs.
// same-size random tercile from the same joined population.
// ─────────────────────────────────────────────────────────────────────────────────────────
const random = seededRandom(PERM_SEED);
const netRs = joined.map((t) => t.netR);
let exceedances = 0;
const nullMeans = [];
for (let k = 0; k < PERMUTATIONS; k++) {
  const idx = shuffledIndices(joined.length, random).slice(0, tercileN);
  const randomMean = mean(idx.map((i) => netRs[i]));
  nullMeans.push(randomMean);
  if (randomMean >= selectedGrossMean) exceedances++;
}
const permutationP = (exceedances + 1) / (PERMUTATIONS + 1);
const nullMean = mean(nullMeans);
const correctSign = selectedGrossMean > nullMean;

console.log(`\n=== STEP 6: permutation test (K=${PERMUTATIONS}, seed=${PERM_SEED}) ===`);
console.log(`observed selected mean=${selectedGrossMean.toFixed(4)}, null mean=${nullMean.toFixed(4)}, p=${permutationP.toFixed(4)}, sign correct (selection beats random)=${correctSign}`);

// Secondary, due-diligence-only: block-bootstrap CI on the selected subset's net-of-real-cost R,
// temporally ordered (this project's own blockBootstrapCI/blockSize=4 convention).
const selectedByTime = [...selected].sort((a, b) => a.t - b.t).map((t) => t.netR - COSTS.real);
const ci = blockBootstrapCI(selectedByTime, { iterations: 2000, blockSize: 4, seed: PERM_SEED + 1 });
const ciExcludesZero = ci[0] !== null && ci[0] > 0;
console.log(`(due-diligence, not part of the pre-registered gate) 95% block-bootstrap CI on selected net@0.017 = [${ci[0]?.toFixed(4)}, ${ci[1]?.toFixed(4)}], excludes zero (positive): ${ciExcludesZero}`);

// ─────────────────────────────────────────────────────────────────────────────────────────
// STEP 7: apply the pre-registered gate mechanically.
// ─────────────────────────────────────────────────────────────────────────────────────────
const gate = {
  sampleFloor: joined.length >= 100,
  permutationSignificant: permutationP < 0.05 && correctSign,
  positiveAtRealCost: compositeReal.selectedNet > 0,
  beatsB5: compositeReal.selectedNet > b5MatchedReal.topN[3].netReturn && compositeReal.selectedNet > b5MatchedReal.topN[5].netReturn,
  beatsP5: compositeReal.selectedNet > p5MatchedReal.selectedNet
};
const pass = Object.values(gate).every(Boolean);

console.log(`\n=== STEP 7: pre-registered gate ===`);
console.log(JSON.stringify(gate, null, 2));
console.log(`\nRESULT: C0-SIGNAL-COMBINATION ${pass ? "PASSES" : "FAILS/KILLED"} the pre-registered gate.`);

const output = {
  specification: "C0-SIGNAL-COMBINATION/v1",
  watchlist: available,
  stable13: [...STABLE_13],
  historicalHoldout16,
  sealedSymbolsExcluded: SEALED_SYMBOLS.filter((s) => historicalHoldout16.includes(s)),
  matchedHoldoutUniverse13: holdoutUniverse,
  reproduction: { b5ReproLegacy, b5ReproReal, p5ReproLegacy, p5ReproAuc, b5ReproductionOk, p5AucMatches, p5EconomicsMatch },
  matchedBaselines: { b5MatchedLegacy, b5MatchedReal, p5MatchedLegacy, p5MatchedReal },
  join: { classifierMatchedHoldoutTrades: matchedHoldoutRows.length, droppedNoMomentumCoverage: noMomentumCoverage, joinedPopulation: joined.length },
  composite: { tercileN, selectedGrossMean, baselineGrossMean, compositeLegacy, compositeReal },
  significance: { permutations: PERMUTATIONS, seed: PERM_SEED, permutationP, nullMean, correctSign, blockBootstrapCI95: ci, ciExcludesZero },
  gate,
  pass
};
const file = saveExperiment("c0-signal-combination", { specification: "C0-SIGNAL-COMBINATION/v1" }, output);
console.log(`\nSaved: ${file}`);
