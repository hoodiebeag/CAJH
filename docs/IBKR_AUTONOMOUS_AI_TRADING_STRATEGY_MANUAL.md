# IBKR Autonomous AI Trading Strategy Manual

**Purpose:** a large, implementation-oriented research manual for discovering, testing, and safely deploying systematic strategies through Interactive Brokers. It is designed as an input document for an autonomous research/trading agent. It intentionally emphasizes strategy diversity, robust validation, and execution-aware economics over pretty backtests.

> **Important:** no manual can guarantee a profitable trading strategy. What can be designed is a process that gives the agent a much higher probability of finding *genuinely robust* edges and a lower probability of mistaking overfit noise for alpha. This manual therefore treats out-of-sample survival, cost realism, and live paper stability as hard requirements rather than optional checks.

## Operating principle
The agent should behave like a research organization, not a single trader: generate hypotheses, compile them into deterministic implementations, test them under adversarial assumptions, kill weak ideas quickly, and promote only strategies that survive multiple independent validation layers. The core research literature supports persistent patterns such as time-series momentum, cross-sectional momentum, value/momentum, quality, liquidity effects, volatility risk premia, statistical arbitrage, and nonlinear ML interactions, but each comes with regime, crowding, cost, or data risks.

## IBKR-specific realities
IBKR's current Web API documentation supports real-time trading/account access, while the current changelog reports a September 9, 2026 change to historical-market-data pacing: `/iserver/marketdata/history` is capped at 10 requests/second or 50 requests/minute, and the historical scanner endpoint has been deprecated. The Web API documentation also states that individual Web API usage requires a funded IBKR Pro account and that the API can access both live and associated simulated/paper accounts. Order handling includes native bracket/attached-order structures, but the documentation warns about transmission sequencing for multi-order brackets. These details mean the research engine should cache data, queue requests, use backoff, and treat order state as a first-class database object.[1][2][3][4]

## Research architecture
- **Universe service:** continuously build an eligible universe from asset class, exchange, liquidity, borrowability, optionability, margin requirements, and data availability.
- **Feature service:** generate time-aligned features with point-in-time rules, including only information available at the decision timestamp.
- **Strategy compiler:** turn a strategy specification into deterministic code, including signals, position sizing, entry/exit state, and execution constraints.
- **Backtest engine:** event-driven; model commissions, spread, slippage, partial fills, queue position where relevant, borrow, financing, option assignment, contract roll, and market hours.
- **Research judge:** evaluates performance, drawdown, tail risk, turnover, capacity, stability across windows/assets, parameter sensitivity, and statistical significance after multiple testing.
- **Paper-live shadow:** runs identical production code against live market data with simulated fills before any real capital.
- **Promotion controller:** increases or decreases capital based on predefined survival milestones; no manual override from the model itself.

## Hard validation gates
1. **No future information:** point-in-time data, corporate-action handling, and release timestamps verified. 2. **Cost survival:** base case, 1.5x, 2x and 3x conservative cost scenarios. 3. **Temporal holdout:** final test periods never touched during design. 4. **Cross-asset holdout:** if a strategy claims portability, entire asset groups are withheld during training. 5. **Parameter perturbation:** small parameter changes must not destroy performance. 6. **Regime buckets:** evaluate trend/range, low/high vol, low/high correlation, crisis/non-crisis. 7. **Multiple-testing accounting:** record every candidate and failed experiment, estimate probability of backtest overfitting, and control false discoveries.[15][16] 8. **Paper-live replication:** the live-data implementation must reproduce the research implementation before promotion.

# Strategy library

## Trend / Momentum
Exploit persistent directional movement while scaling exposure to volatility and market state. The literature supports time-series and cross-sectional momentum across multiple asset classes, but the manual deliberately emphasizes state conditioning, relative trend geometry, and portfolio construction instead of a single indicator crossover.[5][6][7]
**Best starting universe:** Equity index futures/ETFs, liquid stocks, commodities, rates, FX, liquid crypto where permitted.

### T01 - Volatility-normalized dual-horizon trend
**Core rule:** score = 0.6*z(ret_63d/ATR) + 0.4*z(ret_252d/ATR); trade only when both signs agree; inverse-vol size; exit when score crosses zero or trend stop breaks.
**Assets:** Cross-asset liquid instruments.
**Novelty / implementation angle:** Use percentile-normalized signals so a 2% move in a bond future and a 2% move in an equity ETF do not mean the same thing.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T02 - Trend acceleration / second derivative
**Core rule:** fit rolling regression to log price; trade sign(slope) only when slope change is positive for longs or negative for shorts; scale by R2.
**Assets:** Futures, liquid ETFs, FX.
**Novelty / implementation angle:** Most systems use level/slope; here the entry trigger is acceleration, reducing late entries in mature trends.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T03 - Breakout persistence quality
**Core rule:** enter Donchian breakout only when breakout distance/ATR is between 0.25 and 1.5 and post-breakout realized volatility is not spiking beyond threshold.
**Assets:** Futures, ETFs.
**Novelty / implementation angle:** The key variable is breakout quality, not breakout occurrence.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T04 - Trend + volume surprise
**Core rule:** trend signal multiplied by volume z-score; require abnormal volume on confirmation but penalize extreme exhaustion volume.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Separates accumulation-type breakouts from thin, one-print spikes.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T05 - 52-week-high pressure trend
**Core rule:** rank proximity to 52-week high, then require 20/60d momentum alignment; long top decile, short bottom decile.
**Assets:** Stocks.
**Novelty / implementation angle:** Inspired by 52-week-high evidence but made conditional on intermediate momentum.[9]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T06 - Industry-to-stock momentum cascade
**Core rule:** rank industry momentum, then rank stocks within winning industries by idiosyncratic residual momentum.
**Assets:** Stocks.
**Novelty / implementation angle:** Makes the industry effect the gate and stock effect the selector.[8]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T07 - Trend convexity filter
**Core rule:** fit quadratic log-price model; prefer trends where curvature reinforces slope and reject opposite-curvature trends.
**Assets:** Futures/ETFs.
**Novelty / implementation angle:** Attempts to avoid linear-trend late entries by modeling path shape.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T08 - Cross-asset confirmation trend
**Core rule:** trade instrument only if at least 2 of: sector proxy, benchmark index, related future, or currency input confirm direction.
**Assets:** Stocks, sector ETFs, commodities.
**Novelty / implementation angle:** Signal becomes a network-consistency test rather than a single chart.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T09 - Trend breadth pulse
**Core rule:** for equity universe, compute fraction above 20/50d trend; enter index exposure when breadth impulse leads price.
**Assets:** Indices/ETFs.
**Novelty / implementation angle:** Uses cross-sectional participation as leading confirmation.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T10 - Volatility-of-volatility trend
**Core rule:** trend signal weighted by change in realized vol; increase weight when vol rises modestly with directional persistence, cut when vol becomes chaotic.
**Assets:** Futures/ETFs.
**Novelty / implementation angle:** Distinguishes productive volatility expansion from disorder.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T11 - Time-under-water recovery trend
**Core rule:** measure fraction of last 60 sessions spent below rolling high; buy assets whose drawdown is repairing while 20d momentum turns positive.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Targets trend resumption after repair, not fresh breakouts.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T12 - Multi-speed trend voting
**Core rule:** vote across 5, 13, 34, 89, 233 bars; position only if weighted vote exceeds confidence threshold; weights learned on rolling walk-forward.
**Assets:** All liquid bars.
**Novelty / implementation angle:** Turns a binary trend rule into a confidence-weighted ensemble.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T13 - Trend disagreement arbitrage
**Core rule:** if price trend is strong but cross-sectional rank trend is weak, reduce/avoid; if both align, add.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Uses the difference between time-series and cross-sectional momentum as a quality signal.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T14 - Gap-resolved continuation
**Core rule:** after large overnight gap, wait N bars; if price holds > 60% of gap direction and intraday trend resumes, trade continuation.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Separates informational gaps from mean-reverting gaps.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T15 - Funding-aware trend
**Core rule:** directional asset trend adjusted by change in funding proxy (USD, real yields, credit spread); require funding tailwind for high-beta longs.
**Assets:** Equities, crypto, FX.
**Novelty / implementation angle:** Embeds macro funding conditions into trend eligibility.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### T16 - Trend with structural stop migration
**Core rule:** initial stop = k*ATR; thereafter migrate stop by max(previous stop, rolling swing + buffer) and freeze widening.
**Assets:** All liquid assets.
**Novelty / implementation angle:** Treats stop placement as a dynamic state machine, not a static indicator.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Mean Reversion / Reversal
Short-horizon reversal can coexist with longer-horizon momentum. The testable edge is often conditional: liquidity stress, gap magnitude, volatility state, and crowding determine whether a move is likely to continue or mean-revert.
**Best starting universe:** Liquid equities/ETFs, index futures, FX, highly liquid crypto, pairs.

