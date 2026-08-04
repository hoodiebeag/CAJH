# Agent loop protocol (v1) — Architect / Executor / Verifier

Binding contract for all three agents in this repo. Written after a real two-agent
collision in this project on 2026-07-30, where one agent's `git checkout` silently
discarded another's in-progress work. Every rule below exists because something went
wrong without it.

## The state file — shared blackboard and transaction ledger

`.agent_state.json` serves three jobs at once, and they must not be conflated:

- **`control`** — whose turn it is and what the current job is. Mutable; overwritten each
  handoff.
- **`blackboard`** — shared facts every agent should know before acting: frozen paths,
  what has already been established (so nobody re-runs a settled experiment), and what is
  in flight (so nobody kills a running job). Mutable, but *additive by default* — correct
  a fact if it is wrong, don't casually delete one.
- **`ledger`** — **append-only.** One entry per completed action. Never edit or remove a
  prior entry; an audit trail you can rewrite is not an audit trail. Cap at the most
  recent 100 entries and drop from the front only when that limit is hit.

```json
{
  "version": 2,
  "control": {
    "status": "ARCHITECT_PENDING | EXECUTOR_PENDING | VERIFIER_PENDING | BLOCKED | DONE",
    "target_file": "relative/path.js",
    "objective": "one sentence, concrete and falsifiable",
    "allow_live_edit": false,
    "test_command": "npm test",
    "iteration": 0,
    "max_iterations": 10,
    "notes": "handoff notes; failure logs go here for the Verifier loop",
    "updated_by": "architect | executor | verifier",
    "updated_at": "ISO-8601"
  },
  "blackboard": { "frozen_paths": [], "known_findings": "", "in_flight": "" },
  "ledger": [
    { "ts": "ISO-8601", "agent": "", "action": "", "detail": "", "commit": "", "tests": "" }
  ]
}
```

**Writing it safely.** The turn discipline (`status` names exactly one agent) is what
keeps two writers off this file. Write it *last*, after your code is committed, and write
it atomically — serialize to `.agent_state.json.tmp`, then rename over the original — so a
crash mid-write cannot leave the loop with an unparseable ledger and no way to recover.
Always re-read the file immediately before writing so you append to the current ledger
rather than clobbering entries another agent added while you worked.

## Hard rules (all agents)

1. **Read `.agent_state.json` first, then `AGENT_RUNBOOK.md`. If the state is empty, malformed, or missing `status`,
   `target_file`, or `objective` — set `status: "BLOCKED"`, write why into `notes`, and
   stop.** Never infer a target or invent an objective. In a repo that places real
   orders, a guessed target is the most expensive possible failure.
2. **Act only if `status` names your phase.** Otherwise exit without touching anything.
3. **Edit only `target_file`.** Any other file requires a new state entry naming it.
   The one exception is `.agent_state.json` itself, at handoff.
4. **Never run `git checkout`, `restore`, `reset`, `clean`, or `stash` on paths you do
   not own.** This is the rule that was actually violated. If you need a clean tree,
   commit your own work first; never discard someone else's.
5. **`git pull --rebase` before you start; commit and push before you hand off.**
   Uncommitted work is work that will be lost. Small commits, always.
6. **Frozen paths** — `scanner.js`, `monitor.js`, `trader.js`, `bot.js`, `strategy.js`,
   `backtest.js` are live-trading logic. Do not edit unless the state file names one as
   `target_file` AND `allow_live_edit` is `true`. Research scripts and data plumbing are
   fair game.
7. **`npm.cmd test` must pass before advancing `status`.** Use this Windows-safe form because
   PowerShell can reject `npm test` by blocking `npm.ps1`; this is not a test failure. If it fails, put the failure log
   in `notes`, set `status: "EXECUTOR_PENDING"`, and let the Executor fix it.
8. **Respect `max_iterations`.** If `iteration >= max_iterations`, set `BLOCKED` and
   stop. A loop that cannot converge must halt, not spin — spinning burns the usage
   budget with nothing to show.
9. **Write `.agent_state.json` last**, after the code change is saved and committed, so
   a crash mid-run never advertises work that does not exist.

## Phase duties

- **ARCHITECT** — structure only: imports, interfaces, function stubs with explicit
  `// TODO(Executor): ...` markers, and the design rationale in `notes`. No inner logic.
  Advance to `EXECUTOR_PENDING`.
- **EXECUTOR** — fill the `TODO(Executor)` stubs with complete, working code. Do not
  change exports, signatures, or file structure the Architect established; if the design
  is wrong, set `BLOCKED` with the reason rather than silently redesigning. Advance to
  `VERIFIER_PENDING` with `notes` cleared.
- **VERIFIER** — run `test_command`. Green: `status: "DONE"`. Red: failure log into
  `notes`, `status: "EXECUTOR_PENDING"`, `iteration += 1`.

## What is NOT automated

Usage limits stop a session outright; no agent can resume itself afterward, and no agent
can work without consuming budget. A scheduled task can restart the loop on a clock, but
if the cap is reached the next run simply fails until it resets. Plan the loop to be
interruptible at every step — which rules 5 and 9 already guarantee.

## Pipeline shape: Architect feeds the Executor, the Executor feeds the Verifier

The Architect stays in the loop, but **upstream and in batches** — not inline, gating one
task at a time. Routing each item individually made the Architect a serialization point
and left both other agents idle waiting for a hop that added nothing, since queue items
already carry complete specs (`file`, `task`, `done_when`).

The flow is a pipeline, and each stage keeps the next one fed:

- **Architect → Executor.** The Architect's standing duty is to keep
  `blackboard.work_queue` deep enough that the Executor never runs dry — specs written
  ahead of time, dependencies marked, each item sized to one run. Stocking the queue is
  the job; approving each pull is not.
- **Executor → Verifier.** Every completed Executor item is automatically the Verifier's
  next job. The Executor keeps the Verifier busy simply by finishing work.
- **Verifier → Executor.** On green, the Verifier marks the item `"state": "done"` and
  pulls the next `"pending"` item into `control` (skipping any whose `depends_on` is
  unfinished), setting `EXECUTOR_PENDING` in the SAME run. On red, it hands back with the
  failure log. Either way the Executor has work immediately.

**Set `ARCHITECT_PENDING` only for a genuine design decision** — a new file whose
structure isn't specified, an objective that contradicts the code, or work that cannot be
done without touching a frozen path. "The next task needs assigning" is not one; pull it.

**Never idle.** If your phase is done and the queue has pending work, take it. If the
queue is empty, say so loudly in the ledger so the Architect restocks it — an empty queue
is an Architect failure, not a reason for the loop to spin.
