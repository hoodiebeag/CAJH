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
  // Volatility targeting, off by default. null = size every trade at riskPct, the original
  // behaviour. A number is the daily ATR-as-a-fraction-of-price the book is sized toward.
  volTarget: null,
  // Hard limit on how far volatility targeting may scale a bet in either direction, as a multiple
  // of riskPct. Without it a quiet pair sizes up without bound.
  volClamp: 3,
  // Maximum positions open at once. null = unlimited, which is what this simulator did before and
  // is not what a book does. See the note in simulateEquity.
  maxConcurrent: null,
});

/**
 * Walk trades in time order and report the account's path.
 *
 * `trades` may be canonical evallib records or bare `{ netR, entryTime }`. Sorting is by entry
 * time, and trades with no entry time are a hard error rather than an implicit ordering — the
 * order IS the result here, so guessing it would silently change the answer.
 */
export function simulateEquity(trades, opts = {}) {
  const { startingBalance, riskPct, fixedFractional, ruinThresholdPct, volTarget, volClamp, maxConcurrent } = { ...DEFAULTS, ...opts };
  if (!(startingBalance > 0)) throw new Error("simulateEquity: startingBalance must be positive");
  if (!(riskPct > 0 && riskPct < 1)) throw new Error("simulateEquity: riskPct must be between 0 and 1");

  const rows = trades.map((t, i) => {
    const r = Number(t.netR ?? t.r);
    const at = Number(t.entryTime);
    if (!Number.isFinite(r)) throw new Error(`simulateEquity: trade ${i} has no finite netR`);
    if (!Number.isFinite(at)) throw new Error(`simulateEquity: trade ${i} has no entryTime; order decides the result and must not be guessed`);
    return { r, at, symbol: t.symbol ?? null, atrPct: Number(t.atrPct), exitTime: Number(t.exitTime) };
  }).sort((a, b) => a.at - b.at);

  // Volatility targeting. Fixed-fractional sizing already equalises risk PER STOP, and because a
  // structural stop sits roughly a volatility unit away the two are close -- but not the same, and
  // where they diverge this scales the bet toward a constant volatility contribution instead:
  //   riskPct_i = riskPct * volTarget / atrPct_i,  clamped to [1/volClamp, volClamp] of riskPct.
  // The clamp is not optional. A pair whose ATR is 0.2% of price would otherwise be sized twenty
  // times the base risk on the strength of one quiet week, which is how a volatility-targeted book
  // discovers that quiet and safe are different words.
  let unscaledForMissingVol = 0;
  if (volTarget !== null) {
    if (!(volTarget > 0)) throw new Error("simulateEquity: volTarget must be positive when set");
    if (!(volClamp >= 1)) throw new Error("simulateEquity: volClamp must be at least 1");
    unscaledForMissingVol = rows.filter((row) => !(row.atrPct > 0)).length;
    // A trade entered before its pair's ATR window has filled genuinely has no volatility to size
    // against; on the short side a handful do, because no long moving-average gate is holding
    // entries back from the first bars of a series. Those are sized at the base risk and COUNTED.
    // A large fraction is a different thing entirely -- it means atrPct was never wired through --
    // and that still throws, because silently sizing an entire run flat would be invisible.
    const fraction = rows.length ? unscaledForMissingVol / rows.length : 0;
    if (fraction > 0.05) {
      throw new Error(`simulateEquity: volTarget is set but ${unscaledForMissingVol} of ${rows.length} trades `
        + `(${(100 * fraction).toFixed(1)}%) carry no atrPct — that is a wiring failure, not a warm-up edge case`);
    }
  }
  const weight = (row) => {
    if (volTarget === null || !(row.atrPct > 0)) return 1;
    return Math.min(volClamp, Math.max(1 / volClamp, volTarget / row.atrPct));
  };

  // Concurrency. This simulator compounds trades one after another in entry order, which silently
  // assumes the book is never long two things at once. It is: the engine holds one position per
  // pair across 29 pairs, and the campaign's leader peaks at 19 open at the same time -- 9.5% of
  // the account at risk simultaneously in a market that is close to one factor. Sequential
  // compounding cannot see that, so the drawdown it reports is a floor rather than a measurement.
  //
  // maxConcurrent does not fix the accounting; it constrains the book the way a real one is
  // constrained, by declining a signal when the position limit is already full. Trades declined
  // this way are counted and reported rather than quietly dropped.
  let declined = 0, peakConcurrent = 0;
  if (maxConcurrent !== null) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("simulateEquity: maxConcurrent must be a positive integer or null");
    const missing = rows.filter((row) => !Number.isFinite(row.exitTime)).length;
    if (missing) throw new Error(`simulateEquity: maxConcurrent needs exitTime on every trade; ${missing} of ${rows.length} have none`);
    const openUntil = [];
    const kept = [];
    for (const row of rows) {
      for (let i = openUntil.length - 1; i >= 0; i--) if (openUntil[i] <= row.at) openUntil.splice(i, 1);
      if (openUntil.length >= maxConcurrent) { declined++; continue; }
      openUntil.push(row.exitTime);
      if (openUntil.length > peakConcurrent) peakConcurrent = openUntil.length;
      kept.push(row);
    }
    rows.length = 0;
    rows.push(...kept);
  }

  let balance = startingBalance, peak = startingBalance, maxDD = 0, ruined = false;
  const ruinFloor = startingBalance * ruinThresholdPct;
  let effectivelyRuinedAt = null;
  const curve = [];
  for (const row of rows) {
    const riskDollars = (fixedFractional ? balance * riskPct : startingBalance * riskPct) * weight(row);
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
    declinedForConcurrency: declined,
    unscaledForMissingVol,
    peakConcurrent: maxConcurrent === null ? null : peakConcurrent,
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

/**
 * The riskPct at which a volatility-targeted book deploys the same AVERAGE risk as a flat one.
 *
 * Without this, every comparison of volatility targeting is a comparison of leverage. Raising
 * volTarget above the universe's own volatility scales every bet up, and the balance rises for
 * that reason alone -- a sweep of volTarget on the campaign's leader ran to $16,138 purely by
 * deploying 3.7x the risk. Matching the mean weight to 1 removes the leverage from the comparison
 * and leaves only the question worth asking: does sizing inversely to volatility allocate the same
 * total risk better than sizing it flat?
 */
export function riskMatchedRiskPct(trades, { volTarget, volClamp = 3, riskPct = DEFAULTS.riskPct } = {}) {
  if (volTarget === null || volTarget === undefined) return riskPct;
  if (!(volTarget > 0)) throw new Error("riskMatchedRiskPct: volTarget must be positive");
  if (!(volClamp >= 1)) throw new Error("riskMatchedRiskPct: volClamp must be at least 1");
  const weights = trades.map((t) => {
    const atrPct = Number(t.atrPct);
    if (!(atrPct > 0)) throw new Error("riskMatchedRiskPct: every trade needs a positive atrPct");
    return Math.min(volClamp, Math.max(1 / volClamp, volTarget / atrPct));
  });
  if (!weights.length) return riskPct;
  return riskPct / (weights.reduce((s, w) => s + w, 0) / weights.length);
}
