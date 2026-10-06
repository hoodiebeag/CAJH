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
