/**
 * backtest.js — Simulate the strategy on historical candles (mirrors live rules).
 *
 * Entries TRIGGER on a 15m break-of-structure swing low (confirmed when price closes
 * back above the pivot candle's high), taken only when the 1h AND 4h trend bias are
 * bullish at that moment. Exits mirror live: stop, single take-profit (full position),
 * TP, and the optional swing-high take-profit. Results are in "R" (multiples of the
 * per-trade risk), independent of position size.
 *
 * Caveats (read before trusting any number):
 *   • Fills are assumed exactly at the stop / target price (no slippage or fees).
 *   • If a candle touches BOTH stop and target, the stop is assumed to hit first.
 *   • Only as much history as Kraken returns (~720 candles). Small samples mislead.
 *   • Past performance does not predict future results.
 */

import {
  SWING_WINDOW, TP_R, REQUIRE_HIGHER_LOW, MAX_STOP_PCT, MIN_STOP_PCT,
  EXIT_ON_SWING_HIGH, CHOP_FILTER, LOCK_BREAKEVEN, BE_TRIGGER_R, BE_LOCK_R, FEE_BUFFER_PCT, FEE_RATE,
  TREND_GATE, TREND_GATE_MODE, TREND_MA, detectSwings
} from "./strategy.js";

const MAX_HOLD = 100; // close a trade after this many candles if neither stop nor target hits

/**
 * Timeline of [{ t, trending }] — was the timeframe making higher highs AND higher
 * lows as of each candle's close? Mirrors the live chop filter.
 */
function trendTimeline(candles, intervalMin, n) {
  const pivots = detectSwings(candles, n);
  const timeline = [];
  let pi = 0; const lows = [], highs = [];
  for (let i = 0; i < candles.length; i++) {
    while (pi < pivots.length && pivots[pi].confirmIndex <= i) {
      (pivots[pi].type === "low" ? lows : highs).push(pivots[pi].price); pi++;
    }
    const trending = lows.length >= 2 && highs.length >= 2 &&
      lows[lows.length - 1] > lows[lows.length - 2] &&
      highs[highs.length - 1] > highs[highs.length - 2];
    timeline.push({ t: parseInt(candles[i].time) + intervalMin * 60, trending });
  }
  return timeline;
}

function trendingAsOf(timeline, t) {
  let v = false;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) v = timeline[i].trending; else break;
  }
  return v;
}

/** Timeline of [{ t, above }] — was each close above its `period` SMA at that candle? */
function maTimeline(candles, intervalMin, period) {
  const closes = candles.map(c => parseFloat(c.close));
  const tl = []; let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    const above = i >= period - 1 ? closes[i] > sum / period : false;
    tl.push({ t: parseInt(candles[i].time) + intervalMin * 60, above });
  }
  return tl;
}

function aboveAsOf(timeline, t) {
  let v = false;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) v = timeline[i].above; else break;
  }
  return v;
}

/**
 * Timeline of [{ t: candleCloseTimeSec, bias }] for a timeframe, so we can ask
 * "what was this timeframe's bias as of time t?" Bias flips at each pivot's CONFIRM
 * candle (break of structure), matching how the live bot sees it.
 */
function biasTimeline(candles, intervalMin, n) {
  const pivots = detectSwings(candles, n); // chronological by confirmIndex
  const timeline = [];
  let pi = 0, lastType = null;
  for (let i = 0; i < candles.length; i++) {
    while (pi < pivots.length && pivots[pi].confirmIndex <= i) { lastType = pivots[pi].type; pi++; }
    timeline.push({ t: parseInt(candles[i].time) + intervalMin * 60, bias: lastType });
  }
  return timeline;
}

function biasAsOf(timeline, t) {
  let bias = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].t <= t) bias = timeline[i].bias; else break;
  }
  return bias === "low" ? "bull" : bias === "high" ? "bear" : null;
}

