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
