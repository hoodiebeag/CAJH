# Signal 3 spec — multivariate classifier probe (does the entry contain signal?)

_Parallel probe, independent of momentum. Generalizes `!discover`/`profileEntries`, which
tested features **one at a time**, to ask whether a **combination** of entry-time features
predicts the trade outcome — an edge could live in an interaction ("low RSI AND high room
AND BTC-bull") that no univariate rule catches. Same honesty machinery as everything else:
fit on train, score on the sealed holdout, permutation-null the whole procedure._

---

## 0. The question, and the one that would fool us

**Question:** does a model over the entry-time feature set discriminate winners from losers
**out-of-sample** better than chance (holdout AUC > 0.5, beyond a permutation null)?

**The trap this spec is built to avoid:** a flexible model (XGBoost, deep nets) will fit
noise and report a beautiful cross-validated AUC that means nothing. So we deliberately use
the **lowest-variance model that could plausibly capture the signal** — regularized logistic
regression — and we **do not escalate**. If a regularized linear combination can't beat 0.5
out-of-sample, a more flexible model "finding" signal is overfitting, not discovery. A null
here is therefore decisive: it's the strongest "the entry is empty" statement we can make.

## 1. Data (reuse `profileEntries`)

- **Samples:** every swing-low long candidate across the universe, 2023–2026 — thousands of
  rows (unlike momentum's ~150 rebalance dates, so a low-DOF classifier has real power here).
- **Label `y`:** 1 if the trade hit target before stop, 0 if stop first (the existing
  `profileEntries` win/loss, `tpR=4` fixed — the classifier predicts outcome *for that exit
  config*; changing the exit relabels, so keep it fixed and stated).
- **Features `X` (entry-time only, no lookahead — `profileEntries` already enforces this):**
  RSI, %-from-MA, room-to-resistance (R), higher-low, range position, stop %, 1h/4h bias
  (one-hot), volume ratio, plus available `features.js` additions (ATR/vol regime, BTC 4h
  context). List the exact columns used in M-output.
- **Standardize** each feature to z-score using **train statistics only** (fit the scaler on
  train, apply to holdout — never fit on holdout).

## 2. Model (regularized logistic — implement in plain JS, no heavy deps)

- **Primary:** L2-regularized (ridge) logistic regression. Sigmoid + gradient descent with an
  L2 penalty is ~40 lines; deterministic; interpretable coefficients. **Class-weight** the fit
  (~15% positives — see `!profile`) so the minority class isn't ignored.
- **Regularization strength `λ`:** selected by **inner k-fold CV on TRAIN ONLY** (maximize
  CV AUC), then refit on full train, score holdout **once**. Never tune `λ` on the holdout.
- **Optional robustness (not primary):** L1 (sparse, for feature selection). If added, it
  goes through the identical train-only-tuning + holdout scoring. Do **not** add tree/boosted
  models (§0).

## 3. Metric, holdout, and null (same discipline as momentum)

- **Metric:** AUC (Mann-Whitney rank form — robust to the class imbalance), on the **sealed
  holdout**. Whole-symbol reserve is primary (power); recent-months secondary.
- **Permutation null (critical):** shuffle the labels `y`, **refit the entire pipeline**
  (scaler + λ-selection + logistic) on train, score the holdout AUC. Repeat K≥100 times. The
  null must include the whole fit procedure so it captures the model's capacity to fit noise.
  p = fraction of permuted holdout-AUCs ≥ the real holdout AUC.
- **Report:** train AUC, holdout AUC, permutation p, and the gap between train and holdout
  AUC (a large gap = the model is memorizing train = discount any apparent edge).

## 4. If it discriminates — interpret, don't deploy

If holdout AUC > 0.5 with permutation p < 0.05: read the **logistic coefficients** (that's
why we chose an interpretable model) to see which features carry it. Those become candidate
signals that go through the **same harvest + validation** path as momentum (FOLLOWON Part A
discipline) before anything touches live. AUC lift must also translate to an economic lift
net of cost (a 0.53 AUC can be real and un-tradeable).

## 5. Caveats (mandatory in the writeup)

- **Survivorship** — same standing caveat as everywhere: universe is survivors-only.
- **Class imbalance** — ~15% positives; AUC handles it but report base rate and use class
  weights; also report precision/recall at a sensible threshold, not just AUC.
- **Label depends on exit config** — results are conditional on `tpR=4` + the structural stop.
- **Within-train correlation** — many entries per pair are correlated; the whole-symbol
  holdout is what makes the AUC honest, not the (inflated-N) train fit.

## 6. Task decomposition (parallel probe; all in a new `classifier.mjs`, no frozen paths)

| id | file | task | done_when | depends_on |
|----|------|------|-----------|------------|
| P1 | classifier.mjs | Build X (entry-time features) + y (win/loss) matrix from profileEntries across the universe; z-score scaler fit on train only; report columns + class balance. | No lookahead (features = profileEntries entry-time only); scaler never sees holdout; balance reported. | — |
| P2 | classifier.mjs | L2 logistic (class-weighted) + AUC (Mann-Whitney) in plain JS; λ chosen by inner k-fold CV on train only. | On synthetic planted-signal data AUC>0.5; on noise AUC≈0.5; λ-selection uses train only. | P1 |
| P3 | classifier.mjs | Sealed-holdout scoring (whole-symbol primary + recent-months) + permutation null (K≥100, refit-per-shuffle) → holdout AUC + p + train/holdout gap. | Holdout AUC, permutation p, and train-vs-holdout gap reported; null refits the full pipeline. | P2 |
| P4 | classifier.mjs | Coefficient readout (which features carry any signal) + precision/recall at threshold; attach survivorship + imbalance caveats. | Coefficients + PR reported; caveats present. | P3 |
| P5 | ROADMAP.md | Writeup + verdict via VERDICT_TEMPLATE (classifier shell). PASS only if holdout AUC beats the permutation null (p<0.05) AND the lift survives cost; else KILLED = entry empty (decisive, per §0). | Numbers match P3/P4; verdict states PASS/KILLED with the deciding AUC + p. | P4 |

_Expected prior: given the univariate `!discover` returned nothing and gross expectancy is
~zero, the most likely outcome is holdout AUC ≈ 0.5 → the strongest possible "the swing entry
carries no signal, even in combination" — which closes the entry-quality question for good.
A surprise > 0.5 would be the most important result the project has produced, and it would
still have to clear harvest + cost before it meant a dollar._
