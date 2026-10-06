import { test } from "node:test";
import assert from "node:assert";
import { screenUniverse, DEFAULT_LIMITS } from "./universe.mjs";

const bars = (closes, volume = 1e6) =>
  closes.map((c, i) => ({ time: i * 86400, open: c, high: c, low: c, close: c, volume }));

test("a five-order-of-magnitude price path is rejected -- this is the PARA case", () => {
  const series = { PARA: bars([113900, 5000, 900, 40, 3, 1.06]) };
  const { kept, rejected } = screenUniverse(series);
  assert.deepEqual(Object.keys(kept), []);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0][1], /close range .* exceeds/);
});

test("a real 50x collapse is KEPT -- the screen rejects impossible data, not bad performance", () => {
  // CHPT, SEDG, LCID and PLUG all fell 26-59x in this window and are genuine listed equities.
  const series = { CHPT: bars([267.6, 120, 40, 12, 4.51]) };
  const { kept, rejected } = screenUniverse(series);
  assert.deepEqual(Object.keys(kept), ["CHPT"]);
  assert.deepEqual(rejected, []);
});

test("a series that is mostly gaps is rejected", () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + i * 0.1);
  const b = bars(closes);
  for (let i = 0; i < 30; i++) b[i].volume = 0;      // 30% of bars never traded
  const { kept, rejected } = screenUniverse({ X: b });
  assert.deepEqual(Object.keys(kept), []);
  assert.match(rejected[0][1], /no volume/);
});

test("a few missing bars are tolerated -- vendors drop the odd day", () => {
  const b = bars(Array.from({ length: 100 }, () => 100));
  for (let i = 0; i < 10; i++) b[i].volume = 0;      // 10%, under the 20% limit
  assert.deepEqual(Object.keys(screenUniverse({ X: b }).kept), ["X"]);
});

test("a name too thin for a close-fill assumption is rejected", () => {
  const { kept, rejected } = screenUniverse({ THIN: bars(Array.from({ length: 50 }, () => 10), 500) });
  assert.deepEqual(Object.keys(kept), []);
  assert.match(rejected[0][1], /median dollar volume/);
});

test("rejections are returned with reasons rather than dropped silently", () => {
  const series = {
    GOOD: bars(Array.from({ length: 50 }, (_, i) => 100 + i)),
    BROKEN: bars([100000, 1]),
  };
  const { kept, rejected } = screenUniverse(series);
  assert.deepEqual(Object.keys(kept), ["GOOD"]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0][0], "BROKEN");
  assert.ok(rejected[0][1].length > 0, "every rejection carries a reason");
});

test("the limits are overridable, so a universe can state its own", () => {
  const series = { X: bars([1000, 1]) };                       // 1000x
  assert.deepEqual(Object.keys(screenUniverse(series).kept), []);
  assert.deepEqual(Object.keys(screenUniverse(series, { maxCloseRatio: 2000 }).kept), ["X"]);
  assert.equal(DEFAULT_LIMITS.maxCloseRatio, 500);
});

test("a series with fewer than two usable closes is rejected, not crashed on", () => {
  const { kept, rejected } = screenUniverse({ EMPTY: [], ONE: bars([100]) });
  assert.deepEqual(Object.keys(kept), []);
  assert.equal(rejected.length, 2);
});
