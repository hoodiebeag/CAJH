# Verdict templates — fill these, don't freeform

M7 / A3 / B4 write results into `ROADMAP.md` using the shells below. Fill every cell;
"—" only where genuinely not run. Numbers must match the harness output exactly. The
verdict line is one of: **PASS**, **KILLED**, or **CONTEXT-ONLY** (real but not
harvestable), with the deciding number quoted.

---

## Template — Momentum (M7)

**Pre-registration (frozen before holdout):** L=`__` · H=`__` · rebalance=`__` ·
primary transform = **residual (T2)**, β-window `__`d · holdout = `__` (whole-symbol: `__`;
recent-months: `__`). Universe stable-13: `[...]`. Q1-2026-only excluded early: `[...]`.

**Primary confirmatory result (residual IC, stable-13):**

| window | N assets | D dates | mean IC | block-perm p | 95% CI | detectable-IC floor |
|---|---|---|---|---|---|---|
| train | | | | | | |
| **sealed holdout** | | | | | | |

**Interpretation matrix (residual vs raw, on the primary cell):**

| | raw IC | residual IC | reading |
|---|---|---|---|
| train | | | |
| holdout | | | |

**Per-regime (residual IC, train):**

| regime | dates | mean IC | p |
|---|---|---|---|
| BTC bull | | | |
| BTC bear | | | |
| BTC flat | | | |

**Exploratory grid (residual, BH-FDR over the full ~100-test family, TRAIN only):**

| L\H | 7d | 14d | 30d |
|---|---|---|---|
| 14 | | | |
| 30 | | | |
| 60 | | | |
| 90 | | | |
_(cell = mean IC; bold = survives BH-FDR. Neighborhood stability: `__`.)_

**Economic (net of cost, enter close_{t+1}, terciles + top-N):**

| metric | gross | net (cost `__`% × turnover `__`) |
|---|---|---|
| top-tercile − universe fwd return | | |
| top-3 harvest | | |
| top-5 harvest | | |

**VERDICT:** `PASS / KILLED / CONTEXT-ONLY` — deciding number: `______`.
**Survivorship caveat (mandatory):** the universe is survivors-only; a positive result is
weaker than it looks, a null is conservative. `[one line on which applies here]`

---

## Template — Harvest (A3)

| strategy | window | net R/t or return | vs buy-&-hold | vs ungated swing | return/DD |
|---|---|---|---|---|---|
| A1 momentum-filter on swings | holdout | | | | |
| A2 top-N rotation (buffer `__`) | holdout | | | — | |
| buy & hold | holdout | | — | | |

**VERDICT:** `HARVESTABLE / CONTEXT-ONLY / DEAD` — deciding number: `______`.

---

## Template — Low-vol / second signal (B4)

| ranking var | outcome | window | mean IC | p | net spread |
|---|---|---|---|---|---|
| −trailing vol | fwd return | holdout | | | |
| −trailing vol | fwd Sharpe | holdout | | | |
| −trailing beta | fwd Sharpe | holdout | | | |

**Size/liquidity control:** does the signal collapse to "hold the majors"? `yes / no` —
evidence: `______`.
**VERDICT:** `PASS / KILLED / JUST-HOLD-MAJORS` — deciding number: `______`.

---

## Template — Classifier probe (P5)

**Setup:** model = L2 logistic (class-weighted) · label = win/loss @ tpR=`__` · features = `[...]`
· λ (train-CV) = `__` · holdout = whole-symbol `[...]` + recent `__`mo · base rate (positives) = `__`%

| | train AUC | holdout AUC | perm p (K=`__`) | train−holdout gap |
|---|---|---|---|---|
| result | | | | |

**Top coefficients (standardized, sign = direction):** `feature: β …`
**Precision/recall @ threshold `__`:** P=`__` R=`__`
**Economic lift (net of cost, if AUC>0.5):** `______`
**VERDICT:** `PASS / KILLED (entry empty)` — deciding: holdout AUC `__`, p `__`.
**Survivorship + imbalance caveat (mandatory):** `[one line]`
