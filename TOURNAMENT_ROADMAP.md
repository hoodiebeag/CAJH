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

## H3-HIGHER-LOW-RECLAIM RESULT (2026-08-13)

Ground-up audit finding (COMPLETE-H3-VERDICT): `h3` (`backtest.js`'s `h3Entry`) is a
"selective higher-low reclaim" entry — requires at least two prior confirmed swing lows
forming a genuine higher-low structure (`last.price > prev.price`) before taking a
reclaim entry, a real trend-quality filter that `anticipate`/`bos` do not have (they take
every confirmed swing-low signal regardless of higher-low structure). Per this document's
own T6-TIMEFRAME-ISOLATION section above, `h3` was previously grouped into the closed
swing-low/pivot-reclaim family **by the same-mechanism argument only** — "added
separately by a concurrent process and... pre-registered nowhere" (Track 1 RESULT's own
coverage note) — never independently run through a sealed holdout. This closes that gap
with a real run rather than an inference. Not a re-opening of a KILLED verdict per
VERDICTS.md's own re-opening rule: `h3` was never tested in the first place.

`h3` was already present, unmodified, as a row in `tournament.mjs`'s `families` array
(config: `entryMode: "h3", trendGate: false, alignMode: "none", minStopPct: 0,
maxStopPct: .06, tpR: 5, lockBreakeven: true`) — it simply had never been read out and
gated on its own. No code change was needed; this item is a verdict-writing exercise
against an existing, already-correct harness.

**Pre-registered gate (both required, holdout only, matching this project's standard for
a narrow single-family follow-up — T5-DECAY-EXIT/TRAIL-STOP-EXIT's bar):**
- Holdout `avgR/trade > -0.30`
- Holdout trades >= 150

Ran `node tournament.mjs` (default `runTournament()`, net-of-cost from the module
defaults — `strategy.js`'s `FEE_RATE=0.008`/`SLIPPAGE_PCT=0.0005`, ~1.7% round trip, the
corrected real Kraken Tier-1 basis per FEE-SCHEDULE-REBASE above, not the older ~0.9%
figure), 70/30 chronological split, full watchlist (28 assets passing the `>=250`
candle-per-TF filter).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Train | 10911 | -1.526 | 29.7% | 28 | 0 (0%) |
| Holdout | 4590 | -1.652 | 28.5% | 28 | 0 (0%) |

Holdout trade count (4590) is well above the 150 floor, so this is a decisive result, not
an insufficient-sample non-verdict. Train and holdout agree in sign and rough magnitude
(-1.526 vs -1.652) — no train/holdout divergence to explain away. The higher-low
structural filter did not rescue the underlying swing-low/pivot-reclaim mechanism; if
anything the avgR here is markedly worse than `anticipate`/`bos`'s own net-of-cost holdout
numbers (-0.506 / -0.535 at the time of the Track 1 table), consistent with `h3`'s tighter
stop placement (`stop = min(low, pivot) - 0.001*entry`, essentially zero cushion) making
each loss proportionally larger in R terms once cost is applied.

**Gate check (pre-registered, not adjusted after seeing this):**
- Holdout `avgR/trade > -0.30` → -1.652 → **FAIL**
- Holdout `trades >= 150` → 4590 → PASS
- Combined: **FAIL**

**Verdict: H3-HIGHER-LOW-RECLAIM is closed as a FAIL**, now by a real sealed-holdout run
rather than by analogy. This replaces the argument-based closure T6-TIMEFRAME-ISOLATION's
own addendum note relied on for `h3` specifically. `range_sweep_reclaim` (the other family
closed by the same same-mechanism argument in that note) remains open pending its own
independent run — tracked separately as COMPLETE-RANGE-SWEEP-RECLAIM-VERDICT, not folded
into this item. No gate constant was touched after seeing these numbers.

## RANGE-SWEEP-RECLAIM RESULT (2026-08-13)

Ground-up audit finding (COMPLETE-RANGE-SWEEP-RECLAIM-VERDICT), same class of gap as
H3-HIGHER-LOW-RECLAIM above: `range_sweep_reclaim` (`backtest.js`'s
`rangeSweepReclaimEntry`) is materially more selective than the plain `sweep_reclaim` that
was actually tested (single touch of a 12-bar low, no MA-flatness or volume filter,
-0.590 train / -0.711 holdout FAIL) — it requires 2+ touches of the SAME support level
within the prior 24 bars (within 0.5% of the level), a flat 20/50 MA relationship
(range-bound market, not trending), AND volume expansion (>=1.2x the 20-bar average) on
the reclaim bar. `backtest.js`'s own code comment calls it "deliberately a separate
hypothesis from the broad sweep rule above." Per T6-TIMEFRAME-ISOLATION's addendum note,
it was previously closed by the same same-mechanism argument as `h3` — never
independently run through a sealed holdout. Not a re-opening of a KILLED verdict per
VERDICTS.md's own re-opening rule: `range_sweep_reclaim` was never tested in the first
place.

`range_sweep_reclaim` was already present, unmodified, as a row in `tournament.mjs`'s
`families` array (config: `entryMode: "range_sweep_reclaim", trendGate: false, alignMode:
"none", minStopPct: .01, maxStopPct: .06, tpR: 2, lockBreakeven: true`) — it simply had
never been read out and gated on its own. No code change was needed; this item is a
verdict-writing exercise against an existing, already-correct harness, identical in kind
to H3-HIGHER-LOW-RECLAIM above.

**Pre-registered gate (both required, holdout only, matching this project's standard for
a narrow single-family follow-up — T5-DECAY-EXIT/TRAIL-STOP-EXIT/H3-HIGHER-LOW-RECLAIM's
bar):**
- Holdout `avgR/trade > -0.30`
- Holdout trades >= 150

Ran `node tournament.mjs` (default `runTournament()`, net-of-cost from the module
defaults — `strategy.js`'s `FEE_RATE=0.008`/`SLIPPAGE_PCT=0.0005`, ~1.7% round trip, the
corrected real Kraken Tier-1 basis per FEE-SCHEDULE-REBASE above), 70/30 chronological
split, full watchlist (28 assets passing the `>=250` candle-per-TF filter).

**Result:**

| | Trades | avgR/trade (net) | Win rate | Assets traded | Positive assets |
|---|---|---|---|---|---|
| Train | 1055 | -1.090 | 31.7% | 28 | 0 (0%) |
| Holdout | 511 | -1.120 | 31.5% | 28 | 1 (3.6%) |

Holdout trade count (511) clears the 150 floor despite this family's own selectivity
(range-bound + multi-touch + volume filter) — this is a decisive result, not an
insufficient-sample non-verdict as the queued item flagged as a live possibility. Train
and holdout agree in sign and closely in magnitude (-1.090 vs -1.120) — no train/holdout
divergence to explain away. The support-retest and volume-expansion filters did not
rescue the underlying sweep-reclaim mechanism any more than `h3`'s higher-low filter did:
`range_sweep_reclaim`'s holdout avgR (-1.120) sits between plain `sweep_reclaim`'s
-0.711 and `h3`'s -1.652, all three markedly worse than `anticipate`/`bos`'s net-of-cost
holdout numbers (-0.506 / -0.535). Extra entry selectivity concentrated around swing-low
liquidity sweeps does not change the sign or magnitude of the underlying cost problem.

**Gate check (pre-registered, not adjusted after seeing this):**
- Holdout `avgR/trade > -0.30` → -1.120 → **FAIL**
- Holdout `trades >= 150` → 511 → PASS
- Combined: **FAIL**

**Verdict: RANGE-SWEEP-RECLAIM is closed as a FAIL**, now by a real sealed-holdout run
rather than by analogy. This replaces the argument-based closure T6-TIMEFRAME-ISOLATION's
own addendum note relied on for `range_sweep_reclaim` specifically, and together with
H3-HIGHER-LOW-RECLAIM above closes out both families that note had grouped in by
same-mechanism argument only. No gate constant was touched after seeing these numbers.

## TEST-TREND-GATE-FILTER RESULT (2026-08-13)

Ground-up audit finding: `strategy.js` exports a fully-implemented, currently-unused
per-asset trend-quality gate (`TREND_GATE=true`, `TREND_GATE_MODE="ma"|"structure"`,
`TREND_MA=20`), docstringed explicitly as "research-only... live scanner does not import
it." Per an exhaustive search of this file, `ROADMAP.md`, and `VERDICTS.md`, it had never
been tested. Not a duplicate of the already-tested Track 3 (`runBreakoutRegimeFilter`):
Track 3 gated only `breakout` on **BTC's own 200d SMA**, one market-wide regime signal
shared by every asset; `TREND_GATE` gates **any family on each asset's own trend
state** — "ma" mode asks whether that asset's 4h close is above its own trailing
TREND_MA(20) average, "structure" mode asks whether that asset's 4h is making higher
highs AND higher lows. It can pass entries Track 3 never touched and reject entries
Track 3 never saw.

Applied to the two most-tested, best-understood baselines — `anticipate` and `breakout`
— both modes, four combinations, via a new `tournament.mjs` function
(`runTrendGateFilter`, `--trend-gate-filter` CLI flag), full 28-asset watchlist,
corrected real cost basis (`FEE_RATE=0.008`/`SLIPPAGE_PCT=0.0005`, ~1.7% round trip).

**Wiring correction found and fixed before trusting any breakout number:** `backtest.js`'s
`trendGate` check only existed inside the `bos`/`anticipate` entry branches
(lines ~353-434). The `breakout` branch (and every other dip/breakout-style mode) lived
in a separate block whose own comment said "no trend/alignment gate (the whole point)" —
passing `trendGate: true` into that branch was silently ignored. The first run of this
test produced byte-identical `breakout` numbers for `trendGateMode: "ma"` and
`trendGateMode: "structure"`, which is what exposed it (a real gate cannot produce
identical output under two different modes). Added an opt-in `trendGate` check to that
branch, reusing the exact same `trendAsOf`/`aboveMaAsOf` "as-of" cursors the
`bos`/`anticipate` branches already use — active only when a config explicitly sets
`trendGate: true` (every existing default in `tournament.mjs`'s `families` table still
passes `false` for every dip/breakout-style family, so no other study's numbers change;
301/301 tests green after the change, including the two new `runTrendGateFilter` tests).
Re-ran after the fix; `breakout`'s "ma" vs "structure" numbers now genuinely differ.

**Pre-registered gate (both required, holdout only, scored per combination — same bar as
T5-DECAY-EXIT/TRAIL-STOP-EXIT/H3-HIGHER-LOW-RECLAIM/RANGE-SWEEP-RECLAIM):**
- Holdout `avgR/trade > -0.30`
- Holdout trades >= 150

A below-150-trades result was pre-registered as a legitimate, honest non-verdict (the
gate is expected to cut trade count substantially — it excludes any asset not currently
trending) rather than something to route around. In the event, every combination cleared
the trade floor by a wide margin, so no non-verdict applies here.

**Result:**

| Family | Mode | Train trades | Train avgR | Holdout trades | Holdout avgR | Holdout positive assets |
|---|---|---|---|---|---|---|
| anticipate | ma | 4759 | -0.738 | 1451 | -0.963 | 0/27 |
| anticipate | structure | 2916 | -0.741 | 641 | -1.062 | 0/24 |
| breakout | ma | 3662 | -0.851 | 1123 | -0.797 | 1/28 |
| breakout | structure | 2077 | -0.865 | 490 | -0.965 | 1/26 |

All four holdout trade counts (490-1451) clear the 150 floor decisively — none of these
are sample-starved non-verdicts. All four holdout avgR figures (-0.797 to -1.062) are
markedly worse than -0.30, and every train figure agrees in sign and rough magnitude with
its own holdout — no train/holdout divergence to explain away. Gating on trend state,
per-asset, in either mode, does not rescue either family: if anything, `anticipate` (whose
ungated holdout avgR is around -0.51 per T6-TIMEFRAME-ISOLATION's own baseline context)
gets **worse** under either trend-gate mode, and `breakout`'s trend-gated numbers stay in
the same deeply-negative range as every other tested variant of that family.

**Gate check (pre-registered, not adjusted after seeing these numbers):**
- anticipate/ma: avgR -0.963 → FAIL; trades 1451 → PASS; combined **FAIL**
- anticipate/structure: avgR -1.062 → FAIL; trades 641 → PASS; combined **FAIL**
- breakout/ma: avgR -0.797 → FAIL; trades 1123 → PASS; combined **FAIL**
- breakout/structure: avgR -0.965 → FAIL; trades 490 → PASS; combined **FAIL**

**Verdict: TEST-TREND-GATE-FILTER is closed as a FAIL across all four combinations.**
Recorded as VERDICTS.md's TREND-GATE-MA and TREND-GATE-STRUCTURE rows. The per-asset
trend-quality filter this repo had built but never tested does not change the standing
conclusion: every price-structure entry family and every filter applied to one, tested to
date, remains net-negative after real costs. No gate constant was touched after seeing
these numbers.

## PORTFOLIO-LIVE-SIGNAL-SIM RESULT (2026-08-14)

A capital-allocation/diversification question, not a new signal: every study to date,
including `backtest.js` itself, measures one symbol at a time with no shared capital and
no cross-position exposure cap. This runs the existing live swing-fractal signal
(`strategy.js`'s `detectSwings`/`entrySignal`, imported unchanged, no re-derived
approximation) across the full watchlist simultaneously through `portfolio.mjs`'s
already-audited `simulatePortfolio()`, to ask whether realistic shared-capital
diversification clears the gate even though no single symbol does alone.

Added `swing_fractal_portfolio` to `portfolio.mjs`'s existing `strategies` map (reusing
`runPortfolioStudy()`'s sealed 70/30 chronological split unmodified, no new harness). At
each rebalance step, for every symbol with a recently-confirmed swing low
(`entrySignal`'s own recency window, `RECENT_BARS`), position size is `strategy.js`'s own
live risk formula verbatim — `RISK_PCT / stopFrac`, capped per-symbol at
`MAX_POSITION_PCT`, gated by the same `MIN_STOP_PCT`/`MAX_STOP_PCT_BY_TF["1d"]` stop band
`scanner.js` applies live. Because this universe is entirely correlated crypto longs, the
never-yet-executed "correlated-exposure cap" from `ROADMAP.md`'s go-live checklist is
applied on top: if the sum of individually-sized positions exceeds a new
`MAX_PORTFOLIO_EXPOSURE_PCT` (60%, chosen and fixed in code before this run — see
`portfolio.mjs` for the reasoning), all weights are scaled down pro-rata to that ceiling
rather than left to sum arbitrarily high on a day when many correlated signals fire
together. Full watchlist (28 assets, BTC excluded as with every other `portfolio.mjs`
strategy).

**Pre-registered gate (same style as every other portfolio-level entry in this document,
fixed before reading the holdout numbers below):**
- Holdout Sharpe > 0.5
- Holdout total return > 0
- Holdout max drawdown > -35%

**Result:**

| Variant | Train Sharpe | Train total return | Train max drawdown | Holdout Sharpe | Holdout total return | Holdout max drawdown |
|---|---|---|---|---|---|---|
| `swing_fractal_portfolio`, 7d rebalance | -0.086 | -11.6% | -72.0% | -0.231 | -14.2% | -53.4% |
| `swing_fractal_portfolio`, 30d rebalance | -0.164 | -18.1% | -66.9% | -0.375 | -21.9% | -58.2% |

**Gate check (pre-registered, not adjusted after seeing these numbers):**
- 7d rebalance: Sharpe>0.5 FAIL (-0.231), totalReturn>0 FAIL (-14.2%), maxDrawdown>-35%
  FAIL (-53.4%) → all three FAIL
- 30d rebalance: Sharpe>0.5 FAIL (-0.375), totalReturn>0 FAIL (-21.9%), maxDrawdown>-35%
  FAIL (-58.2%) → all three FAIL

**Verdict: FAIL, both variants, all three clauses each.** Diversification and
correlated-exposure-capped shared-capital sizing do not rescue this signal — running it
across 28 assets simultaneously is markedly *worse* on every measured axis (Sharpe,
return, and drawdown) than the already-abandoned Track 4 cross-sectional momentum
strategies, not merely no-better. The train-window sign agrees with holdout on both
variants (no train/holdout divergence to explain away), and drawdown breaches the -35%
floor by a wide margin in every case — this is not a borderline near-miss the way Track
4's `momentum_30d` 30d-rebalance drawdown clause was. Recorded as VERDICTS.md's
`PORTFOLIO-LIVE-SIGNAL-SIM` row. No gate constant, including the newly-introduced
`MAX_PORTFOLIO_EXPOSURE_PCT`, was touched after seeing these numbers. This closes the
capital-allocation angle for the existing swing-fractal signal specifically; it does not
speak to whether a *different* entry signal would fare better under the same
shared-capital/correlated-exposure-cap machinery, which this item's own scope never
claimed to test.

## FUNDING-MEANREV RESULT (2026-08-14)

Human-authored pre-registered test (TEST3-FUNDING-MEANREV). Hypothesis: spot longs
gated on negative perpetual funding (shorts paying longs — a structural mean-reversion
tailwind) produce positive expected value, on top of the existing `breakout` trigger —
a genuinely different information source from every price-structure-only family above.
Distinct from H11 (funding <=0.01% as a low-funding *inclusion* gate on `anticipate`):
this uses a signed, strictly-negative funding threshold as an entry veto on `breakout`.

**Data-availability gate, run first.** Binance USD-M funding (`fundinglib.mjs`) is
confirmed HTTP 451 geo-blocked from this environment — same finding H11 already made.
Kraken's public historical-funding-rates endpoint (`derivatives.mjs`) is reachable and
was checked directly against all 29 watchlist assets: 28/29 have ~366.1 days of funding
history (EOS has a single broken data point and was excluded), comfortably clearing the
>=365-day / >=8-asset gate this item pre-registered. This is *not* a repeat of H11's own
data-gated non-verdict — H11 needed 730 days for its gate and never got any assets past
data availability; this item's own gate only needed 365 days and 28/29 assets clear it.

**Split-boundary deviation, disclosed before any result was read.** The task's own
literal train/holdout boundary ("earliest available funding data to 2025-06-01" for
train, "2025-06-01 to present" for holdout) predates Kraken funding data existing at all
— funding history starts 2025-08-13, after the specified train cutoff, which would leave
the train split empty as literally written. Instead of forcing that broken boundary, the
70/30 chronological split was applied within the funding-covered window itself, per
asset (see `funding-meanrev.mjs`'s `windowedSplit`) — the same fraction-split convention
this project already uses in `funding-gate-h11.mjs` and `funding-study.mjs`. This changes
*where* the split falls, not any of the three pass/fail gate numbers below, which were
fixed before this run per the pre-registered spec.

Config: exact `breakout` baseline from `tournament.mjs`'s `families` table (tpR=3,
minStopPct=.01, maxStopPct=.06, lockBreakeven=true, alignMode="none"), entryTf 1h, full
watchlist, real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round
trip — `strategy.js`'s live-verified constants, not a lower figure). Entry gate: funding
rate at the entry bar's close < -0.005% AND `breakout`'s own trigger fires (both required,
same AND semantics `entryGate` already enforces for every other family in this project).

**Pre-registered train gate (must pass before holdout is even examined):** avgR/trade
> -0.50 AND trades >= 150.

**Result — train gate FAILS on both clauses, holdout never examined:**

| | avgR/trade | trades | assets w/ >=1 trade | positive assets |
|---|---|---|---|---|
| Train | -0.891 | 131 | 19 / 28 | 3 / 19 |

Gate check: avgR>-0.50 FAIL (-0.891), trades>=150 FAIL (131) — both clauses fail, and
per this item's own pre-registered discipline ("Gates are immutable once the test
begins") the holdout window was not examined at all.

**Verdict: TRAIN-GATE-FAIL.** The funding+breakout combination is highly selective (9 of
28 assets never fired a single trade in the train window; the whole watchlist ends
~366 days of usable funding history 131 trades total) and, where it does fire, the train
sample is decisively negative — this is not a sample-size non-verdict the way H11's own
data-gated result was. Negative funding as a mean-reversion entry filter, layered on the
`breakout` trigger, does not clear this project's own train significance bar and joins
the standing conclusion in VERDICTS.md: every price-structure entry family and every
filter/gate applied to one, tested to date, remains net-negative or worse after real
costs. Recorded as VERDICTS.md's `FUNDING-MEANREV` row and as a `funding-meanrev` decision
journal entry (`research-runs/2026-08-14T10-09-51-900Z-funding-meanrev.json`).

## ONCHAIN-FLOW-GATE RESULT (2026-08-14)

Human-authored pre-registered test (TEST4-ONCHAIN-FLOW-GATE). Hypothesis: breakout
entries gated on 7-day rolling net exchange outflow (coins leaving exchanges = reduced
sell pressure, BTC/ETH, 1d timeframe only) produce holdout avgR/trade > -0.30, because
on-chain flow is a leading demand indicator unavailable to every price-structure-only
family tested to date.

**Data-availability gate, run first — exactly as this item's own task text anticipated.**
This repo has never done on-chain data ingestion before this item: no Glassnode/
CryptoQuant client, no cached flow series, nothing (confirmed directly — no matching
source file anywhere in the tree). Checked Glassnode's public
`transactions/transfers_volume_exchanges_net` endpoint directly (the closest free-tier
metric to "net exchange flow"): it returns **HTTP 401** for both BTC and ETH. `.env` was
checked directly and has no `GLASSNODE_API_KEY` or `CRYPTOQUANT_API_KEY` — the only two
providers this item's task text named — and this project's unattended automation has no
path to register one (account creation is outside its scope). CryptoQuant's equivalent
free-tier flow endpoint was also checked directly and returns the same HTTP 401.

Per this item's own pre-registered `done_when`: "if fewer than 24 months of daily
on-chain flow data are available for both BTC and ETH, record ONCHAIN-DATA-INSUFFICIENT
in the decision journal and stop — a complete, valid result." 0 of the 2 required assets
clear data availability (both fail before any history-length check is even reachable),
so the gate fails immediately.

**Verdict: ONCHAIN-DATA-INSUFFICIENT.** The entry-gate/backtest logic described in the
hypothesis above was not built out — with zero real data ever reachable in this
environment, it would be untested, unexercised code with no way to verify it does what it
claims, which this project's simplicity convention avoids (see `onchain-flow-gate.mjs`'s
module doc comment). This is not a failure to execute the item; it is the
data-availability gate doing exactly the job this item's own task text pre-registered it
for. Recorded as VERDICTS.md's `ONCHAIN-FLOW-GATE` row and as an `onchain-flow-gate`
decision journal entry
(`research-runs/2026-08-14T11-05-22-370Z-onchain-flow-gate.json`).

## FIB-PULLBACK RESULT (2026-08-14)

Human-authored pre-registered test (TEST1-FIB-PULLBACK). Hypothesis: entering at a
50-61.8% Fibonacci retracement of a confirmed break-of-structure swing leg reduces
adverse selection vs. the `anticipate`/`bos` families' own entries (which buy the
break itself), producing holdout avgR/trade > -0.30.

**Implementation, pre-registered before any run.** The task's own text names "a
confirmed BOS candle close" and "the swing leg (low to high of that move)" without
defining either in terms of this codebase's actual primitives — resolved as follows,
before examining any result: this codebase already has one concrete, unambiguous
definition of a confirmed break-of-structure — `bos` mode's own entry trigger
(`lowAt`/`pivE` in backtest.js: a candidate swing low's close breaking back above
its own high). Reusing that event verbatim (rather than inventing a second,
competing BOS definition) makes the swing leg well-defined too: the originating low
through the highest high reached by the confirming bar, both already known at that
bar with no look-ahead. `breakoutEntry`'s own N-bar-high trigger has no low endpoint
and so cannot supply a "swing leg" at all — it is used here only as the stop-size-cap
template (`minStopPct .01`, `maxStopPct .06`, matching `breakout`'s own family
config), the same apples-to-apples convention Track 2 used for `vol_contraction`.
Added as backtest.js's new `fib_pullback` entryMode: a resting limit order armed the
bar a swing low confirms, at `legHigh - fibLevel*(legHigh-legLow)`, stop
`legLow - 0.001*legLow`, TP at `tpR`; one order at a time, cancelled (not filled) if
price reaches the stop before ever touching the limit level. `lockBreakeven` left
off — the spec is a fixed stop/TP structure, not a managed exit. 4 new unit tests in
backtest.test.mjs cover the fill/no-fill/cancel/one-order-at-a-time mechanics against
hand-computed synthetic candles.

**Split-boundary note.** Unlike FUNDING-MEANREV/ONCHAIN-FLOW-GATE, this hypothesis
needs no external data source (pure price action, already fully covered by local
candle history) — no data-availability gate was needed, and the task's literal fixed
calendar-date split (train: earliest available to 2025-06-01; holdout: 2025-06-01 to
present) was used exactly as specified, no substitution required.

Config: `entryMode: "fib_pullback"`, `trendGate: false`, `alignMode: "none"`,
`minStopPct: .01`, `maxStopPct: .06`, `tpR: 3`, `lockBreakeven: false`, entryTf 1h,
full 28-asset watchlist, real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/
side, ~1.7% round trip). Levels 0.5 and 0.618 tested as two fully independent runs
(`tournament.mjs --fib-pullback`, `runFibPullback`).

