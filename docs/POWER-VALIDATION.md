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
| low | 38 | 2.402% | 0.012% | 0.952% | 48.0% | 2.187 – 2.644% |
| mid | 35 | 2.381% | 0.012% | 0.943% | 47.5% | 2.113 – 2.735% |
| high | 40 | 2.383% | 0.012% | 0.944% | 47.6% | 2.172 – 2.621% |

Ratios to the reference: 1.022 / 1.013 / 1.014. **Spread across states 1.009×.** Across all six
window × mode combinations the spread runs 1.021–1.111×, with no ordering that survives the window
choice — at window 10, `high` has the *lowest* σ, which is the signature of noise rather than structure.

### The limit that decides what "flat" means

| | magnitude |
|---|---|
| typical per-state sampling CI width | **0.509%** |
| as a share of pooled σ | **21.7%** |
| between-state differences observed | ~0.02–0.05% |

The uncertainty is roughly **twenty times** the effect. So this is **"no detectable dependence at this
sample size"**, not "no dependence". Each state holds about a third of 133 periods, and closing that gap
needs **more history, not more draws** — simulation error is already 0.012% and shrinks with draws, while
the sampling CI does not.

**Planning consequence:** on this panel there is no measured basis for a regime-dependent MDE, so a
pooled σ is the honest default. That is a statement about what is measurable here, not a finding that
volatility regimes are irrelevant.

### A defect caught before reporting

The per-state Monte Carlo seed was derived as `state.length * 13`, and `"low"` and `"mid"` are both three
characters — so **two states shared a stream** and their σ were correlated by construction, in a tool
whose entire purpose is detecting correlation between states. Replaced with explicit distinct offsets;
asserted in a test. Deriving a seed from an incidental property of a label is how that happens quietly.

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
2b. ~~Measure σ with a held book carried across periods.~~ **DONE — `866d661`, §5d.** A deterministic
   synthetic carry rule; the `slate=300` / full-pool equivalence survives it, and the effect at smaller
   slates is modest and not monotone. This entry was left marked outstanding after the work landed.

3. ~~Regime-conditioned σ.~~ **DONE — §5e.** Flat: spread 1.009× across states, and the per-state
   sampling CI is ~22% of σ, so a modest dependence would be invisible. More history, not more draws.

3b. **Regime-conditioned σ.** Sub-windows are stable at 1.18x, but quarters are a crude split. Measuring
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
