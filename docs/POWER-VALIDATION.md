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
| within the registered "~157–181%" band? | lower bound below it | **entirely inside** |

The fixed range sits **inside** the pre-registered band, and flatter. **No correction to
`docs/PAPER-PROTOCOL.md` is required**, and none was made — it is a pre-registration, and this document
does not amend it.

## 3. The flat column is an identity, not a lucky measurement

The protocol measured a roughly flat annualised column and concluded the lever is closed. It is also
exactly derivable, which is worth having: a measured flat line invites the reader to wonder whether some
other hold might have been luckier.

If per-period noise scales as a random walk, `σ_h = σ₁√h`, then in a window of `W` trading days:

```
n              = W / h
MDE_per_period = z·σ₁·√h / √(W/h) = z·σ₁·h / √W
MDE_annualised = MDE_per_period · (252/h) = 252·z·σ₁ / √W
```

**The hold cancels exactly.** Annualised detectable edge depends only on one-day noise and the length of
the window — never on how the window is sliced. Asserted to 1e-9 across holds from 1 to 100 in
`analyst/power.test.mjs`. Cost, by contrast, scales as `1/h` and does not cancel: 1.3%/yr at a 21-day
hold against 27.7%/yr at a 1-day hold. **The only thing a shorter hold reliably changes is how much you
pay.** The one lever that is *not* closed is window length, which helps as `1/√W`.

The measured residual against this identity turns out to be small. Measured `σ_h / σ₁√h` is within 6%
of 1 at every hold, and at 21 days it is 0.996 — 21-day noise of 4.93% against a predicted 4.95%. So the
panel's paired noise tracks random-walk scaling closely, which is why the annualised column is as flat as
it is.

**No directional claim is made from that residual, deliberately.** A draft of this document read the
0.4% shortfall at the long end as mean reversion. It is not: a deviation that small is indistinguishable
from Monte Carlo error at 20,000 draws, and reading it as a signal would be the noise-mining this project
closed 76 verdicts on.

## 4. What changed

| file | change |
|---|---|
| `analyst/power.mjs` | **new.** The power arithmetic as a tested module: `mde`, `periodsFor`, `annualise`, `costDragPerYear`, `nonOverlappingStarts`, `annualisedMdeUnderSqrtScaling`, `canAnswer`. All entry points reject inputs that would otherwise yield a plausible-looking wrong number. |
| `analyst/power.test.mjs` | **new.** 15 tests: the 1/√n law, `periodsFor`/`mde` inversion, the registered-table reproduction, the exact hold-invariance identity, the grid invariants, and input rejection. |
| `paper-power.test.mjs` | **new.** 7 tests on the script: determinism under a fixed seed, the corrected period count, per-hold grids, exact cost inversion, flatness of the annualised column, and that the output cannot be misread as a claim of edge. |
| `paper-power.mjs` | grid rebuilt per hold via `nonOverlappingStarts`; the two untested local arrow functions replaced by the module; annualisation uses 252/h rather than a hardcoded 50. |

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

- **Shortening the hold to buy power.** Closed by identity, not just by measurement (§3). No hold can be
  luckier. Already an archive verdict (`HOLDING-PERIOD-COST-AMORTIZATION-MAP`); this adds the derivation.
- **Rescuing a month by running it twice.** MDE falls as `1/√n`: four periods to eight improves the
  detectable edge by 29%, not 50%.
- **Re-deriving the registered table as suspect.** It reproduces. The pre-registration is sound and no
  amendment is needed.

## 6. Next work, ranked by expected information gain

1. **Wire the ledger to cross-check `mdeAtMinimum`** against `power.mjs` and warn on disagreement.
   Highest value: it closes the last hand-copied number in the pre-registration path. **Needs an owner
   decision** because it changes what the ledger accepts — warn-only, or refuse?
2. **Measure per-period paired noise at the book size the analyst will actually run.** The registered
   table assumes a book of 10; `analyst/risk.mjs` limits govern the real size, and σ falls with book
   size (5 names 3.50%, 10 names 2.45%, 20 names lower). If the real book is larger, every MDE in the
   protocol is pessimistic — and that is checkable offline today.
3. **A window-length sweep.** `1/√W` is the only open lever, so the honest question is what run length
   a stated hypothesis needs. `canAnswer` already computes it; a readout would make the trade-off
   legible before a claim is registered rather than after.
4. **Robustness of σ to the sample period.** The whole table rests on one 920-date window. Splitting it
   and re-measuring would show whether the noise level is stable or whether the registered MDE is an
   artifact of one regime. Offline, no new data.
5. **Cost-model sensitivity of the registered MDE.** `PER-FAMILY-COST-CEILING` already gives break-even
   in closed form; what is not written down is how the *detectable* edge moves with the cost
   assumption. Low information gain — cost enters the mean, not the variance — so it is last.

## 7. What still requires Tyler

- **The panel and the key**, as before. Nothing here needed them; everything in §6 items 2–5 is also
  offline.
- **Item 1's decision**: should the ledger cross-check `mdeAtMinimum`, and warn or refuse?
- **Nothing else.** No pre-registration was amended, no passing criterion or STOP rule touched, no
  strategy claim invented, and no draft candidate turned into an approved registration.
