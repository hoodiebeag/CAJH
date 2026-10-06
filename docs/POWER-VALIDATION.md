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
- **Approximation, labelled in the output:** `positions = {}`. A live run carries a book, so the
  reconstructed pool is narrower than a live one — and by **more than the book size**: held names are
  excluded *before* ranking, so a carried book both adds the held names and **promotes ranked names the
  flat slate excluded**. Asserted in a test. **Measured in §5d** (`866d661`): at the deployed `slate=300`
  the pool is already the full cross-section, so the equivalence is unaffected.
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

`slate=300` against 127 names **is** the whole cross-section — `context.mjs` says so itself — so on
**`sp500-bundle`** the registered σ was measured against the right pool **by coincidence of sizing, not
by design**. Ratio 1.0029 against the full universe confirms it.

> ⚠️ **CORRECTION, 2026-10-05.** An earlier draft said slate-conditioning "changes nothing TODAY",
> which read as a statement about the deployed configuration. It is only true of the 127-name research
> bundle, so every σ in this section describes **127 survivors** and is not the live noise level.
>
> **A second correction, to the correction itself.** That draft then said a slate of 300 against 1,047
> tickers makes the registered MDE "optimistic by ~20%". **That was an unsupported transport and is
> withdrawn.** Two reasons:
>
> 1. **The 1.203× ratio was measured on a different thing.** It came from slates of 20/40/80 drawn from
>    a 127-name cross-section. A slate of 300 drawn from a ~1,000-name cross-section has a different
>    slate-to-universe ratio, a different cross-section and different constituents. A ratio measured at
>    one configuration is not a bias estimate at another.
> 2. **1,047 is a CANDIDATE count, not an eligible count.** `scripts/ibkr-panel.mjs` printed
>    `universe from universe/candidates.txt (1047 tickers)` — that is the input list. What matters is the
>    count after IBKR resolution (the probe resolved 25 of 25, which says nothing about 1,047) and then
>    after `screenUniverse`, which rejected 1 of 128 on the research bundle. Candidate ≠ resolved ≠
>    screened ≠ eligible, and only the last one is the pool.
>
> **So the live effect is UNKNOWN until measured.** What is established: `slate=300` is not
> automatically the whole universe once the universe is large, so the equivalence that holds on
> `sp500-bundle` cannot be assumed. The direction and size are open. `--root ibkr-bundle` exists to
> measure it, and §5c records why that measurement cannot run on a 1-year pull.

**The direction, on this panel.** A narrow slate is a *ranked* slate holding the momentum extremes, not
a random subset. Two effects compete — a smaller pool means more overlap between the books, shrinking
the difference's variance, while ranked extremes are more volatile names, inflating it. **On the 127-name
bundle the second wins:** σ peaks at `slate=40` at 1.203× the full-universe figure, so on *this* panel a
narrower slate raises the noise floor and would make an MDE computed from the full pool optimistic.

**That is a statement about 127 names at slates of 20–80, and nothing more.** It is not a bias estimate
for `slate=300` against a larger universe — see the correction above. Whether the live panel shows the
same direction, a smaller effect, or none is unmeasured.

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

## 5c. Live-panel readiness: three gaps found by auditing source, not by waiting

Audited against the real scripts and synthetic fixtures while a data refresh was in flight. **No
operation was performed on the owner's machine**, and `scripts/refresh.sh` is **unchanged** — the two
operational findings are reported for separate decision, not patched here.

### (1) A 1-year pull cannot be measured at all — the tool now refuses

`scripts/ibkr-panel.mjs` defaults to `--duration "1 Y"` and produced **251 bars per symbol**. 251 bars
give **250 return dates**, and `slate-null.mjs` needs `FIRST_START = 252` before `buildContext` can rank
anything (`momentum = ret(c, i, 252, 21)`). So `nonOverlappingStarts(252, 5, 250)` is **empty** — zero
periods, not few.

Left alone this fabricates: `sd([])` is `0`, and a σ of 0 reads as perfect precision rather than absent
data. Two fixes, both tested:

- The report now exits **2** with `UNAVAILABLE: INSUFFICIENT HISTORY`, printing bars, return dates,
  warm-up, periods available and the exact shortfall, and **prints no σ at all**.
- `measureWithPool` had **no empty-grid guard** (`measure()` in `power-sensitivity.mjs` did) and returned
  `sd: 0, n: 0` with no flag. It now returns `empty: true`. Found by the test for this case.

**The warm-up is not weakened.** 252 is what the ranking indicator requires; lowering it would measure a
different ranking from the one the runtime uses and report it under the same name. The fix is a longer
pull: `node scripts/ibkr-panel.mjs --symbols universe/candidates.txt --duration "2 Y"`.

### (2) Ragged panel shapes: exact supported shape, and a safe refusal

The tool maps return-grid index `k` to bar-grid index `k+1`, which holds **only when every screened
symbol shares one first bar**. A real IBKR panel need not: an IPO mid-window, late history, or a partly
resolved symbol all produce ragged starts, and the decision bar for a window would then be off by the
shortfall — silently.

| shape | behaviour | why |
|---|---|---|
| one shared first bar, equal lengths | measured | the mapping is verified |
| **ragged starts** (IPO, late history) | **refuses**, naming the distinct first bars | the mapping fails; a shifted decision date is invisible |
| ragged **ends** (starts together, stops early) | measured, and *visible* | the union grid is unaffected; `bookReturn` skips missing returns, so it surfaces as `mean sessions held` below the hold in §4 |
| ragged lengths, for the carried book | `carriedPools` **refuses** | `avgPrice` reads `kept[sym][i].close`, which is the bar at `barDates[i]` only if the series spans the grid |

