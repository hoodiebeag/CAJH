# Search-Space Exhaustion Assessment (2026-08-22)

Pre-registered task: `SEARCH-SPACE-EXHAUSTION-ASSESSMENT` (`.agent_state.json` work_queue).
Decision support for the human, not a new hypothesis test. This document changes no
recorded verdict, adds no VERDICTS.md row, and touches no strategy code — it exists to
state a conclusion the record already supports but nobody has written down in one place:
whether continued search on this project's current program is still worth the human's
spend, and on what basis. Every factual claim below cites the study or document that
established it; nothing here is restated from memory or re-derived.

## 1. What the record has established, cited to its own verdict

**The count.** 50 studies conducted to date, zero true PASS anywhere in the set
(`MULTIPLE_COMPARISONS_AUDIT.md` §1, updated 2026-08-22 by `PER-EPOCH-GROSS-EDGE`). One row
(`B5-REVERSAL-PHASE3-FUTURES-COST`) reads "WEAK PASS on the literal pre-registered gate" but
is immediately superseded in the same study by `B5-REVERSAL-PHASE4-PORTFOLIO-SIM`'s FAIL
under a stricter portfolio-simulation judge (`VERDICTS.md` rows, same names) — never promoted,
never a live candidate.

**The formal-significance subfamily is exhausted, not promising.** Eleven sub-tests across
eight studies report an actual p-value against this project's pre-registered `p<0.05` gate.
Naive family-wise error rate at k=11: 43.1% (`MULTIPLE_COMPARISONS_AUDIT.md` §2). Under
Benjamini-Hochberg FDR correction at q=0.05, **only `B5-REVERSAL (L=3)` survives** — and
`B5-REVERSAL` is itself KILLED on economics (net -0.0025 to -0.0243R per trade at the real
~1.7% round-trip cost; `VERDICTS.md` B5-REVERSAL row). `CLASSIFIER-FUNDING-FEATURE` flipped
from survivor to non-survivor purely because the family grew from 10 to 11 tests
(`EQUITIES-BREAKOUT-SIGNIFICANCE`, `ROADMAP_ARCHIVE.md` 2026-08-21 section; `MULTIPLE_COMPARISONS_AUDIT.md`
§2) — a look-elsewhere effect observed in practice, not hypothetical. Net reading: this
project has three statistically-real-but-economically-dead effects (a short-horizon reversal
signal, an entry-time classifier, and its funding-augmented variant) and one still-unresolved
positive point estimate (equities `breakout`, discussed below) — no statistically-confirmed,
economically-alive signal exists anywhere in the formal-NHST family.

