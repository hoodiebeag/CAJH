/**
 * The candidate/version ledger: what a configuration agreed to BEFORE its first decision.
 *
 * `docs/FORWARD-EVAL-SPEC.md` §4 calls this the one genuinely new requirement, and the reason is a
 * failure this project has already had once. In the retrospective programme the *number of things
 * tried* lagged the real number silently while the real number climbed, which is how a family of 22
 * tests ended up with a naive FWER of 0.6765 that nobody was tracking. A forward run reproduces that
 * failure in a new form: every prompt revision, checklist change or universe change is a new
 * candidate, and a record that does not distinguish them pools them.
 *
 * DESIGN RECOVERED, NOT INVENTED. `registry.mjs` solved exactly this shape for the research
 * programme — append-only, hash-chained, immutable pre-registration, with `verifyLedger()` naming the
 * index where the chain breaks. It was deleted in the compression at `8e1d342`, but its ledger
 * (`research-registry/ledger.jsonl`, 18 entries) is still in the tree and `docs/archive/
 * AGENT_PROTOCOL.md:174-208` still documents the contract. This module reuses that design deliberately
 * rather than reinventing a weaker one, and keeps four of its hard-won lessons:
 *
 *   1. Hash-chained, so a deleted or edited historical entry is DETECTABLE, not merely discouraged.
 *   2. Immutable: registering the same (candidate, version) twice throws rather than replacing.
 *   3. A malformed line is reported, never skipped. Silently dropping an unreadable entry is how a
 *      ledger stops being one.
 *   4. **An appended entry is not durable until it is committed.** `AGENT_PROTOCOL.md:198` records
 *      this being learned the hard way on 2026-09-03, when a hard reset destroyed two runs' entries.
 *      Commit the ledger with the work that produced it.
 *
 * THIS IS A SEPARATE FILE FROM THE RESEARCH REGISTRY. `research-registry/ledger.jsonl` is historical
 * evidence about closed studies and is never written by this module.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it computes no score, applies no passing criterion, and
 * does not modify `scoreJournal`. The period-reset rule is expressed as a BOUNDARY plus a pure filter
 * (`recordsAfterBoundary`), so a caller scopes evidence to the current version without any scoring
 * rule changing. Passing criteria live in `analyst/protocol.mjs` and `docs/PAPER-PROTOCOL.md`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LEDGER_SCHEMA = "cajh-candidate-version/v1";
export const GENESIS_HASH = "0".repeat(64);

export const KIND = Object.freeze({
  VERSION: "candidate-version",
  FIRST_DECISION: "first-decision",
});

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Anchored to the repository root, not the process's idea of "here".
 *
 * The journal had exactly this bug: it resolved against the working directory, so running from a
 * subdirectory silently started a SECOND record and settlement then found nothing to settle. A ledger
 * that forks the same way would under-report the family size, which is the one number it exists to
 * keep honest. `CAJH_LEDGER` overrides, resolved absolutely.
 */
export const DEFAULT_LEDGER = process.env.CAJH_LEDGER
  ? path.resolve(process.env.CAJH_LEDGER)
  : path.join(REPO, "analyst-ledger.jsonl");

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

/** Key-sorted JSON, so a hash depends on content and not on property insertion order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The hash an entry commits to: everything except the hash field itself. */
export function entryHash(entry) {
  const { hash: _omit, ...rest } = entry;
  return sha256(canonicalJson(rest));
}

/**
 * Every entry, oldest first. A malformed line comes back as `{ malformed, line, index }` rather than
 * being skipped, so `verifyLedger` can report it instead of the file quietly shrinking.
 */
export function readLedger(file = DEFAULT_LEDGER) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      return { malformed: true, line, index };
    }
  });
}

/** One line, one `appendFileSync`, so a concurrent reader sees either no line or a complete one. */
function append(kind, body, file) {
  const ledger = readLedger(file);
  const tail = ledger.at(-1);
  const entry = {
    schema: LEDGER_SCHEMA,
    seq: ledger.length,
    kind,
    recordedAt: new Date().toISOString(),
    prevHash: tail ? (tail.hash ?? GENESIS_HASH) : GENESIS_HASH,
    ...body,
  };
  entry.hash = entryHash(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

const str = (v, label) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`ledger: ${label} is required and must be a non-empty string`);
  return v.trim();
};
const posInt = (v, label) => {
  if (!Number.isInteger(v) || v < 1) throw new Error(`ledger: ${label} is required and must be a positive integer`);
  return v;
};
const num = (v, label) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`ledger: ${label} is required and must be a finite number`);
  return v;
};

