/**
 * analyst/run-folder.test.mjs — the folder runner, driven by a scripted responder.
 *
 * WHAT IS REAL. `runOnceViaFolder` is tested through the whole existing pipeline: `runOnce`,
 * `buildContext`, `contextIsPointInTime`, `decide`, `normalise`, `applyRiskGate` and
 * `recordDecision` are all the repository's own code, imported and unmodified. Nothing is stubbed,
 * shadowed or monkeypatched. Every assertion about the journal is made by READING THE FILE BACK
 * with the real `readJournal`, not by inspecting an in-memory return value.
 *
 * WHAT IS SYNTHETIC. The panel, the slate and the answers. Invented tickers, a generated price
 * series, a temporary journal and a temporary exchange directory, all under os.tmpdir(). No
 * network, no API key, no SDK import, no real market data, no broker, no order path. Mode is
 * dry-run throughout -- the plumbing check -- so the paper-mode guard is never engaged and nothing
 * here can become a track record.
 *
 * THE RESPONDER IS SCRIPTED, NOT A MODEL. `respondWith` waits for the request file the runner
 * writes, reads the contentHash out of it, and drops a complete response file into place by
 * rename. That is exactly what a person with a text editor, or a separate AI process watching the
 * directory, would do.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOnceViaFolder, folderBatchId, resolveAsOf } from "./run-folder.mjs";
import { runOnce } from "./loop.mjs";
import { readJournal, KIND, MODE } from "./journal.mjs";
import { registerVersion } from "./ledger.mjs";
import { BATCH_FAILURE } from "./decide.mjs";

const DAY = 86400;
const SYMS = ["ZZA", "ZZB", "ZZC", "ZZD", "ZZE", "ZZF"];
const THESIS = "momentum and breadth both confirm here";

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "run-folder-"));
const journalIn = (box) => path.join(box, "journal.jsonl");
const exchangeIn = (box) => path.join(box, "exchange");

/**
 * A synthetic panel ending today, following the convention analyst/loop.test.mjs uses: the newest
 * bar is stamped at `now` so freshness is driven from the test rather than from the wall clock.
 */
function panel(symbols = SYMS, n = 400, now = Date.now()) {
  const lastTime = Math.floor(now / 1000);
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(lastTime - i * DAY);
  const series = {};
  symbols.forEach((sym, k) => {
    const bars = [];
    let px = 100;
    for (let i = 0; i < n; i++) {
      px *= 1 + (k - symbols.length / 2) * 0.0005 + Math.sin(i / 9 + k) * 0.003;
      bars.push({ time: dates[i], open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 2e6 });
    }
    series[sym] = bars;
  });
  return { series, dates };
}

const buy = (symbol, over = {}) => ({
  symbol, action: "buy", targetPct: 0.05, confidence: 0.7, thesis: THESIS, ...over,
});

/** Write a complete file, then rename it into place, as an external writer must. */
function put(file, body) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

/**
 * The scripted responder. Waits for the runner's request, then answers it.
 *
 * `build(request)` returns either `{ text }` -- answered correctly, with the request's own
 * contentHash -- or an object overriding any field, or `{ raw }` to write arbitrary bytes.
 */
async function respondWith(dir, batchId, build) {
  const requestFile = path.join(dir, `request-${batchId}.json`);
  for (let i = 0; i < 3000; i++) {
    if (fs.existsSync(requestFile)) {
      const req = JSON.parse(fs.readFileSync(requestFile, "utf8"));
      const spec = build(req);
      const file = path.join(dir, `response-${batchId}.json`);
      if (spec.raw !== undefined) { put(file, spec.raw); return req; }
      put(file, `${JSON.stringify({
        batchId: spec.batchId ?? batchId,
        contentHash: spec.contentHash ?? req.contentHash,
        text: spec.text,
      }, null, 2)}\n`);
      return req;
    }
    await new Promise((r) => { setTimeout(r, 2); });
  }
  throw new Error("the runner never wrote a request file");
}

const decisionsText = (arr) => JSON.stringify({ decisions: arr });
const records = (file) => readJournal(file).records;

// =============================================================================================
// (a) A VALID ANSWER FLOWS THROUGH THE REAL PIPELINE, UNCHANGED
// =============================================================================================

