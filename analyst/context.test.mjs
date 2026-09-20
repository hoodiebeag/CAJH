import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, anonymiseContext, contextIsPointInTime, DEFAULT_INDICATORS } from "./context.mjs";

const DAY = 86400;
const T0 = Date.UTC(2024, 0, 1) / 1000;

/** A synthetic panel: `n` bars per symbol, each symbol drifting at its own rate. */
function panel(symbols, n = 400) {
  const series = {}, dates = [];
  for (let i = 0; i < n; i++) dates.push(T0 + i * DAY);
  symbols.forEach((sym, k) => {
    const bars = [];
    let px = 100;
    for (let i = 0; i < n; i++) {
      px *= 1 + (k - symbols.length / 2) * 0.0004 + Math.sin(i / 7 + k) * 0.002;
      bars.push({ time: dates[i], open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 1e6 + i });
    }
    series[sym] = bars;
  });
  return { series, dates };
}

const SYMS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"];

// ---- point-in-time, the property the whole file exists for ------------------------------------

test("no bar after the decision boundary reaches the context", () => {
  const { series, dates } = panel(SYMS);
  const asOf = 300;
  // Poison every series after the boundary with an unmistakable spike. If any of it leaks into an
  // indicator, the values at asOf would differ from a panel that was physically truncated.
  const poisoned = {};
  for (const [s, bars] of Object.entries(series)) {
    poisoned[s] = bars.map((b, i) => (i > asOf ? { ...b, close: b.close * 1000, volume: 9e12 } : b));
  }
  const clean = buildContext({ series, dates, asOf });
  const dirty = buildContext({ series: poisoned, dates, asOf });
  assert.deepEqual(dirty.candidates, clean.candidates);
  assert.deepEqual(dirty.market, clean.market);
});

test("news dated after the boundary is dropped", () => {
  const { series, dates } = panel(SYMS);
  const asOf = 300;
  const after = new Date((dates[asOf] + 5 * DAY) * 1000).toISOString();
  const before = new Date((dates[asOf] - 2 * DAY) * 1000).toISOString();
  const ctx = buildContext({
    series, dates, asOf,
    news: { AAA: [{ at: after, headline: "the answer" }, { at: before, headline: "legitimate" }] },
  });
  const aaa = ctx.candidates.find((c) => c.symbol === "AAA");
  assert.equal(aaa.news.length, 1);
  assert.equal(aaa.news[0].headline, "legitimate");
});

test("the point-in-time checker catches a leak rather than trusting the construction", () => {
  const { series, dates } = panel(SYMS);
  const asOf = 300;
  const ctx = buildContext({ series, dates, asOf });
  assert.deepEqual(contextIsPointInTime(ctx, dates[asOf]), []);

  // Hand-plant a violation the builder would never produce, to prove the checker is not vacuous.
  ctx.candidates[0].news = [{ at: new Date((dates[asOf] + DAY) * 1000).toISOString(), headline: "leak" }];
  assert.equal(contextIsPointInTime(ctx, dates[asOf]).length, 1);
});

test("an asOf beyond the panel is an error, not a clamp", () => {
  const { series, dates } = panel(SYMS, 100);
  assert.throws(() => buildContext({ series, dates, asOf: 100 }), /beyond the panel/);
  assert.throws(() => buildContext({ series, dates, asOf: -1 }), /non-negative/);
});

// ---- the slate is a budget --------------------------------------------------------------------

test("held positions are always shown regardless of rank", () => {
  // An analyst that cannot see its own book cannot manage it.
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({
    series, dates, asOf: 300, slate: 2,
    positions: { HHH: { pct: 0.05, avgPrice: 90, sector: "Energy" } },
  });
  const shown = ctx.candidates.map((c) => c.symbol);
  assert.ok(shown.includes("HHH"));
  assert.equal(ctx.candidates.find((c) => c.symbol === "HHH").held, true);
});

test("the slate shows both ends of the ranking, not only the top", () => {
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({ series, dates, asOf: 300, slate: 4, rankBy: "momentum" });
  const moms = ctx.candidates.map((c) => c.indicators.momentum).filter((v) => v !== null);
  assert.ok(Math.max(...moms) > Math.min(...moms), "slate should span the cross-section");
  assert.ok(ctx.candidates.length <= SYMS.length);
});

test("the context records what it is not showing", () => {
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({ series, dates, asOf: 300, slate: 2 });
  assert.equal(ctx.universe.total, SYMS.length);
  assert.equal(ctx.universe.omitted, ctx.universe.total - ctx.universe.shown);
  assert.equal(ctx.universe.rankedBy, "momentum");
});

test("no candidate appears twice", () => {
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({
    series, dates, asOf: 300, slate: 8,
    positions: { AAA: { pct: 0.05 }, HHH: { pct: 0.05 } },
  });
  const syms = ctx.candidates.map((c) => c.symbol);
  assert.equal(new Set(syms).size, syms.length);
});

