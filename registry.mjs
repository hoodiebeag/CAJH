/**
 * registry.mjs — the pre-registration and sealed-holdout ledger (Phase 2).
 *
 * WHY THIS EXISTS. This project's discipline already requires a fixed pre-registration before
 * any result is seen, and treats `SEALED_SYMBOLS` as a one-time judge. Both rules currently
 * live only in prose, and prose does not enforce. The cost of that is on the record: the
 * sealed pool was spent on 2026-08-29 by `VOL-CONTRACTION-SEALED-VALIDATION` and returned
 * inconclusive (`AGENT_PROTOCOL.md`, `ROADMAP.md`), yet `.agent_state.json`'s
 * `sealed_symbols_unchanged` note still describes the pool as reserved. Two authoritative
 * files disagree about whether the project's last fresh judge exists. A ledger makes that
 * question answerable by reading one file instead of by adjudicating three.
 *
 * WHAT IT ENFORCES.
 *  1. A pre-registration is written BEFORE a result exists, and carries the hypothesis, the
 *     falsifiable gate, the universe, the time and symbol splits, the cost assumptions, and
 *     the seed. `linkRun` attaches the result afterwards; the pre-registration itself is never
 *     rewritten, so a gate cannot be edited to fit the number it produced.
 *  2. A sealed holdout cannot be consumed twice. `consumeHoldout` throws if any symbol in the
 *     request is already spent, unless an explicit override is supplied — and the override,
 *     with who authorized it and why, is written into the ledger rather than bypassing it.
 *  3. Nothing is ever deleted or edited. The ledger is append-only and hash-chained: each
 *     entry carries the sha256 of the previous entry's canonical form, so a deleted or altered
 *     entry breaks the chain and `verifyLedger` reports exactly where.
 *
 * WHAT IT DOES NOT DO. It does not run studies, gate promotion (that is Phase 4), read live
 * trading state, or place orders. Recording a consumption here is bookkeeping; it grants no
 * authority that the D1 → D2 → D3 path in `SELF_AWARENESS_SPEC.md` does not already govern.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SEALED_SYMBOLS } from "./researchlib.mjs";
import { writeFileAtomic } from "./researchlab.mjs";

export const REGISTRY_SCHEMA = "cajh-registry-entry/v1";
export const GENESIS_HASH = "0".repeat(64);

const dataDir = () => process.env.DATA_DIR || ".";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

/** Key-sorted JSON so a hash depends on content, not on property insertion order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const registryFile = () => path.join(dataDir(), "research-registry", "ledger.jsonl");

/** Every entry, oldest first. A malformed line is returned as `{ malformed, line, index }`
 *  rather than skipped — silently dropping an unreadable entry is how a ledger stops being one. */
export function readLedger(file = registryFile()) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      return { malformed: true, line, index };
    }
  });
}

/** The hash an entry commits to: everything except the hash field itself. */
export function entryHash(entry) {
  const { hash: _omit, ...rest } = entry;
  return sha256(canonicalJson(rest));
}

/**
 * Append one entry, chained to the current tail. The whole line is written in a single
 * `appendFileSync` call so a concurrent reader sees either no line or a complete one.
 */
