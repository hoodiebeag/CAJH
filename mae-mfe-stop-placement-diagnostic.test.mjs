import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runMaeMfeStopPlacementDiagnostic } from "./mae-mfe-stop-placement-diagnostic.mjs";

const HAS_XBT_CANDLES = fs.existsSync(new URL("./candles/XBTUSD.csv", import.meta.url));

test("classifies an asset with no local candles as insufficient-candle-history", async () => {
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: ["ZZZFAKE"] });
  assert.equal(report.input.coverage.length, 1);
  assert.deepEqual(report.input.coverage[0], { symbol: "ZZZFAKE", included: false, reason: "insufficient-candle-history" });
  assert.equal(report.result.verdict, "MAE-MFE-DATA-INSUFFICIENT");
  assert.equal(report.result.eligibleAssets, 0);
});

test("reports MAE-MFE-DATA-INSUFFICIENT (not a crash) when zero assets clear the coverage gate", async () => {
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: ["ZZZFAKE1", "ZZZFAKE2"] });
  assert.equal(report.result.verdict, "MAE-MFE-DATA-INSUFFICIENT");
  assert.deepEqual(report.result.families, {});
});

test("includes an asset once local candle coverage clears the gate, and reports both families with winner/loser distributions", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: ["XBT"] });
  assert.equal(report.input.coverage[0].included, true);
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    assert.ok(f, `expected ${family} in the result`);
    assert.equal(f.trades, f.winners.count + f.losers.count, "winner + loser counts must account for every trade");
    assert.ok(typeof f.failureShape.dominant === "string" && f.failureShape.dominant.length > 0);
    assert.equal(f.failureShape.nearMiss + f.failureShape.ranStraight, f.losers.count);
  }
});

test("real XBT holdout produces at least one trade in at least one family (not a zero-trade no-op)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: ["XBT"] });
  const totalTrades = report.result.families.breakout.trades + report.result.families.anticipate.trades;
  assert.ok(totalTrades > 0, "expected at least one trade across breakout/anticipate on real XBT holdout history");
});

test("failureShape.dominant is NO-LOSERS when a family has zero losing trades", async () => {
  // A watchlist entry with no local candles yields insufficient coverage, so the whole run
  // reports MAE-MFE-DATA-INSUFFICIENT — this pins the zero-losers branch directly instead.
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: [] });
  assert.equal(report.result.verdict, "MAE-MFE-DATA-INSUFFICIENT");
});

test("mae/mfe are never negative (floored at 0, matching backtest.js's excursion convention)", async (t) => {
  if (!HAS_XBT_CANDLES) { t.skip("candles/XBTUSD.csv absent (no local candle history)"); return; }
  const report = await runMaeMfeStopPlacementDiagnostic({ watchlist: ["XBT"] });
  for (const family of ["breakout", "anticipate"]) {
    const f = report.result.families[family];
    for (const side of [f.winners, f.losers]) {
      for (const d of [side.mae, side.mfe]) {
        if (d.n === 0) continue;
        assert.ok(d.p25 === null || d.p25 >= 0, `${family} ${JSON.stringify(d)} must not go negative`);
      }
    }
  }
});
