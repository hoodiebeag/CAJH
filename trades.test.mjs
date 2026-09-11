import { test } from "node:test";
import assert from "node:assert";
import { ledger, summarise } from "./trades.mjs";

const DAY = 86400;
const rot = log => ({ rebalanceLog: log });

test("a name held across rebalances is ONE trade, priced entry to exit", () => {
  const r = rot([
    { at: 0, chosen: ["A"], closes: { A: 100 } },
    { at: 21 * DAY, chosen: ["A"], closes: { A: 110 } },   // still held, not a new trade
    { at: 42 * DAY, chosen: ["B"], closes: { A: 120, B: 50 } },
  ]);
  const { closed } = ledger(r, 1);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].symbol, "A");
  assert.equal(closed[0].entryAt, 0);
  assert.equal(closed[0].exitAt, 42 * DAY);
  assert.ok(Math.abs(closed[0].pct - 20) < 1e-9);
  assert.equal(closed[0].barsHeldDays, 42);
});

test("the short leg wins when the price falls", () => {
  const r = rot([
    { at: 0, chosen: ["A"], closes: { A: 100 } },
    { at: 21 * DAY, chosen: ["B"], closes: { A: 80, B: 10 } },
  ]);
  const [t] = ledger(r, -1).closed;
  assert.equal(t.side, -1);
  assert.ok(t.logReturn > 0, "a 20% fall is a win for a short");
  assert.ok(Math.abs(t.pct - 25) < 1e-9);       // 1/0.8 - 1
});

test("positions still held at the end are reported, not marked as closed", () => {
  const r = rot([
    { at: 0, chosen: ["A", "B"], closes: { A: 100, B: 200 } },
    { at: 21 * DAY, chosen: ["A"], closes: { A: 110, B: 190 } },
  ]);
  const l = ledger(r, 1);
  assert.equal(l.closed.length, 1);             // B was dropped
  assert.equal(l.closed[0].symbol, "B");
  assert.equal(l.stillOpen, 1);                 // A is open and is NOT counted as a trade
});

test("a trade with no price on either end is dropped and counted, not silently lost", () => {
  const r = rot([
    { at: 0, chosen: ["A"], closes: { A: null } },
    { at: 21 * DAY, chosen: ["B"], closes: { A: 120, B: 10 } },
  ]);
  const l = ledger(r, 1);
  assert.equal(l.closed.length, 0);
  assert.equal(l.unpriced, 1);
});

test("the round-trip charge is taken from every trade and can flip a marginal win", () => {
  const trades = [{ pct: 0.5, logReturn: 0.005, barsHeldDays: 21 },
                  { pct: 10, logReturn: 0.095, barsHeldDays: 21 }];
  const gross = summarise(trades, 1);
  assert.equal(gross.winRatePct, 100);
  const net = summarise(trades, 1, { roundTripPct: 1.6 });   // Kraken taker, both ways
  assert.equal(net.winRatePct, 50, "the 0.5% winner does not survive a 1.6% round trip");
  assert.ok(Math.abs(net.expectancyPct - (gross.expectancyPct - 1.6)) < 1e-9);
});

test("payoff ratio and trades-per-month are computed the way the criterion states them", () => {
  const trades = [{ pct: 30, logReturn: 0.26, barsHeldDays: 21 },
                  { pct: -10, logReturn: -0.105, barsHeldDays: 21 },
                  { pct: -10, logReturn: -0.105, barsHeldDays: 21 }];
  const s = summarise(trades, 0.25);            // three months
  assert.equal(s.winRatePct, 33.3);
  assert.equal(s.payoffRatio, 3);               // +30 average win against a -10 average loss
  assert.equal(s.tradesPerMonth, 1);
  assert.ok(Math.abs(s.expectancyPct - 3.333) < 0.001);
});

test("summarise refuses to invent a summary from no trades", () => {
  assert.equal(summarise([], 1), null);
});
