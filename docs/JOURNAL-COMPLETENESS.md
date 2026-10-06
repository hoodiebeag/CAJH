# Journal settlement and scoring completeness: what each statistic consumes

**What this is:** an offline audit of the path `decision → matched control → settle → score → protocol`,
done on **synthetic fixtures**. It identifies which rows each user-facing statistic consumes and where
two statistics printed side by side are computed from different row sets.

**What this is not:** evidence about any strategy. **No forward decision has ever been recorded** —
`analyst-journal.jsonl` does not exist — so every figure below is hand-built. A number from a synthetic
or dry-run journal is not prospective evidence of anything.

**Nothing was changed.** `journal.mjs`, `loop.mjs`, `protocol.mjs`, `risk.mjs`, the ledger, the gate and
the pre-registered criteria are all untouched. Deliverables are one read-only diagnostic
(`journal-completeness.mjs`), 14 end-to-end tests (`journal-completeness.test.mjs`) and this document.
Proposed fixes are in §5 and are **proposals only**.

**Safety, asserted mechanically rather than claimed.** A test walks the diagnostic's static and dynamic
import graph and asserts it never reaches `analyst-run.mjs`, the order module or any `ibkr-*` module;
that no module in the graph imports the model SDK, constructs a client, or reads the key; that the
diagnostic names none of the identifiers it reads out of `scripts/check-protected-logic.cjs` at test
time; and that the suite leaves the real journal's SHA-256 unchanged (`DEFAULT_JOURNAL` resolves at
import, so a fixture that forgot its file argument would write to the real file).

---

## 1. Which rows each statistic consumes

`sized`† means `action !== "hold"` only. `measurable` means `action !== "hold"` **and** `targetPct > 0`.

| statistic / criterion | filter | rows consumed |
|---|---|---|
| `batches` | `(r.mode ?? paper) === mode` | all decisions in mode |
| `decisions` (printed "sized decisions") | `sized`† | includes **closing** rows (`targetPct === 0`) |
| `outcomes` | batchId ∈ mode's batches | all outcome rows, **duplicates counted twice** |
| `agentMeanNet`, `hitRate` | `Number.isFinite(netReturn)` | agent-side rows, **cost-dependent** |
| `controlMeanNet` | `Number.isFinite(controlReturn)` | control-side rows, **filtered independently** |
| **`edge`** (printed) | the two above, **separately** | difference of means over **possibly different row sets** |
| **`edgeCI.lo/hi`** (printed) | `isFinite(net) && isFinite(control)` | **paired rows only**, clustered by period |
| `edgeCI.mean` | same as `edgeCI` | the paired point estimate — **computed and never printed** |
| `beatControlRate` | numerator paired, **denominator all outcomes** | unpaired rows can only lower it |
| `newsSplit`, `checklistSplit` | `summariseBucket` | same independent-filter `edge` as above |
| `meetsStandingMinimum` | `sized`† ≥ 50 **and** `spanDays` ≥ 60 | closing rows count toward the 50 |
| criterion 6 (manual review) | `sized`† | includes closing rows |
| criterion 7 (**STOPS**) | `measurable`, due by **calendar** days from `d.at` | excludes closing rows |
| criterion 8 (news floor) | `sized`† | includes closing rows in the denominator |
| `settleOutcomes` | `r.mode === mode` **strictly**, `measurable` | excludes closing rows and mode-less records |
| `matchedRandomControl` | `measurable` | excludes closing rows |

**The divergence that matters:** `scoreJournal`'s `sized` and `protocol.mjs`'s `sizedAllowed`
(`protocol.mjs:54`) both use `sized`†, while control, settle and criterion 7's `due` all use
`measurable`. Three criteria and the standing minimum count rows that can never be settled.

---

## 2. Defects — each demonstrated end to end on a hand-built fixture

### D1. The printed point estimate can fall outside the interval printed beside it

`analyst-run.mjs score` prints `edge` (a difference of independently filtered means, `journal.mjs:367-368`)
with `edgeCI` (strictly paired, `:421`) on the next line. Ten daily batches, two names each, a pool of
one — so `matchedRandomControl` truncates to a single control slot and the second name settles with a
null control **through the real `settleOutcomes` path**:

```
  analyst mean net   12.80%
  control mean net    0.00%
  edge               12.80%      <- printed
  95% CI              0.18% .. 0.22%   over 2 period(s)
  [never printed] edgeCI.mean = 0.20%   paired rows 10 of 20 outcomes
```

**The printed edge is 58× the top of the printed interval.** The interval is not degenerate — the
paired differences genuinely vary. The correct paired estimate (0.20%) is already computed as
`edgeCI.mean` and simply never reaches the readout. Synthetic figures.

### D2. `beatControlRate` is biased downward, on the same journal, in the opposite direction

Its numerator requires both halves; its denominator is `outcomes.length`. On the fixture above **all 10
paired rows beat their control**, and the readout prints **50.0%**. So one headline number is biased up
and another down on the same data, which a reader cannot reconcile from the readout.

### D3. A missing **control** bar keeps the agent half; a missing **agent** bar drops the row

