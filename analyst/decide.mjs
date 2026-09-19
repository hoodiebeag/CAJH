/**
 * analyst/decide.mjs — turn a context into proposals by asking a model, and trust nothing it says.
 *
 * THE CLIENT IS INJECTED, NOT IMPORTED. `decide()` takes a `client` with the shape
 * `{ messages: { create(params) } }`. That is the whole reason this file is testable: every path
 * -- refusal, truncation, malformed JSON, prose around the JSON, hallucinated symbols, sizes over
 * the cap -- can be driven by a fake without a network or a key.
 *
 * AND THE FAKE IS SHAPED ON THE REAL SDK, NOT ON WHAT WOULD BE CONVENIENT. This project has a
 * scar here. `brokers/ibkr.test.mjs` emitted @stoqey/ib's error events with the arguments
 * BACKWARDS, the adapter was written to match the mock, and twenty-seven green tests certified it
 * for weeks; only a live Gateway found it. So the response shape used in the tests was read out of
 * node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts rather than from memory:
 * `{ id, type: "message", role: "assistant", model, content: ContentBlock[], stop_reason,
 *    stop_sequence, stop_details, container, usage }` with `stop_reason` one of
 * 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal'.
 *
 * THE OUTPUT IS UNTRUSTED INPUT. A language model returns text that looks like JSON. It can
 * hallucinate a ticker that is not in the slate, size a position at 400% of the account, return
 * nine fields when four were asked for, wrap the whole thing in prose, or stop halfway through.
 * None of that is exceptional; all of it is Tuesday. So every proposal is validated against the
 * context it was supposedly derived from, and anything that fails is DROPPED AND COUNTED rather
 * than repaired. A repaired proposal is a trade nobody proposed.
 *
 * A TRUNCATED RESPONSE IS DISCARDED WHOLE. If `stop_reason` is 'max_tokens' the JSON is
 * incomplete, and a partial parse would yield a book that is a FRAGMENT of the model's intent --
 * the first six names of a twelve-name plan, with the hedges and the sells missing. That is not a
 * conservative subset; it is a different and unbalanced book. The batch is rejected instead.
 *
 * THIS FILE CANNOT PLACE AN ORDER. It returns proposals. The risk gate and the journal are the
 * next two steps and neither is called from here.
 */

/** Actions the analyst may return. Anything else is dropped, not mapped onto the nearest match. */
const ACTIONS = new Set(["buy", "sell", "short", "cover", "hold"]);

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Why a batch produced nothing. Stable strings so the journal can aggregate without parsing prose. */
export const BATCH_FAILURE = Object.freeze({
  REFUSED: "model_refused",
  TRUNCATED: "response_truncated",
  NO_TEXT: "no_text_content",
  UNPARSEABLE: "unparseable_json",
  NOT_A_LIST: "decisions_not_a_list",
  CLIENT_ERROR: "client_error",
});

/**
 * The instruction. Written here rather than assembled per call so that a change to it is a diff in
 * version control, not a runtime surprise.
 *
 * IT STATES THE RISK LIMITS. Not because the model is trusted to honour them -- risk.mjs enforces
 * them and does not consult this text -- but because a proposal that violates a cap is a WASTED
 * proposal. Telling the model the shape of the box means more of its output survives the gate,
 * which is a throughput argument, not a safety one. The safety argument is in risk.mjs.
 *
 * IT ALSO TELLS THE MODEL IT IS BEING SCORED AGAINST A COIN FLIP, which is true and load-bearing:
 * this universe's matched random decile book is the actual bar, and an analyst that does not know
 * that will optimise for sounding right instead of for beating it.
 */
