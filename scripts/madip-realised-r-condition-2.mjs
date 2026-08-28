/**
 * MADIP-REALISED-R-CONDITION-2 (additive, read-only diagnostic, cache-only — no IBKR egress).
 *
 * ALPHA_DEFINITION.md section 4b lists condition 2 (win-rate margin) for `ma_dip` as
 * "not evaluated": "Condition 2 needs realised R, not `ma_dip`'s `tpR: 5` target. Breakeven
 * at a true R of 5 is a 16.7% win rate, but breakeven locks and timeouts truncate winners, so
 * realised R is systematically lower and the real breakeven is higher. The margin is uncomputed."
 * This item computes that margin, on both equity universes `ma_dip` has been scored on
 * (EQUITIES-MADIP-SIGNIFICANCE's DJIA-30 holdout, EQUITIES-MADIP-OUT-OF-SAMPLE's DJTA-20
 * holdout), reported separately, and decomposes realised R by exit reason.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * DEFINITIONS: realised R = mean(winning trade R) / mean(|losing trade R|), where a "win" is
 * net R > 0 and a "loss" is net R <= 0 (a trade closing at exactly breakeven, r == 0, counts as
 * a loss for this split — it did not clear the cost of the round trip). Real breakeven win rate
 * = 1 / (1 + realisedR). Margin = observed win rate - breakeven win rate, in percentage points.
 * ALPHA_DEFINITION's condition 2 explicitly requires this margin to be pre-registered BEFORE the
 * holdout is scored; that was not done when `ma_dip` was first run (EQUITIES-MADIP-SIGNIFICANCE,
 * 2026-08-22), so a threshold cannot legitimately be invented after the fact here. This item
 * reports the margin and an honest noise assessment instead of a pass/fail against an
 * after-the-fact number: a two-sided 95% Wald interval on the observed win rate
 * (p +/- 1.96*sqrt(p*(1-p)/n)) is compared against the breakeven win rate — if breakeven falls
 * inside that interval, the margin is not distinguishable from the estimate's own sampling noise.
 * EXIT-REASON DECOMPOSITION: backtest.js's `why` (added by this item, purely additive — see the
 * excursions.push comment in backtest.js) is attached per-trade already. Reported as share of
 * trades and share of total R per reason, to show whether the R shortfall against tpR:5's target
 * comes mostly from `lockBreakeven` ("trail/be" in backtest.js's naming — `ma_dip`'s config sets
 * no trailR/trailStartR, so `trailing` never becomes true and "trail/be" here means the breakeven
 * lock specifically, not a trailing stop) or from `timeout` (maxHold=100 bars, unmodified,
 * censoring per WIDE-STOP-HIGH-TARGET-ASYMMETRY's prior finding that this can matter).
 * COST BASIS, UNIVERSE, CONFIG, SPLIT: verbatim from EQUITIES-MADIP-SIGNIFICANCE (DJIA-30) and
 * EQUITIES-MADIP-OUT-OF-SAMPLE (DJTA-20) — IBKR Fixed plan $0.005/share commission (per-symbol,
 * converted via that symbol's own holdout avgClose), 5bps/side slippage, 70/30 split,
 * `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`. No parameter is changed here under any circumstance — this is
 * a decomposition of the existing candidate's own trades, not a re-tune.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

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

function analyseUniverse(name, { cacheDir, symbols }) {
  const excursions = [];
  let backtestTotalR = 0;
  let datasetsUsed = 0;
  for (const symbol of symbols) {
    const candles = loadCached(cacheDir, symbol);
    if (!candles) { console.error(`MISSING CACHE [${name}]: ${symbol} — cache-only by design, no re-fetch`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP [${name}] ${symbol}: holdout too short (${holdout.length})`); continue; }
    datasetsUsed++;
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    backtestTotalR += r.totalR;
    excursions.push(...r.excursions);
  }

  const trades = excursions.length;
  const totalR = excursions.reduce((a, x) => a + x.r, 0);
  // Sanity check, this project's own standing discipline: verify the per-trade series this
  // script pools independently reproduces backtestMultiTF's own totalR, rather than trusting
  // that excursions and results stay in sync.
  const totalRMatchesBacktest = Math.abs(totalR - backtestTotalR) < 1e-9;

  const wins = excursions.filter((x) => x.r > 0);
  const losses = excursions.filter((x) => x.r <= 0);
  const avgWin = wins.length ? wins.reduce((a, x) => a + x.r, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, x) => a + Math.abs(x.r), 0) / losses.length : null;
  const realisedR = avgWin != null && avgLoss ? avgWin / avgLoss : null;
  const breakevenWinRate = realisedR != null ? 1 / (1 + realisedR) : null;
  const observedWinRate = trades ? wins.length / trades : null;
  const marginPP = realisedR != null && observedWinRate != null ? (observedWinRate - breakevenWinRate) * 100 : null;

  // Two-sided 95% Wald interval on the observed win rate — is breakeven inside the estimate's
  // own noise? A screening approximation (Wald, not Wilson/exact), stated as such.
  let waldLo = null, waldHi = null, breakevenInsideNoise = null;
  if (observedWinRate != null && trades) {
    const se = Math.sqrt(observedWinRate * (1 - observedWinRate) / trades);
    waldLo = observedWinRate - 1.96 * se;
    waldHi = observedWinRate + 1.96 * se;
    breakevenInsideNoise = breakevenWinRate != null ? breakevenWinRate >= waldLo && breakevenWinRate <= waldHi : null;
  }

  // Exit-reason breakdown: share of trades and share of total R per `why`.
  const byReason = {};
  for (const x of excursions) {
    const key = x.why || "unknown";
    if (!byReason[key]) byReason[key] = { count: 0, sumR: 0 };
    byReason[key].count++;
    byReason[key].sumR += x.r;
  }
  const exitReasonBreakdown = Object.fromEntries(
    Object.entries(byReason).map(([reason, { count, sumR }]) => [
      reason,
      {
        trades: count,
        shareOfTrades: trades ? count / trades : null,
        sumR,
        shareOfTotalR: totalR !== 0 ? sumR / totalR : null,
      },
    ])
  );
  const timeoutCensoringRate = trades ? (byReason.timeout?.count ?? 0) / trades : null;

  return {
    universe: name,
    universeSize: symbols.length,
    datasetsUsed,
    trades,
    totalR,
    avgR: trades ? totalR / trades : null,
    totalRMatchesBacktest,
    wins: wins.length,
    losses: losses.length,
    avgWin,
    avgLoss,
    realisedR,
    configuredTpR: CONFIG.tpR,
    breakevenWinRate,
    observedWinRate,
    marginPP,
    observedWinRateWald95: { lo: waldLo, hi: waldHi },
    breakevenInsideNoise,
    exitReasonBreakdown,
    timeoutCensoringRate,
  };
}

function main() {
  const results = Object.entries(UNIVERSES).map(([name, spec]) => analyseUniverse(name, spec));

  const report = {
    note: "Margin was NOT pre-registered before EQUITIES-MADIP-SIGNIFICANCE/EQUITIES-MADIP-OUT-OF-SAMPLE scored their holdouts, and cannot retrospectively be — ALPHA_DEFINITION condition 2 requires pre-registration, which this item cannot satisfy after the fact. This reports the margin and an honest noise assessment (observedWinRateWald95 vs breakevenWinRate) in place of a pass/fail.",
    byUniverse: results,
  };

  const saved = saveExperiment("madip-realised-r-condition-2", {
    specification: "madip-realised-r-condition-2/v1",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    config: CONFIG,
    universes: Object.fromEntries(Object.entries(UNIVERSES).map(([k, v]) => [k, v.symbols])),
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
