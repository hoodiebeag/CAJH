import { test } from "node:test";
import assert from "node:assert";
import { parseFundingCsv, bucketFunding, trailingFunding, screenFunding, fundingGrid, legFundingReturns } from "./funding.mjs";

const DAY = 86400, H8 = 8 * 3600;
const csv = rows => "symbol,fundingTime,fundingRate\n" + rows.map(r => r.join(",")).join("\n");

test("parseFundingCsv converts ms to seconds and sorts", () => {
  const r = parseFundingCsv(csv([["X", 3000, "0.3"], ["X", 1000, "0.1"], ["X", 2000, "0.2"]]));
  assert.deepEqual(r, [{ time: 1, rate: 0.1 }, { time: 2, rate: 0.2 }, { time: 3, rate: 0.3 }]);
});

test("parseFundingCsv drops malformed rows rather than reading them as zero", () => {
  // A NaN rate is a data defect. Substituting zero would invent a period of no funding, which is a
  // real economic claim, and a false one.
  const r = parseFundingCsv(csv([["X", 1000, "0.1"], ["X", 2000, "oops"], ["X", "", "0.3"]]));
  assert.deepEqual(r.map(x => x.time), [1]);
});

test("parseFundingCsv keeps the first of a duplicated timestamp", () => {
  const r = parseFundingCsv(csv([["X", 1000, "0.1"], ["X", 1000, "0.9"]]));
  assert.equal(r.length, 1);
  assert.equal(r[0].rate, 0.1);
});

test("bucketFunding SUMS the settlements inside a bar, it does not average them", () => {
  // Three 0.01% settlements in a day cost 0.03%. Funding is a payment, not a rate to be averaged.
  const bars = [1 * DAY, 2 * DAY];
  const recs = [
    { time: 1 * DAY - 2 * H8, rate: 0.01 }, { time: 1 * DAY - H8, rate: 0.01 }, { time: 1 * DAY, rate: 0.01 },
    { time: 2 * DAY, rate: 0.05 },
  ];
  const { perBar } = bucketFunding(recs, bars);
  assert.ok(Math.abs(perBar[0] - 0.03) < 1e-12, `got ${perBar[0]}`);
  assert.ok(Math.abs(perBar[1] - 0.05) < 1e-12);
});

test("bucketFunding puts a settlement at exactly the bar time INSIDE that bar", () => {
  // The boundary that decides whether a number is knowable when the bar closes. Half-open (lo, hi].
  const bars = [1 * DAY, 2 * DAY];
  const { perBar } = bucketFunding([{ time: 1 * DAY, rate: 7 }], bars);
  assert.equal(perBar[0], 7);
  assert.equal(perBar[1], 0);
  const later = bucketFunding([{ time: 1 * DAY + 1, rate: 7 }], bars);
  assert.equal(later.perBar[0], 0, "one second after the bar close belongs to the NEXT bar");
  assert.equal(later.perBar[1], 7);
});

test("bucketFunding reports which bars actually had a settlement", () => {
  // Distinguishes a genuine zero from an absent record. Both look like 0 in perBar; only `covered`
  // separates them, and that is what the screen reasons about.
  const bars = [1 * DAY, 2 * DAY, 3 * DAY];
  const { perBar, covered } = bucketFunding([{ time: 1 * DAY, rate: 0 }, { time: 3 * DAY, rate: 0.1 }], bars);
  assert.deepEqual(perBar, [0, 0, 0.1]);
  assert.deepEqual(covered, [true, false, true]);
});

test("bucketFunding ignores records before the first bar", () => {
  const bars = [5 * DAY, 6 * DAY];
  const { perBar } = bucketFunding([{ time: 1 * DAY, rate: 99 }, { time: 5 * DAY, rate: 1 }], bars);
  assert.deepEqual(perBar, [1, 0]);
});

test("trailingFunding excludes the current bar", () => {
  // The no-lookahead guarantee, stated as a test. Ranking at bar i may use funding through i-1 and
  // not a tick more -- bar i's settlement had not happened when the decision was made.
  const perBar = [1, 2, 3, 100];
  assert.equal(trailingFunding(perBar, 3, 3), 2);        // (1+2+3)/3, NOT touching the 100
  assert.equal(trailingFunding(perBar, 2, 2), 1.5);      // (1+2)/2
});

test("trailingFunding returns null rather than a short window", () => {
  // Averaging three observations where thirty were asked for is how a symbol ranks at an extreme
  // for reasons that are pure coverage.
  assert.equal(trailingFunding([1, 2, 3], 2, 5), null);
  assert.equal(trailingFunding([1, 2, 3], 0, 1), null);
  assert.equal(trailingFunding([1, 2, 3], 2, 0), null);
});

