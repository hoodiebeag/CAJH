/**
 * paper.mjs — the generic D2 log-only runner (Phase 6).
 *
 * WHAT D2 IS. `SELF_AWARENESS_SPEC.md` defines D2 as paper-trading a candidate in log-only mode:
 * decisions and would-be fills recorded, no orders. It sits between D1 (research bar cleared)
 * and D3 (the human gate), and its purpose is to measure the gap between what a backtest said
 * would happen and what the same rule produces against bars as they arrive.
 *
 * HOW THIS FILE CANNOT PLACE AN ORDER. Not by a flag or a check, but by construction: it imports
 * no broker, no exchange client, no order module, and nothing that can reach a venue. Its only
 * output is an append-only journal file. There is no code path from here to a trade, so there is
 * no code path to audit for one — which is the only kind of guarantee worth having in a file
 * whose whole job is to look like trading.
 *
 * IT ALSO CANNOT PROMOTE. `d2Status()` reports whether the standing minimum — 60 days and 50
 * trades, from `ALPHA_DEFINITION.md` §3's closing paragraph — has been met, and nothing beyond
 * that. A met minimum is an invitation to a human review at D3, not a decision. This module
 * exposes no function that advances a candidate, and the D3 sign-off it defers to is not
 * expressible here.
 *
 * THE DRIFT QUESTION. A paper track that merely agrees with the backtest proves little; the
 * useful signal is where it disagrees, and by how much. `driftReport()` compares the two
 * populations on the figures that would change a verdict — mean net R, win rate, trade rate —
 * rather than on a single pass/fail number, because the interesting outcome is usually "the same
 * rule fired half as often", not "the average moved".
 */

import fs from "fs";
import path from "path";
import { makeTradeRecord, summarize, validateTradeRecord } from "./evallib.mjs";
import { writeFileAtomic } from "./researchlab.mjs";

export const PAPER_SCHEMA = "cajh-paper-entry/v1";

/** ALPHA_DEFINITION.md §3: "the standing minimum of 60 days / 50 trades of paper trading". */
export const D2_MINIMUM = Object.freeze({ days: 60, trades: 50 });

const dataDir = () => process.env.DATA_DIR || ".";
export const paperJournalFile = (candidateId) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidateId)) throw new Error(`Invalid candidateId: ${candidateId}`);
  return path.join(dataDir(), "paper-runs", `${candidateId}.jsonl`);
};

/**
 * Append one entry. Every decision is recorded, including the ones that declined to trade —
 * a journal of only the trades taken cannot answer "did the rule stop firing?", which is the
 * failure mode D2 exists to catch.
 */
export function appendPaperEntry(candidateId, entry) {
  const file = paperJournalFile(candidateId);
  const row = { schema: PAPER_SCHEMA, candidateId, loggedAt: new Date().toISOString(), ...entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
  return row;
}

export function readPaperJournal(candidateId) {
  const file = paperJournalFile(candidateId);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim())
    .map((line, index) => { try { return JSON.parse(line); } catch { return { malformed: true, index }; } });
}

/**
 * Run a candidate log-only over a bar series.
 *
 * `decide(bar, index, series)` returns either a falsy value (no trade — recorded as a skip with
 * its stated reason) or `{ entryPrice, exitPrice, risk, grossR, exitTime, exitReason, mae, mfe }`,
 * the same shape `evallib.makeTradeRecord` takes. The caller owns the rule; this function owns
 * the recording, so a candidate cannot quietly change what gets written down.
 *
 * Every would-be fill is validated against the canonical trade schema before it is journalled.
 * An invalid record is recorded AS invalid rather than dropped: a paper track with silently
 * missing trades would read as a cleaner result than it is.
 */
