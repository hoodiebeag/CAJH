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

## 2026-07-30 — overnight build (autonomous session)

- **Strategy moved to 1h/4h/1d** with **anticipation entries**: buy the moment price
  crosses a candidate swing low's trigger (the candidate candle's high) on ANY of the
  three TFs — the "enter when the signal is *expected* to print" item above, now live
  and mirrored in the backtester (`entryMode: "anticipate"`, tested).
- **Alignment gate removed from the live path** (it was rejecting ~everything);
  replaced by **risk-based sizing** — 0.5% of cash risked per trade, 20% notional cap,
  per-TF stop bands (≤4% 1h · ≤6% 4h · ≤10% 1d · ≥1.5% floor).
- **Position rotation**: at the 6-position cap a new signal closes the most profitable
  open position first (banks the winner), then opens.
- **Phantom-position fix (the "PUMP" bug)**: buys are only tracked after Kraken
  confirms the fill (`QueryOrders` status/vol_exec; canceled/unconfirmed ⇒ not
  tracked), and reconciliation now runs on boot + every 6h and auto-removes ghosts
  (tracked but not held). Removal drops the record only — nothing is ever sold.
- Backtester/profiler generalized to timeframe series; research commands re-run on
  1h/4h/1d; store: XBTUSD backfilled to now; Q1-2026 archive download pending
  (Google Drive per-file quota; retry loop running).


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

## 2026-07-30 (evening) — stop placement tested; data completed; archive pruned

**Data.** The full-history archive (`Kraken_OHLCVT.zip`, still on the Desktop) supplied
the missing history for the seven Q1-only pairs plus DOGE, so all **20 watchlist pairs
now run Jan/Feb 2025 → Mar 2026** (BTC to today). Archive pruned from 1.9 GB to 443 MB:
only the 1-minute files for pairs we actually use are kept (the store resamples the rest).

**Exit sweep re-run on 20 pairs** — same answer, more power: live exit −0.470 R/t train
(6,546 trades) / −0.642 R/t holdout, best-of-12 −0.405 R/t, **0/20 pairs green in every
configuration**, gross −0.089 R/t.

**Stop placement (`!excursion`, `node research.js excursion`).** Tests the "stops are too
tight" hypothesis directly: for every live entry it measures how far price ran against
before running for (in ATRs, so assets are comparable), then runs a first-passage grid
over stop k·ATR × target m·ATR reporting GROSS and net.

Two measurement traps were found and fixed while building it:
- Max adverse excursion over a fixed 200-bar horizon is not "the dip before it worked" —
  it is mostly the asset's range over 200 bars and grows with the horizon. It now measures
  the dip *before price first ran 2 ATR in our favour*, which is the number that governs
  stop placement.
- Excursions now floor at zero (a trade that never traded below entry has no adverse
  excursion, not a negative one).

Findings: the swing-low stop sits ≈1.0 ATR below entry on all three timeframes. In the
grid, positive-gross cells cluster at the **tightest** stop with the **farthest** target
(≈10% win rate, lottery-ticket payoff) — the opposite of what "stopped out too early"
predicts — and those same cells carry ruinous fee drag, because cost in R scales as
0.9% ÷ stop-distance. Wider stops improve NET (less fee drag per R) while their gross
stays negative. Net-positive cells are a handful out of ~126 correlated in-sample tests,
which is what selection alone produces; the command now re-checks the best training cell
on the sealed Q1-2026 window instead of trusting an in-sample maximum.

## 2026-07-30 (night) — the finding that reframes every earlier result

**The test window was a savage alt bear market.** Buy & hold over Jan 2025 → Mar 2026
averaged **−66% per pair, with 0 of 20 pairs up** (best −12%, worst −90%). Every
"no edge" verdict in this file was measured on a period where the only winning
long-only action was *not trading*. That does not make the verdicts wrong, but it
narrows them: we have shown the trigger fails in a downtrend, and we have **no
bull-market data to test it on**.

**cajh's entries vs random entries** (`node baseline.mjs`), same exits, same costs:

| entries | trades | R/trade | 95% CI |
|---|---|---|---|
| cajh live rule | 8,203 | −0.492 | [−0.528, −0.456] |
| random bars | 8,203 | −0.449 | [−0.492, −0.406] |

Difference −0.043 ±0.056 → **statistically indistinguishable from random.** So the loss
is not hidden execution friction and not a coding defect: the trigger is not broken, it
is empty. (Gross-of-cost expectancy was already ≈0, which rules friction out separately.)

**Bug found by that test:** `alignMode` and `trendGate` were never applied in
`entryMode:"anticipate"` — only in `"bos"`. The alignment comparison was silently
testing nothing. Fixed; gates now apply in both modes.

**Is timeframe alignment/confirmation necessary?** (`node regime.mjs`) — no:

| gate | 1h R/t | 4h R/t | 1d R/t |
|---|---|---|---|
| none (live today) | −0.529 (4931t) | −0.462 (2763t) | −0.293 (509t) |
| higher-TF alignment | −0.562 (855t) | −0.462 (1246t) | n/a (1d is top TF) |
| MA trend gate | −0.555 (1766t) | −0.534 (932t) | **−0.107 (210t)** |
| alignment + MA gate | −0.729 (317t) | −0.620 (476t) | −0.107 (210t) |

Alignment never improves per-trade expectancy — it only removes trades. The one variant
that helps is the **daily MA trend gate**: −0.293 → −0.107 R/t, total −149R → −22R, by
cutting 509 trades to 210. Note what that is: not a better entry, but a switch that
stops trading when the market is falling. In this window, "know when to quit" was the
only thing that worked, which is consistent with the bear-market context above.

Caveat on all of it: −0.107 ±0.248 is not distinguishable from zero. It is a direction,
not a result.

## 2026-07-31 — 2023-2024 ingested; the simple daily strategy tested across regimes

**Data.** `INGEST_SINCE=YYYY-MM-DD` added to the ingest command (the 18-month default
could not reach a bull market). All 20 pairs now span **2023-01-01 → 2026-03-31**
(BTC to today), covering the 2023-24 bull and the 2025-26 bear.

**ATR stops implemented** in the backtester (`stopMode:"atr"`, `atrStopK`): stop sits
k·ATR below entry with ATR taken to the previous bar, so R scales with volatility and a
wider stop means a smaller position rather than more risk.

**The simple daily strategy** (`node simple.mjs`) — daily bars, anticipation entry,
MA20 trend gate, 3·ATR stop, 3R target, *nothing else*:

| window | trades | net R/t | gross R/t | total R | buy & hold |
|---|---|---|---|---|---|
| 2023 (unseen) | 65 | +0.227 ±0.441 | +0.287 | +15R | **+308%** |
| 2024 (unseen) | 88 | +0.401 ±0.393 | +0.451 | +35R | **+52%** |
| 2025-26 (bear) | 98 | −0.376 ±0.281 | −0.329 | −37R | −68% |
| ALL | 273 | +0.049 ±0.201 | +0.099 | +13R | +49% |

First non-negative result the project has produced, and it is robust to the knobs: all
nine stop×target combinations on 2023-24 are positive (+0.145 → +0.504 R/t), so it is
not fitted to one setting.

**But it is beta, not alpha.** Two things say so. First, the sign tracks the market
exactly — positive in both up years, negative in the down year. Second, the direct test
(`node isbeta.mjs`) replaces the swing trigger with RANDOM entries that pass the same
MA20 gate:

| window | swing entry | random, same gate | difference |
|---|---|---|---|
| 2023 | +0.227 ±0.441 | −0.243 ±0.366 | +0.470 ±0.573 (same) |
| 2024 | +0.401 ±0.393 | +0.215 ±0.381 | +0.187 ±0.548 (same) |
| 2025-26 | −0.376 ±0.281 | −0.503 ±0.255 | +0.126 ±0.380 (same) |
| ALL | +0.049 ±0.201 | −0.045 ±0.195 | +0.095 ±0.280 (same) |

