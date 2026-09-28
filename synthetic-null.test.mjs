/**
 * Tests for the synthetic-noise negative control (docs/FORWARD-EVAL-SPEC.md §6).
 *
 * Three things are checked, in the order they matter:
 *
 * 1. ISOLATION, WITH ITS LIMIT STATED. Synthetic noise must not reach real data, real roots, or a
 *    paper score. This is a set of refusals, NOT a guarantee: the paper-mode check keys on a positive
 *    `"synthetic": true` label, so a bundle whose PROVENANCE.json has been deleted passes it. That hole
 *    is asserted below rather than left implied, and analyst/provenance.mjs records why the live paper
 *    path is not changed to fail closed.
 *    Every guard is tested from the outside, and the generator guards are exercised against a DECOY
 *    tree in a tmpdir — never the repo's own bundles — so a regressed guard cannot damage real data
 *    while proving it regressed.
 * 2. CALIBRATED TOLERANCE. The null's centre and the injected-edge recovery are checked against
 *    numbers derived here rather than eyeballed, with the derivation written next to the assertion.
 * 3. DETERMINISM. A reported figure has to be reproducible from the reported command.
 *
 * NOT TESTED HERE, DELIBERATELY: no test spawns `analyst-run.mjs paper`. The paper command's denial
 * is a reviewed decision, and a test that invoked paper mode to observe a refusal would put a paper
 * invocation into CI. The refusal is unit-tested through `isDeclaredSynthetic`, which is the whole of the
 * decision the paper path makes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDeclaredSynthetic } from "./analyst/provenance.mjs";
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

test("a generated panel marks itself synthetic and isDeclaredSynthetic sees it", () => {
  const root = path.join(tmp(), "syn");
  assert.equal(gen(["--out", root, "--seed", "7", "--symbols", "2", "--bars", "5", "--end", "2026-01-01"]).ok, true);
  const prov = JSON.parse(fs.readFileSync(path.join(root, "PROVENANCE.json"), "utf8"));
  assert.equal(prov.synthetic, true);
  assert.equal(prov.seed, 7);
  assert.equal(isDeclaredSynthetic(root), true);
});

test("isDeclaredSynthetic is false without a positive claim, and never throws", () => {
  // Paper mode refuses on a POSITIVE synthetic claim. Absent, malformed and non-synthetic provenance
  // must all read as "not a synthetic panel" — every real bundle predates this file and has no such
  // key, so a throw or a true here would block paper mode on real data.
  const box = tmp();
  assert.equal(isDeclaredSynthetic(path.join(box, "nonexistent")), false);

  const noProv = path.join(box, "no-prov"); fs.mkdirSync(noProv);
  assert.equal(isDeclaredSynthetic(noProv), false);

  const bad = path.join(box, "bad"); fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, "PROVENANCE.json"), "{not json");
  assert.equal(isDeclaredSynthetic(bad), false);

  const real = path.join(box, "real"); fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "PROVENANCE.json"), '{"source":"ibkr","synthetic":false}');
  assert.equal(isDeclaredSynthetic(real), false);

  // A string "true" is not true. The guard keys on the boolean and nothing else.
  const stringy = path.join(box, "stringy"); fs.mkdirSync(stringy);
  fs.writeFileSync(path.join(stringy, "PROVENANCE.json"), '{"synthetic":"true"}');
  assert.equal(isDeclaredSynthetic(stringy), false);
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

test("every synthetic journal record names itself in its batchId, through the CLI", () => {
  // PROVENANCE THAT SURVIVES A COPY. The panel root is what makes these decisions noise, and the root
  // is not recorded in the journal — so a journal moved away from its root, or concatenated onto a real
  // one, would read as ordinary dry-run history. An earlier version of this test grepped the
  // diagnostic's SOURCE for the prefix, which proved nothing about the CLI: the CLI path wrote
  // "dry-run-2026-06-11" with no prefix at all, and the spec's claim was false for it.
  const box = tmp();
  const root = path.join(box, "syn");
  assert.equal(gen(["--out", root, "--seed", "20260928", "--symbols", "40", "--bars", "320",
                    "--end", "2026-06-30"]).ok, true);
  const journal = path.join(box, "journal.jsonl");
  execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "dry-run", "--stub", "--root", root,
                        "--journal", journal, "--asOf", "300", "--slate", "40"],
               { cwd: REPO, stdio: "pipe" });

  const { records } = readJournal(journal);
  assert.ok(records.length > 0, "the CLI wrote no records");
  for (const r of records) {
    assert.match(r.batchId, /^synthetic-/, `record batchId "${r.batchId}" does not declare itself synthetic`);
  }

  // And a root WITHOUT a synthetic claim keeps the default id shape, so real journals are unchanged.
  const real = path.join(box, "realish");
  fs.mkdirSync(path.join(real, "1440"), { recursive: true });
  fs.copyFileSync(path.join(root, "1440", "SYN000.csv"), path.join(real, "1440", "SYN000.csv"));
  const realJournal = path.join(box, "real.jsonl");
  try {
    execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "dry-run", "--stub", "--root", real,
                          "--journal", realJournal, "--asOf", "300", "--slate", "40"],
                 { cwd: REPO, stdio: "pipe" });
  } catch { /* a one-symbol panel may screen out; the assertion below handles both cases */ }
  if (fs.existsSync(realJournal)) {
    for (const r of readJournal(realJournal).records) {
      assert.doesNotMatch(r.batchId, /^synthetic-/, "a non-synthetic root was stamped synthetic");
    }
  }
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
  assert.equal(isDeclaredSynthetic(root), true);

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

