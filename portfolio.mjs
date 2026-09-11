// Combining cross-sectional books ACROSS asset classes.
//
// The naive move -- pour every symbol into one ranking -- destroys the result: crypto's
// volatility wins 30% of the long slots on 18% of the universe and the book becomes a
// levered crypto bet. Ranking WITHIN each class and combining the resulting books keeps
// each ranking comparing like with like.
//
// The books do not rebalance on the same calendar (crypto trades weekends), so periods are
// matched by DATE, and the faster book's periods are compounded into the slower book's clock.

// Put book A on book B's clock by AGGREGATION, not by sampling.
//
// The first version of this picked, for each B period, the single most recent A period -- which
// silently threw away every other A period. That is not a small approximation when the books
// rebalance at different rates: crypto's daily bundle carries 365 bars a year against US equities'
// 252, so a 21-bar rebalance comes round 17.4 times a year in crypto and 12 in equities, and
// sampling one crypto period per equity month discarded roughly two of every five. The "crypto
// book" it produced was a subsample of the crypto book.
//
// A's period j covers (aLog[j], aLog[j+1]] and is assigned to whichever B period contains its
// close. Log returns add, so the aggregate is the compounded return over exactly that window.
// Pass the FASTER book as `a`; A periods falling outside B's span are reported, not hidden.
export function alignReturns(a, b) {
  const pairs = [];
  let used = 0;
  for (let i = 0; i < b.returns.length; i++) {
    const lo = b.rebalanceLog[i]?.at, hi = b.rebalanceLog[i + 1]?.at;
    if (lo === undefined || hi === undefined) continue;
    let sum = 0, count = 0;
    for (let j = 0; j < a.returns.length; j++) {
      const t = a.rebalanceLog[j + 1]?.at;
      if (t !== undefined && t > lo && t <= hi) { sum += a.returns[j]; count++; }
    }
    if (count === 0) continue;                 // no A period closed inside this B period
    used += count;
    pairs.push({ from: lo, at: hi, a: sum, b: b.returns[i], aPeriods: count });
  }
  pairs.aPeriodsUsed = used;
  pairs.aPeriodsTotal = a.returns.length;
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

/**
 * Max drawdown of a blend, marked PER BAR, with each leg anchored on its OWN rebalance calendar.
 *
 * Three things all have to be right here and the obvious implementation gets two of them wrong.
 *
 * Marking at period ends never sees an intra-period low; doing that once understated a spread's
 * drawdown by 44%. So the walk is per bar.
 *
 * A per-bar walk drifts away from the costed path, because turnover and slippage are charged per
 * rebalance and the bar returns do not carry them. So the walk is re-anchored to the costed
 * balance at every rebalance -- and crucially at each leg's own rebalances, not just the blend's:
 * crypto turns over 17.4 times a year against equities' 12, and anchoring only on the equity
 * calendar leaves a crypto rebalance uncosted inside most windows.
 *
 * The two legs trade different calendars. On a day the equity market is shut only the crypto leg
 * moves, so a missing bar means "did not move", not "went to zero".
 *
 * The blend itself is rebalanced back to weightA at each blended period close, which is what
 * `blend` assumes. weightA may be a single number, or one weight per period for a rule whose
 * weight moves -- the causal inverse-volatility rule, say.
 */
export function blendDrawdownPct(legA, legB, pairs, weightA) {
  if (!pairs.length) return null;
  const wAt = i => (Array.isArray(weightA) ? weightA[Math.min(i, weightA.length - 1)] : weightA);
  const costedByDate = leg => {
    const m = new Map();
    for (let i = 0; i < leg.returns.length; i++) {
      const at = leg.top.rebalanceLog[i + 1]?.at;
      if (at !== undefined) m.set(Number(at), leg.returns[i]);
    }
    return m;
  };
  const barsByDate = leg => {
    const m = new Map();
    leg.times.forEach((t, k) => m.set(Number(t), leg.barReturns[k]));
    return m;
  };
  const [costA, costB] = [costedByDate(legA), costedByDate(legB)];
  const [barA, barB] = [barsByDate(legA), barsByDate(legB)];
  const blendAt = new Map(pairs.map((p, i) => [Number(p.at), i]));
  const start = Number(pairs[0].from), end = Number(pairs[pairs.length - 1].at);
  const dates = [...new Set([...barA.keys(), ...barB.keys(), ...blendAt.keys()])]
    .filter(t => t > start && t <= end).sort((x, y) => x - y);

  let capA = wAt(0) * 1000, capB = (1 - wAt(0)) * 1000;
  let anchorA = capA, anchorB = capB;
  let peak = 1000, maxDD = 0;
  for (const t of dates) {
    capA *= Math.exp(barA.get(t) ?? 0);
    capB *= Math.exp(barB.get(t) ?? 0);
    if (costA.has(t)) { capA = anchorA * Math.exp(costA.get(t)); anchorA = capA; }
    if (costB.has(t)) { capB = anchorB * Math.exp(costB.get(t)); anchorB = capB; }
    if (blendAt.has(t)) {
      const w = wAt(blendAt.get(t) + 1);          // the weight in force for the NEXT period
      const total = capA + capB;
      capA = w * total; capB = (1 - w) * total;
      anchorA = capA; anchorB = capB;
    }
    const total = capA + capB;
    peak = Math.max(peak, total);
    maxDD = Math.max(maxDD, (peak - total) / peak);
  }
  return +(100 * maxDD).toFixed(2);
}
