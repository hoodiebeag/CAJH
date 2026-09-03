/**
 * scripts/c1-c3-entitlement-probe.mjs — resolves the account-side half of the C1 and C3 gates.
 *
 * WHY THIS EXISTS. `C1-VRP-DATA-AVAILABILITY-GATE` and `C3-FX-CARRY-DATA-GATE` both closed
 * "not a pass, not a fail": static analysis settled that the code and the installed `@stoqey/ib`
 * package can do the job, and both stopped at questions only a real connection can answer —
 * whether this account is actually entitled to option chains and historical implied volatility,
 * whether IDEALPRO FX bars return and how far back, and whether the non-USD FRED rate series
 * `C3` named from the OECD-MEI convention actually exist. This script asks exactly those
 * questions and nothing else.
 *
 * WHERE IT MUST RUN. On the machine with IB Gateway. Verified from the cloud session on
 * 2026-09-02: 127.0.0.1:4002 gives ECONNREFUSED and `fred.stlouisfed.org` is refused by the
 * egress policy, so neither half is answerable from there. That is why this is a script the
 * loop runs, not a result computed in a chat session.
 *
 * WHAT IT WILL NOT DO. It places no orders, cancels nothing, reads no account or position data,
 * and touches no file under `brokers/`. It builds its own contracts against `@stoqey/ib`
 * directly and connects on its own client id (default 77, `PROBE_CLIENT_ID` to override) so it
 * cannot collide with a running bot on client id 0. Every request is a historical-data or
 * contract-definition read.
 *
 * PRE-REGISTRATION. The gate below is written into `registry.mjs` BEFORE any probe runs, so the
 * thresholds cannot be adjusted to whatever comes back. Both mechanisms resolve independently:
 * one mechanism at a time, and C1's answer does not license starting C3.
 *
 * A FAIL HERE IS A RESULT, NOT A SETBACK. If the data is not there, the answer is to say so and
 * stop — `C1-VRP-DATA-AVAILABILITY-GATE` was explicit that a proxy must not be substituted
 * without disclosure. This script does not substitute one at all.
 */

import { pathToFileURL } from "url";
import { preregister, linkRun, findPreregistration } from "../registry.mjs";
import { saveExperiment } from "../researchlab.mjs";

/** Falsifiable thresholds, fixed here before any probe result exists. */
export const GATE = Object.freeze({
  c1: {
    underlyings: ["SPY", "QQQ"],
    // A short-premium study needs a chain to select strikes from and an IV history to measure
    // the premium against. Either alone is not enough to start building.
    minExpiries: 4,
    minStrikesPerExpiry: 10,
    minIvBars: 500, // ~2 trading years of daily implied-volatility bars
  },
  c3: {
    pairs: [["EUR", "USD"], ["GBP", "USD"], ["USD", "JPY"], ["AUD", "USD"]],
    minPairsWithBars: 3,
    minFxBars: 1000, // ~4 trading years of daily midpoint bars
    // The USD series is the control: it is already known reachable, so if it fails, the run
    // failed for a network reason and the non-USD answers mean nothing.
    controlSeries: "FEDFUNDS",
    series: {
      EUR: "IR3TIB01EZM156N", GBP: "IR3TIB01GBM156N", JPY: "IR3TIB01JPM156N",
      AUD: "IR3TIB01AUM156N", CAD: "IR3TIB01CAM156N", CHF: "IR3TIB01CHM156N",
    },
    minNonUsdSeries: 3,
    minSeriesObservations: 60, // 5 years of a monthly series
  },
});

export const PREREGISTRATION_ID = "C1-C3-ENTITLEMENT-PROBE";

