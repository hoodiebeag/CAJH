/**
 * flowsignal.mjs — Does order flow predict anything?
 *
 * The one signal class this project has never been able to test: who was the aggressor.
 * Every price-derived trigger tried so far has come back indistinguishable from random,
 * and the reason may simply be that OHLC bars do not contain the information. Trade-level
 * data does contain more — buy vs sell volume, trade count, the largest single print.
 *
 * Features, all computable from the store's 1-minute bars and all no-look-ahead:
 *   imbalance   (buyVol−sellVol)/(buyVol+sellVol) over the bar
 *   cumImb      the same, accumulated over the last N bars
 *   intensity   trade count vs its own recent average (is this bar busy?)
 *   bigPrint    largest single trade as a share of the bar's volume (is size present?)
 *
 * Tested as prediction, not as a strategy: the information coefficient (Spearman
 * correlation between the feature and the FORWARD return) at several horizons, with a
 * shuffled null for comparison, plus the top/bottom decile forward returns so the size
 * of any effect can be compared against the ~0.9% round-trip cost. A signal that cannot
 * clear that number is not tradeable however real it is.
 *
 * Run: node flowsignal.mjs [SYM...]
 */
import "dotenv/config";
import { loadBars } from "./data.js";
import { symbolToKrakenId } from "./storage.js";

const args = process.argv.slice(2);
const POOL = args.includes("--pool");
const syms = args.filter(a => a !== "--pool").length ? args.filter(a => a !== "--pool") : ["BTC", "ETH", "SOL"];
const COST_PCT = 0.9;               // round-trip taker + slippage, in percent
const TFS = [15, 60, 240];          // decision bar sizes, minutes
const HORIZONS = [1, 4, 12];        // forward bars to measure

