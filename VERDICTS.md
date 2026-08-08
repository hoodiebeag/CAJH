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
| T1B-BREAKOUT-COSTFIX | Cost-reduction on `breakout` specifically | pending | — | — | — | — |
| T2-VOLCONTRACTION | ATR-compression breakout entry | FAIL | Holdout avgR -0.322, 98 trades, positive on 5/21 assets (gate: ≥150 trades, >+0.10, ≥40% win, ≥50% assets) | 98 | 2026-08-07 | b914d7d |
| T3-REGIMEFILTER | BTC 200d-SMA gate on `breakout` only | FAIL | Holdout avgR -0.379 vs -0.437 unfiltered (gate: >-0.10 required) | 1408 | 2026-08-07 | 4d63fd8 |
| T4-PORTFOLIO-MOMENTUM | Cross-sectional momentum_30d/momentum_vol, 7d+30d rebalance | ABANDONED | Both strategies failed sealed holdout (see TOURNAMENT_ROADMAP.md Track 4 RESULT for full table) | — | 2026-08-07 | 3e82137 |
| PWR3 | Low-vol whole-symbol sealed arm (post PWR1 data fix) | done — result folded into `Low-vol B4` row above | — | — | 2026-08-07 | (PWR3 commit) |
| PWR4 | Classifier whole-symbol sealed AUC (post PWR1 data fix) | done — result folded into `Classifier P5` row above | — | — | 2026-08-08 | (PWR4 commit) |
| T5-DECAY-EXIT | Time-based decay exit (24 bars) on `breakout` | pending, pre-registered | Gate: holdout avgR >-0.30, ≥150 trades | — | staged 2026-08-07 | — |
| T6-TIMEFRAME-ISOLATION | `anticipate`/`bos` re-tested at 1d (never tested off 1h before) | pending, pre-registered | Gate: holdout avgR >0, ≥150 trades | — | staged 2026-08-07 | — |
| H11 | Funding-rate gate (Binance perp funding <=0.01%) on `anticipate` | DATA-GATED, honest non-verdict (diagnosed 2026-08-08) — 28/29 watchlist assets fail with Binance funding API returning HTTP 451 (geo-blocked from this environment, not a per-symbol bug); the 1 remaining (EOS) fails on unrelated pre-existing candle-history gap; alternative Kraken funding source works but only has ~367 of the required 730 days of history, so a provider swap would not clear the gate either without weakening the pre-registered threshold | Gate: train trades>=200 & holdout trades>=80, both avgR>0, holdout positive-asset rate>=50% — never actually evaluated on real funding coverage, 0 assets ever reached this check | 0 (0 eligible assets, environmental access ceiling) | 2026-08-08 | (H11 diagnosis commit) |

**Bottom line as of 2026-08-08: Tracks 1–4 of the tournament program have all failed or been abandoned, low-vol/low-beta (B4) is killed on complete evidence, and the classifier (P5) is now also killed on complete evidence** — its holdout AUC is statistically real (p=0.0198) for the first time anywhere in this project, but the economic lift does not survive cost (selected-subset holdout still nets -0.46R/trade). Every price-structure entry family and every signal-combination approach tested to date is net-negative or worse after costs. T1B-BREAKOUT-COSTFIX, T5, and T6 rows above may be stale relative to `.agent_state.json`'s work_queue — check there for their current status rather than trusting this line. Nothing here should be read as "close to working" — it should be read as "these specific doors are shut."
