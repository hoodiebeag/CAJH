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
   *Narrow exception:* `package-lock.json` churn that `npm install` generated during this
   run is yours, not another agent's — `git checkout -- package-lock.json` to drop it is
   allowed. Prefer not to create it at all: use `npm.cmd ci` (runbook step 3). If
   `package.json` itself is dirty and you did not edit it, that is someone else's change —
   rule 4 applies unchanged: set `BLOCKED`, name the file, and stop.
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

## Red-baseline rule (amended — the naive version deadlocks)

"If `npm test` is red, set BLOCKED and stop" is wrong as stated, and it deadlocked this
repo on 2026-08-04: the baseline was red *because* the Executor's in-flight task
(`rsi-reversion-study` / MR1) had its tests written but the implementation unfinished. The
rule would have blocked the only agent able to fix it.

**Amended rule — scope the failure before deciding:**

1. Run `npm test` and list the failing test names.
2. **If every failure belongs to the test file(s) named in `control.target_file`**, the
   baseline is red because the current task is mid-flight. The assigned Executor **proceeds
   — finishing those tests is the task.** Any *other* agent still treats it as blocking and
   does not start unrelated work on a red tree.
3. **If any failure lies outside the current `target_file`**, that is a genuine regression:
   set `BLOCKED`, record the failing names in `control.notes`, and stop. Stacking work on a
   broken baseline makes the cause unbisectable.
4. Never mark an item `done`, and never advance to `VERIFIER_PENDING`, while any test is
   red — including the task's own. Red means unfinished, not "ready for review."

The principle: a red baseline is a signal about *whose* work is unfinished, not an
unconditional halt. Distinguish "someone broke the repo" from "this task isn't done yet."

## Notification policy (added 2026-08-06 — "completely hands off")

This loop runs unattended. The human is not reading the ledger in real time, so it must
tell them, not wait to be asked. `blackboard.notification_policy` (in `.agent_state.json`)
is the binding spec; the short version: `PushNotification` fires only for a decision the
human actually needs to make (an unresolvable `BLOCKED`, an honestly empty queue, a new
`PASS` verdict reaching the D3 human gate, or an active live-safety concern) — never for
routine progress. Every send is deduplicated via the top-level `notifications` map (6h
window per stable `reasonKey`) so a persistent issue notifies once, not every firing
forever. A queue item whose owner/file is literally `"(human)"`, or which describes the D3
live-promotion decision, is refused immediately by the Executor branch (`BLOCKED`, not
attempted) — that gate is never auto-satisfied by this loop, full stop.

**Known gap (updated 2026-08-07):** `PushNotification` HAS fired once — a scheduled run hit
a real pull deadlock on 2026-08-06 and tried to notify — but delivery failed:
`.agent_state.json`'s `notifications["pull-deadlock-foreign-changes"]` records
`deliveryResult: "Mobile push not sent (Remote Control inactive)"`. The tool call itself
succeeded (so it's in the task's approval set now), but the message never reached the
human; the deadlock was only resolved because the human found it independently in an
interactive session. Delivery, not approval, is the open gap: connecting Remote Control
would close it. Until then, a stuck loop has no working channel back to the human.

## Full control (2026-08-07 — supersedes "Hard rules" #2/#3/#6 and "Phase duties" below, for `cajh-loop-check` specifically)

At direct human instruction, `cajh-loop-check` no longer uses the Architect/Executor/Verifier
role separation or the frozen-path authorization requirement described in the sections below.
Those sections are kept as historical record of the design that ran from 2026-08-05 through
2026-08-07 and are still accurate for reasoning about *why* certain invariants exist, but they
no longer describe current enforcement for the live scheduled task. Current behavior:

- **No independent verify pass.** One firing designs, implements, self-checks, and commits in
  a single continuous pass — see `cajh-loop-check`'s own prompt (STEP 3) for the exact
  self-check discipline this relies on instead.
- **No frozen-path authorization gate.** Any file, including the former frozen list
  (`scanner.js`, `monitor.js`, `trader.js`, `bot.js`, `strategy.js`, `backtest.js`,
  `commands.js`), can be edited without a separate `allow_live_edit` step.
