import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const dataUrl = pathToFileURL(path.join(process.cwd(), "data.js")).href;

function runDataModule(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-data-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", body], {
    env: { ...process.env, DATA_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.split("\n").find((value) => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

test("valid archive ingest deterministically overwrites overlaps and preserves surrounding stored bars", () => {
  const result = runDataModule(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const dir = process.env.DATA_DIR;
    const src = path.join(dir, "archive.csv");
    data.writeBars("XBTUSD", new Map([
      [60, { time: 60, open: 10, high: 12, low: 9, close: 11, volume: 5, buyVol: 2, sellVol: 3, trades: 2, maxTrade: 3 }],
      [180, { time: 180, open: 30, high: 31, low: 29, close: 30.5, volume: 7, buyVol: 4, sellVol: 3, trades: 3, maxTrade: 4 }]
    ]));
    fs.writeFileSync(src, "60,11,13,10,12,9,4\\n120,20,22,19,21,8,5\\n");
    const size = data.ingestKrakenOHLCVT("XBTUSD", src, 0);
    console.log("__RESULT__" + JSON.stringify({ size, bars: data.loadBars("XBTUSD") }));
  `);

  assert.equal(result.size, 3);
  assert.deepEqual(result.bars.map((bar) => bar.time), [60, 120, 180]);
  assert.deepEqual(result.bars[0], {
    time: 60, open: 11, high: 13, low: 10, close: 12,
    volume: 9, buyVol: 0, sellVol: 0, trades: 4, maxTrade: 0,
  });
  assert.equal(result.bars[2].buyVol, 4);
});

test("archive ingest rejects malformed rows instead of coercing missing volume or trades to zero", () => {
  const result = runDataModule(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const cases = {
      missingVolume: "60,10,11,9,10.5,,2\\n",
      missingTrades: "60,10,11,9,10.5,3,\\n",
      negativeVolume: "60,10,11,9,10.5,-1,2\\n",
      nonFinite: "60,10,Infinity,9,10.5,3,2\\n",
      ohlcInvalid: "60,10,10.5,9,11,3,2\\n",
      offMinute: "61,10,11,9,10.5,3,2\\n"
    };
    const errors = {};
    for (const [name, row] of Object.entries(cases)) {
      const src = path.join(process.env.DATA_DIR, name + ".csv");
      fs.writeFileSync(src, row);
      try { data.ingestKrakenOHLCVT("XBTUSD", src, 0); }
      catch (err) { errors[name] = err.message; }
    }
    console.log("__RESULT__" + JSON.stringify(errors));
  `);

  assert.deepEqual(Object.keys(result).sort(), [
    "missingTrades", "missingVolume", "negativeVolume", "nonFinite", "offMinute", "ohlcInvalid"
  ]);
});

test("archive ingest rejects duplicate and non-monotonic source rows", () => {
  const result = runDataModule(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const cases = {
      duplicate: "60,10,11,9,10.5,3,2\\n60,10,11,9,10.5,3,2\\n",
      nonMonotonic: "120,10,11,9,10.5,3,2\\n60,10,11,9,10.5,3,2\\n"
    };
    const errors = {};
    for (const [name, rows] of Object.entries(cases)) {
      const src = path.join(process.env.DATA_DIR, name + ".csv");
      fs.writeFileSync(src, rows);
      try { data.ingestKrakenOHLCVT("XBTUSD", src, 0); }
      catch (err) { errors[name] = err.message; }
    }
    console.log("__RESULT__" + JSON.stringify(errors));
  `);

  assert.match(result.duplicate, /strictly increasing/);
  assert.match(result.nonMonotonic, /strictly increasing/);
});

test("stored candle loading rejects duplicate, non-monotonic, and malformed persisted rows", () => {
  const result = runDataModule(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const header = "time,open,high,low,close,volume,buyVol,sellVol,trades,maxTrade\\n";
    const cases = {
      duplicate: header + "60,10,11,9,10.5,3,1,2,2,2\\n60,10,11,9,10.5,3,1,2,2,2\\n",
      nonMonotonic: header + "120,10,11,9,10.5,3,1,2,2,2\\n60,10,11,9,10.5,3,1,2,2,2\\n",
      malformed: header + "60,10,11,9,10.5,3,1,2,2\\n"
    };
    const errors = {};
    fs.mkdirSync(path.join(process.env.DATA_DIR, "candles"), { recursive: true });
    for (const [name, text] of Object.entries(cases)) {
      fs.writeFileSync(path.join(process.env.DATA_DIR, "candles", "XBTUSD.csv"), text);
      try { data.loadBars("XBTUSD"); }
      catch (err) { errors[name] = err.message; }
    }
    console.log("__RESULT__" + JSON.stringify(errors));
  `);

  assert.match(result.duplicate, /strictly increasing/);
  assert.match(result.nonMonotonic, /strictly increasing/);
  assert.match(result.malformed, /malformed stored/);
});
