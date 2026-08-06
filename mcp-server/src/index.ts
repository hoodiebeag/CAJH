/**
 * cajh-mcp-server
 *
 * MCP server that gives an agent read/research access to the cajh trading bot's
 * source and runtime state, plus a gated path to proposing and deploying code
 * changes. Runs as a SEPARATE Node process from cajh's own bot.js - it shares
 * the filesystem (same working directory) but is never imported by, and never
 * imports, the live bot process. That separation matters: a crash or hang in
 * this server must never be able to take down the trading process, and vice
 * versa. See threat model item 3 in the accompanying spec response.
 *
 * TRANSPORT: stdio, not HTTP+SSE.
 * VS Code (and the cron-invoked orchestrator, see orchestrator.sh) spawn this
 * as a short-lived child process per session rather than connecting to one
 * long-running network listener. Reasons:
 *   1. No standing network port means no remote attack surface for a process
 *      that can read Kraken-adjacent source and (if approved) trigger a deploy.
 *   2. It matches the pattern already proven safe elsewhere in this repo's
 *      automation: every scheduled Architect/Executor/Verifier check is a
 *      fresh, independent process, not a long-lived server accumulating state
 *      or connections across turns.
 *   3. Auth is then "whoever can spawn the process" (VS Code locally, or the
 *      orchestrator script under the operator's own OS user) rather than a
 *      token-over-HTTP scheme this server would have to defend on its own.
 * If a future need arises for multiple simultaneous clients, revisit this -
 * but do not add HTTP+SSE only to make the cron path "more automatic"; that
 * directly trades away the property above.
 *
 * [NEEDS CONFIRMATION FROM OPERATOR]: exact @modelcontextprotocol/sdk version
 * and its current tool-registration API shape - this skeleton targets the
 * McpServer/StdioServerTransport shape as of SDK 1.x; confirm against
 * node_modules/@modelcontextprotocol/sdk/README before wiring for real.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ─── Config ──────────────────────────────────────────────────────────────────

// The cajh repo root. This server's cwd is expected to be the repo root when
// launched (see .vscode/mcp.json and orchestrator.sh) - resolved explicitly
// rather than trusted implicitly, so a misconfigured launcher fails loudly
// instead of silently operating on the wrong directory.
const CAJH_ROOT = process.env.CAJH_ROOT
  ? path.resolve(process.env.CAJH_ROOT)
  : process.cwd();

// Mirrors AGENT_PROTOCOL.md's blackboard.frozen_paths exactly, plus storage.js -
// which holds haltManual/resumeManual state and the decision journal and was
// NOT in the original frozen_paths list despite being equally safety-critical.
// Keep this in sync with AGENT_PROTOCOL.md by hand; there is deliberately no
// code that reads frozen_paths out of .agent_state.json here, because this
// server's protection must hold even if that file is corrupted or stale -
// see the state-file-corruption history in AGENT_PROTOCOL.md.
const PROTECTED_PATHS = new Set([
  "scanner.js",
  "monitor.js",
  "trader.js",
  "bot.js",
  "strategy.js",
  "backtest.js",
  "commands.js",
  "storage.js",
]);

// Never readable OR writable via any MCP tool, no token can override this.
// A token can authorize writing a *protected* file; nothing authorizes
// exposing live credentials through a chat-facing tool.
const NEVER_TOUCH = new Set([".env", ".env.local", ".env.production"]);

const PROPOSALS_DIR = path.join(CAJH_ROOT, "mcp-server", "deploy-proposals");
const ROLLBACK_DIR = path.join(CAJH_ROOT, "mcp-server", "rollback-snapshots");
const DEPLOY_LOG = path.join(CAJH_ROOT, "mcp-server", "deploy.log");
const RESEARCH_NOTES = path.join(CAJH_ROOT, "mcp-server", "research-notes.jsonl");

// ─── Path safety ─────────────────────────────────────────────────────────────

/**
 * Resolves a repo-relative path and guarantees it did not escape CAJH_ROOT
 * (blocks "../../../etc/passwd"-style traversal) and is not in NEVER_TOUCH.
 * Throws rather than silently clamping - a caller (agent) that tried to
 * escape the sandbox should get a loud error, not a quietly-redirected path.
 */