export function backtestMultiTF({ candles15, candles1h, candles4h }, {
  n = SWING_WINDOW, tpR = TP_R,
  requireHigherLow = REQUIRE_HIGHER_LOW, maxStopPct = MAX_STOP_PCT, minStopPct = MIN_STOP_PCT,
  exitOnSwingHigh = EXIT_ON_SWING_HIGH, chopFilter = CHOP_FILTER,
  lockBreakeven = LOCK_BREAKEVEN, beTriggerR = BE_TRIGGER_R, beLockR = BE_LOCK_R, feeBufferPct = FEE_BUFFER_PCT,
  feeRate = FEE_RATE,
  trendGate = TREND_GATE, trendMa = TREND_MA, trendGateMode = TREND_GATE_MODE,
  entryTf = "15m", alignMode = "all", minRoomR = 0, entryMode = "bos"
} = {}) {
  if (!candles15?.length || !candles1h?.length || !candles4h?.length) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
  }

  // Pick the entry timeframe; everything ABOVE it becomes the bias filter, and the
  // highest available TF anchors the chop/MA gate. entryTf="15m" reproduces the original.
  const TFS = [
    { tf: "15m", candles: candles15, mins: 15  },
    { tf: "1h",  candles: candles1h, mins: 60  },
    { tf: "4h",  candles: candles4h, mins: 240 },
  ];
  const ei = TFS.findIndex(t => t.tf === entryTf);
  if (ei < 0 || !TFS[ei].candles?.length) {
    return { trades: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, results: [] };
  }
  const entryCandles = TFS[ei].candles;
  const entryMins    = TFS[ei].mins;
  const higher       = TFS.slice(ei + 1).filter(t => t.candles?.length);   // bias-filter TFs
  const trendSrc     = higher.length ? higher[higher.length - 1] : TFS[ei]; // chop/MA anchor

  const H = entryCandles.map(c => parseFloat(c.high));
  const L = entryCandles.map(c => parseFloat(c.low));
  const C = entryCandles.map(c => parseFloat(c.close));
  const T = entryCandles.map(c => parseInt(c.time));

  const pivE = detectSwings(entryCandles, n);
  const lowAt  = new Map();             // confirmIndex → low pivot (entry trigger)
  const highAt = new Set();             // confirmIndex of high pivots (swing-high exit)
  for (const p of pivE) {
    if (p.type === "low") lowAt.set(p.confirmIndex, p);
    else                  highAt.add(p.confirmIndex);
  }

  const biasTLs = higher.map(t => biasTimeline(t.candles, t.mins, n));
  const trendTL = trendTimeline(trendSrc.candles, trendSrc.mins, n);
  const maTL    = maTimeline(trendSrc.candles, trendSrc.mins, trendMa);

  // Overhead resistance: confirmed swing highs on the chop/MA anchor TF (4h for a
  // 15m/1h entry). Used by minRoomR to require clear air above entry before the target.
  const resHighs = detectSwings(trendSrc.candles, n)
    .filter(p => p.type === "high")
    .map(p => ({ t: parseInt(trendSrc.candles[p.confirmIndex].time) + trendSrc.mins * 60, price: p.price }));
  const nearestResAbove = (entry, t) => {
    let best = Infinity;
    for (const r of resHighs) if (r.t <= t && r.price > entry && r.price < best) best = r.price;
    return best;   // Infinity when nothing is overhead = unlimited room
  };

  // Entry-TF swing lows/highs as support/resistance levels (each usable only once confirmed).
  const swingLows  = pivE.filter(p => p.type === "low" ).map(p => ({ ci: p.confirmIndex, price: p.price }));
  const swingHighs = pivE.filter(p => p.type === "high").map(p => ({ ci: p.confirmIndex, price: p.price }));

  // ── support mode ── buy a dip into a prior swing low that closes back above it (bounce
  // off support), tight structural stop below it, ambitious target at the next swing high.
  const supportEntry = (k) => {
    const tol = 0.004;            // within 0.4% counts as a touch
    let support = null;
    for (const s of swingLows) {
      if (s.ci < k && L[k] <= s.price * (1 + tol) && L[k] >= s.price * (1 - 0.02)) {
        if (support == null || Math.abs(L[k] - s.price) < Math.abs(L[k] - support)) support = s.price;
      }
    }
    if (support == null || C[k] <= support) return null;   // must close back above support
    const entry = C[k];
    const stop  = Math.min(L[k], support) - 0.001 * entry; // tight, just below the level
    if (entry <= stop) return null;
    let target = Infinity;                                  // ambitious: next swing high above
    for (const h of swingHighs) if (h.ci < k && h.price > entry && h.price < target) target = h.price;
    if (!isFinite(target)) target = entry + tpR * (entry - stop);
    return { entry, stop, tp: target };
  };

  // ── ma_dip mode ── buy when price closes a set % below its own moving average
  // (oversold vs. its mean), tight stop under the dip, ambitious R-multiple target.
  const maAt = (k, period) => {
    if (k < period - 1) return null;
    let s = 0; for (let j = k - period + 1; j <= k; j++) s += C[j];
    return s / period;
  };
  const maDipEntry = (k) => {
    const ma = maAt(k, 20); if (ma == null) return null;
    if (C[k] >= ma * (1 - 0.02)) return null;          // must be ≥2% below the mean
    const entry = C[k], stop = L[k] - 0.001 * entry;   // tight, under the dip
    if (entry <= stop) return null;
    return { entry, stop, tp: entry + tpR * (entry - stop) };
  };

  // ── rsi mode ── buy when Wilder RSI(14) crosses up out of oversold (<30 → ≥30).
  const rsiArr = (() => {
    const out = new Array(C.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < C.length; i++) {
      const ch = C[i] - C[i - 1], gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
      if (i <= 14) { avgGain += gain; avgLoss += loss; if (i === 14) { avgGain /= 14; avgLoss /= 14; out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); } }
      else { avgGain = (avgGain * 13 + gain) / 14; avgLoss = (avgLoss * 13 + loss) / 14; out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); }
    }
    return out;
  })();
  const rsiEntry = (k) => {
    if (rsiArr[k] == null || rsiArr[k - 1] == null) return null;
    if (!(rsiArr[k - 1] < 30 && rsiArr[k] >= 30)) return null;   // cross up out of oversold
    const entry = C[k];
    let lo = L[k]; for (let j = Math.max(0, k - 5); j < k; j++) lo = Math.min(lo, L[j]);
    const stop = lo - 0.001 * entry;
    if (entry <= stop) return null;
    return { entry, stop, tp: entry + tpR * (entry - stop) };
  };

  // ── rev mode ── the selective version of support: a bounce off support that holds,
  // but ONLY when lows are already turning up (this swing low is higher than the prior
  // one). Buys reversals, not falling knives — the feature the winning longs shared.
  const revEntry = (k) => {
    const base = supportEntry(k);
    if (!base) return null;
    const prior = swingLows.filter(s => s.ci < k);
    if (prior.length < 2) return null;
    if (!(prior[prior.length - 1].price > prior[prior.length - 2].price)) return null; // not a higher low
    return base;
  };

  const trades = [];
  const reasons = {};   // tally of why each candidate swing low was taken / rejected
  let pos = null, prevLowPrice = null;

  for (let k = n; k < entryCandles.length; k++) {
    const lowHere = lowAt.get(k); // a swing low confirmed at this candle on the entry TF?
    if (!pos && entryMode === "bos") {
     if (lowHere) {
      const tClose  = T[k] + entryMins * 60;
      const hb = biasTLs.map(tl => biasAsOf(tl, tClose));   // higher-TF biases as of entry
      let aligned;
      switch (alignMode) {
        case "none":    aligned = true; break;                            // entry-TF structure only
        case "first":   aligned = hb.length === 0 || hb[0] === "bull"; break; // nearest higher TF only
        case "notbear": aligned = hb.every(b => b !== "bear"); break;     // not actively downtrending
        case "all":
        default:        aligned = hb.every(b => b === "bull"); break;     // every higher TF bull (current)
      }
      let gateReason = aligned ? null : "notAligned";
      if (aligned && chopFilter && !trendingAsOf(trendTL, tClose)) { aligned = false; gateReason = "trendGate"; }
      if (aligned && trendGate) {
        const tg = trendGateMode === "structure"
          ? trendingAsOf(trendTL, tClose)   // 4h making higher highs AND higher lows
          : aboveAsOf(maTL, tClose);        // 4h close above its MA
        if (!tg) { aligned = false; gateReason = "trendGate"; }
      }
      const entry = C[k], stop = lowHere.price, risk = entry - stop;
      let ok = true, reason;
      if (risk <= 0)                                                              { ok = false; reason = "priceBelowStop"; }
      else if (!aligned)                                                          { ok = false; reason = gateReason; }
      else if (maxStopPct && risk / entry > maxStopPct)                           { ok = false; reason = "stopTooFar"; }
      else if (minStopPct && risk / entry < minStopPct)                           { ok = false; reason = "stopTooTight"; }
      else if (requireHigherLow && prevLowPrice != null && lowHere.price <= prevLowPrice) { ok = false; reason = "notHigherLow"; }
      else if (minRoomR && (nearestResAbove(entry, tClose) - entry) / risk < minRoomR)    { ok = false; reason = "noRoom"; }
      else                                                                        { reason = "taken"; }
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (ok) pos = { entry, stop, risk, tp: entry + tpR * risk, beMoved: false, openedAt: k };
     }
    } else if (!pos) {
      // Long dip-buy modes — no trend/alignment gate (the whole point), tight structural
      // stop + ambitious target. Only the stop-size sanity caps apply.
      let cand = null;
      if (entryMode === "support") cand = supportEntry(k);
      else if (entryMode === "ma_dip") cand = maDipEntry(k);
      else if (entryMode === "rsi")    cand = rsiEntry(k);
      else if (entryMode === "rev")    cand = revEntry(k);
      if (cand) {
        const risk = cand.entry - cand.stop;
        let reason = "taken";
        if (risk <= 0)                                          reason = "priceBelowStop";
        else if (maxStopPct && risk / cand.entry > maxStopPct)  reason = "stopTooFar";
        else if (minStopPct && risk / cand.entry < minStopPct)  reason = "stopTooTight";
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (reason === "taken") pos = { entry: cand.entry, stop: cand.stop, risk, tp: cand.tp, beMoved: false, openedAt: k };
      }
    }
    if (lowHere) prevLowPrice = lowHere.price;

    if (pos && k > pos.openedAt) {
      const hi = H[k], lo = L[k];
      // Round-trip fee expressed in R units for this trade (fee % ÷ risk %).
      const feeR = (2 * feeRate * pos.entry) / pos.risk;
      // Stop checked first against the stop as it stands entering this candle
      // (conservative: if both stop and target are touched, assume stop hit first).
      if (lo <= pos.stop) { trades.push((pos.stop - pos.entry) / pos.risk - feeR); pos = null; }
      else if (hi >= pos.tp) { trades.push((pos.tp - pos.entry) / pos.risk - feeR); pos = null; }
      // Breakeven-plus: once this candle's high reaches the trigger, lift the stop
      // above entry for subsequent candles.
      if (pos && lockBreakeven && !pos.beMoved) {
        const lockOffset = Math.max(beLockR * pos.risk, feeBufferPct * pos.entry);
        const armOffset  = Math.max(beTriggerR * pos.risk, lockOffset + 0.5 * pos.risk);
        if (hi >= pos.entry + armOffset) {
          pos.stop = pos.entry + lockOffset;
          pos.beMoved = true;
        }
      }
      // Structure-based take-profit: a swing high confirmed here, while in profit.
      if (pos && exitOnSwingHigh && highAt.has(k) && C[k] > pos.entry) {
        trades.push((C[k] - pos.entry) / pos.risk - feeR);
        pos = null;
      }
      if (pos && k - pos.openedAt >= MAX_HOLD) {
        trades.push((C[k] - pos.entry) / pos.risk - feeR);
        pos = null;
      }
    }
  }

  const count  = trades.length;
  const wins   = trades.filter(r => r > 0).length;
  const totalR = trades.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of trades) { eq += r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }

  return {
    trades: count,
    winRate: count ? wins / count : 0,
    totalR,
    avgR: count ? totalR / count : 0,
    maxDrawdownR: maxDD,
    results: trades,  // raw per-trade R values, for pooling across pairs
    reasons           // { taken, stopTooTight, stopTooFar, trendGate, notAligned, notHigherLow, priceBelowStop }
  };
}

