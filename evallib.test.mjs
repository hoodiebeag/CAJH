import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_SCHEMA, REQUIRED_TRADE_FIELDS, COST_RECONCILE_TOLERANCE,
  makeTradeRecord, utcDayKey, validateTradeRecord, validateTradePopulation,
  percentile, maxDrawdownR, summarize, summarizeTrades,
} from "./evallib.mjs";

const BASE = {
  symbol: "BTC", timeframe: "4h",
  entryTime: "2024-03-01T00:00:00Z", exitTime: "2024-03-01T12:00:00Z",
  entryPrice: 100, exitPrice: 110, risk: 5,
  grossR: 2,
};

// ---------- schema validity ----------

test("makeTradeRecord stamps the schema and carries every required field", () => {
  const rec = makeTradeRecord(BASE);
  assert.equal(rec.schema, TRADE_SCHEMA);
  for (const f of REQUIRED_TRADE_FIELDS) assert.ok(f in rec, `missing ${f}`);
  assert.equal(validateTradeRecord(rec).ok, true);
});

test("makeTradeRecord returns a frozen record so a study cannot mutate its own evidence", () => {
  const rec = makeTradeRecord(BASE);
  assert.throws(() => { "use strict"; rec.netR = 99; }, TypeError);
});

test("a record built by hand with the wrong schema string fails validation", () => {
  const rec = { ...makeTradeRecord(BASE), schema: "cajh-trade/v0" };
  const { ok, errors } = validateTradeRecord(rec);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes(TRADE_SCHEMA)));
});

test("validateTradeRecord rejects non-objects rather than throwing", () => {
  for (const bad of [null, undefined, 7, "trade"]) {
    assert.equal(validateTradeRecord(bad).ok, false);
  }
});

// ---------- cost arithmetic ----------

test("feeR and slippageR are charged on (entry + exit) / risk, each on its own rate", () => {
  const rec = makeTradeRecord({ ...BASE, feeRate: 0.008, slipPct: 0.0005 });
  assert.equal(rec.feeR, (0.008 * (100 + 110)) / 5);
  assert.equal(rec.slippageR, (0.0005 * (100 + 110)) / 5);
});

test("the split reproduces backtest.js's combined cost term exactly", () => {
  // backtest.js: r = grossR - ((feeRate + slipPct) * (entry + exitPx)) / risk
  const feeRate = 0.008, slipPct = 0.0005;
  for (const [entry, exitPrice, risk, grossR] of [
    [100, 110, 5, 2], [43120.5, 41880.25, 980.4, -1], [3.14159, 2.71828, 0.5, 0.83],
  ]) {
    const rec = makeTradeRecord({ ...BASE, entryPrice: entry, exitPrice, risk, grossR, feeRate, slipPct });
    const combined = grossR - ((feeRate + slipPct) * (entry + exitPrice)) / risk;
    assert.ok(Math.abs(rec.netR - combined) <= COST_RECONCILE_TOLERANCE,
      `netR ${rec.netR} vs backtest.js ${combined}`);
  }
});

test("zero rates leave netR equal to grossR — no cost is charged twice or by default", () => {
  const rec = makeTradeRecord(BASE);
  assert.equal(rec.feeR, 0);
  assert.equal(rec.slippageR, 0);
  assert.equal(rec.netR, rec.grossR);
});

test("cost is charged on notional, so it scales with price and inversely with risk", () => {
  const tight = makeTradeRecord({ ...BASE, risk: 1, feeRate: 0.008 });
  const wide = makeTradeRecord({ ...BASE, risk: 10, feeRate: 0.008 });
  assert.ok(tight.feeR > wide.feeR);
  assert.ok(Math.abs(tight.feeR - wide.feeR * 10) < 1e-12);
});

test("validation catches a record whose netR does not reconcile with its components", () => {
  const rec = { ...makeTradeRecord({ ...BASE, feeRate: 0.008 }) , netR: 1.5 };
  const { ok, errors } = validateTradeRecord(rec);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith("cost identity violated")));
});

test("reconciliation tolerates float noise but not a real discrepancy", () => {
  const rec = makeTradeRecord({ ...BASE, feeRate: 0.008, slipPct: 0.0005 });
  assert.equal(validateTradeRecord({ ...rec, netR: rec.netR + 1e-12 }).ok, true);
  assert.equal(validateTradeRecord({ ...rec, netR: rec.netR + 1e-6 }).ok, false);
});

// ---------- missing / malformed fields ----------

