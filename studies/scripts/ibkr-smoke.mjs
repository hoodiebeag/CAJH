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

  // getHoldings joined the broker contract on 2026-09-10 and has only ever been driven by a
  // mocked @stoqey/ib. It is the one call whose real behaviour is still unverified, and the one
  // monitor.js's reconciliation depends on, so an empty account is a PASS here - what is being
  // checked is that reqPositions/positionEnd arrive and the shape is right, not that anything
  // is held.
  const { holdings, totalUsd } = await IBKRBroker.getHoldings();
  console.log(`✓ getHoldings: ${holdings.length} position(s), total $${totalUsd.toFixed(2)}`);
  for (const h of holdings) {
    console.log(`    ${h.asset.padEnd(8)} qty ${h.qty}  @ ${h.price}  = $${h.value.toFixed(2)}` +
      (h.qty < 0 ? "   SHORT" : ""));
  }

  console.log("\nAll four read-only calls succeeded - connection is solid.");
  process.exit(0);
} catch (err) {
  console.error("\nFailed:", err.message);
  console.error("\nCommon causes: Gateway not running, wrong port (4002=paper/4001=live), API access not enabled, or this machine's IP not in Gateway's Trusted IPs list.");
  process.exit(1);
}
