import importlib.util
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("swarm-runner.py")


spec = importlib.util.spec_from_file_location("swarm_runner", MODULE_PATH)
swarm_runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(swarm_runner)


def git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True)


class ScopedCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "test@example.com")
        git(self.repo, "config", "user.name", "Test Agent")
        (self.repo / "owned.js").write_text("base\n", encoding="utf-8")
        (self.repo / "other.js").write_text("base\n", encoding="utf-8")
        (self.repo / ".agent_state.json").write_text(json.dumps({
            "control": {"target_file": "owned.js"}
        }), encoding="utf-8")
        git(self.repo, "add", "owned.js", "other.js", ".agent_state.json")
        git(self.repo, "commit", "-qm", "base")
        self.old_here = swarm_runner.HERE
        self.old_state = swarm_runner.STATE_FILE
        swarm_runner.HERE = str(self.repo)
        swarm_runner.STATE_FILE = str(self.repo / ".agent_state.json")

    def tearDown(self):
        swarm_runner.HERE = self.old_here
        swarm_runner.STATE_FILE = self.old_state
        self.tmp.cleanup()

    def test_checkpoint_stages_and_commits_only_declared_files_and_state(self):
        (self.repo / "owned.js").write_text("changed\n", encoding="utf-8")
        (self.repo / ".agent_state.json").write_text(json.dumps({
            "control": {"target_file": "owned.js", "status": "VERIFIER_PENDING"}
        }), encoding="utf-8")

        self.assertTrue(swarm_runner.git_checkpoint("scoped"))

        changed = git(self.repo, "show", "--name-only", "--format=", "HEAD").stdout.splitlines()
        self.assertEqual(changed, [".agent_state.json", "owned.js"])
        status = git(self.repo, "status", "--porcelain").stdout
        self.assertEqual(status, "")

    def test_checkpoint_blocks_unexpected_modified_file_without_staging_it(self):
        (self.repo / "owned.js").write_text("changed\n", encoding="utf-8")
        (self.repo / "other.js").write_text("other changed\n", encoding="utf-8")
        before = git(self.repo, "rev-parse", "--short", "HEAD").stdout.strip()

        self.assertFalse(swarm_runner.git_checkpoint("blocked"))

        after = git(self.repo, "rev-parse", "--short", "HEAD").stdout.strip()
        self.assertEqual(after, before)
        staged = git(self.repo, "diff", "--cached", "--name-only").stdout
        self.assertEqual(staged, "")
        status = git(self.repo, "status", "--porcelain").stdout
        self.assertIn(" M owned.js", status)
        self.assertIn(" M other.js", status)

    def test_checkpoint_blocks_unexpected_staged_file_without_discarding_it(self):
        (self.repo / "other.js").write_text("other staged\n", encoding="utf-8")
        git(self.repo, "add", "other.js")

        self.assertFalse(swarm_runner.git_checkpoint("blocked"))

        staged = git(self.repo, "diff", "--cached", "--name-only").stdout.splitlines()
        self.assertEqual(staged, ["other.js"])


class RunnerLeaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_second_runner_cannot_acquire_an_active_lease(self):
        first = swarm_runner.acquire_runner_lease(str(self.repo), stale_seconds=60)
        self.assertIsNotNone(first)

        second = swarm_runner.acquire_runner_lease(str(self.repo), stale_seconds=60)

        self.assertIsNone(second)
        self.assertTrue((self.repo / ".swarm-runner.lock").exists())
        self.assertTrue(swarm_runner.release_runner_lease(first, str(self.repo)))
        self.assertFalse((self.repo / ".swarm-runner.lock").exists())

    def test_only_safe_stale_dead_pid_lease_recovers(self):
        stale = {
            "token": "old",
            "pid": 99999999,
            "host": "test",
            "created_at": time.time() - 120,
        }
        (self.repo / ".swarm-runner.lock").write_text(json.dumps(stale), encoding="utf-8")

        lease = swarm_runner.acquire_runner_lease(str(self.repo), stale_seconds=60)

        self.assertIsNotNone(lease)
        self.assertNotEqual(lease["token"], "old")
        self.assertTrue(swarm_runner.release_runner_lease(lease, str(self.repo)))

    def test_ambiguous_lease_blocks_without_mutation(self):
        path = self.repo / ".swarm-runner.lock"
        path.write_text("not-json", encoding="utf-8")

        self.assertIsNone(swarm_runner.acquire_runner_lease(str(self.repo), stale_seconds=0))
        self.assertEqual(path.read_text(encoding="utf-8"), "not-json")

    def test_main_releases_lease_when_loop_raises(self):
        old_here = swarm_runner.HERE
        old_state = swarm_runner.STATE_FILE
        old_lease = swarm_runner.LEASE_FILE
        old_loop = swarm_runner.run_loop
        old_which = swarm_runner.shutil.which
        swarm_runner.HERE = str(self.repo)
        swarm_runner.STATE_FILE = str(self.repo / ".agent_state.json")
        swarm_runner.LEASE_FILE = str(self.repo / ".swarm-runner.lock")
        swarm_runner.shutil.which = lambda _cmd: "agent"
        swarm_runner.run_loop = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            with self.assertRaises(RuntimeError):
                swarm_runner.main()
            self.assertFalse((self.repo / ".swarm-runner.lock").exists())
        finally:
            swarm_runner.HERE = old_here
            swarm_runner.STATE_FILE = old_state
            swarm_runner.LEASE_FILE = old_lease
            swarm_runner.run_loop = old_loop
            swarm_runner.shutil.which = old_which


if __name__ == "__main__":
    unittest.main()
