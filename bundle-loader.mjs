/**
 * bundle-loader.mjs — read the transferred candle bundle.
 *
 * The bundle is already resampled, so it does NOT go through `loadResearchCandles`, which
 * resamples a raw minute store this container does not have. Reading it directly keeps the two
 * paths honest: nothing here pretends to be the production cache.
 *
 * KNOWN LIMITS OF THIS PARTICULAR BUNDLE, audited on receipt 2026-09-03 and worth carrying into
 * anything that reads it:
 *  - CRYPTO ONLY. 29 Kraken pairs. No equities, so nothing here can run the DJIA/DJTA studies.
 *  - STALE. 25 of 29 pairs end 2026-03-31, five months before the date of receipt. Only XBT, ETH
 *    and SOL reach within ~35 days. EOS stopped 2025-06-30 and is a dead series.
 *  - UNEVEN HISTORY. Nine pairs start 2025-01-22 with ~434 daily bars; the rest reach back to
 *    2023-01-01. A universe-wide study inherits the shortest leg unless it says otherwise.
 *  - POLUSD carries 36 gaps of 2-8 days. Not corrupt, but thin early listing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Anchored to this file, not to the working directory. A relative default made the whole bundle
// vanish when a script was run from anywhere but the repository root, and `availablePairs` then
// returned an empty universe with no error -- a sweep would have logged "0 trades" rows that
// looked like a strategy finding nothing rather than a loader finding no data.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLE = process.env.CANDLE_BUNDLE || path.join(HERE, "candle-bundle");

export function availableTimeframes(root = BUNDLE) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
}

export function availablePairs(minutes = 1440, root = BUNDLE) {
  // A missing bundle is a broken setup and must not read as an empty universe. A missing
  // timeframe inside a real bundle is a legitimate "not collected", so that still returns [].
  if (!fs.existsSync(root)) throw new Error(`bundle-loader: no candle bundle at ${root} (set CANDLE_BUNDLE to override)`);
  const dir = path.join(root, String(minutes));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).map((f) => f.replace(/\.csv$/, "")).sort();
}

/** Bars for one pair, oldest first, in the shape backtest.js expects. */
export function loadBundleCandles(pair, minutes = 1440, root = BUNDLE) {
  const file = path.join(root, String(minutes), `${pair}.csv`);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const time = Number(c[idx.time]);
    if (!Number.isFinite(time)) continue;
    // Strings, matching what data.js's loader hands the backtester -- it coerces internally and
    // a silent type change here would be invisible until a comparison behaved oddly.
    out.push({
      time, open: c[idx.open], high: c[idx.high], low: c[idx.low], close: c[idx.close],
      volume: c[idx.volume] ?? "0", buyVol: "0", sellVol: "0", trades: "1", maxTrade: "0",
    });
  }
  return out;
}

/** Last bar date per pair, so a study can state its own staleness rather than assume freshness. */
export function coverage(minutes = 1440, root = BUNDLE) {
  return availablePairs(minutes, root).map((pair) => {
    const bars = loadBundleCandles(pair, minutes, root);
    return {
      pair, bars: bars.length,
      first: bars.length ? new Date(bars[0].time * 1000).toISOString().slice(0, 10) : null,
      last: bars.length ? new Date(bars[bars.length - 1].time * 1000).toISOString().slice(0, 10) : null,
    };
  });
}

/**
 * Aggregate bundle bars up to a longer timeframe.
 *
 * data.js's resampleBars cannot be used here: its validator requires a buyVol field the bundle's
 * six-column format does not carry, and adding a fake one to satisfy a validator would defeat the
 * point of having it. This is the bundle's own shape, resampled on the bundle's own terms.
 *
 * Buckets are floor(time / span) * span, the same rule data.js uses. On a 10080-minute span that
 * puts week boundaries on Thursdays, because the Unix epoch was a Thursday -- an arbitrary but
 * consistent 7-day grid, not a calendar week. Nothing downstream depends on which day it starts.
 *
 * The final bucket may be partial. That is safe for a backtest here because backtest.js addresses
 * a higher-timeframe bar by its CLOSE time (time + span), which for an incomplete final bucket
 * lies beyond the data, so no entry can ever read it.
 */
export function resampleBundleCandles(candles, spanMinutes) {
  if (!Number.isInteger(spanMinutes) || spanMinutes < 1) throw new Error("resampleBundleCandles: spanMinutes must be a positive integer");
  const span = spanMinutes * 60;
  const out = new Map();
  for (const c of [...candles].sort((a, b) => Number(a.time) - Number(b.time))) {
    const t = Math.floor(Number(c.time) / span) * span;
    const o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
    if (![o, h, l, cl].every(Number.isFinite)) continue;
    const bar = out.get(t);
    if (!bar) { out.set(t, { time: t, open: o, high: h, low: l, close: cl, volume: Number(c.volume) || 0 }); continue; }
    if (h > bar.high) bar.high = h;
    if (l < bar.low) bar.low = l;
    bar.close = cl;
    bar.volume += Number(c.volume) || 0;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
