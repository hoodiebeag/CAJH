# cajh

A research engine for finding and honestly validating trading strategies, with a live-trading
wrapper that is currently off.

**Start with [`FINDINGS.md`](FINDINGS.md).** It states what this project has established: a
coherent negative result -- no entry-timing edge has been demonstrated in either market tested.
Read it before proposing work, because most obvious directions are already closed and listed
there with their outcomes.

## The pipeline

Ten modules at the root are the canonical chain; everything else supports them.

| Module | Responsibility |
|---|---|
| `data.js` | candle loading, resampling, gap validation |
| `strategy.js` | swing structure, pivots, bias, entry/exit primitives |
| `backtest.js` | simulation with fees, slippage and risk scaling |
| `researchlib.mjs` | universe, train/holdout splits, walk-forward windows |
| `evallib.mjs` | canonical per-trade record, cost decomposition, summaries |
| `inference.mjs` | clustered CIs, matched-geometry nulls, baseline controls |
| `promotion.mjs` | the ten-condition gate: PASS / FAIL / BLOCKED |
| `registry.mjs` | pre-registration and sealed-holdout ledger (append-only, hash-chained) |
| `researchlab.mjs` | run persistence with provenance |
| `paper.mjs` | D2 log-only paper trading; imports no broker |

Intended flow: load data -> split -> generate candidates -> backtest on train -> validate on
holdout -> score through `promotionGate()` -> persist the run.

## Running things

```
npm test                                    # 675 tests
node scripts/c1-c3-entitlement-probe.mjs    # what market data this account can reach
```

## Directories

- **`studies/`** -- 43 archived research modules and 62 one-off scripts: the evidence trail behind
  `VERDICTS.md`'s 68 rows. Closed to new work; see `studies/README.md`.
- **`docs/archive/`** -- ~14,000 lines of dated per-study narrative, superseded by `FINDINGS.md`.
- **`brokers/`** -- Kraken and IBKR adapters.

## Rules

`CONSTRAINTS.md` binds any future work: closed programs, the live-trading gate, evidence
discipline. `ALPHA_DEFINITION.md` defines what would count as an edge.
`MULTIPLE_COMPARISONS_AUDIT.md` is the correction-family register.

The bot files (`bot.js`, `trader.js`, `monitor.js`, `scanner.js`, `commands.js`) stay in place
with their safety interlocks intact. A dormant guarded path is safer than a deleted one while
account credentials still exist; to remove the capability, revoke the API keys.

## Configuration and live controls

- **Active live + research:** `SWING_WINDOW`, `RECENT_BARS`, `PENDING_MAX_AGE`,
  `RISK_PCT`, `MAX_POSITION_PCT`, `MAX_STOP_PCT_BY_TF`, `MIN_STOP_PCT`, `TP_R`,
  `LOCK_BREAKEVEN`, `BE_TRIGGER_R`, `BE_LOCK_R`, `FEE_BUFFER_PCT`, and `FEE_RATE`.
- **Active research only:** `MAX_STOP_PCT`, `REQUIRE_TF_ALIGNMENT`, `CHOP_FILTER`,
  `TREND_GATE`, `TREND_GATE_MODE`, `TREND_MA`, plus backtest-only exit options like
  ATR stops, partial exits, trailing stops, and max hold. These are swept by research
  commands but are **not live entry gates** unless scanner imports them.
- **Live environment controls:** `LIVE_TRADING=true` and an explicit, writable
  `DATA_DIR` are both required before `!resume` can enable orders. Backtests/research
  can run with `DATA_DIR` unset, but live trading cannot: open positions, halt state,
  stats, config, and structural-level cooldowns must survive restart/redeploy.

Current live scanner truth: anticipation entries on 1h/4h/1d, no alignment gate, no
trend gate, per-timeframe stop caps, risk-based sizing, six-position cap with winner
rotation, software-polled exits.

## Autonomous trading

**cajh boots halted.** Autonomous trading only runs when `LIVE_TRADING=true` is set in
the environment; otherwise scans, charts, and research work normally but no orders are
placed. This default exists because the current strategy backtests net-negative — see
"Does it work?" below. `!resume` only enables trading when `LIVE_TRADING=true`, monitor
health is good, and storage preflight proves `DATA_DIR` is explicit and writable.

Once enabled, cajh places trades itself — there is **no confirmation step**. On a valid
setup it buys immediately, posts the trade, and pings you (`BEAG_USER_ID`). Use `!stop`
to halt new entries at any time, and `!sell <asset>` to exit a position you don't want.
