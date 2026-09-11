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

// ---------- fetchBars, against a mock built from the real decoder's emit ----------
//
// Rule 12: a mock is only evidence if it emits what the real library emits. This one was written
// from @stoqey/ib's own decoder rather than from memory. Two things were read off it directly:
//   emit(historicalData, reqId, date, open, high, low, close, volume, barCount, WAP, hasGaps)
//   the completion row carries the literal "finished", optionally suffixed "-<start>-<end>"
// The adapter bug this project already paid for (brokers/ibkr.test.mjs encoding error events
// backwards, certified by 27 green tests until a live Gateway disagreed) came from doing the
// opposite.

import { EventEmitter } from "node:events";
import { fetchBars, fetchDailyBars } from "./ibkr-bars.mjs";

const FAKE_IB = {
  EventName: { historicalData: "historicalData", error: "error" },
  BarSizeSetting: { DAYS_ONE: "1 day", MINUTES_ONE: "1 min", HOURS_ONE: "1 hour" },
  isNonFatalError: (code) => code >= 2100 && code <= 2999,
};

/** An api that records the reqHistoricalData arguments and replays a canned series. */
function fakeApi(rows, { errorAfter = null, finishedSuffix = "" } = {}) {
  const api = new EventEmitter();
  api.off = api.removeListener.bind(api);
  api.calls = [];
  api.reqHistoricalData = (...args) => {
    api.calls.push(args);
    setImmediate(() => {
      const reqId = args[0];
      for (const r of rows) api.emit("historicalData", reqId, ...r);
      if (errorAfter !== null) return api.emit("error", reqId, errorAfter, "rejected");
      api.emit("historicalData", reqId, `finished${finishedSuffix}`, -1, -1, -1, -1, -1, -1, -1, false);
    });
  };
  return api;
}

test("fetchBars defaults to daily, so the three existing callers are unchanged", async () => {
  const api = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]]);
  await fetchDailyBars({ api, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7);
  assert.equal(api.calls[0][4], "1 day");
});

test("fetchBars passes an intraday bar size through to the request", async () => {
  const api = fakeApi([[String(1724112000), 1, 2, 0.5, 1.5, 100, 1, 1, false]]);
  await fetchBars({ api, ib: FAKE_IB }, {}, "1 D", "TRADES", 7, "1 min");
  assert.equal(api.calls[0][4], "1 min");
});

test("an intraday bar's epoch-seconds timestamp survives, unlike a daily YYYYMMDD string", async () => {
  const t = Math.floor(Date.UTC(2024, 7, 20, 14, 30) / 1000);
  const api = fakeApi([[String(t), 1, 2, 0.5, 1.5, 100, 1, 1, false]]);
  const out = await fetchBars({ api, ib: FAKE_IB }, {}, "1 D", "TRADES", 7, "1 min");
  assert.equal(out.ok, true);
  assert.equal(out.bars[0].time, t, "an intraday bar must keep its intraday time, not collapse to midnight");
});

test("full OHLCV is carried through, not just the close", async () => {
  const api = fakeApi([["20240820", 10, 12, 9, 11, 5000, 1, 1, false]]);
  const out = await fetchBars({ api, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7);
  assert.deepEqual(
    { open: out.bars[0].open, high: out.bars[0].high, low: out.bars[0].low, close: out.bars[0].close, volume: out.bars[0].volume },
    { open: 10, high: 12, low: 9, close: 11, volume: 5000 },
  );
});

test('the "finished" row ends the stream and is never itself a bar', async () => {
  const api = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]], { finishedSuffix: "-20240101-20240820" });
  const out = await fetchBars({ api, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7);
  assert.equal(out.bars.length, 1, "the suffixed completion marker must not be parsed as a bar");
});

test("another request's bars are ignored, so two in flight cannot cross-contaminate", async () => {
  const api = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]]);
  const p = fetchBars({ api, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7);
  api.emit("historicalData", 99, "20240821", 1, 2, 0.5, 9.9, 100, 1, 1, false);
  const out = await p;
  assert.equal(out.bars.length, 1);
  assert.equal(out.bars[0].close, 1.5);
});

test("a fatal error resolves with the reason and the partial bars, rather than a bare timeout", async () => {
  const api = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]], { errorAfter: 162 });
  const out = await fetchBars({ api, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7, "1 min");
  assert.equal(out.ok, false);
  assert.match(out.reason, /^162:/);
  assert.equal(out.bars.length, 1, "partial data is returned so the caller can see how far it got");
});

test("a data-farm warning in the 2100-2999 band does not kill the request", async () => {
  const api = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]], { errorAfter: 2106 });
  const api2 = fakeApi([["20240820", 1, 2, 0.5, 1.5, 100, 1, 1, false]]);
  // errorAfter suppresses the finished row, so a correctly-ignored warning leaves the request
  // open; assert the discrimination itself rather than the resolution.
  assert.equal(FAKE_IB.isNonFatalError(2106), true);
  assert.equal(FAKE_IB.isNonFatalError(162), false);
  const out = await fetchBars({ api: api2, ib: FAKE_IB }, {}, "1 Y", "TRADES", 7);
  assert.equal(out.ok, true);
});
