/**
 * analyst/folder-client.test.mjs — the folder exchange, driven through the REAL decide().
 *
 * WHAT IS REAL HERE AND WHAT IS SYNTHETIC. The code under test is real: `decide()`, `normalise()`
 * and `extractJson()` are imported from analyst/decide.mjs and nothing is stubbed, shadowed or
 * monkeypatched. The DATA is entirely synthetic -- three invented tickers on a hand-built context
 * fixture -- and every file lives in a fresh directory under os.tmpdir(). No network, no API key,
 * no @anthropic-ai/sdk import, no panel, no journal, no broker, no order path, and no real market
 * data of any kind.
 *
 * WHY THE HAPPY PATH GOES THROUGH decide() RATHER THAN ASSERTING ON THE ENVELOPE. An envelope that
 * merely looks like the SDK's proves nothing; the only question worth answering is whether
 * decide() can read it. So the happy-path test hands the folder client to the real decide(), drops
 * a conforming answer in mid-poll, and asserts the proposal arrives having passed the real
 * validators. If the envelope were wrong in any field decide() reads, that test fails.
 *
 * WHY THE FAILURE PATHS CALL create() DIRECTLY. decide() catches everything create() throws and
 * reports one code, CLIENT_ERROR. That is correct behaviour and is asserted once at the end -- but
 * it also erases the distinction between "nobody answered" and "somebody answered the wrong
 * question", which is the whole reason these errors are coded. So the coded errors are observed at
 * the client boundary where they exist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, normalise, BATCH_FAILURE } from "./decide.mjs";
import { makeFolderClient, canonicalJson, contentHashOf, FOLDER_ERROR } from "./folder-client.mjs";

const box = () => fs.mkdtempSync(path.join(os.tmpdir(), "folder-client-"));

/** A synthetic slate. Invented tickers, so nothing here can be mistaken for a real instrument. */
const SLATE = ["ZZA", "ZZB", "ZZC"];

/** The shape decide() actually consumes: it reads `context.candidates[].symbol` and nothing else. */
const ctx = () => ({
  asOf: "2027-01-08",
  universe: { shown: SLATE.length, total: SLATE.length, rankedBy: "synthetic-fixture" },
  candidates: SLATE.map((symbol, i) => ({ symbol, held: false, rank: i + 1 })),
  nav: 100000,
});

const THESIS = "synthetic fixture thesis, long enough to be reviewable";

const decisionsJson = (decisions) => JSON.stringify({ decisions });

/** Read the question the client wrote, so an answer can carry the right hash back. */
const requestOf = (dir, batchId) =>
  JSON.parse(fs.readFileSync(path.join(dir, `request-${batchId}.json`), "utf8"));

