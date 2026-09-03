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
 * correlation between the feature and the FORWARD return), judged against a
 * BLOCK-PERMUTATION null (not a single shuffle — see below), with Benjamini-Hochberg
 * FDR control across every feature/timeframe/horizon cell tested, plus the top/bottom
 * decile forward-return spread so the size of any effect can be compared against the
 * ~0.9% round-trip cost. A signal that cannot clear that number is not tradeable however
 * statistically real it is.
 *
 * WHY BLOCK PERMUTATION, NOT A SINGLE SHUFFLE:
 * Forward return at horizon h is computed at every bar, so consecutive samples share
 * h-1 of their h forward bars — heavy overlap that inflates the apparent sample size and
 * therefore apparent significance, exactly like the day-block problem discover.js already
 * corrects for. A single random shuffle destroys that structure entirely and is barely
 * better than no null at all: it doesn't ask "how often does noise WITH THIS MUCH
 * OVERLAP produce an IC this large", it asks "how often does i.i.d. noise" — a much,
 * much easier bar to clear. Shuffling the (already-computed) ranks of y in contiguous
 * blocks of size h keeps the null's short-range dependence matched to the alternative's,
 * so a p-value from it means what a p-value is supposed to mean.
 *
 * WHY BH-FDR: this script tests up to 4 features × 3 timeframes × 3 horizons = 36 cells
 * per run. An uncorrected "IC clearly beats one shuffled draw" bar will produce a couple
 * of false "hits" out of 36 purely by chance — which is exactly what an earlier run of
 * this script (before this rewrite) reported and should NOT have been trusted.
 *
 * Run: node flowsignal.mjs [SYM...] [--pool]
 */
import "dotenv/config";
import { loadBars } from "../data.js";
import { symbolToKrakenId } from "../storage.js";

const args = process.argv.slice(2);
const POOL = args.includes("--pool");
const syms = args.filter(a => a !== "--pool").length ? args.filter(a => a !== "--pool") : ["BTC", "ETH", "SOL"];
const COST_PCT = 0.9;               // round-trip taker + slippage, in percent
const TFS = [15, 60, 240];          // decision bar sizes, minutes
const HORIZONS = [1, 4, 12];        // forward bars to measure
const PERM_K = 300;                 // block-permutation draws per cell
const FDR_Q = 0.05;                 // Benjamini-Hochberg false-discovery rate

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