### MR01 - ATR-scaled intraday stretch fade
**Core rule:** z = (price - VWAP)/ATR; fade only when |z|>2 and spread/liquidity remain healthy; exit at VWAP or timed horizon.
**Assets:** Stocks/ETFs/futures.
**Novelty / implementation angle:** Avoid fading when news shock or trend regime says continuation is dominant.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR02 - Close-location reversal
**Core rule:** buy after statistically rare low close-location day when next-session liquidity normalizes; inverse for shorts.
**Assets:** Stocks.
**Novelty / implementation angle:** Uses candle location rather than oscillator values.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR03 - Gap-to-range reversion
**Core rule:** fade opening gap when gap/ATR is extreme and premarket/overnight proxy lacks confirmation.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Pairs naturally with gap continuation T14.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR04 - Residual mean reversion
**Core rule:** regress stock on sector + market; trade residual z-score around its mean.
**Assets:** Stocks.
**Novelty / implementation angle:** Classic relative value reframed as single-name residual mean reversion.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR05 - Cross-sectional shock rebound
**Core rule:** rank one-day residual returns; fade extreme losers/winners only when market-wide shock breadth exceeds threshold.
**Assets:** Stocks.
**Novelty / implementation angle:** Activates after systemic shocks where liquidity dislocations may be broad.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR06 - Volatility-adjusted Bollinger reversal
**Core rule:** bands based on forecast volatility instead of sample std; fade only when forecast and realized volatility disagree.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** The band itself adapts to a separate volatility model.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR07 - Drawdown velocity snapback
**Core rule:** measure d(drawdown)/dt; fade unusually fast drawdowns after velocity collapses.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Looks for exhaustion in the *rate* of decline.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR08 - Liquidity shock normalization
**Core rule:** Amihud-like illiquidity z-score spike followed by partial normalization triggers reversal.
**Assets:** Stocks.
**Novelty / implementation angle:** Uses liquidity recovery as confirmation.[17]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR09 - VWAP displacement with order-flow stabilization
**Core rule:** enter fade when displacement is extreme but signed flow imbalance stops worsening.
**Assets:** Intraday stocks/ETFs.
**Novelty / implementation angle:** Combines price distance with flow stabilization.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR10 - Range compression breakout-fade hybrid
**Core rule:** after compression, first break is faded if order-flow confirmation is weak; switch to trend if second break confirms.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** State machine allows reversal and breakout logic to coexist.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR11 - Close-to-close vs intraday decomposition
**Core rule:** trade when overnight and intraday return components diverge unusually from their rolling relationship.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Cross-component dislocation signal.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MR12 - Mean reversion with crowding veto
**Core rule:** fade extreme move only if short-interest/positioning/correlation crowding is below danger threshold.
**Assets:** Stocks/ETFs/futures.
**Novelty / implementation angle:** Avoids stepping in front of crowded unwind continuation.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Cross-sectional Factors
Cross-sectional portfolios can exploit relative rather than absolute forecasts. Evidence across momentum, value, quality and ML models motivates nonlinear ranking and interaction discovery.[7][10][11][12]
**Best starting universe:** Stocks, ETFs, futures curves, FX crosses, global macro instruments.

### CF01 - Nonlinear momentum-value blend
**Core rule:** rank momentum, value and quality; interact them with a tree model; long highest predicted residual return, short lowest.
**Assets:** Stocks.
**Novelty / implementation angle:** Do not optimize raw PnL; predict cross-sectional residuals.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF02 - Quality momentum divergence
**Core rule:** long high-quality firms with accelerating momentum; short junk firms with deteriorating momentum.
**Assets:** Stocks.
**Novelty / implementation angle:** Uses QMJ concepts as a state gate.[11]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF03 - Value mean-reversion with momentum veto
**Core rule:** trade cheap-vs-expensive pairs only when momentum divergence is weak enough.
**Assets:** Stocks.
**Novelty / implementation angle:** Attempts to avoid catching value traps.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF04 - Liquidity premium conditioned on quality
**Core rule:** allow illiquidity exposure only for high-quality names with improving earnings/price trend.
**Assets:** Stocks.
**Novelty / implementation angle:** Combines liquidity premium with survivability.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF05 - Industry-neutral residual factor stack
**Core rule:** orthogonalize momentum/value/quality within industry and size buckets; ensemble ranks.
**Assets:** Stocks.
**Novelty / implementation angle:** Reduces hidden sector bets.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF06 - Factor timing by dispersion
**Core rule:** scale factor book when cross-sectional dispersion is high, cut when dispersion collapses.
**Assets:** Stocks.
**Novelty / implementation angle:** Expected factor return may depend on opportunity set width.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF07 - Factor crash detector
**Core rule:** train classifier on factor spreads, vol, correlation and drawdown to detect factor unwind risk; cut factor gross when crash probability rises.
**Assets:** Stocks.
**Novelty / implementation angle:** AI is a risk controller, not just predictor.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF08 - Characteristic attention model
**Core rule:** small transformer attends over a stock's time-varying characteristics rather than raw price only.
**Assets:** Stocks.
**Novelty / implementation angle:** Inspired by AI asset-pricing work using nonlinear interactions and cross-asset information.[13]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF09 - Peer-relative earnings revision momentum
**Core rule:** rank firms by change in analyst revisions relative to industry revision trend.
**Assets:** Stocks.
**Novelty / implementation angle:** Looks for information diffusion at the peer level.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF10 - Balance-sheet momentum
**Core rule:** rank direction and acceleration of leverage, margins, cash flow and buybacks, then combine with price momentum.
**Assets:** Stocks.
**Novelty / implementation angle:** Fundamental momentum is slower, so hold longer than price signal.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF11 - Crowding-adjusted factor selection
**Core rule:** choose factor legs with best expected return / crowding / liquidity composite.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Turns factor allocation into an opportunity-vs-crowding decision.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### CF12 - Factor trend-following
**Core rule:** trade the *factor spread* itself with trend rules; long factors whose recent spread is rising, short falling.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Factor-level trend is a portable market-neutral overlay.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Relative Value / Statistical Arbitrage
Relative-value strategies exploit stable relationships, latent common factors, and temporary dislocations. Pair selection must be dynamic; static pairs are vulnerable to structural breaks.[18][19]
**Best starting universe:** Stocks/ETFs, futures curves, FX baskets, rates spreads.

### RV01 - Dynamic cointegration pairs
**Core rule:** rolling Johansen/Engle-Granger candidates; trade residual z-scores with half-life and stability filters.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Re-estimate only on expanding/rolling windows to control leakage.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV02 - PCA residual mean reversion
**Core rule:** remove top k market/sector PCs; trade extreme residuals with liquidity constraints.
**Assets:** Large-cap stocks.
**Novelty / implementation angle:** Closely related to statistical arbitrage frameworks.[19]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV03 - Basket vs constituent dislocation
**Core rule:** construct beta-weighted basket; trade constituent-vs-basket residual extremes.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Useful around index/ETF flows.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV04 - ETF NAV proxy dislocation
**Core rule:** compare ETF price to live synthetic basket proxy; trade only when execution cost is below modeled edge.
**Assets:** ETFs.
**Novelty / implementation angle:** Execution realism is the strategy.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV05 - Future-vs-ETF basis mean reversion
**Core rule:** trade basis after adjusting for carry, dividends and funding.
**Assets:** Index futures/ETFs.
**Novelty / implementation angle:** Explicitly model fair value before signal.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV06 - Curve butterfly statistical arb
**Core rule:** fit local curve factor model; trade curvature residuals in rates/commodities.
**Assets:** Futures/options where permitted.
**Novelty / implementation angle:** Uses shape rather than outright direction.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV07 - Cross-market lead-lag residual
**Core rule:** predict asset B from lagged returns/order flow of A; trade residual only if relation is stable.
**Assets:** Related ETFs/futures/FX.
**Novelty / implementation angle:** Search only among economically connected pairs to reduce data mining.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV08 - Volatility surface relative value
**Core rule:** fit smooth smile/surface; trade options with surface residuals after delta/vega normalization.
**Assets:** Options.
**Novelty / implementation angle:** Needs executable quotes and conservative fills.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV09 - Calendar spread z-score
**Core rule:** trade futures calendar spreads based on normalized seasonal/carry-adjusted residuals.
**Assets:** Commodities/rates.
**Novelty / implementation angle:** Explicitly models roll and storage/carry.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV10 - Cross-asset beta residual
**Core rule:** estimate dynamic beta to macro drivers; trade residual return when confidence interval excludes zero.
**Assets:** Stocks/commodities/FX.
**Novelty / implementation angle:** Betas evolve; use uncertainty-aware triggers.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV11 - Pair-break monitor
**Core rule:** detect parameter drift via residual variance, half-life and sign consistency; flatten before the relationship fails.
**Assets:** Pairs/baskets.
**Novelty / implementation angle:** The exit is model failure, not just a stop.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### RV12 - Relative-value ensemble selector
**Core rule:** run 4-6 RV models per universe; allocate only to dislocations confirmed by 2+ structurally distinct models.
**Assets:** All RV assets.
**Novelty / implementation angle:** Ensemble diversity is used as confirmation and anti-overfit filter.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Event / News / Information
Information often arrives discretely, and the timing/quality of price response matters. NLP is more useful as a structured feature source than as a free-form trade oracle; fundamental momentum can complement price momentum.[12]
**Best starting universe:** Stocks, ETFs, rates, FX; options for carefully bounded event trades.

