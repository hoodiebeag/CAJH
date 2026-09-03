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
