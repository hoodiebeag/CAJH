/**
 * filters.mjs -- declarative entry filters, compiled into backtest.js's `entryGate` hook.
 *
 * backtest.js already accepts `entryGate`, a research-only veto that receives the completed entry
 * bar's close time. What it did not have was anything to put in it that a sweep could name, log and
 * reproduce -- a bare closure cannot be written to campaign-log.jsonl. So a filter here is a plain
 * serialisable spec, and `buildEntryGate` turns a spec into the closure. The spec is what travels
 * in the config; the closure never leaves the run.
 *
 * The filters themselves come from what published crypto trend systems actually use, and each one
 * targets something the campaign's own diagnostics found:
 *
 *   maSlope        The 200-MA gate that produced the current leader only asks whether price is
 *                  above the average. It says nothing about whether the average is rising, so it
 *                  passes the whole first leg of a downtrend's dead-cat bounce.
 *   adx            The leader's win rate is 40% with a median trade of -1.11R: it pays for a lot
 *                  of chop to catch a few runs. ADX is the standard way to decline the chop.
 *   maxExtension   Entries far above the mean have their stop far below, and the campaign already
 *                  knows cost in R is 0.017/stopPct. Capping extension in ATR units caps that.
 *   atrPctBand     Volatility regime. A 1%-ATR market and an 8%-ATR market are not the same trade.
 *   btcRegime      Crypto is close to a one-factor market. Whether BTC is above its own average is
 *                  a market-wide state that no single pair's chart contains.
 *   crossSection   The concentration analysis found the return lives in a handful of pairs -- two
 *                  ZECUSD trades carried 35% of all R. Ranking the universe by trailing Sharpe and
 *                  trading only the leaders is the standard answer, and unlike the others it needs
 *                  information no single pair has: where this pair stands against the rest, now.
 *
 * Every indicator is computed on the entry timeframe from closed bars only. `at(tClose)` resolves
 * the bar by its close time, which is what entryGate is handed, so a filter can never see the bar
 * it is deciding about before that bar has closed.
 */

/** Wilder's ATR. Index i is the ATR as of bar i's close; null until `period` bars exist. */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let sum = 0, prev = null;
  for (let i = 0; i < candles.length; i++) {
    const h = Number(candles[i].high), l = Number(candles[i].low);
    const pc = i ? Number(candles[i - 1].close) : Number(candles[i].close);
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (i < period) { sum += tr; if (i === period - 1) { prev = sum / period; out[i] = prev; } }
    else { prev = (prev * (period - 1) + tr) / period; out[i] = prev; }
  }
  return out;
}

/** Simple moving average of closes. */
export function sma(candles, period) {
  const out = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += Number(candles[i].close);
    if (i >= period) sum -= Number(candles[i - period].close);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Wilder's ADX. Trend STRENGTH, not direction -- a hard downtrend scores as high as a hard uptrend,
 * which is the point: it separates trending from ranging, and the trend gate handles direction.
 */
export function adx(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period * 2 + 1) return out;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < n; i++) {
    const h = Number(candles[i].high), l = Number(candles[i].low);
    const ph = Number(candles[i - 1].high), pl = Number(candles[i - 1].low), pc = Number(candles[i - 1].close);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, down = pl - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const wilder = (arr) => {
    const s = new Array(arr.length).fill(null);
    let acc = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i < period) { acc += arr[i]; if (i === period - 1) s[i] = acc; }
      else { acc = acc - acc / period + arr[i]; s[i] = acc; }
    }
    return s;
  };
  const strS = wilder(tr), plusS = wilder(plusDM), minusS = wilder(minusDM);
  const dx = new Array(tr.length).fill(null);
  for (let i = 0; i < tr.length; i++) {
    if (strS[i] === null || !(strS[i] > 0)) continue;
    const pdi = 100 * plusS[i] / strS[i], mdi = 100 * minusS[i] / strS[i];
    const denom = pdi + mdi;
    dx[i] = denom > 0 ? 100 * Math.abs(pdi - mdi) / denom : 0;
  }
  // ADX is a Wilder average OF DX, so it needs a second `period` of DX values before it exists.
  let acc = 0, count = 0, prev = null;
  for (let i = 0; i < dx.length; i++) {
    if (dx[i] === null) continue;
    count++;
    if (count <= period) { acc += dx[i]; if (count === period) { prev = acc / period; out[i + 1] = prev; } }
    else { prev = (prev * (period - 1) + dx[i]) / period; out[i + 1] = prev; }
  }
  return out;
}

/** Close time -> bar index, matching the tClose backtest.js hands to entryGate. */
export function closeTimeIndex(candles, entryMins) {
  const m = new Map();
  for (let i = 0; i < candles.length; i++) m.set(Number(candles[i].time) + entryMins * 60, i);
  return m;
}

/**
 * Trailing Sharpe of log returns, annualised by sqrt(barsPerYear). Index i is the value as of bar
 * i's close. Zero-variance windows return null rather than Infinity -- a flat stretch is not an
 * infinitely good risk-adjusted return, and letting it rank first would put the deadest pair in
 * the universe at the top of the list.
 */
