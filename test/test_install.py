"""The installer against scratch roots (--root): install, run again, update with a changed file,
clashes, --adopt, uninstall. Never touches the real home."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEPHERDR = os.path.join(ROOT, "bin", "shepherdr")
APP = ".config/herdr-app"


def run(*args, ok=True):
    p = subprocess.run([sys.executable, SHEPHERDR, *args], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if ok and p.returncode != 0:
        raise AssertionError(f"shepherdr {' '.join(args)} failed:\n{p.stdout}\n{p.stderr}")
    return p


def tree(top):
    out = {}
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if x != ".shepherdr-backup"]
        for f in files:
            p = os.path.join(d, f)
            with open(p, "rb") as fh:
                out[os.path.relpath(p, top)] = fh.read()
    return out


class Install(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="shepherdr-test-")
        os.makedirs(os.path.join(self.root, APP, "mods", "changes"))
        with open(os.path.join(self.root, APP, "mods", "changes", "main.js"), "w") as f:
            f.write("// Herdr's own mod\n")
        with open(os.path.join(self.root, APP, "keys.json"), "w") as f:
            json.dump({"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1"}}, f)
        os.makedirs(os.path.join(self.root, ".claude"))
        with open(os.path.join(self.root, ".claude", "settings.json"), "w") as f:
            json.dump({"model": "x"}, f)
        self.before = tree(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def p(self, *rel):
        return os.path.join(self.root, *rel)

    def test_install_again_update_uninstall(self):
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(out, r"files: \d+ new\n")
        rec = json.load(open(self.p(APP, "data/shepherdr/installed.json")))
        self.assertEqual(rec["version"], "3.0.0")
        self.assertTrue(os.path.isfile(self.p(APP, "mods/tasks/bin/herdr-task")))
        self.assertTrue(os.path.isfile(self.p(APP, "layouts/shepherdr.json")))
        self.assertEqual(os.path.realpath(self.p(".local/bin/herdr-task")), os.path.realpath(self.p(APP, "mods/tasks/bin/herdr-task")))
        # A key the person uses is kept (no terminal to ask in); free ones are added.
        keys = json.load(open(self.p(APP, "keys.json")))
        self.assertEqual(keys["global"]["ctrl-k"], "mine.open")
        self.assertEqual(keys["global"]["alt-1"], "space.select:1")
        self.assertEqual(keys["layout:shepherdr"]["f2"], "tabs-tasks.rename-tab")
        hooks = json.load(open(self.p(".claude/settings.json")))
        self.assertEqual(hooks["model"], "x")
        self.assertIn("ask-hook.sh", json.dumps(hooks["hooks"]["PermissionRequest"]))
        # Helpers changed: the sync to other machines is held until doctor passes.
        self.assertTrue(os.path.exists(self.p(".herdr/sync-hold")))
        d = run("doctor", "--root", self.root)
        self.assertIn("whole", d.stdout)
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))

        # Again: nothing changes, no hold.
        again = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(again, r"files: \d+ same\n", "a second run changes nothing")
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))

        # A file the person changed is kept, the new one goes beside it.
        mine = self.p(APP, "mods/toasts/main.js")
        with open(mine, "a") as f:
            f.write("// mine\n")
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            shutil.copytree(ROOT, os.path.join(src, "s"), ignore=shutil.ignore_patterns(".git"))
            s = os.path.join(src, "s")
            with open(os.path.join(s, "mods/toasts/main.js"), "a") as f:
                f.write("// release\n")
            with open(os.path.join(s, "mods/jump/main.js"), "a") as f:
                f.write("// release\n")
            up = run("update", "--root", self.root, "--source", s).stdout
            self.assertIn("1 keep", up)
            self.assertTrue(open(mine).read().endswith("// mine\n"))
            self.assertTrue(open(mine + ".new").read().endswith("// release\n"))
            self.assertTrue(open(self.p(APP, "mods/jump/main.js")).read().endswith("// release\n"))
        finally:
            shutil.rmtree(src)

        # Uninstall: everything back as it was, except the mod the person changed.
        run("uninstall", "--root", self.root)
        after = tree(self.root)
        left = sorted(set(after) - set(self.before))
        self.assertTrue(all(x.startswith(f"{APP}/mods/toasts/") for x in left), left)
        for k, v in self.before.items():
            if k.endswith(".json"):
                self.assertEqual(json.loads(after[k]), json.loads(v), k)
            else:
                self.assertEqual(after[k], v, k)
        self.assertFalse(os.path.lexists(self.p(".local/bin/herdr-task")))

    def test_clash_refuses_then_adopt(self):
        own = self.p(APP, "mods/jump")
        os.makedirs(own)
        with open(os.path.join(own, "main.js"), "w") as f:
            f.write("// someone's own jump\n")
        p = run("install", "--root", self.root, "--yes", ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("mods/jump/main.js", p.stderr)
        self.assertFalse(os.path.exists(self.p(APP, "mods/tasks")), "nothing is written on a clash")
        run("install", "--root", self.root, "--yes", "--adopt")
        backups = os.listdir(self.p(APP, ".shepherdr-backup"))
        self.assertEqual(len(backups), 1)
        saved = self.p(APP, ".shepherdr-backup", backups[0], APP, "mods/jump/main.js")
        self.assertEqual(open(saved).read(), "// someone's own jump\n")
        run("uninstall", "--root", self.root)
        self.assertEqual(open(self.p(APP, "mods/jump/main.js")).read(), "// someone's own jump\n")

    def test_fresh_root(self):
        # A brand-new home: no Herdr folder, no mods/, no .local/bin yet.
        root = tempfile.mkdtemp(prefix="shepherdr-fresh-")
        try:
            run("install", "--root", root, "--yes")
            self.assertTrue(os.path.isfile(os.path.join(root, APP, "mods/tasks/mod.json")))
            self.assertTrue(os.path.islink(os.path.join(root, ".local/bin/shepherdr")))
            self.assertIn("whole", run("doctor", "--root", root).stdout)
            run("uninstall", "--root", root)
            self.assertFalse(os.path.exists(os.path.join(root, APP, "mods/tasks")))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_dry_run_writes_nothing(self):
        run("install", "--root", self.root, "--dry-run")
        self.assertEqual(tree(self.root), self.before)


if __name__ == "__main__":
    unittest.main()
