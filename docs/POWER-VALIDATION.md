# Validating the power arithmetic the forward protocol rests on

**What this is:** a record of reproducing and testing `paper-power.mjs`, whose output is the basis for
`docs/PAPER-PROTOCOL.md`'s power table and for this project's most consequential forward claim — that no
practical paper period will prove edge.

**What this is not:** evidence about any strategy. Everything below is a measurement of the **null** —
two random books drawn from the same pool at the same instant — on historical prices. It measures how
much noise a claimed edge would have to clear. It does not test the analyst, and nothing here says an
edge exists. No prospective evidence has been collected; no paper decision has ever been made.

Done without the IBKR bundle or the model key: `paper-power.mjs` reads the committed `sp500-bundle`.

## 1. The registered table reproduces

```
node paper-power.mjs 20000
```
Seed `20260924`, 127 names, 920 dates, 134 non-overlapping 5-day periods, book of 10, measured
per-period paired sd **2.45%**.

| periods | registered per-period | reproduced | registered annualised | reproduced (×50.4) |
|---|---|---|---|---|
| 4 (20 trading days) | 3.4% | **3.43%** | ~170% | 172.7% |
| 12 (60 trading days) | 2.0% | **1.98%** | ~98% | 99.7% |
| 26 (6 months) | 1.3% | **1.34%** | ~67% | 67.7% |
| 50 (1 year) | 1.0% | **0.97%** | ~48% | 48.8% |

**Every per-period figure matches the pre-registration.** The conclusion stands unchanged: a month
resolves nothing under ~170% annualised, and a full year still only reaches ~49%.

**One convention difference, flagged not silently fixed.** The protocol annualised by ×50; the correct
factor for a 5-day hold is 252/5 = **50.4**. The gap is 0.8% of each figure (~1.4 points at the 170%
row), so the registered numbers are very slightly conservative. Both conventions are asserted in
`analyst/power.test.mjs` so the difference cannot later be mistaken for a regression.

## 2. A defect in the hold comparison, and its direction

`paper-power.mjs` built its grid of period start indices **once at a 5-day hold** and then reused it
while reassigning `HOLD` to compare other holds. Two consequences, both measured:

- **A fixed weekday phase.** A 1-day hold was estimated from every fifth session — one day-of-week
  phase, and a fifth of the available data. `nonOverlappingStarts(250, 1, 920)` gives 670 starts
  covering all five phases; the reused 5-day grid gave 134 starts all at `i % 5 === 0`.
- **An off-by-one, and a truncation.** The bound was `i + hold < length`, which dropped the last
  fully-available period — always the most recent one (133 periods where 134 exist). At a 21-day hold,
  3 of 133 starts additionally ran past the panel end and were silently clamped to a shorter window by
  the `Math.min` in `bookReturn`, understating long-hold noise.

**Direction of the correction matters, so here it is explicitly.** Understating long-hold noise made
long holds look *better* than they are, which worked **against** the protocol's "shortening the hold
does not help" conclusion. Fixing it makes that conclusion stronger:

| | before fix | after fix |
|---|---|---|
| annualised MDE across holds 1–21d | 159.8 – 177.5% | **165.7 – 180.7%** |
| spread | 17.8 points | **15.0 points** |
| within the registered "~157–181%" band? | **yes, 159.8 > 157** | **yes** |

**Correction to an earlier draft of this document:** it said the pre-fix range had its "lower bound
below" the registered band. That was wrong — 159.8% is above 157%, so **both** ranges sit inside the
registered band. The fix narrows the spread and shifts it up slightly; it does not rescue the range from
outside the band, because it was never outside. **No correction to `docs/PAPER-PROTOCOL.md` is
required**, and none was made — it is a pre-registration, and this document does not amend it.

## 3. The flat column follows from an assumption, stated

The protocol measured a roughly flat annualised column and concluded the lever is closed. The planning
formula has a matching algebraic property — but it is **conditional**, and an earlier draft of this
document overstated it as a proof that "no hold can be luckier". It is not that.

