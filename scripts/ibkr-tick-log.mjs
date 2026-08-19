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
// NOTE: TickType must come from the subpath, not the package root. The root's
// index.d.ts declares `export type TickType = IBApiTickType | IBApiNextTickType`
// - a TYPE ALIAS with no runtime value - so importing it from "@stoqey/ib"
// throws "Named export 'TickType' not found" under ESM. The real enum (LAST=4,
// DELAYED_LAST=68) is only exported from this file. MarketDataType, by contrast,
// IS a real root export. This is also why brokers/ibkr.mjs uses the literal 4
// with a comment instead of importing the enum.
import { IBApi, EventName, Stock, MarketDataType } from "@stoqey/ib";
import { TickType } from "@stoqey/ib/dist/api/market/tickType.js";

const symbol = process.argv[2] || "AAPL";
const seconds = Number(process.argv[3]) || 15;
const host = process.env.IBKR_HOST || "127.0.0.1";
const port = Number(process.env.IBKR_PORT) || 4002;
const clientId = Number(process.env.IBKR_CLIENT_ID) || 0;

const tickTypeName = (field) => TickType[field] || `UNKNOWN(${field})`;

console.log(`Connecting to IB Gateway at ${host}:${port} (symbol: ${symbol}, logging ${seconds}s)...\n`);

const ib = new IBApi({ host, port });
const reqId = 1;

let connected = false;

ib.on(EventName.connected, () => {
  connected = true;
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
// @stoqey/ib overloads the error event: (id, errorCode, errorMsg) for
// request-scoped errors, but (error: Error) for socket-level failures. Filtering
// on a numeric reqId therefore SWALLOWS connection refusals - which is exactly
// how an earlier run printed nothing at all between "Connecting..." and the exit
// line. Never filter here: this is a diagnostic, so log every error verbatim.
ib.on(EventName.error, (a, b, c) => {
  if (a instanceof Error) console.log(`error      (socket) ${a.message}`);
  else console.log(`error      code=${b} reqId=${a} ${c}`);
});
ib.on(EventName.info, (msg) => console.log(`info       ${msg}`));
ib.on(EventName.disconnected, () => console.log("disconnected"));
ib.on(EventName.connectionClosed, () => console.log("connectionClosed"));

setTimeout(() => {
  if (!connected) {
    console.log(`\nNEVER CONNECTED after ${seconds}s.`);
    console.log("Checklist, in the order worth checking:");
    console.log(`  - Port: ${port} is IB Gateway PAPER. Gateway LIVE is 4001; TWS is 7497 paper / 7496 live.`);
    console.log("    Set IBKR_PORT to match whichever you are actually running.");
    console.log("  - Gateway: Configure > Settings > API > Settings > 'Enable ActiveX and Socket Clients' must be ticked.");
    console.log(`  - Trusted IPs: 127.0.0.1 must be listed there.`);
    console.log(`  - Client ID ${clientId} may already be in use by another connected session; try IBKR_CLIENT_ID=9.`);
  }
  console.log(`\n${seconds}s elapsed - cancelling and disconnecting.`);
  try { ib.cancelMktData(reqId); ib.disconnect(); } catch { /* never connected */ }
  process.exit(0);
}, seconds * 1000);
