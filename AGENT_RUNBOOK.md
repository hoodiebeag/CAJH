# CAJH agent runbook

This is a working aid for the Architect, Executor, and Verifier. `ARCHITECT_DIRECTIVE.md`
and `AGENT_PROTOCOL.md` remain authoritative when anything differs.

## Every run

1. Read `.agent_state.json`; act only when `control.status` names your phase.
2. Inspect `git status --short`. Preserve other agents' changes; do not reset, restore,
   clean, stash, or amend their work.
3. Run the Windows-safe baseline: `npm.cmd test`. PowerShell may reject `npm test` because
   `npm.ps1` is disabled; that is an invocation issue, not a test failure.
4. Read only the target file, direct dependencies, the queue item's acceptance criteria, and
   the relevant test. Never enable `LIVE_TRADING`, call `!resume`, or use a funded account.

## Executor handoff

- Implement one queue item only. Use the smallest patch that satisfies every `done_when` and
  `fail_closed` clause.
- Add deterministic fixtures around the actual failure mode; mocks must be able to fail.
- Run `npm.cmd test`; commit only your source/tests, then re-read state and update it last.
- Set the item `verifying`, put `VERIFIER_PENDING` in control, clear notes, and append one
  ledger record containing commit and test count.
- If an invariant or dependency cannot be met, set `BLOCKED` with the concrete reason. Do not
  silently broaden scope or bypass a safety gate.

## Architect queue contract

Each queue item must be a single bounded change with an explicit `file`, `allow_live_edit`,
`task`, `done_when`, `fail_closed`, and `test_command`. Prefer one implementation file plus
one focused test file; split a larger change into dependency-ordered items before routing.
Every `done_when` names the exact assertion or deterministic fixture, and every task names
the expected false-positive/failure mode (for example: a tiny surviving sample, holdout
leakage, stale input, or a gross return that vanishes after costs). Research tasks must state
their fixed train/holdout split and cost rule; no task may say merely “improve strategy.”
Set `allow_live_edit: true` only when the declared change genuinely needs a frozen/live path;
otherwise keep it false and do not expand the scope during implementation.

### Research-output contract

An Architect queue chain investigates one research question only. Do not combine a new signal,
new execution rule, and new parameter sweep in one claim. Each Executor handoff for research
must print or save a compact evidence block that a Verifier can inspect without re-running a
large study: universe and row/date counts; exact train, recent-time, and whole-symbol holdout
dates/symbols; raw and net-of-cost outcome; permutation `p` and family-adjusted `q` where
applicable; and the exact pre-registered reason for `PASS`, `KILLED`, or
`JUST-HOLD-MAJORS`. An absent, undersized, or unavailable holdout is an explicit limitation,
never a substitute null or a silent exclusion.

## Verifier handoff

For the active item, independently check:

1. Diff is limited to the declared scope (implementation, direct tests, necessary docs).
2. `npm.cmd test` passes from the committed state.
3. Each acceptance condition is asserted—not merely described in a comment.
4. Failure paths fail closed: no inferred fill, stale quote, empty-position fallback, or
   re-enabled entry state.
5. Live default remains halted, no secret is logged, and no real Kraken/Discord action is
   executed by a test.

On pass: mark the register item fixed, mark its queue item done, select the first pending
item whose dependencies are all done, set `EXECUTOR_PENDING`, and append a ledger record in
the same state update. On failure: give a minimal reproduction and exact violated criterion,
then return to `EXECUTOR_PENDING`.

## P0 task notes

| Task | Critical assertion |
|---|---|
| R-003 cooldown persistence | An unexpired level remains blocked after hydration; bad cooldown state blocks entries. |
| R-008 confirmed sell | No `QueryOrders` terminal execution confirmation means no tracked position is removed. |
| R-009 durable halt | `LIVE_TRADING` unset/false plus any Discord command cannot enable orders. |
| R-002/R-004 health | Failed hydration, persistence, reconciliation, or stale heartbeat blocks entries while exit monitoring stays best-effort. |
| R-005/R-013 validation | NaN, Infinity, zero, stale, unsupported, or unknown values cannot reach `AddOrder`. |
| R-010 concurrency | A second unresolved scan/tick is skipped, never run concurrently. |

## Research guardrails

Research begins only after P0/P1 dependencies clear. Momentum, low-volatility, and classifier
tasks use sealed whole-symbol holdouts, non-overlapping samples, costs, reproducible random
seeds, and correctly scoped multiple-testing correction. A train-only or gross-only positive
result is never an execution edge. A PASS remains research/paper-trade only; live promotion
requires a human decision.

### M5 sealed-holdout gate

