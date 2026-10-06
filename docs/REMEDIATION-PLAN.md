# Remediation plan: the audited defects, in dependency order

**Status: a plan, not a change.** Nothing here is implemented. Every item is a *proposed* change to code
that currently behaves as described, and several would alter a pre-registered criterion — which is the
owner's call, not this document's. `docs/PAPER-PROTOCOL.md` remains the pre-registered protocol.

**Sources.** Every item below traces to a fixture in `docs/JOURNAL-COMPLETENESS.md` §2–§10 with a named
test. Nothing is listed on suspicion. Section references are to that document.

**A correction this plan had to make about its own footing.** An earlier section (§8.8) argued that
wiring a per-version period reset into scoring was "a wiring gap, not an owner decision", because
`FORWARD-EVAL-SPEC.md` §4 specifies one. **That was wrong.** That file's own header reads *"Status:
proposal. Nothing in this file is built, scheduled, enabled or approved"*, and states that where it and
the protocol could be read as disagreeing, **the protocol wins**. A proposal specifying semantics does
not make those semantics approved, and the ledger having been built offline is not a standing grant to
wire it into scoring. Item **P3** is therefore an owner decision, and §8.8's claim is withdrawn.

---

## How to read the columns

- **Consequence** — what goes wrong in a real run, not how hard it is to fix.
- **Reachable now?** — whether the current wiring can produce it. "Latent" means the code path exists
  and something else currently prevents it.
- **Changes** — `GATE` (a stopping criterion, refusal or risk decision), `STAT` (a published number),
  `LABEL` (wording or an added report field only).

---

## A. First-forward-run blockers

These fire in the first weeks of a manual paper run, on correct inputs.

### A1 — Criterion 7 stops the run over a weekend · `GATE`

**This item's first draft was wrong twice and is corrected here.** It proposed counting "sessions the
panel contains after the decision bar" and said it depended on nothing. Counting *observed* sessions
lets a panel-wide gap erase the very failure it causes, and sourced expected sessions are only
available inside grounded calendar coverage — so it depends on the calendar.

| | |
|---|---|
| **Consequence** | A stopping criterion reads FAIL while settlement is behaving correctly. Halts a run that is fine. |
| **Path** | `analyst/protocol.mjs:156` — `now - Date.parse(d.at) >= hold * 86400000` |
| **Reachable** | **Yes, immediately.** Calendar days outrun trading sessions across any weekend. |
| **Evidence** | §2 D4; `journal-rerun-coverage.test.mjs` "criterion 7 STOPS the run over a weekend". Thursday decision, 5-session hold, read the following Tuesday: `settle` writes 0, criterion 7 FAILs with `due: 1, unsettled: 1, stops: true`. |
| **Exact change** | In `analyst/protocol.mjs` criterion 7 only: take the decision instant from `decisionTimeMs(d)` (already imported, already used by criterion 1) and count **expected sessions strictly after the decision bar**, from a sourced calendar. No other criterion, file or threshold. |
| **Changes** | `GATE` — a stopping criterion's arithmetic. |
| **Expected effect** | A decision inside its hold stops reading as overdue. On a replayed journal whose `at` values share one minute, `due` stops being 0. No change to which names are settled, only to when settlement is *expected*. |
| **Fail-closed** | Three outcomes, and the third is not "not due": **due**, **not due**, and **UNDECIDABLE** when the window is outside grounded coverage. Undecidable must surface as a reportable failure to determine — never as "not due", and never by falling back to the observed count. An unparseable `at` likewise must not become "not due". |
| **Stays untouched** | **Dueness ≠ coverage.** Whether the *symbol* has bars is a separate question; a due decision whose symbol lacks coverage stays `due` and stays failing (§8.7). Criterion 7 keeps `stops: true`. |
| **Acceptance tests** | `acceptance-contracts.test.mjs`, six contracts: the panel-wide-gap adversary (5 expected sessions elapse, one missing for every symbol → observed counting says 4 and "not due"; expected counting says **due**); a weekend is legitimately **not due** (3 sessions, not 5 calendar days); a published closure does **not** advance dueness while an **early close does** (Nov 20 → Nov 27 gives 4 sessions, Nov 30 gives 5); a due decision whose symbol lacks coverage **stays due**; outside coverage `due === null` with a reason and no invented count; and input rejection. Plus the §8.7 fixture still reading `due: 1, unsettled: 1, FAIL, stops: true`. |
| **Depends on** | **The grounded calendar** (`panel-freshness.mjs` `expectedSessions`, 2026–2028, §10.1) — *not* "nothing". Shares A2's dependency and its invariant. |
| **Owner semantics vs source-settled** | **Source-settled:** that calendar days and trading sessions differ, and that `decisionTimeMs` exists for exactly this reason (`journal.mjs:506`). **Owner:** whether this exact criterion-7 arithmetic change is approved, and whether a *gate* may depend on a transcribed calendar given that an ungrounded year must then refuse (P4). |

### A2 — A market holiday makes paper mode refuse a session · `GATE`

| | |
|---|---|
| **Consequence** | One refused session per holiday (~9–10/yr), each writing a `PANEL_STALE` skip and depressing criterion 1. Self-heals next day. |
| **Path** | `analyst/loop.mjs` `missedSessions` / `sessionWeekdays`; refusal at the paper-mode guard |
| **Reachable** | **Yes.** `sessionWeekdays` returns a weekday *set*; no holiday calendar exists in the runtime. |
| **Evidence** | §8.4; `journal-rerun-coverage.test.mjs` "the first trading day after a holiday reads as a missed session". Panel last bar Wednesday, read Friday morning → `missedSessions = 1`. |
| **Proposed** | Consult a published session calendar when the window is grounded, and subtract scheduled closures from the missed count. `panel-freshness.mjs` `expectedSessions()` already does this for **2026–2028**. |
| **Invariants** | **Do not replace a weekday bug with silent outage acceptance** (§9.6). Outside grounded coverage the function must **refuse** rather than fall back to a weekday count, and the guard must keep refusing — an ungrounded year is not a reason to trust a stale panel. A no-bar weekday that is *not* a published closure stays a missed session. |
| **Acceptance** | The holiday fixture no longer refuses; a genuine mid-week outage still refuses (`loop.test.mjs:383` must still pass); a 2029 date returns UNSUPPORTED and the guard's behaviour is unchanged there. |
| **Depends on** | The grounded calendar (**done**, §10.1: 2026–2028, cited, weekday-verified). |

### A3 — The paper-mode quote-age check rejects every symbol, fresh ones included · `GATE`

**This item's first draft was wrong and is corrected here.** It proposed feeding the symbol's own
daily bar timestamp into the 15-minute `maxQuoteAgeMs` limit. **A daily bar is a session record
stamped at 00:00:00Z, not an observation of an executable quote**, so that figure is always at least a
day old and the substitution would reject every fresh symbol. Investigating that turned up a larger
defect than the one originally filed.

