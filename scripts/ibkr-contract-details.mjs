/**
 * ibkr-contract-details.mjs — build a sector map from the Gateway's own contract metadata.
 *
 * READ-ONLY. It issues `reqContractDetails` and nothing else; there is no order path in this file.
 *
 * WHY IT EXISTS. The GICS/industry map is the cheapest single unlock left in the strategy-manual
 * triage: it moves T06, MR04, CF05, CF11 and HX08 out of Tier B. It was blocked because this
 * container cannot reach the open internet (measured 2026-09-11: the agent proxy answers 403 to
 * CONNECT for anything outside the package-registry allowlist), and because an unvetted npm package
 * of ticker-to-sector labels would be the wrong answer anyway. The Gateway is the one source here
 * that is both reachable and authoritative about the instruments actually being traded.
 *
 * WHAT IT RETURNS IS NOT GICS, AND THE OUTPUT SAYS SO.
 * IBKR's `industry` / `category` / `subcategory` fields are IBKR's own taxonomy -- "Technology",
 * "Consumer, Cyclical", "Financial". They are not the GICS 11, they have a different cardinality,
 * and they split the economy along different lines. This script writes `scheme: "IBKR-industry"`
 * into the map and does NOT crosswalk to GICS. A crosswalk would be a pile of judgement calls
 * unverifiable against either vendor, and `sector-map.mjs` explains at length why that is refused.
 * A consistent partition is what the study needs; whose partition it is, is recorded rather than
 * laundered.
 *
 * TRANSPORT IS UNVERIFIED AGAINST A LIVE GATEWAY AS OF WRITING, and rule 12 says a mock is only
 * evidence if it emits what the real library emits. The three transport lessons in `ibkr-bars.mjs`
 * are reused via its `connect()` -- that part is proven. The `contractDetails` / `contractDetailsEnd`
 * pair below is NOT yet proven, and the first live run should be read as a test of this file as
 * much as of the account. The failure mode to watch for is the one `historicalDataEnd` had: an end
 * event that never fires, leaving every request to time out while holding complete data. If every
 * symbol reports "timeout" but the counts look plausible, suspect this file, not the Gateway.
 *
 * PACING. This makes one request per symbol, serially, with a delay between them. TWS throttles
 * bursts and the documented limits are widely misquoted, so the delay is conservative rather than
 * tuned, and `--delay` exists for the case where it proves too slow or too fast. Guessing a limit
 * and writing it down as fact is how a wrong constant becomes a trusted one.
 *
 * Usage:
 *   node scripts/ibkr-contract-details.mjs                 # all sp500-bundle symbols -> data/sector-map.json
 *   node scripts/ibkr-contract-details.mjs --out path.json --delay 250 --field category
 */
import fs from "node:fs";
import path from "node:path";
import { connect } from "../ibkr-bars.mjs";
import { availablePairs } from "../bundle-loader.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = flag("out", "data/sector-map.json");
const DELAY_MS = Number(flag("delay", 200));
const FIELD = flag("field", "industry");        // industry | category | subcategory
const ROOT = flag("root", "sp500-bundle");
const TIMEOUT_MS = Number(process.env.IBKR_TIMEOUT_MS) || 15000;

if (!["industry", "category", "subcategory"].includes(FIELD)) {
  console.error(`--field must be industry, category or subcategory (got "${FIELD}")`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One contract-details request. Resolves `{ ok, details, reason }`. Never throws on a request-level
 * failure -- a symbol the Gateway will not classify is recorded as unclassified, not guessed at.
 */
function fetchDetails({ api, ib }, contract, reqId) {
  const { EventName, isNonFatalError } = ib;
  return new Promise((resolve) => {
    const found = [];
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.contractDetails, onDetail);
      api.off(EventName.contractDetailsEnd, onEnd);
      api.off(EventName.error, onErr);
      clearTimeout(timer);
      resolve(v);
    };
    const onDetail = (rid, details) => { if (rid === reqId) found.push(details); };
    const onEnd = (rid) => { if (rid === reqId) finish({ ok: found.length > 0, details: found, reason: found.length ? "" : "no details returned" }); };
    const onErr = (err, code, rid) => {
      // Same lesson as ibkr-bars: the 2100-2999 data-farm band and "Warning:" strings are constant
      // noise, and killing a request on them loses good data. Match the id or ignore it.
      if (rid !== reqId) return;
      if (typeof isNonFatalError === "function" && isNonFatalError(code, err)) return;
      finish({ ok: false, details: [], reason: `${code}: ${String(err?.message ?? err)}` });
    };
    const timer = setTimeout(() => finish({ ok: false, details: [], reason: "timeout" }), TIMEOUT_MS);
    api.on(EventName.contractDetails, onDetail);
    api.on(EventName.contractDetailsEnd, onEnd);
    api.on(EventName.error, onErr);
    try { api.reqContractDetails(reqId, contract); }
    catch (e) { finish({ ok: false, details: [], reason: String(e?.message ?? e) }); }
  });
}

