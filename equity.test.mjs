import assert from "node:assert/strict";
import test from "node:test";
import { riskMatchedRiskPct, simulateEquity, leaderboard, DEFAULTS } from "./equity.mjs";

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

test("volatility targeting sizes a quiet instrument up and a wild one down", () => {
  const t = (atrPct, at) => ({ netR: 1, entryTime: at, atrPct, symbol: "X" });
  const quiet = simulateEquity([t(0.02, 1)], { volTarget: 0.04, startingBalance: 1000, riskPct: 0.01 });
  const wild = simulateEquity([t(0.08, 1)], { volTarget: 0.04, startingBalance: 1000, riskPct: 0.01 });
  const flatSized = simulateEquity([t(0.02, 1)], { startingBalance: 1000, riskPct: 0.01 });
  assert.equal(flatSized.finalBalance, 1010);
  assert.equal(quiet.finalBalance, 1020, "0.04/0.02 = 2x the base risk");
  assert.equal(wild.finalBalance, 1005, "0.04/0.08 = half the base risk");
});

test("the volatility clamp stops a quiet pair sizing up without bound", () => {
  // A pair whose ATR is 0.1% of price would be sized 40x the base risk on the strength of one
  // quiet stretch. Quiet and safe are different words.
  const r = simulateEquity([{ netR: 1, entryTime: 1, atrPct: 0.001 }],
    { volTarget: 0.04, volClamp: 3, startingBalance: 1000, riskPct: 0.01 });
  assert.equal(r.finalBalance, 1030, "clamped to 3x, not 40x");
});

test("volatility targeting refuses to run on trades that carry no volatility", () => {
  assert.throws(() => simulateEquity([{ netR: 1, entryTime: 1 }], { volTarget: 0.04 }),
    /needs atrPct on every trade/);
});

test("volTarget null reproduces the original sizing exactly", () => {
  const trades = [{ netR: 2, entryTime: 1, atrPct: 0.9 }, { netR: -1, entryTime: 2, atrPct: 0.01 }];
  const a = simulateEquity(trades, { startingBalance: 1000, riskPct: 0.01 });
  const b = simulateEquity(trades.map(({ netR, entryTime }) => ({ netR, entryTime })), { startingBalance: 1000, riskPct: 0.01 });
  assert.equal(a.finalBalance, b.finalBalance);
});

test("risk matching removes leverage from a volatility-targeting comparison", () => {
  // A volTarget above the universe's own volatility scales every bet up, so the balance rises for
  // that reason alone. On the campaign's leader an unmatched sweep reached $16,138 that way.
  const trades = [{ netR: 1, entryTime: 1, atrPct: 0.02 }, { netR: 1, entryTime: 2, atrPct: 0.08 }];
  const matched = riskMatchedRiskPct(trades, { volTarget: 0.10, volClamp: 3, riskPct: 0.005 });
  const weights = trades.map((t) => Math.min(3, Math.max(1 / 3, 0.10 / t.atrPct)));
  const meanWeight = (weights[0] + weights[1]) / 2;
  assert.ok(Math.abs(matched * meanWeight - 0.005) < 1e-12, "mean deployed risk must come back to riskPct");
  assert.ok(matched < 0.005, "a volTarget above the universe's volatility must be scaled DOWN to match");
});

test("risk matching is the identity when volatility targeting is off", () => {
  assert.equal(riskMatchedRiskPct([{ netR: 1, entryTime: 1 }], { volTarget: null, riskPct: 0.005 }), 0.005);
});

test("a concurrency limit declines a signal when the book is already full", () => {
  const day = 86400000;
  const t = (at, hold, r = 1) => ({ netR: r, entryTime: at * day, exitTime: (at + hold) * day });
  // Three overlapping trades, room for two. The third is declined, not silently dropped.
  const r = simulateEquity([t(1, 10), t(2, 10), t(3, 10)], { maxConcurrent: 2, startingBalance: 1000, riskPct: 0.01 });
  assert.equal(r.trades, 2);
  assert.equal(r.declinedForConcurrency, 1);
  assert.equal(r.peakConcurrent, 2);
});

test("a position that has already closed frees its slot", () => {
  const day = 86400000;
  const t = (at, hold) => ({ netR: 1, entryTime: at * day, exitTime: (at + hold) * day });
  const r = simulateEquity([t(1, 2), t(10, 2), t(20, 2)], { maxConcurrent: 1, startingBalance: 1000, riskPct: 0.01 });
  assert.equal(r.trades, 3, "sequential trades never compete for the same slot");
  assert.equal(r.declinedForConcurrency, 0);
});

test("a concurrency limit refuses to run on trades with no exit time", () => {
  assert.throws(() => simulateEquity([{ netR: 1, entryTime: 1 }], { maxConcurrent: 5 }),
    /needs exitTime on every trade/);
});

test("maxConcurrent null reproduces the original behaviour and reports no peak", () => {
  const r = simulateEquity([{ netR: 1, entryTime: 1 }, { netR: -1, entryTime: 2 }], { startingBalance: 1000, riskPct: 0.01 });
  assert.equal(r.trades, 2);
  assert.equal(r.declinedForConcurrency, 0);
  assert.equal(r.peakConcurrent, null);
});
