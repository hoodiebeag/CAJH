/**
 * gate-run.mjs -- score a live configuration against promotion.mjs, from measured data.
 *
 *   CANDLE_BUNDLE=equity-bundle CANDLE_COST_MODEL=usEquityRetail node gate-run.mjs
 *   node gate-run.mjs                                    (crypto, the default bundle)
 *
 * WHY THIS EXISTS. promotion.mjs takes measured figures and returns a verdict, but nothing
 * computed those figures from a real run, so the gate had never actually been pointed at a
 * candidate. Assembling the inputs by hand is how a condition gets quietly skipped -- the first
 * attempt at this used wrong field names and every condition came back BLOCKED, which reads like
 * "not proven" and actually meant "never asked".
 *
 * THE ONE THING TO UNDERSTAND FROM ITS OUTPUT. The owner's stated bar -- roughly ten trades a
 * month, a win rate at or above 40%, wins large enough to offset the losses -- is met by the
 * current equities candidate on every count. It is also met by a RANDOM ENTRY using the same
 * exits, which is why the gate does not stop there. A wide stop with no take-profit and a bounded
 * hold caps losses near 1R and lets winners run past 3R, so a ~40% win rate at a ~2.7 payoff is a
 * property of the EXIT geometry and comes free with any long entry in a rising market. What
 * separates a strategy from that is `beats_matched_null`, and nothing here has cleared it.
 */

import { promotionGate } from "./promotion.mjs";
import { LEADER, collect, report } from "./robustness.mjs";
import { loadUniverse } from "./entrynull-run.mjs";
import { randomEntryDrawer } from "./entrynull.mjs";
import { matchedGeometryNull, clusteredBootstrapCI } from "./inference.mjs";
import { requiredN } from "./power.mjs";
import { costFor } from "./costs.mjs";
import { availablePairs } from "./bundle-loader.mjs";
import { pathToFileURL } from "url";

/** Win rate, payoff and expectancy for a list of net R values. */
export function shapeOf(rs) {
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (rs.length - 1));
  return { n: rs.length, winRate: wins.length / rs.length, avgWin, avgLoss,
           payoff: avgLoss > 0 ? avgWin / avgLoss : null, mean, sd };
}

/**
 * Build the gate's inputs from a real run. Anything genuinely not measured is left absent so the
 * gate reports BLOCKED for it -- an unanswered question must never read as a pass.
 */
export function scoreCandidate(config = LEADER, {
  from, to, detectableEdge = 0.25, winRateMargin = 0.05, k = 4000, seed = 20260904,
} = {}) {
  const window = { from, to };
  const { trades } = collect(config, window);
  const rs = trades.map((t) => t.netR);
  const shape = shapeOf(rs);
  const r = report(config, window);

  const series = loadUniverse(window);
  const cost = costFor(availablePairs(1440));
  const drawTrade = randomEntryDrawer({
    observed: trades.map((t) => ({ symbol: t.symbol, stopPct: t.stopPct })),
    seriesByPair: series,
    exit: { tpR: config.tpR ?? 100, maxHold: config.maxHold ?? 50,
            lockBreakeven: config.lockBreakeven !== false,
            beTriggerR: config.beTriggerR ?? 3, beLockR: config.beLockR ?? 0.2,
            feeRate: cost.feeRate, slipPct: cost.slipPct },
  });
  const nul = matchedGeometryNull({ observedMean: shape.mean, n: shape.n, drawTrade, k, seed });

  return {
    shape, nul, cost,
    candidate: {
      netAvgR: shape.mean,
      costBasis: { source: `costs.mjs ${cost.name}: ${cost.note}` },
      winRate: shape.winRate,
      realisedRewardRisk: shape.payoff,
      winRateMargin, winRateMarginPreRegistered: true,
      clusteredCI: clusteredBootstrapCI(rs, {
        keys: trades.map((t) => new Date(t.entryTime).toISOString().slice(0, 10)),
      }),
      fdrQ: 0.05, familySize: 1, pValue: nul.p,
      effectiveN: r.shape.distinctDays,
      requiredN: requiredN({ effect: detectableEdge, sd: shape.sd }),
      matchedNull: { p: nul.p, excessOverNull: nul.excessOverNull },
      // Deliberately absent, because they were not measured for this candidate. BLOCKED is the
      // correct report for a question nobody asked.
      preregistration: null, buyAndHoldPerTradeR: null,
      maxDrawdownR: null, drawdownCeilingR: null, outOfSample: null,
    },
  };
}

function main() {
  const to = process.env.GATE_TO || "2026-09-02";
  const from = process.env.GATE_FROM || "2023-01-01";
  const { shape, nul, cost, candidate } = scoreCandidate(LEADER, { from, to });
  const out = promotionGate(candidate);

  console.log(`window ${from} .. ${to}, cost model ${cost.name}\n`);
  console.log(`shape: ${shape.n} trades, win rate ${(100 * shape.winRate).toFixed(1)}%, `
    + `avg win ${shape.avgWin.toFixed(2)}R, avg loss ${shape.avgLoss.toFixed(2)}R, `
    + `payoff ${shape.payoff.toFixed(2)}, expectancy ${shape.mean.toFixed(4)}R`);
  console.log(`coin flip with the same exits: mean ${nul.nullMean.toFixed(4)}R, `
    + `excess ${nul.excessOverNull.toFixed(4)}R, p=${nul.p.toFixed(5)}\n`);
  console.log(`VERDICT: ${out.verdict.toUpperCase()}\n`);
  for (const c of out.conditions) {
    console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id.padEnd(24)} ${(c.reason ?? "").slice(0, 88)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