### EV01 - Earnings surprise continuation
**Core rule:** standardized surprise + revenue surprise + guidance direction; trade post-event continuation with volatility-scaled exit.
**Assets:** Stocks.
**Novelty / implementation angle:** Use only timestamped data available before signal.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV02 - Earnings drift with quality gate
**Core rule:** post-earnings move + quality score + revision direction; hold 5-30 sessions.
**Assets:** Stocks.
**Novelty / implementation angle:** Adds survivability filter to classic post-event drift.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV03 - News novelty impulse
**Core rule:** embed headline/article; novelty vs prior company news + sentiment + entity risk; trade abnormal return only when surprise is high.
**Assets:** Stocks.
**Novelty / implementation angle:** Novelty matters more than generic positive sentiment.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV04 - Transcript delta
**Core rule:** compare current call embedding to company's rolling transcript centroid; trade change in management language after controlling for price.
**Assets:** Stocks.
**Novelty / implementation angle:** Searches for semantic drift, not sentiment level.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV05 - Guidance credibility
**Core rule:** compare current guidance surprise to historical guidance accuracy; weight signals by management credibility.
**Assets:** Stocks.
**Novelty / implementation angle:** A 10% surprise from a serially wrong guide should be treated differently.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV06 - Event-volatility mispricing
**Core rule:** compare implied move to model forecast move using historical event-conditioned distribution.
**Assets:** Options.
**Novelty / implementation angle:** Trade only when edge exceeds spread + slippage + volatility model error.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV07 - Sector contagion after news
**Core rule:** map news event to peer graph; trade lagging peers when peer-impact model predicts spillover.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Graph propagation rather than direct headline reaction.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV08 - Regime-specific news classifier
**Core rule:** same text can matter differently in inflationary, recessionary or risk-off regimes; train separate models or conditional heads.
**Assets:** Stocks/macro.
**Novelty / implementation angle:** Conditioning can reduce sign flips.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV09 - Macro release surprise basket
**Core rule:** trade basket of sensitive instruments from surprise relative to consensus, not raw release value.
**Assets:** Rates/FX/indices.
**Novelty / implementation angle:** Predefine surprise calculation and release timestamps.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV10 - News-to-flow confirmation
**Core rule:** require NLP signal + volume/order-flow confirmation; ignore text-only signals without market response.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Treat price/flow as a second sensor.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV11 - Event aftershock fade
**Core rule:** after extreme event gap, classify whether move is information or liquidity; fade only the latter.
**Assets:** Stocks.
**Novelty / implementation angle:** Combines event language with microstructure.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### EV12 - Fundamental momentum vs price momentum conflict
**Core rule:** when fundamentals improve while price momentum weakens, enter only after technical confirmation; symmetric bearish case.
**Assets:** Stocks.
**Novelty / implementation angle:** Attempts to exploit lag between fundamental and price information.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Microstructure / Intraday
At intraday horizons, queue position, order-flow imbalance, spread, volatility, and latency dominate. LOB research demonstrates predictive structure but transferability and costs are critical; market-making/RL approaches require realistic simulators.[22][23][26][27][28]
**Best starting universe:** Most liquid stocks/ETFs, index futures, FX where data quality permits.

### MI01 - Multi-level order-flow imbalance
**Core rule:** aggregate signed depth changes over 5-20 book levels, exponentially weighted; trade when imbalance is extreme and spread stable.
**Assets:** Liquid LOB assets.
**Novelty / implementation angle:** Inspired by order-book event impact research.[22]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI02 - Queue depletion hazard
**Core rule:** estimate probability best bid/ask queue will deplete before replenishment using recent cancellations/trades.
**Assets:** Liquid stocks/futures.
**Novelty / implementation angle:** Trade only with enough depth to model queue dynamics.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI03 - Microprice deviation
**Core rule:** microprice - mid normalized by spread; trade toward predicted microprice only if imbalance confirms.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Classical microstructure signal used as a building block, not standalone alpha.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI04 - Spread-widening anticipation
**Core rule:** predict spread expansion from volatility/imbalance; reduce passive quoting or delay entries ahead of expansion.
**Assets:** Stocks.
**Novelty / implementation angle:** Execution alpha rather than direction alpha.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI05 - Trade-sign burst continuation
**Core rule:** detect Hawkes-like burst in same-side trades, but require exhaustion probability below threshold.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Separates informed continuation from mechanical burst exhaustion.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI06 - Hidden liquidity inference
**Core rule:** infer iceberg/hidden liquidity from repeated prints near same price; trade around defended levels.
**Assets:** Highly liquid markets.
**Novelty / implementation angle:** Requires tick/print history and careful fill simulation.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI07 - Opening auction imbalance fade/continuation classifier
**Core rule:** combine opening imbalance, gap, premarket trend and sector direction; choose continuation vs fade regime.
**Assets:** Stocks.
**Novelty / implementation angle:** Auction context selects between opposing strategies.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI08 - VWAP trajectory deviation
**Core rule:** forecast expected intraday VWAP path; trade deviations conditional on flow and time-of-day.
**Assets:** Stocks/ETFs.
**Novelty / implementation angle:** Uses intraday seasonality as a prior.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI09 - Latency-adverse quote filter
**Core rule:** estimate expected adverse move during order round-trip; reject passive orders if expected loss > spread capture.
**Assets:** Liquid markets.
**Novelty / implementation angle:** Execution rule, not alpha; directly aligned with current market-making research.[28]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI10 - Book shock recovery
**Core rule:** after sudden depth collapse, wait for 2-stage depth restoration; trade only when price remains inside pre-shock range.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Targets transient microstructure shocks.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI11 - Volume-clock momentum
**Core rule:** sample in volume bars instead of time bars; momentum trigger after fixed traded-volume information.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Reduces time-bar heteroskedasticity.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MI12 - Meta-label intraday veto
**Core rule:** primary entry signal from simple momentum/reversion; classifier predicts whether the next trade is likely favorable net of costs; trade only positive meta-label.
**Assets:** Stocks/futures.
**Novelty / implementation angle:** Meta-labeling keeps the model's job small and testable.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Volatility / Options
Options embed risk-neutral expectations, skew and volatility risk premia. The edge can come from forecast-vs-implied discrepancies, surface relative value, or dynamic hedging; short-volatility strategies must be evaluated for tail risk and transaction costs.[20][21][25]
**Best starting universe:** Equity/index options, ETF options, futures options where available.

### VO01 - Implied-vs-realized volatility spread
**Core rule:** forecast realized vol with HAR/ML; trade implied variance only when expected edge exceeds costs and tail buffer.
**Assets:** Index options.
**Novelty / implementation angle:** Prefer defined-risk structures over naked short vol.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO02 - Event implied-move decomposition
**Core rule:** compare implied event move to historical conditional move distribution and current regime.
**Assets:** Earnings/index events.
**Novelty / implementation angle:** Separate event variance from baseline variance.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO03 - Skew term-structure reversion
**Core rule:** model delta-weighted skew by maturity; trade residuals to a smooth cross-sectional surface.
**Assets:** Options.
**Novelty / implementation angle:** Residual surface signal rather than raw skew level.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO04 - Put-call skew relative value
**Core rule:** trade skew spread between similar underlyings after beta and maturity normalization.
**Assets:** Index/sector options.
**Novelty / implementation angle:** Relative value reduces direction exposure.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO05 - Variance risk premium carry with crash brake
**Core rule:** sell defined-risk variance exposure only when VRP positive and crash classifier probability low.
**Assets:** Index options.
**Novelty / implementation angle:** VRP evidence exists but crash control is mandatory.[20]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO06 - Gamma scalping with forecast-vol gate
**Core rule:** buy near-term gamma when forecast realized vol > implied by sufficient margin; delta hedge using rules.
**Assets:** Liquid options.
**Novelty / implementation angle:** P&L must include spread, hedge slippage and decay.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO07 - Calendar vol spread
**Core rule:** trade front-vs-back IV when term structure deviates from regime-conditioned expectation.
**Assets:** Index/ETF options.
**Novelty / implementation angle:** Use regime-conditioned curves, not unconditional z-scores.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO08 - Surface PCA factor reversal
**Core rule:** PCA decompose implied vol surface changes; trade factor shocks that historically mean-revert.
**Assets:** Liquid option chains.
**Novelty / implementation angle:** Requires dense, synchronized surface data.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO09 - Vol-of-vol momentum
**Core rule:** trade exposure to changes in implied vol dispersion/skew rather than level.
**Assets:** Index options.
**Novelty / implementation angle:** Targets a less-crowded second-order vol factor.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO10 - Delta-hedged option mispricing basket
**Core rule:** rank options by model residual after delta/vega standardization; long rich/cheap baskets.
**Assets:** Options.
**Novelty / implementation angle:** Portfolio, not single-contract, construction reduces idiosyncratic noise.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO11 - Implied correlation relative value
**Core rule:** compare index implied vol against component implied vols to infer correlation residual; trade dispersion/anti-dispersion with strict risk caps.
**Assets:** Index + component options.
**Novelty / implementation angle:** Complex but potentially diversified across stocks.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### VO12 - Dynamic hedging policy learner
**Core rule:** RL/actor model chooses hedge frequency and size to minimize risk + transaction cost for a fixed derivative book.
**Assets:** Options.
**Novelty / implementation angle:** Inspired by deep hedging under market frictions.[25]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Macro / Carry / Curves
Carry and trend can exist across currencies, commodities, rates and equity factors, but funding shocks can cause violent reversals. The system should explicitly measure funding, convexity and crowding.[10][30]
**Best starting universe:** FX, rates futures, commodity futures, equity index futures.