export const versionsOf = (ledger, candidateId) =>
  ledger.filter((e) => e.kind === KIND.VERSION && e.candidateId === candidateId);

/** The highest-seq registration for a candidate: the configuration currently in force. */
export function currentVersion(candidateId, file = DEFAULT_LEDGER) {
  return versionsOf(readLedger(file), candidateId).at(-1) ?? null;
}

/**
 * Hashes of the three inputs whose revision makes a NEW candidate.
 *
 * Hashes the RENDERED prompt rather than the source of the builder: what matters is the text the model
 * is actually given, and a refactor that leaves the rendered prompt identical is not a new candidate.
 * Passing the checklist through is what `--no-checklist` varies, so the two arms hash differently by
 * construction — which is the point.
 */
export function inputHashes({ systemPrompt, checklist, checklistId, universeText }) {
  return {
    prompt: sha256(str(systemPrompt, "systemPrompt")),
    checklist: sha256(canonicalJson({ checklistId: checklistId ?? null, checklist: checklist ?? null })),
    universe: sha256(str(universeText, "universeText")),
  };
}

/**
 * Register a candidate version. Must be called BEFORE its first decision — that ordering is the whole
 * point, and `firstDecisionAt` is a separate later entry precisely so this one cannot be edited to
 * look earlier than it was.
 *
 * Every field is required because a version whose claim can be reconstructed only from a later
 * write-up is a version whose claim could have moved.
 */
export function registerVersion({
  candidateId, version, whatChanged, why, registeredClaim, control,
  minimumPeriods, mdeAtMinimum, drawdownWindow, supersedes = null, hashes,
}, file = DEFAULT_LEDGER) {
  const id = str(candidateId, "candidateId");
  const ver = str(version, "version");

  // IMMUTABLE. Re-registering is how a claim gets quietly revised after seeing a result, so it throws.
  if (versionsOf(readLedger(file), id).some((e) => e.version === ver)) {
    throw new Error(`ledger: ${id} version ${ver} is already registered — a revision is a NEW version, never an edit`);
  }
  if (!hashes || typeof hashes !== "object") throw new Error("ledger: hashes is required (use inputHashes())");
  for (const k of ["prompt", "checklist", "universe"]) {
    if (!/^[0-9a-f]{64}$/.test(hashes[k] ?? "")) throw new Error(`ledger: hashes.${k} must be a sha256 hex digest`);
  }

  return append(KIND.VERSION, {
    candidateId: id,
    version: ver,
    whatChanged: str(whatChanged, "whatChanged"),
    why: str(why, "why"),
    registeredClaim: str(registeredClaim, "registeredClaim"),
    control: str(control, "control"),
    minimumPeriods: posInt(minimumPeriods, "minimumPeriods"),
    mdeAtMinimum: num(mdeAtMinimum, "mdeAtMinimum"),
    drawdownWindow: str(drawdownWindow, "drawdownWindow"),
    supersedes: supersedes === null ? null : str(supersedes, "supersedes"),
    hashes: { prompt: hashes.prompt, checklist: hashes.checklist, universe: hashes.universe },
  }, file);
}

/**
 * Mark the registration boundary: the first decision this version produced.
 *
 * A separate append rather than a field edit, because the ledger is append-only. Idempotent by
 * design — it returns the existing marker instead of throwing, so a scheduled runner calling it every
 * session does not fail on its second run. A second DIFFERENT first decision is a contradiction, so
 * only the first one is ever recorded.
 */
export function markFirstDecision({ candidateId, version, at, batchId = null }, file = DEFAULT_LEDGER) {
  const id = str(candidateId, "candidateId");
  const ver = str(version, "version");
  const ledger = readLedger(file);
  if (!versionsOf(ledger, id).some((e) => e.version === ver)) {
    throw new Error(`ledger: ${id} version ${ver} is not registered — register it BEFORE its first decision`);
  }
  const existing = firstDecisionEntry(id, ver, ledger);
  if (existing) return { entry: existing, alreadyMarked: true };
  return {
    entry: append(KIND.FIRST_DECISION, {
      candidateId: id, version: ver, firstDecisionAt: str(at, "at"), batchId,
    }, file),
    alreadyMarked: false,
  };
}

