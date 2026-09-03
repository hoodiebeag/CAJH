/**
 * vrp-run.mjs — execute the pre-registered variance-risk-premium study (C1, stage 1).
 *
 * The gate lives in `vrp.mjs` and is registered in the ledger as C1-VRP-STAGE1-PREMIUM-EXISTS.
 * This file only fetches and reports. It changes no threshold and decides nothing.
 *
 *   node vrp-run.mjs --selftest    synthetic data, no gateway, runs anywhere
 *   node vrp-run.mjs               real: needs IB Gateway on 127.0.0.1:4002
 *
 * Read-only: historical data requests only, on client id 78 so it cannot collide with the bot (0)
 * or the entitlement probe (77). No order path exists here or in ibkr-bars.mjs.
 */

import { connect, fetchDailyBars, alignByDate } from "./ibkr-bars.mjs";
import { GATE, PREREGISTRATION, scoreUnderlying, evaluate, TRADING_DAYS } from "./vrp.mjs";
import { seededRng } from "./inference.mjs";
import { saveExperiment } from "./researchlab.mjs";
import { linkRun, findPreregistration } from "./registry.mjs";

const DURATION = "2 Y";

export function report(perUnderlying, alignment) {
  const gate = evaluate(perUnderlying);
  return {
    schema: "cajh-vrp-stage1/v1",
    preregistrationId: PREREGISTRATION.id,
    horizonDays: GATE.horizonDays,
    alignment,
    perUnderlying,
    gate,
    // Repeated in the output itself so a reader quoting the number also quotes the caveat.
    caveat: "A positive variance premium is a statistical gap between quoted and realised volatility. " +
            "It is NOT a return. No option prices, bid/ask, assignment or margin are modelled here, and " +
            "no position is implied. A PASS authorises stage 2 and nothing else.",
  };
}

async function real() {
  const conn = await connect();
  if (!conn.status.connected) {
    console.error(`IB Gateway not reachable: ${conn.status.error}`);
    console.error("This is a BLOCKED outcome, not a finding. Nothing about the premium is established.");
    process.exitCode = 1; return;
  }
  let rid = 7800;
  const per = [], alignment = [];
  for (const symbol of GATE.underlyings) {
    const { Stock } = conn.ib;
    const stock = new Stock(symbol, "SMART", "USD");
    const px = await fetchDailyBars(conn, stock, DURATION, conn.ib.WhatToShow.TRADES, rid++);
    const iv = await fetchDailyBars(conn, stock, DURATION, conn.ib.WhatToShow.OPTION_IMPLIED_VOLATILITY, rid++);
    if (!px.ok || !iv.ok) {
      per.push({ symbol, aborted: true, reason: `price: ${px.ok ? "ok" : px.reason}; iv: ${iv.ok ? "ok" : iv.reason}` });
      alignment.push({ symbol, aborted: true });
      continue;
    }
    const a = alignByDate(iv.bars, px.bars);
    alignment.push({ symbol, ...a, ivBars: iv.bars.length, priceBars: px.bars.length,
      firstDate: a.dates[0] ?? null, lastDate: a.dates[a.dates.length - 1] ?? null });
    per.push(scoreUnderlying(symbol, a.ivCloses, a.priceCloses, { h: GATE.horizonDays }));
  }
  try { conn.api.disconnect(); } catch { /* already gone */ }

  const out = report(per, alignment);
  const file = saveExperiment("c1-vrp-stage1", { parameters: GATE, preregistration: PREREGISTRATION.id }, out);
  if (findPreregistration(PREREGISTRATION.id)) {
    linkRun(PREREGISTRATION.id, { runFile: file, verdict: out.gate.verdict,
      resultSummary: { verdict: out.gate.verdict, reasons: out.gate.reasons } });
  }
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nVERDICT: ${out.gate.verdict}`);
  for (const r of out.gate.reasons) console.log("  " + r);
  console.error("\nCOMMIT research-registry/ledger.jsonl NOW — this run appended to it, and an\n" +
                "uncommitted entry is destroyed by git reset --hard like any other change.");
}

/** Synthetic end-to-end: proves fetch->align->score->gate wiring without a gateway. */
export function selftest() {
  const mk = (premium, seed) => {
    const rnd = seededRng(seed);
    const g = () => { const u = Math.max(rnd(), 1e-12), v = Math.max(rnd(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const sigma = 0.18, n = 520, ds = sigma / Math.sqrt(TRADING_DAYS);
    const ivBars = [], priceBars = []; let p = 100;
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2024, 0, 2) + i * 86400000).toISOString().slice(0, 10);
      ivBars.push({ date: d, close: sigma + premium + g() * 0.01 });
      priceBars.push({ date: d, close: p });
      p *= Math.exp(g() * ds);
    }
    return { ivBars, priceBars };
  };
  const per = [], alignment = [];
  for (const [symbol, prem, seed] of [["SPY", 0.02, 11], ["QQQ", 0.02, 23]]) {
    const { ivBars, priceBars } = mk(prem, seed);
    const a = alignByDate(ivBars, priceBars);
    alignment.push({ symbol, matched: a.matched, ivOnly: a.ivOnly, priceOnly: a.priceOnly });
    per.push(scoreUnderlying(symbol, a.ivCloses, a.priceCloses, { h: GATE.horizonDays }));
  }
  const out = report(per, alignment);
  console.log(JSON.stringify({
    mode: "selftest (synthetic, +2.00 vol pts injected into both)",
    alignment: out.alignment,
    measured: out.perUnderlying.map((r) => ({ symbol: r.symbol, windows: r.windows,
      volPoints: +(r.meanVrpVolPoints * 100).toFixed(2), excludesZero: r.excludesZero })),
    verdict: out.gate.verdict,
    reasons: out.gate.reasons,
  }, null, 2));
  return out;
}

if (process.argv[2] === "--selftest") selftest();
else if (process.argv[1] && import.meta.url === (await import("url")).pathToFileURL(process.argv[1]).href) await real();
