import test from "node:test";
import assert from "node:assert/strict";
import {
  blockBootstrapCI,
  bhFdr,
  buildMomentumPanel,
  dateVectorPermutationP,
  economicMomentumViews,
  effectiveN,
  forwardViewsByRank,
  economicViews,
  perDateIC,
  ranks,
  runSealedMomentumPanelStudy,
  scoreMomentumPanelRows,
  spearman,
  tagMomentumRegimes,
  splitMomentumPanels,
  splitPrimarySymbols,
  permutationP,
  bootstrapCI
} from "./momentum.mjs";

const STABLE_13_FIXTURE = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "BCH", "ATOM", "XLM"];

const day = 86400;
const candle = (offset, close) => ({ time: Date.UTC(2025, 0, 1) / 1000 + offset * day, open: close, high: close, low: close, close, volume: 1 });
const linearSeries = (days, start, slope = 1) => Array.from({ length: days }, (_, i) => candle(i, start + i * slope));

test("buildMomentumPanel emits tidy weekly L=30/H=7 rows with strictly future returns", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const series = new Map(assets.map((asset, i) => [asset, linearSeries(45, 100 + i * 10, 1)]));
  const { rows, q1Only } = buildMomentumPanel(series, { universe: assets });

  assert.equal(q1Only.length, 0);
  assert.equal(rows.length, 16);
  assert.deepEqual([...new Set(rows.map((r) => r.date))], ["2025-01-31", "2025-02-07"]);
  assert.deepEqual(Object.keys(rows[0]), ["date", "asset", "trailR", "fwdR"]);
  assert.deepEqual(rows[0], {
    date: "2025-01-31",
    asset: "BTC",
    trailR: 130 / 100 - 1,
    fwdR: 137 / 130 - 1
  });
});

test("buildMomentumPanel requires eight valid assets on a date", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const series = new Map(assets.map((asset, i) => [asset, linearSeries(45, 100 + i * 10, 1)]));
  series.set("LINK", linearSeries(37, 170, 1));

  const { rows } = buildMomentumPanel(series, { universe: assets });

  assert.equal(rows.length, 0);
});

test("buildMomentumPanel separates Q1-only rows from reusable research rows", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const q1Start = Date.UTC(2026, 0, 1) / 1000;
  const series = new Map(assets.map((asset, i) => [
    asset,
    Array.from({ length: 45 }, (_, d) => ({ ...candle(d, 200 + i * 10 + d), time: q1Start + d * day }))
  ]));

  const { rows, q1Only } = buildMomentumPanel(series, { universe: assets });

  assert.equal(rows.length, 0);
  assert.equal(q1Only.length, 16);
  assert.deepEqual([...new Set(q1Only.map((r) => r.date))], ["2026-01-31", "2026-02-07"]);
});

test("perDateIC computes one Spearman IC per rebalance date", () => {
  const rows = [
    { date: "2025-01-01", asset: "A", trailR: 1, fwdR: 10 },
    { date: "2025-01-01", asset: "B", trailR: 2, fwdR: 20 },
    { date: "2025-01-01", asset: "C", trailR: 3, fwdR: 30 },
    { date: "2025-01-02", asset: "A", trailR: 1, fwdR: 30 },
    { date: "2025-01-02", asset: "B", trailR: 2, fwdR: 20 },
    { date: "2025-01-02", asset: "C", trailR: 3, fwdR: 10 }
  ];

  assert.deepEqual(perDateIC(rows, { minAssets: 3 }).map(({ date, nAssets, ic }) => ({ date, nAssets, ic })), [
    { date: "2025-01-01", nAssets: 3, ic: 1 },
    { date: "2025-01-02", nAssets: 3, ic: -1 }
  ]);
});

test("scoreMomentumPanelRows reports mean IC, effective N, block CI, and deterministic date-vector null", () => {
  const rows = [];
  for (const [date, forward] of [
    ["2025-01-01", [1, 2, 3, 4]],
    ["2025-01-08", [4, 3, 2, 1]],
    ["2025-01-15", [1, 3, 2, 4]]
  ]) {
    for (let i = 0; i < 4; i++) rows.push({ date, asset: `A${i}`, trailR: i + 1, fwdR: forward[i] });
  }

  const score = scoreMomentumPanelRows(rows, { minAssets: 4, permutations: 20, bootstrapIterations: 20, blockSize: 2, seed: 7 });

  assert.equal(score.nDates, 3);
  assert.equal(score.nRows, 12);
  assert.equal(score.meanIC, (1 - 1 + 0.8) / 3);
  assert.equal(score.effectiveN, effectiveN([1, -1, 0.8]));
  assert.deepEqual(score.ci95, blockBootstrapCI([1, -1, 0.8], { iterations: 20, blockSize: 2, seed: 8 }));
  assert.equal(score.p, dateVectorPermutationP(perDateIC(rows, { minAssets: 4 }), { iterations: 20, seed: 7 }));
  assert.deepEqual(score.perDate.map((p) => p.ic), [1, -1, 0.8]);
});

