import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GATE, PREREGISTRATION, evaluateGate, isDirectRun, parseFredCsv } from "./scripts/c1-c3-entitlement-probe.mjs";

const expiries = (n, strikes) => Array.from({ length: n }, (_, i) => ({ expiry: `2026100${i}`, strikes }));

const CONNECTED = { connected: true };
const okSeries = (n) => Object.keys(GATE.c3.series).slice(0, n)
  .map((currency) => ({ currency, ok: true, observations: 400 }));
const okPairs = (n) => GATE.c3.pairs.slice(0, n).map(([b, q]) => ({ pair: `${b}${q}`, bars: 1300 }));

const PASSING = {
  ibkr: CONNECTED,
  c1: { underlyings: [{ symbol: "SPY", expiries: expiries(6, 40), ivBars: 504 }] },
  c3: { pairs: okPairs(4), control: { ok: true, observations: 800 }, series: okSeries(6) },
};

// ---------- the pre-registration itself ----------

test("the pre-registration states a falsifiable gate with concrete thresholds", () => {
  assert.match(PREREGISTRATION.gate, /C1 AVAILABLE iff/);
  assert.match(PREREGISTRATION.gate, /C3 AVAILABLE iff/);
  assert.match(PREREGISTRATION.gate, /No proxy may be substituted/);
  assert.ok(Number.isInteger(PREREGISTRATION.seed));
  for (const n of [GATE.c1.minExpiries, GATE.c1.minIvBars, GATE.c3.minFxBars, GATE.c3.minNonUsdSeries]) {
    assert.ok(Number.isInteger(n) && n > 0);
  }
});

// ---------- FRED parsing ----------

test("parseFredCsv counts real observations and reports the range", () => {
  const r = parseFredCsv("DATE,VALUE\n2020-01-01,1.5\n2020-02-01,1.6\n2020-03-01,1.7\n");
  assert.equal(r.ok, true);
  assert.equal(r.observations, 3);
  assert.equal(r.first, "2020-01-01");
  assert.equal(r.last, "2020-03-01");
});

test('parseFredCsv skips FRED\'s "." placeholders without treating them as a parse failure', () => {
  const r = parseFredCsv("DATE,VALUE\n2020-01-01,.\n2020-02-01,1.6\n");
  assert.equal(r.ok, true);
  assert.equal(r.observations, 1);
  assert.equal(r.first, "2020-02-01");
});

test("parseFredCsv rejects an error page or an empty export rather than reporting zero observations as success", () => {
  assert.equal(parseFredCsv("").ok, false);
  assert.equal(parseFredCsv("DATE,VALUE\n").ok, false);
  assert.equal(parseFredCsv("<html>Not found</html>").ok, false);
  assert.equal(parseFredCsv("DATE,VALUE\n2020-01-01,.\n").ok, false);
});

// ---------- gate evaluation ----------

test("a fully entitled account makes both mechanisms AVAILABLE", () => {
  const g = evaluateGate(PASSING);
  assert.equal(g.c1.verdict, "AVAILABLE");
  assert.equal(g.c3.verdict, "AVAILABLE");
  assert.match(g.meaning, /not a result about returns/);
});

test("no gateway connection blocks both mechanisms rather than failing them", () => {
  const g = evaluateGate({ ...PASSING, ibkr: { connected: false, error: "ECONNREFUSED" } });
  assert.equal(g.c1.verdict, "BLOCKED");
  assert.equal(g.c3.verdict, "BLOCKED");
  assert.ok(g.c1.reasons.some((r) => /ECONNREFUSED/.test(r)));
});

test("a chain that enumerates but returns no implied-volatility history is UNAVAILABLE, not AVAILABLE", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [{ symbol: "SPY", expiries: expiries(6, 40), ivBars: 0 }] } });
  assert.equal(g.c1.verdict, "UNAVAILABLE");
  assert.ok(g.c1.reasons.some((r) => /0 IV bars/.test(r)));
});

test("expiries too thin on strikes do not count toward the chain requirement", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [{ symbol: "SPY", expiries: expiries(6, 2), ivBars: 900 }] } });
  assert.equal(g.c1.verdict, "UNAVAILABLE");
  assert.ok(g.c1.reasons.some((r) => /0 qualifying expiries/.test(r)));
});

test("one qualifying underlying is enough for C1 — the gate asks for at least one", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: expiries(1, 40), ivBars: 0 },
    { symbol: "QQQ", expiries: expiries(6, 40), ivBars: 700 },
  ] } });
  assert.equal(g.c1.verdict, "AVAILABLE");
});

test("a failed network control blocks C3 — a missing series and an unreachable FRED are different facts", () => {
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, control: { ok: false, reason: "HTTP 403" }, series: [] } });
  assert.equal(g.c3.verdict, "BLOCKED");
  assert.ok(g.c3.reasons.some((r) => /uninterpretable/.test(r)));
});

