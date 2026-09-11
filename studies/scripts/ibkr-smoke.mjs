/**
 * scripts/ibkr-smoke.mjs — run this locally, on the machine where IB
 * Gateway is actually running, to confirm brokers/ibkr.mjs's real connection
 * works end-to-end.
 *
 * Read-only: calls getAccountBalanceSnapshot, getCurrentPriceSnapshot, fetchOHLC
 * and getHoldings only. Never calls placeBuy/placeSell - no order is placed.
 *
 * Usage:
 *   node scripts/ibkr-smoke.mjs [SYMBOL]
 *
 * Defaults to AAPL if no symbol given. Uses IBKR_HOST/IBKR_PORT/
 * IBKR_CLIENT_ID env vars if set, otherwise 127.0.0.1:4002 (paper).
 */
import { IBKRBroker } from "../../brokers/ibkr.mjs";

const symbol = process.argv[2] || "AAPL";
const host = process.env.IBKR_HOST || "127.0.0.1";
const port = process.env.IBKR_PORT || "4002";

console.log(`Connecting to IB Gateway at ${host}:${port} (symbol: ${symbol})...\n`);

// Each call runs INDEPENDENTLY. The first version wrapped all four in one try/catch, so a failure
// on getCurrentPriceSnapshot aborted the run and fetchOHLC -- a SEPARATE IBKR entitlement, and the
// one that decides whether this account is usable for research at all -- was never exercised. A
// diagnostic that stops at the first problem answers one question when it was asked four.
const results = [];
async function check(name, fn) {
  try {
    const v = await fn();
    console.log(`\u2713 ${name}:`, typeof v === "string" ? v : JSON.stringify(v)?.slice(0, 180));
    results.push([name, true]);
  } catch (err) {
    console.log(`\u2717 ${name}: ${err.message.slice(0, 220)}`);
    results.push([name, false]);
  }
}

await check("getAccountBalanceSnapshot", () => IBKRBroker.getAccountBalanceSnapshot());
await check(`getCurrentPriceSnapshot(${symbol})`, () => IBKRBroker.getCurrentPriceSnapshot(symbol));
await check(`fetchOHLC(${symbol}, 1440)`, async () => {
  const c = await IBKRBroker.fetchOHLC(symbol, 1440);
  if (!c) throw new Error("returned null - see errors above");
  return `${c.length} daily bars, most recent ${JSON.stringify(c[c.length - 1])}`;
});
await check("getHoldings", async () => {
  const { holdings, totalUsd } = await IBKRBroker.getHoldings();
  return `${holdings.length} position(s), total $${totalUsd.toFixed(2)}`;
});

const ok = results.filter(([, v]) => v).length;
console.log(`\n${ok}/${results.length} calls succeeded.`);
if (!results.find(([n]) => n.startsWith("fetchOHLC"))?.[1]) {
  console.log("fetchOHLC FAILED - historical bars are a separate entitlement from streaming market");
  console.log("data, so this is the call that decides whether IBKR is usable as a research source.");
} else if (ok < results.length) {
  console.log("fetchOHLC WORKED - historical bars are available even though streaming quotes are not,");
  console.log("so IBKR is usable as an independent data vendor for cross-checking.");
}
if (ok < results.length) {
  console.log("\nRetry with IBKR_MARKET_DATA_TYPE=4 to request delayed data where live is unsubscribed.");
}
process.exit(ok === results.length ? 0 : 1);