/** Average rank (ties split evenly) — Spearman IC is Pearson correlation of these. */
function rankOf(v) {
  const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(rx, ry) {
  const n = rx.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/** Spearman rank correlation — robust to the fat tails these features all have. */
function spearman(x, y) {
  if (x.length < 30) return null;
  return pearson(rankOf(x), rankOf(y));
}

/**
 * Shuffle in contiguous blocks of `blockSize` rather than element-wise. Permuting a rank
 * vector in blocks is exactly equivalent to block-permuting the underlying values and
 * re-ranking (rank is a fixed function of each value's position in the sorted order, so
 * moving data points around — without changing the value multiset — just relabels which
 * index holds which rank; ties are handled identically either way). This lets the
 * permutation test reuse one rank() call instead of re-sorting on every draw.
 */
function blockShuffle(arr, blockSize) {
  const blocks = [];
  for (let i = 0; i < arr.length; i += blockSize) blocks.push(arr.slice(i, i + blockSize));
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}

/**
 * Block-permutation test: real IC vs PERM_K null draws where y's RANKS are block-shuffled
 * in chunks of `blockSize` (≈ the horizon in bars — the source of the overlap-driven
 * autocorrelation). Two-sided: counts |null| >= |real|. Returns { ic, p }.
 */
function blockPermTest(xs, ys, blockSize, K = PERM_K) {
  const rx = rankOf(xs), ryReal = rankOf(ys);
  const real = pearson(rx, ryReal);
  if (real == null) return { ic: null, p: 1 };
  let ge = 0;
  for (let k = 0; k < K; k++) {
    const s = pearson(rx, blockShuffle(ryReal, blockSize));
    if (s != null && Math.abs(s) >= Math.abs(real)) ge++;
  }
  return { ic: real, p: (ge + 1) / (K + 1) };
}

/** Benjamini-Hochberg: returns the set of rows (by reference) surviving at level q. */
function bhSurvivors(rows, q = FDR_Q) {
  const byP = [...rows].sort((a, b) => a.p - b.p);
  const m = byP.length;
  let cutoff = 0;
  for (let i = 0; i < m; i++) if (byP[i].p <= ((i + 1) / m) * q) cutoff = byP[i].p;
  return new Set(rows.filter(r => r.p <= cutoff));
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

/** Top/bottom decile forward-return spread — the tradeable size of the effect, pre-cost. */
function decileSpread(xs, ys) {
  const order = xs.map((v, i) => [v, ys[i]]).sort((a, b) => a[0] - b[0]);
  const d = Math.max(1, Math.floor(order.length / 10));
  const bot = mean(order.slice(0, d).map(o => o[1]));
  const top = mean(order.slice(-d).map(o => o[1]));
  return top - bot;
}

const FEATURE_NAMES = ["imbalance", "cum imbalance(6)", "trade intensity", "big-print share"];

function featuresFor(bars) {
  const imb = bars.map(b => { const v = b.buyVol + b.sellVol; return v > 0 ? (b.buyVol - b.sellVol) / v : 0; });
  const cumImb = imb.map((_, i) => i < 5 ? null : mean(imb.slice(i - 5, i + 1)));
  const intensity = bars.map((b, i) => {
    if (i < 20) return null;
    const avg = mean(bars.slice(i - 20, i).map(x => x.trades));
    return avg > 0 ? b.trades / avg : null;
  });
  const bigPrint = bars.map(b => b.volume > 0 ? b.maxTrade / b.volume : null);
  return [imb, cumImb, intensity, bigPrint];
}

// Pass 1: build (feature, tf, horizon) → (xs, ys) pairs, per symbol AND pooled across
// symbols. Features at bar i use only bars ≤ i; the target is strictly forward.
const perSymbolCells = [];        // { sym, fname, tf, h, xs, ys }
const pooledCells = new Map();    // "fname|tf|h" -> { xs, ys }

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
    const featureArrays = featuresFor(bars);

    for (let fi = 0; fi < FEATURE_NAMES.length; fi++) {
      const fname = FEATURE_NAMES[fi], fvals = featureArrays[fi];
      for (const h of HORIZONS) {
        const xs = [], ys = [];
        for (let i = 0; i + h < bars.length; i++) {
          if (fvals[i] == null || !isFinite(fvals[i])) continue;
          xs.push(fvals[i]);
          ys.push((C[i + h] - C[i]) / C[i] * 100);       // forward return, percent
        }
        if (xs.length < 200) continue;
        perSymbolCells.push({ sym, fname, tf, h, xs, ys });
        const key = `${fname}|${tf}|${h}`;
        const bucket = pooledCells.get(key) ?? pooledCells.set(key, { xs: [], ys: [] }).get(key);
        bucket.xs.push(...xs); bucket.ys.push(...ys);
      }
    }
  }
}

// Pass 2: score cells (block-permutation p-value + decile spread), apply BH-FDR across
// everything reported in this run, and print. --pool reports the pooled cells only;
// the default reports per-symbol cells (FDR applied across ALL of them together, not
// per-symbol, since that is still one shared multiple-testing budget).
if (POOL) {
  const rows = [];
  for (const tf of TFS) {
    for (const fname of FEATURE_NAMES) {
      for (const h of HORIZONS) {
        const bucket = pooledCells.get(`${fname}|${tf}|${h}`);
        if (!bucket || bucket.xs.length < 500) continue;
        const { ic, p } = blockPermTest(bucket.xs, bucket.ys, h);
        const spread = decileSpread(bucket.xs, bucket.ys);
        rows.push({ fname, tf, h, n: bucket.xs.length, ic, p, spread });
      }
    }
  }
  const survivors = bhSurvivors(rows);
  console.log(`\n=== Pooled across ${syms.join("/")} — block-permutation null (K=${PERM_K}) + BH-FDR (q=${FDR_Q}) ===\n`);
  console.log("feature              tf   horizon   n        IC       p        spread      verdict");
  for (const r of rows) {
    const survives = survivors.has(r);
    const clears = r.spread > COST_PCT;
    const verdict = survives && clears ? "SURVIVES FDR + CLEARS COST"
      : survives ? "survives FDR, below cost"
      : clears ? "clears cost, not significant"
      : "—";
    console.log(`${r.fname.padEnd(20)} ${String(r.tf + "m").padStart(4)}   ${String(r.h * r.tf + "m").padStart(6)}   ` +
      `${String(r.n).padStart(6)}   ${(r.ic >= 0 ? "+" : "") + r.ic.toFixed(4)}   p=${r.p.toFixed(3)}   ` +
      `${(r.spread >= 0 ? "+" : "") + r.spread.toFixed(3)}%   ${verdict}`);
  }
  const hits = rows.filter(r => survivors.has(r) && r.spread > COST_PCT);
  console.log(`\n${rows.length} cells tested. ${hits.length} survive BH-FDR (q=${FDR_Q}) AND clear the ${COST_PCT}% round-trip cost.`);
  console.log(hits.length
    ? "That is a real signal by this project's own bar — still one pooled window on two symbols; validate on held-out data and a third symbol before trusting it."
    : "Nothing survives proper correction. Any 'CLEARS' seen from an uncorrected single-shuffle test on this same data was very likely noise — exactly what an uncorrected 36-cell scan produces by chance.");
} else {
  const rows = perSymbolCells.map(c => {
    const { ic, p } = blockPermTest(c.xs, c.ys, c.h);
    const spread = decileSpread(c.xs, c.ys);
    return { ...c, ic, p, spread, n: c.xs.length };
  });
  const survivors = bhSurvivors(rows);
  let lastSym = null;
  for (const r of rows) {
    if (r.sym !== lastSym) { console.log(`\n  --- ${r.sym} (block-permutation K=${PERM_K}) ---`); lastSym = r.sym; }
    const survives = survivors.has(r);
    const clears = r.spread > COST_PCT;
    const verdict = survives && clears ? "SURVIVES FDR + CLEARS COST" : survives ? "survives FDR" : clears ? "clears cost, not sig." : "—";
    console.log(`    ${r.fname.padEnd(18)} ${String(r.tf + "m").padStart(4)}/${String(r.h * r.tf + "m").padStart(5)}   ` +
      `n=${String(r.n).padStart(6)}   IC ${(r.ic >= 0 ? "+" : "") + r.ic.toFixed(4)}   p=${r.p.toFixed(3)}   ` +
      `spread ${(r.spread >= 0 ? "+" : "") + r.spread.toFixed(3)}%   ${verdict}`);
  }
  const hits = rows.filter(r => survivors.has(r) && r.spread > COST_PCT);
  console.log(`\n${rows.length} cells tested across ${syms.length} symbol(s) (one shared FDR budget). ` +
    `${hits.length} survive BH-FDR (q=${FDR_Q}) AND clear cost. Run with --pool to combine symbols for more power.`);
}

console.log(`\nIC is the Spearman correlation between the feature and the forward return. p is a block-`);
console.log(`permutation p-value (null preserves the horizon's autocorrelation, unlike a plain shuffle).`);
console.log(`The decile spread is what a perfect long/short on that feature would capture BEFORE the ~${COST_PCT}% round trip.\n`);
