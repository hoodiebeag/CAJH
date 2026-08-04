import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFIER_COLUMNS,
  buildFeatureMatrix,
  classifierReport,
  scaleTrainHoldout,
  splitTrainHoldout
} from "./classifier.mjs";

const rec = (overrides) => ({
  outcome: "loss",
  t: 1,
  rsi: 50,
  maDistPct: 2,
  roomR: 3,
  rangePos: 0.4,
  higherLow: true,
  stopPct: 1.5,
  volRatio: 1.2,
  atrPct: 2.5,
  displacement: 0.7,
  swept: false,
  fvg: true,
  pdlDistPct: 4,
  pdhDistPct: 5,
  btc4hRetPct: -1,
  biasMid: "bull",
  biasHigh: "bear",
  btcBias4h: "bull",
  ...overrides
});

test("buildFeatureMatrix encodes fixed columns and tpR=4 win/loss labels", () => {
  const matrix = buildFeatureMatrix([rec({ outcome: "win", symbol: "BTC" }), rec({ outcome: "loss", symbol: "ETH" }), rec({ outcome: "open" })]);

  assert.deepEqual(matrix.columns, CLASSIFIER_COLUMNS);
  assert.equal(matrix.rows.length, 2);
  assert.deepEqual(matrix.rows.map((row) => row.y), [1, 0]);
  assert.equal(matrix.rows[0].symbol, "BTC");
  assert.equal(matrix.rows[0].x[CLASSIFIER_COLUMNS.indexOf("higherLow")], 1);
  assert.equal(matrix.rows[0].x[CLASSIFIER_COLUMNS.indexOf("swept")], 0);
  assert.equal(matrix.rows[0].x[CLASSIFIER_COLUMNS.indexOf("fvg")], 1);
  assert.equal(matrix.rows[0].x[CLASSIFIER_COLUMNS.indexOf("biasMid_bull")], 1);
  assert.equal(matrix.rows[0].x[CLASSIFIER_COLUMNS.indexOf("biasMid_bear")], 0);
  assert.equal(matrix.report.positiveRate, 0.5);
});

test("splitTrainHoldout uses whole symbols only", () => {
  const rows = [
    ...buildFeatureMatrix([rec({ outcome: "win" })], { symbol: "BTC" }).rows,
    ...buildFeatureMatrix([rec({ outcome: "loss" })], { symbol: "ETH" }).rows,
    ...buildFeatureMatrix([rec({ outcome: "win" })], { symbol: "SOL" }).rows
  ];

  const split = splitTrainHoldout(rows, { holdoutSymbols: ["ETH"] });

  assert.deepEqual(split.train.map((row) => row.symbol), ["BTC", "SOL"]);
  assert.deepEqual(split.holdout.map((row) => row.symbol), ["ETH"]);
  assert.deepEqual(split.report.holdoutSymbols, ["ETH"]);
});

test("scaleTrainHoldout fits z-score parameters on train only", () => {
  const rows = [
    { symbol: "A", y: 0, x: [10, 1] },
    { symbol: "B", y: 1, x: [20, 1] },
    { symbol: "H", y: 1, x: [1000, 1000] }
  ];
  const scaled = scaleTrainHoldout(splitTrainHoldout(rows, { holdoutSymbols: ["H"], columns: ["a", "b"] }));

  assert.deepEqual(scaled.scaler.means, [15, 1]);
  assert.deepEqual(scaled.scaler.scales, [5, 1]);
  assert.deepEqual(scaled.train.map((row) => row.x), [[-1, 0], [1, 0]]);
  assert.deepEqual(scaled.holdout[0].x, [197, 999]);
});

test("classifierReport exposes class balance and column order", () => {
  const rows = [{ y: 1 }, { y: 1 }, { y: 0 }];

  assert.deepEqual(classifierReport(rows, ["x"]), {
    rows: 3,
    positives: 2,
    negatives: 1,
    positiveRate: 2 / 3,
    columns: ["x"]
  });
});
