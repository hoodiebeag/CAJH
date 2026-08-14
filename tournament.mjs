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

/**
 * T6-TIMEFRAME-ISOLATION (TOURNAMENT_ROADMAP.md Addendum "Roadmap v2 reviewed and
 * rejected as duplicative", staged in .agent_state.json's blackboard.roadmap_v2_review):
 * `runTournament` hardcoded `entryTf: "1h"` for every family — no family, including
 * `anticipate`/`bos`, had ever actually been tested on 1d. This is a narrow, honestly
 * labeled REPLICATION of those two families (the ones closest to the reviewed-and-
 * rejected "Roadmap v2" swing-low mechanism) on 1d only: net-of-cost from the start (no
 * gross-first phase), full watchlist, the existing R/trade-sign gate, proper holdout-n
 * floor. Each family's exact pre-registered config is reused unmodified except entryTf —
 * no other family, and no other config field, is touched.
 *
 * PRE-REGISTERED GATE (both required, holdout only, scored PER FAMILY, same convention
 * as every other gate in this file): holdout avgR/trade > 0 AND holdout trades >= 150.
 */
export function runTimeframeIsolation({ watchlist = loadWatchlist(), split = .70, entryTf = "1d" } = {}) {
  const targets = ["anticipate", "bos"];
  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));

  const results = targets.map((id) => {
    const [, , config] = families.find(([fid]) => fid === id);
    const score = (part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf })));
    const train = score("train"), holdout = score("holdout");
    const avgRPass = holdout.avgR > 0;
    const tradesPass = holdout.trades >= 150;
    return { family: id, train, holdout, gate: { avgRPass, tradesPass, passed: avgRPass && tradesPass } };
  });

  const input = { specification: "strategy-tournament-timeframe-isolation/v1", split, entryTf, assets: datasets.map((d) => d.symbol), families: targets };
  const passedFamilies = results.filter((r) => r.gate.passed).map((r) => r.family);
  const result = {
    entryTf, families: results,
    verdict: passedFamilies.length === 0
      ? "1d replication does not change the verdict: anticipate/bos remain killed on both tested timeframes, closing the swing-low/pivot-reclaim signal family"
      : `1d changes the verdict for: ${passedFamilies.join(", ")} — clears the pre-registered gate (holdout avgR>0 AND trades>=150)`,
  };
  return { input, result };
}

/**
 * TRAIL-STOP-EXIT (100-strategy triage #100, pre-registered 2026-08-08): does a dynamic
 * trailing take-profit — track the peak price since entry, exit once price pulls back a
 * fixed percentage from that peak, hold indefinitely otherwise — beat the fixed-TP
 * baseline on `breakout` (the one baseline family with a positive zero-cost edge, Track
 * 1)? Distinct information source from T5-DECAY-EXIT (a bar-count timeout, already
 * tested: FAIL) — this is a trailing-drawdown exit, not a time-based one. Reuses
 * backtest.js's `trailingTpPct` option (true no-op when omitted, same pattern as
 * `stopMode`/`atrStopK`/`maxHold`), applied to `breakout` only — no other family or
 * config field touched. Two pre-registered trailing percentages, decided before any run:
 * 5% and 10%.
 *
 * PRE-REGISTERED GATE (both required, holdout only, net-of-cost from the start, scored
 * PER VARIANT): holdout avgR/trade > -0.30 (same bar T5-DECAY-EXIT used, for direct
 * comparability) AND holdout trades >= 150.
 */
