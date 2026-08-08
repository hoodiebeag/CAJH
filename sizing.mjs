/**
 * sizing.mjs — reusable position-sizing equity-curve simulation for research.
 *
 * Pure/deterministic: consumes an already-decided chronological trade list
 * (each trade already has its realized R-multiple); it does not generate
 * trades or entry signals, and is independent of any specific entry family.
 *
 * Sizing rules:
 *   fixed         — every trade commits baseUnit capital.
 *   martingale    — capital doubles after each consecutive losing trade
 *                    (r <= 0), resets to baseUnit after a winning trade,
 *                    capped at baseUnit * 2^cap.
 *   antimartingale — capital doubles after each consecutive winning trade
 *                    (r > 0), resets to baseUnit after a losing trade,
 *                    capped at baseUnit * 2^cap.
 */

const RULES = new Set(["fixed", "martingale", "antimartingale"]);

function nextMultiplier(rule, prevMultiplier, prevR, cap) {
  if (rule === "fixed" || prevR === undefined) return 1;
  const maxMultiplier = 2 ** cap;
  if (rule === "martingale") return prevR <= 0 ? Math.min(prevMultiplier * 2, maxMultiplier) : 1;
  return prevR > 0 ? Math.min(prevMultiplier * 2, maxMultiplier) : 1; // antimartingale
}

export function simulateSizedEquity(trades, { rule = "fixed", cap = 4, baseUnit = 1, startingCapital = 1, ruinFloorFraction = 0 } = {}) {
  if (!RULES.has(rule)) throw new Error(`simulateSizedEquity: unknown sizing rule "${rule}"`);

  let multiplier = 1, prevR, equity = startingCapital, peak = startingCapital, maxDrawdownPct = 0, ruin = false;
  const perTrade = [];

  for (const t of trades) {
    multiplier = nextMultiplier(rule, multiplier, prevR, cap);
    const capitalCommitted = baseUnit * multiplier;
    const pnl = t.r * capitalCommitted;
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, peak > 0 ? (equity - peak) / peak : 0);
    if (equity <= 0 || equity / startingCapital <= ruinFloorFraction) ruin = true;
    perTrade.push({ timestamp: t.timestamp, r: t.r, multiplier, capitalCommitted, pnl, equity });
    prevR = t.r;
  }

  const totalCapitalCommitted = perTrade.reduce((a, p) => a + p.capitalCommitted, 0);
  const totalPnL = perTrade.reduce((a, p) => a + p.pnl, 0);

  return {
    trades: trades.length,
    perTrade,
    equityCurve: perTrade.map((p) => p.equity),
    totalCapitalCommitted,
    totalPnL,
    avgRPerUnitCapital: totalCapitalCommitted ? totalPnL / totalCapitalCommitted : 0,
    maxDrawdownPct,
    ruin,
  };
}
