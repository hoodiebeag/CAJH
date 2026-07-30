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