| | |
|---|---|
| **Consequence** | **In paper mode, with the staleness guard passing, every proposal is rejected `stale_quote`.** A paper run would journal batches with an empty book: `sized` stays 0, no outcome ever settles, no edge is ever measurable. Separately, a dead-but-present symbol is indistinguishable from a live one by this measure (§9.4 R2). |
| **Path** | `analyst/loop.mjs:231` — `referenceMs = mode === MODE.PAPER ? now : asOfTime * 1000`; `instrumentsFromContext` `:304` — `quoteAgeMs = max(0, referenceMs - asOfTime * 1000)`; limit `analyst/risk.mjs:74`, enforced `:221`. No `limits` override exists anywhere in `analyst-run.mjs`. |
| **Reachable** | **Yes, on the first paper run.** Paper mode requires the newest bar to be the last *completed* session, so it is at least one midnight back; measured 37.5h, 38.0h and 43.9h at three legitimate run times, against a 15-minute limit. |
| **Evidence** | `acceptance-contracts.test.mjs` "in paper mode a FRESH symbol is already rejected stale_quote" — `missedSessions = 0` (the guard proceeds) and the gate returns `allowed: []`, `stale_quote`. And "the minimum possible paper-mode figure is a day", which holds by construction at every run time. |
| **Why the suite never caught it** | `analyst/loop.test.mjs`'s `panel()` helper sets `lastTime = floor(now/1000) - endingDaysAgo*DAY`, so with `endingDaysAgo = 0` the newest bar carries an **arbitrary wall-clock instant** and the age is ~0. The real bundle stamps every bar at **00:00:00Z** (0 of 921 misaligned). The two conventions differ in exactly the way that hides this, which is why `"a clean batch flows context -> decide -> gate -> journal"` passes in paper mode with `allowed.length === 2`. Pinned by a test. |
| **What information actually exists** | Three distinct quantities, now reported separately by `freshnessInformation()`: **`sessionsSinceLastBar`** — daily-session freshness, derived and meaningful, 0 for a live name and 19 for one that stopped 19 sessions ago; **`barTimestampAgeMs`** — the wall-clock age of a midnight-stamped session record, which is what the code computes today and is *not* a quote age; **`quoteAgeMs`** — **unavailable**, reported as `null` with a reason, because a daily panel carries no intraday observation. |
| **PREFERRED PROPOSAL — fail-closed, and it leaves the 15-minute threshold untouched** | **Keep `maxQuoteAgeMs` at 15 minutes, unchanged, for an actual quote observation.** A daily panel never supplies one, so the millisecond rule is **not applicable** there rather than vacuously passing. In its place, two complementary daily-session requirements: **(a) per-symbol** — the symbol must have a bar **at the decision session** (`forwardFilledAtDecision === false`); a symbol with no bar at that session, or no usable bar at all, is **rejected**, never treated as age 0. **(b) panel-level** — the panel's own session coverage must be **explicit**: its newest session must be the latest expected session, checked against a sourced calendar, with UNKNOWN outside grounded coverage (and UNKNOWN must refuse, not pass). |
| **Why (i) and (iv) are not alternatives — they overlap and both are needed** | A per-symbol session rule alone **cannot see a stale panel**, because `sessionsSinceLastBar` is measured against the panel's *own* newest session: on a panel a week out of date every symbol still has a bar at that session and all read **0** (asserted). A panel-level rule alone **cannot see a dead symbol inside a fresh panel** (§9.4 R2). (i) is (a) and (iv) is (b); the preferred proposal is their conjunction, not a choice between them. |
| **Options rejected, with source rationale** | **(ii) the zero-age shortcut** — set `referenceMs = asOfTime * 1000` in paper mode, as the dry run does. **Rejected:** it makes the check measure nothing. Asserted: a symbol 19 sessions stale reads `quoteAgeMs === 0`, identical to a live one, and is **allowed**. It also erases the mode distinction `loop.mjs:226-230` deliberately draws. **(iii) raise the threshold** — **rejected because the unit is wrong, not the value.** Calendar time per session varies: the longest *legitimate* gap between consecutive expected sessions in 2026–2028 is **96h** (2026-01-16 → 2026-01-20, a weekend plus a published closure), while a symbol genuinely **one session stale** after an ordinary weekend is only **72h** old. The stale case sits *inside* the fresh window, so **no single millisecond threshold separates them** — computed from the grounded calendar, not asserted. Neither of these is a safe alternative to the preferred proposal and they are not offered as equivalent choices. |
| **What daily evidence can and cannot establish** | A daily bar is a **session record**: it says a session occurred and closed at a price. It does **not** say a quote was observable, that a price is currently tradable, or anything about the spread, depth or the state of the book at any instant. So daily data can support "this name traded in the most recent session" and cannot support "this price is executable now". The 15-minute rule is about the second claim, which is why it should keep its meaning and simply not apply to a daily panel. |
| **The hazard any implementation must avoid, from source** | `risk.mjs:221` guards with `isFiniteNum(inst.quoteAgeMs)`, so a quote age that is **absent, null or NaN skips the staleness check entirely and the proposal is ALLOWED** — asserted for all three. Simply nulling the field for daily bars would therefore **disable** the gate rather than fix it. The replacement check must reject on absence. |
| **Changes** | `GATE` under every option. (ii) and (iii) also change what an existing pre-registered limit means. |
| **Fail-closed** | A symbol with **no** usable bar must be rejected, not treated as age 0 — the hazard in option (ii). No threshold may be changed silently: if a number moves, it moves explicitly and is recorded. A daily close must not be asserted to be a current tradable quote in any readout. |
| **Stays untouched** | Point-in-time: the measure reads bars at or before the decision only, asserted by a next-bar perturbation test (`deepEqual` with a `1e6` close appended at `asOf + 1`). The dry-run reference path, which works today and is the reason the plumbing check is meaningful. `maxQuoteAgeMs`'s value, unless an option that changes it is chosen. |
| **Acceptance tests** | Fresh symbol **allowed** in paper mode at a legitimate run time; a symbol 19 sessions stale **rejected**; a symbol with no usable bar **rejected**; the dry-run path unchanged (`quoteAgeMs === 0`, allowed); the next-bar perturbation still `deepEqual`; and the real panel's 127 symbols — all 0 sessions stale — unaffected. |
| **Depends on** | `panel-freshness.mjs` (**built**) for `sessionsSinceLastBar` and `forwardFilledAtDecision`; the grounded calendar for the panel-level half, which brings **P4** in; and its own approval. **No N is chosen here**: the per-symbol rule as stated needs no threshold at all (a bar at the decision session, or reject), which is why it is preferred over a tunable `sessionsSinceLastBar <= N`. |
| **Owner semantics vs source-settled** | **Source-settled:** that the current paper path rejects everything (measured at three run times); that the reference differs by mode (`loop.mjs:231`); that a missing `quoteAgeMs` currently fails open (`risk.mjs:221`); that no millisecond threshold can separate fresh from one-session-stale (96h vs 72h, computed); and that (i) and (iv) are complementary rather than alternative. **Genuinely unresolved and for the owner:** (1) whether this exact behaviour change to a risk rejection is approved; (2) whether the panel-level half may depend on a transcribed calendar, given UNKNOWN must then refuse (**P4**); and (3) the one real tradeoff — a strict "bar at the decision session" rule will **reject a symbol that genuinely did not trade that session** (a halt, or a thin name with no prints), which is fail-closed and correct but *will* shrink the eligible universe on a ragged panel by an amount no offline fixture can predict. |

### A4 — The headline edge and its interval are computed on different rows · `STAT`

