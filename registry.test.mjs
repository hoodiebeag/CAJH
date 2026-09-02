import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REGISTRY_SCHEMA, GENESIS_HASH, canonicalJson, entryHash,
  preregister, findPreregistration, linkRun,
  consumeHoldout, holdoutConsumptions, sealedHoldoutStatus,
  readLedger, verifyLedger,
} from "./registry.mjs";

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cajh-registry-"));
  return path.join(dir, "ledger.jsonl");
}

const PREREG = {
  id: "TEST-STUDY-1",
  kind: "entry-timing",
  hypothesis: "Family X's net R exceeds a matched-geometry random-entry null.",
  gate: "PASS iff the 95% CI of (family netR - null netR) excludes zero with n>=150 trades.",
  universe: ["ETH", "BTC", "SOL"],
  timeSplit: { train: "2021-01-01/2024-06-30", holdout: "2024-07-01/2026-08-19" },
  symbolSplit: { train: ["BTC", "ETH"], holdout: ["SOL"] },
  costAssumptions: { feeRate: 0.008, slipPct: 0.0005 },
  seed: 12345,
};

// ---------- pre-registration ----------

test("a pre-registration records hypothesis, gate, splits, cost, and seed", () => {
  const file = tmpLedger();
  const entry = preregister(PREREG, file);
  assert.equal(entry.schema, REGISTRY_SCHEMA);
  assert.equal(entry.kind, "preregistration");
  assert.equal(entry.seq, 0);
  assert.equal(entry.prevHash, GENESIS_HASH);
  assert.equal(entry.hypothesis, PREREG.hypothesis);
  assert.equal(entry.gate, PREREG.gate);
  assert.deepEqual(entry.timeSplit, PREREG.timeSplit);
  assert.deepEqual(entry.symbolSplit, PREREG.symbolSplit);
  assert.deepEqual(entry.costAssumptions, PREREG.costAssumptions);
  assert.equal(entry.seed, 12345);
  assert.deepEqual(entry.universe, ["BTC", "ETH", "SOL"], "universe is sorted so the hash is order-independent");
});

test("every field a later reader needs to audit the study is mandatory", () => {
  const file = tmpLedger();
  for (const [patch, re] of [
    [{ id: "" }, /id/], [{ kind: "" }, /kind/],
    [{ hypothesis: "  " }, /hypothesis/], [{ gate: undefined }, /gate/],
    [{ universe: [] }, /universe/], [{ universe: "BTC" }, /universe/],
    [{ timeSplit: null }, /timeSplit/], [{ symbolSplit: null }, /symbolSplit/],
    [{ costAssumptions: null }, /costAssumptions/],
    [{ seed: undefined }, /seed/], [{ seed: 1.5 }, /seed/], [{ seed: "1" }, /seed/],
  ]) {
    assert.throws(() => preregister({ ...PREREG, ...patch }, file), re, JSON.stringify(patch));
  }
  assert.deepEqual(readLedger(file), [], "nothing was written by any rejected attempt");
});

test("a pre-registration is immutable — the same id cannot be registered twice", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  assert.throws(() => preregister({ ...PREREG, gate: "PASS iff avgR > 0" }, file), /immutable/);
  const found = findPreregistration("TEST-STUDY-1", file);
  assert.equal(found.gate, PREREG.gate, "the original gate survives the attempt to replace it");
});

test("findPreregistration returns null for an unknown id", () => {
  assert.equal(findPreregistration("NOPE", tmpLedger()), null);
});

// ---------- linking results ----------

test("a result can only be attached to a gate that was registered first", () => {
  const file = tmpLedger();
  assert.throws(() => linkRun("TEST-STUDY-1", { runFile: "research-runs/x.json" }, file), /No pre-registration/);
  preregister(PREREG, file);
  const run = linkRun("TEST-STUDY-1", { runFile: "research-runs/x.json", verdict: "FAIL" }, file);
  assert.equal(run.kind, "run");
  assert.equal(run.preregistrationId, "TEST-STUDY-1");
  assert.equal(run.verdict, "FAIL");
  assert.equal(run.seq, 1);
});

test("linking a result appends rather than editing the pre-registration", () => {
  const file = tmpLedger();
  const prereg = preregister(PREREG, file);
  linkRun("TEST-STUDY-1", { runFile: "research-runs/x.json", verdict: "PASS" }, file);
  const ledger = readLedger(file);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger[0], prereg, "the pre-registration is byte-identical to what was written");
});