**Pre-registered train gate (must pass before holdout is even examined), per level:**
avgR/trade > -0.50 AND trades >= 200.

**Result — train gate fails on the avgR clause for BOTH levels, holdout never
examined for either:**

| Level | avgR/trade | trades | assets w/ >=1 trade | positive assets |
|---|---|---|---|---|
| 50% | -0.907 | 362 | 23 / 28 | 2 / 23 |
| 61.8% | -0.770 | 225 | 21 / 28 | 2 / 21 |

Gate check (both levels): avgR>-0.50 FAIL, trades>=200 PASS. Per this item's own
pre-registered discipline ("Gates are immutable once the test begins"), the holdout
window was not examined for either level.

**Verdict: TRAIN-GATE-FAIL (both levels).** The deeper 61.8% retracement is less
negative than the shallower 50% level (-0.770 vs -0.907) and fires fewer trades (225
vs 362, consistent with requiring a bigger pullback) — a real but small effect, not
close to clearing the train bar. Retracing into the leg instead of buying the
breakout itself does not produce a better entry than `bos`/`anticipate` already
tested (-0.425/-0.361 train avgR respectively, this document's "Honest Baseline
First" table) — if anything it is meaningfully worse, consistent with the fill
requiring price to give back part of the very move that was the entry signal.
Recorded as VERDICTS.md's `FIB-PULLBACK` row and as two decision journal entries, one
per level (`research-runs/2026-08-14T12-16-45-894Z-fib-pullback-50.json`,
`research-runs/2026-08-14T12-16-45-940Z-fib-pullback-618.json`).

## VOL-CONFIRM-BREAKOUT RESULT (2026-08-14)

Human-authored pre-registered test (TEST2-VOL-CONFIRMED-BREAKOUT), queued alongside
TEST1/TEST3/TEST4 with no inter-dependencies. Hypothesis: gating `breakout` entries on
relative volume at the entry bar filters adverse selection, producing holdout
avgR/trade > -0.30.

**Implementation.** relVol at bar `k` = `volume[k] / mean(volume[k-20..k-1])` — the
entry bar's own volume is excluded from its own average, the same no-look-ahead
convention `breakoutEntry`'s N-bar-high trigger and `backtest.js`'s `maTimeline` already
use (`tournament.mjs`'s new `relVolTimeline`/`makeRelVolAboveAt`). Wired purely through
`backtest.js`'s existing `entryGate` hook — no backtest.js change — same technique
`funding-meanrev.mjs` and Track 3's `buildBtcAboveMa200At` already use. `breakout`'s
exact `tournament.mjs` baseline config (`minStopPct .01`, `maxStopPct .06`, `tpR 3`,
`lockBreakeven true`) reused unmodified, so this result is comparable to every other
breakout-family verdict already in VERDICTS.md. Three thresholds tested: 1.5x, 2.0x,
3.0x.

**Selection process (pre-registered, immutable once begun).** Per the task's own text
("fix the best threshold ON THE TRAIN SPLIT ONLY, then evaluate holdout exactly once"),
all three thresholds were scored on TRAIN first; the best-on-train threshold (highest
train avgR/trade among those clearing the train gate) is the only one whose holdout is
ever computed — the other two never touch the holdout window, avoiding exactly the
look-ahead the task text calls out. This is a genuinely different selection discipline
from FIB-PULLBACK's two independently-gated levels above: here only one variant's
holdout is ever examined, not both/all three.

**Split-boundary note.** Volume is already inside every OHLCV candle (no external data
source), so no data-availability gate was needed — the task's literal fixed
calendar-date split (train: earliest available to 2025-06-01; holdout: 2025-06-01 to
present) was used exactly as specified, no substitution required.

**Pre-registered train gate (must pass before a threshold is even selected):**
avgR/trade > -0.50 AND trades >= 200.

**Result — all three thresholds fail the train gate on the avgR clause, no threshold
selected, holdout never examined for any of them:**

| Threshold | avgR/trade | trades | assets w/ >=1 trade | positive assets |
|---|---|---|---|---|
| 1.5x | -0.854 | 5224 | 28 / 28 | 0 / 28 |
| 2.0x | -0.857 | 4578 | 28 / 28 | 0 / 28 |
| 3.0x | -0.794 | 3427 | 28 / 28 | 0 / 28 |

Gate check (all three): avgR>-0.50 FAIL, trades>=200 PASS (by a wide margin — the
volume filter did not meaningfully restrict which bars fired, unlike FIB-PULLBACK's
50%/61.8% levels which cut trade count roughly in half vs. baseline). Per this item's
own pre-registered discipline, the holdout window was not examined for any threshold.

**Verdict: TRAIN-GATE-FAIL (all three thresholds).** The tightest threshold (3.0x, the
fewest trades) is the least negative (-0.794), a monotonic direction consistent with
selectivity mattering somewhat — but all three remain far worse than unfiltered
`breakout`'s own train avgR (-0.454, this document's "Honest Baseline First" table).
Gating entries on HIGH relative volume made this family's entries meaningfully worse,
not better: a plausible read is that a volume spike at a breakout bar is itself evidence
of a crowded/exhausted move (the kind of bar the fee-and-slippage-inclusive R math
already punishes hardest), not confirmation of a durable continuation. Recorded as
VERDICTS.md's `VOL-CONFIRM-BREAKOUT` row and as three decision journal entries, one per
threshold (`research-runs/2026-08-14T13-09-09-926Z-vol-confirm-15.json`,
`research-runs/2026-08-14T13-09-09-974Z-vol-confirm-20.json`,
`research-runs/2026-08-14T13-09-10-022Z-vol-confirm-30.json`).

**Human-authored TEST1-4 queue status.** TEST1-FIB-PULLBACK (TRAIN-GATE-FAIL, both
levels), TEST2-VOL-CONFIRMED-BREAKOUT (TRAIN-GATE-FAIL, all three thresholds), and
TEST4-ONCHAIN-FLOW-GATE (ONCHAIN-DATA-INSUFFICIENT, a data-availability non-verdict) are
now closed; TEST3-FUNDING-MEANREV is also closed (TRAIN-GATE-FAIL). All four items in
this human-authored queue have now ended FAIL/abandoned or a data-availability
non-verdict. Per the human's own execution rule for this queue, none of these four
should be re-tuned further on the same axis (funding threshold, retracement level,
on-chain data source, volume multiple) — the next step is a new hypothesis queue, not
continued search within this exhausted set.

## JUDGE-WALKFORWARD-SYMBOL-HOLDOUT RESULT (2026-08-14): new standard judge, harness only

Research infrastructure, pulled directly from ROADMAP.md's "Finding an edge" list:
"Walk-forward + sealed holdout (time AND symbol) — the honest final validation; the last
piece of the judge." Not a hypothesis test — no strategy family was run through this, no
VERDICTS.md row is added, and no already-decided verdict above is reopened or re-run.

**What every verdict above actually used.** Every TEST/T*/Track result in this document
scored a single chronological split (usually a fixed 70/30 fraction, sometimes a fixed
calendar date) over the full watchlist — one static cut on the time axis, and no symbol
was ever held out of every sweep entirely. That is a weaker judge than the project's own
stated bar: a strategy that happens to work on one particular split, or that was only ever
tested on symbols that also appeared in some earlier train run, hasn't been checked against
genuinely unseen time *or* genuinely unseen symbols.

**What was built, in `researchlib.mjs` (the shared-helpers module `tournament.mjs` and
`momentum.mjs` already both import from — the natural home so any study can pull this in
the same way it already pulls in `loadWatchlist`/`stat`, instead of hand-deriving its own
`STABLE_13`-style list or its own `splitSeries` fraction cut):**

- **`SEALED_SYMBOLS`** — a frozen, five-symbol list (`AVAX`, `LINK`, `NEAR`, `SUI`, `UNI`)
  chosen once, before any study has used this harness, and never to be edited afterward
  (editing it later would retroactively un-seal or re-seal data a prior run already
  touched). Deliberately excludes BTC/ETH/SOL/XRP, the majors most existing verdicts are
  already anchored to, so the active pool a study trains on stays representative. Distinct
  from `momentum.mjs`'s `STABLE_13`/`PRIMARY_SYMBOL_HOLDOUT`, which is that study's own
  cross-sectional train/holdout split, not this project-wide seal.
- **`splitSealedSymbols(watchlist)`** — partitions any watchlist (both of `loadWatchlist()`'s
  output shapes) into `{ active, sealed }`. `active` is what a study's normal train/holdout
  sweep should run over; `sealed` is reserved for the one-time final validation of a
  candidate that has already cleared its normal holdout gate — not for use in any
  train/holdout cycle before that point.
- **`walkForwardWindows(candles, { folds, trainFraction })`** — replaces one static
  train/holdout cut with `folds` anchored/expanding walk-forward folds: fold *i*'s train is
  always a prefix of the series (candles[0, cut_i)), its holdout is the next unseen slice,
  and the holdouts across all folds tile the remainder of the series with no gap or overlap.
  A study that wants a genuinely rolling validation (rather than one draw from one split)
  now has one call instead of writing its own loop.
- **`walkForwardSeriesWindows(series, opts)`** — the same fold logic applied to this
  project's standard multi-timeframe `series` shape (`[{label, mins, candles}, ...]`, as
  `tournament.mjs`'s `seriesFor` and every `loadResearchCandles` consumer already produce).
  Cuts are computed on the anchor timeframe and applied to every other timeframe by candle
  `.time` boundary rather than by index, mirroring `splitSeries`'s existing convention —
  necessary because different timeframes have different candle counts over the same
  wall-clock span.

**Usage pattern for a future study** (not run here — this item is infrastructure only, per
its own `done_when`): call `splitSealedSymbols(loadWatchlist())` and run the normal
train/holdout sweep over `active` exactly as every study above already does; call
`walkForwardSeriesWindows` in place of a single `splitSeries` cut when a rolling validation
across multiple time folds is wanted instead of one static split; reserve `sealed` for the
literal final check on a candidate that has already cleared every gate above, run once, not
tuned against.

**Tests.** 8 new unit tests in `researchlib.test.mjs`: `splitSealedSymbols` partitions both
watchlist shapes correctly and never drops/duplicates an entry; `walkForwardWindows`'s folds
have strictly-growing train windows, holdouts that tile the remainder with no gap/overlap
and no lookahead, reject invalid `folds`/`trainFraction`, and skip folds too small to hold a
candle rather than emit an empty one; `walkForwardSeriesWindows` cuts a second timeframe at
the same wall-clock boundary as the anchor despite a different bar count. `npm.cmd test`
green (full suite, not just the new file).

**Does not require re-running any already-KILLED verdict** — nothing above changes; this is
additive infrastructure for whatever the next hypothesis queue promotes.

## ATR-ADAPTIVE-STOP-CONFIRMATORY RESULT (2026-08-14)

Human-directed research: `backtest.js`'s `stopMode="atr"`/`atrStopK`/`atrPeriod` options
place a volatility-scaled stop (`atrStopK` ATRs below entry) instead of the structural
swing-low stop — grep-confirmed to have zero prior VERDICTS.md presence, every earlier
mention citing it only as precedent for another option's no-op-when-omitted pattern.
Pre-registered grid: `atrStopK` in {1.5, 2, 2.5, 3, 4} x `atrPeriod` in {14, 20}, applied to
`breakout` and `anticipate`, full 28-asset watchlist, standard 70/30 split, net-of-cost from
the start (`backtest.js`'s own `FEE_RATE=0.008`/`SLIPPAGE_PCT=0.0005` defaults, the corrected
real basis per FEE-SCHEDULE-REBASE). Implemented as `tournament.mjs`'s new
`runAtrAdaptiveStop`, gated behind `--atr-adaptive-stop`; zero `backtest.js` changes, exactly
as the task predicted.

**Mid-run discovery, disclosed rather than absorbed silently: `stopMode`/`atrStopK` have NO
effect on the `breakout` family.** `backtest.js`'s `breakoutEntry()` (its own dedicated
trigger function for `entryMode:"breakout"`) hardcodes its stop as `entry - 2 * atr(k-1,
atrPeriod)` — it reads `atrPeriod` but never reads `stopMode` or `atrStopK` at all. Verified
directly: running `breakout` with no `stopMode` override whatsoever produces holdout
avgR=-0.8640/3156 trades, train avgR=-0.8772/7386 trades — an exact match, to the decimal, of
every `atrStopK in {1.5,2,2.5,3,4}` cell at `atrPeriod=14` below. In other words, `breakout`'s
"structural" stop was never structural in the first place — it has always been a fixed 2x-ATR
stop, just not exposed as configurable the way `stopMode="atr"` implies. This means the
`breakout` half of the pre-registered grid does not actually test the hypothesis it was
built to test (varying `atrStopK`); it only incidentally varies `atrPeriod` (14 vs 20), a
different and much narrower question. This is a genuine scope-narrowing finding about the
codebase, not a result to paper over — reported here in full rather than either silently
re-scoping the item after the fact or misreporting the 10 breakout cells as if the multiplier
had actually varied. Fixing `breakoutEntry` to honor `atrStopK` is out of scope for this item
(a real `backtest.js` code change, not the "zero new backtest.js code" grid sweep this item
was pre-registered as) and is not attempted here.

