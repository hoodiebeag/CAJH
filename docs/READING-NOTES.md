# Reading notes: four trading books, and what does and does not transfer

**This is not knowledge this project has established.** `docs/WHAT-WE-KNOW.md` is that file, and every
number in it was measured here. This one is second-hand reading, recorded so the ideas are available
as *audit prompts and hypotheses* without being mistaken for results.

Compiled 2026-09-26 at the owner's request, from a synthesis he supplied.

## What this is, stated before anything else

- **Not cover-to-cover reading.** The synthesis was assembled from publisher pages, a licensed
  sample (preface and table of contents), an author interview transcript, an author's own resource
  site, and an independent academic review. It is an accessible synthesis, not a substitute for the
  books.
- **The URLs below are recorded as supplied and were not fetched from this container.** Nothing here
  was verified against the primary texts by this repository. Treat every attributed claim as
  "reported to say", not "says".
- **No book validates an edge in CAJH.** Four books are not four independent confirmations, and they
  cannot be combined into a proven method. Two of them actively contradict each other on whether
  strategy archetypes are worth copying at all.
- **No numeric rule, threshold, position size, asset class, order type or routing policy is approved
  by this note.** Where a source supplies numbers — forecast scalars, volatility targets, leverage,
  diversification multipliers — they are recorded as *not importable* without data validation,
  forward paper evidence, and the owner's sign-off.
- **This note is deliberately NOT wired into the model's context.** `context.js` reads a declared
  digest marker out of `WHAT-WE-KNOW.md`; this file has no such marker on purpose. Putting reading
  notes in front of the decider would be a behaviour change, not a documentation change, and it
  belongs to a separate decision. See "If this is to reach the analyst" at the end.

Where the existing rules and this note could be read as disagreeing, the existing rules win: the
hard limits in `README.md`, the pre-registered criteria in `docs/PAPER-PROTOCOL.md`, the
protected-logic check with human sign-off at D3, live trading halted, and the standing prohibition on
treating a historical LLM decision as a valid backtest. **A book's generic advice about backtesting
cannot cure the fact that the decider already knows what happened.** That is the load-bearing
constraint here and no amount of reading moves it.

Each section below separates three things, because collapsing them is how a book becomes a mandate:

| tier | meaning |
|---|---|
| **Claim** | what the source is reported to say. Attributed, not endorsed. |
| **Hypothesis** | something CAJH could actually test forward, or an audit it could run. |
| **Extrapolation** | a leap someone might make from the claim that this note does **not** support. |

---

## Market Wizards — Jack D. Schwager (updated 2012)

Sources as supplied:
- https://www.wiley.com/en-us/market-wizards-interviews-with-top-traders-updated-p-9781118273050
- https://assets.cmcmarkets.com/pdfs/theartfultrader-transcription_episode5schwager.pdf

**Claims.** Interview-based, not a recipe. The traders' methods differed from and sometimes
contradicted one another. Schwager is reported to name methodology plus mental attitude, respect for
risk management, flexibility, patience, and developing one's own method rather than copying a
successful trader. In discussing Bruce Kovner: know the exit before entering. Risk management is
described as central.

**Hypotheses for CAJH.**
- Journal each decision's thesis *together with* its risk and exit assumptions and what would
  invalidate it — before the outcome is known. CAJH already journals the thesis and the matched
  random control; whether an *invalidation condition* is recorded per decision is a gap this
  suggests looking at.
- Compare each decision against its realised outcome without hindsight editing. The append-only
  journal and separate `settle` step already enforce this structurally.
- Keep an explicit human review gate. Already the case at D3, and criterion 9 of the paper protocol
  already asks whether each thesis states a reason that could be wrong.

**Extrapolations this note does not support.**
- That any interviewed trader's approach is reproducible. These are survivor-selected anecdotes; the
  traders who used similar methods and failed were not interviewed.
- That "respect for risk management" licenses a specific number. The source specifies no safe
  numeric risk limit for CAJH, and this note invents none.
