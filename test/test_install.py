"""The installer against scratch roots (--root): install, run again, update with a changed file, the switch from a
3.1 Herdr-window install, uninstall. Never touches the real home."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import contextlib
import io
import re
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock
import fake_ab
from importlib.machinery import SourceFileLoader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEPHERDR = os.path.join(ROOT, "bin", "shepherdr")
APP = ".config/herdr-app"
SHARE = ".local/share/shepherdr"
RECORD = f"{SHARE}/installed.json"
OLD_RECORD = f"{APP}/data/shepherdr/installed.json"
CI = os.environ.get("CI") == "true"
UNIT = "Library/LaunchAgents/dev.shepherdr.service.plist" if sys.platform == "darwin" else ".config/systemd/user/shepherdr.service"
WINDOW_31 = SourceFileLoader("window_3_1_46", os.path.join(ROOT, "test", "fixtures", "window-3.1.46.py")).load_module()


def installer():
    return SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()


def run(*args, ok=True, build=False):
    # the web app is built by its own test (a fresh clone); the others install this checkout's as it is
    if args and args[0] in ("install", "update") and not build:
        args = (*args, "--no-build")
    p = subprocess.run([sys.executable, SHEPHERDR, *args], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if ok and p.returncode != 0:
        raise AssertionError(f"shepherdr {' '.join(args)} failed:\n{p.stdout}\n{p.stderr}")
    return p


def tree(top):
    out = {}
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if x != ".shepherdr-backup"]
        for f in files + [x for x in dirs if os.path.islink(os.path.join(d, x))]:
            p = os.path.join(d, f)
            if os.path.islink(p):
                out[os.path.relpath(p, top)] = b"-> " + os.readlink(p).encode()
                continue
            with open(p, "rb") as fh:
                out[os.path.relpath(p, top)] = fh.read()
    return out


def copy_source(dest):
    """This checkout as another source folder (a release to come, or one gone by)."""
    shutil.copytree(ROOT, dest, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__"))
    return dest


def assert_notices(t, root, names):
    """Each of 3.1's window views named is its notice (herdr/window-notice): the main chat says where Shepherdr went,
    the rest draw nothing; none of 3.1's code is left in it."""
    for name in names:
        top = os.path.join(root, APP, "mods", name)
        t.assertEqual(sorted(os.listdir(top)), ["main.js", "mod.json", "notice.js"], name)
        t.assertEqual(open(os.path.join(top, "notice.js")).read(), open(os.path.join(ROOT, "herdr/window-notice/notice.js")).read())
        t.assertEqual(open(os.path.join(top, "main.js")).read(),
                      open(os.path.join(ROOT, "herdr/window-notice", "full.js" if name == "chat" else "blank.js")).read(), name)
        t.assertEqual(json.load(open(os.path.join(top, "mod.json")))["place"], "none")


# Shepherdr's own data (layout.py): an install makes its folders and the old paths' links; uninstall leaves the data.
DATA_PLACES = (".config/shepherdr/", ".local/share/shepherdr/", ".local/state/shepherdr/", ".cache/shepherdr/", ".herdr/")


