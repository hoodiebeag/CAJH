/**
 * ibkr-bars.mjs — fetch daily bars from IB Gateway, read-only.
 *
 * This exists so the three transport lessons that cost six probe runs on 2026-09-03 are written
 * once instead of rediscovered per script:
 *
 *  1. HISTORICAL DATA COMPLETION IS SIGNALLED INSIDE THE STREAM. `@stoqey/ib` emits a final
 *     `historicalData` row whose `time` begins with "finished". There is a `historicalDataEnd`
 *     event and waiting on it does not work — every request sat until its timeout holding a
 *     complete set of bars, and was recorded as an error.
 *  2. NOT EVERY `error` EVENT IS FATAL. TWS emits the 2100-2999 data-farm band, 10090/10167 for
 *     delayed data, and "Warning:" strings constantly. Killing a request on those loses good data;
 *     ignoring the reqId means real rejections fall through to a timeout and every failure reports
 *     as the useless string "timeout". Use the package's own `isNonFatalError` and match the id.
 *  3. DAILY BARS ARRIVE AS "YYYYMMDD" STRINGS, NOT EPOCH SECONDS. TWS ignores `formatDate=2` for
 *     daily bar sizes. `brokers/ibkr.mjs` documents this and handles it; `Number("20240820")`
 *     parses as a tiny epoch in 1970 rather than throwing, so it corrupts silently. This matters
 *     more here than anywhere else: the variance-risk-premium study aligns an implied-volatility
 *     series against a price series BY DATE, and a silent date corruption would align them wrong
 *     and produce a confident, meaningless number.
 *
 * Read-only by construction: it requests historical data and nothing else. No order path exists
 * in this file.
 *
 * NOT YET SHARED WITH scripts/c1-c3-entitlement-probe.mjs, deliberately. That script's transport
 * is proven against a live gateway as of run 6 and its transport has no local test coverage, so
 * refactoring it blind would risk a working thing to remove duplication. Consolidate once this
 * module has also run against a real gateway.
 */

const HOST = process.env.IBKR_HOST || "127.0.0.1";
const PORT = Number(process.env.IBKR_PORT) || 4002;
const CLIENT_ID = Number(process.env.VRP_CLIENT_ID) || 78; // not the bot's 0, not the probe's 77
const TIMEOUT_MS = Number(process.env.IBKR_TIMEOUT_MS) || 60000;

/** "YYYYMMDD" -> UTC-midnight epoch seconds; passes real epochs through. Exported to be tested. */
export function barTimeToEpoch(raw) {
  const s = String(raw);
  if (/^\d{8}$/.test(s)) return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 1000;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "YYYY-MM-DD" for a bar, the key both series are aligned on. */
export const barDateKey = (raw) => new Date(barTimeToEpoch(raw) * 1000).toISOString().slice(0, 10);

export async function connect() {
  const ib = await import("@stoqey/ib");
  const { IBApi, EventName } = ib;
  const api = new IBApi({ host: HOST, port: PORT });
  const status = await new Promise((resolve) => {
    const done = (v) => { api.off(EventName.connected, ok); api.off(EventName.error, bad); resolve(v); };
    const ok = () => done({ connected: true });
    const bad = (e) => done({ connected: false, error: String(e?.message ?? e) });
    api.once(EventName.connected, ok);
    api.once(EventName.error, bad);
    setTimeout(() => done({ connected: false, error: `no response within ${TIMEOUT_MS}ms` }), TIMEOUT_MS);
    try { api.connect(CLIENT_ID); } catch (err) { done({ connected: false, error: String(err.message) }); }
  });
  return { api, ib, status };
}

/**
 * One daily-bar request. Resolves `{ ok, bars, reason }` where each bar is `{ date, time, close }`.
 * Never throws on a request-level failure — the caller decides what an incomplete series means.
 */
export function fetchDailyBars({ api, ib }, contract, duration, whatToShow, reqId) {
  const { EventName, BarSizeSetting, isNonFatalError } = ib;
  return new Promise((resolve) => {
    const bars = [];
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      api.off(EventName.historicalData, onBar);
      api.off(EventName.error, onErr);
      clearTimeout(timer);
      resolve(v);
    };
    const onBar = (rid, time, open, high, low, close) => {
      if (rid !== reqId) return;
      if (String(time).startsWith("finished")) return finish({ ok: true, bars });
      const epoch = barTimeToEpoch(time);
      const c = Number(close);
      if (epoch === null || !Number.isFinite(c)) return; // a malformed row is skipped, not guessed at
      bars.push({ date: barDateKey(time), time: epoch, close: c });
    };
    const onErr = (a, b, c) => {
      const e = (a instanceof Error)
        ? { id: -1, code: -1, message: a.message, error: a, socket: true }
        : { id: a, code: b, message: String(c ?? ""), error: new Error(String(c ?? "")), socket: false };
      if (!e.socket && e.id !== reqId) return;
      if (!e.socket && isNonFatalError(e.code, e.error)) return;
      finish({ ok: false, reason: `${e.code}: ${e.message}`, bars });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout", bars }), TIMEOUT_MS);
    api.on(EventName.historicalData, onBar);
    api.on(EventName.error, onErr);
    api.reqHistoricalData(reqId, contract, "", duration, BarSizeSetting.DAYS_ONE, whatToShow, 1, 2, false);
  });
}

/**
 * Inner-join two bar series on date.
 *
 * An inner join, not a zip. The implied-volatility series and the price series are separate
 * requests and are not guaranteed to cover identical sessions — a halt, a late IV publication or
 * a differing start date shifts one relative to the other. Zipping by index would silently pair
 * an IV quote with the wrong day's realised move, which is undetectable in the output and would
 * make every downstream number wrong in a way that still looks plausible.
 */
export function alignByDate(ivBars, priceBars) {
  const iv = new Map(ivBars.map((b) => [b.date, b.close]));
  const dates = [], ivCloses = [], priceCloses = [];
  for (const p of priceBars) {
    const v = iv.get(p.date);
    if (v === undefined) continue;
    dates.push(p.date); ivCloses.push(v); priceCloses.push(p.close);
  }
  return {
    dates, ivCloses, priceCloses,
    matched: dates.length, ivOnly: ivBars.length - dates.length, priceOnly: priceBars.length - dates.length,
  };
}
