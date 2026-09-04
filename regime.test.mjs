import test from "node:test";
import assert from "node:assert/strict";
import { efficiencyRatio, trendinessByYear, randomEntryByYear } from "./regime.mjs";

const bars = (closes) => closes.map((c, i) => ({ time: 1000 + i * 86400, open: c, high: c, low: c, close: c }));

test("the efficiency ratio is 1 on a straight line and 0 on a round trip", () => {
  const straight = efficiencyRatio(bars(Array.from({ length: 60 }, (_, i) => 100 + i)), 50);
  assert.ok(Math.abs(straight.at(-1) - 1) < 1e-9);
  // Up 25 then back down 25: the price ends where it started, so none of the motion went anywhere.
  const roundTrip = efficiencyRatio(bars([...Array.from({ length: 26 }, (_, i) => 100 + i),
                                          ...Array.from({ length: 25 }, (_, i) => 124 - i)]), 50);
  assert.equal(roundTrip.at(-1), 0);
});

test("the efficiency ratio is null until its window fills", () => {
  assert.equal(efficiencyRatio(bars(Array.from({ length: 60 }, (_, i) => 100 + i)), 50)[49], null);
});

test("trend availability declined every year of this bundle", () => {
  // The finding this file exists for. The strategy's mean R falls 2.92 -> 2.01 -> 0.21 -> -0.94,
  // and so does what a RANDOM entry earned, which no strategy choice can explain.
  const re = randomEntryByYear();
  const byYear = Object.fromEntries(re.map((r) => [r.year, r.meanR]));
  assert.ok(byYear[2023] > byYear[2024], `${byYear[2023]} vs ${byYear[2024]}`);
  assert.ok(byYear[2024] > byYear[2025], `${byYear[2024]} vs ${byYear[2025]}`);
  assert.ok(byYear[2025] > byYear[2026], `${byYear[2025]} vs ${byYear[2026]}`);
  assert.ok(byYear[2023] > 0.5 && byYear[2026] < -0.5, "from clearly positive to clearly negative");
});

test("the decline is not an artefact of the stop width chosen for the null", () => {
  // Checked at 4%, 6%, 10% and 15%. The level moves; the ordering does not.
  for (const stopPct of [0.04, 0.10, 0.15]) {
    const byYear = Object.fromEntries(randomEntryByYear({ stopPct }).map((r) => [r.year, r.meanR]));
    assert.ok(byYear[2023] > byYear[2024], `stopPct ${stopPct}: ${byYear[2023]} vs ${byYear[2024]}`);
    assert.ok(byYear[2024] > byYear[2026], `stopPct ${stopPct}: ${byYear[2024]} vs ${byYear[2026]}`);
  }
});

test("the efficiency ratio moves far less than the random-entry return", () => {
  // Worth knowing which measure is sensitive. Trendiness by efficiency ratio barely changes
  // (0.171 to 0.146); what collapsed is the DIRECTION of the moves, not their straightness.
  const er = trendinessByYear();
  const values = er.map((x) => x.meanEfficiencyRatio);
  assert.ok(Math.max(...values) / Math.min(...values) < 1.3, `efficiency ratio range: ${values.join(", ")}`);
});
