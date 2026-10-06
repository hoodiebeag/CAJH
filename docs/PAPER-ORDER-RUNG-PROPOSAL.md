# Proposal: a paper-account order rung. DECLINED for now.

## Status: reviewed and declined, 2026-09-29

**Both questions this document asked have been answered by the owner. Nothing here is implemented, and
under decision 2 nothing here may be implemented without the full D3 gate.**

1. **Should the rung exist? — No, not yet.** Do not build an IBKR paper-account order rung. The forward
   path continues as the log-only journal, which is D2 as `SELF_AWARENESS_SPEC.md` already defines it.
2. **Is a paper-account order a "live order" under the `README.md` hard limit? — Yes.** That boundary is
   binding. It is recorded in `README.md` under **Hard limits**, which is the authoritative home for it.

**What decision 2 changes, and it is more than a label.** A paper-account order is now subject to
D1 → D2 → D3 with explicit human sign-off at D3 — a gate no document and no agent can satisfy. So this
rung is not merely deferred pending a build decision; were it ever revisited it would have to clear D3
first. Everything below is retained as the record of what was proposed and on what reasoning, not as a
plan awaiting a start date.

The original status note, still true: no order code is wired, no route exists from the analyst to a
broker, no schedule is created, and no risk threshold, sizing rule, STOP criterion or passing criterion
is changed by this document.

## 0. The thing this document must not pretend

**D2 in `SELF_AWARENESS_SPEC.md` is log-only, and this proposal is not D2.** The row, verbatim:

> | D2 | monitor.js/logger | **Paper-trade** the variant: run it live-shadow in **log-only** mode
> (decisions + would-be fills recorded via C1, **no orders**), tracking drift vs backtest. | A logged
> paper track exists over a pre-set window; drift within tolerance. | D1 |

So journalled decisions — what `analyst-run.mjs paper` does today — **are** D2. Sending orders to an
IBKR paper account is not a step *within* the existing ladder; it is a **new rung that the ladder does
not contain**. Adding it is an amendment to the promotion spec, which is an owner decision. This document
does not change `SELF_AWARENESS_SPEC.md`, and if it is approved the amendment should be made explicitly
and separately rather than inferred from this file existing.

Call the proposed rung **D2b**, sitting between D2 and D3, purely so it has a name here.

## 1. What it buys, stated honestly, including what it does not

`docs/FORWARD-EVAL-SPEC.md` §8 already assessed this and the assessment has not changed:

| | journalled decisions (D2, today) | paper-account orders (D2b, proposed) |
|---|---|---|
| measures | decision quality at a **modelled** cost | decision quality **and** fill quality |
| statistical power | n periods | **identical — buys none** |
| assumes | that you get filled | less; surfaces partial fills, rejections, live spread |
| still assumes | — | no market impact; paper venues fill optimistically |
| build cost | none, it exists | crosses protected logic; needs review and sign-off |

**Paper orders buy zero statistical power.** They do not shorten the time to an answer about edge by one
day. What they buy is the honesty of the cost and fill assumption — which is where §7 says the open
question actually lives, so this is not pointless. But "can we execute it" only matters once "is there
anything to execute" has an answer, and that is the multi-year question.

**The recommendation in the spec stands: journalled decisions first.** Revisit this only if a candidate
survives long enough that fill realism becomes the binding uncertainty. Approving D2b before then spends
review effort and adds a live-adjacent code path in exchange for no evidence.

## 2. Account and port separation

The bot's existing adapter already defaults to the paper port, which is the one piece of good news here:

- `brokers/ibkr.mjs:82` — `const PORT = Number(process.env.IBKR_PORT) || 4002;` with the comment
  `4002 = paper, 4001 = live`. Host, port and client id come from `IBKR_HOST`/`IBKR_PORT`/`IBKR_CLIENT_ID`.
- **A default is not a guarantee.** One environment variable separates paper from live. For a rung whose
  entire purpose is to be un-live, an env var is the wrong strength of boundary.

Proposed requirements, for review:

1. **Assert the account, not the port.** IBKR paper accounts are prefixed `DU` (the existing mock uses
   `DU12345`, `brokers/ibkr.test.mjs:92`). The order path must read the connected account id and **refuse
   to send unless it matches `^DU`** — a positive check on the account, not a negative check on a port
   number. Ports can be forwarded; account ids cannot be.
2. **Refuse ambiguity.** If the account id cannot be read, refuse. Absent identification is not
   permission, and this is the one place in the codebase where fail-open is unacceptable.
