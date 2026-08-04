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