The trigger is never statistically distinguishable from a random entry in an uptrend.
The trend gate is doing the work; the swing structure is decoration. And the scale
settles it: +13R over 3.5 years is ≈ +6.5% of account at the configured 0.5% risk, while
holding the same 20 coins returned ≈ +49%. **The strategy underperforms buying and
holding by roughly an order of magnitude, while adding execution risk and 273 fee legs.**

The consistent direction across all four windows (+0.095 R/t overall, always positive)
is the one thread left, but it is inside the noise band everywhere; distinguishing it
would need several times this many daily trades.

## 2026-07-31 (later) — overlay, uncapped trailing exits, and what data we actually have

**Trend filter as a defensive overlay** (`node overlay.mjs`) — hold the coin while its
daily close is above its own MA, sit in cash otherwise; signal on close, filled next
open, every switch charged 0.45%:

| window | buy & hold | MA20 | MA50 | MA100 |
|---|---|---|---|---|
| 2023 (bull) | **+302%** (DD −50%) | +79% | +53% | +61% |
| 2024 (bull) | +52% (DD −61%) | **+66%** (DD −49%) | +34% | +11% |
| 2025-26 (bear) | −68% (DD −78%) | −57% | −37% | **−26%** (DD −44%) |
| ALL | **+49%** (DD −81%, ret/DD 0.61) | −20% | +21% | +24% (DD −65%, ret/DD 0.36) |

It does exactly what a trend overlay is supposed to do in a bear market — MA100 beat
buy & hold on **20/20 pairs** in 2025-26 and cut the average drawdown from −78% to −44%.
But over the full sample buy & hold wins on return *and* on return-per-drawdown, because
the 2023 bull cost the overlay ~220 points of upside to whipsaw. Slower MAs whipsaw less
and did better; faster ones churned (MA20 switched 128 times per pair and finished −20%).
So: a real risk-reduction tool, not a free lunch, and not an edge.

**Removing the take-profit ceiling** (`node trail.mjs`) — same daily strategy, fixed
target replaced with an ATR trailing stop:

| exit | 2023 | 2024 | 2025-26 bear | ALL | biggest win |
|---|---|---|---|---|---|
| fixed 3R target | +0.232 | +0.456 | −0.351 | +0.079 ±0.222 | 3.0R |
| trail 1R | +0.237 | +0.259 | −0.129 | +0.075 ±0.136 | 6.1R |
| trail 3R | +0.173 | **+1.018** | −0.602 | **+0.255 ±0.368** | **16.9R** |
| half@2R + trail 2R | +0.123 | +0.261 | −0.339 | +0.048 ±0.178 | 6.0R |

The idea has real content: the cap was truncating winners at 3R when the biggest
uncapped winner ran to 16.9R, and in the trending year the loose trail nearly doubled
the result (+79R vs +39R). It is also the highest-variance choice — the ALL figure for
trail 3R rests on one good year and a handful of outliers, its confidence interval is
the widest in the table, and it was the *worst* model in the bear. Trail 1R is the
opposite trade: tightest interval, 53% win rate, small. Neither is distinguishable from
zero over the full sample.

**Signal-class reality check.** Order-flow columns survive for only 9% of BTC's bars and
0% of ETH's — the archive ingest zeroes buyVol/sellVol, and it overwrote the
trades-derived bars on every overlapping minute. Any order-flow study needs a fresh
Trades-endpoint backfill (~hours per pair), and funding rates, open interest and
cross-exchange basis are not in this project's data at all.

## 2026-07-30 (night) — order flow tested: the first signal that isn't flatly zero

Order-flow data restored via the Trades endpoint for three pairs (the OHLCVT archive has
no aggressor columns): **BTC 173k bars (Apr 1 → Jul 30), ETH 128k and SOL 128k (May 1 →
Jul 29)** — ~430k flow-bearing 1-minute bars, zero duplicate minutes.

`flowsignal.mjs BTC ETH SOL --pool` tested four features × 3 bar sizes × 3 horizons = 36
cells, scoring the information coefficient against a shuffled null and the decile spread
against the ~0.9% round-trip cost.

**15m and 1h: nothing.** Every cell sits within noise of its shuffled null; the best
decile spread reaches 38% of cost. Aggressor imbalance is mildly *negative* at 15m
(IC ≈ −0.03), i.e. buying pressure slightly precedes lower returns — but far too small to
trade and it flips sign at 4h, which is itself a tell that it is noise.

**4h looked promising, and one of the two candidates died under scrutiny.** Two cells
stood out at a 48h horizon: cumulative imbalance (+1.081% spread — the only cell in the
whole grid to clear cost) and trade intensity (−1.121%, IC −0.085 vs shuffled +0.029).

Both numbers are inflated by **overlapping windows**: a 48h horizon on 4h bars means 12
consecutive samples share 11 of their 12 hours, so n=1707 is really ~142 independent
observations and the standard errors are ~3.5× too small. `flowverify.mjs` recomputes
with stride = horizon (non-overlapping):

| feature | overlapping IC | non-overlapping IC | z | 95% CI | verdict |
|---|---|---|---|---|---|
| cum imbalance(6) | +0.0443 | **+0.0163** | +0.19 | [−0.149, +0.181] | dead — the "clears cost" cell was an overlap artifact |
| trade intensity | −0.0847 | **−0.1603** | −1.90 | [−0.325, +0.005] | not significant, but it *strengthened* |

Cumulative imbalance is finished: strip the overlap and the effect vanishes to nothing.

**Trade intensity is the one live thread in this project.** Unlike everything tested
before it, it does not evaporate under scrutiny — the effect *grew* on independent
samples (−0.085 → −0.160), the sign is consistent across BTC alone, the pooled set, and
both sampling schemes, and the direction is economically sensible: unusually busy 4h bars
precede *lower* 48h returns (activity spikes at exhaustion, not continuation).

It is still **not proven**: z = −1.90 misses the 95% bar, n = 142, one 3-month window and
one regime, and it is one of 36 cells tested — with 36 tests, ~2 hitting p<0.05 by chance
is the expectation, not the exception. What separates it from the project's other dead
ends is that it is the first candidate whose evidence improves rather than collapses when
the statistics are done honestly.

Next, in order: extend the flow backfill window (more independent 48h samples is the only
thing that resolves z = −1.90 either way), then test it as a *filter* on the existing
long-only strategy — "don't buy when 4h trade intensity is elevated" — rather than as a
standalone signal, since a long-only bot cannot short the high-intensity leg.

### Correction (same night): proper statistics kill the "clears cost" result

`flowsignal.mjs` was rewritten to use a **block-permutation null** (blocks sized to the
horizon, so the null carries the same overlap-driven autocorrelation as the alternative)
plus **Benjamini-Hochberg FDR** across all 36 cells. Re-run on the same data:

**0 of 36 cells survive FDR *and* clear the 0.9% round-trip cost.**

Three things the correction revealed, none visible in the single-shuffle version:

1. **The +1.081% "CLEARS" cell was noise.** Cumulative imbalance at 4h/48h scores
   **p=0.309** under a block-permutation null. It had already failed the non-overlapping
   resample (IC +0.016, z=0.19); two independent checks now agree it is nothing. An
   uncorrected 36-cell scan producing one apparent winner is the textbook result, and it
   is exactly what happened.

2. **Some cells are statistically real and economically worthless.** 15m imbalance and
   cumulative imbalance survive FDR at **p=0.003** — genuine, replicable structure
   (buying pressure mildly precedes lower returns). Their decile spreads are 0.009%–0.051%,
   or **1–6% of the round-trip cost**. Real is not the same as tradeable, and this is the
   cleanest illustration of that distinction the project has produced.

3. **Trade intensity still refuses to die, and still isn't proven.** At 4h it posts
   p=0.010 / 0.010 / 0.033 across the three horizons — the lowest p-values in its block,
   consistent in sign, with a −1.121% spread at 48h that does exceed cost in magnitude.
   It misses the BH threshold (≈0.0097 at its rank) *by a hair*, just as it missed the
   95% bar by a hair on non-overlapping samples (z=−1.90 vs 1.96).

