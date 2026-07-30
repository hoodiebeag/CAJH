# Agent loop protocol (v1) — Architect / Executor / Verifier

Binding contract for all three agents in this repo. Written after a real two-agent
collision in this project on 2026-07-30, where one agent's `git checkout` silently
discarded another's in-progress work. Every rule below exists because something went
wrong without it.

## The state file

`.agent_state.json` is the single source of truth for whose turn it is. Schema:

```json
{
  "version": 1,
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
}
```

## Hard rules (all agents)

1. **Read `.agent_state.json` first. If it is empty, malformed, or missing `status`,
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
7. **`npm test` must pass before advancing `status`.** If it fails, put the failure log
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