**The mechanistic gate-swap program ("Template A") is exhausted by the human's own decision.**
Take a time series, fix a threshold on train, apply it as a suppression/confirmation gate on
`breakout`/`anticipate`, score holdout avgR — run 11 times with different inputs (funding,
open interest, liquidations, futures basis, long/short ratio, top traders, aggressor flow,
realized vol, trend quality, on-chain flow, seasonality). Every one failed. Mean effect across
studies that quoted comparable numbers: **-0.008R**. Required to reach breakeven from the
`breakout` baseline (-0.864R): **+0.864R** — more than 100x the largest effect ever measured.
The single largest number this project has ever moved came from the cost side, not the signal
side (`blackboard.template_a_exhausted`, `.agent_state.json` — "decided 2026-08-19, by the
human, after this comparison was run at their request"). **This is a closed program by direct
human instruction, not an open one this document is recommending against for the first time.**

**No cointegrated pairs exist in the active watchlist.** 0/105 candidate pairs survive
BH-FDR q=0.05 on a pre-registered Engle-Granger screen; the three lowest p-values (all
p=0.0050) correct to q=0.1741, more than 3x past threshold (`PAIRS-COINTEGRATION-STATARB`,
`VERDICTS.md`). The screen-gate failed before any holdout economics were ever examined — a
genuinely different mechanism class (relationship-reversion, not price-oscillation) was tried
once and found nothing to trade.

**Cross-sectional non-price ranking (the structural alternative to gating) was also killed.**
Open-interest change as a PRIMARY cross-sectional ranking signal (not a gate) came back
wrong-signed at train (meanIC=-0.0395, p=0.1249, pre-registered sign was positive) — killed
before holdout was ever gate-relevant (`CROSS-SECTIONAL-NONPRICE-RANK`, `VERDICTS.md`,
`ROADMAP_ARCHIVE.md` 2026-08-19).

**Both price-structure baselines are non-stationary, and it does not matter.** Permutation
ANOVA across 5 chronological epochs of full local history: `breakout` F(4,10499)=7.459,
p=0.000999; `anticipate` F(4,13569)=13.967, p=0.000999 — both reject stationarity decisively
(`SIGNAL-DECAY-TEMPORAL-STABILITY`, `ROADMAP_ARCHIVE.md` 2026-08-19). But neither family's avgR ever
approaches breakeven in any epoch under NET cost, and — critically, because non-stationarity
alone cannot rule out a hidden working regime buried by pooling and cost — the same question
was re-asked at zero cost, per epoch: **0/10 epoch-family cells clear a meaningfully positive
gross-edge gate** (avgR>+0.10, trades>=150, positiveAssets/assets>=0.5); `breakout` epoch 3 is
the nearest miss at +0.093 avgR, clearing the other two clauses alone
(`PER-EPOCH-GROSS-EDGE`, `ROADMAP_ARCHIVE.md` 2026-08-22). **The non-stationarity is real, but it moves
gross edge around within a band that never crosses into "meaningful," in either family, in any
of the 5 epochs measured.** This closes the specific "is there a working regime the pooled
average hides" hypothesis, not just the pooled-average question that was already closed
separately.

**Cost is the dominant, structurally-quantified lever — and even eliminating it entirely does
not rescue the crypto price-structure baselines.** Fee is exactly 94.1% of total drag for both
`breakout` and `anticipate`, by construction of the cost formula, not by measurement
coincidence (`COST-COMPONENT-ATTRIBUTION`, `ROADMAP_ARCHIVE.md` 2026-08-19). Driving fee to a literal
zero floor leaves `breakout` at +0.0091R (razor-thin, one-basis-point scale, would not survive
any real execution friction) and `anticipate` at -0.1331R (its gross edge is itself already
negative — there is nothing for a cost fix to amortize). Extended to all 12 families currently
in `tournament.mjs`: **0/12 clear a meaningfully positive gross-edge bar**
(avgR>+0.10, trades>=150, positiveAssets/assets>=0.5) — 4 families clear zero at gross
(`ma_dip`, `vol_contraction`, `breakout`, `h3`), none clears the material bar
(`ZERO-COST-FLOOR-ALL-FAMILIES`, `ROADMAP_ARCHIVE.md` 2026-08-22). The nearest miss,
`vol_contraction` (+0.2177R gross, 52.4% positive assets), fails only on trade count
(98<150) — a sample-size ceiling, not a fee problem, and there is no cost-side fix for a
sample-size problem. **The full 2-D fee×slippage grid (`COST-SENSITIVITY-SURFACE`,
`ROADMAP_ARCHIVE.md` 2026-08-20) confirms this from the other direction: `breakout` crosses net-zero
only at an idealized futures-maker/zero-slip corner that `PWR5`/`PHASE4`/
`EXECUTION-DELAY-DECAY-CURVE` already independently ruled unrealistic (real fill latency
degrades that exact execution assumption sharply); `anticipate` never crosses zero anywhere on
the grid.**

**The maker-execution thesis is closed on mechanism, not just on one cost point.**
`EXECUTION-DELAY-DECAY-CURVE` (`ROADMAP_ARCHIVE.md` 2026-08-19) directly tested the hidden assumption
every prior cost-reduction study shared — that a signal bar fills immediately — by adding real
entry-delay bars and found sharp degradation with latency. Waiting for a resting maker fill
*is* execution delay; the mechanism that would need to work for maker-cost rescue to matter is
itself what kills these families when tested directly.

**Equities is the one genuinely different result in this project's history, and it does not
yet survive its own significance test.** Porting the exact, unmodified `breakout`/`anticipate`
configs onto a real 30-symbol Dow-30-grade universe at real IBKR costs produced the first
net-positive real-cost result in this project: `breakout` net +0.1866R over 61 holdout trades
(`EQUITIES-BASELINE-PORT`, `ROADMAP_ARCHIVE.md` 2026-08-19). A pre-registered sign-flip permutation
test on that same result came back p=0.2036, 95% CI **[-0.2700, +0.6192]** — includes zero —
and does not survive the recomputed 11-test BH-FDR correction (ranks 6th of 11, q=0.358)
(`EQUITIES-BREAKOUT-SIGNIFICANCE`, `ROADMAP_ARCHIVE.md` 2026-08-21). This is not a killed result and
not a confirmed one: 61 trades over one ~7-month window is not enough sample to distinguish
signal from noise, and that item's own writeup names the specific weaknesses (single holdout
window, single 30-symbol universe, cost assumptions not measured from real NBBO data) that the
currently-queued `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`, `EQUITIES-ALL-FAMILIES-BASELINE`, and
`EQUITIES-COST-ASSUMPTION-SENSITIVITY` items exist to address.

