# CAJH Research Roadmap: Path to a Profitable Strategy

> Staged verbatim from a direct human directive (2026-08-06). Governs the
> `tournament.mjs` / `backtest.js` / `portfolio.mjs` entry-signal research track,
> a separate program from the momentum/low-vol/classifier work tracked as
> PWR1-4 in `.agent_state.json`. Same honesty discipline applies to both:
> sealed holdouts, pre-registered gates, no relaxing a gate after seeing results.

## Honest Baseline First

Every entry family tested in the latest tournament is **net-negative after costs, in both train and holdout**:

| Family | Train R/trade | Holdout R/trade |
|---|---|---|
| anticipate | -0.361 | -0.508 |
| bos | -0.425 | -0.607 |
| breakout | -0.454 | -0.437 |
| trend_pullback | -0.387 | -0.598 |
| sweep_reclaim | -0.590 | -0.711 |
| rsi | -0.693 | -0.751 |
| rev | -2.211 | -2.047 |
| support | -2.196 | -2.018 |

**The losses are not from bad exits or bad sizing — they are from entries that do not predict directional movement better than chance, after the bid/ask spread and fee drag of ~0.9%.** Tuning exits or position size around these entries is not the path forward.

---

## What Must Be True for a Strategy to Work

Before designing anything new, state the required conditions:

1. **Entry signal predicts positive expected value before costs** — raw edge exists in price data
2. **That edge survives realistic cost assumptions** (~0.9% round-trip on Kraken spot)
3. **The edge is stable across a chronological holdout** not used for selection
4. **Sample size is adequate** — minimum ~200 holdout trades per candidate
5. **The edge generalizes across assets** — not one lucky ticker

If any condition fails, the hypothesis is rejected and a new one is required.

---

## Roadmap: Four Distinct Hypothesis Tracks

Work these **sequentially**. Do not advance to the next track until the current one is falsified or promoted.

---

### Track 1 — Diagnose the Cost Drag (Immediate)

**Hypothesis:** The current entry signals have a small raw edge that costs destroy.

**Experiment:**
Run the existing tournament with `costRate = 0`. If any family reaches `avgR > 0` in holdout at zero cost, the problem is execution cost and the fix is a higher R-multiple target or less frequent entries. If all families are still negative at zero cost, the entries have no edge at all and Tracks 2-4 are the only path.

**Decision rule:**
- Zero-cost holdout `avgR > 0` for any family -> proceed to cost-reduction experiments on that family
- All families negative at zero cost -> **kill Track 1, move to Track 2 immediately**

**What would cause abandonment:** All negative at zero cost (very likely given the magnitude of losses).

---

### Track 2 — New Entry Signal: Volatility Contraction Breakout (Next)

**Hypothesis:** Price compression (low ATR relative to its own history) followed by a range expansion candle predicts a sustained directional move with positive EV before costs.

**Why this is genuinely different:** Current entries are swing-low geometric patterns. This is a volatility-state signal — structurally distinct information source.

**Pre-registered gate (must be written before running):**
- Holdout trades >= 150
- Holdout `avgR/trade > +0.10` (net of 0.9% cost)
- Holdout win rate >= 40%
- Positive on >= 50% of tested assets

**Implementation steps:**
1. Define: ATR(14) < 0.5x its own 50-bar median = compression state
2. Entry trigger: close breaks above the compression range high
3. Stop: below the range low
4. TP: 3R
5. Run tournament with 70/30 chronological split across the full watchlist

**Implementation decisions, pre-registered before the run (Architect, 2026-08-06).** Steps 1-4
above leave three things undefined that materially change the result; they are fixed here,
before any run, and are **not** to be tuned after seeing output:
- **Compression state at bar `k`** — `atr(H,L,C,k-1,14) < 0.5 x median(atr(H,L,C,j,14) for j in
  [k-50, k-1])`. ATR is always evaluated to `k-1`, never `k`, so the entry candle cannot inflate
  its own baseline (same convention as `breakoutEntry`).
- **"The compression range"** — the contiguous run of bars immediately before `k` that are each in
  the compression state. Range high = `max(H)` over that run, range low = `min(L)` over that run.
  The run is scanned back at most 50 bars.
- **Minimum run length = 5 bars.** Without a floor, a single compressed bar forms a degenerate
  "range" and the signal collapses into an ordinary 1-bar breakout, which Track 1 already tested.
  5 is a pre-registered floor, not a swept parameter.

Family config is `minStopPct: .01, maxStopPct: .06, tpR: 3` — deliberately the same stop-size caps
as the `breakout` family, the closest comparable, so the comparison is apples-to-apples and
tiny-risk trades cannot inflate `avgR`. Consequence: compression ranges are narrow by
construction, so `stopTooTight` rejections may hold the holdout sample under 150 trades. If that
happens it is reported as a mechanical frequency failure **with the `reasons` histogram as
evidence** — it is not grounds for silently loosening `minStopPct` and re-running.

**What would cause abandonment:** Holdout `avgR < 0` after costs OR fewer than 150 holdout trades (insufficient signal frequency).

---

### Track 3 — New Entry Signal: BTC Regime Filter on Existing Entries (Parallel Research)

**Hypothesis:** The existing entries have negative EV in bear/ranging regimes and positive EV only when BTC is above its 200-day MA. Filtering to bull-regime-only entries changes the distribution enough to produce positive holdout EV.

**Why this is genuinely different from what was tested:** The current tournament has `trendGate: false` for most families. A hard BTC macro filter is a different information source than per-asset MA alignment.

**Pre-registered gate:**
- Holdout trades >= 100 (regime filter will reduce frequency significantly)
- Holdout `avgR > +0.05`
- Tested on the `anticipate` and `breakout` families only (best performers in the tournament)

**What would cause abandonment:** Holdout `avgR < 0` OR regime-on periods have fewer than 100 trades (strategy too infrequent to be useful).

