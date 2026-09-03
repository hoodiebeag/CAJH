/**
 * pipeline-shakedown.mjs — does the canonical pipeline actually work on a real population?
 *
 * WHY. `evallib`, `inference` and `promotion` are unit-tested in isolation and nothing uses them
 * end to end. Until something does, they are scaffolding that looks like a tool. This takes one
 * already-closed study — EQUITIES-MADIP-OUT-OF-SAMPLE, the best-documented trade population in
 * the project — rebuilds it through the canonical modules, and reports every place the new layer
 * disagrees with the published write-up or cannot answer at all.
 *
 * IT REVISES NOTHING. `promotion.mjs` is explicitly not retroactive. The published verdict stands
 * exactly as written; this reports on the PIPELINE, not on ma_dip.
 *
 * TWO MODES.
 *   --selftest   synthetic candles, no cache, runs anywhere. Proves the plumbing and exercises
 *                the excursion-shape check below. Run this first; it is the part I can verify.
 *   (default)    the real population. Needs research-cache/equities-1d-djta-oos/, which is
 *                gitignored and exists only on the machine that built it.
 */

import fs from "fs";
import path from "path";
import { backtestMultiTF } from "./backtest.js";
import { makeTradeRecord, validateTradePopulation, summarizeTrades, utcDayKey } from "./evallib.mjs";
import { clusteredBootstrapCITrades, alwaysFlatControl, buyAndHoldControl } from "./inference.mjs";
import { promotionGate } from "./promotion.mjs";

const CONFIG = { entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true };
const SPLIT = 0.70;
const COMMISSION_PER_SHARE = 0.005;
const SLIPPAGE_PCT_EQUITY = 0.0005;
const CACHE = path.join(".", "research-cache", "equities-1d-djta-oos");

/** Published by EQUITIES-MADIP-OUT-OF-SAMPLE and DATE-CLUSTERED-RESAMPLING-DJTA20. */
export const PUBLISHED = Object.freeze({
  trades: 300, avgR: 0.2994, positionBlockedCI: [0.0509, 0.5350], effectiveN: 104,
});

/**
 * The canonical record needs an entry timestamp; `excursions` does not always carry one.
 *
 * `backtest.js` pushes excursions from four places. Only the normal exit path (the one that sets
 * `why`) records `entryTime`. The other three are same-bar stop-outs — the entry bar also traded
 * at or below the stop — and they omit it. A consumer that keys on `entryTime` would not degrade
 * on such a trade, it would throw: `date-clustered-resampling-audit.mjs` does
 * `new Date(undefined * 1000).toISOString()`, a RangeError, and that audit produced the
 * effective-n figure that removed ma_dip's zero-exclusion.
 *
 * HOW FAR THAT CONCERN ACTUALLY GOES, tested rather than asserted: 400 randomized series with
 * deliberately violent lower wicks produced 4,554 ma_dip trades and **zero** undated excursions.
 * The path is reachable in the source but did not fire once under this config — plausibly because
 * the stop derives from a prior swing low, so the entry bar would have to break below it while
 * still passing the 6% maxStopPct gate. So the published effective-n figure is not in doubt.
 * The inconsistency in the excursion shape is still real, and this function reports coverage so a
 * future consumer on a different config finds out rather than assuming.
 */
export function excursionTimeCoverage(excursions) {
  const total = excursions.length;
  const dated = excursions.filter((x) => Number.isFinite(x.entryTime)).length;
  return { total, dated, undated: total - dated, complete: total === dated };
}

/** Convert one symbol's excursions into canonical records. Undated trades are reported, not dropped. */
export function toCanonical(symbol, excursions, candles, feeRate) {
  const timeToIdx = new Map(candles.map((c, i) => [+c.time, i]));
  const records = [], undated = [];
  for (const x of excursions) {
    if (!Number.isFinite(x.entryTime)) { undated.push(x); continue; }
    const entryIdx = timeToIdx.get(x.entryTime);
    const exitIdx = Math.min((entryIdx ?? 0) + (x.barsHeld ?? 0), candles.length - 1);
    // `r` from backtest.js is already NET of cost. makeTradeRecord charges cost itself, so the
    // gross figure has to be recovered first or the population is charged twice -- the exact
    // double-count that CLASSIFIER-P5-ECONOMICS-ROW-STALENESS caught in a published figure.
    const notional = Math.abs(x.entry) + Math.abs(x.exitPrice);
    const grossR = x.r + ((feeRate + SLIPPAGE_PCT_EQUITY) * notional) / x.risk;
    records.push(makeTradeRecord({
      symbol, timeframe: "1d",
      entryTime: x.entryTime * 1000, exitTime: (+candles[exitIdx].time) * 1000,
      entryPrice: x.entry, exitPrice: x.exitPrice, risk: x.risk,
      grossR, feeRate, slipPct: SLIPPAGE_PCT_EQUITY,
      exitReason: x.why ?? "same-bar-stop", mae: x.mae ?? 0, mfe: x.mfe ?? 0,
    }));
  }
  return { records, undated };
}

function runOne(symbol, candles) {
  const cut = Number(candles[Math.floor(candles.length * SPLIT)]?.time);
  const holdout = candles.filter((c) => +c.time >= cut);
  if (holdout.length < 20) return null;
  const avgClose = holdout.reduce((a, c) => a + Number(c.close), 0) / holdout.length;
  const feeRate = COMMISSION_PER_SHARE / avgClose;
  const r = backtestMultiTF({ series: [{ label: "1d", mins: 1440, candles: holdout }] },
    { ...CONFIG, entryTf: "1d", feeRate, slipPct: SLIPPAGE_PCT_EQUITY });
  return { symbol, holdout, feeRate, raw: r };
}