/** Write a response file the way an external brain would: complete, then renamed into place. */
function answer(dir, batchId, { text, contentHash, batchIdOverride, raw = null }) {
  const file = path.join(dir, `response-${batchId}.json`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, raw ?? `${JSON.stringify({
    batchId: batchIdOverride ?? batchId,
    contentHash,
    text,
  }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Wait for the client to have written its request, then answer it. Drives the mid-poll case. */
async function answerWhenAsked(dir, batchId, build) {
  const file = path.join(dir, `request-${batchId}.json`);
  for (let i = 0; i < 2000; i++) {
    if (fs.existsSync(file)) {
      answer(dir, batchId, build(requestOf(dir, batchId)));
      return;
    }
    await new Promise((r) => { setTimeout(r, 2); });
  }
  throw new Error("the client never wrote a request file");
}

// =============================================================================================
// HAPPY PATH, END TO END THROUGH THE REAL decide()
// =============================================================================================

test("a conforming answer dropped in mid-poll flows through the real decide() and its validators", async () => {
  const dir = box();
  const batchId = "paper-2027-01-08";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 1, pollMs: 5 });

  const run = decide({ client, context: ctx(), model: "external-brain", maxTokens: 4000 });
  await answerWhenAsked(dir, batchId, (req) => ({
    contentHash: req.contentHash,
    text: decisionsJson([
      { symbol: "ZZA", action: "buy", targetPct: 0.05, confidence: 0.6, thesis: THESIS },
    ]),
  }));
  const r = await run;

  assert.equal(r.failure, null, JSON.stringify(r.failure));
  assert.equal(r.stopReason, "end_turn");
  assert.deepEqual(r.usage, { input_tokens: 0, output_tokens: 0 }, "zero tokens were bought");
  assert.equal(r.proposals.length, 1);
  assert.deepEqual(r.dropped, []);
  // The REAL normalise() produced this, including the fields it adds: it upper-cases the symbol,
  // clamps confidence, and sets the two optional checklist fields to null when absent.
  assert.deepEqual(r.proposals[0], {
    symbol: "ZZA", action: "buy", targetPct: 0.05, confidence: 0.6, thesis: THESIS,
    invalidation: null, costAssumption: null,
  });

  // The request is a readable artifact: this is what a person or a separate process answers.
  const req = requestOf(dir, batchId);
  assert.equal(req.batchId, batchId);
  assert.equal(req.model, "external-brain");
  assert.equal(req.max_tokens, 4000);
  assert.match(req.contentHash, /^[0-9a-f]{64}$/);
  assert.match(req.createdAt, /^\d{4}-\d\d-\d\dT/);
  // The question is recorded in the shape decide() sent it, so the answerer sees exactly what was
  // asked: one user message whose single text block is the serialised context.
  assert.match(req.system, /You are a portfolio analyst/);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, "user");
  assert.deepEqual(JSON.parse(req.messages[0].content[0].text).candidates.map((c) => c.symbol), SLATE);

  // Nothing outside the exchange directory, and nothing but the two files inside it.
  assert.deepEqual(fs.readdirSync(dir).sort(), [`request-${batchId}.json`, `response-${batchId}.json`]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an answer already on disk is picked up without waiting a single poll interval", async () => {
  const dir = box();
  const batchId = "paper-prefilled";
  const hash = contentHashOf({
    system: "S", messages: [{ role: "user", content: [{ type: "text", text: "T" }] }],
  });
  // ttl 0 gives the loop exactly one look, and pollMs is a minute: if the response were checked
  // only AFTER the deadline test, or only after a sleep, this would time out instead of resolving.
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 60_000 });
  // Write the request ourselves so the hash is known, then the answer, then call.
  fs.writeFileSync(path.join(dir, `request-${batchId}.json`), JSON.stringify({ batchId, contentHash: hash }));
  answer(dir, batchId, { contentHash: hash, text: decisionsJson([]) });

  const res = await client.messages.create({
    model: "m", max_tokens: 10,
    system: "S", messages: [{ role: "user", content: [{ type: "text", text: "T" }] }],
  });
  assert.deepEqual(res.content, [{ type: "text", text: decisionsJson([]) }]);
  assert.equal(res.stop_reason, "end_turn");
  fs.rmSync(dir, { recursive: true, force: true });
});

// =============================================================================================
// THE CONTENT HASH
// =============================================================================================

test("the same question hashes the same way and either half changes it", () => {
  const system = "S";
  const messages = [{ role: "user", content: [{ type: "text", text: "T" }] }];

  const a = contentHashOf({ system, messages });
  const b = contentHashOf({ system, messages: JSON.parse(JSON.stringify(messages)) });
  assert.equal(a, b, "identical {system, messages} must hash identically");
  assert.match(a, /^[0-9a-f]{64}$/);

  assert.notEqual(contentHashOf({ system: "S ", messages }), a, "a changed system changes the hash");
  assert.notEqual(
    contentHashOf({ system, messages: [{ role: "user", content: [{ type: "text", text: "T2" }] }] }),
    a, "a changed message changes the hash");

  // KEY ORDER MUST NOT MATTER, which is what "canonical" buys; ARRAY ORDER MUST, because messages
  // are a sequence and reordering them asks something else.
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }),
    "an explicitly-undefined field is the same question as an absent one");
});

test("the hash the client records is the hash of the question decide() sent", async () => {
  const dir = box();
  const batchId = "hash-pin";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });
  const context = ctx();
  // decide() never rejects -- it catches client errors -- so the timeout here is expected and the
  // artifact it leaves behind is what this test is about.
  const r = await decide({ client, context, model: "m" });
  assert.equal(r.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  const req = requestOf(dir, batchId);
  assert.equal(req.contentHash, contentHashOf({ system: req.system, messages: req.messages }),
    "the recorded hash is reproducible from the recorded question");
  fs.rmSync(dir, { recursive: true, force: true });
});

// =============================================================================================
// EVERY BAD ANSWER IS A CODED, LOUD FAILURE -- NEVER A SILENT CONTINUATION OF THE POLL
// =============================================================================================

/** Set up a request, then answer it badly, and return the rejection. */
async function failWith(batchId, build, { ttlMinutes = 5, pollMs = 5 } = {}) {
  const dir = box();
  const client = makeFolderClient({ dir, batchId, ttlMinutes, pollMs });
  const system = "S";
  const messages = [{ role: "user", content: [{ type: "text", text: "T" }] }];
  const hash = contentHashOf({ system, messages });
  const call = client.messages.create({ model: "m", max_tokens: 10, system, messages });
  await answerWhenAsked(dir, batchId, () => build(hash));
  const err = await call.then(() => null, (e) => e);
  assert.ok(err instanceof Error, "the call must reject, not resolve");
  fs.rmSync(dir, { recursive: true, force: true });
  return err;
}

test("a response naming another batch is FOLDER_RESPONSE_BATCH_MISMATCH", async () => {
  const err = await failWith("mismatch-1", (hash) => ({
    contentHash: hash, text: decisionsJson([]), batchIdOverride: "some-other-batch",
  }));
  assert.equal(err.code, "FOLDER_RESPONSE_BATCH_MISMATCH");
  assert.equal(err.code, FOLDER_ERROR.RESPONSE_BATCH_MISMATCH);
  assert.match(err.message, /some-other-batch/);
});

test("a response carrying the wrong contentHash is FOLDER_RESPONSE_STALE", async () => {
  const err = await failWith("stale-1", () => ({
    contentHash: "0".repeat(64), text: decisionsJson([]),
  }));
  assert.equal(err.code, "FOLDER_RESPONSE_STALE");
  assert.equal(err.code, FOLDER_ERROR.RESPONSE_STALE);
  assert.match(err.message, /answers something else/);
});

test("a response that is not parseable JSON is FOLDER_RESPONSE_MALFORMED", async () => {
  const err = await failWith("malformed-1", () => ({ raw: "{ this is not json" }));
  assert.equal(err.code, "FOLDER_RESPONSE_MALFORMED");
  assert.equal(err.code, FOLDER_ERROR.RESPONSE_MALFORMED);
});

test("a JSON array, rather than an object, is also FOLDER_RESPONSE_MALFORMED", async () => {
  const err = await failWith("malformed-2", () => ({ raw: "[]" }));
  assert.equal(err.code, "FOLDER_RESPONSE_MALFORMED");
  assert.match(err.message, /not a JSON object/);
});

test("an empty or whitespace-only text is FOLDER_RESPONSE_MALFORMED, not an empty decision batch", async () => {
  for (const text of ["", "   \n\t "]) {
    const err = await failWith("empty-text", (hash) => ({ contentHash: hash, text }));
    assert.equal(err.code, "FOLDER_RESPONSE_MALFORMED");
    assert.match(err.message, /non-empty string/);
  }
  // A missing field is the same failure, reported by type.
  const err = await failWith("empty-text-2", (hash) => ({ contentHash: hash, text: undefined }));
  assert.equal(err.code, "FOLDER_RESPONSE_MALFORMED");
  assert.match(err.message, /undefined/);
});

test("the ttl elapsing with no answer is FOLDER_TIMEOUT, and the request survives for a resume", async () => {
  const dir = box();
  const batchId = "timeout-1";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });
  const err = await client.messages.create({
    model: "m", max_tokens: 10, system: "S",
    messages: [{ role: "user", content: [{ type: "text", text: "T" }] }],
  }).then(() => null, (e) => e);

  assert.equal(err.code, "FOLDER_TIMEOUT");
  assert.equal(err.code, FOLDER_ERROR.TIMEOUT);
  assert.ok(fs.existsSync(path.join(dir, `request-${batchId}.json`)),
    "the question stays on disk, so answering it later resumes the same batch");
  assert.equal(fs.existsSync(path.join(dir, `response-${batchId}.json`)), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =============================================================================================
// WRITE-ONCE
// =============================================================================================

test("a pre-existing request asking a different question is FOLDER_REQUEST_CONFLICT", async () => {
  const dir = box();
  const batchId = "conflict-1";
  fs.writeFileSync(path.join(dir, `request-${batchId}.json`),
    JSON.stringify({ batchId, contentHash: "f".repeat(64), system: "an older question" }));

  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });
  const err = await client.messages.create({
    model: "m", max_tokens: 10, system: "S",
    messages: [{ role: "user", content: [{ type: "text", text: "T" }] }],
  }).then(() => null, (e) => e);

  assert.equal(err.code, "FOLDER_REQUEST_CONFLICT");
  assert.equal(err.code, FOLDER_ERROR.REQUEST_CONFLICT);
  assert.match(err.message, /already exists and asks a different question/);
  // AND IT WAS NOT OVERWRITTEN. An answer may already be in flight for the old question.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `request-${batchId}.json`), "utf8")).system,
    "an older question");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an unreadable pre-existing request is a conflict too, not an overwrite", async () => {
  const dir = box();
  const batchId = "conflict-2";
  fs.writeFileSync(path.join(dir, `request-${batchId}.json`), "{ truncated");
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });
  const err = await client.messages.create({
    model: "m", max_tokens: 10, system: "S",
    messages: [{ role: "user", content: [{ type: "text", text: "T" }] }],
  }).then(() => null, (e) => e);
  assert.equal(err.code, "FOLDER_REQUEST_CONFLICT");
  assert.match(err.message, /absent\/unreadable/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("re-running the SAME question is a resume: the request is reused, not rewritten", async () => {
  const dir = box();
  const batchId = "resume-1";
  const system = "S";
  const messages = [{ role: "user", content: [{ type: "text", text: "T" }] }];
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });

  await client.messages.create({ model: "m", max_tokens: 10, system, messages }).catch(() => {});
  const file = path.join(dir, `request-${batchId}.json`);
  const firstBytes = fs.readFileSync(file, "utf8");

  await client.messages.create({ model: "m", max_tokens: 10, system, messages }).catch(() => {});
  assert.equal(fs.readFileSync(file, "utf8"), firstBytes,
    "byte-identical: the external reader's copy must not change underneath them");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a batchId that would escape the exchange directory is refused before anything is written", () => {
  for (const bad of ["../escape", "a/b", "", ".hidden", "x".repeat(200)]) {
    assert.throws(() => makeFolderClient({ dir: box(), batchId: bad }),
      (e) => e.code === "FOLDER_BATCHID_UNSAFE", JSON.stringify(bad));
  }
  // And the ids the CLI actually generates are accepted.
  for (const good of ["paper-2027-01-08", "synthetic-dry-run-2027-01-08", "A1"]) {
    const c = makeFolderClient({ dir: box(), batchId: good });
    assert.equal(c.batchId, good);
  }
});

// =============================================================================================
// THE REAL VALIDATORS STILL GOVERN. THE FOLDER IS A TRANSPORT, NOT AN EXEMPTION.
// =============================================================================================

test("a decision for a symbol outside the slate is DROPPED by the real validators, not repaired", async () => {
  const dir = box();
  const batchId = "out-of-slate";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 1, pollMs: 5 });

  const run = decide({ client, context: ctx(), model: "external-brain" });
  await answerWhenAsked(dir, batchId, (req) => ({
    contentHash: req.contentHash,
    text: decisionsJson([
      { symbol: "ZZA", action: "buy", targetPct: 0.04, confidence: 0.5, thesis: THESIS },
      { symbol: "NVDA", action: "buy", targetPct: 0.04, confidence: 0.9, thesis: THESIS },
    ]),
  }));
  const r = await run;

  assert.equal(r.failure, null);
  assert.deepEqual(r.proposals.map((p) => p.symbol), ["ZZA"], "only the in-slate name survives");
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].decision.symbol, "NVDA");
  assert.match(r.dropped[0].why, /symbol NVDA was not in the candidate slate/);
  // DROPPED, NOT REPAIRED: nothing substituted a nearby ticker or rescaled the request.
  assert.equal(r.proposals.some((p) => p.symbol === "NVDA"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an oversized targetPct arriving by folder is dropped by the same cap as any other client", async () => {
  const dir = box();
  const batchId = "oversize";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 1, pollMs: 5 });
  const run = decide({ client, context: ctx(), model: "external-brain", maxPositionPct: 0.10 });
  await answerWhenAsked(dir, batchId, (req) => ({
    contentHash: req.contentHash,
    text: decisionsJson([{ symbol: "ZZB", action: "buy", targetPct: 0.5, confidence: 0.5, thesis: THESIS }]),
  }));
  const r = await run;
  assert.deepEqual(r.proposals, []);
  assert.match(r.dropped[0].why, /over the 0\.1 cap/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =============================================================================================
// THESIS-LENGTH STRICTNESS PIN
// =============================================================================================
//
// On 2026-11-06 an external round-trip found normalise() rejecting a thesis as too short. The
// boundary is read out of analyst/decide.mjs rather than guessed: the check is
//
//     const thesis = typeof d.thesis === "string" ? d.thesis.trim() : "";
//     if (thesis.length < 10) { drop(d, "thesis missing or too short to review"); continue; }
//
// so the rule is TRIMMED LENGTH >= 10 CHARACTERS. Nine is dropped, ten is accepted, and the trim
// happens FIRST -- padding a short thesis with spaces does not buy length. Pinned here so a future
// edit to that constant breaks a test instead of silently changing what an external brain must send.

test("the thesis boundary is exactly 10 characters after trimming, asserted on the real normalise()", () => {
  const known = new Set(SLATE);
  const at = (thesis) => normalise(
    [{ symbol: "ZZA", action: "buy", targetPct: 0.05, confidence: 0.5, thesis }], known, {});

  // Nine characters: dropped.
  const nine = at("123456789");
  assert.equal(nine.proposals.length, 0);
  assert.equal(nine.dropped.length, 1);
  assert.equal(nine.dropped[0].why, "thesis missing or too short to review");

  // Ten: accepted, and kept verbatim.
  const ten = at("1234567890");
  assert.deepEqual(ten.dropped, []);
  assert.equal(ten.proposals.length, 1);
  assert.equal(ten.proposals[0].thesis, "1234567890");

  // THE TRIM COMES FIRST. Twelve characters, nine of them content, is still too short.
  const padded = at("  123456789  ");
  assert.equal(padded.proposals.length, 0);
  assert.equal(padded.dropped[0].why, "thesis missing or too short to review");
  // And a trimmed thesis is what gets recorded, not the padded original.
  assert.equal(at("  1234567890  ").proposals[0].thesis, "1234567890");

  // A non-string is the same drop reason, which is why the message says "missing or too short".
  for (const bad of [undefined, null, 1234567890, { text: "1234567890" }]) {
    const r = at(bad);
    assert.equal(r.proposals.length, 0);
    assert.equal(r.dropped[0].why, "thesis missing or too short to review");
  }
});

test("the same boundary holds end to end through the folder exchange", async () => {
  const dir = box();
  const batchId = "thesis-boundary";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 1, pollMs: 5 });
  const run = decide({ client, context: ctx(), model: "external-brain" });
  await answerWhenAsked(dir, batchId, (req) => ({
    contentHash: req.contentHash,
    text: decisionsJson([
      { symbol: "ZZA", action: "buy", targetPct: 0.03, confidence: 0.5, thesis: "123456789" },
      { symbol: "ZZB", action: "buy", targetPct: 0.03, confidence: 0.5, thesis: "1234567890" },
    ]),
  }));
  const r = await run;
  assert.deepEqual(r.proposals.map((p) => p.symbol), ["ZZB"], "the 9-char thesis did not survive");
  assert.equal(r.dropped[0].why, "thesis missing or too short to review");
  fs.rmSync(dir, { recursive: true, force: true });
});

// =============================================================================================
// HOW A FOLDER FAILURE REACHES THE JOURNAL
// =============================================================================================

test("decide() turns any folder failure into its normal CLIENT_ERROR batch failure, reason included", async () => {
  const dir = box();
  const batchId = "client-error";
  const client = makeFolderClient({ dir, batchId, ttlMinutes: 0, pollMs: 1 });

  const r = await decide({ client, context: ctx(), model: "external-brain" });
  assert.equal(r.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(r.failure.detail, /no response-client-error\.json after 0 minute\(s\)/);
  assert.deepEqual(r.proposals, []);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.raw, null);
  // THE CODE IS LOST AT THIS BOUNDARY AND THAT IS decide()'s CONTRACT, not a defect: the journal
  // records one client-error code and the detail text carries which one it was. That is exactly why
  // the coded errors above are asserted at the client boundary instead of through decide().
  assert.equal(r.failure.code === "FOLDER_TIMEOUT", false);
  fs.rmSync(dir, { recursive: true, force: true });
});
