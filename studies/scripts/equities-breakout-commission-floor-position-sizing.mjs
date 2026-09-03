/**
 * EQUITIES-BREAKOUT-COMMISSION-FLOOR-POSITION-SIZING (additive, read-only research; not part
 * of the app). EQUITIES-COST-ASSUMPTION-SENSITIVITY (2026-08-22) found `breakout`'s equities
 * edge survives every plausible slippage citation, but flagged — unquantified — that IBKR's
 * real commission structure (Fixed plan: USD 0.005/share, USD 1.00/order minimum) creates a
 * floor that binds whenever a position's share count is below 200 shares. That item could not
 * quantify the effect because this backtest's R-multiple design has no share count to check the
 * floor against. This item builds the position-sizing-aware re-run it named as the natural
 * follow-on: for each pre-registered dollar position size, derive each trade's actual share
 * count from its ACTUAL per-trade entry price (not a per-symbol average), apply the real IBKR
 * commission with the $1 floor on both legs, and report net avgR at each size next to the
 * existing bps-based figure.
 *
 * Scope: `breakout` only — the one net-positive family (see EQUITIES-COST-ASSUMPTION-SENSITIVITY
 * for why `anticipate`'s sign is not in question here).
 *
 * PRE-REGISTERED position sizes (before any computation): $2,000 / $5,000 / $10,000 / $25,000 /
 * $50,000 per trade — the exact set named in this item's own task text, spanning a small retail
 * account up to a position large enough to clear most of the universe's commission-floor
 * threshold (EQUITIES-COST-ASSUMPTION-SENSITIVITY found floor-binds-below ranges ~$6.7k-$192k,
 * median ~$47.9k across the 30-symbol universe).
 *
 * Method — no new data fetch, no live IBKR Gateway call. Reads the existing
 * research-cache/equities-1d/ cache (same as EQUITIES-BASELINE-PORT /
 * EQUITIES-COST-ASSUMPTION-SENSITIVITY) and re-runs `breakout` UNMODIFIED through backtest.js at
 * the same per-symbol commission rate and 5bps default slippage as the original. backtest.js's
 * `excursions[]` now exposes each closed trade's fixed entry price and risk-per-share alongside
 * its net R (added in this item, additive fields only — see backtest.js's excursions comment
 * and the new assertions in backtest.test.mjs; existing consumers untouched, no shape change to
 * anything they already read).
 *
 * For a trade with recorded net R (`r`, at the original bps-based commission), entry price
 * (`entry`), risk-per-share (`risk`), and final exit price (`exitPrice`):
 *   feeR_old        = feeRate * (entry + exitPrice) / risk         — the bps-based two-sided
 *                      commission cost already baked into `r` (backtest.js's own formula).
 *   shares           = floor(positionSizeUSD / entry)               — whole shares only, can't
 *                      buy fractional shares on a standard IBKR account.
 *   commissionR_new = (2 * max(shares * 0.005, 1.00)) / (shares * risk)
 *                      — real per-order commission (entry leg + exit leg, same share count both
 *                      legs since this backtest has no partial exits configured — see below),
 *                      converted to R by dividing by the trade's actual dollar risk at that
 *                      share count (shares * risk-per-share), matching how R is defined
 *                      throughout this codebase (dollar P&L / dollar risk).
 *   newR             = r + feeR_old - commissionR_new
 * This exactly reverses backtest.js's own bps-fee term and substitutes the real stepped
 * commission — not an approximation, a direct algebraic identity from backtest.js's own netAt().
 *
 * Caveat on the exitPrice/entry/risk fields (documented in backtest.js): they describe the
 * FINAL closing leg and the FIXED entry/risk, not a blend across partial exits. BREAKOUT_CONFIG
 * below has no partialAtR configured (matches EQUITIES-BASELINE-PORT/EQUITIES-COST-ASSUMPTION-
 * SENSITIVITY exactly), so every trade closes in one leg and this caveat doesn't bite here.
 *
 * If a position size is smaller than a trade's own entry price (shares = 0), that trade cannot
 * be taken at that size on a whole-share account — excluded from that size's pooled avgR, not
 * silently treated as free or as a loss. Counted and reported per size.
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../../backtest.js";
import { saveExperiment } from "../../researchlab.mjs";

const UNIVERSE = [
  "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
  "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
  "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
];

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005; // IBKR Fixed plan, USD/share — unchanged from EQUITIES-BASELINE-PORT
const COMMISSION_MINIMUM_USD = 1.00; // IBKR Fixed plan minimum per order, each leg
const SLIPPAGE_PCT_DEFAULT = 0.0005; // EQUITIES-BASELINE-PORT's own baseline (5bps/side), unchanged

const BREAKOUT_CONFIG = { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true };

// Pre-registered before any computation — see file header.
const POSITION_SIZES_USD = [2000, 5000, 10000, 25000, 50000];

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

function main() {
  const perSymbolTrades = []; // flat list of { symbol, r, entry, risk, exitPrice, feeRate }
  let datasetsUsed = 0;

  for (const symbol of UNIVERSE) {
    const candles = loadCached(symbol);
    if (!candles || candles.length < 100) {
      console.error(`SKIP ${symbol}: no usable cache (needs EQUITIES-BASELINE-PORT's cache to have been populated first)`);
      continue;
    }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose; // per-side, unchanged from EQUITIES-BASELINE-PORT / EQUITIES-COST-ASSUMPTION-SENSITIVITY

    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...BREAKOUT_CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_DEFAULT });
    datasetsUsed++;
    for (const x of r.excursions) {
      perSymbolTrades.push({ symbol, r: x.r, entry: x.entry, risk: x.risk, exitPrice: x.exitPrice, feeRate });
    }
  }

  if (perSymbolTrades.length === 0) {
    throw new Error("No cached equities data found in research-cache/equities-1d/ — this study requires EQUITIES-BASELINE-PORT's cache to already exist. Refusing to fetch live (this item is scoped no-egress).");
  }

  // Baseline bps-based figure, for direct comparison — must reproduce EQUITIES-COST-ASSUMPTION-
  // SENSITIVITY's own netDefaultAvgR bit-for-bit off the same cache.
  const baselineTrades = perSymbolTrades.length;
  const baselineTotalR = perSymbolTrades.reduce((a, t) => a + t.r, 0);
  const baselineAvgR = baselineTotalR / baselineTrades;

  const sizeResults = POSITION_SIZES_USD.map((sizeUSD) => {
    let included = 0, excludedTooSmall = 0, totalNewR = 0;
    for (const t of perSymbolTrades) {
      const shares = Math.floor(sizeUSD / t.entry);
      if (shares < 1) { excludedTooSmall++; continue; }
      const feeR_old = t.feeRate * (t.entry + t.exitPrice) / t.risk;
      const commissionDollarsPerLeg = Math.max(shares * COMMISSION_PER_SHARE, COMMISSION_MINIMUM_USD);
      const commissionR_new = (2 * commissionDollarsPerLeg) / (shares * t.risk);
      const newR = t.r + feeR_old - commissionR_new;
      totalNewR += newR;
      included++;
    }
    const netAvgR = included ? totalNewR / included : null;
    return {
      positionSizeUSD: sizeUSD,
      tradesIncluded: included,
      tradesExcludedTooSmall: excludedTooSmall,
      netAvgR,
    };
  });

  // Smallest pre-registered size at which the commission floor drags the result to breakeven
  // or negative (sizes are ascending, so the first non-positive entry is the answer).
  const dragsToBreakevenOrNegativeAt = sizeResults.find((s) => s.netAvgR !== null && s.netAvgR <= 0)?.positionSizeUSD ?? null;

  const report = {
    family: "breakout",
    split: SPLIT,
    universeSize: UNIVERSE.length,
    datasetsUsed,
    commissionPerShare: COMMISSION_PER_SHARE,
    commissionMinimumUSD: COMMISSION_MINIMUM_USD,
    slippagePctDefault: SLIPPAGE_PCT_DEFAULT,
    baselineBpsBased: { trades: baselineTrades, avgR: baselineAvgR },
    positionSizesUSD: POSITION_SIZES_USD,
    sizeResults,
    dragsToBreakevenOrNegativeAt,
  };

  const saved = saveExperiment("equities-breakout-commission-floor-position-sizing", {
    specification: "equities-breakout-commission-floor-position-sizing/v1",
    universe: UNIVERSE,
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    commissionMinimumUSD: COMMISSION_MINIMUM_USD,
    slippagePctDefault: SLIPPAGE_PCT_DEFAULT,
    positionSizesUSD: POSITION_SIZES_USD,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
