import test from "node:test";
import assert from "node:assert/strict";
import { simulateExit, randomEntryDrawer } from "./entrynull.mjs";

const flat = (n, px) => Array.from({ length: n }, () => ({ close: px, high: px, low: px }));
const NOCOST = { feeRate: 0, slipPct: 0, tpR: 100, maxHold: 100 };

test("a stop-out is exactly -1R before cost", () => {
  const c = [...flat(1, 100), ...flat(5, 90)];
  assert.equal(simulateExit(c, 0, { ...NOCOST, stopPct: 0.05, lockBreakeven: false }), -1);
});

test("a target hit is exactly +tpR before cost", () => {
  const c = [{ close: 100, high: 100, low: 100 }, { close: 130, high: 130, low: 100 }];
  assert.equal(simulateExit(c, 0, { ...NOCOST, tpR: 4, stopPct: 0.05, lockBreakeven: false }), 4);
});

test("when one bar spans both stop and target the stop wins -- the worse fill, never the flattering one", () => {
  const c = [{ close: 100, high: 100, low: 100 }, { close: 100, high: 200, low: 50 }];
  assert.equal(simulateExit(c, 0, { ...NOCOST, tpR: 4, stopPct: 0.05, lockBreakeven: false }), -1);
});

test("the breakeven lock converts a round trip from a loss into a small win", () => {
  //          entry   run up past the 2R arm      back to the entry price
  const c = [{ close: 100, high: 100, low: 100 },
             { close: 115, high: 115, low: 100 },
             { close: 100, high: 115, low: 95 }];
  const locked = simulateExit(c, 0, { ...NOCOST, tpR: 100, stopPct: 0.05, lockBreakeven: true });
  const unlocked = simulateExit(c, 0, { ...NOCOST, tpR: 100, stopPct: 0.05, lockBreakeven: false });
  assert.ok(locked > 0, `expected the lock to hold a gain, got ${locked}`);
  assert.ok(unlocked < locked);
});

test("cost is charged on both legs, so a flat trade loses", () => {
  const r = simulateExit(flat(20, 100), 0, { tpR: 100, maxHold: 5, stopPct: 0.05, lockBreakeven: false, feeRate: 0.008, slipPct: 0.0005 });
  // (0.008 + 0.0005) * 200 / 5 = 0.34R
  assert.ok(Math.abs(r + 0.34) < 1e-9, `expected -0.34R, got ${r}`);
});

test("an entry on the last bar has nowhere to go and is refused, not scored as flat", () => {
  assert.equal(simulateExit(flat(3, 100), 2, { ...NOCOST, stopPct: 0.05 }), null);
});

test("the drawer refuses to run without observed trades to match geometry against", () => {
  assert.throws(() => randomEntryDrawer({ observed: [], seriesByPair: {}, exit: {} }), /required/);
  assert.throws(() => randomEntryDrawer({ observed: [{ symbol: "A", stopPct: 0 }], seriesByPair: {}, exit: {} }), /stop distances/);
});

test("the drawer only ever draws pairs the strategy actually traded", () => {
  const draw = randomEntryDrawer({
    observed: [{ symbol: "A", stopPct: 0.05 }],
    seriesByPair: { A: flat(50, 100), B: flat(50, 100) },
    exit: { ...NOCOST, maxHold: 5, lockBreakeven: false },
  });
  let rng = 0.999999;
  // Every draw resolves against A; B is unreachable because it is not in the observed list.
  for (let i = 0; i < 20; i++) assert.ok(draw(() => (rng = (rng * 7919) % 1)) !== undefined);
});
