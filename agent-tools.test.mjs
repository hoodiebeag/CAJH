import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAgentFile, writeAgentFile, listAgentDir,
  executeAgentScript, executeAgentInline,
  createHypothesis, loadHypothesis, listPendingHypotheses, assertHypothesisExecutable, recordHypothesisResult,
} from "./agent-tools.mjs";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cajh-agent-tools-"));
}

function withDataDir(dir, fn) {
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
}

// ─── file read/write/list ───────────────────────────────────────────────────────

test("writeAgentFile writes under an allowed subdir and readAgentFile reads it back", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    writeAgentFile("hypotheses/h1.json", JSON.stringify({ a: 1 }));
    assert.equal(readAgentFile("hypotheses/h1.json"), JSON.stringify({ a: 1 }));
    assert.deepEqual(listAgentDir("hypotheses").map((e) => e.name), ["h1.json"]);
  });
});

test("readAgentFile also reads project-root files (e.g. tournament.mjs) without copy-paste", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    const text = readAgentFile("package.json");
    assert.match(text, /"name": "cajh"/);
  });
});

test("readAgentFile rejects a path escaping DATA_DIR and the project root", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => readAgentFile("../../etc/passwd"), /escapes/);
  });
});

test("readAgentFile enforces the 500KB cap", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    fs.mkdirSync(path.join(dir, "agent-notes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-notes", "big.txt"), "x".repeat(500 * 1024 + 1));
    assert.throws(() => readAgentFile("agent-notes/big.txt"), /cap/);
  });
});

test("writeAgentFile rejects a protected source-file basename", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => writeAgentFile("research-runs/bot.js", "x"), /protected source-file/);
    assert.throws(() => writeAgentFile("hypotheses/../bot.js", "x"), /(protected source-file|escapes|Writes are only allowed)/);
  });
});

test("writeAgentFile rejects paths outside the three allowed subdirs, including traversal out of them", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => writeAgentFile("config.json", "x"), /Writes are only allowed/);
    assert.throws(() => writeAgentFile("hypotheses/../../outside.txt", "x"), /Writes are only allowed/);
  });
});

test("writeAgentFile enforces the 200KB write cap", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => writeAgentFile("agent-notes/big.txt", "x".repeat(200 * 1024 + 1)), /cap/);
  });
});

test("agent-tools exports no delete function", async () => {
  assert.equal(typeof (await import("./agent-tools.mjs")).deleteAgentFile, "undefined");
});

// ─── hypothesis schema ───────────────────────────────────────────────────────────

const hypFields = {
  hypothesis: "1h swing-low anticipation on ETH beats holding cash",
  entryFamily: "anticipate",
  trainPeriod: { start: "2024-01-01", end: "2025-01-01" },
  holdoutPeriod: { start: "2025-01-01", end: "2026-01-01" },
  passCriteria: "holdout avgR > 0 and trades >= 30",
  killCriteria: "holdout avgR <= 0 or trades < 30",
};

test("createHypothesis writes a schema-complete pending record; missing fields are rejected", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    const record = createHypothesis({ id: "eth-anticipate-1", ...hypFields });
    assert.equal(record.status, "pending");
    assert.equal(record.id, "eth-anticipate-1");
    assert.equal(loadHypothesis("eth-anticipate-1").hypothesis, hypFields.hypothesis);
    assert.throws(() => createHypothesis({ id: "bad" }), /missing required field/);
  });
});

test("assertHypothesisExecutable enforces the 60s cooling-off period", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    createHypothesis({ id: "cool-1", ...hypFields });
    assert.throws(() => assertHypothesisExecutable("cool-1"), /wait \d+s more/);
    // Back-date creation past the 60s window to prove the gate lifts once old enough.
    const rel = path.join(dir, "hypotheses", "cool-1.json");
    const record = JSON.parse(fs.readFileSync(rel, "utf8"));
    record.createdAt = new Date(Date.now() - 61_000).toISOString();
    fs.writeFileSync(rel, JSON.stringify(record));
    assert.doesNotThrow(() => assertHypothesisExecutable("cool-1"));
  });
});

