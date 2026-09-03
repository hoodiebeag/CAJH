# Verdict detail

Full text of every `VERDICTS.md` row, preserved verbatim. The operative index is `VERDICTS.md`;
this file exists so the index could become readable without any hypothesis text, deciding metric,
caveat or citation being lost. Nothing here is summarised or edited -- the rows are byte-identical
to what the index carried before 2026-09-03.

## Trade intensity

**Verdict:** KILLED

**Holdout n:** — — **Date:** pre-2026-08-04 — **Commit:** —

**Deciding metric:** No improvement over baseline

**Hypothesis:** Order-flow trade-intensity filter

## Order-flow

**Verdict:** Complete, no edge

**Holdout n:** 11,195 (final pool) — **Date:** pre-2026-08-04 — **Commit:** —

**Deciding metric:** —

**Hypothesis:** Pooled BTC/ETH/SOL flow signal

## MR1

**Verdict:** Implemented, not promoted

**Holdout n:** — — **Date:** 2026-08-05 — **Commit:** 0bfc60c

**Deciding metric:** 8/8 tests green

**Hypothesis:** RSI(14)/30 mean-reversion, MA(20) exit

## Momentum M7

**Verdict:** KILLED

**Holdout n:** 73 dates/881 rows (whole-symbol) — **Date:** 2026-08-06 — **Commit:** 5cafa36

**Deciding metric:** Train IC=0.028, p=0.70 (fails train-significance gate)

**Hypothesis:** Cross-sectional momentum, residual (T2)

## Low-vol B4

**Verdict:** KILLED (complete evidence, PWR3)

**Holdout n:** negVol 78 dates/982 rows, negBeta 71 dates/865 rows (whole-symbol) — **Date:** 2026-08-07 — **Commit:** 9837597

**Deciding metric:** Train negVol p=0.228, negBeta p=0.058 (both fail train-significance gate)

**Hypothesis:** Low-volatility / low-beta (rank=negVol, negBeta)

## Classifier P5

**Verdict:** KILLED (complete evidence, PWR4)

**Holdout n:** 7580 (whole-symbol) — **Date:** 2026-08-08 (economics corrected 2026-08-29) — **Commit:** d304419

**Deciding metric:** Holdout AUC 0.5249 beats permutation null (p=0.0198, significant) but economic lift fails cost: selected-subset net **-0.8544** R/trade vs baseline **-0.8989** (lift +0.0445, still deeply negative). **Economics figure corrected 2026-08-29** (`CLASSIFIER-P5-ECONOMICS-ROW-STALENESS`, superseding the original -0.4616/-0.5178): `economicLiftNetOfCost`'s `roundTripCost` was being subtracted a second time on top of cost already baked into `profileEntries`' `netR` by `strategy.js`'s `FEE_RATE`/`SLIPPAGE_PCT`; corrected figure calls it with `roundTripCost=0` since `netR` already reflects the real ~1.7% round-trip cost. AUC and the KILLED verdict are unchanged — see ROADMAP.md's dated entry for the full derivation

**Hypothesis:** Logistic classifier (entry-time features)

## Roadmap v2 (rejected)

**Verdict:** DUPLICATE — not staged

**Holdout n:** — — **Date:** 2026-08-06 — **Commit:** (not staged)

**Deciding metric:** Same mechanism as `anticipate`/`bos` below, ~80% confidence from 3 independent judges

**Hypothesis:** Swing-low 5-bar/close pivot, BTC/ETH/SOL, 1d (see TOURNAMENT_ROADMAP.md: Addendum (2026-08-06) — "Research Roadmap v2" reviewed and rejected as duplicative)

## T1-ZEROCOST

**Verdict:** 7/8 still negative gross; `breakout` alone flips to cost-drag

**Holdout n:** 3123 — **Date:** 2026-08-07 — **Commit:** (T1 commit)

**Deciding metric:** `breakout` holdout +0.045R gross / -0.445R net, 3123 trades

**Hypothesis:** Zero-cost tournament, 8 baseline families (see TOURNAMENT_ROADMAP.md: Track 1 — RESULT (2026-08-06))

## T1B-BREAKOUT-COSTFIX

**Verdict:** FAIL

**Holdout n:** 3123 — **Date:** 2026-08-07 — **Commit:** 859bd86

**Deciding metric:** Holdout avgR improved -0.445→-0.381 but stays negative; only 2/28 assets positive

**Hypothesis:** Cost-reduction on `breakout` (tpR 3→5, breakoutLookback 20→55) (see TOURNAMENT_ROADMAP.md: Track 1 — T1B-BREAKOUT-COSTFIX RESULT (2026-08-07))

## T2-VOLCONTRACTION

**Verdict:** FAIL

**Holdout n:** 98 — **Date:** 2026-08-07 — **Commit:** b914d7d

**Deciding metric:** Holdout avgR -0.322, 98 trades, positive on 5/21 assets (gate: ≥150 trades, >+0.10, ≥40% win, ≥50% assets)

**Hypothesis:** ATR-compression breakout entry (see TOURNAMENT_ROADMAP.md: Track 2 — RESULT (2026-08-07): ABANDONED)

## T3-REGIMEFILTER

**Verdict:** FAIL

**Holdout n:** 1408 — **Date:** 2026-08-07 — **Commit:** 4d63fd8

**Deciding metric:** Holdout avgR -0.379 vs **-0.445** unfiltered (gate: >-0.10 required). **Corrected 2026-09-02** (`VERDICTS-ROW-WRITEUP-RECONCILIATION`): row previously cited -0.437, the pre-Track-1-rerun comparison figure; TOURNAMENT_ROADMAP.md's own Track 3 RESULT section (2026-08-07) states -0.437 predates the larger/updated watchlist Track 1 actually ran against and was superseded same-day by -0.445, Track 1's actual holdout figure for unfiltered `breakout`. Verdict FAIL and -0.379 unchanged.

**Hypothesis:** BTC 200d-SMA gate on `breakout` only

## T4-PORTFOLIO-MOMENTUM

**Verdict:** ABANDONED (verdict confirmed with corrected data, see T4-COVERAGE-FIX below)

**Holdout n:** — — **Date:** 2026-08-07 — **Commit:** 3e82137

**Deciding metric:** Both strategies failed sealed holdout (see TOURNAMENT_ROADMAP.md Track 4 RESULT for full table; original numbers superseded by the T4-COVERAGE-FIX rerun for the coverage-affected holdout window)

**Hypothesis:** Cross-sectional momentum_30d/momentum_vol, 7d+30d rebalance

## T4-COVERAGE-FIX

**Verdict:** Verdict unchanged (ABANDONED); one clause flips

**Holdout n:** — — **Date:** 2026-08-09 — **Commit:** 9a34c82

**Deciding metric:** `momentum_30d` 30d-rebalance maxDrawdown -36.8%→-34.0% (FAIL→PASS), but its Sharpe 0.360 still fails the >0.5 gate — see TOURNAMENT_ROADMAP.md "T4-COVERAGE-FIX rerun" for full old-vs-new table, all 4 variants

**Hypothesis:** Coverage-bug rerun of T4-PORTFOLIO-MOMENTUM's 4 variants (portfolio.mjs panel() included non-tradable BTC's longer date range in the shared calendar; stale positions scored a phantom 0% instead of being excluded/renormalized)

## PWR3

**Verdict:** done — result folded into `Low-vol B4` row above

**Holdout n:** — — **Date:** 2026-08-07 — **Commit:** 9837597

**Deciding metric:** —

**Hypothesis:** Low-vol whole-symbol sealed arm (post PWR1 data fix)

## PWR4

**Verdict:** done — result folded into `Classifier P5` row above

**Holdout n:** — — **Date:** 2026-08-08 — **Commit:** d304419

**Deciding metric:** —

**Hypothesis:** Classifier whole-symbol sealed AUC (post PWR1 data fix)

## T5-DECAY-EXIT

**Verdict:** FAIL

**Holdout n:** 3473 — **Date:** 2026-08-07 — **Commit:** 3e93bfe

**Deciding metric:** Holdout avgR -0.445→-0.437 (negligible), trades 3123→3473; gate required avgR>-0.30

**Hypothesis:** Time-based decay exit (24 bars, maxHold) on `breakout` (see TOURNAMENT_ROADMAP.md: Track 1 — T5-DECAY-EXIT RESULT (2026-08-07))

## T6-TIMEFRAME-ISOLATION

**Verdict:** FAIL (both families)

**Holdout n:** 314 / 24 — **Date:** 2026-08-07 — **Commit:** a556f78

**Deciding metric:** anticipate avgR -0.237 (314 trades); bos avgR -0.536 (24 trades); gate required avgR>0 & ≥150 trades

**Hypothesis:** `anticipate`/`bos` re-tested at 1d (never tested off 1h before) (see TOURNAMENT_ROADMAP.md: T6-TIMEFRAME-ISOLATION RESULT (2026-08-07))

## H11

**Verdict:** DATA-GATED, honest non-verdict (diagnosed 2026-08-08) — 28/29 watchlist assets fail with Binance funding API returning HTTP 451 (geo-blocked from this environment, not a per-symbol bug); the 1 remaining (EOS) fails on unrelated pre-existing candle-history gap; alternative Kraken funding source works but only has ~367 of the required 730 days of history, so a provider swap would not clear the gate either without weakening the pre-registered threshold

**Holdout n:** 0 (0 eligible assets, environmental access ceiling) — **Date:** 2026-08-08 — **Commit:** e511b73

**Deciding metric:** Gate: train trades>=200 & holdout trades>=80, both avgR>0, holdout positive-asset rate>=50% — never actually evaluated on real funding coverage, 0 assets ever reached this check

**Hypothesis:** Funding-rate gate (Binance perp funding <=0.01%) on `anticipate`

## DCA-MARTINGALE

**Verdict:** FAIL (ruin)

**Holdout n:** 57 — **Date:** 2026-08-08 — **Commit:** adaef56

**Deciding metric:** avgR/unit-capital -0.2313, 57 intervals, ruin=true (equity reached zero)

**Hypothesis:** Martingale sizing (capped 4x) on the fixed-interval DCA basket — deviated from its own pre-registered ma_dip trigger, see executor_result

## DCA-ANTIMARTINGALE

**Verdict:** FAIL

**Holdout n:** 57 — **Date:** 2026-08-08 — **Commit:** 80ce307

**Deciding metric:** avgR/unit-capital -0.1289 (gate needed >0), 57 intervals (gate needed ≥100), ruin=true

**Hypothesis:** Anti-martingale sizing (capped 4x) on the fixed-interval DCA basket — same deviation as DCA-MARTINGALE

## GRID-SIM

**Verdict:** FAIL

**Holdout n:** 27/28 symbols — **Date:** 2026-08-08 — **Commit:** 5af61dc

**Deciding metric:** Holdout return -25.23% vs buy-and-hold -9.87% (worse, 22/27 symbols fail); drawdown -34.11% vs -54.96% (better, 27/27 pass)

**Hypothesis:** Geometric grid (10 levels/9 rungs, rolling 90-bar bound) vs buy-and-hold

## TRAIL-STOP-EXIT

**Verdict:** FAIL (both variants)

**Holdout n:** 2675 / 2257 — **Date:** 2026-08-08 — **Commit:** 9cc34da

**Deciding metric:** 5%: holdout avgR -0.381 (gate >-0.30); 10%: -0.469, worse than baseline with a train/holdout sign flip

**Hypothesis:** Trailing %-drawdown exit (5%/10%, replacing fixed TP) on `breakout` (see TOURNAMENT_ROADMAP.md: TRAIL-STOP-EXIT RESULT (2026-08-08))

## B5-REVERSAL

**Verdict:** KILLED (both L)

**Holdout n:** L=3: 206 dates/2553 rows; L=5: 125 dates/1543 rows (whole-symbol) — **Date:** 2026-08-08 — **Commit:** (B5 commit)

**Deciding metric:** L=3 train IC=-0.0685 p=0.0010 (first primary-cell IC to clear §6 significance, correct sign) with same-sign overlapping-CI holdout, but net economics fail decisively at the corrected real ~1.7% round-trip cost (-0.0025 to -0.0243 across quantiles); L=5 fails train significance alone (p=0.4226)

**Hypothesis:** Short-horizon (L=3d/5d) cross-sectional reversal, `rank=return` sign-flipped

## CLASSIFIER-FUNDING-FEATURE

**Verdict:** KILLED (complete evidence)

**Holdout n:** 2163 primary (whole-symbol), funding-covered rows only (3969 of 15076 total) — **Date:** 2026-08-08 (economics corrected 2026-08-29) — **Commit:** (this commit)

