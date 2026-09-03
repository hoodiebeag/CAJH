# Binding constraints

These are human decisions and safety rules. They bind regardless of who or what is doing the
work. The reasoning behind each is in `docs/archive/AGENT_PROTOCOL.md`, which this replaces as
the operative document.

## Closed research programs

**Crypto price-structure / Template-A is closed in full scope** (human decision, 2026-08-29). No
new price-structure entry variant, gate input, cost-reduction angle, or parameter/timeframe sweep
on `breakout`, `anticipate`, or any of the twelve `tournament.mjs` families. The basis is
mechanism, not this window's numbers: no family clears a meaningfully positive gross edge at any
cost structure tested, and better execution is ruled out structurally. **Reopening requires a
genuinely new information source, not a parameter change.**

**The threshold-a-series shape is retired** (2026-08-19). Eleven runs, mean effect −0.008R against
a +0.864R requirement. A new input series fed through the same shape is not a new experiment.

## Live trading

No live order, in any asset class, without the D1 → D2 → D3 path in `SELF_AWARENESS_SPEC.md` and
explicit human sign-off at D3. **No automated process may promote a strategy to live or flip the
live-trading gate.** If a run would require that, it stops and surfaces the decision to a human.

The order-validation chain, the halt/resume state machine and the live-trading gate are protected
by `scripts/check-protected-logic.cjs`, enforced by git's pre-commit hook rather than by anyone
remembering this paragraph. The override marker is human-created and single-use; an unattended
process never creates its own.

**Live trading is currently off and the strategy is unvalidated.** Nothing in the research record
justifies changing that.

## Evidence discipline

- **Pre-register before running.** `registry.preregister()` takes the hypothesis, the falsifiable
  gate, the universe, both splits, the cost assumptions and the seed. A gate written after the
  result is not a gate.
- **Correct across the whole family.** Every candidate joins the register in
  `MULTIPLE_COMPARISONS_AUDIT.md`. Do not argue for a narrower correction family.
- **Cluster by date.** Trades sharing a signal day are not independent observations.
- **Score against a matched-geometry null**, plus always-flat and buy-and-hold. Beating zero is
  not an edge.
- **Cost and slippage are part of the model**, never an afterthought applied to a gross figure.
- **The sealed pool is spent** (2026-08-29, inconclusive). Nothing may assume a fresh judge.
  `registry.sealedHoldoutStatus()` is the check; a second spend needs a named human authorizer
  and is recorded.
- **Verdicts are not revised retroactively.** `promotion.mjs` applies to new work. Rows already in
  `VERDICTS.md` were decided under the conditions stated at the time.

## Open, and not for an agent to settle

- **`vol_contraction`** — the human reviewed the case on 2026-09-03 and chose to keep it open.
  That is a deferral, not a resolution. It stays unpromoted; elapsed time, a thin queue or a later
  finding do not settle it.
- **The frozen-path list** — three documents disagreed (6 vs 8 vs 7 files); put to the human, who
  had no answer. Unresolved.

## The autonomous loop is retired

The 5-hourly keeper cron was deleted on 2026-09-03. The hourly loop on the owner's machine is
external to this repository and must be stopped there; until it is, it will keep pulling work.

`.agent_state.json` is now historical. Its ledger is a hundred entries of what the loop did and
the safety hook has a narrow exemption keyed to that array, so the file stays where it is rather
than being moved or emptied. Nothing should read it as a live work queue.

The loop is why this repository grew a research pipeline, a promotion gate, a paper-trade runner
and four protocol documents in two days without producing a single finding about markets. A
scheduler creates demand for tasks, and an agent asked to keep a queue stocked will stock it.
**Work should be started by a person deciding it is worth doing.**

## Housekeeping

Artifact and deck publishing is paused (human instruction, 2026-09-02).

`studies/` and `docs/archive/` are closed to new work. They exist so published figures remain
reproducible, not as a place to add things.
