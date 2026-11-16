/**
 * analyst/run-folder.mjs — run the existing pipeline with the folder exchange in the model's place.
 *
 * THIS FILE IS GLUE AND DELIBERATELY ALMOST EMPTY. `runOnce` in analyst/loop.mjs already IS the
 * runner: it assembles the context with `buildContext`, checks the point-in-time property, applies
 * the mode guard, calls `decide()`, runs the risk gate and writes the journal record. None of that
 * is repeated here, and repeating any of it would be the defect -- a second context assembly or a
 * second journal writer is a second thing to keep in agreement, and this project already has a
 * record of what happens when two paths drift (see the panel-root wiring defect).
 *
 * SO WHAT IS LEFT IS EXACTLY ONE PROBLEM: THE BATCH ID HAS TO BE AGREED IN ADVANCE.
 *
 * The folder client names its two files `request-<batchId>.json` and `response-<batchId>.json`,
 * so it needs the id when it is CONSTRUCTED -- before `runOnce` is called. `runOnce` derives its
 * own id when the caller passes none, through a private `defaultBatchId(asOfTime, mode)` that
 * analyst/loop.mjs does not export. If this file let each side pick independently, the exchange
 * file and the journal record would name different batches and nothing would notice.
 *
 * So the id is derived HERE and handed to BOTH. That derivation is the only logic in this file
 * that duplicates anything, it is two lines, and it is PINNED BY TEST against what `runOnce`
 * writes when it is left to choose for itself -- because a copied constant that silently stops
 * matching is exactly the failure this comment exists to prevent. Exporting `defaultBatchId` from
 * loop.mjs would be cleaner and is not available: modifying an existing file is out of scope.
 *
 * THERE IS NO COMMAND-LINE ENTRY POINT HERE, ON PURPOSE. A runnable `paper`/`dry-run` command
 * needs a panel, and the panel loader with its fail-closed guards lives inside analyst-run.mjs as
 * a private `loadPanel()`. Reimplementing those guards to get a CLI would duplicate the one piece
 * of the run path whose correctness matters most. A caller that already has `{ series, dates }` --
 * analyst-run.mjs, a test, a future subcommand -- gets the whole pipeline from the function below.
 *
 * ZERO PAID TOKENS, AND ONE HONEST LIMIT ON SAYING SO. `makeFolderClient` returns
 * `usage: { input_tokens: 0, output_tokens: 0 }`, which `decide()` passes back verbatim as
 * `decision.usage`. The JOURNAL DOES NOT PERSIST USAGE AT ALL -- `recordDecision` does not accept
 * the field -- so "zero paid tokens" is a property of the returned run result and of the exchange
 * (no network call is made, by construction), not something a later reader can verify from the
 * journal file. Adding a usage field to the journal would mean editing journal.mjs, which is out
 * of scope, and inventing one here would be worse.
 *
 * A FOLDER FAILURE IS NOT CAUGHT HERE. `decide()` already collapses anything the client throws
 * into its `CLIENT_ERROR` batch failure with the message in `detail`, and `runOnce` already
 * journals that as a decision record with an empty book. Wrapping the call in a try/catch here
 * would intercept that and lose the record, so it is not wrapped.
 *
 * NO NETWORK, NO NEW ENVIRONMENT VARIABLE, NO NEW DEPENDENCY. The only imports are two modules
 * already in this repository.
 */

import { runOnce } from "./loop.mjs";
import { MODE } from "./journal.mjs";
import { makeFolderClient } from "./folder-client.mjs";

/**
 * The batch id both sides must agree on.
 *
 * MIRRORS `defaultBatchId` IN analyst/loop.mjs, which is private there. Pinned by test against the
 * id `runOnce` writes when given none, so a divergence fails a test rather than silently splitting
 * the exchange from the journal.
 */
export function folderBatchId(asOfTime, mode) {
  return `${mode}-${new Date(asOfTime * 1000).toISOString().slice(0, 10)}`;
}

/**
 * The `asOf` index `runOnce` will use, resolved the same way it resolves it.
 *
 * Also a mirror, for the same reason and with the same test pinning it: the id depends on
 * `dates[idx]`, so picking a different index here would name a different batch than the one
 * actually decided.
 */
export function resolveAsOf(dates, asOf) {
  if (!Array.isArray(dates) || !dates.length) throw new Error("run-folder: dates required");
  const idx = Number.isInteger(asOf) ? asOf : dates.length - 1;
  return { idx, asOfTime: dates[idx] };
}

/**
 * Run one batch through the real pipeline, with an external brain answering in a folder.
 *
 * Everything other than `dir`, `ttlMinutes` and `pollMs` is passed STRAIGHT THROUGH to `runOnce`,
 * untouched, so this function cannot drift from the run path as that gains options.
 *
 * @param {string} dir        the exchange directory. The request appears there; an answer is awaited there.
 * @param {number} ttlMinutes how long to wait for a human or a separate process to answer.
 * @param {number} pollMs     how often to look for the answer.
 * @returns the `runOnce` result, plus `batchId` and the two exchange paths, so a caller can tell
 *          the operator which file to answer.
 */
export async function runOnceViaFolder({
  dir, ttlMinutes = 240, pollMs = 15000,
  dates, asOf, mode = MODE.DRY_RUN, batchId = null, ...rest
} = {}) {
  if (typeof dir !== "string" || !dir) throw new Error("run-folder: dir is required");
  const { asOfTime } = resolveAsOf(dates, asOf);
  const id = batchId ?? folderBatchId(asOfTime, mode);

  const client = makeFolderClient({ dir, batchId: id, ttlMinutes, pollMs });
  const result = await runOnce({ ...rest, dates, asOf, mode, batchId: id, client });

  return {
    ...result,
    batchId: id,
    exchange: { dir: client.dir, requestPath: client.requestPath, responsePath: client.responsePath },
  };
}
