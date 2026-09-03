import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toCsv, listPairs, COLUMNS } from "./bundle-candles.mjs";

const bar = (t, o = 100, h = 101, l = 99, c = 100.5, v = 1000) => ({
  time: t, open: o, high: h, low: l, close: c, volume: v, trades: 7, buyVol: 1, sellVol: 2, maxTrade: 3,
});

test("only the six columns a resampled bar needs are written", () => {
  const csv = toCsv([bar(1700000000)]);
  assert.equal(csv.split("\n")[0], COLUMNS.join(","));
  for (const dropped of ["trades", "buyVol", "sellVol", "maxTrade"]) {
    assert.ok(!csv.includes(dropped), `${dropped} should not be in the bundle`);
  }
});

test("float noise is trimmed but the time field is left exact", () => {
  const csv = toCsv([bar(1700000000, 100.12345678901, 101.98765432109)]);
  const row = csv.trim().split("\n")[1];
  assert.match(row, /^1700000000,/, "time must survive verbatim -- it is the join key");
  assert.ok(row.includes("100.123457"), "prices trimmed to 6dp");
  assert.ok(!row.includes("100.12345678901"));
});

test("a round-trip preserves every value a study actually reads", () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(1700000000 + i * 86400, 100 + i, 102 + i, 98 + i, 101 + i, 500 + i));
  const rows = toCsv(bars).trim().split("\n").slice(1).map((l) => {
    const c = l.split(",");
    return Object.fromEntries(COLUMNS.map((k, j) => [k, Number(c[j])]));
  });
  assert.equal(rows.length, bars.length);
  for (let i = 0; i < bars.length; i++) {
    for (const k of COLUMNS) assert.equal(rows[i][k], bars[i][k], `${k} changed at row ${i}`);
  }
});

test("empty and missing values become empty fields rather than the string undefined", () => {
  const csv = toCsv([{ time: 1700000000, open: 100, high: null, low: undefined, close: 100.5, volume: "" }]);
  const row = csv.trim().split("\n")[1];
  assert.ok(!row.includes("undefined") && !row.includes("null"), `got ${row}`);
  assert.equal(row, "1700000000,100,,,100.5,");
});

test("listPairs reads pair names from a candle directory and ignores non-CSV", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-bundle-"));
  fs.writeFileSync(path.join(dir, "XBTUSD.csv"), "");
  fs.writeFileSync(path.join(dir, "ETHUSD.csv"), "");
  fs.writeFileSync(path.join(dir, "notes.txt"), "");
  assert.deepEqual(listPairs(dir), ["ETHUSD", "XBTUSD"]);
});

test("a missing candle directory is empty, not an exception", () => {
  assert.deepEqual(listPairs(path.join(os.tmpdir(), "cajh-does-not-exist")), []);
});

test("importing the module does not run the bundler", () => {
  // It did, before this test existed: the else-branch fired on import, failed to find a candle
  // store and set a non-zero exit code, failing the whole suite from a module nobody invoked.
  assert.equal(process.exitCode ?? 0, 0, "import left a failing exit code behind");
});
