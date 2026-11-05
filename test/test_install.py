"""The installer against scratch roots (--root): install, run again, update with a changed file,
clashes, --adopt, uninstall. Never touches the real home."""
import re
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
        self.assertEqual(rec["version"], "3.1.9")
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
            p = subprocess.run([sys.executable, os.path.join(share, "mods/tasks/bin/herdr-task"), "--help"], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
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
            for f in ("install.sh", "bin/shepherdr", "templates/worker.md", "web/dist/index.html", "service/serve-from.ts", "core/host.js"):
                self.assertTrue(os.path.isfile(os.path.join(share, f)), f)
            names = lambda b: sorted(tarfile.open(fileobj=io.BytesIO(b)).getnames())
            self.assertEqual(names(sh.pack(share)), names(sh.pack(ROOT)))
            run("uninstall", "--root", root)
            self.assertEqual(open(os.path.join(root, ".local/bin/herdr-task")).read(), "#!/bin/sh\necho the old one\n")
        finally:
            shutil.rmtree(root, ignore_errors=True)
            shutil.rmtree(src, ignore_errors=True)

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


if __name__ == "__main__":
    unittest.main()