test("with the control good, too few non-USD series is a genuine UNAVAILABLE", () => {
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, series: okSeries(2) } });
  assert.equal(g.c3.verdict, "UNAVAILABLE");
  assert.ok(g.c3.reasons.some((r) => /2 non-USD series resolved/.test(r)));
});

test("a series that resolves but carries too little history does not count", () => {
  const shallow = Object.keys(GATE.c3.series).map((currency) => ({ currency, ok: true, observations: 12 }));
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, series: shallow } });
  assert.equal(g.c3.verdict, "UNAVAILABLE");
});

test("too few FX pairs with enough bars is UNAVAILABLE even when the rate series are all fine", () => {
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, pairs: okPairs(2) } });
  assert.equal(g.c3.verdict, "UNAVAILABLE");
  assert.ok(g.c3.reasons.some((r) => /2 of 2 pairs/.test(r)));
});

test("short FX histories do not count toward the pair requirement", () => {
  const shortBars = GATE.c3.pairs.map(([b, q]) => ({ pair: `${b}${q}`, bars: 50 }));
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, pairs: shortBars } });
  assert.equal(g.c3.verdict, "UNAVAILABLE");
});

test("the two mechanisms resolve independently — one being available says nothing about the other", () => {
  const c1Only = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, series: okSeries(0) } });
  assert.equal(c1Only.c1.verdict, "AVAILABLE");
  assert.equal(c1Only.c3.verdict, "UNAVAILABLE");

  const c3Only = evaluateGate({ ...PASSING, c1: { underlyings: [{ symbol: "SPY", expiries: [], ivBars: 0 }] } });
  assert.equal(c3Only.c1.verdict, "UNAVAILABLE");
  assert.equal(c3Only.c3.verdict, "AVAILABLE");
});

test("a probe with nothing in it is UNAVAILABLE or BLOCKED, never AVAILABLE", () => {
  for (const p of [{}, { ibkr: CONNECTED }, { ibkr: CONNECTED, c3: { control: { ok: true } } }]) {
    const g = evaluateGate(p);
    assert.notEqual(g.c1.verdict, "AVAILABLE");
    assert.notEqual(g.c3.verdict, "AVAILABLE");
  }
});

// ---------- direct-run guard ----------

test("the direct-run guard matches a real path on this platform", () => {
  const here = fileURLToPath(new URL("./scripts/c1-c3-entitlement-probe.mjs", import.meta.url));
  const url = pathToFileURL(here).href;
  assert.equal(isDirectRun(url, here), true);
  assert.equal(isDirectRun(url, fileURLToPath(new URL("./paper.mjs", import.meta.url))), false);
});

test("the guard matches a Windows backslash argv, which the naive string form silently missed", () => {
  // The regression: on Windows argv[1] is "C:\\cajh\\scripts\\x.mjs" while import.meta.url is
  // "file:///C:/cajh/scripts/x.mjs", so `file://${argv[1]}` never matched and main() never ran
  // on the one machine that can reach IB Gateway. Asserted against the real conversion rather
  // than a hardcoded string so it stays true if Node's encoding changes.
  const winPath = "C:\\cajh\\scripts\\c1-c3-entitlement-probe.mjs";
  const href = pathToFileURL(winPath).href;
  assert.equal(isDirectRun(href, winPath), true);
  assert.notEqual(href, `file://${winPath}`, "the naive form and the correct form must differ here");
});

test("the guard is false when nothing was passed, so importing the module runs nothing", () => {
  assert.equal(isDirectRun("file:///x.mjs", undefined), false);
  assert.equal(isDirectRun("file:///x.mjs", ""), false);
});

test("an unattempted FX leg says so rather than reporting zero of four", () => {
  // The real 2026-09-03 run: no gateway, so no pair request was ever made. "0 of 4 pairs
  // returned >= 1000 bars" read like four empty responses. It must not.
  const g = evaluateGate({ ...PASSING, ibkr: { connected: false, error: "ECONNREFUSED" }, c3: { ...PASSING.c3, pairs: [] } });
  assert.ok(g.c3.reasons.some((r) => /not attempted/.test(r)));
  assert.ok(!g.c3.reasons.some((r) => /^0 of \d+ pairs returned/.test(r)));
});

// ---------- inconclusive is not unavailable ----------

test("a C1 leg that errored having returned nothing is BLOCKED, not UNAVAILABLE", () => {
  // The 2026-09-03 run 2 exactly: gateway connected, both underlyings timed out with zero rows.
  // Scoring that UNAVAILABLE would put "this account cannot enumerate option chains" on the
  // record when no request ever completed.
  const g = evaluateGate({
    ibkr: CONNECTED,
    c1: { underlyings: [
      { symbol: "SPY", expiries: [], ivBars: 0, error: "timeout" },
      { symbol: "QQQ", expiries: [], ivBars: 0, error: "timeout" },
    ] },
    c3: PASSING.c3,
  });
  assert.equal(g.c1.verdict, "BLOCKED");
  assert.ok(g.c1.reasons.every((r) => /inconclusive, not a finding about entitlement/.test(r)));
});

