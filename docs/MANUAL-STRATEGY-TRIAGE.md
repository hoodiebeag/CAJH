# Triage of the IBKR strategy manual against this project's actual data

Companion to `docs/IBKR_AUTONOMOUS_AI_TRADING_STRATEGY_MANUAL.md`. Written after
reading the whole file. It answers one question: **of the manual's strategies,
which can this project actually run, and of those, which have not already been
killed here under another name?**

## The manual is far smaller than 3,988 lines

Measured, not estimated:

| block | lines | distinct content |
|---|---|---|
| Strategy library (27-1381) | 1,355 | **128 entries**, each 3 unique lines (Core rule / Assets / Novelty) |
| Test matrices inside those entries | ~640 | **2** distinct matrices, repeated 108 and 20 times |
| Implementation dossiers (1529-3988) | 2,459 | **9** distinct bodies, one per family, repeated across 128 IDs |
| Dossier fields | — | 8 of 13 fields are byte-identical in all 9 bodies |

So the appendix that looked like eight reading sessions is nine short templates.
Total unique prose in the manual is roughly 400 lines. The ingest is complete.

**Correction to the earlier record:** the library has **128** entries, not 112.
The earlier count missed the T-family's 16 and the HX-family's 20.

## What we hold

All four bundles carry full OHLCV **including open and volume** — a fact that
turns out to matter more than anything else below.

| bundle | symbols | bar | rows/symbol | span |
|---|---|---|---|---|
| `candle-bundle/1440` | 29 | 1d | 1,186 | 2023-01 → 2026-03 |
| `candle-bundle/240` | 29 | 4h | 7,113 | 2023-01 → 2026-03 |
| `candle-bundle-long/1440` | 24 | 1d | 3,065 | 2018-04 → 2026-09 |
| `sp500-bundle/1440` | 128 | 1d | 921 | 2023-01 → 2026-09 |
| `equity-bundle/1440` | 30 | 1d | 921 | 2023-01 → 2026-09 |

Plus funding rates (Binance/OKX/Kraken) and derivatives positioning (OI, taker
ratio, top-trader long/short) already pulled. No sector or industry map. No
options, no order book, no news tape, no fundamentals.

## Tiers

**45 of 128 are Tier A** (runnable on data already in this repo), **19 Tier B**
(one cheap pull away — chiefly a GICS/industry map or a handful of index and
sector ETF daily bars from IBKR), **64 Tier C** (gated on data that must be
bought or entitled: 12 options surface, 11 order book / tick, 11 news and
earnings tape, 10 rates/FX/commodity futures, 7 fundamentals, 13 mixed).

The full per-ID tables follow at the end of this file.

## The filter that matters: Tier A ∩ not already killed here

Most of Tier A is trend, breakout, reversal and meta-labelling — which is to say
most of Tier A is already in `VERDICTS.md` as FAIL or KILLED, under this
project's own names. Mapping them:

| manual id | already closed here as |
|---|---|
| T01 T02 T05 T09 T12 T13 | Momentum M7, MOMENTUM-SHORT-HORIZON-RECHECK, T4-PORTFOLIO-MOMENTUM(-PHASE4) |
| T03 T04 | T1-ZEROCOST / T1B-BREAKOUT-COSTFIX, VOL-CONFIRM-BREAKOUT |
| T07 T10 | TREND-GATE-MA, TREND-GATE-STRUCTURE, ROLLING-VOLATILITY-REGIME-TIMING |
| T16 HX17 | TRAIL-STOP-EXIT, ATR-ADAPTIVE-STOP-CONFIRMATORY, SCALED-EXIT-LADDER, T5-DECAY-EXIT |
| MR05 MR06 MR07 | B5-REVERSAL, H3-HIGHER-LOW-RECLAIM, RANGE-SWEEP-RECLAIM |
| MR12 | OPEN-INTEREST-TREND-CONFIRMATION, LONG-SHORT-RATIO-CONTRARIAN, TOP-TRADERS-DIVERGENCE |
| RV01 | PAIRS-COINTEGRATION-STATARB (0/105 pairs survived the screen) |
| CF06 | dispersion study (Kraken-14) |
| MA02 T15 | funding / carry family, closed |
| MI12 AI01 AI02 | Classifier P5, CLASSIFIER-FUNDING-FEATURE, C0-SIGNAL-COMBINATION |

That last row is worth stating plainly because it answers a question that has
been open in this project: **the manual's answer to "combine strategies, entries
from one and exits from another" is its meta-label family (AI01, MI12, HX17,
HX19), and that family is the single most thoroughly killed thing in
`VERDICTS.md`.** Three independent information sources were fed to a meta-model
here — price structure (P5), funding (CLASSIFIER-FUNDING-FEATURE), and a
composite (C0) — and all three produced a real, significant AUC that died on
net-of-cost economics. A meta-layer over losing base strategies cannot fix them,
and we have no winning base strategies for it to route between. The manual's own
AI-family failure-mode note agrees: *"the selector must be benchmarked against
simple equal-weight or fixed-rule combinations."*

