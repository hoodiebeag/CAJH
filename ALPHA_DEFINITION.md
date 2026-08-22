# What counts as an alpha in this project

Written 2026-08-21 from a human-supplied risk/reward reference. Purpose: replace
"is this good?" — asked ad hoc, after seeing results — with a bar fixed in advance
that a candidate either clears or does not.

This project has run ~46 studies and produced exactly one net-positive real-cost
result (`EQUITIES-BASELINE-PORT`, breakout on equities). That is precisely the
moment a definition is worth having, and precisely the moment it is most tempting
to write one the current candidate happens to pass. The bar below is derived from
general math, not from that result, and §4 applies it to that result honestly.

---

## 1. The arithmetic every claim reduces to

**Breakeven win rate.** For a strategy whose average win is `R` times its average
loss:

```
W* = 1 / (1 + R)
```

| R (avg win / avg loss) | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 10 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| breakeven win rate | 67% | 50% | 40% | 33.3% | 25% | 20% | 16.7% | **14.3%** | 9.1% | 4.8% |

> Correction to the source table: it lists 16.67% at 1:6. That is the 1:5 value.
> `1/(1+6) = 14.29%`. The error is conservative — it demands a higher win rate
> than the math requires — but it is still wrong, and the source's own general
> formula `1/(1+R)` contradicts it.

**Expectancy**, in R units per trade:

```
E = W·R − (1 − W)
```

`E > 0` is necessary and nowhere near sufficient — see §2.

**`R` must be realised, never targeted.** A family configured with `tpR: 3` does
not have `R = 3`. Breakeven locks, timeouts, and partial exits all truncate
winners, so realised `R` is systematically below target. Compute `R` from actual
average win ÷ average loss on the holdout, or the breakeven column is fiction.

**Costs live inside R, not beside it.** Every figure above must be net of the real,
sourced cost basis. This project has already been wrong by ~2x on fees once
(`FEE-SCHEDULE-REBASE`), and cost was 94.1% of the crypto baseline drag
(`COST-COMPONENT-ATTRIBUTION`). A gross-R alpha claim is not a claim.

---

## 2. Why positive expectancy alone is not an alpha

**Drawdown is asymmetric.** Recovery required is `D / (1 − D)`:

| drawdown | 10% | 20% | 30% | 50% | 70% | 90% |
|---|---|---|---|---|---|---|
| gain needed to recover | 11.1% | 25% | 42.9% | 100% | 233% | 900% |

A 50% drawdown demands a double just to return to flat. So a drawdown ceiling is
part of the definition, not a preference.

**Losing streaks are ordinary, not tail events.** `P(k losses in a row) = (1−W)^k`.
A low win rate paired with a high `R` is mathematically fine and psychologically
and operationally brutal: at `W = 30%`, a 5-loss streak has a 17% chance of
occurring at any given point, and you should expect several across a 60-trade
sample.

**Capital after `k` losses at fixed fractional risk `f` is `(1−f)^k`.** At 2% risk,
10 straight losses is −18.3%; at 5% risk it is −40.1%, which by the table above
then needs +67% to recover.

**A point estimate is not an edge.** `B5-REVERSAL` cleared a pre-registered gate at
PHASE3 — the first in this project's history — and was reversed at PHASE4. The
distinguishing question is never "is the number positive" but "is it separable
from noise, and does it survive the family it belongs to".

---

## 3. The definition

A candidate is an **alpha** only if it satisfies **all six**. Any single failure
disqualifies; there is no weighing or partial credit.

1. **Positive net expectancy.** `E > 0` in R units, net of a sourced, cited,
   real-world cost basis.
2. **Win rate clears breakeven with margin.** Realised `W` exceeds `1/(1+R)` — with
   realised `R` per §1 — by a margin stated *before* the holdout is scored. A
   result sitting a few percentage points above breakeven is inside the noise of
   its own estimate.
3. **Statistically separable from zero.** A 95% CI on holdout mean R excluding
   zero, by permutation or block bootstrap (this project's `blockBootstrapCI` is
   the house convention), **and** surviving BH-FDR correction across the formal
   NHST family recorded in `MULTIPLE_COMPARISONS_AUDIT.md`. Family membership is
   not waived by changing asset class.
4. **Sample large enough to support the claim.** Sufficient trades that the CI in
   (3) is informative rather than vacuous. Report the required `n` alongside the
   observed `n`; if observed is far below required, that is a finding, not a
   detail.
5. **Survivable.** Max drawdown within a pre-registered ceiling justified by the
   recovery table, and the expected worst losing streak at the realised win rate
   stated explicitly with its capital impact at the intended risk fraction.
6. **Reproduced out-of-sample.** Holds on data not used to fit or select it — a
   different window, universe, or the untouched `SEALED_SYMBOLS` — with the
   protocol's replication requirement satisfied.

