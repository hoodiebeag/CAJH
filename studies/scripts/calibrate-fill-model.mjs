/**
 * PWR5-MAKER-FILL-COST-REDUCTION diagnostic (throwaway, read-only). Not part of the app —
 * empirically calibrates cost-model.mjs's touch-based fill model against real 1-minute
 * candles for three liquidity tiers, so the cost scenario matrix isn't guessing at fill
 * probability. Deletable after ROADMAP_ARCHIVE.md's finding is written.
 *
 * Method: at every SAMPLE_STRIDE-th bar in a bounded recent window, place a hypothetical
 * resting limit order at `close * (1 -/+ offset)` (buy below / sell above) and ask
 * simulateLimitFill() whether/when real subsequent bars would have filled it. This is
 * intentionally symmetric (buy and sell probed at every sample point) since maker fill
 * probability is a property of the offset and local volatility, not of trade direction.
 *
 * Each asset uses its own most recent WINDOW_BARS of available history — NOT a shared
 * calendar window. candles/ collection has narrowed to BTC/ETH/SOL only; every other
 * watchlist asset's data froze around 2026-03-27 (confirmed by inspecting each CSV's last
 * row before writing this script). TAO's calibration window is therefore ~4.5 months
 * older than BTC's — a real data-freshness gap in this repo, not a modeling choice. Noted
 * explicitly here and in the report rather than silently treated as equivalent.
 */
import { loadCandles } from "../../data.js";
import { symbolToKrakenId } from "../../researchlib.mjs";
import { simulateLimitFill } from "../cost-model.mjs";

const TIERS = [
  { label: "high-liquidity", symbol: "BTC" },
  { label: "mid-liquidity", symbol: "SOL" },
  { label: "low-liquidity", symbol: "TAO" },
];
const OFFSETS_PCT = [0.0, 0.05, 0.10, 0.20, 0.50]; // % away from the sample bar's close
const WINDOW_BARS = 43_200; // 30 days of 1-minute bars, per asset's own most recent history
const SAMPLE_STRIDE = 15; // sample every 15th bar (~15-minute spacing) to keep runtime bounded
const MAX_WAIT_BARS = 60; // give a resting order up to 60 bars (~1h at 1-min resolution) to fill
const ADVERSE_WINDOW_BARS = 10;

function calibrate(symbol) {
  const pair = symbolToKrakenId(symbol);
  const all = loadCandles(pair, 1);
  if (!all.length) throw new Error(`no candle data for ${symbol} (${pair})`);
  const bars = all.slice(-WINDOW_BARS);
  const from = new Date(bars[0].time * 1000).toISOString().slice(0, 10);
  const to = new Date(bars[bars.length - 1].time * 1000).toISOString().slice(0, 10);

  const results = {};
  for (const offsetPct of OFFSETS_PCT) {
    const stats = { buy: { fills: 0, samples: 0, adverseSum: 0 }, sell: { fills: 0, samples: 0, adverseSum: 0 } };
    for (let i = 0; i + MAX_WAIT_BARS + ADVERSE_WINDOW_BARS < bars.length; i += SAMPLE_STRIDE) {
      const close = Number(bars[i].close);
      const future = bars.slice(i + 1, i + 1 + MAX_WAIT_BARS + ADVERSE_WINDOW_BARS);

      const buyLimit = close * (1 - offsetPct / 100);
      const buyResult = simulateLimitFill({ bars: future, side: "buy", limitPrice: buyLimit, maxWaitBars: MAX_WAIT_BARS, adverseWindowBars: ADVERSE_WINDOW_BARS });
      stats.buy.samples++;
      if (buyResult.filled) { stats.buy.fills++; stats.buy.adverseSum += buyResult.adverseMovePct; }

      const sellLimit = close * (1 + offsetPct / 100);
      const sellResult = simulateLimitFill({ bars: future, side: "sell", limitPrice: sellLimit, maxWaitBars: MAX_WAIT_BARS, adverseWindowBars: ADVERSE_WINDOW_BARS });
      stats.sell.samples++;
      if (sellResult.filled) { stats.sell.fills++; stats.sell.adverseSum += sellResult.adverseMovePct; }
    }
    results[offsetPct] = {
      buyFillRate: stats.buy.fills / stats.buy.samples,
      buyAvgAdverseMovePct: stats.buy.fills ? stats.buy.adverseSum / stats.buy.fills : null,
      sellFillRate: stats.sell.fills / stats.sell.samples,
      sellAvgAdverseMovePct: stats.sell.fills ? stats.sell.adverseSum / stats.sell.fills : null,
      samples: stats.buy.samples,
    };
  }
  return { symbol, pair, windowFrom: from, windowTo: to, barsUsed: bars.length, results };
}

function main() {
  for (const { label, symbol } of TIERS) {
    const calib = calibrate(symbol);
    console.log(`\n=== ${label}: ${symbol} (${calib.pair}) — ${calib.windowFrom} to ${calib.windowTo}, ${calib.barsUsed} bars, ${Object.values(calib.results)[0].samples} samples/offset ===`);
    console.log("offset%  buyFill%  buyAdverse%  sellFill%  sellAdverse%");
    for (const [offset, r] of Object.entries(calib.results)) {
      const fmt = (x) => x === null ? "n/a" : (x * 100).toFixed(3);
      console.log(
        `${offset.padStart(6)}   ${(r.buyFillRate * 100).toFixed(1).padStart(7)}   ${fmt(r.buyAvgAdverseMovePct).padStart(10)}   ` +
        `${(r.sellFillRate * 100).toFixed(1).padStart(8)}   ${fmt(r.sellAvgAdverseMovePct).padStart(11)}`
      );
    }
  }
}

main();