Three independent angles — non-overlapping resampling, block permutation, and sign
consistency across horizons and pair sets — all land on the same verdict: **promising,
not proven.** That convergence is what separates it from every dead end here; it is also
precisely the pattern a weak-but-real effect and a lucky noise draw both produce. Only
more independent samples separate them, which is why the flow window is being extended
back to 2026-01-01.

Working rule going forward: a signal must clear FDR **and** exceed cost. Neither alone is
sufficient, and this run demonstrates why each check catches what the other misses.

### Momentum M7: KILLED on available train/time evidence; symbol arm unavailable

> **Superseded below.** The "whole-symbol arm unavailable" caveat in this entry was
> resolved on 2026-08-06 — see "Momentum M7 — UPDATE" further down, which reports the
> actual whole-symbol holdout result. Verdict stays KILLED in both places; this entry's
> *evidence* is incomplete, the UPDATE's is not. Added 2026-08-07 as a forward pointer
> so a reader stopping at this entry doesn't mistake incomplete evidence for current.

**Configured specification:** L=30d · H=7d · rebalance=weekly · primary transform =
**residual (T2)**, β-window 90d · holdout = time plus whole-symbol (recent: 180d;
whole-symbol: ATOM/DOT/LTC). Universe stable-13:
[BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, DOT, LTC, BCH, ATOM, XLM]. Q1-2026-only
excluded early: [NEAR, FIL, APT, INJ, TAO, TIA, SUI].

**Pre-registration deviation:** M5 originally recorded ATOM/BCH/XLM as the symbol split;
B1 later substituted DOT/LTC after inspecting stored-symbol availability. No whole-symbol
statistic from either split is used as confirmation or as a headline result.

The current harness was run with 1,000 date permutations and the stored stable-13 data.
The whole-symbol arm is not estimable here: three held symbols are below the registered
eight-asset cross-sectional minimum, so it is reported as unavailable rather than
zero-filled.

**Primary confirmatory result (residual IC, stable-13):**

| window | N assets | D dates | mean IC | block-perm p | 95% CI | detectable-IC floor |
|---|---:|---:|---:|---:|---|---|
| train | 10 | 22 | 0.1114 | 0.5375 | [-0.0841, 0.3144] | — |
| **sealed recent holdout** | 10 | 26 | -0.1026 | 0.9600 | [-0.2712, 0.0532] | — |
| sealed whole-symbol holdout | 5 (<8 required) | 0 | — | — | — | — |

**Interpretation matrix (residual vs raw, primary cell):**

| | raw IC | residual IC | reading |
|---|---:|---:|---|
| train | — | 0.1114 (p=0.5375) | positive point estimate, not significant |
| holdout | — | -0.1026 (p=0.9600) | sign reversal; no confirmation |

**Per-regime (residual IC, train):**

| regime | dates | mean IC | p |
|---|---:|---:|---:|
| BTC bull | 22 | 0.1114 | — |
| BTC bear | 0 | — | — |
| BTC flat | 0 | — | — |

**Exploratory grid:** all 36 train-only cells were included in one grid/transform/regime
BH-FDR family. No cell survived correction (all reported q-values were 1.0); the largest
uncorrected residual point estimate was 0.3433 at L=14/H=30, p=0.1019.

**Economic (enter close_{t+1}, round-trip cost 0.9%):**

| metric | gross | net |
|---|---:|---:|
| top-tercile − universe forward return | -0.8410% | -1.0728% (turnover 25.76%) |
| top-3 harvest | -0.8410% | -1.0728% |
| top-5 harvest | -0.1319% | -0.3447% (turnover 23.64%) |

**VERDICT: KILLED** — deciding available evidence: train p=0.5375, recent-holdout
IC=-0.1026, and net top-tercile spread=-1.0728%. This is not a fully sealed
time-plus-symbol confirmation because the whole-symbol arm is unavailable.

**Survivorship caveat:** the universe is survivors-only; this weakens any positive result,
while the present null/sign reversal is conservative evidence against a robust edge.

### Momentum M7 — UPDATE: whole-symbol holdout executed (2026-08-06, PWR2)

**Why this is an update, not a silent overwrite.** The KILLED verdict above (train p=0.5375,
recent-holdout IC=-0.1026) came from `runMomentumStudy`, whose whole-symbol holdout is
hardcoded to exactly 3 symbols (ATOM/DOT/LTC) — permanently below the registered `M_min=8`
minimum regardless of data availability, so that arm reported "unavailable," never a null.
Re-running that same function today (PWR2 diagnosis) reproduces `symbolHoldout.n = 0` again,
confirming it is a structural limit of that function, not a data gap that PWR1 could fix.

The correctly-scoped function, `runSealedMomentumPanelStudy` (`momentum.mjs`), widens the
holdout universe to every stored symbol outside the stable-13 primary universe, and — as of
PWR2-HARNESS (commit fdba9f5) — scores its primary cell under the pre-registered residual
(T2) transform by default, with raw (T1) reported alongside as `study.primaryRaw`. This is
the **first execution of that function against real data**: it had tests before today but had
never been run against the live watchlist. Data availability (PWR1's deep-history backfill;
the `loadWatchlist()` fix, commit 65e130b) is what makes the whole-symbol arm non-empty here —
29 symbols are now loadable, versus 0 before.

**Pre-registration (frozen before holdout):** L=30d · H=7d · rebalance=weekly · primary
transform = **residual (T2)**, β-window 90d (`study.primaryTransform` confirms
`"btcResidual90"`) · holdout = time (last 4 rebalance dates) plus whole-symbol (every stored
symbol outside stable-13; 16 this run: ALGO, APT, EOS, ETC, FIL, INJ, NEAR, POL, SUI, TAO,
TIA, TRX, UNI, XMR, XTZ, ZEC). Universe stable-13 (controlled/primary):
[BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, DOT, LTC, BCH, ATOM, XLM].

**Primary confirmatory result — residual (T2, gated) and raw (T1, companion), all sealed arms
(`study.primary` / `study.primaryRaw`, run via `node momentum.mjs sealed`):**

| cell | N assets (range) | D dates | rows | mean IC | block-perm p | 95% CI |
|---|---|---:|---:|---:|---:|---|
| residual train | 11–13 | 140 | 1606 | 0.0280 | 0.7013 | [-0.0243, 0.0966] |
| residual recent holdout (4wk) | 13 | 4 | 52 | 0.0934 | 0.7882 | [0.0934, 0.0934] |
| **residual sealed whole-symbol holdout** | 8–16 | **73** | **881** | 0.0768 | 0.1289 | [-0.0006, 0.1805] |
| residual Q1-2026-only slice | 13 | 12 | 156 | -0.1442 | 0.1808 | [-0.2505, -0.0755] |
| raw train | 11–13 | 149 | 1721 | 0.0158 | 0.8382 | [-0.0435, 0.0797] |
| raw recent holdout (4wk) | 13 | 4 | 52 | 0.1291 | 0.7303 | [0.1291, 0.1291] |
| **raw sealed whole-symbol holdout** | 8–16 | **81** | **1007** | 0.0502 | 0.2907 | [-0.0060, 0.1434] |
| raw Q1-2026-only slice | 13 | 12 | 156 | -0.2152 | 0.0649 | [-0.4625, -0.0549] |

Eligible dates on the whole-symbol arm are non-zero for the first time: 73 dates under
residual, 81 under raw — residual's 90-bar β warmup costs it the earliest ~8 dates that raw
can still score, which is expected, not a bug.

**Interpretation matrix (residual vs raw, sec 2.1 — sealed whole-symbol holdout is this run's
headline cell; train shown for contrast):**

| | raw IC | residual IC | reading |
|---|---:|---:|---|
| sealed whole-symbol holdout | 0.0502 (p=0.2907) | 0.0768 (p=0.1289) | + / + but neither clears p<0.05, and both 95% CIs span zero — directionally consistent with "real idiosyncratic and actionable," but not statistically confirmed |
| train (stable-13) | 0.0158 (p=0.8382) | 0.0280 (p=0.7013) | ~0 / ~0 — no train signal |

