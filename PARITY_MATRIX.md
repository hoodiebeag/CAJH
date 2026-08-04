# Money-path parity matrix

This matrix is deliberately explicit about what is tested, what is only covered by
an existing fixture, and what remains an implementation gap. A row marked `GAP` is
not a claim of safety; it is a verifier-visible follow-up.

| Money path | Live behavior | Backtest/research behavior | Deterministic evidence | Status |
| --- | --- | --- | --- | --- |
| Entry eligibility | Monitor health gate blocks unknown startup, stale heartbeat, failed persistence, failed reconciliation, or failed tick | Backtests can run without live monitor health | `money-path.test.mjs`, `monitor.test.mjs`, `monitor-health.test.mjs` | COVERED / intentional difference |
| Manual/cron race | Single-flight scan guard skips overlap | Backtest is synchronous | `scheduler.test.mjs` | COVERED / intentional difference |
| Position-cap rotation | Scanner selects the most profitable open trade before a new entry | Backtest has its own portfolio accounting | `scanner.js`, `backtest.js`; no isolated hand fixture | GAP: add cap-rotation fixture |
| Actual buy fill | Position is registered only after terminal Kraken buy confirmation | Backtest fills at its modeled entry | `trader.js` confirmation path; no API-seam fixture | GAP: add mocked QueryOrders fixture |
| Full exit | Tracked position closes only for a confirmed terminal execution | Backtest closes on modeled stop/target/event | `money-path.test.mjs`, `trader.test.mjs` | COVERED |
| Partial exit | Tracked volume is reduced by confirmed executed volume only | Backtest scale-out updates modeled volume | `money-path.test.mjs`, `trader.test.mjs` | COVERED |
| Stop / take-profit | Monitor polls price and closes through confirmed sell flow | Backtest applies stop/target on candle path | `monitor.js`, `backtest.test.mjs`; no live clock/API fixture | GAP: add exit-trigger fixture |
| Breakeven / trailing stop | Monitor mutates stop state from live prices | Backtest has trailing-stop model | `backtest.test.mjs`; live parity not isolated | GAP: classify exact live/backtest event timing |
| Daily drawdown | Monitor disables entries after the configured equity drawdown threshold | Backtest applies its own drawdown rules | `monitor.js`; no hand-computed threshold fixture | GAP: add threshold and reset fixture |
| Restart recovery | Versioned storage restores valid state; invalid state is unsafe, not empty | Backtest starts from an explicit portfolio | `storage.test.mjs`, `monitor.test.mjs` | COVERED |
| Reconciliation | Holdings are classified as stable/dust/orphan/ghost; ghost cleanup removes tracking only and never sells | No exchange holdings to reconcile | `money-path.test.mjs`, `monitor.js` | COVERED |
| Persistence failure | Failed writes mark health unsafe and disable entries | Not applicable | `storage.test.mjs`, `monitor.js` | COVERED |
| Stale price / price failure | Current code must not trade on an unknown quote; explicit freshness/age contract is not yet tested | Backtest uses candle timestamps | `trader.js` and scanner guards; no injected stale-quote fixture | GAP: define quote age and test rejection |
| Exchange errors | Order/quote failures return unknown state and preserve tracked positions | Research treats missing data as excluded | `trader.js` retry paths; no bounded error matrix | GAP: add retry/timeout fixture (R-013) |

## Verification rule

The matrix is complete only when every `GAP` row has either a focused test or an
explicit follow-on queue item. This run adds the deterministic pure-function tests;
it does not claim that the remaining API, timing, or rotation seams are safe.
