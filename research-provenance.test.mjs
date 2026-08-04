import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const dataUrl = pathToFileURL(path.join(process.cwd(), "data.js")).href;
const researchUrl = pathToFileURL(path.join(process.cwd(), "researchlab.mjs")).href;

function runProvenance(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-provenance-"));
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

test("researchInputProvenance hashes candle content, normalized universe, parameters, and code revision", () => {
  const result = runProvenance(`
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([[0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}]]));
    const a = research.researchInputProvenance({
      pairs: ["XBTUSD"],
      universe: [{ symbol: "BTC", id: "XBTUSD" }],
      parameters: { z: 2, a: 1 }
    });
    const b = research.researchInputProvenance({
      pairs: ["XBTUSD"],
      universe: [{ id: "XBTUSD", symbol: "BTC" }],
      parameters: { a: 1, z: 2 }
    });
    console.log("__RESULT__" + JSON.stringify({ a, b }));
  `);

  assert.equal(result.a.schema, "cajh-research-provenance/v1");
  assert.match(result.a.candles.XBTUSD, /^[a-f0-9]{64}$/);
  assert.match(result.a.universeSha256, /^[a-f0-9]{64}$/);
  assert.match(result.a.parametersSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.a.candles.XBTUSD, result.b.candles.XBTUSD);
  assert.equal(result.a.universeSha256, result.b.universeSha256);
  assert.equal(result.a.parametersSha256, result.b.parametersSha256);
  assert.ok(result.a.codeRevision);
});

test("research cache invalidates by candle content hash even when mtime and size are unchanged", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([
      [0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}],
      [60, ${JSON.stringify(bar(60, 11, 13, 10, 12, 3))}]
    ]));
    const first = research.loadResearchCandlesWithQuality("XBTUSD", 2);
    const source = path.join(process.env.DATA_DIR, "candles", "XBTUSD.csv");
    const stat = fs.statSync(source);
    data.writeBars("XBTUSD", new Map([
      [0, ${JSON.stringify(bar(0, 20, 22, 19, 21, 2))}],
      [60, ${JSON.stringify(bar(60, 21, 23, 20, 22, 3))}]
    ]));
    fs.truncateSync(source, stat.size);
    fs.utimesSync(source, stat.atime, stat.mtime);
    const second = research.loadResearchCandlesWithQuality("XBTUSD", 2);
    console.log("__RESULT__" + JSON.stringify({ first, second }));
  `);

  assert.notEqual(result.first.provenance.candles.XBTUSD, result.second.provenance.candles.XBTUSD);
  assert.equal(result.second.candles[0].open, 20);
});

test("saveExperiment attaches immutable research provenance to the run record", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([[0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}]]));
    const file = research.saveExperiment("unit", {
      pairs: ["XBTUSD"],
      universe: [{ symbol: "BTC", id: "XBTUSD" }],
      parameters: { window: 20 }
    }, { ok: true });
    console.log("__RESULT__" + JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))));
  `);

  assert.equal(result.schema, "cajh-research-run/v1");
  assert.equal(result.provenance.schema, "cajh-research-provenance/v1");
  assert.match(result.provenance.candles.XBTUSD, /^[a-f0-9]{64}$/);
  assert.match(result.provenance.parametersSha256, /^[a-f0-9]{64}$/);
});