test("a scripted answer reaches the journal through the real decide/normalise/record path", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const journalFile = journalIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const expectedId = folderBatchId(dates.at(-1), MODE.DRY_RUN);

  const run = runOnceViaFolder({
    dir, ttlMinutes: 1, pollMs: 5,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile, model: "external-brain",
  });
  const req = await respondWith(dir, expectedId, () => ({ text: decisionsText([buy("ZZA")]) }));
  const r = await run;

  // The runner used the id both sides agreed on, and the exchange files are where it says.
  assert.equal(r.batchId, expectedId);
  assert.equal(r.exchange.requestPath, path.join(dir, `request-${expectedId}.json`));
  assert.ok(fs.existsSync(r.exchange.requestPath));
  assert.ok(fs.existsSync(r.exchange.responsePath));

  // The request carries the real system prompt and the real serialised context: this is what an
  // external brain actually answers, not a summary of it.
  assert.match(req.system, /You are a portfolio analyst/);
  assert.equal(req.model, "external-brain");
  const askedContext = JSON.parse(req.messages[0].content[0].text);
  assert.ok(askedContext.candidates.length > 0);
  assert.ok(askedContext.candidates.some((c) => c.symbol === "ZZA"));

  // THE REAL decide() SUCCEEDED and the real normalise() produced the proposal.
  assert.equal(r.decision.failure, null, JSON.stringify(r.decision.failure));
  assert.deepEqual(r.decision.dropped, []);
  assert.equal(r.decision.proposals.length, 1);
  assert.equal(r.decision.proposals[0].symbol, "ZZA");
  assert.equal(r.decision.proposals[0].thesis, THESIS);
  assert.equal(r.skipped, null);

  // THE REAL RISK GATE RAN. Not asserted as "allowed" -- the gate's verdict is its own business --
  // only that it produced its own structure rather than being bypassed.
  assert.ok(r.gate && Array.isArray(r.gate.allowed) && Array.isArray(r.gate.rejected));
  assert.equal(r.gate.allowed.length + r.gate.rejected.length, 1);

  // AND THE REAL JOURNAL PATH WROTE IT. Read back off disk, not from the return value.
  const recs = records(journalFile);
  assert.equal(recs.length, 1);
  const rec = recs[0];
  assert.equal(rec.kind, KIND.DECISION);
  assert.equal(rec.batchId, expectedId);
  assert.equal(rec.mode, MODE.DRY_RUN);
  assert.equal(rec.model, "external-brain");
  assert.equal(rec.failure, null);
  assert.deepEqual(rec.proposals.map((p) => p.symbol), ["ZZA"]);
  // THE CONTROL WAS DRAWN FROM THE SLATE THE ANSWERER WAS SHOWN, which is what makes it matched.
  // The record keeps `poolSize` and the drawn `control`, not the pool members -- checked against
  // what recordDecision actually persists rather than against what it was handed.
  assert.equal(rec.poolSize, askedContext.candidates.length);
  assert.ok(rec.poolSize > 0);
  assert.ok(rec.control !== undefined, "a matched random control is recorded beside the decision");
  assert.equal("pool" in rec, false, "the members are not persisted; only the size and the draw");
  fs.rmSync(box, { recursive: true, force: true });
});

test("the whole exchange directory is two files and nothing else", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const id = folderBatchId(dates.at(-1), MODE.DRY_RUN);
  const run = runOnceViaFolder({
    dir, ttlMinutes: 1, pollMs: 5,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: journalIn(box),
  });
  await respondWith(dir, id, () => ({ text: decisionsText([]) }));
  await run;
  assert.deepEqual(fs.readdirSync(dir).sort(), [`request-${id}.json`, `response-${id}.json`]);
  fs.rmSync(box, { recursive: true, force: true });
});

// =============================================================================================
// THE BATCH ID AGREEMENT — the one piece of duplicated logic in run-folder.mjs
// =============================================================================================

