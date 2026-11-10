"""herdr-artifact publish against a fake herdr-app (first on PATH): a read-only install (Nix) still publishes (#749),
a checker that doesn't connect or hangs doesn't stop a recipe (#847, #843), and a publish waiting on another one's lock
says so (#843). Runs in a throwaway store; nothing is installed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import fcntl
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import threading
import time
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


A = load("herdr_artifact_publish_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))

# A stand-in herdr-app: `check <dir> --print-spec` does what $FAKE_CHECK says, and logs each call.
FAKE = """#!/bin/sh
echo "$@" >> "$FAKE_LOG"
case "$FAKE_CHECK" in
  ok) echo 'div'; exit 0 ;;
  noconnect) echo 'herdr-app: isolated checker failed: checker job did not connect within 10 seconds' >&2; exit 1 ;;
  hang) sleep 30 & wait ;;
  broken) echo 'TypeError: blocks is not iterable' >&2; exit 1 ;;
esac
"""


class Publish(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-artifact-")
        store = os.path.join(self.dir, "store")
        self.folder = os.path.join(self.dir, "proj")
        os.makedirs(self.folder)
        bin_ = os.path.join(self.dir, "bin")
        os.makedirs(bin_)
        with open(os.path.join(bin_, "herdr-app"), "w") as f:
            f.write(FAKE)
        os.chmod(os.path.join(bin_, "herdr-app"), 0o755)
        self.log = os.path.join(self.dir, "calls")
        self.patches = [mock.patch.object(A, "STORE", store), mock.patch.object(A, "FILES", os.path.join(store, "files")),
                        mock.patch.object(A, "NOTES", os.path.join(store, "notes")),
                        mock.patch.object(A, "APP", os.path.join(self.dir, "app")),
                        mock.patch.object(A, "me", return_value={"terminal": "t9", "task": None}),
                        mock.patch.dict(os.environ, {"PATH": bin_ + os.pathsep + os.environ.get("PATH", ""),
                                                     "FAKE_LOG": self.log, "FAKE_CHECK": "ok"})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        for root, dirs, _ in os.walk(self.dir):
            for d in dirs:
                os.chmod(os.path.join(root, d), 0o755)
        shutil.rmtree(self.dir, ignore_errors=True)

    def recipe(self, name="proof"):
        d = os.path.join(self.dir, name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": [{"type": "text", "text": "It works."}]}, f)
        return d

    def publish(self, d, **k):
        base = dict(id=None, title="Report", folder=self.folder, task=None, note=None, json=True, custom=False, dir=d)
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            A.cmd_publish(types.SimpleNamespace(**{**base, **k}))
        return json.loads(out.getvalue())

    def calls(self):
        try:
            with open(self.log) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []

    def test_a_read_only_install_publishes(self):
        """#749: the installed recipe view, its core and Mark up are read-only (a Nix store): staging still rewrites them."""
        ro = os.path.join(self.dir, "nix-store")
        os.makedirs(ro)
        parts = {}
        for name, src in (("RECIPE_VIEW", A.RECIPE_VIEW), ("RECIPE_CORE", A.RECIPE_CORE), ("MARKUP", A.MARKUP)):
            dst = os.path.join(ro, name + ".js")
            shutil.copyfile(src, dst)
            os.chmod(dst, 0o444)
            parts[name] = dst
        # Mark up's helpers sit beside it (#870), in the same read-only folder.
        for h in A.MARKUP_HELPERS:
            os.makedirs(os.path.dirname(os.path.join(ro, h)), exist_ok=True)
            dst = os.path.join(ro, h)
            shutil.copyfile(os.path.join(os.path.dirname(A.MARKUP), h), dst)
            os.chmod(dst, 0o444)
        os.chmod(ro, 0o555)
        d = self.recipe()
        os.chmod(os.path.join(d, "recipe.json"), 0o444)
        os.makedirs(os.path.join(self.dir, "app", "mods"))
        with mock.patch.multiple(A, **parts):
            out = self.publish(d)
        self.assertTrue(out["installed"])
        self.assertEqual(len(self.calls()), 2)  # dark and light
        mod = os.path.join(self.dir, "app", "mods", out["mod"])
        for f in ("recipe-view.js", "recipe.js", "artifact-markup.js", "dirs.js", "core/paths.js", "recipe.json"):
            self.assertTrue(os.stat(os.path.join(mod, f)).st_mode & stat.S_IWUSR, f)

    def test_a_checker_that_does_not_connect_still_publishes_a_recipe(self):
        """#847: herdr-app's isolated checker doesn't connect (after Herdr restarted): it tries again, then a recipe
        (already checked against its schema) publishes, saying it wasn't drawn."""
        os.environ["FAKE_CHECK"] = "noconnect"
        with mock.patch.object(A, "RETRY_WAIT", 0):
            out = self.publish(self.recipe())
        self.assertEqual(out["version"], 1)
        self.assertIn("did not connect", out["unchecked"])
        self.assertEqual(len(self.calls()), 2)  # tried twice, then not again for light

    def test_a_custom_panel_still_needs_the_check(self):
        """#847: a custom panel isn't published undrawn: it says Herdr couldn't check it, and to try again."""
        os.environ["FAKE_CHECK"] = "noconnect"
        d = os.path.join(self.dir, "panel")
        os.makedirs(d)
        with open(os.path.join(d, "main.js"), "w") as f:
            f.write('export default class X {}\n')
        with mock.patch.object(A, "RETRY_WAIT", 0), self.assertRaises(A.Fail) as e:
            self.publish(d, custom=True)
        self.assertIn("couldn't draw it", str(e.exception))
        with A.Store(A.locate(self.folder), write=False) as st:
            self.assertEqual(st.data["artifacts"], [])

    def test_a_broken_recipe_is_still_refused(self):
        """A real failure to draw isn't taken for the checker's own trouble."""
        os.environ["FAKE_CHECK"] = "broken"
        with self.assertRaises(A.Fail) as e:
            self.publish(self.recipe())
        self.assertIn("not iterable", str(e.exception))
        self.assertEqual(len(self.calls()), 1)

    def test_a_hanging_checker_times_out(self):
        """#843: a check that never ends (its checker waits forever) gives up, and the recipe publishes."""
        os.environ["FAKE_CHECK"] = "hang"
        t = time.time()
        with mock.patch.object(A, "CHECK_TIMEOUT", 0.5), mock.patch.object(A, "RETRY_WAIT", 0):
            out = self.publish(self.recipe())
        self.assertLess(time.time() - t, 10)
        self.assertIn("didn't finish", out["unchecked"])

    def test_every_installed_import_resolves(self):
        """#870: the installed Mark up imports dirs.js (and that imports core/paths.js), which the artifact's mod
        must carry: a relative import with no file beside it fails the whole artifact in the desktop app."""
        pat = re.compile(r"""(?:^|[\s;}])(?:import|export)\b[^'"`;]*?(?:from\s*)?['"](\.{1,2}/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}/[^'"]+)['"]""", re.M)
        os.makedirs(os.path.join(self.dir, "app", "mods"))
        for kind, d in (("recipe", self.recipe()), ("custom panel", self.panel())):
            with self.subTest(kind=kind):
                out = self.publish(d, custom=kind == "custom panel")
                mod = os.path.join(self.dir, "app", "mods", out["mod"])
                js = [os.path.join(r, n) for r, _, names in os.walk(mod) for n in names if n.endswith(".js")]
                self.assertIn("artifact-markup.js", [os.path.basename(f) for f in js])
                missing = []
                for f in js:
                    with open(f) as fh:
                        for m in pat.finditer(fh.read()):
                            target = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1) or m.group(2)))
                            if not os.path.isfile(target):
                                missing.append(f"{os.path.relpath(f, mod)} imports {m.group(1) or m.group(2)}")
                self.assertEqual(missing, [])

    def panel(self):
        d = os.path.join(self.dir, "panel")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "main.js"), "w") as f:
            f.write('export default class X {}\n')
        return d

    def test_waiting_on_another_publish_says_so(self):
        """#843: another publish in the same folder holds its list: this one says what it waits on, then goes on."""
        d = self.recipe()
        with A.Store(A.locate(self.folder)) as s:
            lock = os.path.join(A.STORE, "." + os.path.basename(s.path) + ".lock")
        held = open(lock, "a")
        fcntl.flock(held, fcntl.LOCK_EX)
        threading.Timer(0.5, lambda: (fcntl.flock(held, fcntl.LOCK_UN), held.close())).start()
        err = io.StringIO()
        with mock.patch("sys.stderr", err):
            out = self.publish(d)
        self.assertEqual(out["version"], 1)
        self.assertIn("Waiting for another herdr-artifact", err.getvalue())


if __name__ == "__main__":
    unittest.main()