test("makeTradeRecord refuses the inputs that would silently produce garbage R", () => {
  const cases = [
    [{ symbol: "" }, /symbol/],
    [{ timeframe: "" }, /timeframe/],
    [{ risk: 0 }, /risk/],
    [{ risk: -1 }, /risk/],
    [{ risk: NaN }, /risk/],
    [{ grossR: NaN }, /grossR/],
    [{ entryPrice: Infinity }, /entryPrice/],
    [{ feeRate: -0.001 }, /feeRate/],
    [{ slipPct: -0.001 }, /slipPct/],
    [{ entryTime: "not a date" }, /entryTime/],
    [{ exitTime: "2024-02-01T00:00:00Z" }, /precedes/],
  ];
  for (const [patch, re] of cases) {
    assert.throws(() => makeTradeRecord({ ...BASE, ...patch }), re, JSON.stringify(patch));
  }
});

test("validateTradeRecord names every missing field, not just the first", () => {
  const rec = makeTradeRecord(BASE);
  const stripped = { ...rec };
  delete stripped.mae;
  delete stripped.exposureId;
  delete stripped.blockId;
  const { ok, errors } = validateTradeRecord(stripped);
  assert.equal(ok, false);
  for (const f of ["mae", "exposureId", "blockId"]) {
    assert.ok(errors.includes(`missing field: ${f}`), `did not report ${f}`);
  }
});

test("validateTradeRecord rejects impossible values that are present but wrong", () => {
  const rec = makeTradeRecord(BASE);
  assert.ok(validateTradeRecord({ ...rec, risk: -1 }).errors.includes("risk must be positive"));
  assert.ok(validateTradeRecord({ ...rec, feeR: -0.1, netR: rec.grossR + 0.1 }).errors
    .includes("feeR must be non-negative"));
  assert.ok(validateTradeRecord({ ...rec, holdingMs: -1 }).errors.includes("holdingMs must be non-negative"));
  assert.ok(validateTradeRecord({ ...rec, grossR: "2" }).errors.includes("grossR must be a finite number"));
});

test("validateTradePopulation reports every bad record with its index", () => {
  const good = makeTradeRecord(BASE);
  const bad = { ...good, netR: 99 };
  const res = validateTradePopulation([good, bad, good, bad]);
  assert.equal(res.ok, false);
  assert.equal(res.checked, 4);
  assert.deepEqual(res.failures.map((f) => f.index), [1, 3]);
});

test("an all-good population validates clean", () => {
  const pop = [1, 2, 3].map((i) => makeTradeRecord({ ...BASE, grossR: i, feeRate: 0.008 }));
  assert.deepEqual(validateTradePopulation(pop), { ok: true, checked: 3, failures: [] });
});

// ---------- timestamps and clustering identifiers ----------

test("entryTime accepts Date, seconds, milliseconds, and ISO strings identically", () => {
  const ms = Date.parse("2024-03-01T00:00:00Z");
  const forms = [new Date(ms), ms, ms / 1000, "2024-03-01T00:00:00Z"];
  for (const t of forms) {
    assert.equal(makeTradeRecord({ ...BASE, entryTime: t }).entryTime, ms);
  }
});

test("holdingMs is the exit-minus-entry span and can be zero", () => {
  assert.equal(makeTradeRecord(BASE).holdingMs, 12 * 3600 * 1000);
  assert.equal(makeTradeRecord({ ...BASE, exitTime: BASE.entryTime }).holdingMs, 0);
});

test("utcDayKey is the UTC calendar day, not the local one", () => {
  assert.equal(utcDayKey(Date.parse("2024-03-01T23:59:59Z")), "2024-03-01");
  assert.equal(utcDayKey(Date.parse("2024-03-02T00:00:00Z")), "2024-03-02");
});

test("exposureId defaults to the UTC entry day and blockId to symbol:day", () => {
  const rec = makeTradeRecord(BASE);
  assert.equal(rec.exposureId, "2024-03-01");
  assert.equal(rec.blockId, "BTC:2024-03-01");
});

test("an explicit exposureId overrides the day default, for intraday clustering", () => {
  const rec = makeTradeRecord({ ...BASE, exposureId: "2024-03-01T04", blockId: "BTC:bar-9" });
  assert.equal(rec.exposureId, "2024-03-01T04");
  assert.equal(rec.blockId, "BTC:bar-9");
});

// ---------- summary calculations ----------

test("percentile interpolates linearly and handles degenerate arrays", () => {
  const s = [1, 2, 3, 4];
  assert.equal(percentile(s, 0), 1);
  assert.equal(percentile(s, 1), 4);
  assert.equal(percentile(s, 0.5), 2.5);
  assert.equal(percentile([5], 0.5), 5);
  assert.equal(percentile([], 0.5), 0);
});

