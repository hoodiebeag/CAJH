import fs from "node:fs";
import path from "node:path";

// A data-sanity screen for a research universe.
//
// PARA sat in the sp500 bundle with closes ranging from $1.06 to $113,900 and 162 bars carrying no
// volume at all. Whatever instrument that series describes, it is not Paramount Global, which
// traded near $11 on the dates the series shows $3,500 on nineteen shares. A price path that falls
// by five orders of magnitude is the strongest possible "loser", so a cross-sectional ranking
// shorts it every single period: momentum held it short in 31 of 32 rebalances, and removing it
// took the equities book from 25.0% CAGR to 9.1%. One corrupted symbol was two thirds of the
// result.
//
// The screen is deliberately blunt and stated in advance rather than tuned. It rejects a series
// that no real listed instrument produces, not one that merely performed badly: real collapses of
// 20-60x are common in this window (CHPT, SEDG, LCID, PLUG all survive it) and are kept.

export const DEFAULT_LIMITS = {
  // Split-adjusted history can legitimately span a wide range -- a 1:20 reverse split multiplies
  // every pre-split price by twenty. 500x is far beyond that and beyond any real drawdown.
  maxCloseRatio: 500,
  // A listed instrument trades. Bars with no volume mean the vendor had nothing, and a series that
  // is mostly gaps cannot be ranked against one that is not.
  maxZeroVolumeFraction: 0.2,
  // Below this the "fill at the close" assumption every backtest here makes is not credible at any
  // account size worth running.
  minMedianDollarVolume: 1e5,
};

/**
 * Returns { kept, rejected } where kept is a series object safe to rank and rejected lists
 * [symbol, reason] so the exclusions are visible rather than silent.
 */
export function screenUniverse(series, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const kept = {}, rejected = [];
  for (const [sym, bars] of Object.entries(series)) {
    const closes = bars.map((b) => Number(b.close)).filter((v) => v > 0);
    if (closes.length < 2) { rejected.push([sym, "fewer than two usable closes"]); continue; }
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const ratio = hi / lo;
    if (ratio > L.maxCloseRatio) {
      rejected.push([sym, `close range ${ratio.toFixed(0)}x ($${lo.toFixed(2)}-$${hi.toFixed(2)}) exceeds ${L.maxCloseRatio}x`]);
      continue;
    }
    const zeroFrac = bars.filter((b) => !(Number(b.volume) > 0)).length / bars.length;
    if (zeroFrac > L.maxZeroVolumeFraction) {
      rejected.push([sym, `${(100 * zeroFrac).toFixed(0)}% of bars have no volume`]);
      continue;
    }
    const dv = bars.map((b) => Number(b.close) * Number(b.volume)).filter((v) => v > 0).sort((a, b) => a - b);
    const medDV = dv.length ? dv[Math.floor(dv.length / 2)] : 0;
    if (medDV < L.minMedianDollarVolume) {
      rejected.push([sym, `median dollar volume $${(medDV / 1e6).toFixed(3)}M below the floor`]);
      continue;
    }
    kept[sym] = bars;
  }
  return { kept, rejected };
}


/**
 * Parse a ticker list: whitespace or comma separated, `#` comments stripped per line, deduplicated.
 *
 * Shared by the collector and the panel puller so the two cannot disagree about what a universe file
 * means. They previously each had their own parse, which is how two files that look identical end up
 * enumerating different universes.
 */
export function parseSymbolFile(text) {
  return [...new Set(
    String(text).split("\n")
      // COMMENTS ARE STRIPPED PER LINE, BEFORE TOKENISING, and that is not a nicety. The ticker
      // pattern accepts any short letter word, so "# Semis and memory" contributed SEMIS, AND and
      // MEMORY -- three symbols nobody asked for, arriving as unresolvable names in a report that
      // also lists genuine delistings. A universe file is the natural place for a human to write
      // headings, so the format has to survive one.
      .map((line) => line.split("#")[0])
      .join(" ")
      .split(/[\s,]+/)
      .map((x) => x.trim().toUpperCase())
      // The shape filter is the panel puller's, carried over rather than reinvented. Without it
      // this function and that one disagree about what the same file means.
      .filter((x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x)),
  )].sort();
}

/**
 * Decide which universe gets sectors and news, and say which one was chosen.
 *
 * WHY THIS IS A DECISION WORTH NAMING. The collector used to enumerate a candle bundle, defaulting to
 * sp500-bundle's 128 names, while the panel puller collected ~1,000 from universe/candidates.txt into
 * a different root. Sectors and news therefore covered a much smaller and different universe than the
 * one being traded, and on a FIRST refresh there was no pulled bundle to enumerate at all. Coverage
 * of roughly 12% would also fail the paper protocol's news criterion for a configuration reason
 * rather than a fact about the feed.
 *
 * Order, most authoritative first. `verified` distinguishes a list IBKR has confirmed from one
 * assembled by hand, because the difference changes how many failures to expect.
 */
export function resolveUniverseSource({ symbolsFile = null, bundleRoot = "sp500-bundle",
                                        resolvedFile = path.join("ibkr-bundle", "universe-resolved.txt"),
                                        candidatesFile = path.join("universe", "candidates.txt"),
                                        readFile = (f) => fs.readFileSync(f, "utf8"),
                                        exists = (f) => fs.existsSync(f),
                                        fromBundle = null } = {}) {
  if (symbolsFile) {
    return { symbols: parseSymbolFile(readFile(symbolsFile)), source: `${symbolsFile} (explicit)`, verified: null };
  }
  if (exists(resolvedFile)) {
    return { symbols: parseSymbolFile(readFile(resolvedFile)), source: `${resolvedFile} (IBKR-verified)`, verified: true };
  }
  if (exists(candidatesFile)) {
    return { symbols: parseSymbolFile(readFile(candidatesFile)), source: `${candidatesFile} (candidates, UNVERIFIED)`, verified: false };
  }
  // The old behaviour, still reachable: whatever bundle is present.
  if (!fromBundle) throw new Error("resolveUniverseSource: no symbol source and no bundle reader given");
  return { symbols: fromBundle(bundleRoot), source: `${bundleRoot} (candle bundle)`, verified: null };
}
