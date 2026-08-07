/** Research-only tournament over the entry engines already implemented in backtest.js. */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles, saveExperiment } from "./researchlab.mjs";

const families = [
  ["anticipate", "swing anticipation", { entryMode: "anticipate", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["bos", "confirmed swing", { entryMode: "bos", trendGate: true, trendGateMode: "ma", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true }],
  ["support", "support bounce", { entryMode: "support", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["ma_dip", "MA dip", { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rsi", "RSI reversal", { entryMode: "rsi", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["rev", "higher-low reversal", { entryMode: "rev", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["breakout", "20-bar breakout", { entryMode: "breakout", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["trend_pullback", "trend pullback", { entryMode: "trend_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
  ["sweep_reclaim", "liquidity sweep reclaim", { entryMode: "sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["range_sweep_reclaim", "range support sweep reclaim", { entryMode: "range_sweep_reclaim", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true }],
  ["h3", "H3 hypothesis", { entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }],
  ["vol_contraction", "volatility contraction breakout", { entryMode: "vol_contraction", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true }],
];

const normalize = (assets) => assets.map((a) => typeof a === "string" ? { symbol: a, id: symbolToKrakenId(a) } : a);
const average = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function seriesFor(pair) { return [["1h", 60], ["4h", 240], ["1d", 1440]].map(([label, mins]) => ({ label, mins, candles: loadResearchCandles(pair, mins) })); }
function splitSeries(series, fraction, holdout) {
  const cut = Number(series[0].candles[Math.floor(series[0].candles.length * fraction)]?.time);
  return series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) }));
}
function summarize(perAsset) {
  const results = perAsset.flatMap((x) => x.results || []), assets = perAsset.filter((x) => x.trades > 0), avgR = average(results);
  return { trades: results.length, avgR, totalR: results.reduce((a, b) => a + b, 0), winRate: results.length ? results.filter((x) => x > 0).length / results.length : 0, assets: assets.length, positiveAssets: assets.filter((x) => x.avgR > 0).length };
}

/**
 * BTC-above-200d-SMA "as-of" gate, built locally rather than exported from backtest.js
 * (whose maTimeline/makeAsOf are internal) — duplicating this small amount of pure
 * arithmetic here is smaller and safer than widening backtest.js's export surface.
 * Mirrors backtest.js's maTimeline (rolling-sum SMA, i>=period-1 before it's live) and
 * makeAsOf (forward-walking cursor) exactly, so there is no lookahead: timeline point t
 * is each daily candle's CLOSE time, matching every other AsOf timeline in this codebase.
 */
export function buildBtcAboveMa200At(candles, period = 200) {
  const closes = candles.map((c) => parseFloat(c.close));
  const timeline = []; let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    const above = i >= period - 1 ? closes[i] > sum / period : false;
    timeline.push({ t: parseInt(candles[i].time) + 1440 * 60, above });
  }
  let i = 0, v = false;
  return (t) => {
    while (i < timeline.length && timeline[i].t <= t) { v = timeline[i].above; i++; }
    return v;
  };
}

/** Both gate clauses required (AND, not OR) — see TOURNAMENT_ROADMAP.md Track 3. */
export function scoreRegimeGate(holdout, { avgRMin = -0.10, tradesMin = 200 } = {}) {
  const avgRPass = holdout.avgR > avgRMin;
  const tradesPass = holdout.trades >= tradesMin;
  return { avgRMin, tradesMin, avgRPass, tradesPass, passed: avgRPass && tradesPass };
}

/**
 * TOURNAMENT_ROADMAP.md Track 3 (refined scope, 2026-08-06/07): does gating the existing
 * `breakout` family on BTC>200d-SMA salvage it at all? Single-family, single-config
 * experiment — reuses breakout's exact pre-registered config unmodified, adding only
 * entryGate. Does NOT touch `families`/runTournament's 12-row output.
 */
export function runBreakoutRegimeFilter({ watchlist = loadWatchlist(), split = .70 } = {}) {
  const [, , breakoutConfig] = families.find(([id]) => id === "breakout");
  const btcCandles = loadResearchCandles(symbolToKrakenId("BTC"), 1440);

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  // A fresh as-of cursor per backtest call: each call replays its OWN candle series from
  // the start, and buildBtcAboveMa200At's cursor only advances forward (mirrors backtest.js's
  // makeAsOf convention, which is likewise built fresh inside each backtestMultiTF call).
  // Sharing one cursor across assets/train+holdout would break on the very first asset
  // boundary, since each asset's own timeline restarts earlier than where the previous
  // asset's entries left the cursor.
  const score = (part) => summarize(datasets.map((d) =>
    backtestMultiTF({ series: d[part] }, { ...breakoutConfig, entryTf: "1h", entryGate: buildBtcAboveMa200At(btcCandles) })));
  const train = score("train"), holdout = score("holdout");
  const gate = scoreRegimeGate(holdout);

  const input = { specification: "strategy-tournament-regime-filter/v1", split, assets: datasets.map((d) => d.symbol), family: "breakout", filter: "btc-above-200d-sma" };
  const result = {
    family: "breakout", filter: "btc-above-200d-sma", train, holdout, gate,
    verdict: gate.passed
      ? "breakout regime-gated by BTC>200dSMA clears the pre-registered gate (avgR>-0.10 AND trades>=200); extending to anticipate is a separate follow-up, not attempted here"
      : "Track 3 abandoned per the abandonment criteria",
  };
  return { input, result };
}

/**
 * TOURNAMENT_ROADMAP.md Track 1 follow-up (T1B-BREAKOUT-COSTFIX, pre-registered
 * 2026-08-07): `breakout` is the one baseline family with a positive zero-cost holdout
 * edge (+0.045R/trade, 3123 trades) but a negative net-of-cost holdout (-0.445R/trade).
 * Track 1's own experiment text names the fix directly: "a higher R-multiple target
 * and/or less frequent entries" — a fixed ~0.9% round-trip cost eats a smaller share of
 * R when the win target is bigger, and fewer/more-selective entries raise the zero-cost
 * edge those wins are drawn from. This tests BOTH levers together as ONE pre-registered
 * variant (not a parameter sweep — sweeping after seeing holdout results would be
 * tuning-on-the-holdout): `tpR: 3 -> 5` and `breakoutLookback: 20 -> 55`, the classic
 * Donchian breakout window (a standard, externally-motivated choice, not cherry-picked
 * post-hoc). Every other breakout config field (stop model, caps, lockBreakeven) is
 * untouched, and no other family is touched.
 *
 * PRE-REGISTERED GATE (both required, holdout only, net-of-cost from the start):
 * holdout avgR > 0 (a genuine edge, not merely "less negative" — the same avgR>0 bar
 * runTournament's own `promoted` uses) AND holdout trades >= 150 (T5-DECAY-EXIT's
 * sample-floor convention) AND holdout positiveAssets/assets >= 0.5 (runTournament's
 * own promotion bar, for an apples-to-apples comparison with how every other family in
 * this file gets promoted).
 */
export function runBreakoutCostFix({ watchlist = loadWatchlist(), split = .70 } = {}) {
  const [, , breakoutConfig] = families.find(([id]) => id === "breakout");
  const variantConfig = { ...breakoutConfig, tpR: 5, breakoutLookback: 55 };

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const score = (config, part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf: "1h" })));

  const baseline = { train: score(breakoutConfig, "train"), holdout: score(breakoutConfig, "holdout") };
  const variant = { train: score(variantConfig, "train"), holdout: score(variantConfig, "holdout") };

  const avgRPass = variant.holdout.avgR > 0;
  const tradesPass = variant.holdout.trades >= 150;
  const assetsPass = variant.holdout.positiveAssets / Math.max(1, variant.holdout.assets) >= 0.5;
  const gate = { avgRPass, tradesPass, assetsPass, passed: avgRPass && tradesPass && assetsPass };

  const input = {
    specification: "strategy-tournament-breakout-costfix/v1", split, assets: datasets.map((d) => d.symbol),
    family: "breakout", variant: { tpR: variantConfig.tpR, breakoutLookback: variantConfig.breakoutLookback },
  };
  const result = {
    family: "breakout", baseline, variant, gate,
    verdict: gate.passed
      ? "breakout cost-reduction variant (tpR=5, breakoutLookback=55) clears the pre-registered gate (holdout avgR>0 AND trades>=150 AND positiveAssets/assets>=0.5)"
      : "T1B-BREAKOUT-COSTFIX FAIL: cost-reduction variant does not clear the pre-registered gate",
  };
  return { input, result };
}