export function buildSystemPrompt({ maxPositionPct = 0.10, maxNewPositions = 5, shortingPermitted = false } = {}) {
  return [
    "You are a portfolio analyst managing a real book. You decide positions from the evidence given.",
    "",
    "HOW YOU ARE SCORED. Your picks are compared against a RANDOM selection of the same number of",
    "names at the same sizes from the same candidate pool, drawn at the moment you decide. On this",
    "universe a random decile book rotated weekly is a genuinely strong benchmark. Beating a",
    "buy-and-hold of the whole universe is the other bar. If your reasoning is excellent and your",
    "picks lose to a coin flip, you have produced nothing. Prefer taking no position to taking a",
    "position you cannot justify against those two comparisons.",
    "",
    "HARD CONSTRAINTS. These are enforced in code after you answer; violating them wastes the slot:",
    `  - at most ${(maxPositionPct * 100).toFixed(0)}% of NAV in any one position`,
    `  - at most ${maxNewPositions} NEW positions per batch`,
    "  - gross exposure may not exceed 100% of NAV; no leverage",
    shortingPermitted ? "  - shorting is permitted" : "  - shorting is NOT permitted; do not propose short or naked sell",
    "  - you may not increase a position that is currently under water",
    "  - closing a position is always allowed",
    "",
    "OUTPUT. Reply with a JSON object and nothing else. No prose, no markdown fence.",
    '  {"decisions": [{"symbol": "...", "action": "buy|sell|short|cover|hold",',
    '                  "targetPct": 0.05, "confidence": 0.0-1.0, "thesis": "..."}]}',
    "",
    "  targetPct is the TOTAL intended weight of that position as a fraction of NAV, not a change.",
    "  Direction comes from `action`; never send a negative targetPct.",
    "  For `hold` and for closing, targetPct may be 0.",
    "  `thesis` must state the actual reason in one or two sentences. It is recorded before the",
    "  outcome is known and reviewed against what happens. Write something that can be judged wrong.",
    "  Only propose symbols that appear in the candidates list you were given.",
    "  An empty decisions list is a valid and sometimes correct answer.",
  ].join("\n");
}

/**
 * Ask the model for a decision batch.
 *
 * @returns {{ proposals, failure, raw, dropped, usage, stopReason }}
 *   `failure` is null on success. `dropped` lists every proposal that was discarded and why, so a
 *   model that is reliably producing garbage is visible in the journal rather than merely quiet.
 */
export async function decide({
  client, context, model = DEFAULT_MODEL, maxTokens = 4000,
  maxPositionPct = 0.10, maxNewPositions = 5, shortingPermitted = false,
  systemPrompt = null,
} = {}) {
  if (!client?.messages?.create) throw new Error("decide: a client with messages.create is required");
  if (!context) throw new Error("decide: context is required");

  const system = systemPrompt ?? buildSystemPrompt({ maxPositionPct, maxNewPositions, shortingPermitted });
  const empty = { proposals: [], dropped: [], raw: null, usage: null, stopReason: null };

  let res;
  try {
    res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(context) }] }],
    });
  } catch (err) {
    return { ...empty, failure: { code: BATCH_FAILURE.CLIENT_ERROR, detail: String(err?.message ?? err) } };
  }

  const usage = res?.usage ?? null;
  const stopReason = res?.stop_reason ?? null;

  // A refusal is a real outcome and is recorded as one, not retried into compliance.
  if (stopReason === "refusal") {
    return {
      ...empty, usage, stopReason,
      failure: {
        code: BATCH_FAILURE.REFUSED,
        detail: res?.stop_details ? JSON.stringify(res.stop_details) : "model declined",
      },
    };
  }

  // See the header: a partial parse is a different book, not a smaller one.
  if (stopReason === "max_tokens") {
    return {
      ...empty, usage, stopReason,
      failure: { code: BATCH_FAILURE.TRUNCATED, detail: `hit max_tokens (${maxTokens}); batch discarded whole` },
    };
  }

  // `content` is an array of blocks and only some are text -- thinking and tool_use blocks also
  // appear there. Concatenate the text ones rather than assuming content[0].
  const text = (Array.isArray(res?.content) ? res.content : [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) {
    return { ...empty, usage, stopReason, failure: { code: BATCH_FAILURE.NO_TEXT, detail: "no text block in content" } };
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    return { ...empty, raw: text, usage, stopReason, failure: { code: BATCH_FAILURE.UNPARSEABLE, detail: parsed.reason } };
  }
  const decisions = parsed.value?.decisions;
  if (!Array.isArray(decisions)) {
    return {
      ...empty, raw: text, usage, stopReason,
      failure: { code: BATCH_FAILURE.NOT_A_LIST, detail: `decisions is ${typeof decisions}` },
    };
  }

  const known = new Set((context.candidates ?? []).map((c) => String(c.symbol).toUpperCase()));
  const { proposals, dropped } = normalise(decisions, known, { maxPositionPct, shortingPermitted });
  return { proposals, dropped, failure: null, raw: text, usage, stopReason };
}