function resolveInRepo(relPath: string): string {
  const resolved = path.resolve(CAJH_ROOT, relPath);
  const rel = path.relative(CAJH_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes repo root: ${relPath}`);
  }
  if (NEVER_TOUCH.has(rel)) {
    throw new Error(`path is in NEVER_TOUCH and cannot be read or written via MCP: ${rel}`);
  }
  return resolved;
}

function isProtectedPath(relPath: string): boolean {
  // Normalize to forward-slash, compare against the top-level filename set.
  // PROTECTED_PATHS is deliberately root-level filenames, not directories -
  // if cajh's layout changes to put these under src/, update the set, don't
  // make this fuzzy/glob-based (fuzzy matching is how a protection quietly
  // stops matching after a refactor).
  const rel = path.relative(CAJH_ROOT, path.resolve(CAJH_ROOT, relPath)).replace(/\\/g, "/");
  return PROTECTED_PATHS.has(rel);
}

// ─── Approval token verification ────────────────────────────────────────────
//
// This server can VERIFY a token; it cannot MINT one. Minting lives in
// scripts/mint-approval-token.mjs, a script with no MCP tool wrapper around
// it - nothing in this file, and nothing in the 9 tools below, can invoke it.
// The only way a valid token exists is a human running that script directly
// in their own terminal. Do not add a tool that shells out generically
// (no "run_command"/"exec" tool exists here on purpose) - that would let an
// agent run the mint script itself and this entire property collapses.
//
// Token shape: base64url(HMAC-SHA256(MCP_APPROVAL_SECRET, `${proposalId}:${expiresAtMs}`)) + "." + expiresAtMs
// [NEEDS CONFIRMATION FROM OPERATOR]: MCP_APPROVAL_SECRET must be generated
// once (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
// and set in this server's environment only - it must NOT be the same value
// as any Kraken/Discord/Anthropic secret, and must not be committed.

/**
 * `scope` is a purpose-tagged string, not a bare id - e.g. "write:monitor.js",
 * "deploy:dep-123", or "deploy-protected:dep-123". This is what stops a token
 * minted for one purpose being replayed for another: a token signed over
 * "write:monitor.js" does not verify against scope "deploy:monitor.js" even
 * though the "id" portion is the same string, and a plain "deploy:dep-123"
 * token (minted for a proposal that did NOT touch a protected path) does not
 * verify against "deploy-protected:dep-123" - so trigger_deploy for a
 * touchesProtectedPath proposal requires the human to have explicitly minted
 * the protected variant, not just any token for that proposal id.
 */
function verifyApprovalToken(scope: string, token: string): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.MCP_APPROVAL_SECRET;
  if (!secret) return { ok: false, reason: "MCP_APPROVAL_SECRET not set on this server - cannot verify any token" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed token" };
  const [sig, expiresAtStr] = parts;
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, reason: "malformed expiry" };
  if (Date.now() > expiresAtMs) return { ok: false, reason: "token expired - mint a fresh one, tokens are short-lived on purpose" };

  const expectedSig = createHmac("sha256", secret)
    .update(`${scope}:${expiresAtMs}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "cajh-mcp-server", version: "0.1.0" });

// 1. read_file — read-only. Anything except NEVER_TOUCH is readable, including
// protected paths: the agent needs to be able to READ trader.js to reason
// about it, it just can't WRITE it without a token. Read access is the low-
// risk direction; keep the asymmetry deliberate.
server.tool(
  "read_file",
  "Read a text file from the cajh repo, relative to its root. Refuses .env and anything outside the repo root.",
  { path: z.string().describe("Repo-relative path, e.g. 'monitor.js' or 'ROADMAP.md'") },
  async ({ path: relPath }) => {
    const abs = resolveInRepo(relPath);
    const content = await fs.readFile(abs, "utf8");
    return { content: [{ type: "text", text: content }] };
  }
);