- **One thing is still protected, and enforced mechanically, not just by prompt text:** the
  `LIVE_TRADING` env check, the halt/resume state machine in `monitor.js`, and the
  order-validation chain in `trader.js`. `scripts/check-protected-logic.cjs`, run via
  `.git/hooks/pre-commit`, scans every staged diff (any file, not just those three) for the
  specific protected identifiers and refuses the commit unless a fresh, human-created,
  single-use marker (`.git/ALLOW_PROTECTED_EDIT`) is present. This exists because an
  adversarial review of the prompt-only version of this redesign found real gaps a narrative
  instruction alone couldn't close: nothing re-checked a firing's own edits before it
  committed them, and filename-scoped checking missed new call sites added elsewhere in the
  repo. The hook is enforced by git at commit time — the actual deployment boundary — for
  every commit made from this shared local checkout, regardless of which process makes it.
- **The D3 human gate (live-promotion) and the `"(human)"`-owned-work refusal are unchanged.**
  Removing process gates was explicitly scoped to internal workflow structure, not to the one
  decision (moving a validated strategy from paper to `LIVE_TRADING`) that was never
  automatable in the first place.

## Work-queue retention (added 2026-08-14 — done items are historical record, not working state)

`blackboard.work_queue` grows monotonically if done items are never pruned — 59 items and
climbing after 95+ commits rewriting `.agent_state.json` in full, each done item still
carrying its complete `task`/`done_when` text even though the same rationale already lives
permanently elsewhere, per this project's standing convention that a queue entry is a
working-state pointer, not the historical record. `ledger` already caps itself at the most
recent 100 entries (`slice(-100)`, drop from the front) for exactly this reason; work_queue
gets the same treatment:

**Retention rule.** Keep every `pending`/`started` item — queue depth is what matters for
"the Executor never runs dry" — plus the most recent **15** `done` items, in original order.
Drop older `done` items from `work_queue` only; `ledger` is untouched by this rule. N=15 was
chosen to keep roughly the visible tail of recent work at this project's cadence (a firing
every few hours) without the state file re-carrying months of already-published prose.

**Before dropping a done item**, confirm its rationale survives elsewhere — usually
ROADMAP.md or TOURNAMENT_ROADMAP.md prose, but VERDICTS.md rows, PARITY_MATRIX.md `COVERED`
rows, or the confirmed absence of a file it was scoped to remove (e.g. a DOCS-COMPACT-* item)
all count. Infra-only items with no verdict row of their own (e.g.
JUDGE-WALKFORWARD-SYMBOL-HOLDOUT, DCA-SIZING-HARNESS, AGENT-TOOLS-SANDBOX-HARDENING) are
recorded via the dated section/commit that added them, the code and tests themselves, and the
follow-on work they enabled — that is sufficient, matching how this project already treats
harness-only additions. If a done item's record can't be confirmed, don't drop it yet; leave
it for the next retention pass rather than guessing.

Apply this rule whenever work_queue is touched at scale — a dedicated retention pass, or
STEP 5 restock once the done count has grown past the cap again — not just as a one-time
cleanup.

## Multiple-comparisons discipline for pre-registered studies (added 2026-08-19)

Full derivation and the audit that motivated this: `MULTIPLE_COMPARISONS_AUDIT.md`. This
section is the binding rule; that document is the reasoning behind it. Update both together
— the counters below go stale the moment a new study lands if only one is touched.

**Family-size counters (update every time a new study of that kind completes, pass or
fail):**

