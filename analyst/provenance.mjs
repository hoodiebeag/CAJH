/**
 * Does a panel root hold generated noise rather than measured prices?
 *
 * `scripts/make-synthetic-panel.mjs` writes a driftless random walk for testing the scorer against
 * known ground truth, and stamps `PROVENANCE.json` with `"synthetic": true`. A synthetic panel can be
 * current-dated, so a freshness check alone would pass it — and a paper journal built on one would be
 * indistinguishable from a real track record afterwards.
 *
 * This lives in its own module so the refusal can be unit-tested directly. Exercising it by spawning
 * `analyst-run.mjs paper` would put a paper invocation into the test suite, and the paper command's
 * denial is a reviewed decision that a test must not route around.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * True only when the root positively claims to be synthetic.
 *
 * Absent, unreadable or malformed provenance returns false: a missing claim is not a claim, and every
 * real bundle predates this file. The asymmetry is deliberate — this function gates one refusal, and
 * the generator plus the `--out` guard are the other two layers.
 */
export function isSyntheticRoot(root) {
  const f = path.join(root, "PROVENANCE.json");
  if (!fs.existsSync(f)) return false;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"))?.synthetic === true;
  } catch {
    return false;
  }
}