**Promotion to live is a further, human-owned decision (`D3`)** and is not implied
by clearing this bar. The standing minimum of 60 days / 50 trades of paper trading
after any pass is unchanged.

---

## 4. Applied to the only candidate that exists

`EQUITIES-BASELINE-PORT`: breakout, DJIA-30 point-in-time universe, real IBKR
costs, **net +0.1866R over 61 holdout trades**.

Taking the family's `tpR: 3` as an upper bound on `R` (realised `R` will be lower,
so these figures flatter the candidate):

| test | required | observed | verdict |
|---|---|---|---|
| 1. positive net expectancy | `E > 0` | **+0.1866R** | **pass** |
| 2. win rate margin | > 25% | ~29.7% implied | thin — 4.7pp |
| 3. CI excludes zero | yes | **[−0.27, +0.65]** | **fail** |
| 4. sample adequate | ~384 trades | **61** | **fail** |
| 5. survivable | ceiling + streak stated | not computed | not evaluated |
| 6. out-of-sample | reproduced | not attempted | not evaluated |

**It is not an alpha.** It is a positive point estimate with a confidence interval
comfortably containing zero — the same shape as `B5-REVERSAL`'s PHASE3 before
PHASE4 reversed it.

Streak exposure at the implied ~29.7% win rate, which test (5) would require
stating: `P(5 losses in a row) = 17.2%`, expected roughly 10 times across 61
trades; at 2% risk each such streak costs −9.6%.

> The t-statistic and CI here assume a clean 3R/−1R binomial. Real trades carry
> breakeven locks, timeouts and partial exits, so the true distribution differs.
> These figures are a screening approximation; `EQUITIES-BREAKOUT-SIGNIFICANCE`
> computes the real thing on the actual per-trade series and is authoritative.

**What would change the verdict.** Not a better number on this sample — more
sample. Test (4) says ~384 trades at the observed effect size, roughly 6x what
exists. `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` and `EQUITIES-ALL-FAMILIES-BASELINE`
are the queued routes to it. Re-running this window and reporting a nicer figure
would not.

---

## 4b. Applied to the candidate that changed the picture (added 2026-08-22)

`EQUITIES-MADIP-OUT-OF-SAMPLE`: `ma_dip`, point-in-time DJTA-20 universe with **zero ticker
overlap** with the DJIA-30 it was fitted and first scored on, real IBKR costs, **net +0.2994R
over 300 holdout trades**, 95% CI **[+0.0509, +0.5350]**, p=0.0116, **q=0.0435 — survives
family-wide BH-FDR across all 15 formal-NHST entries**.

| test | required | observed | verdict |
|---|---|---|---|
| 1. positive net expectancy | `E > 0` | **+0.2994R** net of real cost | **pass** |
| 2. win rate margin | > `1/(1+R)` on **realised** R | not computed | **not evaluated** |
| 3. CI excludes zero **and** survives BH-FDR | both | **[+0.0509, +0.5350]**, q=0.0435 | **pass** |
| 4. sample adequate | ~401 for 80% power at this effect | **300** | **marginal** |
| 5. survivable | drawdown ceiling + streak stated | not computed | **not evaluated** |
| 6. reproduced out-of-sample | yes | **yes — larger on the fresh universe** | **pass** |

**Three of six pass, two are uncomputed, one is marginal. That is further than anything else
has ever got here, and it is not an alpha yet.** The distinction matters: this document exists
precisely so that "the best result we have" and "clears the bar" stay separate ideas.

### What is genuinely new

Conditions **1, 3 and 6 hold simultaneously** — positive net expectancy, statistical
separability surviving correction, and out-of-sample reproduction. §5 below was written on
2026-08-21 stating that conditions 1 and 3 had **never** been met by the same candidate across
~46 studies. **That claim is now false**, and it was falsified in the strongest available way:
not by a bigger number on the same data, but by a replication on a non-overlapping universe
where the point estimate got *larger* (+0.1526R → +0.2994R) rather than decaying.

The contrast with `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`, run the same day on the same fresh
universe with the same method, is the reason this reads as signal rather than luck: `breakout`
went the other way, +0.1866R → −0.0854R, sign flipped.

### What is not established, stated as plainly as the pass is

- **Condition 5 is the one that killed the closest prior counterexample.** `B5-REVERSAL`
  cleared a pre-registered gate at PHASE3 and died at PHASE4 on a **−79% to −90%** max drawdown.
  Nothing here has computed `ma_dip`'s drawdown, its expected worst losing streak, or the
  capital impact of that streak at the intended risk fraction. Until that exists, condition 5
  is not "probably fine" — it is unknown, and it is historically where things die.
- **The interval is thin where it matters.** The lower bound `+0.0509` is **17% of the point
  estimate**. The result is significant, not comfortably so.
