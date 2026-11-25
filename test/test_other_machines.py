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
        # each session's live terminals (hc ls / get / kill / run through co.hc_in), and what was asked of them
        self.terms = {co.OLD_SESSION: {}, co.SESSION: {}}
        self.hc_calls = []

        def hc_in(session, *args, timeout=60):
            self.hc_calls.append((session, list(args)))
            t = self.terms[session]
            if args[0] == "ls":
                return 0, json.dumps({"terminals": [{"address": a, "state": "live"} for a in t]}), ""
            if args[0] == "get":
                return (0, json.dumps(t[args[1]]), "") if args[1] in t else (1, "", "no such terminal")
            if args[0] == "kill":
                return (0, "", "") if t.pop(args[1], None) else (1, "", "no such terminal")
            if args[0] == "run":
                rest = list(args[1:])
                argv = rest[rest.index("--") + 1:]
                opts, labels, i = {}, {}, 0
                while rest[i] != "--":
                    if rest[i] in ("--label", "--on", "--cwd", "--name"):
                        if rest[i] == "--label":
                            k, _, v = rest[i + 1].partition("=")
                            labels[k] = v
                        else:
                            opts[rest[i]] = rest[i + 1]
                        i += 2
                    else:
                        opts[rest[i]] = True
                        i += 1
                if self.run_fails:
                    return 1, "", "the machine said no"
                addr = f"t{len(t) + 50}"
                t[(opts["--on"] + "/" if "--on" in opts else "") + addr] = {"address": addr, "state": "live", "labels": labels, "argv": argv,
                                                                          "cwd": opts.get("--cwd"), "name": opts.get("--name"), "keep": bool(opts.get("--keep")),
                                                                          "foreground": {"name": "claude"}, "status": {"state": "idle"}}
                return 0, json.dumps({"address": addr}), ""
            return 1, "", "unknown"
        self.run_fails = False
        import herdr_task.machines as m
        # SHEP-310: Shepherdr's session's links (hc machine ls), and what answers at each address now
        self.far = {"mini.test": {"id": "new-mini", "host": "mini-host", "session": co.SESSION}}
        self.link_calls = []

        def links():
            return [{"name": n, "target": "mini.test", "host": "mini-host", "session": co.SESSION, **x} for n, x in self.cores[co.SESSION]["machines"].items()]

        def hc_quiet(args, timeout=60):
            self.link_calls.append(list(args))
            ms = self.cores[co.SESSION]["machines"]
            if args[:2] == ["machine", "add"]:
                target = args[args.index("--via") + 1] if "--via" in args else args[2]
                far = self.far.get(target)
                if not far:
                    return 1, None, "ssh: could not resolve"
                name, session = args[args.index("--name") + 1], args[args.index("--session") + 1]
                ms[name] = {"id": far["id"], "state": "connected", "target": target, "host": far["host"], "session": far["session"] if session == co.SESSION else session}
                return 0, {"name": name, **ms[name]}, ""
            if args[:2] == ["machine", "rm"]:
                return (0, None, "") if ms.pop(args[2], None) else (1, None, "no such machine")
            if args[:2] == ["machine", "rename"]:
                ms[args[3]] = ms.pop(args[2])
                return 0, None, ""
            return 1, None, "unknown"
        for target, name, value in ((co, "hc_in", hc_in), (co, "rpc", rpc), (co, "core_dir", lambda s: os.path.join(self.dir, "herdr-core", s)),
                                    (co, "old_scheduler", lambda dry: "none"), (m, "adopt", lambda dry=False: [{"name": "mini", "state": "here"}]),
                                    (m, "connected_machines", links), (m, "_hc_quiet", hc_quiet),
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

    # ---- SHEP-295: Shepherdr's agents left in the default session ----

    LAUNCH = ["env", "HERDR_BROWSER_TASK=shop#3", "/bin/bash", "-ic", '"$@"; exec "$0" -i', "/bin/bash", "claude", "--model", "opus", "Your brief"]

    def agent(self, addr, labels, status="idle", session="c0ffee", **more):
        lb = dict(labels)
        if session:
            lb["herdr.resume"] = json.dumps({"kind": "claude", "session": session, "argv": ["claude", "--model", "opus"]})
        self.terms[self.co.OLD_SESSION][addr] = {"address": addr, "state": "live", "labels": lb, "argv": list(self.LAUNCH), "cwd": "/w/shop",
                                                 "name": f"n-{addr.replace('/', '-')}", "keep": True, "foreground": {"name": "claude"},
                                                 "status": {"state": status}, **more}

    def runs(self):
        return [(sess, a) for sess, a in self.hc_calls if a[0] in ("kill", "run")]

    def test_idle_agents_move_into_shepherdrs_session_on_their_own_conversation(self):
        co = self.co
        self.agent("t1", {"herdr.role": "coordinator", "herdr.coordinator.space": "sp1", "herdr.space": "sp1"}, session="aaa")
        self.agent("t2", {"herdr.task": "shop#3", "herdr.task.space": "sp1"}, status="done", session="bbb")
        self.terms[co.OLD_SESSION]["t3"] = {"address": "t3", "state": "live", "labels": {}, "argv": ["vim"], "foreground": {"name": "vim"}}
        dry = co.carry_over(dry=True)
        self.assertEqual({x["address"]: x["state"] for x in dry["agents"]}, {"t1": "would-move", "t2": "would-move"})
        self.assertEqual(self.runs(), [], "a dry run ends and starts nothing")
        out = co.carry_over()
        self.assertTrue(out["ok"])
        self.assertEqual({x["address"]: x["state"] for x in out["agents"]}, {"t1": "moved", "t2": "moved"})
        self.assertEqual(set(self.terms[co.OLD_SESSION]), {"t3"}, "only Shepherdr's agents leave the default session")
        new = {k["labels"].get("herdr.role") or "worker": k for k in self.terms[co.SESSION].values()}
        self.assertEqual(new["coordinator"]["argv"], self.LAUNCH[:6] + ["claude", "--model", "opus", "--resume", "aaa"])
        self.assertEqual(new["worker"]["argv"][-2:], ["--resume", "bbb"])
        self.assertEqual(new["worker"]["labels"], {"herdr.task": "shop#3", "herdr.task.space": "sp1"}, "same labels, its old record left behind")
        self.assertEqual((new["worker"]["cwd"], new["worker"]["name"], new["worker"]["keep"]), ("/w/shop", "n-t2", True))
        # each ended in the default session before it started in Shepherdr's (one conversation, never two at once)
        order = [(sess, a[0]) for sess, a in self.runs()]
        self.assertEqual(order, [(co.OLD_SESSION, "kill"), (co.SESSION, "run")] * 2)
        # again: nothing left to move, nothing ended or started
        n = len(self.runs())
        self.assertEqual(co.carry_over()["agents"], [])
        self.assertEqual(len(self.runs()), n)

    def test_an_agent_at_work_or_already_in_shepherdrs_session_is_left_and_said(self):
        co = self.co
        self.agent("t1", {"herdr.task": "shop#3"}, status="working")
        self.agent("t2", {"herdr.task": "shop#4"}, status="blocked")
        self.agent("t4", {"herdr.role": "coordinator", "herdr.coordinator.space": "sp1"})
        self.agent("t5", {"herdr.task": "shop#5"}, session=None)   # no record of its conversation
        self.terms[co.SESSION]["t9"] = {"address": "t9", "state": "live", "labels": {"herdr.role": "coordinator", "herdr.coordinator.space": "sp1"},
                                        "foreground": {"name": "claude"}}
        out = co.carry_over()
        rows = {x["address"]: x for x in out["agents"]}
        self.assertEqual({a: x["state"] for a, x in rows.items()}, {"t1": "waiting", "t2": "waiting", "t4": "kept", "t5": "stuck"})
        self.assertEqual(self.runs(), [], "nothing ended, nothing in Shepherdr's session replaced")
        self.assertIn("once it's idle", rows["t1"]["why"])
        self.assertIn("runs its own already", rows["t4"]["why"])
        self.assertIn("hc kill t4", rows["t4"]["why"])
        self.assertIn("herdr-task resume", rows["t5"]["why"])
        self.assertEqual(rows["t1"]["name"], "task #3 (shop)")
        self.assertTrue(out["ok"], "what waits isn't a failure")

    def test_the_terminal_running_it_and_a_parent_whose_children_stay_are_never_ended(self):
        co = self.co
        self.agent("t1", {"herdr.role": "coordinator", "herdr.coordinator.space": "sp1"})
        self.agent("t2", {"herdr.task": "shop#3"}, parent="t1", die_with_parent=True)
        self.agent("t3", {"herdr.task": "shop#4"}, status="working", parent="t1", die_with_parent=True)
        with self.mock.patch.dict(os.environ, {"SHEPHERDR_CARRY_CALLER": "t2"}):
            rows = {x["address"]: x for x in co.carry_over()["agents"]}
        self.assertEqual({a: x["state"] for a, x in rows.items()}, {"t1": "waiting", "t2": "waiting", "t3": "waiting"})
        self.assertIn("runs this carry-over", rows["t2"]["why"])
        self.assertIn("would end with it", rows["t1"]["why"])
        self.assertEqual(self.runs(), [])
        # its children idle now: they move first, then it
        self.terms[co.OLD_SESSION]["t3"]["status"] = {"state": "idle"}
        rows = {x["address"]: x["state"] for x in co.carry_over()["agents"]}
        self.assertEqual(rows, {"t1": "moved", "t2": "moved", "t3": "moved"})
        kills = [a[1] for sess, a in self.runs() if a[0] == "kill"]
        self.assertEqual(kills[-1], "t1")

    def test_another_machines_agent_moves_there_and_a_failed_start_says_how_to_go_on(self):
        co = self.co
        self.agent("mini/t3", {"herdr.task": "shop#3"})
        out = co.carry_over()
        [row] = out["agents"]
        self.assertEqual((row["state"], row["to"], row["name"]), ("moved", "mini/t50", "task #3 (shop) on mini"))
        [(_, run)] = [(s, a) for s, a in self.runs() if a[0] == "run"]
        self.assertEqual(run[run.index("--on") + 1], "mini")
        self.agent("t4", {"herdr.task": "shop#4"})
        self.run_fails = True
        out = co.carry_over()
        [row] = out["agents"]
        self.assertEqual(row["state"], "failed")
        self.assertIn("herdr-task resume", row["why"])
        self.assertFalse(out["ok"])

    def test_shep_305_a_carried_secrets_record_names_the_new_ids_only(self):
        self.old("shepherdr.secrets", {"id": "old-here", "at": 5, "by": "old-here", "auto": True})
        self.old("shepherdr.host", {"id": "old-here", "at": 6})
        self.old("shepherdr.web", {"link": "https://x.test/shepherdr", "id": "old-here"})
        out = self.co.carry_over()
        self.assertEqual(out["records"], [], "fresh copies name the new ids already: nothing to repair")
        self.assertEqual(self.new("shepherdr.secrets"), {"id": "new-here", "at": 5, "by": "new-here", "auto": True})
        self.assertEqual((self.new("shepherdr.host")["id"], self.new("shepherdr.web")["id"]), ("new-here", "new-here"))
        stale = {"old-here", "old-mini"}
        for docs in (self.cores[self.co.SESSION]["docs"], self.cores[self.co.SESSION]["there"]["mini"]):
            self.assertFalse(stale & set(json.dumps(docs).replace('"', " ").split()), docs)

    def test_shep_305_a_stale_record_from_3_2_0_is_repaired_here_and_on_linked_machines(self):
        # 3.2.0 left Shepherdr's session naming the default session's ids, here and on mini
        new = self.cores[self.co.SESSION]
        new["docs"]["shepherdr.secrets"] = {"value": {"id": "old-here", "at": 5, "by": "old-here"}, "version": 4}
        new["docs"]["shepherdr.host"] = {"value": {"id": "old-mini", "at": 6}, "version": 2}
        new["there"]["mini"]["shepherdr.secrets"] = {"value": {"id": "old-here", "at": 5}, "version": 1}
        # a record naming a real machine is never touched, even on a linked one
        new["there"]["mini"]["shepherdr.host"] = {"value": {"id": "new-mini", "at": 9}, "version": 1}
        self.old("shepherdr.secrets", {"id": "old-here", "at": 5})
        dry = self.co.carry_over(dry=True)
        self.assertEqual({(x["name"], x.get("machine"), x["state"]) for x in dry["records"]},
                         {("shepherdr.secrets", None, "would-repair"), ("shepherdr.host", None, "would-repair"), ("shepherdr.secrets", "mini", "would-repair")})
        self.assertEqual(self.sets, [], "a dry run writes nothing")
        out = self.co.carry_over()
        self.assertTrue(out["ok"])
        self.assertEqual(self.states(out)[("shepherdr.secrets", None)], "kept", "the copy still replaces nothing")
        self.assertEqual({(x["name"], x.get("machine"), x["state"], x["to"]) for x in out["records"]},
                         {("shepherdr.secrets", None, "repaired", "new-here"), ("shepherdr.host", None, "repaired", "new-mini"),
                          ("shepherdr.secrets", "mini", "repaired", "new-here")})
        mine = self.new("shepherdr.secrets")
        self.assertEqual((mine["id"], mine["by"]), ("new-here", "new-here"))
        self.assertGreater(mine["at"], 5, "dated now: the services hand it on to a machine that was off")
        self.assertEqual(self.new("shepherdr.secrets", on="mini")["id"], "new-here")
        self.assertEqual(self.new("shepherdr.host")["id"], "new-mini")
        self.assertEqual(self.new("shepherdr.host", on="mini"), {"id": "new-mini", "at": 9})
        self.assertTrue(all(s == self.co.SESSION for s, _, _ in self.sets), "the default session is only read")
        # safe to run again: nothing left to do
        n = len(self.sets)
        self.assertEqual(self.co.carry_over()["records"], [])
        self.assertEqual(len(self.sets), n)

    def test_shep_305_an_id_nobody_knows_is_said_never_changed(self):
        new = self.cores[self.co.SESSION]
        new["docs"]["shepherdr.secrets"] = {"value": {"id": "gone-box", "at": 5}, "version": 1}
        new["there"]["mini"]["shepherdr.secrets"] = {"value": {"id": "a-box-mini-links", "at": 5}, "version": 1}
        out = self.co.carry_over()
        [row] = out["records"]
        self.assertEqual((row["name"], row.get("machine"), row["state"]), ("shepherdr.secrets", None, "unknown"))
        self.assertIn("shepherdr secrets move-to here --restore", row["why"])
        self.assertTrue(out["ok"])
        self.assertEqual(self.new("shepherdr.secrets"), {"id": "gone-box", "at": 5})
        self.assertEqual(self.sets, [])

    def test_shep_305_records_only_is_doctors_look_and_needs_no_default_session(self):
        new = self.cores[self.co.SESSION]
        new["docs"]["shepherdr.secrets"] = {"value": {"id": "old-here", "at": 5}, "version": 1}
        out = self.co.carry_over(dry=True, records_only=True)
        self.assertEqual(([x["state"] for x in out["records"]], out["documents"], out["agents"]), (["would-repair"], [], []))
        os.remove(os.path.join(self.dir, "herdr-core", self.co.OLD_SESSION, "core.json"))
        [row] = self.co.carry_over(dry=True, records_only=True)["records"]
        self.assertEqual(row["state"], "unknown", "without the default session the old id can't be told")
        self.assertEqual(self.sets, [])

    def stale(self, answers="newer-mini"):
        """mini's link in Shepherdr's session holds new-mini, but the core there now is another (SHEP-310)."""
        self.cores[self.co.SESSION]["machines"]["mini"] = {"id": "new-mini", "state": "unreachable", "why": f'a different core answers there ("{answers}")'}
        self.far["mini.test"] = {"id": answers, "host": "mini-host", "session": self.co.SESSION}

    def test_shep_310_a_link_another_core_answers_on_is_linked_again_and_its_records_follow(self):
        self.stale()
        new = self.cores[self.co.SESSION]
        new["docs"]["shepherdr.secrets"] = {"value": {"id": "new-mini", "at": 5, "by": "new-here"}, "version": 3}
        dry = self.co.carry_over(dry=True)
        [row] = dry["links"]
        self.assertEqual((row["name"], row["id"], row["answers"], row["state"]), ("mini", "new-mini", "newer-mini", "would-relink"))
        self.assertEqual(row["fix"], [f"HC_SESSION={self.co.SESSION} hc machine rm mini",
                                      f"HC_SESSION={self.co.SESSION} hc machine add mini.test --name mini --session {self.co.SESSION}", "herdr-task carry-over"])
        self.assertEqual((self.link_calls, self.sets), ([], []), "a dry run changes nothing")
        out = self.co.carry_over()
        self.assertTrue(out["ok"])
        self.assertEqual([(x["name"], x["state"], x["to"]) for x in out["links"]], [("mini", "relinked", "newer-mini")])
        self.assertEqual([c[:3] for c in self.link_calls], [["machine", "add", "mini.test"], ["machine", "rm", "mini"], ["machine", "rename", "mini-relink"]])
        self.assertEqual(self.link_calls[0][3:], ["--name", "mini-relink", "--session", self.co.SESSION, "--json"])
        self.assertEqual(new["machines"], {"mini": {"id": "newer-mini", "state": "connected", "target": "mini.test", "host": "mini-host", "session": self.co.SESSION}},
                         "the same name, address and session; only the id is new")
        self.assertEqual(self.new("shepherdr.secrets")["id"], "newer-mini", "the secrets record follows the machine linked again")
        self.assertEqual([(x["name"], x["state"]) for x in out["records"]], [("shepherdr.secrets", "repaired")])
        self.assertIn("linked again", self.co.link_line(out["links"][0]))
        # again: nothing left to do
        self.link_calls.clear()
        self.assertEqual(self.co.carry_over()["links"], [])
        self.assertEqual(self.link_calls, [])

    def test_shep_310_another_host_answering_is_never_linked_and_the_fix_is_said(self):
        self.stale()
        self.far["mini.test"]["host"] = "someone-else"
        out = self.co.carry_over()
        [row] = out["links"]
        self.assertEqual(row["state"], "refused")
        self.assertIn("another host answers there", row["why"])
        self.assertFalse(out["ok"])
        self.assertEqual(self.cores[self.co.SESSION]["machines"]["mini"]["id"], "new-mini", "the old link is left as it was")
        self.assertNotIn("mini-relink", self.cores[self.co.SESSION]["machines"], "the try is removed")
        line = self.co.link_line(row)
        self.assertIn("a different herdr-core answers there", line)
        self.assertIn(f"`HC_SESSION={self.co.SESSION} hc machine add mini.test --name mini --session {self.co.SESSION}`", line)
        # one that answers with yet another id than herdr-core saw isn't taken either
        self.stale()
        self.far["mini.test"]["id"] = "yet-another"
        self.assertIn("changed again", self.co.carry_over()["links"][0]["why"])
        # nor a link to the default session there (not Shepherdr's)
        self.stale()
        self.cores[self.co.SESSION]["machines"]["mini"]["session"] = "default"
        self.link_calls.clear()
        row = self.co.carry_over()["links"][0]
        self.assertEqual((row["state"], self.link_calls), ("refused", []))

    def test_shep_310_doctors_look_and_the_updates_links_run_need_no_default_session(self):
        self.stale()
        os.remove(os.path.join(self.dir, "herdr-core", self.co.OLD_SESSION, "core.json"))
        out = self.co.carry_over(dry=True, records_only=True)
        self.assertEqual([x["state"] for x in out["links"]], ["would-relink"])
        self.assertEqual(self.link_calls, [])
        self.cores[self.co.SESSION]["docs"]["shepherdr.host"] = {"value": {"id": "new-mini", "at": 5}, "version": 1}
        out = self.co.carry_over(links_only=True)
        self.assertEqual(([x["state"] for x in out["links"]], [x["state"] for x in out["records"]], out["documents"], out["agents"]),
                         (["relinked"], ["repaired"], [], []))
        self.assertEqual(self.new("shepherdr.host")["id"], "newer-mini")

    def test_agents_only_is_doctors_read_only_look(self):
        self.agent("t1", {"herdr.task": "shop#3"})
        out = self.co.carry_over(dry=True, agents_only=True)
        self.assertEqual(([x["state"] for x in out["agents"]], out["documents"], out["machines"]), (["would-move"], [], []))
        self.assertEqual(self.runs(), [])

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
        ran, rec, notes = self.go({"ok": True, "machines": [{"name": "mini", "state": "added"}], "documents": [{"name": "shepherdr", "state": "copied"}], "records": [], "scheduler": "removed"})
        [(argv, env)] = ran
        self.assertEqual(argv[1:], [os.path.join(os.path.dirname(argv[1]), "herdr-task"), "carry-over", "--json"])
        self.assertTrue(argv[1].endswith(".local/share/shepherdr/mods/tasks/bin/herdr-task"), argv[1])
        self.assertNotIn("HC_SESSION", env)
        self.assertEqual((rec, notes), ({"carry_over": "done", "carry_over_agents": "done", "carry_over_records": "done"}, []))

    def test_what_waits_is_a_note_and_the_next_update_tries_again(self):
        _, rec, notes = self.go({"ok": True, "machines": [], "documents": [{"name": "shepherdr.host", "state": "waiting", "why": "it names mini"}], "scheduler": "none"})
        self.assertEqual(rec, {"carry_over": "waiting", "carry_over_agents": "done", "carry_over_records": "waiting"})
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
        self.assertIn('if switching or rec.get("carry_over") == "waiting" or rec.get("carry_over_agents") != "done" or rec.get("carry_over_records") != "done":', body)

    def test_agents_left_in_the_default_session_are_said_and_the_next_update_looks_again(self):
        _, rec, notes = self.go({"ok": True, "machines": [], "documents": [], "scheduler": "none", "agents": [
            {"name": "the Assistant of space sp1", "address": "t1", "state": "moved", "to": "t7"},
            {"name": "task #3 (shop)", "address": "t2", "state": "waiting", "why": "it's at work now"}]})
        self.assertEqual(rec, {"carry_over": "done", "carry_over_agents": "waiting", "carry_over_records": "waiting"})
        self.assertEqual(notes, ["task #3 (shop) (t2) still runs in herdr-core's default session, outside Shepherdr: it's at work now"])

    def test_an_agent_running_the_update_in_the_default_session_is_named_to_herdr_task(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "t4", "HC_SESSION": "default"}):
            ran, _, _ = self.go({"ok": True})
        self.assertEqual(ran[0][1].get("SHEPHERDR_CARRY_CALLER"), "t4")
        self.assertNotIn("HC_TERMINAL_ID", ran[0][1])
        with mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "t4", "HC_SESSION": "shepherdr"}):
            ran, _, _ = self.go({"ok": True})
        self.assertNotIn("SHEPHERDR_CARRY_CALLER", ran[0][1], "a terminal in Shepherdr's session isn't in the default one")

    def test_doctor_asks_herdr_task_read_only_and_names_each_agent_left(self):
        root = scratch(self)
        helper = os.path.join(root, self.sh.SHARE, "mods", "tasks", "bin", "herdr-task")
        os.makedirs(os.path.dirname(helper))
        open(helper, "w").close()
        ran = []
        answer = {"agents": [{"name": "the Assistant of space sp1", "address": "t1", "state": "would-move"},
                             {"name": "task #3 (shop)", "address": "t2", "state": "kept", "why": "Shepherdr's session runs its own already"}]}

        def run(argv, **k):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps(answer), "")
        from unittest import mock
        with mock.patch.object(self.sh.shutil, "which", lambda n: "/x/hc"):
            lines = self.sh.agents_left_behind(root, run=run)
            self.assertEqual(ran[0][1:], [helper, "carry-over", "--agents", "--dry-run", "--json"])
            self.assertEqual(lines, ["the Assistant of space sp1 (t1) still runs in herdr-core's default session, outside Shepherdr: "
                                     "`herdr-task carry-over` moves it into Shepherdr's session",
                                     "task #3 (shop) (t2) still runs in herdr-core's default session, outside Shepherdr: "
                                     "Shepherdr's session runs its own already"])
            answer = {"agents": []}
            self.assertEqual(self.sh.agents_left_behind(root, run=run), [])
        with open(os.path.join(ROOT, "bin", "shepherdr")) as f:
            text = f.read()
        doctor = text[text.index("def cmd_doctor("):text.index("# ---- uninstall")]
        self.assertIn("bad += agents_bad", doctor, "an agent left behind isn't whole")


    def test_shep_305_doctor_flags_a_record_naming_no_machine(self):
        root = scratch(self)
        helper = os.path.join(root, self.sh.SHARE, "mods", "tasks", "bin", "herdr-task")
        os.makedirs(os.path.dirname(helper))
        open(helper, "w").close()
        ran = []
        answer = {"records": [{"name": "shepherdr.secrets", "id": "0123456789abcdef", "state": "unknown"},
                              {"name": "shepherdr.host", "id": "old-mini", "state": "would-repair", "to": "new-mini"},
                              {"name": "shepherdr.web", "id": "x", "state": "unknown"}]}

        def run(argv, **k):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps(answer), "")
        from unittest import mock
        with mock.patch.object(self.sh.shutil, "which", lambda n: "/x/hc"):
            lines = self.sh.records_naming_nobody(root, run=run)
            self.assertEqual(ran[0][1:], [helper, "carry-over", "--records", "--dry-run", "--json"])
            self.assertEqual(len(lines), 2, "the web link is the host's own: not flagged")
            self.assertIn("which machine keeps the secrets names a machine none here knows", lines[0])
            self.assertIn("`shepherdr secrets move-to here --restore`", lines[0])
            self.assertIn("serves the web app still names a machine by its id from before 3.2", lines[1])
            self.assertIn("`herdr-task carry-over`", lines[1])
            answer = {"records": []}
            self.assertEqual(self.sh.records_naming_nobody(root, run=run), [])
        with open(os.path.join(ROOT, "bin", "shepherdr")) as f:
            text = f.read()
        doctor = text[text.index("def cmd_doctor("):text.index("# ---- uninstall")]
        self.assertIn("bad += records_naming_nobody(root)", doctor, "a record naming no machine isn't whole")

    def test_shep_310_doctor_says_a_link_another_core_answers_on_with_the_commands(self):
        root = scratch(self)
        helper = os.path.join(root, self.sh.SHARE, "mods", "tasks", "bin", "herdr-task")
        os.makedirs(os.path.dirname(helper))
        open(helper, "w").close()
        fix = ["HC_SESSION=shepherdr hc machine rm vm-demo", "HC_SESSION=shepherdr hc machine add vm-demo.example.test --name vm-demo --session shepherdr", "herdr-task carry-over"]
        answer = {"links": [{"name": "vm-demo", "id": "aaa", "answers": "bbb", "state": "would-relink", "fix": fix}], "records": []}

        def run(argv, **k):
            return subprocess.CompletedProcess(argv, 0, json.dumps(answer), "")
        from unittest import mock
        with mock.patch.object(self.sh.shutil, "which", lambda n: "/x/hc"):
            [line] = self.sh.records_naming_nobody(root, run=run)
        self.assertIn("the link to vm-demo is broken: a different herdr-core answers there now", line)
        self.assertIn("`herdr-task carry-over` links it again", line)
        self.assertIn("`HC_SESSION=shepherdr hc machine add vm-demo.example.test --name vm-demo --session shepherdr`", line)

    def test_shep_310_every_update_links_again_what_another_core_answers_on(self):
        ran, rec = [], {}
        answer = {"ok": False, "links": [{"name": "vm-demo", "state": "relinked", "to": "bbb"},
                                         {"name": "vm-old", "state": "refused", "why": "not linked again: another host answers there", "fix": ["x", "y", "herdr-task carry-over"]}],
                  "records": [{"name": "shepherdr.secrets", "state": "repaired", "to": "bbb"}]}

        def run(argv, **k):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 1, json.dumps(answer), "")
        r = self.sh.Run(scratch(self), False)
        said = []
        from unittest import mock
        with mock.patch.object(self.sh, "say", lambda *a: said.append(" ".join(map(str, a)))):
            self.sh.carry_over_session(r, rec, True, run=run, links_only=True)
        self.assertEqual(ran[0][2:], ["carry-over", "--links", "--json"])
        self.assertEqual(rec, {}, "the switch's own records are left alone")
        self.assertTrue(any("vm-demo was broken" in x and "linked again" in x for x in said), said)
        self.assertTrue(any("shepherdr.secrets" in x for x in said), said)
        [note] = r.notes
        self.assertIn("vm-old is broken", note)
        self.assertIn("another host answers there", note)
        self.assertIn("`x` && `y` && `herdr-task carry-over`", note)
        with open(os.path.join(ROOT, "bin", "shepherdr")) as f:
            text = f.read()
        self.assertIn("carry_over_session(r, rec, home, links_only=True)", text)

    def test_shep_305_the_update_says_what_it_repaired_and_what_it_cannot(self):
        _, rec, notes = self.go({"ok": True, "machines": [], "documents": [], "scheduler": "none", "records": [
            {"name": "shepherdr.secrets", "id": "old", "state": "repaired", "to": "new"},
            {"name": "shepherdr.host", "id": "gone", "state": "unknown"}]})
        self.assertEqual(rec, {"carry_over": "done", "carry_over_agents": "done", "carry_over_records": "done"})
        self.assertEqual(len(notes), 1)
        self.assertIn("shepherdr web serve-from here", notes[0])
        _, rec, _ = self.go({"ok": True, "machines": [], "documents": [], "scheduler": "none", "records": [
            {"name": "shepherdr.secrets", "id": "old", "state": "waiting", "why": "written meanwhile"}]})
        self.assertEqual(rec["carry_over_records"], "waiting", "the next update looks again")


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