- Formal NHST studies (report a p-value against a pre-registered significance gate):
  **19** sub-tests across 16 studies as of 2026-08-27 (see audit §2 for the list and p-values).
  Updated by WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC (2026-08-27): a follow-on to
  ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL, sourced directly from that study's own named next lever —
  does widening the hysteresis band (reducing exposure-flip turnover) change the verdict, isolating
  cost drag from signal-direction as the failure's driver? Byte-identical construct/data/cost
  basis/split/methodology to the predecessor, only change: pre-registered ±3% relative hysteresis
  band (3x the killed study's ±1%), a single primary width rather than a multi-width sweep — as the
  19th entry: one-sided sign-flip permutation on per-holdout-episode (strategy − buy&hold) spread,
  n=88 episodes (single-asset study, BTC only, down from the predecessor's 107 at the narrower
  band), p=0.9251, **wrong sign** (observed mean episode spread -0.005302). Family-wide BH-FDR
  recomputed across all 19 (raw q≈1.034 at rank 17 of 19, nowhere close to the 0.05 threshold) —
  does not survive. **Result: partial explanation, not a resolution.** Holdout
  episode count drops 107→88 (-17.8%) purely from tripling the band width, and the
  strategy-vs-buy-hold gap shrinks from -29.3 points (±1%) to -19.75 points (±3%) — consistent with
  cost drag being part of the story. But ~88 holdout flips at real per-side cost (~0.85%) is still
  ~74.8% cumulative cost drag, 3.8x the size of the remaining gap (up from 3.1x at ±1%) — cost-drag
  dominance relative to the shrunken gap did not decrease. Hit rate (49-53% in both segments)
  remains indistinguishable from chance at both band widths — widening the band reduces how often a
  directionless signal gets acted on, it cannot supply direction the underlying comparison never
  had. **Material side effect: none flip** — this addition lands near the bottom of the ranking
  (rank 17 of 19), not high enough to loosen thresholds at the top or tighten a marginal survivor
  past the line; `EQUITIES-MADIP-OUT-OF-SAMPLE` and `CLASSIFIER-FUNDING-FEATURE` were already
  non-survivors going into this update and simply tighten further (q=0.0522→0.0551,
  q=0.0594→0.0627); `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0036→0.0038) and `B5-REVERSAL L=3`
  (q=0.0090→0.0095) are essentially unaffected. Two sub-tests still formally survive at n=19,
  unchanged from n=18 — the first update in this family's history to cause no flip in either
  direction. Worth flagging for the independence caveat this section's own discipline exists to
  surface: unlike prior additions, this one is NOT a new information source — it reuses the
  predecessor's exact data/cost basis/holdout window, differing only in band width, so its p-value
  is substantially correlated with ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL's rather than an independent
  draw. Full writeup in `ROADMAP.md`'s 2026-08-27 WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC section
  and `MULTIPLE_COMPARISONS_AUDIT.md` §2. Updated by ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL (2026-08-27): added a BTC-only active-address-count
  exposure signal (blockchain.com Charts API `n-unique-addresses`, genuinely exogenous data),
  staged per `WHALE-WALLET-ACCUMULATION-PRIMARY`'s own named escape hatch — a deliberately
  different population-usage-momentum hypothesis, not a second whale-cohort-tracking attempt —
  as the 18th entry: one-sided sign-flip permutation on per-holdout-episode (strategy − buy&hold)
  spread, n=107 episodes (single-asset study, BTC only — this study's own effective-n unit),
  p=0.9990, **wrong sign** (observed mean episode spread -0.006973). Family-wide BH-FDR
  recomputed across all 18 (q=0.9990 for this entry, rank 18 of 18, last place) — does not
  survive, unsurprising given the wrong sign. Not a bare null: hit rate ~50-51% in both train and
  holdout (indistinguishable from chance), and 107 holdout exposure flips at this project's real
  per-side cost (~0.85%) is ~91% cumulative cost drag on its own, comfortably exceeding the entire
  strategy-vs-buy-hold gap — the likely driver is a ±1% hysteresis band too narrow to suppress
  whipsaw against this series' natural daily volatility, the same failure mode
  `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` diagnosed under an identical band convention on a
  different exogenous input. **Material side effect: one flip, and it is a new kind — the first
  time a still-live, un-killed survivor (not an already-KILLED result) flips out of the formal
  family.** `EQUITIES-MADIP-OUT-OF-SAMPLE` (this project's strongest surviving evidence result —
  net-of-cost positive, replicated stronger out-of-sample) moves from formal BH-FDR survivor
  (q=0.0493 at n=17, its own rank-4 threshold `4/17×0.05=0.011765` narrowly cleared by its
  unchanged p=0.0116) to non-survivor (q=0.0522 at n=18, threshold tightens to
  `4/18×0.05=0.011111`, no longer cleared) — purely from the family growing, its own point
  estimate/CI/replication result untouched. `CLASSIFIER-FUNDING-FEATURE` was already a
  non-survivor at n=17 (its rank-3 threshold tightens from `3/17×0.05=0.008824` to
  `3/18×0.05=0.008333`, its own unchanged p=0.0099 still exceeds it, q=0.0561→0.0594) — nothing
  further to flip. `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0034→0.0036) and `B5-REVERSAL L=3`
  (q=0.0085→0.0090) are essentially unaffected. Two sub-tests now formally survive at n=18, down
  from three at n=17 — the same mechanical, family-size-driven flip pattern this document has
  now recorded across three separate updates, this time landing on a still-live result rather
  than an already-KILLED one, which is exactly the scenario this discipline exists to catch
  before anyone treats a marginal formal survival as a permanent property of a study. Full
  writeup in `ROADMAP.md`'s 2026-08-27 ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL section and
  `MULTIPLE_COMPARISONS_AUDIT.md` §2. Updated by GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL (2026-08-23): added a GDELT news-volume/tone
  regime exposure signal on crypto — genuinely exogenous data, same family as
  `MACRO-REGIME-PRIMARY-SIGNAL`, run on that study's own 12-asset universe/window, but with a
  regime that turns over fast enough (65 holdout episodes vs macro's 1 on the identical window)
  to actually clear the pre-registered n>=8 episode floor — as the 17th entry: one-sided
  sign-flip permutation on per-holdout-episode (strategy − buy&hold) spread, n=65 episodes
  (this study's own effective-n unit, since there is no per-asset panel here), p=0.7113, **wrong
  sign** (observed mean episode spread -0.00594). Family-wide BH-FDR recomputed across all 17
  (q=0.7558 for this entry, rank 16 of 17) — does not survive, unsurprising given the wrong
  sign. Not a bare null: hit rate ~50.5% in both train and holdout (indistinguishable from
  chance), and holdout underperforms buy-and-hold (-56.06% vs -47.37%) despite the signal
  correctly measuring much faster regime turnover than macro data — unlike the log-regression
  pair, this is not a benchmark-direction artifact (holdout buy-and-hold is already negative and
  the strategy is MORE negative); the likely driver is transaction-cost drag from ~64 holdout
  exposure flips at this project's real per-side cost (~0.85%), roughly 54% of cumulative cost
  alone, despite the pre-registered hysteresis bands. **Material side effect: none flip.**
  `CLASSIFIER-FUNDING-FEATURE` was already a non-survivor at n=16 (its rank-3 threshold tightens
  from `3/16×0.05=0.009375` to `3/17×0.05=0.008824`, its own unchanged p=0.0099 still exceeds
  it, q=0.0528→0.0561) — nothing to flip this time, since the new entry lands near the bottom of
  the ranking (rank 16 of 17), not the top. `EQUITIES-MADIP-OUT-OF-SAMPLE` remains a survivor
  but tightens (q=0.0464→0.0493, its own p=0.0116 unchanged); `LOG-REGRESSION-BANDS-CRYPTO`
  (q=0.0032→0.0034) and `B5-REVERSAL L=3` (q=0.0080→0.0085) are essentially unaffected. Three
  sub-tests still formally survive at n=17, unchanged from n=16 — this update tightens
  thresholds without reordering the top of the table, unlike either of the two prior updates
  (one loosened via a very small p-value at rank 1, one tightened via a very large p-value that
  displaced the prior last-place entry). Full writeup in `ROADMAP.md`'s 2026-08-23
  GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL section and `MULTIPLE_COMPARISONS_AUDIT.md` §2. Updated by
  LOG-REGRESSION-BANDS-EQUITIES (2026-08-22): added the equities companion to
  `LOG-REGRESSION-BANDS-CRYPTO` — identical method (byte-identical OLS/band/hysteresis
  specification), fixed 30-symbol DJIA universe, IBKR-realistic per-share commission cost model
  (the one disclosed, unavoidable difference from crypto's flat-percentage cost) — as the 16th
  entry: p=0.9750, **wrong sign** (mean outperformance vs buy-and-hold is NEGATIVE, -0.0994).
  Family-wide BH-FDR recomputed across all 16 (q=0.9750 for this entry, rank 16 of 16, last
  place) — does not survive, unsurprising given the wrong sign. **This is not a null result in
  isolation: the equities holdout window was broadly BULLISH (21/30 assets positive
  buy-and-hold, median +7.6%), the mirror image of crypto's broadly bearish holdout — and the
  band signal underperforms buy-and-hold there too, for the same structural reason
  `LOG-REGRESSION-BANDS-CRYPTO`'s own always-flat control exposed: exposure-reducing signals are
  punished by a rising benchmark exactly as they were rewarded by a falling one.** The
  always-flat control here also underperforms buy-and-hold (mean -0.1247, worse than the
  signal's -0.0994), and signal-minus-flat is small, positive, and CI-includes-zero (mean
  +0.0253, 95% CI [-0.017, 0.063], p=0.118) — i.e. the band adds no detectable information over
  either extreme (always-long-buy-and-hold or always-flat) in either market. Median ΔR² (log-log
  vs drift model) is **-0.1184**, same qualitative finding as crypto: the power-law framing
  fits worse than plain drift. The cross-market gap seen in `EQUITIES-BASELINE-PORT` (equities'
  gross edge structurally larger than crypto's) does **not** reproduce for this method — instead
  both markets show the same benchmark-direction artifact in opposite directions, which is a
  more useful finding than either a clean replication or a clean non-replication would have
  been. Full writeup in `ROADMAP.md`'s 2026-08-22 LOG-REGRESSION-BANDS-EQUITIES section and
  `MULTIPLE_COMPARISONS_AUDIT.md` §2. **Material side effect: `CLASSIFIER-FUNDING-FEATURE` flips
  from survivor back to non-survivor** purely because the family grew (its own p=0.0099 is
  unchanged; its rank-3 threshold tightens from `3/15×0.05=0.01000` (n=15, where it barely
  cleared) to `3/16×0.05=0.009375` (n=16), and 0.0099 now exceeds that threshold) —
  `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0032) and `B5-REVERSAL L=3` (q=0.0080) are essentially
  unaffected; `EQUITIES-MADIP-OUT-OF-SAMPLE` remains a survivor but tightens (q=0.0435→0.0464,
  threshold `4/16×0.05=0.0125` vs its unchanged p=0.0116). Three sub-tests formally survive at
  n=16, down from four at n=15 — pure family-size arithmetic, not a re-examination of
  `CLASSIFIER-FUNDING-FEATURE`'s own already-KILLED economic-gate verdict. Updated by
  EQUITIES-MADIP-OUT-OF-SAMPLE (2026-08-22): added `ma_dip`'s sign-flip permutation
  p-value, recomputed on the same fresh DJTA-20 universe EQUITIES-BREAKOUT-OUT-OF-SAMPLE already
  fetched (zero ticker overlap with the original DJIA-30) as the 15th entry — p=0.0116,
  **correct sign, and a LARGER point estimate than the original** (+0.2994R out-of-sample vs
  +0.1526R in-sample, 300 trades); family-wide BH-FDR recomputed across all 15 (q=0.0435 for
  this entry, rank 4 of 15) — **formally survives**, the first equities or crypto result in this
  project to combine BH-FDR survival with a stronger, not weaker, out-of-sample replication and
  a net-of-real-cost positive point estimate. Does not itself authorize any live-promotion
  consideration — `SEALED_SYMBOLS`-style independent re-validation is still required per the
  rule below and was not attempted by this item. **Material side effect: none flip.**
  `CLASSIFIER-FUNDING-FEATURE`'s rank-3 threshold tightens from 0.01071 (n=14) to 0.01000
  (n=15) as the new entry is inserted directly below it, but its own unchanged p=0.0099 still
  clears (q=0.0495, barely) — `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0030) and `B5-REVERSAL L=3`
  (q=0.0075) are essentially unaffected. Full writeup in `ROADMAP.md`'s 2026-08-22
  EQUITIES-MADIP-OUT-OF-SAMPLE section and `MULTIPLE_COMPARISONS_AUDIT.md` §2. Updated by
  LOG-REGRESSION-BANDS-CRYPTO (2026-08-22): added a log-price-vs-log-time
  regression-band exposure signal's sign-flip permutation p-value (per-asset holdout
  outperformance vs buy-and-hold, n=24 assets) as the 14th entry — p=0.0002, **correct sign**,
  the smallest raw p-value recorded in this family; family-wide BH-FDR recomputed across all 14
  (q=0.0028 for this entry, rank 1 of 14) — **formally survives**. **This survival should not be
  read as a real effect**: the same study computed an always-flat (never-trade) control against
  the identical buy-and-hold benchmark and found it outperforms buy-and-hold by MORE than the
  real signal does (+0.4337 vs +0.1446 mean, n=24), because 23/24 assets had negative
  buy-and-hold return over their holdout window — any reduced-exposure strategy is rewarded by
  a benchmark that is falling almost everywhere. Signal-minus-always-flat delta is significantly
  NEGATIVE (mean -0.2892, 95% CI [-0.4154,-0.1644]). Recorded KILLED in `VERDICTS.md` despite
  the nominal BH-FDR survival — full writeup in `ROADMAP.md`'s 2026-08-22 LOG-REGRESSION-BANDS-CRYPTO
  section and `MULTIPLE_COMPARISONS_AUDIT.md` §2. **Material side effect: CLASSIFIER-FUNDING-FEATURE
  flips from non-survivor back to survivor** purely because the family grew (its own p=0.0099 is
  unchanged; it moved from rank 2 to rank 3 as the new entry displaced it, and the rank-3
  threshold at n=14, 0.01071, is looser than the rank-2 threshold it failed at n=13, 0.00769) —
  B5-REVERSAL L=3 (q=0.0070) and LOG-REGRESSION-BANDS-CRYPTO (q=0.0028, see caveat above) are
  the other two nominal survivors at q=0.05. Unchanged by PAIRS-COINTEGRATION-STATARB (2026-08-19): that study ran its own internal
  105-test Engle-Granger screen, already BH-FDR-corrected within the study (0/105 survived
  q=0.05) — it doesn't add a raw uncorrected p-value to this cross-study table the way
  Classifier P5's did. Updated by CROSS-SECTIONAL-NONPRICE-RANK (2026-08-19): added its own
  train-IC permutation p-value (p=0.1249, wrong sign vs pre-registered expectation) as the
  10th entry; family-wide BH-FDR recomputed across all 10 (q=0.2498 for this entry) — did
  not survive. Updated by EQUITIES-BREAKOUT-SIGNIFICANCE (2026-08-21): added `breakout`'s
  sign-flip permutation p-value (p=0.2036, correct sign, CI includes zero) as the 11th
  entry; family-wide BH-FDR recomputed across all 11 (q=0.358 for this entry) — does not
  survive. **Material side effect: CLASSIFIER-FUNDING-FEATURE now flips from survivor to
  non-survivor** purely because the family grew (its own p=0.0099 is unchanged; the rank-2
  threshold tightened from 0.0100 to 0.00909) — B5-REVERSAL L=3 is now the sole survivor at
  q=0.05. Updated by EQUITIES-MADIP-SIGNIFICANCE (2026-08-22): added `ma_dip`'s sign-flip
  permutation p-value (p=0.0648, correct sign, 475 trades — the largest-sample entry in this
  family, CI includes zero) as the 12th entry; family-wide BH-FDR recomputed across all 12
  (q=0.1555 for this entry, rank 5 of 12) — does not survive. No prior survivor flips this
  time: B5-REVERSAL L=3 remains the sole survivor at q=0.05. Updated by
  EQUITIES-BREAKOUT-OUT-OF-SAMPLE (2026-08-22): added `breakout`'s sign-flip permutation
  p-value, recomputed on a fresh DJTA-20 universe (zero ticker overlap with the original
  DJIA-30) as the 13th entry — p=0.6165, **wrong sign** (point estimate flipped from
  +0.1866R in-sample to -0.0854R out-of-sample, 33 trades); family-wide BH-FDR recomputed
  across all 13 (q=0.6679 for this entry, rank 12 of 13) — does not survive, nowhere close.
  No prior survivor flips: B5-REVERSAL L=3 remains the sole survivor at q=0.05.
- Economic-gate studies (point-estimate threshold, no p-value): **35** as of 2026-08-22
  (audit §1/§3). Unchanged by PAIRS-COINTEGRATION-STATARB — its holdout economic gate was
  never evaluated (0 pairs cleared the internal screen), same "screen/train-gate blocked,
  holdout never touched" bucket as H11/FUNDING-MEANREV/FIB-PULLBACK (audit §1 Non-verdict row,
  now 6 studies). Updated by ZERO-COST-FLOOR-ALL-FAMILIES (2026-08-22): added as the 34th —
  a real point-estimate/trade-count gate (avgR>0.10 AND trades>=150 AND
  positiveAssets/assets>=0.5) evaluated against all 12 `tournament.mjs` families at zero cost;
  0/12 cleared it (audit §3, `vol_contraction` nearest miss on avgR alone but short on trade
  count). No family cleared its literal threshold, so the `SEALED_SYMBOLS` re-run rule below
  does not apply. Updated by PER-EPOCH-GROSS-EDGE (2026-08-22): added as the 35th — the same
  gate reused verbatim, evaluated per epoch per family (5 epochs x 2 families, on
  SIGNAL-DECAY-TEMPORAL-STABILITY's existing epoch boundaries, zero-cost gross) against
  `breakout`/`anticipate`; 0/10 sub-gates cleared it, counted as one study per this counter's
  own per-study (not per-sub-gate) granularity. No epoch cleared its literal threshold, so the
  `SEALED_SYMBOLS` re-run rule below does not apply.

**Rule for a new formal NHST result.** Do not evaluate it against `alpha=0.05` in isolation.
Add its p-value to the family-size counter above, recompute Benjamini-Hochberg FDR across
*all* p-values in that family (old + new) at `q=0.05`, and only call the new result
"statistically significant" if it survives that recomputed correction. If it doesn't survive
correction but does clear the economic gate independently, record both facts plainly — do
not report only the flattering one.

**Rule for a new economic-gate result that clears its literal pre-registered threshold.**
Treat it as provisional, not a live candidate for the D3 human gate, until it is re-run
against `researchlib.mjs`'s `SEALED_SYMBOLS` pool (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI`) — the
one holdout resource in this project confirmed never yet examined by any study. A PASS that
does not replicate there is not promoted. This exists because 33 consecutive economic-gate
studies have all missed their threshold by 2-5x with zero near-misses (audit §3) — a future
result that clears the line for the first time deserves more scrutiny than less.

**Rule for the calendar holdout.** `2025-06-01–present` has been examined by roughly 27
separate economic-gate/descriptive studies as of this audit and is retired as a "fresh"
judge for the 28-asset active watchlist. A new price-structure family study either uses
candle data collected after 2026-08-19 for its holdout, or explicitly discloses in its own
result writeup that it is re-examining already-spent data — never silently.

## Walk-forward judge recommendation (added 2026-08-22)

WALKFORWARD-REVALIDATION-OF-BASELINE (`ROADMAP.md`, 2026-08-22) applied
`researchlib.mjs`'s `walkForwardSeriesWindows` (4 rolling folds, 23-asset active pool, sealed
pool untouched) to the `breakout`/`anticipate` baselines and found a family-dependent result:
`anticipate`'s fold-to-fold avgR drift is statistically significant (permutation ANOVA
p=0.000999 — folds decline monotonically from -0.673 to -0.974), `breakout`'s is not (p=0.076
on the same partition style). This is a recommendation, not a harness change (that item's own
done_when) — no existing study is required to adopt it retroactively.