class Install(unittest.TestCase):
    """One kind of install (3.2): everything under .local/share/shepherdr, helper links in .local/bin, the role
    instructions, the agents' hooks; in a Herdr app, only the Open Shepherdr button and its one key."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="shepherdr-test-")
        # a home with the Herdr app, a mod and keys of the person's own, and Claude Code
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
        os.makedirs(self.p(".codex"))
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(out, r"files: \d+ new\n")
        rec = json.load(open(self.p(RECORD)))
        self.assertEqual(rec["version"], "3.2.18")
        self.assertFalse(os.path.exists(self.p(OLD_RECORD)), "no record in the Herdr app any more")
        self.assertTrue(os.path.isfile(self.p(SHARE, "mods/tasks/bin/herdr-task")))
        self.assertEqual(os.path.realpath(self.p(".local/bin/herdr-task")), os.path.realpath(self.p(SHARE, "mods/tasks/bin/herdr-task")))
        # the agents' browser and desktop (Screens): shipped in bin/, linked on the PATH, runnable
        for name in ("herdr-browser", "herdr-desktop"):
            self.assertTrue(os.access(self.p(SHARE, "bin", name), os.X_OK), name)
            self.assertEqual(os.path.realpath(self.p(".local/bin", name)), os.path.realpath(self.p(SHARE, "bin", name)))
            self.assertIn(f"{SHARE}/bin/{name}", rec["files"])
        # In the Herdr app: the one button and nothing else of Shepherdr's (no layout, no lib/, core/, bin/).
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), ["changes", "open-shepherdr"])
        self.assertEqual(sorted(os.listdir(self.p(APP))), ["keys.json", "mods"])
        # Its one key goes in because it was free; the person's keys stay as they were.
        keys = json.load(open(self.p(APP, "keys.json")))
        self.assertEqual(keys, {"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1", "ctrl-shift-o": "mod.open:open-shepherdr"}})
        self.assertEqual(rec["keys"], {"global ctrl-shift-o": {"value": "mod.open:open-shepherdr", "was": None, "added": True}})
        # The agents' hooks run from Shepherdr's own folder.
        hooks = json.load(open(self.p(".claude/settings.json")))
        self.assertEqual(hooks["model"], "x")
        self.assertEqual(hooks["hooks"]["PermissionRequest"][0]["hooks"][0]["command"], f"sh '{self.p(SHARE)}/hooks/ask-hook.sh'")
        self.assertEqual(hooks["hooks"]["SessionStart"][0]["hooks"][0]["command"], f"sh '{self.p(SHARE)}/hooks/session-note.sh'")
        for f in ("ask-hook.sh", "ask-end.py", "session-note.sh"):
            self.assertTrue(os.path.isfile(self.p(SHARE, "hooks", f)), f)
        # Codex's approvals come to the chat's card too (SHEP-91)
        codex = json.load(open(self.p(".codex/hooks.json")))
        self.assertIn("/hooks/ask-hook.sh", json.dumps(codex["hooks"]["PermissionRequest"]))
        # Helpers changed: the sync to other machines is held until doctor passes.
        self.assertTrue(os.path.exists(self.p(".herdr/sync-hold")))
        d = run("doctor", "--root", self.root)
        self.assertIn("whole", d.stdout)
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))

        # Again: nothing changes, no hold, no second hook.
        again = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(again, r"files: \d+ same\n", "a second run changes nothing")
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))
        self.assertEqual(json.load(open(self.p(".claude/settings.json"))), hooks)

        # A role instruction the person changed is kept, with the new one beside it; a file changed inside Shepherdr's
        # own folder is replaced (that folder is replaced whole), the changed copy backed up and said.
        tpl = self.p(".config/herdr-core/templates/worker.md")
        with open(tpl, "a") as f:
            f.write("mine\n")
        own = self.p(SHARE, "hooks/session-note.sh")
        with open(own, "a") as f:
            f.write("# mine\n")
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            s = copy_source(os.path.join(src, "s"))
            for f_ in ("templates/worker.md", "hooks/session-note.sh", "herdr/open-shepherdr/main.js"):
                with open(os.path.join(s, f_), "a") as f:
                    f.write("# release\n" if not f_.endswith(".js") else "// release\n")
            up = run("update", "--root", self.root, "--source", s).stdout
            self.assertTrue(open(tpl).read().endswith("mine\n"))
            self.assertTrue(open(tpl + ".new").read().endswith("release\n"))
            self.assertTrue(open(own).read().endswith("# release\n"))
            backup = re.search(r"replaced \.local/share/shepherdr/hooks/session-note\.sh.*kept as (\S+)", up).group(1)
            self.assertTrue(open(backup).read().endswith("# mine\n"), "the changed copy is in the backup")
            self.assertTrue(open(self.p(APP, "mods/open-shepherdr/main.js")).read().endswith("// release\n"))
            d = run("doctor", "--root", self.root, ok=False).stdout
            self.assertIn("worker.md.new: merge it in", d)
        finally:
            shutil.rmtree(src)

        # Uninstall: everything back as it was, except the role instruction the person changed.
        run("uninstall", "--root", self.root)
        after = tree(self.root)
        left = sorted(set(after) - set(self.before))
        self.assertTrue(all(x == ".config/herdr-core/templates/worker.md" or x.startswith(DATA_PLACES) for x in left), left)
        for k, v in self.before.items():
            if k.endswith(".json"):
                self.assertEqual(json.loads(after[k]), json.loads(v), k)
            else:
                self.assertEqual(after[k], v, k)
        for name in ("herdr-task", "herdr-browser", "herdr-desktop"):
            self.assertFalse(os.path.lexists(self.p(".local/bin", name)), name)
        self.assertFalse(os.path.exists(self.p(SHARE, "bin/herdr-desktop")))
        self.assertFalse(os.path.exists(self.p(APP, "mods/open-shepherdr")))
        self.assertFalse(os.path.exists(self.p(".codex/hooks.json")), "a hooks file it made goes with its hooks")
        self.assertFalse(os.path.exists(self.p(SHARE, "service")))

    def test_no_herdr_app_no_button(self):
        """The Herdr app is optional: a home without it gets no folder there (not even for backups), and the hook's
        own data folder (data/chat-asks, on every machine) doesn't count as the app."""
        root = tempfile.mkdtemp(prefix="shepherdr-fresh-")
        try:
            os.makedirs(os.path.join(root, APP, "data", "chat-asks"))
            out = run("install", "--root", root, "--yes").stdout
            self.assertEqual(os.listdir(os.path.join(root, APP)), ["data"])
            self.assertNotIn("Ctrl+Shift+O", out)
            rec = json.load(open(os.path.join(root, RECORD)))
            self.assertFalse(rec["button"])
            self.assertFalse(rec.get("keys"))
            self.assertTrue(os.path.isfile(os.path.join(root, SHARE, "herdr/open-shepherdr/main.js")), "kept in the source for a machine that has Herdr")
            self.assertTrue(os.path.islink(os.path.join(root, ".local/bin/shepherdr")))
            self.assertIn("whole", run("doctor", "--root", root).stdout)
            run("uninstall", "--root", root)
            self.assertFalse(os.path.exists(os.path.join(root, SHARE, "service")))
            self.assertFalse(os.path.lexists(os.path.join(root, ".local/bin/herdr-task")))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_the_button_never_takes_a_key_or_a_mod_that_is_someone_elses(self):
        """Ctrl+Shift+O is only added when free; a mod already named open-shepherdr that isn't ours is left alone
        (no button, no key) unless --adopt, which backs it up; uninstall puts it back."""
        with open(self.p(APP, "keys.json"), "w") as f:
            json.dump({"global": {"ctrl-shift-o": "mine.other"}}, f)
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {"global": {"ctrl-shift-o": "mine.other"}})
        self.assertIn('kept your key ctrl-shift-o = "mine.other"', out)
        self.assertTrue(os.path.isfile(self.p(APP, "mods/open-shepherdr/main.js")), "the button is there, opened with a key of their own")
        self.assertEqual(json.load(open(self.p(RECORD)))["keys"], {})
        run("uninstall", "--root", self.root)
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {"global": {"ctrl-shift-o": "mine.other"}})
        # someone else's mod by the button's name
        os.makedirs(self.p(APP, "mods/open-shepherdr"))
        with open(self.p(APP, "mods/open-shepherdr/main.js"), "w") as f:
            f.write("// someone's own\n")
        with open(self.p(APP, "keys.json"), "w") as f:
            json.dump({}, f)
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertIn("mods/open-shepherdr isn't Shepherdr's: left alone", out)
        self.assertEqual(open(self.p(APP, "mods/open-shepherdr/main.js")).read(), "// someone's own\n")
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {})
        self.assertIn("whole", run("doctor", "--root", self.root).stdout)
        run("install", "--root", self.root, "--yes", "--adopt")
        self.assertIn("Open Shepherdr", open(self.p(APP, "mods/open-shepherdr/main.js")).read())
        self.assertEqual(json.load(open(self.p(APP, "keys.json")))["global"]["ctrl-shift-o"], "mod.open:open-shepherdr")
        run("uninstall", "--root", self.root)
        self.assertEqual(open(self.p(APP, "mods/open-shepherdr/main.js")).read(), "// someone's own\n")
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {})

    def test_no_hooks(self):
        out = run("install", "--root", self.root, "--yes", "--no-hooks").stdout
        self.assertEqual(json.load(open(self.p(".claude/settings.json"))), {"model": "x"})
        self.assertEqual(json.load(open(self.p(RECORD)))["hooks"], [])
        self.assertNotIn("hook", run("doctor", "--root", self.root).stdout)
        self.assertIn("done.", out)

    def test_web_flag_is_the_same_install(self):
        """`--web` (3.1's web-only install) is still accepted: every install is that one now."""
        out = run("install", "--web", "--root", self.root, "--yes").stdout
        self.assertNotIn("web-only", out)
        self.assertTrue(os.path.isfile(self.p(APP, "mods/open-shepherdr/mod.json")))
        self.assertIn("whole", run("doctor", "--root", self.root).stdout)
        self.assertRegex(run("update", "--web", "--root", self.root, "--yes", "--source", ROOT).stdout, r"files: \d+ same\n")

    def test_install_moves_the_data_into_shepherdrs_own_folders(self):
        """SHEP-141: an install over a 3.1.26 home moves ~/.herdr's Shepherdr data into its own folders in one go, says
        so in one line, leaves links at the old paths, and doctor and where say where it all is. Again: nothing more."""
        h = self.p(".herdr")
        os.makedirs(os.path.join(h, "tasks"))
        with open(os.path.join(h, "tasks", "dev-shop.json"), "w") as f:
            json.dump({"folder": "/x", "tasks": [], "prefix": "SHOP"}, f)
        with open(os.path.join(h, "shepherdr.json"), "w") as f:
            json.dump({"version": 1, "everywhere": {}}, f)
        os.makedirs(os.path.join(h, "worktrees", "shop", "task-1"))
        dry = run("install", "--root", self.root, "--yes", "--dry-run").stdout
        self.assertIn("data: would move", dry)
        self.assertFalse(os.path.exists(self.p(".local/share/shepherdr/tasks")))
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertIn("Shepherdr's data moved to its own folders", out)
        self.assertTrue(os.path.isfile(self.p(".local/share/shepherdr/tasks/dev-shop.json")))
        self.assertTrue(os.path.isfile(self.p(".config/shepherdr/settings.json")))
        self.assertTrue(os.path.islink(os.path.join(h, "tasks")))
        self.assertTrue(os.path.isdir(os.path.join(h, "worktrees", "shop", "task-1")), "worktrees stay")
        where = run("where", "--root", self.root).stdout
        self.assertIn("layout 2", where)
        self.assertIn(self.p(".local/share/shepherdr/tasks"), where)
        doc = run("doctor", "--root", self.root, ok=False).stdout
        self.assertIn("data: Shepherdr's own folders (layout 2)", doc)
        self.assertIn("worktrees: 1 still in", doc)
        self.assertNotIn("Shepherdr's data moved", run("update", "--root", self.root, "--yes", "--source", ROOT).stdout)
        # rollback, then the next update leaves it on ~/.herdr until `shepherdr migrate`
        back = run("migrate", "--root", self.root, "--rollback").stdout
        self.assertIn("back in ~/.herdr", back)
        self.assertFalse(os.path.islink(os.path.join(h, "tasks")))
        self.assertIn("rolled back", run("doctor", "--root", self.root, ok=False).stdout)
        self.assertTrue(os.path.isdir(os.path.join(h, "tasks")) and not os.path.islink(os.path.join(h, "tasks")))
        run("migrate", "--root", self.root)
        self.assertTrue(os.path.islink(os.path.join(h, "tasks")))

    def test_service_unit_and_files(self):
        """The service and the shared core land in .local/share/shepherdr; a scratch root gets the unit file only
        (nothing is started), and uninstall takes both away. Nothing of the window or the recipe viewer is shipped."""
        out = run("install", "--root", self.root, "--yes").stdout
        if "needs bun" in out:
            self.skipTest("bun isn't installed here")
        share = self.p(SHARE)
        self.assertTrue(os.path.isfile(os.path.join(share, "service/main.ts")))
        self.assertFalse(any(f.endswith(".test.ts") for f in os.listdir(os.path.join(share, "service"))))
        rec = json.load(open(self.p(RECORD)))
        for gone in ("lib/addons.json", "mods/artifacts/recipe-view.js", "mods/artifacts/markup.js", "mods/artifacts/core/recipe.js",
                     "mods/coordinator/restart.sh", "web/dist/artifact-viewer.html", "keys.json", "layouts/shepherdr.json"):
            self.assertNotIn(f"{SHARE}/{gone}", rec["files"], gone)
        self.assertFalse([f for f in rec["files"] if f.startswith(f"{SHARE}/mods/") and "/bin/" not in f
                          and f != f"{SHARE}/mods/artifacts/ARTIFACTS.md"], "of mods/, only the helpers' bin folders and the artifact guide")
        # every relative import the installed service runs resolves inside what was installed (bun can start it)
        for d, _, files in os.walk(share):
            if "/web/dist" in d or "/mods/" in d or "/herdr/" in d:
                continue
            for f in files:
                if not f.endswith((".ts", ".js")):
                    continue
                for m in re.finditer(r'^import (?!type )[^;]*?from ["\'](\.{1,2}/[^"\']+)["\']', open(os.path.join(d, f)).read(), re.M):
                    self.assertTrue(os.path.isfile(os.path.normpath(os.path.join(d, m.group(1)))), f"{os.path.relpath(os.path.join(d, f), share)} imports {m.group(1)}, not installed")
        text = open(self.p(UNIT)).read()
        self.assertIn(self.p(".local/share/shepherdr/service/main.ts"), text)
        self.assertNotIn("funnel", text)
        run("uninstall", "--root", self.root)
        self.assertFalse(os.path.exists(self.p(UNIT)))
        self.assertFalse(os.path.exists(self.p(".local/share/shepherdr/service/main.ts")))

    def test_helpers_run_from_shepherdrs_folder(self):
        """herdr-task and herdr-artifact run from where the links lead, the artifact guide comes along (#735), and the
        installed folder's own sync-shared finds layout.py beside it (doctor runs it)."""
        run("install", "--root", self.root, "--yes")
        share = self.p(SHARE)
        env = {**os.environ, "HOME": self.root}
        p = subprocess.run([sys.executable, os.path.join(share, "mods/tasks/bin/herdr-task"), "--help"], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        p = subprocess.run([sys.executable, os.path.join(share, "mods/artifacts/bin/herdr-artifact"), "guide"], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(p.stdout.strip())
        p = subprocess.run([sys.executable, os.path.join(share, "bin/sync-shared"), "--check"], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_port(self):
        """install --port (GitHub #635): the unit starts the service on it, the record keeps it for updates, 7788 puts the
        default back; a port out of range is refused."""
        unit = self.p(UNIT)
        out = run("install", "--root", self.root, "--yes", "--port", "7795").stdout
        if "needs bun" in out:
            self.skipTest("bun isn't installed here")
        self.assertIn("7795", open(unit).read())
        self.assertIn("SHEPHERDR_PORT", open(unit).read())
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        self.assertIn("7795", open(unit).read(), "an update keeps the port")
        run("install", "--root", self.root, "--yes", "--port", "7788")
        self.assertNotIn("SHEPHERDR_PORT", open(unit).read())
        p = run("install", "--root", self.root, "--yes", "--port", "80", ok=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("1024", p.stdout + p.stderr)

    def test_https_port(self):
        """install --https-port (GitHub #778): kept in the service's folder, which updates leave alone; 443 puts the
        default back; a port out of range is refused."""
        sh = installer()
        self.assertEqual(sh.https_port(self.root), 443, "an install that never set one stays on 443")
        out = run("install", "--root", self.root, "--yes", "--https-port", "8443").stdout
        if "needs bun" in out:
            self.skipTest("bun isn't installed here")
        f = sh.service_file(self.root, "https-port")
        self.assertEqual(open(f).read().strip(), "8443")
        self.assertEqual(sh.https_port(self.root), 8443)
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        self.assertEqual(sh.https_port(self.root), 8443, "an update keeps the HTTPS port")
        run("install", "--root", self.root, "--yes", "--https-port", "443")
        self.assertFalse(os.path.exists(f))
        p = run("install", "--root", self.root, "--yes", "--https-port", "70000", ok=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("65535", p.stdout + p.stderr)

    def test_update_retires_what_shepherdr_no_longer_ships(self):
        """#895: an older release shipped a helper and a role instruction that the next one drops. The update removes
        them (and the folder one leaves empty); what the person changed in them is in the backup, and said. Doctor
        passes and the record forgets them."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            old = copy_source(os.path.join(src, "old"))
            with open(os.path.join(old, "bin", "old-tool"), "w") as f:
                f.write("#!/bin/sh\necho old\n")
            os.chmod(os.path.join(old, "bin", "old-tool"), 0o755)
            os.makedirs(os.path.join(old, "hooks", "older"))
            with open(os.path.join(old, "hooks", "older", "gone.sh"), "w") as f:
                f.write("#!/bin/sh\n")
            with open(os.path.join(old, "templates", "retired.md"), "w") as f:
                f.write("# retired\n")
            run("install", "--root", self.root, "--source", old, "--yes")
            tool, tpl = self.p(SHARE, "bin/old-tool"), self.p(".config/herdr-core/templates/retired.md")
            self.assertTrue(os.path.isfile(tool))
            self.assertTrue(os.path.isfile(self.p(SHARE, "hooks/older/gone.sh")))
            for path, words in ((tool, "echo mine\n"), (tpl, "mine\n")):
                with open(path, "a") as f:
                    f.write(words)
            # the next release: ROOT (this checkout) no longer ships any of them
            up = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
            self.assertFalse(os.path.exists(tool), "the retired helper is gone")
            self.assertFalse(os.path.exists(tpl))
            self.assertFalse(os.path.exists(self.p(SHARE, "hooks/older")), "and the folder a retired file left empty")
            backup = re.search(r"removed \.local/share/shepherdr/bin/old-tool: Shepherdr no longer ships it; your changed copy is in (\S+)", up).group(1)
            with open(backup) as f:
                self.assertTrue(f.read().endswith("echo mine\n"), "the person's change is in the backup")
            backup = re.search(r"templates/retired\.md: Shepherdr no longer ships it; your changed copy is in (\S+)", up).group(1)
            with open(backup) as f:
                self.assertTrue(f.read().endswith("mine\n"))
            rec = json.load(open(self.p(RECORD)))
            self.assertFalse([k for k in rec["files"] if "retired" in k or k.endswith(("old-tool", "gone.sh"))], "the record forgets them")
            d = run("doctor", "--root", self.root).stdout
            self.assertNotIn("✗", d)
            self.assertNotIn("changed since install", d)
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_update_says_loudly_when_the_install_is_not_whole(self):
        """An update that goes in but leaves doctor failing says so at its end, with the ✗ lines and no 'done' (#905):
        here a helper whose SHEP block isn't layout.py's."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            s = copy_source(os.path.join(src, "s"))
            helper = os.path.join(s, "bin", "herdr-secret")
            text = open(helper).read()
            a = text.index("# ---- SHEP:")
            b = text.index("\n", text.index("# ---- end SHEP ----")) + 1
            with open(helper, "w") as f:
                f.write(text[:a] + text[b:])
            up = run("install", "--root", self.root, "--yes", "--source", s).stdout
            self.assertIn("✗ the helpers' paths differ: ", up)
            self.assertIn("bin/herdr-secret has no SHEP block", up)
            self.assertIn("NOT DONE: the install isn't whole", up)
            self.assertNotIn("  done. Next:", up)
            self.assertIn("has no SHEP block", run("doctor", "--root", self.root, ok=False).stdout)
            self.assertTrue(os.path.exists(self.p(".herdr/sync-hold")), "the sync stays held")
            # the fixed release goes in over it, and doctor passes
            up = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
            self.assertIn("  done. Next:", up)
            self.assertNotIn("✗", run("doctor", "--root", self.root).stdout)
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_written_instructions_are_kept_in_a_plain_file_once(self):
        """SHEP-319: Settings › Instructions is gone. The update moves what was written (everywhere and each space's)
        into a plain file beside the settings and says so once; a second run loses nothing and says nothing; settings
        without any get no file; a dry run writes nothing."""
        sh = installer()
        path = sh.where_for(self.root).path("settings")
        out = os.path.join(os.path.dirname(path), sh.OLD_INSTRUCTIONS)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        old = {"everywhere": {"instructions": "Write British English.", "tasks": {"merge": "checks"}},
               "spaces": {"sp1": {"name": "shop", "folder": "/work/shop", "instructions": "This shop sells tea."},
                          "sp2": {"name": "blog", "instructions": "  "}, "sp3": {"name": "docs", "tasks": {"proof": False}}}}
        with open(path, "w") as f:
            json.dump(old, f)
        dry, live = mock.Mock(dry_run=True), mock.Mock(dry_run=False)
        r = sh.Run(self.root, True)
        with contextlib.redirect_stdout(io.StringIO()) as said:
            sh.keep_instructions(r, dry, self.root)
        self.assertIn("would keep", said.getvalue())
        self.assertFalse(os.path.exists(out))
        with open(path) as f:
            self.assertEqual(json.load(f), old)
        r = sh.Run(self.root, False)
        sh.keep_instructions(r, live, self.root)
        with open(out) as f:
            kept = f.read()
        self.assertIn("## Every space\n\nWrite British English.\n", kept)
        self.assertIn("## shop (/work/shop)\n\nThis shop sells tea.\n", kept)
        self.assertNotIn("blog", kept)
        self.assertIn("AGENTS.md", kept)
        self.assertEqual(len([n for n in r.notes if sh.OLD_INSTRUCTIONS in n]), 1)
        with open(path) as f:
            now = json.load(f)
        self.assertNotIn("instructions", json.dumps(now))
        self.assertEqual(now["everywhere"], {"tasks": {"merge": "checks"}})
        self.assertEqual(now["spaces"]["sp3"], old["spaces"]["sp3"])
        # a second run: nothing lost, nothing said
        r = sh.Run(self.root, False)
        sh.keep_instructions(r, live, self.root)
        self.assertEqual(r.notes, [])
        with open(out) as f:
            self.assertEqual(f.read(), kept)
        # another copy of the settings still holding them later (a linked machine's): the same words aren't written
        # twice; different ones are added after what was kept
        with open(path, "w") as f:
            json.dump({"everywhere": {"instructions": "Write British English."}}, f)
        sh.keep_instructions(sh.Run(self.root, False), live, self.root)
        with open(out) as f:
            self.assertEqual(f.read(), kept)
        with open(path, "w") as f:
            json.dump({"everywhere": {"instructions": "Write American English."}}, f)
        sh.keep_instructions(sh.Run(self.root, False), live, self.root)
        with open(out) as f:
            again = f.read()
        self.assertTrue(again.startswith(kept.rstrip("\n")))
        self.assertIn("Write British English.", again)
        self.assertIn("Write American English.", again)
        sh.keep_instructions(sh.Run(self.root, False), live, self.root)
        with open(out) as f:
            self.assertEqual(f.read(), again)

    def test_space_task_settings_move_to_the_repos_their_tasks_work_in(self):
        """SHEP-335: the update moves each space's task settings to settings.json "repos": a space on a repo to that
        repo; root (on /), whose tasks work in the shop repo, to the shop repo, said once with what and where; two
        spaces on one repo that disagree: the one with more tasks there keeps it, the other said. A dry run writes
        nothing; a second run changes and says nothing; the spaces keep what is about themselves."""
        sh = installer()
        w = sh.where_for(self.root)
        path = w.path("settings")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        os.makedirs(w.path("tasks"), exist_ok=True)
        shop = os.path.join(self.root, "dev", "shop")
        os.makedirs(shop)
        subprocess.run(["git", "-C", shop, "init", "-q"], check=True)
        shop = os.path.realpath(shop)
        blog = os.path.realpath(os.path.join(self.root, "dev"))
        old = {"everywhere": {"tasks": {"merge": "checks"}},
               "spaces": {"sproot": {"folder": "/", "name": "root", "tasks": {"merge": "auto"}},
                          "spshop": {"folder": os.path.join(shop, "src"), "name": "shop", "worker": {"agent": "codex", "model": "gpt-5"},
                                     "coordinator": {"agent": "claude"}, "tasks": {"proof": False}},
                          "spshop2": {"folder": shop, "name": "shop-two", "tasks": {"proof": True, "review_rounds": 2}},
                          "spblog": {"folder": blog, "name": "blog", "agents": {"reactions": False}},
                          "vmb/sp9": {"folder": "/home/x/web", "name": "web", "tasks": {"base": "dev"}}}}
        os.makedirs(os.path.join(shop, "src"))
        with open(path, "w") as f:
            json.dump(old, f)
        with open(os.path.join(w.path("tasks"), "shop.json"), "w") as f:
            json.dump({"folder": shop, "tasks": [{"id": 1, "space": "sproot"}, {"id": 2, "space": "spshop"}, {"id": 3, "space": "spshop"},
                                                 {"id": 4, "space": "spshop2"}]}, f)
        dry, live = mock.Mock(dry_run=True), mock.Mock(dry_run=False)
        with contextlib.redirect_stdout(io.StringIO()) as said:
            sh.move_repo_settings(sh.Run(self.root, True), dry, self.root)
        self.assertIn("would move", said.getvalue())
        with open(path) as f:
            self.assertEqual(json.load(f), old)
        r = sh.Run(self.root, False)
        sh.move_repo_settings(r, live, self.root)
        with open(path) as f:
            now = json.load(f)
        self.assertEqual(now["repos"][shop], {"worker": {"agent": "codex", "model": "gpt-5"}, "tasks": {"proof": False, "review_rounds": 2, "merge": "auto"}})
        self.assertEqual(now["repos"]["vmb:/home/x/web"], {"tasks": {"base": "dev"}})
        self.assertEqual(now["spaces"]["sproot"], {"folder": "/", "name": "root"})
        self.assertEqual(now["spaces"]["spshop"], {"folder": os.path.join(shop, "src"), "name": "shop", "coordinator": {"agent": "claude"}})
        self.assertEqual(now["spaces"]["spblog"], old["spaces"]["spblog"])
        self.assertEqual(now["everywhere"], old["everywhere"])
        said = "\n".join(r.notes)
        self.assertIn('root\'s Merge "Right away" now applies to ~/dev/shop, where its tasks work', said)
        self.assertIn("shop-two's Proof on didn't move to ~/dev/shop: another space there set it differently", said)
        self.assertNotIn("Tasks run on codex", said)  # a space on its own repo moves without a word
        moved = os.path.join(os.path.dirname(os.path.realpath(path)), sh.SETTINGS_MOVED)
        with open(moved) as f:
            kept = f.read()
        self.assertIn('- root: Merge "Right away" → ~/dev/shop', kept)
        self.assertIn("- shop: Proof off, Tasks run on codex gpt-5 → ~/dev/shop", kept)
        self.assertIn("- web: Base branch dev → vmb:/home/x/web", kept)
        r = sh.Run(self.root, False)
        sh.move_repo_settings(r, live, self.root)
        self.assertEqual(r.notes, [])
        with open(moved) as f:
            self.assertEqual(f.read(), kept)
        # herdr-task reads the moved file: root's task in the shop repo merges right away
        sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
        from herdr_task import settings as hs
        with mock.patch.object(hs, "SETTINGS", path):
            store = types.SimpleNamespace(loc={"folder": shop, "kind": "repo"})
            self.assertEqual(hs.merge_policy(store, {"space": "sproot"}), "auto")

    def test_no_instructions_no_file(self):
        sh = installer()
        path = sh.where_for(self.root).path("settings")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"everywhere": {"tasks": {"merge": "checks"}}}, f)
        before = os.stat(path).st_mtime_ns
        r = sh.Run(self.root, False)
        sh.keep_instructions(r, mock.Mock(dry_run=False), self.root)
        self.assertEqual((r.notes, os.stat(path).st_mtime_ns), ([], before))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(path), sh.OLD_INSTRUCTIONS)))
        sh.keep_instructions(sh.Run(self.root, False), mock.Mock(dry_run=False), os.path.join(self.root, "nowhere"))  # no file: fine

    def test_doctor_says_why_not_shared(self):
        """doctor (GitHub #754): when tailscale serve refused the share, it's broken (not a note), in tailscale's own
        words with another port to use; a custom port is named."""
        sh = installer()
        web = sh.service_file(self.root, "web.json")
        os.makedirs(os.path.dirname(web), exist_ok=True)
        why = "Port 443 on this machine's tailnet name is taken (a TCP forward to 127.0.0.1:9000). Pick another port: `shepherdr web https-port 8443`."
        with open(web, "w") as f:
            json.dump({"on": True, "link": "https://box.tailnet.example/shepherdr/", "why": why, "share_error": why, "https_port": 443,
                       "serve": {"host": None, "reachable": True}}, f)
        bad, notes = sh.serve_check(self.root)
        self.assertEqual(len(bad), 1)
        self.assertIn("TCP forward to 127.0.0.1:9000", bad[0])
        self.assertIn("shepherdr web https-port 8443", bad[0])
        self.assertFalse(any("taken" in n for n in notes), "said once, as broken")
        with open(web, "w") as f:
            json.dump({"on": True, "link": "https://box.tailnet.example:8443/shepherdr/", "why": None, "share_error": None, "https_port": 8443,
                       "serve": {"host": None, "reachable": True}}, f)
        bad, notes = sh.serve_check(self.root)
        self.assertEqual(bad, [])
        self.assertIn("https://box.tailnet.example:8443/shepherdr/", " ".join(notes))
        self.assertIn("port 8443", " ".join(notes))

    def test_doctor_warns_when_github_checks_cant_be_read(self):
        """SHEP-179: a repo with tasks whose checks this machine's GitHub token can't read gets a warning naming the
        permissions to add; one it can read, or a list without tasks, gets none."""
        from unittest import mock
        sh = installer()
        folder = sh.where_for(self.root).path("tasks")
        os.makedirs(folder, exist_ok=True)
        for slug, repo, tasks in (("a", "o/locked", [{"id": 1}]), ("b", "o/open", [{"id": 1}]), ("c", "o/empty", [])):
            with open(os.path.join(folder, f"{slug}.json"), "w") as f:
                json.dump({"github": {"repo": repo, "at": 1}, "tasks": tasks}, f)
        gh = os.path.join(self.root, "fake-gh")
        with open(gh, "w") as f:
            f.write("#!/bin/sh\ncase \"$2\" in\n  repos/o/locked/*check-runs*) echo 'gh: Resource not accessible by personal access token (HTTP 403)' >&2; exit 1;;\n"
                    "  *) echo '{}';;\nesac\n")
        os.chmod(gh, 0o755)
        with mock.patch.dict(os.environ, {"HERDR_TASK_GH": gh}):
            out = sh.github_checks_check(self.root)
        self.assertEqual(len(out), 1, out)
        self.assertIn("o/locked", out[0])
        self.assertIn("Checks: read", out[0])
        self.assertNotIn("Commit statuses", out[0])

    def test_the_herdr_app_is_optional_and_hc_is_not(self):
        """3.2 needs herdr-core (hc) and git; the Herdr app is never asked for, and the window's own tools (node, the
        mic and speaker programs) are no longer named."""
        from unittest import mock
        sh = installer()
        with mock.patch.object(sh.shutil, "which", lambda n: None):
            bad, notes = sh.check_tools(True)
            scratch_bad, scratch_notes = sh.check_tools(False)
        self.assertTrue(any("herdr-core (hc" in x for x in bad), bad)
        self.assertTrue(any("git" in x for x in bad), bad)
        self.assertTrue(any("herdr-core (hc" in x for x in scratch_notes), "a scratch root only notes it")
        self.assertFalse(any("hc" in x for x in scratch_bad))
        words = "\n".join(bad + notes + scratch_notes)
        for gone in ("herdr-app", "pw-record", "pw-play", "swiftc", "node"):
            self.assertNotIn(gone, words)

    def test_worktrees_folder_gets_a_plain_package_json(self):
        """#1132: our package.json (type: module) sits above the task worktrees: an install puts a plain one in that
        folder so a worktree's repo with none of its own runs as CommonJS, as in its main checkout."""
        wt = self.p(".local/share/shepherdr/worktrees")
        os.makedirs(os.path.join(wt, "repo", "task-1"))
        run("install", "--root", self.root, "--yes")
        if not os.path.isfile(self.p(".local/share/shepherdr/package.json")):
            self.skipTest("no service installed here")
        with open(os.path.join(wt, "package.json")) as f:
            self.assertNotIn("type", json.load(f))
        with open(os.path.join(wt, "package.json"), "w") as f:
            f.write('{"mine": 1}')
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        with open(os.path.join(wt, "package.json")) as f:
            self.assertEqual(json.load(f), {"mine": 1})

    def test_service_answers(self):
        """doctor and install trust only Shepherdr's own service on its port: the id it wrote in service.json, not
        another app answering health there (GitHub #635)."""
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        sh = installer()

        def server(body):
            class H(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps(body).encode())

                def log_message(self, *a):
                    pass
            s = ThreadingHTTPServer(("127.0.0.1", 0), H)
            threading.Thread(target=s.serve_forever, daemon=True).start()
            return s
        ours, other = server({"ok": True, "id": "id-1"}), server({"ok": True})
        try:
            data = self.p(".herdr", "shepherdr")
            os.makedirs(data)
            ok, why = sh.service_answers(self.root)
            self.assertFalse(ok)
            self.assertIn("hasn't started", why)
            for port, want in ((ours.server_port, True), (other.server_port, False)):
                with open(os.path.join(data, "service.json"), "w") as f:
                    json.dump({"port": port, "id": "id-1"}, f)
                ok, why = sh.service_answers(self.root)
                self.assertEqual(ok, want, why)
                self.assertEqual(sh.our_port(self.root), port)
            self.assertIn("another app", why)
        finally:
            for s in (ours, other):
                s.shutdown()
                s.server_close()

    def test_pack_installs_another_machine(self):
        """Serve from: what `shepherdr web install-on` sends (pack) installs from itself, the installed folder is a
        whole source to send on again (the Herdr button and the hooks with it), and uninstall puts back the helper it
        replaced. The script it runs there no longer refuses a machine with 3.1's window install: it switches it."""
        import io
        import tarfile
        sh = installer()
        self.assertNotIn("installed there: update it there", sh.INSTALL_THERE)
        self.assertNotIn("--web", sh.INSTALL_THERE)
        self.assertIn('install --yes --source "$d"', sh.INSTALL_THERE)
        self.assertEqual(subprocess.run(["bash", "-n"], input=sh.INSTALL_THERE, capture_output=True, text=True).returncode, 0)
        root, src = tempfile.mkdtemp(prefix="shepherdr-there-"), tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            tarfile.open(fileobj=io.BytesIO(sh.pack(ROOT))).extractall(src)
            self.assertTrue(sh.is_source(src))
            os.makedirs(os.path.join(root, ".local/bin"))
            with open(os.path.join(root, ".local/bin/herdr-task"), "w") as f:
                f.write("#!/bin/sh\necho the old one\n")
            run("install", "--root", root, "--source", src, "--yes", "--force")
            share = os.path.join(root, SHARE)
            for f in ("install.sh", "bin/shepherdr", "templates/worker.md", "service/serve-from.ts", "core/host.js",
                      "mods/artifacts/ARTIFACTS.md", "hooks/ask-hook.sh", "herdr/open-shepherdr/mod.json", "service/restart.sh"):
                self.assertTrue(os.path.isfile(os.path.join(share, f)), f)
            self.assertTrue(sh.is_source(share))
            names = lambda b: sorted(tarfile.open(fileobj=io.BytesIO(b)).getnames())
            self.assertEqual(names(sh.pack(share)), names(sh.pack(ROOT)))
            run("uninstall", "--root", root)
            self.assertEqual(open(os.path.join(root, ".local/bin/herdr-task")).read(), "#!/bin/sh\necho the old one\n")
        finally:
            shutil.rmtree(root, ignore_errors=True)
            shutil.rmtree(src, ignore_errors=True)

    def test_update_waits_for_a_voice_call(self):
        """SHEP-173: ElevenLabs' records showed calls cut (1006) a minute after each release: the update restarted the
        service under them. A call on: the unit stays, nothing restarts, and the service is told to start again once
        the call ends (restart-when-free). No call: it restarts as before."""
        sh = installer()
        root = tempfile.mkdtemp(prefix="shepherdr-call-")
        ran = []
        saved = (sh.bun_path, sh.has_unit, sh.calls_on, sh.subprocess.run, sh.service_answers)
        try:
            sh.bun_path = lambda: "/usr/bin/bun"
            sh.has_unit = lambda r: True
            sh.service_answers = lambda r: (True, 7788)
            sh.subprocess.run = lambda argv, **k: ran.append(argv) or subprocess.CompletedProcess(argv, 0, b"", b"")
            r = sh.Run(root, False)
            rel, text = sh.unit_text(root, "/usr/bin/bun", None)
            os.makedirs(os.path.dirname(r.p(rel)), exist_ok=True)
            with open(r.p(rel), "w") as f:
                f.write(text)
            marker = sh.service_file(root, "restart-when-free")
            sh.calls_on = lambda r: 1
            sh.install_service(r, {}, True)
            self.assertEqual(ran, [])
            self.assertTrue(os.path.isfile(marker))
            self.assertTrue(any("voice call" in n for n in r.notes))
            os.remove(marker)
            sh.calls_on = lambda r: 0
            sh.install_service(sh.Run(root, False), {}, True)
            self.assertTrue(ran)
            self.assertFalse(os.path.exists(marker))
        finally:
            sh.bun_path, sh.has_unit, sh.calls_on, sh.subprocess.run, sh.service_answers = saved
            shutil.rmtree(root, ignore_errors=True)

    def test_linked_unit_is_left_alone(self):
        """GitHub #1048: a Nix home-manager unit is a link into /nix/store. An update leaves it a link (no file written,
        none recorded, so uninstall never takes it), restarts the service without enabling it, and says so."""
        sh = installer()
        if sys.platform == "darwin":
            self.skipTest("a systemd unit")
        root = tempfile.mkdtemp(prefix="shepherdr-nix-")
        ran = []
        saved = (sh.bun_path, sh.calls_on, sh.subprocess.run, sh.service_answers)
        try:
            sh.bun_path = lambda: "/usr/bin/bun"
            sh.calls_on = lambda r: 0
            sh.service_answers = lambda r: (True, 7788)
            sh.subprocess.run = lambda argv, **k: ran.append(argv) or subprocess.CompletedProcess(argv, 0, b"", b"")
            store = os.path.join(root, "store-unit.service")   # stands in for /nix/store/<hash>-shepherdr.service
            with open(store, "w") as f:
                f.write("[Service]\nExecStart=nix's own\n")
            unit = os.path.join(root, sh.UNIT)
            os.makedirs(os.path.dirname(unit))
            os.symlink(store, unit)
            r, rec = sh.Run(root, False), {"files": {sh.UNIT: "an older sha"}}
            sh.install_service(r, rec, True)
            self.assertTrue(os.path.islink(unit))
            self.assertEqual(open(store).read(), "[Service]\nExecStart=nix's own\n")
            self.assertNotIn(sh.UNIT, rec["files"])
            self.assertTrue(any("links to " + store in n and "left as it is" in n for n in r.notes), r.notes)
            self.assertIn(["systemctl", "--user", "restart", "shepherdr.service"], ran)
            self.assertNotIn(["systemctl", "--user", "enable", "shepherdr.service"], ran)
            # a plain unit (ours) is still written and recorded as before
            os.remove(unit)
            r, rec, ran[:] = sh.Run(root, False), {}, []
            sh.install_service(r, rec, True)
            self.assertFalse(os.path.islink(unit))
            self.assertIn(sh.UNIT, rec["files"])
            self.assertIn(["systemctl", "--user", "enable", "shepherdr.service"], ran)
        finally:
            sh.bun_path, sh.calls_on, sh.subprocess.run, sh.service_answers = saved
            shutil.rmtree(root, ignore_errors=True)

    def test_the_unit_puts_the_service_in_shepherdrs_session(self):
        """SHEP-295: the service and every agent it starts land in Shepherdr's herdr-core session ("shepherdr"), never in
        the default one: the unit says HC_SESSION, an update writes it again (keeping a hand-added one the same), and
        doctor finds a unit without it."""
        sh = installer()
        for platform, want in (("darwin", "<key>HC_SESSION</key><string>shepherdr</string>"), ("linux", "Environment=HC_SESSION=shepherdr\n")):
            with mock.patch.object(sh.sys, "platform", platform):
                rel, text = sh.unit_text(self.root, "/usr/bin/bun")
                self.assertIn(want, text, platform)
                self.assertNotIn("SHEPHERDR_SESSION", text, "Shepherdr's own session needs no name of its own")
        # the real home with another session named (a throwaway core): that one, both ways
        with mock.patch.object(sh, "real_home", lambda: self.root), mock.patch.dict(os.environ, {"SHEPHERDR_SESSION": "try"}):
            self.assertEqual(sh.session_env(self.root), {"HC_SESSION": "try", "SHEPHERDR_SESSION": "try"})
        run("install", "--root", self.root, "--yes")
        unit = self.p(UNIT)
        self.assertIn("HC_SESSION", open(unit).read())
        self.assertNotIn("HC_SESSION=shepherdr", run("doctor", "--root", self.root, ok=False).stdout)
        # a unit an older install wrote: doctor says it, and the update writes it again
        with open(unit) as f:
            old = "".join(line for line in f if "HC_SESSION" not in line).replace("<key>HC_SESSION</key><string>shepherdr</string>", "")
        with open(unit, "w") as f:
            f.write(old)
        d = run("doctor", "--root", self.root, ok=False)
        self.assertEqual(d.returncode, 1, d.stdout)
        self.assertIn("✗ the Shepherdr service's unit doesn't set HC_SESSION=shepherdr", d.stdout)
        run("update", "--root", self.root)
        self.assertIn("HC_SESSION", open(unit).read())
        self.assertNotIn("HC_SESSION=shepherdr", run("doctor", "--root", self.root, ok=False).stdout)

    def install_in_place(self, platform="linux", fail_at=None, no_bun=False):
        """cmd_install as on the real home (this scratch root stands in for it), with fake systemctl/launchctl and
        nothing reaching herdr-core: [(event, what)] in the order they happened."""
        sh = installer()
        events = []
        real_write = sh.atomic_write

        def fake_run(argv, **k):
            events.append(("run", list(argv)))
            return subprocess.CompletedProcess(argv, 1 if "print" in argv else 0, "", "")

        def write(path, data, mode=None):
            events.append(("write", os.path.relpath(path, self.root)))
            return real_write(path, data, mode)

        def install_service(r, rec, home):
            events.append(("install_service", home))
            if not no_bun:
                r.service_started = True

        def boom(*a, **k):
            raise sh.Stop("can't remove something: Permission denied")
        patches = [(sh, "real_home", lambda: self.root), (sh.sys, "platform", platform), (sh.subprocess, "run", fake_run),
                   (sh, "atomic_write", write), (sh, "install_service", install_service), (sh, "has_unit", lambda root: True),
                   (sh, "service_running", lambda root: True), (sh, "calls_on", lambda root: 0), (sh, "check_tools", lambda home: ([], [])),
                   (sh, "move_data", lambda r, a, home: None), (sh, "carry_over_session", lambda r, rec, home: None),
                   (sh, "say_web", lambda *a: None), (sh, "ensure_agent_browser", lambda r, home: None), (sh, "say", lambda *a: None),
                   (sh, "install_checks", lambda r, rec: ([], [])), (sh.time, "sleep", lambda s: None)]
        if fail_at:
            patches.append((sh, fail_at, boom))
        with contextlib.ExitStack() as st:
            for target, name, value in patches:
                st.enter_context(mock.patch.object(target, name, value))
            code = sh.main(["install", "--root", self.root, "--no-build", "--yes"])
        return code, events

    def test_the_service_stops_while_files_move_and_starts_after(self):
        """SHEP-295: the running service read files while an update moved them and crashed (ENOENT). It stops before
        the first file changes; install_service starts it again on the new files."""
        code, events = self.install_in_place()
        self.assertEqual(code, 0)
        stop = events.index(("run", ["systemctl", "--user", "stop", "shepherdr.service"]))
        first = next(i for i, e in enumerate(events) if e[0] == "write" and e[1].startswith(".local/share/shepherdr/"))
        self.assertLess(stop, first, "stopped before the first file changes")
        self.assertGreater(events.index(("install_service", True)), first)
        self.assertNotIn(("run", ["systemctl", "--user", "start", "shepherdr.service"]), events, "install_service started it")

    def test_an_update_failing_halfway_starts_the_service_again(self):
        for platform, start in (("linux", ["systemctl", "--user", "start", "shepherdr.service"]),
                                ("darwin", ["launchctl", "bootstrap", f"gui/{os.getuid()}", self.p("Library/LaunchAgents/dev.shepherdr.service.plist")])):
            with self.subTest(platform):
                code, events = self.install_in_place(platform, fail_at="link_helpers")
                self.assertEqual(code, 1)
                runs = [e[1] for e in events if e[0] == "run"]
                stopped = [x for x in runs if x[:2] in (["systemctl", "--user"], ["launchctl", "bootout"]) and ("stop" in x or "bootout" in x)]
                self.assertTrue(stopped, runs)
                self.assertIn(start, runs, "the service comes back after a failed update")
                self.assertNotIn(("install_service", True), events)
        # no bun: install_service writes no unit and starts nothing; the old one comes back
        code, events = self.install_in_place(no_bun=True)
        self.assertIn(("run", ["systemctl", "--user", "start", "shepherdr.service"]), events)

    def test_a_service_that_wasnt_running_or_a_voice_call_isnt_stopped(self):
        sh = installer()
        r = sh.Run(self.root, False)
        with mock.patch.object(sh.subprocess, "run", lambda argv, **k: self.fail(f"ran {argv}")):
            with mock.patch.object(sh, "has_unit", lambda root: True), mock.patch.object(sh, "service_running", lambda root: False):
                self.assertFalse(sh.stop_service(r, True))
            with mock.patch.object(sh, "has_unit", lambda root: True), mock.patch.object(sh, "service_running", lambda root: True), \
                    mock.patch.object(sh, "calls_on", lambda root: 1):
                self.assertFalse(sh.stop_service(r, True))
            self.assertFalse(sh.stop_service(r, False), "a scratch root runs no service")

    def test_the_new_installer_does_the_stopping(self):
        """An update runs the installed copy, which hands over to the source's own bin/shepherdr (hand_over) before it
        does anything: the stop is in cmd_install, which the new side runs."""
        with open(SHEPHERDR) as f:
            text = f.read()
        main = text[text.index("def main("):]
        self.assertLess(main.index("hand_over(a, argv)"), main.index("cmd_install(a, update="))
        body = text[text.index("def cmd_install("):text.index("def finish_install(")]
        self.assertIn("stopped = stop_service(r, home)", body)

    def test_unit_path_has_hc(self):
        """GitHub #1048: the unit's PATH holds the folder hc was found in, wherever that is (a Nix profile, not
        ~/.local/bin); a tool linked into the Nix store goes on by its profile's folder, which outlives an upgrade."""
        sh = installer()
        tmp = tempfile.mkdtemp(prefix="shepherdr-path-")
        old = os.environ["PATH"]
        try:
            prof = os.path.join(tmp, "profile", "bin")
            os.makedirs(prof)
            with open(os.path.join(prof, "hc"), "w") as f:
                f.write("#!/bin/sh\n")
            os.chmod(os.path.join(prof, "hc"), 0o755)
            os.environ["PATH"] = prof + os.pathsep + old
            rel, text = sh.unit_text(tmp, "/usr/bin/bun", None)
            path = next(l for l in text.splitlines() if "PATH" in l)
            self.assertIn(prof, path)
            self.assertEqual(sh.tool_dir("hc", "/home/u/.nix-profile/bin/hc"), "/home/u/.nix-profile/bin")
        finally:
            os.environ["PATH"] = old
            shutil.rmtree(tmp, ignore_errors=True)

    def test_update_comes_from_where_it_was_installed(self):
        """An update takes the source the record names, never the installed folder itself (a whole source too); one
        whose source is gone says so, and doctor says how to update."""
        import io
        import tarfile
        sh = installer()
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            run("install", "--root", self.root, "--yes")
            os.remove(self.p(SHARE, "service/main.ts"))
            out = run("update", "--root", self.root, "--yes").stdout
            self.assertIn(f"update from {ROOT}", out)
            self.assertTrue(os.path.isfile(self.p(SHARE, "service/main.ts")))
            doc = run("doctor", "--root", self.root).stdout
            self.assertIn("to update:", doc)
            self.assertIn("shepherdr update", doc)
            # installed from a copy that's gone since: no update from the installed folder itself
            tarfile.open(fileobj=io.BytesIO(sh.pack(ROOT))).extractall(src)
            run("install", "--root", self.root, "--source", src, "--yes")
            shutil.rmtree(src)
            installed = self.p(SHARE, "bin/shepherdr")
            p = subprocess.run([sys.executable, installed, "update", "--root", self.root, "--yes", "--no-build"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(p.returncode, 1)
            self.assertIn("is gone", p.stderr)
            self.assertIn("is gone", run("doctor", "--root", self.root).stdout)
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_update_runs_the_new_installer(self):
        """`shepherdr update` is the installed (old) copy: after a release it hands over to the source's installer, so
        one run records the new version (SHEP-28 had to run it twice)."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            s = copy_source(os.path.join(src, "s"))
            run("install", "--root", self.root, "--source", s, "--yes")
            installed = self.p(SHARE, "bin/shepherdr")
            self.assertTrue(os.path.isfile(installed))
            # the release: a new version in the source, the installed copy still the old one
            new = os.path.join(s, "bin/shepherdr")
            with open(new) as f:
                text = f.read()
            with open(new, "w") as f:
                f.write(re.sub(r'^VERSION = "[^"]*"', 'VERSION = "9.9.9"', text, count=1, flags=re.M))
            p = subprocess.run([sys.executable, installed, "update", "--root", self.root, "--yes", "--no-build"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertIn("Shepherdr 9.9.9 update", p.stdout)
            self.assertEqual(json.load(open(self.p(RECORD)))["version"], "9.9.9")
            # now the same installer: it runs itself
            p = subprocess.run([sys.executable, installed, "update", "--root", self.root, "--yes", "--no-build"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertNotIn("runs it", p.stdout)
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_update_needs_an_install(self):
        p = run("update", "--root", self.root, "--yes", ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("isn't installed", p.stderr)
        p = run("doctor", "--root", self.root, ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("isn't installed", p.stderr)

    def test_web_stale(self):
        """When the installer builds the web app: missing, or older than anything it's built from (not its outputs);
        a source without web/src (an installed folder) never."""
        sh = installer()
        src = tempfile.mkdtemp(prefix="shepherdr-stale-")
        try:
            def put(rel, t):
                os.makedirs(os.path.dirname(os.path.join(src, rel)), exist_ok=True)
                open(os.path.join(src, rel), "w").close()
                os.utime(os.path.join(src, rel), (t, t))
            self.assertIsNone(sh.web_stale(src))
            put("web/src/App.tsx", 100)
            put("core/host.js", 100)
            put("package.json", 100)
            self.assertEqual(sh.web_stale(src), "isn't built")
            put("web/dist/index.html", 200)
            put("web/generated/client-plugins.ts", 300)
            put("web/node_modules/x.js", 300)
            self.assertIsNone(sh.web_stale(src))
            put("core/host.js", 300)
            self.assertEqual(sh.web_stale(src), "is older than core/host.js")
            put("core/host.js", 100)
            put("package.json", 300)
            self.assertEqual(sh.web_stale(src), "is older than package.json")
        finally:
            shutil.rmtree(src, ignore_errors=True)

    @unittest.skipUnless(CI or os.environ.get("SHEPHERDR_FRESH_CLONE") == "1",
                         "on CI (or SHEPHERDR_FRESH_CLONE=1): it downloads the web app's packages and builds it")
    def test_fresh_clone_builds_the_web_app(self):
        """A fresh clone (what git has, no web/dist, no node_modules) installs into a scratch root with a working page:
        the installer builds the web app, and every file the page loads is there."""
        import threading
        import urllib.request
        from functools import partial
        from html.parser import HTMLParser
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        clone, root = tempfile.mkdtemp(prefix="shepherdr-clone-"), tempfile.mkdtemp(prefix="shepherdr-root-")
        try:
            # a clone's files: what git tracks, and what it would (new files not committed yet), never what it ignores
            names = subprocess.run(["git", "-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                                   capture_output=True, text=True, check=True).stdout.split("\0")
            for n in filter(None, names):
                if os.path.isfile(os.path.join(ROOT, n)):
                    os.makedirs(os.path.dirname(os.path.join(clone, n)), exist_ok=True)
                    shutil.copy2(os.path.join(ROOT, n), os.path.join(clone, n))
            self.assertFalse(os.path.exists(os.path.join(clone, "web/dist")))
            p = subprocess.run(["sh", os.path.join(clone, "install.sh"), "--root", root, "--yes"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertIn("the web app isn't built: building it", p.stdout)
            self.assertNotIn("serves no page", p.stdout)
            dist = os.path.join(root, ".local/share/shepherdr/web/dist")
            self.assertFalse(os.path.exists(os.path.join(dist, "artifact-viewer.html")), "3.1's recipe viewer is no longer built or shipped")

            class Refs(HTMLParser):
                found = []

                def handle_starttag(self, tag, attrs):
                    a = dict(attrs)
                    for k in ("src", "href"):
                        if a.get(k) and not a[k].startswith(("http:", "https:", "data:", "#")):
                            self.found.append(a[k])
            # served as the service serves it, under a path (relative base): the page and every file it loads
            srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=dist))
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            try:
                base = f"http://127.0.0.1:{srv.server_port}/"
                page = urllib.request.urlopen(base).read().decode()
                self.assertIn('id="root"', page)
                refs = Refs()
                refs.feed(page)
                self.assertTrue(any(r.endswith(".js") for r in refs.found), refs.found)
                for ref in refs.found:
                    with urllib.request.urlopen(base + ref.lstrip("./")) as r:
                        self.assertEqual(r.status, 200, ref)
                        self.assertTrue(r.read(), ref)
            finally:
                srv.shutdown()
                srv.server_close()
            # and again: nothing to build now
            p = subprocess.run(["sh", os.path.join(clone, "install.sh"), "--root", root, "--yes"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertNotIn("building it", p.stdout)
        finally:
            shutil.rmtree(clone, ignore_errors=True)
            shutil.rmtree(root, ignore_errors=True)

    def test_dry_run_writes_nothing(self):
        out = run("install", "--root", self.root, "--dry-run").stdout
        self.assertEqual(tree(self.root), self.before)
        self.assertIn("ctrl-shift-o opens Shepherdr", out)


class SwitchFromTheWindow(unittest.TestCase):
    """3.2 replaces 3.1 in one hard switch. An install or update that finds 3.1's record (the Herdr-window install,
    test/fixtures/window-3.1.46.py) waits for working tasks, takes out what 3.1 put in the Herdr app, leaves the
    person's data and their own mods, keys and hooks, and goes on as the one install."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="shepherdr-31-")
        self.old = WINDOW_31.build(self.root)
        # the person's data, in the Herdr app's data/ and in ~/.herdr (3.1.26's places): never touched
        self.data = {f"{APP}/data/chat-asks/req/t1.json": "{}", f"{APP}/data/backups/1/sidebar.json": '{"spaces": []}',
                     f"{APP}/shared.json": '{"mine": 1}', ".herdr/vault.json": '{"secret": "kept"}'}
        for rel, text in self.data.items():
            os.makedirs(os.path.dirname(self.p(rel)), exist_ok=True)
            with open(self.p(rel), "w") as f:
                f.write(text)
        self.tasks = self.p(".herdr/tasks/dev-shop.json")
        os.makedirs(os.path.dirname(self.tasks))
        self.set_tasks("running")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def p(self, *rel):
        return os.path.join(self.root, *rel)

    def set_tasks(self, state):
        path = self.tasks if not os.path.islink(os.path.dirname(self.tasks)) else self.p(SHARE, "tasks/dev-shop.json")
        with open(path, "w") as f:
            json.dump({"folder": "/x/shop", "prefix": "SHOP", "tasks": [
                {"id": 3, "title": "Fix the cart", "state": state}, {"id": 4, "title": "Old one", "state": "running", "archived": 5},
                {"id": 5, "title": "Waits for you", "state": "ready"}, {"id": 6, "title": "Later", "state": "queued"}]}, f)

    def test_waits_for_working_tasks_then_switches(self):
        # the person's own changes inside what 3.1 installed
        with open(self.p(APP, "mods/toasts/main.js"), "a") as f:
            f.write("// mine\n")
        with open(self.p(APP, "mods/chat/notes.txt"), "w") as f:
            f.write("mine\n")
        lay = json.load(open(self.p(APP, "layouts/shepherdr.json")))
        lay["children"][0]["size"] = {"px": 312}                       # Herdr saved their sidebar width
        with open(self.p(APP, "layouts/shepherdr.json"), "w") as f:
            json.dump(lay, f)
        os.makedirs(self.p(APP, "mods/art-abc123"))                    # an artifact's mod, as 3.1's herdr-artifact wrote it
        with open(self.p(APP, "mods/art-abc123/main.js"), "w") as f:
            f.write("export default {}\n")
        os.makedirs(self.p(APP, "bin/__pycache__"))
        with open(self.p(APP, "bin/__pycache__/x.pyc"), "w") as f:
            f.write("")
        before = tree(self.root)

        # (a) a task is working: the update says which and changes nothing
        p = run("update", "--root", self.root, "--yes", "--source", ROOT, ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("1 task is still working on the old version", p.stderr)
        self.assertIn("SHOP-3 Fix the cart", p.stderr)
        self.assertNotIn("SHOP-4", p.stderr, "an archived task isn't working")
        self.assertNotIn("SHOP-5", p.stderr, "nor one that waits for the person")
        self.assertIn("--force", p.stderr)
        self.assertEqual(tree(self.root), before, "nothing was changed")
        dry = run("update", "--root", self.root, "--yes", "--source", ROOT, "--dry-run").stdout
        self.assertIn("still working (the switch waits for them, or --force): SHOP-3 Fix the cart", dry)
        self.assertIn("would take out its 28 mods, 1 artifact mod", dry)
        self.assertEqual(tree(self.root), before, "a dry run writes nothing")

        # the task finished: the same update switches
        self.set_tasks("done")
        out = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
        self.assertIn("Shepherdr 3.2.18 update", out)
        self.assertIn("switching from Shepherdr 3.1.46 (the Herdr-window install)", out)
        self.assertIn("removed what 3.1 put in the Herdr app: 28 mods, 1 artifact mod (kept in the backup)", out)
        self.assertIn("3 files you changed are in the backup", out)
        # (c) the last words: pick another layout
        self.assertIn("pick another layout there (Ctrl+Shift+L) if Shepherdr's was selected", out)
        backup = re.search(r"backup of what it replaced: (\S+)", out).group(1)
        self.assertTrue(backup.startswith(self.p(SHARE, ".shepherdr-backup")))

        # (b) what 3.1 put in the Herdr app is gone: only the person's mod, the button, their data, and in each old view's
        # place its notice (SHEP-355: a window still showing it would show red errors otherwise)
        sh = installer()
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), sorted(["changes", "open-shepherdr", *sh.RETIRED]))
        assert_notices(self, self.root, sh.RETIRED)
        self.assertIn("a Herdr window showing them gets a notice in their place", out)
        self.assertIn("the Herdr window: Shepherdr's old views there now say Shepherdr lives in the web app", out)
        self.assertEqual(open(self.p(APP, "mods/changes/main.js")).read(), "// Herdr's own mod\n")
        for gone in ("layouts/shepherdr.json", "lib", "core", "bin", "data/shepherdr", ".shepherdr-stage"):
            self.assertFalse(os.path.exists(self.p(APP, gone)), gone)
        # what the person changed is in the backup: their edit, their own file, the layout with their sizes, the artifact mod
        self.assertTrue(open(os.path.join(backup, APP, "mods/toasts/main.js")).read().endswith("// mine\n"))
        self.assertEqual(open(os.path.join(backup, APP, "mods/chat/notes.txt")).read(), "mine\n")
        self.assertEqual(json.load(open(os.path.join(backup, APP, "layouts/shepherdr.json")))["children"][0]["size"], {"px": 312})
        self.assertTrue(os.path.isfile(os.path.join(backup, APP, "mods/art-abc123/main.js")))
        self.assertFalse(os.path.exists(os.path.join(backup, APP, "mods/jump")), "a mod as Shepherdr shipped it isn't backed up")
        self.assertEqual(json.load(open(self.p(RECORD)))["notices"], list(sh.RETIRED))
        # the keys 3.1 merged are out, the person's from before back (alt-1), theirs kept (ctrl-k); our one key is in
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))),
                         {"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1", "ctrl-shift-o": "mod.open:open-shepherdr"}})
        # the old hook entries are replaced, not doubled; the person's own hook stays
        claude = json.load(open(self.p(".claude/settings.json")))
        self.assertEqual(claude["model"], "x")
        cmds = [h["command"] for e in claude["hooks"]["PermissionRequest"] for h in e["hooks"]]
        self.assertEqual(cmds, ["mine --ask", f"sh '{self.p(SHARE)}/hooks/ask-hook.sh'"])
        self.assertEqual([h["command"] for e in claude["hooks"]["SessionStart"] for h in e["hooks"]], [f"sh '{self.p(SHARE)}/hooks/session-note.sh'"])
        codex = open(self.p(".codex/hooks.json")).read()
        self.assertNotIn("mods/chat", codex)
        self.assertEqual(codex.count("/hooks/ask-hook.sh"), 1)
        # the --guard link is gone; the helpers' links lead into Shepherdr's own folder
        self.assertFalse(os.path.lexists(self.p(".local/bin/herdr-app")))
        for name, target in (("herdr-task", "mods/tasks/bin/herdr-task"), ("shepherdr", "bin/shepherdr"), ("herdr-secret", "bin/herdr-secret"),
                             ("herdr-browser", "bin/herdr-browser"), ("herdr-desktop", "bin/herdr-desktop")):
            self.assertEqual(os.path.realpath(self.p(".local/bin", name)), os.path.realpath(self.p(SHARE, target)))
        # what 3.1 kept in Shepherdr's folder and no longer ships is retired with it
        for gone in ("lib", "mods/coordinator", "mods/artifacts/recipe-view.js", "mods/artifacts/core", "service/layout-scripts.ts"):
            self.assertFalse(os.path.exists(self.p(SHARE, gone)), gone)
        self.assertNotIn("3.1.46", open(self.p(SHARE, "bin/shepherdr")).read()[:200])
        # (e) the new record is written, the old one gone; nothing of the window is in it
        rec = json.load(open(self.p(RECORD)))
        self.assertEqual(rec["version"], "3.2.18")
        self.assertFalse(os.path.exists(self.p(OLD_RECORD)))
        self.assertFalse([f for f in rec["files"] if f.startswith(APP) and "/mods/open-shepherdr/" not in f])
        self.assertNotIn("mods", rec)
        self.assertEqual(list(rec["keys"]), ["global ctrl-shift-o"])
        # the person's data is as it was (moved into Shepherdr's own folders by the usual move, never lost)
        for rel in (f"{APP}/data/chat-asks/req/t1.json", f"{APP}/data/backups/1/sidebar.json", f"{APP}/shared.json"):
            self.assertEqual(open(self.p(rel)).read(), self.data[rel], rel)
        self.assertEqual(json.load(open(self.p(".herdr/vault.json"))), {"secret": "kept"})
        self.assertEqual(len(json.load(open(self.p(SHARE, "tasks/dev-shop.json")))["tasks"]), 4)
        # (d) old artifacts are converted once, by the new herdr-artifact's own command when it has one
        if b'"convert"' in open(self.p(SHARE, "mods/artifacts/bin/herdr-artifact"), "rb").read():
            self.assertRegex(out, r"  artifacts: |the old artifacts weren't turned into pages")
        self.assertIn("whole", run("doctor", "--root", self.root).stdout)
        # again: a plain update, no second switch
        again = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
        self.assertNotIn("switching from", again)
        self.assertNotIn("artifacts:", again)
        self.assertRegex(again, r"files: \d+ same\n")

        # uninstall: the helper 3.1 had set aside is back, the Herdr app as before Shepherdr
        run("uninstall", "--root", self.root)
        self.assertEqual(open(self.p(".local/bin/herdr-task")).read(), "#!/bin/sh\necho the old one\n")
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1"}})
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), ["changes"])
        self.assertFalse(os.path.exists(self.p(".codex/hooks.json")), "the hooks file 3.1 made for Codex goes with our hooks")
        self.assertEqual(json.load(open(self.p(".claude/settings.json"))),
                         {"model": "x", "hooks": {"PermissionRequest": [{"hooks": [{"type": "command", "command": "mine --ask"}]}]}})

    def test_force_switches_while_tasks_work(self):
        out = run("install", "--root", self.root, "--yes", "--source", ROOT, "--force").stdout
        self.assertIn("switched while these tasks were working (--force): SHOP-3 Fix the cart", out)
        self.assertEqual(json.load(open(self.p(RECORD)))["version"], "3.2.18")
        self.assertFalse(os.path.exists(self.p(APP, "mods/tasks/live.js")), "3.1's code is gone")
        assert_notices(self, self.root, ["tasks"])

    def test_no_hooks_still_takes_the_old_hooks_out(self):
        """--no-hooks adds none of ours, but 3.1's entries point at files the switch removed: they go either way."""
        self.set_tasks("done")
        run("install", "--root", self.root, "--yes", "--source", ROOT, "--no-hooks")
        self.assertNotIn("ask-hook", open(self.p(".claude/settings.json")).read())
        self.assertNotIn("session-note", open(self.p(".codex/hooks.json")).read() if os.path.exists(self.p(".codex/hooks.json")) else "")

    def test_doctor_before_the_switch_says_to_update(self):
        p = run("doctor", "--root", self.root, ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("Shepherdr 3.1.46 (the Herdr-window install)", p.stderr)
        self.assertIn("one switch", p.stderr)

    def test_uninstall_straight_from_the_window_install(self):
        """3.2's uninstall on a machine never switched takes 3.1 out whole: the Herdr app as before Shepherdr."""
        run("uninstall", "--root", self.root)
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), ["changes"])
        self.assertEqual(json.load(open(self.p(APP, "keys.json"))), {"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1"}})
        self.assertFalse(os.path.exists(self.p(OLD_RECORD)))
        self.assertFalse(os.path.exists(self.p(SHARE, "service")))
        self.assertFalse(os.path.exists(self.p(".config/herdr-core/templates/worker.md")))
        self.assertEqual(open(self.p(".local/bin/herdr-task")).read(), "#!/bin/sh\necho the old one\n")
        self.assertFalse(os.path.lexists(self.p(".local/bin/herdr-app")))
        self.assertNotIn("mods/chat", open(self.p(".claude/settings.json")).read())
        self.assertEqual(open(self.p(f"{APP}/data/chat-asks/req/t1.json")).read(), "{}")

    def test_a_3_1_update_command_finds_this_checkout(self):
        """3.1's installed `shepherdr update` only hands over to a checkout its own is_source() accepts: install.sh and
        lib/addons.json. That marker stays in the repo (nothing reads it) so the documented update, git pull then
        `shepherdr update`, reaches the 3.2 installer; and 3.2's own test no longer needs it."""
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "install.sh")))
        self.assertEqual(json.load(open(os.path.join(ROOT, "lib", "addons.json")))["addons"], [])
        self.assertEqual(sorted(os.listdir(os.path.join(ROOT, "lib"))), ["addons.json"])
        sh = installer()
        self.assertTrue(sh.is_source(ROOT))
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            for f in ("install.sh", "bin/shepherdr", "service/main.ts"):
                os.makedirs(os.path.dirname(os.path.join(src, f)), exist_ok=True)
                open(os.path.join(src, f), "w").close()
            self.assertTrue(sh.is_source(src), "no lib/addons.json needed")
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_a_3_1_web_only_install_switches_too(self):
        """3.1's `install --web` (its record already in Shepherdr's folder): the same wait for working tasks, then a
        plain update that retires what 3.2 no longer ships and keeps the helper it had set aside for uninstall."""
        root = tempfile.mkdtemp(prefix="shepherdr-web31-")
        try:
            sh = installer()
            P = lambda *rel: os.path.join(root, *rel)
            files = {}
            for rel in (f"{SHARE}/lib/addons.json", f"{SHARE}/mods/coordinator/restart.sh", f"{SHARE}/mods/artifacts/recipe-view.js",
                        f"{SHARE}/service/main.ts", f"{SHARE}/bin/shepherdr"):
                os.makedirs(os.path.dirname(P(rel)), exist_ok=True)
                with open(P(rel), "w") as f:
                    f.write(f"// 3.1.46 {rel}\n")
                files[rel] = sh.sha_bytes(f"// 3.1.46 {rel}\n".encode())
            backup = P(APP, ".shepherdr-backup", "20260101-120000")
            os.makedirs(os.path.join(backup, ".local/bin"))
            with open(os.path.join(backup, ".local/bin/herdr-task"), "w") as f:
                f.write("#!/bin/sh\necho the old one\n")
            os.makedirs(P(".local/bin"))
            os.symlink(P(SHARE, "mods/tasks/bin/herdr-task"), P(".local/bin/herdr-task"))
            with open(P(RECORD), "w") as f:
                json.dump({"version": "3.1.46", "web": True, "files": files, "source": ROOT, "root": root, "backups": [backup],
                           "links": {"herdr-task": P(SHARE, "mods/tasks/bin/herdr-task")}}, f)
            os.makedirs(P(".herdr/tasks"))
            with open(P(".herdr/tasks/a.json"), "w") as f:
                json.dump({"folder": "/x", "prefix": "WEB", "tasks": [{"id": 1, "title": "Busy", "state": "running"}]}, f)
            p = run("update", "--root", root, "--yes", ok=False)
            self.assertIn("WEB-1 Busy", p.stderr)
            out = run("update", "--root", root, "--yes", "--force").stdout
            self.assertNotIn("switching from", out, "no window to take out")
            for gone in ("lib", "mods/coordinator", "mods/artifacts/recipe-view.js"):
                self.assertFalse(os.path.exists(P(SHARE, gone)), gone)
            rec = json.load(open(P(RECORD)))
            self.assertEqual(rec["version"], "3.2.18")
            self.assertNotIn("web", rec)
            self.assertNotIn("backups", rec)
            self.assertFalse(os.path.exists(P(APP, "mods")), "no Herdr app here: no button")
            run("uninstall", "--root", root)
            self.assertEqual(open(P(".local/bin/herdr-task")).read(), "#!/bin/sh\necho the old one\n")
        finally:
            shutil.rmtree(root, ignore_errors=True)


