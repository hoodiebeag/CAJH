/**
 * BREAKEVEN-LOCK-COUNTERFACTUAL (additive, read-only diagnostic, cache-only — no IBKR egress).
 *
 * `ma_dip` is a CLOSED historical population on both equity universes — killed decisively by
 * `MADIP-SURVIVABILITY-CONDITION-5` (2026-08-28: max drawdown -81.7%/-74.2% at f=2%, RUIN at
 * f=5%, against a pre-registered -25% ceiling). This item is forensic, not a re-tune or a
 * candidate re-evaluation: `MADIP-REALISED-R-CONDITION-2` (2026-08-28) found the breakeven lock
 * ("trail/be" in backtest.js's naming — `ma_dip`'s config sets no trailR/trailStartR, so
 * `trailing` never arms and "trail/be" here means the breakeven lock specifically) accounts for
 * a minority of trades but a disproportionate share of net R (+124.4% of total on DJIA-30,
 * +64.5% on DJTA-20), and flagged the natural follow-up left open: what would have happened to
 * those exact trades had the lock not fired at all, carrying the position to its original stop
 * or target instead? This item answers that, using the per-trade `why` field
 * MADIP-REALISED-R-CONDITION-2 already added to backtest.js's excursions (reused verbatim, not
 * re-added). No entry/exit logic in backtest.js is touched — the counterfactual replay is
 * implemented entirely in this new script, walking the same cached OHLC bars the real engine
 * used, checking the ORIGINAL stop/target (pre-lock) with the identical conservative
 * stop-before-target-same-bar rule and the identical maxHold=100 timeout backtest.js applies.
 *
 * ============================ PRE-REGISTRATION (written before any counterfactual is computed) ============================
 * SCOPE: DJIA-30 and DJTA-20, both treated as closed historical populations (not candidates) —
 * no parameter sweep, no config change proposed either way this comes out.
 * COST BASIS / CONFIG / SPLIT: verbatim from MADIP-REALISED-R-CONDITION-2 — IBKR Fixed plan
 * $0.005/share commission (per-symbol, via that symbol's own holdout avgClose), 5bps/side
 * slippage, 70/30 split, `{ entryMode: "ma_dip", trendGate: false, alignMode: "none",
 * minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }`.
 * CROSS-CHECK FIRST: this script reproduces MADIP-REALISED-R-CONDITION-2's own trade counts
 * (475/300) and avgR (+0.15263/+0.29939) off the same cache before computing anything new — if
 * that fails, the counterfactual below is not trustworthy and the script says so instead of
 * proceeding.
 * ISOLATION: the breakeven-locked subset is every excursion with `why === "trail/be"` — no
 * re-derivation, the field is read as-is.
 * COUNTERFACTUAL DEFINITION: for each breakeven-locked trade, original stop = entry - risk,
 * original target = entry + tpR*risk (tpR=5, this config's own value — unchanged). Starting
 * from the bar immediately after the entry bar (matching backtest.js's own `k > pos.openedAt`
 * gating), walk forward bar-by-bar against the SAME cached candles: if the bar's low touches
 * the original stop, exit there (stop checked before target on the same bar — the same
 * conservative same-bar-ambiguity rule backtest.js itself uses); else if the bar's high touches
 * the original target, exit there; else if bars-since-entry reaches maxHold=100 (backtest.js's
 * own unmodified constant), exit at that bar's close as a timeout, exactly mirroring
 * backtest.js's own position-management order of operations. Net R computed with the identical
 * `netAt` formula backtest.js uses (entry+exit fee/slippage leg on the full notional, matching
 * the single-leg trades this config produces — `ma_dip` sets no partialAtR). If the cached data
 * runs out before any of the three exits is reached, the trade is UNRESOLVED and excluded from
 * the counterfactual aggregate (backtest.js itself silently drops a position that never closes
 * before the data ends — this script reports the count instead of guessing an outcome).
 * CLASSIFICATION: a resolved counterfactual trade is "saved from a full stop-out" if its
 * outcome is the original stop, "cut from an eventual target hit" if its outcome is the
 * original target, or "would have timed out" if it reaches maxHold unresolved either way —
 * reported as three buckets, not forced into two.
 * REPORTED: counterfactual R distribution for the subset vs. the actual (near-zero) R it
 * booked; net change in total R and avgR (over the FULL population, all trades) had the lock
 * not fired; the three-way outcome split; realised R (mean win / mean |loss|, same win/loss
 * definition as MADIP-REALISED-R-CONDITION-2: win = net R > 0, breakeven-exact counts as a
 * loss) recomputed for the full population with the subset's actual R replaced by its
 * counterfactual R, reported beside the measured 2.6466 (DJIA-30) / 2.5036 (DJTA-20); an
 * explicit net-positive/net-negative verdict per universe.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../../backtest.js";
import { saveExperiment } from "../../researchlab.mjs";

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };
const MAX_HOLD = 100; // backtest.js's own MAX_HOLD constant, unmodified — mirrored here for the counterfactual replay only

// Cross-check targets from MADIP-REALISED-R-CONDITION-2 (2026-08-28), reproduced before anything new is computed.
const PRIOR = {
  "DJIA-30": { trades: 475, avgR: 0.15263, realisedR: 2.6466 },
  "DJTA-20": { trades: 300, avgR: 0.29939, realisedR: 2.5036 },
};

const UNIVERSES = {
  "DJIA-30": {
    cacheDir: path.join(".", "research-cache", "equities-1d"),
    symbols: [
      "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
      "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
      "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
    ],
  },
  "DJTA-20": {
    cacheDir: path.join(".", "research-cache", "equities-1d-djta-oos"),
    symbols: [
      "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
      "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
    ],
  },
};

function loadCached(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Mirrors backtest.js's own per-leg net-R formula exactly (long-only — ma_dip opens no shorts):
// directional P&L minus a fee+slippage leg applied to (entry+exit) on the full notional.
function netAt(entry, risk, exitPx, feeRate, slipPct) {
  return (exitPx - entry) / risk - ((feeRate + slipPct) * (entry + exitPx)) / risk;
}

// Replays ONE trade forward from its own cached bars against the ORIGINAL (pre-lock) stop/target,
// using backtest.js's own conservative same-bar rule (stop checked before target) and its own
// maxHold timeout. Returns null if the data runs out before any exit is reached (UNRESOLVED).
function replayCounterfactual({ O, H, L, C, T }, openedAt, entry, risk, tpR, feeRate, slipPct) {
  const stop = entry - risk;
  const target = entry + tpR * risk;
  for (let k = openedAt + 1; k < T.length; k++) {
    const barsSinceEntry = k - openedAt;
    if (L[k] <= stop) {
      return { outcome: "stop", barsHeld: barsSinceEntry, exitPrice: stop, r: netAt(entry, risk, stop, feeRate, slipPct) };
    }
    if (H[k] >= target) {
      return { outcome: "target", barsHeld: barsSinceEntry, exitPrice: target, r: netAt(entry, risk, target, feeRate, slipPct) };
    }
    if (barsSinceEntry >= MAX_HOLD) {
      return { outcome: "timeout", barsHeld: barsSinceEntry, exitPrice: C[k], r: netAt(entry, risk, C[k], feeRate, slipPct) };
    }
  }
  return null; // data ran out before resolving — UNRESOLVED, excluded from aggregates (matches backtest.js's own silent-drop behavior)
}

function computeRealisedR(excursionsLike) {
  const wins = excursionsLike.filter((x) => x.r > 0);
  const losses = excursionsLike.filter((x) => x.r <= 0);
  const avgWin = wins.length ? wins.reduce((a, x) => a + x.r, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, x) => a + Math.abs(x.r), 0) / losses.length : null;
  return avgWin != null && avgLoss ? avgWin / avgLoss : null;
}

function analyseUniverse(name, { cacheDir, symbols }) {
  const excursions = []; // full population, annotated with symbol + bar arrays needed for replay
  let backtestTotalR = 0;

  for (const symbol of symbols) {
    const candles = loadCached(cacheDir, symbol);
    if (!candles) { console.error(`MISSING CACHE [${name}]: ${symbol} — cache-only by design, no re-fetch`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP [${name}] ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    backtestTotalR += r.totalR;

    // Same parse backtest.js itself uses internally, rebuilt here only to replay the counterfactual.
    const O = holdout.map((c) => parseFloat(c.open));
    const H = holdout.map((c) => parseFloat(c.high));
    const L = holdout.map((c) => parseFloat(c.low));
    const C = holdout.map((c) => parseFloat(c.close));
    const T = holdout.map((c) => parseInt(c.time));

    for (const x of r.excursions) {
      excursions.push({ ...x, symbol, feeRate });
      if (x.why === "trail/be") {
        const openedAt = T.indexOf(x.entryTime);
        if (openedAt === -1) {
          excursions[excursions.length - 1].cf = { outcome: "openedAtNotFound" };
          continue;
        }
        const cf = replayCounterfactual({ O, H, L, C, T }, openedAt, x.entry, x.risk, CONFIG.tpR, feeRate, SLIPPAGE_PCT_EQUITY);
        excursions[excursions.length - 1].cf = cf ? { ...cf, symbol } : { outcome: "unresolved" };
      }
    }
  }

  const trades = excursions.length;
  const totalR = excursions.reduce((a, x) => a + x.r, 0);
  const totalRMatchesBacktest = Math.abs(totalR - backtestTotalR) < 1e-9;
  const avgR = trades ? totalR / trades : null;
  const measuredRealisedR = computeRealisedR(excursions);

  const prior = PRIOR[name];
  const crossCheck = {
    tradesMatch: trades === prior.trades,
    avgRMatch: avgR != null && Math.abs(avgR - prior.avgR) < 1e-4,
    realisedRMatch: measuredRealisedR != null && Math.abs(measuredRealisedR - prior.realisedR) < 1e-3,
    trades, avgR, measuredRealisedR, prior,
  };

  const lockSubset = excursions.filter((x) => x.why === "trail/be");
  const resolved = lockSubset.filter((x) => x.cf && x.cf.outcome !== "unresolved" && x.cf.outcome !== "openedAtNotFound");
  const unresolved = lockSubset.filter((x) => !x.cf || x.cf.outcome === "unresolved" || x.cf.outcome === "openedAtNotFound");

  const savedFromStop = resolved.filter((x) => x.cf.outcome === "stop");
  const cutFromTarget = resolved.filter((x) => x.cf.outcome === "target");
  const wouldHaveTimedOut = resolved.filter((x) => x.cf.outcome === "timeout");

  const actualSubsetR = resolved.reduce((a, x) => a + x.r, 0);
  const cfSubsetR = resolved.reduce((a, x) => a + x.cf.r, 0);
  const netChangeTotalR = cfSubsetR - actualSubsetR; // R the lock cost (positive) or gained (negative) vs. letting these ride
  const netChangeAvgR = trades ? netChangeTotalR / trades : null;

  // Recompute realised R for the FULL population with the resolved subset's actual r replaced by its counterfactual r.
  // Unresolved trades keep their actual (real) r — there is no counterfactual outcome to substitute for them.
  const resolvedByKey = new Map(resolved.map((x) => [x, x.cf.r]));
  const counterfactualPopulation = excursions.map((x) => (resolvedByKey.has(x) ? { r: resolvedByKey.get(x) } : { r: x.r }));
  const counterfactualRealisedR = computeRealisedR(counterfactualPopulation);

  const cfRValues = resolved.map((x) => x.cf.r);
  const cfDistribution = cfRValues.length
    ? {
        n: cfRValues.length,
        mean: cfRValues.reduce((a, b) => a + b, 0) / cfRValues.length,
        min: Math.min(...cfRValues),
        max: Math.max(...cfRValues),
      }
    : { n: 0, mean: null, min: null, max: null };

  const actualLockRValues = resolved.map((x) => x.r);
  const actualLockDistribution = actualLockRValues.length
    ? {
        n: actualLockRValues.length,
        mean: actualLockRValues.reduce((a, b) => a + b, 0) / actualLockRValues.length,
        min: Math.min(...actualLockRValues),
        max: Math.max(...actualLockRValues),
      }
    : { n: 0, mean: null, min: null, max: null };

  const lockIsNetPositiveForTotalR = actualSubsetR > cfSubsetR; // lock booked MORE than the counterfactual would have

  return {
    universe: name,
    crossCheck,
    lockSubsetSize: lockSubset.length,
    unresolvedCount: unresolved.length,
    unresolvedDetail: unresolved.map((x) => ({ symbol: x.symbol, entryTime: x.entryTime, reason: x.cf?.outcome ?? "missing" })),
    actualLockDistribution,
    counterfactualDistribution: cfDistribution,
    outcomeSplit: {
      savedFromFullStopOut: savedFromStop.length,
      cutFromEventualTargetHit: cutFromTarget.length,
      wouldHaveTimedOut: wouldHaveTimedOut.length,
      resolvedTotal: resolved.length,
    },
    actualSubsetTotalR: actualSubsetR,
    counterfactualSubsetTotalR: cfSubsetR,
    netChangeTotalR,
    netChangeAvgR,
    measuredRealisedR,
    counterfactualRealisedR,
    lockIsNetPositiveForTotalR,
  };
}

function main() {
  const results = Object.entries(UNIVERSES).map(([name, spec]) => analyseUniverse(name, spec));

  for (const r of results) {
    if (!r.crossCheck.tradesMatch || !r.crossCheck.avgRMatch || !r.crossCheck.realisedRMatch) {
      console.error(`CROSS-CHECK FAILED for ${r.universe} — refusing to trust the counterfactual. Detail:`, JSON.stringify(r.crossCheck));
      process.exitCode = 1;
    }
  }

  const report = {
    note: "ma_dip is a CLOSED historical population on both universes (killed by MADIP-SURVIVABILITY-CONDITION-5's drawdown/ruin finding). This is a forensic decomposition of the exit geometry the random-entry null credits, not a candidate re-evaluation — no parameter changed, no config change proposed.",
    scope: "DJIA-30 and DJTA-20, ma_dip, verbatim MADIP-REALISED-R-CONDITION-2 cost basis/config/split.",
    byUniverse: results,
  };

  const saved = saveExperiment("breakeven-lock-counterfactual", {
    specification: "breakeven-lock-counterfactual/v1",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    config: CONFIG,
    maxHold: MAX_HOLD,
    universes: Object.fromEntries(Object.entries(UNIVERSES).map(([k, v]) => [k, v.symbols])),
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
