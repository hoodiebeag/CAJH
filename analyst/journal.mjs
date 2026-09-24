/**
 * analyst/journal.mjs — the append-only record of what the analyst decided and why.
 *
 * THIS FILE CANNOT PLACE AN ORDER, and not because of a flag. It imports `fs`, `crypto` and
 * nothing else. There is no broker here, no venue client, no order module, and therefore no code
 * path to audit for one — the same construction `paper.mjs` uses and for the same reason.
 *
 * WHY THE JOURNAL IS A FIRST-CLASS COMPONENT RATHER THAN LOGGING.
 *
 * A mechanical strategy is its own documentation: you can read the rule and know what it will do.
 * A discretionary agent is not. Its decision exists only in the moment it was made, against a
 * context that has already moved, for reasons that were never written down unless something wrote
 * them down. Without this file, a year of trading produces a P&L number and no way to tell whether
 * it came from skill, luck, or one lucky week in March.
 *
 * So three things are recorded that logging would not bother with:
 *
 *  1. THE THESIS, as stated BEFORE the outcome. The risk gate already refuses a proposal without
 *     one. This is what makes a discretionary record worth more than its P&L: you can go back and
 *     ask whether the reasoning was good, separately from whether the trade worked. Those come
 *     apart constantly and only the journal can tell them apart.
 *
 *  2. THE CONTEXT HASH. Exactly what the analyst saw, fingerprinted, so a decision can be replayed
 *     against the same inputs. A decision that cannot be replayed cannot be debugged, and "the
 *     model was probably looking at something like this" is not a reproduction.
 *
 *  3. THE MATCHED RANDOM CONTROL, drawn at decision time from the same eligible pool at the same
 *     sizes. THIS IS THE CENTRAL FEATURE OF THE FILE. This project's most expensive lesson is that
 *     every one of sixteen closed mechanisms beat a statistical null while losing to a baseline,
 *     and that a 13-name weekly-rotated decile book on this universe returns +33.70% net at Sharpe
 *     0.850 ON RANDOM PICKS. An analyst holding a decile inherits that null exactly. Computing the
 *     control months later, from a book that has already been selected, is how a comparison gets
 *     quietly rigged; drawing it at decision time from the same pool makes it honest and makes it
 *     free.
 *
 * WHY APPEND-ONLY, AND WHY OUTCOMES GO IN A SEPARATE RECORD. A decision record is never rewritten
 * once written. Outcomes arrive later and are appended as their own lines keyed by batch and
 * symbol. If outcomes were patched into decision records, the file would lose the one property
 * that makes it evidence: that the thesis was fixed before the result was known. An editable
 * record of a prediction is not a prediction.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_JOURNAL = "analyst-journal.jsonl";

/** Record kinds. Stable strings; the file is read by line type, not by position. */
export const KIND = Object.freeze({
  DECISION: "decision",
  OUTCOME: "outcome",
  NOTE: "note",
});

/**
 * Fingerprint of what the analyst saw.
 *
 * Keys are sorted before hashing so that an object whose properties were built in a different
 * order still fingerprints identically -- otherwise the hash would report a context change every
 * time an unrelated loop reordered its inserts, and a hash that cries wolf gets ignored.
 */
export function hashContext(context) {
  return crypto.createHash("sha256").update(stableStringify(context)).digest("hex").slice(0, 16);
}

function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/**
 * Draw the matched random control for a batch: the same number of names at the same sizes, taken
 * at random from the pool the analyst was actually choosing from.
 *
 * THE POOL MATTERS MORE THAN THE DRAW. A control drawn from the whole universe when the analyst
 * only considered fifty names measures universe selection, not stock selection. The caller passes
 * the eligible pool for that batch, and if it passes the wrong one the control is wrong in a way
 * no amount of draws will fix.
 *
 * Deterministic given `seed`, so a batch's control can be regenerated from the journal rather than
 * trusted from it.
 */
