import importlib.util
import json
import os
import subprocess
import tempfile
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


if __name__ == "__main__":
    unittest.main()
