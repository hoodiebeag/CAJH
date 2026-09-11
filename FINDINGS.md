# What this project found

One document, current as of 2026-09-03. It replaces ~13,000 lines of dated per-study narrative,
now in `docs/archive/`. Per-study detail lives in `VERDICTS.md` (68 rows) and the archive; the
scripts that produced every figure are in `studies/`.

---

## The finding

**No entry-timing edge has been demonstrated in either market tested.**

Twenty-two studies entered the formal null-hypothesis family recorded in
`MULTIPLE_COMPARISONS_AUDIT.md`. **Zero survive Benjamini-Hochberg correction at q=0.05.** That is
not a series of near-misses; it is a consistent negative across two asset classes, four years of
data, twelve entry families, and a dozen candidate signals.

This is a real result. It cost real work to establish, most of it spent ruling out the
explanations that would have let the project keep going.

---

## Crypto: the effect is real and too small to pay for itself

Gross expectancy across the twelve `tournament.mjs` entry families is approximately
**+0.0091R even with fees set to zero**. Fees account for **94.1%** of total drag.

The order of those two facts matters. The strategy is not losing to costs that better execution
could reduce — it barely wins before costs exist at all. `ZERO-COST-FLOOR-ALL-FAMILIES` tested
every family at a zero-cost floor and none clears a meaningfully positive gross edge at any cost
structure. `EXECUTION-DELAY-DECAY-CURVE` separately rules out execution latency as the culprit.

The large negative R figures in the crypto record are **correct economics, not a cost-model
artifact** — confirmed 2026-08-29 without modifying the cost formula.

**What this closes:** cheaper fills cannot rescue a strategy with no gross edge. Neither can
filters. A gate applied to a population with zero expectancy selects a subset of zero expectancy.

> **Corrected 2026-09-03.** That last sentence is sound arithmetic on a premise that turned out to
> be wrong for this population. See the addendum at the end of this document: these families were
> cost-destroyed rather than zero-expectancy, and a wider stop taken rarely is a different
> population, not a subset of this one.

## Equities: costs are survivable, and the apparent edge was the window

Equities looked more promising for a while, and the reason it did is the most useful thing the
project learned.

**Zero of ten scorable DJIA-30 entry families beat their own matched-geometry random-entry null.**
`ma_dip`, the best of them, sits at the **52.1st percentile** of its own null distribution — the
coin-flip mark.

The null itself is what settled it. A random-entry control with the same stop geometry, same exit
path and same costs produced a **positive mean return of +0.1637R** over the tested window. Any
strategy averaging around +0.16R had therefore demonstrated nothing at all. Pushed into a
genuinely falling window, the same geometry produced **−0.1741R** (DJTA-20, 2025-Q1, buy-and-hold
−8.64%) and **−0.0632R** (2025-Q3).

**The geometry is not an edge measured during a good period. It IS the good period.** Stop-and-
target structure applied to a rising market manufactures a positive average with no predictive
content whatsoever.

## The two results that survived longest, and why they stopped

**`ma_dip` on DJTA-20.** Its 95% interval excluded zero at 300 nominal trades. Counting
observations by calendar day rather than by trade — because trades on the same day share one
signal and are not independent — gives an **effective n of 104**, and the interval no longer
excludes zero.

**`vol_contraction` AXIS C.** The only result in the project's history to clear the full 3-leg
gate: 256 trades, gross avg **+0.2524R**, 65.4% of assets positive. Three things then happened.
Its sealed-pool validation returned **INCONCLUSIVE**, not a pass — 67 trades, structurally unable
to reach the required 150-trade leg. It was never scored against a matched-geometry null. And on
2026-09-01, under bar-clustered resampling, its interval went from **[+0.0620, +0.4427]** to
**[−0.0244, +0.5649]**, no longer excluding zero.

It stands unpromoted. The human decision on the case is deliberately left open.

---

## Method changes that outlived their studies

Three corrections changed conclusions, not just presentation, and any future work here inherits
them:

1. **Cluster by date, not by trade.** Position-blocked resampling over-counts correlated
   same-day entries. It is what let a dead result look alive on two separate occasions.
2. **Score against a matched-geometry null, not against zero.** Beating zero is not an edge when
   the geometry alone returns +0.16R in a rising window.
3. **Correct across the whole family.** Twenty-two simultaneous looks is the number that matters,
   not the one study being written up. Every candidate joins the register in
   `MULTIPLE_COMPARISONS_AUDIT.md`.

## Directions already closed — check here before proposing one

| Direction | Outcome |
|---|---|
| Crypto price-structure entry variants (12 families) | closed in full scope; no gross edge at zero cost |
| Threshold-a-series / gate / holdout-score shape | retired after 11 runs, mean effect −0.008R against a +0.864R requirement |
| Cointegrated pairs stat-arb | 0 of 105 pairs survive correction |
| Funding mean-reversion / funding carry | train-gate fail; research-only |
| Cross-sectional non-price ranking (open interest) | killed at train significance, wrong sign |
| Momentum (M7, sealed panel) | killed, train p=0.7013 |
| Classifier P5 | holdout AUC 0.5249 |
| Signal combination (C0) | p=0.4708, composite worse than either input |
| Macro regime conditioning (C2) | rho −0.0980, q=0.1338, does not survive |
| Maker-fill cost reduction | run; does not rescue a zero gross edge |
| On-chain flow gates | data-availability gate fails |
| Variance risk premium (C1) | **FAIL** on 2026-09-03. Over 2024-09 to 2026-09, IV sat BELOW realised vol on both SPY (15.41 vs 17.06) and QQQ (20.68 vs 22.20) — a negative premium of about -1.6 vol points, interval including zero |
| FX carry (C3) | **not answerable on available data** — detecting a documented 2-5%/yr premium needs 24-147 years of monthly observations; 5 exist. Not built rather than run underpowered |

