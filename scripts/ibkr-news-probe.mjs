#!/usr/bin/env node
/**
 * ibkr-news-probe.mjs — ask the Gateway what news this account can actually read.
 *
 * READ-ONLY. `reqNewsProviders`, then optionally `reqContractDetails` + `reqHistoricalNews` for one
 * symbol to prove the path end to end. No order path in this file.
 *
 * WHY ASK RATHER THAN ASSUME. IBKR bundles some news providers and charges for others, and the
 * difference decides whether the analyst's news slot is a real input or decoration. This project's
 * standing rule is that an entitlement is measured, not assumed -- the same reason the universe
 * probe exists, and the reason shortability is recorded as UNKNOWN rather than guessed at.
 *
 * IT ALSO CHECKS THE TIMESTAMP, which is the whole reason IBKR was chosen over a news API. A
 * headline is only usable in a decision log if the time attached to it is the time it became
 * available. The probe prints the raw string the Gateway sent beside the parsed instant so a
 * format this code does not handle is visible immediately rather than silently dropped.
 *
 * Usage:
 *   node scripts/ibkr-news-probe.mjs              # providers only
 *   node scripts/ibkr-news-probe.mjs AAPL         # providers, then headlines for one symbol
 */
import { connect } from "../ibkr-bars.mjs";
import { listProviders, fetchHeadlines, parseNewsTime } from "../analyst/news.mjs";

const SYMBOL = process.argv[2] ?? null;

const conn = await connect();
if (!conn.status.connected) {
  console.error(`no Gateway: ${conn.status.error}`);
  console.error("This probe needs IB Gateway up, the API enabled, and this host trusted.");
  console.error("Nothing was changed.");
  process.exit(1);
}
console.log("connected. read-only.\n");

// ---- 1. what is entitled ----------------------------------------------------------------------
const prov = await listProviders(conn);
if (!prov.ok) {
  console.error(`could not list providers: ${prov.reason}`);
  try { conn.api.disconnect(); } catch { /* socket may already be closed */ }
  process.exit(2);
}
if (!prov.providers.length) {
  console.log("NO NEWS PROVIDERS ENTITLED on this account.");
  console.log("The analyst's news slot cannot be filled from IBKR until one is added.");
  console.log("This is an account setting, not a code problem.");
} else {
  console.log(`${prov.providers.length} provider(s) entitled:`);
  for (const p of prov.providers) console.log(`  ${p.code.padEnd(8)} ${p.name ?? ""}`);
}

// ---- 2. does the path actually deliver ---------------------------------------------------------
if (SYMBOL && prov.providers.length) {
  const codes = prov.providers.map((p) => p.code).join("+");
  console.log(`\nresolving ${SYMBOL} to a conId...`);

  const { EventName } = conn.ib;
  const conId = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      conn.api.off(EventName.contractDetails, onD);
      conn.api.off(EventName.contractDetailsEnd, onE);
      clearTimeout(t);
      resolve(v);
    };
    let found = null;
    const onD = (rid, d) => { if (rid === 8100 && !found) found = d?.contract?.conId ?? null; };
    const onE = (rid) => { if (rid === 8100) finish(found); };
    const t = setTimeout(() => finish(null), 15000);
    conn.api.on(EventName.contractDetails, onD);
    conn.api.on(EventName.contractDetailsEnd, onE);
    conn.api.reqContractDetails(8100, { symbol: SYMBOL, secType: "STK", exchange: "SMART", currency: "USD" });
  });

  if (!conId) {
    console.log(`could not resolve ${SYMBOL}; historical news needs a conId.`);
  } else {
    console.log(`conId ${conId}. requesting up to 10 headlines from ${codes}...\n`);
    const r = await fetchHeadlines(conn, { conId, providerCodes: codes, total: 10, reqId: 8101 });
    if (!r.ok) {
      console.log(`headline request failed: ${r.reason}`);
      console.log("A 'not subscribed' error here means the provider is listed but not entitled for");
      console.log("historical news, which is a distinction worth recording rather than inferring.");
    } else if (!r.headlines.length) {
      console.log("entitled, but no headlines returned for this symbol and window.");
    } else {
      console.log(`${r.headlines.length} headline(s)${r.hasMore ? " (more available)" : ""}:`);
      for (const h of r.headlines) {
        console.log(`  ${h.atIso}  [${h.providerCode}]  ${String(h.headline).slice(0, 90)}`);
      }
      // The point of choosing IBKR over a news API: the timestamp must be trustworthy.
      const raw = r.headlines[0];
      console.log(`\ntimestamp check: parsed ${raw.atIso} (epoch ${raw.at})`);
      console.log(`  reparsed from the same string: ${parseNewsTime(raw.atIso) === raw.at ? "consistent" : "INCONSISTENT — investigate"}`);
      const future = r.headlines.filter((h) => h.at > Date.now() / 1000);
      if (future.length) {
        console.log(`  WARNING: ${future.length} headline(s) dated in the FUTURE. assertNotAfter`);
        console.log("  would drop these, but a provider stamping forward is worth knowing about.");
      }
    }
  }
}

try { conn.api.disconnect(); } catch { /* socket may already be closed */ }
console.log("\nRecord the result in campaign-state.json. An entitlement is a measured fact.");
