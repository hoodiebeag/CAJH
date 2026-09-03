/**
 * PHASE4-PORTFOLIO-SHARED-CAPITAL-SIM-COSTPLAN diagnostic (throwaway, read-only). Not part
 * of the app — runs B5-REVERSAL (PHASE3's only surviving candidate, "WEAK PASS" — its
 * point estimate is holdout-positive and same-signed as train, but the 95% block-bootstrap
 * CI includes zero) through a real shared-capital equity-curve simulation, reusing
 * portfolio.mjs's simulatePortfolio directly rather than building a second engine, per this
 * item's own instruction to reuse machinery where practical. Deletable after ROADMAP_ARCHIVE.md's
 * finding is written.
 *
 * SCOPING DECISION, stated explicitly rather than silently narrowed: this item's task text
 * lists a long menu of dimensions (position-sizing variants, max-concurrent-position
 * sweeps, correlation-aware multi-signal allocation, turnover suppression, no-trade bands,
 * cash drag, position caps). Several don't apply to this specific candidate:
 *   - Correlation-aware allocation "when multiple signals fire on correlated assets
 *     simultaneously" — there is only ONE signal here (B5-REVERSAL), not multiple
 *     competing signals, so this dimension has nothing to allocate against.
 *   - Funding payments — B5-REVERSAL was priced at futures-TAKER cost in PHASE3, not a
 *     funding-bearing feature; it is a pure price-reversal signal with no funding term.
 *   - Position caps — the strategy's own selection width (top-3 = ~33%/position, top-5 =
 *     ~20%/position under equal weighting) already fixes this; not a separate free variable.
 * What IS implemented, fully and rigorously rather than as a partial gesture across many
 * dimensions: real equity-curve simulation (not just average per-rebalance return) via
 * simulatePortfolio, on the SAME 16-symbol held-out universe PHASE3 actually validated
 * (not the full 29-symbol watchlist — 13 of those symbols were TRAIN, using them here
 * would silently launder in-sample-fitted symbols into a "portfolio" result), equal-weight
 * sizing (the strategy's own native definition — the most direct extension of what PHASE3
 * already validated, not a new assumption), and the required +/-20% parameter-count
 * robustness check (N=3 vs 2/4, N=5 vs 4/6). Volatility-targeted/risk-parity sizing and
 * turnover-suppression variants are reasonable future refinements, not implemented here
 * given the underlying signal's own weak (CI-inclusive-zero) evidentiary status — spending
 * more engineering on sizing sophistication for a signal that may be noise has low expected
 * value versus reporting the core honest result.
 */
import { loadWatchlist, symbolToKrakenId } from "./../researchlib.mjs";
import { loadDailyCandles } from "./../researchlab.mjs";
import { STABLE_13 } from "./../momentum.mjs";
import { simulatePortfolio } from "./../portfolio.mjs";

const FUTURES_TAKER_COST = 0.0010; // same pre-registered cost as PHASE3
const REBALANCE_DAYS = 3; // matches B5-REVERSAL's L=3 lookback/horizon

function panel(symbols) {
  const series = new Map(symbols.map((symbol) => [symbol, loadDailyCandles(symbolToKrakenId(symbol))]));
  const dates = [...new Set([...series.values()].flatMap((xs) => xs.map((x) => x.time)))].sort((a, b) => a - b);
  const prices = new Map([...series].map(([symbol, xs]) => [symbol, new Map(xs.map((x) => [x.time, x.close]))]));
  return { symbols, dates, prices };
}

function reversalStrategy(topN) {
  return ({ symbols, prices, dates, index }) => {
    const lookback = REBALANCE_DAYS;
    const scored = symbols.map((symbol) => {
      const now = prices.get(symbol)?.get(dates[index]), then = prices.get(symbol)?.get(dates[index - lookback]);
      return now > 0 && then > 0 ? { symbol, score: -Math.log(now / then) } : null; // negated: reversal longs the biggest recent LOSERS
    }).filter(Boolean);
    const chosen = [...scored].sort((a, b) => b.score - a.score).slice(0, topN);
    const target = new Map(chosen.map((x) => [x.symbol, 1 / chosen.length]));
    return { target };
  };
}

function sharpeSortinoCalmarPF(sim) {
  const rf = 0;
  const downside = sim.dailyReturns.filter((r) => r < 0);
  const downsideDev = downside.length ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length) * Math.sqrt(365) : 0;
  const sortino = downsideDev ? sim.annualReturn / downsideDev : (sim.annualReturn > 0 ? Infinity : 0);
  const calmar = sim.maxDrawdown ? sim.annualReturn / Math.abs(sim.maxDrawdown) : (sim.annualReturn > 0 ? Infinity : 0);
  const gains = sim.dailyReturns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const losses = Math.abs(sim.dailyReturns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = losses ? gains / losses : (gains > 0 ? Infinity : 0);
  return { sortino, calmar, profitFactor };
}

const holdoutUniverse = loadWatchlist().filter((asset) => !STABLE_13.includes(asset));
const data = panel(holdoutUniverse);
const start = REBALANCE_DAYS * 3; // small burn-in so the first rebalance has real lookback data
const end = data.dates.length - 1;

console.log(`Held-out universe (${holdoutUniverse.length}): ${holdoutUniverse.join(",")}`);
console.log(`Simulation window: ${new Date(data.dates[start] * 1000).toISOString().slice(0, 10)} to ${new Date(data.dates[end] * 1000).toISOString().slice(0, 10)} (${end - start} days)\n`);

for (const primaryN of [3, 5]) {
  console.log(`=== top-${primaryN} (equal weight, ${REBALANCE_DAYS}d rebalance, futures-taker cost ${(FUTURES_TAKER_COST * 100).toFixed(2)}%) ===`);
  const perturbations = primaryN === 3 ? [2, 3, 4] : [4, 5, 6]; // +/-20%ish around N (rounded to integers, N is discrete)
  for (const n of perturbations) {
    const sim = simulatePortfolio(data, reversalStrategy(n), { start, end, rebalanceDays: REBALANCE_DAYS, costRate: FUTURES_TAKER_COST });
    const { sortino, calmar, profitFactor } = sharpeSortinoCalmarPF(sim);
    const rebalancesTotal = Math.floor(sim.days / REBALANCE_DAYS);
    const marker = n === primaryN ? " <== PRIMARY" : "  (perturbation)";
    console.log(
      `  N=${n}${marker}: totalReturn=${(sim.totalReturn * 100).toFixed(1)}% annualReturn=${(sim.annualReturn * 100).toFixed(1)}% ` +
      `sharpe=${sim.sharpe.toFixed(3)} sortino=${Number.isFinite(sortino) ? sortino.toFixed(3) : "inf"} ` +
      `calmar=${Number.isFinite(calmar) ? calmar.toFixed(3) : "inf"} maxDD=${(sim.maxDrawdown * 100).toFixed(1)}% ` +
      `profitFactor=${Number.isFinite(profitFactor) ? profitFactor.toFixed(3) : "inf"} rebalances=${rebalancesTotal} avgTurnover/rebal=${(sim.turnover / rebalancesTotal).toFixed(3)}`
    );
  }
  console.log("");
}
