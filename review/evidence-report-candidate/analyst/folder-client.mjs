/**
 * analyst/folder-client.mjs — drive `decide()` from a folder instead of from a paid API.
 *
 * WHAT THIS IS. `decide()` takes an injected `client` with the shape `{ messages: { create } }` and
 * imports no SDK. That is the seam this file uses: it returns an object of that shape whose
 * `create` WRITES THE REQUEST TO A FILE and WAITS FOR AN ANSWER FILE to appear beside it. The
 * answer can be written by a person reading the request in a text editor, or by a separate AI
 * process watching the directory. Either way the analyst pipeline runs end to end with zero paid
 * API calls and no network.
 *
 * THE RESPONSE ENVELOPE IS SHAPED ON WHAT decide() ACTUALLY READS, not on what looks plausible.
 * Read out of analyst/decide.mjs at 4df86ea rather than from memory, because this repository has a
 * scar exactly here: `brokers/ibkr.test.mjs` emitted its mock's error events with the arguments
 * backwards, the adapter was written to match the mock, and twenty-seven green tests certified it
 * for weeks. `decide()` reads precisely four fields:
 *
 *   res.content      an ARRAY of blocks; it keeps `b.type === "text" && typeof b.text === "string"`,
 *                    maps to `b.text`, joins with "\n" and trims. A single text block is enough.
 *   res.stop_reason  "refusal" -> REFUSED, "max_tokens" -> TRUNCATED and the batch is discarded
 *                    whole; anything else proceeds. Returned to the caller as `stopReason`.
 *   res.usage        passed through verbatim as `usage`.
 *   res.stop_details read ONLY on a refusal.
 *
 * `res.model` is returned here for symmetry with the SDK envelope and with `stubClient` in
 * analyst-run.mjs, but decide() does not read it. Nothing else in the envelope is load-bearing.
 *
 * AND THE CALL SIGNATURE IS decide()'s, not the SDK's full surface. decide() calls
 * `create({ model, max_tokens, system, messages })` with
 * `messages = [{ role: "user", content: [{ type: "text", text: JSON.stringify(context) }] }]`.
 * Those four are what this records and what the content hash covers.
 *
 * EVERY FAILURE IS LOUD AND CODED. A folder exchange has failure modes an HTTP call does not: a
 * stale answer left over from yesterday's batch, an answer for a different batch, a half-written
 * file, an answer to a question that has since changed. Every one of them would otherwise look
 * like a successful decision. So each is its own coded error and NONE of them is swallowed or
 * polled past -- the one thing this file must never do is accept an answer to a question it did not
 * ask. A thrown error reaches decide()'s own try/catch and is journalled as a CLIENT_ERROR batch
 * failure, which is the correct outcome: no proposals, and the reason on the record.
 *
 * THE CONTENT HASH IS THE WHOLE INTEGRITY STORY. It is sha256 over canonical JSON of
 * `{ system, messages }` -- the exact question asked. The answer must carry it back. That is what
 * makes a stale or mismatched answer detectable rather than merely unlikely.
 *
 * WHAT THE EXTERNAL WRITER MUST DO, AND THIS FILE CANNOT ENFORCE. Write the response to a
 * temporary name in the same directory and `rename` it into place. A response read while it is
 * still being written parses as malformed and is reported as such -- correctly, since this file
 * cannot tell a truncated write from a corrupt answer, and guessing would defeat the point.
 *
 * NO NETWORK, NO ENVIRONMENT, NO DEPENDENCIES. node:fs, node:path and node:crypto only; no
 * `process.env` read anywhere; and nothing outside `dir` is ever read or written.
 *
 * THIS FILE CANNOT PLACE AN ORDER. It moves text between a folder and `decide()`.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Why a folder exchange failed. Stable strings, because a runner that cannot tell "nobody has
 * answered yet" from "somebody answered the wrong question" will retry the wrong one.
 */
export const FOLDER_ERROR = Object.freeze({
  /** A request file for this batchId exists and asks a DIFFERENT question. */
  REQUEST_CONFLICT: "FOLDER_REQUEST_CONFLICT",
  /** The ttl elapsed with no response file. decide() turns this into CLIENT_ERROR. */
  TIMEOUT: "FOLDER_TIMEOUT",
  /** The response file is not parseable JSON, or `text` is not a non-empty string. */
  RESPONSE_MALFORMED: "FOLDER_RESPONSE_MALFORMED",
  /** The response names a different batch. */
  RESPONSE_BATCH_MISMATCH: "FOLDER_RESPONSE_BATCH_MISMATCH",
  /** The response's contentHash does not match the question that was asked. */
  RESPONSE_STALE: "FOLDER_RESPONSE_STALE",
  /**
   * The batchId could not be used as a filename safely. NOT IN THE ORIGINAL SPEC, and added
   * because without it the promise "never reads or writes outside dir" is unenforceable: a
   * batchId of "../../etc/x" would compose a path outside it. Flagged rather than folded into one
   * of the codes above, which describe answers rather than arguments.
   */
  BATCHID_UNSAFE: "FOLDER_BATCHID_UNSAFE",
});

