# CAJH

A discretionary trading analyst. It reads indicators, news and price action for a universe of
around a thousand names, decides its own positions inside a deterministic risk envelope, and
writes down why — before it knows whether it was right.

It is not a strategy. Sixteen mechanical strategies were tested here and every one of them lost
to a coin flip drawing from the same slate. `docs/WHAT-WE-KNOW.md` is the six-page residue of
that programme and is the first thing to read; it exists so the same ground is not re-walked.

## Run it

Everything that talks to a broker runs on a machine that can reach IB Gateway, which is not this
container. One command does the whole cycle and ends with the push, because the push is the step
that keeps getting dropped:

```
bash scripts/refresh.sh          # pull, collect, fetch the panel, commit, push
bash scripts/refresh.sh collect  # just entitlements, sectors and news  (~3 min)
bash scripts/refresh.sh panel    # just the price panel                 (hours, resumable)
```

Then, anywhere:

```
node analyst-run.mjs paper        # one forward decision. The only mode that is evidence.
node analyst-run.mjs settle       # score decisions whose holding period has finished
node analyst-run.mjs score        # the readout: the analyst beside its own random control
node analyst-run.mjs dry-run --stub   # exercise the wiring on a past date. NOT evidence.
node analyst-run.mjs anonymised       # reasoning probe, identities stripped. NOT evidence.
```

`paper` refuses to run on a stale or future-dated panel. That refusal is the measurement
instrument, not an obstacle — see below.

## The one thing that must not be forgotten

**This agent cannot be backtested.** Not "it is hard": the evaluation is structurally invalid. A
model asked what it would do on a historical date already knows what happened, because market
history is in its weights, and no holdout split removes that — the contamination is in the
decider, not the pipeline. It fails in the flattering direction, exactly where the pull to deploy
is strongest.

Forward paper trading is therefore the only measurement that means anything, and
`docs/PAPER-PROTOCOL.md` shows what it can and cannot establish. The short version, measured off
the real panel: **a month of paper resolves only an edge around 170% annualised**, so it can
confirm the system runs correctly and can tell you almost nothing about whether it works. Even a
full year only reaches ~48%.

Read that before treating any number from this system as a result.

## What is here

```
analyst/       risk.mjs      deterministic veto layer — no model, no I/O, pure
               journal.mjs   append-only record; draws the matched random control at decision time
               context.mjs   point-in-time by construction, plus a test of that claim
               decide.mjs    the model call; its output is treated as untrusted input
               loop.mjs      the wiring, and the guard that refuses a stale panel
               news.mjs      IBKR headlines, broker-timestamped
analyst-run.mjs              the command line above
indicators.mjs               fourteen signals. Inputs, not a strategy: nothing ranks or sizes.
universe.mjs bundle-loader.mjs costs.mjs inference.mjs      panel, screening, costs, statistics
paper-power.mjs              how long the paper run has to be. Cited by the protocol.
scripts/                     IBKR collectors, refresh.sh, the protected-logic check
bot.js commands.js ...       the Discord bot, deployed. Trading and comms only.
brokers/                     PROTECTED. Live-trading logic. Do not edit.
```

- **Live environment controls:** `LIVE_TRADING=true` and an explicit, writable
  `DATA_DIR` are both required before `!resume` can enable orders. Backtests/research
  can run with `DATA_DIR` unset, but live trading cannot: open positions, halt state,
  stats, config, and structural-level cooldowns must survive restart/redeploy.

## Autonomous trading

**cajh boots halted.** Autonomous trading only runs when `LIVE_TRADING=true` is set in
the environment; otherwise scans, charts, and research work normally but no orders are
placed. This default exists because the current strategy backtests net-negative — see
"Does it work?" below. `!resume` only enables trading when `LIVE_TRADING=true`, monitor
health is good, and storage preflight proves `DATA_DIR` is explicit and writable.

## Does it work?

No, and that is the most useful thing this repository knows. Sixteen mechanisms were tested and
every one lost to a coin flip drawing from the same slate; the best of them was *worse* than
random on losing names. `docs/WHAT-WE-KNOW.md` has the numbers and the traps that made a dead
strategy look alive. Whether the analyst does better is unknown and, per
`docs/PAPER-PROTOCOL.md`, will stay largely unknown for a long time.

## Hard limits

- **No live order in any asset class** without D1 → D2 → D3 and explicit human sign-off at D3
  (`SELF_AWARENESS_SPEC.md`). A document in this repository is not a human at that gate, and
  neither is an agent.
- **Never create the protected-edit override marker.** If the pre-commit check blocks a change,
  that is the system working: exclude the offending file, or stop and report. The same check runs
  in CI on every pushed commit, where it cannot be skipped. Wire it locally with
  `git config core.hooksPath .githooks`.
- **An asset class trades only with a verified cost model and verified executability.** See
  `CLASS_STATUS` in `analyst/risk.mjs`. Shorting is unavailable: IBKR returned shortability
  unknown on 128 of 128 symbols.
- **Screen the universe before ranking anything.** One corrupted series with a 107,453× close
  range was reliably selected by a liquidity screen and carried a whole result.

## How to not fool yourself here

The green suite is not evidence the path works. Seven defects were found in seven days — an
unfinished holding period recorded as a completed 0% trade, a freshness guard that passed a panel
dated four days in the future, a mode that was documented, tested and unreachable — and every one
was found by **running the path**, not by testing it. The suite was green throughout.

So: run it. Then look at what it actually did.