test("recordHypothesisResult resolves to passed or killed and listPendingHypotheses drops it", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    createHypothesis({ id: "res-1", ...hypFields });
    assert.equal(listPendingHypotheses().length, 1);
    const updated = recordHypothesisResult("res-1", "killed", { holdoutAvgR: -0.2, trades: 40 });
    assert.equal(updated.status, "killed");
    assert.deepEqual(updated.result, { holdoutAvgR: -0.2, trades: 40 });
    assert.equal(listPendingHypotheses().length, 0);
    assert.throws(() => recordHypothesisResult("res-1", "banana", {}), /passed.*killed/);
  });
});

// ─── code execution ──────────────────────────────────────────────────────────────

test("executeAgentInline runs a benign script and captures stdout", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    const { stdout, status } = executeAgentInline("console.log('hello-from-agent')");
    assert.equal(status, 0);
    assert.match(stdout, /hello-from-agent/);
  });
});

test("executeAgentInline blocks network and shell-out patterns before running", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => executeAgentInline("await fetch('https://example.com')"), /Blocked/);
    assert.throws(() => executeAgentInline("import('node:child_process')"), /Blocked/);
    assert.throws(() => executeAgentInline("require('axios')"), /Blocked/);
  });
});

test("executeAgentInline blocks bare forbidden identifiers, not just call/import syntax", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => executeAgentInline("const mod = child_process"), /Blocked/);
    assert.throws(() => executeAgentInline("const f = fetch"), /Blocked/);
    assert.throws(() => executeAgentInline("const g = eval"), /Blocked/);
    assert.throws(() => executeAgentInline("const F = Function('return 1')"), /Blocked/);
    assert.throws(() => executeAgentInline("const h = net"), /Blocked/);
  });
});

test("executeAgentInline blocks a forbidden identifier split across concatenated string literals", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    // The two concrete bypasses named in AGENT-TOOLS-SANDBOX-HARDENING: neither
    // "child_process" nor "fetch" appears contiguous in the raw source, only after
    // the adjacent string literals are joined.
    assert.throws(() => executeAgentInline('await import("node:child_" + "process")'), /Blocked/);
    assert.throws(() => executeAgentInline('globalThis["fe" + "tch"]("http://x")'), /Blocked/);
    assert.throws(() => executeAgentInline('const x = "ax" + "ios"'), /Blocked/);
  });
});

test("broadened scan does not false-positive on identifiers that merely contain a forbidden token as a fragment", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    const { stdout, status } = executeAgentInline(
      "// evaluate the internet-facing netProfit metric\nconst netProfit = 12; console.log(netProfit)"
    );
    assert.equal(status, 0);
    assert.match(stdout, /12/);
  });
});

test("executeAgentInline and executeAgentScript reject --experimental-* flags", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => executeAgentInline("1", ["--experimental-fetch"]), /Disallowed flag/);
    assert.throws(() => executeAgentScript("tournament.mjs", ["--experimental-vm-modules"]), /Disallowed flag/);
  });
});

test("executeAgentScript refuses to run bot.js under any name", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => executeAgentScript("bot.js"), /Only tournament\.mjs, portfolio\.mjs/);
  });
});

test("executeAgentScript only runs a hypotheses/*.mjs file that calls saveExperiment and has no forbidden pattern", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    fs.mkdirSync(path.join(dir, "hypotheses"), { recursive: true });
    fs.writeFileSync(path.join(dir, "hypotheses", "nosave.mjs"), "console.log('no save call')");
    assert.throws(() => executeAgentScript("hypotheses/nosave.mjs"), /must call saveExperiment/);

    fs.writeFileSync(path.join(dir, "hypotheses", "networked.mjs"),
      "import { saveExperiment } from '../researchlab.mjs'; await fetch('https://x');");
    assert.throws(() => executeAgentScript("hypotheses/networked.mjs"), /Blocked/);

    fs.writeFileSync(path.join(dir, "hypotheses", "ok.mjs"),
      "console.log(JSON.stringify({ status: 'killed', result: { note: 'saveExperiment(x,y,z) called for real elsewhere' } }));");
    const { stdout, status } = executeAgentScript("hypotheses/ok.mjs");
    assert.equal(status, 0);
    assert.match(stdout, /"status":"killed"/);
  });
});

test("executeAgentScript rejects a path escaping DATA_DIR/hypotheses", () => {
  const dir = tempDataDir();
  withDataDir(dir, () => {
    assert.throws(() => executeAgentScript("../outside.mjs"), /Only tournament\.mjs, portfolio\.mjs/);
    assert.throws(() => executeAgentScript("hypotheses/../../evil.mjs"), /Only tournament\.mjs, portfolio\.mjs/);
  });
});
