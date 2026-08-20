/**
 * brokers/ibkr.mjs — real IBKR TWS/IB Gateway implementation of the broker
 * interface (see brokers/interface.md), via @stoqey/ib (a native TS/JS port
 * of the official TWS API socket protocol - not a wrapper around IBKR's own
 * Python/Java client).
 *
 * Every method/event signature used below was verified directly against the
 * installed package's TypeScript declarations and compiled decoder source
 * before being used here (not guessed, not from memory of the general TWS
 * API docs) - in particular:
 *   - reqHistoricalData's completion is NOT a separate event; the decoder
 *     (core/io/decoder.js, decodeMsg_HISTORICAL_DATA) emits one extra
 *     historicalData call after the real bars where `time` starts with the
 *     literal string "finished" and every numeric field is -1.
 *   - TickType.LAST === 4 is the "last traded price" field on tickPrice
 *     events (not BID/ASK/CLOSE).
 *   - reqAccountSummary's `tags` param takes literal strings like
 *     "TotalCashValue", not an enum.
 *
 * Connects lazily on first use and reuses the connection across calls,
 * mirroring trader.js's persistent Kraken client instance. Host/port default
 * to 127.0.0.1:4002 (IB Gateway's default PAPER port) - override via
 * IBKR_HOST/IBKR_PORT/IBKR_CLIENT_ID env vars. Deliberately defaults to
 * paper, not live: nothing here has been run against a real connection yet
 * (no network path from any automated session to a locally-run Gateway -
 * see the human/session discussion this was built from), so the safe
 * default is the one that can't place a real order even if something is
 * wrong with this code.
 *
 * placeBuy/placeSell only resolve once TWS reports the order Filled (never
 * on submission) - same hard requirement as trader.js's confirmBuyFill/
 * confirmSellFill, for the same reason: prevents phantom positions.
 */
import { IBApi, EventName, Stock, MarketOrder, OrderAction, WhatToShow, BarSizeSetting, isNonFatalError } from "@stoqey/ib";

/**
 * The error event is OVERLOADED by @stoqey/ib: request-scoped errors arrive as
 * (id, errorCode, errorMsg), but socket-level failures arrive as (error: Error).
 * Filtering on a numeric id silently swallows the latter. Normalizes both shapes.
 */
function parseErrorEvent(a, b, c) {
  if (a instanceof Error) return { id: -1, code: -1, message: a.message, error: a, socket: true };
  return { id: a, code: b, message: String(c ?? ""), error: new Error(String(c ?? "")), socket: false };
}

/**
 * TWS emits plenty of errors that are informational, not failures - the whole
 * 2100-2999 band (data-farm status), 10090/10167 (delayed/partial market data),
 * and anything prefixed "Warning:". The package ships the authoritative predicate
 * for this; treating every error as fatal is what made a benign data-farm notice
 * fail a connection and a benign order warning look like an unfilled order.
 */
const isFatal = (e) => e.socket || !isNonFatalError(e.code, e.error);

const HOST = process.env.IBKR_HOST || "127.0.0.1";
const PORT = Number(process.env.IBKR_PORT) || 4002; // 4002 = paper, 4001 = live
const CLIENT_ID = Number(process.env.IBKR_CLIENT_ID) || 0;
const CONNECT_TIMEOUT_MS = 15_000;
const ORDER_FILL_TIMEOUT_MS = 30_000;
const MKT_DATA_TIMEOUT_MS = 10_000;

let clientFactory = () => new IBApi({ host: HOST, port: PORT });
let client = null;
let connecting = null;
let nextReqId = 1;
const reqId = () => nextReqId++;

/** Test-only seam, mirrors trader.js's setKrakenApiForTests. */
export function setIBApiForTests(factory = null) {
  clientFactory = factory || (() => new IBApi({ host: HOST, port: PORT }));
  client = null;
  connecting = null;
  nextReqId = 1;
}