`realisedOutcomes` does `if (agent === null) continue` but keeps the row when `ctrl === null`. On a
ragged panel — a late IPO, a delisting, a symbol that failed to resolve — this is the realistic trigger
for D1 and D2, and it is **asymmetric**: the agent's own missing bars shrink `n`, while the control's
missing bars silently unpair a row that still moves `edge`. Demonstrated with a control whose series
ends before the exit bar; the control slot **was** drawn, so this is not the truncation path.

### D4. Criterion 7 — a **stopping** criterion — fails over a weekend

`protocol.mjs:156` computes dueness as `now - Date.parse(d.at) >= hold * 86400000`: **calendar** days
from the **write** timestamp. Settlement needs that many **trading sessions**. A Thursday paper decision
with a 5-session hold, read on the following Tuesday:

```
  settleOutcomes -> wrote 0, pending 1      (correct: 3 sessions elapsed, not 5)
  criterion 7:    FAIL  stops=true  {"due":1,"unsettled":1}
```

**This will fire in the first week of a manual paper run**, and longer over a holiday. The same file
imports `decisionTimeMs` and uses it for criterion 1 (`protocol.mjs:66`); criterion 7 does not —
`journal.mjs:506` exists precisely to say `at` is a write timestamp. Two consequences in opposite
directions: in real time a false FAIL; on a replayed journal every `at` sits in one minute, so `due` is
0 and the criterion passes trivially (paper mode refuses historical dates, so that half reaches only
non-evidence modes).

### D5. A permanently unsettleable name fails criterion 7 forever, labelled as "still in hold"

A sized name with no bar in the panel can never settle. `settleOutcomes` reports it in `pending`, which
`analyst-run.mjs` prints as "still inside the holding period", and criterion 7 counts it as `unsettled`
— a permanent FAIL on a stopping criterion. `pending` conflates three different states: inside the hold,
no panel coverage, and bad bars.

### D6. A duplicate `(batchId, symbol)` outcome is counted twice and hidden by both Sets

`scoreJournal` counts it in `outcomes` and in `edgeCI.nominalN`; `settleOutcomes` reports `already`;
criterion 7's own Set collapses it, so the criterion still reads **pass**. Criterion 7's text says the
idempotence half "is not computable from a file" — **a repeated key is computable from the file**, and
`duplicateOutcomes()` in the diagnostic computes it. (The CLI takes `analyst/lock.mjs` for `settle`, so
concurrent runs are guarded; `settleOutcomes` called as a library is not.)

---

## 3. Latent — real in the code, not reachable in the current wiring

### L1. Closing rows inflate the standing minimum and criteria 6 and 8

Sixty `sell`/`targetPct: 0` rows over 90 days give `decisions: 60`, `meetsStandingMinimum: true`, and
**zero outcomes possible**. **Latent because `analyst-run.mjs` never passes `positions` to `runOnce`**,
so it defaults to `{}`, and `risk.mjs:210` requires a held position for a close to be allowed (a `sell`
with no position is rejected `short_not_permitted`). It becomes live the moment positions are wired,
which a multi-day paper run needs.

**Two readings, and which is registered is the owner's call.** If "50 trades" means *measurable*
decisions, sixty closes meeting the floor with nothing to measure is a defect. If it means *orders
placed*, the count is consistent and only the label is ambiguous. This audit does not reinterpret the
gate.

### L2. Direction is never read, so every row is scored long

`realisedOutcomes` computes `exit/entry - 1` and never consults `action`. Correct today because
`shortingPermitted` defaults **false** in `decide.mjs`, `loop.mjs` and the gate, so `short` is dropped
and a `sell` without a position is rejected. A `sell` with `targetPct > 0` (a partial trim) **is**
allowed when a position is held, and would be scored as a long entry.

### L3. `settle` and `score` disagree about a record with no `mode`

`scoreJournal` and `tier1` both use `(r.mode ?? MODE.PAPER)`; `settleOutcomes` uses `r.mode === mode`.
A mode-less decision is therefore scored, counted toward the standing minimum, and marked `unsettled` by
criterion 7 **permanently**, while `settle` never sees it — not even as `pending`. **Latent because
`recordDecision` has defaulted `mode` since `journal.mjs`'s first commit (`489f2ef`)**, so only a
hand-edited or foreign-writer record can produce it.

---

## 4. Deliberate semantics — correct, with a labelling gap

- **Equal weighting across unequal sizes.** A 10% name at +5% and a 1% name at −5% give
  `agentMeanNet = 0`; portfolio weighting would give **+4.09%**. The control is drawn *at each slot's
  size*, so pairs are size-matched and the paired difference is sound. The aggregate is the **average
  per-decision edge**, not the portfolio's. `targetPct` is recorded, so nothing is lost — but "analyst
  mean net" does not say which it is.
- **Orphan outcomes are dropped entirely.** A malformed decision line orphans its outcomes, which then
  reach no statistic. A fabricated +999% orphan cannot contaminate a mean — the safe direction — but
  nothing in the readout says the rows exist. The diagnostic counts them.
- **Mixed `holdDays` take the maximum.** `holdDaysOf` picks the longest, giving the fewest periods and
  the widest interval. Conservative. Re-settling at a different hold writes nothing, because idempotence
  is keyed on `(batchId, symbol)` alone — so a hold change does not retroactively apply.
