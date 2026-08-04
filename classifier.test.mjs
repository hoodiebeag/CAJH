import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFIER_COLUMNS,
  applyZScoreScaler,
  buildFeatureMatrix,
  featureVector,
  fitZScoreScaler,
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
