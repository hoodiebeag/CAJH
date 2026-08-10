# Money-path parity matrix

R-006 covers the money paths that have deterministic seams today and names the remaining unsafe seams as blockers/follow-ons instead of treating a green test run as proof. Assertions are hand-computed state transitions, not snapshots.

| Money path | Live behavior | Backtest/research behavior | Deterministic evidence | Status |
| --- | --- | --- | --- | --- |
| Entry eligibility | New entries require healthy startup hydration, reconciliation, persistence, monitor tick, and a fresh heartbeat. | Historical simulations do not have live exit-management state. | `money-path.test.mjs`; `monitor.test.mjs`; `monitor-health.test.mjs` | COVERED / intentional live-only gate |
| Manual/cron race | Shared single-flight guards skip overlapping work rather than duplicating orders or exits. | Backtests are synchronous. | `money-path.test.mjs`; `scheduler.test.mjs` | COVERED / intentional live-only guard |
| One trade per structural level | The same pivot/trigger is persisted with a 24-bar expiry and cannot retrigger until the exact expiry. | Anticipate-mode backtests enforce equivalent one-level behavior. | `money-path.test.mjs`; `backtest.test.mjs`; `scanner.test.mjs` | COVERED |
| Position-cap rotation | At six open positions, scanner attempts to close only the most profitable priced winner before opening the newest signal; failure refuses the new entry. | Research portfolio accounting does not always include live capacity rotation. | Sell-confirmation safety is covered by `trader.test.mjs`; no exported scanner seam isolates candidate ranking without live-code refactor. | BLOCKED/FOLLOW-ON: needs a scanner dependency-injection seam or targeted live-edit task |
| Actual buy fill | Live position registration happens only after terminal Kraken buy confirmation; invalid order fields reject before `AddOrder`. | Backtests fill at deterministic modeled prices and charge modeled costs. | `order-validation.test.mjs`; `trader.test.mjs` (pending/filled/partial/canceled/error `QueryOrders` responses via the existing `setKrakenApiForTests` seam); R-005 runtime validation boundary | COVERED |
| Full exit | A tracked position is closed only by a confirmed terminal sell with positive executed volume and price. | Backtests close on modeled stop/target/event. | `money-path.test.mjs`; `trader.test.mjs` | COVERED |
| Partial exit | Confirmed partial execution reduces tracked volume by the exact executed amount and leaves the remainder open. | Backtest scale-out reduces modeled remaining fraction. | `money-path.test.mjs`; `trader.test.mjs`; `backtest.test.mjs` | COVERED |
| Unknown/canceled/expired/rejected sell | Ambiguous or non-terminal sell state leaves local tracked state intact. | No exchange ambiguity exists in research. | `money-path.test.mjs`; `trader.test.mjs` | COVERED / intentional live-only fail-closed behavior |
| Stop-loss / take-profit | Monitor polls price and exits through the confirmed sell path; no exchange-native resting orders are asserted here. | Backtest resolves stop/target from candle paths and charges exit-side fees. | `backtest.test.mjs`; sell-confirmation tests cover the state mutation after an exit request. | PARTIAL: modeled exits covered; BLOCKED/FOLLOW-ON for live monitor clock/API trigger fixture |
| Breakeven / trailing stop | Monitor mutates stop state from live prices after configured R thresholds. | Backtest has deterministic trailing/partial models. | `backtest.test.mjs` trailing and partial tests | PARTIAL: research model covered; BLOCKED/FOLLOW-ON for exact live polling/event-order fixture |
| Daily drawdown | A 10% equity loss from daily start disables new entries. | Research reports drawdown unless explicitly modeling a kill-switch. | `money-path.test.mjs` hand-computes 901 = safe and 900 = halted from a 1,000 start. | COVERED |
| Restart recovery | Versioned storage restores valid state; invalid state is unsafe, never a silently empty portfolio. | Backtests start from explicit data. | `storage.test.mjs`; restart/halt fixtures in `monitor.test.mjs`; cooldown restart tests in `scanner.test.mjs` | COVERED |
| Reconciliation | Stablecoins and dust are ignored; untracked held assets are orphans; tracked-but-missing assets are ghosts; cleanup removes tracking only and never sells. | Backtests do not reconcile exchange holdings. | `money-path.test.mjs`; monitor reconciliation tests | COVERED |
| Persistence failure | Failed writes mark monitor health unsafe and block new entries. | Not applicable to research. | `storage.test.mjs`; `monitor.test.mjs` health gating | COVERED |
| Stale price / invalid balance | Scanner validates finite positive quote/balance-derived capital before consuming a cooldown or placing an order. | Backtests require finite candles. | `order-validation.test.mjs`; R-005 scanner validation path | PARTIAL: finite value boundary covered; BLOCKED/FOLLOW-ON for explicit quote-age contract |
| Exchange errors / retries | Ambiguous remote state must never imply a fill. Order placement is non-idempotent and gets exactly one attempt (no auto-retry, per R-013's explicit retry policy), so a lost response can never cause a duplicate order; idempotent reads keep their prior bounded-retry behavior. | Research excludes missing data rather than retrying an exchange. | Sell ambiguity covered by `money-path.test.mjs` and `trader.test.mjs`; R-013's retry policy covered by `trader.test.mjs`. | COVERED |

## Verifier note

No remaining blocker is hidden as a passing test. The matrix distinguishes:

- `COVERED`: deterministic test exists today.
- `PARTIAL`: the safety boundary is tested, but an API/timing seam still needs a production test seam.
- `BLOCKED/FOLLOW-ON`: cannot be honestly completed inside this target without editing live code or adding dependency injection. Those rows must be routed as later queue items, not treated as safe.
