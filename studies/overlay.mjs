/**
 * overlay.mjs — The trend filter as a defensive overlay on buy & hold.
 *
 * Not a trade strategy: a position rule. Hold the coin while its daily close is above
 * its own moving average; sit in cash when it is not. The signal is evaluated on the
 * close of day t and acted on at the OPEN of day t+1 (no look-ahead), and every switch
 * pays a one-way cost, so whipsaw is charged for rather than assumed away.
 *
 * Reported per regime, because the whole claim is regime-dependent: an overlay should
 * give up some upside in a bull market and avoid most of the damage in a bear one. The
 * number that matters is not return alone but return per unit of drawdown.
 *
 * Run: node overlay.mjs
 */
import "dotenv/config";
import { loadCandles } from "../data.js";
import { loadWatchlist, symbolToKrakenId, ts } from "../researchlib.mjs";

const syms = loadWatchlist();
const COST = 0.0045;   // one side: 0.40% taker + 0.05% slippage

const WINDOWS = [
  ["2023 (bull)",    ts("2023-01-01"), ts("2024-01-01")],
  ["2024 (bull)",    ts("2024-01-01"), ts("2025-01-01")],
  ["2025-26 (bear)", ts("2025-01-01"), ts("2027-01-01")],
  ["ALL",            0,                ts("2027-01-01")],
];

/**
 * Walk one pair's daily bars. `maPeriod === null` is buy & hold. While invested the
 * position earns close-to-close; a switch decided on bar i's close is executed at bar
 * i+1's open and charged COST. `confirmDays` requires the signal to persist that many
 * consecutive closes before flipping, which is the cheapest anti-whipsaw knob there is.
 */
function run(bars, maPeriod, confirmDays = 1) {
  const C = bars.map(b => +b.close), O = bars.map(b => +b.open);
  let eq = 1, invested = maPeriod == null, switches = 0, below = 0, above = 0;
  let pending = null;                     // position to adopt at the next open
  const curve = [];

  for (let i = 0; i < C.length; i++) {
    // Execute yesterday's decision at today's open, then earn today's open→close.
    if (i > 0) {
      if (invested) eq *= O[i] / C[i - 1];              // overnight gap, still held
      if (pending !== null && pending !== invested) {
        eq *= (1 - COST); switches++; invested = pending;
      }
      pending = null;
      if (invested) eq *= C[i] / O[i];                  // intraday, held
    }

    // Decide on this close for tomorrow's open.
    if (maPeriod != null && i >= maPeriod - 1) {
      let s = 0; for (let j = i - maPeriod + 1; j <= i; j++) s += C[j];
      const ma = s / maPeriod;
      if (C[i] > ma) { above++; below = 0; } else { below++; above = 0; }
      pending = above >= confirmDays ? true : below >= confirmDays ? false : invested;
    }
    curve.push(eq);
  }

  let peak = 0, mdd = 0;
  for (const v of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  return { ret: (curve.at(-1) ?? 1) - 1, mdd, switches };
}

const data = syms.map(s => ({ sym: s, bars: loadCandles(symbolToKrakenId(s), 1440).slice(0, -1) }))
                 .filter(d => d.bars.length > 120);

const VARIANTS = [["buy & hold", null, 1], ["MA20 overlay", 20, 1], ["MA20, 2-day confirm", 20, 2],
                  ["MA50 overlay", 50, 1], ["MA100 overlay", 100, 1]];

console.log(`\n=== Trend filter as a defensive overlay — ${data.length} pairs, daily ===`);
console.log(`Signal on close, filled next open. Each switch costs ${(COST * 100).toFixed(2)}% one way.\n`);

for (const [label, from, to] of WINDOWS) {
  // Per-pair buy & hold first, so "beats B&H" compares the same pair, not an index.
  const bh = new Map();
  for (const d of data) {
    const bars = d.bars.filter(b => { const t = +b.time; return t >= from && t < to; });
    if (bars.length >= 120) bh.set(d.sym, run(bars, null));
  }
  if (!bh.size) continue;

  console.log(`--- ${label} (${bh.size} pairs) ---`);
  console.log("  rule                   avg return   avg maxDD   ret/DD   switches   beats B&H");
  for (const [name, ma, conf] of VARIANTS) {
    const rets = [], mdds = [], sw = []; let beat = 0;
    for (const d of data) {
      if (!bh.has(d.sym)) continue;
      const bars = d.bars.filter(b => { const t = +b.time; return t >= from && t < to; });
      const r = run(bars, ma, conf);
      rets.push(r.ret); mdds.push(r.mdd); sw.push(r.switches);
      if (ma != null && r.ret > bh.get(d.sym).ret) beat++;
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const aR = avg(rets), aD = avg(mdds);
    console.log(`  ${name.padEnd(22)} ${((aR >= 0 ? "+" : "") + (aR * 100).toFixed(0) + "%").padStart(8)}    ` +
      `${((aD * 100).toFixed(0) + "%").padStart(7)}   ${(aD ? aR / Math.abs(aD) : 0).toFixed(2).padStart(6)}   ` +
      `${avg(sw).toFixed(0).padStart(6)}   ${ma == null ? "     —" : `${beat}/${rets.length}`.padStart(6)}`);
  }
  console.log("");
}