- **The CI may be optimistic for a reason unrelated to the signal.** `blockBootstrapCI`
  resamples contiguous blocks **by position in the flat trade array**; it has no notion of a
  calendar day. 300 trades across 20 transport names means signals fired by one sector-wide
  move are counted as independent observations. `DATE-CLUSTERED-RESAMPLING-AUDIT` (queued)
  recomputes this by date, and **can only widen the interval**. Given a lower bound of +0.0509,
  it is entirely possible for that audit to push this result back across zero. It should be run
  before any confirmatory step, not after.
- **Every result here is long-only** (`blackboard.engine_is_long_only`): the backtest engine has
  no short path. This is a long-only result measured over one window on one sector index, and
  it has not been separated from that sector's own drift.
- **Condition 2 needs realised R, not `ma_dip`'s `tpR: 5` target.** Breakeven at a true R of 5
  is a 16.7% win rate, but breakeven locks and timeouts truncate winners, so realised R is
  systematically lower and the real breakeven is higher. The margin is uncomputed.

**The right next step is not promotion and not a third universe.** It is closing conditions 2
and 5 on the evidence that already exists, and running the resampling audit that could
invalidate condition 3. All three are cheap relative to what they protect against.

---

## 5. Applied retrospectively to the whole record

Asked directly: does anything this project has already run meet the bar?

> **SUPERSEDED IN PART, 2026-08-22.** This section's central claim — that conditions 1 and 3
> have never been met by the same candidate — was true when written and is **no longer true**.
> See §4b above: `EQUITIES-MADIP-OUT-OF-SAMPLE` clears 1, 3 and 6 together. The section is left
> standing rather than rewritten, because the *pattern* it names remains the correct prior for
> every other candidate in the record, and because a document that quietly edits away its own
> falsified claims is worth less than one that shows where it was wrong.

**No — with one exception found on 2026-08-22, recorded in §4b.** And the way things fail is
still more informative than the count.

| candidate | 1. net E>0 | 3. CI excl. 0 + FDR | 5. survivable | 6. out-of-sample | verdict |
|---|---|---|---|---|---|
| `B5-REVERSAL` (L=3) | marginal (+0.0048R) | **train IC yes**, economics **no** | **no** (−79% to −90% DD) | **no** (sign flip on ±1 position) | fails |
| `CLASSIFIER-FUNDING-FEATURE` | **no** (−0.2412R) | yes (survives BH-FDR) | n/a | n/a | fails |
| `T4-PORTFOLIO-MOMENTUM` | yes (+30.8% return) | never computed | marginal (−33.1% DD) | **no** (Sharpe swings 52–92% on ±1 position) | fails |
| `EQUITIES-BASELINE-PORT` breakout | yes (+0.1866R) | **no** ([−0.27, +0.65]) | not computed | not attempted | fails |
| every other study (~42) | **no** | — | — | — | fails at (1) |

### The pattern worth naming

**Until 2026-08-22, no candidate had ever cleared conditions 1 and 3 at the same time** (`EQUITIES-MADIP-OUT-OF-SAMPLE` now does — §4b). Every other result
in this project's history is one of two shapes:

- **Statistically real, economically dead.** `CLASSIFIER-FUNDING-FEATURE` survives
  family-wise BH-FDR — one of only two that do — and still nets −0.2412R after
  cost. The signal is there; it cannot pay for its own execution.
- **Economically positive, statistically indistinguishable from noise.** The
  equities breakout result (+0.1866R, CI [−0.27, +0.65]) and `B5-REVERSAL`'s
  PHASE3 (+0.0048R, CI [−0.0064, 0.0142]) both sit on the right side of zero with
  intervals that comfortably contain it.

That these two sets did not intersect across the first ~46 studies remains the single most
useful summary of the research record, and it is not visible from any individual verdict. The
first intersection, when it finally came, did not come from tuning either shape closer to the
other — it came from a different market, a different family, and a replication on a universe
the strategy had never seen.

### On `B5-REVERSAL` specifically

It is the closest thing to a counterexample and repays a careful look, because it
*did* clear a pre-registered gate at PHASE3 — the only time that has happened
here. What killed it was not significance but **survivability**: PHASE4 measured
max drawdown between −79% and −90%. By §2's recovery table, −90% requires **+900%**
to return to flat. A strategy can be real, positive, and still uninvestable, which
is exactly why condition 5 is not optional and cannot be traded off against a
good point estimate.

It also failed condition 6 in the most diagnostic way available: the annual
return's *sign* flipped when position count moved from 3 to 4. An edge that
inverts on a one-position change is a fit to the sample, not a property of the
market.

### What this does not say

It does not say no alpha exists, and it does not say the search should stop —
that judgement belongs to `SEARCH-SPACE-EXHAUSTION-ASSESSMENT` and to the human,
not to this document. What it says is narrower and firmer: **nothing tested so far
qualifies**, and the reason is consistent enough across ~46 attempts to be
treated as structural rather than as a run of bad luck.