> NOTE (staged by Architect): the section header says "Parallel Research" but the
> "Execution Order for Agents" below runs it strictly after Track 2 resolves. Preserved
> as written rather than silently resolved — whoever picks this up should confirm with
> the human whether Track 3 was meant to run alongside Track 2 instead of after it.

---

### Track 4 — Portfolio-Level Alpha: Cross-Sectional Momentum (If Tracks 1-3 Fail)

**Hypothesis:** Cross-sectional 30-day momentum (long top-5 performers, rebalance weekly) produces positive Sharpe in holdout. This is fundamentally different from single-name entry timing — it is a portfolio rotation signal.

**This track is already partially coded** in `portfolio.mjs`. The existing `momentum_30d` and `momentum_vol` strategies need a clean holdout run reported here.

**Pre-registered gate:**
- Holdout Sharpe > 0.5
- Holdout total return > 0
- Holdout max drawdown > -35%
- Both 7-day and 30-day rebalance variants must pass (prevents rebalance-frequency overfitting)

**What would cause abandonment:** Holdout Sharpe < 0 across all variants.

---

## Track 4 — RESULT (2026-08-07): ABANDONED

Ran `runPortfolioStudy()` from `portfolio.mjs` unmodified — it already implements a
sealed 70/30 chronological split (`splitFraction: .70`) with no look-ahead (each
strategy call only reads price history at or before its own rebalance index; the
train/holdout partition is a pure index range on the same panel). No harness changes
were needed; this item was purely the "clean holdout run reported here" the track
itself asks for. Full watchlist (28 assets, BTC excluded as the regime signal rather
than a tradeable name, matching every other `portfolio.mjs` strategy). Both `momentum_30d`
and `momentum_vol`, each at both rebalance frequencies:

| Variant | Holdout Sharpe | Holdout total return | Holdout max drawdown |
|---|---|---|---|
| `momentum_30d`, 7d rebalance | -0.141 | -9.3% | -56.6% |
| `momentum_30d`, 30d rebalance | 0.270 | +16.6% | -36.8% |
| `momentum_vol`, 7d rebalance | -0.286 | -17.8% | -58.0% |
| `momentum_vol`, 30d rebalance | 0.202 | +12.3% | -43.8% |

**Gate check (pre-registered, both rebalance variants required per strategy — not
either/or):**
- `momentum_30d` 7d: Sharpe>0.5 FAIL, totalReturn>0 FAIL, maxDrawdown>-35% FAIL → all three FAIL
- `momentum_30d` 30d: Sharpe>0.5 FAIL, totalReturn>0 PASS, maxDrawdown>-35% FAIL (-36.8% < -35%) → combined FAIL
- `momentum_vol` 7d: Sharpe>0.5 FAIL, totalReturn>0 FAIL, maxDrawdown>-35% FAIL → all three FAIL
- `momentum_vol` 30d: Sharpe>0.5 FAIL, totalReturn>0 PASS, maxDrawdown>-35% FAIL (-43.8% < -35%) → combined FAIL

**Verdict: FAIL.** Neither strategy has even one rebalance variant clearing all three
holdout clauses, let alone both as the gate requires. The 30d-rebalance variants come
closest (positive holdout return, Sharpe in the 0.2–0.3 range) but both breach the
drawdown floor and fall well short of the 0.5 Sharpe bar; the 7d-rebalance variants are
outright negative on every clause. This does not meet the track's own stated
abandonment trigger literally (holdout Sharpe is positive, not <0, on the 30d variants)
but the pre-registered pass gate — not the abandonment trigger — is the one that governs
promotion, and it is failed decisively and symmetrically by both strategies. Per
`TOURNAMENT_ROADMAP.md`'s own execution order, Tracks 1–4 have now all failed:
**a genuinely new hypothesis is needed next, not re-tuning any of these four.**

---

## Track 4 — T4-COVERAGE-FIX rerun (2026-08-09): verdict unchanged, closest clause now clears

`T4-COVERAGE-FIX` (queued 2026-08-09 by a data-integrity-audit workflow) found that
`portfolio.mjs`'s `panel()` builds the shared date calendar as the union of every
watchlist symbol's timestamps, including BTC (loaded but excluded only from the
tradable list) — the same "in-calendar-but-excluded-from-tradable" pattern behind the
`DCA-FIXED-INTERVAL`/`GRID-SIM` coverage fixes. On the real candle store, BTC/ETH/SOL
run to 2026-07-29/30 while ~24 of the other 28 tradable symbols stop dead at
2026-03-31, pushing 121 of the 392 holdout days (31%) below 50% same-day price coverage
across the tradable universe. `simulatePortfolio`'s return accumulator scored a held
position with no fresh print that day as exactly 0% return — silently freezing that
slice of the portfolio rather than reflecting that the capital wasn't really idle.

