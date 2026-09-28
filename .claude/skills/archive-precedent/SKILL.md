---
name: archive-precedent
description: Before proposing ANY trading hypothesis, strategy variant, cost or parameter retest,
  or "new idea" for CAJH, search the closed-research archive for prior verdicts on the same
  mechanism. Returns verbatim rows with provenance, or an auditable negative finding. Read-only.
when_to_use: Invoke before any message that proposes a hypothesis to test, reopens a closed
  mechanism, recommends a research direction, or asserts what this project already knows.
allowed-tools: Grep Read Glob
disallowed-tools: Write, Edit, NotebookEdit
---

# Archive precedent check

## What this skill is and is not permitted to do — read this first

**This skill is not technically read-only, and an earlier version of this file wrongly claimed it
was.** Two things were wrong:

1. `Bash(git show *)` was pre-approved as "read-only". It is not. `git show --output=<file>` writes —
   verified here, 6141 bytes to an arbitrary path — and pattern-matching a git subcommand prefix
   cannot bound the options that follow it. All `Bash(...)` pre-approvals have been removed.
2. `disallowed-tools: Write, Edit, NotebookEdit` removes those three tools. **It does not restrict
   Bash**, so it never made this skill read-only, and it must not be cited as if it did.

What is true now: `allowed-tools` pre-approves only `Grep`, `Read` and `Glob`, which cannot write.
Bash remains *callable* — `allowed-tools` never restricted anything — but it is **not pre-approved**,
so every command runs through normal review. This skill therefore *prescribes* read-only operations
and *relies on approval* for the one step that needs a command.

Division of labour that follows from that:

- **In-tree sources need no Bash at all.** `Grep`, `Read` and `Glob` cover all six of them. Prefer the
  `archive-sweep` agent (`tools: Read, Grep, Glob`, no Bash, a hard allowlist) for wide sweeps — that
  one *is* structurally restricted.
- **History-only sources need a command, so flag them and let them be approved individually.** State
  which file you need and why. Do not batch them into one invocation to reduce prompts; each read is
  a reviewed action.


`docs/WHAT-WE-KNOW.md` is 8.6K standing in for ~1.3MB of archive, and it demonstrably drops
material qualifications — it asserts that every closed mechanism was "a transform of the same
OHLCV panel" when the archive records GDELT, funding, on-chain, open interest, futures basis and
order-flow studies, and it says "sixteen mechanisms" where the index carries 76 rows.

Reasoning from the summary instead of the archive produced three duplicate proposals in one week:
a hold-length retest already run as `HOLDING-PERIOD-COST-AMORTIZATION-MAP`, a cost-threshold
question already answered in closed form by `PER-FAMILY-COST-CEILING`, and a programme-level
multiple-comparisons audit already written as `MULTIPLE_COMPARISONS_AUDIT.md`.

**Search the archive. Not the summary.**

## Sources

IN-TREE — grep directly:

| path | lines |
|---|---|
| `docs/archive/ROADMAP.md` | 4719 |
| `docs/archive/TOURNAMENT_ROADMAP.md` | 2427 |
| `docs/archive/AGENT_PROTOCOL.md` | 766 |
| `docs/archive/ARCHITECT_DIRECTIVE.md` | 292 |
| `docs/archive/AGENT_RUNBOOK.md` | 178 |
| `docs/archive/agent_state_final.json` | 1285 |

HISTORY-ONLY — deleted from the tree; read with `git show 5116866^:<path>`:

| path | lines | what it holds |
|---|---|---|
| `VERDICTS.md` | 99 | the verdict index, 76 rows |
| `docs/archive/VERDICTS_DETAIL.md` | 677 | registered claims, deciding metrics, commits |
| `MULTIPLE_COMPARISONS_AUDIT.md` | — | programme-level FDR; the alpha budget |

All line counts in this file are `wc -l`. `agent_state_final.json` has no trailing newline, so a
line-counting tool that counts final partial lines reports 1286 where `wc -l` reports 1285. Compare
like with like, or the integrity check cries wolf on every run.

**Verify the anchor before trusting any negative.** `git rev-parse 5116866^` must succeed and each
`git show` must return a non-empty file of at least the line count above. If an anchor fails to
resolve, or a file comes back shorter than its recorded length, **STOP and report the failure**.
A failed or truncated read is not a negative finding, and reporting it as one is the single worst
thing this skill can do.

## A gap in the archive itself, found by testing this skill

Several closed studies say their section was "moved to `ROADMAP_ARCHIVE.md`" — among them
`HOLDING-PERIOD-COST-AMORTIZATION-MAP` and `COST-SENSITIVITY-SURFACE`. **That file was never
committed.** `git rev-list --all -- ROADMAP_ARCHIVE.md` returns nothing, so it exists in no commit
and no ref. For those studies the one-line index summary in `ROADMAP.md` is the only surviving
evidence anywhere.

So a reference is not a source. When a hit points at `ROADMAP_ARCHIVE.md`, report the index line
verbatim and state that the primary section is unrecoverable — do not imply a fuller record exists
to be consulted, and do not treat the summary as if it carried the detail.

## Procedure

1. Restate the proposal as a mechanism, in one line.
2. **Build a synonym set of at least four terms before searching.** The archive exists because one
   signal was proposed under three different names. A single-term search is not a search. Include:
   - the mechanism name as proposed
   - its input (funding, on-chain, sentiment, open interest, basis, order flow, price)
   - its family (`breakout`, `anticipate`, `reversal`, `momentum`, `carry`, `low-vol`)
   - the parameter being varied (hold, cost, fee, slip, threshold, lookback, rebalance)
3. Search every source for every term.
4. Read `MULTIPLE_COMPARISONS_AUDIT.md` for the current family size. **Any new formal test tightens
   every BH-FDR threshold and can retro-kill an existing survivor** — this already happened once,
   when adding GDELT moved `EQUITIES-MADIP-OUT-OF-SAMPLE` from q=0.0493 to q=0.0522. If the
   proposal would add a formal test, say so and name the cost.

## Output contract

Header, always:

```
archive anchor: 5116866^   (verified: yes/no)
in-tree tree:   <output of: git rev-parse HEAD:docs/archive>
terms searched: <the full synonym set, verbatim>
files searched: <every file, with its line count as actually read>
```

Per hit:

```
<file>:<line>   <VERDICT>   n=<n>   <date>
> <verbatim excerpt, at most 2 lines, NEVER paraphrased>
```

**Bounded.** Report at most 40 hits, but always print the total match count so truncation is
visible. Never cut silently.

**Negative finding.** Print exactly:

```
NO PRECEDENT FOUND for: <mechanism>
terms searched: <full set>
files searched: <all, with line counts>
anchor verified: yes
```

A negative is a claim about coverage, so it must be auditable. Never report one from an unverified
anchor, a truncated read, a partial file list, or a single-term search.

## What this skill must not do

- Recommend reopening anything. It reports; the decision belongs to the reader.
- Paraphrase a verdict, an n, or a deciding metric. Quote or stay silent.
- Suppress a hit because it contradicts the proposal. Those are the hits that matter.
