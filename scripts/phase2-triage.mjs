/**
 * PHASE2-MAX-SURVIVABLE-COST diagnostic (throwaway, read-only). Not part of the app —
 * re-derives each of the four cost-killed signals' post-cost result at PHASE1's five real
 * cost scenarios, using each study's OWN real code and (where available) its own saved
 * sealed-run evidence rather than a fresh assumption. Deletable after ROADMAP.md's finding
 * is written.
 *
 * Method per signal:
 *  - Classifier P5 / CLASSIFIER-FUNDING-FEATURE: classifier.mjs's economicLiftNetOfCost()
 *    computes `mean(row.netR) - roundTripCost` — provably affine in roundTripCost by
 *    construction (a flat per-row subtraction, not scaled by anything). That means the
 *    population's mean netR can be recovered EXACTLY from one already-reported (cost, net)
 *    pair (mean = reportedNet + reportedCost), and net(anyCost) = mean - anyCost is then
 *    exact, not an extrapolation assumption — verified below against both of VERDICTS.md's
 *    reported points (0.009 and 0.017) before trusting it for new cost values.
 *  - B5-REVERSAL: momentum.mjs's sealed-reversal cost model scales with each bucket's own
 *    turnover (not a flat subtraction — confirmed by checking the two reported points
 *    aren't consistent with a 1:1 slope). Slope is derived empirically from the same two
 *    reported (cost, net) pairs per bucket; still exactly linear in cost (turnover×cost is
 *    linear in cost for a fixed turnover), just with a derived slope instead of an assumed
 *    one — cross-checked against the reported 59-78% turnover range as a sanity bound.
 *  - T4-PORTFOLIO-MOMENTUM: portfolio.mjs's simulatePortfolio() takes a real costRate
 *    parameter — re-run directly on the real candle panel at each scenario rather than
 *    inferring anything, since the function is already built for exactly this.
 */
import { loadWatchlist, symbolToKrakenId } from "./../researchlib.mjs";
import { loadResearchCandles } from "./../researchlab.mjs";
import { portfolioStrategies, simulatePortfolio } from "./../portfolio.mjs";

// ─── PHASE1 cost scenarios (round-trip %, from cost-model.mjs / ROADMAP.md 2026-08-13) ──
const SCENARIOS = [
  { label: "spot taker", roundTrip: 0.0170 },
  { label: "spot maker (fee-only)", roundTrip: 0.0080 },
  { label: "spot maker (incl. calibrated adverse selection)", roundTrip: 0.0104 },
  { label: "spot maker-rebate (fee-only)", roundTrip: 0.0076 },
  { label: "futures taker", roundTrip: 0.0010 },
  { label: "futures maker (fee-only)", roundTrip: 0.0004 },
  { label: "futures maker (incl. calibrated adverse selection, spot-proxy)", roundTrip: 0.0028 },
];

// ─── Classifier P5 / CLASSIFIER-FUNDING-FEATURE: exact affine recovery ──────────────────
function classifierMeanNetR(reportedNet, reportedCost) {
  return reportedNet + reportedCost;
}

function classifierTriage(label, { selected009, selected017, baseline009, baseline017 }) {
  const meanSelected = classifierMeanNetR(selected009, 0.009);
  const meanBaseline = classifierMeanNetR(baseline009, 0.009);
  console.log(`\n=== ${label} (classifier.mjs economicLiftNetOfCost, exact affine model) ===`);
  if (selected017 == null || baseline017 == null) {
    console.log(`recovered mean selected netR = ${meanSelected.toFixed(4)} (ONLY ONE real cost point available - 0.017 was never independently re-run for this signal, so this cannot be cross-checked; the table below is exact IF the flat-subtraction model holds, unverified for this specific signal)`);
    console.log(`recovered mean baseline netR = ${meanBaseline.toFixed(4)} (same caveat)`);
  } else {
    const driftSelected = Math.abs(meanSelected - classifierMeanNetR(selected017, 0.017));
    const driftBaseline = Math.abs(meanBaseline - classifierMeanNetR(baseline017, 0.017));
    console.log(`recovered mean selected netR = ${meanSelected.toFixed(4)} (cross-check drift vs 2nd real point: ${driftSelected.toExponential(2)})`);
    console.log(`recovered mean baseline netR = ${meanBaseline.toFixed(4)} (cross-check drift vs 2nd real point: ${driftBaseline.toExponential(2)})`);
  }
  console.log("scenario                                                    roundTrip%   selectedNet   baselineNet");
  for (const s of SCENARIOS) {
    const sel = meanSelected - s.roundTrip;
    const base = meanBaseline - s.roundTrip;
    console.log(`${s.label.padEnd(58)} ${(s.roundTrip * 100).toFixed(3).padStart(9)}%   ${sel.toFixed(4).padStart(11)}   ${base.toFixed(4).padStart(11)}`);
  }
}