test("summarize reports mean, median, spread, and counts over a known series", () => {
  const s = summarize([-1, -1, 2, 2, 3]);
  assert.equal(s.n, 5);
  assert.equal(s.dropped, 0);
  assert.equal(s.mean, 1);
  assert.equal(s.median, 2);
  assert.equal(s.min, -1);
  assert.equal(s.max, 3);
  assert.equal(s.total, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);
  assert.equal(s.scratches, 0);
  assert.equal(s.winRate, 3 / 5);
  assert.ok(Math.abs(s.sd - Math.sqrt(((-2) ** 2 + (-2) ** 2 + 1 + 1 + 4) / 4)) < 1e-12);
  assert.ok(Math.abs(s.ci95 - 1.96 * s.se) < 1e-12);
  assert.ok(Math.abs(s.hi95 - s.lo95 - 2 * s.ci95) < 1e-12);
});

test("summarize counts scratches separately — a zero-R trade is neither win nor loss", () => {
  const s = summarize([0, 0, 1, -1]);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.scratches, 2);
  assert.equal(s.winRate, 0.25);
});

test("summarize drops non-finite values and says how many it dropped", () => {
  const s = summarize([1, NaN, 2, Infinity, 3, null]);
  assert.equal(s.n, 3);
  assert.equal(s.dropped, 3);
  assert.equal(s.mean, 2);
});

test("summarize on an empty array returns zeros rather than NaN", () => {
  const s = summarize([]);
  for (const k of ["n", "mean", "median", "sd", "se", "min", "max", "total", "maxDrawdownR", "winRate"]) {
    assert.equal(s[k], 0, `${k} was ${s[k]}`);
  }
});

test("maxDrawdownR is the worst peak-to-trough of the cumulative R curve, in R", () => {
  assert.equal(maxDrawdownR([1, 1, -3, 1]), 3);
  assert.equal(maxDrawdownR([1, 2, 3]), 0);
  assert.equal(maxDrawdownR([]), 0);
  // A losing series drawdowns from a zero peak — never a percent of a near-zero base.
  assert.equal(maxDrawdownR([-1, -1, -1]), 3);
});

test("summarizeTrades separates gross from net and totals each cost component", () => {
  const recs = [1, -1, 2].map((grossR, i) => makeTradeRecord({
    ...BASE, grossR, feeRate: 0.008, slipPct: 0.0005,
    entryTime: `2024-03-0${i + 1}T00:00:00Z`, exitTime: `2024-03-0${i + 1}T06:00:00Z`,
  }));
  const s = summarizeTrades(recs);
  const feePer = (0.008 * 210) / 5, slipPer = (0.0005 * 210) / 5;
  assert.equal(s.gross.mean, 2 / 3);
  assert.ok(Math.abs(s.net.mean - (2 / 3 - feePer - slipPer)) < 1e-12);
  assert.ok(Math.abs(s.feeRTotal - 3 * feePer) < 1e-12);
  assert.ok(Math.abs(s.slippageRTotal - 3 * slipPer) < 1e-12);
  assert.ok(Math.abs(s.feeRMean - feePer) < 1e-12);
  assert.ok(Math.abs(s.slippageRMean - slipPer) < 1e-12);
});

test("effectiveN collapses same-day trades — the defect DATE-CLUSTERED-RESAMPLING-AUDIT found", () => {
  const sameDay = ["BTC", "ETH", "SOL", "ADA"].map((symbol) => makeTradeRecord({ ...BASE, symbol }));
  const s = summarizeTrades(sameDay);
  assert.equal(s.nominalN, 4);
  assert.equal(s.effectiveN, 1);
  assert.equal(s.effectiveRatio, 0.25);
  assert.equal(s.distinctBlocks, 4);
  assert.equal(s.symbols, 4);
});

test("trades on distinct days are fully independent by this measure", () => {
  const spread = [1, 2, 3, 4].map((d) => makeTradeRecord({
    ...BASE,
    entryTime: `2024-03-0${d}T00:00:00Z`, exitTime: `2024-03-0${d}T06:00:00Z`,
  }));
  const s = summarizeTrades(spread);
  assert.equal(s.effectiveN, 4);
  assert.equal(s.effectiveRatio, 1);
});

test("summarizeTrades on an empty population is zeroed, not NaN", () => {
  const s = summarizeTrades([]);
  assert.equal(s.nominalN, 0);
  assert.equal(s.effectiveN, 0);
  assert.equal(s.effectiveRatio, 0);
  assert.equal(s.feeRMean, 0);
  assert.equal(s.net.mean, 0);
});
