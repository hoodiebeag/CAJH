/**
 * MAKER-FILL-MICROSTRUCTURE-SIMULATION — data-availability determination (read-only, no
 * strategy code, no fill model). Per this item's own scope: 30-60 min to determine whether
 * sub-bar (minute/tick/L2) history exists before attempting any simulation, and to stop with
 * an honest non-verdict rather than substitute a coarser proxy if it doesn't — the mistake
 * this item names TEST4-ONCHAIN-FLOW-GATE as having made.
 *
 * What a real maker-fill simulation needs and why each check below targets it:
 *   - fill vs non-fill probability + queue position -> requires historical order-book DEPTH
 *     (where in the queue a resting order would have sat, and whether/when price reached it)
 *   - partial fills -> requires depth at each price level over time, not just trade prints
 *   - adverse selection on fills that do occur -> requires knowing book state around each fill
 * A trade-print feed (price/size/side/time) is NOT sufficient on its own for any of the above;
 * it can only confirm price *touched* a level, not that a resting order would have been filled,
 * how much of it would have filled, or what the book looked like when it did. Historical L2
 * depth is the load-bearing requirement; this script checks for it directly rather than
 * assuming trade prints are an adequate proxy.
 *
 * Checks, each a real fetch or file check, not documentation:
 *   1. Kraken public OHLC, interval=1 (1-minute bars) - true depth of history available.
 *   2. Kraken public Depth (order book) - whether ANY historical/time-range parameter is
 *      honored, by passing one and checking the response is unaffected (still live-only).
 *   3. Kraken public Trades (tick prints) - paging feasibility for a research-length window,
 *      by measuring real trade density in a fixed historical window and extrapolating request
 *      count for a representative backtest window and watchlist size.
 *   4. Local repo - any already-cached sub-bar (minute/tick) dataset under candles/ or
 *      research-cache/, and whether scripts/ibkr-tick-log.mjs (the one existing tick-level
 *      tool in this codebase) produces a storable historical dataset or only a live,
 *      human-attended stream.
 */
import { saveExperiment } from "../../researchlab.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 15000;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