/**
 * Pull a JSON object out of a text response.
 *
 * Models are asked for bare JSON and frequently send a markdown fence or a sentence of preamble
 * anyway. Tolerating that is not the same as tolerating malformed JSON: the structure still has to
 * parse, it just does not have to be alone. Anything that will not parse is a failure, never a
 * best-effort salvage -- guessing at a half-written book is how an invented trade gets journalled.
 */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return { ok: true, value: v };
    } catch { /* try the next shape */ }
  }
  return { ok: false, reason: "no parseable JSON object in response" };
}

/**
 * Validate every decision against the context it was supposedly derived from.
 *
 * Drops rather than repairs, and records why. The single most important check is the symbol one:
 * a model that returns a ticker which was not in the slate has not made a decision about the
 * evidence, it has recalled a name. That proposal is worthless even if the trade would have
 * worked, because nothing generated it.
 */
export function normalise(decisions, knownSymbols, { maxPositionPct = 0.10, shortingPermitted = false } = {}) {
  const proposals = [], dropped = [];
  const seen = new Set();
  const drop = (d, why) => dropped.push({ decision: d, why });

  for (const d of decisions) {
    if (!d || typeof d !== "object") { drop(d, "not an object"); continue; }

    const symbol = typeof d.symbol === "string" ? d.symbol.trim().toUpperCase() : null;
    if (!symbol) { drop(d, "symbol missing"); continue; }
    if (knownSymbols.size && !knownSymbols.has(symbol)) { drop(d, `symbol ${symbol} was not in the candidate slate`); continue; }
    if (seen.has(symbol)) { drop(d, `duplicate decision for ${symbol}`); continue; }

    const action = typeof d.action === "string" ? d.action.trim().toLowerCase() : null;
    if (!ACTIONS.has(action)) { drop(d, `unknown action ${JSON.stringify(d.action)}`); continue; }
    if (!shortingPermitted && action === "short") { drop(d, "shorting not permitted"); continue; }

    let targetPct = d.targetPct;
    if (action === "hold") {
      targetPct = 0;
    } else {
      if (typeof targetPct !== "number" || !Number.isFinite(targetPct)) { drop(d, "targetPct not a finite number"); continue; }
      if (targetPct < 0) { drop(d, "negative targetPct; direction comes from action"); continue; }
      // A model that answers "5" meaning 5% is not rescaled to 0.05. The instruction was explicit,
      // and silently reinterpreting it would turn a misunderstanding into a 500% position request
      // that happens to look reasonable after division.
      if (targetPct > 1) { drop(d, `targetPct ${targetPct} exceeds 1.0; expected a fraction of NAV`); continue; }
      if (targetPct > maxPositionPct) { drop(d, `targetPct ${targetPct} over the ${maxPositionPct} cap`); continue; }
    }

    const thesis = typeof d.thesis === "string" ? d.thesis.trim() : "";
    if (thesis.length < 10) { drop(d, "thesis missing or too short to review"); continue; }

    let confidence = d.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) confidence = null;
    else confidence = Math.min(1, Math.max(0, confidence));

    seen.add(symbol);
    proposals.push({ symbol, action, targetPct, confidence, thesis });
  }
  return { proposals, dropped };
}