test("linkRun requires a run file to point at", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  assert.throws(() => linkRun("TEST-STUDY-1", {}, file), /runFile/);
});

// ---------- sealed-holdout consumption ----------

test("an untouched pool reports fresh, with every symbol available", () => {
  const s = sealedHoldoutStatus(tmpLedger(), ["AVAX", "LINK"]);
  assert.equal(s.fresh, true);
  assert.deepEqual(s.spent, []);
  assert.deepEqual(s.available, ["AVAX", "LINK"]);
});

test("consuming the pool marks it spent and names what spent it", () => {
  const file = tmpLedger();
  consumeHoldout({
    consumedBy: "STUDY-A", symbols: ["LINK", "AVAX"],
    purpose: "final validation of family X", outcome: "INCONCLUSIVE",
  }, file);
  const s = sealedHoldoutStatus(file, ["AVAX", "LINK", "UNI"]);
  assert.equal(s.fresh, false);
  assert.deepEqual(s.spent, ["AVAX", "LINK"]);
  assert.deepEqual(s.available, ["UNI"], "an unspent symbol stays available");
  assert.equal(s.spentBy.AVAX[0].by, "STUDY-A");
  assert.equal(s.spentBy.AVAX[0].outcome, "INCONCLUSIVE");
  assert.equal(s.spentBy.AVAX[0].override, false);
});

test("a second look at a spent symbol is refused — an inconclusive spend is still a spend", () => {
  const file = tmpLedger();
  consumeHoldout({ consumedBy: "STUDY-A", symbols: ["AVAX"], purpose: "first", outcome: "INCONCLUSIVE" }, file);
  assert.throws(
    () => consumeHoldout({ consumedBy: "STUDY-B", symbols: ["AVAX", "UNI"], purpose: "second" }, file),
    /already spent for AVAX/,
  );
  assert.equal(holdoutConsumptions(file).length, 1, "the refused attempt wrote nothing");
});

test("an override is permitted but must name who authorized it and why, and is recorded", () => {
  const file = tmpLedger();
  consumeHoldout({ consumedBy: "STUDY-A", symbols: ["AVAX"], purpose: "first" }, file);
  assert.throws(() => consumeHoldout({
    consumedBy: "STUDY-B", symbols: ["AVAX"], purpose: "second", override: { reason: "why" },
  }, file), /authorizedBy/);
  assert.throws(() => consumeHoldout({
    consumedBy: "STUDY-B", symbols: ["AVAX"], purpose: "second", override: { authorizedBy: "human" },
  }, file), /reason/);

  const entry = consumeHoldout({
    consumedBy: "STUDY-B", symbols: ["AVAX"], purpose: "second",
    override: { authorizedBy: "human", reason: "explicitly accepted the loss of independence" },
  }, file);
  assert.deepEqual(entry.reusedSymbols, ["AVAX"]);
  assert.equal(entry.override.authorizedBy, "human");
  assert.match(entry.override.reason, /independence/);
  const s = sealedHoldoutStatus(file, ["AVAX"]);
  assert.equal(s.spentBy.AVAX.length, 2, "both looks are on the record, not just the first");
  assert.equal(s.spentBy.AVAX[1].override, true);
});

test("consumeHoldout demands a consumer, symbols, and a stated purpose", () => {
  const file = tmpLedger();
  for (const [patch, re] of [
    [{ consumedBy: "" }, /consumedBy/],
    [{ purpose: "" }, /purpose/],
    [{ symbols: [] }, /symbols/],
    [{ symbols: "AVAX" }, /symbols/],
  ]) {
    assert.throws(() => consumeHoldout({ consumedBy: "S", symbols: ["AVAX"], purpose: "p", ...patch }, file), re);
  }
  assert.equal(holdoutConsumptions(file).length, 0);
});

test("a consumption may cite a pre-registration, and is rejected if it cites a missing one", () => {
  const file = tmpLedger();
  assert.throws(() => consumeHoldout({
    consumedBy: "S", symbols: ["AVAX"], purpose: "p", preregistrationId: "GHOST",
  }, file), /No pre-registration/);
  preregister(PREREG, file);
  const e = consumeHoldout({
    consumedBy: "S", symbols: ["AVAX"], purpose: "p", preregistrationId: "TEST-STUDY-1",
  }, file);
  assert.equal(e.preregistrationId, "TEST-STUDY-1");
});

