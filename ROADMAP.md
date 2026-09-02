# cajh — Progress & Roadmap

_Status: research pipeline rebuilt and made statistically honest; live trading halted. Current finding: the 15m / 1.5–3%-stop / taker-fee search space is nearly empty — the strategy barely trades and shows no edge across regimes. Next: ingest ~20 liquid pairs and re-test on a real population._

---

## What we built

### Data layer
- **`data.js` — candle store + backfill.** Persistent 1-minute store, backfilled from Kraken's public **Trades** endpoint (raw trades → 1m bars + order-flow summary). Reaches deep history the OHLC endpoint (720-candle cap) can't.
- **`loadCandles` resampler.** Turns stored 1m bars into 15m/1h/4h on demand — a drop-in for the live candle fetch.
- **`verifyAgainstOHLC`.** Trust check: store vs Kraken's native OHLC on the overlap.
- **Kraken OHLCVT archive ingester (`ingestKrakenOHLCVT` + `ingest`).** Loads Kraken's downloadable historical CSVs into the store — minutes per pair vs the ~15-hour Trades grind.

### Research tooling
- **`research.js` CLI.** Runs `backtest / discover / profile / validate / backfill / ingest` locally against the store — no Discord, no live bot. Research is an offline, local job; the Railway bot is for live execution only.
- **Store-backed research (`tfCandles`).** Research commands read the deep store (with live fallback), so `discover`/`backtest` see 18 months, not 720 candles.

### Honest statistics (the "judge")
- **Slippage** in the backtest — perfect-fill results no longer overstate edge.
- **Per-leg fee model** (reviewer) — each leg charged on its own notional.
- **BH-FDR multiple-testing correction** in `discover` — testing many rules no longer manufactures false "edges."
- **Day-block permutation** (reviewer) — the null preserves within-day cross-asset correlation, so p-values reflect the true (smaller) effective sample. The old i.i.d. shuffle was biased toward false positives.
- **Right-censoring fix** (reviewer) — uniform resolution window, so fast losses and slow wins aren't counted asymmetrically near the data's end.
- **Regime-aware reporting** — `discover` splits net-R/t by BTC regime (bull/bear/flat), so a regime-specific edge (or a uniform loss) is visible.
- **Profiler-matches-live stop gate** — the profiler only counts setups in the tradeable 1.5–3% stop band, so the search tests the population the live strategy would actually take.
- **Data-source readout** — per-asset candle count + date span, and an honest backtest header, so you always see what was loaded.
- **Curated feature combinations** — a small set of theory-motivated AND-rules, through the same FDR.

### Feature set (`features.js`, pure & no-lookahead)
- ATR / volatility regime, displacement, **liquidity sweep** (flush-then-turn), FVG, previous-day high/low.
- **BTC 4h context** (`btcBias4h`, `returnAsOf`) — bias + 24h return of BTC at each entry.

### Bug fixes & safety
- **False-close fix** — a position is only marked closed if the exchange sell actually succeeds (was silently abandoning positions on failed sells).
- **Drawdown-spam fix** — the daily halt announces once, not every 30s.
- **Durable kill switch** — `!stop` / `START_HALTED` survive the midnight reset; only `!resume` clears them.
- **HTF look-ahead fix** — BTC context uses the last *closed* 4h bar (no leaking a still-open close into a 15m entry).
- **Orphan reconciliation** — on boot and via `!reconcile`, compares Kraken holdings vs tracked trades and flags orphans.
- **Live-safety (reviewer):** monitor always starts (stop-losses run even without a scan channel); `!scan` is owner-gated (it auto-buys); a double-buy race is locked in `scanner.js`.

### Housekeeping
- Logger migration (`console.*` → `logger.*`), gitignore fix (stop tracking runtime data + candle store), README corrected (single 4R TP + breakeven lock; 15-min scans), first unit tests (`npm test`).

### The headline discovery
Research had been **silently running on ~7.5 days of data**: `.env` set `DATA_DIR=/data` (a Railway path) locally, so `tfCandles` found no store and fell back to the 720-candle live pull. Every prior *local* `discover`/`backtest` verdict was drawn on a week of data. Fixed by commenting `DATA_DIR` out locally (keep it set on Railway, where it belongs).

---

## Current honest finding

With the pipeline fixed and rigorous, on 18 months of BTC:
- The strategy **barely trades** (5–7 trades in 18 months) — a 1.5% minimum stop on 15m majors almost never occurs.
- After the stop-gate, `discover` found **~94 tradeable candidates across 38 assets and correctly refused to search** ("too few").
- No edge across regimes (bull ≈ bear, both negative).

The diagnosis isn't so much "no edge" as **the current search space is nearly empty.** Three levers could open a real one: more deep pairs, lower costs, higher-timeframe entries.

---

## Roadmap

### Immediate
1. **Ingest ~20 liquid pairs** via the archive (`node research.js ingest ETH SOL XRP …`) — skew to volatile alts; they produce more in-band stops than low-vol majors.
2. **Re-run `discover`** on the multi-pair population; read the regime line.
3. **Seal a holdout** — reserve recent months *and* a few entire symbols that no sweep ever touches.

### Finding an edge (research)
- **Walk-forward + sealed holdout** (time *and* symbol) — the honest final validation; the last piece of the judge.
- **%-based exit model** (spec'd, not yet in the harness) — 3% stop / 10% target / partial + trail. Tests whether edge exists toward a modest/trailing target that the 4R-or-die exit throws away.
- **Anticipation entries** — enter when the signal is *expected*, not after it confirms; addresses "BOS entries are late." Needs 1m/intrabar fill modeling.
- **Lower costs** — post-only maker entries / limit TP exits (requires a fill-probability + adverse-selection simulation; not a free lunch).
- **Higher-timeframe entries** (1h/4h) where stops naturally clear the fee floor (`!optimize` already sweeps `entryTf`).
- **More features** — *only* if `discover` says the set is close-but-missing: momentum divergence, swing magnitude in ATRs, order-flow imbalance (needs the trades-based store, not the OHLCVT archive), volume profile, funding/OI.

### Go-live checklist (before *ever* flipping live)
- **Exchange-resident protective orders** — Kraken stop-loss/take-profit/OCO on the exchange; the 30s poller as backup only.
- **Fills as events** — `cl_ord_id`, record actual fills/fees/partials via the execution stream; `getFillPrice` reads `QueryOrders` instead of estimating.
- **Risk-based sizing + correlated-exposure cap** — size per stop distance & liquidity; cap total worst-case loss across correlated crypto longs.
- **Sim/live fidelity** — model gap fills and the 30s exit poll; `RECENT_BARS` lets live enter up to 4h after confirmation while backtest enters at the confirm close; trigger stops on the bid or two consecutive ticks, not one stray print.
- **Trade journal + drift tracking** — log every live trade (entry/exit reason, regime, R) and compare to backtest.
- **Cross-restart persistence of the manual halt** — in-memory today; `START_HALTED` covers the restart case.

### Housekeeping
- Prune delisted pairs (MKR, EOS) from `DISCOVER_UNIVERSE`.
- `handleWhy` label map is missing `noRoom`.
- Finish any remaining `console.*`; expand the test suite beyond the current three.

### Process discipline (non-negotiable — from the reviews)
- **Never select on the same window twice.** Lockbox recent months.
- A credible edge must survive **conservative costs + untouched data (time *and* symbol) + multiple regimes + a logged paper-trading period.** If it fails any of those, the right answer is **stay flat** — not another indicator.

---

_No code review can promise an edge exists. What's fixed is that the pipeline is now capable of detecting one honestly if it's there — and of telling you the truth when it isn't._

---

## Archived sections

The dated sections below (2026-07-30 through 2026-08-27, 49 sections) were moved
verbatim to `ROADMAP_ARCHIVE.md` to keep this file to a size worth reading on every
firing. Nothing was deleted or rewritten -- follow a title below into
`ROADMAP_ARCHIVE.md` for the full entry. One section in this date range names the
environment-variable opt-in default that keeps live trading off by default; the
pre-commit protected-logic hook treats that name as protected text anywhere in a
diff, so that one section was excluded from the move and stays below, in place,
in full.

- **2026-07-30** -- overnight build (autonomous session) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-07-30** -- the decisive result -- kept in ROADMAP.md in full (see below), not moved
- **2026-07-30** -- stop placement tested; data completed; archive pruned -- moved to `ROADMAP_ARCHIVE.md`
- **2026-07-30** -- the finding that reframes every earlier result -- moved to `ROADMAP_ARCHIVE.md`
- **2026-07-31** -- 2023-2024 ingested; the simple daily strategy tested across regimes -- moved to `ROADMAP_ARCHIVE.md`
- **2026-07-31** -- overlay, uncapped trailing exits, and what data we actually have -- moved to `ROADMAP_ARCHIVE.md`
- **2026-07-30** -- order flow tested: the first signal that isn't flatly zero -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-13** -- PWR5-MAKER-FILL-COST-REDUCTION Phase 1: realistic cost model, empirical fill calibration, funding-endpoint finding -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-13** -- PHASE2-MAX-SURVIVABLE-COST: triage of the four cost-killed signals against PHASE1's real cost scenarios -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-13** -- PHASE3-RERUN-REAL-SIGNALS-NEW-COSTS: B5-REVERSAL's real symbol-holdout economics, first-ever positive result, with a caveat -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-13** -- PHASE4-PORTFOLIO-SHARED-CAPITAL-SIM-COSTPLAN: the WEAK PASS does not survive a real equity curve — FAIL -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-14** -- FUNDING-CARRY-DECAY-CHECK: a genuinely different mechanism (harvest the -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-14** -- MOMENTUM-SHORT-HORIZON-RECHECK: a new pre-registered short-lookback primary, KILLED on train significance at both horizons -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-18** -- SEASONALITY-DAYOFWEEK-SESSION: descriptive day/session breakdown, no cell -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- TEST-DATA-GATE-SKIP-NOT-FAIL: precondition-driven test failures converted to explicit skips (engineering, not research) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- SIGNAL-DECAY-TEMPORAL-STABILITY: the pooled baseline is NOT stationary — both families drift significantly across time -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC: losing trades mostly run straight to the stop, not stopped just short of reverting -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- COST-COMPONENT-ATTRIBUTION: fee is 94.1% of the -0.864/-0.884R baseline drag, exactly and by construction -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- EXECUTION-DELAY-DECAY-CURVE: sharp degradation with fill latency — the maker-execution thesis is dead on arrival -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-19** -- EQUITIES-BASELINE-PORT: breakout survives real IBKR costs (net positive); anticipate's net drag shrinks by ~20x but stays negative -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-20** -- HOLDING-PERIOD-COST-AMORTIZATION-MAP: only anticipate's longest-hold bucket clears net-positive, and it's 11% of trades; breakout never clears at any holding period -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-20** -- COST-SENSITIVITY-SURFACE: `breakout` crosses zero only at an idealized -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-20** -- WATCHLIST-LIQUIDITY-REALISM-AUDIT: one asset (XTZ) real slippage 2.7x the flat -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-21** -- EQUITIES-BREAKOUT-SIGNIFICANCE: the CI includes zero — the positive point estimate does not survive its own significance test -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- ZERO-COST-FLOOR-ALL-FAMILIES: 0/12 families clear a meaningful gross edge; the price-structure thesis is closed with a number -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- PER-EPOCH-GROSS-EDGE: no epoch, in either family, carries meaningfully positive gross edge — the non-stationarity SIGNAL-DECAY found never hides a working regime -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- WALKFORWARD-REVALIDATION-OF-BASELINE: `anticipate`'s fold-to-fold drift is statistically significant, `breakout`'s isn't — the single split is not uniformly adequate -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- CANDLE-CORPUS-GAP-AUDIT: 26 of 29 watchlist assets have not collected a new candle since 2026-03-31 — every "full local history" claim made by any study run after that date is silently truncated for everything but BTC/ETH/SOL -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-COST-ASSUMPTION-SENSITIVITY: `breakout`'s net-positive equities result survives every plausible slippage citation, breaks only past 45bps; the unmodeled $1 commission floor binds well within a realistic retail position size -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-ALL-FAMILIES-BASELINE: 10 of 12 unmodified families produce a positive net avgR on the equity universe, but sample size ranges from 475 trades down to 0 — this is a breadth measurement, not a promotion -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- TIME-VARYING-COST-REPRICING: a real Kraken Tier-1 fee-schedule change is confirmed inside the sample window, but the pre-change rate could not be reliably sourced — honest non-verdict, no repricing performed -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-MADIP-SIGNIFICANCE: `ma_dip`'s positive point estimate is closer to nominal significance than `breakout`'s, on 7x the sample — but still does not clear BH-FDR -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-BREAKOUT-COMMISSION-FLOOR-POSITION-SIZING: the real $1 commission floor costs `breakout` 0.6-2.4 cents of avgR at realistic retail sizes, but never drags the result to breakeven across the pre-registered $2k-$50k range -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-BREAKOUT-OUT-OF-SAMPLE: on a fresh universe, the edge does not reproduce — it flips negative -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EXOGENOUS-DATA-ACCESS-AUDIT — measuring what's actually reachable before writing another hypothesis against it (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- MACRO-REGIME-PRIMARY-SIGNAL — the first genuinely exogenous primary signal tested, closes as a sample-size non-verdict (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- LOG-REGRESSION-BANDS-CRYPTO — the pre-registered test formally survives BH-FDR, and this study's own control shows why that survival should not be trusted (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- EQUITIES-MADIP-OUT-OF-SAMPLE — the edge reproduces on a fresh universe and gets stronger, now formally clearing family-wide BH-FDR (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- OPTIONS-SKEW-PRIMARY-SIGNAL — closes as a data-availability non-verdict before any strategy code was written (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- WHALE-WALLET-ACCUMULATION-PRIMARY — closes as a data-availability non-verdict, per its own pre-registered escape hatch (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- SPECTRAL-CYCLE-DETECTION-CRYPTO — periodogram scan against an AR(1) red-noise null finds no periodicity that survives correction (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- LOG-REGRESSION-BANDS-EQUITIES — the equities companion reverses sign, and its own control shows why: the same benchmark-direction artifact as crypto, running in the opposite direction (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-22** -- SPECTRAL-CYCLE-DETECTION-EQUITIES — pre-registered earnings/expiry frequencies and an unrestricted scan both find nothing that survives correction (2026-08-22) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-23** -- GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL — a genuinely exogenous news-attention regime signal, killed on wrong sign and cost drag from fast episode turnover (2026-08-23) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-25** -- MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES — the deeper-history re-run still lands on 1 holdout episode; the constraint was the split, not the market (2026-08-25) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-27** -- ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL — KILLED, wrong sign in both train and holdout, high-turnover cost drag the likely driver (2026-08-27) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-27** -- WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC — partial explanation: wider band cuts turnover and shrinks the loss, but the signal stays wrong-signed and non-significant (2026-08-27) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-27** -- STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC — a third band width shrinks the loss most of the way to zero and pushes the sign-flip p-value close to 0.72, but the signal remains wrong-signed and non-significant (2026-08-27) -- moved to `ROADMAP_ARCHIVE.md`
- **2026-08-27** -- MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC — 50/50 split still lands on 1 holdout episode; the split fraction was never the real constraint (2026-08-27) -- moved to `ROADMAP_ARCHIVE.md`

**Byte/section reconciliation.** Original `ROADMAP.md`: 666,943 bytes, 79 dated sections (plus
the intro material above). After this move: `ROADMAP.md` and `ROADMAP_ARCHIVE.md` combined are
678,425 bytes (the ~11.5KB delta is this index, the carve-out reason, this reconciliation
paragraph, and the archive file's own header — not lost or duplicated content) and still account
for all 79 dated sections (48 moved, 1 carved out and kept here, 30 left in place after the
cutoff).

**TOURNAMENT_ROADMAP.md assessed, not touched.** 170,434 bytes, 37 sections, last modified
2026-08-19 (unchanged since, per the DEAD-CODE-AND-ASSET-AUDIT reachability sweep above) and still
cited by roughly ten files across this repo. It is not currently growing the way `ROADMAP.md` was
before this pass, so it does not need this treatment on the same urgency — but it is large enough,
and old enough at the front, that the same archive convention would apply cleanly whenever it
starts growing again or a future housekeeping pass has spare scope. Recommendation: leave it as
is for now; revisit with the same method (measure the section-by-date distribution, pick a cutoff,
scan for the protected identifiers before moving anything) if it resumes growing or a retention
pass is done at scale.

---

## 2026-07-30 (later) — the decisive result

Data first: the Q1-2026 archive was ingested (merge-safe), giving 12 pairs with
continuous history from Jan 2025 → Mar 2026, plus BTC current to today. Seven pairs
(NEAR/FIL/APT/INJ/TAO/TIA/SUI) exist **only** from Q1 2026 and DOGE has no store at
all — they are excluded from train/holdout comparisons rather than silently loading
the holdout.

**Exit-model sweep (`!exits`, `node research.js exits`)** — entry rule held fixed,
12 exit models swept, trained on history → 2025-12-31 and scored on Q1 2026, which
was not present on this machine until today (a genuinely sealed holdout):

- Every model is net-negative in both windows: −0.41 → −0.50 R/t train,
  −0.51 → −0.69 R/t holdout. **0 of 12 pairs green in every configuration.**
- Best exit (trail 1R after 1R) beats the live exit by ~0.07 R/t — it reshuffles the
  loss, it does not create an edge.

**Cost sensitivity — the finding that settles it.** Re-running with costs set to zero:

| model | gross (no costs) | maker 0.16% | taker 0.40% |
|---|---|---|---|
| live: TP4 + BE-lock | −0.094 R/t | −0.249 R/t | −0.480 R/t |
| trail 1R after 1R | −0.019 R/t | −0.176 R/t | −0.411 R/t |

**Gross expectancy is zero-to-negative.** Costs are not what is killing this strategy;
there is nothing underneath them. This closes the roadmap's "lower costs / maker fills"
lever — building a post-only execution stack would be weeks of work to make a −0.02 R/t
strategy into a −0.02 R/t strategy. It also closes "%-based exit model": tested, no.

What remains open is the ENTRY. A swing-low anticipation trigger, taken on every
occurrence across 1h/4h/1d, is a coin flip. Any future work should be spent finding a
trigger with measurable gross edge *before* any execution or exit engineering — and the
`exits` harness now measures exactly that in one command.

**Live trading now defaults to OFF** (`LIVE_TRADING=true` to opt in), because deploying
this strategy against real money is a known-loss event, not an unknown one.

---

## SHORT-SIDE-ENGINE-CAPABILITY — a short-entry path added to the backtest engine; no family run, no result (2026-08-28)

**Scope, per this item's own note.** This item produces NO research result and reports none.
It exists only so a later item can ask whether short entries behave differently — currently
unanswerable, since `backtest.js` had no representation of a short position at all.
`tournament.mjs` is untouched; no family was run; no avgR appears anywhere in this entry.

**What changed.** `backtestMultiTF` (`backtest.js`) gained a `direction` parameter,
`"long"` by default. Only `entryMode: "bos"` has a short-entry candidate: the mirror of a
long entry's confirmed swing LOW is a confirmed swing HIGH, which `detectSwings` already
detects and which the engine already tracked (`highAt`, previously only used for the
`exitOnSwingHigh` option). A new `highPivotAt` map (mirroring the existing `lowAt` map)
exposes that pivot's price so `direction: "short"` can use it as the entry's stop. Every
other entryMode's candidate generator (support/ma_dip/rsi/rev/breakout/vol_contraction/
trend_pullback/sweep_reclaim/range_sweep_reclaim/h3/anticipate/fib_pullback) is long-only
and untouched — `direction: "short"` throws for any entryMode other than `"bos"`.

**Arithmetic is inverted honestly, not by negating outputs.** For a short: stop sits ABOVE
entry (at the swing-high pivot's price), `tp = entry - tpR*(stop-entry)` sits BELOW entry,
the stop triggers on a bar's HIGH (not its low), and the target triggers on a bar's LOW (not
its high) — exact mirrors of the long path. Same-bar stop/target ambiguity still resolves to
the stop first, matching the long-side convention (conservative: if both are touched in one
bar, assume the worse outcome). MAE/MFE (`pos.maxAdverseR`/`maxFavorableR`) are also
direction-aware: for a short, adverse is price rising, favorable is price falling.

**Cost formula confirmed direction-agnostic, as required.** `backtest.js`'s net-R formula is
`(directional P&L term) - ((feeRate + slipPct) * (entry + exitPx)) / risk`. The fee/slippage
term applies to `(entry + exitPx)` regardless of direction and was NOT changed; only the
directional P&L term flips (`(entry - px)/risk` for a short vs. `(px - entry)/risk` for a
long) — see the `netAt` closure in the per-bar exit-resolution block (the comment directly
above it in `backtest.js` cites this explicitly). Confirmed by test, not just by inspection:
a stop-out short trade's realized R matches `netAtShort(entry, stopPx, risk)` computed
independently in the test file.

**Known missing cost, stated explicitly per this item's own requirement.** Borrow
availability and borrow cost are NOT modeled anywhere in this engine — there is no concept
here of a borrow fee, or of a short being unavailable/unlocatable. Any short P&L this engine
could ever produce is before that cost. This is recorded both in a `backtest.js` code
comment (on the `direction` parameter) and here. Separately: a short's loss is unbounded
above, while a long's is bounded at zero at worst — any future drawdown or survivability
study on shorts cannot reuse the long-side assumptions (e.g. `(1-f)^k` capital-after-a-
losing-streak math) unchanged without accounting for that asymmetry.

**Deliberately NOT made direction-aware this item, and rejected outright rather than
silently mishandled.** `direction: "short"` throws if combined with `trailR`, `partialAtR`,
`trailingTpPct`, `lockBreakeven` (note: `LOCK_BREAKEVEN` defaults to `true` in
`strategy.js`, so a short call must explicitly pass `lockBreakeven: false` or it throws),
`exitOnSwingHigh`, `requireHigherLow`, or `minRoomR` — none of these have been proven
direction-aware, and applying long-oriented logic to a short position silently would have
produced wrong numbers rather than an honest gap. Alignment/trend-gate semantics
(`alignMode`, `chopFilter`, `trendGate`) also remain long-oriented (e.g. `alignMode: "all"`
still means "every higher TF bull") and were not inverted for shorts — out of scope here,
noted for whoever wires an actual short economic hypothesis later.

**Tests.** `backtest.test.mjs` gained 8 tests: long-side output is byte-for-byte identical
whether `direction` is omitted or passed explicitly as `"long"` (the required no-op proof,
run against the fixture backing this file's own long-standing BOS-mode expectation); stop
placed above entry / target below entry; the stop firing specifically on a HIGH breach with
the low nowhere near the target (isolates the check); the target firing specifically on a
LOW breach with the high nowhere near the stop; same-bar stop+target ambiguity resolving to
the stop; and three validation tests (unknown `direction` string throws; `direction:
"short"` with a non-`"bos"` entryMode throws; `direction: "short"` with `lockBreakeven` left
at its true default throws). The short-side fixture (`shortEntryPrefix`/`mirror` in
`backtest.test.mjs`) reflects this file's already-trusted long BOS fixture through price 200
rather than hand-inventing new candle values — reflecting a confirmed swing LOW into a
confirmed swing HIGH is provably confirm-timing-identical under that reflection (the low
pivot's confirm condition is "close > pivot high"; the high pivot's is "close < pivot low";
these are the same inequality reflected), so the short entry mechanics are exercised against
a fixture whose shape is already known-correct, not a new one that could hide a construction
bug.

**Engineering note.** `backtest.js` and `backtest.test.mjs` only. `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` untouched (`git diff
--stat` shows exactly these two files). No family run, no `avgR` computed or reported
anywhere in this item. `npm.cmd test`: 513/513 green (505 prior + 8 new).

## 2026-08-28 — DATE-CLUSTERED-RESAMPLING-AUDIT: both equities CIs widen under date-clustered resampling — `ma_dip`'s effective sample is a quarter of its nominal count

Every equities CI this project has computed (`EQUITIES-BREAKOUT-SIGNIFICANCE`, 2026-08-21;
`EQUITIES-MADIP-SIGNIFICANCE`, 2026-08-22) used `blockBootstrapCI` (`momentum.mjs`), which blocks
by ARRAY POSITION. When trades from 30 DJIA names are pooled symbol-by-symbol, trades triggered
on the same calendar day by the same market-wide move sit at arbitrary positions in that array —
a position-based block cannot capture that correlation, and each trade is counted as an
independent observation even when a dozen fired off the same index-wide gap. This item measures
the actual clustering and recomputes both CIs against it. Full pre-registration text (written
before any statistic below was computed): `scripts/date-clustered-resampling-audit.mjs`'s header,
same commit as these results.

**Replication check, before trusting anything new.** The script reproduces both sealed studies'
exact trade count, avgR, AND the recorded position-blocked 95% CI itself bit-for-bit off the same
cached candles, same pooled order, same `blockBootstrapCI` call unmodified — confirms this is the
same population already on record, not a re-derivation:

| family | trades match | avgR match | position-blocked CI match |
|---|---|---|---|
| `breakout` | 61 = 61 | +0.186624 = +0.1866 | [-0.27003, +0.61921] = [-0.2700, +0.6192] |
| `ma_dip` | 475 = 475 | +0.152634 = +0.1526 | [-0.05444, +0.36092] = [-0.0544, +0.3609] |

**Trades-per-day clustering, pooled across all 30 symbols:**

| family | trades | distinct calendar days | largest single-day cluster | mean simultaneously-open positions |
|---|---:|---:|---:|---:|
| `breakout` | 61 | 35 | 7 | 8.26 |
| `ma_dip` | 475 | 124 | 13 | 10.47 |

`breakout`'s trades-per-day histogram: 20 days with 1 trade, 10 with 2, 2 with 3, 2 with 4, 1 with
7. `ma_dip`'s: 18 days with 1, 23 with 2, 29 with 3, 15 with 4, 12 with 5, 12 with 6, 6 with 7, 2
with 8, 3 with 9, 2 with 11, 1 with 12, 1 with 13. Neither family is a uniform spread of
one-trade-per-day — both have real multi-symbol same-day clusters, and `ma_dip` has them more
often and larger.

**Date-clustered 95% CI, side by side with the position-blocked interval already on record** (both
via 5000-iteration bootstrap, 2.5/97.5 percentiles; date-clustered seeds 20260830/20260831, fixed
before running and not revisited):

| family | position-blocked CI (on record) | date-clustered CI (new) | direction |
|---|---:|---:|---|
| `breakout` | [-0.2700, +0.6192] | [-0.2904, +0.6863] | widens both tails |
| `ma_dip` | [-0.0544, +0.3609] | [-0.1010, +0.4083] | widens both tails |

**Effective sample size**, defined here as the number of distinct calendar days carrying at least
one trade — the date-block bootstrap's actual unit of independent resampling is one day, not one
trade, so this is the largest number of genuinely independent draws that resampling scheme can
ever make:

| family | nominal n | effective n (distinct days) | effective / nominal |
|---|---:|---:|---:|
| `breakout` | 61 | 35 | 57% |
| `ma_dip` | 475 | 124 | 26% |

**Explicit statement on `EQUITIES-BREAKOUT-SIGNIFICANCE` and `EQUITIES-MADIP-SIGNIFICANCE`'s
conclusions: both CIs widen, and `ma_dip`'s widens by more in absolute terms than `breakout`'s.**
Neither family's headline conclusion flips outright — both position-blocked CIs already included
zero, and both date-clustered CIs still include zero — so "CI includes zero, not distinguishable
from noise" was already the honest read and remains it. But the direction of travel is uniformly
toward WEAKER evidence, not stronger, and `ma_dip` is the one this project has been treating as
its closest-to-significant equities result (p=0.0648, the nearest any equities test has come to
the uncorrected 0.05 line). Under date-clustering its nominal 475-trade sample behaves like
roughly 124 independent days, its CI's lower bound nearly doubles in magnitude (-0.0544 →
-0.1010), and the "7x breakout's sample size" framing `EQUITIES-MADIP-SIGNIFICANCE` used to argue
`ma_dip` was the more evidence-backed candidate is weaker than it read at the time: 475 trades is
7x `breakout`'s 61, but 124 effective days is only 3.5x `breakout`'s 35. This is reported as
prominently as a tightening result would have been, per this item's own requirement — it is not a
reversal of either sealed decision, but it is a real reduction in how much independent evidence
`ma_dip`'s positive point estimate actually carries.

**`MULTIPLE_COMPARISONS_AUDIT.md` not touched.** Its recorded p-values, q-values, and BH-FDR
ranks for both families are computed from the sign-flip permutation test, not from
`blockBootstrapCI`, and neither of those recorded numbers changed here — `blockBootstrapCI` itself
is unmodified and its recorded outputs for these two families are reproduced bit-for-bit above.
This item's own conditional ("update `MULTIPLE_COMPARISONS_AUDIT.md` if any recorded interval
changes") therefore does not trigger.

**Engineering note.** New: `scripts/date-clustered-resampling-audit.mjs` (read-only, cache-only —
does not import `brokers/ibkr.mjs`). `backtest.js` gained one purely additive field,
`excursions[].entryTime` (the entry candle's unix time; every pre-existing field on that object is
unchanged, and `results` — the raw per-trade R array every other consumer reads — is untouched) —
needed because no existing return value exposed a trade's calendar date, and calendar-day grouping
is the entire point of this item. `momentum.mjs`'s `blockBootstrapCI` used unmodified, not edited;
the date-block bootstrap is a new, separate function local to this script. `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` untouched. `npm.cmd test`:
513/513 green before and after (the new `entryTime` field does not break any existing assertion —
no test in this project deep-equals the full `excursions` object shape).

---

## HOLDOUT-REUSE-AUDIT — a count, not a verdict: every holdout dataset in this project scored, chronologically, by every study that used it; SEALED_SYMBOLS remains the only genuinely unspent resource (2026-08-28)

**Scope, stated up front per this item's own done_when.** This is a counting exercise, not a
hypothesis test and not a recommendation. No parameter, threshold, correction family, or protocol
rule is proposed for change anywhere below — the item's job is to produce the count a future
decision would need, not to make that decision.

**Method.** Read every `##`-level heading in `ROADMAP.md` (76 sections) chronologically, plus the
holdout/dataset definitions in `AGENT_PROTOCOL.md`, `ALPHA_DEFINITION.md`, `researchlib.mjs`, and
`momentum.mjs`. Classified each study by which named holdout dataset(s) it scored a strategy
against, distinguishing "scored a strategy's holdout performance" from adjacent-but-different uses
(diagnostics on candle completeness, liquidity, or cost-schedule facts that touch the same cache
without computing a strategy result). `MULTIPLE_COMPARISONS_AUDIT.md` §4 (dated 2026-08-19,
predates the DJIA-30/DJTA-20 equities work which starts the same day) already contains an
independently-built partial version of this count for the crypto-side datasets and is used below as
a cross-check, not a source — every number below was re-derived directly from `ROADMAP.md`.

### Dataset 1 — Crypto calendar 70/30 split (`train: earliest→2025-06-01`, `holdout: 2025-06-01→present`, 28-asset active watchlist, `tournament.mjs` families)

This is the project's default judge for the twelve price-structure families. An earlier, distinct
precursor — the 2026-07-30/31 "sealed Q1-2026" holdout (train through 2025-12-31, scored on Q1
2026) — served the same purpose before this convention crystallized; it is not literally the same
split and is not counted in the total below.

Chronological studies scoring a strategy against this holdout: the original 2026-07-30/31
exit-model/stop-placement sweep; `T1-ZEROCOST` (~2026-08-06/07); `SEASONALITY-DAYOFWEEK-SESSION`
(2026-08-18); `MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC`, `COST-COMPONENT-ATTRIBUTION`,
`EXECUTION-DELAY-DECAY-CURVE` (all 2026-08-19); `HOLDING-PERIOD-COST-AMORTIZATION-MAP`,
`COST-SENSITIVITY-SURFACE` (2026-08-20); `ZERO-COST-FLOOR-ALL-FAMILIES`,
`WALKFORWARD-REVALIDATION-OF-BASELINE`, `MACRO-REGIME-PRIMARY-SIGNAL`,
`LOG-REGRESSION-BANDS-CRYPTO` (all 2026-08-22); `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`,
`WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`, `STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC`
(all 2026-08-27) — **14 distinct studies**, matching `MULTIPLE_COMPARISONS_AUDIT.md`'s independent
count of "~26-27" when that document's broader definition (every individual family-level economic
gate, not per-study) is applied to the same window. `CANDLE-CORPUS-GAP-AUDIT` (2026-08-22) and
`SPECTRAL-CYCLE-DETECTION-CRYPTO` (2026-08-22) touch the same cache but are flagged, not counted:
the former explicitly measures data completeness only ("counting missing bars touches no strategy
result"), the latter runs a periodogram on train-mean-subtracted full history rather than a strict
train/holdout strategy score. `SIGNAL-DECAY-TEMPORAL-STABILITY` and `PER-EPOCH-GROSS-EDGE` both
explicitly state in their own text that they do *not* use this split (full history / 5 disjoint
epochs instead) and are excluded on that basis, not omitted by oversight.

**Spent.** Both this audit's own count (14 studies) and `MULTIPLE_COMPARISONS_AUDIT.md`'s
independent 2026-08-19 count (~27 individual family-gate evaluations) agree this window has been
examined far past the point of being a fresh judge for any new price-structure family test.

### Dataset 2 — DJIA-30 point-in-time equity holdout (30 DJIA constituents as of 2024-08-19, `research-cache/equities-1d/`, real IBKR costs, 70/30 split)

Chronological studies: `EQUITIES-BASELINE-PORT` (2026-08-19, ROADMAP_ARCHIVE.md:2013, first use —
`breakout`/`anticipate`) → `EQUITIES-BREAKOUT-SIGNIFICANCE` (2026-08-21, ROADMAP_ARCHIVE.md:2464) →
`EQUITIES-COST-ASSUMPTION-SENSITIVITY` (2026-08-22, ROADMAP_ARCHIVE.md:3063) →
`EQUITIES-ALL-FAMILIES-BASELINE` (2026-08-22, ROADMAP_ARCHIVE.md:3167 — first computes `ma_dip`'s 475-trade
DJIA-30 result) → **`EQUITIES-MADIP-SIGNIFICANCE`** (2026-08-22, ROADMAP_ARCHIVE.md:3373) →
`EQUITIES-BREAKOUT-COMMISSION-FLOOR-POSITION-SIZING` (2026-08-22) →
`LOG-REGRESSION-BANDS-EQUITIES` (2026-08-22) → `SPECTRAL-CYCLE-DETECTION-EQUITIES` (2026-08-22,
flagged ambiguous — periodogram on full history, same caveat as its crypto companion) →
`MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES` (2026-08-25) →
`MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC` (2026-08-27, same cache re-split 50/50 — a second
distinct partition of the same underlying candles, not a new dataset) →
`DATE-CLUSTERED-RESAMPLING-AUDIT` (2026-08-28, re-analyzes the exact `breakout`/`ma_dip` populations
from earlier entries with a different resampling scheme).

**Question required by this item: how many studies scored the DJIA-30 equity holdout before
`EQUITIES-MADIP-SIGNIFICANCE` ran on it? Answer: 4** — `EQUITIES-BASELINE-PORT`,
`EQUITIES-BREAKOUT-SIGNIFICANCE`, `EQUITIES-COST-ASSUMPTION-SENSITIVITY`, and
`EQUITIES-ALL-FAMILIES-BASELINE` (the last of which is where `ma_dip`'s own 475-trade DJIA-30
result was first computed — `EQUITIES-MADIP-SIGNIFICANCE` added the formal p-value on trades
already computed by a prior study, not a fresh score). `EQUITIES-MADIP-SIGNIFICANCE` was therefore
the **5th** touch of this cache, not the first.

**Spent.** 11 studies deep by 2026-08-28, spanning three different strategy families and at least
one re-split of the underlying partition. Criterion applied throughout this audit: a dataset counts
as spent once more than one independent study has computed a strategy result from it, since each
additional look inflates the effective false-positive rate of every subsequent test on that same
data in a way no single study's own p-value can see. By that criterion DJIA-30 was already spent
after its 2nd use (`EQUITIES-BREAKOUT-SIGNIFICANCE`).

### Dataset 3 — DJTA-20 out-of-sample equity universe (20 DJTA constituents as of 2024-08-22, zero ticker overlap with DJIA-30, `research-cache/equities-1d-djta-oos/`)

Chronological studies: `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` (2026-08-22, first use — `breakout` and
`anticipate`) → **`EQUITIES-MADIP-OUT-OF-SAMPLE`** (2026-08-22, same date, reuses the same cache for
`ma_dip` — the project's strongest surviving equities result, BH-FDR rank 4/15).

**Question required by this item: how many studies scored the DJTA-20 universe before
`EQUITIES-MADIP-OUT-OF-SAMPLE` ran on it? Answer: 1** (`EQUITIES-BREAKOUT-OUT-OF-SAMPLE`, which
itself scored two families — `breakout` and `anticipate` — against it). Counting by
study, `EQUITIES-MADIP-OUT-OF-SAMPLE` is the 2nd; counting by family-level score, it is the 3rd
(`breakout`, `anticipate`, then `ma_dip`).

**In ma_dip's favor, reported as required.** This is a materially lower reuse count than DJIA-30's
(1 prior study vs. 4) — the DJTA-20 universe was introduced specifically as a fresh-universe
replication check, used exactly once before `ma_dip`'s own out-of-sample test, and that one prior
use was itself a negative-control-style check (`breakout`'s edge failed to reproduce there, sign
flipped negative) rather than a result that shaped what `ma_dip` was expected to find. Compared to
DJIA-30's 5th-touch history, `ma_dip`'s DJTA-20 result carries meaningfully more claim to being a
first look, not a fifth one.

**Spent, by the same >1-study criterion as Dataset 2**, but only barely — 2 studies deep, both on
the same date, vs. DJIA-30's 11.

### Dataset 4 — Whole-symbol crypto momentum holdout (`STABLE_13` train / 16-symbol watchlist-minus-`STABLE_13` holdout, `momentum.mjs`)

Chronological studies (all 2026-08-06 → 2026-08-14, matching `MULTIPLE_COMPARISONS_AUDIT.md`'s
independent count of "6 NHST studies / 9 sub-tests"): Momentum M7 (~08-06) →
low-vol/low-beta B4 (~08-07) → Signal-3 classifier P5 first sealed run (~08-07/08) →
short-term reversal B5 (~08-08) → `CLASSIFIER-FUNDING-FEATURE` (~08-08) →
`MOMENTUM-SHORT-HORIZON-RECHECK` (2026-08-14). No study touches this holdout again through
2026-08-28. Flagged separately, per this audit's own instruction not to silently fold ambiguous
cases in either direction: `B5-REVERSAL-PHASE3-FUTURES-COST` and
`B5-REVERSAL-PHASE4-PORTFOLIO-SIM` (both 2026-08-13) reuse the numerically identical 16-symbol
population but `MULTIPLE_COMPARISONS_AUDIT.md` §4 describes it as "a third, genuinely different
construction... assembled ad hoc for that one study" rather than a formal draw on this
infrastructure. Whether those two count as additional spends of the same 16 symbols is left to a
future decision, not resolved here.

**Spent.** 6-9 uses by the >1-study criterion, abandoned since 2026-08-14 in favor of the calendar
split and later the equities holdouts.

### Dataset 5 — `SEALED_SYMBOLS` (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI` — `researchlib.mjs`)

**Confirmed unspent.** No `ROADMAP.md` entry scores a strategy against this pool. Every mention
found (grepped case-insensitively for the literal name and separately for the five tickers in
holdout contexts) is one of: a restatement that the pool's re-run rule does not yet apply because
no study has cleared the qualifying economic-gate threshold (`ZERO-COST-FLOOR-ALL-FAMILIES`,
`PER-EPOCH-GROSS-EDGE`, the `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` family,
`LOG-REGRESSION-BANDS-EQUITIES`); an explicit exclusion (`WALKFORWARD-REVALIDATION-OF-BASELINE`
deliberately drops these 5 symbols, "reserved for the eventual final validation, not spent here");
`CANDLE-CORPUS-GAP-AUDIT`'s one non-strategy inclusion (counts missing candle bars only, explicitly
disclaimed as not spending the holdout); or `EQUITIES-MADIP-OUT-OF-SAMPLE` naming this pool's
crypto-side re-validation as still-outstanding future work for its own strongest result. This
matches `MULTIPLE_COMPARISONS_AUDIT.md`'s independent 2026-08-19 statement verbatim in substance:
"no study module... has ever imported or used it."

**This is the only dataset in this audit that remains genuinely unspent.** What it could still
validate: per `AGENT_PROTOCOL.md`'s binding rule, it is reserved specifically as the one-time final
re-validation for a candidate that has already cleared its own normal train/holdout economic gate —
using it earlier, or for anything short of that, would spend the project's one remaining fresh look
for a lesser purpose than it was reserved for.

### Two other resources noted, not counted as new datasets

- **`walkForwardSeriesWindows`** (built 2026-08-14, `researchlib.mjs`) — a different *lens* (4
  rolling folds) on the already-spent Dataset 1 calendar data, used once
  (`WALKFORWARD-REVALIDATION-OF-BASELINE`, 2026-08-22). Not fresh data; not counted separately.
- **DJIA-30 at a 50/50 split** (`MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC`, 2026-08-27) — a
  second partition of Dataset 2's same underlying candles, already included in Dataset 2's count
  above, not a sixth dataset.

### Summary table

| dataset | studies (by >1 criterion) | spent? | first use | most recent use |
|---|---:|---|---|---|
| Crypto calendar 70/30 | 14 (this audit) / ~27 (MULTIPLE_COMPARISONS_AUDIT.md, per-family-gate count) | yes, long since | 2026-07-30 | 2026-08-27 |
| DJIA-30 equity holdout | 11 | yes | 2026-08-19 | 2026-08-28 |
| DJTA-20 out-of-sample universe | 2 | yes, barely | 2026-08-22 | 2026-08-22 |
| Whole-symbol momentum holdout (STABLE_13 complement) | 6-9 (ambiguous PHASE3/4 draws unresolved) | yes | 2026-08-06 | 2026-08-14 |
| `SEALED_SYMBOLS` | 0 | **no — the only unspent resource** | never | never |

**No recommendation made.** This item counts; it does not decide whether any threshold, correction
family, or protocol rule should change as a result. `MULTIPLE_COMPARISONS_AUDIT.md` is
cross-referenced below as a companion measurement of a different kind of multiplicity (test-count
inflation vs. data-reuse inflation) per this item's own done_when; its own recorded p-values,
q-values, and BH-FDR ranks are untouched — nothing here recomputes a statistic. `npm.cmd test`:
513/513 green (no code, config, or test file touched — this item is documentation and counting
only, as scoped).

## PER-FAMILY-COST-CEILING — closed-form cost sensitivity for all 12 families, both markets; 7 (family, venue) cells clear +0.10R, all on thin samples (2026-08-28)

**Scoping, per this item's own note.** `COST-SENSITIVITY-SURFACE` (2026-08-22) mapped a 2-D
fee x slippage grid for `breakout`/`anticipate` only. `PER-FAMILY-COST-CEILING` was staged the same
day, DERIVED from `ZERO-COST-FLOOR-ALL-FAMILIES`'s own recorded per-family fee/slip drag figures,
to replace the grid with the closed form it implies and extend it to all 12 `tournament.mjs`
families, on both the crypto watchlist and the DJIA-30 equity holdout. Economic-gate/descriptive
study (point-estimate threshold, no p-value) — joins the economic-gate-only counter in
`AGENT_PROTOCOL.md`, not the formal-NHST family; recomputes no BH-FDR table.

**Method — exact linear identity, not a grid sample.** `backtest.js`'s net-R formula is
`netR = grossR - (feeRate+slipPct)*(entry+exitPx)/risk` — fee and slip enter through the *same*
per-trade coefficient, so a family's cost sensitivity collapses to one constant,
`k = (feeDragAvgR + slipDragAvgR) / (FEE_RATE + SLIPPAGE_PCT)` (R of drag per 1.00 of per-side
rate), giving `netAvgR(fee, slip) = grossAvgR - k*(fee+slip)` and an exact break-even all-in
per-leg cost of `grossAvgR / k` wherever gross is positive. **Two things stated explicitly, not
left implicit, per this item's own requirement:**
1. The extrapolation is exact *only* because the net-R formula is affine in `feeRate`/`slipPct`
   with a coefficient independent of both — re-verified here, not assumed: `kFromFee` (derived from
   the fee-only pass alone) and `kFromSlip` (derived from the slip-only pass alone) agree to within
   1e-10 for all 12 crypto families and for every one of the 273 (family, symbol) equity cells with
   trades, and every one of the 48 crypto (family, venue) analytic predictions matches a direct
   `backtest.js` rerun at that exact (fee, slip) point to within 1e-9.
2. Trade counts are identical across all four cost configurations (gross/fee-only/slip-only/net)
   for every one of the 12 crypto families and every one of the 30 equity symbols across all 12
   families — re-checked here (`tradeCountsMatch`), not just cited from `FEE-SCHEDULE-REBASE`.

**Crypto — 12 families x 4 real venues (Kraken spot maker/taker, Kraken derivatives maker/taker).**
Maker fills modeled at slip=0 (resting limit, no spread crossed); taker fills at `SLIPPAGE_PCT`
(current default). Derivatives cells are **upper bounds** — this backtest models no funding cost,
and Kraken perpetuals charge funding continuously.

| family | trades | gross avgR | k (R per 1.00 rate) | break-even (bps) | spot maker | spot taker | deriv maker* | deriv taker* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| anticipate | 3966 | -0.0861 | 93.89 | — (negative gross) | -0.4617 | -0.8842 | -0.1049 | -0.1800 |
| bos | 273 | -0.1282 | 91.02 | — (negative gross) | -0.4923 | -0.9019 | -0.1464 | -0.2193 |
| support | 53640 | -0.1503 | 414.58 | — (negative gross) | -1.8086 | -3.6742 | -0.2332 | -0.5648 |
| ma_dip | 9894 | 0.0877 | 615.69 | 1.42 | -2.3751 | -5.1457 | -0.0354 | -0.5280 |
| rsi | 2265 | -0.0115 | 155.11 | — (negative gross) | -0.6320 | -1.3300 | -0.0426 | -0.1667 |
| rev | 24327 | -0.1562 | 420.12 | — (negative gross) | -1.8367 | -3.7272 | -0.2402 | -0.5763 |
| breakout | 3156 | 0.0637 | 109.14 | 5.84 | -0.3728 | -0.8640 | 0.0419 | -0.0454 |
| trend_pullback | 2017 | -0.1320 | 103.83 | — (negative gross) | -0.5474 | -1.0146 | -0.1528 | -0.2359 |
| sweep_reclaim | 3145 | -0.1409 | 127.14 | — (negative gross) | -0.6495 | -1.2216 | -0.1663 | -0.2681 |
| range_sweep_reclaim | 511 | -0.0521 | 125.58 | — (negative gross) | -0.5545 | -1.1196 | -0.0772 | -0.1777 |
| h3 | 4590 | 0.0329 | 198.17 | 1.66 | -0.7598 | -1.6516 | -0.0068 | -0.1653 |
| vol_contraction | 98 | 0.2177 | 126.45 | 17.22 | -0.2881 | -0.8571 | 0.1924 | 0.0913 |

*deriv columns are funding-free upper bounds. Only one crypto cell clears +0.10R: **vol_contraction
at Kraken derivatives maker (+0.1924R)** — on 98 holdout trades, the smallest sample of any family
in this table, and the same family `VOL-CONTRACTION-SAMPLE-EXTENSION` (queued, not yet run) exists
specifically to pressure-test.

**Equity — 12 families x DJIA-30 holdout, IBKR per-symbol basis (`commissionPerShare/avgClose` per
symbol, 5bps slip default — `EQUITIES-BASELINE-PORT`'s own basis, reused verbatim). k is NOT a
single number here** — the fee rate itself varies by symbol (a $50 stock and a $400 stock pay very
different effective percentage commission), so k and its break-even bps are computed per symbol and
reported as a distribution, not collapsed to one figure.

| family | symbols w/ trades | pooled trades | gross avgR | net avgR (IBKR) | clears +0.10R | break-even bps dist (n, min/median/max) |
|---|---:|---:|---:|---:|---|---|
| anticipate | 30 | 303 | -0.0019 | -0.0438 | no | n=16, 7.2/63.8/156.7 |
| bos | 27 | 60 | 0.2035 | 0.1728 | **YES** | n=13, 10.5/208.9/646.1 |
| support | 30 | 407 | 0.1003 | 0.0014 | no | n=14, 3.5/29.5/72.4 |
| ma_dip | 30 | 475 | 0.3430 | 0.1526 | **YES** | n=23, 3.0/11.8/54.0 |
| rsi | 17 | 32 | 0.2934 | 0.2507 | **YES** | n=7, 89.2/559.1/1116.3 |
| rev | 29 | 179 | 0.0613 | -0.0501 | no | n=13, 2.6/40.4/222.6 |
| breakout | 27 | 61 | 0.2110 | 0.1866 | **YES** | n=15, 67.1/200.5/614.9 |
| trend_pullback | 24 | 38 | -0.1721 | -0.2026 | no | n=8, 9.5/225.6/682.0 |
| sweep_reclaim | 28 | 92 | 0.0761 | 0.0328 | no | n=11, 27.0/70.8/206.7 |
| range_sweep_reclaim | 3 | 3 | 1.0000 | 0.9656 | **YES** | n=2, 316.3/521.1/521.1 |
| h3 | 28 | 106 | 0.1645 | 0.1178 | **YES** | n=13, 16.2/127.9/268.4 |
| vol_contraction | 0 | 0 | 0.0000 | 0.0000 | no | n=0 (zero trades on this universe) |

`breakout`'s pooled net avgR (+0.1866R, 61 trades) reproduces `EQUITIES-BASELINE-PORT`'s own headline
figure exactly — an unplanned but reassuring cross-check that this script's cost basis matches that
prior study's, not a fresh finding.

**7 of 60 (family, venue, market) cells clear +0.10R**, listed here plainly rather than only in the
tables above: `bos`/equity (+0.1728R, 60 trades), `ma_dip`/equity (+0.1526R, 475 trades),
`rsi`/equity (+0.2507R, 32 trades), `breakout`/equity (+0.1866R, 61 trades, already known),
`range_sweep_reclaim`/equity (+0.9656R, **3 trades**), `h3`/equity (+0.1178R, 106 trades), and
`vol_contraction`/crypto-derivatives-maker (+0.1924R, 98 trades, funding-free upper bound). Six of
the seven are on the equity market alone, and every equity break-even bps distribution above shows
`min` values in the single-to-low-double digits — meaning at least one symbol in every family is
carried by very few trades at a favorable price level, not a broad, robust edge across the universe.

**Sample adequacy is explicitly OUT OF SCOPE for this study, stated here as loudly as the table
above:** clearing a cost ceiling is a necessary condition for tradability, not a sufficient one, and
this study makes no significance or sample-size claim about any of the 7 clearing cells.
`range_sweep_reclaim` clearing +0.9656R on 3 total trades from 3 symbols is not evidence of an edge
— it is a cost-model readout on a sample too small to mean anything on its own, reported plainly
rather than hidden by a headline "7 cells clear the bar" framing. `bos` (60 trades), `rsi` (32
trades), `h3` (106 trades), and `vol_contraction` (98 trades, crypto) are similarly thin — none of
them reach this project's own prior convention for an adequate sample
(`MEANINGFUL_TRADES_MIN=150` from `ZERO-COST-FLOOR-ALL-FAMILIES`). Only `ma_dip` (475 trades)
clears that floor. Applying `ZERO-COST-FLOOR-ALL-FAMILIES`'s full 3-leg gate (avgR>0.10 AND trades>=150 AND
positiveAssets/assets>=0.5, not just the avgR>0.10 leg this study's "clears +0.10R" column checks),
**only `ma_dip` (475 trades) passes the trade-count leg of the stricter gate** — every other cell
in the list above would fail that fuller gate on sample size alone, regardless of its avgR. And
`ma_dip`'s own significance test (`EQUITIES-MADIP-SIGNIFICANCE`, 2026-08-22) already found its
holdout sign-flip p-value's CI includes zero despite the point estimate being net-positive — i.e.
clearing a cost ceiling and being statistically real are two different questions, and this study's
one arguably-adequate-sample cell has already separately failed the second one. This study
therefore surfaces no case that should be read as a live promotion candidate.

**Engineering note.** New `scripts/per-family-cost-ceiling.mjs` only, additive, read-only — no
strategy code touched (`backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`,
`trader.js`, `scanner.js` untouched, grep-confirmed against the staged diff before commit). Reuses
`researchlib.mjs`'s `loadWatchlist`/`symbolToKrakenId`, `researchlab.mjs`'s
`loadResearchCandles`/`saveExperiment`, `backtest.js`'s `backtestMultiTF`, `strategy.js`'s
`FEE_RATE`/`SLIPPAGE_PCT`, and `cost-model.mjs`'s `SPOT_FEE_SCHEDULE`/`FUTURES_FEE_SCHEDULE`
unmodified. `research-cache/equities-1d/` read as cached (no egress; this item was scoped
no-egress and ran that way). `npm.cmd test`: 513/513 green (no test file added — matches this
family's own precedent for read-only research scripts under `scripts/`).

---

## MADIP-REALISED-R-CONDITION-2 — realised R is ~2.5-2.65, not `ma_dip`'s configured 5; the
win-rate margin is +3.5pp on DJIA-30 (inside its own noise) and +7.1pp on DJTA-20 (outside it) (2026-08-28)

**Scoping.** `ALPHA_DEFINITION.md` section 4b lists `ma_dip`'s condition 2 (win-rate margin) as
"not evaluated": breakeven at the configured `tpR: 5` is a 16.7% win rate, but `lockBreakeven`
and `maxHold` truncate winners, so the *real* breakeven is higher and was never computed. This
item computes it, on both equity universes `ma_dip` has been scored on, reported separately, and
decomposes realised R by exit reason. Descriptive measurement — no parameter changed, no new
p-value, not an entry in `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family.

**Definitions, pre-registered before running.** Realised R = mean(winning R) / mean(|losing R|),
win = net R > 0, loss = net R <= 0 (a breakeven-exact trade counts as a loss — it did not clear
the round-trip cost). Real breakeven win rate = 1/(1+realisedR). Margin = observed win rate minus
breakeven win rate, in percentage points. Condition 2 requires this margin pre-registered *before*
the holdout is scored — not possible retrospectively, since `ma_dip` was first scored on
2026-08-22 with no margin threshold set. Said plainly rather than inventing one after the fact:
this item instead reports a two-sided 95% Wald interval on the observed win rate and states
whether the breakeven win rate falls inside it (margin indistinguishable from the estimate's own
sampling noise) or outside it (margin exceeds that noise band) — a noise check, not a
significance test.

**Engineering note first, since it's the one code change here.** `backtest.js`'s
`excursions.push(...)` gained one additive field, `why` (the same reason already recorded into
`exits[why]`, now attached per-trade) — no existing field changed, no behavior changed, confirmed
by `totalRMatchesBacktest: true` on both universes (this script's own pooled per-trade R sum
reproduces `backtestMultiTF`'s independently-computed `totalR` to floating-point precision) and by
`npm.cmd test` staying 513/513 green. No other file in `backtest.js`/`strategy.js`/`tournament.mjs`/
`monitor.js`/`bot.js`/`trader.js`/`scanner.js` touched. Computed by `scripts/madip-realised-r-condition-2.mjs`
(additive, cache-only).

**Results reproduce the known headline figures exactly**, an unplanned cross-check that this
script's cost basis/config matches `EQUITIES-MADIP-SIGNIFICANCE`/`EQUITIES-MADIP-OUT-OF-SAMPLE`
verbatim: DJIA-30 475 trades / avgR +0.15263 (cited: +0.1526), DJTA-20 300 trades / avgR +0.29939
(cited: +0.2994).

| universe | trades | wins | losses | avgWin | avgLoss | realised R | breakeven win rate | observed win rate | margin (pp) | breakeven inside 95% Wald CI |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| DJIA-30 | 475 | 147 | 328 | 3.1433 | 1.1877 | 2.6466 | 27.42% | 30.95% | +3.52 | **yes — [26.79%, 35.10%]** |
| DJTA-20 | 300 | 107 | 193 | 3.0028 | 1.1994 | 2.5036 | 28.54% | 35.67% | +7.12 | **no — [30.25%, 41.09%]** |

Realised R lands at roughly half the configured `tpR: 5` on both universes — the win-rate margin
is real (positive) on both, but the noise check splits: on DJIA-30 the +3.52pp margin sits fully
inside the observed win rate's own 95% Wald band, i.e. not distinguishable from sampling noise at
this sample size; on DJTA-20 the +7.12pp margin sits outside it. Read together with condition 3
(§4b: `ma_dip` currently FAILS the BH-FDR leg at family size 20), this is one more condition where
the two universes disagree rather than jointly confirm.

**Exit-reason decomposition — why realised R falls short of 5, and where net R actually comes
from.** `lockBreakeven` ("trail/be" in `backtest.js`'s naming — `ma_dip`'s config sets no
`trailR`/`trailStartR`, so `trailing` never arms and `trail/be` here means the breakeven lock
specifically) accounts for a minority of trades (14.3% DJIA-30, 17.3% DJTA-20) but a
disproportionate share of net R, because full stop-outs and full target-hits are large and
land close to opposite in aggregate:

| universe | stop: trades / share of total R | target: trades / share of total R | trail/be: trades / share of total R | timeout censoring |
|---|---|---|---|---|
| DJIA-30 | 328 (69.1%) / -537.3% | 79 (16.6%) / +513.0% | 68 (14.3%) / **+124.4%** | 0% (0/475) |
| DJTA-20 | 193 (64.3%) / -257.7% | 55 (18.3%) / +293.3% | 52 (17.3%) / **+64.5%** | 0% (0/300) |

("share of total R" exceeds 100% for the stop/target legs because they nearly cancel — full
stop-outs and full 5R target-hits are both large relative to the small net total, so the
smaller breakeven-lock wins end up contributing more than the whole net result.) Two things
follow: realised R sits below 5 mainly because most winners are breakeven-lock exits (small,
positive) rather than full target hits, not because of timeout censoring — `timeoutCensoringRate`
is exactly 0 on both universes (`maxHold=100`, unmodified, never binds for this family on daily
equity bars), so `WIDE-STOP-HIGH-TARGET-ASYMMETRY`'s prior timeout-censoring concern does not
apply to `ma_dip` specifically.

**`ALPHA_DEFINITION.md` section 4b condition-2 row and its explanatory bullet updated** from "not
computed"/"not evaluated" to this result; no other row changed. **`npm.cmd test`: 513/513 green.**

## 2026-08-28 — MAKER-FILL-MICROSTRUCTURE-SIMULATION: closes as a data-availability non-verdict — historical order-book depth does not exist at any resolution on this project's accessible sources

`EXECUTION-DELAY-DECAY-CURVE` (2026-08-19) is cited across this project, including its own
section heading above, as showing the maker-execution thesis is "dead on arrival." That study
measured entry deferred by whole 1-hour bars — a latency-sensitivity measurement — not a
maker-fill simulation, and its own numbers show the collapse doesn't begin until delay 2:
`breakout` loses only -0.0207R at delay 1 (-0.8640 → -0.8847), the collapse starts at delay 2
(-1.5442R). A real post-only order rests for seconds to minutes, deep inside the first bar —
the entire economically relevant range sits below that study's resolution and had never been
measured. This item's job was to determine, first, whether that gap could actually be closed:
whether sub-bar (minute/tick/L2) history is obtainable at all for this project's watchlist,
before attempting any fill model. Per this item's own scoping (30-60 min for the
data-availability determination) and its explicit instruction — if sub-bar data cannot be
obtained, record an honest data non-verdict naming exactly what was tried and stop, rather than
substitute a coarser proxy and present it as a maker-fill result, the way `TEST4-ONCHAIN-FLOW-GATE`
should have.

**What a maker-fill simulation actually needs, stated before any probe.** Fill-vs-non-fill
probability and queue position require knowing where in the order book a resting order would
have sat and whether/when price reached it — historical order-book DEPTH over time. Partial
fills require depth at each price level as it evolves. Adverse selection on realised fills
requires knowing book state around each fill. A trade-print feed (price/size/side/time) alone
cannot supply any of these — it confirms price *touched* a level, not that a resting order
there would have filled, how much, or against what book. Historical L2 depth is the
load-bearing requirement, and every probe below was built to test for it directly rather than
assume trade prints are an adequate stand-in.

**Four probes run, `scripts/maker-fill-data-availability-check.mjs` (new, read-only, additive —
no strategy code, no fill model, no production file touched):**

1. **Kraken public OHLC, `interval=1`.** Returns 721 one-minute candles regardless of interval
   requested — roughly half a day of history, not the months-to-years a holdout window in this
   project needs. Confirms finer interval alone doesn't solve the depth-of-history problem.
2. **Kraken public Depth (order book) — historical parameter support.** A live snapshot request
   and a second request adding an undocumented `since` parameter pointing a year into the past
   were compared directly. The bogus historical parameter is silently ignored — both responses
   return the current book, timestamps seconds apart despite the year-old parameter. Kraken's
   public REST API exposes **no order-book history endpoint at any resolution** — this is not a
   depth-of-history cap like OHLC's, it is a total absence of the data type.
3. **Kraken public Trades (tick prints) — backfill feasibility.** Real trade density measured in
   a fixed historical window (2025-01-01): 1,000 trades span only ~2,166 seconds of market time,
   implying roughly 14,562 paginated requests to cover one asset for one year at that rate. This
   project's own prior attempt at exactly this kind of backfill — the order-flow study,
   2026-07-30, ROADMAP_ARCHIVE.md — needed "hours per pair" for a ~4-month window on only 3 pairs.
   Directionally feasible for a small watchlist over a short window, but not a 30-60 minute
   operation, and — the disqualifying point — even a complete backfill supplies price/size/
   side/time only, not book depth, so it cannot substitute for what probe 2 already shows is
   absent.
4. **Local repo.** No minute- or tick-level file exists anywhere under `candles/` or
   `research-cache/` — the finest cached granularity in this project is 1h (`tf-60`).
   `scripts/ibkr-tick-log.mjs`, the one tick-level tool in this codebase, is a live,
   human-attended debugging aid that connects to a locally-running IB Gateway and logs
   streaming ticks to the console for a stated number of seconds — it produces no stored
   historical dataset and cannot run unattended in this environment (no IB Gateway process
   available here).

**VERDICT: DATA NON-VERDICT.** Historical order-book depth — the load-bearing input for
fill-probability, queue-position and partial-fill modeling — is not obtainable from any source
this project has access to, at any resolution, full stop. This is independent of the trade-print
backfill feasibility question in probe 3: even a complete backfill would not resolve it. No fill
model was built. No coarser proxy (whole-bar delay, or a trade-print-only heuristic) was
substituted and presented as a maker-fill result.

**Correction applied to `EXECUTION-DELAY-DECAY-CURVE`'s "dead on arrival" claim** (see that
section above, 2026-08-19) — this item's finding that the sub-bar region is *unmeasured* rather
than closed. The deck's and this document's framing should read "maker execution fails when
tested at hourly resolution," not "the maker-execution thesis is closed" — real post-only fills
below the 1-hour bar remain untested and, per this item's findings, untestable with any source
this project holds. `scripts/gdelt-*`/other-diagnostic engineering-note convention followed: this
is a read-only diagnostic script, no `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/
`bot.js`/`trader.js`/`scanner.js` file touched. `npm.cmd test`: 513/513 green, unchanged by this
item (no test-relevant code added, per its own scope).

## 2026-08-28 — MADIP-SURVIVABILITY-CONDITION-5: `ma_dip` fails survivability decisively, on both universes, on the same drawdown shape that killed `B5-REVERSAL`

`ALPHA_DEFINITION.md` section 4b named this explicitly as "the right next step" after
`MADIP-REALISED-R-CONDITION-2` closed condition 2 the same day: "not computed" was condition 5's
status, and it is historically where this project's closest prior counterexample died —
`B5-REVERSAL` cleared a pre-registered gate at PHASE3 and was killed at PHASE4 on a -79% to -90%
max drawdown. Nothing had measured `ma_dip`'s drawdown, its expected worst losing streak, or the
capital impact of that streak, until this item.

**Pre-registration, written before any drawdown was computed** (full block in
`scripts/madip-survivability-condition-5.mjs`, new, additive, cache-only — no IBKR egress, reuses
`EQUITIES-MADIP-SIGNIFICANCE`'s / `EQUITIES-MADIP-OUT-OF-SAMPLE`'s frozen `ma_dip` config and
cost basis verbatim on both cached universes, DJIA-30 and DJTA-20, reported separately, never
pooled): fixed-fractional risk `f` at 1%/2%/5% of realised equity per trade, snapshotted at each
trade's own entry (not re-marked for other concurrently open positions — this engine models no
margin mechanic anywhere, so open positions don't reserve capital from each other; disclosed,
not hidden). Two equity curves per universe: a naive "close-order" curve (trades sorted by exit
time, applied sequentially — wrong whenever positions actually overlap) and the honest
"calendar-time" curve (event-driven over each trade's own entry/exit timestamps, correctly
letting genuinely concurrent positions coexist). Drawdown ceiling pre-registered at **25%** on
the calendar-time curve at the primary f=2% (`D/(1-D)` recovery +33.3%, per `ALPHA_DEFINITION.md`
§2's table) — set toward the conservative end of that table's named brackets given the CI's thin
lower bound and condition 3's lapse, well short of `B5-REVERSAL`'s -79%/-90% disqualifying range.
Losing-streak analysis pre-registered `P(k losses in a row)=(1-W)^k` at the realised win rate,
plus a defined "longest expected streak": the smallest k where the expected count of k-length
loss runs across the observed trade count drops below 1.

**Result — the ceiling fails by a wide margin on both universes, at every risk fraction tested:**

| universe | trades | realised W | max DD @ f=1% | @ f=2% (primary) | @ f=5% |
|---|---:|---:|---:|---:|---:|
| DJIA-30 | 475 | 30.95% | -54.2% (recover +118%) | **-81.7%** (recover +448%) | **RUIN** (equity hits 0, trade 113 of 476) |
| DJTA-20 | 300 | 35.67% | -45.3% (recover +83%) | **-74.2%** (recover +288%) | **RUIN** (equity hits 0, trade 60 of 301) |

(Realised win rates cross-check exactly against `MADIP-REALISED-R-CONDITION-2`'s own margin
figures: DJIA-30 breakeven at realised R=2.65 is 27.40%, +3.52pp margin implies W=30.92% —
measured here as 30.95%; DJTA-20 breakeven at R=2.50 is 28.57%, +7.12pp margin implies W=35.69%
— measured here as 35.67%. Independent confirmation the trade set and win-rate convention match
across both items.)

Both universes' primary-f drawdown lands **inside `B5-REVERSAL`'s own disqualifying -79%/-90%
range** — this is not a marginal miss. Even at the most conservative risk fraction tested (1%),
both universes still exceed the pre-registered ceiling by roughly 2x. At 5% risk-per-trade —
plausible for a candidate this thin, since higher risk is exactly what a marginal edge tempts —
**both universes go to ruin**: simulated equity reaches zero before the holdout ends, driven by
correlated concurrent losses (DJTA-20 is twenty transport names that can and do drop together;
DJIA-30's 30-name spread doesn't prevent it either). The close-order curve, which wrongly
serialises risk instead of respecting real overlap, is consistently *less* severe than the
calendar-time curve (e.g. DJIA-30 @ 2%: -78.4% close-order vs. **-81.7%** calendar) — confirming
the naive curve would have understated the real risk, the direction this item's own
pre-registration warned about.

**Losing streaks are large and, per the pre-registered definition, largely expected rather than
tail events:** longest observed loss streak is 18 trades (DJIA-30) and 24 (DJTA-20); the
pre-registered "longest expected" streak (smallest k where an occurrence isn't expected even
once in this sample size) is 17 and 13 respectively — close to the observed streaks, meaning
these are not freak outliers but the ordinary shape of a ~31-36% win-rate strategy over a few
hundred trades, exactly as `ALPHA_DEFINITION.md` §2 warns generically. Capital impact of the
observed streak alone, at the primary f=2%: DJIA-30 retains 69.5% of pre-streak capital (-30.5%
from that single streak); DJTA-20 retains 61.6% (-38.4%) — each streak alone would nearly
exhaust the pre-registered 25% ceiling by itself, before any other losing trade in the sample is
counted.

**A modelling artifact was caught and fixed while building this, disclosed rather than
silently corrected:** an early version of the drawdown-episode function applied an
equity-curve-style "percent of peak" formula to the additive (non-compounding) R-curve, where
the running peak can sit near zero early in the series — this produced a nonsense "-6147%"
figure from a peak of roughly 0.01R. Caught by a direct sanity check against `backtestMultiTF`'s
own raw per-trade R output (bounded in [-1.93, +4.98] across all 300 DJTA-20 trades, average
+0.2994 — reproduces `EQUITIES-MADIP-OUT-OF-SAMPLE`'s figure exactly) before this write-up was
drafted. Fixed by giving the additive R-curve its own absolute-difference unit instead of a
percent-of-peak one; the equity curves (which are always positive by construction, or clamped
at the ruin floor below) are unaffected and were not the source of the bug.

**`ALPHA_DEFINITION.md` section 4b condition-5 row updated** from "not computed"/"not evaluated"
to this FAIL, its explanatory bullet rewritten with the full finding, and the section's closing
"what's left" paragraph rewritten: `ma_dip` now fails two of the six conditions outright (3, on
family growth alone, and 5, on its own trade sequence — independent failures, not one causing
the other) on top of a marginal condition 4 and a split-by-universe condition 2. No promotion
case remains open for this candidate. Descriptive/economic-gate study: no p-value, no hypothesis
test — does **not** join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family and triggers no
BH-FDR recomputation. No `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/
`trader.js`/`scanner.js` file touched — new script only. `npm.cmd test`: 513/513 green.

## 2026-08-28 — MADIP-RANDOM-ENTRY-CONTROL: `ma_dip`'s positive expectancy does not clear a matched-geometry random-entry null on either universe

`ma_dip` is this project's only equities candidate that has ever cleared conditions 1 and 3
together (`ALPHA_DEFINITION.md` §4b). Nothing had ever asked the question this item asks: is
`+0.1526R` (DJIA-30) / `+0.2994R` (DJTA-20) attributable to the entry rule itself (buy a
≥2%-below-20-day-MA dip), or would any random long entry with the same stop-distance geometry,
5R target, breakeven lock, and hold horizon do about as well in this window — exactly the check
`LOG-REGRESSION-BANDS-CRYPTO` had to run for its own outperformance figure, where 23 of 24
assets had negative buy-and-hold before the headline number meant anything.

**Construction, pre-registered before any random return was computed** (full block in new
`scripts/madip-random-entry-control.mjs`, additive, cache-only, reuses `EQUITIES-MADIP-
SIGNIFICANCE`'s / `EQUITIES-MADIP-OUT-OF-SAMPLE`'s / `MADIP-SURVIVABILITY-CONDITION-5`'s frozen
`ma_dip` config and cost basis verbatim, same two universes/caches, DJIA-30 and DJTA-20,
reported separately): for each synthetic trade, a symbol is drawn UNIFORMLY from the universe's
active symbols (not weighted by how often the real signal fired there) and an entry index
UNIFORMLY from that symbol's own holdout candles, entry price = that candle's close (matching
`ma_dip`'s own `entry = C[k]`). Stop distance is drawn WITH REPLACEMENT from the REAL trades'
own empirical stop-distance distribution (risk/entry) — a random entry has no dip to place a
structural stop under, and using structural placement would silently turn this into a test of
stop placement instead of entry timing. Exit management replicates `backtest.js`'s own generic
lockBreakeven/target/timeout path byte-for-byte for the no-partial, no-trailing case `ma_dip`'s
config actually uses (`strategy.js`'s own BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=0.018
and `backtest.js`'s own MAX_HOLD=100, all unmodified). Sample size matched EXACTLY per universe
against a fresh `collectTrades` run (not hand-typed from prior citations): K=2000 draws per
universe, each pooling avgR across its full matched trade count, building a null distribution
of DRAW-LEVEL pooled avgR. Decision rule, pre-registered: `ma_dip`'s entry rule is credited with
adding information only if its real result exceeds the null distribution's 95th percentile —
this project's standard one-sided 5% convention — not moved after seeing the result.

**Result — real trade counts and avgR reproduce the cited figures exactly (475 trades /
+0.152634R DJIA-30, 300 trades / +0.299395R DJTA-20, both matching ROADMAP.md's citations to
four decimal places, confirming the frozen config and caches are unchanged), and `ma_dip` does
NOT clear the pre-registered bar on either universe:**

| universe | real trades | real avgR | null mean | null SD | percentile of real result | fraction of draws beating real | passes 95th-pctile bar |
|---|---:|---:|---:|---:|---:|---:|---|
| DJIA-30 | 475 | +0.1526 | +0.1493 | 0.1038 | **53rd** | 46.95% | **NO** |
| DJTA-20 | 300 | +0.2994 | +0.1637 | 0.1277 | **85th** | 14.80% | **NO** |

**The null's own mean is reported prominently, per this project's `LOG-REGRESSION-BANDS-CRYPTO`
precedent (state the window's own tailwind before any claim about the signal):** random long
entries with `ma_dip`'s exact stop/target/breakeven geometry already average strongly positive R
in this window, on both universes, before any entry-timing skill is credited — a
beta-and-payoff-structure finding (a tight structural-sized stop against a 5R target with a
breakeven lock is a favourable asymmetric bet in a broadly rising market, independent of *when*
it is entered), not evidence the ≥2%-below-20MA dip condition is doing identifiable work.
DJIA-30's real result is barely distinguishable from the geometry-matched null — an outright
coin-flip against it (53rd percentile, 47% of random draws beat it). DJTA-20 is meaningfully
closer to clearing the bar (85th percentile) but still falls short of the pre-registered
threshold. Data-edge case disclosed: 1.85% (DJIA-30) / 2.61% (DJTA-20) of simulated draws ran
past their symbol's holdout data before any exit fired and were force-closed at the last
available close rather than silently dropped — small enough not to plausibly change either
verdict, reported rather than assumed negligible.

**`ALPHA_DEFINITION.md` section 4b updated: condition 1's table row keeps its literal pass**
(`E > 0` is still true) **but is annotated pointing to this finding, and a new bullet under
"What is not established" states the result in full** — this does not flip a pass to a fail
(the condition as defined is a strict positivity check, and this is a different, harder
question: does the positivity trace to the entry rule specifically), but it materially weakens
what condition 1's pass was ever entitled to claim standing alone, and the section's closing
paragraph is updated to note it. Descriptive null-control study, not a formal-NHST test in
`MULTIPLE_COMPARISONS_AUDIT.md`'s sense (the "null" is a resampling control against matched risk
geometry, not a p-value against a theoretical distribution under a sign-flip/permutation
scheme) — does **not** join that family and triggers no BH-FDR recomputation. No
`backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/`scanner.js` file
touched — new script only (`backtest.js`'s exit-management logic was read and replicated, not
imported or modified, since the random-entry candidate path has no natural hook into
`backtestMultiTF`'s own signal-detection branches). `npm.cmd test`: 513/513 green.

## 2026-08-28 — REQUIRED-SAMPLE-FOR-DURABLE-PASS: no evidence of a finite, reachable family size at which BH-FDR correction alone makes `ma_dip`'s effect size unrecoverable — the real threat to durability was never family growth, it is any future test landing more significant than p=0.0116

**This is a planning calculation, not a verdict and not a rescue attempt for `ma_dip`.**
`ALPHA_DEFINITION.md` condition 4 asks every candidate to report the sample its claim needs
alongside the sample it has — a question this project has only ever answered once before,
roughly, for `breakout`. `ma_dip` is the worked example here purely because it is the only
candidate with a real, recorded effect size and CI to derive from, not because the goal is to
save it — by the time this item ran, `ma_dip` had already separately failed conditions 3 and 5
outright (`MADIP-SURVIVABILITY-CONDITION-5`, `MADIP-RANDOM-ENTRY-CONTROL`, both 2026-08-28) and
`ALPHA_DEFINITION.md` section 4b already treats it as closed on those grounds alone. Nothing
below reopens that. As pre-registered in this item's own note, this does **not** propose
narrowing, splitting, or re-scoping `MULTIPLE_COMPARISONS_AUDIT.md`'s correction family — that
move is precisely the failure mode the audit exists to prevent, and the temptation to make it is
strongest right when a candidate is falling out, which is exactly the situation ma_dip is now in
for an unrelated reason. New `scripts/required-sample-for-durable-pass.mjs` (additive,
cache-only, no candle data, no egress — pure arithmetic on already-recorded numbers).

**Step 1 — derive the per-trade SD, shown rather than asserted.** Source:
`EQUITIES-MADIP-OUT-OF-SAMPLE` (DJTA-20), mean R = +0.2994, 95% block-bootstrap CI
[+0.0509, +0.5350], n = 300 holdout trades, one-sided permutation p = 0.0116 (all verified
against `ALPHA_DEFINITION.md` section 4b and `MULTIPLE_COMPARISONS_AUDIT.md`'s ranked table
before any calculation ran). Treating the CI half-width as `1.96 * SE` under a normal
approximation: lower half-width 0.2485, upper half-width 0.2356, average 0.24205 → SE = 0.12349
→ per-trade SD = SE·√300 = **2.1390R**. Effect size d = mean/SD = **0.1400** — small, which is
exactly why hundreds of trades were needed to see this at all.

**Step 2 — calibrate required-N off the empirically observed p, not off the SD-implied normal
approximation.** The SD above implies a normal-theory z of 2.4244, but the actual one-sided
permutation p (0.0116) implies z = 2.2701 — the two differ, as expected, because a
block-bootstrap permutation p is not exactly normal (fatter tails, autocorrelation, no claim
here that it should match). Rather than force the mismatch, required-N below is computed by
scaling **directly off the observed z = 2.2701 at n = 300**, using the standard CLT result that
a test statistic scales as `sqrt(N)` at fixed effect size — this only assumes the permutation
p's sampling behavior scales the way any CLT-governed statistic does, not that it is exactly
normal. `N_req(rank, m) = 300 * (z_req / 2.2701)^2`, where `z_req = Φ⁻¹(1 - rank·q/m)` and
`q = 0.05`.

**Step 3 — required N by rank and family size, task-requested sizes (current family size is
m=20, ma_dip rank 4, per `MULTIPLE_COMPARISONS_AUDIT.md`):**

| rank \ family size | 19 | 25 | 30 | 40 |
|---|---:|---:|---:|---:|
| 1 (best plausible) | 454 | 483 | 502 | 533 |
| 2 | 381 | 410 | 429 | 459 |
| 3 | 340 | 368 | 387 | 417 |
| **4 (current observed rank)** | **310** | **338** | **357** | **387** |
| 5 | 288 | 316 | 334 | 364 |

At rank 4, m=19, required N is 310 against an actual 300 — matching `ALPHA_DEFINITION.md`'s own
finding that condition 3 flipped to FAIL right around n=18–19 by a very small margin. This
table's own numbers reproduce that near-miss rather than contradicting it, which is the main
internal-consistency check for this method.

**Step 4 — the ceiling probe: does required N diverge as the family grows without bound, holding
rank fixed near the top (the hardest realistic case — a candidate that stays among the handful
most significant no matter how large the family gets)?**

| family size | required p | required N |
|---:|---:|---:|
| 20 | 2.5e-3 | 459 |
| 50 | 1.0e-3 | 556 |
| 100 | 5.0e-4 | 631 |
| 1,000 | 5.0e-5 | 882 |
| 10,000 | 5.0e-6 | 1,136 |
| 100,000 | 5.0e-7 | 1,393 |

**No, it does not diverge, and there is no finite reachable family size at which BH-FDR
correction alone makes this effect size unrecoverable.** Required N grows only as
`O(sqrt(log m))` — this is the whole point of BH-FDR over a flat Bonferroni correction, and rank
1 at any family size is the Bonferroni-equivalent worst case, so this bound applies to every
gentler rank too. Going from the current family size (20) to a family **5,000 times larger**
(100,000 — far beyond anything this project could plausibly run) only triples the required
sample, from 459 to 1,393. That number is answerable with a moderately larger universe or
longer holdout window (Step 6 below); it was never going to be unreachable on arithmetic grounds
alone. **The honest answer to "does the ceiling exist" is: not from family-size growth. Report
this plainly as the finding, not as a reason to relax vigilance about the family size still
growing — see Step 5.**

**Step 5 — rank sensitivity at the CURRENT family size (m=20), which is the actually
informative comparison:**

| rank | required p | required N |
|---:|---:|---:|
| 4 (current) | 0.01000 | 316 |
| 8 | 0.02000 | 246 |
| 12 | 0.03000 | 206 |
| 16 | 0.04000 | 179 |
| 19 | 0.04750 | 163 |

Required N falls as rank worsens at fixed family size — this is correct BH-FDR arithmetic (the
per-rank threshold is deliberately more lenient further down the ranking, which is what bounds
the expected false-discovery proportion regardless of rank) and it must not be misread as "a
worse rank is safer." It isn't a lever `ma_dip` or any candidate controls: rank only worsens when
some *other* study reports a smaller p-value, an event this arithmetic does not predict and
sample size cannot buy. **This is the actual mechanism that has already moved `ma_dip` from
survivor to non-survivor once (`ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` and
`WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC` both landed near the bottom of the ranking and grew
the denominator without changing ma_dip's rank; a future study landing *above* it, at p<0.0116,
would instead grow ma_dip's rank number directly).** Family size alone is a slow, bounded drag
(Step 4); a single more-significant competing result is a one-step, unbounded-in-principle push
in the wrong direction. The two are often conflated in casual readings of "the family keeps
growing" — they are not the same threat, and this item's own numbers are the demonstration.

**Step 6 — are the required trade counts (roughly 300–1,400 across every scenario above)
reachable on the equity universes this project has access to?** From the two already-spent
holdouts: `DJIA-30` (475 trades / 30 symbols over the 2026-01-14→2026-08-19 holdout, 0.5945
years) = **26.63 trades/symbol/year**; `DJTA-20` (300 trades / 20 symbols, same window) =
**25.23 trades/symbol/year** — consistent across universes. At that rate, reaching even the
upper end of Step 4's range (1,393 trades) from a DJIA-30-sized (30-symbol) universe would need
roughly **1,393 / 30 / 26.6 ≈ 1.75 years of holdout** — under three times the current holdout
span. This project's currently *cached* equity history is exactly 2024-08-20 → 2026-08-19 (501
daily bars, verified directly from `research-cache/equities-1d/AAPL.json`, not asserted) — a
fixed 2-year window, of which the current holdout is already the back ~7 months. Extending the
holdout that far would require either (a) a longer daily-bar pull than this project has ever
fetched from IBKR — untested and unverified by this item, which is cache-only with no egress, so
this is named as an open question, not answered — or (b) a larger point-in-time universe (more
symbols) within the same cached window. **Neither option is free**: both `DJIA-30` and `DJTA-20`
are independently flagged "spent" in this document's own dataset-reuse audit (more than one
study has already scored each), so re-running either on the same cache reopens exactly the
data-reuse concern that audit exists to track, and a larger universe raises the trade-overlap/
independence question `CROSS-FAMILY-TRADE-OVERLAP-AUDIT` (queued separately) is built to
measure. **The required sample sizes here are arithmetically modest and plausibly reachable in
principle; whether this project should actually spend a fresh dataset reaching them is a
separate, human-scale judgment this item does not make.**

**Engineering note.** New `scripts/required-sample-for-durable-pass.mjs` only, additive,
cache-only, no egress, computes no new p-value, tests no hypothesis, and does not join
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family. No `backtest.js`/`strategy.js`/
`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/`scanner.js` file touched. `npm.cmd test`:
513/513 green.

## 2026-08-28 — CROSS-FAMILY-TRADE-OVERLAP-AUDIT: the 12 families are not 12 independent bets on crypto, but the equity-side breadth finding (corrected to 8-of-12, see the note added above) survives — `ma_dip` is not a near-duplicate of any other net-positive equity family

`EQUITIES-ALL-FAMILIES-BASELINE` (2026-08-22) found several `tournament.mjs` families
net-positive on the DJIA-30 equity holdout and called it breadth. `HOLDOUT-REUSE-AUDIT` and
`REQUIRED-SAMPLE-FOR-DURABLE-PASS` (both 2026-08-28) both name the same open question this item
was queued to close: how many of the twelve families are actually independent bets, versus the
same underlying signal re-detected under different names? `ma_dip` carries this project's only
surviving positive result at real sample size and its independence from the other equity-positive
families had never been measured. This item measures trade-set overlap directly. **No family was
re-run, no parameter was re-tuned, and no new avgR was produced** — every family x market
combination below reproduces an already-published trades/avgR figure bit-for-bit before its
trade-level detail is used (see Replication check below); this is the same-cited-figures pattern
`EQUITIES-ALL-FAMILIES-BASELINE` and `EQUITIES-MADIP-OUT-OF-SAMPLE` both used against their own
predecessors.

**Pre-registered before any overlap number was computed** (full text in
`scripts/cross-family-trade-overlap-audit.mjs`'s header, same commit as these results).
**Window:** two trades "overlap" if they share the same symbol/pair AND the same calendar day
(UTC) of entry — one window, applied identically to daily-bar equities (DJIA-30, DJTA-20) and
hourly-entry crypto, for cross-market consistency, at the disclosed cost of being coarser
relative to bar granularity on the crypto side. **Metric:** for family pair (A, B),
`matchedFromA` = count of A's trades with at least one B trade in the same (symbol, day) bucket;
the matrix cell reported is the symmetric coefficient `(matchedFromA + matchedFromB) / (|A| +
|B|)`, both directional fractions available alongside it so asymmetry from unequal sample sizes
is never hidden inside an average. **Clustering threshold:** families join one cluster when
their symmetric coefficient >= **0.50** (single-linkage / union-find); a market's
"effectively independent family count" is its number of connected components. Neither the window
nor the threshold changed after seeing the matrices below.

**Data completeness caveat, disclosed rather than silently absorbed.** `backtest.js`'s
per-trade `excursions` array only attaches an `entryTime` to trades closed through the general
per-bar close path; two `entryMode: "anticipate"`-only same-bar-stop-out paths (immediate stop
on the entry bar, and the `entryDelayBars` fill-then-immediate-stop path) push a trade record
with no `entryTime`. Those trades cannot be placed in a (symbol, day) bucket and are excluded
from overlap matching (not from the trade totals used in the replication check below). Only
`anticipate` is affected, on all three markets: DJIA-30 41/303 trades (13.5%) excluded, DJTA-20
40/188 (21.3%), crypto 226/3,966 (5.7%). Every other family has zero missing `entryTime`
anywhere. `anticipate`'s overlap fractions below are therefore computed on 86.5%/78.7%/94.3% of
its published trade count respectively — a real but modest completeness gap, not treated as
material to any conclusion below because `anticipate` nets negative on both DJIA-30 and crypto
and is not part of the equity independence claim this item's `done_when` is scoped to.

**Replication check — every family/market combination reproduces its already-published
trades/avgR bit-for-bit before its trade-level detail is trusted.** DJIA-30 (all 12 families,
`EQUITIES-ALL-FAMILIES-BASELINE`'s table), DJTA-20 (`breakout`/`anticipate`/`ma_dip`, the only
three families ever run on that universe — `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` and
`EQUITIES-MADIP-OUT-OF-SAMPLE`), and crypto (all 12 families, `ZERO-COST-FLOOR-ALL-FAMILIES`'s
"net (default)" column) — **all 36 checks passed** (exact trade-count match, avgR within
5e-4). Nothing here re-derives a figure this project didn't already have on record.

**Result 1 — DJIA-30, all 12 families, full pairwise symmetric-overlap matrix:**

| family | `ma_dip` | `rsi` | `bos` | `breakout` | `h3` | `range_sweep_reclaim` | `support` | `sweep_reclaim` | `rev` | `anticipate` | `trend_pullback` | `vol_contraction` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ma_dip` | — | 0.0592 | 0.0000 | 0.0000 | 0.0379 | 0.0042 | 0.1973 | 0.0882 | 0.1223 | 0.1791 | 0.0000 | 0.0000 |
| `rsi` | 0.0592 | — | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0323 | 0.0000 | 0.1361 | 0.0000 | 0.0000 |
| `bos` | 0.0000 | 0.0000 | — | 0.0000 | 0.0120 | 0.0000 | 0.0343 | 0.0000 | 0.0251 | 0.1553 | 0.1224 | 0.0000 |
| `breakout` | 0.0000 | 0.0000 | 0.0000 | — | 0.0240 | 0.0000 | 0.0214 | 0.0000 | 0.0167 | 0.0000 | 0.0000 | 0.0000 |
| `h3` | 0.0379 | 0.0000 | 0.0120 | 0.0240 | — | 0.0000 | 0.0702 | 0.0101 | 0.1895 | 0.0761 | 0.0278 | 0.0000 |
| `range_sweep_reclaim` | 0.0042 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | — | 0.0000 | 0.0421 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| `support` | 0.1973 | 0.0000 | 0.0343 | 0.0214 | 0.0702 | 0.0000 | — | 0.0762 | **0.5154** | 0.1465 | 0.0315 | 0.0000 |
| `sweep_reclaim` | 0.0882 | 0.0323 | 0.0000 | 0.0000 | 0.0101 | 0.0421 | 0.0762 | — | 0.0590 | 0.0000 | 0.0308 | 0.0000 |
| `rev` | 0.1223 | 0.0000 | 0.0251 | 0.0167 | 0.1895 | 0.0000 | **0.5154** | 0.0590 | — | 0.0907 | 0.0553 | 0.0000 |
| `anticipate` | 0.1791 | 0.1361 | 0.1553 | 0.0000 | 0.0761 | 0.0000 | 0.1465 | 0.0000 | 0.0907 | — | 0.0600 | 0.0000 |
| `trend_pullback` | 0.0000 | 0.0000 | 0.1224 | 0.0000 | 0.0278 | 0.0000 | 0.0315 | 0.0308 | 0.0553 | 0.0600 | — | 0.0000 |
| `vol_contraction` | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | — |

Exactly one pair clears the 0.50 threshold: `support`/`rev` (0.5154). **Effectively independent
family count on DJIA-30: 11 of 12** (`support` and `rev` merge into one cluster; every other
family is its own singleton). `rev` nets negative (-0.0501) — it does not affect the net-positive
breadth count below, only the all-12 independence count.

**Result 2 — the corrected 8-of-12 DJIA-30 breadth finding, checked directly.** Net-positive
DJIA-30 families, corrected per the note added to `EQUITIES-ALL-FAMILIES-BASELINE` above: `ma_dip`,
`rsi`, `bos`, `breakout`, `h3`, `range_sweep_reclaim`, `support`, `sweep_reclaim` — 8 families.
None of the 28 pairs among these 8 reaches the 0.50 threshold (the highest is `ma_dip`/`support`
at 0.1973). **Every one of the 8 lands in its own singleton cluster — 8 effectively independent
net-positive families, matching the raw count exactly.** Stated as prominently as the finding
requires either way: **the corrected 8-of-12 breadth finding SURVIVES this overlap check.** It
was never a count of near-duplicates; it is 8 families each hitting a different (symbol, day)
footprint on this universe. (`range_sweep_reclaim`'s row should still be read with
`EQUITIES-ALL-FAMILIES-BASELINE`'s own caveat: 3 trades is not a sample large enough for any
overlap fraction computed on it to mean much.)

**Result 3 — `ma_dip` vs. every other net-positive equity family, both universes, reported
explicitly (this item's own required check):**

| universe | peer family | peer net avgR | symmetric overlap |
|---|---|---:|---:|
| DJIA-30 | `support` | +0.0014 | 0.1973 |
| DJIA-30 | `anticipate`\* | -0.0438 | 0.1791 |
| DJIA-30 | `sweep_reclaim` | +0.0328 | 0.0882 |
| DJIA-30 | `rsi` | +0.2507 | 0.0592 |
| DJIA-30 | `h3` | +0.1178 | 0.0379 |
| DJIA-30 | `range_sweep_reclaim` | +0.9656 | 0.0042 |
| DJIA-30 | `bos` | +0.1728 | 0.0000 |
| DJIA-30 | `breakout` | +0.1866 | 0.0000 |
| DJTA-20 | `anticipate` | +0.1619 | 0.0982 |

\* `anticipate` is included in this table for completeness even though it nets negative on
DJIA-30 (-0.0438) — listed to show the full row of `ma_dip`'s overlap against every family this
item computed, not selectively. It is not counted toward the "net-positive" breadth claims
above or below. DJTA-20's own net-positive set besides `ma_dip` itself is `anticipate` alone
(`breakout` nets -0.0854 there); `ma_dip` vs `anticipate` overlap is 0.0982 on that universe too.
**`ma_dip`'s highest overlap with any other net-positive equity family, on either universe, is
0.1973 (`support`, DJIA-30) — nowhere close to the 0.50 threshold.** `ma_dip` is not a
near-duplicate of any other equity family this project has found positive.

**Result 4 — DJTA-20, the only 3 families ever run on this universe:**

| family | `breakout` | `anticipate` | `ma_dip` |
|---|---:|---:|---:|
| `breakout` | — | 0.0000 | 0.0000 |
| `anticipate` | 0.0000 | — | 0.0982 |
| `ma_dip` | 0.0000 | 0.0982 | — |

All three pairs are far below 0.50. **Effectively independent family count on DJTA-20: 3 of 3**
(the only universe where this is a full census, not a breadth measurement — every family this
project has ever run on DJTA-20 is independent of the other two).

**Result 5 — crypto, all 12 families, full watchlist. This is the one market where the
independence picture looks nothing like equities.**

| family | `ma_dip` | `vol_contraction` | `breakout` | `h3` | `rsi` | `range_sweep_reclaim` | `anticipate` | `bos` | `trend_pullback` | `sweep_reclaim` | `support` | `rev` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ma_dip` | — | 0.0034 | 0.2061 | 0.3414 | **0.5810** | 0.1264 | **0.6416** | 0.0458 | 0.1595 | **0.6404** | **0.5355** | 0.4274 |
| `vol_contraction` | 0.0034 | — | 0.0206 | 0.0230 | 0.0042 | 0.0066 | 0.0031 | 0.0000 | 0.0312 | 0.0059 | 0.0128 | 0.0186 |
| `breakout` | 0.2061 | 0.0206 | — | 0.4393 | 0.1074 | 0.0747 | 0.3144 | 0.0455 | 0.2960 | 0.2374 | 0.4008 | 0.4177 |
| `h3` | 0.3414 | 0.0230 | 0.4393 | — | 0.1524 | 0.0898 | 0.4041 | 0.0629 | 0.3793 | 0.3458 | 0.4766 | **0.6076** |
| `rsi` | **0.5810** | 0.0042 | 0.1074 | 0.1524 | — | 0.1322 | 0.4210 | 0.0288 | 0.0322 | 0.4333 | 0.2540 | 0.1683 |
| `range_sweep_reclaim` | 0.1264 | 0.0066 | 0.0747 | 0.0898 | 0.1322 | — | 0.1416 | 0.0281 | 0.0981 | 0.2861 | 0.0783 | 0.0659 |
| `anticipate` | **0.6416** | 0.0031 | 0.3144 | 0.4041 | 0.4210 | 0.1416 | — | 0.0952 | 0.2847 | **0.5741** | 0.4013 | 0.3505 |
| `bos` | 0.0458 | 0.0000 | 0.0455 | 0.0629 | 0.0288 | 0.0281 | 0.0952 | — | 0.0934 | 0.0688 | 0.0401 | 0.0515 |
| `trend_pullback` | 0.1595 | 0.0312 | 0.2960 | 0.3793 | 0.0322 | 0.0981 | 0.2847 | 0.0934 | — | 0.2695 | 0.2618 | 0.3445 |
| `sweep_reclaim` | **0.6404** | 0.0059 | 0.2374 | 0.3458 | 0.4333 | 0.2861 | **0.5741** | 0.0688 | 0.2695 | — | 0.3821 | 0.3343 |
| `support` | **0.5355** | 0.0128 | 0.4008 | 0.4766 | 0.2540 | 0.0783 | 0.4013 | 0.0401 | 0.2618 | 0.3821 | — | **0.8195** |
| `rev` | 0.4274 | 0.0186 | 0.4177 | 0.6076 | 0.1683 | 0.0659 | 0.3505 | 0.0515 | 0.3445 | 0.3343 | **0.8195** | — |

Six pairs clear 0.50: `ma_dip`/`rsi` (0.5810), `ma_dip`/`anticipate` (0.6416),
`ma_dip`/`sweep_reclaim` (0.6404), `ma_dip`/`support` (0.5355), `h3`/`rev` (0.6076),
`anticipate`/`sweep_reclaim` (0.5741), `support`/`rev` (0.8195, the single highest cell in any
market). Single-linkage chains these into one seven-family cluster: **`{ma_dip, h3, rsi,
anticipate, sweep_reclaim, support, rev}`.** Five families stand alone: `vol_contraction`,
`breakout`, `range_sweep_reclaim`, `bos`, `trend_pullback`. **Effectively independent family
count on crypto: 6, not 12** — under half the roster. This is consistent with (not proof of, since
single-linkage chains transitively — `ma_dip`/`rev`'s own direct cell is only 0.4274, below
threshold, and the two are joined only via `support`) the picture `ZERO-COST-FLOOR-ALL-FAMILIES`
already painted of crypto's twelve families sharing one underlying price-structure signal
detected under different names, all of it already net-negative there regardless of overlap.

**What this does and does not license.** No family is re-run, no parameter is re-tuned, no new
avgR is produced anywhere in this item, exactly as `done_when` requires. This is a set-overlap
measurement on trade sets whose avgR figures were already on record before this item started.
The corrected 8-of-12 DJIA-30 breadth finding survives on its own terms (Result 2); `ma_dip`'s
independence from every other net-positive equity family, the specific question this item was
queued to answer, is confirmed on both universes it has been run on (Result 3). Crypto's
independence picture is materially different and is reported because the same method was applied
there per `done_when`'s "on both equity universes and on crypto, reported separately" — but no
`VERDICTS.md` row changes as a result: every crypto family in that seven-member cluster is
already net-negative (`ZERO-COST-FLOOR-ALL-FAMILIES`), so collapsing "12 negative families" into
"6 effectively independent negative families" does not change which families are alive, only how
many independent negative results there are on record. **Human-facing deck flag:** no deck file
exists inside this repository to edit directly (searched, none found) — if slide 09 of the
external deck cites `EQUITIES-ALL-FAMILIES-BASELINE`'s "10 of 12" figure, it needs the same
correction made above (8 of 12), and that correction is out of this item's reach to make itself.

**Engineering note.** New `scripts/cross-family-trade-overlap-audit.mjs` only (additive,
read-only, cache-only — crypto reads `research-cache/`'s existing candle store via
`loadResearchCandles`, equities read the existing `research-cache/equities-1d/` and
`research-cache/equities-1d-djta-oos/` caches, no network egress anywhere). `backtest.js`,
`strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all
untouched; grep-confirmed against the actual staged diff before commit that no protected
trading-safety identifier appears in it. This item computes no p-value and tests no hypothesis,
so it does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family and that document is
not updated. `npm.cmd test`: 513/513 green (no production code changed, so no new tests were
required or added, matching this project's convention for prior read-only diagnostic scripts).

## 2026-08-28 — VOL-CONTRACTION-SAMPLE-EXTENSION: the 15m-entry holdout axis clears the pre-registered gate (256 trades, +0.2524R gross) — the full-history axis does not, and PROVISIONAL applies

`T2-VOLCONTRACTION` (2026-08-07) killed `vol_contraction` on 98 holdout trades (net avgR
-0.322). `ZERO-COST-FLOOR-ALL-FAMILIES` (2026-08-22) later found this same family's GROSS
(zero-cost) holdout edge on those same 98 trades is +0.2177R — the largest gross edge of any
of the 12 `tournament.mjs` families — and `PER-FAMILY-COST-CEILING` (2026-08-22) found its
break-even all-in per-leg cost is 17.22bps, roughly 3x `breakout`'s, with one cell
(Kraken derivatives maker) already clearing +0.10R at +0.1924R on that same 98-trade sample.
Sample size was the one thing neither prior study could fix. This item, queued by both of
them, asks whether the gross edge survives a larger sample — through axes that do not touch
the frozen config (`entryMode: "vol_contraction", trendGate: false, alignMode: "none",
minStopPct: .01, maxStopPct: .06, tpR: 3, lockBreakeven: true`, copied verbatim from
`tournament.mjs`): full local candle history (train+holdout combined, not holdout alone),
today's full watchlist (28/29 locally-cached symbols pass the `>=250`-candle-per-TF filter;
`EOS` fails on 1d-candle count — 160 bars), and a lower entry timeframe (15m, one step below
the 1h floor every other study in this codebase has used). New script only:
`scripts/vol-contraction-sample-extension.mjs` (additive, read-only, cache-only, no network
egress — `candles/` local minute data resampled via the existing `loadResearchCandles`).

**BASELINE (reproduction check, today's data, same method as the two prior studies):** 98
trades, gross avgR **0.21772615708553442** — reproduces `ZERO-COST-FLOOR-ALL-FAMILIES`'s
recorded +0.2177 to 10 decimal places. 28 assets considered (of 29 locally cached), 21 traded,
11 net-positive. This anchors that every axis below varies exactly one thing at a time from an
already-verified starting point.

**AXIS A — full local candle history (train+holdout combined), entryTf 1h:** 265 trades, gross
avgR **0.0147** (95% CI [-0.1646, 0.1940]) — collapses toward zero. This axis is explicitly
**NOT out-of-sample**: it deliberately reuses bars from `T2-VOLCONTRACTION`'s own train segment
(already reported net avgR -0.638, the worse of its two reported halves), so this is a
diagnostic sample-size read, not fresh evidence. That the combined figure crashes when train
bars are included, rather than staying near the holdout's own +0.2177, is itself informative:
the 98-trade holdout estimate was not a stable mid-point of a real edge, it was the better half
of a noisy split.

**AXIS C — lower entry timeframe (15m), holdout only (identical time window and 0.70 split to
BASELINE):** 256 trades, gross avgR **0.2524** (95% CI [0.0620, 0.4427]), win rate 42.6%, 26/28
assets traded, 17/26 net-positive (65.4%). This is the ONLY extension axis that stays fully
out-of-sample — no train bars are mixed in, only the entry timeframe changes, an axis this
item's own pre-registration explicitly named as legitimate ("a lower entry timeframe if
`candles/` supports one"). **This clears all three legs of the pre-registered gate at once:
avgR 0.2524 > 0.10, trades 256 >= 150, positiveAssets/assets 0.654 >= 0.50** — the same fuller
3-leg gate `T2-VOLCONTRACTION`/`ZERO-COST-FLOOR-ALL-FAMILIES` both used, not just the
avgR-only leg `PER-FAMILY-COST-CEILING`'s own clear satisfied.

**COMBINED — every legitimate axis stacked (full history + 15m entry + today's full
watchlist):** 895 trades, gross avgR **0.0985** (95% CI [0.0006, 0.1964]) — just under the
+0.10 bar, and clearly so: the CI's lower edge sits at essentially zero. This is the single
largest sample this item can produce without touching the frozen config, and it fails the
avgR leg (barely) precisely because it dilutes AXIS C's genuine out-of-sample edge with AXIS
A's weaker train-period bars. Reported for completeness (it is the "biggest n" figure a less
careful read might reach for) but it is explicitly **not** the headline result — gating on it
instead of AXIS C would be exactly the kind of "pick the axis with the most trades" post-hoc
selection this project's own research-honesty discipline exists to prevent, when the
principled criterion (stay out-of-sample) is available and points to a different axis.

**"Full watchlist" axis, reading note:** the original 2026-08-07 run reported "28 assets
passing the filter / 21 traded"; today, 28/29 locally-cached symbols pass the same filter
against the full series (candle history has grown since). There is no known-excluded symbol
left to add back deliberately, and the original run's specific 21-symbol identity was never
recorded, so it can't be reproduced and diffed exactly — this axis's contribution is therefore
captured directly in BASELINE/AXIS C themselves (both already use today's full watchlist),
not as a fourth separate backtest pass.

**Net avgR at each real venue, computed on AXIS C (the axis that actually cleared the gate) —
derivatives cells are UPPER BOUNDS, this backtest models no funding cost:**

| Venue | Net avgR | Trades | Note |
|---|---:|---:|---|
| Kraken spot maker | -0.3342 | 256 | |
| Kraken spot taker | -0.9941 | 256 | |
| Kraken derivatives maker | **+0.2231** | 256 | funding-free upper bound |
| Kraken derivatives taker | **+0.1057** | 256 | funding-free upper bound |

Both derivatives cells stay positive net of the modeled fee+slip, corroborating
`PER-FAMILY-COST-CEILING`'s own +0.1924R Kraken-derivatives-maker figure (98 trades, 1h entry)
in the same direction on a larger, independently-constructed (15m entry, holdout-only) sample
— two different axes of extension pointing the same way, not the same number reproduced twice.
Both spot cells stay deeply negative: `vol_contraction`'s k (cost sensitivity from its tight
stops) is large enough that even the maker rate alone erases the gross edge and then some.

**PROVISIONAL, not a live candidate — `AGENT_PROTOCOL.md`'s own rule applies for the first
time at its fuller form.** `PER-FAMILY-COST-CEILING`'s earlier +0.1924R clear did NOT trigger
`AGENT_PROTOCOL.md`'s "new economic-gate result that clears its literal pre-registered
threshold" / `SEALED_SYMBOLS` re-run rule, by that rule's own stated reasoning: it cleared only
the narrower avgR-only leg (98 trades, short of the 150-trade leg), not the fuller 3-leg gate
the rule is written against. AXIS C clears the fuller 3-leg gate outright — the first result in
this project's history to do so. Per `AGENT_PROTOCOL.md`'s rule, this is **provisional, not a
live candidate for the D3 human gate, until re-run against `researchlib.mjs`'s `SEALED_SYMBOLS`
pool** (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI`) — the one holdout resource in this project
confirmed never yet examined by any study (`MULTIPLE_COMPARISONS_AUDIT.md` §4,
`HOLDOUT-REUSE-AUDIT`). **This item deliberately does not perform that re-run, and does not
build a funding-cost model for the two positive derivatives cells above — both are named
explicitly, in this item's own pre-registered done_when, as required before any promotion and
as out of this item's own scope.** A new work_queue item is staged for both (see
`.agent_state.json`), rather than doing either here as an unplanned scope-add mid-item.

**`VERDICTS.md` is not touched.** `T2-VOLCONTRACTION`'s row reports its own 98-trade,
1h-entry, holdout-only sample correctly and is not being corrected — nothing here contradicts
that number (AXIS A, the closest like-for-like comparison, also regresses toward it once train
bars are mixed in). This item's finding is additive: a different, larger, genuinely
out-of-sample axis (15m entry) that the original study never tried produces a materially
different, gate-clearing result. Per this item's own done_when, a regression below +0.10R
would have required annotating `T2-VOLCONTRACTION`'s row as "confirmed on a larger sample" —
that branch does not apply here, since the true out-of-sample axis held.

**Multiple comparisons.** Economic-gate-only (point-estimate/trade-count thresholds, no
p-value, no null distribution) — joins that bucket in `MULTIPLE_COMPARISONS_AUDIT.md`, updated
in this commit.

**Engineering note.** New `scripts/vol-contraction-sample-extension.mjs` only (additive,
read-only, cache-only, no network egress). `backtest.js`, `strategy.js`, `tournament.mjs`,
`monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched; grep-confirmed against the
actual staged diff before commit that no protected trading-safety identifier appears in it.
`npm.cmd test`: 513/513 green (no production code changed, so no new tests were required or
added, matching this project's convention for prior read-only diagnostic scripts).

## 2026-08-28 — BOS-SHORT-EQUITIES-BASELINE: the first empirical look at the short side is deeply net-negative, before any borrow cost — long-only bias is not just a coverage gap, direction matters

> **Note added 2026-08-29 (`EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`):** this entry's own header
> reads the long-positive (+0.1838R)/short-negative (-0.4086R) asymmetry as evidence that
> "direction matters." That item built a matched-geometry random-SHORT-entry null for this
> exact config (188 real trades against a K=2000 null using this population's own empirical
> stop-distance distribution) and found the real -0.4086R sits at the **14.6th percentile** of
> a null with mean **-0.2857R** — well inside the range a random short with this stop/target
> geometry already produces in a rising-index window (a mechanical headwind for any short,
> independent of entry timing), and does not clear the pre-registered mirrored bar (below the
> null's 5th percentile, -0.4750R) required to call it distinguishable. **The asymmetry this
> entry reports is consistent with a property of the window, not confirmed evidence that
> direction — or either side's entry-timing skill — is what's driving the gap.** The trade
> counts and net avgR below are unchanged and reproduce exactly. See
> `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL` (2026-08-29) for the full construction and the long
> families' own null results.

`SHORT-SIDE-ENGINE-CAPABILITY` (2026-08-28) added a `direction: "short"` path to
`backtestMultiTF` (`bos` entryMode only — the mirror of a long entry's confirmed swing low is a
confirmed swing high) but deliberately ran no family and reported no result.
`engine_is_long_only` (blackboard finding, 2026-08-22) had already flagged that every positive
equities number on record (`EQUITIES-BASELINE-PORT`, `EQUITIES-ALL-FAMILIES-BASELINE`,
`EQUITIES-MADIP-SIGNIFICANCE`/`-OUT-OF-SAMPLE`) is a long-only number over a window in which the
index rose, on IBKR — where shorting is actually available (unlike this project's Kraken venue)
— and deliberately deferred queuing this item until the queue drained rather than padding it in
early. This item is that first look.

**Config, pre-registered exactly per this item's own work_queue spec:** `{ entryMode: "bos",
trendGate: false, alignMode: "none", minStopPct: .015, maxStopPct: .06, tpR: 4, lockBreakeven:
false }`, run with both `direction: "long"` and `direction: "short"` against the identical
config so the comparison isolates direction only. `trendGate`/`alignMode`/`lockBreakeven`
semantics in this engine are proven only for longs (`SHORT-SIDE-ENGINE-CAPABILITY`'s own
writeup) and were not inverted for shorts — turning them off for **both** directions avoids
confounding the long-vs-short comparison with a filter that was never validated for shorts.
`lockBreakeven: false` is also mechanically required: `direction: "short"` throws if it is left
at its true default (`backtest.js`'s short-direction guard, added by
`SHORT-SIDE-ENGINE-CAPABILITY`). **This means neither run here is directly comparable to
`EQUITIES-ALL-FAMILIES-BASELINE`'s own `bos` row** (`trendGate: true, lockBreakeven: true`) —
stated plainly, not implied away.

**Data — DJIA-30 cache, cache-only, no live IBKR Gateway call:** same universe, 0.70
train/holdout split, and cost basis as `EQUITIES-ALL-FAMILIES-BASELINE` (IBKR Fixed
$0.005/share modeled per-symbol via that symbol's own holdout `avgClose`, 5bps/side slippage).
New script only: `scripts/bos-short-equities-baseline.mjs` (additive, read-only).

**Result (holdout only, 30/30 symbols cached and used):**

| Direction | Trades | Gross avgR | Net avgR |
|---|---:|---:|---:|
| long | 148 | +0.2162 | +0.1838 |
| short | 188 | **-0.3729** | **-0.4086** |
| pooled (descriptive only) | 336 | -0.1134 | -0.1477 |

The long side clears comfortably positive on this config — consistent with
`EQUITIES-ALL-FAMILIES-BASELINE`'s prior `bos` numbers in direction, though not in magnitude,
per the comparability gap above. The short side is deeply net-negative, both gross and net,
with more trades than the long side (188 vs 148) over the same window: `bos`'s short-entry
candidate (confirmed swing-high break) fires more often than its long-entry mirror on a rising
index, and loses when it fires. This is the expected direction given the window (the index
rose), but the magnitude — worse than -0.37R gross, before any borrow cost — is new
information: it is not merely that the short side lacks edge, it is actively and substantially
harmful on this config, with no filter tuning attempted (none was in scope; `trendGate`/
`alignMode` are switched off for both directions per the pre-registration above, not tuned per
direction).

**Pooled (`pooledDescriptiveOnly`, -0.1477R net, 336 trades) is reported descriptively only —
not a promoted combined-direction strategy.** Running both directions and mechanically adding
them is not a real "trade both ways" system (no logic here decides which direction to take
when); it is included only so the net drag the short side would add to an unmodified long-only
`bos` book is visible in one place.

**Borrow cost is NOT modeled anywhere in this engine** (`SHORT-SIDE-ENGINE-CAPABILITY`'s own
caveat, restated here). The -0.4086R short net figure is *before* borrow cost, and is already
decisively negative before that unmodeled cost is even added — borrow cost would only widen an
already-failing number, not rescue a marginal one. No further short-side work is implied by
this result; the short side is not a candidate for anything further on this config without a
materially different entry logic, which is out of this item's scope.

**`VERDICTS.md` is not touched** (breadth/diagnostic-only item, matching
`EQUITIES-ALL-FAMILIES-BASELINE`'s own precedent for a first-look study; no pre-registered gate
was defined for this item to clear or fail against).

**Engineering note.** New `scripts/bos-short-equities-baseline.mjs` only (additive,
read-only, cache-only, no network egress). `backtest.js`/`strategy.js`/`tournament.mjs`/
`monitor.js`/`bot.js`/`trader.js`/`scanner.js` — all untouched (the `direction` param and the
`bos` short-entry candidate already existed from `SHORT-SIDE-ENGINE-CAPABILITY`; this item only
calls them). `npm.cmd test`: 513/513 green (no production code changed).

## 2026-08-29 — VOL-CONTRACTION-SEALED-VALIDATION: the sealed pool is structurally too small to test the trades leg — inconclusive, not a pass; the active-pool funding-cost caveat resolves clean, both derivatives cells stay positive net of real funding

`VOL-CONTRACTION-SAMPLE-EXTENSION` (2026-08-28) found that `vol_contraction` on a 15m-entry,
holdout-only axis (today's full watchlist, same 0.70 split) clears the fuller 3-leg gate for
the first time in this project's history: 256 trades, gross avgR +0.2524, positiveAssets/
assets 0.654. Per `AGENT_PROTOCOL.md`'s "Rule for a new economic-gate result that clears its
literal pre-registered threshold" (added in that same commit), this made the result
**provisional, not a live D3 candidate**, until re-run against `researchlib.mjs`'s
`SEALED_SYMBOLS` pool (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI`) — the one holdout resource in this
project confirmed never yet examined by any study. This item performs that one-time re-run,
single-shot by design (this pool is not to be touched again regardless of outcome), plus
resolves a second, independent caveat `VOL-CONTRACTION-SAMPLE-EXTENSION` left open: its two
positive Kraken-derivatives cells were reported as funding-free upper bounds. New script only:
`scripts/vol-contraction-sealed-validation.mjs` (additive, read-only, cache-only — every
`PF_<PAIR>USD-historical-funding.json` needed was already on disk; no network egress).

**SEALED_SYMBOLS re-run (same frozen config, same 0.70-split holdout, entryTf 15m — the only
things that change are the 5 symbols):** 67 trades, gross avgR **0.0411** (95% CI [-0.2959,
0.3782]), 5/5 sealed symbols traded, 2/5 net-positive (0.400). Per-symbol: AVAX -0.0859 (14
trades), LINK -0.3487 (9), NEAR +0.0787 (18), SUI -0.1123 (11), UNI +0.4610 (15) — noisy and
mixed, no consistent direction across the pool.

**Gate result: FAILS the trades leg, and this was foreseeable and disclosed before running.**
The sealed pool is 5 symbols against the active pool's 28 that produced 256 trades (~9.14
trades/asset); at that same per-asset rate, 5 symbols would be expected to produce roughly 46
trades — nowhere near the 150-trade floor — regardless of whether the underlying edge is real.
Observed 67 trades is consistent with that expectation, not a surprise. avgRPass=false (0.0411
< 0.10), tradesPass=false (67 < 150), positiveAssetsPass=false (0.400 < 0.50). **This is
reported as INCONCLUSIVE on the trades leg specifically — the sealed pool is structurally too
small to test that leg at all — not lowered to a pass and not declared a clean fail on sample
size alone.** The point estimate itself (+0.0411, CI spanning zero) also does not independently
support the active-pool's +0.2524 gross edge, but with only 5 symbols and a CI this wide, that
is weak evidence either way. **`VOL-CONTRACTION-SAMPLE-EXTENSION`'s finding does NOT replicate
on sealed data as tested. No promotion — this was never a live D3 candidate, and stays that
way.**

**Funding-cost resolution (independent deliverable, active pool, not touching the sealed
pool):** a funding-rate model already exists in this codebase — `cost-model.mjs`'s
`fundingCost()`, fed by `derivatives.mjs`'s `fetchFundingRates()` /
`PF_<PAIR>USD-historical-funding.json` caches — but had never previously been applied to any
backtest result. This item reproduced `VOL-CONTRACTION-SAMPLE-EXTENSION`'s own AXIS C
population exactly (today's full watchlist, unsplit against `SEALED_SYMBOLS` — that item used
`loadWatchlist()` directly, so its reported 28-asset pool already includes the 5 sealed
symbols; reproducing its exact figures requires the same unsplit population, confirmed by the
reproduction below matching to 4 decimal places) and applied real per-trade funding cost
(`fundingCost()` over each trade's entry→exit window, converted to R via the same
price/risk convention `backtest.js` already uses for fees):

| Venue | Reported (funding-free) | Reproduced (funding-free) | True net (funding-adjusted) | 95% CI |
|---|---:|---:|---:|---|
| Kraken derivatives maker | +0.2231 | +0.2231 | **+0.2244** | [0.0339, 0.4148] |
| Kraken derivatives taker | +0.1057 | +0.1057 | **+0.1070** | [-0.0833, 0.2974] |

The funding-free reproduction matches the originally reported figures exactly, confirming the
same population and method. Both cells stay positive after real funding is included, and the
effect of funding itself is small (+0.0013R on both cells) — consistent with this axis's short
average hold times (tpR 3, 15m entry) leaving little time for funding to accrue either way.
**The upper-bound caveat is resolved: it does not overturn either cell**, though this says
nothing about the sealed-pool replication question above, which remains inconclusive
independently.

**`VERDICTS.md` is not touched** (provisional/non-promoted economic-gate clear, matching this
project's existing precedent — no genuine PASS-and-replicated result to record).

**Engineering note.** New `scripts/vol-contraction-sealed-validation.mjs` only (additive,
read-only, cache-only, no network egress). `backtest.js`/`strategy.js`/`tournament.mjs`/
`cost-model.mjs`/`derivatives.mjs` — all untouched (this item only calls their existing
exports). `npm.cmd test`: 513/513 green (no production code changed).

## 2026-08-29 — EQUITIES-QUEUED-ITEMS-AUDIT: all six section-2 items were already complete; the one real gap was three missing `VERDICTS.md` rows, now added

**Task.** `SEARCH_SPACE_EXHAUSTION_ASSESSMENT.md` section 2 named six queued items as the
gating check before any C0-C3 new-mechanism work: `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`,
`EQUITIES-ALL-FAMILIES-BASELINE`, `EQUITIES-COST-ASSUMPTION-SENSITIVITY` (the three the
`phase_directive_new_mechanism` directive names explicitly), plus
`WALKFORWARD-REVALIDATION-OF-BASELINE`, `TIME-VARYING-COST-REPRICING`,
`CANDLE-CORPUS-GAP-AUDIT` (the remaining items in that table). This item verifies each one
item-by-item rather than trusting the queue note's preliminary claim, since that claim is the
whole basis for proceeding to C0.

**Verification, one line per item, `work_queue` state + `ROADMAP.md` section quoted directly
(no paraphrase from memory):**

- `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` — `work_queue` state `done`; `ROADMAP_ARCHIVE.md:3581`
  ("on a fresh universe, the edge does not reproduce — it flips negative"). Holdout avgR
  **-0.0854R** (DJTA-20, 33 trades) vs the original DJIA-30's +0.1866R; 95% CI
  [-0.4052, +0.3313]; one-sided sign-flip p=0.6165.
- `EQUITIES-ALL-FAMILIES-BASELINE` — `work_queue` state `done`; `ROADMAP_ARCHIVE.md:3185`
  ("10 of 12 unmodified families produce a positive net avgR... this is a breadth measurement,
  not a promotion"). Corrected 2026-08-28 by `CROSS-FAMILY-TRADE-OVERLAP-AUDIT` to **8 of 12**
  (the header was wrong; the section's own body text already said 8). `ma_dip`: 475 trades, net
  avgR +0.1526, the largest usable sample in the table.
- `EQUITIES-COST-ASSUMPTION-SENSITIVITY` — `work_queue` state `done`; `ROADMAP_ARCHIVE.md:3081`
  ("`breakout`'s net-positive equities result survives every plausible slippage citation, breaks
  only past 45bps; the unmodeled $1 commission floor binds well within a realistic retail
  position size"). Break-even slippage 45.42bps (~9x the 5bps baseline); commission floor binds
  below ~$6.7k-$192k per-symbol position size (median ~$48k).
- `WALKFORWARD-REVALIDATION-OF-BASELINE` — `work_queue` state `done`; `ROADMAP_ARCHIVE.md:2771`
  ("`anticipate`'s fold-to-fold drift is statistically significant, `breakout`'s isn't — the
  single split is not uniformly adequate"). `anticipate`: 4 rolling folds decline monotonically
  (-0.673 → -0.974R), ANOVA permutation p=0.000999 (significant); `breakout`: fold range 0.165R,
  p=0.076 (not significant). Both stay decisively negative in every fold — no hidden profitable
  regime surfaced.
- `TIME-VARYING-COST-REPRICING` — `work_queue` state `done`; `ROADMAP.md:3437`
  ("a real Kraken Tier-1 fee-schedule change is confirmed inside the sample window, but the
  pre-change rate could not be reliably sourced — honest non-verdict, no repricing performed").
- `CANDLE-CORPUS-GAP-AUDIT` — `work_queue` state `done`; `ROADMAP_ARCHIVE.md:2894`
  ("26 of 29 watchlist assets have not collected a new candle since 2026-03-31 — every 'full
  local history' claim made by any study run after that date is silently truncated for
  everything but BTC/ETH/SOL"). Staleness: BTC/ETH/SOL ~23 days, the other 26 assets ~143 days
  (all stalled the same minute, 2026-03-31), EOS ~417 days.

**All six confirmed complete — no incomplete item found, nothing completed as a side effect of
this audit.**

**The equities line's status, stated plainly against the current record (not the 2026-08-22
assessment's framing).** `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` flipped negative on a fresh,
zero-ticker-overlap universe (DJTA-20): -0.0854R vs the original +0.1866R, CI includes zero,
p=0.6165 — the project's one out-of-sample equities re-check of `breakout` failed. `ma_dip`,
the family `EQUITIES-ALL-FAMILIES-BASELINE` flagged as the strongest breadth candidate, is now
**closed**: `MADIP-SURVIVABILITY-CONDITION-5` and `MADIP-RANDOM-ENTRY-CONTROL` (both
2026-08-28) found it fails survivability (same drawdown shape that killed `B5-REVERSAL`) and
fails a matched-geometry random-entry null, on both universes — conditions 3 and 5 of
`ALPHA_DEFINITION.md`'s six-condition gate, closed outright. And `EQUITIES-ALL-FAMILIES-BASELINE`'s
own breadth headline — "10 of 12 families net-positive" — was itself wrong from the day it was
written; `CROSS-FAMILY-TRADE-OVERLAP-AUDIT` (2026-08-28) corrected it to **8 of 12**, confirmed
the corrected figure survives an overlap check, but that correction does not change any
individual family's fate. Taken together: the equities program's headline positive result did
not reproduce out-of-sample, its best breadth candidate is now closed on two separate gate
conditions, and the breadth measurement that surfaced that candidate had a wrong header for six
days. Nothing currently open on the equities line clears this project's promotion bar.

**The one real gap: three `VERDICTS.md` rows.** `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`,
`EQUITIES-ALL-FAMILIES-BASELINE`, and `EQUITIES-COST-ASSUMPTION-SENSITIVITY` — the three items
the `phase_directive_new_mechanism` directive names explicitly — had never been added to
`VERDICTS.md`, confirmed by grep before this item started. Added in this commit, following
`VERDICT_TEMPLATE.md`'s header discipline and the file's own existing row format exactly; no
existing row altered.

**C0-C3 work.** None started, per this item's own scope. This item is read-only research
bookkeeping.

**Engineering note.** No production or research script touched — this item only reads
`.agent_state.json`, `ROADMAP.md`, and `VERDICTS.md`, and adds three rows to the latter.
`equities-breakout-out-of-sample.mjs`/`equities-all-families-baseline.mjs`/
`equities-cost-assumption-sensitivity.mjs`/`walkforward-revalidation.mjs`/
`time-varying-cost-repricing.mjs`/`candle-corpus-gap-audit.mjs` — none re-run; every quoted
figure above is read from the existing `ROADMAP.md` record, not recomputed. `npm.cmd test`:
green (no production or test file changed).

## 2026-08-29 — PHASE-DIRECTIVE-BOOKKEEPING: recording the new-mechanism phase directive's four decisions, the C0-C3 build order, and a pre-registered correction-family decision for C0-C3

Pre-registered task: `PHASE-DIRECTIVE-BOOKKEEPING` (`.agent_state.json` work_queue), depends
on `EQUITIES-QUEUED-ITEMS-AUDIT` (done, immediately above). This item does two things only:
(a) writes the human phase directive recorded in `blackboard.phase_directive_new_mechanism`
(2026-08-29) into this project's permanent record, with the reasoning drawn from the project's
own history and figures quoted rather than restated from memory; (b) makes and pre-registers a
decision — before any C0 result exists — on whether C0-C3 join the existing formal-NHST
correction family (`MULTIPLE_COMPARISONS_AUDIT.md` §2) or form a new, separately-corrected one.
**No C0 result is computed in this item.**

### The four decisions (source: `blackboard.phase_directive_new_mechanism`, human principal, in
response to `SEARCH_SPACE_EXHAUSTION_ASSESSMENT.md`, 2026-08-22)

1. **The crypto price-structure / Template-A program is CLOSED**, extending
   `blackboard.template_a_exhausted` (2026-08-19) to its full scope. No new price-structure
   entry variant, gate input, or cost-reduction angle on `breakout`/`anticipate`/the existing 12
   families may be queued. Reopening requires a genuinely new information source, not a
   parameter change.
2. **Equities research is ratified to continue**, including the pre-existing deviation from
   this project's own asset-expansion gate (equities work began before any crypto signal
   passed) — reviewed and accepted because it stayed research-only (cached data, no live IBKR
   order ever placed) and was fully disclosed as it happened. Going forward this is normal,
   authorized work, not a standing exception; the underlying rule (no live order without the
   D1→D2→D3 path and explicit human sign-off at D3) is unchanged.
3. **FX is authorized as a new asset class**, reusing the equities IBKR integration.
   Research/paper only until a signal earns live promotion through the same human-gated path.
4. **A new research phase is opened**, scoped to genuinely new mechanisms — not variants of the
   12 closed families or the 11 closed Template-A gate inputs.

### Why decision 1, from the project's own record — figures quoted, not restated from memory

- **`ZERO-COST-FLOOR-ALL-FAMILIES` (2026-08-22, this file).** All 12 `tournament.mjs` families
  re-run at zero cost against the pre-registered "meaningfully positive" gate (holdout trades
  >=150, positiveAssets/assets >=0.5, avgR > +0.10R). Result: **0/12 families clear it.** Only 4
  clear zero at all (`ma_dip` +0.0877, `vol_contraction` +0.2177, `breakout` +0.0637, `h3`
  +0.0329), and `vol_contraction` — the closest, clearing both the avgR clause (+0.2177) and the
  positive-asset clause (11/21 = 52.4%) — fails only on the trade-count floor (98 < 150).
- **`EXECUTION-DELAY-DECAY-CURVE` (2026-08-19, this file).** Delaying `breakout`/`anticipate`
  entry by 0-5 bars (1h timeframe) produced **sharp, monotonic degradation for both families,
  zero exceptions across 5 points x 2 families.** `anticipate`: -0.8842R (delay 0) →
  -1.6242R (delay 5), an 84% relative worsening. `breakout`: -0.8640R → -2.2953R, a 166%
  relative worsening. This ruled out "wait for a better fill" as a rescue for the maker-execution
  cost-reduction thesis PWR5 through PHASE4 were built on — waiting for a resting order to fill
  is itself a form of execution delay. (Correction on record, stated here rather than omitted:
  `MAKER-FILL-MICROSTRUCTURE-SIMULATION`, 2026-08-28, narrowed this claim — the collapse doesn't
  begin until delay 2, `breakout` loses only -0.0207R at delay 1, and the sub-1-hour region where
  a real post-only order actually rests remains unmeasured and, per that item's own finding,
  unmeasurable with any data source this project holds. The honest framing is "maker execution
  fails when tested at hourly resolution," not "closed at every resolution" — carried forward
  here rather than restated as unqualified.)
- **`PAIRS-COINTEGRATION-STATARB` (2026-08-19, `VERDICTS.md`).** The one market-neutral,
  relationship-reversion mechanism tested (Engle-Granger cointegration across 105 pairs with
  sufficient overlapping history, active watchlist): **0/105 pairs survive BH-FDR q=0.05.**
  Lowest three raw p-values (APT/FIL, DOT/FIL, FIL/POL, all p=0.0050) correct to q=0.1741, more
  than 3x past threshold.
- **`B5-REVERSAL` and `Classifier P5` (`VERDICTS.md`) — "real but small effects killed by
  cost."** `B5-REVERSAL` L=3: train IC=-0.0685, p=0.0010 (correct sign after the pre-registered
  sign-flip, the first primary-cell IC to clear significance) — but net economics fail
  decisively at the corrected real ~1.7% round-trip cost, -0.0025 to -0.0243R across quantiles.
  `Classifier P5`: holdout AUC 0.5249 beats its permutation null (p=0.0198, significant) — but
  the best-scoring subset still nets -0.4616R/trade after cost (baseline -0.5178R, lift +0.056R,
  still deeply negative). Both are this project's clearest examples of a statistically real,
  economically dead result — not noise, not a bug, just too small for this project's actual
  costs to ever monetize.
- **`PER-FAMILY-COST-CEILING` (2026-08-28, this file) — the equities venue difference is the
  only change that moved the outcome materially.** Of 60 (family, venue, market) cells checked,
  7 clear +0.10R; 6 of those 7 are on the equity market alone (`bos` +0.1728R/60 trades, `ma_dip`
  +0.1526R/475 trades, `rsi` +0.2507R/32 trades, `breakout` +0.1866R/61 trades,
  `range_sweep_reclaim` +0.9656R/3 trades, `h3` +0.1178R/106 trades); the one crypto cell
  (`vol_contraction`/derivatives-maker, +0.1924R/98 trades) is a funding-free upper bound on the
  same small sample `ZERO-COST-FLOOR-ALL-FAMILIES` already flagged. That study's own scope note:
  clearing a cost ceiling is a necessary condition for tradability, not a sufficient one — most
  of the 6 equity cells are carried by very few trades at a favorable price level, not a broad
  edge.

Together: nothing in the 12 crypto price-structure families clears a meaningful gross edge at
any cost structure; the one market-neutral mechanism tried finds nothing; better execution
cannot rescue it at the resolution this project can actually measure; and the only lever that
changed the outcome materially was trading a different venue (equities), not a different
price-structure signal on the same venue. That is the basis on which decision 1 closes the
program on mechanism.

### The `vol_contraction` tension — stated plainly, not resolved here

Decision 1's own text (in `blackboard.phase_directive_new_mechanism`) says `vol_contraction`
"fails only on trade count — a sample ceiling, not a signal problem." Two events postdate the
2026-08-22 `SEARCH_SPACE_EXHAUSTION_ASSESSMENT.md` this directive responds to, and the
directive's section on decision 1 rests on the superseded reading of the first:

- **`VOL-CONTRACTION-SAMPLE-EXTENSION` (2026-08-28)** addressed that trade-count ceiling
  directly. Its AXIS C (15m entry, holdout-only, 256 trades, gross avgR +0.2524, 65.4% of assets
  positive) **cleared the full 3-leg gate — the first result in this project's history to do
  so.**
- **`VOL-CONTRACTION-SEALED-VALIDATION` (2026-08-29)** then spent the `SEALED_SYMBOLS` pool on
  it and returned **INCONCLUSIVE** (67 trades, structurally unable to reach the required
  150-trade leg) — contrary to `SEARCH_SPACE_EXHAUSTION_ASSESSMENT.md`'s own §2 warning that
  spending that pool with nothing validated would destroy the project's last fresh judge. The
  sealed pool was spent inconclusively on 2026-08-29; nothing may assume a fresh sealed pool
  exists.

**This was not resolved by the agent.** The reading applied conservatively pending human review:
a 15m entry timeframe is a *parameter change* on an existing family, not a genuinely new
information source, so decision 1's closure covers it. The two cache-only controls that would
test whether AXIS C's edge is entry-rule or payoff-geometry
(`VOL-CONTRACTION-RANDOM-ENTRY-CONTROL`, `ENTRY-TIMEFRAME-AXIS-CONTROL`) are preserved in the
work queue as closed-by-directive with their full text intact — reopening them is a one-line
state change if the human decides the record above changes the call. Decision 1 should **not**
be read as unambiguous: the record contains a first-ever gate clearance in the closed program,
spent inconclusively the same week it closed.

### C0-C3 build order and sequencing rule

`C0` signal combination (`B5-REVERSAL` rank + `Classifier P5` probability, composite score, the
same sealed holdout and cost model each already uses alone) → `C1` equity/index options
volatility risk premium (data-availability gate first) → `C2` macro/cross-asset regime
conditioner on the equities line (regime variable external to the traded asset's own
price/derivatives — distinct from the failed `T3-REGIMEFILTER`/`TREND-GATE-MA`/`TREND-GATE-
STRUCTURE`, which gated on the asset's own price) → `C3` FX carry (sequenced last; not started
early for coverage). **C1, C2, and C3 are not to be queued until C0 resolves.** `SEALED_SYMBOLS`
remains reserved for the one-time final validation of a candidate that has already cleared its
own normal gate — nothing in C0-C3 earns that spend until it clears a holdout on the active pool
first. Every item still requires fixed pre-registration before any result is seen, real cost
modeling, a sealed holdout, and on any PASS the D1 (research) → D2 (paper-trade, log-only) → D3
(human gate) path before anything resembling live promotion.

### Pre-registered correction-family decision for C0-C3 (decided before any C0 number exists)

**Decision: C0-C3, when each produces a formal significance test, join the existing formal-NHST
correction family in `MULTIPLE_COMPARISONS_AUDIT.md` §2 (currently 20 sub-tests across 17
studies) — they do not form a new, separately-corrected family.**

Argued from the hypothesis classes involved, not from the effect on any threshold:

1. **This project's own established practice already pools every genuinely new hypothesis class
   into this same family, and has never spun off a separate one.** `MACRO-REGIME-PRIMARY-SIGNAL`,
   `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`, and `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` are exposure
   signals built on macro data, news sentiment, and on-chain address counts respectively — three
   hypothesis classes at least as distant from "price-structure momentum/reversal" as C1's
   options-vol risk premium or C3's FX carry are. All three joined the same family
   (`MULTIPLE_COMPARISONS_AUDIT.md` §2's running table) without any separate-family argument
   being raised at the time. Treating C0-C3 differently, with no change in project convention to
   justify it, would be an unexplained departure timed to exactly the moment it lowers the bar
   for the next set of tests — the shape of thing `ALPHA_DEFINITION.md` §4b's standing
   prohibition against narrowing a correction family for convenience exists to catch, even though
   that prohibition was written about removing existing members rather than routing new ones
   around the family.
2. **C0 specifically reuses the literal same data and cost model as two sub-tests already inside
   the family.** `C0`'s own build-order description is explicit: "the same sealed holdout and
   cost model each uses alone" — i.e. `B5-REVERSAL`'s and `Classifier P5`'s own whole-symbol
   sealed split. A combination of two already-tested signals on already-spent data is not a
   fresh information source by this project's own definition (`AGENT_PROTOCOL.md`'s closed-
   research-programs section: "a new input series is not a new experiment" — the inverse case,
   a new *combination* of two already-used inputs on the *same* data, is at least as clearly
   inside the existing family, not outside it).
3. **C1-C3 are new asset classes/data sources, but that alone has never been this project's test
   for family membership** — see point 1. What would justify a separate family is a different
   *statistical basis* (e.g. a self-contained, already-corrected internal screen, the shape
   `PAIRS-COINTEGRATION-STATARB` used for its own 105-pair Engle-Granger test) — none of C0-C3 is
   pre-registered that way; each is a single primary test against the project's standard
   permutation-null/significance gate, the same shape as every member of the existing family.

**What the alternative would have implied, stated explicitly per this item's own requirement.**
A new, separately-corrected family starting at C0 would mean C0's own raw p-value, evaluated
alone or against a 4-test family (C0-C3) at most, faces a BH-FDR threshold as loose as `1/4 x
0.05 = 0.0125` at worst rank and `4/4 x 0.05 = 0.05` at best rank — compared to joining the
existing n=20 (soon n=21) family, where the current tightest surviving threshold sits at
`1/20 x 0.05 = 0.0025` and every existing member's rank shifts down as new entries are added.
This is a large, real difference in how hard C0 would have to clear the bar, and is exactly why
this decision had to be made now, from the hypothesis-class argument above, rather than after
seeing where C0's own p-value would land in each scheme.

**Timing, recorded explicitly:** this decision is written before `C0` has been implemented, run,
or scored — no p-value for any C-series item exists anywhere in this project's record as of this
entry. `MULTIPLE_COMPARISONS_AUDIT.md` §5 is updated in this commit to bind this decision as the
governing rule for the C-series; no `AGENT_PROTOCOL.md` change is needed since its existing
"Multiple-comparisons discipline" section already states the family-size counters must be
updated whenever a new NHST study of that kind completes — C0-C3 simply do, when their time
comes, following the rule already written there.

### Engineering note

No production or research code touched, no backtest re-run, no C0 result computed — this item
reads `.agent_state.json`, `ROADMAP.md`, `VERDICTS.md`, `ALPHA_DEFINITION.md`, and
`MULTIPLE_COMPARISONS_AUDIT.md`, and writes this section plus the `MULTIPLE_COMPARISONS_AUDIT.md`
§5 addendum. Every figure quoted above is read from the cited existing record, not recomputed.
`npm.cmd test`: green (no test-relevant file changed).

## 2026-08-29 — C0-SIGNAL-COMBINATION: rank-average of B5-REVERSAL and Classifier P5 — KILLED, decisively, worse than either input alone

First item of the new-mechanism phase (`blackboard.phase_directive_new_mechanism` STEP 3).
New file `scripts/c0-signal-combination.mjs` (additive, cache-only, no egress); `momentum.mjs`
and `classifier.mjs` unmodified, their exported scoring functions reused directly throughout.

**Hypothesis, restated from the work-queue item's own framing.** B5-REVERSAL (L=3 cross-sectional
reversal, train IC=-0.0685 p=0.0010, correct sign — the project's only formal-NHST survivor at
q=0.05 as of this writing) and Classifier P5 (entry-time logistic classifier, holdout AUC 0.5249
p=0.0198) are two independent, statistically-real, economically-dead effects. Might two small
edges sum past the ~1.7% cost floor together even though neither does alone? This is a
combination mechanism on two already-used signals' own native outputs — not a new input series,
so `blackboard.template_a_exhausted`'s 2026-08-19 closure of the threshold-gate/breakout/
anticipate shape does not apply to it.

**Pre-registration (written into the script header before any composite number was computed —
summarized here, full text in the script itself).** Combination rule: fixed a priori,
UNFITTED rank-average. For each Classifier-P5 holdout trade, attach the most recent B5-REVERSAL
(L=3, sign-flipped `trailR`) panel score for that trade's symbol as of a panel date at or before
the trade's own entry date (no lookahead — a panel row's score only ever uses data at or before
its own date). Convert both the classifier probability and the momentum score to percentile
ranks *within the joined trade population* (scale-free, so no fitted weight is needed to combine
a probability against a return magnitude) and average them; select the top tercile
(`Math.floor(n/3)`, this project's own convention from `economicMomentumViews`). Cost model:
`classifier.mjs`'s own `economicLiftNetOfCost`, unmodified, at both the legacy 0.009 round-trip
and the FEE-SCHEDULE-REBASE-corrected real ~0.017 (primary gate cost). Gate: >=100 joined
trades; a one-sided permutation test (K=2000, seed 20260829, fixed before any result was
examined) that the combined-score top tercile beats a same-size random tercile from the same
population, p<0.05; composite selected net R>0 at 0.017; composite beats BOTH standalone
signals, each recomputed on the identical matched population.

**Holdout universe — a disclosed, deliberate deviation from every prior sealed study's
16-symbol convention.** This item's own instruction is explicit: never touch `SEALED_SYMBOLS`
(`researchlib.mjs`: AVAX, LINK, NEAR, SUI, UNI), and `AGENT_PROTOCOL.md` already records that
pool as spent (2026-08-29, `VOL-CONTRACTION-SEALED-VALIDATION`, inconclusive) with "nothing may
assume a fresh sealed pool exists." B5-REVERSAL's and Classifier P5's historical 16-symbol
holdout (`watchlist minus STABLE_13`) includes NEAR/SUI/UNI — a fact that predates the
`SEALED_SYMBOLS` protocol and is not re-litigated here, but this study's own NEW computation
never re-scores anything on them: the composite and its matched-population standalone baselines
use `watchlist minus STABLE_13 minus SEALED_SYMBOLS` (13 symbols: ALGO, APT, EOS, ETC, FIL, INJ,
POL, TAO, TIA, TRX, XMR, XTZ, ZEC). STABLE_13 (train, unchanged, still includes AVAX/LINK) is
used exactly as every prior study has always used it — that is not new information extraction
about those two symbols, it is this project's one and only train-universe definition throughout
its history. The one place the historical 16-symbol set is touched at all is the read-only
reproduction step below, which replays an already-published number as a code-path sanity check,
not a new evaluation.

**Step 1 — B5-REVERSAL train reproduction, exact match.** Replayed `momentum.mjs`'s own
`sealed-reversal` CLI recipe (L=3, STABLE_13, sign-flipped `trailR`, train split) byte-for-bit:
tercile net -0.0088/-0.0207 (legacy/real cost), top-3 -0.0007/-0.0069, top-5 +0.0001/-0.0046 —
all six figures match `phase2-triage.mjs`'s recorded reference exactly. Confirms the integration
point is wired correctly before touching anything new.

**Step 2 — Classifier P5 holdout reproduction: model/AUC match exactly, but the economics
figure has silently gone stale, disclosed here rather than reconciled quietly.** Refit the
identical model (STABLE_13 train, `chooseLambdaByCv`, lambda=0.1) and scored it on the
historical 16-symbol holdout: **holdout AUC = 0.5249**, matching `VERDICTS.md`'s published P5
figure exactly — proof the train/holdout split, scaler, and fitted model are byte-identical to
the original 2026-08-08 run. The economics are NOT reproducible from the current cache, though:
fresh selected/baseline net at 0.009 cost is **-0.8634 / -0.9079**, not the published
**-0.4616 / -0.5178**. Row counts match exactly (15076 total, 7580 holdout, 7496 train —
identical to the published run), ruling out a data or universe change. The cause: `strategy.js`'s
`FEE_RATE` (now 0.008/side, ~1.6% round trip) and `SLIPPAGE_PCT` already bake a cost into every
`profileEntries()` record's `netR` at simulation time, and `economicLiftNetOfCost` then subtracts
its own separate `roundTripCost` on top. `FEE-SCHEDULE-REBASE` corrected these constants upward
the same day (2026-08-08) P5 was originally published; the P5 sealed CLI has apparently never
been re-run since to refresh `VERDICTS.md`'s row, so calling the unmodified function today
against the now-corrected cost constants nets a materially worse figure — a genuine, disclosure-
worthy staleness in an existing published row, not a defect in this study or in `classifier.mjs`
itself. **Investigating or refreshing P5's own row is out of this item's scope** and is not done
here; this study instead uses freshly-computed figures throughout for both the standalone
baseline and the composite, since comparing a stale cost basis on one side against a fresh one
on the other would be the actual integrity error.

**Step 3 — matched-population (13-symbol) standalone baselines, freshly computed.**
B5-REVERSAL on the 13-symbol universe: top-3 net -0.0092/-0.0153 (legacy/real), top-5
-0.0074/-0.0123 (114 observations) — near break-even, consistent with its established profile,
slightly worse than the historical 16-symbol reading (expected: three symbols with their own
return characteristics are simply removed). Classifier P5 on the same 13-symbol holdout rows:
selected net -0.8474/-0.8554 (legacy/real, n=2350/5389) — consistent with Step 2's freshly-
computed figure, confirming the cost-constant explanation rather than a NEAR/SUI/UNI-specific
effect (removing three of sixteen symbols barely moves the number).

**Step 4-5 — the join and the composite.** 5389 classifier holdout trades on the matched
universe; 2044 dropped for having no momentum-panel coverage yet (a trade earlier than its
symbol's first 3-day lookback window in the holdout period) — disclosed, not silently absorbed.
Joined population: **3345 trades**. Selected top tercile (n=1115) gross mean netR **-0.9174**
vs. the unselected joined-population baseline **-0.9206** — visually indistinguishable, a
combined-rank selection that moved the needle by roughly 0.003R out of a ~0.92R loss.

**Step 6 — the pre-registered significance test.** One-sided permutation (K=2000, seed
20260829): **p=0.4708** — nowhere near the pre-registered 0.05 bar. Sign is nominally correct
(observed selected mean -0.9174 beats the null distribution's mean of -0.9220), but the effect
is far too small to be anything but noise, exactly what the near-identical selected/baseline
means in Step 5 already showed. Due-diligence-only 95% block-bootstrap CI on the selected
subset's net-of-0.017 R: **[-1.0828, -0.7670]** — entirely negative, does not exclude zero as
"positive" by any reading (it excludes zero, but on the negative side).

**Step 7 — the pre-registered gate, applied mechanically:**

| Clause | Result |
|---|---|
| >=100 joined trades | **PASS** (3345) |
| Permutation p<0.05, correct sign | **FAIL** (p=0.4708) |
| Composite selected net R>0 at 0.017 | **FAIL** (-0.9344) |
| Beats B5-REVERSAL (top-3 AND top-5) on the matched population at 0.017 | **FAIL** (-0.9344 < -0.0153 and < -0.0123) |
| Beats Classifier P5 on the matched population at 0.017 | **FAIL** (-0.9344 < -0.8554) |

**RESULT: KILLED, decisively — the composite is worse than either standalone input, not merely
no-better-than-neither.** The mechanism reads exactly as the rank-average arithmetic predicts
once the two inputs' scales are examined: B5-REVERSAL contributes a real but tiny-magnitude
signal (its net R sits within a few basis points of zero either way), while Classifier P5's
per-trade netR distribution is enormous by comparison (individual trades range roughly -2R to
+3R, mean far below zero after the corrected cost). Averaging PERCENTILE RANKS (not the raw
values) means this scale disparity shouldn't mechanically dominate the selection — and indeed
the permutation test shows the selection barely differs from a random draw — but the resulting
tercile still inherits the classifier population's own deeply negative mean, because ranking by
combined score does not change what the *selected trades' own outcomes* are: B5-REVERSAL's rank
information does correlate weakly with something, just not enough to lift a subset of an already
strongly negative population into positive territory, or even meaningfully above that
population's own unselected average. This closes the "existing small effects, just combined"
hypothesis cleanly, before any new data source is built — the useful negative result this item's
own note anticipated as a valid outcome.

**Multiple comparisons**, applying (not re-opening) `PHASE-DIRECTIVE-BOOKKEEPING`'s pre-registered
decision: C0's p=0.4708 joins `MULTIPLE_COMPARISONS_AUDIT.md` §2's formal-NHST family as its
21st sub-test, landing at rank 13 of 21 (between `B5-REVERSAL L=5` at 0.4226/rank 11 and
`MOMENTUM-SHORT-HORIZON-RECHECK L=14` at 0.4266/rank 12 in raw-p order — the new entry pushes
those two, in fact, down by one rank apiece and everything below it shifts as well). Family-wide
BH-FDR recomputed across all 21: q=0.7605, does not survive (unsurprising given the raw p).
**No material side effect**: the two existing survivors move by less than 0.001 in q
(`LOG-REGRESSION-BANDS-CRYPTO` 0.0040→0.0042, `B5-REVERSAL L=3` 0.0100→0.0105) — this addition
lands in the middle-to-lower half of the ranking, tightening thresholds below it only
mechanically via family-size growth, the same pattern every recent addition near the bottom half
has shown. `MULTIPLE_COMPARISONS_AUDIT.md` §2 and §5 and `AGENT_PROTOCOL.md`'s family-size
counter are updated in this commit.

**Sequencing**: per the phase directive's own build order (`C0 -> C1 -> C2 -> C3` in sequence,
C1-C3 not queued until C0 resolves), `C1` (options-vol risk premium) is now unblocked to run
next.

### Engineering note

New file only: `scripts/c0-signal-combination.mjs` (additive, cache-only, no network egress —
verified: `loadDailyCandles`/`loadResearchCandles`/`buildClassifierUniverseRows` all read from
on-disk research-cache files, no fetch calls anywhere in the path). `momentum.mjs` and
`classifier.mjs` are unmodified — every function used (`buildMomentumPanel`,
`economicMomentumViews`, `blockBootstrapCI`, `buildClassifierUniverseRows`, `fitZScoreScaler`,
`applyZScoreScaler`, `chooseLambdaByCv`, `predictLogistic`, `mannWhitneyAuc`,
`economicLiftNetOfCost`) is imported and called exactly as its own module already exposes it.
`SEALED_SYMBOLS` is imported from `researchlib.mjs` (not hand-copied) and never appears in any
holdout/evaluation role in this study's new computation — see the holdout-universe section
above for the one disclosed exception (a read-only reproduction of an already-published number).
No production code touched. `npm.cmd test`: 513/513 green, unchanged from before this commit
(this study adds no new tests of its own, consistent with every other throwaway `scripts/*.mjs`
diagnostic in this project, which reuse already-tested library functions rather than duplicating
coverage). Raw run output saved via `saveExperiment` to
`research-runs/2026-08-29T08-17-23-191Z-c0-signal-combination.json` for full auditability.


## 2026-08-29 — C1-VRP-DATA-AVAILABILITY-GATE: code-side capability confirmed sufficient, account-side entitlement is an open question for the human — not a pass, not a fail

Phase-directive STEP 4's build order queues C1 (defined-risk short-premium / variance-risk-premium
via IBKR equity/index options) next, now that `C0-SIGNAL-COMBINATION` closed KILLED. The directive
is explicit that the data-availability gate comes first: "does the available IBKR data plan
actually provide the options chain / historical implied-vol series needed, at what cost, how far
back... If the gate fails, say so plainly and stop; do not substitute a proxy without disclosing
it." This run had no egress and IB Gateway parked pending the human being at their machine, so the
live-subscription half of the gate genuinely cannot be answered from here — that constraint is the
deliverable's shape, not a hedge around it.

**Part A (code-side capability) — resolved, from static analysis only, no network call made.**
New `scripts/c1-vrp-data-availability-gate.mjs` (additive, read-only: reads `brokers/ibkr.mjs` and
the installed `@stoqey/ib` package's own TypeScript declarations, makes zero network calls,
modifies nothing). Two sub-findings:

- **`brokers/ibkr.mjs` carries no options code path today**, re-confirmed directly against this
  file rather than assumed to transfer from `OPTIONS-SKEW-PRIMARY-SIGNAL`'s 2026-08-22 finding
  (that was a Deribit/crypto-options study that died on construct — a different venue and data
  path). Every contract built anywhere in the file is `new Stock(symbol, "SMART", "USD")`
  (`stockContract()` at line 104); no `secType`, `Option`, `reqSecDefOptParams`,
  `reqContractDetails`, `tickOptionComputation`, or `OPTION_IMPLIED_VOLATILITY` identifier appears
  anywhere in it.
- **The installed `@stoqey/ib` dependency (already in use, no new package needed) already exposes
  every API call a defined-risk short-premium study would need**, verified against
  `node_modules/@stoqey/ib/dist/api/**/*.d.ts` directly rather than general TWS API docs: an
  `Option` contract class (`api/contract/option.d.ts`), `reqContractDetails`/`reqSecDefOptParams`
  for chain/strike/expiry enumeration, `tickOptionComputation` for live IV/greeks, and
  `reqHistoricalData`'s `whatToShow` enum includes `OPTION_IMPLIED_VOLATILITY` for historical IV
  (same `reqHistoricalData` call `fetchOHLC()` already uses — only the contract and `whatToShow`
  argument differ).

**Mapped to existing equities-side analogues, with a build estimate in
`EXOGENOUS-DATA-ACCESS-AUDIT`'s terms:** three of the four required pieces (contract construction,
historical retrieval, and its decoder quirks) extend `stockContract()`/`fetchOHLC()`'s existing
pattern directly; option-chain enumeration needs one new function following `fetchOHLC()`'s
request/promise/event-listener/cleanup shape against a different event pair; delta-based strike
selection has no direct precedent in this codebase (needs either a live `tickOptionComputation`
subscription or an offline pricing calc this project doesn't have). Overall: a multi-day build, not
a same-day change like C0's rank-average and not a multi-week one either — the code-side gate does
**not** fail.

**Part B (account-side entitlement) — not answerable from this session, stated as a question list
rather than guessed.** Whether the actual IBKR account holds an OPRA/options market-data
subscription, whether it covers historical option/IV bars or only live snapshots, and how far back
retention goes are all account-settings facts this run cannot check with no egress and Gateway
parked. Five concrete questions are recorded in the script's output, each answerable from one
settings page (IBKR Client Portal/TWS > Settings > User Settings > Market Data Subscriptions),
covering: OPRA/options-inclusive bundle held or not, historical-vs-snapshot-only entitlement,
retention depth for the underlying being considered, and any incremental cost not currently being
paid.

**Fallback, stated per the directive, not acted on.** If Part B comes back negative, the next
mechanism is C2 (needs one new external time series, not options data) per the build order. C2 is
**not** queued by this item — that is the next restock's decision once Part B is actually answered
by the human.

**No strategy or backtest code written, no return computed, no proxy substituted for implied vol,
`brokers/ibkr.mjs` unmodified (confirmed via `git status` before commit), no network access
attempted.** `npm.cmd test`: 513/513 green, unchanged (this diagnostic adds no new tests, same
convention as every other throwaway `scripts/*.mjs` audit in this project). Raw output saved via
`saveExperiment` to `research-runs/2026-08-29T10-03-27-905Z-c1-vrp-data-availability-gate.json`.


## 2026-08-29 — C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES: a genuinely new statistical unit — nominally p<0.05, does not survive family-wide BH-FDR

`C1-VRP-DATA-AVAILABILITY-GATE`'s account-side entitlement question resolved as neither pass nor
fail, unanswerable without the human. Per that item's own Part C fallback (and the phase
directive's step 4), the build order drops to C2. New file `scripts/c2-continuous-macro-
conditioner.mjs` (additive, read-only; `brokers/ibkr.mjs` and `backtest.js`/`strategy.js`
untouched).

**Why this is not a fourth discrete-regime study.** `MACRO-REGIME-PRIMARY-SIGNAL` (2026-08-22),
`MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES` (2026-08-25), and
`MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC` (2026-08-27) all died on the identical
structural wall: the equities holdout window contains exactly **one** discrete regime episode
(roughly 479 of 500 cached days sit inside a single unbroken favourable episode), so no split
point can catch a transition that isn't there, and effective n under discrete regime-voting is
the episode count — 1 — regardless of where train/holdout falls. The third study established this
is a property of the *window*, not the split fraction. A fourth discrete-regime study would fail
identically and was not staged. This item instead conditions on the macro level as a **continuous
covariate**, which changes the statistical unit entirely: effective n becomes the **trade count**,
not the episode count. Not caught by `template_a_exhausted` either (that closure retired
threshold-a-series then binary-gate breakout/anticipate then score holdout avgR) — this design
applies no threshold and no binary gate anywhere.

**Pre-registration (written into the script header before any equity return was touched —
summarized here, full text in the script itself).** Macro variable: the 10y-2y Treasury spread
(DGS10-DGS2), used as a continuous value, never thresholded — the natural single candidate since
it is already sourced by `macro-regime-primary-signal.mjs`, chosen before any association was
computed, no other variable tried and discarded. Sourcing/causal lag reused verbatim from that
script (`fetchFredSeries`/`lookupLagged` duplicated, since it doesn't export them — same pattern
`macro-regime-primary-signal-equities.mjs` already used): latest published value strictly before
(trade entry date - 1 day). Equity trade population: `ma_dip` on the DJIA-30 holdout, the EXACT
config `MADIP-REALISED-R-CONDITION-2` established (`{ entryMode: "ma_dip", trendGate: false,
alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }`, 70/30 split,
IBKR Fixed $0.005/share + 5bps/side slippage) — chosen as the single most rigorously
characterized equity trade population in this project (win-rate margin, exit-reason
decomposition, random-entry control, survivability all already measured against it), no parameter
changed. Test statistic: Spearman rank correlation between the causally-lagged spread level at
each trade's own entry date and that trade's realised net R, **two-sided** (no directional prior
was pre-registered — an inverted curve could plausibly correlate with trade outcome in either
direction, and choosing a side only after seeing the sign would be exactly the after-the-fact
framing this project's discipline exists to prevent). Significance via a label-shuffle permutation
test, K=2000, seed 20260829 (fixed before this script was ever run). A quintile breakdown (mean
net R and count per macro-level quintile) is a descriptive companion only, not an additional test.
Correction family: per `PHASE-DIRECTIVE-BOOKKEEPING`'s pre-registered decision, this joins
`MULTIPLE_COMPARISONS_AUDIT.md`'s existing formal-NHST family — not re-opened here.

**Result.** 30/30 DJIA-30 symbols had cache coverage; 475 `ma_dip` holdout excursions collected
(matches `MADIP-REALISED-R-CONDITION-2`'s own trade count for the same universe/config exactly —
confirms this reuses that population rather than re-deriving it). All 475 carried a real
`entryTime` and a DGS10/DGS2 macro point under the causal lag (0 dropped either way — FRED's
daily-series history comfortably covers the 2024-2026 holdout window). **Effective n = 475
trades**, contrasted against the **1 holdout regime episode** that limited all three prior
macro-regime studies — that contrast is the entire reason this item exists.

Observed Spearman rho = **-0.0980** (higher spread associated with lower net R — a small negative
effect, no direction was pre-registered so this is simply the sign observed). Permutation p =
**0.0365** (two-sided, K=2000, seed 20260829) — nominally clears the project's pre-registered
p<0.05 gate. Quintile breakdown (n=95 each):

| Quintile | Spread range | Mean net R |
|---:|---|---:|
| 1 (lowest) | 0.00 – 0.38 | +0.600 |
| 2 | 0.38 – 0.47 | +0.701 |
| 3 | 0.47 – 0.51 | -0.456 |
| 4 | 0.51 – 0.56 | -0.024 |
| 5 (highest) | 0.56 – 0.74 | -0.057 |

The quintile pattern is not monotonic (quintile 2 is the best-performing bucket, quintile 3 the
worst, with 4 and 5 both mildly negative) — consistent with a real but modest, noisy rank
correlation rather than a clean linear relationship, and a reason on its own not to read this as
an obviously exploitable gradient even before correction is applied.

**Multiple comparisons — applying, not re-opening, `PHASE-DIRECTIVE-BOOKKEEPING`'s pre-registered
decision.** C2's p=0.0365 joins `MULTIPLE_COMPARISONS_AUDIT.md` §2's formal-NHST family as its
22nd sub-test, landing at rank 6 of 22 (between `Classifier P5` at 0.0198/rank 5 and `Low-vol B4
negBeta` at 0.0579/now rank 7). This is the first addition to this family that raises the raw
p<0.05 hit-count itself (five to six) rather than landing below the existing hits. Family-wide
BH-FDR recomputed across all 22: **q=0.1338 — does not survive** (rank 6's own critical value is
`6/22×0.05=0.01364`, more than 2.5x below this result's q). Two sub-tests still formally survive
at n=22, unchanged from n=21; no flips. `MULTIPLE_COMPARISONS_AUDIT.md` §2 and §5 and
`AGENT_PROTOCOL.md`'s family-size counter are updated in this commit.

**RESULT: NULL after correction.** A nominally significant (p=0.0365), small, negative,
non-monotonic association that does not survive family-wide BH-FDR correction (q=0.1338) across
a 22-test family with two known survivors already. This closes continuous macro conditioning on
the 10y-2y spread for the `ma_dip`/DJIA-30 population — a useful negative result exactly as valid
as a discrete-regime null, and the honest complement to the three prior studies' episode-count
limitation: the wall those studies hit was structural (window shape), not merely
under-powered — and now that the statistical unit has actually been fixed, the result is still a
null, just a formally-testable one rather than an untestable one. No threshold was applied, no
signal was gated, no lag was swept, no discrete-regime design was re-run, `SEALED_SYMBOLS` was
never touched. Per this item's own scope, this is a diagnostic result, not a strategy change — no
gate, threshold, or production code follows from it.

**Sequencing.** C3 (FX carry) is next in the phase-directive's build order.

### Engineering note

New file only: `scripts/c2-continuous-macro-conditioner.mjs` (additive, read-only for equities —
`backtestMultiTF`/`saveExperiment` imported and called exactly as `backtest.js`/`researchlab.mjs`
already expose them, no modification to either; one FRED egress call for DGS10/DGS2, the same
public CSV endpoint `macro-regime-primary-signal.mjs` already uses). `npm.cmd test`: 513/513
green, unchanged (this diagnostic adds no new tests, same convention as every other throwaway
`scripts/*.mjs` audit in this project). Raw output saved via `saveExperiment` to
`research-runs/2026-08-29T11-04-24-423Z-c2-continuous-macro-conditioner.json`.

## 2026-08-29 — CLASSIFIER-P5-ECONOMICS-ROW-STALENESS: VERDICTS.md's Classifier P5 economics figure was double-counting cost since the day it was published — corrected to -0.8544/-0.8989

BOOKKEEPING / INTEGRITY FIX, not new research: corrects a previously-published number, computes
no new verdict, stages no hypothesis. C0-SIGNAL-COMBINATION (2026-08-29, this ROADMAP's entry
above) found and disclosed — but correctly left out of its own scope — that Classifier P5's
published economics figure (-0.4616R selected / -0.5178R baseline, VERDICTS.md, 2026-08-08) does
not reproduce from the current cache: a fresh refit reproduces the model and AUC exactly but
comes back with economics of -0.8634R/-0.9079R. This item independently confirms that finding,
identifies its root cause directly from the source rather than accepting C0's word, derives the
correct figure, and corrects the row.

**C0's diagnosis independently confirmed**, via a fresh, from-scratch script (not a reuse of C0's
own script file) that calls `classifier.mjs`'s exported `buildClassifierUniverseRows`,
`scaleTrainHoldout`, `chooseLambdaByCv`, and `classifierOutcomeReport` directly — the same
functions the `sealed` CLI's own `primaryOutcome` computation uses internally (classifier.mjs
~L593-604), skipping only the K=100 permutation-null loop (`scoreClassifierHoldouts`), which is
not in question here: AUC/p-value significance is unaffected by this bug and has already been
independently reproduced across 8+ saved `research-runs/*-classifier-sealed.json` files from
2026-08-07/08 plus C0's own bit-exact refit. Row counts: totalRows=15076, trainRows=7496,
holdoutRows=7580 — identical to the original PWR4 run (`research-runs/2026-08-08T02-39-53-926Z-
classifier-sealed-outcome.json`), ruling out any data or universe change. holdoutAuc=
0.5248761451544306 (0.5249) — reproduces the published figure exactly, and matches C0's own
independent refit bit-for-bit (0.5248761451544306). At `roundTripCost=0.009` (the original
`ROUND_TRIP_COST` P5 was published under): selectedNet=-0.8633632752939017, baselineNet=
-0.9078512980471726 — reproduces C0's -0.8634/-0.9079 finding exactly, confirming it is not a
transcription error or an artifact of C0's own script.

**Mechanism, demonstrated directly against the two source files rather than accepted on C0's
word.** `backtest.js`'s `profileEntries` (L872, L951-952) computes every classifier-universe
row's `netR` as:

    netR = (outcome === "win" ? tpR : -1) - ((feeRate + slipPct) * (entry + exitPrice)) / risk

with `feeRate`/`slipPct` defaulting to `strategy.js`'s module-level `FEE_RATE` (0.008/side) and
`SLIPPAGE_PCT` (0.0005/side) — i.e. every `netR` value already has the repo's real per-trade
transaction cost baked in at simulation time, using whatever `strategy.js` constants were current
when `profileEntries` ran. Separately, `classifier.mjs`'s `economicLiftNetOfCost` (L481-495)
computes `mean(row.netR - roundTripCost)` for the selected and baseline subsets — a second,
entirely independent cost subtraction, applied unconditionally regardless of whether `netR`
already contains a cost term. The `sealed` CLI (classifier.mjs L592-604) calls this with
`roundTripCost=0.009` on top of `netR` values that already contain `strategy.js`'s real cost.
The two compose: total cost actually subtracted = (cost baked into `netR` at whatever `FEE_RATE`/
`SLIPPAGE_PCT` were current) + (the separate `roundTripCost` parameter), not either alone.

**This is not a rebase-induced regression — the double-count existed on day one.** P5 was
published (commit d304419, 2026-08-07 22:41:41 -0400) *before* `FEE-DEFAULTS-UPDATE` (commit
44777de, 2026-08-08 14:22:28 -0400) rebased `strategy.js`'s `FEE_RATE` from 0.004 to 0.008. At
publication time, `netR` already carried the *then-current* ~0.9% round-trip cost (2×(0.004+
0.0005)), and `economicLiftNetOfCost` subtracted *another* separate 0.009 (=~0.9%) on top — the
original -0.4616R/-0.5178R already double-counted cost, just by a smaller absolute amount than
today's -0.8634R/-0.9079R (which double-counts the larger, corrected ~1.7% real cost). Neither
published number was ever the true single-counted figure.

**Derivation of the correct figure — not assumed, shown.** `economicLiftNetOfCost` is provably
affine in `roundTripCost` (`mean(netR) - roundTripCost`, a flat per-row subtraction, independently
verified by `scripts/phase2-triage.mjs` against CLASSIFIER-FUNDING-FEATURE's own two reported
cost points with 2.8×10⁻¹⁷ drift). That means `mean(netR)` for any subset is recoverable exactly
from one reported `(cost, net)` pair: `mean(netR) = reportedNet + reportedCost`. Since `netR`
already contains the *current, real* per-trade cost (today's rebased `FEE_RATE`/`SLIPPAGE_PCT` —
the corrected ~1.7% Kraken Tier-1 round-trip basis, not an assumption but the constant this
codebase already treats as its real-cost standard everywhere else), `mean(netR)` **is** the
correct, single-counted, current-real-cost economics figure — no further `roundTripCost`
subtraction should be applied. Confirmed directly (not just algebraically) by calling
`classifierOutcomeReport` with `roundTripCost=0`: selectedNet=-0.8543632752939021, baselineNet=
-0.8988512980471722, lift=0.04448802275327013 (**-0.8544 / -0.8989 / +0.0445** rounded) — matches
the algebraic recovery (-0.8633632752939017+0.009=-0.8543632752939017,
-0.9078512980471726+0.009=-0.8988512980471726) to the last digit. **Neither prior figure was
correct — both the original -0.4616/-0.5178 and the fresh double-counted -0.8634/-0.9079
overstate the loss; the true figure is a third number, -0.8544/-0.8989.** The lift itself
(+0.0445) is unaffected by the bug either way, since a uniform `roundTripCost` shift cancels in a
difference of two means computed on the same population — only the two absolute figures were
ever wrong, not the model's own relative selection signal.

**VERDICTS.md corrected**: the Classifier P5 row's economics figure now reads -0.8544R selected /
-0.8989R baseline (lift +0.0445), annotated with the date, cause, and a pointer to this entry.
AUC (0.5249) and the **KILLED** verdict itself are unchanged — the classifier's cost failure is,
if anything, more decisively negative than previously recorded, not less; nothing about this
correction is good news for the classifier. `classifier.mjs`, `strategy.js`, and `backtest.js`
are unmodified — the bug was never in the library code (the flat-subtraction cost model in
`economicLiftNetOfCost` does exactly what it says, and its own unit test in
`classifier.test.mjs` already proves that correctly); it was in how a published number was
computed, i.e. a call-site misuse, which is what got corrected.

**Every other figure derived through the same `netR`-plus-`roundTripCost` pattern, checked and
left uncorrected here per this item's own scope (bookkeeping only, no expansion):**

- **VERDICTS.md's `CLASSIFIER-FUNDING-FEATURE` row** (-0.2412R/-0.2492R selected vs -0.5387R/
  -0.5467R baseline, commit b4dbe7e, 2026-08-08 14:06:56 -0400) — same function
  (`economicLiftNetOfCost`), same `netR` field, same bug, **and a worse variant of it**: this
  commit predates `FEE-DEFAULTS-UPDATE` (44777de, 14:22:28 -0400) by ~16 minutes, so its `netR`
  was still computed under the *stale* pre-rebase `FEE_RATE=0.004`, yet its reported "corrected
  real ~0.017" figure applied `roundTripCost=0.017` **on top of that stale `netR` basis** — mixing
  a stale cost inside `netR` with an already-corrected cost as the separate subtraction. Both its
  0.009 and 0.017 reported figures overstate the loss, and — unlike P5 — the true figure cannot
  be recovered by arithmetic alone from the published numbers, since `mean(netR)` recovered that
  way would still reflect the *stale* 2026-08-08-morning `FEE_RATE`, not today's. Fixing this
  needs a fresh re-run (`buildClassifierUniverseRows` against current `strategy.js` constants,
  then `classifierOutcomeReport` with `roundTripCost=0`), not an algebraic correction — genuinely
  new computation, out of this item's scope.
- **VERDICTS.md's `C0-SIGNAL-COMBINATION` row** (2026-08-29) — its P5-reproduction figures
  (-0.8634R/-0.9079R, independently reproduced again by this item) and its matched-population/
  composite figures are built the identical way: `p5MatchedLegacy`/`p5MatchedReal` call
  `economicLiftNetOfCost` directly; the composite's `compositeLegacy`/`compositeReal` do the
  identical `netR - roundTripCost` arithmetic by hand (`scripts/c0-signal-combination.mjs`
  L269-270) rather than through the named function, same bug either way. Checked concretely
  rather than assumed: the script's own already-published "gross mean netR" figures
  (`selectedGrossMean=-0.9174087484075228`, `baselineGrossMean=-0.9206202708953056`) are, by this
  same derivation, **already the correct single-counted numbers** — it is the adjacent
  `compositeLegacy`/`compositeReal` figures (-0.9264/-0.9296 and -0.9344/-0.9376) that
  double-count an extra 0.009/0.017 on top of them. Likewise `p5MatchedReal.selectedNet=
  -0.8553999690694173` recovers to a true `mean(netR)=-0.8383999690694173` at the real cost
  basis. **This does not change C0's KILLED verdict or any gate clause's truth value**: the
  corrected composite figure (-0.9174) is still nowhere near positive (`positiveAtRealCost`
  stays false by a wide margin) and is still well below the corrected standalone P5 figure
  (-0.8384), so `beatsP5` still correctly fails — verified by direct arithmetic on the exact
  saved figures above, not asserted from the general shape of the bug. The row's *absolute*
  economics numbers are still technically wrong and should be annotated in the same follow-up
  as `CLASSIFIER-FUNDING-FEATURE`, even though no conclusion drawn from them changes.
- **ROADMAP_ARCHIVE.md's 2026-08-13 `PHASE2-MAX-SURVIVABLE-COST` section** (`scripts/phase2-triage.mjs`)
  — its Classifier P5 (-0.4530R best case) and `CLASSIFIER-FUNDING-FEATURE` (-0.2326R best case)
  rows, and their full 7-scenario tables, are built entirely by affine-recovering `mean(netR)`
  from the double-counted published figures and re-subtracting different cost scenarios — every
  number in both tables is offset by the same double-counted amount as its source row. The
  qualitative conclusion ("structural, never crosses positive at any tested cost, including the
  cheapest futures-maker scenario") is very unlikely to flip given how far these figures sit from
  zero relative to the offset size, but that is an inference from magnitude, not a re-verified
  fact, and is stated as such rather than asserted as re-confirmed.

**Recommended follow-up (not actioned here):** a dedicated item should (1) re-run
`buildClassifierUniverseRows`/`classifierOutcomeReport` with `roundTripCost=0` for
`CLASSIFIER-FUNDING-FEATURE` under current `strategy.js` constants and correct its VERDICTS.md
row the same way this item corrected P5's; (2) add a corrective annotation to
`C0-SIGNAL-COMBINATION`'s row pointing at its already-correct "gross mean netR" figures instead
of the double-counted `compositeLegacy`/`compositeReal` ones; (3) either re-derive
`PHASE2-MAX-SURVIVABLE-COST`'s two classifier-signal scenario tables against the corrected basis
or mark them superseded-pending-recorrection. None of the three is expected to change any
existing KILLED verdict, based on the magnitudes checked above, but none has actually been
re-verified either, which is exactly why this is a follow-up recommendation and not a claim.

**Engineering note.** No new file, no persisted script — the independent verification used a
throwaway script (not committed) that called `classifier.mjs`'s existing exported functions
directly; nothing in `classifier.mjs`, `strategy.js`, `backtest.js`, or any frozen path was
read-modified, only read. `npm.cmd test`: 513/513 green, unchanged (no test-affecting code
changed; this is a documentation correction only).

## 2026-08-29 — EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL: zero of ten scorable families clear a matched-geometry random-entry null — the corrected 8-of-12 DJIA-30 breadth claim does not survive

`MADIP-RANDOM-ENTRY-CONTROL` (2026-08-28) built a matched-geometry random-entry null for
`ma_dip` alone and found random long entries carrying `ma_dip`'s exact stop/target/breakeven
geometry already average +0.1493R on DJIA-30 before any entry-timing skill is credited —
`ma_dip`'s real result sat at only the 53rd percentile of that null. That control was scoped to
one family. `EQUITIES-ALL-FAMILIES-BASELINE` (2026-08-22, corrected 2026-08-28 by
`CROSS-FAMILY-TRADE-OVERLAP-AUDIT`) found 8 of `tournament.mjs`'s 12 families net-positive on
DJIA-30 — this project's most-cited positive equities finding, and the main stated reason
equities look different from crypto. It had never been read against a geometry-matched null.
This item applies `MADIP-RANDOM-ENTRY-CONTROL`'s exact method, unchanged, to all twelve
families, plus one extra configuration: `BOS-SHORT-EQUITIES-BASELINE`'s short-direction leg
read against its own matched-geometry short null.

**Method — `MADIP-RANDOM-ENTRY-CONTROL`'s construction reused verbatim, per family.** New
`scripts/equities-breadth-vs-random-entry-null.mjs` (additive, cache-only, no egress — same
`research-cache/equities-1d/` cache, all 30 symbols already present). Same four pre-registered
choices: random symbol (uniform over active symbols, not weighted by trade count) and entry
index (uniform over that symbol's own holdout candles); stop distance drawn with replacement
from **that family's own** empirical stop-distance distribution (not shared across families);
exit management replicating `backtest.js`'s generic lockBreakeven/target/timeout path
byte-for-byte (`strategy.js`'s BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=0.018 and
`backtest.js`'s MAX_HOLD=100, all unmodified); sample size matched exactly per family against a
fresh run, not hand-typed. K=2000 draws per family. Pre-registered floor: families under 10 real
trades are reported as too-thin-to-score rather than given a percentile — `range_sweep_reclaim`
(3 trades) and `vol_contraction` (0 trades) both fall below it.

**Reproduction check, before any null was computed.** All twelve families' trade counts and net
avgR reproduced `EQUITIES-ALL-FAMILIES-BASELINE`'s table bit-for-bit (trades exact match, avgR
matches to 4 decimals, all twelve `citationMatch: true`), and the `bos`-short-config leg
reproduced both `BOS-SHORT-EQUITIES-BASELINE` directions exactly (short: 188 trades, -0.4086R;
long: 148 trades, +0.1838R) — confirming the frozen configs and caches are unchanged before any
new statistic is trusted.

**Result — every scorable family, real result against its own matched-geometry null:**

| family | trades | real net avgR | null mean | null SD | percentile of real result | 95th-pctile bar | passes |
|---|---:|---:|---:|---:|---:|---:|---|
| `ma_dip` | 475 | +0.1526 | +0.1514 | 0.1045 | 52.1th | +0.3320 | NO |
| `rsi` | 32 | +0.2507 | +0.2189 | 0.3605 | 55.3th | +0.8390 | NO |
| `bos` | 60 | +0.1728 | +0.2236 | 0.2391 | 42.3th | +0.6303 | NO |
| `breakout` | 61 | +0.1866 | +0.2142 | 0.2061 | 46.5th | +0.5576 | NO |
| `h3` | 106 | +0.1178 | +0.2348 | 0.1918 | 27.4th | +0.5624 | NO |
| `support` | 407 | +0.0014 | +0.1815 | 0.1015 | 3.8th | +0.3479 | NO |
| `sweep_reclaim` | 92 | +0.0328 | +0.0751 | 0.1513 | 40.5th | +0.3242 | NO |
| `rev` | 179 | -0.0501 | +0.1715 | 0.1565 | 7.8th | +0.4323 | NO |
| `anticipate` | 303 | -0.0438 | +0.1563 | 0.1016 | 2.2th | +0.3238 | NO |
| `trend_pullback` | 38 | -0.2026 | +0.1865 | 0.2673 | 6.9th | +0.6296 | NO |
| `range_sweep_reclaim` | 3 | +0.9656 | — too thin to score (< 10 trades) — | | | | |
| `vol_contraction` | 0 | — (no trades) | — too thin to score (0 trades) — | | | | |

**Zero of ten scorable families clear the pre-registered 95th-percentile bar.** Not one —
including `ma_dip` (52.1th percentile, closely replicating `MADIP-RANDOM-ENTRY-CONTROL`'s own
53rd-percentile finding on an independent 2026-08-29 seed and draw order, which is itself a
useful cross-validation of the method) and `rsi` (55.3th percentile, the closest any family gets
to its own null mean in the *positive* direction but still nowhere near the 95th-percentile
bar). Two families sit closest to their null on the low side (`anticipate` 2.2nd percentile,
`support` 3.8th percentile) — both because their real result is close to flat while their null
mean is strongly positive, not because either signal does unusually badly.

**The null's own mean is reported prominently, per this project's `LOG-REGRESSION-BANDS-CRYPTO`/
`MADIP-RANDOM-ENTRY-CONTROL` precedent (state the window's own tailwind before any claim about a
signal).** Every one of the ten scorable families' null means is strongly positive (+0.0751 to
+0.2348) — a matched-geometry random long entry (structural-sized stop, large fixed target,
breakeven lock) already earns real money in this window before any entry-timing rule is
credited. This is the same beta/payoff-structure finding `MADIP-RANDOM-ENTRY-CONTROL` made for
`ma_dip` alone, now confirmed across the other nine scorable families: **the equity-side breadth
claim looks much more like a property of this window's favourable long-side payoff geometry than
like eight or ten distinct entry-timing signals.** Data-edge case disclosed, not silently
dropped: between 1.87% (`ma_dip`) and 11.67% (`breakout`) of simulated draws per family ran past
their symbol's holdout data before any exit fired and were force-closed at the last available
close — small enough not to plausibly change any of the ten verdicts above, reported rather than
assumed negligible.

**The corrected 8-of-12 breadth claim does not survive being restated against a geometry-matched
null.** Using the corrected figure throughout (per `CROSS-FAMILY-TRADE-OVERLAP-AUDIT`, not the
superseded 10-of-12): of the eight net-positive families (`ma_dip`, `rsi`, `bos`, `breakout`,
`h3`, `range_sweep_reclaim`, `support`, `sweep_reclaim`), one (`range_sweep_reclaim`) is too thin
to score at all, and the remaining seven all fail to clear the pre-registered bar. Breadth of
net-positive count was never itself evidence of eight distinct edges — this item is the first to
check that directly, and the check does not support it.

**No family re-tuned, re-parameterised, or promoted, exactly per this item's task text** — this
is a control, and every family's own percentile is reported, not just the interesting ones.

**Short leg (one extra configuration, not a separate study).** `BOS-SHORT-EQUITIES-BASELINE`'s
`bos` short-direction config (`trendGate:false, alignMode:"none", lockBreakeven:false, tpR:4`),
188 trades, real net avgR **-0.4086R**, read against its own matched-geometry short null
(mirrored exit geometry — stop above entry triggers on the bar's high, target below entry
triggers on the bar's low, no breakeven arm since `lockBreakeven:false`): **null mean -0.2857R**,
null SD 0.1194, real result at the **14.6th percentile** of the null. Pre-registered mirrored bar
(distinguishable only if the real result falls below the null's 5th percentile, -0.4750R): the
real result does **not** clear it — **not distinguishable from a matched-geometry random short
entry in the same window.** Random shorts with this exact stop/target geometry already lose
money in this window (a rising-index tailwind working against any short, mechanically), and the
real `bos` short result is well within the range that tailwind alone produces.
`BOS-SHORT-EQUITIES-BASELINE`'s own long-direction figure (+0.1838R, 148 trades, same config)
is, by the same logic as the long-family table above, also consistent with the window's
long-side tailwind rather than confirmed evidence of directional signal — this item does not
build a separate null for that leg since it uses the same construction already applied to the
twelve `tournament.mjs` families' `bos` row, whose own trendGate:true/lockBreakeven:true variant
already appears in the table above (42.3rd percentile, does not pass).

**`BOS-SHORT-EQUITIES-BASELINE`'s entry is annotated accordingly:** its -0.4086R short figure
should be read as *consistent with a window effect*, not as evidence the `bos` short signal is
directionally bad — the long-positive (+0.1838R)/short-negative (-0.4086R) asymmetry that entry
originally reported is exactly what a rising-index window predicts for ANY matched-geometry
long/short pair, independent of either side's entry-timing skill, and this item's short null
confirms that reading rather than merely speculating it.

**`EQUITIES-BASELINE-PORT` and `EQUITIES-ALL-FAMILIES-BASELINE` are annotated accordingly:**
both entries' breadth and gross-edge-gap framing (the 8-of-12/10-of-12 net-positive count, and
the "equities look different from crypto" reading built on it) should be read alongside this
item's finding that none of the scorable positive families demonstrably beat a geometry-matched
random entry in the same window — the breadth those entries reported is real (the counted trades
and avgR figures are unchanged and still reproduce exactly) but its interpretation as evidence of
multiple distinct equities edges does not hold up.

**Human-facing deck flag, same precedent as `CROSS-FAMILY-TRADE-OVERLAP-AUDIT`:** no deck file
exists inside this repository to edit directly (searched, none found) — if any slide of the
external deck cites the 8-of-12 (or superseded 10-of-12) DJIA-30 breadth figure as evidence of
multiple equities edges, it needs a correction pointing at this item's null result, and that
correction is out of this item's reach to make itself.

**Multiple-comparisons discipline.** Descriptive null-control study, not a hypothesis test in
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST sense (the "null" is a resampling control against
matched risk geometry, not a p-value against a theoretical distribution) — does not join that
family and triggers no BH-FDR recomputation, same precedent as `MADIP-RANDOM-ENTRY-CONTROL`.

**Engineering note.** New `scripts/equities-breadth-vs-random-entry-null.mjs` only (additive,
read-only, cache-only, no egress — reads the existing `research-cache/equities-1d/` cache, no
live IBKR Gateway call). No `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/
`trader.js`/`scanner.js` file touched — `backtest.js`'s exit-management logic and short-direction
`netAt` formula were read and replicated (same approach `MADIP-RANDOM-ENTRY-CONTROL` used for
the long-only case), not imported or modified, since the random-entry candidate path has no
natural hook into `backtestMultiTF`'s own signal-detection branches. `npm.cmd test`: 513/513
green, unchanged.

## 2026-08-29 — RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY: the geometry's positive null mean tracks buy-and-hold at r=0.90 across sub-windows — but this cache never contains a down window, so the artifact-vs-durable question stays formally untested

`MADIP-RANDOM-ENTRY-CONTROL`'s most consequential number was never `ma_dip`'s own percentile —
it was **the null's own mean**: +0.1493R on DJIA-30, +0.1637R on DJTA-20. A random long entry
carrying `ma_dip`'s exact stop/target/breakeven geometry already made money in this window before
any entry-timing rule was credited. Nobody had asked whether that is a property of the payoff
geometry (durable, would hold in any window) or of the one ~2-year holdout this project has
measured everything against (a tailwind every equities result here has been riding). This item
holds the geometry fixed and varies the window instead of the entry rule.

**Method.** New `scripts/random-entry-null-window-sensitivity.mjs` (additive, cache-only, no
egress). Geometry frozen exactly as `MADIP-RANDOM-ENTRY-CONTROL`: `{ entryMode:"ma_dip",
trendGate:false, alignMode:"none", minStopPct:0, maxStopPct:.06, tpR:5, lockBreakeven:true }`,
`backtest.js`'s MAX_HOLD=100, `strategy.js`'s BE_TRIGGER_R=2.0/BE_LOCK_R=0.2/FEE_BUFFER_PCT=0.018,
IBKR Fixed $0.005/share commission, 5bps/side slippage — all unmodified. Same two universes:
DJIA-30 (`research-cache/equities-1d/`) and DJTA-20 (`research-cache/equities-1d-djta-oos/`).

**What varies.** The predecessor built its null on each universe's 70/30-split holdout only
(~150 candles). This item uses the FULL cached history per symbol (501 candles) and splits it
into non-overlapping **calendar-year** sub-windows — chosen over equal-length blocks because both
caches, checked before any return was computed, land on the identical year structure: 2024
(91-93 candles, partial — cache starts 2024-08-20/22), 2025 (250 candles, full year), 2026
(158-160 candles, partial — cache ends 2026-08-19/21). Calendar years are also the more
interpretable unit for this question ("was 2025 the rising year that built the tailwind") than an
arbitrary equal-length boundary. Per sub-window per universe, the null is rebuilt exactly as the
predecessor's four choices: random symbol/entry-index drawn only from that sub-window's own
candles; stop distance drawn from **that cell's own** empirical stop-distance distribution (real
`ma_dip` trades re-run confined to that sub-window, not pooled across windows); exit management
replicating `backtest.js`'s generic path byte-for-byte, walking forward only within the
sub-window and force-closing at its last candle if a draw runs past the end (disclosed, not
dropped); sample size matched to that cell's own real trade count. K=2000 draws per cell,
pre-registered floor of 10 real trades below which a cell is too-thin-to-score (none were).
Buy-and-hold reported alongside per cell: equal-weighted mean, across that cell's active symbols,
of each symbol's own simple total price return over the sub-window — frictionless and unlevered,
a benchmark reference, not a traded return.

**Result — all six cells (2 universes × 3 years):**

| universe | year | real trades | real avgR | null mean | null SD | null +draws | buy-and-hold |
|---|---:|---:|---:|---:|---:|---:|---:|
| DJIA-30 | 2024 (partial) | 197 | -0.0538 | +0.0269 | 0.1631 | 57.0% | +4.39% |
| DJIA-30 | 2025 (full) | 653 | +0.2623 | +0.0905 | 0.0817 | 87.0% | +13.82% |
| DJIA-30 | 2026 (partial) | 490 | +0.1473 | +0.1553 | 0.1006 | 94.0% | +15.71% |
| DJTA-20 | 2024 (partial) | 134 | +0.1131 | +0.1107 | 0.2024 | 70.0% | +15.36% |
| DJTA-20 | 2025 (full) | 538 | +0.1730 | +0.0492 | 0.0889 | 71.5% | +11.69% |
| DJTA-20 | 2026 (partial) | 316 | +0.3360 | +0.1678 | 0.1234 | 91.6% | +18.54% |

All six cells scored (none too thin). **The null's mean is positive in every one of the six
sub-windows** — the tailwind `MADIP-RANDOM-ENTRY-CONTROL` found on the full holdout is not
concentrated in one year or one universe. But **every one of the six sub-windows also had a
positive buy-and-hold return** — this cache (2024-08 through 2026-08) never contains a falling or
flat sub-window on either universe. The Pearson correlation between a cell's null mean and that
cell's own buy-and-hold return across the six cells is **r=0.90**: the more a window was rising,
the larger the geometry's random-entry tailwind, roughly in proportion (e.g. DJIA-30 2024's
weakest buy-and-hold, +4.39%, pairs with its weakest null mean, +0.0269; DJTA-20 2026's strongest
buy-and-hold, +18.54%, pairs with its strongest null mean, +0.1678).

**Verdict, stated exactly as it falls.** Within the one regime this cache actually contains
(rising throughout, no exception), the geometry's null mean scaled closely with how strongly each
window was rising — consistent with a window/leverage effect (the geometry is levering the
market's own direction, not adding something independent of it) rather than with a geometry-only
edge that would hold regardless of the window's own direction. **But this is not a clean test of
the durable-vs-artifact question**, and saying so is this item's job as much as the correlation
number is: a genuinely flat or falling sub-window — the actual discriminating case — does not
exist anywhere in this cache. What this item shows is that the tailwind's *size* tracks the
window's *degree* of rising; it cannot show whether the tailwind would disappear or reverse in a
down window, because no down window has been observed. The reading of the whole equities chapter
that `MADIP-RANDOM-ENTRY-CONTROL` and `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL` already adopted —
treat the null's positive mean as a beta/window finding, not a geometry-only edge, until proven
otherwise — is reinforced by the r=0.90 correlation, not superseded by it; neither of those items
claimed the tailwind was window-independent, and this item does not find grounds to claim it is
window-independent either.

**Data-edge case disclosed.** 1.4%-2.8% of null draws per cell ran past their sub-window's own
last candle before any exit fired and were force-closed at the last available close — small, and,
as expected, roughly flat across cells rather than concentrated in the two partial years (a
forced closure here reflects MAX_HOLD=100 relative to a symbol's own remaining candles in the
window, not primarily the window's total length).

**No strategy, parameter or promotion proposed**, exactly per this item's own task text — a
payoff structure that pays in a rising market is a description of leverage, not an edge, and nine
months from now, if a down window enters the cache, this same script can be re-run unchanged to
finally supply the missing regime.

**Multiple-comparisons discipline.** Descriptive null-control study, not a hypothesis test in
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST sense — does not join that family and triggers no
BH-FDR recomputation, same precedent as `MADIP-RANDOM-ENTRY-CONTROL`.

**Engineering note.** New `scripts/random-entry-null-window-sensitivity.mjs` only (additive,
read-only, cache-only, no egress — reads the existing `research-cache/equities-1d/` and
`research-cache/equities-1d-djta-oos/` caches, no live IBKR Gateway call). No
`backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/`scanner.js` file
touched — `backtest.js`'s exit-management logic was read and replicated for the synthetic-entry
path exactly as `MADIP-RANDOM-ENTRY-CONTROL` did, not imported or modified. `npm.cmd test`:
513/513 green, unchanged.

---

## 2026-08-29 — DATE-CLUSTERED-RESAMPLING-DJTA20: date-clustering pushes the project's one
zero-excluding equities CI back to include zero — `ma_dip` (DJTA-20) remains a CLOSED population,
this is not a re-test of it

**Scope, stated up front.** This is not an attempt to revisit, rescue, or re-test `ma_dip` as a
candidate — it closed on `MADIP-SURVIVABILITY-CONDITION-5` (max drawdown -81.7% DJIA-30 / -74.2%
DJTA-20 at f=2%, ruin at f=5% on both) and on `MADIP-RANDOM-ENTRY-CONTROL` (53rd percentile
DJIA-30), both settled before this item ran. `ma_dip` (DJTA-20) is described throughout as a
**closed historical population**. This item exists for a forward-looking reason:
`REQUIRED-SAMPLE-FOR-DURABLE-PASS` derived its entire required-N table from this population's
nominal 300-trade count and its POSITION-blocked CI half-width, with no clustering adjustment —
that table is an input every future equities study reads, so the correction belongs on the record.
Full pre-registration text (written before any statistic below was computed):
`scripts/date-clustered-resampling-djta20.mjs`'s header, same commit as these results. Method
reused unchanged from `DATE-CLUSTERED-RESAMPLING-AUDIT` (2026-08-28) — same block-position
bootstrap for the replication check, same date-block bootstrap mechanic, same clustering
statistics, same 5000-iteration / 2.5-97.5-percentile convention — applied to a population that
audit did not cover (DJTA-20).

**Replication check, before trusting anything new.** The script reproduces
`EQUITIES-MADIP-OUT-OF-SAMPLE`'s recorded 300 trades, avgR, and the recorded position-blocked 95%
CI itself bit-for-bit off the same cached candles, confirming this is the same population already
on record:

| trades match | avgR match | position-blocked CI match |
|---|---|---|
| 300 = 300 | +0.2994 = +0.2994 | [+0.05092, +0.53498] = [+0.0509, +0.5350] |

**Clustering, pooled across all 20 DJTA symbols, side by side with DJIA-30's figures already on
record (`DATE-CLUSTERED-RESAMPLING-AUDIT`, 2026-08-28):**

| universe (`ma_dip`) | trades | distinct calendar days | largest single-day cluster | mean simultaneously-open positions | effective / nominal |
|---|---:|---:|---:|---:|---:|
| DJIA-30 (on record) | 475 | 124 | 13 | 10.47 | 26% |
| DJTA-20 (this item) | 300 | 104 | 12 | 8.19 | 35% |

DJTA-20's trades-per-day histogram: 36 days with 1 trade, 22 with 2, 15 with 3, 12 with 4, 9 with
5, 2 with 6, 3 with 7, 1 with 8, 1 with 9, 2 with 10, 1 with 12. Same shape as DJIA-30's — real
multi-symbol same-day clusters, not a uniform one-trade-per-day spread — though DJTA-20's
effective/nominal ratio (35%) is somewhat less severe than DJIA-30's (26%), consistent with a
smaller universe (20 vs 30 symbols) producing fewer same-day coincidences.

**Date-clustered 95% CI, side by side with the position-blocked interval already on record** (5000
iterations, 2.5/97.5 percentiles, date-clustered seed 20260832 — fixed before running, continuing
`DATE-CLUSTERED-RESAMPLING-AUDIT`'s 20260829-base seed numbering, not reused from it):

| CI | interval | excludes zero? |
|---|---:|---|
| position-blocked (on record) | [+0.0509, +0.5350] | **yes** |
| date-clustered (new) | [-0.0851, +0.7129] | **no** |

**This is the headline result, reported as prominently as `DATE-CLUSTERED-RESAMPLING-AUDIT`'s own
discipline requires.** `EQUITIES-MADIP-OUT-OF-SAMPLE`'s DJTA-20 result was, at the time it ran, the
first and only equities CI in this project's history to exclude zero on an out-of-sample universe
— the reason it formally cleared BH-FDR at rank 4/15 (q=0.0435). Under date-clustered resampling,
that CI's lower bound moves from +0.0509 to **-0.0851** and the interval now spans zero, the same
direction of travel `DATE-CLUSTERED-RESAMPLING-AUDIT` found for both DJIA-30 families, but here it
crosses the line that mattered: the one result this project had that didn't merely fail to exclude
zero, but positively excluded it, no longer does under the more conservative resampling scheme.
This does not reopen `ma_dip` as a candidate — conditions 3 and 5 already closed it independently
of any CI — but it does mean the BH-FDR survival recorded for `EQUITIES-MADIP-OUT-OF-SAMPLE` was
computed from a sign-flip permutation p-value untouched by this finding (that p is not recomputed
here, and this item does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family or trigger
BH-FDR recomputation, per its own pre-registration), not from the block-bootstrap CI — the two are
different statistics and this item only speaks to the latter.

**`REQUIRED-SAMPLE-FOR-DURABLE-PASS` restatement.** That item derived a per-trade SD from the
position-blocked CI half-width purely as a disclosed, explicitly-NOT-used-for-required-N
diagnostic (its own Step 2: "do NOT reuse that normal-approximated SD directly... calibrate
instead off the empirically observed p=0.0116"). Recomputing that same diagnostic with the
date-clustered half-width:

| | position-blocked (on record) | date-clustered (new) | movement |
|---|---:|---:|---:|
| CI half-width (avg) | 0.2421 | 0.3990 | 1.65x wider |
| derived per-trade SD | 2.1390 | 3.5260 | **1.65x** |
| implied effect size (d = mean/SD) | 0.1400 | 0.0849 | 0.61x |

**The PRIMARY required-N table does not move.** `REQUIRED-SAMPLE-FOR-DURABLE-PASS`'s actual
required-N formula (Step 3/5) calibrates its z-score off the *observed sign-flip p-value*
(z=2.2701 from p=0.0116), not off the CI-derived SD — by that item's own explicit design, because
a block-bootstrap permutation p is not exactly normal. This item does not recompute a new p-value,
so nothing mechanically changes there: required N at the population's actual current standing
(rank 4, family size m=20) remains **316**, exactly as `REQUIRED-SAMPLE-FOR-DURABLE-PASS` computed
it. This is stated explicitly as a reported non-move, not a silent omission.

**Where the half-width swap DOES move something: the disclosed "sanity check, NOT used" path.**
`REQUIRED-SAMPLE-FOR-DURABLE-PASS`'s own Step 2 also computed a second z (`zFromSDAlone`,
`(mean/SD)*sqrt(n)`) purely as a disclosed cross-check it explicitly declined to use. Recomputing
*that* path's required-N with the date-clustered SD in place of the position-blocked one is the one
place a CI half-width change can mechanically reach the required-N formula:

| | position-blocked SD | date-clustered SD | movement |
|---|---:|---:|---:|
| `zFromSDAlone` | 2.4244 | 1.4707 | 0.61x |
| required N (rank 4, m=20), SD-alone path | 277 | 751 | **2.71x** |

This SD-alone path was never the one `REQUIRED-SAMPLE-FOR-DURABLE-PASS` actually used for planning
(the p-calibrated 316 is), so this is not a correction to that item's headline number — it is a
disclosure that the gap between the two calibration approaches (already flagged as "expected,
disclosed, not corrected for" in the original item) widens substantially under the more
conservative clustering-aware interval, which is itself informative about how much the
normal-approximation shortcut would have understated future sample needs had it been used instead
of the p-calibrated approach.

**`MULTIPLE_COMPARISONS_AUDIT.md` not touched** — no new p-value computed anywhere in this script,
consistent with `DATE-CLUSTERED-RESAMPLING-AUDIT`'s own precedent for the CI-only resampling
check.

**Engineering note.** New: `scripts/date-clustered-resampling-djta20.mjs` (read-only, cache-only —
does not import `brokers/ibkr.mjs`). Reuses `backtest.js`'s existing `excursions[].entryTime` field
(added by `DATE-CLUSTERED-RESAMPLING-AUDIT`, unmodified here) and `momentum.mjs`'s
`blockBootstrapCI` unmodified. No `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/
`bot.js`/`trader.js`/`scanner.js` file touched. `npm.cmd test`: 513/513 green, unchanged.


## 2026-08-29 — C3-FX-CARRY-DATA-GATE: price-side code capability confirmed sufficient, rate-side series named but unverified, account-side entitlement an open question for the human — not a pass, not a fail

Phase-directive step 7 allows C3 (FX carry — the interest-rate differential between two
currencies) to be considered "only after C0-C2 are resolved (pass, fail, or gated-unavailable)".
All three now are: `C0-SIGNAL-COMBINATION` KILLED (permutation p=0.4708, composite worse than both
inputs), `C1-VRP-DATA-AVAILABILITY-GATE` gated-unavailable on account entitlement,
`C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES` resolved null (Spearman rho -0.0980, nominal p<0.05,
does not survive family-wide BH-FDR). This item follows `C1-VRP-DATA-AVAILABILITY-GATE`'s own
gate pattern exactly — separate what static analysis can settle from what only the human can, and
state the second as a question list rather than guessing. This run again had no egress and IB
Gateway last returned ECONNREFUSED at 127.0.0.1:4002, an acceptable outcome for a gate, per the
directive.

**Part A (price-side code capability) — resolved, from static analysis only, no network call
made.** New `scripts/c3-fx-carry-data-gate.mjs` (additive, read-only: reads `brokers/ibkr.mjs` and
the installed `@stoqey/ib` package's own TypeScript declarations, makes zero network calls,
modifies nothing). Two sub-findings:

- **`brokers/ibkr.mjs` carries no FX/CASH contract path today**, re-confirmed directly against this
  file rather than assumed: every contract built anywhere in the file is still
  `new Stock(symbol, "SMART", "USD")` (`stockContract()` at line 104); no `Forex`, `SecType.CASH`,
  `"CASH"`, or `IDEALPRO` identifier appears anywhere in it — the same shape of finding
  `C1-VRP-DATA-AVAILABILITY-GATE` recorded for options.
- **The installed `@stoqey/ib` dependency (already in use, no new package needed) already exposes
  what a currency-pair price study needs**, verified against
  `node_modules/@stoqey/ib/dist/api/**/*.d.ts` directly: a `Forex` contract class
  (`api/contract/forex.d.ts`, `new Forex(symbol, currency)`, `secType = CASH`, hardcodes
  `exchange = "IDEALPRO"` itself so a caller cannot route to a different FX venue with this class),
  and `reqHistoricalData`'s signature is generic over any `Contract` — the same call
  `fetchOHLC()` already uses, only the contract argument and `whatToShow` would differ.
  `WhatToShow`'s enum includes `MIDPOINT`/`BID`/`ASK`/`BID_ASK` alongside `TRADES`; the
  declarations do not type-restrict `whatToShow` per contract `secType` (TWS enforces valid
  combos server-side), so IBKR's documented FX behavior (spot FX is OTC/dealer, historical bars
  use MIDPOINT/BID/ASK rather than TRADES) is reported as expected-but-not-package-verified —
  stated as a distinct claim from what the `.d.ts` itself asserts, per this project's discipline
  against overclaiming from docs memory.

**Mapped to existing equities-side analogues:** the price side is a small change — one new
contract-builder analogous to `stockContract()`, and `fetchOHLC()`'s existing
request/promise/event-listener/cleanup pattern (including its already-handled daily-bar
`"YYYYMMDD"` decoder quirk) applies unchanged, only the contract class and `whatToShow` value
differ. This is same-day-to-small, comparable to `C0`'s rank-average — **not** a multi-day build
like `C1`'s options chain/greeks path. The price-side code gate does **not** fail.

**Part B (the carry signal's non-price data requirement) — the harder half, and NOT a code
question.** FX carry's return driver is the interest-rate differential between the two
currencies in a pair (long the higher-yielding currency, short the lower-yielding one), which
needs a short-term policy/money-market rate **per currency**, not just pair price history.
`EXOGENOUS-DATA-ACCESS-AUDIT` is cited rather than re-probed, per this item's own scoping note:
that audit confirmed FRED's public CSV export endpoint
(`fred.stlouisfed.org/graph/fredgraph.csv?id=<seriesId>`) is free and key-less for three series it
actually fetched — `DGS10`, `DTWEXBGS`, `FEDFUNDS` — **all three USD-side**. It did not test any
non-USD series, so this item cannot claim the same access pattern is confirmed for non-USD rates
without a fresh fetch, which this task's own no-network-access constraint forbade in this pass.
Candidate series named, explicitly split into confirmed vs. unverified:

| Currency | Series | Status |
|---|---|---|
| USD | `FEDFUNDS` | **CONFIRMED reachable** — already fetched by `EXOGENOUS-DATA-ACCESS-AUDIT`, reused by `C2`'s DGS10-DGS2 sourcing |
| EUR | `IR3TIB01EZM156N` (OECD MEI 3-month interbank, Euro area); alt: `ECBDFR` | UNVERIFIED — named from FRED's known OECD-MEI naming convention, not fetched |
| GBP | `IR3TIB01GBM156N`; alt: `IUDSOIA` (SONIA) | UNVERIFIED — not fetched |
| JPY | `IR3TIB01JPM156N` | UNVERIFIED — not fetched |
| CAD | `IR3TIB01CAM156N` | UNVERIFIED — not fetched |
| AUD | `IR3TIB01AUM156N` | UNVERIFIED — not fetched |
| CHF | `IR3TIB01CHM156N` | UNVERIFIED — not fetched |

The non-USD IDs follow FRED's documented OECD-MEI series-ID convention
(`IR3TIB01<ISO2>M156N`) from general knowledge of FRED's catalog structure, **not** from a fetch
this session — reported as an open item, not a confirmed fact, the same discipline
`EXOGENOUS-DATA-ACCESS-AUDIT`'s own header states ("never generalized... a container 403 was
nearly recorded as a fact about an upstream API once already"). Before any FX carry code is
written, each candidate ID needs one real fetch against the same free, key-less CSV pattern
already proven for the USD series, to confirm it exists and check its actual history depth and
publication lag.

**Part C (account-side entitlement) — not answerable from this session, stated as a question list
rather than guessed.** Whether IDEALPRO FX quote data is bundled or needs a separate subscription,
whether historical FX bars (`whatToShow=MIDPOINT`/`BID`/`ASK`) actually return for this account
and how far back, and whether the non-USD FRED series named above actually resolve, are all
recorded in the script's output as a three-item question list, presented alongside `C1`'s
still-open options-entitlement question list so both can be handled in one IBKR-settings sitting.

**No strategy or backtest code written, no return computed, no proxy substituted, `brokers/ibkr.mjs`
unmodified (confirmed via `git status`/`git diff` before commit), no network access attempted.**
`npm.cmd test`: 513/513 green, unchanged (this diagnostic adds no new tests, same convention as
`C1`/`C2` and every other throwaway `scripts/*.mjs` audit in this project). Raw output saved via
`saveExperiment` to `research-runs/2026-08-29T16-03-54-933Z-c3-fx-carry-data-gate.json`.

**Engineering note.** New: `scripts/c3-fx-carry-data-gate.mjs` (additive, read-only). Reads
`brokers/ibkr.mjs` and `node_modules/@stoqey/ib/dist/api/**/*.d.ts`/`.js` only. No
`backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/`scanner.js` file
touched; `brokers/ibkr.mjs` read-only. `npm.cmd test`: 513/513 green, unchanged.

---

## 2026-08-29 — GEOMETRY-NULL-DOWN-WINDOW-PROBE: a genuinely down/flat window was found (equities and crypto both) — the geometry's positive null mean does NOT survive it, confirming the window-artifact reading

`RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY` left the project's biggest open equities question
formally untested: its cache (2024-08 through 2026-08) never contained a down or flat sub-window
on either equity universe, so whether `ma_dip`'s matched-geometry null's positive mean
(+0.1493R DJIA-30, +0.1637R DJTA-20, both rising-window holdouts) is a durable property of the
payoff geometry (structural stop, tpR=5, breakeven lock) or an artifact of measuring only in a
rising market was left an open question, not a finding. This item is the single measurement that
resolves it.

**Pre-registration (fixed before any return was computed).** Qualifying criterion: a sub-window
counts as "genuinely down or flat" if it spans **>=60 calendar days** and its equal-weighted mean
buy-and-hold return (last close / first close - 1, frictionless, same convention as the
predecessor) is **<=0.00**. Segmentation: calendar **quarters and years**, UTC, a mechanical
partition of every cell with at least one candle — not a hand-picked drawdown window, which this
item's own task text explicitly prohibited. Universes surveyed, cache-only, no egress: DJIA-30
(`research-cache/equities-1d/`), DJTA-20 (`research-cache/equities-1d-djta-oos/`), and — new to
this item — **CRYPTO-28**, every pair with a CSV under `candles/` (29 files found; all 29 had
enough history to appear in at least one surveyed cell), resampled to daily via `data.js`'s own `loadCandles`
resampler (the same one `researchlab.mjs` and the live bot already use — no new candle-reading
logic written). New `scripts/geometry-null-down-window-probe.mjs` (additive, cache-only).

**Full survey: 43 cells (12 DJIA-30 + 12 DJTA-20 + 19 CRYPTO-28).** DJIA-30 never qualified — every
one of its 12 quarter/year cells had a positive buy-and-hold return (this universe's cache is
rising throughout, confirming the predecessor's finding at finer-than-year granularity). DJTA-20
qualified twice (2025-Q1, 2025-Q3, out of 12). CRYPTO-28 — the only cache with meaningfully
deeper history (2023-01 through the store's own last bar) — qualified 9 of 19 cells. All 43 cells,
qualifying or not, are in the saved JSON in full, per this item's own task text.

**Where a window qualified, the matched-geometry null was rebuilt there, unchanged**
(`MADIP-RANDOM-ENTRY-CONTROL`'s four-part construction reused verbatim per cell: real `ma_dip`
trades re-run confined to that window; stop distance drawn with replacement from that window's
own empirical stop distribution; exit management replicating `backtest.js`'s generic path
byte-for-byte; sample size matched to that cell's own real trade count; K=2000 draws; MIN
10-real-trade floor, same as the predecessor — no qualifying cell was too thin).

| universe | window | real trades | real avgR | null mean | null SD | buy-and-hold |
|---|---|---:|---:|---:|---:|---:|
| DJTA-20 | 2025-Q1 | 155 | -0.2742 | **-0.1741** | 0.1459 | -8.64% |
| DJTA-20 | 2025-Q3 | 113 | -0.0869 | **-0.0632** | 0.1945 | -0.21% |
| CRYPTO-28 | 2023-Q2 | 241 | -1.5085 | -1.4622 | 0.1503 | -12.92% |
| CRYPTO-28 | 2023-Q3 | 216 | -2.0202 | -1.7460 | 0.1703 | -14.35% |
| CRYPTO-28 | 2024-Q2 | 253 | -2.8965 | -3.0658 | 0.2977 | -34.08% |
| CRYPTO-28 | 2025-Q1 | 443 | -1.5003 | -1.5656 | 0.1287 | -36.94% |
| CRYPTO-28 | 2025-Q4 | 452 | -1.1920 | -1.5114 | 0.1008 | -28.45% |
| CRYPTO-28 | 2026-Q1 | 494 | -1.5270 | -1.4461 | 0.1030 | -27.74% |
| CRYPTO-28 | 2026-Q2 | 33 | -1.2994 | -1.2376 | 0.2977 | -16.69% |
| CRYPTO-28 | 2025 (year) | 1750 | -1.3755 | -1.4680 | 0.0687 | -11.21% |
| CRYPTO-28 | 2026 (year) | 541 | -1.5065 | -1.4434 | 0.0971 | -28.39% |

**Headline, on the reliable (equities) evidence: the geometry's null mean turns NON-POSITIVE in
both genuinely down/flat windows found.** DJTA-20 2025-Q1 and 2025-Q3 — same fee basis
(IBKR Fixed $0.005/share commission) `MADIP-RANDOM-ENTRY-CONTROL` and the predecessor already
validated, so these two numbers are directly comparable to the +0.1493/+0.1637 rising-window
means on record — both come in negative. This is the discriminating case the predecessor
couldn't reach: **the tailwind does not survive a down window on the same universe and fee
basis where it was originally found positive.** That confirms, rather than merely suggests, the
window-artifact reading `RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY`'s r=0.90 correlation already
pointed toward.

**CRYPTO-28 corroborates directionally, but its magnitudes are a disclosed cost-model artifact,
not a second clean data point.** Every one of the 9 qualifying crypto cells shows a strongly
negative null mean — directionally consistent with the equities result. But the actual numbers
(nullMean as low as -3.07, worst single trade -17.99R) are not economically meaningful: `ma_dip`'s
structural stop runs tight on this universe (median stop distance ~1.6% in the cells checked)
while this script prices crypto trades at `strategy.js`'s own flat `FEE_RATE=0.008`/side (matching
`cost-model.mjs`'s `SPOT_FEE_SCHEDULE.taker` — the project's real crypto cost assumption, not
invented for this item) — roughly 500x the equities' per-share commission expressed as a
fraction of price. `backtest.js`'s R-normalization formula divides fee cost by risk-in-price-terms,
which was fine when fee cost was negligible next to any realistic equity stop distance but blows
up at crypto's combination of a proportionally large fee and a tight stop: a single stopped-out
trade's R can land many multiples below the -1 a stop is supposed to represent. The **sign** of
the crypto result (strongly negative in every down/flat quarter, versus positive in every rising
year on record) is informative; the **size** of that negative number is not, and this write-up
does not cite it as comparable to the equities figures or to the +0.1493/+0.1637 rising-window
means. This mismatch is a property of reusing an equities-calibrated cost formula on a new asset
class, not a bug in this item's construction — flagged here rather than quietly left in the
numbers, and not something this item's scope extends to fixing (that would be a new cost-model
item, not a probe).

**Correction (2026-08-29, `CRYPTO-R-NORMALIZATION-DEFECT-OR-ECONOMICS`) — the "cost-model
artifact" framing two paragraphs above is wrong. The magnitudes are correct economics, not a
defect in `backtest.js`'s formula.** That item was staged specifically to check this framing
before letting it stand, and found it does not hold up.

**Derivation.** For an `ma_dip` long stopped out, gross R is exactly −1 by construction
(`stop = entry − risk`). `backtest.js` computes `netR = (stop−entry)/risk − (feeRate+slipPct)*
(entry+stop)/risk = −1 − (feeRate+slipPct)*(entry+stop)/risk`. Writing `stopPct = risk/entry`,
`entry+stop = entry*(2−stopPct)` and `risk = entry*stopPct`, so the cost term reduces to
`(feeRate+slipPct)*(2−stopPct)/stopPct` — for `stopPct << 1`, approximately
`2*(feeRate+slipPct)/stopPct`. At crypto's `feeRate+slipPct = 0.0085` (`strategy.js`
`FEE_RATE=0.008` + `SLIPPAGE_PCT=0.0005`) and this probe's own reported median stop distance in
the qualifying cells (1.6%–2.4%, e.g. `stopPct=0.018`): cost term ≈ `0.0085*1.982/0.018 ≈ 0.936`,
i.e. a *typical* stopped-out trade here nets ≈ **−1.94R** — in line with the ≈1R-of-cost estimate
this follow-up's own task text sketched, and nowhere near −18R. The −17.99R extreme this section
cites (`feeModelSanity.minRealR`, recurring across several qualifying cells in the saved run) is
the *same formula* evaluated at a near-zero-risk stop: solving `−1 − 0.0085*(2−stopPct)/stopPct =
−17.9915` gives `stopPct ≈ 0.001` (a 10bp structural stop). That trade is real, not a computation
error — it is what this study's own `CONFIG` (`minStopPct: 0`, matching
`per-family-cost-ceiling.mjs` L57 byte-for-byte) permits through; live trading's
`MIN_STOP_PCT=0.015` (`strategy.js` L48) would filter it out entirely. Dividing a cost that is
roughly proportional to price by a risk that can shrink toward zero is unboundedly sensitive to
stop distance by construction — true for any asset class or fee schedule, not a crypto-specific
defect; crypto's larger flat fee just needs a far less extreme stop to make the effect visible.

**Reconciliation with `PER-FAMILY-COST-CEILING`'s `k=615.69`.** That item's `k` is defined as
`(feeDragAvgR+slipDragAvgR)/(FEE_RATE+SLIPPAGE_PCT)` — exactly the same per-trade coefficient
`(entry+exitPx)/risk` derived above, averaged over `ma_dip`'s full 9894-trade crypto holdout
rather than evaluated at one stop distance. Direct check, reproducing its own published table to
4 decimals: spot-taker `netAvgR = 0.0877 − 615.69*0.0085 = −5.1457`; spot-maker (slip=0, maker fee
`cost-model.mjs`'s `SPOT_FEE_SCHEDULE.maker=0.0040`) `netAvgR = 0.0877 − 615.69*0.0040 = −2.3751`
— both match exactly. Both items therefore describe the identical arithmetic, on the identical
`ma_dip`-on-crypto config, from two angles: `PER-FAMILY-COST-CEILING` reports the population
average (pulled up by exactly this tiny-stop tail) with no artifact caveat, and is the correct
characterization; the artifact framing above, describing one extreme individual draw from the
same distribution, is the one that needed correcting.

**Is net R below −1 for a stopped-out trade expected?** Yes. A stop caps only the *gross* loss at
exactly −1R; round-trip cost is charged on top of that in price terms, and is reported here in
risk terms by dividing by the same risk denominator used for the gross P&L. Any trade whose fixed
round-trip price cost is large relative to its risk — a tight stop, a high fee rate, or both —
will show net R below −1 by construction of that ratio, not by error.

**Verdict: CORRECT ECONOMICS.** This correcting annotation stands in place of the "cost-model
artifact, not a second clean data point" framing above; the **sign**-based conclusion this
section draws from it (crypto null means strongly negative in every genuinely down/flat quarter,
corroborating the equities window-artifact finding) is unaffected and stands unchanged — it never
depended on the magnitudes either way. Full derivation, cross-checks, and the reconciliation
against `PER-FAMILY-COST-CEILING` recorded in `CRYPTO-R-NORMALIZATION-DEFECT-OR-ECONOMICS`
(2026-08-29, this file, filed separately below). No figure in this section changed; no code
touched; `backtest.js`, `strategy.js`, and every frozen path read-only throughout this check.

**Verdict, stated exactly as it falls.** The single measurement `RANDOM-ENTRY-NULL-WINDOW-
SENSITIVITY` said would resolve the project's biggest open equities question has now been run:
a genuinely down/flat window exists (DJTA-20, twice) and in it the geometry's null mean is
negative, not positive. The six rising-window null means this project has on record —
`MADIP-RANDOM-ENTRY-CONTROL`'s two plus the predecessor's six calendar-year cells — were a window
artifact (leverage on the window's own direction), not a durable property of the payoff geometry.
This closes the artifact-vs-durable question the predecessor left open; it does not reopen
`ma_dip`'s own already-settled percentile result (`MADIP-RANDOM-ENTRY-CONTROL`'s separate
question, unaffected).

**Why this is not caught by D1.** D1 closes new price-structure entry variants, gate inputs and
cost angles on the twelve sealed families. This item proposes none of those — no entry rule, no
gate, no cost angle — and touches no family; it is a methodology control on which historical
windows this project's own caches happen to contain, underlying an existing null-control study,
not a candidate mechanism competing for D1 slots.

**No entry rule proposed or tested beyond `ma_dip` itself (already sealed, unchanged). No
parameter re-tuned. `SEALED_SYMBOLS` untouched.** Descriptive null-control study, not a hypothesis
test in `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST sense, same precedent as
`MADIP-RANDOM-ENTRY-CONTROL` — does not join that family, triggers no BH-FDR recomputation.
`npm.cmd test`: 513/513 green, unchanged. Raw output (full 43-cell survey plus every qualifying
cell's null draws) saved via `saveExperiment` to
`research-runs/2026-08-29T17-11-33-610Z-geometry-null-down-window-probe.json`.

**Engineering note.** New `scripts/geometry-null-down-window-probe.mjs` only (additive,
read-only, cache-only, no egress of any kind — reads the existing equities JSON caches and the
local `candles/*.csv` crypto store via `data.js`'s own `loadCandles`, no live IBKR or Kraken API
call). No `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/
`scanner.js` file touched — `backtest.js`'s exit-management logic was read and replicated for the
synthetic-entry path exactly as `MADIP-RANDOM-ENTRY-CONTROL`/`RANDOM-ENTRY-NULL-WINDOW-
SENSITIVITY` did, not imported or modified. `npm.cmd test`: 513/513 green, unchanged.

## 2026-08-29 — VERDICTS-COST-CONSTANT-STALENESS-SWEEP: generalizing CLASSIFIER-P5-ECONOMICS-ROW-STALENESS — every figure carrying the same double-count identified, corrected where recoverable, flagged where not

BOOKKEEPING/INTEGRITY, not research — D1 does not apply, per `CLASSIFIER-P5-ECONOMICS-ROW-
STALENESS`'s own precedent (a correction to how an already-computed number was composed and
reported, no new entry rule, gate, or cost angle proposed on any family). That item fixed
Classifier P5's VERDICTS.md row and explicitly generalized, in its own write-up, that the same
`netR`-plus-`roundTripCost` double-count was very likely present elsewhere and left the
generalization as a follow-up rather than expanding its own scope. This item is that follow-up.

**Method.** Started from the mechanism, not a guess: every call site of `classifier.mjs`'s
`economicLiftNetOfCost` (`grep -rn "economicLiftNetOfCost"`) and every other place performing the
same `mean(netR) − cost` arithmetic by hand on classifier-derived rows was enumerated, then each
candidate's rows were traced back to confirm whether they originate from `backtest.js`'s
`profileEntries` (whose `netR` already bakes in `strategy.js`'s `FEE_RATE`/`SLIPPAGE_PCT` at
simulation time — the fact `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` established) or from a
genuinely different, already-correctly-composed cost model (`momentum.mjs`'s
`economicMomentumViews`, which subtracts `roundTripCost × turnover` from **gross** `fwdR`, never
from a cost-inclusive field, and `portfolio.mjs`'s `simulatePortfolio`, which takes a `costRate`
applied to its own real equity-curve simulation, not to a pre-costed return field).

**Full call-site inventory and classification:**

| # | Candidate (file / figure) | Path | Classification |
|---|---|---|---|
| 1 | `classifier.mjs` L481-495, `economicLiftNetOfCost` itself | defines `mean(row.netR) − roundTripCost` | **NOT-DERIVED-THROUGH-THAT-PATH** — the function's own unit test (`classifier.test.mjs`) exercises it correctly and is not a published economics figure; the bug is call-site misuse, not the function |
| 2 | VERDICTS.md `Classifier P5` row (`classifier.mjs`'s `sealed` CLI, L592-604) | `economicLiftNetOfCost` on `profileEntries`-sourced `netR`, `roundTripCost=0.009` | **AFFECTED — already corrected** by `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` (2026-08-29) to selected -0.8544 / baseline -0.8989 / lift +0.0445 (`roundTripCost=0`). No further action needed here |
| 3 | VERDICTS.md `CLASSIFIER-FUNDING-FEATURE` row (`classifier.mjs`'s `sealed-funding` CLI, L650-659) | `economicLiftNetOfCost` on `profileEntries`-sourced `netR`, `roundTripCost∈{0.009,0.017}` | **AFFECTED — corrected in this item.** See derivation below |
| 4 | `scripts/c0-signal-combination.mjs` L185, `p5ReproLegacy` (historical 16-symbol reproduction) | `economicLiftNetOfCost` on `profileEntries`-sourced `netR` | **AFFECTED**, but this is a read-only reproduction check (its own reported `-0.8634R`/`-0.9079R` is not independently republished as a VERDICTS.md figure — it exists to confirm C0's diagnosis, which `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` already did independently). No VERDICTS.md text quotes this specific number, so nothing to edit; noted for completeness |
| 5 | `scripts/c0-signal-combination.mjs` L216-217, `p5MatchedLegacy`/`p5MatchedReal` (matched 13-symbol standalone baseline) | `economicLiftNetOfCost` on `profileEntries`-sourced `netR` | **AFFECTED.** `p5MatchedReal.selectedNet=-0.8554` is quoted directly in VERDICTS.md's `C0-SIGNAL-COMBINATION` row — corrected in this item |
| 6 | `scripts/c0-signal-combination.mjs` L267-270, `compositeLegacy`/`compositeReal` (composite selected/baseline net) | hand-written `selectedGrossMean − COSTS.legacy/.real` on `profileEntries`-sourced `netR` (same arithmetic as `economicLiftNetOfCost`, not routed through the named function) | **AFFECTED.** Quoted in VERDICTS.md's `C0-SIGNAL-COMBINATION` row as "Net of real 0.017 cost: composite selected -0.9344, composite baseline -0.9376" — corrected in this item |
| 7 | `scripts/c0-signal-combination.mjs` L267-268, `selectedGrossMean`/`baselineGrossMean` ("gross mean netR") | raw `mean(row.netR)`, no cost subtracted at all | **UNAFFECTED-BY-CANCELLATION — trivially, since no cost is applied here.** Mislabeled ("gross") rather than miscomputed: `netR` already contains the real cost, so this figure IS the correct single-counted net-of-real-cost reading, just under the wrong name. Confirmed and relabeled in VERDICTS.md's corrected annotation |
| 8 | `scripts/c0-signal-combination.mjs` L300-303, block-bootstrap CI on `t.netR − COSTS.real` | same hand-written pattern as #6, cost subtracted before bootstrapping | **AFFECTED.** A uniform per-element shift of a constant shifts every bootstrap resample's mean, and hence both CI bounds, by exactly that constant — corrected by algebraic shift, not re-simulated, in this item |
| 9 | `scripts/c0-signal-combination.mjs` STEP 6, permutation test (`netRs`, `selectedGrossMean` vs. `nullMean`) | relative comparison of two means on the same population, no cost term anywhere in the computation | **NOT-DERIVED-THROUGH-THAT-PATH.** `p=0.4708` does not depend on any cost constant and is untouched |
| 10 | `scripts/c0-signal-combination.mjs` `gate.beatsB5` / B5-REVERSAL figures (`b5MatchedLegacy`/`b5MatchedReal`) | `momentum.mjs`'s `economicMomentumViews`, gross `fwdR` minus `roundTripCost × turnover` | **NOT-DERIVED-THROUGH-THAT-PATH.** Different mechanism entirely — `fwdR` is a genuine gross return, never cost-inclusive before this subtraction, so no double-count is possible here |
| 11 | ROADMAP_ARCHIVE.md `PHASE2-MAX-SURVIVABLE-COST` table, Classifier P5 row (`scripts/phase2-triage.mjs`) | affine-recovers `mean(netR)` from P5's *originally-published* (double-counted) figure, then subtracts a new per-venue scenario cost on top | **AFFECTED**, and not cleanly recomputable from cache (see below) — flagged **SUPERSEDED-PENDING-RECORRECTION** in this item, not guessed |
| 12 | ROADMAP_ARCHIVE.md `PHASE2-MAX-SURVIVABLE-COST` table, CLASSIFIER-FUNDING-FEATURE row (`scripts/phase2-triage.mjs`) | same as #11, sourced from CLASSIFIER-FUNDING-FEATURE's original figure | **AFFECTED**, same treatment as #11 |
| 13 | ROADMAP_ARCHIVE.md `PHASE2-MAX-SURVIVABLE-COST` table, B5-REVERSAL rows | `momentum.mjs`'s turnover-scaled cost model, re-derived from two real reported points (not an assumption) per that item's own text | **NOT-DERIVED-THROUGH-THAT-PATH** |
| 14 | ROADMAP_ARCHIVE.md `PHASE2-MAX-SURVIVABLE-COST` table, T4-PORTFOLIO-MOMENTUM row | `portfolio.mjs`'s `simulatePortfolio`, real equity-curve simulation with its own `costRate` parameter, not applied to a pre-costed field | **NOT-DERIVED-THROUGH-THAT-PATH** (this row has a separate, already-documented staleness issue — `costRate` default never updated by `FEE-SCHEDULE-REBASE` — unrelated to this bug and already flagged in that item's own text) |
| 15 | `scripts/phase3-b5-reversal-rerun.mjs` | grep confirms no `economicLiftNetOfCost`/`classifierOutcomeReport` call | **NOT-DERIVED-THROUGH-THAT-PATH** |
| 16 | `classifier.test.mjs`'s `economicLiftNetOfCost` calls | unit tests, not published figures | **NOT-DERIVED-THROUGH-THAT-PATH** — out of scope by definition (tests, not VERDICTS.md/ROADMAP.md figures) |

Row #4's absence from any "corrected" list above is itself a recorded finding, not an oversight:
it is a diagnostic reproduction check whose number was never independently republished as a
result, so there is nothing in VERDICTS.md or ROADMAP.md to correct for it.

**#3 — CLASSIFIER-FUNDING-FEATURE, corrected by fresh re-run (not algebraic recovery).**
`CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` already established why this row cannot be fixed by the
affine-recovery trick that worked for P5: this row's commit (b4dbe7e, 2026-08-08 14:06:56 -0400)
predates `FEE-DEFAULTS-UPDATE` (44777de, 14:22:28 -0400) by ~16 minutes, so its `netR` was computed
under the *stale* pre-rebase `FEE_RATE=0.004`, not today's `0.008`. Recovering `mean(netR)`
algebraically from the published figures would recover the *stale-cost* mean, not a figure usable
today. Fixed instead with a genuinely fresh computation: a throwaway script (not committed, cache-
only, `refresh:false` on `loadBtcFundingPoints` so no network egress — the funding cache already
exists on disk for every symbol) called `classifier.mjs`'s existing exported
`buildClassifierUniverseRows`, `scaleTrainHoldout`, `chooseLambdaByCv`, and `classifierOutcomeReport`
exactly as the `sealed-funding` CLI path does internally (classifier.mjs L629-660), with
`roundTripCost=0` since `netR` now bakes in current `strategy.js` constants (`FEE_RATE=0.008`,
`SLIPPAGE_PCT=0.0005`, unchanged since the P5 correction — confirmed by reading `strategy.js`
directly before trusting this). Row counts reproduce exactly: 15076 total, 3969 funding-covered,
1806 train / 2163 primary holdout — identical to the original published run, ruling out any data
or universe drift. Holdout AUC reproduces to the 10th decimal (0.5942703778017869, matches the
published 0.5943), confirming the classification pipeline and split are byte-identical and only
the economics computation changed. Corrected economics at `roundTripCost=0`: **selected
-0.6351341241179890R, baseline -0.9252883722037536R, lift +0.2901542480857646R** (-0.6351/-0.9253/
+0.2902 rounded) — a materially different number from both the original -0.2412/-0.2492 and from a
naive double-counted-at-current-constants figure, exactly as expected for a fresh re-run rather
than an algebraic patch. VERDICTS.md's row corrected accordingly.

**#5/#6/#7/#8 — C0-SIGNAL-COMBINATION, corrected by algebraic recovery from the saved run.**
Unlike CLASSIFIER-FUNDING-FEATURE, this study ran on 2026-08-29 under today's `strategy.js`
constants (same day as this correction, confirmed unchanged), so the affine-recovery method is
exactly as valid here as it was for Classifier P5. Recovered directly from the saved experiment
(`research-runs/2026-08-29T08-17-23-191Z-c0-signal-combination.json`), not re-run:

  - Matched-population Classifier P5 (`p5MatchedLegacy`/`p5MatchedReal`): `selectedNet` at
    `roundTripCost=0.009` is -0.8473999690694210, at `0.017` is -0.8553999690694173 (published as
    "-0.8554" in VERDICTS.md's `C0-SIGNAL-COMBINATION` row). `mean(netR) = -0.8474+0.009 =
    -0.8384` and, cross-checked, `-0.8554+0.017 = -0.8384` — consistent to the 10th digit. This
    also nearly exactly reproduces `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS`'s own corrected
    historical-16-symbol figure (-0.8544), as expected for a 13-symbol subset of the same 16-symbol
    holdout population with the same model.
  - Composite (`compositeLegacy`/`compositeReal`): `selectedGrossMean=-0.9174087484075228`,
    `baselineGrossMean=-0.9206202708953056` are, by the same logic, already the correct
    single-counted figures (`roundTripCost=0` applied to nothing, since no cost was subtracted to
    produce them) — confirming what `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` had already flagged as
    likely. `compositeReal.selectedNet=-0.9344087484075229` recovers to
    `mean=-0.9344+0.017=-0.9174`, matching `selectedGrossMean` exactly.
  - Block-bootstrap CI: built from `t.netR − 0.017` per element (`c0-signal-combination.mjs`
    L300), so every element — and therefore both bootstrap quantiles — shifts by the same +0.017
    once the extra subtraction is removed: `[-1.0828, -0.7670] → [-1.0658, -0.7500]`.

  None of this changes `C0-SIGNAL-COMBINATION`'s **KILLED** verdict or any individual gate clause's
  truth value, re-verified directly on the corrected numbers rather than assumed from the bug's
  general shape: `positiveAtRealCost` (`-0.9174 > 0`) is still false by a wide margin; `beatsP5`
  (`-0.9174 > -0.8384`) is still false (the composite is still more negative than standalone P5);
  `beatsB5` (`-0.9174 > -0.0153` and `-0.9174 > -0.0123`) is still false, not close; the
  permutation p-value (0.4708) never touched a cost constant and is untouched; the CI still
  excludes positive entirely either way. VERDICTS.md's row corrected with a full annotation
  pointing at this derivation.

**#11/#12 — PHASE2-MAX-SURVIVABLE-COST's two classifier rows: flagged, not corrected.** Both
carry the same double-count, but fixing them properly is not an arithmetic correction: PHASE1/
PHASE2's venue scenarios (spot/futures × maker/taker) represent genuinely different `feeRate`/
`slipPct` assumptions that would need `profileEntries` re-run per venue with those rates baked in
at simulation time — the affine-recovery-then-resubtract shortcut `phase2-triage.mjs` used only
works when the base figure has zero cost baked in, which is exactly the false assumption that
caused this whole bug family. That is new computation (a fresh sealed-style backtest per venue),
outside this item's bookkeeping scope and `done_when`. Marked **SUPERSEDED-PENDING-RECORRECTION**
in ROADMAP_ARCHIVE.md's `PHASE2-MAX-SURVIVABLE-COST` section with the reasoning above, rather than guessed
or silently left implying a false precision. The qualitative "structural, not a cost artifact"
conclusion is very unlikely to flip (both signals now confirmed, from the corrected VERDICTS.md
figures above, to be far below breakeven even at `roundTripCost=0`, while the venue-scenario
deltas involved are all under 2 percentage points) but is explicitly not re-claimed as verified.

**No verdict, AUC, p-value, or q-value changed anywhere in this sweep.** Only absolute economics
figures moved (or, for C0's "gross mean netR", were relabeled without changing their value). Every
correction above either reproduces exact row counts/AUC against the original run (CLASSIFIER-
FUNDING-FEATURE) or is a direct algebraic identity on already-saved, byte-exact figures (C0-
SIGNAL-COMBINATION) — nothing here was assumed or extrapolated past what the cache actually
contains.

**Engineering note.** No new persisted file. Two throwaway, uncommitted scripts were used during
this item's investigation (one calling `classifier.mjs`'s exported `sealed-funding` functions
directly with `roundTripCost=0`, cache-only/no-egress; one reading the existing
`c0-signal-combination` saved JSON to extract exact figures for the algebraic recovery) and were
deleted before commit — nothing new is left in the repo. `classifier.mjs`, `strategy.js`,
`backtest.js`, `momentum.mjs`, and every other frozen path were read-only throughout; only
VERDICTS.md and ROADMAP.md were modified. `npm.cmd test`: 513/513 green, run before commit
(unchanged — no test-affecting code changed; this is a documentation/bookkeeping correction only).

## 2026-08-29 — BREAKEVEN-LOCK-COUNTERFACTUAL: on both `ma_dip` universes, removing the breakeven lock would have produced MORE total R, not less — the 5:1 reward:risk geometry means the target-hits it cut off outweigh the stop-outs it saved

`ma_dip` is a **CLOSED historical population** on both equity universes — killed decisively by
`MADIP-SURVIVABILITY-CONDITION-5` (2026-08-28: max drawdown −81.7%/−74.2% at f=2%, **RUIN** at
f=5%, against a pre-registered −25% ceiling). This item is forensic, not a re-tune or a candidate
re-evaluation. `MADIP-REALISED-R-CONDITION-2` (2026-08-28) found the breakeven lock ("trail/be"
in `backtest.js`'s naming — `ma_dip`'s config sets no `trailR`/`trailStartR`, so `trailing` never
arms and "trail/be" here means the breakeven lock specifically) accounts for a minority of trades
(14.3% DJIA-30, 17.3% DJTA-20) but a disproportionate share of net R (+124.4% of total on
DJIA-30, +64.5% on DJTA-20), and flagged the natural follow-up left open: what would have
happened to those exact trades had the lock not fired, carrying the position to its original
stop or target instead? This item answers that.

**Method, new script `scripts/breakeven-lock-counterfactual.mjs` (additive, read-only, cache-only
— no IBKR egress).** Reuses `MADIP-REALISED-R-CONDITION-2`'s cost basis/config/split verbatim
(IBKR Fixed $0.005/share, 5bps/side slippage, 70/30 split, `{ entryMode: "ma_dip", trendGate:
false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }`) and its
per-trade `why` field exactly as added — not re-added. The breakeven-locked subset is isolated as
every excursion with `why === "trail/be"`. For each, the counterfactual replays forward from the
cached OHLC bars starting the bar after entry (matching `backtest.js`'s own `k > pos.openedAt`
gating), checking the *original* pre-lock stop (`entry − risk`) and target (`entry + 5·risk`)
with the identical conservative same-bar rule `backtest.js` itself uses (stop checked before
target) and the identical unmodified `MAX_HOLD = 100` timeout. No line of `backtest.js` was
touched — the replay is implemented standalone in the new script.

**Cross-check passed on both universes before any counterfactual was computed**, confirming the
cache and cost basis match `MADIP-REALISED-R-CONDITION-2` exactly: DJIA-30 475 trades / avgR
+0.15263 / realised R 2.64655 (cited 2.6466); DJTA-20 300 trades / avgR +0.29939 / realised R
2.50362 (cited 2.5036).

**Lock subset sizes reproduce the cited counts exactly** (68 DJIA-30, 52 DJTA-20). Two trades per
universe are **UNRESOLVED** — the cached holdout ends before the counterfactual replay reaches a
stop, target, or the 100-bar timeout (DJIA-30: DOW entry 1783382400, WMT entry 1784764800;
DJTA-20: KEX entry 1785801600, UPS entry 1787011200) — excluded from every aggregate below rather
than assigned a guessed outcome, mirroring `backtest.js`'s own silent-drop behavior for a position
that never closes before the data ends. 66/68 and 50/52 resolve.

| universe | resolved | saved from full stop-out | cut from eventual target hit | would have timed out | actual subset ΣR | counterfactual subset ΣR | net change in total R | net change in avgR (full population) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DJIA-30 | 66 | 38 | 28 | 0 | 88.6733 | 96.3239 | **+7.6505** | +0.01611 |
| DJTA-20 | 50 | 31 | 19 | 0 | 54.4948 | 60.3921 | **+5.8973** | +0.01966 |

**The lock is net NEGATIVE for total R on both universes.** More of the resolved trades were
saved from a full stop-out than were cut from a target hit (38 vs. 28 on DJIA-30, 31 vs. 19 on
DJTA-20) — the naive read of that count alone would suggest the lock is protective. It is not,
in R terms: at this config's 5:1 reward:risk, a saved stop-out is worth ≈−1.0R avoided and a cut
target is worth ≈−4R foregone (5R target minus the ~1R+ the lock actually banked), so the fewer
target-hits the lock cut off cost more total R than the more-numerous stop-outs it prevented.
Letting every one of these 66/50 trades ride to its original stop or target, unmodified, would
have added +7.65R (DJIA-30) and +5.90R (DJTA-20) to the strategy's total — both would-be gains,
not losses, i.e. removing the lock strictly helps total R on this closed population. Realised R
recomputed with the resolved subset's actual R replaced by its counterfactual R rises sharply
above the measured figures: DJIA-30 3.9827 vs. measured 2.6466; DJTA-20 4.0139 vs. measured
2.5036 — consistent with letting winners run all the way to a 5R target rather than banking a
small breakeven-plus exit.

**Framed as an exit-geometry property, not a strategy edge.** This result says nothing about
`ma_dip`'s viability — it was already closed on survivability grounds — and is not a claim that
removing the lock would fix it (the 5:1 asymmetry that makes uncapped trades pay off here is
exactly the same asymmetry the random-entry null (`EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`,
`GEOMETRY-NULL-DOWN-WINDOW-PROBE`) already credits to entry-agnostic exit rules on this cache. It
documents how `ma_dip`'s own realised-R shortfall against its configured `tpR: 5`
(`MADIP-REALISED-R-CONDITION-2`) decomposes at the trade level: not because the lock protects
against bad continuations, but because it caps a fat-tailed reward-risk shape from the wrong
side, on this specific historical trade set.

**No entry or exit logic modified anywhere, no parameter swept, no config change proposed.** Both
universes treated as closed populations throughout — nothing here reopens `ma_dip` as a
candidate. `npm.cmd test`: 513/513 green.

## 2026-08-29 — CRYPTO-R-NORMALIZATION-DEFECT-OR-ECONOMICS: the large-negative crypto R figures
`GEOMETRY-NULL-DOWN-WINDOW-PROBE` flagged as a "cost-model artifact" are CORRECT ECONOMICS, not a
defect — that item's framing is corrected, its sign-based conclusion stands

**Why this exists.** `GEOMETRY-NULL-DOWN-WINDOW-PROBE` (2026-08-29, this file) reported crypto
null means as low as −3.07 and a worst single trade of −17.99R, and described the *magnitude* as
a cost-model artifact of "reusing an equities-calibrated cost formula on a new asset class,"
explicitly declining to fix it and flagging it for a separate item. This item is that separate
item, and its job was to check that framing before letting it stand — not to assume either
verdict.

**`backtest.js`'s net-R identity is `netR = grossR − (feeRate+slipPct)*(entry+exitPx)/risk`.** It
is a single formula applied identically to every family and both markets — not equities-specific
code, only fed different inputs per market. Derived symbolically for an `ma_dip` long stopped
out (gross R is exactly −1 by construction): with `stopPct = risk/entry`, `entry+stop =
entry*(2−stopPct)` and `risk = entry*stopPct`, so `netR = −1 − (feeRate+slipPct)*(2−stopPct)/
stopPct` — for `stopPct << 1`, approximately `−1 − 2*(feeRate+slipPct)/stopPct`.

**Evaluated at the probe's own reported figures.** At crypto's `feeRate+slipPct = 0.0085`
(`strategy.js` `FEE_RATE=0.008` + `SLIPPAGE_PCT=0.0005`) and its median qualifying-cell stop
distance (1.6%–2.4%, e.g. `stopPct=0.018` for 2024-Q2): `netR ≈ −1 − 0.0085*1.982/0.018 ≈
−1.94R` — a typical stopped-out trade in this population, in line with the ≈1R-of-cost estimate
this item's own pre-registered task text sketched, and nowhere near −18R. The −17.99R extreme
(`feeModelSanity.minRealR`, saved in
`research-runs/2026-08-29T17-11-33-610Z-geometry-null-down-window-probe.json`, recurring across
several qualifying cells) is the *same formula* at a near-zero-risk stop: solving `−1 −
0.0085*(2−stopPct)/stopPct = −17.9915` gives `stopPct ≈ 0.001` (a 10bp structural stop). That
trade is real arithmetic, not a computation error — it is what the probe's own `CONFIG`
(`minStopPct: 0`, matching `scripts/per-family-cost-ceiling.mjs` L57 byte-for-byte) lets through;
live trading's `MIN_STOP_PCT=0.015` (`strategy.js` L48) would filter it out entirely. Dividing a
cost roughly proportional to price by a risk that can shrink toward zero is unboundedly sensitive
to stop distance by construction, for any asset class or fee schedule — crypto's larger flat fee
just needs a far less extreme stop to make the effect visible than equities' tiny per-share
commission would.

**Reconciliation with `PER-FAMILY-COST-CEILING`'s `k=615.69` for `ma_dip` on crypto.** That
item's `k = (feeDragAvgR+slipDragAvgR)/(FEE_RATE+SLIPPAGE_PCT)` is exactly the same per-trade
coefficient `(entry+exitPx)/risk` derived above, averaged over `ma_dip`'s full 9894-trade crypto
holdout rather than evaluated at one stop distance — and it was reported with no artifact
caveat. Direct check, reproducing its published table to 4 decimals: spot-taker `netAvgR =
0.0877 − 615.69*0.0085 = −5.1457`; spot-maker (slip=0, `cost-model.mjs`'s
`SPOT_FEE_SCHEDULE.maker=0.0040`) `netAvgR = 0.0877 − 615.69*0.0040 = −2.3751` — both match
exactly. Both items use the identical `ma_dip`-on-crypto config (confirmed by reading
`per-family-cost-ceiling.mjs` L57 against the probe's `CONFIG` at its L101 — byte-identical), so
they describe the same arithmetic from two angles: `PER-FAMILY-COST-CEILING`'s population average
(pulled up by exactly this tiny-stop tail) is the correct characterization; the probe's "cost-
model artifact" framing, describing one extreme draw from the same distribution, is the one that
needed correcting.

**Is net R below −1 for a stopped-out trade economically coherent?** Yes, expected behaviour, not
a sign of error. A stop caps only the *gross* loss at exactly −1R; round-trip cost is charged on
top of that in price terms and reported here in risk terms by dividing by the same risk
denominator used for the gross P&L. Any trade whose fixed round-trip price cost is large relative
to its risk — a tight stop, a high fee rate, or both — will show net R below −1 by construction of
that ratio.

**Verdict: CORRECT ECONOMICS.** `GEOMETRY-NULL-DOWN-WINDOW-PROBE`'s artifact framing is corrected
by a dated annotation added directly to that section above; its **sign**-based conclusion (crypto
null means strongly negative in every genuinely down/flat quarter, corroborating the equities
window-artifact finding) never depended on the magnitudes and stands unchanged. No published
figure in either item changed — only the characterization of magnitude in the earlier item's
write-up.

**Engineering note.** Diagnostic only, no script written — the derivation was closed-form,
cross-checked against `PER-FAMILY-COST-CEILING`'s already-saved table and against
`GEOMETRY-NULL-DOWN-WINDOW-PROBE`'s already-saved `research-runs/2026-08-29T17-11-33-610Z-
geometry-null-down-window-probe.json`, both read-only. `backtest.js`, `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js`, and every frozen path
untouched throughout (grep-confirmed against the staged diff before commit). Only `ROADMAP.md`
modified (this section plus the correcting annotation in `GEOMETRY-NULL-DOWN-WINDOW-PROBE`'s
section above). `npm.cmd test`: 513/513 green, unchanged — no test-affecting code changed.


## 2026-08-29 — PHASE-DIRECTIVE-COMPLETION-SUMMARY: closing blackboard.phase_directive_new_mechanism's C0-C3 sequence — one KILLED, one NULL-after-correction, two gated-unavailable; the phase's strongest findings were negative controls on prior work, not the new mechanisms themselves

BOOKKEEPING, per this item's own scoping note (30-60 min, no egress, no computation — D1 does not
apply, following the precedent of `PHASE-DIRECTIVE-BOOKKEEPING` and other bookkeeping items in
this ROADMAP). Synthesis only: every figure below is quoted from its own named ROADMAP.md entry,
nothing here is computed fresh. Closes `blackboard.phase_directive_new_mechanism`'s STEP 4 build
order (C0 -> C1 -> C2 -> C3, all sequenced by that blackboard key) — all four mechanisms are now
resolved as far as an unattended loop can take them without the human.

**C0 — signal combination (rank-average of B5-REVERSAL and Classifier P5): KILLED, decisively**
(`C0-SIGNAL-COMBINATION`, 2026-08-29). Pre-registered one-sided permutation test (K=2000,
seed 20260829): **p=0.4708**, nowhere near the 0.05 bar. Composite selected net R at real cost
**-0.9344**, worse than both standalone inputs on the identical matched population — B5-REVERSAL
top-3/top-5 at -0.0153/-0.0123, Classifier P5 at -0.8554 (originally -0.8474/-0.8554 pre-
`CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` correction). All five pre-registered gate clauses failed
except the minimum-trades floor (3345 >= 100). Joined `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-
NHST family as its 21st sub-test; family-wide BH-FDR **q=0.7605** — does not survive.

**C1 — options/VRP data-availability gate: gated-unavailable on account-side entitlement, not a
pass or a fail** (`C1-VRP-DATA-AVAILABILITY-GATE`, 2026-08-29). Part A (code-side capability),
resolved from static analysis: `brokers/ibkr.mjs` has no options code path today, but the
installed `@stoqey/ib` dependency already exposes everything a defined-risk short-premium study
would need (`Option` contract class, `reqContractDetails`/`reqSecDefOptParams`,
`tickOptionComputation`, `OPTION_IMPLIED_VOLATILITY`) — a multi-day build, not a same-day change
and not a multi-week one; the code-side gate does **not** fail. Part B (account-side entitlement —
whether the account holds an OPRA/options market-data subscription, historical-vs-snapshot-only,
retention depth) is not answerable from this session: no egress, IB Gateway parked pending the
human. Five concrete questions recorded in the script's saved output rather than guessed.

**C2 — continuous macro conditioner on equities (10y-2y Treasury spread as a continuous
covariate, not a discrete regime): NULL after correction, but a genuinely new statistical unit**
(`C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES`, 2026-08-29). Unlike the three prior discrete-regime
macro studies (all killed by the equities holdout containing exactly one regime episode, so
effective n=1 regardless of split), this design's effective n is the trade count: **475** `ma_dip`/
DJIA-30 holdout trades. Spearman rho = **-0.0980** (higher spread, lower net R), two-sided
permutation p = **0.0365** (K=2000) — nominally clears p<0.05. Joined the same NHST family as its
22nd sub-test; family-wide BH-FDR **q=0.1338** — does not survive (rank 6's critical value is
0.01364, more than 2.5x below this q). Quintile breakdown was non-monotonic (quintile 2 the best
performer, quintile 3 the worst), a further reason not to read this as an exploitable gradient
even before correction.

**C3 — FX carry data gate: gated-unavailable, price-side sufficient but rate-side unverified and
account-side an open question** (`C3-FX-CARRY-DATA-GATE`, 2026-08-29). Part A (price-side code
capability): `brokers/ibkr.mjs` has no FX/CASH contract path today, but `@stoqey/ib` already
exposes a `Forex` contract class and `reqHistoricalData` is generic over any contract — a small,
same-day-to-C0-sized build; the price-side code gate does **not** fail. Part B (the carry signal's
actual data need — a short-term policy/money-market rate per currency, not just pair price
history): only the USD series (`FEDFUNDS`) is confirmed reachable, already fetched by
`EXOGENOUS-DATA-ACCESS-AUDIT` and reused by C2's own sourcing; the six non-USD candidate series
(EUR/GBP/JPY/CAD/AUD/CHF, `IR3TIB01<ISO2>M156N` or named alternates `ECBDFR`/`SONIA`) are named
from FRED's known catalog convention but **not fetched this session** — explicitly reported as
unverified, not confirmed. Part C (account-side IDEALPRO FX entitlement, historical-bar
availability, retention) is not answerable from this session: no egress, IB Gateway last returned
ECONNREFUSED at 127.0.0.1:4002. Three concrete questions recorded in the script's saved output.

**What the phase established collectively — separating what the mechanisms themselves produced
from what the controls run alongside them produced.** Of the four mechanisms, one ran to a
decisive negative result (C0 KILLED), one ran to a nominally-significant-but-corrected-null result
(C2), and two never got past a data-availability gate that only the human can clear (C1, C3). None
of the four produced a positive, surviving result. But the phase also carried four control studies
that were not new mechanisms at all — re-examinations of *prior* published findings — and those
controls produced this period's most consequential results:

- `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL`: **zero of ten scorable families** clear a matched-
  geometry random-entry null at the pre-registered 95th percentile. `ma_dip` sits at the 52.1st
  percentile of its own null, `rsi` (the closest any family gets) at 55.3rd — nowhere near the
  bar. Every scorable family's null mean is itself strongly positive (+0.0751 to +0.2348),
  meaning a random long entry with the same stop/target/breakeven geometry already made money in
  this window before any entry-timing rule is credited. The corrected 8-of-12 DJIA-30
  net-positive-family claim (this project's most-cited positive equities finding) does not
  survive: one of the eight is too thin to score, and the remaining seven all fail the null.
- `DATE-CLUSTERED-RESAMPLING-DJTA20`: the project's **one** equities confidence interval that had
  ever positively excluded zero out-of-sample (`ma_dip`/DJTA-20, position-blocked 95% CI
  [+0.0509, +0.5350]) moves to **[-0.0851, +0.7129]** under date-clustered resampling — spans
  zero. This does not reopen `ma_dip` as a candidate (already closed independently on
  survivability and random-entry grounds), but it removes the one equities result that had ever
  cleared this specific bar.
- `RANDOM-ENTRY-NULL-WINDOW-SENSITIVITY`: across 6 cells (2 universes x 3 calendar years, all
  rising), the random-entry geometry's null mean correlates with each cell's own buy-and-hold
  return at **r=0.90** — consistent with a window/leverage effect rather than a geometry-only
  edge, though the cache available at the time contained no down window to make this a clean
  test.
- `GEOMETRY-NULL-DOWN-WINDOW-PROBE`: found genuinely down/flat windows (DJTA-20 2025-Q1 and
  2025-Q3, plus 9 crypto quarters/years) and confirmed the open question directly — the
  geometry's null mean, positive in every rising window on record (+0.1493R DJIA-30, +0.1637R
  DJTA-20), turns **negative** in both equities down windows found (-0.1741, -0.0632). All 9
  qualifying crypto cells were directionally negative too, though their magnitudes reflect
  correct crypto-specific cost economics rather than a comparable second equities data point
  (`CRYPTO-R-NORMALIZATION-DEFECT-OR-ECONOMICS`, 2026-08-29, verified this rather than assumed
  it).

**Stated plainly, as the record shows it: this phase's strongest results were negative controls
on prior work — the equities breadth claim and the project's one zero-excluding CI both did not
survive scrutiny, and the geometry's rising-window tailwind was shown not to survive a down
window — rather than any positive result from the four genuinely new mechanisms the phase was
built to test.** C0 and C2 each ran to completion and produced a clean negative; C1 and C3 never
reached a testable result at all.

**Consolidated numbered list — exactly what the human must supply for C1 or C3 to proceed**
(combining the question lists both items already produced into one place):

1. IBKR options market-data entitlement — whether the live account's data plan includes an
   OPRA/options-inclusive bundle. (C1)
2. If held, whether that entitlement covers historical option/implied-vol bars or only live
   snapshots, and how far back retention goes for the underlying(s) in question. (C1)
3. Any incremental subscription cost for options market data not currently being paid. (C1)
4. IBKR IDEALPRO FX quote-data entitlement — bundled with the existing account or a separate
   subscription. (C3)
5. Whether historical FX bars (`whatToShow=MIDPOINT`/`BID`/`ASK`) actually return for this
   account, and how far back. (C3)
6. Confirmation, via one real fetch per series against FRED's free key-less CSV endpoint, that
   the named non-USD policy-rate series actually resolve (EUR `IR3TIB01EZM156N`/alt `ECBDFR`,
   GBP `IR3TIB01GBM156N`/alt `IUDSOIA`, JPY `IR3TIB01JPM156N`, CAD `IR3TIB01CAM156N`, AUD
   `IR3TIB01AUM156N`, CHF `IR3TIB01CHM156N`) — currently named from catalog convention, not
   fetched. (C3)
7. IB Gateway reachability at the human's machine, so items 1-6 can actually be checked from a
   future unattended run — both C1 and C3 ran with Gateway unreachable this session (parked /
   ECONNREFUSED at 127.0.0.1:4002).

**No C4 or successor mechanism is proposed here.** The phase directive named four mechanisms;
all four are now resolved as far as this loop can take them without the human, and inventing a
fifth to keep the phase moving would be exactly the manufactured-work failure this project's
discipline prohibits. Whether a new mechanism should be specified is a decision for the human,
made after C1/C3's entitlement questions above are answered — not a decision this item makes by
proposing one.

**Engineering note.** `ROADMAP.md` only (this section). `blackboard.phase_directive_new_mechanism`
gains a `completion` field pointing at this entry; `decisions_verbatim` and `open_conflict_for_human`
are untouched (confirmed byte-identical in the diff). No production file read or modified —
every figure above is a quotation from an already-committed ROADMAP.md entry, not a fresh
computation. `frozen_paths_note` remains `blackboard`'s last key, byte-exact indent-1 roundtrip.
`npm.cmd test`: 513/513 green, unchanged (no test-affecting code changed).

## 2026-09-01 — CRYPTO-EFFECTIVE-SAMPLE-AUDIT: the equities date-clustering defect does not generalise to crypto's closed formal-NHST family — the one exposed population (VOL-CONTRACTION AXIS C) loses its zero-exclusion under clustering correction

**Premise check before any new computation.** This item's work_queue text asserted "every crypto
interval in this project was produced by `blockBootstrapCI` (momentum.mjs:64), which resamples
contiguous blocks BY POSITION in the flat trade array with blockSize 4 and no timestamp awareness
at all" — the same defect `DATE-CLUSTERED-RESAMPLING-AUDIT` (2026-08-28) found and corrected for
pooled multi-symbol equities trades. Before reproducing that fix for crypto, every
`blockBootstrapCI(` call site in the repo touching crypto data was read (19 call sites total,
`grep -n "blockBootstrapCI("`), and the premise does **not** hold as a blanket claim. Every crypto
call site falls into one of three categories structurally immune to the equities-specific defect
(which requires: multiple symbols, pooled in symbol-then-trade array order, with no time
correction before block-bootstrapping):

- **Single-symbol continuous-exposure series** — `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL`,
  `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`, the `MACRO-REGIME-PRIMARY-SIGNAL` family,
  `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`,
  `STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC`,
  `GDELT-WIDER-HYSTERESIS-BAND-DIAGNOSTIC` (`scripts/gdelt-wider-hysteresis-band-diagnostic.mjs`,
  written 2026-08-27, still externally blocked on GDELT DOC API connectivity and never yet
  produced a scored result — the script itself is what this bullet's claim was checked against):
  all call
  `blockBootstrapCI(holdoutScore.stratReturnsForCI, {blockSize:20})` on ONE symbol's (XBTUSD) own
  chronologically-ordered return series — array position already equals time order for a single
  time series, so there is no second symbol to scatter across positions.
- **Pre-aggregated to one value per date/date-panel before bootstrapping** — `momentum.mjs:181`
  (the shared IC-significance machinery behind `Momentum M7`, `Low-vol B4`,
  `MOMENTUM-SHORT-HORIZON-RECHECK`, `CROSS-SECTIONAL-NONPRICE-RANK`: `values` there is one
  cross-sectional IC per date-panel, and the reported p-value comes from
  `dateVectorPermutationP`, a genuinely date-aware permutation test, not from `blockBootstrapCI`
  at all) and `phase3-b5-reversal-rerun.mjs:83` (`B5-REVERSAL` PHASE3's
  `holdout.topN[n].perDateNet` — one net-return value per calendar date across the whole
  universe, already collapsed before the block bootstrap runs).
- **Explicitly time-sorted before bootstrapping, and not load-bearing** — `c0-signal-
  combination.mjs:301` sorts the selected subset by trade time (`selectedByTime`) before calling
  `blockBootstrapCI`, and its own comment marks this "due-diligence-only, not part of the
  pre-registered gate"; `C0-SIGNAL-COMBINATION`'s real significance test is a permutation test
  (p=0.4708, KILLED) unrelated to `blockBootstrapCI`.

Two more closed crypto formal-NHST entries — `Classifier P5` and `CLASSIFIER-FUNDING-FEATURE` —
use **neither** `blockBootstrapCI` **nor** any trade-R pooling at all: `classifier.mjs` has no
`blockBootstrapCI` call anywhere; their p-values (0.0198, 0.0099) come from `mannWhitneyAuc`, a
rank-based classification test on labels, a different statistical object entirely.
`LOG-REGRESSION-BANDS-CRYPTO` similarly never calls `blockBootstrapCI` — its p=0.0002 is a
per-asset (n=24) buy-and-hold comparison.

**Revised scope, stated plainly rather than silently narrowed.** No CLOSED crypto formal-NHST
population in this project actually has the equities-shaped defect. The one population that DOES
pool multiple symbols' discrete trades without any time-based correction is
`VOL-CONTRACTION-SAMPLE-EXTENSION`'s AXIS C (256 trades, 15m entry, holdout-only) — required by
this item's own task text regardless, because a gate clearance rests on it. Read closely, AXIS
C's recorded CI `[0.0620, 0.4427]` does **not** actually come from `blockBootstrapCI` either — it
comes from `stat()` (`researchlib.mjs`), a normal-approximation CI (mean ± 1.96·SE) with **zero**
serial-correlation adjustment, computed on `perSymbol.flatMap(x => x.results)` (all of one
symbol's trades, then the next symbol's, etc. — concatenation order, not time order). The
work_queue item's description of this interval as coming "from this same position-blocked
machinery" is corrected here: it is a *different*, and if anything *less* clustering-aware,
method than `blockBootstrapCI` (no resampling at all — a single closed-form normal interval).
This makes AXIS C the one population genuinely re-run below; every family above is answered by
call-site code review, cited above, not a rerun, because re-running an already-immune population
could not change any conclusion.

**Method (new script: `scripts/crypto-effective-sample-audit.mjs`, cache-only, no egress).**
Reuses `DATE-CLUSTERED-RESAMPLING-AUDIT`'s date-block-bootstrap mechanic unchanged (draw whole
time-buckets with replacement until reaching the original trade count, truncate, record the mean;
5000 iterations, 2.5/97.5 percentile 95% CI), applied at two granularities since AXIS C's bars are
15m, not daily: per distinct 15m bar timestamp (the appropriate unit for this bar interval —
multiple symbols entering on the exact same 15m bar is crypto's analog of equities' "same
calendar day, market-wide move") and per distinct calendar day (reported alongside, per this
item's own done_when, for comparability with the equities figures). Exit time is read from the
same symbol's 15m holdout candle array at (entryIndex + barsHeld), matching
`DATE-CLUSTERED-RESAMPLING-AUDIT`'s own convention. `blockBootstrapCI` (momentum.mjs) is NOT
modified. Replication check performed first: reproduced AXIS C's recorded 256 trades and its
normal-approx CI bit-for-bit off the same cached candles before computing anything new —
**confirmed exact match** (avgR reproduced 0.2524, CI reproduced [0.0620, 0.4427] to 4 decimal
places).

**Result: the +0.0620 lower bound does NOT survive clustering correction.**

| Population | Trades | Distinct periods (bar/day) | Effective N / nominal | Largest single-period cluster | Mean simultaneously open |
|---|---:|---:|---:|---:|---:|
| VOL-CONTRACTION AXIS C (28 assets, 15m entry, holdout) — per 15m bar | 256 | 161 bars | 62.9% | 11 | 0.24 |
| VOL-CONTRACTION AXIS C — per calendar day (coarser, for equities comparability) | 256 | 76 days | 29.7% | — (not separately tracked at day grain) | 0.24 |
| *For comparison, already on record:* `ma_dip` DJIA-30 (`DATE-CLUSTERED-RESAMPLING-AUDIT`, 1d bars) | 475 | 124 days | 26.1% | 13 | 10.47 |
| *For comparison, already on record:* `breakout` DJIA-30 (`DATE-CLUSTERED-RESAMPLING-AUDIT`, 1d bars) | 61 | 35 days | 57.4% | 7 | 8.26 |

| CI method | 95% interval | Excludes zero? |
|---|---|---|
| Recorded normal-approx (`stat()`, as originally reported) | [+0.0620, +0.4427] | yes |
| Position-blocked (`blockBootstrapCI`, blockSize=4 — new, for completeness) | [+0.1007, +0.4330] | yes |
| **Bar-timestamp-clustered (new, primary — this item's real question)** | **[-0.0244, +0.5649]** | **no** |
| Day-clustered (new, secondary, coarser granularity) | [-0.1527, +0.6761] | no |

Both new clustering-aware intervals span zero; the recorded normal-approx interval and even a
freshly-computed position-blocked bootstrap do not. The gap is not small: bar-clustering roughly
doubles the recorded interval's width and flips its lower bound negative. 62.9% effective sample
size (161 distinct 15m bars behind 256 nominal trades) sits in the same range as
`DATE-CLUSTERED-RESAMPLING-AUDIT`'s `ma_dip` DJIA-30 finding (26%) and `breakout` (57%) — same
qualitative failure mode, different asset class and bar interval.

**What this does and does not change.** `VOL-CONTRACTION-SAMPLE-EXTENSION`'s own pre-registered
gate (`avgR > +0.10` AND `trades >= 150`) is a point-estimate threshold, not a CI-exclusion rule —
avgR=0.2524 and trades=256 still mechanically clear it regardless of this finding, so the gate's
literal pass/fail is unchanged. What changes is how much confidence the recorded CI should have
lent that pass: a reader treating `[0.0620, 0.4427]` as evidence the true edge is reliably
positive would be wrong — the honestly-clustered interval says the data cannot rule out zero.
`VOL-CONTRACTION-SAMPLE-EXTENSION`'s own writeup already flagged this axis as "NOT out-of-sample
in the fullest sense... not a promotion", and this finding sharpens that caveat rather than
reversing a promotion decision, since none was made.

**One-line verdict:** the equities date-clustering defect does not generalise to crypto's closed
formal-NHST family (every other crypto `blockBootstrapCI` call site is structurally immune —
single-symbol series, pre-date-aggregated, or already time-sorted); the one genuinely exposed
population, VOL-CONTRACTION AXIS C, no longer excludes zero under bar-clustered resampling, so its
gate clearance should be treated as unreliable evidence of a real edge, even though the literal
point-estimate gate still passes.

Not part of `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family (AXIS C was already
economic-gate-only, not a p<0.05 test) and no BH-FDR recomputation performed. `backtest.js`,
`momentum.mjs`, `classifier.mjs`, `strategy.js`, and all other frozen paths read only, not
modified — only `scripts/crypto-effective-sample-audit.mjs` (new, additive) was added.
`npm.cmd test`: 513/513 green, run before commit.

## 2026-09-01 — DEAD-CODE-AND-ASSET-AUDIT: repo-wide reachability confirmed for every tracked module — headline result is zero confirmed-dead files, plus two genuine ROADMAP.md path-citation gaps closed

**Headline, stated plainly since it's the whole point of this item: nothing is confirmed dead.**
This repeats and extends the 2026-08-29 preliminary sweep referenced in this item's own
work_queue note, using a reproducible reference-search method rather than re-trusting the prior
count. Every one of the 64 tracked root-level `.js`/`.mjs`/`.ts` modules (excluding `*.test.mjs`)
and all 61 tracked files under `scripts/` have a confirmed reachability route. An empty deletion
list is the expected and accurate outcome, not a shortfall.

**Method.** Built the full tracked-file list (`git ls-files`, 213 files) and, for every candidate
module, searched every other tracked code file for an `import`/`require`/dynamic-`import()` of it
by basename, and every tracked `.md` doc for a citation by path or bare filename. A module counts
as reachable if it is imported by other code, listed in `package.json`'s `scripts`, dispatched from
a CLI table, or cited by path/name in project documentation (ROADMAP.md, VERDICTS.md,
TOURNAMENT_ROADMAP.md, AGENT_NOTES.md, README.md, etc.) — matching the "not dead" bar this item's
own task text sets. `*.test.mjs` files are excluded from the dead-code question entirely: `npm.cmd
test` runs `node --test`, which discovers every `*.test.mjs` file by naming convention, not by
import — a test file with zero importers is normal, not orphaned, and none of the 23 test files
that showed 0 import-references were treated as candidates for anything.

**Root-level modules (64 total) — full reachability table.** `n` = number of other tracked code
files importing it; route lists up to 3 importers (or the doc citation, for the 10 standalone CLI
study scripts with no code importer).

| module | imported by (n) | route |
|---|---:|---|
| agent-tools.mjs | 2 | agent-tools.test.mjs, commands.js |
| analyzer.js | 1 | commands.js |
| backtest.js | 55 | backtest.test.mjs, baseline.mjs, basis-directional-signal.mjs (+52 more) |
| baseline.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| basis-directional-signal.mjs | 1 | basis-directional-signal.test.mjs |
| bot.js | 1 | bot-scheduler.test.mjs (also `package.json`'s `"start": "node bot.js"`) |
| brokers/ibkr.mjs | 5 | brokers/ibkr.test.mjs, scripts/equities-all-families-baseline.mjs, scripts/equities-baseline-port.mjs (+2 more) |
| brokers/kraken.mjs | 1 | brokers/kraken.test.mjs (also imported live by trader.js) |
| carrystudy.mjs | 1 | carrystudy.test.mjs |
| chart.js | 2 | commands.js, scanner.js |
| classifier.mjs | 2 | classifier.test.mjs, scripts/c0-signal-combination.mjs |
| commands.js | 3 | bot.js, commands.test.mjs, research.js |
| context.js | 2 | commands.js, context.test.mjs |
| cost-model.mjs | 6 | cost-model.test.mjs, scripts/calibrate-fill-model.mjs, scripts/cost-sensitivity-surface.mjs (+3 more) |
| cross-sectional-nonprice-rank.mjs | 1 | cross-sectional-nonprice-rank.test.mjs |
| data.js | 16 | baseline.mjs, commands.js, flowsignal.mjs (+13 more) |
| dca.mjs | 2 | dca.test.mjs, grid.mjs |
| derivatives.mjs | 17 | basis-directional-signal.mjs, carrystudy.mjs, classifier.mjs (+14 more) |
| features.js | 2 | backtest.js, isbeta.mjs |
| flowsignal.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| flowverify.mjs | 0 | standalone CLI script, cited in ROADMAP.md |
| funding-gate-h11.mjs | 2 | funding-gate-h11.test.mjs, research.js |
| funding-meanrev.mjs | 1 | funding-meanrev.test.mjs |
| funding-study.mjs | 2 | funding-study.test.mjs, research.js |
| funding.mjs | 1 | funding.test.mjs |
| fundinglib.mjs | 2 | classifier.mjs, funding-gate-h11.mjs |
| grid.mjs | 1 | grid.test.mjs |
| intensityfilter.mjs | 0 | standalone CLI script, cited in ROADMAP.md |
| intensityIC.mjs | 0 | standalone CLI script, cited in ROADMAP.md |
| isbeta.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| liquidation-cascade-reversal.mjs | 1 | liquidation-cascade-reversal.test.mjs |
| logger.js | 12 | analyzer.js, bot.js, chart.js (+9 more) |
| long-short-ratio-contrarian.mjs | 1 | long-short-ratio-contrarian.test.mjs |
| ma-crossover-study.mjs | 1 | ma-crossover-study.test.mjs |
| mae-mfe-stop-placement-diagnostic.mjs | 1 | mae-mfe-stop-placement-diagnostic.test.mjs |
| mcp-server/src/index.ts | 0 | compiled by `mcp-server/package.json`'s `"main": "dist/index.js"` build step; `.vscode/mcp.json` launches that compiled output; source references `strategy.js` by path internally |
| momentum.mjs | 27 | classifier.mjs, cross-sectional-nonprice-rank.mjs, momentum.test.mjs (+24 more) |
| monitor.js | 9 | bot.js, commands.js, context.js (+6 more) |
| oi-trend-gate.mjs | 1 | oi-trend-gate.test.mjs |
| onchain-flow-gate.mjs | 1 | onchain-flow-gate.test.mjs |
| order-flow-aggressor-imbalance.mjs | 1 | order-flow-aggressor-imbalance.test.mjs |
| overlay.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| pairs-cointegration.mjs | 1 | pairs-cointegration.test.mjs |
| portfolio.mjs | 5 | portfolio.test.mjs, research.js, scripts/phase2-triage.mjs (+2 more) |
| regime.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| research.js | 0 | standalone CLI script, cited in AGENT_NOTES.md, README.md |
| researchlab.mjs | 82 | agent-tools.mjs, agent-tools.test.mjs, basis-directional-signal.mjs (+79 more) |
| researchlib.mjs | 58 | baseline.mjs, basis-directional-signal.mjs, carrystudy.mjs (+55 more) |
| rolling-volatility-regime-timing.mjs | 1 | rolling-volatility-regime-timing.test.mjs |
| rsi-reversion-study.mjs | 1 | rsi-reversion-study.test.mjs |
| scanner.js | 5 | bot.js, commands.js, money-path.test.mjs (+2 more) |
| seasonality-dayofweek-session.mjs | 1 | seasonality-dayofweek-session.test.mjs |
| signal-decay-temporal-stability.mjs | 3 | scripts/per-epoch-gross-edge.mjs, signal-decay-temporal-stability.test.mjs, walkforward-revalidation.mjs |
| simple.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| sizing.mjs | 2 | dca.mjs, sizing.test.mjs |
| storage.js | 9 | bot.js, commands.js, context.js (+6 more) |
| strategy-registry.mjs | 2 | scanner.js, strategy-registry.test.mjs |
| strategy-search.mjs | 2 | research.js, strategy-search.test.mjs |
| strategy.js | 34 | backtest.js, baseline.mjs, basis-directional-signal.mjs (+31 more) |
| top-traders-divergence.mjs | 1 | top-traders-divergence.test.mjs |
| tournament.mjs | 6 | commands.js, research.js, scripts/equities-breadth-vs-random-entry-null.mjs (+3 more) |
| trader.js | 11 | api-resilience.test.mjs, bot.js, brokers/kraken.mjs (+8 more) |
| trail.mjs | 0 | standalone CLI script, cited in AGENT_NOTES.md, ROADMAP.md |
| walkforward-revalidation.mjs | 1 | walkforward-revalidation.test.mjs |

11 of the 64 (`baseline.mjs`, `flowsignal.mjs`, `flowverify.mjs`, `intensityfilter.mjs`,
`intensityIC.mjs`, `isbeta.mjs`, `overlay.mjs`, `regime.mjs`, `research.js`, `simple.mjs`, `trail.mjs`)
have zero code importers; every one of them is a standalone, directly-runnable CLI study script
(each carries its own `node <file>` usage header) documented by name in
ROADMAP.md/AGENT_NOTES.md/README.md — exactly the "reached through a documentation citation" case
this item's own task text says is NOT dead. None proposed for deletion.

**`scripts/` (61 tracked files) — ROADMAP.md path-citation check.** 56 of 61 are cited by path
somewhere in ROADMAP.md (up from the 46/51 the preliminary sweep found, reflecting the 10 study
scripts added since 2026-08-29). 5 were not, each resolved on its own facts rather than treated as
one bucket:

1. **`scripts/madip-realised-r-condition-2.mjs`** — genuine citation gap, exactly the case this
   item's own note pre-identified: `MADIP-REALISED-R-CONDITION-2`'s ROADMAP.md section (2026-08-28)
   cites the study by ID three times but never by path. **Fixed** — path citation added to that
   section's engineering-note paragraph.
2. **`scripts/gdelt-wider-hysteresis-band-diagnostic.mjs`** — cited by ID (not path) in the
   `CRYPTO-EFFECTIVE-SAMPLE-AUDIT` entry above (2026-09-01), which discusses its `blockBootstrapCI`
   call site. **Fixed** — path citation added there. Distinct from case 1 in one respect worth
   recording: this script has never produced a scored result. `git log` shows it written
   2026-08-27, then reconfirmed externally blocked on GDELT DOC API connectivity across roughly a
   dozen subsequent firings (outage symptom shifted between TCP timeout and an actually-expired
   TLS certificate on GDELT's own server, confirmed via `openssl s_client`, ruling out a local
   cause both times) — no ROADMAP.md dated write-up exists for it because no run has ever
   completed, not because of a documentation oversight. It no longer appears in
   `blackboard.work_queue` as of this state file, which this item flags rather than resolves: the
   script is legitimate and should not be deleted (its own extensive ledger history establishes
   intent and repeated recent activity, most recently 2026-08-29T03:10Z), but whether it should be
   restocked to the queue for a fresh connectivity probe, or formally closed as abandoned, is a
   judgment call this audit item's scope does not cover.
3. **`scripts/mint-approval-token.mjs`** — not a study script at all, so the "cited by ID, missing
   by path" pattern doesn't apply. Its own header states it is deliberately the one place a valid
   MCP-deploy approval token can be minted, requiring a human's own terminal and
   `MCP_APPROVAL_SECRET`, with no MCP tool wrapper anywhere by design — an operational security
   control, not a research write-up. Forcing it into a ROADMAP.md dated section would misrepresent
   its category. **No citation added**, and no deletion — reachability here is "known and
   deliberately invoked by a human directly," which this item's own task text accepts as a valid
   route (a module reached only through direct, documented human operation is not dead).
4. **`scripts/phase4-t4-momentum-portfolio-sim.mjs`** — its own header says "Deletable after
   ROADMAP.md's finding is written," which reads at first glance like a stale, actionable TODO.
   Checked whether the finding was actually written: yes, in full, but into `VERDICTS.md`'s
   `T4-PORTFOLIO-MOMENTUM-PHASE4` row and `TOURNAMENT_ROADMAP.md`'s 2026-08-15 dated section (not
   ROADMAP.md — this project runs two separate roadmap documents, and this script's study line
   belongs to the tournament track), and the script is already cited there **by path**
   (`TOURNAMENT_ROADMAP.md:1723`). Its own "deletable" comment is accurate in spirit — the write-up
   it was waiting on exists — but this item's task text explicitly says not to remove a script a
   ROADMAP.md **or VERDICTS.md** entry depends on for reproducibility, and `VERDICTS.md`'s row cites
   specific numbers (Sharpe 0.483/0.493, maxDrawdown -33.1%) this script is the only path back to
   reproducing. **Not deleted** — flagged instead as a candidate a human could clear explicitly,
   since the script's own comment already made that call; not this item's call to execute
   unilaterally against a "don't remove a script a VERDICTS.md entry depends on" instruction.
5. **`scripts/fetch-equity-ohlc.mjs`** — an equities data-ingestion utility (run manually against a
   live IB Gateway to populate `candles/`), not a one-off study with a dated write-up; the "add a
   path citation to the relevant dated section" fix doesn't apply because no dated section is the
   right home for it. It has no ROADMAP.md/AGENT_NOTES.md/README.md mention at all, but it is
   referenced by `equity-port.test.mjs` (format-compatibility comments) and by its own `--universe
   universe.txt` usage contract, which explains the untracked `universe.txt` at repo root seen in
   `git status` this run — that file is this script's required input, not stray debris, and was
   left untouched. **No citation added** (wrong category for the ROADMAP.md convention) and no
   deletion; noted here so a future audit doesn't re-flag it without this context.

**Non-code asset directories.**

| directory | tracked files | reachability |
|---|---:|---|
| `fonts/` | 3 | `DejaVuSans.ttf`/`DejaVuSans-Bold.ttf` registered by `chart.js` (`registerFont`, lines 16/18) for chart-text rendering. `fonts.conf` has **no in-repo reference** (no code, no doc, and this repo has no tracked Dockerfile/deploy-config to check either) — but its content (`<dir>/app/fonts</dir>`, `<cachedir>/tmp/fontconfig-cache</cachedir>`) is a fontconfig file shaped for a containerized deploy, almost certainly consumed by an external build/deploy step (e.g. a platform's build config or `FONTCONFIG_FILE` env var) that lives outside this repository, not by anything trackable here. Deleting it on the strength of "no in-repo reference" risks silently breaking font rendering in a production deploy this audit cannot see. **Not proposed for deletion** — flagged for a human who has visibility into the actual deploy pipeline to confirm. |
| `brokers/` | 5 | `ibkr.mjs`/`kraken.mjs` imported live by `trader.js` and multiple `scripts/`; `interface.md` cited by both broker modules' own headers and by `equity-port.test.mjs`; both `.test.mjs` files run under `node --test`. All reachable. |
| `.vscode/` | 1 | `mcp.json` launches `mcp-server/dist/index.js` — the one place this project's MCP-server wiring is declared. Reachable (used directly by any editor/agent that loads this workspace's MCP config). |
| `mcp-server/` | 3 | `package.json`/`tsconfig.json` are the build config for `src/index.ts`; see the root-module table above for `index.ts` itself. All reachable. |

**Deletions: none.** Zero files across the entire tracked tree were confirmed unreachable by every
route checked. This matches and extends the preliminary 2026-08-29 sweep rather than contradicting
it. No frozen path, strategy file, or reproducibility-load-bearing script was touched or proposed
for removal.

**Files touched this item:** `ROADMAP.md` only — the two citation fixes above (in the
`MADIP-REALISED-R-CONDITION-2` section and the `CRYPTO-EFFECTIVE-SAMPLE-AUDIT` section) plus this
entry. No code, config, or test file changed. `npm.cmd test`: 513/513 green, run before commit.

## 2026-09-02 — AGENT-DOC-DEDUPLICATION: rule matrix across the five agent-instruction documents — two dead-file references corrected, everything else reported for human judgment

**Scope.** Audited `AGENTS.md`, `AGENT_NOTES.md`, `AGENT_RUNBOOK.md`, `ARCHITECT_DIRECTIVE.md`,
`AGENT_PROTOCOL.md` for overlapping rules, contradictions, and stale references. `CLAUDE.md` was
explicitly out of scope and was not read as part of this audit's rule matrix (it is the human's
own instructions to the assistant, not project protocol). Per this item's own task text,
`AGENT_PROTOCOL.md` is treated as the authoritative home for binding rules; where a rule is
duplicated the correct fix is a pointer to `AGENT_PROTOCOL.md`, never deletion; any judgment call
about which of two live rules should win is reported here, not resolved unilaterally; no safety
rule, pre-registration requirement, multiple-comparisons rule, or gate threshold was touched.

**Method.** Read all five documents in full (`AGENT_PROTOCOL.md` is 654 lines; the rest are
1,600–19,500 bytes each). Extracted every file/script/threshold reference from each document and
checked it against the working tree and `git log --diff-filter=D` for demonstrable staleness.
Compared the frozen-path lists, the role-pipeline descriptions, and the "which document wins"
claims across documents against `.agent_state.json`'s actual current `control`/`blackboard`
shape and against the live `cajh-loop-check` scheduled-task definition (external to this repo,
at `~/.claude/scheduled-tasks/cajh-loop-check/SKILL.md`) as the ground truth for what the loop
actually does today.

**Rule matrix — duplicated rules.**

| Rule | Where it lives | Assessment |
|---|---|---|
| Live-trading safety invariants (never enable the live-trading env flag, halted-by-default, frozen-path change discipline, fail-closed on unknown state, never `git reset --hard`/`clean`/broad `checkout`/`restore`/force-push on work you don't own) | `AGENT_PROTOCOL.md` "Hard rules" §1–9 (loop/state-file mechanics framing) **and** `ARCHITECT_DIRECTIVE.md` §2.1–2.4 (substantive safety framing, richer detail — e.g. the explicit live-trading-flag prohibition and the fail-closed condition list have no equivalent verbatim in `AGENT_PROTOCOL.md`'s Hard rules) | Real overlap, but **not a verbatim duplicate** — each document states unique safety substance the other omits. Per this item's own "do not weaken, relax, or reword any safety rule" instruction, **left untouched in both places** rather than consolidated to a pointer; a human should decide whether `ARCHITECT_DIRECTIVE.md` §2 should become a pointer to `AGENT_PROTOCOL.md`'s Hard rules plus its own unique clauses, since collapsing safety-adjacent text is exactly the kind of edit this item was scoped to avoid making unilaterally. |
| `git pull --rebase` / commit-before-handoff / re-read state before writing discipline | `AGENT_PROTOCOL.md` Hard rules #5/#9, `ARCHITECT_DIRECTIVE.md` §2.3/§10, `AGENT_RUNBOOK.md` "Every run" #2, `AGENT_NOTES.md`'s dated incident entries (informal, narrative) | Same rule, four framings. `AGENT_NOTES.md`'s copies are historical incident narration (an agent explaining what it did/learned on a specific date), not restated instruction — those are fine as-is. The `AGENT_RUNBOOK.md`/`ARCHITECT_DIRECTIVE.md` copies are genuine restatements of `AGENT_PROTOCOL.md`'s rule; **not converted to pointers** in this pass because `AGENT_RUNBOOK.md` already opens with "`ARCHITECT_DIRECTIVE.md` and `AGENT_PROTOCOL.md` remain authoritative when anything differs," which functions as an implicit pointer, and further edits risked touching safety-adjacent prose for a purely cosmetic gain. |
| Windows `npm.cmd test`/`npm.cmd ci` invocation (not `npm test`/`npm install`) | `AGENT_PROTOCOL.md` Hard rule #7, `AGENT_RUNBOOK.md` "Every run" #3/#4 | Consistent across both, no contradiction, no stale content. No action needed. |

**Rule matrix — contradictions.**

| Contradiction | Evidence | Resolution |
|---|---|---|
| **Authority hierarchy is circular.** `ARCHITECT_DIRECTIVE.md`'s header states "This document is authoritative; where any earlier spec, queue note, or control block conflicts with it, this wins." `AGENT_RUNBOOK.md`'s header states "`ARCHITECT_DIRECTIVE.md` and `AGENT_PROTOCOL.md` remain authoritative when anything differs" (both, unordered). `AGENT_PROTOCOL.md` never explicitly claims supremacy over `ARCHITECT_DIRECTIVE.md`. | Each document's own text, read together. | **Reported, not resolved.** This item's own task text directs treating `AGENT_PROTOCOL.md` as authoritative for binding rules, which is applied throughout this audit, but that instruction doesn't itself amend `ARCHITECT_DIRECTIVE.md`'s self-declared authority claim — doing so is a governance decision for a human, not a stale-reference fix. |
| **Three-role pipeline (Architect → Executor → Verifier) is stale for the actual running loop.** `AGENT_RUNBOOK.md`'s "Executor handoff"/"Architect queue contract"/"Verifier handoff" sections and all of `ARCHITECT_DIRECTIVE.md` §3/§8/§9/§13 describe routing work through three separate role turns gated by `control.status` values `ARCHITECT_PENDING`/`EXECUTOR_PENDING`/`VERIFIER_PENDING`. `AGENT_PROTOCOL.md`'s "Full control" section (dated 2026-08-07, confirmed current: the live `cajh-loop-check` scheduled-task definition explicitly says "no role labels... you now design, implement, and self-check in one continuous pass") states this pipeline is retired for the live loop and kept only as historical record. `.agent_state.json`'s actual `control.status` values in current use are `"idle"`/`"BLOCKED"`, not the three-role enum. Grep confirms `ARCHITECT_PENDING`/`EXECUTOR_PENDING`/`VERIFIER_PENDING` appear only inside these three documents, nowhere in any script or the actual state file. | `git log -1` per file (`ARCHITECT_DIRECTIVE.md` last touched 2026-08-04, `AGENT_RUNBOOK.md`'s role-pipeline sections not revised since); `AGENT_PROTOCOL.md`'s "Full control" section, most recently confirmed live by the external scheduled-task definition this run is itself executing under. | **Reported, not resolved.** `AGENT_PROTOCOL.md` itself already says these older sections in *other* documents are "kept as historical record... still accurate for reasoning about why certain invariants exist, but they no longer describe current enforcement" — but that supersession notice lives only in `AGENT_PROTOCOL.md`, not as a pointer added to `AGENT_RUNBOOK.md`/`ARCHITECT_DIRECTIVE.md` themselves. Whether to add a superseded-notice to those two documents (mirroring `blackboard.frozen_paths_note`'s pattern) or leave them as intentional historical reference is a judgment call left for a human — not applied here since it's neither a verbatim-duplicate-to-pointer fix nor a dead-file-reference fix, the two categories this item authorized. |
| **Frozen-path file lists disagree across three sources.** `AGENT_PROTOCOL.md` Hard rule #6: 6 files (`scanner.js`, `monitor.js`, `trader.js`, `bot.js`, `strategy.js`, `backtest.js`). `ARCHITECT_DIRECTIVE.md` §2.2: 8 files (adds `storage.js` and `commands.js`). `.agent_state.json`'s `blackboard.frozen_paths` (the actual current list): 7 files (adds `commands.js` only, not `storage.js`). | Direct read of all three sources. | **Reported, not resolved** — this is safety-adjacent content (a list gating which files need `allow_live_edit`), explicitly out of scope for this item to edit even though `blackboard.frozen_paths_note` already states the list "no longer gates anything directly" for the live loop (only `scripts/check-protected-logic.cjs`'s identifier scan matters operationally now). The three lists disagreeing is a real documentation defect regardless of current operational moot-ness, and reconciling them is a human call. |

**Rule matrix — stale references (file/script/threshold no longer exists).**

| Reference | Location | Evidence it's stale | Action |
|---|---|---|---|
| `MOMENTUM_SPEC.md`, `FOLLOWON_SPECS.md`, `SIGNAL3_CLASSIFIER_SPEC.md` | `ARCHITECT_DIRECTIVE.md` Appendix B | Deleted in commit `3cb1264` ("remove settled research pre-registration specs"); confirmed absent from working tree. | **Fixed.** Appendix B rewritten to state which specs were removed, why, and in which commit, and to list only the two specs that remain (`SELF_AWARENESS_SPEC.md`, `VERDICT_TEMPLATE.md`). |
| `LOGIN_FIX_SPEC.md` | `ARCHITECT_DIRECTIVE.md` Appendix B | Deleted in commit `b8ec21d` ("remove resolved one-off specs"); confirmed absent. | **Fixed** — same edit as above. |
| `AGENTS_COORDINATION.md` | `AGENT_NOTES.md`, in a dated session-log entry ("`AGENTS_COORDINATION.md`'s scope agreement stands") | Merged into `AGENT_NOTES.md` itself in commit `ab52036` ("merge into single notes file, agree scope") — the file no longer exists because its content *is* this file. | **Fixed.** Reworded to "This file's scope agreement stands (formerly `AGENTS_COORDINATION.md`, merged into this single notes file in `ab52036`)" — corrects the dangling pointer without altering the historical narrative's substance. |
| `harvest.mjs` | `ARCHITECT_DIRECTIVE.md` Appendix C.2, as one of four example filenames illustrating "prefer new files over frozen ones" (`momentum.mjs`, `classifier.mjs`, `harvest.mjs`, `data.js`) | The other three examples exist and are live research modules; `harvest.mjs` has no creation or deletion commit in `git log` — it appears to have been an aspirational example name that was never built, not a file that "no longer exists." | **Not touched.** Low-confidence judgment call (aspirational placeholder vs. typo vs. abandoned plan) that doesn't change the rule's meaning either way; reported rather than guessed at. |
| `agent-orchestrator.ps1`, `agent-state-validator.ps1`, `security.test.mjs`, and other filenames inside `AGENT_NOTES.md`'s dated 2026-08-04 session-log entries | `AGENT_NOTES.md` | These are explicitly timestamped point-in-time snapshots of that day's `work_queue` state, not present-tense claims — several no longer exist in the working tree, which is expected and not misleading given the framing. | **Not touched** — correctly scoped as historical record already; editing them would misrepresent what the log entry actually documented at the time. |

**`AGENTS.md` vs `CLAUDE.md` observation (informational only, no action).** `AGENTS.md`'s four
numbered sections are near-verbatim identical to `CLAUDE.md`'s sections 1–4 (Think Before Coding,
Simplicity First, Surgical Changes, Goal-Driven Execution), differing mainly in that `CLAUDE.md`
has an additional "Output Style" section 5 and a longer closing sentence. `CLAUDE.md` is explicitly
out of scope for this item (it is the human's own instructions to the assistant, not project
protocol governed by `AGENT_PROTOCOL.md`), so no action was taken and none is recommended here —
noted only so a future pass doesn't rediscover the overlap from scratch.

**M5–P3 research gates in `AGENT_RUNBOOK.md`'s "Research guardrails" section** (sealed-holdout,
economic-view, verdict, pre-registration, forward-metric, classifier-matrix, logistic-model,
holdout/permutation gates) were checked for staleness against `blackboard.phase_directive_new_mechanism`'s
closure of the price-structure/Template-A program. These gates document general holdout/permutation
*methodology* standards, not the specific closed program, and remain independently citable if a
future momentum/equities/FX study reopens under new data — **left as-is**, no staleness found.

**Fixes applied this item:** `ARCHITECT_DIRECTIVE.md` (Appendix B stale-spec references corrected)
and `AGENT_NOTES.md` (one dangling `AGENTS_COORDINATION.md` pointer corrected). No safety rule,
pre-registration requirement, multiple-comparisons rule, or gate threshold was weakened, reworded,
or removed. No file deleted. `CLAUDE.md` untouched. Every contradiction and duplicated-rule finding
above that required a judgment call was left unresolved and is flagged in this section for a human
decision. `npm.cmd test`: run and confirmed green before commit (see commit for exact count).

---

## 2026-09-02 — FROZEN-PATH-LIST-RECONCILIATION-AUDIT: facts behind the three-way frozen-path disagreement

**Scope discipline.** This item does not reconcile the three lists — that choice gates which files
need `allow_live_edit`-equivalent care and is a governance decision reserved for the human, already
on their list per `AGENT-DOC-DEDUPLICATION`'s finding above. This item only separates the factual
question from that governance one: what each source actually says, which files are only in some of
them, what those files actually are today, and when the sources diverged. Nothing below was edited:
`AGENT_PROTOCOL.md`, `ARCHITECT_DIRECTIVE.md`, `.agent_state.json`'s `blackboard.frozen_paths`, and
`frozen_paths_note` are all read-only in this pass.

**The three lists, verbatim.**

| Source | Location | List |
|---|---|---|
| `AGENT_PROTOCOL.md` | Hard rule #6 (line 70) | `scanner.js`, `monitor.js`, `trader.js`, `bot.js`, `strategy.js`, `backtest.js` — **6 files** |
| `ARCHITECT_DIRECTIVE.md` | §2.2 (line 42) | `bot.js`, `scanner.js`, `strategy.js`, `trader.js`, `monitor.js`, `storage.js`, `commands.js`, `backtest.js` — **8 files** |
| `.agent_state.json` | `blackboard.frozen_paths` (current) | `scanner.js`, `monitor.js`, `trader.js`, `bot.js`, `strategy.js`, `backtest.js`, `commands.js` — **7 files** |

Ancillary finding, outside this item's scope but surfaced while reading the sources: `AGENT_PROTOCOL.md`
itself contains a *second*, internally inconsistent frozen-path list. Its own "Full control" section
(line 222–224, dated 2026-08-07) restates the frozen set as 7 files, adding `commands.js` — i.e. it
matches `blackboard.frozen_paths`, not its own Hard rule #6 three sections earlier. Not reconciled here
for the same scope reason as the cross-document disagreement.

**Files that don't appear in all three: `storage.js` and `commands.js`.**

| File | In which lists | Order-placement / live-trading-state logic? | Reached by the live bot path? | Contains any `scripts/check-protected-logic.cjs`-scanned identifier? |
|---|---|---|---|---|
| `storage.js` | `ARCHITECT_DIRECTIVE.md` only | No. Config/position/stats persistence (`config.json`, `positions.json` read/write) and a `DATA_DIR`-writability preflight check gating whether live trading may start at all. State-adjacent (the data live trading depends on), not order-placement or halt/resume logic itself. | Yes — `bot.js` (the `package.json` `"main"` entry point) imports it directly for config load/save and the preflight check. | No. Zero matches against the current identifier list (read from the script itself, not quoted here). |
| `commands.js` | `ARCHITECT_DIRECTIVE.md` and `blackboard.frozen_paths`, not `AGENT_PROTOCOL.md` | Yes. Exports the Discord command handlers that directly call into halt/resume and manual-sell logic. | Yes — `bot.js` imports and registers its handlers directly. | Yes — matches 4 of the 13 scanned identifiers (halt, resume, trading-enabled-check, and one order-placement call), read structurally from the script rather than from memory. |

Also noted in passing (not requested by this item, but relevant context): `strategy.js` and
`backtest.js` — present in **all three** lists with no disagreement — currently contain **zero**
matches against the scanned identifier list. This doesn't bear on the storage.js/commands.js question
and isn't a recommendation to change anything; it's left for whoever makes the reconciliation call to
weigh alongside the rest.

**Divergence history, from git.**

- **2026-07-30, 15:02:21.** `AGENT_PROTOCOL.md` Hard rule #6 (6 files, no `commands.js`, no `storage.js`)
  is written in commit `a54b0e3`, defining the original Architect/Executor/Verifier contract.
- **2026-07-30, 15:03:29 — 67 seconds later, same session.** `.agent_state.json` gains its
  `blackboard.frozen_paths` key for the first time, in commit `ca43049`, already listing **7** files —
  the same 6 plus `commands.js`. The two sources disagreed from the moment the second one was created;
  this was never a list that drifted apart over time.
- **2026-08-04, 06:42:42.** Commit `0b45be5` ("chore: queue p0 persistence remediation") extends
  `blackboard.frozen_paths` to 8 files, adding `storage.js` — briefly matching what `ARCHITECT_DIRECTIVE.md`
  would state 9 hours later.
- **2026-08-04, 15:41:44.** `ARCHITECT_DIRECTIVE.md` §2.2 is written in commit `758f3d2` ("Add
  spec/directive docs..."), independently enumerating 8 files (adding both `storage.js` and
  `commands.js` to the original 6) — a third independent enumeration, not copied from either
  existing source verbatim (order and grouping differ from both).
- **2026-08-04, 16:25:31 — 44 minutes later.** Commit `ca490e4` ("verifier: MR1 test failure...")
  rewrites `.agent_state.json`'s entire `blackboard` object as part of an unrelated state-file
  cleanup (also dropping several other blackboard keys — `verdict_integrity`, `bom_defect`,
  `red_baseline_rule`, `systemic_finding`, `strategy_selection_policy` — in the same rewrite). The
  new `frozen_paths` reverts to the original 7-file form from `ca43049`, incidentally losing
  `storage.js` again. The commit message does not mention `frozen_paths` at all — this reads as
  collateral effect of a broad blackboard rewrite, not a deliberate decision to drop `storage.js`.
- **From `ca490e4` (2026-08-04) to today (2026-09-02, ~314 intervening `.agent_state.json` commits):**
  `blackboard.frozen_paths` has stayed at the same 7 files. `AGENT_PROTOCOL.md` Hard rule #6 and
  `ARCHITECT_DIRECTIVE.md` §2.2 have not been touched since their creation commits above. The
  three-way (really four-way, counting `AGENT_PROTOCOL.md`'s own internal second list) disagreement
  has stood unresolved for roughly a month.

**Reconciliation options (characterized, not chosen — this is the human's call).**

1. **Adopt the operational list** (what `scripts/check-protected-logic.cjs` actually scans for,
   which is narrower and orthogonal to all three file lists — it matches identifiers anywhere in the
   repo, not a fixed file set). Would mean treating all three/four file-scoped lists as historical
   framing only, formalizing what `frozen_paths_note` already says informally. Implication: the
   file-list concept stops mattering operationally at all; only the hook's identifier scan gates
   anything. Cheapest to state, but changes what "frozen path" means going forward for humans reading
   the docs, not just for the loop.
2. **Adopt the broadest list** (`ARCHITECT_DIRECTIVE.md`'s 8: add `storage.js` back to
   `blackboard.frozen_paths` and to `AGENT_PROTOCOL.md` Hard rule #6). Implication: `storage.js`
   would be treated as needing the same care as the six/seven undisputed files, which is defensible
   given it gates the live-trading preflight check even though it currently contains none of the
   hook-scanned identifiers — a file can be safety-adjacent without containing today's protected
   identifiers if a future edit could add trading-state logic to it.
3. **Adopt the current operational list** (`blackboard.frozen_paths`'s 7: `commands.js` in,
   `storage.js` out) as authoritative, and update `AGENT_PROTOCOL.md` Hard rule #6 (add `commands.js`,
   also fixing its own internal inconsistency with its "Full control" section) and
   `ARCHITECT_DIRECTIVE.md` §2.2 (drop `storage.js`) to match. Implication: narrowest change from
   what's actually been in force the past month, but requires deciding `storage.js` doesn't belong,
   which cuts against option 2's reasoning above.
4. **Make one source authoritative, the others pointers** (e.g. `AGENT_PROTOCOL.md` states the list
   once, `ARCHITECT_DIRECTIVE.md` and the state file reference it by name rather than restating it).
   Implication: eliminates the possibility of future silent drift between copies, at the cost of an
   extra indirection for anyone reading only one of the documents.

**What is NOT unguarded while this is open.** `frozen_paths_note` (unedited by this item) already
states, and this audit confirms by direct reading of the hook script, that none of the three file
lists gates anything mechanically today. The only operational enforcement is
`scripts/check-protected-logic.cjs` via `.git/hooks/pre-commit`, which scans every staged diff — any
file, not scoped to any of these lists — for a fixed identifier set (the live-trading env gate,
the halt/resume state machine, and the order-validation chain) and refuses the commit without a
fresh human-created override marker. That scan is independent of which file-list version is
"correct" and is unaffected by leaving this reconciliation open.

`npm.cmd test`: run before this item, confirmed green (no code touched, no test-affecting change made).

## 2026-09-02 — PRE-REGISTRATION-COMPLIANCE-AUDIT: every formally pre-registered study is SAME-COMMIT-compliant — zero anomalies found across 24 scripts, with the method's own blind spot stated plainly

**Why this audit.** Pre-registration is this project's central honesty mechanism: study after study
asserts that its hypothesis, gate threshold, cost model, split, and seed were fixed in the script
header *before* any result was computed. Nothing had ever verified that claim from the actual git
record. This item does — read-only, git-history-and-header analysis only, no candles touched, no
backtest run, no study corrected or rewritten.

**Enumeration method (structural, not name-pattern).** A loose text search for "pre-registrat*"
(case-insensitive) matches 40 of the 60 files in `scripts/`, but most of those only use
"pre-registered" as a descriptive adjective inside an unrelated named section (`CONFIG —`,
`BAND WIDTH —`, `CONSTRUCT —`, a `// comment` on a constant) — there is no discrete block a reader
could point to as "this is what was frozen in advance." The structural criterion used here: a
literal, capitalized **`PRE-REGISTRATION`** heading functioning as its own section (with or without
`====` delimiters) — something excerptable as a stand-alone unit, independent of the file's name.
That criterion yields exactly **24 scripts**. The other 16 (`wider-hysteresis-band-cost-drag-
diagnostic.mjs`, `still-wider-hysteresis-band-active-address-diagnostic.mjs`,
`gdelt-wider-hysteresis-band-diagnostic.mjs`, `phase4-t4-momentum-portfolio-sim.mjs`,
`phase4-b5-portfolio-sim.mjs`, `active-address-count-primary-signal.mjs`,
`vol-contraction-sealed-validation.mjs`, `bos-short-equities-baseline.mjs`,
`vol-contraction-sample-extension.mjs`, `macro-regime-primary-signal-equities.mjs`,
`gdelt-news-sentiment-primary-signal.mjs`, `options-skew-data-depth-check.mjs`,
`macro-regime-primary-signal.mjs`, `equities-breakout-commission-floor-position-sizing.mjs`,
`per-epoch-gross-edge.mjs`, `zero-cost-floor-all-families.mjs`) reference pre-registration
informally (often citing another study's formal block by name) and are out of scope for the
per-script table below, but were spot-checked below anyway (see "Informal-mention files" below)
since 6 of them had a second commit worth checking.

**Method per script.** For each of the 24: `git log` (no `--follow`) to find every commit touching
the file; the oldest is the introduction commit. Extracted the literal `PRE-REGISTRATION` block text
at the introduction commit and at every later commit that touched the file, diffing consecutive
versions to find whether the block's content ever changed post-introduction. Cross-referenced
`ROADMAP.md`'s own `diff --stat` at the introduction commit to see whether the results write-up
landed in the same commit as the script.

**One `--follow` false positive caught and corrected.** An initial pass used `git log --follow`,
which uses content-similarity rename detection. For `macro-regime-equities-split-fraction-
diagnostic.mjs`, `--follow` chained it to the unrelated, merely-similar `macro-regime-primary-
signal-equities.mjs` (2026-08-25) as a fabricated "prior version," making the file falsely appear
to have gained its `PRE-REGISTRATION` block two days after introduction — which would have been
this audit's one ANOMALOUS finding. Re-run without `--follow` (exact path only) shows the file has
exactly one commit (`ff9ef704`, 2026-08-27) and the block was present in it from the start. Recorded
here because it is exactly the kind of false lead a less careful pass through git history could
report as a real finding; `--follow`-based rename detection should not be trusted for this project's
convention of near-duplicate diagnostic-variant scripts without cross-checking `git show <hash>:<path>`
actually resolves in that commit.

**Result: all 24 are SAME-COMMIT, zero ANOMALOUS.** Every one of the 24 scripts was introduced in a
single commit that simultaneously added the script (with its `PRE-REGISTRATION` block already
present, in full) *and* the corresponding `ROADMAP.md` write-up recording the result. None of the 24
blocks have been modified in any later commit — the only later touches (9 of the 24 files, all via
one commit, `450677c5`, 2026-09-01) were `DOCS-ARCHIVE-CONVENTION`'s citation repoint (`ROADMAP.md`
→ `ROADMAP_ARCHIVE.md` in a `SOURCED FROM:` comment outside the block), not edits to any
pre-registered hypothesis, threshold, seed, or config value. Per this project's own convention
(stated explicitly in several of the blocks themselves, e.g. `equities-madip-significance.mjs`),
SAME-COMMIT is the *normal* pattern here, not a deviation, and is compliant provided — as verified
above — the block was never edited after landing.

| # | Script | Intro commit | Date | Block present at intro | Block modified since | ROADMAP.md in same commit | Class |
|---|---|---|---|---|---|---|---|
| 1 | `equities-breakout-significance.mjs` | `af555ef07d` | 2026-08-21 | yes | no | yes | SAME-COMMIT |
| 2 | `equities-breakout-out-of-sample.mjs` | `698688e63b` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 3 | `equities-madip-out-of-sample.mjs` | `bcf1cd95b0` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 4 | `equities-madip-significance.mjs` | `473a185186` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 5 | `log-regression-bands-equities.mjs` | `a1430df8ff` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 6 | `log-regression-bands-crypto.mjs` | `a833d6ae6f` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 7 | `spectral-cycle-detection-crypto.mjs` | `8506359e12` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 8 | `spectral-cycle-detection-equities.mjs` | `84e52d86a1` | 2026-08-22 | yes | no | yes | SAME-COMMIT |
| 9 | `phase3-b5-reversal-rerun.mjs` | `e742eb37a8` | 2026-08-13 | yes | no | yes | SAME-COMMIT |
| 10 | `macro-regime-equities-split-fraction-diagnostic.mjs` | `ff9ef70403` | 2026-08-27 | yes | no | yes | SAME-COMMIT |
| 11 | `cross-family-trade-overlap-audit.mjs` | `d14a319722` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 12 | `date-clustered-resampling-audit.mjs` | `f837295daf` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 13 | `madip-random-entry-control.mjs` | `e3816ae5d4` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 14 | `madip-realised-r-condition-2.mjs` | `98d1caa872` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 15 | `madip-survivability-condition-5.mjs` | `0a6fa21dc5` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 16 | `required-sample-for-durable-pass.mjs` | `78f879ee3d` | 2026-08-28 | yes | no | yes | SAME-COMMIT |
| 17 | `date-clustered-resampling-djta20.mjs` | `74989abc5d` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 18 | `c0-signal-combination.mjs` | `e294b66996` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 19 | `c2-continuous-macro-conditioner.mjs` | `c5d526c969` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 20 | `breakeven-lock-counterfactual.mjs` | `3e81c2a068` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 21 | `equities-breadth-vs-random-entry-null.mjs` | `51190e077b` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 22 | `geometry-null-down-window-probe.mjs` | `e5a3a0712d` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 23 | `random-entry-null-window-sensitivity.mjs` | `5b1269bb16` | 2026-08-29 | yes | no | yes | SAME-COMMIT |
| 24 | `crypto-effective-sample-audit.mjs` | `06564b092d` | 2026-09-01 | yes | no | yes | SAME-COMMIT |

**Counts by class.** COMPLIANT (block landed in a commit strictly before its results commit): **0**.
SAME-COMMIT (block and results landed together, block never edited after): **24**. ANOMALOUS (block
modified between run and publication, or added after results were recorded): **0**. This project's
own convention is evidently to write the script (block included) and the write-up in one sitting and
commit them together — COMPLIANT-in-the-strict-sense essentially cannot occur here structurally,
which is worth naming rather than treating 0 as a gap.

**Informal-mention files, spot-checked.** Of the 16 files that mention pre-registration informally
(no discrete block), 6 have a second commit: `wider-hysteresis-band-cost-drag-diagnostic.mjs`,
`still-wider-hysteresis-band-active-address-diagnostic.mjs`, `gdelt-wider-hysteresis-band-
diagnostic.mjs`, `phase4-t4-momentum-portfolio-sim.mjs`, `phase4-b5-portfolio-sim.mjs`,
`active-address-count-primary-signal.mjs`. All 6 second commits are the same `450677c5` archive
citation repoint, confirmed by direct diff to touch only `ROADMAP.md`/`ROADMAP_ARCHIVE.md` citation
text in comments, never a pre-registered parameter, config, or threshold value. No further action
warranted; these 16 were not table-enumerated because they carry no discrete block to classify, per
the structural criterion above — the finding here is only that none of their informal pre-
registration mentions were touched post-introduction either.

**What this method cannot prove — stated plainly, not glossed over.** Git history proves a
`PRE-REGISTRATION` block was never *retroactively edited* after being committed. It cannot prove the
number quoted as "pre-registered" wasn't computed first, in the same working session, with the block
text written to match afterward, all before a single commit — same-commit compliance is necessary
but not sufficient for the underlying honesty claim, and no git-history method can close that gap.
This is exactly the "compliant provided the block was not edited after the run" caveat this item's
own task text anticipated, and it is the reason SAME-COMMIT is reported as its own class rather than
folded into COMPLIANT: the two are not the same guarantee. Within what git history *can* check, the
result is unambiguous: zero blocks were ever edited after landing, across all 24.

**Expected-clean-result honesty check.** This audit went in expecting a clean bill (per the task's
own framing) and did not go looking for a scandal — but the one candidate anomaly it did surface
(`macro-regime-equities-split-fraction-diagnostic.mjs`, via the `--follow` false positive) was
chased down and disproven rather than reported uninvestigated, and is documented above precisely
because a less careful pass could have shipped it as a real finding. The actual result — 24/24
SAME-COMMIT, 0/24 ANOMALOUS — is reported exactly that plainly.

**Corrected:** nothing. **Edited:** no study write-up. **Follow-up:** none needed — no anomaly
survived investigation. `npm.cmd test`: 513/513 green, run before this entry was written.

## 2026-09-02 — CORRECTION-FAMILY-COUNTER-AUDIT: the formal-NHST family's n=22 and every published q-value independently reconfirmed — zero arithmetic errors, one documentation-completeness gap named

Pre-registered task (`.agent_state.json` work_queue): independently reconstruct
`MULTIPLE_COMPARISONS_AUDIT.md` §2's formal-NHST correction family from `ROADMAP.md`/
`ROADMAP_ARCHIVE.md` — not from the audit document itself — and check its stated family size
(22), its per-study p-values, and its published BH-FDR q-values against that independent
reconstruction. WHY: every q-value this project has ever published depends on this counter, a
single miscount would shift every q in the table, and the counter itself had never been
independently audited before this item. This item does **not** propose narrowing, splitting, or
re-scoping the family — `ALPHA_DEFINITION.md` §4b's prohibition on narrowing the correction
family binds here in full, and the question was only ever whether the count of what is already
in the family is arithmetically right.

**Method.** Enumerated every study in `ROADMAP.md`/`ROADMAP_ARCHIVE.md` that reports a raw
p-value against a pre-registered significance gate, working from those two files' dated
sections directly (grepping for `permutation test`, `sign-flip`, `meanIC=`/`block-perm p`,
`significance gate`, and `p=0.` patterns) rather than copying `MULTIPLE_COMPARISONS_AUDIT.md`'s
own table. Cross-checked every study found this way against `VERDICTS.md` for a second,
independent citation. Then compared the reconstructed list against the audit document's stated
22-entry table, and independently recomputed Benjamini-Hochberg from the 22 raw p-values by
hand (standard step-up: `q_(i) = min_{k>=i}(p_(k) * n / k)`, running minimum from the largest
rank down), comparing every resulting q-value against the published one.

**Reconstruction result: 22 sub-tests across 19 studies, matching the audit's stated count
exactly.** Full per-study table, with each p-value's source location verified by direct read of
the original write-up (not the audit document's transcription of it):

| Rank (by p) | Study / sub-test | Raw p | Verified against | Match? |
|---:|---|---:|---|---|
| 1 | LOG-REGRESSION-BANDS-CRYPTO (holdout, primary) | 0.0002 | `ROADMAP_ARCHIVE.md:3956` | yes |
| 2 | B5-REVERSAL L=3 (train) | 0.0010 | `ROADMAP_ARCHIVE.md:776` | yes |
| 3 | CLASSIFIER-FUNDING-FEATURE (holdout, primary) | 0.0099 | `ROADMAP_ARCHIVE.md:822` | yes |
| 4 | EQUITIES-MADIP-OUT-OF-SAMPLE (holdout, primary) | 0.0116 | `ROADMAP_ARCHIVE.md:4106` | yes |
| 5 | Classifier P5 (holdout, primary) | 0.0198 | `ROADMAP_ARCHIVE.md:620` | yes |
| 6 | C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES | 0.0365 | `ROADMAP.md:2111,2120` | yes |
| 7 | Low-vol B4 negBeta (train) | 0.0579 | `ROADMAP_ARCHIVE.md:516,498` | yes |
| 8 | EQUITIES-MADIP-SIGNIFICANCE (holdout, primary) | 0.0648 | `ROADMAP_ARCHIVE.md:3488` | yes |
| 9 | CROSS-SECTIONAL-NONPRICE-RANK (train, OI-change IC) | 0.1249 | `VERDICTS.md` row + commit `0583013` — **no dated `ROADMAP.md`/`ROADMAP_ARCHIVE.md` section exists for this study** (see finding below) | yes (value), gap (source) |
| 10 | EQUITIES-BREAKOUT-SIGNIFICANCE (holdout, primary) | 0.2036 | `ROADMAP_ARCHIVE.md:2550` | yes |
| 11 | Low-vol B4 negVol (train) | 0.2278 | `ROADMAP_ARCHIVE.md:515,495` | yes |
| 12 | B5-REVERSAL L=5 (train) | 0.4226 | `ROADMAP_ARCHIVE.md:779` | yes |
| 13 | MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train) | 0.4266 | `ROADMAP_ARCHIVE.md:1428,1436` | yes |
| 14 | C0-SIGNAL-COMBINATION | 0.4708 | `ROADMAP.md:1906` | yes |
| 15 | MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train) | 0.6024 | `ROADMAP_ARCHIVE.md:1424,1435` | yes |
| 16 | EQUITIES-BREAKOUT-OUT-OF-SAMPLE (holdout, primary) | 0.6165 | `ROADMAP_ARCHIVE.md:3685` | yes |
| 17 | Momentum M7 (train, residual IC) | 0.7013 | `ROADMAP_ARCHIVE.md:376,399` | yes |
| 18 | GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL (holdout, primary) | 0.7113 | `ROADMAP_ARCHIVE.md:4692` | yes |
| 19 | STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC | 0.7183 | `ROADMAP_ARCHIVE.md:5025` | yes |
| 20 | WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC | 0.9251 | `ROADMAP_ARCHIVE.md:4944` | yes |
| 21 | LOG-REGRESSION-BANDS-EQUITIES (holdout, primary) | 0.9750 | `ROADMAP_ARCHIVE.md:4503` (cites its own §2 addition) | yes |
| 22 | ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL (holdout, primary) | 0.9990 | `ROADMAP_ARCHIVE.md:4867,4885` | yes |

Every raw p-value quoted in `MULTIPLE_COMPARISONS_AUDIT.md` §2's table reproduces exactly against
the original study write-up, to the digit, in all 22 cases.

**Independent BH-FDR recomputation, by hand, from these 22 raw p-values (not copied from the
audit document):** using the standard step-up adjusted-p formula, computed `p_(i) * 22 / i` for
every rank, then took the running minimum from rank 22 down to rank 1. Result for the ranks the
audit document states explicitly:

| Rank | Study | This item's independently computed q | Audit's published q | Match? |
|---:|---|---:|---:|---|
| 1 | LOG-REGRESSION-BANDS-CRYPTO | 0.0044 | 0.0044 | yes |
| 2 | B5-REVERSAL L=3 | 0.0110 | 0.0110 | yes |
| 3 | CLASSIFIER-FUNDING-FEATURE | 0.0638 | 0.0638 | yes |
| 4 | EQUITIES-MADIP-OUT-OF-SAMPLE | 0.0638 | 0.0638 | yes |
| 5 | Classifier P5 | 0.0871 | 0.0871 | yes |
| 6 | C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES | 0.1338 | 0.1338 | yes |
| 7 | Low-vol B4 negBeta | 0.1782 | (audit gives range 0.1782–0.9990 for ranks 7–22, not itemized) | consistent — 0.1782 is this range's own lower bound |
| 22 | ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL | 0.9990 | (same range) | consistent — 0.9990 is this range's own upper bound |

All 22 ranks were computed, not just the ones itemized above (ranks 8–21 fall strictly between
0.1782 and 0.9990, monotonically non-decreasing, exactly as the BH step-up procedure requires —
full 22-row vector available by re-running the same arithmetic, not reproduced in full here since
the audit document doesn't itemize ranks 7–22 individually either, only the ones a status flip
touched). **Zero discrepancies found between this independent recomputation and the published
q-values, at any rank checked.** The two formally-surviving sub-tests at q=0.05
(`LOG-REGRESSION-BANDS-CRYPTO`, `B5-REVERSAL L=3`) are confirmed correct by this independent
arithmetic, as is the non-survival of every other entry, including the four (`CLASSIFIER-
FUNDING-FEATURE`, `EQUITIES-MADIP-OUT-OF-SAMPLE`, `Classifier P5`, `C2-CONTINUOUS-MACRO-
CONDITIONER-EQUITIES`) whose q-values have moved across updates as the family grew.

**AGENT_PROTOCOL.md cross-check.** Its "Multiple-comparisons discipline" section states the same
family size (22 sub-tests, 19 studies as of 2026-08-29) — consistent with both
`MULTIPLE_COMPARISONS_AUDIT.md` and this item's independent reconstruction. No discrepancy across
the three sources.

**One finding, not an arithmetic error: `CROSS-SECTIONAL-NONPRICE-RANK` (rank 9, p=0.1249) has no
dated write-up section in `ROADMAP.md` or `ROADMAP_ARCHIVE.md`.** Every other entry in the family
has its own `## <date> — STUDY-NAME` (or equivalent `###` sub-)section in one of the two roadmap
files, which is how this item verified the other 21 p-values against source. This one does not —
searched by exact identifier, by its module name (`cross-sectional-nonprice-rank.mjs`, confirmed
to live at the repo root, not under `scripts/`), and by section header pattern; it appears in
both files only as an inline mention inside *other* studies' bucket-lists (e.g.
`ROADMAP_ARCHIVE.md:2396`, a cost-sensitivity study's classification table), never as its own
dated entry. The study is still fully traceable — its own `VERDICTS.md` row (quoting train
meanIC=-0.0395, p=0.1249, q=0.2498 at the time it joined) and its introducing commit (`0583013`,
2026-08-19, message quotes the identical p=0.1249) both independently confirm the value used in
the family table — so this is **not** a membership question and nothing here is being narrowed,
added, or re-scoped. It is a documentation-completeness gap: one family member is reconstructible
from `VERDICTS.md` and git history but not from `ROADMAP.md`/`ROADMAP_ARCHIVE.md` the way every
other member is. Recommended as a small follow-up for whichever future item next touches
`ROADMAP.md` citation gaps (the same class of issue `DEAD-CODE-AND-ASSET-AUDIT`, 2026-09-01,
found and fixed for `scripts/` path citations) — not actioned here, since this item's scope is
the counter's arithmetic, not roadmap completeness.

**No study found reporting a p-value against this family's null while absent from the family.**
Checked the adjacent candidates explicitly: `EQUITIES-BREAKOUT-SIGNIFICANCE`'s and
`EQUITIES-BREAKOUT-OUT-OF-SAMPLE`'s `anticipate` negative controls (p=0.6701, p=0.1310) are
correctly excluded — both write-ups state explicitly that a negative control's p-value "gates no
decision" and does not join the family, since no candidate hypothesis is under evaluation for
`anticipate` in either case. `MACRO-REGIME-PRIMARY-SIGNAL` and its two follow-ons
(`MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES`, `MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC`) never
compute a p-value at all — each closes as a sample-size non-verdict (1 holdout regime episode,
below the pre-registered n>=8 floor) before the statistical test ever runs, confirmed by reading
each section directly (no `p=` anywhere in any of the three). `SPECTRAL-CYCLE-DETECTION-CRYPTO`
explicitly self-excludes with its own stated reasoning (7,150 pooled within-study p-values,
corrected internally by its own BH-FDR pass, zero survivors — "does **not** join
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST cross-study family... there is nothing here to add
to it"), the same pattern the audit document's own §1 table already documents for
`PAIRS-COINTEGRATION-STATARB`'s internal 105-pair screen. No membership gap found in either
direction.

**No entry present in the family without a traceable study.** All 22 rows resolved to a real,
dated (or, for the one exception above, git-history-dated) source with a matching raw p-value.

**Verdict: the family-size counter (22) is correct, and every published q-value this item checked
survives independent recomputation.** Nothing corrected — there was no arithmetic to correct.
Membership: no narrowing, splitting, or re-scoping proposed or found warranted; the one gap found
(`CROSS-SECTIONAL-NONPRICE-RANK`'s missing dated section) is a documentation-completeness question,
reported per this item's own instruction to report rather than act on anything outside strict
arithmetic correction. `npm.cmd test`: 513/513 green (read-only audit — no code touched).

## 2026-09-02 — VERDICTS-ROW-WRITEUP-RECONCILIATION

BOOKKEEPING/INTEGRITY, not new research — not caught by D1. Checked every one of VERDICTS.md's
67 data rows (the file's own row count as of this item, not the 90-line estimate the work_queue
entry guessed from the file's line count including header prose) against the dated write-up it
cites, using six parallel read-only reconciliation agents (11-12 rows each) followed by direct
verification of every gap they surfaced.

**Scope note, disclosed up front:** the work_queue task text named `ROADMAP.md` and
`ROADMAP_ARCHIVE.md` as the two files to search before calling a row `UNSOURCED`. Running the
first pass against exactly those two files produced 36 `UNSOURCED` findings — an implausibly high
fraction (54%) for a project whose evidence discipline has held up clean on every other audit this
month. Before accepting that headline, the actual write-ups for all 36 were searched for in
`TOURNAMENT_ROADMAP.md`, the third document `VERDICTS.md`'s own preamble names as a canonical
verdict source (verdicts were split across `ROADMAP.md`, `TOURNAMENT_ROADMAP.md`, and
`.agent_state.json`, per that preamble). 29 of the 36 were found there, full dated sections, with
every checkable figure matching. Treating those 29 as `UNSOURCED` would have been a false headline
produced by an incomplete task specification, not a real finding — so this item expanded its own
search scope to all three files rather than report a number it already knew to be wrong. This is a
disclosed deviation from the literal task text, not a silent one, and it narrows the genuine gap
from 36 to 7 real candidates (of which 6 confirmed absent from all three files below).

### Classification summary (67/67 rows)

| Classification | Count |
|---|---|
| AGREES — sourced in ROADMAP.md/ROADMAP_ARCHIVE.md, figures match | 31 |
| AGREES — sourced only in TOURNAMENT_ROADMAP.md, figures match (citation-gap, not corrected here) | 29 |
| DIVERGES — corrected in this commit | 1 |
| UNSOURCED — no dated write-up in any of the three documents | 6 |
| Total | 67 |

No verdict classification changed anywhere. No figure re-derived by backtest.

### DIVERGES (1) — corrected

**T3-REGIMEFILTER** (VERDICTS.md, row for 2026-08-07, commit 4d63fd8). The row's deciding-metric
field read: Holdout avgR -0.379 vs -0.437 unfiltered (gate: >-0.10 required). Its write-up
(TOURNAMENT_ROADMAP.md, Track 3 — RESULT, 2026-08-07) states explicitly, same date, in its own
text that -0.437 predates the larger/updated watchlist Track 1 actually ran against, that the two
numbers were previously cited interchangeably there, and that this was corrected the same day
(2026-08-07) — Track 1's own actual run reports breakout's unfiltered holdout avgR as **-0.445**,
not -0.437. VERDICTS.md never picked up that same-day correction. This is not ambiguous wording or
a suspect write-up — the source document unambiguously supersedes its own number, dated the same
day as the row it feeds. Corrected VERDICTS.md's comparison figure from -0.437 to -0.445,
annotated with today's date and this item as source, per the task's own instruction to correct
only where the write-up unambiguously contradicts the row. The row's own figure (-0.379), verdict
(FAIL), holdout n (1408) and commit were already correct and are unchanged.

### UNSOURCED (6) — no dated write-up found in ROADMAP.md, ROADMAP_ARCHIVE.md, or TOURNAMENT_ROADMAP.md

| ID | Row date | What exists instead |
|---|---|---|
| MR1 | 2026-08-05 | One incidental commit-message cross-reference (ROADMAP.md:3720) and a file-inventory table row (rsi-reversion-study.mjs). git show 0bfc60c confirms a test-fixture-coverage commit consistent with "Implemented, not promoted" — no dated hypothesis write-up anywhere. |
| DCA-MARTINGALE | 2026-08-08 | Commit adaef56 touches only code/test files (git show --stat confirms no markdown). Full-history search (git log --all -p -S "DCA-MARTINGALE" -- *.md) finds only the VERDICTS.md row itself and passing list-mentions. Figures exist only in the commit message. |
| DCA-ANTIMARTINGALE | 2026-08-08 | Same pattern as DCA-MARTINGALE; commit 80ce307, code-only, no markdown touched. |
| GRID-SIM | 2026-08-08 | Commit 5af61dc, code-only (grid.mjs/grid.test.mjs); two passing mentions in ROADMAP_ARCHIVE.md (inside H11's write-up and a summary list), no dedicated section. Checked TOURNAMENT_ROADMAP.md too — no match beyond unrelated fee/ATR grid sweeps. |
| PAIRS-COINTEGRATION-STATARB | 2026-08-19 | Zero hits in any of the three files beyond passing mentions (a retrospective bullet inside COST-COMPONENT-ATTRIBUTION that itself cites VERDICTS.md as its source — circular, not independent) and its own VERDICTS.md row's Bottom-line summary paragraph. Confirmed absent from TOURNAMENT_ROADMAP.md by direct grep (no match). |
| CROSS-SECTIONAL-NONPRICE-RANK | 2026-08-19 | Already identified as a gap by CORRECTION-FAMILY-COUNTER-AUDIT (2026-09-02, commit 96ef19e) — not a new finding, reproduced independently here by this item's own search before checking that prior audit's text. Traceable only via its VERDICTS.md row and introducing commit 0583013. |

None of these six is a numeric contradiction — each is a study that was implemented, committed,
and (for the four with real commits) run, but never received its own dated section in any of the
three roadmap documents. MR1's row already reads "Implemented, not promoted" rather than a formal
verdict, consistent with never having a write-up. The four with real trade data
(DCA-MARTINGALE, DCA-ANTIMARTINGALE, GRID-SIM figures; PAIRS-COINTEGRATION-STATARB's negative
relationship-screen result) are recorded nowhere except their own commit messages and their
VERDICTS.md row — the row is, today, the only durable record of what happened. Not corrected; per
the task's own scope this is a documentary-completeness question, reported rather than resolved.
A follow-up could either (a) promote each row's own text into a proper dated
ROADMAP.md/ROADMAP_ARCHIVE.md section reconstructed from the commit plus row, or (b) accept the
VERDICTS.md row itself as the canonical record for infra-scale items that were never meant to get
a full write-up — that judgment call is left open rather than made here.

### AGREES — sourced only in TOURNAMENT_ROADMAP.md (29), citation gap not corrected

Every figure checked in all 29 matched its TOURNAMENT_ROADMAP.md write-up exactly (verdict,
deciding metric, holdout n, date). Three rows (ATR-ADAPTIVE-STOP-CONFIRMATORY,
WIDE-STOP-HIGH-TARGET-ASYMMETRY, SCALED-EXIT-LADDER-CONFIRMATORY) already say in their own
VERDICTS.md text to see TOURNAMENT_ROADMAP.md for the full grid; the other 26 give the reader no
hint that the write-up lives outside ROADMAP.md/ROADMAP_ARCHIVE.md. This is the same class of
citation gap DEAD-CODE-AND-ASSET-AUDIT (2026-09-01) found and fixed for scripts/ path citations,
applied here to a different pair of documents. Not corrected in this pass — adding a file pointer
to 26 rows is a larger, mechanical edit better run as its own dedicated item (touching VERDICTS.md
at scale, same reasoning WORK-QUEUE-RETENTION-PASS-2 used for running a large-object rewrite as a
dedicated firing) rather than folded into a reconciliation pass whose own done_when is about
figures, not citations. Full list: Roadmap v2 (rejected), T1-ZEROCOST, T1B-BREAKOUT-COSTFIX,
T2-VOLCONTRACTION, T4-PORTFOLIO-MOMENTUM, T4-COVERAGE-FIX, T5-DECAY-EXIT, T6-TIMEFRAME-ISOLATION,
TRAIL-STOP-EXIT, H3-HIGHER-LOW-RECLAIM, RANGE-SWEEP-RECLAIM, TREND-GATE-MA, TREND-GATE-STRUCTURE,
PORTFOLIO-LIVE-SIGNAL-SIM, FUNDING-MEANREV, ONCHAIN-FLOW-GATE, FIB-PULLBACK, VOL-CONFIRM-BREAKOUT,
ATR-ADAPTIVE-STOP-CONFIRMATORY, WIDE-STOP-HIGH-TARGET-ASYMMETRY, SCALED-EXIT-LADDER-CONFIRMATORY,
T4-PORTFOLIO-MOMENTUM-PHASE4, OPEN-INTEREST-TREND-CONFIRMATION, LIQUIDATION-CASCADE-REVERSAL,
FUTURES-BASIS-DIRECTIONAL-SIGNAL, LONG-SHORT-RATIO-CONTRARIAN, TOP-TRADERS-DIVERGENCE,
ORDER-FLOW-AGGRESSOR-IMBALANCE, ROLLING-VOLATILITY-REGIME-TIMING.

Minor, non-blocking observations noted in passing (not corrected, none is a checkable field):
four rows (H11, PWR3, PWR4, T4-COVERAGE-FIX) carry commit-field placeholders like
"(PWR3 commit)" where a real resolvable short hash exists (e511b73, 9837597, d304419,
9a34c82 respectively) — cosmetic, left for whoever next touches these rows at scale.

### AGREES — sourced directly in ROADMAP.md/ROADMAP_ARCHIVE.md (31)

Trade intensity, Momentum M7, Low-vol B4, Classifier P5, PWR3, PWR4, H11, B5-REVERSAL,
CLASSIFIER-FUNDING-FEATURE, B5-REVERSAL-PHASE3-FUTURES-COST, B5-REVERSAL-PHASE4-PORTFOLIO-SIM,
FUNDING-CARRY-DECAY-CHECK, MOMENTUM-SHORT-HORIZON-RECHECK, MACRO-REGIME-PRIMARY-SIGNAL,
LOG-REGRESSION-BANDS-CRYPTO, SPECTRAL-CYCLE-DETECTION-CRYPTO, SPECTRAL-CYCLE-DETECTION-EQUITIES,
LOG-REGRESSION-BANDS-EQUITIES, MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES,
GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL, ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL,
WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC, STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC,
MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC, EQUITIES-BREAKOUT-OUT-OF-SAMPLE,
EQUITIES-ALL-FAMILIES-BASELINE, EQUITIES-COST-ASSUMPTION-SENSITIVITY, C0-SIGNAL-COMBINATION,
C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES, VOL-CONTRACTION-CASE-CLOSURE.

One row in this group, **Order-flow** (pre-2026-08-04), agrees on its checkable fields but its
write-up itself (ROADMAP_ARCHIVE.md, 2026-07-30 (night) section) contains one unsupported
sub-claim flagged in passing, not corrected: the closing line "Big-print share: nothing anywhere"
has no supporting test, feature definition, or data table anywhere in that section — no big-print
signal is ever defined or measured before that one sentence. This does not affect the row's
overall verdict (Complete, no edge, consistent with the section's three other, fully-supported
sub-findings) and is reported per the task's write-up-looks-suspect category rather than treated
as a row-level DIVERGE, since the row does not misstate anything the write-up actually supports.
One row in this group, **H11**, agrees on every field the write-up states, but the row's specific
gate thresholds (train trades>=200 and holdout trades>=80, both avgR>0, holdout positive-asset
rate>=50%) were not found restated anywhere in ROADMAP.md/ROADMAP_ARCHIVE.md/TOURNAMENT_ROADMAP.md
text — likely defined in funding-gate-h11.mjs's own pre-registration comment, outside this
audit's document scope. Not a contradiction, just unverifiable from the cited prose alone.

npm.cmd test: 513/513 green (documentary reconciliation, one VERDICTS.md figure corrected, no code touched).

## 2026-09-02 — AUTHORITY-HIERARCHY-FACTUAL-AUDIT: facts behind the circular authority claim — latent, not active; no edit made

**Scope discipline.** Same pattern as `FROZEN-PATH-LIST-RECONCILIATION-AUDIT` above: this item does
not resolve which document governs — that is a governance decision reserved for the human, already
on their list per `AGENT-DOC-DEDUPLICATION`'s finding. This item only establishes the facts: what
each document claims, when each claim was written, whether the circularity has ever actually forced
an agent to choose, and which document the live loop behaves as though it treats as binding. Nothing
was edited: `ARCHITECT_DIRECTIVE.md`, `AGENT_RUNBOOK.md`, and `AGENT_PROTOCOL.md` are all read-only
in this pass.

**The three claims, verbatim.**

| Document | Location | Claim |
|---|---|---|
| `ARCHITECT_DIRECTIVE.md` | Header, lines 3–4 | "This document is authoritative; where any earlier spec, queue note, or control block conflicts with it, this wins." |
| `AGENT_RUNBOOK.md` | Header, lines 3–4 | "`ARCHITECT_DIRECTIVE.md` and `AGENT_PROTOCOL.md` remain authoritative when anything differs." (both named, unordered — no tiebreaker between them) |
| `AGENT_PROTOCOL.md` | Line 1, and throughout | Line 1 self-describes as "Binding contract for all three agents in this repo." Read in full (679 lines, every section) — it never once mentions `ARCHITECT_DIRECTIVE.md` by name, and never claims supremacy over it. Confirmed by `git log -p` across all 36 commits in this file's history: the string `ARCHITECT_DIRECTIVE` does not appear anywhere in the file's history, added or removed. |

The circularity as originally reported by `AGENT-DOC-DEDUPLICATION`: `ARCHITECT_DIRECTIVE.md` claims
supremacy over `AGENT_RUNBOOK.md`; `AGENT_RUNBOOK.md` claims `ARCHITECT_DIRECTIVE.md` and
`AGENT_PROTOCOL.md` are both authoritative with no order between them; `AGENT_PROTOCOL.md` makes no
claim about either. It is not a three-way cycle in the strict graph sense (`AGENT_PROTOCOL.md` points
at nothing) — it is one document asserting unilateral supremacy, a second naming two co-equal
authorities including the first, and a third staying silent while being the one the loop actually
uses. Confirmed accurate on rereading all three documents in full for this item.

**Dating each claim from git history.**

- `ARCHITECT_DIRECTIVE.md`'s authority claim was written in the file's creation commit, `758f3d2`
  (2026-08-04). The file was touched once since, by `AGENT-DOC-DEDUPLICATION` on 2026-09-01
  (`2cfcce9`) — that commit's diff (checked directly) only rewrote Appendix B's dead-spec-file list;
  it did not touch lines 1–4. The authority claim is unchanged since 2026-08-04, roughly one month.
- `AGENT_RUNBOOK.md`'s authority claim was written in the file's creation commit, `d6ce4a8`
  (2026-08-04, same day). `git log -p --follow` across all 16 commits touching this file shows the
  claim line appearing only as unchanged context in every later diff (most recently `cd74a03`,
  2026-08-19, which edited a different section) — never as an added or removed line. Unchanged since
  creation.
- `AGENT_PROTOCOL.md` was created six days earlier, `a54b0e3` (2026-07-30), and has been revised 36
  times since, most recently `5b6e860` (2026-09-02, this same date) — it is by a wide margin the most
  actively maintained of the three. Its "Full control" section (added `1dab9c2`, 2026-08-07) is the
  document that actually records the point where the live `cajh-loop-check` loop stopped using the
  three-role Architect/Executor/Verifier pipeline the other two documents still describe in full.
  Neither `ARCHITECT_DIRECTIVE.md` nor `AGENT_RUNBOOK.md` has been revised since that date to
  acknowledge the pipeline they describe is no longer how the live loop runs — `AGENT-DOC-DEDUPLICATION`
  already flagged this staleness as a separate, related finding.

**Has the circularity ever changed an outcome?** Searched `ROADMAP.md`, `ROADMAP_ARCHIVE.md`, the
current `.agent_state.json` ledger (100 entries), and the full git history of `.agent_state.json`'s
`control` blocks for any case where two of these three documents gave conflicting guidance and an
agent had to pick, or reported being unsure which governed. **Found nothing.** Every citation of one
of these documents as "binding" or "authoritative" found in the record — and there are dozens, mostly
in the multiple-comparisons discipline section of `AGENT_PROTOCOL.md` itself and its citations
throughout `ROADMAP.md`/`ROADMAP_ARCHIVE.md` (the family-size counter rule, the `SEALED_SYMBOLS`
re-run rule, the calendar-holdout retirement rule) — cites `AGENT_PROTOCOL.md` alone, with no
competing citation of `ARCHITECT_DIRECTIVE.md` or `AGENT_RUNBOOK.md` for the same decision, and no
instance of an agent stating uncertainty about which document to follow. The one unrelated hit for
"authoritative" in the ledger concerns a different question entirely (whether `.agent_state.json`'s
top-level or nested `notifications` map governs dedup — resolved in a single firing, nothing to do
with these three documents). **The circularity is latent, not active**: it is a real, uncorrected
defect in what these documents claim about each other, but it has not — as far as the available
record shows — ever caused a firing to pick the wrong rule or stall on indecision.

**Which document the live loop currently behaves as though it treats as binding.** `AGENT_PROTOCOL.md`,
as a fact, not a preference — for three independent reasons found in this pass:

1. It is the only one of the three ever cited by name when a firing actually applies a binding rule
   (the multiple-comparisons family-size counters, the `SEALED_SYMBOLS` re-run rule, the calendar
   holdout retirement) — checked exhaustively above.
2. Its own "Full control" section (2026-08-07) is the operative description of how the live
   `cajh-loop-check` scheduled task actually runs today — the scheduled task's own prompt, which this
   very firing executes under, describes the same single-pass design in nearly identical language
   ("no role labels ... you now design, implement, and self-check in one continuous pass") without
   ever mentioning `ARCHITECT_DIRECTIVE.md` or `AGENT_RUNBOOK.md`.
3. Its "Artifact publishing is PAUSED" section (2026-09-02) explicitly asserts precedence over a
   conflicting instruction elsewhere ("Where the two disagree, this section wins — the same
   precedence the 'Closed research programs' section above relies on") — a pattern of `AGENT_PROTOCOL.md`
   resolving conflicts unilaterally that neither of the other two documents exhibits anywhere in their
   own text.

**Reconciliation options (characterized, not chosen — this is the human's call).**

1. **Make `AGENT_PROTOCOL.md` explicitly supreme**, with `ARCHITECT_DIRECTIVE.md` and
   `AGENT_RUNBOOK.md` reduced to subordinate references. This matches operational reality exactly (per
   the three reasons above) and requires the smallest conceptual change, but concretely means editing
   `ARCHITECT_DIRECTIVE.md`'s self-declared "this document is authoritative" line — the same kind of
   safety-adjacent header edit `AGENT-DOC-DEDUPLICATION` explicitly declined to make unilaterally.
2. **Add a dated supersession notice to the two older documents** (a short header note on
   `ARCHITECT_DIRECTIVE.md` and `AGENT_RUNBOOK.md` stating that `AGENT_PROTOCOL.md`'s 2026-08-07 "Full
   control" section governs current operation, while leaving the original authority claims and the
   three-role pipeline description in place as historical record). Lower-risk than option 1 — it adds
   rather than rewrites — but leaves the literal contradiction unresolved in favor of a note about
   which side wins in practice.
3. **Leave all three as intentional historical record**, on the reasoning `AGENT_PROTOCOL.md` itself
   already gives for the other stale sections it explicitly supersedes ("kept as historical record of
   the design that ran... still accurate for reasoning about *why* certain invariants exist, but they
   no longer describe current enforcement") — extending that same treatment to the header claims
   themselves rather than writing a new notice. Cheapest option; relies on a future reader (human or
   agent) independently reaching the same "which one actually governs" conclusion this audit reached,
   rather than being told directly.

**What is NOT unguarded while this is open.** The circularity concerns document-level precedence for
process/workflow rules — which pipeline shape, which notification policy, which multiple-comparisons
discipline applies. It has no bearing on the one enforcement mechanism that cannot be talked around:
`scripts/check-protected-logic.cjs` via `.git/hooks/pre-commit`, which is independent of all three
documents' text and blocks any staged diff touching the protected live-trading identifiers regardless
of which governance document a firing believes it is following.

`npm.cmd test`: 513/513 green (documentary audit, no code touched).

## 2026-09-02 — HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK: 5/5 selected headline figures reproduce today, against today's cache

**Selection rule, fixed before anything was run** (full text: `scripts/headline-figure-reproducibility-spotcheck.mjs`'s header, same commit as these results). One headline figure per distinct study family/mechanism, restricted to scripts whose own `ROADMAP.md` engineering note labels them "cache-only" / "no network egress" (nothing this environment might lack), and whose number is directly quoted by value in `VERDICTS.md` or a dated `ROADMAP.md`/`ROADMAP_ARCHIVE.md` section. Capped at five, chosen in `ROADMAP.md`'s chronological order of first appearance — not the five most likely to reproduce. `C1`/`C3`'s entitlement-gate scripts are excluded on principle: they need a live IB Gateway/FRED connection, out of scope for a cache-only rerun (separate work-queue item, `C1-C3-ENTITLEMENT-PROBE-RUN`). Pre-registered via `registry.preregister()` (id `HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK`) before any script below was executed; list neither expanded nor trimmed afterward.

**Method.** Each cited script run UNMODIFIED as its own `node` subprocess (never imported — every one of them executes `main()` at module scope) against the current on-disk cache; its single `console.log(JSON.stringify(...))` line parsed back and compared to the recorded value at the precision the write-up itself states.

**Results:**

| Figure | Script | Recorded | Computed | Classification |
|---|---|---|---|---|
| `EQUITIES-BREAKOUT-SIGNIFICANCE` (2026-08-21) | `equities-breakout-significance.mjs` | breakout: 61 trades, avgR 0.186624, CI [-0.2700,0.6192], p 0.2036; anticipate: 303 trades, avgR -0.043770, CI [-0.2442,0.1360], p 0.6701 | breakout: 61, 0.18662383379813474, CI [-0.27003323,0.61920959], p 0.20355929; anticipate: 303, -0.04376981767178859, CI [-0.24418581,0.13595004], p 0.67006599 | **REPRODUCES** |
| `EQUITIES-MADIP-OUT-OF-SAMPLE` (2026-08-22, DJTA-20 row) | `equities-madip-out-of-sample.mjs` | 300 trades, avgR 0.2994, CI [0.0509,0.5350], p 0.0116 | 300, 0.2993949292376351, CI [0.05091776,0.53498005], p 0.01159768 | **REPRODUCES** |
| `BOS-SHORT-EQUITIES-BASELINE` (2026-08-28) | `bos-short-equities-baseline.mjs` | long: 148 trades, gross 0.2162, net 0.1838; short: 188 trades, gross -0.3729, net -0.4086; pooled: 336 trades, net -0.1477 | long: 148, gross 0.21621621621621614, net 0.18376506375218163; short: 188, gross -0.37285223101158904, net -0.40863760901402196; pooled: 336, net -0.14769833648605132 | **REPRODUCES** |
| `VOL-CONTRACTION-SAMPLE-EXTENSION` AXIS C (2026-08-28) | `vol-contraction-sample-extension.mjs` | 256 trades, avgR 0.2524, CI [0.0620,0.4427] | 256, 0.25239110190788416, CI [0.06204252,0.44273969] | **REPRODUCES** |
| `DATE-CLUSTERED-RESAMPLING-DJTA20` date-clustered CI (2026-08-29) | `date-clustered-resampling-djta20.mjs` | 300 trades, avgR 0.2994, dateClusteredCI [-0.0851,0.7129] | 300, 0.2993949292376351, dateClusteredCI [-0.08512051,0.71287915] | **REPRODUCES** |

All five REPRODUCES — every compared field lands within the stated precision (4dp for CI/avgR/p; the 6dp claim `EQUITIES-BREAKOUT-SIGNIFICANCE` makes for its own "bit-for-bit" replication also holds). No DRIFTS, no CANNOT-RUN. Zero recorded figures were touched (none needed to be). Run record: `research-runs/2026-09-02T16-08-41-862Z-headline-figure-reproducibility-spotcheck.json`, linked to the pre-registration in `research-registry/ledger.jsonl`.

**A negative result would have been reportable as-is; this item does not read a clean sweep as stronger evidence than a single honest DRIFTS would have been** — the five figures span four different studies over an 8-day window on a codebase that has had no production changes to `backtest.js`/`momentum.mjs`/`tournament.mjs` in that time (confirmed by `DEAD-CODE-AND-ASSET-AUDIT` and this project's own commit history), so reproduction here is closer to a control on the harness's own determinism (same cache, same code, same seeds ⇒ same output) than a test of anything that could plausibly have drifted. The one way this check will not stay this clean going forward: any future modification to `momentum.mjs`'s `blockBootstrapCI`/`permutationP`, `backtest.js`'s `backtestMultiTF`, or the candle cache these scripts read would be exactly the class of change this spotcheck is built to catch.

**Engineering note.** New `scripts/headline-figure-reproducibility-spotcheck.mjs` only (additive, read-only, cache-only, no network egress; spawns the five cited scripts as subprocesses, never imports or modifies them). No test file added, matching this project's established convention for read-only diagnostic scripts (no production code changed). `backtest.js`/`strategy.js`/`tournament.mjs`/`monitor.js`/`bot.js`/`trader.js`/`scanner.js` untouched; grep-confirmed against the actual staged diff before commit that no protected trading-safety identifier appears in it. `npm.cmd test`: 659/659 green.

**Aside, out of this item's scope — noted, not fixed here.** While reading `scripts/c1-c3-entitlement-probe.mjs` to confirm it was correctly excluded from this item's universe, its `if (import.meta.url === \`file://${process.argv[1]}\`)` direct-execution guard was checked against this machine's actual `node` behavior: on Windows, `process.argv[1]` is backslash-path (`C:\...`) while `import.meta.url` is a forward-slash `file:///C:/...` URL, so the string comparison is always false and `main()` never runs when the script is invoked directly (confirmed with a throwaway `.mjs` reproducing the exact guard). This item's own new script therefore calls `main()` unconditionally at module scope instead (matching all five scripts it re-runs, none of which use this guard). `C1-C3-ENTITLEMENT-PROBE-RUN` — the pending item that actually needs to run `c1-c3-entitlement-probe.mjs` on this machine — will hit this directly; flagging it here rather than silently working around it in that item's own script.
