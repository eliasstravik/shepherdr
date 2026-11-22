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
            if not os.path.isfile(os.path.join(ROOT, rel)):
                continue  # 3.2: the window's mods are gone
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


class NoAddons(unittest.TestCase):
    """3.2: add-ons are gone (the web app's plugins are switched in the service's settings). herdr-task has no `addons`
    command, the sync to other machines has no switch, and nothing reads lib/addons.json."""

    def test_no_addons_command_or_module(self):
        self.assertFalse(os.path.exists(os.path.join(BIN, "herdr_task", "addons.py")))
        home = scratch(self)
        env = {"HOME": home, "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HERDR_TASK_STORE": os.path.join(home, "tasks")}
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "addons", "--json"], env=env, capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("invalid choice", r.stderr)

    def test_nothing_reads_the_addons_manifest(self):
        for folder, _, names in os.walk(os.path.join(BIN, "herdr_task")):
            for n in names:
                if n.endswith(".py"):
                    with open(os.path.join(folder, n)) as f:
                        text = f.read()
                    self.assertNotIn("addons.json", text, n)
                    self.assertNotIn("herdr-task addons", text, n)
        with open(os.path.join(ROOT, "bin", "shepherdr")) as f:
            self.assertNotIn("herdr-task addons", f.read())

    def test_3_1s_other_machines_switch_is_ignored(self):
        from unittest import mock
        from herdr_task import base
        p = os.path.join(scratch(self), "s.json")
        with open(p, "w") as f:
            json.dump({"everywhere": {"off": ["machines", "chat", "browser"]}}, f)
        with mock.patch.dict(os.environ, {"HERDR_TASK_SETTINGS": p}):
            self.assertFalse(base.plugin_off("machines"))
            self.assertFalse(base.addon_off("browser"))
            with mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": {}}, [])):
                with self.assertRaises(base.Fail) as e:
                    machines.tell("vm-demo/t3", "hi")
        self.assertNotIn("add-on", str(e.exception))


class SourceMachine(unittest.TestCase):
    """3.2: the machine that holds herdr-task's source is the one with Shepherdr's own install
    (~/.local/share/shepherdr/mods/tasks/bin/herdr_task); 3.1's place in Herdr's app folder still counts."""

    def check(self, made):
        home = scratch(self)
        if made:
            os.makedirs(os.path.join(home, made))
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(".local/bin/x")),
                           env={"HOME": home, "PATH": os.environ.get("PATH", "")}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout.strip().splitlines()[-1]), os.path.exists(os.path.join(home, ".local", "bin", "x"))

    def test_the_install_script_never_writes_where_the_source_is(self):
        for made in (".local/share/shepherdr/mods/tasks/bin/herdr_task", ".config/herdr-app/mods/tasks/bin/herdr_task"):
            out, wrote = self.check(made)
            self.assertEqual((out["source"], out["files"], wrote), (True, {".local/bin/x": "source here"}, False), made)
        out, wrote = self.check(None)
        self.assertEqual((out["source"], out["files"], wrote), (False, {".local/bin/x": "installed"}, True))

    def test_the_question_asked_there_is_the_same_rule(self):
        from herdr_task import cli
        for made, want in ((".local/share/shepherdr/mods/tasks/bin/herdr_task", 0), (".config/herdr-app/mods/tasks/bin/herdr_task", 0), ("elsewhere", 1)):
            home = scratch(self)
            os.makedirs(os.path.join(home, made))
            r = subprocess.run(["sh", "-c", cli.HAS_SOURCE], env={"HOME": home, "PATH": os.environ.get("PATH", "")})
            self.assertEqual(r.returncode, want, made)


class InstalledVersion(unittest.TestCase):
    """feedback's version line reads the install's record where 3.2 keeps it (<SHARE>/installed.json), 3.1's only
    on a machine that hasn't switched."""

    def test_the_record_in_shepherdrs_own_folder_first(self):
        from unittest import mock
        from herdr_task import feedback
        share, home, app = scratch(self), scratch(self), scratch(self)
        with mock.patch.object(feedback, "SHARE", share), mock.patch.object(feedback, "HOME", home), mock.patch.object(feedback, "APP_HOME", app):
            self.assertEqual(feedback.shepherdr_version(), "unknown")
            os.makedirs(os.path.join(app, "data", "shepherdr"))
            with open(os.path.join(app, "data", "shepherdr", "installed.json"), "w") as f:
                json.dump({"version": "3.1.46"}, f)
            self.assertEqual(feedback.shepherdr_version(), "3.1.46")
            with open(os.path.join(share, "installed.json"), "w") as f:
                json.dump({"version": "3.2.0"}, f)
            self.assertEqual(feedback.shepherdr_version(), "3.2.0")


