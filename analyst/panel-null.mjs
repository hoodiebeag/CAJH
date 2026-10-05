/**
 * The null's machinery: turning a candle bundle into per-period paired differences.
 *
 * Extracted from `paper-power.mjs` so the new sensitivity work does not carry a second copy of
 * `bookReturn`. Duplicating it is the exact drift risk that put two untested copies of the power
 * arithmetic in this repository; one tested implementation is the point.
 *
 * WHAT A "NULL" MEANS HERE. Two books drawn at random from the same eligible pool at the same instant,
 * differenced. That is what `journal.mjs`'s matched control is, so the spread of this difference is
 * the noise any claimed edge has to clear. Measuring it says nothing about whether an edge exists.
 *
 * HISTORICAL, AND ON TODAY'S UNIVERSE. Every number this module produces is measured on past prices
 * for the symbols that are in the candidate list *now*. Names that were delisted, acquired or renamed
 * are absent, so the surviving cross-section is not the one a decision at the time would have faced.
 * That biases the level of returns upward; its effect on the *dispersion* of a paired difference
 * between two books from the same pool is second-order but not zero, and is not corrected for here.
 */

/**
 * Per-symbol maps of the return INTO each bar, plus the sorted union of bar times.
 *
 * Keyed by bar time rather than index: two symbols with different history lengths must not have the
 * same index mean different dates. `ret[s].get(dates[k])` is `close[k]/close[k-1] - 1`, so a return
 * exists at every bar except each symbol's first.
 */
export function buildReturnMap(kept) {
  const ret = new Map();
  const allDates = new Set();
  for (const [sym, candles] of Object.entries(kept)) {
    const m = new Map();
    for (let i = 1; i < candles.length; i++) {
      const p = Number(candles[i - 1].close), q = Number(candles[i].close);
      if (p > 0 && q > 0) { m.set(candles[i].time, q / p - 1); allDates.add(candles[i].time); }
    }
    ret.set(sym, m);
  }
  return { ret, dates: [...allDates].sort((a, b) => a - b), names: [...ret.keys()] };
}

/**
 * Net return of an equal-weight basket held `hold` sessions from index `i`, one round trip charged.
 *
 * INDEX SEMANTICS, STATED BECAUSE THEY ARE EASY TO GET WRONG. This compounds the returns at indices
 * `i .. i+hold-1`, which is the price change from `dates[i-1]`'s close to `dates[i+hold-1]`'s close:
 * `hold` sessions of exposure, entered at the close BEFORE `dates[i]`. A full window therefore needs
 * `i + hold <= dates.length`, which is the bound `nonOverlappingStarts` enforces.
 *
 * Returns `{ net, seen }`. `seen` is how many returns were actually compounded per name, averaged — a
 * name with a missing bar contributes a SHORTER hold rather than being dropped, which silently
 * shortens the effective window. Reported rather than hidden so a caller can see it happening.
 */
export function bookReturn({ ret, dates }, syms, i, hold, perLegCost) {
  const rs = [];
  let seenTotal = 0, counted = 0;
  for (const s of syms) {
    const m = ret.get(s);
    if (!m) continue;
    let eq = 1, seen = 0;
    for (let k = i; k < Math.min(i + hold, dates.length); k++) {
      const r = m.get(dates[k]);
      if (r === undefined) continue;
      eq *= 1 + r; seen++;
    }
    if (seen) { rs.push(eq - 1); seenTotal += seen; counted++; }
  }
  if (!rs.length) return { net: null, seen: 0 };
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  return { net: mean - 2 * perLegCost, seen: counted ? seenTotal / counted : 0 };
}

/**
 * Draw two books at one instant and difference them.
 *
 * `disjoint` IS THE CHOICE THAT CHANGES THE ANSWER, so it is explicit rather than implied.
 *
 *   - `disjoint: true` takes both books from one shrinking bag, so they can never share a name. This
 *     is what `paper-power.mjs` has always done.
 *   - `disjoint: false` draws each book independently from the full pool, so they may overlap. This is
 *     what `journal.mjs`'s `matchedRandomControl` actually does: it shuffles the eligible pool and
 *     takes the first `n` names, with no reference to what the analyst picked.
 *
 * Overlap induces positive correlation between the two books, which REDUCES the variance of their
 * difference. So the disjoint draw overstates the null's spread and yields a conservative (larger)
 * MDE. Which one is right depends on the question: disjoint measures "two different books", the
 * journal's behaviour measures "the analyst's book against an independent draw from the same pool".
 */
export function drawPair(panel, names, bookSize, i, hold, perLegCost, rng, { disjoint = true } = {}) {
  const pick = (bag) => {
    const out = [];
    for (let j = 0; j < bookSize && bag.length; j++) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
    return out;
  };
  let a, b;
  if (disjoint) {
    const bag = [...names];
    a = pick(bag); b = pick(bag);
  } else {
    a = pick([...names]); b = pick([...names]);
  }
  const ra = bookReturn(panel, a, i, hold, perLegCost);
  const rb = bookReturn(panel, b, i, hold, perLegCost);
  return (ra.net === null || rb.net === null) ? null : { diff: ra.net - rb.net, seen: (ra.seen + rb.seen) / 2 };
}

export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/**
 * Standard error of an sd estimate from `d` INDEPENDENT draws: sd / sqrt(2(d-1)).
 *
 * This is MONTE CARLO error only — it shrinks as draws are added and says nothing about how well the
 * panel represents the future. It is also an UNDERSTATEMENT here, because draws resample a finite set
 * of start dates and therefore are not independent: the same period can be drawn many times. Use
 * `periodBootstrapSd` for the uncertainty that does not shrink with draws.
 */
export const monteCarloSeOfSd = (sdEstimate, d) => (d > 1 ? sdEstimate / Math.sqrt(2 * (d - 1)) : NaN);

/**
 * Historical sample uncertainty: resample whole PERIODS, not draws.
 *
 * The quantity that limits generalisation is how many non-overlapping periods the panel contains — 134
 * at a 5-day hold on 920 dates — not how many times they were drawn. Adding Monte Carlo draws shrinks
 * Monte Carlo error toward zero while leaving this untouched, which is why reporting only the former
 * makes an estimate look far more certain than it is.
 *
 * Resamples periods with replacement and recomputes sd within each resample.
 */
export function periodBootstrapSd(diffsByPeriod, rng, iterations = 400) {
  const periods = [...diffsByPeriod.keys()];
  if (periods.length < 2) return { lo: null, hi: null, clusters: periods.length, degenerate: true };
  const draws = [];
  for (let it = 0; it < iterations; it++) {
    const pooled = [];
    for (let c = 0; c < periods.length; c++) {
      const key = periods[Math.floor(rng() * periods.length)];
      pooled.push(...diffsByPeriod.get(key));
    }
    draws.push(sd(pooled));
  }
  draws.sort((a, b) => a - b);
  const at = (q) => draws[Math.min(draws.length - 1, Math.floor(draws.length * q))];
  return { lo: at(0.025), hi: at(0.975), clusters: periods.length, degenerate: false, iterations };
}