test("buildMomentumPanel btcResidual90 uses only trailing factor data through the decision date", () => {
  const btc = Array.from({ length: 110 }, (_, i) => {
    const close = 100 + i + (i % 5);
    return candle(i, close);
  });
  const eth = btc.map((c) => ({ ...c, close: (c.close ** 2) / 100 }));
  const series = new Map([["BTC", btc], ["ETH", eth]]);

  const { rows } = buildMomentumPanel(series, {
    universe: ["BTC", "ETH"],
    lookback: 30,
    horizon: 7,
    step: 7,
    minAssets: 2,
    transform: "btcResidual90"
  });

  const ethRow = rows.find((r) => r.asset === "ETH");
  const btcTrail = btc[93].close / btc[63].close - 1;
  const ethTrail = eth[93].close / eth[63].close - 1;
  assert.equal(ethRow.date, "2025-04-04");
  assert.ok(Math.abs(ethRow.trailR - (ethTrail - 2 * btcTrail)) < 1e-12);
});

test("buildMomentumPanel volNormalized divides by trailing volatility known at the decision date", () => {
  const asset = [100, 110, 121, 145.2, 174.24].map((close, i) => candle(i, close));
  const { rows } = buildMomentumPanel(new Map([["BTC", asset]]), {
    universe: ["BTC"],
    lookback: 2,
    horizon: 1,
    step: 1,
    minAssets: 1,
    transform: "volNormalized",
    volWindow: 2
  });

  assert.equal(rows[0].date, "2025-01-04");
  assert.ok(Math.abs(rows[0].trailR - ((145.2 / 110 - 1) / 0.05)) < 1e-12);
  assert.equal(rows[0].fwdR, 174.24 / 145.2 - 1);
});

test("tagMomentumRegimes labels BTC-vs-200MA state without changing full-sample IC", () => {
  const rows = [
    { date: "2025-07-20", asset: "A", trailR: 1, fwdR: 3 },
    { date: "2025-07-20", asset: "B", trailR: 2, fwdR: 2 },
    { date: "2025-07-20", asset: "C", trailR: 3, fwdR: 1 },
    { date: "2025-07-27", asset: "A", trailR: 1, fwdR: 1 },
    { date: "2025-07-27", asset: "B", trailR: 2, fwdR: 2 },
    { date: "2025-07-27", asset: "C", trailR: 3, fwdR: 3 }
  ];
  const btc = Array.from({ length: 208 }, (_, i) => candle(i, i < 200 ? 100 : 130));

  const untagged = scoreMomentumPanelRows(rows, { minAssets: 3, permutations: 10, bootstrapIterations: 10 });
  const tagged = scoreMomentumPanelRows(tagMomentumRegimes(rows, btc), { minAssets: 3, permutations: 10, bootstrapIterations: 10 });

  assert.equal(untagged.meanIC, 0);
  assert.equal(tagged.meanIC, 0);
  assert.deepEqual(tagged.regimes.bull, { n: 2, meanIC: 0 });
  assert.deepEqual(tagged.regimes.bear, { n: 0, meanIC: null });
  assert.deepEqual(tagged.regimes.flat, { n: 0, meanIC: null });
});

test("runSealedMomentumPanelStudy keeps train, recent, symbol, Q1, and exploratory grid separate", () => {
  const primaryUniverse = ["BTC", "ETH", "SOL"];
  const symbolHoldoutUniverse = ["XRP", "ADA", "DOGE"];
  const all = [...primaryUniverse, ...symbolHoldoutUniverse];
  const series = new Map(all.map((asset, assetIndex) => [
    asset,
    Array.from({ length: 80 }, (_, i) => candle(i, 100 + assetIndex * 20 + i * (assetIndex + 1)))
  ]));

  const study = runSealedMomentumPanelStudy(series, {
    primaryUniverse,
    symbolHoldoutUniverse,
    lookbacks: [2],
    horizons: [1, 2],
    transforms: ["raw"],
    minAssets: 3,
    recentHoldoutDates: 2,
    permutations: 10,
    bootstrapIterations: 10,
    seed: 11
  });

  assert.deepEqual(study.primaryUniverse, primaryUniverse);
  assert.deepEqual(study.symbolHoldoutUniverse, symbolHoldoutUniverse);
  assert.equal(study.primary.recentHoldout.nDates, 2);
  assert.equal(study.primary.symbolHoldout.nDates > study.primary.recentHoldout.nDates, true);
  assert.equal(study.primary.q1Only.nDates, 0);
  assert.equal(study.primary.train.nDates > study.primary.recentHoldout.nDates, true);
  assert.equal(study.exploratory.length, 8);
  assert.equal(study.exploratory.every((row) => Object.hasOwn(row, "q")), true);
  assert.equal(study.exploratory.find((row) => row.horizon === 2 && row.regime === "all").nDates < study.exploratory.find((row) => row.horizon === 1 && row.regime === "all").nDates, true);
});

