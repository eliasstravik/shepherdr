"""Cursor launches, exact session recovery, and reversible hooks; never starts a live agent."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import importlib.util
import io
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
            self.assertEqual(len(hooks["hooks"]["sessionStart"]), 3)
            self.assertIn("cursor-session-note.sh", hooks["hooks"]["sessionStart"][2]["command"])
            for event in ("sessionStart", "beforeSubmitPrompt", "stop", "sessionEnd"):
                self.assertEqual(sum("cursor-status.py" in h["command"] for h in hooks["hooks"][event]), 1)
            run("uninstall", "--root", tmp)
            self.assertEqual(json.loads(path.read_text()), mine)


class CursorStatus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("cursor_status", ROOT / "mods/chat/cursor-status.py")
        cls.hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.hook)

    def test_real_lifecycle_signals_preserve_error_and_cancel_outcomes(self):
        for payload, state in [
            ({"hook_event_name": "sessionStart"}, "idle"),
            ({"hook_event_name": "beforeSubmitPrompt"}, "working"),
            ({"hook_event_name": "stop", "status": "completed"}, "done"),
            ({"hook_event_name": "stop", "status": "error"}, "error"),
            ({"hook_event_name": "stop", "status": "aborted"}, "idle"),
            ({"hook_event_name": "sessionEnd"}, "clear"),
            ({"hook_event_name": "subagentStop", "status": "completed"}, None),
            ({"hook_event_name": "stop", "status": "unknown"}, None),
        ]:
            with self.subTest(payload=payload):
                self.assertEqual(self.hook.status(payload), state)

    def test_status_goes_to_the_controlling_terminal_never_hook_stdout(self):
        with patch.dict(os.environ, {"HC_TERMINAL_ID": "fixture"}), \
             patch.object(sys, "stdin", io.StringIO('{"hook_event_name":"sessionStart"}')), \
             patch.object(sys, "stdout", io.StringIO()) as output, \
             patch.object(self.hook.os, "open", return_value=7) as opened, \
             patch.object(self.hook.os, "write") as write, patch.object(self.hook.os, "close") as close:
            self.hook.main()
            opened.assert_called_once_with("/dev/tty", os.O_WRONLY | os.O_NOCTTY)
            write.assert_called_once_with(7, b"\x1b]7501;state=idle:app=cursor-agent\x1b\\")
            close.assert_called_once_with(7)
            self.assertEqual(output.getvalue(), "")

    def test_non_herdr_and_invalid_input_never_report_readiness(self):
        for inside, text in [(False, '{"hook_event_name":"sessionStart"}'), (True, 'not json'), (True, '[]'), (True, '{}')]:
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "stdin", io.StringIO(text)), patch.object(self.hook.os, "open") as opened:
                if inside:
                    os.environ["HC_TERMINAL_ID"] = "fixture"
                self.hook.main()
                opened.assert_not_called()

    def test_missing_controlling_terminal_does_not_break_cursor(self):
        with patch.dict(os.environ, {"HC_TERMINAL_ID": "fixture"}), \
             patch.object(sys, "stdin", io.StringIO('{"hook_event_name":"sessionStart"}')), \
             patch.object(self.hook.os, "open", side_effect=OSError("no terminal")), \
             patch.object(self.hook, "parent_ttys", return_value=iter([])):
            self.hook.main()


    def test_detached_hooks_find_only_an_ancestor_terminal(self):
        replies = [subprocess.CompletedProcess([], 0, "20 ??\n", ""), subprocess.CompletedProcess([], 0, "10 ttys003\n", ""), subprocess.CompletedProcess([], 0, "1 ??\n", "")]
        with patch.object(self.hook.os, "getppid", return_value=30), patch.object(self.hook.subprocess, "run", side_effect=replies) as run:
            self.assertEqual(list(self.hook.parent_ttys()), ["/dev/ttys003"])
            self.assertEqual([c.args[0][2] for c in run.call_args_list], ["30", "20", "10"])
        with patch.object(self.hook, "parent_ttys", return_value=iter(["/dev/pts/4"])), \
             patch.object(self.hook.os, "open", side_effect=[OSError("detached"), 9]) as opened, \
             patch.object(self.hook.os, "write") as write, patch.object(self.hook.os, "close") as close:
            self.hook.report("working")
            self.assertEqual(opened.call_args.args[0], "/dev/pts/4")
            write.assert_called_once_with(9, b"\x1b]7501;state=working:app=cursor-agent\x1b\\")
            close.assert_called_once_with(9)