export function runBreakoutTrailingTpExit({ watchlist = loadWatchlist(), split = .70 } = {}) {
  const [, , breakoutConfig] = families.find(([id]) => id === "breakout");
  const pcts = [0.05, 0.10];

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const score = (config, part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf: "1h" })));

  const baseline = { train: score(breakoutConfig, "train"), holdout: score(breakoutConfig, "holdout") };
  const variants = pcts.map((pct) => {
    const config = { ...breakoutConfig, trailingTpPct: pct };
    const train = score(config, "train"), holdout = score(config, "holdout");
    const avgRPass = holdout.avgR > -0.30;
    const tradesPass = holdout.trades >= 150;
    return { trailingTpPct: pct, train, holdout, gate: { avgRPass, tradesPass, passed: avgRPass && tradesPass } };
  });

  const input = {
    specification: "strategy-tournament-breakout-trailingtp/v1", split, assets: datasets.map((d) => d.symbol),
    family: "breakout", variants: variants.map((v) => ({ trailingTpPct: v.trailingTpPct })),
  };
  const passed = variants.filter((v) => v.gate.passed).map((v) => v.trailingTpPct);
  const result = {
    family: "breakout", baseline, variants,
    verdict: passed.length
      ? `breakout trailing-TP variant(s) ${passed.join(", ")} clear the pre-registered gate (holdout avgR>-0.30 AND trades>=150)`
      : "TRAIL-STOP-EXIT FAIL: neither trailing-TP variant clears the pre-registered gate",
  };
  return { input, result };
}

/**
 * TEST-TREND-GATE-FILTER (ground-up audit finding, pre-registered): strategy.js exports a
 * fully-implemented, currently-unused per-asset trend-quality gate (TREND_GATE, mode "ma" or
 * "structure") explicitly marked research-only — the live scanner does not import it, and per
 * an exhaustive search of TOURNAMENT_ROADMAP.md/ROADMAP.md/VERDICTS.md it has never been
 * tested. Distinct from the already-tested T3-REGIMEFILTER: T3 gated only `breakout` on BTC's
 * own 200d SMA as one market-wide regime signal; TREND_GATE filters ANY family on each asset's
 * OWN trend state (either "ma" = 4h close above its TREND_MA-period average, or "structure" =
 * 4h making higher highs AND higher lows), so it can pass entries T3 never touched and reject
 * entries T3 never saw. Applied here to the two most-tested, best-understood baselines
 * (anticipate, breakout), both modes, four combinations total — no other family or config
 * field touched.
 *
 * PRE-REGISTERED GATE (both required, holdout only, net-of-cost from the start, scored PER
 * COMBINATION, same bar as T5-DECAY-EXIT/TRAIL-STOP-EXIT for direct comparability): holdout
 * avgR/trade > -0.30 AND holdout trades >= 150. This filter is expected to cut trade count
 * substantially (it excludes any asset not currently trending) — a below-150-trades result is
 * a legitimate, honest non-verdict to record, not something to route around.
 */
export function runTrendGateFilter({ watchlist = loadWatchlist(), split = .70 } = {}) {
  const targets = ["anticipate", "breakout"];
  const modes = ["ma", "structure"];
  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));

  const combinations = targets.flatMap((id) => {
    const [, , baseConfig] = families.find(([fid]) => fid === id);
    return modes.map((trendGateMode) => {
      const config = { ...baseConfig, trendGate: true, trendGateMode };
      const score = (part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf: "1h" })));
      const train = score("train"), holdout = score("holdout");
      const avgRPass = holdout.avgR > -0.30;
      const tradesPass = holdout.trades >= 150;
      return { family: id, trendGateMode, train, holdout, gate: { avgRPass, tradesPass, passed: avgRPass && tradesPass } };
    });
  });

  const input = {
    specification: "strategy-tournament-trend-gate-filter/v1", split, assets: datasets.map((d) => d.symbol),
    families: targets, modes,
  };
  const passed = combinations.filter((c) => c.gate.passed).map((c) => `${c.family}/${c.trendGateMode}`);
  const result = {
    combinations,
    verdict: passed.length
      ? `TREND_GATE clears the pre-registered gate for: ${passed.join(", ")} (holdout avgR>-0.30 AND trades>=150)`
      : "TEST-TREND-GATE-FILTER FAIL: no family/mode combination clears the pre-registered gate (holdout avgR>-0.30 AND trades>=150)",
  };
  return { input, result };
}

