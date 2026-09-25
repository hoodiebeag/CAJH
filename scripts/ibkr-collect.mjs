#!/usr/bin/env node
/**
 * ibkr-collect.mjs — everything the agent needs from IB Gateway, in one command.
 *
 * READ-ONLY. `reqNewsProviders`, `reqContractDetails`, `reqHistoricalNews`, `reqHistoricalData`.
 * There is no order path in this file and none in anything it imports.
 *
 * WHY THIS EXISTS. The container running the agent cannot reach a Gateway: loopback refuses, the
 * docker hostnames do not resolve, and no tunnel can be established from that side either --
 * measured 2026-09-19, `login.tailscale.com` answers 403 at CONNECT, and every tunnel product
 * needs its own coordination server to authenticate. Private ranges DO bypass the proxy, so a
 * route would work if one existed; none does.
 *
 * So the collection runs where the Gateway already is. This script is deliberately the ONLY thing
 * the owner has to do: three separate probes, one invocation, output written to files that get
 * committed and picked up on the other side.
 *
 * IT DEPENDS ON @stoqey/ib AND NOTHING ELSE. The repository's package.json also carries discord.js,
 * canvas and others, and `canvas` needs a native toolchain that turns "just run this" into an
 * afternoon. Every import below is either a node builtin or a dependency-free local module, so
 * `npm install @stoqey/ib` is the whole setup.
 *
 * Usage:
 *   npm install @stoqey/ib
 *   node scripts/ibkr-collect.mjs
 *   git add -f data/ && git commit -m "IBKR collection" && git push
 *
 * Options:
 *   --host H --port P     default 127.0.0.1:4002 (TWS is usually 7497)
 *   --symbol SYM          the symbol used for the news and intraday probes (default AAPL)
 *   --skip-news|--skip-sectors|--skip-intraday
 *   --delay MS            between contract-details requests (default 200)
 */
import fs from "node:fs";
import path from "node:path";
import { connect, fetchBars } from "../ibkr-bars.mjs";
import { availablePairs } from "../bundle-loader.mjs";
import { listProviders, fetchHeadlines, saveNewsCache } from "../analyst/news.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

if (flag("host", null)) process.env.IBKR_HOST = flag("host");
if (flag("port", null)) process.env.IBKR_PORT = flag("port");

