import test from "node:test";
import assert from "node:assert/strict";
import { formationReturn, runRotation, randomSelectionNull, selectionP, spread, perYear } from "./xsmom.mjs";

const DAY = 86400;
/** A symbol whose close follows `fn(i)`. */
const sym = (n, fn, t0 = 0) =>
  Array.from({ length: n }, (_, i) => ({ time: t0 + i * DAY, open: fn(i), high: fn(i), low: fn(i), close: fn(i), volume: 1 }));

test("formationReturn measures the window and skips the recent bars", () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(0.001 * i));
  const r = formationReturn(closes, 280, 252, 21);
  // log(c[259]/c[28]) = 0.001 * (259-28)
  assert.ok(Math.abs(r - 0.001 * (259 - 28)) < 1e-9);
  assert.equal(formationReturn(closes, 10, 252, 21), null, "not enough history yields null, not a guess");
});

test("the strongest symbol is selected and the weakest is not", () => {
  const strong = sym(400, (i) => 100 * Math.exp(0.002 * i));
  const weak   = sym(400, (i) => 100 * Math.exp(-0.002 * i));
  const flat   = sym(400, () => 100);
  const r = runRotation({ series: { STRONG: strong, WEAK: weak, FLAT: flat },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 });
  const picks = new Set(r.rebalanceLog.flatMap((x) => x.chosen));
  assert.ok(picks.has("STRONG"), "the ranked winner must be held");
  assert.ok(!picks.has("WEAK"), "the ranked loser must never be held");
});

test("selection cannot see the future: a symbol that only rises AFTER the rebalance is not picked", () => {
  // PAST rose during the formation window then went flat. FUTURE was flat, then explodes at 300.
  // A ranking with look-ahead would grab FUTURE; an honest one takes PAST.
  const past   = sym(400, (i) => (i < 280 ? 100 * Math.exp(0.003 * i) : 100 * Math.exp(0.003 * 280)));
  const future = sym(400, (i) => (i < 300 ? 100 : 100 * Math.exp(0.02 * (i - 300))));
  const r = runRotation({ series: { PAST: past, FUTURE: future },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 });
  const first = r.rebalanceLog[0];
  assert.deepEqual(first.chosen, ["PAST"], `first pick was ${first.chosen} — look-ahead in the ranking`);
});

test("turnover cost is charged only on the names actually swapped", () => {
  const rising = (k) => sym(400, (i) => 100 * Math.exp(k * i));
  const series = { A: rising(0.003), B: rising(0.002), C: rising(0.001) };
  const base = { series, lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 2 };
  const free = runRotation({ ...base, slipPct: 0 });
  const paid = runRotation({ ...base, slipPct: 0.01 });
  // The ranking never changes here, so after the first rebalance turnover is zero and the two
  // runs differ only by the initial purchase.
  assert.ok(paid.finalBalance < free.finalBalance, "cost must be charged");
  assert.ok(paid.finalBalance > free.finalBalance * 0.95, "but a stable book must not pay every month");
  assert.ok(paid.avgTurnover < 0.2, `stable rankings mean low turnover, got ${paid.avgTurnover}`);
});

test("symbols are ranked against each other by DATE, not by bar index", () => {
  // LATE starts a year after EARLY. Indexing by position would compare EARLY's year 1 against
  // LATE's first days and rank them as if contemporaneous.
  const early = sym(500, (i) => 100 * Math.exp(0.001 * i), 0);
  const late  = sym(200, (i) => 100 * Math.exp(0.001 * i), 300 * DAY);
  const r = runRotation({ series: { EARLY: early, LATE: late },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 });
  assert.ok(r.rebalances > 0);
  const firstAt = r.rebalanceLog[0].at;
  assert.ok(firstAt >= 252 * DAY, "the first rebalance cannot precede a full formation window");
});

test("the random-selection null spreads around the basket, and p is a fraction of draws", () => {
  const series = Object.fromEntries(
    Array.from({ length: 12 }, (_, k) => [`S${k}`, sym(400, (i) => 100 * Math.exp((0.0005 + k * 0.0002) * i))]));
  const opts = { series, lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 3, slipPct: 0 };
  const r = runRotation(opts);
  const n = randomSelectionNull(opts, { draws: 60 });
  assert.equal(n.finals.length, 60);
  assert.ok(n.p05 <= n.median && n.median <= n.p95, "the null must be ordered");
  const p = selectionP(n, r.finalBalance);
  assert.ok(p > 0 && p <= 1);
  assert.ok(p < 0.2, `ranking a monotone ladder must beat random selection, got p=${p}`);
});

test("drawdown is measured on every bar, not only at rebalances", () => {
  // A symbol that crashes mid-month and recovers by the next rebalance: a snapshot-only drawdown
  // would report nothing.
  const crash = sym(400, (i) => (i === 320 ? 50 : 100 * Math.exp(0.001 * i)));
  const r = runRotation({ series: { A: crash, B: sym(400, (i) => 100 * Math.exp(0.001 * i)) },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 2, slipPct: 0 });
  assert.ok(r.maxDrawdownPct > 5, `mid-period crash must show in the drawdown, got ${r.maxDrawdownPct}%`);
});