### MA01 - Cross-asset carry rank
**Core rule:** estimate carry yield net of volatility, margin and roll; long high carry, short low carry with crash filter.
**Assets:** FX/futures.
**Novelty / implementation angle:** Use a common risk unit to compare disparate carry sources.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA02 - Carry + momentum interaction
**Core rule:** carry only active when price momentum agrees; reduce when momentum contradicts strongly.
**Assets:** FX/commodities/rates.
**Novelty / implementation angle:** Attempts to avoid classic carry crash periods.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA03 - Yield-curve shape trend
**Core rule:** trade trend in 2s10s/5s30s or analogous curves, not just outright duration.
**Assets:** Rates.
**Novelty / implementation angle:** Shape trend is a less direct trend-following target.[6]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA04 - Curve butterfly mean reversion
**Core rule:** trade curvature residual after level/slope controls.
**Assets:** Rates.
**Novelty / implementation angle:** Orthogonalize before trading.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA05 - Commodity seasonality + carry + momentum
**Core rule:** combine seasonal expected return, current carry and medium-term trend.
**Assets:** Commodities.
**Novelty / implementation angle:** Triple confirmation across distinct mechanisms.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA06 - Funding stress switch
**Core rule:** estimate funding stress index from USD, credit spreads, cross-currency basis proxies; cut risky carry exposure when stress jumps.
**Assets:** FX/equities/commodities.
**Novelty / implementation angle:** Risk overlay can be more valuable than incremental alpha.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA07 - Real-yield relative momentum
**Core rule:** trade asset exposures conditional on real-yield trend rather than nominal yield alone.
**Assets:** Rates/equities/gold.
**Novelty / implementation angle:** Attempts to distinguish growth/inflation effects.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA08 - Inflation beta rotation
**Core rule:** estimate rolling inflation shock betas; rotate among commodities, equities, rates.
**Assets:** Macro futures/ETFs.
**Novelty / implementation angle:** Dynamic beta portfolio.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA09 - Dollar-network pressure
**Core rule:** construct USD strength across G10/EM, then trade currencies with largest residual deviations.
**Assets:** FX.
**Novelty / implementation angle:** Network aggregation rather than single-pair forecasting.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA10 - Policy divergence momentum
**Core rule:** rank central-bank policy surprises and directional rate paths; trade currencies/rates accordingly.
**Assets:** FX/rates.
**Novelty / implementation angle:** Needs timestamped macro data with revision handling.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA11 - Cross-asset crisis carry unwind
**Core rule:** when funding currency strengthens + cross-asset correlations spike + volatility jumps, reverse crowded carry basket.
**Assets:** FX/equity/rates.
**Novelty / implementation angle:** Designed for regime transitions, not average carry.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### MA12 - Macro regime mixture-of-experts
**Core rule:** gating model selects among trend, carry and mean-reversion experts based on rates/vol/correlation state.
**Assets:** Macro futures/FX.
**Novelty / implementation angle:** Model chooses strategy family rather than direct direction.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## AI / Meta-Strategy / Portfolio Intelligence
The most robust use of AI is often to choose when simple strategies should or should not trade, estimate nonlinear interactions, forecast risk, detect regime changes, and allocate among diverse experts. Academic evidence supports nonlinear ML for return prediction while emphasizing difficult data problems and overfitting concerns.[12][13][14][15][16]
**Best starting universe:** All supported liquid assets.

### AI01 - Meta-label router
**Core rule:** base signals from 10-20 simple strategies; gradient-boosted model predicts expected net trade outcome; only act above calibrated threshold.
**Assets:** All.
**Novelty / implementation angle:** Separates signal generation from trade selection.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI02 - Regime mixture-of-experts
**Core rule:** HMM/HSMM or neural state model chooses among trend, mean reversion, carry, event and RV experts.
**Assets:** All.
**Novelty / implementation angle:** Directly builds on regime-switching literature.[14]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI03 - Cross-asset transformer forecaster
**Core rule:** tokens = instruments; features = returns, vol, volume, carry, spreads; predict relative return and covariance.
**Assets:** All.
**Novelty / implementation angle:** Inspired by transformer asset-pricing work with cross-asset information sharing.[13]

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI04 - Graph lead-lag model
**Core rule:** nodes = assets; edges from rolling correlation/lead-lag/stable economic links; graph model predicts residual return.
**Assets:** Stocks/ETFs/futures/FX.
**Novelty / implementation angle:** Forces the AI to use relational information.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI05 - Uncertainty-aware ensemble
**Core rule:** ensemble trees/NNs; trade only when predictive dispersion and conformal interval width are both below policy thresholds.
**Assets:** All.
**Novelty / implementation angle:** Confidence is tied to forecast uncertainty, not softmax confidence.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI06 - Adversarial market perturbation training
**Core rule:** train model against synthetic slippage, delay, regime changes and missing features; require performance under perturbations.
**Assets:** All.
**Novelty / implementation angle:** Optimization target is robustness, not raw backtest return.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI07 - Online-learning drift detector
**Core rule:** monitor feature distribution, residual distribution, hit-rate, calibration and PnL attribution; retrain or quarantine on drift.
**Assets:** All.
**Novelty / implementation angle:** Makes adaptation explicit and gated.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.

### AI08 - Strategy discovery by grammar search
**Core rule:** LLM proposes symbolic strategies from a fixed operator grammar; program compiles to code; evaluator applies purged walk-forward + cost model; survivors face new holdout.
**Assets:** All.
**Novelty / implementation angle:** LLM is a generator, not the judge.

**Test matrix:**
- Horizons: fast, medium, slow versions; do not assume one lookback is canonical.
- Execution: marketable limit vs passive limit vs VWAP/TWAP-style benchmark.
- Risk: ATR, realized-vol, forecast-vol, and fixed-risk-per-trade sizing.
- Stress: doubled spread, doubled slippage, missing ticks, one-bar signal delay, random 10-50ms execution delay for intraday models where data permit.


## Novel hybrid strategies
### HX01 - Trend-mean-reversion phase transition
**Rule:** Use compression + trend slope + order-flow stabilization to decide whether the next extreme move is likely continuation or snapback; do not commit until classifier crosses a calibrated probability threshold.
**Assets:** Liquid stocks/ETFs/futures
**Why test it:** State switch strategy.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX02 - Momentum residual after macro beta removal
**Rule:** Predict each stock from market, sector, rate, USD and commodity factors; trade only the residual momentum component.
**Assets:** Stocks
**Why test it:** Removes macro beta from momentum.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX03 - 52-week-high + liquidity recovery
**Rule:** Buy near-high stocks only after an illiquidity spike normalizes, filtering out orderly trends from stressed breakouts.
**Assets:** Stocks
**Why test it:** Combines long-horizon anchoring with liquidity state.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX04 - Carry + factor crowding brake
**Rule:** Take carry only when factor crowding proxy is falling and funding stress is benign.
**Assets:** FX/commodities/rates
**Why test it:** Crash-sensitive carry.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX05 - Event novelty + cross-sectional confirmation
**Rule:** Trade news shock only if peer returns and peer news confirm the direction; otherwise fade or ignore.
**Assets:** Stocks
**Why test it:** Uses network confirmation.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX06 - Option surface residual + price trend
**Rule:** Trade option residuals only when underlying price trend provides directional context for hedge intensity.
**Assets:** Options
**Why test it:** Links derivative RV to underlying state.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX07 - Order-flow shock + residual mean reversion
**Rule:** After book imbalance shock, trade stock residual only if sector basket does not confirm the shock.
**Assets:** Liquid stocks
**Why test it:** Microstructure dislocation within sector neutrality.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX08 - Factor dispersion timing + regime gate
**Rule:** Scale cross-sectional factor books by dispersion and volatility regime jointly.
**Assets:** Stocks
**Why test it:** Opportunity and risk jointly set gross exposure.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX09 - Curve shape trend + carry
**Rule:** Trade curve spread direction when current carry points same way; halve risk when opposing.
**Assets:** Rates
**Why test it:** Directional + carry agreement.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX10 - Portfolio breadth + transformer ranking
**Rule:** Use breadth as market-level gate; transformer ranks individual names within the allowed side of the market.
**Assets:** Stocks/ETFs
**Why test it:** Separates market and stock decisions.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX11 - Dynamic pair selection by representation learning
**Rule:** Embed rolling price/volume/fundamental trajectories; nearest-neighbor pairs are re-tested for cointegration before activation.
**Assets:** Stocks/ETFs
**Why test it:** Pairs selected by learned similarity, then filtered by statistics.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX12 - Vol forecast disagreement basket
**Rule:** Long assets where model A and model B disagree on volatility and divergence predicts realized-vs-implied opportunities.
**Assets:** Options
**Why test it:** Model disagreement becomes a signal.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX13 - Overnight/intraday component rotation
**Rule:** Choose to hold overnight or only intraday based on which component currently exhibits cleaner predictability and lower cost.
**Assets:** Stocks/ETFs
**Why test it:** Strategy horizon is adaptive.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX14 - Trade-cost-aware signal shrinking
**Rule:** Continuously shrink alpha forecasts by estimated spread + slippage + impact; only trade when net edge survives a worst-case cost band.
**Assets:** All
**Why test it:** Execution-aware alpha.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX15 - Regime-conditioned factor momentum
**Rule:** Trend each factor's spread, but only activate when the macro regime historically supports that factor.
**Assets:** Stocks
**Why test it:** Factor timing via trend and regime.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX16 - Lead-lag with structural-break veto
**Rule:** Trade cross-asset lead-lag residuals only while relation diagnostics remain stable; quarantine on Chow/CUSUM-like break evidence.
**Assets:** Cross-asset
**Why test it:** Explicit relationship lifecycle.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX17 - Meta-label stop policy
**Rule:** Base strategy decides direction; a separate model predicts adverse excursion and selects stop distance / time stop from a discrete policy set.
**Assets:** All
**Why test it:** AI governs risk mechanics, not direction.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX18 - Portfolio correlation shock hedge
**Rule:** When correlations jump beyond forecast, automatically reduce clustered positions and add the most diversifying strategy with positive expected return.
**Assets:** Multi-asset
**Why test it:** Adaptive diversification as alpha/risk control.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX19 - Strategy family disagreement allocator
**Rule:** Allocate capital toward signals where independent families agree, but cap exposure when all families become correlated.
**Assets:** All
**Why test it:** Agreement + anti-crowding portfolio rule.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.

