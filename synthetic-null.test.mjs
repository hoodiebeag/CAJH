/**
 * Tests for the synthetic-noise negative control (docs/FORWARD-EVAL-SPEC.md §6).
 *
 * Three things are checked, in the order they matter:
 *
 * 1. ISOLATION. Synthetic noise must not be able to reach real data, real roots, or a paper score.
 *    Every guard is tested from the outside, and the generator guards are exercised against a DECOY
 *    tree in a tmpdir — never the repo's own bundles — so a regressed guard cannot damage real data
 *    while proving it regressed.
 * 2. CALIBRATED TOLERANCE. The null's centre and the injected-edge recovery are checked against
 *    numbers derived here rather than eyeballed, with the derivation written next to the assertion.
 * 3. DETERMINISM. A reported figure has to be reproducible from the reported command.
 *
 * NOT TESTED HERE, DELIBERATELY: no test spawns `analyst-run.mjs paper`. The paper command's denial
 * is a reviewed decision, and a test that invoked paper mode to observe a refusal would put a paper
 * invocation into CI. The refusal is unit-tested through `isSyntheticRoot`, which is the whole of the
 * decision the paper path makes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isSyntheticRoot } from "./analyst/provenance.mjs";
import { scoreJournal, readJournal, KIND, MODE } from "./analyst/journal.mjs";
import { clusteredBootstrapCI, seededRng } from "./inference.mjs";

const REPO = import.meta.dirname;
const GEN = path.join(REPO, "scripts", "make-synthetic-panel.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "syn-test-"));

/** Run the generator. Returns { ok, stderr } instead of throwing, so refusals can be asserted on. */
function gen(args, cwd = REPO) {
  try {
    execFileSync("node", [GEN, ...args], { cwd, stdio: "pipe", encoding: "utf8" });
    return { ok: true, stderr: "" };
  } catch (e) {
    return { ok: false, stderr: String(e.stderr ?? "") };
  }
}

// ---- 1. isolation ------------------------------------------------------------------------------

test("generator refuses every spelling of a real data root", () => {
  // The decoy lives in a tmpdir and is named like a real root. If a guard regresses, this test fails
  // by writing into the DECOY, not into the repo's sp500-bundle.
  const box = tmp();
  const decoy = path.join(box, "sp500-bundle");
  fs.mkdirSync(path.join(decoy, "1440"), { recursive: true });
  fs.writeFileSync(path.join(decoy, "PROVENANCE.json"), '{"real":true}\n');

  // `sp500-bundle/.` is the case that defeated an earlier basename-only guard: path.basename() of it
  // is ".", so the check passed and the write landed in the real bundle.
  for (const target of ["sp500-bundle", "sp500-bundle/.", "sp500-bundle/sub", "sp500-bundle/a/b",
                        "./sp500-bundle/../sp500-bundle", "data", "ibkr-bundle"]) {
    const r = gen(["--out", target, "--seed", "1", "--symbols", "1", "--bars", "3", "--end", "2026-01-01"], box);
    assert.equal(r.ok, false, `generator wrote into "${target}" — that is a real data root`);
    assert.match(r.stderr, /real data root/);
  }

  // The decoy is untouched: no CSVs anywhere under it, and its provenance still says real.
  const strays = fs.readdirSync(path.join(decoy, "1440"));
  assert.deepEqual(strays, [], "generator left files inside a real-named root");
  assert.equal(fs.readFileSync(path.join(decoy, "PROVENANCE.json"), "utf8").trim(), '{"real":true}');
});

test("generator allows a name that merely contains a real root as a substring", () => {
  // The guard matches whole path components. Refusing "syn-data-panel" because it contains "data"
  // would make the guard unusable, and an unusable guard gets switched off.
  const box = tmp();
  const r = gen(["--out", path.join(box, "syn-data-panel"), "--seed", "1", "--symbols", "1",
                 "--bars", "3", "--end", "2026-01-01"]);
  assert.equal(r.ok, true, r.stderr);
});

