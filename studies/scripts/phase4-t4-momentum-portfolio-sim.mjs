/**
 * T4-PORTFOLIO-MOMENTUM-PHASE4 diagnostic (throwaway, read-only). Not part of the app —
 * closes the gap VERDICTS.md's PWR5->PHASE2->PHASE3->PHASE4 summary explicitly flagged:
 * every other PHASE2 survivor (B5-REVERSAL) went on to a full PHASE4 shared-capital
 * equity-curve simulation before being closed; T4-PORTFOLIO-MOMENTUM was flagged as
 * "closer but not clearing" and left for a human/future firing to decide whether it's
 * worth the same complete test. Reuses portfolio.mjs's simulatePortfolio directly (real
 * code, real candle panel), same engine B5-REVERSAL's own PHASE4 script
 * (scripts/phase4-b5-portfolio-sim.mjs) used. Deletable after ROADMAP_ARCHIVE.md's finding is
 * written.
 *
 * SCOPING DECISION, stated explicitly: PHASE2's triage (scripts/phase2-triage.mjs) only
 * ever tested momentum_30d at 30d rebalance — that is the one variant with real reported
 * numbers ("closest of the four", holdout Sharpe 0.493 at the flagged best-case scenario)
 * — so that is the sole candidate carried into this PHASE4 run, matching B5-REVERSAL's own
 * precedent of only carrying forward its own PHASE2/PHASE3 survivor, not re-opening the
 * full strategy menu. momentum_vol (T4-PORTFOLIO-MOMENTUM's sibling variant) was never
 * triaged in PHASE2 and is out of scope here for the same reason.
 *
 * COST-SCENARIO DECISION, disclosed rather than silently picked: PHASE2 flagged "futures
 * maker (fee-only)" as T4's best case (Sharpe 0.493). But B5-REVERSAL's own PHASE3 (see
 * ROADMAP_ARCHIVE.md 2026-08-13, "Pre-registered before any holdout number was computed") rejected
 * a maker assumption for exactly this shape of strategy — "a resting maker order risking a
 * missed fill is not realistic for a signal whose edge depends on entering at the scheduled
 * rebalance" — and chose futures TAKER instead, despite it being the worse-looking cost
 * scenario. T4-PORTFOLIO-MOMENTUM is the same shape (systematic, scheduled 30d rebalance),
 * so the same execution-realism argument applies here. Both scenarios are reported in full
 * below (no number is hidden), but futures TAKER is treated as the primary/realistic
 * gate-evaluation scenario and futures MAKER (fee-only) as a secondary, disclosed-optimistic
 * reference matching what PHASE2 originally flagged.
 *
 * SPLIT METHODOLOGY: unlike B5-REVERSAL (symbol-holdout universe, momentum.mjs's own
 * convention), T4-PORTFOLIO-MOMENTUM has always used portfolio.mjs's standard chronological
 * 70/30 TIME split on the FULL watchlist (runPortfolioStudy/T4-COVERAGE-FIX/PHASE2 all did
 * this) — that convention is preserved here, not swapped for symbol-holdout.
 *
 * PARAMETER-PERTURBATION ROBUSTNESS CHECK: momentum_30d's topN=5 is hardcoded inside
 * portfolio.mjs (not a passed parameter), so the +/-20% check (N=4/N=6) is done via a local
 * re-implementation of the exact same scoring formula (30d log return, equal-weight top N) —
 * verified below to reproduce portfolio.mjs's own momentum_30d bit-for-bit at N=5 before
 * being trusted for the N=4/N=6 variants, the same sanity-check discipline PWR5/PHASE2 used
 * before trusting simulatePortfolio's costRate parameter.
 */
import { loadWatchlist, symbolToKrakenId } from "./../researchlib.mjs";
import { loadResearchCandles } from "./../researchlab.mjs";
import { portfolioStrategies, simulatePortfolio } from "./../portfolio.mjs";

const REBALANCE_DAYS = 30; // T4-PORTFOLIO-MOMENTUM's flagged best-scoring variant

const SCENARIO_PRIMARY = { label: "futures taker (realistic execution for a scheduled rebalance, per B5-REVERSAL PHASE3's own precedent)", roundTrip: 0.0010 };
const SCENARIO_OPTIMISTIC = { label: "futures maker, fee-only (PHASE2's originally-flagged best case — optimistic, ignores fill/adverse-selection risk)", roundTrip: 0.0004 };