- **`hold` actions produce no row, no cost and no control** anywhere, and are excluded from `sized` too.
  Low turnover therefore shows up as a smaller `n`, not as a cost saving (see `POWER-VALIDATION.md` §5g).

---

## 5. Proposed fixes — proposals only, not implemented

Each stays **fail-closed**: nothing here excludes a row from a stopping criterion to make it pass.

1. **D1/D2 — print the paired estimate.** Report `edgeCI.mean` as the point estimate beside its own
   interval, keep the unpaired difference as a separate labelled line, and print the paired count next
   to the trade count. Change `beatControlRate`'s denominator to the paired count, or print both.
   *Readout only; no statistic's definition need change.*
2. **D3 — surface unpaired rows.** Add a `pairedOutcomes` count to `scoreJournal`'s return so the gap
   between `outcomes` and the paired sample is visible without an external tool.
3. **D4 — use the decision bar and trading sessions.** Criterion 7 should take dueness from
   `decisionTimeMs(d)` and count **sessions available in the panel**, as `realisedOutcomes` does, rather
   than calendar milliseconds from `at`. The helper is already imported in that file.
4. **D5 — split `pending`.** Distinct labels for *inside the hold*, *no panel coverage* and *bad bars*;
   criterion 7 should report an unsettleable name under its own label rather than excluding it from `due`.
5. **D6 — count duplicate keys.** Report repeated `(batchId, symbol)` keys in `scoreJournal` and in
   criterion 7, and narrow that criterion's "not computable from a file" wording to the half that is.
6. **L1 — resolve the two readings of the standing minimum.** An owner decision, then make `sized`
   consistent with whichever is registered.
7. **L2 — read `action` in `realisedOutcomes`**, or refuse a non-long row, before shorting or trims
   are ever enabled.
8. **L3 — align the mode filter.** Give `settleOutcomes` the same `(r.mode ?? MODE.PAPER)` tolerance.

---

## 6. Structural limits, reported not corrected

- **Adjacent period clusters share `hold − 1` sessions.** `holdPeriodKeys` buckets by
  `floor(rank / holdDays)`, which removes overlap *within* a cluster. With daily entries at hold 5,
  cluster *k*'s last entry holds sessions 5k+5…5k+9 and cluster *k+1*'s first holds 5k+6…5k+10 — **4 of
  5 shared**. A tilt persisting across a shared window moves both clusters, so the bootstrap's
  independence assumption fails and the interval is optimistic in that case. The "wrong conservatively"
  note in `holdPeriodKeys` covers only *missed* sessions. The protocol's "four non-overlapping
  observations" describes `nonOverlappingStarts`' construction, not the journal's clustering.
- **No statistic reads the version ledger.** Neither `scoreJournal` nor `protocol.mjs` imports
  `analyst/ledger.mjs` (only `analyst-run.mjs`, for `inputHashes` and the readiness readout). A
  mid-run prompt or universe change blends into one edge and one period count, while
  `FORWARD-EVAL-SPEC.md` §4 calls for an independent-period reset per version. `checklistSplit` splits
  on `checklistId` only, not on `model` or any input hash.

## 7. Remaining useful offline work

1. **A same-day rerun check.** Whether paper mode refuses a second batch at an already-journalled
   `asOfTime` was not exercised here; a duplicate decision at one entry session would double-count a
   period's worth of rows.
2. **Skip-record accounting end to end.** `recordSkip` is covered at unit level
   (`journal.test.mjs:276,294`); criterion 1's session-coverage arithmetic over a mixed
   decision/skip/note journal is not.
3. **`newsSplit` / `checklistSplit` under missingness**, since both inherit `summariseBucket`'s
   independently filtered `edge`.
4. **Nothing here needs the key, the panel or the owner's PC.** The two owner-dependent items are L1's
   reading of the standing minimum and whether the ledger should gate scoring.

---

# §8. Same-day reruns, session coverage, and the split readouts

A second unit, building on §1–§7 rather than restating them. `journal-rerun-coverage.test.mjs` (11
tests), plus new counts in `journal-completeness.mjs` (§3b and §6 of its output). Synthetic
Monday-to-Friday fixtures throughout; nothing here is evidence about a strategy, and nothing was changed.

**The CLI was not launched.** `analyst-run.mjs` constructs a model client and takes the journal lock, so
the boundary exercised is `runOnce`'s guards and the pure functions downstream (`recordDecision`,
`recordSkip`, `settleOutcomes`, `scoreJournal`, `tier1`, `missedSessions`). §8.6 names what that leaves
unexercised.

## 8.1 Duplicate *decision* ≠ duplicate *outcome*

`runOnce` reads nothing from the journal, so **there is no rerun guard**, and `defaultBatchId` is
`${mode}-YYYY-MM-DD` (`loop.mjs:293`). A second paper run on the same session, with no explicit
batchId — which the CLI never passes — appends a **second decision record carrying the same batchId**.
The journal lock (`analyst/lock.mjs`, taken for `paper` and `settle`) prevents *concurrent* runs, not
*sequential* ones.

| | one run | the same session run twice |
|---|---|---|
| decision records / `batches` | 1 | **2** |
| `decisions` (`sized`) | 1 | **2** |
| `rejectCounts`, `halts`, `brakes` | 1× | **2×** |
| criterion 1 numerator | 1 | **2** |
| `outcomes` | 1 | **1** |
| `periods` | 1 | **1** |

