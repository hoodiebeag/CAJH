import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { EventName, OrderAction } from "@stoqey/ib";

import { IBKRBroker, setIBApiForTests } from "./ibkr.mjs";

/** Minimal mock of @stoqey/ib's IBApi: a real EventEmitter plus no-op stubs
 * for every method these adapters call, driven manually per test by emitting
 * the same events the real decoder would (verified against its actual
 * source - see ibkr.mjs's top comment). */
function mockClient() {
  const c = new EventEmitter();
  c.connect = () => { queueMicrotask(() => c.emit(EventName.connected)); return c; };
  c.reqHistoricalData = () => c;
  c.reqMktData = () => c;
  c.cancelMktData = () => c;
  c.reqAccountSummary = () => c;
  c.cancelAccountSummary = () => c;
  c.reqIds = () => { queueMicrotask(() => c.emit(EventName.nextValidId, 1)); return c; };
  c.placeOrder = () => c;
  return c;
}

test.afterEach(() => setIBApiForTests());

test("fetchOHLC resolves with bars once the decoder's finished-marker call arrives, converted to trader.js's string shape", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.fetchOHLC("AAPL", 60);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.historicalData, 1, "20260101", 100, 105, 99, 104, 1000);
  c.emit(EventName.historicalData, 1, "20260102", 104, 106, 103, 105, 1200);
  c.emit(EventName.historicalData, 1, "finished-20260101-20260102", -1, -1, -1, -1, -1);
  assert.deepEqual(await promise, [
    { time: "20260101", open: "100", high: "105", low: "99", close: "104", volume: "1000" },
    { time: "20260102", open: "104", high: "106", low: "103", close: "105", volume: "1200" },
  ]);
});

test("fetchOHLC resolves null on a request-scoped error, not on an unrelated reqId's error", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.fetchOHLC("AAPL", 60);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.error, 999, 200, "unrelated request error");
  c.emit(EventName.error, 1, 200, "No security definition has been found");
  assert.equal(await promise, null);
});

test("fetchOHLC rejects synchronously (throws) for an unmapped interval, before ever touching the client", async () => {
  await assert.rejects(() => IBKRBroker.fetchOHLC("AAPL", 17), /unsupported interval/);
});

test("getCurrentPriceSnapshot resolves on the LAST tick field (TickType 4), ignoring BID/ASK ticks", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL");
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.tickPrice, 1, 1 /* BID */, 149.5);
  c.emit(EventName.tickPrice, 1, 4 /* LAST */, 150.25);
  const snap = await promise;
  assert.equal(snap.price, 150.25);
  assert.ok(Number.isFinite(snap.asOf));
});

test("getAccountBalanceSnapshot resolves the parsed TotalCashValue once accountSummaryEnd fires", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getAccountBalanceSnapshot();
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.accountSummary, 1, "DU12345", "TotalCashValue", "8421.55", "USD");
  c.emit(EventName.accountSummaryEnd, 1);
  assert.deepEqual(await promise, { balance: 8421.55, asOf: (await promise).asOf });
});

test("getAccountBalanceSnapshot rejects if accountSummaryEnd fires with no valid TotalCashValue seen", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getAccountBalanceSnapshot();
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.accountSummaryEnd, 1);
  await assert.rejects(() => promise, /no valid TotalCashValue/);
});

test("placeBuy only resolves once orderStatus reports Filled with remaining=0 - not on submission alone", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.placeBuy({ symbol: "AAPL", capital: 1000, price: 100 });
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.orderStatus, 1, "Submitted", 0, 10, 0);
  let resolved = false;
  promise.then(() => { resolved = true; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(resolved, false, "must not resolve on a non-Filled status");
  c.emit(EventName.orderStatus, 1, "Filled", 10, 0, 100.05);
  const fill = await promise;
  assert.equal(fill.symbol, "AAPL");
  assert.equal(fill.side, "buy");
  assert.equal(fill.volume, 10);
  assert.equal(fill.price, 100.05);
});

test("placeSell rejects (does not resolve a fake fill) if the order is Cancelled", async () => {
  const c = mockClient();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.placeSell({ symbol: "AAPL", volume: 10 });
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.orderStatus, 1, "Cancelled", 0, 10, 0);
  await assert.rejects(() => promise, /Cancelled/);
});

test("placeBuy rejects on non-positive capital/price without ever contacting the client", async () => {
  await assert.rejects(() => IBKRBroker.placeBuy({ symbol: "AAPL", capital: 0, price: 100 }), /must be finite and positive/);
  await assert.rejects(() => IBKRBroker.placeBuy({ symbol: "AAPL", capital: 1000, price: -1 }), /must be finite and positive/);
});

test("symbolToNativeId returns the plain symbol (documented display-id, not a full IBKR contract)", () => {
  assert.equal(IBKRBroker.symbolToNativeId("AAPL"), "AAPL");
});

test("IBKRBroker exposes exactly the six interface methods", () => {
  const keys = Object.keys(IBKRBroker).sort();
  assert.deepEqual(keys, [
    "fetchOHLC",
    "getAccountBalanceSnapshot",
    "getCurrentPriceSnapshot",
    "placeBuy",
    "placeSell",
    "symbolToNativeId",
  ]);
});

/* --- Non-fatal error classification and delayed-data handling ------------------
 * Every case below was confirmed against a real IB Gateway on 2026-08-19: an
 * unsubscribed symbol emits error 10167 and then serves DELAYED_* fields only.
 * The mock reproduces that exact sequence. */

