/**
 * cost-model.mjs — PWR5-MAKER-FILL-COST-REDUCTION Phase 1: realistic execution-cost
 * modeling for both Kraken spot and Kraken Futures, replacing the flat
 * FEE_RATE/SLIPPAGE_PCT taker assumption in strategy.js/backtest.js for scenarios that
 * want to test maker or futures execution instead.
 *
 * Fee figures below are hardcoded from Kraken's live public fee-schedule pages, verified
 * 2026-08-13 (see cost-model.test.mjs for the values under test) - re-verify before
 * trusting them again if this file is reused much later; Kraken revises tiers over time,
 * the same discipline FEE-SCHEDULE-REBASE already established for the spot taker rate.
 *
 * Research-only. Nothing here places an order or touches trader.js/scanner.js's live
 * execution path - it produces cost estimates for backtest.js/tournament.mjs to consume.
 */

// ─── Fee schedules (verified against kraken.com 2026-08-13) ────────────────────────────

// Spot Tier 1 (retail, $0+ 30-day volume). Matches strategy.js's FEE_RATE=0.008 already.
export const SPOT_FEE_SCHEDULE = Object.freeze({
  taker: 0.0080,             // 0.80%/side, all pairs
  maker: 0.0040,             // 0.40%/side, standard pairs
  makerRebateEligible: 0.0038, // 0.38%/side, select lower-liquidity pairs on Kraken's maker-rebate program
});

// Kraken Futures, all volume tiers (rows below $5M are folded into "$0+" since this
// project trades well under institutional volume). Source: Kraken derivatives fee
// schedule, verified live 2026-08-13.
export const FUTURES_FEE_SCHEDULE = Object.freeze([
  { minVolume30d: 0, maker: 0.00020, taker: 0.00050 },
  { minVolume30d: 5_000_000, maker: 0.000175, taker: 0.00045 },
  { minVolume30d: 10_000_000, maker: 0.00015, taker: 0.00040 },
  { minVolume30d: 15_000_000, maker: 0.000125, taker: 0.00035 },
  { minVolume30d: 25_000_000, maker: 0.00010, taker: 0.00030 },
  { minVolume30d: 50_000_000, maker: 0.00005, taker: 0.00025 },
  { minVolume30d: 100_000_000, maker: 0.00000, taker: 0.00020 },
]);

export function spotFee({ makerRebateEligible = false } = {}) {
  return {
    taker: SPOT_FEE_SCHEDULE.taker,
    maker: makerRebateEligible ? SPOT_FEE_SCHEDULE.makerRebateEligible : SPOT_FEE_SCHEDULE.maker,
  };
}

/** Walks FUTURES_FEE_SCHEDULE for the tier matching a given trailing 30-day volume (default: retail Tier 1). */
export function futuresFee({ volume30d = 0 } = {}) {
  let tier = FUTURES_FEE_SCHEDULE[0];
  for (const row of FUTURES_FEE_SCHEDULE) {
    if (volume30d >= row.minVolume30d) tier = row; else break;
  }
  return { taker: tier.taker, maker: tier.maker };
}

// ─── Funding cost ────────────────────────────────────────────────────────────────────

/**
 * Sum of funding payments/receipts over a holding period, in fraction-of-notional terms
 * (same units as fee rates, so it composes directly into a per-trade cost figure).
 *
 * fundingRates: [{ timestamp: <ms epoch>, fundingRate: <relative rate, fraction> }], the
 * shape derivatives.mjs's fetchFundingRates()/funding.mjs already produce (relativeFundingRate).
 * Longs PAY positive funding and RECEIVE negative funding; shorts are the mirror image -
 * this matches Kraken Futures' standard perpetual funding convention.
 */
export function fundingCost({ fundingRates = [], entryTs, exitTs, side = "long" } = {}) {
  if (!Number.isFinite(entryTs) || !Number.isFinite(exitTs) || exitTs < entryTs) {
    throw new Error("fundingCost: entryTs/exitTs must be finite with exitTs >= entryTs");
  }
  const sign = side === "long" ? 1 : -1;
  let total = 0;
  for (const { timestamp, fundingRate } of fundingRates) {
    if (timestamp >= entryTs && timestamp < exitTs && Number.isFinite(fundingRate)) {
      total += sign * fundingRate;
    }
  }
  return total;
}

// ─── Post-only enforcement ───────────────────────────────────────────────────────────

/**
 * A resting limit order that would cross the spread on arrival is rejected, not silently
 * converted to a taker fill - this mirrors Kraken's post-only order flag. Returns true if
 * the order would be rejected.
 */
export function isPostOnlyRejected({ side, limitPrice, bestBid, bestAsk } = {}) {
  if (side === "buy") return limitPrice >= bestAsk;
  if (side === "sell") return limitPrice <= bestBid;
  throw new Error(`isPostOnlyRejected: side must be "buy" or "sell", got ${side}`);
}

// ─── Touch-based limit-fill simulator (grounded in real OHLC bars) ──────────────────────

/**
 * Given a chronological run of real OHLC bars (candles/*.csv shape: {time,open,high,low,close}
 * with numeric or string fields; only high/low/time are used) starting at the bar AFTER the
 * order was placed, decide whether/when a resting limit order fills.
 *
 * Deterministic touch model: a buy limit fills the first bar whose low <= limitPrice; a sell
 * limit fills the first bar whose high >= limitPrice. This is the standard conservative
 * backtesting convention (same "worst case wins" spirit as backtest.js's stop-before-target
 * tie-break) - it does not assume queue priority within the bar, just that price traded there.
 *
 * adverseWindowBars: after a fill, look this many further bars ahead and report the worst
 * price move against the position's fill (the "adverse selection" a maker filled into) -
 * i.e. for a buy fill, the lowest subsequent low; for a sell fill, the highest subsequent high.
 * Missed signals (never touched within maxWaitBars) are reported, not silently dropped or
 * force-converted to a taker fill - the caller decides what a miss means for its own study.
 */
export function simulateLimitFill({ bars, side, limitPrice, maxWaitBars = Infinity, adverseWindowBars = 5 } = {}) {
  if (!Array.isArray(bars) || bars.length === 0) throw new Error("simulateLimitFill: bars must be a non-empty array");
  if (side !== "buy" && side !== "sell") throw new Error(`simulateLimitFill: side must be "buy" or "sell", got ${side}`);

  const limit = Math.min(bars.length, maxWaitBars);
  for (let i = 0; i < limit; i++) {
    const bar = bars[i];
    const low = Number(bar.low), high = Number(bar.high);
    const touched = side === "buy" ? low <= limitPrice : high >= limitPrice;
    if (!touched) continue;

    let adverseExtreme = side === "buy" ? limitPrice : limitPrice;
    for (let j = i; j < Math.min(bars.length, i + 1 + adverseWindowBars); j++) {
      const jLow = Number(bars[j].low), jHigh = Number(bars[j].high);
      if (side === "buy") adverseExtreme = Math.min(adverseExtreme, jLow);
      else adverseExtreme = Math.max(adverseExtreme, jHigh);
    }
    const adverseMovePct = side === "buy"
      ? (adverseExtreme - limitPrice) / limitPrice   // negative = price kept falling after the fill
      : (limitPrice - adverseExtreme) / limitPrice;  // negative = price kept rising after the fill

    return { filled: true, fillBarIndex: i, fillPrice: limitPrice, adverseMovePct };
  }
  return { filled: false, fillBarIndex: null, fillPrice: null, adverseMovePct: null };
}
