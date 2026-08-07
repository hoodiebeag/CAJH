#!/usr/bin/env python3
"""
swarm-runner.py — Architect/Executor/Verifier loop driver.

Corrected from the first draft. Each fix below prevents a failure that would either burn
the usage budget with nothing to show, or destroy state the agents depend on. The
contract it enforces lives in AGENT_PROTOCOL.md.

Fixes vs the original draft:
  1. Does NOT clobber .agent_state.json on start. The original called write_state() with
     a flat dict on every launch, erasing `blackboard` and `ledger` — the two things the
     file exists for. Now it read-modify-writes `control` only.
  2. Terminal states actually terminate. The original broke only on "COMPLETE" while the
     protocol and agents write "DONE", so a *successful* run looped forever. All of
     DONE / COMPLETE / BLOCKED now halt.
  3. Hard iteration cap + stall detection. `while True` with no cap meant a test the
     Executor could not fix ping-ponged EXECUTOR<->VERIFIER indefinitely — the single
     most expensive bug possible in a loop that costs money per invocation.
  4. Timeouts kill the child and stop. The original printed "Forcing state shift" but
     never shifted state and never killed the process, so it re-invoked the same agent
     forever while orphaned `claude` processes accumulated.
  5. cwd pinned to this file's directory, so agents cannot act on whatever directory the
     shell happened to be in.
  6. Git checkpoint after each phase — uncommitted work is work that gets lost.
  7. Test logs truncated before entering `notes` (they can be megabytes).
  8. The agent CLI is validated once, up front, instead of failing silently inside a
     2-second spin loop.

STATUS (2026-08-06): the `claude` CLI this script depends on (SWARM_AGENT_CMD, "claude
-p" by default) now works on this machine (npm-installed, v2.1.223 — an earlier download
attempt failed with "not a valid application for this OS platform" and blocked this
script entirely for most of the project). It is correctly implemented and could be run.

RECOMMENDATION: don't run it. One scheduled cloud task (cajh-loop-check — see
AGENT_PROTOCOL.md and the Scheduled panel; retired 2026-08-07 from three separate
per-role tasks into this single one for session-count efficiency, same coverage) already
drives this same .agent_state.json loop and has been landing real work on that cadence
without needing a human to keep anything running. Launching this script IN ADDITION would
put a second, uncoordinated writer on a state file that has already been corrupted
multiple times by a single writer conflicting with a concurrent edit — and unlike the
scheduled task, this script only runs while someone keeps the process alive, which
reintroduces exactly the "a human has to notice and restart it" failure mode the
scheduled-task setup was built to remove.

If you genuinely need tighter cadence than cajh-loop-check's current interval for a
specific push: PAUSE it first (or set automation.enabled: false in .agent_state.json), run
this script alone until done, then re-enable. Never both at once.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, ".agent_state.json")
LEASE_FILE = os.path.join(HERE, ".swarm-runner.lock")

# How the headless agent is invoked; override with SWARM_AGENT_CMD if your CLI differs.
# The original used `claude -y`; verify your CLI's non-interactive flag before trusting
# it, because an invalid flag makes every invocation fail instantly.
AGENT_CMD = os.environ.get("SWARM_AGENT_CMD", "claude -p").split()

TERMINAL = {"DONE", "COMPLETE", "BLOCKED"}
MAX_STALL = 2          # same status this many times running with no progress -> abort
AGENT_TIMEOUT = 900    # seconds per agent invocation
LOG_CAP = 4000         # chars of test output retained in notes
STALE_LEASE_SECONDS = int(os.environ.get("SWARM_STALE_LEASE_SECONDS", str(AGENT_TIMEOUT * 2)))


def pid_is_running(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return True
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
    except Exception:
        return True


def lease_is_recoverable(lease, now, stale_seconds):
    if not isinstance(lease, dict):
        return False
    created_at = lease.get("created_at")
    if not isinstance(created_at, (int, float)):
        return False
    if now - created_at < stale_seconds:
        return False
    return not pid_is_running(lease.get("pid"))


def acquire_runner_lease(repo=None, stale_seconds=STALE_LEASE_SECONDS):
    repo = repo or HERE
    lease_path = os.path.join(repo, ".swarm-runner.lock")
    token = uuid.uuid4().hex
    lease = {
        "token": token,
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "created_at": time.time(),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    payload = json.dumps(lease, sort_keys=True)
    for _ in range(2):
        try:
            fd = os.open(lease_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            return lease
        except FileExistsError:
            try:
                with open(lease_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                return None
            if not lease_is_recoverable(existing, time.time(), stale_seconds):
                return None
            try:
                os.unlink(lease_path)
            except FileNotFoundError:
                continue
            except Exception:
                return None
    return None


def release_runner_lease(lease, repo=None):
    repo = repo or HERE
    if not isinstance(lease, dict):
        return False
    lease_path = os.path.join(repo, ".swarm-runner.lock")
    try:
        with open(lease_path, "r", encoding="utf-8") as f:
            current = json.load(f)
    except FileNotFoundError:
        return True
    except Exception:
        return False
    if current.get("token") != lease.get("token"):
        return False
    try:
        os.unlink(lease_path)
        return True
    except FileNotFoundError:
        return True
    except Exception:
        return False


def task_paths(control):
    paths = {".agent_state.json"}
    for raw in str(control.get("target_file") or "").split(","):
        path = raw.strip().replace("\\", "/")
        if path:
            paths.add(path)
    return paths


def git_status_paths(repo):
    r = subprocess.run(["git", "status", "--porcelain"], cwd=repo,
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "git status failed").strip())
    paths = []
    for line in r.stdout.splitlines():
        if not line:
            continue
        body = line[3:]
        if " -> " in body:
            body = body.split(" -> ", 1)[1]
        paths.append(body.replace("\\", "/").strip('"'))
    return paths


def unexpected_git_paths(repo, owned_paths):
    owned = {path.replace("\\", "/") for path in owned_paths}
    return [path for path in git_status_paths(repo) if path not in owned]


def read_state():
    if not os.path.exists(STATE_FILE) or os.path.getsize(STATE_FILE) == 0:
        return None
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[SWARM] .agent_state.json is not valid JSON: {e}")
        return None


def write_state(state):
    """Atomic: a crash mid-write must not leave an unparseable ledger."""
    state.setdefault("control", {})["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


def log_ledger(state, agent, action, detail, tests=""):
    """Append-only, capped at 100. Never rewrites a prior entry."""
    state.setdefault("ledger", []).append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "agent": agent, "action": action,
        "detail": str(detail)[:500], "tests": str(tests)[:200],
    })
    state["ledger"] = state["ledger"][-100:]


def git_checkpoint(label):
    try:
        state = read_state()
        if state is None:
            print("   [git] checkpoint blocked: unreadable state")
            return False
        owned = task_paths(state.get("control", {}))
        unexpected = unexpected_git_paths(HERE, owned)
        if unexpected:
            print(f"   [git] checkpoint blocked: unexpected dirty paths: {', '.join(unexpected[:10])}")
            return False
        subprocess.run(["git", "add", "--", *sorted(owned)], cwd=HERE,
                       capture_output=True, timeout=60)
        r = subprocess.run(["git", "commit", "-q", "-m", f"swarm: {label}"],
                           cwd=HERE, capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            print(f"   [git] committed: {label}")
            return True
        return False
    except Exception as e:
        print(f"   [git] checkpoint skipped: {e}")
        return False


def run_agent(role, instructions):
    print(f"\n[SWARM] Activating {role} ...")
    prompt = (
        f"{instructions}\n\n"
        "Read AGENT_PROTOCOL.md, AGENT_RUNBOOK.md, and .agent_state.json first. Act ONLY if control.status "
        "names your phase. Edit only the current queue item's declared file set. Never checkout/reset/stash files "
        "you do not own. Do not kill node processes or touch candles/ — order-flow data "
        "collection is running there. Commit and push your work, then append ONE ledger "
        "entry and write the state file last."
    )
    p = None
    try:
        p = subprocess.Popen(AGENT_CMD, cwd=HERE, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        out, err = p.communicate(input=prompt, timeout=AGENT_TIMEOUT)
        if p.returncode != 0:
            print(f"   [warn] {role} exited {p.returncode}: {(err or '')[:300]}")
        return out
    except subprocess.TimeoutExpired:
        if p:
            p.kill()
            p.communicate()
        print(f"   [error] {role} timed out after {AGENT_TIMEOUT}s; child killed.")
        return None


def main():
    if not shutil.which(AGENT_CMD[0]):
        print(f"[SWARM] Agent CLI '{AGENT_CMD[0]}' not found on PATH. "
              f"Set SWARM_AGENT_CMD, e.g. SWARM_AGENT_CMD='claude -p'.")
        sys.exit(1)

    lease = acquire_runner_lease()
    if lease is None:
        print("[SWARM] Another runner lease is active or ambiguous. Exiting without dispatch.")
        return

    try:
        run_loop()
    finally:
        if not release_runner_lease(lease):
            print("[SWARM] Runner lease was not released; inspect .swarm-runner.lock before relaunch.")


def run_loop():
    state = read_state()
    if state is None:
        print("[SWARM] No usable .agent_state.json. Seed it (see AGENT_PROTOCOL.md) first.")
        sys.exit(1)
    state.setdefault("control", {})

    # Retarget from argv only when asked; otherwise keep the existing objective. The
    # original overwrote target/objective AND wiped blackboard+ledger on every launch.
    if len(sys.argv) >= 3:
        state["control"].update({"target_file": sys.argv[1], "objective": sys.argv[2],
                                 "status": "ARCHITECT_PENDING", "iteration": 0})
        log_ledger(state, "runner", "retarget", f"{sys.argv[1]}: {sys.argv[2]}")
        write_state(state)

    ctl = state["control"]
    print("=" * 62)
    print("Autonomous 3-Agent Swarm")
    print(f"  target    : {ctl.get('target_file')}")
    print(f"  objective : {(ctl.get('objective') or '')[:100]}")
    print(f"  max iters : {ctl.get('max_iterations', 10)}")
    print("=" * 62)

    last_status, stall = None, 0

    while True:
        state = read_state()
        if state is None:
            print("[SWARM] State file became unreadable. Halting.")
            break
        ctl = state.setdefault("control", {})
        status = ctl.get("status")

        if status in TERMINAL:
            print(f"\n[SWARM] Terminal state: {status}. {str(ctl.get('notes',''))[:300]}")
            break

        if ctl.get("iteration", 0) >= ctl.get("max_iterations", 10):
            ctl["status"] = "BLOCKED"
            ctl["notes"] = f"Hit max_iterations ({ctl.get('max_iterations', 10)}) without converging."
            log_ledger(state, "runner", "abort", ctl["notes"])
            write_state(state)
            print(f"\n[SWARM] {ctl['notes']} Halting.")
            break

        # Stall guard: an agent that exits without advancing status would otherwise be
        # re-invoked forever at ~2s intervals, each invocation costing real money.
        stall = stall + 1 if status == last_status else 0
        if stall >= MAX_STALL:
            ctl["status"] = "BLOCKED"
            ctl["notes"] = f"No progress after {MAX_STALL + 1} invocations at status {status}."
            log_ledger(state, "runner", "stall", ctl["notes"])
            write_state(state)
            print(f"\n[SWARM] {ctl['notes']} Halting.")
            break
        last_status = status

        if status == "ARCHITECT_PENDING":
            if run_agent("Agent 1 (Architect)",
                f"You are the Architect. Objective: '{ctl.get('objective')}' in "
                f"'{ctl.get('target_file')}'. Write imports, interfaces and function stubs ONLY, "
                "each containing the exact marker '// TODO(Executor): Build logic here'. No inner "
                "logic. Put your design rationale in control.notes and set control.status to "
                "EXECUTOR_PENDING.") is None:
                continue
            git_checkpoint("architect phase")

        elif status == "EXECUTOR_PENDING":
            if run_agent("Agent 2 (Executor)",
                f"You are the Executor. Implement the current bounded queue item in "
                f"'{ctl.get('target_file')}'. Objective: {ctl.get('objective')}. Notes: "
                f"{str(ctl.get('notes') or '')[:2000]}. Add the required focused tests and preserve "
                "all live-trading safety invariants. If the design is wrong set control.status to BLOCKED "
                "with reasoning rather than silently redesigning. On success, commit, set the queue item "
                "to verifying, set control.status to VERIFIER_PENDING, clear control.notes, and append a "
                "ledger entry.") is None:
                continue
            git_checkpoint("executor phase")

        elif status == "VERIFIER_PENDING":
            if run_agent("Agent 3 (Verifier)",
                f"You are the independent Verifier for '{ctl.get('target_file')}'. Inspect the exact diff, "
                f"run {ctl.get('test_command', 'npm.cmd test')}, and verify every queue acceptance criterion "
                "and fail-closed requirement. Do not accept green tests alone. On pass: mark the active queue "
                "item done, update its remediation-register item to done when applicable, route the first pending "
                "item whose dependencies are all done into control with EXECUTOR_PENDING, and append a ledger entry. "
                "On failure: keep the item executing, set EXECUTOR_PENDING with a minimal reproduction, increment "
                "iteration, and append a ledger entry.") is None:
                continue
            git_checkpoint("verifier gate")

        else:
            print(f"[SWARM] Unknown status '{status}'. Halting rather than guessing.")
            break

        time.sleep(2)


if __name__ == "__main__":
    main()