function mockClientTracking() {
  const c = new EventEmitter();
  c.calls = { cancelMktData: 0, connect: 0 };
  c.connect = () => { c.calls.connect++; queueMicrotask(() => c.emit(EventName.connected)); return c; };
  c.reqHistoricalData = () => c;
  c.reqMktData = () => c;
  c.cancelMktData = () => { c.calls.cancelMktData++; return c; };
  c.reqAccountSummary = () => c;
  c.cancelAccountSummary = () => c;
  c.reqIds = () => { queueMicrotask(() => c.emit(EventName.nextValidId, 1)); return c; };
  c.placeOrder = () => c;
  return c;
}

test("getClient survives a 2104 data-farm notice arriving BEFORE the connected event", async () => {
  const c = new EventEmitter();
  Object.assign(c, { reqMktData: () => c, cancelMktData: () => c });
  c.connect = () => {
    // real TWS ordering: informational notices can precede the handshake completing
    queueMicrotask(() => c.emit(EventName.error, -1, 2104, "Market data farm connection is OK:usfarm"));
    queueMicrotask(() => c.emit(EventName.connected));
    return c;
  };
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL", 500);
  await new Promise((r) => setTimeout(r, 5));
  c.emit(EventName.tickPrice, 1, 4, 150.25);
  const snap = await promise;
  assert.equal(snap.price, 150.25, "a benign 2104 must not fail the connection");
});

test("getClient still rejects on a genuinely fatal connect error", async () => {
  const c = new EventEmitter();
  c.connect = () => { queueMicrotask(() => c.emit(EventName.error, -1, 502, "Couldn't connect to TWS")); return c; };
  setIBApiForTests(() => c);
  await assert.rejects(() => IBKRBroker.getCurrentPriceSnapshot("AAPL", 500), /502/);
});

test("getCurrentPriceSnapshot ignores 10167 and resolves DELAYED_LAST with the REAL exchange timestamp, not Date.now()", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL", 500);
  await new Promise((r) => setTimeout(r, 0));
  // exact sequence observed on a real Gateway
  c.emit(EventName.error, 1, 10167, "Requested market data is not subscribed. Displaying delayed market data.");
  c.emit(EventName.tickPrice, 1, 68 /* DELAYED_LAST */, 309.77);
  c.emit(EventName.tickString, 1, 88 /* DELAYED_LAST_TIMESTAMP */, "1787135865");
  const snap = await promise;
  assert.equal(snap.price, 309.77);
  assert.equal(snap.delayed, true, "must be marked delayed");
  assert.equal(snap.asOf, 1787135865 * 1000, "asOf must be the exchange timestamp, never Date.now()");
  assert.ok(Date.now() - snap.asOf > 60_000, "a stale quote must report its true age so isQuoteStale can reject it");
  assert.equal(c.calls.cancelMktData, 1, "must cancel the subscription on the success path");
});

test("getCurrentPriceSnapshot refuses to invent a quote age when the delayed timestamp never arrives", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL", 60);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.tickPrice, 1, 68, 309.77); // price, but field 88 never follows
  await assert.rejects(() => promise, /DELAYED_LAST_TIMESTAMP never did/);
  assert.equal(c.calls.cancelMktData, 1, "must cancel the subscription on the timeout path too (leak fix)");
});

test("getCurrentPriceSnapshot marks a live LAST tick as not delayed", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL", 500);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.tickPrice, 1, 4, 150.25);
  const snap = await promise;
  assert.equal(snap.delayed, false);
  assert.ok(Math.abs(Date.now() - snap.asOf) < 5_000, "live ticks are fresh, so Date.now() is honest here");
});

test("getCurrentPriceSnapshot cancels the subscription on a fatal request error", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.getCurrentPriceSnapshot("AAPL", 500);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.error, 1, 200, "No security definition has been found");
  await assert.rejects(() => promise, /200/);
  assert.equal(c.calls.cancelMktData, 1);
});

test("fetchOHLC does not abandon the request on a non-fatal 10090", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.fetchOHLC("AAPL", 60);
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.error, 1, 10090, "Part of requested market data is not subscribed.");
  c.emit(EventName.historicalData, 1, "20260101", 100, 105, 99, 104, 1000);
  c.emit(EventName.historicalData, 1, "finished-x", -1, -1, -1, -1, -1);
  const bars = await promise;
  assert.equal(bars.length, 1, "a non-fatal notice must not discard the whole request");
});

test("a benign order warning does NOT reject a genuinely filled order (phantom-position guard)", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.placeBuy({ symbol: "AAPL", capital: 1000, price: 100 });
  await new Promise((r) => setTimeout(r, 0));
  // 2109 is in the informational band; rejecting here would mean "do not track"
  // for an order that actually filled - an untracked real position.
  c.emit(EventName.error, 1, 2109, "Outside Regular Trading Hours warning");
  c.emit(EventName.orderStatus, 1, "Filled", 10, 0, 100.05);
  const fill = await promise;
  assert.equal(fill.volume, 10);
  assert.equal(fill.price, 100.05);
});

test("a fatal order error still rejects", async () => {
  const c = mockClientTracking();
  setIBApiForTests(() => c);
  const promise = IBKRBroker.placeSell({ symbol: "AAPL", volume: 10 });
  await new Promise((r) => setTimeout(r, 0));
  c.emit(EventName.error, 1, 201, "Order rejected - reason: insufficient margin");
  await assert.rejects(() => promise, /201/);
});
