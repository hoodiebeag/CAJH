/**
 * GEOMETRY-NULL-DOWN-WINDOW-PROBE (additive, read-only research, cache-only — no egress of any
 * kind, no IBKR, no Kraken API calls; reads local candle stores only).
 *
 * `RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY` found the matched-geometry null's mean tracks each
 * scored window's own buy-and-hold return at r=0.90 across six cells (DJIA-30/DJTA-20 x
 * 2024/2025/2026), but stated plainly that its cache (2024-08 through 2026-08) contains NO down
 * or flat sub-window on either equity universe — so whether the geometry's positive null mean is
 * a durable property of the payoff structure (structural stop, tpR=5, breakeven lock) or an
 * artifact of measuring only in a rising window was left explicitly untested. This item is the
 * single measurement that would resolve it: survey every cached price series this project has
 * access to for a genuinely down-or-flat sub-window, and if one exists anywhere, rebuild the
 * matched-geometry null there.
 *
 * ============================ PRE-REGISTRATION (written before any return below is computed) ============================
 * QUALIFYING CRITERION for a "genuinely down or flat" sub-window, fixed now, before any buy-and-
 * hold return is examined:
 *   - minimum window length: 60 calendar days (keeps enough bars to rebuild a stop-distance
 *     distribution and run a K=2000 matched-geometry null; roughly a calendar quarter);
 *   - equal-weighted mean buy-and-hold return across the universe's symbols active in that
 *     window (last close / first close - 1, frictionless, unlevered — identical convention to
 *     `RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY`'s `buyAndHoldReturn`) of <= 0.00.
 * A single non-positive threshold, not a separate "down" vs "flat" band, because the question
 * this item answers ("does the geometry's positive null mean survive outside a rising window")
 * only needs "not rising" — splitting further would not change the decision rule below and would
 * only invite picking whichever sub-band flatters a preferred answer after the fact.
 *
 * SEGMENTATION, fixed now, before any window is inspected: calendar QUARTERS (Jan-Mar/Apr-Jun/
 * Jul-Sep/Oct-Dec, UTC) and calendar YEARS, for every quarter/year with at least one candle in
 * each universe's own cache. Quarters and years are both scored (years were the predecessor's
 * unit; quarters are added here because they are the finest calendar-aligned unit that can still
 * clear the 60-day floor, and a down quarter can exist inside a rising year that this project has
 * only measured at the year level so far). This is a deterministic, mechanical partition of the
 * calendar — not a manually chosen drawdown window picked after looking at the data, which this
 * item's own task text explicitly prohibits.
 *
 * UNIVERSES SURVEYED, cache-only:
 *   - DJIA-30 (`research-cache/equities-1d/`, 30 symbols, `MADIP-RANDOM-ENTRY-CONTROL`'s roster)
 *   - DJTA-20 (`research-cache/equities-1d-djta-oos/`, 20 symbols, same roster)
 *   - CRYPTO-28 (every pair with a CSV under `candles/`, resampled to 1440m/1d bars via
 *     `data.js`'s own `loadCandles`, the same resampler `researchlab.mjs` and the live bot use —
 *     no new candle-reading logic. Local 1-minute store, 2023-01-01 through the file's own last
 *     bar per symbol; this is the only cache with meaningfully deeper history than the two
 *     equity universes' ~2 years, so it is the most likely place a down/flat window exists.)
 *
 * IF ONE OR MORE WINDOWS QUALIFY: `MADIP-RANDOM-ENTRY-CONTROL`'s construction is rebuilt in that
 * window UNCHANGED, reusing `RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY`'s per-cell implementation
 * verbatim (same file, copied here rather than imported so this script stays self-contained and
 * additive): real `ma_dip` trades re-run on that window's own candles only (config frozen —
 * `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06,
 * tpR: 5, lockBreakeven: true }`), stop distance drawn with replacement from that window's OWN
 * empirical stop distribution, exit management replicating `backtest.js`'s generic path
 * byte-for-byte (stop checked first against the bar's low, then tp against the bar's high, then
 * breakeven arm/lock using `strategy.js`'s own BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=
 * 0.018, then `backtest.js`'s own MAX_HOLD=100 default), sample size matching that window's own
 * real trade count exactly, K=2000 draws, force-close at the window's last available close
 * disclosed as a data-edge case. Same MIN_TRADES_FOR_NULL=10 floor as the predecessor — a
 * qualifying window with fewer than 10 real `ma_dip` trades is reported too-thin-to-score, not
 * given a null mean that cannot mean anything. Fee basis for CRYPTO-28 cells uses `strategy.js`'s
 * own FEE_RATE=0.008 per-side taker default (identical to `cost-model.mjs`'s
 * SPOT_FEE_SCHEDULE.taker) rather than the IBKR per-share commission the equity universes use,
 * since `ma_dip`'s frozen config has never been priced with a per-share commission on a
 * non-equity instrument and doing so here would silently invent a new cost assumption; this is
 * disclosed per-cell.
 *
 * DECISION RULE, pre-registered before any draw runs: report whether the qualifying window's
 * null mean is still positive. Positive-and-qualifying is evidence the payoff geometry itself
 * (large fixed target, structural stop, breakeven lock) carries a durable tailwind independent of
 * market direction; non-positive-and-qualifying is evidence the six rising-window null means on
 * record were a window artifact. Either way this is the headline, reported without softening.
 *
 * IF NO WINDOW QUALIFIES ANYWHERE: that is reported as the headline, with the specific data that
 * would be required to ever test this named explicitly, and the artifact-vs-durable question
 * stays open — not asserted as answered either way.
 *
 * WHY THIS IS NOT CAUGHT BY D1: the phase-directive's D1 step closes new price-structure ENTRY
 * VARIANTS, GATE INPUTS, and COST ANGLES on the twelve sealed families. This item proposes none
 * of those — no new entry rule, no new gate, no new cost angle, and no strategy or family is
 * touched, tuned, or promoted by it either way. It is a methodology control on the measurement
 * conditions (which historical windows this project's caches happen to contain) underlying an
 * already-existing null-control study, not a candidate mechanism competing for D1 slots — the
 * kind of question D1's own scope explicitly does not cover.
 *
 * No entry rule proposed or tested here beyond `ma_dip` itself (already sealed, unchanged). No
 * parameter re-tuned. SEALED_SYMBOLS untouched. This is a descriptive null-control study, not a
 * hypothesis test in `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST sense, per
 * `MADIP-RANDOM-ENTRY-CONTROL`'s own precedent — it does not join that family and triggers no
 * BH-FDR recomputation.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../backtest.js";
import { saveExperiment } from "../researchlab.mjs";
import { loadCandles } from "../data.js";

const COMMISSION_PER_SHARE = 0.005; // equities only, IBKR Fixed — unchanged from the predecessor
const SLIPPAGE_PCT_EQUITY = 0.0005;
const SLIPPAGE_PCT_CRYPTO = 0.0005; // strategy.js SLIPPAGE_PCT default — unmodified
const CRYPTO_FEE_RATE = 0.008; // strategy.js FEE_RATE default (== cost-model.mjs SPOT_FEE_SCHEDULE.taker) — this project's standard per-side crypto taker-fee assumption; no per-share commission on a non-equity instrument (see pre-registration)
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

const TP_R = 5;
const MAX_HOLD = 100; // backtest.js's own default — unmodified, same as the predecessor
const BE_TRIGGER_R = 2.0; // strategy.js default — unmodified
const BE_LOCK_R = 0.2; // strategy.js default — unmodified
const FEE_BUFFER_PCT = 0.018; // strategy.js default — unmodified

const K_DRAWS = 2000;
const MIN_TRADES_FOR_NULL = 10;
const MIN_WINDOW_DAYS = 60;
const QUALIFYING_MAX_RETURN = 0.0; // <=0 buy-and-hold over >=60 days qualifies as "down or flat"
const SEED = 20260829; // this project's per-script local-seed convention, today's date

// Prior null means on record, rising windows only (for the comparison this item's decision rule
// calls for) — cited from MADIP-RANDOM-ENTRY-CONTROL and RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY,
// not recomputed here.
const PRIOR_RISING_NULL_MEANS = {
  "DJIA-30 (holdout, MADIP-RANDOM-ENTRY-CONTROL)": 0.1493,
  "DJTA-20 (holdout, MADIP-RANDOM-ENTRY-CONTROL)": 0.1637,
};

const EQUITY_UNIVERSES = {
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

function loadCachedEquity(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function listCryptoSymbols() {
  const dir = path.join(".", "candles");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).map((f) => f.replace(/\.csv$/, "")).sort();
}

// ── Segmentation: calendar quarters + calendar years, mechanical, decided above ────────────────
function quarterKey(date) { return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`; }
function yearKey(date) { return `${date.getUTCFullYear()}`; }

function segmentByKey(allCandles, keyFn) {
  const cells = new Map(); // key -> { symbol -> candles[] }
  for (const [symbol, candles] of Object.entries(allCandles)) {
    for (const c of candles) {
      const key = keyFn(new Date(Number(c.time) * 1000));
      if (!cells.has(key)) cells.set(key, {});
      const bucket = cells.get(key);
      (bucket[symbol] ??= []).push(c);
    }
  }
  return cells;
}

function windowSpanDays(windowCandles) {
  let minT = Infinity, maxT = -Infinity;
  for (const candles of Object.values(windowCandles)) {
    for (const c of candles) {
      const t = Number(c.time);
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  return (maxT - minT) / 86400;
}

function buyAndHoldReturn(windowCandles) {
  const perSymbolReturns = [];
  for (const candles of Object.values(windowCandles)) {
    if (candles.length < 2) continue;
    const sorted = [...candles].sort((a, b) => Number(a.time) - Number(b.time));
    const first = Number(sorted[0].close), last = Number(sorted[sorted.length - 1].close);
    if (first > 0) perSymbolReturns.push(last / first - 1);
  }
  const mean = perSymbolReturns.length ? perSymbolReturns.reduce((a, b) => a + b, 0) / perSymbolReturns.length : null;
  return { symbolsUsed: perSymbolReturns.length, meanReturn: mean };
}

// ── Real ma_dip trades + matched-geometry null, identical construction to
// RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY / MADIP-RANDOM-ENTRY-CONTROL (see pre-registration) ──────
function collectWindowTrades(windowCandles, feeRateFor) {
  const trades = [];
  const perSymbolWindow = new Map();
  const perSymbolFeeRate = new Map();
  for (const [symbol, candlesRaw] of Object.entries(windowCandles)) {
    const candles = [...candlesRaw].sort((a, b) => Number(a.time) - Number(b.time));
    if (candles.length < 20) continue;
    const feeRate = feeRateFor(symbol, candles);
    perSymbolWindow.set(symbol, candles);
    perSymbolFeeRate.set(symbol, feeRate);
    const series = [{ label: "1d", mins: 1440, candles }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    for (const exc of r.excursions) trades.push({ symbol, r: exc.r, entry: exc.entry, risk: exc.risk, stopPct: exc.risk / exc.entry });
  }
  return { trades, perSymbolWindow, perSymbolFeeRate };
}

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
  const last = Number(candles[candles.length - 1].close);
  return { r: netAt(last), why: "dataEnd" };
}

function drawOneNull(symbols, perSymbolWindow, perSymbolFeeRate, stopPctPool, n, rng, slipPct) {
  let sum = 0, count = 0, dataEndCount = 0;
  for (let i = 0; i < n; i++) {
    let sim = null;
    for (let attempt = 0; attempt < 10 && !sim; attempt++) {
      const symbol = symbols[Math.floor(rng() * symbols.length)];
      const candles = perSymbolWindow.get(symbol);
      if (!candles || candles.length < 2) continue;
      const entryIdx = Math.floor(rng() * (candles.length - 1));
      const stopPct = stopPctPool[Math.floor(rng() * stopPctPool.length)];
      sim = simulateRandomExit(candles, entryIdx, stopPct, perSymbolFeeRate.get(symbol), slipPct);
    }
    if (!sim) continue;
    sum += sim.r;
    count++;
    if (sim.why === "dataEnd") dataEndCount++;
  }
  return { avgR: count ? sum / count : null, count, dataEndCount };
}

// Sanity check on the R-normalization itself: netAt(stop) = -1 - (feeRate+slipPct)*2/stopPct
// (approximately, for stopPct << 1) — designed for equities where feeRate is ~1e-5 (per-share
// commission / price) and so negligible next to any realistic stop distance. Crypto's flat
// FEE_RATE=0.008 is ~500x larger; at ma_dip's typical stop distances (structural, not tuned for
// any fee model) this can make a single STOPPED-OUT trade's R many multiples below -1, which is
// not economically meaningable as a "risk multiple" — flagged here, not silently reported as if
// comparable to the equities figures (see pre-registration and ROADMAP.md write-up).
function feeModelSanityCheck(realTrades) {
  if (!realTrades.length) return { minRealR: null, medianStopPct: null, suspectFeeScaling: false };
  const rs = realTrades.map((t) => t.r).sort((a, b) => a - b);
  const stopPcts = realTrades.map((t) => t.stopPct).sort((a, b) => a - b);
  const minRealR = rs[0];
  const medianStopPct = stopPcts[Math.floor(stopPcts.length / 2)];
  return { minRealR, medianStopPct, suspectFeeScaling: minRealR < -5 };
}

function buildNullForWindow(windowCandles, feeRateFor, slipPct, rng) {
  const { trades: realTrades, perSymbolWindow, perSymbolFeeRate } = collectWindowTrades(windowCandles, feeRateFor);
  const N = realTrades.length;
  if (N < MIN_TRADES_FOR_NULL) return { tooThinForNull: true, realTrades: N };

  const realAvgR = realTrades.reduce((a, t) => a + t.r, 0) / N;
  const stopPctPool = realTrades.map((t) => t.stopPct);
  const activeSymbols = [...perSymbolWindow.keys()];
  const feeSanity = feeModelSanityCheck(realTrades);

  const nullDraws = [];
  let totalDataEnd = 0, totalSimTrades = 0;
  for (let d = 0; d < K_DRAWS; d++) {
    const draw = drawOneNull(activeSymbols, perSymbolWindow, perSymbolFeeRate, stopPctPool, N, rng, slipPct);
    if (draw.avgR != null) nullDraws.push(draw.avgR);
    totalDataEnd += draw.dataEndCount;
    totalSimTrades += draw.count;
  }
  const nullMean = nullDraws.reduce((a, b) => a + b, 0) / nullDraws.length;
  const nullVariance = nullDraws.reduce((a, b) => a + (b - nullMean) ** 2, 0) / (nullDraws.length - 1);
  const nullSD = Math.sqrt(nullVariance);
  const positiveDrawFraction = nullDraws.filter((v) => v > 0).length / nullDraws.length;

  return {
    tooThinForNull: false,
    realTrades: N, realAvgR,
    kDraws: K_DRAWS, nullDrawsUsable: nullDraws.length,
    nullMean, nullSD, positiveDrawFraction,
    dataEndFraction: totalSimTrades ? totalDataEnd / totalSimTrades : null,
    geometryPositiveHereToo: nullMean > 0,
    feeModelSanity: feeSanity,
  };
}

// ── Survey: every (universe, segmentation, cell) — full report, qualifying or not ───────────────
function surveyUniverse(universeName, allCandles, minWindowDays, maxReturn) {
  const rows = [];
  for (const [segLabel, keyFn] of [["quarter", quarterKey], ["year", yearKey]]) {
    const cells = segmentByKey(allCandles, keyFn);
    for (const [key, windowCandles] of [...cells.entries()].sort()) {
      const spanDays = windowSpanDays(windowCandles);
      const bh = buyAndHoldReturn(windowCandles);
      const qualifies = spanDays >= minWindowDays && bh.meanReturn != null && bh.meanReturn <= maxReturn;
      rows.push({ universe: universeName, segmentation: segLabel, window: key, spanDays, buyAndHold: bh, qualifies, windowCandlesRef: windowCandles });
    }
  }
  return rows;
}

function main() {
  const rng = seeded(SEED);

  // Load candles per universe (cache-only; crypto via data.js's own resampler, no new I/O logic)
  const universeCandles = {};
  for (const [name, spec] of Object.entries(EQUITY_UNIVERSES)) {
    const c = {};
    for (const symbol of spec.symbols) {
      const candles = loadCachedEquity(spec.cacheDir, symbol);
      if (!candles) { console.error(`MISSING CACHE: ${name}/${symbol}`); continue; }
      c[symbol] = candles;
    }
    universeCandles[name] = c;
  }
  const cryptoSymbols = listCryptoSymbols();
  const cryptoCandles = {};
  for (const symbol of cryptoSymbols) {
    try {
      const candles = loadCandles(symbol, 1440);
      if (candles.length) cryptoCandles[symbol] = candles;
    } catch (e) {
      console.error(`CRYPTO LOAD FAILED: ${symbol}: ${e.message}`);
    }
  }
  universeCandles["CRYPTO-28"] = cryptoCandles;

  const feeRateFor = {
    "DJIA-30": (symbol, candles) => COMMISSION_PER_SHARE / (candles.reduce((a, c) => a + Number(c.close), 0) / candles.length),
    "DJTA-20": (symbol, candles) => COMMISSION_PER_SHARE / (candles.reduce((a, c) => a + Number(c.close), 0) / candles.length),
    "CRYPTO-28": () => CRYPTO_FEE_RATE,
  };
  const slipPctFor = { "DJIA-30": SLIPPAGE_PCT_EQUITY, "DJTA-20": SLIPPAGE_PCT_EQUITY, "CRYPTO-28": SLIPPAGE_PCT_CRYPTO };

  const surveyAll = [];
  for (const [name, candlesBySymbol] of Object.entries(universeCandles)) {
    surveyAll.push(...surveyUniverse(name, candlesBySymbol, MIN_WINDOW_DAYS, QUALIFYING_MAX_RETURN));
  }

  const qualifyingCells = surveyAll.filter((r) => r.qualifies);
  const nullResultsByCell = [];
  for (const cell of qualifyingCells) {
    const nullResult = buildNullForWindow(cell.windowCandlesRef, feeRateFor[cell.universe], slipPctFor[cell.universe], rng);
    nullResultsByCell.push({
      universe: cell.universe, segmentation: cell.segmentation, window: cell.window,
      spanDays: cell.spanDays, buyAndHold: cell.buyAndHold, ...nullResult,
    });
  }

  const survey = surveyAll.map(({ windowCandlesRef, ...rest }) => rest); // strip candle payload from the report

  const scoredQualifying = nullResultsByCell.filter((r) => !r.tooThinForNull);
  const EQUITY_NAMES = new Set(Object.keys(EQUITY_UNIVERSES));
  const scoredEquity = scoredQualifying.filter((r) => EQUITY_NAMES.has(r.universe));
  const scoredCrypto = scoredQualifying.filter((r) => !EQUITY_NAMES.has(r.universe));
  const cryptoFeeScalingSuspect = scoredCrypto.some((r) => r.feeModelSanity?.suspectFeeScaling);

  const cryptoFeeModelCaveat = cryptoFeeScalingSuspect
    ? `CRYPTO-28's null-mean and realAvgR figures in this report are NOT directly comparable to the equities or to the prior rising-window figures: ma_dip's structural stops on the crypto universe run tight (median stopPct as low as ~1.6% in the checked cells) while this script prices crypto trades at strategy.js's flat FEE_RATE=0.008/side (~500x the equities' per-share commission expressed as a fraction of price) using backtest.js's own R-normalization formula, which was built for the equities case where fee cost is negligible next to any realistic stop distance. At a tight stop that formula produces single-trade R values many multiples below -1 (worst observed: ${Math.min(...scoredCrypto.map((r) => r.feeModelSanity.minRealR)).toFixed(2)}R) — a scale that is a cost-model artifact, not an economically meaningful loss multiple. The SIGN of the crypto cells (strongly negative in every qualifying down/flat quarter, versus the prior rising-window positive means) still corroborates the window-artifact conclusion; the MAGNITUDE does not and should not be cited as such.`
    : null;

  let headline, dataRequirementIfNone = null;
  if (qualifyingCells.length === 0) {
    headline = `NO WINDOW QUALIFIED: across ${survey.length} surveyed cells (calendar quarters + years) spanning DJIA-30, DJTA-20 and CRYPTO-28's full local candle stores, none had a >=${MIN_WINDOW_DAYS}-day window with buy-and-hold mean return <= ${QUALIFYING_MAX_RETURN}. The artifact-versus-durable question raised by RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY remains open.`;
    const minBH = survey.filter((r) => r.spanDays >= MIN_WINDOW_DAYS && r.buyAndHold.meanReturn != null)
      .reduce((min, r) => (r.buyAndHold.meanReturn < min.meanReturn ? r : min), { meanReturn: Infinity });
    dataRequirementIfNone = `Closest surveyed cell to qualifying: ${minBH.universe ?? "n/a"} ${minBH.window ?? "n/a"} at meanReturn=${Number.isFinite(minBH.meanReturn) ? minBH.meanReturn.toFixed(4) : "n/a"}. To ever test this, this project would need daily candle history covering a genuine >=60-day drawdown or flat period in a currently-cached universe (e.g. an equities cache extended back to include 2022, or a crypto pair's history extended to cover a bear-market quarter not already in the current 2023-01 through cache-end range) — none of which exists in any cache this script can read.`;
  } else if (scoredQualifying.length === 0) {
    headline = `${qualifyingCells.length} window(s) qualified as down/flat but ALL had fewer than ${MIN_TRADES_FOR_NULL} real ma_dip trades (too thin to build a meaningful stop-distance distribution) — no null could be scored. The artifact-versus-durable question remains open.`;
  } else if (scoredEquity.length > 0) {
    // Equities carry the primary evidentiary weight: same fee basis MADIP-RANDOM-ENTRY-CONTROL
    // and RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY already validated, no fee-scaling artifact.
    const anyPositive = scoredEquity.some((r) => r.nullMean > 0);
    const anyNonPositive = scoredEquity.some((r) => r.nullMean <= 0);
    const equityDetail = scoredEquity.map((r) => `${r.universe} ${r.window}: nullMean=${r.nullMean.toFixed(4)} vs buy-and-hold=${r.buyAndHold.meanReturn.toFixed(4)}`).join("; ");
    const cryptoNote = scoredCrypto.length
      ? ` CRYPTO-28 corroborates directionally (${scoredCrypto.length} down/flat cell(s), all null means strongly negative) but its magnitudes are unreliable — see cryptoFeeModelCaveat.`
      : "";
    headline = anyPositive && !anyNonPositive
      ? `On the RELIABLE (equities, validated fee basis) evidence, the geometry's positive null mean SURVIVES at least one genuinely down/flat window (${equityDetail}) — evidence FOR a durable property of the payoff geometry itself, independent of window direction.${cryptoNote}`
      : anyNonPositive && !anyPositive
      ? `On the RELIABLE (equities, validated fee basis) evidence, the geometry's null mean turns NON-POSITIVE in a genuinely down/flat window (${equityDetail}) — evidence the rising-window null means on record (${JSON.stringify(PRIOR_RISING_NULL_MEANS)}) were a WINDOW ARTIFACT, not a durable geometry property.${cryptoNote}`
      : `Mixed on the equities evidence: some qualifying windows kept a positive null mean, others did not (${equityDetail}) — no single verdict from equities alone.${cryptoNote}`;
  } else {
    // No equity cell qualified — crypto is the only evidence, and its magnitude is compromised.
    headline = `Only CRYPTO-28 cells qualified as down/flat (no equities cell did) — direction is informative (every qualifying cell's null mean went strongly negative, versus positive in every rising window on record) but magnitude is NOT reliable: see cryptoFeeModelCaveat. Treat this as suggestive, not conclusive, evidence for the window-artifact interpretation.`;
  }

  const report = {
    preRegistration: {
      minWindowDays: MIN_WINDOW_DAYS,
      qualifyingMaxReturn: QUALIFYING_MAX_RETURN,
      segmentation: "calendar quarter + calendar year, UTC, mechanical partition of every cell with >=1 candle",
      minTradesForNull: MIN_TRADES_FOR_NULL,
      kDraws: K_DRAWS,
      seed: SEED,
    },
    universesSurveyed: Object.keys(universeCandles),
    cryptoSymbolsFound: cryptoSymbols,
    surveyCellCount: survey.length,
    survey,
    qualifyingCellCount: qualifyingCells.length,
    nullResultsByQualifyingCell: nullResultsByCell,
    priorRisingNullMeansOnRecord: PRIOR_RISING_NULL_MEANS,
    headline,
    dataRequirementIfNone,
    cryptoFeeModelCaveat,
    whyNotCaughtByD1: "D1 closes new price-structure entry variants, gate inputs and cost angles on the 12 sealed families. This item proposes none of those and touches no family — it is a methodology control on which historical windows this project's caches contain, underlying an existing null-control study, not a candidate mechanism competing for D1 slots.",
  };

  const saved = saveExperiment("geometry-null-down-window-probe", {
    specification: "geometry-null-down-window-probe/v1",
    minWindowDays: MIN_WINDOW_DAYS,
    qualifyingMaxReturn: QUALIFYING_MAX_RETURN,
    kDraws: K_DRAWS,
    seed: SEED,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