**VERDICT: KILLED (unchanged, now decided on complete evidence).** The pre-committed pass
gate (§6) requires primary residual IC > 0 with block-permutation p < 0.05 **on train** before
the holdout even counts; train residual p=0.7013 (95% CI [-0.0243, 0.0966], clearly spanning
zero) fails that gate on its own, so momentum is killed on the train leg regardless of how the
holdout reads. Deciding numbers: train residual IC=0.0280, p=0.7013; sealed whole-symbol
holdout residual IC=0.0768, p=0.1289 (raw IC=0.0502, p=0.2907). The holdout point estimates
are positive and directionally consistent with train's weak positive point estimate, but none
reach the pre-registered significance bar anywhere. This supersedes the "symbol arm
unavailable" caveat in the entry above: the arm is now available and reads null, not missing.

**Survivorship caveat (mandatory, applies to this update too):** the universe (29 symbols via
`loadWatchlist()`, deep-history-backfilled per PWR1) is survivors-only — coins that delisted
or died are absent, so the loser tail is truncated. This weakens any positive reading (the
whole-symbol holdout's positive-but-non-significant point estimates could partly be a
survivors-only artifact) and makes the train-leg null, if anything, conservative evidence
against a robust edge rather than for one.

**What this update did not touch:** the exploratory grid and economic/net-of-cost tables in
the entry above were produced by `runMomentumStudy` (train-only, stable-13, pre-PWR1/PWR2
data) and were not re-run here. Re-scoring the exploratory grid and economics through
`runSealedMomentumPanelStudy` on the widened universe is a separate task, not claimed as
re-verified by this execution.

### Low-vol / low-beta B4: KILLED — no eligible holdout evidence in this workspace

> **Superseded below.** The "0 eligible holdout dates" data-gate cause in this entry was
> resolved on 2026-08-07 — see "Low-vol / low-beta B4 — UPDATE" further down, which
> reports the actual whole-symbol holdout result for both ranking variables. Verdict
> stays KILLED in both places; this entry's *evidence* is incomplete, the UPDATE's is
> not. Added 2026-08-07 as a forward pointer so a reader stopping at this entry doesn't
> mistake incomplete evidence for current.

**Configured specification:** same sealed harness as Momentum M7, with ranking variable
swapped from return momentum to low-risk ranks: **−trailing volatility** and
**−trailing BTC beta**. Outcomes are reported separately as forward raw return and
forward risk-adjusted return/vol. Economic view enters at close `t+1`, charges explicit
round-trip cost, and stays research-only.

**Harness availability check:** local `loadWatchlist()` returned `[]`, so the stable-13
daily panel had **0 eligible dates** and **0 holdout rows** for both low-volatility and
low-beta. The size/liquidity control therefore cannot rescue the result: there is no
controlled sample to score, and no net holdout evidence to promote.

| ranking var | outcome | window | mean IC | p | net spread |
|---|---|---|---|---|---|
| −trailing vol | fwd return | holdout | — (0 dates) | — | — |
| −trailing vol | fwd Sharpe | holdout | — (0 dates) | — | — |
| −trailing beta | fwd Sharpe | holdout | — (0 dates) | — | — |

**Size/liquidity control:** does the signal collapse to "hold the majors"? `—` —
evidence: not testable locally; the controlled universe produced 0 eligible holdout
dates, so the majors-vs-anomaly distinction is unavailable rather than favorable.

**VERDICT: KILLED** — deciding number: **0 eligible holdout dates / 0 holdout rows**.
No signal gets promoted without sealed net evidence. This is a data-gate kill, not a
claim that low-volatility is economically false in crypto.

### Low-vol / low-beta B4 — UPDATE: whole-symbol holdout executed (2026-08-07, PWR3)

**Why this is an update, not a silent overwrite.** The KILLED verdict above was a
data-gate kill: `loadWatchlist()` returned `[]` locally, so the stable-13 daily panel
had 0 eligible dates for both ranking variables — no arm was ever actually scored.
Since that entry, PWR1 backfilled deep history and fixed `loadWatchlist()`, and
PWR2/PWR2-HARNESS made the momentum sealed harness (`runSealedMomentumPanelStudy`)
score its primary cell against real data for the first time.

**A second, distinct harness gap found and fixed before trusting this run.**
`runSealedMomentumPanelStudy`'s `byRank` loop (the one B1's rank-mode parameterization
runs through) computed `train`/`recentHoldout`/`economics` per rank mode but never
scored the sealed whole-symbol holdout arm — there was no `symbolHoldout` key at all,
unlike the primary/primaryRaw cells PWR2-HARNESS fixed. This is a different gap from
PWR2-HARNESS's (that one was the primary cell defaulting to raw instead of residual);
this one meant the low-vol/low-beta whole-symbol arm had never been computed by any
code path, tested or run, regardless of data availability. Fixed in `momentum.mjs`:
`byRank[rank]` now also builds `symbolHoldout` and `symbolHoldoutRiskAdjusted` from the
same `holdoutUniverse` the primary cell uses, gated the same way
(`holdoutUniverse.length >= minAssets`, else an honest empty result). Covered by a new
test (`momentum.test.mjs`) that cross-checks the row count against a direct
`buildMomentumPanel` call and asserts an honest zero when the holdout universe is empty
(matching the existing B3 fixture test, which deliberately sets
`symbolHoldoutUniverse: []`). Added a `node momentum.mjs sealed-lowrisk` CLI path
(mirrors the existing `sealed` path) that runs the study with
`rankModes: ["negVol", "negBeta"]` against the live watchlist.

**Pre-registration (frozen before this run, per FOLLOWON_SPECS.md B3 and
MOMENTUM_SPEC.md §6):** same M5/M6 sealed harness as momentum, ranking variable swapped
to −trailing volatility (`negVol`) and −trailing BTC beta (`negBeta`), L=30d/H=7d
weekly rebalance defaults, holdout = time (last 4 rebalance dates) plus whole-symbol
(every stored symbol outside stable-13; 16 this run, identical set to PWR2's: ALGO,
APT, EOS, ETC, FIL, INJ, NEAR, POL, SUI, TAO, TIA, TRX, UNI, XMR, XTZ, ZEC). Universe
stable-13 (controlled/primary): [BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, DOT, LTC,
BCH, ATOM, XLM]. Gate is MOMENTUM_SPEC.md §6, applied identically: primary IC>0 with
train block-permutation p<0.05, else KILLED regardless of how the holdout reads.

**Result (`node momentum.mjs sealed-lowrisk`, live watchlist):**

| rank var | cell | D dates | rows | mean IC | block-perm p | 95% CI |
|---|---|---:|---:|---:|---:|---|
| negVol | train | 149 | 1721 | 0.0924 | 0.2278 | [0.0378, 0.1446] |
| negVol | recent holdout (4wk) | 4 | 52 | 0.0261 | 0.8691 | [0.0261, 0.0261] |
| negVol | **sealed whole-symbol holdout** | **78** | **982** | 0.0731 | 0.0509 | [-0.0270, 0.1571] |
| negBeta | train | 140 | 1606 | 0.0684 | 0.0579 | [0.0047, 0.1357] |
| negBeta | recent holdout (4wk) | 4 | 52 | 0.1332 | 0.8282 | [0.1332, 0.1332] |
| negBeta | **sealed whole-symbol holdout** | **71** | **865** | 0.0665 | 0.0709 | [-0.0014, 0.1416] |

Eligible whole-symbol holdout dates are non-zero for the first time (78 for negVol, 71
for negBeta) — the data-gate cause of the original KILLED verdict is resolved, via the
same PWR1 backfill that unblocked PWR2.

**Net-of-cost economics (train leg, informational — train significance already decides
the verdict below):** negVol tercile net spread -0.0011 (gross 0.0026), top-3 net
+0.0041 / top-5 net +0.0020; negBeta tercile net spread +0.0003 (gross 0.0023), top-3
net +0.0043 / top-5 net +0.0047 — all small relative to the pre-registered ~0.9%
round-trip cost, and none change the verdict below since train significance already
fails.

