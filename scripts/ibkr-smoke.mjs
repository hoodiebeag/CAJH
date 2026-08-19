/**
 * scripts/ibkr-smoke-test.mjs — run this locally, on the machine where IB
 * Gateway is actually running, to confirm brokers/ibkr.mjs's real connection
 * works end-to-end.
 *
 * Read-only: calls getAccountBalanceSnapshot, getCurrentPriceSnapshot, and
 * fetchOHLC only. Never calls placeBuy/placeSell - no order is placed.
 *
 * Usage:
 *   node scripts/ibkr-smoke-test.mjs [SYMBOL]
 *
 * Defaults to AAPL if no symbol given. Uses IBKR_HOST/IBKR_PORT/
 * IBKR_CLIENT_ID env vars if set, otherwise 127.0.0.1:4002 (paper).
 */
import { IBKRBroker } from "../brokers/ibkr.mjs";

const symbol = process.argv[2] || "AAPL";
const host = process.env.IBKR_HOST || "127.0.0.1";
const port = process.env.IBKR_PORT || "4002";

console.log(`Connecting to IB Gateway at ${host}:${port} (symbol: ${symbol})...\n`);

try {
  const balance = await IBKRBroker.getAccountBalanceSnapshot();
  console.log("✓ getAccountBalanceSnapshot:", balance);

  const price = await IBKRBroker.getCurrentPriceSnapshot(symbol);
  console.log(`✓ getCurrentPriceSnapshot(${symbol}):`, price);

  const candles = await IBKRBroker.fetchOHLC(symbol, 60);
  console.log(
    `✓ fetchOHLC(${symbol}, 60):`,
    candles ? `${candles.length} bars, most recent ${JSON.stringify(candles[candles.length - 1])}` : "null (fetch failed - see errors above)"
  );

  console.log("\nAll three read-only calls succeeded - connection is solid.");
  process.exit(0);
} catch (err) {
  console.error("\nFailed:", err.message);
  console.error("\nCommon causes: Gateway not running, wrong port (4002=paper/4001=live), API access not enabled, or this machine's IP not in Gateway's Trusted IPs list.");
  process.exit(1);
}
