import test from "node:test";
import assert from "node:assert/strict";
import { benchmarks, benchmarkLine } from "./benchmark.mjs";

const WINDOW = { from: "2023-01-01", to: "2026-03-31" };

test("buy-and-hold is computed over the same universe the strategy trades", () => {
  const b = benchmarks(WINDOW);
  assert.ok(b.pairsUsed >= 25, `expected the full bundle, got ${b.pairsUsed}`);
  assert.ok(b.proxy > 0);
  assert.equal(b.proxySymbol, "XBTUSD", "BTC is the proxy for a crypto universe");
  assert.ok(b.basket > 0);
});

test("BTC beat the campaign's best config as of sweep3 -- the reason this file exists", () => {
  // If this ever fails because BTC's number moved, the data changed; if it fails because the
  // constant moved, someone edited the benchmark to flatter a strategy. Either is worth a stop.
  const b = benchmarks(WINDOW);
  assert.ok(b.proxy > 4000 && b.proxy < 4200, `BTC buy-and-hold moved: ${b.proxy}`);
  assert.ok(b.proxy > 2889.62, "the sweep3 leader must still be below buy-and-hold BTC");
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

test("buy-and-hold carries its drawdown, so a lower-drawdown strategy can be seen as one", () => {
  // Without this column, "beat buy-and-hold" and "beat it while holding through a 52% hole" read
  // the same. BTC's window drawdown is 52.06%; the campaign's best gated config sits near 12%.
  const b = benchmarks(WINDOW);
  assert.ok(b.proxyMaxDrawdownPct > 50 && b.proxyMaxDrawdownPct < 55, `BTC drawdown moved: ${b.proxyMaxDrawdownPct}`);
  assert.ok(b.rows.every((r) => r.maxDrawdownPct >= 0 && r.maxDrawdownPct <= 100));
  assert.match(benchmarkLine(b), /drawdown/);
});

test("the market proxy is resolved from the universe, not assumed to be BTC", () => {
  // Three places assumed XBTUSD. On an equities bundle the benchmark would have printed "n/a" and
  // the btcRegime filter would have refused to compile, both quietly enough to be missed.
  assert.throws(() => benchmarks({ ...WINDOW, pairs: ["ETHUSD", "SOLUSD", "ADAUSD"] }),
    /no market proxy in this universe/);
});

test("an explicit proxy overrides the convention, and a missing one is refused", () => {
  const b = benchmarks({ ...WINDOW, pairs: ["ETHUSD", "SOLUSD", "XBTUSD"], proxy: "ETHUSD" });
  assert.equal(b.proxySymbol, "ETHUSD");
  assert.ok(b.proxy > 0);
  assert.match(benchmarkLine(b), /^benchmark, same window, no strategy: ETHUSD/);
  assert.throws(() => benchmarks({ ...WINDOW, pairs: ["ETHUSD"], proxy: "SPY" }), /is not in this universe/);
});
