import test from "node:test";
import assert from "node:assert/strict";
import { benchmarks, benchmarkLine } from "./benchmark.mjs";

const WINDOW = { from: "2023-01-01", to: "2026-03-31" };

test("buy-and-hold is computed over the same universe the strategy trades", () => {
  const b = benchmarks(WINDOW);
  assert.ok(b.pairsUsed >= 25, `expected the full bundle, got ${b.pairsUsed}`);
  assert.ok(b.btc > 0);
  assert.ok(b.basket > 0);
});

test("BTC beat the campaign's best config as of sweep3 -- the reason this file exists", () => {
  // If this ever fails because BTC's number moved, the data changed; if it fails because the
  // constant moved, someone edited the benchmark to flatter a strategy. Either is worth a stop.
  const b = benchmarks(WINDOW);
  assert.ok(b.btc > 4000 && b.btc < 4200, `BTC buy-and-hold moved: ${b.btc}`);
  assert.ok(b.btc > 2889.62, "the sweep3 leader must still be below buy-and-hold BTC");
});

test("rows carry bars and start, so a late-starting pair is visible not buried", () => {
  const b = benchmarks(WINDOW);
  const late = b.rows.find((r) => r.start === "2025-01-22");
  assert.ok(late, "expected the nine pairs that begin 2025-01-22");
  assert.ok(late.bars < 500);
});

test("benchmarkLine states the starting balance so a ratio cannot be misread", () => {
  assert.match(benchmarkLine(benchmarks(WINDOW)), /from \$1000/);
});