class ServingMachine(unittest.TestCase):
    """3.2: the home round (every machine's news to Everything) is the scheduler's on the machine that serves the web
    app: a service runs here, and Serve from's record names this machine or there is none."""

    def setUp(self):
        from unittest import mock
        from herdr_task import home
        self.home, self.dir = home, scratch(self)
        self.core, self.svc = os.path.join(self.dir, "core"), os.path.join(self.dir, "service")
        os.makedirs(self.core)
        os.makedirs(self.svc)

        def core_file(name):
            try:
                with open(os.path.join(self.core, name)) as f:
                    return json.load(f)
            except (OSError, ValueError):
                return None
        where = mock.Mock()
        where.path = lambda kind: self.svc if kind == "service" else os.path.join(self.dir, kind)
        for name, value in (("_core_file", core_file), ("WHERE", where)):
            p = mock.patch.object(home, name, value)
            p.start()
            self.addCleanup(p.stop)

    def put(self, name, value, folder=None):
        with open(os.path.join(folder or self.core, name), "w") as f:
            json.dump(value, f)

    def test_only_where_the_service_runs_and_serves(self):
        self.put("core.json", {"id": "id-here", "name": "here"})
        self.assertFalse(self.home.main_here(), "no service here (a machine that only runs tasks)")
        self.put("service.json", {"port": 7788, "id": "x", "pid": os.getpid()}, self.svc)
        self.assertTrue(self.home.main_here(), "no Serve from record: a machine with a service serves itself")
        self.put("docs.json", {"shepherdr.host": {"value": {"id": "id-other", "at": 1}, "version": 1}})
        self.assertFalse(self.home.main_here(), "another machine serves")
        self.put("docs.json", {"shepherdr.host": {"value": {"id": "id-here", "at": 2}, "version": 2}})
        self.assertTrue(self.home.main_here())
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        self.put("service.json", {"port": 7788, "id": "x", "pid": dead.pid}, self.svc)
        self.assertFalse(self.home.main_here(), "its service is gone (a stale service.json)")

    def test_the_serving_machine_keeps_a_scheduler(self):
        from unittest import mock
        from herdr_task import scheduler
        ran = []
        ok = subprocess.CompletedProcess([], 0, "{}", "")
        with mock.patch.object(scheduler, "store_files", lambda: []), mock.patch.object(scheduler, "hc_json", lambda *a: None), \
                mock.patch.object(scheduler, "run", lambda argv, **k: ran.append(argv) or ok):
            with mock.patch.object(self.home, "main_here", lambda: False):
                self.assertFalse(scheduler.ensure_scheduler()["started"])
            with mock.patch.object(self.home, "main_here", lambda: True):
                self.assertTrue(scheduler.ensure_scheduler()["started"])
        self.assertEqual(ran[-1][:3], ["hc", "run", "--bg"])