## The variance risk premium, tested 2026-09-03 — FAIL, and read carefully

The first study in this project that was not a directional prediction. It failed, and both the
result and the reason are worth keeping.

**Measured.** 100 non-overlapping weekly windows per underlying, 502 daily bars each, aligned by
date with zero unmatched on either side. Variance premium **-1.65 and -1.52 vol points** — the
wrong sign — with both intervals including zero.

**Corrected 2026-09-03, and the correction matters.** This section first said "implied sat BELOW
realised". In the ordinary sense that is **false**. Those figures (SPY 15.41 vs 17.06) are
root-mean-square, the variance-space quantity a variance swap pays on. The plain arithmetic
averages of the same series run the other way: implied 15.03 against realised 13.25, so **implied
exceeded realised by 1.8 vol points in the typical week.**

Both are true, and the gap between them is the entire story. `E[RV²]` is dominated by a handful of
high-volatility weeks, so the variance premium goes negative while the ordinary average stays
positive. **That is precisely the short-variance payoff:** you collect a little in most weeks and
give it back with interest in a few. The negative figure is the economically correct one for a
variance swap; the phrase "IV below RV" was not. Both readings are now reported side by side so
the next reader cannot take one for the other.

**This is not a data artifact.** The levels are normal for both names, QQQ correctly sits above
SPY on both legs, the alignment matched 502 of 502, and the window count matched the prediction
made before the run. The estimator's residual bias was measured beforehand at **+0.12 vol points**,
which runs the *opposite* way: if anything the true reading is slightly more negative.

**Over this window, variance was under-priced, not over-priced.** Selling it would have lost.

**What was deliberately not done.** Realised variance is right-skewed: short volatility earns a
little most weeks and loses a lot in a few, so the median premium here may well be positive while
the mean is negative, and re-gating on the median would probably have turned this into a PASS.
That would be wrong on the merits and not merely procedurally — **a position earns the mean.**
Winning ninety weeks and giving it back in ten is negative expectancy, not a strategy. The mean was
pre-registered, the mean is the economically correct statistic, and the FAIL stands. Per-window
diagnostics were added afterwards so a future run can *show* the distribution, and a test asserts
they cannot change a verdict.

**What this does and does not establish.** The minimum detectable effect at this sample was 1.12
vol points, so this window is genuinely distinguishable from a +2-point premium — that much is
informative. It does **not** establish that the premium is absent generally: two years is a single
regime and the literature measures this across decades.

**The tenor question, answered 2026-09-03 — one half cleanly, one half not.**

IBKR's `HISTORICAL_VOLATILITY` is a **30-day trailing window**, identified decisively: on both SPY
and QQQ the mean-absolute-difference and correlation criteria agree on h=30, with correlations of
0.977 and 0.967 against our own 30-day realised series.

`OPTION_IMPLIED_VOLATILITY` is **not identified**, and the numbers say why rather than leaving it
to guesswork. Its fit surface is flat — mean absolute difference varies by only 0.007 across
h=10 to h=63, against a winner that beat its runner-up by 0.005 on a 0.014 base in the historical
case. The two criteria disagree (SPY: 21 by difference, 5 by correlation; QQQ: 30 by difference,
5 by correlation). **This is a limitation of the method, not a property of the data:** historical
volatility is a deterministic function of past prices, so matching it pins a window exactly;
implied volatility is a *forecast*, and forward realised volatility is noisy, so no horizon
tracks it closely. The method was always going to identify one and not the other.

The strongest available inference is that IBKR quotes both on the same convention, which would
make the implied series ~30 days. That is an inference, not a measurement, and is recorded as one.
Either way **C1's 5-day comparison was almost certainly a horizon mismatch.** The correct response
is one re-specified study, pre-registered at the matched horizon before it runs — not a sweep.

## Check power before building, not after running

Two decisions on 2026-09-03 turned on arithmetic done before any data was touched, and they went
opposite ways.

**The variance-risk-premium horizon** was set at 5 trading days because that yields 99
non-overlapping windows and a 1.1-1.7 vol-point minimum detectable effect, against the 2.4-3.6
points that 21-day windows would require. The premium the literature documents is 1-3 points, so
one horizon can see it and the other cannot.

**FX carry was abandoned** by the same calculation. Five years of monthly data can detect a
premium of roughly 9-14%/yr; the documented premium is 2-5%/yr. Detecting 3%/yr would need 42 to
94 years, and even twenty years of history only reaches 5.4%/yr. **It was not built.** A study
that cannot detect its own effect returns a null whatever the market is doing, and that null then
sits in the record being cited as evidence.

`power.mjs` does this arithmetic and both decisions are pinned as tests in `power.test.mjs`, so
the reasoning is reproducible rather than remembered. Use `effectiveN`, never the nominal count —
overlapping windows, same-day trades and correlated instruments all inflate it, which is the error
that turned ma_dip's 300 trades into 104 independent days.

## Constraints that bound any future work

- **No short or margin access on the Kraken account.** Cash-and-carry, basis trades and long/short
  pairs are untradeable on that venue regardless of what a backtest shows.
- **The sealed symbol pool is spent.** `AVAX, LINK, NEAR, SUI, UNI` were consumed on 2026-08-29
  and returned inconclusive. There is no fresh judge; `registry.sealedHoldoutStatus()` is the
  machine-readable check.
- **Data availability, confirmed 2026-09-03.** IBKR option chains and implied-volatility history
  are available; IDEALPRO FX bars and non-USD short-rate series are available. That means the data
  exists. It is not a result about returns.

## What would actually constitute an edge

