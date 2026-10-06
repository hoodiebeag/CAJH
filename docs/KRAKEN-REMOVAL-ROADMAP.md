# Roadmap: removing Kraken, completing IBKR

Written 2026-09-11 at the owner's request, to be followed when the project is ready for full IBKR
integration. **Nothing in it has been executed.** It is a plan and a set of preconditions, mapped
from the actual coupling in the repository rather than from an assumption about how it is wired.

---

## 0. Read this before starting: removal is not migration

**IBKR cannot replace Kraken for crypto.** IBKR offers roughly four CME crypto futures names; the
research universe is 29 Kraken spot pairs, and a cross-sectional book needs at least six to form a
3-a-side spread. Removing Kraken therefore does not move crypto to IBKR — it **ends crypto as an
asset class for this project**.

That may be the right call. Crypto momentum is closed, and the only venue that could trade it long
and short was never available anyway. But it is a strategic decision, not a cleanup, and it should
be made deliberately rather than discovered halfway through a refactor.

### Preconditions — do not start until all four hold

| # | Precondition | Status 2026-09-11 |
|---|---|---|
| 1 | A strategy has cleared the promotion gate on evidence | **NOT MET.** Four mechanisms closed. |
| 2 | IBKR market data entitlement active | **NOT MET.** No live quotes; delayed only, ~2.76h stale. |
| 3 | Shortability known for the traded universe | **NOT MET.** Unknown on all 128 symbols. |
| 4 | Owner has accepted losing crypto | **NOT ASKED.** |

Precondition 1 is the one that matters. Removing a working execution path to prepare for a strategy
that does not exist trades a real capability for a hypothetical one.

---

## 1. What is actually coupled

Mapped, not guessed. `kraken-api` has exactly **one** importer, which is the good news; the bad news
is what sits on top of it.

### Tier 1 — real code coupling

| File | Coupling |
|---|---|
| `trader.js` | The only `kraken-api` importer. REST wrapper, `PAIR_MAP`, order placement, `getHoldings`, fill confirmation. |
| `monitor.js` | Imports seven functions from `trader.js` by name (`monitor.js:6`). The live path. |
| `scanner.js` | Imports `trader.js`; uses `symbolToKrakenId`, Kraken minimum order size, Kraken rate-limit sleeps. |
| `commands.js` | Imports `trader.js`; uses `symbolToKrakenId`; Discord `!reconcile` copy names Kraken. |
| `storage.js` | Exports `symbolToKrakenId` (`storage.js:95`) and `PAIR_MAP`. |

### Tier 2 — calibrated constants (the dangerous tier)

`strategy.js:26-27`:
```
FEE_BUFFER_PCT = 0.018   // "~1.71% verified Kraken Tier 1 taker round trip" plus headroom
FEE_RATE       = 0.008   // per-side taker estimate, round trip ~1.6%
```

**These are not names to change, they are measurements to redo.** They set where the breakeven stop
sits and how P&L is reported net of fees, and `backtest.js` consumes both as defaults. US equity
commissions are an order of magnitude smaller than Kraken taker fees, so carrying 1.8% into an IBKR
book would push every breakeven stop far above where it belongs and silently change every exit.
Getting this wrong produces a system that runs, tests green, and trades incorrectly.

### Tier 3 — cosmetic

`backtest.js:16` (comment about Kraken's ~720-candle limit), `context.js:83` (system description
still calls CAJH "a long-only Kraken spot executor"). Harmless to code, misleading to a reader.

### Tier 4 — tests

Twelve test files reference `trader.js` or Kraken: `trader`, `brokers/kraken`, `brokers/ibkr`,
`scanner`, `api-resilience`, `money-path`, `paper`, `studies/cost-model`, `costs`, `monitor`,
`check-protected-logic`, `order-validation`.

---

## 2. Ordered phases

Each phase is independently verifiable and leaves the suite green. Do not begin the next until the
current one is committed and pushed.

### Phase 1 — wire `monitor.js` to the broker interface *(the only hard one)*
Replace the named `trader.js` import with an injected adapter satisfying `brokers/interface.md`.
`monitor.js` also needs `symbolToPair` (the Kraken name for `symbolToNativeId` — same function) and
`validateTrackedTrade`, which is venue-agnostic apart from its symbol check and belongs in shared
code rather than in either adapter.

**This touches `placeSell`, which is in `PROTECTED_PATTERNS`, so the pre-commit hook will block it.
That requires an explicit owner decision. Never create `.git/ALLOW_PROTECTED_EDIT`.**

Verify: the suite passes with `KrakenBroker` injected, and again with `IBKRBroker` injected.
Both must pass before anything is deleted — that is what proves the seam is real.

### Phase 2 — same treatment for `scanner.js` and `commands.js`
Mechanical once Phase 1 defines the pattern. Move `symbolToKrakenId` out of `storage.js` behind
`symbolToNativeId`.
Verify: no non-test file outside `brokers/` names Kraken.

### Phase 3 — re-measure the fee constants
Replace `FEE_BUFFER_PCT` and `FEE_RATE` with values sourced from the venue actually being traded,
and record the source in the comment as the current ones do. Re-run anything that consumed them,
because every backtest default changes.
Verify: `costs.mjs`/`costs.test.mjs` reflect the new basis, and the change in results is explained
rather than absorbed.

### Phase 4 — delete
Remove `trader.js`, `brokers/kraken.mjs`, `kraken-api` from `package.json`, and the Kraken tests.
Update `context.js:83` and `backtest.js:16`.
Verify: `npm test` green, `grep -ri kraken` clean outside `docs/archive/` and `studies/`.

### Phase 5 — re-verify against a live Gateway
Re-run `studies/scripts/ibkr-smoke.mjs` and `scripts/ibkr-universe-probe.mjs`. The IBKR adapter is
currently verified 4/4, but `placeBuy`/`placeSell` have **never** been exercised against a real
Gateway and must not be assumed working because the read path is.

---

## 3. What not to do

- **Do not delete `trader.js` before Phase 1 passes with both adapters injected.** It is the only
  proof the abstraction works.
- **Do not carry the Kraken fee constants across.** See Tier 2.
- **Do not treat mocked tests as verification of the IBKR path.** On 2026-09-11 a live Gateway found
  that `brokers/ibkr.test.mjs` emitted `@stoqey/ib`'s error events with the arguments backwards; the
  adapter was written to match the mock, every TWS error classified as a fatal socket failure, and
  27 green tests certified it for weeks. A mock is evidence only if it emits what the real library
  emits.
- **Do not remove Kraken to "tidy up" while precondition 1 is unmet.** There is currently no strategy
  to trade on either venue.
