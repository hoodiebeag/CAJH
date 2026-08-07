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
Track 1, -0.437R holdout unfiltered net-of-cost) on BTC>200d-SMA, rather than testing
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

For comparison, `breakout` unfiltered (Track 1, same net-of-cost split): holdout
avgR -0.437R/trade on 3123 trades, 28 assets. The BTC>200d-SMA gate removes roughly
55% of holdout trades and 8 of 28 assets entirely (no trade in the gated regime at all),
and improves avgR modestly (-0.437 → -0.379) — a real but small effect, not enough to
approach the gate.

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
