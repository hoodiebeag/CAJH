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

const SOURCE_FILES = [
  "bot.js", "strategy.js", "scanner.js", "backtest.js", "trader.js",
  "monitor.js", "commands.js", "chart.js", "storage.js", "news.js",
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
        `${t.symbol}: entry $${t.entry}, stop $${t.stopLoss}, TP1 $${t.takeProfit1}, ` +
        `TP2 $${t.takeProfit2}${t.tp1Hit ? " (half taken, stop at breakeven)" : ""}`
      ).join("\n")
    : "none";
  const watch = (state.watchlist || []).map(a => a.symbol).join(", ") || "empty";

  return [
    `cajh live state:`,
    `- trading: ${trading}`,
    `- watchlist: ${watch}`,
    `- timeframes scanned: 15m, 1h, 4h`,
    `- open positions:\n${positions}`,
    `- last scan: ${state.lastScanTime ?? "none yet"}`
  ].join("\n");
}

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