class CarryOver(unittest.TestCase):
    """3.2's switch (herdr-task carry-over): the default herdr-core session's documents go into Shepherdr's own, once,
    with each machine's id changed to its id there; nothing in Shepherdr's session is replaced; 3.1's scheduler in the
    default session is removed, and only that. Two fake cores stand in for the sessions: no hc runs."""

    def setUp(self):
        from unittest import mock
        from herdr_task import carry_over as co
        self.co, self.mock = co, mock
        self.dir = scratch(self)
        os.makedirs(os.path.join(self.dir, "herdr-core", co.OLD_SESSION))
        open(os.path.join(self.dir, "herdr-core", co.OLD_SESSION, "core.json"), "w").close()
        # each session: its own id, its machines (name -> {id, state}), its documents, and each linked machine's
        self.cores = {co.OLD_SESSION: {"id": "old-here", "machines": {"mini": {"id": "old-mini", "state": "connected"}}, "docs": {}, "there": {"mini": {}}},
                      co.SESSION: {"id": "new-here", "machines": {"mini": {"id": "new-mini", "state": "connected"}}, "docs": {}, "there": {"mini": {}}}}
        self.sets, self.real_old_scheduler = [], co.old_scheduler

        def rpc(session, calls, timeout=60):
            c, out = self.cores[session], []
            for method, p in calls:
                docs = c["there"][p["on"]] if p.get("on") else c["docs"]
                if method == "server.status":
                    out.append({"core": {"id": c["id"]}})
                elif method == "machine.list":
                    out.append({"machines": [{"name": n, **m} for n, m in c["machines"].items()]})
                elif method == "doc.get":
                    out.append(dict(docs.get(p["name"]) or {"value": None, "version": 0}))
                elif method == "doc.set":
                    have = (docs.get(p["name"]) or {}).get("version", 0)
                    if p["version"] != have:
                        out.append({"error": {"message": "conflict", "data": {"kind": "conflict"}}})
                        continue
                    self.sets.append((session, p.get("on"), p["name"]))
                    docs[p["name"]] = {"value": p["value"], "version": have + 1}
                    out.append({"version": have + 1})
            return out
        import herdr_task.machines as m
        for target, name, value in ((co, "rpc", rpc), (co, "core_dir", lambda s: os.path.join(self.dir, "herdr-core", s)),
                                    (co, "old_scheduler", lambda dry: "none"), (m, "adopt", lambda dry=False: [{"name": "mini", "state": "here"}]),
                                    (co, "FOREIGN_SESSION", False), (co.time, "sleep", lambda s: None)):
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def old(self, name, value, on=None):
        c = self.cores[self.co.OLD_SESSION]
        (c["there"][on] if on else c["docs"])[name] = {"value": value, "version": 3}

    def new(self, name, on=None):
        c = self.cores[self.co.SESSION]
        return ((c["there"][on] if on else c["docs"]).get(name) or {}).get("value")

    def states(self, out):
        return {(d["name"], d.get("machine")): d["state"] for d in out["documents"]}

    def test_every_document_once_with_the_ids_of_shepherdrs_session(self):
        self.old("shepherdr", {"spaces": [{"id": "sp1", "name": "shop", "folder": "/w/shop", "machine": None}], "by": "old-here", "seen": {"old-mini": 4}})
        self.old("shepherdr.secrets", {"id": "old-here", "at": 5, "by": "old-mini"})
        self.old("shepherdr.host", {"id": "old-mini", "at": 7})
        self.old("herdr-app", {"spaces": [{"id": "sp1", "name": "shop"}]})
        self.old("herdr-app", {"spaces": [{"id": "sp7", "name": "there"}]}, on="mini")
        dry = self.co.carry_over(dry=True)
        self.assertEqual(self.sets, [], "a dry run writes nothing")
        self.assertEqual(self.states(dry)[("shepherdr", None)], "would-copy")
        out = self.co.carry_over()
        self.assertTrue(out["ok"])
        self.assertEqual(self.states(out), {("shepherdr", None): "copied", ("shepherdr.secrets", None): "copied", ("shepherdr.host", None): "copied",
                                            ("shepherdr.web", None): "none", ("herdr-app", None): "copied", ("herdr-app", "mini"): "copied"})
        self.assertEqual(self.new("shepherdr"), {"spaces": [{"id": "sp1", "name": "shop", "folder": "/w/shop", "machine": None}], "by": "new-here", "seen": {"new-mini": 4}})
        self.assertEqual(self.new("shepherdr.secrets"), {"id": "new-here", "at": 5, "by": "new-mini"})
        self.assertEqual(self.new("shepherdr.host"), {"id": "new-mini", "at": 7})
        self.assertEqual(self.new("herdr-app", on="mini"), {"spaces": [{"id": "sp7", "name": "there"}]})
        self.assertTrue(all(s == self.co.SESSION for s, _, _ in self.sets), "the default session is only read")
        # again: nothing is written, whatever changed in the old session since
        n = len(self.sets)
        self.old("shepherdr", {"spaces": [], "by": "old-here"})
        again = self.co.carry_over()
        self.assertEqual(len(self.sets), n)
        self.assertEqual(set(self.states(again).values()), {"kept", "none"})
        self.assertEqual(self.new("shepherdr")["spaces"][0]["id"], "sp1")

    def test_what_shepherdrs_session_has_is_never_replaced(self):
        self.old("shepherdr", {"spaces": [{"id": "old"}]})
        self.old("shepherdr.host", {"id": "old-here", "at": 1})
        self.cores[self.co.SESSION]["docs"]["shepherdr"] = {"value": {"spaces": [{"id": "newer"}]}, "version": 9}
        self.cores[self.co.SESSION]["docs"]["shepherdr.host"] = {"value": {}, "version": 2}   # an empty one counts as none
        out = self.co.carry_over()
        self.assertEqual((self.states(out)[("shepherdr", None)], self.states(out)[("shepherdr.host", None)]), ("kept", "copied"))
        self.assertEqual(self.new("shepherdr"), {"spaces": [{"id": "newer"}]})
        self.assertEqual(self.new("shepherdr.host"), {"id": "new-here", "at": 1})

    def test_a_record_naming_a_machine_not_connected_yet_waits(self):
        self.old("shepherdr.host", {"id": "old-mini", "at": 7})
        self.old("herdr-app", {"spaces": [{"id": "sp7"}]}, on="mini")
        self.cores[self.co.SESSION]["machines"]["mini"] = {"id": None, "state": "connecting"}
        out = self.co.carry_over(wait=3)
        rows = {(d["name"], d.get("machine")): d for d in out["documents"]}
        self.assertEqual(rows[("shepherdr.host", None)]["state"], "waiting")
        self.assertIn("mini", rows[("shepherdr.host", None)]["why"])
        self.assertEqual(rows[("herdr-app", "mini")]["state"], "waiting")
        self.assertTrue(out["ok"], "waiting isn't a failure: a later run copies it")
        self.assertIsNone(self.new("shepherdr.host"))
        # the link is up: the next run copies both
        self.cores[self.co.SESSION]["machines"]["mini"] = {"id": "new-mini", "state": "connected"}
        out = self.co.carry_over()
        self.assertEqual((self.new("shepherdr.host"), self.new("herdr-app", on="mini")), ({"id": "new-mini", "at": 7}, {"spaces": [{"id": "sp7"}]}))

    def test_no_default_session_here_nothing_to_do(self):
        os.remove(os.path.join(self.dir, "herdr-core", self.co.OLD_SESSION, "core.json"))
        out = self.co.carry_over()
        self.assertEqual((out["documents"], out["machines"], out["ok"]), ([], [], True))
        self.assertIn("nothing to carry over", out["note"])

    def test_only_3_1s_scheduler_is_removed(self):
        co, calls = self.co, []
        terminals = {"herdr-automations": {"address": "t4", "name": "herdr-automations", "state": "live",
                                           "argv": ["/usr/bin/python3", "/h/.config/herdr-app/mods/tasks/bin/herdr-task", "scheduler"]}}

        def run(argv, env=None, **k):
            calls.append((argv, (env or {}).get("HC_SESSION")))
            t = terminals.get(argv[2])
            if argv[1] == "get":
                return subprocess.CompletedProcess(argv, 0 if t else 1, json.dumps(t) if t else "", "")
            if argv[1] == "rm":
                terminals.pop(argv[2], None)
            return subprocess.CompletedProcess(argv, 0, "", "")
        with self.mock.patch.object(co.subprocess, "run", run), self.mock.patch.object(co, "guard", lambda a: None), \
                self.mock.patch.object(co, "OLD_SESSION", "old-one"), self.mock.patch.object(co, "old_scheduler", self.real_old_scheduler):
            self.assertEqual(co.old_scheduler(True), "would-remove")
            self.assertEqual(len(calls), 1)
            self.assertEqual(co.old_scheduler(False), "removed")
            self.assertEqual([c[0][1:3] for c in calls[2:]], [["kill", "herdr-automations"], ["rm", "herdr-automations"]])
            self.assertTrue(all(session == "old-one" for _, session in calls), "every call is in the old session, by name")
            self.assertEqual(co.old_scheduler(False), "none")
            # someone else's terminal by that name: left alone
            terminals["herdr-automations"] = {"address": "t9", "name": "herdr-automations", "state": "live", "argv": ["vim", "scheduler"]}
            n = len(calls)
            self.assertEqual(co.old_scheduler(False), "not ours")
            self.assertEqual(len(calls), n + 1)

    def test_the_default_session_is_asked_without_a_session_name(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"HC_SESSION": "shepherdr", "HC_TERMINAL_ID": "t1", "HC_SOCKET": "/x"}):
            self.assertNotIn("HC_SESSION", self.co.session_env("default"))
            env = self.co.session_env("shepherdr")
            self.assertEqual(env["HC_SESSION"], "shepherdr")
            self.assertFalse({"HC_TERMINAL_ID", "HC_SOCKET"} & set(env))