- That "develop your own method" or "flexibility" licenses discretionary overrides of the risk gate.
  It does not. The gate is deterministic for reasons unrelated to this book.

---

## Algorithmic Trading — Ernest P. Chan (2013)

Sources as supplied:
- https://www.wiley.com/en-us/Algorithmic+Trading%3A+Winning+Strategies+and+Their+Rationale-p-9781118746912
- https://cdn.libreka.de/sample/01acf69c-1b5b-4603-90c1-bffcbdfab552 (licensed sample: preface, TOC)

**Claims.** Eight chapters covering backtesting and execution, mean reversion (including stocks/ETFs
and currency/futures cases), interday and intraday momentum, and risk management. The preface is
reported to emphasise economic rationale; simple and linear methods as a defence against data
snooping; the time-series versus cross-sectional distinction; regime shifts; survivorship bias and
data errors; implementation and transaction detail; short-sale constraints; non-Gaussian tail risk;
and Monte Carlo simulation.

**Hypotheses for CAJH.**
- Classify any proposed hypothesis as momentum or mean reversion, and state its economic rationale,
  its required data, and its failure mode, before testing it.
- Audit for lookahead, data provenance, selection bias and costs. CAJH has hard-won instances of
  each: `contextIsPointInTime` for lookahead, `PROVENANCE.json` and the single-vendor rule for
  provenance, `screenUniverse` for a corrupted series that a liquidity screen selected, and
  `costs.mjs` for the cost model.
- Ask whether a regime change would undermine a relationship before relying on it. The paper
  protocol already records that twenty days is one regime.

**Extrapolations this note does not support.**
- That the book's example strategies can be transplanted. They are examples, tested on other data,
  in other asset classes.
- **That the book's backtesting guidance rehabilitates backtesting here.** It does not and cannot.
  Chan's advice addresses pipeline contamination; CAJH's problem is contamination in the *decider*,
  which no holdout split, walk-forward scheme or Monte Carlo addresses. Sixteen mechanisms were
  already closed here against a matched random control; none of that is re-openable by this book.
- That forex or futures mechanics apply. CAJH is equity-only, and `CLASS_STATUS` in
  `analyst/risk.mjs` gates any asset class on a verified cost model and verified executability.
- That statistical significance can be inferred from a historical LLM run. It cannot, at any sample
  size.

---

## Systematic Trading — Robert Carver (2015)

Sources as supplied:
- https://www.systematicmoney.org/systematic-trading-information
- https://www.systematicmoney.org/systematic-trading-resources
- https://harriman.house/authors/robert-carver/systematic-trading/9780857194459

**Claims.** Structured around systematic rules; fitting and portfolio allocation; instruments;
forecasts and combined forecasts; volatility targeting; position sizing; portfolios; speed and size;
and semi-automatic practice. The author's resource pages are reported to supply forecast scalars and
weights, diversification multipliers, and cost and execution examples. Carver is reported to warn
against over-complication, optimism, excessive risk and frequent trading, and to position the risk
framework as usable with *discretionary* forecasts.

**Hypotheses for CAJH.**
- Keep the signal/forecast, the risk sizing, and the executable-order gate as separate layers. CAJH
  is already built this way: the model proposes, `risk.mjs` vetoes deterministically, and rejected
  proposals are rejected rather than silently resized.
- Log which forecasts conflict, the freshness of the volatility estimate, concentration, projected
  turnover and cost, and total portfolio exposure. Freshness and exposure are partly journalled
  today; *conflict between signals* and *projected turnover* are not, and that is a gap worth
  examining.
- Evaluate any sizing method under conservative assumptions rather than central ones.
- The claim that a risk framework can sit under a discretionary forecast is the closest thing in
  these four books to a description of CAJH's actual architecture. That is an interesting
  convergence and **not** evidence the architecture works.

