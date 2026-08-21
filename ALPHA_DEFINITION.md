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
