/**
 * context.js — Lets cajh answer questions about itself.
 *
 * buildLiveContext() summarizes the bot's current state (always included in chat).
 * readSource() loads cajh's own .js files (included only when the question looks
 * code-related) so it can explain how it actually works instead of guessing.
 */

import fs   from "fs";
import path from "path";
import { getOpenTrades, isTradingEnabled, getHaltState, getMonitorHealth } from "./monitor.js";
import { getStorageHealth, loadConfig, loadDecisionJournal } from "./storage.js";
import { getRecentDecisions } from "./logger.js";

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

function latestRoadmapVerdict(maxBytes = 120000) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "ROADMAP.md"), "utf8").slice(-maxBytes);
    const matches = [...text.matchAll(/\*\*VERDICT:\s*([^*]+)\*\*/gi)];
    return matches.at(-1)?.[1].trim() || "not recorded";
  } catch { return "not available"; }
}

export function redactContextText(value) {
  return String(value ?? "")
    .replace(/(KRAKEN_API_(?:KEY|SECRET)|DISCORD_TOKEN|ANTHROPIC_API_KEY)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export function formatDecisionForContext(event) {
  const stamp = event?.at ?? event?.ts ?? "unknown time";
  if (event?.type === "asset_decision") {
    const action = event.taken === true ? "took" : "skipped";
    return redactContextText(`${stamp}: ${action} ${event.symbol ?? "unknown asset"} ${event.timeframe ?? "unknown timeframe"}; ${event.reason ?? "reason unavailable"}`);
  }
  if (event?.type === "entry") return redactContextText(`${stamp}: entered ${event.trade?.symbol ?? "unknown asset"} at $${event.trade?.entry ?? "?"} (${event.trade?.signal ?? "unspecified signal"})`);
  if (event?.type === "exit") return redactContextText(`${stamp}: exited ${event.trade?.symbol ?? "unknown asset"} at $${event.exit?.price ?? "?"}; P&L $${Number(event.exit?.pnl ?? 0).toFixed(2)} (${event.exit?.reason ?? "reason unavailable"})`);
  if (event?.type === "setup_decision") return redactContextText(`${stamp}: ${event.result?.traded ? "took" : "passed"} ${event.symbol ?? "unknown asset"} ${event.setup?.tf ?? "unknown timeframe"} setup; ${event.result?.reason ?? "reason unavailable"}`);
  if (event?.type === "reconciliation") return redactContextText(`${stamp}: reconciliation; orphans ${event.orphans?.join(",") || "none"}, ghosts ${event.ghosts?.join(",") || "none"}`);
  return redactContextText(`${stamp}: ${event?.type ?? "unknown decision"}`);
}

export function buildMissionDigest({ config = {}, verdict = "not recorded", trading = "halted" } = {}) {
  const symbols = (config.watchlist || []).map((asset) => asset.symbol).filter(Boolean).slice(0, 20);
  return redactContextText([
    "mission/limitations digest:",
    "This is supplied system context generated from current runtime state and recorded research; it is not persistent self-awareness or memory.",
    `Current configured watchlist: ${symbols.join(", ") || "none recorded"}; trading state: ${trading}; latest ROADMAP verdict: ${verdict}.`,
    "The current strategy is not validated for autonomous live trading. Do not infer an edge from live samples, incomplete holdouts, or unavailable data.",
    "Require chronological holdouts, realistic costs, adequate sample size, and explicit failure analysis before any paper-trading promotion."
  ].join(" "));
}

// A default-off boot and an operator-issued pause currently record the same reason
// string, so the only available signal to tell them apart is timing: the default halt
// call lands within the startup sequence (login, balance fetch, monitor start); a
// pause issued once the process has been running a while doesn't. Pure so it can be
// tested against plain halt-state objects without exercising the real halt machinery.
export function describeHaltCause(halt, bootedAt = Date.now() - process.uptime() * 1000, windowMs = 120000) {
  if (!halt?.active) return null;
  if (halt.haltedAt != null && halt.haltedAt - bootedAt <= windowMs) {
    return "automatic startup default (halted shortly after process start)";
  }
  return "manual pause during a running session (e.g. !stop)";
}

export function buildLiveContext(state, { maxChars = 12000, bootedAt = Date.now() - process.uptime() * 1000 } = {}) {
  const trading = isTradingEnabled() ? "active" : "halted";
  const open    = getOpenTrades();
  const positions = open.length
    ? open.map(t =>
        `${t.symbol}: entry $${t.entry}, stop $${t.stopLoss}, TP $${t.takeProfit}, R $${t.risk ?? "unrecorded"}, reason: ${t.strategyReason ?? t.signal ?? "unrecorded"}`
      ).join("\n")
    : "none";
  const watch = (state.watchlist || []).map(a => a.symbol).join(", ") || "empty";
  const journal = loadDecisionJournal({ limit: 100 });
  const recentDecisions = getRecentDecisions({ limit: 20 });
  const monitorHealth = getMonitorHealth();
  const halt = getHaltState();
  const haltCause = describeHaltCause(halt, bootedAt);
  const storageHealth = getStorageHealth();
  const config = loadConfig();
  const exits = journal.filter((event) => event.type === "exit" && Number.isFinite(event.exit?.pnl));
  const setups = journal.filter((event) => event.type === "setup_decision" || event.type === "asset_decision");
  const passed = setups.filter((event) => !event.result?.traded).length;
  const totalPnl = exits.reduce((sum, event) => sum + event.exit.pnl, 0);
  const wins = exits.filter((event) => event.exit.pnl > 0).length;
  const recent = journal.slice(-8).map(formatDecisionForContext).join("\n") || "no persisted decisions yet";

  const safeConfig = {
    scanChannelConfigured: Boolean(config.scanChannelId),
    watchlistSymbols: (config.watchlist || []).map((asset) => asset.symbol).filter(Boolean).slice(0, 100),
    lastScanTime: config.lastScanTime ?? null
  };
  const context = [
    `cajh live state:`,
    `- trading: ${trading}`,
    `- watchlist: ${watch}`,
    `- timeframes scanned: 1h, 4h, 1d`,
    `- live entry gates: anticipation swing-low trigger, per-timeframe stop band, min stop floor, monitor health, durable halt; no alignment/trend gate`,
    `- sizing/exits: risk-based at 0.5% cash risk, 20% notional cap, six-position cap with winner rotation, software-polled stop/TP`,
    `- open positions:\n${positions}`,
    `- effective safe config: ${JSON.stringify(safeConfig)}`,
    `- halt state: ${redactContextText(JSON.stringify({ active: halt.active, reason: halt.reason, haltedAt: halt.haltedAt, likelyCause: haltCause }))}`,
    `- monitor health: ${JSON.stringify({ ok: monitorHealth.ok, hydrated: monitorHealth.hydrated, reconciled: monitorHealth.reconciled, persistenceOk: monitorHealth.persistenceOk, tickOk: monitorHealth.tickOk, stale: monitorHealth.stale, exitProtection: monitorHealth.exitProtection })}`,
    `- storage health: ${JSON.stringify(Object.fromEntries(Object.entries(storageHealth).map(([key, value]) => [key, { ok: value.ok, source: value.source }])))}`,
    `- latest roadmap verdict: ${latestRoadmapVerdict()}`,
    `- ${buildMissionDigest({ config, verdict: latestRoadmapVerdict(), trading })}`,
    `- in-memory decision records: ${recentDecisions.length} (persisted journal is authoritative when present)`,
    `- last scan: ${state.lastScanTime ?? "none yet"}`,
    `- durable decision history: ${journal.length} recent records loaded; ${setups.length} evaluated setups (${passed} passed), ${exits.length} realized exits, ${wins} wins, realized P&L $${totalPnl.toFixed(2)}`,
    `- most recent decisions (persisted across deployments when DATA_DIR is a mounted volume):\n${recent}`
  ].join("\n");
  return context.length <= maxChars ? context : `${context.slice(0, Math.max(0, maxChars - 26))}\n[context truncated]`;
}

export const RESEARCH_MISSION = `
Primary objective: find a repeatable, cost-aware crypto strategy that survives out-of-sample testing. CAJH is a market-research system; trading is secondary and remains halted unless a candidate passes its pre-registered, chronological holdout gate.
Pursue that objective relentlessly through a disciplined loop: identify a falsifiable hypothesis, state the required data and pass/fail gate before testing, run or request the relevant study, preserve the result, diagnose failures, and move to the next genuinely distinct hypothesis. Use the durable decision journal and historical data to discover, test, reject, and only then paper-promote hypotheses. A losing result is a useful result because it narrows the search.
Never call a strategy successful, recommend live enablement, or infer an edge from a small live sample. Require adequate coverage, train-only selection, untouched holdout performance, realistic costs, and a clear failure analysis.
Do not keep tuning exits around an entry family that is consistently negative before costs; propose a genuinely new information source or entry hypothesis instead. When asked how to proceed, give the single highest-information next experiment, its exact decision rule, and what result would cause you to abandon it. Never invent evidence, relax a gate after seeing results, or turn a desire for a winning strategy into a claim that one has been found.`.trim();

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