**Extrapolations this note does not support.**
- Importing any forecast weight, volatility target, leverage figure or diversification multiplier.
  Explicitly out of scope without data validation, paper evidence, and the owner's sign-off.
- That "warns against frequent trading" implies a specific holding period. CAJH's hold length was
  already examined here and measured: per-period noise falls as √hold while period count rises
  linearly, so they cancel — the lever is closed, and that finding stands on its own measurement.
- That the book's cross-asset examples say anything about CAJH's edge.

---

## Trading and Exchanges — Larry Harris (2002)

Sources as supplied:
- https://ideas.repec.org/b/oxp/obooks/9780195144703.html
- https://www.bostonfed.org/-/media/Documents/nerr/q204bookreview.pdf (independent review, FRB Boston)
- https://books.google.com/books/about/Trading_and_Exchanges.html?id=t-TQCwAAQBAJ

**Claims.** Covers participants and their motives, market mechanisms, market/limit/stop orders,
priority rules, liquidity, information asymmetry, dealer spreads and adverse selection, exchange
practices and misconduct. The review is reported to explain that market orders demand immediacy and
liquidity while limit orders supply it, and that spreads compensate dealers for costs and for the
risk of informed flow.

**Hypotheses for CAJH.**
- An apparent edge must be net of spread, slippage, market impact, fees, **and the possibility of not
  executing at all**. CAJH nets costs today; *non-execution* is not currently modelled, because paper
  fills are assumed.
- Flag thin names, and treat news-driven entries as a candidate adverse-selection problem: if the
  edge is claimed to come from headlines, the counterparty may be trading on the same headline
  sooner. This is a sharp question for the one claim this design rests on.
- Make executable-size assumptions explicit rather than implicit.
- Separate decision quality from fill quality when reading any result.

**Extrapolations this note does not support.**
- That the book's 2002 market-structure detail is current. Venue rules, fee schedules and routing
  have changed substantially; any execution policy would need present-day verification.
- **That anything here authorises an order-routing or execution change.** No order type, routing
  rule, or live-trading edit is approved. `brokers/` remains protected.

---

## Cross-book memo

A defensible analyst decision, per the synthesis, needs: (a) as-of data with provenance and a stated
thesis; (b) a falsifiable risk and invalidation plan; (c) position and portfolio exposure inside the
existing hard limits; (d) explicit execution cost and liquidity assumptions; (e) append-only
decision and outcome logs with a pre-registered forward evaluation.

CAJH already has (a), (c) partially, (d) partially and (e). The visible gaps this reading surfaces —
offered as questions, not as work orders — are a recorded **invalidation condition** per decision,
**signal-conflict logging**, **projected turnover**, and **non-execution** as a modelled outcome
rather than an assumption.

**The contradictions matter more than the agreements.** Schwager rejects copying a single style;
Chan supplies strategy archetypes while warning they are prone to backtest artifacts; Carver's
structured sizing organises forecasts without establishing any; Harris points out that any gross edge
can vanish entirely on execution. Read together they do not converge on a method. They converge on
*scepticism*, which this project already had and got the harder way: sixteen mechanisms closed
against a coin flip drawing from the same slate.

## If this is to reach the analyst

The owner's stated intent is that these ideas reach CAJH. Nothing in this commit does that. The
model's context is assembled in `analyst/context.mjs` and the digest marker is read from
`WHAT-WE-KNOW.md` by `context.js`; putting reading notes into either is a change to what the decider
sees, which is a behaviour change and a separate decision.

It is also a decision with a real cost, which should be on the table before anyone makes it: feeding
a model prose about what good traders do invites it to *narrate* in that register rather than reason
about the evidence in front of it, and the journal would then contain theses that sound more
disciplined without being better. That effect would be invisible in the very readout meant to catch
it, because criterion 9 asks whether a thesis states a reason that could be wrong — and well-written
boilerplate passes that test.

If it is wanted anyway, the honest form is a short, explicitly-labelled audit checklist rather than a
summary of four books, and its effect would have to be measured forward like anything else.