**It refuses rather than dropping the inconvenient symbols.** Dropping them would change the eligible
universe — runtime eligibility, not this tool's to alter — and would quietly measure a different
cross-section from the one the analyst is shown.

### (3) OPERATIONAL, REPORTED NOT FIXED: the probe's resolved file narrows collection

`universe.mjs`'s `resolveUniverseSource` prefers `ibkr-bundle/universe-resolved.txt` **(IBKR-verified)**
over `universe/candidates.txt` whenever no explicit `--symbols` is given. A `--limit 25` probe **writes
that file with 25 tickers** (`ibkr-panel.mjs:219-225`).

And `refresh.sh` is asymmetric:

| stage | line | symbols |
|---|---|---|
| collect | `refresh.sh:52` — `node scripts/ibkr-collect.mjs` | **no `--symbols`** → resolves to the 25-name file |
| panel | `refresh.sh:59` — `node scripts/ibkr-panel.mjs --symbols "$UNIVERSE" --skip-fresh` | explicit → all candidates |

Collect runs **before** panel. So after a 25-symbol probe, a `refresh.sh` run collects **news and sectors
for 25 names**, then the panel pull rewrites the resolved file with the full verified list. The panel is
unaffected; the **collection is silently narrowed**.

**Safe handoff, no code change:** after a full panel pull completes, re-run the collect stage so it picks
up the now-complete resolved file —

```
bash scripts/refresh.sh collect
```

— or pass the universe explicitly: `node scripts/ibkr-collect.mjs --symbols universe/candidates.txt`.
Verify coverage by the symbol count in `data/ibkr-collection-report.json` and `data/sector-map.json`.
**Proposed operational fix, for separate decision:** have `refresh.sh:52` pass `--symbols "$UNIVERSE"`
to match the panel stage, or have `ibkr-panel.mjs` refuse to write `universe-resolved.txt` when
`--limit` is set. Neither is applied here; `refresh.sh` runtime code is untouched in this unit.

### (4) OPERATIONAL, REPORTED NOT FIXED: `refresh.sh commit` does not push after a rebase