function append(kind, body, file = registryFile()) {
  const ledger = readLedger(file);
  const tail = ledger.at(-1);
  const entry = {
    schema: REGISTRY_SCHEMA,
    seq: ledger.length,
    kind,
    recordedAt: new Date().toISOString(),
    prevHash: tail ? tail.hash : GENESIS_HASH,
    ...body,
  };
  entry.hash = entryHash(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

const requireString = (v, label) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} is required and must be a non-empty string`);
  return v.trim();
};

/**
 * Record a pre-registration. Everything a later reader needs in order to say whether the
 * study was decided by its own stated rule, rather than by the data, must be present here —
 * so each field is required rather than defaulted.
 *
 * `gate` is the falsifiable condition, stated as text, that the study agreed to be judged by
 * before seeing any result. `timeSplit` and `symbolSplit` describe how the data was divided.
 * `costAssumptions` records the fee and slippage the study charged; a study whose conclusion
 * depends on a cost figure nobody wrote down is not reproducible.
 */
export function preregister({
  id, kind, hypothesis, gate,
  universe, timeSplit, symbolSplit,
  costAssumptions, seed,
  datasetHash = null, codeRevision = null,
  notes = null,
} = {}, file = registryFile()) {
  requireString(id, "id");
  requireString(kind, "kind");
  requireString(hypothesis, "hypothesis");
  requireString(gate, "gate");
  if (!Array.isArray(universe) || universe.length === 0) throw new Error("universe must be a non-empty array");
  if (!timeSplit || typeof timeSplit !== "object") throw new Error("timeSplit is required (e.g. { train, holdout })");
  if (!symbolSplit || typeof symbolSplit !== "object") throw new Error("symbolSplit is required (e.g. { train, holdout })");
  if (!costAssumptions || typeof costAssumptions !== "object") throw new Error("costAssumptions is required (e.g. { feeRate, slipPct })");
  if (!Number.isInteger(seed)) throw new Error("seed must be an integer, so the run is reproducible");
  if (findPreregistration(id, file)) throw new Error(`Pre-registration already exists and is immutable: ${id}`);
  return append("preregistration", {
    id, hypothesis, gate,
    studyKind: kind,
    universe: [...universe].sort(),
    timeSplit, symbolSplit, costAssumptions, seed,
    datasetHash, codeRevision, notes,
  }, file);
}

export function findPreregistration(id, file = registryFile()) {
  return readLedger(file).find((e) => e.kind === "preregistration" && e.id === id) ?? null;
}

/**
 * Attach a result to an existing pre-registration. This is a new appended entry, not an edit:
 * the pre-registration stays exactly as written, and the pairing is what a reader audits.
 */
export function linkRun(preregistrationId, { runFile, resultSummary = null, verdict = null } = {}, file = registryFile()) {
  requireString(preregistrationId, "preregistrationId");
  requireString(runFile, "runFile");
  if (!findPreregistration(preregistrationId, file)) {
    throw new Error(`No pre-registration named ${preregistrationId}; register the hypothesis and gate before recording a result`);
  }
  return append("run", { preregistrationId, runFile, resultSummary, verdict }, file);
}

/** Every sealed-holdout consumption on record, oldest first. */
export function holdoutConsumptions(file = registryFile()) {
  return readLedger(file).filter((e) => e.kind === "holdout-consumption");
}

/**
 * Which sealed symbols are already spent, and by what.
 * `available` is what remains genuinely unspent — the only honest basis for claiming a fresh
 * judge exists.
 */
export function sealedHoldoutStatus(file = registryFile(), pool = SEALED_SYMBOLS) {
  const spentBy = new Map();
  for (const e of holdoutConsumptions(file)) {
    for (const s of e.symbols ?? []) {
      if (!spentBy.has(s)) spentBy.set(s, []);
      // Report when the spend HAPPENED where that is known, falling back to when it was
      // written down. A backfilled entry must not appear to have occurred on its filing date.
      spentBy.get(s).push({
        by: e.consumedBy, at: e.consumedAt ?? e.recordedAt, recordedAt: e.recordedAt,
        outcome: e.outcome, override: !!e.override,
      });
    }
  }
  const spent = [...pool].filter((s) => spentBy.has(s));
  return {
    pool: [...pool],
    spent,
    available: [...pool].filter((s) => !spentBy.has(s)),
    fresh: spent.length === 0,
    spentBy: Object.fromEntries(spentBy),
  };
}

/**
 * Record a sealed-holdout consumption, refusing a second spend of any already-spent symbol.
 *
 * An override is not a way around the ledger — it is a way through it that leaves a mark.
 * It requires a named authorizer and a reason, and both are written into the entry, so
 * "we reused the sealed pool" can never be an undocumented event.
 */
export function consumeHoldout({
  consumedBy, symbols, purpose,
  preregistrationId = null, outcome = null, override = null,
  consumedAt = null, notes = null,
} = {}, file = registryFile()) {
  requireString(consumedBy, "consumedBy");
  requireString(purpose, "purpose");
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error("symbols must be a non-empty array");
  if (preregistrationId && !findPreregistration(preregistrationId, file)) {
    throw new Error(`No pre-registration named ${preregistrationId}`);
  }
  const status = sealedHoldoutStatus(file);
  const reused = symbols.filter((s) => s in status.spentBy);
  if (reused.length) {
    if (!override) {
      throw new Error(
        `Sealed holdout already spent for ${reused.join(", ")} — a second look is not a fresh test. ` +
        `Pass override: { authorizedBy, reason } to record the reuse explicitly.`
      );
    }
    requireString(override.authorizedBy, "override.authorizedBy");
    requireString(override.reason, "override.reason");
  }
  return append("holdout-consumption", {
    consumedBy, symbols: [...symbols].sort(), purpose, preregistrationId, outcome,
    // `consumedAt` is when the spend actually happened; `recordedAt` is when it was written
    // down. They differ for anything backfilled from the prose record, and conflating them
    // would let a backfill masquerade as a contemporaneous entry.
    consumedAt, notes,
    reusedSymbols: reused.sort(),
    override: override ? { authorizedBy: override.authorizedBy.trim(), reason: override.reason.trim() } : null,
  }, file);
}

/**
 * Verify the chain. Returns `{ ok, entries, problems }`; `problems` names the first index at
 * which the ledger stops being consistent with itself, which is what a deleted or edited
 * historical record looks like from the outside.
 */
export function verifyLedger(file = registryFile()) {
  const entries = readLedger(file);
  const problems = [];
  let prev = GENESIS_HASH;
  entries.forEach((e, i) => {
    if (e.malformed) { problems.push({ index: i, problem: "unparseable line" }); return; }
    if (e.schema !== REGISTRY_SCHEMA) problems.push({ index: i, problem: `unexpected schema: ${e.schema}` });
    if (e.seq !== i) problems.push({ index: i, problem: `seq ${e.seq} does not match position ${i} — an entry was removed or reordered` });
    if (e.prevHash !== prev) problems.push({ index: i, problem: "prevHash does not match the preceding entry — the chain is broken" });
    if (e.hash !== entryHash(e)) problems.push({ index: i, problem: "hash does not match content — the entry was edited after it was written" });
    prev = e.hash;
  });
  return { ok: problems.length === 0, entries: entries.length, problems };
}