**Decision-side counts double; outcome-side counts do not**, because settlement keys on
`(batchId, symbol)`. The consequence is on the evidence floor: `meetsStandingMinimum` gates on
`sized >= 50`, so fifty *measurable* trades can be reported after twenty-five sessions run twice. This
compounds with §3's closing-row finding — `sized` is now unreliable as a trade count for two independent
reasons.

**The designed case is different and already correct.** Two *distinct* batchIds at one `asOfTime` — two
arms of a same-day experiment — give two batches and two outcome rows, and still **one holding period**,
because `holdPeriodKeys` ranks distinct entry times. Operationally two, statistically one. Asserted so a
future rerun guard cannot break it.

## 8.2 Criterion 1 measures batches, not sessions

`ratio = decisions.length / weekdaysBetween(min, max)`. Two consequences, both hand-computable:

- **It cannot distinguish "every session once" from "half the sessions twice."** Ten sessions × one run
  gives ratio 1.0; five sessions × two runs gives ratio **2.0** — the same batch count over half the
  sessions scores *higher* on a criterion named "runs every session without hand-holding."
- **A market holiday makes a perfect run fail.** Five batches on all five trading days of a span
  containing Thanksgiving 2026 (Thu 11-26): `expected: 6`, `ratio: 0.833`, **FAIL**. `weekdaysBetween`
  (`protocol.mjs:30`) skips only Saturday and Sunday; the repo has no holiday calendar anywhere.

Criterion 1 does **not** stop the run (`stops: false`), so this is reported-and-judged noise rather than
a halt — unlike criterion 7.

## 8.3 A correct refusal reads as a session that never ran

Nine decisions plus one `PANEL_STALE` skip gives `batches: 9`, `expected: 10`, `ratio: 0.900` — landing
exactly on the pass threshold. The skip is **not** a batch (so it never enters the numerator) while its
`at` **does** extend the span (so it raises the denominator). A guard that refused correctly and a runner
that never fired are therefore indistinguishable in criterion 1, which is the opposite of what
`recordSkip`'s own header says the skip record exists for. `KIND.NOTE` records are in neither count,
which is right — they carry no session.

## 8.4 The session calendar treats a holiday as a missed session

`sessionWeekdays` returns the set of trading *weekdays* (`{1,2,3,4,5}`); there is no holiday calendar.
So on the first trading morning after a holiday, the panel's newest complete bar is two calendar days
back and `missedSessions` counts the holiday:

```
panel's last bar Wed 2026-11-25   (Thu 11-26 is a market holiday)
  Thu 11-26 21:00Z  missedSessions = 0
  Fri 11-27 14:00Z  missedSessions = 1   -> paper mode REFUSES and throws
  Mon 11-30 14:00Z  missedSessions = 0   (once Friday's bar exists)
```

**Paper mode refuses one session per market holiday** (~9 a year), writing a `PANEL_STALE` skip, and
self-heals the next day. The refusal is the stale-panel guard working as written — a holiday is simply
indistinguishable from an outage without a holiday calendar — so this is an **operational** gap, not a
scoring defect. `loop.test.mjs:383` tests that a genuine missed session is counted; nothing tests the
holiday case, because nothing distinguishes it.

## 8.5 Unpairing is positional, and it can null out a whole arm

`matchedRandomControl` does `sized.slice(0, bag.length)`: when the pool is smaller than the book, the
**first** slots get controls and the **tail** gets none. The names drawn are random; **which slots go
unpaired is positional.** A new `unpairedBySlot()` count makes the pattern visible — on a two-name book
with a pool of one, every unpaired row is slot index `[1]`.

That matters because the splits inherit §2's unpaired `edge` through `summariseBucket`, and positional
missingness can align with the split variable. On a fixture where the news-carrying name is always
slot 0:

| arm | n | meanNet | controlMeanNet | edge |
|---|---|---|---|---|
| withNews | 10 | 5.10% | 0.00% | 5.10% |
| withoutNews | 10 | **46.93%** | **null** | **null** |

The without-news arm **displays the larger raw return and reports no edge at all** — `newsSplit` is
called "the split that tests the design's one claim", and here it cannot make the comparison for one
arm while still looking populated. Synthetic figures; the mechanism is the point.

## 8.6 Versions blend, and what is still unexercised

`model` **is** recorded per decision, and **nothing splits on it**: `scoreJournal` splits on
`checklistId` and on per-name news only, and neither it nor `protocol.mjs` reads `analyst/ledger.mjs`
(§6). Two model values across ten sessions give one `edge` and one period count. This is a reporting
gap, not lost data.

Unexercised here, and stated rather than implied:

- **The CLI's own argument handling** — `--asOf`, `--nav`, `--journal`, mode dispatch, lock
  acquisition and release — because launching it would construct a client and take the real lock.
- **`runOnce`'s refusal paths end to end.** `loop.test.mjs:51,93,115,634` cover them with stubs; §8.4
  tests `missedSessions` as a pure boundary rather than re-running the guard.