export const PREREGISTRATION = Object.freeze({
  id: PREREGISTRATION_ID,
  kind: "data-availability-gate",
  hypothesis:
    "This IBKR account is entitled to the option-chain and historical-implied-volatility data a " +
    "defined-risk short-premium study (C1) requires, and to the IDEALPRO historical FX bars an FX " +
    "carry study (C3) requires; and the non-USD short-rate series C3 named from FRED's OECD-MEI " +
    "convention exist and carry enough history to compute a rate differential.",
  gate:
    "C1 AVAILABLE iff, for at least one of SPY/QQQ, the chain enumerates >= 4 expiries with >= 10 " +
    "strikes each AND >= 500 daily OPTION_IMPLIED_VOLATILITY bars return. C3 AVAILABLE iff >= 3 of " +
    "the four listed pairs each return >= 1000 daily MIDPOINT bars AND >= 3 non-USD FRED series " +
    "each resolve with >= 60 observations, with FEDFUNDS resolving as the network control. " +
    "Anything else is UNAVAILABLE for that mechanism. No proxy may be substituted for a missing " +
    "series, and neither mechanism's result licenses starting the other.",
  universe: ["SPY", "QQQ", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD"],
  timeSplit: { note: "Not applicable: this is a data-availability probe, not a study of returns." },
  symbolSplit: { note: "Not applicable: no trades are simulated and no holdout is consumed." },
  costAssumptions: { note: "Not applicable: nothing is priced. No cost model is used or implied." },
  seed: 20260902,
  notes: "Read-only probe. No orders. Does not touch brokers/ibkr.mjs. Sealed pool untouched.",
});

const HOST = process.env.IBKR_HOST || "127.0.0.1";
const PORT = Number(process.env.IBKR_PORT) || 4002;
const CLIENT_ID = Number(process.env.PROBE_CLIENT_ID) || 77;
const REQUEST_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 30000;

/** FRED's CSV export: first line is a header, each later line is `date,value`; "." means no
 *  observation for that period, which FRED emits routinely and which is not a parse failure. */
export function parseFredCsv(text) {
  const lines = String(text).trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, reason: "no data rows", observations: 0 };
  const rows = lines.slice(1)
    .map((l) => l.split(","))
    .filter((c) => c.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(c[0].trim()) && c[1].trim() !== ".");
  if (!rows.length) return { ok: false, reason: "no usable observations", observations: 0 };
  return {
    ok: true,
    observations: rows.length,
    first: rows[0][0].trim(),
    last: rows[rows.length - 1][0].trim(),
  };
}

/**
 * Decide each mechanism independently from the raw probe output.
 *
 * Pure, so it is testable without a gateway or egress — and so the thresholds are checked by
 * the same code path whether the data came from a real probe or a fixture.
 */
