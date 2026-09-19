import { test } from "node:test";
import assert from "node:assert";
import { bullishFVGs, bearishFVGs, inverseFVGs, FVG_SIGNALS } from "./fvg.mjs";

const bar = (low, high, close = (low + high) / 2) => ({ low, high, close, open: close, volume: 1 });

test("a bullish FVG needs bar i's LOW above bar i-2's HIGH, not merely a rising close", () => {
  // Overlapping bars are not a gap however strongly they trend. This is the whole definition and
  // getting it loose would fire the detector on ordinary upward drift.
  const gap = [bar(10, 12), bar(11, 14), bar(13, 16)];      // low 13 > high 12
  assert.deepEqual(bullishFVGs(gap), [2]);
  const overlap = [bar(10, 12), bar(11, 14), bar(12, 16)];  // low 12 is NOT above high 12
  assert.deepEqual(bullishFVGs(overlap), []);
});

test("a bearish FVG is the mirror and the two never fire on the same bar", () => {
  const down = [bar(14, 16), bar(11, 15), bar(8, 13)];      // high 13 < low 14
  assert.deepEqual(bearishFVGs(down), [2]);
  assert.deepEqual(bullishFVGs(down), []);
});

test("the first two bars can never complete a gap", () => {
  // A three-bar pattern has no instance before index 2; an off-by-one here would read candles[-1].
  assert.deepEqual(bullishFVGs([bar(10, 12), bar(20, 22)]), []);
  assert.deepEqual(bearishFVGs([bar(20, 22), bar(10, 12)]), []);
});

test("an inverse FVG returns the bar that INVERTS, never the bar that formed the gap", () => {
  // Using the formation bar would be reading the future: at formation nobody knows it will invert.
  const c = [bar(10, 12), bar(11, 14), bar(13, 16), bar(13, 16, 15), bar(8, 14, 11)];
  // Bullish gap completes at 2 with floor high[0]=12. Bar 4 closes at 11, below 12 -> inverts.
  assert.deepEqual(inverseFVGs(c, "bull"), [4]);
});

test("a gap that is never violated produces no inversion", () => {
  const c = [bar(10, 12), bar(11, 14), bar(13, 16), bar(14, 17, 16), bar(15, 18, 17)];
  assert.deepEqual(inverseFVGs(c, "bull"), []);
});

test("lookahead bounds how long a gap stays live", () => {
  // Without a bound, a gap from years earlier could fire on unrelated price action.
  const c = [bar(10, 12), bar(11, 14), bar(13, 16)];
  for (let i = 0; i < 40; i++) c.push(bar(14, 17, 16));
  c.push(bar(8, 14, 11));                                    // violates, but far away
  assert.deepEqual(inverseFVGs(c, "bull", 5), [], "beyond lookahead the gap is dead");
  assert.equal(inverseFVGs(c, "bull", 100).length, 1);
});

test("inversion fires once per gap, not on every later bar below the level", () => {
  const c = [bar(10, 12), bar(11, 14), bar(13, 16), bar(8, 14, 11), bar(7, 13, 10), bar(6, 12, 9)];
  assert.equal(inverseFVGs(c, "bull").length, 1);
});

test("ifvgBull is driven by a BEARISH gap inverting, and vice versa", () => {
  // The polarity flip is the entire point of an inverse FVG; wiring it straight through would make
  // ifvgBull a duplicate of fvgBull and the family would silently contain two copies of one test.
  const down = [bar(14, 16), bar(11, 15), bar(8, 13), bar(9, 15, 14), bar(10, 18, 17)];
  assert.ok(FVG_SIGNALS.ifvgBull(down).length > 0, "a bearish gap closing back above its ceiling is a bullish signal");
  assert.deepEqual(FVG_SIGNALS.fvgBull(down), []);
});
