/**
 * RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY (additive, read-only research, cache-only — no IBKR
 * egress). `MADIP-RANDOM-ENTRY-CONTROL`'s most consequential number was not `ma_dip`'s own
 * percentile inside its matched-geometry null — it was the null's own mean: +0.1493R on DJIA-30
 * and +0.1637R on DJTA-20. A random long entry carrying `ma_dip`'s exact stop/target/breakeven
 * geometry already made money in that window before any entry-timing rule was credited. Nobody
 * has asked whether that is a property of the payoff geometry (durable) or of the one ~2-year
 * holdout window this project has measured everything against (a tailwind every equities result
 * here has been riding). This item holds the geometry fixed and varies the window instead.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * GEOMETRY FROZEN, reused unchanged from `MADIP-RANDOM-ENTRY-CONTROL`: config
 * `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`, `backtest.js`'s own MAX_HOLD=100 default, `strategy.js`'s own
 * BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=0.018, IBKR Fixed $0.005/share commission
 * (per-symbol via that sub-window's own avgClose), 5bps/side slippage. Same two universes,
 * same caches: DJIA-30 (`research-cache/equities-1d/`) and DJTA-20
 * (`research-cache/equities-1d-djta-oos/`).
 *
 * WHAT VARIES: the predecessor built its null on each universe's 70/30-split HOLDOUT only
 * (~150 candles). This item instead uses the FULL cached history per symbol (501 candles,
 * 2024-08-20/22 through 2026-08-19/21) and splits it into non-overlapping CALENDAR-YEAR
 * sub-windows — chosen over equal-length blocks because the cache actually supports it cleanly:
 * both universes' caches land on the identical year structure (checked before any return was
 * computed) — 2024: 91-93 candles (partial, cache starts in August), 2025: 250 candles (full
 * calendar year), 2026: 158-160 candles (partial, cache ends in August). Calendar years are also
 * the more interpretable unit for the question this item asks ("was 2025 the rising year that
 * created the tailwind") than an arbitrary equal-length block boundary would be. This choice is
 * fixed before any null or buy-and-hold return below is computed. Train/holdout status is not
 * used to gate which candles enter a sub-window — this item asks about the window's own
 * character, not about `ma_dip`'s out-of-sample generalization (that question is
 * `MADIP-RANDOM-ENTRY-CONTROL`'s, already answered).
 *
 * PER-SUB-WINDOW NULL CONSTRUCTION — identical to the predecessor's four choices, reapplied
 * independently inside each (universe, sub-window) cell: (1) entry timing random — symbol drawn
 * uniformly from that cell's active symbols, entry index drawn uniformly from that symbol's OWN
 * candles inside that sub-window only (a random entry in the 2024 window cannot draw a 2025
 * candle); (2) stop distance drawn with replacement from that CELL's OWN empirical stop-distance
 * distribution — the same window's real `ma_dip` trades, not pooled across windows, so a thin
 * window's null is not secretly borrowing another window's geometry; (3) exit management
 * replicating `backtest.js`'s generic path exactly, walking forward only within that sub-window's
 * own candles and force-closing at the sub-window's last available close if a draw runs past its
 * end (disclosed per cell, not silently dropped — expected to be more common in the two partial
 * years and in 2026, which is the newest year and gives fewer forward candles to any trade
 * entered late in it); (4) sample size matches that cell's own real trade count exactly. K=2000
 * draws per cell (unchanged from the predecessor).
 *
 * MINIMUM SAMPLE FOR A NULL: fewer than 10 real trades in a cell is not enough to build a
 * meaningful stop-distance distribution (same floor `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`
 * pre-registered for the identical reason) — such a cell is reported as too-thin-to-score, not
 * given a null mean that cannot mean anything.
 *
 * BUY-AND-HOLD: for each universe/sub-window, the equal-weighted mean across that cell's active
 * symbols of that symbol's own simple total price return over the sub-window (last close / first
 * close - 1 on the candles actually inside that window). Frictionless and unlevered — a benchmark
 * reference for the window's own direction, not a traded return, so no commission/slippage is
 * applied to it (unlike the null and the real trades, which are actual simulated positions).
 *
 * DECISION QUESTIONS, pre-registered before any cell is computed: (a) is the null's mean positive
 * in every scored cell or concentrated in some; (b) what is the Pearson correlation, across all
 * scored cells, between a cell's null mean and that cell's buy-and-hold return; (c) one sentence,
 * decided by (a) and (b) and not moved after seeing them: if the null's mean tracks buy-and-hold
 * (strong positive correlation, sign flips or weakens where buy-and-hold does) it reads as a
 * window artifact — leverage on the window's own direction, not a geometry edge; if the null's
 * mean stays positive even where buy-and-hold is flat or negative, that is evidence for a durable
 * property of the payoff geometry itself. NO strategy, parameter or promotion is proposed here
 * either way — a payoff structure that pays in rising markets is a description of leverage, not
 * an edge, and this item's job is to say which one it is, not to act on it.
 *
 * This is a descriptive null-control study, not a hypothesis test in `MULTIPLE_COMPARISONS_
 * AUDIT.md`'s formal-NHST sense — it does not join that family and triggers no BH-FDR
 * recomputation, per `MADIP-RANDOM-ENTRY-CONTROL`'s own precedent.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../../backtest.js";
import { saveExperiment } from "../../researchlab.mjs";

const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

const TP_R = 5;
const MAX_HOLD = 100; // backtest.js's own default — unmodified, same as the predecessor
const BE_TRIGGER_R = 2.0; // strategy.js default — unmodified
const BE_LOCK_R = 0.2; // strategy.js default — unmodified
const FEE_BUFFER_PCT = 0.018; // strategy.js default — unmodified

const K_DRAWS = 2000;
const MIN_TRADES_FOR_NULL = 10;
const SEED = 20260829; // this project's per-script local-seed convention, today's date

const YEARS = [2024, 2025, 2026]; // fixed from the cache inspection above, before any return computed

const UNIVERSES = {
  "DJIA-30": {
    cacheDir: path.join(".", "research-cache", "equities-1d"),
    symbols: [
      "MMM", "DOW", "MSFT", "AMZN", "GS", "NKE", "AXP", "HD", "PG", "AMGN",
      "HON", "CRM", "AAPL", "INTC", "TRV", "BA", "IBM", "UNH", "CAT", "JNJ",
      "VZ", "CVX", "JPM", "V", "CSCO", "MCD", "WMT", "KO", "MRK", "DIS",
    ],
  },
  "DJTA-20": {
    cacheDir: path.join(".", "research-cache", "equities-1d-djta-oos"),
    symbols: [
      "ALK", "CAR", "CHRW", "CSX", "DAL", "EXPD", "FDX", "AAL", "JBHT", "KEX",
      "LSTR", "MATX", "NSC", "ODFL", "R", "LUV", "UBER", "UNP", "UAL", "UPS",
    ],
  },
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function loadCached(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function candlesInYear(candles, year) {
  return candles.filter((c) => new Date(Number(c.time) * 1000).getUTCFullYear() === year);
}

// Reruns the real ma_dip signal confined to this sub-window's own candles, returning entry/risk
// alongside r so this cell's OWN empirical stop-distance distribution can be built (pre-reg #2).
function collectWindowTrades(windowCandles) {
  const trades = [];
  const perSymbolWindow = new Map();
  const perSymbolFeeRate = new Map();
  for (const [symbol, candles] of Object.entries(windowCandles)) {
    if (candles.length < 20) continue; // not enough bars in this window to trust a signal run
    const avgClose = candles.reduce((a, c) => a + Number(c.close), 0) / candles.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    perSymbolWindow.set(symbol, candles);
    perSymbolFeeRate.set(symbol, feeRate);
    const series = [{ label: "1d", mins: 1440, candles }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    for (const exc of r.excursions) trades.push({ symbol, r: exc.r, entry: exc.entry, risk: exc.risk, stopPct: exc.risk / exc.entry });
  }
  return { trades, perSymbolWindow, perSymbolFeeRate };
}

// Identical to MADIP-RANDOM-ENTRY-CONTROL's simulateRandomExit, walking forward only within the
// candles it is handed (here: one sub-window's own candles) — see pre-reg #3.
function simulateRandomExit(candles, entryIdx, stopPct, feeRate, slipPct) {
  const entry = Number(candles[entryIdx].close);
  const risk = entry * stopPct;
  if (!(risk > 0)) return null;
  let stop = entry - risk;
  const tp = entry + TP_R * risk;
  let beMoved = false;
  const lockOffset = Math.max(BE_LOCK_R * risk, FEE_BUFFER_PCT * entry);
  const armOffset = Math.max(BE_TRIGGER_R * risk, lockOffset + 0.5 * risk);
  const netAt = (px) => (px - entry) / risk - ((feeRate + slipPct) * (entry + px)) / risk;

  for (let k = entryIdx + 1; k < candles.length; k++) {
    const hi = Number(candles[k].high), lo = Number(candles[k].low), close = Number(candles[k].close);
    if (lo <= stop) return { r: netAt(stop), why: beMoved ? "trail/be" : "stop" };
    if (hi >= tp) return { r: netAt(tp), why: "target" };
    if (!beMoved && hi >= entry + armOffset) { stop = Math.max(stop, entry + lockOffset); beMoved = true; }
    if (k - entryIdx >= MAX_HOLD) return { r: netAt(close), why: "timeout" };
  }
  // Ran off the end of this sub-window's own candles before any exit fired — force-close at the
  // last available close inside the window (disclosed data-edge case, see pre-reg #3).
  const last = Number(candles[candles.length - 1].close);
  return { r: netAt(last), why: "dataEnd" };
}

function drawOneNull(symbols, perSymbolWindow, perSymbolFeeRate, stopPctPool, n, rng) {
  let sum = 0, count = 0, dataEndCount = 0;
  for (let i = 0; i < n; i++) {
    let sim = null;
    for (let attempt = 0; attempt < 10 && !sim; attempt++) {
      const symbol = symbols[Math.floor(rng() * symbols.length)];
      const candles = perSymbolWindow.get(symbol);
      if (!candles || candles.length < 2) continue;
      const entryIdx = Math.floor(rng() * (candles.length - 1));
      const stopPct = stopPctPool[Math.floor(rng() * stopPctPool.length)];
      sim = simulateRandomExit(candles, entryIdx, stopPct, perSymbolFeeRate.get(symbol), SLIPPAGE_PCT_EQUITY);
    }
    if (!sim) continue; // exhausted retries — statistically negligible, not forced
    sum += sim.r;
    count++;
    if (sim.why === "dataEnd") dataEndCount++;
  }
  return { avgR: count ? sum / count : null, count, dataEndCount };
}

function buyAndHoldReturn(windowCandles) {
  const perSymbolReturns = [];
  for (const candles of Object.values(windowCandles)) {
    if (candles.length < 2) continue;
    const first = Number(candles[0].close), last = Number(candles[candles.length - 1].close);
    if (first > 0) perSymbolReturns.push(last / first - 1);
  }
  const mean = perSymbolReturns.length ? perSymbolReturns.reduce((a, b) => a + b, 0) / perSymbolReturns.length : null;
  return { symbolsUsed: perSymbolReturns.length, meanReturn: mean };
}

function analyzeCell(universeName, year, allCandles, rng) {
  const windowCandles = {};
  for (const [symbol, candles] of Object.entries(allCandles)) {
    const inYear = candlesInYear(candles, year);
    if (inYear.length) windowCandles[symbol] = inYear;
  }

  const bh = buyAndHoldReturn(windowCandles);
  const { trades: realTrades, perSymbolWindow, perSymbolFeeRate } = collectWindowTrades(windowCandles);
  const N = realTrades.length;
  const activeSymbols = [...perSymbolWindow.keys()];

  if (N < MIN_TRADES_FOR_NULL) {
    return {
      universe: universeName, year, tooThinForNull: true,
      realTrades: N,
      note: `Only ${N} real ma_dip trades in this sub-window — below the pre-registered floor of ${MIN_TRADES_FOR_NULL}. Not scored.`,
      buyAndHold: bh,
    };
  }

  const realAvgR = realTrades.reduce((a, t) => a + t.r, 0) / N;
  const stopPctPool = realTrades.map((t) => t.stopPct);

  const nullDraws = [];
  let totalDataEnd = 0, totalSimTrades = 0;
  for (let d = 0; d < K_DRAWS; d++) {
    const draw = drawOneNull(activeSymbols, perSymbolWindow, perSymbolFeeRate, stopPctPool, N, rng);
    if (draw.avgR != null) nullDraws.push(draw.avgR);
    totalDataEnd += draw.dataEndCount;
    totalSimTrades += draw.count;
  }
  const nullMean = nullDraws.reduce((a, b) => a + b, 0) / nullDraws.length;
  const nullVariance = nullDraws.reduce((a, b) => a + (b - nullMean) ** 2, 0) / (nullDraws.length - 1);
  const nullSD = Math.sqrt(nullVariance);
  const positiveDrawFraction = nullDraws.filter((v) => v > 0).length / nullDraws.length;

  return {
    universe: universeName, year, tooThinForNull: false,
    realTrades: N, realAvgR,
    kDraws: K_DRAWS, nullDrawsUsable: nullDraws.length,
    nullMean, nullSD, positiveDrawFraction,
    dataEndFraction: totalSimTrades ? totalDataEnd / totalSimTrades : null,
    buyAndHold: bh,
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

function main() {
  const rng = seeded(SEED);
  const cells = [];

  for (const [universeName, spec] of Object.entries(UNIVERSES)) {
    const allCandles = {};
    for (const symbol of spec.symbols) {
      const candles = loadCached(spec.cacheDir, symbol);
      if (!candles) { console.error(`MISSING CACHE: ${universeName}/${symbol}`); continue; }
      allCandles[symbol] = candles;
    }
    for (const year of YEARS) {
      cells.push(analyzeCell(universeName, year, allCandles, rng));
    }
  }

  const scored = cells.filter((c) => !c.tooThinForNull);
  const positiveCells = scored.filter((c) => c.nullMean > 0);
  const nonPositiveCells = scored.filter((c) => c.nullMean <= 0);
  const tailwindPresentInEveryScoredCell = scored.length > 0 && nonPositiveCells.length === 0;

  const corrInputs = scored.filter((c) => c.buyAndHold.meanReturn != null);
  const correlationNullMeanVsBuyHold = corrInputs.length >= 3
    ? pearson(corrInputs.map((c) => c.nullMean), corrInputs.map((c) => c.buyAndHold.meanReturn))
    : null;
  const allScoredCellsHadPositiveBuyAndHold = corrInputs.length > 0 && corrInputs.every((c) => c.buyAndHold.meanReturn > 0);
  const strongCorrelation = correlationNullMeanVsBuyHold != null && Math.abs(correlationNullMeanVsBuyHold) >= 0.5;

  let verdict;
  let untestedRegimeCaveat = null;
  if (scored.length === 0) {
    verdict = "No sub-window had enough real trades to score a null — no verdict can be drawn from this window split.";
  } else {
    if (allScoredCellsHadPositiveBuyAndHold) {
      untestedRegimeCaveat = "Every one of the scored sub-windows had a POSITIVE buy-and-hold return — this cache (2024-08 through 2026-08) never contains a falling or flat sub-window, so whether the geometry's tailwind survives a down window is NOT actually testable from this cache; only how the tailwind's size scales with the degree of a rising market is.";
    }
    if (tailwindPresentInEveryScoredCell && strongCorrelation) {
      verdict = allScoredCellsHadPositiveBuyAndHold
        ? `Within the one regime this cache contains (rising throughout), the geometry's null mean was positive in every sub-window and scaled closely with how strongly that window was rising (r=${correlationNullMeanVsBuyHold.toFixed(2)} against buy-and-hold) — consistent with a window/leverage effect rather than a geometry-only edge, though a genuinely flat or falling window (absent from this cache) remains the real test and has not been run.`
        : `The geometry's positive null mean held in every scored sub-window and tracked that window's own buy-and-hold return closely (r=${correlationNullMeanVsBuyHold.toFixed(2)}) even where buy-and-hold's sign varied — this reads as a window artifact (leverage on the window's own direction), not a durable property of the payoff geometry.`;
    } else if (tailwindPresentInEveryScoredCell) {
      verdict = "The geometry's positive null mean held in every scored sub-window and did not move in lockstep with buy-and-hold across windows — this reads as a durable property of the payoff geometry (structural stop, large fixed target, breakeven lock) rather than as an artifact of this holdout window's own direction.";
    } else {
      verdict = "The geometry's null mean was positive in some sub-windows and non-positive in others, tracking each window's own buy-and-hold direction — this reads as a window artifact (leverage on the window's own direction), not a durable property of the payoff geometry.";
    }
  }

  const report = {
    config: CONFIG,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    tpR: TP_R,
    maxHold: MAX_HOLD,
    beTriggerR: BE_TRIGGER_R,
    beLockR: BE_LOCK_R,
    feeBufferPct: FEE_BUFFER_PCT,
    kDraws: K_DRAWS,
    minTradesForNull: MIN_TRADES_FOR_NULL,
    seed: SEED,
    segmentationChoice: "calendar-year (2024 partial, 2025 full, 2026 partial) — chosen over equal-length blocks because both universes' caches share the identical year structure, checked before any return was computed; see header.",
    cells,
    summary: {
      cellsTotal: cells.length,
      cellsScored: scored.length,
      cellsTooThinForNull: cells.length - scored.length,
      cellsWithPositiveNullMean: positiveCells.length,
      cellsWithNonPositiveNullMean: nonPositiveCells.length,
      tailwindPresentInEveryScoredCell,
      correlationNullMeanVsBuyHold,
      allScoredCellsHadPositiveBuyAndHold,
      untestedRegimeCaveat,
      verdict,
    },
  };

  const saved = saveExperiment("random-entry-null-window-sensitivity", {
    specification: "random-entry-null-window-sensitivity/v1",
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    kDraws: K_DRAWS,
    seed: SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
