/**
 * MADIP-SURVIVABILITY-CONDITION-5 (additive, read-only research, cache-only — no IBKR egress).
 *
 * `ALPHA_DEFINITION.md` section 4b (as of 2026-08-28) states plainly: "The right next step is
 * not promotion and not a third universe... What remains is condition 5 on the evidence that
 * already exists — cheap relative to what it protects against." Condition 5 ("survivable": a
 * pre-registered drawdown ceiling justified by the recovery table, plus the expected worst
 * losing streak and its capital impact) is currently "not evaluated" for `ma_dip` — the only
 * candidate that has ever cleared conditions 1 and 3 together (condition 3 has since lapsed on
 * family growth alone, per that section, but nothing about `ma_dip`'s own numbers changed, and
 * this item is unaffected by that: survivability is a property of the trade sequence, not of
 * the correction family). `B5-REVERSAL` is the project's cautionary precedent: it cleared a
 * pre-registered gate at PHASE3 and died at PHASE4 on a -79% to -90% max drawdown. Nothing has
 * measured `ma_dip`'s drawdown, streak risk, or capital impact until this item.
 *
 * ============================ PRE-REGISTRATION (written before any statistic below is computed) ============================
 * CONFIG FROZEN: `{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0,
 * maxStopPct: .06, tpR: 5, lockBreakeven: true }` — verbatim from `EQUITIES-MADIP-SIGNIFICANCE` /
 * `EQUITIES-MADIP-OUT-OF-SAMPLE`. No parameter, stop, target, or universe change. Same cost
 * basis: IBKR Fixed $0.005/share commission (converted per-symbol via holdout avgClose), 5bps/
 * side slippage, 70/30 split. Same two universes, same caches, cache-only:
 *   - DJIA-30, `research-cache/equities-1d/` (475 trades in the original significance run)
 *   - DJTA-20 (point-in-time, zero ticker overlap), `research-cache/equities-1d-djta-oos/`
 *     (300 trades in `EQUITIES-MADIP-OUT-OF-SAMPLE`)
 * Reported SEPARATELY per universe, never pooled — pooling would hide a universe-specific
 * blowup, exactly what this item's `note` warns against.
 *
 * SIZING ASSUMPTION (stated before any drawdown is computed, since drawdown is a function of
 * this, not just of the trades): fixed-fractional risk `f` of current realised equity per
 * trade, at f = 0.01 / 0.02 / 0.05 (1%/2%/5% risk-per-trade — the standard retail range this
 * project has used elsewhere, e.g. `ALPHA_DEFINITION.md` §2's own worked example uses f=0.02
 * and f=0.05). Position size is snapshotted against the account's realised equity AT THE
 * MOMENT A TRADE IS ENTERED (not re-marked for other concurrently open positions — this project
 * models no margin/capital-lockup mechanic anywhere, so open positions do not reserve capital
 * from each other); P&L is realised into equity when that trade closes. This lets concurrent
 * positions coexist without artificially serialising risk, at the cost of not modelling margin
 * constraints — disclosed, not hidden. f=0.02 is the PRIMARY reference risk fraction for the
 * drawdown ceiling and full drawdown-episode distribution; f=0.01/0.05 are reported as
 * sensitivity (scalar max-DD only), not separately gated.
 *
 * TWO EQUITY CURVES, per this item's own required distinction:
 *   - "close-order" curve: trades sorted by EXIT time only, applied sequentially — this is what
 *     a naive single-threaded backtest gives, and it is WRONG whenever positions actually
 *     overlap in time, because it serialises risk that was never serial.
 *   - "calendar-time" curve: event-driven over (entryTime, exitTime) pairs, respecting genuinely
 *     simultaneous open positions per the sizing assumption above. This is the honest one; the
 *     close-order curve is reported alongside it only to show whether/how much the two diverge.
 * Max drawdown is reported from the calendar-time curve. An R-terms (non-compounding, additive)
 * curve in close-order is also reported for direct comparability with this codebase's existing
 * `maxDrawdownR` convention elsewhere.
 *
 * DRAWDOWN CEILING, pre-registered BEFORE computing: 25% on the calendar-time curve at the
 * primary f=0.02, which by `ALPHA_DEFINITION.md` §2's recovery table (`D/(1-D)`) requires
 * +33.3% to return to flat. Justification: `ma_dip`'s CI lower bound sits at 17% of its own
 * point estimate (`ALPHA_DEFINITION.md` §4b) and condition 3 has already lapsed at the current
 * family size — this is not a comfortable candidate, so the ceiling is set toward the
 * conservative end of the recovery table's named brackets (20%/30%), well inside
 * `B5-REVERSAL`'s disqualifying -79%/-90% range, rather than at a permissive figure chosen after
 * seeing the result.
 *
 * LOSING STREAKS: `P(k losses in a row) = (1-W)^k` at the REALISED win rate W (win := r>0,
 * matching `backtestMultiTF`'s own convention), reported for k = 5/10/15/20. "Longest expected
 * streak" is defined and pre-registered as the smallest k such that the expected COUNT of
 * k-length loss runs across the observed trade count N is below 1, i.e. the smallest k with
 * `(N-k+1)*(1-W)^k < 1` — beyond this k, a streak of that length is not expected to occur even
 * once in a sample this size. Capital impact `(1-f)^k` reported for both the longest OBSERVED
 * streak (in close-order) and this longest EXPECTED streak, at all three f values.
 *
 * This is a descriptive/economic-gate study: no p-value, no hypothesis test. It does NOT join
 * `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family and does not trigger a BH-FDR
 * recomputation.
 * ================================================================================================
 */