**Three conditions, any of which can fail:** it assumes `σ_h = σ₁√h` exactly; it treats `W/h` as
continuous, so a hold that does not divide the window leaves an unrealisable fractional period (and at
`h > W` the formula returns a number for a test that cannot be run); and it inherits the normal
approximation's limitations (§3a). Within those conditions:

If per-period noise scales as a random walk, `σ_h = σ₁√h`, then in a window of `W` trading days:

```
n              = W / h
MDE_per_period = z·σ₁·√h / √(W/h) = z·σ₁·h / √W
MDE_annualised = MDE_per_period · (252/h) = 252·z·σ₁ / √W
```

**The hold cancels algebraically, under the first condition.** So to the extent returns scale like a
random walk, annualised detectable edge depends on one-day noise and window length rather than on how
the window is sliced. Asserted to 1e-9 across holds 1–100 in `analyst/power.test.mjs` — that assertion
tests the algebra, not the market. Cost, by contrast, scales as `1/h` **unconditionally**: 1.3%/yr at a
21-day hold against 27.7%/yr at a 1-day hold. That half is arithmetic rather than an assumption, and it
is the firmer half of the argument. Window length helps as `1/√W`.

### 3a. These are planning estimates, not guaranteed power

`mde` and `periodsFor` use the normal approximation with a known sigma and independent periods. At 4
periods in a month this is doing real work: sigma is estimated rather than known (a t-based interval
would be wider, more so at small n), real per-period differences are fat-tailed in a direction the
normal formula does not charge for, and independence needs non-overlap *and* no common shock —
non-overlap is enforced by construction, a shared market regime across adjacent periods is not. Read
every MDE here as "roughly how long before this is worth looking at", never as "80% power achieved".

The measured residual against this identity turns out to be small. Measured `σ_h / σ₁√h` is within 6%
of 1 at every hold, and at 21 days it is 0.996 — 21-day noise of 4.93% against a predicted 4.95%. So the
panel's paired noise tracks random-walk scaling closely, which is why the annualised column is as flat as
it is.

**No directional claim is made from that residual, deliberately.** A draft of this document read the
0.4% shortfall at the long end as mean reversion. It is not: a deviation that small is indistinguishable
from Monte Carlo error at 20,000 draws, and reading it as a signal would be the noise-mining this project
closed 76 verdicts on.

## 3b. Sensitivity: which of the registered table's four choices actually matter

`node power-sensitivity.mjs 20000` (seed 20261005, `sp500-bundle`, 127 screened names, 920 dates,
134 non-overlapping 5-day periods, 2023-01-04 → 2026-09-03). Same caveats as §1: null only, historical,
today's universe, planning estimates.

The registered table fixed four things at once — book size 10, hold 5, the whole window, and a
disjoint-books control. Each was a choice. Measured:

### Book size is the dominant lever, by a wide margin

| book | σ/period | MC se | historical 95% CI (period bootstrap) | MDE@50 periods | annualised |
|---|---|---|---|---|---|
| 1 | 7.747% | 0.039% | 7.266 – 8.278% | 3.069% | 154.7% |
| 3 | 4.493% | 0.022% | 4.184 – 4.810% | 1.780% | 89.7% |
| 5 | 3.453% | 0.017% | 3.250 – 3.686% | 1.368% | 69.0% |
| **10** (registered) | **2.425%** | 0.012% | 2.289 – 2.573% | **0.961%** | **48.4%** |
| 20 | 1.703% | 0.009% | 1.620 – 1.807% | 0.675% | 34.0% |
| 40 | 1.208% | 0.006% | 1.141 – 1.287% | 0.479% | 24.1% |

σ falls **6.41x** from a 1-name to a 40-name book, against 1/√n's 6.32x. So over a year the detectable
edge ranges from ~155% annualised to ~24% depending only on how many names are held.

**This is a change in the noise floor, not a source of edge.** A larger book does not make a strategy
profitable; it makes a given edge easier to *see*. Three things keep it from being a free lunch:

- **The real book size is not this tool's to choose.** It is governed by `analyst/risk.mjs` limits and
  by what the analyst proposes. Nothing here changes either, and no size is recommended.