**VERDICT: KILLED (unchanged, now decided on complete evidence for both ranking
variables).** The pre-committed gate (§6) requires primary IC>0 with block-permutation
p<0.05 **on train** before the holdout even counts. negVol train p=0.2278 (95% CI
[0.0378, 0.1446], clearing zero but not the p<0.05 bar) and negBeta train p=0.0579
(95% CI [0.0047, 0.1357], just above the 0.05 bar) both fail that gate. Both
whole-symbol holdouts read positive and borderline (negVol p=0.0509, negBeta
p=0.0709) — directionally consistent with train's weak positive point estimates, close
to but not under the 0.05 bar — but §6 checks the train gate first and independently;
neither ranking variable clears it, so both are killed on the train leg regardless of
the holdout's near-miss reading. This supersedes the "0 eligible holdout dates"
data-gate caveat in the entry above: the arm is now available for both variables and
reads a weak, non-significant positive, not missing.

**Size/liquidity control: not run this pass.** Same scope discipline as PWR2 (which
also did not re-run the liquidity control against real data) — `applySizeLiquidityControl`
is implemented and tested (`liquidityControls`/`liquidityControl` options on
`runSealedMomentumPanelStudy`), but this workspace has no dollar-volume/market-cap data
source wired up to feed it real inputs; supplying one would mean approximating "size"
from candle volume, which is a data-sourcing decision out of this item's scope. B3/B4's
"does it collapse to hold the majors" question stays open and untested, separate from
this update.

**Survivorship caveat (mandatory, applies to this update too):** same as PWR2 — the
universe (29 symbols via `loadWatchlist()`, deep-history-backfilled per PWR1) is
survivors-only, coins that delisted or died are absent, which weakens any positive
reading and makes the train-leg null, if anything, conservative evidence against a
robust edge rather than for one.

### Trade intensity: closed. 79× more data killed it.

The Executor caught a factual error in the Architect's assignment that turned out to
matter more than the assignment itself: **trade COUNT is available for all 20 pairs across
2023–2026.** Kraken's OHLCVT archive carries a real trades column and
`ingestKrakenOHLCVT` parses it — verified at 100% coverage on archive-only pairs (LTC, ADA,
LINK, DOT). Only `buyVol`/`sellVol`/`maxTrade` are genuinely zeroed, so *aggressor*
features remain BTC/ETH/SOL-2026-only, but intensity was never restricted at all.

That unlocked the decisive test without waiting for any backfill — 11,195 independent
non-overlapping samples instead of 142 (`intensityIC.mjs`):

| window | samples | IC (non-overlapping) | z | p (block) |
|---|---|---|---|---|
| 2023 | 3,045 | −0.0053 | −0.29 | 0.771 |
| 2024 | 3,476 | **+0.0142** | +0.84 | 0.475 |
| 2025-26 | 4,674 | −0.0066 | −0.45 | 0.615 |
| **ALL** | **11,195** | **−0.0027** | **−0.29** | **0.751** |

**The effect is zero, and its sign flips between regimes.** The −0.160 measured on 142
samples was noise, exactly as the borderline z=−1.90 warned it might be. Note the decile
spread still reads +0.418% (and "exceeds cost" in 2024) — with IC ≈ 0 and p = 0.475 that
is tail noise with no monotonic relationship behind it, and a reminder that a decile
spread alone proves nothing.

This also explains the Executor's filter result more simply than their own reading did:
filtering high-intensity entries didn't fail because the effect was economically small
relative to R variance — it failed because **there was no effect to capture.**

**The order-flow thread is now closed end to end.** Aggressor imbalance: statistically
real at 15m (p=0.003), economically worthless (1–6% of cost). Cumulative imbalance:
noise (p=0.309). Trade intensity: zero on a large sample. Big-print share: nothing
anywhere. The extended backfills running to 2026-01-01 are no longer needed for this
question — more months of 3 pairs was the wrong axis; more pairs was the right one, and
it was available the whole time.

**Methodological lesson worth keeping:** every borderline result this project has produced
(z = −1.90, p = 0.010, "clears cost") has died when given more independent data. The
pattern is consistent enough to treat as a prior: a signal that needs careful statistics to
look real is not real. The ones that matter announce themselves.

### Signal 3 classifier P5: KILLED — no sealed production evidence

The research-only classifier plumbing is complete: entry-time features are built from
`profileEntries` with fixed `tpR=4` labels; scaling and lambda selection are train-only;
whole-symbol and recent-time holdouts use refit permutation nulls; coefficients,
fixed-threshold precision/recall, and net-of-cost lift are reported. The hand-built
fixtures pass these mechanics, but fixture output is not market evidence.

No production classifier run with an eligible whole-symbol holdout, recent-time holdout,
at least 100 valid refit permutations, and explicit net returns was available in this
workspace. Therefore there is no defensible production train AUC, holdout AUC, gap,
permutation p-value, or economic lift to publish. The implementation returns
`unavailable` for tiny or single-class holdouts and never substitutes a favorable value.

**VERDICT: KILLED** — data-gated. No classifier edge is promoted without sealed holdout
AUC above its full refit permutation null (`p<0.05`) and positive economic lift after
costs. This is not evidence that a classifier is impossible; it is evidence that none
has been demonstrated here. Results remain conditional on the fixed exit label and the
survivors-only universe, with within-symbol correlation and class imbalance reported as
limitations.

### Signal 3 classifier P5 — UPDATE (PWR4, first sealed production run)