test("screenFunding rejects a series too short to rank on", () => {
  const bars = Array.from({ length: 100 }, (_, i) => (i + 1) * DAY);
  const many = Array.from({ length: 300 }, (_, i) => ({ time: (i + 1) * DAY, rate: 0.01 }));
  const { kept, rejected } = screenFunding({ good: many, thin: many.slice(0, 10) }, bars);
  assert.ok("good" in kept);
  assert.ok(!("thin" in kept));
  assert.match(rejected.find(r => r[0] === "thin")[1], /only 10 funding records/);
});

test("screenFunding rejects a series that covers too few bars", () => {
  // A perpetual listed halfway through the sample has plenty of records and still cannot be ranked
  // across the window.
  const bars = Array.from({ length: 400 }, (_, i) => (i + 1) * DAY);
  const late = Array.from({ length: 250 }, (_, i) => ({ time: (i + 151) * DAY, rate: 0.01 }));
  const { kept, rejected } = screenFunding({ late }, bars);
  assert.ok(!("late" in kept));
  assert.match(rejected[0][1], /covers 62\.5% of bars/);
});

test("screenFunding keeps a fully covered series", () => {
  const bars = Array.from({ length: 300 }, (_, i) => (i + 1) * DAY);
  const full = Array.from({ length: 900 }, (_, i) => ({ time: DAY + i * H8, rate: 0.0001 }));
  const { kept, rejected } = screenFunding({ full }, bars);
  assert.deepEqual(Object.keys(kept), ["full"]);
  assert.deepEqual(rejected, []);
});

test("parseFundingCsv rejects an empty field rather than reading it as epoch zero", () => {
  // Number("") is 0, so an empty timestamp passes a Number.isFinite check and lands on 1970-01-01.
  // Pinned because the failure is silent: the row survives, dated 56 years before the sample.
  const r = parseFundingCsv(csv([["X", "", "0.3"], ["X", " ", "0.4"], ["X", 5000, ""], ["X", 6000, "0.6"]]));
  assert.deepEqual(r, [{ time: 6, rate: 0.6 }]);
});

test("fundingGrid aligns every symbol onto one calendar", () => {
  const bars = [1 * DAY, 2 * DAY];
  const g = fundingGrid({ A: [{ time: 1 * DAY, rate: 0.1 }], B: [{ time: 2 * DAY, rate: 0.2 }] }, bars);
  assert.deepEqual(g.A, [0.1, 0]);
  assert.deepEqual(g.B, [0, 0.2]);
});

test("a LONG pays positive funding and a SHORT receives it", () => {
  // The sign that would invert the entire carry result while still drawing a plausible curve.
  const bars = [0, 1 * DAY, 2 * DAY];
  const grid = { A: [0, 0.01, 0.01] };
  const log = [{ at: 0, chosen: ["A"] }, { at: 2 * DAY, chosen: ["A"] }];
  assert.deepEqual(legFundingReturns(log, grid, bars, { side: +1 }), [-0.02]);
  assert.deepEqual(legFundingReturns(log, grid, bars, { side: -1 }), [+0.02]);
});

test("legFundingReturns accrues only over the bars a position is held", () => {
  // Funding before the position opened must not count. The bar of the opening rebalance is
  // excluded and the bar of the closing one is included.
  const bars = [0, 1 * DAY, 2 * DAY, 3 * DAY];
  const grid = { A: [99, 0.01, 0.02, 77] };          // 99 precedes the entry, 77 follows the exit
  const log = [{ at: 0, chosen: ["A"] }, { at: 2 * DAY, chosen: ["A"] }];
  const r = legFundingReturns(log, grid, bars, { side: -1 });
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0] - 0.03) < 1e-12, `got ${r[0]}, expected 0.01+0.02`);
});

test("legFundingReturns equal-weights the names held", () => {
  const bars = [0, 1 * DAY];
  const grid = { A: [0, 0.10], B: [0, 0.00] };
  const log = [{ at: 0, chosen: ["A", "B"] }, { at: 1 * DAY, chosen: ["A", "B"] }];
  assert.deepEqual(legFundingReturns(log, grid, bars, { side: -1 }), [0.05]);
});

test("legFundingReturns treats a name with no funding series as contributing nothing", () => {
  // Not as zero funding across the book -- the other name's funding still counts in full, divided
  // by the number of names actually held.
  const bars = [0, 1 * DAY];
  const grid = { A: [0, 0.10] };
  const log = [{ at: 0, chosen: ["A", "NOPERP"] }, { at: 1 * DAY, chosen: ["A", "NOPERP"] }];
  assert.deepEqual(legFundingReturns(log, grid, bars, { side: -1 }), [0.05]);
});
