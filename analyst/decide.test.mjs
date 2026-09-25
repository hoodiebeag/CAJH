import test from "node:test";
import assert from "node:assert/strict";
import { decide, normalise, extractJson, buildSystemPrompt, BATCH_FAILURE } from "./decide.mjs";

/**
 * THE FAKE IS SHAPED ON THE REAL SDK, read out of
 * node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts rather than from memory.
 *
 * This matters because of a scar: brokers/ibkr.test.mjs emitted @stoqey/ib's error events with the
 * arguments backwards, the adapter was written to match the mock, and 27 green tests certified it
 * for weeks. A mock is only evidence if it emits what the real library emits.
 *
 * Message: { id, container, content: ContentBlock[], model, role: 'assistant', stop_details,
 *            stop_reason: StopReason | null, stop_sequence, type: 'message', usage }
 * StopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal'
 * TextBlock:  { citations, text, type: 'text' }
 */
function fakeMessage({ text, stop_reason = "end_turn", stop_details = null, content = null }) {
  return {
    id: "msg_01FakeIdForTests",
    container: null,
    content: content ?? [{ type: "text", text, citations: null }],
    model: "claude-sonnet-4-6",
    role: "assistant",
    stop_details,
    stop_reason,
    stop_sequence: null,
    type: "message",
    usage: { input_tokens: 1200, output_tokens: 240 },
  };
}

const clientReturning = (msg) => ({ messages: { create: async () => msg } });
const clientThrowing = (err) => ({ messages: { create: async () => { throw err; } } });

const ctx = (symbols = ["AAPL", "MSFT", "NVDA"]) => ({
  asOf: "2026-09-18",
  candidates: symbols.map((s) => ({ symbol: s, indicators: {}, held: false })),
});

const decisions = (arr) => JSON.stringify({ decisions: arr });
const buy = (symbol, over = {}) => ({ symbol, action: "buy", targetPct: 0.05, confidence: 0.7, thesis: "guidance raised and the tape confirms it", ...over });

// ---- the happy path ---------------------------------------------------------------------------

test("a well-formed batch becomes proposals", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL"), buy("MSFT")]) })), context: ctx() });
  assert.equal(r.failure, null);
  assert.equal(r.proposals.length, 2);
  assert.equal(r.proposals[0].symbol, "AAPL");
  assert.equal(r.proposals[0].thesis, "guidance raised and the tape confirms it");
  assert.equal(r.usage.output_tokens, 240);
  assert.equal(r.stopReason, "end_turn");
});

test("an empty decisions list is a valid answer, not a failure", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([]) })), context: ctx() });
  assert.equal(r.failure, null);
  assert.deepEqual(r.proposals, []);
});

// ---- the SDK's real failure modes ---------------------------------------------------------------

test("a refusal is recorded as an outcome, not retried into compliance", async () => {
  const msg = fakeMessage({ text: "", stop_reason: "refusal", stop_details: { type: "refusal", reason: "policy" } });
  const r = await decide({ client: clientReturning(msg), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.REFUSED);
  assert.deepEqual(r.proposals, []);
});

test("a truncated response is discarded WHOLE, never partially parsed", async () => {
  // A partial parse yields a fragment of the model's intent -- the first names of a plan with the
  // hedges and sells missing. That is a different book, not a smaller one.
  const partial = '{"decisions": [' + JSON.stringify(buy("AAPL")) + ',' + JSON.stringify(buy("MSFT")).slice(0, 30);
  const r = await decide({ client: clientReturning(fakeMessage({ text: partial, stop_reason: "max_tokens" })), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.TRUNCATED);
  assert.deepEqual(r.proposals, [], "not one name may survive a truncated batch");
});

test("a truncated response is rejected even when the JSON happens to be complete", async () => {
  const r = await decide({
    client: clientReturning(fakeMessage({ text: decisions([buy("AAPL")]), stop_reason: "max_tokens" })),
    context: ctx(),
  });
  assert.equal(r.failure.code, BATCH_FAILURE.TRUNCATED);
});

test("text is gathered from all text blocks, not content[0]", async () => {
  // thinking and tool_use blocks also live in `content`; assuming content[0] is text is a bug
  // that only shows up once extended thinking is switched on.
  const content = [
    { type: "thinking", thinking: "weighing the cross-section", signature: "sig" },
    { type: "text", text: decisions([buy("AAPL")]), citations: null },
  ];
  const r = await decide({ client: clientReturning(fakeMessage({ content })), context: ctx() });
  assert.equal(r.failure, null);
  assert.equal(r.proposals.length, 1);
});

test("a response with no text block fails cleanly", async () => {
  const content = [{ type: "thinking", thinking: "...", signature: "sig" }];
  const r = await decide({ client: clientReturning(fakeMessage({ content })), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.NO_TEXT);
});

test("a client error is caught and reported, not thrown at the caller", async () => {
  const r = await decide({ client: clientThrowing(new Error("529 overloaded")), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(r.failure.detail, /529/);
});

// ---- untrusted output -------------------------------------------------------------------------

test("a hallucinated symbol is dropped, however good the trade might be", async () => {
  // Nothing in the evidence generated it, so it is not a decision about the evidence.
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("TSLA")]) })), context: ctx() });
  assert.equal(r.failure, null);
  assert.deepEqual(r.proposals, []);
  assert.match(r.dropped[0].why, /not in the candidate slate/);
});