class InstallerCarriesOver(unittest.TestCase):
    """bin/shepherdr runs `herdr-task carry-over` at the switch, on the real home only, and never stops the install."""

    def setUp(self):
        import importlib.machinery
        import importlib.util
        loader = importlib.machinery.SourceFileLoader("shepherdr_bin_co", os.path.join(ROOT, "bin", "shepherdr"))
        spec = importlib.util.spec_from_loader("shepherdr_bin_co", loader)
        self.sh = importlib.util.module_from_spec(spec)
        loader.exec_module(self.sh)

    def go(self, answer, home=True, dry=False, code=0):
        ran, rec = [], {}

        def run(argv, **k):
            ran.append((argv, k.get("env") or {}))
            if isinstance(answer, Exception):
                raise answer
            return subprocess.CompletedProcess(argv, code, json.dumps(answer) if answer is not None else "", "boom")
        r = self.sh.Run(scratch(self), dry)
        from unittest import mock
        with mock.patch.object(self.sh, "say", lambda *a: None):
            self.sh.carry_over_session(r, rec, home, run=run)
        return ran, rec, r.notes

    def test_it_runs_the_installed_herdr_task_once_the_files_are_in(self):
        ran, rec, notes = self.go({"ok": True, "machines": [{"name": "mini", "state": "added"}], "documents": [{"name": "shepherdr", "state": "copied"}], "scheduler": "removed"})
        [(argv, env)] = ran
        self.assertEqual(argv[1:], [os.path.join(os.path.dirname(argv[1]), "herdr-task"), "carry-over", "--json"])
        self.assertTrue(argv[1].endswith(".local/share/shepherdr/mods/tasks/bin/herdr-task"), argv[1])
        self.assertNotIn("HC_SESSION", env)
        self.assertEqual((rec, notes), ({"carry_over": "done"}, []))

    def test_what_waits_is_a_note_and_the_next_update_tries_again(self):
        _, rec, notes = self.go({"ok": True, "machines": [], "documents": [{"name": "shepherdr.host", "state": "waiting", "why": "it names mini"}], "scheduler": "none"})
        self.assertEqual(rec, {"carry_over": "waiting"})
        self.assertIn("shepherdr.host (it names mini)", notes[0])
        for bad in (None, OSError("no python")):
            _, rec, notes = self.go(bad, code=1)
            self.assertEqual(rec, {"carry_over": "waiting"})
            self.assertIn("herdr-task carry-over", notes[0])

    def test_never_on_a_scratch_root_or_a_dry_run(self):
        self.assertEqual(self.go({"ok": True}, home=False)[0], [])
        self.assertEqual(self.go({"ok": True}, dry=True)[0], [])

    def test_the_install_runs_it_before_the_service_starts(self):
        with open(os.path.join(ROOT, "bin", "shepherdr")) as f:
            text = f.read()
        body = text[text.index("def cmd_install("):text.index("# ---- doctor")]
        self.assertLess(body.index("move_data(r, a, home)"), body.index("carry_over_session(r, rec, home)"))
        self.assertLess(body.index("carry_over_session(r, rec, home)"), body.index("install_service(r, rec, home)"))
        self.assertIn('if switching or rec.get("carry_over") == "waiting":', body)