### HX20 - Research-to-production survival ladder
**Rule:** Each candidate must graduate from synthetic sanity tests -> historical backtest -> purged walk-forward -> cross-asset test -> delayed paper trading -> small live allocation; capital scales only after stability milestones.
**Assets:** All
**Why test it:** The process itself is a strategy-selection edge.
**Promotion condition:** the edge must remain after transaction-cost inflation and after freezing all model architecture choices before the final holdout.


# Portfolio-level strategy recipes
### R01 - Trend core + reversal satellite
Allocate to T01/T12/T16, add MR02/MR08 only when trend exposure is low; target low portfolio correlation rather than equal dollars.

### R02 - Factor engine
Combine CF01/CF02/CF06 with industry neutralization; use AI07 as a drift controller.

### R03 - Market-neutral RV stack
Combine RV01/RV02/RV10 with pair-break diagnostics and a common residual risk budget.

### R04 - Event engine
EV01/EV03/EV09 with event-vol option overlay VO02; route only when surprise confidence is high.

### R05 - Intraday microstructure
MI01/MI03/MI08/MI12 with a strict liquidity eligibility service and session-aware risk limits.

### R06 - Volatility book
VO01/VO03/VO07 plus defined-risk tails; hedge based on forecast vol and correlation stress.

### R07 - Macro barbell
MA02/MA03/MA06/MA12; pair carry with trend and funding-stress control.

### R08 - AI router
AI01 chooses among all non-AI strategies; AI05 determines whether to act; AI07 can quarantine a strategy.

### R09 - Agreement basket
Only trade signals where three independent families agree, capped by correlation and crowding.

### R10 - Adversarial portfolio
Every candidate is tested under slippage, delay, spread and volatility perturbations; capital only follows strategies that survive the perturbation grid.

### R11 - Horizon rotation
AI/logic selects whether a signal should be expressed intraday, overnight, swing or through options based on predicted edge / cost / gap risk.

### R12 - Capacity-aware allocator
Expected net alpha divided by forecast market impact and turnover sets the capital weight; not raw Sharpe.

# AI research loop
## 1. Generate
The lead agent should generate strategies using a fixed grammar of operators rather than free-form improvisation. Suggested primitives: return, range, ATR, realized vol, forecast vol, volume, signed volume, order-book imbalance, VWAP displacement, gap, breadth, factor ranks, carry, term structure, implied vol, skew, residual, correlation, beta, embeddings, and regime state. Operators should include rank, z-score, percentile, slope, acceleration, interaction, residualization, change-point, threshold, vote, ensemble, and portfolio allocation.

## 2. Compile
Every strategy must compile to a machine-readable specification: universe, feature timestamps, formula, trigger, position side, target risk, max holding time, stop, profit logic, time exit, allowed order types, cost model, and invalidation rules. No strategy may exist only as prose.

## 3. Judge
The model that proposes a strategy must not be the final judge of its own strategy. Use a separate evaluator or frozen rules. Track a research ledger containing every candidate, parameter set, backtest sample, failure reason, and promotion state. This directly addresses the multiple-testing problem emphasized in the backtest-overfitting and false-discovery literature.[15][16]

## 4. Promote
A practical promotion ladder is: (A) synthetic data sanity; (B) historical train; (C) walk-forward validation; (D) unseen time block; (E) unseen assets; (F) paper-live; (G) tiny live capital; (H) scale only after live distribution matches expected distribution.

# Position sizing and risk controls
- Risk budget per trade should be based on forecast volatility and stop distance, not price level.
- Use fractional Kelly only after estimating edge uncertainty; a highly uncertain edge should receive a small fraction of theoretical Kelly.
- Cap correlated bets at the portfolio level; five different strategies on the same tech names are one risk cluster.
- Use a portfolio drawdown governor that reduces gross exposure after statistically unusual losses; do not use a fixed drawdown halt without a recovery policy.
- Model tail dependence: correlation often rises during stress, so covariance estimated in calm periods can understate crisis risk.
- Do not let an AI model widen stops to avoid losses. The stop policy must be bounded and auditable.
- For options, constrain net delta, gamma, vega, theta, jump exposure, and assignment/expiration events.
- For short-selling, verify borrow and hard-to-borrow economics before counting the trade as executable.

# Execution playbook
Execution can erase weak alpha. Use an order-decision layer independent of the signal layer. The execution policy chooses marketable limit, passive limit, midpoint, adaptive limit, or time-sliced execution based on spread, predicted short-horizon volatility, expected queue survival, and urgency. For multi-leg/attached orders, maintain explicit parent-child state and confirm transmission/acknowledgment transitions; IBKR documents bracket transmission behavior and order fields such as parentId and orderId.[3][4]

For intraday research, backtests should record expected arrival price, actual simulated fill, slippage in basis points, and time-to-fill. For passive orders, the simulator should model order cancellation, queue loss, and adverse selection. A strategy that is profitable only under midpoint fills should be presumed invalid until live paper results prove otherwise.

# IBKR engineering checklist
- Cache contract metadata and avoid re-querying the same security definition unnecessarily.
- Respect current Web API pacing. As of September 9, 2026, history requests are capped at 10/sec or 50/min; build a token-bucket scheduler rather than firing parallel bursts.[2]
- Keep raw and normalized timestamps. Never mix exchange-local timestamps, broker timestamps and model timestamps without an explicit conversion layer.
- Persist order IDs, parent IDs, perm IDs, filled quantities, average fill price, status transitions and timestamps.
- After reconnect, rebuild state from broker truth rather than assuming local state survived.
- Use paper trading to validate order semantics but do not infer fill realism from paper fills without an execution comparison.
- Separate market-data collection from order submission so a data backlog cannot block risk exits.
- Implement hard kill-switches outside the strategy process: maximum daily loss, maximum gross notional, maximum order rate, stale-data timeout, and account-state mismatch.

# Research scorecard

Metric | Minimum evidence | Strong evidence
---|---|---
Net Sharpe after realistic costs | positive and stable | materially positive across independent periods
Profit factor | >1 after costs | >1.2 with stable trade count
Max drawdown | bounded by strategy mandate | below risk budget across stress tests
Turnover / capacity | executable at modeled size | survives 2x cost and impact assumptions
Parameter sensitivity | no knife-edge | broad plateau
Cross-period stability | multiple windows | train/test/holdout consistency
Cross-asset stability | same mechanism transfers | transfers to unseen assets
Tail behavior | understood | explicitly stress-tested
Calibration | honest confidence | stable out-of-sample calibration
Live-paper replication | close to modeled execution | slippage within predeclared bounds

# What the lead agent should stop doing
- Stop optimizing for a single historical Sharpe ratio.
- Stop changing parameters after seeing the final holdout.
- Stop using accuracy as the primary objective; a 55% win rate can lose money and a 40% win rate can be excellent depending on payoff and costs.
- Stop treating an LLM's narrative confidence as evidence.
- Stop assuming more features automatically mean more edge.
- Stop using the same data feed and transformations for model selection and final validation without an audit trail.
- Stop counting a profitable backtest as evidence when fills, borrow, contract rolls, corporate actions, option surfaces or financing are unrealistic.

# Highest-priority experiment queue