test("the derived batch id is the SAME id runOnce writes when left to choose for itself", async () => {
  // THIS IS THE PIN. run-folder.mjs mirrors loop.mjs's private defaultBatchId because the folder
  // client needs the id before runOnce is called. If that mirror ever stops matching, the exchange
  // file and the journal record name different batches -- so the two are compared directly.
  const box = workspace();
  const now = Date.now();
  const { series, dates } = panel();
  const journalFile = journalIn(box);

  const stub = { messages: { create: async () => ({
    content: [{ type: "text", text: decisionsText([]) }],
    stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, model: "stub",
  }) } };
  // batchId deliberately omitted, so runOnce derives its own.
  const own = await runOnce({ series, dates, client: stub, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile });

  assert.equal(own.record.batchId, folderBatchId(dates.at(-1), MODE.DRY_RUN),
    "run-folder's derivation must equal loop.mjs's own");

  // And for every mode, not just the default one.
  for (const mode of [MODE.DRY_RUN, MODE.PAPER, MODE.ANONYMISED]) {
    assert.equal(folderBatchId(dates.at(-1), mode),
      `${mode}-${new Date(dates.at(-1) * 1000).toISOString().slice(0, 10)}`);
  }
  fs.rmSync(box, { recursive: true, force: true });
});

test("resolveAsOf resolves the index the way runOnce does, including an explicit asOf", async () => {
  const { dates } = panel();
  assert.equal(resolveAsOf(dates).idx, dates.length - 1);
  assert.equal(resolveAsOf(dates).asOfTime, dates.at(-1));
  assert.equal(resolveAsOf(dates, 300).asOfTime, dates[300]);
  // A non-integer asOf falls back to the last bar, as runOnce's own guard does.
  assert.equal(resolveAsOf(dates, null).asOfTime, dates.at(-1));
  assert.equal(resolveAsOf(dates, "300").asOfTime, dates.at(-1));
  assert.throws(() => resolveAsOf([], 0), /dates required/);
});

test("an explicit asOf names the batch after the bar actually decided, and the exchange follows", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const asOf = 380;
  const id = folderBatchId(dates[asOf], MODE.DRY_RUN);

  const run = runOnceViaFolder({
    dir, ttlMinutes: 1, pollMs: 5,
    series, dates, asOf, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: journalIn(box),
  });
  await respondWith(dir, id, () => ({ text: decisionsText([]) }));
  const r = await run;
  assert.equal(r.batchId, id);
  assert.equal(records(journalIn(box))[0].batchId, id);
  assert.notEqual(id, folderBatchId(dates.at(-1), MODE.DRY_RUN), "and it is not the last bar's id");
  fs.rmSync(box, { recursive: true, force: true });
});

// =============================================================================================
// (b) EVERY CODED FOLDER FAILURE SURFACES AS CLIENT_ERROR, REASON PRESERVED, AND IS JOURNALLED
// =============================================================================================

/**
 * Drive one failure to the journal and return { result, record }.
 *
 * `build` is null to answer nothing at all, which drives the timeout.
 */
async function failureRun(build, { ttlMinutes = 1, pollMs = 5, preExisting = null } = {}) {
  const box = workspace();
  const dir = exchangeIn(box);
  const journalFile = journalIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const id = folderBatchId(dates.at(-1), MODE.DRY_RUN);

  if (preExisting) {
    fs.mkdirSync(dir, { recursive: true });
    put(path.join(dir, `request-${id}.json`), preExisting);
  }

  const run = runOnceViaFolder({
    dir, ttlMinutes, pollMs,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile, model: "external-brain",
  });
  if (build) await respondWith(dir, id, build);
  const result = await run;
  const recs = records(journalFile);
  assert.equal(recs.length, 1, "a failed batch is still exactly one journal record");
  fs.rmSync(box, { recursive: true, force: true });
  return { result, record: recs[0], id };
}

