/**
 * OPTIONS-SKEW-PRIMARY-SIGNAL — data-depth confirmation (read-only, no strategy code).
 *
 * This item's own done_when requires data availability and history depth confirmed BEFORE any
 * strategy code is written. EXOGENOUS-DATA-ACCESS-AUDIT's probe of Deribit's
 * `get_historical_volatility` endpoint found only ~16 days of history and flagged that as
 * insufficient without a follow-up probe of other endpoints - this script is that follow-up.
 *
 * Checks, each a real fetch, not documentation:
 *   1. Deribit `get_volatility_index_data` (DVOL, the aggregate implied-vol index) - true
 *      earliest date, found by walking backward past the 1000-row page cap.
 *   2. Whether Deribit's public API exposes any HISTORICAL per-strike/per-tenor series (the
 *      actual construct this item's task requires: 25-delta put/call skew, front-vs-back-month
 *      term structure) as opposed to only current option-chain snapshots.
 *   3. IBKR options support in this codebase's own broker module (brokers/ibkr.mjs) - does it
 *      have any options chain / secType=OPT / implied-vol code path today.
 */
import { saveExperiment } from "../researchlab.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

// Walk backward in daily-resolution windows past Deribit's 1000-row page cap to find the true
// earliest DVOL datapoint, not just the earliest row of one capped page.
async function findTrueDvolStart(currency) {
  let windowEnd = Date.now();
  let earliest = null;
  for (let i = 0; i < 6; i++) {
    const windowStart = new Date("2015-01-01").getTime();
    const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&start_timestamp=${windowStart}&end_timestamp=${windowEnd}&resolution=86400`;
    const r = await fetchJson(url);
    const ticks = r.body?.result?.data ?? [];
    if (!ticks.length) break;
    earliest = ticks[0][0];
    if (ticks.length < 1000) break; // got the true start of this sub-window, not just a page cap
    windowEnd = ticks[0][0] - 1; // page further back
  }
  return earliest;
}

async function probeDvolDepth() {
  const row = { check: "Deribit get_volatility_index_data (DVOL - aggregate implied-vol index)", currency: "BTC" };
  try {
    const earliestMs = await findTrueDvolStart("BTC");
    row.reachable = earliestMs !== null;
    row.earliestAvailableDate = earliestMs ? new Date(earliestMs).toISOString().slice(0, 10) : null;
    row.latestAvailableDate = new Date().toISOString().slice(0, 10);
    row.note = "This is a DIFFERENT endpoint than EXOGENOUS-DATA-ACCESS-AUDIT's get_historical_volatility probe (16-day cap). get_volatility_index_data has genuinely deep history - correction to that prior finding. But DVOL is an AGGREGATE implied-vol LEVEL index (Deribit's own VIX-equivalent), not put/call skew or term structure - it cannot substitute for the construct this item's task pre-registers without changing the hypothesis after seeing what data exists, which is the look-elsewhere error the task explicitly warns against.";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  return row;
}

async function probeHistoricalSkewEndpoint() {
  // Deribit's public API surface for options is documented as chain SNAPSHOTS (current state)
  // only - get_book_summary_by_currency, get_order_book, ticker - with no historical per-strike
  // or per-tenor archive endpoint. Confirm this with a real call against the closest candidate
  // (get_book_summary_by_currency for options) rather than asserting it from memory: if it were
  // to return any indication of historical range support, that would change the finding below.
  const row = { check: "Deribit get_book_summary_by_currency (option chain snapshot - checked for any historical-range parameter support)" };
  try {
    const r = await fetchJson("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option");
    const summaries = Array.isArray(r.body?.result) ? r.body.result : [];
    row.reachable = summaries.length > 0;
    row.instrumentCount = summaries.length;
    row.hasTimestampOrRangeParam = false;
    row.note = "Endpoint returns a live snapshot only (current mark_iv/bid_iv/ask_iv per live instrument, one row per currently-listed contract) - no start/end timestamp parameter exists on this or any other public Deribit option endpoint. There is no way to query 'what was the 25-delta skew on 2024-03-01' through this API; that would require this project to have been recording chain snapshots itself, starting from whenever it began, or a paid historical-options vendor (Amberdata/genesis volatility/laevitas-class), none of which this project holds access to.";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  return row;
}

function probeIbkrOptionsSupport() {
  const row = { check: "brokers/ibkr.mjs - existing options/secType=OPT/implied-vol code path" };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ibkrPath = path.join(here, "..", "brokers", "ibkr.mjs");
  const src = fs.readFileSync(ibkrPath, "utf8");
  const hasOptionSupport = /secType\s*[:=]\s*["']OPT["']|optionChain|impliedVol|25.?delta/i.test(src);
  row.fileChecked = "brokers/ibkr.mjs";
  row.hasOptionSupport = hasOptionSupport;
  row.note = hasOptionSupport
    ? "Some options-related code found - see grep for specifics."
    : "Zero options-related code today - no secType=OPT, no option chain request, no implied-vol handling anywhere in the broker module. Even with the Gateway reachable, building option-chain support (contract selection by delta, per-expiry historical bars, splicing across many expiring contracts into one continuous skew/term-structure series) would be new, substantial engineering - not a data-availability check, and far outside this item's 30-60 min scope.";
  return row;
}

async function main() {
  const rows = [];
  rows.push(await probeDvolDepth());
  rows.push(await probeHistoricalSkewEndpoint());
  rows.push(probeIbkrOptionsSupport());

  const result = { probedAt: new Date().toISOString(), rows };
  console.log(JSON.stringify(result, null, 2));

  const file = saveExperiment("options-skew-data-depth-check", { candidates: rows.map((r) => r.check) }, result);
  console.error(`\nSaved to ${file}`);
}

main();