// Verbatim replica of portfolio.mjs's module-private panel() (not exported) — same
// watchlist, same 1440-minute (daily) resample, same BTC-excluded-from-tradable
// convention, matching what phase2-triage.mjs already established as byte-identical.
function panel(watchlist) {
  const series = new Map(watchlist.map((symbol) => [symbol, loadResearchCandles(symbolToKrakenId(symbol), 1440)]));
  const dates = [...new Set([...series.values()].flatMap((xs) => xs.map((x) => x.time)))].sort((a, b) => a - b);
  const prices = new Map([...series].map(([symbol, xs]) => [symbol, new Map(xs.map((x) => [x.time, x.close]))]));
  return { symbols: [...series.keys()].filter((s) => s !== "BTC"), dates, prices };
}
function returns(prices, dateIndex, dates, symbol, days) {
  const now = prices.get(symbol)?.get(dates[dateIndex]), then = prices.get(symbol)?.get(dates[dateIndex - days]);
  return now > 0 && then > 0 ? Math.log(now / then) : null;
}
// Mirrors portfolio.mjs's normalizeWeights() exactly, INCLUDING its sort-before-filter
// order: entries with a null/non-finite score sort as if score===0 (null coerces to 0 in
// `b.score - a.score`), so they can occupy a top-N slot before being dropped by the
// subsequent .filter(Number.isFinite) — a pre-existing quirk in the real code, not
// something to silently "fix" here, since this perturbation check must reflect the
// production strategy's actual behavior, not a corrected reimplementation of it.
function momentumStrategy(topN) {
  return ({ symbols, prices, dates, index }) => {
    const scored = symbols.map((symbol) => ({ symbol, score: returns(prices, index, dates, symbol, 30) }));
    const chosen = [...scored].sort((a, b) => b.score - a.score).slice(0, topN).filter((x) => Number.isFinite(x.score));
    return { target: new Map(chosen.map((x) => [x.symbol, 1 / chosen.length])) };
  };
}

function sharpeSortinoCalmarPF(sim) {
  const downside = sim.dailyReturns.filter((r) => r < 0);
  const downsideDev = downside.length ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length) * Math.sqrt(365) : 0;
  const sortino = downsideDev ? sim.annualReturn / downsideDev : (sim.annualReturn > 0 ? Infinity : 0);
  const calmar = sim.maxDrawdown ? sim.annualReturn / Math.abs(sim.maxDrawdown) : (sim.annualReturn > 0 ? Infinity : 0);
  const gains = sim.dailyReturns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const losses = Math.abs(sim.dailyReturns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = losses ? gains / losses : (gains > 0 ? Infinity : 0);
  return { sortino, calmar, profitFactor };
}

const watchlist = loadWatchlist();
const data = panel(watchlist);
const split = Math.floor(data.dates.length * 0.70);
const end = data.dates.length - 1;

console.log(`Full watchlist (${data.symbols.length}): ${data.symbols.join(",")}`);
console.log(`Holdout window: index ${split} to ${end} (${new Date(data.dates[split] * 1000).toISOString().slice(0, 10)} to ${new Date(data.dates[end] * 1000).toISOString().slice(0, 10)})\n`);

// Sanity check: local N=5 replica must match the real portfolioStrategies.momentum_30d
// exactly before its N=4/N=6 siblings are trusted for the robustness check.
{
  const real = simulatePortfolio(data, portfolioStrategies.momentum_30d, { start: split, end, rebalanceDays: REBALANCE_DAYS, costRate: SCENARIO_PRIMARY.roundTrip });
  const replica = simulatePortfolio(data, momentumStrategy(5), { start: split, end, rebalanceDays: REBALANCE_DAYS, costRate: SCENARIO_PRIMARY.roundTrip });
  const drift = Math.abs(real.totalReturn - replica.totalReturn);
  console.log(`Sanity check (real momentum_30d vs local N=5 replica, futures-taker cost): totalReturn drift = ${drift.toExponential(2)} (real=${(real.totalReturn * 100).toFixed(4)}%, replica=${(replica.totalReturn * 100).toFixed(4)}%)`);
  if (drift > 1e-9) console.log("WARNING: replica does not match real code — perturbation results below are not trustworthy until this is resolved.");
  console.log("");
}

for (const scenario of [SCENARIO_PRIMARY, SCENARIO_OPTIMISTIC]) {
  console.log(`=== ${scenario.label} (roundTrip ${(scenario.roundTrip * 100).toFixed(2)}%) ===`);
  for (const n of [4, 5, 6]) {
    const sim = simulatePortfolio(data, momentumStrategy(n), { start: split, end, rebalanceDays: REBALANCE_DAYS, costRate: scenario.roundTrip });
    const { sortino, calmar, profitFactor } = sharpeSortinoCalmarPF(sim);
    const rebalancesTotal = Math.floor(sim.days / REBALANCE_DAYS);
    const marker = n === 5 ? " <== PRIMARY (real momentum_30d topN)" : "  (perturbation)";
    console.log(
      `  N=${n}${marker}: totalReturn=${(sim.totalReturn * 100).toFixed(1)}% annualReturn=${(sim.annualReturn * 100).toFixed(1)}% ` +
      `sharpe=${sim.sharpe.toFixed(3)} sortino=${Number.isFinite(sortino) ? sortino.toFixed(3) : "inf"} ` +
      `calmar=${Number.isFinite(calmar) ? calmar.toFixed(3) : "inf"} maxDD=${(sim.maxDrawdown * 100).toFixed(1)}% ` +
      `profitFactor=${Number.isFinite(profitFactor) ? profitFactor.toFixed(3) : "inf"} rebalances=${rebalancesTotal} avgTurnover/rebal=${(sim.turnover / rebalancesTotal).toFixed(3)}`
    );
  }
  console.log("");
}
console.log("(gate, primary scenario only: holdout Sharpe>=0.5 AND totalReturn>0 AND maxDrawdown>-35% AND no sign flip N=4/6 vs N=5)");