import fs from "fs";
import path from "path";
import { backtestMultiTF } from "../../backtest.js";
import { saveExperiment } from "../../researchlab.mjs";

const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };

const RISK_FRACTIONS = [0.01, 0.02, 0.05];
const PRIMARY_F = 0.02;
const DD_CEILING_PRIMARY = 0.25; // pre-registered, at PRIMARY_F — see pre-registration block above
const STREAK_KS = [5, 10, 15, 20];

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

function loadCached(cacheDir, symbol) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(saved.candles) && saved.candles.length ? saved.candles : null;
}

function splitCandles(candles, fraction) {
  const cut = Number(candles[Math.floor(candles.length * fraction)]?.time);
  return { holdout: candles.filter((c) => +c.time >= cut) };
}

// Reruns ma_dip on cached holdout candles and returns per-trade records with both entry and
// exit calendar time (needed for the concurrent-position-aware curve; `excursions.entryTime`
// gives entry, and the holdout candle at index entryIdx+barsHeld gives exit).
function collectTrades(cacheDir, symbols) {
  const trades = [];
  let skippedNoEntryTime = 0;
  for (const symbol of symbols) {
    const candles = loadCached(cacheDir, symbol);
    if (!candles) { console.error(`MISSING CACHE: ${symbol}`); continue; }
    const { holdout } = splitCandles(candles, SPLIT);
    if (holdout.length < 20) { console.error(`SKIP ${symbol}: holdout too short (${holdout.length})`); continue; }
    const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
    const feeRate = COMMISSION_PER_SHARE / avgClose;
    const series = [{ label: "1d", mins: 1440, candles: holdout }];
    const r = backtestMultiTF({ series }, { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
    for (const exc of r.excursions) {
      if (exc.entryTime == null) { skippedNoEntryTime++; continue; }
      const entryTime = +exc.entryTime;
      const entryIdx = holdout.findIndex((c) => +c.time === entryTime);
      const exitTime = entryIdx >= 0 && holdout[entryIdx + exc.barsHeld]
        ? +holdout[entryIdx + exc.barsHeld].time
        : entryTime + exc.barsHeld * 86400; // fallback only if the exact candle isn't found
      trades.push({ symbol, entryTime, exitTime, barsHeld: exc.barsHeld, r: exc.r });
    }
  }
  return { trades, skippedNoEntryTime };
}

// Close-order curve: trades sorted by exit time, applied sequentially, fixed-fractional f of
// CURRENT equity each step — ignores genuine overlap (wrong whenever positions overlap; kept
// only to show the divergence from the calendar-time curve).
function closeOrderCurve(trades, f) {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let equity = 1;
  const points = [{ time: sorted[0]?.entryTime ?? 0, equity }];
  for (const t of sorted) {
    equity *= 1 + f * t.r;
    points.push({ time: t.exitTime, equity });
  }
  return { points, sorted };
}

// Calendar-time curve: event-driven, size snapshotted at each trade's own entry against
// equity-at-that-moment, P&L realised into equity at that trade's own exit — see pre-
// registration block above for the sizing assumption and its stated limitation. RUIN: once
// simulated equity would go to zero or below (concurrent correlated losses exceeding 100% of
// the entry-time equity snapshot — this model has no margin call, so nothing stops that on its
// own), equity is clamped at 0 and held there for the remainder of the curve — a real account
// cannot keep opening new fixed-fractional positions with zero or negative equity. `ruinAt` (a
// trade index within the sorted-by-time event stream) is reported, null if ruin never occurs.
function calendarCurve(trades, f) {
  const events = [];
  trades.forEach((t, idx) => {
    events.push({ time: t.entryTime, type: "entry", idx });
    events.push({ time: t.exitTime, type: "exit", idx });
  });
  events.sort((a, b) => a.time - b.time || (a.type === "entry" ? -1 : 1));
  let equity = 1;
  let ruinAt = null;
  let exitCount = 0;
  const equityAtEntry = new Array(trades.length);
  const points = [{ time: events[0]?.time ?? 0, equity }];
  for (const ev of events) {
    if (ev.type === "entry") {
      equityAtEntry[ev.idx] = equity;
    } else {
      exitCount++;
      if (equity > 0) {
        const t = trades[ev.idx];
        equity += equityAtEntry[ev.idx] * f * t.r;
        if (equity <= 0 && ruinAt === null) { equity = 0; ruinAt = exitCount; }
      }
      points.push({ time: ev.time, equity });
    }
  }
  return { points, ruinAt };
}

// Additive (non-compounding) R-curve in close-order — for direct R-terms comparability with
// this codebase's existing per-symbol `maxDrawdownR` convention.
function additiveRCurve(trades) {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let cum = 0, peak = 0, maxDD = 0;
  const points = [0];
  for (const t of sorted) {
    cum += t.r;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, cum - peak);
    points.push(cum);
  }
  return { points, maxDrawdownR: maxDD };
}

// Full drawdown-episode distribution from a series of values — every peak-to-trough excursion,
// not just the single deepest one. mode "pct" expresses depth as a fraction of the peak
// (equity curves, where the peak is always > 0 by construction here); mode "abs" expresses
// depth as a raw difference (the additive R-curve, where "peak" can be 0 or near-0 early on,
// so dividing by it is meaningless — this was a real bug caught while building this script: an
// early version applied "pct" mode to the R-curve and produced a nonsense -6147% "drawdown"
// from a peak of ~0.01R; fixed by giving the R-curve its own units).
function drawdownEpisodes(values, mode = "pct") {
  if (!values.length) return [];
  const depth = (trough, peak) => (mode === "pct" ? (peak === 0 ? 0 : (trough - peak) / peak) : trough - peak);
  let peak = values[0], inDD = false, trough = values[0];
  const episodes = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v >= peak) {
      if (inDD) { episodes.push({ depth: depth(trough, peak) }); inDD = false; }
      peak = v; trough = v;
    } else {
      inDD = true;
      trough = Math.min(trough, v);
    }
  }
  if (inDD) episodes.push({ depth: depth(trough, peak), ongoing: true });
  return episodes;
}

