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
- `SEASONALITY-DAYOFWEEK-SESSION` (ROADMAP_ARCHIVE.md, 2026-08-18) is a real study — 20 reported
  cells across day-of-week and session axes for both `breakout`/`anticipate` — but it never
  got a VERDICTS.md row because it is explicitly descriptive/exploratory by its own task
  wording, not gated. It belongs in the count regardless: a descriptive breakdown still
  consumes the same holdout window, and its own writeup already flags the exact risk this
  audit is about ("slicing seven ways and picking the best-looking cell is
  multiple-comparisons p-hacking almost by construction").

**Total: 57 studies conducted to date** (updated 2026-08-28 by `VOL-CONTRACTION-SAMPLE-EXTENSION`
— a point-estimate/trade-count gate (avgR>0.10 AND trades>=150 AND positiveAssets/assets>=0.5,
the same gate `ZERO-COST-FLOOR-ALL-FAMILIES`/`PER-EPOCH-GROSS-EDGE` both pre-registered, reused
verbatim) re-testing `vol_contraction`'s known-large gross edge on 4 sample-extension axes
(full history, today's full watchlist, 15m entry, and all three combined). One axis (15m entry,
holdout-only, 256 trades) clears the fuller 3-leg gate outright — the first result in this
project's history to do so, not just the narrower avgR-only leg `PER-FAMILY-COST-CEILING`
already cleared once. Per `AGENT_PROTOCOL.md`'s own `SEALED_SYMBOLS` re-run rule (updated in
this commit), this is provisional, not a live D3 candidate, until that re-run happens — a
follow-up work_queue item, not this one. No VERDICTS.md row: `T2-VOLCONTRACTION`'s own
98-trade/1h-entry row is correct for its own sample and is not being corrected, and a
provisional-not-yet-promoted clear does not get a row by this project's existing precedent.
Counted as a single study covering 4 sub-axes, matching `ZERO-COST-FLOOR-ALL-FAMILIES`'s own
precedent for a multi-axis run — joins the economic-gate-only bucket below (35→36) — a 57th
study. Previously updated 2026-08-27 by ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL
— a BTC-only active-address-count exposure signal, genuinely exogenous data (blockchain.com Charts
API `n-unique-addresses`), staged per `WHALE-WALLET-ACCUMULATION-PRIMARY`'s own named escape hatch.
Construct: active-address count above its own trailing 200-session MA (±1% hysteresis band) =
favourable, 1-day causal lag, same signal shape as `MACRO-REGIME-PRIMARY-SIGNAL`/`GDELT-NEWS-
SENTIMENT-PRIMARY-SIGNAL`. n=1 asset (BTC), 70/30 split. Measured 107 holdout regime episodes —
comfortably clearing the pre-registered n>=8 floor — so a real significance test was possible.
Pre-registered one-sided sign-flip permutation test on per-holdout-episode (strategy day return −
buy-and-hold day return) spread (n=107 episodes), p=0.9990 (**wrong sign** — observed mean episode
spread -0.006973), 95% block-bootstrap CI on holdout daily strategy returns [-0.004357, -0.001993]
(excludes zero, negative, corroborating from a second angle). Joins the Formal NHST bucket as the
18th sub-test (15th study), landing dead last by raw p-value (just past LOG-REGRESSION-BANDS-
EQUITIES) — does not survive BH-FDR, and its addition to the family causes a real, family-size-
driven flip: `EQUITIES-MADIP-OUT-OF-SAMPLE` (own p=0.0116 unchanged) moves from formal BH-FDR
survivor (q=0.0493 at n=17) to non-survivor (q=0.0522 at n=18) purely because the family grew —
see §2 below. Not a bare null: hit rate ~50-51% in both train and holdout (indistinguishable from
chance), and 107 holdout exposure flips at this project's real per-side cost (~0.85%) is ~91%
cumulative cost drag on its own, comfortably exceeding the entire strategy-vs-buy-hold gap — the
likely driver is a ±1% band too narrow to suppress whipsaw on this series' natural daily
volatility, the same failure mode `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` diagnosed under an
identical band convention on a different exogenous input. **Material side effect: one flip**
(`EQUITIES-MADIP-OUT-OF-SAMPLE`, survivor→non-survivor, detailed in §2).

**Superseded — total prior to this update: 55 studies** (updated 2026-08-23 by GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL
— a GDELT news-volume/tone regime exposure signal on crypto, genuinely exogenous data, same
family as MACRO-REGIME-PRIMARY-SIGNAL, on the identical 12-asset universe/window that study used
(and where it closed as a sample-size non-verdict). Unlike that study, this one measured 65
holdout regime episodes — comfortably clearing its own pre-registered n>=8 floor — so a real
significance test was possible. Pre-registered one-sided sign-flip permutation test on per-holdout-episode
(strategy day return − buy-and-hold day return) spread (n=65 episodes, this study's own
effective-n unit), p=0.7113 (**wrong sign** — observed mean episode spread -0.00594), 95%
block-bootstrap CI on holdout daily strategy returns [-0.00415, -0.00054] (excludes zero, on the
negative side, corroborating from a second angle). Joins the Formal NHST bucket as the 17th
sub-test (14th study), landing second-to-last by raw p-value (just ahead of
LOG-REGRESSION-BANDS-EQUITIES) — does not survive BH-FDR. Not a bare null: hit rate ~50.5% in
both train and holdout (indistinguishable from chance), and the strategy underperforms
buy-and-hold by 8.7 points in holdout despite correctly measuring much faster regime turnover
than macro data (65 episodes vs MACRO-REGIME-PRIMARY-SIGNAL's 1 on the identical window) — ~64
holdout flips at this project's real per-side cost (~0.85%) plausibly account for most of that
gap as cumulative transaction-cost drag, not a benchmark-direction artifact (holdout buy-and-hold
here is negative and the strategy is MORE negative, the opposite of the log-regression pair's
falling-benchmark-rewards-any-exit-signal confound). **Material side effect: none flip.**
CLASSIFIER-FUNDING-FEATURE was already a non-survivor at n=16 (this update's new entry lands near
the bottom of the ranking, not near the top, so it only tightens thresholds further, it doesn't
reorder the top ranks) — its q tightens from 0.0528 (n=16) to 0.0561 (n=17), still non-surviving.
EQUITIES-MADIP-OUT-OF-SAMPLE remains a survivor but tightens (q=0.0464→0.0493, threshold
`4/17×0.05=0.01176` vs its unchanged p=0.0116). LOG-REGRESSION-BANDS-CRYPTO (q=0.0032→0.0034) and
B5-REVERSAL L=3 (q=0.0080→0.0085) are essentially unaffected. Three sub-tests still formally
survive at n=17, unchanged from n=16. Full writeup: ROADMAP_ARCHIVE.md's 2026-08-23
GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL section. Previously updated 2026-08-22 by
LOG-REGRESSION-BANDS-EQUITIES —
the equities companion to LOG-REGRESSION-BANDS-CRYPTO below, identical method (byte-identical
OLS log-log-vs-drift regression bands, hysteresis, cost charged on every flip), fixed 30-symbol
DJIA universe, IBKR-realistic per-share commission cost (the one disclosed, unavoidable
difference from crypto's flat-percentage cost). Pre-registered one-sided sign-flip permutation
test on per-asset holdout outperformance vs buy-and-hold (n=30 assets), p=0.9750 (**wrong
sign** — observed mean outperformance -0.0994), 95% bootstrap CI [-0.199, -0.011] (excludes
zero, on the negative side). Joined the Formal NHST bucket as the 16th sub-test (13th study),
ranking dead last by raw p-value at the time — does not survive BH-FDR. Not a bare null: the equities
holdout window was broadly BULLISH (21/30 assets positive buy-and-hold, median +7.6%), the
mirror image of `LOG-REGRESSION-BANDS-CRYPTO`'s broadly bearish holdout, and the band signal
underperforms buy-and-hold here for the same structural reason that study's always-flat control
exposed — exposure-reducing signals are punished by a rising benchmark exactly as they were
rewarded by a falling one. The always-flat control underperforms buy-and-hold even more than
the signal does here (-0.1247 vs -0.0994); signal-minus-flat is small, positive, and
CI-includes-zero (+0.0253, CI [-0.017, 0.063]) — no detectable band information in either
market. Median ΔR² (log-log vs drift) -0.1184, same qualitative finding as crypto (power-law
framing fits worse than plain drift). Recorded a plain KILLED verdict in VERDICTS.md — a 54th
study. Previously updated 2026-08-22 by LOG-REGRESSION-BANDS-CRYPTO —
a primary market-exposure signal (log-price vs log-time regression bands, never attempted before
in this project), pre-registered one-sided sign-flip permutation test on per-asset holdout
outperformance vs buy-and-hold (n=24 assets), p=0.0002, 95% bootstrap CI [0.068, 0.232]
(excludes zero). Joins the Formal NHST bucket below as the 14th sub-test (11th study) — see §2
for the full recomputation; ranks 1st of 14 by raw p-value and formally SURVIVES BH-FDR at
q=0.05 (adjusted q=0.0028) — but the study's own always-flat control (0% return, no trades)
outperforms the identical buy-and-hold benchmark by MORE than the real signal does (+0.4337 vs
+0.1446), because 23/24 assets had negative buy-and-hold return over their holdout window (a
broadly bearish stretch); signal-minus-always-flat delta is significantly NEGATIVE (mean -0.2892,
CI [-0.4154,-0.1644]). Recorded KILLED in VERDICTS.md despite the nominal BH-FDR survival — the
survival is a benchmark artifact, not a real effect, demonstrated by this same study rather than
asserted — a 53rd study. Previously updated 2026-08-22 by EQUITIES-MADIP-SIGNIFICANCE —
a formal one-sided sign-flip permutation test of `ma_dip`'s pooled per-trade net R on the same
30-symbol equity universe/cost basis EQUITIES-ALL-FAMILIES-BASELINE established, reusing
EQUITIES-BREAKOUT-SIGNIFICANCE's exact methodology; p=0.0648, 95% block-bootstrap CI
[-0.054, 0.361] (includes zero). Joins the Formal NHST bucket below as the 12th sub-test
(9th study) — see §2 for the full recomputation; ranks 5th of 12 by raw p-value and does not
survive BH-FDR at q=0.05 (adjusted q=0.1555). No VERDICTS.md row per its own done_when (a
cleared BH-FDR alone does not promote anything, and this one didn't clear it anyway) — a 52nd
study. Previously updated 2026-08-22 by EQUITIES-ALL-FAMILIES-BASELINE
— all 12 `tournament.mjs` families run unmodified against the same cached equity universe
already examined by `EQUITIES-BASELINE-PORT`/`EQUITIES-BREAKOUT-SIGNIFICANCE`/
`EQUITIES-COST-ASSUMPTION-SENSITIVITY`; no p-value, no pre-registered gate, no pass/fail
claim of any kind — a breadth measurement only, reported gross/net avgR and trade count per
family with none promoted. Joined the Descriptive/no-gate bucket below (now 3), not the
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
Formal NHST table below and ROADMAP_ARCHIVE.md, not VERDICTS.md, since it cleared no gate — a 48th
study; the prior post-audit update, CROSS-SECTIONAL-NONPRICE-RANK, brought the count to 47),
not 14.
Breakdown by kind:

| Kind | Count | What it means for this audit |
|---|---:|---|
| Formal NHST (reports a p-value against a pre-registered gate) | 14 studies / 17 sub-tests (this row lagged the real count before this update — see §1's own "the count is stale" framing; corrected here to match §2/AGENT_PROTOCOL.md's current totals as of GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL) | Section 2 — a real FWER/FDR computation applies |
| Economic-gate-only (point-estimate threshold, no p-value/null distribution) | 36 (see VOL-CONTRACTION-SAMPLE-EXTENSION note above; §3's "33" below is pre-this-study and not rewritten here — see that section's own staleness framing) | Section 3 — classical alpha math doesn't transfer cleanly; discussed qualitatively |
| Non-verdict (a gate failed before holdout was ever examined) | 6 (H11, FUNDING-MEANREV, ONCHAIN-FLOW-GATE, FIB-PULLBACK, VOL-CONFIRM-BREAKOUT, PAIRS-COINTEGRATION-STATARB) | Consumed zero holdout looks — train-gate, data-gate, or (new with PAIRS-COINTEGRATION-STATARB) internal-screen-gate failures, holdout never examined. Not part of either look-elsewhere pool. PAIRS-COINTEGRATION-STATARB differs from the other five: its gate wasn't missing data, it was its own internal, ALREADY BH-FDR-corrected 105-pair Engle-Granger screen (0/105 survived q=0.05) — a self-contained formal-NHST family that doesn't feed Section 2's 9-sub-test table, since it was corrected within the study rather than needing retroactive cross-study correction. |
| Descriptive / no gate at all | 3 (T1-ZEROCOST informal 8-family screen, SEASONALITY-DAYOFWEEK-SESSION, EQUITIES-ALL-FAMILIES-BASELINE) | No pass/fail claim was ever made, so nothing to correct — but the holdout window was looked at, which matters for Section 4 |
| Informal, pre-dates any written protocol (pre-2026-08-04) | 3 (Trade intensity, Order-flow pooled, MR1) | No p-value, no formal gate on record; included for honesty, excluded from every quantitative computation below |

Zero true PASS exists anywhere in the 45. One row (`B5-REVERSAL-PHASE3-FUTURES-COST`) reads
"WEAK PASS on the literal pre-registered gate" but is immediately superseded in the same
study by `B5-REVERSAL-PHASE4-PORTFOLIO-SIM`'s FAIL under a stricter, more realistic
(portfolio-simulation) judge — never promoted, never a live candidate.

## 2. The formal-significance subfamily: a real FWER/FDR computation

Twenty-two sub-tests across nineteen studies report an actual p-value against the project's
pre-registered `p<0.05` significance gate (`MOMENTUM_SPEC.md §6` clause 1, and the
classifier spec's equivalent permutation-null clause). These are the only results in this
project where classical multiple-comparisons math applies without qualification, because
they're the only ones with an actual null distribution behind them.

| Rank | Study | p-value | Sign correct? |
|---:|---|---:|---|
| 1 | LOG-REGRESSION-BANDS-CRYPTO (holdout, primary) | 0.0002 | yes (but see below — a demonstrated benchmark artifact, not a real effect) |
| 2 | B5-REVERSAL L=3 (train) | 0.0010 | yes |
| 3 | CLASSIFIER-FUNDING-FEATURE (holdout, primary) | 0.0099 | yes |
| 4 | EQUITIES-MADIP-OUT-OF-SAMPLE (holdout, primary) | 0.0116 | yes |
| 5 | Classifier P5 (holdout, primary) | 0.0198 | yes |
| 6 | C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES (permutation test, spread-vs-netR) | 0.0365 | **no** (negative rho — higher 10y-2y spread associated with lower trade net R; no directional prior was pre-registered, so this is simply the sign observed) |
| 7 | Low-vol B4 negBeta (train) | 0.0579 | yes |
| 8 | EQUITIES-MADIP-SIGNIFICANCE (holdout, primary) | 0.0648 | yes |
| 9 | CROSS-SECTIONAL-NONPRICE-RANK (train, OI-change primary IC) | 0.1249 | **no** (wrong sign) |
| 10 | EQUITIES-BREAKOUT-SIGNIFICANCE (holdout, primary) | 0.2036 | yes |
| 11 | Low-vol B4 negVol (train) | 0.2278 | yes |
| 12 | B5-REVERSAL L=5 (train) | 0.4226 | yes |
| 13 | MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train) | 0.4266 | yes |
| 14 | C0-SIGNAL-COMBINATION (permutation test, tercile-vs-random) | 0.4708 | yes (selection nominally beats random, but the effect is far too small to be significant) |
| 15 | MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train) | 0.6024 | **no** (wrong sign) |
| 16 | EQUITIES-BREAKOUT-OUT-OF-SAMPLE (holdout, primary) | 0.6165 | **no** (wrong sign) |
| 17 | Momentum M7 (train, residual IC) | 0.7013 | yes |
| 18 | GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL (holdout, primary) | 0.7113 | **no** (wrong sign) |
| 19 | STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC (holdout, primary) | 0.7183 | **no** (wrong sign) |
| 20 | WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC (holdout, primary) | 0.9251 | **no** (wrong sign) |
| 21 | LOG-REGRESSION-BANDS-EQUITIES (holdout, primary) | 0.9750 | **no** (wrong sign) |
| 22 | ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL (holdout, primary) | 0.9990 | **no** (wrong sign) |

**Naive FWER, k=22, alpha=0.05:** 1 − (1 − 0.05)^22 = **0.6765** (assuming independence,
which these tests only partially satisfy — see caveat below). Over a family this size, roughly
68% odds of at least one nominal "significant" hit existed even if every single underlying
effect were exactly zero. Six clear raw p<0.05 (ranks 1–6 above — the first time this update
mechanism has seen the raw hit-count itself grow, rather than a new entry landing below the
existing hits and leaving the count unchanged) — informative, but this alone doesn't say
anything about which are real.

**Benjamini-Hochberg FDR at q=0.05** (critical value for rank *i* of 22 is `(i/22)×0.05`):

| Rank *i* | Study | p-value | q-value | Survives? |
|---:|---|---:|---:|---|
| 1 | LOG-REGRESSION-BANDS-CRYPTO | 0.0002 | 0.0044 | **yes** (nominally — see caveat) |
| 2 | B5-REVERSAL L=3 | 0.0010 | 0.0110 | **yes** |
| 3 | CLASSIFIER-FUNDING-FEATURE | 0.0099 | 0.0638 | no (already a non-survivor going into this update — tightens further) |
| 4 | EQUITIES-MADIP-OUT-OF-SAMPLE | 0.0116 | 0.0638 | no (already a non-survivor going into this update — tightens further) |
| 5 | Classifier P5 | 0.0198 | 0.0871 | no |
| 6 | C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES | 0.0365 | 0.1338 | no (raw p<0.05, does not survive correction) |
| 7–22 | (remaining 16, see full table above) | 0.0579–0.9990 | 0.1782–0.9990 | no |

**Two sub-tests formally survive family-wise BH-FDR correction at q=0.05 at the current
n=22 — unchanged from n=21. No survivor flips this update:
`C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES`'s addition (p=0.0365) lands at rank 6 of 22,
between the current non-survivors `Classifier P5` (rank 5) and `Low-vol B4 negBeta` (now rank
7) — high enough in the ranking to raise the raw p<0.05 hit-count from five to six for the first
time, but its own q-value (0.1338) is nowhere near the 0.05 line. One of the two remaining survivors is a
demonstrated benchmark artifact (rank 1, see below).**
`LOG-REGRESSION-BANDS-CRYPTO`
(2026-08-22, `ROADMAP_ARCHIVE.md`) tested a log-price-vs-log-time regression-band exposure signal
against crypto buy-and-hold: p=0.0002, the smallest raw p-value ever recorded in this family,
formally the strongest BH-FDR survivor (q=0.0028). The SAME study computed an always-flat
(never-trade) control against the identical buy-and-hold benchmark and found it outperforms
buy-and-hold by MORE than the real signal does (+0.4337 vs +0.1446 mean per-asset
outperformance, n=24) — because 23 of 24 assets had negative buy-and-hold return over their
holdout window, a benchmark that is falling almost everywhere rewards ANY reduced-exposure
strategy near-automatically. The signal-minus-always-flat delta (the only fair test of whether
the band itself adds information) is significantly NEGATIVE: mean -0.2892, 95% CI
[-0.4154, -0.1644], entirely below zero. Recorded KILLED in `VERDICTS.md` despite the nominal
BH-FDR survival. This is disclosed here, in the correction math itself, rather than only in
`ROADMAP_ARCHIVE.md`'s narrative, because the mechanical family-size rule below requires every reported
p-value to be added and judged — it has no way to know a benchmark confound sits behind one of
them, and this document should not silently launder that gap.

**Material side effect of adding a very small p-value at rank 1: `CLASSIFIER-FUNDING-FEATURE`
flips from non-survivor back to survivor.** At n=13 it was q=0.0644 (non-survivor, having just
been flipped OUT by `EQUITIES-BREAKOUT-SIGNIFICANCE`'s addition the prior update). Adding
`LOG-REGRESSION-BANDS-CRYPTO`'s p=0.0002 at rank 1 loosens the rank-3 threshold from
`2/13×0.05=0.00769` to `3/14×0.05=0.01071` (CLASSIFIER-FUNDING-FEATURE moves from rank 2 to
rank 3 as the new entry displaces it), and its own unchanged p=0.0099 now clears that looser
threshold (q=0.0462). Its own economic-gate verdict (KILLED — best-scoring subset still nets
-0.24R/trade after cost) is untouched — this is a purely statistical side effect of family
size, not a re-examination of that study, and its "statistically real, economically dead"
characterization below is unaffected. `B5-REVERSAL L=3` remains a comfortable survivor
(q=0.0130→0.0070, tightens but does not flip). `EQUITIES-BREAKOUT-SIGNIFICANCE`'s own q moves
from 0.3702 (n=13) to a looser value at n=14 purely from family growth — its own p-value
(0.2036) is unchanged. Classifier P5's "clears p<0.05" result (p=0.0198) still does **not**
survive correction (q=0.0693) — unchanged conclusion: P5 was already KILLED on the separate,
independently-required economic clause (its best-scoring subset nets -0.46R/trade after cost).

**This update (n=14→n=15): `EQUITIES-MADIP-OUT-OF-SAMPLE` joins as the 15th entry and itself
formally survives, landing at rank 4 (q=0.0435) — inserted between `CLASSIFIER-FUNDING-FEATURE`
(rank 3) and `Classifier P5` (rank 5).** `CLASSIFIER-FUNDING-FEATURE`'s own rank-3 threshold
tightens slightly from `3/14×0.05=0.01071` to `3/15×0.05=0.01000` as the family grows — it
still clears, but now barely (its unchanged p=0.0099 sits just under the new 0.01000 line,
q=0.0495). `LOG-REGRESSION-BANDS-CRYPTO` and `B5-REVERSAL L=3` are essentially unaffected
(q=0.0028→0.0030, q=0.0070→0.0075). Unlike every prior addition to this family, this one is not
a demonstrated artifact and does not require a benchmark-confound caveat: `ma_dip`'s avgR is
already net of the same real IBKR commission + slippage cost basis this entire equities
subfamily uses, and the point estimate on this fresh DJTA-20 universe (+0.2994) is *larger*
than the original DJIA-30 estimate (+0.1526), not smaller — the opposite of what a
look-elsewhere-inflated result would be expected to do on honest replication. Full writeup:
`ROADMAP_ARCHIVE.md`'s 2026-08-22 `EQUITIES-MADIP-OUT-OF-SAMPLE` section.

**This update (n=15→n=16): `LOG-REGRESSION-BANDS-EQUITIES` joins as the 16th entry, landing
dead last (rank 16, p=0.9750, wrong sign).** The equities companion to
`LOG-REGRESSION-BANDS-CRYPTO` — byte-identical method (OLS log-log-vs-drift regression bands,
BAND_K=1.5, 70/30 train/holdout, hysteresis, cost charged on every exposure flip), fixed
30-symbol DJIA universe, the one disclosed unavoidable difference being an IBKR-realistic
per-share commission cost model in place of crypto's flat percentage. Mean holdout
outperformance vs buy-and-hold is **negative** (-0.0994, 95% CI [-0.199, -0.011], entirely below
zero) — the opposite sign from the pre-registered H1. This is not a bare null result: the
equities holdout window was broadly BULLISH (21/30 assets positive buy-and-hold, median
+7.6%), the mirror image of the crypto study's broadly bearish holdout, and this study's own
always-flat control (carried over from the crypto study, pre-registered here rather than
added after the fact) underperforms buy-and-hold by even more than the signal does (-0.1247 vs
-0.0994) — signal-minus-flat is small, positive, and CI-includes-zero (+0.0253, CI
[-0.017, 0.063], p=0.118 one-sided). Read together, the two studies show the SAME artifact in
opposite directions: a benchmark falling almost everywhere rewards any reduced-exposure
strategy (crypto); a benchmark rising almost everywhere punishes one (equities). Neither result
is evidence the band itself carries information. Median ΔR² (log-log vs drift model) -0.1184 —
same qualitative finding as crypto, the power-law framing fits worse than plain drift. Recorded
a plain KILLED verdict (wrong sign, no benchmark-artifact caveat needed since it never cleared
raw significance). Full writeup: `ROADMAP_ARCHIVE.md`'s 2026-08-22 `LOG-REGRESSION-BANDS-EQUITIES`
section.

**Material side effect: `CLASSIFIER-FUNDING-FEATURE` flips from survivor back to
non-survivor** — the reverse of the flip the crypto study caused, and for the mirror-image
reason: that update ADDED a very small p-value at rank 1 (loosening every lower rank's
threshold); this update adds a very large p-value at rank 16 (the bottom), which tightens every
rank's threshold above it purely by growing the denominator `n`. `CLASSIFIER-FUNDING-FEATURE`'s
rank-3 threshold tightens from `3/15×0.05=0.01000` (where its unchanged p=0.0099 barely
cleared, q=0.0495) to `3/16×0.05=0.009375` (where it no longer does, q=0.0528). Its own
economic-gate verdict (KILLED — best-scoring subset nets -0.24R/trade after cost) is untouched
— this is a purely statistical side effect of family size, not a re-examination of that study.
`LOG-REGRESSION-BANDS-CRYPTO` (q=0.0030→0.0032) and `B5-REVERSAL L=3` (q=0.0075→0.0080) are
essentially unaffected; `EQUITIES-MADIP-OUT-OF-SAMPLE` remains a survivor but tightens
(q=0.0435→0.0464, its own p=0.0116 unchanged). Three sub-tests now formally survive at n=16,
down from four at n=15 — this is the same mechanical, family-size-driven flip this document has
now recorded in both directions (a strong new hit loosening thresholds; a weak new hit
tightening them), which is itself the clearest illustration this project has produced of why a
single study's BH-FDR status should never be treated as a fixed property of that study.

**A genuinely surprising pattern, stated with its caveat — and now with a concrete
counter-example on each side.** Under a null of "no real effect anywhere in this family,"
P(at least 5 of 16 independent trials clear p<0.05) ≈ **0.09%** (exact binomial, n=16, p=0.05,
updated from the prior n=15 figure of 0.06% — this update adds a raw non-hit at the bottom of
the table, so the hit count is unchanged at 5 (the 5th raw hit, `EQUITIES-MADIP-OUT-OF-SAMPLE`,
joined the top of the table the prior update), but the larger family size alone raises the
probability of seeing that many hits by chance). Read at face value this would suggest real
effects are present. **The caveat that mattered before still matters:** these sixteen tests are not
independent draws — B5-REVERSAL L=3/L=5 share a mechanism and overlapping data;
CLASSIFIER-FUNDING-FEATURE is P5's own model plus one covariate on much of the same holdout
rows — which makes any raw hit-count less surprising than the naive binomial number suggests.
**What is new this update: the family now has one concrete example of each failure mode this
caveat warns about, and one concrete example of the thing it doesn't warn about.**
`LOG-REGRESSION-BANDS-CRYPTO`'s p=0.0002 — the single strongest raw hit in this project's
history — is explained entirely by a benchmark artifact (a near-uniformly bearish holdout
window rewarding any reduced exposure), demonstrated by the same study's own always-flat
control, not asserted after the fact. This is concrete evidence for exactly the kind of
overstatement this caveat has warned about since this document's first version: raw hit-counts
under a global null (or a correlated near-null) can and do include artifacts that look, by
every formal measure available here, exactly like a real discovery. `EQUITIES-MADIP-OUT-OF-SAMPLE`
is the other side of that same coin: a raw hit that was checked against a genuinely fresh,
zero-overlap universe and got *stronger*, not weaker — the kind of result the look-elsewhere
caveat does not predict away. **The honest reading, updated:** this project has three separate
lines of evidence (a short-horizon reversal signal, an entry-time classifier, and a
funding-augmented version of that classifier) that are *statistically real and economically
dead* — not noise, not a coding bug, but real effects too small for this project's actual
trading costs (~1.7% round-trip crypto; equities costs are far lower) to ever monetize. It has
one concrete case of a result that is *statistically nominal and not real at all* — a
materially different failure mode from either "real and dead" or "noise." And it now has one
result, `EQUITIES-MADIP-OUT-OF-SAMPLE`, that is *net-of-cost positive and replicated stronger
out-of-sample* — the first equities or crypto result in this project's history to clear those
bars simultaneously, though still short of the independent `SEALED_SYMBOLS`-style re-validation
`AGENT_PROTOCOL.md` requires before any live-promotion consideration. **Update (n=18, this
document's `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` section above): its own p=0.0116 no longer
formally survives family-wide BH-FDR** (q=0.0522, flipped from q=0.0493's narrow survival at
n=17) — a purely mechanical consequence of family growth, not a change to its point estimate, CI,
or replication. The "statistically real" characterization above describes this result's status as
of when it was written (n=15); as of n=18 it is more precisely: a raw hit whose 95% CI still
excludes zero and which still replicated stronger on a fresh universe, but which no longer clears
this project's own formal multiple-comparisons bar. Both readings are stated here rather than
silently updating the earlier one, since the point of this document is to make exactly this kind
of status drift visible. `EQUITIES-BREAKOUT-SIGNIFICANCE`'s own thin positive (+0.1866R, p=0.2036, 61
trades on DJIA-30) did **not** hold up out-of-sample:
`EQUITIES-BREAKOUT-OUT-OF-SAMPLE`'s fresh DJTA-20 universe put the same unmodified `breakout`
config at -0.0854R over 33 trades, p=0.6165 — the one other out-of-sample check completed so far in
this family, and it points toward noise rather than toward a signal that just needed more
data.

**This update (n=16→n=17): `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` joins as the 17th entry,
landing second-to-last (rank 16, p=0.7113, wrong sign).** A GDELT news-volume/tone regime
exposure signal on crypto (genuinely exogenous data, same family as
`MACRO-REGIME-PRIMARY-SIGNAL`), run on that exact study's own 12-asset universe and
train/holdout window — the one difference being that this signal's regime turns over fast
enough (65 holdout episodes vs macro's 1 on the identical window) to actually clear the
pre-registered n>=8 episode floor and produce a real test, where `MACRO-REGIME-PRIMARY-SIGNAL`
itself closed as a sample-size non-verdict. Pre-registered primary test: one-sided sign-flip
permutation on per-holdout-episode (strategy day return − buy-and-hold day return) spread
(n=65 episodes, this study's own effective-n unit — there is no per-asset panel here, so the
independent unit is episodes rather than assets), observed mean spread -0.00594 (wrong sign),
p=0.7113. 95% block-bootstrap CI on holdout daily strategy returns [-0.00415, -0.00054]
(excludes zero, negative) corroborates from a second angle. Not a bare null: hit rate ~50.5% in
both train and holdout (indistinguishable from chance), and unlike the log-regression pair this
is not a falling/rising-benchmark artifact — holdout buy-and-hold here is already negative
(-47.37%) and the strategy is MORE negative (-56.06%), so a reduced-exposure signal is not being
rewarded by a one-directional benchmark. The likely driver instead: ~64 holdout exposure flips
at this project's real per-side cost (~0.85%) is roughly 54% of cumulative cost drag alone —
the pre-registered ±1%/±0.1 hysteresis bands slowed but did not eliminate whipsaw against
GDELT's noisy daily series. Recorded a plain KILLED verdict (wrong sign, no benchmark-artifact
caveat needed — the loss is not explained by benchmark direction). Full writeup: `ROADMAP_ARCHIVE.md`'s
2026-08-23 `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` section.

**Material side effect: none flip.** `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`'s p=0.7113 inserts
between `Momentum M7` (rank 15, p=0.7013) and `LOG-REGRESSION-BANDS-EQUITIES` (now rank 17,
p=0.9750) — near the bottom, not the top, so it only tightens every threshold above it by
growing the denominator `n`, the same mechanical direction `LOG-REGRESSION-BANDS-EQUITIES`'s own
addition caused. `CLASSIFIER-FUNDING-FEATURE` was already a non-survivor at n=16 (q=0.0528) and
tightens further (q=0.0561) — no flip, since it had nothing to flip from this time.
`EQUITIES-MADIP-OUT-OF-SAMPLE` remains a survivor but tightens (q=0.0464→0.0493, threshold
`4/17×0.05=0.011765` vs its unchanged p=0.0116 — a narrow clear). `LOG-REGRESSION-BANDS-CRYPTO`
(q=0.0032→0.0034) and `B5-REVERSAL L=3` (q=0.0080→0.0085) are essentially unaffected. Three
sub-tests still formally survive at n=17, unchanged from n=16.

**The binomial-surprise figure, updated once more (n=17).** Under a null of "no real effect
anywhere in this family," P(at least 5 of 17 independent trials clear p<0.05) ≈ **0.12%** (exact
binomial, n=17, p=0.05, up from the n=16 figure of 0.09% — this update adds a raw non-hit near
the bottom of the table, so the hit count is unchanged at 5, but the larger family size alone
raises the probability of seeing that many hits by chance). The same independence caveat applies
unchanged: these seventeen tests are not independent draws, and `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`
adds a genuinely new information source (GDELT news data, never used in any prior test in this
family) rather than a correlated re-run of an existing one — if anything this addition is
evidence *against* the correlated-near-null concern that discounts the raw hit-count, not
evidence for it, since an independent source landing as a clean non-hit is exactly what a
family with real isolated effects and mostly-null everything-else would look like.

**This update (n=17→n=18): `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` joins as the 18th entry,
landing dead last (rank 18, p=0.9990, wrong sign).** A BTC-only active-address-count exposure
signal (blockchain.com Charts API `n-unique-addresses`, genuinely exogenous data), staged per
`WHALE-WALLET-ACCUMULATION-PRIMARY`'s own named escape hatch — a deliberately different
population-usage-momentum hypothesis, not a second whale-cohort-tracking attempt. Construct:
active-address count above its own trailing 200-session MA (±1% relative hysteresis band,
matching GDELT's Volume Intensity band shape) = favourable, 1-day causal lag, same "level vs own
trailing MA" mechanism as `MACRO-REGIME-PRIMARY-SIGNAL`/`GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`.
Single-asset study (n=1, BTC) — the independent unit is regime episodes on BTC's own history
(107 holdout episodes, comfortably clearing the pre-registered n>=8 floor), not a cross-sectional
asset panel. Pre-registered primary test: one-sided sign-flip permutation on per-holdout-episode
(strategy day return − buy-and-hold day return) spread, observed mean spread -0.006973 (wrong
sign), p=0.9990. 95% block-bootstrap CI on holdout daily strategy returns [-0.004357, -0.001993]
(excludes zero, negative) corroborates from a second angle. Not a bare null: hit rate ~50-51% in
both train and holdout (indistinguishable from chance), and the holdout loss is far larger than a
coin-flip signal alone would produce — 107 episodes over 392 holdout days (≈3.7-day average
episode length) means ≈107 exposure flips at this project's real per-side cost (~0.85%), roughly
91% cumulative cost drag on its own, comfortably exceeding the entire strategy-vs-buy-hold gap.
The likely driver: a ±1% band too narrow to suppress whipsaw against this series' natural daily
volatility — the same failure mode `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` diagnosed for its Volume
Intensity signal under an identical band convention, now reproduced on a structurally different
exogenous input. Recorded a plain KILLED verdict (wrong sign, no benchmark-artifact caveat
needed — holdout buy-and-hold here is already negative, -42.14%, and the strategy is MORE
negative, -71.46%, so this is not a falling-benchmark-rewards-any-exit-signal confound). Full
writeup: `ROADMAP_ARCHIVE.md`'s 2026-08-27 `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` section.

**Material side effect: `EQUITIES-MADIP-OUT-OF-SAMPLE` flips from survivor to non-survivor —
purely from family-size growth, its own p-value unchanged.** This is the first flip this document
has recorded that touches a result outside the log-regression/GDELT KILLED cluster —
`EQUITIES-MADIP-OUT-OF-SAMPLE` is this project's strongest surviving evidence result (the only
one that is statistically real, net-of-cost positive, and replicated stronger on a fresh
zero-overlap universe; see §2's earlier discussion). At n=17 its rank-4 threshold was
`4/17×0.05=0.011765`, and its own p=0.0116 cleared it narrowly (q=0.0493). Adding
`ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`'s p=0.9990 at the bottom of the table (rank 18) grows the
denominator without changing any rank above it, which tightens the rank-4 threshold to
`4/18×0.05=0.011111` — and `EQUITIES-MADIP-OUT-OF-SAMPLE`'s unchanged p=0.0116 now sits just
above that line (q=0.0522, no longer surviving). **This is not a re-examination of that study.**
Nothing about `EQUITIES-MADIP-OUT-OF-SAMPLE`'s own data, method, or economic result has changed —
its point estimate (+0.2994, 95% CI [0.0509, 0.5350] excluding zero), its out-of-sample
replication on a fresh universe, and its net-of-cost economics all stand exactly as recorded in
`ROADMAP_ARCHIVE.md`'s 2026-08-22 section. What changed is purely mechanical: BH-FDR's rejection region
depends on the full family's size, and a large p-value added anywhere in the family tightens
every threshold above it, with no floor on how close to the boundary a prior survivor can be
sitting. `EQUITIES-MADIP-OUT-OF-SAMPLE` was already the family's most marginal survivor (q=0.0493
of 0.05, the tightest margin of the three) going into this update, which is exactly why it was the
one to flip rather than `LOG-REGRESSION-BANDS-CRYPTO` or `B5-REVERSAL L=3` (q=0.0034 and 0.0090
respectively, comfortably unaffected). This is the same mechanical, family-size-driven flip
pattern this document has now recorded three times (`CLASSIFIER-FUNDING-FEATURE` flipped in both
directions across two earlier updates; this is the first time the flipped result is a still-live,
un-killed finding rather than an already-KILLED one) — it is disclosed here in the correction math
itself precisely because a marginal formal survivor's status should never be read as a permanent
property of that study, and this document exists to make that visible rather than let it go
unnoticed. `CLASSIFIER-FUNDING-FEATURE` was already a non-survivor at n=17 (q=0.0561) and
tightens further (q=0.0594) — nothing to flip. `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0034→0.0036)
and `B5-REVERSAL L=3` (q=0.0085→0.0090) are essentially unaffected. Two sub-tests now formally
survive at n=18, down from three at n=17.

**The binomial-surprise figure, prior update (n=18).** Under a null of "no real effect
anywhere in this family," P(at least 5 of 18 independent trials clear p<0.05) ≈ **0.15%** (exact
binomial, n=18, p=0.05, up from the n=17 figure of 0.12% — this update adds a raw non-hit at the
very bottom of the table, so the hit count is unchanged at 5, but the larger family size alone
raises the probability of seeing that many hits by chance). The same independence caveat applies
unchanged: these eighteen tests are not independent draws, and `ACTIVE-ADDRESS-COUNT-PRIMARY-
SIGNAL` adds a genuinely new information source (blockchain.com on-chain address-count data,
never used in any prior test in this family) rather than a correlated re-run of an existing one —
the same "independent source landing as a clean non-hit" reading `GDELT-NEWS-SENTIMENT-PRIMARY-
SIGNAL`'s addition supported applies here too.

**This update (n=18→n=19): `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC` joins as the 19th
entry, landing second-to-last of the newly-added position (rank 17, p=0.9251, wrong sign).** A
follow-on to `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`, sourced directly from that study's own
"what would actually resolve this" section: does widening the hysteresis band (reducing
exposure-flip turnover) change the verdict, isolating cost drag from signal-direction as the
failure's driver? Byte-identical construct/data/cost basis/split/methodology to the predecessor,
only change: pre-registered ±3% relative hysteresis band (3x the killed study's ±1%) — a single
primary width, not a multi-width sweep, per this document's own discipline (one new sub-test per
diagnostic, not several). Pre-registered primary test: one-sided sign-flip permutation on
per-holdout-episode (strategy day return − buy-and-hold day return) spread, observed mean spread
-0.005302 (still wrong sign), p=0.9251 — closer to significance than the predecessor's p=0.9990,
but nowhere near p<0.05. 95% block-bootstrap CI on holdout daily strategy returns
[-0.003625, -0.001224] (excludes zero, negative) corroborates. **Result: partial explanation, not
a resolution.** Holdout episode count drops 107→88 (-17.8%) purely from tripling the band width,
and the strategy-vs-buy-hold gap shrinks from -29.3 points (±1%) to -19.75 points (±3%) —
consistent with cost drag being part of the story. But ~88 holdout flips at real per-side cost
(~0.85%) is still ~74.8% cumulative cost drag, 3.8x the size of the remaining gap (up from 3.1x at
±1%) — cost-drag dominance relative to the (shrunken) gap did not decrease. Hit rate (49-53% in
both segments) remains indistinguishable from chance in both band widths — widening the band
reduces how often a directionless signal gets acted on, it cannot supply direction the underlying
comparison never had. Recorded a partial-explanation verdict (not KILLED, not a real finding) in
`VERDICTS.md`. Full writeup: `ROADMAP_ARCHIVE.md`'s 2026-08-27 `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`
section.

**Material side effect: none flip.** `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`'s p=0.9251
inserts between `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` (rank 16, p=0.7113) and
`LOG-REGRESSION-BANDS-EQUITIES` (now rank 18, p=0.9750) — near the bottom, not the top, so it only
tightens every threshold above it by growing the denominator `n`, the same mechanical direction
every near-bottom addition to this family has caused. `EQUITIES-MADIP-OUT-OF-SAMPLE` was already a
non-survivor at n=18 (q=0.0522) and tightens further (its rank-4 threshold moves from
`4/18×0.05=0.011111` to `4/19×0.05=0.010526`, its own unchanged p=0.0116 still exceeds it,
q=0.0551) — nothing to flip, since it had already flipped out the prior update.
`CLASSIFIER-FUNDING-FEATURE` was already a non-survivor at n=18 (q=0.0594) and tightens further
(q=0.0627) — same, nothing to flip. `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0036→0.0038) and
`B5-REVERSAL L=3` (q=0.0090→0.0095) are essentially unaffected. Two sub-tests still formally
survive at n=19, unchanged from n=18 — the first update in this family's history where the new
entry causes no flip at all in either direction, because it landed neither at the very top
(loosening thresholds) nor tightly behind an already-marginal survivor (tightening one across the
line).

**The binomial-surprise figure, updated once more (n=19).** Under a null of "no real effect
anywhere in this family," P(at least 5 of 19 independent trials clear p<0.05) ≈ **0.20%** (exact
binomial, n=19, p=0.05, up from the n=18 figure of 0.15% — this update adds a raw non-hit near the
bottom of the table, so the hit count is unchanged at 5, but the larger family size alone raises
the probability of seeing that many hits by chance). The same independence caveat applies with an
added wrinkle this time: `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC` is NOT an independent new
information source — it reuses `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`'s exact data, cost basis, and
90%+ of its holdout window, differing only in band width, so its p-value is substantially
correlated with rank 19's. Unlike `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` and
`ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` (each a genuinely new data source whose clean non-hit
statuses were read as mild evidence against the correlated-near-null concern), this addition is
better read as reinforcing that same caveat: two highly correlated sub-tests both landing near the
bottom of the ranking is closer to what a family with one real correlated null cluster would
produce than what five independent draws hitting by chance would look like — a reminder that this
document's raw hit-count and binomial figure should be read with the family's actual independence
structure in mind, not taken as five independent pieces of evidence.

**This update (n=19→n=20): `STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC` joins as the
20th entry, landing at rank 17 of 20 (p=0.7183, wrong sign).** A third, distinctly-named diagnostic
in the same band-width A/B/C chain (±1% KILLED → ±3% `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`
partial explanation → ±5% this item), sourced directly from that study's own "still-wider ±5% band
is the next diagnostic step" text. Byte-identical construct/data/cost basis/split/methodology to
both predecessors, only change: pre-registered ±5% relative hysteresis band (5x the killed study's
±1%) — a single primary width, not a further sweep. Pre-registered primary test: one-sided
sign-flip permutation on per-holdout-episode (strategy − buy&hold) spread, n=68 episodes (down
from 88 at ±3%, a *larger* relative cut than the ±1%→±3% step — contrary to that study's own stated
expectation of sub-linear further cuts), observed mean spread -0.002973 (still wrong sign),
p=0.7183 — continuing the trend toward significance across all three widths (0.9990→0.9251→0.7183)
but nowhere close to p<0.05. Family-wide BH-FDR recomputed across all 20 (q≈0.8450 at rank 17 of
20) — does not survive. **Result: continued partial explanation, not a resolution.** Holdout
episode count drops 88→68 (-22.7%) and the strategy-vs-buy-hold gap shrinks sharply from -19.75
points (±3%) to -7.74 points (±5%); cumulative cost drag falls from ~74.8% to ~57.8% — genuinely
declining alongside turnover, as the mechanism predicts. The cost-drag/gap *ratio* nonetheless
rises from 3.8x to ~7.5x, disclosed here as an artifact of dividing a still-substantial (declining)
cost figure by a gap approaching zero, not evidence cost drag's absolute contribution grew. Hit
rate (48.2% train, 52.8% holdout) remains indistinguishable from chance at this band width too —
no band width tested has produced a real directional signal. Recorded a continued-partial-
explanation verdict (not KILLED, not a real finding) in `VERDICTS.md`. No further band-width
follow-on staged — this A/B/C chain is treated as closed per this document's own discipline against
open-ended parameter sweeps. Full writeup: `ROADMAP_ARCHIVE.md`'s 2026-08-27
`STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC` section.

**Material side effect: none flip.** `STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC`'s
p=0.7183 inserts between `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` (rank 16, p=0.7113) and
`WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC` (now rank 18, p=0.9251) — near the bottom, not the
top, so it only tightens every threshold above it by growing the denominator `n`, the same
mechanical direction every near-bottom addition to this family has caused. `EQUITIES-MADIP-
OUT-OF-SAMPLE` was already a non-survivor at n=19 (q=0.0551) and tightens further (q=0.0580) —
nothing to flip, since it had already flipped out two updates ago. `CLASSIFIER-FUNDING-FEATURE`
was already a non-survivor at n=19 (q=0.0627) and tightens further (q=0.0660) — same, nothing to
flip. `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0038→0.0040) and `B5-REVERSAL L=3` (q=0.0095→0.0100) are
essentially unaffected. Two sub-tests still formally survive at n=20, unchanged from n=19.

**The binomial-surprise figure, updated once more (n=20).** Under a null of "no real effect
anywhere in this family," P(at least 5 of 20 independent trials clear p<0.05) ≈ **0.26%** (exact
binomial, n=20, p=0.05, up from the n=19 figure of 0.20% — this update adds a raw non-hit near the
bottom of the table, so the hit count is unchanged at 5, but the larger family size alone raises
the probability of seeing that many hits by chance). The independence caveat applies with the same
wrinkle noted at the n=19 update, now a third time over: `STILL-WIDER-HYSTERESIS-BAND-ACTIVE-
ADDRESS-DIAGNOSTIC` is NOT an independent new information source — it reuses
`ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`'s exact data and cost basis and shares the majority of its
holdout window with both band-width predecessors, differing only in band width. Three highly
correlated sub-tests now sit near the bottom of the ranking (ranks 17, 18, 20 — `LOG-REGRESSION-
BANDS-EQUITIES` sits between two of them at rank 19 as an independent source), which is closer to
what a family with one real correlated null cluster would produce than what five independent draws
hitting by chance would look like — the same reading the n=19 update gave, reinforced rather than
changed by this addition. This document's raw hit-count and binomial figure should continue to be
read with the family's actual (partially correlated) independence structure in mind.

**This update (n=20→n=21): `C0-SIGNAL-COMBINATION` joins as the 21st entry, landing at rank 13,
p=0.4708.** Per `PHASE-DIRECTIVE-BOOKKEEPING`'s pre-registered decision (§5 below), C0 joins
this family rather than starting a new one — it reuses B5-REVERSAL's and Classifier P5's own
literal sealed holdout/cost model on already-spent data, not a fresh information source. The
p-value is a one-sided permutation test (K=2000, seed 20260829) of whether a fixed a-priori
rank-average of the two signals' outputs, top-tercile-selected, beats a same-size random tercile
drawn from the same joined trade population. Sign is nominally correct (the observed selected
mean nominally beats the null distribution's mean) but the margin is negligible — selected mean
-0.9174 vs. the joined population's own unselected baseline of -0.9206, a difference of about
0.003R against a ~0.92R loss either way. Full writeup: `ROADMAP.md`'s 2026-08-29
`C0-SIGNAL-COMBINATION` section, including a disclosed, unrelated staleness finding (Classifier
P5's published economic figure no longer reproduces from the current cache due to `strategy.js`'s
FEE_RATE/SLIPPAGE_PCT having been corrected upward by `FEE-SCHEDULE-REBASE` the same day P5 was
originally published — the model and AUC still reproduce exactly, ruling out a code or data bug).

**Material side effect: none flip, one non-survivor's q moves the "wrong" way (loosens), which
is itself worth naming rather than glossing over.** `C0-SIGNAL-COMBINATION`'s p=0.4708 inserts
at rank 13, immediately after `MOMENTUM-SHORT-HORIZON-RECHECK L=14` (rank 12, p=0.4266) and
before `MOMENTUM-SHORT-HORIZON-RECHECK L=7` (now rank 14, p=0.6024) — squarely in the middle of
the table, well below both current survivors. `LOG-REGRESSION-BANDS-CRYPTO` (q=0.0040→0.0042)
and `B5-REVERSAL L=3` (q=0.0100→0.0105) tighten negligibly, purely from `n` growing. Both
already-non-survivors immediately below them shift too, but not uniformly in the tightening
direction: `EQUITIES-MADIP-OUT-OF-SAMPLE` (rank 4, p=0.0116) is unchanged at q=0.0609, and
`CLASSIFIER-FUNDING-FEATURE` (rank 3, p=0.0099) actually LOOSENS from q=0.0660 (at n=20) to
q=0.0609 — the step-up BH procedure takes the running minimum of `p_j*n/j` from the bottom of
the ranking upward, and `EQUITIES-MADIP-OUT-OF-SAMPLE`'s own term at the larger `n=21` (`0.0116
x 21/4 = 0.0609`) now happens to be smaller than whatever term was binding at `n=20`, so it
becomes the new minimum for both rank 3 and rank 4. This is the same mechanical, family-size-
driven q-value movement this document has recorded in both directions before (tightening from a
large new p-value near the bottom, loosening from a small one near the top) — here it is a
small loosening from a large new p-value landing in the *middle*, which can still shift an
intermediate rank's binding minimum even though it doesn't touch either extreme. Neither
`CLASSIFIER-FUNDING-FEATURE` nor `Classifier P5` (q=0.0832, negligibly changed) were survivors
before this update or after it — no verdict is affected. Two sub-tests still formally survive
at n=21, unchanged from n=20.

**The binomial-surprise figure, updated once more (n=21).** Under a null of "no real effect
anywhere in this family," P(at least 5 of 21 independent trials clear p<0.05) ≈ **0.31%** (exact
binomial, n=21, p=0.05, up from the n=20 figure of 0.26% — this update adds a raw non-hit in the
middle of the table, so the hit count is unchanged at 5, but the larger family size alone raises
the probability of seeing that many hits by chance). `C0-SIGNAL-COMBINATION` is, in one sense,
the least independent addition this family has ever received: it is constructed directly from
two EXISTING family members' own outputs (B5-REVERSAL's momentum score, Classifier P5's
probability), on data both of those members have already been scored against. Its near-null
result (p=0.4708, negligible effect size) is exactly what would be expected if the two inputs'
weak, already-established effects simply do not compound under a fixed unfitted combination
rule — not surprising under either the independence or correlated-null reading, and it changes
neither this document's headline family-size caveat nor either standing survivor's status.

**This update (n=21→n=22): `C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES` joins as the 22nd entry,
landing at rank 6, p=0.0365.** Per `MULTIPLE_COMPARISONS_AUDIT.md` §5's own pre-registered
C0-C3 decision, C2 joins this family rather than starting a new one — that decision is not
re-opened here. C1 (options-vol risk premium) was skipped ahead of C2 without producing a
p-value: `C1-VRP-DATA-AVAILABILITY-GATE` (2026-08-29) resolved as an availability gate, neither
pass nor fail, code-side confirmed sufficient but the account-side entitlement question left for
the human — it never reached a statistical test and so never entered this family. C2 is a
two-sided Spearman rank-correlation permutation test (K=2000, seed 20260829) between the 10y-2y
Treasury spread level at each trade's causally-lagged entry date and that trade's realised net
R, on `ma_dip`'s DJIA-30 holdout trades (n=475, `MADIP-REALISED-R-CONDITION-2`'s exact,
unmodified config) — a genuinely different statistical unit from the three prior discrete-regime
macro studies (`MACRO-REGIME-PRIMARY-SIGNAL`, `MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES`,
`MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC`), all of which were limited to 1 holdout
regime episode; this measurement's effective n is the trade count instead. Observed rho=-0.0980
(negative — higher spread associated with lower net R, no direction was pre-registered so this
is simply the observed sign), p=0.0365. Full writeup: `ROADMAP.md`'s 2026-08-29
`C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES` section.

**Material side effect: the raw p<0.05 hit-count itself grows from five to six — the first time
that has happened in this family's history rather than a new entry landing below the existing
hits and leaving the count unchanged.** `C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES` inserts at
rank 6, immediately after `Classifier P5` (rank 5, p=0.0198) and before `Low-vol B4 negBeta`
(now rank 7, p=0.0579) — above the 0.05 raw-significance line, unlike every prior addition to
this family. It does not, however, come close to surviving BH-FDR correction (q=0.1338, rank
6's own critical value being `6/22×0.05=0.01364` — nowhere near). `LOG-REGRESSION-BANDS-CRYPTO`
(q=0.0042→0.0044) and `B5-REVERSAL L=3` (q=0.0105→0.0110) tighten negligibly, purely from `n`
growing — both remain comfortable survivors. `CLASSIFIER-FUNDING-FEATURE` and
`EQUITIES-MADIP-OUT-OF-SAMPLE` (ranks 3–4, already non-survivors) both tighten from q=0.0609 to
q=0.0638 for the same mechanical reason the rank-4 term sets the running-minimum for both ranks
— unchanged conclusion, still non-survivors. `Classifier P5` (rank 5) tightens from q=0.0832 to
q=0.0871, also unaffected in status. Two sub-tests still formally survive at n=22, unchanged
from n=21.

**The binomial-surprise figure, updated once more (n=22) — and for the first time, the hit
count itself changed.** Under a null of "no real effect anywhere in this family," P(at least 6
of 22 independent trials clear p<0.05) ≈ **0.06%** (exact binomial, n=22, p=0.05) — a sharp drop
from the n=21 figure of 0.31% for P(at least 5 of 21), because this update is the first to add a
raw hit rather than a raw non-hit. Read cautiously: `C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES`
is a genuinely new information source relative to every other member of this family (a
continuous macro covariate joined against equity trade outcomes — unlike the three prior
discrete-regime macro studies, which used a different statistical unit entirely and are
themselves not part of this table), so this is not a correlated re-run inflating the hit count
artificially. But p=0.0365 is also not close to surviving correction (q=0.1338, more than 2.5x
the q=0.05 line), and this project's own standing discipline (`AGENT_PROTOCOL.md`'s
multiple-comparisons section) treats family-wide BH-FDR, not the raw hit-count or the naive
FWER figure, as the binding bar for calling a result "statistically significant." By that bar
this result does not clear it. The honest reading: a nominally significant, negative,
small-effect-size association (rho=-0.098) that does not survive correction across a 22-test
family — recorded as a raw finding worth naming (the first time this family's hit-count has
moved), not as a discovery.

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

**Companion measurement: `HOLDOUT-REUSE-AUDIT` (`ROADMAP.md`, 2026-08-28).** This section
measures a different kind of multiplicity than §§1-3 above — data-reuse inflation rather than
test-count inflation — and predates (2026-08-19) the DJIA-30/DJTA-20 equities holdouts, which
did not exist yet when it was written. `HOLDOUT-REUSE-AUDIT` extends this same count through
2026-08-28 across all five datasets including the two equities universes, re-confirms the
`SEALED_SYMBOLS` finding above independently by direct `ROADMAP.md` re-derivation (not by
citing this section), and answers two questions this section does not cover: DJIA-30 was
scored by 4 prior studies before `EQUITIES-MADIP-SIGNIFICANCE` ran on it (5th touch overall,
11 total by 2026-08-28), and DJTA-20 by 1 prior study before `EQUITIES-MADIP-OUT-OF-SAMPLE`
(2 total, both same-date). It makes no recommendation to change anything here.

## 5. Binding threshold for future studies

The concrete, binding rule (not just narrative here) is written into
`AGENT_PROTOCOL.md`'s new "Multiple-comparisons discipline" section. Summary:

- **Formal NHST studies** (anything reporting a p-value against a pre-registered
  significance gate): a new result is only credible as "statistically significant" if it
  survives a **BH-FDR recomputation across all NHST p-values to date (this document's 22),
  at q=0.05** — not evaluated against alpha=0.05 in isolation. The family-size
  counter (currently 22) must be updated in that section every time a new NHST test is added,
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

### C0-C3 correction-family assignment (pre-registered 2026-08-29, before any C0 result exists)

**Decision: C0 (signal combination), C1 (options-vol risk premium), C2 (macro/cross-asset
regime conditioner), and C3 (FX carry) join the existing formal-NHST family above (§2,
currently n=20) as each produces a p-value — they do not form a new, separately-corrected
family.** Full reasoning is recorded in `ROADMAP.md`'s 2026-08-29 `PHASE-DIRECTIVE-BOOKKEEPING`
entry; summarized here because this is the binding location: (1) this project has never spun
off a separate family for a new hypothesis class alone — `MACRO-REGIME-PRIMARY-SIGNAL`,
`GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`, and `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` are all at
least as distant from price-structure momentum/reversal as C1-C3 are, and all three joined this
same family without a separate-family argument being raised; (2) C0 specifically reuses the
literal same sealed holdout and cost model as two existing family members (`B5-REVERSAL`,
`Classifier P5`) — a new combination of two already-used inputs on already-spent data is not a
fresh information source; (3) none of C0-C3 is pre-registered against a self-contained,
already-corrected internal screen of the kind that would justify a separate family (contrast
`PAIRS-COINTEGRATION-STATARB`'s own 105-pair Engle-Granger test, which for exactly that reason
is not part of this family). This is decided before C0 has been implemented, run, or scored, so
the decision cannot be influenced by where any C-series p-value would land under either scheme.
The family-size counter above (§2, currently 21) must be updated for each p-value C0-C3
produce, per the mechanical rule immediately above — whether it passes or fails.

**Update (2026-08-29): C0 has now run and produced its p-value (0.4708, KILLED — see
`ROADMAP.md`'s `C0-SIGNAL-COMBINATION` section and `VERDICTS.md`), applying this decision rather
than re-opening it. Family grew from n=20 to n=21 as pre-registered; no survivor status
changed.**

**Update (2026-08-29): C1 ran and resolved as a data-availability gate, neither pass nor fail —
it never reached a statistical test, so it does not join this family (`C1-VRP-DATA-AVAILABILITY-
GATE`, code-side confirmed sufficient, account-side entitlement left as an explicit question list
for the human). C2 ran next per the directive's own fallback step and produced its p-value
(0.0365, raw p<0.05 but does not survive BH-FDR at q=0.1338 — see `ROADMAP.md`'s
`C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES` section and `VERDICTS.md`), applying this decision
rather than re-opening it. Family grew from n=21 to n=22 as pre-registered; no survivor status
changed. C3 is next in the sequence.**

No existing verdict changes as a result of this audit.