export function matchedRandomControl(allowed, pool, seed) {
  const sized = allowed.filter((p) => p.action !== "hold" && p.targetPct > 0);
  if (!sized.length || !pool.length) return [];
  const rng = mulberry32(seed);
  const bag = [...pool];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  // One control name per sized decision, at that decision's size. Sampling WITHOUT replacement,
  // and truncating if the pool is smaller than the book rather than drawing a name twice -- a
  // duplicated name would concentrate the control in a way the real book could not be.
  return sized.slice(0, bag.length).map((p, i) => ({ symbol: bag[i], targetPct: p.targetPct }));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Append one decision batch.
 *
 * Returns the written record. Never throws on a malformed field -- it writes what it was given,
 * because a journal that refuses to record an unusual decision is a journal that loses exactly the
 * decisions worth reviewing. Validation belongs upstream in the risk gate.
 */
export function recordDecision({
  batchId, at, context, proposals, gate, pool, seed, model, mode, news, newsSymbols,
}, file = DEFAULT_JOURNAL) {
  const contextHash = hashContext(context ?? {});
  const record = {
    kind: KIND.DECISION,
    batchId,
    at: at ?? new Date().toISOString(),
    mode: mode ?? "paper",
    model: model ?? null,
    contextHash,
    // THE DECISION BAR, stored explicitly. Without it an outcome cannot be computed later without
    // parsing it back out of `batchId`, and a derived string is not a schema. Older records predate
    // this field; `settle` counts them rather than guessing at their entry bar.
    asOfTime: Number.isFinite(context?.asOfTime) ? context.asOfTime : null,
    // What the analyst could SEE, kept beside what it did. Without this, a batch decided on price
    // alone and a batch decided with a full news panel are indistinguishable afterwards, and the
    // one claim this design rests on cannot be tested against its own control population.
    news: news ?? null,
    // The thesis is kept verbatim. It is the part that can be reviewed independently of P&L.
    proposals: (proposals ?? []).map((p) => ({
      symbol: p.symbol, action: p.action, targetPct: p.targetPct ?? null,
      confidence: p.confidence ?? null, thesis: p.thesis ?? null,
    })),
    // `hadNews` is per NAME, not per batch. The claim under test is that a headline on the name
    // being bought is what carries the edge, and a batch-level flag cannot answer it: a batch with
    // news on two of forty candidates would mark all forty as informed.
    allowed: (gate?.allowed ?? []).map((p) => ({
      symbol: p.symbol, action: p.action, targetPct: p.targetPct ?? null,
      hadNews: newsSymbols ? newsSymbols.has(String(p.symbol).toUpperCase()) : null,
    })),
    rejected: (gate?.rejected ?? []).map((r) => ({ symbol: r.proposal?.symbol ?? null, code: r.code, detail: r.detail })),
    exposure: gate?.exposure ?? null,
    halted: gate?.halted ?? false,
    braked: gate?.braked ?? false,
    control: matchedRandomControl(gate?.allowed ?? [], pool ?? [], seed ?? hashToSeed(batchId)),
    poolSize: (pool ?? []).length,
  };
  append(file, record);
  return record;
}

/**
 * Append an outcome for one symbol in one batch.
 *
 * Separate from the decision record ON PURPOSE. See the file header: patching results into a
 * decision would destroy the only property that makes it evidence.
 */
export function recordOutcome({ batchId, symbol, at, holdDays, grossReturn, netReturn, controlReturn, note },
  file = DEFAULT_JOURNAL) {
  const record = {
    kind: KIND.OUTCOME,
    batchId, symbol,
    at: at ?? new Date().toISOString(),
    holdDays: holdDays ?? null,
    grossReturn: grossReturn ?? null,
    netReturn: netReturn ?? null,
    controlReturn: controlReturn ?? null,
    note: note ?? null,
  };
  append(file, record);
  return record;
}

/** A free-text marker -- a halt, a restart, a data outage. Things that explain a gap later. */
export function recordNote(text, file = DEFAULT_JOURNAL) {
  const record = { kind: KIND.NOTE, at: new Date().toISOString(), text: String(text) };
  append(file, record);
  return record;
}

function append(file, record) {
  const dir = path.dirname(file);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
}

function hashToSeed(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Read the journal. A malformed line is skipped and counted rather than killing the read. */
export function readJournal(file = DEFAULT_JOURNAL) {
  if (!fs.existsSync(file)) return { records: [], malformed: 0 };
  const records = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { malformed++; }
  }
  return { records, malformed };
}

/**
 * Modes a decision can be recorded under. THE DISTINCTION IS LOAD-BEARING, NOT BOOKKEEPING.
 *
 *   paper       forward, real model, decision date is today. THE ONLY MODE THAT IS EVIDENCE.
 *   dry-run     the wiring exercised on historical data to prove it works end to end.
 *   anonymised  reasoning checked on historical data with identities stripped.
 *
 * Why the last two can never count: this agent cannot be backtested. A model asked what it would
 * do on a past date already knows what happened -- market history is in the weights, and the
 * contamination flatters it exactly where the pull to deploy is strongest. See
 * docs/ANALYST-DESIGN.md. So a historical run is a plumbing test or a reasoning probe, never a
 * track record, and `scoreJournal` refuses to blend them rather than trusting a future reader to
 * remember the difference.
 */
export const MODE = Object.freeze({
  PAPER: "paper",
  DRY_RUN: "dry-run",
  ANONYMISED: "anonymised",
});

/** Only this mode may be cited as evidence of edge. */
export const EVIDENCE_MODES = Object.freeze([MODE.PAPER]);

/**
 * The readout that matters: is the analyst beating its own coin flip?
 *
 * Reports the agent and its matched control SIDE BY SIDE and refuses to editorialise beyond that.
 * `edge` is the difference, and it is the number this whole design is trying to establish is
 * positive.
 *
 * SCORES ONE MODE AT A TIME, DEFAULTING TO PAPER. Blending a dry run into a forward record would
 * quietly convert contaminated decisions into a track record, which is the single worst thing this
 * file could do. `contaminatedRecords` counts what was excluded so the exclusion is visible rather
 * than silent -- a number that has been dropped should say so.
 *
 * NO SIGNIFICANCE TEST IS COMPUTED HERE, DELIBERATELY. With a handful of outcomes any p-value is
 * noise with a decimal point, and this project's own rule is that a p-value without its baseline
 * beside it is misleading. The baselines are printed instead. A test belongs at the point the
 * standing minimum is met, not before.
 */
export function scoreJournal(file = DEFAULT_JOURNAL, { mode = MODE.PAPER } = {}) {
  const { records, malformed } = readJournal(file);
  const allDecisions = records.filter((r) => r.kind === KIND.DECISION);
  const decisions = allDecisions.filter((r) => (r.mode ?? MODE.PAPER) === mode);
  const keptBatches = new Set(decisions.map((d) => d.batchId));
  // An outcome belongs to the mode of the decision that produced it.
  const outcomes = records.filter((r) => r.kind === KIND.OUTCOME && keptBatches.has(r.batchId));
  const contaminatedRecords = allDecisions.length - decisions.length;

  const agentNet = outcomes.map((o) => o.netReturn).filter((v) => typeof v === "number");
  const ctrlNet = outcomes.map((o) => o.controlReturn).filter((v) => typeof v === "number");

  // THE SPLIT THAT TESTS THE DESIGN'S ONE CLAIM.
  //
  // This pivot exists because the price half is closed: the argument is that the edge comes from
  // the non-price input. That is only testable by comparing the names bought WITH a headline
  // against the names bought without, so the flag recorded per name is read here rather than
  // sitting in the file unused.
  //
  // IT IS REPORTED WITH BOTH COUNTS AND NO VERDICT. Splitting a small sample makes two smaller
  // ones, and a skewed payoff needs more outcomes than a symmetric one, not fewer. `comparable`
  // says whether the split is worth reading at all; nothing here decides that it is.
  const hadNewsFor = new Map();
  for (const d of decisions) {
    for (const a of d.allowed ?? []) {
      if (a.hadNews === null || a.hadNews === undefined) continue;
      hadNewsFor.set(`${d.batchId}\u0000${String(a.symbol).toUpperCase()}`, a.hadNews);
    }
  }
  const bucket = { withNews: [], withoutNews: [], unknown: [] };
  for (const o of outcomes) {
    if (typeof o.netReturn !== "number") continue;
    const flag = hadNewsFor.get(`${o.batchId}\u0000${String(o.symbol).toUpperCase()}`);
    (flag === true ? bucket.withNews : flag === false ? bucket.withoutNews : bucket.unknown).push(o);
  }

  const rejectCounts = {};
  for (const d of decisions) for (const r of d.rejected ?? []) {
    rejectCounts[r.code] = (rejectCounts[r.code] ?? 0) + 1;
  }

  const sized = decisions.reduce((n, d) => n + (d.allowed ?? []).filter((a) => a.action !== "hold").length, 0);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  return {
    mode,
    isEvidence: EVIDENCE_MODES.includes(mode),
    batches: decisions.length,
    decisions: sized,
    outcomes: outcomes.length,
    malformed,
    // Records from other modes, excluded from every number above. Reported so the exclusion is
    // visible: a figure that has dropped data should say how much.
    contaminatedRecords,
    agentMeanNet: mean(agentNet),
    controlMeanNet: mean(ctrlNet),
    edge: agentNet.length && ctrlNet.length ? mean(agentNet) - mean(ctrlNet) : null,
    hitRate: agentNet.length ? agentNet.filter((v) => v > 0).length / agentNet.length : null,
    beatControlRate: outcomes.length
      ? outcomes.filter((o) => typeof o.netReturn === "number" && typeof o.controlReturn === "number"
          && o.netReturn > o.controlReturn).length / outcomes.length
      : null,
    newsSplit: {
      withNews: summariseBucket(bucket.withNews),
      withoutNews: summariseBucket(bucket.withoutNews),
      unknown: bucket.unknown.length,
      // A threshold that says "do not read this yet", not one that blesses it when passed.
      comparable: bucket.withNews.length >= 20 && bucket.withoutNews.length >= 20,
    },
    rejectCounts,
    halts: decisions.filter((d) => d.halted).length,
    brakes: decisions.filter((d) => d.braked).length,
    // 60 days and 50 trades (docs/PAPER-PROTOCOL.md re-derives why this floor does not fit a skewed payoff). A floor reached in real time, not a target.
    meetsStandingMinimum: sized >= 50 && spanDays(decisions) >= 60,
    spanDays: spanDays(decisions),
  };
}

function summariseBucket(rows) {
  const net = rows.map((o) => o.netReturn).filter((v) => typeof v === "number");
  const ctrl = rows.map((o) => o.controlReturn).filter((v) => typeof v === "number");
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    n: rows.length,
    meanNet: mean(net),
    controlMeanNet: mean(ctrl),
    edge: net.length && ctrl.length ? mean(net) - mean(ctrl) : null,
  };
}

function spanDays(decisions) {
  const ts = decisions.map((d) => Date.parse(d.at)).filter((n) => Number.isFinite(n));
  if (ts.length < 2) return 0;
  return Math.round((Math.max(...ts) - Math.min(...ts)) / 86400000);
}
