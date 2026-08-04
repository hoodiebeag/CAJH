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
reason and makes the verdict `CONTEXT-ONLY` (or an explicitly blocked limitation), regardless
of train IC, FDR, or gross/net economic results. Never turn an unavailable test into a null
result or evidence of an edge.

### B1 pre-registration gate

B1 may change only ranking-variable plumbing and direct tests. It must not alter
`STABLE_13`, `PRIMARY_SYMBOL_HOLDOUT`, date splits, minimum cross-section, M5/M6 scoring,
or any frozen momentum specification. A missing stored symbol or a desire to make a split
work is an `ARCHITECT_PENDING` design blocker, not authorization to replace a holdout after
inspection. Reject the item if its diff changes any of those inputs.
