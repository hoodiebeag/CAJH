# studies/ — the evidence trail, not the working surface

Every module and script in here produced a result that is cited in `VERDICTS.md` or
`ROADMAP.md`. They are archived rather than deleted for one reason: **they are the only thing
that makes the published figures reproducible.** `HEADLINE-FIGURE-REPRODUCIBILITY-SPOTCHECK`
(2026-09-02) re-ran five of them and confirmed all five still reproduce at stated precision.
Delete these and 68 verdict rows become unverifiable assertions.

They are *not* part of the canonical pipeline, they are not maintained, and nothing at the
repository root imports them. Each carries its own assumptions, its own reporting shape, and its
own cost model — which is precisely the fragmentation the canonical pipeline exists to end.

**Do not add to this directory.** New work goes through the canonical pipeline at the root.
The correct use of this directory is: read one when you need to check where a published number
came from, or re-run one to confirm it still reproduces.

Tests here are kept green so the archive cannot rot silently, and that is the only maintenance
they receive.
