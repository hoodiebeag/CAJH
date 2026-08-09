/**
 * agent-tools.mjs — sandboxed tools for CAJH's autonomous research loop.
 *
 * Three tools, enforced here (not by convention elsewhere):
 *   1. File read/write/list, scoped to DATA_DIR + project root for reads, and to
 *      DATA_DIR/{research-runs,hypotheses,agent-notes} for writes. No delete is exported.
 *   2. Code execution: only tournament.mjs, portfolio.mjs, a hypothesis .mjs CAJH wrote
 *      itself, or an inline `node -e` script. Static pattern scan on anything CAJH wrote
 *      (network/shell-out identifiers: fetch, axios, WebSocket, XMLHttpRequest,
 *      child_process, http(s)/net/dns/tls/dgram, eval, Function(, process spawn/exec)
 *      before it's allowed to run — the same "grep the source, block on a hit" idiom as
 *      scripts/check-protected-logic.cjs, not an OS-level sandbox. Flags a bare identifier
 *      anywhere in the source, not just inside call/import syntax, and also scans a copy
 *      of the source with adjacent quoted-string concatenation collapsed so splitting a
 *      forbidden identifier across literals (e.g. "child_" + "process") doesn't evade it.
 *      Still a best-effort text scan against CAJH's own non-adversarial research scripts,
 *      not a real sandbox — it cannot be airtight. 10-minute timeout, 100KB stdout/stderr
 *      cap, cwd pinned to the project root regardless of what the script does with
 *      process.chdir.
 *   3. Hypothesis schema: a JSON record CAJH writes before running an experiment, with a
 *      mandatory 60s cooling-off period between creation and execution, and a required
 *      passed/killed resolution afterward.
 *
 * This module never imports trader.js, monitor.js, or bot.js — it cannot place an order,
 * halt, or resume trading. It also never deletes a file; the write tool only creates or
 * overwrites inside its three allowed directories.
 *
 * Importing project modules (e.g. researchlab.mjs) from a hypothesis script: DATA_DIR is
 * commonly a separate volume from the project root (Railway), so a relative static import
 * like `from "./researchlab.mjs"` will NOT resolve — it's relative to the hypothesis
 * file's own location under DATA_DIR/hypotheses, not to the project root. executeAgentScript
 * always runs with cwd pinned to the project root, so use a cwd-relative dynamic import:
 *   const { saveExperiment } = await import(new URL("researchlab.mjs", `file://${process.cwd()}/`).href);
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const dataDir    = () => process.env.DATA_DIR || process.cwd();
const projectRoot = () => process.cwd();

const READ_CAP_BYTES  = 500 * 1024;
const WRITE_CAP_BYTES = 200 * 1024;
const STDOUT_CAP_BYTES = 100 * 1024;
const EXEC_TIMEOUT_MS  = 10 * 60 * 1000;
const MIN_HYPOTHESIS_AGE_MS = 60 * 1000;

const WRITABLE_SUBDIRS = ["research-runs", "hypotheses", "agent-notes"];
const FROZEN_SOURCE_BASENAMES = ["bot.js", "backtest.js", "storage.js", "trader.js", "monitor.js"];

// Static, best-effort scan of agent-authored source before it's ever executed. This is
// the same tool-layer idiom the repo already uses for its pre-commit safety gate: block
// on a pattern match in the text, not a runtime sandbox (Node has no per-process network
// ACL without OS support, so this cannot be airtight — it exists to stop CAJH's own
// generated research scripts from reaching the network or shelling out, not a hostile actor).
//
// Bare identifiers, not scoped to require()/import/call syntax: the earlier syntax-scoped
// patterns (e.g. requiring `fetch(` or `require("node:child_process")` verbatim) were
// trivially evaded by any equivalent expression the regex didn't anticipate — property
// access (globalThis["fetch"]), a stored reference (const f = fetch), etc. Flagging the
// bare token anywhere in the source closes that whole class at once. Word-bounded to avoid
// blocking ordinary words the tokens happen to be a substring of (e.g. "evaluate", "internet",
// "netProfit") — false positives on the surviving cases (a hypothesis script that happens to
// use "net" or "eval" as a standalone identifier) are an acceptable tradeoff given how small
// and narrow this surface is (hypothesis scripts only need backtest/analysis primitives).
const FORBIDDEN_CODE_PATTERNS = [
  [/\bfetch\b/, "fetch"],
  [/\baxios\b/, "axios"],
  [/\bchild_process\b/, "child_process"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bhttps?\b/, "http/https"],
  [/\bnet\b/, "net"],
  [/\bdns\b/, "dns"],
  [/\btls\b/, "tls"],
  [/\bdgram\b/, "dgram"],
  [/\beval\b/, "eval"],
  [/\bFunction\s*\(/, "Function("],
  [/\b(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(/, "process spawn/exec"],
];

function withinRoot(root, relPath) {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, relPath);
  if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) return resolved;
  return null;
}

function assertRelative(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) throw new Error("A relative path is required");
  if (path.isAbsolute(relPath)) throw new Error(`Path must be relative, not absolute: ${relPath}`);
}

// DATA_DIR and the project root can be the same directory (DATA_DIR unset locally) or
// disjoint (Railway). Try DATA_DIR first, then the project root, and prefer whichever
// one the path actually exists under — containment alone isn't enough, since a relative
// path is "within" both roots' boundaries even when the file only lives in one of them.
function resolveReadPath(relPath) {
  const candidates = [dataDir(), projectRoot()].map((root) => withinRoot(root, relPath)).filter(Boolean);
  if (!candidates.length) throw new Error(`Path escapes DATA_DIR/project root: ${relPath}`);
  return candidates.find((full) => fs.existsSync(full)) || candidates[0];
}

// ─── Tool 1: file read/write/list ───────────────────────────────────────────────

/** Read any file under DATA_DIR or the project root, capped at 500KB. */
export function readAgentFile(relPath) {
  assertRelative(relPath);
  const full = resolveReadPath(relPath);
  const stat = fs.statSync(full, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${relPath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${relPath}`);
  if (stat.size > READ_CAP_BYTES) throw new Error(`File exceeds ${READ_CAP_BYTES}B read cap (${stat.size}B): ${relPath}`);
  return fs.readFileSync(full, "utf8");
}

/** List a directory under DATA_DIR or the project root. */
export function listAgentDir(relPath = ".") {
  assertRelative(relPath);
  const full = resolveReadPath(relPath);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true })
    .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Write ONLY under DATA_DIR/{research-runs,hypotheses,agent-notes}. Refuses a source-file
 * basename, a path that escapes those three directories, or a write over the 200KB cap.
 * Always creates/overwrites — there is no delete in this module.
 */
export function writeAgentFile(relPath, content) {
  assertRelative(relPath);
  const base = path.resolve(dataDir());
  const full = path.resolve(base, relPath);
  const inAllowedDir = WRITABLE_SUBDIRS.some((dir) => {
    const dirRoot = path.resolve(base, dir);
    return full === dirRoot || full.startsWith(dirRoot + path.sep);
  });
  if (!inAllowedDir) throw new Error(`Writes are only allowed under DATA_DIR/{${WRITABLE_SUBDIRS.join(",")}}: ${relPath}`);
  const basename = path.basename(full);
  if (FROZEN_SOURCE_BASENAMES.includes(basename)) throw new Error(`Refusing to write a protected source-file name: ${basename}`);
  const text = String(content);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > WRITE_CAP_BYTES) throw new Error(`Write exceeds ${WRITE_CAP_BYTES}B cap (${bytes}B): ${relPath}`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

// ─── Tool 2: code execution ─────────────────────────────────────────────────────

function assertSafeArgs(args) {
  for (const a of args) {
    if (/^--experimental-/.test(String(a))) throw new Error(`Disallowed flag: ${a}`);
  }
}

// Collapse adjacent quoted-string concatenation ("node:child_" + "process" -> "node:child_process")
// before scanning, so a forbidden identifier split across string literals — the simplest way to
// defeat a text-based token scan like this one — is still visible to FORBIDDEN_CODE_PATTERNS.
// Repeated until stable to also collapse 3+-literal chains ("a" + "b" + "c").
function collapseStringConcat(source) {
  let prev;
  let collapsed = source;
  do {
    prev = collapsed;
    collapsed = collapsed.replace(
      /(["'`])((?:(?!\1)[^\\]|\\.)*)\1(\s*\+\s*)(["'`])((?:(?!\4)[^\\]|\\.)*)\4/g,
      (_match, q1, s1, _op, _q2, s2) => `${q1}${s1}${s2}${q1}`
    );
  } while (collapsed !== prev);
  return collapsed;
}