// ---- content ------------------------------------------------------------------------------------

test("every requested indicator appears, null when undefined rather than missing", () => {
  const { series, dates } = panel(SYMS, 60);   // too short for 252-day signals
  const ctx = buildContext({ series, dates, asOf: 50 });
  for (const c of ctx.candidates) {
    for (const name of DEFAULT_INDICATORS) {
      assert.ok(name in c.indicators, `${name} missing for ${c.symbol}`);
    }
    assert.equal(c.indicators.momentum, null, "a 252-day signal cannot exist at bar 50");
  }
});

test("an unknown indicator is an error rather than a silent omission", () => {
  const { series, dates } = panel(SYMS);
  assert.throws(() => buildContext({ series, dates, asOf: 300, indicators: ["notAnIndicator"] }), /unknown indicator/);
});

test("unrealised P&L is reported for held names", () => {
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({
    series, dates, asOf: 300,
    positions: { AAA: { pct: 0.05, avgPrice: 1 } },
  });
  const aaa = ctx.candidates.find((c) => c.symbol === "AAA");
  assert.ok(typeof aaa.unrealisedPct === "number");
  assert.ok(aaa.unrealisedPct > 0, "avgPrice of 1 against a ~100 price is a large gain");
});

test("market summary reports breadth and dispersion", () => {
  const { series, dates } = panel(SYMS);
  const m = buildContext({ series, dates, asOf: 300 }).market;
  assert.ok(m.breadth >= 0 && m.breadth <= 1);
  assert.ok(typeof m.dispersion === "number");
});

test("sectors are attached when a map is supplied, in either shape", () => {
  const { series, dates } = panel(SYMS);
  const asMap = new Map([["AAA", "Energy"]]);
  const a = buildContext({ series, dates, asOf: 300, sectors: asMap });
  assert.equal(a.candidates.find((c) => c.symbol === "AAA").sector, "Energy");
  const b = buildContext({ series, dates, asOf: 300, sectors: { AAA: "Energy" } });
  assert.equal(b.candidates.find((c) => c.symbol === "AAA").sector, "Energy");
});

// ---- anonymisation --------------------------------------------------------------------------

test("anonymising removes tickers, dates, sectors and news", () => {
  const { series, dates } = panel(SYMS);
  const ctx = buildContext({
    series, dates, asOf: 300, anonymise: true,
    sectors: { AAA: "Energy" },
    news: { AAA: [{ at: new Date((dates[290]) * 1000).toISOString(), headline: "real news" }] },
  });
  assert.equal(ctx.asOf, null);
  assert.equal(ctx.mode, "anonymised");
  for (const c of ctx.candidates) {
    assert.match(c.symbol, /^Asset [A-Z]+$/);
    assert.equal(c.news.length, 0, "news is identity and cannot be anonymised");
    if (c.sector) assert.match(c.sector, /^Sector [A-Z]$/);
  }
  assert.match(ctx.anonymisationNote, /NOT evidence of edge/);
});

test("anonymisation preserves the numbers it is not meant to hide", () => {
  const { series, dates } = panel(SYMS);
  const named = buildContext({ series, dates, asOf: 300 });
  const anon = anonymiseContext(named);
  assert.equal(anon.candidates.length, named.candidates.length);
  for (let i = 0; i < named.candidates.length; i++) {
    assert.deepEqual(anon.candidates[i].indicators, named.candidates[i].indicators);
    assert.equal(anon.candidates[i].ret21d, named.candidates[i].ret21d);
  }
});

test("aliases are unique across a slate larger than the alphabet", () => {
  const many = Array.from({ length: 60 }, (_, i) => `S${i}`);
  const { series, dates } = panel(many, 300);
  const ctx = buildContext({ series, dates, asOf: 250, slate: 60, anonymise: true });
  const names = ctx.candidates.map((c) => c.symbol);
  assert.equal(new Set(names).size, names.length);
});

test("anonymiseContext strips the epoch decision bar as well as the formatted date", () => {
  const p = panel(["AAA", "BBB", "CCC"], 200);
  const named = buildContext({ series: p.series, dates: p.dates, asOf: 150 });
  assert.equal(typeof named.asOfTime, "number", "a settlement needs the decision bar");
  assert.equal(named.asOfTime, p.dates[150]);

  const anon = buildContext({ series: p.series, dates: p.dates, asOf: 150, anonymise: true });
  assert.equal(anon.asOf, null);
  assert.equal(anon.asOfTime, null, "an epoch is a date; leaving it would undo the anonymisation");
  assert.ok(!JSON.stringify(anon).includes(String(p.dates[150])),
    "the decision epoch must not survive anywhere in an anonymised context");
});
