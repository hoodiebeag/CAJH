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

const { execSync } = require("node:child_process");

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

function findMatches(diff) {
  const hits = [];
  let currentFile = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const f = line.slice(6);
      if (f !== "/dev/null") currentFile = f;
      continue;
    }
    if (!(line.startsWith("+") || line.startsWith("-"))) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
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

// Also block staged changes to .env directly, regardless of pattern matching -
// it should never be tracked at all, but this is a second, independent check.
const envStaged = stagedFiles().some(f => f === ".env" || f.endsWith("/.env"));

const diff = stagedDiff();
const matches = findMatches(diff);

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