test("pick:bottom holds the weakest, the mirror of pick:top", () => {
  const rising = (k) => sym(400, (i) => 100 * Math.exp(k * i));
  const series = { HOT: rising(0.003), MID: rising(0.001), COLD: rising(-0.002) };
  const base = { series, lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 };
  const top = runRotation({ ...base, pick: "top" });
  const bottom = runRotation({ ...base, pick: "bottom" });
  assert.deepEqual([...new Set(top.rebalanceLog.flatMap((x) => x.chosen))], ["HOT"]);
  assert.deepEqual([...new Set(bottom.rebalanceLog.flatMap((x) => x.chosen))], ["COLD"]);
  assert.ok(top.finalBalance > bottom.finalBalance, "the legs must diverge if ranking means anything");
});

test("spread drawdown is marked every bar, not only at rebalances", () => {
  // The error this closes: combining monthly period returns never saw an intra-month low and
  // understated the book's drawdown by 44% -- 10.09% reported against a real 14.57%.
  // Here a symbol dives mid-month and fully recovers by the next rebalance. A monthly-only
  // drawdown reports nothing at all.
  const n = 400;
  const dive = sym(n, (i) => (i === 330 ? 40 : 100 * Math.exp(0.001 * i)));
  const calm = sym(n, (i) => 100 * Math.exp(0.0005 * i));
  const others = Object.fromEntries(
    Array.from({ length: 6 }, (_, k) => [`O${k}`, sym(n, (i) => 100 * Math.exp((0.0002 + k * 0.0001) * i))]));
  const s = spread({ DIVE: dive, CALM: calm, ...others },
    { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 2, slipPct: 0 });
  assert.ok(s.maxDrawdownPct > 1, `an intra-month dive must appear in the drawdown, got ${s.maxDrawdownPct}%`);
});

test("runRotation exposes per-bar returns aligned to its calendar", () => {
  const r = runRotation({ series: { A: sym(400, (i) => 100 * Math.exp(0.001 * i)),
                                    B: sym(400, (i) => 100 * Math.exp(0.0005 * i)) },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 });
  assert.equal(r.barReturns.length, r.times.length, "one return per calendar bar");
  assert.ok(r.barReturns.some((x) => x !== 0), "a held book must produce non-zero bar returns");
});

test("perYear reads the calendar off the timestamps instead of assuming one", () => {
  const DAY = 86400;
  // 21-bar rebalance on a 7-day-a-week market: 365/21 = 17.4 periods a year.
  const crypto = Array.from({ length: 20 }, (_, i) => ({ at: i * 21 * DAY }));
  assert.ok(Math.abs(perYear(crypto) - 365.25 / 21) < 0.01);
  // The same rebalance on a 5-day week: 252/21 = 12.
  const equity = Array.from({ length: 20 }, (_, i) => ({ at: Math.round(i * 21 * (365.25 / 252)) * DAY }));
  assert.ok(Math.abs(perYear(equity) - 12) < 0.05);
});

test("perYear accepts bare timestamps as well as rebalance-log entries", () => {
  const DAY = 86400;
  const bare = Array.from({ length: 366 }, (_, i) => i * DAY);
  assert.ok(Math.abs(perYear(bare) - 365.25) < 1);
});

test("perYear refuses to guess from too little, or from no elapsed time", () => {
  assert.equal(perYear([]), null);
  assert.equal(perYear([{ at: 0 }]), null);
  assert.equal(perYear([{ at: 5 }, { at: 5 }]), null);   // zero span, not an infinite rate
});

test("the SHORT leg's turnover is charged, not credited", () => {
  // Two symbols that swap rank every period, so both legs turn over fully at every rebalance and
  // the cost is unmissable. The bug this pins: a short leg's return enters the spread with a minus
  // sign, so a cost buried inside it arrives as a credit and the two legs' costs nearly cancel.
  const n = 400;
  const zig = (phase) => Array.from({ length: n }, (_, i) => {
    const t = Math.floor(i / 21) % 2 === phase ? 1 : -1;
    return { time: i * 86400, open: 100, high: 100, low: 100, close: 100 * Math.exp(0.002 * t * i), volume: 1 };
  });
  const series = { A: zig(0), B: zig(1) };
  const opts = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1 };
  const free = spread(series, { ...opts, slipPct: 0 }, { borrow: 0 });
  const costly = spread(series, { ...opts, slipPct: 0.01 }, { borrow: 0 });
  assert.ok(costly.finalBalance < free.finalBalance,
    "charging slippage must reduce the result, not leave it unchanged");
  // Both legs turn over, so the drag is roughly 2 * 2 * slip per period, not ~0.
  const drag = Math.log(free.finalBalance / costly.finalBalance) / free.periods;
  assert.ok(drag > 0.02, `expected roughly 4% a period of cost drag, got ${(100 * drag).toFixed(2)}%`);
});

test("periodCosts is the cost alone, and is zero when slippage is zero", () => {
  const n = 400;
  const sym = (rate) => Array.from({ length: n }, (_, i) => ({
    time: i * 86400, open: 100, high: 100, low: 100, close: 100 * Math.exp(rate * i), volume: 1 }));
  const r = runRotation({ series: { A: sym(0.001), B: sym(0.0005), C: sym(0.0002) },
    lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 1, slipPct: 0 });
  assert.ok(r.periodCosts.length > 0);
  assert.ok(r.periodCosts.every((c) => c === 0), "no slippage means no cost");
  assert.equal(r.periodCosts.length, r.periodReturns.length, "one cost per period return");
});
