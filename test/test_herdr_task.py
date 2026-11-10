"""herdr-task: every module compiles, the add-on switch it reads, and (on CI only, where HOME is
a throwaway) its commands start. On a person's machine herdr-task never runs with another HOME."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
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

    def test_tell_takes_a_chat_mention(self):
        """A chat's #-mention (core/mentions.js) names its Assistant for tell-assistant: whole, its target, or #name."""
        code = ("import sys, json; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.machines import _find;"
                "rows = [{'target': 'vm-demo/t3', 'route': 'vm-demo', 'space': 'sp-shop', 'space_name': 'shop'},"
                "        {'target': 't1', 'route': None, 'space': 'sp-web', 'space_name': 'web'}];"
                "print(json.dumps([[a['target'] for a in _find(rows, t)] for t in sys.argv[2:]]))")
        forms = ["[#shop](space:vm-demo/sp-shop)", "space:vm-demo/sp-shop", "vm-demo/sp-shop", "sp-shop", "#shop", "[#web](space:sp-web)", "#nope"]
        out = subprocess.run([sys.executable, "-c", code, BIN, *forms], capture_output=True, text=True)
        self.assertEqual(json.loads(out.stdout), [["vm-demo/t3"]] * 5 + [["t1"], []], out.stderr)

    @unittest.skipUnless(CI, "runs only on CI: herdr-task never runs with a changed HOME on a person's machine")
    def test_commands_start(self):
        home = tempfile.mkdtemp()
        env = {**os.environ, "HOME": home, "HERDR_TASK_STORE": os.path.join(home, "tasks")}
        for args in (["--help"], ["--version"], ["list", "--help"], ["machines", "sync", "--help"]):
            p = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), *args], capture_output=True, text=True, env=env)
            self.assertEqual(p.returncode, 0, f"herdr-task {' '.join(args)}: {p.stderr}")


class Autopilot(unittest.TestCase):
    """Autopilot's Everywhere and each space's own (herdr_task/autopilot.py), in a throwaway store,
    heartbeat folder and settings file: herdr-app and hc are never run (the window's spaces are given)."""

    def setUp(self):
        import contextlib
        import io
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.autopilot as ap
        self.ap, self.io, self.redirect = ap, io, contextlib.redirect_stdout
        self.tmp = tempfile.mkdtemp()
        self.lists = []  # the task lists a wake looks at (waiting())
        self.folder = os.path.join(self.tmp, "tt-repo")
        os.makedirs(self.folder)
        store = os.path.join(self.tmp, "tasks")

        def never(*a, **k):
            raise AssertionError("ran a program")
        import herdr_task.settings as settings
        self.settings_file = os.path.join(self.tmp, "shepherdr.json")
        p = mock.patch.object(settings, "SETTINGS", self.settings_file)
        p.start()
        self.addCleanup(p.stop)
        for name, value in (("STORE", store), ("STATE", os.path.join(store, ".autopilot.json")),
                            ("HEARTBEATS", os.path.join(self.tmp, "beats")), ("run", never), ("hc_json", never),
                            ("space_info", lambda s: ("~", self.folder) if s == "sp1" else (None, None)),
                            ("window_spaces", lambda: None), ("ensure_scheduler", self.scheduler),
                            ("coordinator_in", lambda s: None), ("store_files", lambda: self.lists)):
            p = mock.patch.object(ap, name, value)
            p.start()
            self.addCleanup(p.stop)

    def scheduler(self, quiet=False):
        self.schedulers = getattr(self, "schedulers", 0) + 1
        return {}

    def cmd(self, sub, **kw):
        import argparse
        args = argparse.Namespace(autopilot=sub, json=True, space=None, everywhere=False, every=None, on=None, heartbeat=None,
                                  name=None, space_folder=None, here=False)
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
            eff = self.ap.resolve(c["file"], c["file"]["spaces"].get(c["space"]), c["space"], c.get("settings", {}))
            got = {"on": eff["on"], "every": (eff["every"] or {}).get("text"), "events": eff["events"], "own": eff["own"]}
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

    def test_everywhere_unless_a_space_sets_its_own(self):
        e = self.cmd("set", everywhere=True, every="every 30 minutes", on="ready")
        self.assertEqual((e["everywhere"], e["every"], e["events"]), (True, "every 30 minutes", ["ready"]))
        # kept in Shepherdr settings, with everything else there
        with open(self.settings_file) as f:
            self.assertEqual(json.load(f)["everywhere"]["autopilot"], {"every": "every 30 minutes", "events": ["ready"]})
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["on"], v["every"], v["events"], v["own"]), (False, "every 30 minutes", ["ready"], []))
        # switched on in its header: Everywhere's schedule, a next wake
        v = self.cmd("on", space="sp1")
        self.assertEqual((v["on"], v["every"], v["heartbeat"]), (True, "every 30 minutes", self.ap.heartbeat_path()))
        self.assertTrue(v["next_run"])
        self.assertTrue(os.path.exists(self.ap.heartbeat_path()))
        # Everywhere's schedule changes reach it
        v0 = v["next_run"]
        self.cmd("set", everywhere=True, every="weekdays 9:07")
        v = self.cmd("show", space="sp1")
        self.assertEqual(v["every"], "weekdays 9:07")
        self.assertNotEqual(v["next_run"], v0)
        # its own schedule wins there (and gets its own next wake); its events still follow Everywhere's
        v = self.cmd("set", space="sp1", every="every 2 hours")
        self.assertEqual((v["every"], v["events"], v["own"]), ("every 2 hours", ["ready"], ["every"]))
        self.assertEqual(self.cmd("show", space="sp2")["every"], "weekdays 9:07")
        self.cmd("set", everywhere=True, every="every 60 minutes")
        self.assertEqual(self.cmd("show", space="sp1")["every"], "every 2 hours")
        # "default": back to Everywhere's
        v = self.cmd("set", space="sp1", every="default")
        self.assertEqual((v["every"], v["own"]), ("every 60 minutes", []))
        with open(self.settings_file) as f:
            self.assertNotIn("sp1", json.load(f).get("spaces", {}))
        # a schedule that isn't one is refused, and one written by hand is passed over
        with self.assertRaises(self.ap.Fail):
            self.cmd("set", space="sp1", every="whenever")
        self.assertEqual(self.ap.resolve({}, {}, "sp1", {"spaces": {"sp1": {"autopilot": {"every": "whenever"}}}})["every"]["text"], "every 60 minutes")
        # Everywhere can't switch spaces on or off
        for sub in ("on", "off", "run-now"):
            with self.assertRaises(self.ap.Fail):
                self.cmd(sub, everywhere=True)
        v = self.cmd("off", space="sp1")
        self.assertEqual((v["on"], v["next_run"]), (False, None))
        self.assertEqual([x["space"] for x in self.cmd("list")["spaces"]], ["sp1"])

    def test_heartbeats(self):
        """Everywhere's file from before, until Settings has one; a space's own wins there."""
        v = self.cmd("heartbeat")
        self.assertEqual((v["heartbeat"], v["heartbeat_from"], v["blank"]), (self.ap.heartbeat_path(), "file", False))
        with open(v["heartbeat"]) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        # the starter is a real heartbeat: a wake brings it as it is
        self.assertIn("Push the project forward", self.ap.message("sp1", {}, ["run now"]))
        with open(v["heartbeat"], "w") as f:
            f.write("Ship the docs.\n")
        self.assertIn("Ship the docs.", self.ap.message("sp1", {}, ["run now"]))
        self.cmd("set", everywhere=True, heartbeat="Keep the tests green.")
        self.cmd("set", space="sp1", heartbeat="Only the web app.")
        one, two = self.ap.message("sp1", {}, ["run now"]), self.ap.message("sp2", {}, ["run now"])
        self.assertIn("Only the web app.", one)
        self.assertIn("this space's own", one)
        self.assertIn("Keep the tests green.", two)
        self.assertNotIn("Ship the docs.", two)
        self.assertEqual(self.cmd("heartbeat", space="sp1")["heartbeat_from"], "space")
        self.assertEqual(self.cmd("show", space="sp1")["own"], ["heartbeat"])

    def test_old_starter_gets_the_new_one(self):
        """An earlier version's starter, never edited, stands for today's: the file is rewritten,
        Settings' words are read as it; an edited one is kept, an empty one stays blank."""
        path = self.ap.heartbeat_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        old = self.ap.OLD_STARTERS[-1]  # the first starter, a form to fill in
        with open(path, "w") as f:
            f.write(old)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        with open(path, "w") as f:
            f.write("  " + old.strip() + "\n\n")
        self.assertIn("Push the project forward", self.ap.message("sp1", {}, ["run now"]))
        # edited, even a little: kept as the person wrote it
        edited = old.replace("Priorities:\n-", "Priorities:\n- the docs")
        with open(path, "w") as f:
            f.write(edited)
        self.cmd("heartbeat")
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), edited)
        # in Settings, Everywhere's or a space's own: read as today's
        self.cmd("set", space="sp1", heartbeat=old)
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["heartbeat_text"], v["blank"]), (self.ap.STARTER, False))
        self.assertIn("Push the project forward", self.ap.message("sp1", {}, ["run now"]))
        # empty: no heartbeat, and a wake says so
        self.cmd("set", space="sp1", heartbeat="")
        self.assertTrue(self.cmd("show", space="sp1")["blank"])
        self.assertIn("not written yet", self.ap.message("sp1", {}, ["run now"]))

    def test_the_last_starter_upgrades_with_a_backup(self):
        """A machine still on the starter that said "Don't invent work" gets today's, the old one kept
        as everywhere.md.bak; a file the person edited is left as it is, with no backup."""
        path = self.ap.heartbeat_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        last = next(x for x in self.ap.OLD_STARTERS if "Don't invent work" in x)
        with open(path, "w") as f:
            f.write(last)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        with open(path + ".bak") as f:
            self.assertEqual(f.read(), last)
        os.remove(path + ".bak")
        # today's starter: nothing to do, no backup
        self.cmd("list")
        self.assertFalse(os.path.exists(path + ".bak"))
        # edited: kept, no backup
        edited = last.replace("4. New tasks: only follow-ups I asked for", "4. New tasks: only what I ask for")
        with open(path, "w") as f:
            f.write(edited)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), edited)
        self.assertFalse(os.path.exists(path + ".bak"))
        self.assertIn("4. New tasks: only what I ask for", self.ap.message("sp1", {}, ["run now"]))

    def test_the_asking_starter_upgrades_with_a_backup(self):
        """3.1.5's starter (which told it to ask) becomes today's deciding one, kept as everywhere.md.bak;
        an edited one stays as it is, with no backup."""
        path = self.ap.heartbeat_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        last = next(x for x in self.ap.OLD_STARTERS if "ask me once, in one clear question" in x)
        with open(path, "w") as f:
            f.write(last)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        with open(path + ".bak") as f:
            self.assertEqual(f.read(), last)
        os.remove(path + ".bak")
        edited = last.replace("At most 2 a wake", "At most 1 a wake")
        with open(path, "w") as f:
            f.write(edited)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), edited)
        self.assertFalse(os.path.exists(path + ".bak"))

    def test_a_wake_decides_instead_of_asking(self):
        """The wake and the starter tell it to make the calls itself and never ask; only a take-over,
        for what's critical, goes to the person as an alert."""
        m = self.ap.message("sp1", {}, ["schedule"])
        for words in ("Never ask the person a question on a wake", "pick the best option", "Never ask me a question",
                      "Take over: the only time you stop for me", "herdr-task alert", "carry on with other work",
                      "answer it yourself"):
            self.assertIn(words, m)
        for words in ("ask me once", "Ask before anything", "Tell me in a line if it looks right"):
            self.assertNotIn(words, m)

    def test_a_wake_drives_the_project(self):
        """By default a wake asks for new tasks that push the project forward, toward the space's
        Direction when it has one (else the project's own), and a quiet reply only when there's
        truly nothing worth doing."""
        m = self.ap.message("sp1", {}, ["schedule"])
        for words in ("Push the project forward", "add and start the next most valuable", "Direction: none set",
                      "truly nothing worth doing", "Never merge, Accept"):
            self.assertIn(words, m)
        self.assertNotIn("Don't invent work", m)
        self.cmd("set", space="sp1", direction="  Launch the\n shop  ")
        v = self.cmd("show", space="sp1")
        self.assertEqual((v["direction"], v["own"]), ("Launch the shop", ["direction"]))
        self.assertIn("Direction (set by the person, Shepherdr settings > Autopilot): Launch the shop", self.ap.message("sp1", {}, ["schedule"]))
        self.assertIn("Direction: none set", self.ap.message("sp2", {}, ["schedule"]))
        self.cmd("set", space="sp1", direction="")
        self.assertEqual(self.cmd("show", space="sp1")["direction"], "")

    def test_check_and_pushed_copies(self):
        self.assertEqual(self.cmd("check", every="Weekdays 9:00")["every"], "Weekdays 9:00")
        self.assertEqual(self.cmd("check", every="off")["every"], None)
        with self.assertRaises(self.ap.Fail):
            self.cmd("check", every="whenever")
        # a copy the window pushed here: its machine holds the truth
        with open(self.settings_file, "w") as f:
            json.dump({"pushed_from": "herdr-app", "here": "vm"}, f)
        with self.assertRaises(self.ap.Fail):
            self.cmd("set", space="sp1", every="every 2 hours")

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
        self.assertTrue(lines[0].startswith("Everywhere: Every hour"), lines)
        self.assertTrue(lines[1].startswith("tt-repo: Autopilot on"), lines)

    def test_on_starts_this_machines_scheduler(self):
        self.cmd("on", space="sp1")
        self.assertEqual(getattr(self, "schedulers", 0), 1)
        self.cmd("off", space="sp1")
        self.assertEqual(self.schedulers, 1)

    def test_a_folder_told_from_another_machines_window(self):
        # A VM has no window: the machine whose window lists the space says its name and folder.
        v = self.cmd("on", space="sp7", name="exedev", space_folder=self.folder)
        self.assertEqual((v["on"], v["name"], v["folder"]), (True, "exedev", self.folder))

    def remote(self, answers):
        """herdr-task on other machines, as cli.remote_run runs it: answers[machine](argv) -> its JSON out."""
        from unittest import mock
        import subprocess
        import herdr_task.cli as cli
        self.sent = []

        def run(machine, argv, timeout=None):
            self.sent.append((machine, argv))
            out = answers[machine](argv)
            return subprocess.CompletedProcess(argv, 0 if out is not None else 1, json.dumps(out) if out is not None else "", "" if out is not None else "hc: unreachable")
        p = mock.patch.object(cli, "remote_run", run)
        p.start()
        self.addCleanup(p.stop)

    def test_another_machines_space_is_switched_there(self):
        from unittest import mock
        win = [{"id": "sp1", "name": "~", "folder": self.folder},
               {"id": "vm/sp9", "machine": "vm", "name": "exedev", "folder": "/home/exedev"}]
        p = mock.patch.object(self.ap, "window_spaces", lambda: win)
        p.start()
        self.addCleanup(p.stop)
        self.remote({"vm": lambda argv: {"space": "sp9", "on": argv[1] == "on", "name": "exedev", "trigger": "Every hour"}})
        v = self.cmd("on", space="vm/sp9")
        self.assertEqual(self.sent, [("vm", ["autopilot", "on", "--space", "sp9", "--json", "--name", "exedev", "--space-folder", "/home/exedev"])])
        self.assertEqual((v["space"], v["machine"], v["on"]), ("vm/sp9", "vm", True))
        # Nothing here wakes it: no record of it on this machine, and this machine's scheduler isn't asked.
        self.assertFalse(os.path.exists(self.ap.STATE))
        self.assertEqual(getattr(self, "schedulers", 0), 0)
        self.cmd("run-now", space="vm/sp9")
        self.assertEqual(self.sent[-1][1][:4], ["autopilot", "run-now", "--space", "sp9"])

    def test_another_machines_refusal_is_said_here(self):
        self.remote({"vm": lambda argv: {"error": "Autopilot is off in this space: turn it on first."}})
        with self.assertRaises(self.ap.Fail) as e:
            self.cmd("run-now", space="vm/sp9")
        self.assertIn("turn it on first", str(e.exception))
        self.remote({"vm": lambda argv: None})
        with self.assertRaises(self.ap.Fail) as e:
            self.cmd("off", space="vm/sp9")
        self.assertIn("Couldn't reach vm", str(e.exception))

    def test_another_machines_space_is_set_here_by_its_full_id(self):
        self.remote({})
        v = self.cmd("set", space="vm/sp9", every="every 2 hours")
        with open(self.settings_file) as f:
            self.assertEqual(json.load(f)["spaces"]["vm/sp9"]["autopilot"], {"every": "every 2 hours"})
        self.assertEqual((v["space"], v["own"], self.sent), ("vm/sp9", ["every"], []))

    def test_list_holds_every_machines_spaces(self):
        from unittest import mock
        self.cmd("on", space="sp1")
        self.cmd("on", space="spgone")  # a space the window no longer lists
        win = [{"id": "sp1", "name": "~", "folder": self.folder}, {"id": "sp2", "name": "docs", "folder": "/tmp/docs"},
               {"id": "vm/sp9", "machine": "vm", "name": "exedev", "folder": "/home/exedev"},
               {"id": "vm/sp8", "machine": "vm", "name": "~", "folder": "/home/exedev/dev/game"},
               {"id": "mini/sp5", "machine": "mini", "name": "Home", "folder": "/Users/me"}]
        p = mock.patch.object(self.ap, "window_spaces", lambda: win)
        p.start()
        self.addCleanup(p.stop)
        self.remote({"vm": lambda argv: {"everywhere": {"trigger": "Every hour"},
                                         "spaces": [{"space": "sp9", "on": True, "trigger": "Every hour", "next_run": None, "own": []}]},
                     "mini": lambda argv: None})
        out = self.cmd("list")
        self.assertEqual(sorted(m for m, _ in self.sent), ["mini", "vm"])
        self.assertTrue(all(argv == ["autopilot", "list", "--here", "--json"] for _, argv in self.sent))
        got = {v["space"]: v for v in out["spaces"]}
        self.assertEqual(list(got), ["sp1", "sp2", "vm/sp9", "vm/sp8", "mini/sp5"])
        self.assertEqual([got[k]["on"] for k in ("sp1", "sp2", "vm/sp9", "vm/sp8")], [True, False, True, False])
        self.assertTrue(got["mini/sp5"].get("unreachable"))
        lines = [self.ap.line_of(v) for v in out["spaces"]]
        self.assertTrue(lines[2].startswith("exedev on vm: Autopilot on"), lines)
        self.assertTrue(lines[3].startswith("game on vm: Autopilot off"), lines)
        self.assertEqual(lines[4], "Home on mini: can't tell, mini didn't answer")
        # --here: this machine's only, nothing asked elsewhere
        self.sent = []
        self.assertEqual([v["space"] for v in self.cmd("list", here=True)["spaces"]], ["sp1", "sp2"])
        self.assertEqual(self.sent, [])

    def test_the_parking_starter_upgrades_with_a_backup(self):
        """SHEP-40: 3.1.7's starter (whose quiet wakes parked behind an Accept with a bare no-reply)
        becomes today's, kept as everywhere.md.bak; an edited one stays as it is."""
        path = self.ap.heartbeat_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        last = self.ap.OLD_STARTERS[0]
        self.assertIn("Reply only <hc no-reply/> when there's truly nothing worth doing", last)
        self.assertIn("Never ask me a question on a wake", last)
        with open(path, "w") as f:
            f.write(last)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
        with open(path + ".bak") as f:
            self.assertEqual(f.read(), last)
        for words in ("Never park on a task waiting for my Accept", "never a limit of your own",
                      'end with <hc no-reply why="', "never a bare <hc no-reply/>"):
            self.assertIn(words, self.ap.STARTER)
        self.assertNotIn("Reply only <hc no-reply/>", self.ap.STARTER)
        # in Settings, as it was: read as today's
        self.cmd("set", space="sp1", heartbeat=last)
        self.assertEqual(self.cmd("show", space="sp1")["heartbeat_text"], self.ap.STARTER)
        # edited: kept, no backup
        os.remove(path + ".bak")
        edited = last.replace("At most 2 a wake", "At most 1 a wake")
        with open(path, "w") as f:
            f.write(edited)
        self.cmd("list")
        with open(path) as f:
            self.assertEqual(f.read(), edited)
        self.assertFalse(os.path.exists(path + ".bak"))

    def test_a_wake_never_parks_on_an_accept(self):
        """SHEP-40, tor-gameboy: TG-2 Ready, TG-3 queued after it and TG-4 after TG-3. The wake names
        what waits on the person, asks for work around it, a why on a quiet reply, and no self-made limits."""
        p = os.path.join(self.tmp, "tasks", "dev-tor-gameboy.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump({"folder": self.folder, "prefix": "TG", "tasks": [
                {"id": 1, "state": "done", "space": "sp1"},
                {"id": 2, "state": "ready", "space": "sp1"},
                {"id": 3, "state": "queued", "after": [2]},
                {"id": 4, "state": "queued", "after": [3]},
                {"id": 5, "state": "ready", "space": "sp1"},
                {"id": 6, "state": "ready", "space": "sp9"},
                {"id": 7, "state": "queued", "after": [6], "space": "sp9"}]}, f)
        self.lists = [p]
        a = {"folder": self.folder, "progress": {"text": "TG-3 queued behind it (Elias pace: one at a time).", "at": self.ap.now()}}
        self.assertEqual(self.ap.waiting("sp1", a), ["TG-2 is Ready, waiting on the person's Accept; TG-3 and TG-4 wait behind it"])
        self.assertEqual(self.ap.waiting("sp9", {}), ["TG-6 is Ready, waiting on the person's Accept; TG-7 waits behind it"])
        m = self.ap.message("sp1", a, ["schedule"])
        for words in ("Waiting on the person:\n- TG-2 is Ready, waiting on the person's Accept; TG-3 and TG-4 wait behind it",
                      "never parks you", "work that doesn't need it", "say in one line what waits on the person's Accept",
                      "never a limit or pace of your own", "doesn't apply", '<hc no-reply why="..."/>',
                      "never a bare <hc no-reply/>"):
            self.assertIn(words, m)
        # nothing waiting: no such section
        self.lists = []
        self.assertNotIn("Waiting on the person", self.ap.message("sp1", a, ["schedule"]))

    def wake(self, ago, turn=3):
        """sp1 on, with a wake delivered to t9 `ago` ms back (its turn then: `turn`)."""
        self.cmd("on", space="sp1")
        with self.ap.state() as d:
            a = d["spaces"]["sp1"]
            a.pop("pending", None)  # the first wake switching on queued: this one stands for it
            a["inflight"] = {"at": self.ap.now() - ago, "reason": "schedule", "to": "t9", "turn": turn}
            self.ap.log_wake(a, "schedule", "Delivered", a["inflight"]["at"])

    def settled(self, k):
        """settle() with the Assistant as `k` (hc get's): the wake left, if its turn ended."""
        from unittest import mock
        k = {"state": "live", "foreground": {"name": "claude"}, **k}
        with mock.patch.object(self.ap, "hc_json", lambda *a: k), self.ap.state() as d:
            self.ap.settle(d["spaces"]["sp1"])
            return d["spaces"]["sp1"]

    def test_a_wake_ends_with_its_turn(self):
        """SHEP-34: the header leaves "Waking" once the wake's turn ends, by its count or, should
        that miss it, the Assistant idle a while; else after the timeout."""
        done = {"turn": 4, "status": {"state": "done"}}
        self.wake(5000)
        self.assertIn("inflight", self.settled({"turn": 4, "status": {"state": "working"}}))
        a = self.settled(done)
        self.assertNotIn("inflight", a)
        self.assertEqual(a["last_wake"]["outcome"], "Turn ended, no progress saved")
        self.assertEqual(self.cmd("show", space="sp1")["inflight"], None)
        # its turn not counted: idle a while after the wake ends it, not at once
        self.wake(5000)
        self.assertIn("inflight", self.settled({"turn": 3, "status": {"state": "idle"}, "status_ms": self.ap.now() - 60000}))
        # SHEP-40: a one-second quiet turn the count missed: its status settled after the wake ends it at once
        self.wake(5000)
        a = self.settled({"turn": 3, "status": {"state": "done"}, "status_ms": self.ap.now() - 4000})
        self.assertNotIn("inflight", a)
        self.assertEqual(a["last_wake"]["outcome"], "Turn ended, no progress saved")
        self.assertEqual(self.cmd("show", space="sp1")["inflight"], None)
        # still working since the wake: not ended
        self.wake(5000)
        self.assertIn("inflight", self.settled({"turn": 3, "status": {"state": "working"}, "status_ms": self.ap.now() - 4000}))
        self.wake(self.ap.IDLE_AFTER_MS + 1000)
        self.assertNotIn("inflight", self.settled({"turn": 3, "status": {"state": "idle"}}))
        # asking the person something: still its wake, until the timeout
        self.wake(self.ap.IDLE_AFTER_MS + 1000)
        self.assertIn("inflight", self.settled({"turn": 3, "status": {"state": "blocked"}}))
        self.wake(self.ap.TURN_MAX_MS + 1000)
        self.assertEqual(self.settled({"turn": 3, "status": {"state": "working"}})["last_wake"]["outcome"],
                         "No turn end seen, no progress saved")
        # its agent quit (a shell left) or its terminal gone
        self.wake(5000)
        self.assertEqual(self.settled({"foreground": {"name": "bash"}, "turn": 3})["last_wake"]["outcome"],
                         "Assistant stopped, no progress saved")

    def test_switching_on_wakes_at_once(self):
        """SHEP-5: switched on, its first wake goes now (not one interval later); already on, no second one."""
        from unittest import mock
        v = self.cmd("on", space="sp1")
        # no Assistant running yet: queued, said so, and still a scheduled wake after it
        self.assertEqual(v["pending"]["reasons"], ["switched on"])
        self.assertTrue(v["next_run"])
        self.cmd("off", space="sp1")
        self.assertEqual(self.cmd("show", space="sp1")["pending"], None)
        k = {"state": "live", "foreground": {"name": "claude"}, "turn": 2, "status": {"state": "idle"}}
        sent = []
        with mock.patch.object(self.ap, "hc_json", lambda *a: k), mock.patch.object(self.ap, "coordinator_in", lambda s: "t9"), \
                mock.patch.object(self.ap, "typing", lambda *a: False), \
                mock.patch.object(self.ap, "news_send", lambda to, m, check=True: sent.append(m) or True):
            v = self.cmd("on", space="sp1")
            self.assertEqual((len(sent), v["inflight"]["reason"]), (1, "switched on"))
            self.assertIn('reason="switched on"', sent[0])
            self.cmd("on", space="sp1")
        self.assertEqual(len(sent), 1)

    def test_run_now_goes_after_a_wake_whose_turn_ended(self):
        """A wake the scheduler hasn't closed yet never holds Run now back."""
        from unittest import mock
        self.wake(5000)
        k = {"state": "live", "foreground": {"name": "claude"}, "turn": 4, "status": {"state": "done"}}
        sent = []
        with mock.patch.object(self.ap, "hc_json", lambda *a: k), mock.patch.object(self.ap, "coordinator_in", lambda s: "t9"), \
                mock.patch.object(self.ap, "typing", lambda *a: False), \
                mock.patch.object(self.ap, "news_send", lambda to, m, check=True: sent.append(to) or True):
            v = self.cmd("run-now", space="sp1")
        self.assertEqual(sent, ["t9"])
        self.assertEqual((v["inflight"]["reason"], v["inflight"]["turn"]), ("run now", 4))
        self.assertEqual([w["outcome"] for w in v["wakes"]], ["Turn ended, no progress saved", "Delivered"])


