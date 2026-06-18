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

Signals come only from confirmed swing pivots:

- **Buy** — a candle whose low is below the `N` candles before *and* after it
  (a swing low). cajh opens a long.
- **Sell** — a swing high. Drawn as an arrow only; cajh is long-only and does not short.

A pivot confirms `N` candles later (built-in delay). `N` is `SWING_WINDOW` in
`strategy.js` (default `5` — higher = fewer, stronger signals). Signals are checked on
15m, 1h and 4h, and a trade is only taken when **all three are bullish at once**
(`REQUIRE_TF_ALIGNMENT`). With N=5 plus alignment, entries are deliberately rare —
expect quiet stretches.

### Entry, stop, and targets

- **Entry** — market buy at the confirmation price.
- **Size** — flat 10% of balance (`POSITION_PCT` in `scanner.js`).
- **Stop** — the swing low that triggered the entry.
- **Targets** — `risk = entry − stop`; TP1 at `entry + 1.5 × risk` (sells half, moves
  stop to breakeven), TP2 at `entry + 3 × risk` (closes the runner). `RR1`/`RR2` in `strategy.js`.

### Optional filters (in `strategy.js`, on by default)

`REQUIRE_HIGHER_LOW`, `MAX_STOP_PCT`, `REQUIRE_TF_ALIGNMENT`. Set any to `false`/`null`
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
**Signals** — `!scan` (auto every 3h from 9:30 AM EST), `!trade BTC` (one asset)
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