export function shakedown(datasets) {
  const all = [], undatedAll = [], rawR = [];
  let coverage = { total: 0, dated: 0, undated: 0 };
  for (const d of datasets) {
    const c = excursionTimeCoverage(d.raw.excursions);
    coverage = { total: coverage.total + c.total, dated: coverage.dated + c.dated, undated: coverage.undated + c.undated };
    rawR.push(...d.raw.results);
    const { records, undated } = toCanonical(d.symbol, d.raw.excursions, d.holdout, d.feeRate);
    all.push(...records); undatedAll.push(...undated);
  }
  const validation = validateTradePopulation(all);
  const summary = all.length ? summarizeTrades(all) : null;
  const ci = all.length ? clusteredBootstrapCITrades(all, { iterations: 2000, seed: 20260903 }) : null;
  const rawAvg = rawR.length ? rawR.reduce((a, b) => a + b, 0) / rawR.length : 0;

  // Reconciliation: does the canonical layer reproduce the study's own headline figures?
  const recon = {
    tradesRaw: rawR.length, tradesCanonical: all.length,
    tradesPublished: PUBLISHED.trades,
    avgRRaw: rawAvg, avgRCanonicalNet: summary?.net.mean ?? null,
    avgRPublished: PUBLISHED.avgR,
    netRMatchesRaw: summary ? Math.abs(summary.net.mean - rawAvg) < 1e-9 : null,
    effectiveNCanonical: summary?.effectiveN ?? null,
    effectiveNPublished: PUBLISHED.effectiveN,
    clusteredCI: ci ? [ci.lo, ci.hi] : null,
    positionBlockedCIPublished: PUBLISHED.positionBlockedCI,
  };

  const gate = promotionGate({
    id: "EQUITIES-MADIP-OUT-OF-SAMPLE (pipeline shakedown, not a re-verdict)",
    netAvgR: summary?.net.mean, effectiveN: summary?.effectiveN,
    clusteredCI: ci ? { lo: ci.lo, hi: ci.hi, clusterAware: true } : null,
    maxDrawdownR: summary?.net.maxDrawdownR,
    costBasis: { commissionPerShare: COMMISSION_PER_SHARE, slipPct: SLIPPAGE_PCT_EQUITY, source: "IBKR Fixed plan, 5bps/side — EQUITIES-MADIP-SIGNIFICANCE" },
    // Everything below is deliberately absent: the study never recorded it. The gate must BLOCK
    // on each rather than pass, and those blocks are the finding.
  });

  return { coverage, undated: undatedAll.length, validation, summary, recon, gate,
    alwaysFlat: alwaysFlatControl(all.length) };
}

// ─── self-test: synthetic, no cache, runs anywhere ───────────────────────────────────────
function syntheticCandles(n, { sameBarStop = false } = {}) {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const t = Math.floor(Date.UTC(2024, 0, 1) / 1000) + i * 86400;
    p = p * (1 + Math.sin(i / 7) * 0.02 + 0.001);
    const wick = sameBarStop && i % 11 === 10 ? 0.92 : 0.985;
    out.push({ time: t, open: String(p * 0.995), high: String(p * 1.02), low: String(p * wick), close: String(p), volume: "1000" });
  }
  return out;
}

function selftest() {
  const datasets = [];
  for (const [sym, opts] of [["AAA", {}], ["BBB", { sameBarStop: true }], ["CCC", { sameBarStop: true }]]) {
    const d = runOne(sym, syntheticCandles(400, opts));
    if (d) datasets.push(d);
  }
  const res = shakedown(datasets);
  console.log(JSON.stringify({
    mode: "selftest",
    excursionCoverage: res.coverage,
    undatedTradesDropped: res.undated,
    populationValid: res.validation.ok,
    validationFailures: res.validation.failures.slice(0, 3),
    canonicalNetMatchesBacktestNet: res.recon.netRMatchesRaw,
    nominalN: res.summary?.nominalN, effectiveN: res.summary?.effectiveN,
    gateVerdict: res.gate.verdict,
    gateBlocked: res.gate.blocked.map((b) => b.id),
    gateFailed: res.gate.failed.map((f) => f.id),
  }, null, 2));
  return res;
}

function real() {
  if (!fs.existsSync(CACHE)) {
    console.error(`No cache at ${CACHE}. This mode needs the machine that built it. Run with --selftest to verify the plumbing.`);
    process.exitCode = 1; return;
  }
  const datasets = [];
  for (const f of fs.readdirSync(CACHE).filter((x) => x.endsWith(".json"))) {
    const saved = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"));
    const candles = Array.isArray(saved.candles) ? saved.candles : null;
    if (!candles?.length) continue;
    const d = runOne(f.replace(/\.json$/, ""), candles);
    if (d) datasets.push(d);
  }
  const res = shakedown(datasets);
  console.log(JSON.stringify({ mode: "real", symbols: datasets.length, ...res, summary: res.summary, gate: {
    verdict: res.gate.verdict, blocked: res.gate.blocked, failed: res.gate.failed, passed: res.gate.passed,
  } }, null, 2));
  return res;
}

if (process.argv[2] === "--selftest") selftest(); else if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") ?? "")) real();