/**
 * TEST1-FIB-PULLBACK (pre-registered, human-authored research plan queued 2026-08-13):
 * after "bos" mode's own confirmed break-of-structure event (a swing low's close breaking
 * back above its own high — this codebase's existing definition of a confirmed BOS, per
 * `lowAt`/`pivE` in backtest.js), rest a limit order at a Fibonacci retracement (50% and
 * 61.8%, tested SEPARATELY — two independent variants below, not combined) of the leg that
 * produced it (the originating swing low through the highest high reached by the confirming
 * bar), stop below the originating low, TP at 3R. Implemented as backtest.js's new
 * "fib_pullback" entryMode (see its inline comment there for the exact no-look-ahead
 * mechanics) — no separate detection primitive; it replays the identical confirmed-pivot
 * sequence "bos" already validates. `breakoutEntry`'s own N-bar-high trigger has no defined
 * "swing leg" (no low endpoint) so it cannot supply the retracement this hypothesis needs;
 * "breakout" is used here only as the stop-size-cap template (minStopPct/maxStopPct below),
 * the same apples-to-apples convention TOURNAMENT_ROADMAP.md Track 2 used for
 * `vol_contraction`. `lockBreakeven` is deliberately OFF — the pre-registered spec is a
 * fixed stop/TP structure ("stop below the originating swing low; TP at 3R"), not a managed
 * exit; adding one would not be testing the hypothesis as specified.
 *
 * Split: a FIXED CALENDAR DATE (2025-06-01), not the usual 70/30 fraction, per the
 * pre-registered spec — train = earliest available candles to 2025-06-01, holdout =
 * 2025-06-01 to present. Full watchlist, entryTf "1h" with the standard 1h/4h/1d series
 * stack (matches every other family's series convention in this file).
 *
 * PRE-REGISTERED GATE (immutable once the test begins, evaluated SEPARATELY per level):
 *  - Train gate MUST pass before holdout is examined at all: train avgR/trade > -0.50 AND
 *    train trades >= 200.
 *  - Holdout gate (only reached if train passes): ALL three required — holdout avgR/trade
 *    > -0.30, holdout trades >= 150, holdout positiveAssets/assets >= 0.40.
 *  - Abandon (do not tune) if holdout avgR/trade <= -0.30 for both levels, or both levels
 *    produce fewer than 150 holdout trades.
 */
export function runFibPullback({ watchlist = loadWatchlist(), cutoffSec = Math.floor(Date.UTC(2025, 5, 1) / 1000) } = {}) {
  const baseConfig = { entryMode: "fib_pullback", trendGate: false, alignMode: "none", minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: false };
  const levels = [0.5, 0.618];

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250));
  const splitAt = (series, holdout) => series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => holdout ? +c.time >= cutoffSec : +c.time < cutoffSec) }));
  const scored = datasets.map((d) => ({ symbol: d.symbol, train: splitAt(d.series, false), holdout: splitAt(d.series, true) }));

  const variants = levels.map((fibLevel) => {
    const config = { ...baseConfig, fibLevel };
    const score = (part) => summarize(scored.map((d) => backtestMultiTF({ series: d[part] }, { ...config, entryTf: "1h" })));
    const train = score("train");
    const trainGate = { avgRMin: -0.50, tradesMin: 200, avgRPass: train.avgR > -0.50, tradesPass: train.trades >= 200 };
    trainGate.passed = trainGate.avgRPass && trainGate.tradesPass;
    if (!trainGate.passed) {
      return { fibLevel, train, trainGate, holdout: null, holdoutGate: null, verdict: "TRAIN-GATE-FAIL: holdout not examined (pre-registered gate is immutable once the test begins)" };
    }
    const holdout = score("holdout");
    const holdoutGate = {
      avgRMin: -0.30, tradesMin: 150, positiveFracMin: 0.40,
      avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 150,
      positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
    };
    holdoutGate.passed = holdoutGate.avgRPass && holdoutGate.tradesPass && holdoutGate.positiveFracPass;
    return {
      fibLevel, train, trainGate, holdout, holdoutGate,
      verdict: holdoutGate.passed
        ? `fib_pullback ${fibLevel} clears the pre-registered holdout gate; paper trading only`
        : `fib_pullback ${fibLevel} FAIL: holdout did not clear the pre-registered gate`,
    };
  });

  const input = { specification: "fib-pullback/v1", cutoffSec, assets: datasets.map((d) => d.symbol), levels };
  const passed = variants.filter((v) => v.holdoutGate?.passed).map((v) => v.fibLevel);
  const result = {
    variants,
    verdict: passed.length
      ? `FIB-PULLBACK clears the pre-registered gate for level(s): ${passed.join(", ")}`
      : "TEST1-FIB-PULLBACK: no retracement level clears the pre-registered gate",
  };
  return { input, result };
}

