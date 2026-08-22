#!/usr/bin/env node
// scripts/check-protected-logic.cjs — the actual enforcement behind the pre-commit
// hook (.git/hooks/pre-commit calls this). Scans the STAGED diff, not just three
// filenames, for any line touching the specific functions/checks that keep live
// trading off: the LIVE_TRADING env gate, the halt/resume state machine, and the
// order-validation chain. A match anywhere in the repo blocks the commit outright
// unless a fresh, single-use human-created marker file is present.
//
// This exists because a prompt instruction telling an unattended agent "never edit
// these functions" is not a security boundary - an adversarial review of the loop's
// own prompt found exactly that gap (2026-08-07): nothing re-checked a firing's own
// edits before it committed them, and file-scoped checking missed new call sites
// added anywhere else in the repo. This scans by pattern, not by filename, and it's
// enforced by git itself, not by an LLM remembering to apply a rule.
//
// EXEMPTION (2026-08-22): .agent_state.json's ledger array is pure prose narrating
// past work, and it routinely quotes PROTECTED_PATTERNS identifiers by name when
// describing what a prior firing touched. Entries get trimmed to a 100-item cap
// every firing - the trim's "-" lines matched those quoted identifiers in old
// ledger text and blocked every trim commit, so the cap silently stopped being
// enforced. Three options were weighed: (a) exempt only the
// ledger array's line range within this one file, leaving every other field in it
// (repo_purpose, work_queue, notification_policy, etc.) and every other file fully
// scanned; (b) match only added lines for this file, which would let a removed line
// elsewhere in the file slip through unnoticed, a bigger hole than (a); (c) require
// future ledger prose to dodge the literal identifiers, which is a convention an
// unattended writer can silently forget and is unenforceable by the hook itself.
// Chose (a): narrowest exemption that fixes the actual collision, computed
// structurally (see ledgerArrayLineRange below) so it tracks the array wherever it
// falls in the file rather than trusting a fixed line number.

const { execSync } = require("node:child_process");

const LEDGER_EXEMPT_FILE = ".agent_state.json";

const PROTECTED_PATTERNS = [
  "LIVE_TRADING",
  "enableTrading",
  "disableTrading",
  "haltManual",
  "resumeManual",
  "isManualHalt",
  "canResume",
  "getHaltState",
  "isTradingEnabled",
  "validateOrderRequest",
  "validateOrderTransportBoundary",
  "placeBuy",
  "placeSell",
];

const OVERRIDE_MARKER = ".git/ALLOW_PROTECTED_EDIT";
const OVERRIDE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes - freshly created, not left sitting around