test("the CLI actually refuses paper mode on a declared-synthetic root", () => {
  // THE REAL CLI ISOLATION TEST, not a source match. An earlier version only grepped analyst-run.mjs
  // for the guard expression, which would have passed even while the guard threw a ReferenceError on
  // every invocation — which it did.
  //
  // SAFE TO RUN IN CI. ANTHROPIC_API_KEY is cleared for the child, so even a fully regressed guard
  // cannot reach a model: it would exit on the missing key instead. Nothing is written outside tmp.
  const box = tmp();
  const root = path.join(box, "syn");
  assert.equal(gen(["--out", root, "--seed", "11", "--symbols", "3", "--bars", "300",
                    "--end", "2026-06-30"]).ok, true);
  const journal = path.join(box, "paper.jsonl");

  let status = 0, stderr = "";
  try {
    execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "paper", "--root", root, "--journal", journal],
      { cwd: REPO, stdio: "pipe", encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  } catch (e) {
    status = e.status; stderr = String(e.stderr ?? "");
  }
  assert.equal(status, 3, `paper mode did not refuse a synthetic root (exit ${status})\n${stderr}`);
  assert.match(stderr, /refusing paper mode/);
  assert.match(stderr, /SYNTHETIC/);
  assert.equal(fs.existsSync(journal), false, "a refused paper run still wrote a journal");
});

test("KNOWN GAP: stripping the label defeats the paper-mode check", () => {
  // THIS TEST ASSERTS A WEAKNESS, ON PURPOSE. isDeclaredSynthetic is fail-open, so deleting
  // PROVENANCE.json from a synthetic bundle makes it indistinguishable from a real panel to the paper
  // guard. Commit e42077c and docs/FORWARD-EVAL-SPEC.md claimed generated noise "cannot" become a paper
  // record; that was an overclaim and this records the actual behaviour so it cannot be forgotten.
  //
  // It is written as an assertion rather than a comment so that if anyone later makes paper mode fail
  // closed, THIS TEST FAILS and forces the claim, the docs and the assessment to be updated together.
  const box = tmp();
  const root = path.join(box, "syn");
  assert.equal(gen(["--out", root, "--seed", "13", "--symbols", "3", "--bars", "10",
                    "--end", "2026-01-01"]).ok, true);
  assert.equal(isDeclaredSynthetic(root), true, "a fresh synthetic panel is not labelled");

  fs.rmSync(path.join(root, "PROVENANCE.json"));
  assert.equal(isDeclaredSynthetic(root), false,
    "isDeclaredSynthetic now rejects an unlabelled root — paper mode may have been made fail-closed, " +
    "in which case analyst/provenance.mjs's assessment and the spec's claim both need updating");

  // What DOES still hold when the label is gone: the mode separation in the journal. A synthetic run is
  // a dry run, and scoreJournal will not blend a dry run into a paper score whatever the panel was.
  // That is the layer that does not depend on a file anyone can delete.
  const journal = path.join(box, "j.jsonl");
  fs.writeFileSync(journal, [
    JSON.stringify({ kind: KIND.DECISION, mode: MODE.DRY_RUN, batchId: "synthetic-x", at: "2026-01-05T00:00:00Z",
                     allowed: [{ symbol: "SYN000", action: "buy", targetPct: 0.05 }], rejected: [] }),
    JSON.stringify({ kind: KIND.OUTCOME, batchId: "synthetic-x", symbol: "SYN000", netReturn: 9, controlReturn: -9 }),
  ].join("\n") + "\n");
  const paperScore = scoreJournal(journal, { mode: MODE.PAPER });
  assert.equal(paperScore.outcomes, 0, "a dry-run outcome reached a paper score");
  assert.equal(paperScore.edge, null);
  assert.equal(paperScore.contaminatedRecords, 1, "the excluded record was not counted");
});

