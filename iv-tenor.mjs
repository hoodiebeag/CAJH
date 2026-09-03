/**
 * iv-tenor.mjs — what horizon is IBKR's implied-volatility series actually quoting?
 *
 * WHY THIS MATTERS. The C1 variance-risk-premium study compared IBKR's
 * `OPTION_IMPLIED_VOLATILITY` against realised volatility over the following 5 trading days and
 * measured a NEGATIVE premium on both SPY and QQQ — the opposite sign to one of the most
 * documented effects in finance. The data was sane (levels normal, 502 of 502 bars aligned,
 * estimator bias measured beforehand and pointing the other way), so the leading suspect is that
 * the two sides are not the same quantity: if IBKR quotes a roughly 30-day implied volatility and
 * it is being compared against 5-day realised, those are different things, and short-horizon
 * realised spikes well above longer-dated implied under stress.
 *
 * The tenor is not documented in the `@stoqey/ib` declarations — they enumerate the enum value and
 * nothing more — and this container cannot reach IBKR's documentation. So it is settled
 * empirically, which is better evidence than a doc claim in any case.
 *
 * THE METHOD. IBKR also publishes `HISTORICAL_VOLATILITY`, a backward-looking realised measure on
 * its own convention. Computing our own realised volatility over several trailing windows and
 * finding which one tracks IBKR's series most closely pins that convention directly. The same
 * comparison run forward against the implied series estimates the horizon the implied number is
 * pricing.
 *
 * THIS IS A MEASUREMENT QUESTION, NOT A STRATEGY. It produces no verdict about returns and no
 * position. Its only output is "which horizon does this series behave like", which then decides
 * how a future variance study must be specified.
 *
 * WHAT IT MUST NOT BECOME. If the answer is ~30 days, the correct response is ONE re-specified
 * study, pre-registered at the matching horizon before it is run. It is not licence to sweep
 * horizons until the premium turns positive — that is the threshold-a-series shape this project
 * retired after 11 runs.
 */

import { connect, fetchDailyBars, alignByDate } from "./ibkr-bars.mjs";
import { TRADING_DAYS } from "./vrp.mjs";
import { seededRng } from "./inference.mjs";

export const CANDIDATE_WINDOWS = [5, 10, 21, 30, 45, 63];
export const PREREGISTERED_CRITERION =
  "The winning window is the one minimising mean absolute difference against IBKR's own series, " +
  "reported alongside correlation. Both statistics are computed for every candidate window and " +
  "all are reported; the criterion is fixed here before any output exists so the answer cannot be " +
  "chosen after the fact.";

/** Trailing annualised realised volatility over `closes[i-h .. i]`. Backward-looking, to match HV. */
export function trailingVol(closes, i, h) {
  if (i - h < 0) return null;
  const rets = [];
  for (let k = i - h + 1; k <= i; k++) {
    const a = Number(closes[k - 1]), b = Number(closes[k]);
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  return Math.sqrt(rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1) * TRADING_DAYS);
}

/** Forward annualised realised volatility over `closes[i .. i+h]`. */
export function forwardVol(closes, i, h) {
  if (i + h >= closes.length) return null;
  const rets = [];
  for (let k = i + 1; k <= i + h; k++) {
    const a = Number(closes[k - 1]), b = Number(closes[k]);
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  return Math.sqrt(rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1) * TRADING_DAYS);
}

const corr = (a, b) => {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
};

/**
 * Score every candidate window against a reference series.
 * `direction` "trailing" compares against IBKR's historical-volatility series; "forward" against
 * the implied series, which is a statement about the future.
 */
export function scoreWindows(reference, priceCloses, { windows = CANDIDATE_WINDOWS, direction = "trailing" } = {}) {
  const f = direction === "forward" ? forwardVol : trailingVol;
  const rows = [];
  for (const h of windows) {
    const ours = [], theirs = [];
    for (let i = 0; i < priceCloses.length; i++) {
      const v = f(priceCloses, i, h);
      const r = Number(reference[i]);
      if (v === null || !Number.isFinite(r)) continue;
      ours.push(v); theirs.push(r);
    }
    if (ours.length < 30) { rows.push({ h, n: ours.length, usable: false }); continue; }
    const mad = ours.reduce((a, _, i) => a + Math.abs(ours[i] - theirs[i]), 0) / ours.length;
    rows.push({
      h, n: ours.length, usable: true,
      meanAbsDiff: mad,
      correlation: corr(ours, theirs),
      meanOurs: ours.reduce((a, b) => a + b, 0) / ours.length,
      meanTheirs: theirs.reduce((a, b) => a + b, 0) / theirs.length,
    });
  }
  const usable = rows.filter((r) => r.usable);
  const best = usable.length ? usable.reduce((a, b) => (b.meanAbsDiff < a.meanAbsDiff ? b : a)) : null;
  const bestByCorr = usable.length ? usable.reduce((a, b) => ((b.correlation ?? -2) > (a.correlation ?? -2) ? b : a)) : null;
  return {
    direction, rows,
    bestByMeanAbsDiff: best?.h ?? null,
    bestByCorrelation: bestByCorr?.h ?? null,
    // Stated so a reader sees when the two criteria disagree rather than only the headline.
    agree: best && bestByCorr ? best.h === bestByCorr.h : null,
  };
}
