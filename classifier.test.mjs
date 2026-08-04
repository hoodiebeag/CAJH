import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFIER_COLUMNS,
  applyZScoreScaler,
  balancedClassWeights,
  buildFeatureMatrix,
  chooseLambdaByCv,
  featureVector,
  fitLogisticRegression,
  fitZScoreScaler,
  makeInnerFolds,
  mannWhitneyAuc,
  predictLogistic,
  scaleTrainHoldout,
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

  const first = fitLogisticRegression(rows, { lambda: 0.01, iterations: 400, learningRate: 0.2 });
  const second = fitLogisticRegression(rows, { lambda: 0.01, iterations: 400, learningRate: 0.2 });

  assert.deepEqual(second.weights, first.weights);
  assert.equal(second.bias, first.bias);
  assert.ok(Number.isFinite(predictLogistic(first, [-1])));
  assert.ok(Number.isFinite(predictLogistic(first, [1])));
  assert.ok(predictLogistic(first, [-1]) < predictLogistic(first, [1]));
  assert.ok(first.weights[0] > 0);
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
    lambdas: [0, 0.1],
    folds: 3,
    iterations: 300,
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