| | |
|---|---|
| **Consequence** | The printed point estimate can sit **outside** the interval printed beside it, while `beatControlRate` is biased the opposite way on the same journal. Fires as soon as any control row is null. |
| **Path** | `analyst/journal.mjs:367-368` (`edge`), `:421` (`edgeCI`), `:454` (`beatControlRate`), `summariseBucket` `:484`; readout `analyst-run.mjs:441-453` |
| **Reachable** | **Yes.** A pool smaller than the book truncates (`matchedRandomControl`), and a control missing its entry or exit bar nulls the control half while keeping the agent half (§9.4 asymmetry). |
| **Evidence** | §2 D1/D2, §8.5; `journal-completeness.test.mjs` "the printed edge can fall OUTSIDE the interval printed beside it" — `edge 12.80%` against `95% CI 0.18%..0.22%`, paired truth 0.20% computed as `edgeCI.mean` and never printed; `beatControlRate 50.0%` where 10/10 paired rows beat. |
| **Proposed** | Print `edgeCI.mean` as the point estimate beside its own interval; keep the unpaired difference as a separate labelled line; print the paired count next to the trade count; report `beatControlRate` over paired rows (or print both denominators). Add a `pairedOutcomes` field so the gap is visible without a tool. |
| **Invariants** | Do not change what `edgeCI` resamples, nor the period clustering. **The unpaired number must not be deleted** — it is the right figure for absolute means; it is only wrong as *the edge*. Unpairing is **positional** (§8.5), so the fix must not present it as random missingness. |
| **Acceptance** | On the §2 fixture the printed point estimate is 0.20% and lies inside its interval; `beatControlRate` reads 100% over paired rows with the 20-row denominator still shown; `newsSplit`/`checklistSplit` arms report a paired edge or an explicit null with a reason. |
| **Depends on** | Nothing. |

---

## B. Reachable-but-unexercised and latent defects

**Reachability is labelled per item** rather than by the section heading, because they differ: B1 and B4
need only an operator action, while B2, B6 and B7 are blocked by current wiring.

### B1 — No same-session rerun guard · `STAT` (and a gate *input*) · **reachable today**

`runOnce` reads nothing from the journal; `defaultBatchId` is `${mode}-YYYY-MM-DD` (`loop.mjs:293`) and
the CLI passes no `batchId`, so a second paper run on one session appends a second decision under the
**same** id. The lock guards concurrent runs, not sequential ones. **Reachable today** — it needs only a
second `node analyst-run.mjs paper`, which an operator retrying after a transient failure would do.

**"Refused OR marked superseding" was not approvable.** Those are two materially different designs, and
the measurement below narrows which are even necessary.

#### What a retry actually moves — measured, `retry-and-version.mjs` part 1

| situation | recs | ids | repeated | **nominal** (`sized`) | rows | paired | periods |
|---|---|---|---|---|---|---|---|
| one run | 1 | 1 | 0 | **2** | 2 | 1 | 1 |
| same session run twice (today) | 2 | 1 | **1** | **4** | 2 | 1 | 1 |
| two **distinct** ids, one session | 2 | **2** | 0 | 4 | **4** | **2** | 1 |
| interrupted write, then retry | 2 | 1 | **1** | **4** | 2 | 1 | 1 |
| retry after settlement | 2 | 1 | **1** | **4** | 2 | 1 | 1 |

**The defect is confined to the decision-side counts.** `nominalTrades` (`sized`, which gates the
standing minimum), `rejectCounts`, `halts`, `brakes` and criterion 1's numerator all double.
`outcomeRows`, `pairedOutcomes` and `independentPeriods` do **not** — the settlement key
`(batchId, symbol)` and `holdPeriodKeys`' ranking of distinct entry times already de-duplicate, and a
second `settle` reports `wrote: 0` with the rows `already` present.

**Two situations must not be conflated.** A repeated **identity** is a duplicate; several **distinct**
identities on one session are a legitimate controlled comparison that genuinely adds measurable rows
and must still count as **one** independent period. The discriminator is *repeated identity*, never
*several batches per session* — asserted.

**An interrupted partial write is indistinguishable from a plain rerun** in every count (asserted as
`deepEqual`). The journal carries no marker that an attempt did not complete, and the lock releases on
exit, so it does not leave one either. **No policy can separate these two from the record alone** — that
is a limit, not a design choice.

#### Proposed policy options — all append-only, none chosen

The journal is append-only and a test pins that every earlier byte survives a second pass, so **no
option may rewrite or delete a record.** In increasing order of intervention:

- **R0a — additive diagnostics only.** `LABEL`. Add a repeated-`batchId` count and a *de-duplicated*
  `sized` figure **alongside** the raw one, in `scoreJournal`'s return and the readout. `sized` itself
  is unchanged, so **no gate input moves** and `meetsStandingMinimum` is untouched. This is the only
  genuinely report-only option.
- **R0b — replace the gate count.** `STAT`, **and it changes a gate input.** Make
  `meetsStandingMinimum` read the de-duplicated count instead of the raw one. This is what actually
  closes the defect, and calling it "report only" — as an earlier draft of this item did — was wrong:
  the standing minimum is the evidence floor, so changing its input changes when the record may be
  cited. It depends on **P1**, since what `sized` *should* count defines what de-duplicated means.
- **R1 — refuse.** `runOnce` reads the journal and refuses a decision at an `asOfTime` already
  journalled in that mode, writing a skip. Prevents the duplicate at source; costs a journal read in
  the decision path, and **would block a legitimate retry after a genuine partial failure** — which, per
  the finding above, it cannot distinguish.
- **R2 — supersede.** Append a marker record naming the superseded `batchId`, and have scoring count
  only the latest. Keeps the retry possible and preserves history; requires a **new record kind** and a
  scoring rule that reads it, so it is the largest change and introduces an ordering question (what if
  two markers disagree).
- **R3 — distinct identities always.** Make `defaultBatchId` include an attempt counter so a rerun is
  never a duplicate. Removes the ambiguity but makes every retry look like a new experiment, which is
  exactly the conflation the measurement above says to avoid. **Not recommended.**

**Preferred sequence for approval: R0a first, then R0b.** The evidence is that nothing needs
*preventing* — the outcome side is already safe — so the minimum step is to make the duplicate visible
(**R0a**, no gate input moves, approvable on wording alone). Closing the defect then needs **R0b**,
which is a deliberate change to the evidence floor's input and needs its own approval and **P1**. R1 and
R2 remain available if the owner wants the duplicate prevented rather than counted.

**Unresolved and genuinely the owner's:** (1) which option, and whether R0a and R0b are approved
separately; (2) **P1**, since what `sized` should count defines what de-duplicated means; and (3)
whether a legitimate retry after a partial failure should be *possible at all* — R1 forbids it, R0a/R0b
and R2 permit it, and no diagnostic can decide that.

### B2 — Closing rows count toward the standing minimum · `STAT` · **latent (needs `positions` wired)**

`scoreJournal`'s `sized` and `protocol.mjs:54` count `action !== "hold"` only; control, settle and
criterion 7's `due` additionally require `targetPct > 0`. Sixty closes over 90 days give
`meetsStandingMinimum: true` with **zero** possible outcomes (§3, §8.1). **Latent:**
`analyst-run.mjs` never passes `positions`, so `risk.mjs:210` cannot allow a close. Goes live the moment
positions are wired — which a multi-day run needs. **This one has a genuine owner question** (see P1).

### B3 — Out-of-order symbol bars produce a fabricated flat history · `GATE` (eligibility) · **reachable on a vendor panel**

`buildContext`'s truncation `break`s at the first bar past the boundary (`context.mjs:88`), relying on
time order. A future bar at position 1 discards all later history: one bar forward-filled, every return
exactly zero, so `momentum: 0` — **not null** — and the name *ranks* mid-cross-section (§9.4 R1).
**Proposed:** validate per-symbol ordering and **refuse** the symbol rather than rank a fabricated
series; `validateTimestamps()` already detects it (§10.3). **Invariant:** report, do not silently sort —
sorting would hide a vendor defect. **Acceptance:** the scrambled fixture yields `momentum: null` or an
explicit exclusion; the sorted series is unchanged.

### B4 — Duplicate outcome rows double-count and are hidden by both Sets · `STAT` · **reachable today**

