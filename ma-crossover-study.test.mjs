import test from "node:test";
import assert from "node:assert/strict";
import {
  crossoverTrades,
  runMaCrossoverStudy,
  scoreAsset
} from "./ma-crossover-study.mjs";

const DAY = 86400;
const candle = (i, close) => ({ time: Date.UTC(2024, 0, 1) / 1000 + i * DAY, close });

function seriesWithCrossovers() {
  const closes = [];
  for (let i = 0; i < 200; i++) closes.push(i < 150 ? 100 : 90);
  for (let i = 200; i < 250; i++) closes.push(200); // trigger bar crosses up.
  closes.push(220);                                // t+1 entry fill.
  for (let i = 251; i < 450; i++) closes.push(220);
  for (let i = 450; i < 500; i++) closes.push(50); // trigger bar crosses down.
  closes.push(55);                                 // t+1 exit fill.
  return closes.map((close, i) => candle(i, close));
}

test("TF1 enters and exits at the next daily close, never the trigger-bar close", () => {
  const trades = crossoverTrades(seriesWithCrossovers());

  assert.equal(trades.length, 1);
  assert.equal(trades[0].entryIndex, 205);
  assert.equal(trades[0].entry, 200);
  assert.equal(trades[0].exitIndex, 451);
  assert.equal(trades[0].exit, 50);
  assert.equal(trades[0].grossReturn, -0.75);
  assert.equal(trades[0].netReturn, -0.759);
});

test("TF1 score reports crossovers, position days, net cost, and buy-and-hold comparator", () => {
  const score = scoreAsset("BTC", seriesWithCrossovers());

  assert.equal(score.symbol, "BTC");
  assert.equal(score.bars, 501);
  assert.equal(score.crossovers, 1);
  assert.equal(score.positionDays, 246);
  assert.ok(Math.abs(score.netReturn - -0.759) < 1e-12);
  assert.ok(Math.abs(score.buyHoldReturn - -0.45) < 1e-12);
});

test("TF1 study preserves symbol and recent holdouts and kills net underperformance", () => {
  const base = seriesWithCrossovers();
  const series = new Map([
    ["BTC", base],
    ["ETH", base.map((row) => ({ ...row }))],
    ["ATOM", base.map((row) => ({ ...row }))]
  ]);
  const study = runMaCrossoverStudy(series, {
    universe: ["BTC", "ETH", "ATOM"],
    symbolHoldout: ["ATOM"],
    recentHoldoutDays: 30
  });

  assert.equal(study.input.specification, "TF1-MA50-MA200-long-cash/v1");
  assert.deepEqual(study.input.trainSymbols, ["BTC", "ETH"]);
  assert.deepEqual(study.input.symbolHoldout, ["ATOM"]);
  assert.equal(study.result.symbolHoldout.crossovers, 1);
  assert.ok(Math.abs(study.result.holdout.netReturn - -0.759) < 1e-12);
  assert.ok(Math.abs(study.result.holdout.buyHoldReturn - (-0.08333333333333326)) < 1e-12);
  assert.equal(study.result.verdict, "KILLED");
});

test("TF1 returns CONTEXT-ONLY when holdout has no completed crossover", () => {
  const monotonic = Array.from({ length: 260 }, (_, i) => candle(i, 100 + i));
  const study = runMaCrossoverStudy(new Map([
    ["BTC", monotonic],
    ["ATOM", monotonic]
  ]), {
    universe: ["BTC", "ATOM"],
    symbolHoldout: ["ATOM"],
    recentHoldoutDays: 30
  });

  assert.equal(study.result.holdout.crossovers, 0);
  assert.equal(study.result.verdict, "CONTEXT-ONLY");
});