export function trailingSharpe(candles, lookback = 60, barsPerYear = 365) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  const ret = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const a = Number(candles[i - 1].close), b = Number(candles[i].close);
    if (a > 0 && b > 0) ret[i] = Math.log(b / a);
  }
  for (let i = lookback; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = i - lookback + 1; j <= i; j++) if (ret[j] !== null) { sum += ret[j]; count++; }
    if (count < lookback / 2) continue;
    const mean = sum / count;
    let sq = 0;
    for (let j = i - lookback + 1; j <= i; j++) if (ret[j] !== null) sq += (ret[j] - mean) ** 2;
    const sd = Math.sqrt(sq / (count - 1));
    if (sd > 0) out[i] = (mean / sd) * Math.sqrt(barsPerYear);
  }
  return out;
}

/**
 * Bar time -> the universe ranked best-first by trailing Sharpe as of that bar.
 *
 * Built once per configuration and shared by every pair, because computing it inside each pair's
 * gate would rank the universe once per pair per run. Pairs are keyed by bar time rather than bar
 * index: nine pairs in this bundle start two years after the others, so index i is a different
 * date in different series and ranking by index would compare 2023 against 2025.
 */
export function sharpeRankTable(universe, { lookback = 60, barsPerYear = 365 } = {}) {
  const byTime = new Map();
  for (const [pair, candles] of Object.entries(universe)) {
    const sh = trailingSharpe(candles, lookback, barsPerYear);
    for (let i = 0; i < candles.length; i++) {
      if (sh[i] === null) continue;
      const t = Number(candles[i].time);
      if (!byTime.has(t)) byTime.set(t, []);
      byTime.get(t).push([pair, sh[i]]);
    }
  }
  const ranked = new Map();
  for (const [t, entries] of byTime) {
    entries.sort((a, b) => b[1] - a[1]);
    ranked.set(t, entries.map((e) => e[0]));
  }
  return ranked;
}

/**
 * Compile a spec into an entryGate. Unknown keys throw rather than silently passing everything --
 * a typo in a filter name would otherwise read as "this filter does nothing", and a sweep would
 * log the result under a name it never applied.
 */
export function buildEntryGate(spec, { candles, entryMins, btcCandles = null, sharpeRanks = null, pair = null, direction = "long" } = {}) {
  if (!spec || !Object.keys(spec).length) return null;
  const known = ["maSlope", "adx", "maxExtension", "atrPctBand", "btcRegime", "crossSection"];
  for (const key of Object.keys(spec)) {
    if (!known.includes(key)) throw new Error(`filters: unknown filter "${key}" (known: ${known.join(", ")})`);
  }
  const idx = closeTimeIndex(candles, entryMins);
  const checks = [];

  if (spec.maSlope) {
    const { period = 200, lookback = 20 } = spec.maSlope;
    const s = sma(candles, period);
    checks.push((i) => i >= lookback && s[i] !== null && s[i - lookback] !== null && s[i] > s[i - lookback]);
  }
  if (spec.adx) {
    const { period = 14, min = 20 } = spec.adx;
    const a = adx(candles, period);
    checks.push((i) => a[i] !== null && a[i] >= min);
  }
  if (spec.maxExtension) {
    const { maPeriod = 50, atrPeriod = 14, maxAtr = 4 } = spec.maxExtension;
    const s = sma(candles, maPeriod), a = atr(candles, atrPeriod);
    checks.push((i) => {
      if (s[i] === null || a[i] === null || !(a[i] > 0)) return false;
      return (Number(candles[i].close) - s[i]) / a[i] <= maxAtr;
    });
  }
  if (spec.atrPctBand) {
    const { period = 14, min = 0, max = 1 } = spec.atrPctBand;
    const a = atr(candles, period);
    checks.push((i) => {
      if (a[i] === null) return false;
      const pct = a[i] / Number(candles[i].close);
      return pct >= min && pct <= max;
    });
  }
  if (spec.btcRegime) {
    const { period = 200 } = spec.btcRegime;
    // Direction-aware, for the same reason backtest.js's trend gate had to become so: "BTC above
    // its own average" is a market-wide UPtrend, which is the state a long wants and the opposite
    // of what a short wants. An uninverted version would have admitted shorts only into a rising
    // market, which is worse than no filter at all.
    const wantAbove = direction !== "short";
    if (!btcCandles?.length) throw new Error("filters: btcRegime needs btcCandles -- refusing to pass a filter it cannot evaluate");
    const s = sma(btcCandles, period);
    // BTC's own bars, looked up by time: an alt's bar index does not address BTC's series, and the
    // two can start on different days. The most recent CLOSED BTC bar at or before tClose is used,
    // so no alt entry ever sees a BTC bar from its own future.
    const times = btcCandles.map((c) => Number(c.time));
    checks.push((_i, tClose) => {
      let lo = 0, hi = times.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] + entryMins * 60 <= tClose) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (found < 0 || s[found] === null) return false;
      return (Number(btcCandles[found].close) > s[found]) === wantAbove;
    });
  }

  if (spec.crossSection) {
    const { topN = 8 } = spec.crossSection;
    if (!sharpeRanks || !pair) throw new Error("filters: crossSection needs sharpeRanks and pair -- refusing to pass a filter it cannot evaluate");
    checks.push((i) => {
      const ranked = sharpeRanks.get(Number(candles[i].time));
      if (!ranked) return false;
      const at = ranked.indexOf(pair);
      return at >= 0 && at < topN;
    });
  }

  return (tClose) => {
    const i = idx.get(tClose);
    if (i === undefined) return false;
    for (const check of checks) if (!check(i, tClose)) return false;
    return true;
  };
}