export function evaluateGate(probe, gate = GATE) {
  const c1Reasons = [], c3Reasons = [];

  let c1 = "UNAVAILABLE";
  if (probe.ibkr?.connected !== true) {
    c1 = "BLOCKED";
    c1Reasons.push(`no IB Gateway connection: ${probe.ibkr?.error ?? "not attempted"}`);
  } else {
    const legs = (probe.c1?.underlyings ?? []).map((u) => {
      const expiries = (u.expiries ?? []).filter((e) => (e.strikes ?? 0) >= gate.c1.minStrikesPerExpiry);
      const enough = expiries.length >= gate.c1.minExpiries && (u.ivBars ?? 0) >= gate.c1.minIvBars;
      // A request that errored or timed out having returned NOTHING did not answer the
      // question. Scoring it as UNAVAILABLE would put "this account cannot enumerate option
      // chains" on the record when all that happened was a request that never completed --
      // the same absence-of-evidence-is-not-evidence-of-absence line the FRED network control
      // exists to hold, applied to the IBKR side where it was originally missed.
      const inconclusive = !!u.error && expiries.length === 0 && (u.ivBars ?? 0) === 0;
      c1Reasons.push(inconclusive
        ? `${u.symbol}: request did not complete (${u.error}) and returned nothing -- inconclusive, not a finding about entitlement`
        : `${u.symbol}: ${expiries.length} qualifying expiries (need ${gate.c1.minExpiries}), ` +
          `${u.ivBars ?? 0} IV bars (need ${gate.c1.minIvBars})` + (u.error ? ` [partial: ${u.error}]` : ""));
      return { enough, inconclusive };
    });
    if (legs.some((l) => l.enough)) c1 = "AVAILABLE";
    else if (legs.length === 0 || legs.every((l) => l.inconclusive)) c1 = "BLOCKED";
    else c1 = "UNAVAILABLE";
  }

  let c3 = "UNAVAILABLE";
  const fxPairs = probe.c3?.pairs ?? [];
  const fxOk = fxPairs.filter((p) => (p.bars ?? 0) >= gate.c3.minFxBars);
  // Bars that arrived are affirmative evidence however the request ended; a pair that returned
  // nothing AND errored is inconclusive rather than unavailable.
  const fxInconclusive = fxPairs.filter((p) => !!p.error && (p.bars ?? 0) === 0);
  const control = probe.c3?.control;
  const nonUsdOk = (probe.c3?.series ?? []).filter((s) => s.ok && (s.observations ?? 0) >= gate.c3.minSeriesObservations);
  // Say "not attempted" rather than "0 of 4", which reads like four requests that came back
  // empty when in fact none was ever made. A reason line that overstates what was tested is the
  // same defect as a verdict that overstates what was found.
  c3Reasons.push((probe.c3?.pairs ?? []).length === 0
    ? `FX pairs not attempted (need ${gate.c3.minPairsWithBars} of ${gate.c3.pairs.length} at >= ${gate.c3.minFxBars} bars)`
    : `${fxOk.length} of ${(probe.c3?.pairs ?? []).length} pairs returned >= ${gate.c3.minFxBars} bars (need ${gate.c3.minPairsWithBars})`);
  c3Reasons.push(`${nonUsdOk.length} non-USD series resolved with >= ${gate.c3.minSeriesObservations} observations (need ${gate.c3.minNonUsdSeries})`);
  if (probe.ibkr?.connected !== true) {
    c3 = "BLOCKED";
    c3Reasons.push(`no IB Gateway connection: ${probe.ibkr?.error ?? "not attempted"}`);
  } else if (!control?.ok) {
    // Without the control there is no way to tell "this series does not exist" from "this
    // machine cannot reach FRED", and reporting the first when it is the second would put a
    // false fact on the record.
    c3 = "BLOCKED";
    c3Reasons.push(`network control ${gate.c3.controlSeries} did not resolve (${control?.reason ?? "not attempted"}); non-USD answers are uninterpretable`);
  } else {
    if (fxOk.length >= gate.c3.minPairsWithBars && nonUsdOk.length >= gate.c3.minNonUsdSeries) {
      c3 = "AVAILABLE";
    } else if (fxPairs.length > 0 && fxInconclusive.length === fxPairs.length) {
      c3 = "BLOCKED";
      c3Reasons.push("every FX request errored having returned nothing -- inconclusive, not a finding about entitlement");
    } else {
      c3 = "UNAVAILABLE";
    }
  }

  return {
    c1: { verdict: c1, reasons: c1Reasons },
    c3: { verdict: c3, reasons: c3Reasons },
    // Stated rather than left to a reader: an AVAILABLE here means the data exists, and nothing
    // more. It is not a signal, not an edge, and not permission to skip a pre-registered study.
    meaning: "AVAILABLE means the data exists and a study could be built. It is not a result about returns.",
  };
}

async function fetchFred(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return { id: seriesId, ok: false, reason: `HTTP ${res.status}` };
    return { id: seriesId, ...parseFredCsv(await res.text()) };
  } catch (err) {
    return { id: seriesId, ok: false, reason: `fetch failed: ${err.message}` };
  }
}

