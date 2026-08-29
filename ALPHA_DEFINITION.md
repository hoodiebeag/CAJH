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

> **CI corrected 2026-08-29 (`DATE-CLUSTERED-RESAMPLING-DJTA20`).** The 95% CI quoted above,
> [+0.0509, +0.5350], is the **position-blocked** bootstrap — it resamples by position in the
> flat trade array, not by calendar date, and 300 DJTA-20 trades condense to only **104 distinct
> calendar days (a 35% effective/nominal ratio)**, with signals from correlated same-day moves
> counted as independent observations. Under date-clustered resampling (same method, blocking by
> calendar day), the interval widens to **[-0.0851, +0.7129] and no longer excludes zero.** This
> was the project's one equities CI that positively excluded zero rather than merely failing to
> exclude it; it no longer does. The figure above is left in place as the number this section was
> originally written around — every place below that treats it as excluding zero is marked, not
> silently corrected.

| test | required | observed | verdict |
|---|---|---|---|
| 1. positive net expectancy | `E > 0` | **+0.2994R** net of real cost | **pass, but see note below — the entry rule itself does not clear its own null, on `ma_dip` alone or project-wide (`MADIP-RANDOM-ENTRY-CONTROL`, 2026-08-28; `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`, 2026-08-29)** |
| 2. win rate margin | > `1/(1+R)` on **realised** R | DJIA-30: R=2.65, margin +3.52pp (inside 95% Wald noise); DJTA-20: R=2.50, margin +7.12pp (outside it) | **measured, 2026-08-28 — not pre-registerable retrospectively; splits by universe** |
| 3. CI excludes zero **and** survives BH-FDR | both | position-blocked CI **[+0.0509, +0.5350]** — but the date-clustered CI is **[-0.0851, +0.7129] and no longer excludes zero** (`DATE-CLUSTERED-RESAMPLING-DJTA20`, 2026-08-29); separately, q=0.0580 at current family size n=20 | **FAIL on two independent grounds: BH-FDR (2026-08-27) and the CI itself (2026-08-29)** |
| 4. sample adequate | ~401 for 80% power at this effect | **300** | **marginal** |
| 5. survivable | drawdown ceiling + streak stated | calendar-time max DD **-81.7%** (DJIA-30) / **-74.2%** (DJTA-20) at 2% risk/trade, vs. a pre-registered 25% ceiling; **-100% (ruin) at 5%** on both | **FAIL, 2026-08-28 (`MADIP-SURVIVABILITY-CONDITION-5`)** |
| 6. reproduced out-of-sample | yes | **yes — larger on the fresh universe** | **pass** |

**Two of six pass as of 2026-08-29, condition 2 is now measured but does not cleanly pass or fail
(it splits by universe), condition 5 has now failed outright, one is marginal, and condition 3 — which passed
when this section was written on 2026-08-22 — has since failed on two independent grounds: BH-FDR
(2026-08-27, family growth) and, as of 2026-08-29, the confidence interval itself, which no longer
excludes zero under date-clustered resampling (`DATE-CLUSTERED-RESAMPLING-DJTA20`). Condition 1's
literal pass is further weakened as of 2026-08-29: the same matched-geometry random-entry null
that failed `ma_dip` alone (`MADIP-RANDOM-ENTRY-CONTROL`) also fails it, and every other scorable
equities family, when applied project-wide (`EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`: zero of ten
scorable families clear it, `ma_dip` at the 52.1st percentile).** It got further than anything
else ever has here, and it is not an alpha. The distinction matters: this document exists
precisely so that "the best result we have" and "clears the bar" stay separate ideas.

### What is genuinely new

Conditions **1, 3 and 6 held simultaneously** (3 has since failed — see the condition-3 note below) — positive net expectancy, statistical
separability surviving correction, and out-of-sample reproduction. §5 below was written on
2026-08-21 stating that conditions 1 and 3 had **never** been met by the same candidate across
~46 studies. **That claim is now false**, and it was falsified in the strongest available way:
not by a bigger number on the same data, but by a replication on a non-overlapping universe
where the point estimate got *larger* (+0.1526R → +0.2994R) rather than decaying.