/** Every one of these must be the SAME collapse: CLIENT_ERROR, with the folder reason in detail. */
function assertClientError({ result, record }, reasonPattern) {
  assert.equal(result.decision.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(result.decision.failure.detail, reasonPattern);
  assert.deepEqual(result.decision.proposals, []);
  assert.equal(result.gate, null);
  assert.equal(result.skipped.reason, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(result.skipped.detail, reasonPattern);

  // AND IT IS ON THE RECORD. A failed batch that produced no journal entry would describe a
  // different agent than the one running.
  assert.equal(record.kind, KIND.DECISION, "a failed batch is a decision record, not a skip");
  assert.equal(record.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(record.failure.detail, reasonPattern,
    "the folder reason survives all the way to the journal file");
  assert.deepEqual(record.proposals, []);
}

test("FOLDER_TIMEOUT surfaces as CLIENT_ERROR with its reason, and the request survives", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const id = folderBatchId(dates.at(-1), MODE.DRY_RUN);
  const r = await runOnceViaFolder({
    dir, ttlMinutes: 0, pollMs: 1,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile: journalIn(box),
  });
  assert.equal(r.decision.failure.code, BATCH_FAILURE.CLIENT_ERROR);
  assert.match(r.decision.failure.detail, /no response-dry-run-.*\.json after 0 minute\(s\)/);
  assert.equal(records(journalIn(box))[0].failure.code, BATCH_FAILURE.CLIENT_ERROR);
  // Unanswered, so the question stays on disk and answering it later resumes the same batch.
  assert.ok(fs.existsSync(path.join(dir, `request-${id}.json`)));
  assert.equal(fs.existsSync(path.join(dir, `response-${id}.json`)), false);
  fs.rmSync(box, { recursive: true, force: true });
});

test("FOLDER_RESPONSE_BATCH_MISMATCH surfaces as CLIENT_ERROR with its reason", async () => {
  const out = await failureRun(() => ({ text: decisionsText([]), batchId: "some-other-batch" }));
  assertClientError(out, /response names batch "some-other-batch"/);
});

test("FOLDER_RESPONSE_STALE surfaces as CLIENT_ERROR with its reason", async () => {
  const out = await failureRun(() => ({ text: decisionsText([]), contentHash: "0".repeat(64) }));
  assertClientError(out, /answers something else/);
});

test("FOLDER_RESPONSE_MALFORMED surfaces as CLIENT_ERROR, for unparseable bytes", async () => {
  const out = await failureRun(() => ({ raw: "{ not json at all" }));
  assertClientError(out, /is not parseable JSON/);
});

test("FOLDER_RESPONSE_MALFORMED surfaces as CLIENT_ERROR, for an empty text field", async () => {
  const out = await failureRun(() => ({ text: "   " }));
  assertClientError(out, /must be a non-empty string/);
});

test("FOLDER_REQUEST_CONFLICT surfaces as CLIENT_ERROR and does not overwrite the old question", async () => {
  const stale = `${JSON.stringify({ batchId: "x", contentHash: "f".repeat(64), system: "an older question" })}\n`;
  const out = await failureRun(null, { ttlMinutes: 0, pollMs: 1, preExisting: stale });
  assertClientError(out, /already exists and asks a different question/);
});

test("the five coded failures are distinguishable in the journal by their detail text", async () => {
  // THE CODE ITSELF IS LOST AT decide()'s BOUNDARY -- one CLIENT_ERROR for all of them, which is
  // decide()'s contract and not a defect. What must survive is the REASON, because a runner that
  // cannot tell "nobody answered" from "somebody answered the wrong question" will retry the
  // wrong one. So the five details are checked to be mutually distinguishable.
  const seen = [];
  seen.push((await failureRun(() => ({ text: decisionsText([]), batchId: "other" }))).record.failure.detail);
  seen.push((await failureRun(() => ({ text: decisionsText([]), contentHash: "0".repeat(64) }))).record.failure.detail);
  seen.push((await failureRun(() => ({ raw: "{" }))).record.failure.detail);
  seen.push((await failureRun(() => ({ text: "" }))).record.failure.detail);
  seen.push((await failureRun(null, { ttlMinutes: 0, pollMs: 1 })).record.failure.detail);

  assert.equal(new Set(seen).size, 5, `five distinct reasons, got ${JSON.stringify(seen)}`);
  for (const d of seen) assert.match(d, /^folder-client: /, "each names the component it came from");
});

// =============================================================================================
// (c) ZERO PAID TOKENS
// =============================================================================================

test("usage comes back as zero paid tokens, and the journal does not persist usage at all", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const journalFile = journalIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const id = folderBatchId(dates.at(-1), MODE.DRY_RUN);

  const run = runOnceViaFolder({
    dir, ttlMinutes: 1, pollMs: 5,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile,
  });
  await respondWith(dir, id, () => ({ text: decisionsText([buy("ZZB")]) }));
  const r = await run;

  assert.deepEqual(r.decision.usage, { input_tokens: 0, output_tokens: 0 });
  assert.equal(r.decision.stopReason, "end_turn");

  // STATED HONESTLY RATHER THAN FUDGED: recordDecision does not take a usage field, so the journal
  // carries none. "Zero paid tokens" is a property of the run result and of the exchange -- no
  // network call is made, by construction -- and is NOT verifiable from the journal file. Pinned
  // here so that if journal.mjs ever starts persisting usage, this test says so.
  const rec = records(journalFile)[0];
  assert.equal("usage" in rec, false,
    "the journal does not record usage; if that changes, update this claim rather than the test");
  fs.rmSync(box, { recursive: true, force: true });
});

// =============================================================================================
// THE PIPELINE'S OWN RULES STILL GOVERN. THE FOLDER IS A TRANSPORT, NOT AN EXEMPTION.
// =============================================================================================

test("an out-of-slate symbol answered through the folder is dropped by the real validators", async () => {
  const box = workspace();
  const dir = exchangeIn(box);
  const journalFile = journalIn(box);
  const now = Date.now();
  const { series, dates } = panel();
  const id = folderBatchId(dates.at(-1), MODE.DRY_RUN);

  const run = runOnceViaFolder({
    dir, ttlMinutes: 1, pollMs: 5,
    series, dates, mode: MODE.DRY_RUN, now, nav: 1e5, journalFile,
  });
  await respondWith(dir, id, () => ({
    text: decisionsText([buy("ZZA"), buy("NVDA")]),
  }));
  const r = await run;

  assert.deepEqual(r.decision.proposals.map((p) => p.symbol), ["ZZA"]);
  assert.equal(r.decision.dropped.length, 1);
  assert.match(r.decision.dropped[0].why, /symbol NVDA was not in the candidate slate/);
  assert.deepEqual(records(journalFile)[0].proposals.map((p) => p.symbol), ["ZZA"]);
  fs.rmSync(box, { recursive: true, force: true });
});

test("paper mode's guard still refuses a historical date, folder client or not", async () => {
  // The guard is in runOnce and this file does not touch it. Asserted because a runner that
  // reimplemented the pipeline could have lost it, which is the whole reason nothing is
  // reimplemented here.
  const box = workspace();
  // Paper mode also requires a registered candidate (J6 attribution guard, ordered AHEAD of the
  // staleness guard on purpose). Register one first so the run reaches the guard under test;
  // registration must precede the decision time, so `now` is captured after it.
  const ledgerFile = path.join(box, "ledger.jsonl");
  registerVersion({
    candidateId: "rf-test", version: "v1",
    whatChanged: "test registration", why: "reach the staleness guard under test",
    registeredClaim: "none - guard test", control: "none - guard test",
    minimumPeriods: 50, mdeAtMinimum: 0.5, drawdownWindow: "60 trading days",
    hashes: { prompt: "0".repeat(64), checklist: "0".repeat(64), universe: "0".repeat(64) },
  }, ledgerFile);
  // Strictly after the registration instant: the ledger refuses an attribution registered at or
  // after the decision, and the two can share a millisecond if now is captured immediately.
  const now = Date.now() + 1000;
  const { series, dates } = panel(SYMS, 400, now - 200 * DAY * 1000);
  await assert.rejects(
    () => runOnceViaFolder({
      dir: exchangeIn(box), ttlMinutes: 0, pollMs: 1,
      series, dates, mode: MODE.PAPER, now, nav: 1e5, journalFile: journalIn(box),
      candidateId: "rf-test", candidateVersion: "v1", ledgerFile,
    }),
    /already knows what happened/,
  );
  // And it refused BEFORE writing any request: no external brain was asked a question that the
  // guard was going to reject anyway.
  assert.equal(fs.existsSync(exchangeIn(box)), false);
  fs.rmSync(box, { recursive: true, force: true });
});

test("dir is required, and nothing is written without one", () => {
  assert.rejects(() => runOnceViaFolder({ dates: [1, 2, 3] }), /dir is required/);
});
