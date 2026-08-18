# Broker adapter interface

A broker adapter is a plain object with these six functions. `strategy.js`,
`backtest.js`, and `monitor.js` are already asset-agnostic (pure OHLCV / R-multiple
logic with no Kraken-specific assumptions) — swapping the broker underneath them
should never require touching those files.

```
fetchOHLC(pair, minutes) -> Promise<[{ time, open, high, low, close, volume }] | null>
getCurrentPriceSnapshot(symbol) -> Promise<{ price, asOf }>
getAccountBalanceSnapshot() -> Promise<{ balance, asOf }>
placeBuy({ symbol, capital, price, priceAsOf, balance, balanceAsOf }) -> Promise<confirmed fill>
placeSell({ symbol, volume, price, priceAsOf }) -> Promise<confirmed fill>
symbolToNativeId(symbol) -> string
```

`placeBuy`/`placeSell` must only resolve once the order is confirmed filled on
the exchange (never on submission) — this is a hard requirement, not a style
preference; see trader.js's `confirmBuyFill`/`confirmSellFill` for why (it's
what prevents phantom positions).

## Adapters

- `brokers/kraken.mjs` — real, wraps trader.js. Crypto spot only, matches the
  current live default.
- `brokers/ibkr.mjs` — stub. Every method throws until IBKR API access
  (TWS/Gateway running, API permissions enabled, market data subscriptions)
  is actually set up and an adapter can be built and tested against something
  real. Do not implement against documentation alone.

## Scope note

This interface targets stocks/forex first (they map onto it directly - price,
size, market order, confirmed fill). Futures and options need real additional
surface (contract specs/expiry for futures; strikes/expiry/greeks for options)
that isn't designed here yet - extend this interface when one of those is
actually being built, not speculatively now.
