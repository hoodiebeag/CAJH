import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runWalkforwardRevalidation } from "./walkforward-revalidation.mjs";

const HAS_XBT_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));

test("classifies an asset with no local candles as insufficient-candle-history", async () => {
  const report = await runWalkforwardRevalidation({ watchlist: ["ZZZFAKE"] });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "WALKFORWARD-REVALIDATION-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("excludes SEALED_SYMBOLS entirely from coverage — this item's own note says not to spend that pool", async () => {
  const report = await runWalkforwardRevalidation({ watchlist: ["AVAX", "LINK"] });
  assert.deepEqual(report.input.coverage, []);
});

test("includes an eligible asset and reports both families with all 4 folds present", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runWalkforwardRevalidation({ watchlist: ["XBT"], folds: 4 });
  assert.equal(report.input.coverage[0].included, true);
  assert.ok(report.result.families.breakout);
  assert.ok(report.result.families.anticipate);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.equal(f.folds.length, 4);
    assert.deepEqual(f.folds.map((w) => w.fold), [1, 2, 3, 4]);
    assert.ok(f.singleSplit, "single-split comparison figure must be present");
    assert.ok(typeof f.singleSplit.avgR === "number");
    assert.ok(f.anova, "anova stats must be present");
    assert.ok(typeof f.dispersionCall === "string" && f.dispersionCall.length > 0);
  }
});

test("per-fold trade counts sum to the sum of per-asset per-fold trade counts (pins the pooling, not a re-derivation)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runWalkforwardRevalidation({ watchlist: ["XBT"], folds: 4 });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    const poolTotal = f.folds.reduce((a, w) => a + w.trades, 0);
    const perAssetTotal = f.perAsset.reduce((a, asset) => a + asset.folds.reduce((b, w) => b + w.trades, 0), 0);
    assert.equal(poolTotal, perAssetTotal);
  }
});

test("this is a real backtest on real local candle history, not a zero-trade no-op", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runWalkforwardRevalidation({ watchlist: ["XBT"] });
  const totalTrades = report.result.families.breakout.folds.reduce((a, w) => a + w.trades, 0)
    + report.result.families.anticipate.folds.reduce((a, w) => a + w.trades, 0);
  assert.ok(totalTrades > 0, "expected at least one trade across breakout/anticipate on real XBT history");
});
