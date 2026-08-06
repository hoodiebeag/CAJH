#!/usr/bin/env node
// scripts/mint-approval-token.mjs — the ONE place a valid approval token can
// be produced. Deliberately has no MCP tool wrapper anywhere in mcp-server/ -
// running this requires a human's own terminal and their own copy of
// MCP_APPROVAL_SECRET. If you ever find yourself wanting an MCP tool that
// calls this script "for convenience," stop: that is the exact shortcut that
// turns a human-approval gate into an agent-approved-itself gate.
//
// Usage:
//   node scripts/mint-approval-token.mjs --write <relative/path.js> [--ttl-seconds 300]
//   node scripts/mint-approval-token.mjs --deploy <proposalId> [--confirm-protected] [--ttl-seconds 300]
//
// Before running --deploy, actually read the proposal first:
//   cat mcp-server/deploy-proposals/<proposalId>.json
// --confirm-protected is required (and the script refuses without it) when
// that proposal's touchesProtectedPath is true - this is your last chance to
// notice you're about to authorize a change to trader.js/monitor.js/bot.js/
// scanner.js/strategy.js/backtest.js/commands.js/storage.js before it happens.

import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const hasFlag = name => args.includes(name);

const secret = process.env.MCP_APPROVAL_SECRET;
if (!secret) {
  console.error("MCP_APPROVAL_SECRET is not set in this shell. This script refuses to run without it -");
  console.error("there is no default, because a default secret would defeat the entire point.");
  process.exit(1);
}

const ttlSeconds = Number(flag("--ttl-seconds") ?? 300);
const expiresAtMs = Date.now() + ttlSeconds * 1000;

let scope;
if (flag("--write")) {
  const relPath = flag("--write");
  scope = `write:${relPath}`;
  console.error(`Minting a WRITE token for: ${relPath}`);
  console.error(`Have you actually read the intended new content for this file? This token authorizes ANY content the agent writes there, not just what you reviewed.`);
} else if (flag("--deploy")) {
  const proposalId = flag("--deploy");
  const proposalPath = `mcp-server/deploy-proposals/${proposalId}.json`;
  if (!existsSync(proposalPath)) {
    console.error(`No such proposal file: ${proposalPath}. Did you mean to run propose_deployment first, or check the id?`);
    process.exit(1);
  }
  const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
  console.error(`Proposal ${proposalId}:`);
  console.error(`  summary: ${proposal.summary}`);
  console.error(`  files:   ${proposal.filesChanged.join(", ")}`);
  console.error(`  touchesProtectedPath: ${proposal.touchesProtectedPath}`);
  if (proposal.status === "deployed") {
    console.error(`This proposal was already deployed at ${proposal.deployedAt}. Tokens are single-use per proposal - propose a new change instead.`);
    process.exit(1);
  }
  if (proposal.touchesProtectedPath && !hasFlag("--confirm-protected")) {
    console.error(`This proposal touches a protected path. Re-run with --confirm-protected if you have actually reviewed the diff to trader.js/monitor.js/bot.js/scanner.js/strategy.js/backtest.js/commands.js/storage.js.`);
    process.exit(1);
  }
  scope = proposal.touchesProtectedPath ? `deploy-protected:${proposalId}` : `deploy:${proposalId}`;
} else {
  console.error("usage: mint-approval-token.mjs --write <path> | --deploy <proposalId> [--confirm-protected] [--ttl-seconds N]");
  process.exit(1);
}

const sig = createHmac("sha256", secret).update(`${scope}:${expiresAtMs}`).digest("base64url");
const token = `${sig}.${expiresAtMs}`;

console.error(`Token expires in ${ttlSeconds}s (at ${new Date(expiresAtMs).toISOString()}). Paste it into the agent's next tool call now:`);
console.log(token);
