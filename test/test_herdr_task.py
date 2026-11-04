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
                            ("space_info", lambda s: ("~", self.folder) if s == "sp1" else (None, None))):
            p = mock.patch.object(ap, name, value)
            p.start()
            self.addCleanup(p.stop)

    def cmd(self, sub, **kw):
        import argparse
        args = argparse.Namespace(autopilot=sub, json=True, space=None, everywhere=False, every=None, on=None)
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
            eff = self.ap.resolve(c["file"], c["file"]["spaces"].get(c["space"]))
            got = {"on": eff["on"], "every": (eff["every"] or {}).get("text"), "events": eff["events"]}
            self.assertEqual(got, c["expect"], c["name"])

    def test_a_spaces_old_settings_go(self):
        """Version 1's per-space schedule and events (and a switch on Everywhere) go on the next
        read; a space keeps its on/off and how its wakes went."""
        os.makedirs(self.ap.STORE)
        with open(self.ap.STATE, "w") as f:
            json.dump({"version": 1, "everywhere": {"on": True}, "spaces": {
                "on1": {"on": True, "every": self.ap.parse_every("every 30 minutes"), "events": ["ready"], "next_run": 5},
                "off1": {"on": False, "every": self.ap.parse_every("weekdays 9:00"), "events": []}}}, f)
        with self.ap.state():
            pass
        with open(self.ap.STATE) as f:
            d = json.load(f)
        self.assertEqual(d["version"], 2)
        self.assertNotIn("on", d["everywhere"])
        self.assertEqual(d["spaces"]["on1"]["on"], True)
        for a in d["spaces"].values():
            self.assertFalse({"every", "events"} & set(a))
        on1 = next(v for v in self.cmd("list")["spaces"] if v["space"] == "on1")
        self.assertEqual((on1["on"], on1["every"], on1["events"]), (True, "every 60 minutes", []))

    def test_one_setting_for_every_space(self):
        e = self.cmd("set", everywhere=True, every="every 30 minutes", on="ready")
        self.assertEqual((e["everywhere"], e["every"], e["events"]), (True, "every 30 minutes", ["ready"]))
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["on"], v["every"], v["events"]), (False, "every 30 minutes", ["ready"]))
        # switched on in its header: Everywhere's schedule, a next wake
        v = self.cmd("on", space="sp1")
        self.assertEqual((v["on"], v["every"], v["heartbeat"]), (True, "every 30 minutes", self.ap.heartbeat_path()))
        self.assertTrue(v["next_run"])
        self.assertTrue(os.path.exists(self.ap.heartbeat_path()))
        # Everywhere's schedule changes reach it
        v0 = v["next_run"]
        self.cmd("set", everywhere=True, every="weekdays 9:00")
        v = self.cmd("show", space="sp1")
        self.assertEqual(v["every"], "weekdays 9:00")
        self.assertNotEqual(v["next_run"], v0)
        # a space can't set its own; Everywhere can't switch spaces on or off
        with self.assertRaises(self.ap.Fail) as no:
            self.cmd("set", space="sp1", every="every 30 minutes")
        self.assertIn("--everywhere", str(no.exception))
        for sub in ("on", "off", "run-now"):
            with self.assertRaises(self.ap.Fail):
                self.cmd(sub, everywhere=True)
        v = self.cmd("off", space="sp1")
        self.assertEqual((v["on"], v["next_run"]), (False, None))
        self.assertEqual([x["space"] for x in self.cmd("list")["spaces"]], ["sp1"])

    def test_one_heartbeat(self):
        path = self.cmd("heartbeat")["heartbeat"]
        self.assertEqual(path, self.ap.heartbeat_path())
        with open(path) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        with open(path, "w") as f:
            f.write("Ship the docs.\n")
        self.assertIn("Ship the docs.", self.ap.message("sp1", {}, ["run now"]))

    def test_complete_turns_it_off(self):
        import argparse
        self.cmd("on", space="sp1")
        out = self.io.StringIO()
        with self.redirect(out):
            self.ap.cmd_complete(argparse.Namespace(space="sp1", evidence="All docs merged.", json=True))
        v = json.loads(out.getvalue())
        self.assertEqual((v["on"], v["completed"]["text"]), (False, "All docs merged."))

    def test_list_names_a_space_as_the_screens_do(self):
        self.cmd("on", space="sp1")
        args = __import__("argparse").Namespace(autopilot="list", json=False)
        out = self.io.StringIO()
        with self.redirect(out):
            self.ap.cmd_autopilot(args)
        lines = out.getvalue().splitlines()
        self.assertTrue(lines[0].startswith("Every space: Every hour"), lines)
        self.assertTrue(lines[1].startswith("tt-repo: Autopilot on"), lines)


if __name__ == "__main__":
    unittest.main()