class RemoteInstall(unittest.TestCase):
    """herdr-task --on installs itself on the other machine first, never over a machine that holds its source."""

    def setUp(self):
        from unittest import mock
        import subprocess
        sys.path.insert(0, BIN)
        import herdr_task.cli as cli
        self.cli, self.store, self.ran, self.wrote = cli, tempfile.mkdtemp(), [], []
        self.source = False

        def run(argv, cwd=None, check=False):
            self.ran.append(argv)
            code = 0 if argv[:2] != ["hc", "exec"] or "test" not in argv else (0 if self.source else 1)
            return subprocess.CompletedProcess(argv, code, "{}" if "test" not in argv else "", "")

        def write(argv, **kw):
            self.wrote.append(argv)
            return subprocess.CompletedProcess(argv, 0, b"", b"")
        for name, value in (("run", run), ("STORE", self.store), ("sync_held", lambda: None), ("guard", lambda a: None),
                            ("install_secret", lambda m: None)):
            p = mock.patch.object(cli, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(cli.subprocess, "run", write)
        p.start()
        self.addCleanup(p.stop)

    def test_a_machine_without_the_source_gets_this_copy(self):
        self.cli.remote_run("vm", ["autopilot", "list", "--json"])
        self.assertEqual(self.wrote[0][:5], ["hc", "file", "write", "--on", "vm"])

    def test_a_machine_holding_the_source_is_never_written_to(self):
        self.source = True
        self.cli.remote_run("mini", ["autopilot", "list", "--json"])
        self.cli.remote_run("mini", ["autopilot", "list", "--json"])
        self.assertEqual(self.wrote, [])
        self.assertEqual(sum(1 for a in self.ran if "test" in a), 1)  # asked once, then remembered
        self.assertEqual(self.ran[-1][-3:], ["autopilot", "list", "--json"])


class AutomationMachine(unittest.TestCase):
    """auto list/show --json say whose an automation is: none here, the machine through --on (SHEP-43)."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.cli as cli
        self.cli, self.answer = cli, ""
        p = mock.patch.object(cli, "remote_run", lambda m, argv: subprocess.CompletedProcess(argv, 0, self.answer, ""))
        p.start()
        self.addCleanup(p.stop)

    def remote(self, argv, answer):
        from unittest import mock
        import io
        self.answer = json.dumps(answer)
        with mock.patch.object(sys, "stdout", io.StringIO()) as out:
            self.cli.remote("vm-b", argv)
        return json.loads(out.getvalue())

    def test_a_list_from_another_machine_names_it(self):
        got = self.remote(["auto", "list", "--json", "--all"], [{"ref": "X-A1", "folder": "/w", "machine": None}])
        self.assertEqual(got[0]["machine"], "vm-b")

    def test_one_from_another_machine_names_it(self):
        got = self.remote(["auto", "show", "--json", "X-A1"], {"ref": "X-A1", "folder": "/w", "machine": None})
        self.assertEqual(got["machine"], "vm-b")

    def test_a_feed_is_left_as_it_is(self):
        got = self.remote(["auto", "feed", "--json"], {"folder": "/w", "prefix": "X", "tasks": []})
        self.assertNotIn("machine", got)

    def test_here_it_names_none(self):
        import herdr_task.automations as au
        s = type("S", (), {"loc": {"folder": "/w"}, "prefix": "X", "data": {}})()
        with __import__("unittest").mock.patch.object(au, "settings_for", lambda s, sp: {"automations": {}}):
            v = au.auto_view(s, {"id": 1, "title": "t"})
        self.assertIsNone(v["machine"])


class SchedulerRound(unittest.TestCase):
    """The scheduler's round (automations.one_pass) and the window's or service's tick share one lock,
    both every 15 s. SHEP-34: a round that found the tick holding it skipped, and in step with the
    tick it skipped every time, so no autopilot wake was ever closed (the header stuck on "Waking")."""

    def test_a_round_waits_for_the_tick_and_runs(self):
        import fcntl
        import threading
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.automations as au
        import herdr_task.autopilot as ap
        import herdr_task.home as home
        store = tempfile.mkdtemp()
        ran = []
        patches = [mock.patch.object(au, "STORE", store), mock.patch.object(au, "SEEN", os.path.join(store, ".seen.json")),
                   mock.patch.object(au, "store_files", lambda *a: []), mock.patch.object(ap, "autopilot_pass", ran.append),
                   mock.patch.object(home, "home_pass", lambda r: None)]
        patches += [mock.patch.object(au, n, lambda *a, **k: None) for n in (
            "retry_pass", "archive_pass", "news_pass", "end_done_pass", "memory_guard", "backup_pass", "cli_check_pass", "machines_pass")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        # a tick holds the lock as the round starts, and lets go a moment later
        tick = open(os.path.join(store, ".tick.lock"), "a")
        fcntl.flock(tick, fcntl.LOCK_EX)
        threading.Timer(0.5, lambda: (fcntl.flock(tick, fcntl.LOCK_UN), tick.close())).start()
        au.one_pass({})
        self.assertEqual(len(ran), 1, "the round gave way to the tick and skipped autopilot")
        self.assertTrue(os.path.exists(os.path.join(store, ".seen.json")))
        # a lock held past the wait: this round skips, the scheduler tries again in 15 s
        with open(os.path.join(store, ".tick.lock"), "a") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            with mock.patch.object(au, "LOCK_WAIT_S", 0.3):
                au.one_pass({})
        self.assertEqual(len(ran), 1)


class BackToWork(unittest.TestCase):
    """A Ready task that goes back to work is Working again (busy_again(), back_to_work()), and
    Accept retries a merge that failed once. In memory: hc, git and gh are never run."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.agents as agents
        import herdr_task.commands as commands
        import herdr_task.news as news
        import herdr_task.tick as tick
        self.agents, self.commands, self.news, self.tick, self.mock = agents, commands, news, tick, mock
        with open(os.path.join(ROOT, "core", "back-to-work.cases.json")) as f:
            self.cases = json.load(f)

        def never(*a, **k):
            raise AssertionError("ran a program")
        self.live = []  # the task's agents now (hc records)
        self.store = Store([])
        for mod, name, value in ((commands, "run", never), (commands, "git", never), (commands, "gh", never),
                                 (commands, "open_store", lambda args, write=True: self.store),
                                 (commands, "view", lambda s, t, live=None: dict(t)), (commands, "say", lambda *a: None),
                                 (commands, "live_agents", lambda key: self.live), (commands, "detail", lambda k: k),
                                 (commands, "refresh_sessions", lambda *a: None),
                                 (tick, "live_agents", lambda key: self.live), (tick, "detail", lambda k: k)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def agent(self, a):
        """A case's agent as hc gives it."""
        return {"address": a["address"], "status": {"state": a["status"]}, "turn": a["turn"], "labels": {"herdr.role": a["role"]}}

    def ready(self, **more):
        t = {"id": 7, "title": "Web client", "state": "ready", "ready_at": 1, "ready_turns": {"t1": 5}, "agents": [], **more}
        self.store.data["tasks"] = [t]
        return t

    def args(self, **kw):
        import argparse
        return argparse.Namespace(id="SHEP-7", json=True, folder=None, **kw)

    def test_the_rule_is_cores(self):
        """The cases core/tasks.test.js checks busyAgain() on."""
        with self.mock.patch.object(self.agents, "now", lambda: self.cases["now"]):
            for c in self.cases["cases"]:
                self.assertEqual(self.agents.busy_again(c["task"], [self.agent(a) for a in c["live"]]), c["expect"], c["name"])

    def test_its_status_is_working_again(self):
        t = self.ready()
        self.assertEqual(self.agents.task_status(t, [self.agent({"address": "t1", "status": "working", "turn": 5, "role": "worker"})]),
                         ("working", None, "Working again"))
        # still finishing the turn it said ready in: not Working again, but not Ready yet either (SHEP-148)
        self.assertEqual(self.agents.task_status(t, [self.agent({"address": "t1", "status": "working", "turn": 4, "role": "worker"})]),
                         ("working", None, None))
        self.assertEqual(self.agents.task_status(t, [self.agent({"address": "t1", "status": "idle", "turn": 5, "role": "worker"})])[0], "ready")

    def test_a_problem_its_agent_is_on_reads_working(self):
        """SHEP-8: the cases core/tasks.test.js checks place() on (core/on-it.cases.json)."""
        with open(os.path.join(ROOT, "core", "on-it.cases.json")) as f:
            on = json.load(f)
        with self.mock.patch.object(self.agents, "now", lambda: on["now"]):
            for c in on["cases"]:
                why = self.agents.REASONS["question"] if c["expect"]["why"] == "QUESTION" else c["expect"]["why"]
                got = self.agents.task_status(dict(c["task"], id=7), [self.agent(a) for a in c["live"]])
                self.assertEqual(got, (c["expect"]["status"], c["expect"]["needs"], why), c["name"])

    def test_failing_checks_need_you_only_once_its_agent_stops_on_them(self):
        """SHEP-8 end to end: the tick finds the check failing on a Ready task; its agent at work on it
        (back at work, then waiting on CI with its own status) reads Working; idle with the check still
        failing once its line is stale, Needs you; the fix pushed and the check gone, the problem too."""
        t = self.ready(space="sp1", mode="worktree", worktree="/w", branch="b", pr={"number": 3, "repo": "o/r", "checked": 0})
        red = {"state": "OPEN", "mergeable": "MERGEABLE", "headRefOid": "a",
               "statusCheckRollup": [{"name": "check", "conclusion": "FAILURE"}]}
        views = [red]
        clock = [10_000_000]
        for mod, name, value in ((self.tick, "pr_view", lambda t: views[0]), (self.tick, "pr_news", lambda *a: None),
                                 (self.tick, "now", lambda: clock[0]), (self.agents, "now", lambda: clock[0]),
                                 (self.commands, "now", lambda: clock[0])):
            p = self.mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        status = lambda: self.agents.task_status(t, self.live)
        worker = lambda st, turn: [self.agent({"address": "t1", "status": st, "turn": turn, "role": "worker"})]
        # its agent is already at work when the failure is found: Working, not Needs you
        self.live = worker("working", 5)
        self.tick.facts(self.store, t, {"attention": []})
        self.assertEqual(t["attention"], "Checks failing: check.")
        self.assertEqual(status(), ("working", None, "Working again"))
        # the tick takes it back to work; it says what it does and waits on CI in the background
        self.tick.back_pass(self.store, t, {})
        self.assertEqual(t["state"], "running")
        clock[0] += 60_000
        self.commands.cmd_status(self.args(text="Re-running CI", done=95, left=None))
        self.live = worker("idle", 6)
        self.assertEqual(status(), ("working", None, None))
        # 40 minutes on, idle, the check still failing: nobody is on it
        clock[0] += 40 * 60_000
        t["pr"]["checked"] = 0
        self.tick.facts(self.store, t, {"attention": []})
        self.assertEqual(status(), ("needs", "attention", "Checks failing: check."))
        # its fix pushed, the failure gone: so is the problem
        views[0] = dict(red, statusCheckRollup=[{"name": "check", "status": "IN_PROGRESS"}])
        t["pr"]["checked"] = 0
        self.tick.facts(self.store, t, {"attention": []})
        self.assertNotIn("attention", t)

    def test_ready_again_when_its_own_turn_changed_nothing(self):
        """SHEP-133: a background job's notice (or a question in its chat) wakes a Ready task's agent;
        it answers and goes quiet with nothing new. Ready again, not Needs you."""
        wt = tempfile.mkdtemp()
        said = {"text": "Proof published", "at": 1, "set": 1}
        t = self.ready(mode="worktree", worktree=wt, branch="b", head="abc", progress=dict(said))
        repo = {"head": "abc", "dirty": ""}
        p = self.mock.patch.object(self.tick, "git", lambda cwd, *a: (True, repo["head"] if a[0] == "rev-parse" else repo["dirty"], ""))
        p.start()
        self.addCleanup(p.stop)
        worker = lambda st, turn: [dict(self.agent({"address": "t1", "status": st, "turn": turn, "role": "worker"}), agent="claude")]
        # woken: Working again (its Assistant hears it), Herdr's line
        self.live = worker("working", 5)
        self.tick.tick_store(self.store, {"started": []})
        self.assertEqual((t["state"], t["back"]["auto"], t["progress"]["by"]), ("running", True, "herdr"))
        # still at work: stays so
        self.tick.tick_store(self.store, {"started": []})
        self.assertEqual(t["state"], "running")
        # its turn over, nothing new: Ready again, its own line back, the next turn new work again
        self.live = worker("idle", 6)
        report = {"started": []}
        self.tick.tick_store(self.store, report)
        self.assertEqual((t["state"], t["ready_turns"], t["progress"], report["ready_again"]), ("ready", {"t1": 6}, said, ["SHEP-7"]))
        self.assertNotIn("back", t)
        self.assertEqual(self.agents.task_status(t, self.live)[0], "ready")
        # woken again, and this time it commits, or leaves changes, or asks: stays Working (Needs you after the grace)
        for change in ({"head": "def"}, {"dirty": " M a.py"}):
            t.update(state="ready", ready_turns={"t1": 6})
            repo.update({"head": "abc", "dirty": "", **change})
            self.live = worker("working", 6)
            self.tick.tick_store(self.store, {"started": []})
            self.live = worker("idle", 7)
            self.tick.tick_store(self.store, {"started": []})
            self.assertEqual(t["state"], "running", change)

    def test_a_fix_asked_for_is_never_undone(self):
        """herdr-task fix or resume took it back: Working until its agent says ready, idle or not."""
        t = self.ready(mode="worktree", worktree=tempfile.mkdtemp(), branch="b", head="abc")
        p = self.mock.patch.object(self.tick, "git", lambda cwd, *a: (True, "abc" if a[0] == "rev-parse" else "", ""))
        p.start()
        self.addCleanup(p.stop)
        self.commands.back_to_work(self.store, t, "the person asked for a fix")
        self.assertNotIn("auto", t["back"])
        self.live = [dict(self.agent({"address": "t1", "status": "idle", "turn": 6, "role": "worker"}), agent="claude")]
        self.tick.tick_store(self.store, {"started": []})
        self.assertEqual(t["state"], "running")

    def test_ready_keeps_each_agents_next_turn(self):
        turns = self.agents.ready_turns([{"address": "t1", "status": {"state": "working"}, "turn": 4},
                                         {"address": "t2", "status": "idle", "turn": 2}])
        self.assertEqual(turns, {"t1": 5, "t2": 2})

    def test_fix_takes_it_back_to_work(self):
        t = self.ready(mode="worktree", worktree="/w", branch="b", merge_requested=5)
        self.store.loc["folder"] = "/main"
        with self.mock.patch.object(self.commands, "tell", lambda s, t, msg, args: ("t1", False)):
            self.commands.cmd_fix(self.args(reason="Checks failing: test."))
        self.assertEqual(t["state"], "running")
        self.assertEqual(t["back"]["why"], "asked to fix: Checks failing: test.")
        self.assertEqual(t["progress"]["text"], "Fixing: Checks failing: test.")
        self.assertNotIn("ready_turns", t)
        self.assertNotIn("merge_requested", t)

    def test_resume_takes_it_back_to_work(self):
        t = self.ready(space="sp1")
        with self.mock.patch.object(self.commands, "start_again", lambda *a, **k: ({"address": "t2"}, True)):
            self.commands.cmd_resume(self.args(space=None, agent=None, argv=None, parent=None))
        self.assertEqual((t["state"], t["back"]["why"], t["progress"]["text"]), ("running", "resumed", "Working again"))

    def test_resume_nudges_the_resumed_agent(self):
        """SHEP-189: a resumed session comes back with no message; resume sends it a carry-on, so it
        doesn't sit idle until someone writes to it."""
        self.ready(space="sp1")
        got = {}

        def fake(s, t, space, *a, **k):
            got.update(k)
            return {"address": "t2"}, True
        with self.mock.patch.object(self.commands, "start_again", fake):
            self.commands.cmd_resume(self.args(space=None, agent=None, argv=None, parent=None))
        self.assertEqual(got.get("message"), self.commands.RESUME_NUDGE)
        self.assertIn("Carry on where you left off", got["message"])

    def test_accept_refuses_a_task_back_at_work(self):
        t = self.ready()
        self.live = [self.agent({"address": "t1", "status": "working", "turn": 5, "role": "worker"})]
        with self.assertRaises(self.commands.Fail) as no:
            self.commands.cmd_accept(self.args())
        self.assertIn("is working again", str(no.exception))
        self.assertEqual(t["state"], "running")
        self.assertNotIn("accepted_at", t)

    def test_the_tick_takes_it_back_and_the_news_says_so(self):
        t = self.ready(space="sp1")
        report = {}
        self.tick.back_pass(self.store, t, report)
        self.assertEqual(t["state"], "ready")  # nothing at work
        self.live = [self.agent({"address": "t1", "status": "working", "turn": 5, "role": "worker"})]
        self.tick.back_pass(self.store, t, report)
        self.assertEqual((t["state"], report["working_again"]), ("running", ["SHEP-7"]))
        self.assertEqual(self.news.news_line(self.store, t, {}, "working-again"),
                         '<herdr-news task="SHEP-7" event="working-again">SHEP-7 is working again: its agent is at work again (Web client)</herdr-news>')

    # A merge that failed once (t75: "GraphQL: Something went wrong") never blocks the next Accept, and a pull
    # request merged meanwhile (by hand) makes the task done.
    def merging(self, views, merges):
        """Accept with GitHub giving these pull request views and merge results in turn."""
        views, merges = list(views), list(merges)
        done = []
        patches = [(self.commands, "pr_view", lambda t: views.pop(0)),
                   (self.commands, "gh", lambda *a, **k: merges.pop(0)),
                   (self.commands, "watch_main", lambda *a: None), (self.commands, "update_main", lambda *a: None),
                   (self.commands, "finish", lambda s, t, even_if_busy=False: (t.update(state="done"), done.append(t["id"])))]
        for mod, name, value in patches:
            p = self.mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        return done

    def pr_task(self):
        return self.ready(mode="worktree", worktree="/w", branch="b", pr={"number": 593, "repo": "o/r", "checked": 5})

    def test_accept_tries_a_failed_merge_again(self):
        t = self.pr_task()
        fine = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc"}
        self.merging([fine, fine, fine, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}],
                     [(False, "", "GraphQL: Something went wrong"), (True, "", "")])
        with self.assertRaises(SystemExit):
            self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t["attention"]), ("ready", "GitHub didn't merge it: GraphQL: Something went wrong"))
        self.assertEqual(t["pr"]["checked"], 0)  # the next tick reads it at once
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t.get("merged")), ("done", True))

    def test_accept_finds_it_merged_by_hand(self):
        t = self.pr_task()
        t["attention"] = "GitHub didn't merge it: GraphQL: Something went wrong"
        self.merging([{"state": "MERGED", "mergeCommit": {"oid": "f00"}}], [])
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t.get("merged")), ("done", True))
        self.assertNotIn("attention", t)

    def test_a_merge_that_errs_but_went_through_is_done(self):
        t = self.pr_task()
        fine = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc"}
        self.merging([fine, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}], [(False, "", "GraphQL: Something went wrong")])
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t.get("merged")), ("done", True))

    # GitHub's merge queue (#742, #801, #802): gh refuses --delete-branch there; the pull request joins the
    # queue and the task stays Merging until GitHub merged it, then its branch there goes.
    QUEUE_ERR = "Cannot use `-d` or `--delete-branch` when merge queue enabled"
    FINE = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc"}

    def gh_merges(self, views, merges):
        """merging(), with each gh call kept."""
        calls, merges = [], list(merges)
        done = self.merging(views, [])
        p = self.mock.patch.object(self.commands, "gh", lambda *a, **k: (calls.append(a), merges.pop(0))[1])
        p.start()
        self.addCleanup(p.stop)
        dropped = []
        p = self.mock.patch.object(self.commands, "drop_branch", lambda s, t: dropped.append(t["id"]))
        p.start()
        self.addCleanup(p.stop)
        return calls, done, dropped

    def test_a_merge_queue_queues_it_and_it_is_not_done(self):
        t = self.pr_task()
        calls, done, dropped = self.gh_merges([self.FINE, self.FINE], [(False, "", self.QUEUE_ERR), (True, "", "")])
        self.commands.cmd_accept(self.args())
        self.assertEqual(len(calls), 2)
        self.assertIn("--delete-branch", calls[0])
        self.assertNotIn("--delete-branch", calls[1])
        self.assertEqual(calls[1][calls[1].index("--match-head-commit") + 1], "abc")
        self.assertEqual((t["state"], bool(t.get("merged")), done), ("ready", False, []))
        self.assertTrue(t["merge_queued"])
        self.assertNotIn("attention", t)
        self.assertEqual(self.agents.task_status(t, []), ("working", None, "In GitHub's merge queue"))
        # the queue is remembered for its base: the next merge goes straight to it
        t2 = dict(self.pr_task(), id=8)
        self.store.data["tasks"].append(t2)
        calls2, _, _ = self.gh_merges([self.FINE, self.FINE], [(True, "", "")])
        self.assertEqual(self.commands.merge_now(self.store, t2), self.commands.IN_QUEUE)
        self.assertNotIn("--delete-branch", calls2[0])
        self.assertEqual(dropped, [])

    def test_merge_again_while_queued_asks_github_nothing_more(self):
        t = self.pr_task()
        t["merge_queued"] = 1
        calls, done, _ = self.gh_merges([self.FINE], [])
        self.commands.cmd_merge(self.args())
        self.assertEqual((calls, done, t["state"]), ([], [], "ready"))

    def test_a_repo_without_a_queue_merges_as_before(self):
        t = self.pr_task()
        calls, done, dropped = self.gh_merges([self.FINE, {"state": "MERGED", "mergeCommit": {"oid": "f00"}}], [(True, "", "")])
        self.commands.cmd_accept(self.args())
        self.assertEqual(len(calls), 1)
        self.assertIn("--delete-branch", calls[0])
        self.assertEqual((t["state"], t.get("merged"), dropped), ("done", True, []))

    def queue_tick(self, v, entry=None, clock=10_000_000):
        """One tick pass over the task with GitHub saying v (and entry for its queue)."""
        got = {"done": [], "dropped": [], "asked": 0}

        def ask(t):
            got["asked"] += 1
            return entry
        for name, value in (("pr_view", lambda t: v), ("pr_news", lambda *a: None), ("now", lambda: clock),
                            ("queue_entry", ask), ("watch_main", lambda *a: None), ("update_main", lambda *a: None),
                            ("drop_branch", lambda s, t: got["dropped"].append(t["id"])),
                            ("finish", lambda s, t, even_if_busy=False: (t.update(state="done"), got["done"].append(t["id"])))):
            p = self.mock.patch.object(self.tick, name, value)
            p.start()
            self.addCleanup(p.stop)
        t = self.store.data["tasks"][0]
        t["pr"]["checked"] = 0
        report = {"attention": [], "done": []}
        self.tick.facts(self.store, t, report)
        return got, report

    def test_a_queued_pull_request_is_done_once_github_merged_it(self):
        t = self.pr_task()
        t["merge_queued"] = 10_000_000 - 1000
        got, _ = self.queue_tick(self.FINE, clock=10_000_000)
        self.assertEqual((t["state"], got["asked"]), ("ready", 0))  # just queued: not asked yet
        got, _ = self.queue_tick(self.FINE, {"in": True, "auto": False, "reason": None}, clock=20_000_000)
        self.assertEqual((t["state"], t.get("merge_queued"), got["asked"]), ("ready", 10_000_000 - 1000, 1))
        got, report = self.queue_tick({"state": "MERGED", "mergeCommit": {"oid": "f00"}})
        self.assertEqual((t["state"], t.get("merged"), got["dropped"], report["done"]), ("done", True, [7], [7]))

    def test_the_queue_removing_it_needs_you(self):
        t = self.pr_task()
        t["merge_queued"] = 1
        _, report = self.queue_tick(self.FINE, {"in": False, "auto": False, "reason": "The merge commit's checks failed"})
        self.assertNotIn("merge_queued", t)
        self.assertEqual(t["attention"], "GitHub's merge queue removed it: The merge commit's checks failed.")
        self.assertEqual(report["attention"], [7])
        # the next pass leaves that alone (nothing GitHub says about the pull request itself is wrong)
        self.queue_tick(self.FINE, clock=20_000_000)
        self.assertEqual(t["attention"], "GitHub's merge queue removed it: The merge commit's checks failed.")

    # #743: a base that requires an approving review: no merge tried, no Needs you; it merges once approved.
    def test_merge_after_checks_waits_calmly_for_an_approval(self):
        t = self.pr_task()
        t["auto_merge"] = "checks"
        waiting = dict(self.FINE, reviewDecision="REVIEW_REQUIRED")
        self.queue_tick(waiting)
        self.assertFalse(t.get("_pr_fresh"))
        self.assertNotIn("attention", t)
        self.assertEqual(self.agents.task_status(t, []), ("working", None, "Merges once it's approved"))
        calls, done, _ = self.gh_merges([waiting], [])
        self.assertEqual(self.commands.merge_now(self.store, t), self.commands.WAITS_APPROVAL)
        self.assertEqual((calls, done), ([], []))
        self.assertNotIn("attention", t)
        # approved: fresh again, and it merges as before
        self.queue_tick(dict(self.FINE, reviewDecision="APPROVED"))
        self.assertTrue(t.get("_pr_fresh"))
        self.assertNotIn("needs_approval", t["pr"])

    def test_accept_waiting_for_an_approval_merges_once_approved(self):
        t = self.pr_task()
        t["auto_merge"] = None
        calls, done, _ = self.gh_merges([dict(self.FINE, reviewDecision="REVIEW_REQUIRED")], [])
        self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t["auto_merge"], calls, done), ("ready", "checks", [], []))

    def test_a_branch_behind_under_an_up_to_date_rule_says_so(self):
        import herdr_task.github as github
        self.assertEqual(github.pr_problem(dict(self.FINE, mergeStateStatus="BEHIND")), github.BEHIND)
        t = self.pr_task()
        self.queue_tick(dict(self.FINE, mergeStateStatus="BEHIND"))
        self.assertEqual(t["attention"], github.BEHIND)
        self.queue_tick(dict(self.FINE, mergeStateStatus="CLEAN"), clock=20_000_000)
        self.assertNotIn("attention", t)

    # #781: a run that a newer run of the same check superseded (cancel-in-progress) never counts.
    def test_a_superseded_cancelled_run_is_not_failing(self):
        import herdr_task.github as github
        rollup = [{"__typename": "CheckRun", "name": "check", "workflowName": "Check", "status": "COMPLETED",
                   "conclusion": "CANCELLED", "startedAt": "2026-11-09T10:00:00Z"},
                  {"__typename": "CheckRun", "name": "check", "workflowName": "Check", "status": "COMPLETED",
                   "conclusion": "SUCCESS", "startedAt": "2026-11-09T10:00:05Z"},
                  {"__typename": "StatusContext", "context": "ci/other", "state": "SUCCESS", "startedAt": "2026-11-09T10:00:00Z"}]
        out = json.dumps(dict(self.FINE, statusCheckRollup=rollup))
        with self.mock.patch.object(github, "gh", lambda *a, **k: (True, out, "")):
            v = github.pr_view(self.pr_task())
        self.assertEqual([c.get("conclusion") or c.get("state") for c in v["statusCheckRollup"]], ["SUCCESS", "SUCCESS"])
        self.assertIsNone(github.pr_problem(v))
        # a cancelled run with no newer one still fails
        lone = [dict(rollup[0], name="lint")] + rollup[1:]
        self.assertEqual(github.pr_problem({"statusCheckRollup": github.latest_checks(lone)}), "Checks failing: lint.")

    # #802, #844: a merge GitHub reports never closes a task under its live agent, nor one reopened after it.
    def test_a_working_task_whose_pull_request_merged_stays_open_while_its_agent_is_there(self):
        t = self.pr_task()
        t["state"] = "running"
        self.live = [{"address": "t1", "status": {"state": "idle"}, "agent": "claude"}]
        merged = {"state": "MERGED", "mergeCommit": {"oid": "f00"}}
        self.queue_tick(merged)
        self.assertEqual((t["state"], t.get("merged")), ("running", None))
        self.live = []
        self.queue_tick(merged, clock=20_000_000)
        self.assertEqual((t["state"], t.get("merged")), ("done", True))

    def test_reopened_after_a_merge_it_stays_open_and_takes_status(self):
        t = self.pr_task()
        t.update(state="done", merged=True, started=1)
        self.commands.cmd_state(self.args(), "reopen")
        self.assertEqual((t["state"], t.get("kept_open")), ("running", True))
        self.queue_tick({"state": "MERGED", "mergeCommit": {"oid": "f00"}})
        self.assertEqual(t["state"], "running")
        self.commands.cmd_status(self.args(text="Releasing", done=50, left="10m"))
        self.assertEqual(t["progress"]["text"], "Releasing")

    # A pull request its agent opened itself (SHEP-13: "a pull request for branch ... already exists"):
    # ready and Accept adopt it, never fail on it.
    def github_has(self, prs):
        """GitHub with these open pull requests for the branch; opening another fails as gh does."""
        import herdr_task.github as github
        calls = []

        def fake(*a, **k):
            calls.append(a[:2])
            if a[:2] == ("pr", "list"):
                return True, json.dumps(prs), ""
            if a[:2] == ("pr", "create"):
                return False, "", "a pull request for branch \"b\" into branch \"main\" already exists"
            return True, "", ""
        for mod, name, value in ((github, "gh", fake), (github, "git", lambda *a: (True, "abc", ""))):
            p = self.mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        return github, calls

    def test_ready_adopts_the_open_pull_request(self):
        github, calls = self.github_has([{"number": 599, "url": "https://github.com/o/r/pull/599", "isCrossRepository": False, "baseRefName": "main", "headRefOid": "abc"}])
        t = self.ready(mode="worktree", worktree="/w", branch="b")
        self.assertEqual(github.pr_open(self.store, t, "o/r", "Done.")["number"], 599)
        self.assertEqual(t["pr"], {"number": 599, "url": "https://github.com/o/r/pull/599", "repo": "o/r"})
        self.assertNotIn(("pr", "create"), calls)
        self.assertIn(("pr", "comment"), calls)  # the summary still reaches it

    def test_ready_never_adopts_a_forks_or_another_ones(self):
        mine = {"number": 599, "url": "https://github.com/o/r/pull/599", "isCrossRepository": False, "baseRefName": "main", "headRefOid": "abc"}
        for other in ({"isCrossRepository": True}, {"baseRefName": "dev"}, {"headRefOid": "f00"}):
            github, calls = self.github_has([{**mine, **other}])
            t = self.ready(mode="worktree", worktree="/w", branch="b")
            with self.assertRaises(self.commands.Fail):
                github.pr_open(self.store, t, "o/r")
            self.assertNotIn("pr", t, other)

    def test_ready_never_opens_a_second_one_after_a_merged_one(self):
        # SHEP-59: the branch's pull request merged (squash), then more commits: no second one.
        import herdr_task.github as github
        calls = []

        def fake(*a, **k):
            calls.append(a[:2])
            if a[:2] == ("pr", "list"):
                state = a[a.index("--state") + 1]
                return True, json.dumps([] if state == "open" else [{"number": 704, "url": "u", "isCrossRepository": False,
                                                                     "baseRefName": "main", "headRefOid": "old"}]), ""
            return True, "", ""
        with self.mock.patch.object(github, "gh", fake), self.mock.patch.object(github, "git", lambda *a: (True, "abc", "")):
            t = self.ready(mode="worktree", worktree="/w", branch="b")
            with self.assertRaises(self.commands.Fail) as e:
                github.pr_open(self.store, t, "o/r")
        self.assertIn("#704", str(e.exception))
        self.assertNotIn(("pr", "create"), calls)

    def test_ready_opens_one_when_there_is_none(self):
        github, calls = self.github_has([])
        t = self.ready(mode="worktree", worktree="/w", branch="b")
        with self.assertRaises(self.commands.Fail):
            github.pr_open(self.store, t, "o/r")
        self.assertIn(("pr", "create"), calls)

    def test_accept_adopts_the_open_pull_request(self):
        self.github_has([{"number": 599, "url": "https://github.com/o/r/pull/599", "isCrossRepository": False, "baseRefName": "main", "headRefOid": "abc"}])
        t = self.ready(mode="worktree", worktree="/w", branch="b",
                       attention="Couldn't open a pull request: a pull request for branch \"b\" already exists")
        self.merging([{"state": "MERGED", "mergeCommit": {"oid": "f00"}}], [])
        with self.mock.patch.object(self.commands, "github", lambda s: "o/r"):
            self.commands.cmd_accept(self.args())
        self.assertEqual((t["state"], t["pr"]["number"]), ("done", 599))
        self.assertNotIn("attention", t)

    def test_the_tick_clears_a_failed_merge(self):
        t = self.pr_task()
        t["attention"], t["pr"]["checked"] = "GitHub didn't merge it: GraphQL: Something went wrong", 0
        fine = {"state": "OPEN", "mergeable": "MERGEABLE", "statusCheckRollup": [], "headRefOid": "abc"}
        with self.mock.patch.object(self.tick, "pr_view", lambda t: fine), self.mock.patch.object(self.tick, "pr_news", lambda *a: None):
            self.tick.facts(self.store, t, {"attention": [], "done": []})
        self.assertNotIn("attention", t)  # Ready, its Accept back


