# Multiple-Comparisons Audit (2026-08-19)

Pre-registered task: `MULTIPLE-COMPARISONS-AUDIT` (`.agent_state.json` work_queue). This
project has run many pre-registered studies against overlapping data without ever
quantifying the multiple-comparisons exposure across the whole program. This document does
that. **It changes no recorded verdict** — every row in VERDICTS.md stands as written. It
exists to state, honestly and for the first time, what a *new* PASS would actually be worth
given everything already tested, and to bind that answer into process (AGENT_PROTOCOL.md)
so it doesn't sit here unread.

## 1. The count is stale, and that staleness is itself the finding

The work_queue item that opened this audit said "roughly 14 pre-registered studies... zero
PASS." That was accurate when it was written. It is no longer accurate — the batch that
opened alongside it (derivatives-gate studies, exit-structure studies, the seasonality
breakdown) more than tripled the real count before this audit ran. **This is the exact
failure mode a look-elsewhere correction exists to prevent: the informal sense of "how many
things have we tried" lags the real number, silently, while the real number keeps climbing.**
Any alpha threshold pinned to "roughly 14" would already be wrong.

**Full inventory, VERDICTS.md rows deduplicated + one item from ROADMAP.md not in
VERDICTS.md at all:**

- VERDICTS.md carries 48 table rows.
- 3 are not independent studies and are excluded from the count: `Roadmap v2` (flagged
  DUPLICATE, explicitly "not staged" — never run), `PWR3` and `PWR4` (both explicitly "done
  — result folded into" the Low-vol B4 and Classifier P5 rows — same study, not a second
  one).
- `T4-PORTFOLIO-MOMENTUM` and `T4-COVERAGE-FIX` are the same study (a coverage-bug rerun of
  the same four variants, verdict unchanged) — counted once, not twice.
