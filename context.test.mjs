import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildLiveContext, buildMissionDigest, buildVerdictsDigest, formatDecisionForContext, describeHaltCause } from "./context.js";

const monitorUrl = pathToFileURL(path.join(process.cwd(), "monitor.js")).href;
const contextUrl = pathToFileURL(path.join(process.cwd(), "context.js")).href;

// DATA_DIR is read at module-load time, so a real open position can only be set up
// in a subprocess started with a temp DATA_DIR — never against this process's own
// (repo-root) storage.
function runContext(dir, body) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as monitor from ${JSON.stringify(monitorUrl)};
    import * as context from ${JSON.stringify(contextUrl)};
    ${body}
  `], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find(value => value.startsWith("__RESULT__"));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("__RESULT__".length));
}

test("C2 exposes bounded read-only operational context without secrets", () => {
  const context = buildLiveContext({
    watchlist: [{ symbol: "BTC", id: "XXBTZUSD" }],
    lastScanTime: "2026-08-04T00:00:00.000Z"
  }, { maxChars: 20000 });

  assert.match(context, /open positions:/);
  assert.match(context, /effective safe config:/);
  assert.match(context, /halt state:/);
  assert.match(context, /monitor health:/);
  assert.match(context, /storage health:/);
  assert.match(context, /latest roadmap verdict:/);
  assert.ok(context.length <= 20000);
  assert.doesNotMatch(context, /KRAKEN_API_(KEY|SECRET)|DISCORD_TOKEN|sk-ant-/i);
});

test("C2 does not invent an absent decision or expose source code in live context", () => {
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 12000 });
  assert.match(context, /no persisted decisions yet|durable decision history:/);
  assert.doesNotMatch(context, /===== .*\.js =====|function buildLiveContext/);
  assert.ok(context.length <= 12000);
});

test("C2 answers skipped-asset questions from recorded asset decisions", () => {
  assert.equal(
    formatDecisionForContext({ type: "asset_decision", ts: "2026-08-04T01:00:00Z", symbol: "BTC", timeframe: "1h", taken: false, reason: "no signal" }),
    "2026-08-04T01:00:00Z: skipped BTC 1h; no signal"
  );
  assert.equal(formatDecisionForContext({ type: "asset_decision", ts: "2026-08-04T01:00:00Z", symbol: "ETH", taken: false }), "2026-08-04T01:00:00Z: skipped ETH unknown timeframe; reason unavailable");
});

test("C2 redacts dynamic token-shaped text in decisions and halt reasons", () => {
  const decision = formatDecisionForContext({ type: "asset_decision", ts: "now", symbol: "BTC", taken: false, reason: "KRAKEN_API_SECRET=supersecret sk-ant-abcdefghijklmnop" });
  assert.doesNotMatch(decision, /supersecret|sk-ant-abcdefghijklmnop/);
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 20000 });
  assert.doesNotMatch(context, /KRAKEN_API_SECRET=supersecret|sk-ant-abcdefghijklmnop/);
});

test("C3 mission digest is dynamic and states its context and live-trading limits", () => {
  const digest = buildMissionDigest({
    config: { watchlist: [{ symbol: "BTC" }, { symbol: "ETH" }] },
    verdict: "KILLED — data-gated",
    trading: "halted"
  });
  assert.match(digest, /supplied system context/);
  assert.match(digest, /not persistent self-awareness/);
  assert.match(digest, /BTC, ETH/);
  assert.match(digest, /KILLED/);
  assert.match(digest, /not validated for autonomous live trading/);
});

test("C3 mission digest states what cajh is, its current strategy, and why trading defaults off, from a multi-hypothesis verdict digest", () => {
  const digest = buildMissionDigest({
    config: { watchlist: [{ symbol: "BTC" }, { symbol: "ETH" }] },
    verdictsDigest: "Momentum M7: KILLED; Classifier P5: KILLED (economic lift fails cost)",
    trading: "halted"
  });
  assert.match(digest, /research-first market-intelligence system/);
  assert.match(digest, /long-only Kraken spot executor/);
  assert.match(digest, /Current strategy: anticipation swing-low trigger/);
  assert.match(digest, /Trading defaults off because/);
  assert.match(digest, /Momentum M7: KILLED; Classifier P5: KILLED \(economic lift fails cost\)/);
});

test("buildVerdictsDigest reads VERDICTS.md live, drops pending/folded-in rows, and keeps the most recent meaningful ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-verdicts-"));
  fs.writeFileSync(path.join(dir, "VERDICTS.md"), [
    "| ID | Hypothesis | Verdict | Deciding metric | Holdout n | Date | Commit |",
    "|---|---|---|---|---|---|---|",
    "| A | first hypothesis | KILLED | x | 1 | d | c |",
    "| B | second hypothesis | pending | x | 1 | d | c |",
    "| C | third hypothesis | done — result folded into A above | x | 1 | d | c |",
    "| D | fourth hypothesis | FAIL | x | 1 | d | c |"
  ].join("\n"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const digest = buildVerdictsDigest();
    assert.match(digest, /A: KILLED/);
    assert.doesNotMatch(digest, /B: pending/);
    assert.doesNotMatch(digest, /C: done/);
    assert.match(digest, /D: FAIL/);
  } finally {
    process.chdir(cwd);
  }
});

test("buildVerdictsDigest reports an honest empty state when no meaningful verdict rows exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-verdicts-empty-"));
  fs.writeFileSync(path.join(dir, "VERDICTS.md"), [
    "| ID | Hypothesis | Verdict | Deciding metric | Holdout n | Date | Commit |",
    "|---|---|---|---|---|---|---|",
    "| A | only hypothesis | pending | x | 1 | d | c |"
  ].join("\n"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    assert.equal(buildVerdictsDigest(), "no recorded verdicts yet");
  } finally {
    process.chdir(cwd);
  }
});

test("C3: buildLiveContext's verdict digest is a real multi-hypothesis digest pulled live from VERDICTS.md, not just the single latest bare verdict word", () => {
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 20000 });
  const match = context.match(/recent verdicts: (.+?)\./);
  assert.ok(match, context);
  assert.ok(match[1].length > 40, `expected a multi-hypothesis digest, got: ${JSON.stringify(match[1])}`);
  assert.match(match[1], /:/);
  assert.match(context, /Current strategy: anticipation swing-low trigger/);
  assert.match(context, /research-first market-intelligence system/);
});

test("C2 exposes an open position's R and entry reason from strategyReason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-ctx-pos-"));
  fs.writeFileSync(path.join(dir, "positions.json"), JSON.stringify([
    { symbol: "BTC", entry: 100, stopLoss: 90, takeProfit: 130, risk: 10, volume: 1, strategyReason: "anticipation swing-low trigger" }
  ]));
  const result = runContext(dir, `
    monitor.hydrateTrades();
    console.log("__RESULT__" + JSON.stringify({
      context: context.buildLiveContext({ watchlist: [] }, { maxChars: 20000 })
    }));
  `);
  assert.match(result.context, /BTC: entry \$100, stop \$90, TP \$130, R \$10, reason: anticipation swing-low trigger/);
});

test("C2 falls back to the entry signal name when no strategy reason was recorded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-ctx-pos2-"));
  fs.writeFileSync(path.join(dir, "positions.json"), JSON.stringify([
    { symbol: "ETH", entry: 200, stopLoss: 180, takeProfit: 260, risk: 20, volume: 1, signal: "anticipate" }
  ]));
  const result = runContext(dir, `
    monitor.hydrateTrades();
    console.log("__RESULT__" + JSON.stringify({
      context: context.buildLiveContext({ watchlist: [] }, { maxChars: 20000 })
    }));
  `);
  assert.match(result.context, /ETH: entry \$200, stop \$180, TP \$260, R \$20, reason: anticipate/);
});

test("C2's halt-cause heuristic labels a halt landing within the boot window as the automatic default", () => {
  assert.equal(
    describeHaltCause({ active: true, haltedAt: 1_000_000 }, 999_500),
    "automatic startup default (halted shortly after process start)"
  );
});

test("C2's halt-cause heuristic labels a halt landing well after boot as a manual pause", () => {
  assert.equal(
    describeHaltCause({ active: true, haltedAt: 1_000_000 }, 1_000_000 - 10 * 60 * 1000),
    "manual pause during a running session (e.g. !stop)"
  );
});

test("C2's halt-cause heuristic returns null when trading is not halted", () => {
  assert.equal(describeHaltCause({ active: false, haltedAt: null }, Date.now()), null);
});

test("C2 threads the halt-cause label into the live context's halt state field", () => {
  const context = buildLiveContext({ watchlist: [] }, { maxChars: 20000 });
  assert.match(context, /"likelyCause":null/);
});
