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
import { fileURLToPath } from "node:url";
import { clusteredBootstrapCI } from "../inference.mjs";

/**
 * WHERE THE EVIDENCE LIVES. ABSOLUTE, BECAUSE A RELATIVE PATH SILENTLY FORKS THE RECORD.
 *
 * This was the bare string "analyst-journal.jsonl", resolved against the working directory. Run
 * `paper` from a subdirectory and it starts a SECOND journal: no error, no warning, and `settle`
 * then finds nothing to settle because the decisions it is looking for are in the other file. That
 * is criterion 7 -- one of the four that stop the run -- failing for a reason that has nothing to
 * do with the system under test.
 *
 * Anchored to the repository root rather than the process's idea of "here". `CAJH_JOURNAL`
 * overrides it, and is itself resolved to an absolute path so the same hazard cannot come back in
 * through the override.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_JOURNAL = process.env.CAJH_JOURNAL
  ? path.resolve(process.env.CAJH_JOURNAL)
  : path.join(REPO_ROOT, "analyst-journal.jsonl");

/** Record kinds. Stable strings; the file is read by line type, not by position. */
export const KIND = Object.freeze({
  DECISION: "decision",
  OUTCOME: "outcome",
  NOTE: "note",
  SKIP: "skip",
});

/**
 * Why a session produced no decision. Structured, because these get COUNTED, not read.
 *
 * Three of the paper protocol's ten Tier-1 criteria are assertions about batches that did NOT
 * happen -- zero point-in-time skips, zero batches on a stale or future-dated panel -- and two of
 * those stop the run if they fail. A free-text note cannot answer them; a reason code can.
 */