// 2. list_directory — read-only.
server.tool(
  "list_directory",
  "List entries in a cajh repo directory, relative to its root.",
  { path: z.string().default(".") },
  async ({ path: relPath }) => {
    const abs = resolveInRepo(relPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const listing = entries.map(e => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n");
    return { content: [{ type: "text", text: listing }] };
  }
);

// 3. write_file — the core safety boundary. A write to a PROTECTED_PATHS file
// requires approvalToken; the token is verified against the FILE PATH too
// (not just a proposal id) so a token minted for one purpose cannot be
// replayed to write something else - see mintToken script for the exact
// preimage it signs when path-scoped.
server.tool(
  "write_file",
  "Write (create or overwrite) a text file in the cajh repo. Writing a protected path " +
  "(scanner.js, monitor.js, trader.js, bot.js, strategy.js, backtest.js, commands.js, storage.js) " +
  "requires a fresh human-issued approvalToken naming that exact path.",
  {
    path: z.string(),
    content: z.string(),
    approvalToken: z.string().optional().describe("Required only when `path` is a protected path"),
  },
  async ({ path: relPath, content, approvalToken }) => {
    const abs = resolveInRepo(relPath);
    if (isProtectedPath(relPath)) {
      if (!approvalToken) {
        throw new Error(
          `refusing write: ${relPath} is a protected path. A human must run ` +
          `scripts/mint-approval-token.mjs --path ${relPath} and supply the resulting token.`
        );
      }
      // TODO(operator/dev): decide whether direct protected-path writes
      // should be allowed at all, vs. requiring every protected-path change
      // to go through propose_deployment -> trigger_deploy so it always gets
      // a rollback snapshot. Recommendation: remove this direct path entirely
      // once propose_deployment/trigger_deploy are working, so there is
      // exactly one way to change a protected file, not two.
      const verdict = verifyApprovalToken(`write:${relPath}`, approvalToken);
      if (!verdict.ok) throw new Error(`refusing write: invalid approval token (${verdict.reason})`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { content: [{ type: "text", text: `wrote ${content.length} bytes to ${relPath}` }] };
  }
);

// 4. run_backtest — spawns a fixed, known Node entrypoint with validated
// arguments passed as an ARRAY (not a shell string), so nothing in `symbol`
// or `timeframe` can break out into a shell command even if malformed.
// [NEEDS CONFIRMATION FROM OPERATOR]: the exact CLI contract of the research
// harness to call here. backtest.js/tournament.mjs are library modules in
// this repo (imported by commands.js), not standalone CLI scripts as of this
// writing - either add a small `scripts/run-backtest-cli.mjs` entrypoint that
// imports backtestMultiTF and prints JSON, or point this at research.js if
// that already has a CLI mode. Do not invent flags backtest.js doesn't have.
const SYMBOL_RE = /^[A-Z]{2,10}$/;
const TF_RE = /^(1h|4h|1d)$/;

server.tool(
  "run_backtest",
  "Run cajh's backtest harness for one symbol/timeframe and return the result summary. Read-only against live state.",
  {
    symbol: z.string().regex(SYMBOL_RE),
    timeframe: z.enum(["1h", "4h", "1d"]),
    costRate: z.number().min(0).max(0.05).optional(),
  },
  async ({ symbol, timeframe, costRate }) => {
    if (!SYMBOL_RE.test(symbol) || !TF_RE.test(timeframe)) {
      // Defense in depth: zod already validated this, but a hand-rolled
      // spawn call is cheap insurance against a future schema loosening.
      throw new Error("invalid symbol/timeframe");
    }
    const args = [
      "scripts/run-backtest-cli.mjs", // TODO(dev): create this entrypoint
      "--symbol", symbol,
      "--timeframe", timeframe,
      ...(costRate != null ? ["--cost-rate", String(costRate)] : []),
    ];
    const result = await runNode(args, { cwd: CAJH_ROOT, timeoutMs: 120_000 });
    return { content: [{ type: "text", text: result }] };
  }
);

// 5. get_decision_journal — read-only wrapper around storage.js's
// loadDecisionJournal(). TODO(dev): this needs a small CLI shim
// (scripts/print-decision-journal.mjs) that imports loadDecisionJournal from
// storage.js and prints JSON, since storage.js is ESM and not directly
// spawnable; do not reimplement journal-reading logic here separately from
// storage.js, that would be a second source of truth for its file format.
server.tool(
  "get_decision_journal",
  "Read recent entries from cajh's decision journal (storage.js loadDecisionJournal).",
  { limit: z.number().int().min(1).max(5000).default(200) },
  async ({ limit }) => {
    const result = await runNode(
      ["scripts/print-decision-journal.mjs", "--limit", String(limit)],
      { cwd: CAJH_ROOT, timeoutMs: 15_000 }
    );
    return { content: [{ type: "text", text: result }] };
  }
);

// 6. get_live_state — read-only snapshot: halt state, trading-enabled flag,
// open positions, monitor/storage health. This is the single tool that
// should answer "is it safe to reason about this repo right now" without the
// agent needing to piece it together from multiple file reads.
// TODO(dev): scripts/print-live-state.mjs shim importing getHaltState(),
// isTradingEnabled(), getOpenTrades() from monitor.js and getStorageHealth()
// from storage.js - same reasoning as get_decision_journal above.
server.tool(
  "get_live_state",
  "Snapshot of cajh's current live state: halt/resume status, trading-enabled flag, open positions, monitor and storage health.",
  {},
  async () => {
    const result = await runNode(["scripts/print-live-state.mjs"], { cwd: CAJH_ROOT, timeoutMs: 15_000 });
    return { content: [{ type: "text", text: result }] };
  }
);

// 7. append_research_note — additive-only, scoped to one file, distinct from
// write_file precisely so "the agent left itself a note" can never be the
// same operation as "the agent edited a live-trading file".
server.tool(
  "append_research_note",
  "Append a timestamped research/roadmap note. Additive only - cannot edit or remove prior notes.",
  { note: z.string().min(1).max(4000), tags: z.array(z.string()).optional() },
  async ({ note, tags }) => {
    await fs.mkdir(path.dirname(RESEARCH_NOTES), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), note, tags: tags ?? [] }) + "\n";
    await fs.appendFile(RESEARCH_NOTES, line, "utf8");
    return { content: [{ type: "text", text: "note appended" }] };
  }
);

// 8. propose_deployment — the ONLY way the agent can suggest a deploy. Writes
// a proposal record; does not touch the running process or Railway at all.
// A human reads the proposal (diff/summary/rationale) out of band, and if
// they approve, runs mint-approval-token.mjs themselves to produce the token
// trigger_deploy needs. This tool cannot produce that token.
server.tool(
  "propose_deployment",
  "Record a deployment proposal for human review. Does not deploy anything.",
  {
    summary: z.string().min(1).max(2000),
    filesChanged: z.array(z.string()).min(1),
    rationale: z.string().min(1).max(4000),
  },
  async ({ summary, filesChanged, rationale }) => {
    const touchesProtectedPath = filesChanged.some(isProtectedPath);
    const proposalId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.mkdir(PROPOSALS_DIR, { recursive: true });
    const record = {
      proposalId,
      createdAt: new Date().toISOString(),
      summary,
      filesChanged,
      rationale,
      touchesProtectedPath,
      status: "pending_review",
    };
    await fs.writeFile(path.join(PROPOSALS_DIR, `${proposalId}.json`), JSON.stringify(record, null, 2), "utf8");
    return {
      content: [{
        type: "text",
        text: `Proposal ${proposalId} recorded (touchesProtectedPath=${touchesProtectedPath}). ` +
          `A human must review it and run scripts/mint-approval-token.mjs --proposal ${proposalId} ` +
          `to produce a token before trigger_deploy will do anything.`,
      }],
    };
  }
);

// 9. trigger_deploy — the highest-stakes tool in this file. Every check here
// is a real branch that throws, not a comment. Order matters: verify the
// proposal exists and isn't already deployed BEFORE verifying the token, so
// an error message never confirms "your token would have worked" for a
// nonexistent proposal (small info-leak hygiene, cheap to get right).
server.tool(
  "trigger_deploy",
  "Deploy a previously-proposed, human-approved change. Requires a fresh approval token minted out-of-band by a human. " +
  "Writes a rollback snapshot before deploying. This tool must never appear in an unattended/cron-invoked agent's toolset.",
  { proposalId: z.string(), approvalToken: z.string() },
  async ({ proposalId, approvalToken }) => {
    const proposalPath = path.join(PROPOSALS_DIR, `${proposalId}.json`);
    let proposal: any;
    try {
      proposal = JSON.parse(await fs.readFile(proposalPath, "utf8"));
    } catch {
      throw new Error(`no such proposal: ${proposalId}`);
    }
    if (proposal.status === "deployed") {
      throw new Error(`proposal ${proposalId} was already deployed at ${proposal.deployedAt} - propose a new change, tokens are single-use per proposal`);
    }

    // A proposal that touches a protected path requires a token minted with
    // the "deploy-protected:" scope, not the plain "deploy:" scope - so a
    // human approving an ordinary (non-protected) deployment cannot have that
    // approval silently reused for a protected one. See mint-approval-token.mjs.
    const scope = proposal.touchesProtectedPath ? `deploy-protected:${proposalId}` : `deploy:${proposalId}`;
    const verdict = verifyApprovalToken(scope, approvalToken);
    if (!verdict.ok) throw new Error(`refusing deploy: invalid approval token (${verdict.reason}, scope=${scope})`);

    // Rollback snapshot BEFORE executing anything, per spec section 2.
    await fs.mkdir(ROLLBACK_DIR, { recursive: true });
    const snapshotId = `${proposalId}-${Date.now()}`;
    const snapshotPath = path.join(ROLLBACK_DIR, `${snapshotId}.json`);
    const snapshot = {
      snapshotId,
      proposalId,
      takenAt: new Date().toISOString(),
      files: {} as Record<string, string>,
    };
    for (const rel of proposal.filesChanged as string[]) {
      try {
        snapshot.files[rel] = await fs.readFile(resolveInRepo(rel), "utf8");
      } catch {
        snapshot.files[rel] = ""; // file didn't exist pre-deploy; empty = "did not exist"
      }
    }
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

    // Actually deploy. deploy.sh handles the Railway CLI call, a post-deploy
    // health check, and automatic rollback-on-failure using snapshotPath -
    // see deploy.sh for the exact steps and exit-code contract.
    const deployOutput = await runShellScript("./deploy.sh", [snapshotPath], { cwd: CAJH_ROOT, timeoutMs: 300_000 });

    proposal.status = "deployed";
    proposal.deployedAt = new Date().toISOString();
    proposal.rollbackSnapshot = snapshotPath;
    await fs.writeFile(proposalPath, JSON.stringify(proposal, null, 2), "utf8");

    await fs.appendFile(
      DEPLOY_LOG,
      JSON.stringify({ ts: new Date().toISOString(), proposalId, snapshotId, output: deployOutput.slice(0, 2000) }) + "\n",
      "utf8"
    );

    return { content: [{ type: "text", text: `deployed ${proposalId}. rollback snapshot: ${snapshotId}\n\n${deployOutput}` }] };
  }
);

// ─── Process helpers ─────────────────────────────────────────────────────────

function runNode(args: string[], opts: { cwd: string; timeoutMs: number }): Promise<string> {
  return runProcess(process.execPath, args, opts);
}

function runShellScript(scriptPath: string, args: string[], opts: { cwd: string; timeoutMs: number }): Promise<string> {
  // bash, not shell:true - deploy.sh's own argv, not a concatenated string.
  return runProcess("bash", [scriptPath, ...args], opts);
}

function runProcess(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process timed out after ${opts.timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, opts.timeoutMs);
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", err => { clearTimeout(timer); reject(err); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}: ${stderr || stdout}`));
    });
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.MCP_APPROVAL_SECRET) {
    // Not fatal - read-only tools still work - but loud, since a missing
    // secret silently makes trigger_deploy permanently unusable, which is a
    // safe failure mode but a confusing one to debug blind.
    console.error("[cajh-mcp-server] WARNING: MCP_APPROVAL_SECRET not set - trigger_deploy and protected-path writes will always be refused.");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error("[cajh-mcp-server] fatal:", err);
  process.exit(1);
});
