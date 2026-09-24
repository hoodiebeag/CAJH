# What is already settled

<!-- digest: A trend-gated breakout entry shows no edge over a random entry with the same exits (equities, 1181 trades, excess +0.0183R, p=0.3932) — and is WORSE than random on losing names. Sixteen mechanisms closed, all transforms of one OHLCV panel. A win rate and a payoff ratio are not evidence; the comparison against a matched random control is. -->


Everything below was measured, not reasoned. It exists so the same ground is not re-walked: this
project once re-proposed a signal it had already killed under three other names, which is what
35,000 words of verdict tables were written to prevent and did not.

Those tables are gone. Git history has them. This is what survived because it still constrains a
decision.

## The result that closed the research programme

**A trend-gated breakout entry has no edge over a random entry using the same exits.** Equities,
128 names, 1,181 trades: strategy 0.3451R, random 0.3268R, excess **+0.0183R at p=0.3932** against
a minimum detectable effect of 0.218R. Crypto, 29 pairs, 2,446 configurations: the best
out-of-sample result lost to buy-and-hold.

The registered prediction was that the strategy adds value by declining to hold falling names. It
does the **opposite** — worse than random on the losers (excess −0.1175R), and worse still on the
worst twenty (−0.2752R). That is a refutation, not an absence of proof.

Sixteen mechanisms were closed this way: price-structure entries, cross-sectional momentum, low
vol, reversal, residual mean reversion, illiquidity, overnight/intraday decomposition, factor
trend-following, carry, funding, positioning, fair-value gaps, spectral cycles, log-regression
bands, macro-regime conditioning, news sentiment. **Every one of them was a transform of the same
OHLCV panel.** Opening a new line needs a genuinely different information source, not a new
parameterisation of that one.

## The trap that makes a dead strategy look alive

The stated acceptance criterion was "~10 trades a month, win rate at or above 40%, wins large
enough to offset the losses." The candidate met it on every count: 40.5% win rate, 2.92R average
win against 1.01R average loss, +0.5814R expectancy.

**A random entry with the same exits also met it** — 42.8% win rate, *higher*, at +0.5589R.

A wide stop, no reachable take-profit and a bounded hold caps losses near 1R and lets winners run
past 3R. A 40% win rate at a 2.7 payoff is therefore a property of the **exit geometry**, and it
comes free with any long entry in a rising market. Breakeven at 2.89:1 is a 25.7% win rate.

So: a win rate, a payoff ratio and an expectancy are not evidence. **The comparison against a
matched random control using identical exits is the evidence.** This is why `journal.mjs` draws
that control at decision time and `scoreJournal` reports the edge rather than the return.

## The two gates, and what they actually are

On the 127-name panel with `usEquityIbkr` costs, weekly-rebalanced decile books:

| | |
|---|---|
| Equal-weight baseline | **+68.86% net** (127 instruments) / **+67.97%** (117 stocks) |
| Random-selection null, long-only | **+33.70% net, mean Sharpe 0.850** |
| Same null, on stocks alone | **+34.28%, Sharpe 0.826** |
| Random-selection null, long-short | **−29.43%** |

Reproduced independently twice. A decile-scale book rotated weekly **inherits this null exactly**,
so it must clear ~0.85 Sharpe — not the index's 0.41 — before "high Sharpe" means anything.

The long-short null is *negative*: a market-neutral book of this shape loses about 29% to
two-legged turnover before any signal. That is the cost of the geometry, not a finding.

## Facts about the data that have bitten

- **The panel is 117 stocks and 10 ETFs** (IWM, QQQ, SPY, XLE, XLF, XLI, XLK, XLP, XLU, XLV).
  Nothing recorded this for months. A residual book's headline Sharpe of 0.963 — the highest ever
  recorded here — fell to 0.702 when the book could no longer buy those ETFs. Not because it
  preferred them (7.8% of picks against a 7.9% pool share) or earned more on them (0.405% vs
  0.408%), but because a basket's variance is 2.25% against a single name's 5.85%, and low-variance
  holdings flatter a compounded return. **Geometry, not selection.**
- **A single corrupted series can carry a whole result.** PARA has a 107,453× close range and was
  reliably selected by an illiquidity screen. `screenUniverse` exists for this; run it before any
  ranking.
- **`sp500-bundle` is split-adjusted** (measured: no split-shaped discontinuities in 128 series).
  Whether it is dividend-adjusted is **unknown and not answerable offline**, which is why
  `ibkr-panel.mjs` writes its own root rather than appending to it.
- **Cost assumptions were once half the real rate.** Every number predating that correction was
  wrong in the flattering direction. Costs come from `costs.mjs`, never from memory.

## Constraints on what can actually be traded

- **Shorting is not available.** IBKR returned shortability UNKNOWN on 128 of 128 symbols and
  available on 0; the crypto venue has no short or margin access at all. Every long-short result in
  this project's history is therefore research-only. A surviving short strategy is a reason to
  chase the entitlement, nothing more.
- **Asset classes trade only with a verified cost model AND verified executability.** See
  `CLASS_STATUS` in `analyst/risk.mjs`: US equities verified; crypto, forex and event contracts are
  paper-only; options forbidden.
- **IBKR entitlements, measured 2026-09-19/21.** News: BRFG, BRFUPDN, DJNL — the free bundle, and
  it covers 114 of 118 symbols, better than predicted. Sectors: 118 of 128 via `reqContractDetails`
  (the 10 unclassified are the ETFs — they are not companies). Intraday: minute bars are a pull,
  not a purchase. The intraday *ceiling* is unknown; the over-ask returned a timeout, not a
  refusal, and must not be cited as a limit.

## How to not fool yourself here

1. Screen the universe before ranking anything.
2. Never report a p-value without the family size and the baseline beside it.
3. Cross-check across data *sources*, not just implementations.
4. Derive calendars and marking conventions from the data, never from a constant.
5. If a fix improves a headline number, suspect it harder than you suspected the bug.
6. A mock is only evidence if it emits what the real library emits. Read the installed types.
7. Point-in-time is structural, not a checked afterthought — and test the claim anyway.
8. Model output is untrusted input: drop and count, never repair.

Number 6 has the sharpest instance: an adapter's tests passed for weeks with the error arguments
backwards, certifying a broken integration. And the general lesson from this codebase, earned
seven times in seven days: **the suite being green is not evidence the path works.** Every defect
found — an unfinished hold recorded as a completed 0% trade, a freshness guard passing a panel
dated four days in the future, a mode that was documented and unreachable — was found by running
the path, not by testing it.
