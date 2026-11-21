"""SHEP-286: news routing, Assistants and other machines (GitHub #1203, #1182, #1179, #1117, #1126, #1105, #1091, #1209)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)
sys.dont_write_bytecode = True

from herdr_task import machines  # noqa: E402

BUN = shutil.which("bun")


def scratch(test):
    d = tempfile.mkdtemp(prefix="shep286-")
    test.addCleanup(shutil.rmtree, d, True)
    return d


def install_payload(path, data=b"hello\n", op="install"):
    return {"op": op, "stamp": ".herdr/tools.json", "version": "t", "from": "test", "links": [], "touch": [],
            "files": [{"path": path, "data": base64.b64encode(data).decode(), "sha": hashlib.sha256(data).hexdigest(),
                       "mode": 0o644, "at": 1}]}


class WindowsMachine(unittest.TestCase):
    """#1203: the scripts run on a native-Windows machine (no os.uname there) say it isn't supported, never a traceback."""

    # What Windows' Python looks like to these scripts: no os.uname, platform.system() says Windows.
    WINDOWS = "import os, platform\ndel os.uname\nplatform.system = lambda: 'Windows'\n"

    def run_install(self, prelude=""):
        home = scratch(self)
        env = {"HOME": home, "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        r = subprocess.run([sys.executable, "-c", prelude + machines.INSTALL], input=json.dumps(install_payload(".local/bin/x")),
                           env=env, capture_output=True, text=True, timeout=60)
        return home, r

    def test_install_on_windows_says_unsupported_and_writes_nothing(self):
        home, r = self.run_install(self.WINDOWS)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout.splitlines()[-1])
        self.assertIn("Windows isn't supported", res["unsupported"])
        self.assertEqual(machines._verdict(res), ("unsupported", [res["unsupported"]]))
        self.assertFalse(os.path.exists(os.path.join(home, ".local", "bin", "x")))

    def test_install_without_uname_elsewhere_still_works(self):
        _home, r = self.run_install("import os\ndel os.uname\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout.splitlines()[-1])
        self.assertEqual(res["files"][".local/bin/x"], "installed")
        self.assertTrue(res["os"])

    def test_probe_without_uname(self):
        env = {"HOME": scratch(self), "PATH": "/nonexistent"}
        r = subprocess.run([sys.executable, "-c", "import sys; S = sys.stdin.read(); exec(" + repr(self.WINDOWS) + "); exec(S)",
                            json.dumps({"depth": 0, "seen": [], "timeout": 20})], input=machines.PROBE, env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout.splitlines()[-1])["os"], "Windows")

    def test_no_uname_left(self):
        for f in os.listdir(os.path.join(BIN, "herdr_task")):
            if f.endswith(".py"):
                with open(os.path.join(BIN, "herdr_task", f)) as fh:
                    self.assertNotIn("os.uname", fh.read(), f)