/** Roll 1-minute bars up to `mins`, carrying the order-flow columns. */
function resample(bars, mins) {
  const span = mins * 60, out = new Map();
  for (const b of bars) {
    const t = Math.floor(b.time / span) * span;
    let c = out.get(t);
    if (!c) { c = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0, buyVol: 0, sellVol: 0, trades: 0, maxTrade: 0 }; out.set(t, c); }
    c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close;
    c.volume += b.volume; c.buyVol += b.buyVol; c.sellVol += b.sellVol;
    c.trades += b.trades; c.maxTrade = Math.max(c.maxTrade, b.maxTrade);
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

/** Spearman rank correlation — robust to the fat tails these features all have. */
function spearman(x, y) {
  const n = x.length; if (n < 30) return null;
  const rank = (v) => {
    const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {           // average ranks within ties
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// Pooled mode: same feature/horizon cells, but (x, forward-return) pairs are pooled
// across ALL symbols before computing IC. A single pair's 4h series is a few hundred
// bars with heavy horizon overlap (adjacent samples share most of their window) — that
// is a thin, easily-noisy sample. Pooling multiplies the sample without changing what's
// being measured (features/returns are already normalized, so raw pooling is valid).
const pooled = new Map();   // "feature|tf|horizon" -> { xs:[], ys:[] }
const pushPooled = (fname, tf, h, xs, ys) => {
  if (!POOL) return;
  const key = `${fname}|${tf}|${h}`;
  const bucket = pooled.get(key) ?? pooled.set(key, { xs: [], ys: [] }).get(key);
  bucket.xs.push(...xs); bucket.ys.push(...ys);
};

for (const sym of syms) {
  const id = symbolToKrakenId(sym);
  const all = loadBars(id).filter(b => b.buyVol > 0 || b.sellVol > 0);   // flow-bearing bars only
  if (all.length < 5000) { console.log(`\n${sym}: only ${all.length} bars carry order flow — skipping.`); continue; }
  const from = new Date(all[0].time * 1000).toISOString().slice(0, 10);
  const to = new Date(all.at(-1).time * 1000).toISOString().slice(0, 10);
  console.log(`\n=== ${sym} — ${all.length} flow-bearing 1m bars (${from} → ${to}) ===`);

  for (const tf of TFS) {
    const bars = resample(all, tf);
    if (bars.length < 500) continue;
    const C = bars.map(b => b.close);

    // Features at bar i use only bars ≤ i; the target is strictly forward.
    const imb = bars.map(b => { const v = b.buyVol + b.sellVol; return v > 0 ? (b.buyVol - b.sellVol) / v : 0; });
    const cumImb = imb.map((_, i) => i < 5 ? null : mean(imb.slice(i - 5, i + 1)));
    const intensity = bars.map((b, i) => {
      if (i < 20) return null;
      const avg = mean(bars.slice(i - 20, i).map(x => x.trades));
      return avg > 0 ? b.trades / avg : null;
    });
    const bigPrint = bars.map(b => b.volume > 0 ? b.maxTrade / b.volume : null);

    const FEATURES = [["imbalance", imb], ["cum imbalance(6)", cumImb], ["trade intensity", intensity], ["big-print share", bigPrint]];
    if (!POOL) {
      console.log(`\n  ${tf}m bars (${bars.length})`);
      console.log(`    feature            horizon   IC(real)   IC(shuffled)   top-decile fwd   bottom-decile   spread vs ${COST_PCT}% cost`);
    }

    for (const [fname, fvals] of FEATURES) {
      for (const h of HORIZONS) {
        const xs = [], ys = [];
        for (let i = 0; i + h < bars.length; i++) {
          if (fvals[i] == null || !isFinite(fvals[i])) continue;
          xs.push(fvals[i]);
          ys.push((C[i + h] - C[i]) / C[i] * 100);       // forward return, percent
        }
        if (xs.length < 200) continue;
        pushPooled(fname, tf, h, xs, ys);
        if (POOL) continue;   // pooled mode reports only the combined result, below

        const ic = spearman(xs, ys);
        const icNull = spearman(xs, shuffle(ys));
        // Decile spread: the tradeable size of the effect, before any costs.
        const order = xs.map((v, i) => [v, ys[i]]).sort((a, b) => a[0] - b[0]);
        const d = Math.max(1, Math.floor(order.length / 10));
        const bot = mean(order.slice(0, d).map(o => o[1]));
        const top = mean(order.slice(-d).map(o => o[1]));
        const spread = top - bot;
        const verdict = spread > COST_PCT ? "CLEARS" : `${(spread / COST_PCT * 100).toFixed(0)}% of cost`;
        console.log(`    ${fname.padEnd(18)} ${String(h * tf + "m").padStart(6)}   ` +
          `${(ic >= 0 ? "+" : "") + ic.toFixed(4)}    ${(icNull >= 0 ? "+" : "") + icNull.toFixed(4)}      ` +
          `${(top >= 0 ? "+" : "") + top.toFixed(3)}%          ${(bot >= 0 ? "+" : "") + bot.toFixed(3)}%      ` +
          `${spread.toFixed(3)}% → ${verdict}`);
      }
    }
  }
}

if (POOL) {
  console.log(`\n=== Pooled across ${syms.join("/")} — same feature/horizon cells, samples combined ===\n`);
  console.log("feature              tf   horizon   n        IC(real)   IC(shuffled)   spread      vs cost");
  // Group by tf for readability, in the same tf/feature/horizon order as TFS/HORIZONS.
  for (const tf of TFS) {
    for (const [fname] of [["imbalance"], ["cum imbalance(6)"], ["trade intensity"], ["big-print share"]]) {
      for (const h of HORIZONS) {
        const bucket = pooled.get(`${fname}|${tf}|${h}`);
        if (!bucket || bucket.xs.length < 500) continue;
        const { xs, ys } = bucket;
        const ic = spearman(xs, ys);
        const icNull = spearman(xs, shuffle(ys));
        const order = xs.map((v, i) => [v, ys[i]]).sort((a, b) => a[0] - b[0]);
        const d = Math.max(1, Math.floor(order.length / 10));
        const bot = mean(order.slice(0, d).map(o => o[1])), top = mean(order.slice(-d).map(o => o[1]));
        const spread = top - bot;
        const verdict = spread > COST_PCT ? "CLEARS" : `${(spread / COST_PCT * 100).toFixed(0)}% of cost`;
        console.log(`${fname.padEnd(20)} ${String(tf + "m").padStart(4)}   ${String(h * tf + "m").padStart(6)}   ` +
          `${String(xs.length).padStart(6)}   ${(ic >= 0 ? "+" : "") + ic.toFixed(4)}    ${(icNull >= 0 ? "+" : "") + icNull.toFixed(4)}      ` +
          `${(spread >= 0 ? "+" : "") + spread.toFixed(3)}%   ${verdict}`);
      }
    }
  }
}

console.log(`\nIC is the Spearman correlation between the feature and the forward return. The shuffled column is`);
console.log(`the same computation on scrambled targets — anything the real IC does not clearly exceed is noise.`);
console.log(`The decile spread is what a perfect long/short on that feature would capture BEFORE the ~${COST_PCT}% round trip.\n`);
