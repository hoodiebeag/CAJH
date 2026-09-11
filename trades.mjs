// A trade ledger for a rotation book.
//
// Every result so far has been reported per REBALANCE PERIOD -- "19 of 31 periods up". The stated
// acceptance criterion is per TRADE: roughly ten trades a month at a win rate of 40% or better,
// with the wins large enough to cover the losses. Those are different questions and a book can
// pass one while failing the other, so this derives the second directly.
//
// A position opens when a symbol enters the held set and closes when it leaves. Holds that are
// still open at the end of the series are reported separately rather than marked as if closed.

/** Trades from one leg. side is +1 for the long leg, -1 for the short leg. */
export function ledger(rotation, side = 1) {
  const open = new Map();                 // symbol -> { at, price }
  const closed = [];
  for (const r of rotation.rebalanceLog) {
    const now = new Set(r.chosen);
    for (const [sym, pos] of open) {
      if (now.has(sym)) continue;
      const exit = r.closes[sym];         // priced at this rebalance only if still ranked
      closed.push(finish(sym, pos, r.at, exit, side));
      open.delete(sym);
    }
    for (const sym of r.chosen) {
      if (!open.has(sym)) open.set(sym, { at: r.at, price: r.closes[sym] });
    }
  }
  return { closed: closed.filter(Boolean), stillOpen: open.size, unpriced: closed.filter(t => !t).length };
}

function finish(symbol, pos, exitAt, exitPrice, side) {
  if (!(pos.price > 0) || !(exitPrice > 0)) return null;
  const logReturn = side * Math.log(exitPrice / pos.price);
  return { symbol, side, entryAt: pos.at, exitAt, barsHeldDays: (exitAt - pos.at) / 86400,
           logReturn, pct: (Math.exp(logReturn) - 1) * 100 };
}

/**
 * roundTripPct is charged to every trade: a position pays slippage on the way in and again on the
 * way out. Reporting a ledger gross of it would flatter the win rate as well as the expectancy,
 * since the trades it flips are the small winners.
 */
export function summarise(trades, years, { roundTripPct = 0 } = {}) {
  const n = trades.length;
  if (!n) return null;
  trades = trades.map(t => ({ ...t, pct: t.pct - roundTripPct }));
  const wins = trades.filter(t => t.pct > 0), losses = trades.filter(t => t.pct <= 0);
  const mean = xs => xs.reduce((a, t) => a + t.pct, 0) / xs.length;
  const avgWin = wins.length ? mean(wins) : 0, avgLoss = losses.length ? mean(losses) : 0;
  return {
    trades: n,
    tradesPerMonth: years > 0 ? +(n / (years * 12)).toFixed(1) : null,
    winRatePct: +(100 * wins.length / n).toFixed(1),
    avgWinPct: +avgWin.toFixed(2),
    avgLossPct: +avgLoss.toFixed(2),
    // "Wins should win, and offset any losses" is a payoff-ratio question, not a win-rate one.
    payoffRatio: avgLoss < 0 ? +(avgWin / -avgLoss).toFixed(2) : null,
    // What one trade returns on average, which is the number that actually compounds.
    expectancyPct: +(trades.reduce((a, t) => a + t.pct, 0) / n).toFixed(3),
    medianHoldDays: +[...trades].sort((a, b) => a.barsHeldDays - b.barsHeldDays)[Math.floor(n / 2)].barsHeldDays.toFixed(0),
  };
}