- That leaves **44 distinct studies in VERDICTS.md.**
- `SEASONALITY-DAYOFWEEK-SESSION` (ROADMAP.md, 2026-08-18) is a real study — 20 reported
  cells across day-of-week and session axes for both `breakout`/`anticipate` — but it never
  got a VERDICTS.md row because it is explicitly descriptive/exploratory by its own task
  wording, not gated. It belongs in the count regardless: a descriptive breakdown still
  consumes the same holdout window, and its own writeup already flags the exact risk this
  audit is about ("slicing seven ways and picking the best-looking cell is
  multiple-comparisons p-hacking almost by construction").

**Total: 51 studies conducted to date** (updated 2026-08-22 by EQUITIES-ALL-FAMILIES-BASELINE
— all 12 `tournament.mjs` families run unmodified against the same cached equity universe
already examined by `EQUITIES-BASELINE-PORT`/`EQUITIES-BREAKOUT-SIGNIFICANCE`/
`EQUITIES-COST-ASSUMPTION-SENSITIVITY`; no p-value, no pre-registered gate, no pass/fail
claim of any kind — a breadth measurement only, reported gross/net avgR and trade count per
family with none promoted. Joins the Descriptive/no-gate bucket below (now 3), not the
economic-gate bucket, per its own done_when's explicit "no family promoted" constraint — a
51st study. Previously updated 2026-08-22 by PER-EPOCH-GROSS-EDGE — a
point-estimate/trade-count gate (avgR>0.10 AND trades>=150 AND positiveAssets/assets>=0.5,
the same gate ZERO-COST-FLOOR-ALL-FAMILIES pre-registered, reused verbatim) evaluated per
epoch per family (5 epochs x 2 families = 10 sub-gates, on SIGNAL-DECAY-TEMPORAL-STABILITY's
existing epoch boundaries, zero-cost gross) against `breakout`/`anticipate`; 0/10 cleared it.
Counted as one study, not ten, matching ZERO-COST-FLOOR-ALL-FAMILIES's own precedent of
counting a multi-sub-gate run as a single entry — a 50th study. Previously updated 2026-08-22
by ZERO-COST-FLOOR-ALL-FAMILIES — a real point-estimate/trade-count gate, avgR>0.10 AND
trades>=150 AND positiveAssets/assets>=0.5, against all 12 `tournament.mjs` families at zero
cost, 0/12 cleared it; joined the economic-gate-only bucket below, a 49th study. Previously
updated 2026-08-21 post-audit by EQUITIES-BREAKOUT-SIGNIFICANCE — see its own row in the
Formal NHST table below and ROADMAP.md, not VERDICTS.md, since it cleared no gate — a 48th
study; the prior post-audit update, CROSS-SECTIONAL-NONPRICE-RANK, brought the count to 47),
not 14.
Breakdown by kind:

| Kind | Count | What it means for this audit |
|---|---:|---|
| Formal NHST (reports a p-value against a pre-registered gate) | 8 studies / 11 sub-tests | Section 2 — a real FWER/FDR computation applies |
| Economic-gate-only (point-estimate threshold, no p-value/null distribution) | 35 (see PER-EPOCH-GROSS-EDGE note above; §3's "33" below is pre-this-study and not rewritten here — see that section's own staleness framing) | Section 3 — classical alpha math doesn't transfer cleanly; discussed qualitatively |
| Non-verdict (a gate failed before holdout was ever examined) | 6 (H11, FUNDING-MEANREV, ONCHAIN-FLOW-GATE, FIB-PULLBACK, VOL-CONFIRM-BREAKOUT, PAIRS-COINTEGRATION-STATARB) | Consumed zero holdout looks — train-gate, data-gate, or (new with PAIRS-COINTEGRATION-STATARB) internal-screen-gate failures, holdout never examined. Not part of either look-elsewhere pool. PAIRS-COINTEGRATION-STATARB differs from the other five: its gate wasn't missing data, it was its own internal, ALREADY BH-FDR-corrected 105-pair Engle-Granger screen (0/105 survived q=0.05) — a self-contained formal-NHST family that doesn't feed Section 2's 9-sub-test table, since it was corrected within the study rather than needing retroactive cross-study correction. |
| Descriptive / no gate at all | 3 (T1-ZEROCOST informal 8-family screen, SEASONALITY-DAYOFWEEK-SESSION, EQUITIES-ALL-FAMILIES-BASELINE) | No pass/fail claim was ever made, so nothing to correct — but the holdout window was looked at, which matters for Section 4 |
| Informal, pre-dates any written protocol (pre-2026-08-04) | 3 (Trade intensity, Order-flow pooled, MR1) | No p-value, no formal gate on record; included for honesty, excluded from every quantitative computation below |

Zero true PASS exists anywhere in the 45. One row (`B5-REVERSAL-PHASE3-FUTURES-COST`) reads
"WEAK PASS on the literal pre-registered gate" but is immediately superseded in the same
study by `B5-REVERSAL-PHASE4-PORTFOLIO-SIM`'s FAIL under a stricter, more realistic
(portfolio-simulation) judge — never promoted, never a live candidate.

## 2. The formal-significance subfamily: a real FWER/FDR computation

Eleven sub-tests across eight studies report an actual p-value against the project's
pre-registered `p<0.05` significance gate (`MOMENTUM_SPEC.md §6` clause 1, and the
classifier spec's equivalent permutation-null clause). These are the only results in this
project where classical multiple-comparisons math applies without qualification, because
they're the only ones with an actual null distribution behind them.

| Rank | Study | p-value | Sign correct? |
|---:|---|---:|---|
| 1 | B5-REVERSAL L=3 (train) | 0.0010 | yes |
| 2 | CLASSIFIER-FUNDING-FEATURE (holdout, primary) | 0.0099 | yes |
| 3 | Classifier P5 (holdout, primary) | 0.0198 | yes |
| 4 | Low-vol B4 negBeta (train) | 0.0579 | yes |
| 5 | CROSS-SECTIONAL-NONPRICE-RANK (train, OI-change primary IC) | 0.1249 | **no** (wrong sign) |
| 6 | EQUITIES-BREAKOUT-SIGNIFICANCE (holdout, primary) | 0.2036 | yes |
| 7 | Low-vol B4 negVol (train) | 0.2278 | yes |
| 8 | B5-REVERSAL L=5 (train) | 0.4226 | yes |
| 9 | MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train) | 0.4266 | yes |
| 10 | MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train) | 0.6024 | **no** (wrong sign) |
| 11 | Momentum M7 (train, residual IC) | 0.7013 | yes |

