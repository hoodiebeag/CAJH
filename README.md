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
delay. The window size `N` is set by `SWING_WINDOW` in `strategy.js` (default `5` —
higher means fewer, stronger signals). Signals are checked on the 15m, 1h, and 4h
timeframes, and a trade is only proposed when **all three are bullish at once**
(`REQUIRE_TF_ALIGNMENT`).

### Optional confidence filters (in `strategy.js`)

These are ON by default. Set them to `false` / `null` to revert to the pure
strategy, and use `!backtest` to compare:

- `REQUIRE_HIGHER_LOW` — only buy if the new swing low is above the previous one
  (i.e. the market is making higher lows). Pure structure, no indicators.
- `MAX_STOP_PCT` — skip a buy whose stop sits more than 5% below entry, to cap how
  far the stop (and your risk) can be.
- `REQUIRE_TF_ALIGNMENT` — only propose a trade when 15m, 1h and 4h are all bullish.

These are reasonable defaults, not proven edges. Test them on your assets before
trusting them. Note: the backtester runs on a single timeframe, so it does **not**
model `REQUIRE_TF_ALIGNMENT` — that filter only takes effect in live scanning.

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

Downside protection is a **real stop-loss order resting on Kraken**, placed the moment
a trade opens — so it executes even if the bot process is down. The position monitor
(`monitor.js`) handles the upside (TP1 scale-out, breakeven move, TP2) and reconciles
with that resting stop every 30s: before it sells for a take-profit it cancels the
stop, and if it sees the stop already filled it records the close. This avoids selling
the same coins twice. If Kraken ever rejects the stop order, the monitor falls back to
watching the stop by polling (which only works while the bot is running).

Note: take-profits are still monitor-managed, so if the bot is offline price could run
past a target without scaling out — that costs *potential profit*, not capital. The
stop, which protects capital, is the one that lives on the exchange.

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