/** A batchId has to survive being a filename. Mirrors the ids the CLI generates: mode-YYYY-MM-DD. */
const SAFE_BATCHID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function coded(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * JSON with object keys sorted at every depth, so the same question always hashes the same way.
 *
 * ARRAY ORDER IS PRESERVED -- `messages` is a sequence and reordering it asks something else.
 * `undefined` values are skipped, matching JSON.stringify, so an explicitly-undefined field and an
 * absent one are the same question rather than two.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** sha256 hex of the canonical form of the question that was asked. */
export function contentHashOf({ system, messages }) {
  return crypto.createHash("sha256").update(canonicalJson({ system, messages }), "utf8").digest("hex");
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A `decide()`-compatible client backed by a directory.
 *
 * @param {string} dir          the exchange directory. Created if absent; nothing outside it is touched.
 * @param {string} batchId      names both files, and is checked back out of the response.
 * @param {number} ttlMinutes   how long to wait for an answer before FOLDER_TIMEOUT.
 * @param {number} pollMs       how often to look.
 */
export function makeFolderClient({ dir, batchId, ttlMinutes = 240, pollMs = 15000 } = {}) {
  if (typeof dir !== "string" || !dir) throw coded(FOLDER_ERROR.BATCHID_UNSAFE, "folder-client: dir is required");
  const id = String(batchId ?? "");
  if (!SAFE_BATCHID.test(id)) {
    throw coded(FOLDER_ERROR.BATCHID_UNSAFE,
      `folder-client: batchId ${JSON.stringify(id)} is not usable as a filename. It must match ` +
      `${SAFE_BATCHID} -- a path separator or ".." here would write outside the exchange directory.`);
  }

  const root = path.resolve(dir);
  const requestPath = path.join(root, `request-${id}.json`);
  const responsePath = path.join(root, `response-${id}.json`);

  return {
    dir: root,
    batchId: id,
    requestPath,
    responsePath,
    messages: {
      async create({ model, system, messages, max_tokens } = {}) {
        const contentHash = contentHashOf({ system, messages });

        // ---- 1. write the question, once ------------------------------------------------------
        //
        // WRITE-ONCE IS NOT FUSSINESS. The same batchId naming a different question is the
        // signature of a re-run after an edit to the prompt or the context, and silently
        // overwriting it would mean an answer already in flight gets attributed to a question
        // nobody asked. An IDENTICAL question is a resume -- the runner restarted while waiting --
        // and is left exactly as it was so the external reader's copy does not change underneath.
        fs.mkdirSync(root, { recursive: true });
        if (fs.existsSync(requestPath)) {
          let existing = null;
          try { existing = JSON.parse(fs.readFileSync(requestPath, "utf8")); } catch { existing = null; }
          const had = existing && typeof existing.contentHash === "string" ? existing.contentHash : null;
          if (had !== contentHash) {
            throw coded(FOLDER_ERROR.REQUEST_CONFLICT,
              `folder-client: ${path.basename(requestPath)} already exists and asks a different ` +
              `question (on disk contentHash ${had ?? "absent/unreadable"}, this call ${contentHash}). ` +
              `Refusing to overwrite it: an answer may already be in flight for the old one.`);
          }
        } else {
          fs.writeFileSync(requestPath, `${JSON.stringify({
            batchId: id,
            createdAt: new Date().toISOString(),
            model: model ?? null,
            max_tokens: max_tokens ?? null,
            contentHash,
            system,
            messages,
          }, null, 2)}\n`);
        }

        // ---- 2. wait for the answer -----------------------------------------------------------
        const deadline = Date.now() + Math.max(0, ttlMinutes) * 60_000;
        for (;;) {
          if (fs.existsSync(responsePath)) {
            // ---- 3. validate strictly, and never poll past a bad answer -----------------------
            const rawBytes = fs.readFileSync(responsePath, "utf8");
            let res;
            try {
              res = JSON.parse(rawBytes);
            } catch (err) {
              throw coded(FOLDER_ERROR.RESPONSE_MALFORMED,
                `folder-client: ${path.basename(responsePath)} is not parseable JSON (${err.message}). ` +
                `If it was still being written, the writer must rename a complete file into place.`);
            }
            if (!res || typeof res !== "object" || Array.isArray(res)) {
              throw coded(FOLDER_ERROR.RESPONSE_MALFORMED,
                `folder-client: ${path.basename(responsePath)} is not a JSON object.`);
            }
            if (res.batchId !== id) {
              throw coded(FOLDER_ERROR.RESPONSE_BATCH_MISMATCH,
                `folder-client: response names batch ${JSON.stringify(res.batchId)}, this client is ` +
                `${JSON.stringify(id)}. An answer to another batch is not an answer to this one.`);
            }
            if (res.contentHash !== contentHash) {
              throw coded(FOLDER_ERROR.RESPONSE_STALE,
                `folder-client: response carries contentHash ${JSON.stringify(res.contentHash)} but the ` +
                `question asked was ${contentHash}. The context or the prompt changed after this answer ` +
                `was written, so it answers something else.`);
            }
            if (typeof res.text !== "string" || res.text.trim() === "") {
              throw coded(FOLDER_ERROR.RESPONSE_MALFORMED,
                `folder-client: response.text must be a non-empty string, got ` +
                `${typeof res.text === "string" ? "an empty/whitespace string" : typeof res.text}.`);
            }

            // ---- 4. the envelope decide() reads ----------------------------------------------
            //
            // usage is ZERO AND THAT IS THE POINT: no tokens were bought. decide() passes it
            // through to the journal verbatim, so the record says what it cost.
            return {
              content: [{ type: "text", text: res.text }],
              stop_reason: "end_turn",
              usage: { input_tokens: 0, output_tokens: 0 },
              model,
            };
          }

          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            // ---- 5. nobody answered ---------------------------------------------------------
            throw coded(FOLDER_ERROR.TIMEOUT,
              `folder-client: no ${path.basename(responsePath)} after ${ttlMinutes} minute(s). The ` +
              `request is still on disk; answering it later and re-running resumes the same batch.`);
          }
          await sleep(Math.min(Math.max(1, pollMs), remaining));
        }
      },
    },
  };
}
