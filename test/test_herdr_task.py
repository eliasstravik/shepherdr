"""herdr-task: every module compiles, the add-on switch it reads, and (on CI only, where HOME is
a throwaway) its commands start. On a person's machine herdr-task never runs with another HOME."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
CI = os.environ.get("CI") == "true"


class HerdrTask(unittest.TestCase):
    def test_compiles(self):
        files = [os.path.join(BIN, "herdr-task")] + [os.path.join(BIN, "herdr_task", f) for f in sorted(os.listdir(os.path.join(BIN, "herdr_task"))) if f.endswith(".py")]
        files += [os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"), os.path.join(ROOT, "bin", "herdr-secret"),
                  os.path.join(ROOT, "bin", "sync-shared"), os.path.join(ROOT, "bin", "shepherdr")]
        for f in files:
            with open(f, "rb") as fh:
                compile(fh.read(), f, "exec")

    def test_addon_off(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"everywhere": {"off": ["browser"]}}, f)
        code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.base import addon_off; print(addon_off('browser'), addon_off('voice'))")
        env = {**os.environ, "HERDR_TASK_SETTINGS": f.name}
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env=env)
        os.unlink(f.name)
        self.assertEqual(out.stdout.split(), ["True", "False"], out.stderr)

    @unittest.skipUnless(CI, "runs only on CI: herdr-task never runs with a changed HOME on a person's machine")
    def test_commands_start(self):
        home = tempfile.mkdtemp()
        env = {**os.environ, "HOME": home, "HERDR_TASK_STORE": os.path.join(home, "tasks")}
        for args in (["--help"], ["--version"], ["list", "--help"], ["machines", "sync", "--help"]):
            p = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), *args], capture_output=True, text=True, env=env)
            self.assertEqual(p.returncode, 0, f"herdr-task {' '.join(args)}: {p.stderr}")


class Autopilot(unittest.TestCase):
    """Autopilot's Everywhere and each space's own (herdr_task/autopilot.py), in a throwaway store and
    heartbeat folder: herdr-app and hc are never run (the window's spaces are given)."""

    def setUp(self):
        import contextlib
        import io
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.autopilot as ap
        self.ap, self.io, self.redirect = ap, io, contextlib.redirect_stdout
        self.tmp = tempfile.mkdtemp()
        self.folder = os.path.join(self.tmp, "tt-repo")
        os.makedirs(self.folder)
        store = os.path.join(self.tmp, "tasks")

        def never(*a, **k):
            raise AssertionError("ran a program")
        for name, value in (("STORE", store), ("STATE", os.path.join(store, ".autopilot.json")),
                            ("HEARTBEATS", os.path.join(self.tmp, "beats")), ("run", never), ("hc_json", never),
                            ("folder_of", lambda f: f),
                            ("local_spaces", lambda: [{"id": "sp1", "name": "~", "folder": self.folder}]),
                            ("space_info", lambda s: ("~", self.folder) if s == "sp1" else (None, None))):
            p = mock.patch.object(ap, name, value)
            p.start()
            self.addCleanup(p.stop)
        ap._listed[0] = 0

    def cmd(self, sub, **kw):
        import argparse
        args = argparse.Namespace(autopilot=sub, json=True, space=None, everywhere=False, every=None, on=None, only=None, own=False)
        for k, v in kw.items():
            setattr(args, k, v)
        out = self.io.StringIO()
        with self.redirect(out):
            self.ap.cmd_autopilot(args)
        return json.loads(out.getvalue())

    def test_the_rule_is_cores(self):
        """The cases core/autopilot.test.js checks pilotFor() on."""
        with open(os.path.join(ROOT, "core", "autopilot.cases.json")) as f:
            cases = json.load(f)["cases"]
        for c in cases:
            eff, own = self.ap.resolve(c["file"], c["file"]["spaces"].get(c["space"]))
            got = {"on": eff["on"], "every": (eff["every"] or {}).get("text"), "events": eff["events"], "own": own}
            self.assertEqual(got, c["expect"], c["name"])

    def test_version_1_keeps_what_was_on(self):
        os.makedirs(self.ap.STORE)
        hourly, weekdays = self.ap.parse_every("every 60 minutes"), self.ap.parse_every("weekdays 9:00")
        with open(self.ap.STATE, "w") as f:
            json.dump({"version": 1, "spaces": {
                "on1": {"on": True, "every": self.ap.parse_every("every 30 minutes"), "events": ["ready"], "next_run": 5},
                "off1": {"on": False, "every": hourly, "events": []},
                "off2": {"on": False, "every": weekdays, "events": []}}}, f)
        with self.ap.state() as d:
            pass
        with open(self.ap.STATE) as f:
            d = json.load(f)
        self.assertEqual(d["version"], 2)
        self.assertEqual(d["everywhere"]["on"], False)
        self.assertEqual(set(d["spaces"]["on1"]) >= {"on", "every", "events"}, True)
        self.assertFalse({"on", "every", "events"} & set(d["spaces"]["off1"]))
        self.assertEqual([k for k in ("on", "every", "events") if k in d["spaces"]["off2"]], ["every"])
        out = self.cmd("list")
        on1 = next(v for v in out["spaces"] if v["space"] == "on1")
        self.assertEqual((on1["on"], on1["every"], on1["events"], on1["next_run"]), (True, "every 30 minutes", ["ready"], 5))

    def test_everywhere_and_a_spaces_own(self):
        e = self.cmd("set", everywhere=True, every="every 30 minutes", on="ready")
        self.assertEqual((e["everywhere"], e["every"], e["events"], e["on"]), (True, "every 30 minutes", ["ready"], False))
        self.cmd("on", everywhere=True)
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["on"], v["every"], v["events"]), (True, "every 30 minutes", ["ready"]))
        self.assertEqual(v["own"], {"on": False, "every": False, "events": False, "heartbeat": False})
        self.assertTrue(v["next_run"], "on from Everywhere: its next wake is set")
        self.assertEqual(v["heartbeat"], self.ap.heartbeat_path(None))
        # its own schedule; set back to Everywhere's, it follows again
        v = self.cmd("set", space="sp1", every="weekdays 9:00")
        self.assertEqual((v["every"], v["own"]["every"]), ("weekdays 9:00", True))
        v = self.cmd("set", space="sp1", every="every 30 minutes")
        self.assertFalse(v["own"]["every"])
        # off here while on everywhere; on again follows Everywhere
        v = self.cmd("off", space="sp1")
        self.assertEqual((v["on"], v["own"]["on"], v["next_run"]), (False, True, None))
        v = self.cmd("on", space="sp1")
        self.assertEqual((v["on"], v["own"]["on"]), (True, False))
        # Everywhere's schedule changes reach it
        v0 = self.cmd("show", space="sp1")["next_run"]
        self.cmd("set", everywhere=True, every="weekdays 9:00")
        v = self.cmd("show", space="sp1")
        self.assertEqual(v["every"], "weekdays 9:00")
        self.assertNotEqual(v["next_run"], v0)
        # Everywhere off: off here too
        self.cmd("off", everywhere=True)
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["on"], v["next_run"]), (False, None))
        listed = self.cmd("list")
        self.assertEqual(listed["everywhere"]["on"], False)
        self.assertEqual([x["space"] for x in listed["spaces"]], ["sp1"])

    def test_heartbeat_and_reset(self):
        self.cmd("on", everywhere=True)
        with open(self.ap.heartbeat_path(None), "w") as f:
            f.write("Ship the docs.\n")
        self.assertEqual(self.cmd("heartbeat", space="sp1")["heartbeat"], self.ap.heartbeat_path(None))
        mine = self.cmd("heartbeat", space="sp1", own=True)["heartbeat"]
        self.assertEqual(mine, self.ap.heartbeat_path("sp1"))
        with open(mine) as f:
            self.assertEqual(f.read(), "Ship the docs.\n")
        with open(mine, "w") as f:
            f.write("Only the API docs.\n")
        self.cmd("set", space="sp1", on="failed")
        v = self.cmd("show", space="sp1")
        self.assertEqual(v["own"], {"on": False, "every": False, "events": True, "heartbeat": True})
        self.assertIn("Only the API docs.", self.ap.message("sp1", {}, ["run now"]))
        v = self.cmd("reset", space="sp1", only="heartbeat")
        self.assertFalse(v["own"]["heartbeat"])
        self.assertTrue(os.path.exists(mine + ".old"))
        self.assertIn("Ship the docs.", self.ap.message("sp1", {}, ["run now"]))
        v = self.cmd("reset", space="sp1")
        self.assertEqual(v["own"], {"on": False, "every": False, "events": False, "heartbeat": False})
        with self.assertRaises(self.ap.Fail):
            self.cmd("run-now", everywhere=True)

    def test_complete_turns_off_only_here(self):
        import argparse
        self.cmd("on", everywhere=True)
        out = self.io.StringIO()
        with self.redirect(out):
            self.ap.cmd_complete(argparse.Namespace(space="sp1", evidence="All docs merged.", json=True))
        v = json.loads(out.getvalue())
        self.assertEqual((v["on"], v["own"]["on"]), (False, True))
        self.assertTrue(self.cmd("list")["everywhere"]["on"])

    def test_list_names_a_space_as_the_screens_do(self):
        self.cmd("on", everywhere=True)
        args = __import__("argparse").Namespace(autopilot="list", json=False)
        out = self.io.StringIO()
        with self.redirect(out):
            self.ap.cmd_autopilot(args)
        lines = out.getvalue().splitlines()
        self.assertTrue(lines[0].startswith("Everywhere: Autopilot on"), lines)
        self.assertTrue(lines[1].startswith("tt-repo: Autopilot on"), lines)
        self.assertIn("[all from Everywhere]", lines[1])


if __name__ == "__main__":
    unittest.main()