`scoreJournal` counts a repeated `(batchId, symbol)` twice in every mean and in `nominalN`; `settle`
reports `already`; criterion 7's Set collapses it so the criterion still passes (§2 D6). Its text says
idempotence "is not computable from a file" — **a repeated key is**, and `duplicateOutcomes()` computes
it. **Proposed:** report duplicate keys in `scoreJournal` and criterion 7; narrow that wording.

### B5 — Malformed grids are accepted silently · `LABEL` → optionally `GATE` · **reachable on a vendor panel**

An unsorted `dates`, a duplicate timestamp, and a non-UTC-midnight stamp are all accepted (§9.3,
§10.4). No price leaks — the time-keyed grid prevents that — but the index space shifts. `runOnce` checks
only `sessionsAhead(dates.at(-1), now)`, so an interior future date is not caught. **Proposed:** report
`validateTimestamps(dates)` at run start; refusing is a separate, larger decision.

### B6 — `settle` and `score` disagree about a record with no `mode` · `STAT` · **latent (hand-edited records only)**

`scoreJournal` and `tier1` use `(r.mode ?? MODE.PAPER)`; `settleOutcomes` uses `r.mode === mode`. Such a
record is scored, counted toward the standing minimum and marked `unsettled` **permanently**, while
`settle` never sees it (§8.1 group). **Latent:** `recordDecision` has defaulted `mode` since
`journal.mjs`'s first commit (`489f2ef`), so only a hand-edited or foreign record produces it.
**Proposed:** give `settleOutcomes` the same tolerance.

### B7 — Direction is never read, so every row is scored long · `STAT` · **latent (needs shorting or a trim)**

`realisedOutcomes` computes `exit/entry - 1` and never consults `action`. Correct today because
`shortingPermitted` defaults false everywhere, but a `sell` with `targetPct > 0` on a held position **is**
allowed and would score as a long entry (§8 L2). **Proposed:** read `action`, or refuse a non-long row,
before shorting or trims are enabled.

---

## C. Reporting items — **not all label-only**

**An earlier draft titled this section "labels and reporting, no gate". That was wrong.** Criterion 1 is
a PASS/FAIL criterion, so changing its numerator or denominator changes a published verdict, and the
`pending` labels feed a **stopping** criterion. Each item is typed individually below.

| # | Item | Type | Why it is that type |
|---|---|---|---|
| **C1** | Criterion 1 counts batches, not distinct sessions | **`STAT`** | Changes criterion 1's numerator and therefore its PASS/FAIL verdict. Five sessions run twice score ratio 2.0 against ten run once at 1.0 (§8.2). Not a stopping criterion, but a published verdict. |
| **C2** | Criterion 1 penalises a published closure | **`STAT`** | Changes the denominator: five batches on all five trading days of a span containing a closure read `expected: 6, ratio: 0.833, FAIL` (§8.2). Also introduces a calendar dependency into a criterion, so **P4** applies. |
| **C3** | A correct refusal reads as a session that never ran | **`LABEL`** if additive | Reporting attempts, successes and refusals as *additional* fields changes nothing computed. **It becomes `STAT` the moment criterion 1's denominator is altered** — so C3 must be approved as additive-only, or merged into C1/C2. |
| **C4** | `pending` conflates inside-the-hold, no-coverage and bad-bars | **`LABEL` or `GATE`** | Splitting the printed label is `LABEL`. **If it changes what criterion 7 counts as `unsettled`, it is a `GATE` change to a STOPPING criterion.** The invariant is that an unsettleable name stays counted against criterion 7 and never leaves `due` (§8.7). Approve the label variant and the gate variant separately. |
| **C5** | Criterion 2's actual coverage is unstated | **`LABEL`** | Readout text only. It verifies the `asOf` label and news timestamps, and nothing about prices or per-symbol freshness (§9.2). The only item here with no computed component at all. |
| **C6** | Unequal position sizes are weighted equally | **`LABEL`** if renaming, **`STAT`** if reweighting | A 10% name at +5% and a 1% name at −5% give 0; portfolio weighting gives +4.09% (§4). Pairs *are* size-matched so the paired difference is sound. Renaming "analyst mean net" is `LABEL`; changing the weighting is `STAT` and changes every published mean. |

**So of the six, two are `STAT` outright (C1, C2), two are conditional (C3, C4), and two are `LABEL`
only unless scope creeps (C5, C6).**

## D. Decisions that are genuinely the owner's

Each was checked against source and the protocol **before** being called a decision.

- **P1. What "50 trades" means in the standing minimum** — measurable decisions, or orders placed. B1
  and B2 are two independent ways the current count diverges from measurable trades. Source does not
  settle it: `PAPER-PROTOCOL.md` says "50 trades" and `scoreJournal`'s `sized` and the settlement path
  disagree about what a trade is.
- ~~**P2. Whether A1–A3 may touch a pre-registered criterion or gate at all.**~~ **REMOVED.** A single
  blanket permission question was the wrong shape: it invited one yes to cover three different
  behaviour changes. Each item now states the **exact requested behaviour** in its own row and needs its
  own yes or no. There is no general grant to ask for.
- **P3. Whether scoring should reset independent periods per registered version.** `FORWARD-EVAL-SPEC.md`
  §4 specifies it, **and that file is a proposal that is explicitly not approved**; the protocol wins
  where they disagree. Neither `scoreJournal` nor `protocol.mjs` reads `analyst/ledger.mjs`, and nothing
  splits on `model` (§8.6). Adopting the spec's semantics is the decision; the machinery already exists.
- **P4. A session calendar beyond 2026–2028, and venues other than NYSE.** Not a decision so much as an
  **ungrounded input** — but whether to depend on a transcribed calendar in a *gate* (A2, C2) is a
  decision, because an ungrounded year must then refuse rather than guess.

---

## E. Dependency order

```
  grounded calendar (DONE, 2026-2028)  ──┬──> A2  holiday refusal        [GATE]
                                         └──> C2  criterion 1 holiday    [STAT]

  grounded calendar (same dep as A2)   ──┬──> A1  criterion 7 dueness     [GATE]
         + decisionTimeMs                  └──> C4  pending labels         [LABEL]

  panel-freshness.mjs (DONE)            ───> A3  paper-mode staleness    [GATE]
                                              (needs an owner choice of option)
  validateTimestamps  (DONE)            ───> B3  refuse a scrambled series[GATE]
                                         └──> B5  grid report            [LABEL]

  A4 (paired readout)  ───> C6 label, and the newsSplit/checklistSplit arms
  B1 rerun guard       ───> P1, B2  (all three are about what `sized` counts)
  independent: B4, B6, B7, C1, C3, C5
```

**Suggested sequence:** C5 (documentation only, no risk) → A4 (statistic, no gate) → **A3** (it blocks
the book existing at all, so nothing downstream is observable until it is settled) → A1 → A2 → C2 → C4 →
B3 → the rest. A1–A3 each need their own approval, and A3 additionally needs a choice among its options.

**A3 is now the first blocker in consequence order**, ahead of A1. A1 halts a run that is otherwise
fine; A3 means the run produces no positions at all, so every other statistic stays empty and none of
the other items can even be observed in practice.

---

## F. What has been completed, and what is still unmeasured