- **A real rerun through `runOnce`**, for the same reason; §8.1 reproduces the record shape
  `defaultBatchId` produces rather than invoking it.

## 8.7 The criterion-7 fix needs a sharper statement than §5 gave it

§5's proposed fix 3 said criterion 7 should "count **sessions available in the panel**". **That wording
is unsafe and is withdrawn.** If dueness were computed from the sessions available *for the name*, a
name with no coverage would read as "not due yet" **forever**, turning a data gap into a silent pass on
a stopping criterion — the opposite of the intent.

The distinction that fix must preserve:

- **Dueness** belongs to the **panel's own session calendar**: how many trading sessions the panel
  contains *after the decision bar*. That is what replaces calendar milliseconds from `at`.
- **Coverage** belongs to the **name**: whether that symbol has the bars to settle.

A name due by the panel calendar but missing its own bars is a **coverage failure** and must stay
visible — it belongs under §5 fix 4's distinct label, still counted against the criterion, **never
excluded from `due`**. A test pins exactly this: a decision whose symbol has two bars in a nineteen-session
panel reads `due: 1`, `unsettled: 1`, **FAIL**, `stops: true`, and that is the correct outcome.

No implementation. The fix list in §5 stands with fix 3 reworded as above.

## 8.8 Ambiguities, and the one that is not real

Checked against source before reporting, per the standing instruction not to manufacture owner choices:

- ~~**Not an ambiguity.**~~ **WITHDRAWN — this reading was wrong.** The claim was that
  `FORWARD-EVAL-SPEC.md` §4 settles the per-version period reset, so wiring it in would be "a wiring
  gap, not a decision". That file's own header reads *"Status: proposal. Nothing in this file is built,
  scheduled, enabled or approved"*, and states that where it and the protocol could be read as
  disagreeing, **the protocol wins**. A proposal specifying semantics does not make them approved, and
  the ledger having been built offline is not a standing grant to wire it into scoring. The machinery
  (`evidenceWindow`, `recordsAfterBoundary`, `familySize`) does exist and nothing calls it — but
  adopting the spec's semantics **is** an owner decision. See `docs/REMEDIATION-PLAN.md` item P3.
- **A real ambiguity, already open from §3.** Whether the standing minimum's "50 trades" means
  measurable decisions or orders placed. §8.1 adds a second way the count diverges from measurable
  trades (reruns, on top of closes). Still the owner's call; not reinterpreted here.

## 8.9 Next useful independent work

1. **Criterion 1's arithmetic over a mixed journal** — decisions, skips of each reason, and notes
   interleaved across a span with holidays — to see whether the ratio can be made to mean anything
   without a trading calendar.
2. **`contextIsPointInTime` under a ragged panel**, which criterion 2 (a stopping criterion) counts.
3. **A trading-calendar source**, since §8.2 and §8.4 are both the same missing input. Offline:
   the panel's own dates *are* a calendar, and both call sites use a weekday set instead.

None of the three needs the key, the panel upload or the owner's PC.

---

# §9. Ragged-panel point-in-time invariants, and calendar accounting with an explicit unknown

Third unit. `context-ragged.test.mjs` (13 tests), `calendarAccounting()` in `journal-completeness.mjs`
(§5b of its output). Offline and synthetic. Nothing runtime changed — no calendar, gate, eligibility or
criterion was touched.

## 9.1 The invariant holds, verified by perturbation

Not by restating the implementation's index arithmetic. Alter **only** the bar at `asOf + 1`, leave every
bar at or before `asOf` byte-identical, and the whole context must match:

- `AAA` next close set to **99999** and `BBB` next close to **0.01** → context **deepEqual** to the
  unperturbed one.
- The same with that session also appended to `dates`, `asOf` unchanged → still deepEqual, and equal to
  what the shorter grid produced.
- Every timestamp the context reports is `<= asOfTime`, read off the returned object; a headline dated
  after the decision is filtered out inside `buildContext` (`context.mjs:165`).

**Why it holds, structurally:** `buildContext` truncates per symbol at `b.time > asOfTime` (`:88`), and
then builds the grid over `gridDates = dates.slice(0, asOf + 1)` with a **time-keyed** lookup
(`byTime.get(t)`). A bar can only enter the grid if some `gridDates` entry equals its timestamp, so a
future bar has no slot to occupy. That is a stronger guarantee than the truncation alone.

## 9.2 What criterion 2 can and cannot independently verify

`contextIsPointInTime` compares exactly two things against the boundary: `ctx.asOf` (the label) and each
news item's `at`. **No price, bar, indicator or ranking is examined.**

| | checked by criterion 2 | protected by something else |
|---|---|---|
| the `asOf` label | **yes** | — |
| news timestamps | **yes** | also filtered in `buildContext` |
| prices and indicators | **no** | structurally, by the time-keyed grid (§9.1) |
| per-symbol freshness | **no** | **nothing** (§9.4) |
| grid sortedness / duplicates | **no** | nothing (§9.3) |

Asserted both ways: a forged context with `asOf: "2099-01-01"` **is** caught; a forged context whose
candidate carries `momentum: 42` and `ret5d: 99` passes with **zero issues**. So "zero
`context_not_point_in_time` skips" certifies the label and the news dates. It is **not** an
independent audit of the prices — those rest on `buildContext`'s construction, which criterion 2 never
inspects.

