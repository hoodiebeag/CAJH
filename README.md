# cajh

A Discord bot for long-only spot crypto trading on Kraken, driven by a mechanical
**swing-fractal** strategy (pure price structure, no indicators). It renders
candlestick charts with buy/sell arrows, posts signals to Discord, waits for a
human `!confirm`, then places a market buy and manages the exit with a stop-loss
and scale-out take-profits.

## Setup

1. `npm install` (builds the native `canvas` module — needs build tools on some systems).
2. Copy `.env.example` to `.env` and fill in your tokens/keys.
3. `npm start`

In Discord, run `!setchannel` once in the channel where you want scans and alerts to post.

## The strategy

Signals come only from confirmed swing pivots:

- **Buy** — a candle whose low is below the `N` candles before *and* after it
  (a swing low). cajh opens a long.
- **Sell** — a candle whose high is above the `N` candles on both sides (a swing
  high). Drawn as an arrow only; cajh is long-only and does not short.

A pivot only confirms `N` candles later, so every signal has a built-in `N`-candle
delay. The window size `N` is set by `SWING_WINDOW` in `strategy.js` (default `3`).
Signals are checked on the 15m, 1h, and 4h timeframes; if more than one timeframe
gives a buy, the higher timeframe wins.

### Optional confidence filters (in `strategy.js`)

These are ON by default. Set them to `false` / `null` to revert to the pure
strategy, and use `!backtest` to compare:

- `REQUIRE_HIGHER_LOW` — only buy if the new swing low is above the previous one
  (i.e. the market is making higher lows). Pure structure, no indicators.
- `MAX_STOP_PCT` — skip a buy whose stop sits more than 5% below entry, to cap how
  far the stop (and your risk) can be.

These are reasonable defaults, not proven edges. Test them on your assets before
trusting them.

## Backtesting

`!backtest BTC` (or `!backtest BTC 1h`) replays the strategy on recent Kraken
history and reports, per timeframe: number of trades, win rate, total R, average R,
and max drawdown in R (where "R" = one unit of per-trade risk). It uses a simplified
model — exact fills, stop assumed to hit before target on the same candle, and only
as much history as Kraken returns — so treat the numbers as a rough guide, not truth.

## Asking cajh about itself

`@cajh` now sees its own live state (open positions, watchlist, settings) on every
message, and loads its own source files when you ask a code/behavior question — so it
can explain *why* it did something or how a part works, instead of answering as a
generic assistant.

### Entry, stop, and targets

- **Entry** — market buy at the current price when the signal confirms.
- **Position size** — flat 10% of balance (`POSITION_PCT` in `scanner.js`).
- **Stop-loss** — the swing low that triggered the entry.
- **Take-profit** — `risk = entry − stop`; TP1 at `entry + 1.5 × risk` (sells half,
  moves stop to breakeven), TP2 at `entry + 3 × risk` (closes the runner).
  `RR1` / `RR2` in `scanner.js`.

## Commands

**Trading** — `!confirm`, `!cancel`, `!close <symbol>`, `!stop`, `!resume`
**Signals** — `!scan` (watchlist sweep), `!trade` (same), `!trade BTC` (one asset)
**Backtest** — `!backtest BTC`, `!backtest BTC 1h`
**Watchlist** — `!watchlist`, `!watch BTC ETH`, `!unwatch TAO`
**Settings** — `!setchannel`, `!status`
**Extras (AI, no trades)** — `@cajh show me BTC 15m`, `@cajh analyze that`

## How exits work

The position monitor (`monitor.js`) is the **single source of truth** for exits.
No resting stop/take-profit orders are placed on the exchange (that would let a
position be sold twice or over-committed). The monitor watches price every 30s.
Tradeoff: **if the bot process is down, there is no stop protection.**

## Risk controls

- Every trade requires manual `!confirm` (10-minute timeout).
- `!stop` halts new trades immediately.
- A 10% daily drawdown limit (measured on total equity = cash + open positions)
  auto-halts trading.

This software places real orders with real money. Test with small size first.
Nothing here is financial advice.

## Notes

- The AI features (`@cajh` chat, `analyze that`) are commentary only and never place
  trades. The bot's actual Discord name and the handle you @mention it with are set
  in the Discord Developer Portal / your server, not in this code.
- Runtime changes (`!watch`, `!setchannel`) persist to `config.json`. On hosts with
  an ephemeral filesystem (e.g. Railway without a volume) that file is wiped on
  redeploy — attach a volume or set the matching env vars.
