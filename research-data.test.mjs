import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const dataUrl = pathToFileURL(path.join(process.cwd(), "data.js")).href;
const researchUrl = pathToFileURL(path.join(process.cwd(), "researchlab.mjs")).href;

function runResearchData(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-research-data-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", body], {
    env: { ...process.env, DATA_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.split("\n").find((value) => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

const bar = (time, open, high, low, close, volume = 1) => ({
  time, open, high, low, close, volume, buyVol: 0, sellVol: 0, trades: 1, maxTrade: volume,
});

test("resampleBars sorts input and excludes the incomplete current bucket", () => {
  const result = runResearchData(`
    const data = await import(${JSON.stringify(dataUrl)});
    const bars = [
      ${JSON.stringify(bar(120, 30, 31, 29, 30.5))},
      ${JSON.stringify(bar(60, 20, 25, 19, 24))},
      ${JSON.stringify(bar(0, 10, 12, 9, 11))}
    ];
    const out = data.resampleBars(bars, 2, { nowSec: 120 });
    console.log("__RESULT__" + JSON.stringify(out));
  `);

  assert.deepEqual(result.candles, [{ time: 0, open: 10, high: 25, low: 9, close: 24, volume: 2 }]);
});

test("resampleBars exposes gaps and can reject them under explicit error policy", () => {
  const result = runResearchData(`
    const data = await import(${JSON.stringify(dataUrl)});
    const bars = [
      ${JSON.stringify(bar(0, 10, 11, 9, 10.5))},
      ${JSON.stringify(bar(180, 20, 21, 19, 20.5))}
    ];
    const allowed = data.resampleBars(bars, 1, { gapPolicy: "allow" });
    let error = null;
    try { data.resampleBars(bars, 1, { gapPolicy: "error" }); }
    catch (err) { error = err.message; }
    console.log("__RESULT__" + JSON.stringify({ gaps: allowed.gaps, error }));
  `);

  assert.deepEqual(result.gaps, [{ from: 0, to: 180, seconds: 120 }]);
  assert.match(result.error, /candle gap detected/);
});

test("loadResearchCandlesWithQuality rebuilds corrupt caches instead of trusting them", () => {
  const result = runResearchData(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([
      [0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}],
      [60, ${JSON.stringify(bar(60, 11, 13, 10, 12, 3))}]
    ]));
    const cacheDir = path.join(process.env.DATA_DIR, "research-cache", "tf-2");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "XBTUSD.json"), "{not-json");
    const rebuilt = research.loadResearchCandlesWithQuality("XBTUSD", 2);
    const cacheText = fs.readFileSync(path.join(cacheDir, "XBTUSD.json"), "utf8");
    console.log("__RESULT__" + JSON.stringify({ rebuilt, cache: JSON.parse(cacheText) }));
  `);

  assert.equal(result.rebuilt.schema, "cajh-research-cache/v1");
  assert.deepEqual(result.rebuilt.candles, [{ time: 0, open: 10, high: 13, low: 9, close: 12, volume: 5 }]);
  assert.deepEqual(result.cache.candles, result.rebuilt.candles);
});
