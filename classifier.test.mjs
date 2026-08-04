import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFIER_COLUMNS,
  applyZScoreScaler,
  balancedClassWeights,
  buildFeatureMatrix,
  chooseLambdaByCv,
  classifierOutcomeReport,
  economicLiftNetOfCost,
  featureVector,
  fitLogisticRegression,
  fitZScoreScaler,
  makeInnerFolds,
  mannWhitneyAuc,
  predictLogistic,
  precisionRecallAtThreshold,
  scoreClassifierHoldouts,
  scaleTrainHoldout,
  standardizedCoefficientReadout,
  splitTrainHoldout
} from "./classifier.mjs";

const record = (outcome, symbol, rsi, maDistPct) => ({
  symbol, outcome, rsi, maDistPct, roomR: 2, higherLow: true, rangePos: .5,
  stopPct: 2, biasMid: "bull", biasHigh: "flat", volRatio: 1.2,
  atrPct: 1, displacement: .1, swept: false, fvg: true,
  pdlDistPct: 3, pdhDistPct: 4, btcBias4h: "bull", btc4hRetPct: .5
});

test("P1 builds fixed tpR outcome labels and reports the exact feature columns", () => {
  const matrix = buildFeatureMatrix([
    record("win", "BTC", 60, 1),
    record("loss", "BTC", 40, -1),
    record("win", "ETH", 80, 3),
    { symbol: "ETH", outcome: "unresolved", rsi: 99 }
  ]);

  assert.deepEqual(matrix.columns, CLASSIFIER_COLUMNS);
  assert.equal(matrix.rows.length, 3);
  assert.deepEqual(matrix.report, {
    rows: 3,
    positives: 2,
    negatives: 1,
    positiveRate: 2 / 3,
    columns: CLASSIFIER_COLUMNS
  });
  assert.deepEqual(matrix.rows.map((row) => row.y), [1, 0, 1]);
  assert.equal(matrix.rows[0].symbol, "BTC");
});

test("P1 keeps whole symbols sealed and fits the z-score scaler on train only", () => {
  const rows = buildFeatureMatrix([
    record("win", "BTC", 40, 0),
    record("loss", "BTC", 60, 2),
    record("win", "ETH", 100, 10)
  ]).rows;
  const split = splitTrainHoldout(rows, { holdoutSymbols: ["ETH"] });
  const scaled = scaleTrainHoldout(split);
  const rsi = CLASSIFIER_COLUMNS.indexOf("rsi");

  assert.deepEqual(split.report.holdoutSymbols, ["ETH"]);
  assert.deepEqual(split.train.map((row) => row.symbol), ["BTC", "BTC"]);
  assert.deepEqual(split.holdout.map((row) => row.symbol), ["ETH"]);
  assert.equal(scaled.scaler.means[rsi], 50);
  assert.equal(scaled.scaler.scales[rsi], 10);
  assert.deepEqual(scaled.train.map((row) => row.x[rsi]), [-1, 1]);
  assert.equal(scaled.holdout[0].x[rsi], 5);
});

test("P1 encodes entry-time categorical fields without lookahead values", () => {
  const vector = featureVector(record("win", "BTC", 50, 1));
  assert.equal(vector.length, CLASSIFIER_COLUMNS.length);
  assert.equal(vector[CLASSIFIER_COLUMNS.indexOf("biasMid_bull")], 1);
  assert.equal(vector[CLASSIFIER_COLUMNS.indexOf("biasMid_bear")], 0);
  assert.equal(vector[CLASSIFIER_COLUMNS.indexOf("btcBias4h_bull")], 1);

  const scaler = fitZScoreScaler([{ x: vector }, { x: vector }]);
  const transformed = applyZScoreScaler([{ x: vector }], scaler);
  assert.ok(transformed[0].x.every((value) => Number.isFinite(value)));
});

test("P2 computes Mann-Whitney AUC with average ranks for tied scores", () => {
  const auc = mannWhitneyAuc([0.1, 0.4, 0.4, 0.9], [0, 1, 0, 1]);

  // Ranks are [1, 2.5, 2.5, 4]. Positive rank sum = 6.5.
  // AUC = (6.5 - 2*3/2) / (2*2) = 0.875.
  assert.equal(auc, 0.875);
  assert.equal(mannWhitneyAuc([0.2, 0.3], [1, 1]), null);
});

test("P2 uses explicit balanced class weights for imbalanced rows", () => {
  const weights = balancedClassWeights([
    { y: 1, x: [1] },
    { y: 0, x: [0] },
    { y: 0, x: [0] },
    { y: 0, x: [0] }
  ]);

  assert.equal(weights[1], 2);
  assert.equal(weights[0], 2 / 3);
});