**Completed.** The calendar is grounded for **2026–2028** (§10.1), every supplied date verified
computationally as a weekday, 2028's missing New Year's closure checked against the page's own footnote,
each year's session count reconciled against its own weekday total (251/251/251), year-boundary windows
answered rather than refused, and DST transitions shown not to move a session date under the panel's
UTC-midnight convention. Early closes are recorded as **sessions**, and a test asserts no function
consumes the close times — no intraday feature was added. A1's and A3's contracts are now pinned by
twelve adversarial tests in `acceptance-contracts.test.mjs`, and the two diagnostic helpers those
contracts are written against — `duenessByCalendar()` and `freshnessInformation()` — are offline and
called by nothing in the runtime.

**Still unmeasured.** 2029+ and every non-NYSE venue remain UNKNOWN. Exceptional closures are outside
the source, so a weekday absent from both panel and schedule stays UNKNOWN. A3's dead-symbol frequency
on real IBKR data is unknown until the live panel exists. Nothing in this plan has been implemented.

---

## F2. Version-boundary diagnostic: what it shows, and four limits

`retry-and-version.mjs` part 2 uses `analyst/ledger.mjs` **read-only** on a synthetic journal and ledger
in a temp directory, with every candidate id prefixed `SYNTHETIC-` so it cannot be mistaken for a
registered one. Ten sessions, a prompt change after five, both versions registered.

**`FORWARD-EVAL-SPEC.md` remains a proposal.** Its header says *"Status: proposal. Nothing in this file
is built, scheduled, enabled or approved"*, and the protocol wins on disagreement. Printing a scoped
figure here is a diagnostic comparison, **not an adoption**, and item **P3** is still open.

| | pooled, as scoring reports it today | candidate-scoped, as a diagnostic |
|---|---|---|
| decisions | 10 | 5 |
| outcome rows | 20 | 10 |
| paired rows | 10 | 5 |
| independent periods | **2** | **1** |

**Limit 1 — the journal carries no version identifier.** No decision record has a `candidateId` or a
`version` field (asserted). The ledger knows the boundary; the journal does not reference it. `model`
and `checklistId` happen to differ across the two halves of this fixture and could proxy for a version,
but `contextHash` changes **every session**, so it identifies a batch and not a version. Any scoping
must therefore **join on time**, which leads directly to limit 2.

**Limit 2 — an outcome's `at` is its *settlement* timestamp, so a naive time join misattributes
everything.** `recordsAfterBoundary` keys on `r.at`. Settlement runs days later and, in a batched
`settle`, all at once — so filtering outcome rows by their own `at` put **20 of 20** rows after the
boundary, including the ten the *superseded* version produced. The correct join goes through the parent
decision's `batchId`, which gives 10. **A scoped figure built the naive way would inflate the current
version's evidence twofold.**

**Limit 3 — a decision straddles the boundary.** All five pre-boundary decisions were settled after it,
because `settle` ran once at the end. They belong to the old version by decision time and to the new one
by settlement time, and **nothing in the record resolves which** (asserted). The decision side has a
smaller version of the same problem: `recordsAfterBoundary` keys on `at`, a write timestamp, while
`decisionTimeMs` exists precisely because that differs from the decision bar — so a boundary read off
`at` and one off `asOfTime` need not agree.

**Limit 4 — a matching hash is bookkeeping, not approval.** `driftFromRegistered` correctly reports no
drift against the current version's hashes and `["prompt"]` against the superseded ones, and
`verifyLedger` confirms the chain. None of that is evidence that the candidate's semantics are
owner-approved: registering a version is an act of record-keeping, and a new source, document or hash
value existing does not make scoped scoring an approved rule.

**What the parent-decision join is, and is not.** Joining an outcome to its parent decision's `batchId`
is a **safe way to diagnose attribution** — it is arithmetic over records that already exist, and limit 2
shows the naive alternative is simply wrong. **It is not an adopted scoping rule.** Using it to produce a
scoped figure for reporting, or resetting independent periods per version, remains **unapproved** (item
**P3**); the join being correct says nothing about whether scoped scoring should be adopted.

**What the diagnostic does not do.** It changes no scoring, settlement, protocol, ledger, journal or
runtime behaviour; it registers no real candidate; it rewrites and deletes nothing; and it chooses no
rule for attributing a straddling decision.

## F3. Criteria 3, 5 and 6, and the skip-reason taxonomy

`criteria-semantics.test.mjs` (14 tests), hand-computable temp journals, the risk gate called as a
library function with explicit arguments. **No CLI was launched**, so no SDK was constructed and no lock
taken — the CLI's own argument handling and lock lifecycle remain **untested**, as before.
**Registered meanings are unchanged**: `PAPER-PROTOCOL.md` is pre-registered and this section pins the
implementation against its words. Fixes are proposed separately, typed, below.

### The three verdicts across five scenarios

| scenario | c3 (STOPS) | c5 | c6 (STOPS, MANUAL) |
|---|---|---|---|
| absent run — empty journal | **PASS** `{stale:0,future:0}` | FAIL `{total:0}` | MANUAL `{toReview:0}` |
| two safe refusals, no decision | **PASS** `{stale:1,future:1}` | FAIL `{total:0}` | MANUAL `{toReview:0}` |
| decided anyway, beside a stale refusal | **PASS** `{stale:1,future:0}` | FAIL `{total:0}` | MANUAL `{toReview:1}` |
| **A3: every proposal rejected** | **PASS** | **PASS** `{total:10, stale_quote:10}` | MANUAL `{toReview:0}` |
| clean book, zero rejections | **PASS** | **FAIL** `{total:0}` | MANUAL `{toReview:5}` |

### Criterion 3 — a stopping criterion that cannot fail

Registered: *"Panel freshness never silently degrades / zero paper batches on a stale or future-dated
panel."* The implementation passes **`PASS` as a literal**, not a condition (`protocol.mjs`, branch 3),
and **never compares any batch against a panel**. It counts the two skip reasons and asserts the zero
structurally, on the stated grounds that the guards throw before a batch exists.

**Consequence:** absent run, safe refusal and a batch that decided alongside a stale refusal all read
**PASS**. The `numbers` differ, so the information exists — the verdict never uses it. **A guard
regression, or a record written by any route other than `runOnce`, would not move this criterion.** This
is a *vacuous pass* on a stopping criterion, and it is the sharpest finding here.

**Fail-closed vs diagnostic:** today it is neither. It is a diagnostic reported in the slot of a
stopping criterion.

### Criterion 5 — satisfied in both of the two ways the gate can be useless

Registered: *"The risk gate is load-bearing, not decorative / rejections occur, and every code is one we
can explain."*

**Yes — under A3's all-rejected book it reads PASS**, with `total: 10`, `codes: {stale_quote: 10}`,
`unexplained: []`. The registered words are *literally satisfied*: rejections occurred and the code is
one `risk.mjs` defines. So **the implementation is faithful to the words; the mismatch is between the
words and the criterion's own title.** A gate rejecting 100% of proposals is not load-bearing — it is
inert in the other direction.

It also passes on **one** rejection, including a single `halted`, and on a batch rejected entirely for
**want of usable risk input** (`no usable NAV` → `malformed_proposal`, a known code) — a case where no
risk limit was evaluated at all. And it **FAILS** on a clean book with zero rejections, where the detail
string itself says the reading is ambiguous: *"Either nothing was ever out of bounds, or the gate is not
being reached."* So PASS and FAIL both occur for reasons opposite to the name.

### Criterion 6 — a pre-outcome count, vacuous when the book is empty

Registered: *"No proposal reached the book that the gate should have caught / manual review of all
allowed positions, zero escapes."* It is `MANUAL` always, so it never stops automatically, and it counts
`sizedAllowed` **at decision time, before any outcome exists** — which is correct for its purpose.