**Fix chosen: exclude-and-renormalize, not forward-fill.** DCA-FIXED-INTERVAL's
precedent forward-fills the last known price for valuation. That pattern is mathematically
a no-op for this specific coverage gap: since the affected symbols stop printing
*permanently* from 2026-03-31 onward (not a transient day-or-two gap), a forward-filled
price never changes again either, so `b/a - 1` still evaluates to exactly 0% every day
after the freeze — identical to the pre-fix number. Forward-fill only matters for
short, self-healing gaps; it does not correct a permanent stop. Instead, `simulatePortfolio`
now excludes any weighted symbol that lacks a priced move on a given day from that day's
return and renormalizes across whichever weighted symbols *do* have a priced move,
matching the "liquidating/reallocating with weight renormalization" alternative named in
the work item, and matching the stance `returns()` already takes when ranking momentum
candidates (a symbol with no valid price is not tradable, so it should not count as a
static holding either). Regression tests in `portfolio.test.mjs` cover a two-symbol
stale-partway-through fixture (mirroring DCA-FIXED-INTERVAL's own staleness fixture) and
confirm the renormalized result differs from the un-renormalized old behavior.

Re-ran only `runPortfolioStudy()`'s 4 already-defined T4 variants on the same sealed
70/30 split, no other harness touched:

| Variant | Holdout Sharpe (old → new) | Holdout total return (old → new) | Holdout max drawdown (old → new) |
|---|---|---|---|
| `momentum_30d`, 7d rebalance | -0.141 → -0.165 | -9.3% → -10.9% | -56.6% → -57.4% |
| `momentum_30d`, 30d rebalance | 0.270 → 0.360 | +16.6% → +22.9% | **-36.8% → -34.0%** |
| `momentum_vol`, 7d rebalance | -0.286 → -0.308 | -17.8% → -19.2% | -58.0% → -58.7% |
| `momentum_vol`, 30d rebalance | 0.202 → 0.295 | +12.3% → +18.6% | -43.8% → -40.6% |

(Train-window numbers move by <0.5pp on every variant — the coverage gap is
concentrated in the holdout window, as expected from the 2026-03-31 cutoff falling
after the 70/30 split date of 2025-07-03.)

**Gate outcome, re-checked clause by clause:**
- `momentum_30d` 7d: still all three FAIL. No change.
- `momentum_30d` 30d: Sharpe>0.5 still FAIL (0.360), totalReturn>0 still PASS (+22.9%),
  **maxDrawdown>-35% flips FAIL→PASS** (-34.0% now clears the floor, where -36.8% didn't).
  Combined per-variant outcome is still FAIL — the gate requires all three clauses, and
  Sharpe is the one still missing, now by a wider margin than the drawdown clause was.
- `momentum_vol` 7d: still all three FAIL. No change.
- `momentum_vol` 30d: still Sharpe FAIL, totalReturn PASS, maxDrawdown still FAIL
  (-40.6%, improved from -43.8% but not enough to clear -35%). No clause-level flip.

**No variant's combined gate outcome changes.** `T4-PORTFOLIO-MOMENTUM` remains
**ABANDONED** — corrected coverage handling does not produce a promotable variant.
Flagging plainly rather than folding in quietly, per this item's own instructions: the
`momentum_30d` 30d-rebalance maxDrawdown clause — the single closest miss in the
original table — does flip from FAIL to PASS under corrected coverage handling. This
does not change the verdict (Sharpe is now the sole blocking clause, not drawdown), but
it confirms the original -36.8%/-35% near-miss was partly a data-coverage artifact
rather than a purely genuine result, and the corrected numbers above are the ones that
should be cited going forward. `VERDICTS.md`'s `T4-PORTFOLIO-MOMENTUM` row is updated to
point here for the corrected figures.

---

## What Agents Must Not Do

| Prohibited | Reason |
|---|---|
| Re-tune TP/stop multipliers on the existing entry families | The losses are pre-cost; exit tuning cannot fix a signal with no edge |
| Cherry-pick assets where a strategy happened to work | Overfitting; must require >=50% of assets positive |
| Relax the holdout gate after seeing results | Data snooping invalidates the test |
| Infer live edge from the current 0-trade sample | No realized exits means no evidence |
| Call a strategy "promising" without holdout evidence | Not a useful conclusion |

---

## Execution Order for Agents

```
1. Run Track 1 (zero-cost tournament) -> report avgR per family at cost=0
   |- If any family positive at zero cost: investigate cost reduction
   |- If all negative: confirm, move immediately to Track 2

2. Implement volatility contraction entry in backtest.js
   Run Track 2 tournament with pre-registered gate
   |- Pass: promote to paper trading, observe 60 days minimum
   |- Fail: document result, move to Track 3

3. Run Track 3 (BTC regime filter on anticipate + breakout)
   |- Pass: promote to paper trading alongside Track 2 if applicable
   |- Fail: document, move to Track 4

4. Run Track 4 (portfolio momentum holdout from portfolio.mjs)
   |- Pass: implement as portfolio rotation layer, not single-name entries
   |- Fail: generate genuinely new hypothesis not yet tested

5. After any paper-trading promotion: observe minimum 60 days,
   minimum 50 trades, before any live consideration.
   Trading remains halted until this gate is passed.
```

---

## Single Highest-Information Next Step

**Run the zero-cost tournament (Track 1).** It takes minutes and definitively answers whether the problem is cost drag or signal absence. That answer determines everything else. If the entries have zero-cost positive EV, the research path is cost reduction. If they do not, the entire entry family must be replaced and Tracks 2-4 are the only viable directions.

The strategy is not currently profitable. The roadmap above is the honest, falsifiable path to finding out whether a profitable one exists in this asset class.

---

## Addendum (2026-08-06) — "Research Roadmap v2" reviewed and rejected as duplicative

A separately-proposed "Roadmap v2" (H1: swing-low trigger on 1d, lowest close of a 5-bar
window, trigger = prior bar high, BTC/ETH/SOL only) was reviewed by three independent
verifiers before being staged. **Verdict: DUPLICATE, not staged.** Its entry mechanism —
a 5-bar local-low pivot plus a breakout-of-high trigger — is the same information source
as the already-killed `anticipate` (holdout R/trade -0.508) and `bos` (-0.607) families
above, differing only in a price-field substitution (close vs. low) and confirmation
timing, not in information source. Staging it would have repeated the exact mistake this
document's own "Honest Baseline" section warns against: rebuilding the same signal with
different parameter names.

The one genuine, non-fabricated gap it surfaced: **no family in this tournament has ever
been tested on the 1d timeframe** (`tournament.mjs` hardcodes `entryTf: "1h"` for every
run). A narrow, honestly-labeled follow-up — replicate `anticipate`/`bos` on 1d only, net
of cost from the start, full watchlist, the existing R/trade gate, holdout n≥150 — is a
legitimate open question and is recorded in `.agent_state.json`'s
`blackboard.roadmap_v2_review` as a ready-to-stage candidate for the next genuine queue
restock, not launched as a fresh 5-phase roadmap under looser, gross-of-fees gates.

---

## Track 1 — RESULT (2026-08-06)

Ran the existing tournament twice, same 70/30 chronological split, same full watchlist
(28 assets passing the `>=250` candle-per-TF filter; `anticipate`/`bos` see 27 — one
asset's history is too short for the swing-detection warmup those two families need),
via `node tournament.mjs` (net-of-cost, default `feeRate`/`slipPct`) and
`node tournament.mjs --zero-cost` (`feeRate:0, slipPct:0`, wired as a genuine
pass-through param on `runTournament`/`backtestMultiTF` — `backtest.js` already exposed
`feeRate`/`slipPct` as overridable options, so this needed no frozen-path edit).

**Coverage note:** the committed harness now runs 11 families, not the 8 this document's
baseline table covers (`ma_dip` and `range_sweep_reclaim` were added after the baseline
table was written; `h3` was added separately by a concurrent process and is pre-registered
nowhere). Zero-cost numbers are reported for all 11 below, but the pre-registered decision
rule is applied **only to the original 8** — a family with no net-of-cost baseline row
cannot be judged "alongside the already-known net-of-cost numbers," and `h3` in particular
is explicitly excluded from any verdict here per the architect's note on its provenance.

**Net-of-cost (this run, full watchlist) vs. zero-cost, the 8 baseline families:**

| Family | Train R/trade (net) | Holdout R/trade (net) | Train R/trade (zero-cost) | Holdout R/trade (zero-cost) | Holdout trades (zero-cost) |
|---|---|---|---|---|---|
| anticipate | -0.365 | -0.506 | +0.035 | -0.083 | 3891 |
| bos | -0.431 | -0.535 | -0.054 | -0.126 | 269 |
| **breakout** | -0.461 | -0.445 | **+0.021** | **+0.045** | **3123** |
| trend_pullback | -0.398 | -0.606 | +0.057 | -0.139 | 1989 |
| sweep_reclaim | -0.591 | -0.713 | -0.061 | -0.141 | 3145 |
| rsi | -0.704 | -0.759 | -0.091 | -0.062 | 2260 |
| rev | -2.206 | -2.043 | -0.181 | -0.153 | 24375 |
| support | -2.190 | -2.014 | -0.186 | -0.149 | 53754 |

(Net-of-cost numbers here are from this run against the current, larger watchlist and
differ slightly from the original baseline table's figures — same sign and rough
magnitude throughout, consistent with the same underlying result.)

**Not part of the decision rule (reported for completeness only):** `ma_dip` zero-cost
holdout avgR = **+0.101** (train +0.236, 10004 holdout trades) and `h3` zero-cost holdout
avgR = **+0.030** (train +0.088, 4525 holdout trades) — both outside the 8-family
baseline and therefore cannot be compared against a known net-of-cost number; `h3`
additionally has no pre-registration anywhere in this document and must not be adopted,
extended, or verdicted here regardless of its sign.

**Decision rule applied:** one of the 8 baseline families — **`breakout`** — reaches
holdout `avgR > 0` at zero cost (+0.045R/trade, 3123 holdout trades, positive on 17/28
assets), while its net-of-cost holdout is -0.445R/trade. Per the pre-registered rule,
**this stops Track 1 here**: the reading is cost drag, not signal absence, for
`breakout` specifically. Track 2 (volatility-contraction breakout) is explicitly **not**
implemented in this run per the rule ("do not also implement Track 2 in the same run").

The other 7 baseline families stay negative at zero cost (`anticipate`, `bos`,
`trend_pullback`, `sweep_reclaim`, `rsi`, `rev`, `support`) — for those seven, the
verdict is unchanged: no edge, cost is not the explanation.

**Follow-up (new queue item, not this one):** a cost-reduction experiment specifically on
`breakout` — e.g. a higher R-multiple target or less frequent entries, per the Track 1
experiment description above — is the next step for that one family.
`T2-VOLCONTRACTION` remains queued as-is; this result does not change its scope, since it
targets a different, new entry signal rather than `breakout`'s exit/frequency tuning.

---

## Track 2 — RESULT (2026-08-07): ABANDONED

Implemented exactly the pre-registered spec (Architect, 2026-08-06, commit
8e9ae64): `volContractionEntry` added to `backtest.js` as a new `entryMode` branch
(compression = `atr(k-1,14) < 0.5x` the 50-bar median ATR, evaluated only to the
previous bar; range = the contiguous compressed run immediately before `k`, scanned
back at most 50 bars, minimum 5-bar floor; entry on close above the range high, stop
below the range low, TP = 3R). Registered as a new family in `tournament.mjs` with the
pre-registered config (`minStopPct: .01, maxStopPct: .06, tpR: 3` — same caps as
`breakout`, for an apples-to-apples comparison). No existing entry helper, exit
simulator, cost model, split logic, or other family config was touched. Ran
`node tournament.mjs` — net-of-cost (default `feeRate`/`slipPct`, round-trip ≈0.9%),
70/30 chronological split, full watchlist (28 assets passing the `>=250`
candle-per-TF filter).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Train | 167 | -0.638 | 31.7% | 27 | 7 (25.9%) |
| Holdout | 98 | -0.322 | 40.8% | 21 | 5 (23.8%) |

**Holdout `reasons` histogram** (raw candidates before the stop-size filter, all 28
assets): `taken: 98, stopTooTight: 40, stopTooFar: 0, priceBelowStop: 0` — 138 raw
compression-breakout candidates total. Even counting every `stopTooTight` rejection as
a would-be trade, the holdout sample tops out at 138, still short of the 150 floor; the
frequency shortfall is not solely a stop-size artifact.

**Gate check (pre-registered, must not be adjusted after seeing this):**
- Holdout trades >= 150 → 98 → **FAIL**
- Holdout `avgR/trade > +0.10` net of cost → -0.322 → **FAIL**
- Holdout win rate >= 40% → 40.8% → PASS (marginal)
- Positive on >= 50% of tested assets → 5/21 = 23.8% → **FAIL**

**Verdict: FAIL.** 3 of 4 pre-registered criteria fail, including the two independent
abandonment triggers named in this section's own pre-registration — holdout `avgR < 0`
after costs, and holdout trades under 150. The compression-breakout signal has a
genuinely negative holdout edge net of cost, not merely a small-sample or stop-size
artifact (train is negative by a wider margin than holdout, -0.638 vs -0.322, which is
the opposite of what a real edge obscured by noise would look like). Per this track's
own pre-registered rule, **Track 2 is abandoned.** No parameter was loosened or
re-run after seeing these numbers.

---

## Track 3 — RESULT (2026-08-07): ABANDONED

**Refined scope** (Architect, 2026-08-06/07, reconciling a second human-facing research
proposal — see `.agent_state.json`'s `control.notes` at staging time for the full
reasoning): filter the `breakout` family only (the strongest zero-cost performer from
Track 1, -0.437R holdout unfiltered net-of-cost per the number known at staging time —
see the RESULT section below for the corrected -0.445 figure from Track 1's actual run)
on BTC>200d-SMA, rather than testing
`anticipate`+`breakout` together. Gate loosened on `avgR` (`> -0.10`, not `> +0.05`) but
tightened on sample size (`n >= 200`, not `n >= 100`) — a genuine pre-registration
improvement adopted *before* any run, not a post-hoc relaxation. `anticipate` was
deliberately not tested in this pass: if the strongest performer can't clear even a loose
bar, a weaker one isn't worth testing either; extending to `anticipate` remains a
separate, not-yet-attempted follow-up if this had passed.

**Implementation:** a single-line `entryGate` wiring in `backtest.js`'s generic dip-buy
branch (mirrors the existing `anticipate`-branch check verbatim — `else if (entryGate &&
!entryGate(tClose)) reason = "externalGate"`), a no-op whenever `entryGate` is omitted
(every existing caller). `tournament.mjs` gained `buildBtcAboveMa200At(candles)` — a
local BTC daily 200-SMA "as-of" gate duplicating `backtest.js`'s internal
`maTimeline`/`makeAsOf` pattern (not exported from `backtest.js`, to avoid widening its
export surface for ~10 lines of pure arithmetic) — and `runBreakoutRegimeFilter()`,
which reuses `breakout`'s exact pre-registered config unmodified, adding only
`entryGate`. Neither `families` nor `runTournament`'s 12-row output was touched.

**Bug caught before trusting any result:** the as-of cursor `buildBtcAboveMa200At`
returns is stateful and forward-only, matching `backtest.js`'s own `makeAsOf` convention
— correct *within* a single backtest call, whose entry timestamps are non-decreasing by
construction. The first implementation built one cursor and reused it across every
asset's train **and** holdout backtest call in the same `.map()`. Each asset's own
candle history restarts near 2023-01-01, so the cursor regressed in time at every asset
boundary after the first, silently freezing `above` at whatever the previous asset's
last entry had left it. Symptom: holdout came back as 0 trades / 0 assets against a
train of 293 trades / 2 assets — implausible next to Track 1's unfiltered breakout
(3123 holdout trades / 28 assets). Fixed by building a fresh
`buildBtcAboveMa200At(btcCandles)` cursor per backtest call (train and holdout, per
asset) instead of one shared instance — same pattern `backtestMultiTF` itself uses
internally for its own as-of timelines. Re-ran after the fix; the numbers below are
post-fix.

Ran `node tournament.mjs --regime-filter` — net-of-cost (default `feeRate`/`slipPct`),
70/30 chronological split, full watchlist (28 assets passing the `>=250`
candle-per-TF filter for `breakout`).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Train | 4711 | -0.455 | 33.2% | 28 | 0 (0%) |
| Holdout | 1408 | -0.379 | 36.0% | 20 | 0 (0%) |

For comparison, `breakout` unfiltered (Track 1, same net-of-cost split, 3123 trades,
28 assets): holdout avgR **-0.445**R/trade (Track 1's own RESULT table above, the same
run this trade count comes from — not the -0.437 in this document's earlier "Honest
Baseline First" table, which predates the larger/updated watchlist Track 1 actually ran
against; the two numbers were previously cited interchangeably here, corrected
2026-08-07). The BTC>200d-SMA gate removes roughly 55% of holdout trades and 8 of 28
assets entirely (no trade in the gated regime at all), and improves avgR modestly
(-0.445 → -0.379) — a real but small effect, not enough to approach the gate. This
correction does not change the verdict below either way: neither -0.437 nor -0.445 is
within reach of the required >-0.10.

**Gate check (pre-registered, must not be adjusted after seeing this):**
- Holdout `avgR/trade > -0.10` → -0.379 → **FAIL**
- Holdout trades >= 200 → 1408 → PASS

**Verdict: FAIL.** Only one of the two required (AND, not OR) clauses clears. The regime
filter has a real but small effect on `breakout`'s holdout edge — better than unfiltered,
but nowhere near the pre-registered `-0.10` bar, and every traded asset in the gated
regime is still net negative (0/20 positive). Per this track's own pre-registered rule,
**Track 3 is abandoned.** `anticipate` was not tested (per the refined scope's own
reasoning: not worth testing a weaker performer once the strongest fails this
decisively). No gate constant was touched after seeing these numbers.

---

## Track 1 — T1B-BREAKOUT-COSTFIX RESULT (2026-08-07)

Follow-up from Track 1's own experiment text ("the fix is a higher R-multiple target or
less frequent entries") on `breakout`, the one baseline family with a positive zero-cost
holdout edge (+0.045R/trade, 3123 trades) but negative net-of-cost holdout (-0.445R/trade).

**Pre-registered variant (both levers together, ONE variant — not a parameter sweep, to
avoid tuning on the holdout):** `tpR: 3 -> 5`, and a new `breakoutLookback` option added to
`backtestMultiTF` (default 20, byte-identical when omitted — same no-op pattern as
`stopMode`/`atrStopK`) set to `55` for this variant, the classic Donchian breakout window
— an externally-motivated round number, not cherry-picked after seeing results. No other
`breakout` config field changed, no other family touched.

**Pre-registered gate (all three required, holdout only, net-of-cost from the start):**
- Holdout `avgR/trade > 0` (a genuine edge, the same bar `runTournament`'s own `promoted`
  flag uses — not merely "less negative")
- Holdout trades >= 150 (T5-DECAY-EXIT's sample-floor convention)
- Holdout `positiveAssets/assets >= 0.5` (`runTournament`'s own promotion bar, for an
  apples-to-apples comparison with how every other family here gets promoted)

Ran `node tournament.mjs --breakout-costfix` — net-of-cost (default `feeRate`/`slipPct`),
70/30 chronological split, full watchlist (28 assets passing the `>=250` candle-per-TF
filter for `breakout`).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Baseline train (tpR=3, lookback=20) | 7313 | -0.461 | 33.9% | 28 | 0 (0%) |
| Baseline holdout | 3123 | -0.445 | 34.2% | 28 | 0 (0%) |
| Variant train (tpR=5, lookback=55) | 3852 | -0.374 | 35.0% | 28 | 1 (3.6%) |
| Variant holdout | 1569 | -0.381 | 34.4% | 28 | 2 (7.1%) |

The variant roughly halves trade frequency (3123 → 1569 holdout trades) and improves
holdout avgR by about 0.064R (-0.445 → -0.381) — a real, non-trivial effect in the
predicted direction, consistent with cost being a smaller share of R on a bigger,
rarer win. It falls far short of turning the edge positive.

**Gate check (pre-registered, not adjusted after seeing this):**
- Holdout `avgR/trade > 0` → -0.381 → **FAIL**
- Holdout trades >= 150 → 1569 → PASS
- Holdout `positiveAssets/assets >= 0.5` → 2/28 (7.1%) → **FAIL**

**Verdict: FAIL.** Two of the three required (AND, not OR) clauses fail, including the
core one (`avgR > 0`). Raising the R-multiple target and lengthening the breakout
lookback both moved the holdout edge in the right direction and by a meaningful amount,
confirming Track 1's cost-drag diagnosis was directionally correct — but the remaining
gap (-0.381 vs the required >0) is large, not a rounding-error miss, and only 2 of 28
assets are net positive in holdout. Per this track's own pre-registered rule,
**T1B-BREAKOUT-COSTFIX is closed as a FAIL.** No gate constant was touched after seeing
these numbers. This closes the cost-reduction path for `breakout`; no further tpR/lookback
variants are queued off this result without a new pre-registration and a stated reason
the first variant's failure doesn't already answer the question.

## Track 1 — T5-DECAY-EXIT RESULT (2026-08-07)

New hypothesis (human-directed, pre-registered before any run): a time-based decay
exit on `breakout`. Rationale — if a position hasn't hit TP or its stop within a set
number of bars, the original entry thesis is likely dead and the position is just
drifting toward the downside stop; force an exit rather than let it grind.

**Mechanism:** reused `backtestMultiTF`'s existing `maxHold` option rather than adding a
duplicate one — `maxHold` already forces a market exit at that bar's close the first
time neither the stop nor the target has fired within `maxHold` bars of entry
(`backtest.js`, the pre-existing `MAX_HOLD=100` default), which is exactly the requested
decay-exit semantics, and is already a true no-op when omitted, matching the
`stopMode`/`atrStopK`/`breakoutLookback` no-op pattern. Two fixture tests added
(`backtest.test.mjs`) prove it fires at exactly `openedAt+maxHold` — not one bar early —
and that omitting it is byte-identical to the explicit default 100. Pre-registered
variant: `maxHold: 24` (1h timeframe) applied to `breakout` only; no other config field
or family touched.

**Pre-registered gate (both required, holdout only, net-of-cost from the start):**
- Holdout `avgR/trade > -0.30`
- Holdout trades >= 150

Ran `node tournament.mjs --decay-exit` — net-of-cost, 70/30 chronological split, full
watchlist (28 assets passing the `>=250` candle-per-TF filter for `breakout`).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Baseline train (no maxHold override) | 7313 | -0.461 | 33.9% | 28 | 0 (0%) |
| Baseline holdout | 3123 | -0.445 | 34.2% | 28 | 0 (0%) |
| Variant train (maxHold=24) | 8107 | -0.463 | 33.4% | 28 | 0 (0%) |
| Variant holdout (maxHold=24) | 3473 | -0.437 | 33.6% | 28 | 0 (0%) |

Forcing the exit at 24 bars slightly *increases* trade count (3123 → 3473 holdout —
positions that would otherwise still be open, or would go on to hit stop/target later,
get cut short and a new entry becomes eligible sooner) and moves holdout avgR by only
+0.008R (-0.445 → -0.437), a negligible effect nowhere close to the required bar.
Win rate is essentially unchanged (34.2% → 33.6%). Zero assets are net positive in
holdout in either arm.

**Gate check (pre-registered, not adjusted after seeing this):**
- Holdout `avgR/trade > -0.30` → -0.437 → **FAIL**
- Holdout trades >= 150 → 3473 → PASS

**Verdict: FAIL.** The core clause fails by a wide margin — the decay exit does not
meaningfully change breakout's economics in either direction. This is consistent with
the earlier T1B-BREAKOUT-COSTFIX finding: `breakout`'s losses are dominated by cost drag
on frequent small losers, not by winners rotting into losers while a position sits open,
so truncating hold time neither helps nor much hurts. **T5-DECAY-EXIT is closed as a
FAIL.** No gate constant was touched after seeing these numbers.

## T6-TIMEFRAME-ISOLATION RESULT (2026-08-07)

Follow-up recorded in the "Roadmap v2 reviewed and rejected as duplicative" addendum
above and staged in `.agent_state.json`'s `blackboard.roadmap_v2_review`: the one
genuine open gap that review surfaced was that `tournament.mjs` hardcoded
`entryTf: "1h"` for every family, so neither `anticipate` nor `bos` — the two families
closest to the rejected "Roadmap v2" swing-low mechanism — had ever actually been
tested on the 1d timeframe. This is a narrow, honestly-labeled REPLICATION on 1d only,
framed as "does 1d change the verdict", not a fresh hypothesis.

**Mechanism:** added an optional `entryTf` override to `runTournament` (default `"1h"`,
byte-identical when omitted — same additive pattern as T1-ZEROCOST's `feeRate`/`slipPct`;
the existing `rows.length === 12` test is unaffected). Added a new
`runTimeframeIsolation` function that re-runs ONLY `anticipate` and `bos` — each
family's exact pre-registered config, unmodified except `entryTf` — net-of-cost from the
start, full watchlist, standard 70/30 chronological split.

**Pre-registered gate (both required, holdout only, scored per family):**
- Holdout `avgR/trade > 0`
- Holdout trades >= 150

Ran `node tournament.mjs --timeframe-isolation` (28 assets passing the `>=250`
candle-per-TF filter).

**Result:**

| Family | Train trades | Train avgR | Holdout trades | Holdout avgR (net) | Holdout win rate | Positive assets |
|---|---|---|---|---|---|---|
| anticipate (1d) | 597 | -0.103 | 314 | -0.237 | 29.0% | 11/28 |
| bos (1d) | 83 | +0.287 | 24 | -0.536 | 29.2% | 2/14 |

Compared against the existing 1h baseline (net-of-cost holdout: anticipate -0.508, bos
-0.607): 1d is less bad for `anticipate` (-0.237 vs -0.508) but still solidly negative,
and clears the trades floor (314 >= 150). `bos` on 1d collapses to only 24 holdout
trades (well under the 150 floor — the daily-bar warmup and 27/28-asset universe leave
too little holdout history for a signal this infrequent) and stays negative regardless.

**Gate check (pre-registered, not adjusted after seeing this):**
- `anticipate`: avgR>0 → -0.237 → **FAIL**; trades>=150 → 314 → PASS → combined **FAIL**
- `bos`: avgR>0 → -0.536 → **FAIL**; trades>=150 → 24 → **FAIL** → combined **FAIL**

**Verdict: FAIL for both families.** 1d does not change the verdict — `anticipate` and
`bos` remain killed on both tested timeframes. Per the addendum's own framing, this is a
genuinely stronger and more complete verdict than either timeframe alone: the
swing-low/pivot-reclaim signal family (`anticipate`, `bos`, and by the same-mechanism
argument in the addendum, `sweep_reclaim`/`range_sweep_reclaim`/`h3`) is now closed
across both the 1h and 1d timeframes. **T6-TIMEFRAME-ISOLATION is closed as a FAIL.**
No gate constant was touched after seeing these numbers.

## TRAIL-STOP-EXIT RESULT (2026-08-08)

From the 100-strategy triage (workflow wgnuzvc1r, item #100): a dynamic trailing
take-profit on `breakout` (the one baseline family with a positive zero-cost edge,
Track 1). Rationale — instead of a fixed R-multiple target, let a winner run and only
exit once it has genuinely turned, giving up a fixed percentage from its peak. Distinct
information source from T5-DECAY-EXIT (a bar-count timeout, already tested: FAIL) — this
is a trailing-drawdown exit, not a time-based one.

**Mechanism:** added a new `trailingTpPct` option to `backtestMultiTF` (`backtest.js`,
null = off, true no-op when omitted — same no-op pattern as `stopMode`/`atrStopK`/
`maxHold`). While active it replaces the fixed TP with an exit the first time price
pulls back `trailingTpPct` from the running peak price since entry, and also removes the
`maxHold` timeout for that position (hold is indefinite until the initial stop or the
pullback trigger fires). Two fixture tests (`backtest.test.mjs`) prove the pullback exit
fires at exactly `peak*(1-pct)` — not one tick early — and that omitting the option is
byte-identical to the prior fixed-TP/maxHold behavior. Pre-registered variants: 5% and
10%, both decided before any run, applied to `breakout` only; no other config field or
family touched.

**Pre-registered gate (both required, holdout only, net-of-cost from the start, scored
per variant):**
- Holdout `avgR/trade > -0.30` (T5-DECAY-EXIT's bar, for direct comparability)
- Holdout trades >= 150

Ran `node tournament.mjs --trailing-tp-exit` — net-of-cost, 70/30 chronological split,
full watchlist (28 assets passing the `>=250` candle-per-TF filter for `breakout`).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Baseline train (fixed TP, tpR=3) | 7313 | -0.461 | 33.9% | 28 | 0 (0%) |
| Baseline holdout | 3123 | -0.445 | 34.2% | 28 | 0 (0%) |
| Variant train (trailingTpPct=0.05) | 6486 | -0.402 | 32.2% | 28 | 1 (3.6%) |
| Variant holdout (trailingTpPct=0.05) | 2675 | -0.381 | 32.7% | 28 | 1 (3.6%) |
| Variant train (trailingTpPct=0.10) | 5230 | -0.375 | 33.8% | 28 | 1 (3.6%) |
| Variant holdout (trailingTpPct=0.10) | 2257 | -0.469 | 33.6% | 28 | 2 (7.1%) |

The 5% variant improves holdout avgR by +0.064R (-0.445 -> -0.381), similar in magnitude
to T1B-BREAKOUT-COSTFIX's cost-reduction variant, but still falls short of the -0.30
bar. The 10% variant is *worse* than baseline on holdout (-0.445 -> -0.469) despite
being better than baseline on train (-0.461 -> -0.375) — a train/holdout sign flip
consistent with a wider trailing band giving back more of a winner's gain on the
specific assets/periods in the holdout window, not a robust improvement. Both variants
reduce trade count materially (3123 -> 2675 / 2257 holdout trades), as expected: letting
winners run longer means fewer new entries fit in the same window.

**Gate check (pre-registered, not adjusted after seeing this):**
- 5%: holdout avgR/trade > -0.30 -> -0.381 -> **FAIL**; trades >= 150 -> 2675 -> PASS -> combined **FAIL**
- 10%: holdout avgR/trade > -0.30 -> -0.469 -> **FAIL**; trades >= 150 -> 2257 -> PASS -> combined **FAIL**

**Verdict: FAIL for both variants.** Neither trailing percentage clears the
pre-registered gate. The 5% variant is directionally the more promising of the two
(smaller pullback holds the exit tighter to the peak) but is still a wide margin short
of the bar, and the 10% variant's train/holdout sign flip argues against loosening the
band further. **TRAIL-STOP-EXIT is closed as a FAIL.** No gate constant was touched
after seeing these numbers.

## FEE-SCHEDULE-REBASE RESULT (2026-08-08)

Own-initiative finding (Architect): `strategy.js`'s `FEE_RATE = 0.004` (per-side taker
estimate) and `SLIPPAGE_PCT = 0.0005` were verified against Kraken's published fee
schedule (kraken.com/features/fee-schedule, two independent fetches, consistent both
times) to be stale — Kraken Pro's current Tier 1 (the tier a $0–$2.5k 30-day-volume
account trades at) is **Maker 0.40%, Taker 0.80%**, roughly double the assumed rate on
both sides. `trader.js`'s `placeBuy`/`placeSell` hardcode `ordertype:"market"`, so every
live fill pays the taker rate — the relevant correction is 0.40% assumed → 0.80% real.

**Step 1 — confirm the actual account tier (not just the published schedule).** Read-only
query against Kraken's private `TradeVolume` endpoint (`XXBTZUSD`), run via a throwaway
script using the same `kraken-api` client/credentials `trader.js` uses — no frozen file
was edited to do this, and no order was placed. Result: 30-day volume **$1,225.03**
(well under the $2,500 Tier 1 ceiling — `nextvolume: 2500.00000`, `tiervolume: 0.00000`),
taker fee **0.8000%**, maker fee **0.4000%** on `XXBTZUSD`. This is an exact match to the
verified published Tier 1 numbers, confirmed directly from the live account rather than
assumed.

**Aside — `commands.js`'s own fee-tier diagnostic (~line 762) is also stale.** Its
`FEE_TIERS` probe assumes `"maker 0.16%"` (`feeRate: 0.0016`); the real Tier 1 maker rate
is 0.40%, 2.5x higher. Not changed in this item (diagnosis/report only, no production
files edited) — flagged for whoever acts on the recommendation below.

**Step 2 — re-run `breakout` (the one baseline family with a positive zero-cost holdout
edge, Track 1) under the corrected real cost basis.** Used `runTournament({ feeRate:
0.008, slipPct: 0.0005 })` — an explicit override on the existing pass-through param
(same mechanism Track 1's `--zero-cost` run already used), `strategy.js`'s module-level
defaults left untouched. Net-of-cost, 70/30 chronological split, full watchlist (28
assets).

**Three-way comparison (zero-cost / old assumption 0.9% round-trip / corrected-real 1.7%
round-trip):**

| | Trades | Train avgR/trade | Holdout avgR/trade | Holdout win rate | Positive assets |
|---|---|---|---|---|---|
| Zero-cost (`feeRate:0, slipPct:0`) | 7313 / 3123 | +0.021 | **+0.045** | — | 17/28 |
| Old assumption (`feeRate:0.004, slipPct:0.0005`, default) | 7313 / 3123 | -0.461 | **-0.445** | 34.2% | 0/28 |
| Corrected real (`feeRate:0.008, slipPct:0.0005`) | 7313 / 3123 | -0.889 | **-0.881** | 21.0% | 0/28 |

(Trade counts are identical across all three rows — cost doesn't change which trades
fire, only their realized R — so one count column covers all three.)

**Does this change the "costs vs no edge" read for `breakout`?** No verdict change: the
family was already negative and stays negative — a family that was already negative
getting more negative under a higher real cost is a confirmation of KILLED, not new
information. But the *size* of the gross/net gap is informative on the "only costs are
eating it, maker fills are a real lever" alternative reading `commands.js`'s own
diagnostic comment raises. By coincidence, the *old* assumed taker rate (0.004) equals
the *real* maker rate (0.004) — so the existing "old assumption" net-of-cost row above
(-0.445R holdout) is exactly what `breakout` would net under a hypothetical 100%-maker
execution at real rates. That number is still comfortably negative and clears none of
the gates this project has already tested against `breakout` (not `runTournament`'s own
`avgR>0`, not T1B/T5/TRAIL-STOP-EXIT's looser `avgR>-0.30`). **This resolves the open
question the `commands.js` comment poses for `breakout` specifically: even a switch to
100% maker/limit fills would not rescue it.** The gap does confirm cost dominates over
signal absence directionally (consistent with Track 1's original finding), just by a
larger margin than previously measured.

**Recommendation (not applied here — routed to Architect for a separate, deliberate
decision, per this item's own instruction not to fold a defaults change into this
commit):** update `strategy.js`'s `FEE_RATE` default from 0.004 to 0.008 (and consider
whether `commands.js`'s `"maker 0.16%"` tier should become 0.40%) so every future
tournament/backtest run reflects the account's real, verified execution cost by default
instead of understating it by roughly 2x on the fee component. Because every track this
project has run (T1–T6, PWR1–4, TRAIL-STOP-EXIT) was already comfortably outside its
gate even at the old, lower-cost assumption, this correction would not flip any existing
verdict — it only matters for future work, and for keeping the live-trading gate's cost
model honest if `breakout` or any other family is ever revisited. Note also that the
account's 30-day volume ($1,225) is well under the $2,500 Tier 1 ceiling, so this rate is
not a temporary artifact — it will hold until trading volume genuinely increases.

**Verdict: FEE-SCHEDULE-REBASE closed.** Actual fee tier confirmed live (not assumed);
`breakout` re-run and reported under corrected real cost; no existing verdict changes;
defaults-update recommendation stated explicitly and left for the Architect to act on,
not applied unilaterally.
