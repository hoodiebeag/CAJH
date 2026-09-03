import assert from "node:assert/strict";
import test from "node:test";
import { barTimeToEpoch, barDateKey, alignByDate } from "./ibkr-bars.mjs";

// ---------- the daily-bar date quirk ----------

test('a "YYYYMMDD" daily bar becomes UTC midnight, not a 1970 epoch', () => {
  // Number("20240820") is 20,240,820 — a valid-looking epoch in August 1970. It does not throw,
  // which is exactly why this corrupts silently. brokers/ibkr.mjs documents the same quirk.
  assert.equal(barTimeToEpoch("20240820"), Date.UTC(2024, 7, 20) / 1000);
  assert.equal(barDateKey("20240820"), "2024-08-20");
  assert.notEqual(barTimeToEpoch("20240820"), 20240820);
});

test("a real epoch passes through unchanged", () => {
  const t = Date.UTC(2024, 7, 20) / 1000;
  assert.equal(barTimeToEpoch(t), t);
  assert.equal(barTimeToEpoch(String(t)), t);
});

test("an unparseable time is null rather than NaN-in-disguise", () => {
  assert.equal(barTimeToEpoch("not-a-time"), null);
});

// ---------- alignment ----------

const bar = (date, close) => ({ date, close });

test("alignByDate inner-joins and never pairs an IV quote with the wrong day", () => {
  const iv = [bar("2024-01-02", 0.20), bar("2024-01-03", 0.21), bar("2024-01-05", 0.22)];
  const px = [bar("2024-01-02", 100), bar("2024-01-03", 101), bar("2024-01-04", 102)];
  const a = alignByDate(iv, px);
  assert.deepEqual(a.dates, ["2024-01-02", "2024-01-03"]);
  assert.deepEqual(a.ivCloses, [0.20, 0.21]);
  assert.deepEqual(a.priceCloses, [100, 101]);
  assert.equal(a.matched, 2);
  assert.equal(a.ivOnly, 1, "the 01-05 IV bar has no price bar");
  assert.equal(a.priceOnly, 1, "the 01-04 price bar has no IV bar");
});

test("a one-day offset between the two series is dropped, not silently zipped", () => {
  // Zipping by index would pair every IV quote with the NEXT day's price and produce a
  // confident, meaningless premium. This is the failure the inner join exists to prevent.
  const iv = [bar("2024-01-02", 0.20), bar("2024-01-03", 0.21), bar("2024-01-04", 0.22)];
  const px = [bar("2024-01-03", 101), bar("2024-01-04", 102), bar("2024-01-05", 103)];
  const a = alignByDate(iv, px);
  assert.deepEqual(a.dates, ["2024-01-03", "2024-01-04"]);
  assert.deepEqual(a.ivCloses, [0.21, 0.22], "IV must follow its own date, not its index");
  assert.deepEqual(a.priceCloses, [101, 102]);
});

test("disjoint series align to nothing rather than to garbage", () => {
  const a = alignByDate([bar("2024-01-02", 0.2)], [bar("2025-06-01", 100)]);
  assert.equal(a.matched, 0);
  assert.deepEqual(a.ivCloses, []);
});

test("alignByDate output is always 1:1 across the three arrays", () => {
  const iv = Array.from({ length: 50 }, (_, i) => bar(`2024-02-${String((i % 28) + 1).padStart(2, "0")}`, 0.2));
  const px = Array.from({ length: 40 }, (_, i) => bar(`2024-02-${String((i % 28) + 1).padStart(2, "0")}`, 100 + i));
  const a = alignByDate(iv, px);
  assert.equal(a.dates.length, a.ivCloses.length);
  assert.equal(a.dates.length, a.priceCloses.length);
});