test("P2 fits deterministic finite logistic probabilities on a planted signal", () => {
  const rows = [
    { y: 0, x: [-2] },
    { y: 0, x: [-1] },
    { y: 1, x: [1] },
    { y: 1, x: [2] }
  ];

  const first = fitLogisticRegression(rows, { lambda: 0.1, iterations: 800, learningRate: 0.2 });
  const second = fitLogisticRegression(rows, { lambda: 0.1, iterations: 800, learningRate: 0.2 });

  assert.deepEqual(second.weights, first.weights);
  assert.equal(second.bias, first.bias);
  assert.ok(Number.isFinite(predictLogistic(first, [-1])));
  assert.ok(Number.isFinite(predictLogistic(first, [1])));
  assert.ok(predictLogistic(first, [-1]) < predictLogistic(first, [1]));
  assert.ok(first.weights[0] > 0);
  assert.ok(mannWhitneyAuc(rows.map((row) => predictLogistic(first, row)), rows.map((row) => row.y)) > 0.5);
});

test("P2 planted signal beats chance while a deterministic null remains near chance", () => {
  const planted = Array.from({ length: 20 }, (_, i) => ({ y: i < 10 ? 0 : 1, x: [i < 10 ? -1 : 1] }));
  const nullRows = Array.from({ length: 20 }, (_, i) => ({ y: i % 2, x: [(i * 7) % 5 - 2] }));
  const plantedModel = fitLogisticRegression(planted, { lambda: 0.1, iterations: 800 });
  const nullModel = fitLogisticRegression(nullRows, { lambda: 0.1, iterations: 800 });
  const plantedAuc = mannWhitneyAuc(planted.map((row) => predictLogistic(plantedModel, row)), planted.map((row) => row.y));
  const nullAuc = mannWhitneyAuc(nullRows.map((row) => predictLogistic(nullModel, row)), nullRows.map((row) => row.y));
  assert.ok(plantedAuc > 0.99);
  assert.ok(Math.abs(nullAuc - 0.5) < 0.1);
});

test("P2 chooses lambda only from deterministic inner train folds", () => {
  const train = [
    { symbol: "BTC", y: 0, x: [-2] },
    { symbol: "BTC", y: 0, x: [-1] },
    { symbol: "ETH", y: 0, x: [-0.5] },
    { symbol: "ETH", y: 1, x: [0.5] },
    { symbol: "SOL", y: 1, x: [1] },
    { symbol: "SOL", y: 1, x: [2] }
  ];

  const folds = makeInnerFolds(train, { folds: 3 });
  assert.deepEqual(
    folds.flatMap((fold) => fold.validationIndices).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5]
  );
  assert.ok(folds.every((fold) => fold.train.length + fold.validation.length === train.length));

  const selected = chooseLambdaByCv(train, {
    lambdas: [0.1, 1],
    folds: 3,
    iterations: 800,
    learningRate: 0.15
  });

  assert.ok([0, 0.1].includes(selected.lambda));
  assert.equal(selected.rows, train.length);
  assert.equal(selected.folds, 3);
  assert.equal(selected.candidates.length, 2);
  assert.equal(selected.classWeights[0], 1);
  assert.equal(selected.classWeights[1], 1);
  assert.ok(selected.candidates.every((candidate) => candidate.folds.every((fold) => fold.trainRows === 4 && fold.validationRows === 2)));
});

test("P2 refuses to score a non-converged CV fit", () => {
  const rows = [
    { y: 0, x: [-2] }, { y: 0, x: [-1] }, { y: 1, x: [1] }, { y: 1, x: [2] }
  ];
  assert.throws(
    () => chooseLambdaByCv(rows, { lambdas: [0.1], folds: 2, iterations: 1, learningRate: 0.1 }),
    /did not converge/
  );
});

test("P3 refits the full pipeline per permutation and reports the exact p formula", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    symbol: i < 8 ? (i % 2 ? "ETH" : "BTC") : "SOL",
    t: i + 1,
    y: i % 2,
    x: [i - 5]
  }));
  const result = scoreClassifierHoldouts(rows, {
    holdoutSymbols: ["SOL"], recentHoldoutTime: 5, permutations: 100,
    lambdas: [0.1, 1], folds: 2, iterations: 800, seed: 17
  });

  assert.equal(result.primary.status, "available");
  assert.equal(result.primary.K, 100);
  assert.equal(result.primary.validNull, 100);
  assert.equal(result.primary.nullAucs.length, 100);
  assert.equal(result.primary.selectedLambdas.length, 100);
  assert.equal(result.primary.scalerMeans[0][0], -1.5);
  assert.equal(result.primary.p, (result.primary.exceedances + 1) / (result.primary.validNull + 1));
  assert.equal(result.recent.status, "available");
  assert.equal(result.recent.trainRows, 4);
  assert.equal(result.recent.holdoutRows, 4);
});