class TaskSpaceByRepo(unittest.TestCase):
    """#1209: a task started without --space by another space's Assistant belongs to its repo's own space, so its news
    go to that space's Assistant and no other."""

    def spaces(self, rows):
        from unittest import mock
        from herdr_task import launch
        # 3.2: the spaces come from herdr-core's shared document in Shepherdr's own session (no window is asked)
        state = scratch(self)
        docs = os.path.join(state, "herdr-core", "shepherdr")
        os.makedirs(docs)
        with open(os.path.join(docs, "docs.json"), "w") as f:
            json.dump({"herdr-app": {"value": {"spaces": rows}}}, f)
        asked = []
        for p in (mock.patch.dict(os.environ, {"XDG_STATE_HOME": state}),
                  mock.patch.object(launch, "run", lambda argv, **k: asked.append(argv)),
                  mock.patch.object(launch.shutil, "which", lambda n: "/x/herdr-app" if n == "herdr-app" else None)):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(lambda: self.assertEqual(asked, [], "a Herdr window was asked"))
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

    def test_no_document(self):
        from unittest import mock
        from herdr_task import launch
        with mock.patch.dict(os.environ, {"XDG_STATE_HOME": scratch(self)}):
            self.assertIsNone(launch.space_for_folder("/x", "sp1"))
            with self.assertRaises(launch.Fail):  # and no window's current space stands in for a caller's
                with mock.patch.object(launch, "caller_labels", lambda: {}):
                    launch.default_space()


if __name__ == "__main__":
    unittest.main()