## 9.3 Malformed grids: accepted, not refused — but no price leaks

- **An interior future date in an unsorted `dates`** (index 150 set to 2099) raises **no issue** and the
  context *does* differ from the sorted one — a phantom index that no bar can fill, so position-indexed
  lookbacks shift by a slot. **No future price reaches the context**, because `byTime` has no entry at
  that timestamp. Note the related gap: `runOnce` checks only `sessionsAhead(dates.at(-1), now)`, so an
  interior future date is not caught there either.
- **A duplicate timestamp** is accepted; the duplicated session repeats a close, and the index space
  shifts the same way. No issue raised.

Both are silent distortions of the index space rather than look-ahead. `buildContext` validates `asOf`'s
bounds (`:77-79`) and nothing about the grid's ordering or uniqueness.

## 9.4 Two reachable defects

### R1. A symbol whose own bars are out of order gets a fabricated flat history

The truncation loop `break`s at the first bar after the boundary, relying on the series being
time-ordered. Put a future bar at position 1 and **everything after it is discarded**: one surviving
bar, forward-filled across 300 sessions, so every return is exactly zero.

The symbol stays a **candidate** with `momentum: 0`, `ret5d: 0`, `ret63d: 0` — **not `null`**. Zero is a
plausible mid-cross-section value, so it ranks rather than being refused, and criterion 2 reports
nothing. The same series sorted gives `momentum > 0.1`, so this is the scrambling, not the fixture.

### R2. A symbol dead for 200 sessions is a ranked candidate and passes the risk gate

**Point-in-time holds here — every bar used predates the decision. Freshness does not, and they are
different properties.** A symbol whose history stops 200 sessions before the decision bar is
forward-filled to the decision and:

| | ALIVE | DEAD (last traded 200 sessions earlier) |
|---|---|---|
| shown to the analyst | yes | **yes** |
| `momentum` | finite | **finite** |
| `ret5d` | moving | `0` (forward-filled) |
| `quoteAgeMs` | 0 | **0 — identical** |
| risk gate | allowed | **allowed, zero rejections** |
| price sized from | current close | **its close 200 sessions ago** |

`instrumentsFromContext` sets `quoteAgeMs: max(0, referenceMs - asOfTime * 1000)` — derived from the
**decision bar**, the same for every symbol. So `maxQuoteAgeMs` (15 minutes, `risk.mjs:74`, enforced at
`:221`) is structurally **blind to per-symbol staleness**: it polices how old the *panel* is, never how
old a *name* is. Criterion 2 reports zero issues throughout.

This is the most consequential finding of the unit, and it is the live-panel case: a delisting, a halt,
or a symbol that failed to resolve in an IBKR pull all produce exactly this shape.

## 9.5 Correctly handled — refusals, not defects

- **A late start cannot be ranked.** 30 bars in a 300-session grid leaves leading zeros, `ret()` guards
  `a > 0 && b > 0` (`indicators.mjs:17-20`), so `momentum` is `null`, the name is not `rankable`, and it
  is **counted in `universe.total` but kept off the slate**. Safe and deliberate.
- **Interior missing dates forward-fill.** No look-ahead; the documented intent is that "a held-flat
  price is what a stale quote actually looks like". The cost is that a 63-**index** return covers more
  than 63 sessions of real history, and `medianDollarVolume` reads the symbol's **own** last 63 bars
  (not the grid), so its window spans whatever calendar those bars cover. Semantics, verified, not a bug.

## 9.6 Calendar accounting: five quantities, and the one that must stay unknown

**Primary source unavailable, stated rather than worked around.** `www.nyse.com`, `www.sec.gov`,
`www.federalreserve.gov` and `markets.nasdaq.com` are all blocked by this session's egress policy. Only
`pypi.org` is reachable, and a package index is not a primary trading-calendar publisher — installing a
redistribution to assert holiday facts would be both a dependency change and a third-party source
dressed as primary. **No holiday date is asserted anywhere in this unit**, and every fixture defines its
gaps structurally ("a weekday for which no symbol has a bar").

`calendarAccounting()` separates:

| # | quantity | source | this unit's value |
|---|---|---|---|
| 1 | **expected market sessions** | an exchange calendar | **`null` — UNKNOWN** |
| 2 | observed panel sessions | the union of bar dates | derivable |
| 3 | operational attempts | decisions **+** skips | derivable |
| 4 | successful decisions | distinct decision sessions | derivable |
| 5 | statistical periods | sessions clustered by hold | derivable |

**The panel's observed dates are not a calendar.** A session missing for *every* symbol — holiday or
outage — **disappears from the union entirely**. Asserted: removing one weekday from a 20-session grid
leaves `sessionWeekdays` returning the same `{1,2,3,4,5}`, so nothing looks odd, while `missedSessions`
reads the absence as one completed session behind.

So each weekday in the span is classified three ways, and the third is **not resolved**:

- **covered** — a bar and a decision.
- **operational gap** — a bar, no decision. The runner did not fire, or refused.
- **UNKNOWN** — no bar for any symbol. **Either** a market holiday (no session expected) **or** a
  panel-wide outage (a session expected and missed).

