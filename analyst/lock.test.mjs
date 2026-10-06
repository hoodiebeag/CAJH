/**
 * Tests for the journal single-writer guard.
 *
 * The interesting cases are all failures: a second writer, a stale lock, a corrupt lock, and a release
 * attempted by someone who does not hold it. The happy path is one line.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { acquireLock, releaseLock, readLock, lockPathFor, STALE_AFTER_MS } from "./lock.mjs";

const box = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lock-")), "journal.jsonl");

/** Rewrite a held lock as if another live process took it. */
function foreign(journal, { minutesAgo = 5, pid = 999999, host = "other-machine" } = {}) {
  fs.writeFileSync(lockPathFor(journal), JSON.stringify({
    host, pid, user: "someone", command: "analyst-run.mjs paper",
    acquiredAt: new Date(Date.now() - minutesAgo * 60000).toISOString(), journal,
  }) + "\n");
}

test("acquire then release, and the lock file is gone afterwards", () => {
  const j = box();
  const held = acquireLock(j, { command: "test" });
  assert.equal(fs.existsSync(held.path), true);
  assert.equal(readLock(j).pid, process.pid);
  assert.equal(readLock(j).host, os.hostname());
  assert.deepEqual(releaseLock(j), { released: true });
  assert.equal(fs.existsSync(lockPathFor(j)), false);
});

test("a second writer is refused, and the message names host, pid and age", () => {
  const j = box();
  foreign(j, { minutesAgo: 7 });
  assert.throws(() => acquireLock(j, { command: "analyst-run.mjs settle" }), (e) => {
    assert.match(e.message, /is locked by another writer/);
    assert.match(e.message, /other-machine pid 999999/);
    assert.match(e.message, /merge conflict in the evidence record/);
    assert.match(e.message, /only ONE machine should append/);
    return true;
  });
});

test("re-acquiring our own lock is re-entrant rather than a deadlock against ourselves", () => {
  const j = box();
  const a = acquireLock(j, { command: "outer" });
  const b = acquireLock(j, { command: "inner" });
  assert.equal(b.reentrant, true);
  assert.equal(a.path, b.path);
  releaseLock(j);
});

test("a stale lock is reported as stale with a recovery command, and is NOT broken automatically", () => {
  const j = box();
  const hours = STALE_AFTER_MS / 3600000;
  foreign(j, { minutesAgo: hours * 60 + 30 });
  assert.equal(readLock(j).stale, true);

  // Default behaviour on a stale lock is still refusal. Automatic breaking would need a timeout longer
  // than the slowest legitimate run, and no paper run has ever happened, so that duration is unknown.
  assert.throws(() => acquireLock(j, { command: "x" }), /STALE|older than the/);
  assert.equal(fs.existsSync(lockPathFor(j)), true, "a stale lock was removed without being asked");

  // Breaking it is explicit, and then succeeds.
  const got = acquireLock(j, { command: "x", breakStale: true });
  assert.equal(got.reentrant, false);
  assert.equal(readLock(j).pid, process.pid);
  releaseLock(j);
});

test("breakStale refuses a lock that is not actually stale", () => {
  const j = box();
  foreign(j, { minutesAgo: 3 });
  assert.throws(() => acquireLock(j, { breakStale: true }), /refusing to break a lock that is not stale/);
  assert.equal(readLock(j).host, "other-machine", "a fresh foreign lock was broken");
});

test("a corrupt lock is treated as held, not as absent", () => {
  // The dangerous reading of an unparseable lock is 'no lock', which lets a second writer through at
  // exactly the moment something has already gone wrong mid-write.
  const j = box();
  fs.writeFileSync(lockPathFor(j), "{half-written");
  assert.equal(readLock(j).corrupt, true);
  assert.throws(() => acquireLock(j), /unreadable/);
  assert.throws(() => acquireLock(j, { breakStale: true }), /cannot be confirmed stale/);
  assert.equal(fs.existsSync(lockPathFor(j)), true);
});

test("release never removes a lock this process does not hold", () => {
  const j = box();
  foreign(j);
  const r = releaseLock(j);
  assert.equal(r.released, false);
  assert.match(r.reason, /held by other-machine pid 999999/);
  assert.equal(fs.existsSync(lockPathFor(j)), true, "released someone else's lock");

  fs.writeFileSync(lockPathFor(j), "{corrupt");
  assert.equal(releaseLock(j).released, false);
  assert.equal(fs.existsSync(lockPathFor(j)), true, "removed a corrupt lock instead of leaving it for inspection");
});

test("releasing when nothing is held is a no-op, not an error", () => {
  const j = box();
  assert.deepEqual(releaseLock(j), { released: false, reason: "no lock present" });
});

// ---- end to end through the CLI ----------------------------------------------------------------

test("the CLI refuses a mutating command while another writer holds the lock, and exits 4", () => {
  const REPO = path.resolve(import.meta.dirname, "..");
  const j = box();
  foreign(j, { minutesAgo: 2 });

  let status = 0, stderr = "";
  try {
    execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "settle", "--mode", "dry-run", "--journal", j],
      { cwd: REPO, stdio: "pipe", encoding: "utf8" });
  } catch (e) { status = e.status; stderr = String(e.stderr ?? ""); }

  assert.equal(status, 4, `expected exit 4 for a locked journal, got ${status}\n${stderr}`);
  assert.match(stderr, /locked by another writer/);
  assert.equal(readLock(j).host, "other-machine", "the CLI broke a foreign lock");
  assert.equal(fs.existsSync(j), false, "a refused run still created the journal");
});

test("the readiness probe reports a held lock WITHOUT taking or breaking it", () => {
  const REPO = path.resolve(import.meta.dirname, "..");
  const j = box();
  foreign(j, { minutesAgo: 11 });

  let out = "";
  try {
    out = execFileSync("node", [path.join(REPO, "analyst-run.mjs"), "readiness", "--root", "sp500-bundle", "--journal", j],
      { cwd: REPO, stdio: "pipe", encoding: "utf8" });
  } catch (e) { out = String(e.stdout ?? ""); }   // exits 1 when not ready, which it is

  assert.match(out, /journal lock/);
  assert.match(out, /other-machine pid 999999/);
  assert.equal(readLock(j).host, "other-machine", "the probe took over the lock");
  assert.equal(readLock(j).pid, 999999);
});
