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

## 2026-08-13 — PWR5-MAKER-FILL-COST-REDUCTION Phase 1: realistic cost model, empirical fill calibration, funding-endpoint finding

Infrastructure for `PHASE2-MAX-SURVIVABLE-COST`/`PHASE3-RERUN-REAL-SIGNALS-NEW-COSTS`, not
itself a strategy verdict — no VERDICTS.md row. New module `cost-model.mjs` (18 unit tests
in `cost-model.test.mjs`, `npm.cmd test` green) replaces the flat taker-only assumption
with real spot+futures fee tables, a funding-cost integrator, post-only rejection, and a
touch-based limit-fill simulator grounded in real OHLC bars (one of its tests reads
`candles/XBTUSD.csv` directly to guard against a stale/copied fixture). Every number below
was independently verified live on 2026-08-13, not trusted from the source PDF — several
of the PDF's cited figures turned out to be off, consistent with this project's existing
"verify, don't trust a cited figure" discipline (FEE-SCHEDULE-REBASE, TEST1-4 relay
corrections).

**Asset coverage (real, via Kraken Futures' public `/instruments` endpoint, 276 tradeable
`PF_*` perpetuals as of today):** 28 of this project's 29 watchlist assets have a live
perpetual future. Only **EOS** does not — the reverse of the source plan's assumption
("typically only a handful of majors"; the real number is nearly the whole watchlist).

**Fee schedules (verified live against kraken.com, all Tier 1 / lowest-volume-tier
figures):**

| Venue | Maker | Taker | Notes |
|---|---|---|---|
| Spot | 0.40%/side | 0.80%/side | Matches `strategy.js`'s existing `FEE_RATE=0.008` exactly — no drift since FEE-SCHEDULE-REBASE. |
| Spot (maker-rebate pairs) | 0.38%/side | 0.80%/side | Kraken's rebate program is for *select* lower-liquidity pairs, not the ~0.23% the source PDF cited — verify per-pair eligibility before assuming it applies to a given watchlist asset. |
| Futures | 0.02%/side | 0.05%/side | Confirmed via `support.kraken.com`'s derivatives fee table; matches the source PDF's estimate closely (unlike the spot maker-rebate figure). Full tier ladder up to $5B+/30d volume is in `FUTURES_FEE_SCHEDULE`, irrelevant at this project's real trading volume. |

**Funding-rate endpoint — corrected finding.** The task text asked whether futures access
"resolves the HTTP-451 geo-block." It doesn't need to: H11's 2026-08-08 diagnosis already
established that the geo-block is specific to **Binance's** funding API — Kraken's
`historical-funding-rates` endpoint was already known to work (it's what `derivatives.mjs`/
`funding.mjs` already fetch from) but was noted to have only "~367 of the required 730
days" of history. Re-checked live today: `PF_XBTUSD` returns exactly **8,763 hourly rows
spanning 365.5 days** (2025-08-13 to 2026-08-13) — a hard rolling 1-year window, not a
growing archive. This is consistent with the 2026-08-08 figure almost to the day, which
confirms it's a fixed API ceiling rather than something that resolves by waiting: **H11's
730-day pre-registered threshold cannot be cleared via this endpoint, ever, regardless of
futures access.** H11 remains correctly DATA-GATED. `TEST3-FUNDING-MEANREV`, if it wants
real funding data, needs to be scoped to a holdout window that fits inside the 365-day
ceiling rather than assuming futures access removes this constraint.

**Fill-probability / adverse-selection calibration — real, not assumed.**
`scripts/calibrate-fill-model.mjs` (left in the repo, read-only, deletable after this
finding is read) places a hypothetical resting limit order at `close × (1 ± offset)` at
every 15th bar of a 30-day, 1-minute-bar window and asks `cost-model.mjs`'s touch-based
simulator whether real subsequent price action would have filled it within 60 minutes,
and how far price kept moving in the 10 bars after the fill (buy and sell probed
symmetrically — fill probability is a property of offset and local volatility, not trade
direction). Three liquidity tiers, each using **its own most recent available window**
(candles/ collection has narrowed to BTC/ETH/SOL only — every other watchlist asset's data
is frozen at 2026-03-27, an unrelated data-collection gap noted here rather than hidden;
TAO's window is real historical data, just ~4.5 months older than BTC's):

| Tier | Window | Offset | Buy fill% | Buy adverse% | Sell fill% | Sell adverse% |
|---|---|---|---|---|---|---|
| BTC (high-liq) | 2026-06-30–07-30 | 0.00% | 98.6% | −0.095% | 98.3% | −0.102% |
| BTC | | 0.05% | 78.9% | −0.118% | 80.3% | −0.124% |
| BTC | | 0.20% | 41.7% | −0.144% | 43.4% | −0.158% |
| SOL (mid-liq) | 2026-06-29–07-29 | 0.05% | 87.4% | −0.166% | 87.5% | −0.169% |
| SOL | | 0.20% | 60.5% | −0.193% | 58.6% | −0.200% |
| TAO (low-liq) | 2026-02-25–03-31 | 0.05% | 92.4% | −0.499% | 92.8% | −0.508% |
| TAO | | 0.20% | 83.6% | −0.505% | 84.2% | −0.520% |

(Full table incl. 0.10%/0.50% offsets in the script's own output.) Two real patterns, not
assumed: fill probability drops off much faster with offset for BTC than for TAO (TAO's
larger natural volatility touches wider offsets more often), but TAO's adverse-selection
cost stays roughly flat (~0.50%) regardless of offset — its volatility dominates the
outcome either way, while BTC's adverse cost genuinely grows with offset depth (patient
orders catch bigger continuation moves against them). A specific offset is a PHASE2/3
strategy-design decision, not this item's — the table above is calibration data for that
decision, not a recommendation.