**Full grid — holdout avgR/trade, trade count, % positive assets, per cell:**

| Family | atrStopK | atrPeriod | Holdout avgR | Holdout trades | Positive assets | Train avgR | Train trades | Gate |
|---|---|---|---|---|---|---|---|---|
| breakout | 1.5 | 14 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | FAIL |
| breakout | 1.5 | 20 | -0.8425 | 3148 | 0/28 | -0.8574 | 7327 | FAIL |
| breakout | 2 | 14 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | FAIL |
| breakout | 2 | 20 | -0.8425 | 3148 | 0/28 | -0.8574 | 7327 | FAIL |
| breakout | 2.5 | 14 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | FAIL |
| breakout | 2.5 | 20 | -0.8425 | 3148 | 0/28 | -0.8574 | 7327 | FAIL |
| breakout | 3 | 14 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | FAIL |
| breakout | 3 | 20 | -0.8425 | 3148 | 0/28 | -0.8574 | 7327 | FAIL |
| breakout | 4 | 14 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | FAIL |
| breakout | 4 | 20 | -0.8425 | 3148 | 0/28 | -0.8574 | 7327 | FAIL |
| anticipate | 1.5 | 14 | -0.8972 | 4971 | 0/27 | -0.7518 | 11176 | FAIL |
| anticipate | 1.5 | 20 | -0.9085 | 5014 | 0/28 | -0.7635 | 11235 | FAIL |
| anticipate | 2 | 14 | -0.7582 | 4781 | 0/27 | -0.6709 | 10381 | FAIL |
| anticipate | 2 | 20 | -0.7578 | 4898 | 0/28 | -0.6880 | 10506 | FAIL |
| anticipate | 2.5 | 14 | -0.6640 | 4010 | 0/28 | -0.5848 | 8874 | FAIL |
| anticipate | 2.5 | 20 | -0.6543 | 4064 | 0/28 | -0.5968 | 9009 | FAIL |
| anticipate | 3 | 14 | -0.5809 | 3396 | 0/28 | -0.5214 | 7620 | FAIL |
| anticipate | 3 | 20 | -0.5646 | 3415 | 0/28 | -0.5324 | 7593 | FAIL |
| anticipate | 4 | 14 | -0.4745 | 2567 | 0/28 | -0.4648 | 5879 | FAIL |
| anticipate | 4 | 20 | -0.4873 | 2542 | 0/28 | -0.4462 | 5663 | FAIL |

**Gate (per cell, holdout only, no train-gate stage): avgR/trade > 0 AND trades >= 150 AND
positiveAssets/assets >= 0.50 — the same bar T2-VOLCONTRACTION used. 0/20 cells pass; 0/28
holdout assets are ever net-positive at any grid cell for either family.**

**Structural-stop baseline comparison (both baselines re-run fresh, same split/watchlist/cost
basis, for an apples-to-apples reading rather than citing this document's stale ~0.9%-cost
"Honest Baseline First" table above).** `anticipate` structural stop: holdout avgR=-0.8842,
3966 trades, 0/27 positive. Best ATR cell (k=4, p=14): holdout avgR=-0.4745, 2567 trades —
materially less negative (roughly half the loss per trade) and a real, valid test since
`atrStopK` genuinely varies the anticipate stop. Still a decisive gate FAIL (needs >0, not
merely "less negative"), and the pattern across the grid is monotonic and mechanical: a wider
stop (higher `atrStopK`) shrinks position size proportionally, which shrinks realized R-loss
per trade toward zero from below without ever crossing it — not evidence of a real edge
emerging, just less risk taken per trade. `breakout` structural stop (re-verified: identical
across all `atrStopK` for the reason above): holdout avgR=-0.8640 at atrPeriod=14, -0.8425 at
atrPeriod=20 — both far outside the gate, and the ~0.02R atrPeriod-only difference is noise
relative to the -0.86R baseline, not a signal.

**Verdict: ATR-ADAPTIVE-STOP-CONFIRMATORY FAIL.** No family/grid-cell combination clears the
pre-registered gate. `anticipate`'s ATR-stop arm is a real, valid test of the hypothesis and
fails decisively despite a real (if mechanical) improvement over its structural-stop
baseline. `breakout`'s ATR-stop arm is not actually a test of `atrStopK` at all — a
scope-narrowing discovery about `breakoutEntry`'s hardcoded stop, disclosed above, not a
grid result to trust at face value. Both closed. This closes the "built but never verdicted"
gap `stopMode="atr"` represented, regardless of outcome. Recorded as VERDICTS.md's
`ATR-ADAPTIVE-STOP-CONFIRMATORY` row and as 20 decision journal entries
(`research-runs/2026-08-14T16-08-5*-atr-adaptive-stop-*.json`).

## WIDE-STOP-HIGH-TARGET-ASYMMETRY RESULT (2026-08-14)

Human-directed research: tests the classic trend-following "cut losses short, let profits
run" shape — an asymmetric R-distribution (few large winners funding many small losers) that
can be net-positive even at a low win rate if the winner/loser MAGNITUDE ratio is large
enough. Not directly tested before: T1B-BREAKOUT-COSTFIX only widened `tpR` 3->5 as a single
value while `lockBreakeven` stayed active; TRAIL-STOP-EXIT replaced the fixed target with a
different mechanism entirely, also with breakeven in the picture. Pre-registered grid:
`maxStopPct` (ceiling on the accepted structural stop, each family's own `minStopPct` floor
unchanged) in {6%,7%,8%,9%,10%} x `tpR` in {6,8,10,15,20}, applied to `breakout` and
`anticipate`, `lockBreakeven: false` throughout — 5x5=25 cells per family, 50 total. Full
28-asset watchlist, standard 70/30 split, net-of-cost from the start. Implemented as
`tournament.mjs`'s new `runWideStopHighTargetAsymmetry`, gated behind
`--wide-stop-high-target`; zero `backtest.js` changes (every knob used —
`maxStopPct`/`tpR`/`lockBreakeven`/`maxHold` — was already an overridable param).