export function runPaperSession({
  candidateId, bars, decide, symbol, timeframe,
  feeRate = 0, slipPct = 0, journal = true,
} = {}) {
  if (typeof candidateId !== "string" || !candidateId) throw new Error("runPaperSession: candidateId is required");
  if (!Array.isArray(bars)) throw new Error("runPaperSession: bars must be an array");
  if (typeof decide !== "function") throw new Error("runPaperSession: decide must be a function");
  if (typeof symbol !== "string" || !symbol) throw new Error("runPaperSession: symbol is required");
  if (typeof timeframe !== "string" || !timeframe) throw new Error("runPaperSession: timeframe is required");

  const trades = [], skips = [], invalid = [];
  bars.forEach((bar, i) => {
    let decision;
    try {
      decision = decide(bar, i, bars);
    } catch (err) {
      const entry = { kind: "error", barIndex: i, reason: `decide threw: ${err.message}` };
      if (journal) appendPaperEntry(candidateId, entry);
      invalid.push(entry);
      return;
    }
    if (!decision) {
      const entry = { kind: "skip", barIndex: i, barTime: bar?.time ?? null, reason: "no signal" };
      if (journal) appendPaperEntry(candidateId, entry);
      skips.push(entry);
      return;
    }
    if (decision.skip) {
      const entry = { kind: "skip", barIndex: i, barTime: bar?.time ?? null, reason: decision.reason ?? "declined" };
      if (journal) appendPaperEntry(candidateId, entry);
      skips.push(entry);
      return;
    }
    let record;
    try {
      record = makeTradeRecord({ symbol, timeframe, feeRate, slipPct, entryTime: bar?.time, ...decision });
    } catch (err) {
      const entry = { kind: "invalid", barIndex: i, reason: err.message, decision };
      if (journal) appendPaperEntry(candidateId, entry);
      invalid.push(entry);
      return;
    }
    const check = validateTradeRecord(record);
    const entry = check.ok
      ? { kind: "wouldBeFill", barIndex: i, trade: record }
      : { kind: "invalid", barIndex: i, reason: check.errors.join("; "), trade: record };
    if (journal) appendPaperEntry(candidateId, entry);
    (check.ok ? trades : invalid).push(entry);
  });

  return {
    candidateId, symbol, timeframe,
    barsSeen: bars.length,
    wouldBeFills: trades.length,
    skipped: skips.length,
    invalid: invalid.length,
    trades: trades.map((t) => t.trade),
    // Named for what it is. Nothing here was ordered, filled, or sent anywhere.
    ordersPlaced: 0,
  };
}

/** Distinct UTC days spanned by a set of records, and the observed span in whole days. */
function coverage(trades) {
  const days = new Set(trades.map((t) => t.exposureId));
  const times = trades.map((t) => t.entryTime).filter(Number.isFinite);
  const spanDays = times.length ? Math.floor((Math.max(...times) - Math.min(...times)) / 86400000) : 0;
  return { distinctDays: days.size, spanDays };
}

/**
 * Has the candidate accumulated enough paper history for a human to look at it?
 *
 * This answers a bookkeeping question and only that. `readyForD3Review` true means the standing
 * minimum is met; it does not mean the candidate is good, does not promote anything, and does
 * not shorten the D3 gate.
 */
export function d2Status(trades, minimum = D2_MINIMUM) {
  const { distinctDays, spanDays } = coverage(trades);
  const observedDays = Math.max(distinctDays, spanDays);
  const enoughDays = observedDays >= minimum.days;
  const enoughTrades = trades.length >= minimum.trades;
  const missing = [];
  if (!enoughDays) missing.push(`${observedDays} of ${minimum.days} days`);
  if (!enoughTrades) missing.push(`${trades.length} of ${minimum.trades} trades`);
  return {
    observedDays, observedTrades: trades.length,
    requiredDays: minimum.days, requiredTrades: minimum.trades,
    enoughDays, enoughTrades,
    readyForD3Review: enoughDays && enoughTrades,
    missing,
    note: "Meeting this minimum schedules a human review at D3. It is not a promotion and confers no authority to trade.",
  };
}

/**
 * Compare a paper track against the backtest that justified it.
 *
 * Reports the deltas that would change a verdict rather than a single score. `tradeRateRatio` is
 * the one most likely to be the real finding: a rule that fires half as often in paper as in
 * backtest has a selection or data-timing problem, whatever its average R looks like.
 */
export function driftReport(paperTrades, backtestTrades) {
  const paper = summarize(paperTrades.map((t) => t.netR));
  const backtest = summarize(backtestTrades.map((t) => t.netR));
  const paperCover = coverage(paperTrades), backtestCover = coverage(backtestTrades);
  const paperRate = paperCover.distinctDays ? paperTrades.length / paperCover.distinctDays : 0;
  const backtestRate = backtestCover.distinctDays ? backtestTrades.length / backtestCover.distinctDays : 0;
  return {
    paper, backtest,
    meanNetRDelta: paper.mean - backtest.mean,
    winRateDelta: paper.winRate - backtest.winRate,
    tradesPerDayPaper: paperRate,
    tradesPerDayBacktest: backtestRate,
    tradeRateRatio: backtestRate ? paperRate / backtestRate : null,
    maxDrawdownRDelta: paper.maxDrawdownR - backtest.maxDrawdownR,
  };
}

/** Write a point-in-time snapshot beside the journal. The journal itself is never rewritten. */
export function writeD2Snapshot(candidateId, snapshot) {
  const file = path.join(path.dirname(paperJournalFile(candidateId)), `${candidateId}.status.json`);
  writeFileAtomic(file, JSON.stringify({ schema: "cajh-paper-status/v1", candidateId, ...snapshot }, null, 2) + "\n");
  return file;
}
