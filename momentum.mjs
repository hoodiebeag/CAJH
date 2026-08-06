/**
 * Pre-registered cross-sectional momentum study. Research only: it never submits orders.
 * See MOMENTUM_SPEC.md for the estimand and promotion/kill criteria.
 */
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { dataManifest, loadDailyCandles, saveExperiment } from "./researchlab.mjs";

const DAY = 86400;
export const STABLE_13 = Object.freeze([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "BCH", "ATOM", "XLM"
]);
// Frozen before scoring; BCH/XLM are not present in the current stored watchlist.
export const PRIMARY_SYMBOL_HOLDOUT = Object.freeze(["ATOM", "DOT", "LTC"]);
export const RECENT_HOLDOUT_DAYS = 180;
export const Q1_ONLY_START = "2026-01-01";
export const Q1_ONLY_END = "2026-04-01";
const logReturn = (a, b) => Math.log(b / a);
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev = (xs) => xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : 0;
const pearson = (a, b) => {
  const ma = mean(a), mb = mean(b);
  const top = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const den = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return den ? top / den : null;
};

export function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i + 1; while (j < order.length && order[j].value === order[i].value) j++;
    const rank = (i + 1 + j) / 2;
    for (; i < j; i++) out[order[i].index] = rank;
  }
  return out;
}
export const spearman = (a, b) => pearson(ranks(a), ranks(b));

function seeded(seed = 20260301) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function shuffled(n, random) {
  const xs = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i; i--) { const j = Math.floor(random() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs;
}
export function permutationP(panels, iterations = 1000, seed = 20260301) {
  const observed = mean(panels.map((p) => p.ic)); const random = seeded(seed); let extreme = 0;
  for (let n = 0; n < iterations; n++) {
    const order = shuffled(panels.length, random);
    const statistic = mean(panels.map((p, i) => spearman(p.signal, panels[order[i]].forward)));
    if (statistic >= observed) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}
export function bootstrapCI(values, iterations = 1000, seed = 20260302) {
  if (!values.length) return [null, null];
  const random = seeded(seed); const samples = [];
  for (let n = 0; n < iterations; n++) samples.push(mean(Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)])));
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * .025)], samples[Math.floor(iterations * .975)]];
}
export function blockBootstrapCI(values, { iterations = 1000, blockSize = 4, seed = 20260303 } = {}) {
  if (!values.length) return [null, null];
  const random = seeded(seed);
  const width = Math.max(1, Math.min(blockSize, values.length));
  const samples = [];
  for (let n = 0; n < iterations; n++) {
    const sample = [];
    while (sample.length < values.length) {
      const start = Math.floor(random() * (values.length - width + 1));
      sample.push(...values.slice(start, start + width));
    }
    samples.push(mean(sample.slice(0, values.length)));
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * .025)], samples[Math.floor(iterations * .975)]];
}
export function bhFdr(rows) {
  const ordered = [...rows].sort((a, b) => a.p - b.p);
  let prior = 1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    prior = Math.min(prior, ordered[i].p * ordered.length / (i + 1)); ordered[i].q = Math.min(1, prior);
  }
  return rows;
}

export function splitMomentumPanels(panels, { recentDays = RECENT_HOLDOUT_DAYS } = {}) {
  const latest = panels.reduce((max, panel) => Math.max(max, panel.time), -Infinity);
  const cutoff = Number.isFinite(latest) ? latest - recentDays * DAY : Infinity;
  return {
    cutoff,
    train: panels.filter((panel) => panel.time < cutoff),
    recentHoldout: panels.filter((panel) => panel.time >= cutoff)
  };
}