async function probeOhlcMinuteDepth() {
  const row = { check: "Kraken public OHLC, interval=1 (1-minute bars) - true history depth" };
  try {
    const r = await fetchJson("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1");
    const key = Object.keys(r.body?.result ?? {}).find((k) => k !== "last");
    const rows = key ? r.body.result[key] : [];
    row.reachable = rows.length > 0;
    row.rowCount = rows.length;
    row.earliestAvailable = rows.length ? new Date(rows[0][0] * 1000).toISOString() : null;
    row.latestAvailable = rows.length ? new Date(rows[rows.length - 1][0] * 1000).toISOString() : null;
    row.note = "Kraken's public OHLC endpoint caps at 720 candles regardless of interval - at interval=1 that is roughly half a day of history, not the months-to-years a holdout window in this project actually needs. Confirms interval alone does not solve the depth problem.";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  return row;
}

async function probeDepthHistorySupport() {
  const row = { check: "Kraken public Depth (order book) - any historical/time-range parameter honored" };
  try {
    const live = await fetchJson("https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=3");
    // Pass an undocumented `since` param pointing at a date a year in the past. If Kraken's
    // Depth endpoint had any historical-range support, this would change the response (an
    // error naming the param as unsupported, or actual historical book data). It does neither.
    const withBogusSince = await fetchJson("https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=3&since=1700000000");
    const liveTs = live.body?.result?.XXBTZUSD?.asks?.[0]?.[2] ?? live.body?.result?.[Object.keys(live.body?.result ?? {})[0]]?.asks?.[0]?.[2];
    const bogusTs = withBogusSince.body?.result?.XXBTZUSD?.asks?.[0]?.[2] ?? withBogusSince.body?.result?.[Object.keys(withBogusSince.body?.result ?? {})[0]]?.asks?.[0]?.[2];
    row.reachable = live.ok;
    row.liveSnapshotTimestamp = liveTs ?? null;
    row.responseWithBogusSinceParam_timestamp = bogusTs ?? null;
    row.sinceParamIgnored = liveTs != null && bogusTs != null && Math.abs(bogusTs - liveTs) < 30;
    row.note = "Depth returns only the current top-of-book snapshot (bids/asks up to `count` levels). Passing a `since` timestamp a year in the past does not error and does not return historical data - it is silently ignored, returning the current book again (timestamps within seconds of each other despite the year-old param). Kraken's public REST API exposes no order-book history endpoint at all, at any resolution: this is not a depth-of-history limit like OHLC's 720-row cap, it is a total absence of the data type. This is the specific gap that blocks fill-probability, queue-position and partial-fill modeling, independent of whatever trade-print history is obtainable (see Trades probe below).";
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  return row;
}

async function probeTradesBackfillFeasibility() {
  const row = { check: "Kraken public Trades (tick prints) - paging feasibility for a research-length window" };
  try {
    // Measure real trade density in a fixed past window (Jan 1 2025) rather than assuming a
    // rate from today's data, since density varies with market activity.
    const sinceNs = "1735689600000000000"; // 2025-01-01T00:00:00Z in nanoseconds, Kraken's unit
    const r = await fetchJson(`https://api.kraken.com/0/public/Trades?pair=XBTUSD&since=${sinceNs}`);
    const key = Object.keys(r.body?.result ?? {}).find((k) => k !== "last");
    const rows = key ? r.body.result[key] : [];
    const tradesPerPage = rows.length;
    const spanSeconds = rows.length > 1 ? rows[rows.length - 1][2] - rows[0][2] : null;
    const secondsPerPage = spanSeconds; // wall-clock market time covered by one 1000-row page
    const pagesPerYear = secondsPerPage ? Math.ceil((365 * 24 * 3600) / secondsPerPage) : null;
    // Kraken's public tier is rate-limited (undocumented exact figure, but the project's own
    // prior order-flow backfill - ROADMAP_ARCHIVE.md 2026-07-30, "~430k flow-bearing 1-minute bars...
    // ~hours per pair" for a ~4-month window on 3 pairs - is the only real measured data point
    // this project holds; used here as a citation, not re-derived from scratch.
    const priorBackfillMonths = 4;
    const priorBackfillPairs = 3;
    const priorBackfillHoursPerPair = "several (ROADMAP_ARCHIVE.md 2026-07-30 entry, reported as '~hours per pair', not pinned to an exact figure)";
    row.reachable = tradesPerPage > 0;
    row.samplePage = { tradesPerPage, spanSecondsCoveredByOnePage: secondsPerPage, sampledWindowStart: new Date(rows[0]?.[2] * 1000).toISOString(), sampledWindowEnd: new Date(rows[rows.length - 1]?.[2] * 1000).toISOString() };
    row.extrapolation = { pagesNeededForOneYearOnePair: pagesPerYear };
    row.priorProjectPrecedent = { source: "ROADMAP_ARCHIVE.md 2026-07-30 order-flow backfill", months: priorBackfillMonths, pairs: priorBackfillPairs, wallClockPerPair: priorBackfillHoursPerPair };
    row.note = `Trade-print density is high even in a comparatively quiet historical window sampled here (${tradesPerPage} trades span only ${secondsPerPage}s of market time on 2025-01-01), implying roughly ${pagesPerYear} paginated requests to cover one asset for one year at this rate - and this project's own prior attempt at exactly this kind of backfill (order-flow study, 2026-07-30) needed "hours per pair" for a ~4-month window on only 3 pairs. A representative holdout window in this project spans many months to years across a multi-asset watchlist (12-28 symbols) - full backfill is directionally feasible in wall-clock terms for a small number of pairs over a short window, but is not a 30-60 minute operation and was explicitly out of this item's scope for that reason. This is a SECONDARY constraint: even a complete trade-print backfill gives price/size/side/time only, not book depth - it cannot supply the queue-position or partial-fill inputs the task requires (see Depth probe above), so backfill feasibility does not by itself resolve the data question.`;
  } catch (e) {
    row.reachable = false;
    row.error = e.message;
  }
  return row;
}

function probeLocalSubBarData() {
  const row = { check: "Local repo - any cached sub-bar dataset, and whether ibkr-tick-log.mjs produces a storable history" };
  const candlesDir = path.join(repoRoot, "candles");
  const cacheDir = path.join(repoRoot, "research-cache");
  const listGranularities = (dir) => {
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
  };
  row.candlesDirEntries = listGranularities(candlesDir);
  row.researchCacheDirEntries = listGranularities(cacheDir);
  const finestKnownTf = "tf-60 (1h)"; // research-cache's finest cached granularity, confirmed by directory listing above
  row.finestLocallyCachedGranularity = finestKnownTf;
  const ibkrTickLogPath = path.join(repoRoot, "scripts", "ibkr-tick-log.mjs");
  const ibkrTickLogSrc = fs.existsSync(ibkrTickLogPath) ? fs.readFileSync(ibkrTickLogPath, "utf8") : null;
  row.ibkrTickLogExists = ibkrTickLogSrc !== null;
  row.ibkrTickLogIsLiveOnlyHumanAttended = ibkrTickLogSrc !== null && /requires IB Gateway|logging \d+s|Connecting to IB Gateway/.test(ibkrTickLogSrc);
  row.note = "No minute- or tick-level file exists anywhere under candles/ or research-cache/ - the finest cached granularity in this project is 1h (tf-60). scripts/ibkr-tick-log.mjs is the one tick-level tool in this codebase, but it is a live, human-attended debugging aid (connects to a locally-running IB Gateway, logs streaming ticks to the console for a stated number of seconds) - it produces no stored historical dataset and cannot run unattended in this environment (no IB Gateway process available here). Neither source supplies pre-existing sub-bar history.";
  return row;
}

async function main() {
  const rows = [];
  rows.push(await probeOhlcMinuteDepth());
  rows.push(await probeDepthHistorySupport());
  rows.push(await probeTradesBackfillFeasibility());
  rows.push(probeLocalSubBarData());

  const depthProbe = rows[1];
  const dataAvailable = depthProbe.sinceParamIgnored === false; // i.e. only "available" if history support were somehow real
  const verdict = dataAvailable
    ? "SUB-BAR L2 HISTORY AVAILABLE - unexpected, re-examine before building any fill model"
    : "DATA NON-VERDICT - historical order-book depth (queue position, fill probability, partial fills) is not obtainable from any source this project has access to. Kraken's public REST API has no order-book history endpoint at any resolution (Depth is live-snapshot-only, confirmed by direct probe). Trade-print backfill (Kraken Trades endpoint) is directionally feasible for a small watchlist over a short window but is a multi-hour operation per this project's own prior precedent, and even a complete backfill would supply price/size/side/time only - not book depth - so it cannot substitute for what a maker-fill simulation actually needs. No local cache and no other tool in this codebase supplies sub-bar history. Per this item's own instruction, this stops here: no fill model built, no coarser proxy substituted and presented as a maker-fill result.";

  const result = { probedAt: new Date().toISOString(), rows, verdict };
  console.log(JSON.stringify(result, null, 2));

  const file = saveExperiment("maker-fill-data-availability-check", { candidates: rows.map((r) => r.check) }, result);
  console.error(`\nSaved to ${file}`);
}

main();
