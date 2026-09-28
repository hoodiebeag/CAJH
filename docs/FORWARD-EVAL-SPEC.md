# Forward evaluation: a specification, not an implementation

**Status: proposal. Nothing in this file is built, scheduled, enabled or approved.** It changes no
risk limit, no passing criterion, no STOP criterion and no gate. `docs/PAPER-PROTOCOL.md` remains
the pre-registered protocol and this document does not amend it; where the two could be read as
disagreeing, the protocol wins.

Drafted 2026-09-28, after the archive audit.

## Why a forward test is the only remaining evidence channel

This is the finding that motivates the whole document, and it is not an argument about rigour — it
is arithmetic.

`MULTIPLE_COMPARISONS_AUDIT.md` (2026-08-19, 837 lines) computed the programme's look-elsewhere
exposure. Naive FWER across the formal-significance subfamily at k=22 was **0.6765**. More
importantly, it established that **every new formal test tightens every BH-FDR threshold**, and that
this has already retro-killed the best result in the project: adding `GDELT-NEWS-SENTIMENT` moved
`EQUITIES-MADIP-OUT-OF-SAMPLE` — described in `AGENT_PROTOCOL.md` as "this project's strongest
surviving evidence result" — from **q=0.0493 at n=17 to q=0.0522 at n=18**, purely by growing the
family. Its own p=0.0116 never moved.

So on this dataset, testing more hypotheses does not accelerate discovery. It **consumes a shared
alpha budget and devalues what is already there.** Throughput and proof are not merely separate
concerns; on the retrospective family they are opposed.

A prospective test registered *before the data exists* is a fresh family. It does not inherit the
~55-study denominator, because no amount of prior searching could have selected on data that had not
yet been generated. That is the entire reason to run one, and it is the only lever left that does not
pay the multiple-comparisons tax.

## What this can and cannot deliver

It **cannot** deliver a 30% APY claim on a schedule. Measured on this project's own panel
(2023-01-03 → 2026-09-03, 3.65 years): the random-selection null returned **8.27% APY** and
equal-weight buy-and-hold **15.41% APY**. A 30% net total return is therefore ~21.7 points of excess
over the coin flip, or ~14.6 over buy-and-hold. Extrapolating the protocol's measured power point
(50 non-overlapping periods → 48% annualised MDE) by 1/√n puts resolution of those at roughly **4.9
and 10.8 years respectively**.

Those are estimates, not proof times. They extrapolate from a **single measured point**, assume
stationary per-period variance, and the buy-and-hold figure is rougher still because buy-and-hold is
not the matched control and does not share its variance. **No date should be attached to a 30%
claim, and this document attaches none.**

What a forward run *can* deliver, in order of how soon: operational integrity within weeks, a
falsification of a large claimed edge within months, and a slowly narrowing interval on a small one
over years.

## 1. Prospective timestamped decisions

Every decision is registered before its outcome exists. Already structural and already tested:

- `analyst/context.mjs` slices `[0..asOf]` once, at the entry point; nothing downstream can request a
  later bar because no function is given a way to.
- `contextIsPointInTime()` runs every batch, because "by construction" is a claim.
- Paper mode throws on a stale *or* future-dated panel, and both refusals now journal a `skip` record
  with a reason code, so a refusal is distinguishable from a runner that never fired.
- Each batch is one stateless model call. No conversation carries between decisions.

**Nothing to build.** The requirement is to not weaken any of it.

## 2. Matched random control

`journal.mjs` draws a random book of the same size, at the same sizes, from the same candidate pool,
**at the moment of decision**. This is the load-bearing comparison: sixteen-plus mechanisms died
because a coin flip from the same slate beat them, and a win rate with a payoff ratio is not
evidence.

**Nothing to build.**

## 3. Integrity STOPs — unchanged

The four stopping criteria (2, 3, 6, 7 of `PAPER-PROTOCOL.md`) stand exactly as pre-registered. This
document does not restate, reinterpret or soften them.

One honest caveat already recorded in the readout itself: criterion 2 passes trivially, because
`contextIsPointInTime` can only object to inputs `buildContext` already filters. A pass is evidence
`buildContext` has not regressed — **not** evidence that point-in-time integrity was independently
verified on live data.

## 4. Candidate / version ledger — the one genuinely new requirement

This is what the archive audit says is missing, and it is the only substantive addition proposed here.

The retrospective programme's problem was that the *number of things tried* lagged the real number
silently, while the real number climbed. A forward run can reproduce that failure in a new form:
every prompt revision, checklist change, universe change, slate change or cost-model correction is a
new candidate, and a forward record that does not distinguish them will silently pool them.

A ledger would record, append-only, one row per candidate version, each written **before** its first
decision:

| field | why |
|---|---|
| candidate id + version | so a revision is a new row, never an edit |
| what changed, and why | prose, written before results exist |
| registered claim | the falsifiable prediction for *this* version |
| control | which control this version is scored against |
| minimum periods, and the MDE at that count | computed up front; a test whose MDE exceeds its hypothesis cannot answer it |
| drawdown observation window | pre-registered, so a bad stretch is not reinterpreted afterwards |
| first decision timestamp | the registration boundary |
| supersedes | which version this replaces |

