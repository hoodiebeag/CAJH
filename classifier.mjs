import { profileEntries } from "./backtest.js";

export const CLASSIFIER_COLUMNS = Object.freeze([
  "rsi",
  "maDistPct",
  "roomR",
  "rangePos",
  "higherLow",
  "stopPct",
  "volRatio",
  "atrPct",
  "displacement",
  "swept",
  "fvg",
  "pdlDistPct",
  "pdhDistPct",
  "btc4hRetPct",
  "biasMid_bull",
  "biasMid_bear",
  "biasHigh_bull",
  "biasHigh_bear",
  "btcBias4h_bull",
  "btcBias4h_bear"
]);

const asNumber = (value) => typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
const finiteOrZero = (value) => Number.isFinite(asNumber(value)) ? asNumber(value) : 0;
const flag = (value, expected) => value === expected ? 1 : 0;
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev = (xs) => xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : 0;

export function featureVector(record, columns = CLASSIFIER_COLUMNS) {
  const values = {
    rsi: finiteOrZero(record.rsi),
    maDistPct: finiteOrZero(record.maDistPct),
    roomR: finiteOrZero(record.roomR),
    rangePos: finiteOrZero(record.rangePos),
    higherLow: finiteOrZero(record.higherLow),
    stopPct: finiteOrZero(record.stopPct),
    volRatio: finiteOrZero(record.volRatio),
    atrPct: finiteOrZero(record.atrPct),
    displacement: finiteOrZero(record.displacement),
    swept: finiteOrZero(record.swept),
    fvg: finiteOrZero(record.fvg),
    pdlDistPct: finiteOrZero(record.pdlDistPct),
    pdhDistPct: finiteOrZero(record.pdhDistPct),
    btc4hRetPct: finiteOrZero(record.btc4hRetPct),
    biasMid_bull: flag(record.biasMid, "bull"),
    biasMid_bear: flag(record.biasMid, "bear"),
    biasHigh_bull: flag(record.biasHigh, "bull"),
    biasHigh_bear: flag(record.biasHigh, "bear"),
    btcBias4h_bull: flag(record.btcBias4h, "bull"),
    btcBias4h_bear: flag(record.btcBias4h, "bear")
  };
  return columns.map((column) => values[column] ?? 0);
}

export function buildFeatureMatrix(records, { symbol = null, columns = CLASSIFIER_COLUMNS } = {}) {
  const rows = records
    .filter((record) => record?.outcome === "win" || record?.outcome === "loss")
    .map((record) => ({
      symbol: record.symbol ?? symbol,
      t: record.t,
      y: record.outcome === "win" ? 1 : 0,
      x: featureVector(record, columns),
      netR: record.netR
    }));
  return { columns: [...columns], rows, report: classifierReport(rows, columns) };
}

export function buildMatrixFromProfileInputs(inputs, {
  tpR = 4,
  holdoutSymbols = [],
  columns = CLASSIFIER_COLUMNS
} = {}) {
  const allRows = [];
  for (const input of inputs) {
    const { records } = profileEntries(input.profileInput, { ...(input.profileOptions || {}), tpR });
    allRows.push(...buildFeatureMatrix(records, { symbol: input.symbol, columns }).rows);
  }
  return splitTrainHoldout(allRows, { holdoutSymbols, columns });
}

export function splitTrainHoldout(rows, { holdoutSymbols = [], columns = CLASSIFIER_COLUMNS } = {}) {
  const held = new Set(holdoutSymbols);
  const train = rows.filter((row) => !held.has(row.symbol));
  const holdout = rows.filter((row) => held.has(row.symbol));
  return { columns: [...columns], train, holdout, report: { train: classifierReport(train, columns), holdout: classifierReport(holdout, columns), holdoutSymbols: [...held] } };
}

export function fitZScoreScaler(rows) {
  const width = rows[0]?.x?.length || 0;
  const means = [];
  const scales = [];
  for (let j = 0; j < width; j++) {
    const values = rows.map((row) => row.x[j]);
    means.push(mean(values));
    scales.push(stdev(values) || 1);
  }
  return { means, scales };
}