function assertSafeSource(source, label) {
  const collapsed = collapseStringConcat(source);
  for (const [pattern, name] of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(source) || pattern.test(collapsed)) throw new Error(`Blocked: ${label} matches a disallowed pattern (${name}) — no outbound network or shell-out from agent-authored code.`);
  }
}

function runNode(nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: projectRoot(),
    timeout: EXEC_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  const stdoutFull = result.stdout || "";
  const stderrFull = result.stderr || "";
  const timedOut = result.signal === "SIGTERM" && result.status === null;
  return {
    stdout: stdoutFull.slice(0, STDOUT_CAP_BYTES),
    stderr: stderrFull.slice(0, STDOUT_CAP_BYTES),
    stdoutTruncated: stdoutFull.length > STDOUT_CAP_BYTES,
    status: result.status,
    timedOut,
    error: result.error ? result.error.message : null,
  };
}

/**
 * Run tournament.mjs / portfolio.mjs (already-trusted, agent-unwritable repo files) with
 * flags, or a .mjs file CAJH wrote to DATA_DIR/hypotheses/ (source-scanned first and
 * required to call saveExperiment, same as the two trusted CLIs already do).
 */
export function executeAgentScript(fileRel, args = []) {
  assertSafeArgs(args);
  let full;
  if (fileRel === "tournament.mjs" || fileRel === "portfolio.mjs") {
    full = path.resolve(projectRoot(), fileRel);
  } else {
    const hypDir = path.resolve(dataDir(), "hypotheses");
    full = path.resolve(dataDir(), fileRel);
    if (!full.startsWith(hypDir + path.sep) || !full.endsWith(".mjs")) {
      throw new Error(`Only tournament.mjs, portfolio.mjs, or a .mjs file under DATA_DIR/hypotheses/ may be executed: ${fileRel}`);
    }
    if (!fs.existsSync(full)) throw new Error(`Script not found: ${fileRel}`);
    const source = fs.readFileSync(full, "utf8");
    assertSafeSource(source, fileRel);
    if (!/saveExperiment\s*\(/.test(source)) {
      throw new Error(`${fileRel} must call saveExperiment(...) from researchlab.mjs so its result is recorded — no bespoke output path.`);
    }
  }
  if (path.basename(full) === "bot.js") throw new Error("bot.js may never be executed by the agent.");
  return runNode([full, ...args]);
}

/** Run an inline `node -e` script — same source scan, no filesystem footprint required. */
export function executeAgentInline(code, args = []) {
  assertSafeArgs(args);
  if (typeof code !== "string" || !code.trim()) throw new Error("Inline code is required");
  assertSafeSource(code, "inline script");
  return runNode(["-e", code, ...args]);
}

// ─── Tool 3: hypothesis schema ──────────────────────────────────────────────────

const HYPOTHESIS_REQUIRED_FIELDS = ["hypothesis", "entryFamily", "trainPeriod", "holdoutPeriod", "passCriteria", "killCriteria"];

function hypothesisPath(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Hypothesis id must be alphanumeric/hyphenated: ${id}`);
  return path.join("hypotheses", `${id}.json`);
}

/** Register a hypothesis before running any experiment against it. status starts "pending". */
export function createHypothesis({ id, ...fields }) {
  if (!id) throw new Error("Hypothesis id is required");
  const missing = HYPOTHESIS_REQUIRED_FIELDS.filter((f) => fields[f] === undefined || fields[f] === null || fields[f] === "");
  if (missing.length) throw new Error(`Hypothesis missing required field(s): ${missing.join(", ")}`);
  const rel = hypothesisPath(id);
  const full = path.resolve(dataDir(), rel);
  if (fs.existsSync(full)) throw new Error(`Hypothesis already exists: ${id}`);
  const record = {
    schema: "cajh-hypothesis/v1",
    id,
    createdAt: new Date().toISOString(),
    hypothesis: fields.hypothesis,
    entryFamily: fields.entryFamily,
    trainPeriod: fields.trainPeriod,
    holdoutPeriod: fields.holdoutPeriod,
    passCriteria: fields.passCriteria,
    killCriteria: fields.killCriteria,
    status: "pending",
  };
  writeAgentFile(rel, JSON.stringify(record, null, 2) + "\n");
  return record;
}

export function loadHypothesis(id) {
  return JSON.parse(readAgentFile(hypothesisPath(id)));
}

/** All pending hypotheses, oldest first. */
export function listPendingHypotheses() {
  const dir = path.resolve(dataDir(), "hypotheses");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter((r) => r?.schema === "cajh-hypothesis/v1" && r.status === "pending")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Throws unless the hypothesis is pending and at least 60s past creation. Returns it otherwise. */
export function assertHypothesisExecutable(id) {
  const record = loadHypothesis(id);
  if (record.status !== "pending") throw new Error(`Hypothesis ${id} is not pending (status=${record.status})`);
  const ageMs = Date.now() - Date.parse(record.createdAt);
  if (!(ageMs >= MIN_HYPOTHESIS_AGE_MS)) {
    const waitMs = MIN_HYPOTHESIS_AGE_MS - ageMs;
    throw new Error(`Hypothesis ${id} is ${Math.max(0, Math.round(ageMs / 1000))}s old — wait ${Math.ceil(waitMs / 1000)}s more before running it.`);
  }
  return record;
}

/** Resolve a hypothesis to passed/killed and attach its result. */
export function recordHypothesisResult(id, status, result) {
  if (status !== "passed" && status !== "killed") throw new Error('status must be "passed" or "killed"');
  const record = loadHypothesis(id);
  const updated = { ...record, status, result, resolvedAt: new Date().toISOString() };
  writeAgentFile(hypothesisPath(id), JSON.stringify(updated, null, 2) + "\n");
  return updated;
}