The contrast with `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`, run the same day on the same fresh
universe with the same method, is the reason this reads as signal rather than luck: `breakout`
went the other way, +0.1866R → −0.0854R, sign flipped.

### What is not established, stated as plainly as the pass is

- **Condition 5 has now been measured, and `ma_dip` fails it the same way `B5-REVERSAL` did.**
  `MADIP-SURVIVABILITY-CONDITION-5` (2026-08-28) reran the frozen config on both holdouts,
  built a calendar-time equity curve that respects genuinely concurrent open positions (fixed-
  fractional sizing snapshotted at each trade's own entry, correlated DJTA-20 transport names
  firing together on shared moves), and pre-registered a 25% drawdown ceiling before computing.
  At the standard 2% risk-per-trade reference, max drawdown is **-81.7% on DJIA-30 and -74.2%
  on DJTA-20** — both squarely inside `B5-REVERSAL`'s disqualifying **-79% to -90%** range, and
  both requiring a **+288% to +448%** gain just to return to flat (`D/(1-D)`). Even at a
  conservative 1% risk-per-trade, drawdown is still -45% to -54% (+83% to +118% to recover). At
  5% risk-per-trade, both universes hit **ruin** (simulated equity reaches zero) partway through
  the holdout. The longest observed losing streak is 18 trades (DJIA-30) and 24 (DJTA-20); the
  expected longest streak at the realised win rate is 17 and 13 respectively, each worth roughly
  -30% to -38% of capital on its own at 2% risk. Condition 5 is not "probably fine" — it is now
  a **measured, decisive FAIL**, on the same failure mode that killed the project's only other
  near-miss.
- **The interval is thin where it matters.** The lower bound `+0.0509` is **17% of the point
  estimate**. The result is significant, not comfortably so. **(Annotated 2026-08-29: this is the
  position-blocked interval — see the dedicated bullet below on `DATE-CLUSTERED-RESAMPLING-DJTA20`,
  whose date-clustered lower bound is negative.)**
- **Condition 3 is now hanging by 0.0007, and not for any reason to do with `ma_dip`.**
  Its raw p-value has never moved from `0.0116`. Its BH-FDR q-value has: `0.0435` at 15 family
  members, `0.0464` at 16, **`0.0493` at 17**, against a `0.05` threshold. That drift is
  entirely the family growing around it.

  | family size | ma_dip q (rank 4, p=0.0116) | survives at q=0.05 |
  |---|---:|---|
  | 15 | 0.0435 | yes |
  | 16 | 0.0464 | yes |
  | 17 | 0.0493 | yes, by 0.0007 |
  | 18 | 0.0522 | **NO — flipped 2026-08-27** |
  | 19 | 0.0551 | no — drifting further out |
  | **20 (current)** | **0.0580** | no |

  **It happened, and it happened exactly as written above.** `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`
  closed on 2026-08-27 with **p=0.9990** — dead last in the family, wrong sign, KILLED on its own
  terms. It has no relationship to `ma_dip` beyond both being entries in the same correction
  family. Adding it grew the denominator from 17 to 18, and that alone moved `ma_dip` from
  survivor to non-survivor. **`ma_dip`'s own p-value has never changed from 0.0116, and its
  position-blocked confidence interval [+0.0509, +0.5350] still excludes zero.** What changed
  [for this BH-FDR mechanism] is the number of looks the project has taken. **(Annotated
  2026-08-29: this paragraph is about the BH-FDR mechanism specifically. The same interval fails
  a second, independent way under date-clustered resampling — see the dedicated bullet below,
  `DATE-CLUSTERED-RESAMPLING-DJTA20`, whose date-clustered version of this same interval,
  [-0.0851, +0.7129], does not exclude zero.)**

  The project is therefore back to **zero candidates clearing conditions 1 and 3 together**. The
  exception recorded in §4b lasted five days, from 2026-08-22 to 2026-08-27. Of the two entries
  that still formally survive at n=18, one (`LOG-REGRESSION-BANDS-CRYPTO`, rank 1) is a
  demonstrated benchmark artifact its own study disproved, and the other (`B5-REVERSAL L=3`) was
  killed on a −79% to −90% drawdown. Neither is a candidate.

  **This is the moment §4b's warning was written for, so it is restated here rather than
  quietly dropped:** the argument that the correction family is drawn too wide — that it spans
  different markets, mechanisms and datasets, and that `ma_dip` was pre-registered and replicated
  rather than selected as the family's best — is now exactly the argument that would restore the
  favoured result. It was foreseeable, it was written down in advance, and it must not be adopted
  now on the strength of having become convenient. If the family framing genuinely warrants
  revisiting, that case has to be made on its own merits, in a document that does not have a
  candidate riding on the answer.

  **What legitimately restores condition 3 is a smaller p-value from a larger sample**, which
  lowers `ma_dip`'s rank and buys real margin. At rank 3 of 20 it would need p < 0.0075; at rank
  2, p < 0.0050. Nothing else — and both thresholds tighten every time the family grows,
  which it has now done six times since this candidate was first scored. The bar for rescuing
  this candidate moves away from it on its own, whatever the project does next.

  Concretely: **the next formal-NHST test this project runs removes `ma_dip` from the survivor
  list — unless that test comes in at `p < 0.0116`, i.e. is itself more significant than
  `ma_dip`.** In that case `ma_dip` drops to rank 5 and its q falls to `0.0418`. Nothing else
  saves it. There are currently a dozen queued items, several of which will report p-values.

  `CLASSIFIER-FUNDING-FEATURE` has already crossed this threshold twice, in both directions,
  on exactly this mechanism.

  **The correct response to this is more evidence, not a smaller family.** Narrowing the
  correction family — on the grounds that these 17 tests span different markets, mechanisms and
  data, or that `ma_dip` was pre-registered and replicated rather than selected as the best of
  the set — would be a defensible statistical argument made at precisely the moment it happens
  to rescue the favoured result. `MULTIPLE_COMPARISONS_AUDIT.md` exists to prevent that. The
  legitimate route to a durable pass is a lower p-value from a larger sample, which drops
  `ma_dip`'s rank and buys real margin. If the family framing genuinely warrants revisiting,
  that case must be argued on its own terms, in advance, and never in response to a candidate
  being about to fall out.
