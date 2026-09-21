# Where CAJH stands — 2026-09-21

Written for whoever picks this up next, including me.

## The one thing that must happen first

**The collection from 2026-09-21T00:28Z is still only on the owner's machine.** The committed
`data/` is the 2026-09-19 run with a one-symbol news cache. Nothing downstream can use the good
data until it is pushed.

```
cd CAJH
git pull                                   # picks up the ETF conId fix below
node scripts/ibkr-collect.mjs              # re-run: the last run missed ETF news
git add -f data/ && git commit -m "collection" && git push
```

The re-run matters. The previous run captured conIds only for symbols that carried an industry
label, so SPY, QQQ and the seven XL* sector funds got no news — the market-level commentary an
analyst is least able to infer from price. Fixed in `b643659`; the fix only takes effect on a
fresh run.

## Then the panel

```
node scripts/ibkr-panel.mjs --symbols universe/candidates.txt --skip-fresh
git add ibkr-bundle/ && git commit -m "panel" && git push
```

Expect hours, not minutes — IBKR paces historical data requests hard. `--skip-fresh` makes it
resumable, so re-run it if it stalls. **Report what the pacing actually turns out to be**: the
figure behind that warning is quoted from documentation and has never been measured here. News
pacing at 600ms was measured and held (118 requests, 0 failures); historical *data* at scale is
the open question.

The first run is also the cleaning pass. `universe/candidates.txt` is 1,047 tickers assembled
from model knowledge, not from a broker, so it certainly contains names since acquired, renamed
or delisted. The script reports every unresolved symbol and writes the resolved ones to
`ibkr-bundle/universe-resolved.txt`. **Use that file from then on.**

## What is measured, and what is still assumed

| | |
|---|---|
| News entitlement | BRFG, BRFUPDN, DJNL — the free bundle. Measured. |
| News coverage | 114 of 118 symbols, 884 headlines, 0 failures, 0 future-dated. Measured — **on S&P 500 names only**, which is the easy case. Untested on the small caps in the new universe. |
| Per-symbol cap | Binding. 7.75 average against a cap of 8, so more news exists than is pulled. `--per-symbol N` raises it; the context is a budget, so it is a tradeoff. |
| Sector map | 118/128 into 8 IBKR-industry groups. Measured. The 10 unclassified are ETFs and correctly so — they are not companies. |
| Intraday bars | A pull, not a purchase. All six legitimate rungs returned coherent counts. |
| Intraday *ceiling* | **Unknown.** The over-ask rung returned `timeout`, not a refusal, which is equally consistent with pacing or a slow server. Do not cite it as a limit. |
| Historical-data pacing | **Unknown at scale.** The panel pull will measure it. |
| Adjustment basis of `sp500-bundle` | Split-adjusted (measured). Dividend adjustment **unknown** and not answerable offline — which is why `ibkr-panel.mjs` writes its own root and never appends. |

## What the analyst is, right now

Six components plus a CLI, all wired and all exercised end to end: `dry-run`, `anonymised`,
`paper` (refuses), `settle`, `score`. Suite 1,141 / 0.

Paper mode refuses until the panel is current — that refusal *is* the measurement instrument, not
an obstacle. See `docs/ANALYST-DESIGN.md` for why this agent cannot be backtested; that argument
is load-bearing and should be read before anyone is tempted by a historical number.

Slate is 300 against a ~1,000-name universe: the analyst sees 300, roughly 750 in the middle of
the ranking stay invisible in any given batch. Inherent to a ranked slate, not a defect, but it
means a mechanical rule still decides what never gets considered. Revisit once the forward record
shows where decisions actually come from.

## Open questions nobody has answered

1. **MR04 is VOID, not closed.** Its actual claim — that sector-neutralising a residual adds
   something — was never tested, because the run stopped at its own control. Re-running needs an
   amended pre-registration that separates the factor set from the ranking set and does not carry
   `C_EXPECTED_NET` over. Writing that amendment after seeing the numbers is a real hazard and
   must be labelled as one.
2. **The standing minimum does not fit the goal.** 60 days and 50 trades was written for a
   diversified book. The owner is aiming at a skewed payoff — 5 of 128 names had a single day
   above +50% in 3.65 years — and no p-value on 50 outcomes of that shape means anything. What
   replaces it is genuinely open. Naming a number before the forward record exists would be
   inventing a gate to pass.
3. **The drawdown brake versus the thesis.** `DEFAULT_LIMITS` carries a 15% portfolio drawdown
   halt. A thesis that says "hold a beaten-down name through a nine-month turn" sits at a loss for
   months, and that brake is the mechanism most likely to close exactly the position the thesis
   depends on. Loosening a risk limit so a thesis survives is how a risk layer stops being one;
   tightening the thesis to fit may be the right answer instead. Owner's call, with the forward
   record in hand.
4. **The `C:` field** in IBKR headlines is parsed and deliberately not interpreted. Three samples
   above 0.77 is not a basis for telling an analyst what a number means.

## The pattern worth carrying forward

Seven defects were found in seven consecutive ticks, every one by *running* a path rather than
trusting a green suite — including three in code written the same day, and one that reproduced the
exact defect it was fixing. The tests verified units that had never been wired together.

`recordOutcome` was written and never called. `MODE.ANONYMISED` was documented, tested and
unreachable. An unfinished holding period was recorded as a completed 0% trade. The freshness
guard passed a panel dated four days in the future.

If you are about to trust this code because the suite is green, don't. Run the path.