Under an empty book it prints *"manual review of all 0 allowed position(s)"*. **Nothing to review is not
the same as no escapes**, and the readout does not distinguish them. Its count also includes a
`targetPct: 0` closing row, which can never be settled, and criterion 8's news denominator uses the same
set.

### The skip-reason taxonomy — an asymmetry with rejects and failures

`SKIP_REASON` defines three codes and **`runOnce` emits all three** (asserted against `loop.mjs`), so the
enum is fully exercised by the refusal paths. But:

- `recordSkip` does `String(reason)` with **no validation**. An unknown string, `undefined` and an object
  persist as `"some_new_reason_nobody_defined"`, `"undefined"` and `"[object Object]"`.
- `protocol.mjs` validates reject codes against `REJECT` and failure codes against `BATCH_FAILURE`.
  **There is no equivalent set for skip reasons** (asserted: no `KNOWN_SKIP` anywhere).
- So an unknown reason is **invisible to criteria 2 and 3 — both stopping criteria** — counted raw by
  criterion 10 (MANUAL), **and it extends criterion 1's denominator while adding nothing to its
  numerator**, turning three malformed skips into `ratio: 0, FAIL`.

A *known* reason works correctly: a `context_not_point_in_time` skip makes criterion 2 FAIL and stop. **So
the gap is specifically the unknown case**, and an unknown *failure* code is caught by criterion 4 while
an unknown *skip* reason is not.

### Proposed fixes — separate, typed, none approved

| # | Fix | Type | Acceptance test |
|---|---|---|---|
| **S1** | Criterion 3 verifies rather than asserts: FAIL if any decision's `asOfTime` is behind the panel's newest session, or ahead of it, using the same guard arithmetic. | **`GATE` (STOP)** | The "decided anyway" fixture reads **FAIL**; the absent run and safe-refusal fixtures read PASS with their counts intact; a clean run is unaffected. |
| **S2** | Criterion 3 distinguishes the three states in its detail and numbers: no run, refused, decided. | `LABEL` | Each of the three fixtures prints a distinguishable detail; no verdict changes. |
| **S3** | Criterion 5 reports the **rejection rate** beside the count, and says explicitly that an all-rejected book satisfies the words while meaning the gate admitted nothing. Registered words unchanged. | `LABEL` | The A3 fixture still reads PASS, with a printed rate of 100% and the caveat; the clean-book fixture still FAILs with its existing wording. |
| **S4** | Criterion 6 states `toReview: 0` as *"no allowed position exists to review"* rather than leaving a reviewer to read it as zero escapes. | `LABEL` | The empty-book fixture's detail is unambiguous; `toReview` is unchanged. |
| **S5** | Add `KNOWN_SKIP_REASONS` and report an unknown reason, mirroring criteria 4 and 5. | `STAT` | The three malformed-reason skips are reported as unknown; a known reason is unaffected; criteria 2 and 3 verdicts unchanged. |
| **S6** | `recordSkip` rejects a reason not in `SKIP_REASON` instead of coercing it. | `GATE` (a write refusal) | `recordSkip` throws on `undefined`, an object and an unknown string; all three defined reasons still write. **Note: this makes a journal write fail, so it needs its own approval.** |

**S1 is the only one that changes a verdict.** S3, S4 and S2 are wording; S5 adds a reported figure; S6
changes a write path. **None is implemented, and none is approved.**

### Limits

- **Operational correctness, realised evidence and vacuous pass are three different things**, and these
  criteria mix them: criterion 3 reports operational health in a stopping slot, criterion 5's words
  measure *that rejections happened* rather than *that the gate is useful*, and criterion 6 is a
  pre-outcome manual prompt. Separating them is a protocol question, not a code one.
- **The CLI remains untested here** — launching it would construct an SDK client and take the real lock.
- Nothing above tells you whether the gate's *thresholds* are right; that was never in scope.

## F4. Criteria 4 and 8: provenance and the news denominator

`criteria-semantics.test.mjs` is now 24 tests. Registered meanings untouched.

### Criterion 4 — "< 10% of batches lost to refusal, truncation or malformed JSON"

**A known limitation, confirmed and bounded.** The criterion's own detail already says *"Batches
written before the failure code was journalled read as successes"*, so this is documented, not
undiscovered. What is new is where the line falls:

| record shape | `d.failure` | counted as | recoverable from the record? |
|---|---|---|---|
| `failure: null` (modern success) | falsy | success | **yes** — the key is present |
| no `failure` key (pre-field record) | falsy | success | **yes** — `"failure" in d` is false |
| `{code: <known>}` | truthy | failure, code known | yes |
| `{code: <unknown>}` | truthy | failure, **FAIL** | yes |
| `{}` or `{code: null}` | truthy | failure, code `"undefined"`/`"null"`, **FAIL** | yes — **fails closed** |
| `false`, `""`, `0` | falsy | **success** | only as "key present but not a failure object" — **fails open** |

**What can honestly be asserted** from the current fields is *"no journalled batch carries a failure
code"*, which is weaker than *"every batch produced parseable output"*. The discriminator is the
**presence of the key**, and nothing uses it.

**The denominator is journalled decisions, not sessions attempted.** A panel refusal leaves a *skip*, so
a batch lost before `decide` ran is not in the denominator: one skip plus one failed decision reports
`batches: 1, lossRate: 1` — 100% of journalled batches, 50% of sessions. Faithful to the registered word
"batches"; not a measure of sessions. And with no batches at all it reads **MANUAL**, not a vacuous pass.

### Criterion 8 — "≥ 60% of sized decisions carry `hadNews: true`"

**Faithful to its words.** It measures **selected-name coverage** over allowed non-hold rows, which is
what the registered criterion says. Three notions must be kept apart:

| notion | recorded? | read by criterion 8? |
|---|---|---|
| **feed availability** — `record.news` meta (`source`, `fetchedAt`, `ageHours`, `stale`, `droppedAtBoundary`) | **yes**, per batch | **no** — asserted, its branch never touches `.news` |
| **input coverage** — how much of the slate shown carried news | **no** — the candidate list is not stored, and a news-carrying name that was never proposed leaves no trace | not computable at all |
| **selected-name coverage** — `hadNews` on allowed non-hold rows | yes | **yes** |

**It cannot distinguish a broken feed from a gate that rejected everything.** With all proposals
rejected, `sized: 0`, `rate: null`, **MANUAL** — numbers identical to a run with no feed at all, even
though the rejected name *did* carry news and the meta block records a healthy feed.

Two behaviours confirmed correct rather than defective: an **unrecorded** `hadNews` counts in the
denominator and **against** the rate (fail-closed, and the detail says so); and the criterion is
**robust to a duplicated retry** — numerator and denominator double together so the rate is unchanged,
unlike criterion 1 and `sized`.

One carried-forward interaction: a `targetPct: 0` **close** is in the denominator, so a close with no
news drags the rate down even though it can never be settled.

### Proposed fixes — typed, none approved, none rewrites history

| # | Fix | Type | Acceptance test |
|---|---|---|---|
| **S7** | Criterion 4 reports how many batches *can* speak to their own success (`"failure" in d`) beside the loss rate, so an unknown-provenance record is visible rather than silently successful. **No record is rewritten and no success is inferred from a missing field** — a record without the key counts as *unknown provenance*, not as a pass. | `STAT` | The modern/old fixture reports `batches: 2, withProvenance: 1`; `lossRate` and the verdict are unchanged. |
| **S8** | Criterion 4 treats a **falsy non-null** `failure` as malformed rather than as success. | `STAT` | The `false`/`""`/`0` fixture moves those three from success to unknown-code failures; valid `null` is unaffected. |
| **S9** | Criterion 8 reports the recorded feed meta beside the rate, so an empty book and a dead feed are distinguishable. **Registered words and the 60% floor unchanged.** | `LABEL` | The all-rejected fixture still reads MANUAL with `rate: null`, and the detail now names the feed's `source`/`stale`/`ageHours`. |