Two rules give it teeth. **A version change resets that candidate's independent-period count to
zero** — a revised analyst has not accumulated the old one's evidence. And **the ledger's row count
is the forward family size**, printed beside any result, so the forward run's own alpha budget stays
visible instead of going stale the way the retrospective one did.

Existing partial coverage: `checklistId` is already recorded per decision with a `--no-checklist`
control arm and a 20-per-arm `checklistSplit`, which is the same idea applied to one variable.

## 5. Independent holding-period units

Already implemented and tested. `holdPeriodKeys` buckets outcomes by non-overlapping holding period
keyed on entry-session rank, `score` prints the period count beside the edge, and the interval is a
clustered bootstrap over whole periods. A single period reports **no** interval rather than a
zero-width one.

The number that matters: 20 trading days at a 5-day hold is **four** observations, not a hundred
trades.

## 6. Synthetic-noise instrument diagnostic

Runs before any forward result is trusted, and consumes **no alpha** — it tests the measuring device,
not a market hypothesis.

Generate a pure-noise panel where there is definitionally no predictable structure, run the existing
stub picker through `dry-run --root <synthetic>` → `settle` → `score`, and require the instrument to
report **no edge** against its matched control. If it reports one, the decision→journal→settle→score
chain is broken and every downstream number is worthless.

Needs no model, no key and no Gateway. It would be marked `SYNTHETIC` in its provenance and must be
unreachable from paper mode.

**What it cannot do:** a pass says nothing about real markets, because there was nothing to find. It
is a negative control, and planting known structure to test detection would measure the analyst
against our own assumptions about markets rather than against markets.

## 7. Independently verified executable cost basis

`PER-FAMILY-COST-CEILING` (2026-08-28) already derived the exact break-even: because `netR` is affine
in fee and slip with a coefficient independent of both, a family's sensitivity collapses to one
constant and break-even all-in per-leg cost is `grossAvgR / k`. Verified to 1e-10.

So the open question is **not** "what cost would make this work" — that is answered in closed form.
It is whether a *verified* execution cost falls below a threshold that was computed in advance. That
is an exogenous measurement, not an NHST test, and it consumes no alpha.

Currently unverified and blocking: `CLASS_STATUS` records IBKR crypto spreads as unmeasured with two
vendors disagreeing 34% on identical names. Equity costs come from `costs.mjs` and were once **half
the real rate**, which made every prior number wrong in the flattering direction.

## 8. Simulated journal decisions vs real IBKR paper orders

These are different instruments and should not be conflated.

| | journalled decisions | real IBKR paper orders |
|---|---|---|
| measures | decision quality at a modelled cost | decision quality **and** fill quality |
| statistical power | n periods | **identical** — buys none |
| assumes | that you get filled | less; surfaces partial fills, rejections, live spread |
| still assumes | — | no market impact; paper venues fill optimistically |
| build cost | none, it exists | crosses protected logic; needs D1→D2→D3 and human sign-off at D3 |
| time to first number | now, once data arrives | after a build |

**Real paper orders buy zero statistical power.** They improve the honesty of the cost and fill
assumption, which is precisely where §7 says the open question lives — so they are not pointless. But
"can we execute it" only matters once "is there anything to execute" has an answer, and that is the
multi-year question.

Recommended sequence: journalled decisions first; revisit an order path only if a candidate survives
long enough that fill realism becomes the binding uncertainty.

## 9. Blockers, rechecked 2026-09-28 rather than asserted from memory

| blocker | status |
|---|---|
| Price panel | **BLOCKING.** No `ibkr-bundle/` on `main-eqhe6g` or `main`. Needs `bash scripts/refresh.sh` on a machine that reaches IB Gateway. Probe first: `--limit 25`, ~30s. |
| Model key | **BLOCKING.** `ANTHROPIC_API_KEY` absent in this container, so no real-model decision can be made here. The stub picker is not an analyst. |
| `paper` command permission | **NOT blocking, contrary to our earlier read.** Rechecked today: `node analyst-run.mjs paper` runs and exits 3 on the missing panel. The 2026-09-24 denial was on a *chained* `paper && settle && score` writing the shared journal — a different command shape. |
| IBKR account route | **BLOCKING for §8 only.** No order path exists; the analyst never imports `brokers/`. Not approved. |
| Live trading | Halted, unchanged. D3 requires a human; a document is not a human at that gate and neither is an agent. |

## 10. What would make this credible, and what would end it

**Credible:** the instrument passes its noise diagnostic; the run produces batches every session
without hand-holding; no STOP criterion fires; the ledger shows few versions and each with its MDE
recorded before results; and the edge over the matched control has an interval that narrows in the
direction the registered claim predicted.

**Ends it:** any STOP criterion firing; the ledger accumulating versions faster than periods, which
means the analyst is being tuned rather than measured; or the noise diagnostic reporting an edge,
which means the instrument lies.

No target return appears in either list, and that is deliberate. A return target is not a decision
rule — it is a wish, and attaching a date to it is how a measurement becomes a rationalisation.
