/**
 * xsmom-gate.mjs -- score the cross-sectional spread against promotion.mjs.
 *
 * A UNIT MISMATCH THAT HAS TO BE STATED. promotion.mjs was written for per-trade R-multiples,
 * where R is the distance to a stop. A portfolio rotation has no stop and therefore no R. What is
 * used instead is the MONTHLY SPREAD RETURN in log space, one observation per rebalance, and every
 * threshold is interpreted in those units. The conditions still mean what they say -- expectancy
 * above zero, a win rate clearing the breakeven implied by the realised payoff, an interval
 * excluding zero, beating a matched null and a buy-and-hold control -- but "R" should be read as
 * "monthly return" throughout. Pretending the units match would be the kind of quiet substitution
 * this project has spent a day catching.
 *
 * pre_registration is left BLOCKED and must stay that way. Registering a hypothesis after seeing
 * its result is not pre-registration, and the gate reporting BLOCKED there is correct rather than
 * a gap to be filled. The honest use of the registry now is to pre-register the FORWARD test.
 */

import { promotionGate } from "./promotion.mjs";
import { spread, randomSpreadNull, selectionP } from "./xsmom.mjs";
import { loadUniverse } from "./entrynull-run.mjs";
import { clusteredBootstrapCI } from "./inference.mjs";
import { requiredN } from "./power.mjs";
import { costFor } from "./costs.mjs";
import { availablePairs } from "./bundle-loader.mjs";
import { pathToFileURL } from "url";

export const CANONICAL = { lookbackBars: 252, skipBars: 21, rebalanceBars: 21, topK: 10, slipPct: 0.0005 };

/** Mean monthly return of a buy-and-hold in the proxy, as the baseline control. */
export function proxyMonthlyReturn(series, symbol, periods) {
  const c = series[symbol];
  if (!c?.length) return null;
  const a = Number(c[0].close), b = Number(c[c.length - 1].close);
  if (!(a > 0) || !(b > 0) || !periods) return null;
  return Math.log(b / a) / periods;
}

export function scoreSpread({
  from = "2023-01-01", to = "2026-09-02", borrow = 0.05, draws = 200,
  opts = CANONICAL, proxy = "SPY", drawdownCeilingPct = 25, outOfSample = null,
} = {}) {
  const series = loadUniverse({ from, to });
  const cost = costFor(availablePairs(1440));
  const s = spread(series, opts, { borrow });
  const nul = randomSpreadNull(series, opts, { draws, borrow });
  const p = selectionP(nul, s.finalBalance);

  const rs = s.returns;
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0);
  const avgWin = wins.reduce((a, b) => a + b, 0) / (wins.length || 1);
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / (losses.length || 1));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (rs.length - 1));

  // The null's mean monthly return, so the excess is in the same units as everything else.
  const nullMeanMonthly = Math.log(nul.median / 1000) / s.periods;

  return {
    s, nul, p, cost,
    candidate: {
      netAvgR: mean,
      costBasis: { source: `costs.mjs ${cost.name}: ${cost.note}; plus ${(100 * borrow).toFixed(0)}% annualised borrow on the short half` },
      winRate: wins.length / rs.length,
      realisedRewardRisk: avgLoss > 0 ? avgWin / avgLoss : null,
      winRateMargin: 0.05, winRateMarginPreRegistered: true,
      clusteredCI: clusteredBootstrapCI(rs, { keys: rs.map((_, i) => String(i)) }),
      fdrQ: 0.05, familySize: 1, pValue: p,
      effectiveN: s.periods,
      requiredN: requiredN({ effect: 0.5 * sd, sd }),
      matchedNull: { p, excessOverNull: mean - nullMeanMonthly },
      buyAndHoldPerTradeR: proxyMonthlyReturn(series, proxy, s.periods),
      // §3.5 wants the worst run of consecutive losses stated, not inferred from the drawdown.
      worstLosingStreak: (() => {
        let run = 0, worst = 0;
        for (const r of rs) { run = r <= 0 ? run + 1 : 0; worst = Math.max(worst, run); }
        return worst;
      })(),
      maxDrawdownR: s.maxDrawdownPct, drawdownCeilingR: drawdownCeilingPct,
      drawdownCeilingPreRegistered: true,
      outOfSample,
      preregistration: null,   // correctly absent: registering after the result is not pre-registration
    },
  };
}

function main() {
  const borrow = Number(process.env.BORROW ?? 0.05);
  // The walk-forward result, supplied as the out-of-sample replication.
  // The walk-forward arm, with its own mean monthly return so the gate can read it in the same
  // units as the in-sample arm rather than reporting BLOCKED for a number that exists.
  const oosPeriods = 20, oosFinal = 1651.89;
  const oos = { finalBalance: oosFinal, cagrPct: 35.14, maxDrawdownPct: 10.36,
                window: "2025-01-01..2026-08-11", periods: oosPeriods,
                netAvgR: Math.log(oosFinal / 1000) / oosPeriods,
                refit: "quarterly, six-point grid, training data only" };
  const { s, nul, p, candidate } = scoreSpread({ borrow, outOfSample: oos });
  const out = promotionGate(candidate);

  console.log(`spread @${(100 * borrow).toFixed(0)}% borrow: $${s.finalBalance}, CAGR ${s.cagrPct}%, `
    + `DD ${s.maxDrawdownPct}%, ${s.upPeriods}/${s.periods} up`);
  console.log(`null (same names split at random): median $${nul.median}, p95 $${nul.p95} -> p=${p.toFixed(4)}\n`);
  console.log(`VERDICT: ${out.verdict.toUpperCase()}\n`);
  for (const c of out.conditions) {
    console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id.padEnd(24)} ${(c.reason ?? "").slice(0, 76)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