Priority | Strategy | Why | Universe
---|---|---|---
P1 | AI01 Meta-label router | Highest leverage: lets simple, diverse strategies coexist while AI learns when not to trade. | All
P2 | AI02 Regime mixture-of-experts | Directly tests whether strategy-family selection is more robust than direct price prediction. | All
P3 | RV02 PCA residual mean reversion | Strong market-neutral architecture and efficient to test on liquid stocks. | US large/mid-cap stocks
P4 | T05 52-week-high pressure + T06 industry cascade | Combines two well-studied momentum ideas while remaining simple and auditable.[8][9] | Stocks
P5 | CF01 nonlinear momentum-value-quality | Tests ML interactions rather than raw black-box direction prediction.[10][12] | Stocks
P6 | MI12 meta-label intraday veto | Good bridge between simple microstructure signals and AI. | Liquid stocks/futures
P7 | VO01 implied-vs-realized with crash brake | Derivative alpha candidate with explicit tail controls.[20][21] | Index/ETF options
P8 | MA06 funding-stress switch | Low-complexity overlay that can improve several strategy families simultaneously. | Multi-asset
P9 | HX14 trade-cost-aware signal shrinking | Directly asks whether the signal still exists after execution economics. | All
P10 | HX20 survival ladder | Makes strategy discovery cumulative rather than one-off. | All

# Research references
[1] Interactive Brokers. *IBKR WebAPI Documentation*. 2026. https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/
[2] Interactive Brokers. *IBKR WebAPI Changelog - September 9, 2026*. 2026-09-09. https://www.interactivebrokers.com/docs/web-api/changelog/2026/9/9
[3] Interactive Brokers. *TWS API Order Reference*. 2026. https://www.interactivebrokers.com/docs/tws-api/ref/order
[4] Interactive Brokers. *Bracket Orders*. 2026. https://www.interactivebrokers.com/docs/general/order-types/complex-orders/bracket-orders
[5] Moskowitz, Ooi, Pedersen. *Time Series Momentum*. 2012. https://doi.org/10.1016/j.jfineco.2011.11.003
[6] Hurst, Ooi, Pedersen. *A Century of Evidence on Trend-Following Investing*. 2017. https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing
[7] Jegadeesh, Titman. *Returns to Buying Winners and Selling Losers*. 1993. https://doi.org/10.1111/j.1540-6261.1993.tb04702.x
[8] Moskowitz, Grinblatt. *Do Industries Explain Momentum?*. 1999. https://doi.org/10.1111/0022-1082.00146
[9] George, Hwang. *The 52-Week High and Momentum Investing*. 2004. https://doi.org/10.1111/j.1540-6261.2004.00695.x
[10] Asness, Moskowitz, Pedersen. *Value and Momentum Everywhere*. 2013. https://www.aqr.com/Insights/Research/Journal-Article/Value-and-Momentum-Everywhere
[11] Asness, Frazzini, Pedersen. *Quality Minus Junk*. 2018. https://link.springer.com/article/10.1007/s11142-018-9470-2
[12] Gu, Kelly, Xiu. *Empirical Asset Pricing via Machine Learning*. 2020. https://doi.org/10.1093/rfs/hhaa009
[13] Kelly, Kuznetsov, Malamud, Xu. *Artificial Intelligence Asset Pricing Models*. 2026 revision. https://www.nber.org/papers/w33351
[14] Kelly, Xiu. *Financial Machine Learning*. 2023. https://www.nber.org/papers/w31502
[15] Bailey, Borwein, Lopez de Prado, Zhu. *The Probability of Backtest Overfitting*. 2015. https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf
[16] Harvey, Liu. *False (and Missed) Discoveries in Financial Economics*. 2020. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3073799
[17] Amihud. *Illiquidity and Stock Returns: Cross-Section and Time-Series Effects*. 2002. https://doi.org/10.1016/S1386-4181(01)00024-6
[18] Gatev, Goetzmann, Rouwenhorst. *Pairs Trading: Performance of a Relative-Value Arbitrage Rule*. 2006. https://doi.org/10.1093/rfs/hhj020
[19] Avellaneda, Lee. *Statistical Arbitrage in the US Equities Market*. 2010. https://doi.org/10.1080/14697681003761557
[20] Carr, Wu. *Variance Risk Premia*. 2009. https://ssrn.com/abstract=1359527
[21] Carr, Wu. *Analyzing Volatility Risk and Risk Premium in Option Contracts*. 2015. https://ssrn.com/abstract=1701685
[22] Cont, Kukanov, Stoikov. *The Price Impact of Order Book Events*. 2014. https://doi.org/10.1080/14697688.2013.811638
[23] Zhang, Zohren, Roberts. *DeepLOB: Deep Convolutional Neural Networks for Limit Order Books*. 2019. https://arxiv.org/abs/1808.03668
[24] Zhang, Zohren, Roberts. *Deep Reinforcement Learning for Trading*. 2019. https://arxiv.org/abs/1911.10107
[25] Buehler et al.. *Deep Hedging*. 2018. https://arxiv.org/abs/1802.03042
[26] Spooner et al.. *Market Making via Reinforcement Learning*. 2018. https://arxiv.org/abs/1804.04216
[27] Guo, Lin, Huang. *Market Making with Deep Reinforcement Learning from Limit Order Books*. 2023. https://arxiv.org/abs/2305.15821
[28] Campi, Zabaljauregui. *Optimal Market Making Under Partial Information With General Intensities*. 2020. https://ssrn.com/abstract=3530446
[29] Moreira, Muir. *Volatility-Managed Portfolios*. 2017. https://doi.org/10.1111/jofi.12527
[30] Menkhoff, Sarno, Schmeling, Schrimpf. *Currency Momentum Strategies*. 2012. https://doi.org/10.1016/j.jmoneco.2012.05.015
[31] Cover. *Universal Portfolios*. 1991. https://doi.org/10.1214/aop/1176990228

# Expanded strategy implementation dossiers

This appendix turns each numbered strategy into a testable research object. The objective is to make it difficult for the lead agent to declare victory from a single favorable backtest. Each dossier adds economic framing, parameter ranges, feature hygiene, entry/exit design, cost assumptions, failure conditions, AI role, and live-paper requirements.


## T01 - Volatility-normalized dual-horizon trend

#### T01: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T02 - Trend acceleration / second derivative

#### T02: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T03 - Breakout persistence quality

#### T03: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T04 - Trend + volume surprise

#### T04: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T05 - 52-week-high pressure trend

#### T05: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T06 - Industry-to-stock momentum cascade

#### T06: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T07 - Trend convexity filter

#### T07: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T08 - Cross-asset confirmation trend

#### T08: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T09 - Trend breadth pulse

#### T09: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T10 - Volatility-of-volatility trend

#### T10: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T11 - Time-under-water recovery trend

#### T11: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T12 - Multi-speed trend voting

#### T12: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T13 - Trend disagreement arbitrage

#### T13: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T14 - Gap-resolved continuation

#### T14: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T15 - Funding-aware trend

#### T15: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## T16 - Trend with structural stop migration

#### T16: implementation dossier
**Family:** Trend / Momentum.
**Economic rationale:** The economic hypothesis is persistence in directional information, tempered by changing volatility and trend maturity.
**Primary measurable state variables:** lookback, trend strength, trend curvature, breakout distance, volume confirmation.
**Suggested first-pass parameter grid:** lookbacks = [20, 40, 63, 100, 126, 189, 252]; threshold = [0.5, 1.0, 1.5, 2.0] standard deviations or ATR units; stop multiplier = [1.5, 2, 2.5, 3].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The most common failure is buying a mature trend after volatility has already expanded. A second failure is hidden beta: several apparently different instruments can all be expressions of the same macro move.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR01 - ATR-scaled intraday stretch fade

#### MR01: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR02 - Close-location reversal

#### MR02: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR03 - Gap-to-range reversion

#### MR03: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR04 - Residual mean reversion

#### MR04: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR05 - Cross-sectional shock rebound

#### MR05: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR06 - Volatility-adjusted Bollinger reversal

#### MR06: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR07 - Drawdown velocity snapback

#### MR07: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR08 - Liquidity shock normalization

#### MR08: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR09 - VWAP displacement with order-flow stabilization

#### MR09: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR10 - Range compression breakout-fade hybrid

#### MR10: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR11 - Close-to-close vs intraday decomposition

#### MR11: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MR12 - Mean reversion with crowding veto

#### MR12: implementation dossier
**Family:** Mean Reversion / Reversal.
**Economic rationale:** The economic hypothesis is short-horizon price correction after temporary imbalance, with continuation regimes treated as a veto rather than an exception.
**Primary measurable state variables:** distance from fair value, shock size, liquidity recovery, order-flow stabilization, trend regime.
**Suggested first-pass parameter grid:** z thresholds = [1.5, 2.0, 2.5, 3.0]; holding windows = [5, 15, 30, 60] bars; stop distance = [1, 1.5, 2, 3] ATR.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** The classic failure is fading genuine information. A robust implementation therefore needs event/news vetoes, trend-state filters, and an explicit maximum time-in-trade.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF01 - Nonlinear momentum-value blend

#### CF01: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF02 - Quality momentum divergence

#### CF02: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF03 - Value mean-reversion with momentum veto

#### CF03: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF04 - Liquidity premium conditioned on quality

#### CF04: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF05 - Industry-neutral residual factor stack