**Naive FWER, k=11, alpha=0.05:** 1 − (1 − 0.05)^11 = **0.431** (assuming independence,
which these tests only partially satisfy — see caveat below). Over a family this size, more
than a 2-in-5 chance of at least one nominal "significant" hit existed even if every single
underlying effect were exactly zero. Three did clear p<0.05 (ranks 1–3 above) — informative,
but this alone doesn't say anything about which are real.

**Benjamini-Hochberg FDR at q=0.05** (critical value for rank *i* of 11 is `(i/11)×0.05`):

| Rank *i* | p-value | Threshold (i/11)×0.05 | Survives? |
|---:|---:|---:|---|
| 1 | 0.0010 | 0.00455 | **yes** |
| 2 | 0.0099 | 0.00909 | no — 0.0099 > 0.00909 |
| 3 | 0.0198 | 0.01364 | no |
| 4–11 | 0.0579–0.7013 | 0.01818–0.05 | no |

**Only B5-REVERSAL (L=3) survives family-wise BH-FDR correction at q=0.05 now that the
family has grown to 11.** `EQUITIES-BREAKOUT-SIGNIFICANCE` (2026-08-21) added `breakout`'s
sign-flip permutation p-value (0.2036, correct sign — the point estimate is positive as
pre-registered) as the 11th test; it ranks 6th by raw p-value and comes nowhere close to
surviving (q=0.358). **The material side effect, stated because it would be dishonest not
to: `CLASSIFIER-FUNDING-FEATURE` flips from survivor to non-survivor purely because the
family grew.** Its own p-value (0.0099) is unchanged — but the rank-2 BH-FDR threshold
tightens from `2/10×0.05=0.0100` (it survived, by 0.0001) to `2/11×0.05=0.00909` (it no
longer does). This is not new information about `CLASSIFIER-FUNDING-FEATURE` itself; it is
the look-elsewhere effect this section warned about in the abstract, now observed in
practice for the first time in this project's history — exactly why the binding rule is
"recompute across the whole family," not "grandfather in prior survivors." Unchanged by
CROSS-SECTIONAL-NONPRICE-RANK (already the 10th test, 2026-08-19): its own train IC came
back wrong-signed and nowhere near p<0.05 in isolation (p=0.1249; q=0.2748 after this
recomputation), so it doesn't get close to surviving either bar — one more non-hit, not a
new near-miss. Classifier P5's originally-reported "clears p<0.05" result (p=0.0198) still
does **not** survive correction — unchanged from the prior recomputation: P5 was already
KILLED on the separate, independently-required economic clause (its best-scoring subset
still nets -0.46R/trade after cost), so this correction doesn't flip any verdict, it just
keeps removing a claim ("statistically significant") that shouldn't have been read as
surviving multiple comparisons in isolation.

