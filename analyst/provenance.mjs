/**
 * Does a panel root CARRY A POSITIVE SYNTHETIC LABEL?
 *
 * `scripts/make-synthetic-panel.mjs` writes a driftless random walk for testing the scorer against
 * known ground truth, and stamps `PROVENANCE.json` with `"synthetic": true`. A synthetic panel can be
 * current-dated, so a freshness check alone would pass it — and a paper journal built on one would be
 * indistinguishable from a real track record afterwards.
 *
 * READ THE NAME LITERALLY. This DETECTS A LABEL. It does not authenticate a panel, and it is
 * deliberately FAIL-OPEN: absent, unreadable or malformed provenance returns false.
 *
 * SO THE HOLE IS REAL AND IS NOT CLOSED HERE: delete `PROVENANCE.json` from a synthetic bundle and
 * paper mode will accept it. Nothing in this repo prevents that. The correct claim is "paper mode
 * refuses a panel that DECLARES itself synthetic", never "generated noise cannot become a paper
 * record". An earlier version of this file, of docs/FORWARD-EVAL-SPEC.md and of commit e42077c made
 * the stronger claim; it was wrong.
 *
 * WHY IT IS NOT FAIL-CLOSED, assessed rather than assumed:
 *
 *   - Fail-closed means paper refuses any root that cannot positively prove it is real. Measured
 *     2026-09-28: NO bundle in this repo carries a `PROVENANCE.json` — not sp500-bundle,
 *     candle-bundle, candle-bundle-long or equity-bundle. `scripts/ibkr-panel.mjs` does write one
 *     (with a `source` field and no `synthetic` key), so a freshly built `ibkr-bundle` would satisfy
 *     such a rule.
 *   - But `ibkr-bundle` is absent from this container, which is precisely the blocker this work runs
 *     around, so the panel the live paper path would actually load CANNOT be inspected from here. An
 *     `ibkr-bundle` already collected, or one whose provenance did not survive being committed, would
 *     be refused — converting a data problem into a hard block on the only evidence channel there is.
 *   - And an unsigned JSON file is not authentication in either direction. Whatever can delete
 *     `PROVENANCE.json` can equally write one saying `"source": "IBKR..."`. Fail-closed on an unsigned
 *     file raises the bar from "delete a file" to "write a file". Real authentication needs a
 *     signature or a checksum manifest produced by the collector and verified against a key.
 *
 * Changing the live paper path is therefore NOT done here. The gap is reported instead.
 *
 * This lives in its own module so the refusal can be unit-tested directly. Exercising it by spawning
 * `analyst-run.mjs paper` would put a paper invocation into the test suite, and the paper command's
 * denial is a reviewed decision that a test must not route around.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * True only when the root positively declares itself synthetic.
 *
 * The asymmetry is deliberate, and it is a trade, not a guarantee. Returning true on missing
 * provenance would refuse paper mode on every real bundle in this repo, since none carries the file.
 * So this catches an HONEST synthetic panel — the case that actually threatens the record, a
 * diagnostic run whose journal is later mistaken for evidence — and does not catch a stripped label.
 */
export function isDeclaredSynthetic(root) {
  const f = path.join(root, "PROVENANCE.json");
  if (!fs.existsSync(f)) return false;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"))?.synthetic === true;
  } catch {
    return false;
  }
}