**Deciding metric:** Holdout AUC 0.5943 beats permutation null (p=0.0099, stronger than P5's 0.0198); recent-arm also significant (p=0.0198, unlike P5). Economic lift fails cost: selected-subset net **-0.6351** R/trade vs baseline **-0.9253** (lift +0.2902, still deeply negative). **Economics figure corrected 2026-08-29** (`VERDICTS-COST-CONSTANT-STALENESS-SWEEP`, superseding the original -0.2412/-0.2492 selected and -0.5387/-0.5467 baseline): same `economicLiftNetOfCost` double-count `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` found on Classifier P5, and worse here — this row's `netR` was originally computed ~16 minutes before `FEE-DEFAULTS-UPDATE` rebased `strategy.js`'s `FEE_RATE`, so the original figures also mixed a stale-cost `netR` basis with an already-corrected separate `roundTripCost`, meaning the true figure could not be recovered by arithmetic alone and required a fresh re-run (`buildClassifierUniverseRows`/`classifierOutcomeReport` with `roundTripCost=0` under current `strategy.js` constants). Row counts (15076 total/3969 funding-covered/2163 primary holdout) and AUC (0.5943, byte-identical) reproduce exactly, ruling out a data or universe change; only the economics figure moved. AUC and the KILLED verdict are unchanged — see ROADMAP.md's dated entry for the full derivation

**Hypothesis:** Logistic classifier P5 + btcFundingRate covariate (Kraken PF_XBTUSD)

## B5-REVERSAL-PHASE3-FUTURES-COST

**Verdict:** WEAK PASS on the literal pre-registered gate — not a confident PASS; not a D3/live candidate; SUPERSEDED by B5-REVERSAL-PHASE4-PORTFOLIO-SIM below (FAIL)

**Holdout n:** 206 (16-symbol real holdout, matches the exact figure B5-REVERSAL's original IC significance test already used) — **Date:** 2026-08-13 — **Commit:** (PHASE3 commit)

**Deciding metric:** top-3: train net +0.0056, holdout net +0.0048 (same sign, holdout positive, 206 obs >=150 — clears the pre-registered PHASE3 gate as written). top-5: train +0.0049, holdout +0.0058, same pattern. BUT: 95% block-bootstrap CI (blockSize=4, this project's own convention) on the holdout series includes zero for both (top-3 [-0.0064, 0.0142]; top-5 [-0.0055, 0.0156]) — not statistically distinguishable from noise at this sample size, reported as a due-diligence addition beyond what PHASE3's done_when literally required

**Hypothesis:** Same signal as B5-REVERSAL (L=3, `rank=return` sign-flipped), re-priced at futures-taker cost (~0.10% round trip, PWR5's cost model) instead of the original 1.7% spot-taker basis, and — new — economics computed on the REAL 16-symbol holdout universe (`symbolHoldoutUniverse`) for the first time; the original B5-REVERSAL row's economics were only ever computed on the controlled (STABLE_13) train split

## B5-REVERSAL-PHASE4-PORTFOLIO-SIM

**Verdict:** **FAIL** — decisive on two independent grounds

**Holdout n:** 392 rebalances, 2023-01-10 to 2026-03-31 (16-symbol held-out universe) — **Date:** 2026-08-13 — **Commit:** (PHASE4 commit)

**Deciding metric:** Sharpe never approaches the 0.5 gate (best case N=5: 0.208; the more selective N=3 primary is actually NEGATIVE: total return -23.5%, Sharpe -0.094). Fails the required +/-20% parameter-perturbation robustness check outright: N=3->N=4 flips the annual return's SIGN (-8.0% -> +4.9%) on a 1-position change — the textbook overfitting signature this item's own gate names verbatim. Max drawdown -79% to -90% across every N tested, independently far outside this project's own -35% portfolio floor (T4's convention)

**Hypothesis:** Same candidate as B5-REVERSAL-PHASE3-FUTURES-COST, run through a real shared-capital equity-curve simulation (`portfolio.mjs`'s `simulatePortfolio`, real compounding/drawdown, not a per-rebalance average) on the same 16-symbol held-out universe, equal weight, futures-taker cost, 3d rebalance

## H3-HIGHER-LOW-RECLAIM

**Verdict:** **FAIL**

**Holdout n:** 4590 — **Date:** 2026-08-13 — **Commit:** (H3-HIGHER-LOW-RECLAIM commit)

**Deciding metric:** Holdout avgR/trade -1.652 (gate required >-0.30), 4590 holdout trades (gate required >=150, cleared — not a sample-size non-verdict), 0/28 assets positive, train avgR -1.526 (10911 trades) — same sign and comparable magnitude to holdout, decisive, not a borderline call

**Hypothesis:** `h3` entry mode (backtest.js `h3Entry`) — selective higher-low reclaim: requires 2+ prior confirmed swing lows forming a genuine higher-low structure, then buy on close back above the most recent pivot. Previously closed by argument-by-analogy only (T6-TIMEFRAME-ISOLATION note: grouped with anticipate/bos "by the same-mechanism argument," never independently run through a sealed holdout) — this is the first real train/holdout run, via the standard `tournament.mjs` `families` harness (already had an `h3` entry, just never gated/verdicted), full 28-asset watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip) (see TOURNAMENT_ROADMAP.md: H3-HIGHER-LOW-RECLAIM RESULT (2026-08-13))

## RANGE-SWEEP-RECLAIM

**Verdict:** **FAIL**

**Holdout n:** 511 — **Date:** 2026-08-13 — **Commit:** (RANGE-SWEEP-RECLAIM commit)

**Deciding metric:** Holdout avgR/trade -1.120 (gate required >-0.30), 511 holdout trades (gate required >=150, cleared despite this family's own selectivity — not a sample-size non-verdict), 1/28 assets positive, train avgR -1.090 (1055 trades) — same sign and closely matching magnitude to holdout, decisive, not a borderline call

**Hypothesis:** `range_sweep_reclaim` entry mode (backtest.js `rangeSweepReclaimEntry`) — 2+ touches of the SAME support level within the prior 24 bars (within 0.5%), a flat 20/50 MA relationship (range-bound), AND volume expansion (>=1.2x 20-bar avg) on the reclaim bar; more selective than the already-tested plain `sweep_reclaim` (-0.590 train / -0.711 holdout FAIL). Previously closed by the same argument-by-analogy as H3-HIGHER-LOW-RECLAIM (T6-TIMEFRAME-ISOLATION note), never independently run through a sealed holdout — this is the first real train/holdout run, via the standard `tournament.mjs` `families` harness (already had a `range_sweep_reclaim` entry, just never gated/verdicted), full 28-asset watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip) (see TOURNAMENT_ROADMAP.md: RANGE-SWEEP-RECLAIM RESULT (2026-08-13))

## TREND-GATE-MA

**Verdict:** **FAIL** (both families)

**Holdout n:** 1451 (anticipate) / 1123 (breakout) — **Date:** 2026-08-13 — **Commit:** (TEST-TREND-GATE-FILTER commit)

**Deciding metric:** anticipate: holdout avgR -0.963 (gate required >-0.30), 1451 trades (>=150, cleared), 0/27 assets positive, train avgR -0.738 (4759 trades) — same sign, decisive. breakout: holdout avgR -0.797 (gate required >-0.30), 1123 trades (>=150, cleared), 1/28 assets positive, train avgR -0.851 (3662 trades) — same sign, decisive

**Hypothesis:** strategy.js's `TREND_GATE_MODE="ma"` per-asset trend filter (4h close above its own TREND_MA(20) average) — a fully-implemented, previously-untested research-only config, distinct from the already-tested T3-REGIMEFILTER (which gated only `breakout` on BTC's own 200d SMA as one market-wide signal, not each asset's own trend state). Applied to `anticipate` and `breakout` via `tournament.mjs`'s new `runTrendGateFilter`, full 28-asset watchlist, corrected real cost basis (~1.7% round trip). Wiring note: `breakout`'s entry branch in backtest.js had no trend-gate check at all before this item (comment explicitly said "no trend/alignment gate, the whole point") — added an opt-in check (only active when `trendGate:true` is passed; every existing default config still passes `false` and is unaffected, 301/301 tests green) so this family could actually be tested rather than silently ignoring the config (see TOURNAMENT_ROADMAP.md: TEST-TREND-GATE-FILTER RESULT (2026-08-13))

## TREND-GATE-STRUCTURE

**Verdict:** **FAIL** (both families)

**Holdout n:** 641 (anticipate) / 490 (breakout) — **Date:** 2026-08-13 — **Commit:** (TEST-TREND-GATE-FILTER commit)

**Deciding metric:** anticipate: holdout avgR -1.062 (gate required >-0.30), 641 trades (>=150, cleared), 0/24 assets positive, train avgR -0.741 (2916 trades) — same sign, decisive. breakout: holdout avgR -0.965 (gate required >-0.30), 490 trades (>=150, cleared), 1/26 assets positive, train avgR -0.865 (2077 trades) — same sign, decisive

**Hypothesis:** strategy.js's `TREND_GATE_MODE="structure"` per-asset trend filter (4h making higher highs AND higher lows) — same untested config family as TREND-GATE-MA above, different mode. Applied to `anticipate` and `breakout` via the same `runTrendGateFilter` harness and cost basis; reuses the same breakout wiring fix noted in the TREND-GATE-MA row (see TOURNAMENT_ROADMAP.md: TEST-TREND-GATE-FILTER RESULT (2026-08-13))

## PORTFOLIO-LIVE-SIGNAL-SIM

**Verdict:** **FAIL** (both rebalance variants, all three gate clauses each)

**Holdout n:** 392 (28-asset holdout, both variants) — **Date:** 2026-08-14 — **Commit:** (PORTFOLIO-LIVE-SIGNAL-SIM commit)

**Deciding metric:** 7d: holdout Sharpe -0.231, total return -14.2%, max drawdown -53.4% (gate: Sharpe>0.5, return>0, drawdown>-35%, all FAIL). 30d: holdout Sharpe -0.375, total return -21.9%, max drawdown -58.2% (all FAIL). Train sign agrees with holdout on both variants

**Hypothesis:** The existing live swing-fractal signal (`strategy.js`'s `entrySignal`/`detectSwings`, imported unchanged) run across the full 28-asset watchlist simultaneously through `portfolio.mjs`'s `simulatePortfolio()`, risk-sized per `strategy.js`'s own live formula (`RISK_PCT`/stop distance, capped at `MAX_POSITION_PCT`) and capped in aggregate by a new correlated-exposure ceiling (`MAX_PORTFOLIO_EXPOSURE_PCT=0.60`, ROADMAP.md's never-yet-executed go-live-checklist item) — a capital-allocation/diversification test distinct from every prior single-symbol study of this and other signals, using the same sealed 70/30 split as Track 4 (see TOURNAMENT_ROADMAP.md: PORTFOLIO-LIVE-SIGNAL-SIM RESULT (2026-08-14))

## FUNDING-MEANREV

**Verdict:** **TRAIN-GATE-FAIL** (holdout never examined, gate immutable once the test begins)

**Holdout n:** 0 (train-gate-blocked; holdout not examined) — **Date:** 2026-08-14 — **Commit:** (FUNDING-MEANREV commit)

**Deciding metric:** Train avgR/trade -0.891 (gate required >-0.50), 131 trades (gate required >=150) — both clauses fail; 19/28 assets fired >=1 trade, only 3/19 positive

**Hypothesis:** Spot longs gated on negative perpetual funding (< -0.005%, shorts paying longs) AND `breakout`'s own trigger, on top of `tournament.mjs`'s exact `breakout` baseline config — distinct from H11 (funding<=0.01% as a low-funding *inclusion* gate on `anticipate`); this uses a signed negative-funding entry veto on `breakout`. Kraken funding source (Binance is HTTP 451 geo-blocked, same as H11); 28/29 assets clear the >=365-day/>=8-asset data-availability gate (EOS excluded, broken data) — not a repeat of H11's own data-gated non-verdict, which needed 730 days and never got any assets past coverage. Train/holdout split drawn from the funding-covered window itself (70/30 fraction, per-asset) rather than the task's literal "to 2025-06-01" boundary, which predates funding data existing at all (Kraken history starts 2025-08-13) — a disclosed split-boundary substitution, not a gate-number change (see TOURNAMENT_ROADMAP.md: FUNDING-MEANREV RESULT (2026-08-14))

## ONCHAIN-FLOW-GATE

**Verdict:** **ONCHAIN-DATA-INSUFFICIENT** (data-availability gate fails immediately, a complete non-verdict per this item's own pre-registered done_when)

**Holdout n:** 0 (0/2 required assets clear data availability) — **Date:** 2026-08-14 — **Commit:** (ONCHAIN-FLOW-GATE commit)

**Deciding metric:** Glassnode `transactions/transfers_volume_exchanges_net` (free-tier's closest net-exchange-flow metric) returns HTTP 401 for both BTC and ETH — no GLASSNODE_API_KEY/CRYPTOQUANT_API_KEY configured in this environment (confirmed directly against `.env`), and registering one is outside this project's unattended automation scope

**Hypothesis:** Breakout entries gated on 7-day rolling net exchange outflow (BTC/ETH, 1d timeframe), a leading-demand information source unavailable to every price-structure-only family tested to date — pre-registered with its own data-availability gate specifically because this repo has never done on-chain data ingestion before (see TOURNAMENT_ROADMAP.md: ONCHAIN-FLOW-GATE RESULT (2026-08-14))

## FIB-PULLBACK

**Verdict:** **TRAIN-GATE-FAIL** (both levels; holdout never examined, gate immutable once the test begins)

**Holdout n:** 0 (train-gate-blocked on both levels; holdout not examined) — **Date:** 2026-08-14 — **Commit:** (FIB-PULLBACK commit)

**Deciding metric:** 50% level: train avgR/trade -0.907 (gate required >-0.50), 362 trades (gate required >=200, cleared) — avgR clause fails; 23/28 assets fired >=1 trade, 2/23 positive. 61.8% level: train avgR/trade -0.770 (gate required >-0.50), 225 trades (>=200, cleared) — avgR clause fails; 21/28 assets fired, 2/21 positive

**Hypothesis:** New `fib_pullback` entry mode (backtest.js): reuses `bos` mode's own confirmed break-of-structure event (a swing low's close breaking back above its own high) as the trigger, then rests a limit order at a 50% or 61.8% Fibonacci retracement (tested separately) of the leg that produced it, stop below the originating swing low, TP at 3R — hypothesized to reduce adverse selection vs. the anticipation cross by buying the retrace instead of the breakout itself. Stop-size caps match `breakout`'s own family config (the closest comparable), `lockBreakeven` deliberately off (fixed stop/TP structure per the pre-registered spec, not a managed exit). Fixed calendar-date split (train: earliest to 2025-06-01; holdout: 2025-06-01-present), full 28-asset watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip) (see TOURNAMENT_ROADMAP.md: FIB-PULLBACK RESULT (2026-08-14))

## VOL-CONFIRM-BREAKOUT

**Verdict:** **TRAIN-GATE-FAIL** (all three thresholds; no threshold selected, holdout never examined)

**Holdout n:** 0 (train-gate-blocked on all three thresholds; holdout not examined) — **Date:** 2026-08-14 — **Commit:** (VOL-CONFIRM-BREAKOUT commit)

**Deciding metric:** 1.5x: train avgR/trade -0.854 (gate required >-0.50), 5224 trades (gate required >=200, cleared) — avgR clause fails; 28/28 assets fired, 0/28 positive. 2.0x: train avgR/trade -0.857, 4578 trades — avgR clause fails; 28/28 assets fired, 0/28 positive. 3.0x: train avgR/trade -0.794, 3427 trades — avgR clause fails; 28/28 assets fired, 0/28 positive. All three are meaningfully WORSE than unfiltered `breakout`'s own train avgR (-0.454, this doc's Honest Baseline table) — gating on high relative volume selected for worse entries here, not better ones, and trade count stayed far above the floor at every threshold (volume filtering did not meaningfully restrict which bars triggered)

**Hypothesis:** Gates `breakout`'s own trigger on relative volume at the entry bar (entry-bar volume / mean volume of the prior 20 bars, current bar excluded from its own average), tested at three thresholds (1.5x, 2.0x, 3.0x) via `backtest.js`'s existing `entryGate` hook — no backtest.js changes. `breakout`'s exact `tournament.mjs` baseline config reused unmodified. Pre-registered process: rank the three thresholds on TRAIN avgR/trade only, then evaluate ONLY the best-on-train threshold's holdout exactly once (no threshold-selection peek at holdout). Fixed calendar-date split (train: earliest to 2025-06-01; holdout: 2025-06-01-present), full 28-asset watchlist, corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip) (see TOURNAMENT_ROADMAP.md: VOL-CONFIRM-BREAKOUT RESULT (2026-08-14))

## ATR-ADAPTIVE-STOP-CONFIRMATORY

**Verdict:** **FAIL** (0/20 cells)

**Holdout n:** 2567 (anticipate best cell) / 3148-3156 (breakout, all cells) — **Date:** 2026-08-14 — **Commit:** (ATR-ADAPTIVE-STOP-CONFIRMATORY commit)

**Deciding metric:** `anticipate` (the one arm that genuinely tests `atrStopK`): best cell k=4/p=14 holdout avgR -0.4745, 2567 trades, 0/28 positive — materially less negative than its own structural-stop baseline (-0.8842, 3966 trades) but still far short of the gate (avgR>0 AND trades>=150 AND positiveAssets/assets>=0.50), and the improvement is mechanical (wider stop = smaller position = smaller R-loss, not a real edge). `breakout`: holdout avgR -0.8640 (atrPeriod=14) / -0.8425 (atrPeriod=20), identical across every `atrStopK`, confirming the hardcoded-stop finding; both fail the gate decisively

**Hypothesis:** `backtest.js`'s `stopMode="atr"` (stop placed `atrStopK` ATRs below entry instead of the structural swing-low) — fully built, never previously run through a sealed confirmatory study. Grid: `atrStopK` in {1.5,2,2.5,3,4} x `atrPeriod` in {14,20}, applied to `breakout` and `anticipate`, full 28-asset watchlist, standard 70/30 split, corrected real cost basis (~1.7% round trip). Mid-run discovery, disclosed not absorbed: `backtest.js`'s `breakoutEntry()` hardcodes its stop at a fixed `2 x atr(atrPeriod)` and never reads `stopMode`/`atrStopK` at all — verified by exact numeric match between the plain (no-override) breakout baseline and every `atrStopK` value at a given `atrPeriod`, so the `breakout` half of this grid tests `atrPeriod` only, not the pre-registered `atrStopK` hypothesis; see TOURNAMENT_ROADMAP.md for the full disclosure and grid table

## WIDE-STOP-HIGH-TARGET-ASYMMETRY

**Verdict:** **FAIL** (0/50 cells)

**Holdout n:** 1222-2883 per cell (50 cells) — **Date:** 2026-08-14 — **Commit:** (WIDE-STOP-HIGH-TARGET-ASYMMETRY commit)

**Deciding metric:** Every cell fails decisively on both avgR (-0.91 to -1.22, gate required >-0.30) and positive-asset fraction (breakout tops out 2/28=7%, anticipate 0/27 always; gate required >=0.40); trade-count floor (>=150) cleared by a wide margin everywhere (1222-2883). Best single cell: anticipate maxStopPct=9%/tpR=6, holdout avgR -0.9066. Notable non-gating pattern: holdout avgR worsens monotonically as tpR rises within every stop width for both families (opposite the thesis's prediction), while train avgR improves with tpR for anticipate — a train/holdout divergence disclosed but not gate-relevant since no cell is close to passing

**Hypothesis:** Trend-following "cut losses short, let profits run" shape (few large winners funding many small losers) — never directly tested despite sounding adjacent to T1B-BREAKOUT-COSTFIX (single `tpR` value, breakeven still active) and TRAIL-STOP-EXIT (different exit mechanism, breakeven still active). Grid: `maxStopPct` in {6%,7%,8%,9%,10%} x `tpR` in {6,8,10,15,20}, `lockBreakeven:false`, applied to `breakout` and `anticipate`, full 28-asset watchlist, standard 70/30 split, real cost basis. Pre-registered MAX_HOLD-censoring check (task's own prerequisite): default `maxHold=100` censored 9-21% of trades across the grid; extended to `maxHold=4320` (180 days, smallest value clearing censoring at every sampled cell) for the full grid — extending did NOT rescue the thesis, it made avgR MORE negative at every sampled cell (removing censoring ambiguity revealed a worse picture, not a better one hidden by premature timeouts); see TOURNAMENT_ROADMAP.md for the full before/after exits breakdown and 50-cell grid table

## FUNDING-CARRY-DECAY-CHECK

**Verdict:** **research-only, does not clear a live-eligibility bar even setting the access constraint aside** — not a candidate awaiting short-position infrastructure

**Holdout n:** 9,187 hourly intervals (recent-period pooled portfolio), 28/29 symbols (EOS excluded, 1 hourly point in-window, below the 20-day coverage floor) — **Date:** 2026-08-14 — **Commit:** (FUNDING-CARRY-DECAY-CHECK commit)

**Deciding metric:** Reproduction period (2020-2025, the paper's own sample): **unavailable** — Kraken's `historical-funding-rates` endpoint is a hard rolling ~365-day window (PWR5's 2026-08-13 finding, re-confirmed here from the demand side: every symbol returns 0 points before 2025-08-13), no direct sanity-check reproduction is possible with this project's real data access. Recent period (2025-08-13 to 2026-08-14, matching/extending the paper's 2025 cutoff): pooled portfolio annualized return **-3.26%** (annualized vol 0.26%, naive Sharpe -12.5 — Sharpe likely overstated in magnitude, hourly funding is strongly serially correlated, sqrt-time annualization understates true vol; the return figure is the reliable one). Within-window half-split shows the negative result worsening, not stabilizing: first half (Aug 2025-Feb 2026) -1.28%/yr, second half (Feb 2026-Aug 2026) **-5.85%/yr**. Only 8/28 assets (BTC, ETH, DOGE, LINK, SUI, TIA, XMR, XRP) show a positive annualized carry return over the full window; 20/28 negative. Basis convergence at entry/exit not separately modeled (funding-accrual-only return), disclosed as a known simplification, not absorbed silently

**Hypothesis:** Delta-neutral funding carry (short perp + long spot, harvest the funding-payment accrual itself) — a genuinely different mechanism from H11/CLASSIFIER-FUNDING-FEATURE (both use funding as a directional signal on the spot leg only). Tests whether the source paper's (Schmeling/Schrimpf/Todorov 2023, SSRN 4268371; reproduced Borri/Liu/Tsyvinski/Wu arXiv 2510.14435 §3.6) documented 2024-2025 Sharpe decay (6.45 full-sample -> 4.06 in 2024 -> negative in 2025) has continued, stabilized, or reversed on this project's own data. `carrystudy.mjs` (new module, reuses `derivatives.mjs`'s `fetchFundingRates`), 28/29 watchlist symbols, equal-weighted pooled hourly portfolio. **Hard constraint, pre-registered and unaffected by the result: this Kraken account has no short-position/margin access, so this is research-only regardless of sign**

## MOMENTUM-SHORT-HORIZON-RECHECK

**Verdict:** KILLED (both lookbacks)

**Holdout n:** L=7: 76 dates/899 rows; L=14: 36 dates/433 rows (whole-symbol) — **Date:** 2026-08-14 — **Commit:** (MOMENTUM-SHORT-HORIZON-RECHECK commit)

**Deciding metric:** L=7 train residual IC=-0.0218, p=0.6024 (wrong sign, not significant). L=14 train residual IC=+0.0573, p=0.4266 (correct sign, fails p<0.05 gate). Neither clears train significance; whole-symbol holdout not gate-relevant for either (L=7 IC=0.0039 p=0.9341; L=14 IC=0.0660 p=0.3237, reported for due-diligence only)

**Hypothesis:** New pre-registered short-lookback (L=7d primary, L=14d secondary) cross-sectional momentum primary, `transform=btcResidual90`, motivated by external evidence that crypto momentum is real at 1-4wk horizons with reversal beyond one month — M7's 30d primary sat at/past that edge. Distinct from the old L=[14,30,60,90] exploratory grid (already declined, BH-FDR-corrected to nothing) and from B5-REVERSAL (L=3d/5d, raw transform, negative expected sign)

## SCALED-EXIT-LADDER-CONFIRMATORY

**Verdict:** **FAIL** (0/36 cells)

**Holdout n:** 3156-4693 per cell (36 cells) — **Date:** 2026-08-14 — **Commit:** (SCALED-EXIT-LADDER-CONFIRMATORY commit)

**Deciding metric:** Every cell stays within a narrow band (-0.855 to -0.898) around its own family's fixed-TP baseline. `breakout` fixed-TP baseline: holdout avgR -0.8640, 3156 trades, 0/28 positive (exact match to all 6 degenerate `partialAtR=3` cells). Best genuine `breakout` cell (atR=2/frac=0.67/trail=1): -0.8558, 3208 trades — +0.0082R over baseline, immaterial. `anticipate` fixed-TP baseline: holdout avgR -0.8842, 3966 trades, 0/27 positive. Best cell overall (atR=1/frac=0.33/trail=1): -0.8547, 4693 trades — +0.0295R over baseline, still nowhere near the gate's avgR>0 requirement. 0/28 holdout assets ever net-positive at any grid cell for either family

**Hypothesis:** `backtest.js`'s `partialAtR`/`partialFrac` (bank a fraction at an early R-multiple) combined with `trailR`/`trailStartR` (trail a stop below the running peak once price has run far enough) — a genuinely different exit STRUCTURE from anything verdicted: bank real profit early, then let the remainder run with a trailing stop instead of a fixed target. Distinct from the single-fixed-TP baseline, WIDE-STOP-HIGH-TARGET-ASYMMETRY (all-or-nothing extreme target, no partial), and TRAIL-STOP-EXIT (`trailingTpPct`, no partial banking, already FAIL). Fully built but grep-confirmed to appear only in `commands.js`'s informal `!exits` Discord diagnostic, never run as a sealed confirmatory study. Grid: `partialAtR` in {1,2,3} x `partialFrac` in {0.33,0.5,0.67} x `trailR` in {1,2}, `trailStartR=partialAtR`, applied to `breakout` and `anticipate`, full 28-asset watchlist, standard 70/30 split, corrected real cost basis. One small `backtest.js` addition beyond "zero new code": two accumulators (`partialR`/`runnerR`) in `backtestMultiTF`'s existing `closeLeg`, needed to satisfy this item's own done_when (realized-vs-unrealized split); 26/26 pre-existing backtest tests stayed green. Two mid-run discoveries disclosed rather than absorbed: (1) `breakout`'s `partialAtR=3` cells are degenerate — identical to the plain fixed-TP baseline, because `breakout`'s own `tpR=3` and the fixed-TP check fires before the partial check in the same candle when the two prices coincide; (2) `partialR+runnerR` under-reconciles `totalR` for `anticipate` by ~12-14% (exact for `breakout`) because `anticipate`'s same-candle instant-stop fast path bypasses the shared `closeLeg` helper entirely — these trades are always full-size losses, never partial-eligible by construction, and this does not change any reported avgR/trades/gate number, only the split's coverage; see TOURNAMENT_ROADMAP.md for both disclosures in full

## T4-PORTFOLIO-MOMENTUM-PHASE4

**Verdict:** **FAIL** — on the Sharpe clause specifically, both scenarios

**Holdout n:** 392 rebalance days, 2025-07-03 to 2026-07-30 (28-asset full watchlist) — **Date:** 2026-08-15 — **Commit:** (T4-PORTFOLIO-MOMENTUM-PHASE4 commit)

**Deciding metric:** Primary (futures taker, N=5): totalReturn +30.8% (gate: >0, PASS), Sharpe 0.483 (gate: >=0.5, FAIL — narrowly), maxDrawdown -33.1% (gate: >-35%, PASS), no sign flip across N=4/5/6 (literal-wording PASS, but N=4 Sharpe collapses to 0.039 and N=6 to 0.233 — a 52-92% magnitude swing on a 1-position change, disclosed as a fragility red flag beyond the literal sign-flip check). Maker scenario (N=5): Sharpe 0.493 — reproduces PHASE2's originally-flagged number exactly, still short of 0.5. 3 of 4 required clauses pass; the gate requires all four

**Hypothesis:** `momentum_30d`/30d-rebalance (PHASE2's flagged near-miss, "closest of the four" cost-reduction candidates) run through a real shared-capital equity-curve simulation (`portfolio.mjs`'s `simulatePortfolio`, same engine B5-REVERSAL-PHASE4-PORTFOLIO-SIM used), full 28-asset watchlist, standard 70/30 time split (T4's own convention, not B5-REVERSAL's symbol-holdout). Two cost scenarios reported: futures taker (0.10% round trip, primary — chosen over PHASE2's flagged futures-maker scenario for the same execution-realism reason B5-REVERSAL-PHASE3 rejected maker for a scheduled-rebalance strategy) and futures maker fee-only (0.04%, PHASE2's original optimistic flag, reported secondarily). Required +/-20% parameter-perturbation check via N=4/5/6 (momentum_30d's own hardcoded topN=5), local replica verified bit-for-bit against the real code before trusting the N=4/6 variants (see TOURNAMENT_ROADMAP.md: 2026-08-15 — T4-PORTFOLIO-MOMENTUM-PHASE4: closing the explicitly-flagged PHASE4 gap)

## OPEN-INTEREST-TREND-CONFIRMATION

**Verdict:** **FAIL** (both families)

**Holdout n:** 1252 (breakout) / 1462 (anticipate) — **Date:** 2026-08-15 — **Commit:** (OPEN-INTEREST-TREND-CONFIRMATION commit)

**Deciding metric:** breakout: holdout avgR -0.975 (gate required >-0.30), 1252 trades (>=150, cleared), 1/28 assets positive (gate required >=40%), train avgR -0.763 (3034 trades) — same sign, decisive. anticipate: holdout avgR -0.895 (gate required >-0.30), 1462 trades (>=150, cleared), 0/27 assets positive, train avgR -0.801 (3985 trades) — same sign, decisive

**Hypothesis:** Gates `breakout` and `anticipate` entries on Kraken Futures open-interest (OI) trend (`oi-trend-gate.mjs`, new module, reuses `derivatives.mjs`'s existing, tested `fetchAnalytics(type:'open-interest')` — real, tested Kraken Futures infra built during PWR5-era work but never wired into a sealed-holdout study before this, only exercised via `research.js`'s `derivatives` CLI diagnostic). Genuinely new information source: every prior gate/filter tested in this project (T3-REGIMEFILTER, TREND-GATE-MA/STRUCTURE, VOL-CONFIRM-BREAKOUT, ATR-ADAPTIVE-STOP, H11, FUNDING-MEANREV) used price structure or funding rate; this uses futures positioning depth. Data-availability gate run first, real API calls, before any backtest: unlike H11/FUNDING-MEANREV (funding data capped at ~365-730 rolling days), Kraken Futures OI history reaches back to 2024-02-28 for every symbol checked (694-899 days) — 28/29 watchlist assets clear the 500-day coverage floor (EOS excluded on pre-existing candle-history shortfall, the same recurring exclusion as FUNDING-CARRY-DECAY-CHECK, not an OI problem). Gate mechanism: entry-bar OI (daily close level) vs its own trailing 7-day average, current point excluded from its own average (no self-inclusion bias), each daily point revealed only after its own day closes (no lookahead) — a single pre-registered N=7 choice, not a threshold grid, since the task specifies one mechanism not a sweep. `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`'s `families` table; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip, already `strategy.js`'s default). This item's own pre-registered `done_when` specifies exactly three holdout-only gate clauses, no separate train-side pre-gate (unlike FUNDING-MEANREV/FIB-PULLBACK/VOL-CONFIRM-BREAKOUT's train-gate-first convention) — train scores are still computed and reported for the same-sign disclosure every other row here includes (see TOURNAMENT_ROADMAP.md: 2026-08-15 — OPEN-INTEREST-TREND-CONFIRMATION: futures OI trend as an entry gate)

## LIQUIDATION-CASCADE-REVERSAL

**Verdict:** **FAIL**

**Holdout n:** 221 — **Date:** 2026-08-15 — **Commit:** (LIQUIDATION-CASCADE-REVERSAL commit)

**Deciding metric:** Best-on-train multiplier: 5x (train avgR -0.982, 629 trades, 0/28 assets positive — all three candidates decisively negative on train: 2x -1.032/1200 trades, 3x -1.006/911 trades, 5x -0.982/629 trades, all 0/28 positive, so multiplier selection was a matter of "least bad," not a genuine signal). Holdout at 5x: avgR -0.895 (gate required >-0.30), 221 trades (>=100, cleared comfortably — not a sample-size non-verdict), 4/27 assets positive (~15%, reported for disclosure, not part of this item's stated gate)

**Hypothesis:** Gates `sweep_reclaim` (liquidity-sweep-then-reclaim, the codebase's own existing contrarian-reversal family) on a genuine Kraken Futures liquidation-volume spike at the entry bar (`liquidation-cascade-reversal.mjs`, new module, reuses `derivatives.mjs`'s existing, tested `fetchAnalytics(type:'liquidation-volume')` — real Kraken Futures infra built during PWR5-era work, never wired into a sealed-holdout study before this, only exercised via `research.js`'s `derivatives` CLI diagnostic point-count). Hypothesis: a liquidation-volume spike is forced (involuntary) selling/buying rather than voluntary price action, so a reversal confirmed by genuine forced-flow exhaustion should hold better than an unconfirmed sweep/reclaim — genuinely different mechanism from OPEN-INTEREST-TREND-CONFIRMATION (a rising/falling OI *trend* gate on *trend-following* families): this is a single-bar *spike* gate on a *reversal* family, and not a re-skin of B5-REVERSAL (cross-sectional return ranking, not event-triggered). `sweep_reclaim`'s own plain baseline already FAILED independently (see RANGE-SWEEP-RECLAIM-adjacent finding, TOURNAMENT_ROADMAP.md), so this asks whether confirmed forced-liquidation origin rescues it — same "does a new information source rescue an already-failed price-action pattern" shape as OI-trend-gate/FUNDING-MEANREV. Data-availability confirmed directly against the real API before writing the module: liquidation-volume history reaches back to 2024-02-28 for PF_XBTUSD (899 days, same depth as OI, same underlying endpoint), heavily right-skewed (p50~8.5, p90~76, p99~313, max~686 over that window) — 28/29 watchlist assets clear the 500-day coverage floor (EOS excluded on the same pre-existing candle-history shortfall as every other derivatives study). Spike mechanism: current day's liquidation volume > multiplier x its own trailing 7-day average (N=7, same window as OI-trend-gate), current point excluded from its own average, revealed only +1 day after the day closes (no lookahead). Threshold selection: 3 candidate multipliers (2x/3x/5x) scored on TRAIN ONLY; only the best-on-train multiplier's holdout is ever computed, evaluated exactly once — same discipline TEST2-VOL-CONFIRMED-BREAKOUT already used. `sweep_reclaim` baseline config reused unmodified from `tournament.mjs`'s `families` table; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). This item's own pre-registered `done_when` specifies exactly two holdout gate clauses (avgR + trade count only, no positiveAssets clause — explicitly lower trade floor of 100 vs. the usual 150, since this intersects two selective conditions, spike AND sweep_reclaim, and is expected to produce fewer trades) (see TOURNAMENT_ROADMAP.md: 2026-08-15 — LIQUIDATION-CASCADE-REVERSAL: forced-liquidation spike as a reversal-entry gate)

## FUTURES-BASIS-DIRECTIONAL-SIGNAL

**Verdict:** **FAIL** (both families)

**Holdout n:** 1229 (breakout) / 1491 (anticipate) — **Date:** 2026-08-15 — **Commit:** (FUTURES-BASIS-DIRECTIONAL-SIGNAL commit)

**Deciding metric:** breakout: holdout avgR -0.994 (gate required >-0.30), 1229 trades (>=150, cleared), 0/27 assets positive (gate required >=40%), train avgR -0.777 (3059 trades) — same sign, decisive. anticipate: holdout avgR -0.938 (gate required >-0.30), 1491 trades (>=150, cleared), 0/27 assets positive, train avgR -0.793 (3989 trades) — same sign, decisive

**Hypothesis:** Gates `breakout` and `anticipate` entries on the Kraken Futures basis level (futures-vs-spot price differential, i.e. contango/backwardation steepness) as a DIRECTIONAL signal (`basis-directional-signal.mjs`, new module, reuses `derivatives.mjs`'s existing, tested `fetchAnalytics(type:'future-basis')`, never wired into a sealed-holdout study before this). Distinct from FUNDING-CARRY-DECAY-CHECK (delta-neutral carry-HARVESTING off the periodic funding payment, a mechanically different metric) and from OPEN-INTEREST-TREND-CONFIRMATION (same gate shape and same two families, but a different information source — basis, not OI). Primary hypothesis pre-registered in writing before any train/holdout result was examined: of two competing hypotheses (widening contango = bullish momentum confirmation vs. widening contango = crowded-long contrarian-fade signal), this item tests the momentum/confirmation hypothesis, mirroring OPEN-INTEREST-TREND-CONFIRMATION's own "current > trailing average" gate shape on the same two families; the contrarian-fade hypothesis is explicitly out of scope for this result. Data-availability gate run first, real API calls: future-basis history reaches back to 2024-02-28 for PF_XBTUSD and PF_ETHUSD (899 days, same depth as OI/liquidation-volume, same underlying endpoint) — 28/29 watchlist assets clear the 500-day floor (EOS excluded on the same pre-existing candle-history shortfall as every other derivatives study). Kraken's future-basis value is `{basis:"<decimal>"}`, a distinct shape from OI's OHLC array and liquidation-volume's scalar. Gate mechanism: entry-bar basis vs its own trailing 7-day average (N=7, matching OI-trend-gate's window), current point excluded from its own average, no lookahead (+1 day reveal) — a single pre-registered choice, not a threshold grid. `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). This item's own pre-registered `done_when` specifies the same three holdout-only gate clauses as OPEN-INTEREST-TREND-CONFIRMATION (see TOURNAMENT_ROADMAP.md: 2026-08-15 — FUTURES-BASIS-DIRECTIONAL-SIGNAL: futures basis level as a directional momentum gate)

## LONG-SHORT-RATIO-CONTRARIAN

**Verdict:** **FAIL** (both families)

**Holdout n:** 1973 (breakout) / 2512 (anticipate) — **Date:** 2026-08-15 — **Commit:** (LONG-SHORT-RATIO-CONTRARIAN commit)

**Deciding metric:** breakout: holdout avgR -0.970 (gate required >-0.30), 1973 trades (>=150, cleared), 0/28 assets positive (gate required >=40%), train avgR -0.776 (4627 trades) — same sign, decisive. anticipate: holdout avgR -0.934 (gate required >-0.30), 2512 trades (>=150, cleared), 0/27 assets positive, train avgR -0.777 (6480 trades) — same sign, decisive. Crowd positioning, tested as a contrarian-fade suppression gate on momentum entries, does not rescue `breakout`/`anticipate` any more than the momentum-shaped OI/basis gates did

**Hypothesis:** Gates `breakout` and `anticipate` entries on Kraken Futures crowd positioning — the aggregate long/short ratio across the futures trader base (`long-short-ratio-contrarian.mjs`, new module, reuses `derivatives.mjs`'s existing, tested `fetchAnalytics(type:'long-short-ratio')`, never wired into a sealed-holdout study before this). Genuinely new information source, distinct in KIND from every prior derivatives study: OPEN-INTEREST-TREND-CONFIRMATION and FUTURES-BASIS-DIRECTIONAL-SIGNAL both measure size/pricing of the futures market (contract count, futures-vs-spot price); LIQUIDATION-CASCADE-REVERSAL measures forced-flow events; this measures the crowd's own directional lean (fraction of open positions that are long) — a sentiment/positioning signal, not a size or pricing one. Pre-registered hypothesis is the task's own stated framing, a contrarian FADE (not the momentum/confirmation shape every prior gate study here used): when the crowd is already heavily positioned long (an extreme reading, not "long" in general), forward returns on a fresh long entry tend to be worse, so the gate SUPPRESSES entries while the ratio sits in its own train-fixed extreme-long zone. Granularity check (this item's own explicit done_when requirement, since the task's framing raised aggregate-only as a real possibility) run first against the real API: `fetchAnalytics` returns a genuinely distinct daily series per futures contract (PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD each independently 0.60/0.77/0.81/0.76 on the same day), not a shared market-wide constant — scoped PER-ASSET as a result, not the aggregate-only fallback. Data-availability: `long-short-ratio` history reaches back to 2024-02-28 for all four checked symbols (899 days, same depth/endpoint family as every other derivatives source here) — 28/29 watchlist assets clear the 500-day floor (EOS excluded on the same pre-existing candle-history shortfall as every other derivatives study). Kraken's `long-short-ratio` value is a plain decimal string, already the long-side fraction of open positions (cross-checked against the sibling `long-short-info` type's `ratio` field, which equals `longPercent/100` exactly on the same symbol/day) — a distinct shape from OI's OHLC array, liquidation-volume's scalar count, and basis's `{basis}` object. Extreme-long threshold: 80th percentile of the asset's OWN long-short ratio values within the TRAIN window only (fixed on train, never recomputed on holdout), a single pre-registered choice not a threshold grid — matching OI-trend-gate's/basis-directional-signal's own "one clean choice" convention. `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). This item's own pre-registered `done_when` specifies the standard three-clause holdout-only gate (since the granularity check confirmed real per-asset resolution, no separate aggregate/portfolio-level fallback gate was needed) (see TOURNAMENT_ROADMAP.md: 2026-08-15 — LONG-SHORT-RATIO-CONTRARIAN: crowd long/short positioning as a contrarian-fade gate)

## TOP-TRADERS-DIVERGENCE

**Verdict:** **FAIL** (both families)

**Holdout n:** 1145 (breakout) / 1470 (anticipate) — **Date:** 2026-08-15 — **Commit:** (TOP-TRADERS-DIVERGENCE commit)

**Deciding metric:** breakout: holdout avgR -0.961 (gate required >-0.30), 1145 trades (>=150, cleared), 1/27 assets positive (gate required >=40%), train avgR -0.737 (1333 trades) — same sign, decisive. anticipate: holdout avgR -0.982 (gate required >-0.30), 1470 trades (>=150, cleared), 0/27 assets positive, train avgR -0.806 (1940 trades) — same sign, decisive. Requiring top-traders to diverge more bullish than the aggregate crowd, as a confirmation gate on momentum entries, does not rescue `breakout`/`anticipate` any more than any other derivatives-based gate tested in this project

**Hypothesis:** Gates `breakout` and `anticipate` entries on the DIVERGENCE between Kraken Futures' top-traders cohort positioning and the broader aggregate long-short-ratio (`top-traders-divergence.mjs`, new module, reuses `derivatives.mjs`'s `fetchAnalytics(type:'top-traders')` for the first time in a sealed-holdout study, alongside `type:'long-short-ratio'` already used by LONG-SHORT-RATIO-CONTRARIAN). Distinct from LONG-SHORT-RATIO-CONTRARIAN, which tested the aggregate ratio alone against ITS OWN history as a contrarian fade — this tests whether informed/uninformed money DISAGREEING is itself predictive, a different axis, evaluated independently per this item's own instruction not to let LONG-SHORT-RATIO-CONTRARIAN's result color it. Endpoint definition verified against Kraken's real public docs before any strategy code was written (this item's own explicit done_when requirement — "verify its actual definition... don't infer from the name alone"): `top-traders` is the top 20% of accounts BY OPEN INTEREST (position size), not a curated "smart money" cohort by any performance/sophistication measure — the hypothesis's "larger" framing holds, "more sophisticated" does not and is not assumed. REAL BUG found and fixed as part of this item's own data-availability check: `derivatives.mjs`'s `normalizeAnalytics` did not handle Kraken's real `top-traders` response shape at all — it nests its parallel-array object one level deeper (`{top20Percent:{...}}`) than every other analytics type used in this project (all flat), and the un-fixed function silently produced `{}` for every point with no error, not even an empty result — the length calculation still ran to `timestamp.length`. Fixed generically (unwraps any single-key object wrapper, not hardcoded to the string `top20Percent`) with a dedicated regression test in `derivatives.test.mjs`, confirmed against the real API before use here. Divergence = `topTradersRatio - aggregateRatio` on the same day (both already the long-side fraction of open positions/accounts, directly comparable, no conversion) — real and non-degenerate on the checked window (PF_XBTUSD: top traders 0.49-0.55 vs aggregate 0.54-0.60 on the same 10 days, a moving spread not a constant offset). Data-availability: both series reach back to 2024-01-09 for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD (950-day window fully covered, deeper than every prior derivatives study's checked depth), with IDENTICAL daily timestamps on both series (no alignment gaps) — 28/29 watchlist assets clear the 500-day floor (EOS excluded on the same pre-existing candle-history shortfall as every other derivatives study). Pre-registered hypothesis (this item's own stated framing — "the top-trader side is more predictive" when the two disagree): for a long-only strategy, requiring top-traders to lean MORE bullish than the aggregate crowd is a CONFIRMATION gate (require positive divergence to allow entry), the same shape OPEN-INTEREST-TREND-CONFIRMATION/FUTURES-BASIS-DIRECTIONAL-SIGNAL used, functionally the opposite of LONG-SHORT-RATIO-CONTRARIAN's suppression-on-own-extreme shape. Confirmation threshold: 80th percentile of the asset's OWN divergence values within the TRAIN window only (fixed on train, never recomputed on holdout), the same "one clean choice, not a threshold grid" convention every prior gate study here has used. `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). This item's own pre-registered `done_when` specifies the standard three-clause holdout-only gate (see TOURNAMENT_ROADMAP.md: 2026-08-15 — TOP-TRADERS-DIVERGENCE: informed-vs-crowd positioning divergence as a confirmation gate)

## ORDER-FLOW-AGGRESSOR-IMBALANCE

**Verdict:** **FAIL** (both families)

**Holdout n:** 751 (breakout) / 822 (anticipate) — **Date:** 2026-08-18 — **Commit:** (ORDER-FLOW-AGGRESSOR-IMBALANCE commit)

**Deciding metric:** breakout: `periodic` selected on train (avgR -0.790, 1471 trades, 0/28 positive vs `cumulative`'s -0.819, 999 trades, 1/28 positive — periodic won by a small margin, both decisively negative). Holdout: avgR -0.896 (gate required >-0.30), 751 trades (>=150, cleared comfortably — 5x the floor), 2/28 assets positive (gate required >=40%) — same sign as train, decisive. anticipate: `periodic` selected on train (avgR -0.818, 1725 trades, 0/28 positive vs `cumulative`'s -0.851, 1157 trades, 0/28 positive). Holdout: avgR -0.964 (gate required >-0.30), 822 trades (>=150, cleared — 5.5x the floor), 1/27 assets positive — same sign as train, decisive. Genuine aggressor-side trade-flow direction, unlike raw volume magnitude (VOL-CONFIRM-BREAKOUT), still does not rescue `breakout`/`anticipate` — both formulations of the same underlying signal fail in the same direction and magnitude as every other derivatives-based gate tested in this project

**Hypothesis:** Gates `breakout` and `anticipate` entries on Kraken Futures aggressor-side trade-flow DIRECTION (`order-flow-aggressor-imbalance.mjs`, new module, reuses `derivatives.mjs`'s `cvd` and `aggressor-differential` analytics types for the first time in a sealed-holdout study). Distinct from the already-FAILED VOL-CONFIRM-BREAKOUT, which gated on raw spot-candle VOLUME MAGNITUDE (no directional information, made results worse) — this measures aggressive buy volume vs aggressive sell volume, real order-flow information unavailable from OHLCV candles alone. Per this item's own instruction, `cvd` and `aggressor-differential` are treated as ONE information source (two computations of the same aggressor-imbalance concept), not two independent hypotheses. Endpoint shapes verified against a live API probe, not documentation (both docs.kraken.com analytics pages 404'd as of this check): `cvd`'s `result.data = {buy_volume, sell_volume, cvd}` — `buy_volume`/`sell_volume` are query-window-INDEPENDENT (confirmed identical across two fetches with different `since`), but the `cvd` sub-field itself is NOT — it is a running sum that resets to zero baseline at the query's own `since` (confirmed: the same day's value differed materially, `583.84` vs `11.47`, between a 5-day and a 10-day fetch window). This module deliberately does NOT use Kraken's raw `cvd` field for that reason — it self-computes a running sum from the verified window-independent `buy_volume - sell_volume` instead, more robust than relying on undocumented API reset behavior. `aggressor-differential`'s raw value is confirmed query-window-INDEPENDENT and its sign convention was read directly off real numbers, not assumed from the field name (generic descriptions suggested buy-positive; the real data says the opposite): `aggressor-differential[i] == -(buy_volume[i] - sell_volume[i])`, i.e. Kraken's raw value is POSITIVE when SELL-side aggression dominates — negated on read to a consistent buy-positive `netBuyPressure` convention. Two formulations tested per the task's own "cumulative running total vs periodic differential" framing: `periodic` (aggressor-differential's own per-period value, gated at/above its own TRAIN-fixed 80th percentile — same confirmation shape TOP-TRADERS-DIVERGENCE/LONG-SHORT-RATIO-CONTRARIAN use) and `cumulative` (the self-computed running sum, gated above its own N=7-bar trailing average — same trend shape OI-TREND-GATE's `makeOiRisingAt` uses). Both formulations scored on TRAIN ONLY per family; only the best-on-train formulation's holdout is ever computed, evaluated exactly once — same selection discipline LIQUIDATION-CASCADE-REVERSAL used across its own three candidate multipliers. Data-availability: both types reach back to 2024-02-28 for PF_XBTUSD/PF_ETHUSD/PF_SOLUSD/PF_XRPUSD (same start date/endpoint family as OPEN-INTEREST-TREND-CONFIRMATION's and LIQUIDATION-CASCADE-REVERSAL's checks), single page for the full 900-day window (no pagination observed) — 28/29 watchlist assets clear the 500-day floor (EOS excluded on the same pre-existing candle-history shortfall as every other derivatives study). `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip). This item's own pre-registered `done_when` specifies the standard three-clause holdout-only gate (see TOURNAMENT_ROADMAP.md: 2026-08-18 — ORDER-FLOW-AGGRESSOR-IMBALANCE: aggressor-side trade-flow direction as an entry gate)

## ROLLING-VOLATILITY-REGIME-TIMING

**Verdict:** **FAIL** (all four family/direction combinations)

**Holdout n:** 967-1587 per combination (4 combinations) — **Date:** 2026-08-18 — **Commit:** (ROLLING-VOLATILITY-REGIME-TIMING commit)

**Deciding metric:** breakout/expanding: holdout avgR -0.970 (gate required >-0.30), 967 trades (>=150, cleared — 6.4x the floor), 0/28 positive; train avgR -0.807 (2813 trades), same sign. breakout/contracting: holdout avgR -0.978, 1300 trades (8.7x the floor), 0/27 positive; train avgR -0.774 (2878 trades), same sign. anticipate/expanding: holdout avgR -1.037, 1587 trades (10.6x the floor), 0/27 positive; train avgR -0.757 (4511 trades), same sign. anticipate/contracting: holdout avgR -0.815, 1238 trades (8.3x the floor), 1/27 positive; train avgR -0.817 (3449 trades), same sign. All four combinations decisive — no train/holdout divergence, no sample-size ambiguity, positive-asset fraction nowhere near the 0.40 floor in any cell

**Hypothesis:** Gates `breakout` and `anticipate` entries on Kraken Futures realized-volatility REGIME (`rolling-volatility-regime-timing.mjs`, new module, reuses `derivatives.mjs`'s `rolling-volatility` analytics type for the first time in a sealed-holdout study). Distinct from ATR-ADAPTIVE-STOP-CONFIRMATORY (already FAIL — sized the STOP DISTANCE by a candle-derived ATR proxy) and T2-VOLCONTRACTION (already FAIL — an ATR-compression ENTRY TRIGGER, also candle-derived): this is a FILTER on entry timing using Kraken's own realized-vol feed, not a stop-sizing or trigger mechanism. Endpoint shape verified against a live API probe (docs.kraken.com 404'd, as on every prior check): `result.data=[...]` flat numeric-string percentages, confirmed query-window-INDEPENDENT (identical value for the same timestamp across a 5-day vs 10-day fetch) — unlike `cvd`'s raw field, so the raw field is used directly with no self-computation workaround. Data-availability: reaches back to 2024-03-01 for all four sampled symbols (901 points, single page, no pagination) — 28/29 watchlist assets clear the 500-day floor (EOS excluded on its pre-existing candle-history shortfall). TWO DIRECTIONS pre-registered TOGETHER per this item's own task wording ("test both directions... not picked from train results") — unlike every prior gate study here, there is NO best-on-train selection step: `expanding` (current vol above its own N=7-day trailing average) and `contracting` (current below) each get an independent train AND holdout evaluation, mutually exclusive by construction (confirmed in the module's own tests: a monotonic rising series produces expanding-dominant trades, a flat series produces zero trades on both directions simultaneously). N=7 reused unmodified from OI-TREND-GATE's/ORDER-FLOW-AGGRESSOR-IMBALANCE's own trailing-average convention, one disclosed choice not a sweep. `breakout`/`anticipate` baseline configs reused unmodified from `tournament.mjs`; corrected real cost basis (FEE_RATE=0.008/side, SLIPPAGE_PCT=0.0005/side, ~1.7% round trip) (see TOURNAMENT_ROADMAP.md: 2026-08-18 — ROLLING-VOLATILITY-REGIME-TIMING: realized-volatility regime as an entry-timing filter)

## PAIRS-COINTEGRATION-STATARB

**Verdict:** **NO-COINTEGRATED-PAIRS** (screen-gate fails; holdout economic gate never evaluated)

**Holdout n:** 0 (screen-gate blocked; holdout not examined for any pair) — **Date:** 2026-08-19 — **Commit:** (PAIRS-COINTEGRATION-STATARB commit)

**Deciding metric:** 0/105 tested pairs survive BH-FDR q=0.05. Lowest three raw p-values (all p=0.0050, tau approx -3.8 to -4.3, plausible half-lives 7-21 days — the KIND of number a real cointegrated pair would produce): APT/FIL, DOT/FIL, FIL/POL — but each corrects to q=0.1741, more than 3x past the 0.05 threshold once weighed against all 105 simultaneous looks. No pair anywhere in the tested set survives correction

**Hypothesis:** Market-neutral pairs/statistical-arbitrage (`pairs-cointegration.mjs`, new module): tests whether any pair of assets in the ACTIVE watchlist (SEALED_SYMBOLS excluded per `researchlib.mjs`'s own reservation for the one-time final validation) is COINTEGRATED — a stationary linear combination (spread) whose deviations mean-revert — via a two-step Engle-Granger test (OLS regression of one leg's log price on the other's, then an ADF-style regression on the residual spread testing for a unit root). Genuinely different MECHANISM CLASS from every prior study in this project: nothing here predicts a single asset's OWN future direction from its OWN history — it tests only whether a cross-asset RELATIONSHIP reverts, and trades the spread market-neutral (long one leg, short the other). VERDICTS.md previously called grid.mjs (already FAIL, see GRID-SIM above) "the one market-neutral mechanism tested to date"; this is the second, and a structurally different one (relationship-reversion, not price-oscillation-within-a-band). No published/hardcoded asymptotic critical-value table exists anywhere in this codebase for the Engle-Granger test (MacKinnon's response-surface tables were not available to verify against with confidence), so per this project's own research-honesty discipline (never state fabricated precision) significance was established instead via this project's own standing convention — a block-permutation null (same technique as `classifier.mjs`'s `scoreSealedSplit`/`momentum.mjs`'s permutation scoring): B's own log-return series is block-shuffled (blockSize=20, preserving each block's own short-range autocorrelation) and re-cumulated, A held fixed, K=200 draws, `p=(exceedances+1)/(K+1)`. MULTIPLE-COMPARISONS CORRECTION PRE-REGISTERED BEFORE ANY PAIR WAS SCREENED (this item's own explicit done_when requirement): BH-FDR at q=0.05 (`momentum.mjs`'s own `bhFdr`, this project's standing convention) applied across every pair that actually cleared the >=500-day OVERLAP-history gate — not the task's stale nominal count. The task's own framing assumed a 28-asset universe (378=C(28,2) nominal pairs); the real watchlist has grown to 29 (24 active after the 5-symbol seal, 276=C(24,2) nominal active pairs); of those, only 105 pairs actually had >=500 days of genuinely overlapping daily history on BOTH legs (9/24 active symbols — ALGO/BCH/ETC/TRX/XLM/XMR/XTZ, plus EOS's own long-standing pre-existing shortfall — fall short of the per-symbol 500-day floor individually, at 160-434 days) — correction applied to the real 105, both counts reported rather than only the flattering one. CALENDAR-HOLDOUT DISCLOSURE (AGENT_PROTOCOL.md's binding rule, added same-day by MULTIPLE-COMPARISONS-AUDIT): no candle data collected after 2026-08-19 exists yet, so this holdout necessarily re-examines already-spent history — disclosed rather than implied fresh. HARD CONSTRAINT, pre-registered and unaffected by the result (unchanged from FUNDING-CARRY-DECAY-CHECK's own finding): this Kraken account has no short/margin access, so any surviving pair would be research-only on this venue regardless of outcome — did not end up mattering here since nothing survived to a tradability question. Pre-registered z-score bands (entryZ=2.0, exitZ=0.5, one fixed conventional choice, not a swept grid) and the holdout economic gate (avgNetR>0 AND trades>=10, cost charged on BOTH legs per the task's own explicit requirement, ~1.7% round trip x2) were both specified in code before running, but never reached — the internal screen is the gate that decided this study, exactly like FUNDING-MEANREV/FIB-PULLBACK's train-gate-first pattern, just one level earlier (screen-gate, not train-gate)

## CROSS-SECTIONAL-NONPRICE-RANK

**Verdict:** **KILLED (train-significance stage)**

**Holdout n:** 4 rebalance dates examined once (holdout meanIC=+0.0022, p=1; holdout top-5 net return -0.034, negative but non-decisive) — **Date:** 2026-08-19 — **Commit:** (CROSS-SECTIONAL-NONPRICE-RANK commit)

**Deciding metric:** Train meanIC=-0.0395, p=0.1249 (fails p<0.05 naive; q=0.2498 after family BH-FDR) — wrong sign vs pre-registered POSITIVE expectation

**Hypothesis:** Non-price data as a PRIMARY cross-sectional ranking signal (`cross-sectional-nonprice-rank.mjs`, new module), not a gate — the structural fix for T1-ZEROCOST's finding that 8 of 10 non-price sources tested in this project were only ever tested as GATES on breakout/anticipate, and a filter on a population with no gross edge can only select subsets of nothing. ONE feature pre-registered before any result was examined: OPEN-INTEREST CHANGE (`derivatives.mjs`'s `fetchAnalytics(type:'open-interest')`), chosen over funding-rate level and long/short ratio on data-coverage grounds alone (OI's documented whole-watchlist, no-rolling-ceiling coverage per `oi-trend-gate.mjs`, vs funding's ~365-730-day ceiling and long-short-ratio's only-4-majors-confirmed resolution). Formation: trailing 7-day OI percent change (reuses `oi-trend-gate.mjs`'s own N=7 window, not a new parameter); rebalance/forward horizon 7 days, entry delay 1 day — no price-structure entry condition anywhere in the signal. Reused `momentum.mjs`'s already-validated IC/permutation-p/BH-FDR/bootstrap/economics machinery directly (`scoreMomentumPanelRows`, `economicMomentumViews`, `tagMomentumRegimes`, `bhFdr`) on a differently-sourced panel; only the OI fetch + no-lookahead panel join is new code. Universe: ACTIVE watchlist (SEALED_SYMBOLS excluded), 24/24 active symbols cleared the 500-day OI-coverage gate, 106 rebalance dates (102 train / 4 recent-holdout, matching `momentum.mjs`'s own `recentHoldoutDates` default). Expected sign pre-registered POSITIVE (rising OI predicts higher forward returns, same directional hypothesis `oi-trend-gate.mjs` used as a gate); observed sign came back NEGATIVE (wrong-signed vs pre-registration) and not remotely significant. MULTIPLE-COMPARISONS: added as the 10th test to `MULTIPLE_COMPARISONS_AUDIT.md` §2's formal-NHST family (was 9); family-wide BH-FDR recomputed across all 10 — this study's own q=0.2498, does not survive, and the two prior survivors (B5-REVERSAL L=3, CLASSIFIER-FUNDING-FEATURE) are unchanged. No short access on this account — the long-only top-5 view was pre-registered as primary (`economicMomentumViews`'s `topN[5].netReturn`, already a long-only absolute return, not a spread) net of the real 0.017 round-trip cost; reported for disclosure (both train and the once-evaluated holdout came back net-negative) but never decisive since the train-significance gate failed first, the same "train/screen-gate-first" pattern H11/FUNDING-MEANREV/PAIRS-COINTEGRATION-STATARB already established

## MACRO-REGIME-PRIMARY-SIGNAL

**Verdict:** **NON-VERDICT** (holdout regime-episode count below this study's own pre-registered floor of 8 for any CI)

**Holdout n:** 829 train days / 356 holdout days, 2 train episodes / 1 holdout episode — **Date:** 2026-08-22 — **Commit:** (MACRO-REGIME-PRIMARY-SIGNAL commit)

**Deciding metric:** Train: 829 days, 2 regime episodes (628 + 201 days), strategy compound return +9.19% vs buy-and-hold +186.11% over the same window (severe underperformance in a strong bull run — flat during the second, 201-day episode missed nearly all of it), hit rate 47.4%. Holdout: 356 days, exactly 1 regime episode spanning the entire window (labeled favourable throughout — the signal never called a defensive stance during this stretch), strategy return -46.92% vs buy-and-hold -47.37% (both deep in a broad drawdown; the signal's call was simply wrong for the whole period, not merely under-sampled). With only 1-2 independent transitions per 3.25-year segment, no bootstrap CI or permutation test is trustworthy — exactly the sample-size trap this item's own task text pre-warned about (macro regimes turn over "a handful of times per year"; 3.25 years of local candle coverage is not enough to accumulate the tens of episodes a real inferential claim would need). No p-value reported; does not join the `MULTIPLE_COMPARISONS_AUDIT.md` formal-NHST family

**Hypothesis:** A market-exposure signal built from macro data genuinely exogenous to this market's own price/positioning (`scripts/macro-regime-primary-signal.mjs`, new, additive) — unlike every alt-data source tested in this project before it (funding, OI, basis, long/short ratio, top-traders, aggressor flow, liquidations, realized vol), all derived from the same market being traded. Sources confirmed reachable by EXOGENOUS-DATA-ACCESS-AUDIT: FRED's public CSV export for DTWEXBGS (Broad Dollar Index), DGS10/DGS2 (10y/2y Treasury, DGS2 newly confirmed reachable here, 1976-present), FEDFUNDS (policy rate). STRUCTURAL: generates market EXPOSURE directly (long the universe when favourable, flat when not), never a gate on breakout/anticipate — Template A is retired. Regime = majority vote (>=2 of 3) of three CONVENTIONAL, untuned thresholds fixed before any crypto return was examined: DXY vs its own trailing 200-session MA (standard trend filter), 10y-2y spread sign (the standard curve-inversion indicator), Fed funds trailing 3-month change sign (standard hiking/cutting framing) — a dead-band hysteresis was added to each (DXY +-1% matching `momentum.mjs::btcRegimeMap`'s own existing default, curve +-10bp, Fed funds +-5bp) after the first run's raw thresholds produced repeated single-day whipsaw episodes, a design correction made before any conclusion was drawn, using this codebase's own pre-existing convention rather than a fit against this run's return result. Every macro lookup is causal (1-day lag for the two daily FRED series, 20-day lag for FEDFUNDS to respect its monthly-average publication delay). Universe: 12 active (non-SEALED_SYMBOLS) watchlist assets with full local-candle coverage over this store's entire 2023-01-01 to 2026-03-31 window (ADA, APT, ATOM, BTC, DOGE, DOT, ETH, FIL, INJ, LTC, SOL, XRP) — chosen on coverage grounds alone, before any regime/return result existed, over the other 12 active assets whose local history starts 2025-01-22 or later (14 months or less). Equal-weight, 70/30 chronological train/holdout split. Cost: this project's real basis (FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side, ~1.7% round trip), charged once per regime flip

## LOG-REGRESSION-BANDS-CRYPTO

**Verdict:** **KILLED — nominal significance is a benchmark artifact, not a real signal**

**Holdout n:** 24 assets (pooled, one outperformance scalar each) — **Date:** 2026-08-22 — **Commit:** (LOG-REGRESSION-BANDS-CRYPTO commit)

**Deciding metric:** Pre-registered primary test: mean holdout outperformance vs buy-and-hold +0.1446, 95% block-free bootstrap CI [0.0682, 0.2323], one-sided sign-flip p=0.0002 — nominally the smallest p-value of any test in this project's history, and formally SURVIVES the family-wide BH-FDR recomputation below (rank 1/14, q=0.0028). Read alongside the always-flat control this same study computed: the signal underperforms simply holding cash by a wide, CI-excludes-zero margin (Δ mean -0.2892, CI [-0.4154,-0.1644]) — the pre-registered test's apparent significance is fully explained by the holdout window's near-uniform bearishness (23/24 assets negative), not by any real information in the band signal. Median slope t-stat modest (medianSlope 0.0144 / medianSeSlope 0.0108 ≈ 1.34); median ΔR² -0.0533 (drift fits better). No promotion consideration and no `SEALED_SYMBOLS` re-run — the confound already demonstrated is decisive on its own

**Hypothesis:** Log-price-vs-log-time regression bands as a PRIMARY exposure signal (`scripts/log-regression-bands-crypto.mjs`, new, additive, local candles only) — never attempted in this project despite being a well-known crypto framing. Per asset: OLS `log(close) ~ a + b*log(t)` (t = day index since this store's local window start) fit on TRAIN ONLY (70/30 split), coefficients frozen into holdout; standardized residual `z` vs the train residual SE; long when `z<=-1.5` (price far below trend), flat when `z>=+1.5`, hysteresis carry-forward in between (fixed band, not searched). Standing real crypto cost (FEE_RATE 0.008 + SLIPPAGE_PCT 0.0005/side) charged on every flip; buy-and-hold gets matching entry/exit cost. Universe: 24 active watchlist assets (all clear the pre-registered >=150-candle floor). Pre-registered primary test: one-sided sign-flip permutation on per-asset (holdout strategy return − holdout buy-and-hold return), n=24 assets, H1 fixed on the mechanism's own economic rationale before running. **Confound found and disclosed by this same study, not a later one**: an always-flat (never-trade, 0% return) control benchmarked against the identical per-asset buy-and-hold series outperforms buy-and-hold by MORE than the real signal does (+0.4337 mean vs the signal's +0.1446), because 23/24 assets had negative buy-and-hold return over their holdout window (a broadly bearish stretch, the same one MACRO-REGIME-PRIMARY-SIGNAL's holdout landed in) — any reduced-exposure strategy beats a falling benchmark near-automatically. Signal-vs-always-flat delta (the only fair test of whether the BAND carries information, not just "was mostly flat"): mean -0.2892, 95% CI [-0.4154, -0.1644] (entirely negative), one-sided p=0.9996 for "signal beats cash." Model-form diagnostic (this item's own explicit ask): median per-asset ΔR² (log-log fit vs a naive log(close)~a+b·t drift model, both train-only) = **-0.0533** — the log-log framing fits *worse* than plain drift on the median asset, i.e. the elaborate power-law framing adds no informational value over "price went up at a roughly constant rate."

## SPECTRAL-CYCLE-DETECTION-CRYPTO

**Verdict:** **NO-SIGNIFICANT-PERIODICITY — complete null, no trading logic built**

**Holdout n:** 24 assets, 0 skipped (no holdout strategy scored — null result, per pre-registered decision rule) — **Date:** 2026-08-22 — **Commit:** (SPECTRAL-CYCLE-DETECTION-CRYPTO commit)

**Deciding metric:** Zero of 7,150 pooled (asset, frequency) p-values survived Benjamini-Hochberg at q=0.05. Smallest raw p-value in the pool 0.0000237, roughly 3.4x the rank-1 BH-FDR threshold (0.0000070) — a real miss, not a rounding one. Median per-asset AR(1) φ ≈ -0.018 (essentially no persistence). Per this study's own pre-registered decision rule, the phase-based entry / sign-flip permutation / bootstrap CI branch was never invoked (gated on >=1 surviving pair). No p-value reported for a strategy return, so this does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family — the within-study frequency correction above is separate from that family's, per the script's own header disclosure

**Hypothesis:** Periodogram scan for periodicity in detrended log returns (`scripts/spectral-cycle-detection-crypto.mjs`, new, additive, local candles only) — never attempted in this project; distinct from `SEASONALITY-DAYOFWEEK-SESSION`'s fixed calendar buckets, this searches at whatever frequency the data actually contains. Per asset: direct O(n²) DFT periodogram on TRAIN-mean-centered log returns (24 active watchlist assets, >=150-candle floor, reused from `LOG-REGRESSION-BANDS-CRYPTO`). Null model is AR(1) red noise (Torrence & Compo 1998 eq. 16), not white noise, because financial returns are autocorrelated and a white-noise null manufactures spurious peaks. Every `(asset, frequency)` p-value across all 24 assets pooled into ONE family — 7,150 tests — and corrected together with a single Benjamini-Hochberg pass at q=0.05 (pre-registered as a deliberately more conservative reading than per-asset correction). STRUCTURAL REQUIREMENT (met vacuously — never reached): a surviving cycle would generate exposure directly, never a gate on `breakout`/`anticipate`.

## SPECTRAL-CYCLE-DETECTION-EQUITIES

**Verdict:** **NO-SIGNIFICANT-PERIODICITY in both families — the pre-registered test is the more informative null**

**Holdout n:** 30 symbols, 0 skipped (no holdout strategy scored in either family — null result, per pre-registered decision rule) — **Date:** 2026-08-22 — **Commit:** (SPECTRAL-CYCLE-DETECTION-EQUITIES commit)

**Deciding metric:** Family A (unrestricted): 0/5,222 pooled p-values survived BH-FDR q=0.05; smallest raw p 0.0007334, ~76.6x the rank-1 threshold (0.0000096). Family B (pre-registered): 0/60 survived; smallest raw p 0.0099017, ~11.9x the rank-1 threshold (0.0008333) — a far more permissive bar (87x looser than family A's) that still wasn't cleared, which is a meaningfully stronger negative for the earnings/expiry-cycle hypothesis specifically than the unrestricted scan alone. Median per-asset AR(1) φ ≈ -0.026 (essentially no persistence, consistent with crypto's ≈-0.018). Per this study's own pre-registered decision rule, neither family's phase-based entry / sign-flip permutation / bootstrap CI branch was invoked (both gated on >=1 surviving pair). No p-value reported for a strategy return in either family, so this does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family — same as the crypto companion

**Hypothesis:** Equities companion to `SPECTRAL-CYCLE-DETECTION-CRYPTO` (`scripts/spectral-cycle-detection-equities.mjs`, new, additive, cache-only) — byte-identical periodogram/AR(1)-red-noise/BH-FDR method, reused unchanged. Unlike crypto (a pure fishing expedition), equities carry known calendar mechanisms — quarterly earnings, monthly options expiry, index rebalancing — giving a genuine pre-registered hypothesis, so this study runs and reports TWO separately-corrected families rather than one: Family A (unrestricted, every `(asset, frequency)` pair, 5,222 tests, exactly crypto's pool shape) and Family B (pre-registered, only the ~63-trading-day quarterly and ~21-trading-day monthly target frequency per asset, fixed before the periodogram ran, 60 tests, corrected on its own smaller size rather than filtered from family A after the fact). Universe: the standing 30-symbol DJIA panel (`log-regression-bands-equities.mjs`'s convention), all 501-candle cached, no re-fetch, none skipped. Pre-registered calendar/sampling-artifact check (moot this run, no survivors): flags `k<=2` (near-DC/residual-drift) or a trading-week-multiple period not itself one of the two pre-registered periods (already covered by `SEASONALITY-DAYOFWEEK-SESSION`). STRUCTURAL REQUIREMENT (met vacuously — never reached in either family): a surviving cycle would generate exposure directly, never a gate on `breakout`/`anticipate`.

## LOG-REGRESSION-BANDS-EQUITIES

**Verdict:** **KILLED — wrong sign, and the study's own control shows the wrong sign is itself a benchmark artifact, the mirror image of crypto's**

**Holdout n:** 30 symbols (pooled, one outperformance scalar each) — **Date:** 2026-08-22 — **Commit:** (LOG-REGRESSION-BANDS-EQUITIES commit)

**Deciding metric:** Pre-registered primary test: mean holdout outperformance vs buy-and-hold **-0.0994** (wrong sign), 95% bootstrap CI [-0.199, -0.011] (excludes zero, negative), one-sided sign-flip p=0.9750 — does not survive BH-FDR (rank 16/16, last place). Explained by the SAME mechanism that made crypto's signal look artificially good: 21/30 symbols had POSITIVE buy-and-hold over the holdout (median +7.6%, the mirror of crypto's 23/24-negative holdout), and 13/30 symbols (43%, vs crypto's 12.5%) never triggered a single long entry, so a reduced-exposure signal is punished by a rising benchmark exactly as it was rewarded by a falling one on crypto. Always-flat control also underperforms buy-and-hold (mean -0.1247, worse than the signal), and signal-minus-flat is small, positive, and CI-includes-zero (mean +0.0253, 95% CI [-0.017, 0.063], p=0.118) — no detectable band information in either market. Median ΔR² (log-log vs drift) -0.1184 (drift fits better, same qualitative finding as crypto's -0.0533, though the slope itself is far more precisely estimated on equities: t≈12.4 vs crypto's ≈1.34). Cross-market comparison: `EQUITIES-BASELINE-PORT`'s gross-edge-magnitude gap does not reproduce for this method — instead both markets show the identical benchmark-direction artifact running in opposite raw signs, which is a more informative result than either a clean replication or non-replication would have been. No promotion consideration, no `SEALED_SYMBOLS` re-run

**Hypothesis:** Equities companion to `LOG-REGRESSION-BANDS-CRYPTO` (`scripts/log-regression-bands-equities.mjs`, new, additive, cache-only) — byte-identical method (OLS `log(close) ~ a + b*log(t)`, TRAIN-only fit, `z<=-1.5`/`z>=+1.5` band with hysteresis, BAND_K=1.5, 70/30 split), reused unchanged per this item's own work_queue note. Universe: the standing 30-symbol DJIA panel (`equities-madip-significance.mjs`'s convention), all 501-candle cached, no re-fetch. One disclosed, unavoidable difference: cost model — IBKR-realistic per-share commission ($0.005) converted to a percentage via each symbol's average holdout close, plus 0.0005/side slippage (equities-madip-significance.mjs's convention), vs crypto's flat ~1.7% round trip. Always-flat control pre-registered from the start this time (crypto's was added after the fact). Pre-registered primary test: one-sided sign-flip permutation on per-symbol (holdout strategy return − holdout buy-and-hold return), n=30, same H1 as crypto (mean-reversion exposure signal hypothesized to help).

## MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES

**Verdict:** **NON-VERDICT** (holdout regime-episode count still below this study's own pre-registered floor of 8)

**Holdout n:** 350 train days / 150 holdout days, 4 train episodes / 1 holdout episode — **Date:** 2026-08-25 — **Commit:** (this commit)

**Deciding metric:** Train episode count improved 2→4 vs crypto (a real gain from the different window), but holdout is still exactly 1 episode — the entire 150-day holdout sits inside one continuous "favourable" call. Train: 350 days, 4 episodes, strategy +17.08% vs buy-hold +22.44%, hit rate 50.6%. Holdout: 150 days, 1 episode, strategy +13.87% vs buy-hold +13.81%, hit rate 56.0%. Diagnosis: the binding constraint was never market history depth but the fixed 70/30 split applied to a short (~2-year, 501-candle) cached window — a longer total window still yields a short holdout under a fixed split fraction unless the split itself widens or more history is fetched. No p-value reported; does not join the `MULTIPLE_COMPARISONS_AUDIT.md` formal-NHST family

**Hypothesis:** Re-run of `MACRO-REGIME-PRIMARY-SIGNAL`'s identical, unmodified regime methodology (`scripts/macro-regime-primary-signal-equities.mjs`, new, additive) against the equities universe instead of crypto, per that item's own writeup naming this fix explicitly. Same regime definition/hysteresis/causal lags as the crypto version, zero re-fitting. IBKR Gateway reachability checked fresh (`node scripts/ibkr-smoke.mjs`: `ECONNREFUSED 127.0.0.1:4002`, consistent with `EXOGENOUS-DATA-ACCESS-AUDIT`'s documented intermittent-connectivity finding) — fell back to the existing `research-cache/equities-1d/` cache (standing 30-symbol DJIA universe, 501-502 candles, 2024-08-19/20→2026-08-19). One disclosed cost-model departure: `equities-madip-significance.mjs`'s per-symbol commission-to-percentage conversion, extended to a portfolio-level per-flip cost via the equal-weight mean of each universe symbol's own feeRate (its holdout-window average close), plus the same slippage

## GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL

**Verdict:** **KILLED — wrong sign, holdout underperforms buy-and-hold in both segments**

**Holdout n:** 65 holdout regime episodes (independent unit; 356 holdout days, 12 assets) — **Date:** 2026-08-23 — **Commit:** (this commit)

**Deciding metric:** GDELT access genuinely deep (3,497 daily points/series, 2017-01-01→2026-08-23, real paced pull — 12 attempts/~3min for volume, 3 attempts/~45s for tone). Train: strategy -77.33% vs buy-hold +186.11% (147 episodes). Holdout: strategy -56.06% vs buy-hold -47.37% (65 episodes, identical buy-hold return to `MACRO-REGIME-PRIMARY-SIGNAL`'s same-window holdout, confirming a shared benchmark). Pre-registered primary test: mean holdout episode spread -0.00594 (wrong sign), one-sided sign-flip p=0.7113, nowhere close to significant. 95% block-bootstrap CI on holdout daily strategy returns [-0.00415, -0.00054] (excludes zero, negative) corroborates from a second angle. Hit rate ~50.5% in both segments, indistinguishable from chance — the failure mode is turnover cost, not wrong direction: ~64 holdout flips at this project's real per-side cost (~0.85%) is roughly 54% of cumulative cost drag alone, the likely dominant driver of the underperformance despite the pre-registered hysteresis bands. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as the 17th sub-test (14th study) — does not survive BH-FDR (see that document's §2)

**Hypothesis:** GDELT news-volume/tone regime exposure signal on crypto (`scripts/gdelt-news-sentiment-primary-signal.mjs`, new, additive) — genuinely exogenous data (GDELT DOC API, paced `curl` pull per `EXOGENOUS-DATA-ACCESS-AUDIT`'s workaround), same family as `MACRO-REGIME-PRIMARY-SIGNAL`. Construct pre-registered before any return touched: GDELT Volume Intensity above its own trailing 200-session MA (±1% hysteresis band) AND Average Tone above its own trailing 200-session MA (±0.1 absolute band) = favourable, majority-of-2 composite, 1-day publication lag. Universe/window reused verbatim from `MACRO-REGIME-PRIMARY-SIGNAL`: 12 assets with full 2023-01-01+ coverage, identical train (2023-01-02→2025-04-09) / holdout (2025-04-10→2026-03-31) split, same real crypto cost basis (~1.7% round trip charged per flip). Pre-registered primary test: one-sided sign-flip permutation on per-holdout-episode (strategy day return − buy-and-hold day return) spread, n=65 episodes — this study's own pre-registered effective-n unit (regime episodes, not days), matching this project's per-independent-unit convention.

## ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL

**Verdict:** **KILLED — wrong sign, p=0.9990, holdout underperforms buy-and-hold by 29.3 points**

**Holdout n:** 107 holdout regime episodes (independent unit; 392 holdout days, n=1 asset) — **Date:** 2026-08-27 — **Commit:** (this commit)

**Deciding metric:** Train: strategy -34.10% vs buy-hold +548.72% (914 days, 204 episodes). Holdout: strategy -71.46% vs buy-hold -42.14% (392 days, 107 episodes, hit rate 51.3%). Pre-registered primary test: mean holdout episode spread -0.006973 (wrong sign), one-sided sign-flip p=0.9990. 95% block-bootstrap CI on holdout daily strategy returns [-0.004357, -0.001993] (excludes zero, negative) corroborates. Hit rate ~50-51% in both segments (indistinguishable from chance) — the loss is far larger than a coin-flip signal alone would produce: 107 holdout episodes / 392 days ≈ 3.7-day average episode length, ≈107 flips at real per-side cost (~0.85%) is ~91% cumulative cost drag on its own, comfortably exceeding the entire strategy-vs-buyhold gap — a ±1% band is plausibly too narrow to suppress whipsaw on this series' natural daily volatility, the same failure mode `GDELT-NEWS-SENTIMENT-PRIMARY-SIGNAL` diagnosed under an identical band convention on a different exogenous input. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as the 18th sub-test (15th study) — does not survive BH-FDR, and its addition causes a real family-size-driven flip: `EQUITIES-MADIP-OUT-OF-SAMPLE` moves from formal survivor (q=0.0493 at n=17) to non-survivor (q=0.0522 at n=18), its own p=0.0116 unchanged — see that document's §2

**Hypothesis:** BTC-only active-address-count exposure signal (`scripts/active-address-count-primary-signal.mjs`, new, additive) — genuinely exogenous data (blockchain.com Charts API `n-unique-addresses`), staged per `WHALE-WALLET-ACCUMULATION-PRIMARY`'s own named escape hatch (a deliberately different population-usage-momentum hypothesis, not a second whale-tracking attempt). Access re-verified fresh: the audit's default query is silently downsampled by the API (1,603 pts, not truly daily); `&sampled=false` gives the genuine full-resolution series (6,409 pts, 2009-01-03→2026-08-26, 24 non-1-day gaps). Construct pre-registered before any BTC return touched: active-address count above its own trailing 200-session MA (±1% relative hysteresis band, matching GDELT's Volume Intensity band shape) = favourable, 1-day causal lag, exposure generated directly (never a gate). n=1 asset (BTC), local candle coverage 2023-01-01→2026-07-30 (1,307 candles), 70/30 split. Pre-registered primary test: one-sided sign-flip permutation on per-holdout-episode (strategy day return − buy-and-hold day return) spread, n=107 episodes (this study's own effective-n unit) — comfortably clears the pre-registered n>=8 floor, so this is a real test, not a non-verdict.

## WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC

**Verdict:** **PARTIAL EXPLANATION — turnover reduced, loss shrank, but still wrong sign and non-significant**

**Holdout n:** 88 holdout regime episodes (independent unit; 392 holdout days, n=1 asset) — **Date:** 2026-08-27 — **Commit:** (this commit)

**Deciding metric:** Train: strategy -9.06% vs buy-hold +548.72% (914 days, 160 episodes, down from 204 at ±1%). Holdout: strategy -61.88% vs buy-hold -42.14% (392 days, 88 episodes — down 17.8% from 107 at ±1%, hit rate 53.3%). Pre-registered primary test: mean holdout episode spread -0.005302 (still wrong sign), one-sided sign-flip p=0.9251 (closer to significance than the predecessor's p=0.9990, but nowhere near p<0.05). 95% block-bootstrap CI on holdout daily strategy returns [-0.003625, -0.001224] (excludes zero, negative) corroborates. The strategy-vs-buy-hold gap shrinks from -29.3 points (±1%) to -19.75 points (±3%), consistent with cost drag being part of the story — but ~88 holdout flips at real per-side cost (~0.85%) is still ~74.8% cumulative cost drag, **3.8x the size of the remaining gap** (up from 3.1x at ±1%), and hit rate (49-53%, both segments) remains indistinguishable from chance. Reading: cost drag is a real contributor but not the sole driver — widening the band reduces how often a directionless signal gets acted on, it cannot fix the signal's lack of direction. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as the 19th sub-test (16th study) — does not survive BH-FDR; no material side effect (new entry lands at rank 17/19, doesn't flip any current survivor/non-survivor) — see that document's §2

**Hypothesis:** Follow-on diagnostic to `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL` (`scripts/wider-hysteresis-band-cost-drag-diagnostic.mjs`, new, additive), sourced from that study's own named next-lever text: test whether a wider hysteresis band (reducing exposure-flip turnover) changes the verdict, isolating cost drag from signal-direction as the failure's driver. Byte-identical construct/data/cost basis/split/methodology, only change: pre-registered **±3% relative hysteresis band** (3x the killed study's ±1%) around active-address count's own trailing 200-session MA — a single primary width, not a multi-width sweep, per `MULTIPLE_COMPARISONS_AUDIT.md`'s own discipline (one new sub-test, not several). Pre-registered before any BTC return was touched.

## STILL-WIDER-HYSTERESIS-BAND-ACTIVE-ADDRESS-DIAGNOSTIC

**Verdict:** **CONTINUED PARTIAL EXPLANATION — turnover reduced further (more than the pre-registered "sub-linear" expectation), loss shrank sharply, but still wrong sign and non-significant**

**Holdout n:** 68 holdout regime episodes (independent unit; 392 holdout days, n=1 asset) — **Date:** 2026-08-27 — **Commit:** (this commit)

**Deciding metric:** Train: strategy -18.48% vs buy-hold +548.72% (914 days, 122 episodes, down from 160 at ±3%/204 at ±1%). Holdout: strategy -49.87% vs buy-hold -42.14% (392 days, 68 episodes — down 22.7% from 88 at ±3%, a *larger* relative cut than the ±1%→±3% step of -17.8%, contrary to the pre-registered expectation of sub-linear further cuts; hit rate 52.8%). Pre-registered primary test: mean holdout episode spread -0.002973 (still wrong sign), one-sided sign-flip p=0.7183 — continuing the trend toward significance across all three widths (0.9990→0.9251→0.7183), but nowhere near p<0.05. 95% block-bootstrap CI on holdout daily strategy returns [-0.002804, -0.000617] (excludes zero, negative) corroborates. The strategy-vs-buy-hold gap shrinks sharply from -19.75 points (±3%) to **-7.74 points (±5%)**; cumulative cost drag (68 flips × ~0.85%) falls from ~74.8% to **~57.8%** — both genuinely declining. The cost-drag/gap ratio nonetheless rises from 3.8x to **~7.5x**, but this is disclosed as an artifact of dividing a still-substantial (declining) cost figure by a gap approaching zero, not evidence cost drag is becoming a larger absolute problem. Hit rate (48.2%/52.8%) remains indistinguishable from chance at this band width too — no band width produced directional information; band-widening converges the strategy toward buy-and-hold rather than uncovering a real edge cost drag was masking. No further band-width follow-on staged — three widths spanning a 5x range all show the same ~50% hit rate and non-significant wrong-signed result, treated as a closed A/B/C chain per `MULTIPLE_COMPARISONS_AUDIT.md`'s discipline against open-ended parameter sweeps. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as the 20th sub-test (17th study) — does not survive BH-FDR; no material side effect (new entry lands at rank 17/20, doesn't flip either current survivor's status) — see that document's §2

**Hypothesis:** Third, distinctly-named diagnostic in the same band-width A/B/C chain on `ACTIVE-ADDRESS-COUNT-PRIMARY-SIGNAL`'s construct (`scripts/still-wider-hysteresis-band-active-address-diagnostic.mjs`, new, additive), sourced from `WIDER-HYSTERESIS-BAND-COST-DRAG-DIAGNOSTIC`'s own named next-lever text. Byte-identical construct/data/cost basis/split/methodology to both predecessors, only change: pre-registered **±5% relative hysteresis band** (5x the killed study's ±1%, up from the partial-explanation study's ±3%) — a single primary width, not a further sweep, per `MULTIPLE_COMPARISONS_AUDIT.md`'s own discipline. Pre-registered before any BTC return was touched.

## MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC

**Verdict:** **NON-VERDICT — still exactly 1 holdout episode; identifies the split fraction as never having been the real constraint**

**Holdout n:** 250 train days / 250 holdout days, 4 train episodes / 1 holdout episode — **Date:** 2026-08-27 — **Commit:** (this commit)

**Deciding metric:** Train (250 days, 4 episodes, lengths [8,1,12,229]): strategy +5.81% vs buy-hold +10.65%, hit rate 50.0%. Holdout (250 days, 1 episode): strategy +25.99% vs buy-hold +25.93%, hit rate 54.4%. Diagnosis: the train segment's own last episode (229 days) runs unbroken into the entire 250-day holdout — roughly the last 479 of 500 cached days are one continuous regime with no recorded flip, so no split point (50/50, 30/70, or otherwise) landing inside that span can produce a holdout with >1 episode. This rules out the split-fraction lever on this cache rather than leaving it untried: the prior study's "split, not depth" diagnosis had the wrong mechanism — it isn't the ratio, it's that this cached window's second half genuinely contains only one transition-free stretch. Only a materially longer window (IBKR access or a larger historical pull) can fix this. No NHST test run (episode floor not reached); does not join `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family

**Hypothesis:** Follow-on to `MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES`, testing that study's own named lever (b): whether the fixed 70/30 split, not market history depth, was the real constraint on holdout regime-episode count (`scripts/macro-regime-equities-split-fraction-diagnostic.mjs`, new, additive). Byte-identical construct/universe/cost model/cache to the 70/30 study, only change: pre-registered **`TRAIN_FRACTION = 0.5`** (50/50, ~250/250 days) — a single alternative split, not a sweep, per `MULTIPLE_COMPARISONS_AUDIT.md`'s discipline. IBKR reachability re-checked fresh (`ECONNREFUSED 127.0.0.1:4002`, still blocked).

## EQUITIES-BREAKOUT-OUT-OF-SAMPLE

**Verdict:** KILLED — edge does not reproduce, sign flips negative

**Holdout n:** 33 (`breakout`), 188 (`anticipate` control) — **Date:** 2026-08-22 — **Commit:** 698688e

**Deciding metric:** Holdout avgR -0.0854 (vs original DJIA-30 +0.1866R), 95% block-bootstrap CI [-0.4052, +0.3313], one-sided sign-flip p=0.6165; `anticipate` negative control +0.1619, CI [-0.0749, +0.4364], p=0.1310 (consistent, not a data-pipeline artifact)

**Hypothesis:** `breakout` re-tested on a fresh, zero-ticker-overlap universe (DJTA-20 vs the original DJIA-30), identical cost basis/config/split to `EQUITIES-BASELINE-PORT`/`EQUITIES-BREAKOUT-SIGNIFICANCE`

## EQUITIES-ALL-FAMILIES-BASELINE

**Verdict:** COMPLETE — descriptive, no family promoted

**Holdout n:** 0 (`vol_contraction`) to 475 (`ma_dip`) across the 12 families — **Date:** 2026-08-22 — **Commit:** 39d6f9c

**Deciding metric:** 8 of 12 families net-positive (corrected 2026-08-28 from this study's own erroneous "10 of 12" header — see `CROSS-FAMILY-TRADE-OVERLAP-AUDIT`); `ma_dip` combines the largest usable sample with a net-positive avgR (475 trades, net avgR +0.1526); `range_sweep_reclaim`'s +0.9656 net avgR on 3 trades explicitly flagged as not a sample; `vol_contraction` fired 0 holdout trades on this universe

**Hypothesis:** All 12 `tournament.mjs` families run unmodified on the 30-symbol DJIA-30 equity universe, `EQUITIES-BASELINE-PORT`'s cost basis/split — a breadth measurement to find where to look next, not a promotion of any family

## EQUITIES-COST-ASSUMPTION-SENSITIVITY

**Verdict:** CONTEXT-ONLY — sign robust to slippage citations, but the unmodeled commission floor plausibly binds unfavorably at realistic position sizes

**Holdout n:** 61 — **Date:** 2026-08-22 — **Commit:** 8b786a4

**Deciding metric:** Net avgR stays positive through every cited slippage (0-30bps), break-even at 45.42bps (~9x the 5bps baseline, no supporting citation in this project's record for that level); separately, IBKR's $1.00/order commission floor binds below 200 shares, i.e. below ~$6,692 (DOW) to ~$192,127 (GS) per-symbol position size, median ~$47,928 — plausibly binds for most trades at realistic retail/small-account sizing, so the reported net R is more likely optimistic than pessimistic once fully cost-complete

**Hypothesis:** Slippage-sensitivity grid + commission-floor arithmetic mapped onto `EQUITIES-BASELINE-PORT`'s `breakout` result (61 DJIA-30 holdout trades); scope `breakout` only, `anticipate` excluded (already net-negative)

## C0-SIGNAL-COMBINATION

**Verdict:** **KILLED — decisive, fails every clause of the pre-registered gate except the sample floor**

**Holdout n:** 3345 (joined composite population); 1115 (selected tercile) — **Date:** 2026-08-29 — **Commit:** (this commit)

**Deciding metric:** Joined population 3345 trades (5389 classifier holdout trades on the matched universe, 2044 dropped for no momentum-panel coverage yet). Selected tercile (n=1115) gross mean netR -0.9174 vs. joined-population baseline -0.9206 — visually indistinguishable. Permutation test: p=0.4708 (not significant; nowhere close to 0.05), sign nominally correct (selection beats the random-tercile null mean of -0.9220) but the effect is far too small to be anything but noise. Net of real 0.017 cost: composite selected -0.9344, composite baseline -0.9376 — both deeply negative, not merely close to zero. Composite loses to BOTH standalone signals on the same matched population: B5-REVERSAL top-3/top-5 net -0.0153/-0.0123 (near break-even, matching its established profile) and Classifier P5 selected net -0.8554 (still far ahead of the composite's -0.9344). 95% block-bootstrap CI on selected net (due-diligence only, not part of the gate) [-1.0828, -0.7670], does not exclude zero as "positive," entirely negative. **Absolute figures corrected 2026-08-29** (`VERDICTS-COST-CONSTANT-STALENESS-SWEEP`, per `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS`'s own flagged follow-up): this row's `netR`-based figures already carry the real cost via `strategy.js`, so the "gross mean netR" figures quoted above (-0.9174 selected / -0.9206 baseline) were already the correct single-counted numbers all along — it is the adjacent "Net of real 0.017 cost" composite figures (-0.9344/-0.9376, `compositeLegacy`/`compositeReal` computed by hand at `scripts/c0-signal-combination.mjs` L269-270) and the quoted "Classifier P5 selected net -0.8554" (`p5MatchedReal.selectedNet`, via `economicLiftNetOfCost`) that double-count cost. Corrected: composite selected **-0.9174**, composite baseline **-0.9206** (i.e. the already-quoted gross figures, relabeled — not new numbers); Classifier P5 selected net on this matched population corrects to **-0.8384** (`p5MatchedReal.selectedNet + 0.017`, same affine recovery `CLASSIFIER-P5-ECONOMICS-ROW-STALENESS` used, cross-checked against the saved run's `p5MatchedLegacy.selectedNet + 0.009 = -0.8384` to the 10th digit); the 95% block-bootstrap CI shifts by the same +0.017 to **[-1.0658, -0.7500]** (a uniform shift of every element of a bootstrap sample shifts every resample's mean, and hence both quantiles, by that same constant — not re-simulated, exact arithmetic). None of this changes the verdict or any gate clause: `positiveAtRealCost` (-0.9174 > 0) and `beatsP5` (-0.9174 > -0.8384) both still fail by a wide margin, `permutationSignificant` (p=0.4708) never depended on any cost model, and the CI still excludes positive entirely. Combining two small, already-cost-dead effects did not sum past the cost floor — it produced a result worse than either input alone, consistent with rank-averaging a real-but-weak momentum signal against a much larger-magnitude, much more negative classifier netR distribution: the combination is dominated by the classifier side's economics, not meaningfully improved by the momentum side's selection. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as its 21st sub-test (per PHASE-DIRECTIVE-BOOKKEEPING's pre-registered C0-C3 assignment) — p=0.4708 lands at rank 13/21, q=0.7605, does not survive; no material side effect (both existing survivors' q move by <0.001 from family growth alone) — see that document's §2. This closes the "existing small effects, just combined" hypothesis before any new data source is built, as this item's own note anticipated as a useful outcome either way. `C1` (options-vol risk premium) is now unblocked to run next per the phase directive's own sequencing rule

**Hypothesis:** PHASE DIRECTIVE (2026-08-29) mechanism C0: fixed a-priori rank-average combination of B5-REVERSAL's (L=3, sign-flipped `trailR`) cross-sectional momentum score and Classifier P5's per-trade win probability, on the same two already-used signals/holdout convention — a combination mechanism, not a variant of either closed signal (`scripts/c0-signal-combination.mjs`, new, additive, cache-only). Holdout deliberately reduced from the historical 16-symbol set to 13 symbols (drops `SEALED_SYMBOLS`' NEAR/SUI/UNI per this item's own "never touch it" instruction; AVAX/LINK stay in STABLE_13/train, unchanged from every prior study's own convention). Model/AUC reproduction of Classifier P5's published figure matches exactly (holdout AUC 0.5249, byte-identical); its published ECONOMIC figure (-0.4616R) does not reproduce from the current cache (fresh run: -0.8634R) — disclosed, not investigated further (out of this item's scope): `strategy.js`'s FEE_RATE/SLIPPAGE_PCT were corrected upward by FEE-SCHEDULE-REBASE the same day P5 was originally published, and now bake a materially higher cost into every `profileEntries()` record.netR than the original run used, on top of which `economicLiftNetOfCost`'s own separate `roundTripCost` still applies — row counts match exactly (15076 total/7580 holdout), ruling out a data or universe change as the cause. All comparisons in this study use freshly-computed figures throughout rather than mixing a stale cost basis for one side against a fresh one for the other. Pre-registered gate: >=100 joined trades; one-sided permutation test (K=2000, seed 20260829) that top-tercile-by-combined-score beats a same-size random tercile, p<0.05; composite selected net R>0 at the real 0.017 cost; composite beats BOTH standalone signals recomputed on the identical matched 13-symbol population

## C2-CONTINUOUS-MACRO-CONDITIONER-EQUITIES

**Verdict:** **NULL after correction — nominal raw p<0.05, does not survive family-wide BH-FDR**

**Holdout n:** 475 — **Date:** 2026-08-29 — **Commit:** (this commit)

**Deciding metric:** 475 `ma_dip` DJIA-30 holdout trades (30/30 symbols covered, 0 dropped for missing entry time or macro history — matches MADIP-REALISED-R-CONDITION-2's own trade count for the identical population exactly). Observed Spearman rho=-0.0980 (higher spread associated with lower net R; no direction was pre-registered, this is simply the observed sign). Permutation p=0.0365 (two-sided, K=2000) — nominally clears the pre-registered p<0.05 gate. Quintile mean net R (n=95 each, spread ascending): +0.600, +0.701, -0.456, -0.024, -0.057 — non-monotonic, consistent with a real but modest, noisy correlation rather than a clean gradient. Joins `MULTIPLE_COMPARISONS_AUDIT.md`'s formal-NHST family as its 22nd sub-test (per PHASE-DIRECTIVE-BOOKKEEPING's pre-registered C0-C3 assignment) — p=0.0365 lands at rank 6/22, q=0.1338, does not survive (rank 6's own critical value is 6/22×0.05=0.01364); this is the first addition to the family that raises the raw p<0.05 hit-count itself (five to six) rather than landing below the existing hits, but the q-value is nowhere close to the 0.05 line — see that document's §2. Closes continuous macro conditioning on the 10y-2y spread for the `ma_dip`/DJIA-30 population: the three prior discrete-regime studies' wall was structural (window shape, not merely under-powered), and now that the statistical unit is actually testable, the result is still a null. No threshold applied, no signal gated, no lag swept, no discrete-regime design re-run, `SEALED_SYMBOLS` untouched, no strategy/production code changed. `C3` (FX carry) is next per the phase directive's own sequencing rule

**Hypothesis:** PHASE DIRECTIVE mechanism C2, run after C1's account-side gate resolved neither-pass-nor-fail: does equity trade outcome vary with the LEVEL of the 10y-2y Treasury spread (DGS10-DGS2), treated as a continuous covariate — no threshold, no binary gate anywhere (`scripts/c2-continuous-macro-conditioner.mjs`, new, additive, read-only for equities, one FRED egress call). A genuinely different statistical unit from the three prior discrete-regime macro studies (MACRO-REGIME-PRIMARY-SIGNAL, MACRO-REGIME-PRIMARY-SIGNAL-EQUITIES, MACRO-REGIME-EQUITIES-SPLIT-FRACTION-DIAGNOSTIC), all three of which were structurally limited to 1 holdout regime episode (~479/500 cached equity days sit inside one unbroken favourable episode) — conditioning on a continuous level instead makes effective n the trade count, not the episode count. Equity trade population: `ma_dip` on the DJIA-30 holdout, MADIP-REALISED-R-CONDITION-2's exact unmodified config (`{ entryMode: "ma_dip", trendGate: false, alignMode: "none", minStopPct: 0, maxStopPct: .06, tpR: 5, lockBreakeven: true }`, 70/30 split, IBKR Fixed $0.005/share + 5bps/side slippage) — chosen as the most rigorously characterized existing equity trade population in this project, no parameter changed. Causal lag 1 day (DGS10/DGS2 daily series), reused verbatim from macro-regime-primary-signal.mjs. Pre-registered test: two-sided Spearman rank correlation between the causally-lagged spread level at each trade's own entry date and that trade's realised net R (no directional prior registered), significance via label-shuffle permutation (K=2000, seed 20260829); quintile mean-net-R breakdown as a descriptive companion only

## VOL-CONTRACTION-CASE-CLOSURE

**Verdict:** **PROVISIONAL CLEAR, CLOSED UNPROMOTED — clears the literal pre-registered 3-leg gate, but the CI no longer excludes zero once bar-clustering is applied; never a live D3 candidate, and stays that way**

**Holdout n:** 256 (AXIS C); 67 (sealed pool) — **Date:** 2026-09-01 — **Commit:** (this commit)

**Deciding metric:** Cleared the fuller 3-leg gate for the first time in this project's history on 2026-08-28 (`VOL-CONTRACTION-SAMPLE-EXTENSION`): 256 trades, gross avgR **+0.2524** (>0.10), 65.4% of assets net-positive (>=50%). Per `AGENT_PROTOCOL.md`'s new-economic-gate-result rule this made it provisional pending a one-time `SEALED_SYMBOLS` re-run, not a live D3 candidate. `VOL-CONTRACTION-SEALED-VALIDATION` (2026-08-29) ran that re-run: **INCONCLUSIVE on the trades leg, not a pass** — 67 trades (5/5 sealed symbols traded, 2/5 net-positive), structurally unable to reach the 150-trade floor at this pool's size (~46 trades expected at the active pool's own per-asset rate); this is absence of evidence, not evidence against. The same item resolved AXIS C's outstanding funding-cost caveat: both positive Kraken-derivatives cells stay positive net of real per-trade funding — maker **+0.2244** (funding-free +0.2231), taker **+0.1070** (funding-free +0.1057); both Kraken spot cells stay deeply negative (maker -0.3342, taker -0.9941). AXIS C was never read against a matched-geometry random-entry null (no such control was built for this axis), and `vol_contraction` scored zero DJIA-30 trades in `EQUITIES-BREADTH-VS-RANDOM-ENTRY-NULL` so it could not be cross-checked there either — both absence of evidence, not evidence against. `CRYPTO-EFFECTIVE-SAMPLE-AUDIT` (2026-09-01) then found AXIS C is the one crypto population genuinely exposed to date-clustering bias in this project's closed formal-NHST family (62.9% effective sample size, 161 distinct 15m bars behind 256 nominal trades), and its recorded normal-approx CI **[+0.0620, +0.4427]** does not survive bar-clustered resampling: the honestly-clustered interval is **[-0.0244, +0.5649], which no longer excludes zero** — evidence against treating the point estimate as reliable, though the literal point-estimate gate (avgR/trades/positiveAssets) still mechanically passes since it is a threshold rule, not a CI-exclusion rule. Net: two facts cut against confidence (CI no longer excludes zero; sealed pool could not replicate on the trades leg), two are simply absent (no random-entry null, no DJIA-30 breadth comparison), and the funding caveat resolves clean in AXIS C's favor. `ALPHA_DEFINITION.md` was checked and contains no existing citation of AXIS C as a live or provisional result (grepped for `vol_contraction`/`AXIS`/`VOL-CONTRACTION`/`crypto` — no match), so no annotation was made there; nothing to correct. No D3 promotion was ever proposed or made

**Hypothesis:** `vol_contraction` crypto price-structure family, 15m-entry holdout axis (`VOL-CONTRACTION-SAMPLE-EXTENSION`'s AXIS C) — closing the case in the formal record after three follow-on items examined it from different angles; first VERDICTS.md row for this axis (`T2-VOLCONTRACTION`'s existing row above reports its own separate 98-trade, 1h-entry sample and is untouched)

