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
                            ("space_info", lambda s: ("~", self.folder) if s == "sp1" else (None, None))):
            p = mock.patch.object(ap, name, value)
            p.start()
            self.addCleanup(p.stop)

    def cmd(self, sub, **kw):
        import argparse
        args = argparse.Namespace(autopilot=sub, json=True, space=None, everywhere=False, every=None, on=None, heartbeat=None)
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
        self.cmd("set", everywhere=True, every="weekdays 9:00")
        v = self.cmd("show", space="sp1")
        self.assertEqual(v["every"], "weekdays 9:00")
        self.assertNotEqual(v["next_run"], v0)
        # its own schedule wins there (and gets its own next wake); its events still follow Everywhere's
        v = self.cmd("set", space="sp1", every="every 2 hours")
        self.assertEqual((v["every"], v["events"], v["own"]), ("every 2 hours", ["ready"], ["every"]))
        self.assertEqual(self.cmd("show", space="sp2")["every"], "weekdays 9:00")
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
        self.assertEqual((v["heartbeat"], v["heartbeat_from"], v["blank"]), (self.ap.heartbeat_path(), "file", True))
        with open(v["heartbeat"]) as f:
            self.assertEqual(f.read(), self.ap.STARTER)
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
        self.assertEqual(self.agents.task_status(t, [self.agent({"address": "t1", "status": "working", "turn": 4, "role": "worker"})])[0], "ready")

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
        self.merging([fine, fine, fine], [(False, "", "GraphQL: Something went wrong"), (True, "", "")])
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


if __name__ == "__main__":
    unittest.main()
