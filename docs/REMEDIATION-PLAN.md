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

`runOnce` reads nothing from the journal; `defaultBatchId` is `mode-YYYY-MM-DD` (`loop.mjs:293`) and the
CLI passes no `batchId`. A second paper run on one session appends a second decision under the **same**
id, doubling `batches`, `sized`, `rejectCounts`, `halts`, `brakes` and criterion 1's numerator while
`outcomes` and `periods` stay put (§8.1). `meetsStandingMinimum` gates on `sized >= 50`, so fifty
*measurable* trades can be claimed after twenty-five doubled sessions. The lock guards concurrent runs,
not sequential ones. **REACHABLE TODAY — not latent.** It needs no wiring change, only a second `node analyst-run.mjs paper`
on the same session, which an operator retrying after a transient failure would do naturally. It is in
this section because it is not *automatic*, not because it is blocked.
**Proposed:** refuse — or record as superseding — a decision at an `asOfTime` already journalled in that
mode. **Invariant: two *distinct* batchIds at one session is a legitimate designed experiment and must
still count as one period** (asserted in §8.1). **Acceptance:** the rerun fixture produces one counted
batch or an explicit skip; the two-arm fixture is unaffected.

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
| **A3** | **The paper run would buy nothing.** Every proposal is rejected as a stale quote: a daily bar is ~38h old and the limit is 15 minutes. | First paper run | `GATE` | **Yes** — P4, plus the eligible-universe tradeoff in A3's own row | **Required** |
| **A1** | A stopping criterion halts the run over a weekend while settlement is behaving correctly. | First weekend | `GATE` (STOP) | **Yes** — P4 | **Required** |
| **A2** | A market holiday makes the run refuse a session, one per holiday. | First holiday | `GATE` | **Yes** — P4 | **Required** |
| **A4** | The headline edge is printed beside an interval computed from different rows, and can land outside it. | First settled control gap | `STAT` | None | **Required** |
| **B1** | Running the same session twice doubles the trade count the evidence floor gates on. **Reachable today.** | An operator retries | `STAT` | **Yes** — P1 | **Required** |
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

**Read A3 first.** Until it is settled the paper run produces an empty book, so none of the other
numbers can be observed at all — demonstrated in §H.

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
| 4 | Same-session retry | **FAIL** — 2 records, 1 session, **1 batchId**, 1 repeated | refused or marked superseding; two distinct batches stay one period (B1) |
| 4 | No-decision batch | recorded, distinguishable from a run that never fired | unchanged |
| 4 | Short control pool | **FAIL** — 1 slot for 2 sized decisions; the **tail** goes unpaired, positionally | unpaired rows reported, paired count printed (A4) |
| 5 | Settlement | `wrote 0` — correct, since the book is empty | `pending` split three ways (C4) |
| 6 | Headline edge | `—` throughout, because nothing settled | paired estimate beside its own interval (A4) |
| 7 | Criterion 1 | **FAIL against contract** — reads PASS at `ratio: 2` from a **single** session | distinct sessions, closures subtracted (C1, C2) |
| 7 | Criterion 7 (STOPS) | PASS, `due: 0` — and expected-session dueness agrees (`due: false`, 2 of 5 elapsed) | dueness from expected sessions (A1) |
| 8 | Session after a closure | **FAIL** — `missedSessions = 1`, paper mode refuses | a published closure is not a missed session (A2) |

**The cascade is the point.** The gate rejects every proposal, so the journal records an empty book, so
nothing settles, so every score is `—` and every downstream criterion is trivially satisfied. **A1, A4,
B1 and the rest cannot be observed in a real run until A3 is settled**, which is why A3 leads the
sequence in §E.

**Checklist before a first forward run**, in order, each needing its own approval:

1. **A3** — otherwise the run buys nothing. Verify: a fresh symbol is allowed, a stale one rejected, one
   with no bar rejected, and the dry-run path unchanged.
2. **A1** — otherwise a stopping criterion halts the run on day 5–7.
3. **A2** — otherwise the first holiday costs a session and writes a `PANEL_STALE` skip.
4. **A4** — otherwise the first settled batch with a control gap misreports the headline.
5. **B1** — otherwise an operator retry silently doubles the count the evidence floor uses.
6. **C5** — wording only, and it removes a reading of criterion 2 that the code does not support.

Everything else can follow the first run, since each is either reporting-only or needs wiring that does
not yet exist.