The data gate above is now closed: `node classifier.mjs sealed` was run against the live
watchlist (28 assets; `controlledUniverse` = STABLE_13 present = 13 symbols, whole-symbol
`symbolHoldoutUniverse` = 16 held-out symbols) with K=100 refit permutations, all 100
valid. `classifierOutcomeReport` (coefficients + threshold PR + net-of-cost economic lift,
`roundTripCost=0.009` matching the repo's standard round-trip cost) was newly wired into
the sealed CLI path (classifier.mjs) and computed via a non-permuted refit on the same
primary train/holdout split — this refit reproduced `trainAuc`/`holdoutAuc` exactly against
the already-completed permutation study before its coefficients/economics were trusted,
confirming the pipeline is deterministic. Full inputs+outputs saved to
`research-runs/*-classifier-sealed.json` and `*-classifier-sealed-outcome.json` (gitignored
local evidence, per researchlab.mjs convention; provenance recorded in each file).

**Primary (whole-symbol holdout, the powered arm per spec sec 3):** trainRows=7496,
holdoutRows=7580, positives train=1481/7496 (19.8%), holdout=1410/7580 (18.6%). trainAuc
0.5501, holdoutAuc 0.5249, gap 0.0253 (small — not memorizing train). Permutation null:
K=100, all 100 valid, exceedances=1, **p=0.0198** — the holdout AUC clears the pre-registered
`p<0.05` significance gate. selectedLambda=0.1, converged=true.

**Recent (secondary, per spec sec 3):** trainRows=6948, holdoutRows=548, positives
train=1404/6948 (20.2%), holdout=77/548 (14.1%). trainAuc 0.5505, holdoutAuc 0.5364, gap
0.0141. p=0.257 — not significant on its own (small holdout, 548 rows), but directionally
consistent with primary and not contradicting it.

**Economic lift net of cost (spec sec 4, the decisive second gate clause) — threshold=0.5,
roundTripCost=0.009:** of 7580 primary holdout rows, 3282 score >=0.5. selectedNet
(mean netR of those 3282, net of cost) = **-0.4616 R/trade**. baselineNet (mean netR of all
7580 holdout rows, net of cost) = -0.5178 R/trade. lift = **+0.0562 R/trade** — real and in
the direction the significant AUC predicts (the model-selected subset loses less than the
unfiltered population), but the selected subset is still deeply net-negative on its own:
-0.46R/trade, nowhere near profitable. This is exactly the failure mode spec sec 0/4
pre-registered as the trap to avoid ("a 0.53 AUC can be real and un-tradeable") — and it is
what happened: the AUC lift is real (p=0.0198) but does not survive cost.

**Coefficients (train-only, standardized, sign shows direction):** volRatio -0.060 (largest
magnitude), higherLow +0.052, biasHigh_bear -0.050, btcBias4h_bear -0.036, biasMid_bull
-0.035, displacement +0.034, atrPct -0.033, pdlDistPct -0.026, btcBias4h_bull +0.024,
rangePos +0.023, biasMid_bear +0.021, maDistPct +0.018, biasHigh_bull -0.014, btc4hRetPct
-0.014, stopPct -0.011, swept +0.008, pdhDistPct +0.007, fvg -0.007, roomR +0.004, rsi
+0.003. No single feature dominates; the combination is diffuse, consistent with the AUC
being only barely above 0.5. Threshold=0.5 precision/recall: train 0.222/0.540, holdout
0.200/0.465 (train and holdout close, no overfitting collapse; precision ~0.20 reflects the
~19% base rate more than genuine discrimination).

**VERDICT: KILLED**, on complete sealed evidence — supersedes the "no sealed production
evidence" data-gate above. The classifier clears spec sec 4's *first* gate clause
(`holdout AUC beats permutation null, p<0.05`) for the first time in this project across
momentum/low-vol/classifier — the AUC lift is statistically real, not noise. It fails the
*second*, required-AND clause (`the lift survives cost`): the model's own best subset of
holdout trades still nets -0.46R/trade after cost, essentially unchanged from the
population's -0.52R/trade. Per SIGNAL3_CLASSIFIER_SPEC.md sec 0/4, a real-but-unprofitable
AUC is exactly "the entry is empty" restated with more precision, not a smaller edge to
chase — the swing-low entry-quality question is closed, not softened, by this result. No
feature combination here is a harvest/FOLLOWON-Part-A candidate; the caveats already on
record (survivorship, `tpR=4`-conditional label, within-symbol correlation, class
imbalance) all still apply and none of them would flip this verdict if relaxed, since the
gap is ~0.46R/trade, not a rounding error.

### H11 funding gate — diagnosed: a total access ceiling, not a data-gate bug (2026-08-08)

H11 (`funding-gate-h11.mjs`) has produced `eligibleAssets: []` on every attempt since it was
staged (last run 2026-08-04). This looked like the same watchlist/history-length data-gate
PWR1 diagnosed and fixed for momentum/low-vol/classifier, so this item re-ran the same style
of diagnosis rather than assuming it. It is not the same problem.

**Instrumentation added first, not a blind re-run.** `runFundingGateH11` previously wrapped
its whole per-asset body in a bare `try { } catch { /* excluded, reported by coverage */ }`
that discarded the actual error — the comment claimed coverage reporting that didn't exist.
Added a `coverage` array (additive to `report.input`, one entry per watchlist symbol with
`included` and, when excluded, a precise `reason`: `insufficient-candle-history`,
`funding-history-short (X of Y days)`, or `funding-fetch-error: <message>`) and an injectable
`fetchFunding` parameter (defaults to the real `fetchBinanceFunding`, byte-identical when
omitted — same no-op-when-omitted pattern already used for `stopMode`/`atrStopK`/`maxHold`/
`entryGate`). This changes no trading/scoring logic and no other file; `eligibleAssets`,
`train`, `holdout`, and `promoted` are computed exactly as before. 4 new fixture tests
(`funding-gate-h11.test.mjs`) prove each coverage reason classifies correctly and that
inclusion is unchanged when both gates genuinely clear.

**Root cause, with the instrumented run against the live 29-symbol watchlist:** 28 of 29
assets fail with `funding-fetch-error: Request failed with status code 451` — Binance's
USD-M futures funding endpoint (`fapi.binance.com`, the only data source `fundinglib.mjs`
ever calls) returns HTTP 451 ("Service unavailable from a restricted location... Binance
terms 'b. Eligibility'") for *every* symbol from this environment's network, unconditionally.
Confirmed directly with a bare request (no repo code involved): same 451 on BTCUSDT and
ETHUSDT. This is a total, symbol-independent access block — nothing to do with `toBinancePerp`
symbol mapping (checked and correct: `XBT`→`BTCUSDT` etc.) or per-symbol funding history depth,
both of which the item's own task text anticipated as the likely causes and neither of which
is the actual one. The 1 remaining asset (`EOS`) fails on `insufficient-candle-history`, a
pre-existing, unrelated gap already noted in GRID-SIM's result (EOS's local candle history
stops 2025-06-30). **Zero of the 29 watchlist assets have ever reached the funding-history-depth
check** — the "0 eligible assets" result recorded 2026-08-04 was never actually testing
funding-history coverage; it was silently reporting a network access failure as if it were an
empty data set.

**Checked whether a narrow fix exists: no safe one does.** This repo already has a second,
independent, *working* on-chain funding data path — `derivatives.mjs`'s `fetchFundingRates()`
against Kraken's public `futures.kraken.com/derivatives/api/v3/historical-funding-rates`
(the same endpoint `funding.mjs`/`funding-study.mjs` already use successfully, per Q2's
precedent of reusing an existing validated fetch rather than the spec's literal one). Verified
directly it is reachable and returns real data for `PF_XBTUSD` (8804 rows, `result: "success"`).
But its earliest available point is **2025-08-06 — only ~367 days of history**, well under
this item's pre-registered `minHistoryDays=730`. The endpoint has no pagination/continuation
parameter beyond `symbol`; there is no way to request more history than Kraken publishes.
So swapping the data source would not be a narrow fix that clears the gate — it would still
produce 0 eligible assets (now via `funding-history-short`, ~367 of 730 days, for every
symbol, including majors), *unless* `minHistoryDays` were lowered, which this item's own
pre-registration explicitly forbids doing after seeing results. No safe, narrow, in-scope fix
exists that lets H11 clear its pre-registered gate today. OI/open-interest coverage was not
investigated further, per this item's own scope note (that is separate, later work if H11
ever clears on funding rate alone).

**VERDICT: DATA-GATED, honest non-verdict** — not promoted, not killed. This is a genuine
external data-availability ceiling on two independent fronts (Binance inaccessible from this
network; Kraken's own history too short for the pre-registered floor), not a bug, not a
watchlist gap PWR1-style, and not evidence against the underlying hypothesis (funding-rate
confirmation on `anticipate`) either way. `promoted` correctly reads `false` and the gate
clauses are correctly unmet, but treating that as a kill would overstate what was actually
tested — exactly the trap PWR1-4 were staged to avoid for the other three studies. Re-opening
this only makes sense if either (a) this environment gains non-geo-blocked access to Binance's
futures API, or (b) a funding-history source with genuine 730+-day depth becomes available;
neither is a code change to this repo.

### Short-term reversal B5: KILLED, but the first PRIMARY train-leg IC ever to clear §6 significance (2026-08-08)

FOLLOWON_SPECS.md Part B ends with a footnote never actually staged: short-lookback (L=3-5d)
cross-sectional reversal — "recent losers bounce" — is the same rank-IC machinery as momentum
(B1's ranking-variable parameterization, already shipped for negVol/negBeta), just at a much
shorter lookback and with an a priori **negative** expected sign. Never tested at L<14 before
(the existing exploratory grid's floor was L=14).

**A real harness gap, fixed first (additive, no-op when omitted).**
`runSealedMomentumPanelStudy`'s primary cell hardcoded `lookback`/`horizon` to
`buildMomentumPanel`'s defaults (30d/7d) — there was no way to ask it for L=3 without a new
harness. Added `primaryLookback`/`primaryHorizon` options (default 30/7, byte-identical to the
existing behavior when omitted — matching this project's established no-op-when-omitted
pattern for optional overrides), threaded into both primary-cell `buildMomentumPanel` calls
with `step` explicitly set to `horizon` (matching the exploratory grid's own convention). This
is a parameterization of the *existing* M5/M6 sealed harness, not a new one — PWR2/PWR3's
results are unaffected (two new regression tests confirm omitting the new options reproduces
the old output exactly, and that overriding them measurably changes the panel). Also added
`primaryEconomics` (train-leg `economicMomentumViews` on the primary cell, previously only
computed for `byRank` cells) and a `node momentum.mjs sealed-reversal` CLI path.

**Pre-registration (frozen before this run, per FOLLOWON_SPECS.md's B5 footnote and
MOMENTUM_SPEC.md §6):** primary L=3d, secondary L=5d, H=L (rebalance = lookback, this
project's existing `step=horizon` convention), transform=raw (raw price reversal, not
market-neutral residual — the footnote frames this as "same harness... with a sign flip",
not a residual-adjusted variant), rank='return', universe stable-13 (train) /
PWR1-backfilled watchlist-minus-stable-13 (whole-symbol sealed holdout, same split PWR2/PWR3
used). Two-stage gate, same as M7/B4: train block-permutation p<0.05 required before the
holdout counts at all — and a **positive** train IC here falsifies the reversal hypothesis
rather than confirming it (expected sign is negative). Net-of-cost economics reported
regardless of significance, via the existing `economicMomentumViews`, at both this project's
long-standing 0.9% round-trip assumption and (since FEE-SCHEDULE-REBASE closed the same day)
the corrected real Kraken Tier-1 cost of ~1.7%, stated explicitly as recommended by that item's
own note.

**A sign-direction subtlety, surfaced rather than glossed over.** `economicMomentumViews`
ranks by *highest* `trailR` and reports that side's forward return — a momentum-direction
convention. For a *negative*-IC (reversal) result, the economically-correct trade is the
opposite side (long recent losers, i.e. *lowest* `trailR`). Reported both: `primaryEconomics`
(the raw top-trailR/momentum-direction reading, for direct comparability with every other
economics table in this project) and `reversalEconomics`/`reversalEconomicsRealCost` (the same
function, same train rows, `trailR` sign-negated so "top of the ranking" = lowest raw
return — the actual reversal trade), at both cost assumptions. No new statistical machinery:
same `economicMomentumViews` call, sign-flipped input.

**Result (`node momentum.mjs sealed-reversal`, live watchlist, stable-13 train / 16-symbol
whole-symbol holdout — same split PWR2/PWR3 used):**

| L | cell | D dates | rows | mean IC | block-perm p | 95% CI |
|---|---|---:|---:|---:|---:|---|
| 3 | train | 361 | 4191 | **-0.0685** | **0.0010** | [-0.1028, -0.0351] |
| 3 | recent holdout (4wk) | 4 | 52 | -0.3668 | 0.2657 | [-0.3668, -0.3668] |
| 3 | **sealed whole-symbol holdout** | **206** | **2553** | -0.0416 | 0.1049 | [-0.0855, 0.0053] |
| 5 | train | 215 | 2493 | -0.0272 | 0.4226 | [-0.0747, 0.0140] |
| 5 | recent holdout (4wk) | 4 | 52 | -0.0495 | 0.7982 | [-0.0495, -0.0495] |
| 5 | sealed whole-symbol holdout | 125 | 1543 | -0.0872 | 0.0080 | [-0.1504, -0.0144] |

**L=3 clears the pre-registered train significance gate — the first time any primary-cell IC
in this project has (§6's train clause).** Sign is correctly negative (as pre-registered;
had it come back positive, that would have falsified the hypothesis outright) with
train p=0.0010, well under 0.05. The whole-symbol sealed holdout is same-sign (-0.0416) with
an overlapping CI (train [-0.1028,-0.0351] vs holdout [-0.0855,0.0053]) — §6 clause 2 ("same
sign with overlapping-CI magnitude on the sealed holdout") reads as satisfied, even though the
holdout's own p=0.1049 doesn't independently clear 0.05. Negative sign holds in every train
regime (bull -0.067, bear -0.053, flat -0.170, unknown -0.061 — present well beyond just the
non-bear regime §6 clause 4 requires) and the L=5 neighbor is same-signed though not
independently significant (train p=0.4226) — directionally consistent, not a lone grid cell,
though weaker. **L=5 itself is KILLED on the train leg alone**, same two-stage discipline as
M7/B4: train p=0.4226 fails §6's train-significance clause, so its own whole-symbol holdout
(p=0.0080, actually significant) does not get to count — pre-registration checks train first,
independent of how holdout reads.

### CLASSIFIER-FUNDING-FEATURE: btcFundingRate added to the P5 classifier — KILLED, stronger AUC, same cost failure

Adds Kraken PF_XBTUSD funding rate as a 21st continuous covariate in Classifier P5's fitted
logistic regression (`CLASSIFIER_COLUMNS`), broadcast to every symbol's row as market-context
(same convention as the existing `btc4hRetPct`/`btcBias4h_*` columns), joined via a per-symbol
`fundingAsOf` cursor (`attachFundingFeature`, classifier.mjs) so an out-of-time-order symbol in
the watchlist loop can never inherit a stale rate from a different symbol's already-advanced
pointer. Not a duplicate of H11 (a hard universal funding threshold *gate*, DATA-GATED/
Binance-451) or funding-study.mjs (a BTC-only portfolio *cash rule*) — this is one more fitted
covariate inside the same statistical object P5 already tested.

**Pre-registered coverage restriction, honored exactly as written.** Kraken's PF_XBTUSD
historical-funding cache covers 2025-07-27T08:00Z onward (~367 days) against candle history
back to 2023-01-01 (~1306 days). `record.t` for rows before the funding series starts is never
zero-filled or defaulted — `attachFundingFeature` leaves `btcFundingRate: null` on those rows
(proven by a dedicated fixture in classifier.test.mjs), and the sealed CLI path
(`classifier.mjs sealed-funding`) filters the whole-watchlist row set down to
`row.t >= coverageStartSec` *before* any scoring, not after. Of 15076 rows built across the
full 29-asset watchlist, 3969 fall inside the funding-covered window and were the only ones
used.

**Primary (whole-symbol holdout, 13 controlled / 16 held-out, same STABLE_13 split as P5):**
trainRows=1806, holdoutRows=2163, positives train=310/1806 (17.2%), holdout=396/2163 (18.3%).
trainAuc 0.6274, holdoutAuc 0.5943, gap 0.0332 (still small — not memorizing train, if wider
than P5's 0.0253). Permutation null: K=100, all 100 valid, exceedances=0, **p=0.0099** — clears
the pre-registered `p<0.05` gate more decisively than P5's own p=0.0198. selectedLambda=0.1,
converged=true.

**Recent (secondary):** trainRows=1258, holdoutRows=548, positives train=233/1258 (18.5%),
holdout=77/548 (14.1%). trainAuc 0.6192, holdoutAuc 0.6236, gap -0.0044 (holdout slightly beats
train — no overfitting). K=100, all 100 valid, exceedances=1, **p=0.0198** — also significant,
a new result: P5's recent arm was not (p=0.257). Both sealed holdouts independently clear
`p<0.05` here, not just the powered primary arm.

**Economic lift net of cost (the decisive second gate clause) — threshold=0.5, reported at
both the repo's long-standing 0.009 cost and FEE-SCHEDULE-REBASE's corrected real ~0.017 cost,
side by side, per that item's own note:** of 2163 primary holdout rows, 737 score >=0.5.
selectedNet = **-0.2412 R/trade** (0.009 cost) / **-0.2492 R/trade** (0.017 cost). baselineNet
= -0.5387 R/trade (0.009) / -0.5467 R/trade (0.017). lift = **+0.2975 R/trade** at either cost
(a per-trade constant cancels in the lift difference). Directly against P5's own numbers
(holdoutAuc 0.5249, p=0.0198, selectedNet -0.4616R, baselineNet -0.5178R, lift +0.0562R): both
the AUC lift and the economic lift are markedly stronger with funding included, and the
model's best-scoring subset loses about half as much as P5's did. It is still **deeply
net-negative on its own** — -0.24 to -0.25 R/trade, nowhere near profitable — the exact
spec sec 0/4 trap ("a significant AUC can be real and un-tradeable") repeating a third time in
this project (after Classifier P5 and B5-REVERSAL), now on a strictly stronger version of the
same classifier.

**Coefficients (train-only, standardized):** maDistPct +0.156 (largest), **btcFundingRate
-0.137 (2nd largest magnitude of 21 features)**, displacement +0.126, pdlDistPct -0.080,
btc4hRetPct -0.078, btcBias4h_bull +0.074/btcBias4h_bear -0.074, volRatio -0.070, fvg -0.058,
swept -0.054, roomR -0.038, pdhDistPct +0.037, higherLow -0.034, rsi -0.031, stopPct -0.029,
rangePos +0.028, atrPct -0.020, biasMid_bear +0.008/biasMid_bull -0.008, biasHigh_bear
-0.003/biasHigh_bull +0.003. Funding is not a diffuse also-ran: its standardized coefficient
is the second-largest in the model, negative-signed — higher relative BTC funding (more
crowded/expensive leveraged longs) predicts a lower win probability at entry, an economically
sensible direction (an overheated funding regime is more likely to mean-revert against a fresh
long), not an arbitrary sign. Threshold=0.5 precision/recall: train 0.237/0.619, holdout
0.244/0.455 (precision stable train-to-holdout; recall drops, a real but partial
generalization gap, smaller than the AUC gap alone would suggest).

**VERDICT: KILLED**, on complete sealed evidence, under the exact P5 gate (both clauses
required, AND). It clears the *first* clause (`holdout AUC beats permutation null, p<0.05`)
more decisively than any classifier run in this project to date, on both the primary and
(newly) the recent arm. It fails the *second*, required clause (`the lift survives cost`):
the model's own best-scoring subset still nets -0.24 to -0.25 R/trade after cost. Funding is
a real, interpretable, second-most-important feature — it measurably strengthens the
classifier's statistical signal without meaningfully changing the verdict. No feature
combination tested in this project (price-technical alone, or price-technical plus funding)
has produced a classifier whose best-scoring subset is profitable net of cost.

**Net-of-cost economics (train leg) — §6 clause 3, all figures net of turnover×cost:**

| L | reading | 0.9% cost tercile net | top-3 net | top-5 net | 1.7% (real) cost tercile net | top-3 net | top-5 net |
|---|---|---:|---:|---:|---:|---:|---:|
| 3 | momentum-direction (`primaryEconomics`, top-trailR) | -0.0179 | -0.0046 | -0.0030 | — | — | — |
| 3 | **reversal-direction** (long lowest-trailR) | -0.0088 | -0.0007 | **+0.0001** | **-0.0207** | **-0.0069** | **-0.0046** |
| 5 | reversal-direction | -0.0127 | +0.0013 | +0.0023 | **-0.0243** | **-0.0050** | **-0.0025** |

At this project's long-standing 0.9% cost assumption, L=3's reversal-direction economics are a
mixed bag — tercile and top-3 net negative, top-5 net **+0.00012** (essentially zero,
statistically indistinguishable from breakeven, not a number anyone should trade real capital
on) — genuinely the closest any quantile spread in this project has come to clearing §6 clause
3. That ambiguity resolves cleanly once FEE-SCHEDULE-REBASE's corrected real Kraken Tier-1 cost
(~1.7% round-trip, roughly double the 0.9% this project had been assuming) is substituted, per
that item's own note to use the corrected figure once available: every reading, both
lookbacks, both selection widths, goes decisively negative (-0.0025 to -0.0243). Turnover here
is high (59-78% per 3-5 day rebalance) precisely because the signal is short-horizon by
construction, which is exactly what makes it this cost-sensitive.

**VERDICT: KILLED for both L=3 and L=5**, under §6 (PASS requires ALL four clauses; KILLED
needs only one to fail). L=3 clears the train-significance clause (a first for this project)
and the sealed-holdout sign/CI-overlap clause, but fails clause 3 (net economics) decisively
once priced at this project's actual real trading cost — the same "real signal, dead on
arrival at cost" pattern Classifier P5 already established, now confirmed a second time on a
completely different information source (short-horizon cross-sectional reversal vs P5's
fitted multi-feature classifier). L=5 is killed independently on the train leg alone,
regardless of its holdout reading. Closes FOLLOWON_SPECS.md Part B's one remaining unstaged
footnote.

### FEE-BUFFER-REVIEW: the breakeven-lock buffer is undersized against the real round-trip cost (2026-08-08)

Diagnostic follow-up from FEE-DEFAULTS-UPDATE, which corrected `FEE_RATE` (0.004→0.008)
and `FEE_BUFFER_PCT`'s comment to the real, verified ~1.6-1.7% round-trip taker cost
(FEE-SCHEDULE-REBASE, TOURNAMENT_ROADMAP.md) but deliberately left `FEE_BUFFER_PCT` itself
(0.01, i.e. 1%) unchanged since a value change affects live stop placement. This item
answers the question that raised: is 1% still enough headroom.

**Mechanism.** `monitor.js` (~line 657) and `intensityfilter.mjs` (~line 136, research-only
mirror of the same formula) both compute the breakeven-lock stop as
`entry + max(BE_LOCK_R * risk, FEE_BUFFER_PCT * entry)`, `BE_LOCK_R = 0.2`. Whichever term
is larger sets the new stop; `monitor.js` tells the user by chat message that "this trade
can no longer close at a loss" once it fires. That claim is only true if the chosen
offset is actually ≥ the real round-trip cost.

**Real round-trip cost, computed exactly (not the linear approximation).** With the now-
corrected `FEE_RATE=0.008` and `SLIPPAGE_PCT=0.0005` (both per side), a position bought at
`E` and sold at `X` is flat when `X*(1-FEE_RATE-SLIPPAGE_PCT) = E*(1+FEE_RATE+SLIPPAGE_PCT)`,
i.e. `X/E - 1 = (1+0.0085)/(1-0.0085) - 1 = 1.71465%`. (The simple `2*(FEE_RATE+SLIPPAGE_PCT)
= 1.70%` linear estimate used elsewhere in this repo's comments undershoots the exact figure
by about 0.015 percentage points — a rounding note, not the main finding.)

**How often does each term of the `max()` actually bind, on real data?** Replayed
`strategy.js`'s exact swing-pivot logic (`detectSwings`, the same function `entrySignal`
uses) against every symbol's real candle history (all three live timeframes, 1h/4h/1d),
gated through the live `MIN_STOP_PCT`/`MAX_STOP_PCT_BY_TF` bounds exactly as `scanner.js`
does at trade time — i.e. only signals the live bot would actually have accepted. n=162,690
accepted-signal instances across the full watchlist. Resulting `stopFrac` (risk/entry)
distribution: min 1.50% (the `MIN_STOP_PCT` floor), p10 1.69%, **p50 2.62%**, mean 2.86%,
p90 4.11%, max (near the `MAX_STOP_PCT_BY_TF` ceiling) 9.69%.

`BE_LOCK_R * risk` only reaches the real 1.71% breakeven line when `risk ≥ 1.71%/0.2 =
8.57%` of entry — i.e. only for wide-stop trades near the very top of the observed
distribution (near or above the `MAX_STOP_PCT_BY_TF` ceiling on any timeframe). Across the
162,690 sampled accepted signals, that held **0.4% of the time**. For the other **99.6%**,
`FEE_BUFFER_PCT * entry` is the binding term — meaning the buffer constant, not the R-based
term, is what almost every real trade's breakeven lock actually depends on.

**Verdict: FEE_BUFFER_PCT=0.01 is inadequate.** 1.00% vs the real 1.71465% needed is a
shortfall of ~0.71 percentage points. A position that locks in profit at the current
buffer and is later stopped out exactly at that level would realize a **net loss of about
0.71% of entry value**, the opposite of what the "can no longer close at a loss" chat
message promises — not a marginal miscalibration, since it is the binding term on
essentially every real trade, not an edge case.

**Recommended value: 0.018 (1.8%).** Exact breakeven (1.71465%) plus ~5% headroom, same
"plus margin" intent already stated in the existing code comment, rounded to a clean
constant. This is a proposed number, not applied in this item — routed to a follow-up
work-queue item (`FEE-BUFFER-UPDATE`) for the actual constant change, mirroring how
FEE-SCHEDULE-REBASE separated diagnosis from FEE-DEFAULTS-UPDATE's apply step. No verdict
elsewhere in this repo depends on `FEE_BUFFER_PCT` (it is a live risk-management parameter,
not a backtest cost input), so nothing here changes any existing PASS/KILL result.

Diagnostic script (`scripts/fee-buffer-diagnose.mjs`, read-only, no production file
touched) is left in the repo for reproducibility of the n=162,690 figure above.
