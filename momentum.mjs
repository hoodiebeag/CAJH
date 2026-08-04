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
    return ic === null ? [] : [{ date, nAssets: dateRows.length, ic, trail, forward }];
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
    perDate: datePanels.map(({ date, nAssets, ic }) => ({ date, nAssets, ic }))
  };
}

export function buildMomentumPanel(series, {
  universe = STABLE_13,
  lookback = 30,
  horizon = 7,
  step = 7,
  minAssets = 8,
  transform = "raw",
  factorAsset = "BTC",
  residualWindow = 90,
  volWindow = lookback,
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

  for (let i = lookback; i + horizon < calendarSource.length; i += step) {
    const date = dateOf(calendarSource[i].time);
    const trailingDate = dateOf(calendarSource[i - lookback].time);
    const forwardDate = dateOf(calendarSource[i + horizon].time);
    const bucket = [];

    for (const asset of names) {
      const closes = maps.get(asset);
      const trailing = closes.get(trailingDate);
      const current = closes.get(date);
      const forward = closes.get(forwardDate);
      if (![trailing, current, forward].every((x) => Number.isFinite(x) && x > 0)) continue;
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
      bucket.push({ date, asset, trailR, fwdR: forward / current - 1 });
    }

    if (bucket.length < minAssets) continue;
    if (inDateWindow(date, q1Start, q1End)) q1Only.push(...bucket);
    else rows.push(...bucket);
  }

  return { rows, q1Only };
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
    if (assets.length >= 8) { const ic = spearman(signal, forward); if (ic !== null) panels.push({ time: btc[i].time, assets, signal, forward, ic, regime: regime(btc, i) }); }
  }
  return panels;
}
function score(panels, permutations = 1000) {
  if (!panels.length) return { n: 0, meanIC: null, ci95: [null, null], p: null, regimes: {} };
  const values = panels.map((p) => p.ic);
  return { n: panels.length, meanIC: mean(values), ci95: bootstrapCI(values), p: permutationP(panels, permutations), regimes: Object.fromEntries(["bull", "bear", "flat", "unknown"].map((r) => { const v = panels.filter((p) => p.regime === r).map((p) => p.ic); return [r, { n: v.length, meanIC: mean(v) }]; })) };
}
function harvest(panels, cost = .009) {
  let turnover = 0, gross = [], net = [], previous = new Set();
  for (const panel of panels) {
    const topN = Math.max(1, Math.floor(panel.assets.length / 3));
    const top = panel.assets.map((asset, i) => ({ asset, i })).sort((a, b) => panel.signal[b.i] - panel.signal[a.i]).slice(0, topN);
    const selected = new Set(top.map((x) => x.asset));
    const changed = 1 - [...selected].filter((x) => previous.has(x)).length / topN;
    turnover += changed; const topReturn = mean(top.map((x) => panel.forward[x.i]));
    gross.push(topReturn); net.push(topReturn - cost * changed); previous = selected;
  }
  return { observations: panels.length, avgTurnover: panels.length ? turnover / panels.length : 0, grossTopTercile: mean(gross), netTopTercile: mean(net), roundTripCost: cost };
}

export function runMomentumStudy({ watchlist = loadWatchlist(), permutations = 1000 } = {}) {
  watchlist = watchlist.map((asset) => typeof asset === "string" ? { symbol: asset, id: symbolToKrakenId(asset) } : asset);
  const series = dailySeries(watchlist); const symbols = [...series.keys()].sort();
  // Whole-symbol holdout needs at least the same eight assets required for an IC. Select
  // the first eight full-span symbols alphabetically, before any result is inspected.
  const eligible = symbols.filter((s) => s !== "BTC" && (series.get(s)?.length || 0) >= 1100);
  const heldSymbols = eligible.slice(0, 8); const trainSymbols = symbols.filter((s) => !heldSymbols.includes(s));
  const primary = momentumPanels(series, { transform: "residual", symbols: trainSymbols });
  const cutoff = primary.length ? primary[Math.max(0, primary.length - 52)].time : Infinity;
  const train = primary.filter((p) => p.time < cutoff); const timeHoldout = primary.filter((p) => p.time >= cutoff);
  const symbolHoldout = momentumPanels(series, { transform: "residual", symbols: heldSymbols });
  const grid = [];
  for (const lookback of [14, 30, 60, 90]) for (const horizon of [7, 14, 30]) for (const transform of ["raw", "residual", "vol"]) {
    const panels = momentumPanels(series, { lookback, horizon, transform, symbols: trainSymbols }).filter((p) => p.time < cutoff);
    const result = score(panels, permutations); grid.push({ lookback, horizon, transform, ...result });
  }
  bhFdr(grid);
  const input = { specification: "MOMENTUM_SPEC/v1", symbols, heldSymbols, timeHoldoutFrom: Number.isFinite(cutoff) ? new Date(cutoff * 1000).toISOString().slice(0, 10) : null, permutations };
  const result = { manifest: dataManifest(watchlist), primary: { train: score(train, permutations), timeHoldout: score(timeHoldout, permutations), symbolHoldout: score(symbolHoldout, permutations), harvest: harvest(train) }, exploratory: grid };
  return { input, result };
}

const main = process.argv[1]?.endsWith("momentum.mjs");
if (main) {
  const study = runMomentumStudy({ permutations: Number(process.env.PERMUTATIONS) || 1000 });
  const file = saveExperiment("momentum", study.input, study.result);
  console.log(JSON.stringify({ ...study.result.primary, saved: file }, null, 2));
}