const symbols = availablePairs(1440, ROOT);
if (!symbols.length) {
  console.error(`no symbols under ${ROOT}. Nothing to classify.`);
  process.exit(2);
}

const conn = await connect();
if (!conn.status.connected) {
  console.error(`no Gateway: ${conn.status.error}`);
  console.error("This script needs IB Gateway up, the API enabled, and this host trusted.");
  console.error("Nothing was written and nothing was changed.");
  process.exit(1);
}
console.log(`connected. classifying ${symbols.length} symbols from ${ROOT} on field "${FIELD}".`);
console.log(`read-only, ${DELAY_MS}ms between requests.\n`);

const sectors = {};
const unclassified = [];
const ambiguous = [];
let reqId = 7000;

for (const sym of symbols) {
  const contract = { symbol: sym, secType: "STK", exchange: "SMART", currency: "USD" };
  const r = await fetchDetails(conn, contract, reqId++);
  await sleep(DELAY_MS);

  if (!r.ok) { unclassified.push([sym, r.reason]); continue; }

  // SMART can return several listings for one symbol. Take the field only if every listing agrees;
  // a symbol whose listings disagree is recorded as ambiguous rather than resolved by picking the
  // first, because "the first one TWS happened to send" is not a classification.
  const labels = [...new Set(r.details.map((d) => d?.[FIELD]).filter((v) => typeof v === "string" && v.trim()))];
  if (labels.length === 0) { unclassified.push([sym, `no ${FIELD} on ${r.details.length} listing(s)`]); continue; }
  if (labels.length > 1) { ambiguous.push([sym, labels]); continue; }
  sectors[sym] = labels[0].trim();
  process.stdout.write(`${sym.padEnd(6)} ${labels[0]}\n`);
}

try { conn.api.disconnect(); } catch { /* the socket may already be closed; not an error here */ }

const map = {
  scheme: FIELD === "industry" ? "IBKR-industry" : "IBKR-category",
  source: `IBKR reqContractDetails .${FIELD}, SMART/USD STK, via ${ROOT}`,
  asOf: new Date().toISOString().slice(0, 10),
  sectors,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");

const groups = new Map();
for (const v of Object.values(sectors)) groups.set(v, (groups.get(v) ?? 0) + 1);

console.log(`\nwrote ${OUT}`);
console.log(`classified ${Object.keys(sectors).length}/${symbols.length} into ${groups.size} groups:`);
for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${g.padEnd(28)} ${String(n).padStart(3)}`);
}
if (ambiguous.length) {
  console.log(`\n${ambiguous.length} ambiguous (listings disagree, left OUT of the map rather than resolved):`);
  for (const [s, l] of ambiguous) console.log(`  ${s}: ${l.join(" | ")}`);
}
if (unclassified.length) {
  console.log(`\n${unclassified.length} unclassified (left OUT of the map, not bucketed):`);
  for (const [s, why] of unclassified.slice(0, 20)) console.log(`  ${s}: ${why}`);
  if (unclassified.length > 20) console.log(`  ... and ${unclassified.length - 20} more`);
}
console.log(`\nNext: node mr04-run.mjs 2000 ${OUT}`);
console.log("MR04 will drop any name this map misses and any group under 3 members, and will say so.");