- **Condition 3 fails on a second, independent ground as of 2026-08-29: the CI itself no longer
  excludes zero under date-clustered resampling (`DATE-CLUSTERED-RESAMPLING-DJTA20`).** The
  position-blocked interval quoted throughout this section, [+0.0509, +0.5350], resamples by
  position in the flat 300-trade array; DJTA-20's 300 trades condense to only **104 distinct
  calendar days**, an **effective/nominal ratio of 35%** (DJIA-30's own ratio, on record, is 26%).
  Block-resampling by calendar day instead of by array position — the same method
  `DATE-CLUSTERED-RESAMPLING-AUDIT` used for DJIA-30 — widens the interval to
  **[-0.0851, +0.7129], which spans zero.** This was flagged as a live possibility when this
  section was first written (see the `blockBootstrapCI`-has-no-notion-of-a-calendar-day bullet
  below, unchanged since 2026-08-22) and it has now happened: the one equities CI in this
  project's history that positively excluded zero no longer does. This is a second, independent
  reason condition 3 fails, unrelated to the BH-FDR family-growth mechanism above, and it means
  every place in this section's prose asserting the DJTA-20 interval "still excludes zero"
  (below, written before this correction) is describing the position-blocked figure only and is
  superseded by this finding. Required-N planning is unaffected — see
  `DATE-CLUSTERED-RESAMPLING-DJTA20`'s own restatement of `REQUIRED-SAMPLE-FOR-DURABLE-PASS`,
  which the p-calibrated required-N of 316 (not the CI-derived SD) already used and which this
  finding does not move.
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
- **Condition 2, measured 2026-08-28 (`MADIP-REALISED-R-CONDITION-2`).** Realised R is 2.65
  (DJIA-30) / 2.50 (DJTA-20), roughly half the configured `tpR: 5` — driven mainly by breakeven-
  lock exits pulling the winner average down, not by timeout censoring (0% on both universes).
  The win-rate margin over the *real* breakeven is positive on both universes (+3.52pp / +7.12pp)
  but a two-sided 95% Wald noise check splits: the DJIA-30 margin sits inside the observed win
  rate's own noise band, the DJTA-20 margin sits outside it. The margin could not be
  pre-registered before the fact (both holdouts were already scored), so this is a noise
  assessment, not a pass/fail against a threshold.

- **Condition 1's positive expectancy is not distinguishable from long exposure with matched
  risk geometry (`MADIP-RANDOM-ENTRY-CONTROL`, 2026-08-28).** This item asked the question
  condition 1's raw pass never answers: is `+0.1526R`/`+0.2994R` attributable to `ma_dip`'s
  entry rule (a ≥2%-below-20MA dip), or would any random long entry with the same stop-distance
  geometry, target, breakeven lock, and hold horizon do about as well in this window? A
  matched-geometry null was built per universe — K=2000 draws, each drawing 475 (DJIA-30) / 300
  (DJTA-20) random (symbol, day) entries uniformly from the same universe and same holdout
  calendar coverage as the real trades, each given a stop distance resampled from the REAL
  trades' own empirical stop-distance distribution (not a structural stop, since a random entry
  has no dip to place one under), then run through `backtest.js`'s own unmodified lockBreakeven/
  target/timeout exit path. Pre-registered decision rule: `ma_dip` is credited with adding
  information only if its real pooled avgR exceeds the null's 95th percentile. **It does not, on
  either universe.** DJIA-30's real +0.1526R lands at the **53rd percentile** of its null
  (null mean +0.1493R, SD 0.1038 — 47% of random-entry draws with matched risk geometry beat it
  outright); DJTA-20's real +0.2994R lands at the **85th percentile** (null mean +0.1637R, SD
  0.1277 — closer, but still short of the pre-registered bar, with 14.8% of draws beating it).
  The null's own mean is reported prominently, per this project's `LOG-REGRESSION-BANDS-CRYPTO`
  precedent: **random long entries with this stop/target/breakeven geometry already average
  strongly positive R in this window on both universes**, before any claim about `ma_dip`'s own
  timing is made — a beta-and-payoff-structure finding (a tight structural stop against a 5R
  target with a breakeven lock is a favourable asymmetric bet in a broadly rising market,
  independent of *when* it is entered), not evidence the ≥2%-below-20MA dip condition is doing
  identifiable work. This does not flip condition 1's literal pass (`E > 0` is still true), and
  it is a resampling control rather than a formal-NHST test (no BH-FDR family entry), but it
  materially weakens what that pass was ever entitled to claim on its own.
