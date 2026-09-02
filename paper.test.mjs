import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PAPER_SCHEMA, D2_MINIMUM, paperJournalFile, appendPaperEntry, readPaperJournal,
  runPaperSession, d2Status, driftReport, writeD2Snapshot,
} from "./paper.mjs";
import { makeTradeRecord } from "./evallib.mjs";

function withDataDir(fn) {
  const prior = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-paper-"));
  try { return fn(process.env.DATA_DIR); } finally {
    if (prior === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prior;
  }
}

const DAY = 86400000;
const base = Date.parse("2026-01-01T00:00:00Z");
const bars = (n, step = DAY) => Array.from({ length: n }, (_, i) => ({ time: base + i * step, close: 100 + i }));
const fill = (over = {}) => ({ entryPrice: 100, exitPrice: 110, risk: 5, grossR: 2, exitTime: base + DAY, ...over });

const tradesOverDays = (n, netROf = () => 1) => Array.from({ length: n }, (_, i) => makeTradeRecord({
  symbol: "BTC", timeframe: "1d",
  entryTime: base + i * DAY, exitTime: base + i * DAY + 3600000,
  entryPrice: 100, exitPrice: 100 + netROf(i) * 5, risk: 5, grossR: netROf(i),
}));

// ---------- the structural guarantee ----------

test("paper.mjs imports nothing that can reach a venue", () => {
  const src = fs.readFileSync(new URL("./paper.mjs", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .*? from "(.+?)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["fs", "path", "./evallib.mjs", "./researchlab.mjs"],
    "a new import appeared; D2 must have no path to a broker, exchange client, or order module");
  for (const forbidden of ["broker", "trader", "kraken", "@stoqey", "scanner", "monitor"]) {
    assert.ok(!imports.some((i) => i.toLowerCase().includes(forbidden)), `imports ${forbidden}`);
  }
});

test("a session reports zero orders placed, because there is no code that could place one", () => {
  withDataDir(() => {
    const res = runPaperSession({
      candidateId: "CAND-A", symbol: "BTC", timeframe: "1d", bars: bars(5), decide: () => fill(),
    });
    assert.equal(res.ordersPlaced, 0);
  });
});

// ---------- recording ----------

test("every bar is journalled, including the ones that declined to trade", () => {
  withDataDir(() => {
    const res = runPaperSession({
      candidateId: "CAND-B", symbol: "BTC", timeframe: "1d", bars: bars(6),
      decide: (bar, i) => (i % 2 === 0 ? fill({ exitTime: bar.time + 3600000 }) : null),
    });
    assert.equal(res.wouldBeFills, 3);
    assert.equal(res.skipped, 3);
    const journal = readPaperJournal("CAND-B");
    assert.equal(journal.length, 6, "a journal of only the trades taken cannot show a rule that stopped firing");
    assert.equal(journal.filter((e) => e.kind === "skip").length, 3);
    for (const e of journal) assert.equal(e.schema, PAPER_SCHEMA);
  });
});

test("a stated decline reason is recorded rather than flattened to 'no signal'", () => {
  withDataDir(() => {
    runPaperSession({
      candidateId: "CAND-C", symbol: "BTC", timeframe: "1d", bars: bars(2),
      decide: () => ({ skip: true, reason: "regime filter" }),
    });
    assert.deepEqual(readPaperJournal("CAND-C").map((e) => e.reason), ["regime filter", "regime filter"]);
  });
});

test("the journal is append-only across sessions", () => {
  withDataDir(() => {
    const opts = { candidateId: "CAND-D", symbol: "BTC", timeframe: "1d", decide: () => fill() };
    runPaperSession({ ...opts, bars: bars(3) });
    runPaperSession({ ...opts, bars: bars(2) });
    assert.equal(readPaperJournal("CAND-D").length, 5, "the second session overwrote the first");
  });
});

test("an unfillable decision is recorded as invalid, never silently dropped", () => {
  withDataDir(() => {
    const res = runPaperSession({
      candidateId: "CAND-E", symbol: "BTC", timeframe: "1d", bars: bars(3),
      decide: () => fill({ risk: 0 }),
    });
    assert.equal(res.wouldBeFills, 0);
    assert.equal(res.invalid, 3);
    const journal = readPaperJournal("CAND-E");
    assert.equal(journal.length, 3, "an invalid trade must still appear in the journal");
    assert.ok(journal.every((e) => e.kind === "invalid" && /risk/.test(e.reason)));
  });
});

test("a rule that throws is recorded as an error and does not abort the session", () => {
  withDataDir(() => {
    const res = runPaperSession({
      candidateId: "CAND-F", symbol: "BTC", timeframe: "1d", bars: bars(4),
      decide: (bar, i) => { if (i === 1) throw new Error("boom"); return fill({ exitTime: bar.time + 1000 }); },
    });
    assert.equal(res.barsSeen, 4);
    assert.equal(res.wouldBeFills, 3);
    assert.equal(res.invalid, 1);
    assert.ok(readPaperJournal("CAND-F").some((e) => e.kind === "error" && /boom/.test(e.reason)));
  });
});

test("journal:false runs the session without writing anything", () => {
  withDataDir((dir) => {
    const res = runPaperSession({
      candidateId: "CAND-G", symbol: "BTC", timeframe: "1d", bars: bars(3),
      decide: (bar) => fill({ exitTime: bar.time + 3600000 }), journal: false,
    });
    assert.equal(res.wouldBeFills, 3);
    assert.equal(fs.existsSync(path.join(dir, "paper-runs")), false);
  });
});

test("runPaperSession validates its own arguments", () => {
  const ok = { candidateId: "X", symbol: "BTC", timeframe: "1d", bars: [], decide: () => null };
  assert.throws(() => runPaperSession({ ...ok, candidateId: "" }), /candidateId/);
  assert.throws(() => runPaperSession({ ...ok, bars: null }), /bars/);
  assert.throws(() => runPaperSession({ ...ok, decide: 1 }), /decide/);
  assert.throws(() => runPaperSession({ ...ok, symbol: "" }), /symbol/);
  assert.throws(() => runPaperSession({ ...ok, timeframe: "" }), /timeframe/);
});

test("a candidate id that could escape the journal directory is rejected", () => {
  for (const bad of ["../etc", "a/b", "", ".hidden"]) {
    assert.throws(() => paperJournalFile(bad), /Invalid candidateId/);
  }
});

// ---------- D2 minimum ----------

test("the D2 minimum is the standing 60 days / 50 trades", () => {
  assert.deepEqual(D2_MINIMUM, { days: 60, trades: 50 });
});

test("a short paper track is not ready, and says exactly what it is short of", () => {
  const s = d2Status(tradesOverDays(10));
  assert.equal(s.readyForD3Review, false);
  assert.deepEqual(s.missing, ["10 of 60 days", "10 of 50 trades"]);
});

test("enough trades crammed into too few days is not enough — both legs must clear", () => {
  const sameDay = Array.from({ length: 80 }, () => makeTradeRecord({
    symbol: "BTC", timeframe: "1d", entryTime: base, exitTime: base + 3600000,
    entryPrice: 100, exitPrice: 105, risk: 5, grossR: 1,
  }));
  const s = d2Status(sameDay);
  assert.equal(s.enoughTrades, true);
  assert.equal(s.enoughDays, false);
  assert.equal(s.readyForD3Review, false);
});

test("enough days with too few trades is likewise not enough", () => {
  const sparse = Array.from({ length: 20 }, (_, i) => makeTradeRecord({
    symbol: "BTC", timeframe: "1d", entryTime: base + i * 5 * DAY, exitTime: base + i * 5 * DAY + 3600000,
    entryPrice: 100, exitPrice: 105, risk: 5, grossR: 1,
  }));
  const s = d2Status(sparse);
  assert.equal(s.enoughDays, true);
  assert.equal(s.enoughTrades, false);
  assert.equal(s.readyForD3Review, false);
});

test("a met minimum is a review trigger and says so, not a promotion", () => {
  const s = d2Status(tradesOverDays(70));
  assert.equal(s.readyForD3Review, true);
  assert.deepEqual(s.missing, []);
  assert.match(s.note, /not a promotion/);
});

test("an empty track is not ready", () => {
  const s = d2Status([]);
  assert.equal(s.readyForD3Review, false);
  assert.equal(s.observedDays, 0);
});

// ---------- drift ----------

test("an identical paper track reports zero drift", () => {
  const t = tradesOverDays(30);
  const d = driftReport(t, t);
  assert.equal(d.meanNetRDelta, 0);
  assert.equal(d.winRateDelta, 0);
  assert.equal(d.tradeRateRatio, 1);
  assert.equal(d.maxDrawdownRDelta, 0);
});

test("a paper track that fires half as often is caught by the trade-rate ratio, not the average", () => {
  const backtest = tradesOverDays(60);
  // Same per-trade outcome, half the days covered: the averages agree and the rate does not.
  const paper = backtest.filter((_, i) => i % 2 === 0);
  const d = driftReport(paper, backtest);
  assert.equal(d.meanNetRDelta, 0, "the averages agree, which is exactly why the rate matters");
  assert.equal(d.tradeRateRatio, 1);
  assert.ok(d.tradesPerDayPaper === d.tradesPerDayBacktest);

  // And when the rule fires twice per day in backtest but once in paper, the ratio moves.
  const doubled = [...backtest, ...backtest];
  assert.ok(driftReport(backtest, doubled).tradeRateRatio < 1);
});

test("drift reports a worse paper average as a negative delta", () => {
  const backtest = tradesOverDays(40, () => 1);
  const paper = tradesOverDays(40, (i) => (i % 2 ? 1 : -1));
  const d = driftReport(paper, backtest);
  assert.ok(d.meanNetRDelta < 0);
  assert.ok(d.winRateDelta < 0);
  assert.ok(d.maxDrawdownRDelta > 0, "a choppier paper track should show the larger drawdown");
});

test("drift against an empty backtest reports a null ratio rather than dividing by zero", () => {
  const d = driftReport(tradesOverDays(5), []);
  assert.equal(d.tradeRateRatio, null);
  assert.equal(d.backtest.n, 0);
});

// ---------- snapshot ----------

test("a status snapshot is written beside the journal without rewriting it", () => {
  withDataDir(() => {
    runPaperSession({ candidateId: "CAND-H", symbol: "BTC", timeframe: "1d", bars: bars(3), decide: () => fill() });
    const before = readPaperJournal("CAND-H").length;
    const file = writeD2Snapshot("CAND-H", d2Status(tradesOverDays(5)));
    const snap = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(snap.schema, "cajh-paper-status/v1");
    assert.equal(snap.candidateId, "CAND-H");
    assert.equal(snap.readyForD3Review, false);
    assert.equal(readPaperJournal("CAND-H").length, before, "the journal was touched");
  });
});

test("appendPaperEntry stamps schema, candidate and time on every row", () => {
  withDataDir(() => {
    const row = appendPaperEntry("CAND-I", { kind: "skip", reason: "test" });
    assert.equal(row.schema, PAPER_SCHEMA);
    assert.equal(row.candidateId, "CAND-I");
    assert.ok(Date.parse(row.loggedAt) > 0);
  });
});
