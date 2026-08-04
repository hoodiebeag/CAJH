/**
 * context.js — Lets cajh answer questions about itself.
 *
 * buildLiveContext() summarizes the bot's current state (always included in chat).
 * readSource() loads cajh's own .js files (included only when the question looks
 * code-related) so it can explain how it actually works instead of guessing.
 */

import fs   from "fs";
import path from "path";
import { getOpenTrades, isTradingEnabled } from "./monitor.js";
import { loadDecisionJournal } from "./storage.js";

const SOURCE_FILES = [
  "tournament.mjs", "researchlab.mjs", "portfolio.mjs",
  "bot.js", "strategy.js", "scanner.js", "backtest.js", "trader.js",
  "monitor.js", "commands.js", "chart.js", "storage.js",
  "analyzer.js", "context.js"
];

const CODE_HINTS = [
  "code", "function", "strategy", "implement", "logic", "bug", "error",
  "why did", "why didn't", "how do you", "how does", "how are you", ".js",
  "stop", "take profit", "take-profit", "signal", "swing", "fractal",
  "backtest", "position siz", "filter", "your "
];

export function buildLiveContext(state) {
  const trading = isTradingEnabled() ? "active" : "halted";
  const open    = getOpenTrades();
  const positions = open.length
    ? open.map(t =>
        `${t.symbol}: entry $${t.entry}, stop $${t.stopLoss}, TP $${t.takeProfit}`
      ).join("\n")
    : "none";
  const watch = (state.watchlist || []).map(a => a.symbol).join(", ") || "empty";
  const journal = loadDecisionJournal({ limit: 100 });
  const exits = journal.filter((event) => event.type === "exit" && Number.isFinite(event.exit?.pnl));
  const setups = journal.filter((event) => event.type === "setup_decision");
  const passed = setups.filter((event) => !event.result?.traded).length;
  const totalPnl = exits.reduce((sum, event) => sum + event.exit.pnl, 0);
  const wins = exits.filter((event) => event.exit.pnl > 0).length;
  const recent = journal.slice(-8).map((event) => {
    if (event.type === "entry") return `${event.at}: entered ${event.trade?.symbol} at $${event.trade?.entry} (${event.trade?.signal ?? "unspecified signal"})`;
    if (event.type === "exit") return `${event.at}: exited ${event.trade?.symbol} at $${event.exit?.price}; P&L $${Number(event.exit?.pnl ?? 0).toFixed(2)} (${event.exit?.reason})`;
    if (event.type === "setup_decision") return `${event.at}: ${event.result?.traded ? "took" : "passed"} ${event.symbol} ${event.setup?.tf ?? "?"} setup; ${event.result?.reason ?? "entered"}`;
    if (event.type === "reconciliation") return `${event.at}: reconciliation; orphans ${event.orphans?.join(",") || "none"}, ghosts ${event.ghosts?.join(",") || "none"}`;
    return `${event.at}: ${event.type}`;
  }).join("\n") || "no persisted decisions yet";

  return [
    `cajh live state:`,
    `- trading: ${trading}`,
    `- watchlist: ${watch}`,
    `- timeframes scanned: 1h, 4h, 1d`,
    `- live entry gates: anticipation swing-low trigger, per-timeframe stop band, min stop floor, monitor health, durable halt; no alignment/trend gate`,
    `- sizing/exits: risk-based at 0.5% cash risk, 20% notional cap, six-position cap with winner rotation, software-polled stop/TP`,
    `- open positions:\n${positions}`,
    `- last scan: ${state.lastScanTime ?? "none yet"}`,
    `- durable decision history: ${journal.length} recent records loaded; ${setups.length} evaluated setups (${passed} passed), ${exits.length} realized exits, ${wins} wins, realized P&L $${totalPnl.toFixed(2)}`,
    `- most recent decisions (persisted across deployments when DATA_DIR is a mounted volume):\n${recent}`
  ].join("\n");
}

export const RESEARCH_MISSION = `
Primary mission: CAJH is a market-research system. Trading is secondary and remains halted unless a candidate passes its pre-registered, chronological holdout gate.
Your job is to use the durable decision journal and historical data to discover, test, reject, and only then paper-promote hypotheses. A losing result is a useful result.
Never call a strategy successful, recommend live enablement, or infer an edge from a small live sample. Require adequate coverage, train-only selection, untouched holdout performance, realistic costs, and a clear failure analysis.
Do not keep tuning exits around an entry family that is consistently negative before costs; propose a genuinely new information source or entry hypothesis instead.`.trim();

export function looksLikeCodeQuestion(text) {
  const l = text.toLowerCase();
  return CODE_HINTS.some(h => l.includes(h));
}

export function readSource(maxBytes = 45000) {
  let out = "", used = 0;
  for (const f of SOURCE_FILES) {
    try {
      const p = path.join(process.cwd(), f);
      if (!fs.existsSync(p)) continue;
      const chunk = `\n\n===== ${f} =====\n${fs.readFileSync(p, "utf8")}`;
      if (used + chunk.length > maxBytes) { out += `\n\n[source truncated]`; break; }
      out += chunk;
      used += chunk.length;
    } catch { /* skip unreadable files */ }
  }
  return out.trim();
}