- **Confirmed project-wide, not just for `ma_dip` alone (`EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`,
  2026-08-29).** The same matched-geometry random-entry null, applied unchanged to all twelve
  `tournament.mjs` families (ten scorable at >=10 trades), found **zero of ten scorable families
  clear the pre-registered 95th-percentile bar** — including `ma_dip` itself, whose real DJIA-30
  result (+0.1526R) landed at the **52.1st percentile** of its own null (null mean +0.1514R, SD
  0.1045), closely replicating `MADIP-RANDOM-ENTRY-CONTROL`'s independent 53rd-percentile finding
  on a separate seed and draw order. Every one of the ten scorable families' null means was
  strongly positive (+0.0751R to +0.2348R) — a matched-geometry random long entry already earns
  real money in this window before any entry-timing rule is credited, on every family tested, not
  `ma_dip` alone. This is the direct bearing on condition 1: positive expectancy that a random
  entry with identical stop/target/breakeven geometry also achieves, on ten-for-ten families
  tested, is not evidence any of those entry rules — `ma_dip`'s included — contributes
  identifiable timing skill. The corrected 8-of-12 DJIA-30 net-positive breadth claim
  (`CROSS-FAMILY-TRADE-OVERLAP-AUDIT`) — this project's main stated reason equities looked
  different from crypto — does not survive being read against this null: seven of the eight
  net-positive families fail to clear it and the eighth (`range_sweep_reclaim`) is too thin to
  score (3 trades, below the pre-registered 10-trade floor).