export const SKIP_REASON = Object.freeze({
  CONTEXT_NOT_POINT_IN_TIME: "context_not_point_in_time",
  PANEL_STALE: "panel_stale",
  PANEL_FUTURE_DATED: "panel_future_dated",
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
  batchId, at, context, proposals, gate, pool, seed, model, mode, news, newsSymbols, failure = null,
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
    // WHY THE BATCH PRODUCED NOTHING, WHEN IT PRODUCED NOTHING. A refusal, a truncation and a
    // batch where the model simply saw no trade all journalled identically -- empty proposals,
    // empty allowed -- so "under 10% of batches lost to refusal, truncation or malformed JSON" was
    // not answerable from the record. null means the batch ran; a code means it did not.
    failure: failure ? { code: failure.code, detail: failure.detail ?? null } : null,
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

/**
 * Append a record of a session that produced no decision, and why.
 *
 * A SILENT REFUSAL AND A RUNNER THAT NEVER FIRED LOOK IDENTICAL A MONTH LATER. The guards that
 * refuse a stale or future-dated panel are the system working, and the point-in-time check is the
 * single most important thing this design asserts -- but all three used to leave nothing behind
 * except a line on somebody's terminal. The reasoning is already written down twenty lines below
 * the first of them, for the model-failure path: a journal that only records the days it worked
 * describes a different agent than the one running. It applies here unchanged.
 *
 * `detail` is free-form and for a human. `reason` is what gets counted.
 */
export function recordSkip({ batchId = null, at, mode, reason, detail = null }, file = DEFAULT_JOURNAL) {
  const record = {
    kind: KIND.SKIP,
    batchId,
    at: at ?? new Date().toISOString(),
    mode: mode ?? MODE.PAPER,
    reason: String(reason),
    detail,
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
/**
 * Which non-overlapping holding period each outcome belongs to.
 *
 * THE INDEPENDENT UNIT IS THE PERIOD, NOT THE TRADE, AND THE DIFFERENCE IS ABOUT AN ORDER OF
 * MAGNITUDE. Twenty trading days of daily decisions on a five-day hold looks like a hundred trades
 * and is four observations: the holds overlap, every name in a batch shares one market, and one
 * bad week contaminates every decision inside it. Counting trades overstates the evidence in the
 * flattering direction, which is why the protocol requires the period count printed beside the edge.
 *
 * KEYED ON THE ENTRY SESSION'S RANK, NOT ON THE CALENDAR DAY. Bucketing by decision day would give
 * about twenty clusters for a month rather than four -- the same overstatement in a new hat. The
 * rank is taken over the distinct entry times actually present, so `floor(rank / holdDays)` groups
 * each run of `holdDays` consecutive decision sessions into one period.
 *
 * WHERE THIS IS WRONG, IT IS WRONG CONSERVATIVELY. If sessions were missed, the rank understates
 * elapsed sessions and two genuinely non-overlapping decisions can land in one period. That loses
 * a period, widening the interval. The opposite error -- inventing periods -- would narrow it, and
 * every mistake this project has made about evidence has been in that direction.
 *
 * Outcomes whose decision is not in the journal go into a single shared bucket for the same reason:
 * one cluster of unknowns is conservative, one cluster each would manufacture independence.
 */
export function holdPeriodKeys(decisions, outcomes, holdDays) {
  const entryOf = new Map(decisions.map((d) => [d.batchId, d.asOfTime]));
  const times = [...new Set(decisions.map((d) => d.asOfTime).filter(Number.isFinite))].sort((a, b) => a - b);
  const rankOf = new Map(times.map((t, i) => [t, i]));
  return outcomes.map((o) => {
    const rank = rankOf.get(entryOf.get(o.batchId));
    return rank === undefined ? "period:unknown" : `period:${Math.floor(rank / holdDays)}`;
  });
}

/** The hold the outcomes were actually settled on. The longest wins: fewest periods, widest interval. */
function holdDaysOf(outcomes, fallback = 5) {
  const holds = outcomes.map((o) => o.holdDays).filter((h) => Number.isFinite(h) && h > 0);
  return holds.length ? Math.max(...holds) : fallback;
}

export function scoreJournal(file = DEFAULT_JOURNAL, { mode = MODE.PAPER, holdDays = null } = {}) {
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

  // THE PAIRED DIFFERENCE, RESAMPLED BY PERIOD RATHER THAN BY TRADE.
  //
  // The quantity under test is the analyst minus its own matched control on the same slate at the
  // same instant, and its interval has to be drawn over whole periods or it describes a sample size
  // the run does not have. `outcomes` is the trade count and stays reported beside it; the two
  // numbers differing by roughly ten times IS the point, not a discrepancy to reconcile.
  const hold = holdDays ?? holdDaysOf(outcomes);
  const paired = outcomes.filter((o) => Number.isFinite(o.netReturn) && Number.isFinite(o.controlReturn));
  const pairedKeys = holdPeriodKeys(decisions, paired, hold);
  const raw = clusteredBootstrapCI(paired.map((o) => o.netReturn - o.controlReturn), { keys: pairedKeys });

  // ONE CLUSTER HAS NO INTERVAL, AND MUST NOT BE PRINTED AS A NARROW ONE.
  //
  // A cluster bootstrap resamples whole clusters. With one, every iteration redraws the same
  // cluster, every draw is identical, and lo == hi == the point estimate. Found by running the
  // chain on a real-panel journal: it printed "95% CI -1.61% .. -1.61%", which reads as a precise
  // measurement and actually means the variance could not be estimated at all. A zero-width
  // interval is the most flattering possible way to report no information, so the bounds are
  // nulled and `degenerate` says why.
  const edgeCI = raw.clusters < 2 ? { ...raw, lo: null, hi: null, degenerate: true } : { ...raw, degenerate: false };

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
    // The sample size that governs the claim. `outcomes` above is the trade count and is not it.
    holdDays: hold,
    periods: edgeCI.clusters,
    edgeCI,
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

/**
 * The instant a decision was ABOUT, not the instant it was written down.
 *
 * `at` is a write timestamp. In a forward paper run the two coincide, which is why this went
 * unnoticed; everywhere else they do not. A journal replayed, backfilled or rebuilt in one sitting
 * has every `at` inside the same minute while its decisions cover months.
 *
 * Falls back to `at` for records written before `asOfTime` existed. Mixing a bar time with a write
 * time is imperfect, and it is strictly closer than using write times throughout.
 */
export function decisionTimeMs(d) {
  return Number.isFinite(d?.asOfTime) ? d.asOfTime * 1000 : Date.parse(d?.at);
}

/**
 * Calendar days from the first decision to the last, measured on the decision bars.
 *
 * WHY THIS IS NOT COSMETIC: `meetsStandingMinimum` gates on it. Read off write timestamps, five
 * batches covering 2026-07-09 to 2026-08-06 reported a span of 0 days, so any journal not written
 * in real time could never reach the 60-day floor no matter how much history it contained.
 */
function spanDays(decisions) {
  const ts = decisions.map(decisionTimeMs).filter((n) => Number.isFinite(n));
  if (ts.length < 2) return 0;
  return Math.round((Math.max(...ts) - Math.min(...ts)) / 86400000);
}