**A genuinely surprising pattern, stated with its caveat.** Under a null of "no real effect
anywhere in this family," P(at least 3 of 11 independent trials clear p<0.05) ≈ **1.44%**
(exact binomial, n=11, p=0.05, updated from the prior n=10 figure of 1.15% now that
EQUITIES-BREAKOUT-SIGNIFICANCE has added an 11th, non-hit, test) — getting 3 hits by pure
chance alone is still unlikely. Read at face value this would suggest at least one of these
three signals is real. **The caveat that matters:** these eleven tests are not independent
draws. B5-REVERSAL L=3/L=5 share the same underlying reversal mechanism and overlapping
data; CLASSIFIER-FUNDING-FEATURE is P5's own model plus one covariate, built on the same
classifier and much of the same holdout rows. Correlated tests cluster hits and misses
together more than independent ones do, which makes "3 hits" less surprising than the naive
binomial number suggests — the 1.44% figure is a useful anchor, not a rigorous p-value for
the meta-question. **The honest reading:** this project has three separate lines of evidence
(a short-horizon reversal signal, an entry-time classifier, and a funding-augmented version
of that classifier) that are *statistically real and economically dead* — not noise, not a
coding bug, but real effects too small for this project's actual trading costs (~1.7%
round-trip) to ever monetize. That is a materially different, more informative conclusion
than "still no edge," and it is consistent with every one of these three rows' own
individually-recorded verdicts. `EQUITIES-BREAKOUT-SIGNIFICANCE` adds a fourth, differently
shaped data point: a positive point estimate on a real-cost, real-data holdout that is
*not yet distinguishable from noise* at all (CI includes zero, p=0.2036) — thinner sample,
not (yet) a confirmed effect of any kind, real or dead.

## 3. The economic-gate subfamily: why classical FWER doesn't transfer, and what does

33 studies (see Section 1 table) never computed a p-value at all — they check a point
estimate (holdout avgR, trade count, positive-asset fraction) against a fixed pre-registered
threshold. There is no null distribution behind "avgR > -0.30," so "P(false positive) at
alpha=0.05" is not a well-defined question for this subfamily, and computing
1-(1-0.05)^33 = 0.82 (or across all 33+ gate studies, 1-(1-0.05)^45 ≈ 0.90 including the NHST
ones) would be a category error dressed up as rigor — it borrows a formula whose assumptions
(a known false-positive rate per test) don't hold here.

What *does* apply, and matters more for this project's actual risk: **the look-elsewhere
effect only threatens verdicts that are close to their own gate.** It does not threaten a
result that misses by 3-5x. Checking that directly:

- Every one of the 33 gate-based FAILs misses its avgR threshold by a wide margin. The
  threshold is uniformly `avgR > -0.30` (or `>0` for the stricter/portfolio-level studies);
  actual holdout avgR across this subfamily runs from roughly **-0.57 to -1.65** —
  2 to 5.5x past the gate, not a coin-flip near the line. `SCALED-EXIT-LADDER-CONFIRMATORY`'s
  best cell of 36 came in at -0.8547 against a >0 gate; `WIDE-STOP-HIGH-TARGET-ASYMMETRY`'s
  best of 50 at -0.9066. **No cell in any grid search in this project has ever landed near a
  gate boundary.** Multiple comparisons cannot be responsible for turning a true PASS into a
  recorded FAIL here — there is no borderline result anywhere to re-litigate, and this audit
  changes none.
- The real exposure is **forward-looking**: with 33 gate-based attempts already spent and
  more queued, the probability that some *future* marginal result clears its gate by chance
  alone (rather than by real edge) is real and rising, precisely because none of the 33 to
  date give any indication that noise alone produces a near-miss on this problem — meaning a
  future near-miss PASS would be the first result of its kind in the whole project's history,
  which should itself raise suspicion rather than lower it.

## 4. Holdout-window reuse — the part the alpha math can't see

This is the more material risk than either FWER computation above, because reused data
biases every subsequent test's effective false-positive rate upward in a way pure
alpha-counting doesn't capture.

- **The calendar split (train: earliest–2025-06-01, holdout: 2025-06-01–present) is the
  primary holdout for the 28-asset active watchlist and has been used, unmodified, by at
  least 26 of the 33 economic-gate studies** (every `breakout`/`anticipate`-family gate study
  from T1B-BREAKOUT-COSTFIX through ROLLING-VOLATILITY-REGIME-TIMING) plus the SEASONALITY
  descriptive breakdown. This window is not a fresh judge for any new price-structure family
  test at this point — it has been examined roughly 27 separate times.