**`ma_dip` no longer needs a "what's left" list — it has now failed two of the six conditions
outright (3 and 5), on top of a marginal 4, a split-by-universe 2, and a condition 1 whose
positive expectancy does not survive a matched-geometry random-entry control.** Condition 2 closed
2026-08-28 (above); condition 5 closed the same day, decisively, on the same drawdown failure
mode that killed `B5-REVERSAL`. Nothing about condition 3's lapse (a function of family growth,
not of `ma_dip`'s own numbers) or condition 5's fail (a function of the trade sequence, not of
the correction family) depends on the other — they fail independently, for different reasons,
and both now hold. The right next step is not promotion, not a third universe, and not a smaller
risk fraction chosen after seeing this result — it is treating `ma_dip` as closed: real,
positive, and uninvestable at any risk fraction this project would responsibly run, exactly the
shape §2 and `B5-REVERSAL`'s own precedent warned this project to expect.

**Project position, restated 2026-08-29 (`ALPHA-DEFINITION-POST-NULL-RESTATEMENT`, bookkeeping,
not research — D1 does not apply, per the same convention `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS`
used).** `ma_dip` is closed on conditions 3 and 5 independently of each other and of anything
above: condition 5 on a measured, decisive drawdown failure (`MADIP-SURVIVABILITY-CONDITION-5`),
and condition 3 now on two independent grounds of its own — BH-FDR family growth (2026-08-27) and,
as of `DATE-CLUSTERED-RESAMPLING-DJTA20` (2026-08-29), the confidence interval itself, which no
longer excludes zero once resampled by calendar date instead of by array position (300 trades
collapse to 104 distinct days, a 35% effective/nominal ratio). Separately, the breadth claim that
made equities look different from crypto — 8 of 12 `tournament.mjs` families net-positive on
DJIA-30 (`CROSS-FAMILY-TRADE-OVERLAP-AUDIT`) — does not survive being read against a
geometry-matched random-entry null: `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL` found zero of ten
scorable families, `ma_dip` included, clear the pre-registered 95th-percentile bar against a null
built from each family's own stop/target/breakeven geometry. Neither finding reopens or narrows
the other; both hold, independently, and both point the same direction: this project's equities
record has produced no candidate — not `ma_dip`, not the eight nominally net-positive families
around it — that clears this document's bar or that a matched-geometry null cannot explain.

**Forward-looking planning note, not a reopening of the above (`REQUIRED-SAMPLE-FOR-DURABLE-PASS`,
2026-08-28, ROADMAP.md).** Using `ma_dip`'s recorded numbers purely as a worked example of this
document's own condition 4 (what sample would a durable pass actually need), that item found no
finite, reachable family size at which BH-FDR correction alone makes this effect size
unrecoverable — required N grows only `O(√log m)` and stays under ~1,400 trades even at family
sizes orders of magnitude beyond anything this project could run. The mechanism that has actually
moved `ma_dip` off the survivor list is not family-size growth (a slow, bounded drag) but any
single future test landing more significant than its own p=0.0116 (a one-step, unbounded push in
the wrong direction, outside sample size's reach) — the same distinction condition 3's note above
already draws. This does not revive `ma_dip`, which remains closed on conditions 3 and 5
independently of anything in that item.

---

## 5. Applied retrospectively to the whole record

Asked directly: does anything this project has already run meet the bar?

> **SUPERSEDED IN PART, 2026-08-22.** This section's central claim — that conditions 1 and 3
> have never been met by the same candidate — was true when written and is **no longer true**.
> See §4b above: `EQUITIES-MADIP-OUT-OF-SAMPLE` clears 1, 3 and 6 together. The section is left
> standing rather than rewritten, because the *pattern* it names remains the correct prior for
> every other candidate in the record, and because a document that quietly edits away its own
> falsified claims is worth less than one that shows where it was wrong.

> **Annotation added 2026-08-29.** The exception above lasted five days (2026-08-22 to
> 2026-08-27) — see §4b's own note under condition 3. As of 2026-08-29, `ma_dip` has failed
> conditions 3 and 5 independently (§4b's restated position, above), so the project is back to
> the pre-2026-08-22 state this section originally described: no candidate on record clears
> conditions 1 and 3 together. This does not un-supersede the callout above — the claim that
> "conditions 1 and 3 have never been met by the same candidate" was still falsified, once, for
> five days, and that fact is preserved rather than erased — but the exception is itself now
> closed and should not be read as currently live.

**No — with one exception found on 2026-08-22, recorded in §4b (exception closed 2026-08-27 —
condition 3 lapsed; see §4b's restated position).** And the way things fail is
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