/**
 * Per-asset "relative volume as of this bar's close" timeline: relVol at bar i is
 * volume[i] divided by the mean volume of the PRIOR `lookback` bars (i.e. bars
 * [i-lookback, i-1] — i itself is excluded from its own average). Mirrors backtest.js's
 * own `maTimeline` rolling-sum technique and `breakoutEntry`'s no-look-ahead convention
 * (its N-bar-high lookback likewise excludes the trigger bar itself). null before the
 * `lookback`-bar warmup.
 */
export function relVolTimeline(candles, intervalMin, lookback = 20) {
  const vols = candles.map((c) => parseFloat(c.volume) || 0);
  const tl = []; let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const priorAvg = i >= lookback ? sum / lookback : null;
    const relVol = priorAvg ? vols[i] / priorAvg : null;
    tl.push({ t: parseInt(candles[i].time) + intervalMin * 60, relVol });
    sum += vols[i];
    if (i >= lookback) sum -= vols[i - lookback];
  }
  return tl;
}

/** Forward-walking "relVol >= threshold as of time t" cursor — a fresh one per call, same convention as buildBtcAboveMa200At/fundingAsOf. */
export function makeRelVolAboveAt(timeline, thresholdMultiple) {
  let i = 0, v = null;
  return (t) => {
    while (i < timeline.length && timeline[i].t <= t) { v = timeline[i].relVol; i++; }
    return Number.isFinite(v) && v >= thresholdMultiple;
  };
}

/**
 * TEST2-VOL-CONFIRMED-BREAKOUT (pre-registered, human-authored, queued alongside
 * TEST1/TEST3/TEST4 with no inter-dependencies). Hypothesis: gating `breakout` entries
 * on relative volume at the entry bar (entry-bar volume / prior-20-bar average volume,
 * see `relVolTimeline`) filters adverse selection. Implemented purely via backtest.js's
 * existing `entryGate` hook (no backtest.js changes) — same technique as
 * funding-meanrev.mjs / buildBtcAboveMa200At. `breakout`'s exact tournament.mjs baseline
 * config is reused unmodified, matching every other breakout-family verdict in
 * VERDICTS.md.
 *
 * Split: FIXED CALENDAR DATE (2025-06-01), matching TEST1/TEST3/TEST4's convention —
 * train = earliest available to 2025-06-01, holdout = 2025-06-01 to present. Volume is
 * already inside every OHLCV candle (no external data source), so no data-availability
 * gate is needed.
 *
 * PROCESS (pre-registered, immutable once begun — this is the actual anti-look-ahead
 * discipline the task text calls out): compute TRAIN results for all three thresholds
 * (1.5, 2.0, 3.0) first. Only thresholds whose train gate passes (avgR/trade > -0.50 AND
 * trades >= 200) are eligible; the BEST eligible threshold is the one with the highest
 * train avgR/trade (this project's standard train-side ranking metric — see
 * runTournament's avgR-anchored `robustness`). That ONE threshold's holdout is then
 * examined EXACTLY ONCE. The other two thresholds' holdout is never computed — peeking
 * at their holdout after a winner is already picked would be the exact look-ahead this
 * item's own task text forbids. If no threshold passes the train gate, holdout is not
 * examined for any of them.
 *
 * PRE-REGISTERED HOLDOUT GATE (selected threshold only): avgR/trade > -0.30 AND trades
 * >= 150 AND positiveAssets/assets >= 0.40 (same three-clause gate as TEST1/TEST3).
 */