// ---- 4. the chain itself, on the seeded null distribution ---------------------------------------
//
// These are the checks the task asked for: a seeded distribution with a calibrated tolerance, an
// independent recalculation, and a seeded injection. They previously existed ONLY inside
// synthetic-null.mjs, which nothing ran — so a scoreJournal regression would have left the suite
// green. The diagnostic's pieces are exported and exercised here at a cost that fits a test suite.

test("the seeded null centre is indistinguishable from zero, and recompute agrees on every panel",
  async () => {
  const { runPanel, recompute } = await import("./synthetic-null.mjs");
  const box = tmp();

  // CONFIG AND TOLERANCE, BOTH FIXED BEFORE RUNNING. N=8 panels at 20 batches each.
  //
  // The sd is the one measured for the 20-BATCH configuration specifically, NOT the pooled sd (0.848%).
  // A 10-batch panel scatters far more (1.063%) than a 45-batch one (0.611%), and borrowing the pooled
  // figure for a single config is exactly how an earlier version of this file got a tolerance wrong and
  // failed on a perfectly ordinary panel.
  //
  // Two independent 120-panel runs measured the 20-batch sd at 0.741% (seed 20260928) and 0.864%
  // (seed 771131). The LARGER is used: a tolerance picked from the smaller of two measurements is a
  // tolerance tuned to the run that flattered it. So SE over 8 panels is 0.864%/sqrt(8) = 0.306%, and
  // the bound is 3 SE = 0.917%. A true centre of zero breaches that about 0.3% of the time — and since
  // the seeds here are fixed, this test is deterministic rather than flaky either way.
  const N = 8, BATCHES = 20, SD_20_BATCH = 0.00864;
  const bound = 3 * SD_20_BATCH / Math.sqrt(N);

  const edges = [];
  for (let i = 0; i < N; i++) {
    const seed = 20260928 + i * 7919;
    const { score, journal } = await runPanel(seed, box, BATCHES);
    assert.ok(score.decisions > 0, `panel ${seed} sized nothing — empty slate, not a null result`);

    // INDEPENDENT RECOMPUTE: the same three quantities off the raw journal lines by a separate code
    // path. Agreement to 1e-12 means scoreJournal's filtering, mode handling and period bucketing all
    // land where a straightforward reading of the file lands.
    const ind = recompute(journal);
    assert.ok(Math.abs(score.edge - ind.edge) < 1e-12,
      `panel ${seed}: score edge ${score.edge} vs independent ${ind.edge}`);
    assert.equal(score.periods, ind.periods, `panel ${seed}: period count disagrees`);
    assert.equal(score.outcomes, ind.outcomes, `panel ${seed}: outcome count disagrees`);

    assert.equal(score.isEvidence, false, "a synthetic dry run must never count as evidence");
    edges.push(score.edge);
  }

  const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
  assert.ok(Math.abs(mean) < bound,
    `mean edge over ${N} noise panels is ${(mean * 100).toFixed(3)}%, beyond 3 SE (${(bound * 100).toFixed(3)}%). ` +
    `Individual edges: ${edges.map((e) => (e * 100).toFixed(2) + "%").join(", ")}`);

  // A SINGLE PANEL IS EXPECTED TO BE NONZERO. This asserts the thing the task was explicit about: a
  // lone nonzero edge is not a plumbing failure. If every panel came back at exactly zero, the chain
  // would be reporting nothing at all, which the injection test below is the counterpart to.
  assert.ok(edges.some((e) => Math.abs(e) > 1e-9),
    "every panel returned exactly zero edge — the chain is reporting nothing rather than measuring");
});

test("a seeded injection of a known edge is recovered to the closed form exactly", async () => {
  const { injectKnownEdge } = await import("./synthetic-null.mjs");
  const box = tmp();
  const r = await injectKnownEdge(20260928 + 999983, box);

  // The two arms are equal in size and the injected arm's own edge is exactly the injected lift, so
  // the pooled edge must be (before + inject) / 2. Derived outside the scorer, asserted at 1e-12 —
  // floating point, not tolerance for being approximately right.
  assert.ok(r.error < 1e-12,
    `injected edge recovered as ${r.after.edge} against closed form ${r.predicted} (error ${r.error})`);
  assert.equal(r.added, r.before.outcomes, "the injected arm is not equal in size to the original");
  assert.ok(r.ok);

  // The direction and magnitude both have to move. A scorer that ignored the new arm would leave the
  // edge unchanged, and that is the failure this test exists to catch.
  assert.ok(Math.abs(r.after.edge - r.before.edge) > 0.001,
    "injecting a 2% edge did not move the reported edge — the scorer may be ignoring new outcomes");
});