export function firstDecisionEntry(candidateId, version, ledger) {
  return ledger.find((e) => e.kind === KIND.FIRST_DECISION && e.candidateId === candidateId && e.version === version) ?? null;
}

/**
 * THE FORWARD FAMILY SIZE. The count of registered versions, to be printed beside any result so the
 * forward run's own alpha budget stays visible instead of going stale the way the retrospective one
 * did. Counts every candidate, because the look-elsewhere exposure is programme-wide.
 */
export function familySize(file = DEFAULT_LEDGER) {
  return readLedger(file).filter((e) => e.kind === KIND.VERSION).length;
}

/**
 * THE PERIOD-RESET RULE, as a boundary rather than a scoring change.
 *
 * "A version change resets that candidate's independent-period count to zero" — a revised analyst has
 * not accumulated the old one's evidence. Expressed as the timestamp from which this version's
 * evidence begins; `null` means the current version has not decided yet, so it has no evidence at all.
 * Callers scope records with `recordsAfterBoundary`. Nothing here recomputes a score.
 */
export function evidenceWindow(candidateId, file = DEFAULT_LEDGER) {
  const ledger = readLedger(file);
  const current = versionsOf(ledger, candidateId).at(-1);
  if (!current) return null;
  const marker = firstDecisionEntry(candidateId, current.version, ledger);
  return {
    candidateId,
    version: current.version,
    since: marker ? marker.firstDecisionAt : null,
    supersedes: current.supersedes,
    minimumPeriods: current.minimumPeriods,
    mdeAtMinimum: current.mdeAtMinimum,
    hashes: current.hashes,
  };
}

/**
 * Pure filter: journal records at or after a boundary. A filter, NOT a scoring rule — it changes no
 * metric, no criterion and no threshold. With `since === null` it returns nothing, which is the
 * correct reading of "this version has produced no evidence yet".
 */
export function recordsAfterBoundary(records, since, timeOf = (r) => r.at ?? null) {
  if (since === null || since === undefined) return [];
  const cut = Date.parse(since);
  if (Number.isNaN(cut)) throw new Error(`ledger: boundary "${since}" is not a parseable timestamp`);
  return records.filter((r) => {
    const t = timeOf(r);
    const ms = t === null ? NaN : Date.parse(t);
    return !Number.isNaN(ms) && ms >= cut;
  });
}

/**
 * Does the configuration currently in force still match what was registered?
 *
 * This is the check that makes the ledger bite: an unregistered prompt change would otherwise pool a
 * new candidate's decisions into the old one's evidence silently. Returns which inputs drifted.
 */
export function driftFromRegistered(candidateId, current, file = DEFAULT_LEDGER) {
  const reg = currentVersion(candidateId, file);
  if (!reg) return { registered: false, drifted: ["prompt", "checklist", "universe"], version: null };
  const drifted = ["prompt", "checklist", "universe"].filter((k) => reg.hashes?.[k] !== current[k]);
  return { registered: true, version: reg.version, drifted };
}

/**
 * Verify the chain. `problems` names the index at which the ledger stops being consistent with
 * itself, which is what a deleted or edited historical record looks like from the outside.
 */
export function verifyLedger(file = DEFAULT_LEDGER) {
  const entries = readLedger(file);
  const problems = [];
  let prev = GENESIS_HASH;
  entries.forEach((e, i) => {
    if (e.malformed) { problems.push({ index: i, problem: "unparseable line" }); return; }
    if (e.schema !== LEDGER_SCHEMA) problems.push({ index: i, problem: `unexpected schema: ${e.schema}` });
    if (e.seq !== i) problems.push({ index: i, problem: `seq ${e.seq} does not match position ${i} — an entry was removed or reordered` });
    if (e.prevHash !== prev) problems.push({ index: i, problem: "prevHash does not match the preceding entry — the chain is broken" });
    if (e.hash !== entryHash(e)) problems.push({ index: i, problem: "hash does not match content — the entry was edited after it was written" });
    prev = e.hash;
  });
  return { ok: problems.length === 0, entries: entries.length, problems };
}