- **The large-book rows are confounded.** Two *disjoint* books of 40 consume 80 of 127 eligible names,
  so sampling without replacement from a nearly-exhausted pool makes the books negatively correlated
  and *inflates* the difference's variance. The large-book σ is biased upward; the measured 6.41x
  understates true diversification. An artifact of the measurement convention, not of the strategy.
- **A bigger book dilutes a real edge too.** If skill is concentrated in a few names, spreading across
  40 reduces both the noise and the signal. This measures only the denominator.

### The control-sampling rule makes the registered table ~5% conservative

| rule | σ/period |
|---|---|
| disjoint books (`paper-power.mjs`, and what the registered table used) | 2.437% |
| overlap permitted (`journal.mjs`'s actual `matchedRandomControl`) | 2.323% |

ratio **0.953**. `matchedRandomControl` shuffles the eligible pool and takes the first n names **without
reference to the analyst's picks**, so control and book may share names. Overlap correlates them and
shrinks the variance of their difference. The registered figure is therefore conservative by ~5% — the
safe direction. Neither rule is wrong; they answer different questions, and which one the forward record
should be scored against is a question for whoever registers a candidate, not for this tool.

### σ is broadly stable across chronological sub-windows

Four chronological quarters, **33 non-overlapping periods each**:

| sub-window | periods | σ/period |
|---|---|---|
| 2024-01-03 → 2024-09-03 | 33 | 2.462% |
| 2024-09-03 → 2025-05-06 | 33 | 2.285% |
| 2025-05-06 → 2026-01-05 | 33 | 2.280% |
| 2026-01-05 → 2026-09-03 | 33 | 2.687% |

Spread 1.18x against a full-panel 2.437%. So the registered MDE is **not obviously a regime artifact** at
this resolution. Each quarter holds a quarter of the evidence, so each estimate is correspondingly
noisier — and four sub-windows are four views of one history, not four independent confirmations.

### Historical uncertainty dominates Monte Carlo uncertainty by 11x

| source | magnitude | shrinks with more draws? |
|---|---|---|
| Monte Carlo (same config, 5 seeds, max−min) | 0.028% | **yes** |
| historical sample (period bootstrap 95% CI width, 134 periods) | 0.319% | **no** |

**11.4x.** Adding draws is nearly free and buys nearly nothing: the binding constraint is that the panel
contains 134 non-overlapping periods, not how many times they were resampled.

**Two corrections to how this was first described** (see §5b): 20,000 draws over 134 periods means each
period recurs ~150 times, and that does **not** make the draws dependent — conditional on the panel they
are i.i.d. from a fixed empirical distribution, which is precisely what makes the simulation standard
error valid. What repeats fail to supply is *new historical evidence*. And the period bootstrap is **not
a floor**: it resamples periods i.i.d. and so does not model regime dependence, but the direction of
that omission is undetermined. A contiguous-block bootstrap is run alongside it in `slate-null.mjs` as a
sensitivity on exactly that assumption.

## 4. What changed

| file | change |
|---|---|
| `analyst/power.mjs` | **new.** The power arithmetic as a tested module: `mde`, `periodsFor`, `annualise`, `costDragPerYear`, `nonOverlappingStarts`, `annualisedMdeUnderSqrtScaling`, `canAnswer`. All entry points reject inputs that would otherwise yield a plausible-looking wrong number. |
| `analyst/power.test.mjs` | **new.** 15 tests: the 1/√n law, `periodsFor`/`mde` inversion, the registered-table reproduction, the exact hold-invariance identity, the grid invariants, and input rejection. |
| `paper-power.test.mjs` | **new.** 7 tests on the script: determinism under a fixed seed, the corrected period count, per-hold grids, exact cost inversion, flatness of the annualised column, and that the output cannot be misread as a claim of edge. |
| `paper-power.mjs` | grid rebuilt per hold via `nonOverlappingStarts`; the two untested local arrow functions replaced by the module; annualisation uses 252/h rather than a hardcoded 50. |
| `analyst/panel-null.mjs` | **new.** The null's machinery — `buildReturnMap`, `bookReturn`, `drawPair` (with the disjoint/overlap control choice explicit), `monteCarloSeOfSd`, `periodBootstrapSd`. Extracted so the sensitivity work does not carry a second copy of `bookReturn`. |
| `analyst/panel-null.test.mjs` | **new.** 13 tests on a synthetic panel with hand-computable returns, so index semantics are checked against arithmetic. Includes the test that licenses the extraction: it reproduces `paper-power.mjs`'s 2.45% exactly, replaying that script's rng consumption. |
| `power-sensitivity.mjs` | **new.** The sensitivity report (§3b). Deterministic, offline, guarded main. |
| `power-sensitivity.test.mjs` | **new.** 10 tests: determinism, monotone σ in book size, the overlap direction, per-sub-window period counts, periods-drawn vs periods-available, the empty-grid case, fractional-period flagging, and that the report states its limitations before any number. |

Why it was worth doing: `docs/FORWARD-EVAL-SPEC.md` §4 requires every registered candidate version to
carry **minimum periods and the MDE at that count** — "because a test whose MDE exceeds its hypothesis
cannot answer it". That field previously had to be hand-copied from a console readout produced by 149
lines of untested statistics. This is the same failure shape as `registry.mjs`, whose ledger outlived its
code.

**Known gap, stated plainly:** `analyst/ledger.mjs` does **not** import `power.mjs`. A registered
`mdeAtMinimum` can still disagree with what the arithmetic gives. What changed is that there is now one
tested implementation to compute it with. Wiring the ledger to cross-check the field is **proposed, not
done** — it changes what the ledger accepts, which is a protocol-adjacent decision.

## 5. What was ruled out

- **Shortening the hold to buy power, as a *planning* lever.** Under random-walk scaling the hold
  cancels algebraically (§3), and measurement across 1–21 days shows a 15-point spread with no hold
  clearly better. That is not a proof that no hold could ever be luckier on real data — it is an
  assumption plus a measurement, both stated. Already an archive verdict
  (`HOLDING-PERIOD-COST-AMORTIZATION-MAP`); this adds the derivation and its conditions.
- **Rescuing a month by running it twice.** MDE falls as `1/√n`: four periods to eight improves the
  detectable edge by 29%, not 50%.
- **Re-deriving the registered table as suspect.** It reproduces. The pre-registration is sound and no
  amendment is needed.

## 5b. The slate-conditioned null, and the convention that was never open

`node slate-null.mjs 20000` (seed 20261006, hold 5, 133 non-overlapping periods from the momentum
warm-up at index 252). Same standing caveats: null only, historical, survivors, planning estimates.

### The runtime already fixes the control convention — there was no owner decision

§6 item 2 previously asked Tyler to choose a control-sampling convention. **That was a manufactured
blocker, and it is withdrawn.** Reading the chain settles it:

| file | behaviour |
|---|---|
| `context.mjs` | `candidates = [...held, ...top(half), ...bottom(half)]` by `rankBy`, `half = max(1, floor(slate/2))`; held names always shown |
| `loop.mjs:260` | `pool = context.candidates.map(c => c.symbol)` — **the point-in-time slate, not the universe** |
| `journal.mjs` | `matchedRandomControl(allowed, pool, seed)` shuffles `pool`, takes the first `sized.length` names **without reference to `allowed`** — so overlap is permitted, sampling is without replacement, and it truncates rather than duplicating when `pool < book` |

So the convention is: **pool = the slate, overlap permitted.** The diagnostic was the thing out of step,
and the fix is to match the measurement to the runtime — not to ask which convention to adopt. No
runtime behaviour, ledger behaviour, size, hold or gate is changed by any of this.

### Point-in-time, and precisely where it stops

The slate is built by calling the **real `buildContext`** at the decision bar, so "the one truncation"
applies and no ranking or eligibility test can see a future bar. A test appends a 1.5×-per-day run-up to
the worst-ranked name and confirms the earlier slate is unchanged.

Index mapping is asserted, not assumed: all 127 symbols share one start bar and one length, so
`returnDates[k] === barDates[k+1]` for all 920, and a window starting at return index `i` is entered at
the close of `barDates[i]` → `asOf = i`. `loadGrids` throws if a future panel breaks that.

- **Faithful:** slate membership for a flat book.
- **Approximation, labelled in the output:** `positions = {}`. A live run carries a book and held names
  are *always* on the slate, so the reconstructed pool is narrower than a live one. Asserted in a test.
- **Impossible from these files:** point-in-time *eligibility*. Every symbol shares one start bar, so no
  delisting, acquisition or index change is represented — names that left the universe were never
  collected. Ranking is point-in-time; **membership is survivors**.

### At the deployed setting, slate-conditioning changes nothing — by coincidence of sizing

| pool | mean size | σ/period | sim se | MDE@50p | annualised |
|---|---|---|---|---|---|
| full universe | 127.0 | 2.341% | 0.012% | 0.928% | 46.8% |
| slate=10 | 10.0 | **DEGENERATE** | — | — | — |
| slate=20 | 20.0 | 2.671% | 0.013% | 1.058% | 53.3% |
| slate=40 | 40.0 | **2.816%** | 0.014% | 1.116% | 56.2% |
| slate=80 | 80.0 | 2.548% | 0.013% | 1.009% | 50.9% |
| slate=300 (deployed) | 127.0 | 2.348% | 0.012% | 0.930% | 46.9% |

`slate=300` against 127 names **is** the whole cross-section — `context.mjs` says so itself — so the
registered σ was measured against the right pool **by coincidence of sizing, not by design**.
Ratio 1.0029 against the full universe confirms it.

**The direction matters and it is the uncomfortable one.** A narrow slate is a *ranked* slate holding the
momentum extremes, not a random subset. Two effects compete — a smaller pool means more overlap between
the books, shrinking the difference's variance, while ranked extremes are more volatile names, inflating
it. **Measured, the second wins:** σ peaks at `slate=40` at 1.203× the full-universe figure. So a
deployed slate narrower than the universe would make the registered MDE **optimistic by ~20%**, the
opposite direction from the control-overlap mismatch (which was conservative by ~5%). It does not bite
today, and it would bite at the ~1,000-name universe `slate=300` was chosen for.

### A degeneracy in the runtime's control, worth knowing before any forward configuration

At `slate=10` against a book of 10 the control draw takes the **entire pool**, so control and book are
the same names and the paired difference is **exactly zero on 100% of draws**. `matchedRandomControl`
samples without replacement and truncates rather than duplicating, so it cannot manufacture a distinct
control from a pool that size. The comparison does not get noisy — **it ceases to exist**.

A first version of the tool's own guard tested `pool < book`, which is false at `pool == book`, and so
reported σ = 0.000% as though it were a measurement of perfect precision. Now detected and printed as
`DEGENERATE`. **Reported as a measurement limit, not as a recommended slate or book size** — both are
owner settings and neither is touched.

### Coverage

Mean sessions held is exactly **5.000** at every pool, with **0.00%** of windows short of the hold and
0.00% of draws unable to supply a distinct control (outside the degenerate row). So no name in this
panel has a missing bar inside any measured window, and the "skipped, not forward-filled" hazard —
real in the code — does not fire here.

### Simulation error vs sampling error, stated correctly this time

| source | magnitude | shrinks with draws? |
|---|---|---|
| conditional simulation (5 seeds, max−min) | 0.042% | **yes**, as 1/√draws |
| analytic simulation se at 20,000 draws | 0.012% | yes |
| sampling, i.i.d. period bootstrap (133 periods) | width 0.288% | no |
| sampling, block bootstrap L=5 | width 0.333% | no |
| sampling, block bootstrap L=13 | width 0.298% | no |

Draws are **i.i.d. from a fixed empirical distribution**, so a repeated date does not make them
dependent — that is exactly what licenses the simulation se. What repeats fail to supply is new
historical evidence. And the i.i.d. bootstrap is **not a floor**: the block versions come out modestly
wider at L=5 and comparable at L=13, which brackets the sensitivity to the exchangeability assumption
rather than establishing a direction for it.

### Random-versus-random is a planning proxy

Everything above differences *two random books*. The forward quantity is a **fixed** analyst book (fixed
in the sense that the rule is deterministic given the information set) against one random control.
`Var(R_a − R_c) = Var(R_a) + Var(R_c) − 2Cov`, and random-versus-random sets `Var(R_a) = Var(R_c)` by
construction. A real book concentrated in high-beta or sector-clustered names has a different variance
and a different covariance with the pool. If it is more volatile than a random draw, every MDE here is
**optimistic**; if more diversified, conservative. The realised dispersion can only be measured from a
forward journal, of which there is none.

## 5a. Corrections to this document's own earlier draft

Four overclaims, found on review and fixed rather than left standing:

1. **"The hold cancels exactly … no hold can be luckier."** It is an algebraic property of the planning
   formula under `σ_h = σ₁√h`, treating `W/h` as continuous. It does not prove any empirical hold is
   powerless. Now stated with its three conditions (§3), and the test that asserts it is renamed to say
   it tests the algebra rather than the market.
2. **"Pre-fix range had its lower bound below the registered band."** False — 159.8% > 157%, so *both*
   ranges were inside it. The fix narrows the spread; it never rescued the range from outside.
3. **A `168–185%` range in a `paper-power.mjs` comment** came from a throwaway probe with different rng
   consumption and was never the script's output. The script's figures are 165.7–180.7%.
4. **"Every entry point rejects invalid inputs."** It did not. `annualise`'s `perPeriod`,
   `costDragPerYear`'s `perLegCost`, both functions' `tradingDays`, and custom `zAlpha`/`zPower` were
   unvalidated — so a `tradingDays` of 0 silently returned 0 for every annualised figure, and a p-value
   passed where a z-score belongs understated the MDE ~50x. All now validated and tested.

Also verified rather than assumed: `bookReturn` compounds the returns at indices `i..i+hold-1` — the
price change from `dates[i-1]`'s close — so a full window needs `i+hold <= length`. That confirms the
grid endpoint is right, and the old `i + hold < length` was one period short.

## 6. Next work, ranked by expected information gain

1. ~~Measure σ against the slate the analyst is actually shown.~~ **DONE — §5b.** It coincides with the
   full universe at the deployed `slate=300`, and would make the registered MDE optimistic by ~20% at a
   narrower slate.
2. ~~Decide the control-sampling convention for the forward record.~~ **WITHDRAWN — there was no
   decision to make.** §5b: the runtime already fixes it. `loop.mjs` passes the point-in-time slate as
   the pool and `matchedRandomControl` permits overlap, so the diagnostic was the thing out of step.
   Listing this as an owner decision was a manufactured blocker.
2b. **Measure σ with a held book carried across periods.** The one labelled approximation left in §5b:
   `positions = {}`, so held names — which are *always* on the slate — are absent, and the reconstructed
   pool is narrower than a live one. A simple deterministic holding rule (hold the previous period's
   random book) would close it without a model call, and would also exercise the overlap between a
   carried book and the slate. **Now the highest-information offline item**, because it is the last
   known gap between the measured pool and the live one.

3. **Regime-conditioned σ.** Sub-windows are stable at 1.18x, but quarters are a crude split. Measuring
   σ conditioned on realised market volatility would show whether the MDE should be regime-dependent —
   relevant because a drawdown window is pre-registered. Offline.
4. **A t-based / bootstrap MDE alongside the normal approximation.** §3a says these are planning
   estimates; at 4 periods the normal approximation is doing real work. Quantifying the gap would show
   how optimistic the registered table is at small n. Offline.
5. **Cost-model sensitivity of the MDE.** Last, as before: cost enters the mean, not the variance, so it
   shifts the edge being measured rather than the noise floor. `PER-FAMILY-COST-CEILING` already has the
   break-even in closed form.

## 7. What still requires Tyler

- **The panel and the key**, as before. Nothing in §3b needed them, and items 1, 3, 4 and 5 above are
  all offline too.
- **The ledger cross-check decision** (warn or refuse) — untouched, as instructed.
- **Nothing else.** No pre-registration amended, no passing criterion, STOP rule, risk limit, sizing rule
  or hold changed; no book size chosen; no strategy claim invented; no candidate registered.