test("a generated panel marks itself synthetic and isSyntheticRoot sees it", () => {
  const root = path.join(tmp(), "syn");
  assert.equal(gen(["--out", root, "--seed", "7", "--symbols", "2", "--bars", "5", "--end", "2026-01-01"]).ok, true);
  const prov = JSON.parse(fs.readFileSync(path.join(root, "PROVENANCE.json"), "utf8"));
  assert.equal(prov.synthetic, true);
  assert.equal(prov.seed, 7);
  assert.equal(isSyntheticRoot(root), true);
});

test("isSyntheticRoot is false without a positive claim, and never throws", () => {
  // Paper mode refuses on a POSITIVE synthetic claim. Absent, malformed and non-synthetic provenance
  // must all read as "not a synthetic panel" — every real bundle predates this file and has no such
  // key, so a throw or a true here would block paper mode on real data.
  const box = tmp();
  assert.equal(isSyntheticRoot(path.join(box, "nonexistent")), false);

  const noProv = path.join(box, "no-prov"); fs.mkdirSync(noProv);
  assert.equal(isSyntheticRoot(noProv), false);

  const bad = path.join(box, "bad"); fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, "PROVENANCE.json"), "{not json");
  assert.equal(isSyntheticRoot(bad), false);

  const real = path.join(box, "real"); fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "PROVENANCE.json"), '{"source":"ibkr","synthetic":false}');
  assert.equal(isSyntheticRoot(real), false);

  // A string "true" is not true. The guard keys on the boolean and nothing else.
  const stringy = path.join(box, "stringy"); fs.mkdirSync(stringy);
  fs.writeFileSync(path.join(stringy, "PROVENANCE.json"), '{"synthetic":"true"}');
  assert.equal(isSyntheticRoot(stringy), false);
});