class OwnBackgroundWork(unittest.TestCase):
    """SHEP-53: an agent quiet with its own work still running (a background shell, a Monitor,
    Codex's background terminal), or whose fresh status line says it waits on CI or a review, is
    Working, not Needs you; asking the person, or quiet with nothing running, Needs you. Real logs
    in a temp folder; hc is never run."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.agents as agents
        self.agents, self.mock = agents, mock
        self.clock = 1_800_000_000_000
        p = mock.patch.object(agents, "now", lambda: self.clock)
        p.start()
        self.addCleanup(p.stop)
        self.hc = {}  # what hc ls --label herdr.task=<key> and hc get answer: {"ls": [...], "get": {address: record}}
        h = mock.patch.object(agents, "hc_json", lambda *a: ({"terminals": self.hc.get("ls", [])} if a[0] == "ls"
                                                               else self.hc.get("get", {}).get(a[1])))
        h.start()
        self.addCleanup(h.stop)
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "s.jsonl")
        self.lines = []
        self.task = {"id": 7, "title": "Fix", "state": "running", "started": self.clock - 3600_000,
                     "agents": [{"address": "t1", "at": self.clock - 3600_000, "log": self.log}]}
        self.idle = [{"address": "t1", "status": {"state": "idle"}, "labels": {"herdr.role": "worker"}}]
        self.stamp(-600_000, {"type": "user", "message": {"role": "user", "content": "Fix the bug"}})

    def stamp(self, ago, d):
        import datetime
        at = datetime.datetime.fromtimestamp((self.clock + ago) / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        self.lines.append(json.dumps(dict(d, timestamp=at)))
        with open(self.log, "w") as f:
            f.write("\n".join(self.lines) + "\n")
        self.agents._bg_cache.clear()

    def say(self, ago, text):
        self.stamp(ago, {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}})

    def background(self, ago, job="b1"):
        self.stamp(ago, {"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "gh run watch", "run_in_background": True}}]}})
        self.stamp(ago, {"type": "user", "toolUseResult": {"stdout": "", "backgroundTaskId": job}, "message": {"role": "user", "content": [
            {"tool_use_id": "toolu_1", "type": "tool_result", "content": f"Command running in background with ID: {job}. Output is being written to: /tmp/x"}]}})

    def finished(self, ago, job="b1"):
        self.stamp(ago, {"type": "queue-operation", "operation": "enqueue", "content":
                         f"<task-notification>\n<task-id>{job}</task-id>\n<status>completed</status>\n</task-notification>"})

    def status(self, live=None):
        return self.agents.task_status(self.task, self.idle if live is None else live)

    def test_idle_with_a_background_shell_is_working(self):
        self.background(-300_000)
        self.say(-200_000, "Review is running in the background; I'll pick it up when it ends.")
        self.assertEqual(self.status(), ("working", None, None))
        # a Monitor counts the same
        self.lines[:] = self.lines[:1]
        self.stamp(-300_000, {"type": "user", "toolUseResult": {"taskId": "m1", "timeoutMs": 900000, "persistent": False},
                              "message": {"role": "user", "content": [{"tool_use_id": "toolu_2", "type": "tool_result",
                                                                       "content": "Monitor started (task m1, expires in 15m)"}]}})
        self.assertEqual(self.status(), ("working", None, None))

    def test_a_plain_question_needs_you_once_nothing_runs(self):
        """SHEP-148: a plain question with its own work still running is no ask yet (asking for real
        is its question tool or a permission: blocked); once nothing runs, it is."""
        self.background(-300_000)
        self.say(-200_000, "Tests run in the background. Should I also update the docs?")
        self.assertEqual(self.status(), ("working", None, None))
        # asking with its question tool or a permission: blocked, Needs you at once
        self.assertEqual(self.status([dict(self.idle[0], status={"state": "blocked"})])[:2], ("needs", "asks"))
        # its shell ended: the question is the person's now
        self.finished(-100_000)
        self.assertEqual(self.status()[:2], ("needs", "reply"))

    def test_idle_with_nothing_running_needs_you(self):
        self.say(-200_000, "Done with the first part.")
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        # its background job ended and it went quiet again: Needs you as before
        self.background(-300_000)
        self.finished(-100_000)
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        # a job started hours ago and never told ended no longer counts
        self.lines[:] = self.lines[:1]
        self.background(-4 * 3600_000)
        self.assertEqual(self.status()[:2], ("needs", "reply"))

    def test_its_status_line_says_it_waits_on_ci_or_review(self):
        self.say(-200_000, "Pushed.")
        for text, want in (("Waiting on review round 1", "working"), ("Rebased, waiting on GitHub check", "working"),
                           ("Codex reviewing the change", "working"), ("Waiting for your go on the merge", "needs"),
                           ("Fixed the menu", "needs")):
            self.task["progress"] = {"text": text, "set": self.clock - 120_000, "at": self.clock - 120_000}
            self.assertEqual(self.status()[0], want, text)
        # stale (over 30 minutes), set before its turn began, or said by Herdr: no longer counts
        self.task["progress"] = {"text": "Waiting on the GitHub check", "set": self.clock - 40 * 60_000}
        self.assertEqual(self.status()[0], "needs")
        self.task["progress"] = {"text": "Waiting on the GitHub check", "set": self.clock - 700_000}
        self.assertEqual(self.status()[0], "needs")
        self.task["progress"] = {"text": "Waiting on the GitHub check", "set": self.clock - 120_000, "by": "herdr"}
        self.assertEqual(self.status()[0], "needs")
        # a background job of its ended after it said so: it's back, then quiet
        self.task["progress"] = {"text": "Waiting on the GitHub check", "set": self.clock - 120_000}
        self.background(-110_000)
        self.finished(-60_000)
        self.assertEqual(self.status()[0], "needs")

    def test_codex_background_terminal(self):
        self.stamp(-300_000, {"type": "response_item", "payload": {"type": "function_call", "call_id": "c1", "name": "exec_command",
                                                                   "arguments": json.dumps({"cmd": "gh run watch", "yield_time_ms": 1000})}})
        self.stamp(-300_000, {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1",
                                                                   "output": "Process running with session ID 42"}})
        self.assertEqual(self.status(), ("working", None, None))
        self.stamp(-100_000, {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "c2", "output": [
            {"type": "input_text", "text": json.dumps({"chunk_id": "a", "session_id": 42, "exit_code": 0, "output": ""})}]}})
        self.assertEqual(self.status()[:2], ("needs", "reply"))

    def test_the_tasks_panel_gets_it(self):
        """view() marks it (own_work), which news_pass keeps on the task for core/tasks.js place()."""
        import herdr_task.output as output
        self.background(-300_000)

        class S:
            write, loc, prefix = False, {"folder": "/f"}, "X"
            key = ref = lambda self, t: "X-7"
        with self.mock.patch.object(output, "waiting_for", lambda s, t: []), self.mock.patch.object(output, "waiting_ext", lambda t: []):
            v = output.view(S(), self.task, [dict(k, foreground={"name": "claude"}) for k in self.idle])
        self.assertEqual((v["status"], v["own_work"]), ("working", True))


class NoFalseNeedsYou(unittest.TestCase):
    """SHEP-133: no Needs you for a few seconds that moves on by itself. A quiet agent or a problem
    Herdr found needs the person only after a grace (GRACE_MS); asking needs them at once; Herdr's
    own "Working again" is never the reason; a background job started before megabytes of
    screenshots still counts. Real logs in a temp folder; hc is never run."""

    setUp = OwnBackgroundWork.setUp
    stamp, say, background, finished, status = (OwnBackgroundWork.stamp, OwnBackgroundWork.say, OwnBackgroundWork.background,
                                                OwnBackgroundWork.finished, OwnBackgroundWork.status)

    def test_the_rule_is_cores(self):
        """The cases core/tasks.test.js checks place() on (core/grace.cases.json)."""
        with open(os.path.join(ROOT, "core", "grace.cases.json")) as f:
            g = json.load(f)
        self.assertEqual(self.agents.GRACE_MS, 20_000)
        agent = lambda a: {"address": a["address"], "status": {"state": a["status"]}, "turn": a["turn"],
                           "labels": {"herdr.role": a["role"]}, **({"status_ms": a["since"]} if "since" in a else {})}
        with self.mock.patch.object(self.agents, "now", lambda: g["now"]), \
                self.mock.patch.object(self.agents, "held_ask", lambda address: None):
            for i, c in enumerate(g["cases"]):
                task = dict(c["task"], id=7)
                if "log" in c:
                    # SHEP-148: an agent's real state, its session log written as Claude Code writes it
                    log = os.path.join(self.dir, f"case{i}.jsonl")
                    with open(log, "w") as f:
                        f.write("".join(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n" for d in c["log"]))
                    task["agents"] = [dict(a, log=log) for a in task["agents"]]
                live = [agent(a) for a in c["live"]]
                got = self.agents.task_status(task, live)
                self.assertEqual(got[:2], (c["expect"]["status"], c["expect"]["needs"]), c["name"])
                # core reads task.own_work: what herdr-task's scheduler keeps from that same log
                if "own_work" in c["task"]:
                    self.assertEqual(self.agents.own_work(task, live, ready=task["state"] == "ready"), c["task"]["own_work"], c["name"])

    def test_a_quiet_agent_needs_you_once_the_grace_is_over(self):
        self.say(-3_000, "Done with the first part.")
        quiet = lambda ago, st="idle": [dict(self.idle[0], status={"state": st}, status_ms=self.clock - ago)]
        self.assertEqual(self.status(quiet(3_000)), ("working", None, None))
        self.assertEqual(self.status(quiet(19_000)), ("working", None, None))
        self.assertEqual(self.status(quiet(21_000))[:2], ("needs", "reply"))
        # a question or a permission: at once
        self.assertEqual(self.status(quiet(1_000, "blocked"))[:2], ("needs", "asks"))

    def test_herdrs_own_words_are_never_its_reason(self):
        """SHEP-126 read "Needs you · Working again": a background job's notice woke it while Ready
        (back_to_work() set Herdr's line), it said it was still ready and went quiet."""
        self.say(-60_000, "That was an old file search finishing. Nothing changes: the task is still ready.")
        self.task["progress"] = {"text": "Working again", "at": self.clock - 70_000, "set": self.clock - 70_000, "by": "herdr"}
        self.assertIsNone(self.agents.own_line(self.task))
        self.assertEqual(self.agents.last_words(self.task), "Nothing changes: the task is still…")
        # its own line said this turn still is the reason
        self.task["progress"] = {"text": "Waiting for your go on the menu", "at": self.clock - 50_000, "set": self.clock - 50_000}
        self.assertEqual(self.agents.own_line(self.task), "Waiting for your go on the menu")

    def test_a_job_before_megabytes_of_screenshots_still_counts(self):
        """HOME-1 read Needs you while its Monitor ran: 4.5 MB of image results after the Monitor's
        start pushed it out of the 1 MB the log's end was read for."""
        self.background(-300_000)
        image = {"type": "image", "source": {"type": "base64", "data": "A" * 700_000}}
        for i in range(4):
            self.stamp(-200_000 + i, {"type": "user", "message": {"role": "user", "content": [
                {"tool_use_id": f"toolu_r{i}", "type": "tool_result", "content": [image]}]}})
        self.say(-100_000, "Four look clean. Waiting for the rest.")
        self.assertGreater(os.path.getsize(self.log), 2_500_000)
        self.assertEqual(self.status(), ("working", None, None))
        # it ends: quiet with nothing left, Needs you
        self.finished(-50_000)
        self.assertEqual(self.status()[:2], ("needs", "reply"))

    def test_a_long_command_in_the_foreground_is_work(self):
        """HOME-1 read Needs you twice mid-turn: a 50 s and a 110 s Bash running in the foreground,
        Claude Code read idle meanwhile. Its log has the call open: Working. A permission for it
        held, Needs you; done, or open past FG_MAX_MS, quiet as before."""
        held = {}
        p = self.mock.patch.object(self.agents, "held_ask", lambda address: held.get(address))
        p.start()
        self.addCleanup(p.stop)
        self.say(-60_000, "Passes. Finishing all 10, then the gallery.")
        # Claude Code's own compact lines, as its log writes them
        self.lines.append('{"parentUuid":"a","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use",'
                          '"id":"toolu_9","name":"Bash","input":{"command":"./finish.sh"}}]},"type":"assistant","timestamp":"%s"}'
                          % self.iso(-50_000))
        self.write()
        self.assertEqual(self.status(), ("working", None, None))
        self.assertEqual(self.agents.open_tool(self.log)[0], "Bash")
        held["t1"] = {"tool_name": "Bash", "tool_input": {"command": "./finish.sh"}}
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        held.clear()
        # its result in: quiet, Needs you
        self.lines.append('{"parentUuid":"b","isSidechain":false,"type":"user","message":{"role":"user","content":[{"tool_use_id":'
                          '"toolu_9","type":"tool_result","content":"done"}]},"timestamp":"%s"}' % self.iso(-10_000))
        self.write()
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        # a subagent's call (its side chain) or a question tool is no work of its own; one open 15 minutes, none
        for line in ('{"isSidechain":true,"message":{"content":[{"type":"tool_use","id":"toolu_a","name":"Bash"}]},"type":"assistant","timestamp":"%s"}' % self.iso(-5_000),
                     '{"isSidechain":false,"message":{"content":[{"type":"tool_use","id":"toolu_b","name":"AskUserQuestion"}]},"type":"assistant","timestamp":"%s"}' % self.iso(-5_000),
                     '{"isSidechain":false,"message":{"content":[{"type":"tool_use","id":"toolu_c","name":"Bash"}]},"type":"assistant","timestamp":"%s"}' % self.iso(-16 * 60_000)):
            self.lines.append(line)
            self.write()
            self.assertEqual(self.status()[:2], ("needs", "reply"), line)
            self.lines.pop()

    def iso(self, ago):
        import datetime
        return datetime.datetime.fromtimestamp((self.clock + ago) / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    def write(self):
        with open(self.log, "w") as f:
            f.write("\n".join(self.lines) + "\n")
        self.agents._bg_cache.clear()

    def test_the_log_is_read_as_it_grows(self):
        self.background(-300_000)
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["b1"])
        line = json.dumps({"type": "queue-operation", "operation": "enqueue", "timestamp": "2027-01-15T08:00:00Z",
                           "content": "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>"})
        # half a line still being written: not read yet
        with open(self.log, "a") as f:
            f.write(line[:40])
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["b1"])
        with open(self.log, "a") as f:
            f.write(line[40:] + "\n")
        jobs, ended = self.agents.background_jobs(self.log)
        self.assertEqual((jobs, bool(ended)), ({}, True))
        # a new log in its place (same name): read afresh
        os.remove(self.log)
        with open(self.log, "w") as f:
            f.write("\n".join(self.lines) + "\n")
        self.assertEqual(list(self.agents.background_jobs(self.log)[0]), ["b1"])


class WorkersOwnHelpers(OwnBackgroundWork):
    """SHEP-54: a worker runs its review as an hc child (herdr.task, herdr.role=reviewer, its
    terminal the parent). Never one of the task's agents (no second worker, nothing it says counts as
    the task's status); while it works, its quiet worker is Working; the Tasks panel lists it."""

    def setUp(self):
        super().setUp()
        self.idle = [dict(self.idle[0], labels={"herdr.task": "x#7"})]
        # idle here (SHEP-53's cases, inherited, hold with it), working in each case below
        self.reviewer = {"address": "t2", "parent": "t1", "state": "live", "status": "idle", "agent": "codex",
                         "labels": {"herdr.task": "x#7", "herdr.role": "reviewer", "herdr.agent": "codex"}, "created_ms": 5}
        self.worker = {"address": "t1", "state": "live", "status": "idle", "labels": {"herdr.task": "x#7"}}
        self.hc = {"ls": [self.worker, self.reviewer], "get": {"t2": self.reviewer}}

    def test_never_one_of_the_tasks_agents(self):
        self.reviewer["status"] = "working"
        self.assertEqual([k["address"] for k in self.agents.live_agents("x#7")], ["t1"])
        self.assertEqual([k["address"] for k in self.agents.live_helpers("x#7")], ["t2"])
        # hc ls gives no labels: its parent, the task's own terminal, says so
        self.hc["ls"] = [self.worker, dict(self.reviewer, labels={})]
        self.assertEqual([k["address"] for k in self.agents.live_agents("x#7")], ["t1"])
        self.assertEqual([k["address"] for k in self.agents.live_helpers("x#7")], ["t2"])
        # another machine's: its parent named there
        self.hc["ls"] = [dict(self.worker, address="vm/t1"), dict(self.reviewer, address="vm/t2", labels={})]
        self.assertEqual([k["address"] for k in self.agents.live_helpers("x#7")], ["vm/t2"])
        # one with no parent (an old herdr-task reviewer) stays the task's
        self.hc["ls"] = [self.worker, dict(self.reviewer, parent=None)]
        self.assertEqual([k["address"] for k in self.agents.live_agents("x#7")], ["t1", "t2"])

    def test_its_quiet_worker_is_working_while_it_reviews(self):
        self.reviewer["status"] = "working"
        self.say(-200_000, "Codex reviews it now.")
        self.assertEqual(self.status(), ("working", None, None))
        # a plain question while its reviewer still works: no ask yet (SHEP-148), Working
        self.say(-100_000, "Should I also update the docs?")
        self.assertEqual(self.status(), ("working", None, None))
        # the review over: quiet again
        self.lines[:] = self.lines[:1]
        self.say(-100_000, "Done.")
        self.reviewer["status"] = "idle"
        self.assertEqual(self.status()[:2], ("needs", "reply"))
        # another worker's child doesn't count
        self.reviewer.update(status="working", parent="t9")
        self.assertEqual(self.status()[:2], ("needs", "reply"))

    def test_the_tasks_panel_lists_it(self):
        import herdr_task.output as output
        self.reviewer["status"] = "working"

        class S:
            write, loc, prefix = False, {"folder": "/f"}, "X"
            key = lambda self, t: "x#7"
            ref = lambda self, t: "X-7"
        with self.mock.patch.object(output, "waiting_for", lambda s, t: []), self.mock.patch.object(output, "waiting_ext", lambda t: []), \
                self.mock.patch.object(output, "detail", lambda k: self.hc["get"].get(k["address"], k)):
            v = output.view(S(), self.task, [dict(k, foreground={"name": "claude"}) for k in self.idle])
        self.assertEqual(v["status"], "working")
        self.assertEqual(v["subagents"], [{"address": "t2", "parent": "t1", "role": "reviewer", "agent": "codex", "name": None,
                                           "status": "working", "at": 5}])
        self.assertEqual([x["role"] for x in v["live"]], ["worker"])