const SYMBOL = flag("symbol", "AAPL");
const DELAY = Number(flag("delay", 200));
const NEWS_DELAY = Number(flag("news-delay", 600));   // TWS paces historical news harder than details
const PER_SYMBOL = Number(flag("per-symbol", 8));     // a context budget, not a dump
const ROOT = flag("root", "sp500-bundle");
const OUT = flag("out", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conIds = {};
const report = { collectedAt: new Date().toISOString(), host: process.env.IBKR_HOST ?? "127.0.0.1", port: Number(process.env.IBKR_PORT ?? 4002) };

console.log(`connecting to ${report.host}:${report.port} ...`);
const conn = await connect();
if (!conn.status.connected) {
  console.error(`\nno Gateway: ${conn.status.error}\n`);
  console.error("Checks, in the order they usually fail:");
  console.error("  1. IB Gateway or TWS is running and logged in");
  console.error("  2. in TWS only, Configure > API > Settings > 'Enable ActiveX and Socket Clients' is ON.");
  console.error("     IB GATEWAY HAS NO SUCH CHECKBOX -- it is API-only by design, so nothing to enable.");
  console.error("  3. the port matches (Gateway paper 4002, live 4001; TWS paper 7497, live 7496)");
  console.error("  4. this machine is in Trusted IPs, or 'Allow connections from localhost only' is OFF");
  console.error("\nNothing was written.");
  process.exit(1);
}
console.log("connected. read-only.\n");

fs.mkdirSync(OUT, { recursive: true });

// ---- 1. news entitlement -----------------------------------------------------------------------
// Entitlement only here. The HEADLINES are fetched after the sector pass, because that pass already
// pays for a reqContractDetails per symbol and historical news needs the conId it returns --
// resolving them twice would double the slowest part of this script for nothing.
let providerCodes = null;
if (!has("skip-news")) {
  console.log("[1/4] news providers ...");
  const prov = await listProviders(conn);
  report.news = { ok: prov.ok, providers: prov.providers ?? [], reason: prov.reason ?? null };
  if (!prov.ok) {
    console.log(`  could not list providers: ${prov.reason}`);
  } else if (!prov.providers.length) {
    console.log("  NO PROVIDERS ENTITLED. The analyst's news slot cannot be filled from IBKR.");
    console.log("  That is an account setting, not a code problem — and knowing it is the result.");
  } else {
    providerCodes = prov.providers.map((x) => x.code).join("+");
    report.news.providers = prov.providers;
    console.log(`  ${prov.providers.length} entitled: ${prov.providers.map((x) => x.code).join(", ")}`);
  }
  console.log("");
}

// ---- 2. sector map -------------------------------------------------------------------------------
if (!has("skip-sectors")) {
  const symbols = availablePairs(1440, ROOT);
  console.log(`[2/4] classifying ${symbols.length} symbols (about ${Math.ceil(symbols.length * DELAY / 1000)}s) ...`);
  const sectors = {}, unclassified = [], ambiguous = [];
  let reqId = 9100;
  for (const sym of symbols) {
    const d = await detailsFor(conn, sym, reqId++);
    await sleep(DELAY);
    if (!d.ok) { unclassified.push([sym, d.reason]); continue; }

    // THE conId IS CAPTURED BEFORE ANY CLASSIFICATION BRANCH, and that ordering is the whole point.
    // It used to sit after the `continue`s below, so a name that resolved fine but carried no
    // industry label got no conId and therefore no news. That silently excluded every ETF -- SPY,
    // QQQ and the seven XL* sector funds -- from the news pass. They are not companies, so they
    // have no industry; they emphatically do have news, and market-level commentary is the macro
    // backdrop the analyst is least able to infer from price. "Can I identify this instrument" and
    // "does this instrument have a sector" are different questions and must not share a branch.
    const cid = d.details[0]?.contract?.conId;
    if (Number.isFinite(cid)) conIds[sym] = cid;      // already paid for; the news pass reuses it

    const labels = [...new Set(d.details.map((x) => x?.industry).filter((v) => typeof v === "string" && v.trim()))];
    if (!labels.length) { unclassified.push([sym, "no industry field"]); continue; }
    if (labels.length > 1) { ambiguous.push([sym, labels]); continue; }
    sectors[sym] = labels[0].trim();
  }
  // IBKR's `industry` is IBKR's taxonomy, NOT GICS. It is recorded as its own scheme rather than
  // crosswalked -- see analyst/sector-map.mjs for why a hand-written crosswalk is refused.
  const map = {
    scheme: "IBKR-industry",
    source: `IBKR reqContractDetails .industry, SMART/USD STK, via ${ROOT}`,
    asOf: new Date().toISOString().slice(0, 10),
    sectors,
  };
  fs.writeFileSync(path.join(OUT, "sector-map.json"), JSON.stringify(map, null, 2) + "\n");
  const groups = new Map();
  for (const v of Object.values(sectors)) groups.set(v, (groups.get(v) ?? 0) + 1);
  console.log(`  classified ${Object.keys(sectors).length}/${symbols.length} into ${groups.size} groups`);
  if (ambiguous.length) console.log(`  ${ambiguous.length} ambiguous (listings disagree), left out`);
  if (unclassified.length) console.log(`  ${unclassified.length} unclassified, left out (not bucketed)`);
  console.log(`  wrote ${path.join(OUT, "sector-map.json")}`);
  report.sectors = { classified: Object.keys(sectors).length, total: symbols.length, groups: groups.size, ambiguous: ambiguous.length, unclassified: unclassified.length };
  console.log("");
}

// ---- 3. headlines for the whole universe --------------------------------------------------------
// THE SAMPLE WAS THE PROBLEM. The first version fetched headlines for ONE symbol as proof the path
// worked. It did work -- and it meant the analyst ran with news on 0 of its 40 candidates, which is
// only visible now that the journal records news coverage per batch. A news input covering 1 of 127
// names is not a news input; it is a plumbing test left in place.
if (!has("skip-news") && providerCodes) {
  const syms = Object.keys(conIds);
  if (!syms.length) {
    console.log("[3/4] no conIds available (sectors skipped?), so no headlines. Nothing invented.");
  } else {
    console.log(`[3/4] headlines for ${syms.length} symbols (about ${Math.ceil(syms.length * NEWS_DELAY / 1000)}s) ...`);
    const bySymbol = {};
    const failed = [];
    let reqId = 9200, total = 0, future = 0;
    for (const sym of syms) {
      const r = await fetchHeadlines(conn, { conId: conIds[sym], providerCodes, total: PER_SYMBOL, reqId: reqId++ });
      await sleep(NEWS_DELAY);
      if (!r.ok) { failed.push([sym, r.reason]); process.stdout.write("x"); continue; }
      if (!r.headlines.length) { process.stdout.write("."); continue; }
      bySymbol[sym] = r.headlines;
      total += r.headlines.length;
      future += r.headlines.filter((h) => h.at > Date.now() / 1000).length;
      process.stdout.write("+");
    }
    process.stdout.write("\n");
    saveNewsCache(path.join(OUT, "news-cache.json"), bySymbol, { providers: report.news?.providers ?? [] });
    console.log(`  ${Object.keys(bySymbol).length}/${syms.length} symbols carry headlines, ${total} in total`);
    if (failed.length) console.log(`  ${failed.length} request(s) failed: ${failed.slice(0, 5).map(([a, b]) => `${a} (${b})`).join(", ")}`);
    // Absence is not evidence of a quiet day -- the free bundle covers what Briefing.com chose to
    // write about. Recorded so the analyst's coverage can be read rather than assumed.
    console.log(`  ${syms.length - Object.keys(bySymbol).length} symbol(s) returned nothing; that is COVERAGE, not calm.`);
    if (future) console.log(`  WARNING: ${future} headline(s) dated in the FUTURE`);
    console.log(`  wrote ${path.join(OUT, "news-cache.json")}`);
    // atCap matters: if most symbols return exactly PER_SYMBOL headlines then the cap is binding
    // and coverage is being limited by this script, not by the provider. That is a different fact
    // from "the feed is thin" and leads somewhere different.
    const atCap = Object.values(bySymbol).filter((h) => h.length >= PER_SYMBOL).length;
    report.news.coverage = { symbols: syms.length, withHeadlines: Object.keys(bySymbol).length,
                             headlines: total, failed: failed.length, future,
                             perSymbolCap: PER_SYMBOL, atCap };
    if (atCap) {
      console.log(`  ${atCap} symbol(s) hit the ${PER_SYMBOL}-headline cap — more news exists than was pulled`);
      console.log(`  (raise it with --per-symbol N; the context is a budget, so this is a tradeoff)`);
    }
  }
  console.log("");
}

// ---- 4. intraday ladder --------------------------------------------------------------------------
if (!has("skip-intraday")) {
  console.log(`[4/4] intraday ladder on ${SYMBOL} ...`);
  const LADDER = [
    { duration: "1 D", barSize: "1 min" },
    { duration: "2 D", barSize: "1 min" },
    { duration: "5 D", barSize: "5 mins" },
    { duration: "1 M", barSize: "30 mins" },
    { duration: "6 M", barSize: "1 hour" },
    { duration: "1 Y", barSize: "1 day", note: "known-good control" },
    { duration: "1 Y", barSize: "1 min", note: "DELIBERATE OVER-ASK, should be REFUSED" },
  ];
  const contract = { symbol: SYMBOL, secType: "STK", exchange: "SMART", currency: "USD" };
  const rows = [];
  let reqId = 9300;
  for (const rung of LADDER) {
    const r = await fetchBars(conn, contract, rung.duration, conn.ib.WhatToShow.TRADES, reqId++, rung.barSize);
    rows.push({ ...rung, ok: r.ok, bars: r.bars.length, reason: r.reason ?? "" });
    console.log(`  ${(rung.duration + " / " + rung.barSize).padEnd(18)}${(r.ok ? "OK" : "REFUSED").padEnd(9)}` +
                `${String(r.bars.length).padStart(7)} bars${r.ok ? "" : `  [${r.reason}]`}` +
                `${rung.note ? `   <- ${rung.note}` : ""}`);
    await sleep(1000);   // conservative; TWS pacing limits are documented badly and enforced strictly
  }
  report.intraday = rows;
  const overAsk = rows.at(-1);
  if (overAsk.ok) {
    console.log("\n  NOTE: the over-ask rung SUCCEEDED, so this ladder is not discriminating");
    console.log("  and its other rows should not be read as entitlement boundaries.");
  }
  console.log("");
}

try { conn.api.disconnect(); } catch { /* socket may already be closed */ }

fs.writeFileSync(path.join(OUT, "ibkr-collection-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${path.join(OUT, "ibkr-collection-report.json")}`);
console.log("\nNow commit and push so the agent can pick this up:");
console.log("  git add -f data/ && git commit -m 'IBKR collection' && git push");

// ---- helpers -------------------------------------------------------------------------------------

function detailsFor({ api, ib }, symbol, reqId, timeoutMs = 15000) {
  const { EventName } = ib;
  return new Promise((resolve) => {
    const found = [];
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.contractDetails, onD);
      api.off(EventName.contractDetailsEnd, onE);
      clearTimeout(t);
      resolve(v);
    };
    const onD = (rid, d) => { if (rid === reqId) found.push(d); };
    const onE = (rid) => { if (rid === reqId) finish({ ok: found.length > 0, details: found, reason: found.length ? "" : "no details" }); };
    const t = setTimeout(() => finish({ ok: false, details: [], reason: "timeout" }), timeoutMs);
    api.on(EventName.contractDetails, onD);
    api.on(EventName.contractDetailsEnd, onE);
    try { api.reqContractDetails(reqId, { symbol, secType: "STK", exchange: "SMART", currency: "USD" }); }
    catch (e) { finish({ ok: false, details: [], reason: String(e?.message ?? e) }); }
  });
}