3. **A separate client id** from the data collector, so an order session and a historical-data session
   cannot be confused in Gateway's own logs.
4. **The bot's live-trading opt-in flag is untouched and irrelevant here.** It gates the Discord bot's
   autonomous trading (`bot.js:164`, `monitor.js:126`); the flag itself is named in `README.md`, which is
   its one home. D2b must not read it, must not set it, and must not be a reason to change it. A design
   that finds itself wanting to touch that flag is the wrong design.
5. **A separate journal or an explicit mode.** Paper-order records must not be mixed into the D2
   decision journal in a way that lets `scoreJournal` pool them, for the same reason dry-run and paper
   are already separated by mode.

## 3. Three modes, and the two boundaries between them

| mode | decides | journals | sends orders | exists today |
|---|---|---|---|---|
| `dry-run` | on a historical date | yes, `mode: dry-run` | no | yes |
| `paper` (D2) | on the current panel | yes, `mode: paper` | no | yes |
| **`paper-orders` (D2b)** | on the current panel | yes, plus order lifecycle | **yes, to `DU…` only** | **no** |

The `dry-run`/`paper` boundary is already enforced in code (`--stub` refused in paper mode; `scoreJournal`
scores one mode at a time; synthetic roots refused). The `paper`/`paper-orders` boundary needs the same
treatment and must be **opt-in per invocation**, never a config default, never inherited from an env var
alone. A run that sends orders should be impossible to start by accident.

## 4. Idempotent intent → ack → fill reconciliation

This is the substance of the proposal and the reason it is not a small change.

A decision journal is append-only and needs no reconciliation because nothing outside it can change.
An order has a lifecycle that lives in the broker, and the broker is the source of truth. The failure
mode is **duplicate orders**: the runner sends, the process dies before recording the ack, the scheduler
retries tomorrow, and the position is doubled. A paper account makes that cheap to discover and does not
make it acceptable — a reconciliation design that only works when nothing crashes is not one.

Proposed records, all append-only, in this order:

1. **`order-intent`** — written **before** anything is sent. Carries a **client-generated
   idempotency key** derived from the deciding batch and the symbol (e.g. `sha256(batchId|symbol|side)`),
   plus the target size and the decision it came from. Written first so a crash leaves evidence that an
   order *may* be in flight.
2. **`order-ack`** — the broker's own order id, linked to the idempotency key.
3. **`order-fill`** — quantity and price per fill, appended as they arrive. Partial fills are **multiple
   fills**, not a single revised record.
4. **`order-terminal`** — filled, cancelled or rejected, with the broker's reason verbatim.

Rules that make it recoverable rather than merely logged:

- **Startup reconciliation is mandatory and comes first.** Before deciding anything, read open orders and
  positions from the broker, compare against the journal's unterminated intents, and **refuse to proceed
  on any mismatch.** Reconciling is not optional cleanup; it is the precondition.
- **Never re-send an intent whose terminal state is unknown.** Query it. An idempotency key with no ack
  is an unknown, not a failure, and the difference is the whole design.
- **IBKR's own order id is not a substitute for the client key**, because it is assigned *after* the risky
  moment. The client key exists precisely to bridge the gap where nothing has come back yet.
- **Reject partial-fill arithmetic in the scorer.** A partially filled position is a different position
  from the one decided. Whether such a period counts as evidence at all is a **pre-registration
  question** for the ledger (`analyst/ledger.mjs`), decided before any orders are sent — not a rule to
  settle after seeing which way it flatters the record.

## 5. Kill switch

- **One command that cancels all open orders and stops the runner**, testable without a live Gateway.
- **It must not depend on the runner being healthy.** A kill switch reachable only through the process it
  is killing is decorative.
- **A refuse-to-start marker**: a file whose presence blocks any order send, so stopping is a one-line
  action a human can take under stress and does not require editing code or env vars.
- **Default state is off.** After any crash, restart into not-sending until reconciliation passes.

## 6. Audit and alerting — and an unsolved precedent

Every order must be reconstructible from the journal alone: intent, ack, fills, terminal state, and the
decision that produced it, with timestamps and the idempotency key.

**The alerting requirement has a known unsolved precedent and this proposal should not pretend
otherwise.** `docs/archive/AGENT_PROTOCOL.md:314-320` records a scheduled run hitting a real deadlock,
calling `PushNotification`, and the delivery failing:

