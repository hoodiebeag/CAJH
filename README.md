# cajh

A Discord bot for long-only spot crypto trading on Kraken, driven by a mechanical
**swing-fractal** strategy (pure price structure, no indicators). It renders
candlestick charts with labeled buy/sell arrows, scans on a schedule, and trades
**autonomously** — placing buys itself and managing its own exits.

## Setup

1. `npm install` (builds the native `canvas` module — needs build tools on some systems).
2. Copy `.env.example` to `.env` and fill in your tokens/keys.
3. `npm start`

In Discord, run `!setchannel` once in the channel where you want scans and alerts to post.

## The strategy

Pure price structure, no indicators. A pivot is identified by a strong **left** side
(its low is below the `N` candles before it — a meaningful local low) and **confirmed
by break of structure**: the moment price closes back above that candle's high. This
confirms in ~1–2 candles instead of waiting `N` candles on the right, so signals are
timely without lowering the bar (same strong pivots, not more of them). `N` is
`SWING_WINDOW` in `strategy.js` (default `5`).

- **Entry trigger (anticipation)** — a candidate swing low exists on the **1h, 4h, or 1d**
  and live price crosses **above the candidate candle's high** (the trigger): the
  confirming close is *expected* to print, so cajh buys the crossing instead of chasing
  the close. A low that already confirmed within `RECENT_BARS` also qualifies (covers
  price gapping through the trigger between scans). Higher timeframes win ties (1d > 4h > 1h).
- **No alignment gate** — any single timeframe can fire; risk-based sizing (below)
  replaces the old 1h+4h trend filter.
- **Sell arrows** — swing highs (confirmed when price breaks below them) are drawn and
  used for take-profit; cajh is long-only and does not short.

### Entry, stop, and targets

- **Entry** — market buy when the setup is found on a scan.
- **Size (risk-based)** — risk `RISK_PCT` (0.5%) of free cash per trade: size =
  risk budget ÷ stop distance, capped at `MAX_POSITION_PCT` (20%) of cash. A 1d setup
  with an 8% stop and a 1h setup with a 1.5% stop carry the same dollar risk.
- **Position cap with rotation** — at 6 open positions, a new signal closes the **most
  profitable** open position (banks the winner) to make room.
- **Stop** — the candidate swing low that triggered the entry. Stop-distance bands are
  per timeframe (`MAX_STOP_PCT_BY_TF`): ≤4% on 1h, ≤6% on 4h, ≤10% on 1d, ≥1.5% everywhere.
- **Target** — `risk = entry − stop`; a single take-profit at `entry + 4 × risk`
  (`TP_R` in `strategy.js`, full position, no scale-out).
- **Breakeven-plus** — once price reaches `entry + 2 × risk` (`BE_TRIGGER_R`), the stop
  is lifted above entry (≥ the fee buffer) so the trade can no longer close net-red.

### Optional filters (in `strategy.js`)

`REQUIRE_HIGHER_LOW`, `MAX_STOP_PCT`, `MIN_STOP_PCT` (stops tighter than ~1.5% are
swamped by round-trip fees), `REQUIRE_TF_ALIGNMENT`, `TREND_GATE` (4h above its MA),
`EXIT_ON_SWING_HIGH` (off by default), plus `RECENT_BARS`. Set any to `false`/`null`
to relax. Use `!backtest` to compare.

## Autonomous trading

**cajh boots halted.** Autonomous trading only runs when `LIVE_TRADING=true` is set in
the environment; otherwise scans, charts, and research work normally but no orders are
placed. This default exists because the current strategy backtests net-negative — see
"Does it work?" below. `!resume` enables trading for the running session.

Once enabled, cajh places trades itself — there is **no confirmation step**. On a valid
setup it buys immediately, posts the trade, and pings you (`BEAG_USER_ID`). Use `!stop`
to halt new entries at any time, and `!sell <asset>` to exit a position you don't want.

## Does it work?

Not yet — and the tooling is built to say so plainly. Measured on 12 pairs over ~15
months (4,426 trades, `node research.js exits`):

| exit model | train R/trade | sealed holdout R/trade |
|---|---|---|
| live (TP4 + breakeven lock) | −0.480 | −0.633 |
| best of 12 (trail 1R after 1R) | −0.411 | −0.512 |

No configuration is profitable, and **no pair is green in any configuration**. The
decisive number is the cost-sensitivity row: with fees and slippage set to **zero**, the
strategy still returns −0.02 to −0.09 R/trade. Since costs can only subtract, cheaper
(maker) fills cannot rescue it — the entry itself carries no predictive edge. `!discover`
agrees: 3,838 candidates, no rule survived false-discovery control.

Read that as the pipeline working correctly, not the project failing: it is now capable
of detecting an edge honestly, and of telling you when there isn't one.

## How exits work

Exits are **fully self-managed**: the monitor checks each open position's price every
30s and sells itself when price crosses the stop (≤ stop) or a target (≥ TP). No
resting orders sit on the exchange. Open positions are persisted to `positions.json`
so a restart recovers and keeps managing them.

**Important:** because exits depend on the bot running, downtime = no protection.
On Railway, attach a volume and set `DATA_DIR` to its mount path so positions survive
redeploys (the filesystem is otherwise wiped on each deploy).

## Commands

**Positions** — `!sell BTC`, `!sell BTC 50` (percent), `!port`, `!stop`, `!resume`
**Signals** — `!scan` (auto every 15 minutes — anticipation entries need frequent checks even on slow candles), `!trade BTC` (one asset)
**Backtest** — `!backtest BTC` (anticipation entries per 1h/4h/1d timeframe, pooled)
**Watchlist** — `!watchlist`, `!watch BTC ETH`, `!unwatch TAO`
**Settings** — `!setchannel`, `!status`
**AI (no trades)** — `@cajh show me BTC 4h`, `@cajh analyze that`. cajh also answers
questions about its own live state and code.

## Backtesting

`!backtest BTC` replays the strategy on deep local history (or live candles as fallback): trades, win rate, total
R, avg R, and max drawdown in R. Simplified model (exact fills, stop assumed before
target on the same candle, limited history) — a rough guide, not truth. Past results
don't predict the future.

## Risk

This software places real orders with real money, autonomously. Test small. The 10%
daily-drawdown halt and `!stop` are your guardrails. Nothing here is financial advice.