class TemplatesFollowXdg(unittest.TestCase):
    """#1182: herdr-core reads its templates from $XDG_CONFIG_HOME/herdr-core/templates; Shepherdr writes them there."""

    def test_sync_installs_templates_under_xdg_config_home(self):
        home = scratch(self)
        xdg = os.path.join(home, "elsewhere", "config")
        env = {"HOME": home, "XDG_CONFIG_HOME": xdg, "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        rel = ".config/herdr-core/templates/worker.md"
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(rel)), env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout.splitlines()[-1])["files"][rel], "installed")
        self.assertTrue(os.path.isfile(os.path.join(xdg, "herdr-core", "templates", "worker.md")))
        self.assertFalse(os.path.exists(os.path.join(home, rel)))

    def test_sync_without_xdg_keeps_dot_config(self):
        home = scratch(self)
        rel = ".config/herdr-core/templates/worker.md"
        env = {"HOME": home, "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(rel)), env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(home, rel)))

    def test_herdr_task_reads_templates_from_xdg(self):
        code = "import sys; sys.path.insert(0, sys.argv[1]); from herdr_task.settings import TEMPLATES; print(TEMPLATES)"
        for xdg, want in (("/x/cfg", "/x/cfg/herdr-core/templates"), ("", os.path.join(os.path.expanduser("~"), ".config/herdr-core/templates")),
                          ("relative", os.path.join(os.path.expanduser("~"), ".config/herdr-core/templates"))):
            env = {k: v for k, v in os.environ.items() if k not in ("XDG_CONFIG_HOME", "HERDR_TASK_TEMPLATES")}
            env["XDG_CONFIG_HOME"] = xdg
            out = subprocess.run([sys.executable, "-c", code, BIN], env=env, capture_output=True, text=True)
            self.assertEqual(out.stdout.strip(), want, out.stderr)

    def test_shell_and_js_say_the_same_folder(self):
        if not BUN:
            self.skipTest("no bun")
        r = subprocess.run([BUN, "-e", 'import * as P from "./core/paths.js"; console.log(JSON.stringify({sh: P.TEMPLATES_SH, '
                            'a: P.templatesDir("/h", {XDG_CONFIG_HOME: "/x/cfg"}), b: P.templatesDir("/h", {}), '
                            'c: P.paths("/h", {XDG_CONFIG_HOME: "/x/cfg", SHEPHERDR_HOME: "/s"}).templates, print: P.SH_PRINT}))'],
                           cwd=ROOT, capture_output=True, text=True)
        js = json.loads(r.stdout)
        self.assertEqual(js["a"], "/x/cfg/herdr-core/templates")
        self.assertEqual(js["b"], "/h/.config/herdr-core/templates")
        self.assertEqual(js["c"], "/x/cfg/herdr-core/templates")  # SHEPHERDR_HOME moves Shepherdr's, not Herdr's
        for xdg, want in (("/x/cfg/", "/x/cfg/herdr-core/templates"), ("", "/h/.config/herdr-core/templates"), ("rel", "/h/.config/herdr-core/templates")):
            out = subprocess.run(["sh", "-c", js["sh"] + 'printf %s "$SHEP_TEMPLATES"'], env={"HOME": "/h", "XDG_CONFIG_HOME": xdg, "PATH": "/usr/bin:/bin"},
                                 capture_output=True, text=True)
            self.assertEqual(out.stdout, want)
        home = scratch(self)
        out = subprocess.run(["sh", "-c", js["print"]], env={"HOME": home, "XDG_CONFIG_HOME": "/x/cfg", "PATH": "/usr/bin:/bin"},
                             capture_output=True, text=True)
        self.assertEqual(json.loads(out.stdout.strip().splitlines()[-1])["templates"], "/x/cfg/herdr-core/templates")

    def test_no_fixed_template_folder_left(self):
        """Every place that reads or writes the templates resolves the folder (the old fixed path only as a name)."""
        for rel in ("mods/chat/main.js", "mods/coordinator/main.js", "mods/coordinator/restart.sh", "mods/shepherdr-settings/main.js",
                    "service/spaces.ts", "service/serve-from.ts", "mods/tasks/bin/herdr_task/revive.py"):
            with open(os.path.join(ROOT, rel)) as f:
                text = f.read()
            self.assertNotIn("$HOME/.config/herdr-core/templates/", text.replace('SHEP_TEMPLATES="$HOME/.config/herdr-core/templates"', "")
                             .replace('tdir="$HOME/.config/herdr-core/templates"', ""), rel)
            self.assertNotIn("${home()}/.config/herdr-core", text, rel)
            self.assertNotIn('".config", "herdr-core", "templates"', text, rel)

    def test_installer_puts_templates_under_xdg_for_the_real_home_only(self):
        import importlib.machinery
        import importlib.util
        loader = importlib.machinery.SourceFileLoader("shepherdr_bin", os.path.join(ROOT, "bin", "shepherdr"))
        spec = importlib.util.spec_from_loader("shepherdr_bin", loader)
        sh = importlib.util.module_from_spec(spec)
        loader.exec_module(sh)
        home = sh.real_home()
        old = os.environ.get("XDG_CONFIG_HOME")
        self.addCleanup(lambda: os.environ.__setitem__("XDG_CONFIG_HOME", old) if old is not None else os.environ.pop("XDG_CONFIG_HOME", None))
        os.environ["XDG_CONFIG_HOME"] = os.path.join(home, "cfg")
        self.assertEqual(sh.tpl_rel(home), "cfg/herdr-core/templates")
        self.assertEqual(sh.tpl_rel(scratch(self)), ".config/herdr-core/templates")
        self.assertEqual(sh.tpl_rel(None), ".config/herdr-core/templates")
        os.environ["XDG_CONFIG_HOME"] = "relative"
        self.assertEqual(sh.tpl_rel(home), ".config/herdr-core/templates")


class BarePath(unittest.TestCase):
    """#1117: a launchd-started herdr-core runs helpers with PATH=/usr/bin:/bin; they still find hc in ~/.local/bin."""

    def fake_home(self):
        home = scratch(self)
        os.makedirs(os.path.join(home, ".local", "bin"))
        hc = os.path.join(home, ".local", "bin", "hc")
        with open(hc, "w") as f:
            f.write('#!/bin/sh\necho \'{"core":{"name":"vm-test"}}\'\n')
        os.chmod(hc, 0o755)
        return home

    def test_herdr_task_finds_hc(self):
        home = self.fake_home()
        code = ("import sys, subprocess; sys.path.insert(0, sys.argv[1]); import herdr_task.base as b, os;"
                "print(os.environ['PATH']); print(subprocess.run(['hc', 'server', 'status'], stdout=subprocess.PIPE, text=True).stdout.strip())")
        r = subprocess.run([sys.executable, "-c", code, BIN], env={"HOME": home, "PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        path, out = r.stdout.splitlines()
        self.assertTrue(path.startswith("/usr/bin:/bin:"), path)  # the person's order first
        self.assertEqual(json.loads(out)["core"]["name"], "vm-test")
        # run once more from that PATH: nothing doubles
        r = subprocess.run([sys.executable, "-c", code, BIN], env={"HOME": home, "PATH": path}, capture_output=True, text=True)
        self.assertEqual(r.stdout.splitlines()[0], path)

    def test_single_file_helpers_widen_path_too(self):
        home = self.fake_home()
        for helper in (os.path.join(ROOT, "bin", "herdr-secret"), os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")):
            with open(helper) as f:
                text = f.read()
            head = text[:text.index("# ---- SHEP:")]  # imports, HOME and the PATH fix
            code = head + "\nimport shutil\nprint(shutil.which('hc'))\n"
            r = subprocess.run([sys.executable, "-c", code], env={"HOME": home, "PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
            self.assertEqual(r.stdout.strip(), os.path.join(home, ".local", "bin", "hc"), helper + r.stderr)


class AddonOffSays(unittest.TestCase):
    """#1091: herdr-task obeys the add-ons switched off since 3.1.35; it now says so, and `herdr-task addons` switches one."""

    def herdr_task(self, *argv, settings=None):
        home = getattr(self, "home", None) or scratch(self)
        self.home = home
        self.settings = os.path.join(home, "settings.json")
        if settings is not None:
            with open(self.settings, "w") as f:
                json.dump(settings, f)
        env = {"HOME": home, "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HERDR_TASK_SETTINGS": self.settings,
               "HERDR_TASK_STORE": os.path.join(home, "tasks")}
        return subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), *argv], env=env, capture_output=True, text=True, timeout=60)

    def test_names_agree_with_the_manifest(self):
        from herdr_task import addons
        with open(os.path.join(ROOT, "lib", "addons.json")) as f:
            titles = {a["id"]: a["title"] for a in json.load(f)["addons"]}
        for k, v in addons.NAMES.items():
            self.assertEqual(titles.get(k), v, k)

    def test_list_and_switch_in_the_settings_file(self):
        r = self.herdr_task("addons", "--json", settings={"everywhere": {"off": ["machines", "autopilot"], "theme": "x"}})
        rows = {x["id"]: x["on"] for x in json.loads(r.stdout)["addons"]}
        self.assertEqual((rows["machines"], rows["autopilot"]), (False, False), r.stderr)
        r = self.herdr_task("addons", "on", "Other machines")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Other machines is on now", r.stdout)
        with open(self.settings) as f:
            d = json.load(f)
        self.assertEqual(d["everywhere"], {"off": ["autopilot"], "theme": "x"})
        r = self.herdr_task("addons", "on", "autopilot")
        with open(self.settings) as f:
            self.assertNotIn("off", json.load(f)["everywhere"])
        r = self.herdr_task("addons", "on", "nope")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("No add-on 'nope'", r.stderr)

    def test_a_pushed_copy_is_not_switched_here(self):
        r = self.herdr_task("addons", "on", "machines", settings={"pushed_from": "herdr-app", "everywhere": {"off": ["machines"]}})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("switch it there", r.stderr)

    def test_autopilot_list_says_it_is_off(self):
        r = self.herdr_task("autopilot", "list", settings={"everywhere": {"off": ["autopilot"]}})
        self.assertIn("The Autopilot add-on is off on this machine", r.stdout.splitlines()[0], r.stderr)
        r = self.herdr_task("autopilot", "list", "--json")
        self.assertIn("herdr-task addons on autopilot", json.loads(r.stdout)["addon_off"])

    def test_tell_says_other_machines_is_off(self):
        from unittest import mock
        from herdr_task import base
        p = os.path.join(scratch(self), "s.json")
        with open(p, "w") as f:
            json.dump({"everywhere": {"off": ["machines"]}}, f)
        with mock.patch.dict(os.environ, {"HERDR_TASK_SETTINGS": p}), mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": {}}, [])):
            with self.assertRaises(base.Fail) as e:
                machines.tell("vm-demo/t3", "hi")
        self.assertIn("The Other machines add-on is off", str(e.exception))
        self.assertIn("herdr-task addons on machines", str(e.exception))

    def test_doctor_names_an_off_addon(self):
        import importlib.machinery
        import importlib.util
        loader = importlib.machinery.SourceFileLoader("shepherdr_bin2", os.path.join(ROOT, "bin", "shepherdr"))
        spec = importlib.util.spec_from_loader("shepherdr_bin2", loader)
        sh = importlib.util.module_from_spec(spec)
        loader.exec_module(sh)
        root = scratch(self)
        path = sh.where_for(root).path("settings")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"everywhere": {"off": ["machines", "voice"]}}, f)
        notes = sh.addons_off_notes(root)
        self.assertEqual(len(notes), 1)
        self.assertIn("Other machines is off", notes[0])


class TaskSpaceByRepo(unittest.TestCase):
    """#1209: a task started without --space by another space's Assistant belongs to its repo's own space, so its news
    go to that space's Assistant and no other."""

    def spaces(self, rows):
        from unittest import mock
        from herdr_task import launch
        out = mock.Mock(stdout=json.dumps({"spaces": rows}), returncode=0)
        for p in (mock.patch.object(launch, "run", lambda argv, **k: out),
                  mock.patch.object(launch.shutil, "which", lambda n: "/x/herdr-app" if n == "herdr-app" else None)):
            p.start()
            self.addCleanup(p.stop)
        return launch

    def test_the_repos_space_not_the_callers(self):
        root = scratch(self)
        drama, folio = os.path.join(root, "dramabias"), os.path.join(root, "portfolio")
        os.makedirs(drama), os.makedirs(folio)
        launch = self.spaces([{"id": "sp1", "name": "portfolio", "folder": folio}, {"id": "sp2", "name": "dramabias", "folder": drama},
                              {"id": "vm/sp9", "name": "dramabias", "folder": drama, "machine": "vm"}])
        self.assertEqual(launch.space_for_folder(drama, "sp1"), "sp2")       # the portfolio Assistant starts a dramabias task
        self.assertEqual(launch.space_for_folder(drama, "sp2"), "sp2")
        self.assertEqual(launch.space_for_folder(os.path.join(root, "other"), "sp1"), None)  # no space of its own: the caller's

    def test_the_callers_space_when_it_is_in_that_repo(self):
        root = scratch(self)
        sub = os.path.join(root, "repo", "web")
        os.makedirs(sub)
        launch = self.spaces([{"id": "sp1", "folder": os.path.join(root, "repo")}, {"id": "sp2", "folder": sub}])
        self.assertEqual(launch.space_for_folder(os.path.join(root, "repo"), "sp2"), "sp2")
        self.assertIsNone(launch.space_for_folder(os.path.join(root, "repo"), None))  # two spaces in it: can't say

    def test_no_window(self):
        from unittest import mock
        from herdr_task import launch
        with mock.patch.object(launch.shutil, "which", lambda n: None):
            self.assertIsNone(launch.space_for_folder("/x", "sp1"))


if __name__ == "__main__":
    unittest.main()