export function splitPrimarySymbols(series, {
  universe = STABLE_13,
  holdout = PRIMARY_SYMBOL_HOLDOUT
} = {}) {
  const available = new Set([...series.keys()]);
  const primary = [...universe].filter((symbol) => available.has(symbol));
  const held = [...holdout].filter((symbol) => primary.includes(symbol));
  const train = primary.filter((symbol) => !held.includes(symbol));
  if (held.length !== holdout.length) throw new Error("Primary symbol holdout is not fully available.");
  if (train.filter((symbol) => symbol !== "BTC").length < 8) throw new Error("Primary training universe has fewer than eight assets.");
  return { primary, train, holdout: held };
}

const dateOf = (time) => new Date(time * 1000).toISOString().slice(0, 10);
const inDateWindow = (date, start, end) => date >= start && date < end;
const closeByDate = (candles) => new Map(candles.map((c) => [dateOf(c.time), c.close]));
const rowByDate = (candles) => new Map(candles.map((c, i) => [dateOf(c.time), { ...c, i }]));
const byDateRows = (rows) => {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push(row);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, dateRows]) => ({ date, rows: dateRows }));
};

export function perDateIC(rows, { minAssets = 8 } = {}) {
  return byDateRows(rows).flatMap(({ date, rows: dateRows }) => {
    if (dateRows.length < minAssets) return [];
    const trail = dateRows.map((r) => r.trailR);
    const forward = dateRows.map((r) => r.fwdR);
    const ic = spearman(trail, forward);
    const regimes = [...new Set(dateRows.map((r) => r.regime).filter(Boolean))];
    const tagged = regimes.length === 1 ? { regime: regimes[0] } : {};
    return ic === null ? [] : [{ date, nAssets: dateRows.length, ic, trail, forward, ...tagged }];
  });
}

function autocorr1(values) {
  if (values.length < 3) return 0;
  const a = values.slice(0, -1);
  const b = values.slice(1);
  return pearson(a, b) || 0;
}

export function effectiveN(values) {
  if (!values.length) return 0;
  const rho = Math.max(-0.99, Math.min(0.99, autocorr1(values)));
  return Math.max(1, Math.min(values.length, values.length * (1 - rho) / (1 + rho)));
}

