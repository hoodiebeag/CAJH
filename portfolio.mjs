// Combining cross-sectional books ACROSS asset classes.
//
// The naive move -- pour every symbol into one ranking -- destroys the result: crypto's
// volatility wins 30% of the long slots on 18% of the universe and the book becomes a
// levered crypto bet. Ranking WITHIN each class and combining the resulting books keeps
// each ranking comparing like with like.
//
// The books do not rebalance on the same calendar (crypto trades weekends), so periods are
// matched by DATE, not by index.

// Pair each book-B period with the most recent book-A period that closed at or before it.
// Returns [{ at, a, b }] in book-B order. maxLagDays bounds how stale a match may be.
export function alignReturns(a, b, { maxLagDays = 40 } = {}) {
  const maxLag = maxLagDays * 86400;
  const pairs = [];
  for (let i = 0; i < b.returns.length; i++) {
    const at = b.rebalanceLog[i + 1]?.at;
    if (at === undefined) continue;
    let best = null, bestLag = Infinity;
    for (let j = 0; j < a.returns.length; j++) {
      const t = a.rebalanceLog[j + 1]?.at;
      if (t === undefined) continue;
      const lag = at - t;
      if (lag >= 0 && lag < bestLag) { bestLag = lag; best = j; }
    }
    if (best !== null && bestLag <= maxLag) pairs.push({ at, a: a.returns[best], b: b.returns[i] });
  }
  return pairs;
}

export function correlation(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { c += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
  // Not `vx === 0`: a constant series accumulates float residue, so its variance comes back
  // as ~1e-34 rather than zero and the ratio below returns meaningless noise instead of null.
  const flat = (v, mean) => Math.sqrt(v / n) <= 1e-12 * Math.max(1, Math.abs(mean));
  return flat(vx, mx) || flat(vy, my) ? null : c / Math.sqrt(vx * vy);
}

// Log returns, one per rebalance period. periodsPerYear annualises CAGR and Sharpe.
export function bookStats(returns, { start = 1000, periodsPerYear = 12 } = {}) {
  let bal = start, peak = start, maxDD = 0;
  for (const r of returns) {
    bal *= Math.exp(r);
    peak = Math.max(peak, bal);
    maxDD = Math.max(maxDD, (peak - bal) / peak);
  }
  const n = returns.length;
  const years = n / periodsPerYear;
  const mean = returns.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    final: bal,
    cagrPct: years > 0 ? (Math.pow(bal / start, 1 / years) - 1) * 100 : 0,
    maxDrawdownPct: maxDD * 100,
    // 31 monthly observations puts the standard error on this near 0.34. It separates
    // constructions; it does not establish any one of them to two decimal places.
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : null,
    periods: n,
    upPeriods: returns.filter(r => r > 0).length,
  };
}

// Rebalanced every period back to the target weight, which is what the arithmetic below
// assumes: the combined log return is not the weighted sum of log returns unless the
// capital is reset each period.
export function blend(pairs, weightA) {
  const wb = 1 - weightA;
  return pairs.map(p => Math.log(weightA * Math.exp(p.a) + wb * Math.exp(p.b)));
}
