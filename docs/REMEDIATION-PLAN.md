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

| | |
|---|---|
| **Consequence** | A stopping criterion reads FAIL while settlement is behaving correctly. Halts a run that is fine. |
| **Path** | `analyst/protocol.mjs:156` — `now - Date.parse(d.at) >= hold * 86400000` |
| **Reachable** | **Yes, immediately.** Calendar days outrun trading sessions across any weekend. |
| **Evidence** | §2 D4; `journal-rerun-coverage.test.mjs` "criterion 7 STOPS the run over a weekend". Thursday decision, 5-session hold, read the following Tuesday: `settle` writes 0, criterion 7 FAILs with `due: 1, unsettled: 1, stops: true`. |
| **Proposed** | Take dueness from `decisionTimeMs(d)` (already imported in that file, used by criterion 1) and count **sessions the panel contains after the decision bar** — the panel's own calendar, not per-name bar availability. |
| **Invariants** | **Dueness ≠ coverage** (§8.7). A name due by the panel calendar but missing its own bars stays `due` and stays failing; it must never be excluded to make the criterion pass. Fail-closed: an unparseable `at` must not become "not due". |
| **Acceptance** | The weekend fixture passes; the §8.7 fixture (symbol with 2 bars in a 19-session panel) still reads `due: 1, unsettled: 1, FAIL, stops: true`; a replayed journal whose `at` values share one minute no longer reads `due: 0`. |
| **Depends on** | Nothing. The helper exists. |

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

### A3 — A dead-but-present symbol is sized at a stale price · `GATE`

| | |
|---|---|
| **Consequence** | A delisted, halted or unresolved symbol is shown to the analyst with a finite momentum, passes the risk gate, and is sized from a price that may be hundreds of sessions old. |
| **Path** | `analyst/loop.mjs` `instrumentsFromContext` (`quoteAgeMs` from `asOfTime`); gate check `analyst/risk.mjs:221` against `maxQuoteAgeMs` |
| **Reachable** | **Yes on a live panel.** The research bundle is rectangular (§10.2: 0 stale symbols), so it has never fired here — a ragged IBKR pull is the expected trigger. |
| **Evidence** | §9.4 R2; `context-ragged.test.mjs` "a symbol dead for 200 sessions … PASSES the risk gate" — `quoteAgeMs` identical to a live name, zero rejections, sized from the 200-session-old close. |
| **Proposed** | Derive `quoteAgeMs` from **the symbol's own last bar**, not the decision bar. `panel-freshness.mjs` `symbolFreshness()` already computes `lastBarAtOrBefore`, `sessionsSinceLastBar` and `forwardFilledAtDecision`. |
| **Invariants** | **A forward-filled grid value is not a quote.** Point-in-time must not regress: the measure reads bars at or before the decision only (asserted by the next-bar perturbation test). Fail-closed — a symbol with no usable bar must be rejected, not treated as age 0. |
| **Acceptance** | The 200-session fixture is rejected `stale_quote`; a fresh symbol is unaffected; the research panel's 127 symbols all still pass (0 are stale, so no behaviour change there); the next-bar perturbation test still holds. |
| **Depends on** | `panel-freshness.mjs` (**built**, §10) being promoted from diagnostic to a runtime input — which is itself the gate change, so it needs explicit approval. |

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

## B. Latent defects — real in the code, blocked by current wiring

### B1 — No same-session rerun guard · `STAT` (and a gate *input*)

`runOnce` reads nothing from the journal; `defaultBatchId` is `mode-YYYY-MM-DD` (`loop.mjs:293`) and the
CLI passes no `batchId`. A second paper run on one session appends a second decision under the **same**
id, doubling `batches`, `sized`, `rejectCounts`, `halts`, `brakes` and criterion 1's numerator while
`outcomes` and `periods` stay put (§8.1). `meetsStandingMinimum` gates on `sized >= 50`, so fifty
*measurable* trades can be claimed after twenty-five doubled sessions. The lock guards concurrent runs,
not sequential ones. **Reachable by an operator today**; listed here because it needs a person to rerun.
**Proposed:** refuse — or record as superseding — a decision at an `asOfTime` already journalled in that
mode. **Invariant: two *distinct* batchIds at one session is a legitimate designed experiment and must
still count as one period** (asserted in §8.1). **Acceptance:** the rerun fixture produces one counted
batch or an explicit skip; the two-arm fixture is unaffected.

