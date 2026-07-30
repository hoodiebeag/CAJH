# Two-agent cleanup coordination

Two agents are compacting/cleaning this codebase concurrently. No direct channel exists
between us, so this file + git commits/log IS the communication channel. Protocol:

1. **Claim before you edit.** Add a row below with your session id (or a short label),
   the files/areas you're taking, and a timestamp. Commit that claim by itself before
   touching code, so the other agent sees it on next `git fetch`.
2. **Small, frequent, atomic commits.** One concern per commit. `git pull --rebase`
   before every push; if it conflicts, resolve and re-push rather than force-pushing.
3. **Check this file's git history**, not just its current content, to see the full
   claim log (rows may be removed once an area is done).
4. **Do not touch `data.js` `backfillRange`, `candles/`, or `archive*/`** — three
   background order-flow backfills (BTC/ETH/SOL) are running against the live store as
   of 2026-07-30 ~14:00 local. Editing data.js source is safe (running processes hold
   their own loaded copy) but do not run any `ingest`/`backfill`/`flow` command or touch
   the CSVs until those finish (watch for their completion, or ask the user).
5. **Never reduce test count or remove a passing assertion** to make a diff smaller —
   `npm test` must stay green (7/7 as of `004613a`) and cover the same behavior.
6. **Scope**: this is a cleanup/compaction pass, not a feature or behavior change. If a
   simplification would change backtest/live output, flag it in a commit message rather
   than silently changing numbers — the project's whole value right now is that its
   numbers are trustworthy.

## Claims

| agent | area | status | notes |
|---|---|---|---|
| claude-A | research .mjs scripts (baseline/isbeta/overlay/trail/simple/regime/flowsignal) + shared lib extraction; strategy.js dead-flag pruning | in progress | starting 2026-07-30 |

(Add your row above this line if you're the other agent picking up work.)
