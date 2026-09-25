# Broker adapter interface

A broker adapter is a plain object with these seven functions.

**`monitor.js` does NOT consume this interface today.** It imports `trader.js` by name
(`monitor.js:6`), and `trader.js` imports `kraken-api` directly, so the live path is wired
straight to Kraken and swapping brokers currently means editing `monitor.js`. Nothing outside
`studies/scripts/` imports an adapter at all. The logic in `strategy.js`, `backtest.js` and
`monitor.js` is genuinely asset-agnostic — pure OHLCV and R-multiple reasoning — but the
*wiring* is not, and this document previously claimed otherwise. Wiring it up is a separate
job that touches `placeSell`, which is in `PROTECTED_PATTERNS`, so it trips the pre-commit
hook and needs a human decision rather than a quiet edit.

```
fetchOHLC(pair, minutes) -> Promise<[{ time, open, high, low, close, volume }] | null>
getCurrentPriceSnapshot(symbol) -> Promise<{ price, asOf }>
getAccountBalanceSnapshot() -> Promise<{ balance, asOf }>
placeBuy({ symbol, capital, price, priceAsOf, balance, balanceAsOf }) -> Promise<confirmed fill>
placeSell({ symbol, volume, price, priceAsOf }) -> Promise<confirmed fill>
symbolToNativeId(symbol) -> string
getHoldings() -> Promise<{ holdings: [{ asset, qty, price, value }], totalUsd }>
```

`getHoldings` is what `monitor.js`'s reconciliation consumes; `reconcile` reads `asset`,
`qty` and `value`, and never reads `totalUsd`. Holdings are sorted by value descending. It
must THROW when a position cannot be priced rather than defaulting the price to zero — a
zero-priced holding falls below `reconcile`'s dust threshold and vanishes from reconciliation
instead of raising an orphan.

`monitor.js` also calls `symbolToPair` and `validateTrackedTrade` on `trader.js`.
`symbolToPair` is the Kraken name for `symbolToNativeId` — the same function, so the gap is
naming, not capability. `validateTrackedTrade` is venue-agnostic apart from its symbol check
and belongs in shared code rather than in each adapter; it is deliberately not listed above.

`placeBuy`/`placeSell` must only resolve once the order is confirmed filled on
the exchange (never on submission) — this is a hard requirement, not a style
preference; see trader.js's `confirmBuyFill`/`confirmSellFill` for why (it's
what prevents phantom positions).

## Adapters

- `brokers/kraken.mjs` — real, wraps trader.js. Crypto spot only, matches the
  current live default.
- `brokers/ibkr.mjs` — real and complete against this interface, 25 tests, driven by a
  mocked `@stoqey/ib` through the `setIBApiForTests` seam. Defaults to `127.0.0.1:4002`,
  IB Gateway's PAPER port.

  **Never verified against a live Gateway.** Every test drives a mock, so what is proven is
  that the adapter handles the events the real decoder emits — not that a real Gateway emits
  them as expected, nor that this account is entitled to the data. That verification has to
  run on the machine hosting the Gateway: `127.0.0.1:4002` is ECONNREFUSED from the cloud
  session (checked 2026-09-02, see `scripts/c1-c3-entitlement-probe.mjs`). Run
  `studies/scripts/ibkr-smoke.mjs` there before trusting any of it.

  Crypto on IBKR is roughly four CME futures names, which cannot support a cross-sectional
  book needing at least six. Equities are the realistic target for this adapter.

## Scope note

This interface targets stocks/forex first (they map onto it directly - price,
size, market order, confirmed fill). Futures and options need real additional
surface (contract specs/expiry for futures; strikes/expiry/greeks for options)
that isn't designed here yet - extend this interface when one of those is
actually being built, not speculatively now.
