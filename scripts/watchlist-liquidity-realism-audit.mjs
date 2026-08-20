/**
 * WATCHLIST-LIQUIDITY-REALISM-AUDIT (read-only diagnostic, not part of the app). Every
 * backtest this project has run assumes the full watchlist is uniformly tradeable at
 * `strategy.js`'s flat SLIPPAGE_PCT (0.05%/side, market-fill taker assumption). This checks
 * that assumption per-asset against Kraken Futures' own real "slippage" analytics feed
 * (derivatives.mjs, `ANALYTICS_TYPES` includes "slippage"/"liquidity" — live public data, not
 * modeled), for the exact 29-asset universe `researchlib.mjs`'s loadWatchlist() falls back to
 * (WATCHLIST env unset, config.json watchlist empty → symbolsFromCandleStore(), i.e. every
 * asset any backtest in this project has actually run against).
 *
 * Method. Kraken's per-symbol `slippage` analytics type returns, per bid/ask side, the
 * average execution price an order of a given USD notional (`slippage_1k`/`_10k`/`_100k`/
 * `_1m`) would receive — not a %, an absolute price. `slippage_1k` (the smallest bucket) is
 * used as a touch-price proxy: mid_t = (bid.slippage_1k_t + ask.slippage_1k_t) / 2. Per-side
 * slippage at size S is then (ask.slippage_S_t - mid_t)/mid_t for buys and
 * (mid_t - bid.slippage_S_t)/mid_t for sells, averaged across both sides and across every
 * daily point in a 60-day trailing window. This captures the full per-side cost a market
 * order actually pays (spread + size impact) — the same thing SLIPPAGE_PCT is meant to proxy
 * for — not just incremental walk-the-book impact past an arbitrary reference.
 *
 * Size assumption, stated explicitly rather than fabricated. Exact live account equity isn't
 * in this repo (RISK_PCT=0.5% of free cash/trade, MAX_POSITION_PCT cap — strategy.js — but no
 * absolute dollar figure). $1k notional is used as the primary, conservative proxy: it's
 * Kraken's smallest published bucket, and a 0.5%-risk personal account would need >$1k*stopFrac
 * of equity to size a single trade at $1k notional in the first place, which is already a
 * larger account than this project's framing (a single-Discord-user personal bot) suggests.
 * $10k is reported alongside for sensitivity, not as the primary comparison.
 *
 * `liquidity` analytics (bid/ask depth within 0.05%-10% of mid, in the API's own units) is
 * reported per-asset as supporting context for *why* a thin asset's slippage is high — not
 * converted to a dollar figure (no documented unit definition to convert from) and not used
 * in the flag threshold itself, which is the direct %-slippage comparison above.
 *
 * Not a new alpha hypothesis and not a pass/fail gate on any existing verdict — every
 * price-structure family already failed regardless of this question (COST-SENSITIVITY-SURFACE
 * et al.). This is due diligence for if/when a future signal passes: so the watchlist itself
 * isn't why a backtested edge looks better on paper than it would live.
 */
import { loadWatchlist, symbolToKrakenId } from "../researchlib.mjs";
import { fetchAnalytics } from "../derivatives.mjs";
import { SLIPPAGE_PCT } from "../strategy.js";
import { saveExperiment } from "../researchlab.mjs";

const WINDOW_DAYS = 60;
const INTERVAL = 86400; // daily
const FLAG_MULTIPLE = 2; // "materially differs" threshold vs SLIPPAGE_PCT, per work_queue item

const now = Math.floor(Date.now() / 1000);
const since = now - WINDOW_DAYS * 86400;

function perSideSlipPct(points, sizeKey) {
  const samples = [];
  for (const { value } of points) {
    const bid = value?.bid, ask = value?.ask;
    const bid1k = Number(bid?.slippage_1k), ask1k = Number(ask?.slippage_1k);
    const bidS = Number(bid?.[sizeKey]), askS = Number(ask?.[sizeKey]);
    if (![bid1k, ask1k, bidS, askS].every(Number.isFinite)) continue;
    const mid = (bid1k + ask1k) / 2;
    if (!(mid > 0)) continue;
    const buySide = (askS - mid) / mid;
    const sellSide = (mid - bidS) / mid;
    samples.push((buySide + sellSide) / 2);
  }
  if (!samples.length) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function avgLiquidity01(points) {
  const samples = [];
  for (const { value } of points) {
    const bid = Number(value?.bid?.liquidity_01), ask = Number(value?.ask?.liquidity_01);
    if (Number.isFinite(bid) && Number.isFinite(ask)) samples.push(bid + ask);
  }
  if (!samples.length) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

const watchlist = loadWatchlist();
const rows = [];

for (const sym of watchlist) {
  const krakenId = symbolToKrakenId(sym); // e.g. BTC -> XBTUSD
  const futuresSymbol = `PF_${krakenId}`;
  try {
    const [slip, liq] = await Promise.all([
      fetchAnalytics({ symbol: futuresSymbol, type: "slippage", since, to: now, interval: INTERVAL }),
      fetchAnalytics({ symbol: futuresSymbol, type: "liquidity", since, to: now, interval: INTERVAL }),
    ]);
    const slip1kPct = perSideSlipPct(slip.normalized.points, "slippage_1k");
    const slip10kPct = perSideSlipPct(slip.normalized.points, "slippage_10k");
    const liquidity01Avg = avgLiquidity01(liq.normalized.points);
    const ratio1k = slip1kPct != null ? slip1kPct / SLIPPAGE_PCT : null;
    rows.push({
      symbol: sym, futuresSymbol, status: "ok",
      samplePoints: slip.normalized.points.length,
      slip1kPct, slip10kPct, liquidity01Avg,
      ratioVsAssumption1k: ratio1k,
      flaggedMaterial: ratio1k != null ? ratio1k >= FLAG_MULTIPLE : null,
    });
  } catch (err) {
    rows.push({ symbol: sym, futuresSymbol, status: "error", error: err.message });
  }
}

const ok = rows.filter((r) => r.status === "ok" && r.slip1kPct != null);
const flagged = ok.filter((r) => r.flaggedMaterial);
const failed = rows.filter((r) => r.status !== "ok" || r.slip1kPct == null);

const report = {
  windowDays: WINDOW_DAYS, interval: INTERVAL, since, to: now,
  assumptionSlippagePct: SLIPPAGE_PCT, flagMultiple: FLAG_MULTIPLE,
  assetsTotal: watchlist.length, assetsOk: ok.length, assetsFailed: failed.length,
  flaggedCount: flagged.length,
  flaggedSymbols: flagged.map((r) => r.symbol),
  failedSymbols: failed.map((r) => ({ symbol: r.symbol, reason: r.error || "no slippage samples" })),
  rows: rows.sort((a, b) => (b.ratioVsAssumption1k || 0) - (a.ratioVsAssumption1k || 0)),
};

const saved = saveExperiment("watchlist-liquidity-realism-audit", { universe: watchlist, parameters: { windowDays: WINDOW_DAYS, interval: INTERVAL, flagMultiple: FLAG_MULTIPLE } }, report);
console.log(JSON.stringify({ ...report, saved }, null, 2));
