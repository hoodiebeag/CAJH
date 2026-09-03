/**
 * FEE-BUFFER-REVIEW diagnostic (throwaway, read-only). Not part of the app —
 * run once to quantify whether FEE_BUFFER_PCT=0.01 covers the real round-trip
 * cost, using entrySignal's actual swing-stop distribution over real candle data.
 * Deletable after ROADMAP_ARCHIVE.md's finding is written.
 */
import "dotenv/config";
import { loadCandles } from "../../data.js";
import { detectSwings, SWING_WINDOW, MIN_STOP_PCT, MAX_STOP_PCT_BY_TF, FEE_RATE, SLIPPAGE_PCT, FEE_BUFFER_PCT, BE_LOCK_R } from "../../strategy.js";
import { loadWatchlist, symbolToKrakenId, TFS } from "../../researchlib.mjs";

const RECENT_BARS = 30; // matches strategy.js entrySignal's default
const watchlist = loadWatchlist();
const stopFracs = []; // { symbol, tf, stopFrac }

for (const symbol of watchlist) {
  const pair = symbolToKrakenId(symbol);
  for (const [tfLabel, tfMins] of TFS) {
    let candles;
    try { candles = loadCandles(pair, tfMins); } catch { continue; }
    if (!candles || candles.length < 60) continue;
    const maxStop = MAX_STOP_PCT_BY_TF[tfLabel] ?? 0.04;
    const closes = candles.map(c => parseFloat(c.close));

    // detectSwings scans the WHOLE series and returns pivots with a confirmIndex - it
    // does not look ahead of confirmIndex to decide a pivot is confirmed, so replaying
    // it once and walking pivots forward alongside bars reproduces exactly what
    // entrySignal(window) would have returned at each bar, without the O(n^2) re-scan.
    const pivots = detectSwings(candles, SWING_WINDOW);
    const lows = pivots.filter(p => p.type === "low");

    let li = 0; // index into lows of the next not-yet-reached low
    let activeLow = null; // most recent low whose confirmIndex <= i and still "current" (no high pivot after it)
    let hi = 0;
    const highs = pivots.filter(p => p.type === "high");

    for (let i = 60; i < candles.length; i++) {
      while (li < lows.length && lows[li].confirmIndex <= i) { activeLow = lows[li]; li++; }
      while (hi < highs.length && highs[hi].confirmIndex <= i && activeLow && highs[hi].confirmIndex > activeLow.confirmIndex) { activeLow = null; hi++; }
      if (!activeLow) continue;
      if (i - activeLow.confirmIndex > RECENT_BARS) continue;
      const entry = closes[i];
      const risk = entry - activeLow.price;
      if (!entry || risk <= 0) continue;
      const stopFrac = risk / entry;
      if (stopFrac > maxStop) continue;
      if (MIN_STOP_PCT && stopFrac < MIN_STOP_PCT) continue;
      stopFracs.push({ symbol, tf: tfLabel, stopFrac });
    }
  }
}

stopFracs.sort((a, b) => a.stopFrac - b.stopFrac);
const n = stopFracs.length;
const pct = (p) => n ? stopFracs[Math.min(n - 1, Math.floor(p * n))].stopFrac : NaN;
const mean = n ? stopFracs.reduce((s, x) => s + x.stopFrac, 0) / n : NaN;

const roundTripLinear = 2 * (FEE_RATE + SLIPPAGE_PCT);
const roundTripExact = (1 + FEE_RATE + SLIPPAGE_PCT) / (1 - FEE_RATE - SLIPPAGE_PCT) - 1;

console.log(`n accepted signals sampled: ${n}`);
console.log(`stopFrac (risk/entry): min=${(pct(0)*100).toFixed(2)}% p10=${(pct(0.10)*100).toFixed(2)}% p50=${(pct(0.50)*100).toFixed(2)}% mean=${(mean*100).toFixed(2)}% p90=${(pct(0.90)*100).toFixed(2)}% max=${(pct(0.999)*100).toFixed(2)}%`);
console.log(`FEE_RATE=${FEE_RATE} SLIPPAGE_PCT=${SLIPPAGE_PCT} -> round-trip cost: linear=${(roundTripLinear*100).toFixed(4)}% exact=${(roundTripExact*100).toFixed(4)}%`);
console.log(`current FEE_BUFFER_PCT=${FEE_BUFFER_PCT} (${(FEE_BUFFER_PCT*100).toFixed(2)}%)`);

let riskTermCovers = 0;
for (const x of stopFracs) {
  const beLockFracOfEntry = BE_LOCK_R * x.stopFrac;
  if (beLockFracOfEntry >= roundTripExact) riskTermCovers++;
}
console.log(`share of accepted signals where BE_LOCK_R*risk alone already clears the real round-trip cost: ${((riskTermCovers / n) * 100).toFixed(1)}%`);
console.log(`=> for the rest, lockOffset = FEE_BUFFER_PCT*entry is the binding term, and it is ${FEE_BUFFER_PCT >= roundTripExact ? "adequate" : "INADEQUATE"} (${(FEE_BUFFER_PCT*100).toFixed(2)}% vs ${(roundTripExact*100).toFixed(4)}% needed)`);

// What FEE_BUFFER_PCT value would make lockOffset >= real cost for effectively ALL
// accepted signals (i.e. bring the fee-buffer floor itself up to the real cost, with a
// touch of headroom, same "plus margin" intent as the existing comment)?
const recommended = roundTripExact * 1.05; // ~5% headroom above the exact breakeven line
console.log(`recommended FEE_BUFFER_PCT (exact breakeven + 5% headroom): ${recommended.toFixed(5)} (${(recommended*100).toFixed(3)}%)`);