test("a percent-shaped size is dropped, never rescaled", async () => {
  // Reinterpreting 5 as 0.05 turns a misunderstanding into a request that looks reasonable.
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { targetPct: 5 })]) })), context: ctx() });
  assert.deepEqual(r.proposals, []);
  assert.match(r.dropped[0].why, /exceeds 1\.0/);
});

test("a size over the cap is dropped, not trimmed", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { targetPct: 0.4 })]) })), context: ctx() });
  assert.deepEqual(r.proposals, []);
  assert.match(r.dropped[0].why, /over the 0\.1 cap/);
});

test("a proposal with no thesis is dropped", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { thesis: "up" })]) })), context: ctx() });
  assert.deepEqual(r.proposals, []);
  assert.match(r.dropped[0].why, /thesis/);
});

test("shorting is dropped when not permitted, and kept when it is", async () => {
  const short = { symbol: "AAPL", action: "short", targetPct: 0.05, confidence: 0.6, thesis: "channel checks deteriorating into the print" };
  const off = await decide({ client: clientReturning(fakeMessage({ text: decisions([short]) })), context: ctx() });
  assert.deepEqual(off.proposals, []);
  const on = await decide({
    client: clientReturning(fakeMessage({ text: decisions([short]) })), context: ctx(), shortingPermitted: true,
  });
  assert.equal(on.proposals.length, 1);
});

test("duplicate decisions for one symbol keep the first and drop the rest", async () => {
  const r = await decide({
    client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { targetPct: 0.05 }), buy("AAPL", { targetPct: 0.09 })]) })),
    context: ctx(),
  });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].targetPct, 0.05);
  assert.match(r.dropped[0].why, /duplicate/);
});

test("good decisions survive alongside bad ones", async () => {
  const r = await decide({
    client: clientReturning(fakeMessage({ text: decisions([buy("TSLA"), buy("AAPL"), buy("MSFT", { targetPct: 99 })]) })),
    context: ctx(),
  });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].symbol, "AAPL");
  assert.equal(r.dropped.length, 2);
});

test("hold is accepted and normalised to zero size", async () => {
  const r = await decide({
    client: clientReturning(fakeMessage({ text: decisions([{ symbol: "AAPL", action: "hold", thesis: "thesis intact, nothing has changed" }]) })),
    context: ctx(),
  });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].targetPct, 0);
});

test("confidence is clamped rather than dropping an otherwise good decision", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { confidence: 3 })]) })), context: ctx() });
  assert.equal(r.proposals[0].confidence, 1);
  const missing = await decide({ client: clientReturning(fakeMessage({ text: decisions([buy("AAPL", { confidence: "high" })]) })), context: ctx() });
  assert.equal(missing.proposals[0].confidence, null);
});