classifierTriage("Classifier P5", { selected009: -0.4616, selected017: null, baseline009: -0.5178, baseline017: null });
// P5 has only ONE real reported cost point (0.009) in ROADMAP.md/VERDICTS.md - it was never
// re-run at the corrected 0.017 rate. Cannot verify affine-ness with a 2nd point the way
// CLASSIFIER-FUNDING-FEATURE can; reported honestly below instead of silently assuming it.

classifierTriage("CLASSIFIER-FUNDING-FEATURE (primary)", { selected009: -0.2412, selected017: -0.2492, baseline009: -0.5387, baseline017: -0.5467 });

// ─── B5-REVERSAL: empirically-derived slope per selection width (L=3) ───────────────────
function reversalTriage(label, net009, net017) {
  const slope = (net017 - net009) / (0.017 - 0.009); // = -turnover, by momentum.mjs's own cost model
  const intercept = net009 - slope * 0.009; // gross (cost=0) reading
  console.log(`\n=== B5-REVERSAL L=3, ${label} (derived slope=${slope.toFixed(4)} ~ implied turnover ${(-slope * 100).toFixed(1)}%, gross@cost=0: ${intercept.toFixed(4)}) ===`);
  console.log("scenario                                                    roundTrip%   net");
  for (const s of SCENARIOS) {
    const net = intercept + slope * s.roundTrip;
    console.log(`${s.label.padEnd(58)} ${(s.roundTrip * 100).toFixed(3).padStart(9)}%   ${net.toFixed(4).padStart(8)}`);
  }
}
reversalTriage("tercile", -0.0088, -0.0207);
reversalTriage("top-3", -0.0007, -0.0069);
reversalTriage("top-5", 0.0001, -0.0046);

// ─── T4-PORTFOLIO-MOMENTUM: real re-run via simulatePortfolio's own costRate param ──────
//
// portfolio.mjs's panel() is module-private; rather than exporting an internal for one
// throwaway script, this replicates it verbatim from the same building blocks
// (loadResearchCandles/symbolToKrakenId, both already exported) so it stays byte-identical
// to what runPortfolioStudy() itself builds — same watchlist, same 1440-minute (daily)
// resample, same BTC-excluded-from-tradable convention.
function panel(watchlist) {
  const series = new Map(watchlist.map((symbol) => [symbol, loadResearchCandles(symbolToKrakenId(symbol), 1440)]));
  const dates = [...new Set([...series.values()].flatMap((xs) => xs.map((x) => x.time)))].sort((a, b) => a - b);
  const prices = new Map([...series].map(([symbol, xs]) => [symbol, new Map(xs.map((x) => [x.time, x.close]))]));
  return { symbols: [...series.keys()].filter((s) => s !== "BTC"), dates, prices };
}

function t4Triage() {
  const data = panel(loadWatchlist());
  const split = Math.floor(data.dates.length * 0.70);
  const strategy = portfolioStrategies.momentum_30d; // the closest-to-passing variant per TOURNAMENT_ROADMAP.md's T4-COVERAGE-FIX rerun
  console.log(`\n=== T4-PORTFOLIO-MOMENTUM: momentum_30d, 30d rebalance, real re-run via simulatePortfolio's own costRate param ===`);
  console.log("scenario                                                    roundTrip%   holdoutSharpe   holdoutReturn   holdoutMaxDD");
  for (const s of SCENARIOS) {
    const holdout = simulatePortfolio(data, strategy, { start: split, end: data.dates.length - 1, rebalanceDays: 30, costRate: s.roundTrip });
    console.log(
      `${s.label.padEnd(58)} ${(s.roundTrip * 100).toFixed(3).padStart(9)}%   ` +
      `${holdout.sharpe.toFixed(3).padStart(13)}   ${(holdout.totalReturn * 100).toFixed(1).padStart(12)}%   ${(holdout.maxDrawdown * 100).toFixed(1).padStart(11)}%`
    );
  }
  console.log("(gate: holdout Sharpe > 0.5 AND holdout totalReturn > 0 AND holdout maxDrawdown > -35%, train leg not shown here — see ROADMAP.md writeup)");
}
t4Triage();