`ALPHA_DEFINITION.md` holds the bar and `promotion.mjs` enforces it as ten machine-checkable
conditions returning PASS, FAIL or BLOCKED. **BLOCKED is not a soft pass** — a missing input means
the question was never asked.

Nothing has passed it. The gate has never been run against a real candidate, which is worth
stating plainly rather than letting the existence of the machinery imply otherwise.

---

# Addendum, 2026-09-03: the backtest campaign

Everything above stands for what it tested. This section records a campaign that tested something
different and got a different answer, and it is placed here rather than woven into the text above
so that neither result quietly overwrites the other.

## One sentence above is now too strong

> "A gate applied to a population with zero expectancy selects a subset of zero expectancy."

That is sound arithmetic and the wrong premise. The population was not zero-expectancy — it was
**cost-destroyed**, which is a different thing and admits a different escape. Cost in R is roughly
`0.017 / stopPct` at Kraken taker rates, so a 1% stop pays 1.70R in fees and slippage before the
trade does anything while a 15% stop pays 0.11R. The families in the tournament traded tight stops
often; a wider stop taken rarely is not a subset of that population, it is a different one.

The demonstration: `ma_dip` at no stop floor takes 2,796 trades and ends at $0 — genuinely wiped
out, not a modelling artifact. The same family at a 15% floor takes 65 trades and ends at $1,138.

## What the campaign found

A daily-bar long-only trend-following construction on 29 Kraken pairs: `breakout` entries, a
200-day moving-average trend gate, a 3% minimum stop, no take-profit that is ever reached, a
100-bar hold cap, a breakeven stop armed at 2.5R, a volatility floor, sizing inversely to each
instrument's ATR, and fills on the next bar's open.

| | balance from $1000 | max drawdown |
|---|---|---|
| in-sample, best of 2,206 configurations | $4,874.70 | 12.94% |
| **walk-forward, parameters fitted only on the past** | **$1,974.68** | **13.02%** |
| BTC buy-and-hold, same walk-forward window | $1,544.10 | 52.06% |
| equal-weight basket of all 29 pairs, same window | $779.28 | — |

## The three things that make it worth recording

**It survives a matched-geometry random-entry null.** Same pairs, same stop distances, same target,
same fee, random entry bar: excess 1.73R, p=0.005. It survives the harder version too — random
entries restricted to bars the trend gate itself allows — where the excess grows rather than
shrinks, so the gate is not doing the work alone.

**It survives cost stress.** At three times the modelled fee and forty times the modelled slippage
it still ends above the equal-weight basket.

**The walk-forward's parameter choices are stable.** `trendMa 150`, `minStopPct 0.03` and
`volTarget 0.05` were chosen in all nine quarters. A search fitting noise does not do that.

## The three things that stop it being a finding

**In-sample bias is measured, and it is large.** Over the identical window, fitted on all data:
+1.85R. Fitted only on the past: +1.14R. Roughly 40% of the apparent edge was the search seeing
the answer.

**The return is three quarters out of nine.** 2024Q1, 2024Q4 and 2025Q3 carry it; the other six are
negative. Restricted to 2025 the walk-forward is positive only because of one quarter. At the trade
level the same shape: the top 5 of 143 trades are 79.7% of all R, the median trade is −1.11R, and
the win rate is 39.2%. This is what trend following looks like, and it also means the mean is an
unstable statistic and every p-value here rests on a handful of observations.

**The walk-forward is not a holdout and must not be quoted as one.** The grid was designed after
seeing full-sample results, the universe was chosen after seeing all of it, and the entry mode,
filters and fill delay were held at in-sample values rather than refitted.

## What has not been tested

Equities — the market the owner named as the actual target. This container holds crypto daily and
4-hour bars only. Nothing above transfers until it is run there, and the earlier equities result in
this document is a warning about exactly that: an apparent edge that turned out to be the window's
payoff geometry.

Runners: `robustness.mjs`, `walkforward.mjs`, `entrynull-run.mjs`, `benchmark.mjs`. Every
configuration ever scored is in `campaign-log.jsonl`; the state and the caveats are in
`campaign-state.json`.


---

# Addendum 2, 2026-09-04: cross-sectional momentum, and the blind spot that hid it

The addendum above closed the entry-timing question and it stands. This one records why that was
the wrong question, and what answering the right one produced.

## The blind spot

Every null in this project draws random entries **from the same symbols in the same proportions
the strategy traded them**. That design holds symbol selection constant so it can isolate timing —
and it is therefore blind *by construction* to an edge that lives in **which** asset you hold
rather than **when** you buy it.

Cross-sectional momentum lives precisely there. It is among the most replicated results in
finance: Jegadeesh and Titman (1993), still present in their own 2023 follow-up, with time-series
momentum showing post-crisis Sharpe ratios comparable to pre-2008.

So "no edge" was a sound conclusion from sound experiments asked of too narrow a question. That is
the single most useful lesson in this document: **a null that controls a variable away can never
find an edge in it**, and the discipline that makes a test honest is the same discipline that can
make it useless.

## The rule

Rank every symbol by its return over the last 252 bars, skipping the most recent 21. Hold the top
decile long and the bottom decile short, equally weighted, dollar-neutral. Rebalance every 21 bars.
No stop, no target, no entry trigger.

Those parameters are the canonical 1993 construction. **They were not selected by a sweep**, which
is what separates this from the 2,446 configurations that preceded it.

## What it did

| | balance | CAGR | max drawdown |
|---|---|---|---|
| long-only top decile | $1,743 | 23.2% | 29.7% |
| bottom decile | $337 | −33.6% | 68.4% |
| **dollar-neutral spread**, 5% borrow | **$1,948** | **29.4%** | **10.1%** |
| SPY, same window | $2,009 | — | ~21% |

