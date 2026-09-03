import assert from "node:assert/strict";
import test from "node:test";
import { simulateEquity, leaderboard, DEFAULTS } from "./equity.mjs";

const day = 86400000, t0 = Date.parse("2023-01-01");
const series = (rs) => rs.map((r, i) => ({ netR: r, entryTime: t0 + i * day }));

test("a zero-expectancy series ends near where it started", () => {
  const r = simulateEquity(series(Array.from({ length: 400 }, (_, i) => (i % 2 ? 1 : -1))), { riskPct: 0.01 });
  assert.ok(Math.abs(r.finalBalance - 1000) < 30, `got ${r.finalBalance}`);
});

test("order decides the outcome, so trades without an entry time are refused", () => {
  assert.throws(() => simulateEquity([{ netR: 1 }]), /entryTime/);
  assert.throws(() => simulateEquity([{ entryTime: t0 }]), /netR/);
});

test("trades are replayed in time order regardless of input order", () => {
  const shuffled = [
    { netR: -1, entryTime: t0 + 2 * day }, { netR: 2, entryTime: t0 }, { netR: -1, entryTime: t0 + day },
  ];
  const r = simulateEquity(shuffled, { riskPct: 0.1 });
  assert.equal(r.firstTrade, "2023-01-01");
  assert.equal(r.curve.length, 3);
  assert.ok(r.curve[0].balance > 1000, "the +2R trade came first chronologically");
});

test("compounding beats fixed-dollar sizing on a winner and is gentler on a loser", () => {
  const win = series(Array.from({ length: 300 }, (_, i) => (i % 2 ? 1.1 : -0.9)));
  const lose = series(Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.9 : -1.1)));
  assert.ok(simulateEquity(win, { riskPct: 0.02 }).finalBalance >
            simulateEquity(win, { riskPct: 0.02, fixedFractional: false }).finalBalance);
  assert.ok(simulateEquity(lose, { riskPct: 0.02 }).finalBalance >
            simulateEquity(lose, { riskPct: 0.02, fixedFractional: false }).finalBalance);
});

test("a destroyed account reports effectivelyRuined even though it never reaches zero", () => {
  // Fixed-fractional sizing halves what is left; it approaches zero without arriving. Reporting
  // only the mathematical flag would call a 8.9e-13 balance solvent.
  const r = simulateEquity(series(Array(50).fill(-1)), { riskPct: 0.5 });
  assert.equal(r.ruined, false, "mathematically it never hits zero");
  assert.equal(r.effectivelyRuined, true);
  assert.ok(r.effectivelyRuinedAt);
  assert.ok(r.finalBalance > 0 && r.finalBalance < 1);
});

test("a loss larger than the account does hit true zero and stops", () => {
  // -3R at 50% risk loses 150% of the account. riskPct 1.0 is refused by validation, so the
  // loss has to exceed the fraction rather than the fraction reaching 1.
  const r = simulateEquity(series([-3, 1, 1]), { riskPct: 0.5 });
  assert.equal(r.ruined, true);
  assert.equal(r.finalBalance, 0);
  assert.equal(r.curve.length, 1, "simulation stops at ruin rather than trading a negative account");
});

test("drawdown is measured from the running peak, not the start", () => {
  const r = simulateEquity(series([5, -2]), { riskPct: 0.1 });
  assert.ok(r.maxDrawdownPct > 0 && r.maxDrawdownPct < 50);
  assert.ok(r.finalBalance > 1000, "still up overall despite the drawdown");
});

test("bad sizing parameters are rejected rather than silently clamped", () => {
  assert.throws(() => simulateEquity(series([1]), { riskPct: 0 }), /riskPct/);
  assert.throws(() => simulateEquity(series([1]), { riskPct: 1 }), /riskPct/);
  assert.throws(() => simulateEquity(series([1]), { startingBalance: 0 }), /startingBalance/);
});

test("the leaderboard carries how many configurations produced its winner", () => {
  // The denominator is the point: best-of-400 and best-of-3 are different claims.
  const lb = leaderboard([{ finalBalance: 900 }, { finalBalance: 2500 }, { finalBalance: 1100 }], { runsTested: 400 });
  assert.equal(lb.best.finalBalance, 2500);
  assert.equal(lb.runsTested, 400);
  assert.match(lb.selectionNote, /Best of 400 configurations/);
  assert.match(lb.selectionNote, /not as evidence/);
});

test("defaults are the stated experiment: $1000 and 0.5% risk", () => {
  assert.equal(DEFAULTS.startingBalance, 1000);
  assert.equal(DEFAULTS.riskPct, 0.005);
});