### What survives the filter

Six Tier-A ideas are not adjacent to any closed row:

1. **MR11 — close-to-close vs intraday decomposition**, and its portfolio form
   **HX13 — overnight/intraday component rotation**. This is the standout. Every
   study in `VERDICTS.md` is close-to-close. All four bundles carry the open
   price, and `open[t]/close[t-1]` vs `close[t]/open[t]` has never been computed
   as a signal anywhere in this repo — the only use of `open` is gap accounting
   inside `studies/overlay.mjs`. It is a genuinely different decomposition of
   returns we already own, at zero data cost.
2. **MR08 — liquidity shock normalization** (Amihud illiquidity z-score spike
   then partial normalization). Volume has only ever been used here as a
   confirmation filter, never as the signal.
3. **RV02 / RV03 / RV10 — residual mean reversion** (PCA residuals, basket-vs-
   constituent, cross-asset beta residual). Not a repeat of
   PAIRS-COINTEGRATION-STATARB: that screened 105 explicit pairs for
   cointegration and found none, whereas these estimate a common-factor model
   across the 128-name S&P bundle and trade the residual. Different estimator,
   much wider universe. Caveat: market-neutral, so it needs shorting, which is
   still unverified on IBKR (0/128 symbols returned shortability).
4. **CF12 — factor trend-following.** Trend rules applied to the *factor spread*
   rather than to price. Trend-on-price is closed here; trend-on-factor-spread
   is a different series.
5. **T11 — time-under-water recovery.** Fraction of the last 60 sessions spent
   below the rolling high, as a state variable rather than a price transform.
6. **HX02 — momentum residual after macro beta removal.** MACRO-REGIME used
   macro as a regime switch; this removes macro beta and trades what is left.

Every one of these must still clear the two gates this campaign added and the
manual does not have: **a matched-geometry random-entry null AND a
buy-and-hold/equal-weight-basket baseline.** Eleven families have now cleared a
statistical null here while losing to a baseline.

## The gap in the manual, restated precisely

The manual's eight hard validation gates never require a baseline comparison.
The requirement appears exactly once in the whole document, and only as a
failure-mode note on the AI/HX families. A strategy can pass all eight gates,
clear every kill condition, and still lose to holding the universe — which is
how every mechanism this project has tested has died. If the manual is fed back
to its author, this is the one change worth making.

## What buying data would actually buy

Tier C, ranked by how many strategies it unlocks: intraday/tick (11 + most of
the 275 mentions elsewhere), options surface (12), news and earnings tape (11),
rates/FX/commodity futures (10), fundamentals (7).

One correction to that ranking: **intraday may not be a purchase.**
`ibkr-bars.mjs` hard-codes `BarSizeSetting.DAYS_ONE` in its single
`reqHistoricalData` call. The transport is proven against a live Gateway. Making
the bar size a parameter is a one-line change, and if IBKR returns intraday
historical bars under the entitlement we already have, the manual's largest
gated block costs nothing. This is untested and should be tested before any
data purchase is considered.

The cheapest unlock overall is a **GICS/industry map** — a static file, or
`reqContractDetails`, which returns industry/category/subcategory per contract.
It moves T06, MR04, CF05, CF11, HX08 out of Tier B and is a precondition for
industry-neutral residual construction generally.

### Tier A: runnable on data already in this repo — 45 of 128

