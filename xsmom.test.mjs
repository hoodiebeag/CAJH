import test from "node:test";
import assert from "node:assert/strict";
import { formationReturn, runRotation, randomSelectionNull, selectionP } from "./xsmom.mjs";

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
