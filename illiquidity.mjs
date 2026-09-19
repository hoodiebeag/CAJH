/**
 * illiquidity.mjs — Amihud illiquidity, and the "spiked then normalised" shape built on it.
 *
 * Amihud's measure is |return| divided by dollar volume: how far a unit of money moves the price.
 * It is the only quantity in this project built from VOLUME as the signal itself. Volume has
 * appeared here before only as a confirmation filter on a price trigger (VOL-CONFIRM-BREAKOUT,
 * which failed on its train gate), never as the thing being ranked.
 *
 * TWO NUMERICAL HAZARDS, both handled rather than assumed away:
 *  - Dollar volume can be zero on a halted or untraded session. |r|/0 is Infinity, which sorts to
 *    one end of a cross-section and would be selected every time. Those days return null.
 *  - The measure is violently right-skewed -- a thin day can be orders of magnitude above a normal
 *    one -- so a mean and standard deviation taken on the raw level are dominated by a handful of
 *    days. It is logged before any z-score is taken, which is the standard treatment and is done
 *    here so that "z-score" in a caller means the same thing it means in the literature.
 */

/** Amihud illiquidity for one bar: |return| / dollar volume. Null when the day cannot support it. */
export function amihud(ret, close, volume) {
  const dollar = Number(close) * Number(volume);
  if (!(dollar > 0) || !Number.isFinite(ret)) return null;
  return Math.abs(ret) / dollar;
}

/**
 * Log-illiquidity z-scores for a series, each point scored against its own trailing `win` history.
 *
 * The trailing window ends at the point BEFORE the one being scored, so a value is never part of
 * the distribution it is measured against. Null where there is not enough clean history.
 */
export function illiquidityZ(values, win = 60) {
  const logs = values.map((v) => (v === null || !(v > 0) ? null : Math.log(v)));
  const out = new Array(values.length).fill(null);
  for (let i = win; i < values.length; i++) {
    const hist = [];
    for (let j = i - win; j < i; j++) if (logs[j] !== null) hist.push(logs[j]);
    if (hist.length < win * 0.8 || logs[i] === null) continue;
    const m = hist.reduce((s, v) => s + v, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((s, v) => s + (v - m) ** 2, 0) / (hist.length - 1));
    if (!(sd > 1e-12)) continue;
    out[i] = (logs[i] - m) / sd;
  }
  return out;
}

/**
 * MR08's shape: how far an illiquidity spike has come back down.
 *
 * `peak - current` over the last `look` observations. A large value means the name was recently
 * much harder to move than usual and is no longer. Ranking on this is threshold-free, which is the
 * point: the manual offers a spike threshold as a free parameter and a threshold chosen after
 * seeing the data is the parameter that fits it.
 *
 * Null unless the whole lookback is clean — a peak computed from three surviving days is not a
 * peak, and quietly accepting one would make the signal strongest exactly where the data is worst.
 */
export function normalisation(zs, look = 10) {
  if (zs.length < look) return null;
  const win = zs.slice(-look);
  if (win.some((v) => v === null)) return null;
  return Math.max(...win) - win[win.length - 1];
}
