// FVG / iFVG AS ENTRY TRIGGERS: pre-registered analysis, written before it was run.
//
// ============================ PRE-REGISTRATION ============================
// Written 2026-09-11 at the owner's request, after they asked whether inverse fair value gaps and
// cross-timeframe pattern recognition had been tried. They had not been. This settles it with a
// number instead of an argument.
//
// THE PRIOR IS POOR AND THE REASON IS STRUCTURAL, stated here so a result cannot be read as a
// surprise either way. FINDINGS.md records that ZERO OF TEN scorable entry families beat their own
// matched-geometry random-entry null; the best, ma_dip, sits at the 52.1st percentile of its own
// null -- the coin-flip mark. A random entry with the same stop geometry, same exit path and same
// costs returned +0.1637R over that window, so any strategy averaging about +0.16R had shown
// nothing at all. An FVG is computed entirely from OHLC and is an entry trigger, which places it
// in exactly that family as its eleventh member.
//
// THE FOUR SIGNALS, fixed in advance:
//   fvgBull   a bullish three-bar imbalance forms
//   fvgBear   a bearish one forms
//   ifvgBull  a BEARISH gap is closed back through, read as flipping bullish
//   ifvgBear  the mirror
// All are taken LONG-ONLY. The account cannot short, so a bearish trigger is tested as a long
// entry and is expected to fail; including it is what makes the family honest rather than a
// one-sided search for the version that works.
//
// TIMEFRAMES: 1440 and 240 bars, both already in candle-bundle. That is the "across timeframes"
// part of the question and it is a MULTIPLICITY AMPLIFIER, not an improvement: four signals on two
// timeframes is eight cells, not one insight.
//
// FAMILY SIZE 8 for this run, and the cumulative entry-question family is EIGHTEEN once the ten
// families already tested are counted. Benjamini-Hochberg is applied at q=0.05 over the eight, and
// the cumulative eighteen is reported alongside, because a result that clears within a family of
// eight but not within the real history of the question has not cleared.
//
// TWO GATES, BOTH REQUIRED:
//   1. BEATS THE MATCHED-GEOMETRY NULL. Same stop distances, same exit path, same costs, random
//      entry. This is the test that killed the other ten.
//   2. BEATS BUY-AND-HOLD over the same window. This gate exists because the owner's own IBKR
//      manual omits it: neither its research scorecard nor its eight hard gates require a baseline
//      comparison, and that is precisely the criterion that closed all four mechanisms here --
//      positioning produced a cell clearing BH at p=0.0115 with a CAGR of -0.3%. A strategy that
//      beats a null and loses to holding the asset has selection skill and no tradeable return.
//
// KILL CONDITIONS, stated before the run:
//   - Any cell failing either gate is dead, whatever the other says.
//   - A cell clearing on one timeframe only is noise; the same mechanism must appear on both.
//   - If nothing clears, FVG/iFVG entries are CLOSED and this file says so.
//
// Usage: node fvg-run.mjs [nullDraws]
import { loadBundleCandles, availablePairs } from "./bundle-loader.mjs";
import { screenUniverse } from "./universe.mjs";
import { simulateExit, randomEntryDrawer } from "./entrynull.mjs";
import { matchedGeometryNull } from "./inference.mjs";
import { FVG_SIGNALS } from "./fvg.mjs";

const DRAWS = Number(process.argv[2] ?? 4000);
const Q = 0.05, PRIOR_FAMILIES = 10;
// Geometry held at the values the previous entry-family work used, so this is comparable to the
// ten it joins rather than a fresh search over exits.
const EXIT = { stopPct: 0.03, tpR: 3, maxHold: 100, feeRate: 0.0026, slipPct: 0.0005 };
const sec = (d) => Date.parse(d + "T00:00:00Z") / 1000;

function load(minutes) {
  const out = {};
  for (const p of availablePairs(minutes, "./candle-bundle")) {
    const c = loadBundleCandles(p, minutes, "./candle-bundle")
      .filter((b) => +b.time >= sec("2023-01-01") && +b.time <= sec("2026-09-02"));
    if (c.length >= 200) out[p] = c;
  }
  return screenUniverse(out).kept;
}

