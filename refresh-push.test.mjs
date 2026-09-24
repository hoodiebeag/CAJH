/**
 * scripts/refresh.sh — does the data actually reach the remote?
 *
 * WHY A SHELL SCRIPT HAS A TEST FILE. refresh.sh is the one artifact the whole project is blocked
 * on: it runs on the owner's machine, collects from IB Gateway, and pushes. It had no coverage of
 * any kind, and it shipped with a staging bug that made `refresh.sh collect` report success while
 * pushing nothing -- the precise failure the script's own header says it exists to prevent.
 *
 * These tests drive the real file (not a copy) against a throwaway repo with a local bare remote,
 * and assert on the REMOTE's contents rather than on stdout. Stdout said "up to date" while the
 * bug was live; the remote is the only witness that cannot lie about whether the push happened.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REFRESH = path.join(path.dirname(fileURLToPath(import.meta.url)), "scripts", "refresh.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A repo with one commit already on a bare "origin", plus a data/ directory. */
function makeSandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "refresh-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repo]);
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "refresh test");
  git(repo, "remote", "add", "origin", remote);
  mkdirSync(path.join(repo, "data"));
  writeFileSync(path.join(repo, "data", "sector-map.json"), "{}\n");
  git(repo, "add", "data/sector-map.json");
  git(repo, "commit", "--quiet", "-m", "base");
  git(repo, "push", "--quiet", "-u", "origin", "main");
  return { root, remote, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Run `refresh.sh <stage>` in the sandbox. Never throws; the exit code is part of the result. */
function runRefresh(repo, stage) {
  try {
    const stdout = execFileSync("bash", [REFRESH, stage], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

/** What the remote actually holds at the tip of main. */
const remoteFile = (remote, file) => git(remote, "show", `main:${file}`);
const remoteHas = (remote, file) => {
  try { remoteFile(remote, file); return true; } catch { return false; }
};

test("collect-shaped state (data/ changed, no ibkr-bundle/) reaches the remote", () => {
  const sb = makeSandbox();
  try {
    // Exactly what `refresh.sh collect` leaves behind: data/ written, ibkr-bundle/ not yet created.
    writeFileSync(path.join(sb.repo, "data", "sector-map.json"), '{"AAPL":"Technology"}\n');

    const r = runRefresh(sb.repo, "commit");

    assert.equal(r.status, 0, `refresh.sh exited ${r.status}\n${r.stderr}`);
    // The regression itself: the run used to take this branch and exit 0 having pushed nothing.
    assert.ok(
      !r.stdout.includes("nothing changed"),
      `refresh.sh claimed there was nothing to push, but data/ had changed:\n${r.stdout}`,
    );
    assert.equal(remoteFile(sb.remote, "data/sector-map.json"), '{"AAPL":"Technology"}\n');
  } finally { sb.cleanup(); }
});

test("a new ibkr-bundle/ is staged alongside data/", () => {
  const sb = makeSandbox();
  try {
    mkdirSync(path.join(sb.repo, "ibkr-bundle", "1440"), { recursive: true });
    writeFileSync(path.join(sb.repo, "ibkr-bundle", "1440", "AAPL.json"), "[]\n");
    writeFileSync(path.join(sb.repo, "data", "sector-map.json"), '{"AAPL":"Technology"}\n');

    const r = runRefresh(sb.repo, "commit");

    assert.equal(r.status, 0, `refresh.sh exited ${r.status}\n${r.stderr}`);
    assert.equal(remoteFile(sb.remote, "ibkr-bundle/1440/AAPL.json"), "[]\n");
    assert.equal(remoteFile(sb.remote, "data/sector-map.json"), '{"AAPL":"Technology"}\n');
  } finally { sb.cleanup(); }
});

test("an ignored bundle is force-added rather than silently dropped", () => {
  const sb = makeSandbox();
  try {
    // .gitignore carries blanket rules; the bundles are tracked deliberately, hence `git add -f`.
    writeFileSync(path.join(sb.repo, ".gitignore"), "ibkr-bundle/\n");
    git(sb.repo, "add", ".gitignore");
    git(sb.repo, "commit", "--quiet", "-m", "ignore bundles");
    mkdirSync(path.join(sb.repo, "ibkr-bundle"), { recursive: true });
    writeFileSync(path.join(sb.repo, "ibkr-bundle", "AAPL.json"), "[]\n");

    const r = runRefresh(sb.repo, "commit");

    assert.equal(r.status, 0, `refresh.sh exited ${r.status}\n${r.stderr}`);
    assert.ok(remoteHas(sb.remote, "ibkr-bundle/AAPL.json"), "the ignored bundle never reached the remote");
  } finally { sb.cleanup(); }
});

test("with nothing on disk changed, it says so and leaves the remote alone", () => {
  const sb = makeSandbox();
  try {
    const before = git(sb.remote, "rev-parse", "main").trim();

    const r = runRefresh(sb.repo, "commit");

    assert.equal(r.status, 0, `refresh.sh exited ${r.status}\n${r.stderr}`);
    assert.ok(r.stdout.includes("nothing changed"), `expected the no-op message:\n${r.stdout}`);
    assert.equal(git(sb.remote, "rev-parse", "main").trim(), before);
  } finally { sb.cleanup(); }
});

test("a mistyped stage fails loudly instead of looking like a clean run", () => {
  const sb = makeSandbox();
  try {
    writeFileSync(path.join(sb.repo, "data", "sector-map.json"), '{"AAPL":"Technology"}\n');
    const before = git(sb.remote, "rev-parse", "main").trim();

    const r = runRefresh(sb.repo, "collectt");

    assert.equal(r.status, 2, "a typo in the stage name must not exit 0");
    assert.match(r.stderr, /unknown stage/);
    assert.equal(git(sb.remote, "rev-parse", "main").trim(), before);
  } finally { sb.cleanup(); }
});