# A stand-in for agent-browser's release binary: says its version, has Chrome once `install` ran (unless told it fails)
# as an agent-browser that starts a space's browser and joins it (fake_ab), then:
FAKE_RELEASE = fake_ab.script("""case "$1" in
  doctor) if [ -f "$HOME/chrome" ]; then s=pass; else s=fail; fi; echo "{\\"checks\\":[{\\"id\\":\\"chrome.installed\\",\\"status\\":\\"$s\\"}]}" ;;
  install) if [ -n "$FAKE_CHROME_FAILS" ]; then echo "Chrome CDN unreachable" >&2; exit 1; fi; : > "$HOME/chrome" ;;
  *) echo "mine $all" ;;
esac
""")
PLATFORMS = ("darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "linux-musl-arm64", "linux-musl-x64")


class WindowNotices(unittest.TestCase):
    """SHEP-355: a Herdr window that ran 3.1's Shepherdr views and was updated by 3.2.0-3.2.2 (which took the views out
    under it) showed red "could not be re-rendered" banners, and each space's Assistant tab "chat did not load", also
    after a restart. The next update puts a notice in each view's place: no throw, no endless "Opening the
    conversation", one calm notice with the web app's link. Offered to remove, never forced; nothing of the person's
    is touched."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="shepherdr-notices-")
        self.sh = installer()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def p(self, *rel):
        return os.path.join(self.root, *rel)

    def window_32(self):
        """A machine switched by 3.2.2: Shepherdr 3.2 installed, the Herdr app with Herdr's storage of 3.1's views
        (data/spaces-chat, data/chat) but none of their mods any more, and the person's data."""
        os.makedirs(self.p(APP, "mods/changes"))   # the Herdr app is here: its own mods
        with open(self.p(APP, "mods/changes/main.js"), "w") as f:
            f.write("// Herdr's own mod\n")
        run("install", "--root", self.root, "--yes", "--source", ROOT)
        rec = json.load(open(self.p(RECORD)))
        for rel, text in ((f"{APP}/data/spaces-chat/state.json", "{}"), (f"{APP}/data/chat/drafts.json", '{"sp1": "half a message"}'),
                          (f"{APP}/shared.json", '{"layout": "shepherdr"}')):
            os.makedirs(os.path.dirname(self.p(rel)), exist_ok=True)
            with open(self.p(rel), "w") as f:
                f.write(text)
        rec.pop("notices", None)
        with open(self.p(RECORD), "w") as f:
            json.dump(rec, f)

    def test_an_updated_window_gets_its_notices(self):
        self.window_32()
        self.assertIn("has no notices in their place", run("doctor", "--root", self.root).stdout)
        out = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
        self.assertIn("the Herdr window: Shepherdr's old views there now say Shepherdr lives in the web app", out)
        self.assertIn("`shepherdr window --remove` takes them out", out)
        assert_notices(self, self.root, self.sh.RETIRED)
        self.assertEqual(json.load(open(self.p(RECORD)))["notices"], list(self.sh.RETIRED))
        # the person's data in Herdr's storage is as it was
        self.assertEqual(open(self.p(APP, "data/chat/drafts.json")).read(), '{"sp1": "half a message"}')
        self.assertEqual(open(self.p(APP, "shared.json")).read(), '{"layout": "shepherdr"}')
        doctor = run("doctor", "--root", self.root).stdout
        self.assertIn("30 of Shepherdr 3.1's old views show a notice that Shepherdr lives in the web app", doctor)
        self.assertIn("whole", doctor)
        # again: said once, nothing rewritten
        before = tree(self.p(APP))
        again = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
        self.assertNotIn("the Herdr window:", again)
        self.assertEqual(tree(self.p(APP)), before)
        # a newer notice replaces an older one in place
        with open(self.p(APP, "mods/chat/notice.js"), "a") as f:
            f.write("// an older release's\n")
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        assert_notices(self, self.root, ["chat"])

    def test_remove_is_offered_and_sticks(self):
        self.window_32()
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        self.assertIn("30 of Shepherdr 3.1's old views", run("window", "--root", self.root).stdout)
        out = run("window", "--remove", "--root", self.root).stdout
        self.assertIn("took out 30 notices from the Herdr window; updates won't put them back", out)
        self.assertIn("An old Assistant tab still open in Herdr now says it can't load: close it", out)
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), ["changes", "open-shepherdr"])
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        self.assertEqual(sorted(os.listdir(self.p(APP, "mods"))), ["changes", "open-shepherdr"])
        self.assertNotIn("the Herdr window", run("doctor", "--root", self.root).stdout)
        self.assertIn("no Shepherdr notices", run("window", "--root", self.root).stdout)

    def test_someone_elses_mod_by_that_name_stays(self):
        self.window_32()
        os.makedirs(self.p(APP, "mods/chat"))
        with open(self.p(APP, "mods/chat/main.js"), "w") as f:
            f.write("// my own chat mod\n")
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        self.assertEqual(open(self.p(APP, "mods/chat/main.js")).read(), "// my own chat mod\n")
        self.assertFalse(os.path.exists(self.p(APP, "mods/chat/notice.js")))
        self.assertNotIn("chat", json.load(open(self.p(RECORD)))["notices"])
        run("window", "--remove", "--root", self.root)
        self.assertEqual(open(self.p(APP, "mods/chat/main.js")).read(), "// my own chat mod\n")

    def test_no_window_no_notices(self):
        """A machine whose Herdr app never ran 3.1's views (or that has no Herdr app) gets none."""
        os.makedirs(self.p(APP, "mods/changes"))
        run("install", "--root", self.root, "--yes", "--source", ROOT)
        os.makedirs(self.p(APP, "data/chat-asks"))   # the question hook's storage, on every machine
        out = run("update", "--root", self.root, "--yes", "--source", ROOT).stdout
        self.assertNotIn("the Herdr window", out)
        self.assertFalse(os.path.exists(self.p(APP, "mods/chat")))
        self.assertNotIn("the Herdr window", run("doctor", "--root", self.root).stdout)

    def test_uninstall_takes_them_out(self):
        self.window_32()
        run("update", "--root", self.root, "--yes", "--source", ROOT)
        run("uninstall", "--root", self.root)
        self.assertEqual(os.listdir(self.p(APP, "mods")), ["changes"])
        self.assertEqual(open(self.p(APP, "data/chat/drafts.json")).read(), '{"sp1": "half a message"}')

    def test_dry_run_writes_nothing(self):
        self.window_32()
        before = tree(self.root)
        out = run("update", "--root", self.root, "--yes", "--source", ROOT, "--dry-run").stdout
        self.assertIn("would now say Shepherdr lives in the web app", out)
        self.assertEqual(tree(self.root), before)


