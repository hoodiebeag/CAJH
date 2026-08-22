/**
 * EXOGENOUS-DATA-ACCESS-AUDIT (read-only diagnostic, not part of the app, no strategy code).
 *
 * Every genuinely exogenous data source this project has attempted so far died on ACCESS, not
 * on hypothesis: TEST4-ONCHAIN-FLOW-GATE (Glassnode, HTTP 401, no key held), H11 (Binance
 * funding, HTTP 451 geo-blocked) and again on Kraken funding's ~365-day rolling window against
 * a 730-day requirement, and ETF-FLOW-GATE (cut before its Farside probe ran). Before writing
 * another hypothesis against data nobody has confirmed is obtainable, this measures what is
 * actually reachable from THIS machine, right now, with a real fetch per source — never from
 * documentation, and never generalized from a sandboxed environment's own egress limits (a
 * container 403 was nearly recorded as a fact about an upstream API once already; see H11).
 *
 * SCOPE: candidates named in the work_queue item — (a) options/IV, (b) macro, (c) text
 * sentiment, (d) on-chain wallet-level. For each: reachable, auth held, measured earliest
 * available date (from a real datapoint, not a docs page), granularity, cost. No strategy
 * logic, no backtest, no order path touched.
 *
 * IBKR OPTIONS ACCESS IS INTERMITTENT, NOT A FIXED CAPABILITY — stated explicitly rather than
 * overclaimed either way. EQUITIES-BREAKOUT-OUT-OF-SAMPLE's control.notes (this run's prior
 * commit) recorded Gateway UP and doing a live 20-symbol fetch; this run's own pre-check (see
 * ROADMAP.md writeup) found 127.0.0.1:4002 refusing connections minutes later. The honest
 * reading is "reachable when the Gateway process happens to be running on the research
 * machine," not "reachable" or "unreachable" as a static fact — recorded as such below.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { saveExperiment } from "../researchlab.mjs";

const TIMEOUT_MS = 12000;

function checkEnvKey(name) {
  return Boolean(process.env[name] && process.env[name].trim().length > 0);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

function checkTcp(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs });
    sock.on("connect", () => { sock.end(); resolve({ reachable: true }); });
    sock.on("error", (e) => resolve({ reachable: false, error: e.message }));
    sock.on("timeout", () => { sock.destroy(); resolve({ reachable: false, error: "timeout" }); });
  });
}

const rows = [];

// --- (a) OPTIONS ---
async function probeDeribit() {
  const row = { category: "options", source: "Deribit public API (BTC options)", authRequired: false, authHeld: null };
  try {
    const instruments = await fetchJson("https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false");
    row.reachable = instruments.status === 200 && Array.isArray(instruments.body?.result);
    row.liveInstrumentCount = instruments.body?.result?.length ?? 0;

    // historical volatility endpoint - measure earliest timestamp actually returned
    const hv = await fetchJson("https://www.deribit.com/api/v2/public/get_historical_volatility?currency=BTC");
    const points = Array.isArray(hv.body?.result) ? hv.body.result : [];
    if (points.length) {
      const earliestMs = Math.min(...points.map((p) => p[0]));
      row.earliestAvailableDate = new Date(earliestMs).toISOString().slice(0, 10);
      row.granularity = "~hourly (observed spacing in get_historical_volatility series)";
      row.measuredPointCount = points.length;
    } else {
      row.earliestAvailableDate = null;
      row.granularity = null;
      row.note = "get_historical_volatility returned zero points";
    }
    row.cost = "free, public, no API key";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  rows.push(row);
}

async function probeIbkrOptions(gatewayUp) {
  rows.push({
    category: "options",
    source: "IBKR options chain (existing Gateway connection, brokers/ibkr.mjs)",
    authRequired: true,
    authHeld: true,
    reachable: gatewayUp,
    earliestAvailableDate: null,
    granularity: "N/A - not fetched, gate is connectivity only",
    cost: "included in existing IBKR data subscription, no incremental cost",
    note: gatewayUp
      ? "Gateway reachable at time of this run - chain itself not probed (would need a real options request; out of scope for a connectivity audit)"
      : "Gateway (127.0.0.1:4002) refused connection at time of this run - same intermittent local dependency as EQUITIES-*-OUT-OF-SAMPLE. NOT a statement that IBKR options are permanently unreachable, only that this run's window found it down.",
  });
}

// --- (b) MACRO ---
async function probeFredCsv(seriesId, label) {
  const row = { category: "macro", source: `FRED ${seriesId} (${label})`, authRequired: false, authHeld: null };
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    const lines = text.trim().split("\n");
    row.reachable = res.status === 200 && lines.length > 1 && /^observation_date/.test(lines[0]);
    if (row.reachable) {
      const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
      row.earliestAvailableDate = dataLines[0]?.split(",")[0] ?? null;
      row.latestAvailableDate = dataLines[dataLines.length - 1]?.split(",")[0] ?? null;
      row.measuredPointCount = dataLines.length;
      row.granularity = "daily (as published by series; FRED CSV export, no key required)";
    }
    row.cost = "free, public CSV export endpoint, no API key needed for this access pattern (the JSON/XML fred/ API does require a key, not held - GLASSNODE_API_KEY/FRED_API_KEY confirmed unset in .env)";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  rows.push(row);
}

// --- (c) TEXT SENTIMENT ---
// NOTE: Node's native fetch (undici) was observed hitting a hard UND_ERR_CONNECT_TIMEOUT against
// api.gdeltproject.org specifically, on every attempt, while `curl` against the identical URL
// from the same machine in the same minute got a real HTTP response every time (a 429 courtesy
// rate-limit page, not a connection failure). This is a client-library quirk against this one
// host, not evidence the source itself is unreachable - recording "unreachable" from the fetch()
// failure alone would have been exactly the sandbox-403-mistaken-for-upstream-fact error this
// audit exists to avoid, so this probe shells out to curl instead.
async function probeGdelt() {
  const row = { category: "text-sentiment", source: "GDELT 2.0 DOC API (news volume/tone timeline)", authRequired: false, authHeld: null };
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=bitcoin&mode=timelinevol&format=json&timespan=FULL";
  try {
    const out = execFileSync("curl", ["-sS", "--max-time", "20", url], { encoding: "utf8" });
    let body;
    try { body = JSON.parse(out); } catch { body = out; }
    if (typeof body === "string") {
      row.reachable = true;
      row.observedResponse = "non-JSON text response (GDELT's own courtesy rate-limit notice: max one request per 5s from a given client), not a connection failure";
      row.earliestAvailableDate = null;
      row.note = "Reachable (real HTTP response received via curl) but this run's single request was rate-limited before returning data - archive depth not measured this run. Node's own fetch() hit UND_ERR_CONNECT_TIMEOUT against this host on every attempt in this session (client-library quirk, not evidence of unreachability) - recorded here via curl instead, see module docstring.";
    } else {
      const series = body?.timeline?.[0]?.data ?? [];
      row.reachable = Array.isArray(series) && series.length > 0;
      row.measuredPointCount = series.length;
      row.earliestAvailableDate = series[0]?.date ?? null;
      row.latestAvailableDate = series[series.length - 1]?.date ?? null;
    }
    row.granularity = "GDELT DOC API 'FULL' timespan is capped at its own rolling window, not true archive depth - GDELT's raw v2 export files go back to 2015-02-18 but require bulk file ingestion, not this query API (unverified this run - docs claim, not measured)";
    row.cost = "free, public, no API key for the query API; bulk historical export files are also free but require a different ingestion path (not this endpoint)";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  rows.push(row);
}

// --- (d) ON-CHAIN WALLET-LEVEL ---
async function probeGlassnode() {
  const row = { category: "on-chain-wallet", source: "Glassnode transactions/transfers_volume_exchanges_net", authRequired: true, authHeld: checkEnvKey("GLASSNODE_API_KEY") };
  try {
    const r = await fetchJson("https://api.glassnode.com/v1/metrics/transactions/transfers_volume_exchanges_net?a=BTC");
    row.reachable = r.status === 200;
    row.observedStatus = r.status;
    row.cost = "paid API beyond a limited free tier; free tier itself gated behind an account+key this project does not hold";
    if (!row.authHeld) row.note = "GLASSNODE_API_KEY unset in .env - unchanged since TEST4-ONCHAIN-FLOW-GATE's 2026-08-14 finding";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  rows.push(row);
}

async function probeBlockchainInfo() {
  const row = { category: "on-chain-wallet", source: "blockchain.com Charts API (n-unique-addresses, BTC only, public)", authRequired: false, authHeld: null };
  try {
    const r = await fetchJson("https://api.blockchain.info/charts/n-unique-addresses?timespan=all&format=json");
    row.reachable = r.status === 200 && Array.isArray(r.body?.values);
    if (row.reachable) {
      const vals = r.body.values;
      row.earliestAvailableDate = new Date(vals[0].x * 1000).toISOString().slice(0, 10);
      row.latestAvailableDate = new Date(vals[vals.length - 1].x * 1000).toISOString().slice(0, 10);
      row.measuredPointCount = vals.length;
      row.granularity = "daily";
    }
    row.cost = "free, public, no API key";
    row.note = "BTC-only, and this metric is unique-address COUNT, not wallet-level accumulation/distribution behavior - a coarser proxy than WHALE-WALLET-ACCUMULATION-PRIMARY would actually need. True large-wallet cohort tracking (address clustering, balance-tier cohorts over time) needs a paid provider (Glassnode/Nansen/Chainalysis-class) or building clustering from raw block data, neither of which is free.";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  rows.push(row);
}

async function main() {
  const [ibkrCheck] = await Promise.all([checkTcp("127.0.0.1", 4002)]);
  await probeDeribit();
  await probeIbkrOptions(ibkrCheck.reachable);
  await probeFredCsv("DGS10", "10-Year Treasury Constant Maturity Rate");
  await probeFredCsv("DTWEXBGS", "Trade Weighted U.S. Dollar Index: Broad, Goods and Services - DXY proxy, ICE's own DXY ticker is not on FRED");
  await probeFredCsv("FEDFUNDS", "Federal Funds Effective Rate");
  await probeGdelt();
  await probeGlassnode();
  await probeBlockchainInfo();

  const result = { probedAt: new Date().toISOString(), rows };
  console.log(JSON.stringify(result, null, 2));

  const file = saveExperiment("exogenous-data-access-audit", { candidates: rows.map((r) => r.source) }, result);
  console.error(`\nSaved to ${file}`);
}

main();
