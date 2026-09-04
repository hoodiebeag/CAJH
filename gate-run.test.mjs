import test from "node:test";
import assert from "node:assert/strict";
import { shapeOf } from "./gate-run.mjs";
import { breakevenWinRate } from "./promotion.mjs";

test("a 40% win rate is profitable or ruinous depending entirely on the payoff", () => {
  // The reason win rate cannot be an acceptance criterion on its own. Same hit rate, opposite
  // outcomes, and only the payoff ratio distinguishes them.
  const at = (win, loss) => shapeOf([...Array(40).fill(win), ...Array(60).fill(-loss)]);
  const rich = at(3, 1), poor = at(1, 1);
  assert.equal(rich.winRate, 0.4);
  assert.equal(poor.winRate, 0.4);
  assert.ok(rich.mean > 0, `3:1 at 40% earns ${rich.mean}R`);
  assert.ok(poor.mean < 0, `1:1 at 40% loses ${poor.mean}R`);
});

test("breakeven win rate is 1/(1+payoff), and 40% clears a 2.89:1 payoff easily", () => {
  assert.ok(Math.abs(breakevenWinRate(1) - 0.5) < 1e-12, "an even-money bet needs half");
  assert.ok(Math.abs(breakevenWinRate(1.5) - 0.4) < 1e-12, "40% is exactly breakeven at 1.5:1");
  const needed = breakevenWinRate(2.89);
  assert.ok(needed > 0.25 && needed < 0.26, `a 2.89:1 payoff breaks even at ${needed}`);
});

test("shapeOf reports the standard deviation the power calculation needs", () => {
  // Per-trade R spread is what makes low-frequency strategies expensive to confirm: at sd 2.75,
  // detecting a quarter-R edge takes on the order of a thousand independent trades.
  const s = shapeOf([3, -1, 3, -1, -1, -1, 3, -1, -1, -1]);
  assert.equal(s.n, 10);
  assert.ok(s.sd > 1.5, `spread must be reported, got ${s.sd}`);
  assert.equal(s.payoff, 3);
});

test("a losing set still reports a payoff rather than dividing by zero", () => {
  assert.equal(shapeOf([-1, -1, -1]).payoff, 0, "no wins means a zero payoff, not NaN");
  assert.equal(shapeOf([2, 2]).payoff, null, "no losses means the ratio is undefined, not Infinity");
});