class ReplyBack(unittest.TestCase):
    """An Assistant on a VM answers the Mac's, which it can't reach: its answer waits on the VM (the outbox), the Mac,
    which asked, fetches it over its own link and gives it to its Assistant as a real <herdr-assistant> message."""

    def setUp(self):
        from unittest import mock
        self.vm, self.mac = scratch(self), scratch(self)
        self.mock = mock

    def on(self, store):
        """machines' files in that machine's store"""
        m = self.mock
        return [m.patch.object(machines, "OUTBOX", os.path.join(store, "outbox")), m.patch.object(machines, "AWAITING", os.path.join(store, ".awaiting.json")),
                m.patch.object(machines, "STORE", store)]

    def run_on(self, store, fn):
        ps = self.on(store)
        for p in ps:
            p.start()
        try:
            return fn()
        finally:
            for p in ps:
                p.stop()

    def vm_answers(self, target="mac/t13", text="Disk is at 40%, all fine."):
        graph = {"core": {"name": "vm-kil", "id": "v1"}, "assistants": [{"address": "t3", "space": "sp1", "space_name": "root"}]}
        with self.mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": graph}, [])), \
                self.mock.patch.object(machines, "nodes", lambda g: []):
            return self.run_on(self.vm, lambda: machines.tell(target, text, sender="t3"))

    def test_the_mac_tells_it_it_can_reply_and_remembers_to_fetch(self):
        graph = {"core": {"name": "mac", "id": "m1"}, "assistants": [{"address": "t13", "space": "sp0", "space_name": "Home"}]}
        row = {"target": "vm-kil/t3", "route": "vm-kil", "how": ["herdr-core"], "address": "t3", "space": "sp1", "space_name": "root"}
        sent = []
        with self.mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": graph}, [row])), \
                self.mock.patch.object(machines, "nodes", lambda g: [{"route": [{"to": "vm-kil"}], "node": {"core": {"name": "vm-kil", "id": "v1"}}}]), \
                self.mock.patch.object(machines, "route_text", lambda r: "vm-kil" if r else ""), \
                self.mock.patch.object(machines, "_path_back", lambda *a: None), \
                self.mock.patch.object(machines, "_deliver", lambda n, h, a, t: sent.append(t) or True):
            r = self.run_on(self.mac, lambda: machines.tell("vm-kil/t3", "How full is the disk?", sender="t13"))
            waits = self.run_on(self.mac, machines._awaiting)
        self.assertTrue(r["can_reply"])
        self.assertIn('from="mac/t13"', sent[0])
        self.assertIn('can-reply="yes"', sent[0])
        self.assertEqual((waits["vm-kil"]["me"], waits["vm-kil"]["how"]), ("mac", ["herdr-core"]))

    def test_the_vm_leaves_its_answer_and_says_so(self):
        r = self.vm_answers()
        self.assertEqual((r["left"], r["machine"]), (True, "mac"))
        files = os.listdir(os.path.join(self.vm, "outbox"))
        self.assertEqual(len(files), 1)
        # the CLI's words: a waiting send, with why (the chat's relay row reads them)
        from io import StringIO
        from contextlib import redirect_stdout
        import argparse
        out = StringIO()
        with self.mock.patch.object(machines, "sandbox_blocks_hc", lambda: None), \
                self.mock.patch.object(machines, "tell", lambda t, x: dict(r)), redirect_stdout(out):
            machines.cmd_tell(argparse.Namespace(target="mac/t13", text="x", json=False))
        self.assertTrue(out.getvalue().startswith("Not delivered yet, left for mac/t13 to fetch: mac can't be reached from here"), out.getvalue())

    def test_a_reachable_or_unknown_target_is_never_left(self):
        graph = {"core": {"name": "vm-kil", "id": "v1"}, "assistants": []}
        with self.mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": graph}, [])), \
                self.mock.patch.object(machines, "nodes", lambda g: [{"route": [{"to": "laptop"}], "node": {"core": {"name": "laptop"}}}]), \
                self.mock.patch.object(machines, "route_text", lambda r: "laptop" if r else ""):
            for target in ("laptop/t4", "Everything", "vm-kil/t9"):
                with self.assertRaises(machines.Fail):
                    self.run_on(self.vm, lambda: machines.tell(target, "hi", sender="t3"))
        self.assertFalse(os.path.exists(os.path.join(self.vm, "outbox")))

    def test_the_vms_cli_hands_over_only_the_askers_once(self):
        self.vm_answers()
        self.vm_answers("other/t2", "not for the Mac")
        env = {"HOME": self.vm, "PATH": os.environ.get("PATH", ""), "HERDR_TASK_STORE": self.vm}
        take = lambda: subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "_outbox", "--for", "mac"], env=env, capture_output=True, text=True, timeout=60)
        r = take()
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual([(x["to"], x["from"], x["machine"], x["space"], x["text"]) for x in got], [("t13", "t3", "vm-kil", "root", "Disk is at 40%, all fine.")])
        self.assertEqual(json.loads(take().stdout.strip().splitlines()[-1]), [])
        self.assertEqual(len(os.listdir(os.path.join(self.vm, "outbox"))), 1)  # the other machine's still waits

    def test_the_mac_fetches_it_and_its_assistant_gets_a_real_message(self):
        self.vm_answers()
        self.run_on(self.mac, lambda: machines._await("vm-kil", ["herdr-core"], "vm-kil", "mac"))
        calls, given = [], []

        def run(argv, **kw):
            calls.append(argv)
            out = json.dumps(self.run_on(self.vm, lambda: machines.take_outbox(argv[-1])))
            return subprocess.CompletedProcess(argv, 0, out + "\n", "")
        report = {}
        with self.mock.patch.object(machines.subprocess, "run", run), self.mock.patch.object(machines, "guard", lambda a: None), \
                self.mock.patch.object(machines, "send_or_hold", lambda a, t, how: given.append((a, t, how)) or "sent"):
            self.run_on(self.mac, lambda: machines.replies_pass(report))
            self.run_on(self.mac, lambda: machines.replies_pass(report))  # again at once: not asked again so soon
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:5], ["hc", "exec", "--on", "vm-kil", "--"])
        self.assertEqual(given, [("t13", '<herdr-assistant from="vm-kil/t3" machine="vm-kil" space="root" can-reply="yes">Disk is at 40%, all fine.</herdr-assistant>', "news")])
        self.assertEqual(report["replies"], [{"from": "vm-kil/t3", "to": "t13", "got": "sent"}])

    def test_nothing_asked_means_no_call(self):
        with self.mock.patch.object(machines.subprocess, "run", lambda *a, **k: self.fail("called")):
            self.run_on(self.mac, lambda: machines.replies_pass({}))