**This is deliberately not a holiday count.** §8.2 showed criterion 1 resolving the unknown one way, by
treating every weekday as an expected session, which penalises a holiday. Substituting the panel's own
observed dates would resolve it the other way — and then **a day the system should have traded and did
not would vanish from the denominator**, which is the worse error. Neither is derivable here, so the
bucket is counted and left unresolved. A no-bar weekday stays visible; it never leaves the denominator.

Also separated, because §8.1 showed them diverging: **decision records** (7) against **successful
decision sessions** (6) against **statistical periods** (2) on the same fixture.

## 9.7 Limits

- **Nothing above is implemented as a runtime change.** No calendar source added, no gate altered, no
  eligibility rule touched, no criterion rewritten.
- **The unknown bucket cannot be collapsed offline.** Resolving it needs an exchange calendar, which
  needs either an egress allowance for a primary source or an owner-supplied file. Not an owner
  *decision* — an owner-supplied *input*.
- **R2's blast radius is not measured.** How often a real IBKR pull contains a dead-but-present symbol is
  a property of the live panel, which is not on the remote yet.
- `buildContext` is exercised directly; `runOnce`'s refusal paths remain covered by the existing stubs
  at `loop.test.mjs:51,93,115,634` rather than re-run here.

## 9.8 Remaining useful independent work

1. **A per-symbol freshness measure** for the diagnostic — sessions since each symbol's own last bar,
   against the decision bar. That is the number R2 shows nothing currently computes, and it is derivable
   offline from any panel.
2. **Grid validation as a diagnostic** — sortedness, uniqueness and monotonicity of `dates`, plus
   per-symbol ordering, reported rather than enforced (§9.3 shows all three are currently accepted).
3. **Criterion 2's coverage, written into the protocol readout** so the criterion's text says what it
   certifies — currently a reader can reasonably take "point-in-time integrity holds live" to cover
   prices.

None needs the key, the panel upload or the owner's PC. Item 1 would become much more informative once a
real panel is on the remote.

---

# §10. Per-symbol freshness, grid validation, and a 2026-grounded session reconciliation

Fourth unit. `panel-freshness.mjs` (new, read-only), `panel-freshness.test.mjs` (15 tests), this
section. **Reported, never repaired:** nothing in this unit sorts, de-duplicates, drops or imputes, and
none of it is wired into eligibility, the gate, scoring, settlement, cost, the ledger or the protocol
readout. §9.2's statement of what criterion 2 covers is preserved in documentation only.

## 10.1 The calendar, scoped and cited

`NYSE_2026` records the published NYSE schedule for **2026 only**.

- **Source:** the primary NYSE Holidays & Trading Hours page, `https://www.nyse.com/markets/hours-calendars`
- **Retrieved:** 2026-10-06, by independent research outside this session. This session's own egress
  policy blocks `nyse.com` (§9.6), so the facts were supplied rather than fetched here.
- **Coverage:** 2026. The page's text also covers 2027 and 2028; those years were **not transcribed and
  are UNKNOWN to this module**, not extrapolated.
- **Basis:** *published scheduled* sessions. An **exceptional** closure — weather, a day of mourning, a
  systems outage — arrives as a separate exchange notice and is **not** represented. So a weekday absent
  from both a panel and this list remains **UNKNOWN**: it may be an unpublished exceptional closure or a
  data gap. The module reports that case and does not resolve it.
- **Published full-day closures (10):** Jan 1, Jan 19, Feb 16, Apr 3, May 25, Jun 19, Jul 3
  (Independence Day observed), Sep 7, Nov 26, Dec 25.
- **Early closes (2):** Nov 27 and Dec 24, 1:00pm America/New_York. Regular session 9:30am–4:00pm.
  **An early close is a shorter session, not a closure — a bar is expected**, and the test asserts both
  that neither date is in `closed` and that `expectedSessions` includes them.

`expectedSessions()` **refuses** outside 2026 rather than falling back to a weekday count, including for
a window that merely straddles the boundary. Asserted for 2025, for 2025-12-30→2026-01-05 and for
2026-12-28→2027-01-04.

## 10.2 The real research panel reconciles exactly for 2026

`node panel-freshness.mjs` on `sp500-bundle` (127 symbols, 921 observed sessions, 2023-01-03 →
2026-09-03):

