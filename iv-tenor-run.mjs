/**
 * iv-tenor-run.mjs — settle what horizon IBKR's volatility series are quoting.
 *
 *   node iv-tenor-run.mjs --selftest   synthetic, no gateway
 *   node iv-tenor-run.mjs              real: needs IB Gateway
 *
 * Read-only. Historical data requests only, on client id 79 (bot 0, probe 77, vrp 78).
 * Produces no verdict about returns and implies no position — it establishes what a data series
 * MEANS, so that a future variance study can be specified against the right quantity.
 */

import { connect, fetchDailyBars, alignByDate } from "./ibkr-bars.mjs";
import { scoreWindows, trailingVol, PREREGISTERED_CRITERION, CANDIDATE_WINDOWS } from "./iv-tenor.mjs";
import { TRADING_DAYS } from "./vrp.mjs";
import { seededRng } from "./inference.mjs";
import { saveExperiment } from "./researchlab.mjs";

const SYMBOLS = ["SPY", "QQQ"];
const DURATION = "2 Y";

export function interpret(hv, iv) {
  const lines = [];
  if (hv?.bestByMeanAbsDiff) {
    lines.push(`IBKR HISTORICAL_VOLATILITY behaves most like a ${hv.bestByMeanAbsDiff}-day trailing window` +
      (hv.agree ? " (both criteria agree)" : ` (correlation instead favours ${hv.bestByCorrelation} — criteria disagree, treat as unsettled)`));
  }
  if (iv?.bestByMeanAbsDiff) {
    lines.push(`OPTION_IMPLIED_VOLATILITY tracks forward realised volatility best at ${iv.bestByMeanAbsDiff} days` +
      (iv.agree ? " (both criteria agree)" : ` (correlation instead favours ${iv.bestByCorrelation} — criteria disagree, treat as unsettled)`));
  }
  const ivBest = iv?.bestByMeanAbsDiff;
  if (ivBest && ivBest !== 5) {
    lines.push(`CONSEQUENCE: the C1 study compared this series against 5-day realised volatility. ` +
      `If the implied series is priced at ~${ivBest} days, that comparison was between different ` +
      `quantities and the negative premium it measured is not interpretable as a premium. ` +
      `The fix is ONE re-specified study, pre-registered at h=${ivBest} before it runs — not a horizon sweep.`);
  } else if (ivBest === 5) {
    lines.push("CONSEQUENCE: the implied series already matches the 5-day horizon C1 used, so horizon " +
      "mismatch does NOT explain C1's negative premium and that result stands as measured.");
  }
  return lines;
}

async function real() {
  const conn = await connect();
  if (!conn.status.connected) {
    console.error(`IB Gateway not reachable: ${conn.status.error}`);
    console.error("BLOCKED, not a finding. The tenor question remains open.");
    process.exitCode = 1; return;
  }
  let rid = 7900;
  const out = { schema: "cajh-iv-tenor/v1", criterion: PREREGISTERED_CRITERION, candidates: CANDIDATE_WINDOWS, perSymbol: [] };
  for (const symbol of SYMBOLS) {
    const { Stock, WhatToShow } = conn.ib;
    const stock = new Stock(symbol, "SMART", "USD");
    const px = await fetchDailyBars(conn, stock, DURATION, WhatToShow.TRADES, rid++);
    const hv = await fetchDailyBars(conn, stock, DURATION, WhatToShow.HISTORICAL_VOLATILITY, rid++);
    const iv = await fetchDailyBars(conn, stock, DURATION, WhatToShow.OPTION_IMPLIED_VOLATILITY, rid++);
    if (!px.ok) { out.perSymbol.push({ symbol, aborted: true, reason: `price: ${px.reason}` }); continue; }
    const entry = { symbol, priceBars: px.bars.length, hvBars: hv.bars.length, ivBars: iv.bars.length,
      hvError: hv.ok ? null : hv.reason, ivError: iv.ok ? null : iv.reason };
    if (hv.ok && hv.bars.length) {
      const a = alignByDate(hv.bars, px.bars);
      entry.historicalVolatility = scoreWindows(a.ivCloses, a.priceCloses, { direction: "trailing" });
      entry.hvMatched = a.matched;
    }
    if (iv.ok && iv.bars.length) {
      const a = alignByDate(iv.bars, px.bars);
      entry.impliedVolatility = scoreWindows(a.ivCloses, a.priceCloses, { direction: "forward" });
      entry.ivMatched = a.matched;
    }
    entry.interpretation = interpret(entry.historicalVolatility, entry.impliedVolatility);
    out.perSymbol.push(entry);
  }
  try { conn.api.disconnect(); } catch { /* already gone */ }
  const file = saveExperiment("iv-tenor", { parameters: { candidates: CANDIDATE_WINDOWS, duration: DURATION } }, out);
  console.log(JSON.stringify(out, null, 2));
  console.log("\n=== READ THIS ===");
  for (const s of out.perSymbol) for (const l of (s.interpretation ?? [])) console.log(`${s.symbol}: ${l}`);
  console.log(`\nsaved: ${file}`);
}

export function selftest() {
  const rnd = seededRng(21);
  const g = () => { const u = Math.max(rnd(), 1e-12), v = Math.max(rnd(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const ds = 0.18 / Math.sqrt(TRADING_DAYS);
  const p = [100];
  for (let i = 1; i < 1500; i++) p.push(p[i - 1] * Math.exp(g() * ds));
  const KNOWN = 30;
  const hvRef = p.map((_, i) => trailingVol(p, i, KNOWN));
  const res = scoreWindows(hvRef, p, { direction: "trailing" });
  console.log(JSON.stringify({
    mode: `selftest — reference built as a KNOWN ${KNOWN}-day trailing window`,
    identified: res.bestByMeanAbsDiff,
    correct: res.bestByMeanAbsDiff === KNOWN,
    criteriaAgree: res.agree,
    table: res.rows.filter((r) => r.usable).map((r) => ({ h: r.h, meanAbsDiff: +r.meanAbsDiff.toFixed(5), correlation: +r.correlation.toFixed(4) })),
  }, null, 2));
  return res;
}

if (process.argv[2] === "--selftest") selftest();
else if (process.argv[1] && import.meta.url === (await import("url")).pathToFileURL(process.argv[1]).href) await real();
