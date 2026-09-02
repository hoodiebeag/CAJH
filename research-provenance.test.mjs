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

test("writeFileAtomic replaces content wholesale and leaves no temp file behind", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const research = await import(${JSON.stringify(researchUrl)});
    const dir = process.env.DATA_DIR;
    const file = path.join(dir, "atomic.txt");
    research.writeFileAtomic(file, "first");
    research.writeFileAtomic(file, "second");
    console.log("__RESULT__" + JSON.stringify({
      contents: fs.readFileSync(file, "utf8"),
      leftovers: fs.readdirSync(dir).filter((n) => n.includes(".tmp")),
    }));
  `);

  assert.equal(result.contents, "second");
  assert.deepEqual(result.leftovers, [], "a temp file survived the rename");
});

test("writeFileAtomic cleans up its temp file when the write itself fails", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const research = await import(${JSON.stringify(researchUrl)});
    const dir = process.env.DATA_DIR;
    let threw = false;
    try {
      // Throwing during the temp write — after the temp path has been chosen — is the case
      // where a naive implementation orphans a temp file.
      research.writeFileAtomic(path.join(dir, "fails.txt"), { toString() { throw new Error("boom"); } });
    } catch { threw = true; }
    console.log("__RESULT__" + JSON.stringify({
      threw,
      exists: fs.existsSync(path.join(dir, "fails.txt")),
      leftovers: fs.readdirSync(dir).filter((n) => n.includes(".tmp")),
    }));
  `);

  assert.equal(result.threw, true);
  assert.equal(result.exists, false, "a failed write must not leave a partial target file");
  assert.deepEqual(result.leftovers, [], "a failed write must not orphan its temp file");
});

test("saveExperiment never overwrites an existing run, even within the same millisecond", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([[0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}]]));
    const files = [];
    for (let i = 0; i < 5; i++) files.push(research.saveExperiment("unit", { pairs: ["XBTUSD"] }, { i }));
    console.log("__RESULT__" + JSON.stringify({
      files: files.map((f) => path.basename(f)),
      distinct: new Set(files).size,
      results: files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")).result.i),
      onDisk: fs.readdirSync(path.join(process.env.DATA_DIR, "research-runs")).length,
    }));
  `);

  assert.equal(result.distinct, 5, "two runs collided on one filename");
  assert.deepEqual(result.results, [0, 1, 2, 3, 4], "every run's own result survived");
  assert.equal(result.onDisk, 5, "a run file was clobbered or a temp file was left in research-runs");
});

test("saveExperiment refuses to write over a run file that already exists", () => {
  const result = runProvenance(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = await import(${JSON.stringify(dataUrl)});
    const research = await import(${JSON.stringify(researchUrl)});
    data.writeBars("XBTUSD", new Map([[0, ${JSON.stringify(bar(0, 10, 12, 9, 11, 2))}]]));
    const first = research.saveExperiment("unit", { pairs: ["XBTUSD"] }, { original: true });
    // Reproduce the exact collision the guard exists for: hand saveExperiment a directory whose
    // next id is already taken, by freezing the clock on the first run's timestamp.
    const stamp = path.basename(first).replace(/-unit\\.json$/, "");
    const RealDate = Date;
    const frozen = new RealDate(stamp.replace(/-(\\d{2})-(\\d{2})-(\\d{3})Z$/, ":$1:$2.$3Z"));
    globalThis.Date = class extends RealDate {
      constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(frozen); }
      static now() { return frozen.getTime(); }
    };
    const second = research.saveExperiment("unit", { pairs: ["XBTUSD"] }, { original: false });
    globalThis.Date = RealDate;
    console.log("__RESULT__" + JSON.stringify({
      same: first === second,
      firstStillOriginal: JSON.parse(fs.readFileSync(first, "utf8")).result.original,
      secondName: path.basename(second),
    }));
  `);

  assert.equal(result.same, false, "the second save reused the first run's filename");
  assert.equal(result.firstStillOriginal, true, "the first run's contents were overwritten");
  assert.match(result.secondName, /-2-unit\.json$/, "the collision was resolved by a distinct id, not a clobber");
});