> `deliveryResult: "Mobile push not sent (Remote Control inactive)"` … Delivery, not approval, is the
> open gap

That was the old research loop, not the analyst — but it is the same shape of requirement, and it failed
silently. Today nothing in this repository alerts on anything: `analyst-run.mjs protocol` computes the
four STOP criteria and is a manual command, and nothing schedules it.

**Proposed precondition: a demonstrated alert path before any order is sent.** Not a configured one — one
that has actually delivered a test message to Tyler and been confirmed received. An unattended order path
whose failures reach nobody is worse than no order path, because it converts a visible blocker into an
invisible one. If a demonstrated alert path is not available, D2b should not proceed, and log-only D2 is
the correct place to stay.

## 7. Cost assumptions as they stand today

- The modelled cost is `COST_MODELS.usEquityIbkr` — `feeRate + slipPct` per leg, applied in
  `analyst-run.mjs` for settlement and scoring. That is the assumption D2b would be testing.
- `PER-FAMILY-COST-CEILING` (2026-08-28) derived break-even in closed form: because `netR` is affine in
  fee and slip with a coefficient independent of both, break-even all-in per-leg cost is
  `grossAvgR / k`, verified to 1e-10. **So "what cost would make this work" is already answered.** The
  open question is whether a *verified* cost falls below a threshold computed in advance.
- **`FORWARD-EVAL-SPEC.md` §7 records IBKR crypto spreads as unmeasured.** For equities the modelled
  figure is a vendor assumption that has never been checked against a fill.
- **A paper fill is not a verified cost.** Paper venues fill optimistically and model no market impact.
  D2b would replace one assumption with a better-instrumented assumption, not with a measurement. Any
  write-up must say so, or it will be read as having measured execution cost when it has not.

## 8. Protected-logic review and sign-off

Wiring orders touches identifiers that CI enforces. The authoritative list is `PROTECTED_PATTERNS` in
`scripts/check-protected-logic.cjs` — read it there rather than trusting a copy; it covers the buy and
sell entry points, the order-request validator, the live-trading opt-in flag and the trading-state
predicate. The check runs per commit in `.github/workflows/protected-logic.yml` with **deliberately no
override**.

**This document is itself a worked example.** Its first draft spelled those identifiers out in prose and
the pre-commit check blocked the commit — correctly. The established fix in this repository is not an
override marker: it is to stop restating protected names in documentation and point at the file that owns
them, which is what happened when a line in `docs/SCHEDULING.md` named the live-trading flag literally. No
override marker was created then and none was created now. If a reviewer wants the exact identifiers, they
are one `grep` away in the file named above. So:

1. Any commit implementing D2b **will be blocked** until reviewed. That is the mechanism working.
2. **`.git/ALLOW_PROTECTED_EDIT` must not be created by an agent.** It is a human authorization.
3. The `README.md:128` hard limit — *"No live order in any asset class without D1 → D2 → D3 and explicit
   human sign-off at D3"* — raises a definitional question this document **cannot answer for the owner**:
   **is an order to an IBKR paper account a "live order"** for the purposes of that limit? It risks no
   money and it does reach a broker over a real socket. Both readings are defensible. Tyler decides, and
   the answer should be written into `README.md` or `SELF_AWARENESS_SPEC.md` so it is not re-litigated.

## 9. What was asked of Tyler, and what he answered

**Answered 2026-09-29 — see the status block at the top.** (1) No, not yet: the rung is declined and the
log-only journal continues. (2) Yes: a paper-account order is a live order, so it carries the D3 gate.
(3) is therefore moot — `SELF_AWARENESS_SPEC.md` is not amended and the ladder is unchanged. (4) stands
as an unmet precondition for any future revisit. The original wording follows.



1. **Should D2b exist at all?**, given it buys zero statistical power and the spec's own recommendation is
   to stay log-only until fill realism is the binding uncertainty. A "no, not yet" is a complete answer
   and costs nothing.
2. **Is a paper-account order a "live order"** under the `README.md` hard limit?
3. **If yes to (1): amend `SELF_AWARENESS_SPEC.md` explicitly** to add the rung. It is not there now, and
   no amount of building makes it there.
4. **Does the demonstrated-alert-path precondition (§6) hold?** Recommended: yes, and it is currently
   unmet.

Until (1) and (3) are answered, the correct next work is the D2 path that already exists: collect the
panel, make the first `paper` run by hand, and accumulate periods. Nothing in this proposal should be
started before that.
