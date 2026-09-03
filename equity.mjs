/**
 * equity.mjs — turn a stream of R-multiples into an account balance.
 *
 * WHY THIS DID NOT EXIST. Every study in this project reports average R. R is a risk-normalised
 * unit and it deliberately hides three things that decide what an account is actually worth:
 * the ORDER trades arrive in, how much capital each one risked, and what happens when the account
 * is smaller after a drawdown. Two strategies with identical mean R can end the period at very
 * different balances, and the one with the better average can be the poorer one to have owned.
 *
 * WHAT THIS MODEL ASSUMES, all of which are choices rather than facts:
 *  - Risk is a FIXED FRACTION of the current balance (compounding). After losses you risk less in
 *    dollars, which is what any sane risk manager does and what makes ruin asymptotic rather than
 *    certain. `fixedFractional: false` risks a constant dollar amount off the starting balance
 *    instead, and the gap between the two is worth looking at.
 *  - Trades are taken SEQUENTIALLY by entry time. Real portfolios hold several at once and share
 *    capital between them; this does not model that, so it will overstate an account that would
 *    have hit a position cap.
 *  - Costs are already inside R. `backtest.js` returns net R, so nothing is charged again here.
 *
 * WHAT IT IS NOT. A high final balance from a parameter search is not evidence of an edge. It is
 * the outcome of one path, and picking the best of many paths chosen on the same data is how you
 * manufacture one. `runsTested` exists so that the number of configurations behind a leaderboard
 * entry travels with it.
 */

export const DEFAULTS = Object.freeze({
  startingBalance: 1000, riskPct: 0.005, fixedFractional: true,
  // Fixed-fractional sizing can never mathematically reach zero: risking half of whatever is left
  // leaves half. Fifty straight losses at 50% risk ends at 8.9e-13 dollars, which is not zero and
  // so would report ruined:false while being, in every sense that matters, a wiped-out account.
  // Anything below this fraction of the starting balance is reported as effectively ruined.
  ruinThresholdPct: 0.01,
});

/**
 * Walk trades in time order and report the account's path.
 *
 * `trades` may be canonical evallib records or bare `{ netR, entryTime }`. Sorting is by entry
 * time, and trades with no entry time are a hard error rather than an implicit ordering — the
 * order IS the result here, so guessing it would silently change the answer.
 */
export function simulateEquity(trades, opts = {}) {
  const { startingBalance, riskPct, fixedFractional, ruinThresholdPct } = { ...DEFAULTS, ...opts };
  if (!(startingBalance > 0)) throw new Error("simulateEquity: startingBalance must be positive");
  if (!(riskPct > 0 && riskPct < 1)) throw new Error("simulateEquity: riskPct must be between 0 and 1");

  const rows = trades.map((t, i) => {
    const r = Number(t.netR ?? t.r);
    const at = Number(t.entryTime);
    if (!Number.isFinite(r)) throw new Error(`simulateEquity: trade ${i} has no finite netR`);
    if (!Number.isFinite(at)) throw new Error(`simulateEquity: trade ${i} has no entryTime; order decides the result and must not be guessed`);
    return { r, at, symbol: t.symbol ?? null };
  }).sort((a, b) => a.at - b.at);

  let balance = startingBalance, peak = startingBalance, maxDD = 0, ruined = false;
  const ruinFloor = startingBalance * ruinThresholdPct;
  let effectivelyRuinedAt = null;
  const curve = [];
  for (const row of rows) {
    const riskDollars = fixedFractional ? balance * riskPct : startingBalance * riskPct;
    balance += row.r * riskDollars;
    if (balance <= 0) { balance = 0; ruined = true; curve.push({ at: row.at, balance }); break; }
    if (effectivelyRuinedAt === null && balance < ruinFloor) effectivelyRuinedAt = row.at;
    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDD) maxDD = dd;
    curve.push({ at: row.at, balance });
  }

  const years = rows.length > 1 ? (rows[rows.length - 1].at - rows[0].at) / (365.25 * 86400000) : 0;
  return {
    startingBalance, finalBalance: balance, trades: rows.length,
    totalReturnPct: (balance / startingBalance - 1) * 100,
    cagrPct: years > 0 && balance > 0 ? ((balance / startingBalance) ** (1 / years) - 1) * 100 : null,
    maxDrawdownPct: maxDD * 100,
    ruined,
    // The honest ruin flag. `ruined` alone is a mathematical statement about hitting zero and,
    // under fixed-fractional sizing, is almost never true however badly the account is destroyed.
    effectivelyRuined: effectivelyRuinedAt !== null || ruined,
    effectivelyRuinedAt: effectivelyRuinedAt ? new Date(effectivelyRuinedAt).toISOString().slice(0, 10) : null,
    ruinThreshold: ruinFloor,
    years,
    firstTrade: rows.length ? new Date(rows[0].at).toISOString().slice(0, 10) : null,
    lastTrade: rows.length ? new Date(rows[rows.length - 1].at).toISOString().slice(0, 10) : null,
    curve,
  };
}

/**
 * Rank configurations by final balance, carrying the count of everything tried.
 *
 * The count is not decoration. A leaderboard's top entry out of 400 configurations is a very
 * different claim from the same balance out of 3, and reporting the balance without the
 * denominator is how a search result becomes a "finding".
 */
export function leaderboard(results, { runsTested = results.length } = {}) {
  const ranked = [...results].sort((a, b) => b.finalBalance - a.finalBalance);
  return {
    runsTested,
    ranked,
    best: ranked[0] ?? null,
    selectionNote: `Best of ${runsTested} configurations tested on the same data. With that many ` +
      `looks, the top result is expected to look good whether or not any edge exists; treat the ` +
      `figure as a search outcome, not as evidence, until it is checked on data not used to pick it.`,
  };
}