/** Everything that needs a live gateway, isolated so the rest of the file loads without one. */
async function probeIbkr() {
  const ib = await import("@stoqey/ib");
  const { IBApi, EventName, Option, Forex, Stock, WhatToShow, BarSizeSetting } = ib;
  const api = new IBApi({ host: HOST, port: PORT });
  let nextId = 9000;
  const reqId = () => nextId++;

  const connected = await new Promise((resolve) => {
    const done = (v) => { api.off(EventName.connected, onOk); api.off(EventName.error, onErr); resolve(v); };
    const onOk = () => done({ connected: true });
    const onErr = (e) => done({ connected: false, error: String(e?.message ?? e) });
    api.once(EventName.connected, onOk);
    api.once(EventName.error, onErr);
    setTimeout(() => done({ connected: false, error: `no response within ${REQUEST_TIMEOUT_MS}ms` }), REQUEST_TIMEOUT_MS);
    try { api.connect(CLIENT_ID); } catch (err) { done({ connected: false, error: String(err.message) }); }
  });
  if (!connected.connected) return { ibkr: connected, c1: null, fx: null };

  /**
   * Run one request and collect its rows.
   *
   * `onRow(id, push, finish)` registers the data listener and returns its remover, so every
   * listener is torn down when the request settles. Leaking one per request was harmless here
   * only because each checks its own request id.
   */
  const collect = (start, onRow, endEvent) => new Promise((resolve) => {
    const id = reqId();
    const acc = [];
    let settled = false, removeRow = () => {};
    const finish = (v) => {
      if (settled) return;
      settled = true;
      removeRow();
      if (endEvent) api.off(endEvent, onEnd);
      api.off(EventName.error, onErr);
      clearTimeout(timer);
      resolve(v);
    };
    const onEnd = () => finish({ ok: true, rows: acc });
    const onErr = (a, b, c) => { if (a === id || b === id) finish({ ok: false, reason: String(c ?? b ?? a), rows: acc }); };
    removeRow = onRow(id, (row) => acc.push(row), finish);
    if (endEvent) api.on(endEvent, onEnd);
    api.on(EventName.error, onErr);
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout", rows: acc }), REQUEST_TIMEOUT_MS);
    start(id);
  });

  /**
   * Historical bars. Completion is signalled INSIDE the historicalData stream, as a row whose
   * `time` begins with "finished" -- not by a separate historicalDataEnd event. This is the same
   * quirk `brokers/ibkr.mjs`'s own fetchOHLC already handles; the first version of this probe
   * waited on historicalDataEnd instead, so every FX request sat until its 30s timeout and was
   * recorded with error:"timeout" despite having received all 1297 of its bars. Reusing the
   * house pattern rather than re-deriving it is the whole point of it being written down.
   */
  const histBars = (contract, duration, whatToShow) => collect(
    (id) => api.reqHistoricalData(id, contract, "", duration, BarSizeSetting.DAYS_ONE, whatToShow, 1, 2, false),
    (id, push, finish) => {
      let seen = 0;
      const h = (rid, time) => {
        if (rid !== id) return;
        if (String(time).startsWith("finished")) return finish({ ok: true, count: seen });
        seen++;
        push(time);
      };
      api.on(EventName.historicalData, h);
      return () => api.off(EventName.historicalData, h);
    },
    null,
  );

  /**
   * Resolve a stock's IBKR contract id.
   *
   * reqSecDefOptParams's last argument is the UNDERLYING CONTRACT ID, and the first version of
   * this probe passed a literal 0. That is why SPY and QQQ came back with zero expiries on
   * 2026-09-03 -- the request was malformed, not the account unentitled. The chain cannot be
   * enumerated without the real conId, so it is looked up first.
   */
  const conIdFor = async (symbol) => {
    const r = await collect(
      (id) => api.reqContractDetails(id, new Stock(symbol, "SMART", "USD")),
      (id, push) => {
        const h = (rid, details) => { if (rid === id && details?.contract?.conId) push(details.contract.conId); };
        api.on(EventName.contractDetails, h);
        return () => api.off(EventName.contractDetails, h);
      },
      EventName.contractDetailsEnd,
    );
    return { conId: r.rows?.[0] ?? null, error: r.ok ? null : r.reason };
  };

  const underlyings = [];
  for (const symbol of GATE.c1.underlyings) {
    const { conId, error: conIdError } = await conIdFor(symbol);
    if (!conId) {
      underlyings.push({ symbol, expiries: [], ivBars: 0, error: conIdError ?? "no contract id returned" });
      continue;
    }
    const chain = await collect(
      (id) => api.reqSecDefOptParams(id, symbol, "", "STK", conId),
      (id, push) => {
        const h = (rid, exchange, _u, _t, _m, expirations, strikes) => {
          if (rid !== id) return;
          for (const e of expirations ?? []) {
            push({ expiry: e, strikes: (strikes ?? []).length, strikeList: strikes ?? [], exchange });
          }
        };
        api.on(EventName.securityDefinitionOptionParameter, h);
        return () => api.off(EventName.securityDefinitionOptionParameter, h);
      },
      EventName.securityDefinitionOptionParameterEnd,
    );
    const expiries = dedupeExpiries(chain.rows ?? []);
    let ivBars = 0, error = chain.ok ? null : chain.reason;
    const first = expiries[0];
    if (first?.strike) {
      const iv = await histBars(
        new Option(symbol, first.expiry, first.strike, "C"), "2 Y", WhatToShow.OPTION_IMPLIED_VOLATILITY);
      ivBars = iv.count ?? iv.rows?.length ?? 0;
      if (!iv.ok) error = iv.reason;
    } else if (!error && expiries.length) {
      error = "chain enumerated but carried no strike to price an IV series against";
    }
    underlyings.push({ symbol, conId, expiries, ivBars, error });
  }

  const pairs = [];
  for (const [base, quote] of GATE.c3.pairs) {
    const bars = await histBars(new Forex(base, quote), "5 Y", WhatToShow.MIDPOINT);
    pairs.push({ pair: `${base}${quote}`, bars: bars.count ?? bars.rows?.length ?? 0, error: bars.ok ? null : bars.reason });
  }

  try { api.disconnect(); } catch { /* already gone */ }
  return { ibkr: connected, c1: { underlyings }, fx: pairs };
}

