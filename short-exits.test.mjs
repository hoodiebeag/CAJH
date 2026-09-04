/**
 * short-exits.test.mjs — the short exit path, tested as a REFLECTION of the long one.
 *
 * Mirroring is the kind of code where a sign error produces plausible numbers rather than a crash,
 * so testing each short rule in isolation would not be enough. Every test here builds a price
 * series and its mirror image about the entry price, runs a long on one and a short on the other,
 * and asserts the two return the same R. A flipped comparison, a max() where a min() belongs, or a
 * stop that loosens instead of tightening all break that equality; none of them would show up as
 * an exception.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { backtestMultiTF } from "./backtest.js";

const DAY = 86400;
const bar = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });

/** A path of closes, with each bar's range hugging its close. */
const pathBars = (closes, pad = 0.5) =>
  closes.map((c, i) => bar(i * DAY, c, c + pad, c - pad, c));

/** The same path reflected about `axis`, so a long's gain becomes a short's identical gain. */
const mirror = (closes, axis) => closes.map((c) => 2 * axis - c);

const BASE = { entryTf: "1440", alignMode: "none", trendGate: false, minStopPct: 0,
               maxStopPct: 1, feeRate: 0, slipPct: 0, n: 3,
               // Short enough that a position which never hits a stop or target still CLOSES on
               // the timeout. With a hold longer than the series the trade stays open and every
               // assertion below compares zero against zero.
               maxHold: 25 };

/**
 * Build a long run and its mirrored short run over the same shape. The entry is a "bos" pivot, so
 * the long path needs a swing LOW and the mirrored short path gets the swing HIGH for free.
 */
function pair(shape, opts) {
  const longCloses = shape;
  const axis = shape[0];
  const shortCloses = mirror(shape, axis);
  const run = (closes, direction) => backtestMultiTF(
    { series: [{ label: "1440", mins: 1440, candles: pathBars(closes) }] },
    { ...BASE, ...opts, entryMode: "bos", direction });
  return { long: run(longCloses, "long"), short: run(shortCloses, "short") };
}

// A dip to a swing low, a run up, a pullback, then a further run. Enough shape to exercise a
// breakeven lock, a trailing stop, a partial and a structural exit.
const SHAPE = [
  100, 98, 96, 94, 92, 90, 88, 86, 88, 92,   // swing low at 86, confirmed on the way up
  96, 100, 106, 112, 118, 124, 130, 128, 124, 120,
  126, 134, 142, 150, 158, 152, 146, 140, 134, 128,
  ...Array.from({ length: 30 }, (_, i) => 128 - i),
];

test("the mirrored scenario produces a trade on both sides, or the rest proves nothing", () => {
  const { long, short } = pair(SHAPE, { tpR: 100, lockBreakeven: false });
  assert.ok(long.trades > 0, "the long side must trade");
  assert.equal(short.trades, long.trades, "and the mirror must trade the same number of times");
});

test("the breakeven lock behaves identically long and short", () => {
  const { long, short } = pair(SHAPE, { tpR: 100, lockBreakeven: true, beTriggerR: 2, beLockR: 0.2, feeBufferPct: 0 });
  assert.ok(Math.abs(long.totalR - short.totalR) < 1e-9, `${long.totalR} vs ${short.totalR}`);
  assert.deepEqual(long.exits, short.exits, "and must exit for the same reasons");
});

test("the trailing stop behaves identically long and short", () => {
  const { long, short } = pair(SHAPE, { tpR: 100, lockBreakeven: false, trailR: 2, trailStartR: 1 });
  assert.ok(Math.abs(long.totalR - short.totalR) < 1e-9, `${long.totalR} vs ${short.totalR}`);
  assert.deepEqual(long.exits, short.exits);
});

test("a trailing stop only ever tightens -- a mirrored max() would loosen it", () => {
  // The specific failure this guards: using Math.max on a short's stop would raise it away from
  // price on every bar, so the position could never be stopped out by the trail at all.
  const { short } = pair(SHAPE, { tpR: 100, lockBreakeven: false, trailR: 1, trailStartR: 0.5 });
  const untrailed = pair(SHAPE, { tpR: 100, lockBreakeven: false }).short;
  assert.notEqual(short.totalR, untrailed.totalR, "a tight trail must change a short's outcome");
  assert.ok(short.exits["trail/be"] > 0, "and it must actually fire");
});