### B2 — Closing rows count toward the standing minimum · `STAT`

`scoreJournal`'s `sized` and `protocol.mjs:54` count `action !== "hold"` only; control, settle and
criterion 7's `due` additionally require `targetPct > 0`. Sixty closes over 90 days give
`meetsStandingMinimum: true` with **zero** possible outcomes (§3, §8.1). **Latent:**
`analyst-run.mjs` never passes `positions`, so `risk.mjs:210` cannot allow a close. Goes live the moment
positions are wired — which a multi-day run needs. **This one has a genuine owner question** (see P1).

### B3 — Out-of-order symbol bars produce a fabricated flat history · `GATE` (eligibility)

`buildContext`'s truncation `break`s at the first bar past the boundary (`context.mjs:88`), relying on
time order. A future bar at position 1 discards all later history: one bar forward-filled, every return
exactly zero, so `momentum: 0` — **not null** — and the name *ranks* mid-cross-section (§9.4 R1).
**Proposed:** validate per-symbol ordering and **refuse** the symbol rather than rank a fabricated
series; `validateTimestamps()` already detects it (§10.3). **Invariant:** report, do not silently sort —
sorting would hide a vendor defect. **Acceptance:** the scrambled fixture yields `momentum: null` or an
explicit exclusion; the sorted series is unchanged.

### B4 — Duplicate outcome rows double-count and are hidden by both Sets · `STAT`

`scoreJournal` counts a repeated `(batchId, symbol)` twice in every mean and in `nominalN`; `settle`
reports `already`; criterion 7's Set collapses it so the criterion still passes (§2 D6). Its text says
idempotence "is not computable from a file" — **a repeated key is**, and `duplicateOutcomes()` computes
it. **Proposed:** report duplicate keys in `scoreJournal` and criterion 7; narrow that wording.

### B5 — Malformed grids are accepted silently · `LABEL` → optionally `GATE`

An unsorted `dates`, a duplicate timestamp, and a non-UTC-midnight stamp are all accepted (§9.3,
§10.4). No price leaks — the time-keyed grid prevents that — but the index space shifts. `runOnce` checks
only `sessionsAhead(dates.at(-1), now)`, so an interior future date is not caught. **Proposed:** report
`validateTimestamps(dates)` at run start; refusing is a separate, larger decision.

### B6 — `settle` and `score` disagree about a record with no `mode` · `STAT`

`scoreJournal` and `tier1` use `(r.mode ?? MODE.PAPER)`; `settleOutcomes` uses `r.mode === mode`. Such a
record is scored, counted toward the standing minimum and marked `unsettled` **permanently**, while
`settle` never sees it (§8.1 group). **Latent:** `recordDecision` has defaulted `mode` since
`journal.mjs`'s first commit (`489f2ef`), so only a hand-edited or foreign record produces it.
**Proposed:** give `settleOutcomes` the same tolerance.

### B7 — Direction is never read, so every row is scored long · `STAT`

`realisedOutcomes` computes `exit/entry - 1` and never consults `action`. Correct today because
`shortingPermitted` defaults false everywhere, but a `sell` with `targetPct > 0` on a held position **is**
allowed and would score as a long entry (§8 L2). **Proposed:** read `action`, or refuse a non-long row,
before shorting or trims are enabled.

---

## C. Planning refinements — labels and reporting, no gate

- **C1. Criterion 1 counts batches, not distinct sessions**, so five sessions run twice score ratio 2.0
  against ten sessions run once at 1.0 (§8.2). It does not stop the run. **Proposed:** count distinct
  decision sessions; keep the batch count beside it.