/**
 * T5-DECAY-EXIT (TOURNAMENT_ROADMAP.md, pre-registered 2026-08-07): does forcing a
 * time-based exit rescue `breakout` (the one baseline family with a positive zero-cost
 * edge, Track 1) from grinding an open position toward its downside stop? Reuses
 * backtest.js's existing `maxHold` option rather than adding a duplicate mechanism —
 * `maxHold` already forces a market exit at that bar's close the first time neither the
 * stop nor the target has fired within `maxHold` bars of entry (backtest.js:513), which
 * is exactly the requested decay-exit semantics, and is already a true no-op when
 * omitted (default MAX_HOLD=100, same no-op pattern as `stopMode`/`atrStopK`/
 * `breakoutLookback`). This variant sets it to 24 bars (1h timeframe, per the
 * pre-registered spec); every other breakout config field, and every other family, is
 * untouched.
 *
 * PRE-REGISTERED GATE (both required, holdout only, net-of-cost from the start):
 * holdout avgR/trade > -0.30 AND holdout trades >= 150.
 */
export function runBreakoutDecayExit({ watchlist = loadWatchlist(), split = .70 } = {}) {
  const [, , breakoutConfig] = families.find(([id]) => id === "breakout");
  const variantConfig = { ...breakoutConfig, maxHold: 24 };

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const score = (config, part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf: "1h" })));

  const baseline = { train: score(breakoutConfig, "train"), holdout: score(breakoutConfig, "holdout") };
  const variant = { train: score(variantConfig, "train"), holdout: score(variantConfig, "holdout") };

  const avgRPass = variant.holdout.avgR > -0.30;
  const tradesPass = variant.holdout.trades >= 150;
  const gate = { avgRPass, tradesPass, passed: avgRPass && tradesPass };

  const input = {
    specification: "strategy-tournament-breakout-decayexit/v1", split, assets: datasets.map((d) => d.symbol),
    family: "breakout", variant: { maxHold: variantConfig.maxHold },
  };
  const result = {
    family: "breakout", baseline, variant, gate,
    verdict: gate.passed
      ? "breakout decay-exit variant (maxHold=24) clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150)"
      : "T5-DECAY-EXIT FAIL: decay-exit variant does not clear the pre-registered gate",
  };
  return { input, result };
}

