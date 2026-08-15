import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnalytics } from "./derivatives.mjs";

test("analytics normalization preserves timestamp-value alignment", () => {
  const out = normalizeAnalytics({ result: { timestamp: [100, "bad", 300], data: [1, 2, { long: 3 }], more: true } });
  assert.deepEqual(out.points, [{ timestamp: 100, value: 1 }, { timestamp: 300, value: { long: 3 } }]);
  assert.equal(out.more, true);
  assert.equal(out.sourcePoints, 3);
});

test("analytics normalization rejects an unknown response schema", () => {
  assert.throws(() => normalizeAnalytics({ result: {} }), /Unexpected Kraken/);
});

test("analytics normalization supports Kraken named parallel series", () => {
  const out = normalizeAnalytics({ result: { timestamp: [100, 200], data: { rate: [1, 2], relativeRate: [3, 4] } } });
  assert.deepEqual(out.points, [
    { timestamp: 100, value: { rate: 1, relativeRate: 3 } },
    { timestamp: 200, value: { rate: 2, relativeRate: 4 } },
  ]);
});

test("analytics normalization unwraps a single-key cohort wrapper (e.g. top-traders' top20Percent), matching Kraken's real response shape", () => {
  const out = normalizeAnalytics({
    result: {
      timestamp: [100, 200],
      data: { top20Percent: { longCount: [511, 509], ratio: ["0.50", "0.49"] } },
    },
  });
  assert.deepEqual(out.points, [
    { timestamp: 100, value: { longCount: 511, ratio: "0.50" } },
    { timestamp: 200, value: { longCount: 509, ratio: "0.49" } },
  ]);
});