Out of sample, parameters refit quarterly on training data only, 2025-01 to 2026-08:

| | balance | CAGR | max drawdown |
|---|---|---|---|
| **walk-forward spread**, 5% borrow | **$1,652** | **35.1%** | **10.4%** |
| SPY | $1,315 | 18.6% | — |
| equal-weight all 128 | $1,303 | 17.9% | — |

`252/5` was chosen in all seven quarters. Every earlier result in this project lost roughly 40% of
its apparent edge to a walk-forward; this one lost nothing.

## The gate

`xsmom-gate.mjs`, seven conditions passing:

```
PASS  positive_net_expectancy  0.0215 monthly
PASS  win_rate_margin          58.1% against a 37.7% breakeven
PASS  interval_excludes_zero   [0.0005, 0.0418]
PASS  survives_multiplicity
PASS  beats_matched_null       p = 0.0050
PASS  survivable               10.09% against a 25% ceiling
PASS  out_of_sample            0.0251 monthly
FAIL  sample_sufficient        31 periods against 32 required
FAIL  beats_baseline_controls  0.02150 against SPY's 0.02251
BLOCKED pre_registration       permanently, and correctly
```

The null is the one a spread needs: draw the same number of names at random, split them
arbitrarily into a long and a short half, run the same book. The spread lands outside that null's
entire range — median $944, 95th percentile $1,166, spread $1,948.

## The two failures, which matter more than the seven passes

**On raw return, SPY beats the spread.** 0.02150 monthly against 0.02251. What the spread wins is
return per unit of drawdown, 2.92 against 0.89. Those are different claims. Risk-matched at 2.0x
with 6% financing the spread returns $3,248 at a 20.1% drawdown against SPY's $2,009 at 21% — which
answers the comparison and is not a recommendation, because leverage multiplies exposure to the
failure mode below.

**Thirty-one periods against thirty-two required.** Short by one. No further analysis of this data
fixes that; only elapsed time does.

## The failure mode this sample cannot show

Momentum's documented way of dying is not decay — it is a violent reversal after a market bottom,
when the beaten-down names in the short leg rebound hardest. The sample here, 2023-01 to 2026-09,
contains no crash-and-rebound. **The strategy has never been tested against the event that
historically breaks it**, and the 10% drawdown is therefore the least trustworthy number above.

## What is registered

`XSMOM-FORWARD-2026-09`, ledger seq 17. Frozen configuration, frozen 128-symbol universe, at least
32 forward periods from 2026-09-03. Three conditions, all required: mean monthly return above zero,
beats the random-split null at p < 0.05, drawdown at or below 25%. A momentum-crash clause requires
any 20%-decline-and-recovery sub-period to be reported separately and in full whatever it shows.

The in-sample hypothesis is **not** registrable — it was formed after seeing the result, and the
gate reports `pre_registration` as BLOCKED for exactly that reason. That block is correct and must
never be filled in retrospectively.

Runners: `xsmom.mjs`, `xsmom-wf.mjs`, `xsmom-gate.mjs`. Universes in `candle-bundle/`,
`equity-bundle/`, `sp500-bundle/`, deliberately separate roots.

## Block bootstrap: the independence assumption, measured (2026-09-05)

Every interval this campaign has quoted treated its period returns as independent draws. They are
not, and the sub-period tables always said so. `bootstrap.mjs` resamples contiguous blocks instead
of single periods, at n^(1/3) block length, on the same data and seed as the i.i.d. version.

**The prediction was wrong. The bands got narrower, not wider.**

| book | n | lag-1 acf (se) | 5-95 CAGR, i.i.d. | 5-95 CAGR, blocks of n^(1/3) | band ratio | P(lose) |
|---|---|---|---|---|---|---|
| crypto momentum | 50 | -0.140 (0.14) | 12.6% .. 73.8% | 16.6% .. 71.2% | 0.89x | 0.5% -> 0.0% |
| equities momentum | 31 | -0.323 (0.18) | -9.8% .. 31.4% | -4.3% .. 24.4% | 0.70x | 22.1% -> 14.0% |

Both books mean-revert period to period, so a replicate built from contiguous runs varies *less*
than one built from independent draws. Dependence does not automatically widen an interval; it
widens it when the dependence is positive, and these are negative.

**The narrowing is the data, not the scheme.** A moving-block bootstrap under-weights the ends of
the series — period 0 sits in one block where an interior period sits in `blockLen` — and equities'
fourth largest move *is* period 0, so the artefact was a live candidate. The circular version, which
wraps the series so every period carries equal weight, gives 0.89x and 0.70x against the moving
scheme's 0.92x and 0.72x. The gap is negligible; the effect is real.

**What this does and does not establish.** It is the strongest form of the crypto claim so far: a
test built to attack it, whose result could have taken it down, left the 5th percentile of annual
return *above* where the i.i.d. assumption had put it. It does not make 39% a forecast. The
bootstrap resamples realised period returns, so it carries sampling variation in those returns and
nothing else — not the choice of topK, not the canonical lookback, not regime change, and not the
momentum crash the sample has never contained. Its median is centred on the realised sample by
construction and is an in-sample number.

For equities the narrower band changes nothing: the book is closed on out-of-sample grounds
(0/5 and 2/5 on disjoint halves, no signal on a second universe), and a median of 8.9% with a 14%
chance of losing money is not an argument against that.

## Short-horizon momentum in crypto: closed (2026-09-05)

The campaign had tested short-horizon *reversal* and long-horizon *momentum*, never short-horizon
momentum. Pre-registered grid: lookback in {4, 8, 15, 30, 60} x skip in {0, 1}, rebalance = lookback,
topK 3. Ten cells, Benjamini-Hochberg at q=0.05 over a family of ten.

