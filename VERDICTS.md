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
| Low-vol B4 | Low-volatility / low-beta | KILLED (data-gate, not tested-and-failed) | 0 eligible holdout rows at time of writing | 0 | — | — |
| Classifier P5 | Logistic classifier on planted features | KILLED (data-gate, not tested-and-failed) | No eligible whole-symbol holdout run | 0 | — | — |
| Roadmap v2 (rejected) | Swing-low 5-bar/close pivot, BTC/ETH/SOL, 1d | DUPLICATE — not staged | Same mechanism as `anticipate`/`bos` below, ~80% confidence from 3 independent judges | — | 2026-08-06 | (not staged) |
| T1-ZEROCOST | Zero-cost tournament, 8 baseline families | 7/8 still negative gross; `breakout` alone flips to cost-drag | `breakout` holdout +0.045R gross / -0.445R net, 3123 trades | 3123 | 2026-08-07 | (T1 commit) |
| T1B-BREAKOUT-COSTFIX | Cost-reduction on `breakout` specifically | pending | — | — | — | — |
| T2-VOLCONTRACTION | ATR-compression breakout entry | FAIL | Holdout avgR -0.322, 98 trades, positive on 5/21 assets (gate: ≥150 trades, >+0.10, ≥40% win, ≥50% assets) | 98 | 2026-08-07 | b914d7d |
| T3-REGIMEFILTER | BTC 200d-SMA gate on `breakout` only | FAIL | Holdout avgR -0.379 vs -0.437 unfiltered (gate: >-0.10 required) | 1408 | 2026-08-07 | 4d63fd8 |
| T4-PORTFOLIO-MOMENTUM | Cross-sectional momentum_30d/momentum_vol, 7d+30d rebalance | ABANDONED | Both strategies failed sealed holdout (see TOURNAMENT_ROADMAP.md Track 4 RESULT for full table) | — | 2026-08-07 | 3e82137 |
| PWR3 | Low-vol whole-symbol sealed arm (post PWR1 data fix) | pending | — | — | — | — |
| PWR4 | Classifier whole-symbol sealed AUC (post PWR1 data fix) | pending | — | — | — | — |
| T5-DECAY-EXIT | Time-based decay exit (24 bars) on `breakout` | pending, pre-registered | Gate: holdout avgR >-0.30, ≥150 trades | — | staged 2026-08-07 | — |
| T6-TIMEFRAME-ISOLATION | `anticipate`/`bos` re-tested at 1d (never tested off 1h before) | pending, pre-registered | Gate: holdout avgR >0, ≥150 trades | — | staged 2026-08-07 | — |

**Bottom line as of 2026-08-07: Tracks 1–4 of the tournament program have all failed or been abandoned.** Every price-structure entry family tested to date is net-negative or worse after costs. The open questions are PWR3/PWR4 (low-vol/classifier, blocked only by a prior data gate, not yet actually run), T5 (exit-timing, not entry-signal), and T6 (the one untested timeframe axis). Nothing here should be read as "close to working" — it should be read as "these specific doors are shut, these specific ones are still open."