- **C2. Criterion 1 penalises a market holiday** — five batches on all five trading days of a span
  containing a closure read `expected: 6, ratio: 0.833, FAIL` (§8.2). Same dependency and the same
  invariant as A2: within grounded coverage subtract published closures; outside it, leave the expected
  set **UNKNOWN** and say so rather than substituting a weekday count.
- **C3. A correct refusal reads as a session that never ran** (§8.3). A skip is not in criterion 1's
  numerator while its `at` extends the denominator. **Proposed:** report attempts, successes and refusals
  separately — `calendarAccounting()` already separates the five quantities (§9.6).
- **C4. `pending` conflates three states** — inside the hold, no panel coverage, bad bars — and
  `analyst-run.mjs` prints all three as "still inside the holding period" (§2 D5). Distinct labels;
  **an unsettleable name must stay counted against criterion 7**, never excluded from `due`.
- **C5. Criterion 2's actual coverage is not stated.** It verifies the `asOf` label and news timestamps,
  and **nothing about prices or per-symbol freshness** (§9.2). A reader can take "point-in-time integrity
  holds live" to cover prices. **Proposed:** state the scope in the readout text. Documentation-level, and
  the only item here with no behavioural component.
- **C6. Unequal position sizes are weighted equally** in every mean — a 10% name at +5% and a 1% name at
  −5% give 0 where portfolio weighting gives +4.09% (§4). Pairs *are* size-matched, so the paired
  difference is sound; only the label "analyst mean net" is ambiguous.

---

## D. Decisions that are genuinely the owner's

Each was checked against source and the protocol **before** being called a decision.

- **P1. What "50 trades" means in the standing minimum** — measurable decisions, or orders placed. B1
  and B2 are two independent ways the current count diverges from measurable trades. Source does not
  settle it: `PAPER-PROTOCOL.md` says "50 trades" and `scoreJournal`'s `sized` and the settlement path
  disagree about what a trade is.
- **P2. Whether A1–A3 may touch a pre-registered criterion or gate at all.** A1 changes a stopping
  criterion's arithmetic, A2 changes a refusal, A3 changes a risk rejection. Each is a *correctness* fix
  in intent, and all three are nonetheless changes to gates the protocol pre-registered.
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

  decisionTimeMs + panel session count ──┬──> A1  criterion 7 dueness     [GATE]
                                         └──> C4  pending labels         [LABEL]

  panel-freshness.mjs (DONE)            ───> A3  per-symbol quote age    [GATE]
  validateTimestamps  (DONE)            ───> B3  refuse a scrambled series[GATE]
                                         └──> B5  grid report            [LABEL]

  A4 (paired readout)  ───> C6 label, and the newsSplit/checklistSplit arms
  B1 rerun guard       ───> P1, B2  (all three are about what `sized` counts)
  independent: B4, B6, B7, C1, C3, C5
```

**Suggested sequence:** C5 (documentation only, no risk) → A4 (statistic, no gate) → A1 → A2 → C2 → C4 →
A3 → B3 → the rest. A1–A3 each need **P2** first.

---

## F. What this unit completed, and what is still unmeasured

**Completed.** The calendar is grounded for **2026–2028** (§10.1), every supplied date verified
computationally as a weekday, 2028's missing New Year's closure checked against the page's own footnote
(2028-01-01 is a Saturday, hence nine closures where 2027 has ten), each year's session count reconciled
against its own weekday total (251/251/251), year-boundary windows answered rather than refused, and DST
transitions shown not to move a session date under the panel's UTC-midnight convention. Early closes are
recorded as **sessions**, and a test asserts no function in the module consumes the close times — no
intraday feature was added.

**Still unmeasured.** 2029+ and every non-NYSE venue remain UNKNOWN. Exceptional closures are outside the
source, so a weekday absent from both panel and schedule stays UNKNOWN. A3's frequency on real IBKR data
is unknown until the live panel exists. Nothing in this plan has been implemented.
