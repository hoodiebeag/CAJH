import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatHistoryFor, appendChatTurn, clearChatHistory, handleChartRequest, handleResearch, handleNotes } from "./commands.js";

// Regression coverage for the chart-request gate: it must require a literal $ prefix
// (e.g. $BTC) and never fall through to picking an arbitrary short word out of
// ordinary conversation as a "symbol". A prior version matched common verbs
// ("send", "get", "give", "show", "pull") anywhere in the message and then grabbed
// any other 2-5 letter word not in a small stopword list — so "can you send that
// over" misfired by treating "can" as a symbol.
test("handleChartRequest ignores ordinary chat containing chart-adjacent verbs", async () => {
  const nonTriggers = [
    "can you send that over",
    "give it a sec",
    "I'll get back to you",
    "hello",
    "what",
  ];
  for (const msg of nonTriggers) {
    assert.equal(await handleChartRequest({}, msg, {}), false, `expected no chart request for: "${msg}"`);
  }
});

test("handleChartRequest without a $ prefix never reaches the network path even with a chart keyword", async () => {
  assert.equal(await handleChartRequest({}, "show me the rundown please", {}), false);
});

test("chatHistoryFor starts empty and appendChatTurn records user/assistant pairs in order", () => {
  const state = {};
  assert.deepEqual(chatHistoryFor(state, "chan-1"), []);

  appendChatTurn(state, "chan-1", "hi", "hello");
  assert.deepEqual(chatHistoryFor(state, "chan-1"), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);

  appendChatTurn(state, "chan-1", "how are you", "good");
  assert.deepEqual(chatHistoryFor(state, "chan-1"), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "how are you" },
    { role: "assistant", content: "good" },
  ]);
});

