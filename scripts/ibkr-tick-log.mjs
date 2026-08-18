/**
 * scripts/ibkr-tick-log.mjs — diagnostic for brokers/ibkr.mjs's
 * getCurrentPriceSnapshot timing out: run this locally, on the machine where
 * IB Gateway is running, to see every tick IBKR actually sends for a symbol.
 *
 * getCurrentPriceSnapshot only resolves on TickType.LAST (field 4) and
 * rejects after MKT_DATA_TIMEOUT_MS if it never arrives - which happens
 * whenever the account lacks a live trades subscription for that symbol,
 * even though bid/ask/delayed ticks may still be flowing fine. This script
 * requests streaming (non-snapshot) market data and logs every tickPrice/
 * tickSize/tickString/tickGeneric event with its TickType name, so you can
 * see what's actually arriving instead of guessing from a bare timeout.
 *
 * Read-only: only reqMktData/reqMarketDataType. No orders placed.
 *
 * Usage:
 *   node scripts/ibkr-tick-log.mjs [SYMBOL] [SECONDS]
 *
 * Defaults to AAPL, 15 seconds. Uses IBKR_HOST/IBKR_PORT/IBKR_CLIENT_ID env
 * vars if set, otherwise 127.0.0.1:4002 (paper).
 */
import { IBApi, EventName, Stock, TickType, MarketDataType } from "@stoqey/ib";

const symbol = process.argv[2] || "AAPL";
const seconds = Number(process.argv[3]) || 15;
const host = process.env.IBKR_HOST || "127.0.0.1";
const port = Number(process.env.IBKR_PORT) || 4002;
const clientId = Number(process.env.IBKR_CLIENT_ID) || 0;

const tickTypeName = (field) => TickType[field] || `UNKNOWN(${field})`;

console.log(`Connecting to IB Gateway at ${host}:${port} (symbol: ${symbol}, logging ${seconds}s)...\n`);

const ib = new IBApi({ host, port });
const reqId = 1;

ib.on(EventName.connected, () => {
  console.log("connected - requesting delayed data as a fallback in case live data isn't subscribed, then streaming ticks:\n");
  ib.reqMarketDataType(MarketDataType.DELAYED);
  ib.reqMktData(reqId, new Stock(symbol, "SMART", "USD"), null, false /* streaming, not snapshot */, false);
});

ib.on(EventName.tickPrice, (rid, field, value) => {
  if (rid !== reqId) return;
  console.log(`tickPrice  ${tickTypeName(field)} = ${value}`);
});
ib.on(EventName.tickSize, (rid, field, value) => {
  if (rid !== reqId) return;
  console.log(`tickSize   ${tickTypeName(field)} = ${value}`);
});
ib.on(EventName.tickString, (rid, field, value) => {
  if (rid !== reqId) return;
  console.log(`tickString ${tickTypeName(field)} = ${value}`);
});
ib.on(EventName.tickGeneric, (rid, field, value) => {
  if (rid !== reqId) return;
  console.log(`tickGeneric ${tickTypeName(field)} = ${value}`);
});
ib.on(EventName.error, (rid, errorCode, errorMsg) => {
  if (rid !== reqId && rid !== -1) return; // -1 = connection-level errors, still worth showing
  console.log(`error      ${errorCode} ${errorMsg}`);
});

setTimeout(() => {
  console.log(`\n${seconds}s elapsed - cancelling and disconnecting.`);
  ib.cancelMktData(reqId);
  ib.disconnect();
  process.exit(0);
}, seconds * 1000);
