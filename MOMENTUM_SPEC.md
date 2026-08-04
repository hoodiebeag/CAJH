# Momentum research spec (v1) — for the Architect

_Framing: this is a research project, not a profit hunt. We have eliminated a negative
edge (the swing trigger is break-even net of costs). The remaining task is a data
problem: **find a variable, measurable at decision time, whose value is correlated with
forward return**, so it splits the zero-expectation pool into a positive- and a
negative-conditional-expectation subset. This spec tests exactly one such candidate
variable — cross-sectional relative strength (momentum) — with the honesty machinery the
pipeline already has. Success is a measured relationship that survives out-of-sample, not
a P&L number._

---

## 0. What we are measuring (and what we are NOT)

We are **not** asking "does momentum make money." We are asking a narrow, falsifiable
statistical question:

> Across our 20-asset cross-section, is an asset's **trailing return** over lookback `L`
> rank-correlated with its **forward return** over horizon `H`, measured at
> non-overlapping rebalance dates?

The estimand is a **cross-sectional Information Coefficient (IC)**: the per-date Spearman
rank correlation between the trailing-return vector and the forward-return vector across
assets, averaged over rebalance dates. If that number is reliably positive out-of-sample,
a relationship exists and is worth harvesting. If it is zero, no portfolio construction
rescues it and momentum is closed like every other dead end — logged in `ROADMAP.md`.

The unit of observation is the **rebalance date**, not the trade. This matters: over 3
years at weekly, non-overlapping horizons the effective sample is ~150 dates, small and
autocorrelated. All statistics must respect that (see §5).