Proven in an isolated fixture (`refresh-recovery.test.mjs`, 5 tests, throwaway repo with a local bare
origin — nothing touches this repository or the owner's machine).

A push rejected as non-fast-forward is handled honestly: four retries, then `PUSH FAILED after 4
attempts … committed locally and is not lost`, exit non-zero. **But the obvious recovery silently
fails.** The commit stage does:

```bash
if git diff --cached --quiet; then
  echo "nothing changed — already up to date, nothing to push."
  exit 0
fi
```

After a rebase the data commit is already in `HEAD`, so re-staging the same paths yields **no staged
diff**. The stage prints success and **exits 0 without pushing** — the "work done, never pushed" failure
`refresh.sh` was written to prevent, reached by following the recovery instruction.

**This corrects advice I gave during the refresh:** I suggested `git pull --rebase` then
`bash scripts/refresh.sh commit`. That second step does nothing. The correct recovery — **no force, no
reset, no deletion**:

```
git status --porcelain          # expect empty: the data is already committed
git rev-parse --abbrev-ref HEAD # confirm the branch
git log --oneline -3            # confirm the data-refresh commit is present
git pull --rebase origin <branch>
git push origin <branch>        # an explicit, ordinary push
```

If the rebase reports a conflict, **stop** — both sides changed the same file and the resolution is a
judgement call. The local commit remains reachable; a failed rebase discards nothing (asserted in the
fixture via reflog). Verify the result on the **remote**, not from stdout:

```
git fetch origin <branch>
git ls-tree -r --name-only FETCH_HEAD -- ibkr-bundle | wc -l
```

**The fetch is not optional.** `origin/<branch>` is a remote-TRACKING ref: it reports whatever was last
fetched, so reading it without fetching can confirm an upload that never happened. Use `FETCH_HEAD` from
a fetch in the same breath, and treat stdout from the push as a claim rather than as verification.

## 5d. The held-book slate approximation, measured — and the deployed equivalence survives it

Landed in `866d661` (`slate-null.mjs`, `slate-null.test.mjs`). **This section was missing: that commit
changed no documentation, so the result lived only in its commit message while §6 pointed at a "§5d"
that did not exist.** Recorded here from the commit's own figures.

§5b called `slateFor` with `positions: {}` at every period, so the reconstructed pool omitted held names
— but `buildContext` returns `[...held, ...top, ...bottom]`, making a live pool wider. The carry rule is
**deterministic and synthetic**: at period *p* the "held" names are the random book drawn at *p-1*, from
a stream seeded independently of the measurement draws; period 0 is flat. **Nothing selects or optimises
them.** Not an analyst book, not an account, not a strategy — carrying random books is still
random-versus-random with a book persisting one period, and measures only how pool composition responds
to holding something.

3,000 draws, seed 20261006, hold 5, 133 periods:

| slate | flat pool | carried pool | flat σ | carried σ | ratio | same set? |
|---|---|---|---|---|---|---|
| 20 | 20.0 | 29.9 | 2.598% | 2.832% | 1.090 | no |
| 40 | 40.0 | 49.9 | 2.822% | 2.761% | 0.978 | no |
| 300 | 127.0 | 127.0 | 2.345% | 2.345% | **1.000** | yes |

**The deployed `slate=300` / full-pool equivalence survives a carried book, structurally rather than
luckily:** at 300 the ranked slice already returns the whole 127-name cross-section, and held names are
drawn *from* that pool, so there is nothing to add. Holding changes the pool only where the ranking was
excluding something, i.e. slate < universe. At smaller slates the pool widens by up to the book size and
the effect is modest and **not monotone** (+9% at 20, −2% at 40), so no direction is claimed.

Two things the audit caught before any number was reported:

- **Holding changes the slate through two channels, not one.** `context.mjs` excludes held names *before*
  ranking, so holding 10 names adds those 10 **and promotes 10 that the flat ranking excluded** as the
  halves slide down the cross-section. Found by a test of mine asserting "anything beyond the flat ranked
  slate must be a carried name", which failed on a promoted name — the test's error, not the rule's.
  (This also corrects the §5b prose that described added names as held names only.)
- **Pool order was confounding the comparison.** A carried pool is a different *permutation* of the same
  set at slate=300, and `drawPair` splices by index, so identical sets drew different names and left a
  spurious 1.012 ratio; an earlier seed mismatch had produced a spurious 1.052 on the same row. Both
  pools are now sorted and flat/carried share one seed per slate, so a set-identical pool measures
  exactly 1.000. Sorting is faithful, not convenient: `matchedRandomControl` shuffles the pool before
  taking names, so order carries no meaning.

**Verification as it actually stood at that commit:** `slate-null.test.mjs` passed and the protected-logic
check passed, but the full suite was **not** re-run before it — the owner declined that step while working
through an unrelated checkout problem. The file is at 31/31 now and the full suite has been run since.

## 5e. Regime-conditioned noise: no detectable dependence, and the sample cannot see a modest one

`node regime-null.mjs 20000` (seed 20261006, `sp500-bundle`, hold 5, 133 periods, book 10, slate 300).

**EXPLORATORY PLANNING ANALYSIS.** Not registered, not a candidate, not a strategy. Random-versus-random
proxy — two random books from one pool, differenced — so **not edge evidence**. Historical, on today's
survivors.

**NOT GROUNDS TO LOOSEN A DRAWDOWN BRAKE.** A larger σ in a regime means an edge is *harder to see*
there; it says nothing about whether losses in that regime are tolerable. A risk limit is a statement
about acceptable loss, not measurement precision. No risk, sizing, STOP or passing criterion is touched.

### The state definition

Trailing realised volatility of the equal-weight basket over 21 sessions **ending at the decision bar** —
returns at indices `i-20..i` have all closed by then. Split into equal terciles.

- **Primary, `expanding`:** cut-points at period p come from periods `0..p-1` only, so no label depends on
  data after its own period. The first 20 periods are left **unlabelled** rather than guessed.
- **Sensitivity, `full-sample`:** whole-panel cut-points. **Not pre-decision** — it reads future periods
  to place the boundaries — and shown only to expose how much the choice matters.

Windows (10/21/63), the equal-tercile split and the minimum history were fixed before any output was
read. A test appends a 40%-per-day future run and confirms earlier labels are unchanged; another
truncates later periods and confirms expanding labels don't move while full-sample ones do.

### Result: flat

| state | periods | σ/period | sim se | MDE@50p | annualised | sampling 95% CI |
|---|---|---|---|---|---|---|
| **ALL (ref)** | 133 | 2.350% | 0.012% | 0.931% | 46.9% | 2.197 – 2.501% |
| low | 34 | 2.341% | 0.012% | 0.927% | 46.7% | 2.126 – 2.609% |
| mid | 37 | **2.436%** | 0.012% | 0.965% | 48.7% | 2.138 – 2.821% |
| high | 42 | 2.353% | 0.012% | 0.932% | 47.0% | 2.151 – 2.556% |

Ratios to the reference: 0.996 / 1.037 / 1.001. **Spread across states 1.041×.** Across all six
window × mode combinations the spread runs 1.010–1.114×, with no ordering that survives the window
choice — and `mid`, not `high`, carries the largest σ at the primary window, which is the signature of
noise rather than structure.

### The limit that decides what "flat" means

| | magnitude |
|---|---|
| typical per-state sampling CI width | **0.524%** |
| as a share of pooled σ | **22.3%** |
| between-state differences observed | ~0.003–0.086% |

The uncertainty is roughly **six to a hundred times** the observed differences. So this is **"no
detectable dependence at this sample size"**, not "no dependence". Each state holds about a third of 133 periods, and closing that gap
needs **more history, not more draws** — simulation error is already 0.012% and shrinks with draws, while
the sampling CI does not.

**Planning consequence:** on this panel there is no measured basis for a regime-dependent MDE, so a
pooled σ is the honest default. That is a statement about what is measurable here, not a finding that
volatility regimes are irrelevant.

### Two defects, one of which invalidated the first published numbers

**A ONE-BAR LOOK-AHEAD IN THE CLASSIFIER — found by independent review of `abfe7fd`, after publication.**
`buildReturnMap` keys each return to the later of its two bars and strips every symbol's first bar, so
`returnDates[k] === barDates[k+1]`. A window starting at return index `i` is entered at the close of
`barDates[i]`, which makes the return at index `i` the move **into `barDates[i+1]`** — a bar that has not
closed when the decision is made. The latest permissible index is `i-1`. `trailingVol` read through `i`.

Demonstrated, not argued: perturbing **only** `barDates[i+1]`, with every bar at or before `i`
byte-identical, moved the measured volatility at `i` from **0.118% to 1.510%**.

**Both of my tests failed to catch it, in different ways.** One recomputed the basket over the same
`i`-inclusive indices the implementation used, so it certified whatever boundary the code had. The other
appended bars *far* in the future, which cannot detect a leak exactly one bar wide. Replaced with: an
assertion that **every return timestamp consumed is ≤ the decision timestamp**, and a regression that
perturbs precisely bar `i+1` while asserting all bars ≤ `i` are identical.

**Every number in this section was recomputed.** The conclusion survives — the spread is still far below
the resolution — but the figures all moved and state membership shifted (low 38→34, mid 35→37,
high 40→42; spread 1.009×→1.041×). The earlier figures should not be quoted.

**An incomplete window was accepted.** `trailingVol` returned a value on `basket.length >= 2`, so a
window with uncovered dates was measured short and reported as a full-window figure. It now returns null
unless every date in the window contributed.

### A seed collision, caught before the first publication

The per-state Monte Carlo seed was derived as `state.length * 13`, and `"low"` and `"mid"` are both three
characters — so **two states shared a stream** and their σ were correlated by construction, in a tool
whose purpose is detecting correlation between states. Replaced with explicit distinct offsets, asserted
in a test. Deriving a seed from an incidental property of a label is how that happens quietly.

## 5f. Small-n planning sensitivity: read as a test, the registered table's n=4 row is ~48% power

`analyst/power-t.mjs`, `power-small-n.mjs`, `analyst/power-t.test.mjs` (19 tests). Offline, no model
call, no panel. **Nothing here amends the protocol or proposes a gate change.** §3a already said the
registered figures are planning estimates; this measures by how much, and names which inferential
problem each number answers.

### First, what the protocol actually runs — because it is not a t-test

**`docs/PAPER-PROTOCOL.md` registers no NHST decision rule on the paired difference at all.** Its ten
pre-registered pass criteria are **operational** (sessions journalled, zero point-in-time skips, panel
freshness, parse rate, gate rejections, settlement idempotence, news reach, thesis reviewability), and
its Tier 2 says in terms that the month *cannot* establish edge. The registered table is labelled
"**smallest edge it can resolve**" and is computed by `paper-power.mjs` from a simulated null, i.e. with
σ **taken as known**.

So this section is **conditional**, and the condition must be stated: *if* that resolution figure were
read as the effect a one-sample test on the forward periods could detect — the natural reading of
"smallest edge it can resolve", and the reading that any eventual formal comparison would need — then
with σ **estimated from those same n periods** it attains only ~48% power at n=4. It is a statement
about **how to read the table**, not a measurement of a test the protocol currently performs.

One consequence is worth stating because it makes the finding robust: the **attained power and the
ratios below are scale-invariant in σ**. They therefore apply to the registered table whichever σ it was
built from; only the absolute MDEs in percent move with σ.

**The commit title of `2f09691` ("the registered table's n=4 row is a ~48% power test") overstates this
by dropping the conditional.** Commit titles are immutable; the correction lives here.

### Four different questions, which must not be pooled

| label | the question it answers |
|---|---|
| **normal** | one-sample **z**-test, σ **known**. What `analyst/power.mjs` computes and what `PAPER-PROTOCOL.md` registered. |
| **t-heuristic** | critical *t* substituted for critical *z*. This corrects the **level** for an estimated σ. It is **not** a power calculation: under the alternative the statistic is noncentral *t*, and leaving the power term normal does not fix that. Labelled a heuristic in the code for this reason. |
| **t-exact** | the effect at which a one-sample *t*-test attains 80% power with σ **estimated from the same n observations**. Obtained by simulating the test and bisecting on the effect, so it carries a Monte Carlo error, reported alongside. **"Exact" means exact for the *t*-test's own sampling problem under i.i.d. normal periods** — it removes the known-σ approximation and nothing else. Real per-period differences are fat-tailed and adjacent periods share a market regime (§3a), so this is still a **planning estimate**, not attained power on the forward record. |
| **bootstrap** | **conditional historical sensitivity** — how the figure moves if the per-period distribution is taken to be one observed sample's empirical distribution. Not fresh evidence, and **not a coverage guarantee**. |

### The gap, at the period counts already in the registered table

σ = 2.350% per period (measured, `sp500-bundle`, book 10, hold 5 — §5e), α = 0.05, target power 0.80,
20,000 draws per evaluation, fixed seeds:

| n | normal MDE | t-heuristic | ratio | **t-exact** | **ratio** | power the **normal** MDE actually attains |
|---|---|---|---|---|---|---|
| 4 | 3.292% | 4.728% | 1.436× | **4.997%** | **1.518×** | **0.483 ± 0.002** |
| 12 | 1.901% | 2.064% | 1.086× | 2.090% | 1.100× | 0.721 ± 0.002 |
| 26 | 1.291% | 1.337% | 1.036× | 1.344% | 1.041× | 0.765 ± 0.002 |
| 50 | 0.931% | 0.948% | 1.018× | 0.951% | 1.021× | 0.782 ± 0.002 |

**Read the n=4 row plainly.** Four non-overlapping 5-day periods is one trading month, and read as a
test, the registered normal figure there attains **~48% power, not 80%**, once σ is estimated. The
direction is not a surprise — estimating σ from four observations costs power — but the size is: a factor
of **1.52 on the detectable effect**, larger than most of the effects this project has argued about. The
correction decays fast: 1.10× at 12 periods, 1.04× at 26, 1.02× at 50. **At n ≥ 26 the normal
approximation is a rounding detail; at n = 4 it is not.**

The t-exact figure annualises to 251.8% at n=4. That number is absurd on its face, and that is the useful
part: it is the same annualisation the registered table performs, applied to an honest small-sample MDE.

### The heuristic understates the exact correction — which is why it is labelled one

At n=4 the critical-*t* substitution gives 1.436× where the exact answer is 1.518×. A test in
`power-t.test.mjs` asserts both that ordering and that the heuristic's own attained power is materially
below 0.80, so the label cannot quietly become a claim.

### Uncertainty in σ is a separate axis, and at n=50 it is the larger one

Sections above hold σ fixed at the measured value and vary the method. But σ is itself an estimate. The
relevant uncertainty here is the **pooled** σ's, and §3b measured that directly: a period-bootstrap 95%
CI **0.319% wide** on a σ of 2.437%, i.e. roughly **±6%**. (§5e's 22.3% figure is a *per-state*
resolution over ~37 periods and does **not** apply to the pooled estimate — grounding the band on it
would be the wrong quantity.) The ±10% band below is therefore **illustrative and deliberately wider
than measured**. The MDE is **linear in σ**, so it gives a 22.2% span **at every n** — which is algebra
(1.1/0.9), not a measurement; the table exists to show the band does not interact with n:

| n | MDE at 0.9σ | at σ | at 1.1σ | span |
|---|---|---|---|---|
| 4 | 4.497% | 4.997% | 5.497% | 22.2% |
| 12 | 1.881% | 2.090% | 2.299% | 22.2% |
| 26 | 1.210% | 1.344% | 1.479% | 22.2% |
| 50 | 0.856% | 0.951% | 1.046% | 22.2% |

Even on the **measured** ±6% band the span is 12.8%, still **six times** the entire normal-vs-t
correction at n=50 (1.021×). These are two different uncertainties — one about the inference, one about
the input — and the smaller one is the one the method debate is about. At n=4 the ordering reverses: the
1.52× method correction dominates any plausible band on σ.

### The bootstrap is weakest exactly where the small-sample question is most pressing

| n | distinct resamples, at most | bootstrap MDE | t-exact MDE | ratio |
|---|---|---|---|---|
| 4 | **256** | 5.905% | 4.997% | 1.182 |
| 12 | 8.9×10¹² | 2.659% | 2.090% | 1.272 |
| 26 | 6.2×10³⁶ | 1.191% | 1.344% | 0.886 |
| 50 | 8.9×10⁸⁴ | 0.812% | 0.951% | 0.854 |

At n=4 there are at most **4⁴ = 256 distinct resamples of four numbers**, so the bootstrap figure is a
statement about those four numbers and not about the world. The ratios straddle 1 — each row's sample is
itself a draw, and a sample that happened to be tight gives a smaller figure, not a better one. The
ratio column reads as *how much this particular sample disagrees*, never as a correction factor.
`mdeBootstrapConditional` returns `conditional: true` and `distinctResamplesBound` so a caller cannot
quote the number without the bound, and a test asserts both.

### Numerical verification, so the figures are checkable rather than self-consistent

A statistical routine that agrees only with itself has not been tested.

**A boundary first, stated rather than papered over.** This session's egress policy **blocks
`itl.nist.gov` and `en.wikipedia.org`**, so no published critical-value table could be *fetched* to cite.
The twelve tabulated df the test checks (1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 100, 120, all agreeing to
< 5×10⁻⁴) are therefore asserted **as known**, which is weaker than a citation. Everything below was
added so that **nothing load-bearing rests on them**:

- **Two exact closed forms, derived not looked up.** df=1 is standard Cauchy, so the 0.975 point is
  `tan(0.475π)`; df=2 has `F(t) = (1 + t/√(2+t²))/2`, inverting to `c√(2/(1-c²))` with `c = 2p-1`. The
  module matches both to 10⁻⁷ — and those closed forms agree with the printed table, which is as much
  corroboration of the remembered values as this session can obtain.
- **The whole *t* CDF against independent quadrature of its own density.** Under `x = tan u` the density
  integrates over a finite range, and dividing by its own total mass **cancels the gamma constants**, so
  the check needs no incomplete beta, no Lanczos gamma and no table. Agreement to 10⁻⁶ at ν ∈
  {1, 2, 4, 11, 25, 49} across five *t* values each.
- **AN ANCHOR AT δ > 0, which the δ=0 identity cannot provide.** Power at a zero effect checks the test's
  **size**, not its power: a mis-scaled alternative — σ for σ/√n, or one-sided for two-sided — would pass
  every δ=0 check ever written. So exact two-sided noncentral power is computed by deterministic
  quadrature, `E_U[Φ(λ - t_c U) + Φ(-λ - t_c U)]` with `λ = δ√n/σ` and `U = S/σ`, again normalised by its
  own mass. It reproduces the headline column without simulation:

  | n | normal MDE | t-exact, **simulated** | t-exact, **quadrature** | attained power, sim. | attained power, **quad.** |
  |---|---|---|---|---|---|
  | 4 | 3.292% | 4.997% | **5.002%** | 0.483 | **0.4829** |
  | 12 | 1.901% | 2.090% | **2.088%** | 0.721 | **0.7229** |
  | 26 | 1.291% | 1.344% | **1.344%** | 0.765 | **0.7681** |
  | 50 | 0.931% | 0.951% | **0.950%** | 0.782 | **0.7842** |

  The test also asserts the quadrature is **sensitive to the √n scaling** (mis-scaling δ by 1/√12 must
  move the answer by > 0.3), so the agreement is not two routines sharing one mistake.
- **Power at δ=0 equals α.** Still worth having as the size check. The figures 0.0504 / 0.0515 / 0.0498
  at n = 4 / 12 / 50 (±0.0011) come from `analyst/power-t.test.mjs`, which evaluates all three and also
  checks α = 0.10; `power-small-n.mjs` prints only the n=4 case.
- **Closed forms of the incomplete beta.** `I_x(1,1) = x`, `I_x(1,2) = 1-(1-x)²`, `I_x(2,1) = x²` — three
  different functional forms, all to 10⁻¹², which exercises the continued fraction rather than restating it.

Plus the structural checks: *t* → *z* as df → ∞, monotonicity in df, the quantile inverting both CDFs,
`mdeTExact` attaining both 0.80 and 0.90 within Monte Carlo error, its MDE matching a quadrature-bisected
MDE to within 2% at n = 4/12/50, and determinism under a fixed seed. Every entry point rejects
non-finite, non-positive and non-integer inputs. **19 tests.**

### What this does not establish

Nothing about edge. Every σ here is the **null's** dispersion measured on historical survivors, and this
section is arithmetic over it. No candidate is registered, no gate is proposed, no passing criterion or
STOP rule is touched, and `analyst/power.mjs` is unchanged — the registered table still reproduces
exactly as §1 says it does. The finding is about **how to read** that table's small-n rows, not about
replacing it.

## 5g. Cost sensitivity of the measurement: the paired edge is invariant, and three things are not

`cost-cancellation.mjs`, `cost-cancellation.test.mjs` (8 tests). Offline, no model call, no panel
upload. **`costs.mjs` is unchanged and no runtime behaviour is touched.** This is not a strategy run and
not a break-even: `PER-FAMILY-COST-CEILING` answers break-even in closed form and
`COST-SENSITIVITY-SURFACE` already mapped a fee × slippage grid for the crypto baseline families. Both
are closed and neither is reopened. **No formal test is added, so no BH-FDR threshold moves** — the
precedent for that bucket is `EQUITIES-COST-ASSUMPTION-SENSITIVITY`, logged with "no p-value, no
pre-registered gate, no pass/fail claim of any kind".

**Built on precedent rather than rediscovering it.** `VERDICTS-COST-CONSTANT-STALENESS-SWEEP`
(2026-08-29) already established that "a uniform `roundTripCost` shift **cancels** in a difference of two
means computed on the same population", and classified every archive figure as AFFECTED or
UNAFFECTED-BY-CANCELLATION on that basis. What is new is applying it to the **forward paired edge** and
to the null's σ/MDE, and then asking precisely where the uniformity precondition fails.

### The three structures, derived before measuring

| cost structure | paired edge (book − matched control) | absolute net |
|---|---|---|
| **equal fixed per round trip** — what `bookReturn`, `realisedOutcomes` and `scoreJournal` all implement | **cancels: enters neither the mean nor the variance** | mean shift of 2c, no variance |
| **unequal but deterministic** — e.g. one side trades every period, the other every *k*-th | mean shift of exactly **2c(1 − 1/k)**, still no variance | mean shift |
| **book-dependent per name** | mean bias **2(c̄ₐ − c̄_b)**, which is a *random variable* — so it adds **variance too** | mean shift and variance |

The third row is the answer to "does *cost enters the mean, not the variance* hold?" — **it holds only
under equal fixed costs.** Under book-dependent costs the differential is a draw, not a constant, and it
enters both moments. (§6's item 5 said cost "shifts the edge being measured rather than the noise floor".
For the paired edge that is wrong in the other direction: the edge is not shifted **at all**. Corrected
there.)

### Measured: the paired statistic is invariant to any cost assumption

σ = 2.335% paired per period (`sp500-bundle`, 127 names, 133 periods, book 10, hold 5, 19,950 draws,
seed 20261006). Baseline cost is the repository's own verified `usEquityIbkr`: **5.5bp per leg, 11bp
round trip**. Everything else is labelled hypothetical:

| per-leg cost | label | σ paired | max \|diff − diff@0\| | MDE @ n=50 |
|---|---|---|---|---|
| 0.00bp | diagnostic zero | 2.335% | 0 | 0.925% |
| 5.50bp | **VERIFIED baseline** | 2.335% | 2.8×10⁻¹⁷ | 0.925% |
| 11.00bp | hypothetical | 2.335% | 2.8×10⁻¹⁷ | 0.925% |
| 35.00bp | hypothetical | 2.335% | 2.8×10⁻¹⁷ | 0.925% |
| 85.00bp | hypothetical | 2.335% | 2.8×10⁻¹⁷ | 0.925% |

`bookReturn` returns `mean(gross) − 2c`, so `drawPair`'s diff is `(a − 2c) − (b − 2c) = a − b`. **No cost
assumption, however large, moves the selection MDE.** The deviation column is floating-point noise:
`(a−2c)−(b−2c)` is **not** bit-equal to `a−b` in IEEE arithmetic, so the claim is "invariant to ~10⁻¹⁶",
never "bit-identical" — and the test asserts 10⁻¹², with a second draw proving the invariance is not
vacuous.

### Two claims, two σ — the registered MDE answers only one of them

| | σ per period | MDE @4 | @12 | @26 | @50 |
|---|---|---|---|---|---|
| **paired** (book − matched control, same slate, same instant) | 2.335% | 3.271% | 1.889% | 1.283% | 0.925% |
| **absolute** (one random book, no control) | 2.848% | 3.989% | 2.303% | 1.565% | 1.128% |

**1.22× wider with no control**, because the control removes the common market move. So the registered
table is the **selection** claim's resolution and nothing else, and **a positive absolute gross return is
mostly market exposure, not stock-selection skill.** Reading an absolute figure against the registered
MDE would understate the required effect by 22%.

### What cost does move

- **Absolute net levels**, by exactly 2c: at the baseline, −0.110% per period on a gross mean of +0.327%.
- **`scoreJournal`'s `hitRate`**, which counts `netReturn > 0` and is therefore **cost-dependent**: 55.3%
  of periods positive at zero cost, 53.3% at the baseline, 27.8% at a hypothetical 85bp. `beatControlRate`
  and `edgeCI` are not cost-dependent, because both sides carry the same charge.
- **Annualised drag**: 5.544%/yr at hold 5, 27.720%/yr at hold 1.

### A discrepancy in the protocol's own cost figures, reported and not edited

`PAPER-PROTOCOL.md` reads "cost drag rises from **1.3%/yr to 27.7%/yr**" in a sentence comparing the
deployed hold 5 against hold 1. `costDragPerYear` is linear in 1/hold, so that ratio must be **exactly
5**, not 21.3. The computed figures at the baseline are **5.544%/yr at hold 5** and 27.720%/yr at hold 1;
**1.32%/yr is the hold-21 row.** So the sentence pairs the hold-1 figure with the hold-**21** figure, and
understates the deployed hold's drag by ~4.2× — in the flattering direction. The protocol is
pre-registered and is **not edited**; a test asserts the ratio so the arithmetic cannot drift.

Separately, that passage sets **absolute cost drag** beside the **paired** MDE. Those are different
claims — the drag is an absolute-performance quantity and the MDE is a selection-resolution quantity —
and the "lever is closed" conclusion is about the first while the table beside it is the second.

### Where cancellation fails: cost that depends on the book

A per-share schedule with a per-order minimum gives a per-leg rate of
`max(minPerOrder/notional, perShare/price)` — **a function of position size and of the name's price**, so
a constant `feeRate` cannot represent it. At the **configured** NAV of $100,000 (`analyst-run.mjs`'s
`--nav` default) with 10 names at 10% each, notional is $10,000 per name.

**The repository disagrees with itself about the schedule, and both readings are run as hypotheticals.**
`costs.mjs`'s comment cites "$0.0035/share with a $0.35 minimum" (IBKR tiered); the archive row
`EQUITIES-COST-ASSUMPTION-SENSITIVITY` instead cites "IBKR's **$1.00/order** commission floor binds below
200 shares" (IBKR fixed). Different plans, different floors; this session's egress policy blocks
verifying either against the broker, and which plan the owner holds is an owner fact. Neither is
presented as the live schedule.

| schedule (both hypothetical) | rate: min / median / max | per-share charge exceeds the modelled 0.5bp below | names below that price | 2(c̄ₐ−c̄_b): sd / max |
|---|---|---|---|---|
| `$0.0035`/share, `$0.35` floor | 0.35 / 0.35 / 16.13 bp | $70/share | **43 of 127** | 1.82bp / 11.79bp |
| `$0.005`/share, `$1.00` floor | 1.00 / 1.00 / 23.04 bp | $100/share | **54 of 127** | 2.53bp / 16.52bp |

**The magnitude was predictable, and is reported as arithmetic rather than as a finding.** A dispersion
measured in basis points enters the variance as bp² against a σ measured in percent:
`var(Δc)/var(gross)` is 6.1×10⁻³% and 1.2×10⁻²% for the two schedules — orders of magnitude *below* the
Monte Carlo error on σ itself. (Which is why the measured change in σ is reported as a **decomposition**
and not as a signed "inflation": an earlier draft printed "inflation −0.011%", which reads as a cost
*reducing* variance when it is the covariance term and noise.)

**The channel that is not negligible in principle is a mean bias correlated with selection** — an analyst
that systematically picks cheaper or dearer names than its control. **The journal's paired edge assigns
that bias exactly zero by construction**, because it charges one constant to both sides. That is the
identified gap, and it is **not measurable offline**: it needs the analyst's own realised book.

Scale, against the paired MDE — **not a break-even for anything**, but the resolution of the instrument:

| systematic differential (per leg) | per period | % of MDE @4 | @12 | @26 | @50 |
|---|---|---|---|---|---|
| 0.50bp | 0.010% | 0.3% | 0.5% | 0.8% | 1.1% |
| 5.00bp | 0.100% | 3.1% | 5.3% | 7.8% | 10.8% |
| 10.00bp | 0.200% | 6.1% | 10.6% | 15.6% | 21.6% |
| 25.00bp | 0.500% | 15.3% | 26.5% | 39.0% | **54.0%** |

At the plausible end — the basis point or two these schedules actually disperse by — this is ~1% of the
MDE at every n. A 25bp **systematic** differential would reach a majority of the n=50 MDE, so it is not
dismissable in principle, only implausible at these notionals. **The binding constraint on this
measurement remains the period count, not the cost model.**

### Turnover: the runtime does not measure it at all

`decide.mjs` sets `targetPct = 0` for a `hold` action, and every consumer (`journal.mjs:119`,
`loop.mjs:344`, `matchedRandomControl`) filters those out. So a **carried name produces no outcome row,
is charged no cost, and gets no control**. Low turnover therefore shows up as a **smaller n**, not as a
cost saving: the measurement is conservative about the analyst's realised cost and pays for it in sample
size. Reported, not changed.

Two further runtime semantics, verified in source and left alone:

- **`scoreJournal.edge` is a difference of independently filtered means** (`journal.mjs:367-368`), while
  `edgeCI` is strictly paired (`:421`). A null control row drops that name from the paired statistic but
  not from `agentMeanNet`. Cost still cancels in the difference of means — a constant subtracts from
  every element either way — but the two statistics are computed on different row sets.
- **Incomplete holds are charged a full round trip only in a dry run.** `realisedOutcomes` defaults to
  `requireComplete: true` and `settle` uses the default, so a decision still inside its holding period is
  dropped rather than recorded as a flat trade.

### An arithmetic error in `costs.mjs`'s comment, reported and not fixed

The comment reads "$0.0035/share with a $0.35 minimum. On a $100 stock that is **3.5bp per leg at one
share**". One share of a $100 stock is $100 of notional, pays the $0.35 minimum, and that is **35bp** —
ten times the stated figure. The `feeRate` *value* (0.00005) is a separate, defensible choice for
$10,000 notional above the floor; only the comment's worked example is wrong. `costs.mjs` is not this
unit's to edit, so the correct arithmetic is asserted in `cost-cancellation.test.mjs` instead.

### What remains unmeasured

- **The analyst's own cost profile.** Whether its book skews cheap or dear relative to the control is the
  one channel that could bias the paired edge, and it needs journalled decisions — the key and the panel.
- **Real fill costs.** Unmeasured because of the owner's decision that broker orders count as live
  orders, not because of a missing prerequisite. Slippage stays an assumption for the whole log-only run.
- **Which IBKR plan is in force.** An owner fact. It changes only the hypothetical columns above.

**No owner prerequisite blocked this unit**, and none blocks the queue items that remain offline.
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

1. **Measure §5b against the live `ibkr-bundle`, once it has enough history.** Done for `sp500-bundle`
   (127 names), where `slate=300` coincides with the full universe. The live candidate list is 1,047
   tickers, so that coincidence cannot be assumed — but the live effect is **unknown**, not estimated
   (see the correction in §5b). `--root ibkr-bundle` exists for this. **Blocked on history, not on the
   upload:** a 1-year pull is ~251 bars → ~250 return dates, below the 252-date warm-up, so the grid is
   empty and the tool refuses (§5c). It needs a longer pull, e.g. `--duration "2 Y"`.
2. ~~Decide the control-sampling convention for the forward record.~~ **WITHDRAWN — there was no
   decision to make.** §5b: the runtime already fixes it. `loop.mjs` passes the point-in-time slate as
   the pool and `matchedRandomControl` permits overlap, so the diagnostic was the thing out of step.
   Listing this as an owner decision was a manufactured blocker.
2b. ~~Measure σ with a held book carried across periods.~~ **DONE — `866d661`, now written up in
   §5d.** A deterministic synthetic carry rule; the `slate=300` / full-pool equivalence survives it, and
   the effect at smaller slates is modest and not monotone. This entry was left marked outstanding after
   the work landed, and the §5d it pointed at did not exist — that commit changed no documentation, so
   the result sat in a commit message only. Both now fixed.

3. ~~Regime-conditioned σ.~~ **DONE — §5e.** Flat: spread 1.041× across states against a per-state
   sampling CI of ~22% of σ, so a modest dependence would be invisible. Needs more history, not more
   draws. (A duplicate "3b" entry restating this as outstanding has been removed.)

4. ~~A t-based / bootstrap MDE alongside the normal approximation.~~ **DONE — §5f.** The gap is
   large only at the smallest count: **read as a test**, the registered normal MDE at n=4 attains
   **~48% power**, not 80%, once σ is estimated (t-exact MDE **1.52×** the normal one); 1.10× at 12,
   1.04× at 26, 1.02× at 50. Confirmed by deterministic noncentral quadrature as well as simulation.
   The protocol registers no σ-estimating test, so the finding is about how to read the resolution
   table — and because the ratios are scale-invariant in σ it holds whatever σ that table used. σ's own
   measured band (±6%, §3b) outweighs the method correction at n ≥ 26 and is outweighed by it at n=4.
   No gate proposed.
5. ~~Cost-model sensitivity of the MDE.~~ **DONE — §5g**, and the reasoning in this entry was wrong.
   "Cost enters the mean, not the variance, so it shifts the edge being measured" holds only under
   **equal fixed** costs, and even then the paired edge is not shifted **at all** — it cancels
   algebraically, so no cost assumption moves the selection MDE. Under **book-dependent** costs the
   differential is a random variable and enters **both** moments; measured at 6.1×10⁻³% of the variance
   on this panel, i.e. negligible in magnitude but not zero in structure. What cost does move: absolute
   net levels, `hitRate`, and annualised drag. `PER-FAMILY-COST-CEILING` still has the break-even in
   closed form and was not reopened.

## 7. What still requires Tyler

- **The panel and the key**, as before. Nothing in §3b needed them; item 1 above is offline too, and
  items 3, 4 and 5 have since been done offline (§5e, §5f, §5g). **No owner prerequisite has blocked any
  unit so far.** What the key and panel would add is the analyst's *own* realised cost profile (§5g) —
  the one channel that could bias the paired edge — and §5b against the live bundle.
- **The ledger cross-check decision** (warn or refuse) — untouched, as instructed.
- **Nothing else.** No pre-registration amended, no passing criterion, STOP rule, risk limit, sizing rule
  or hold changed; no book size chosen; no strategy claim invented; no candidate registered.