function getClient() {
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;
  const c = clientFactory();
  connecting = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`IBKR connect timed out after ${CONNECT_TIMEOUT_MS}ms (${HOST}:${PORT})`)); }, CONNECT_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); c.off(EventName.connected, onConnected); c.off(EventName.error, onError); };
    const onConnected = () => {
      cleanup();
      client = c;
      resolve(c);
    };
    // NOT `once`: TWS emits 2104/2106/2158 data-farm notices around connect time,
    // so a `once` listener would consume a benign notice and fail the connection
    // outright. Stay subscribed and reject only on a genuinely fatal error.
    const onError = (a, b, cc) => {
      const e = parseErrorEvent(a, b, cc);
      if (!isFatal(e)) return;
      cleanup();
      reject(new Error(`IBKR connect failed: ${e.code} ${e.message}`));
    };
    c.on(EventName.connected, onConnected);
    c.on(EventName.error, onError);
    c.connect(CLIENT_ID);
  }).finally(() => { connecting = null; });
  return connecting;
}

const stockContract = (symbol) => new Stock(symbol, "SMART", "USD");

/** Interval-in-minutes (matches trader.js's fetchOHLC(pair, minutes) convention) -> IBKR bar size + a duration chosen to return roughly as much history as Kraken's own default (~720 candles). */
function barSizeAndDuration(minutes) {
  if (minutes === 60) return { barSize: BarSizeSetting.HOURS_ONE, duration: "30 D" };
  if (minutes === 240) return { barSize: BarSizeSetting.HOURS_FOUR, duration: "120 D" };
  if (minutes === 1440) return { barSize: BarSizeSetting.DAYS_ONE, duration: "2 Y" };
  throw new Error(`IBKR fetchOHLC: unsupported interval ${minutes} minutes (only 60/240/1440 mapped)`);
}

async function fetchOHLC(pair, minutes) {
  const { barSize, duration } = barSizeAndDuration(minutes); // validate before touching the client
  let c;
  try { c = await getClient(); } catch { return null; }
  const id = reqId();
  return new Promise((resolve) => {
    const bars = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      c.off(EventName.historicalData, onBar);
      c.off(EventName.error, onError);
      resolve(result);
    };
    const onBar = (rid, time, open, high, low, close, volume) => {
      if (rid !== id) return;
      // The decoder constructs this marker itself, so it is a literal string
      // regardless of formatDate - check it before any numeric coercion.
      if (String(time).startsWith("finished")) return finish(bars);
      // formatDate=2 makes IBKR send epoch seconds for INTRADAY bar sizes, matching what
      // Kraken's fetchOHLC returns. But for DAILY/WEEKLY bar sizes, TWS ignores formatDate
      // and always sends a bare "YYYYMMDD" string (confirmed against a live Gateway with
      // BarSizeSetting.DAYS_ONE - this is a documented TWS API quirk, not a formatDate bug
      // in this file). Number("20240820") would silently parse as a tiny, wrong epoch value
      // (year-1970 territory) rather than throwing, so every downstream consumer doing
      // arithmetic on `time` - including backtest.js's `parseInt(candles[i].time)` - would
      // silently corrupt every daily candle's timestamp. Detect the date-only shape and
      // convert it to real UTC-midnight epoch seconds instead of trusting formatDate's
      // documented (but daily-bar-false) contract.
      const raw = String(time);
      const t = /^\d{8}$/.test(raw)
        ? Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8)) / 1000
        : Number(raw);
      bars.push({ time: t, open: String(open), high: String(high), low: String(low), close: String(close), volume: String(volume) });
    };
    const onError = (a, b, cc) => {
      const e = parseErrorEvent(a, b, cc);
      if (!e.socket && e.id !== id) return; // another request's error is not ours; socket failures are
      if (!isFatal(e)) return; // e.g. 10167/10090 - data is still coming
      finish(null);
    };
    c.on(EventName.historicalData, onBar);
    c.on(EventName.error, onError);
    //                                                          useRTH=1, formatDate=2 (epoch seconds)
    c.reqHistoricalData(id, stockContract(pair), "", duration, barSize, WhatToShow.TRADES, 1, 2, false);
  });
}