**The ranking carries information at short horizons. It does not survive to the account.**

Gross (zero-cost) final balance beats $1000 at every horizon but 60 bars — $2050 at 4 bars, $2851 at
8. Seven of ten cells clear BH. But at 4 bars the book rebalances 91 times a year against the
canonical book's 17.4, and the standing 0.8% crypto slippage — calibrated for a 21-bar rebalance —
is then charged five times as often. Cost eats 99% of the 4-bar result, 88% of the 8-bar, 47% of the
30-bar.

**A p-value at the floor beside a net of $29 is not evidence of anything tradeable.** The 4/0 cell's
p is 0.0020 and the random-selection null's median final balance is **$10**. Beating random selection
at the same ruinous turnover says the ranking works; it says nothing about the book. Both numbers are
now printed side by side because the p alone invites the wrong read.

Swept across execution cost, canonical 252/21/21 wins at every column — $3147 gross, $3111 at 0.05%,
$3076 at 0.10%, $2623 at 0.80% — against the best short-horizon cell's $3034 / $2933 / $2836 / $1759.
No short horizon replaces it at any cost anyone could achieve.

### The diversification claim, and why it was wrong

30/1/30 looked decorrelated from canonical (rho 0.10) and a 50/50 blend beat both legs on Sharpe at
every cost level. That result was an artefact of my own code. `alignReturns` compounds the faster
book onto the slower one's clock and the faster book must be passed first — and 30/1/30 rebalances
**12.2 times a year against canonical's 17.4**, so canonical is the faster one. Hard-coding the order
aligned them backwards.

Corrected, the correlation is **0.55, not 0.10**, and the blend beats both legs at **0 of 4** cost
levels. Sweeping every horizon rather than the cherry-picked one: 4/1, 8/1, 15/1, 30/1 and 60/1 all
score 0/4. There is no horizon diversification benefit here.

This is the fourth time in this project that a misalignment has read as decorrelation. It is worth
stating as a rule: **misalignment destroys covariance and nothing else, so a surprisingly low
correlation is a bug report until proven otherwise.** It was caught only because extending the test
to horizons I had not selected forced the ordering logic to become explicit.

## Funding rates: analysis pre-registered 2026-09-06, before the data existed

Written while every exchange host is blocked from this container and no funding series is
obtainable. Nothing in it was chosen by looking at a result, because there was nothing to look at.
Every prior failure in this project came from choosing after seeing — the PARA symbol, the blend
weight, the 30-bar horizon picked out of a grid that had just been run. `carry-run.mjs` is fixed
before the data lands and runs once, unchanged, when it does.

**Why funding.** It is the first non-price input this project has had. All fourteen signals tested
so far are transforms of the same OHLCV. Funding is a payment stream between longs and shorts and
carries positioning information price does not.

**Three hypotheses, directions fixed in advance.** H1 carry: short highest-funding, long lowest,
return = price spread **plus** funding collected; needs perpetuals, so it is not tradeable by this
account, but it establishes whether the premium exists. H2 crowding, long-short spot: identical
positions, price return only — persistent positive funding means crowded longs, so the registered
direction is that high trailing funding predicts **lower** subsequent spot return. H3 crowding,
long-only spot: the only one this account can hold today.

**H1 and H2 are the same book measured two ways** and are therefore not independent tests. Family
of 9 per venue for Benjamini-Hochberg; genuinely independent groups are closer to 3, one per
lookback. Both counts are printed.

Parameters fixed and not to be swept: lookbacks {7, 30, 90} bars, rebalance 21, topK 3 a side,
slippage 0.80%, borrow 5%/yr, 252-bar warmup for every lookback so all three start on the same date.
Kraken and OKX analysed separately and never averaged; a cell counts only if it survives on **both**.

**Kill conditions, registered now:** if no H2 or H3 cell clears BH on both venues, funding-as-signal
is closed. A result at one lookback only, or one venue only, is noise.

### What validation showed, before any real data

| check | result |
|---|---|
| power — planted crowding signal | all 9 cells clear BH, p at the floor |
| false positives — both venues pure noise, 8 independent draws | **0 of 8** confirmed |
| funding actually flows into H1 | H1 $5,410 vs H2 $2,015 on a planted 0.1%/day, correct sign |
| no-lookahead | pinned by test: ranking at bar i uses funding through i−1 only |

Three defects were found and fixed by building it this way rather than after the fact:

**`Number("")` is 0, not NaN.** An empty `fundingTime` passed a `Number.isFinite` guard and became
1970-01-01 — a row silently wrong rather than loudly absent.

**BH was pooled across venues** into a family of 18, contradicting the registration's own "family
size 9, venues analysed independently". On the adversarial validation (one venue signal, one noise)
the pooled procedure passed two **noise** cells: nine strong true positives dragged the threshold up
until marginal noise cleared it. Per venue, every noise cell is correctly rejected.

**`anchoredDrawdown` was called with the rotation objects** rather than `(periodReturns, barReturns,
times, rebalanceLog)`. It would have reported a drawdown built from garbage without erroring.

**Known limitation, stated rather than discovered later.** Cross-venue confirmation protects against
a fluke when both venues are clean — 0 of 8 above. It is weaker when one venue carries genuine
signal, because the requirement then collapses to whether the other venue flukes at the same cell;
in the adversarial synthetic, one cell did. Both venues measure the same underlying quantity in the
real case, which is the case the 0-of-8 covers.

## The data arrived, and it broke the surviving result (2026-09-06)

The owner ran the pull in Colab, routing around a container egress policy that denies exchange
hosts. Three datasets landed: Binance daily bars back to 2017-08, Kraken funding, OKX funding.

