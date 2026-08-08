# CAJH Verdict Index

One row per hypothesis actually tested. This exists because verdicts were split
across `ROADMAP.md`, `TOURNAMENT_ROADMAP.md`, and `.agent_state.json` with no
single place to check "has this been ruled out" — which is why a duplicate of
the swing-low/pivot-reclaim signal ("Roadmap v2") got proposed after it was
already killed under three other names. Update this table in the **same commit**
as the verdict it records, not as a separate step — a verdict that lands here
later than the commit that decided it is exactly the gap that caused this file
to be needed in the first place.

Do not re-open a KILLED/FAIL/ABANDONED row without a genuinely different
information source, not a parameter change on the same one — see each row's
"why not a duplicate" bar before proposing anything adjacent.

| ID | Hypothesis | Verdict | Deciding metric | Holdout n | Date | Commit |
|---|---|---|---|---|---|---|
| Trade intensity | Order-flow trade-intensity filter | KILLED | No improvement over baseline | — | pre-2026-08-04 | — |
| Order-flow | Pooled BTC/ETH/SOL flow signal | Complete, no edge | — | 11,195 (final pool) | pre-2026-08-04 | — |
| MR1 | RSI(14)/30 mean-reversion, MA(20) exit | Implemented, not promoted | 8/8 tests green | — | 2026-08-05 | 0bfc60c |
| Momentum M7 | Cross-sectional momentum, residual (T2) | KILLED | Train IC=0.028, p=0.70 (fails train-significance gate) | 73 dates/881 rows (whole-symbol) | 2026-08-06 | 5cafa36 |
| Low-vol B4 | Low-volatility / low-beta (rank=negVol, negBeta) | KILLED (complete evidence, PWR3) | Train negVol p=0.228, negBeta p=0.058 (both fail train-significance gate) | negVol 78 dates/982 rows, negBeta 71 dates/865 rows (whole-symbol) | 2026-08-07 | (PWR3 commit) |
| Classifier P5 | Logistic classifier (entry-time features) | KILLED (complete evidence, PWR4) | Holdout AUC 0.5249 beats permutation null (p=0.0198, significant) but economic lift fails cost: selected-subset net -0.4616 R/trade vs baseline -0.5178 (lift +0.056, still deeply negative) | 7580 (whole-symbol) | 2026-08-08 | (PWR4 commit) |
| Roadmap v2 (rejected) | Swing-low 5-bar/close pivot, BTC/ETH/SOL, 1d | DUPLICATE — not staged | Same mechanism as `anticipate`/`bos` below, ~80% confidence from 3 independent judges | — | 2026-08-06 | (not staged) |
| T1-ZEROCOST | Zero-cost tournament, 8 baseline families | 7/8 still negative gross; `breakout` alone flips to cost-drag | `breakout` holdout +0.045R gross / -0.445R net, 3123 trades | 3123 | 2026-08-07 | (T1 commit) |
| T1B-BREAKOUT-COSTFIX | Cost-reduction on `breakout` (tpR 3→5, breakoutLookback 20→55) | FAIL | Holdout avgR improved -0.445→-0.381 but stays negative; only 2/28 assets positive | 3123 | 2026-08-07 | 859bd86 |
| T2-VOLCONTRACTION | ATR-compression breakout entry | FAIL | Holdout avgR -0.322, 98 trades, positive on 5/21 assets (gate: ≥150 trades, >+0.10, ≥40% win, ≥50% assets) | 98 | 2026-08-07 | b914d7d |
| T3-REGIMEFILTER | BTC 200d-SMA gate on `breakout` only | FAIL | Holdout avgR -0.379 vs -0.437 unfiltered (gate: >-0.10 required) | 1408 | 2026-08-07 | 4d63fd8 |
| T4-PORTFOLIO-MOMENTUM | Cross-sectional momentum_30d/momentum_vol, 7d+30d rebalance | ABANDONED | Both strategies failed sealed holdout (see TOURNAMENT_ROADMAP.md Track 4 RESULT for full table) | — | 2026-08-07 | 3e82137 |
| PWR3 | Low-vol whole-symbol sealed arm (post PWR1 data fix) | done — result folded into `Low-vol B4` row above | — | — | 2026-08-07 | (PWR3 commit) |
| PWR4 | Classifier whole-symbol sealed AUC (post PWR1 data fix) | done — result folded into `Classifier P5` row above | — | — | 2026-08-08 | (PWR4 commit) |
| T5-DECAY-EXIT | Time-based decay exit (24 bars, maxHold) on `breakout` | FAIL | Holdout avgR -0.445→-0.437 (negligible), trades 3123→3473; gate required avgR>-0.30 | 3473 | 2026-08-07 | 3e93bfe |
| T6-TIMEFRAME-ISOLATION | `anticipate`/`bos` re-tested at 1d (never tested off 1h before) | FAIL (both families) | anticipate avgR -0.237 (314 trades); bos avgR -0.536 (24 trades); gate required avgR>0 & ≥150 trades | 314 / 24 | 2026-08-07 | a556f78 |
| H11 | Funding-rate gate (Binance perp funding <=0.01%) on `anticipate` | DATA-GATED, honest non-verdict (diagnosed 2026-08-08) — 28/29 watchlist assets fail with Binance funding API returning HTTP 451 (geo-blocked from this environment, not a per-symbol bug); the 1 remaining (EOS) fails on unrelated pre-existing candle-history gap; alternative Kraken funding source works but only has ~367 of the required 730 days of history, so a provider swap would not clear the gate either without weakening the pre-registered threshold | Gate: train trades>=200 & holdout trades>=80, both avgR>0, holdout positive-asset rate>=50% — never actually evaluated on real funding coverage, 0 assets ever reached this check | 0 (0 eligible assets, environmental access ceiling) | 2026-08-08 | (H11 diagnosis commit) |
| DCA-MARTINGALE | Martingale sizing (capped 4x) on the fixed-interval DCA basket — deviated from its own pre-registered ma_dip trigger, see executor_result | FAIL (ruin) | avgR/unit-capital -0.2313, 57 intervals, ruin=true (equity reached zero) | 57 | 2026-08-08 | adaef56 |
| DCA-ANTIMARTINGALE | Anti-martingale sizing (capped 4x) on the fixed-interval DCA basket — same deviation as DCA-MARTINGALE | FAIL | avgR/unit-capital -0.1289 (gate needed >0), 57 intervals (gate needed ≥100), ruin=true | 57 | 2026-08-08 | 80ce307 |
| GRID-SIM | Geometric grid (10 levels/9 rungs, rolling 90-bar bound) vs buy-and-hold | FAIL | Holdout return -25.23% vs buy-and-hold -9.87% (worse, 22/27 symbols fail); drawdown -34.11% vs -54.96% (better, 27/27 pass) | 27/28 symbols | 2026-08-08 | 5af61dc |
| TRAIL-STOP-EXIT | Trailing %-drawdown exit (5%/10%, replacing fixed TP) on `breakout` | FAIL (both variants) | 5%: holdout avgR -0.381 (gate >-0.30); 10%: -0.469, worse than baseline with a train/holdout sign flip | 2675 / 2257 | 2026-08-08 | 9cc34da |