export function runVolConfirmedBreakout({ watchlist = loadWatchlist(), cutoffSec = Math.floor(Date.UTC(2025, 5, 1) / 1000), lookback = 20 } = {}) {
  const [, , breakoutConfig] = families.find(([id]) => id === "breakout");
  const thresholds = [1.5, 2.0, 3.0];

  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({
      symbol: d.symbol,
      entryCandles: d.series.find((tf) => tf.label === "1h").candles,
      train: d.series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time < cutoffSec) })),
      holdout: d.series.map((tf) => ({ ...tf, candles: tf.candles.filter((c) => +c.time >= cutoffSec) })),
    }));

  // A fresh entryGate cursor per (dataset, call) — built from the FULL (unsplit) 1h
  // candles so relVol at any bar always sees only its own true history, then filtered
  // to the requested part by backtestMultiTF's own candle set (same fresh-cursor
  // convention as runBreakoutRegimeFilter's buildBtcAboveMa200At usage above).
  const scoreThreshold = (threshold, part) => summarize(datasets.map((d) => {
    const entryGate = makeRelVolAboveAt(relVolTimeline(d.entryCandles, 60, lookback), threshold);
    return backtestMultiTF({ series: d[part] }, { ...breakoutConfig, entryTf: "1h", entryGate });
  }));

  const trainByThreshold = thresholds.map((threshold) => {
    const train = scoreThreshold(threshold, "train");
    const trainGate = { avgRMin: -0.50, tradesMin: 200, avgRPass: train.avgR > -0.50, tradesPass: train.trades >= 200 };
    trainGate.passed = trainGate.avgRPass && trainGate.tradesPass;
    return { threshold, train, trainGate };
  });

  const candidates = trainByThreshold.filter((t) => t.trainGate.passed);
  const best = candidates.length ? candidates.reduce((a, b) => (b.train.avgR > a.train.avgR ? b : a)) : null;

  const variants = trainByThreshold.map((t) => {
    if (!best || t.threshold !== best.threshold) {
      return {
        ...t, holdout: null, holdoutGate: null,
        verdict: t.trainGate.passed
          ? `VOL-CONFIRM ${t.threshold}: train gate passed but not selected as best on train (avgR ${t.train.avgR.toFixed(4)} < selected ${best.train.avgR.toFixed(4)}); holdout not examined (only the best-on-train threshold's holdout is ever evaluated)`
          : "TRAIN-GATE-FAIL: holdout not examined (pre-registered gate is immutable once the test begins)",
      };
    }
    const holdout = scoreThreshold(t.threshold, "holdout");
    const holdoutGate = {
      avgRMin: -0.30, tradesMin: 150, positiveFracMin: 0.40,
      avgRPass: holdout.avgR > -0.30, tradesPass: holdout.trades >= 150,
      positiveFracPass: holdout.positiveAssets / Math.max(1, holdout.assets) >= 0.40,
    };
    holdoutGate.passed = holdoutGate.avgRPass && holdoutGate.tradesPass && holdoutGate.positiveFracPass;
    return {
      ...t, holdout, holdoutGate,
      verdict: holdoutGate.passed
        ? `VOL-CONFIRM ${t.threshold} (selected on train) clears the pre-registered holdout gate; paper trading only`
        : `VOL-CONFIRM ${t.threshold} (selected on train) FAIL: holdout did not clear the pre-registered gate`,
    };
  });

  const input = { specification: "vol-confirmed-breakout/v1", cutoffSec, lookback, assets: datasets.map((d) => d.symbol), thresholds, selected: best?.threshold ?? null };
  const selectedVariant = best ? variants.find((v) => v.threshold === best.threshold) : null;
  const result = {
    variants,
    verdict: !best
      ? "TEST2-VOL-CONFIRMED-BREAKOUT: no threshold clears the train gate; holdout not examined for any threshold"
      : selectedVariant.holdoutGate.passed
        ? `VOL-CONFIRMED-BREAKOUT clears the pre-registered gate at threshold ${best.threshold}`
        : `TEST2-VOL-CONFIRMED-BREAKOUT: threshold ${best.threshold} (selected on train) does not clear the pre-registered holdout gate`,
  };
  return { input, result };
}

