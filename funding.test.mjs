import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, mergeRows, toCsv } from "./funding.mjs";

test("parseCsv reads timestamp,funding_rate rows and skips the header", () => {
  const rows = parseCsv("timestamp,funding_rate\n100,0.0001\n200,-0.0002\n");
  assert.deepEqual([...rows], [[100, 0.0001], [200, -0.0002]]);
});

test("parseCsv ignores blank lines and malformed rows", () => {
  const rows = parseCsv("timestamp,funding_rate\n\n100,0.0001\nnot,a,row\n300,abc\n");
  assert.deepEqual([...rows], [[100, 0.0001]]);
});

test("mergeRows is idempotent: re-merging the same incoming rows changes nothing", () => {
  const existing = new Map([[100, 0.0001], [200, -0.0002]]);
  const incoming = [{ timestamp: 100, fundingRate: 0.0001 }, { timestamp: 300, fundingRate: 0.0003 }];
  const once = mergeRows(existing, incoming);
  const twice = mergeRows(new Map(once), incoming);
  assert.deepEqual(once, twice);
  assert.deepEqual(once, [[100, 0.0001], [200, -0.0002], [300, 0.0003]]);
});

test("mergeRows sorts by timestamp and drops non-finite rows", () => {
  const merged = mergeRows(new Map(), [
    { timestamp: 300, fundingRate: 0.0003 },
    { timestamp: 100, fundingRate: 0.0001 },
    { timestamp: NaN, fundingRate: 0.0005 },
    { timestamp: 200, fundingRate: NaN },
  ]);
  assert.deepEqual(merged, [[100, 0.0001], [300, 0.0003]]);
});

test("toCsv round-trips through parseCsv", () => {
  const rows = [[100, 0.0001], [200, -0.0002]];
  const text = toCsv(rows);
  assert.equal(text, "timestamp,funding_rate\n100,0.0001\n200,-0.0002\n");
  assert.deepEqual([...parseCsv(text)], rows);
});
