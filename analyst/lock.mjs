/**
 * Single-writer guard for the append-only journal.
 *
 * THE HAZARD IS ALREADY DOCUMENTED AND HAD NO GUARD. `docs/SCHEDULING.md` says: "One machine should
 * append to it — two both appending produce a merge conflict in an append-only file." That was advice
 * with nothing enforcing it, and the failure it describes is not a lost line: it is a merge conflict in
 * the evidence record, resolved by hand, at which point the journal's integrity depends on whoever
 * resolved it choosing correctly. For an unattended daily run that is the wrong place for judgement.
 *
 * WHAT THIS DOES NOT DO. It does not touch risk limits, sizing, order behaviour, passing criteria or
 * STOP criteria, and it does not change what any journal record contains. It gates *when* a mutating
 * command may start. A held lock refuses the second writer; it never edits, truncates or reorders.
 *
 * WHY A FILE AND NOT flock(2). The writers this protects against are on DIFFERENT MACHINES sharing the
 * record through git, which is exactly the case an advisory OS lock cannot see. A tracked-directory
 * lockfile carrying host and pid is visible to a human reading the repo, which is what actually
 * resolves these. It is therefore honest about being advisory: it stops the common accident (two
 * schedulers, or a run starting while another is mid-flight) and does not pretend to be a distributed
 * mutex.
 *
 * STALE LOCKS FAIL CLOSED, ON PURPOSE. A crashed run leaves its lock behind. Breaking it automatically
 * after a timeout is the tempting design and it is wrong here: the timeout would have to be longer
 * than the slowest legitimate run, nobody knows what that is yet (no paper run has ever happened), and
 * guessing too short silently re-creates the two-writer case this exists to prevent. So an expired
 * lock is REPORTED with the exact recovery command and the run refuses. Breaking it is explicit and
 * human, never automatic — the same shape as `.git/ALLOW_PROTECTED_EDIT`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Advisory only: how long before a held lock is called suspicious. It never auto-breaks. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;   // 6h — longer than any plausible single session

export const lockPathFor = (journalFile) => `${journalFile}.lock`;

/** Read a lock without judging it. `null` when absent; `{ corrupt: true }` when unreadable. */
export function readLock(journalFile) {
  const p = lockPathFor(journalFile);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  try {
    const held = JSON.parse(raw);
    const ageMs = Date.now() - Date.parse(held.acquiredAt);
    return { ...held, path: p, ageMs: Number.isNaN(ageMs) ? null : ageMs, stale: !Number.isNaN(ageMs) && ageMs > STALE_AFTER_MS };
  } catch {
    // A corrupt lock is still a lock. Treating an unparseable one as absent would let a second writer
    // through at exactly the moment something has already gone wrong.
    return { corrupt: true, path: p, raw: raw.slice(0, 200), stale: false, ageMs: null };
  }
}

/** Is this our own process's lock? Re-entrancy within one run must not deadlock against itself. */
const isOwnProcess = (held) => held && !held.corrupt && held.pid === process.pid && held.host === os.hostname();

/**
 * Acquire, or throw with a message that says what to do next.
 *
 * `wx` makes creation atomic against another process on the same filesystem: whoever loses gets EEXIST
 * rather than both believing they hold it. That is the check-then-write race, closed.
 */
export function acquireLock(journalFile, { command = null, breakStale = false } = {}) {
  const p = lockPathFor(journalFile);
  const held = readLock(journalFile);

  if (held && isOwnProcess(held)) return { path: p, reentrant: true, release: () => releaseLock(journalFile) };

  if (held && !breakStale) throw new Error(describeHeld(held, journalFile));
  if (held && breakStale) {
    if (held.corrupt) throw new Error(
      `journal lock at ${p} is unreadable, so it cannot be confirmed stale. Inspect it by hand before ` +
      `removing it — an unparseable lock means something already went wrong.\n  cat ${p}`);
    if (!held.stale) throw new Error(
      `refusing to break a lock that is not stale: held ${Math.round((held.ageMs ?? 0) / 60000)} min by ` +
      `${held.host} pid ${held.pid}, under the ${STALE_AFTER_MS / 3600000}h threshold. If that run really ` +
      `is dead, remove the file deliberately:\n  rm ${p}`);
    fs.rmSync(p, { force: true });
  }

  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = {
    host: os.hostname(), pid: process.pid, user: os.userInfo().username,
    command, acquiredAt: new Date().toISOString(), journal: journalFile,
  };
  try {
    fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n", { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(describeHeld(readLock(journalFile) ?? {}, journalFile));
    throw e;
  }
  return { path: p, reentrant: false, release: () => releaseLock(journalFile) };
}

/** Release only our own lock. Deleting someone else's is the two-writer bug wearing a cleanup hat. */
export function releaseLock(journalFile) {
  const held = readLock(journalFile);
  if (!held) return { released: false, reason: "no lock present" };
  if (held.corrupt) return { released: false, reason: "lock unreadable; left in place for inspection" };
  if (!isOwnProcess(held)) return { released: false, reason: `held by ${held.host} pid ${held.pid}, not this process` };
  fs.rmSync(lockPathFor(journalFile), { force: true });
  return { released: true };
}

/** The recovery plan, in the error itself. An operator reading a 3am log gets the command, not a hint. */
function describeHeld(held, journalFile) {
  const p = lockPathFor(journalFile);
  if (held.corrupt) {
    return `journal lock present but unreadable at ${p}. Something went wrong mid-write; inspect before removing.\n` +
           `  cat ${p}\n  # then, if you are certain no run is active:  rm ${p}`;
    }
  const mins = held.ageMs === null ? "unknown" : Math.round(held.ageMs / 60000);
  const lines = [
    `journal ${journalFile} is locked by another writer — refusing to append.`,
    `  held by : ${held.host} pid ${held.pid} (${held.user ?? "unknown user"})`,
    `  command : ${held.command ?? "unrecorded"}`,
    `  since   : ${held.acquiredAt} (${mins} min ago)`,
    "",
    "Two writers appending to an append-only journal produce a merge conflict in the evidence record.",
  ];
  if (held.stale) {
    lines.push(
      `This lock is older than the ${STALE_AFTER_MS / 3600000}h staleness threshold, so the run that took it`,
      "has probably died. It is NOT broken automatically — confirm no run is active, then either:",
      `  node analyst-run.mjs readiness --break-stale-lock   # refuses unless genuinely stale`,
      `  rm ${p}                                            # or remove it deliberately`);
  } else {
    lines.push(
      "If that run is genuinely still going, wait for it. If the host is wrong — two machines are both",
      "writing — fix the schedule first: only ONE machine should append, or the record forks.");
  }
  return lines.join("\n");
}