**This is CROSS-SECTIONAL (relative) momentum, not time-series (absolute) momentum.** The
question is whether the *ranking* of assets against each other predicts *relative* forward
performance — which asset leads, not whether the market goes up. Do **not** implement this
as "buy an asset when its own trailing return is positive": that is time-series/absolute
momentum, it is dominated by the market trend, and it has already been tested and closed —
the daily MA trend gate in ROADMAP is exactly that signal (−0.293 → −0.107 R/t, i.e. "stop
trading in a downtrend," inside the noise band). The value of the cross-sectional version
is that ranking assets against each other on the same date **removes the common market
factor by construction** (every asset shares that day's BTC move), which is precisely the
confound that swamped every earlier test. T2 (§4) removes it a second way as a check.

---

## 1. Hypotheses (pre-registered)

- **H1 (primary, confirmatory):** mean cross-sectional Spearman IC of `trailing_L` vs
  `forward_H` is > 0. Null: IC = 0.
- **H2 (residual):** H1 still holds after removing the BTC market factor (residual
  momentum) — i.e., the effect is not merely high-beta assets rising together in up-weeks.
- **H3 (risk-adjusted):** H1 holds when trailing return is volatility-normalized
  (rank by trailing Sharpe rather than raw return).

H1 is the one confirmatory test. H2/H3 are transformations that tell us *what kind* of
signal it is, if it exists.

## 2. Primary specification (ONE pre-registered test — no fishing)

| parameter | value | rationale |
|---|---|---|
| bars | daily | cross-sectional momentum is a low-frequency, portfolio-level effect; intraday is noise here |
| lookback `L` | 30d | standard momentum formation horizon, long enough to be signal not noise |
| forward `H` | 7d | short enough for ~150 independent dates over 3y; matches a weekly rotation |
| rebalance | weekly, **non-overlapping** | keeps forward windows independent |
| universe | the 20 stored pairs, 2023-01 → 2026-03 | already in the store |
| statistic | mean per-date Spearman IC | rank-based → robust to outliers/scale |
| significance | date-block permutation p-value + block-bootstrap 95% CI | see §5 |

**These four choices (daily / L=30 / H=7 / weekly) are the pre-registration.** The
confirmatory result is this cell scored on the sealed holdout. Everything else in §3 is
exploratory and cannot be promoted to "edge" without confirming here.

> **ARCHITECT DECIDES (two choices; the transform choice is now settled below).** Left to
> the Architect, fixed in writing before M5 and never revisited after seeing holdout
> numbers: (a) the primary `L`/`H`/rebalance cell; (c) the sealed-holdout split (which whole
> symbols, how many recent months — read §5.6: recent-months is weak, whole-symbol is
> stronger). The defaults in the table are the recommended starting point.

### 2.1 Primary transform — SETTLED: residual (T2), with raw (T1) reported alongside

The confirmatory test ranks by **market-neutral residual** return (T2), not raw. Reasoning:
a confirmatory pre-registration must yield **one unambiguous number**, and a positive *raw*
IC is contaminated by beta persistence (in a trending window, high-beta alts lead both
trailing and forward — "momentum" that is really "beta kept paying"). A positive *residual*
IC is unambiguously a real idiosyncratic effect or nothing. Second, cajh is long-only spot
and **cannot neutralize market exposure**, so residual answers "is my *selection* real?"
while raw shows "what I will actually *experience* (beta included)." Both are reported every
time; residual is the one the pass/kill gate (§6) is applied to.

**Interpretation matrix (report all four; this is the actual finding):**

| residual IC | raw IC | reading |
|---|---|---|
| + | + | real idiosyncratic momentum AND actionable — best case, unambiguous |
| ~0 | + | "it's just beta" — raw ranking works only because high-beta led in this window; will invert on reversals |
| + | ~0 | real selection signal masked by beta noise in raw; hard for a long-only spot bot to capture cleanly |
| ~0 | ~0 | nothing |

Pre-register the T2 rolling-β window at **90d, strictly ≤ t** (§3.5). This is the one extra
estimation choice residual carries over raw; it is frozen here, not swept.

## 3. Exploratory grid (separated, FDR-controlled)

`L ∈ {14, 30, 60, 90}` × `H ∈ {7, 14, 30}` = 12 cells. **Each cell rebalances at interval
= its own `H`, so every cell is internally non-overlapping** — a weekly rebalance with an
H=30 forward window would overlap 4:1 and re-inflate significance (the order-flow trap).
The power cost is real and must be reported per cell: non-overlapping `D ≈ span/H` gives
detectable-IC floors of ~0.044 (H=7), ~0.062 (H=14), ~0.091 (H=30) — the long-horizon
cells are weak and a null there is uninformative.

Report the full IC surface, **Benjamini-Hochberg FDR corrected across the WHOLE
exploratory family** (see §5, item 6) — not just these 12 cells. Exploratory only: a grid
cell looking good is a hypothesis for the *next* holdout, never a result. The primary cell
(§2) is the sole confirmatory test.

## 3.5 Estimand — precise definitions (pin these before coding)

- **Returns:** log returns for the IC (rank-invariant, so log vs simple does not change
  Spearman ranks — but fix it so residual/vol math is consistent); simple close-to-close
  for the §6 economic spread. Trailing = `ln(P_t / P_{t−L})`; forward = `ln(P_{t+H} / P_t)`,
  both on daily closes.
- **Cross-section membership on date t:** an asset counts only if it has a full `L`-bar
  history before `t` AND a full `H`-bar future after `t` (no partial windows). Require at
  least `M_min = 8` assets present for a date's IC to be computed; drop dates below that.
  This automatically excludes the 7 Q1-2026-only pairs from earlier dates rather than
  silently zero-filling them.
- **IC:** per-date Spearman rank correlation `ρ_t = corr(rank(trailR), rank(fwdR))` over
  the present cross-section; report `mean_t ρ_t` and the full `{ρ_t}` series.
- **Quantile / economic test:** with ≤20 assets, deciles are ~2 names — too thin. Use
  **terciles** (top ⅓ vs universe mean) for the headline spread, and report a
  **top-N harvest sketch** for `N ∈ {3, 5}` (hold the N strongest, equal-weight) as the
  long-only-actionable view. No decile spreads.
- **Market factor (for T2):** BTC daily log return is the primary market proxy; rolling
  **90d** OLS beta per asset, residual = asset return − β·BTC return. Robustness only:
  equal-weight-universe index as an alternative factor (report, don't gate on it).
- **Volatility (for T3):** trailing `L`-window stdev of daily log returns; guard against
  zero-vol (skip asset-date if σ = 0).

## 4. Data transformations (the analyst core — build as composable steps)

- **T1 — raw:** `r_i(t−L, t)`. The base signal.
- **T2 — market-neutral residual:** rolling-regress each asset's returns on BTC's
  (rolling β, e.g. 90d), take the residual return series, compute momentum on residuals.
  Removes the single dominant common factor. Verify: residuals ⟂ BTC on train (corr ≈ 0).
- **T3 — volatility-normalized:** `r_i(t−L,t) / σ_i(t−L,t)`. Tests whether the signal
  lives in return or in risk-adjusted return.
- **T4 — regime label:** tag each rebalance date by BTC regime (price vs its 200d MA →
  bull / bear / flat; reuse existing regime logic). Report IC **per regime** from the
  start — our window is ~85% bear, so a full-sample zero may hide a positive bull-IC.

Each transformation is an independent, unit-testable data step. The IC estimator (§5)
runs on the output panel of any of them.

## 5. Statistical hygiene (non-negotiable — reuse existing machinery)

1. **Non-overlapping forward windows.** Report effective N (≈ span / H). No overlapping-
   window inflation — this is the exact trap the flow work hit.
2. **Null = date-block permutation.** Shuffle the forward-return *vectors* across dates,
   preserving each date's within-cross-section correlation structure (so BTC-day comovement
   is in the null). Same principle as `flowsignal`'s block permutation. p = fraction of
   permutations with mean-IC ≥ observed.
3. **CI via block bootstrap** over dates (not i.i.d.), to carry the autocorrelation.
4. **Sealed holdout, two axes:** reserve (a) the most recent K months **and** (b) a few
   entire symbols, neither ever touched by grid selection or parameter choice. Primary
   spec is scored there. (Mirror the `exits` sealed-holdout discipline.)
5. **Cost/turnover.** An IC can be real and un-tradeable if rotation churns. Compute
   turnover from rank changes each rebalance; report **gross IC** and the **net**
   top-quantile-minus-baseline forward return after round-trip cost × turnover. Real ≠
   tradeable (the aggressor-imbalance lesson: p=0.003 yet 1–6% of cost).
6. **One FDR family for ALL exploratory tests.** The exploratory space is
   {12 grid cells} × {3 transforms T1/T2/T3} × {3 regimes} ≈ up to ~100 tests. Benjamini-
   Hochberg must span the *entire* family in a single correction — not per-grid, per-
   transform, or per-regime, which would let fishing in one dimension slip through. Only
   the single pre-registered primary (§2) is exempt, because it is confirmatory, not
   selected. Permutation block size = each cell's own `H` (§3 keeps cells non-overlapping,
   so a plain date shuffle suffices for the primary; larger-H cells still block by `H`).

### 5.6 Power — what this design can and cannot detect (read before choosing the holdout)

A single-date Spearman IC has null SD ≈ `1/√(N−1)` for a cross-section of `N` assets; the
SE of the mean over `D` independent (non-overlapping) rebalance dates is that ÷ `√D`. At
80% power, one-sided α=0.05, the **minimum detectable mean IC** is `(1.645+0.842)·SE`:

| scenario | N | D | SE(mean IC) | min detectable IC |
|---|---|---|---|---|
| full sample | 20 | ~169 | 0.018 | **0.044** |
| train (~2y, 13 always-present pairs) | 13 | ~104 | 0.028 | **0.070** |
| holdout — 6 recent months | 20 | ~26 | 0.045 | **0.112** |
| holdout — 12 recent months | 20 | ~52 | 0.032 | **0.079** |
| holdout — whole-symbol, full span | 20 | ~169 | 0.018 | **0.044** |

Three consequences that must shape the design, not be discovered after:

1. **The recent-months holdout is weak.** A 6-month reserve can only confirm an IC above
   ~0.11 — larger than most real momentum effects (equity monthly ICs run ~0.02–0.05). A
   null there means "underpowered," not "absent." **Prefer the whole-symbol holdout axis**
   (same power as the full sample, 0.044) and treat recent-months as secondary.
2. **The narrow pre-2026 cross-section (13 assets) raises the train floor to ~0.07.** More
   pairs in the store directly lowers this; it is the single highest-leverage way to buy
   statistical power. Flag for the roadmap.
3. **We are testing at the edge of the expected effect size.** Even the best-powered
   configuration detects ~0.044, and a real crypto momentum IC could plausibly sit below
   that. So a clean null is genuinely informative ("no effect ≥ ~0.05 here") but does not
   exclude a weak-but-real ~0.02 effect. Say exactly this in M7; do not overclaim a null.

## 6. Success / kill criteria (pre-committed)

**Passes** (→ proceed to harvesting design) only if ALL hold:
- Primary IC > 0 with block-permutation p < 0.05 on **train**, and
- Same sign with overlapping-CI magnitude on the **sealed holdout**, and
- Net top-quantile spread > round-trip cost × turnover, and
- Sign stable across the L/H neighborhood (not a lone grid cell), present in ≥ the
  non-bear regime.

**Killed** (→ log in ROADMAP, close momentum) if ANY hold:
- Primary IC within noise on train, or flips sign on holdout, or
- Net spread ≤ cost after turnover, or
- Effect exists only in a single grid cell / single regime with no neighbors.

_Prior from this project: every borderline signal (z=−1.90, p=0.010) has died on more
independent data. Momentum's advantage is a high base rate in the literature; that raises
the prior but does not exempt it from these gates._

## 7. Task decomposition (Architect queue seed — each sized to one Executor run)

All work lives in a **new** research script `momentum.mjs` and (optionally) a
`research.js momentum` subcommand. **No frozen live-trading paths are touched**
(`scanner/monitor/trader/bot/strategy/backtest.js` untouched; `allow_live_edit=false`).

| id | file | task | done_when | depends_on |
|----|------|------|-----------|------------|
| M1 | momentum.mjs | Load stored **daily** bars for the universe; build a per-rebalance-date panel of trailing-`L` and forward-`H` returns per asset. | No look-ahead (forward uses only strictly-future bars); non-overlapping dates; spot-check one date by hand; `npm test` green. | — |
| M2 | momentum.mjs | Cross-sectional IC estimator + date-block permutation p + block-bootstrap CI (reuse `researchlib`). | On synthetic data with a planted IC, recovers it (p<0.05); on shuffled data p≈uniform. | M1 |
| M3 | momentum.mjs | Transformations T2 (market-neutral residual) and T3 (vol-normalized). | Residual returns ⟂ BTC on train (\|corr\|<0.05); vol-norm unit-tested. | M1 |
| M4 | momentum.mjs | Regime labeling (T4) + per-regime IC table. | Dates labeled from BTC 200d MA; per-regime counts sum to total; table emitted. | M1 |
| M5 | momentum.mjs | Sealed-holdout harness: split by time **and** symbol; score primary spec on holdout; run the 12-cell grid with BH-FDR on **train only**. | Holdout dates+symbols provably untouched by selection; reproduces on re-run. | M2,M3,M4 |
| M6 | momentum.mjs | Cost/turnover model: turnover from rank changes; gross vs net top-quantile spread vs round-trip cost. | Turnover and net spread reported at the chosen rebalance frequency. | M5 |
| M7 | ROADMAP.md | Honest writeup: full IC surface, per-regime, holdout, net-of-cost, verdict against §6. | Numbers match M5/M6 output; verdict states pass or killed. | M6 |

## 8. Handoff mechanism (how this actually enters the loop)

1. Commit this file as `MOMENTUM_SPEC.md` at repo root.
2. Seed `blackboard.work_queue` in `.agent_state.json` with M1–M7 (JSON in the companion
   file `momentum_queue.json`), each `{ id, file, task, done_when, depends_on, state:"pending" }`.
3. Set `control.status = "ARCHITECT_PENDING"`, `objective = "validate MOMENTUM_SPEC
   decomposition, confirm no frozen-path edits, stock work_queue with M1–M7"`,
   `allow_live_edit = false`, `test_command = "npm test"`.
4. Add to `blackboard.known_findings`: "Momentum investigation per MOMENTUM_SPEC.md;
   see ROADMAP for prior dead ends — do not re-test order-flow / swing-trigger edge."
5. The Architect validates the decomposition and routes M1 → Executor; the loop runs.

_This spec defines the number that would convince us momentum is real in this data. If we
can't beat §6 on the sealed holdout, the correct output is a clean "killed" in ROADMAP —
which is itself a successful research result: one more high-prior door closed honestly._

---

## 9. Adversarial review (the skeptic pass — findings and resolutions)

Ran this design against itself looking for leaks, biases, and ways a null or a false
positive could be manufactured. Seven findings; the fixes are folded into the sections
above, and the two that **cannot** be fully fixed are disclosed as standing limitations.

1. **Grid overlap (fixed, §3).** H>7 cells at a weekly rebalance overlap and re-inflate
   significance. Resolved: each cell rebalances at interval = its own H.
2. **FDR family too narrow (fixed, §5.6).** Correcting only the 12 grid cells lets
   per-transform / per-regime fishing through. Resolved: one BH family over all ~100
   exploratory tests; only the pre-registered primary is exempt.
3. **Trailing-only estimation (fixed, §3.5/§4).** The rolling β (T2) and the 200d regime
   MA (T4) must use data strictly ≤ t. A full-sample β would leak the future. Made explicit.
4. **Trade-the-ranking-bar (fixed here + M6).** The IC may rank on close_t and measure
   forward from close_t (fine — it tests a *relationship*). But the economic/harvest test
   (M6) must **enter at close_{t+1}**, because you cannot trade the same close you ranked
   on. IC uses close_t→close_{t+H}; harvest uses close_{t+1}→exit. Do not let the harvest
   inherit the IC's entry timing.
5. **Changing universe composition (mitigated, not eliminated).** The cross-section grows
   13→20 when the Q1-2026 pairs enter — mid-bear, which could bias the recent period.
   Resolution: report the **stable-13 universe across the full span** as the primary IC,
   and the 20-asset recent period **separately**; never pool them into one headline number
   without showing both.
6. **Survivorship bias (STANDING LIMITATION — cannot fix, must disclose).** The universe
   is the 20 pairs that exist and are liquid *today*. Coins that delisted or died are
   absent, so the loser tail is truncated — and momentum studies are specifically sensitive
   to this (the dead coins are disproportionately the ones that kept falling, i.e. the
   short-momentum winners we can't see). This biases a long-only relative-strength result
   in an unknown direction and cannot be corrected without delisted-coin data we don't have.
   **M7 must state this explicitly**; a positive result is weaker than it looks, and a null
   is if anything conservative. Do not claim a clean edge without this caveat attached.
7. **Turnover eating a real IC (fixed, M6 + note).** A genuine weekly IC can be fully
   consumed by weekly rotation at ~0.9% round-trip. M6 already reports net-of-turnover; add
   that if the net dies, the follow-on (`FOLLOWON_SPECS.md` Part A) tests a
   hysteresis/buffer, lower-frequency implementation before momentum is declared
   un-harvestable. A real relationship killed only by turnover is a different verdict than
   no relationship.

**Net:** five findings are now closed in the design; survivorship (#6) is an irreducible
caveat that weakens any positive result and must ride along with every number; universe
composition (#5) is handled by reporting stratified rather than pooled. None of these
invalidate the test — they make its output honest.
