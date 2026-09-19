import { test } from "node:test";
import assert from "node:assert/strict";
import { decompose, adjustmentBasis, correlation, compound } from "./overnight.mjs";

const bar = (time, open, close) => ({ time, open: String(open), high: String(Math.max(open, close)), low: String(Math.min(open, close)), close: String(close) });

test("decompose drops the first bar, which has no predecessor to gap from", () => {
  const d = decompose([bar(1, 100, 100), bar(2, 100, 100), bar(3, 100, 100)]);
  assert.equal(d.length, 2);
  assert.equal(d[0].time, 2);
});

test("the two legs compound exactly to the close-to-close return", () => {
  const d = decompose([bar(1, 100, 100), bar(2, 102, 97)]);
  const [x] = d;
  assert.ok(Math.abs((1 + x.overnight) * (1 + x.intraday) - (1 + x.closeToClose)) < 1e-12);
});

test("an up gap that fades still nets a loss, and the legs say which side it came from", () => {
  const [x] = decompose([bar(1, 100, 100), bar(2, 110, 95)]);
  assert.ok(Math.abs(x.overnight - 0.10) < 1e-12);
  assert.ok(x.intraday < 0);
  assert.ok(x.closeToClose < 0);
});

test("a non-positive or missing price is skipped rather than producing Infinity", () => {
  const bad = [bar(1, 100, 0), bar(2, 100, 100), { time: 3, open: "", high: "1", low: "1", close: "1" }];
  const d = decompose(bad);
  assert.equal(d.length, 0);
});

test("correlation is null when a side is constant, not NaN", () => {
  assert.equal(correlation([1, 1, 1], [1, 2, 3]), null);
  assert.equal(correlation([1, 2], [1, 2]), null); // n < 3
});

test("correlation recovers a known perfect anticorrelation", () => {
  assert.ok(Math.abs(correlation([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-12);
});

test("adjustmentBasis flags the split signature: a huge gap the session exactly undoes", () => {
  // Unadjusted opens against adjusted closes: prevClose halves, so open/prevClose reads +100%
  // and the session must give it all back.
  const days = [];
  for (let i = 0; i < 20; i++) days.push({ time: i, overnight: 0.001, intraday: -0.001, closeToClose: 0 });
  for (let i = 0; i < 5; i++) days.push({ time: 100 + i, overnight: 1.0 - i * 0.05, intraday: -0.5 + i * 0.025, closeToClose: 0 });
  const b = adjustmentBasis(days);
  assert.equal(b.extreme, 5);
  assert.ok(b.tailCorrelation < -0.9, `expected the intraday leg to undo the phantom gap, got ${b.tailCorrelation}`);
});

test("adjustmentBasis leaves a clean universe near zero tail correlation", () => {
  // Real gaps carry no information about the session that follows them.
  const days = [];
  for (let i = 0; i < 40; i++) {
    days.push({ time: i, overnight: (i % 2 ? 0.2 : -0.2), intraday: (i % 3 ? 0.01 : -0.01), closeToClose: 0 });
  }
  const b = adjustmentBasis(days);
  assert.equal(b.extreme, 40);
  assert.ok(Math.abs(b.tailCorrelation) < 0.5, `got ${b.tailCorrelation}`);
});

test("adjustmentBasis on an empty series reports zero rate rather than dividing by zero", () => {
  const b = adjustmentBasis([]);
  assert.equal(b.extremeRate, 0);
  assert.equal(b.tailCorrelation, null);
});

test("compound charges its cost once per period, not once overall", () => {
  // Ten flat periods at 1% cost must land at 0.99^10, not at 0.99.
  const got = compound(new Array(10).fill(0), 0.01);
  assert.ok(Math.abs(got - (Math.pow(0.99, 10) - 1)) < 1e-12);
});

test("compound with no cost reproduces plain geometric compounding", () => {
  assert.ok(Math.abs(compound([0.1, 0.1]) - 0.21) < 1e-12);
});