class AgentBrowser(unittest.TestCase):
    """herdr-browser finds a usable agent-browser (0.41.1 up to 0.41.x) or installs Shepherdr's own (SHEP-156): the
    release's binary, checked against the pin's checksum, from a local folder standing in for GitHub."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shepherdr-ab-")
        self.home = os.path.join(self.tmp, "home")
        self.rel = os.path.join(self.tmp, "release")
        os.makedirs(self.home)
        os.makedirs(self.rel)
        for plat in PLATFORMS:
            with open(os.path.join(self.rel, f"agent-browser-{plat}"), "w") as f:
                f.write(FAKE_RELEASE)
        import hashlib
        self.sha = hashlib.sha256(FAKE_RELEASE.encode()).hexdigest()
        self.mine = os.path.join(self.home, ".local/share/shepherdr/agent-browser/0.41.1/agent-browser")
        self.hb = os.path.join(ROOT, "bin", "herdr-browser")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def on_path(self, version):
        """A folder with an agent-browser of that version (None: none), for the PATH."""
        d = os.path.join(self.tmp, f"path-{version}")
        os.makedirs(d, exist_ok=True)
        if version:
            with open(os.path.join(d, "agent-browser"), "w") as f:
                f.write(fake_ab.script('echo "path $all"').replace("agent-browser 0.41.1", f"agent-browser {version}"))
            os.chmod(os.path.join(d, "agent-browser"), 0o755)
        return d

    def hbr(self, *args, path=None, url=None, sha=None, **extra):
        env = {"HOME": self.home, "PATH": f"{path or self.on_path(None)}:/usr/bin:/bin",
               "HERDR_BROWSER_URL": url or "file://" + self.rel, "HERDR_BROWSER_SHA256": sha or self.sha, **fake_ab.ENV, **extra}
        return subprocess.run(["sh", self.hb, *args], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)

    def status(self, **kw):
        return json.loads(self.hbr("--status", **kw).stdout)

    def test_missing_installs_its_own_on_first_use(self):
        p = self.hbr("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("installing agent-browser 0.41.1", p.stderr)
        self.assertIn("mine --session herdr-a-1", p.stdout)
        self.assertTrue(os.access(self.mine, os.X_OK))
        self.assertTrue(os.path.exists(os.path.join(self.home, "chrome")), "Chrome: agent-browser install ran")
        st = self.status()
        self.assertEqual((st["ok"], st["from"], st["version"]), (True, "shepherdr", "0.41.1"))
        # next time: no install
        p = self.hbr("--task", "a#1", "snapshot")
        self.assertNotIn("installing", p.stderr)

    def test_help_answers_at_once_without_installing(self):
        # GitHub #1173: --help with an off-pin agent-browser waited on a download, saying nothing
        old = self.on_path("0.31.1")
        for args in (("--help",), ("-h",), ("help",), ("--task", "a#1", "--help")):
            p = self.hbr(*args, path=old)
            self.assertEqual(p.returncode, 0, (args, p.stderr))
            self.assertIn("your own tab in your space's browser", p.stdout)
            self.assertIn("this machine has 0.31.1", p.stdout)
            self.assertNotIn("installing", p.stderr)
            self.assertFalse(os.path.exists(self.mine), args)
        # with a usable one, agent-browser's own help follows
        p = self.hbr("--help", path=self.on_path("0.41.1"))
        self.assertIn("path --help", p.stdout)

    def test_a_slow_download_says_how_far_it_got(self):
        # GitHub #1173: a slow network took minutes with no word; now it says the MB so far as it goes
        slow = os.path.join(self.tmp, "slowbin")
        os.makedirs(slow)
        with open(os.path.join(slow, "curl"), "w") as f:
            f.write('#!/bin/sh\nout=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done\n'
                    'head -c 2097152 /dev/zero > "$out"; sleep 3; cp "%s" "$out"\n' % os.path.join(self.rel, "agent-browser-linux-x64"))
        os.chmod(os.path.join(slow, "curl"), 0o755)
        p = self.hbr("--install", path=slow, HERDR_BROWSER_PROGRESS_EVERY="1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("downloading agent-browser 0.41.1: 2.0 MB after", p.stderr)
        self.assertIn("is ready", p.stdout)

    def test_herdrs_own_views_never_install(self):
        p = self.hbr("--own", "--task", "a#1", "session", "list")
        self.assertEqual(p.returncode, 127)
        self.assertIn("agent-browser isn't installed here", p.stderr)
        self.assertIn("Fix it: ", p.stderr)
        self.assertTrue(p.stderr.strip().endswith("--install"), p.stderr)
        self.assertFalse(os.path.exists(self.mine))

    def test_too_old_is_replaced_by_its_own(self):
        old = self.on_path("0.34.0")
        st = self.status(path=old)
        self.assertFalse(st["ok"])
        self.assertIn("this machine has 0.34.0", st["problem"])
        p = self.hbr("--task", "a#1", "open", "x", path=old)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("mine ", p.stdout)
        self.assertEqual(self.status(path=old)["from"], "shepherdr")

    def test_compatible_newer_is_used_as_it_is(self):
        for v, ok in (("0.41.1", True), ("0.41.2", True), ("0.41.12", True), ("0.41.3-beta.1", True), ("0.41.0", False),
                      ("0.42.0", False), ("1.41.1", False), ("0.4.1", False), ("0.41", False)):
            self.assertEqual(self.status(path=self.on_path(v))["ok"], ok, v)
        newer = self.on_path("0.41.2")
        p = self.hbr("--task", "a#1", "open", "x", path=newer)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("path --session herdr-a-1", p.stdout)
        self.assertNotIn("installing", p.stderr)
        self.assertFalse(os.path.exists(self.mine))
        self.assertEqual(self.hbr("--bin", path=newer).stdout.strip(), os.path.join(newer, "agent-browser"))

    def test_install_failing_says_why_and_the_fix(self):
        # offline: nothing to download
        p = self.hbr("--task", "a#1", "open", "x", url="file://" + os.path.join(self.tmp, "nowhere"))
        self.assertEqual(p.returncode, 127)
        self.assertIn("couldn't install it: couldn't download it", p.stderr)
        self.assertIn("Fix it: ", p.stderr)
        # not tried again for a while: the same message at once
        p = self.hbr("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 127)
        self.assertNotIn("installing", p.stderr)
        self.assertIn("couldn't download it", p.stderr)
        self.assertIn("couldn't download it", self.status()["failed"])
        # a download that isn't the pinned release is never kept
        p = self.hbr("--install", sha="0" * 64)
        self.assertEqual(p.returncode, 1)
        self.assertIn("its checksum differs", p.stderr)
        self.assertFalse(os.path.exists(self.mine))
        # --install tries again whenever asked, and clears the failure
        p = self.hbr("--install")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("is ready", p.stdout)
        self.assertEqual(self.status()["failed"], "")

    def test_chrome_failing_says_so(self):
        p = self.hbr("--install", FAKE_CHROME_FAILS="1")
        self.assertEqual(p.returncode, 1)
        self.assertIn("couldn't download Chrome (Chrome CDN unreachable)", p.stderr)

    def test_a_new_pin_replaces_the_old_copy(self):
        old = os.path.join(self.home, ".local/share/shepherdr/agent-browser/0.40.9")
        os.makedirs(old)
        with open(os.path.join(old, "agent-browser"), "w") as f:
            f.write("#!/bin/sh\necho agent-browser 0.40.9\n")
        self.assertEqual(self.hbr("--install").returncode, 0)
        self.assertTrue(os.path.exists(self.mine))
        self.assertFalse(os.path.exists(old))

    def test_install_and_doctor(self):
        """The installer makes sure of it (only on the real home, or when asked for a scratch root); doctor says how
        it stands, with the fix when it can't."""
        root = os.path.join(self.tmp, "root")
        os.makedirs(os.path.join(root, APP))
        # the PATH without this machine's own agent-browser
        path = ":".join(d for d in os.environ["PATH"].split(":") if not os.path.exists(os.path.join(d, "agent-browser")))
        env = {**os.environ, "PATH": path, "HERDR_BROWSER_URL": "file://" + self.rel,
               "HERDR_BROWSER_SHA256": self.sha}
        env.pop("SHEPHERDR_AGENT_BROWSER", None)
        sh = lambda *a, **e: subprocess.run([sys.executable, SHEPHERDR, *a], capture_output=True, text=True,
                                            stdin=subprocess.DEVNULL, env={**env, **e})
        p = sh("install", "--root", root, "--yes", "--no-build")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        mine = os.path.join(root, ".local/share/shepherdr/agent-browser/0.41.1/agent-browser")
        self.assertFalse(os.path.exists(mine), "a scratch root downloads nothing unless asked")
        self.assertIn("the task browser: agent-browser isn't installed here. Fix it: ", sh("doctor", "--root", root).stdout)
        p = sh("update", "--root", root, "--yes", "--no-build", SHEPHERDR_AGENT_BROWSER="1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("agent-browser 0.41.1 is ready", p.stdout)
        self.assertTrue(os.path.exists(mine))
        self.assertIn("agent-browser 0.41.1 for the task browser (Shepherdr's own copy)", sh("doctor", "--root", root).stdout)
        self.assertEqual(sh("uninstall", "--root", root).returncode, 0)
        self.assertFalse(os.path.exists(os.path.dirname(mine)), "uninstall takes Shepherdr's agent-browser away")


if __name__ == "__main__":
    unittest.main()

class RemoteSwitchGuard(unittest.TestCase):
    def test_checks_linked_machines_and_waits_when_unreachable(self):
        from unittest import mock
        mod = installer()
        calls = []
        def fake(argv, **kwargs):
            calls.append(argv)
            if argv[1:3] == ["machine", "ls"]:
                return subprocess.CompletedProcess(argv, 0, json.dumps({"machines": [{"name": "mac", "state": "connected"}, {"name": "laptop", "state": "disconnected"}]}), "")
            return subprocess.CompletedProcess(argv, 0, json.dumps(["SHOP-3 Fix cart"]), "")
        with mock.patch.object(mod, "real_home", return_value="/fake/home"):
            result = mod.remote_working_tasks("/fake/home", run=fake)
        self.assertEqual(result, ["mac: SHOP-3 Fix cart", "laptop: cannot check its tasks"])
        self.assertEqual(calls[1][:4], ["hc", "exec", "--on", "mac"])
        self.assertNotIsInstance(result[0], mod.UncheckedMachine)
        self.assertIsInstance(result[1], mod.UncheckedMachine)
        self.assertNotIsInstance("SHOP-3 cannot check its tasks", mod.UncheckedMachine)

    def test_warning_distinguishes_task_titles_and_unchecked_machines(self):
        mod = installer()
        text = mod.switch_blocked_message("3.1", ["SHOP-3 cannot check its tasks", mod.UncheckedMachine("vm: cannot check its tasks")])
        self.assertIn("1 task is still working", text)
        self.assertIn("Couldn't check these machines", text)
        self.assertIn("SHOP-3 cannot check its tasks", text)
        only = mod.switch_blocked_message("3.1", [mod.UncheckedMachine("vm: cannot check its tasks")])
        self.assertIn("Couldn't check these machines", only)
        self.assertNotIn("task is still working", only)

    def test_machine_list_failure_does_not_allow_switch(self):
        from unittest import mock
        mod = installer()
        with mock.patch.object(mod, "real_home", return_value="/fake/home"):
            result = mod.remote_working_tasks("/fake/home", run=lambda *a, **kw: subprocess.CompletedProcess(a, 1, "", "offline"))
        self.assertEqual(result, ["linked machines: cannot check their tasks"])
        self.assertIsInstance(result[0], mod.UncheckedMachine)