**Recommendation:** a future study that characterizes `anticipate`'s baseline reliability (as
opposed to running a fresh pre-registered economic/NHST gate against it, which is unaffected)
should prefer per-fold walk-forward reporting over a single pooled 70/30 split, or at minimum
disclose per-fold dispersion alongside any single pooled avgR it quotes for `anticipate`. No
equivalent recommendation applies to `breakout`: this test could not reject a single-mean
summary for it, so its existing single-split figures stand without a walk-forward caveat on
this evidence.

## Scheduling (updated 2026-08-07 — one task, not three)

The loop originally ran as three independent scheduled tasks (`cajh-executor-check`,
`cajh-verifier-check`, `cajh-architect-check`), each cheap-exiting unless `control.status`
named its role. That meant most firings — the large majority, since only one role's turn is
ever active — did nothing but read the state file and exit, at a combined rate of roughly
13 sessions/hour. They are retired in favor of a single `cajh-loop-check` task that reads
`control.status` once per firing and dispatches to whichever role (if any) actually has
work, then always runs the shared watchdog/notification/restock checks before exiting —
same coverage, roughly a third the session count. The turn-discipline invariant is
unchanged: at most one role's active-turn work happens per firing, and a role that hands off
does not immediately also run the role it handed off to in the same firing.