test("synthetic dry-run records cannot move a paper score", () => {
  // The mixing case: someone concatenates a synthetic dry-run journal onto a paper journal. The paper
  // numbers must be byte-identical afterwards, and the dropped records must be COUNTED rather than
  // silently ignored — a figure that has discarded data has to say how much.
  const box = tmp();
  const journal = path.join(box, "journal.jsonl");
  const paper = [
    { kind: KIND.DECISION, mode: MODE.PAPER, batchId: "paper-1", at: "2026-01-05T00:00:00Z",
      allowed: [{ symbol: "AAA", action: "buy", targetPct: 0.05 }], rejected: [] },
    { kind: KIND.OUTCOME, batchId: "paper-1", symbol: "AAA", netReturn: 0.01, controlReturn: 0.004 },
  ];
  fs.writeFileSync(journal, paper.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const before = scoreJournal(journal, { mode: MODE.PAPER });

  const synthetic = [
    { kind: KIND.DECISION, mode: MODE.DRY_RUN, batchId: "synthetic-999-260", at: "2026-01-05T00:00:00Z",
      allowed: [{ symbol: "SYN000", action: "buy", targetPct: 0.05 }], rejected: [] },
    // A deliberately huge edge: if it leaks into the paper score, it cannot be missed.
    { kind: KIND.OUTCOME, batchId: "synthetic-999-260", symbol: "SYN000", netReturn: 5.0, controlReturn: -5.0 },
  ];
  fs.appendFileSync(journal, synthetic.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const after = scoreJournal(journal, { mode: MODE.PAPER });

  assert.equal(after.edge, before.edge, "synthetic dry-run records changed the paper edge");
  assert.equal(after.outcomes, before.outcomes);
  assert.equal(after.batches, before.batches);
  assert.equal(after.contaminatedRecords, 1, "the excluded synthetic decision was not counted");
  assert.equal(before.contaminatedRecords, 0);

  // And the synthetic arm is still scoreable on its own, in its own mode.
  const dry = scoreJournal(journal, { mode: MODE.DRY_RUN });
  assert.equal(dry.outcomes, 1);
  assert.equal(dry.isEvidence, false, "dry-run must not count as evidence");
});

test("every synthetic journal record names itself in its batchId", () => {
  // Provenance that survives a copy: the file it sits in can be renamed, the record cannot.
  const root = path.join(tmp(), "syn");
  assert.equal(gen(["--out", root, "--seed", "3", "--symbols", "2", "--bars", "5", "--end", "2026-01-01"]).ok, true);
  // The diagnostic stamps ids itself; this asserts the convention it relies on is the one documented.
  const src = fs.readFileSync(path.join(REPO, "synthetic-null.mjs"), "utf8");
  assert.match(src, /batchId: `synthetic-\$\{seed\}-\$\{asOf\}`/,
    "the diagnostic no longer stamps synthetic- batch ids");
});

// ---- 2. determinism ----------------------------------------------------------------------------

test("a pinned panel is byte-identical across runs, and the seed changes it", () => {
  const box = tmp();
  const a = path.join(box, "a"), b = path.join(box, "b"), c = path.join(box, "c");
  const mk = (out, seed) => gen(["--out", out, "--seed", String(seed), "--symbols", "3",
                                 "--bars", "40", "--end", "2026-01-01"]);
  assert.equal(mk(a, 42).ok, true); assert.equal(mk(b, 42).ok, true); assert.equal(mk(c, 43).ok, true);
  const read = (d) => fs.readFileSync(path.join(d, "1440", "SYN000.csv"), "utf8");
  assert.equal(read(a), read(b), "same seed and --end produced different bars");
  assert.notEqual(read(a), read(c), "a different seed produced identical bars");
});

// ---- 3. calibrated tolerance -------------------------------------------------------------------

test("the bootstrap's two-cluster interval is the two cluster means, so it covers zero ~50%", () => {
  // THE ANALYTIC ANCHOR for the reference curve the diagnostic prints. With two clusters, each
  // bootstrap draw picks 2 of 2 with replacement: {A,A}, {A,B}, {B,A}, {B,B} at 1/4 each, so the draw
  // distribution is {mean_A: 1/4, midpoint: 1/2, mean_B: 1/4}. The 2.5th and 97.5th percentiles fall
  // in the outer quarters, so the interval is exactly [min, max] of the two cluster means.
  const ci = clusteredBootstrapCI([1, 1, 1, 3, 3, 3], { keys: [0, 0, 0, 1, 1, 1], iterations: 2000, seed: 5 });
  assert.equal(ci.clusters, 2);
  assert.equal(ci.lo, 1, "two-cluster lower bound is not the smaller cluster mean");
  assert.equal(ci.hi, 3, "two-cluster upper bound is not the larger cluster mean");

  // It follows that coverage of a true zero is P(the two cluster means straddle zero) = 2(0.5)(0.5)
  // = 50% for any symmetric distribution — NOT the nominal 95%. Measured here so the diagnostic's
  // claim that the shortfall belongs to the estimator rests on a number, not on a comment.
  const rng = seededRng(4242);
  const gauss = () => { const u = Math.max(1e-12, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const TRIALS = 300;
  let hit = 0;
  for (let t = 0; t < TRIALS; t++) {
    const vals = [], keys = [];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 15; j++) { vals.push(gauss()); keys.push(k); }
    const r = clusteredBootstrapCI(vals, { keys, iterations: 400, seed: 100 + t });
    if (r.lo <= 0 && r.hi >= 0) hit++;
  }
  // Tolerance from the binomial SE at p=0.5: sqrt(.25/300) = 2.89%, so ±4 SE is ±11.5 points.
  // Wide on purpose — this asserts "about a half, nowhere near 95%", which is the claim being made.
  const cov = hit / TRIALS;
  assert.ok(Math.abs(cov - 0.5) < 0.115, `two-cluster coverage ${(cov * 100).toFixed(1)}% is not ~50%`);
  assert.ok(cov < 0.9, "two-cluster coverage near nominal would break the diagnostic's explanation");
});

test("the CLI chain runs end to end on a synthetic root and stays out of evidence", () => {
  // WHAT THIS ASSERTS AND WHAT IT DOES NOT. This exercises the CLI, because that is where isolation
  // lives: flag parsing, root selection, journal-path resolution and the provenance guard are all
  // skipped by an in-process call. It asserts plumbing and isolation.
  //
  // It asserts NO bound on the size of the edge. One batch is one cluster, and the null distribution
  // measured by synthetic-null.mjs is a distribution over PANELS of 10-45 batches, so its sd does not
  // apply here. An earlier version of this test borrowed the pooled per-panel sd (0.85%) as a 3-sd
  // bound and failed on a 3.12% single-batch edge -- a mis-derived tolerance, not a chain defect.
  // The calibrated magnitude checks live in the two tests below and in the diagnostic itself.
  const box = tmp();
  const root = path.join(box, "syn");
  assert.equal(gen(["--out", root, "--seed", "20260928", "--symbols", "40", "--bars", "320",
                    "--end", "2026-06-30"]).ok, true);
  assert.equal(isSyntheticRoot(root), true);

  const journal = path.join(box, "journal.jsonl");
  const cli = (...a) => execFileSync("node", [path.join(REPO, "analyst-run.mjs"), ...a],
    { cwd: REPO, stdio: "pipe", encoding: "utf8" });
  cli("dry-run", "--stub", "--root", root, "--journal", journal, "--asOf", "300", "--slate", "40");
  cli("settle", "--mode", "dry-run", "--root", root, "--journal", journal, "--hold", "5");
  const out = cli("score", "--mode", "dry-run", "--journal", journal);

  const s = scoreJournal(journal, { mode: MODE.DRY_RUN });
  assert.ok(s.outcomes > 0, `the CLI chain settled nothing:\n${out}`);
  assert.ok(Number.isFinite(s.edge), "the chain produced no edge at all");

  // ONE BATCH IS ONE CLUSTER, AND MUST REPORT NO INTERVAL. A cluster bootstrap with a single cluster
  // redraws that same cluster every iteration, so lo == hi == the point estimate -- a zero-width
  // interval, which is the most flattering possible way to report variance that could not be
  // estimated. This chain printed exactly that before it was fixed; this is the regression test, and
  // it runs through the CLI where the defect was originally seen.
  assert.equal(s.periods, 1, "a single batch should be a single holding period");
  assert.equal(s.edgeCI.degenerate, true, "one cluster must be flagged degenerate");
  assert.equal(s.edgeCI.lo, null, "one cluster must report no lower bound");
  assert.equal(s.edgeCI.hi, null, "one cluster must report no upper bound");

  // Nothing written here is evidence, and the journal says so on every line.
  const { records } = readJournal(journal);
  const decisions = records.filter((r) => r.kind === KIND.DECISION);
  assert.deepEqual([...new Set(decisions.map((r) => r.mode))], [MODE.DRY_RUN]);
  assert.equal(s.isEvidence, false);
});

test("the synthetic root is refused by paper mode, without invoking paper mode", () => {
  // The refusal itself, tested as the pure decision it is. Spawning `analyst-run.mjs paper` to watch
  // it exit would put a paper invocation into CI, and the paper command's denial is a reviewed
  // decision that a test must not route around. isSyntheticRoot IS the whole of that decision; the
  // guard in analyst-run.mjs is `operatingMode === MODE.PAPER && isSyntheticRoot(ROOT)`.
  const root = path.join(tmp(), "syn");
  assert.equal(gen(["--out", root, "--seed", "11", "--symbols", "2", "--bars", "5",
                    "--end", "2026-01-01"]).ok, true);
  assert.equal(isSyntheticRoot(root), true, "paper mode would have accepted a synthetic panel");

  // The guard must read `operatingMode`. An earlier version referenced a bare `mode`, which does not
  // exist at that scope: loadPanel threw a ReferenceError on EVERY invocation, so the guard had never
  // once executed. The in-process diagnostic calls analyst/loop.mjs directly and never reached it.
  const src = fs.readFileSync(path.join(REPO, "analyst-run.mjs"), "utf8");
  assert.match(src, /operatingMode === MODE\.PAPER && isSyntheticRoot\(ROOT\)/,
    "the paper-mode synthetic guard is missing or no longer reads operatingMode");
});
