# Self-awareness & bounded self-editing spec — for the Architect

_Goal: close the gap between the `@cajh` chat AI and the trading engine. Today they share a
repo but the AI has no structured access to what the bot decided or why. Three phases, in
strict order of both value and safety. **Phases 1–2 are buildable now, in parallel with the
momentum research, and carry near-zero risk. Phase 3 is gated and mostly already built —
read its hard rule before touching it.**_

---

## Phase 1 — Self-knowledge (build first; it is the substrate for everything else)

The AI cannot explain a decision that was never recorded. `!why` computes rejection reasons
*on demand*; nothing is *persisted*, so the reasoning behind a skip three hours ago is gone.
Fix = record decisions, then give the AI read access.

- **C1 — Decision log (append-only).** On every scan, the engine records one entry per
  asset considered: `{ts, asset, timeframe, decision: taken|skipped, reason, entry, stop,
  tp, riskR, regime}`. Reuse `logger.js`; write through it so a logging failure can **never**
  block or alter a trade (wrap in try/catch, log-only, no control-flow impact).
  - Touches `scanner.js` (FROZEN) at the decision points → requires `allow_live_edit: true`
    for a **scoped, log-only insertion**, with the live-safety discipline from ROADMAP:
    behavior-preserving, tests green, reviewed. If in doubt, emit from `evaluateAsset`'s
    existing reason computation so no gate logic is duplicated.
- **C2 — State access for the AI.** Extend `context.js` (NOT frozen) `buildLiveContext` to
  expose: open positions (entry/stop/tp/reason/R), the last N decision-log entries, current
  config, halt status (`LIVE_TRADING`/`START_HALTED`/manual stop), and the latest ROADMAP
  verdict. Read-only.
- **Done when:** `@cajh why didn't you buy ETH this morning?` and `what positions are you in
  and why?` return answers grounded in C1/C2 data, verified on real examples.

## Phase 2 — Purpose / context (context-engineering, not sentience)

- **C3 — Mission context block.** Give the chat AI a concise, accurate self-description:
  what cajh is, its current strategy, that live trading defaults OFF and *why* (the
  break-even finding), and a short digest of ROADMAP verdicts. Pull dynamically so it stays
  true as findings change.
- **Done when:** `@cajh what are you for?` / `what have you learned?` answer accurately from
  live config + ROADMAP, not from a hardcoded blurb.

> **Honesty note to preserve in the code and the AI's answers:** this is *accurate context
> about the system*, not persistent self-awareness. The AI reasons over what it is given each
> query; it does not continuously "know itself." Build the useful thing; do not market the
> romantic one — and have the AI itself be straight about this if asked.

### Phase 1–2 queue (added to the active work_queue, parallel with momentum)
| id | file | task | done_when | depends_on |
|----|------|------|-----------|------------|
| C1 | scanner.js | Append-only decision log via logger.js; log-only, behavior-preserving. **Needs allow_live_edit for a scoped insertion.** | Trade behavior byte-identical with logging on/off; entries persisted; tests green. | — |
| C2 | context.js | Expose positions + last-N decisions + config + halt + ROADMAP verdict to buildLiveContext (read-only). | @cajh answers "what/why" from real data on examples. | C1 |
| C3 | context.js | Dynamic mission/purpose context from live config + ROADMAP digest. | @cajh answers "what are you for / what have you learned" accurately. | C2 |

---

## Phase 3 — Bounded self-editing (GATED; the safe version already exists)

**You have already built the safe version of "cajh edits its own strategy": this
Architect/Executor/Verifier loop, plus `frozen_paths`, `allow_live_edit`, the sealed-holdout
research pipeline, and the human. Do not build a second, looser self-editing path.** An AI
optimizing its own strategy against the same data, in a closed loop, is an overfitting
machine — which is the exact failure the entire out-of-sample apparatus exists to stop. The
loop's separate Verifier and the human gate are not bureaucracy; they are the external
skeptic a self-editor structurally cannot be for itself.

### The hard rule (non-negotiable)
- The loop **may** propose and validate strategy changes autonomously **in the research /
  strategy code**, behind `allow_live_edit: false`, proven on the sealed holdout.
- Promoting any change to the **live, real-money path** (flipping `LIVE_TRADING`, or editing
  a frozen live file to trade differently) is **human-gated, per change**, and only after
  the ROADMAP go-live checklist is satisfied **including a logged paper-trading period**.
- **No agent ever auto-flips `LIVE_TRADING` or auto-promotes a strategy to live.** If a run
  would require that, set `BLOCKED` and surface it to the human.

### Where the Architect goes the moment an edge is found (the trigger you asked for)
When a signal (momentum M7, low-vol B4, or any future one) returns **PASS** — holdout-
confirmed, net of cost, survivorship-caveated — queue this, in order, and not before:

| id | file | task | done_when | gated_on |
|----|------|------|-----------|----------|
| D1 | strategy.js / research | Implement the validated edge as a **research/backtest** strategy variant (allow_live_edit=false). Re-confirm it reproduces the M7/B4 holdout numbers end-to-end in the live-mirroring backtester. | Backtester reproduces the confirmed edge; no live path changed. | signal verdict == PASS |
| D2 | monitor.js/logger | **Paper-trade** the variant: run it live-shadow in **log-only** mode (decisions + would-be fills recorded via C1, no orders), tracking drift vs backtest. | A logged paper track exists over a pre-set window; drift within tolerance. | D1 |
| D3 | — (human) | **HUMAN GATE.** Present the holdout + paper-trade evidence and the go-live checklist. Human decides live promotion. Agents do not proceed past here. | Human sign-off recorded; checklist complete. | D2 |

_Rationale to keep attached: the person who said "no entity understands cajh's mistakes
better than the AI making them" is half right — an AI with full context (C1–C3) is well
placed to propose fixes, which is why Phase 1–2 matter. The other half is why D3 exists: a
self-editor has a blind spot for its own errors exactly where it is most confident, and this
project's whole history is a catalogue of confident, well-reasoned edges that were noise.
Self-editing with an external skeptic is powerful; without one it is a fast way to lose
money._