// ---------- append-only integrity ----------

test("canonicalJson hashes by content, not by property order", () => {
  assert.equal(canonicalJson({ a: 1, b: [2, { d: 4, c: 3 }] }), canonicalJson({ b: [2, { c: 3, d: 4 }], a: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
});

test("a clean ledger verifies, with each entry chained to the last", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  linkRun("TEST-STUDY-1", { runFile: "r.json", verdict: "FAIL" }, file);
  consumeHoldout({ consumedBy: "S", symbols: ["AVAX"], purpose: "p" }, file);
  assert.deepEqual(verifyLedger(file), { ok: true, entries: 3, problems: [] });
  const ledger = readLedger(file);
  assert.equal(ledger[1].prevHash, ledger[0].hash);
  assert.equal(ledger[2].prevHash, ledger[1].hash);
});

test("editing a historical entry breaks its hash and verifyLedger says which one", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  linkRun("TEST-STUDY-1", { runFile: "r.json", verdict: "FAIL" }, file);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const tampered = JSON.parse(lines[0]);
  tampered.gate = "PASS iff avgR > 0";
  lines[0] = JSON.stringify(tampered);
  fs.writeFileSync(file, lines.join("\n") + "\n");

  const res = verifyLedger(file);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => p.index === 0 && /edited after it was written/.test(p.problem)));
});

test("deleting a historical entry breaks the chain and is detected", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  linkRun("TEST-STUDY-1", { runFile: "r.json" }, file);
  consumeHoldout({ consumedBy: "S", symbols: ["AVAX"], purpose: "p" }, file);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  fs.writeFileSync(file, [lines[0], lines[2]].join("\n") + "\n");

  const res = verifyLedger(file);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /seq 2 does not match position 1/.test(p.problem)));
  assert.ok(res.problems.some((p) => /chain is broken/.test(p.problem)));
});

test("an unparseable line is reported rather than silently skipped", () => {
  const file = tmpLedger();
  preregister(PREREG, file);
  fs.appendFileSync(file, "{not json\n");
  const res = verifyLedger(file);
  assert.equal(res.ok, false);
  assert.equal(res.entries, 2);
  assert.ok(res.problems.some((p) => p.index === 1 && p.problem === "unparseable line"));
});

test("entryHash ignores the hash field itself, so re-hashing an entry is stable", () => {
  const file = tmpLedger();
  const e = preregister(PREREG, file);
  assert.equal(entryHash(e), e.hash);
  assert.equal(entryHash({ ...e, hash: "deadbeef" }), e.hash);
});

test("a missing ledger reads as empty and verifies vacuously", () => {
  const file = path.join(os.tmpdir(), "cajh-registry-absent", "ledger.jsonl");
  assert.deepEqual(readLedger(file), []);
  assert.deepEqual(verifyLedger(file), { ok: true, entries: 0, problems: [] });
});

test("a backfilled consumption keeps its real date distinct from its filing date", () => {
  const file = tmpLedger();
  const e = consumeHoldout({
    consumedBy: "OLD-STUDY", symbols: ["AVAX"], purpose: "reconstructed from the written record",
    consumedAt: "2026-08-29", notes: "backfilled from ROADMAP.md",
  }, file);
  assert.equal(e.consumedAt, "2026-08-29");
  assert.equal(e.notes, "backfilled from ROADMAP.md");
  assert.notEqual(e.recordedAt, "2026-08-29");

  const s = sealedHoldoutStatus(file, ["AVAX"]);
  assert.equal(s.spentBy.AVAX[0].at, "2026-08-29", "the spend is dated when it happened");
  assert.equal(s.spentBy.AVAX[0].recordedAt, e.recordedAt, "the filing date stays visible too");
});

test("a consumption with no stated date falls back to when it was recorded", () => {
  const file = tmpLedger();
  const e = consumeHoldout({ consumedBy: "S", symbols: ["AVAX"], purpose: "p" }, file);
  assert.equal(e.consumedAt, null);
  assert.equal(sealedHoldoutStatus(file, ["AVAX"]).spentBy.AVAX[0].at, e.recordedAt);
});