| id | name | family | note |
|---|---|---|---|
| AI05 | Uncertainty-aware ensemble | AI | overlay |
| AI06 | Adversarial market perturbation training | AI | method |
| AI07 | Online-learning drift detector | AI | monitoring |
| AI08 | Strategy discovery by grammar search | AI |  |
| CF06 | Factor timing by dispersion | Cross-sectional Factors |  |
| CF07 | Factor crash detector | Cross-sectional Factors |  |
| CF12 | Factor trend-following | Cross-sectional Factors |  |
| MA02 | Carry + momentum interaction | Macro | crypto leg only, from funding we hold |
| MR02 | Close-location reversal | Mean Reversion |  |
| MR05 | Cross-sectional shock rebound | Mean Reversion |  |
| MR06 | Volatility-adjusted Bollinger reversal | Mean Reversion |  |
| MR07 | Drawdown velocity snapback | Mean Reversion |  |
| MR08 | Liquidity shock normalization | Mean Reversion | Amihud from close/volume |
| MR11 | Close-to-close vs intraday decomposition | Mean Reversion |  |
| MR12 | Mean reversion with crowding veto | Mean Reversion | crypto leg only, crowding from OI we hold |
| MI12 | Meta-label intraday veto | Microstructure | method; applies at daily bar close |
| HX02 | Momentum residual after macro beta removal | Novel hybrid strategies | macro factors from ETF daily bars |
| HX13 | Overnight/intraday component rotation | Novel hybrid strategies |  |
| HX14 | Trade-cost-aware signal shrinking | Novel hybrid strategies | overlay |
| HX15 | Regime-conditioned factor momentum | Novel hybrid strategies |  |
| HX16 | Lead-lag with structural-break veto | Novel hybrid strategies |  |
| HX17 | Meta-label stop policy | Novel hybrid strategies | exit policy |
| HX19 | Strategy family disagreement allocator | Novel hybrid strategies | needs >=2 working strategies |
| HX20 | Research-to-production survival ladder | Novel hybrid strategies | process |
| RV01 | Dynamic cointegration pairs | Relative Value |  |
| RV02 | PCA residual mean reversion | Relative Value | needs shorting to be market-neutral |
| RV03 | Basket vs constituent dislocation | Relative Value |  |
| RV07 | Cross-market lead-lag residual | Relative Value | daily lead-lag only |
| RV10 | Cross-asset beta residual | Relative Value |  |
| RV11 | Pair-break monitor | Relative Value | overlay, not a strategy |
| RV12 | Relative-value ensemble selector | Relative Value | needs >=2 working RV models |
| T01 | Volatility-normalized dual-horizon trend | Trend |  |
| T02 | Trend acceleration / second derivative | Trend |  |
| T03 | Breakout persistence quality | Trend |  |
| T04 | Trend + volume surprise | Trend |  |
| T05 | 52-week-high pressure trend | Trend |  |
| T07 | Trend convexity filter | Trend |  |
| T09 | Trend breadth pulse | Trend |  |
| T10 | Volatility-of-volatility trend | Trend |  |
| T11 | Time-under-water recovery trend | Trend |  |
| T12 | Multi-speed trend voting | Trend |  |
| T13 | Trend disagreement arbitrage | Trend |  |
| T14 | Gap-resolved continuation | Trend | gap held N bars, daily proxy |
| T15 | Funding-aware trend | Trend | crypto leg only, from funding we hold |
| T16 | Trend with structural stop migration | Trend | exit rule, not an entry |

### Tier B: one cheap pull away — 19 of 128

| id | name | family | note |
|---|---|---|---|
| AI01 | Meta-label router | AI | needs 10-20 base strategies first |
| AI02 | Regime mixture-of-experts | AI | needs working experts |
| AI03 | Cross-asset transformer forecaster | AI |  |
| AI04 | Graph lead-lag model | AI |  |
| CF05 | Industry-neutral residual factor stack | Cross-sectional Factors | sector map |
| CF11 | Crowding-adjusted factor selection | Cross-sectional Factors | sector map + crowding proxy |
| EV11 | Event aftershock fade | Event | event proxied by |gap|, not a real event tape |
| MA08 | Inflation beta rotation | Macro | macro ETF daily bars |
| MR04 | Residual mean reversion | Mean Reversion | sector map |
| MR10 | Range compression breakout-fade hybrid | Mean Reversion | volume for order flow |
| HX01 | Trend-mean-reversion phase transition | Novel hybrid strategies | substitute volume for order flow |
| HX03 | 52-week-high + liquidity recovery | Novel hybrid strategies |  |
| HX08 | Factor dispersion timing + regime gate | Novel hybrid strategies | sector map |
| HX10 | Portfolio breadth + transformer ranking | Novel hybrid strategies |  |
| HX11 | Dynamic pair selection by representation learning | Novel hybrid strategies |  |
| HX18 | Portfolio correlation shock hedge | Novel hybrid strategies |  |
| RV05 | Future-vs-ETF basis mean reversion | Relative Value | futures/ETF basis from IBKR |
| T06 | Industry-to-stock momentum cascade | Trend | GICS/industry map |
| T08 | Cross-asset confirmation trend | Trend | sector + index ETF daily bars |

### Tier C: gated on data that must be bought or entitled — 64 of 128