## 2. What is genuinely untested — distinguishing "never tried" from "tried and failed"

Each item below is labeled with why it is untested and what it would cost to test, so the
human can weigh continuation against the record above rather than a vague sense of "more
might help."

| Direction | Why untested | Cost to test |
|---|---|---|
| **Equities `breakout` on a second, independent holdout** (`EQUITIES-BREAKOUT-OUT-OF-SAMPLE`, queued, depends on `EQUITIES-BREAKOUT-SIGNIFICANCE` which is done) | The one positive point estimate in the project's history has been examined on exactly one 61-trade window. Nobody has checked whether it replicates. | Low — reuses `scripts/equities-baseline-port.mjs`'s existing fetch+run path unmodified; new IBKR daily-bar fetch for a different date range, no new infrastructure. |
| **All 12 `tournament.mjs` families on equities** (`EQUITIES-ALL-FAMILIES-BASELINE`, queued) | `EQUITIES-BASELINE-PORT` only ported 2 of 12 families (`breakout`/`anticipate`). Whether the equities cost advantage generalizes to the other 10 (some of which clear zero-cost gross on crypto, e.g. `ma_dip`, `h3`) has never been checked. | Low — same harness, same cached candles, 10 more family configs. |
| **Equities cost-assumption sensitivity** (`EQUITIES-COST-ASSUMPTION-SENSITIVITY`, queued) | The equities result used an assumed 5bps slip figure, not measured NBBO tick data (`EQUITIES-BASELINE-PORT`'s own disclosure). Whether the +0.1866R result is robust to that assumption is unknown. | Low — a cost-grid re-derivation using the same exact-identity technique `COST-SENSITIVITY-SURFACE` already validated; no new data collection. |
| **Walk-forward revalidation of the baseline** (`WALKFORWARD-REVALIDATION-OF-BASELINE`, queued) | `researchlib.mjs`'s `walkForwardWindows`/`walkForwardSeriesWindows` were built 2026-08-14 and have never been invoked by any study (`MULTIPLE_COMPARISONS_AUDIT.md` §4) — every verdict in this project rests on a single chronological 70/30 split, and `SIGNAL-DECAY-TEMPORAL-STABILITY` has since shown the baseline is non-stationary, which is exactly the condition under which a single static split is least trustworthy. | Moderate — existing, tested harness; the work is running it against the already-established negative baselines and reporting whether the conclusion (net-negative) holds across folds, not searching for a new signal. |
| **Historical cost-schedule repricing** (`TIME-VARYING-COST-REPRICING`, queued) | Every backtest in this project applies one flat cost across the whole sample. `FEE-SCHEDULE-REBASE` already proved the fee assumption can be off by ~2x; whether a period-appropriate cost schedule (rather than today's rate applied retroactively) changes any conclusion has never been checked. | Moderate — reuses `cost-model.mjs`, new work is sourcing a historical fee-schedule timeline and re-running the existing exact cost-identity technique per period. |
| **Candle corpus gap audit** (`CANDLE-CORPUS-GAP-AUDIT`, queued) | Every backtest calls `loadResearchCandlesWithQuality` with `gapPolicy: 'allow'` and discards the `gaps` it returns; nobody has quantified how much missing-bar contamination sits under every reported number in this project, including the 50 studies above. | Low-moderate — the quality-reporting path already exists (`researchlib.mjs`), this is aggregation and reporting, not new data collection. |
| **A genuinely new entry-mechanism class** (not queued — no ticket exists) | `ZERO-COST-FLOOR-ALL-FAMILIES`'s own conclusion states it plainly: "any future signal work in this codebase needs a new entry mechanism, not a cost adjustment on the existing 12." All 12 current families and all 11 Template-A gate inputs are variations on OHLCV price-structure entries or filters on top of them — no fundamentally different entry mechanism (e.g. cross-market lead/lag, options-market-implied signals, macro/regime conditioning at the strategy level rather than the single-trade level) has ever been coded or tested. | **High, and undiscovered.** This is not a queued item because no specific candidate mechanism has been pre-registered — proposing one requires real design work, not a rerun of an existing harness, and the record gives no evidence about which mechanism (if any) is worth that investment. |
| **`SEALED_SYMBOLS` (`AVAX`,`LINK`,`NEAR`,`SUI`,`UNI`) — the one wholly unused holdout resource** | Reserved by design for the one-time final validation of a candidate that has already cleared its normal gate; deliberately never touched (`MULTIPLE_COMPARISONS_AUDIT.md` §4, `AGENT_PROTOCOL.md`'s binding rule). Not "untested" by oversight — untested by design, and correctly so. | N/A — spending it now, with nothing having cleared a gate to validate, would destroy the one genuinely fresh judge this project has left. |
| **Fresh calendar data (candles collected after 2026-08-19)** | The 2025-06-01–present calendar holdout has been examined ~27 times and is retired as a fresh judge for the 28-asset watchlist (`MULTIPLE_COMPARISONS_AUDIT.md` §4/§5, binding in `AGENT_PROTOCOL.md`). New data accrues passively as candle collection continues to run; no action is required to "test" this, only patience and a fresh split boundary once enough new data exists. | Zero incremental cost — this resource replenishes on its own; the only requirement is discipline (pre-register the new split boundary before running the next price-structure test on it, per the binding rule already in force). |

## 3. Pre-registered, falsifiable continuation criterion

Fixed here, before any of the items below are run, so it cannot be adjusted after seeing a
result. Continued spend on this program is justified **only if and when one of the following
is observed** — none of them are true as of this writing:

1. **`EQUITIES-BREAKOUT-OUT-OF-SAMPLE` (already queued) comes back with the same sign, and the
   pooled two-window evidence (not either window alone) either survives a BH-FDR recomputation
   on its own or is reported plainly as still not surviving.** This is the single cheapest,
   most direct test of whether the one positive lead in this project's history is real. A
   negative or non-replicating result here, combined with the equities cost-sensitivity and
   all-families items also queued, would close the equities line the same way the crypto line
   is closed above — and should be read as exactly that, not as license to try a third equities
   window.
2. **Any future economic-gate study clears its literal pre-registered threshold on the active
   watchlist AND replicates on `SEALED_SYMBOLS`** — the existing binding rule in
   `AGENT_PROTOCOL.md` already requires this before treating any gate-clearing result as a live
   candidate; it has never yet happened once in 35 economic-gate studies with zero near-misses
   (`MULTIPLE_COMPARISONS_AUDIT.md` §3).
3. **A specific, pre-registered, genuinely new entry-mechanism class (not a gate/filter on the
   existing 12 `tournament.mjs` families, not a repriced venue for the same signal) clears the
   same "meaningfully positive" gross-edge bar already established as the serious threshold in
   this project** (avgR>+0.10, trades>=150, positiveAssets/assets>=0.5 at zero cost) — the same
   bar `ZERO-COST-FLOOR-ALL-FAMILIES` and `PER-EPOCH-GROSS-EDGE` used to close the existing
   families. Until a specific candidate mechanism is proposed and pre-registered, this
   condition is not yet actionable — it names what would count, not a task to start blindly.

**Falsification, stated symmetrically:** if `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` fails to
replicate and no new entry-mechanism candidate has been proposed, condition (1) and (3) are
both closed, and — since (2) has never fired once across 35 attempts and nothing pre-registers
a reason to expect a 36th to differ — the honest reading at that point would be that this
program's specific mechanism space (price-structure entries + derivatives-gate filters, on
this venue and this cost structure) is exhausted, not merely "still negative for now."

## 4. Recommendation, stated plainly

**Do not resume general exploratory search on the crypto price-structure / derivatives-gate
program.** That program is already closed by direct human decision (`template_a_exhausted`,
2026-08-19) and independently confirmed exhausted twice more since then by
`ZERO-COST-FLOOR-ALL-FAMILIES` and `PER-EPOCH-GROSS-EDGE`: 0/12 families, 0/10 epoch-family
cells, clear a meaningfully positive gross edge on this venue at any cost structure or time
slice examined. Reopening it — a 12th Template-A gate input, a new price-structure entry
variant, another cost-reduction angle on `breakout`/`anticipate` — would be spending against a
line item that has already returned a mean effect of -0.008R across 11 tries and a maximum
theoretical improvement (zero fees) that still leaves `anticipate` structurally dead and
`breakout` at a razor-thin, non-survivable edge.

**Do pursue the three already-queued equities items** (`EQUITIES-BREAKOUT-OUT-OF-SAMPLE`,
`EQUITIES-ALL-FAMILIES-BASELINE`, `EQUITIES-COST-ASSUMPTION-SENSITIVITY`). This is the one
open, genuinely undecided question in the project, it is cheap (all three reuse existing,
already-built harnesses and cached data with no new infrastructure), and it directly
determines whether condition (1) above resolves for or against the equities lead. This is not
"more search" in the sense the rest of this document argues against — it is finishing the due
diligence on a result that already exists, which is a materially different and much
cheaper thing than starting a new hypothesis.

**Do pursue the data-integrity items** (`CANDLE-CORPUS-GAP-AUDIT`, `TEST-ISOLATION-DATADIR-LEAK`)
**and the robustness-of-the-negative-conclusion items** (`WALKFORWARD-REVALIDATION-OF-BASELINE`,
`TIME-VARYING-COST-REPRICING`) as due diligence on the "0 PASS" conclusion itself, not as
alpha search. These attack whether the negative result is trustworthy (single-split
overfitting to a specific cut, missing-bar contamination, a stale flat cost basis) rather than
searching for a positive one — genuinely different in kind from another Template-A gate, and
worth finishing before treating the crypto side of this project as fully and finally closed.

**Do not start a new entry-mechanism research line speculatively.** The record gives no
evidence about which mechanism, if any, would be worth the cost — `ZERO-COST-FLOOR-ALL-FAMILIES`
names the need in the abstract but nominates no candidate. Spending here now would be
choosing a direction with no more grounding than the 12 already-closed doors had before they
were tested. This should wait for a specific, motivated candidate, not a queue slot filled for
its own sake.

## 5. Scope discipline

No verdict in `VERDICTS.md` is rewritten by this document. No `.agent_state.json` verdict,
gate, or family-size counter is altered here (that bookkeeping belongs to the study that
produces a new result, not to this synthesis). No strategy file (`backtest.js`, `strategy.js`,
`tournament.mjs`, `bot.js`, `monitor.js`, `trader.js`, `scanner.js`, `commands.js`) is touched.
This is a synthesis of the existing record for the human's own D3-class decision about whether
and where to keep spending — the decision itself remains explicitly human-owned, as it has
been at every gate in this project's history.