export function applyZScoreScaler(rows, scaler) {
  return rows.map((row) => ({ ...row, x: row.x.map((value, i) => (value - scaler.means[i]) / scaler.scales[i]) }));
}

export function scaleTrainHoldout(split) {
  const scaler = fitZScoreScaler(split.train);
  return {
    columns: split.columns,
    scaler,
    train: applyZScoreScaler(split.train, scaler),
    holdout: applyZScoreScaler(split.holdout, scaler),
    report: split.report
  };
}

export function classifierReport(rows, columns = CLASSIFIER_COLUMNS) {
  const positives = rows.filter((row) => row.y === 1).length;
  const negatives = rows.filter((row) => row.y === 0).length;
  return {
    rows: rows.length,
    positives,
    negatives,
    positiveRate: rows.length ? positives / rows.length : null,
    columns: [...columns]
  };
}

const DEFAULT_LAMBDAS = Object.freeze([0, 0.01, 0.1, 1]);

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const clampProb = (p) => Math.min(1 - 1e-15, Math.max(1e-15, p));

export function sigmoid(z) {
  if (z >= 35) return 1;
  if (z <= -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function balancedClassWeights(rows) {
  const positives = rows.filter((row) => row.y === 1).length;
  const negatives = rows.filter((row) => row.y === 0).length;
  if (!positives || !negatives) {
    throw new Error("logistic regression requires both positive and negative rows");
  }
  return {
    0: rows.length / (2 * negatives),
    1: rows.length / (2 * positives)
  };
}

function validateRows(rows) {
  if (!rows.length) throw new Error("logistic regression requires rows");
  const width = rows[0].x?.length;
  if (!width) throw new Error("logistic regression requires feature columns");
  for (const row of rows) {
    if (row.y !== 0 && row.y !== 1) throw new Error("row labels must be 0 or 1");
    if (!Array.isArray(row.x) || row.x.length !== width || row.x.some((v) => !Number.isFinite(v))) {
      throw new Error("row features must be finite and fixed-width");
    }
  }
  return width;
}

export function fitLogisticRegression(rows, {
  lambda = 0.01,
  iterations = 800,
  learningRate = 0.1,
  tolerance = 1e-10,
  classWeights = balancedClassWeights(rows)
} = {}) {
  const width = validateRows(rows);
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error("lambda must be finite and non-negative");

  const weights = Array(width).fill(0);
  let bias = 0;
  let previousLoss = Infinity;
  let converged = false;
  let iteration = 0;

  for (; iteration < iterations; iteration++) {
    const grad = Array(width).fill(0);
    let biasGrad = 0;
    let weightTotal = 0;

    for (const row of rows) {
      const sampleWeight = classWeights[row.y] ?? 1;
      const error = sigmoid(dot(weights, row.x) + bias) - row.y;
      weightTotal += sampleWeight;
      biasGrad += sampleWeight * error;
      for (let j = 0; j < width; j++) grad[j] += sampleWeight * error * row.x[j];
    }

    const normalizer = weightTotal || rows.length;
    bias -= learningRate * (biasGrad / normalizer);
    for (let j = 0; j < width; j++) {
      weights[j] -= learningRate * ((grad[j] / normalizer) + lambda * weights[j]);
    }

    const loss = logisticLogLoss(rows, { weights, bias, lambda, classWeights });
    if (!Number.isFinite(loss)) throw new Error("logistic regression produced a non-finite loss");
    if (Math.abs(previousLoss - loss) < tolerance) {
      converged = true;
      iteration += 1;
      break;
    }
    previousLoss = loss;
  }

  return { weights, bias, lambda, iterations: iteration, converged, classWeights: { ...classWeights } };
}

function assertScorableModel(model) {
  if (model.converged === false) {
    throw new Error("non-converged logistic model is invalid for scoring");
  }
}

export function predictLogistic(model, rowOrVector) {
  assertScorableModel(model);
  const x = Array.isArray(rowOrVector) ? rowOrVector : rowOrVector.x;
  const probability = sigmoid(dot(model.weights, x) + model.bias);
  if (!Number.isFinite(probability)) throw new Error("logistic prediction is non-finite");
  return probability;
}

export function logisticLogLoss(rows, model) {
  assertScorableModel(model);
  validateRows(rows);
  let weightedLoss = 0;
  let weightTotal = 0;
  for (const row of rows) {
    const sampleWeight = model.classWeights?.[row.y] ?? 1;
    const p = clampProb(predictLogistic(model, row));
    weightedLoss += sampleWeight * (-(row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p)));
    weightTotal += sampleWeight;
  }
  const penalty = 0.5 * (model.lambda || 0) * model.weights.reduce((sum, w) => sum + w * w, 0);
  return weightedLoss / (weightTotal || rows.length) + penalty;
}

export function mannWhitneyAuc(scores, labels) {
  if (scores.length !== labels.length) throw new Error("scores and labels must have the same length");
  const ranked = scores.map((score, i) => ({ score, label: labels[i] }))
    .filter((row) => Number.isFinite(row.score) && (row.label === 0 || row.label === 1))
    .sort((a, b) => a.score - b.score);
  const positives = ranked.filter((row) => row.label === 1).length;
  const negatives = ranked.filter((row) => row.label === 0).length;
  if (!positives || !negatives) return null;

  let positiveRankSum = 0;
  for (let i = 0; i < ranked.length;) {
    let j = i + 1;
    while (j < ranked.length && ranked[j].score === ranked[i].score) j++;
    const averageRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      if (ranked[k].label === 1) positiveRankSum += averageRank;
    }
    i = j;
  }
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function makeInnerFolds(rows, { folds = 3 } = {}) {
  if (folds < 2) throw new Error("at least two folds are required");
  const positives = [];
  const negatives = [];
  rows.forEach((row, index) => (row.y === 1 ? positives : negatives).push(index));
  const buckets = Array.from({ length: Math.min(folds, rows.length) }, () => []);
  for (const [offset, indices] of [positives, negatives].entries()) {
    indices.forEach((index, i) => buckets[(i + offset) % buckets.length].push(index));
  }
  return buckets
    .filter((validation) => validation.length)
    .map((validation) => {
      const held = new Set(validation);
      return {
        train: rows.filter((_, index) => !held.has(index)),
        validation: validation.map((index) => rows[index]),
        validationIndices: validation
      };
    });
}

export function chooseLambdaByCv(rows, {
  lambdas = DEFAULT_LAMBDAS,
  folds = 3,
  iterations = 800,
  learningRate = 0.1
} = {}) {
  validateRows(rows);
  const innerFolds = makeInnerFolds(rows, { folds });
  const candidates = lambdas.map((lambda) => {
    const foldScores = innerFolds.map((fold) => {
      const model = fitLogisticRegression(fold.train, { lambda, iterations, learningRate });
      if (!model.converged) throw new Error(`logistic regression did not converge for lambda ${lambda}`);
      const scores = fold.validation.map((row) => predictLogistic(model, row));
      const auc = mannWhitneyAuc(scores, fold.validation.map((row) => row.y));
      const loss = logisticLogLoss(fold.validation, model);
      return { auc, loss, trainRows: fold.train.length, validationRows: fold.validation.length };
    });
    const validAucs = foldScores.map((score) => score.auc).filter((auc) => auc !== null);
    return {
      lambda,
      folds: foldScores,
      meanAuc: validAucs.length ? mean(validAucs) : null,
      meanLoss: mean(foldScores.map((score) => score.loss))
    };
  });

  candidates.sort((a, b) => {
    if (a.meanAuc !== null || b.meanAuc !== null) {
      if (a.meanAuc === null) return 1;
      if (b.meanAuc === null) return -1;
      if (b.meanAuc !== a.meanAuc) return b.meanAuc - a.meanAuc;
    }
    if (a.meanLoss !== b.meanLoss) return a.meanLoss - b.meanLoss;
    return a.lambda - b.lambda;
  });

  const selected = candidates[0];
  const model = fitLogisticRegression(rows, { lambda: selected.lambda, iterations, learningRate });
  if (!model.converged) throw new Error(`logistic regression did not converge for selected lambda ${selected.lambda}`);
  return {
    lambda: selected.lambda,
    candidates,
    folds: innerFolds.length,
    rows: rows.length,
    classWeights: balancedClassWeights(rows),
    model
  };
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffledLabels(rows, random) {
  const labels = rows.map((row) => row.y);
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  return rows.map((row, i) => ({ ...row, y: labels[i] }));
}

function unavailable(reason, extra = {}) {
  return { status: "unavailable", reason, trainRows: 0, holdoutRows: 0, trainAuc: null, holdoutAuc: null, gap: null, K: 0, validNull: 0, exceedances: 0, p: null, ...extra };
}

function scoreSealedSplit(trainRows, holdoutRows, {
  permutations = 100,
  seed = 20260804,
  lambdas = DEFAULT_LAMBDAS,
  folds = 3,
  iterations = 800,
  learningRate = 0.1,
  minHoldoutRows = 4
} = {}) {
  if (holdoutRows.length < minHoldoutRows) return unavailable("holdout too small", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });
  if (new Set(holdoutRows.map((row) => row.y)).size < 2) return unavailable("holdout has one class", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });
  if (new Set(trainRows.map((row) => row.y)).size < 2) return unavailable("train has one class", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });
  if (permutations < 100) return unavailable("fewer than 100 requested permutations", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });

  let scaled;
  let selected;
  try {
    scaled = scaleTrainHoldout({ columns: [], train: trainRows, holdout: holdoutRows });
    selected = chooseLambdaByCv(scaled.train, { lambdas, folds, iterations, learningRate });
  } catch (error) {
    return unavailable(`model fit failed: ${error.message}`, { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });
  }
  const trainScores = scaled.train.map((row) => predictLogistic(selected.model, row));
  const holdoutScores = scaled.holdout.map((row) => predictLogistic(selected.model, row));
  const trainAuc = mannWhitneyAuc(trainScores, scaled.train.map((row) => row.y));
  const holdoutAuc = mannWhitneyAuc(holdoutScores, scaled.holdout.map((row) => row.y));
  if (trainAuc === null || holdoutAuc === null) return unavailable("AUC unavailable for single-class data", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations });

  const random = seededRandom(seed);
  const nullAucs = [];
  const selectedLambdas = [];
  const scalerMeans = [];
  for (let k = 0; k < permutations; k++) {
    try {
      const permutedTrain = shuffledLabels(trainRows, random);
      if (new Set(permutedTrain.map((row) => row.y)).size < 2) continue;
      const permuted = scaleTrainHoldout({ columns: [], train: permutedTrain, holdout: holdoutRows });
      const nullSelected = chooseLambdaByCv(permuted.train, { lambdas, folds, iterations, learningRate });
      const scores = permuted.holdout.map((row) => predictLogistic(nullSelected.model, row));
      const auc = mannWhitneyAuc(scores, permuted.holdout.map((row) => row.y));
      if (auc === null) continue;
      nullAucs.push(auc);
      selectedLambdas.push(nullSelected.lambda);
      scalerMeans.push(permuted.scaler.means);
    } catch {
      // A failed permutation is invalid, never silently counted as a null result.
    }
  }
  const exceedances = nullAucs.filter((auc) => auc >= holdoutAuc).length;
  if (nullAucs.length < 100) return unavailable("fewer than 100 valid permutations", { trainRows: trainRows.length, holdoutRows: holdoutRows.length, K: permutations, validNull: nullAucs.length, exceedances, nullAucs, selectedLambdas, scalerMeans });
  return {
    status: "available",
    trainRows: trainRows.length,
    holdoutRows: holdoutRows.length,
    positives: { train: trainRows.filter((row) => row.y === 1).length, holdout: holdoutRows.filter((row) => row.y === 1).length },
    trainAuc,
    holdoutAuc,
    gap: trainAuc - holdoutAuc,
    K: permutations,
    validNull: nullAucs.length,
    exceedances,
    p: (exceedances + 1) / (nullAucs.length + 1),
    selectedLambda: selected.lambda,
    converged: selected.model.converged,
    scalerMeans: scaled.scaler.means,
    nullAucs,
    selectedLambdas,
    scalerMeans
  };
}