#### CF05: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF06 - Factor timing by dispersion

#### CF06: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF07 - Factor crash detector

#### CF07: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF08 - Characteristic attention model

#### CF08: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF09 - Peer-relative earnings revision momentum

#### CF09: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF10 - Balance-sheet momentum

#### CF10: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF11 - Crowding-adjusted factor selection

#### CF11: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## CF12 - Factor trend-following

#### CF12: implementation dossier
**Family:** Cross-sectional Factors.
**Economic rationale:** The hypothesis is relative mispricing across firms: characteristics and price behavior contain information after removing common industry/market exposures.
**Primary measurable state variables:** cross-sectional rank, industry neutral rank, residual return, quality/value/liq proxy, dispersion.
**Suggested first-pass parameter grid:** rebalance = [daily, weekly, monthly]; long-short bucket = [top/bottom 5%, 10%, 20%]; neutralization = [market, sector, sector+size].
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Factor strategies can look diversified while being heavily concentrated in one macro exposure or one industry. Require factor-attribution reports and cluster concentration caps.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV01 - Dynamic cointegration pairs

#### RV01: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV02 - PCA residual mean reversion

#### RV02: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV03 - Basket vs constituent dislocation

#### RV03: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV04 - ETF NAV proxy dislocation

#### RV04: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV05 - Future-vs-ETF basis mean reversion

#### RV05: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV06 - Curve butterfly statistical arb

#### RV06: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV07 - Cross-market lead-lag residual

#### RV07: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV08 - Volatility surface relative value

#### RV08: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV09 - Calendar spread z-score

#### RV09: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV10 - Cross-asset beta residual

#### RV10: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV11 - Pair-break monitor

#### RV11: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## RV12 - Relative-value ensemble selector

#### RV12: implementation dossier
**Family:** Relative Value / Statistical Arbitrage.
**Economic rationale:** The hypothesis is that two or more instruments share latent drivers and temporary departures from their conditional relationship can mean-revert.
**Primary measurable state variables:** residual z-score, hedge ratio, half-life, cointegration stability, common-factor exposure.
**Suggested first-pass parameter grid:** formation = [60, 120, 250, 500] observations; entry z = [1.5, 2, 2.5, 3]; exit z = [0, 0.5, 1]; half-life ceiling = [10, 20, 40, 80] observations.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Relationships break. The correct failure response is often to terminate the model, not to widen the z-score threshold. Monitor residual variance, sign consistency, and hedge-ratio drift.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV01 - Earnings surprise continuation

#### EV01: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV02 - Earnings drift with quality gate

#### EV02: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV03 - News novelty impulse

#### EV03: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV04 - Transcript delta

#### EV04: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV05 - Guidance credibility

#### EV05: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV06 - Event-volatility mispricing

#### EV06: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV07 - Sector contagion after news

#### EV07: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV08 - Regime-specific news classifier

#### EV08: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV09 - Macro release surprise basket

#### EV09: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV10 - News-to-flow confirmation

#### EV10: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV11 - Event aftershock fade

#### EV11: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## EV12 - Fundamental momentum vs price momentum conflict

#### EV12: implementation dossier
**Family:** Event / News / Information.
**Economic rationale:** The hypothesis is information diffusion or under/overreaction around discrete public information, with language used as a structured timestamped feature.
**Primary measurable state variables:** surprise, novelty, sentiment delta, peer confirmation, event-implied move.
**Suggested first-pass parameter grid:** event window = [5m, 30m, 1h, 1d, 5d]; confidence threshold = calibrated quantiles; holding period chosen from conditional post-event decay curve.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Text timestamps, revisions, and market reaction can leak future information. Build point-in-time snapshots and preserve the raw source timestamp.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI01 - Multi-level order-flow imbalance

#### MI01: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI02 - Queue depletion hazard

#### MI02: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI03 - Microprice deviation

#### MI03: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI04 - Spread-widening anticipation

#### MI04: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI05 - Trade-sign burst continuation

#### MI05: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI06 - Hidden liquidity inference

#### MI06: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI07 - Opening auction imbalance fade/continuation classifier

#### MI07: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI08 - VWAP trajectory deviation

#### MI08: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI09 - Latency-adverse quote filter

#### MI09: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI10 - Book shock recovery

#### MI10: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI11 - Volume-clock momentum

#### MI11: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MI12 - Meta-label intraday veto

#### MI12: implementation dossier
**Family:** Microstructure / Intraday.
**Economic rationale:** The hypothesis is that order arrival, queue depletion, spread, and short-horizon flow contain transient information before it is fully incorporated into price.
**Primary measurable state variables:** book imbalance, microprice, queue change, trade sign, spread/volatility state.
**Suggested first-pass parameter grid:** book depth = [1, 3, 5, 10, 20] levels; EWMA half-life = [10, 25, 50, 100] events; minimum expected edge = [1, 1.5, 2] x modeled round-trip cost.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Data latency and fill assumptions dominate. If the edge disappears with a one-step delay or modest adverse selection, demote it to a simulator-only hypothesis.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO01 - Implied-vs-realized volatility spread

#### VO01: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO02 - Event implied-move decomposition

#### VO02: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO03 - Skew term-structure reversion

#### VO03: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO04 - Put-call skew relative value

#### VO04: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO05 - Variance risk premium carry with crash brake

#### VO05: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO06 - Gamma scalping with forecast-vol gate

#### VO06: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO07 - Calendar vol spread

#### VO07: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO08 - Surface PCA factor reversal

#### VO08: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO09 - Vol-of-vol momentum

#### VO09: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO10 - Delta-hedged option mispricing basket

#### VO10: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO11 - Implied correlation relative value

#### VO11: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## VO12 - Dynamic hedging policy learner

#### VO12: implementation dossier
**Family:** Volatility / Options.
**Economic rationale:** The hypothesis is a discrepancy between risk-neutral prices and forecast distributions, volatility surface dynamics, or the cost of delta-hedging.
**Primary measurable state variables:** implied vol, forecast realized vol, skew, term structure, surface residual, greeks.
**Suggested first-pass parameter grid:** maturity buckets = [7, 14, 30, 60, 90] days; delta buckets = [0.15, 0.25, 0.40, 0.50]; entry edge = cost-adjusted percentile thresholds.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Short-volatility can produce smooth backtests and abrupt drawdowns. Tail loss must be explicitly simulated and the trade expressed with bounded risk whenever possible.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA01 - Cross-asset carry rank

#### MA01: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA02 - Carry + momentum interaction

#### MA02: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA03 - Yield-curve shape trend

#### MA03: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA04 - Curve butterfly mean reversion

#### MA04: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA05 - Commodity seasonality + carry + momentum

#### MA05: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA06 - Funding stress switch

#### MA06: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA07 - Real-yield relative momentum

#### MA07: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA08 - Inflation beta rotation

#### MA08: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA09 - Dollar-network pressure

#### MA09: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA10 - Policy divergence momentum

#### MA10: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA11 - Cross-asset crisis carry unwind

#### MA11: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## MA12 - Macro regime mixture-of-experts

#### MA12: implementation dossier
**Family:** Macro / Carry / Curves.
**Economic rationale:** The hypothesis is compensation for persistent relative funding, roll, term-structure or macro-policy differences that can be combined with trend and stress controls.
**Primary measurable state variables:** carry, roll, curve slope, funding stress, policy divergence, volatility.
**Suggested first-pass parameter grid:** formation = [20, 60, 120, 252] days; portfolio rebalance = [daily, weekly, monthly]; stress cut = [1.5, 2, 2.5] sigma move in funding proxy.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Carry trades often earn small gains while hiding crash exposure. The model must monitor funding stress, correlation spikes and asymmetric losses.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI01 - Meta-label router

#### AI01: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI02 - Regime mixture-of-experts

#### AI02: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI03 - Cross-asset transformer forecaster

#### AI03: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI04 - Graph lead-lag model

#### AI04: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI05 - Uncertainty-aware ensemble

#### AI05: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI06 - Adversarial market perturbation training

#### AI06: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI07 - Online-learning drift detector

#### AI07: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## AI08 - Strategy discovery by grammar search

#### AI08: implementation dossier
**Family:** AI / Meta-Strategy / Portfolio Intelligence.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX01 - Trend-mean-reversion phase transition

#### HX01: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX02 - Momentum residual after macro beta removal

#### HX02: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX03 - 52-week-high + liquidity recovery

#### HX03: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX04 - Carry + factor crowding brake

#### HX04: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX05 - Event novelty + cross-sectional confirmation

#### HX05: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX06 - Option surface residual + price trend

#### HX06: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX07 - Order-flow shock + residual mean reversion

#### HX07: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX08 - Factor dispersion timing + regime gate

#### HX08: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX09 - Curve shape trend + carry

#### HX09: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX10 - Portfolio breadth + transformer ranking

#### HX10: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX11 - Dynamic pair selection by representation learning

#### HX11: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX12 - Vol forecast disagreement basket

#### HX12: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX13 - Overnight/intraday component rotation

#### HX13: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX14 - Trade-cost-aware signal shrinking

#### HX14: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX15 - Regime-conditioned factor momentum

#### HX15: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX16 - Lead-lag with structural-break veto

