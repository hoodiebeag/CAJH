/** H11: pre-registered funding <= 0.01% gate on the least-negative anticipate family. */
import { backtestMultiTF } from "./backtest.js";
import { loadWatchlist, symbolToKrakenId } from "./researchlib.mjs";
import { loadResearchCandles } from "./researchlab.mjs";
import { fetchBinanceFunding, fundingAsOf, toBinancePerp } from "./fundinglib.mjs";

const cfg = { entryMode: "anticipate", entryTf: "1h", trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven: true, feeRate: .0013, slipPct: 0 };
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const normalize = (xs) => xs.map((x) => typeof x === "string" ? { symbol: x, id: symbolToKrakenId(x) } : x);
const series = (id) => [["1h",60],["4h",240],["1d",1440]].map(([label,mins]) => ({ label, mins, candles: loadResearchCandles(id, mins) }));
const split = (s, fraction, holdout) => { const cut = Number(s[0].candles[Math.floor(s[0].candles.length * fraction)]?.time); return s.map((t) => ({ ...t, candles: t.candles.filter((c) => holdout ? +c.time >= cut : +c.time < cut) })); };
const score = (rows, key) => { const results = rows.flatMap((r) => r[key].results); const active = rows.filter((r) => r[key].trades); return { trades: results.length, avgR: mean(results), winRate: results.filter((x) => x > 0).length / Math.max(1, results.length), assets: active.length, positiveAssets: active.filter((r) => r[key].avgR > 0).length }; };

export async function runFundingGateH11({ watchlist = loadWatchlist(), splitFraction = .70, threshold = .0001, minHistoryDays = 730, refresh = false } = {}) {
  const assets = [];
  for (const asset of normalize(watchlist)) {
    try {
      const s = series(asset.id); if (!s.every((t) => t.candles.length >= 250)) continue;
      const start = Number(s[0].candles[0].time) * 1000, end = Number(s[0].candles.at(-1).time) * 1000;
      const funding = await fetchBinanceFunding(toBinancePerp(asset.symbol), { startTime: start, endTime: end, refresh });
      if (!funding.points.length || funding.points.at(-1).time - funding.points[0].time < minHistoryDays * 86400_000) continue;
      const asOf = fundingAsOf(funding.points);
      const run = (part) => backtestMultiTF({ series: part }, { ...cfg, entryGate: (t) => {
        const rate = asOf(t); return Number.isFinite(rate) && rate <= threshold;
      } });
      assets.push({ symbol: asset.symbol, train: run(split(s, splitFraction, false)), holdout: run(split(s, splitFraction, true)) });
    } catch { /* Unsupported/incomplete symbols are excluded and reported by coverage. */ }
  }
  const train = score(assets, "train"), holdout = score(assets, "holdout");
  const promoted = train.trades >= 200 && holdout.trades >= 80 && train.avgR > 0 && holdout.avgR > 0 && holdout.positiveAssets / Math.max(1, holdout.assets) >= .5;
  return { input: { specification: "funding-gate-h11/v1", threshold, splitFraction, minHistoryDays, eligibleAssets: assets.map((a) => a.symbol), config: cfg }, result: { train, holdout, perAsset: assets.map(({ symbol, train, holdout }) => ({ symbol, train: { trades: train.trades, avgR: train.avgR }, holdout: { trades: holdout.trades, avgR: holdout.avgR } })), promoted, verdict: promoted ? "H11 passed historical gate; paper trading only" : "H11 did not clear the pre-registered historical gate" } };
}
