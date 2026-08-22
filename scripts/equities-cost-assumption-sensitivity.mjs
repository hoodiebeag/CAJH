/**
 * EQUITIES-COST-ASSUMPTION-SENSITIVITY (additive, read-only research; not part of the app).
 * EQUITIES-BASELINE-PORT reported `breakout` net +0.1866R over 61 holdout trades on real IBKR
 * costs — the first net-positive real-cost result in this project's history (see ROADMAP.md
 * 2026-08-19). Two components of that cost basis were stated as ASSUMPTIONS, not measurements:
 *   - slippage/spread: 0.0005 (5bps) per side, called "a deliberately conservative estimate" in
 *     the original writeup, not measured from IBKR's own NBBO tick history.
 *   - the USD 1.00/order commission minimum: NOT modeled at all, because this backtest works in
 *     R-multiples with no share count to check the floor against.
 * This item maps how far the slippage assumption can move before the net result crosses zero,
 * and separately reasons (not simulates — there is no share count in this backtest to simulate
 * against) about the position size at which the unmodeled commission floor would start to bind.
 * It does NOT change EQUITIES-BASELINE-PORT's own recorded cost basis or headline number.
 *
 * Scope: `breakout` only (the one net-positive family; `anticipate` is already net negative,
 * -0.0438R, so its sign is not in question here — see EQUITIES-BREAKOUT-SIGNIFICANCE, closed).
 *
 * Method — reuses the linear-cost identity already established and re-verified twice in this
 * project (COST-COMPONENT-ATTRIBUTION; re-verified per-symbol by
 * HOLDING-PERIOD-COST-AMORTIZATION-MAP; reused for a 2-D grid by COST-SENSITIVITY-SURFACE):
 * backtest.js's net-R formula is affine in slipPct with a per-trade coefficient that does not
 * itself depend on slipPct, and cost never changes which trades fire. Commission is held FIXED
 * at EQUITIES-BASELINE-PORT's own per-symbol rate (commissionPerShare / that symbol's own
 * average holdout close) throughout — only slippage varies. That means:
 *   netAvgR(slip) = feeOnlyAvgR - slipUnitDragAvgR * slip
 * where feeOnlyAvgR = avgR at the fixed per-symbol commission rate with slip=0, and
 * slipUnitDragAvgR = (feeOnlyAvgR - netDefaultAvgR) / SLIPPAGE_PCT_EQUITY, both derived from two
 * backtest passes (not fit or eyeballed). Every grid point below is ALSO re-run directly through
 * backtest.js (not just evaluated analytically) so the linear formula is checked, not assumed;
 * discrepancy is reported per grid point.
 *
 * Slippage grid — spans plausible large-cap values through clearly pessimistic ones, same
 * citations as EQUITIES-BASELINE-PORT's own header:
 *   0bps (idealized, no spread crossed) / 2bps / 4.5bps (2024 Nasdaq Research institutional
 *   S&P 500 market-impact figure) / 5bps (EQUITIES-BASELINE-PORT's own baseline assumption) /
 *   10bps / 15bps (upper end of the "penny wide" large-cap range commonly cited) / 20bps / 30bps
 *   / 50bps / 100bps (clearly pessimistic — well beyond any large-cap liquidity citation, a
 *   stress point only).
 *
 * Commission-floor reasoning (not simulated — stated arithmetic against real cited figures).
 * IBKR Fixed plan: USD 0.005/share, USD 1.00 minimum per order (EQUITIES-BASELINE-PORT header).
 * The floor binds whenever an order's share count < 1.00/0.005 = 200 shares, regardless of
 * price. Converted to a dollar position size that depends on the symbol's own price level (this
 * script reuses the same per-symbol holdout avgClose EQUITIES-BASELINE-PORT already computed):
 * floorBindsBelowUSD = 200 * avgClose. Reported per-symbol (min/median/max across the 30-name
 * universe) so the human can compare against a real account's typical position size, not a
 * single made-up number standing in for all 30 different price levels.
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";

const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share — unchanged from EQUITIES-BASELINE-PORT
const COMMISSION_MINIMUM_USD = 1.00; // IBKR Fixed plan minimum per order
const SLIPPAGE_PCT_DEFAULT = 0.0005; // EQUITIES-BASELINE-PORT's own baseline (5bps/side)

const BREAKOUT_CONFIG = { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };

const SLIP_GRID = [
  ["0bps (idealized)", 0],
  ["2bps", 0.0002],
  ["4.5bps (Nasdaq Research institutional impact)", 0.00045],
  ["5bps (baseline default)", 0.0005],
  ["10bps", 0.0010],
  ["15bps (upper 'penny wide' large-cap range)", 0.0015],
  ["20bps", 0.0020],
  ["30bps", 0.0030],
  ["50bps (pessimistic)", 0.0050],
  ["100bps (stress point, not a realistic large-cap estimate)", 0.0100],
];

const cacheDir = path.join(".", "research-cache", "equities-1d");

function loadCached(symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return {
    train: candles.filter((c) => +c.time < cut),
    holdout: candles.filter((c) => +c.time >= cut),
  };
}

function pooledAvgR(perSymbol) {
  const trades = perSymbol.reduce((a, x) => a + x.trades, 0);
  const totalR = perSymbol.reduce((a, x) => a + x.totalR, 0);
  return { trades, totalR, avgR: trades ? totalR / trades : 0 };
}

function runAt(datasets, slipPct) {
  const perSymbol = datasets.map((d) => {
    const series = [{ label: "1d", mins: 1440, candles: d.holdout }];
    const r = backtestMultiTF({ series }, { ...BREAKOUT_CONFIG, entryTf: "1d", feeRate: d.feeRate, slipPct });
    return { symbol: d.symbol, trades: r.trades, totalR: r.totalR };
  });
  return { perSymbol, pooled: pooledAvgR(perSymbol) };
}

function main() {
  const datasets = [];
  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles || candles.length < 100) {
      console.error(`SKIP ${symbol}: no usable cache (needs EQUITIES-BASELINE-PORT's cache to have been populated first)`);
      continue;
    }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose; // per-side, unchanged from EQUITIES-BASELINE-PORT
    const floorBindsBelowUSD = (COMMISSION_MINIMUM_USD / COMMISSION_PER_SHARE) * avgClose; // 200 shares * price
    datasets.push({ symbol, holdout, avgClose, feeRate, floorBindsBelowUSD });
  }

  if (datasets.length === 0) {
    throw new Error("No cached equities data found in research-cache/equities-1d/ — this study requires EQUITIES-BASELINE-PORT's cache to already exist. Refusing to fetch live (this item is scoped no-egress).");
  }

  // Analytic derivation: two passes, fee held fixed at each symbol's own commission rate.
  const feeOnly = runAt(datasets, 0);
  const netDefault = runAt(datasets, SLIPPAGE_PCT_DEFAULT);
  const slipUnitDragAvgR = (feeOnly.pooled.avgR - netDefault.pooled.avgR) / SLIPPAGE_PCT_DEFAULT;
  const analytic = (slip) => feeOnly.pooled.avgR - slipUnitDragAvgR * slip;

  const TOLERANCE = 1e-9;
  const grid = SLIP_GRID.map(([label, slip]) => {
    const direct = runAt(datasets, slip).pooled;
    const analyticAvgR = analytic(slip);
    const discrepancy = analyticAvgR - direct.avgR;
    return {
      label, slip,
      trades: direct.trades,
      directAvgR: direct.avgR,
      analyticAvgR,
      discrepancy,
      withinTolerance: Math.abs(discrepancy) < TOLERANCE,
    };
  });

  // Break-even: netAvgR(slip*) = 0  =>  slip* = feeOnlyAvgR / slipUnitDragAvgR (linear, exact).
  const breakEvenSlip = slipUnitDragAvgR !== 0 ? feeOnly.pooled.avgR / slipUnitDragAvgR : null;
  const breakEvenWithinGrid = breakEvenSlip !== null && breakEvenSlip >= 0;
  const currentlyPositiveAtDefault = grid.find((g) => g.slip === SLIPPAGE_PCT_DEFAULT)?.directAvgR > 0;

  const floorStats = datasets.map((d) => d.floorBindsBelowUSD).sort((a, b) => a - b);
  const floorMin = floorStats[0];
  const floorMax = floorStats[floorStats.length - 1];
  const floorMedian = floorStats[Math.floor(floorStats.length / 2)];

  const report = {
    family: "breakout",
    split: SPLIT,
    universeSize: UNIVERSE.length,
    datasetsUsed: datasets.length,
    commissionPerShare: COMMISSION_PER_SHARE,
    commissionMinimumUSD: COMMISSION_MINIMUM_USD,
    slippagePctDefault: SLIPPAGE_PCT_DEFAULT,
    trades: netDefault.pooled.trades,
    feeOnlyAvgR: feeOnly.pooled.avgR,
    netDefaultAvgR: netDefault.pooled.avgR,
    slipUnitDragAvgR,
    grid,
    breakEvenSlip,
    breakEvenWithinGrid,
    currentlyPositiveAtDefault,
    commissionFloor: {
      sharesThreshold: COMMISSION_MINIMUM_USD / COMMISSION_PER_SHARE,
      perSymbolFloorBindsBelowUSD: datasets.map((d) => ({ symbol: d.symbol, avgClose: d.avgClose, floorBindsBelowUSD: d.floorBindsBelowUSD })),
      floorBindsBelowUSD_min: floorMin,
      floorBindsBelowUSD_median: floorMedian,
      floorBindsBelowUSD_max: floorMax,
    },
  };

  const saved = saveExperiment("equities-cost-assumption-sensitivity", {
    specification: "equities-cost-assumption-sensitivity/v1",
    universe: UNIVERSE,
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    commissionMinimumUSD: COMMISSION_MINIMUM_USD,
    slipGrid: SLIP_GRID.map(([label, slip]) => ({ label, slip })),
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