test("chat history is isolated per channel", () => {
  const state = {};
  appendChatTurn(state, "chan-1", "a", "b");
  appendChatTurn(state, "chan-2", "x", "y");
  assert.deepEqual(chatHistoryFor(state, "chan-1"), [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  assert.deepEqual(chatHistoryFor(state, "chan-2"), [{ role: "user", content: "x" }, { role: "assistant", content: "y" }]);
});

test("chat history is capped so a long-lived channel cannot grow it unbounded", () => {
  const state = {};
  for (let i = 0; i < 30; i++) appendChatTurn(state, "chan-1", `msg${i}`, `reply${i}`);
  const history = chatHistoryFor(state, "chan-1");
  assert.equal(history.length, 20);
  // Oldest turns are dropped from the front; the most recent exchange is last.
  assert.equal(history[0].content, "msg20");
  assert.equal(history.at(-1).content, "reply29");
});

test("clearChatHistory removes only the requested channel's history", () => {
  const state = {};
  appendChatTurn(state, "chan-1", "a", "b");
  appendChatTurn(state, "chan-2", "x", "y");

  clearChatHistory(state, "chan-1");

  assert.deepEqual(chatHistoryFor(state, "chan-1"), []);
  assert.deepEqual(chatHistoryFor(state, "chan-2"), [{ role: "user", content: "x" }, { role: "assistant", content: "y" }]);
});

test("clearChatHistory on a state object with no prior history is a safe no-op", () => {
  const state = {};
  assert.doesNotThrow(() => clearChatHistory(state, "chan-1"));
  assert.deepEqual(chatHistoryFor(state, "chan-1"), []);
});

// ─── handleResearch / handleNotes — end-to-end via the real agent-tools.mjs ───────
// Owner-only gating for these two commands lives in bot.js's messageCreate dispatcher,
// not in commands.js itself (handleResearch/handleNotes trust their caller). bot.js is
// exercised separately in bot-lifecycle.test.mjs; these tests cover what commands.js
// itself is responsible for — running the real hypothesis lifecycle through the actual
// (non-mocked) agent-tools.mjs, not agent-tools.test.mjs's isolated unit coverage.

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cajh-commands-"));
}

async function withDataDir(dir, fn) {
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
}

function fakeMessage() {
  const replies = [];
  const sent = [];
  return {
    replies,
    sent,
    reply: async (text) => { replies.push(text); return { content: text }; },
    channel: { send: async (text) => { sent.push(text); return { content: text }; } }
  };
}

function writeHypothesis(dir, id, { status = "pending", ageMs = 61_000 } = {}) {
  fs.mkdirSync(path.join(dir, "hypotheses"), { recursive: true });
  const record = {
    schema: "cajh-hypothesis/v1",
    id,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
    hypothesis: "test hypothesis",
    entryFamily: "anticipate",
    trainPeriod: { start: "2024-01-01", end: "2025-01-01" },
    holdoutPeriod: { start: "2025-01-01", end: "2026-01-01" },
    passCriteria: "holdout avgR > 0",
    killCriteria: "holdout avgR <= 0",
    status
  };
  fs.writeFileSync(path.join(dir, "hypotheses", `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

test("handleResearch replies plainly when DATA_DIR/hypotheses has no pending hypotheses", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    const msg = fakeMessage();
    await handleResearch(msg);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0], /No pending hypotheses/);
  });
});

test("handleResearch reports the exact cooling-off reason instead of running a too-young hypothesis", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    writeHypothesis(dir, "too-young", { ageMs: 5_000 });
    const msg = fakeMessage();
    await handleResearch(msg);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0], /No hypothesis is ready to run yet/);
    assert.match(msg.replies[0], /too-young/);
    assert.match(msg.replies[0], /wait \d+s more/);
  });
});

test("handleResearch runs a ready hypothesis end-to-end through the real agent-tools.mjs and records a passed result", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    writeHypothesis(dir, "h-pass");
    fs.writeFileSync(
      path.join(dir, "hypotheses", "h-pass.mjs"),
      "// saveExperiment( — satisfies executeAgentScript's source gate for this fixture\n" +
      "console.log(JSON.stringify({ status: 'passed', result: { holdoutAvgR: 0.3 } }));\n"
    );
    const msg = fakeMessage();
    await handleResearch(msg);

    assert.match(msg.replies[0], /Running \*\*h-pass\*\*/);
    assert.equal(msg.sent.length, 1);
    assert.match(msg.sent[0], /^✅ \*\*h-pass\*\* → \*\*passed\*\*/);

    const persisted = JSON.parse(fs.readFileSync(path.join(dir, "hypotheses", "h-pass.json"), "utf8"));
    assert.equal(persisted.status, "passed");
    assert.deepEqual(persisted.result, { holdoutAvgR: 0.3 });
  });
});

test("handleResearch records a killed result when the hypothesis script exits non-zero", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    writeHypothesis(dir, "h-kill");
    fs.writeFileSync(
      path.join(dir, "hypotheses", "h-kill.mjs"),
      "// saveExperiment( — satisfies executeAgentScript's source gate for this fixture\n" +
      "process.exit(1);\n"
    );
    const msg = fakeMessage();
    await handleResearch(msg);

    assert.match(msg.sent[0], /^🛑 \*\*h-kill\*\* → \*\*killed\*\*/);
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, "hypotheses", "h-kill.json"), "utf8"));
    assert.equal(persisted.status, "killed");
    assert.match(persisted.result.error, /h-kill\.mjs exited 1/);
  });
});

test("handleNotes lists agent notes when called without a slug, and reports an empty directory plainly", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    const empty = fakeMessage();
    await handleNotes(empty, null);
    assert.match(empty.replies[0], /No agent notes yet/);

    fs.mkdirSync(path.join(dir, "agent-notes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-notes", "b.txt"), "b");
    fs.writeFileSync(path.join(dir, "agent-notes", "a.txt"), "a");

    const listed = fakeMessage();
    await handleNotes(listed, null);
    assert.match(listed.replies[0], /a\.txt/);
    assert.match(listed.replies[0], /b\.txt/);
  });
});

test("handleNotes rejects a slug with path-traversal or unexpected characters without touching the filesystem", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    const msg = fakeMessage();
    await handleNotes(msg, "../../etc/passwd");
    assert.match(msg.replies[0], /Invalid note name/);
  });
});

test("handleNotes reads back a real agent note through the real agent-tools.mjs readAgentFile", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    fs.mkdirSync(path.join(dir, "agent-notes"), { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-notes", "finding-1.md"), "the edge decayed after fees");

    const msg = fakeMessage();
    await handleNotes(msg, "finding-1.md");
    assert.match(msg.replies[0], /agent-notes\/finding-1\.md/);
    assert.match(msg.replies[0], /the edge decayed after fees/);
  });
});

test("handleNotes reports a missing note file by name instead of throwing", async () => {
  const dir = tempDataDir();
  await withDataDir(dir, async () => {
    const msg = fakeMessage();
    await handleNotes(msg, "does-not-exist.md");
    assert.match(msg.replies[0], /File not found: agent-notes\/does-not-exist\.md/);
  });
});