test("buildMomentumPanel can model entry at close t+1 for forward returns", () => {
  const asset = [100, 110, 121, 133.1, 146.41].map((close, i) => candle(i, close));
  const { rows } = buildMomentumPanel(new Map([["BTC", asset]]), {
    universe: ["BTC"],
    lookback: 2,
    horizon: 2,
    entryDelay: 1,
    minAssets: 1
  });

  assert.equal(rows[0].date, "2025-01-03");
  assert.equal(rows[0].trailR, 121 / 100 - 1);
  assert.equal(rows[0].fwdR, 146.41 / 133.1 - 1);
});

test("economicMomentumViews reports tercile/top-N gross, turnover, and explicit net costs", () => {
  const rows = [
    { date: "2025-01-01", asset: "A", trailR: 3, fwdR: 0.06 },
    { date: "2025-01-01", asset: "B", trailR: 2, fwdR: 0.03 },
    { date: "2025-01-01", asset: "C", trailR: 1, fwdR: -0.01 },
    { date: "2025-01-02", asset: "B", trailR: 3, fwdR: 0.04 },
    { date: "2025-01-02", asset: "A", trailR: 2, fwdR: 0.02 },
    { date: "2025-01-02", asset: "C", trailR: 1, fwdR: 0.00 }
  ];

  const views = economicMomentumViews(rows, { minAssets: 3, roundTripCost: 0.01, topNs: [1, 2] });

  assert.equal(views.observations, 2);
  assert.equal(views.tercile.grossSpread, ((0.06 - -0.01) + (0.04 - 0)) / 2);
  assert.equal(views.tercile.netSpread, (((0.06 - -0.01) - 0.02) + ((0.04 - 0) - 0.01)) / 2);
  assert.equal(views.topN["1"].avgTurnover, 1);
  assert.equal(views.topN["1"].grossReturn, 0.05);
  assert.ok(Math.abs(views.topN["1"].netReturn - 0.04) < 1e-12);
  assert.equal(views.topN["2"].avgTurnover, 0.5);
  assert.equal(views.topN["2"].grossReturn, ((0.06 + 0.03) / 2 + (0.04 + 0.02) / 2) / 2);
  assert.equal(views.topN["2"].netReturn, (((0.06 + 0.03) / 2 - 0.01) + ((0.04 + 0.02) / 2)) / 2);
});

test("B1 rank=return leaves momentum panel output unchanged", () => {
  const assets = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK"];
  const series = new Map(assets.map((asset, i) => [asset, linearSeries(45, 100 + i * 10, 1)]));

  assert.equal(
    JSON.stringify(buildMomentumPanel(series, { universe: assets })),
    JSON.stringify(buildMomentumPanel(series, { universe: assets, rank: "return" }))
  );
});

test("B1 rank=negVol uses negative trailing volatility as the identical trailR ranking slot", () => {
  const asset = [100, 110, 121, 145.2, 174.24].map((close, i) => candle(i, close));
  const { rows } = buildMomentumPanel(new Map([["BTC", asset]]), {
    universe: ["BTC"],
    lookback: 2,
    horizon: 1,
    step: 1,
    minAssets: 1,
    rank: "negVol",
    volWindow: 2
  });

  assert.equal(rows[0].date, "2025-01-04");
  assert.ok(Math.abs(rows[0].trailR - -0.05) < 1e-12);
});

test("B1 rank=negBeta uses negative rolling BTC beta as the identical trailR ranking slot", () => {
  const btc = Array.from({ length: 110 }, (_, i) => candle(i, 100 + i + (i % 5)));
  const eth = btc.map((c) => ({ ...c, close: (c.close ** 2) / 100 }));
  const { rows } = buildMomentumPanel(new Map([["BTC", btc], ["ETH", eth]]), {
    universe: ["BTC", "ETH"],
    lookback: 30,
    horizon: 7,
    step: 7,
    minAssets: 2,
    rank: "negBeta"
  });

  const ethRow = rows.find((r) => r.asset === "ETH");
  assert.equal(ethRow.date, "2025-04-04");
  assert.ok(Math.abs(ethRow.trailR - -2) < 1e-12);
});