test("P3 holdout rows cannot influence train scaling or lambda selection", () => {
  const train = Array.from({ length: 8 }, (_, i) => ({ symbol: "BTC", t: i + 1, y: i % 2, x: [i] }));
  const make = (values) => scoreClassifierHoldouts([...train, ...values.map((x, i) => ({ symbol: "ETH", t: i + 9, y: i % 2, x: [x] }))], {
    holdoutSymbols: ["ETH"], permutations: 100, lambdas: [0.1, 1], folds: 2, iterations: 800, seed: 2
  });
  const base = make([1000, 1001, 1002, 1003]);
  const changed = make([-1000, -999, -998, -997]);
  assert.equal(base.primary.scalerMeans[0][0], 3.5);
  assert.equal(changed.primary.scalerMeans[0][0], 3.5);
  assert.equal(base.primary.selectedLambda, changed.primary.selectedLambda);
});

test("P3 returns unavailable instead of claiming AUC for tiny or single-class holdouts", () => {
  const rows = [
    { symbol: "BTC", t: 1, y: 0, x: [0] }, { symbol: "BTC", t: 2, y: 1, x: [1] },
    { symbol: "ETH", t: 3, y: 1, x: [2] }, { symbol: "ETH", t: 4, y: 1, x: [3] },
    { symbol: "ETH", t: 5, y: 1, x: [4] }, { symbol: "ETH", t: 6, y: 1, x: [5] }
  ];
  const result = scoreClassifierHoldouts(rows, { holdoutSymbols: ["ETH"], permutations: 100, lambdas: [0.1], folds: 2 });
  assert.equal(result.primary.status, "unavailable");
  assert.equal(result.primary.holdoutAuc, null);
  assert.match(result.primary.reason, /one class/);
  const tiny = scoreClassifierHoldouts(rows, { holdoutSymbols: ["BTC"], permutations: 100, lambdas: [0.1], folds: 2 });
  assert.equal(tiny.primary.status, "unavailable");
  assert.match(tiny.primary.reason, /too small/);
});

test("P4 reports standardized coefficients and fixed-threshold precision/recall", () => {
  const rows = [
    { y: 0, x: [-2], netR: -1 }, { y: 0, x: [-1], netR: -1 },
    { y: 1, x: [1], netR: 3 }, { y: 1, x: [2], netR: 3 }
  ];
  const model = fitLogisticRegression(rows, { lambda: 0.1, iterations: 800 });
  const coefficients = standardizedCoefficientReadout(model, ["signal"]);
  assert.equal(coefficients[0].column, "signal");
  assert.ok(coefficients[0].coefficient > 0);
  assert.deepEqual(precisionRecallAtThreshold([.2, .4, .8, .9], [0, 1, 1, 1]), {
    threshold: .5, tp: 2, fp: 0, fn: 1, precision: 1, recall: 2 / 3
  });
});

test("P4 calculates economic lift only after explicit round-trip cost", () => {
  const result = economicLiftNetOfCost(
    [{ netR: -1 }, { netR: 1 }, { netR: 3 }],
    [.1, .6, .9],
    { threshold: .5, roundTripCost: .25 }
  );
  assert.equal(result.selectedRows, 2);
  assert.equal(result.selectedNet, 1.75);
  assert.equal(result.baselineNet, 0.75);
  assert.equal(result.lift, 1);
});

test("P4 outcome report includes required imbalance and survivorship caveats", () => {
  const rows = [{ y: 0, x: [-2], netR: -1 }, { y: 0, x: [-1], netR: -1 }, { y: 1, x: [1], netR: 3 }, { y: 1, x: [2], netR: 3 }];
  const model = fitLogisticRegression(rows, { lambda: 0.1, iterations: 800 });
  const report = classifierOutcomeReport({ model, columns: ["signal"], train: rows, holdout: rows, roundTripCost: .25 });
  assert.equal(report.coefficients[0].column, "signal");
  assert.equal(report.threshold, .5);
  assert.equal(report.economic.roundTripCost, .25);
  assert.equal(report.caveats.some((text) => text.includes("survivorship")), true);
  assert.equal(report.caveats.some((text) => text.includes("Class imbalance")), true);
});