Before approving M5, prove with a fixture that every reported symbol-holdout IC has at least
`minAssets` held-out symbols on every scored date and that none of those symbols enters train
selection, the grid, or the primary headline. With the stable-13 universe and `minAssets = 8`,
two disjoint symbol partitions cannot both satisfy the minimum (8 + 8 > 13). An empty or
undersized symbol holdout is therefore a **BLOCKED design result**, not a null score or a
passing fallback to the Q1-only pairs. Route it to `ARCHITECT_PENDING` to choose a pre-registered
feasible split or explicitly downgrade/remove that holdout axis; never silently lower `minAssets`.

### M6 economic-view gate

Approve M6 only with hand-calculated price-level fixtures showing that a rank formed at
`close[t]` enters at `close[t+1]`; it must not reuse the IC's `close[t]` to
`close[t+H]` forward return as a tradable return. The fixture must cover tercile, top-3,
and top-5 selections, a universe baseline for every reported spread, exact turnover from
successive holdings, and the stated round-trip cost deduction. Missing next-bar prices must
exclude the observation. A gross-only or same-bar economic result is fail-closed research
output, never an execution conclusion.

### M7 verdict gate

Reject any `PASS` or “holdout-confirmed” momentum verdict unless the saved harness output
contains a non-empty, minimum-cross-section whole-symbol holdout score. For the current
stable-13 data, an unavailable whole-symbol holdout must be stated with its mathematical
reason and prevents any fully-sealed confirmation claim. A `KILLED` verdict may still rest
on a pre-registered train null or a valid remaining time holdout, but must state that the
symbol arm was unavailable. Never turn an unavailable test into a null result or evidence
of an edge.

### B1 pre-registration gate

B1 may change only ranking-variable plumbing and direct tests. It must not alter
`STABLE_13`, `PRIMARY_SYMBOL_HOLDOUT`, date splits, minimum cross-section, M5/M6 scoring,
or any frozen momentum specification. A missing stored symbol or a desire to make a split
work is an `ARCHITECT_PENDING` design blocker, not authorization to replace a holdout after
inspection. Reject the item if its diff changes any of those inputs.

### B2 forward-metric gate

For every rank mode, verify that raw and risk-adjusted forward outcomes use the identical
post-`close[t+1]` holding window and report the same observation denominator. A zero,
non-finite, or incomplete forward-volatility window must be counted and visibly excluded;
it may not become zero, Infinity, or a silently reduced headline sample. Use a fixture with
one invalid forward-volatility asset-date and hand-computed valid raw/vol-adjusted returns.
For `entryDelay = 1` and horizon `H`, assert exactly `H` daily returns from the entry close
through the same exit close used by raw forward return; an `assetIndex + H` endpoint omits
the final day and is incorrect.

### B4 verdict gate

Require a saved, reproducible real-data harness output with the exact size/liquidity-control
inputs, universe before/after control, costs, and data provenance for every reported B4
number. The unavailable stable-13 whole-symbol arm forbids `PASS` or a holdout-confirmed
claim. Until B2 uses the exact raw-return holding window for forward volatility, do not use
its risk-adjusted metric as verdict evidence. A low-risk result that disappears after the
pre-specified major-asset control is `JUST-HOLD-MAJORS`, not an edge.

### P1 classifier-matrix gate

Before P1 passes, require a saved matrix manifest containing fixed `tpR=4`, exact train and
whole-symbol holdout symbols, rows/positives/base-rate/excluded-row counts for each split,
and the exact feature-column list. A fixture must change a holdout feature by an extreme
amount without changing the fitted train scaler; missing or non-finite values must increment
the visible exclusion count. No feature or label observed after the candidate entry time may
enter the matrix.

### P2 logistic-model gate

Approve only deterministic L2 logistic regression with explicit class weights, fixed seed,
declared λ grid, and λ selected solely from inner train folds. The handoff evidence block must
report train rows, fold count, selected λ, convergence/iteration status, class weights, and
Mann-Whitney AUC on planted-signal and null fixtures. A non-convergent or non-finite fit is
invalid; it cannot receive an AUC or flow into a holdout task. Trees, boosting, neural models,
and holdout-informed tuning are out of scope.

### P3 holdout/permutation gate

Require a primary whole-symbol holdout and separately labeled recent-time secondary holdout;
neither split may influence feature selection, scaling, λ selection, threshold selection, or
model fitting. For every permutation, shuffle only labels as specified and refit the scaler,
inner λ selection, and model before scoring the unchanged holdout. Report real train/holdout
rows, positives, AUCs, gap, permutation count/seed, valid-null count, and `p = (exceedances +
1) / (validNull + 1)`. A tiny or single-class holdout, failed refit, or fewer than 100 valid
permutations is an unavailable result, never an AUC claim.