test("B2 reports forward raw and risk-adjusted returns side by side when requested", () => {
  const asset = [100, 105, 110, 121, 145.2, 159.72].map((close, i) => candle(i, close));
  const { rows } = buildMomentumPanel(new Map([["BTC", asset]]), {
    universe: ["BTC"],
    lookback: 2,
    horizon: 3,
    entryDelay: 1,
    step: 1,
    minAssets: 1,
    includeForwardRiskAdjusted: true
  });

  const row = rows[0];
  const raw = 159.72 / 121 - 1;
  const vol = Math.sqrt(((0.2 - 0.15) ** 2 + (0.1 - 0.15) ** 2) / 2);
  assert.equal(row.fwdR, raw);
  assert.equal(row.fwdRawR, raw);
  assert.ok(Math.abs(row.fwdRiskAdjR - raw / vol) < 1e-12);
});

test("B2 forwardViewsByRank scores raw and risk-adjusted forward returns and guards zero volatility", () => {
  const assets = ["BTC", "ETH", "SOL"];
  const series = new Map(assets.map((asset, assetIndex) => [
    asset,
    [100, 101, 102, 104, 108, 116, 117, 118, 120, 124, 132, 133].map((close, i) => candle(i, close + assetIndex))
  ]));

  const views = forwardViewsByRank(series, {
    rankModes: ["return", "negVol"],
    scoreOptions: { minAssets: 3, permutations: 5, bootstrapIterations: 5 },
    panelOptions: { universe: assets, lookback: 2, horizon: 3, entryDelay: 1, step: 3, minAssets: 3, volWindow: 2 }
  });

  assert.deepEqual(Object.keys(views), ["return", "negVol"]);
  assert.equal(views.return.raw.nRows > 0, true);
  assert.equal(views.return.riskAdjusted.nRows > 0, true);
  assert.equal(views.negVol.raw.nRows > 0, true);

  const flat = new Map([["BTC", [100, 101, 102, 103, 104, 105].map((close, i) => candle(i, close))]]);
  const guarded = forwardViewsByRank(flat, {
    rankModes: ["return"],
    scoreOptions: { minAssets: 1, permutations: 5, bootstrapIterations: 5 },
    panelOptions: { universe: ["BTC"], lookback: 2, horizon: 2, entryDelay: 1, step: 1, minAssets: 1 }
  });
  assert.equal(guarded.return.raw.nRows > 0, true);
  assert.equal(guarded.return.riskAdjusted.nRows, 0);
});

test("rank correlation identifies a planted monotonic cross-section", () => {
  assert.deepEqual(ranks([3, 1, 1, 2]), [4, 1.5, 1.5, 3]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
});

test("permutation and bootstrap preserve an obvious positive IC", () => {
  const panels = Array.from({ length: 12 }, (_, n) => {
    const values = [1, 2, 3, 4].map((_, i) => (i + n) % 4);
    return { signal: values, forward: values, ic: 1 };
  });
  assert.ok(permutationP(panels, 200) < .05);
  const [lo, hi] = bootstrapCI(panels.map((p) => p.ic), 200);
  assert.equal(lo, 1); assert.equal(hi, 1);
});

test("M5 freezes symbol and recent-date holdouts before any score selection", () => {
  const series = new Map(STABLE_13_FIXTURE.map((symbol) => [symbol, []]));
  const symbols = splitPrimarySymbols(series);
  assert.deepEqual(symbols.holdout, ["ATOM", "DOT", "LTC"]);
  assert.equal(symbols.train.includes("ATOM"), false);

  const panels = [0, 100, 200, 300].map((time) => ({ time }));
  const split = splitMomentumPanels(panels, { recentDays: 150 / 86400 });
  assert.deepEqual(split.train.map((panel) => panel.time), [0, 100]);
  assert.deepEqual(split.recentHoldout.map((panel) => panel.time), [200, 300]);
});

test("M5 FDR q-values are assigned from one shared grid/regime family", () => {
  const rows = [{ p: 0.001 }, { p: 0.02 }, { p: 0.9 }];
  assert.deepEqual(bhFdr(rows).map((row) => row.q), [0.003, 0.03, 0.9]);
});

test("M6 economic views enter on the next close and charge turnover costs", () => {
  const panels = [
    { assets: ["A", "B", "C", "D", "E"], signal: [5, 4, 3, 2, 1], executionForward: [0.10, 0.02, 0.00, 0.00, 0.00] },
    { assets: ["B", "A", "C", "D", "E"], signal: [5, 4, 3, 2, 1], executionForward: [0.04, 0.08, 0.00, 0.00, 0.00] }
  ];
  const views = economicViews(panels, { roundTripCost: 0.01, topNs: [3, 5] });
  assert.equal(views.tercile.observations, 2);
  assert.equal(views.tercile.avgTurnover, 0.5);
  assert.equal(views.top3.grossSpread > 0, true);
  assert.equal(views.top3.netSpread, views.top3.grossSpread - 0.01 * views.top3.avgTurnover);
  assert.equal(views.top5.grossSpread, 0);
});