**S7's migration note:** the only honest migration is additive. A record with no `failure` key cannot be
retro-labelled a success or a failure, because the information was never written; it can only be counted
as unknown. Nothing in S7 or S8 edits a stored record.

---

## F5. Finite coverage inventory — all ten registered criteria and the first-run boundaries

**This is a map of what has been tested, not a readiness claim.** Green tests prove the fixtures behave
as described; they do not prove the system is ready to run. Three exclusions apply to every row:

- **No CLI path is tested anywhere.** Launching `analyst-run.mjs` would construct an SDK client and take
  the real journal lock, so argument handling, mode dispatch, lock acquisition and release, and signal
  handling are **untested**.
- **No SDK, model, key or broker path is tested.** Every decider is a plain stub object.
- **Synthetic timestamp assumption.** Fixtures stamp bars at `00:00:00Z` of the session date, matching
  the real bundle (0 of 921 misaligned). `analyst/loop.test.mjs`'s own `panel()` helper stamps its last
  bar at `now` instead, which is why the pre-existing suite does not see the A3 quote-age defect
  (§H). **Conclusions drawn from fixtures using the `now` convention do not transfer to a real panel.**

| # | Criterion | Current behaviour tested | Named fixture | Unresolved |
|---|---|---|---|---|
| 1 | Runs every session | counts batches not sessions; a closure depresses the ratio; a refusal reads as a no-run | `journal-rerun-coverage.test.mjs` "criterion 1 counts BATCHES", "FAILS on a span containing a market holiday", "a correct refusal reads the same" | whether distinct sessions or batches is intended (C1) |
| 2 | Point-in-time (STOPS) | verifies the `asOf` label and news dates only; prices and per-symbol freshness are outside it | `context-ragged.test.mjs` "contextIsPointInTime verifies the asOf LABEL" | — (scope now documented, C5) |
| 3 | Panel freshness (STOPS) | **hardcoded PASS**; cannot distinguish absent run, safe refusal or decided-anyway | `criteria-semantics.test.mjs` "is hardcoded PASS", "cannot distinguish" | S1 approval |
| 4 | Output parseable | absent vs null provenance; truthy-malformed fails closed, falsy-malformed fails open; denominator is journalled decisions | `criteria-semantics.test.mjs` "an absent failure field and an explicit null", "malformed TRUTHY… FALSY", "denominator is journalled DECISIONS" | S7, S8 approval |
| 5 | Gate load-bearing | PASSES on an all-rejected book, on one `halted`, and on a no-NAV batch; FAILS on a clean book | `criteria-semantics.test.mjs` four C5 tests | S3 approval; the title-vs-words gap is a protocol question |
| 6 | No gate escape (STOPS) | MANUAL always; pre-outcome count; `toReview: 0` on an empty book; includes a close | `criteria-semantics.test.mjs` two C6 tests | S4 approval |
| 7 | Settlement (STOPS) | calendar-day dueness fails over a weekend; an uncovered name fails forever | `journal-rerun-coverage.test.mjs` "STOPS the run over a weekend"; `acceptance-contracts.test.mjs` six A1 contracts | A1 approval, P4 |
| 8 | News reaches decisions | selected-name coverage only; feed meta recorded and unread; input coverage unrecordable; robust to a retry | `criteria-semantics.test.mjs` six C8 tests | S9 approval |
| 9 | Theses reviewable | **not tested.** MANUAL, and it counts `proposals[].thesis` — a string count, which is what it says it is | — | nothing demonstrated; no fixture would add information |
| 10 | Nothing halts unexpectedly | counts halts, brakes, skips, notes; an unknown skip reason is counted here and nowhere else | `criteria-semantics.test.mjs` "an unknown reason is invisible to both STOPPING criteria" | S5, S6 approval |

**First-run boundaries** (`rehearsal.mjs`, §H): preflight, context, risk, record, settle, score and
protocol are each exercised with a stub decider and a temp journal. The gate boundary is the blocker
(A3). Not exercised: the CLI, the lock, and any live interface.

**Runtime remediation still awaiting approval:** A1–A4, B1 (R0a/R0b/R1/R2), B2–B7, C1–C6, S1–S9. **None
is implemented.** `docs/FORWARD-EVAL-SPEC.md` remains a proposal and item **P3** is open.

**Offline work that is now closed**, and should not be re-audited: the calendar grounding and
session reconciliation (§10), ragged-panel point-in-time and criterion 2's scope (§9), the
paired/unpaired statistic cluster (§2, §8.5), the retry contract (§B1, F2 part 1), the version boundary
(F2 part 2), and criteria 3/5/6/4/8 (F3, F4).

### The one critical path still untested, as a bounded unit

**`recordOutcome`'s own field validation.** Every settlement figure flows through it, and
`journal-completeness.test.mjs` covers duplicates and orphans but not the field shapes: a `netReturn` of
`"0.05"`, `Infinity` or `null` is written as given, and `scoreJournal` filters with
`typeof v === "number"`, so a string silently disappears from a mean while still counting in `outcomes`.
That is one focused unit — not a re-audit — and it is the last place a wrong number could enter the
record unexamined.

## G. Review sheet for the coordinating thread

Plain language, one line of consequence each. **Nothing here is approved, and this is not a
pull-request description.** Each item needs its own yes or no.

**Read the two columns carefully, because an earlier draft conflated them:**

- **Unresolved dependency** — is there a *semantic* question that must be answered before the item can
  even be specified? "None" here means the item is fully specified. **It does not mean the item needs no
  approval.**
- **Approval** — **every item that changes a runtime statistic or gate needs item-specific approval,
  without exception.** Only the pure-label items can proceed on a single yes about wording.