- **The whole-symbol cross-sectional split** (`STABLE_13` train / watchlist-minus-STABLE_13
  holdout) underlies the 6 NHST studies in Section 2 (9 sub-tests) — a separate axis from the
  calendar split, but reused across all 9 of those sub-tests, which is exactly what makes the
  BH-FDR correction in Section 2 necessary rather than optional.
- **The ad-hoc "16-symbol held-out universe"** used by `B5-REVERSAL-PHASE3-FUTURES-COST` and
  `B5-REVERSAL-PHASE4-PORTFOLIO-SIM` (both 2026-08-13) is a third, genuinely different
  construction (held out by symbol, not by time) — but it predates and is unrelated to the
  formal sealed-symbol infrastructure below, was assembled ad hoc for that one study, and has
  already been drawn on twice (a WEAK PASS immediately superseded by a FAIL under a stricter
  judge).
- **Two genuinely unused resources already exist in this codebase**, built 2026-08-14
  (`JUDGE-WALKFORWARD-SYMBOL-HOLDOUT`, `researchlib.mjs`) but never invoked by any study
  since:
  - **`SEALED_SYMBOLS`** — a frozen five-symbol pool (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI`),
    chosen once and explicitly reserved for the one-time final validation of a candidate that
    has already cleared its normal train/holdout gate — never to be touched before that.
    Confirmed by direct grep: referenced only in `researchlib.mjs` (definition),
    `researchlib.test.mjs` (unit tests), and this documentation — **no study module
    (`tournament.mjs`, `momentum.mjs`, or any `.mjs` analytics study) has ever imported or
    used it.** This is the one genuinely fresh, never-examined resource in the whole project.
  - **`walkForwardWindows` / `walkForwardSeriesWindows`** — a rolling multi-fold harness that
    replaces one static train/holdout cut with several tiled, non-overlapping folds. Built,
    tested, never called by any study to date. Note this is a different *lens* on the same
    already-examined calendar data, not fresh data — useful for robustness, but it does not
    substitute for the symbol seal above when the question is "genuinely unseen holdout."

**Explicit answer to "how many genuinely independent holdout windows remain unused":
one.** The `SEALED_SYMBOLS` five-symbol pool is the only holdout resource in this project
that has never been looked at by any train/holdout cycle. Beyond that, the only way to get a
truly fresh look is to wait for new candle data to accrue past this audit's date
(2026-08-19) and pre-register a new split boundary before the next price-structure study
runs — the existing 2025-06-01–present window is spent for that family.

## 5. Binding threshold for future studies

The concrete, binding rule (not just narrative here) is written into
`AGENT_PROTOCOL.md`'s new "Multiple-comparisons discipline" section. Summary:

- **Formal NHST studies** (anything reporting a p-value against a pre-registered
  significance gate): a new result is only credible as "statistically significant" if it
  survives a **BH-FDR recomputation across all NHST p-values to date (this document's 11),
  at q=0.05** — not evaluated against alpha=0.05 in isolation. The family-size
  counter (currently 11) must be updated in that section every time a new NHST test is added,
  whether it passes or fails.
- **Economic-gate studies**: no p-value exists to correct, so the discipline is structural
  instead — (a) the family-size counter (currently 33) is kept current in the same section so
  "how many have we tried" stays an honest, mechanically-maintained number, not a narrative
  estimate; (b) any future result that clears its literal gate is treated as provisional, not
  a live candidate, until it also clears the same gate on the `SEALED_SYMBOLS` pool (the one
  resource confirmed never yet examined) — a near-miss PASS on the already-burned watchlist
  is exactly the failure mode 33 consecutive decisive FAILs give no precedent for trusting;
  (c) the 2025-06-01–present calendar holdout is retired as a "fresh" judge for the
  28-asset active pool — any new price-structure family test either uses data collected after
  2026-08-19 or explicitly discloses it is re-examining spent data.

No existing verdict changes as a result of this audit.