class DoneWorktreesGo(unittest.TestCase):
    """SHEP-161: a Done task whose agent was still open when it finished keeps its worktree only until
    its agents are gone; leftovers from before go on the next pass. Never with uncommitted work, never
    a folder a terminal is live in. A throwaway git repo; hc is never run."""

    def setUp(self):
        from unittest import mock
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.github as github
        import herdr_task.tick as tick
        self.github, self.tick = github, tick
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.main, wt = os.path.join(self.root, "repo"), os.path.join(self.root, "wt")
        self.git(self.root, "init", "-q", "-b", "main", self.main)
        for k, v in (("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
            self.git(self.main, "config", k, v)
        self.git(self.main, "commit", "-q", "--allow-empty", "-m", "base")
        self.git(self.main, "worktree", "add", "-q", "-b", "task/1", wt, "HEAD")
        self.git(wt, "commit", "-q", "--allow-empty", "-m", "reactions")
        self.git(self.main, "merge", "-q", "--ff-only", "task/1")
        self.live, self.others = [], []  # the task's live terminals; every live terminal (hc ls)
        self.store = Store([{"id": 1, "title": "Reactions", "state": "running", "mode": "worktree", "worktree": wt,
                             "branch": "task/1", "base": "main", "merged": True, "agents": []}])
        self.store.loc["folder"] = self.main
        self.task = self.store.data["tasks"][0]
        live = lambda key: list(self.live)
        for mod, name, value in ((github, "live_agents", live), (github, "live_helpers", lambda key: []),
                                 (github, "hc_json", lambda *a: {"terminals": self.live + self.others}),
                                 (tick, "live_agents", live), (tick, "detail", lambda k: k),
                                 (tick, "refresh_sessions", lambda *a: None), (tick, "quiet_hc", self.end),
                                 (tick, "store_files", lambda folder=None: ["/f.json"]),
                                 (tick, "read_list", lambda p: {"folder": self.main, "tasks": self.store.data["tasks"]}),
                                 (tick, "locate", lambda f: self.store.loc), (tick, "Store", lambda loc: self.store),
                                 (tick.time, "sleep", lambda n: None)):
            p = mock.patch.object(mod, name, value, create=True)  # create: the test runs on the code before too
            p.start()
            self.addCleanup(p.stop)

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, check=True).stdout.strip()

    def end(self, verb, k):
        self.live = [x for x in self.live if x is not k]
        return subprocess.CompletedProcess([], 0)

    def agent_open(self):
        self.live = [{"address": "t1", "state": "live", "agent": "claude", "status": "idle", "cwd": self.task["worktree"],
                      "labels": {"herdr.role": "worker"}}]

    def later(self, ms):
        for k in ("done_at", "ended_at", "worktree_kept"):
            if self.task.get(k):
                self.task[k] -= ms

    def pass_(self):
        report = {}
        self.tick.end_done_pass(report)
        return report

    def test_its_worktree_goes_once_its_agent_ended(self):
        self.agent_open()
        self.github.finish(self.store, self.task)
        self.assertTrue(os.path.isdir(self.task["worktree"]))  # its agent still open: kept for now
        self.later(self.tick.DONE_GRACE_MS + 1000)
        self.pass_()                                             # the agent ends
        self.assertEqual(self.live, [])
        report = self.pass_()                                    # nothing left of it: its worktree goes
        self.assertFalse(os.path.isdir(self.task["worktree"]))
        self.assertEqual(self.git(self.main, "branch", "--list", "task/1"), "")
        self.assertEqual(report["worktrees_removed"], [{"task": "SHEP-1", "path": self.task["worktree"]}])
        self.assertEqual(self.pass_(), {})                       # then never looked at again

    def test_a_leftover_from_before_goes_on_the_next_pass(self):
        self.task.update(state="done", done_at=1000, ended_at=2000)
        self.pass_()
        self.assertFalse(os.path.isdir(self.task["worktree"]))

    def test_uncommitted_work_keeps_it(self):
        self.task.update(state="done", done_at=1000, ended_at=2000)
        with open(os.path.join(self.task["worktree"], "a.txt"), "w") as f:
            f.write("x")
        self.git(self.task["worktree"], "add", "a.txt")
        self.pass_()
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        self.assertIn("worktree_kept", self.task)
        self.git(self.task["worktree"], "reset", "-q", "--hard")
        self.pass_()                                             # not looked at again at once
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        self.later(3600000)  # TIDY_AGAIN_MS
        self.pass_()                                             # clean since: it goes
        self.assertFalse(os.path.isdir(self.task["worktree"]))

    def test_new_commits_after_the_merge_keep_it(self):
        self.task.update(state="done", done_at=1000, ended_at=2000)
        self.git(self.task["worktree"], "commit", "-q", "--allow-empty", "-m", "after the merge")
        self.pass_()
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        self.assertEqual(self.git(self.main, "branch", "--list", "--format=%(refname:short)", "task/1"), "task/1")

    def test_a_terminal_in_it_keeps_it(self):
        self.task.update(state="done", done_at=1000, ended_at=2000)
        self.others = [{"address": "t9", "state": "live", "cwd": os.path.join(self.task["worktree"], "web")}]
        self.pass_()
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        self.others = [{"address": "t9", "state": "live", "cwd": self.task["worktree"] + "-other"}]
        self.later(3600000)  # TIDY_AGAIN_MS
        self.pass_()
        self.assertFalse(os.path.isdir(self.task["worktree"]))

    def test_done_by_hand_unmerged_keeps_it(self):
        self.git(self.main, "reset", "-q", "--hard", "HEAD~1")  # its work never merged
        self.task.update(state="done", done_at=1000, ended_at=2000, merged=False)
        self.pass_()
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        self.assertEqual(self.git(self.main, "branch", "--list", "--format=%(refname:short)", "task/1"), "task/1")

    def auto_merge(self, status):
        """The tick's auto-merge of a Ready task whose pull request GitHub merged: merge_now() with its
        agent at the given status (SHEP-188). Nothing but GitHub and git is stubbed."""
        from unittest import mock
        import herdr_task.commands as commands
        wt = self.task["worktree"]
        self.live = [{"address": "t1", "state": "live", "agent": "claude", "status": status, "cwd": wt,
                      "labels": {"herdr.role": "worker"}}]
        self.task.update(state="ready", merged=False, auto_merge="checks", pr={"number": 5, "repo": "o/r"})
        merged = {"state": "MERGED", "mergeCommit": {"oid": "f00"}}
        for name, value in (("pr_view", lambda t: merged), ("note_checks", lambda s, t, v: None),
                            ("watch_main", lambda *a: None), ("update_main", lambda *a: None)):
            p = mock.patch.object(commands, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.assertIsNone(commands.merge_now(self.store, self.task))
        self.assertEqual(self.task["state"], "done")
        return os.path.isdir(wt)

    def test_an_auto_merge_keeps_the_folder_while_its_agent_is_mid_turn(self):
        self.assertTrue(self.auto_merge("working"))              # its turn after ready: not pulled out
        self.live = []                                           # its agent ended (end_done after the grace)
        self.later(self.tick.DONE_GRACE_MS + 1000)
        self.pass_()
        self.assertFalse(os.path.isdir(self.task["worktree"]))   # then its worktree goes

    def test_an_auto_merge_while_its_agent_asks_keeps_the_folder(self):
        self.assertTrue(self.auto_merge("blocked"))

    def test_an_auto_merge_with_its_agent_idle_still_removes_the_folder(self):
        self.assertFalse(self.auto_merge("idle"))                # as before: nothing mid-turn, gone at once


class NewWorktrees(unittest.TestCase):
    """SHEP-74: a new task's worktree starts from its base fetched first (#574), on its own branch
    name or its folder's Branch names pattern (#570). Throwaway repos (a bare origin and a clone)
    and a throwaway settings file; hc and gh are never run."""

    def setUp(self):
        from unittest import mock
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.launch as launch
        import herdr_task.settings as settings
        from herdr_task.base import Fail
        self.launch, self.settings, self.Fail = launch, settings, Fail
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.origin, self.main, self.other = (os.path.join(self.root, x) for x in ("origin.git", "repo", "other"))
        self.git(self.root, "init", "-q", "--bare", "-b", "main", self.origin)
        self.git(self.root, "clone", "-q", self.origin, self.main)
        self.commit(self.main, "first")
        self.git(self.main, "push", "-q", "origin", "main")
        self.git(self.root, "clone", "-q", self.origin, self.other)
        self.settings_file = os.path.join(self.root, "shepherdr.json")
        for mod, name, value in ((launch, "WORKTREES", os.path.join(self.root, "wt")), (settings, "SETTINGS", self.settings_file)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.store = Store([])
        self.store.loc["folder"] = self.main

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, cwd, words):
        self.git(cwd, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
                 "commit", "-q", "--allow-empty", "-m", words)
        return self.git(cwd, "rev-parse", "HEAD")

    def task(self, title="Check base", **kw):
        t = {"id": len(self.store.data["tasks"]) + 1, "title": title, "mode": "worktree", "state": "todo", **kw}
        self.store.data["tasks"].append(t)
        return t

    def new_worktree(self, t=None):
        t = t or self.task()
        return t, self.launch.folder_for(self.store, t)

    def test_starts_from_the_remote_base_when_the_folder_is_behind(self):
        theirs = self.commit(self.other, "merged on GitHub")
        self.git(self.other, "push", "-q", "origin", "main")
        before = self.git(self.main, "rev-parse", "main")
        t, path = self.new_worktree()
        self.assertEqual(self.git(path, "rev-parse", "HEAD"), theirs)
        self.assertEqual(t["start"], theirs)
        self.assertEqual(t["base"], "main")
        self.assertEqual(self.git(self.main, "rev-parse", "main"), before)  # the folder's own checkout stays as it was
        # no upstream: the task's branch never tracks origin/main
        self.assertEqual(subprocess.run(["git", "-C", path, "rev-parse", "--abbrev-ref", "@{u}"], capture_output=True).returncode, 128)

    def test_keeps_the_local_base_when_it_has_work_of_its_own(self):
        mine = self.commit(self.main, "merged here, not pushed")
        _, path = self.new_worktree()
        self.assertEqual(self.git(path, "rev-parse", "HEAD"), mine)

    def test_offline_starts_from_the_local_base(self):
        self.git(self.main, "remote", "set-url", "origin", os.path.join(self.root, "gone.git"))
        here = self.git(self.main, "rev-parse", "main")
        _, path = self.new_worktree()
        self.assertEqual(self.git(path, "rev-parse", "HEAD"), here)

    def test_default_branch_name_stays(self):
        t, _ = self.new_worktree(self.task("Fix the login page"))
        self.assertEqual(t["branch"], "task/1-fix-the-login-page")

    def write_settings(self, d):
        with open(self.settings_file, "w") as f:
            json.dump(d, f)

    def test_the_folders_pattern(self):
        self.write_settings({"everywhere": {"tasks": {"branch": "feat/{key}-{slug}"}},
                             "spaces": {"sp1": {"folder": self.main, "tasks": {"branch": "{key}"}}}})
        t, path = self.new_worktree(self.task("Fix login"))
        self.assertEqual(t["branch"], "SHEP-1")
        self.assertEqual(self.git(path, "rev-parse", "--abbrev-ref", "HEAD"), "SHEP-1")
        self.write_settings({"everywhere": {"tasks": {"branch": "feat/{key}-{slug}"}}})
        self.assertEqual(self.new_worktree(self.task("Fix login"))[0]["branch"], "feat/SHEP-2-fix-login")
        # one that can't be used (no {n} or {key}: every task would share it) falls back to the default
        self.write_settings({"everywhere": {"tasks": {"branch": "feat/{slug}"}}})
        self.assertEqual(self.new_worktree(self.task("Fix login"))[0]["branch"], "task/3-fix-login")

    def test_pattern_problems(self):
        problem = self.settings.branch_pattern_problem
        for ok in ("", "task/{n}-{slug}", "{key}", "users/me/{key}-{slug}"):
            self.assertIsNone(problem(ok), ok)
        for bad in ("feat/{slug}", "x/{n}/{bad}", "{n} x", "-{n}", "a..{n}", "{key}.lock"):
            self.assertIsNotNone(problem(bad), bad)

    def test_an_exact_branch(self):
        t = self.task("Fix login")
        self.launch.set_branch(self.store, t, "ABC-2137")
        _, path = self.new_worktree(t)
        self.assertEqual(t["branch"], "ABC-2137")
        self.assertEqual(self.git(path, "rev-parse", "--abbrev-ref", "HEAD"), "ABC-2137")
        self.assertTrue(path.endswith("/ABC-2137"))
        self.launch.set_branch(self.store, t, "ABC-2137")  # the same again: nothing to do
        with self.assertRaisesRegex(self.Fail, "can't change now"):
            self.launch.set_branch(self.store, t, "ABC-1")

    def test_an_exact_branch_is_refused_when_taken_or_invalid(self):
        set_branch, t = self.launch.set_branch, self.task()
        for bad in ("two words", "a..b", "-x", "x.lock"):
            with self.assertRaisesRegex(self.Fail, "isn't a valid branch name"):
                set_branch(self.store, t, bad)
        self.git(self.main, "branch", "here-already")
        with self.assertRaisesRegex(self.Fail, "already here"):
            set_branch(self.store, t, "here-already")
        self.git(self.other, "push", "-q", "origin", "HEAD:refs/heads/ABC-1")  # pushed by someone else, never fetched here
        with self.assertRaisesRegex(self.Fail, "origin already has"):
            set_branch(self.store, t, "ABC-1")
        set_branch(self.store, self.task(), "ABC-2")
        with self.assertRaisesRegex(self.Fail, "SHEP-2 already uses it"):
            set_branch(self.store, t, "ABC-2")
        self.assertNotIn("branch", t)
        set_branch(self.store, t, "ABC-3")
        set_branch(self.store, t, "")  # back to the pattern
        self.assertNotIn("branch", t)
        with self.assertRaisesRegex(self.Fail, "in a worktree"):
            set_branch(self.store, self.task(mode="here"), "ABC-4")


class MergedOnlyWithOwnWork(unittest.TestCase):
    """SHEP-23: a task counts as merged only when work of its own landed (its pull request merged, or
    commits made on its branch now in the base), never when its branch just caught up with main, and
    never while its agent is mid-turn. A throwaway git repo; hc and gh are never run."""

    def setUp(self):
        from unittest import mock
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        import herdr_task.tick as tick
        self.commands, self.tick = commands, tick
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.main, wt = os.path.join(self.root, "repo"), os.path.join(self.root, "wt")
        self.git(self.root, "init", "-q", "-b", "main", self.main)
        for k, v in (("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
            self.git(self.main, "config", k, v)
        self.commit(self.main, "base")
        self.git(self.main, "worktree", "add", "-q", "-b", "task/1", wt, "HEAD")
        self.live = []  # the task's agents now (hc records)
        self.store = Store([{"id": 1, "title": "Reactions", "state": "running", "mode": "worktree", "worktree": wt,
                             "branch": "task/1", "base": "main", "start": self.git(wt, "rev-parse", "HEAD"), "agents": []}])
        self.store.loc["folder"] = self.main
        self.task = self.store.data["tasks"][0]
        done = lambda s, t, even_if_busy=False: t.update(state="done")
        for mod, name, value in ((tick, "live_agents", lambda key: self.live), (tick, "finish", done),
                                 (tick, "watch_main", lambda *a: None), (commands, "finish", done),
                                 (commands, "open_store", lambda args, write=True: self.store),
                                 (commands, "view", lambda s, t, live=None: dict(t)), (commands, "say", lambda *a: None),
                                 (commands, "live_agents", lambda key: self.live), (commands, "detail", lambda k: k)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, cwd, words):
        self.git(cwd, "commit", "-q", "--allow-empty", "-m", words)
        return self.git(cwd, "rev-parse", "HEAD")

    def tick_once(self):
        self.tick.facts(self.store, self.task, {"attention": [], "done": []})
        return self.task["state"], bool(self.task.get("merged"))

    def working(self):
        self.live = [{"address": "t1", "status": {"state": "working"}}]

    def test_a_fresh_branch_is_not_merged(self):
        self.assertEqual(self.tick_once(), ("running", False))

    def test_a_branch_caught_up_with_main_is_not_merged(self):
        self.commit(self.main, "another task merged")
        self.git(self.task["worktree"], "merge", "-q", "--ff-only", "main")  # SHEP-17's agent
        self.assertEqual(self.tick_once(), ("running", False))
        self.assertNotIn("own", self.task)
        # Accepted so: done, nothing to merge, never "merged".
        self.task["state"] = "ready"
        import argparse
        self.commands.cmd_accept(argparse.Namespace(id="SHEP-1", json=True, folder=None))
        self.assertEqual(self.task["state"], "done")
        self.assertFalse(self.task.get("merged"))

    def test_a_branch_caught_up_with_origin_main_is_not_merged(self):
        self.git(self.main, "update-ref", "refs/remotes/origin/main", self.commit(self.main, "on GitHub"))
        self.git(self.main, "reset", "-q", "--hard", "HEAD~1")  # local main behind its remote
        self.git(self.task["worktree"], "merge", "-q", "--ff-only", "origin/main")
        self.assertEqual(self.tick_once(), ("running", False))
        self.git(self.main, "merge", "-q", "--ff-only", "origin/main")  # main pulled
        self.assertEqual(self.tick_once(), ("running", False))

    def test_its_commits_merged_by_hand_make_it_done(self):
        own = self.commit(self.task["worktree"], "reactions on the left")
        self.assertEqual(self.tick_once(), ("running", False))
        self.assertEqual(self.task["own"], own)
        self.git(self.main, "merge", "-q", "--ff-only", "task/1")
        self.working()
        self.assertEqual(self.tick_once(), ("running", False))  # never under a working agent
        self.live = []
        self.assertEqual(self.tick_once(), ("done", True))

    def test_its_merged_pull_request_makes_it_done(self):
        self.commit(self.task["worktree"], "reactions on the left")
        self.task.update(state="ready", pr={"number": 610, "repo": "o/r", "checked": 0})
        with self.mock_pr({"state": "MERGED", "mergeCommit": {"oid": "f00"}}):
            self.working()
            self.assertEqual(self.tick_once(), ("ready", False))
            self.live, self.task["pr"]["checked"] = [], 0
            self.assertEqual(self.tick_once(), ("done", True))

    def mock_pr(self, v):
        from unittest import mock
        return mock.patch.object(self.tick, "pr_view", lambda t: v)

    # SHEP-59: a pull request squash-merged (its commits never in main), then ready: done, never a
    # second pull request; nor when its work is in main some other way (nothing left to merge).
    def change(self, cwd, words):
        with open(os.path.join(cwd, "reactions.txt"), "w") as f:
            f.write(words)
        self.git(cwd, "add", "reactions.txt")
        return self.commit(cwd, words)

    def squash_into_main(self):
        self.git(self.main, "merge", "-q", "--squash", "task/1")
        return self.commit(self.main, "SHEP-1 Reactions (#704)")

    def github(self, merged):
        """GitHub for o/r with these merged pull requests for the branch (none open); the gh calls."""
        from unittest import mock
        import herdr_task.github as github
        calls = []

        def fake(*a, **k):
            calls.append(a[:2])
            if a[:2] == ("pr", "list"):
                return True, json.dumps(merged if a[a.index("--state") + 1] == "merged" else []), ""
            if a[:2] == ("pr", "create"):
                return True, "https://github.com/o/r/pull/705", ""
            return True, "", ""
        for mod, name, value in ((github, "gh", fake), (github, "github", lambda s: "o/r"), (self.commands, "github", lambda s: "o/r"),
                                 (github, "watch_main", lambda *a: None), (self.commands, "watch_main", lambda *a: None),
                                 (self.tick, "github", lambda s: "o/r")):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)
        return calls

    def ready_now(self):
        import argparse
        from unittest import mock
        with mock.patch.object(self.commands, "review_refusal", lambda *a: None), \
                mock.patch.object(self.commands, "find_proof", lambda *a: None), \
                mock.patch.object(self.commands, "task_settings", lambda *a: []), \
                mock.patch.object(self.commands, "ready_turns", lambda *a: {}), \
                mock.patch.object(self.commands, "pr_open", lambda *a: (_ for _ in ()).throw(AssertionError("a pull request opened"))):
            self.commands.cmd_ready(argparse.Namespace(id="SHEP-1", json=True, folder=None, summary="Done.", details=None,
                                                       proof=None, agents_md=None))
        return self.task["state"], bool(self.task.get("merged"))

    def test_ready_after_its_pull_request_squash_merged_is_done(self):
        tip = self.change(self.task["worktree"], "reactions on the left")
        self.squash_into_main()
        self.commit(self.main, "another task merged after it")
        calls = self.github([{"number": 704, "url": "https://github.com/o/r/pull/704", "isCrossRepository": False,
                              "baseRefName": "main", "headRefOid": tip, "mergeCommit": {"oid": "f00"}}])
        self.assertEqual(self.ready_now(), ("done", True))
        self.assertEqual(self.task["pr"]["number"], 704)
        self.assertNotIn(("pr", "create"), calls)

    def test_ready_with_nothing_left_to_merge_is_done(self):
        self.change(self.task["worktree"], "reactions on the left")
        self.squash_into_main()  # by hand, no pull request
        calls = self.github([])
        self.assertEqual(self.ready_now(), ("done", True))
        self.assertNotIn("pr", self.task)
        self.assertNotIn(("pr", "create"), calls)

    # SHEP-96: a task with no commits beyond its base (research, an artifact only) still waits in
    # Ready for the person's Accept, its words kept; Accept just marks it done and cleans up.
    def ready_said(self, summary="Found three options.", details="- Read five sources"):
        import argparse
        from unittest import mock
        with mock.patch.object(self.commands, "review_refusal", lambda *a: None), \
                mock.patch.object(self.commands, "find_proof", lambda *a: None), \
                mock.patch.object(self.commands, "task_settings", lambda *a: []), \
                mock.patch.object(self.commands, "ready_turns", lambda *a: {}), \
                mock.patch.object(self.commands, "merge_policy", lambda *a: "auto"), \
                mock.patch.object(self.commands, "tell", lambda *a: (_ for _ in ()).throw(AssertionError("asked to merge"))), \
                mock.patch.object(self.commands, "pr_open", lambda *a: (_ for _ in ()).throw(AssertionError("a pull request opened"))):
            self.commands.cmd_ready(argparse.Namespace(id="SHEP-1", json=True, folder=None, summary=summary, details=details,
                                                       proof=None, agents_md=None))
        return self.task["state"]

    def accept_now(self):
        import argparse
        from unittest import mock
        import herdr_task.github as github
        with mock.patch.object(self.commands, "finish", github.finish), \
                mock.patch.object(github, "live_agents", lambda key: self.live), \
                mock.patch.object(github, "live_helpers", lambda key: []):  # the real one: worktree and branch go
            self.commands.cmd_accept(argparse.Namespace(id="SHEP-1", json=True, folder=None))

    def test_ready_with_no_commits_waits_for_accept(self):
        calls = self.github([])
        self.assertEqual(self.ready_said(), "ready")
        self.assertEqual((self.task["summary"], self.task["details"]), ("Found three options.", "- Read five sources"))
        self.assertTrue(self.task["nothing_to_merge"])
        self.assertNotIn("auto_merge", self.task)
        self.assertNotIn("pr", self.task)
        self.assertNotIn(("pr", "create"), calls)
        self.assertTrue(os.path.isdir(self.task["worktree"]))
        # the tick leaves it for the person too
        self.assertEqual(self.tick_once(), ("ready", False))
        self.task["gh_checked"] = 0
        self.assertEqual(self.tick_once(), ("ready", False))
        # Accept: done, never merged, its worktree and branch cleaned up
        self.accept_now()
        self.assertEqual(self.task["state"], "done")
        self.assertFalse(self.task.get("merged"))
        self.assertTrue(self.task["nothing_to_merge"])
        self.assertFalse(os.path.isdir(self.task["worktree"]))
        self.assertEqual(self.git(self.main, "branch", "--list", "task/1"), "")

    def test_ready_only_caught_up_with_main_waits_for_accept(self):
        self.github([])
        self.commit(self.main, "another task merged")
        self.git(self.task["worktree"], "merge", "-q", "--ff-only", "main")
        self.assertEqual(self.ready_said(), "ready")
        self.assertTrue(self.task["nothing_to_merge"])
        self.accept_now()
        self.assertEqual(self.task["state"], "done")
        self.assertFalse(self.task.get("merged"))

    def test_ready_rebased_onto_origin_main_waits_for_accept(self):
        """#737: no commits of its own, its branch rebased onto origin/main while the local main is
        behind: nothing to merge and nothing to review, never an empty pull request."""
        from unittest import mock
        calls = self.github([])
        self.git(self.main, "update-ref", "refs/remotes/origin/main", self.commit(self.main, "on GitHub"))
        self.git(self.main, "reset", "-q", "--hard", "HEAD~1")  # local main behind its remote
        self.git(self.task["worktree"], "rebase", "-q", "origin/main")
        self.task["head"] = self.git(self.task["worktree"], "rev-parse", "HEAD")
        self.task["review_gate"] = True
        with mock.patch.object(self.commands, "review_limits", lambda *a: (True, 2)):
            self.assertIsNone(self.commands.review_refusal(self.store, self.task, self.task["worktree"]))
        self.assertEqual(self.ready_said(), "ready")
        self.assertTrue(self.task["nothing_to_merge"])
        self.assertNotIn(("pr", "create"), calls)

    # SHEP-117: a research task runs in the folder itself (--here), commits nothing and ends with an
    # artifact: ready waits for Accept with no branch or pull request, whatever the merge setting.
    def test_research_in_the_folder_itself_goes_ready_then_done(self):
        calls = self.github([])
        for k in ("worktree", "branch", "start"):
            self.task.pop(k)
        self.task["mode"] = "here"
        self.assertEqual(self.ready_said(), "ready")
        self.assertEqual(self.task["summary"], "Found three options.")
        self.assertNotIn("auto_merge", self.task)
        self.assertNotIn("pr", self.task)
        self.assertNotIn(("pr", "create"), calls)
        self.accept_now()
        self.assertEqual(self.task["state"], "done")
        self.assertFalse(self.task.get("merged"))
        self.assertEqual(self.git(self.main, "rev-list", "--count", "HEAD"), "1")

    def test_commits_after_a_no_commit_ready_go_the_usual_way(self):
        self.github([])
        self.assertEqual(self.ready_said(), "ready")
        self.task["state"] = "running"  # back at work
        self.change(self.task["worktree"], "reactions on the left")
        with self.assertRaises(AssertionError):
            self.ready_said()  # on to pr_open
        self.assertNotIn("nothing_to_merge", self.task)

    def test_ready_with_work_left_opens_its_pull_request(self):
        self.change(self.task["worktree"], "reactions on the left")
        self.github([])
        with self.assertRaises(AssertionError):
            self.ready_now()  # on to pr_open

    def test_the_tick_finds_a_squash_merged_pull_request(self):
        tip = self.change(self.task["worktree"], "reactions on the left")
        self.assertEqual(self.tick_once(), ("running", False))
        self.squash_into_main()
        self.github([{"number": 704, "url": "u", "isCrossRepository": False, "baseRefName": "main", "headRefOid": tip}])
        self.working()
        self.assertEqual(self.tick_once(), ("running", False))  # never under a working agent
        self.live, self.task["gh_checked"] = [], 0  # GitHub asked at most once a minute
        self.assertEqual(self.tick_once(), ("done", True))
        self.assertEqual(self.task["pr"]["number"], 704)

    def test_the_tick_finds_a_ready_task_already_in_main(self):
        self.change(self.task["worktree"], "reactions on the left")
        self.tick_once()
        self.task["state"] = "ready"
        self.github([])
        self.squash_into_main()
        self.task["gh_checked"] = 0
        self.assertEqual(self.tick_once(), ("done", True))


class TimeLeft(unittest.TestCase):
    """Every status gives the time left, a rough guess beats none (SHEP-13): the minutes show from
    the first one, one without --left asks for it, and every brief and template says so. In memory."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        self.commands, self.said = commands, []
        self.store = Store([{"id": 7, "title": "Web client", "state": "running", "agents": []}])
        for name, value in (("open_store", lambda args, write=True: self.store), ("view", lambda s, t, live=None: {}),
                            ("live_agents", lambda key: []), ("say", lambda args, data, text: self.said.append(text))):
            p = mock.patch.object(commands, name, value)
            p.start()
            self.addCleanup(p.stop)

    def status(self, left=None, done=None):
        import argparse
        self.commands.cmd_status(argparse.Namespace(id="SHEP-7", json=False, folder=None, text="Starting", done=done, left=left))
        return self.said[-1]

    def test_the_first_status_shows_its_minutes(self):
        from herdr_task.output import report_of
        self.status("20m", 0)
        self.assertEqual(report_of(self.store.find(7), "working")["left"], 20)

    def test_a_status_without_left_asks_for_it(self):
        self.assertIn("Add --left", self.status())
        self.assertNotIn("Add --left", self.status("20m"))

    def test_every_brief_and_template_says_always(self):
        from herdr_task import templates
        launch = open(os.path.join(BIN, "herdr_task", "launch.py")).read()
        for words in (templates.WORKER_MD, open(os.path.join(ROOT, "templates", "worker.md")).read(), launch):
            self.assertNotIn("real estimate", words)
            self.assertIn("rough guess beats none", words)
        self.assertIn(templates.WORKER_MD_BEFORE_LEFT, templates.OLD_WORKERS)  # an unedited old one gets today's


class ReviewAsAHelperAgent(unittest.TestCase):
    """SHEP-54: workers run their review as an interactive hc child people see, never headless; an
    unedited earlier worker or reviewer template gets today's words."""

    def test_the_words(self):
        sys.path.insert(0, BIN)
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn("--label herdr.role=reviewer", words)
            self.assertIn("herdr.task=$HERDR_BROWSER_TASK", words)
            self.assertIn("codex --no-daemon --sandbox read-only", words)
            self.assertIn("claude --permission-mode plan", words)
            self.assertIn("exactly as the Reviewer line gives it", words)
            self.assertIn("hc wait <its name>", words)
            self.assertNotIn("< /dev/null", words)
        self.assertIn(templates.WORKER_MD_BEFORE_SUBAGENTS, templates.OLD_WORKERS)
        self.assertIn(templates.WORKER_MD_BEFORE_COMMAND, templates.OLD_WORKERS)
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            self.assertIn(templates.REVIEWER_MD.strip(), f.read())

    def test_an_unedited_old_reviewer_gets_todays(self):
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import templates
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "reviewer.md"), "w") as f:
            f.write(templates.TEMPLATE_HEADS["reviewer"] + templates.REVIEWER_MD_BEFORE_SUBAGENT)
        with mock.patch.object(templates, "TEMPLATES", d):
            self.assertEqual(templates.instructions("reviewer"), templates.REVIEWER_MD.strip())
            with open(os.path.join(d, "reviewer.md"), "w") as f:
                f.write(templates.TEMPLATE_HEADS["reviewer"] + "My own words.")
            self.assertEqual(templates.instructions("reviewer"), "My own words.")

    def test_the_reviewer_says_which_checks_its_sandbox_cant_run(self):
        """#840: herdr-app check hangs and doctor can't reach the service in Codex's read-only sandbox."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            words = f.read()
        for w in (words, templates.REVIEWER_MD):
            self.assertIn("`herdr-app check` hangs there", w)
            self.assertIn("Not run in my sandbox:", w)
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "reviewer.md"), "w") as f:
            f.write(templates.TEMPLATE_HEADS["reviewer"] + templates.REVIEWER_MD_BEFORE_SANDBOX)
        with mock.patch.object(templates, "TEMPLATES", d):
            self.assertEqual(templates.instructions("reviewer"), templates.REVIEWER_MD.strip())



class ReviewerLine(unittest.TestCase):
    """#745: the brief's Reviewer line gives the reviewer's whole command (Codex's on its own app
    server, --no-daemon), and a CLI the sign-in check says is signed out here never reviews: the
    task's own CLI does, and the line says how to bring the other back."""

    def setUp(self):
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import settings, takeover
        self.settings = settings
        d = tempfile.mkdtemp()
        self.checks = os.path.join(d, "cli-check.json")
        with open(os.path.join(d, "settings.json"), "w") as f:
            json.dump({"everywhere": {"tasks": {"review_rounds": 2}}}, f)
        for p in (mock.patch.object(settings, "SETTINGS", os.path.join(d, "settings.json")),
                  mock.patch.object(takeover, "CLI_CHECK", self.checks),
                  mock.patch.object(settings.shutil, "which", lambda name: f"/usr/bin/{name}")):
            p.start()
            self.addCleanup(p.stop)

    def line(self, codex):
        with open(self.checks, "w") as f:
            json.dump({"machines": {"": {"claude": "ready", "codex": codex}}}, f)
        t = {"id": 1, "title": "x", "mode": "worktree"}
        return next(x for x in self.settings.task_settings(Store([t]), t, argv=["claude"]) if x["label"] == "Reviewer")

    def test_codex_runs_on_its_own_server(self):
        r = self.line("ready")
        self.assertEqual(r["value"]["agent"], "codex")
        self.assertTrue(r["value"]["command"].startswith("codex --no-daemon --sandbox read-only --ask-for-approval never"))
        self.assertIn("(the other CLI); start it as `codex --no-daemon", r["text"])

    def test_signed_out_codex_never_reviews(self):
        r = self.line("signed-out")
        self.assertEqual(r["value"]["agent"], "claude")
        self.assertTrue(r["value"]["command"].startswith("claude --permission-mode plan"))
        self.assertIn("Codex isn't signed in here", r["text"])
        self.assertIn("`codex login`", r["text"])

    def test_an_unknown_check_keeps_codex(self):
        self.assertEqual(self.line(None)["value"]["agent"], "codex")

    def test_codex_skips_its_trust_and_hooks_screens(self):
        """#798, #753: a reviewer in a task's worktree never stops on "Trust this folder?" (its repo's
        root and the worktree trusted for this run, as a table: the path has dots) or "Hooks need review"."""
        import shlex
        d = os.path.realpath(tempfile.mkdtemp())
        main, wt = os.path.join(d, "re.po"), os.path.join(d, ".local", "wt")
        subprocess.run(["git", "init", "-q", main], check=True)
        subprocess.run(["git", "-C", main, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q",
                        "--allow-empty", "-m", "x"], check=True)
        subprocess.run(["git", "-C", main, "worktree", "add", "-q", wt, "-b", "t1"], check=True)
        cmd = shlex.split(self.settings.reviewer_command("codex", folder=wt))
        self.assertIn("--disable", cmd)
        self.assertEqual(cmd[cmd.index("--disable") + 1], "hooks")
        trust = cmd[cmd.index("-c") + 1]
        self.assertEqual(trust, "projects={%s={trust_level=\"trusted\"},%s={trust_level=\"trusted\"}}"
                         % (json.dumps(wt), json.dumps(main)))



class ReadOnlyStore(unittest.TestCase):
    """#841: in a read-only sandbox (a Codex reviewer's) show and list read the task list (write="try");
    a change is refused with a clear message, never a traceback."""

    def test_reads_without_a_writable_lock(self):
        import builtins
        import errno
        from unittest import mock
        sys.path.insert(0, BIN)
        from herdr_task import store
        d = tempfile.mkdtemp()
        folder = os.path.join(d, "proj")
        os.makedirs(folder)
        loc = {"folder": folder, "kind": "folder", "name": "proj", "common": None}
        with mock.patch.object(store, "STORE", os.path.join(d, "tasks")):
            with store.Store(loc) as s:
                s.data["tasks"].append({"id": 1, "title": "x", "state": "running"})
                s.dirty = True
            real = builtins.open

            def ro(path, mode="r", *a, **k):
                if any(c in mode for c in "wax+"):
                    raise OSError(errno.EROFS, "Read-only file system", path)
                return real(path, mode, *a, **k)
            with mock.patch.object(store, "open", ro, create=True):
                for write in ("try", False):
                    with store.Store(loc, write=write) as s:
                        self.assertEqual([t["id"] for t in s.data["tasks"]], [1])
                        s.dirty = True  # what show learns is kept only where it can be
                with self.assertRaises(store.Fail) as e:
                    with store.Store(loc):
                        pass
                self.assertIn("read-only", str(e.exception))


