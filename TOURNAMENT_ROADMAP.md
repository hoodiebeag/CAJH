# CAJH Research Roadmap: Path to a Profitable Strategy

> Staged verbatim from a direct human directive (2026-08-06). Governs the
> `tournament.mjs` / `backtest.js` / `portfolio.mjs` entry-signal research track,
> a separate program from the momentum/low-vol/classifier work tracked as
> PWR1-4 in `.agent_state.json`. Same honesty discipline applies to both:
> sealed holdouts, pre-registered gates, no relaxing a gate after seeing results.

## Honest Baseline First

Every entry family tested in the latest tournament is **net-negative after costs, in both train and holdout**:

| Family | Train R/trade | Holdout R/trade |
|---|---|---|
| anticipate | -0.361 | -0.508 |
| bos | -0.425 | -0.607 |
| breakout | -0.454 | -0.437 |
| trend_pullback | -0.387 | -0.598 |
| sweep_reclaim | -0.590 | -0.711 |
| rsi | -0.693 | -0.751 |
| rev | -2.211 | -2.047 |
| support | -2.196 | -2.018 |

**The losses are not from bad exits or bad sizing — they are from entries that do not predict directional movement better than chance, after the bid/ask spread and fee drag of ~0.9%.** Tuning exits or position size around these entries is not the path forward.

---

## What Must Be True for a Strategy to Work

Before designing anything new, state the required conditions:

1. **Entry signal predicts positive expected value before costs** — raw edge exists in price data
2. **That edge survives realistic cost assumptions** (~0.9% round-trip on Kraken spot)
3. **The edge is stable across a chronological holdout** not used for selection
4. **Sample size is adequate** — minimum ~200 holdout trades per candidate
5. **The edge generalizes across assets** — not one lucky ticker

If any condition fails, the hypothesis is rejected and a new one is required.

---

## Roadmap: Four Distinct Hypothesis Tracks

Work these **sequentially**. Do not advance to the next track until the current one is falsified or promoted.

---

### Track 1 — Diagnose the Cost Drag (Immediate)

**Hypothesis:** The current entry signals have a small raw edge that costs destroy.

**Experiment:**
Run the existing tournament with `costRate = 0`. If any family reaches `avgR > 0` in holdout at zero cost, the problem is execution cost and the fix is a higher R-multiple target or less frequent entries. If all families are still negative at zero cost, the entries have no edge at all and Tracks 2-4 are the only path.

**Decision rule:**
- Zero-cost holdout `avgR > 0` for any family -> proceed to cost-reduction experiments on that family
- All families negative at zero cost -> **kill Track 1, move to Track 2 immediately**

**What would cause abandonment:** All negative at zero cost (very likely given the magnitude of losses).

---

### Track 2 — New Entry Signal: Volatility Contraction Breakout (Next)

**Hypothesis:** Price compression (low ATR relative to its own history) followed by a range expansion candle predicts a sustained directional move with positive EV before costs.

**Why this is genuinely different:** Current entries are swing-low geometric patterns. This is a volatility-state signal — structurally distinct information source.

**Pre-registered gate (must be written before running):**
- Holdout trades >= 150
- Holdout `avgR/trade > +0.10` (net of 0.9% cost)
- Holdout win rate >= 40%
- Positive on >= 50% of tested assets

**Implementation steps:**
1. Define: ATR(14) < 0.5x its own 50-bar median = compression state
2. Entry trigger: close breaks above the compression range high
3. Stop: below the range low
4. TP: 3R
5. Run tournament with 70/30 chronological split across the full watchlist

**What would cause abandonment:** Holdout `avgR < 0` after costs OR fewer than 150 holdout trades (insufficient signal frequency).

---

### Track 3 — New Entry Signal: BTC Regime Filter on Existing Entries (Parallel Research)

**Hypothesis:** The existing entries have negative EV in bear/ranging regimes and positive EV only when BTC is above its 200-day MA. Filtering to bull-regime-only entries changes the distribution enough to produce positive holdout EV.

**Why this is genuinely different from what was tested:** The current tournament has `trendGate: false` for most families. A hard BTC macro filter is a different information source than per-asset MA alignment.

**Pre-registered gate:**
- Holdout trades >= 100 (regime filter will reduce frequency significantly)
- Holdout `avgR > +0.05`
- Tested on the `anticipate` and `breakout` families only (best performers in the tournament)

**What would cause abandonment:** Holdout `avgR < 0` OR regime-on periods have fewer than 100 trades (strategy too infrequent to be useful).

> NOTE (staged by Architect): the section header says "Parallel Research" but the
> "Execution Order for Agents" below runs it strictly after Track 2 resolves. Preserved
> as written rather than silently resolved — whoever picks this up should confirm with
> the human whether Track 3 was meant to run alongside Track 2 instead of after it.

---

### Track 4 — Portfolio-Level Alpha: Cross-Sectional Momentum (If Tracks 1-3 Fail)

**Hypothesis:** Cross-sectional 30-day momentum (long top-5 performers, rebalance weekly) produces positive Sharpe in holdout. This is fundamentally different from single-name entry timing — it is a portfolio rotation signal.

**This track is already partially coded** in `portfolio.mjs`. The existing `momentum_30d` and `momentum_vol` strategies need a clean holdout run reported here.

**Pre-registered gate:**
- Holdout Sharpe > 0.5
- Holdout total return > 0
- Holdout max drawdown > -35%
- Both 7-day and 30-day rebalance variants must pass (prevents rebalance-frequency overfitting)

**What would cause abandonment:** Holdout Sharpe < 0 across all variants.

---

## What Agents Must Not Do

| Prohibited | Reason |
|---|---|
| Re-tune TP/stop multipliers on the existing entry families | The losses are pre-cost; exit tuning cannot fix a signal with no edge |
| Cherry-pick assets where a strategy happened to work | Overfitting; must require >=50% of assets positive |
| Relax the holdout gate after seeing results | Data snooping invalidates the test |
| Infer live edge from the current 0-trade sample | No realized exits means no evidence |
| Call a strategy "promising" without holdout evidence | Not a useful conclusion |

---

## Execution Order for Agents

```
1. Run Track 1 (zero-cost tournament) -> report avgR per family at cost=0
   |- If any family positive at zero cost: investigate cost reduction
   |- If all negative: confirm, move immediately to Track 2

2. Implement volatility contraction entry in backtest.js
   Run Track 2 tournament with pre-registered gate
   |- Pass: promote to paper trading, observe 60 days minimum
   |- Fail: document result, move to Track 3

3. Run Track 3 (BTC regime filter on anticipate + breakout)
   |- Pass: promote to paper trading alongside Track 2 if applicable
   |- Fail: document, move to Track 4

4. Run Track 4 (portfolio momentum holdout from portfolio.mjs)
   |- Pass: implement as portfolio rotation layer, not single-name entries
   |- Fail: generate genuinely new hypothesis not yet tested

5. After any paper-trading promotion: observe minimum 60 days,
   minimum 50 trades, before any live consideration.
   Trading remains halted until this gate is passed.
```

---

## Single Highest-Information Next Step

**Run the zero-cost tournament (Track 1).** It takes minutes and definitively answers whether the problem is cost drag or signal absence. That answer determines everything else. If the entries have zero-cost positive EV, the research path is cost reduction. If they do not, the entire entry family must be replaced and Tracks 2-4 are the only viable directions.

The strategy is not currently profitable. The roadmap above is the honest, falsifiable path to finding out whether a profitable one exists in this asset class.
