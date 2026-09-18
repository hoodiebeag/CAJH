# CAJH as an analyst, not a ruleset

Direction set by the owner on 2026-09-18: stop searching for a mechanical strategy,
and give the agent discretion — decide positions from indicators, news, price action
and whatever else it can read, the way a financial analyst would.

This document is the architecture and, more importantly, the reasoning that constrains
it. It exists because the single most dangerous property of this design is that it is
easy to evaluate badly and feel good about it.

## Why this clears the project's own bar

Sixteen mechanisms are closed in `VERDICTS.md`. Every one of them was a transform of
the same OHLCV panel. The standing rule for opening a new line is a genuinely new
**information source**, not a new parameterisation — and an analyst that reads
headlines, filings and guidance is reading something no ranking rule in this repository
has ever seen. That clears the bar legitimately.

It is also the first design here whose ceiling is not set by the price panel. That is
the honest argument for it.

## The thing that makes this different from everything before it: you cannot backtest it

**This is not "backtesting is hard here". The evaluation is structurally invalid.**

Ask a language model what it would do with AAPL in March 2023 and it already knows what
happened. Market history is in the weights. There is no code fix, no holdout split and
no careful windowing that removes it, because the contamination is not in the data
pipeline — it is in the thing making the decision.

And it fails in the worst possible direction: a contaminated backtest flatters the agent
precisely where you most want to believe it. Every lookahead bug this project has caught
so far — the adjustment-basis hazard, the fit-on-the-outcome window, the reproduction
check that returned −4.20% — was catchable by reading code. This one is not.

Three consequences, all binding:

1. **Forward paper trading is the measurement instrument, not a safety ritual.** It is
   the only source of uncontaminated evidence about this agent. The safe path and the
   valid-science path happen to be the same path.
2. **Statistical power takes months.** `ALPHA_DEFINITION.md` §3's standing minimum — 60
   days and 50 trades — is a floor, not a target, and it is a floor reached in real time.
3. **An anonymised mode is worth building as a weak check.** Strip tickers and dates,
   present "Asset A / Asset B" with indicator values only. It tests whether the reasoning
   is coherent without letting the model recognise the setup. It destroys news
   integration entirely, so it is a sanity check on reasoning quality and *not* evidence
   of edge.

## The two gates do not relax. One of them gets sharper

Discretion changes nothing about what counts as a result.

| Bar | Value | Source |
|---|---|---|
| Equal-weight baseline, sp500-128 | **+68.86% net** | `VERDICTS.md`, corrected 2026-09-11 |
| Matched random-selection null, 13-name weekly decile book | **+33.70% net, Sharpe 0.850** | residual study; replicated at 0.827 by the illiquidity study |
| Long-short version of the same geometry | **−29.43%** | residual study |

If the analyst holds roughly a decile of this universe and rotates weekly, it inherits
that null *exactly*. An agent that produces excellent prose and +40% has lost to a coin
flip. So the matched random control is not a post-hoc study — it runs **inside the
journal**, every batch, as a live readout. Skill has to be separable from luck while the
track record is being built, not afterwards.

## Architecture

```
analyst/risk.mjs      deterministic veto layer — BUILT, 32 tests
analyst/journal.mjs   append-only decision log + matched random control
analyst/context.mjs   what the analyst sees; snapshotted and hashed for exact replay
analyst/decide.mjs    one batched model call over the whole cross-section
```

`paper.mjs` is already the D2 runner and cannot reach a venue by construction.
`scoreCandidate` / `promotionGate` are generic enough to score this.

### The model proposes, deterministic code disposes

`analyst/risk.mjs` contains no model and does no I/O. Pure, synchronous, fully tested.
The reason limits live there rather than in a prompt is that **a prompt instruction is a
request, and an unattended agent's request to itself is not a boundary.** This project
already established that: the pre-commit hook exists because an adversarial review in
2026-08 found that telling a loop "never edit these functions" constrained nothing.

The envelope, and why each rule is there rather than being a generic fear:

| Rule | Value | Why this one |
|---|---|---|
| No leverage | gross ≤ 100% NAV | converts "wrong" into "wiped out" |
| Per position | ≤ 10% NAV | matches the decile scale the existing evidence is denominated in |
| Per asset class | ≤ 35% | stops the least-verified class becoming the book |
| Per sector | ≤ 25% | "buy the ten best names" reliably returns ten of the same trade |
| Drawdown halt | −15% from peak | circuit breaker on the hypothesis, not a stop-loss |
| Daily loss brake | −5% | one bad context window should not restructure the book |
| New positions/batch | ≤ 5 | a regime call acted on across every name at once |
| Liquidity floor | ≤ 1% of median dollar volume | every backtest here assumes a fill at the close |
| Quote staleness | ≤ 15 min | IBKR delayed quotes arrive ~2.76h stale on this account |
| No averaging down | — | how a wrong thesis becomes a large wrong thesis; the move a confident narrative generator is most likely to justify |
| No shorting | until borrow verified | UNKNOWN on 128/128 symbols |
| No options | — | structurally unsuitable; VRP tested and failed |

Closing a position is always permitted. Limits exist to stop risk being **added**.

A rejected proposal is rejected, never silently resized — a trimmed order would put a
trade in the journal that nobody proposed.

### Asset classes enter one at a time, on evidence

The owner's instruction is "anything it can — equities, crypto, forex, prediction
markets". That is right as an architecture target and wrong as a switch-on order, for one
specific reason: **FEE-SCHEDULE-REBASE (2026-08-08) found this project's cost assumptions
were roughly half the real rate**, and correcting them changed results.

Forex spreads, IBKR crypto spreads and ForecastEx event-contract mechanics are three
entirely different cost structures, none measured here. So `CLASS_STATUS` gates each
class on a **verified cost model and verified executability**:

| Class | Status | Blocker |
|---|---|---|
| US equity | verified | — |
| Crypto | paper | IBKR spreads unmeasured; two vendors once disagreed 34% on identical names |
| Forex | paper | IDEALPRO spread structure unmeasured |
| Event contracts | paper | settlement and spread unmeasured, thin books |
| Options | forbidden | structurally unsuitable |

Paper classes still run, are still journalled, and are still scored. They just cannot
reach a venue. A class graduates when someone measures it.

### Every decision is replayable

The journal records the proposal, the thesis, the full context **hash**, and the matched
random control for that batch. A decision that cannot be replayed exactly cannot be
audited, and a thesis that was never written down cannot be scored against what actually
happened — which is the one thing that makes a discretionary track record worth more than
its P&L number.

## News

Chosen source: **IBKR via the Gateway.** It was picked against the owner's stated criteria
— hands-off, cheap, fast, reliable — and it wins on all four: no second vendor, no extra
key or billing, one integration already required for the sector map, and headlines arrive
**broker-timestamped**. That last point is the substantive one. Free news tiers give
publication time, not availability time, and articles get silently revised; using them for
a timestamped decision log imports a lookahead bug that looks exactly like alpha.

## Standing constraints, unchanged by this pivot

- `LIVE_TRADING` stays off. D1 → D2 → D3 is unchanged and a document in this repository
  is not a human at the D3 gate.
- Maximum autonomy is granted **inside** the envelope. There is no forward track record
  yet, so there is nothing that has earned a wider one — and per the contamination
  argument above, paper is where the evidence has to come from regardless.
- Protected live-trading logic is untouched, and `.git/ALLOW_PROTECTED_EDIT` is never
  created.