/**
 * One entry per expiry, carrying the widest strike list seen and one concrete strike to price an
 * IV series against.
 *
 * The strike matters: the first version left it null, so the IV request was built as
 * `new Option(symbol, expiry, null, "C")` and could never have returned bars even against a
 * fully entitled account. The median of the listed strikes is used as a cheap at-the-money
 * proxy -- an exact ATM strike would need a spot quote, which is a market-data subscription
 * question this probe is deliberately not asking.
 */
function dedupeExpiries(rows) {
  const byExpiry = new Map();
  for (const r of rows) {
    const strikes = Array.isArray(r.strikeList) ? r.strikeList : [];
    const prev = byExpiry.get(r.expiry);
    if (!prev || r.strikes > prev.strikes) {
      const sorted = [...strikes].sort((a, b) => a - b);
      byExpiry.set(r.expiry, {
        expiry: r.expiry,
        strikes: r.strikes,
        strike: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        exchange: r.exchange,
      });
    }
  }
  return [...byExpiry.values()].sort((a, b) => a.expiry.localeCompare(b.expiry));
}

async function main() {
  if (!findPreregistration(PREREGISTRATION_ID)) preregister(PREREGISTRATION);

  const { ibkr, c1, fx } = await probeIbkr();
  const control = await fetchFred(GATE.c3.controlSeries);
  const series = [];
  for (const [ccy, id] of Object.entries(GATE.c3.series)) series.push({ currency: ccy, ...(await fetchFred(id)) });

  const probe = { ibkr, c1, c3: { pairs: fx ?? [], control, series } };
  const result = { probe, gate: evaluateGate(probe) };
  const file = saveExperiment("c1-c3-entitlement-probe", { parameters: GATE }, result);
  linkRun(PREREGISTRATION_ID, {
    runFile: file,
    verdict: `C1 ${result.gate.c1.verdict} / C3 ${result.gate.c3.verdict}`,
    resultSummary: { c1: result.gate.c1.verdict, c3: result.gate.c3.verdict, connected: ibkr.connected },
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(`\nC1: ${result.gate.c1.verdict}\nC3: ${result.gate.c3.verdict}\nrun: ${file}`);
  // Printed because a run's ledger entries were destroyed by an uncommitted-then-reset working
  // tree on 2026-09-03. The append is only as durable as the next git command.
  console.error(
    "\nCOMMIT research-registry/ledger.jsonl NOW. This run appended to it, and an uncommitted\n" +
    "entry is destroyed by git reset --hard or git checkout -- like any other change.",
  );
}

/**
 * Is this module being run directly, rather than imported by a test?
 *
 * The obvious form — comparing `import.meta.url` against `` `file://${process.argv[1]}` `` —
 * is silently false on Windows, where argv[1] is a backslash path like `C:\\cajh\\scripts\\x.mjs`
 * while `import.meta.url` is `file:///C:/cajh/scripts/x.mjs`. The guard never matched, so
 * `main()` never ran on the one machine that can actually reach IB Gateway, and the script
 * exited silently with status 0. Caught by HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK, 2026-09-02.
 * `pathToFileURL` does the platform-correct conversion, producing exactly the form
 * `import.meta.url` already carries on both platforms.
 */
export function isDirectRun(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
