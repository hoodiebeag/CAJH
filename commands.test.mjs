import test from "node:test";
import assert from "node:assert/strict";
import { chatHistoryFor, appendChatTurn, clearChatHistory, handleChartRequest } from "./commands.js";

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