class SyncedMachineCore(unittest.TestCase):
    """#1507: a synced machine whose task agents were refused while sync said "current". Sync now also looks at what file
    shas can't see there (the core's session, a socket pinned for every session, the herdr-task its shell really runs)."""

    def test_install_reports_a_pinned_socket_and_an_older_copy_on_the_path(self):
        home = scratch(self)
        os.makedirs(os.path.join(home, ".config", "herdr-core"))
        with open(os.path.join(home, ".config", "herdr-core", "config.toml"), "w") as f:
            f.write('# mine\nsocket = "~/.local/state/herdr-core/default/default.sock"\n[other]\nsocket = "no"\n')
        for d, said in (("old", "3.2.0"), (".local/bin", "3.2.18")):
            os.makedirs(os.path.join(home, d), exist_ok=True)
            p = os.path.join(home, d, "herdr-task")
            with open(p, "w") as f:
                f.write(f"#!/bin/sh\necho {said}\n")
            os.chmod(p, 0o755)
        env = {"HOME": home, "SHELL": "/bin/sh", "HC_SESSION": "shepherdr",
               "PATH": os.pathsep.join([os.path.join(home, "old"), os.path.join(home, ".local/bin"), "/usr/bin", "/bin"])}
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(".x", op="check")), env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        h = json.loads(r.stdout.splitlines()[-1])["health"]
        self.assertEqual(h["pin"], os.path.join(home, ".local/state/herdr-core/default/default.sock"))
        self.assertEqual((h["session"], h["herdr_task"], h["other_copy"]), ("shepherdr", os.path.join(home, "old", "herdr-task"), True))
        self.assertRegex(h["herdr_task_date"], r"^\d{4}-\d\d-\d\d$")
        os.remove(os.path.join(home, "old", "herdr-task"))
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(".x", op="check")), env=env,
                           capture_output=True, text=True, timeout=60)
        h = json.loads(r.stdout.splitlines()[-1])["health"]
        self.assertEqual((h["herdr_task"], h["other_copy"]), (os.path.join(home, ".local/bin", "herdr-task"), False))

    def test_a_plain_machine_has_nothing_to_fix(self):
        home = scratch(self)
        env = {"HOME": home, "SHELL": "/bin/sh", "PATH": "/usr/bin:/bin"}
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(install_payload(".x", op="check")), env=env,
                           capture_output=True, text=True, timeout=60)
        h = json.loads(r.stdout.splitlines()[-1])["health"]
        self.assertEqual((h["pin"], h["session"], h["other_copy"]), (None, "default", False))
        self.assertEqual(machines.problems("vm", {"session": "shepherdr"}, {**h, "session": "shepherdr"}), [])

    def test_each_problem_says_its_fix(self):
        link = {"name": "vm-demo", "target": "me@vm", "session": "shepherdr"}
        got = machines.problems("vm-demo", link, {"session": "shepherdr", "pin": "/h/.local/state/herdr-core/default/default.sock",
                                                   "config": "/h/.config/herdr-core/config.toml"})
        self.assertEqual(len(got), 1)
        self.assertIn("sed -i.bak '/^socket *=/d' /h/.config/herdr-core/config.toml", got[0])
        self.assertIn("hc exec --on vm-demo -- env HC_SOCKET=/h/.local/state/herdr-core/default/default.sock hc server stop", got[0])
        got = machines.problems("vm-demo", {**link, "session": None}, {"session": "default"})
        self.assertIn("leads to herdr-core's 'default' session there", got[0])
        self.assertIn("hc machine add me@vm --name vm-demo --session shepherdr", got[0])
        got = machines.problems("vm-demo", link, {"session": "default"})
        self.assertIn("runs as herdr-core session 'default'", got[0])
        got = machines.problems("vm-demo", link, {"session": "shepherdr", "other_copy": True, "herdr_task": "/o/herdr-task",
                                                  "herdr_task_date": "2026-10-01"})
        self.assertIn("runs is /o/herdr-task from 2026-10-01, an older or other copy than the synced ~/.local/bin/herdr-task", got[0])

    def test_sync_says_needs_fix_not_current(self):
        from unittest import mock
        m = {"version": "v1", "files": [], "links": [], "touch": []}
        res = {"files": {}, "links": {}, "stamp": {"version": "v1"}, "health": {"session": "shepherdr", "pin": "/p/default.sock", "config": "/c"}}
        with mock.patch.object(machines, "_remote_python", lambda *a, **k: res), mock.patch.object(machines, "core_name", lambda: "mac"), \
                mock.patch.object(machines, "_reach_cache", lambda: {"graph": {}}), \
                mock.patch.object(machines, "nodes", lambda g: [{"route": [{"name": "vm-demo", "how": "herdr-core"}], "node": {"assistants": []}}]), \
                mock.patch.object(machines, "route_text", lambda r: "vm-demo"):
            got = machines.sync_machine("vm-demo", m, "check", link={"name": "vm-demo", "session": "shepherdr"})
        self.assertEqual(got["state"], "needs-fix")
        self.assertTrue(any("pins every session's socket" in d for d in got["details"]), got["details"])
        self.assertTrue(any(d.startswith("no Assistant runs there") for d in got["details"]), got["details"])
        res["health"] = {"session": "shepherdr"}
        with mock.patch.object(machines, "_remote_python", lambda *a, **k: res), mock.patch.object(machines, "core_name", lambda: "mac"), \
                mock.patch.object(machines, "_reach_cache", lambda: None):
            got = machines.sync_machine("vm-demo", m, "check", link={"name": "vm-demo", "session": "shepherdr"})
        self.assertEqual((got["state"], got["details"]), ("current", []))
