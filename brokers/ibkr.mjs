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
import { IBApi, EventName, Stock, MarketOrder, OrderAction, WhatToShow, BarSizeSetting } from "@stoqey/ib";

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
    const timer = setTimeout(() => reject(new Error(`IBKR connect timed out after ${CONNECT_TIMEOUT_MS}ms (${HOST}:${PORT})`)), CONNECT_TIMEOUT_MS);
    c.once(EventName.connected, () => {
      clearTimeout(timer);
      client = c;
      resolve(c);
    });
    c.once(EventName.error, (id, errorCode, errorMsg) => {
      clearTimeout(timer);
      reject(new Error(`IBKR connect failed: ${errorCode} ${errorMsg}`));
    });
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
      if (String(time).startsWith("finished")) return finish(bars);
      bars.push({ time, open: String(open), high: String(high), low: String(low), close: String(close), volume: String(volume) });
    };
    const onError = (rid, errorCode, errorMsg) => {
      if (rid !== id) return; // IB emits plenty of non-fatal, non-request-scoped error events (market data farm status etc.) - only this request's own errors are fatal here
      finish(null);
    };
    c.on(EventName.historicalData, onBar);
    c.on(EventName.error, onError);
    c.reqHistoricalData(id, stockContract(pair), "", duration, barSize, WhatToShow.TRADES, 1, 1, false);
  });
}

async function getCurrentPriceSnapshot(symbol) {
  const c = await getClient();
  const id = reqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; c.off(EventName.tickPrice, onTick); c.off(EventName.error, onError); reject(new Error(`IBKR getCurrentPriceSnapshot timed out for ${symbol}`)); } }, MKT_DATA_TIMEOUT_MS);
    const onTick = (rid, field, value) => {
      if (rid !== id || field !== 4 /* TickType.LAST, verified above */ || settled) return;
      settled = true;
      clearTimeout(timer);
      c.off(EventName.tickPrice, onTick);
      c.off(EventName.error, onError);
      c.cancelMktData(id);
      resolve({ price: value, asOf: Date.now() });
    };
    const onError = (rid, errorCode, errorMsg) => {
      if (rid !== id || settled) return;
      settled = true;
      clearTimeout(timer);
      c.off(EventName.tickPrice, onTick);
      c.off(EventName.error, onError);
      reject(new Error(`IBKR getCurrentPriceSnapshot failed for ${symbol}: ${errorCode} ${errorMsg}`));
    };
    c.on(EventName.tickPrice, onTick);
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
    const onError = (oid, errorCode, errorMsg) => {
      if (orderId === null || oid !== orderId || settled) return;
      settled = true;
      cleanup();
      reject(new Error(`IBKR order ${oid} error: ${errorCode} ${errorMsg}`));
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
