import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWatchlist, stat } from "./researchlib.mjs";

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