export function dateVectorPermutationP(datePanels, { iterations = 1000, seed = 20260304 } = {}) {
  if (!datePanels.length) return null;
  const observed = mean(datePanels.map((p) => p.ic));
  const random = seeded(seed);
  let extreme = 0;
  for (let n = 0; n < iterations; n++) {
    const order = shuffled(datePanels.length, random);
    const statistic = mean(datePanels.map((panel, i) => {
      const forward = datePanels[order[i]].forward;
      const width = Math.min(panel.trail.length, forward.length);
      return spearman(panel.trail.slice(0, width), forward.slice(0, width));
    }).filter((x) => x !== null));
    if (Math.abs(statistic) >= Math.abs(observed)) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

export function scoreMomentumPanelRows(rows, {
  minAssets = 8,
  permutations = 1000,
  bootstrapIterations = 1000,
  blockSize = 4,
  seed = 20260304
} = {}) {
  const datePanels = perDateIC(rows, { minAssets });
  const values = datePanels.map((p) => p.ic);
  return {
    nDates: datePanels.length,
    nRows: rows.length,
    effectiveN: effectiveN(values),
    meanIC: values.length ? mean(values) : null,
    ci95: blockBootstrapCI(values, { iterations: bootstrapIterations, blockSize, seed: seed + 1 }),
    p: dateVectorPermutationP(datePanels, { iterations: permutations, seed }),
    regimes: Object.fromEntries(["bull", "bear", "flat", "unknown"].map((regimeName) => {
      const regimeValues = datePanels.filter((p) => (p.regime || "unknown") === regimeName).map((p) => p.ic);
      return [regimeName, { n: regimeValues.length, meanIC: regimeValues.length ? mean(regimeValues) : null }];
    })),
    perDate: datePanels.map(({ date, nAssets, ic }) => ({ date, nAssets, ic }))
  };
}

function splitRecentRows(rows, holdoutDates = 4) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const held = new Set(dates.slice(Math.max(0, dates.length - holdoutDates)));
  return {
    train: rows.filter((r) => !held.has(r.date)),
    recentHoldout: rows.filter((r) => held.has(r.date)),
    recentHoldoutDates: [...held]
  };
}

function scoreRegimeSlices(rows, scoreOptions) {
  const out = { all: scoreMomentumPanelRows(rows, scoreOptions) };
  for (const regimeName of ["bull", "bear", "flat"]) {
    out[regimeName] = scoreMomentumPanelRows(rows.filter((r) => r.regime === regimeName), scoreOptions);
  }
  return out;
}

export function applySizeLiquidityControl(universe, controls = {}, {
  minDollarVolume = 0,
  excludeLargestN = 0
} = {}) {
  const largest = new Set([...universe]
    .map((asset) => ({ asset, size: controls[asset]?.size || 0 }))
    .sort((a, b) => b.size - a.size)
    .slice(0, excludeLargestN)
    .map((x) => x.asset));
  const kept = [];
  const excluded = [];
  for (const asset of universe) {
    const reason = largest.has(asset)
      ? "largest"
      : (controls[asset]?.dollarVolume || 0) < minDollarVolume ? "illiquid" : null;
    if (reason) excluded.push({ asset, reason });
    else kept.push(asset);
  }
  return { universe: kept, excluded, minDollarVolume, excludeLargestN };
}

export function runSealedMomentumPanelStudy(series, {
  primaryUniverse = STABLE_13,
  symbolHoldoutUniverse = null,
  primaryTransform = "btcResidual90",
  lookbacks = [14, 30, 60, 90],
  horizons = [7, 14, 30],
  transforms = ["raw", "btcResidual90", "volNormalized"],
  rankModes = ["return"],
  liquidityControls = null,
  liquidityControl = {},
  roundTripCost = 0.009,
  minAssets = 8,
  recentHoldoutDates = 4,
  permutations = 1000,
  bootstrapIterations = 1000,
  seed = 20260305
} = {}) {
  const scoreOptions = { minAssets, permutations, bootstrapIterations, seed };
  const control = liquidityControls
    ? applySizeLiquidityControl(primaryUniverse, liquidityControls, liquidityControl)
    : { universe: [...primaryUniverse], excluded: [], minDollarVolume: 0, excludeLargestN: 0 };
  const controlledUniverse = control.universe;
  const available = [...series.keys()];
  const holdoutUniverse = symbolHoldoutUniverse || available.filter((asset) => !primaryUniverse.includes(asset));

  const buildPrimaryCell = (transform) => {
    const panel = buildMomentumPanel(series, { universe: controlledUniverse, minAssets, tagRegime: true, transform });
    const split = splitRecentRows(panel.rows, recentHoldoutDates);
    const symbolHoldoutRows = holdoutUniverse.length >= minAssets
      ? buildMomentumPanel(series, { universe: holdoutUniverse, minAssets, tagRegime: true, transform }).rows
      : [];
    return {
      split,
      cell: {
        train: scoreMomentumPanelRows(split.train, scoreOptions),
        recentHoldout: scoreMomentumPanelRows(split.recentHoldout, scoreOptions),
        symbolHoldout: scoreMomentumPanelRows(symbolHoldoutRows, scoreOptions),
        q1Only: scoreMomentumPanelRows(panel.q1Only, scoreOptions)
      }
    };
  };

  const primaryResult = buildPrimaryCell(primaryTransform);
  const rawResult = buildPrimaryCell("raw");
  const exploratory = [];
  const byRank = {};

  for (const rank of rankModes) {
    const ranked = buildMomentumPanel(series, {
      universe: controlledUniverse,
      minAssets,
      rank,
      tagRegime: true,
      entryDelay: 1,
      includeForwardRiskAdjusted: true
    });
    const rankedSplit = splitRecentRows(ranked.rows, recentHoldoutDates);
    byRank[rank] = {
      raw: scoreMomentumPanelRows(rankedSplit.train, scoreOptions),
      riskAdjusted: scoreMomentumPanelRows(
        rankedSplit.train.filter((r) => Number.isFinite(r.fwdRiskAdjR)).map((r) => ({ ...r, fwdR: r.fwdRiskAdjR })),
        scoreOptions
      ),
      economics: economicMomentumViews(rankedSplit.train, { minAssets, roundTripCost }),
      recentHoldout: scoreMomentumPanelRows(rankedSplit.recentHoldout, scoreOptions)
    };
  }

  for (const lookback of lookbacks) for (const horizon of horizons) for (const transform of transforms) for (const rank of rankModes) {
    const rows = buildMomentumPanel(series, {
      universe: controlledUniverse,
      lookback,
      horizon,
      step: horizon,
      minAssets,
      transform,
      rank,
      tagRegime: true
    }).rows;
    const trainRows = splitRecentRows(rows, recentHoldoutDates).train;
    const slices = scoreRegimeSlices(trainRows, scoreOptions);
    for (const [regimeName, scoreRow] of Object.entries(slices)) {
      exploratory.push({ lookback, horizon, transform, rank, regime: regimeName, ...scoreRow });
    }
  }

  for (const row of exploratory) row.q = null;
  const fdrRows = exploratory.map((row) => ({ row, p: row.p ?? 1 }));
  bhFdr(fdrRows);
  for (const entry of fdrRows) entry.row.q = entry.q;
  return {
    primaryUniverse: [...primaryUniverse],
    controlledUniverse: [...controlledUniverse],
    liquidityControl: control,
    symbolHoldoutUniverse: [...holdoutUniverse],
    primaryTransform,
    primary: primaryResult.cell,
    primaryRaw: rawResult.cell,
    byRank,
    holdoutDates: primaryResult.split.recentHoldoutDates,
    exploratory
  };
}

export function btcRegimeMap(btcCandles, { maWindow = 200, band = 0.01 } = {}) {
  const out = new Map();
  for (let i = 0; i < btcCandles.length; i++) {
    const date = dateOf(btcCandles[i].time);
    if (i + 1 < maWindow) {
      out.set(date, "unknown");
      continue;
    }
    const ma = mean(btcCandles.slice(i - maWindow + 1, i + 1).map((x) => x.close));
    out.set(date, btcCandles[i].close > ma * (1 + band) ? "bull" : btcCandles[i].close < ma * (1 - band) ? "bear" : "flat");
  }
  return out;
}

export function tagMomentumRegimes(rows, btcCandles, options = {}) {
  const regimes = btcRegimeMap(btcCandles, options);
  return rows.map((row) => ({ ...row, regime: regimes.get(row.date) || "unknown" }));
}

export function buildMomentumPanel(series, {
  universe = STABLE_13,
  lookback = 30,
  horizon = 7,
  entryDelay = 0,
  step = 7,
  minAssets = 8,
  transform = "raw",
  rank = "return",
  factorAsset = "BTC",
  residualWindow = 90,
  volWindow = lookback,
  tagRegime = false,
  includeForwardRiskAdjusted = false,
  q1Start = Q1_ONLY_START,
  q1End = Q1_ONLY_END
} = {}) {
  const names = [...universe];
  if (names.length < minAssets) return { rows: [], q1Only: [] };
  const maps = new Map(names.map((asset) => [asset, closeByDate(series.get(asset) || [])]));
  const indexed = new Map(names.map((asset) => [asset, rowByDate(series.get(asset) || [])]));
  const factorRows = series.get(factorAsset) || [];
  const factorIndex = rowByDate(factorRows);
  const calendarSource = names.map((asset) => series.get(asset) || []).reduce((best, xs) => xs.length > best.length ? xs : best, []);
  const rows = [];
  const q1Only = [];

  if (entryDelay >= horizon) throw new Error("entryDelay must be smaller than horizon");
  for (let i = lookback; i + horizon < calendarSource.length; i += step) {
    const date = dateOf(calendarSource[i].time);
    const trailingDate = dateOf(calendarSource[i - lookback].time);
    const entryDate = dateOf(calendarSource[i + entryDelay].time);
    const forwardDate = dateOf(calendarSource[i + horizon].time);
    const bucket = [];

    for (const asset of names) {
      const closes = maps.get(asset);
      const trailing = closes.get(trailingDate);
      const current = closes.get(date);
      const entry = closes.get(entryDate);
      const forward = closes.get(forwardDate);
      if (![trailing, current, entry, forward].every((x) => Number.isFinite(x) && x > 0)) continue;
      const assetIndex = indexed.get(asset).get(date)?.i;
      const factorAtDate = factorIndex.get(date);
      const factorAtTrailing = factorIndex.get(trailingDate);
      let trailR = current / trailing - 1;
      if (transform === "btcResidual90") {
        if (assetIndex < residualWindow || !factorAtDate || factorAtDate.i < residualWindow || !factorAtTrailing) continue;
        const beta = betaAt(series.get(asset), factorRows, assetIndex, residualWindow);
        if (beta === null) continue;
        trailR -= beta * (factorAtDate.close / factorAtTrailing.close - 1);
      } else if (transform === "volNormalized") {
        if (assetIndex < volWindow) continue;
        const assetRows = series.get(asset);
        const returns = [];
        for (let j = assetIndex - volWindow + 1; j <= assetIndex; j++) returns.push(assetRows[j].close / assetRows[j - 1].close - 1);
        const vol = stdev(returns);
        if (!vol) continue;
        trailR /= vol;
      } else if (transform !== "raw") {
        throw new Error(`unknown momentum transform: ${transform}`);
      }
      if (rank === "negVol") {
        if (assetIndex < volWindow) continue;
        const assetRows = series.get(asset);
        const returns = [];
        for (let j = assetIndex - volWindow + 1; j <= assetIndex; j++) returns.push(assetRows[j].close / assetRows[j - 1].close - 1);
        const vol = stdev(returns);
        if (!vol) continue;
        trailR = -vol;
      } else if (rank === "negBeta") {
        if (assetIndex < residualWindow || !factorAtDate || factorAtDate.i < residualWindow) continue;
        const beta = betaAt(series.get(asset), factorRows, assetIndex, residualWindow);
        if (beta === null) continue;
        trailR = -beta;
      } else if (rank !== "return") {
        throw new Error(`unknown momentum rank variable: ${rank}`);
      }
      const fwdR = forward / entry - 1;
      const row = { date, asset, trailR, fwdR };
      if (includeForwardRiskAdjusted) {
        const assetRows = series.get(asset);
        const entryIndex = assetIndex + entryDelay;
        const exitIndex = assetIndex + horizon;
        const forwardReturns = [];
        for (let j = entryIndex + 1; j <= exitIndex; j++) forwardReturns.push(assetRows[j].close / assetRows[j - 1].close - 1);
        const fwdVol = stdev(forwardReturns);
        row.fwdRawR = fwdR;
        row.fwdRiskAdjR = Number.isFinite(fwdVol) && fwdVol > 0 ? fwdR / fwdVol : null;
      }
      bucket.push(row);
    }

    if (bucket.length < minAssets) continue;
    const taggedBucket = tagRegime ? tagMomentumRegimes(bucket, factorRows) : bucket;
    if (inDateWindow(date, q1Start, q1End)) q1Only.push(...taggedBucket);
    else rows.push(...taggedBucket);
  }

  return { rows, q1Only };
}

export function forwardViewsByRank(series, {
  rankModes = ["return", "negVol", "negBeta"],
  scoreOptions = {},
  panelOptions = {}
} = {}) {
  return Object.fromEntries(rankModes.map((rankMode) => {
    const { rows, q1Only } = buildMomentumPanel(series, {
      ...panelOptions,
      rank: rankMode,
      includeForwardRiskAdjusted: true
    });
    const riskRows = rows.filter((r) => Number.isFinite(r.fwdRiskAdjR)).map((r) => ({ ...r, fwdR: r.fwdRiskAdjR }));
    return [rankMode, {
      raw: scoreMomentumPanelRows(rows, scoreOptions),
      riskAdjusted: scoreMomentumPanelRows(riskRows, scoreOptions),
      q1OnlyRows: q1Only.length
    }];
  }));
}

function selectedTurnover(selected, previous) {
  if (!selected.length) return 0;
  if (!previous) return 1;
  return 1 - selected.filter((asset) => previous.has(asset)).length / selected.length;
}

function averageSelection(rows, count) {
  return mean(rows.slice(0, Math.min(count, rows.length)).map((r) => r.fwdR));
}

export function economicMomentumViews(rows, { minAssets = 8, roundTripCost = 0.009, topNs = [3, 5] } = {}) {
  const dates = byDateRows(rows).filter((p) => p.rows.length >= minAssets);
  let priorTop = null;
  let priorBottom = null;
  const tercile = [];
  const topViews = new Map(topNs.map((n) => [n, { gross: [], net: [], turnover: 0, prior: null }]));

  for (const panel of dates) {
    const ranked = [...panel.rows].sort((a, b) => b.trailR - a.trailR);
    const tercileN = Math.max(1, Math.floor(ranked.length / 3));
    const top = ranked.slice(0, tercileN);
    const bottom = ranked.slice(-tercileN);
    const topAssets = top.map((r) => r.asset);
    const bottomAssets = bottom.map((r) => r.asset);
    const topTurnover = selectedTurnover(topAssets, priorTop);
    const bottomTurnover = selectedTurnover(bottomAssets, priorBottom);
    const grossSpread = mean(top.map((r) => r.fwdR)) - mean(bottom.map((r) => r.fwdR));
    tercile.push({ date: panel.date, turnover: (topTurnover + bottomTurnover) / 2, grossSpread, netSpread: grossSpread - roundTripCost * (topTurnover + bottomTurnover) });
    priorTop = new Set(topAssets);
    priorBottom = new Set(bottomAssets);

    for (const [n, view] of topViews) {
      const selected = ranked.slice(0, Math.min(n, ranked.length));
      const assets = selected.map((r) => r.asset);
      const turnover = selectedTurnover(assets, view.prior);
      const gross = averageSelection(ranked, n);
      view.gross.push(gross);
      view.net.push(gross - roundTripCost * turnover);
      view.turnover += turnover;
      view.prior = new Set(assets);
    }
  }

  return {
    observations: dates.length,
    roundTripCost,
    tercile: {
      avgTurnover: mean(tercile.map((r) => r.turnover)),
      grossSpread: mean(tercile.map((r) => r.grossSpread)),
      netSpread: mean(tercile.map((r) => r.netSpread))
    },
    topN: Object.fromEntries([...topViews].map(([n, view]) => [n, {
      avgTurnover: dates.length ? view.turnover / dates.length : 0,
      grossReturn: mean(view.gross),
      netReturn: mean(view.net)
    }]))
  };
}

function dailySeries(watchlist) {
  return new Map(watchlist.map(({ symbol, id }) => [symbol, loadDailyCandles(id)]));
}
function byTime(series) { return new Map(series.map((x, i) => [x.time, { ...x, i }])); }
function betaAt(asset, btc, index, window = 90) {
  if (index < window) return null;
  const ar = [], br = [];
  for (let i = index - window + 1; i <= index; i++) { ar.push(logReturn(asset[i - 1].close, asset[i].close)); br.push(logReturn(btc[i - 1].close, btc[i].close)); }
  const assetMean = mean(ar), btcMean = mean(br);
  let covariance = 0, variance = 0;
  for (let i = 0; i < window; i++) { covariance += (ar[i] - assetMean) * (br[i] - btcMean); variance += (br[i] - btcMean) ** 2; }
  return variance ? covariance / variance : null;
}
function signalAndForward(asset, btc, index, lookback, horizon, transform) {
  if (index < lookback || index + horizon >= asset.length) return null;
  const rawSignal = logReturn(asset[index - lookback].close, asset[index].close);
  const rawForward = logReturn(asset[index].close, asset[index + horizon].close);
  if (transform === "raw") return [rawSignal, rawForward];
  const returns = Array.from({ length: lookback }, (_, j) => logReturn(asset[index - lookback + j].close, asset[index - lookback + j + 1].close));
  if (transform === "vol") { const vol = stdev(returns); return vol ? [rawSignal / vol, rawForward] : null; }
  const beta = betaAt(asset, btc, index); if (beta === null) return null;
  return [rawSignal - beta * logReturn(btc[index - lookback].close, btc[index].close), rawForward - beta * logReturn(btc[index].close, btc[index + horizon].close)];
}
function regime(btc, index) {
  if (index < 199) return "unknown";
  const ma = mean(btc.slice(index - 199, index + 1).map((x) => x.close));
  return btc[index].close > ma * 1.01 ? "bull" : btc[index].close < ma * .99 ? "bear" : "flat";
}

export function momentumPanels(series, { lookback = 30, horizon = 7, transform = "residual", symbols = null } = {}) {
  const btc = series.get("BTC"); if (!btc) throw new Error("BTC daily history is required as the market factor");
  const names = (symbols || [...series.keys()]).filter((s) => s !== "BTC");
  if (names.length < 8) return [];
  const lookup = new Map(names.map((name) => [name, byTime(series.get(name) || [])]));
  const panels = [];
  for (let i = lookback + 90; i + horizon < btc.length; i += horizon) {
    const signal = [], forward = [], assets = [];
    for (const name of names) {
      const mapped = lookup.get(name).get(btc[i].time); if (!mapped) continue;
      const values = signalAndForward(series.get(name), btc, mapped.i, lookback, horizon, transform);
      if (values && values.every(Number.isFinite)) { signal.push(values[0]); forward.push(values[1]); assets.push(name); }
    }
    if (assets.length >= 8) {
      const executionForward = assets.map((asset) => {
        const mapped = lookup.get(asset).get(btc[i].time);
        const assetRows = series.get(asset);
        const entry = assetRows[mapped.i + 1]?.close;
        const exit = assetRows[mapped.i + horizon + 1]?.close;
        return Number.isFinite(entry) && entry > 0 && Number.isFinite(exit) && exit > 0 ? exit / entry - 1 : null;
      });
      const ic = spearman(signal, forward);
      if (ic !== null && executionForward.every(Number.isFinite)) panels.push({ time: btc[i].time, assets, signal, forward, executionForward, ic, regime: regime(btc, i) });
    }
  }
  return panels;
}
function score(panels, permutations = 1000) {
  if (!panels.length) return { n: 0, meanIC: null, ci95: [null, null], p: null, regimes: {} };
  const values = panels.map((p) => p.ic);
  return { n: panels.length, meanIC: mean(values), ci95: bootstrapCI(values), p: permutationP(panels, permutations), regimes: Object.fromEntries(["bull", "bear", "flat", "unknown"].map((r) => { const v = panels.filter((p) => p.regime === r).map((p) => p.ic); return [r, { n: v.length, meanIC: mean(v) }]; })) };
}
export function economicViews(panels, { roundTripCost = .009, topNs = [3, 5] } = {}) {
  const views = new Map([[
    "tercile", Math.max(1, Math.ceil((panels[0]?.assets.length || 0) / 3))
  ], ...topNs.map((n) => [`top${n}`, n])]);
  const output = {};
  for (const [name, requestedN] of views) {
    let previous = new Set();
    const gross = [], net = [], turnovers = [];
    for (const panel of panels) {
      const selected = panel.assets
        .map((asset, i) => ({ asset, i }))
        .sort((a, b) => panel.signal[b.i] - panel.signal[a.i])
        .slice(0, Math.min(requestedN, panel.assets.length));
      const current = new Set(selected.map((row) => row.asset));
      const turnover = previous.size ? 1 - [...current].filter((asset) => previous.has(asset)).length / current.size : 1;
      const returns = panel.executionForward || panel.forward;
      const baseline = mean(returns);
      const spread = mean(selected.map((row) => returns[row.i])) - baseline;
      gross.push(spread);
      net.push(spread - roundTripCost * turnover);
      turnovers.push(turnover);
      previous = current;
    }
    output[name] = {
      observations: panels.length,
      avgTurnover: turnovers.length ? mean(turnovers) : 0,
      grossSpread: gross.length ? mean(gross) : null,
      netSpread: net.length ? mean(net) : null,
      roundTripCost
    };
  }
  return output;
}

function harvest(panels, cost = .009) {
  const views = economicViews(panels, { roundTripCost: cost });
  return { ...views.tercile, grossTopTercile: views.tercile.grossSpread, netTopTercile: views.tercile.netSpread, views };
}

export function runMomentumStudy({ watchlist = loadWatchlist(), permutations = 1000 } = {}) {
  watchlist = watchlist.map((asset) => typeof asset === "string" ? { symbol: asset, id: symbolToKrakenId(asset) } : asset);
  const series = dailySeries(watchlist); const symbols = [...series.keys()].sort();
  const split = splitPrimarySymbols(series);
  const trainSymbols = split.train;
  const heldSymbols = split.holdout;
  const primary = momentumPanels(series, { transform: "residual", symbols: trainSymbols });
  const timeSplit = splitMomentumPanels(primary);
  const train = timeSplit.train;
  const timeHoldout = timeSplit.recentHoldout;
  const symbolHoldout = momentumPanels(series, { transform: "residual", symbols: heldSymbols });
  const grid = [];
  const family = [];
  for (const lookback of [14, 30, 60, 90]) for (const horizon of [7, 14, 30]) for (const transform of ["raw", "residual", "vol"]) {
    const panels = momentumPanels(series, { lookback, horizon, transform, symbols: trainSymbols }).filter((p) => p.time < timeSplit.cutoff);
    const result = score(panels, permutations);
    const row = { lookback, horizon, transform, ...result };
    grid.push(row);
    family.push({ key: `grid:${lookback}:${horizon}:${transform}`, p: result.p ?? 1 });
    for (const regimeName of ["bull", "bear", "flat"]) {
      const regimePanels = panels.filter((panel) => panel.regime === regimeName);
      family.push({ key: `regime:${lookback}:${horizon}:${transform}:${regimeName}`, p: score(regimePanels, permutations).p ?? 1 });
    }
  }
  bhFdr(family);
  const qByKey = new Map(family.map((row) => [row.key, row.q]));
  for (const row of grid) row.q = qByKey.get(`grid:${row.lookback}:${row.horizon}:${row.transform}`);
  const input = { specification: "MOMENTUM_SPEC/v1", symbols, primarySymbols: split.primary, trainSymbols, heldSymbols, recentHoldoutDays: RECENT_HOLDOUT_DAYS, timeHoldoutFrom: Number.isFinite(timeSplit.cutoff) ? new Date(timeSplit.cutoff * 1000).toISOString().slice(0, 10) : null, permutations };
  const result = { manifest: dataManifest(watchlist), primary: { train: score(train, permutations), timeHoldout: score(timeHoldout, permutations), symbolHoldout: score(symbolHoldout, permutations), harvest: harvest(train) }, exploratory: grid, exploratoryFdrFamily: family };
  return { input, result };
}

const main = process.argv[1]?.endsWith("momentum.mjs");
if (main) {
  const study = runMomentumStudy({ permutations: Number(process.env.PERMUTATIONS) || 1000 });
  const file = saveExperiment("momentum", study.input, study.result);
  console.log(JSON.stringify({ ...study.result.primary, saved: file }, null, 2));
}
