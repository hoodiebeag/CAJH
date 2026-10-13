# The paper run: what it is a test of

**Pre-registered 2026-09-24, before any paper decision has been made.** That timing is the point.
Once a track record exists it is too late to ask what would count as success, because whatever
happened becomes the thing that gets defended. This project has closed sixteen mechanisms using
exactly this discipline and it applies to the analyst too.

The owner's plan: roughly one month of paper, about 20 trading days, then decide about live money.
The month is worth running. What follows is what it can and cannot establish, measured rather
than asserted, so the decision at the end is made on the right evidence.

## The arithmetic, measured off the real panel

The quantity under test is not the return. It is the **paired difference** between what the
analyst picked and the matched random control drawn from the same slate at the same instant —
`journal.mjs` records that control precisely so this comparison exists. A book returning +8% while
a coin flip from the same slate returns +9% has produced nothing.

The independent unit is **not the trade**. Twenty trading days of daily decisions on a five-day
hold looks like a hundred trades; it is four non-overlapping observations. The holds overlap, every
name in a batch shares one market, and a single bad week contaminates every decision inside it.
Counting trades instead of periods overstates the evidence by roughly an order of magnitude, in
the flattering direction.

Simulating the null by drawing two random books per period from the real panel (`paper-power.mjs`,
20,000 draws, book of 10):

| Run length | Independent periods | Smallest edge it can resolve |
|---|---|---|
| **20 trading days** | **4** | **3.4% per period — ~170% annualised** |
| 60 trading days | 12 | 2.0% per period — ~98% annualised |
| 6 months | 26 | 1.3% per period — ~67% annualised |
| 1 year | 50 | 1.0% per period — ~48% annualised |

Read the top row plainly: **a month of paper can only detect an edge so large that seeing it
should make you suspect the measurement, not celebrate.** And the bottom row matters just as much —
even a full year only resolves edges around 48% annualised. Real edges are far smaller than that.

Shortening the hold does not help. Twenty days at a one-day hold gives twenty periods instead of
four, but per-period noise falls by the same square root, and the annualised detectable edge stays
at ~157% while cost drag rises from 1.3%/yr to 27.7%/yr. Derived, then measured; the lever is
closed.

**Conclusion, stated before any number exists: no practical paper period will prove edge.** The
decision to risk real money will therefore be made on something other than statistical proof. That
is not an argument against making it. It is an argument for making it consciously, knowing which
question the evidence answered and which it did not.

## What the month CAN establish — Tier 1, operational

Every one of these is answerable in 20 days, and every one is a real reason to run it. These are
the pre-registered pass criteria.

| # | Criterion | Pass |
|---|---|---|
| 1 | Runs every session without hand-holding | ≥ 18 of 20 sessions produce a journalled batch |
| 2 | Point-in-time integrity holds live | **zero** `context_not_point_in_time` skips |
| 3 | Panel freshness never silently degrades | zero paper batches on a stale or future-dated panel |
| 4 | Model output stays parseable | < 10% of batches lost to refusal, truncation or malformed JSON |
| 5 | The risk gate is load-bearing, not decorative | rejections occur, and every code is one we can explain |
| 6 | No proposal reaches the book that the gate should have caught | manual review of all allowed positions, zero escapes |
| 7 | Settlement is complete and idempotent | settled outcomes = sized decisions past their hold; re-running `settle` writes nothing |
| 8 | News actually reaches decisions | ≥ 60% of sized decisions carry `hadNews: true` |
| 9 | Theses are reviewable by a human | spot-check 20 theses: each states a reason that could be wrong |
| 10 | Nothing halts for a reason we did not anticipate | any halt or brake has an explanation in the journal |

`node analyst-run.mjs protocol` computes this table from the journal. Seven of the ten are answered
from the record; 6, 9 and 10 report MANUAL rather than substituting a proxy, because a check that
decided whether the gate was right would just be the gate again and would agree with itself.
Criterion 2's pass has a narrower meaning than it looks, and the readout says so in place.

**A failure in 2, 3, 6 or 7 stops the run.** Those are integrity failures, not performance ones,
and continuing past them produces a record that means nothing. The others are reported and judged.

## What the month CANNOT establish — Tier 2

- Whether the analyst has edge. See the table. Four periods cannot answer it.
- Whether news carries the edge. The `newsSplit` readout needs 20+ outcomes in **each** arm; a
  month will not reach that, and the readout will say NOT YET COMPARABLE rather than print a
  comparison.
- Whether the strategy survives a regime it has not seen. Twenty days is one regime.
- Whether the 15% drawdown brake is compatible with a months-long turnaround thesis. That needs a
  thesis to actually run its course.

## The number to look at, and the one to ignore

At the end of the month `analyst-run.mjs score` will print a return. **It is not the result.** The
result is the edge over the matched control, with its period count beside it — and at n=4 that
edge has a confidence interval wide enough to contain almost anything.

If the month produces a big positive number, the correct reading is "the plumbing works and we
learned nothing about edge." If it produces a big negative number, same reading. Only an
operational failure from Tier 1 is genuinely informative at this length.

## On going live afterwards

`LIVE_TRADING` stays off. The promotion path is D1 → D2 → D3, paper is D2, and D3 requires
explicit human sign-off — a document in this repository is not a human at that gate, and neither
is this one.

What this protocol changes is what that sign-off would mean. It cannot mean "the numbers proved
it," because the arithmetic above says the numbers cannot. It can honestly mean: the system ran
clean for a month, the risk envelope held, the reasoning was reviewable, and the owner chose to
risk capital on an unproven edge with a known downside. That is a legitimate decision. It is just a
different one from the decision the word "proved" would describe, and the difference should be
visible at the moment it is made rather than reconstructed afterwards.

If the goal is to reduce that uncertainty rather than accept it, the lever is time, not cleverness:
six months gets the detectable edge to ~67% annualised, a year to ~48%. Neither is small. That is
the honest shape of the problem.