/** Chronological 70/30 test. Parameters are fixed before examining the holdout. */
export function runTournament({ watchlist = loadWatchlist(), split = .70, feeRate, slipPct, entryTf = "1h" } = {}) {
  const costOverride = {};
  if (feeRate !== undefined) costOverride.feeRate = feeRate;
  if (slipPct !== undefined) costOverride.slipPct = slipPct;
  const datasets = normalize(watchlist).map((asset) => ({ symbol: asset.symbol, series: seriesFor(asset.id) }))
    .filter((d) => d.series.every((tf) => tf.candles.length >= 250))
    .map((d) => ({ symbol: d.symbol, train: splitSeries(d.series, split, false), holdout: splitSeries(d.series, split, true) }));
  const rows = families.map(([id, label, config]) => {
    const score = (part) => summarize(datasets.map((d) => backtestMultiTF({ series: d[part] }, { ...config, ...costOverride, entryTf })));
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
  } else if (process.argv.includes("--timeframe-isolation")) {
    const report = runTimeframeIsolation();
    const saved = saveExperiment("tournament-timeframe-isolation", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--trailing-tp-exit")) {
    const report = runBreakoutTrailingTpExit();
    const saved = saveExperiment("tournament-trailing-tp-exit", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--trend-gate-filter")) {
    const report = runTrendGateFilter();
    const saved = saveExperiment("tournament-trend-gate-filter", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--fib-pullback")) {
    const report = runFibPullback();
    // Saved as two separately labeled decision-journal entries (FIB-PULLBACK-50 /
    // FIB-PULLBACK-618, per the pre-registered task text), not one combined entry —
    // each variant is a fully independent backtest run with its own gate outcome.
    const saved = report.result.variants.map((v) =>
      saveExperiment(`fib-pullback-${v.fibLevel === 0.5 ? "50" : "618"}`, { ...report.input, fibLevel: v.fibLevel }, v));
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else if (process.argv.includes("--vol-confirmed-breakout")) {
    const report = runVolConfirmedBreakout();
    // Saved as three separately labeled decision-journal entries (VOL-CONFIRM-1.5/2.0/
    // 3.0, per the pre-registered task text), preserving all three thresholds' results
    // regardless of which one (if any) had its holdout examined.
    const saved = report.result.variants.map((v) =>
      saveExperiment(`vol-confirm-${v.threshold.toFixed(1).replace(".", "")}`, { ...report.input, threshold: v.threshold }, v));
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  } else {
    const zeroCost = process.argv.includes("--zero-cost");
    const report = zeroCost ? runTournament({ feeRate: 0, slipPct: 0 }) : runTournament();
    const saved = saveExperiment(zeroCost ? "tournament-zero-cost" : "tournament", report.input, report.result);
    console.log(JSON.stringify({ ...report.result, saved }, null, 2));
  }
}
