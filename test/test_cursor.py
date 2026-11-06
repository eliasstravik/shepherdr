"""Cursor launches, exact session recovery, and reversible hooks; never starts a live agent."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mods/tasks/bin"))
from herdr_task import settings, sessions, launch, revive, templates, output
from test_install import run


class Cursor(unittest.TestCase):
    def test_worker_flags_and_recovery(self):
        argv = settings.argv_for({"agent": "cursor", "model": "auto", "perm": "read-only"})
        self.assertEqual(argv, ["cursor-agent", "--model", "auto", "--mode", "ask"])
        self.assertEqual(settings.agent_key(argv), "cursor")
        self.assertEqual(settings.agent_argv("cursor"), ["cursor-agent"])
        resumed = launch.resume_argv(argv, "saved-session")
        self.assertEqual(resumed, argv + ["--resume", "saved-session"])
        self.assertEqual(revive.base_argv(resumed + ["old prompt"]), ("cursor", argv))
        self.assertEqual(revive.resume_argv("cursor", argv, "saved-session"), resumed)
        with self.assertRaises(settings.Fail):
            settings.argv_for({"agent": "cursor", "model": "auto", "effort": "high"})

    def test_session_identity_is_not_shared_between_two_agents_in_one_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            ids = ["12345678-1234-1234-1234-123456789abc", "87654321-4321-4321-4321-cba987654321"]
            for sid in ids:
                log = Path(tmp) / ".cursor/projects/project/agent-transcripts" / sid / (sid + ".jsonl")
                log.parent.mkdir(parents=True); log.write_text("{}\n")
                db = str(Path(tmp) / ".cursor/chats/project" / sid / "store.db-wal")
                with patch.object(sessions, "HOME", tmp), patch.object(sessions, "kids", return_value=[]), patch.object(sessions.shutil, "which", return_value="lsof"), patch.object(sessions, "run", return_value=SimpleNamespace(stdout="n" + db + "\n")):
                    self.assertEqual(sessions.session_of(99999999), (sid, str(log)))
                    self.assertEqual(sessions.log_by_session("cursor", sid), str(log))
                    self.assertIsNone(sessions.find_log({"agent": "cursor", "at": 1}, "TASK-1", [tmp]))

    def test_reviewer_guidance_updates_only_unedited_templates(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(templates, "TEMPLATES", tmp):
            path = Path(tmp) / "worker.md"
            path.write_text(templates.WORKER_MD_BEFORE_CURSOR)
            templates.instructions("worker")
            self.assertIn("cursor-agent --mode ask", path.read_text())
            custom = templates.WORKER_MD_BEFORE_CURSOR + "\nKeep my personal workflow.\n"
            path.write_text(custom)
            templates.instructions("worker")
            self.assertIn(custom.strip(), path.read_text())
        for name in ("cursor", "cursor-agent", "agent"):
            self.assertEqual(output.subagent({"address": "test", "agent": name})["agent"], "cursor")

    def test_cursor_hook_outside_herdr_is_silent(self):
        env = dict(os.environ); env.pop("HC_TERMINAL_ID", None)
        p = subprocess.run(["sh", str(ROOT / "mods/chat/cursor-session-note.sh")], env=env, text=True, capture_output=True)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))

    def test_cursor_hook_translates_settings_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd = Path(tmp) / "herdr-task"
            cmd.write_text("#!/bin/sh\nprintf '%s' ' Cursor settings fixture'\n")
            cmd.chmod(0o755)
            env = {**os.environ, "HC_TERMINAL_ID": "cursor-test", "PATH": tmp + os.pathsep + os.environ["PATH"]}
            p = subprocess.run(["sh", str(ROOT / "mods/chat/cursor-session-note.sh")], env=env, text=True, capture_output=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            note = json.loads(p.stdout)["additional_context"]
            self.assertTrue(note.startswith("Herdr chat:"))
            self.assertIn("Cursor settings fixture", note)

    def test_install_and_uninstall_preserve_other_cursor_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / ".config/herdr-app").mkdir(parents=True)
            path = root / ".cursor/hooks.json"; path.parent.mkdir()
            mine = {"version": 1, "hooks": {"sessionStart": [{"command": "my-hook"}]}}
            path.write_text(json.dumps(mine))
            run("install", "--root", tmp, "--yes")
            run("install", "--root", tmp, "--yes")
            hooks = json.loads(path.read_text())
            self.assertEqual(len(hooks["hooks"]["sessionStart"]), 2)
            self.assertIn("cursor-session-note.sh", hooks["hooks"]["sessionStart"][1]["command"])
            run("uninstall", "--root", tmp)
            self.assertEqual(json.loads(path.read_text()), mine)