| id | name | family | note |
|---|---|---|---|
| CF01 | Nonlinear momentum-value blend | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF02 | Quality momentum divergence | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF03 | Value mean-reversion with momentum veto | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF04 | Liquidity premium conditioned on quality | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF08 | Characteristic attention model | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF09 | Peer-relative earnings revision momentum | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| CF10 | Balance-sheet momentum | Cross-sectional Factors | fundamentals (value/quality/revisions) |
| EV01 | Earnings surprise continuation | Event | news, transcripts, earnings tape |
| EV02 | Earnings drift with quality gate | Event | news, transcripts, earnings tape |
| EV03 | News novelty impulse | Event | news, transcripts, earnings tape |
| EV04 | Transcript delta | Event | news, transcripts, earnings tape |
| EV05 | Guidance credibility | Event | news, transcripts, earnings tape |
| EV06 | Event-volatility mispricing | Event | news, transcripts, earnings tape |
| EV07 | Sector contagion after news | Event | news, transcripts, earnings tape |
| EV08 | Regime-specific news classifier | Event | news, transcripts, earnings tape |
| EV09 | Macro release surprise basket | Event | news, transcripts, earnings tape |
| EV10 | News-to-flow confirmation | Event | news, transcripts, earnings tape |
| EV12 | Fundamental momentum vs price momentum conflict | Event | news, transcripts, earnings tape |
| MA01 | Cross-asset carry rank | Macro | rates/FX/commodity futures data |
| MA03 | Yield-curve shape trend | Macro | rates/FX/commodity futures data |
| MA04 | Curve butterfly mean reversion | Macro | rates/FX/commodity futures data |
| MA05 | Commodity seasonality + carry + momentum | Macro | rates/FX/commodity futures data |
| MA06 | Funding stress switch | Macro | rates/FX/commodity futures data |
| MA07 | Real-yield relative momentum | Macro | rates/FX/commodity futures data |
| MA09 | Dollar-network pressure | Macro | rates/FX/commodity futures data |
| MA10 | Policy divergence momentum | Macro | rates/FX/commodity futures data |
| MA11 | Cross-asset crisis carry unwind | Macro | rates/FX/commodity futures data |
| MA12 | Macro regime mixture-of-experts | Macro | rates/FX/commodity futures data |
| MR01 | ATR-scaled intraday stretch fade | Mean Reversion | other |
| MR03 | Gap-to-range reversion | Mean Reversion | other |
| MR09 | VWAP displacement with order-flow stabilization | Mean Reversion | other |
| MI01 | Multi-level order-flow imbalance | Microstructure | order book / tick data |
| MI02 | Queue depletion hazard | Microstructure | order book / tick data |
| MI03 | Microprice deviation | Microstructure | order book / tick data |
| MI04 | Spread-widening anticipation | Microstructure | order book / tick data |
| MI05 | Trade-sign burst continuation | Microstructure | order book / tick data |
| MI06 | Hidden liquidity inference | Microstructure | order book / tick data |
| MI07 | Opening auction imbalance fade/continuation classifier | Microstructure | order book / tick data |
| MI08 | VWAP trajectory deviation | Microstructure | order book / tick data |
| MI09 | Latency-adverse quote filter | Microstructure | order book / tick data |
| MI10 | Book shock recovery | Microstructure | order book / tick data |
| MI11 | Volume-clock momentum | Microstructure | order book / tick data |
| HX04 | Carry + factor crowding brake | Novel hybrid strategies | options or curve data |
| HX05 | Event novelty + cross-sectional confirmation | Novel hybrid strategies | options or curve data |
| HX06 | Option surface residual + price trend | Novel hybrid strategies | options or curve data |
| HX07 | Order-flow shock + residual mean reversion | Novel hybrid strategies | options or curve data |
| HX09 | Curve shape trend + carry | Novel hybrid strategies | options or curve data |
| HX12 | Vol forecast disagreement basket | Novel hybrid strategies | options or curve data |
| RV04 | ETF NAV proxy dislocation | Relative Value | options or futures curve data |
| RV06 | Curve butterfly statistical arb | Relative Value | options or futures curve data |
| RV08 | Volatility surface relative value | Relative Value | options or futures curve data |
| RV09 | Calendar spread z-score | Relative Value | options or futures curve data |
| VO01 | Implied-vs-realized volatility spread | Volatility | options surface |
| VO02 | Event implied-move decomposition | Volatility | options surface |
| VO03 | Skew term-structure reversion | Volatility | options surface |
| VO04 | Put-call skew relative value | Volatility | options surface |
| VO05 | Variance risk premium carry with crash brake | Volatility | options surface |
| VO06 | Gamma scalping with forecast-vol gate | Volatility | options surface |
| VO07 | Calendar vol spread | Volatility | options surface |
| VO08 | Surface PCA factor reversal | Volatility | options surface |
| VO09 | Vol-of-vol momentum | Volatility | options surface |
| VO10 | Delta-hedged option mispricing basket | Volatility | options surface |
| VO11 | Implied correlation relative value | Volatility | options surface |
| VO12 | Dynamic hedging policy learner | Volatility | options surface |