| | result |
|---|---|
| grid shape | **clean** — no misalignment, duplicate or out-of-order timestamp |
| full span vs calendar | **UNSUPPORTED** — 2023–2026 is outside the grounded year; **37** no-bar weekdays reported as **UNKNOWN, counted** |
| narrowed to 2026-01-02 → 2026-09-03 | **expected 169, observed 169** |
| expected sessions with no bar | **0** |
| bars on a published closure | **0** |
| published closures inside that window | 6 (Jan 1 falls before the panel's first 2026 bar) |

**For the grounded window, §9.6's UNKNOWN bucket collapses to zero**: every absent weekday is an
explained published closure, and there is no evidence of a panel-wide outage. That is the first time this
project has been able to say so rather than leave it open. The 37 UNKNOWN weekdays over 2023–2025
**remain unknown** — they are not asserted to be holidays, because those years are not grounded.

Corroborating detail, not a claim: the panel's weekday histogram is Mon 173, Tue 191, Wed 189, Thu 184,
Fri 184. Mondays are the scarcest, which is the shape a holiday schedule produces; it is consistent with
closures rather than evidence of their dates.

Per-symbol, `sp500-bundle` is perfectly rectangular — 0 symbols stale at the decision, 0 with a late
start, 0 with interior gaps, 0 with a shape problem. **The diagnostic finds nothing on this panel**,
which is the honest result and the reason the behaviour is demonstrated on fixtures instead.

## 10.3 What is now measured per symbol

| field | meaning |
|---|---|
| `lastBarAtOrBefore` | the symbol's own newest bar at or before the decision, found **by time, not position** |
| `sessionsSinceLastBar` | distance on the **observed** grid. Not an expected-session count, and never substituted for one |
| `wallClockAgeMs` | age against a supplied `now`, which separates a dead name from a live one — the gate's `quoteAgeMs` cannot |
| **`forwardFilledAtDecision`** | **true when the symbol has no bar at the decision session**, so the context's price for it is held-flat and **not a quote** |
| `lateStartSessions` | grid sessions preceding its first bar |
| `interiorMissingSessions` | absences strictly inside its own span — distinct from a late start |
| `earlyEnd` | its history stops before the decision |
| `barsAfterDecision` | present in the input, **excluded from every at-or-before count** |
| `offGridDates` | bar dates the grid does not contain at all — named, not ignored |
| `shape` | ordering, duplicate and alignment problems, **unrepaired** |

A symbol with no usable bar reports **`null`**, not `0` — absence is not freshness.

**On a 60-session fixture with `DEAD` stopping 20 sessions early:** `sessionsSinceLastBar = 20`
(hand-checkable as 59 − 39), `forwardFilledAtDecision = true`, `wallClockAgeMs` strictly greater than
the live name's, and `DEAD` sorts first so the worst case is the first thing a reader sees.

## 10.4 Invariants and pitfalls, each demonstrated

- **Immediate-next-bar contamination cannot move any figure.** Appending a bar at `asOf + 1` with close
  `1e6` to one symbol and `0.001` to another leaves the whole report `deepEqual` once the deliberate
  `barsAfterDecision` counter is stripped — and that counter goes to 1, so the bar is *seen* and
  *excluded* rather than ignored.
- **Measured by time, not position.** §9.4's R1 symbol — a future bar at position 1 — loses all later
  history inside `buildContext`'s `break`. This diagnostic counts all 40 at-or-before bars, reports
  `sessionsSinceLastBar: 0` and **names the disorder** in `shape`. The two views of the same series
  disagree, and that disagreement is the finding.
- **The date-boundary pitfall, computed rather than recalled.** A stamp at `2026-03-10T01:00:00Z` is
  `2026-03-09` in America/New_York — the *previous* session day. The real bundle avoids this entirely by
  stamping every bar at `00:00:00Z` of the session date (verified: **0 of 921** misaligned), so a
  non-midnight timestamp is **flagged** rather than assigned to a day on the caller's behalf. The
  2026-11-27 early close at 13:00 ET is 18:00Z and *happens* to stay on the same UTC date — flagged
  anyway, because the check must not depend on that luck.
- **A missing expected session never leaves the denominator.** Dropping one session from a 2026 February
  window leaves `expected` unchanged and lists the gap in `missingExpected`. **The expected count does
  not shrink to match what was observed** — the error §9.6 warned against.
- **A bar on a published closure** is reported in `presentButClosed`: the panel disagreeing with the
  schedule, which is a different problem from a gap and is kept separate.
- **Validation reports and returns the input untouched.** After `validateTimestamps` flags a swap, the
  array is asserted still swapped. A duplicate is reported as both a duplicate *and* a non-increase.

## 10.5 Limits

- **2027, 2028 and every venue other than NYSE remain UNKNOWN.** Not an owner decision — an input that
  has not been grounded. The module refuses rather than extrapolating.
- **Exceptional closures are outside the source.** A weekday absent from both the panel and the
  published list stays UNKNOWN. No diagnostic can close that gap from the schedule alone.
- **Intraday semantics are untested** because the panel is daily. The early-close times are recorded for
  a future intraday diagnostic so that a short session is not read as a missing one; nothing here uses
  them.
- **Nothing is wired in.** §9.4's R2 — a dead symbol passing the gate at a stale price — is now
  *measurable* and still *unmitigated*: `forwardFilledAtDecision` exists, and no runtime path consults it.
- **The live panel is still not on the remote**, so R2's frequency on real IBKR data remains unmeasured.

## 10.6 Next useful independent work

1. **Run this diagnostic against the live `ibkr-bundle` once it lands.** It is the first tool that would
   show whether a real pull contains dead-but-present symbols, and it needs no key — only the panel.
2. ~~**Ground 2027 from the same primary page**, so a forward run crossing the year boundary is not
   immediately UNSUPPORTED.~~ **DONE — §10.1 now covers 2026-2028**, with year-boundary and DST tests.
   2029 and later remain UNKNOWN.
3. **A `presentButClosed` check against the live panel**, which would catch a vendor stamping a bar on a
   closed day — a class of error the research bundle shows zero of.

None needs the key or the owner's PC. Item 1 needs only the panel upload that is already pending.
