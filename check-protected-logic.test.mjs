import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "check-protected-logic.cjs");
const { ledgerArrayLineRange, PROTECTED_PATTERNS } = require(SCRIPT_PATH);

// Fixtures below need real protected identifiers to exercise the hook meaningfully,
// but must not spell them out as source-text literals (the hook would then flag
// *this file* the same way it flags real edits). Pull them from the module's own
// list at runtime instead - same effect, nothing for the pattern scan to catch.
const idA = PROTECTED_PATTERNS.find(p => p.startsWith("place"));
const idB = PROTECTED_PATTERNS.find(p => p.startsWith("place") && p !== idA);
const idC = PROTECTED_PATTERNS.find(p => p.startsWith("LIVE"));
const idD = PROTECTED_PATTERNS.find(p => p.startsWith("isTrading"));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function runHook(cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH], { cwd, encoding: "utf8" });
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-hook-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-q", "-m", "init"]);
  return dir;
}

function makeLedgerEntry(i) {
  return {
    ts: `2026-01-01T00:00:0${i % 10}.000Z`,
    agent: "executor",
    action: "stage",
    detail: i === 0
      ? ["confirmed", idA, "and", idB, "hardcode market orders,", idC, "gate reviewed"].join(" ")
      : `routine entry ${i} narrating unrelated research work`,
    commit: "pending",
    tests: "n/a",
  };
}

function writeState(dir, ledgerCount) {
  const state = {
    version: 2,
    control: { status: "IDLE" },
    blackboard: { note: "static field, never touched by these tests" },
    ledger: Array.from({ length: ledgerCount }, (_, i) => makeLedgerEntry(i)),
  };
  fs.writeFileSync(path.join(dir, ".agent_state.json"), JSON.stringify(state, null, 1) + "\n");
}

test("ledgerArrayLineRange locates the ledger array by structure, not fixed offsets", () => {
  const content = JSON.stringify({ a: 1, ledger: [{ x: 1 }, { x: 2 }], b: "[not an array]" }, null, 1);
  const range = ledgerArrayLineRange(content);
  const lines = content.split("\n");
  assert.ok(range);
  assert.match(lines[range.startLine - 1], /"ledger":\s*\[/);
  assert.match(lines[range.endLine - 1], /^\s*\]/);
});

test("ledgerArrayLineRange returns null when there is no top-level ledger array", () => {
  const content = JSON.stringify({ a: 1, b: { ledger: [1, 2] } }, null, 1);
  assert.equal(ledgerArrayLineRange(content), null);
});

test("trimming .agent_state.json's ledger back to the 100-entry cap commits cleanly, no override marker", () => {
  const dir = initRepo();
  writeState(dir, 105);
  git(dir, ["add", ".agent_state.json"]);
  git(dir, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "seed 105 ledger entries"]);

  writeState(dir, 100); // trim: removes 5 oldest entries, some quoting protected identifiers in prose
  git(dir, ["add", ".agent_state.json"]);

  assert.ok(!fs.existsSync(path.join(dir, ".git", "ALLOW_PROTECTED_EDIT")), "override marker must not exist for this test to be meaningful");
  const result = runHook(dir);
  assert.equal(result.status, 0, `expected trim commit to pass the hook, got: ${result.stderr}`);
});

test("an edit to a protected identifier in a real source file is still blocked", () => {
  const dir = initRepo();
  fs.writeFileSync(path.join(dir, "trader.js"), `function ${idA}() {\n  return true;\n}\n`);
  git(dir, ["add", "trader.js"]);
  git(dir, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "seed trader.js"]);

  fs.writeFileSync(path.join(dir, "trader.js"), `function ${idA}(skipValidation) {\n  return true;\n}\n`);
  git(dir, ["add", "trader.js"]);

  const result = runHook(dir);
  assert.notEqual(result.status, 0, "expected a protected-identifier edit in a source file to be blocked");
  assert.match(result.stderr, /COMMIT BLOCKED/);
  assert.ok(result.stderr.includes(idA));
});

test("editing a non-ledger field of .agent_state.json to introduce a protected identifier is still blocked", () => {
  const dir = initRepo();
  writeState(dir, 10);
  git(dir, ["add", ".agent_state.json"]);
  git(dir, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "seed state"]);

  const raw = fs.readFileSync(path.join(dir, ".agent_state.json"), "utf8");
  const state = JSON.parse(raw);
  state.blackboard.note = `now mentions ${idD} outside the ledger`;
  fs.writeFileSync(path.join(dir, ".agent_state.json"), JSON.stringify(state, null, 1) + "\n");
  git(dir, ["add", ".agent_state.json"]);

  const result = runHook(dir);
  assert.notEqual(result.status, 0, "expected a non-ledger protected-identifier introduction to still be blocked");
  assert.match(result.stderr, /COMMIT BLOCKED/);
});