### Carry: untestable, not negative

`carry-run.mjs` ran **exactly as pre-registered**, unchanged. It scored nothing.

Kraken funding covers **25.2%** of the price window against the registered 80% screen; OKX covers
**4.4%**, which is 2 rebalance periods against a registered minimum of 6. Kraken's history begins
2025-09 and OKX's endpoint serves roughly three months. The registration requires cross-venue
confirmation and states that one venue "is one measurement, and the pre-registration does not
accept it as a finding" — so the verdict was fixed before the run.

This is a data limitation, not a result. Carry remains untested. It needs a venue serving several
years of funding history.

### The result that matters: momentum is source-fragile

The control row failed, which is why it was there. On identical names and dates, the Kraken bundle
returns $2,910 and the Binance bundle $1,915 — a **34% gap** between two sources whose daily returns
correlate 0.997 to 0.9999 on every name used. The Kraken run reproduces the published $2,623 exactly,
so the plumbing is sound and the discrepancy is real.

The two sources select **different names at 65% of rebalances** — 2.47 of 3 in common on average.
Concentration is the mechanism, and it was measured rather than asserted:

| topK | Kraken | Binance | gap | identical picks | names shared |
|---|---|---|---|---|---|
| 3 | $2,910 | $1,915 | **34%** | 53% | 2.47 of 3 |
| 6 | $1,860 | $1,485 | 20% | 34% | 4.86 of 6 |
| 9 | $1,399 | $1,242 | 11% | 25% | 7.58 of 9 |

At 3 names a side, one flipped rank is a third of a leg. **The published 39.9% CAGR was measured at
the most source-sensitive configuration available**, and returns fall as the configuration becomes
reproducible. No amount of testing against one data source could have revealed this.

### Out of sample, on longer history, it fails

Within a single consistent source, so the comparison is like for like:

| window | periods | final | CAGR | maxDD | basket | p |
|---|---|---|---|---|---|---|
| 2023-01..2026-09 (the original window) | 51 | $1,861 | 23.6% | 32.7% | $992 | <0.0025 |
| **pre-2023, strictly out of sample** | **75** | **$1,116** | **2.6%** | **47.8%** | **$1,147** | <0.0025 |
| full 2017-08..2026-09 | 139 | $1,706 | 6.9% | 61.8% | $1,114 | <0.0025 |
| 2018 collapse | 14 | $899 | −12.4% | 19.6% | $929 | <0.0025 |

**Out of sample it returns 2.6% a year with a 47.8% drawdown and loses to simply holding the
universe.** Over the full nine years, 6.9% with a 61.8% drawdown.

**The predicted failure mode is confirmed.** Through the 2018 collapse the book returned −12.4% a
year. This document named that exact scenario as the untested one and called the 10% drawdown "the
least trustworthy number above." It was right.

**Every window is still significant at p < 0.0025, including the ones that lose to the basket.**
The ranking beats random selection everywhere. That is selection skill and it is not tradeable
return, and quoting the p without the basket column would misrepresent all four rows.

### Where this leaves the campaign

Crypto momentum was the surviving claim, held through a random-selection null at 3,000 draws, five
disjoint-half splits, a twelvefold frequency range, a cost stress, and a block bootstrap built to
break it. It does not survive a second data source or a longer sample. The 2023–2026 window was not
representative and 3 names a side was not reproducible.

Excluded on integrity grounds before any of this: ALGO, ETC, TAO and ZEC, whose two sources
disagree on daily returns (correlation below 0.99, TAO at 0.922 with a 45% maximum discrepancy),
and XMR, delisted from Binance in 2024-02 while the Kraken bundle starts 2025-01 — no overlap, so
nothing to reconcile.

## Carry: tested properly, and closed (2026-09-06)

`data.binance.vision` — reachable where `fapi.binance.com` returns 451 — yielded monthly funding
archives for 29 symbols spanning **2020-01 to 2026-08**, roughly 7,300 settlements each. That is
6.7 years against Kraken's one, and it clears the pre-registered 80% coverage screen: 25 of 28
symbols usable, 51 rebalance periods.

`carry-run.mjs` ran with its hypotheses, directions, parameters, family size and thresholds exactly
as registered. Adding `funding-binance` to the venue list adds a data source; it changes nothing the
registration fixed.

### The result: nothing, and not narrowly

| L | hypothesis | final | CAGR | maxDD | Sharpe | p |
|---|---|---|---|---|---|---|
| 90 | H1 carry (price+funding) | $820 | −6.7% | 44.3% | −0.32 | 0.0495 |
| 90 | H2 spot long-short | $697 | −11.8% | 51.0% | −0.57 | 0.1179 |
| 7 | H1 carry | $656 | −13.7% | 46.1% | −0.82 | 0.1579 |
| 7 | H2 spot long-short | $566 | −18.0% | 51.0% | −1.10 | 0.2794 |
| 30 | H1 carry | $457 | −23.9% | 58.1% | −1.61 | 0.5192 |
| 90 | H3 spot long-only | $420 | −26.0% | 88.4% | −0.35 | 0.6092 |
| 7 | H3 spot long-only | $394 | −27.7% | 87.7% | −0.43 | 0.6802 |
| 30 | H2 spot long-short | $391 | −27.9% | 63.7% | −1.87 | 0.6882 |
| 30 | H3 spot long-only | $295 | −34.6% | 89.6% | −0.56 | 0.9100 |

**Nothing clears Benjamini-Hochberg.** Best p is 0.0495 against a rank-1 threshold of 0.0056. Every
cell loses money and every Sharpe is negative. Under the pre-registered kill condition,
funding-as-signal is **closed**.