**Bottom line as of 2026-08-08 (reconciled):** T1B-BREAKOUT-COSTFIX, T5-DECAY-EXIT, T6-TIMEFRAME-ISOLATION, DCA-MARTINGALE, DCA-ANTIMARTINGALE, GRID-SIM, and TRAIL-STOP-EXIT are all now FAIL, closing out every follow-up this project had queued as of 2026-08-07-08 — no open questions remain from the original tournament program or the 100-strategy triage's NOVEL_VIABLE set. Classifier P5's cost-fix viability was separately investigated (threshold sweep, magnitude-correlation check) and found to have no plausible path to breakeven — see ROADMAP.md's P5 section for the sweep data; not given its own row since it was a due-diligence check on an existing KILLED verdict, not a new sealed study. Two genuinely new items are staged: B5-REVERSAL (a FOLLOWON_SPECS.md Part B footnote never actually queued — cross-sectional short-horizon reversal, a different information source from every price-structure family above) and CLASSIFIER-FUNDING-FEATURE (funding rate as a new covariate in P5's fitted model, not a repeat of H11's threshold-gate mechanism or funding-study.mjs's portfolio cash rule — both already resolved separately). FEE-SCHEDULE-REBASE is also staged and foundational: this project's cost assumptions (≈0.16%/0.40% maker/taker) are roughly half Kraken's verified current Tier-1 schedule (0.40%/0.80%), meaning every R-multiple above may understate real trading cost — that item diagnoses the true current rate and re-runs `breakout` under it without changing any other item's inherited defaults. Every price-structure entry family, every signal-combination approach, every position-sizing scheme, and the one market-neutral (grid) mechanism tested to date is net-negative or worse after costs. Nothing here should be read as 'close to working' — it should be read as 'these specific doors are shut.'