class PrLooks(unittest.TestCase):
    """A Ready task's pull request as the tick sees it. A fake gh (what HERDR_TASK_GH points herdr-task at:
    github.GH here, its store a throwaway) answers each look (gh_script())."""

    def gh_script(self):
        return ("#!/usr/bin/env python3\nimport json, sys\n"
                f"open({self.gh_log!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
                "if sys.argv[1:3] == ['pr', 'view']:\n"
                f"    print(open({os.path.join(self.dir, 'view.json')!r}).read())\n"
                "elif sys.argv[1] == 'api':\n    print('[]')\n")

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.agents as agents
        import herdr_task.commands as commands
        import herdr_task.ghnews as ghnews
        import herdr_task.github as github
        import herdr_task.news as news
        import herdr_task.tick as tick
        self.agents, self.commands, self.ghnews, self.news, self.tick = agents, commands, ghnews, news, tick
        self.dir = tempfile.mkdtemp()
        self.gh_log = os.path.join(self.dir, "gh.log")
        gh = os.path.join(self.dir, "gh")
        with open(gh, "w") as f:
            f.write(self.gh_script())
        os.chmod(gh, 0o755)
        self.clock = [50_000_000]
        self.live = [{"address": "t1", "agent": "claude", "status": {"state": "idle"}, "turn": 6, "status_ms": 1,
                      "labels": {"herdr.role": "worker"}}]
        self.sent = []
        self.store = Store([])
        for mod, name, value in ((github, "GH", gh), (github, "STORE", self.dir),
                                 (tick, "now", lambda: self.clock[0]), (agents, "now", lambda: self.clock[0]),
                                 (github, "now", lambda: self.clock[0]), (ghnews, "now", lambda: self.clock[0]),
                                 (commands, "now", lambda: self.clock[0]),
                                 (commands, "live_agents", lambda key: self.live), (commands, "detail", lambda k: k),
                                 (tick, "live_agents", lambda key: self.live), (tick, "detail", lambda k: k),
                                 (ghnews, "news_send", lambda to, text: self.sent.append((to, text)) or True)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def said_ready(self, **more):
        """A task its agent just said ready for: its pull request opened (as finalize leaves it)."""
        t = {"id": 9, "title": "Login", "state": "running", "space": "sp1", "agents": [], "mode": "worktree",
             "worktree": self.dir, "branch": "b", "set": {"merge": "ask"}, **more}
        self.store.data["tasks"] = [t]
        opened = {"number": 41, "url": "https://github.com/o/r/pull/41", "repo": "o/r"}
        with unittest.mock.patch.object(self.commands, "github", lambda s: "o/r"), \
                unittest.mock.patch.object(self.commands, "pr_open", lambda s, t, repo, summary=None: t.setdefault("pr", dict(opened))):
            msg = self.commands.finalize(self.store, t)
        self.assertIn("shows Working until its checks pass", msg)
        return t

    def github_says(self, mergeable="MERGEABLE", checks=()):
        with open(os.path.join(self.dir, "view.json"), "w") as f:
            json.dump({"state": "OPEN", "mergeable": mergeable, "headRefOid": "abc", "statusCheckRollup": list(checks)}, f)

    def look(self, t, after=60_000):
        """A tick's look at the task, after this long; (status, needs, why) and the news event then."""
        self.clock[0] += after
        t["pr"]["checked"] = 0
        self.tick.facts(self.store, t, {"attention": []})
        v = {**dict(zip(("status", "needs", "why"), self.agents.task_status(t, self.live))), "own_work": False}
        with unittest.mock.patch.object(self.news, "view", lambda s, t, live=None: v):
            event = self.news.news_state(self.store, t, self.live)[1]
        return v["status"], v["why"], event



class ChecksBeforeReady(PrLooks):
    """SHEP-175: a task said ready in a GitHub repo is Working (never Ready nor Needs you, no ready
    news) until its pull request's checks are done and GitHub knows it can merge."""

    RUNNING = {"name": "check", "status": "IN_PROGRESS", "conclusion": ""}
    PASSED = {"name": "check", "status": "COMPLETED", "conclusion": "SUCCESS"}
    FAILED = {"name": "check", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": ""}

    def test_working_while_checks_run_then_ready(self):
        t = self.said_ready()
        self.assertEqual(self.agents.task_status(t, self.live), ("working", None, "Checks running"))
        self.github_says(checks=[self.RUNNING])
        self.assertEqual(self.look(t), ("working", "Checks running", None))
        self.github_says(checks=[self.PASSED])
        self.assertEqual(self.look(t), ("ready", None, "ready"))
        with open(self.gh_log) as f:
            self.assertTrue(any(a[:2] == ["pr", "view"] for a in map(json.loads, f)))

    def test_github_still_working_out_mergeable_is_working(self):
        t = self.said_ready()
        self.github_says(mergeable="UNKNOWN", checks=[self.PASSED])
        self.assertEqual(self.look(t), ("working", "Waiting for GitHub", None))

    def test_a_failing_check_goes_back_to_its_agent_never_ready_first(self):
        t = self.said_ready()
        self.github_says(checks=[self.FAILED])
        self.assertEqual(self.look(t, after=1000), ("working", "Back to its agent to fix", None))
        self.assertEqual(t["attention"], "Checks failing: check.")
        # handed to its resting agent at once (pr_news, pr_deliver): it is on it, still Working past the grace
        self.tick.pr_deliver(self.store, t, {})
        self.assertEqual(self.sent[-1][0], "t1")
        self.assertIn('Check \\"check\\" failed', json.dumps(self.sent[-1][1]))
        self.clock[0] += 30_000
        self.assertEqual(self.agents.task_status(t, self.live)[0], "working")
        # it never fixes it and stays quiet: Needs you, as only the person can act now
        self.clock[0] += 10 * 60_000
        self.assertEqual(self.agents.task_status(t, self.live), ("needs", "attention", "Checks failing: check."))

    def test_a_conflict_goes_back_to_its_agent(self):
        t = self.said_ready(base="main")
        self.github_says(mergeable="CONFLICTING", checks=[self.PASSED])
        self.assertEqual(self.look(t, after=1000), ("working", "Back to its agent to fix", None))
        self.tick.pr_deliver(self.store, t, {})
        self.assertIn("It conflicts with main: rebase onto main", self.sent[-1][1])
        self.assertEqual(self.agents.task_status(t, self.live)[0], "working")

    def test_no_checks_is_ready_once_github_had_time_to_start_them(self):
        t = self.said_ready()
        self.github_says(checks=[])
        self.assertEqual(self.look(t, after=5000), ("working", "Checks running", None))
        self.assertEqual(self.look(t, after=30_000), ("ready", None, "ready"))

    def test_merging_by_itself_is_working_then_done(self):
        t = self.said_ready()
        t["auto_merge"] = "checks"
        self.assertEqual(self.agents.task_status(t, self.live), ("working", None, "Merges once its checks pass"))
        t["merge_requested"] = 1
        self.assertEqual(self.agents.task_status(t, self.live), ("working", None, "Merging"))


class ChecksUnreadable(PrLooks):
    """SHEP-179: a GitHub token that reads the pull request but not its checks (the exe.dev GitHub integration's):
    gh pr view with statusCheckRollup fails with GitHub's own GraphQL error, and the REST check runs with a 403. The
    task is never stuck Working on checks nobody can see, and Accept merges (GitHub refuses what its checks block)."""

    ERR = ("GraphQL: Resource not accessible by personal access token (repository.pullRequest.statusCheckRollup.nodes.0"
           ".commit.statusCheckRollup.contexts.nodes.0), Resource not accessible by personal access token "
           "(repository.pullRequest.statusCheckRollup.nodes.0.commit.statusCheckRollup.contexts.nodes.1)")
    DENIED = ('{"message":"Resource not accessible by personal access token","status":"403"}'
              "gh: Resource not accessible by personal access token (HTTP 403)")

    def gh_script(self):
        d = self.dir
        return ("#!/usr/bin/env python3\nimport json, os, sys\n"
                f"a = sys.argv[1:]\nopen({self.gh_log!r}, 'a').write(json.dumps(a) + '\\n')\n"
                f"def file(n):\n    p = os.path.join({d!r}, n)\n    return open(p).read() if os.path.exists(p) else None\n"
                "if a[:2] == ['pr', 'view'] and 'statusCheckRollup' in a[-1]:\n"
                f"    sys.stderr.write({self.ERR!r}); sys.exit(1)\n"
                "elif a[:2] == ['pr', 'view']:\n    print(file('view.json'))\n"
                "elif a[:2] == ['pr', 'merge']:\n"
                f"    open(os.path.join({d!r}, 'view.json'), 'w').write(json.dumps({{'state': 'MERGED', 'mergeCommit': {{'oid': 'f00'}}}}))\n"
                "elif a[0] == 'api' and a[1].endswith('/status'):\n"
                "    print(file('status.json') or json.dumps({'state': 'pending', 'statuses': []}))\n"
                "elif a[0] == 'api' and '/check-runs' in a[1] and file('runs.json'):\n    print(file('runs.json'))\n"
                "elif a[0] == 'api':\n"
                f"    print({self.DENIED!r}); sys.stderr.write('gh: Resource not accessible by personal access token (HTTP 403)'); sys.exit(1)\n")

    def github_says(self, merge_state="CLEAN", mergeable="MERGEABLE", runs=None):
        with open(os.path.join(self.dir, "view.json"), "w") as f:
            json.dump({"state": "OPEN", "mergeable": mergeable, "headRefOid": "abc", "mergeStateStatus": merge_state,
                       "reviewDecision": ""}, f)
        if runs is not None:
            with open(os.path.join(self.dir, "runs.json"), "w") as f:
                json.dump({"check_runs": runs}, f)

    def test_the_view_reads_the_rest_and_says_checks_are_unknown(self):
        import herdr_task.github as github
        self.github_says()
        v = github.pr_view({"pr": {"number": 7, "repo": "o/r"}})
        self.assertEqual((v["state"], v["mergeable"], v["statusCheckRollup"], v["checks_unknown"]), ("OPEN", "MERGEABLE", [], True))
        with open(self.gh_log) as f:
            calls = [json.loads(x) for x in f]
        self.assertIn(["api", "repos/o/r/commits/abc/check-runs?per_page=100"], calls)

    def test_ready_with_a_note_when_github_says_clean(self):
        t = self.said_ready()
        self.github_says("CLEAN")
        self.assertEqual(self.look(t, after=5000)[:2], ("working", "Checks running"))  # GitHub may not have started them
        self.assertEqual(self.look(t, after=30_000), ("ready", None, "ready"))
        self.assertTrue(t["pr"]["checks_unknown"])
        self.assertEqual(self.store.data["github_checks"]["repo"], "o/r")
        import herdr_task.proof as proof
        self.assertEqual(proof.checks_of(t), {"state": "unknown", "text": "Can't read GitHub checks here: check them on GitHub."})

    def test_blocked_waits_a_while_then_is_ready_anyway(self):
        t = self.said_ready()
        self.github_says("BLOCKED")
        self.assertEqual(self.look(t, after=60_000)[:2], ("working", "Checks running"))
        self.assertEqual(self.look(t, after=10 * 60_000)[:2], ("working", "Checks running"))
        self.assertEqual(self.look(t, after=10 * 60_000), ("ready", None, "ready"))

    def test_rest_check_runs_still_count_when_graphql_refuses(self):
        t = self.said_ready()
        self.github_says("BLOCKED", runs=[{"name": "test", "status": "in_progress", "conclusion": None}])
        self.assertEqual(self.look(t)[:2], ("working", "Checks running"))
        self.github_says("CLEAN", runs=[{"name": "test", "status": "completed", "conclusion": "success"}])
        self.assertEqual(self.look(t), ("ready", None, "ready"))
        self.assertNotIn("checks_unknown", t["pr"])  # REST read them all: known
        self.assertNotIn("github_checks", self.store.data)
        self.github_says("BLOCKED", runs=[{"name": "test", "status": "completed", "conclusion": "failure"}])
        self.assertEqual(self.look(t, after=1000)[:2], ("working", "Back to its agent to fix"))
        self.assertEqual(t["attention"], "Checks failing: test.")

    def test_accept_merges_without_check_access(self):
        t = self.said_ready()
        t["state"] = "ready"
        self.github_says("CLEAN")
        for name in ("watch_main", "update_main"):
            p = unittest.mock.patch.object(self.commands, name, lambda *a, **k: None)
            p.start()
            self.addCleanup(p.stop)
        p = unittest.mock.patch.object(self.commands, "finish", lambda s, t, even_if_busy=False: t.update(state="done"))
        p.start()
        self.addCleanup(p.stop)
        self.assertIsNone(self.commands.merge_now(self.store, t))
        self.assertEqual((t["state"], t.get("merged")), ("done", True))
        with open(self.gh_log) as f:
            self.assertTrue(any(a[:2] == ["pr", "merge"] for a in map(json.loads, f)))

    def test_a_network_blip_is_not_taken_for_a_permission(self):
        import herdr_task.github as github
        self.assertFalse(github.denied("error connecting to api.github.com"))
        self.assertTrue(github.denied(self.ERR))
        self.assertTrue(github.denied(self.DENIED))


class Store:
    """Enough of herdr_task.store.Store for the commands, in memory."""
    def __init__(self, tasks):
        self.data, self.loc, self.dirty, self.write = {"tasks": tasks}, {"folder": "/f", "kind": "repo", "name": "f"}, False, True
        self.prefix, self.slug = "SHEP", "f"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def find(self, ref):
        return next(t for t in self.data["tasks"] if t["id"] == int(str(ref).split("-")[-1]))

    def ref(self, t):
        return f"SHEP-{t['id']}"

    def key(self, t):
        return f"f#{t['id']}"


class Scheduled(unittest.TestCase):
    """APP-38: a task that starts by itself at a time (--at "fri 8:15", --in 6h). A real task list on
    disk in a throwaway store and a throwaway git repo; only starting an agent, hc and the clock are faked."""

    def setUp(self):
        import argparse
        import contextlib
        import io
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        import herdr_task.queues as queues
        import herdr_task.settings as settings
        import herdr_task.store as store
        import herdr_task.tick as tick
        from herdr_task.base import Fail
        self.commands, self.tick, self.store_mod, self.Fail = commands, tick, store, Fail
        self.argparse, self.io, self.redirect = argparse, io, contextlib.redirect_stdout
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.folder = os.path.join(self.tmp, "app")
        os.makedirs(self.folder)
        subprocess.run(["git", "init", "-q", "-b", "main", self.folder], check=True)
        subprocess.run(["git", "-C", self.folder, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q",
                        "--allow-empty", "-m", "base"], check=True)
        self.started, self.clock = [], None

        def begin(s, t, argv, space, parent=None):
            t["state"], t["started"] = "running", 1
            for k in ("queue", "queued_at", "held", "scheduled_for"):
                t.pop(k, None)
            s.dirty = True
            self.started.append((s.ref(t), argv, space, parent))
            return {"address": "t9", "agent": "claude"}

        later = lambda: self.clock if self.clock is not None else int(__import__("time").time() * 1000)
        patches = [mock.patch.object(store, "STORE", os.path.join(self.tmp, "tasks")),
                   mock.patch.object(settings, "SETTINGS", os.path.join(self.tmp, "settings.json")),
                   mock.patch.dict(os.environ, {"HC_TERMINAL_ID": ""}),
                   mock.patch.object(commands, "begin", begin), mock.patch.object(tick, "begin", begin),
                   mock.patch.object(commands, "ensure_scheduler", lambda quiet=False: {}),
                   mock.patch.object(commands, "default_space", lambda: "sp1"),
                   mock.patch.object(commands, "caller_space", lambda: None),
                   mock.patch.object(commands, "worker_argv", lambda s, t, space, key=None: ["claude"]),
                   mock.patch.object(tick, "worker_argv", lambda s, t, space, key=None: ["claude"]),
                   mock.patch.object(commands, "live_agents", lambda key: []),
                   mock.patch.object(queues, "live_agents", lambda key: []),
                   mock.patch.object(queues, "machine_hold", lambda: None),
                   mock.patch.object(tick, "machine_hold", lambda: None),
                   mock.patch.object(tick, "now", later)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def run_cmd(self, fn, **kw):
        base = dict(folder=self.folder, json=True, id=None, title=None, prompt=None, prompt_file=None, here=False,
                    worktree=False, after=None, space=None, at=None, in_=None, agent=None, model=None, effort=None,
                    argv=None, parent=None, now=False, base=None, start_notes=None, finish_notes=None, set=None)
        args = self.argparse.Namespace(**{**base, **kw})
        out = self.io.StringIO()
        with self.redirect(out):
            fn(args)
        return json.loads(out.getvalue())

    def add(self, title, **kw):
        return self.run_cmd(self.commands.cmd_add, title=title, **{"skill": "hc-build", **kw})

    def tick_at(self, ms):
        """One tick at that moment, the list read fresh from disk (as after a restart)."""
        self.clock = ms
        report = {"started": [], "done": [], "attention": [], "fired": []}
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            self.tick.tick_store(s, report)
        return [x["ref"] for x in report["started"]]

    def task(self, n):
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            return dict(s.find(n))

    def test_unassigned_drafts_wait_and_failed_scheduling_keeps_the_store_unchanged(self):
        v = self.add("Draft", skill=None)
        self.assertEqual(v["state"], "todo")
        with self.assertRaisesRegex(self.Fail, "require a HolyCow skill"):
            self.run_cmd(self.commands.cmd_start, id=v["ref"], at="tomorrow 9:00", argv='["claude"]')
        self.assertEqual(self.task(v["id"])["state"], "todo")
        with self.assertRaisesRegex(self.Fail, "require a HolyCow skill"):
            self.add("Unassigned scheduled task", skill=None, in_="6h")
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as st:
            self.assertEqual(len(st.data["tasks"]), 1)
        self.assertEqual(self.started, [])

    def test_parsing_absolute_relative_and_refused(self):
        import datetime
        from herdr_task.when import parse_at, parse_in, when_from
        thu = int(datetime.datetime(2026, 11, 5, 10, 0).timestamp() * 1000)  # a Thursday, 10:00
        at = lambda words: datetime.datetime.fromtimestamp(parse_at(words, thu) / 1000).strftime("%a %Y-%m-%d %H:%M")
        self.assertEqual(at("2026-11-06 09:00"), "Fri 2026-11-06 09:00")
        self.assertEqual(at("tomorrow 9:00"), "Fri 2026-11-06 09:00")
        self.assertEqual(at("fri 8:15"), "Fri 2026-11-06 08:15")
        self.assertEqual(at("thu 9:00"), "Thu 2026-11-12 09:00")  # passed today: next week's
        self.assertEqual(at("today 18:00"), "Thu 2026-11-05 18:00")
        self.assertEqual(at("9:00"), "Fri 2026-11-06 09:00")  # a bare time: the next one
        self.assertEqual(at("next friday at 5:30 pm"), "Fri 2026-11-06 17:30")
        self.assertEqual([parse_in(x) // 60000 for x in ("6h", "90m", "2 days", "6 hours", "1h 30m", "in 6 hours")],
                         [360, 90, 2880, 360, 90, 360])
        for words in ("soon", "tomorrow", "blah 9:00", "25:00", "2026-02-30 9:00", "2026-11-06"):
            with self.assertRaises(self.Fail, msg=words) as e:
                parse_at(words, thu)
            self.assertRegex(str(e.exception), r"tomorrow 9:00|No such date|2026-11-06 09:00")
        for words in ("6", "soon", "6 parsecs", ""):
            with self.assertRaises(self.Fail, msg=words) as e:
                parse_in(words)
            self.assertTrue("6h" in str(e.exception) or "how long" in str(e.exception), str(e.exception))
        with self.assertRaises(self.Fail):
            when_from("2020-01-01 09:00", None)  # passed
        self.assertEqual(when_from("in 6 hours", None, thu), thu + 6 * 3600000)  # a span where a time goes: from now
        with self.assertRaises(self.Fail) as e:
            when_from("whenever", None, thu)
        self.assertIn('"tomorrow 9:00"', str(e.exception))
        with self.assertRaises(self.Fail):
            self.add("Both", at="18:00", in_="6h")  # one or the other (argparse refuses it too)

    def test_automations_once_takes_the_same_words(self):
        import datetime
        from herdr_task.automations import parse_every
        r = parse_every("once tomorrow 9:00")
        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
        self.assertEqual(r, {"text": "once tomorrow 9:00", "kind": "once", "at": f"{tomorrow:%Y-%m-%d} 09:00"})
        self.assertEqual(parse_every("once 2026-11-05 9:00")["at"], "2026-11-05 09:00")
        with self.assertRaises(self.Fail):
            parse_every("once whenever")

    def test_it_starts_on_time_not_before(self):
        import time
        v = self.add("Nightly cleanup", in_="6h")
        self.assertEqual(v["status"], "scheduled")
        self.assertEqual(v["status_text"], "Scheduled")
        self.assertRegex(v["why"], r"^Starts (Today|Tomorrow) \d+:\d\d \(in (5h \d+m|6h)\)$")
        due = v["scheduled_for"]
        self.assertAlmostEqual(due, time.time() * 1000 + 6 * 3600000, delta=5000)
        self.assertEqual(self.tick_at(due - 60000), [])
        self.assertEqual(self.task(1)["state"], "scheduled")
        self.assertEqual(self.tick_at(due + 1000), ["APP-1"])
        self.assertEqual(self.started, [("APP-1", ["claude"], "sp1", None)])  # the space it was added in
        t = self.task(1)
        self.assertEqual(t["state"], "running")
        self.assertNotIn("scheduled_for", t)
        self.assertEqual(self.tick_at(due + 20000), [])  # once

    def test_a_time_passed_while_the_machine_was_off_starts_once(self):
        v = self.add("Report", at="2099-01-01 09:00")
        self.assertEqual(v["status"], "scheduled")
        # The machine was off on the day: the first tick after (a fresh read of the list) starts it.
        a_day_late = v["scheduled_for"] + 86400000
        self.assertEqual(self.tick_at(a_day_late), ["APP-1"])
        self.assertEqual(self.tick_at(a_day_late + 15000), [])
        self.assertEqual(len(self.started), 1)

    def test_no_room_then_it_queues(self):
        from unittest import mock
        import herdr_task.queues as queues
        self.add("Busy one")
        self.run_cmd(self.commands.cmd_start, id="1", now=True)
        v = self.add("Later", in_="1h")
        with mock.patch.object(self.store_mod.Store, "max_running", lambda s: 1), \
                mock.patch.object(queues, "working", lambda s, t: t["state"] == "running"):
            self.assertEqual(self.tick_at(v["scheduled_for"] + 1000), [])
            self.assertEqual(self.task(2)["state"], "queued")

    def test_after_and_a_time_start_when_both_hold(self):
        self.add("First")
        v = self.add("Second", in_="1h", after="1")
        due = v["scheduled_for"]
        self.assertEqual(v["status"], "scheduled")
        self.assertEqual(self.tick_at(due + 1000), [])  # its time came, SHEP-1 isn't done
        self.assertEqual(self.task(2)["state"], "queued")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)["state"] = "done"
            s.dirty = True
        self.assertEqual(self.tick_at(due + 20000), ["APP-2"])
        # the other way round: done first, then its time
        self.add("Third")
        v = self.add("Fourth", in_="2h", after="3")
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(3)["state"] = "done"
            s.dirty = True
        self.assertEqual(self.tick_at(v["scheduled_for"] - 60000), [])
        self.assertEqual(self.tick_at(v["scheduled_for"] + 1000), ["APP-4"])

    def test_start_at_now_reschedule_and_unschedule(self):
        self.add("Deploy")
        v = self.run_cmd(self.commands.cmd_start, id="1", at="2099-01-01 09:00", agent=None)
        self.assertEqual((v["status"], v["queue"]["space"]), ("scheduled", "sp1"))
        v = self.run_cmd(self.commands.cmd_edit, id="1", in_="3h")
        self.assertEqual(v["status"], "scheduled")
        self.assertEqual(v["queue"]["argv"], ["claude"])  # what start would use, kept
        v = self.run_cmd(self.commands.cmd_edit, id="1", at="")
        self.assertEqual(v["status"], "todo")
        self.assertNotIn("scheduled_for", v)
        self.run_cmd(self.commands.cmd_edit, id="1", at="tomorrow 9:00")
        self.assertEqual(self.task(1)["state"], "scheduled")
        v = self.run_cmd(self.commands.cmd_start, id="1", now=True)
        self.assertEqual(v["state"], "running")
        self.assertEqual([x[0] for x in self.started], ["APP-1"])
        with self.assertRaises(self.Fail):
            self.run_cmd(self.commands.cmd_edit, id="1", in_="1h")  # started: too late
        with self.assertRaises(self.Fail):
            self.add("Typo", at="fry 9:00")


class FastOffIsSaid(unittest.TestCase):
    """SHEP-41: a worker with Fast off runs standard even when config.toml sets service_tier."""

    def test_codex_fast_on_and_off(self):
        sys.path.insert(0, BIN)
        from herdr_task.settings import argv_for
        off = argv_for({"agent": "codex", "model": "gpt-x", "fast": False})
        self.assertIn('service_tier="default"', off)
        self.assertNotIn('service_tier="fast"', off)
        self.assertIn('service_tier="fast"', argv_for({"agent": "codex", "fast": True}))
        self.assertIn('{"fastMode": false}', argv_for({"agent": "claude", "fast": False}))


class AcceptCardArtifacts(unittest.TestCase):
    """SHEP-96: the Accept card links the task's other artifacts (a research report) beside its proof."""

    def test_its_other_artifacts_since_it_started(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.proof as proof
        arts = [{"id": "report-0003", "title": "SHEP-1: Three options", "task": "SHEP-1", "at": 300},
                {"id": "proof-0002", "title": "SHEP-1: Reactions · Proof", "task": "SHEP-1", "at": 200, "files": ["recipe.json"]},
                {"id": "other-0004", "title": "SHEP-2: Elsewhere", "task": "SHEP-2", "at": 400},
                {"id": "old-0001", "title": "SHEP-1: Before it started", "task": "SHEP-1", "at": 50}]
        s = Store([{"id": 1, "title": "Reactions", "state": "ready", "started": 100, "agents": []}])
        t = s.data["tasks"][0]
        with mock.patch.object(proof, "artifacts_of", lambda folder: arts):
            self.assertEqual(proof.task_artifacts(s, t, {"id": "proof-0002"}), [{"id": "report-0003", "title": "SHEP-1: Three options"}])
            self.assertEqual([a["id"] for a in proof.task_artifacts(s, t)], ["report-0003", "proof-0002"])


class ReviewerFlags(unittest.TestCase):
    """#803: add/edit's --reviewer-model and --reviewer-effort set the task's reviewer, as --set does."""

    def test_the_flags_set_the_reviewer(self):
        import argparse
        sys.path.insert(0, BIN)
        from herdr_task.settings import set_opts
        t = {}
        set_opts(t, argparse.Namespace(reviewer="codex", reviewer_model="gpt-5", reviewer_effort="xhigh"))
        self.assertEqual((t["reviewer"], t["reviewer_model"], t["reviewer_effort"]), ("codex", "gpt-5", "xhigh"))
        set_opts(t, argparse.Namespace(set=["reviewer-effort=high", "reviewer_model=default"]))
        self.assertEqual(t["reviewer_effort"], "high")
        self.assertNotIn("reviewer_model", t)


class MachineHoldFollowsSettings(unittest.TestCase):
    """#768: limits a tick kept in machine-hold.json (--machine/--hold) never shadow Settings >
    Machines saved after them; a newer --hold wins again. Throwaway files; nothing is sampled."""

    def setUp(self):
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.machine as machine
        import herdr_task.queues as queues
        import herdr_task.settings as settings
        self.queues, self.tmp = queues, tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.settings = os.path.join(self.tmp, "shepherdr.json")
        busy = {"memory": 40, "load": 0.1, "cores": 4, "cpu": 3, "disk": 96}
        for mod, name, value in ((settings, "SETTINGS", self.settings), (queues, "HOLD_FILE", os.path.join(self.tmp, "machine-hold.json")),
                                 (machine, "sample", lambda: busy), (queues, "_hold", {})):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def hold(self):
        self.queues._hold.clear()
        return self.queues.machine_hold()

    def save_settings(self, disk, at):
        with open(self.settings, "w") as f:
            json.dump({"machines": {"vm-demo": {"machine": {"start_disk": disk}}}}, f)
        os.utime(self.settings, (at, at))

    def test_settings_saved_after_the_hold_win(self):
        self.queues.set_hold("vm-demo", {"start_load": 1.0, "start_memory": 80, "start_disk": 90})
        os.utime(self.queues.HOLD_FILE, (1000, 1000))
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full")
        self.save_settings(100, 2000)  # raised in Settings > Machines
        self.assertIsNone(self.hold())
        self.queues.set_hold("vm-demo", {"start_load": 1.0, "start_memory": 80, "start_disk": 90})  # a newer tick's
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full")

    def test_no_settings_file_keeps_the_hold(self):
        self.queues.set_hold("vm-demo", {"start_disk": 90})
        self.assertEqual(self.hold(), "vm-demo's disk is 96% full")


class ReviewedNamesItsCommit(unittest.TestCase):
    """#797: `reviewed --commit <sha>` records a round on the commit it reviewed, fixes committed
    since; only a commit on the task's branch. A throwaway git repo; hc and gh are never run."""

    def setUp(self):
        import argparse
        import shutil
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        self.commands, self.argparse = commands, argparse
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        main, self.wt = os.path.join(self.root, "repo"), os.path.join(self.root, "wt")
        self.git(self.root, "init", "-q", "-b", "main", main)
        for k, v in (("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
            self.git(main, "config", k, v)
        self.git(main, "commit", "-q", "--allow-empty", "-m", "base")
        self.git(main, "commit", "-q", "--allow-empty", "-m", "elsewhere")
        self.other = self.git(main, "rev-parse", "HEAD")
        self.git(main, "worktree", "add", "-q", "-b", "task/1", self.wt, "HEAD~1")
        self.store = Store([{"id": 1, "title": "Reactions", "state": "running", "mode": "worktree", "worktree": self.wt,
                             "branch": "task/1", "base": "main", "start": self.git(self.wt, "rev-parse", "HEAD"), "agents": [],
                             "review_gate": True}])
        self.store.loc["folder"] = main
        self.task = self.store.data["tasks"][0]
        for name, value in (("open_store", lambda args, write=True: self.store), ("view", lambda s, t, live=None: dict(t)),
                            ("say", lambda *a: None), ("review_limits", lambda *a: (True, 3))):
            p = mock.patch.object(commands, name, value)
            p.start()
            self.addCleanup(p.stop)

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, words):
        self.git(self.wt, "commit", "-q", "--allow-empty", "-m", words)
        return self.git(self.wt, "rev-parse", "HEAD")

    def reviewed(self, commit=None):
        self.commands.cmd_reviewed(self.argparse.Namespace(id="SHEP-1", json=True, folder=None, report="one major, fixed",
                                                           commit=commit))
        return self.task["reviews"][-1]["head"]

    def test_a_round_on_the_commit_it_reviewed(self):
        a = self.commit("reactions on the left")
        b = self.commit("the round's fixes")
        self.assertEqual(self.reviewed(a[:9]), a)
        self.task["head"] = b
        refusal = self.commands.review_refusal(self.store, self.task, self.wt)
        self.assertIn(f"your final commit {b[:7]} (rounds are recorded on {a[:7]})", refusal)
        self.assertEqual(self.reviewed(), b)  # by default HEAD, as before
        self.assertIsNone(self.commands.review_refusal(self.store, self.task, self.wt))

    def test_uncommitted_fixes_still_record_the_named_commit(self):
        a = self.commit("reactions on the left")
        with open(os.path.join(self.wt, "fix.txt"), "w") as f:
            f.write("a fix")
        self.git(self.wt, "add", "fix.txt")
        with self.assertRaises(Exception):
            self.reviewed()
        self.assertEqual(self.reviewed(a), a)

    def test_only_a_commit_on_its_branch(self):
        self.commit("reactions on the left")
        for bad in (self.other, "nope"):
            with self.assertRaises(Exception):
                self.reviewed(bad)
        self.assertNotIn("reviews", self.task)


if __name__ == "__main__":
    unittest.main()


class CleanEnv(unittest.TestCase):
    """SHEP-86: herdr-core's holder hands every terminal the environment it was started with, so a holder started from
    inside Claude Code would hand each agent that session's markers (transcripts off, no folder-trust prompt). A task's
    agent launched through launch() runs without them; the person's own Claude Code config stays. Fake values only:
    hc is never run, the launch's own argv runs for real with `env` as its agent."""
    MARKERS = {"CLAUDECODE": "1", "CLAUDE_PID": "4242", "CLAUDE_CODE_CHILD_SESSION": "1", "CLAUDE_CODE_SESSION_ID": "fake-session",
               "CLAUDE_CODE_ENTRYPOINT": "cli", "CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/fake.sock", "CLAUDE_CODE_MESSAGING_TOKEN": "fake-token"}
    KEPT = {"CLAUDE_CONFIG_DIR": "/tmp/fake-claude", "CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDE_CODE_DISABLE_AUTOUPDATER": "1", "FAKE_OTHER": "x"}

    def agent_env(self, argv):
        """What the agent at the end of a launch argv sees, started from a parent environment with the markers."""
        out = subprocess.run(argv, env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], **self.MARKERS, **self.KEPT}, capture_output=True, text=True, timeout=20)
        self.assertEqual(out.returncode, 0, out.stderr)
        return dict(l.split("=", 1) for l in out.stdout.splitlines() if "=" in l)

    def test_a_task_agent_starts_without_a_parent_claude_session(self):
        from types import SimpleNamespace
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.launch as L
        ran = []

        def run(argv, *a, **k):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps({"address": "t9"}), "")
        s = SimpleNamespace(key=lambda t: "dev#6", dirty=False)
        task = {"id": 6, "title": "fake", "kind": "non-software", "agents": []}
        with mock.patch.object(L, "run", run), mock.patch.object(L, "folder_for", lambda s, t: "/tmp"), \
                mock.patch.object(L, "agent_name", lambda *a: "dev-6-fake"), mock.patch.object(L, "track", lambda *a: None), \
                mock.patch.object(L, "coordinator_tab", lambda a: None), mock.patch.object(L, "own_argv", lambda a, *_: a), \
                mock.patch.object(L, "in_shell", lambda a: a), mock.patch.object(L, "low_priority", lambda a, n: a):
            L.launch(s, task, ["env"], "sp1")
        hc = ran[0]
        self.assertEqual(hc[:2], ["hc", "run"])
        env = self.agent_env(hc[hc.index("--") + 1:])
        for k in self.MARKERS:
            self.assertNotIn(k, env)
        for k, v in self.KEPT.items():
            self.assertEqual(env.get(k), v)
        self.assertEqual(env.get("HERDR_BROWSER_TASK"), "dev#6")  # what the launch sets on purpose stays

    def test_the_same_line_everywhere(self):
        """herdr-task, the window and the service (core/clean-env.js) and restart.sh clear the same names."""
        sys.path.insert(0, BIN)
        import herdr_task.launch as L
        js = subprocess.run(["sh", "-c", 'grep -o "export const CLEAN_ENV = .*" "$1"', "x", os.path.join(ROOT, "core", "clean-env.js")],
                            capture_output=True, text=True).stdout.strip()
        self.assertEqual(js.split("`")[1].replace("\\\\", "\\"), L.CLEAN_ENV)
        restart = os.path.join(ROOT, "mods", "coordinator", "restart.sh")
        line = subprocess.run(["bash", "-c", 'eval "$(grep "^clean=" "$1")"; printf %s "$clean"', "x", restart], capture_output=True, text=True).stdout
        self.assertEqual(line, L.CLEAN_ENV)
        self.assertEqual(self.agent_env(["sh", "-c", line + ' exec env']).keys() & self.MARKERS.keys(), set())


class Revive(unittest.TestCase):
    """SHEP-30:an Assistant or a task's agent the core gave a plain shell (a crash, a power loss, a
    reboot) gets its agent typed back into that shell, on its own session. A fake core in memory:
    hc and the agents' session files are never touched."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.revive as revive
        self.r, self.mock = revive, mock
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "S1.jsonl")
        open(self.log, "w").close()
        self.terms = {}
        self.sent, self.screens, self.sessions = [], {}, {}

        def hc(args):
            out, code = "", 0
            if args[:2] == ["hc", "label"]:
                k, v = args[3].split("=", 1)
                self.terms[args[2]].setdefault("labels", {})[k] = v
            elif args[:2] == ["hc", "send"]:
                # each line first clears a parent Claude Code session's markers (SHEP-86)
                self.assertTrue(args[3].startswith(revive.CLEAN_ENV + " "), args[3])
                self.sent.append((args[2], args[3][len(revive.CLEAN_ENV) + 1:]))
            elif args[:2] == ["hc", "read"]:
                out = self.screens.get(args[2], "")
            else:
                raise AssertionError(f"ran {args}")
            return subprocess.CompletedProcess(args, code, out, "")

        def hc_json(*args):
            if args == ("ls",):
                return {"terminals": [{"address": a, "state": t["state"]} for a, t in self.terms.items()]}
            if args[0] == "get":
                return json.loads(json.dumps(self.terms[args[1]]))
            raise AssertionError(f"hc {args}")
        self.tasks = {"dev#6": {"id": 6, "state": "running", "agents": []}}
        for name, value in (("run", hc), ("hc_json", hc_json), ("session_of", lambda pid: self.sessions.get(pid, (None, None))),
                            ("task_of", lambda k: self.tasks.get((k.get("labels") or {}).get("herdr.task")))):
            p = mock.patch.object(revive, name, value)
            p.start()
            self.addCleanup(p.stop)

    def assistant(self, addr="t1", pid=100, agent_pid=101, status="done"):
        self.terms[addr] = {"address": addr, "state": "live", "pid": pid, "cwd": "/home/me", "template": "assistant",
                            "argv": ["claude", "--model", "opus", "You are the coordinator..."], "status": {"state": status},
                            "foreground": {"pid": agent_pid, "name": "claude", "argv": ["/opt/claude", "--model", "opus", "You are..."], "cwd": "/home/me/app"},
                            "labels": {"herdr.role": "coordinator", "herdr.chat": "p1"}}
        self.sessions[agent_pid] = ("S1", self.log)

    def crash(self, addr, pid=200):
        """What the core does with a kept terminal whose program was lost: a shell, labels kept."""
        t = self.terms[addr]
        t.update(pid=pid, argv=["/bin/bash"], template=None, status=None, foreground={"pid": pid, "name": "bash", "argv": ["/bin/bash"], "cwd": t["cwd"]})

    def tick(self):
        report = {}
        self.r.revive_pass(report)
        return report

    def test_the_assistant_resumes_its_own_session(self):
        self.assistant()
        self.tick()
        rec = json.loads(self.terms["t1"]["labels"]["herdr.resume"])
        self.assertEqual((rec["session"], rec["argv"], rec["pid"], rec["shell"]), ("S1", ["claude", "--model", "opus"], 100, False))
        self.assertEqual(self.sent, [])
        self.crash("t1")
        report = self.tick()
        self.assertEqual(report["revived"], [{"terminal": "t1", "how": "resume", "session": "S1"}])
        self.assertEqual(self.sent, [("t1", "cd /home/me/app && command claude --model opus --resume S1")])
        # Once: the next tick types nothing again, even while the agent starts.
        self.tick()
        self.assertEqual(len(self.sent), 1)

    def test_background_instructions_survive_resume_and_missing_session(self):
        self.assistant()
        file = "/home/me/.config/herdr-core/assistant-context/role.txt"
        self.terms["t1"]["foreground"]["argv"] = ["claude", "--model", "opus", "--append-system-prompt-file", file]
        self.tick()
        rec = json.loads(self.terms["t1"]["labels"]["herdr.resume"])
        self.assertIn(file, rec["argv"])
        self.crash("t1")
        self.tick()
        self.assertIn("--append-system-prompt-file " + file, self.sent[0][1])
        self.screens["t1"] = "No conversation found with session ID: S1"
        with self.mock.patch.object(self.r, "template_of", lambda name="assistant": ("claude", "---\ncommand: claude\n---\nPrivate role instructions.")):
            self.tick()
        self.assertIn("<restart>", self.sent[1][1])
        self.assertIn(file, self.sent[1][1])
        self.assertNotIn("Private role instructions.", self.sent[1][1])

    def test_a_working_agent_carries_on(self):
        self.assistant(status="working")
        self.tick()
        self.crash("t1")
        self.tick()
        self.assertIn("--resume S1 'Herdr restarted", self.sent[0][1])

    def test_an_agent_that_quit_at_its_shell_stays_there(self):
        """The same process (no crash): a person who quit the agent keeps their shell."""
        self.assistant()
        self.tick()
        t = self.terms["t1"]
        t["foreground"] = {"pid": 100, "name": "bash", "argv": ["/bin/bash"]}
        self.tick()
        self.assertEqual(self.sent, [])

    def test_a_gone_session_starts_a_new_assistant_that_says_so(self):
        self.assistant()
        self.tick()
        os.unlink(self.log)
        self.crash("t1")
        with self.mock.patch.object(self.r, "template_of", lambda name="assistant": ("claude", "---\ncommand: claude\n---\nYou are the Assistant.")):
            self.tick()
        line = self.sent[0][1]
        self.assertTrue(line.startswith("cd /home/me/app && command claude --model opus '<restart>Your earlier session is gone"), line)
        self.assertIn("You are the Assistant.", line)
        self.assertNotIn("--resume", line)

    def test_a_resume_the_cli_refuses_starts_anew_once(self):
        self.assistant()
        self.tick()
        self.crash("t1")
        self.tick()
        self.screens["t1"] = "$ claude --resume S1\nNo conversation found with session ID: S1\n$ "
        with self.mock.patch.object(self.r, "template_of", lambda name="assistant": ("claude", None)):
            report = self.tick()
            self.tick()
        self.assertEqual(report["revived"][0]["how"], "fresh")
        self.assertEqual(len(self.sent), 2)
        self.assertIn("<restart>", self.sent[1][1])

    def test_never_a_second_copy_of_a_running_session(self):
        self.assistant()
        self.assistant("t2", pid=300, agent_pid=301)
        self.tick()
        self.crash("t1")
        report = self.tick()
        self.assertEqual(self.sent, [])
        self.assertEqual(report["revived"][0]["how"], "running")

    def test_a_worker_resumes_with_its_task_browser(self):
        self.terms["t5"] = {"address": "t5", "state": "live", "pid": 500, "cwd": "/wt", "name": "shep-6-web",
                            "argv": ["sh", "-c", "low", "herdr-low", "env", "HERDR_BROWSER_TASK=dev#6", "/bin/bash", "-ic", "x", "/bin/bash",
                                     "claude", "--settings", '{"a":1}', "Brief..."],
                            "status": {"state": "working"}, "foreground": {"pid": 501, "name": "claude", "argv": ["claude"], "cwd": "/wt"},
                            "labels": {"herdr.task": "dev#6", "herdr.agent": "claude"}}
        self.sessions[501] = ("S1", self.log)
        self.tick()
        self.crash("t5")
        self.tick()
        self.assertTrue(self.sent[0][1].startswith("""cd /wt && HERDR_BROWSER_TASK='dev#6' claude --settings '{"a":1}' --resume S1 'Herdr restarted"""), self.sent[0][1])

    def test_an_assistant_lost_before_any_record_starts_anew(self):
        """Lost before this change (or before its first record): a new Assistant, never a bare shell."""
        self.assistant()
        self.crash("t1")
        with self.mock.patch.object(self.r, "template_of", lambda name="assistant": ("claude", "---\ncommand: claude\n---\nRole.")):
            self.tick()
            self.tick()
        self.assertEqual(len(self.sent), 1)
        self.assertTrue(self.sent[0][1].startswith("cd /home/me && command claude '<restart>"), self.sent[0][1])

    def test_other_terminals_are_left_alone(self):
        self.terms["t9"] = {"address": "t9", "state": "live", "pid": 9, "argv": ["/bin/bash"], "foreground": {"pid": 9, "name": "bash"}, "labels": {}}
        self.tick()
        self.assertEqual((self.sent, self.terms["t9"]["labels"]), ([], {}))

    def test_one_typed_into_a_shell_comes_back_the_same_way(self):
        """An Assistant the person restarted by hand in its shell (claude -c): its process's flags, through the shell again."""
        self.assistant()
        t = self.terms["t1"]
        t.update(argv=["/bin/bash"], foreground={"pid": 101, "name": "claude", "argv": ["/opt/claude", "--dangerously-skip-permissions", "-c"], "cwd": "/home/me"})
        self.tick()
        self.crash("t1")
        self.tick()
        self.assertEqual(self.sent, [("t1", "cd /home/me && claude --dangerously-skip-permissions --resume S1")])

    def test_a_finished_tasks_worker_stays_a_shell(self):
        self.terms["t5"] = {"address": "t5", "state": "live", "pid": 500, "cwd": "/wt", "name": "shep-6-web", "argv": ["claude", "Brief"],
                            "foreground": {"pid": 501, "name": "claude", "argv": ["claude"], "cwd": "/wt"}, "labels": {"herdr.task": "dev#6"}}
        self.sessions[501] = ("S1", self.log)
        self.tick()
        self.tasks["dev#6"]["state"] = "done"
        self.crash("t5")
        self.tick()
        self.assertEqual(self.sent, [])

    def test_a_worker_lost_before_any_record_resumes_its_tasks_session(self):
        self.tasks["dev#6"]["agents"] = [{"address": "t5", "argv": ["claude"], "session": "S1", "log": self.log}]
        self.terms["t5"] = {"address": "t5", "state": "live", "pid": 500, "cwd": "/wt", "name": "shep-6-web", "argv": ["claude"],
                            "labels": {"herdr.task": "dev#6"}}
        self.crash("t5")
        with self.mock.patch("herdr_task.launch.own_argv", lambda argv, *_: argv):
            self.tick()
        self.assertTrue(self.sent[0][1].startswith("cd /wt && HERDR_BROWSER_TASK='dev#6' claude --resume S1 'Herdr restarted"), self.sent)


class AutomationFromAnotherMachine(unittest.TestCase):
    """SHEP-14: an automation on machine A hears task events in a folder on machine B (--from). Two
    linked machines, simulated: B is a real herdr-task process on its own task store (asked as
    `herdr-task --on vmb auto feed` would ask it, its hc a fake that knows no terminals); A runs the
    scheduler's real round on another store. Only starting agents and the other passes are mocked."""

    def setUp(self):
        import argparse
        import contextlib
        import io
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.automations as au
        import herdr_task.store as store
        import herdr_task.settings as settings
        import herdr_task.machines as machines
        import herdr_task.home as home
        import herdr_task.autopilot as ap
        self.au, self.argparse, self.io, self.redirect = au, argparse, io, contextlib.redirect_stdout
        self.tmp = tempfile.mkdtemp()
        self.a_store, self.b_store = os.path.join(self.tmp, "a-tasks"), os.path.join(self.tmp, "b-tasks")
        self.a_folder, self.b_folder = os.path.join(self.tmp, "a-app"), os.path.join(self.tmp, "shepherdr")
        for f in (self.a_folder, self.b_folder):
            os.makedirs(f)
            subprocess.run(["git", "init", "-q", f], check=True)
        os.makedirs(self.b_store)
        fakebin = os.path.join(self.tmp, "bin")
        os.makedirs(fakebin)
        with open(os.path.join(fakebin, "hc"), "w") as f:
            f.write("#!/bin/sh\nexit 1\n")
        os.chmod(os.path.join(fakebin, "hc"), 0o755)
        self.b_env = {**os.environ, "HERDR_TASK_STORE": self.b_store, "PATH": fakebin + os.pathsep + os.environ.get("PATH", ""),
                      "HERDR_TASK_SETTINGS": os.path.join(self.tmp, "b-settings.json")}
        self.b_tasks, self.b_up, self.started = [], True, []
        self.write_b()
        real_run = subprocess.run

        def run(argv, **kw):
            # A's `herdr-task --on vmb ...`: answered by B's own herdr-task, or not at all while B is down.
            if "--on" in argv and argv[argv.index("--on") + 1] == "vmb":
                if not self.b_up:
                    return subprocess.CompletedProcess(argv, 1, "", "hc: vmb: connection refused\n")
                rest = argv[argv.index("--on") + 2:]
                # on this run's throwaway HOME herdr-task refuses hc (base.not_real): B's hc is a fake, so let it
                b = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                     "import herdr_task.base as base; base.not_real = lambda: None;"
                     "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')")
                return real_run([sys.executable, "-c", b, BIN, os.path.join(BIN, "herdr-task"), *rest], env=self.b_env, **kw)
            return real_run(argv, **kw)

        def begin(s, t, argv, space, parent=None):
            t["state"], t["started"] = "running", 1
            self.started.append({"ref": s.ref(t), "prompt": t["prompt"]})

        patches = [mock.patch.object(store, "STORE", self.a_store), mock.patch.object(au, "STORE", self.a_store),
                   mock.patch.object(au, "SEEN", os.path.join(self.a_store, ".seen.json")),
                   mock.patch.object(settings, "SETTINGS", os.path.join(self.tmp, "a-settings.json")),
                   mock.patch.object(au.subprocess, "run", run), mock.patch.object(au, "guard", lambda a: None),
                   mock.patch.object(au, "begin", begin), mock.patch.object(au, "queue_reason", lambda s, t: None),
                   mock.patch.object(au, "worker_argv", lambda s, t, space: ["claude"]),
                   mock.patch.object(au, "ensure_scheduler", lambda quiet=False: {}),
                   mock.patch.object(au, "default_space", lambda: "sp1"),
                   mock.patch.object(au, "live_agents", lambda key: []),
                   mock.patch.object(machines, "connected_machines", lambda: [{"name": "vmb", "state": "connected"}]),
                   mock.patch.object(ap, "autopilot_pass", lambda r: None), mock.patch.object(home, "home_pass", lambda r: None),
                   mock.patch.dict(os.environ, {"HC_TERMINAL_ID": ""})]
        patches += [mock.patch.object(au, n, lambda *a, **k: None) for n in (
            "tick_store", "retry_pass", "archive_pass", "news_pass", "end_done_pass", "memory_guard", "backup_pass",
            "cli_check_pass", "machines_pass")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def write_b(self):
        """B's task list as its own herdr-task keeps it."""
        from_b = {"version": 1, "folder": self.b_folder, "kind": "repo", "name": "shepherdr", "prefix": "SHEP",
                  "next": len(self.b_tasks) + 1, "tasks": self.b_tasks}
        slug = self.b_folder.strip("/").replace("/", "-")
        with open(os.path.join(self.b_store, slug + ".json"), "w") as f:
            json.dump(from_b, f)

    def b_task(self, title, state="todo", **kw):
        self.b_tasks.append({"id": len(self.b_tasks) + 1, "title": title, "prompt": "", "mode": "worktree", "state": state,
                             "created": 1, "agents": [], **kw})
        self.write_b()

    def b_merge(self, n):
        t = self.b_tasks[n - 1]
        t.update(state="done", merged=True, done_at=2)
        self.write_b()

    def auto(self, sub, **kw):
        args = self.argparse.Namespace(auto=sub, folder=self.a_folder, json=True, id=None, title=None, prompt=None,
                                       prompt_file=None, every=None, on=None, match=None, agent=None, space=None,
                                       parent=None, here=False, worktree=False, from_=None, skill="hc-build")
        for k, v in kw.items():
            setattr(args, k, v)
        out = self.io.StringIO()
        with self.redirect(out):
            self.au.cmd_auto(args)
        return json.loads(out.getvalue())

    def round(self):
        """One scheduler round on A; each round reads all it knows from disk (a restart loses nothing)."""
        report = {"started": [], "done": [], "attention": [], "fired": []}
        self.au.one_pass(report)
        return report["fired"]

    def test_a_merge_on_b_starts_one_run_on_a(self):
        self.b_task("Fix the scheduler")
        self.b_task("Write docs")
        a = self.auto("add", title="Update Shepherdr everywhere", prompt="Update every machine.", on="merged",
                      from_=f"vmb:{self.b_folder}")
        self.assertEqual(a["from"], f"vmb:{self.b_folder}")
        self.assertIn(f"When a task is merged in vmb:{self.b_folder}", a["trigger"])
        self.assertNotIn("warning", a)
        self.assertEqual(self.round(), [])  # nothing happened on B yet
        self.b_merge(1)
        fired = self.round()
        self.assertEqual([f["why"] for f in fired], ["merged: vmb:SHEP-1"])
        self.assertEqual(len(self.started), 1)
        brief = self.started[0]["prompt"]
        self.assertTrue(brief.startswith("Update every machine."))
        for words in ("SHEP-1", "Fix the scheduler", "vmb"):
            self.assertIn(words, brief)
        # Rounds again, and A's scheduler restarted (a round keeps nothing in memory): no second run.
        self.assertEqual(self.round() + self.round(), [])
        self.assertEqual(len(self.started), 1)
        # auto show and list say where it listens
        shown = self.auto("show", id="1")
        self.assertEqual(shown["from"], f"vmb:{self.b_folder}")
        self.assertEqual(shown["runs"][-1]["from"], f"vmb:{self.b_folder}")

    def test_missed_while_down_is_caught_up_once(self):
        self.b_task("Fix one")
        self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.round()
        # B can't be reached: its merges meanwhile wait, and nothing fires
        self.b_up = False
        self.b_merge(1)
        self.b_task("Fix two", state="done", merged=True)  # added and merged while unseen
        self.assertEqual(self.round(), [])
        self.assertIn("Couldn't ask vmb", self.auto("show", id="1")["last_error"]["message"])
        # B is back: each merge fires once, the error goes
        self.b_up = True
        self.assertEqual(sorted(f["why"] for f in self.round()), ["merged: vmb:SHEP-1", "merged: vmb:SHEP-2"])
        self.assertEqual(self.round(), [])
        self.assertIsNone(self.auto("show", id="1")["last_error"])
        # A was down (no rounds) while B merged another: once, on A's next round
        self.b_task("Fix three")
        self.round()
        self.b_merge(3)
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-3"])
        self.assertEqual(self.round(), [])
        self.assertEqual(len(self.started), 3)

    def test_match_still_narrows(self):
        self.b_task("Fix the scheduler")
        self.b_task("Write docs")
        self.auto("add", title="Update", prompt="Go.", on="merged", match="fix", from_=f"vmb:{self.b_folder}")
        self.b_merge(2)
        self.assertEqual(self.round(), [])
        self.b_merge(1)
        self.assertEqual([f["why"] for f in self.round()], ["merged: vmb:SHEP-1"])

    def test_other_events_too(self):
        self.auto("add", title="Look", prompt="Look.", on="added,ready", from_=f"vmb:{self.b_folder}")
        self.b_task("New thing")
        self.assertEqual([f["why"] for f in self.round()], ["added: vmb:SHEP-1"])
        self.b_tasks[0]["state"] = "ready"
        self.write_b()
        self.assertEqual([f["why"] for f in self.round()], ["ready: vmb:SHEP-1"])

    def test_unknown_or_unreachable_machine(self):
        with self.assertRaises(self.au.Fail) as e:
            self.auto("add", title="Update", prompt="Go.", on="merged", from_="vm-nope:/home/x/app")
        self.assertIn("No machine vm-nope", str(e.exception))
        with self.assertRaises(self.au.Fail):
            self.auto("add", title="Update", prompt="Go.", from_=f"vmb:{self.b_folder}")  # no --on
        self.b_up = False
        a = self.auto("add", title="Update", prompt="Go.", on="merged", from_=f"vmb:{self.b_folder}")
        self.assertIn("couldn't ask vmb", a["warning"])
        # its first answer is its first look: from then on every merge is news
        self.b_task("Fix")
        self.b_up = True
        self.assertEqual(self.round(), [])
        self.b_merge(1)
        self.assertEqual(len(self.round()), 1)


class LostLogs(unittest.TestCase):
    """SHEP-26: a task agent that ended before any pass saw its session (a short automation run) gets
    its log found afterwards, so its chat reads back once its terminal is gone. A throwaway HOME
    with Claude Code and Codex logs; nothing is run."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.sessions as sessions
        import herdr_task.tick as tick
        self.sessions, self.tick = sessions, tick
        self.home = tempfile.mkdtemp()
        p = mock.patch.object(sessions, "HOME", self.home)
        p.start()
        self.addCleanup(p.stop)
        self.folder = "/Users/me"
        self.at = 1793873842495  # the agent's launch (ms)

    def stamp(self, ms):
        import datetime
        return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    def claude_log(self, sid, at, first, folder=None):
        d = self.sessions.project_dir(folder or self.folder)
        os.makedirs(d, exist_ok=True)
        f = os.path.join(d, sid + ".jsonl")
        with open(f, "w") as fh:
            fh.write(json.dumps({"type": "mode", "mode": "normal", "sessionId": sid}) + "\n")
            fh.write(json.dumps({"type": "user", "timestamp": self.stamp(at), "sessionId": sid, "message": {"role": "user", "content": first}}) + "\n")
            fh.write(json.dumps({"type": "assistant", "timestamp": self.stamp(at + 2000), "message": {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}}) + "\n")
        return f

    def store(self, task):
        class S:
            dirty = False
            loc = {"folder": self.folder}
            def ref(self, t): return "ELIA-5"
        return S()

    def test_an_ended_agent_without_a_session_gets_the_log_that_names_its_task(self):
        # the Home Assistant's own session in the same folder (started earlier), another task's run after, and its own
        self.claude_log("assistant", self.at - 3600000, "You are the coordinator of one space in Herdr")
        self.claude_log("other", self.at + 5000, "Your task, ELIA-50:\nSomething else")
        mine = self.claude_log("mine", self.at + 1500, [{"type": "text", "text": "You work on one Herdr task.\n\nYour task, ELIA-5:\nSay hi"}])
        t = {"id": 5, "state": "done", "done_at": self.at + 14268, "ended_at": self.at + 81555,
             "agents": [{"address": "t1h", "agent": "claude", "argv": ["claude"], "at": self.at, "parent": "t13", "ended": self.at + 81555}]}
        self.assertTrue(self.tick.lost_log(t, t["agents"][0]))
        s = self.store(t)
        self.sessions.find_lost_logs(s, t)
        self.assertEqual(t["agents"][0]["log"], mine)
        self.assertTrue(s.dirty)
        # looked for once: never again
        self.assertFalse(self.tick.lost_log(t, t["agents"][0]))

    def test_by_its_session_when_it_has_one(self):
        mine = self.claude_log("S9", self.at, "anything", folder="/elsewhere")
        t = {"id": 5, "state": "done", "agents": [{"address": "t1", "agent": "claude", "session": "S9", "at": self.at, "ended": self.at + 1}]}
        self.sessions.find_lost_logs(self.store(t), t)
        self.assertEqual(t["agents"][0]["log"], mine)

    def test_a_codex_rollout(self):
        import datetime
        day = datetime.date.fromtimestamp(self.at / 1000)
        d = os.path.join(self.home, ".codex", "sessions", f"{day:%Y}", f"{day:%m}", f"{day:%d}")
        os.makedirs(d)
        f = os.path.join(d, "rollout-2026-11-05T10-00-00-0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl")
        with open(f, "w") as fh:
            fh.write(json.dumps({"timestamp": self.stamp(self.at + 800), "type": "session_meta", "payload": {"id": "x", "timestamp": self.stamp(self.at + 800), "cwd": self.folder}}) + "\n")
            fh.write(json.dumps({"timestamp": self.stamp(self.at + 900), "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "<environment_context>…</environment_context>"}]}}) + "\n")
            fh.write(json.dumps({"timestamp": self.stamp(self.at + 900), "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Your task, ELIA-5:\nSay hi"}]}}) + "\n")
        t = {"id": 5, "state": "done", "agents": [{"address": "t1", "agent": "codex", "at": self.at, "ended": self.at + 60000}]}
        self.sessions.find_lost_logs(self.store(t), t)
        self.assertEqual(t["agents"][0]["log"], f)

    def test_no_log_left_is_looked_for_once_and_stays_none(self):
        self.claude_log("before", self.at - 7200000, "Your task, ELIA-5:\nan older run")  # started long before this agent
        t = {"id": 5, "state": "done", "agents": [{"address": "t1", "agent": "claude", "at": self.at, "ended": self.at + 60000}]}
        self.sessions.find_lost_logs(self.store(t), t)
        self.assertNotIn("log", t["agents"][0])
        self.assertTrue(t["agents"][0]["log_looked"])
        self.assertFalse(self.tick.lost_log(t, t["agents"][0]))

    def test_a_running_agent_is_left_to_the_session_pass(self):
        t = {"id": 5, "state": "running", "agents": [{"address": "t1", "agent": "claude", "at": self.at}]}
        self.assertFalse(self.tick.lost_log(t, t["agents"][0]))


class AgentReactions(unittest.TestCase):
    """SHEP-48: Reactions for every agent: a task worker, an automation's run and a plain agent tab are
    told by their space at the start (no settings block), and a running one its hook taught gets one
    <herdr-setting name="reactions"> line when it changes, telling it to carry on. A throwaway settings
    file and state; hc is faked (its terminals are dicts), nothing is sent."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.settings as settings
        import herdr_task.reactions as reactions
        import herdr_task.assistant_settings as aset
        import herdr_task.news as news
        self.settings, self.reactions, self.aset = settings, reactions, aset
        self.dir = tempfile.mkdtemp()
        self.file = os.path.join(self.dir, "shepherdr.json")
        self.terminals, self.sent = {}, []

        def hc_json(*args):
            if args[0] == "ls":  # hc ls --label herdr.reactions=<v>
                k, v = args[2].split("=", 1)
                return {"terminals": [{"address": a, "state": t["state"]} for a, t in self.terminals.items()
                                      if (t.get("labels") or {}).get(k) == v]}
            return self.terminals.get(args[1]) if args[0] == "get" else None

        def run(args, **_):
            if args[:2] == ["hc", "label"]:
                k, v = args[3].split("=", 1)
                t = self.terminals[args[2]]
                t["labels"] = {**(t.get("labels") or {}), k: v}
            return subprocess.CompletedProcess(args, 0, "", "")

        for target, name, value in [
            (settings, "SETTINGS", self.file), (reactions, "SETTINGS", self.file),
            (reactions, "STATE", os.path.join(self.dir, ".reactions.json")),
            (reactions, "hc_json", hc_json), (aset, "hc_json", hc_json), (reactions, "run", run), (aset, "run", run),
            (reactions, "addon_off", lambda name: False),
            (news, "news_send", lambda addr, text: self.sent.append((addr, text)) or True),
        ]:
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def write(self, d):
        with open(self.file, "w") as f:
            json.dump(d, f)
        self.saves = getattr(self, "saves", 0) + 1
        os.utime(self.file, (1700000000 + self.saves, 1700000000 + self.saves))

    def worker(self, addr="t9", space="sp1", turn=3, **labels):
        """A task's agent (a worker, or an automation's run): its task's space on its terminal."""
        self.terminals[addr] = {"state": "live", "turn": turn, "cwd": "/wt/task-1", "labels": {"herdr.task": "dev#1", "herdr.task.space": space, **labels}}

    def test_every_agent_type_is_told_by_its_space(self):
        """A task worker and an automation's run (their task's space), a plain agent tab (the space whose folder
        holds its folder, else Everywhere's): the Assistant's Reactions words, on and off, without its block."""
        self.worker("t9", "sp2")
        self.worker("t10", "sp1", **{"herdr.task": "dev#auto-3"})
        self.terminals["t11"] = {"state": "live", "cwd": "/repos/shop/web", "labels": {}}
        self.terminals["t12"] = {"state": "live", "cwd": "/elsewhere"}
        self.write({"spaces": {"sp2": {"agents": {"reactions": False}}, "sp4": {"folder": "/repos/shop", "agents": {"reactions": False}}}})
        notes = {a: self.aset.session_note(a) for a in ("t9", "t10", "t11", "t12")}
        from herdr_task.feedback import AGENT_NOTE
        fb = "\n" + AGENT_NOTE  # Feedback offers (SHEP-78), on by default
        self.assertEqual(notes, {"t9": self.reactions.OFF + fb, "t10": self.reactions.GUIDE + fb, "t11": self.reactions.OFF + fb, "t12": self.reactions.GUIDE + fb})
        self.assertEqual([self.terminals[a]["labels"]["herdr.reactions"] for a in ("t9", "t10", "t11", "t12")], ["off", "on", "off", "on"])
        self.write({"everywhere": {"agents": {"reactions": False}}})
        for a in ("t9", "t10", "t11", "t12"):
            self.assertIn("never react", self.aset.session_note(a))
        for words in ("👀", "👍", "✅", "😂", "🙏", "<hc react=", "never more than one", "never instead of an answer", "<hc no-reply/>", "In to=, leave out double quotes",
                      "most specific, delightful or funny emoji", "not a generic 👍 or 👀 by default", "🚀", "🔥", "🐛", "🧹", "🫡", "🤌", "🍿",
                      "Keep it tasteful", "most messages get none"):
            self.assertIn(words, self.reactions.GUIDE)
        # the turned-on notice carries the same guidance
        self.assertIn("most specific, delightful or funny emoji", self.reactions.TURNED_ON)

    def test_running_agents_of_every_type_are_told_once(self):
        """Workers, automation runs and agent tabs their hook taught are told once when it changes for their
        space, and told to carry on; one never taught (started before) and Assistants (the settings pass
        tells them) are left alone."""
        self.worker("t9", "sp1", **{"herdr.reactions": "on"})
        self.worker("t10", "sp2", **{"herdr.reactions": "on", "herdr.task": "dev#auto-3"})
        self.terminals["t11"] = {"state": "live", "turn": 2, "cwd": "/repos/shop", "labels": {"herdr.reactions": "on"}}
        self.worker("t12", "sp1")  # started before: no label
        self.terminals["t5"] = {"state": "live", "turn": 3, "labels": {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.reactions": "on"}}
        self.write({"spaces": {"sp1": {"agents": {"reactions": False}}, "sp4": {"folder": "/repos/shop", "agents": {"reactions": False}}}})
        report = {}
        self.reactions.reactions_pass(report, {})
        self.assertEqual(sorted(a for a, _ in self.sent), ["t11", "t9"])
        for _, w in self.sent:
            self.assertRegex(w, r'^<herdr-setting name="reactions" value="off" scope="space">Reactions are now off[^<]*'
                                r'<hc react> lines\)\. Nothing to answer: carry on with what you were doing; if nothing, reply only <hc no-reply/>\.</herdr-setting>$')
        self.assertEqual(self.terminals["t9"]["labels"]["herdr.reactions"], "off")
        self.assertEqual(self.terminals["t10"]["labels"]["herdr.reactions"], "on")
        self.assertNotIn("herdr.reactions", self.terminals["t12"]["labels"])
        self.assertEqual(self.terminals["t5"]["labels"]["herdr.reactions"], "on")
        self.reactions.reactions_pass({}, {})  # the file didn't change: nothing again
        self.write({"spaces": {"sp1": {"agents": {"reactions": False}}, "sp4": {"folder": "/repos/shop", "agents": {"reactions": False}}}, "tasks": {}})
        self.reactions.reactions_pass({}, {})
        self.assertEqual(len(self.sent), 2)
        self.write({})  # back on: each told again, with the how
        self.reactions.reactions_pass({}, {})
        self.assertEqual(sorted(a for a, _ in self.sent[2:]), ["t11", "t9"])
        self.assertIn('scope="everywhere">Reactions are now on', self.sent[2][1])
        self.assertIn("👀", self.sent[2][1])


class AssistantSettings(unittest.TestCase):
    """SHEP-42/SHEP-49: a space's Assistant is told its settings (Reactions among them): the block its
    session gets at the start, and the one message a running one gets when some change. A throwaway
    settings file and state; hc is faked (its terminals are dicts), nothing is sent."""

    def setUp(self):
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.settings as settings
        import herdr_task.assistant_settings as aset
        import herdr_task.news as news
        self.settings, self.aset, self.news = settings, aset, news
        self.dir = tempfile.mkdtemp()
        self.file = os.path.join(self.dir, "shepherdr.json")
        self.terminals, self.labelled, self.sent = {}, [], []
        self.auto = {}  # space -> (on, schedule, direction)

        def hc_json(*args):
            return self.terminals.get(args[1]) if args[0] == "get" else None

        def run(args, **_):
            if args[:2] == ["hc", "label"]:
                k, v = args[3].split("=", 1)
                self.terminals[args[2]].setdefault("labels", {})[k] = v
                self.labelled.append((args[2], args[3]))
            return subprocess.CompletedProcess(args, 0, "", "")

        for target, name, value in [
            (settings, "SETTINGS", self.file), (aset, "SETTINGS", self.file),
            (aset, "STATE", os.path.join(self.dir, ".assistant-settings.json")), (aset, "hc_json", hc_json),
            (aset, "run", run), (aset.reactions, "run", run), (aset, "addon_off", lambda name: False),
            (aset, "coordinators", lambda: list(self.terminals)),
            (aset, "autopilot_of", lambda space, cfg: self.auto.get(space, (False, "every 60 minutes", ""))),
            (news, "news_send", lambda addr, text: self.sent.append((addr, text)) or True),
        ]:
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def write(self, d):
        with open(self.file, "w") as f:
            json.dump(d, f)
        # a change the pass looks at at once (the file's time), as the window's or the web's save
        self.saves = getattr(self, "saves", 0) + 1
        os.utime(self.file, (1700000000 + self.saves, 1700000000 + self.saves))

    def assistant(self, addr="t5", space="sp1", turn=3, **labels):
        self.terminals[addr] = {"state": "live", "turn": turn, "labels": {"herdr.role": "coordinator", "herdr.space": space, **labels}}

    def line(self, note, label):
        return next(x for x in note.split("\n") if x.startswith(f"- {label}: "))

    def test_reactions_on_by_default_everywhere_and_a_space_sets_its_own(self):
        self.assertTrue(self.settings.DEFAULTS["agents"]["reactions"])
        self.assertTrue(self.settings.reactions_on("sp1"))
        self.write({"everywhere": {"agents": {"reactions": False}}, "spaces": {"sp2": {"agents": {"reactions": True}}}})
        self.assertFalse(self.settings.reactions_on("sp1"))
        self.assertTrue(self.settings.reactions_on("vm/sp2"))
        self.assertFalse(self.settings.reactions_on(None))

    def test_the_assistants_reactions_from_before_still_apply(self):
        """SHEP-48: SHEP-42 kept it as assistant.reactions: read where a layer has no agents.reactions (the
        window and the web app move it on their next change), in reactions_on and the Assistant's block."""
        self.write({"everywhere": {"assistant": {"reactions": False}}, "spaces": {"sp2": {"assistant": {"reactions": True}},
                                                                                 "sp3": {"assistant": {"reactions": True}, "agents": {"reactions": False}}}})
        self.assertFalse(self.settings.reactions_on("sp1"))
        self.assertTrue(self.settings.reactions_on("sp2"))
        self.assertFalse(self.settings.reactions_on("sp3"))
        self.assistant("t5", "sp2")
        self.assertIn("- Reactions: on", self.aset.session_note("t5"))
        self.assistant("t6", "sp3")
        self.assertIn("- Reactions: off (never react to the person's messages); set for this space", self.aset.session_note("t6"))
        self.write({"everywhere": {"assistant": {"reactions": False}, "agents": {"reactions": True}}})
        self.assertTrue(self.settings.reactions_on("sp1"))

    def test_the_block_by_default(self):
        self.assistant()
        note = self.aset.session_note("t5")
        self.assertTrue(note.startswith("Your settings: "))
        for label, words in [("Review", "off"), ("Merge", "ask the person first"), ("Proof", "on"), ("Task agent", "claude"),
                             ("Base branch", "the folder's checked-out branch"), ("Worktrees", "on"), ("Tasks at once", "10 per folder"),
                             ("Task notes", "none"), ("Autopilot", "off"), ("Reactions", "on"),
                             ("Feedback offers", "on (offer once to file a BossGoat problem as an issue on NeuralHerd/BossGoat")]:
            self.assertTrue(self.line(note, label).startswith(f"- {label}: {words}"), self.line(note, label))
        # nothing differs from Herdr's default: no line says who set it
        self.assertNotIn("; set for", note)
        self.assertNotIn("; your setting", note)
        self.assertEqual(len(note.split("\n")), 15)  # head, 13 lines (HolyCow and Suggested next message included), the Reactions guide
        self.assertIn("- Suggested next message: on (end each reply", note)

    def test_the_block_for_a_space_with_its_own(self):
        self.write({"everywhere": {"tasks": {"review_rounds": 2, "merge": "checks"}, "assistant": {"reactions": True}},
                    "spaces": {"sp1": {"tasks": {"base": "dev", "start_notes": "bun install", "max_running": 3, "worktrees": False},
                                       "worker": {"agent": "codex", "model": "gpt-5", "effort": "high"},
                                       "reviewer": {"agent": "claude", "model": "opus"},
                                       "assistant": {"reactions": False}},
                               "sp2": {"tasks": {"merge": "auto"}}}})
        self.auto["sp1"] = (True, "every 30 minutes", "Ship the beta")
        self.assistant()
        note = self.aset.session_note("t5")
        self.assertEqual(self.line(note, "Review"), "- Review: on, at most 2 rounds, must fix major and up (blocker, major), reviewer claude, model opus; set for this space")
        self.assertEqual(self.line(note, "Merge"), "- Merge: after checks (Herdr merges a ready task once its checks pass); your setting everywhere")
        self.assertEqual(self.line(note, "Proof"), "- Proof: on")
        self.assertEqual(self.line(note, "Task agent"), "- Task agent: codex, model gpt-5, effort high; set for this space")
        self.assertIn("- Base branch: dev ", note)
        self.assertIn("- Worktrees: off (tasks work in the folder itself); set for this space", note)
        self.assertIn("- Tasks at once: 3 per folder", note)
        self.assertIn("- Task notes: start notes set", note)
        self.assertEqual(self.line(note, "Autopilot"), "- Autopilot: on, every 30 minutes, direction: Ship the beta; set for this space")
        self.assertIn("- Reactions: off", note)
        self.assertIn("never react", note.split("\n")[-1])
        self.assertNotIn("👀", note)
        labels = self.terminals["t5"]["labels"]
        self.assertEqual(labels["herdr.reactions"], "off")
        self.assertEqual(sorted(self.aset.parse(labels["herdr.settings"])),
                         sorted(["holycow", "review", "merge", "proof", "agent", "base", "worktrees", "max_running", "notes", "autopilot", "reactions", "suggestions", "feedback"]))
        # another space inherits Everywhere's, with its own merge
        self.assistant("t6", "sp2")
        other = self.aset.session_note("t6")
        self.assertIn("- Merge: on its own (Herdr merges a ready task); set for this space", other)
        self.assertIn("- Reactions: on", other)
        self.assertIn("👀", other)

    def test_only_assistants_get_the_block_other_agents_reactions_only(self):
        self.terminals["t9"] = {"state": "live", "labels": {"herdr.task": "SHEP-1"}}
        note = self.aset.session_note("t9")
        self.assertNotIn("Your settings", note)
        from herdr_task.feedback import AGENT_NOTE
        self.assertEqual(note, self.aset.reactions.GUIDE + "\n" + AGENT_NOTE)  # and Feedback (SHEP-78), on by default
        self.assertEqual(self.terminals["t9"]["labels"], {"herdr.task": "SHEP-1", "herdr.reactions": "on"})
        self.assertEqual(self.aset.session_note("nope"), "")  # not a terminal here

    def test_the_hook_text_is_json_ready(self):
        import contextlib
        import io
        self.assistant()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.aset.cmd_session_note(type("A", (), {"terminal": "t5"})())
        ctx = json.loads('{"c":"base.' + out.getvalue() + '"}')["c"]
        self.assertTrue(ctx.startswith("base. Your settings: "))
        self.assertIn("\n- Review: off\n", ctx)
        self.assertIn('<hc react="👀"', ctx)

    def test_a_running_assistant_is_told_once_what_changed_in_one_message(self):
        self.assistant()
        self.aset.session_note("t5")
        quiet = {}
        self.aset.settings_pass({}, quiet)
        self.assertEqual(self.sent, [])  # told at its start already
        self.write({"everywhere": {"tasks": {"review_rounds": 3}}, "spaces": {"sp1": {"assistant": {"reactions": False}}}})
        report = {}
        self.aset.settings_pass(report, quiet)
        self.assertEqual(len(self.sent), 1)
        lines = self.sent[0][1].split("\n")
        self.assertEqual(len(lines), 2)
        self.assertRegex(lines[0], r'^<herdr-setting name="review" value="on" scope="everywhere">Review is now on, at most 3 rounds[^<]*'
                                   r'; your setting everywhere\. Tasks you add from now on get it; running ones keep their brief\.</herdr-setting>$')
        self.assertRegex(lines[1], r'^<herdr-setting name="reactions" value="off" scope="space">Reactions are now off[\s\S]*<hc no-reply/>\.</herdr-setting>$')
        self.assertEqual(report["settings"], [{"to": "t5", "changed": ["review", "reactions"]}])
        self.assertEqual(self.terminals["t5"]["labels"]["herdr.reactions"], "off")

    def test_a_save_that_changes_nothing_for_it_says_nothing(self):
        self.write({"everywhere": {"tasks": {"merge": "checks"}}})
        self.assistant()
        self.aset.session_note("t5")
        # the same values saved again
        self.write({"everywhere": {"tasks": {"merge": "checks"}}})
        self.aset.settings_pass({}, {})
        # another space's change, and Everywhere's where this space sets its own
        self.write({"everywhere": {"tasks": {"merge": "checks"}}, "spaces": {"sp2": {"tasks": {"merge": "auto"}}}})
        self.aset.settings_pass({}, {})
        self.write({"everywhere": {"tasks": {"merge": "checks"}, "worker": {"agent": "codex"}},
                    "spaces": {"sp1": {"worker": {"agent": "claude", "model": "opus"}}}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 1)  # only the last: sp1's own agent
        self.assertIn('name="agent" value="claude/opus" scope="space"', self.sent[0][1])
        self.write({"everywhere": {"tasks": {"merge": "checks"}, "worker": {"agent": "codex"}},
                    "spaces": {"sp1": {"worker": {"agent": "claude", "model": "opus"}}}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 1)

    def test_back_to_the_default_says_so(self):
        self.write({"everywhere": {"tasks": {"proof": False}}})
        self.assistant()
        self.aset.session_note("t5")
        self.write({})
        self.aset.settings_pass({}, {})
        self.assertIn('<herdr-setting name="proof" value="on" scope="everywhere">Proof is now on; Herdr\'s default.', self.sent[0][1])

    def test_one_started_before_gets_the_whole_block_once_it_has_had_a_turn(self):
        self.assistant("t5", "sp1", **{"herdr.reactions": "on"})
        self.assistant("t6", "sp2")
        self.assistant("t7", "sp1", turn=0)  # just started: its hook tells it
        self.write({"spaces": {"sp2": {"assistant": {"reactions": True}}}})
        self.aset.settings_pass({}, {})
        self.assertEqual([a for a, _ in self.sent], ["t5", "t6"])
        self.assertTrue(self.sent[0][1].startswith('<herdr-setting name="all">Your settings: '))
        self.assertNotIn("👀", self.sent[0][1])  # taught reactions already
        self.assertIn("👀", self.sent[1][1])
        self.assertNotIn("herdr.settings", self.terminals["t7"]["labels"])
        self.write({"spaces": {"sp2": {"assistant": {"reactions": True}}}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 2)

    def test_busy_with_the_person_tries_again_next_time(self):
        from unittest import mock
        self.assistant()
        self.aset.session_note("t5")
        self.write({"everywhere": {"tasks": {"merge": "auto"}}})
        with mock.patch.object(self.news, "news_send", lambda addr, text: False):
            self.aset.settings_pass({}, {})
        self.write({"everywhere": {"tasks": {"merge": "auto"}}})
        self.aset.settings_pass({}, {})
        self.assertEqual(len(self.sent), 1)
        self.assertIn('name="merge" value="auto"', self.sent[0][1])

    def test_chat_tags_hide_the_message(self):
        """Every line is one <herdr-…> tag: the chat shows nothing of it (core/chat-log.js strips Herdr's tags)."""
        rs = self.aset.rows("sp1", {}, (False, "", ""))
        for line in self.aset.notice(rs).split("\n"):
            self.assertRegex(line, r'^<herdr-setting name="\w+" value="[^"]*" scope="\w+">[^\n]*</herdr-setting>$')


class StarPrompt(unittest.TestCase):
    """SHEP-79: the one-time "Enjoying Shepherdr?" card (herdr_task/star.py), in throwaway settings files and task
    lists: herdr-artifact is faked, and nothing else may run."""

    def setUp(self):
        import contextlib
        import io
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.settings as settings
        import herdr_task.star as star
        self.star, self.io, self.redirect, self.mock = star, io, contextlib.redirect_stdout, mock
        self.tmp = tempfile.mkdtemp()
        self.use(os.path.join(self.tmp, "a.json"))
        self.done = 3
        self.runs = []
        for obj, name, value in ((star, "done_count", lambda: self.done), (star.subprocess, "run", self.fake_run)):
            p = mock.patch.object(obj, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.settings = settings

    def use(self, path):
        """One machine's settings file (each machine reads its own copy)."""
        import herdr_task.settings as settings
        if hasattr(self, "_p"):
            self._p.stop()
        self._p = self.mock.patch.object(settings, "SETTINGS", path)
        self._p.start()
        self.addCleanup(self._p.stop)
        self.path = path

    def fake_run(self, argv, **kw):
        # only herdr-artifact publish, with the card's recipe
        self.assertEqual(argv[:2], ["herdr-artifact", "publish"], argv)
        with open(os.path.join(argv[2], "recipe.json")) as f:
            self.runs.append(json.load(f))
        return subprocess.CompletedProcess(argv, 0, json.dumps({"id": f"a{len(self.runs)}"}), "")

    def cmd(self, sub, **kw):
        import argparse
        args = argparse.Namespace(star=sub, json=True, folder=None, **kw)
        out = self.io.StringIO()
        with self.redirect(out):
            self.star.cmd_star(args)
        return json.loads(out.getvalue())

    def saved(self):
        with open(self.path) as f:
            return json.load(f)["everywhere"]["star_prompt"]

    def test_asks_once_ever_and_records_before_showing(self):
        self.assertTrue(self.cmd("check")["can"])
        seen = {}
        real_publish = self.star.publish

        def publish(folder):
            seen["asked_first"] = bool(self.saved().get("asked"))
            return real_publish(folder)
        with self.mock.patch.object(self.star, "publish", publish):
            r = self.cmd("ask")
        self.assertEqual(r, {"asked": True, "artifact": "a1"})
        self.assertTrue(seen["asked_first"], "the ask is kept before the card shows")
        self.assertEqual(len(self.runs), 1)
        # a restart, or another Assistant: never again, whatever the answer
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        self.cmd("answer", answer="no")
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        self.assertFalse(self.cmd("check")["can"])
        self.assertEqual(len(self.runs), 1)
        self.assertEqual(self.saved()["answer"], "no")

    def test_another_machine_never_asks_again(self):
        self.cmd("ask")
        # the settings file reaches the other machine (the web host's sync, the window's push): the same Everywhere
        with open(self.path) as f:
            synced = json.load(f)
        other = os.path.join(self.tmp, "b.json")
        with open(other, "w") as f:
            json.dump(synced, f)
        self.use(other)
        self.assertFalse(self.cmd("check")["can"])
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        self.assertEqual(len(self.runs), 1)

    def test_a_pushed_copy_never_asks(self):
        with open(self.path, "w") as f:
            json.dump({"pushed_from": "herdr-app", "here": "vm-b", "everywhere": {}}, f)
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        self.assertEqual(self.runs, [])

    def test_off_switch_and_too_early(self):
        with open(self.path, "w") as f:
            json.dump({"everywhere": {"star_prompt": {"off": True}}}, f)
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        with open(self.path, "w") as f:
            json.dump({}, f)
        self.done = 2
        with self.assertRaises(self.star.Fail):
            self.cmd("ask")
        self.assertEqual(self.runs, [])

    def test_never_stars_for_the_person(self):
        """The card is a plain link to the repo; nothing calls GitHub (no gh, no API, no starring)."""
        self.cmd("ask")
        blocks = self.runs[0]["blocks"]
        items = next(b for b in blocks if b["type"] == "buttons")["items"]
        self.assertEqual(items[0]["href"], "https://github.com/NeuralHerd/BossGoat")
        self.assertEqual([x["label"] for x in items], ["Open BossGoat on GitHub", "No thanks"])
        with open(os.path.join(BIN, "herdr_task", "star.py")) as f:
            src = f.read()
        for word in ("api.github.com", "user/starred", '"gh"', "urllib", "PUT"):
            self.assertNotIn(word, src)

    def test_the_card_is_a_valid_recipe(self):
        """herdr-artifact's own check takes the card (buttons with an https href)."""
        import importlib.machinery
        import importlib.util
        path = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
        loader = importlib.machinery.SourceFileLoader("herdr_artifact_mod", path)
        spec = importlib.util.spec_from_loader("herdr_artifact_mod", loader)
        art = importlib.util.module_from_spec(spec)
        loader.exec_module(art)
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "recipe.json"), "w") as f:
            json.dump(self.star.card(), f)
        self.assertEqual(art.recipe_problems(d, ["recipe.json"]), [])
        bad = {"recipe": 1, "blocks": [{"type": "buttons", "items": [{"label": "x", "href": "javascript:alert(1)"}]}]}
        with open(os.path.join(d, "recipe.json"), "w") as f:
            json.dump(bad, f)
        self.assertTrue(art.recipe_problems(d, ["recipe.json"]))


class Feedback(unittest.TestCase):
    """SHEP-78: an agent's report of a problem in Shepherdr itself returns at once and reaches its
    Assistant as a feedback news line; the Assistant offers once per problem, remembers the
    person's No, searches for a duplicate before filing and files a redacted issue. A throwaway
    store and settings file; hc and gh are faked, nothing is sent or filed. Made-up names only."""

    def setUp(self):
        import io
        from unittest import mock
        sys.path.insert(0, BIN)
        import herdr_task.cli as cli
        import herdr_task.feedback as fb
        import herdr_task.launch as launch
        import herdr_task.settings as settings
        self.cli, self.fb, self.io, self.mock = cli, fb, io, mock
        self.queue = fb.queue_news  # the real one (faked below)
        self.dir = tempfile.mkdtemp()
        self.file = os.path.join(self.dir, "shepherdr.json")
        self.held, self.gh, self.issues = [], [], []
        self.caller = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp1", "herdr.agent": "codex"}, "name": "shep-7-fix"}
        with open(os.path.join(self.dir, "dev.json"), "w") as f:
            json.dump({"prefix": "SHEP", "tasks": [{"id": 7, "title": "Fix login"}]}, f)

        def run(args, **_):
            self.gh.append(args)
            if args[1:3] == ["issue", "list"]:
                return subprocess.CompletedProcess(args, 0, json.dumps(self.issues), "")
            if "--body-file" in args:
                with open(args[args.index("--body-file") + 1]) as f:
                    self.body = f.read()
                return subprocess.CompletedProcess(args, 0, "https://github.com/acme/shep/issues/42\n", "")
            return subprocess.CompletedProcess(args, 1, "", "unexpected")

        for target, name, value in [
            (settings, "SETTINGS", self.file), (fb, "STATE", os.path.join(self.dir, ".feedback.json")), (fb, "STORE", self.dir),
            (fb, "me", lambda: ("t9", self.caller)), (fb, "run", run), (fb, "cli_version", lambda agent: "0.9.1"),
            (fb, "private_words", lambda: ["Jane Doe", "Jane", "janes-box"]), (fb, "shepherdr_version", lambda: "3.1.12"),
            (launch, "caller_space", lambda: (self.caller.get("labels") or {}).get("herdr.task.space") or (self.caller.get("labels") or {}).get("herdr.space")),
            (launch, "coordinator_in", lambda space: "t5" if space == "sp1" else None),
            (fb, "queue_news", lambda to, text: self.held.append((to, text, "news"))),
        ]:
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def settings(self, d):
        with open(self.file, "w") as f:
            json.dump(d, f)

    def assistant(self):
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.agent": "claude"}, "name": "assistant"}

    def say(self, *argv):
        import contextlib
        out, err = self.io.StringIO(), self.io.StringIO()
        with self.mock.patch.object(sys, "argv", ["herdr-task", "feedback", *argv]), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.cli.main()
        return code, out.getvalue() + err.getvalue()

    def test_a_report_returns_at_once_and_reaches_the_assistant(self):
        import time
        t = time.time()
        code, out = self.say("The Accept card shows an empty diff", "--details", "Goal: accept SHEP-7. Expected: its 3 files.")
        self.assertLess(time.time() - t, 2)
        self.assertEqual(code, 0)
        self.assertIn("Carry on", out)
        self.assertEqual(len(self.held), 1)
        to, text, how = self.held[0]
        self.assertEqual((to, how), ("t5", "news"))
        self.assertRegex(text, r'^<herdr-news task="SHEP-7" event="feedback" key="[0-9a-f]{10}">SHEP-7 feedback: The Accept card shows an empty diff · '
                               r'Goal: accept SHEP-7\. Expected: its 3 files\. \(Fix login\)</herdr-news>$')
        # the same problem again (other small words): nothing more is sent
        code, out = self.say("the accept card shows the empty diff")
        self.assertIn("already has this one", out)
        self.assertEqual(len(self.held), 1)

    def test_the_chat_reads_it_as_a_news_row(self):
        self.say("Status lines vanish after a restart")
        js = ("const m = await import(process.argv[1]); const t = process.argv[2];"
            "const r = [...t.matchAll(/<herdr-news\\b([^>]*)>([\\s\\S]*?)<\\/herdr-news\\s*>/g)].length;"
            "const w = (await import(process.argv[3])).newsWords({ ref: 'SHEP-7', event: 'feedback', text: t.replace(/<[^>]*>/g, '') }, { title: 'Fix login' });"
            "console.log(JSON.stringify([r, w]));")
        out = subprocess.run(["node", "--input-type=module", "-e", js, os.path.join(ROOT, "core", "chat-log.js"), self.held[0][1],
                              os.path.join(ROOT, "core", "chat-view.js")], capture_output=True, text=True)
        if out.returncode:
            self.skipTest(out.stderr[-300:])
        n, words = json.loads(out.stdout)
        self.assertEqual(n, 1)
        self.assertEqual(words, {"mark": "other", "what": "feedback", "text": "Status lines vanish after a restart"})

    def test_off_in_settings_sends_nothing(self):
        self.settings({"spaces": {"sp1": {"agents": {"feedback": False}}}})
        code, out = self.say("Status lines vanish after a restart")
        self.assertEqual((code, self.held), (0, []))
        self.assertIn("off in Settings", out)
        self.assistant()
        self.assertIn("off in Settings", self.say("Status lines vanish after a restart")[1])
        self.assertIn("off in Settings", self.say("Status lines vanish after a restart", "--file", "--new")[1])
        self.assertEqual(self.gh, [])
        # Everywhere off, the space on: on there
        self.settings({"everywhere": {"agents": {"feedback": False}}, "spaces": {"sp1": {"agents": {"feedback": True}}}})
        self.assertTrue(self.fb.feedback_on("sp1"))
        self.assertFalse(self.fb.feedback_on("sp2"))

    def test_offered_once_and_no_is_remembered(self):
        self.assistant()
        code, out = self.say("Ready refuses a reviewed commit")
        self.assertIn('"Leave feedback for BossGoat about Ready refuses a reviewed commit?"', out)
        self.assertIn("Already offered", self.say("ready refuses the reviewed commit")[1])
        self.assertIn("Remembered", self.say("Ready refuses a reviewed commit", "--no")[1])
        self.assertIn("said no", self.say("Ready refuses a reviewed commit")[1])
        self.caller = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp1"}}
        self.assertIn("said no", self.say("Ready refuses a reviewed commit")[1])
        self.assertEqual(self.held, [])

    def test_only_an_assistant_files(self):
        code, out = self.say("Ready refuses a reviewed commit", "--file")
        self.assertEqual(code, 1)
        self.assertIn("Only an Assistant", out)
        self.assertEqual(self.gh, [])

    def test_a_duplicate_is_offered_before_filing(self):
        self.assistant()
        self.issues = [{"number": 12, "title": "Ready refuses reviewed commits", "url": "https://github.com/acme/shep/issues/12"}]
        code, out = self.say("Ready refuses a reviewed commit", "--file", "--happened", "It said no round was recorded.")
        self.assertIn("#12 Ready refuses reviewed commits", out)
        self.assertIn("--comment", out)
        self.assertEqual([a[1:3] for a in self.gh], [["issue", "list"]])
        self.assertIn("NeuralHerd/BossGoat", self.gh[0])  # the default repo
        self.assertEqual(self.gh[0][self.gh[0].index("--search") + 1], "ready refuses reviewed commit")
        code, out = self.say("Ready refuses a reviewed commit", "--file", "--comment", "12", "--happened", "Again on 3.1.12.")
        self.assertEqual(self.gh[-1][:4], ["gh", "issue", "comment", "12"])
        self.assertIn("Commented: https://github.com/acme/shep/issues/42", out)
        self.assertIn("Already filed", self.say("Ready refuses a reviewed commit")[1])

    def test_the_issue_is_redacted_and_complete(self):
        self.assistant()
        self.settings({"everywhere": {"agents": {"feedback_repo": "https://github.com/acme/shep.git"}}})
        code, out = self.say(
            "Tasks panel loses a task's status line", "--file", "--surface", "web",
            "--goal", "Watch SHEP-7 from my phone.",
            "--happened", "Jane Doe saw it blank on janes-box.example.ts.net (100.101.1.2); log at /home/jane/.herdr/tasks/dev.json, "
                          "token ghp_abcdefghijklmnopqrstuvwxyz012345, GH_TOKEN=s3cr3t, mail jane@example.com\n" + "\n".join(f"log line {i}" for i in range(60)),
            "--tried", "Reloaded the page.", "--expected", "Its last status line.", "--fix", "Keep it in the store.",
            "--repro", "1. Start a task\n2. Restart the service")
        self.assertEqual(code, 0, out)
        self.assertIn("Filed: https://github.com/acme/shep/issues/42", out)
        create = self.gh[-1]
        self.assertEqual(create[:5], ["gh", "issue", "create", "--repo", "acme/shep"])
        self.assertEqual(create[create.index("--title") + 1], "Tasks panel loses a task's status line")
        b = self.body
        for head in ("## Goal", "## What happened", "## What was tried", "## Expected", "## Suggested fix", "## Steps to reproduce", "## Environment"):
            self.assertIn(head, b)
        for words in ("- BossGoat: 3.1.12", "- Agent CLI: Claude Code 0.9.1", "- Used from: the web app", "1. Start a task", "… (cut)"):
            self.assertIn(words, b)
        for secret in ("Jane", "janes-box", "100.101.1.2", "/home/jane", "ghp_", "s3cr3t", "jane@example.com", "log line 40"):
            self.assertNotIn(secret, b)
        self.assertIn("~/.herdr/tasks/dev.json", b)
        self.assertIn("GH_TOKEN=<redacted>", b)

    def test_the_search_never_carries_a_secret(self):
        """The duplicate search leaves the machine too: its words are redacted first."""
        self.assistant()
        self.say("Login fails with GH_TOKEN=supersecret123 for Jane", "--file")
        q = self.gh[0][self.gh[0].index("--search") + 1]
        self.assertEqual(q, "login fails token")
        for w in ("supersecret123", "jane", "redacted", "name"):
            self.assertNotIn(w, q.lower())

    def test_filing_holds_no_lock_while_gh_runs(self):
        """A worker's report while the Assistant's gh call is slow: it still returns at once."""
        import fcntl
        self.assistant()
        locked = []

        def gh(args, **_):
            with open(self.fb.STATE + ".lock", "a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    locked.append(False)
                    fcntl.flock(lock, fcntl.LOCK_UN)
                except OSError:
                    locked.append(True)
            return subprocess.CompletedProcess(args, 0, "[]" if args[1:3] == ["issue", "list"] else "https://github.com/acme/shep/issues/9\n", "")
        with self.mock.patch.object(self.fb, "run", gh):
            code, out = self.say("Status lines vanish after a restart", "--file")
        self.assertIn("Filed: https://github.com/acme/shep/issues/9", out)
        self.assertTrue(locked and not any(locked), locked)  # every search and the create ran with the lock free
        self.assertIn("Already filed: https://github.com/acme/shep/issues/9", self.say("Status lines vanish after a restart")[1])

    def test_never_filed_twice(self):
        """Filed (or a comment added): another --file of the same problem files nothing; one under way
        holds a second off; one that found duplicates or failed leaves it as it was."""
        self.assistant()
        self.issues = [{"number": 12, "title": "Status lines vanish", "url": "https://github.com/acme/shep/issues/12"}]
        self.say("Status lines vanish after a restart", "--file")  # duplicates: nothing filed, nothing held
        self.assertNotIn("filing", open(self.fb.STATE).read())
        self.say("Status lines vanish after a restart", "--file", "--comment", "12")
        n = len(self.gh)
        for again in (["--new"], ["--comment", "12"]):
            code, out = self.say("Status lines vanish after a restart", "--file", *again)
            self.assertIn("Already filed", out)
        self.assertEqual(len(self.gh), n)
        with self.fb.problems() as ps:
            ps[self.fb.key_of("Ready hangs")] = {"line": "Ready hangs", "state": "filing", "at": self.fb.now()}
        self.assertIn("being filed right now", self.say("Ready hangs", "--file", "--new")[1])
        # a report or an offer while it's filed leaves it marked: a second --file still files nothing
        self.assertIn("filing this one right now", self.say("Ready hangs")[1])
        self.caller = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp1"}}
        self.assertIn("filing this one right now", self.say("Ready hangs")[1])
        self.assistant()
        self.assertIn("being filed right now", self.say("Ready hangs", "--file", "--comment", "12")[1])
        self.assertEqual((len(self.gh), self.held), (n, []))

    def test_a_report_queues_in_the_background(self):
        """The news line goes to a detached herdr-task (_hold-news): a report never waits on the held messages' lock."""
        calls = []
        with self.mock.patch.object(self.fb.subprocess, "Popen", lambda args, **kw: calls.append((args, kw))):
            self.queue("t5", "<herdr-news …>")
        (args, kw), = calls
        self.assertEqual(args[-3:], ["_hold-news", "t5", "<herdr-news …>"])
        self.assertTrue(kw["start_new_session"])

    def test_a_workers_details_and_cli_go_in_the_issue(self):
        self.say("Status lines vanish after a restart", "--details", "Restarted the service; every status line went blank.")
        self.assistant()
        self.say("Status lines vanish after a restart", "--file", "--new", "--dry-run")
        self.assertEqual(self.gh, [])
        code, out = self.say("Status lines vanish after a restart", "--file", "--new")
        self.assertIn("every status line went blank", self.body)
        self.assertIn("- Agent CLI: Codex 0.9.1", self.body)

    def test_autopilot_notes_it_for_later(self):
        self.assistant()
        self.assertIn("Noted", self.say("Status lines vanish after a restart", "--later")[1])
        self.assertIn("later  Status lines vanish after a restart", self.say("--list")[1])

    def test_every_role_is_told(self):
        from herdr_task import templates, reactions, autopilot
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            a = f.read()
        for words in ("## Feedback for Shepherdr", "Leave feedback for Shepherdr about", "--no", "--later", "duplicate", "--comment", "in the middle of something urgent"):
            self.assertIn(words, a)
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            self.assertIn(templates.FEEDBACK_RULE.strip(), f.read())
        self.assertIn(templates.FEEDBACK_RULE, templates.WORKER_MD)
        self.assertIn(templates.WORKER_MD_BEFORE_FEEDBACK, templates.OLD_WORKERS)
        with open(os.path.join(ROOT, "templates", "reviewer.md")) as f:
            self.assertIn(templates.REVIEWER_FEEDBACK.strip(), f.read())
        self.assertIn("herdr-task feedback", self.fb.AGENT_NOTE)
        with open(os.path.join(BIN, "herdr_task", "autopilot.py")) as f:
            self.assertIn("herdr-task feedback", f.read())
        self.assertIn("feedback", __import__("herdr_task.launch", fromlist=["OWN"]).OWN)


class CodexAsksOnTheCard(unittest.TestCase):
    """SHEP-91: a Codex worker's PermissionRequest hook (`herdr-task _allow`) allows its own commands, and hands anything
    else to the chat's card (ask-hook.sh, marked HERDR_ASK_CHAINED), waiting as long as the card does."""

    def run_allow(self, command, hook, home=None):
        app = tempfile.mkdtemp()
        if hook is not None:
            os.makedirs(os.path.join(app, "mods", "chat"))
            with open(os.path.join(app, "mods", "chat", "ask-hook.sh"), "w") as f:
                f.write(hook)
        code = ("import sys, types, argparse; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.launch import cmd_allow; cmd_allow(argparse.Namespace(command='/x/herdr-task'))")
        req = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "turn_id": "t1"})
        # its own HOME too: else, with no hook in the app home, cmd_allow falls back to ~/.local/share/herdr/ask's
        # copy, and the real one files a real card for this test and waits on it forever (SHEP-147)
        env = {**os.environ, "HERDR_APP_HOME": app, "HOME": home or app}
        env.pop("HERDR_ASK_CHAINED", None)
        return subprocess.run([sys.executable, "-c", code, BIN], input=req, capture_output=True, text=True, env=env)

    def test_its_own_command_never_asks(self):
        out = self.run_allow("/x/herdr-task status SHEP-1 hi", 'echo "should not run"')
        self.assertEqual(json.loads(out.stdout)["hookSpecificOutput"]["decision"], {"behavior": "allow"}, out.stderr)

    def test_anything_else_goes_to_the_card(self):
        card = ('[ "$HERDR_ASK_CHAINED" = 1 ] || exit 0; grep -q "rm -rf build" || exit 0; '
                'echo \'{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"no"}}}\'')
        out = self.run_allow("rm -rf build", card)
        self.assertEqual(json.loads(out.stdout)["hookSpecificOutput"]["decision"], {"behavior": "deny", "message": "no"}, out.stderr)
        # no card answer (answered in the terminal, or no chat hook installed): no decision, Codex asks itself
        self.assertEqual(self.run_allow("rm -rf build", "exit 0").stdout, "")
        self.assertEqual(self.run_allow("rm -rf build", None).stdout, "")

    def test_without_an_app_hook_the_synced_copy_answers(self):
        """SHEP-147: a machine that only runs tasks has no app-home hook; cmd_allow falls back to the copy a sync left in
        ~/.local/share/herdr/ask. It is HOME's own: a test's HOME, never the person's real one."""
        home = tempfile.mkdtemp()
        ask = os.path.join(home, ".local", "share", "herdr", "ask")
        os.makedirs(ask)
        with open(os.path.join(ask, "ask-hook.sh"), "w") as f:
            f.write('[ "$HERDR_ASK_CHAINED" = 1 ] || exit 0; '
                    'echo \'{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"synced"}}}\'')
        out = self.run_allow("rm -rf build", None, home=home)
        self.assertEqual(json.loads(out.stdout)["hookSpecificOutput"]["decision"]["message"], "synced", out.stderr)
        # neither: nothing answers, and no other home's copy is asked
        self.assertEqual(self.run_allow("rm -rf build", None, home=tempfile.mkdtemp()).stdout, "")
        # this run itself: a throwaway HOME, so no test can reach the real copy (test/home_guard.py)
        self.assertNotEqual(os.path.realpath(os.path.expanduser("~")), home_guard.REAL)

    def test_a_claude_worker_asks_on_the_card_too(self):
        # SHEP-139: a Claude worker's question tool (AskUserQuestion) reached the card only where ~/.claude/settings.json
        # had Herdr's hook: a machine that only runs tasks (synced herdr-task, no Herdr app) showed just "Open terminal".
        # Its launch now carries the same hook as Codex's, in its --settings, once, beside what was there.
        sys.path.insert(0, BIN)
        from herdr_task import launch
        argv = launch.own_argv(["claude", "--settings", json.dumps({"fastMode": False, "hooks": {"Stop": [{"hooks": []}]}}), "go"])
        st = json.loads(argv[argv.index("--settings") + 1])
        [entry] = st["hooks"]["PermissionRequest"]
        self.assertIn(" _allow --command ", entry["hooks"][0]["command"])
        self.assertEqual(entry["hooks"][0]["timeout"], launch.ASK_TIMEOUT)
        self.assertFalse(st["fastMode"])
        self.assertIn("Stop", st["hooks"])
        # resumed (its argv given again): still one hook, and its allow rules not repeated
        again = launch.own_argv(argv)
        st2 = json.loads(again[again.index("--settings") + 1])
        self.assertEqual(len(st2["hooks"]["PermissionRequest"]), 1)
        self.assertEqual(st2["permissions"]["allow"], st["permissions"]["allow"])
        # no --settings of its own: one is added
        plain = launch.own_argv(["claude", "go"])
        self.assertIn("PermissionRequest", json.loads(plain[2])["hooks"])

    def test_the_card_hook_where_only_tasks_run(self):
        # no Herdr app home here: the copy a sync left in ~/.local/share/herdr/ask is the card's hook
        home = tempfile.mkdtemp()
        os.makedirs(os.path.join(home, ".local", "share", "herdr", "ask"))
        hook = os.path.join(home, ".local", "share", "herdr", "ask", "ask-hook.sh")
        with open(hook, "w") as f:
            f.write("exit 0\n")
        code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
                "from herdr_task.launch import ask_hook; print(ask_hook())")
        env = {**os.environ, "HOME": home, "HERDR_APP_HOME": os.path.join(home, "none")}
        out = subprocess.run([sys.executable, "-c", code, BIN], capture_output=True, text=True, env=env)
        self.assertEqual(out.stdout.strip(), hook, out.stderr)

    def test_a_sync_takes_the_card_hook_along(self):
        sys.path.insert(0, BIN)
        from herdr_task import machines
        app = tempfile.mkdtemp()
        os.makedirs(os.path.join(app, "mods", "chat"))
        for name in ("ask-hook.sh", "ask-end.py"):
            with open(os.path.join(app, "mods", "chat", name), "w") as f:
                f.write(f"# {name}\n")
        from unittest import mock
        with mock.patch.object(machines, "APP_HOME", app):
            files = {f["path"]: f for f in machines.manifest()["files"]}
        self.assertEqual(files[".local/share/herdr/ask/ask-hook.sh"]["data"], b"# ask-hook.sh\n")
        self.assertEqual(files[".local/share/herdr/ask/ask-hook.sh"]["mode"], 0o755)
        self.assertIn(".local/share/herdr/ask/ask-end.py", files)

    def test_codex_waits_as_long_as_the_card(self):
        sys.path.insert(0, BIN)
        from herdr_task import launch
        argv = launch.own_argv(["codex", "--sandbox", "workspace-write"])
        self.assertIn(f"timeout={launch.ASK_TIMEOUT}", argv[2])
        self.assertEqual(launch.ASK_TIMEOUT, 1800)

    def test_a_codex_workers_proof_and_commits_never_ask(self):
        """#866: Codex's sandbox can't write Shepherdr's stores nor git's data, so a Codex worker runs its proof and
        commits escalated: its own hook allows exactly those (not a Claude worker's, nor anything chained or riskier)."""
        sys.path.insert(0, BIN)
        from unittest import mock
        from herdr_task import launch
        with mock.patch.object(launch.shutil, "which", lambda n: None):
            own = lambda c, sb=True: launch.own_command("/x/herdr-task", c, sb)  # noqa: E731
            for c in ("herdr-artifact publish /tmp/p --title 'X · Proof'", "herdr-artifact guide", "herdr-artifact update a-1 /tmp/p",
                      "git add calc.py", "git commit -m 'Fix add'", "/x/herdr-task ready SHEP-1 --summary hi"):
                self.assertTrue(own(c), c)
            for c in ("herdr-artifact publish /tmp/p --custom", "herdr-artifact rm a-1", "git push", "git -c core.hooksPath=/tmp commit",
                      "git -C /elsewhere commit -m x", "git add . && git commit -m x", "git commit -m \"$(id)\"", "rm -rf build"):
                self.assertFalse(own(c), c)
            self.assertFalse(own("git commit -m x", False))
            self.assertFalse(own("herdr-artifact publish /tmp/p", False))
        # its review: the reviewer the brief's Reviewer line gives, read-only, and its own helpers only
        from herdr_task.settings import reviewer_command
        rv = reviewer_command("codex", folder=tempfile.mkdtemp())
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "demo#1"}):
            own = lambda c, sb=True: launch.own_command("/x/herdr-task", c, sb)  # noqa: E731
            yes = [f"hc run --bg --name demo-1-review --label \"herdr.task=$HERDR_BROWSER_TASK\" --label herdr.role=reviewer "
                   f"--label herdr.agent=codex -- {rv} 'Review it: \"ok\" & $x'",
                   "hc run --bg --name demo-1-review -- claude --permission-mode plan --model opus 'review'",
                   "hc wait demo-1-review --timeout 600", "hc read demo-1-review --lines 400", "hc kill demo-1-review"]
            no = ["hc run --bg --name demo-1-review -- claude --permission-mode plan --dangerously-skip-permissions x",
                  "hc run --bg --name demo-1-review -- codex --no-daemon --sandbox read-only --ask-for-approval never "
                  "-c sandbox_mode=\"danger-full-access\" x",
                  "hc run --bg --name demo-1-review -- sh -c 'rm -rf /'", "hc run --bg --name x -- claude --permission-mode plan x",
                  "hc kill t15q", "hc send demo-1-review hi"]
            for c in yes:
                self.assertTrue(own(c), c)
            for c in no:
                self.assertFalse(own(c), c)
            self.assertFalse(own(yes[2], False))
        argv = launch.own_argv(["codex", "-s", "workspace-write"])
        self.assertIn(" _allow --command ", argv[2])
        self.assertIn(" --sandboxed", argv[2])
        claude = json.loads(launch.own_argv(["claude", "go"])[2])["hooks"]["PermissionRequest"][0]["hooks"][0]["command"]
        self.assertNotIn("--sandboxed", claude)

    def test_a_codex_worker_never_stops_on_trust_this_folder(self):
        """#866: a Codex worker in a folder Codex hasn't seen sat at "Trust this folder?", nobody at the keys."""
        sys.path.insert(0, BIN)
        from herdr_task import launch
        d = os.path.realpath(tempfile.mkdtemp())
        subprocess.run(["git", "init", "-q", d], check=True)
        argv = launch.own_argv(["codex", "-s", "workspace-write"], d)
        self.assertIn("projects={%s={trust_level=\"trusted\"}}" % json.dumps(d), argv)
        # given already (the person's own argv): left as it is
        mine = ["codex", "-c", "projects={}"]
        self.assertEqual(sum(str(a).startswith("projects") for a in launch.own_argv(mine, d)), 1)
        self.assertFalse(any(str(a).startswith("projects") for a in launch.own_argv(["codex"])))

class TaskFlow(unittest.TestCase):
    """SHEP-170's task flow fixes, in a throwaway git repo and store; hc and gh are never run."""

    def setUp(self):
        from unittest import mock
        import shutil
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        self.commands, self.mock = commands, mock
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.main, wt = os.path.join(self.root, "repo"), os.path.join(self.root, "wt")
        self.git(self.root, "init", "-q", "-b", "main", self.main)
        for k, v in (("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
            self.git(self.main, "config", k, v)
        self.commit(self.main, "base")
        self.git(self.main, "worktree", "add", "-q", "-b", "task/1", wt, "HEAD")
        self.live = []
        self.said = []
        self.store = Store([{"id": 1, "title": "Flow", "state": "running", "mode": "worktree", "worktree": wt,
                             "branch": "task/1", "base": "main", "start": self.git(wt, "rev-parse", "HEAD"), "agents": [],
                             "started": 1}])
        self.store.loc["folder"] = self.main
        self.task = self.store.data["tasks"][0]
        self.patch(commands, "open_store", lambda args, write=True: self.store)
        self.patch(commands, "view", lambda s, t, live=None: dict(t))
        self.patch(commands, "say", lambda args, v, text: self.said.append(text))
        self.patch(commands, "live_agents", lambda key: self.live)
        self.patch(commands, "detail", lambda k: k)

    def patch(self, mod, name, value):
        p = self.mock.patch.object(mod, name, value)
        p.start()
        self.addCleanup(p.stop)

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, cwd, words, file=None):
        if file:
            with open(os.path.join(cwd, file), "a") as f:
                f.write(words + "\n")
            self.git(cwd, "add", file)
        self.git(cwd, "commit", "-q", "--allow-empty", "-m", words)
        return self.git(cwd, "rev-parse", "HEAD")

    def args(self, **kw):
        import argparse
        return argparse.Namespace(**{"id": "SHEP-1", "json": True, "folder": None, **kw})

    def test_switch_moves_the_task_to_the_given_space(self):
        """#837: an explicit --space wins over the old agent's herdr.task.space label."""
        self.task["space"] = "sp-a"
        self.live = [{"address": "t1", "status": {"state": "working"}, "labels": {"herdr.task.space": "sp-a"}}]
        got = []
        self.patch(self.commands, "agent_running", lambda k: True)
        self.patch(self.commands, "refresh_sessions", lambda *a: None)
        self.patch(self.commands, "run", lambda *a, **k: None)
        self.patch(self.commands, "start_again", lambda s, t, space, *a, **k: (got.append(space), ({"address": "t2", "agent": "claude"}, False))[1])
        self.commands.cmd_switch(self.args(space="sp-b", agent="claude", argv=None, parent="t9", keep=False))
        self.assertEqual(got, ["sp-b"])
        got.clear()
        self.commands.cmd_switch(self.args(space=None, agent="claude", argv=None, parent=None, keep=False))
        self.assertEqual(got, ["sp-a"])  # none given: the old agent's own space

    def settings(self, d):
        import herdr_task.settings as settings
        f = os.path.join(self.root, "shepherdr.json")
        with open(f, "w") as fh:
            json.dump(d, fh)
        self.patch(settings, "SETTINGS", f)
        return settings

    def test_suggested_next_message_in_the_brief(self):
        """SHEP-186: a worker's brief says whether its replies end with a suggested next message: on by default,
        and off when Settings › Agents turns it off (the agent then writes no suggest line)."""
        settings = self.settings({})
        self.assertIn("- Suggested next message: on (your reply ends with the message you'd likely send next",
                      settings.settings_block(self.store, self.task))
        settings = self.settings({"everywhere": {"agents": {"suggestions": False}}})
        self.assertIn("- Suggested next message: off (no suggested next message) (your setting everywhere)",
                      settings.settings_block(self.store, self.task))

    def test_a_running_task_keeps_its_briefs_review(self):
        """#750: Review turned on everywhere while a task runs: its brief said off, so show and ready say off too."""
        settings = self.settings({})
        self.task["agents"] = [{"argv": ["claude"], "agent": "claude"}]
        settings.keep_review(self.store, self.task)  # its brief: Review off
        self.task["review_gate"] = True
        self.commit(self.task["worktree"], "work", "a.txt")
        self.task["head"] = self.git(self.task["worktree"], "rev-parse", "HEAD")
        self.settings({"everywhere": {"tasks": {"review_rounds": 3}}})
        self.assertEqual(settings.review_limits(self.store, self.task)[0], False)
        self.assertIn("- Review: off", settings.settings_block(self.store, self.task))
        self.assertIsNone(self.commands.review_refusal(self.store, self.task, self.task["worktree"]))
        # A fresh brief (a task started now) gets today's: on, three rounds, and ready waits for one.
        settings.keep_review(self.store, self.task)
        self.assertEqual(settings.review_limits(self.store, self.task), (True, 3))
        self.assertIn("isn't reviewed", self.commands.review_refusal(self.store, self.task, self.task["worktree"]))
        # Turned off again meanwhile: still on for this one, as its brief said.
        self.settings({})
        self.assertEqual(settings.review_limits(self.store, self.task), (True, 3))

    def reviewed_task(self):
        self.settings({"everywhere": {"tasks": {"review_rounds": 3}}})
        self.task["review_gate"] = True
        wt = self.task["worktree"]
        head = self.commit(wt, "work", "a.txt")
        self.task["reviews"] = [{"round": 1, "result": "report", "at": 2, "head": head}]
        return wt

    def refusal(self):
        wt = self.task["worktree"]
        self.task["head"] = self.git(wt, "rev-parse", "HEAD")
        return self.commands.review_refusal(self.store, self.task, wt)

    def test_a_clean_merge_from_the_base_needs_no_new_round(self):
        """#741: merging the base into a reviewed branch, cleanly, keeps it reviewed."""
        wt = self.reviewed_task()
        self.assertIsNone(self.refusal())
        self.commit(self.main, "another task", "b.txt")
        self.git(wt, "merge", "-q", "--no-edit", "main")
        self.assertIsNone(self.refusal())
        self.commit(self.main, "and another", "c.txt")
        self.git(wt, "merge", "-q", "--no-edit", "main")
        self.assertIsNone(self.refusal())  # twice over
        self.commit(wt, "a fix of its own", "a.txt")
        self.assertIn("isn't reviewed", self.refusal())

    def test_a_merge_with_more_in_it_needs_a_round(self):
        wt = self.reviewed_task()
        self.commit(self.main, "another task", "b.txt")
        self.git(wt, "merge", "-q", "--no-edit", "main")
        with open(os.path.join(wt, "b.txt"), "a") as f:
            f.write("slipped in\n")
        self.git(wt, "commit", "-q", "-a", "--amend", "--no-edit")
        self.assertIn("isn't reviewed", self.refusal())

    def test_a_merge_with_conflicts_needs_a_round(self):
        wt = self.reviewed_task()
        self.commit(self.main, "the same file", "a.txt")
        subprocess.run(["git", "-C", wt, "merge", "-q", "--no-edit", "main"], capture_output=True)
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("resolved\n")
        self.git(wt, "commit", "-q", "-a", "--no-edit")
        self.assertIn("isn't reviewed", self.refusal())

    def test_out_of_rounds_needs_you_whatever_its_line_says(self):
        """#784: ready refused for rounds, the worker's status line "waiting for a review round" is no work of its own."""
        from herdr_task import agents, base
        t = base.now()
        self.task.update(started=t - 3600000, agents=[{"address": "t1", "at": t - 3600000}],
                         progress={"text": "Out of review rounds: waiting for a review round", "set": t - 60000, "at": t - 60000})
        live = [{"address": "t1", "status": {"state": "idle"}, "status_ms": t - 120000}]
        self.patch(agents, "agent_log", lambda *a, **k: None)
        self.assertEqual(agents.task_status(self.task, live)[0], "working")  # its own line: on its own review
        self.task["review_out"] = t - 90000
        self.assertEqual(agents.task_status(self.task, live)[:2], ("needs", "reply"))

    def test_ready_pushes_only_what_the_remote_lacks(self):
        """#795: the branch already on its remote at its tip: no push through a pre-push hook that fails."""
        import herdr_task.github as github
        wt, remote = self.task["worktree"], os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        self.commit(wt, "work", "a.txt")
        self.git(wt, "push", "-q", "--no-verify", "origin", "task/1")  # by hand
        hooks = os.path.join(self.main, ".git", "hooks")
        os.makedirs(hooks, exist_ok=True)
        with open(os.path.join(hooks, "pre-push"), "w") as f:
            f.write("#!/bin/sh\necho 'over the time budget' >&2\nexit 1\n")
        os.chmod(os.path.join(hooks, "pre-push"), 0o755)
        asked = []

        def gh(*a, **k):
            asked.append(a[:2])
            return (True, "https://github.com/o/r/pull/7", "") if a[:2] == ("pr", "create") else (True, "[]", "")
        self.patch(github, "gh", gh)
        self.assertEqual(github.pr_open(self.store, self.task, "o/r")["number"], 7)
        self.assertIn(("pr", "create"), asked)
        # A commit the remote lacks: pushed, and the hook's failure said.
        self.task.pop("pr")
        self.commit(wt, "more", "a.txt")
        with self.assertRaises(Exception) as e:
            github.pr_open(self.store, self.task, "o/r")
        self.assertIn("Couldn't push task/1", str(e.exception))

    def test_ready_keeps_the_pull_request_the_task_continues(self):
        """#828: the work pushed to an open pull request's own branch: ready takes that one, never a second."""
        import herdr_task.github as github
        wt, remote = self.task["worktree"], os.path.join(self.root, "remote.git")
        self.git(self.root, "init", "-q", "--bare", remote)
        self.git(self.main, "remote", "add", "origin", remote)
        tip = self.commit(wt, "finish it", "a.txt")
        self.git(wt, "push", "-q", "origin", "task/1:refs/heads/feature")  # by the agent
        asked = []

        def gh(*a, **k):
            asked.append(a)
            if a[:2] == ("pr", "list") and "--search" in a:
                return True, json.dumps([{"number": 2918, "url": "https://github.com/o/r/pull/2918", "isCrossRepository": False,
                                          "baseRefName": "main", "headRefName": "feature", "headRefOid": tip}]), ""
            if a[:2] == ("pr", "view"):
                return True, "OPEN", ""
            return (False, "", "no") if a[:2] == ("pr", "create") else (True, "[]", "")
        self.patch(github, "gh", gh)
        self.assertEqual(github.pr_open(self.store, self.task, "o/r", "Done")["number"], 2918)
        self.assertNotIn("create", [a[1] for a in asked])
        self.assertEqual(self.git(self.root, "--git-dir", remote, "branch", "--list", "task/1"), "")  # no branch of its own
        # A later commit goes to that pull request's branch.
        tip = self.commit(wt, "a fix", "a.txt")
        self.assertEqual(github.pr_open(self.store, self.task, "o/r")["number"], 2918)
        self.assertEqual(self.git(self.root, "--git-dir", remote, "rev-parse", "feature"), tip)

    def test_the_same_red_checks_are_told_once(self):
        """#796: after ready again, the same failing checks of the same commit aren't news again."""
        from herdr_task import ghnews, base
        self.patch(ghnews, "resting", lambda s, t: {"address": "t1"})
        self.patch(ghnews, "pr_comments", lambda repo, n: [])
        self.patch(ghnews, "log_tail", lambda repo, rid: None)
        self.task.update(state="ready", ready_at=base.now() - 1000, pr={"number": 7, "repo": "o/r", "url": "u"})
        v = {"state": "OPEN", "headRefOid": "abc", "statusCheckRollup": [{"name": "test", "conclusion": "FAILURE", "detailsUrl": "x"}]}
        ghnews.pr_news(self.store, self.task, v, {})
        self.assertIn('Check "test" failed', self.task["pr"].pop("news")["text"])  # told, then ready again
        self.task["ready_at"] = base.now()
        ghnews.pr_news(self.store, self.task, v, {})
        self.assertNotIn("news", self.task["pr"])
        # A new commit's runs failing: news.
        self.task["ready_at"] = base.now() + 1
        ghnews.pr_news(self.store, self.task, {**v, "headRefOid": "def"}, {})
        self.assertIn("news", self.task["pr"])

    def test_an_automation_sets_its_tasks_review(self):
        """#744: auto add/edit --set, kept on the automation and given to each task it adds."""
        import argparse
        from herdr_task import automations
        none = dict(title=None, prompt=None, prompt_file=None, every=None, on="ready", match=None, from_=None, agent=None,
                    here=False, worktree=False, space=None, parent=None)
        a = {"id": 1, "title": "Sweep", "prompt": "Read the open pull requests", "space": "sp1", "skill": "hc-review"}
        automations.set_auto_fields(self.store, a, argparse.Namespace(**none, set=["review=off", "reviewer.model=opus"]))
        self.assertEqual(a["set"], {"review": "off", "reviewer.model": "opus"})
        with self.assertRaises(Exception):
            automations.set_auto_fields(self.store, a, argparse.Namespace(**none, set=["colour=red"]))
        automations.set_auto_fields(self.store, a, argparse.Namespace(**none, set=["reviewer.model="]))
        self.assertEqual(a["set"], {"review": "off"})
        self.store.new = lambda title, prompt, mode: self.store.data["tasks"].append(
            {"id": 2, "title": title, "prompt": prompt, "mode": mode, "state": "todo", "agents": []}) or self.store.data["tasks"][-1]
        for name, value in (("worker_argv", lambda s, t, space: ["claude"]), ("queue_reason", lambda s, t: None),
                            ("begin", lambda *a, **k: None)):
            self.patch(automations, name, value)
        t = automations.fire(self.store, a, "every")
        self.assertEqual(t["set"], {"review": "off"})

    def test_a_folder_task_that_changed_nothing_needs_no_review(self):
        """#744: a task in the folder itself, still on the commit it started at with nothing changed: nothing to review."""
        self.settings({"everywhere": {"tasks": {"review_rounds": 3}}})
        self.task.update(mode="here", worktree=None, review_gate=True, folder_start=self.git(self.main, "rev-parse", "HEAD"))
        self.assertIsNone(self.commands.review_refusal(self.store, self.task, None))
        with open(os.path.join(self.main, "a.txt"), "w") as f:
            f.write("x\n")
        self.git(self.main, "add", "a.txt")
        self.assertIn("isn't reviewed", self.commands.review_refusal(self.store, self.task, None))  # changed
        self.git(self.main, "commit", "-q", "-m", "a")
        self.assertIn("isn't reviewed", self.commands.review_refusal(self.store, self.task, None))  # committed

    def test_the_folder_trust_dialog_needs_you(self):
        """#755: Claude Code's folder-trust dialog (no status reported yet) is Needs you, not Working."""
        from herdr_task import agents, base
        screen = "Accessing workspace:\\n\\n Quick safety check: Is this a project you created or one you trust?\\n ❯ No, exit\\n   Yes, I trust this folder\\n"
        shown = [screen]
        self.patch(agents, "_trust_seen", {})
        self.patch(base, "run", lambda argv, **k: subprocess.CompletedProcess(argv, 0, shown[0], ""))
        self.task.update(started=base.now() - 10000, agents=[{"address": "t1", "at": base.now() - 10000}])
        live = [{"address": "t1", "status": None, "turn": 0}]
        self.assertEqual(agents.task_status(self.task, live), ("needs", "asks", agents.REASONS["trust"]))
        agents._trust_seen.clear()
        shown[0] = "❯ "
        self.assertEqual(agents.task_status(self.task, live)[0], "working")  # just started, no dialog
        live[0]["status"] = "working"
        shown[0] = screen  # never read once it reports
        self.assertEqual(agents.task_status(self.task, live)[0], "working")

    def test_low_priority_says_nothing_without_proc(self):
        """#755: no "oom_score_adj: No such file" line where /proc isn't (a Mac)."""
        from herdr_task import launch
        low = launch.LOW.replace("/proc/self/oom_score_adj", os.path.join(self.root, "none", "oom_score_adj"))
        p = subprocess.run(["sh", "-c", low, "herdr-low", "true"], capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stderr), (0, ""))

    def test_an_agent_under_fish_is_running(self):
        """#780: under fish the foreground stays `fish -ic "<agent>; exec fish -i"` while its agent works."""
        from herdr_task import agents
        fg = lambda *argv: {"address": "t1", "foreground": {"name": "fish", "argv": list(argv), "pid": 9}}
        self.assertTrue(agents.agent_running(fg("/usr/bin/fish", "-ic", "claude --model x; exec fish -i")))
        self.assertTrue(agents.agent_running(fg("fish", "-l", "--command", "claude; exec fish -i")))
        self.assertFalse(agents.agent_running(fg("fish", "-i")))  # exec'ed its own shell: the agent exited
        self.assertFalse(agents.agent_running(fg("bash")))
        self.assertTrue(agents.agent_running({"foreground": {"name": "claude", "argv": ["claude"]}}))


class ReachProbeSpaces(unittest.TestCase):
    """SHEP-185: a machine's reach map lists its spaces from the window's live list (herdr-app ls) when a window there
    names some, else herdr-core's saved document; the probe runs for real with fake hc and herdr-app on PATH."""

    def probe(self, live=None, saved=None):
        sys.path.insert(0, BIN)
        from herdr_task.machines import PROBE
        root = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(root, ignore_errors=True))
        bin_ = os.path.join(root, "bin")
        os.makedirs(bin_)
        state = os.path.join(root, "state", "herdr-core", "default")
        os.makedirs(state)
        with open(os.path.join(state, "docs.json"), "w") as f:
            json.dump({"herdr-app": {"value": {"spaces": saved or []}, "version": 3}}, f)
        hc = ('#!/bin/sh\ncase "$1 $2" in\n'
              '"server status") echo \'{"core":{"id":"c-b","name":"vm-b"}}\' ;;\n'
              '"machine ls") echo \'{"machines":[]}\' ;;\n'
              '"ls --json") echo \'{"terminals":[]}\' ;;\n'
              '*) echo "{}" ;;\nesac\n')
        for name, body in (("hc", hc), ("herdr-app", None if live is None else '#!/bin/sh\necho \'%s\'\n' % json.dumps({"spaces": live}))):
            if body is None:
                continue
            with open(os.path.join(bin_, name), "w") as f:
                f.write(body)
            os.chmod(os.path.join(bin_, name), 0o755)
        env = {**os.environ, "PATH": bin_, "XDG_STATE_HOME": os.path.join(root, "state")}
        out = subprocess.run([sys.executable, "-c", "import sys; S = sys.stdin.read(); exec(S)", json.dumps({"depth": 0, "seen": [], "timeout": 20})],
                             input=PROBE, capture_output=True, text=True, env=env, timeout=120)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def test_the_window_list_beats_a_saved_document_that_is_empty(self):
        got = self.probe(live=[{"id": "sp1", "name": "", "folder": os.path.expanduser('~')}], saved=[])
        self.assertEqual([(s["id"], s["folder"]) for s in got["spaces"]], [("sp1", os.path.expanduser('~'))])
        self.assertEqual(got["home"], os.path.expanduser("~"))

    def test_without_a_window_the_saved_document_is_read(self):
        got = self.probe(live=None, saved=[{"id": "sp2", "name": "shop", "folder": "/base/shop"}])
        self.assertEqual([(s["id"], s["name"]) for s in got["spaces"]], [("sp2", "shop")])

    def test_a_window_without_spaces_falls_back_to_the_document(self):
        got = self.probe(live=[], saved=[{"id": "sp3", "name": "lab", "folder": "/base/x"}])
        self.assertEqual([s["id"] for s in got["spaces"]], ["sp3"])


class StopLog(unittest.TestCase):
    """SHEP-189: the stop log keeps the last lines as JSON, and never raises into the work it logs."""

    def test_keeps_the_last_lines_as_json(self):
        import herdr_task.base as base
        d = tempfile.mkdtemp()
        from unittest import mock
        with mock.patch.object(base, "STOP_LOG", os.path.join(d, "stops.jsonl")):
            for i in range(base.STOP_LOG_LINES + 5):
                base.stop_note("end-done", n=i)
            with open(base.STOP_LOG) as f:
                lines = f.read().splitlines()
        self.assertEqual(len(lines), base.STOP_LOG_LINES)
        last = json.loads(lines[-1])
        self.assertEqual((last["kind"], last["n"]), ("end-done", base.STOP_LOG_LINES + 4))
        self.assertIn("at", last)

    def test_a_log_that_cannot_be_written_does_not_raise(self):
        import herdr_task.base as base
        from unittest import mock
        with mock.patch.object(base, "STOP_LOG", "/proc/forbidden/stops.jsonl"):
            base.stop_note("gone", task="SHEP-1")  # must not raise