test("a clean chain that is simply too thin is UNAVAILABLE, which is a real finding", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [{ symbol: "SPY", expiries: expiries(1, 40), ivBars: 900 }] } });
  assert.equal(g.c1.verdict, "UNAVAILABLE");
  assert.ok(!g.c1.reasons.some((r) => /inconclusive/.test(r)));
});

test("one inconclusive leg does not block a verdict the other leg actually answered", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: [], ivBars: 0, error: "timeout" },
    { symbol: "QQQ", expiries: expiries(6, 40), ivBars: 700 },
  ] } });
  assert.equal(g.c1.verdict, "AVAILABLE");
});

test("a partial leg that returned data despite an error is scored on the data, and flagged", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [{ symbol: "SPY", expiries: expiries(6, 40), ivBars: 700, error: "timeout" }] } });
  assert.equal(g.c1.verdict, "AVAILABLE");
  assert.ok(g.c1.reasons.some((r) => /\[partial: timeout\]/.test(r)));
});

test("FX bars that arrived count even when the request ended badly", () => {
  // Run 2's real shape: 1297 bars per pair, every one carrying error "timeout" because the
  // completion sentinel was missed. Data that arrived is affirmative evidence.
  const pairs = GATE.c3.pairs.map(([b, q]) => ({ pair: `${b}${q}`, bars: 1297, error: "timeout" }));
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, pairs } });
  assert.equal(g.c3.verdict, "AVAILABLE");
});

test("FX pairs that all errored with no bars are BLOCKED, not UNAVAILABLE", () => {
  const pairs = GATE.c3.pairs.map(([b, q]) => ({ pair: `${b}${q}`, bars: 0, error: "timeout" }));
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, pairs } });
  assert.equal(g.c3.verdict, "BLOCKED");
  assert.ok(g.c3.reasons.some((r) => /inconclusive, not a finding about entitlement/.test(r)));
});

test("FX pairs that answered cleanly but short are UNAVAILABLE, a real finding", () => {
  const pairs = GATE.c3.pairs.map(([b, q]) => ({ pair: `${b}${q}`, bars: 50, error: null }));
  const g = evaluateGate({ ...PASSING, c3: { ...PASSING.c3, pairs } });
  assert.equal(g.c3.verdict, "UNAVAILABLE");
});

// ---------- chain and IV fail independently ----------

test("a clean chain with an inconclusive IV leg is BLOCKED, not UNAVAILABLE", () => {
  // Run 4 exactly: SPY enumerated 34 expiries, its IV request timed out with zero bars.
  // One flag for the whole underlying read that as "no implied-volatility history available".
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: expiries(34, 491), ivBars: 0, chainError: null, ivError: "timeout" },
  ] } });
  assert.equal(g.c1.verdict, "BLOCKED");
  assert.ok(g.c1.reasons.some((r) => /34 qualifying expiries/.test(r)), "the chain result must still be reported");
  assert.ok(g.c1.reasons.some((r) => /IV request did not complete/.test(r)));
});

test("a clean chain with a clean but empty IV response is UNAVAILABLE, a real finding", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: expiries(34, 491), ivBars: 0, chainError: null, ivError: null },
  ] } });
  assert.equal(g.c1.verdict, "UNAVAILABLE");
  assert.ok(!g.c1.reasons.some((r) => /inconclusive/.test(r)));
});

test("an inconclusive chain leg is reported as such even when IV came back fine", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: [], ivBars: 800, chainError: "321: rejected", ivError: null },
  ] } });
  assert.equal(g.c1.verdict, "BLOCKED");
  assert.ok(g.c1.reasons.some((r) => /chain request did not complete \(321: rejected\)/.test(r)));
  assert.ok(g.c1.reasons.some((r) => /800 IV bars/.test(r)));
});

test("both legs clean and sufficient is still AVAILABLE", () => {
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: expiries(34, 491), ivBars: 504, chainError: null, ivError: null },
  ] } });
  assert.equal(g.c1.verdict, "AVAILABLE");
});

test("the older per-underlying error shape still scores correctly", () => {
  // Runs 2 and 3 predate the split fields and carry a single `error`. Their records must not
  // silently re-score to something different when read back.
  const g = evaluateGate({ ...PASSING, c1: { underlyings: [
    { symbol: "SPY", expiries: [], ivBars: 0, error: "timeout" },
  ] } });
  assert.equal(g.c1.verdict, "BLOCKED");
});