/** Chronological 70/30 test. Parameters are fixed before examining the holdout. */
export function runTournament({ watchlist = loadWatchlist(), split = .70, feeRate, slipPct } = {}) {
  const costOverride = {};
  if (feeRate !== undefined) costOverride.feeRate = feeRate;
  if (slipPct !== undefined) costOverride.slipPct = slipPct;
  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const rows = families.map(([id, label, config]) => {
    const score = (part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, ...costOverride, entryTf: "1h" })));
    const train = score("train"), holdout = score("holdout");
    const promoted = train.trades >= 50 && holdout.trades >= 25 && train.avgR > 0 && holdout.avgR > 0 && holdout.positiveAssets / Math.max(1, holdout.assets) >= .5;
    return { id, label, config, train, holdout, promoted, robustness: Math.min(train.avgR, holdout.avgR) * Math.log1p(holdout.trades) };
  }).sort((a, b) => b.robustness - a.robustness);
  const input = { specification: "strategy-tournament/v1", split, assets: datasets.map((d) => d.symbol), candidates: families.map(([id]) => id) };
  const result = { rows, verdict: rows.some((r) => r.promoted) ? "paper-trading candidates exist; no live promotion" : "no candidate cleared the pre-registered research gate" };
  return { input, result };
}

if (process.argv[1]?.endsWith("tournament.mjs")) {
  if (process.argv.includes("--regime-filter")) {
    const report = runBreakoutRegimeFilter();
    const saved = saveExperiment("tournament-regime-filter", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--breakout-costfix")) {
    const report = runBreakoutCostFix();
    const saved = saveExperiment("tournament-breakout-costfix", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--decay-exit")) {
    const report = runBreakoutDecayExit();
    const saved = saveExperiment("tournament-decay-exit", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else {
    const zeroCost = process.argv.includes("--zero-cost");
    const report = zeroCost ? runTournament({ feeRate: 0, slipPct: 0 }) : runTournament();
    const saved = saveExperiment(zeroCost ? "tournament-zero-cost" : "tournament", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  }
}