#### HX16: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX17 - Meta-label stop policy

#### HX17: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX18 - Portfolio correlation shock hedge

#### HX18: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX19 - Strategy family disagreement allocator

#### HX19: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


## HX20 - Research-to-production survival ladder

#### HX20: implementation dossier
**Family:** Novel Hybrid Strategies.
**Economic rationale:** The hypothesis is that a meta-model or hybrid architecture can exploit complementary information while reducing exposure to any single weak signal.
**Primary measurable state variables:** base signal, uncertainty, regime state, cost estimate, cross-strategy agreement.
**Suggested first-pass parameter grid:** ensemble size = [3, 5, 8, 12]; trade threshold = [60th, 70th, 80th, 90th] percentile; max gross = [0.5x, 1x, 1.5x] baseline risk.
**Feature hygiene:** every feature must be lagged to the decision timestamp; rolling statistics must exclude the current bar unless the decision is explicitly defined at the bar close; corporate actions, contract rolls, and symbol changes must be handled before feature generation.
**Entry logic:** create a continuous score first, then map score -> desired risk using a monotone function. Prefer a smooth position function over brittle all-in/all-out thresholds unless the market microstructure clearly calls for a hard trigger.
**Exit logic:** test four independent exit families: model invalidation, adverse excursion stop, time stop, and profit/decay exit. Do not assume the same exit mechanism is optimal for every horizon.
**Sizing:** target volatility or target expected loss per trade. Cap position size by liquidity, concentration, margin, and maximum gap risk. For multi-asset portfolios, convert every position to a common risk unit before comparing signals.
**Cost model:** include spread, commissions/fees, slippage, impact, financing, borrow, option bid/ask, and rollover where applicable. Re-run with 1.5x, 2x and 3x cost multipliers.
**Failure modes:** Meta-strategies can overfit by selecting whichever underlying strategy happened to win in-sample. The selector must be trained out-of-sample and benchmarked against simple equal-weight or fixed-rule combinations.
**AI role:** use AI to estimate conditional expectancy, uncertainty, regime state, or execution quality; keep the raw signal interpretable enough that the agent can diagnose why it failed.
**Live-paper requirement:** reproduce the exact production feature pipeline and order path. Compare expected vs realized fill price, latency, signal freshness, and position state at every trade.
**Kill conditions:** reject if the edge depends on one parameter point, one time window, one symbol, one execution assumption, or one data vendor artifact.


# Experimental methodology appendix


## Experiment registry
Assign every candidate a permanent experiment ID. Store hypothesis, source idea, code version, dataset version, timestamp, hyperparameter space, all seeds, all tried variants, evaluator version, and result disposition. Never overwrite a failed experiment. The goal is to make the research history auditable and to measure how many ideas were searched before the apparent winner emerged. This is essential because multiple testing can turn a large search process into a machine for finding lucky histories.[15][16]


## Synthetic sanity tests
Before using historical market data, test the signal on synthetic processes with known properties: IID noise (should not make money after costs), random walk with volatility clustering, regime-switching trend, mean-reverting Ornstein-Uhlenbeck-like paths, jump-diffusion, volume shock processes, and adversarial delayed information. A strategy should react in the direction predicted by its hypothesis and fail gracefully when the hypothesized structure is absent.


## Leakage audit
Perform feature-level provenance checks. For every feature, store source timestamp, publication timestamp if external information is used, and the latest data timestamp incorporated. Unit-test that a strategy cannot see revised financial statements before their original release. For intraday systems, verify that the bar close, book snapshot, or trade print arrives before the order-decision timestamp. For futures and options, verify contract selection and roll logic are not using future knowledge.


## Walk-forward design
Use chronological train -> validation -> embargo -> test blocks. Rotate the origin through time. The final test block is frozen until the strategy definition is locked. When labels overlap in time, purge samples whose label horizon overlaps the validation/test boundary. Where strategies use slow fundamentals or event windows, make the embargo longer than the largest information carryover window.


## Parameter robustness
Map performance over a grid and inspect the shape, not just the maximum. A robust strategy often has a plateau where many nearby parameter values produce similar behavior. A single sharp spike is evidence of tuning risk. Use random perturbations, bootstrap samples of trades, alternative bar construction and small timing shifts.


## Cost adversary
Every candidate should be evaluated with at least four execution worlds: optimistic, baseline, conservative, and hostile. Hostile means wider spread, larger slippage, delayed entry, partial fills, missed fills and occasional forced liquidation. The strategy is interesting only if the sign of the edge is stable across the plausible worlds.


## Asset transfer
For a stock strategy, hold out whole sectors or market-cap buckets. For futures, hold out entire asset classes. For FX, hold out currency groups. For options, hold out underlyings. This tests whether the model learned a mechanism rather than memorized a list of symbols.


## Live paper shadow
Run every candidate in shadow mode with live market data. Log what would have been traded, the exact quote seen, the signal age, theoretical fill, actual simulated fill, and the delay between signal and order. Compare the live paper distribution to the backtest distribution using quantiles, not just mean PnL.


## Promotion policy
Promotion should be mechanical. Example: research score >= threshold, no hard failures, stable walk-forward, hostile-cost positive or near-breakeven depending on horizon, paper live within predicted execution error, and no unexplained concentration. Start at tiny risk and require a minimum number of live observations before scaling.


## Drift management
Monitor feature distribution, signal distribution, forecast calibration, realized slippage, hit rate, expected-vs-realized volatility, and PnL attribution. A drift detector should distinguish data outages from genuine market change. Quarantine the model when drift exceeds policy bounds, then require revalidation before reactivation.


## AI governance
Use separate proposal and evaluation agents. The proposal agent can be creative. The evaluator should have fixed rubrics and should not know which strategy is preferred. A third audit layer should inspect for leakage, cost assumptions, data snooping and implementation mismatches. LLM-generated code must pass deterministic unit tests before financial evaluation.


# Data model for the autonomous research engine

- `asset_id, contract_id, exchange, currency, asset_class, point_value, tick_size`
- `decision_timestamp, bar_timestamp, event_timestamp, source_timestamp`
- `open, high, low, close, volume, vwap, bid, ask, spread, depth metrics`
- `corporate_action_factor, contract_roll_state, borrow_state, margin_estimate`
- `feature_vector_version, model_version, strategy_version, code_commit`
- `forecast_return, forecast_volatility, forecast_uncertainty, regime_state`
- `desired_position, risk_target, notional, expected_cost, expected_edge`
- `order_type, limit_price, stop_price, parent_id, order_id, perm_id, status`
- `fill_price, fill_qty, fees, slippage, realized_pnl, mae, mfe, holding_time`
- `exception_code, kill_switch_state, data_staleness, reconciliation_state`

# Feature library: less-common candidates to force novelty


## Path geometry
trend area above/below a moving anchor; realized slope normalized by path length; curvature; drawdown velocity; time spent near extrema.

## Distribution shape
rolling skew, kurtosis, tail ratio, downside-to-upside semivariance, jump fraction, consecutive-return entropy.

## Volatility structure
short/long vol ratio, vol-of-vol, realized/implied gap, downside vol, volatility autocorrelation.

## Liquidity structure
Amihud-like illiquidity, spread percentile, depth elasticity, quote replenishment speed, volume concentration, turnover shock.

## Market participation
breadth, advance/decline impulse, cross-sectional return dispersion, concentration of volume in leaders, factor participation.

## Relative geometry
distance from peer median, beta residual, factor residual, pair spread percentile, curve curvature, ETF-vs-basket basis.

## Event geometry
pre-event drift, post-event gap, event surprise percentile, event novelty, peer-event confirmation, implied-vs-realized event move.

## Microstructure
microprice displacement, order-flow imbalance, queue depletion rate, signed trade burst, cancellation intensity, spread/flow interaction.

## AI uncertainty
ensemble disagreement, interval width, conformal score, feature-shift distance, model age, data completeness.

# Strategy combination experiments


## COMB-01 - T08 + MR01 + MR09
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-02 - T15 + CF02 + RV04
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-03 - MR06 + RV03 + EV11
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-04 - CF01 + EV04 + VO06
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-05 - CF08 + MI05 + AI01
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-06 - RV03 + VO06 + HX12
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-07 - RV10 + MA07 + T11
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-08 - EV05 + AI08 + CF02
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-09 - EV12 + HX13 + RV09
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-10 - MI07 + T06 + MI04
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-11 - VO02 + MR03 + VO11
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-12 - VO09 + CF04 + AI06
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-13 - MA04 + RV05 + HX17
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-14 - MA11 + EV06 + T16
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-15 - AI06 + MI07 + CF07
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-16 - HX05 + VO08 + EV02
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-17 - HX12 + MA09 + MI09
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-18 - HX19 + HX02 + MA04
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-19 - T06 + HX15 + HX03
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.

## COMB-20 - T13 + T08 + T02
Treat the three strategies as independent experts. Standardize each signal to forecast contribution per unit of portfolio risk, cap each expert, then test equal-weight, inverse-vol-weight, and AI-routed allocation. The key experiment is whether the combination improves drawdown and stability without merely adding correlated exposure. Record individual attribution and correlation of active-risk streams.