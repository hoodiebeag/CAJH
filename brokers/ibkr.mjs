/**
 * brokers/ibkr.mjs — stub. See brokers/interface.md.
 *
 * Every method throws until IBKR API access (TWS or IB Gateway running, API
 * permissions enabled, market data subscriptions) is actually set up. Do not
 * implement against documentation alone - this must be built and tested
 * against a real, reachable IBKR endpoint, the same lesson this project
 * already learned once from the Binance funding API (looked reachable, was
 * actually geo-blocked).
 */
const notConfigured = (fn) => () => {
  throw new Error(`IBKRBroker.${fn}: not implemented - IBKR API access is not yet configured (see brokers/interface.md)`);
};

export const IBKRBroker = {
  fetchOHLC: notConfigured("fetchOHLC"),
  getCurrentPriceSnapshot: notConfigured("getCurrentPriceSnapshot"),
  getAccountBalanceSnapshot: notConfigured("getAccountBalanceSnapshot"),
  placeBuy: notConfigured("placeBuy"),
  placeSell: notConfigured("placeSell"),
  symbolToNativeId: notConfigured("symbolToNativeId"),
};