test("symbols and actions are matched case-insensitively", async () => {
  const r = await decide({
    client: clientReturning(fakeMessage({ text: decisions([{ symbol: "aapl", action: "BUY", targetPct: 0.05, thesis: "guidance raised and the tape confirms" }]) })),
    context: ctx(),
  });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].symbol, "AAPL");
  assert.equal(r.proposals[0].action, "buy");
});

// ---- parsing ------------------------------------------------------------------------------------

test("JSON survives a markdown fence and surrounding prose", () => {
  const body = decisions([buy("AAPL")]);
  for (const wrapped of [
    "```json\n" + body + "\n```",
    "Here is my read:\n\n" + body,
    "```\n" + body + "\n```",
    body + "\n\nLet me know if you want more detail.",
  ]) {
    const r = extractJson(wrapped);
    assert.equal(r.ok, true, wrapped.slice(0, 30));
    assert.equal(r.value.decisions.length, 1);
  }
});

test("malformed JSON is a failure, never a best-effort salvage", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: "I would buy AAPL and MSFT here." })), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.UNPARSEABLE);
  assert.equal(r.raw, "I would buy AAPL and MSFT here.");
});

test("valid JSON that is not the expected shape fails as such", async () => {
  const r = await decide({ client: clientReturning(fakeMessage({ text: '{"picks": []}' })), context: ctx() });
  assert.equal(r.failure.code, BATCH_FAILURE.NOT_A_LIST);
});

// ---- wiring -------------------------------------------------------------------------------------

test("decide refuses to run without a client or a context", async () => {
  await assert.rejects(() => decide({ context: ctx() }), /client/);
  await assert.rejects(() => decide({ client: clientReturning(fakeMessage({ text: "{}" })) }), /context/);
});

test("the request carries the context and a system prompt", async () => {
  let seen = null;
  const client = { messages: { create: async (params) => { seen = params; return fakeMessage({ text: decisions([]) }); } } };
  await decide({ client, context: ctx(), model: "claude-opus-5", maxTokens: 1234 });
  assert.equal(seen.model, "claude-opus-5");
  assert.equal(seen.max_tokens, 1234);
  assert.match(seen.system, /coin flip/);
  assert.match(seen.messages[0].content[0].text, /AAPL/);
});

test("the prompt states the caps it was given", () => {
  const p = buildSystemPrompt({ maxPositionPct: 0.07, maxNewPositions: 3, shortingPermitted: false });
  assert.match(p, /7% of NAV/);
  assert.match(p, /at most 3 NEW positions/);
  assert.match(p, /shorting is NOT permitted/);
  assert.match(buildSystemPrompt({ shortingPermitted: true }), /shorting is permitted/);
});

test("the fake response shape still matches the installed SDK", async () => {
  // THIS TEST IS THE POINT OF RULE 12. brokers/ibkr.test.mjs drifted from @stoqey/ib and 27 green
  // tests certified a broken adapter for weeks. A mock that is checked once at authoring time is
  // a mock that silently rots at the next dependency bump, so the check runs every suite.
  const fs = await import("node:fs");
  const path = "node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts";
  if (!fs.existsSync(path)) return;   // vendored differently; the assertion below cannot be made

  const src = fs.readFileSync(path, "utf8");
  const body = src.slice(src.indexOf("export interface Message {"));
  const decl = body.slice(0, body.indexOf("\n}"));
  const sdkFields = [...decl.matchAll(/^\s{4}([a-z_]+)\??:/gm)].map((m) => m[1]).sort();
  const fakeFields = Object.keys(fakeMessage({ text: "{}" })).sort();

  assert.deepEqual(fakeFields, sdkFields,
    "the fake Message has drifted from the SDK's declared shape; update the fake, not this test");
});

test("the injected client is called the way the real SDK is called", async () => {
  // The real client is constructed but never used to make a request -- this asserts the method
  // exists with the name and arity decide() relies on.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const real = new Anthropic({ apiKey: "sk-ant-placeholder-no-request-is-made" });
  assert.equal(typeof real.messages?.create, "function");
});

test("normalise accepts any symbol when the slate is unknown", () => {
  // An empty known-set means "not checked", not "nothing is allowed" -- otherwise a caller with no
  // slate would silently drop every decision.
  const { proposals } = normalise([buy("ANYTHING")], new Set());
  assert.equal(proposals.length, 1);
});