### Funding really is non-price information — which is what makes this negative worth something

The registered direction was crowding: high trailing funding predicts lower subsequent spot return.
Every book lost, which implies the inverse would have gained. The obvious suspicion is that the
inverse is just momentum — high funding follows a price rise — and that funding therefore carries
nothing price does not.

Measured, not assumed. Cross-sectional rank correlation between trailing funding and trailing
return over the same window: **0.017 at L=7, 0.055 at L=30, 0.089 at L=90**. Funding ranks the
universe almost independently of price.

So this was a genuine test of a genuine non-price source — the thing the campaign was told it had
never attempted — and the source does not predict the cross-section. The inverse direction would
have made money, is **not** momentum, is unregistered, and cannot be claimed. What it is, I do not
know.

### An unexplained cross-venue disagreement, reported rather than resolved

Kraken and Binance overlap for a year. Their **daily funding correlates at a median of 0.514**, with
14 of 28 symbols below 0.50 (LTC −0.05, SUI 0.007, UNI 0.058) and outright sign disagreement on the
year's mean for ADA, ETC, LTC, NEAR and UNI. Compare the candle cross-check, where the same two
vendors agreed on returns at 0.997–0.9999.

This triggers the registered kill condition independently of the BH result.

Two explanations were proposed and both refuted:

**Liquidity** — that major perps arbitrage across venues while thin alts have local positioning.
Top half by dollar volume, mean correlation 0.432; bottom half, 0.471. If anything backwards.

**Timezone** — the Kraken pull used Python's `time.mktime`, which reads a struct as local rather
than UTC. Checked: the first CSV record is `2025-09-03T08:00:00Z`, exactly matching the API probe,
and every settlement lands on an exact UTC hour. No shift.

The disagreement is real and I have no confirmed mechanism for it.

### Three mechanisms proposed today, three refuted by measurement

Liquidity explaining the venue split. Timezone explaining the venue split. Momentum explaining the
inverse carry book. Each was plausible, each was measured, each was wrong. The one before them —
dispersion explaining the Kraken-14 ranking — was also wrong. **In this project a proposed mechanism
has a worse than even record, and the only ones that survived were the ones that got measured.**

## Derivatives positioning: tested, and closed (2026-09-10)

Binance daily `metrics` archives, 29 symbols, 2022-01 to 2026-09, ~1,712 days each — open
interest, top-trader long/short ratio, taker buy/sell volume ratio. `positioning-run.mjs` ran
**exactly as pre-registered**: three signals with directions fixed in advance, family of 18,
Benjamini-Hochberg at q=0.05, and a kill condition labelling any cell that ranks like price a
price transform.

**Six of eighteen cells cleared BH. None is tradeable.**

Against the controls the runner did not print — equal-weight basket **$1,091 / 3.1% / 75.3% DD**,
buy-and-hold BTC **$2,498 / 37.3%** over the same 1,055 bars:

| cell | final | CAGR | maxDD | Sharpe | p | vs basket |
|---|---|---|---|---|---|---|
| TAKER 90 long-only | $1,355 | 11.1% | 81.2% | 0.12 | 0.0020 | beats, *worse* DD |
| TAKER 7 long-only | $1,188 | 6.2% | 74.4% | 0.08 | 0.0055 | marginal |
| TAKER 30 long-only | $1,126 | 4.2% | 73.8% | 0.06 | 0.0060 | ≈ basket |
| TAKER 30 long-short | $1,094 | 3.2% | 19.0% | 0.19 | 0.0065 | ≈ basket, quarter the DD |
| OI 7 long-only | $1,068 | 2.3% | 85.0% | 0.03 | 0.0080 | **loses** |
| TAKER 90 long-short | $992 | **−0.3%** | 23.3% | −0.01 | 0.0115 | **loses** |

One survivor loses to the basket. One has a negative CAGR and still clears BH at p=0.0115 — the
clearest illustration yet that **beating random selection is selection skill, not return**. The
best cell loses to buy-and-hold BTC by 3.4× while carrying a larger drawdown than holding
everything. Every Sharpe lies between −0.01 and 0.19.

**The one cell worth naming.** `TAKER 30 long-short` returns what the basket returns at a 19.0%
drawdown against its 75.3%. That is a real risk reduction rather than a return, and its Sharpe of
0.19 over under three years carries a standard error near 0.6 — indistinguishable from zero. It is
a direction worth remembering, not a result.

**Positioning IS non-price information.** Rank correlation against trailing return ran −0.16 to
+0.10 across all nine signal-lookback pairs, so the pre-registered price-transform kill condition
never fired. As with funding, this was a genuine test of a genuine non-price source, and the source
does not produce a tradeable cross-sectional edge.

**A defect in the pre-registration, recorded rather than quietly fixed.** `positioning-run.mjs`
prints no basket control. Six cells cleared BH and nothing in its output would have revealed that
two of them lose to simply holding the universe. Standing discipline caught it; the runner did not.
Any future pre-registration in this project must carry its baseline control inside the registered
analysis, not alongside it.

## FVG / iFVG entries: the eleventh entry family to fail the same null (2026-09-11)

The owner asked whether inverse fair value gaps and cross-timeframe pattern recognition had been
tried. They had not been. `fvg-run.mjs` was pre-registered before it ran: four detectors
(bullish/bearish FVG, bullish/bearish inverse FVG) on two timeframes, long-only, family of 8, two
required gates — beat the matched-geometry random-entry null, **and** beat buy-and-hold.

**All eight cells lose money.** Mean R runs from −0.12 to −0.34. Not one is positive.