/**
 * Resolves {price, asOf, delayed}. `delayed` is true when IBKR served delayed
 * data because the account lacks a live subscription for the symbol - confirmed
 * against a real Gateway, where an unsubscribed symbol emits error 10167
 * ("Displaying delayed market data") and then every tick on the DELAYED_* fields,
 * never LAST.
 *
 * When delayed, `asOf` carries the REAL exchange timestamp (DELAYED_LAST_TIMESTAMP,
 * field 88), never Date.now(). This matters: a measured delayed quote was 804s old
 * against scanner.js's 10s MAX_ORDER_SNAPSHOT_AGE_MS, so stamping it with the
 * current time would launder a 13-minute-old price straight past isQuoteStale.
 * Reporting the true age lets that guard reject it, which is the correct outcome -
 * the price is still usable for research and monitoring, just not for an order.
 */
async function getCurrentPriceSnapshot(symbol, timeoutMs = MKT_DATA_TIMEOUT_MS) {
  const c = await getClient();
  const id = reqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    let delayedPrice = null; // held until its timestamp arrives (IB sends price first, then field 88)
    const cleanup = () => {
      clearTimeout(timer);
      c.off(EventName.tickPrice, onTick);
      c.off(EventName.tickString, onString);
      c.off(EventName.error, onError);
      c.cancelMktData(id); // every terminal path: an uncancelled request leaks a market-data line
    };
    const settle = (fn) => { if (settled) return; settled = true; cleanup(); fn(); };
    const timer = setTimeout(() => settle(() => reject(new Error(
      delayedPrice !== null
        ? `IBKR getCurrentPriceSnapshot for ${symbol}: delayed price ${delayedPrice} arrived but its DELAYED_LAST_TIMESTAMP never did - refusing to report an unknown quote age`
        : `IBKR getCurrentPriceSnapshot timed out for ${symbol}`
    ))), timeoutMs);
    const onTick = (rid, field, value) => {
      if (rid !== id || settled) return;
      if (field === 4 /* LAST - live */) return settle(() => resolve({ price: value, asOf: Date.now(), delayed: false }));
      if (field === 68 /* DELAYED_LAST */) delayedPrice = value; // wait for field 88 before resolving
    };
    const onString = (rid, field, value) => {
      if (rid !== id || settled || field !== 88 /* DELAYED_LAST_TIMESTAMP, epoch seconds */ || delayedPrice === null) return;
      const asOf = Number(value) * 1000;
      if (!Number.isFinite(asOf)) return;
      settle(() => resolve({ price: delayedPrice, asOf, delayed: true }));
    };
    const onError = (a, b, cc) => {
      const e = parseErrorEvent(a, b, cc);
      if (!e.socket && e.id !== id) return;
      if (!isFatal(e)) return; // 10167 means delayed data IS coming - not a failure
      settle(() => reject(new Error(`IBKR getCurrentPriceSnapshot failed for ${symbol}: ${e.code} ${e.message}`)));
    };
    c.on(EventName.tickPrice, onTick);
    c.on(EventName.tickString, onString);
    c.on(EventName.error, onError);
    c.reqMktData(id, stockContract(symbol), null, true /* snapshot */, false);
  });
}