const rows = [];
for (const minutes of [1440, 240]) {
  const series = load(minutes);
  const pairs = Object.keys(series);
  if (pairs.length < 5) { console.log(`${minutes}m: only ${pairs.length} symbols, skipped`); continue; }

  // Buy-and-hold over the same bars and the same universe, in R units so it is comparable to a
  // trade population. Equal weight across pairs, entry at the first bar, exit at the last.
  const bhR = pairs.map((p) => {
    const c = series[p], a = Number(c[0].close), b = Number(c[c.length - 1].close);
    return a > 0 && b > 0 ? (b - a) / (a * EXIT.stopPct) : null;
  }).filter((v) => v !== null);
  const bhMean = bhR.reduce((x, y) => x + y, 0) / bhR.length;

  for (const [name, detect] of Object.entries(FVG_SIGNALS)) {
    const observed = [];
    for (const p of pairs) {
      for (const idx of detect(series[p])) {
        const r = simulateExit(series[p], idx, EXIT);
        if (r !== null && Number.isFinite(r)) observed.push({ symbol: p, stopPct: EXIT.stopPct, r });
      }
    }
    if (observed.length < 30) { console.log(`${minutes}m ${name}: only ${observed.length} trades, unscoreable`); continue; }
    const mean = observed.reduce((a, t) => a + t.r, 0) / observed.length;
    // Parameter names taken from inference.mjs, not assumed: observedMean (not observedMeanR),
    // k (not draws), seed (not an rng). gate-run.mjs's header records what guessing these costs --
    // wrong field names there made every gate condition read BLOCKED, which looks like "not proven"
    // and actually meant "never asked".
    const nul = matchedGeometryNull({
      observedMean: mean,
      drawTrade: randomEntryDrawer({ observed, seriesByPair: series, exit: EXIT }),
      n: observed.length, k: DRAWS, seed: 20260911,
    });
    rows.push({ minutes, name, n: observed.length, mean, nullMean: nul.nullMean,
                excess: nul.excessOverNull, p: nul.p, bhMean, beatsBH: mean > bhMean });
  }
}

if (!rows.length) { console.log("nothing scoreable"); process.exit(0); }
console.log(`\nFVG/iFVG as entry triggers. ${DRAWS} null draws. Family of ${rows.length} here; ` +
  `cumulative entry-question family ${rows.length + PRIOR_FAMILIES}.\n`);
console.log("tf".padEnd(6) + "signal".padEnd(10) + "trades".padStart(8) + "meanR".padStart(9) +
  "nullR".padStart(9) + "excess".padStart(9) + "p".padStart(9) + "  buy&hold R   beats B&H");
for (const r of rows) {
  console.log(String(r.minutes).padEnd(6) + r.name.padEnd(10) + String(r.n).padStart(8) +
    r.mean.toFixed(4).padStart(9) + r.nullMean.toFixed(4).padStart(9) +
    r.excess.toFixed(4).padStart(9) + r.p.toFixed(4).padStart(9) +
    r.bhMean.toFixed(4).padStart(13) + (r.beatsBH ? "        YES" : "        no"));
}

const fam = [...rows].sort((a, b) => a.p - b.p), m = fam.length;
let cut = 0;
for (let i = 0; i < m; i++) if (fam[i].p <= ((i + 1) / m) * Q) cut = i + 1;
console.log(`\n=== BH over the ${m} cells run here, q=${Q} ===`);
for (let i = 0; i < m; i++)
  console.log(`${i + 1}`.padEnd(4) + `${fam[i].minutes}m ${fam[i].name}`.padEnd(18) +
    fam[i].p.toFixed(4).padStart(9) + `  thr ${(((i + 1) / m) * Q).toFixed(4)}` + (i < cut ? "   YES" : "   no"));

// Gate 2 is applied AFTER the null, never instead of it. Both are required.
const survivors = fam.slice(0, cut).filter((r) => r.beatsBH);
const cumThr = (1 / (m + PRIOR_FAMILIES)) * Q;
console.log(`\n${cut} of ${m} clear the null under BH; ${survivors.length} of those also beat buy-and-hold.`);
console.log(`Cumulative family of ${m + PRIOR_FAMILIES} (ten entry families already failed this same null):`);
console.log(`  the rank-1 threshold becomes ${cumThr.toFixed(4)}; cells clearing it: ` +
  fam.filter((r) => r.p <= cumThr).length);
if (!survivors.length) {
  console.log("\nNothing passes both gates. Under the pre-registered kill condition, FVG and iFVG");
  console.log("entries are CLOSED -- the eleventh entry family to fail the same matched-geometry null.");
} else {
  const tfs = new Set(survivors.map((r) => r.name));
  console.log("\nSurvivors must appear on BOTH timeframes to count. Present on both: " +
    [...tfs].filter((n) => survivors.filter((r) => r.name === n).length > 1).join(", ") || "(none)");
}
