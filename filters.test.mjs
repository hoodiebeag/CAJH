import test from "node:test";
import assert from "node:assert/strict";
import { atr, sma, adx, closeTimeIndex, buildEntryGate } from "./filters.mjs";

const bars = (specs) => specs.map(([h, l, c], i) => ({ time: 1000 + i * 86400, high: h, low: l, close: c }));
const flat = (n, px) => bars(Array.from({ length: n }, () => [px, px, px]));
const ramp = (n, from = 100, step = 1) =>
  bars(Array.from({ length: n }, (_, i) => [from + i * step + 1, from + i * step - 1, from + i * step]));

test("sma is null until the window is full, then equals the arithmetic mean", () => {
  const s = sma(bars([[0, 0, 10], [0, 0, 20], [0, 0, 30]]), 3);
  assert.deepEqual(s.slice(0, 2), [null, null]);
  assert.equal(s[2], 20);
});

test("atr on a flat series is zero, and null before the window fills", () => {
  const a = atr(flat(30, 100), 14);
  assert.equal(a[12], null);
  assert.equal(a[29], 0);
});

test("adx needs two full periods before it exists -- the second is the average of DX itself", () => {
  const a = adx(ramp(200), 14);
  assert.equal(a.findIndex((x) => x !== null), 27); // 2 * 14 - 1
  assert.equal(a[20], null);
});

test("adx reads a clean one-way ramp as a strong trend and a flat series as no trend", () => {
  const trending = adx(ramp(200), 14);
  assert.ok(trending.at(-1) > 60, `expected a high ADX on a pure ramp, got ${trending.at(-1)}`);
  const still = adx(flat(200, 100), 14);
  assert.ok(still.at(-1) === null || still.at(-1) === 0, `expected no trend strength, got ${still.at(-1)}`);
});

test("a typo in a filter name throws instead of quietly passing every bar", () => {
  assert.throws(() => buildEntryGate({ mASlope: {} }, { candles: ramp(50), entryMins: 1440 }), /unknown filter/);
});

test("an empty or absent spec compiles to no gate at all, not to a gate that blocks everything", () => {
  assert.equal(buildEntryGate(null, { candles: ramp(50), entryMins: 1440 }), null);
  assert.equal(buildEntryGate({}, { candles: ramp(50), entryMins: 1440 }), null);
});

test("the gate is addressed by close time, and a time that is not a bar close is refused", () => {
  const candles = ramp(300);
  const gate = buildEntryGate({ maSlope: { period: 50, lookback: 10 } }, { candles, entryMins: 1440 });
  const t = (i) => Number(candles[i].time) + 1440 * 60;
  assert.equal(gate(t(200)), true, "a rising 50-MA must pass the slope filter");
  assert.equal(gate(t(5)), false, "before the average exists there is nothing to pass");
  assert.equal(gate(t(200) + 1), false, "a time between bar closes addresses no bar");
});

test("maSlope rejects a falling average even where price is above it", () => {
  const falling = ramp(300, 400, -1);
  const gate = buildEntryGate({ maSlope: { period: 50, lookback: 10 } }, { candles: falling, entryMins: 1440 });
  assert.equal(gate(Number(falling[200].time) + 1440 * 60), false);
});

test("btcRegime refuses to compile without BTC rather than passing a filter it cannot evaluate", () => {
  assert.throws(() => buildEntryGate({ btcRegime: { period: 200 } }, { candles: ramp(300), entryMins: 1440 }),
    /needs btcCandles/);
});

test("btcRegime resolves BTC by time, so an alt bar never reads a BTC bar from its own future", () => {
  const alt = ramp(300);
  // BTC starts 100 days later than the alt: the early alt bars have no closed BTC bar to read.
  const btc = ramp(300).map((c, i) => ({ ...c, time: c.time + 100 * 86400 }));
  const gate = buildEntryGate({ btcRegime: { period: 50 } }, { candles: alt, entryMins: 1440, btcCandles: btc });
  assert.equal(gate(Number(alt[10].time) + 1440 * 60), false, "no closed BTC bar exists yet");
  assert.equal(gate(Number(alt[290].time) + 1440 * 60), true, "a rising BTC passes once its bars exist");
});

test("closeTimeIndex maps every bar's close time to its own index", () => {
  const c = ramp(5);
  const idx = closeTimeIndex(c, 1440);
  assert.equal(idx.get(Number(c[3].time) + 1440 * 60), 3);
  assert.equal(idx.size, 5);
});
