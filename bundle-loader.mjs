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

export const BUNDLE = process.env.CANDLE_BUNDLE || "candle-bundle";

export function availableTimeframes(root = BUNDLE) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
}

export function availablePairs(minutes = 1440, root = BUNDLE) {
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