| tf | signal | trades | mean R | null R | p | buy&hold R |
|---|---|---|---|---|---|---|
| 240 | ifvgBull | 7,763 | **−0.1196** | −0.1918 | 0.0002 | +19.14 |
| 240 | fvgBull | 11,768 | **−0.1417** | −0.1883 | 0.0012 | +19.14 |
| 1440 | fvgBull | 2,731 | −0.2116 | −0.2339 | 0.2292 | +13.37 |
| 1440 | ifvgBull | 1,810 | −0.2207 | −0.2440 | 0.2637 | +13.37 |
| 240 | ifvgBear | 7,878 | −0.2224 | −0.1912 | 0.9615 | +19.14 |
| 240 | fvgBear | 11,745 | −0.2454 | −0.1948 | 1.0000 | +19.14 |
| 1440 | fvgBear | 2,804 | −0.2589 | −0.2499 | 0.6238 | +13.37 |
| 1440 | ifvgBear | 1,911 | −0.3367 | −0.2423 | 0.9955 | +13.37 |

**Two cells clear the null — by losing less than random entry does.** `240m ifvgBull` reaches
p=0.0002 and `240m fvgBull` p=0.0012, and both survive the cumulative rank-1 threshold of 0.0028
against a family of eighteen. They are also both **negative**, against a buy-and-hold of +19.14R
over the same bars and the same universe.

This is the clearest statement of the pattern the campaign keeps producing: **a p-value of 0.0002
on a book that loses money.** The null is random entry with the same stop geometry, so beating it
measures only that the trigger is less bad than a coin flip. It says nothing about whether the
trade should be taken at all.

**It is also the exact gap in the owner's IBKR manual.** That document's research scorecard and its
eight hard validation gates never require a baseline comparison. A cell here passes multiplicity
correction against eighteen families and still loses 0.12R per trade while the asset returns 19R.
The second gate is not a refinement; without it the first gate endorses a losing strategy.

Closed: the eleventh entry family to fail this null, after the ten in the DJIA-30 work.

### And the related question: entries from one strategy, exits from another

Already measured, and the answer is why the above was predictable. Zero of ten entry families beat
their matched-geometry null; `ma_dip`, the best, sat at the **52.1st percentile of its own null**.
A random entry with the same geometry returned **+0.1637R**. The exits carry the result and the
entry half is interchangeable with random — so combining a "better" entry with a good exit is
selecting a new geometry, not adding predictive content. *The geometry is not an edge measured
during a good period. It IS the good period.*

## Overnight vs intraday decomposition (MR11 / HX13) — the twelfth family, closed

Pre-registered in `overnight-run.mjs` and committed before the run. Universe `sp500-bundle/1440`:
128 US names, 920 dates, 117,760 symbol-days, 2023-01 → 2026-09. Cost model `usEquityIbkr`
(0.5bp fee + 5bp slippage per leg). Crypto excluded — a 24/7 market has no overnight session.

This mattered because **every prior result in this repository is computed close-to-close.** The
open price sat in all four bundles the whole campaign and had never been used as a signal; its one
appearance anywhere was gap accounting in `studies/overlay.mjs`. So it was the last unused
information source in data we already own.

**The integrity gate passed**, which is a result in its own right: 154 of 117,760 symbol-days carry
`|overnight| > 15%` (0.13%, gate ≤ 1%) and the correlation between the two legs on those extreme
days is −0.0173 (gate ≥ −0.5). The `sp500-bundle` opens and closes are on one adjustment basis.
Had they not been, a 2:1 split would read as −50% overnight and +100% intraday and very nearly
cancel in the close-to-close return every prior study used — invisible to every other check here.

**The published anomaly does reproduce, descriptively.** Overnight carries 3.56bp/day against
intraday's 2.11bp/day: **64% of the total daily return accrues while the market is shut.**

**It is not an edge.** Holding only the overnight leg returns +36.16% gross over 3.65 years against
a buy-and-hold of ~58.6% gross. Giving up the intraday 2.11bp costs more than the concentration
gains, before a single fee.

| cell | mechanism | gross | net | cost drag | vs B&H | null p |
|---|---|---|---|---|---|---|
| A | overnight-only book | +36.16% | −50.53% | 86.70 | −108.96 | n/a |
| B | intraday-only book | +16.81% | −57.56% | 74.37 | −115.99 | n/a |
| C | XS momentum on overnight component | +0.83% | −16.10% | 16.93 | −74.53 | 0.9838 |
| D | XS momentum on intraday component | +57.96% | +31.44% | 26.52 | −26.99 | 0.4071 |
| E | XS momentum on total return (control) | +15.25% | −4.10% | 19.35 | −62.53 | 0.9298 |
| F | MR11 overnight-lag divergence | +23.49% | +2.75% | 20.73 | −55.68 | 0.8605 |

Baseline: equal-weight buy-and-hold of the same 128 names, **+58.43% net** (CAGR 13.43%).

**The line that decides it: a random selection of the same 13 names on the same dates, held the
same way and charged the same costs, returns +27.99% net.** Three of the four selection rules lose
to a coin flip. The pre-registered kill condition anticipated the one that does not: D beats the
control E by 35 points, which read alone looks like the decomposition working — and D sits at the
59th percentile of its own null, a spread a coin flip reproduces 41% of the time. Without the
selection null that 35-point gap would have been reported as a finding.

D's gross return (+57.96%) is also, to within a point, the market's own gross return. Ranking on
the intraday component earns exactly the index and then pays 26 points of turnover for the
privilege.

**Cells A and B failed by the arithmetic written into the pre-registration**: a single-leg book
turns over every session, 11bp a day, ~28% a year. That was stated before the run and is confirmed
to the point.

Closed. Twelfth family, twelfth failure of the same pair of gates. Of the six manual strategies
that survived triage into Tier A, the one with the best prior is now the one with a verdict.
