# Follow-on specs — queued behind MOMENTUM_SPEC.md

Two things the Architect should have staged so the pipeline never idles on a result:
**Part A** runs *only if* momentum passes §6 of `MOMENTUM_SPEC.md` (how to harvest a
confirmed IC). **Part B** runs *in parallel* — a second, independent signal that reuses
the momentum harness almost entirely.

---

## Part A — Harvesting a confirmed momentum IC (conditional on §6 pass)

A positive, holdout-confirmed IC means "rank predicts relative forward return." It does
**not** yet mean a tradeable strategy — turning a rank signal into positions adds new
choices, each an overfitting surface. So the harvest rule gets its **own sealed-holdout
validation**, on the same held-out symbols/dates the IC used, and must clear real
baselines, not just be positive.

### Two harvest designs — test the cheaper one first

**A1 — Momentum as a filter on the existing swing strategy (recommended first).**
Keep the entire live entry/exit engine; add one gate: only take a swing-low entry in an
asset currently in the **top momentum quantile** (tercile, per the confirmed L). This is
surgical (one predicate, reuses everything), and it answers the most valuable question
directly: *does momentum context turn the break-even swing trigger positive?* If the swing
edge is ~0 uniformly but +EV inside strong assets, that is the whole project's payoff.
- Build: a `momentumRank(asset, date)` lookup + a gate in the research backtest (NOT the
  live path yet). Compare gated vs ungated swing strategy on the sealed holdout.
- Success: gated net R/t > ungated net R/t **and** > 0 on held-out symbols/dates, net of
  cost, present outside the bear regime.

**A2 — Standalone momentum rotation (only if A1 shows the effect is real but the swing
timing wastes it).** Hold the top-N (N∈{3,5}) by momentum, equal-weight, rebalance at the
confirmed H. The extra design — and each is a knob to freeze before holdout:
- **Turnover control:** hysteresis/buffer — only rotate a name *out* when it falls below a
  wider rank threshold (e.g. leaves the top-2N), not the moment it leaves top-N. Directly
  attacks the cost drag that §5/M6 will have flagged.
- **Cadence:** rebalance = H (matches the horizon the IC was measured at; faster churns,
  slower decays the signal).
- **Sizing:** start equal-weight (the IC is rank-based, so magnitude weighting is an
  unvalidated extra); risk-parity is a later refinement, not a v1.
- Success: beats **both** buy-and-hold **and** the A1 filter on the sealed holdout, net of
  turnover cost, with drawdown reported (a higher-return, higher-DD result is not
  automatically better — report return/DD).

### Kill criterion for Part A
If neither A1 nor A2 beats buy-and-hold net of cost on held-out data, the honest verdict
is: *the relationship is real but not harvestable by this bot* — log it, and momentum
becomes a **context variable** (a thing cajh reports/considers), not an execution edge.
That is still a result.

### Queue seed (Part A) — all in `momentum.mjs` / a new `harvest.mjs`, no frozen paths
| id | file | task | done_when | depends_on |
|----|------|------|-----------|------------|
| A1 | harvest.mjs | Momentum-tercile gate on the swing backtest; gated vs ungated on sealed holdout. | Gate uses only ≤t data; both arms scored on identical held-out symbols/dates; net of cost. | momentum §6 = pass |
| A2 | harvest.mjs | Top-N rotation with hysteresis buffer, rebalance=H, equal-weight; vs buy-&-hold + A1 on holdout. | Turnover, net return, and return/DD reported on held-out data; buffer param frozen pre-holdout. | A1 |
| A3 | ROADMAP.md | Writeup + verdict against Part-A success/kill. | Numbers match A1/A2; verdict states harvestable / context-only / dead. | A2 |

---

## Part B — Second signal: cross-sectional low-volatility / risk anomaly

**Why this one.** After momentum, the low-volatility (a.k.a. betting-against-beta) anomaly
has the highest independent base rate in the literature — low-risk assets earn higher
*risk-adjusted* forward returns than high-risk ones, robustly, across markets and decades.
It is **uncorrelated with momentum** (different variable), and — the decisive practical
point — it reuses the momentum harness *almost entirely*: same cross-sectional IC
estimator, same permutation null, same block bootstrap, same sealed holdout, same FDR
family machinery. Only the **ranking variable** changes.

### The test (mirrors MOMENTUM_SPEC exactly, with one swap)
- **Ranking variable:** trailing `L`-window volatility (stdev of daily log returns), or
  trailing beta-to-BTC. Rank assets low→high.
- **Hypothesis:** cross-sectional IC of **(−trailing vol)** vs forward *risk-adjusted*
  return is > 0 — i.e., lower-vol assets have higher forward Sharpe. Also test vs raw
  forward return (the raw version is where low-vol famously *underperforms* on return but
  wins on risk-adjusted terms — reporting both is the point).
- **Everything else identical:** daily bars, same L/H primary + grid, non-overlapping per
  cell, date-block permutation, whole-symbol sealed holdout, one FDR family, stable-13
  primary, survivorship caveat, cost/turnover, per-regime split.
- **Forward metric:** report both forward return *and* forward return/vol (Sharpe), since
  the low-vol claim is specifically about risk-adjusted performance.

### The crypto-specific caveat to pre-register
Low-vol in crypto is confounded by **size/liquidity** (low-vol coins tend to be the
majors) and by **the stable-to-BTC relationship** — this can collapse into "hold BTC/ETH,"
which is nearly buy-and-hold on the majors. The residual/market-neutral transform (T2) and
a size control are the checks. If the "edge" is just "hold the two biggest coins," say so.

### Queue seed (Part B) — reuses `momentum.mjs`
| id | file | task | done_when | depends_on |
|----|------|------|-----------|------------|
| B1 | momentum.mjs | Parameterize the ranking variable (return / −vol / −beta) so the M1–M7 pipeline runs on any of them. | Momentum result reproduces bit-for-bit when rank=return (no regression); rank=−vol runs. | momentum M2 |
| B2 | momentum.mjs | Add forward Sharpe (return/vol) as an outcome alongside forward return. | Both outcomes reported per cell. | B1 |
| B3 | lowvol via M5/M6 | Run the low-vol ranking through the existing sealed-holdout + cost harness; add the size/liquidity control. | Same honesty gates as momentum; size-control result reported. | B1,B2, momentum M5/M6 |
| B4 | ROADMAP.md | Writeup + verdict; explicitly separate "real risk-adjusted edge" from "just hold the majors." | Numbers match B3; verdict states which. | B3 |

**Cheap third, noted not specced:** short-term **reversal** (short L, e.g. 3–5d, expected
*negative* return-IC — recent losers bounce) is the same harness with a short lookback and
a sign flip. Fee-sensitive in crypto, so it lives or dies on M6's net-of-cost line. Queue
it behind B only if the ranking-variable parameterization (B1) is already in.

---

_Order of operations for the Architect: momentum M1–M7 first (confirmatory). In parallel,
B1–B4 (independent, high base rate, near-free given the shared harness). Part A only after
momentum passes §6. Every branch ends in a ROADMAP verdict — pass, killed, or
context-only — so no thread dangles._