| # | In plain terms | Fires when | Type | Unresolved dependency | Approval |
|---|---|---|---|---|---|
| **A3** | **The paper run logs no allowed decisions — an empty simulated book.** Every proposal is rejected as a stale quote: a daily bar is ~38h old and the limit is 15 minutes. This is a log-only run, so **no broker order is involved either way**. | First paper run | `GATE` | **Yes** — P4, plus the eligible-universe tradeoff in A3's own row | **Required** |
| **A1** | A stopping criterion halts the run over a weekend while settlement is behaving correctly. | First weekend | `GATE` (STOP) | **Yes** — P4 | **Required** |
| **A2** | A market holiday makes the run refuse a session, one per holiday. | First holiday | `GATE` | **Yes** — P4 | **Required** |
| **A4** | The headline edge is printed beside an interval computed from different rows, and can land outside it. | First settled control gap | `STAT` | None | **Required** |
| **B1** | Running the same session twice doubles the trade count the evidence floor gates on. **Reachable today.** Outcome rows, paired counts and periods are already safe, so only the decision-side count needs fixing. | An operator retries | `STAT` | **Yes** — P1, plus which of R0–R3 (R0 preferred) and whether a retry after a partial failure should be possible at all | **Required** |
| **B2** | Position closes count toward the evidence floor but can never be measured. | Once positions are wired | `STAT` | **Yes** — P1 | **Required** |
| **B3** | A vendor series in the wrong order is ranked on a fabricated flat history instead of refused. | A vendor panel | `GATE` (eligibility) | None | **Required** |
| **B4** | A duplicated settlement row is counted twice and hidden from the criterion meant to catch it. | A double append | `STAT` | None | **Required** |
| **B5** | Unsorted, duplicated or misaligned grids are accepted silently. | A vendor panel | `LABEL`, or `GATE` if it refuses | None for the report; yes for a refusal | **Required for a refusal** |
| **B6** | `settle` and scoring disagree about a record with no mode. | Hand-edited records | `STAT` | None | **Required** |
| **B7** | Direction is never read, so every row is scored long. | Shorting or a trim | `STAT` | None | **Required** |
| **C1** | Criterion 1 counts batches, so half the sessions run twice scores *higher*. | Any rerun | **`STAT`** | **Yes** — overlaps B1 | **Required** |
| **C2** | Criterion 1 fails a perfect run whose span contains a holiday. | First holiday in span | **`STAT`** | **Yes** — P4 | **Required** |
| **C3** | A correct refusal looks like a session that never ran. | First refusal | `LABEL` if additive, `STAT` if the denominator moves | None if additive only | **Required if not additive** |
| **C4** | `pending` conflates inside-the-hold, no-coverage and bad-bars — and feeds a **stopping** criterion. | First incomplete hold | `LABEL` **or `GATE`** | None for the label; yes for the gate | **Required separately for each variant** |
| **C5** | Criterion 2's actual scope is unstated, so "point-in-time integrity holds live" reads as covering prices. | Reporting only | `LABEL` | None | Wording only |
| **C6** | "Analyst mean net" does not say it is equal-weighted across unequal sizes. | Reporting only | `LABEL` renaming, **`STAT`** if reweighted | None for renaming | Wording only; **required if reweighted** |
| **P1** | Does "50 trades" mean measurable decisions or orders placed? | — | Defines the floor | — | **Owner decision** |
| **P3** | Should scoring reset independent periods per registered version? The spec proposing it is **not approved**. | — | `STAT` | — | **Owner decision** |
| **P4** | May a gate depend on a transcribed calendar, given an ungrounded year must then refuse? | — | Permission | — | **Owner decision** |

**Read A3 first** — but the reason is narrower than an earlier draft claimed. A3 blocks every
**realised-selection** figure, because those need a settled outcome: `edge`, `edgeCI`, `hitRate`,
`beatControlRate`, the paired counts and the news/checklist splits. It does **not** block the
**decision-side and operational** figures, which are observable with an empty book and were observed in
§H: `batches`, `sized`, `rejectCounts`, criterion 1's ratio, the repeated-batchId count, skip accounting
and session coverage. So **B1, C1, C2, C3 and B5 can be exercised in a real run before A3 is settled**;
A4, B4, B7 and the rest of the outcome-side items cannot.

---

## H. First-forward-run rehearsal: the actionable checklist

`rehearsal.mjs` walks input preflight → context → risk → record → settle → score → protocol on a
synthetic panel of midnight-stamped daily bars, with a **stub decider** (a plain object, no SDK) and a
**temporary journal**. It prints today's behaviour beside each acceptance contract.

**What it did not do, and must not be read as evidence of:** it does not launch `analyst-run.mjs`, so no
CLI argument handling, mode dispatch or journal lock was exercised; it constructs no model client and
reads no key; it touches no broker path; and it **fixes nothing** — every failure below is current
behaviour. These are synthetic decisions in paper *mode*, which are not forward evidence and cannot
become a track record. Two tests assert the import graph never reaches the CLI, the SDK, the key, the
lock or any `ibkr-*` module, and that the real journal is byte-identical afterwards.

| # | Boundary | Today | Contract |
|---|---|---|---|
| 1 | Grid shape | clean — but **nothing in the runtime validates it** | report at run start (B5) |
| 1 | Session coverage | 188 expected / 188 observed, 0 missing, 0 on a closure. Adversaries: one session missing for every symbol stays listed; a bar on a published closure is named | sourced where grounded, UNKNOWN counted outside |
| 1 | Per-symbol freshness | **FAIL** — 2 symbols have no bar at the decision session (19 and 297 sessions stale) and nothing consults this | the gate consults it (A3) |
| 2 | Point-in-time | 0 issues — verifies the `asOf` label and news dates only | unchanged, scope stated (C5) |
| 2 | Slate membership | **FAIL** — all 4 symbols shown, including the two stale ones | a symbol with no bar at the decision session is excluded or flagged |
| 2 | Paper staleness guard | `missedSessions = 0`, proceeds | a published closure is not a missed session (A2) |
| 3 | Quote age | **FAIL** — 37.8h for **every** symbol against a 15-minute limit | the limit applies to an actual quote, which a daily panel does not carry |
| 3 | Gate outcome | **FAIL** — **allowed 0 of 2**, both `stale_quote` | a symbol with a bar at the decision session is allowed; one without is rejected |
| 4 | Batch recorded | **FAIL** — journalled with `allowed = 0`, `control = 0` | a non-empty book with one control per sized decision |
| 4 | Same-session retry | **FAIL** — 2 records, 1 session, **1 batchId**, 1 repeated | the duplicate is visible in the counts, under **whichever of B1's proposed options R0a/R0b/R1/R2 is approved — none is selected**; two distinct batches must stay one period |
| 4 | No-decision batch | recorded, distinguishable from a run that never fired | unchanged |
| 4 | Short control pool | **FAIL** — 1 slot for 2 sized decisions; the **tail** goes unpaired, positionally | unpaired rows reported, paired count printed (A4) |
| 5 | Settlement | `wrote 0` — correct, since the book is empty | `pending` split three ways (C4) |
| 6 | Headline edge | `—` throughout, because nothing settled | paired estimate beside its own interval (A4) |
| 7 | Criterion 1 | **FAIL against contract** — reads PASS at `ratio: 2` from a **single** session | distinct sessions, closures subtracted (C1, C2) |
| 7 | Criterion 7 (STOPS) | PASS, `due: 0` — and expected-session dueness agrees (`due: false`, 2 of 5 elapsed) | dueness from expected sessions (A1) |
| 8 | Session after a closure | **FAIL** — `missedSessions = 1`, paper mode refuses | a published closure is not a missed session (A2) |

**The cascade, stated precisely.** The gate rejects every proposal, so the journal records an empty
simulated book (no broker order is placed in this mode at all), so nothing settles, so every
outcome-derived score is `—`.

**What that does and does not block.** It blocks the **realised-selection** figures — `edge`, `edgeCI`,
`hitRate`, `beatControlRate`, paired counts, the splits — and therefore A4, B4 and B7 cannot be
exercised against a real run. It does **not** block the **decision-side and operational** figures: §H
observed criterion 1 at `ratio: 2` and B1's repeated batchId *with* an empty book, and `sized`,
`rejectCounts`, skip accounting, session coverage and grid validation are all equally observable. **A3
leads the sequence because it is the largest single defect and gates the outcome half, not because
nothing else is measurable.**

**Checklist before a first forward run**, in order, each needing its own approval:

1. **A3** — otherwise the run logs no allowed decisions and the simulated book stays empty, so no
   realised selection outcome can ever exist. Verify: a fresh symbol is allowed, a stale one rejected,
   one with no bar rejected, and the dry-run path unchanged.
2. **A1** — otherwise a stopping criterion halts the run on day 5–7.
3. **A2** — otherwise the first holiday costs a session and writes a `PANEL_STALE` skip.
4. **A4** — otherwise the first settled batch with a control gap misreports the headline.
5. **B1** — otherwise an operator retry silently doubles the count the evidence floor uses.
6. **C5** — wording only, and it removes a reading of criterion 2 that the code does not support.

Everything else can follow the first run, since each is either reporting-only or needs wiring that does
not yet exist.