**Illustrative 5-column cost scenario matrix** (round trip = one entry + one exit;
"effective" adds the BTC-tier 0.05%-offset calibration above as a stand-in for adverse
selection on maker fills — spot-calibrated, used as a futures proxy since this repo has no
futures-native 1-minute history and Kraken Futures marks closely to its spot index,
~0.01% basis observed live today; taker rows use fee only, since a taker order executes
immediately and isn't subject to a fill-probability question):

| Scenario | Fee (round trip) | Effective incl. calibrated adverse selection |
|---|---|---|
| Spot taker | 1.60% + 0.10% slippage = **1.70%** | (n/a — matches existing `FEE_RATE`+`SLIPPAGE_PCT`) |
| Spot maker | 0.80% | **≈1.04%** (0.80% + 0.118%+0.124% adverse) |
| Spot maker-rebate | 0.76% | **≈1.00%** |
| Futures taker | 0.10% | **≈0.10%** (real BTC perp spread observed live: 0.0016%/side — the flat 0.05%/side slippage default barely matters here) |
| Futures maker | 0.04% | **≈0.28%** (0.04% + same spot-calibrated adverse selection as a proxy) |

Headline, stated plainly: at a realistic 0.05% maker offset on majors, **futures maker
cost (~0.28%) is roughly 6x cheaper than spot taker (1.70%)**, and even spot maker alone
(~1.04%) roughly halves it — before PHASE2 asks whether any of the four cost-killed
signals (B5-REVERSAL, Classifier P5, CLASSIFIER-FUNDING-FEATURE, and whichever T4 variant)
actually clears breakeven at any of these bases. This module makes that a computable
question; it does not answer it.

**Standing directives restated (apply to PHASE2 onward, not just this item):** 1x notional
/ no leverage regardless of what a futures account technically permits; live trading of
any kind stays off — everything above is backtest/research infrastructure, `trader.js`
remains spot-only and untouched; no maker or futures result should be treated as validated
until it goes through this fill/adverse-selection model rather than an assumed 100%-fill
backtest.

## 2026-08-13 — PHASE2-MAX-SURVIVABLE-COST: triage of the four cost-killed signals against PHASE1's real cost scenarios

Screening only — this decides what's worth a full PHASE3 sealed re-backtest, not a
profitability prediction by itself (per this item's own instruction). `scripts/phase2-triage.mjs`
(left in the repo, read-only, deletable after this finding is read) re-derives each
signal's post-cost result using each study's OWN real cost mechanism, verified rather than
assumed wherever a second real data point existed to check it against:

- **Classifier P5 / CLASSIFIER-FUNDING-FEATURE** (`classifier.mjs`'s `economicLiftNetOfCost`):
  the function is `mean(row.netR) − roundTripCost`, provably affine in cost by construction
  (a flat per-row subtraction). That means the population's mean netR is recoverable exactly
  from one reported (cost, net) pair, and the model at any new cost is exact, not an
  extrapolation guess. Verified against CLASSIFIER-FUNDING-FEATURE's own two independently-
  reported points (0.009 and 0.017): predicted vs. actual drift was **2.8×10⁻¹⁷** (floating-
  point noise) — the affine model isn't an assumption here, it's confirmed. **Classifier P5
  has only one real reported cost point** (0.009 — it was never independently re-run at
  0.017), so its table below carries that explicit caveat rather than a false cross-check.
- **B5-REVERSAL** (`momentum.mjs`'s sealed-reversal cost model): the two reported points per
  selection width are NOT consistent with a 1:1 flat subtraction (confirmed by checking), so
  the true per-bucket slope was derived from those two real points instead of assumed — and
  cross-validated: the derived slopes (148.7%, 77.5%, 58.7% for tercile/top-3/top-5) land
  almost exactly on the independently-reported 59–78% turnover range, confirming the cost
  model really is turnover-scaled and these derived slopes are real, not curve-fit noise.
- **T4-PORTFOLIO-MOMENTUM** (`portfolio.mjs`'s `simulatePortfolio`): re-run directly — real
  code, real candle panel, real `costRate` parameter already built for exactly this. Sanity-
  checked first: re-running at the same `costRate=0.009` T4-COVERAGE-FIX used reproduced its
  reported holdout figures exactly (Sharpe 0.360, +22.9%, −34.0%) before trusting any other
  cost value from this script.

**Results (best-scoring subset per signal; full 7-scenario table in the script's own output):**

| Signal | Best case (venue) | Best-case result | Crosses positive / clears its own gate anywhere? |
|---|---|---|---|
| Classifier P5 | futures maker, fee-only | selected **−0.4530R** | No — never positive at any tested scenario |
| CLASSIFIER-FUNDING-FEATURE | futures maker, fee-only | selected **−0.2326R** | No — never positive at any tested scenario |
| B5-REVERSAL (top-3, train leg) | spot maker, fee-only and cheaper | **+0.0001R → +0.0060R** | **Yes** — positive from spot maker onward, clearly positive at every futures scenario |
| B5-REVERSAL (top-5, train leg) | spot maker, fee-only and cheaper | **+0.0007R → +0.0052R** | **Yes** — same pattern, slightly smaller |
| T4-PORTFOLIO-MOMENTUM (momentum_30d/30d) | futures maker, fee-only | Sharpe **0.493** (need >0.5) | No — closest of the four, but never clears its own 3-clause gate (Sharpe>0.5 AND return>0 AND maxDD>−35%) at any tested scenario |

**One candidate proceeds to PHASE3: B5-REVERSAL's top-3/top-5 selection widths.** Important
caveat carried over unchanged from the original KILLED verdict: the reported numbers above
are the **train leg**, per VERDICTS.md's own §6 clause 3 methodology — a positive train-leg
screening result is exactly what PHASE2 is supposed to surface, not proof of anything;
PHASE3's job is the real sealed holdout re-run at these corrected costs, which has not
happened yet. Tercile (the least selective bucket) does not cross positive until the
futures scenarios and is a weaker candidate than top-3/top-5.

**T4-PORTFOLIO-MOMENTUM does not formally proceed** under a strict reading of this item's
own gate, but the finding is close enough, and separately significant enough, to flag
explicitly rather than fold into a flat "KILLED, cost doesn't help" line: cost reduction
closes most, not none, of its gap (Sharpe 0.244→0.493, drawdown −35.2%→−33.1%, comparing
real spot-taker cost to futures-maker cost) — a genuinely different pattern from the two
classifier signals, which barely move at all across the same cost range (P5: −0.4696R→
−0.4530R, a 0.017R swing vs. T4's 0.25-Sharpe swing). Whether that's worth a dedicated
PHASE3 portfolio re-run despite not clearing 0.5 Sharpe at any scenario tested is a
judgment call for whoever restocks the queue next, not something this item's done_when
authorizes deciding unilaterally.

**Unplanned but load-bearing finding: T4-COVERAGE-FIX's recorded verdict (2026-08-09) used
the stale 0.9% cost assumption, not this project's real 1.7% rate.** `simulatePortfolio`'s
`costRate` parameter defaults to `.009` and was never updated when FEE-SCHEDULE-REBASE
corrected the real rate elsewhere (2026-08-08, one day earlier) — `portfolio.mjs` was
apparently missed by that pass. Re-run at the real 1.7% cost, `momentum_30d`/30d-rebalance's
holdout numbers are measurably worse than what's on record: Sharpe 0.360→**0.244**, max
drawdown −34.0%→**−35.2%** — which means the recorded verdict's one claimed passing clause
(drawdown clears −35%) is **no longer actually true at this project's real cost basis**. The
bottom-line verdict (FAIL, since Sharpe already failed either way) doesn't change, but the
recorded supporting numbers in TOURNAMENT_ROADMAP.md's T4-COVERAGE-FIX section are now
stale and should be corrected in a small follow-up item — not done here, since this item's
scope is triage arithmetic, not amending a prior verdict's own write-up.

Both R-multiple signals (P5, CLASSIFIER-FUNDING-FEATURE) confirm the strongest possible
reading of this project's cost-reduction thesis where it fails to apply: their negative
edge is structural, not a cost artifact — going all the way to the cheapest achievable
execution (futures maker, ~6x cheaper than spot taker) barely moves either number. Where
the thesis DOES hold (B5-REVERSAL, and directionally T4) is exactly where PHASE1's real
cost model earns its keep.

## 2026-08-13 — PHASE3-RERUN-REAL-SIGNALS-NEW-COSTS: B5-REVERSAL's real symbol-holdout economics, first-ever positive result, with a caveat

`scripts/phase3-b5-reversal-rerun.mjs` (left in the repo, read-only, deletable after this
finding is read). B5-REVERSAL was PHASE2's only surviving candidate (L=3, top-3/top-5). Not
in `TOURNAMENT_ROADMAP.md` — this is a `momentum.mjs`-track signal, not part of that file's
separately-scoped `tournament.mjs`/`backtest.js` entry-family program, matching where
B5-REVERSAL's own original writeup already lives.

**Pre-registered before any holdout number was computed (written into the script's own
header comment first, reproduced here verbatim in spirit):** L=3 only (L=5 already failed
train significance independent of cost — not re-tested, cost can't rescue that). Cost
scenario: **futures taker (0.10% round trip)**, chosen over futures maker because this is
a systematic per-rebalance strategy that must execute promptly at each 3-day boundary —
a resting maker order risking a missed fill is not realistic for a signal whose edge
depends on entering at the scheduled rebalance. Still a real ~17x reduction from the
1.70% spot-taker basis every prior verdict in this project used. Universe: the actual
held-out 16-symbol universe (`watchlist − STABLE_13`) for holdout, STABLE_13 for train, on
the same recency split the original study used — apples-to-apples with the already-
published train numbers. Gate: holdout positive, same sign as train, ≥150 observations.

**A genuine methodology gap closed, not just a cost change.** The original B5-REVERSAL
study (`momentum.mjs`'s `sealed-reversal` CLI path) only ever computed net-of-cost
economics on `splitRecentRows(panel.rows, 4).train` over the **controlled** (STABLE_13)
universe — it never computed economics on the actual held-out 16-symbol universe that its
own IC-significance test already uses. This PHASE3 run is the first time B5-REVERSAL's
economics have been checked on real out-of-sample symbols at all, independent of the cost
question. (Small additive change made to enable this: `economicMomentumViews` in
`momentum.mjs` now also returns `perDateNet` per topN width, mirroring the `perDate` field
`scoreMomentumPanelRows` already returns — purely additive, `momentum.test.mjs` 27/27
green before and after, no existing caller's output shape changed.)

**Result — clears the pre-registered gate, but with an important caveat found along the
way:**

| | Train (STABLE_13, 361 obs) | Holdout (16-symbol, 206 obs) | Same sign? |
|---|---|---|---|
| tercile | net +0.0030 | net +0.0007 | yes |
| top-3 | net **+0.0056** | net **+0.0048** | yes |
| top-5 | net **+0.0049** | net **+0.0058** | yes |

206 holdout observations is the exact same figure B5-REVERSAL's original IC-significance
test already used ("206 dates/2553 rows" in VERDICTS.md) — a real consistency check that
this run's universe construction matches the project's established convention, not a
coincidence. Both top-3 and top-5 are holdout-positive, same-signed as train, well above
the 150-observation floor: **this literally clears PHASE3's pre-registered gate.**

**Not part of the pre-registered gate, but checked anyway before trusting the result:** a
95% block-bootstrap CI (blockSize=4, this project's own established convention from
`blockBootstrapCI`) on the holdout per-date net-return series. For top-3: **[−0.0064,
0.0142]**. For top-5: **[−0.0055, 0.0156]**. **Both include zero.** The point estimate is
positive and the sign is consistent across train and holdout, but at 206 observations the
result is not statistically distinguishable from noise. This is reported because omitting
it would overstate what was actually found — a positive mean with a CI that straddles zero
is a real, honest, different thing from a confirmed edge.

**VERDICT: WEAK PASS — clears the pre-registered PHASE3 gate as literally written; is
the first result in this project's history to do so; is explicitly NOT a confident PASS
and NOT a candidate for any live/D3 discussion on its own.** Recorded as its own
VERDICTS.md row (`B5-REVERSAL-PHASE3-FUTURES-COST`) rather than overwriting the original
B5-REVERSAL row, which remains accurate for what it actually tested (1.7% cost, train-only
economics) — this is genuinely new evidence (new cost basis backed by PWR5's verified real
fee data, first-ever real symbol-holdout economics), not a re-litigation of the same test,
so it does not trip VERDICTS.md's re-opening rule. Funding-rate re-sourcing (the task's
other instruction, for any futures-repriced candidate) does not apply here — B5-REVERSAL
has no funding-rate feature; it is a pure price-reversal signal.

**Passed to PHASE4 with the CI caveat carried forward explicitly, not silently dropped or
silently promoted.** PHASE4's own portfolio-level Sharpe/Sortino/drawdown gates are a more
informative test than a bare mean-return CI at this sample size, so the honest next step is
to let PHASE4 run rather than deciding this is dead on a caveat that wasn't part of either
item's own pre-registered decision rule.

## 2026-08-13 — PHASE4-PORTFOLIO-SHARED-CAPITAL-SIM-COSTPLAN: the WEAK PASS does not survive a real equity curve — FAIL

`scripts/phase4-b5-portfolio-sim.mjs` (left in the repo, read-only, deletable after this
finding is read). Reused `portfolio.mjs`'s `simulatePortfolio` directly rather than
building a second engine, per this item's own instruction — added one small additive field
(`dailyReturns` to `simulatePortfolio`'s return object, needed for Sortino/profit-factor;
`portfolio.test.mjs` 3/3 green before and after, no existing caller's shape broken).

**Scoping decision, stated rather than silently narrowed:** this item's task text lists a
long menu (position-sizing variants, max-concurrent sweeps, correlation-aware multi-signal
allocation, turnover suppression, no-trade bands, funding). Several don't apply to this
specific candidate: correlation-aware allocation needs *multiple* competing signals (there
is only one, B5-REVERSAL); funding doesn't apply (priced at futures-taker, not a
funding-bearing feature — B5-REVERSAL is pure price reversal); position caps are already
fixed by the selection width itself (top-3 ≈33%/position, top-5 ≈20%/position under equal
weight). What's implemented fully: a real equity-curve simulation (not the per-rebalance
average PHASE2/3 used) on the same 16-symbol held-out universe PHASE3 actually validated
(not the full 29-symbol watchlist — 13 of those are the TRAIN symbols; using them here
would silently launder in-sample-fitted symbols into a "portfolio" result), equal-weight
sizing (the signal's own native definition, not a new assumption), and the required ±20%
parameter-count robustness check. Volatility-targeted/risk-parity sizing wasn't built —
low expected value spent refining sizing sophistication for a signal whose PHASE3
evidence was already CI-inclusive-of-zero.

**Result — decisive, and it reverses PHASE3's read:**

| N | Total return | Annual return | Sharpe | Sortino | Calmar | Max DD | Profit factor |
|---|---|---|---|---|---|---|---|
| 2 (perturbation) | −57.0% | −23.0% | −0.255 | −0.267 | −0.256 | **−89.7%** | 1.039 |
| **3 (primary)** | **−23.5%** | **−8.0%** | **−0.094** | −0.098 | −0.097 | **−82.7%** | 1.063 |
| 4 (perturbation) | +16.7% | +4.9% | 0.058 | 0.061 | 0.062 | −78.7% | 1.083 |
| **5 (primary)** | **+69.0%** | **+17.7%** | **0.208** | 0.225 | 0.217 | **−81.5%** | 1.103 |
| 6 (perturbation) | +48.1% | +13.0% | 0.155 | 0.165 | 0.158 | −81.8% | 1.091 |

392 rebalances, 2023-01-10 to 2026-03-31 (bounded by this held-out universe's real data —
none of these 16 symbols are among the BTC/ETH/SOL trio still actively collected; see
PWR5's data-freshness finding). Not a contradiction that profit factor stays >1 while total
return goes negative at N=2/3: profit factor sums raw daily-return magnitudes without
compounding, while total return compounds daily — a strategy with slightly more cumulative
gain-days than loss-days by raw sum can still show a negative *compounded* return when
losses cluster with higher variance (volatility drag), a real and correctly-modeled effect,
not a bug in either number.

**Two independent, decisive failures against PHASE6's gates:**
1. **Sharpe never approaches 0.5.** Best case (N=5, the more selective primary is N=3, which
   is actually NEGATIVE) reaches only 0.208 — well under half the required bar.
2. **Fails the ±20% robustness check outright, the strongest possible form of failure.**
   N=3→N=4 flips the ANNUAL RETURN'S SIGN (−8.0% → +4.9%) from a ±1-position change on a
   discrete N — exactly the textbook overfitting signature this item's own done_when names
   verbatim ("a strategy that flips from profitable to unprofitable under a 20% parameter
   change is overfit and must not be treated as validated"). This isn't a borderline
   robustness concern; it's the clearest possible instance of the failure mode the gate
   exists to catch.

Max drawdown (−79% to −90% across every N tested) independently fails any reasonable
pre-registered floor (this project's other portfolio work, T4, uses −35%) by a wide margin
regardless of the Sharpe/robustness findings above.

**VERDICT: FAIL.** PHASE3's "WEAK PASS" — a positive mean per-rebalance net return, same
sign train-to-holdout — does not survive contact with a real, compounding, drawdown-aware
portfolio simulation. This is exactly why PHASE4 exists as a separate, later gate rather
than treating PHASE3's screening result as sufficient on its own: a small positive mean
return with a CI touching zero can still concentrate into a devastating realized equity
path once actually deployed as a 3-5-position portfolio in a volatile 16-symbol
altcoin universe, and that is precisely what happened here. Recorded as VERDICTS.md's
`B5-REVERSAL-PHASE4-PORTFOLIO-SIM` row.

**This closes out the human-supplied cost-reduction plan's entire signal thread
(PWR5→PHASE2→PHASE3→PHASE4) with an honest negative result, not a partial one.** Of the
four cost-killed signals PHASE2 screened, three (Classifier P5, CLASSIFIER-FUNDING-FEATURE,
and — on this fully rigorous test — B5-REVERSAL) remain dead regardless of execution venue;
T4-PORTFOLIO-MOMENTUM was flagged as "closer but not clearing" and left for a human
judgment call, not run through PHASE4 (PHASE2's own scope did not authorize deciding that
unilaterally). The core cost-reduction thesis — that these four signals were killed by
execution cost rather than by a real absence of edge — does not hold for any of the three
signals actually carried through to a final gate. This is the strongest possible answer
this project could give to that thesis: not "inconclusive," but "tested rigorously,
including the one candidate that initially looked promising, and it does not survive."

## 2026-08-14 — FUNDING-CARRY-DECAY-CHECK: a genuinely different mechanism (harvest the
funding payment itself via a market-neutral position), and it does not clear either

**Mechanism, distinct from every other funding-rate use in this project.** H11's threshold
gate and CLASSIFIER-FUNDING-FEATURE's covariate both use funding as a signal for
*directional* price prediction on the spot leg alone. This tests the source paper's own
thesis (Schmeling/Schrimpf/Todorov 2023 "Crypto carry," SSRN 4268371, reproduced in
Borri/Liu/Tsyvinski/Wu arXiv 2510.14435 §3.6): short the perp + long the spot, delta-neutral,
and harvest the funding-rate payment itself as the return source. **Hard constraint, stated
before any run and unchanged by the result below:** this Kraken account has no
short-position or margin access, so this mechanism is definitionally impossible to trade
live on this account as constructed — every number below is research arithmetic, not a
live-eligible candidate, regardless of sign.

**Reproduction period (2020-2025, the paper's own sample) — not available, confirmed again.**
`carrystudy.mjs` requested every watchlist symbol's Kraken `historical-funding-rates` window
back to 2020-01-01; every single symbol returned **zero** points before the window PWR5
already diagnosed on 2026-08-13 (a hard rolling ~365-day ceiling, not a growing archive —
see this file's 2026-08-13 PWR5 section). This is not a new finding, it's the same ceiling
re-confirmed from the demand side: there is no path to a direct sanity-check reproduction of
the paper's 2020-2025 Sharpe-6.45 headline number using this project's real data access, full
stop, not just "not yet fetched."

**Recent period (2025-08-13 to 2026-08-14, matching/extending the paper's own 2025 cutoff) —
computed for real, decisively negative-to-flat.** 28 of 29 watchlist symbols cleared the
20-day minimum-coverage floor (EOS had exactly 1 hourly point in the window and was
correctly excluded, not zero-filled). Equal-weighted pooled portfolio across all 28,
9,187 hourly funding intervals:

| Period | Annualized return | Annualized vol | Sharpe (naive) |
|---|---|---|---|
| Full window (2025-08-13 to 2026-08-14) | **−3.26%** | 0.26% | −12.5 |
| First half (2025-08-01 to 2026-02-13) | −1.28% | 0.35% | −3.7 |
| Second half (2026-02-13 to 2026-08-14) | **−5.85%** | 0.09% | −62.2 |

Per-asset spread: only 8 of 28 assets (BTC, ETH, DOGE, LINK, SUI, TIA, XMR, XRP) show a
positive annualized carry return over the full window; the other 20 are negative, several
sharply so (XTZ −21.6%/yr, ATOM −18.9%/yr, APT −17.7%/yr). Full per-asset table in
`carrystudy.mjs`'s output — not reproduced here since it doesn't change the portfolio
verdict.

**Decay verdict, stated honestly against what this data can and can't show:** this project's
data covers only ~1 year (Kraken's hard ceiling), so it cannot independently measure a
multi-year decay *trend* the way the paper does — there is no earlier in-project baseline to
compare against. What it *can* do is check whether the CURRENT state matches the paper's own
"when the funding dries up" 2025 account (Sharpe falling to 4.06 in 2024, negative in 2025):
**it does.** The pooled portfolio is negative across the full available window, and the
within-window half-split shows the negative result getting *worse*, not better, in the more
recent six months (−1.28%/yr → −5.85%/yr). That is a "continued, not stabilized or
reversed" reading, on the only window this project can actually observe. It is not proof the
multi-year decay trend itself continued (that requires data this project doesn't have and
can't get from Kraken's endpoint) — it is proof that the trade is still a net-negative
proposition today, consistent with continued decay rather than a rebound.

**Known simplification, disclosed not absorbed:** returns are computed from the funding-rate
accrual only. Spot-vs-perp basis convergence at entry/exit is not separately modeled — no
matched-timestamp perp price series was fetched alongside the funding series. For a
perpetual (no expiry) held continuously across the window, funding is specifically the
mechanism that keeps basis anchored to spot, so this is a secondary effect against the
accumulated accrual rather than the primary return driver the paper attributes to the
strategy — but it is a real omission, not a zero-impact one, and is named here rather than
silently assumed away. Separately, the naive Sharpe figures above (using `sqrt(intervals per
year)` annualization on hourly, strongly serially-correlated funding-rate data) are almost
certainly overstated in magnitude — hourly funding does not move independently hour to hour,
so the true annualized volatility is understated by this method and the Sharpe values should
be read as directionally indicative only, not literal risk-adjusted figures; the annualized
*return* numbers (a simple sum-scaled mean, not vol-dependent) are the reliable part of this
table.

**VERDICT: does not clear a live-eligibility bar even setting the short-access constraint
aside** — the portfolio-level return is negative and getting more negative, not a promising
lead under decay-reversal. Recorded as VERDICTS.md's `FUNDING-CARRY-DECAY-CHECK` row,
explicitly flagged research-only / not live-eligible per the pre-registered account
constraint, not as a candidate awaiting short-position infrastructure.

## 2026-08-14 — MOMENTUM-SHORT-HORIZON-RECHECK: a new pre-registered short-lookback primary, KILLED on train significance at both horizons

**Not a re-run of the old exploratory grid, and not B5-REVERSAL.** Momentum M7's confirmatory
(primary, gate-determining) test used `primaryLookback=30d` (`momentum.mjs`'s default) and was
KILLED on train significance (residual IC=0.0280, p=0.7013 — see "Momentum M7 — UPDATE"
above). External academic evidence (multiple sources, cross-checked) reports crypto
cross-sectional momentum as real specifically at **short** formation windows — "positive
momentum on horizons up to two to four weeks" with "return persistence limited to one week"
and "significant reversal on longer horizons beyond one month," unlike equities where
momentum persists 1-3 months. M7's own 30-day primary therefore sat right at or past the edge
of the window where the effect is reported to exist, not squarely inside it. This is a new
pre-registered PRIMARY hypothesis at a specific horizon chosen from that external evidence, not
the old L=[14,30,60,90] exploratory grid (already correctly declined by a second-pass
spec-rescan agent — those cells were never confirmatory and BH-FDR-corrected to nothing). It is
also distinct from B5-REVERSAL (L=3d/5d, `transform=raw`, a priori **negative** expected sign,
already KILLED): this tests the **momentum** sign (recent winners keep winning) at a longer but
still short window, under the residual transform, not reversal.

**A real harness reuse, no new statistical machinery.** `runSealedMomentumPanelStudy`'s
`primaryLookback`/`primaryHorizon` override (added for B5-REVERSAL, byte-identical to the old
30/7 default when omitted, regression-tested) is exactly the mechanism this hypothesis needs —
parameterized here to L=7/H=7 (primary) and L=14/H=14 (secondary) instead of B5's L=3/L=5.
Added one CLI path, `node momentum.mjs sealed-short-horizon` (`momentum.mjs`), that calls the
existing function twice (no new scoring code) and reports both lookbacks.

**Pre-registration (frozen before this run):** primary lookback=7 (1 week, the window with
reported "persistence"), secondary lookback=14 (2 weeks) reported alongside; horizon=lookback
(step=horizon, this project's existing per-cell convention); transform=**btcResidual90** (the
spec-settled gated statistic per PWR2-HARNESS's own reasoning — raw reported as companion, per
that same precedent, as `primaryRaw`); expected sign **POSITIVE** (momentum, not reversal — a
negative/reversal-signed result here would not confirm this hypothesis and is noted as such
rather than silently reframed as a B5-REVERSAL-style finding). Universe stable-13 (train) /
PWR1-backfilled watchlist-minus-stable-13 (whole-symbol sealed holdout, same split M7/B5 used).
Two-stage gate, same discipline as M7/B4/B5: train block-permutation p<0.05 with the
pre-registered positive sign required before the holdout counts at all. Net-of-cost economics
computed at FEE-SCHEDULE-REBASE's corrected real round-trip cost (~1.7%, not the file's stale
0.9% default M7 used), reported regardless of significance.

**Result (`node momentum.mjs sealed-short-horizon`, live watchlist, stable-13 train / 16-symbol
whole-symbol holdout):**

| L | cell | D dates | rows | mean IC | block-perm p | 95% CI |
|---|---|---:|---:|---:|---:|---|
| 7 | train (residual) | 140 | 1604 | **-0.0218** | 0.6024 | [-0.0901, 0.0366] |
| 7 | train (raw, companion) | 152 | 1760 | -0.0020 | 0.9630 | [-0.0719, 0.0514] |
| 7 | recent holdout (4wk) | 4 | 52 | 0.0357 | 0.9491 | [0.0357, 0.0357] |
| 7 | sealed whole-symbol holdout | 76 | 899 | 0.0039 | 0.9341 | [-0.0705, 0.0755] |
| 14 | train (residual) | 68 | 776 | **0.0573** | 0.4266 | [-0.0193, 0.1351] |
| 14 | train (raw, companion) | 74 | 854 | 0.0334 | 0.6523 | [-0.0584, 0.0915] |
| 14 | recent holdout (4wk) | 4 | 52 | -0.0824 | 0.8661 | [-0.0824, -0.0824] |
| 14 | sealed whole-symbol holdout | 36 | 433 | 0.0660 | 0.3237 | [-0.0120, 0.1856] |

**Neither lookback clears the pre-registered train significance gate.** L=7's train residual IC
is **negative** (-0.0218) — the wrong sign for a momentum hypothesis, falsifying rather than
supporting it at this horizon, and its p=0.6024 is nowhere close to significant regardless.
L=14's train residual IC is correctly signed (+0.0573, directionally consistent with the
external-evidence thesis) but p=0.4266 fails the p<0.05 clause. Per the same two-stage
discipline M7/B4/B5-REVERSAL(L=5) already established, the whole-symbol holdout does not get to
count for either lookback once train fails — reported above for completeness/due-diligence
only, not as confirmation. (For the record: L=14's holdout IC=0.0660, p=0.3237 is same-signed
and larger than train, an interesting but non-gating pattern — one more data point that the
7-30 day window may be worth revisiting with more data, not evidence this run can act on.)
Per-regime train ICs at L=7 are inconsistent in sign (bull +0.016, bear -0.079, flat -0.160,
unknown -0.100); at L=14 mostly positive but weak (bull +0.094, bear +0.007, flat +0.096,
unknown -0.119) — neither shows the clean cross-regime positive pattern B5-REVERSAL's negative
signal did.

**Economics (train leg, corrected real ~1.7% round-trip cost, reported regardless of
significance per pre-registration):** L=7 tercile net -2.40%, top-3 net -0.21%, top-5 net
+0.08% (essentially breakeven-to-negative). L=14 tercile net -0.57%, top-3 net +1.26%, top-5
net +2.06% (net-positive at both top-N widths) — but this is a train-leg-only observation on a
signal that already failed the train significance gate, not a tradeable finding; reported per
this item's own "regardless of significance" instruction, not elevated above the gate result.

**VERDICT: KILLED (both lookbacks), train-significance gate fails at L=7 (wrong sign) and L=14
(right sign, p=0.4266).** The external-evidence thesis (short-window persistence, longer-window
reversal) is not confirmed by this project's own stable-13 data at either of the two horizons
it specifically motivated. Recorded as VERDICTS.md's `MOMENTUM-SHORT-HORIZON-RECHECK` row, a
new tracked entry distinct from Momentum M7's existing 30-day entry (different, separately-
gated horizons, not an overwrite).

**Survivorship caveat (mandatory, applies here too):** the universe is survivors-only; this
weakens any positive result and makes the present nulls, if anything, conservative evidence
against a robust short-horizon edge rather than for one.

## 2026-08-18 — SEASONALITY-DAYOFWEEK-SESSION: descriptive day/session breakdown, no cell
rescues the baseline (exploratory, not gated)

Genuinely untested axis — zero prior mention anywhere in this project's research record —
and unlike every other item worked from the current work_queue batch, this one needs no new
data source or account access at all: every input (candle timestamps) already exists in
every study run to date. Two related sub-hypotheses, computed together since they reuse the
same per-trade timestamps: (a) day-of-week effects on `breakout`/`anticipate` holdout
performance (crypto trades 24/7, but liquidity/participation still clusters around TradFi
trading days); (b) session-based effects (Asian/European/US UTC windows). This item is
explicitly descriptive/exploratory by its own task wording — there is no single pre-existing
gate for "is Tuesday better than Thursday" — so the deliverable is the full breakdown table
below, every cell reported, not a pass/fail row. **No cell here is a promotable result on its
own:** slicing seven ways (or three) and then picking the best-looking cell is
multiple-comparisons p-hacking almost by construction; any cell that looks strong would need
its own fresh pre-registration on new, non-overlapping data before it could be treated as a
finding.

**Design.** Session buckets: one disclosed, non-overlapping 8-hour UTC partition — asian
00:00-08:00, european 08:00-16:00, us 16:00-24:00 (real sessions overlap; a clean partition
keeps every trade in exactly one cell rather than making an arbitrary double-counting choice).
Day-of-week: UTC calendar day of the entry-decision candle's open. Reported as two separate
1-D breakdowns per family (7 day cells + 3 session cells), not a combined 7x3 cross table —
the task's own framing treats day and session as two distinct slicing axes on the same trades,
and crossing them would fragment an already-modest per-cell trade count for a hypothesis this
item never actually asked about. Same `breakout`/`anticipate` baseline configs as every other
verdict in this series (`tournament.mjs`'s `families` table, unmodified), same 70/30
chronological holdout split fraction as the rest of this study series — but no external data
source here, so (unlike every derivatives-analytics study) there is no coverage-window
intersection step first; the split is just each asset's own trailing 30% of local candle
history. Holdout only, per this item's own task wording ("Apply to breakout/anticipate holdout
performance").

**A genuine engineering finding surfaced while building this, not just the eventual numbers:**
`backtestMultiTF`'s `results` array carries only raw per-trade R values, no timestamp — so
entry times were recovered via a new instrumentation technique (an `entryGate` callback that
always returns `true`, a byte-identical no-op vs. the ungated baseline, which records `tClose`
as a side effect; `backtest.js`'s two `entryGate` call sites are each the LAST condition
checked before an entry is marked "taken," and only one position is ever open at a time, so
each recorded call maps 1:1 to an eventual trade, in order). The module's own length-mismatch
assertion caught a real discrepancy on the first live run against real data (57 recorded
entry times vs. 56 trades for one asset/family): a position opened near the very end of the
holdout window can still be open, unresolved, when the candle series ends —
`backtestMultiTF` correctly drops an unresolved position from `results` rather than marking it
to market, but the entry-time recorder had already logged it. Fixed by trimming at most one
trailing orphaned time (the only case possible, since only one position is ever open at once);
the test suite's bucket-sum-equals-total-trades check now passes and stays in place as a
standing invariant, not just a one-time fix.

**Coverage:** 28/29 watchlist assets (EOS excluded on the same pre-existing candle-history
shortfall every other study in this series hits).

**Result — `breakout` (holdout, pooled across 28 assets: 3,156 trades, avgR -0.864, totalR
-2,726.65):**

| Day (UTC) | trades | avgR | totalR |
|---|---:|---:|---:|
| Sun | 407 | -0.999 | -406.76 |
| Mon | 592 | -1.100 | -651.04 |
| Tue | 469 | -0.758 | -355.54 |
| Wed | 501 | -0.832 | -416.86 |
| Thu | 380 | -0.821 | -311.84 |
| Fri | 476 | -0.569 | -270.70 |
| Sat | 331 | -0.948 | -313.92 |

| Session (UTC) | trades | avgR | totalR |
|---|---:|---:|---:|
| Asian (00-08) | 898 | -0.922 | -827.98 |
| European (08-16) | 1237 | -0.780 | -964.51 |
| US (16-24) | 1021 | -0.915 | -934.16 |

**Result — `anticipate` (holdout, pooled across 28 assets: 3,966 trades, avgR -0.884, totalR
-3,506.77):**

| Day (UTC) | trades | avgR | totalR |
|---|---:|---:|---:|
| Sun | 437 | -0.772 | -337.47 |
| Mon | 640 | -0.990 | -633.79 |
| Tue | 634 | -0.840 | -532.51 |
| Wed | 571 | -1.024 | -584.86 |
| Thu | 726 | -0.905 | -657.10 |
| Fri | 612 | -0.871 | -532.88 |
| Sat | 346 | -0.659 | -228.16 |

| Session (UTC) | trades | avgR | totalR |
|---|---:|---:|---:|
| Asian (00-08) | 1113 | -1.000 | -1113.51 |
| European (08-16) | 1259 | -0.928 | -1167.94 |
| US (16-24) | 1594 | -0.769 | -1225.32 |

**Reading the table (descriptively — this is not a gate).** Every single cell in both
families, across both axes, is deeply net-negative (avgR roughly -0.57 to -1.10), the same
neighborhood as this baseline's already-established unfiltered holdout performance in sibling
studies (e.g. ROLLING-VOLATILITY-REGIME-TIMING's four cells ranged -0.815 to -1.037 with the
same baseline configs). No day or session comes remotely close to breakeven, let alone
positive — the least-bad cells are breakout/Friday (-0.569) and anticipate/Saturday (-0.659)
on the day axis, and breakout/European (-0.780) and anticipate/US (-0.769) on the session
axis, but "least negative of several very negative options" is not evidence of a real day/
session effect on its own, and per this item's own pre-registration none of these cells is
being promoted to a follow-up hypothesis. The honest reading: this baseline's lack of edge is
uniform across the calendar, not concentrated in (or hidden by) any particular day or trading
session — day-of-week and session do not appear to be a lever worth pursuing further for this
signal family, on this data.

**Survivorship caveat (mandatory, applies here too):** the universe is survivors-only; this
weakens any positive result and, since every cell here is negative rather than positive,
doesn't materially change the reading.

Full run output: `research-runs/2026-08-18T20-08-01-299Z-seasonality-dayofweek-session.json`
(code revision, per-asset trade counts, and coverage detail in the run's own provenance
block).

## 2026-08-19 — TEST-DATA-GATE-SKIP-NOT-FAIL: precondition-driven test failures converted to explicit skips (engineering, not research)

Protocol hard rule 7 ("`npm.cmd test` must pass before advancing status") was unsatisfiable
off the research machine: on a fresh clone with no `candles/` directory and no external
egress, 45 of 447 tests failed — every one because its data source (local candle history, or
a live analytics fetch) was absent, not because the code under test was wrong. A red suite
was therefore indistinguishable from a real regression. Fixed by making each precondition-
driven test detect its own precondition and skip explicitly (`node:test`'s `t.skip()`, with a
reason naming the absent source) instead of failing. No assertions were weakened, no
fallbacks fabricate data, and no test was converted to skip without individually confirming
its failure was precondition-driven — verified per-file, not by pattern-matching the filename.

**Root cause, all 45.** Every one of these `runXyz({ watchlist: ["XBT"], ... })`-style research
signal modules checks local candle coverage (`researchlab.mjs`'s `loadResearchCandles`, which
reads `candles/XBTUSD.csv`) *before* it ever calls the injected `fetchXyz` analytics stub. With
`candles/` absent, every one of these tests gets `included: false, reason:
"insufficient-candle-history"` immediately — even though most of them are actually testing
fetch-failure classification, short-history classification, or gate-scoring logic downstream
of coverage, using a *fake* analytics fetcher. The fix in every case: `fs.existsSync(new
URL("./candles/XBTUSD.csv", import.meta.url))`, checked once per file, and `t.skip(...)` in
each affected test when false. `funding-study.test.mjs` additionally has no fetch-injection
point (it calls the real `fetchFundingRates`), so it skips on the same candle-file check before
ever attempting network, with a secondary catch on the "aligned BTC/funding days" precondition
error as a safety net for the case where the file exists but is too short.

| File | Precondition-driven | Genuinely failing |
|---|---:|---|
| `basis-directional-signal.test.mjs` | 4 (candles/XBTUSD.csv) | none |
| `cost-model.test.mjs` | 1 (candles/XBTUSD.csv) | none |
| `funding-gate-h11.test.mjs` | 3 (candles/XBTUSD.csv) | none |
| `funding-study.test.mjs` | 1 (candles/XBTUSD.csv, live funding fetch) | none |
| `liquidation-cascade-reversal.test.mjs` | 4 (candles/XBTUSD.csv) | none |
| `long-short-ratio-contrarian.test.mjs` | 5 (candles/XBTUSD.csv) | none |
| `oi-trend-gate.test.mjs` | 3 (candles/XBTUSD.csv) | none |
| `order-flow-aggressor-imbalance.test.mjs` | 8 (candles/XBTUSD.csv) | none |
| `rolling-volatility-regime-timing.test.mjs` | 6 (candles/XBTUSD.csv) | none |
| `seasonality-dayofweek-session.test.mjs` | 4 (candles/XBTUSD.csv) | none |
| `top-traders-divergence.test.mjs` | 6 (candles/XBTUSD.csv) | none |
| **Total** | **45** | **0** |

**Measured, both environments, per done_when:**
- Fresh clone (`git clone` into a scratch dir, `npm install`, no `candles/`, no `.env`, no
  `config.json`): `npm.cmd test` → **447 tests, 402 pass, 0 fail, 45 skip.**
- Research machine (`candles/` and egress present, unchanged working tree otherwise):
  `npm.cmd test` → **447 tests, 447 pass, 0 fail, 0 skip** — identical to the pre-change
  baseline pass count, and zero skips proves the guards detect the precondition rather than
  silently disabling coverage when the data is actually there.

**Discovered but explicitly NOT touched (out of scope for this item): a pre-existing,
intermittent test-isolation leak.** Running the full suite twice in the same fresh clone
produced 45 skips both times, but the fail count was 0 on one run and 2 on the next — both
extra failures were `researchlib.test.mjs`'s `loadWatchlist` tests
(`falls back to the on-disk candle store when config's watchlist is genuinely empty` and
`returns [] rather than throwing when no candles/ directory exists`), which pass 12/12 every
time when that file is run alone. Cause: `storage.js` resolves `DATA_DIR = process.env.DATA_DIR
|| process.cwd()` once at module-import time (`storage.js:14`); some other test file that
imports a module transitively depending on `storage.js` — `money-path.test.mjs`,
`monitor-health.test.mjs`, `scheduler.test.mjs`, and `trader.test.mjs` are the candidates that
reference storage-backed modules without ever mentioning `DATA_DIR` — writes a real
`config.json`/`config.json.bak` into the repo-root working tree as a side effect when run
concurrently with `researchlib.test.mjs`'s own tests (which correctly use isolated
`mkdtempSync` dirs and a `DATA_DIR` override, and are not themselves at fault). This is a real,
reproducible bug, but it is unrelated to missing external data — it is a cross-file
isolation leak in the suite's own use of `storage.js` — so per this item's own scope
("additive guards only... no source module changes") it is called out here rather than fixed.
Left for a follow-up work_queue item to identify the exact polluting call site and either set
`DATA_DIR` in that test file or make `storage.js`'s default lazy per-call instead of
frozen-at-import.

## 2026-08-19 — SIGNAL-DECAY-TEMPORAL-STABILITY: the pooled baseline is NOT stationary — both families drift significantly across time

**Question, never asked before this item.** Every study in this project's research record
compares a gated variant against a fixed pooled baseline avgR (e.g. `breakout` holdout avgR
-0.864, `anticipate` holdout avgR -0.884, both from SEASONALITY-DAYOFWEEK-SESSION above),
implicitly assuming that baseline is stationary across the sample window. If the underlying
edge (or anti-edge) drifts over calendar time, a single pooled number hides it, and both the
train-fitted thresholds and every train/holdout comparison in this series are measuring a
moving target rather than a fixed effect. This item is purely descriptive — no gate, no
VERDICTS.md row (its own task wording) — the deliverable is the epoch table and an honest
stationarity call, not a promotable finding.

**Method.** Same `breakout`/`anticipate` baseline configs as every other verdict in this
series (`tournament.mjs`'s `families` table, unmodified, `entryTf: "1h"`). Unlike every
train/holdout study in this series, this uses each asset's **full local candle history**
(no split) — the question is about the baseline's behavior across its entire available
sample, not train vs. holdout. Each asset's full history is cut into 5 consecutive,
non-overlapping, equal-length (by index on the 1h anchor timeframe) chronological epochs;
every timeframe is then filtered to each epoch's time boundary independently
(`signal-decay-temporal-stability.mjs`'s `epochSlices`, mirroring `researchlib.mjs`'s
`walkForwardSeriesWindows` anchor-then-time-boundary technique, generalized from one
expanding train/holdout cut to 5 disjoint fixed slices). Each epoch is then an entirely
independent `backtestMultiTF` run against its own bounded series — no per-trade timestamp
recovery needed (unlike the seasonality study), since epoch membership is which slice
produced the trade, not a per-trade attribute recovered after one continuous run. Caveat
disclosed in the module docstring: a position that would run past an epoch boundary in a
continuous backtest gets truncated at that boundary instead — the same boundary artifact
every train/holdout split in this project already has (`tournament.mjs`'s `splitSeries`),
not a new problem this diagnostic introduces.

**Stationarity test.** One-way ANOVA F-statistic across the 5 epochs' pooled per-trade R
values, with a permutation p-value (1000 iterations, seed 20260819) rather than a parametric
F-distribution CDF — this project has never needed one elsewhere and already has an
established permutation-testing idiom (`momentum.mjs`'s `permutationP`: shuffle, recompute,
`(extreme+1)/(iterations+1)`). Applied here to epoch-label shuffles instead of panel pairs.

**Coverage:** 28/29 watchlist assets (EOS excluded on the same pre-existing candle-history
shortfall every other study in this series hits).

**Result — `breakout` (full history, pooled across 28 assets: 10,504 trades, avgR -0.875,
totalR -9,188.13):**

| Epoch | trades | avgR | totalR | 95% CI |
|---|---:|---:|---:|---|
| 1 (earliest) | 2016 | -0.985 | -1984.87 | [-1.053, -0.916] |
| 2 | 2176 | -0.870 | -1894.28 | [-0.937, -0.805] |
| 3 | 2150 | -0.804 | -1729.69 | [-0.873, -0.736] |
| 4 | 2122 | -0.766 | -1624.64 | [-0.834, -0.697] |
| 5 (most recent) | 2040 | -0.958 | -1954.65 | [-1.024, -0.892] |

ANOVA: F(4, 10499) = 7.459, permutation p = 0.000999 (1000 iterations — this is the minimum
resolvable p at that iteration count, i.e. 0/1000 permuted F-statistics reached the observed
value). **NON-STATIONARY.**

**Result — `anticipate` (full history, pooled across 28 assets: 13,574 trades, avgR -0.769,
totalR -10,439.25):**

| Epoch | trades | avgR | totalR | 95% CI |
|---|---:|---:|---:|---|
| 1 (earliest) | 2346 | -0.674 | -1581.26 | [-0.743, -0.605] |
| 2 | 2738 | -0.692 | -1895.54 | [-0.756, -0.629] |
| 3 | 2746 | -0.689 | -1891.46 | [-0.755, -0.623] |
| 4 | 3184 | -0.824 | -2622.63 | [-0.880, -0.768] |
| 5 (most recent) | 2560 | -0.956 | -2448.35 | [-1.015, -0.897] |

ANOVA: F(4, 13569) = 13.967, permutation p = 0.000999 (same floor as above). **NON-STATIONARY.**

**Reading it.** Both families reject stationarity at every conventional threshold, and both
show the same directional shape: relatively flat/best in the early-to-middle epochs, then
notably worse in the most recent epoch (`anticipate` most starkly — epoch 1's -0.674 vs.
epoch 5's -0.956, a 0.28R swing on the SAME unmodified config, no cost change, no parameter
change). `breakout`'s epoch 5 (-0.958) is also its second-worst of the five, though epoch 1
is comparably bad (-0.985), so `breakout`'s drift is closer to "worse at both ends, best in
the middle third" than a clean monotonic trend. Neither family has a single epoch anywhere
near zero, let alone positive — the non-stationarity is real and significant, but it moves
the pooled avgR around within a band that stays decisively negative throughout; it does not
surface a hidden profitable regime.

**What this changes, and what it does NOT change, about every prior verdict in this
series.** Per this item's own task wording, prior verdicts are not retroactively rewritten.
What this finding does establish: every pooled avgR figure quoted anywhere in this project's
research record (VERDICTS.md, TOURNAMENT_ROADMAP.md, every FAIL/KILLED row) is a
time-averaged number over a baseline that is not actually constant, and should be read as
such going forward — a single pooled avgR communicates central tendency across a
significantly-drifting series, not a fixed per-trade expectation. This does NOT change any
verdict's pass/fail outcome: no epoch in either family gets anywhere close to breakeven, so
there is no scenario in this data where the temporal drift, on its own, would have flipped a
KILLED/FAIL verdict to a PASS. It is a methodological caveat on how to interpret the existing
negative numbers, not a new positive signal and not grounds to revisit any closed item.

**Engineering note.** `signal-decay-temporal-stability.mjs`'s `epochSlices` is a new,
independently-tested pure helper (11 unit/integration tests in
`signal-decay-temporal-stability.test.mjs`, including synthetic-data tests confirming the
ANOVA F-statistic and its permutation p-value correctly distinguish an obviously-stationary
synthetic case from an obviously-non-stationary one before trusting either on real data).
Suite 468 → 479 pass, 0 fail, 0 skip locally (candles/ present).

## 2026-08-19 — MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC: losing trades mostly run straight to the stop, not stopped just short of reverting

**Question, never asked before this item.** For every losing trade in the `breakout`/
`anticipate` baselines, does price get meaningfully close to profitable territory before
reversing and hitting the stop (a "near miss" — stop placement or exit timing is plausibly
implicated), or does it barely move in the trade's favor before running straight to the stop
(the entry thesis itself looks wrong, not the stop distance)? The two shapes carry opposite
implications for whether re-tuning stop placement could ever help, and the aggregate avgR
cannot distinguish them. **This item is diagnostic only** — it does not change any stop/target
parameter and does not recommend a replacement value, per the standing prohibition on
re-tuning exits on these already-KILLED/FAIL baselines.

**Method.** `backtestMultiTF` (`backtest.js`) now tracks, for every closed trade, the worst and
best unrealized R the position saw (`maxAdverseR`/`maxFavorableR`, floored at 0, from bars
strictly after the entry bar — the same "entry bar itself isn't re-examined" convention the
existing stop/target/breakeven checks already use) and returns it as a new `excursions: [{r,
mae, mfe}]` array parallel to `results`, using the position's REAL stop/target/breakeven/trail
state at every bar — not a separate synthetic re-simulation (unlike this file's existing
`excursionProfile`, which runs its own first-passage grid over ATR-multiple stops rather than
the actual baseline configs). This is a purely additive field: every existing call site and
test is unaffected (26/26 prior `backtest.test.mjs` tests still pass unmodified), verified with
3 new targeted tests pinning exact mae/mfe values against hand-constructed candle paths for
the winning-trade, stop-loss, and anticipate same-bar-stop-out code paths.

`mae-mfe-stop-placement-diagnostic.mjs` runs the exact `breakout`/`anticipate` baseline
configs from `tournament.mjs`'s `families` table (unmodified, `entryTf: "1h"`), **holdout only**
(split=.70, matching every gated verdict's convention so trade populations are comparable to
the pooled holdout avgR figures already in this record), pools `excursions` across all eligible
watchlist assets, and splits winners (r>0) from losers (r<=0). **Failure-shape call, fixed
before looking at results:** a loser is a "near miss" if its mfe reached at least 0.5R before
reversing, else "ran straight to the stop." Coverage 28/28 eligible watchlist assets (EOS
excluded, the same pre-existing candle-history shortfall every study in this series hits).

**Result — `breakout` (holdout, 3,156 trades):**

| | count | mae mean/p50 | mfe mean/p50 |
|---|---:|---|---|
| Winners | 1,070 | 0.391 / 0.343 | 3.042 / 3.040 |
| Losers | 2,086 | 1.315 / 1.190 | 0.634 / 0.499 |

Failure shape: near-miss 1,041, ran-straight 1,045 (share 0.499) — **effectively a coin flip,
RAN-STRAIGHT wins by 4 trades out of 2,086**, not a real dominance.

**Result — `anticipate` (holdout, 3,966 trades):**

| | count | mae mean/p50 | mfe mean/p50 |
|---|---:|---|---|
| Winners | 1,201 | 0.395 / 0.365 | 3.286 / 3.080 |
| Losers | 2,765 | 1.393 / 1.243 | 0.582 / 0.433 |

Failure shape: near-miss 1,256, ran-straight 1,509 (share 0.454) — **RAN-STRAIGHT-TO-STOP
dominates**, a real 253-trade margin.

**Reading it.** `anticipate` has a genuine (if not overwhelming) majority of losers that never
got meaningfully close to profitable before stopping out — consistent with the entry thesis
itself being wrong on those trades more often than with a stop placed just barely too tight.
`breakout`'s split is close enough to 50/50 that no directional claim survives at this
threshold; calling it either way would overstate the signal. Neither family's losers show a
pattern of "got most of the way to target and then reversed" (mfe p90 for losers tops out
around 1.45-1.49R against a 3R/4R target) — a near-miss loser here means "recovered part of
the way toward breakeven," not "almost hit the take-profit." A secondary, unplanned
observation: losers' median MAE sits at 1.19R (breakout) / 1.24R (anticipate), slightly ABOVE
the nominal 1R initial-stop distance — some losing trades run through where a pure fixed stop
would have exited, which is consistent with `lockBreakeven`/trailing logic occasionally
widening the effective stop before a trade ultimately still loses. This is reported as an
observation, not diagnosed further — doing so would mean re-examining exit-model mechanics,
out of this item's diagnostic-only scope.

**What this does NOT license.** Per the standing prohibition and this item's own scope: no
stop or target parameter was changed anywhere, and no replacement value is recommended. The
`anticipate` near-miss/ran-straight split is a genuine, if modest, finding that some minority
of `anticipate` losses might be stop-placement-sensitive — but demonstrating that would require
a pre-registered variant tested on its own holdout, not inferred from this diagnostic's
threshold choice.

**Engineering note.** `backtest.js`'s new `excursions` field and `mae-mfe-stop-placement-
diagnostic.mjs` are additive (new file + a new always-present return field on
`backtestMultiTF`); 9 new tests (3 in `backtest.test.mjs`, 6 in
`mae-mfe-stop-placement-diagnostic.test.mjs`). Suite 479 → 488 pass, 0 fail, 0 skip locally
(candles/ present).

## 2026-08-19 — COST-COMPONENT-ATTRIBUTION: fee is 94.1% of the -0.864/-0.884R baseline drag, exactly and by construction

The pooled `breakout` (-0.8640R) and `anticipate` (-0.8842R) holdout baselines have always
been reported as single net numbers. This decomposes each into gross R and its cost
components by re-running `backtest.js`'s existing cost path (`backtestMultiTF`'s
`feeRate`/`slipPct` params — the same override mechanism `tournament.mjs`'s `runTournament`
already exposes) at three configurations — zero-cost, fee-only, slip-only — instead of one,
against the exact `breakout`/`anticipate` family configs `tournament.mjs` uses, full 28-asset
watchlist, standard 70/30 holdout split. New file: `scripts/cost-component-attribution.mjs`
(read-only diagnostic, not part of the app). No cost parameter changed anywhere; this is
measurement only.

**Method — exact, not estimated.** `backtest.js`'s net-R formula
(`netR = grossR - (feeRate + slipPct) * (entry + exitPx) / risk`, backtest.js:526) is affine
in `feeRate`/`slipPct` with a per-trade coefficient that does not itself depend on either —
FEE-SCHEDULE-REBASE already established cost doesn't change which trades fire, only their
realized R (confirmed again here: trade counts are identical — 3156/3966 — across all four
cost configurations below). That makes the decomposition an exact identity, not a fit:
`feeDrag = grossAvgR - feeOnlyAvgR`, `slipDrag = grossAvgR - slipOnlyAvgR`, and
`grossAvgR - feeDrag - slipDrag` reconstructs `netAvgR` to within floating-point noise
(~1e-15) for both families — verified below, not assumed.

**Result — pooled, holdout:**

| | trades | gross (zero-cost) | fee-only | slip-only | net (default) |
|---|---:|---:|---:|---:|---:|
| `breakout` | 3,156 | **+0.0637** | -0.8094 | +0.0091 | -0.8640 |
| `anticipate` | 3,966 | **-0.0861** | -0.8373 | -0.1331 | -0.8842 |

| | grossAvgR | feeDrag | slip/spread-crossing drag | adverse-selection drag | reconstructed net | actual net | discrepancy |
|---|---:|---:|---:|---:|---:|---:|---:|
| `breakout` | +0.0637 | 0.8731 | 0.0546 | 0 | -0.8640 | -0.8640 | -6.7e-16 |
| `anticipate` | -0.0861 | 0.7511 | 0.0469 | 0 | -0.8842 | -0.8842 | -1.1e-15 |

Components sum to net within the stated tolerance (< 1e-9) for both families — no
reconciliation gap to explain away.

**Fee is 94.1% of total drag, for both families, and that ratio is structural, not
empirical.** `feeShareOfTotalDrag` = 0.9412 for `breakout` and `anticipate` alike. This
isn't a coincidence of the data — the cost formula applies `feeRate` and `slipPct` to the
*same* per-trade coefficient `(entry+exitPx)/risk`, so their relative share of any pooled
drag is exactly `FEE_RATE / (FEE_RATE + SLIPPAGE_PCT) = 0.008 / 0.0085 = 0.94118`,
independent of family, asset, or trade population. Any future cost-basis change that alters
`FEE_RATE` relative to `SLIPPAGE_PCT` will shift this ratio predictably without a fresh
backtest.

**Spread-crossing vs. modeled slippage — not separable in this codebase, stated plainly
rather than fabricated.** `SLIPPAGE_PCT` (strategy.js:28) is documented as "per-side slippage
estimate for market fills" — a single proxy already standing in for the cost of crossing the
spread on a taker order. Splitting it further into a distinct spread-crossing line would need
real bid/ask tick data; `candles/*.csv` is OHLC only. Reported as one combined
"slippage/spread-crossing" component above rather than inventing an unsupported split.

**Adverse selection — genuinely zero for this baseline, not "unmeasured."** PWR5's
calibrated model (`cost-model.mjs`'s `simulateLimitFill`, consumed via PHASE1/PHASE2's
"incl. calibrated adverse selection" scenarios, `scripts/phase2-triage.mjs`'s `SCENARIOS`)
prices the extra cost of a *resting* maker order that fills and is then watched to run
further against the position before exit. `breakout`/`anticipate`'s holdout baseline uses
`backtest.js`'s default market/taker fills — no resting order, no wait — so PWR5's model has
nothing to attach to here; its contribution is exactly 0 by construction, matching the exact
reconciliation above. For context only (not re-derived here): PHASE1's calibrated add-on for
maker execution is ~0.0024 round-trip: PHASE2-MAX-SURVIVABLE-COST's own scope note confirms
it never covered `breakout`/`anticipate` (only the four already-cost-killed signals), so no
prior sealed number exists for this baseline at maker cost — that full fee×slippage grid,
including a maker-execution point, is COST-SENSITIVITY-SURFACE's job (already queued), not
re-derived here as a byproduct.

**What fraction of the gap the best plausible improvement to the dominant component (fee)
could close.** Computed directly from the table above, no extrapolation: driving `feeRate` to
its theoretical floor of zero (holding `slipPct` fixed at its current value — the actual
floor of any real venue is higher than zero, but this is the cleanest upper bound available
without assuming a specific alternate venue's fee) leaves `breakout` at **+0.0091R**
(`grossAvgR - slipDrag`, exact) and `anticipate` at **-0.1331R**. So even a literal
zero-fee floor closes 94.1% of `breakout`'s drag but produces only a razor-thin, one-basis-
point-scale positive that would not survive any real execution friction (spread, funding, or
the adverse selection any actual zero-fee maker/rebate venue would reintroduce) — and closes
none of `anticipate`'s gap to positive, because `anticipate`'s *gross* (zero-cost) holdout
avgR is itself already negative (-0.0861). **The fee component is the dominant cost lever by
a wide, structural margin, but eliminating it entirely is not sufficient on its own to flip
either family's sign with any real margin** — `breakout`'s zero-cost edge is too thin and
`anticipate` has no zero-cost edge to begin with. This is a statement about the fee
component's improvement ceiling only; it is not a substitute for COST-SENSITIVITY-SURFACE's
queued fee×slippage grid, which will state the full picture including realistic (non-zero)
maker/futures cost points and a verdict-flip table against every FAIL/KILLED row.

**Per-asset.** Full per-asset attribution table (28 assets × 2 families × 4 cost
configurations) is in the saved experiment
(`research-runs/2026-08-19T21-07-22-540Z-cost-component-attribution.json`), not reproduced
in full here. Notable spread: `breakout`'s per-asset fee drag ranges from 0.543R (ZEC, 44
trades) to 1.482R (TRX, 2 trades) — this variance is fee arithmetic, not signal quality: it
tracks each asset's typical `(entry+exitPx)/risk` ratio (tighter stops relative to price
inflate the R-cost of a fixed percentage fee), and the TRX figure in particular carries a
2-trade sample and should not be read as asset-level signal. No asset-exclusion or
per-asset cost adjustment is proposed here — descriptive only, per this item's scope.

**What this does NOT license.** No cost parameter (`FEE_RATE`, `SLIPPAGE_PCT`, or any
override) was changed anywhere in the codebase. No replacement cost value is recommended.
This is a decomposition of the existing baseline's existing cost path, not a new signal, a
new exit, or a proposal to trade at a different venue.

**Engineering note.** `scripts/cost-component-attribution.mjs` is additive (new file only,
zero production files touched); it imports `backtestMultiTF` from `backtest.js` and
`FEE_RATE`/`SLIPPAGE_PCT` from `strategy.js` read-only, and duplicates `tournament.mjs`'s
`breakout`/`anticipate` family configs verbatim (that array isn't exported) rather than
widening `tournament.mjs`'s export surface for a one-off diagnostic. No new tests added
(consistent with this project's other throwaway `scripts/*.mjs` diagnostics, e.g.
`phase2-triage.mjs`, which also carry no dedicated test file) since it exercises only
already-tested `backtest.js`/`tournament.mjs` code paths through their existing public
interfaces. Suite stays 488 pass, 0 fail, 0 skip locally (candles/ present).

## 2026-08-19 — EXECUTION-DELAY-DECAY-CURVE: sharp degradation with fill latency — the maker-execution thesis is dead on arrival

Every backtest run in this project, including every cost-reduction study (PWR5 through
PHASE4, COST-COMPONENT-ATTRIBUTION), has assumed the signal bar fills the trade immediately.
Real execution has latency — signal generation, order transmission, and for any maker/
post-only plan, waiting for price to come to the resting order. This asks directly whether
that hidden assumption is where the loss comes from: re-run the `breakout`/`anticipate`
holdout baselines with entry deliberately delayed by 0, 1, 2, 3 and 5 bars (1h timeframe, so
0-5 hours of latency) and measure how net avgR moves.

**Mechanism — new `entryDelayBars` parameter on `backtest.js`'s `backtestMultiTF`** (default
0, fully backward-compatible — every existing caller and every other family is byte-for-byte
unchanged). When a signal is taken, the stop stays at its structural level fixed at signal
time (it does not move); the actual fill becomes the OPEN of bar `k+entryDelayBars`; risk and
tp are recomputed off that delayed entry (`tp = delayedEntry + tpR*risk`, the same formula
the rest of the codebase already uses everywhere tp is computed). If the delay runs past the
end of the series, or price has already closed the risk to zero or below by fill time, the
trade is skipped outright (tallied under `reasons.delaySkipped`) rather than forced through at
an invalid price. Wired into `anticipate` mode and the shared dip/breakout candidate branch
(which `breakout` mode uses); the other 8 entry modes sharing that branch inherit the same
mechanic for free but are untouched by this study's scope. 4 new tests in
`backtest.test.mjs` (exact delayed-entry-price arithmetic, same-bar stop-out on the delayed
fill, out-of-bounds `delaySkipped` tallying, and an explicit `entryDelayBars: 0` ==
omitted-parameter equality check) — suite 488 → 492 green.

New file `scripts/execution-delay-decay-curve.mjs` (read-only diagnostic, not part of the
app): full 28-asset watchlist, standard 70/30 holdout split, exact `breakout`/`anticipate`
family configs duplicated from `tournament.mjs` (not exported there, same convention as
COST-COMPONENT-ATTRIBUTION's script). The `entryDelayBars: 0` row reproduces the already-
established baseline trade counts and avgR bit-for-bit (`anticipate` 3,966 trades /
-0.8842R, `breakout` 3,156 trades / -0.8640R — identical to COST-COMPONENT-ATTRIBUTION's
numbers), which is itself a correctness check on the new parameter, not just a convenience.

**Result — pooled, holdout, net-of-cost:**

| `anticipate` | delay 0 | delay 1 | delay 2 | delay 3 | delay 5 |
|---|---:|---:|---:|---:|---:|
| trades | 3,966 | 3,636 | 3,329 | 3,147 | 2,755 |
| avgR | -0.8842 | -1.1994 | -1.3217 | -1.3473 | -1.6242 |
| delaySkipped | 0 | 36 | 176 | 254 | 357 |

| `breakout` | delay 0 | delay 1 | delay 2 | delay 3 | delay 5 |
|---|---:|---:|---:|---:|---:|
| trades | 3,156 | 3,141 | 2,897 | 2,688 | 2,386 |
| avgR | -0.8640 | -0.8847 | -1.5442 | -1.6669 | -2.2953 |
| delaySkipped | 0 | 0 | 76 | 190 | 365 |

**Outcome: SHARP DEGRADATION, monotonic, for both families.** avgR degrades at every single
delay step for both families (`monotonicDegrade: true`, zero exceptions across 5 points ×
2 families) — never flat, never an improvement. By 5 bars of delay, `anticipate` loses an
additional -0.7400R/trade (-0.8842 → -1.6242, an 84% relative worsening) and `breakout` loses
an additional -1.4314R/trade (-0.8640 → -2.2953, a 166% relative worsening) on top of an
already-negative baseline. Trade count also falls at every step (more `delaySkipped` misses
as the delay window widens, plus fewer bars remaining in the holdout to re-trigger a fresh
signal after a skip) — both effects point the same direction, degradation isn't an artifact
of a shrinking, cherry-picked sample either.

**What this means for the maker-execution thesis PWR5 through PHASE4 were built on, stated
plainly.** That entire line of work (PWR5's calibrated adverse-selection model, PHASE1-4's
maker/post-only cost-reduction scenarios) is premised on being able to wait for price to come
to a resting order — which is *itself* a form of execution delay, exactly the thing this
diagnostic tests. A signal that degrades this sharply from a few hours of ordinary
transmission latency, before any deliberate resting-order wait is even added, means the
maker-execution cost-reduction thesis is not merely insufficient (PHASE2/PHASE4's prior
finding) — it is actively counterproductive for these two families: the very act of waiting
for a better fill price destroys more edge than the fee savings it was meant to capture. This
closes the maker-execution thesis for `breakout`/`anticipate` on a mechanism basis, independent
of and in addition to PHASE4's equity-curve-level FAIL.

**Why this direction, mechanically — not just empirically.** Both families enter on upward
momentum (a confirmed/anticipated break of structure, or a lookback-high breakout) against a
FIXED structural stop. Delaying the fill means buying after the move has already continued,
at a higher price against the same unmoved stop — risk (price-to-stop distance) grows while
the target (`tp = entry + tpR*risk`) recedes even further in absolute price terms, so a
larger favorable move is now required to bank the same R-multiple than would have been needed
at the original signal price. This is the textbook cost of chasing a breakout instead of
catching it at the moment it fires, and it compounds with position count shrinking
(`delaySkipped`) as the delay window widens.

**What this does NOT license.** No entry, stop, or exit parameter was changed in the live
strategy or in any config `tournament.mjs`/`bot.js` actually uses. `entryDelayBars` defaults
to 0 everywhere it isn't explicitly passed, so this diagnostic introduces zero behavioral
change to any existing backtest, tournament run, or the live bot. This is descriptive per its
own scope (no gate, no VERDICTS.md row, per the work_queue item's own note) — it is a
mechanism finding about WHY delayed/maker execution fails these families, layered on top of
PHASE4's already-sealed equity-curve-level FAIL, not a new verdict.

**Engineering note.** `backtest.js`'s two touched entry sites (anticipate mode, the shared
dip/breakout branch) each gate the new logic behind `if (entryDelayBars > 0) { ... } else { ...
original code, untouched ... }` rather than unifying through a shared helper — a deliberate
choice to make the zero-risk-of-regression case (delay omitted) literally the same code path
that ran before this change, verifiable by inspection rather than by trusting a refactor.
`fib_pullback` and `bos` modes do not wire up `entryDelayBars` (out of scope — neither
family under study uses them); passing a nonzero `entryDelayBars` with those entry modes is
currently a silent no-op, worth remembering if this parameter is ever reused for a different
family. No production file touched (bot.js/monitor.js/trader.js/scanner.js/strategy.js
untouched; `backtest.js` is the shared research/live simulation engine, extended additively
with a default-off parameter, same category of change as MAE-MFE-STOP-PLACEMENT-DIAGNOSTIC's
prior `excursions` addition to the same function). Suite 488 → 492 green.

## 2026-08-19 — EQUITIES-BASELINE-PORT: breakout survives real IBKR costs (net positive); anticipate's net drag shrinks by ~20x but stays negative

Cost, not signal, is the one variable that has ever moved a number materially in this project
— the fee rebase alone shifted the breakout baseline 0.419R, larger than every signal effect
ever measured combined, and COST-COMPONENT-ATTRIBUTION showed fee is 94.1% of the current
-0.864/-0.884R crypto baseline drag by construction. Futures maker execution gave ~6x cheaper
fills and still wasn't enough (PWR5→PHASE4, closed; and EXECUTION-DELAY-DECAY-CURVE just showed
*why* — waiting for a maker fill is itself execution delay, which these families handle badly).
US equities via IBKR are a different order of magnitude of cost again. `strategy.js`/
`backtest.js` are asset-agnostic by design, and `brokers/ibkr.mjs` (built and tested but never
exercised against a live Gateway from an automated session until this run) is reachable from
this research machine. This ports the EXISTING, UNMODIFIED `breakout`/`anticipate` families
(exact `tournament.mjs` configs) onto a real Dow-30-grade equity universe, unmodified, to see
whether the same signal logic behaves differently in a cheaper market. No entry/stop/exit
parameter was touched.

**Universe — rule fixed at window start, survivorship bias addressed, not just mentioned.**
The 30 DJIA constituents as of 2024-08-19 (exactly 2 years before this run) — sourced from
Wikipedia's "Historical components of the Dow Jones Industrial Average" change log: the most
recent change before the window start was 2024-02-26 (Walgreens Boots Alliance → Amazon.com),
and no further change occurred before 2024-08-19. Concretely: **Intel (INTC) and Dow Inc.
(DOW) are IN** the universe (both were real members on 2024-08-19, even though both were
removed on 2024-11-08 and both underperformed after removal — including them despite that,
rather than excluding them with hindsight, is the entire point of fixing the rule at window
start) and **Walgreens is OUT** (already removed by window start). This is a genuine, citable,
point-in-time list, not today's DJIA roster.
https://en.wikipedia.org/wiki/Historical_components_of_the_Dow_Jones_Industrial_Average

**Cost basis — sourced and cited, not carried from memory** (this project already learned once,
via FEE-SCHEDULE-REBASE, that a memorized cost figure was wrong by ~2x):
- **Commission**: IBKR Pro "Fixed" US-stock plan, USD 0.005/share, USD 1.00 minimum/order,
  capped at 1% of trade value.
  https://www.interactivebrokers.com/en/pricing/commissions-stocks.php
  Modeled per-side as `commissionPerShare / thatSymbol'sOwnAvgHoldoutClose` — `backtest.js`'s
  cost model is a % of price, and a single flat % would misprice a $50 stock and a $500 stock
  identically wrong, so each symbol gets its own fee rate off its own price level. The $1.00
  order minimum is NOT modeled — it only binds at very small share counts, and this backtest
  works in R-multiples, not position sizing, so there's no share count to check it against.
  Stated as a simplification, not hidden.
- **Slippage/spread**: 0.0005 (5bps) per side, a deliberately conservative estimate for
  Dow-30-grade large-cap liquidity — general large-cap spreads are commonly cited at "a penny
  wide" / ≤15bps, and a 2024 Nasdaq Research figure puts institutional S&P 500 market impact at
  ~4.5bps/trade. This is an assumption, not measured from IBKR's own NBBO tick history (would
  need Level-1 quote data, out of scope this pass) — stated as such, not disguised as measured.

**Data.** Daily OHLC (2024-08-20 → 2026-08-19, IBKR's max "2 Y" daily-bar duration) fetched
live via `IBKRBroker.fetchOHLC(symbol, 1440)` against a real, running IB Gateway (paper port
4002 — read-only historical-data requests only, never an order) for all 30 universe symbols,
cached to `research-cache/equities-1d/<SYMBOL>.json`. Same 70/30 train/holdout split convention
as every crypto study here. Because IBKR's hourly-bar history is capped at 30 days (too short
for a meaningful multi-TF holdout), and because both families run with `trendGate: false,
alignMode: "none"` — meaning neither needs higher-timeframe context — this uses a single `"1d"`
series as `entryTf`, sidestepping the cap entirely without touching `backtest.js`'s multi-TF
logic or either family's config.

**Bug found and fixed en route (not a strategy change).** The live fetch surfaced a real
correctness bug in `brokers/ibkr.mjs`: TWS sends DAILY/WEEKLY bars' `time` field as a bare
`"YYYYMMDD"` string regardless of the `formatDate=2` request — confirmed directly against the
live Gateway (`AAPL` daily fetch returned `time: 20240820`, not an epoch-seconds value). The
existing code did `Number(time)` unconditionally, which would have silently parsed
`"20240820"` as 20,240,820 *seconds* since epoch (≈1970-08-24) instead of throwing — corrupting
every daily candle's timestamp with no error, since `formatDate` only actually affects
*intraday* bars (undocumented in this file previously, and untested — no prior test exercised
the 1440-minute path at all). Fixed at the source: `onBar` now detects the bare-8-digit-date
shape and converts it to real UTC-midnight epoch seconds; intraday bars are unaffected (still
`Number(time)`, unchanged). New unit test in `brokers/ibkr.test.mjs` reproduces the exact
live-Gateway shape (`time: "20240820"` → UTC-midnight epoch for 2024-08-20). This is a
historical-data read-path fix, nowhere near the protected trading-safety surface (the
live-mode env gate, the halt/resume state machine, or order-fill validation) — none of that
logic was touched.

**Results — holdout, 30/30 symbols usable, aggregated by summed R / summed trades (same
convention as every crypto baseline here):**

| `anticipate` | gross (0 cost) | net (real IBKR cost) |
|---|---:|---:|
| trades | 303 | 303 |
| avgR | -0.0019 | -0.0438 |
| totalR | -0.581 | -13.262 |

| `breakout` | gross (0 cost) | net (real IBKR cost) |
|---|---:|---:|
| trades | 61 | 61 |
| avgR | +0.2110 | +0.1866 |
| totalR | +12.872 | +11.384 |

**Side by side with the crypto holdout baselines** (COST-COMPONENT-ATTRIBUTION, same two
families, unchanged configs, ~1.7% round-trip crypto taker cost):

| family | crypto gross | crypto net | equities gross | equities net |
|---|---:|---:|---:|---:|
| `breakout` | +0.0091 | -0.864 | +0.2110 | **+0.1866** |
| `anticipate` | -0.1331 | -0.884 | -0.0019 | -0.0438 |

> **CORRECTION, 2026-08-22 — the "crypto gross" column above is mislabeled, and the
> 23x figure derived from it is wrong.** The crypto values in that column
> (`breakout` +0.0091, `anticipate` -0.1331) are COST-COMPONENT-ATTRIBUTION's
> **zero-FEE floor** — slippage still charged — not its zero-cost gross. That table's
> true gross (zero-cost) row is `breakout` **+0.0637** and `anticipate` **-0.0861**.
> So the row above compares crypto-at-zero-fee against equities-at-zero-cost under a
> single "gross" header, which is not like-for-like. Corrected comparison:
>
> | family | crypto gross (0 cost) | equities gross (0 cost) | ratio |
> |---|---:|---:|---:|
> | `breakout` | +0.0637 | +0.2110 | **3.3x** |
> | `anticipate` | -0.0861 | -0.0019 | sign unchanged, magnitude 45x smaller |
>
> **The cross-market gross-edge gap is 3.3x, not 23x.** The finding survives the
> correction — a 3.3x difference in gross edge for byte-identical entry logic, with
> zero cost charged on either side, is still large and still cost-independent, and it
> still says the market matters more than this project assumed. But the 23x figure had
> already propagated into two queue items' framing (`EQUITIES-ALL-FAMILIES-BASELINE`,
> `LOG-REGRESSION-BANDS-EQUITIES`) as the headline motivation, and an inflated
> motivating number is exactly the kind of thing that quietly sets an expectation the
> data cannot meet. Both items corrected in the same commit. Do not requote 23x.
>
> Nothing else in EQUITIES-BASELINE-PORT changes: the net figures (+0.1866R equities,
> -0.864R crypto), the sign flip, and the ~12%-vs->100% cost-erosion contrast were all
> computed from the correctly-labeled per-family tables above and are unaffected.

**Does the cost difference change the sign of anything — stated explicitly, both ways.**
**Yes, for `breakout`: the sign flips.** Crypto's realistic cost (-0.864R net) turns a thin
positive gross edge (+0.0091R) deeply negative; IBKR's realistic cost, applied to the *same*
unmodified entry/exit logic on equities, leaves a much larger gross edge (+0.2110R) net
*positive* (+0.1866R) — costs here erode only ~12% of the gross edge, versus crypto's cost
erasing gross edge and then some. **No, for `anticipate`: it stays negative.** The equities
net figure (-0.0438R) is roughly 20x smaller in magnitude than crypto's net drag (-0.884R) —
real IBKR costs are a small fraction of crypto's — but gross was already marginally negative
on equities (-0.0019R) before any cost was applied, so a smaller cost still leaves it net
negative, just barely. Cost magnitude alone does not decide the sign; it decides how far a
family's *own* gross edge (which differs by market and isn't something this item touched or
re-tuned) gets eroded.

**What this does NOT license, stated as plainly as EXECUTION-DELAY-DECAY-CURVE's did.** This
is a baseline port, not a verdict and not a promotion decision — no VERDICTS.md row, no
change to any config `tournament.mjs`/`bot.js` actually uses, no live equities trading (this
project remains 100% crypto/Kraken in production; IBKR here is read-only historical-data
access on the paper port, nothing more). **Sample size is small and must not be oversold**:
61 `breakout` trades and 303 `anticipate` trades over one ~7-month holdout window on 30
symbols is a much thinner sample than crypto's baselines (thousands of trades) — no
permutation test or significance check was run this pass (out of this item's declared
`done_when` scope), so "breakout is net positive here" is a genuine, real-cost, real-data
result on this window, not a sealed, statistically-confirmed edge. A different holdout window,
a larger universe, or an out-of-sample re-check could move these numbers meaningfully. Any
decision to actually trade equities — a `D3`-class live-promotion question — is explicitly
human-owned and not attempted or implied here.

**Engineering note.** New files only: `scripts/equities-baseline-port.mjs` (the port script)
and `research-cache/equities-1d/*.json` (gitignored candle cache, 30 files). One correctness
fix in `brokers/ibkr.mjs` (daily-bar time parsing, described above) plus its matching test in
`brokers/ibkr.test.mjs`. `strategy.js`, `backtest.js`'s trading logic, `tournament.mjs`,
`monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched. Suite 492 → 493 green.

## 2026-08-20 — HOLDING-PERIOD-COST-AMORTIZATION-MAP: only anticipate's longest-hold bucket clears net-positive, and it's 11% of trades; breakout never clears at any holding period

**Question, never asked before this item.** Round-trip cost is charged once per trade
regardless of how long the position was held, so for any fixed gross edge, net R mechanically
improves the longer a trade runs (the fixed cost becomes a smaller fraction of a bigger average
move). Nobody had mapped where the `breakout`/`anticipate` crypto holdout baselines actually
sit on that curve: is there a holding-period regime where the fixed cost is amortized enough
for net R to approach or cross zero, and if so, what fraction of trades already land there?
**This item is diagnostic only** — per the standing prohibition on re-tuning exits on these
already-KILLED/FAIL baselines, it does not change any exit/stop/target parameter and does not
recommend a replacement holding-period value. Selecting a holding period after seeing which
bucket looks best would be exactly the exit re-tuning that prohibition exists to block.

**Method.** `backtestMultiTF` (`backtest.js`) now also returns, per closed trade, `barsHeld`
(current bar index minus the position's entry bar index — `0` for the same-bar-stop-out code
paths, `k - pos.openedAt` from the general per-bar close path) inside the existing `excursions`
array, alongside the pre-existing `mae`/`mfe`. Purely additive telemetry — no entry, exit, stop,
or target logic changed; the field is simply read off state the loop already tracks. 3 new
assertions in `backtest.test.mjs` pin exact `barsHeld` values against the same hand-constructed
candle paths the existing MAE/MFE tests already use (winning BOS exit: 5 bars; BOS stop-out: 1
bar; ANTICIPATE same-bar stop-out: 0 bars) — all pre-existing tests unmodified and still pass.

`scripts/holding-period-cost-amortization-map.mjs` runs the exact `breakout`/`anticipate`
baseline configs from `tournament.mjs`'s `families` table (unmodified, `entryTf: "1h"`),
**holdout only** (split=.70, the same convention every gated verdict here uses), twice per
symbol — once at the default net cost (`FEE_RATE`+`SLIPPAGE_PCT`) and once at zero cost — and
pairs the two runs' per-trade results by index. This relies on the same fact
COST-COMPONENT-ATTRIBUTION already established and this item re-verifies per symbol
(`symbolMismatches: 0` for both families): cost is priced after the fact and never changes
which trades fire, so both passes produce the identical trade sequence per symbol, and
`net.excursions[i].barsHeld` from the net-cost pass is the real holding period for trade `i` in
either pass. Trades are then bucketed by `barsHeld` in hourly-equivalent bands (entryTf is 1h,
so 1 bar = 1 hour): 0h, 1-4h, 5-12h, 13-24h, 25-48h, 49-100h (the last band also catches
`maxHold`=100 timeout exits). Coverage 28/28 eligible watchlist assets (same EOS exclusion as
every study in this series, pre-existing candle-history shortfall).

**Sanity check against prior results.** The trade-count-weighted average of this item's own
per-bucket net avgR reproduces COST-COMPONENT-ATTRIBUTION's pooled net baseline exactly:
breakout -0.8639R (recorded there: -0.864R), anticipate -0.8843R (recorded there: -0.884R) —
same data, same configs, just re-sliced by holding period instead of pooled, so this is a
reproduction check, not a new baseline.

**Result — `anticipate` (holdout, 3,966 trades):**

| bucket | trades | gross avgR | net avgR | net-positive? |
|---|---:|---:|---:|:---:|
| 0h (same-bar stop) | 226 | -1.000 | -1.869 | no |
| 1-4h | 984 | -0.725 | -1.552 | no |
| 5-12h | 1,004 | -0.386 | -1.194 | no |
| 13-24h | 786 | +0.183 | -0.632 | no |
| 25-48h | 536 | +0.681 | -0.098 | no |
| 49-100h (incl. timeout) | 430 | +1.107 | **+0.446** | **yes** |

**Result — `breakout` (holdout, 3,156 trades):**

| bucket | trades | gross avgR | net avgR | net-positive? |
|---|---:|---:|---:|:---:|
| 0h (same-bar stop) | 0 | n/a | n/a | n/a |
| 1-4h | 818 | -0.423 | -1.409 | no |
| 5-12h | 948 | -0.053 | -1.008 | no |
| 13-24h | 719 | +0.334 | -0.586 | no |
| 25-48h | 464 | +0.493 | -0.366 | no |
| 49-100h (incl. timeout) | 207 | +0.620 | -0.135 | no |

**Reading it, both ways stated explicitly.** For `anticipate`, exactly one bucket — the longest
(49-100h, which also absorbs `maxHold` timeout exits) — reaches net-positive, at
**430/3,966 = 10.8% of trades**. Every shorter bucket stays net-negative, monotonically
worsening as holding period shrinks (0h bucket averages -1.869R net, nearly double the -1.000R
gross floor a same-bar stop-out mechanically produces, meaning cost alone drags those specific
trades by ~0.87R — consistent with tight stops amplifying a fixed cost expressed in R terms).
For `breakout`, **no bucket reaches net-positive at any holding period tested** — gross does
cross zero by the 13-24h bucket (+0.334R) and keeps climbing with longer holds, but net cost
drag never fully clears even in the longest-hold bucket (-0.135R at 49-100h). The two families'
curves have the same shape (net R rises monotonically with holding period, mirroring the
mechanical amortization effect this item set out to check for) but only `anticipate` actually
crosses zero, and only in its tail bucket.

**What this does NOT license.** Per the standing prohibition and this item's own scope: no
exit, stop, or target parameter was changed anywhere, and no replacement holding-period value
is recommended. That a longer hold correlates with a smaller (or, for `anticipate`, reversed)
net drag is an amortization arithmetic fact already implied by a fixed per-trade cost, not
evidence that lengthening holds would improve real forward performance — the 49-100h bucket is
disproportionately trades that already ran to (or near) `maxHold`, i.e. survivorship within the
sample, not a lever available to pull. Picking "hold longer" as a fix after seeing this table
would be exactly the post-hoc exit re-tuning already prohibited on these negative-EV families.

**Engineering note.** `backtest.js`'s `excursions[].barsHeld` field and
`scripts/holding-period-cost-amortization-map.mjs` are additive (new always-present field +
new file); 3 new assertions added to 3 existing `backtest.test.mjs` tests (no new test count).
`strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all
untouched. Suite 493 → 493 green (test count unchanged; existing tests extended, not added).

## 2026-08-20 — COST-SENSITIVITY-SURFACE: `breakout` crosses zero only at an idealized
maker corner PWR5/PHASE4 already ruled out unrealistic; `anticipate` never crosses zero
anywhere on the grid

**Question.** One number has already moved every recorded verdict once before: the
FEE-SCHEDULE-REBASE correction moved `breakout`'s net avgR by 0.419R. Every FAIL/KILLED
verdict in this project is conditional on the cost assumption in force when it was run. This
maps net avgR for the `breakout`/`anticipate` holdout **baseline** families (exact
`tournament.mjs` `families` config, no gate, standard 70/30 split — the same config
COST-COMPONENT-ATTRIBUTION and HOLDING-PERIOD-COST-AMORTIZATION-MAP already used, and the one
PHASE2-MAX-SURVIVABLE-COST's own scope explicitly excluded) across a real 2-D grid of fee rate
x slippage, spanning from Kraken Futures retail-tier maker at the cheap end to the current spot
taker default at the expensive end (`cost-model.mjs`'s verified `SPOT_FEE_SCHEDULE`/
`FUTURES_FEE_SCHEDULE`, re-verified 2026-08-13) — then checks whether any point on that grid
would flip a prior recorded verdict. New file: `scripts/cost-sensitivity-surface.mjs`
(read-only diagnostic, not part of the app). No cost parameter changed anywhere; no exit/stop/
target parameter touched.

**Method — exact, not interpolated.** Same identity COST-COMPONENT-ATTRIBUTION already
established: `netR = grossR - (feeRate + slipPct) * (entry + exitPx) / risk` is affine in
`feeRate`/`slipPct` with a per-trade coefficient independent of either. Three backtest passes
(zero-cost, fee-only at the default rate, slip-only at the default rate) give exact per-unit
drag coefficients (`feeUnitDragAvgR`, `slipUnitDragAvgR`), from which `netAvgR(fee, slip)` is
computed analytically at every grid cell — **not** by re-running backtest at each of the 12
cells. Trusting the extrapolation was verified, not assumed: the analytic formula was checked
against a direct `backtest.js` re-run at both grid corners (cheapest and priciest) for both
families — discrepancy ~1e-15 to 1e-17 in every case, floating-point noise, not a fit residual.

**Grid axes (named real venues, not arbitrary steps).** Fee: futures maker retail tier
(0.00020), futures taker retail tier (0.00050), spot maker (0.0040), spot taker/current default
(0.0080, `strategy.js`'s `FEE_RATE`). Slip: 0 (resting maker fill, no spread-crossing), half
current, current default (0.0005, `strategy.js`'s `SLIPPAGE_PCT`). Low end of slip is 0, not a
rebate — a resting maker order that fills doesn't cross the spread; PWR5's calibrated
adverse-selection add-on for that scenario is a separate ~0.12%/side effect not modeled by
`feeRate`/`slipPct` at all, addressed explicitly below rather than silently folded in or ignored.

**Result — pooled, holdout (28 assets, 3,156/3,966 trades, identical trade counts across every
grid cell within each family, confirming cost still doesn't change which trades fire):**

| | trades | gross (zero-cost) | best-case corner (futures maker, 0 slip) | worst-case corner (spot taker, default slip = current recorded baseline) | any grid cell positive? |
|---|---:|---:|---:|---:|---:|
| `breakout` | 3,156 | **+0.0637** | **+0.0419** | -0.8640 | **yes — 4/12 cells** |
| `anticipate` | 3,966 | **-0.0861** | -0.1049 | -0.8842 | **no — 0/12 cells** |

Full 4x3 grid (both families) saved to `research-runs/2026-08-20T05-06-17-785Z-cost-sensitivity-surface.json`. `breakout` cells: positive at (futures maker, 0 slip) +0.0419, (futures maker, half slip) +0.0146, (futures taker, 0 slip) +0.0091; negative everywhere else, including (futures maker, current default slip) -0.0127 — a single grid step past the cheapest fee tier already erases it. `anticipate`'s gross avgR is *already negative before any cost is applied* (-0.0861) — its worst-to-best-case range never approaches zero, let alone crosses it; monotonicity (both drag coefficients strictly >=0) means this single fact rules out every other point on the grid without needing to check them individually.

**`breakout`'s positive corner is not a live option — PWR5/PHASE4 already closed it.** Because
`feeUnitDragAvgR`/`slipUnitDragAvgR` are both ~109 for `breakout`, PWR5's own calibrated
resting-maker adverse-selection add-on (~0.12%/side round trip, PHASE1/PHASE2, not modeled by
this grid's `feeRate`/`slipPct` axes) would drag the best-case cell by roughly
0.0012 x 109 ~= 0.13R — more than double the entire +0.0419R margin at that corner. This is not
a new finding: COST-COMPONENT-ATTRIBUTION's own header already states "PWR5/PHASE4 already
found maker execution insufficient to rescue `breakout`." This item's contribution is
confirming, with the actual grid, that the *only* cells where `breakout` is nominally positive
are exactly the idealized-maker-fill cells that finding already excludes as unrealistic — not a
new avenue, a closed one restated with numbers attached.

**Verdict-flip table.** Checked every FAIL/KILLED/TRAIN-GATE-FAIL/DATA-GATED row in
VERDICTS.md against this grid, in three buckets by how directly this grid's decomposition
applies to that row's own reported number:

- **Bucket A — exact baseline, this grid answers directly.** T1-ZEROCOST's own `breakout`
  holdout figure (an earlier data vintage, pre-FEE-SCHEDULE-REBASE cost basis: +0.045 gross /
  -0.445 net, vs. this item's current-data +0.0637 gross / -0.8640 net at the corrected cost) —
  same qualitative shape confirmed on a second, independent, larger dataset: positive gross,
  deeply negative net, and now (new here) a razor-thin positive sliver at the cheapest
  theoretical venue that a follow-up study (PWR5/PHASE4) already found unrealistic. Does not
  flip the T1-ZEROCOST verdict as recorded (it never claimed net-positive), and does not open a
  live path given the adverse-selection caveat above.
- **Bucket B — same signal/cost mechanism, gated or modified trade subset (approximate bound
  only, not an exact re-derivation — out of this item's scope per its own note not to
  re-derive PHASE2's covered cases, and re-deriving each variant's own gross/cost split was not
  attempted here).** TREND-GATE-MA/STRUCTURE, FUNDING-MEANREV, VOL-CONFIRM-BREAKOUT,
  OPEN-INTEREST-TREND-CONFIRMATION, FUTURES-BASIS-DIRECTIONAL-SIGNAL,
  LONG-SHORT-RATIO-CONTRARIAN, TOP-TRADERS-DIVERGENCE, ORDER-FLOW-AGGRESSOR-IMBALANCE,
  ROLLING-VOLATILITY-REGIME-TIMING, WIDE-STOP-HIGH-TARGET-ASYMMETRY, T3-REGIMEFILTER,
  T1B-BREAKOUT-COSTFIX, T5-DECAY-EXIT, TRAIL-STOP-EXIT, T6-TIMEFRAME-ISOLATION,
  ATR-ADAPTIVE-STOP-CONFIRMATORY, SCALED-EXIT-LADDER-CONFIRMATORY. Every one of these rows'
  reported net holdout avgR (range -0.32 to -1.65) sits well below the baseline family's own
  entire recorded span on this grid (-0.86 to +0.04, an 0.90R range) — none is closer to zero
  than the baseline itself was, so it is implausible any would cross zero on the same
  cost-only axis, but this is a plausibility read from the baseline's span, **not** a per-row
  proof — a gate or modified TP/stop changes the exact trade set and per-trade coefficient, and
  only a direct re-derivation (out of scope here) would settle it exactly for any individual row.
- **Bucket C — different mechanism entirely, this grid does not apply.** Every remaining
  FAIL/KILLED/DATA-GATED row: Classifier P5, CLASSIFIER-FUNDING-FEATURE, B5-REVERSAL (+PHASE3/
  PHASE4), T4-PORTFOLIO-MOMENTUM (+COVERAGE-FIX, +PHASE4), Momentum M7, Low-vol B4,
  MOMENTUM-SHORT-HORIZON-RECHECK, CROSS-SECTIONAL-NONPRICE-RANK (all use `classifier.mjs`/
  `momentum.mjs`'s own cost formulas, not `backtest.js`'s `feeRate`/`slipPct`); H3-HIGHER-LOW-
  RECLAIM, RANGE-SWEEP-RECLAIM, FIB-PULLBACK, LIQUIDATION-CASCADE-REVERSAL, T2-VOLCONTRACTION
  (different entry mode entirely, not `breakout`/`anticipate`); PORTFOLIO-LIVE-SIGNAL-SIM,
  DCA-MARTINGALE, DCA-ANTIMARTINGALE, GRID-SIM, PAIRS-COINTEGRATION-STATARB,
  FUNDING-CARRY-DECAY-CHECK (different signal/mechanism class entirely); H11, ONCHAIN-FLOW-GATE
  (data-availability non-verdicts, not cost questions); Trade intensity, Order-flow (pre-2026-
  08-04, no recoverable detail). None of these are answered — correctly, not by omission — by a
  grid scoped to the plain `breakout`/`anticipate` baseline.

**Closing statement on the cost-reduction thesis, as it applies to the price-structure
baseline (distinct from PWR5's own closing statement on the four classifier/momentum signals
it covered).** `anticipate` is closed unconditionally: its gross edge is already negative
before any cost is charged, so no fee/slippage combination on Earth flips it, real or
idealized. `breakout` is closed for practical purposes: its only positive grid cells require a
resting maker fill with literally zero adverse selection, a scenario this project's own PWR5
calibration already measured and found insufficient to rescue this exact family. Read
together with PHASE2/PHASE3/PHASE4's closing statement on the other four signals, no signal
tested in this project to date — price-structure or otherwise — survives its own real,
verified execution-cost model at any achievable venue. The cost-reduction thesis, across all
six signals it has now been applied to, is closed.

**Engineering note.** `scripts/cost-sensitivity-surface.mjs` is new and additive
(read-only diagnostic). `backtest.js`, `strategy.js`, `tournament.mjs`, `cost-model.mjs`,
`monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched. Suite green before commit
(see commit for exact count).

## 2026-08-20 — WATCHLIST-LIQUIDITY-REALISM-AUDIT: one asset (XTZ) real slippage 2.7x the flat
assumption; everything else at or below it, most well below

Methodology audit, not a new signal search — due diligence for whenever a future signal
passes, not a re-test of any existing verdict (every price-structure family has already failed
regardless of this question, per COST-SENSITIVITY-SURFACE et al.). Every backtest this project
has run charges a flat per-side slippage of `strategy.js`'s `SLIPPAGE_PCT` (0.05%) uniformly
across the whole watchlist. This checks whether that flat assumption actually holds
per-asset, using Kraken Futures' own real `slippage`/`liquidity` analytics feeds
(`derivatives.mjs`, live public data — not modeled), against the exact 29-asset universe
`researchlib.mjs`'s `loadWatchlist()` resolves to with `WATCHLIST` unset and `config.json`'s
watchlist empty (`symbolsFromCandleStore()` — every asset any backtest in this project has
actually run against). New file: `scripts/watchlist-liquidity-realism-audit.mjs` (read-only
diagnostic, not part of the app).

**A real bug found and fixed en route.** `derivatives.mjs`'s `normalizeAnalytics` only handled
three response shapes (flat array; named parallel series; a single-key cohort wrapper like
`top-traders`' `top20Percent`). Kraken's `slippage`/`liquidity` types use a fourth shape this
function didn't recognize — multiple named sides (`bid`/`ask`), each holding its own named
parallel-array series (`{bid:{slippage_1k:[...],...}, ask:{...}}`) — and silently normalized
every point to `{}` instead of throwing, exactly the failure mode the function's own comment
already flagged as a risk for shapes like this. Fixed generically (any number of nested side
keys, not just bid/ask) in `derivatives.mjs`, with a new test in `derivatives.test.mjs` pinning
the nested-shape output; all 4 pre-existing `normalizeAnalytics` tests still pass unchanged.
Scope: `normalizeAnalytics` only — no other function in `derivatives.mjs` touched, and nothing
in `bot.js`/`monitor.js`/`trader.js`/`scanner.js` reads this module at all (research-only, as
the file's own header states).

**Method.** Kraken's `slippage` analytics type returns, per side, the average absolute
execution price an order of a given USD notional (`slippage_1k`/`_10k`/`_100k`/`_1m`) would
receive. `slippage_1k` (smallest bucket) is used as a touch-price proxy:
`mid_t = (bid.slippage_1k_t + ask.slippage_1k_t) / 2`. Per-side slippage at size S is
`(ask.slippage_S_t - mid_t)/mid_t` for buys and `(mid_t - bid.slippage_S_t)/mid_t` for sells,
averaged across sides and across every daily point in a 60-day trailing window (60 samples/
asset). This measures the full per-side cost a market order actually pays (spread + size
impact) — the same thing `SLIPPAGE_PCT` proxies — not just incremental book-walk impact past
an arbitrary reference.

**Size assumption, stated rather than fabricated.** Exact live account equity isn't in this
repo (`strategy.js`'s `RISK_PCT`=0.5% of free cash/trade and `MAX_POSITION_PCT` cap are ratios,
not a dollar figure). $1k notional — Kraken's smallest published bucket — is used as the
primary, conservative proxy; a 0.5%-risk personal account would need well over $1k of equity
to size even one trade at $1k notional, larger than this project's own framing (a
single-Discord-user personal bot) suggests. $10k is reported alongside for sensitivity, not as
the primary comparison — see below, since it changes the flagged set materially.

**Result — 28/29 assets got real data; EOS has no Kraken Futures perpetual listing at all**
(confirmed directly against Kraken's `/derivatives/api/v3/instruments`, not inferred from an
empty response — Kraken's analytics endpoint returns HTTP 200 with empty arrays for an unknown
symbol rather than 404, so this needed an explicit check rather than trusting the absence of an
error). EOS is excluded from the ratio analysis below; whether it stays on `DEFAULT_WATCHLIST`
without a matching futures venue is a separate, pre-existing question this audit surfaces but
doesn't resolve.

**Flagged at the primary ($1k) threshold — real slippage >= 2x the flat 0.05% assumption:**

| symbol | real per-side slippage (avg, 60d) | ratio vs. 0.05% assumption |
|---|---:|---:|
| XTZ | 0.1361% | **2.72x** |
| TIA | 0.0958% | 1.92x (below threshold, closest to it) |

Every other asset in the 28 is at or below the 2x threshold; most are well below it — the
flat 0.05% assumption is actually *conservative* (overstated) for the largest-cap names: BTC
0.0012% (0.02x), ETH 0.0039% (0.08x), SOL 0.0091% (0.18x), XRP 0.0115% (0.23x), DOGE 0.0119%
(0.24x). Full per-asset table (all 28, both size buckets, plus `liquidity_01` depth context)
saved to `research-runs/2026-08-20T15-09-09-407Z-watchlist-liquidity-realism-audit.json`.

**Sensitivity — the flagged set is size-dependent, not just XTZ.** At the $10k bucket instead
of $1k, 9 of 28 assets cross the same 2x line: XTZ (6.75x), TIA (3.99x), POL (3.18x), ETC
(2.82x), ALGO (2.57x), ATOM (2.56x), APT (2.39x), INJ (2.30x), UNI (2.01x). This doesn't change
the audit's finding — it sharpens it: the flat assumption's realism is a function of *how big
the actual order is*, which this repo doesn't record as a dollar figure anywhere. The $1k
result (XTZ alone) is the defensible floor given the stated conservative assumption; the $10k
sensitivity table is the one to re-check first if actual position sizing ever turns out closer
to that end.

**Disposition — flagged for the human, not acted on unilaterally, per this item's own
`done_when`.** This is a documentation/report deliverable, not a pass/fail gate, and does not
touch `WATCHLIST`/`DISCOVER_UNIVERSE`/`config.json` in any way. If a future signal ever passes
holdout/train gates on this watchlist, XTZ (and, depending on real position size, the other 8
assets in the $10k sensitivity list) should be reviewed before counting on that signal's
backtested edge translating to live execution — their real per-side cost is materially higher
than every backtest in this project to date has charged them.

**Engineering note.** New: `scripts/watchlist-liquidity-realism-audit.mjs` (read-only
diagnostic). Fixed: `derivatives.mjs`'s `normalizeAnalytics` (bug described above, additive —
handles a shape it previously silently mishandled, doesn't change output for any shape it
already handled correctly, all pre-existing tests unchanged and passing) and
`derivatives.test.mjs` (one new test for the fixed shape). `backtest.js`, `strategy.js`,
`tournament.mjs`, `cost-model.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all
untouched. Suite green before commit (see commit for exact count).

## 2026-08-21 — EQUITIES-BREAKOUT-SIGNIFICANCE: the CI includes zero — the positive point estimate does not survive its own significance test

EQUITIES-BASELINE-PORT (2026-08-19, above) reported `breakout` net +0.1866R over 61 holdout
trades — the first net-positive real-cost result in this project's history — and stated plainly
that no permutation test or significance check had been run. This item runs that check, and
only that check: same cached candles (`research-cache/equities-1d/`, no live Gateway needed, no
egress), same unmodified `breakout`/`anticipate` `tournament.mjs` configs, same cost model. No
re-tuning, no symbol drops, no window extension.

**Pre-registered before computing anything** (full text in
`scripts/equities-breakout-significance.mjs`'s header, same commit as the results below): a
one-sided sign-flip permutation test (null: each trade's R sign is an independent fair coin
flip, i.e. population mean R is zero) on the pooled per-trade net-R series, statistic =
mean(R), `p = (extreme + 1) / (iterations + 1)` — this project's own `permutationP` add-one
convention, `momentum.mjs`, unmodified. 95% CI via `momentum.mjs`'s own `blockBootstrapCI`
(blockSize=4, unmodified). Decision rule, fixed in advance per `AGENT_PROTOCOL.md`'s binding
multiple-comparisons discipline: the raw p-value is **not** evaluated against alpha=0.05 in
isolation — it joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family (10 entries as of
2026-08-19) as an 11th entry, BH-FDR is recomputed across all 11 at q=0.05, and "significant" is
only true if `breakout` clears the recomputed threshold at its rank. `anticipate` (net -0.0438R,
303 trades, already known dead — see HOLDING-PERIOD-COST-AMORTIZATION-MAP) gets the identical
statistic computed alongside as a negative control, a methodology sanity check only — its
p-value gates no decision and does **not** join the formal-NHST family, since no candidate
hypothesis is under evaluation for it.

**Replication check, before trusting anything new:** the script reproduces
EQUITIES-BASELINE-PORT's exact trade counts and avgR (`breakout`: 61 trades, avgR +0.186624;
`anticipate`: 303 trades, avgR -0.043770) bit-for-bit off the same cached candles before any new
statistic is computed — confirms the pooled per-trade R series feeding the new test is the same
population the baseline reported, not a re-derivation error.

**Results:**

| family | trades | avgR | 95% CI (block bootstrap) | p (sign-flip, one-sided) |
|---|---:|---:|---:|---:|
| `breakout` (primary) | 61 | +0.1866 | **[-0.2700, +0.6192]** | 0.2036 |
| `anticipate` (negative control) | 303 | -0.0438 | [-0.2442, +0.1360] | 0.6701 |

**The honest outcome is the one this item's own note anticipated: "positive point estimate, CI
includes zero."** `breakout`'s 95% CI spans from clearly negative to strongly positive — 61
trades is not enough to distinguish this result from noise, well before any multiple-comparisons
correction is applied. `anticipate`'s negative control behaves exactly as expected (large
p-value, CI straddling zero around an already-known-negative point estimate), which is at least
some evidence the test itself isn't miscalibrated.

**Family-wide BH-FDR, recomputed across all 11 formal-NHST entries at q=0.05** (full table:
`MULTIPLE_COMPARISONS_AUDIT.md` §2, `AGENT_PROTOCOL.md`'s counter updated to 11 in the same
commit): `breakout` ranks 6th of 11 by raw p-value (0.2036), q=0.358 — nowhere near surviving.
**A materially important side effect of growing the family from 10 to 11, stated because it
would be dishonest not to:** `CLASSIFIER-FUNDING-FEATURE`'s own p-value (0.0099) does not move,
but its BH-FDR threshold at rank 2 tightens from `2/10×0.05=0.0100` (survived, q=0.0495) to
`2/11×0.05=0.00909` (does **not** survive, q=0.0545) purely because the family grew by one
unrelated test. Nothing about `CLASSIFIER-FUNDING-FEATURE`'s own result changed — this is the
look-elsewhere effect the audit warned about in section 2, now observed in practice for the
first time in this project. `B5-REVERSAL (L=3)` remains the sole survivor at q=0.05 (q=0.0110,
essentially unchanged).

**Decision, per the pre-registered rule: `breakout` does NOT survive significance.** No
VERDICTS.md row — per this item's own `done_when`, a row is only added if a pre-registered gate
was actually cleared, and it wasn't. EQUITIES-BASELINE-PORT's +0.1866R remains on record exactly
as it was reported: a real, real-cost point estimate on this window, now additionally known to
be statistically indistinguishable from zero at 61 trades. This does not retroactively make the
point estimate wrong or the baseline port invalid — it means the sample is too thin to call it
an edge yet, which is precisely what a significance test is for. `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`
(queued, depends on this item) is the next legitimate way to get more evidence, not re-slicing
this same 61-trade window.

**Engineering note.** New: `scripts/equities-breakout-significance.mjs` (read-only, cache-only —
does not import `brokers/ibkr.mjs`, cannot make a live Gateway call even accidentally).
`momentum.mjs`'s `blockBootstrapCI`/`bhFdr` used unmodified, not edited. `MULTIPLE_COMPARISONS_AUDIT.md`
and `AGENT_PROTOCOL.md` updated in the same commit per the binding rule (counters, table, both
narrative sections). `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`,
`trader.js`, `scanner.js` — all untouched. Suite green before commit (see commit for exact
count).

## 2026-08-22 — ZERO-COST-FLOOR-ALL-FAMILIES: 0/12 families clear a meaningful gross edge; the price-structure thesis is closed with a number

COST-COMPONENT-ATTRIBUTION (2026-08-19) measured the zero-fee floor for two families only
(`breakout` +0.0091R, `anticipate` -0.1331R) and called that the most consequential pair of
numbers in the project, because it says cost reduction can't work if there's no gross edge
underneath the fees to begin with. This extends the exact same linear re-derivation to all 12
families currently defined in `tournament.mjs`'s `families` array, same holdout, to answer the
binary question directly: does ANY family in this codebase carry meaningfully positive gross
(zero-cost) edge?

**Overlap check against T1-ZEROCOST (2026-08-06/07), done first as the item required.** T1
already ran 11 of these 12 families at zero cost and is the direct predecessor of this item.
Re-running it is justified only by what's genuinely new: (1) `range_sweep_reclaim` and
`vol_contraction` didn't exist at T1's time — never zero-cost tested until now; (2) T1 predates
FEE-SCHEDULE-REBASE, so its *net*-of-cost comparison numbers used the old cost basis (the
zero-cost numbers themselves are cost-basis-independent by construction and aren't expected to
move for that reason alone); (3) COST-COMPONENT-ATTRIBUTION's exact fee/slip decomposition,
reconciling to net within 1e-9, didn't exist as a method at T1's time and is applied here to all
12 families, not just 2. This is not a reproduction of T1 — it supersedes and extends it.

**Method — exact, not estimated, identical to COST-COMPONENT-ATTRIBUTION's.** New file
`scripts/zero-cost-floor-all-families.mjs` (read-only diagnostic, not part of the app; no cost
parameter changed anywhere). For each of the 12 families' exact `tournament.mjs` config, four
backtest passes on the same 70/30 holdout, full watchlist: zero-cost, fee-only, slip-only, and
net (default). `feeDrag = grossAvgR - feeOnlyAvgR`, `slipDrag = grossAvgR - slipOnlyAvgR`,
`grossAvgR - feeDrag - slipDrag` reconstructs `netAvgR` — verified below for all 12, not
assumed.

**Pre-registered "meaningfully positive" gate (decided before running the 10 families whose
gross figure wasn't already sealed — `breakout`/`anticipate` were already known from
COST-COMPONENT-ATTRIBUTION).** Reuses `runTournament`'s own promotion-bar shape (holdout
trades >= 150, T5-DECAY-EXIT's sample floor; positiveAssets/assets >= 0.5, `runTournament`'s own
`promoted` convention) but raises the avgR bar from "> 0" (any edge at all) to "> +0.10"R — a
"material R" scale already used elsewhere in this codebase (`scoreRegimeGate`'s
`avgRMin = -0.10`). Chosen because COST-COMPONENT-ATTRIBUTION already characterized a positive
sub-0.01R gross edge as "razor-thin, one-basis-point-scale" and not survivable against any real
execution friction; +0.10R is an order of magnitude above that floor, not an arbitrary round
number.

**Result — pooled, holdout, all 12 families:**

| family | trades | gross (zero-cost) | fee drag | slip/spread drag | net (default) | reconciliation | positiveAssets/assets (gross) | meaningfully positive? |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| `ma_dip` | 9,894 | +0.0877 | 4.9256 | 0.3078 | -5.1457 | 2.4e-14 | 20/28 | no (avgR < 0.10) |
| `vol_contraction` | 98 | **+0.2177** | 1.0116 | 0.0632 | -0.8571 | -6.7e-16 | 11/21 | no (trades 98 < 150) |
| `breakout` | 3,156 | +0.0637 | 0.8731 | 0.0546 | -0.8640 | -6.7e-16 | 19/28 | no (avgR < 0.10) |
| `h3` | 4,590 | +0.0329 | 1.5854 | 0.0991 | -1.6516 | 2.4e-15 | 16/28 | no (avgR < 0.10) |
| `rsi` | 2,265 | -0.0115 | 1.2409 | 0.0776 | -1.3300 | 1.8e-15 | 13/28 | no |
| `range_sweep_reclaim` | 511 | -0.0521 | 1.0047 | 0.0628 | -1.1196 | -8.9e-16 | 12/28 | no |
| `anticipate` | 3,966 | -0.0861 | 0.7511 | 0.0469 | -0.8842 | -1.1e-15 | 4/27 | no |
| `bos` | 273 | -0.1282 | 0.7282 | 0.0455 | -0.9019 | 7.8e-16 | 9/27 | no |
| `trend_pullback` | 2,017 | -0.1320 | 0.8307 | 0.0519 | -1.0146 | 0 | 6/28 | no |
| `sweep_reclaim` | 3,145 | -0.1409 | 1.0171 | 0.0636 | -1.2216 | 1.3e-15 | 4/28 | no |
| `support` | 53,640 | -0.1503 | 3.3167 | 0.2073 | -3.6742 | -1.2e-14 | 0/28 | no |
| `rev` | 24,327 | -0.1562 | 3.3610 | 0.2101 | -3.7272 | -3.1e-14 | 0/28 | no |

All 12 reconciliation discrepancies (`grossAvgR - feeDrag - slipDrag - netAvgR`) are within
3.1e-14 — far inside the < 1e-9 stated tolerance, no gap to explain away. Trade counts are
identical across all four cost configurations for every family (verified programmatically, not
just spot-checked), confirming FEE-SCHEDULE-REBASE's "cost never changes which trades fire"
claim holds project-wide, not only for the two families it was originally checked against.
`feeDrag / (feeDrag + slipDrag) = 0.9412` for all 12 families without exception — empirical
confirmation, not just the structural argument, that the fee-share ratio is
`FEE_RATE / (FEE_RATE + SLIPPAGE_PCT)` independent of family.

**4 of 12 families clear zero at gross: `ma_dip`, `vol_contraction`, `breakout`, `h3` — same
four T1 already flagged as gross-positive** (`vol_contraction` is new to this study; T1 found
the other three positive too). **None of the 12 clears the pre-registered "meaningfully
positive" gate.** `vol_contraction` is the closest and the most interesting case: its gross
avgR (+0.2177) is more than 3x `breakout`'s and clears the avgR clause outright, and its
positiveAssets/assets (11/21 = 52.4%) clears that clause too — it fails only on the trade-count
floor (98 < 150), the same shortfall that already sank it net-of-cost as `T2-VOLCONTRACTION`
(FAIL, VERDICTS.md) under the old cost basis. This is not a new lead: a 98-trade holdout sample
is the actual constraint, not fee structure, and there is no cost-side fix for a sample-size
problem.

**Comparison against T1-ZEROCOST's numbers, explained rather than averaged away.** Of the 10
families both studies ran, `sweep_reclaim` reproduces T1's trade count exactly (3,145 both
runs) and 8 of the remaining 9 move by <0.02R and <3% in trade count — consistent with ordinary
candle-corpus drift over the ~2 weeks between runs (data collection has been running
continuously; `CANDLE-CORPUS-GAP-AUDIT`, already queued, is the right place to pin down the
exact watchlist/corpus delta, not re-derived here). **`rsi` is the one real outlier and is
flagged rather than smoothed over:** T1 reported holdout avgR -0.062 at 2,260 trades; this run
gets -0.0115 at 2,265 trades — a large relative swing in avgR (a 5-trade, 0.2% change in sample
size cannot mechanically produce an 82% swing in avgR on its own unless per-asset composition
shifted). The most likely explanation given the corpus has been growing continuously is a
change in exactly which assets/candles compose that near-identical count, not a bug in either
run (both runs' 3-of-4-cost-configs trade-count-identity check passed, and `rsi`'s config in
`tournament.mjs` is untouched since T1) — but this study did not diff the two watchlists
directly and is not claiming a confirmed mechanism, only reporting the discrepancy honestly per
this item's own requirement.

**What 'meaningfully' was pre-registered to mean, stated plainly:** holdout gross avgR > +0.10R
AND holdout trades >= 150 AND positiveAssets/assets >= 0.5 — see the gate section above. Under
that definition, **zero of the 12 families in this codebase carry a meaningfully positive gross
edge.** The price-structure cost-reduction program (T1-ZEROCOST through COST-SENSITIVITY-SURFACE)
is closed with this number: even setting fees to zero and slippage aside from the trade-count
question, nothing here clears a bar an order of magnitude above what COST-COMPONENT-ATTRIBUTION
already called "razor-thin." Any future signal work in this codebase needs a new entry
mechanism, not a cost adjustment on the existing 12.

**Economic-gate study, not a formal NHST result** — this reports a point-estimate/trade-count
threshold, no p-value or null distribution, so it does not join
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family or trigger a BH-FDR recomputation. It does
join the economic-gate-only family per `AGENT_PROTOCOL.md`'s counter convention (both
`MULTIPLE_COMPARISONS_AUDIT.md` and `AGENT_PROTOCOL.md` updated in this commit). No family
cleared its literal pre-registered threshold, so the `SEALED_SYMBOLS` re-run rule
(`AGENT_PROTOCOL.md`, "a PASS ... until re-run against SEALED_SYMBOLS") does not apply — nothing
here is a promotion candidate.

**What this does NOT license.** No cost parameter (`FEE_RATE`, `SLIPPAGE_PCT`, or any override)
was changed anywhere. No family's config was changed. This is a descriptive survey of the
existing 12 configs' existing cost path, not a new signal, exit, or entry variant.

**Engineering note.** `scripts/zero-cost-floor-all-families.mjs` is additive (new file only,
zero production files touched); duplicates `tournament.mjs`'s 12-family config array verbatim
(not exported there, same convention `cost-component-attribution.mjs` already used) and imports
`backtestMultiTF`/`FEE_RATE`/`SLIPPAGE_PCT` read-only. No new tests (consistent with this
project's other throwaway `scripts/*.mjs` diagnostics — it exercises only already-tested
`backtest.js` code paths through its existing public interface). `backtest.js`, `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched.

## 2026-08-22 — PER-EPOCH-GROSS-EDGE: no epoch, in either family, carries meaningfully positive gross edge — the non-stationarity SIGNAL-DECAY found never hides a working regime

**Question, never asked before this item.** SIGNAL-DECAY-TEMPORAL-STABILITY (above) established
both `breakout`/`anticipate` baselines are non-stationary across 5 chronological epochs of each
asset's full local history (permutation ANOVA p=0.000999 both families), but reported per-epoch
**NET** avgR (default fee+slip cost) and concluded no epoch approaches breakeven.
COST-COMPONENT-ATTRIBUTION established the zero-cost **gross** floor, but only pooled across the
whole sample, never broken out by epoch. Neither asked the combined question: was there ever an
epoch where GROSS edge was meaningfully positive, later buried by pooling across epochs and/or
erased by cost? A signal that worked in one regime and died would look identical, once pooled and
charged full cost, to a signal that never worked at all — this item exists to tell those two cases
apart.

**Method.** Reuses SIGNAL-DECAY's exact epoch boundaries — `epochSlices` (imported from
`signal-decay-temporal-stability.mjs`, not re-derived: picking new boundaries after seeing results
would be the look-elsewhere error in its most tempting form), same 5 epochs, same full-local-history
convention (not a holdout split — the calendar holdout and `SEALED_SYMBOLS` are both untouched, per
this item's own scoping note), same `breakout`/`anticipate` configs from `tournament.mjs`'s
`families` table, unmodified, `entryTf: "1h"`. Each epoch slice is re-run through `backtestMultiTF`
at `feeRate: 0, slipPct: 0` — COST-COMPONENT-ATTRIBUTION's zero-cost re-derivation technique, the
same `backtest.js` cost path every cost-diagnostic in this project already uses. Coverage 28/29
watchlist assets (EOS excluded, the same pre-existing candle-history shortfall every study in this
series hits).

**Pre-registered "meaningfully positive" gate, decided before running:** reuses
ZERO-COST-FLOOR-ALL-FAMILIES's own pre-registered bar verbatim — avgR > +0.10 (an order of
magnitude above COST-COMPONENT-ATTRIBUTION's razor-thin floor) AND trades >= 150 AND
positiveAssets/assets >= 0.5 — applied **per epoch per family** (10 sub-gates: 5 epochs x 2
families), not pooled. This item deliberately reports a point-estimate/trade-count gate rather than
computing a fresh p-value against SIGNAL-DECAY's already-reported ANOVA, so it stays in the
economic-gate-only lane rather than entangling with the formal-NHST family/BH-FDR recomputation
`AGENT_PROTOCOL.md`'s binding rule would otherwise require.

**Result — `breakout` (full history, zero-cost gross, pooled per epoch across 28 assets):**

| Epoch | trades | avgR | totalR | assets w/ trades | positive assets | meaningful? |
|---|---:|---:|---:|---:|---:|:---:|
| 1 (earliest) | 2016 | +0.0084 | 17.01 | 28 | 14 | no |
| 2 | 2176 | +0.0384 | 83.52 | 28 | 15 | no |
| 3 | 2150 | +0.0930 | 199.98 | 28 | 20 | no |
| 4 | 2122 | +0.0832 | 176.57 | 28 | 19 | no |
| 5 (most recent) | 2040 | -0.0217 | -44.36 | 28 | 11 | no |

**Result — `anticipate` (full history, zero-cost gross, pooled per epoch across 28 assets):**

| Epoch | trades | avgR | totalR | assets w/ trades | positive assets | meaningful? |
|---|---:|---:|---:|---:|---:|:---:|
| 1 (earliest) | 2346 | +0.0826 | 193.83 | 28 | 17 | no |
| 2 | 2738 | +0.0500 | 137.01 | 27 | 16 | no |
| 3 | 2746 | +0.0856 | 235.14 | 28 | 18 | no |
| 4 | 3184 | -0.0499 | -158.92 | 28 | 11 | no |
| 5 (most recent) | 2560 | -0.1590 | -407.12 | 27 | 3 | no |

**Plain call: 0/10 epoch-family cells clear the pre-registered meaningfully-positive gross gate.**
`breakout` epoch 3 is the closest (+0.093, just short of the +0.10 avgR bar, and it does clear both
the trade-count and asset-share clauses on its own) — a near-miss, not a pass. The
non-stationarity SIGNAL-DECAY found is real (epoch-to-epoch avgR swings up to ~0.24R for
`anticipate`, epoch 1 vs. epoch 5), but it moves gross edge around within a band that never reaches
the pre-registered "meaningfully positive" line, let alone survives cost on top of that. **A signal
that worked in one regime and died pooled would have shown up here as a `meaningful: true` cell; none
appeared.** This closes the specific hypothesis this item was pre-registered to test — not just the
pooled-average question COST-COMPONENT-ATTRIBUTION and SIGNAL-DECAY's NET epoch table already
closed separately.

**What this does NOT license.** No cost parameter or family config was changed anywhere. This is a
descriptive re-slice of already-fixed epoch boundaries through already-tested `backtest.js` code
paths, not a new signal, exit, or entry variant, and not grounds to revisit SIGNAL-DECAY-TEMPORAL-STABILITY's
or COST-COMPONENT-ATTRIBUTION's own conclusions.

**Economic-gate study, not a formal NHST result** — reports a point-estimate/trade-count threshold,
no p-value or null distribution, so it does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s
formal-NHST family or trigger a BH-FDR recomputation. It does join the economic-gate-only family
per `AGENT_PROTOCOL.md`'s counter convention (34→35), counted as **one** study covering 10 sub-gates
— matching ZERO-COST-FLOOR-ALL-FAMILIES's own precedent for a multi-sub-gate run (both
`MULTIPLE_COMPARISONS_AUDIT.md` and `AGENT_PROTOCOL.md` updated in this commit, along with the
overall study-count total, 49→50). No epoch-family cell cleared its literal pre-registered
threshold, so the `SEALED_SYMBOLS` re-run rule does not apply — nothing here is a live promotion
candidate. No VERDICTS.md row added, matching the precedent COST-COMPONENT-ATTRIBUTION,
EQUITIES-BREAKOUT-SIGNIFICANCE, and ZERO-COST-FLOOR-ALL-FAMILIES already set for diagnostic
studies that re-derive existing already-recorded families rather than introduce a new hypothesis
needing duplicate-proposal protection.

**Engineering note.** `scripts/per-epoch-gross-edge.mjs` is additive (new file only, zero
production files touched); imports `epochSlices` directly from `signal-decay-temporal-stability.mjs`
(exported there, reused rather than re-derived) and duplicates `tournament.mjs`'s
`breakout`/`anticipate` config rows verbatim (not exported there, same convention every other
diagnostic script in this project already uses) plus `backtestMultiTF` read-only. No new tests
(consistent with this project's other throwaway `scripts/*.mjs` diagnostics — it exercises only
already-tested `backtest.js`/`epochSlices` code paths through their existing public interfaces).
`backtest.js`, `strategy.js`, `tournament.mjs`, `signal-decay-temporal-stability.mjs`, `monitor.js`,
`bot.js`, `trader.js`, `scanner.js` — all untouched. `npm.cmd test`: 499/499 green before and after.

## 2026-08-22 — WALKFORWARD-REVALIDATION-OF-BASELINE: `anticipate`'s fold-to-fold drift is statistically significant, `breakout`'s isn't — the single split is not uniformly adequate

**Question, never asked before this item.** Every one of the 45+ studies inventoried in
`MULTIPLE_COMPARISONS_AUDIT.md` scored `breakout`/`anticipate` against a single chronological
70/30 train/holdout split. SIGNAL-DECAY-TEMPORAL-STABILITY (2026-08-19, above) then showed the
underlying baseline is non-stationary across 5 disjoint calendar epochs — which turns the single
split from a stylistic choice into a methodological question: a threshold fitted (or in this
project's case, pre-registered) once and scored on one fixed holdout drawn from a demonstrably
drifting series conflates "no edge" with "regime changed during this particular holdout window,"
and a single number can't tell the two apart. `researchlib.mjs`'s `walkForwardSeriesWindows` —
built by JUDGE-WALKFORWARD-SYMBOL-HOLDOUT specifically for this and, per
`MULTIPLE_COMPARISONS_AUDIT.md` §1, never invoked by any study before this one — exists
precisely to answer it: does rolling re-scoring across successive out-of-sample slices change
the picture, or is the single split an adequate summary?

**Method.** `walkforward-revalidation.mjs` (new file). `walkForwardSeriesWindows(series, {folds:
4, trainFraction: 0.5})` over each asset's full local candle history: train grows from the first
half, holdout runs across 4 successive slices spanning the remaining half. Each fold's holdout is
scored independently with the exact `breakout`/`anticipate` baseline configs from
`tournament.mjs`'s `families` table (unmodified, `entryTf: "1h"`, duplicated locally — same
convention `signal-decay-temporal-stability.mjs` already established, chosen there over exporting
`tournament.mjs`'s internal `families` array). No parameter is fit per fold — these are fixed
pre-registered hyperparameters, not thresholds tuned on train, so "walk-forward" here means
re-scoring across successive slices, not re-fitting. Per-fold per-trade R values are pooled
across assets (28 watchlist assets minus EOS's pre-existing candle-history shortfall, minus the
5 `SEALED_SYMBOLS` — this item's own scoping note is explicit that the sealed pool is reserved
for the eventual final validation, not spent here — leaving **23 eligible assets**). Dispersion
across the 4 folds is tested with `oneWayAnovaF`/`permutationAnovaP`, imported directly from
`signal-decay-temporal-stability.mjs` rather than re-derived (same purpose — is between-fold
variance larger than within-fold sampling noise would explain — applied to a different partition
of the same history: 4 rolling holdout slices instead of 5 disjoint epochs). The single-split
comparison figure is recomputed over the SAME 23-asset eligible pool (not the previously
published 28-asset pooled figure) at `tournament.mjs`'s own `split=0.70` default, so the two
numbers are directly comparable rather than differing by asset-pool composition as well as by
method.

**Calendar-holdout disclosure (explicit, per `AGENT_PROTOCOL.md`'s binding rule).** This study
uses each asset's full local history, which necessarily re-examines the 2025-06-01–present
window already retired as a "fresh" holdout by ~27 prior studies. Disclosed here rather than
silently — the same tradeoff SIGNAL-DECAY-TEMPORAL-STABILITY already made for the same reason:
the question is about the existing baseline's behavior across its own available sample, not a
fresh-holdout test of a new hypothesis.

**Result — `breakout` (4 folds, pooled across 23 assets; single-split comparison also
23-asset):**

| Fold | trades | avgR | totalR | 95% CI |
|---|---:|---:|---:|---|
| 1 (earliest) | 1068 | -0.810 | -864.63 | [-0.909, -0.711] |
| 2 | 999 | -0.779 | -778.37 | [-0.882, -0.676] |
| 3 | 1036 | -0.944 | -978.46 | [-1.038, -0.851] |
| 4 (most recent) | 939 | -0.897 | -842.64 | [-0.997, -0.798] |

Single-split (70/30, same 23-asset pool): 2409 trades, avgR -0.893, totalR -2151.56.
Fold dispersion (max-min avgR): 0.165. ANOVA F(3, 4038) = 2.331, permutation p = 0.076 (1000
iterations). **NO SIGNIFICANT DISPERSION** at p<0.05 — fold-to-fold variation here is consistent
with sampling noise around one underlying mean.

**Result — `anticipate` (4 folds, pooled across 23 assets; single-split comparison also
23-asset):**

| Fold | trades | avgR | totalR | 95% CI |
|---|---:|---:|---:|---|
| 1 (earliest) | 1317 | -0.673 | -886.80 | [-0.768, -0.578] |
| 2 | 1486 | -0.823 | -1223.61 | [-0.905, -0.742] |
| 3 | 1258 | -0.910 | -1144.54 | [-0.997, -0.823] |
| 4 (most recent) | 1134 | -0.974 | -1104.79 | [-1.061, -0.888] |

Single-split (70/30, same 23-asset pool): 2924 trades, avgR -0.902, totalR -2638.30.
Fold dispersion (max-min avgR): 0.301. ANOVA F(3, 5191) = 8.131, permutation p = 0.000999 (1000
iterations — the floor at this iteration count). **SIGNIFICANT DISPERSION** at p<0.05.

**Reading it.** The two families give different answers to this item's central question.
`anticipate`'s 4 rolling folds decline monotonically and significantly (-0.673 → -0.823 → -0.910
→ -0.974, a 0.30R swing on the identical unmodified config), and the ANOVA rejects the
single-mean hypothesis at p=0.001 — for this family, a pooled 70/30 split genuinely does mask
real fold-to-fold movement, in the same direction SIGNAL-DECAY-TEMPORAL-STABILITY's epoch table
already found (worst in the most recent slice of history). `breakout` does not replicate that
result under this partition: its 4 folds move within a narrower band (0.165R) that a permutation
test can't distinguish from noise (p=0.076), even though SIGNAL-DECAY-TEMPORAL-STABILITY's
5-epoch ANOVA on the *same* underlying `breakout` history called it non-stationary at p=0.001.
That is not a contradiction — it is this item's own question answered concretely: **the choice
of judge (disjoint fixed epochs vs. expanding-train rolling folds, 5 groups vs. 4) can itself
flip a dispersion call** on identical underlying data. Neither number is "more correct" in the
abstract; they test different things (fixed-epoch group means vs. rolling out-of-sample fold
means), and this item's finding is that the two don't always agree. Both families, under every
partition tried anywhere in this project, stay decisively negative in every fold and every
epoch — nothing here surfaces a hidden profitable regime or approaches breakeven at any point.

**What this changes, and what it does NOT change.** Per this item's own task wording, no
existing verdict is reopened or altered — every pooled avgR figure already on record in
VERDICTS.md/TOURNAMENT_ROADMAP.md/ROADMAP.md stands as written. What this item establishes:
whether a single 70/30 split is an "adequate summary" of the underlying history is
family-dependent, not a property of the harness in general — true (can't reject a single mean)
for `breakout` under this test, false (rejects a single mean) for `anticipate`. This is a
methodology finding about which judge to reach for, not a new positive signal and not grounds to
revisit SIGNAL-DECAY-TEMPORAL-STABILITY's own (differently partitioned) non-stationarity call for
`breakout`.

**Recommendation (not an implementation, per this item's own done_when).** Written into
`AGENT_PROTOCOL.md` below: future studies that need to characterize `anticipate`'s baseline
reliability (as opposed to running a fresh pre-registered economic/NHST gate, which this item
does not touch) should prefer per-fold walk-forward reporting
(`walkForwardSeriesWindows`/`walkForwardWindows`, now that this item has exercised the harness
end-to-end) or at minimum disclose per-fold dispersion alongside any single pooled avgR quoted
for `anticipate`. `breakout`'s single split is not shown to be misleading by this test and does
not need the same treatment on this evidence alone.

**Engineering note.** `walkforward-revalidation.mjs` (new file, additive) and
`walkforward-revalidation.test.mjs` (5 new tests: insufficient-coverage handling, SEALED_SYMBOLS
exclusion, 4-fold shape/presence for both families, per-fold trade-count bookkeeping, and a
real-candle non-zero-trade sanity check) — both new, zero production files touched. Imports
`walkForwardSeriesWindows`/`splitSealedSymbols` from `researchlib.mjs` and
`oneWayAnovaF`/`permutationAnovaP` from `signal-decay-temporal-stability.mjs` (both already
independently tested there, reused rather than re-derived). `backtest.js`, `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched; grep
confirmed before commit that none of the protected trading-safety identifiers appear anywhere in
this diff. Descriptive study, no pre-registered gate, no p-value evaluated against a pass/fail
threshold (matching SIGNAL-DECAY-TEMPORAL-STABILITY's own precedent) — does not join
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family and does not trigger a BH-FDR
recomputation, per this item's own scoping note. No VERDICTS.md row (no gate exists to record).
`npm.cmd test`: 500/500 green before, 505/505 green after.

## 2026-08-22 — CANDLE-CORPUS-GAP-AUDIT: 26 of 29 watchlist assets have not collected a new candle since 2026-03-31 — every "full local history" claim made by any study run after that date is silently truncated for everything but BTC/ETH/SOL

**Never done before.** `researchlab.mjs`'s `loadResearchCandlesWithQuality` has computed a
`gaps` array (via `data.js`'s `resampleBars`) at every one of this project's ~27 prior study
invocations, with `gapPolicy` defaulting to `"allow"` at every call site. `loadResearchCandles`
(the function every study actually imports) discards `gaps` and returns only `.candles`
(`researchlab.mjs:92-93`) — grep-confirmed before this item started that no prior study has ever
read the discarded array. This item is the first to look at what it contains.

**Method.** New read-only diagnostic `scripts/candle-corpus-gap-audit.mjs` (not part of the app).
For every symbol in the full 29-asset watchlist (`loadWatchlist()`, SEALED_SYMBOLS included —
see "SEALED_SYMBOLS" below) and each of the three live entry timeframes (1h/4h/1d,
`researchlib.mjs`'s `TFS`), calls `loadResearchCandlesWithQuality(pair, minutes, { gapPolicy:
"allow" })` and reports gap count, largest gap, total missing bar-time as a fraction of the
covered window, and a train/holdout (70/30 chronological, this project's standard split)
distribution of gap-time. Full per-row JSON persisted via `saveExperiment`.

**SEALED_SYMBOLS.** Included in this audit's universe, unlike every train/holdout performance
sweep. `researchlib.mjs`'s own docstring reserves the seal specifically for "any train/holdout
cycle" measuring *edge* — counting missing bars touches no strategy result and reveals nothing
about performance on sealed symbols, so it does not spend the holdout in the sense that doc
warns against. Flagged explicitly here as a judgment call rather than decided silently.

**Finding 0 (methodological, not a data defect): raw gaps are timeframe-invariant.**
`resampleBars` computes its `gaps` array by walking the sorted **1-minute** bars from `loadBars`
*before* binning into the requested `minutes` — so the gap list itself (from/to/seconds) is
byte-identical whether `loadResearchCandlesWithQuality` is called with `minutes=60`, `240`, or
`1440` on the same pair. What genuinely differs per timeframe is how much a given raw gap costs
that timeframe's own candle series (a 45-minute hole is invisible to a 1d candle, but can eat
most of a 1h one) — reported per-row as `largestGapCandles`/`missingCandleEquivalent`
(gap-seconds divided by that timeframe's own span). No prior study documented this.

**Finding 1 — THE HEADLINE, and the most consequential of everything this item found: a live
collection stall since 2026-04-01, affecting 26 of 29 watchlist assets.** `gaps[]` only diffs
between bars that both already exist — it is structurally blind to the trailing edge between the
last stored candle and wall-clock "now." A stalled collector produces *no* internal gap at all;
it just produces a corpus that quietly stops. This item added a separate `stalenessDays` metric
(now − last stored candle) specifically to see that edge, and it is not subtle:

| Cohort | Last candle | Staleness (as of this run, 2026-08-22) |
|---|---|---|
| BTC, ETH, SOL | 2026-07-29/30/31 | ~23 days |
| The other 26 watchlist assets | **2026-03-31 23:xx UTC**, all within the same minute-scale window | **~143 days** |
| EOS | 2025-06-30 | **~417 days** |

Every candle file's OS `mtime` is clustered around 2026-07-30/31 — the on-disk files *were*
rewritten recently (a real archive-ingest ran three and a half weeks before this audit) — but for
26 of 29 assets, whatever archive that ingest pulled only contained data through 2026-03-31.
Read plainly: on 2026-07-30 the local collector/archive-ingest process successfully advanced
BTC, ETH, and SOL through the end of July, and simultaneously failed to advance every other asset
past the end of March — a four-month gap between "when the file was last touched" and "what the
file actually contains," identical to the minute across 26 unrelated assets. This is exactly the
"collection stall" scenario this item's own task text hypothesized going in, now confirmed with
dates. It is a local-machine/collector-process fact, not a backtest bug: `loadResearchCandles`
always returns whatever is actually on disk and never fabricates a bar, so no prior result is
*numerically wrong*. But every recent study's own description of its window — "full local
history," "through the present," "current holdout" — is true only for BTC/ETH/SOL. For the other
26 assets it silently means "through 2026-03-31." **This affects every study run in this project
since approximately April 2026**, including two from today: WALKFORWARD-REVALIDATION-OF-BASELINE
and PER-EPOCH-GROSS-EDGE both describe their input as "full local history" for the 23/24-asset
active pool — for all but BTC/ETH/SOL within that pool, that phrase silently means "history
ending 2026-03-31," not "as of today." Nothing in either write-up disclosed this, because neither
item (nor any prior one) had this measurement available. Re-running either study is not this
item's job (measurement only, per its own task wording) — recorded here so the human/next study
that touches "freshness" of any recent verdict has the real number instead of an assumed one.

**Finding 2 — EOS: not stale, effectively stopped.** EOS's last stored candle is 2025-06-30,
~417 days behind "now" — worse than the other 26 by a factor of ~3, and on a completely different
ingest run (`mtime` 2026-07-16, not the 2026-07-30/31 cluster the rest share). This corroborates,
with a concrete number for the first time, the exclusion `WALKFORWARD-REVALIDATION-OF-BASELINE`
(same day, this session) applied on `EOS`'s "pre-existing candle-history shortfall" — that call
was correct, and was made on qualitative knowledge; this item supplies the first quantification.
Separately consistent with `WATCHLIST-LIQUIDITY-REALISM-AUDIT`'s (2026-08-20) finding that EOS
has no Kraken Futures perpetual listing at all — two independent signals pointing at EOS as
functionally delisted/discontinued for this project's purposes, not merely thin.

**Finding 3 — a second, distinct short-history cohort, corroborating a prior study's own
independent discovery.** Eight symbols (ETC, XTZ, BCH, ALGO, ZEC, TRX, XLM, XMR) have candle
history starting **2025-01-22** rather than 2023-01-01/the asset's listing date — roughly 14
months of history versus ~3.25 years for the rest of the majors cohort. This is not a gap inside
a tracked window; it is a later collection start (the watchlist grew, and the collector began
tracking these assets partway through the project's life). Seven of these eight
(ALGO/BCH/ETC/TRX/XLM/XMR/XTZ) exactly match the list `PAIRS-COINTEGRATION-STATARB` (2026-08-19)
independently found and excluded via its own ">=500-day overlap floor" ("160-434 days" —
matches this item's per-asset `candleCount`/window figures exactly). This item's contribution is
confirming that finding from the gap-audit side and extending the same observation to ZEC, which
`PAIRS-COINTEGRATION-STATARB`'s own list did not name (ZEC's total local history, 434 daily
candles from 2025-01-22, is short by the same 500-day floor that study used — worth the human
checking whether ZEC was mis-scoped there or genuinely cleared some other overlap-history path
this item didn't re-derive).

**Finding 4 — five short, simultaneous, nearly-watchlist-wide outages, real collector downtime
rather than per-asset illiquidity.** Cross-referencing each asset's single largest raw gap
(independent of the timeframe tables — see `scripts/candle-corpus-gap-audit.mjs`'s own note on
timeframe-invariance) shows five dates where 10-19 unrelated assets all show a multi-hour gap
starting within minutes of each other:

| Date (UTC) | Assets affected | Duration |
|---|---|---|
| 2024-01-20 ~15:57-16:00 | 19 assets (nearly the then-full watchlist) | ~5.6-5.7h |
| 2024-04-14 ~02:57-03:00 | 17 assets | ~6.8-6.9h |
| 2025-01-25 ~14:32-14:37 | 10 assets (the 2025-01-22 cohort's first week) | ~3.5h |
| 2025-08-28 ~08:07-08:08 | 5 assets | ~1.9h |
| 2025-11-01 ~14:31-15:02 | 23 assets (nearly the full current watchlist) | ~6.7-7.3h |

Timestamps landing within a couple of minutes of each other across a dozen-plus unrelated
symbols, each time, is not explainable by per-asset trading inactivity — it is direct evidence of
five real collector/infra outages. All five are brief relative to the ~3-year history (under 2
days total across the whole project when summed) and affect assets roughly uniformly, so a
pooled cross-family/cross-strategy comparison run over the same corpus is unlikely to be
differentially biased by them — but any single per-trade backtest silently steps over each one as
if no time passed.

**Finding 5 — POL: three multi-day blackouts totaling ~20 days in 2024, the one clearly
asset-specific severe case beyond the two above.** Independent of the five shared-outage dates,
POL alone has three much larger gaps nobody else shares: 2024-01-30→02-07 (199.9h, 8.3 days),
2024-05-01→05-09 (204.5h, 8.5 days), 2024-07-13→07-21 (188.0h, 7.8 days) — roughly 20 cumulative
days missing out of POL's ~850-day covered window (~2.4%, well under the diffuse-noise
percentages below but concentrated in three real blackouts rather than smeared across thousands
of short gaps). Worth a footnote against `PAIRS-COINTEGRATION-STATARB`: FIL/POL was one of that
study's three closest non-surviving pairs (raw p=0.0050, corrected q=0.1741, more than 3x past
the 0.05 threshold) — the gap does not change that pair's outcome (it failed BH-FDR regardless of
data quality), but the human should know POL's own history carries real discontinuities before
treating any future POL-specific finding as clean.

**Finding 6 — the aggregate "missing fraction" figures are dominated by diffuse short-gap noise,
most plausibly live-collector uptime rather than exchange unavailability.** Project-wide (all 29
assets, raw 1-minute level, independent of the per-timeframe tables): 5,279,891 total gap events,
totaling ~11,818 gap-days. 87.1% of gap *events* are ≤5 minutes, accounting for 50.2% of total
missing *time*; 12.8% of events are 5min-1h (45.1% of missing time); only 0.1% of events are over
an hour, but they still account for 4.7% of missing time (this is where Findings 4 and 5 live).
Per-asset, on the 1d timeframe, missing fraction of the covered window ranges from BTC's 0.60%
up to ETC's 85.43% — every asset except BTC/ETH/SOL exceeds this item's stated 1% flag threshold
(84 of 87 asset/timeframe rows flagged in total). The dominant short-gap pattern (a two-minute
average gap length, repeated hundreds of thousands of times over three years) is not consistent
with real per-minute trading inactivity for actively-traded majors and mid-caps on a top-tier
exchange; it is far more consistent with the live collector's own uptime having gaps between the
quarterly archive top-ups `data.js`'s own archive-ingest docstring describes (deploys, restarts,
transient errors) that later get partially but not fully backfilled. This item did not
instrument the collector itself to confirm the mechanism directly — that would be a different,
non-measurement task — so this is stated as the most plausible explanation, not a proven one.

**Explicit call, per this item's own done_when.** Yes — coverage gaps are bad enough to matter,
in four concrete, separable ways, not one diffuse blob:
1. **The April 2026 collection stall (Finding 1) is new, unknown to any prior study, and affects
   every recent verdict's implicit "how current is this" claim for every asset but BTC/ETH/SOL** —
   the most consequential finding here. Not previously worked around by anything.
2. **EOS's near-total staleness (Finding 2)** was already worked around (excluded) by
   `WALKFORWARD-REVALIDATION-OF-BASELINE` on qualitative grounds; this item is the first to give
   it a number and independently corroborate the decision.
3. **The 2025-01-22 short-history cohort (Finding 3)** was already worked around (excluded via a
   500-day floor) by `PAIRS-COINTEGRATION-STATARB` for its own purposes; this item corroborates
   that list from a different angle and flags that other studies pooling "the watchlist" without
   an equivalent floor carry a much smaller effective N for these eight symbols than for the
   majors, undisclosed until now.
4. **POL's three 2024 blackouts (Finding 5)** are a real, asset-specific discontinuity worth a
   standing footnote against any current or future POL-specific finding, most immediately
   `PAIRS-COINTEGRATION-STATARB`'s FIL/POL near-miss (outcome unchanged, correction still fails).

Finding 4 (the five shared brief outages) and Finding 6 (diffuse short-gap noise) are real and
now measured, but neither rises to "materially affected a specific existing verdict" on the
evidence gathered here — they are close to uniform across assets and families, which is the
condition under which a *relative* comparison (this project's dominant methodology: which family
beats which, which epoch beats which) is least distorted by an *absolute* data-completeness
issue.

**Not touched, exactly per this item's done_when.** No candle file modified. No interpolation.
No watchlist change (WATCHLIST/`config.json` untouched — POL/EOS/the 2025-01-22 cohort remain in
the live watchlist; any exclusion decision is the human's, same standing rule as
`WATCHLIST-LIQUIDITY-REALISM-AUDIT`). No existing VERDICTS.md row altered.

**Multiple-comparisons discipline.** This item produces no p-value evaluated against a
pre-registered pass/fail gate — every number above is a count, a duration, or a fraction, not a
significance test — so `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family is untouched, per
this item's own note and matching `WATCHLIST-LIQUIDITY-REALISM-AUDIT`'s identical precedent.

**Engineering note.** `scripts/candle-corpus-gap-audit.mjs` (new file, additive, read-only
diagnostic — same "not part of the app" convention as
`scripts/watchlist-liquidity-realism-audit.mjs`, which also has no companion test file; this item
follows that precedent rather than adding one, since it touches zero production files and adds no
new exported logic to any library module — it only calls existing, already-tested
`researchlib.mjs`/`researchlab.mjs` exports). `data.js`, `researchlib.mjs`, `researchlab.mjs`,
`backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js`
— all untouched; grep-confirmed before commit that none of the protected trading-safety
identifiers appear anywhere in this diff. `npm.cmd test`: 505/505 green before and after (no
production file changed, no new test file expected on this precedent).

## 2026-08-22 — EQUITIES-COST-ASSUMPTION-SENSITIVITY: `breakout`'s net-positive equities result survives every plausible slippage citation, breaks only past 45bps; the unmodeled $1 commission floor binds well within a realistic retail position size

`EQUITIES-BASELINE-PORT` (2026-08-19) reported `breakout` net +0.1866R over 61 real-IBKR-cost
holdout trades — this project's first net-positive real-cost result. That writeup flagged two
components of its own cost basis as *assumptions*, not measurements: slippage/spread at 5bps/side
("a deliberately conservative estimate," not measured from IBKR's own NBBO tick history), and the
IBKR Fixed plan's USD 1.00/order commission minimum, which was not modeled at all because this
backtest works in R-multiples with no share count to check a floor against. This item maps both,
without touching the original headline number, its cost basis, or its data.

**Scope: `breakout` only.** `anticipate` is already net negative (-0.0438R,
`EQUITIES-BREAKOUT-SIGNIFICANCE`, 2026-08-21) — its sign is not in question here.

**Method — the linear-cost identity, re-verified a third time.** `backtest.js`'s net-R formula is
affine in `slipPct` with a per-trade coefficient independent of `slipPct`, and cost never changes
which trades fire — established by `COST-COMPONENT-ATTRIBUTION`, re-verified per-symbol by
`HOLDING-PERIOD-COST-AMORTIZATION-MAP`, reused for a 2-D grid by `COST-SENSITIVITY-SURFACE`. Same
identity here, one axis: commission is held FIXED at `EQUITIES-BASELINE-PORT`'s own per-symbol
rate (`commissionPerShare / thatSymbol'sOwnAvgHoldoutClose`, unchanged), only slippage varies.
`netAvgR(slip) = feeOnlyAvgR - slipUnitDragAvgR * slip`, both terms derived from two backtest
passes. Every one of the 10 grid points below was ALSO re-run directly through `backtest.js`
(not just evaluated analytically) — max discrepancy between analytic and direct across all 10
points: `5.6e-16`, floating-point noise, not a modeling gap.

**Replication check.** `feeOnlyAvgR` (commission only, slip=0) = +0.2097R; `netDefaultAvgR` at the
baseline's own 5bps slip = +0.18662R over 61 trades — matches `EQUITIES-BASELINE-PORT`'s recorded
+0.1866R bit-for-bit off the same cache before any new statistic is computed.

**Slippage sensitivity grid** (same citations as `EQUITIES-BASELINE-PORT`'s own header — "penny
wide" / ≤15bps commonly cited for large-cap spreads, 2024 Nasdaq Research institutional S&P 500
impact ~4.5bps):

| slip assumption | net avgR (61 trades) |
|---|---:|
| 0bps (idealized) | +0.2097 |
| 2bps | +0.2005 |
| 4.5bps (institutional impact citation) | +0.1889 |
| 5bps (baseline default) | +0.1866 |
| 10bps | +0.1635 |
| 15bps (upper "penny wide" citation) | +0.1405 |
| 20bps | +0.1174 |
| 30bps | +0.0712 |
| 50bps (pessimistic) | **-0.0211** |
| 100bps (stress point, not a real large-cap estimate) | -0.2520 |

**Break-even slippage: 45.42bps** (exact, from the linear formula — not an interpolation guess;
confirmed bracketed by the direct 30bps/50bps grid points, which flip sign either side of it).
That is roughly **9x the baseline's own 5bps assumption**, and well past every plausible-range
citation in either this item's or `EQUITIES-BASELINE-PORT`'s header (≤15bps "penny wide," ~4.5bps
institutional). **Verdict on this axis: the positive sign is robust to the slippage assumption
across every citation this project has sourced — it only breaks under an assumption that has no
supporting citation in this project's own record.**

**Commission-floor reasoning (stated arithmetic against real cited figures, not simulated — this
backtest has no share count to simulate against).** IBKR Fixed plan: USD 0.005/share, USD 1.00
minimum per order. The floor binds whenever an order's share count is below `1.00/0.005 = 200`
shares, regardless of price. Converted to a dollar position size using each of the 30 universe
symbols' own holdout `avgClose` (reusing `EQUITIES-BASELINE-PORT`'s own per-symbol price
convention): floor-binds-below ranges from **~$6,692 (DOW, the cheapest-priced name)** to
**~$192,127 (GS, the priciest)**, median **~$47,928** across the 30-symbol universe. **Verdict on
this axis: for a plausible retail or small-account position size — a few thousand to a few tens
of thousands of dollars per trade, well under the ~$48k median threshold and under even the
cheapest name's ~$6.7k threshold for anything but a near-full-account single position — the $1.00
floor would very plausibly bind on most trades in this universe.** When it binds, the true
commission paid exceeds the per-share rate this backtest modeled, meaning the reported net R is
optimistic in that direction for any account trading below roughly the low tens of thousands of
dollars per position; only an account sizing positions large enough to clear the ~$48k median
threshold on most names would consistently avoid it. This is a real, unquantified (in R terms)
downward pressure on the headline net figure that a full position-sizing model would need to
capture — out of scope for this backtest's R-multiple design, stated here rather than silently
absorbed into the +0.1866R figure as if it were already accounted for.

**Combined verdict.** The positive sign survives every slippage citation this project has
sourced, with a wide margin (9x) before it breaks — that axis is genuinely robust, not fragile.
The commission-floor axis is not disprovable from this backtest's own data (no position sizing to
check it against) but is not favorable either: the floor binds well within a realistic account's
per-trade position size for most of the universe, meaning the reported net avgR is more likely
optimistic than pessimistic once real order-level costs are fully modeled. Net read: the sign is
not an artifact of the slippage assumption, but it is not fully cost-complete either — a genuine
position-sizing-aware re-run (out of this item's scope) is the natural follow-on before this
result is treated as more than a promising point estimate, especially given
`EQUITIES-BREAKOUT-SIGNIFICANCE`'s own finding that the 95% CI already includes zero.

**Not touched, exactly per this item's done_when.** `EQUITIES-BASELINE-PORT`'s original cost
basis, headline number, and cache untouched — this item only reads the existing
`research-cache/equities-1d/` cache (no egress, no live IBKR Gateway call). No VERDICTS.md row
added or altered. No config, universe, or entry/exit parameter changed.

**Multiple-comparisons discipline.** This item computes no p-value against a pre-registered gate —
every number above is a deterministic backtest re-price or an analytic derivation from two
backtest passes, not a hypothesis test — so `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family
is untouched, matching this item's own note and `COST-SENSITIVITY-SURFACE`'s identical precedent.

**Engineering note.** `scripts/equities-cost-assumption-sensitivity.mjs` (new file, additive,
read-only diagnostic — same "not part of the app" convention as `cost-sensitivity-surface.mjs`,
which also has no companion test file; this item follows that precedent, touching zero production
files and adding no new exported logic to any library module — it only calls existing, already-
tested `backtest.js`/`researchlab.mjs` exports and reads the existing equities cache).
`equities-baseline-port.mjs`, `data.js`, `researchlib.mjs`, `researchlab.mjs`, `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` — all untouched;
grep-confirmed before commit, against the actual staged diff, that none of the protected
trading-safety identifiers appear anywhere in it. `npm.cmd test`: 505/505 green before and after
(no production file changed, no new test file expected on this precedent).

## 2026-08-22 — EQUITIES-ALL-FAMILIES-BASELINE: 10 of 12 unmodified families produce a positive net avgR on the equity universe, but sample size ranges from 475 trades down to 0 — this is a breadth measurement, not a promotion

`EQUITIES-BASELINE-PORT` (2026-08-19) ran only two of `tournament.mjs`'s twelve families
(`breakout`, `anticipate`) on the equity universe and found a striking gross-edge gap versus
crypto — `breakout` gross +0.2110R on equities vs +0.0091R on crypto for identical, unmodified
logic.

> **Note added 2026-08-22 (same correction as the block under EQUITIES-BASELINE-PORT's own
> table):** the "+0.0091R on crypto" in the sentence above is `COST-COMPONENT-ATTRIBUTION`'s
> zero-**fee** floor, with slippage still charged — not its zero-**cost** gross, which is
> **+0.0637R**. The like-for-like gross gap is **3.3x**, not the 23x that figure implies. This
> section repeated the error because the correction was still sitting in an unmerged branch
> when it was written; nothing in this study's own results depends on it. It left the obvious question unasked: how do the other ten families behave on the same
data? This item answers it. **This is a breadth measurement to find where to look, not a
promotion of whichever family scores highest** — running twelve families and reporting only the
best would itself be exactly the twelve-test multiple-comparisons violation
`MULTIPLE_COMPARISONS_AUDIT.md` was written to prevent. Every family's number is reported below,
including the bad ones and the unusably small ones.

**Method — identical pipeline, only the config array widened.** New file
`scripts/equities-all-families-baseline.mjs`, a straight extension of
`equities-baseline-port.mjs`: same 30-symbol Dow-30-as-of-2024-08-19 universe (point-in-time
membership, INTC/DOW included, Walgreens excluded — see that file's header), same 0.70
train/holdout split, same cost basis (IBKR Fixed commission $0.005/share via each symbol's own
holdout avgClose, 5bps/side slippage), same `research-cache/equities-1d/` cache (all 30 symbols
already cached from prior equities studies — no live IBKR Gateway call needed for this run, 30/30
datasets used). The only change: all 12 of `tournament.mjs`'s `families` array configs
(duplicated verbatim, same convention as `equities-baseline-port.mjs` and
`zero-cost-floor-all-families.mjs`) run through `backtestMultiTF` instead of just 2.

**Replication check.** `breakout`: 61 trades, net avgR +0.1866 — matches `EQUITIES-BASELINE-PORT`
and `EQUITIES-COST-ASSUMPTION-SENSITIVITY` bit-for-bit off the same cache. `anticipate`: 303
trades, net avgR -0.0438 — matches the figure already on record from
`EQUITIES-BREAKOUT-SIGNIFICANCE`. Both known-good before any new number is trusted.

**Result — pooled, holdout, all 12 families, same equity universe and cost basis:**

| family | trades | gross avgR | net avgR |
|---|---:|---:|---:|
| `ma_dip` | 475 | +0.3430 | +0.1526 |
| `rsi` | 32 | +0.2934 | +0.2507 |
| `bos` | 60 | +0.2035 | +0.1728 |
| `breakout` | 61 | +0.2110 | +0.1866 |
| `h3` | 106 | +0.1645 | +0.1178 |
| `range_sweep_reclaim` | 3 | +1.0000 | +0.9656 |
| `support` | 407 | +0.1003 | +0.0014 |
| `sweep_reclaim` | 92 | +0.0761 | +0.0328 |
| `rev` | 179 | +0.0613 | -0.0501 |
| `anticipate` | 303 | -0.0019 | -0.0438 |
| `trend_pullback` | 38 | -0.1721 | -0.2026 |
| `vol_contraction` | 0 | 0 (no trades) | 0 (no trades) |

**Trade counts, stated prominently as this item's done_when requires.** Sample size on this
30-symbol daily universe ranges from `ma_dip`'s 475 down to `vol_contraction`'s **zero** —
`vol_contraction` fired not one holdout trade on this universe, a config that produced 98 trades
on the full crypto watchlist in `ZERO-COST-FLOOR-ALL-FAMILIES`. `range_sweep_reclaim`'s +0.9656
net avgR is the most extreme number in the table and the least trustworthy: 3 trades is not a
sample, it is 3 coin flips, and this figure should not be read as edge. `rsi` (32 trades) and
`bos` (60 trades) are directionally interesting but still thin next to `ma_dip` (475),
`support` (407), or `anticipate` (303).

**8 of 12 families net-positive; only 2 (`rev`, `anticipate`) flip sign from gross to net; 1
(`trend_pullback`) is negative both gross and net; `vol_contraction` produced no trades to
sign at all.** `ma_dip` stands out as the one family combining both a large sample (475 trades,
the second-largest in the table) and a comfortably net-positive avgR (+0.1526) — the strongest
candidate this table surfaces for a next look, precisely because breadth of sample is what
`breakout`'s own 61-trade result and `EQUITIES-BREAKOUT-SIGNIFICANCE`'s CI-includes-zero finding
have both been missing. That is a pointer for future work, not a verdict: `ma_dip` has not been
significance-tested, cost-sensitivity-mapped, or out-of-sample-checked the way `breakout` has,
and doing so is explicitly out of this item's scope.

**The twelve-test multiple-comparisons implication, stated explicitly per this item's own
done_when.** Twelve families were run and reported here; picking `ma_dip` (or any single row)
as "the" result because it looks best would be a twelve-test look-elsewhere problem, the same
shape `ZERO-COST-FLOOR-ALL-FAMILIES` and `PER-EPOCH-GROSS-EDGE` already quantified for the
crypto side of this project — nothing here computes a p-value or a pre-registered pass/fail
gate, so there is no formal correction to apply, but the absence of a gate does not make the
breadth-of-attempts problem disappear. No family is promoted by this study. Any future study
that picks `ma_dip` (or any other row here) up for deeper testing must count this item's twelve
looks as part of that family's own multiple-comparisons accounting, not treat it as a fresh
start.

**Not touched, exactly per this item's done_when.** No family promoted, no VERDICTS.md row
added, no config, universe, or cost parameter changed anywhere. `EQUITIES-BASELINE-PORT`'s
original headline number and cache untouched — this item only reads the existing
`research-cache/equities-1d/` cache (all 30 symbols already present; no egress, no live IBKR
Gateway call).

**Multiple-comparisons discipline.** This item computes no p-value against a pre-registered
gate and defines no promotion threshold — a plain descriptive report of gross/net avgR and
trade count per family, matching `EQUITIES-COST-ASSUMPTION-SENSITIVITY`'s and
`COST-SENSITIVITY-SURFACE`'s precedent for not joining the formal-NHST or economic-gate
counters in `AGENT_PROTOCOL.md`. It does, however, consume the same equity holdout window
already examined by three prior equities studies for ten families that had never been run on
it before — per `MULTIPLE_COMPARISONS_AUDIT.md` §1's own treatment of
`SEASONALITY-DAYOFWEEK-SESSION` ("a descriptive breakdown still consumes the same holdout
window"), this is recorded there as the 51st study, in the Descriptive/no-gate bucket, not
the economic-gate bucket — `MULTIPLE_COMPARISONS_AUDIT.md` updated in this commit accordingly.
`AGENT_PROTOCOL.md`'s binding family-size counters (NHST, economic-gate) are unchanged — this
study triggers neither.

**Engineering note.** `scripts/equities-all-families-baseline.mjs` (new file, additive,
read-only diagnostic — same "not part of the app" convention as
`equities-baseline-port.mjs`/`zero-cost-floor-all-families.mjs`, no companion test file on that
same precedent, zero production files touched, no new exported logic added to any library
module — it only calls existing, already-tested `backtest.js`/`researchlab.mjs` exports and
reads the existing equities cache). `equities-baseline-port.mjs`, `tournament.mjs`, `data.js`,
`researchlib.mjs`, `researchlab.mjs`, `strategy.js`, `monitor.js`, `bot.js`, `trader.js`,
`scanner.js` — all untouched; grep-confirmed before commit, against the actual staged diff,
that none of the protected trading-safety identifiers appear anywhere in it. `npm.cmd test`:
505/505 green before and after (no production file changed, no new test file expected on this
precedent).

## 2026-08-22 — TIME-VARYING-COST-REPRICING: a real Kraken Tier-1 fee-schedule change is confirmed inside the sample window, but the pre-change rate could not be reliably sourced — honest non-verdict, no repricing performed

**Question, never asked before this item.** `FEE-SCHEDULE-REBASE` (2026-08-08) verified
Kraken's real Tier-1 taker rate live from the account (0.80%, vs. the repo's stale 0.40%
assumption) and applied that single corrected rate retroactively across every backtest's
entire history, as though 0.80% had always held. `SIGNAL-DECAY-TEMPORAL-STABILITY`
(2026-08-19) then found both `breakout` and `anticipate` significantly non-stationary across
5 epochs of the same full history, worst in the most recent epoch for both families. This
item asks the question neither prior study asked: did Kraken's actual fee schedule change
*within* the sample window, such that the flat 0.80% rate mispreices earlier history — and
could that, not signal decay, explain part of the most-recent-epoch weakness? Per this item's
own task wording, historical figures must be verified from a dated source, not reconstructed
from memory or an unreliable citation — the exact failure mode `FEE-SCHEDULE-REBASE` exists to
prevent.

**Sample window.** `candles/XBTUSD.csv` (this project's longest local history): 2023-01-01T00:00Z
through 2026-07-30T09:47Z, ~3.58 years. `breakout`/`anticipate`'s full-history baselines
(`SIGNAL-DECAY-TEMPORAL-STABILITY`) run against this same window per asset.

**What was checked, and how.** `WebSearch` + `WebFetch` against Kraken's own channels (no
third-party aggregator trusted as a primary source, per this item's own instruction to verify
rather than guess):

1. `kraken.com/features/fee-schedule` (live, fetched directly): confirms **current** Tier 1
   ($0+ 30-day volume) = Maker 0.40% / Taker 0.80% — matches `FEE-SCHEDULE-REBASE`'s
   2026-08-08 account-verified figure exactly. The page carries no historical schedule or
   effective-date record of its own.
2. `support.kraken.com/articles/cross-platform-fee-tier-changes` (Kraken's own support
   article, fetched directly): confirms a **real, dated fee-tier overhaul took effect
   2026-07-09** — tiers became based on Spot volume *or* Assets-on-Platform, whichever is
   better, and "some existing fees changed." This article states the **post**-change Tier 1
   rate (0.40% / 0.80%, consistent with #1) but explicitly does not carry the **pre**-change
   rate, and says finding it would require Kraken's archived fee schedule from before that
   date.
3. Wayback Machine (`web.archive.org`), the obvious source for that pre-2026-07-09 archived
   page, is **blocked outright** for this environment's `WebFetch` tool (hard error, not a
   fetch failure) — not accessible by any query form tried.
4. Kraken's own blog post announcing the change (`blog.kraken.com/product/pro/new-kraken-pro-fee-tiers`)
   returned **HTTP 403** on direct fetch.
5. Kraken's other own support articles on general fee mechanics (`how-trading-fees-work-on-kraken`,
   `overview-of-fees-on-kraken`) were checked and give only spot example rates at unrelated,
   higher volume tiers ($125k+, $500k+) — none states the pre-2026-07-09 Tier 1 rate either.
6. Third-party aggregator sites (cryptsy.com, swapverdict.com, and others surfaced by
   `WebSearch`) *do* quote base-tier numbers, but **disagree with each other** — one gives
   "0.25% maker / 0.40% taker under $10k," another "0.16% maker / 0.26% taker under $50k" —
   for what each calls the current or base tier. Neither is Kraken's own page, neither cites
   an effective date, and they contradict each other on the tier boundary itself. Treating
   either as "the" pre-2026-07-09 rate would be exactly the guessed/unverified-citation
   mistake this item's own task text warns against, and that `FEE-SCHEDULE-REBASE` already
   burned this project on once (the repo's own stale in-code assumption).

**Result: the pre-2026-07-09 Tier-1 rate cannot be reliably sourced from this environment.**
Kraken's own primary sources (live fee page, the change's own announcement support article,
the blog post) either omit it or are inaccessible; the one archive that would plausibly hold
it (Wayback Machine) is blocked for this tool; secondary sources are mutually inconsistent
and uncitable. Per this item's own done_when, this is recorded as an **honest non-verdict**,
not a guess: no per-trade, date-appropriate repricing of `breakout`/`anticipate` was performed,
and no side-by-side re-priced-vs-flat-rate table is produced, because doing so would require
fabricating the one number (the old rate) this item was specifically designed to verify rather
than assume.

**What IS established, and what it means for `SIGNAL-DECAY-TEMPORAL-STABILITY`'s
non-stationarity finding.** A real, officially-confirmed fee-schedule change did occur inside
the sample window, dated 2026-07-09 — roughly the final 3 weeks of a ~3.58-year history, i.e.
inside `SIGNAL-DECAY-TEMPORAL-STABILITY`'s epoch 5 (its "most recent," and for both families
its worst-or-near-worst epoch). This means the flat-rate assumption underlying every study in
this project's record — including the epoch table itself, which used the same single default
`FEE_RATE`/`SLIPPAGE_PCT` for all 5 epochs — is now known to be provably wrong for at least
part of the window, not merely a modeling simplification. Whether that misprice helped or hurt
epoch 5's numbers depends entirely on the sign and magnitude of the 2026-07-09 change, which is
exactly the number that could not be sourced. Directionally, every secondary source found
(however individually unreliable) put the *pre*-change base-tier taker rate below today's 0.80%
— which, if directionally correct even without a trustworthy exact figure, would mean epoch 5's
brief post-change slice was actually costed *too generously low* by the flat 0.80% rate applied
project-wide only from 2026-08-08 onward in current work, while epoch 5's much larger
pre-2026-07-09 majority may have been *overcosted* by the same flat rate if the true pre-change
number is materially lower than 0.80% — an ambiguous, non-quantifiable direction, not a
confirmed alternative explanation. **This does not overturn `SIGNAL-DECAY-TEMPORAL-STABILITY`'s
non-stationarity verdict** — the ANOVA result and its permutation p-value stand exactly as
recorded — but it does mean that verdict's own methodological caveat (pooled avgR is a
time-average over a non-constant baseline) now provably extends to the cost side of the ledger
as well as the signal side, and should be read that way going forward. No existing verdict is
rewritten, no VERDICTS.md row added or touched, per this item's own instruction.

**Engineering note.** No new script and no companion test file were added — this item resolved
to a sourcing/documentation question, not a computation, so there is nothing new for
`cost-model.mjs` or any backtest path to compute against; the task's own done_when explicitly
allows this outcome ("an explicit non-verdict if it cannot be [sourced]"). Zero production
files touched (`strategy.js`, `backtest.js`, `cost-model.mjs`, `tournament.mjs`, `bot.js`,
`monitor.js`, `trader.js`, `scanner.js` all untouched); grep-confirmed against the actual
staged diff before commit that no protected trading-safety identifier appears in it. `npm.cmd
test`: 505/505 green, unchanged (no production or test file touched).

## 2026-08-22 — EQUITIES-MADIP-SIGNIFICANCE: `ma_dip`'s positive point estimate is closer to nominal significance than `breakout`'s, on 7x the sample — but still does not clear BH-FDR

EQUITIES-ALL-FAMILIES-BASELINE (2026-08-22, above) found `ma_dip` combining the largest usable
holdout sample of the twelve `tournament.mjs` families (475 trades) with a comfortably
net-positive avgR (+0.1526) — the first equities family candidate with real sample size behind
its positive sign, unlike `breakout` (61 trades, already significance-tested and CI-includes-zero
per EQUITIES-BREAKOUT-SIGNIFICANCE). This item runs that same significance check against `ma_dip`,
and only that check: same cached candles (`research-cache/equities-1d/`, no live Gateway needed,
no egress), same unmodified `ma_dip` config and cost basis EQUITIES-ALL-FAMILIES-BASELINE
established. No re-tuning, no symbol drops, no window change.

**Pre-registered before computing anything** (full text in
`scripts/equities-madip-significance.mjs`'s header, same commit as the results below):
EQUITIES-BREAKOUT-SIGNIFICANCE's exact one-sided sign-flip permutation test (null: each trade's R
sign is an independent fair coin flip, i.e. population mean R is zero) on the pooled per-trade
net-R series, statistic = mean(R), `p = (extreme + 1) / (iterations + 1)` — this project's own
`permutationP` add-one convention, `momentum.mjs`, unmodified. 95% CI via `momentum.mjs`'s own
`blockBootstrapCI` (blockSize=4, unmodified). Decision rule, fixed in advance per
`AGENT_PROTOCOL.md`'s binding multiple-comparisons discipline: the raw p-value is **not**
evaluated against alpha=0.05 in isolation — it joins `MULTIPLE_COMPARISONS_AUDIT.md`'s
formal-NHST family (11 entries as of 2026-08-21) as a 12th entry, BH-FDR is recomputed across all
12 at q=0.05, and "significant" is only true if `ma_dip` clears the recomputed threshold at its
rank. Also pre-registered: EQUITIES-ALL-FAMILIES-BASELINE's own twelve-family look-elsewhere
exposure applies here too — `ma_dip` was the best-looking of twelve rows in that breadth run, not
a pre-registered single hypothesis, so this test is conditioned on having been selected, not run
blind, and is reported as such regardless of outcome.

**Replication check, before trusting anything new:** the script reproduces
EQUITIES-ALL-FAMILIES-BASELINE's exact trade count and avgR (475 trades, avgR +0.152634)
bit-for-bit off the same cached candles before any new statistic is computed — confirms the
pooled per-trade R series feeding the new test is the same population the baseline reported, not
a re-derivation error.

**Results:**

| family | trades | avgR | 95% CI (block bootstrap) | p (sign-flip, one-sided) |
|---|---:|---:|---:|---:|
| `ma_dip` (primary) | 475 | +0.1526 | **[-0.0544, +0.3609]** | 0.0648 |

**The CI includes zero, and the point estimate is not yet distinguishable from noise — but this
is a materially closer call than `breakout`'s.** 475 trades narrows the CI substantially versus
`breakout`'s 61-trade [-0.27, +0.62] span, and the raw p-value (0.0648) sits just above the
uncorrected 0.05 line — the closest any equities result has come to nominal significance in this
project's history. That is worth stating plainly. It is also, on its own, not enough: the CI still
straddles zero, and a single family selected as the best of twelve candidates does not get to
skip the correction that selection implies.

**Family-wide BH-FDR, recomputed across all 12 formal-NHST entries at q=0.05** (full table:
`MULTIPLE_COMPARISONS_AUDIT.md` §2, `AGENT_PROTOCOL.md`'s counter updated to 12 in the same
commit): `ma_dip` ranks 5th of 12 by raw p-value (0.0648), q=0.1555 — the rank-5 BH-FDR threshold
is 0.02083, less than a third of its raw p-value, so it does not survive. No prior survivor flips
this time (unlike the previous update, where growing the family from 10 to 11 flipped
`CLASSIFIER-FUNDING-FEATURE` from survivor to non-survivor): `CLASSIFIER-FUNDING-FEATURE` was
already a non-survivor at n=11 (q=0.0545) and stays one at n=12 (q=0.0594); `B5-REVERSAL (L=3)`
remains the sole survivor at q=0.05 (q=0.0120, essentially unchanged).

**Decision, per the pre-registered rule: `ma_dip` does NOT survive significance.** No VERDICTS.md
row — per this item's own `done_when`, a cleared BH-FDR alone does not promote anything, and this
one didn't clear it anyway. EQUITIES-ALL-FAMILIES-BASELINE's +0.1526 avgR remains on record
exactly as it was reported: a real, real-cost point estimate on this window, now additionally
known to be statistically indistinguishable from zero at 475 trades, though closer to that line
than any other equities result tested so far. If a genuinely fresh holdout ever becomes available
(`SEALED_SYMBOLS`, or equity candle data collected after 2026-08-19), `ma_dip` — not `breakout` —
is the more evidence-backed candidate for a confirmatory re-test; this item does not run one, and
no config, universe, or cost parameter was changed after seeing results.

**Engineering note.** New: `scripts/equities-madip-significance.mjs` (read-only, cache-only —
does not import `brokers/ibkr.mjs`, cannot make a live Gateway call even accidentally).
`momentum.mjs`'s `blockBootstrapCI` used unmodified, not edited. `MULTIPLE_COMPARISONS_AUDIT.md`
and `AGENT_PROTOCOL.md` updated in the same commit per the binding rule (counters, table, both
narrative sections). `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`,
`trader.js`, `scanner.js` — all untouched; grep-confirmed against the actual staged diff before
commit that no protected trading-safety identifier appears in it. `npm.cmd test`: 505/505 green
(no production or test file touched — no companion test file added, matching
EQUITIES-BREAKOUT-SIGNIFICANCE/EQUITIES-ALL-FAMILIES-BASELINE precedent for read-only research
scripts under `scripts/`).

## 2026-08-22 — EQUITIES-BREAKOUT-COMMISSION-FLOOR-POSITION-SIZING: the real $1 commission floor costs `breakout` 0.6-2.4 cents of avgR at realistic retail sizes, but never drags the result to breakeven across the pre-registered $2k-$50k range

`EQUITIES-COST-ASSUMPTION-SENSITIVITY` (2026-08-22) found `breakout`'s net-positive equities
edge (+0.1866R, 61 holdout trades) survives every plausible slippage citation, but flagged —
unquantified — that IBKR's real commission structure (Fixed plan: USD 0.005/share, USD 1.00/order
minimum) creates a floor that binds below 200 shares, and named "a genuine position-sizing-aware
re-run" as "the natural follow-on before this result is treated as more than a promising point
estimate." This item is that re-run.

**Scope: `breakout` only**, same as the item it follows on from — `anticipate`'s sign is not in
question (already net negative, `EQUITIES-BREAKOUT-SIGNIFICANCE`, 2026-08-21).

**Pre-registered before any computation:** position sizes $2,000 / $5,000 / $10,000 / $25,000 /
$50,000 per trade — the exact set named in this item's own task text (`.agent_state.json`
work_queue), not chosen after seeing any result.

**Method — no new data fetch, no live IBKR Gateway call.** Reads the existing
`research-cache/equities-1d/` cache, re-runs `breakout` UNMODIFIED through `backtest.js` at the
same per-symbol commission rate and 5bps default slippage as `EQUITIES-BASELINE-PORT`. To get a
real per-trade entry price to size against, `backtest.js`'s `excursions[]` was extended
(additively — three new fields, `entry`, `risk`, `exitPrice`, alongside the existing `r`, `mae`,
`mfe`, `barsHeld`) to expose each closed trade's fixed entry price and initial risk-per-share; no
existing consumer reads an exhaustive object shape (checked: `mae-mfe-stop-placement-diagnostic.mjs`,
`holding-period-cost-amortization-map.mjs`, and `backtest.test.mjs` all read named fields only),
and `backtest.test.mjs` gained three new assertions (one per excursion-producing code path: BOS
win, BOS stop-out, ANTICIPATE same-bar stop-out) pinning the new fields to values hand-derived
from each test's own fixture. For each trade: `feeR_old = feeRate * (entry + exitPrice) / risk`
reverses out the bps-based commission `backtest.js` already charged (its own `netAt()` formula,
not re-derived); `shares = floor(positionSizeUSD / entry)` (whole shares only); `commissionR_new
= (2 * max(shares * 0.005, 1.00)) / (shares * risk)` is the real per-order commission (both legs,
same share count — this backtest has no partial exits configured, `BREAKOUT_CONFIG` unchanged
from the original, `partialAtR` off) converted to R via the trade's actual dollar risk;
`newR = r + feeR_old - commissionR_new`. Reproduction check: pooling the 61 trades' unmodified
`r` values reproduces `EQUITIES-COST-ASSUMPTION-SENSITIVITY`'s `netDefaultAvgR` to +0.18662383R —
bit-for-bit off the same cache, before any new statistic is computed.

**Results** (all 61 trades tradeable at every pre-registered size — no symbol's entry price ever
exceeded a fifth of even the smallest $2,000 size, so `tradesExcludedTooSmall` is 0 throughout):

| position size | trades | net avgR | vs. bps-based (+0.18662R) |
|---|---:|---:|---:|
| $2,000 | 61 | +0.16310 | -0.0235 |
| $5,000 | 61 | +0.17849 | -0.0081 |
| $10,000 | 61 | +0.18327 | -0.0034 |
| $25,000 | 61 | +0.18589 | -0.0007 |
| $50,000 | 61 | +0.18652 | -0.0001 |

**Smallest pre-registered size at which the commission floor drags the result to breakeven or
negative: none.** Across the full $2k-$50k range the real-commission net avgR stays comfortably
positive, converging toward the original bps-based figure as size grows (larger share counts
push the real per-order commission toward the same 0.005/share rate the bps model already
assumed, exactly as expected — the floor only overcharges relative to that rate at low share
counts). The drag is real and monotonic in the expected direction (smaller size → more drag) but
small in absolute terms: even at the smallest pre-registered size, $2,000, the floor costs ~2.35
cents of avgR (~12.6% of the +0.1866R headline), not enough on its own to flip the sign.

**Read against `EQUITIES-COST-ASSUMPTION-SENSITIVITY`'s own stated concern.** That item worried
the $1 floor "binds well within a realistic retail position size" using a *per-symbol average*
floor threshold (median ~$47,928 across the universe) — reasoning that at typical retail sizes,
most trades would sit below that per-symbol threshold and thus be commission-inflated relative
to the bps model. This item's per-trade, per-price-at-entry computation shows the practical
effect of that binding is much smaller than the "floor binds" framing implied: even at $2,000 —
far below every symbol's own floor threshold — the drag is 2.35 cents of avgR, not something
that threatens the sign. **The floor is real, quantifiably drags the result at small sizes, and
should not be treated as free — but it does not overturn `breakout`'s net-positive equities
result at any of the position sizes a real retail account would plausibly use.**

**Not touched.** `EQUITIES-BASELINE-PORT`'s and `EQUITIES-COST-ASSUMPTION-SENSITIVITY`'s own
recorded cost bases, headline numbers, and caches — untouched. No universe, split, or entry/exit
parameter changed. No `VERDICTS.md` row (per this item's own `done_when` — this refines cost
realism on a result that `EQUITIES-BREAKOUT-SIGNIFICANCE` already found does not clear its own
significance test; it neither newly clears nor newly kills a gate).

**Multiple-comparisons discipline.** This item computes no p-value against a pre-registered
gate — every number above is a deterministic backtest re-price or a direct algebraic
identity from `backtest.js`'s own cost formula, not a hypothesis test — so
`MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family is untouched, matching
`EQUITIES-COST-ASSUMPTION-SENSITIVITY`'s and `COST-SENSITIVITY-SURFACE`'s identical precedent.

**Engineering note.** New: `scripts/equities-breakout-commission-floor-position-sizing.mjs`
(read-only, cache-only — does not import `brokers/ibkr.mjs`, cannot make a live Gateway call even
accidentally). Unlike this project's usual `scripts/` precedent, this item DID touch a production
library module: `backtest.js` gained three additive fields (`entry`, `risk`, `exitPrice`) on each
`excursions[]` entry, at all four of its trade-close call sites, plus an updated doc-comment —
no existing field removed, renamed, or changed in meaning, and no behavior change to `trades`,
`results`, `totalR`, `avgR`, or any other returned value. `backtest.test.mjs` gained three new
assertions (no existing assertion changed, one pre-existing assertion's `assert.equal` was
loosened to a `1e-9`-tolerance `assert.ok` after the new floating-point-sensitive `exitPrice`
assertion exposed a pre-existing `108.50000000000001` vs `108.5` float-noise mismatch on an
unrelated already-passing test — a correctness fix, not a weakening: the value being compared
was always float-noisy, the strict `assert.equal` on it was simply never exercised with a value
that surfaced the noise before). `equities-baseline-port.mjs`, `equities-cost-assumption-
sensitivity.mjs`, `data.js`, `researchlib.mjs`, `researchlab.mjs`, `strategy.js`, `tournament.mjs`,
`monitor.js`, `bot.js`, `trader.js`, `scanner.js`, `commands.js` — all untouched (commands.js is
the one other `backtest.js` consumer that reads `excursions`-adjacent output at all; grep-
confirmed it never destructures `.excursions`, so the new fields cannot affect it); grep-confirmed
against the actual staged diff before commit that no protected trading-safety identifier appears
in it. `npm.cmd test`: 505/505 green (33/33 in `backtest.test.mjs`; no new `test()` block added — the
3 new assertions extend three already-existing excursion tests in place, one per code path).

## 2026-08-22 — EQUITIES-BREAKOUT-OUT-OF-SAMPLE: on a fresh universe, the edge does not reproduce — it flips negative

`EQUITIES-BASELINE-PORT` (2026-08-19) reported `breakout` net +0.1866R over 61 DJIA-30 holdout
trades, and `EQUITIES-BREAKOUT-SIGNIFICANCE` (2026-08-21) found that point estimate's 95% CI
includes zero — 61 trades wasn't enough to call it distinguishable from noise. Both items named
the same next step: an out-of-sample re-check on genuinely new data. This item is that check.

**Pre-registered before any data was fetched** (full text in
`scripts/equities-breakout-out-of-sample.mjs`'s header, same commit as the results below).

**Window.** `IBKRBroker.fetchOHLC(symbol, 1440)` — the exact function `EQUITIES-BASELINE-PORT`
used — has no `endDateTime` parameter; it always requests IBKR's "2 Y" duration ending now.
Fetching fresh today (2026-08-22) therefore yields a window (~2024-08-22 to ~2026-08-22) barely
3 days shifted from the original (~2024-08-19 to ~2026-08-19) — re-running the same DJIA-30
universe on it would not be a genuine out-of-sample test. Widening `fetchOHLC` to accept a
historical end date would move the window, but that function is also `trader.js`'s live data
path, and widening it was judged out of scope for an additive research script. So this item
holds the window mechanism fixed as given and changes the **universe** instead, which
`fetchOHLC` already supports per-symbol with zero production-code changes. This also satisfies
`AGENT_PROTOCOL.md`'s calendar-holdout rule directly (candle data collected after 2026-08-19 for
a price-structure family holdout), no disclosure-of-reuse needed.

**Universe.** Dow Jones Transportation Average, 20 components, fixed at window start
(2024-08-22) with the same point-in-time discipline `EQUITIES-BASELINE-PORT` applied to
DJIA-30 (INTC/DOW kept despite later removal, not excluded with hindsight) — zero ticker
overlap with the original DJIA-30, so this is a genuinely different set of 20 companies, not a
re-slice of the same 30. Sourced from Wikipedia's "Dow Jones Transportation Average" article and
cross-checked against independent primary sources for both membership changes near the window:
Uber Technologies replaced JetBlue Airways effective 2024-02-26 (already in effect by window
start — UBER included, JetBlue not: [PR Newswire](https://www.prnewswire.com/news-releases/amazoncom-set-to-join-dow-jones-industrial-average-uber-to-join-dow-jones-transportation-average-302066705.html));
FedEx Freight Holding replaced American Airlines Group effective 2026-06-01 — after the window
start, so per point-in-time discipline this universe uses American Airlines (AAL), not FedEx
Freight, even though AAL was later dropped for underperformance
([S&P Global](https://press.spglobal.com/2026-05-27-FedEx-Freight-Holding-Set-to-Join-Dow-Jones-Transportation-Average)).
Final list: ALK, CAR, CHRW, CSX, DAL, EXPD, FDX, AAL, JBHT, KEX, LSTR, MATX, NSC, ODFL, R, LUV,
UBER, UNP, UAL, UPS.

**Cost basis, family configs, split — exactly `EQUITIES-BASELINE-PORT`'s, unmodified.** IBKR
Fixed plan $0.005/share commission (converted per-symbol via that symbol's own holdout
`avgClose`), 5bps/side slippage, 70/30 train/holdout split, `breakout`/`anticipate` configs
verbatim from `tournament.mjs`. No parameter, universe, or cost figure changed after seeing
results.

**Statistical test — `EQUITIES-BREAKOUT-SIGNIFICANCE`'s exact methodology, duplicated
verbatim**: one-sided sign-flip permutation test (null: population mean R is zero) on the
pooled per-trade net-R series, 5000 iterations; 95% CI via `momentum.mjs`'s `blockBootstrapCI`
(blockSize=4). `anticipate` runs alongside as the same negative-control sanity check.
`breakout`'s p-value joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family (12 entries as
of 2026-08-22) as the 13th entry; BH-FDR recomputed across all 13 in the same commit
(`MULTIPLE_COMPARISONS_AUDIT.md` §2, `AGENT_PROTOCOL.md`'s counter updated to 13).

**Results, side by side with the original DJIA-30 run (`EQUITIES-BREAKOUT-SIGNIFICANCE`,
2026-08-21):**

| family | universe | trades | avgR | 95% CI (block bootstrap) | p (sign-flip, one-sided) |
|---|---|---:|---:|---:|---:|
| `breakout` — original | DJIA-30 | 61 | +0.1866 | [-0.2700, +0.6192] | 0.2036 |
| `breakout` — out-of-sample | DJTA-20 | 33 | **-0.0854** | [-0.4052, +0.3313] | 0.6165 |
| `anticipate` — original | DJIA-30 | 303 | -0.0438 | [-0.2442, +0.1360] | 0.6701 |
| `anticipate` — out-of-sample (negative control) | DJTA-20 | 188 | +0.1619 | [-0.0749, +0.4364] | 0.1310 |

**The edge does not reproduce — it vanishes, and the sign flips.** `breakout`'s point estimate
goes from a real-cost +0.1866R (thin, CI-includes-zero) to a real-cost -0.0854R on a
non-overlapping universe with the identical entry/exit logic and cost model. This is not "holds
up weaker" — the sign itself flips, and the p-value moves from a middling 0.2036 to a
thoroughly unremarkable 0.6165. Per the pre-registered decision rule, this is read as the edge
vanishing under out-of-sample scrutiny, not as noise around a real positive mean. It joins the
formal-NHST family as a clean non-hit (wrong sign), not as a second thin positive.

**A caveat that cuts the other way, stated plainly rather than buried: `anticipate` — the
already-known-dead family that served as this study's own negative control — came back
*positive* on this same DJTA-20 universe** (+0.1619R, 188 trades, CI includes zero, p=0.1310),
inverting its DJIA-30 sign too. Taken together, both families flipped sign between universes.
The most parsimonious reading is not "breakout is secretly dead and anticipate is secretly
alive" — `anticipate` has been killed independently and repeatedly by
`HOLDING-PERIOD-COST-AMORTIZATION-MAP` and other studies on much larger samples — but that
**33-188 trades on one 20-symbol universe is simply not enough to pin down either family's true
mean, and both point estimates here should be read as noisy**, consistent with
`EQUITIES-BREAKOUT-SIGNIFICANCE`'s own finding that 61 DJIA-30 trades already couldn't
distinguish `breakout`'s mean from zero. The honest overall conclusion is not "breakout's edge
is confirmed dead" (that would overclaim from a second thin sample) but "the one out-of-sample
check run so far found no supporting evidence, and found some evidence pointing the other way" —
exactly the outcome `EQUITIES-BREAKOUT-SIGNIFICANCE`'s own writeup said this check might honestly
produce.

**Decision, per the pre-registered rule.** No VERDICTS.md row — no pre-registered gate was
cleared (the opposite: the family-wide BH-FDR table shows `breakout`'s out-of-sample entry
ranking 12th of 13, q=0.6679, not remotely close to surviving). `EQUITIES-MADIP-OUT-OF-SAMPLE`
(queued, depends on `EQUITIES-MADIP-SIGNIFICANCE`) remains the next legitimate piece of
out-of-sample evidence in this line — for `ma_dip`, not `breakout` — and per its own note should
reuse this item's live IBKR connection window/fetch mechanics rather than opening a second one,
though `ma_dip`'s own universe choice is a separate pre-registration this item does not make.

**Engineering note.** New: `scripts/equities-breakout-out-of-sample.mjs` (additive, live IBKR
fetch — read-only historical data requests only, confirmed by inspection: it calls
`IBKRBroker.fetchOHLC` and nothing else on that broker interface — no order-placement path of
any kind). Candles cached to
`research-cache/equities-1d-djta-oos/` (a new directory, kept separate from
`EQUITIES-BASELINE-PORT`'s `research-cache/equities-1d/` so it's unambiguous which candles fed
which universe — no ticker collision either way). `momentum.mjs`'s `blockBootstrapCI` used
unmodified. `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`,
`scanner.js` — all untouched; grep-confirmed against the actual staged diff before commit that
no protected trading-safety identifier appears in it. `MULTIPLE_COMPARISONS_AUDIT.md` and
`AGENT_PROTOCOL.md` updated in the same commit per the binding rule. `npm.cmd test`: 505/505
green (this item added no new production code, so no new tests were required or added).


## EXOGENOUS-DATA-ACCESS-AUDIT — measuring what's actually reachable before writing another hypothesis against it (2026-08-22)

Every genuinely exogenous data source this project has tried so far died on **access**, not on
hypothesis: `TEST4-ONCHAIN-FLOW-GATE`/`ONCHAIN-FLOW-GATE` (Glassnode, HTTP 401, no key held),
`H11` (Binance funding, HTTP 451 geo-blocked, then Kraken funding's ~365-day rolling window
against a 730-day requirement), and `ETF-FLOW-GATE` (cut before its Farside probe even ran).
Three new primary-signal items were queued this run — `MACRO-REGIME-PRIMARY-SIGNAL`,
`OPTIONS-SKEW-PRIMARY-SIGNAL`, `WHALE-WALLET-ACCUMULATION-PRIMARY` — each gated behind this
item specifically to avoid repeating that pattern a third and fourth time. This measures, with a
real fetch per candidate source and no reliance on documentation, what this research machine can
actually reach today.

**Method.** New `scripts/exogenous-data-access-audit.mjs` (additive, read-only, no strategy
logic, no backtest, no order path). One real network call per source; "reachable" means an
actual HTTP response was received and parsed, not that a vendor's docs page says so. Guarded
explicitly against the mistake `H11` already made once (a sandbox's own egress block nearly
recorded as a fact about an upstream API): this ran from the research machine itself, which has
confirmed general egress (a throwaway `frankfurter.app` FX call succeeded before the audit ran).

| category | source | reachable | auth held | measured earliest date | measured span | cost |
|---|---|---|---|---|---|---|
| options | Deribit public API (`get_historical_volatility`, BTC) | **yes** | n/a (public) | 2026-08-06 | only ~16 days (384 hourly points) — this endpoint is capped short, not a multi-year archive | free |
| options | IBKR options chain (existing Gateway connection) | **intermittent** — see note | yes (existing subscription) | not probed | n/a | included, no incremental cost |
| macro | FRED `DGS10` (10Y Treasury) via public CSV export | **yes** | not required for this access path | 1962-01-02 | 16,863 daily points to 2026-08-20 | free |
| macro | FRED `DTWEXBGS` (Broad Dollar Index, ICE's own DXY ticker isn't on FRED) via public CSV export | **yes** | not required for this access path | 2006-01-02 | 5,380 daily points to 2026-08-14 | free |
| macro | FRED `FEDFUNDS` (Fed funds effective rate) via public CSV export | **yes** | not required for this access path | 1954-07-01 | 865 points to 2026-07-01 | free |
| text sentiment | GDELT 2.0 DOC API (news volume timeline) | **yes** — see note on measurement method | n/a (public) | not measured this run (rate-limited) | GDELT's own courtesy limit is 1 request/5s; this run's single call got the rate-limit notice, not data | free |
| on-chain wallet | Glassnode `transfers_volume_exchanges_net` | **no** | **no** (`GLASSNODE_API_KEY` unset, unchanged since `TEST4-ONCHAIN-FLOW-GATE` 2026-08-14) | — | — | paid beyond limited free tier, free tier itself requires the key |
| on-chain wallet | blockchain.com Charts API (`n-unique-addresses`, BTC only) | **yes** | n/a (public) | 2009-01-03 | 1,602 daily points to 2026-08-15 | free |

**IBKR options access is intermittent, not a fixed capability — stated as such rather than
resolved either way.** This run's own pre-check found `127.0.0.1:4002` refusing connections
(`ECONNREFUSED`) minutes after the prior commit's control notes recorded a successful 20-symbol
live fetch through it; a repeat check minutes later found it accepting connections again, and
the audit script itself (run after that) recorded it reachable. The honest reading is "reachable
when the Gateway process happens to be running on the research machine at the time," which any
IBKR-dependent item must probe fresh at the time it runs rather than trust a prior firing's
finding.

**A client-library quirk worth recording so it isn't rediscovered the hard way.** Node's native
`fetch()` (undici) hit a hard `UND_ERR_CONNECT_TIMEOUT` against `api.gdeltproject.org`
specifically, on every attempt, while `curl` against the identical URL from the same machine in
the same minute got a real HTTP response every time (a 429 courtesy-limit page, not a connection
failure). Recording "unreachable" from the `fetch()` failure alone would have been exactly the
sandbox-error-mistaken-for-upstream-fact mistake this audit exists to avoid, so the script shells
out to `curl` for this one host. Any future GDELT integration should do the same, or add retry
with backoff, rather than trust `fetch()`'s verdict on this host.

**Which sources can support a genuine train+holdout window on this project's existing candle
history, stated plainly:**
- **Can, with real depth:** FRED `DGS10`/`DTWEXBGS`/`FEDFUNDS` (macro) — decades of daily data,
  comfortably covers every window this project has ever used. `blockchain.com`'s
  `n-unique-addresses` (on-chain, BTC-only) — daily since 2009, real depth, but it is an
  address-count series, not wallet-level accumulation/distribution behavior; a materially
  coarser proxy than `WHALE-WALLET-ACCUMULATION-PRIMARY`'s own stated hypothesis needs. True
  large-wallet cohort tracking (balance-tier clustering over time) needs a paid provider
  (Glassnode/Nansen/Chainalysis-class) or building clustering from raw block data — neither free,
  so `WHALE-WALLET-ACCUMULATION-PRIMARY` as specified is **not supportable on free data** and
  should be re-scoped around the coarser public proxy or closed as a data-availability
  non-verdict before any backtest is attempted, not after.
- **Cannot, as measured:** Deribit's `get_historical_volatility` only returns ~16 days —
  nowhere near enough for a pre-registered train window on any timescale this project has used
  elsewhere (its narrowest prior splits still run months). `OPTIONS-SKEW-PRIMARY-SIGNAL` would
  need a different Deribit endpoint (e.g. building a daily archive going forward from
  `get_tradingview_chart_data` per instrument, or IBKR's own options chain once the Gateway
  connectivity is reliable enough to build history from) — the 16-day cap on the endpoint probed
  here is not sufficient on its own and should not be treated as "options data is available"
  without that follow-up.
- **Unusable, recorded so it isn't re-proposed:** Glassnode on-chain flow data — no key held,
  unchanged since `TEST4-ONCHAIN-FLOW-GATE`; registering one is outside this project's
  unattended automation scope (creating third-party accounts is out of scope for this loop).
  GDELT's query API is reachable but rate-limited to one request per 5 seconds per client,
  making it usable only with a slow, paced ingestion script, not a single-shot fetch — feasible
  for `MACRO-REGIME-PRIMARY-SIGNAL`/future sentiment work only if that constraint is designed in
  from the start.

**No strategy code touched.** `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`,
`bot.js`, `trader.js`, `scanner.js` — all untouched; grep-confirmed against the actual staged
diff before commit that no protected trading-safety identifier appears in it. This item reports
no p-value and clears no gate, so it does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST
family. `npm.cmd test`: 505/505 green (this item added no new production code path exercised by
existing tests, so no new tests were required or added, matching the convention of prior
diagnostic-only scripts like `candle-corpus-gap-audit.mjs`).


## MACRO-REGIME-PRIMARY-SIGNAL — the first genuinely exogenous primary signal tested, closes as a sample-size non-verdict (2026-08-22)

Every alt-data source tested in this project before this item — funding rate, open interest,
basis, long/short ratio, top-trader positioning, aggressor order flow, liquidations, realized
volatility — is **endogenous**: a transform of the same market's own price or positioning.
`EXOGENOUS-DATA-ACCESS-AUDIT` confirmed FRED's public macro series (dollar index, Treasury
yields, Fed funds) are free, deep, and reachable without a key — genuinely exogenous data,
unblocked by this study.

**Method, pre-registered before any crypto return was touched.** New
`scripts/macro-regime-primary-signal.mjs` (additive). Regime = majority vote (≥2 of 3) of three
conventional, untuned macro signals: (1) DTWEXBGS (Broad Dollar Index — ICE's own DXY ticker
isn't on FRED) below its own trailing 200-session MA = favourable; (2) `DGS10 - DGS2` (10y-2y
spread) positive = favourable, the standard curve-inversion recession indicator; (3) FEDFUNDS
trailing 3-month change ≤0 (holding/cutting) = favourable. None of these thresholds were
searched or fit against this project's own data — they are the conventional definitions used
across macro finance generally, chosen specifically so this would not be another instance of
fitting a rule to the series it gets scored against. `DGS2` was not one of the sources
`EXOGENOUS-DATA-ACCESS-AUDIT` probed; reconfirmed reachable here (1976-present) before use.

**Causal alignment.** Every macro lookup uses the latest published value strictly before
(trading day − lag): 1 day for the two daily FRED series, 20 days for FEDFUNDS (a monthly
average only fully known after month-end — 20 days is a deliberately conservative buffer past
FRED's actual few-day publication lag).

**Universe — a coverage decision made before any result existed, not a performance one.** Of the
24 active (non-`SEALED_SYMBOLS`) watchlist assets, this project's local candle store holds full
2023-01-01→2026-03-31 coverage for only 12: ADA, APT, ATOM, BTC, DOGE, DOT, ETH, FIL, INJ, LTC,
SOL, XRP. The other 12 active assets start 2025-01-22 or later — 14 months or less, and this
item's own task text explicitly warned that macro regimes turn over only a handful of times a
year, making a short window the wrong choice on its face, before looking at anything else. Equal
weight across the 12, 70/30 chronological split, this project's real cost basis (FEE_RATE 0.008 +
SLIPPAGE_PCT 0.0005/side, ~1.7% round trip) charged once per regime flip (buy-and-hold gets one
entry-cost and one exit-cost charge for a fair comparison, not a free ride).

**A design defect caught and fixed before drawing any conclusion, disclosed rather than quietly
corrected.** The first run's raw (bandless) threshold comparisons produced a regime series with
repeated single-day episodes —
`[326,1,31,1,6,1,13,1,34,1,97,1,22,1,14,1,54,1,4,1,1,1,1,215]` in train alone — a classic
whipsaw at a raw MA/threshold crossing, exactly the failure mode this project's own
`momentum.mjs::btcRegimeMap` already carries a dead-band for. A dead-band (hysteresis, prior
value carried forward inside the band) was added to all three signals — DXY ±1% around its MA
(matching `btcRegimeMap`'s own existing default exactly, not a new fit), curve ±10bp around
zero, Fed funds change ±5bp around zero — **before** any return or verdict was computed from the
corrected series. This is recorded as a methodology fix using an established project convention,
not a threshold search against this run's own outcome; the raw, uncorrected episode list above is
shown so that claim is checkable rather than asserted.

**Results (post-fix), reported plainly — both segments compared to buy-and-hold on the identical
window:**

| segment | days | regime episodes | strategy return | buy-and-hold return | hit rate |
|---|---:|---:|---:|---:|---:|
| train (2023-01-02 → 2025-04-09) | 829 | 2 (628 + 201 days) | +9.19% | **+186.11%** | 47.4% |
| holdout (2025-04-10 → 2026-03-31) | 356 | 1 (the whole window) | -46.92% | -47.37% | 50.3% |

**Read plainly, not softened.** Train: the signal was flat through most of the second, 201-day
episode of a strong bull run and missed nearly all of it — +9.19% against a +186.11% buy-and-hold
benchmark on the same assets over the same window. Holdout: the entire 356-day window was one
uninterrupted "favourable" call, so the strategy was effectively long-only here and simply
tracked the benchmark down through a broad drawdown (-46.92% vs -47.37%) — not a case of the
signal being "under-sampled," but of it being wrong for the whole period it was asked to call.

**Why this is recorded as a non-verdict, not a kill.** This item's own task text pre-registered
the escape hatch: "if effective n is too small to support any CI, that is the finding." Effective
n here is regime EPISODES, not days — 2 in train, exactly 1 in holdout. A single 356-day episode
cannot support a bootstrap CI or any permutation test; reporting one anyway would manufacture
false precision from what is, mechanically, a sample size of one. This is the sample-size trap
the task warned about, encountered exactly as described: 3.25 years of local crypto candle
coverage is nowhere near enough to accumulate the "few dozen independent regime episodes" a real
inferential claim over a slow-moving macro regime would need. No p-value is reported, and this
item does **not** join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family (nothing to correct
for).

**What would actually resolve this, stated for whoever picks it up next.** Not a different
regime definition — a longer window. FRED's own series comfortably support decades; the
constraint is this project's own crypto candle history (2023-01-01 is this store's earliest
common coverage for the 12-asset universe used here). Either wait for more history to accumulate
naturally, or re-run this identical, unmodified methodology against a market with deeper local
history — equities, via `EQUITIES-MADIP-OUT-OF-SAMPLE`'s IBKR path, would give a hard test with
years more coverage and a chance at the episode count this crypto window couldn't reach. Re-fit
nothing if that happens — same three signals, same bands, same lag structure, only the asset
universe and its longer window change.

**Engineering note.** New `scripts/macro-regime-primary-signal.mjs` only. No strategy code
touched — `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`,
`scanner.js` all untouched, grep-confirmed against the staged diff before commit. Reused
`momentum.mjs`'s `blockBootstrapCI` (imported, unused on this run's path since the episode floor
was never reached — kept imported rather than stripped, since a future re-run against a longer
window is expected to use it) and `researchlib.mjs`'s `splitSealedSymbols`/`symbolToKrakenId`
unmodified. `npm.cmd test`: 505/505 green (no new production code path exercised by existing
tests).

## LOG-REGRESSION-BANDS-CRYPTO — the pre-registered test formally survives BH-FDR, and this study's own control shows why that survival should not be trusted (2026-08-22)

Never attempted here despite being a well-known crypto framing — zero hits for
`log.regression`/`power.law`/`rainbow` anywhere in `VERDICTS.md`/`ROADMAP.md` before this item.
STRUCTURAL REQUIREMENT (this item's own work_queue note): generates market EXPOSURE directly,
never a gate/filter on `breakout`/`anticipate` — Template A is retired, and the zero-fee floor
already explains why filtering a no-gross-edge population cannot work.

**Method, pre-registered before any statistic below was computed** (full text in
`scripts/log-regression-bands-crypto.mjs`'s header, same commit as these results). Per asset: fit
OLS `log(close) ~ a + b*log(t)`, `t` = day index since this store's LOCAL WINDOW START for that
asset (not true listing/genesis date — this codebase does not track that, and the task text
explicitly allows either framing; disclosed here rather than silently mislabeled). Fit on TRAIN
ONLY (first 70% of that asset's local history); the frozen `(slope, intercept)` are applied
UNCHANGED to every day, train and holdout alike, giving a standardized residual
`z = (actual - fitted) / trainResidualSE`. Band fixed before running, not searched: long
(`exposure=1`) when `z<=-1.5`; flat (`exposure=0`) when `z>=+1.5`; hysteresis carry-forward inside
the band (this project's existing `btcRegimeMap`/`MACRO-REGIME-PRIMARY-SIGNAL` convention, reused
to avoid single-day whipsaw, not fit against this run's outcome). Standing real crypto cost
(FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side, ~1.7% round trip) charged once per flip; buy-and-hold
gets one matching entry-cost and one exit-cost charge for a fair comparison
(`MACRO-REGIME-PRIMARY-SIGNAL`'s convention, reused verbatim). Universe: all 24 active
(non-`SEALED_SYMBOLS`) watchlist assets with >=150 local daily candles — a floor set before any
result existed; every active asset clears it as of this run (minimum is EOS at 160), so it
excludes nothing in practice but is stated as a rule, not a description of what happened to
qualify.

**Significance, pre-registered.** Unit of observation: per-asset (holdout strategy return −
holdout buy-and-hold return), one scalar per asset — independence is across ASSETS (not days,
which are cross-sectionally correlated within one calendar window and would overstate n), giving
n=24, not a day-count. One-sided sign-flip permutation test (H1: mean outperformance > 0, matching
`EQUITIES-MADIP-SIGNIFICANCE`'s convention), plain cross-sectional bootstrap 95% CI
(`momentum.mjs`'s `bootstrapCI`, unmodified — the same function `momentum.mjs` itself uses for
per-panel/per-symbol IC values, not the block variant, because these units are cross-sectional,
not one autocorrelated time series). The one-sided direction was pre-registered on the
mechanism's own economic rationale (a mean-reversion exposure signal should help by avoiding
exposure during overextended trends) — this is this project's first run of the method, unlike
`EQUITIES-MADIP-SIGNIFICANCE` which had a prior point estimate to justify its direction.

**Primary result:**

| test | n | mean | 95% CI | p (one-sided sign-flip) |
|---|---:|---:|---|---:|
| Signal outperformance vs buy-and-hold (pre-registered primary) | 24 | +0.1446 | [0.0682, 0.2323] | **0.0002** |

CI excludes zero. This is, by raw p-value, the strongest hit of any formal test run in this
project's history — smaller than `B5-REVERSAL L=3`'s 0.0010.

**The check that matters, run before trusting anything new (same study, same commit, not a later
follow-up).** 23 of the 24 assets' holdout windows had NEGATIVE buy-and-hold return — this
universe's holdout landed in the same broadly bearish stretch `MACRO-REGIME-PRIMARY-SIGNAL`'s
356-day holdout already found (-46.92% vs -47.37% buy-and-hold there). Against a benchmark that is
falling almost everywhere, ANY reduced-exposure strategy looks like it "outperforms" close to
automatically — including doing nothing at all. Three of the 24 assets (XMR, XRP, ZEC) never
triggered a single long entry across their entire holdout (`z` never crossed -1.5) and simply
posted 0% — yet still logged large "outperformance" (+0.028, +0.358, +0.627 respectively) purely
because their buy-and-hold legs crashed. That is the tell. An always-flat control (0% return, zero
trades, no cost — literally sit in cash) was computed against the SAME 24 per-asset buy-and-hold
series, scored with the identical test:

| test | n | mean | 95% CI | p (one-sided sign-flip) |
|---|---:|---:|---|---:|
| Always-flat (cash) outperformance vs buy-and-hold | 24 | **+0.4337** | [0.3355, 0.5266] | 0.0002 |
| Signal outperformance vs buy-and-hold (primary, for comparison) | 24 | +0.1446 | [0.0682, 0.2323] | 0.0002 |
| **Signal minus always-flat** (the only fair test of whether the BAND itself adds information) | 24 | **-0.2892** | **[-0.4154, -0.1644]** | 0.9996 (one-sided "signal beats cash") |

The always-flat control beats buy-and-hold by roughly 3x more than the actual signal does, and the
signal-minus-cash delta is negative with a 95% CI entirely below zero. Put plainly: simply not
trading this universe over this window would have been substantially better than running the
log-regression band signal. The band's real entries (21/24 assets did trigger at least one) cost
more than they saved relative to just holding cash. The pre-registered primary test's tiny p-value
is real arithmetic on real numbers, but it is measuring "was mostly out of a falling market,"
not "correctly timed entries into a mean-reverting band" — and this study's own control isolates
that difference cleanly rather than asserting it.

**Model-form diagnostic (this item's own explicit ask: state plainly whether the fit is even
stable, and whether it beats a naive drift baseline).** For each asset, a second, non-nested OLS
was also fit on the identical train segment: `log(close) ~ a + b*t` (t raw, not log-transformed) —
a plain constant-percentage-growth ("drift") model. Median across the 24 assets:

| diagnostic | median across assets |
|---|---:|
| log-log slope | 0.0144 |
| log-log slope SE | 0.0108 |
| ΔR² (log-log R² − drift R²) | **-0.0533** |

The log-log (power-law) framing fits *worse* than the naive drift model on the median asset — not
a close call, and not one asset's outlier: `deltaR2` was negative for 19 of the 24 assets (the
only exceptions were INJ +0.232, XTZ +0.168, ALGO +0.158, ETC +0.095, ETH +0.086 — 5/24, and none
by a large margin). Read together with the primary result: this project's first test
of the "rainbow chart" framing finds no evidence the log-time transform captures anything a plain
exponential-growth line does not, and no evidence the resulting band, once benchmarked correctly,
adds value over simply not trading.

**Why this is recorded as KILLED and not treated as a live candidate despite formally clearing
BH-FDR below.** `AGENT_PROTOCOL.md`'s binding rule requires every reported p-value to join the
formal-NHST family and be judged only after family-wide correction — that mechanical rule does not
know about a benchmark confound, and correctly does not exempt this result from the count just
because the study itself found a reason to distrust it. The recomputation below is reported in
full. But "survives BH-FDR" answers a narrower question (is this larger than chance alone would
produce across everything tested so far) than "is this a real, usable signal" — this study answers
the second question directly with the always-flat control, and the answer is no. No `SEALED_SYMBOLS`
re-run was performed: the provisional-clearance rule exists for economic-gate results without a
p-value; this already has a decisive, disclosed reason for rejection that a fresh symbol pool would
not change (the confound is about the holdout WINDOW's direction, not this particular symbol set).

**MULTIPLE_COMPARISONS_AUDIT.md update, same commit.** Adds this study's p=0.0002 as the 14th
sub-test (11th study) to the formal-NHST family (13 sub-tests / 10 studies as of prior to this
item). Family-wide BH-FDR recomputed across all 14 at q=0.05:

| Rank | Study | p-value | q-value | Survives q=0.05? |
|---:|---|---:|---:|---|
| 1 | **LOG-REGRESSION-BANDS-CRYPTO (holdout, primary)** | 0.0002 | 0.0028 | **yes** (see confound above) |
| 2 | B5-REVERSAL L=3 (train) | 0.0010 | 0.0070 | yes |
| 3 | CLASSIFIER-FUNDING-FEATURE (holdout, primary) | 0.0099 | 0.0462 | **yes** (flipped back — see below) |
| 4 | Classifier P5 (holdout, primary) | 0.0198 | 0.0693 | no |
| 5 | Low-vol B4 negBeta (train) | 0.0579 | 0.1512 | no |
| 6 | EQUITIES-MADIP-SIGNIFICANCE (holdout, primary) | 0.0648 | 0.1512 | no |
| 7 | CROSS-SECTIONAL-NONPRICE-RANK (train) | 0.1249 | 0.2498 | no (wrong sign) |
| 8 | EQUITIES-BREAKOUT-SIGNIFICANCE (holdout, primary) | 0.2036 | 0.3544 | no |
| 9 | Low-vol B4 negVol (train) | 0.2278 | 0.3544 | no |
| 10 | B5-REVERSAL L=5 (train) | 0.4226 | 0.5429 | no |
| 11 | MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train) | 0.4266 | 0.5429 | no |
| 12 | MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train) | 0.6024 | 0.6639 | no (wrong sign) |
| 13 | EQUITIES-BREAKOUT-OUT-OF-SAMPLE (holdout, primary) | 0.6165 | 0.6639 | no (wrong sign) |
| 14 | Momentum M7 (train) | 0.7013 | 0.7013 | no |

**Material side effect, exactly the kind this family has produced before (see
`EQUITIES-BREAKOUT-SIGNIFICANCE`'s and `EQUITIES-MADIP-SIGNIFICANCE`'s own updates for
precedent): `CLASSIFIER-FUNDING-FEATURE` flips from non-survivor back to survivor.** At n=13 it
was q=0.0644 (non-survivor). Adding this study's very small p-value at rank 1 loosens every lower
rank's threshold (`i/n` grows smaller as `n` grows, so `(i/n)*q` shrinks less per step once a
strong new hit occupies rank 1) — at n=14, `CLASSIFIER-FUNDING-FEATURE` lands at rank 3 with
threshold `(3/14)*0.05=0.01071`, and its own unchanged p=0.0099 now clears it (q=0.0462). Its own
economic-gate verdict (KILLED — best subset nets -0.24R/trade after cost) is untouched by this;
this is a purely statistical side effect of family size, not a re-examination of that study.
`B5-REVERSAL L=3` remains a comfortable survivor (q=0.0130→0.0070, tightens but does not flip).
`Classifier P5` remains a non-survivor (q=0.0858→0.0693, still above 0.05).

**Updated raw-hit-rate context.** Naive FWER at n=14, alpha=0.05: `1-(1-0.05)^14 ≈ 0.5123`.
`P(>=4 of 14 independent trials clear raw p<0.05 | null) ≈ 0.42%` (updated from the n=13 figure —
this study is itself the 4th raw hit, joining `B5-REVERSAL`/`CLASSIFIER-FUNDING-FEATURE`/`Classifier
P5`). Read at face value this is a low-probability event under a global null. **The caveat that
matters more here than in any prior update: this study is a demonstrated, disclosed case of a raw
"significant" hit that is NOT real** — the always-flat control above shows definitively that the
tiny p-value reflects a benchmark artifact (a near-uniformly bearish holdout), not a real effect.
This is concrete evidence for the correlated-tests caution this document has carried since its
first version: raw hit-counts under a global null overstate how many *real* effects are present,
and this study is the clearest single illustration of that gap produced by this project so far —
a p=0.0002 result that would be trusted at face value in almost any other context, caught only
because the study itself went looking for the confound before reporting.

**Engineering note.** New `scripts/log-regression-bands-crypto.mjs` only, additive. No strategy
code touched — `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`,
`scanner.js` all untouched, grep-confirmed against the staged diff before commit. Reused
`momentum.mjs`'s `bootstrapCI` and `researchlib.mjs`'s `splitSealedSymbols`/`symbolToKrakenId`/
`loadWatchlist` unmodified; `researchlab.mjs`'s `loadDailyCandles`/`saveExperiment` unmodified.
Full per-asset breakdown (all 24 rows: slope, SE, R² both models, episodes, strategy/buy-hold
return, outperformance) is in the saved `research-runs/*-log-regression-bands-crypto.json`
provenance record, not reproduced row-by-row here. `npm.cmd test`: 505/505 green (no new
production code path exercised by existing tests). `MULTIPLE_COMPARISONS_AUDIT.md` and
`AGENT_PROTOCOL.md`'s formal-NHST counters updated in the same commit per that document's own
binding rule.

## EQUITIES-MADIP-OUT-OF-SAMPLE — the edge reproduces on a fresh universe and gets stronger, now formally clearing family-wide BH-FDR (2026-08-22)

`EQUITIES-MADIP-SIGNIFICANCE` (above, same date) found `ma_dip`'s positive point estimate
(475 trades, DJIA-30, avgR +0.1526, p=0.0648, 95% CI includes zero) the closest any equities
result had come to nominal significance in this project's history, but not yet distinguishable
from noise. `EQUITIES-BREAKOUT-OUT-OF-SAMPLE` (above) already ran the fresh-universe re-check for
`breakout` and found its edge did not reproduce. This item is the same re-check for `ma_dip`.

**Pre-registered before any statistic below was computed** (full text in
`scripts/equities-madip-out-of-sample.mjs`'s header, same commit as these results). Window/universe:
reused `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`'s own cache (`research-cache/equities-1d-djta-oos/`) —
the point-in-time DJTA-20 universe, zero ticker overlap with the DJIA-30 universe
`EQUITIES-MADIP-SIGNIFICANCE` used — rather than fetching a second, different universe, per this
item's own work_queue note ("no reason to pull twice"). Cache-only: no IB Gateway call made, even
though Gateway was reachable in this environment as of this firing. Cost basis, split (70/30), and
`ma_dip` config (`{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0,
maxStopPct: .06, tpR: 5, lockBreakeven: true }`) held EXACTLY as `EQUITIES-MADIP-SIGNIFICANCE` —
only the universe changes. Statistical test: `EQUITIES-MADIP-SIGNIFICANCE`'s exact one-sided
sign-flip permutation test (null: population mean R is zero), 5000 iterations, seed 20260822;
95% CI via `momentum.mjs`'s `blockBootstrapCI` (blockSize=4, unmodified). Decision rule: report
trades/avgR/CI/p side by side with the original DJIA-30 table and state plainly whether the edge
reproduces, holds up weaker, or vanishes. No parameter, universe, or cost figure changed after
seeing results.

**Results, side by side:**

| universe | trades | avgR | 95% CI (block bootstrap) | p (sign-flip, one-sided) |
|---|---:|---:|---:|---:|
| DJIA-30 (original, `EQUITIES-MADIP-SIGNIFICANCE`) | 475 | +0.1526 | [-0.0544, +0.3609] | 0.0648 |
| DJTA-20 (this item, out-of-sample) | 300 | **+0.2994** | **[+0.0509, +0.5350]** | **0.0116** |

**The edge reproduces and gets stronger, not weaker.** Same sign, larger point estimate
(+0.2994 vs +0.1526), and on this fresh, zero-overlap universe the 95% CI clears zero entirely —
the first time any equities result in this project has produced a holdout CI that excludes zero
on an out-of-sample universe. This is the opposite outcome from `EQUITIES-BREAKOUT-OUT-OF-SAMPLE`,
where the same re-check flipped `breakout`'s sign negative. 300 trades on 20 symbols is a smaller
sample than the original 475/30, but the tighter CI despite fewer trades reflects a genuinely
larger and more consistent effect on this universe, not a sample-size artifact working in its
favor.

**Family-wide BH-FDR, recomputed across all 15 formal-NHST entries at q=0.05** (full table:
`MULTIPLE_COMPARISONS_AUDIT.md` §2, `AGENT_PROTOCOL.md`'s counter updated to 15 in the same
commit):

| Rank | Study | p-value | q-value | Survives q=0.05? |
|---:|---|---:|---:|---|
| 1 | LOG-REGRESSION-BANDS-CRYPTO (holdout, primary) | 0.0002 | 0.0030 | yes (but see above — a demonstrated benchmark artifact, not a real effect) |
| 2 | B5-REVERSAL L=3 (train) | 0.0010 | 0.0075 | yes |
| 3 | CLASSIFIER-FUNDING-FEATURE (holdout, primary) | 0.0099 | 0.0495 | yes |
| 4 | **EQUITIES-MADIP-OUT-OF-SAMPLE (holdout, primary)** | **0.0116** | **0.0435** | **yes (new)** |
| 5 | Classifier P5 (holdout, primary) | 0.0198 | 0.0594 | no |
| 6 | Low-vol B4 negBeta (train) | 0.0579 | 0.1448 | no |
| 7 | EQUITIES-MADIP-SIGNIFICANCE (holdout, primary) | 0.0648 | 0.1389 | no |
| 8 | CROSS-SECTIONAL-NONPRICE-RANK (train) | 0.1249 | 0.2342 | no (wrong sign) |
| 9 | EQUITIES-BREAKOUT-SIGNIFICANCE (holdout, primary) | 0.2036 | 0.3393 | no |
| 10 | Low-vol B4 negVol (train) | 0.2278 | 0.3417 | no |
| 11 | B5-REVERSAL L=5 (train) | 0.4226 | 0.5763 | no |
| 12 | MOMENTUM-SHORT-HORIZON-RECHECK L=14 (train) | 0.4266 | 0.5333 | no |
| 13 | MOMENTUM-SHORT-HORIZON-RECHECK L=7 (train) | 0.6024 | 0.6950 | no (wrong sign) |
| 14 | EQUITIES-BREAKOUT-OUT-OF-SAMPLE (holdout, primary) | 0.6165 | 0.6605 | no (wrong sign) |
| 15 | Momentum M7 (train) | 0.7013 | 0.7013 | no |

**`EQUITIES-MADIP-OUT-OF-SAMPLE` formally clears BH-FDR at rank 4 of 15 (q=0.0435).** No existing
survivor flips: `LOG-REGRESSION-BANDS-CRYPTO`, `B5-REVERSAL L=3`, and `CLASSIFIER-FUNDING-FEATURE`
all remain survivors (their own p-values unchanged; thresholds shift slightly from family growth
but none cross out). This is a genuinely different shape of result from the family's other three
survivors: `LOG-REGRESSION-BANDS-CRYPTO` is a demonstrated benchmark artifact (disclosed above),
and `B5-REVERSAL L=3`/`CLASSIFIER-FUNDING-FEATURE` are this project's standing examples of
"statistically real, economically dead" — real effects too small for real trading costs to
monetize. `EQUITIES-MADIP-OUT-OF-SAMPLE` is neither: it is a fresh-universe replication with a
*larger*, not smaller, point estimate, and its avgR is already computed net of the same real
IBKR commission + 5bps slippage cost basis every equities study in this family uses — this is not
a gross-only number that could evaporate on contact with costs the way the confound above did.

**What this is not.** Statistical significance and a positive net-of-cost point estimate on one
fresh universe are not, by themselves, a live-promotion decision. `AGENT_PROTOCOL.md`'s
economic-gate rule independently requires re-validation against `SEALED_SYMBOLS` (or an equivalent
genuinely-unseen holdout) before any D3 live-promotion consideration, and this item does not
attempt that — it is a significance/reproduction check only, matching its own `done_when` and
`EQUITIES-MADIP-SIGNIFICANCE`'s own precedent of not writing a `VERDICTS.md` row for a
significance-only result. What can be said plainly: of every equities or crypto result this
project has produced, `ma_dip` on this DJTA-20 out-of-sample universe is now the single strongest
evidence-backed candidate on record — the only one with both a fresh-universe replication AND a
formal BH-FDR survival AND a CI that excludes zero, net of real cost. It is a legitimate candidate
for the next confirmatory step (a second genuinely independent holdout, or `SEALED_SYMBOLS`
re-validation), not yet a verdict.

**Engineering note.** New `scripts/equities-madip-out-of-sample.mjs` only, additive, cache-only
(does not import `brokers/ibkr.mjs`). No strategy code touched — `backtest.js`, `strategy.js`,
`tournament.mjs`, `monitor.js`, `bot.js`, `trader.js`, `scanner.js` all untouched, grep-confirmed
against the staged diff before commit. `momentum.mjs`'s `blockBootstrapCI` and
`researchlab.mjs`'s `saveExperiment` used unmodified. `npm.cmd test`: 505/505 green (no
production or test file touched — no companion test file added, matching this family's precedent
for read-only research scripts under `scripts/`). `MULTIPLE_COMPARISONS_AUDIT.md` and
`AGENT_PROTOCOL.md`'s formal-NHST counters updated in the same commit per that document's own
binding rule.

## OPTIONS-SKEW-PRIMARY-SIGNAL — closes as a data-availability non-verdict before any strategy code was written (2026-08-22)

This item's own `done_when` requires data availability and history depth confirmed **before**
any strategy code is written, with an explicit escape hatch: an honest non-verdict if the window
cannot support a train/holdout split. `EXOGENOUS-DATA-ACCESS-AUDIT` had already flagged its own
Deribit probe as inconclusive rather than final — its `get_historical_volatility` endpoint
returned only ~16 days and the audit said explicitly this "is not sufficient on its own and
should not be treated as 'options data is available' without \[a\] follow-up." This item is that
follow-up, run via new `scripts/options-skew-data-depth-check.mjs` (additive, read-only, no
strategy logic, no backtest, no order path — same shape as the audit script it extends).

**Correction to the prior audit, found and disclosed rather than left standing.** Deribit exposes
a *different* public endpoint, `get_volatility_index_data`, that serves DVOL — Deribit's own
aggregate implied-volatility index, their VIX-equivalent — with genuinely deep history. Walking
backward past the API's 1000-row page cap (paging `end_timestamp` to the prior page's earliest
row rather than trusting the first page's window) found real data back to **2021-03-24**, ~1976
days to today — nowhere near the 16-day figure the prior audit recorded, because that probe hit a
different, more limited endpoint. This is corrected here rather than quietly carried forward.

**Why that correction does not resolve this item anyway.** DVOL is an aggregate implied-volatility
*level* — a single number per day, analogous to VIX. This item's pre-registered task asks for
**25-delta put/call skew** and the **IV term structure (front vs. back month)** specifically,
because the mechanism under test is about the shape of the vol surface (capitulation vs. euphoria
priced asymmetrically into puts vs. calls), not the overall level. Substituting DVOL for skew now,
after confirming DVOL has history and skew does not, would be exactly the after-the-fact
hypothesis change this item's own note warns against ("pre-register which direction you are
testing before looking, and test ONE formulation — testing both and reporting the better one is
the look-elsewhere error the audit was written to prevent"). Swapping the *construct*, not just
the direction, after seeing what data exists is the same error in a different disguise, so it is
not taken here.

**Skew/term-structure history was checked directly, not assumed absent.** A real call against
`get_book_summary_by_currency` (currency=BTC, kind=option) confirmed the closest candidate
endpoint returns a **live snapshot only** — 1,038 currently-listed contracts with current
mark/bid/ask IV, and no start/end timestamp parameter on this or any other public Deribit option
endpoint. There is no way to ask this API "what was the 25-delta skew on 2024-03-01"; that
history exists only if a market participant recorded chain snapshots forward from some past date
themselves, or holds a paid historical-options vendor (Amberdata/Genesis Volatility/Laevitas-class
providers) — this project has neither. IBKR was checked too: `brokers/ibkr.mjs` today has zero
options-related code (no `secType=OPT`, no chain request, no implied-vol handling anywhere in the
module) — confirmed by reading the file, not assumed. Even with the Gateway reachable, building
option-chain support from scratch — contract selection by delta, per-expiry historical bars, and
splicing many expiring contracts into one continuous skew/term-structure series — is substantial
new engineering, not a data-availability check, and is far outside this item's 30-60 min scope.

**Why this is a non-verdict, not a kill.** No strategy return was ever computed, no direction was
pre-registered against real data, and no train/holdout split was attempted — per this item's own
`done_when`, that is the correct order of operations, not a shortcut skipped. This does **not**
join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family (no p-value was computed, nothing to
correct for) and is deliberately not a `VERDICTS.md` row, matching `MACRO-REGIME-PRIMARY-SIGNAL`'s
precedent for a data/sample-size non-verdict.

**What would actually resolve this, stated for whoever picks it up next.** Not a different
Deribit endpoint — there isn't one. Either (a) start recording live Deribit option-chain snapshots
now and wait for enough history to accumulate before this can be tested at all (months, per this
item's own original scoping note), or (b) confirm and budget for a paid historical-options vendor
with real per-strike archive depth, which is a cost/access decision this run does not make
unilaterally. `WHALE-WALLET-ACCUMULATION-PRIMARY` (next in the queue behind this one) faces a
structurally similar decision per `EXOGENOUS-DATA-ACCESS-AUDIT`'s own on-chain findings and should
be checked with the same discipline before any strategy code is written there either.

**Engineering note.** New `scripts/options-skew-data-depth-check.mjs` only, additive, read-only.
No strategy code touched — `backtest.js`, `strategy.js`, `tournament.mjs`, `monitor.js`, `bot.js`,
`trader.js`, `scanner.js` all untouched, grep-confirmed against the staged diff before commit.
`researchlab.mjs`'s `saveExperiment` used unmodified. `npm.cmd test`: 505/505 green (no production
or test file touched — no companion test file added, matching this family's precedent for
read-only research scripts under `scripts/`).