async function getAccountBalanceSnapshot() {
  const c = await getClient();
  const id = reqId();
  return new Promise((resolve, reject) => {
    let balance = null;
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error("IBKR getAccountBalanceSnapshot timed out")); } }, MKT_DATA_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); c.off(EventName.accountSummary, onSummary); c.off(EventName.accountSummaryEnd, onEnd); c.cancelAccountSummary(id); };
    const onSummary = (rid, account, tag, value) => {
      if (rid !== id || tag !== "TotalCashValue") return;
      balance = parseFloat(value);
    };
    const onEnd = (rid) => {
      if (rid !== id || settled) return;
      settled = true;
      cleanup();
      if (!Number.isFinite(balance) || balance < 0) return reject(new Error("IBKR getAccountBalanceSnapshot: no valid TotalCashValue received"));
      resolve({ balance, asOf: Date.now() });
    };
    c.on(EventName.accountSummary, onSummary);
    c.on(EventName.accountSummaryEnd, onEnd);
    c.reqAccountSummary(id, "All", "TotalCashValue");
  });
}

/**
 * Places a market order and resolves ONLY once TWS reports it Filled - never
 * on submission. Mirrors trader.js's confirmBuyFill/confirmSellFill: a
 * thrown error here means "do not track this as a position", the same
 * phantom-position guard.
 */
function confirmedMarketOrder(action, symbol, quantity) {
  return getClient().then((c) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error(`IBKR order not confirmed filled within ${ORDER_FILL_TIMEOUT_MS}ms - do not track, reconcile manually`)); } }, ORDER_FILL_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); c.off(EventName.orderStatus, onStatus); c.off(EventName.error, onError); };
    let orderId = null;
    const onStatus = (oid, status, filled, remaining, avgFillPrice) => {
      if (orderId === null || oid !== orderId || settled) return;
      if (status === "Filled" && remaining === 0) {
        settled = true;
        cleanup();
        resolve({ symbol, side: action === OrderAction.BUY ? "buy" : "sell", volume: filled, price: avgFillPrice });
      } else if (status === "Cancelled" || status === "ApiCancelled") {
        settled = true;
        cleanup();
        reject(new Error(`IBKR order ${oid} was ${status} - nothing filled, not tracked`));
      }
    };
    // Highest-stakes error site in this file. A thrown error here means "do not
    // track this as a position", so misclassifying a benign warning on a genuinely
    // filled order produces exactly the untracked-real-position outcome the
    // confirmed-fill design exists to prevent. Non-fatal codes must not reject.
    const onError = (a, b, cc) => {
      const e = parseErrorEvent(a, b, cc);
      if (settled) return;
      if (!e.socket && (orderId === null || e.id !== orderId)) return;
      if (!isFatal(e)) return;
      settled = true;
      cleanup();
      reject(new Error(`IBKR order ${orderId} error: ${e.code} ${e.message}`));
    };
    c.on(EventName.orderStatus, onStatus);
    c.on(EventName.error, onError);
    c.once(EventName.nextValidId, (id) => {
      orderId = id;
      c.placeOrder(id, stockContract(symbol), new MarketOrder(action, quantity));
    });
    c.reqIds();
  }));
}

async function placeBuy({ symbol, capital, price }) {
  if (!(capital > 0) || !(price > 0)) throw new Error("IBKR placeBuy: capital and price must be finite and positive");
  const quantity = Math.floor(capital / price);
  if (quantity < 1) throw new Error(`IBKR placeBuy: computed quantity for ${symbol} is below 1 share`);
  return confirmedMarketOrder(OrderAction.BUY, symbol, quantity);
}

async function placeSell({ symbol, volume }) {
  if (!(volume > 0)) throw new Error("IBKR placeSell: volume must be finite and positive");
  return confirmedMarketOrder(OrderAction.SELL, symbol, volume);
}

/**
 * NOTE on interface fit: unlike Kraken's single pair-string identifiers,
 * IBKR contracts really need symbol+exchange+currency (a Contract object,
 * not a string) - every method above builds its own via stockContract()
 * rather than relying on this. This exists as the interface's required
 * display-id shape, not a functionally complete native identifier.
 */
const symbolToNativeId = (symbol) => symbol;

export const IBKRBroker = {
  fetchOHLC,
  getCurrentPriceSnapshot,
  getAccountBalanceSnapshot,
  placeBuy,
  placeSell,
  symbolToNativeId,
};