function maxDrawdownPct(points) {
  let peak = points[0]?.equity ?? 1, maxDD = 0;
  for (const p of points) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.min(maxDD, peak === 0 ? 0 : (p.equity - peak) / peak);
  }
  return maxDD;
}

function longestLossStreak(sortedTrades) {
  let longest = 0, cur = 0;
  for (const t of sortedTrades) {
    if (t.r <= 0) { cur++; longest = Math.max(longest, cur); } else cur = 0;
  }
  return longest;
}

// Smallest k such that the expected COUNT of k-length loss runs across N trials drops below 1:
// (N-k+1) * (1-W)^k < 1. See pre-registration block above.
function expectedLongestStreak(N, lossProb) {
  for (let k = 1; k <= N; k++) {
    const expectedCount = (N - k + 1) * Math.pow(lossProb, k);
    if (expectedCount < 1) return k;
  }
  return N;
}

function analyzeUniverse(name, spec) {
  const { trades, skippedNoEntryTime } = collectTrades(spec.cacheDir, spec.symbols);
  const N = trades.length;
  const wins = trades.filter((t) => t.r > 0).length;
  const W = N ? wins / N : 0;
  const lossProb = 1 - W;

  const { sorted: closeSorted } = closeOrderCurve(trades, PRIMARY_F);
  const rCurve = additiveRCurve(trades);

  const perF = {};
  for (const f of RISK_FRACTIONS) {
    const cal = calendarCurve(trades, f);
    const clo = closeOrderCurve(trades, f);
    perF[f] = {
      calendarMaxDrawdownPct: maxDrawdownPct(cal.points),
      closeOrderMaxDrawdownPct: maxDrawdownPct(clo.points),
      calendarPoints: cal.points.length,
      ruinAt: cal.ruinAt,
    };
  }
  const primaryCal = calendarCurve(trades, PRIMARY_F);
  const ddEpisodesCalendarPrimary = drawdownEpisodes(primaryCal.points.map((p) => p.equity), "pct");
  const ddEpisodesR = drawdownEpisodes(rCurve.points, "abs");

  const longestObserved = longestLossStreak(closeSorted);
  const longestExpected = expectedLongestStreak(N, lossProb);

  const streakProbTable = STREAK_KS.map((k) => ({ k, probability: Math.pow(lossProb, k) }));
  const capitalImpact = { observed: {}, expected: {} };
  for (const f of RISK_FRACTIONS) {
    capitalImpact.observed[f] = Math.pow(1 - f, longestObserved);
    capitalImpact.expected[f] = Math.pow(1 - f, longestExpected);
  }

  // Recovery = D/(1-D) is only defined for D < 100%; at or beyond total loss there is no
  // multiplicative gain that returns to flat (the capital base is zero or negative), so that
  // is reported as "RUIN" rather than a nonsense number.
  const recovery = (ddFrac) => (Math.abs(ddFrac) >= 1 ? "RUIN (>=100% loss)" : Math.abs(ddFrac) / (1 - Math.abs(ddFrac)));
  const primaryDD = perF[PRIMARY_F].calendarMaxDrawdownPct;
  const ceilingPass = Math.abs(primaryDD) <= DD_CEILING_PRIMARY;

  return {
    universe: name,
    trades: N,
    skippedNoEntryTime,
    winRate: W,
    perF: Object.fromEntries(RISK_FRACTIONS.map((f) => [f, {
      ...perF[f],
      calendarRecoveryNeeded: recovery(perF[f].calendarMaxDrawdownPct),
      closeOrderRecoveryNeeded: recovery(perF[f].closeOrderMaxDrawdownPct),
    }])),
    additiveRCurveMaxDrawdownR: rCurve.maxDrawdownR,
    drawdownEpisodes: {
      calendarPrimaryF: {
        count: ddEpisodesCalendarPrimary.length,
        depthsPct: ddEpisodesCalendarPrimary.map((e) => e.depth),
        maxDepthPct: Math.min(0, ...ddEpisodesCalendarPrimary.map((e) => e.depth), 0),
      },
      additiveR: {
        count: ddEpisodesR.length,
        depthsR: ddEpisodesR.map((e) => e.depth),
      },
    },
    streaks: {
      realisedWinRate: W,
      longestObserved,
      longestExpected,
      probabilityTable: streakProbTable,
      capitalImpact,
    },
    ceiling: {
      primaryF: PRIMARY_F,
      ddCeiling: DD_CEILING_PRIMARY,
      observedPrimaryDD: primaryDD,
      recoveryNeededAtCeiling: recovery(DD_CEILING_PRIMARY),
      recoveryNeededAtObserved: recovery(primaryDD),
      pass: ceilingPass,
    },
  };
}

function main() {
  const results = {};
  for (const [name, spec] of Object.entries(UNIVERSES)) {
    results[name] = analyzeUniverse(name, spec);
  }

  const report = {
    config: CONFIG,
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    riskFractions: RISK_FRACTIONS,
    primaryF: PRIMARY_F,
    ddCeilingPrimary: DD_CEILING_PRIMARY,
    streakKs: STREAK_KS,
    universes: results,
  };

  const saved = saveExperiment("madip-survivability-condition-5", {
    specification: "madip-survivability-condition-5/v1",
    split: SPLIT,
    commissionPerShare: COMMISSION_PER_SHARE,
    slippagePctEquity: SLIPPAGE_PCT_EQUITY,
    riskFractions: RISK_FRACTIONS,
    ddCeilingPrimary: DD_CEILING_PRIMARY,
  }, report);

  console.log(JSON.stringify({ ...report, saved }, null, 2));
}

main();
