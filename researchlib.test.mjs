import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadWatchlist, stat, SEALED_SYMBOLS, splitSealedSymbols, walkForwardWindows, walkForwardSeriesWindows,
} from "./researchlib.mjs";

function withEnv(vars, fn) {
  const prior = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
}

test("loadWatchlist prefers the WATCHLIST env var over everything else", () => {
  const result = withEnv({ WATCHLIST: "btc, eth ,sol" }, () => loadWatchlist());
  assert.deepEqual(result, ["BTC", "ETH", "SOL"]);
});

test("loadWatchlist falls back to the on-disk candle store when config's watchlist is genuinely empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-watchlist-"));
  fs.mkdirSync(path.join(dir, "candles"));
  for (const file of ["XBTUSD.csv", "ETHUSD.csv", "POLUSD.csv"]) {
    fs.writeFileSync(path.join(dir, "candles", file), "");
  }
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    storageVersion: 1, kind: "config", data: { scanChannelId: null, watchlist: [], lastScanTime: null },
  }));

  const result = withEnv({ WATCHLIST: "", DATA_DIR: dir }, () => loadWatchlist());
  assert.deepEqual(result, ["ETH", "BTC", "POL"].sort());
});

test("loadWatchlist returns [] rather than throwing when no candles/ directory exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-watchlist-empty-"));
  const result = withEnv({ WATCHLIST: "", DATA_DIR: dir }, () => loadWatchlist());
  assert.deepEqual(result, []);
});

test("stat computes mean, CI, win rate, and total for a simple sample", () => {
  const result = stat([1, -1, 2]);
  assert.equal(result.n, 3);
  assert.ok(Math.abs(result.mean - 2 / 3) < 1e-12);
  assert.equal(result.wr, 2 / 3);
  assert.ok(Math.abs(result.total - 2) < 1e-12);
  assert.equal(result.best, 2);
});

test("splitSealedSymbols partitions string-symbol watchlists using SEALED_SYMBOLS", () => {
  const watchlist = ["BTC", "ETH", ...SEALED_SYMBOLS, "DOGE"];
  const { active, sealed } = splitSealedSymbols(watchlist);
  assert.deepEqual(active, ["BTC", "ETH", "DOGE"]);
  assert.deepEqual(sealed, [...SEALED_SYMBOLS]);
});

test("splitSealedSymbols partitions {symbol,id}-shaped watchlists the same way", () => {
  const watchlist = [
    { symbol: "BTC", id: "XBTUSD" },
    { symbol: SEALED_SYMBOLS[0], id: `${SEALED_SYMBOLS[0]}USD` },
    { symbol: "ETH", id: "ETHUSD" },
  ];
  const { active, sealed } = splitSealedSymbols(watchlist);
  assert.deepEqual(active.map((a) => a.symbol), ["BTC", "ETH"]);
  assert.deepEqual(sealed.map((a) => a.symbol), [SEALED_SYMBOLS[0]]);
});

test("splitSealedSymbols never drops or duplicates an entry", () => {
  const watchlist = ["BTC", "ETH", "SOL", ...SEALED_SYMBOLS, "XRP"];
  const { active, sealed } = splitSealedSymbols(watchlist);
  assert.deepEqual([...active, ...sealed].sort(), [...watchlist].sort());
});

test("walkForwardWindows produces folds whose train only grows and whose holdouts tile the remainder with no gap or overlap", () => {
  const candles = Array.from({ length: 100 }, (_, i) => ({ time: i, close: i }));
  const windows = walkForwardWindows(candles, { folds: 4, trainFraction: 0.5 });
  assert.equal(windows.length, 4);
  let prevTrainLen = 0;
  for (const { train, holdout } of windows) {
    assert.ok(train.length > prevTrainLen, "each fold's train must grow strictly");
    prevTrainLen = train.length;
    assert.equal(train[train.length - 1].time, train.length - 1, "train must be a prefix of the series");
    assert.equal(holdout[0].time, train.length, "holdout must start exactly where train ends");
  }
  // Holdouts tile [trainEnd, n) with no gap or overlap, and the last one reaches the end.
  const trainEnd = windows[0].train.length;
  let cursor = trainEnd;
  for (const { holdout } of windows) {
    assert.equal(holdout[0].time, cursor);
    cursor = holdout[holdout.length - 1].time + 1;
  }
  assert.equal(cursor, candles.length);
});

test("walkForwardWindows never lets a fold's train see into its own or a later holdout", () => {
  const candles = Array.from({ length: 37 }, (_, i) => ({ time: i }));
  const windows = walkForwardWindows(candles, { folds: 3, trainFraction: 0.6 });
  for (const { train, holdout } of windows) {
    const maxTrainTime = train[train.length - 1].time;
    const minHoldoutTime = holdout[0].time;
    assert.ok(maxTrainTime < minHoldoutTime);
  }
});

test("walkForwardWindows rejects a non-positive-integer folds or an out-of-range trainFraction", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ time: i }));
  assert.throws(() => walkForwardWindows(candles, { folds: 0 }));
  assert.throws(() => walkForwardWindows(candles, { folds: 1.5 }));
  assert.throws(() => walkForwardWindows(candles, { trainFraction: 0 }));
  assert.throws(() => walkForwardWindows(candles, { trainFraction: 1 }));
});

test("walkForwardWindows skips folds too small to hold any candle rather than emitting an empty holdout", () => {
  const candles = Array.from({ length: 5 }, (_, i) => ({ time: i }));
  const windows = walkForwardWindows(candles, { folds: 10, trainFraction: 0.5 });
  for (const { holdout } of windows) assert.ok(holdout.length > 0);
});

test("walkForwardSeriesWindows cuts every timeframe at the same wall-clock boundary as the anchor", () => {
  // 1h candles: one per hour, 200 of them. 4h candles: one per 4 hours, 50 of them — same
  // wall-clock span, different bar counts, exactly the situation splitSeries's own
  // cut-index-then-filter-by-time convention exists to handle.
  const oneH = Array.from({ length: 200 }, (_, i) => ({ time: i * 3600, close: i }));
  const fourH = Array.from({ length: 50 }, (_, i) => ({ time: i * 14400, close: i }));
  const series = [{ label: "1h", mins: 60, candles: oneH }, { label: "4h", mins: 240, candles: fourH }];

  const windows = walkForwardSeriesWindows(series, { folds: 4, trainFraction: 0.5 });
  assert.equal(windows.length, 4);
  for (const { train, holdout } of windows) {
    const anchorTrain = train.find((tf) => tf.label === "1h").candles;
    const otherTrain = train.find((tf) => tf.label === "4h").candles;
    const trainCutTime = anchorTrain[anchorTrain.length - 1].time;
    // No 4h candle in train may be timed after the anchor's own train cut, and none in
    // holdout may be timed at or before it — the same wall-clock boundary, cross-timeframe.
    assert.ok(otherTrain.every((c) => c.time <= trainCutTime));
    const otherHoldout = holdout.find((tf) => tf.label === "4h").candles;
    assert.ok(otherHoldout.every((c) => c.time > trainCutTime));
  }
});
