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

- **Entry trigger** — a 15m swing low that just confirmed by break of structure
  (within `RECENT_BARS` candles, so scans catch setups that confirmed since the last scan).
- **Trend filter** — the trade is only taken when the **1h and 4h** structural bias are
  bullish (`REQUIRE_TF_ALIGNMENT`). Higher-timeframe trend, fast-timeframe entry.
- **Sell arrows** — swing highs (confirmed when price breaks below them) are drawn and
  used for take-profit; cajh is long-only and does not short.

### Entry, stop, and targets

- **Entry** — market buy when the setup is found on a scan.
- **Size** — flat 10% of balance (`POSITION_PCT` in `scanner.js`).
- **Stop** — the swing low that triggered the entry.
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

cajh places trades itself — there is **no confirmation step**. On a confirmed,
aligned setup it buys immediately, posts the trade, and pings you (`BEAG_USER_ID`).
Use `!stop` to halt new entries at any time, and `!sell <asset>` to exit a position
you don't want.

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
**Signals** — `!scan` (auto every 15 minutes, right after each 15m candle closes), `!trade BTC` (one asset)
**Backtest** — `!backtest BTC` (multi-timeframe: 15m entries gated by 1h+4h alignment)
**Watchlist** — `!watchlist`, `!watch BTC ETH`, `!unwatch TAO`
**Settings** — `!setchannel`, `!status`
**AI (no trades)** — `@cajh show me BTC 15m`, `@cajh analyze that`. cajh also answers
questions about its own live state and code.

## Backtesting

`!backtest BTC` replays the strategy on recent Kraken history: trades, win rate, total
R, avg R, and max drawdown in R. Simplified model (exact fills, stop assumed before
target on the same candle, limited history) — a rough guide, not truth. Past results
don't predict the future.

## Risk

This software places real orders with real money, autonomously. Test small. The 10%
daily-drawdown halt and `!stop` are your guardrails. Nothing here is financial advice.