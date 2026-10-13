/**
 * What happens when `refresh.sh`'s push is REJECTED, and why the obvious recovery silently fails.
 *
 * WHY THIS EXISTS. A real data refresh was in flight on the owner's machine while source commits
 * landed on the same branch, so the final push was going to be rejected as non-fast-forward. The
 * recovery advice given at the time was "rebase, then `bash scripts/refresh.sh commit`". That advice
 * was WRONG, and these tests are the proof rather than an assertion:
 *
 *     if git diff --cached --quiet; then
 *       echo "nothing changed — already up to date, nothing to push."
 *       exit 0
 *     fi
 *
 * After a rebase the data commit already exists in HEAD, so re-staging the same paths produces no
 * staged DIFF. The stage prints success and exits 0 WITHOUT PUSHING — which is precisely the "work
 * done, never pushed" failure refresh.sh was written to prevent, reached by following the recovery
 * instruction. The correct recovery is to inspect the state and then run a plain `git push`.
 *
 * ISOLATED BY CONSTRUCTION. Every test builds a throwaway repo with a local bare "origin" under the
 * OS temp directory. Nothing here touches this repository's git state, and nothing touches the owner's
 * machine. `refresh.sh` itself is NOT modified by this unit; these tests characterise it as it stands
 * and the operational fix is reported separately.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REFRESH = path.join(path.dirname(fileURLToPath(import.meta.url)), "scripts", "refresh.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
function gitTry(cwd, ...args) {
  try { return { status: 0, out: git(cwd, ...args) }; }
  catch (e) { return { status: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
}

/** A repo with a bare origin, one base commit, and a second clone standing in for "someone else". */
function makeSandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "refresh-recovery-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  const other = path.join(root, "other");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repo]);
  for (const r of [repo]) {
    git(r, "config", "user.email", "test@example.invalid");
    git(r, "config", "user.name", "refresh test");
  }
  git(repo, "remote", "add", "origin", remote);
  mkdirSync(path.join(repo, "data"));
  writeFileSync(path.join(repo, "data", "sector-map.json"), "{}\n");
  git(repo, "add", "data/sector-map.json");
  git(repo, "commit", "--quiet", "-m", "base");
  git(repo, "push", "--quiet", "-u", "origin", "main");

  execFileSync("git", ["clone", "--quiet", remote, other]);
  git(other, "config", "user.email", "other@example.invalid");
  git(other, "config", "user.name", "other agent");

  return { root, remote, repo, other, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runRefresh(repo, stage) {
  try {
    const stdout = execFileSync("bash", [REFRESH, stage], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

/** Someone else pushes a source commit, so the local branch is now behind. */
function advanceRemote({ other }) {
  writeFileSync(path.join(other, "SOURCE.md"), "a source change\n");
  git(other, "add", "SOURCE.md");
  git(other, "commit", "--quiet", "-m", "source commit from elsewhere");
  git(other, "push", "--quiet", "origin", "main");
}

/** Fresh collected data on disk, not yet committed. */
function addCollectedData(repo, name = "ibkr-collection-report.json") {
  writeFileSync(path.join(repo, "data", name), JSON.stringify({ collectedAt: "2026-10-05" }) + "\n");
}

const remoteHas = (remote, file) => {
  try { git(remote, "show", `main:${file}`); return true; } catch { return false; }
};

// ---- the collision ------------------------------------------------------------------------------

test("a push rejected as non-fast-forward leaves the data committed locally, not lost", () => {
  const s = makeSandbox();
  try {
    addCollectedData(s.repo);
    advanceRemote(s);

    const r = runRefresh(s.repo, "commit");
    // The retry loop tries four times and then reports honestly rather than claiming success.
    assert.notEqual(r.status, 0, `expected a non-zero exit on a rejected push, got ${r.status}`);
    assert.match(r.stdout + r.stderr, /PUSH FAILED after 4 attempts/);
    assert.match(r.stdout + r.stderr, /committed locally and is not lost/);

    // The commit exists locally; the remote does not have the data.
    assert.match(git(s.repo, "log", "--oneline", "-1"), /data refresh/);
    assert.equal(remoteHas(s.remote, "data/ibkr-collection-report.json"), false);
  } finally { s.cleanup(); }
});

// ---- the recovery that silently does nothing ----------------------------------------------------

test("THE BAD RECOVERY: after a rebase, `refresh.sh commit` exits 0 without pushing", () => {
  // THIS IS THE DEFECT IN MY OWN ADVICE, demonstrated. The data is committed, the rebase succeeds,
  // and then the commit stage finds no staged diff because the content is already in HEAD. It prints
  // "already up to date" and exits 0 — so an operator following the instruction believes the data was
  // pushed when the remote never received it.
  const s = makeSandbox();
  try {
    addCollectedData(s.repo);
    advanceRemote(s);
    runRefresh(s.repo, "commit");                     // push rejected; data now committed locally

    // The "safe reconcile" step.
    const rebase = gitTry(s.repo, "pull", "--rebase", "origin", "main");
    assert.equal(rebase.status, 0, `rebase should succeed on disjoint paths:\n${rebase.out}`);
    assert.equal(remoteHas(s.remote, "data/ibkr-collection-report.json"), false, "not pushed yet");

    // The instruction that looks right and is not.
    const again = runRefresh(s.repo, "commit");
    assert.equal(again.status, 0, "the stage exits 0, which is what makes this dangerous");
    assert.match(again.stdout, /nothing changed — already up to date, nothing to push\./);
    assert.doesNotMatch(again.stdout, /pushed\./);

    // And the remote STILL does not have it.
    assert.equal(remoteHas(s.remote, "data/ibkr-collection-report.json"), false,
      "refresh.sh commit pushed after a rebase — if this fails the stage was fixed and the docs need updating");
  } finally { s.cleanup(); }
});

test("THE CORRECT RECOVERY: inspect, reconcile, then a plain `git push`", () => {
  // No force, no reset, no deletion. The commit already exists; all that is missing is the push.
  const s = makeSandbox();
  try {
    addCollectedData(s.repo);
    advanceRemote(s);
    runRefresh(s.repo, "commit");                     // rejected, data committed locally

    // 1. INSPECT. A clean tree with a local commit ahead is the state that needs only a push.
    assert.equal(git(s.repo, "status", "--porcelain").trim(), "", "tree should be clean after the commit");
    assert.match(git(s.repo, "rev-parse", "--abbrev-ref", "HEAD").trim(), /^main$/);

    // 2. RECONCILE, without discarding anything.
    assert.equal(gitTry(s.repo, "pull", "--rebase", "origin", "main").status, 0);

    // 3. PUSH, explicitly and normally.
    assert.equal(gitTry(s.repo, "push", "origin", "main").status, 0);

    // Both changes survive: the data AND the source commit from elsewhere.
    assert.equal(remoteHas(s.remote, "data/ibkr-collection-report.json"), true);
    assert.equal(remoteHas(s.remote, "SOURCE.md"), true);
  } finally { s.cleanup(); }
});

test("a rebase that conflicts stops rather than resolving, and the data is still committed", () => {
  // The case where reconciling is NOT safe to automate: both sides touched the same file. The rebase
  // must fail and leave the operator to decide, with the local commit intact.
  const s = makeSandbox();
  try {
    // Both sides change the same tracked file.
    writeFileSync(path.join(s.repo, "data", "sector-map.json"), '{"local":1}\n');
    writeFileSync(path.join(s.other, "data", "sector-map.json"), '{"remote":1}\n');
    git(s.other, "add", "data/sector-map.json");
    git(s.other, "commit", "--quiet", "-m", "remote edits the same file");
    git(s.other, "push", "--quiet", "origin", "main");

    runRefresh(s.repo, "commit");                     // commits the local edit, push rejected
    assert.match(git(s.repo, "log", "--oneline", "-1"), /data refresh/);

    const rebase = gitTry(s.repo, "pull", "--rebase", "origin", "main");
    assert.notEqual(rebase.status, 0, "a genuine content conflict must not rebase cleanly");
    // The local commit is still reachable; nothing was discarded by the failed rebase.
    const reflog = git(s.repo, "reflog", "--format=%s", "-n", "20");
    assert.match(reflog, /data refresh/);
    // Leave the fixture in a sane state regardless of how the rebase stopped.
    gitTry(s.repo, "rebase", "--abort");
  } finally { s.cleanup(); }
});

test("the commit stage stages nothing when no collected path exists, and says so", () => {
  // The original defect this script was written against, still correctly handled: an absent
  // ibkr-bundle/ must not abort the whole `git add`, and an empty staging area must not report a push.
  const s = makeSandbox();
  try {
    const r = runRefresh(s.repo, "commit");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /nothing changed — already up to date, nothing to push\./);
    assert.doesNotMatch(r.stdout, /pushed\./);
  } finally { s.cleanup(); }
});