test("the partial scale-out behaves identically long and short", () => {
  const opts = { tpR: 100, lockBreakeven: false, partialAtR: 2, partialFrac: 0.5 };
  const { long, short } = pair(SHAPE, opts);
  assert.ok(Math.abs(long.totalR - short.totalR) < 1e-9, `${long.totalR} vs ${short.totalR}`);
  // `exits` records only the leg that CLOSES a position, so a partial never appears in it. The
  // proof that it fired is that banking half the position changed the result.
  const whole = pair(SHAPE, { tpR: 100, lockBreakeven: false });
  assert.notEqual(long.totalR, whole.long.totalR, "the partial has to fire for this to mean anything");
  assert.notEqual(short.totalR, whole.short.totalR, "and it has to fire on the short side too");
});

test("the trailing take-profit fires on a bounce for a short, as it fires on a pullback for a long", () => {
  // This rule CANNOT mirror exactly and the test must not pretend otherwise: trailingTpPct is a
  // percentage OF PRICE, so an 8% pullback from a peak of 158 is 12.6 points while an 8% bounce
  // from the mirrored trough of 42 is 3.4. The mirror is exact in R only for rules expressed in R.
  const { long, short } = pair(SHAPE, { tpR: 100, lockBreakeven: false, trailingTpPct: 0.08 });
  assert.ok(long.exits.trailingTp > 0, "the long side must exit on a pullback");
  assert.ok(short.exits.trailingTp > 0, "and the short side on a bounce");
  assert.ok(long.totalR > 0 && short.totalR > 0, "both must bank the run rather than give it back");
});

test("a tighter trailing take-profit exits a short sooner, in the right direction", () => {
  const loose = pair(SHAPE, { tpR: 100, lockBreakeven: false, trailingTpPct: 0.20 }).short;
  const tight = pair(SHAPE, { tpR: 100, lockBreakeven: false, trailingTpPct: 0.02 }).short;
  assert.ok(tight.totalR < loose.totalR, `a 2% bounce must cut the run shorter than a 20% one: ${tight.totalR} vs ${loose.totalR}`);
});

test("the structural exit takes a swing high for a long and a swing low for a short", () => {
  const { long, short } = pair(SHAPE, { tpR: 100, lockBreakeven: false, exitOnSwingHigh: true });
  assert.ok(Math.abs(long.totalR - short.totalR) < 1e-9, `${long.totalR} vs ${short.totalR}`);
  assert.ok(long.exits.swingHigh > 0, "the structural exit has to fire");
  assert.deepEqual(long.exits, short.exits);
});

test("every exit rule at once still mirrors exactly", () => {
  const opts = { tpR: 6, lockBreakeven: true, beTriggerR: 2, beLockR: 0.2, feeBufferPct: 0,
                 trailR: 3, trailStartR: 1, partialAtR: 2, partialFrac: 0.5, exitOnSwingHigh: true };
  const { long, short } = pair(SHAPE, opts);
  assert.ok(Math.abs(long.totalR - short.totalR) < 1e-9, `${long.totalR} vs ${short.totalR}`);
  assert.deepEqual(long.exits, short.exits);
  assert.ok(long.trades > 0);
});

test("a short pays cost rather than collecting it", () => {
  // Cost is a percentage of notional, so like trailingTpPct it does not mirror exactly across a
  // reflected price path. What must hold is the sign: both sides pay.
  const opts = { tpR: 100, lockBreakeven: false, feeRate: 0.008, slipPct: 0.0005 };
  const { long, short } = pair(SHAPE, opts);
  const free = pair(SHAPE, { tpR: 100, lockBreakeven: false });
  assert.ok(short.totalR < free.short.totalR, "a short must pay cost, not collect it");
  assert.ok(long.totalR < free.long.totalR, "and so must a long");
});

test("the two entry-side conditions that are still long-only are refused, not ignored", () => {
  const series = [{ label: "1440", mins: 1440, candles: pathBars(SHAPE) }];
  for (const opt of ["requireHigherLow", "minRoomR"]) {
    assert.throws(() => backtestMultiTF({ series },
      { ...BASE, entryMode: "bos", direction: "short", [opt]: opt === "minRoomR" ? 2 : true }),
      /does not implement requireHigherLow or minRoomR/);
  }
});