/**
 * profileEntries — the data-speaks-for-itself engine.
 *
 * Walks EVERY swing-low long candidate (no gates — every place you *could* go long),
 * resolves each to a winner (price hits the take-profit target first) or loser (hits
 * the stop first), and records the features cajh already computes at the moment of
 * entry. Aggregating winners vs losers shows what — if anything — separates them.
 * An edge is a feature where winners and losers DIVERGE; a feature they share is a
 * mirage. Breakeven is intentionally off so every entry resolves cleanly to win/loss.
 */
export function profileEntries({ candles15, candles1h, candles4h } = {}, { tpR = TP_R, n = SWING_WINDOW } = {}) {
  const records = [];
  if (!candles15?.length || !candles1h?.length || !candles4h?.length) return { records };

  const C = candles15.map(c => parseFloat(c.close));
  const H = candles15.map(c => parseFloat(c.high));
  const L = candles15.map(c => parseFloat(c.low));
  const V = candles15.map(c => parseFloat(c.volume) || 0);
  const T = candles15.map(c => parseInt(c.time));

  // RSI(14), Wilder
  const rsi = new Array(C.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < C.length; i++) {
    const ch = C[i] - C[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 14) { ag += g; al += l; if (i === 14) { ag /= 14; al /= 14; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  const maAt = (k) => { if (k < 19) return null; let s = 0; for (let j = k - 19; j <= k; j++) s += C[j]; return s / 20; };

  const piv   = detectSwings(candles15, n);
  const lows  = piv.filter(p => p.type === "low");
  const highs = piv.filter(p => p.type === "high");

  const biasAt = (candles, mins, t) => {
    const ps = detectSwings(candles, n);
    let b = null;
    for (const pp of ps) { const ct = parseInt(candles[pp.confirmIndex].time) + mins * 60; if (ct <= t) b = pp.type; else break; }
    return b === "low" ? "bull" : b === "high" ? "bear" : null;
  };

  for (let li = 0; li < lows.length; li++) {
    const low = lows[li];
    const k = low.confirmIndex;
    if (k >= C.length) continue;
    const entry = C[k], stop = low.price, risk = entry - stop;
    if (risk <= 0) continue;
    const target = entry + tpR * risk;

    let outcome = null;
    for (let j = k + 1; j < C.length; j++) {
      if (L[j] <= stop)   { outcome = "loss"; break; }
      if (H[j] >= target) { outcome = "win";  break; }
    }
    if (!outcome) continue;   // never resolved within the data — skip

    const m = maAt(k);
    const tClose = T[k] + 15 * 60;
    let res = Infinity;
    for (const h of highs) if (h.confirmIndex < k && h.price > entry && h.price < res) res = h.price;
    let loN = L[k], hiN = H[k];
    for (let j = Math.max(0, k - 20); j <= k; j++) { loN = Math.min(loN, L[j]); hiN = Math.max(hiN, H[j]); }
    const prevLow = li >= 1 ? lows[li - 1].price : null;
    let av = 0, cnt = 0;
    for (let j = Math.max(0, k - 20); j < k; j++) { av += V[j]; cnt++; }
    av = cnt ? av / cnt : 0;

    records.push({
      outcome,
      rsi: rsi[k],
      maDistPct: m ? (entry - m) / m * 100 : null,
      roomR: isFinite(res) ? (res - entry) / risk : null,
      rangePos: hiN > loN ? (entry - loN) / (hiN - loN) : null,
      higherLow: prevLow != null ? (low.price > prevLow) : null,
      stopPct: risk / entry * 100,
      bias1h: biasAt(candles1h, 60, tClose),
      bias4h: biasAt(candles4h, 240, tClose),
      volRatio: av > 0 ? V[k] / av : null,
    });
  }
  return { records };
}