export function scoreClassifierHoldouts(rows, {
  holdoutSymbols = [],
  recentHoldoutTime = null,
  ...options
} = {}) {
  const held = new Set(holdoutSymbols);
  const primaryTrain = rows.filter((row) => !held.has(row.symbol));
  const primaryHoldout = rows.filter((row) => held.has(row.symbol));
  const recentPool = primaryTrain;
  const recent = recentHoldoutTime == null ? [] : recentPool.filter((row) => row.t >= recentHoldoutTime);
  const recentTrain = recentHoldoutTime == null ? [] : recentPool.filter((row) => row.t < recentHoldoutTime);
  return {
    primary: scoreSealedSplit(primaryTrain, primaryHoldout, options),
    recent: scoreSealedSplit(recentTrain, recent, options)
  };
}

export const scoreSealedHoldouts = scoreClassifierHoldouts;

export function standardizedCoefficientReadout(model, columns = CLASSIFIER_COLUMNS) {
  assertScorableModel(model);
  return columns.map((column, index) => ({ column, coefficient: model.weights[index] ?? 0 }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
}

export function precisionRecallAtThreshold(scores, labels, threshold = 0.5) {
  if (scores.length !== labels.length) throw new Error("scores and labels must have the same length");
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const predicted = scores[i] >= threshold;
    if (predicted && labels[i] === 1) tp++;
    else if (predicted) fp++;
    else if (labels[i] === 1) fn++;
  }
  return { threshold, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

export function economicLiftNetOfCost(rows, scores, { threshold = 0.5, roundTripCost = 0 } = {}) {
  if (rows.length !== scores.length) throw new Error("rows and scores must have the same length");
  const selected = rows.filter((_, i) => scores[i] >= threshold);
  const net = (subset) => subset.length ? mean(subset.map((row) => Number(row.netR) - roundTripCost)) : null;
  const selectedNet = net(selected);
  const baselineNet = net(rows);
  return {
    threshold,
    selectedRows: selected.length,
    totalRows: rows.length,
    selectedNet,
    baselineNet,
    lift: selectedNet === null || baselineNet === null ? null : selectedNet - baselineNet,
    roundTripCost
  };
}

export function classifierOutcomeReport({ model, columns = CLASSIFIER_COLUMNS, train = [], holdout = [], threshold = 0.5, roundTripCost = 0 } = {}) {
  assertScorableModel(model);
  const score = (rows) => rows.map((row) => predictLogistic(model, row));
  const trainScores = score(train), holdoutScores = score(holdout);
  return {
    coefficients: standardizedCoefficientReadout(model, columns),
    threshold,
    train: precisionRecallAtThreshold(trainScores, train.map((row) => row.y), threshold),
    holdout: precisionRecallAtThreshold(holdoutScores, holdout.map((row) => row.y), threshold),
    economic: economicLiftNetOfCost(holdout, holdoutScores, { threshold, roundTripCost }),
    caveats: [
      "AUC and precision/recall are conditional on fixed tpR=4 labels and the structural stop.",
      "Class imbalance is reported; precision/recall depend on the fixed threshold.",
      "Whole-symbol holdout is required because entries within a symbol are correlated.",
      "The surviving-symbol universe is subject to survivorship bias.",
      "Economic lift is research-only and net of the explicit round-trip cost."
    ]
  };
}