function stagedDiff() {
  try {
    return execSync("git diff --cached -U0", { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    console.error("check-protected-logic: could not read staged diff -", err.message);
    process.exit(1);
  }
}

function stagedFiles() {
  try {
    return execSync("git diff --cached --name-only", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// Returns file content at a git ref (e.g. "HEAD" for the pre-commit version, ":0"
// for the staged/index version), or null if the file doesn't exist there (new file,
// deleted file, etc).
function fileAtRef(ref, file) {
  try {
    return execSync(`git show ${ref}:${file}`, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Structurally locates the top-level "ledger" array in a JSON document and returns
// the 1-indexed [startLine, endLine] it spans (the lines holding its opening "["
// through its matching "]"), independent of indentation/formatting. Returns null if
// the content isn't parseable JSON or has no top-level "ledger" array.
function ledgerArrayLineRange(content) {
  if (!content) return null;
  const n = content.length;
  let i = 0;

  function skipWs() {
    while (i < n && /\s/.test(content[i])) i++;
  }
  function skipString() {
    // content[i] === '"'
    i++;
    while (i < n) {
      if (content[i] === "\\") { i += 2; continue; }
      if (content[i] === '"') { i++; return; }
      i++;
    }
  }
  function skipBalanced() {
    // content[i] is '{' or '[' - advance i to just past the matching close.
    let depth = 0;
    do {
      if (content[i] === '"') { skipString(); continue; }
      if (content[i] === "{" || content[i] === "[") depth++;
      else if (content[i] === "}" || content[i] === "]") depth--;
      i++;
    } while (depth > 0 && i < n);
  }
  function skipValue() {
    skipWs();
    if (content[i] === '"') { skipString(); return; }
    if (content[i] === "{" || content[i] === "[") { skipBalanced(); return; }
    // number / true / false / null - no embedded whitespace or structural chars
    while (i < n && !/[,}\]\s]/.test(content[i])) i++;
  }

  skipWs();
  if (content[i] !== "{") return null;
  i++; // enter top-level object
  while (i < n) {
    skipWs();
    if (content[i] === "}") return null; // ledger key never found
    if (content[i] !== '"') return null; // malformed / unexpected
    const keyStart = i;
    skipString();
    const key = content.slice(keyStart + 1, i - 1);
    skipWs();
    if (content[i] === ":") i++;
    skipWs();
    if (key === "ledger") {
      if (content[i] !== "[") return null;
      const arrStart = i;
      skipBalanced();
      const arrEnd = i - 1; // index of the matching ']'
      const startLine = content.slice(0, arrStart).split("\n").length;
      const endLine = content.slice(0, arrEnd).split("\n").length;
      return { startLine, endLine };
    }
    skipValue();
    skipWs();
    if (content[i] === ",") i++;
  }
  return null;
}

function isLedgerExempt(file, side, lineNo, ledgerRanges) {
  if (file !== LEDGER_EXEMPT_FILE || !ledgerRanges) return false;
  const range = side === "old" ? ledgerRanges.old : ledgerRanges.new;
  if (!range) return false;
  return lineNo >= range.startLine && lineNo <= range.endLine;
}

function findMatches(diff, ledgerRanges) {
  const hits = [];
  let currentFile = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const f = line.slice(6);
      if (f !== "/dev/null") currentFile = f;
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      continue;
    }
    if (line.startsWith("-")) {
      const ln = oldLine++;
      if (isLedgerExempt(currentFile, "old", ln, ledgerRanges)) continue;
    } else if (line.startsWith("+")) {
      const ln = newLine++;
      if (isLedgerExempt(currentFile, "new", ln, ledgerRanges)) continue;
    } else {
      continue;
    }
    for (const pattern of PROTECTED_PATTERNS) {
      if (line.includes(pattern)) {
        hits.push({ file: currentFile, pattern, line: line.trim().slice(0, 200) });
      }
    }
  }
  return hits;
}

function checkOverride() {
  const fs = require("node:fs");
  if (!fs.existsSync(OVERRIDE_MARKER)) return false;
  const stat = fs.statSync(OVERRIDE_MARKER);
  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs > OVERRIDE_MAX_AGE_MS) {
    console.error(`check-protected-logic: override marker exists but is stale (${Math.round(ageMs / 1000)}s old, max ${OVERRIDE_MAX_AGE_MS / 1000}s) - create a fresh one.`);
    return false;
  }
  fs.unlinkSync(OVERRIDE_MARKER); // single-use
  return true;
}

function main() {
  // Also block staged changes to .env directly, regardless of pattern matching -
  // it should never be tracked at all, but this is a second, independent check.
  const files = stagedFiles();
  const envStaged = files.some(f => f === ".env" || f.endsWith("/.env"));

  let ledgerRanges = null;
  if (files.includes(LEDGER_EXEMPT_FILE)) {
    ledgerRanges = {
      old: ledgerArrayLineRange(fileAtRef("HEAD", LEDGER_EXEMPT_FILE)),
      new: ledgerArrayLineRange(fileAtRef(":0", LEDGER_EXEMPT_FILE)),
    };
  }

  const diff = stagedDiff();
  const matches = findMatches(diff, ledgerRanges);

  if (matches.length === 0 && !envStaged) {
    process.exit(0); // nothing protected touched, commit proceeds normally
  }

  if (checkOverride()) {
    console.error("check-protected-logic: override marker present and fresh - allowing this commit through. This should be rare and human-initiated only.");
    process.exit(0);
  }

  console.error("");
  console.error("=== COMMIT BLOCKED: touches protected live-trading-safety logic ===");
  if (envStaged) console.error("  - .env is staged directly. This must never be committed.");
  for (const m of matches) {
    console.error(`  - ${m.file}: matched "${m.pattern}" -> ${m.line}`);
  }
  console.error("");
  console.error("If you are an unattended scheduled run: this is not something to work around.");
  console.error("Set control.status = \"BLOCKED\", explain what you were trying to do and why");
  console.error("it touched protected logic, notify, and stop. Do not create the override marker");
  console.error("yourself - you cannot, and should not try to.");
  console.error("");
  console.error("If you are the human and this change is deliberate and reviewed:");
  console.error(`  create ${OVERRIDE_MARKER} (any content, e.g. \`touch ${OVERRIDE_MARKER}\`) immediately`);
  console.error("  before committing, then commit again. The marker is consumed on first use.");
  console.error("");
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { findMatches, ledgerArrayLineRange, isLedgerExempt, PROTECTED_PATTERNS };