**Pre-registered prerequisite check: MAX_HOLD censoring.** At the default `maxHold=100`
(backtest.js's `MAX_HOLD`, ~4 days on 1h candles), a stale position is force-closed at market
before genuinely reaching a distant target — the task's own explicit warning that this could
understate the "let it run" thesis. Measured directly (not assumed): timeout-censoring is
material EVERYWHERE in this grid, not only its widest corner — even the mildest cell sampled
(`maxStopPct=6%, tpR=6`) censored 9.1% (breakout) / 12.2% (anticipate) of trades, rising to
17.0% / 21.3% at the widest (`maxStopPct=10%, tpR=20`). `maxHold=4320` (180 days) is the
smallest value tested at which censoring reaches ~0% at every sampled cell (100 -> 500 -> 1000
-> 2160 -> 4320 bars swept at the extreme cell first), so it is used for the FULL 50-cell grid
below, applied uniformly (not selectively) so every cell stays comparable.

**What extending maxHold actually changes (the full exits breakdown, not just the aggregate
avgR)** — measured at both the mildest and widest sampled cells, `maxHold=100` vs `=4320`:

| Cell | Family | maxHold | Trades | avgR | Target-hit rate | Stop rate | Timeout rate |
|---|---|---|---|---|---|---|---|
| stop6%/tp6R | breakout | 100 | 2516 | -0.9388 | 10.5% (265) | 80.4% | 9.1% (230) |
| stop6%/tp6R | breakout | 4320 | 2228 | -0.9572 | 13.6% (304) | 86.4% | 0.0% |
| stop6%/tp6R | anticipate | 100 | 3250 | -0.8944 | 7.8% (254) | 74.9% | 12.2% (395) |
| stop6%/tp6R | anticipate | 4320 | 2722 | -0.9351 | 12.0% (328) | 82.3% | 0.0% |
| stop10%/tp20R | breakout | 100 | 2330 | -0.9971 | 0.6% (14) | 82.4% | 17.0% (397) |
| stop10%/tp20R | breakout | 4320 | 1322 | -1.1685 | 3.5% (46) | 96.5% | 0.0% |
| stop10%/tp20R | anticipate | 100 | 2883 | -0.8827 | 0.3% (8) | 73.6% | 21.3% (614) |
| stop10%/tp20R | anticipate | 4320 | 1222 | -1.1591 | 2.7% (33) | 91.2% | 0.0% |

Giving trades real time to resolve does let more of them actually reach target — at the
widest cell, target-hit rate roughly quintuples once censoring is removed (breakout
0.6%->3.5%, anticipate 0.3%->2.7%) — but target remains rare throughout, even at the mildest
cell (breakout 10.5%->13.6%, anticipate 7.8%->12.0%), and **avgR/trade gets MORE negative
after extending, not less, at every sampled cell.** Removing the censoring ambiguity reveals a
worse picture than the default `maxHold` showed, not a better one obscured by premature
timeouts — the previously-censored trades resolve mostly to stop, not to the distant target
the "let it run" thesis needed them to reach. Checked against this item's own done_when
requirement that the extension "does not silently change results for the lower-R cells": it
shifts them in the same worsening direction as everywhere else in the grid (mildest cell avgR
moves -0.02 to -0.04R more negative; widest moves -0.17 to -0.28R more negative) — a
consistent de-biasing, not a distortion localized to one region.

**Full grid — holdout avgR/trade, trade count, timeout rate (0.0% everywhere at
`maxHold=4320`, confirming the extension did its job), positive-asset fraction, train avgR,
train trades, per cell:**

| Family | Stop | tpR | Holdout avgR | Holdout n | Timeout% | Pos assets | Train avgR | Train n |
|---|---|---|---|---|---|---|---|---|
| breakout | 6% | 6R | -0.9572 | 2228 | 0.0% | 1/28 | -0.8598 | 5157 |
| breakout | 6% | 8R | -1.0938 | 1928 | 0.0% | 1/28 | -0.8546 | 4612 |
| breakout | 6% | 10R | -1.1418 | 1789 | 0.0% | 2/28 | -0.8124 | 4211 |
| breakout | 6% | 15R | -1.0898 | 1525 | 0.0% | 2/28 | -0.7662 | 3498 |
| breakout | 6% | 20R | -1.1560 | 1326 | 0.0% | 2/28 | -0.6556 | 3100 |
| breakout | 7% | 6R | -0.9595 | 2231 | 0.0% | 1/28 | -0.8561 | 5160 |
| breakout | 7% | 8R | -1.0970 | 1927 | 0.0% | 1/28 | -0.8453 | 4598 |
| breakout | 7% | 10R | -1.1466 | 1789 | 0.0% | 2/28 | -0.8057 | 4189 |
| breakout | 7% | 15R | -1.0891 | 1528 | 0.0% | 2/28 | -0.7624 | 3468 |
| breakout | 7% | 20R | -1.1550 | 1328 | 0.0% | 2/28 | -0.6547 | 3046 |
| breakout | 8% | 6R | -0.9637 | 2224 | 0.0% | 1/28 | -0.8543 | 5137 |
| breakout | 8% | 8R | -1.0998 | 1920 | 0.0% | 1/28 | -0.8452 | 4564 |
| breakout | 8% | 10R | -1.1510 | 1783 | 0.0% | 2/28 | -0.7990 | 4167 |
| breakout | 8% | 15R | -1.0974 | 1523 | 0.0% | 2/28 | -0.7527 | 3426 |
| breakout | 8% | 20R | -1.1685 | 1322 | 0.0% | 2/28 | -0.6471 | 3014 |
| breakout | 9% | 6R | -0.9637 | 2224 | 0.0% | 1/28 | -0.8558 | 5143 |
| breakout | 9% | 8R | -1.0998 | 1920 | 0.0% | 1/28 | -0.8456 | 4573 |
| breakout | 9% | 10R | -1.1510 | 1783 | 0.0% | 2/28 | -0.8015 | 4170 |
| breakout | 9% | 15R | -1.0975 | 1524 | 0.0% | 2/28 | -0.7537 | 3435 |
| breakout | 9% | 20R | -1.1685 | 1322 | 0.0% | 2/28 | -0.6481 | 3022 |
| breakout | 10% | 6R | -0.9638 | 2225 | 0.0% | 1/28 | -0.8556 | 5148 |
| breakout | 10% | 8R | -1.0998 | 1920 | 0.0% | 1/28 | -0.8453 | 4575 |
| breakout | 10% | 10R | -1.1510 | 1783 | 0.0% | 2/28 | -0.8011 | 4171 |
| breakout | 10% | 15R | -1.0975 | 1524 | 0.0% | 2/28 | -0.7531 | 3436 |
| breakout | 10% | 20R | -1.1685 | 1322 | 0.0% | 2/28 | -0.6474 | 3022 |
| anticipate | 6% | 6R | -0.9351 | 2722 | 0.0% | 0/27 | -0.6585 | 6151 |
| anticipate | 6% | 8R | -0.9972 | 2274 | 0.0% | 0/27 | -0.5973 | 4999 |
| anticipate | 6% | 10R | -1.0294 | 2005 | 0.0% | 0/27 | -0.5642 | 4283 |
| anticipate | 6% | 15R | -1.1453 | 1665 | 0.0% | 0/27 | -0.4455 | 3221 |
| anticipate | 6% | 20R | -1.2157 | 1358 | 0.0% | 0/27 | -0.3462 | 2581 |
| anticipate | 7% | 6R | -0.9218 | 2663 | 0.0% | 0/27 | -0.6424 | 5873 |
| anticipate | 7% | 8R | -0.9826 | 2227 | 0.0% | 0/27 | -0.5797 | 4769 |
| anticipate | 7% | 10R | -1.0147 | 1970 | 0.0% | 0/27 | -0.5402 | 4047 |
| anticipate | 7% | 15R | -1.1274 | 1624 | 0.0% | 0/27 | -0.4129 | 2972 |
| anticipate | 7% | 20R | -1.1958 | 1317 | 0.0% | 0/27 | -0.2866 | 2406 |
| anticipate | 8% | 6R | -0.9117 | 2599 | 0.0% | 0/27 | -0.6194 | 5481 |
| anticipate | 8% | 8R | -0.9696 | 2175 | 0.0% | 0/27 | -0.5588 | 4427 |
| anticipate | 8% | 10R | -1.0047 | 1921 | 0.0% | 0/27 | -0.5083 | 3674 |
| anticipate | 8% | 15R | -1.1165 | 1578 | 0.0% | 0/27 | -0.3634 | 2660 |
| anticipate | 8% | 20R | -1.1797 | 1285 | 0.0% | 0/27 | -0.2168 | 2178 |
| anticipate | 9% | 6R | -0.9066 | 2575 | 0.0% | 0/27 | -0.6034 | 5270 |
| anticipate | 9% | 8R | -0.9590 | 2153 | 0.0% | 0/27 | -0.5414 | 4200 |
| anticipate | 9% | 10R | -0.9926 | 1898 | 0.0% | 0/27 | -0.5094 | 3486 |
| anticipate | 9% | 15R | -1.1050 | 1558 | 0.0% | 0/27 | -0.3592 | 2583 |
| anticipate | 9% | 20R | -1.1678 | 1266 | 0.0% | 0/27 | -0.2464 | 2026 |
| anticipate | 10% | 6R | -0.9076 | 2501 | 0.0% | 0/27 | -0.6079 | 5105 |
| anticipate | 10% | 8R | -0.9581 | 2085 | 0.0% | 0/27 | -0.5503 | 4074 |
| anticipate | 10% | 10R | -0.9961 | 1833 | 0.0% | 0/27 | -0.5087 | 3350 |
| anticipate | 10% | 15R | -1.0960 | 1501 | 0.0% | 0/27 | -0.3701 | 2501 |
| anticipate | 10% | 20R | -1.1591 | 1222 | 0.0% | 0/27 | -0.2484 | 1961 |

**Gate (per cell, holdout only, no train-gate stage, this item's own pre-registered bar):
avgR/trade > -0.30 AND trades >= 150 AND positiveAssets/assets >= 0.40. 0/50 cells pass.**
Every cell clears the trade-count floor by a wide margin (1222-2883 holdout trades); every
cell fails decisively on both avgR (-0.91 to -1.22, nowhere near the -0.30 bar — win rate was
deliberately not used as a selection criterion per the task's own instruction, avgR/trade
already magnitude-weights the "few big winners" shape correctly) and positive-asset fraction
(breakout tops out at 2/28 = 7%; anticipate never exceeds 0/27). Best single cell:
`anticipate`, `maxStopPct=9%`, `tpR=6` — holdout avgR -0.9066, still nowhere close to passing.

**Notable pattern, not part of the gate but worth flagging honestly:** holdout avgR gets
monotonically WORSE as `tpR` rises within every stop width for BOTH families (e.g. anticipate
at `maxStopPct=6%`: -0.9351 at tpR=6 down to -1.2157 at tpR=20) — the opposite of what the
"let profits run" thesis predicts. TRAIN avgR shows a different shape: it improves (gets less
negative) as `tpR` rises for `anticipate` (-0.6585 at tpR=6 up to -0.3462 at tpR=20 at
`maxStopPct=6%`) — a train/holdout sign-of-trend divergence, the kind of thing that would
matter if any cell were close to the gate. None are, so this is recorded as a data point for
future studies to watch for (a `tpR`-driven train improvement that doesn't generalize), not
grounds for revisiting this verdict.

**Verdict: WIDE-STOP-HIGH-TARGET-ASYMMETRY FAIL.** No cell in the pre-registered 50-cell grid
clears the gate. The asymmetric "cut losses short, let profits run" shape does not rescue
either `breakout` or `anticipate` at any tested stop/target combination — wide stops with
distant targets mostly just mean a longer losing hold, confirmed directly (not inferred) via
the MAX_HOLD prerequisite check: giving trades genuinely unlimited time to reach their target
makes the measured result WORSE, not better, because the rare trades that do reach a distant
target are vastly outnumbered by trades that eventually revert all the way to a wide stop
instead. Recorded as VERDICTS.md's `WIDE-STOP-HIGH-TARGET-ASYMMETRY` row and as 50 decision
journal entries (`research-runs/2026-08-14T16-55-*-wide-stop-high-target-*.json`).

## SCALED-EXIT-LADDER-CONFIRMATORY RESULT (2026-08-14)

Human-directed research: `backtest.js`'s `partialAtR`/`partialFrac` (bank a fraction of the
position at an early R-multiple) combined with `trailR`/`trailStartR` (trail a stop below the
running peak once price has run far enough) implements a genuinely different exit STRUCTURE
from anything verdicted before — bank real profit early, then let the remainder run with a
trailing stop instead of a fixed target. Distinct from the single-fixed-TP baseline, from
WIDE-STOP-HIGH-TARGET-ASYMMETRY (a single all-or-nothing extreme target, no partial banking),
and from TRAIL-STOP-EXIT (`trailingTpPct`, a percentage-pullback exit with no partial banking,
already FAIL). Grep-confirmed: `partialAtR`/`partialFrac`/`trailR` appear only in
`commands.js`'s informal `!exits` Discord diagnostic — an exploration tool for a human to
eyeball three example configs, never run as a sealed confirmatory study with a pre-registered
gate, zero prior VERDICTS.md presence.

Pre-registered grid: `partialAtR` in {1, 2, 3} x `partialFrac` in {0.33, 0.5, 0.67} x `trailR`
in {1, 2} = 18 cells per family, 36 total, `trailStartR = partialAtR` (trailing starts exactly
when the partial banks). Stop definition (structural, current default) held fixed — isolates
the exit-STRUCTURE variable alone, per the task's own instruction to keep this separate from
ATR-ADAPTIVE-STOP-CONFIRMATORY's stop-definition change. Applied to `breakout` and
`anticipate` (same two families as the sibling ATR item, for comparability), full 28-asset
watchlist, standard 70/30 split, net-of-cost from the start (`backtest.js`'s own
`FEE_RATE=0.008`/`SLIPPAGE_PCT=0.0005` defaults, the corrected real basis per
FEE-SCHEDULE-REBASE). Implemented as `tournament.mjs`'s new `runScaledExitLadder`, gated
behind `--scaled-exit-ladder`. One small, tightly-scoped `backtest.js` addition beyond the
task's "zero new backtest.js code" expectation: two accumulators (`partialR`, `runnerR`)
inside `backtestMultiTF`'s existing `closeLeg` — tallying net R banked by the `partialAtR` leg
specifically vs. every other leg — were required to satisfy this item's own done_when
("realized-vs-unrealized split... so the mechanism's actual behavior is visible"), which no
existing return field could answer; the grid/gate wiring itself needed no other `backtest.js`
changes. 26/26 pre-existing `backtest.test.mjs` tests stayed green after the addition.

**Mid-run discovery #1, disclosed rather than absorbed silently: `breakout`'s `partialAtR=3`
cells are degenerate — identical to the plain fixed-TP baseline, regardless of `partialFrac`
or `trailR`.** `breakout`'s own family config (`families` in `tournament.mjs`) uses `tpR: 3`.
When `partialAtR` equals that same value, the partial-banking price and the fixed take-profit
price are identical, and `backtestMultiTF`'s exit checks run the fixed-TP check (`hi >=
pos.tp`) BEFORE the partial-banking check in the same candle — so the fixed TP closes the
FULL position first, and the partial leg (checked immediately after, but only `if (pos && ...)`)
never fires because `pos` is already null. Verified directly: all 6 `breakout`/`partialAtR=3`
cells report holdout avgR=-0.8640/3156 trades/0.00 `partialR`, an exact match to the freshly
re-run `breakout` fixed-TP baseline below — the partial+trail structure silently degrades to
"a bog-standard fixed-TP exit" at this one grid coordinate rather than testing what it was
built to test. The other 12 `breakout` cells (`partialAtR` in {1, 2}, genuinely below `tpR=3`)
are real tests of the mechanism.

**Mid-run discovery #2, disclosed rather than absorbed silently: `partialR + runnerR` does not
reconcile exactly to `totalR` for `anticipate`, by a consistent ~12-14%; for `breakout` it
reconciles to the penny.** Root cause, traced to `backtest.js`'s `anticipate`-entry branch: a
same-candle "the entry bar's low also touches the stop" fast path (`if (L[k] <= stop) {
trades.push(...); pos = null; }`, distinct from the shared `closeLeg` helper every other exit
routes through) books an immediate full-size stop-loss directly into `totalR` without ever
touching `partialR`/`runnerR` or the `exits` tally — these trades close on their own entry
candle, before the multi-bar loop where partial/trail logic lives, so they are structurally
never partial-eligible (always 100% loss, never a partial-bank candidate). `breakout`'s entry
path has no equivalent same-candle fast path, so its reconciliation is exact (gap <$0.50 on
totals in the thousands, pure floating-point noise). This does not change any `anticipate`
avgR/trades/gate number (`totalR`/`trades[]` were already correct and unaffected by this
item's additions) — it only means the partial-vs-runner split under-covers `anticipate`'s
same-bar instant stop-outs by construction, which is disclosed here as an interpretive caveat
on the split, not a defect in the reported gate results.

**Full grid — holdout avgR/trade, trade count, positive assets, train avgR, train trades,
partial-leg R / runner-leg R (holdout, net-of-cost, summed across the watchlist — see the
reconciliation caveat above for `anticipate`), per cell:**

| Family | partialAtR | partialFrac | trailR | Holdout avgR | Holdout n | Pos assets | Train avgR | Train n | Partial R | Runner R | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| breakout | 1 | 0.33 | 1 | -0.8845 | 3606 | 0/28 | -0.8743 | 8384 | 30.1 | -3219.6 | FAIL |
| breakout | 1 | 0.33 | 2 | -0.8851 | 3231 | 0/28 | -0.8787 | 7562 | 26.9 | -2886.7 | FAIL |
| breakout | 1 | 0.5 | 1 | -0.8914 | 3606 | 0/28 | -0.8796 | 8384 | 45.7 | -3259.7 | FAIL |
| breakout | 1 | 0.5 | 2 | -0.8905 | 3231 | 0/28 | -0.8833 | 7562 | 40.8 | -2917.7 | FAIL |
| breakout | 1 | 0.67 | 1 | -0.8982 | 3606 | 0/28 | -0.8850 | 8384 | 61.2 | -3299.8 | FAIL |
| breakout | 1 | 0.67 | 2 | -0.8958 | 3231 | 0/28 | -0.8880 | 7562 | 54.7 | -2948.7 | FAIL |
| breakout | 2 | 0.33 | 1 | -0.8588 | 3208 | 0/28 | -0.8629 | 7527 | 327.4 | -3082.4 | FAIL |
| breakout | 2 | 0.33 | 2 | -0.8632 | 3158 | 0/28 | -0.8687 | 7393 | 319.1 | -3045.2 | FAIL |
| breakout | 2 | 0.5 | 1 | -0.8573 | 3208 | 0/28 | -0.8595 | 7527 | 496.1 | -3246.2 | FAIL |
| breakout | 2 | 0.5 | 2 | -0.8614 | 3158 | 0/28 | -0.8647 | 7393 | 483.4 | -3203.8 | FAIL |
| breakout | 2 | 0.67 | 1 | -0.8558 | 3208 | 0/28 | -0.8561 | 7527 | 664.7 | -3410.1 | FAIL |
| breakout | 2 | 0.67 | 2 | -0.8596 | 3158 | 0/28 | -0.8607 | 7393 | 647.8 | -3362.5 | FAIL |
| breakout | 3 | 0.33 | 1 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| breakout | 3 | 0.33 | 2 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| breakout | 3 | 0.5 | 1 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| breakout | 3 | 0.5 | 2 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| breakout | 3 | 0.67 | 1 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| breakout | 3 | 0.67 | 2 | -0.8640 | 3156 | 0/28 | -0.8772 | 7386 | 0.0 | -2726.7 | FAIL (degenerate, see disclosure) |
| anticipate | 1 | 0.33 | 1 | -0.8547 | 4693 | 0/27 | -0.7237 | 11785 | 126.0 | -3583.0 | FAIL |
| anticipate | 1 | 0.33 | 2 | -0.8724 | 4203 | 0/27 | -0.7286 | 10386 | 113.0 | -3323.0 | FAIL |
| anticipate | 1 | 0.5 | 1 | -0.8585 | 4693 | 0/27 | -0.7345 | 11785 | 190.9 | -3665.8 | FAIL |
| anticipate | 1 | 0.5 | 2 | -0.8723 | 4203 | 0/27 | -0.7359 | 10386 | 171.2 | -3380.5 | FAIL |
| anticipate | 1 | 0.67 | 1 | -0.8623 | 4693 | 0/27 | -0.7453 | 11785 | 255.8 | -3748.6 | FAIL |
| anticipate | 1 | 0.67 | 2 | -0.8722 | 4203 | 0/27 | -0.7431 | 10386 | 229.4 | -3438.1 | FAIL |
| anticipate | 2 | 0.33 | 1 | -0.8701 | 4158 | 0/27 | -0.7223 | 10361 | 464.1 | -3624.3 | FAIL |
| anticipate | 2 | 0.33 | 2 | -0.8782 | 4013 | 0/27 | -0.7242 | 9899 | 445.4 | -3543.2 | FAIL |
| anticipate | 2 | 0.5 | 1 | -0.8718 | 4158 | 0/27 | -0.7261 | 10361 | 703.2 | -3870.5 | FAIL |
| anticipate | 2 | 0.5 | 2 | -0.8784 | 4013 | 0/27 | -0.7255 | 9899 | 674.8 | -3773.4 | FAIL |
| anticipate | 2 | 0.67 | 1 | -0.8735 | 4158 | 0/27 | -0.7299 | 10361 | 942.3 | -4116.7 | FAIL |
| anticipate | 2 | 0.67 | 2 | -0.8786 | 4013 | 0/27 | -0.7268 | 9899 | 904.3 | -4003.7 | FAIL |
| anticipate | 3 | 0.33 | 1 | -0.8672 | 4067 | 0/27 | -0.7148 | 10079 | 391.7 | -3482.6 | FAIL |
| anticipate | 3 | 0.33 | 2 | -0.8729 | 4009 | 0/27 | -0.7178 | 9874 | 384.5 | -3457.5 | FAIL |
| anticipate | 3 | 0.5 | 1 | -0.8657 | 4067 | 0/27 | -0.7129 | 10079 | 593.6 | -3678.4 | FAIL |
| anticipate | 3 | 0.5 | 2 | -0.8703 | 4009 | 0/27 | -0.7145 | 9874 | 582.6 | -3645.2 | FAIL |
| anticipate | 3 | 0.67 | 1 | -0.8643 | 4067 | 0/27 | -0.7111 | 10079 | 795.4 | -3874.2 | FAIL |
| anticipate | 3 | 0.67 | 2 | -0.8677 | 4009 | 0/27 | -0.7112 | 9874 | 780.6 | -3832.9 | FAIL |

**Gate (per cell, holdout only, no train-gate stage): avgR/trade > 0 AND trades >= 150 AND
positiveAssets/assets >= 0.50 — the same bar ATR-ADAPTIVE-STOP-CONFIRMATORY used. 0/36 cells
pass; 0/28 holdout assets are ever net-positive at any grid cell for either family.**

**Fixed-TP baseline comparison (both re-run fresh, same split/watchlist/cost basis, for an
apples-to-apples reading rather than citing this document's stale ~0.9%-cost "Honest Baseline
First" table).** `breakout` fixed-TP baseline: holdout avgR=-0.8640, 3156 trades, 0/28
positive — an exact match to every `partialAtR=3` cell above, consistent with discovery #1.
Best genuinely-tested `breakout` cell (`partialAtR=2, partialFrac=0.67, trailR=1`): holdout
avgR=-0.8558, 3208 trades — a marginal +0.0082R improvement over baseline, not a meaningful
one. `anticipate` fixed-TP baseline: holdout avgR=-0.8842, 3966 trades, 0/27 positive. Best
`anticipate` cell (`partialAtR=1, partialFrac=0.33, trailR=1`, also the best cell across the
entire 36-cell grid): holdout avgR=-0.8547, 4693 trades — a +0.0295R improvement over
baseline, still nowhere near the gate's `avgR>0` requirement. Every cell in the grid, for both
families, stays within a narrow band (-0.855 to -0.898) around its own family's fixed-TP
baseline — banking a partial early and trailing the remainder shifts the result by hundredths
of an R, not the order of magnitude that would be needed to flip the sign.

**Verdict: SCALED-EXIT-LADDER-CONFIRMATORY FAIL.** No cell in the pre-registered 36-cell grid
clears the gate. Banking a partial at 1-3R and trailing the remainder produces at most a small
(+0.01 to +0.03R), not decision-relevant, improvement over each family's already-failing
fixed-TP baseline — the exit STRUCTURE genuinely varies across the grid (confirmed by the
partial-leg-R column moving with `partialAtR`/`partialFrac` as expected, except at the
disclosed `breakout`/`partialAtR=3` degeneracy), but the underlying entries are still not
predictive enough for any exit shape built on top of them to turn net-of-cost negative into
positive. Consistent with every other exit-mechanism item tested on these two entry families
(WIDE-STOP-HIGH-TARGET-ASYMMETRY, TRAIL-STOP-EXIT, T5-DECAY-EXIT) — this project's entries,
not its exits, remain the open problem. Recorded as VERDICTS.md's `SCALED-EXIT-LADDER-CONFIRMATORY`
row and as 36 decision journal entries
(`research-runs/2026-08-14T*-scaled-exit-ladder-*.json`).

---

## 2026-08-15 — T4-PORTFOLIO-MOMENTUM-PHASE4: closing the explicitly-flagged PHASE4 gap

Closes the gap ROADMAP.md's PHASE2-MAX-SURVIVABLE-COST finding (2026-08-13) explicitly left
open: "T4-PORTFOLIO-MOMENTUM does not formally proceed under a strict reading of this item's
own gate... whether that's worth a dedicated PHASE3/PHASE4 re-run despite not clearing 0.5
Sharpe at any scenario tested is a judgment call for whoever restocks the queue next." Every
other PHASE2 survivor (B5-REVERSAL) already went through a full PHASE4 shared-capital
equity-curve simulation (see VERDICTS.md's `B5-REVERSAL-PHASE4-PORTFOLIO-SIM` row, FAIL);
this runs the same methodology on T4's own flagged near-miss variant so the cost-reduction
plan's four candidates all reach the same depth of testing rather than leaving one half-done.

`scripts/phase4-t4-momentum-portfolio-sim.mjs` (left in the repo, read-only, deletable after
this finding is read) reuses `portfolio.mjs`'s real `simulatePortfolio` engine directly, same
as B5-REVERSAL's own `scripts/phase4-b5-portfolio-sim.mjs`.

**Scope, disclosed rather than silently narrowed:** PHASE2's own triage
(`scripts/phase2-triage.mjs`) only ever tested `momentum_30d` at 30d rebalance — the one
variant with real reported numbers ("closest of the four", holdout Sharpe 0.493 at its
flagged best-case scenario). That is the sole candidate carried into this PHASE4 run,
matching B5-REVERSAL's own precedent of only carrying forward its actual PHASE2/PHASE3
survivor rather than reopening the full strategy menu. `momentum_vol` was never triaged in
PHASE2 and stays out of scope here for the same reason. Split methodology is T4's own
standing convention (`portfolio.mjs`'s standard chronological 70/30 time split on the full
28-asset watchlist, not B5-REVERSAL's symbol-holdout universe) — unchanged from
`runPortfolioStudy`/T4-COVERAGE-FIX/PHASE2.

**Cost-scenario decision, disclosed:** PHASE2 flagged "futures maker (fee-only)" as T4's best
case. But B5-REVERSAL's own PHASE3 (ROADMAP.md, 2026-08-13) explicitly rejected a maker
assumption for this exact strategy shape — "a resting maker order risking a missed fill is
not realistic for a signal whose edge depends on entering at the scheduled rebalance" — and
used futures TAKER instead, despite it scoring worse. T4-PORTFOLIO-MOMENTUM is the same shape
(systematic, scheduled 30d rebalance), so the same execution-realism argument applies. Both
scenarios are reported in full below; futures TAKER (0.10% round trip) is the primary
gate-evaluation scenario, futures MAKER fee-only (0.04%) is a secondary, disclosed-optimistic
reference matching PHASE2's original flag. Sanity check (mirroring PWR5/PHASE2's own
discipline): a local N=5 replica of `momentum_30d`, run through the exact same
`simulatePortfolio` call, was checked bit-for-bit against the real `portfolioStrategies.momentum_30d`
before its N=4/N=6 perturbation siblings were trusted — first attempt drifted (1.23e-1,
because `portfolio.mjs`'s `normalizeWeights` sorts *before* filtering non-finite scores, so a
null-score symbol can occupy a top-N slot before being dropped — a real, pre-existing quirk in
production code, reproduced deliberately rather than "corrected" away); the fixed replica
matches exactly (drift 0.00e+0), and reproduces PHASE2's reported maker-scenario Sharpe 0.493
precisely at N=5, confirming fidelity to the original flagged finding.

**Holdout window:** 2025-07-03 to 2026-07-30 (392 days, the same 70/30 split point every T4
variant has used), 28-asset full watchlist.

| Scenario | N | Total return | Annual return | Sharpe | Sortino | Calmar | Max DD | Profit factor |
|---|---|---|---|---|---|---|---|---|
| futures taker (0.10%) | 4 (pert.) | +2.5% | +2.3% | 0.039 | 0.037 | 0.059 | -39.5% | 1.056 |
| futures taker (0.10%) | **5 (primary)** | **+30.8%** | +28.4% | **0.483** | 0.462 | 0.858 | **-33.1%** | 1.121 |
| futures taker (0.10%) | 6 (pert.) | +14.5% | +13.5% | 0.233 | 0.216 | 0.383 | -35.1% | 1.084 |
| futures maker fee-only (0.04%) | 4 (pert.) | +3.0% | +2.8% | 0.048 | 0.045 | 0.072 | -39.4% | 1.056 |
| futures maker fee-only (0.04%) | **5 (primary)** | **+31.4%** | +29.0% | **0.493** | 0.471 | 0.877 | **-33.1%** | 1.121 |
| futures maker fee-only (0.04%) | 6 (pert.) | +15.1% | +14.0% | 0.242 | 0.224 | 0.399 | -35.0% | 1.084 |

**Gate outcome (primary scenario, futures taker, N=5): 3 of 4 clauses pass, 1 fails.**
Total return positive (+30.8%, PASS). Max drawdown clears the -35% floor (-33.1%, PASS).
No sign flip across N=4/5/6 (all three stay Sharpe-positive, literal-wording PASS). Sharpe
0.483 falls short of the >=0.5 gate (FAIL) — narrowly, and closer than either the maker
scenario (0.493, also short) or PHASE2's own flagged best case. All four clauses are required
(per this item's own `done_when`); one failing clause fails the whole variant.

**Disclosed beyond the literal gate wording: the "no sign flip" pass is fragile, not
robust.** N=4 collapses Sharpe from 0.483 to 0.039 (a 92% reduction on a one-position change);
N=6 collapses it to 0.233 (a 52% reduction). Neither flips sign, so the literal
"+/-20% parameter perturbation, no sign flip" clause is satisfied — but a strategy whose
risk-adjusted return swings by an order of magnitude on a +/-1 position-count change is
exhibiting the same overfitting shape the sign-flip check exists to catch, just without
crossing zero. This is reported as a due-diligence finding beyond what the gate literally
requires, the same standard PORTFOLIO-LIVE-SIGNAL-SIM and B5-REVERSAL-PHASE4-PORTFOLIO-SIM
applied to their own results.

**Verdict: T4-PORTFOLIO-MOMENTUM-PHASE4 FAIL** — on the Sharpe clause specifically, at both
tested cost scenarios, consistent with PHASE2's own finding that this signal "never clears
0.5 Sharpe at any tested scenario." Genuinely closer to passing than B5-REVERSAL-PHASE4 (which
failed on Sharpe, drawdown, AND a literal sign flip) or PORTFOLIO-LIVE-SIGNAL-SIM (failed all
three clauses on both variants) — but still fails the required all-clauses gate, and the
N-perturbation fragility is an independent red flag on top of the narrow Sharpe miss. This
closes the explicitly-flagged PHASE4 gap: all four PWR5-era cost-reduction candidates
(Classifier P5, CLASSIFIER-FUNDING-FEATURE, B5-REVERSAL, T4-PORTFOLIO-MOMENTUM) have now been
tested to the same depth, and none clears a full shared-capital PHASE4 simulation. Recorded as
VERDICTS.md's `T4-PORTFOLIO-MOMENTUM-PHASE4` row.

---

## 2026-08-15 — OPEN-INTEREST-TREND-CONFIRMATION: futures OI trend as an entry gate

Genuinely untested information source, picked from the work_queue's derivatives-infra batch:
`derivatives.mjs` already implements a real, tested (3 tests) Kraken Futures analytics
collector covering 15 endpoint types, including `open-interest` — built during PWR5-era work
but never wired into an actual sealed-holdout study, only ever exercised via `research.js`'s
`derivatives` CLI diagnostic (prints point counts, nothing more). Hypothesis: rising OI
alongside a `breakout`/`anticipate` entry signal indicates fresh leveraged conviction (real
trend confirmation, keep the trade); falling OI on the same signal indicates
short-covering/weak-hands (a move likely to fade, skip it). Distinct from every prior
gate/filter tested here (T3-REGIMEFILTER, TREND-GATE-MA/STRUCTURE — price structure;
VOL-CONFIRM-BREAKOUT — spot volume; ATR-ADAPTIVE-STOP — volatility; H11/FUNDING-MEANREV —
funding rate): this is the first study in this project to use futures positioning depth as an
information source.

**Data-availability gate, run first, against the real API — not assumed.** The task's own
pre-registered `done_when` named the precedent to follow if coverage came up short: H11's
funding-data non-verdict (28/29 assets blocked by a geo-blocked API / a hard ~365-day rolling
window). Before writing any backtest code, `fetchAnalytics({type:'open-interest'})` was called
directly against every watchlist symbol's Kraken Futures product (`PF_<SYM>USD`, requesting a
900-day window). Result: **no H11-style ceiling exists for this data source.** Every symbol
returned real, non-empty daily OI history reaching back to 2024-02-28 (694-899 days, depending
on the futures product's own listing date) — materially deeper than the ~365-730-day rolling
windows that gated H11 and FUNDING-MEANREV. 28/29 watchlist assets clear a 500-day coverage
floor; the one exclusion (EOS) is the same pre-existing local-candle-history shortfall that has
excluded it from other studies (e.g. FUNDING-CARRY-DECAY-CHECK), not an OI-availability
problem. The gate cleared decisively, so the study proceeded to the actual sealed-holdout
backtest rather than stopping at a non-verdict.

**Gate mechanism (`oi-trend-gate.mjs`, new module).** Kraken's open-interest analytics value is
a daily `[open, high, low, close]` array; the day's `close` is used as that day's OI level.
Each daily point only becomes visible once its own day has fully closed (+1 day) — this
codebase's standard no-lookahead offset (`tournament.mjs`'s `buildBtcAboveMa200At` uses the
same +1 day on its own daily timeline). The gate compares the latest revealed OI close against
the average of the **N=7** closes immediately before it (current point excluded from its own
trailing average, avoiding a trivial self-inclusion bias) — a single pre-registered choice
disclosed up front, not a threshold grid, since the task specifies one mechanism (OI vs its own
trailing average) rather than a parameter sweep. Applied via `backtest.js`'s existing
`entryGate` hook — no `backtest.js` changes — to `breakout` and `anticipate`'s exact
`tournament.mjs` baseline configs, unmodified, full 28-asset (of 29) watchlist, corrected real
cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip — already
`strategy.js`'s default, not overridden). Sealed 70/30 chronological split within each asset's
OI-covered window (same `windowedSplit` technique FUNDING-MEANREV uses, needed because the
OI-covered window can differ slightly from the full candle history's span).

**Gate scope, disclosed:** this item's own pre-registered `done_when` specifies exactly three
holdout-only clauses (avgR/trade > -0.30, trades >= 150, positiveAssets/assets >= 0.40) and
nothing else — no separate train-side pre-gate the way FUNDING-MEANREV/FIB-PULLBACK/
VOL-CONFIRM-BREAKOUT require (train must clear its own bar before holdout is even examined).
Train scores were still computed and are reported below for the same-sign disclosure every
other item in this file includes, but they are not gating.

| Family | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|
| breakout | train | 3034 | -0.763 | 0/28 |
| breakout | **holdout** | **1252** | **-0.975** | **1/28** |
| anticipate | train | 3985 | -0.801 | 0/28 |
| anticipate | **holdout** | **1462** | **-0.895** | **0/27** |

**Verdict: OPEN-INTEREST-TREND-CONFIRMATION FAIL (both families), decisive, not a
sample-size non-verdict.** Both families clear the trade-count floor comfortably
(1252/1462 holdout trades, well above the >=150 gate), so this is not a case of the gate
excluding too much to judge — the OI-trend filter simply does not produce a viable entry
population. Holdout avgR is far past the -0.30 floor for both (-0.975 breakout, -0.895
anticipate), train agrees in sign and magnitude for both (-0.763, -0.801) — no train/holdout
divergence to explain away — and the positive-asset fraction (1/28 breakout, 0/27 anticipate)
is nowhere near the required 40%. Rising OI alongside a breakout/anticipate trigger does not
appear to carry the "fresh leveraged conviction" signal the hypothesis predicted, at least not
at the daily/7-day-trailing granularity tested here. Recorded as VERDICTS.md's
`OPEN-INTEREST-TREND-CONFIRMATION` row and as a decision-journal entry
(`research-runs/2026-08-15T*-oi-trend-gate.json`).

## 2026-08-15 — LIQUIDATION-CASCADE-REVERSAL: forced-liquidation spike as a reversal-entry gate

Genuinely untested information source and mechanism, picked from the same derivatives-infra
work_queue batch as OPEN-INTEREST-TREND-CONFIRMATION above: `derivatives.mjs`'s
`fetchAnalytics({type:'liquidation-volume'})` is real, tested Kraken Futures infra (same
endpoint family as `open-interest`) built during PWR5-era work but never wired into a sealed
holdout study, only ever exercised via `research.js`'s `derivatives` CLI diagnostic (point
counts only). Hypothesis: a spike in liquidation volume represents FORCED selling/buying
(leveraged positions closed involuntarily), not voluntary price action — a real, distinct
market-microstructure event. Entering contrarian to price direction immediately after such a
spike (the forced flow exhausting itself) was hypothesized to have positive expected value.
Distinct from every prior study: not a re-skin of B5-REVERSAL (cross-sectional return ranking
across assets, not event-triggered), and mechanically different from
OPEN-INTEREST-TREND-CONFIRMATION directly above — that item gates a *trend* signal (rising/
falling OI) onto *trend-following* families (breakout/anticipate); this item gates a single-bar
*spike* signal onto the codebase's own existing *reversal* family (`sweep_reclaim`).

**Design choice: which family expresses "contrarian to price direction."** `backtest.js` has no
generic custom-entry-function hook, only a fixed set of `entryMode`s plus the `entryGate` veto
hook every prior new-data-source study in this project already uses (OI-trend-gate on
breakout/anticipate, FUNDING-MEANREV on breakout). `sweep_reclaim` (price sweeps a prior 12-bar
low, then closes back above it — a literal "forced-flow-down, then reclaim" shape) is the
closest existing mechanism to "contrarian reversal after a violent move," and its own plain
baseline already FAILED independently on this project's real cost basis — so this item asks
whether confirmed genuine forced-liquidation origin rescues an already-failed price pattern,
the same shape as the OI-trend-gate/FUNDING-MEANREV precedent.

**Data-availability check, run first, against the real API.** `fetchAnalytics` for
`liquidation-volume` (same underlying Kraken analytics endpoint family as `open-interest`) was
called directly for PF_XBTUSD over a 900-day window before writing any backtest code: 899 days
of daily history (2024-02-28 to present), matching OI's own depth exactly — no separate
rolling-window ceiling for this data source either. The series is heavily right-skewed
(p50 ~8.5, p75 ~28.8, p90 ~76.1, p95 ~135.3, p99 ~313.0, max ~685.6 over that window),
consistent with genuine spike events rather than a smooth series — the shape a "forced
liquidation" mechanism predicts. 28/29 watchlist assets clear the same 500-day coverage floor
used by OI-trend-gate (EOS excluded on the same pre-existing candle-history shortfall, not a
liquidation-data problem).

**Spike mechanism and threshold selection (`liquidation-cascade-reversal.mjs`, new module).**
Kraken's liquidation-volume analytics value is a single daily scalar. Each daily point only
becomes visible once its own day has closed (+1 day) — the same no-lookahead offset
`oi-trend-gate.mjs` uses. The gate fires when the latest revealed day's volume exceeds a
multiplier times the average of the N=7 days immediately before it (current point excluded from
its own trailing average, matching OI-trend-gate's N=7 window and self-exclusion). The task's
own text specified the mechanism ("liquidation volume > Nx its trailing average") without
fixing N, so three candidate multipliers — 2x, 3x, 5x — were scored on the TRAIN split only;
the single best-on-train multiplier (highest train avgR/trade among those producing at least
one train trade) is the only one whose holdout is ever computed, evaluated exactly once — the
same selection discipline TEST2-VOL-CONFIRMED-BREAKOUT already used ("fix the best threshold ON
THE TRAIN SPLIT ONLY, then evaluate holdout exactly once"). Applied via `backtest.js`'s existing
`entryGate` hook — no `backtest.js` changes — to `sweep_reclaim`'s exact `tournament.mjs`
baseline config, unmodified, full 28-asset (of 29) watchlist, corrected real cost basis
(FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). Sealed 70/30 chronological
split within each asset's liquidation-data-covered window (same `windowedSplit` technique
OI-trend-gate/FUNDING-MEANREV use).

**Gate scope, disclosed:** this item's own pre-registered `done_when` specifies exactly two
holdout clauses (avgR/trade > -0.30, trades >= 100) — a deliberately lower trade floor than the
usual >=150, stated up front because this intersects two already-selective conditions (a
liquidation spike AND a sweep_reclaim trigger on the same bar) and was expected to produce
materially fewer trades than a single-condition family. No positiveAssets clause is part of
this item's gate (unlike OI-trend-gate's three-clause gate); positive-asset fraction is still
reported below for the same-sign disclosure every other item in this file includes.

| Multiplier | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|
| 2x | train | 1200 | -1.032 | 0/28 |
| 3x | train | 911 | -1.006 | 0/28 |
| 5x | train | 629 | -0.982 | 0/28 |
| **5x (selected)** | **holdout** | **221** | **-0.895** | **4/27** |

**Threshold selection was "least bad," not a genuine signal.** All three candidates were
decisively negative on train with 0/28 positive assets each; train avgR/trade improved
monotonically with a tighter (higher) multiplier (-1.032 -> -1.006 -> -0.982 for 2x -> 3x -> 5x),
so 5x was selected as best-on-train not because it looked promising but because it was least
unprofitable among three uniformly failing candidates — the same "selectivity direction
consistent, but everything still failing" pattern VOL-CONFIRM-BREAKOUT's train-gate found for
`breakout` under relative-volume filtering.

**Verdict: LIQUIDATION-CASCADE-REVERSAL FAIL, decisive, not a sample-size non-verdict.** The
selected 5x-multiplier holdout clears the >=100 trade floor comfortably (221 trades — roughly
5.6x the floor, not a marginal pass), so this is not a case of the gate excluding too much to
judge. Holdout avgR/trade (-0.895) is far past the -0.30 floor and matches train's sign and
rough magnitude (-0.982 train vs -0.895 holdout at the same multiplier) — no train/holdout
divergence to explain away. Positive-asset fraction (4/27, ~15%) is reported for disclosure only
(not part of this item's gate) and would not have cleared the 40% bar OI-trend-gate's own gate
used, for context. Confirmed genuine forced-liquidation origin does not rescue the already-failed
`sweep_reclaim` pattern — if anything, gating on the spike concentrates entries into a
still-decisively-losing subset (holdout avgR actually slightly *better* in magnitude than
`sweep_reclaim`'s own already-recorded unfiltered result of -0.711, but nowhere near the -0.30
gate either way). Recorded as VERDICTS.md's `LIQUIDATION-CASCADE-REVERSAL` row and as a
decision-journal entry (`research-runs/2026-08-15T06-06-27-127Z-liquidation-cascade-reversal.json`).

## 2026-08-15 — FUTURES-BASIS-DIRECTIONAL-SIGNAL: futures basis level as a directional momentum gate

Distinct from the already-closed FUNDING-CARRY-DECAY-CHECK (KILLED/decayed), which tested a
delta-neutral carry-HARVESTING strategy off the periodic perpetual funding payment. This item
tests a mechanically different metric: the futures BASIS LEVEL itself — the price differential
between the futures contract and spot, i.e. contango/backwardation steepness reflecting the
whole term-structure pricing, not a specific periodic payment mechanism — as a DIRECTIONAL
signal, not a market-neutral carry position. Also distinct from OPEN-INTEREST-TREND-CONFIRMATION
even though both gate the same `breakout`/`anticipate` families with the same "current > trailing
average" shape: the information source is basis (futures-vs-spot price), not OI (open contract
volume).

**Pre-registered primary hypothesis, stated before any train/holdout result was examined.** Two
competing hypotheses exist for what a steep/widening contango means: (a) bullish leveraged-long
buildup — a momentum/confirmation signal; or (b) a crowded-long extreme — a contrarian fade
signal. This item pre-registers (a) as primary: basis widening (current day's basis above its own
trailing average) is hypothesized to confirm fresh bullish leveraged conviction, applied as a gate
on `breakout`/`anticipate` — the same two directional/momentum families, and the exact same
"current > trailing average" gate shape, that OPEN-INTEREST-TREND-CONFIRMATION already used for
its own OI-trend confirmation hypothesis. This choice mirrors the closest existing mechanical
precedent in the codebase rather than being picked to fit a result later. Hypothesis (b)
(contrarian fade on a reversal family, e.g. `sweep_reclaim`, the same shape
LIQUIDATION-CASCADE-REVERSAL used for its own forced-flow hypothesis) is a distinct,
separately-registerable study and is explicitly NOT tested here — this item's result is not to be
retroactively reinterpreted as evidence for or against (b).

**Data-availability check, run first, against the real API.** `fetchAnalytics` for
`future-basis` (same underlying Kraken analytics endpoint family as `open-interest` and
`liquidation-volume`) was called directly for PF_XBTUSD and PF_ETHUSD over a 900-day window
before writing any backtest code: 899 days of daily history for both (2024-02-28 to present),
matching OI's and liquidation-volume's own depth exactly — no separate rolling-window ceiling for
this data source either. Kraken's future-basis analytics value has a distinct shape from both
prior sources: an object `{ basis: "<decimal string>" }` (not OI's `[open,high,low,close]` array
or liquidation-volume's plain scalar) — parsed as `Number(value.basis)`. Observed distribution is
centered slightly above zero (contango-biased: median ~0.0001, mean ~0.00015-0.00018 on
PF_XBTUSD/PF_ETHUSD) with occasional backwardation (min as low as -0.0022 on PF_ETHUSD),
consistent with a real, non-degenerate series. 28/29 watchlist assets clear the same 500-day
coverage floor used by OI-trend-gate and liquidation-cascade (EOS excluded on the same
pre-existing candle-history shortfall, not a basis-data problem).

**Mechanism (`basis-directional-signal.mjs`, new module).** Each daily point only becomes visible
once its own day has closed (+1 day) — the same no-lookahead offset `oi-trend-gate.mjs` and
`liquidation-cascade-reversal.mjs` use. The gate fires when the latest revealed day's basis
exceeds the average of the N=7 days immediately before it (current point excluded from its own
trailing average, matching OI-trend-gate's N=7 window and self-exclusion convention — "one clean
choice," not a parameter sweep, since the task specifies one mechanism). Applied via
`backtest.js`'s existing `entryGate` hook — no `backtest.js` changes — to `breakout`'s and
`anticipate`'s exact `tournament.mjs` baseline configs, unmodified, full 28-asset (of 29)
watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round
trip). Sealed 70/30 chronological split within each asset's basis-data-covered window (same
`windowedSplit` technique OI-trend-gate/liquidation-cascade-reversal use).

**Gate (this item's own pre-registered `done_when`, identical three-clause shape to
OPEN-INTEREST-TREND-CONFIRMATION):** holdout avgR/trade > -0.30 AND holdout trades >= 150 AND
holdout positiveAssets/assets >= 0.40, evaluated per family.

| Family | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|
| breakout | train | 3059 | -0.777 | 0/28 |
| breakout | holdout | 1229 | -0.994 | 0/27 |
| anticipate | train | 3989 | -0.793 | 1/28 |
| anticipate | holdout | 1491 | -0.938 | 0/27 |

**Verdict: FUTURES-BASIS-DIRECTIONAL-SIGNAL FAIL, decisive, both families.** Both holdout trade
counts clear the >=150 floor comfortably (1229 and 1491 trades — 8.2x and 9.9x the floor), so
this is not a case of the gate excluding too much to judge. Holdout avgR/trade is far past the
-0.30 floor for both families (breakout -0.994, anticipate -0.938) and matches train's sign and
rough magnitude in both cases (train -0.777/-0.793 vs holdout -0.994/-0.938) — no train/holdout
divergence to explain away. Positive-asset fraction is 0/27 for both families holdout, nowhere
near the 0.40 floor. The pre-registered primary hypothesis (widening contango as bullish momentum
confirmation) is not supported: gating breakout/anticipate on basis widening does not rescue
either family, and the magnitude is comparable to OPEN-INTEREST-TREND-CONFIRMATION's own FAIL on
the same two families with the same gate shape, suggesting the failure mode here is more likely
about `breakout`/`anticipate`'s own baseline weakness on this cost basis than about basis
specifically carrying no information. Recorded as VERDICTS.md's `FUTURES-BASIS-DIRECTIONAL-SIGNAL`
row and as a decision-journal entry
(`research-runs/2026-08-15T07-04-21-258Z-basis-directional-signal.json`).

## 2026-08-15 — LONG-SHORT-RATIO-CONTRARIAN: crowd long/short positioning as a contrarian-fade gate

Genuinely new information source, distinct in KIND from every prior derivatives study, not just a
different endpoint on the same theme: OPEN-INTEREST-TREND-CONFIRMATION and
FUTURES-BASIS-DIRECTIONAL-SIGNAL both measure the SIZE/PRICING of the futures market (open
contract count, futures-vs-spot price); LIQUIDATION-CASCADE-REVERSAL measures forced-flow events
(involuntary liquidations). This item measures the crowd's own DIRECTIONAL LEAN — the fraction of
open futures positions that are long — a sentiment/positioning signal, structurally different from
either "how big is the market" or "how forced was this flow."

**Pre-registered hypothesis — the task's own stated framing, and notably the first CONTRARIAN
(not momentum/confirmation) gate shape tested in this project's derivatives-gate series.** Every
prior gate study here (OI-trend, basis-directional) pre-registered a "current > trailing average"
CONFIRMATION shape: rising OI, widening basis. This item is different in mechanism as well as
information source: the classic sentiment-extreme contrarian-fade hypothesis says that once the
crowd is already heavily positioned long — an EXTREME reading of the ratio, not "long" in
general — most of the buying that was going to happen already has, so forward returns on a
freshly-opened long entry tend to be worse. Applied as a SUPPRESSION gate on `breakout`/
`anticipate` — the same two directional/momentum families every prior gate study here used, kept
for direct comparability — that blocks new entries only while the ratio sits in its own
train-fixed extreme-long zone, and allows them otherwise.

**Granularity check, run first, against the real API — this item's own explicit done_when
requirement.** The task's framing raised aggregate/market-wide-only as a real possibility, since
positioning data is not always per-symbol. It is not aggregate-only here: `fetchAnalytics` takes a
`symbol` parameter, and Kraken returned a genuinely distinct daily value per futures contract when
queried directly — PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD each independently 0.60/0.77/0.81/0.76
on the same most-recent day, not a shared market-wide constant. This study is therefore scoped
PER-ASSET, matching every other gate study's own-history convention (OI/basis compare a value to
ITS OWN trailing average; this compares a value to ITS OWN train-window percentile) instead of the
aggregate-only fallback the task described as a possibility.

**Data-availability check, against the real API.** `fetchAnalytics` for `long-short-ratio` (same
underlying Kraken analytics endpoint family as `open-interest`/`liquidation-volume`/
`future-basis`) was called directly for all four spot-checked symbols before writing any backtest
code: 899 days of daily history for each (2024-02-28 to present), matching every other derivatives
source's depth and start date exactly — no separate rolling-window ceiling for this data source
either. Kraken's `long-short-ratio` value is a plain decimal string (e.g. `"0.71"`) — already the
long-side FRACTION of open positions, cross-checked against the sibling `long-short-info` type's
`{longCount,shortCount,longPercent,shortPercent,ratio}` shape on the same symbol/day (`ratio`
there equals `longPercent/100` exactly) — a distinct shape from OI's `[open,high,low,close]`
array, liquidation-volume's plain scalar count, and basis's `{basis}` object. 28/29 watchlist
assets clear the same 500-day coverage floor used by every other derivatives study (EOS excluded
on the same pre-existing candle-history shortfall, not a ratio-data problem).

**Mechanism (`long-short-ratio-contrarian.mjs`, new module).** Each daily point only becomes
visible once its own day has closed (+1 day) — the same no-lookahead offset every other
derivatives-gate module here uses. Rather than a trailing average, this gate is a fixed
threshold: the 80th percentile of the asset's OWN long-short ratio values within the TRAIN window
only (never recomputed on holdout, so the threshold itself carries zero holdout information) — a
single pre-registered choice ("top quintile of the asset's own observed history is 'heavily
skewed long'"), not a threshold grid, matching OI-trend-gate's/basis-directional-signal's own
"one clean choice" convention for their own N=7 window. The gate blocks an entry only while the
latest revealed ratio exceeds that fixed train threshold, and allows entry otherwise, applied via
`backtest.js`'s existing `entryGate` hook — no `backtest.js` changes — to `breakout`'s and
`anticipate`'s exact `tournament.mjs` baseline configs, unmodified, full 28-asset (of 29)
watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round
trip). Sealed 70/30 chronological split within each asset's ratio-data-covered window (same
windowing technique OI-trend-gate/basis-directional-signal use), with the SAME split-boundary
timestamp also used to bound the train-only ratio values that fix the threshold — one shared cut,
no separate leakage surface between "which candles are train" and "which ratio values set the
threshold."

**Gate (this item's own pre-registered `done_when`, standard three-clause shape — no separate
aggregate/portfolio-level fallback gate was needed once the granularity check above confirmed
real per-asset resolution):** holdout avgR/trade > -0.30 AND holdout trades >= 150 AND holdout
positiveAssets/assets >= 0.40, evaluated per family.

| Family | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|
| breakout | train | 4627 | -0.776 | 0/28 |
| breakout | holdout | 1973 | -0.970 | 0/28 |
| anticipate | train | 6480 | -0.777 | 0/28 |
| anticipate | holdout | 2512 | -0.934 | 0/27 |

**Verdict: LONG-SHORT-RATIO-CONTRARIAN FAIL, decisive, both families.** Both holdout trade counts
clear the >=150 floor comfortably (1973 and 2512 trades — 13.2x and 16.7x the floor), so this is
not a case of the gate excluding too much to judge; the suppression is real (holdout trade counts
are lower than each family's own unfiltered baseline elsewhere in VERDICTS.md, e.g.
FUTURES-BASIS-DIRECTIONAL-SIGNAL's unfiltered-by-this-gate breakout holdout of 1229 vs this
gate's differently-windowed 1973 — not directly comparable trade-for-trade since coverage windows
differ per study, but the gate visibly did filter, not pass everything through). Holdout
avgR/trade is far past the -0.30 floor for both families (breakout -0.970, anticipate -0.934) and
matches train's sign and rough magnitude in both cases (train -0.776/-0.777 vs holdout
-0.970/-0.934) — no train/holdout divergence to explain away. Positive-asset fraction is 0/28 and
0/27 holdout, nowhere near the 0.40 floor. The pre-registered contrarian-fade hypothesis
(suppressing entries during crowd long-extremes improves forward returns) is not supported:
removing the ratio's own top-quintile-long periods does not rescue `breakout`/`anticipate`, and
the magnitude is comparable to every other derivatives-gate FAIL on these same two families
(OPEN-INTEREST-TREND-CONFIRMATION, FUTURES-BASIS-DIRECTIONAL-SIGNAL) regardless of whether the
gate shape was confirmation or contrarian-fade — continued evidence that the failure mode here is
about `breakout`/`anticipate`'s own baseline weakness on this cost basis (deeply negative even
unfiltered — see e.g. SCALED-EXIT-LADDER-CONFIRMATORY's plain fixed-TP baselines) rather than
about any one of these four information sources (OI, basis, liquidation-volume, long/short ratio)
carrying no information at all. Recorded as VERDICTS.md's `LONG-SHORT-RATIO-CONTRARIAN` row and as
a decision-journal entry
(`research-runs/2026-08-15T08-07-41-757Z-long-short-ratio-contrarian.json`).

## 2026-08-15 — TOP-TRADERS-DIVERGENCE: informed-vs-crowd positioning divergence as a confirmation gate

Distinct from LONG-SHORT-RATIO-CONTRARIAN (immediately above): that item tested the aggregate
long-short-ratio alone, against ITS OWN history, as a contrarian-fade suppression signal. This item
tests whether the top-traders cohort DISAGREEING with the aggregate crowd is itself predictive — a
different axis (divergence between two series, not one series' own extremity), evaluated on its own
pre-registered gate per this item's own instruction not to let LONG-SHORT-RATIO-CONTRARIAN's result
color it.

**Endpoint definition, verified against Kraken's real public docs before writing any strategy
code — this item's own explicit done_when requirement ("verify its actual definition... don't infer
from the name alone").** `docs.kraken.com/api/docs/futures-api/charts/analytics` defines
`top-traders` as `{ top20Percent: { openInterest, longCount, shortCount, longPercent, shortPercent,
ratio } }` — the top 20% of accounts BY OPEN INTEREST (position size). The task's hypothesis framed
this cohort as "larger/more sophisticated accounts, if that is genuinely what this endpoint
represents." Kraken's own definition confirms "larger" (by open interest) but says nothing about
sophistication or informedness — that half of the hypothesis is not testable from this endpoint and
is not assumed true here; only "a distinct, larger-position cohort from the aggregate" is claimed.

**A real bug was found and fixed as part of this item's own data-availability check, before any
strategy code was written.** `derivatives.mjs`'s `normalizeAnalytics` handles two response shapes
(a flat array of values, and a flat object of parallel arrays) — every other analytics type this
project has used (`open-interest`, `long-short-ratio`, `long-short-info`, `future-basis`,
`liquidation-volume`) is one of those two flat shapes. Kraken's real `top-traders` response nests
its parallel-array object one level deeper, under the single key `top20Percent`. Calling
`normalizeAnalytics` on a real `top-traders` response, directly verified against the live API before
this was understood as a bug: every point's `value` silently came back as `{}` — not an error, not
an empty result, just an empty object at every timestamp, because the un-fixed code filtered
`Object.entries(result.data)` for array-typed values, found none (the sole entry's value was an
object, not an array), and produced an empty `series`, while the point-count `length` calculation
still ran to `timestamp.length` regardless. This would have silently corrupted every use of the
`top-traders` type with no exception thrown, the kind of failure that is easy to miss precisely
because it looks like success. Fixed generically in `derivatives.mjs` (unwraps any single-key object
wrapper whose sole value is itself a non-array object, not hardcoded to the literal string
`top20Percent`, so it also covers any future Kraken analytics type using the same wrapping
convention) with a dedicated regression test in `derivatives.test.mjs` asserting the unwrap
behavior against a shape matching the real response. Confirmed against the live API after the fix:
`top-traders`' `ratio` field for PF_XBTUSD now decodes correctly (0.49-0.55 across a 10-day spot
check) — the existing three `derivatives.test.mjs` cases (flat array, flat object, error path) and
the full 388-test suite stayed green before and after, so no other analytics type's handling
changed.

**Data-availability check, against the real API.** Both `top-traders` and `long-short-ratio` were
fetched directly, for the same symbol/window, for all four spot-checked symbols before writing the
study: 950 days of daily history apiece for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD (back to
2024-01-09 — deeper than every prior derivatives study's checked depth), with IDENTICAL daily
timestamp anchors on both series — no alignment gaps to bridge, no interpolation needed. Both
values are already the long-side fraction of open positions/accounts (`top-traders`' `ratio` field;
`long-short-ratio`'s plain decimal value, already validated by LONG-SHORT-RATIO-CONTRARIAN), so
`divergence = topTradersRatio - aggregateRatio` needed no unit conversion. Spot-checked on
PF_XBTUSD: top traders read 0.49-0.55 against an aggregate reading 0.54-0.60 on the same 10 days — a
real, moving spread (aggregate consistently more bullish than the top-20%-by-OI cohort in this
window), not a constant offset or degenerate series. 28/29 watchlist assets clear the same 500-day
coverage floor used by every other derivatives study (EOS excluded on the same pre-existing
candle-history shortfall, not a data-source problem).

**Pre-registered hypothesis and gate mechanism (`top-traders-divergence.mjs`, new module).** The
task's own framing — "the top-trader side is more predictive" when the two disagree — translates,
for this project's long-only entry families, into requiring the top-traders cohort to lean MORE
bullish than the aggregate crowd before allowing an entry: a CONFIRMATION gate (require positive
divergence), the same shape OPEN-INTEREST-TREND-CONFIRMATION and FUTURES-BASIS-DIRECTIONAL-SIGNAL
used, and functionally the opposite of LONG-SHORT-RATIO-CONTRARIAN's suppress-on-own-extreme shape.
Each daily divergence point only becomes visible once its own day has closed (+1 day) — the same
no-lookahead offset every derivatives-gate module here uses. The threshold is fixed, not a trailing
average: the 80th percentile of the asset's OWN divergence values within the TRAIN window only
(never recomputed on holdout), the same "one clean choice, not a threshold grid" convention every
prior gate study here has used. The gate allows an entry only while the latest revealed divergence
is at/above that fixed train threshold, applied via `backtest.js`'s existing `entryGate` hook — no
`backtest.js` changes — to `breakout`'s and `anticipate`'s exact `tournament.mjs` baseline configs,
unmodified, full 28-asset (of 29) watchlist, corrected real cost basis (FEE_RATE=0.008/side,
SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). Sealed 70/30 chronological split within each asset's
divergence-covered window, with the same split-boundary timestamp also bounding the train-only
divergence values used to fix the threshold — one shared cut, no separate leakage surface.

**Gate (this item's own pre-registered `done_when`, standard three-clause shape):** holdout
avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40, evaluated
per family.

| Family | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|
| breakout | train | 1333 | -0.737 | 0/28 |
| breakout | holdout | 1145 | -0.961 | 1/27 |
| anticipate | train | 1940 | -0.806 | 0/28 |
| anticipate | holdout | 1470 | -0.982 | 0/27 |

**Verdict: TOP-TRADERS-DIVERGENCE FAIL, decisive, both families.** Both holdout trade counts clear
the >=150 floor comfortably (1145 and 1470 trades — 7.6x and 9.8x the floor), so this is not a
sample-size non-verdict. Holdout avgR/trade is far past the -0.30 floor for both families (breakout
-0.961, anticipate -0.982) and matches train's sign and rough magnitude in both cases (train
-0.737/-0.806 vs holdout -0.961/-0.982) — no train/holdout divergence to explain away. Positive-asset
fraction is 1/27 and 0/27 holdout, nowhere near the 0.40 floor. The pre-registered confirmation
hypothesis (requiring top-traders to lean more bullish than the aggregate crowd before entering
improves forward returns) is not supported: gating on informed-vs-crowd divergence does not rescue
`breakout`/`anticipate` any more than any other derivatives-based gate tested in this project
(OPEN-INTEREST-TREND-CONFIRMATION, FUTURES-BASIS-DIRECTIONAL-SIGNAL, LONG-SHORT-RATIO-CONTRARIAN),
regardless of whether the gate shape was confirmation or contrarian-fade, or whether the information
source was a single series' own history or a divergence between two series — continued evidence
that the failure mode is about `breakout`/`anticipate`'s own baseline weakness on this cost basis
rather than about any of these five derivatives-based information sources carrying no information at
all. Recorded as VERDICTS.md's `TOP-TRADERS-DIVERGENCE` row and as a decision-journal entry
(`research-runs/2026-08-15T09-06-22-664Z-top-traders-divergence.json`).

---

## 2026-08-18 — ORDER-FLOW-AGGRESSOR-IMBALANCE: aggressor-side trade-flow direction as an entry gate

Picked from the work_queue's derivatives-infra batch. Distinct from the already-FAILED
VOL-CONFIRM-BREAKOUT (TOURNAMENT_ROADMAP.md, 2026-08-14), which gated `breakout` on raw
spot-candle VOLUME MAGNITUDE — no directional information, and made results worse than the
unfiltered baseline. `derivatives.mjs`'s `cvd` and `aggressor-differential` analytics types
measure aggressive BUY volume vs aggressive SELL volume — real order-flow direction, genuinely
unavailable from OHLCV candles alone. Per this item's own instruction, the two types are treated
as ONE information source (two computations of the same aggressor-imbalance concept — cumulative
running total vs periodic differential), not two independent hypotheses, to avoid inflating this
project's multiple-comparisons exposure.

**Endpoint shapes verified against a live API probe, not documentation** (this project's standing
convention — see TOP-TRADERS-DIVERGENCE's endpoint-definition note). Both
`docs.kraken.com/api/docs/futures-api/charts/analytics` and the `.../market-analytics` variant
404'd as of this check, so the shapes below come from calling `fetchAnalytics` directly against
`PF_XBTUSD` before writing any strategy code:
- `cvd`: `result.data = { buy_volume: [...], sell_volume: [...], cvd: [...] }`. `buy_volume`/
  `sell_volume` are real per-period trade volume, confirmed query-window-INDEPENDENT (identical
  value for the same day across two fetches with different `since`). The `cvd` sub-field itself is
  **not** window-independent — it is a running sum that resets to zero baseline at the query's own
  `since`: the same day's `cvd` value read `11.47` on a 5-day fetch and `583.84` on a 10-day fetch
  for the identical timestamp. This project's `fetchAnalytics` always uses one fixed `since` per
  asset per run (confirmed single-page for the full 900-day window, no pagination observed for any
  of four sampled symbols), so the raw field would have been internally consistent in practice —
  but this module deliberately does not rely on it, since it is undocumented API behavior
  discovered empirically, not a guaranteed contract. Instead it self-computes a running sum from
  the verified window-independent `buy_volume - sell_volume` primitives.
- `aggressor-differential`: `result.data = [...]` (flat array). Confirmed query-window-INDEPENDENT.
  Sign convention read directly off real numbers, not assumed from the field name — generic
  descriptions of "aggressor differential" suggested a buy-positive convention; the real data says
  the opposite: `aggressor-differential[i] == -(buy_volume[i] - sell_volume[i])`, i.e. Kraken's raw
  value is POSITIVE when SELL-side aggression dominates (verified exactly on 5 live sample points).
  Negated on read to a consistent buy-positive `netBuyPressure` convention used throughout.

**Data-availability check performed directly against the real API before writing this module.**
Both `cvd` and `aggressor-differential` reach back to 2024-02-28 for PF_XBTUSD/PF_ETHUSD/
PF_SOLUSD/PF_XRPUSD alike — the same start date and underlying endpoint family as
OPEN-INTEREST-TREND-CONFIRMATION's `open-interest` and LIQUIDATION-CASCADE-REVERSAL's
`liquidation-volume` checks, single page for the full 900-day window (no pagination observed for
any sampled symbol). Coverage is gated on the same candle-history floor as every other derivatives
study: 28/29 watchlist assets clear it (EOS excluded on its pre-existing candle-history shortfall,
not an order-flow-availability problem).

**Two formulations, best-on-train selection (`order-flow-aggressor-imbalance.mjs`, new module).**
Matching the task's own "cumulative running total vs periodic differential" framing:
- `periodic`: `aggressor-differential`'s own per-period `netBuyPressure`, gated at/above its own
  TRAIN-fixed 80th percentile — the same confirmation shape TOP-TRADERS-DIVERGENCE/
  LONG-SHORT-RATIO-CONTRARIAN use.
- `cumulative`: the self-computed running sum of `buy_volume - sell_volume`, gated above its own
  N=7-bar trailing average (current point excluded from its own average) — the same trend shape
  OI-TREND-GATE's `makeOiRisingAt` uses, N=7 reused unmodified as one disclosed choice, not a
  parameter sweep.

Both formulations cross-checked against each other on the real API: for the same day,
`aggressor-differential`'s raw value equals `-(buy_volume - sell_volume)` from `cvd` exactly,
confirming the two endpoints measure the same underlying per-period flow, as the task's framing
assumes. Both are scored on TRAIN ONLY, **per family** (`breakout`/`anticipate` independently,
since each family's optimal filter mechanism can differ — every prior study in this series
selects/reports per family, not globally); only the best-on-train formulation per family (highest
train avgR/trade among those with >=1 train trade) has its holdout ever computed, evaluated
exactly once — the same selection discipline LIQUIDATION-CASCADE-REVERSAL used across its own
three candidate multipliers. Each daily point only becomes visible once its own day has closed
(+1 day) — this codebase's standard no-lookahead offset. `breakout`/`anticipate` baseline configs
reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side,
SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). Sealed 70/30 chronological split within the
INTERSECTION of both formulations' covered windows (not either series' own full window), so the
train-only formulation comparison runs on an identical candle universe for both candidates.

**Gate (this item's own pre-registered `done_when`, standard three-clause shape):** holdout
avgR/trade > -0.30 AND holdout trades >= 150 AND holdout positiveAssets/assets >= 0.40, evaluated
per family, on the best-on-train formulation only.

| Family | Candidate | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|---|
| breakout | periodic | train | 1471 | -0.790 | 0/28 |
| breakout | cumulative | train | 999 | -0.819 | 1/28 |
| breakout | **periodic (selected)** | **holdout** | **751** | **-0.896** | **2/28** |
| anticipate | periodic | train | 1725 | -0.818 | 0/28 |
| anticipate | cumulative | train | 1157 | -0.851 | 0/28 |
| anticipate | **periodic (selected)** | **holdout** | **822** | **-0.964** | **1/27** |

**Verdict: ORDER-FLOW-AGGRESSOR-IMBALANCE FAIL, decisive, both families.** `periodic` won the
best-on-train selection for both families, though by a small margin — both candidates were
decisively negative on train in both cases (breakout -0.790 vs -0.819; anticipate -0.818 vs
-0.851), so this was not a case of one formulation looking promising and the other not. Both
holdout trade counts clear the >=150 floor comfortably (751 and 822 trades — 5.0x and 5.5x the
floor), so this is not a sample-size non-verdict. Holdout avgR/trade is far past the -0.30 floor
for both families (breakout -0.896, anticipate -0.964) and matches train's sign and rough
magnitude in both cases — no train/holdout divergence to explain away. Positive-asset fraction is
2/28 and 1/27 holdout, nowhere near the 0.40 floor. Genuine aggressor-side trade-flow direction,
unlike raw volume magnitude (VOL-CONFIRM-BREAKOUT), still does not rescue `breakout`/`anticipate`
— both formulations of the same underlying signal fail in the same direction and magnitude as
every other derivatives-based gate tested in this project (OPEN-INTEREST-TREND-CONFIRMATION,
FUTURES-BASIS-DIRECTIONAL-SIGNAL, LONG-SHORT-RATIO-CONTRARIAN, TOP-TRADERS-DIVERGENCE), regardless
of whether the information source is positioning, pricing, forced-flow events, or now executed
trade direction — continued evidence that the failure mode is about `breakout`/`anticipate`'s own
baseline weakness on this cost basis rather than about any of these six derivatives-based
information sources carrying no information at all. Recorded as VERDICTS.md's
`ORDER-FLOW-AGGRESSOR-IMBALANCE` row and as a decision-journal entry
(`research-runs/2026-08-18T18-26-39-898Z-order-flow-aggressor-imbalance.json`).

## 2026-08-18 — ROLLING-VOLATILITY-REGIME-TIMING: realized-volatility regime as an entry-timing filter

Picked from the work_queue's derivatives-infra batch (next pending item after
ORDER-FLOW-AGGRESSOR-IMBALANCE closed). Distinct from ATR-ADAPTIVE-STOP-CONFIRMATORY (already
FAIL, TOURNAMENT_ROADMAP.md 2026-08-14 — sized the STOP DISTANCE by a candle-derived ATR proxy)
and T2-VOLCONTRACTION (already FAIL — an ATR-compression ENTRY TRIGGER, also candle-derived).
This tests realized-volatility REGIME as an entry-timing FILTER on the existing
`breakout`/`anticipate` signal, using `derivatives.mjs`'s `rolling-volatility` analytics type
(Kraken's own annualized realized-vol feed) for the first time in a sealed-holdout study — a
genuinely different (if related) volatility measurement than a candle-derived ATR proxy, and a
FILTER mechanism rather than a stop-sizing or entry-trigger one.

**Endpoint shape verified against a live API probe, not documentation** (this project's standing
convention — the docs.kraken.com analytics pages have 404'd on every prior check this project has
made). Calling `fetchAnalytics` directly against `PF_XBTUSD` before writing any strategy code:
`result.data = [...]` — a flat array of numeric-string annualized-vol percentages (e.g.
`"22.11"`), already the shape `normalizeAnalytics` handles for every non-wrapped type, no unwrap
needed. Confirmed query-window-INDEPENDENT: fetching the same trailing window at two different
widths (5-day vs 10-day, both ending "now") returned an *identical* value for the shared
timestamp `1786579200` (`"22.11"` both times) — unlike `cvd`'s raw field (see
ORDER-FLOW-AGGRESSOR-IMBALANCE above), so no self-computation workaround was needed here; the raw
field is used directly.

**Data-availability check performed directly against the real API before writing this module.**
`rolling-volatility` reaches back to 2024-03-01 for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD alike
(901 daily points for a 900-day window, single page, no pagination observed for any sampled
symbol) — the same start-date depth as every other derivatives study's checked family. Coverage
gated on the same candle-history floor as every other derivatives study: 28/29 watchlist assets
clear it (EOS excluded on its pre-existing candle-history shortfall, not a vol-data-availability
problem).

**Two directions, BOTH pre-registered together — no train-based selection step**
(`rolling-volatility-regime-timing.mjs`, new module). This item's own task explicitly said "test
both directions... not picked from train results," which is a genuinely different discipline from
every prior gate study in this series (all of which score multiple candidates on train and only
compute holdout for the best-on-train winner): here, both `expanding` (current
rolling-volatility above its own N=7-day trailing average — a "vol is rising" regime) and
`contracting` (current below its own trailing average — a "vol is falling" regime) get their own
independent train AND holdout evaluation, gated separately, no selection step to skip either one.
The two are mutually exclusive by construction (current cannot simultaneously exceed and fall
below the same trailing average) — confirmed empirically in this module's own test suite: a
monotonically rising synthetic vol series produces `expanding` trades that dominate `contracting`
trades by a wide margin, and a flat series produces zero trades for both directions
simultaneously. N=7 trailing days reused unmodified — the same single disclosed window
OI-TREND-GATE's `makeOiRisingAt` and ORDER-FLOW-AGGRESSOR-IMBALANCE's `cumulative` formulation
both use, one pre-registered choice, not a parameter sweep. Current point excluded from its own
trailing average (no self-inclusion bias); each daily point only becomes visible once its own day
has closed (+1 day), this codebase's standard no-lookahead offset. `breakout`/`anticipate`
baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis
(FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). Sealed 70/30 chronological
split within the vol-covered window (same `windowedSplit` technique OI-TREND-GATE uses).

**Gate (this item's own pre-registered `done_when`, standard three-clause shape, evaluated
independently for both directions):** holdout avgR/trade > -0.30 AND holdout trades >= 150 AND
holdout positiveAssets/assets >= 0.40.

| Family | Direction | Split | Trades | avgR/trade | Positive assets |
|---|---|---|---|---|---|
| breakout | expanding | train | 2813 | -0.807 | 0/28 |
| breakout | expanding | **holdout** | **967** | **-0.970** | **0/28** |
| breakout | contracting | train | 2878 | -0.774 | 0/28 |
| breakout | contracting | **holdout** | **1300** | **-0.978** | **0/27** |
| anticipate | expanding | train | 4511 | -0.757 | 0/28 |
| anticipate | expanding | **holdout** | **1587** | **-1.037** | **0/27** |
| anticipate | contracting | train | 3449 | -0.817 | 0/28 |
| anticipate | contracting | **holdout** | **1238** | **-0.815** | **1/27** |

**Verdict: ROLLING-VOLATILITY-REGIME-TIMING FAIL, decisive, all four family/direction
combinations.** Every holdout trade count clears the >=150 floor comfortably (967-1587 trades,
6.4x-10.6x the floor), so none of the four are sample-size non-verdicts. Every holdout avgR/trade
is far past the -0.30 floor (-0.815 to -1.037) and matches its own train split's sign and rough
magnitude — no train/holdout divergence to explain away for any combination. Positive-asset
fraction is 0/28, 0/27, 0/27, and 1/27 across the four combinations, nowhere near the 0.40 floor.
Realized-volatility regime, tested in both directions exactly as pre-registered rather than
cherry-picking the better-looking one after the fact, does not rescue `breakout`/`anticipate` any
more than any other derivatives-based gate tested in this project (OPEN-INTEREST-TREND-
CONFIRMATION, FUTURES-BASIS-DIRECTIONAL-SIGNAL, LONG-SHORT-RATIO-CONTRARIAN,
TOP-TRADERS-DIVERGENCE, ORDER-FLOW-AGGRESSOR-IMBALANCE) — continued evidence that the failure mode
is about `breakout`/`anticipate`'s own baseline weakness on this cost basis, not about any
particular derivatives-based information source (or its timing/confirmation/regime framing)
carrying no information at all. Recorded as VERDICTS.md's `ROLLING-VOLATILITY-REGIME-TIMING` row
and as a decision-journal entry
(`research-runs/2026-08-18T19-04-49-763Z-rolling-volatility-regime-timing.json`).
