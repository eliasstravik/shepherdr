"""The installer against scratch roots (--root): install, run again, update with a changed file,
clashes, --adopt, uninstall. Never touches the real home."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import re
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEPHERDR = os.path.join(ROOT, "bin", "shepherdr")
APP = ".config/herdr-app"
CI = os.environ.get("CI") == "true"


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


# Shepherdr's own data (layout.py): an install makes its folders and the old paths' links; uninstall leaves the data.
DATA_PLACES = (".config/shepherdr/", ".local/share/shepherdr/", ".local/state/shepherdr/", ".cache/shepherdr/", "Library/Caches/shepherdr/", ".herdr/")


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

    def test_layout_upgrade_keeps_preferences_and_custom_shortcuts(self):
        run("install", "--root", self.root, "--yes")
        legacy = self.p(APP, "layouts/shepherdr.json")
        target = self.p(APP, "layouts/BossGoat.json")
        os.rename(target, legacy)
        record = self.p(APP, "data/shepherdr/installed.json")
        rec = json.loads(Path(record).read_text())
        rec["files"][f"{APP}/layouts/shepherdr.json"] = rec["files"].pop(f"{APP}/layouts/BossGoat.json")
        rec["keys"] = {k.replace("layout:BossGoat", "layout:shepherdr"): v for k, v in rec["keys"].items()}
        with open(record, "w") as f:
            json.dump(rec, f)
        keys_path = self.p(APP, "keys.json")
        keys = json.loads(Path(keys_path).read_text())
        keys["layout:shepherdr"] = keys.pop("layout:BossGoat")
        keys["layout:shepherdr"].update({"f2": "mine.rename", "alt-g": "mine.go"})
        keys["layout:BossGoat"] = {"shift-f2": "mine.space"}
        with open(keys_path, "w") as f:
            json.dump(keys, f)
        before = tree(self.root)
        blocked = run("install", "--root", self.root, "--yes", ok=False)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("layout.clone", blocked.stdout + blocked.stderr)
        self.assertEqual(tree(self.root), before, "upgrade must wait until Herdr copies the click state")

        # Model the files created by Herdr's supported clone command.
        clone = json.loads(Path(legacy).read_text())
        clone["cloned_from"] = {"name": "shepherdr", "version": "0.1.12"}
        with open(target, "w") as f:
            json.dump(clone, f)
        state = self.p(APP, "layouts/.state/BossGoat.json")
        os.makedirs(os.path.dirname(state), exist_ok=True)
        with open(state, "w") as f:
            f.write('{"theme":"paper","sidebar":{"px":260}}')
        before = tree(self.root)
        run("install", "--root", self.root, "--yes", "--adopt", "--keys", "keep", "--dry-run")
        self.assertEqual(tree(self.root), before)
        run("install", "--root", self.root, "--yes", "--adopt", "--keys", "keep")
        self.assertEqual(Path(state).read_bytes(), before[f"{APP}/layouts/.state/BossGoat.json"])
        self.assertFalse(os.path.exists(legacy), "the old shipped layout must leave the picker")
        self.assertTrue(list(Path(self.p(APP, ".shepherdr-backup")).rglob("shepherdr.json")))
        keys = json.loads(Path(keys_path).read_text())
        self.assertEqual(keys["layout:BossGoat"]["f2"], "mine.rename")
        self.assertEqual(keys["layout:BossGoat"]["shift-f2"], "mine.space")
        self.assertEqual(keys["layout:BossGoat"]["alt-g"], "mine.go")
        del keys["layout:BossGoat"]["alt-g"]
        with open(keys_path, "w") as f:
            json.dump(keys, f)
        run("install", "--root", self.root, "--yes", "--keys", "keep")
        self.assertNotIn("alt-g", json.loads(Path(keys_path).read_text())["layout:BossGoat"], "migration only runs once")
        run("doctor", "--root", self.root)
        run("uninstall", "--root", self.root)
        keys = json.loads(Path(keys_path).read_text())
        self.assertEqual(keys["layout:BossGoat"], {"shift-f2": "mine.space"})
        self.assertEqual(keys["layout:shepherdr"]["f2"], "mine.rename")
        self.assertTrue(os.path.exists(state))

    def test_install_again_update_uninstall(self):
        os.makedirs(self.p(".codex"))
        out = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(out, r"files: \d+ new\n")
        rec = json.load(open(self.p(APP, "data/shepherdr/installed.json")))
        self.assertEqual(rec["version"], "3.1.30")
        self.assertTrue(os.path.isfile(self.p(APP, "mods/tasks/bin/herdr-task")))
        self.assertTrue(os.path.isfile(self.p(APP, "layouts/BossGoat.json")))
        layout = json.load(open(self.p(APP, "layouts/BossGoat.json")))
        self.assertTrue(os.path.isfile(self.p(APP, layout["preview"])))
        self.assertEqual(Path(self.p(APP, "mods/chat/bossgoat-background.png")).read_bytes(),
                         (Path(ROOT) / "mods/chat/bossgoat-background.png").read_bytes(),
                         "new installations must include the default wallpaper without downloading it")
        self.assertEqual(os.path.realpath(self.p(".local/bin/herdr-task")), os.path.realpath(self.p(APP, "mods/tasks/bin/herdr-task")))
        # A key the person uses is kept (no terminal to ask in); free ones are added.
        keys = json.load(open(self.p(APP, "keys.json")))
        self.assertEqual(keys["global"]["ctrl-k"], "mine.open")
        self.assertEqual(keys["global"]["alt-1"], "space.select:1")
        self.assertEqual(keys["layout:BossGoat"]["f2"], "tabs-tasks.rename-tab")
        hooks = json.load(open(self.p(".claude/settings.json")))
        self.assertEqual(hooks["model"], "x")
        self.assertIn("ask-hook.sh", json.dumps(hooks["hooks"]["PermissionRequest"]))
        # Codex's approvals come to the chat's card too (SHEP-91)
        codex = json.load(open(self.p(".codex/hooks.json")))
        self.assertIn("ask-hook.sh", json.dumps(codex["hooks"]["PermissionRequest"]))
        # Helpers changed: the sync to other machines is held until doctor passes.
        self.assertTrue(os.path.exists(self.p(".herdr/sync-hold")))
        d = run("doctor", "--root", self.root)
        self.assertIn("whole", d.stdout)
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))

        # Again: nothing changes, no hold.
        again = run("install", "--root", self.root, "--yes").stdout
        self.assertRegex(again, r"files: \d+ same\n", "a second run changes nothing")
        self.assertFalse(os.path.exists(self.p(".herdr/sync-hold")))

        # A file the person changed: a template is kept with the new one beside it; a mod file Shepherdr didn't
        # change is kept as it is; one Shepherdr changed too is replaced (theirs could break the new mod, #766), theirs
        # to the backup folder, said.
        mine = self.p(APP, "mods/toasts/main.js")
        with open(mine, "a") as f:
            f.write("// mine\n")
        same = self.p(APP, "mods/toasts/ui.js")
        with open(same, "a") as f:
            f.write("// mine too\n")
        tpl = self.p(".config/herdr-core/templates/worker.md")
        with open(tpl, "a") as f:
            f.write("mine\n")
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            shutil.copytree(ROOT, os.path.join(src, "s"), ignore=shutil.ignore_patterns(".git"))
            s = os.path.join(src, "s")
            for f_ in ("mods/toasts/main.js", "mods/jump/main.js"):
                with open(os.path.join(s, f_), "a") as f:
                    f.write("// release\n")
            with open(os.path.join(s, "templates/worker.md"), "a") as f:
                f.write("release\n")
            up = run("update", "--root", self.root, "--source", s).stdout
            self.assertIn("1 replace", up)
            self.assertTrue(open(mine).read().endswith("// release\n"), "Shepherdr's changed mod file goes in")
            self.assertFalse(os.path.exists(mine + ".new"))
            backup = re.search(r"yours is kept as (\S+)", up).group(1)
            self.assertTrue(open(backup).read().endswith("// mine\n"), "the person's copy is in the backup")
            self.assertIn("Shepherdr changed .config/herdr-app/mods/toasts/main.js since you edited it", up)
            self.assertTrue(open(same).read().endswith("// mine too\n"), "a mod file Shepherdr didn't change stays the person's")
            self.assertFalse(os.path.exists(same + ".new"))
            self.assertTrue(open(tpl).read().endswith("mine\n"))
            self.assertTrue(open(tpl + ".new").read().endswith("release\n"))
            self.assertTrue(open(self.p(APP, "mods/jump/main.js")).read().endswith("// release\n"))
            d = run("doctor", "--root", self.root, ok=False).stdout
            self.assertIn("worker.md.new: merge it in", d)
        finally:
            shutil.rmtree(src)

        # Uninstall: everything back as it was, except the mod and the template the person changed.
        run("uninstall", "--root", self.root)
        after = tree(self.root)
        left = sorted(set(after) - set(self.before))
        self.assertTrue(all(x.startswith((f"{APP}/mods/toasts/", ".config/herdr-core/templates/worker.md")) or x.startswith(DATA_PLACES) for x in left), left)
        for k, v in self.before.items():
            if k.endswith(".json"):
                self.assertEqual(json.loads(after[k]), json.loads(v), k)
            else:
                self.assertEqual(after[k], v, k)
        self.assertFalse(os.path.lexists(self.p(".local/bin/herdr-task")))

    def test_default_dark_preserves_saved_appearance(self):
        path = Path(self.p(APP, "settings.json"))
        run("install", "--root", self.root, "--yes", "--dry-run")
        self.assertFalse(path.exists())
        run("install", "--root", self.root, "--yes")
        self.assertEqual(json.loads(path.read_text())["appearance"], "dark")
        path.write_text('{"appearance":"light","font_size":18}')
        run("update", "--root", self.root, "--source", ROOT)
        self.assertEqual(json.loads(path.read_text()), {"appearance": "light", "font_size": 18})
        run("uninstall", "--root", self.root)
        self.assertEqual(json.loads(path.read_text()), {"appearance": "light", "font_size": 18})
        run("install", "--root", self.root, "--yes")
        self.assertEqual(json.loads(path.read_text())["appearance"], "light")
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
        self.assertNotIn("Shepherdr's data moved", run("update", "--root", self.root, "--yes").stdout)
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
        (nothing is started), and uninstall takes both away."""
        out = run("install", "--root", self.root, "--yes").stdout
        if "needs bun" in out:
            self.skipTest("bun isn't installed here")
        self.assertTrue(os.path.isfile(self.p(".local/share/shepherdr/service/main.ts")))
        self.assertFalse(any(f.endswith(".test.ts") for f in os.listdir(self.p(".local/share/shepherdr/service"))))
        # every relative import the installed service runs resolves inside what was installed (bun can start it)
        share = self.p(".local/share/shepherdr")
        for d, _, files in os.walk(share):
            # the built page, and the helpers' files kept beside it (herdr-artifact's, run by Herdr, never by bun)
            if "/web/dist" in d or "/mods/" in d:
                continue
            for f in files:
                if not f.endswith((".ts", ".js")):
                    continue
                for m in re.finditer(r'^import (?!type )[^;]*?from ["\'](\.{1,2}/[^"\']+)["\']', open(os.path.join(d, f)).read(), re.M):
                    self.assertTrue(os.path.isfile(os.path.normpath(os.path.join(d, m.group(1)))), f"{os.path.relpath(os.path.join(d, f), share)} imports {m.group(1)}, not installed")
        unit = self.p("Library/LaunchAgents/dev.shepherdr.service.plist") if sys.platform == "darwin" else self.p(".config/systemd/user/shepherdr.service")
        text = open(unit).read()
        self.assertIn(self.p(".local/share/shepherdr/service/main.ts"), text)
        self.assertNotIn("funnel", text)
        run("uninstall", "--root", self.root)
        self.assertFalse(os.path.exists(unit))
        self.assertFalse(os.path.exists(self.p(".local/share/shepherdr/service/main.ts")))

    def test_port(self):
        """install --port (GitHub #635): the unit starts the service on it, the record keeps it for updates, 7788 puts the
        default back; a port out of range is refused."""
        unit = self.p("Library/LaunchAgents/dev.shepherdr.service.plist") if sys.platform == "darwin" else self.p(".config/systemd/user/shepherdr.service")
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
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
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
        """#895: an older release shipped a mod and a helper that the next one drops. The update removes the mod's folder
        (its shared copy of lib/ui.js too, which doctor rejects) and the helper; what the person changed in them is in
        the backup, and said. Doctor passes and the record forgets them."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            old = os.path.join(src, "old")
            shutil.copytree(ROOT, old, ignore=shutil.ignore_patterns(".git", "node_modules"))
            os.makedirs(os.path.join(old, "mods", "retired-tool"))
            with open(os.path.join(old, "mods", "retired-tool", "main.js"), "w") as f:
                f.write("// retired\n")
            with open(os.path.join(old, "mods", "retired-tool", "mod.json"), "w") as f:
                f.write('{"name": "retired-tool"}\n')
            shutil.copy(os.path.join(old, "lib", "ui.js"), os.path.join(old, "mods", "retired-tool", "ui.js"))
            with open(os.path.join(old, "bin", "old-tool"), "w") as f:
                f.write("#!/bin/sh\necho old\n")
            os.chmod(os.path.join(old, "bin", "old-tool"), 0o755)
            with open(os.path.join(old, "lib", "COPIES"), "a") as f:
                f.write("ui.js: retired-tool\n")
            with open(os.path.join(old, "lib", "addons.json")) as f:
                manifest = json.load(f)
            manifest["core"]["mods"].append("retired-tool")
            with open(os.path.join(old, "lib", "addons.json"), "w") as f:
                json.dump(manifest, f, indent=2)
            run("install", "--root", self.root, "--source", old, "--yes")
            self.assertTrue(os.path.isfile(self.p(APP, "mods/retired-tool/ui.js")))
            self.assertTrue(os.path.isfile(self.p(APP, "bin/old-tool")))
            with open(self.p(APP, "mods/retired-tool/main.js"), "a") as f:
                f.write("// mine\n")
            with open(self.p(APP, "bin/old-tool"), "a") as f:
                f.write("echo mine\n")
            # the next release: ROOT (this checkout) no longer ships either of them
            up = run("update", "--root", self.root, "--yes").stdout
            self.assertFalse(os.path.exists(self.p(APP, "mods/retired-tool")), "the retired mod's folder is gone")
            self.assertFalse(os.path.exists(self.p(APP, "bin/old-tool")), "the retired helper is gone")
            self.assertFalse(os.path.exists(self.p(".local/share/shepherdr/bin/old-tool")), "and its copy under the app's own folder")
            self.assertIn("removed mod retired-tool: Shepherdr no longer ships it", up)
            self.assertIn("removed .config/herdr-app/bin/old-tool: Shepherdr no longer ships it", up)
            backup = re.search(r"removed \.config/herdr-app/mods/retired-tool/main\.js: .*your changed copy is in (\S+)", up).group(1)
            with open(backup) as f:
                self.assertTrue(f.read().endswith("// mine\n"), "the person's change is in the backup")
            self.assertFalse(os.path.exists(os.path.join(os.path.dirname(backup), "ui.js")), "Shepherdr's unchanged copy isn't backed up")
            backup_tool = re.search(r"your changed copy is in (\S+)", re.search(r"removed \.config/herdr-app/bin/old-tool:.*", up).group(0)).group(1)
            with open(backup_tool) as f:
                self.assertTrue(f.read().endswith("echo mine\n"))
            rec = json.load(open(self.p(APP, "data/shepherdr/installed.json")))
            self.assertFalse([k for k in rec["files"] if "retired-tool" in k or k.endswith("old-tool")], "the record forgets them")
            self.assertNotIn("retired-tool", rec["mods"])
            d = run("doctor", "--root", self.root).stdout
            self.assertNotIn("✗", d)
            self.assertNotIn("changed since install", d)
        finally:
            shutil.rmtree(src, ignore_errors=True)

    def test_update_replaces_an_old_helper_copy_doctor_rejects(self):
        """#905: an older helper without the SHEP block that doctor rejects is an old copy, not the person's edit: it is
        backed up and Shepherdr's goes in, so doctor passes (and later updates aren't stuck on it)."""
        helpers = {"bin/herdr-secret": f"{APP}/bin/herdr-secret", "mods/artifacts/bin/herdr-artifact": f"{APP}/mods/artifacts/bin/herdr-artifact"}
        run("install", "--root", self.root, "--yes")
        for src_rel, dst in helpers.items():
            with open(self.p(dst), "rb") as f:
                text = f.read().decode()
            a = text.index("# ---- SHEP:")
            b = text.index("# ---- end SHEP ----")
            b = text.index("\n", b) + 1
            with open(self.p(dst), "w") as f:       # the older copy: no SHEP block
                f.write(text[:a] + text[b:])
        self.assertIn("has no SHEP block", run("doctor", "--root", self.root, ok=False).stdout)
        up = run("update", "--root", self.root, "--yes").stdout
        for src_rel, dst in helpers.items():
            with open(self.p(dst), "rb") as f, open(os.path.join(ROOT, src_rel), "rb") as g:
                self.assertEqual(f.read(), g.read(), dst)
            self.assertIn(f"replaced {dst}: an older Shepherdr's copy", up)
        backup = re.search(r"replaced .*?kept as (\S+?)\.?$", up, re.M).group(1)
        self.assertTrue(os.path.isfile(backup))
        d = run("doctor", "--root", self.root).stdout
        self.assertNotIn("✗", d)

    def test_update_says_loudly_when_the_install_is_not_whole(self):
        """An update that goes in but leaves doctor failing says so at its end, with the ✗ lines and no 'done'."""
        run("install", "--root", self.root, "--yes")
        with open(self.p(APP, "mods/toasts/ui.js"), "a") as f:
            f.write("// hand copy\n")
        up = run("update", "--root", self.root, "--yes").stdout
        self.assertIn("✗ shared lib copies differ", up)
        self.assertIn("NOT DONE: the install isn't whole", up)
        self.assertNotIn("  done. Next:", up)
        run("doctor", "--root", self.root, ok=False)

    def test_doctor_says_why_not_shared(self):
        """doctor (GitHub #754): when tailscale serve refused the share, it's broken (not a note), in tailscale's own
        words with another port to use; a custom port is named."""
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
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
        from importlib.machinery import SourceFileLoader
        from unittest import mock
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
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

    def test_service_answers(self):
        """doctor and install trust only Shepherdr's own service on its port: the id it wrote in service.json, not
        another app answering health there (GitHub #635)."""
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()

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

    def test_web_only(self):
        """install --web: the service, the web app, herdr-task and the helpers under .local/share/shepherdr, linked from
        .local/bin; nothing in herdr-app; herdr-task runs from there; uninstall takes it all back out."""
        root = tempfile.mkdtemp(prefix="shepherdr-web-")
        try:
            run("install", "--web", "--root", root, "--yes", "--force")
            share = os.path.join(root, ".local/share/shepherdr")
            self.assertFalse(os.path.exists(os.path.join(root, APP)))
            self.assertTrue(os.path.isfile(os.path.join(share, "service/main.ts")))
            self.assertEqual(os.path.realpath(os.path.join(root, ".local/bin/herdr-task")), os.path.realpath(os.path.join(share, "mods/tasks/bin/herdr-task")))
            self.assertTrue(os.path.isfile(os.path.join(share, "mods/artifacts/recipe-view.js")))
            # SHEP-181: restarting an Assistant from the web needs no window layout
            self.assertTrue(os.path.isfile(os.path.join(share, "mods/coordinator/restart.sh")))
            p = subprocess.run([sys.executable, os.path.join(share, "mods/tasks/bin/herdr-task"), "--help"], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            # #735: the artifact guide comes along (agents on the machine serving the web app read it too)
            p = subprocess.run([sys.executable, os.path.join(share, "mods/artifacts/bin/herdr-artifact"), "guide"], capture_output=True, text=True,
                               env={**os.environ, "HOME": root})
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn("recipe", p.stdout)
            run("uninstall", "--root", root)
            self.assertFalse(os.path.exists(os.path.join(share, "service/main.ts")))
            self.assertFalse(os.path.lexists(os.path.join(root, ".local/bin/herdr-task")))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_web_pack_installs_another_machine(self):
        """Serve from: what `shepherdr web install-on` sends (pack) installs web-only from itself, the installed folder
        is a whole source to send on again, and uninstall puts back the helper it replaced."""
        if not os.path.isfile(os.path.join(ROOT, "web", "dist", "index.html")):
            self.skipTest("the web app isn't built in this checkout")
        import io
        import tarfile
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
        root, src = tempfile.mkdtemp(prefix="shepherdr-there-"), tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            tarfile.open(fileobj=io.BytesIO(sh.pack(ROOT))).extractall(src)
            os.makedirs(os.path.join(root, ".local/bin"))
            with open(os.path.join(root, ".local/bin/herdr-task"), "w") as f:
                f.write("#!/bin/sh\necho the old one\n")
            run("install", "--web", "--root", root, "--source", src, "--yes", "--force")
            share = os.path.join(root, ".local/share/shepherdr")
            for f in ("install.sh", "bin/shepherdr", "templates/worker.md", "web/dist/index.html", "service/serve-from.ts", "core/host.js",
                      "mods/artifacts/ARTIFACTS.md"):
                self.assertTrue(os.path.isfile(os.path.join(share, f)), f)
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
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
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

    def test_update_web_only(self):
        """A web-only install updates web only (the record says so), and doctor says how; one whose source is gone says
        that instead of updating from itself."""
        import io
        import tarfile
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
        root, src = tempfile.mkdtemp(prefix="shepherdr-web-"), tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            run("install", "--web", "--root", root, "--yes", "--force")
            share = os.path.join(root, ".local/share/shepherdr")
            os.remove(os.path.join(share, "service/main.ts"))
            out = run("update", "--root", root, "--yes", "--force").stdout
            self.assertIn("web-only update", out)
            self.assertTrue(os.path.isfile(os.path.join(share, "service/main.ts")))
            self.assertFalse(os.path.exists(os.path.join(root, APP)), "a web-only update doesn't install the layout")
            self.assertIn("to update:", run("doctor", "--root", root).stdout)
            self.assertIn("shepherdr update", run("doctor", "--root", root).stdout)
            # installed from a copy that's gone since: no update from the installed folder itself
            tarfile.open(fileobj=io.BytesIO(sh.pack(ROOT))).extractall(src)
            run("install", "--web", "--root", root, "--source", src, "--yes", "--force")
            shutil.rmtree(src)
            p = run("update", "--root", root, "--yes", "--force", ok=False)
            self.assertEqual(p.returncode, 1)
            self.assertIn("is gone", p.stderr)
            self.assertIn("is gone", run("doctor", "--root", root).stdout)
        finally:
            shutil.rmtree(root, ignore_errors=True)
            shutil.rmtree(src, ignore_errors=True)

    def test_web_only_update_retires_what_it_no_longer_ships(self):
        """The web-only install retires its files the same way: a template an older release shipped goes, and a changed
        one is backed up and said; the record forgets it."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        root = tempfile.mkdtemp(prefix="shepherdr-web-")
        try:
            old = os.path.join(src, "old")
            shutil.copytree(ROOT, old, ignore=shutil.ignore_patterns(".git", "node_modules"))
            with open(os.path.join(old, "templates", "retired.md"), "w") as f:
                f.write("# retired\n")
            run("install", "--web", "--root", root, "--source", old, "--yes", "--force")
            tpl = os.path.join(root, ".config/herdr-core/templates/retired.md")
            self.assertTrue(os.path.isfile(tpl))
            with open(tpl, "a") as f:
                f.write("mine\n")
            up = run("update", "--web", "--root", root, "--yes", "--force", "--source", ROOT).stdout
            self.assertFalse(os.path.exists(tpl))
            backup = re.search(r"templates/retired\.md: Shepherdr no longer ships it; your changed copy is in (\S+)", up).group(1)
            with open(backup) as f:
                self.assertTrue(f.read().endswith("mine\n"))
            rec = json.load(open(os.path.join(root, ".local/share/shepherdr/installed.json")))
            self.assertNotIn(".config/herdr-core/templates/retired.md", rec["files"])
            self.assertIn("service/main.ts", " ".join(rec["files"]))
        finally:
            shutil.rmtree(src, ignore_errors=True)
            shutil.rmtree(root, ignore_errors=True)

    def test_update_runs_the_new_installer(self):
        """`shepherdr update` is the installed (old) copy: after a release it hands over to the source's installer, so
        one run records the new version (SHEP-28 had to run it twice)."""
        src = tempfile.mkdtemp(prefix="shepherdr-src-")
        try:
            s = os.path.join(src, "s")
            shutil.copytree(ROOT, s, ignore=shutil.ignore_patterns(".git", "node_modules"))
            run("install", "--root", self.root, "--source", s, "--yes")
            installed = self.p(APP, "bin/shepherdr")
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
            self.assertEqual(json.load(open(self.p(APP, "data/shepherdr/installed.json")))["version"], "9.9.9")
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

    def test_web_stale(self):
        """When the installer builds the web app: missing, or older than anything it's built from (not its outputs);
        a source without web/src (an installed folder) never."""
        from importlib.machinery import SourceFileLoader
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
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


class AudioTools(unittest.TestCase):
    def test_doctor_names_the_mic_and_speaker_tools_per_platform(self):
        """Linux names pw-record and pw-play; a Mac names Apple's command line tools (swiftc) instead."""
        from importlib.machinery import SourceFileLoader
        from unittest import mock
        sh = SourceFileLoader("shepherdr_cli", SHEPHERDR).load_module()
        for platform, want, not_want in (("linux", ["pw-record", "pw-play"], "swiftc"), ("darwin", ["swiftc"], "pw-record")):
            with mock.patch.object(sh.sys, "platform", platform), mock.patch.object(sh.shutil, "which", lambda n: None):
                notes = "\n".join(sh.check_tools(False)[1])
            for name in want:
                self.assertIn(f"optional: {name} isn't on the PATH", notes)
            self.assertNotIn(not_want, notes)


# A stand-in for agent-browser's release binary: says its version, has Chrome once `install` ran (unless told it fails)
FAKE_RELEASE = """#!/bin/sh
case "$1" in
  --version) echo "agent-browser 0.41.1" ;;
  doctor) if [ -f "$HOME/chrome" ]; then s=pass; else s=fail; fi; echo "{\\"checks\\":[{\\"id\\":\\"chrome.installed\\",\\"status\\":\\"$s\\"}]}" ;;
  install) if [ -n "$FAKE_CHROME_FAILS" ]; then echo "Chrome CDN unreachable" >&2; exit 1; fi; : > "$HOME/chrome" ;;
  *) echo "mine $*" ;;
esac
"""
PLATFORMS = ("darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "linux-musl-arm64", "linux-musl-x64")


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
                f.write(f'#!/bin/sh\n[ "$1" = --version ] && {{ echo "agent-browser {version}"; exit 0; }}\necho "path $*"\n')
            os.chmod(os.path.join(d, "agent-browser"), 0o755)
        return d

    def hbr(self, *args, path=None, url=None, sha=None, **extra):
        env = {"HOME": self.home, "PATH": f"{path or self.on_path(None)}:/usr/bin:/bin",
               "HERDR_BROWSER_URL": url or "file://" + self.rel, "HERDR_BROWSER_SHA256": sha or self.sha, **extra}
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
