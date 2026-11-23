"""SHEP-324: a note on an artifact goes to the agent that keeps it with hc send. When that agent exited and left a
plain shell (herdr-core lost it, or it quit), the note was typed into the shell as a command. Now it is kept instead
(herdr-task's held messages: an Assistant starts again with it, a task's agent gets it when restarted). A fake hc."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


artifact = load("herdr_artifact_never_typed", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))


class NoteNeverTypedIntoAShell(unittest.TestCase):
    def setUp(self):
        self.fg, self.calls, self.kept = None, [], []

        def run(args, **kw):
            self.calls.append(list(args))
            out = json.dumps({"state": "live", "foreground": self.fg}) if args[:2] == ["hc", "get"] else ""
            return types.SimpleNamespace(returncode=0, stdout=out, stderr="")

        class Store:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return types.SimpleNamespace(find=lambda i: {"id": "a1", "version": 1, "title": "Plan"})

            def __exit__(self, *a):
                return False
        for name, value in (("run", run), ("find_anywhere", lambda i: {"folder": "/w"}), ("Store", Store),
                            ("keeper", lambda a, folder: ("t5", "made it")),
                            ("hold_note", lambda to, body: self.kept.append((to, body)) or True)):
            p = mock.patch.object(artifact, name, value)
            p.start()
            self.addCleanup(p.stop)

    def note(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            artifact.tell(types.SimpleNamespace(id="a1", version=None, json=True), "", ["make the header blue"])
        return json.loads(out.getvalue())

    def test_a_plain_shell_gets_nothing_typed_and_the_note_is_kept(self):
        self.fg = {"name": "bash", "argv": ["/bin/bash"]}
        out = self.note()
        self.assertEqual([c for c in self.calls if c[:2] == ["hc", "send"]], [])
        self.assertEqual([to for to, _ in self.kept], ["t5"])
        self.assertIn("make the header blue", self.kept[0][1])
        self.assertTrue(out["held"])
        self.assertEqual(out["said"], artifact.STOPPED_NOTE)

    def test_its_agent_in_front_gets_the_note(self):
        for fg in ({"name": "claude", "argv": ["claude"]}, {"name": "fish", "argv": ["fish", "-ic", "claude; exec fish -i"]}):
            self.calls, self.kept = [], []
            self.fg = fg
            self.note()
            self.assertEqual(len([c for c in self.calls if c[:2] == ["hc", "send"]]), 1)
            self.assertEqual(self.kept, [])


if __name__ == "__main__":
    unittest.main()
